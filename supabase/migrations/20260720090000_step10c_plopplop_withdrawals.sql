-- Étape 10C — retraits PlopPlop sécurisés, idempotents et remboursables

create table if not exists public.plopplop_withdrawals (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  provider text not null default 'plopplop' check (provider = 'plopplop'),
  provider_reference text not null,
  provider_transaction_id text,
  api_reference text,
  amount numeric(18,2) not null check (
    amount >= 20 and amount <= 100000 and amount = round(amount, 2)
  ),
  fee numeric(18,2),
  provider_total numeric(18,2),
  method text not null check (method in ('moncash','natcash')),
  recipient text not null check (recipient ~ '^509[0-9]{8}$'),
  status text not null default 'reserved' check (
    status in ('reserved','processing','pending','completed','failed','refunded','manual_review','cancelled')
  ),
  execution_state text not null default 'new' check (
    execution_state in ('new','processing','provider_unknown','done','error')
  ),
  reservation_reference text not null,
  refund_reference text,
  funds_reserved_at timestamptz,
  execution_started_at timestamptz,
  completed_at timestamptz,
  refunded_at timestamptz,
  last_verified_at timestamptz,
  last_error_code text,
  provider_response jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_response) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plopplop_withdrawals_request_id_key unique (request_id),
  constraint plopplop_withdrawals_provider_reference_key unique (provider_reference),
  constraint plopplop_withdrawals_reservation_reference_key unique (reservation_reference),
  constraint plopplop_withdrawals_final_state_check check (
    (status = 'completed' and completed_at is not null and refunded_at is null)
    or (status = 'refunded' and refunded_at is not null)
    or status not in ('completed','refunded')
  )
);

create unique index if not exists plopplop_withdrawals_refund_reference_uidx
  on public.plopplop_withdrawals(refund_reference)
  where refund_reference is not null;
create unique index if not exists plopplop_withdrawals_provider_transaction_uidx
  on public.plopplop_withdrawals(provider_transaction_id)
  where provider_transaction_id is not null;
create unique index if not exists plopplop_withdrawals_api_reference_uidx
  on public.plopplop_withdrawals(api_reference)
  where api_reference is not null;
create index if not exists plopplop_withdrawals_user_id_idx
  on public.plopplop_withdrawals(user_id);
create index if not exists plopplop_withdrawals_status_idx
  on public.plopplop_withdrawals(status);
create index if not exists plopplop_withdrawals_created_at_idx
  on public.plopplop_withdrawals(created_at desc);

alter table public.payment_provider_alerts
  add column if not exists withdrawal_id uuid references public.plopplop_withdrawals(id) on delete set null;
create index if not exists payment_provider_alerts_withdrawal_id_idx
  on public.payment_provider_alerts(withdrawal_id);

alter table public.plopplop_withdrawals enable row level security;

drop policy if exists plopplop_withdrawals_select_authorized
  on public.plopplop_withdrawals;
create policy plopplop_withdrawals_select_authorized
on public.plopplop_withdrawals for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.role in ('admin','super_admin')
  )
);

revoke all on public.plopplop_withdrawals from public, anon, authenticated;
grant select on public.plopplop_withdrawals to authenticated;
grant all on public.plopplop_withdrawals to service_role;

drop trigger if exists trg_plopplop_withdrawals_updated_at
  on public.plopplop_withdrawals;
create trigger trg_plopplop_withdrawals_updated_at
before update on public.plopplop_withdrawals
for each row execute function private.touch_plopplop_updated_at();

create or replace function public.create_or_get_plopplop_withdrawal(
  p_user_id uuid,
  p_request_id uuid,
  p_amount numeric,
  p_method text,
  p_recipient text
)
returns public.plopplop_withdrawals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plopplop_withdrawals%rowtype;
  v_provider_reference text;
  v_reservation_reference text;
begin
  if p_user_id is null or p_request_id is null then
    raise exception 'Utilisateur et request_id requis.';
  end if;

  if p_amount is null or p_amount < 20 or p_amount > 100000 or p_amount <> round(p_amount, 2) then
    raise exception 'Le retrait doit être compris entre 20 et 100000 HTG avec au maximum deux décimales.';
  end if;

  p_method := lower(nullif(btrim(p_method), ''));
  if p_method not in ('moncash','natcash') then
    raise exception 'Méthode de retrait invalide.';
  end if;

  p_recipient := regexp_replace(coalesce(p_recipient,''), '[^0-9]', '', 'g');
  if p_recipient ~ '^[0-9]{8}$' then
    p_recipient := '509' || p_recipient;
  end if;
  if p_recipient !~ '^509[0-9]{8}$' then
    raise exception 'Numéro destinataire invalide. Format attendu : 509XXXXXXXX.';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.status = 'active'
  ) then
    raise exception 'Compte utilisateur inactif ou introuvable.';
  end if;

  v_provider_reference := 'TKW-PLOP-' || replace(p_request_id::text, '-', '');
  v_reservation_reference := 'withdrawal-plopplop-reserve-' || v_provider_reference;

  insert into public.plopplop_withdrawals(
    user_id, request_id, provider_reference, amount, method, recipient,
    reservation_reference, status, execution_state
  ) values (
    p_user_id, p_request_id, v_provider_reference, p_amount, p_method, p_recipient,
    v_reservation_reference, 'reserved', 'new'
  )
  on conflict (request_id) do nothing;

  select * into strict v_row
  from public.plopplop_withdrawals
  where request_id = p_request_id
  for update;

  if v_row.user_id <> p_user_id
     or v_row.amount <> p_amount
     or v_row.method <> p_method
     or v_row.recipient <> p_recipient then
    raise exception 'Ce request_id existe déjà avec des paramètres différents.';
  end if;

  if v_row.funds_reserved_at is null then
    perform public.apply_transaction(
      p_user_id := v_row.user_id,
      p_type := 'withdrawal',
      p_amount := v_row.amount,
      p_reference := v_row.reservation_reference,
      p_description := 'Réservation retrait PlopPlop',
      p_metadata := jsonb_build_object(
        'provider','plopplop',
        'withdrawal_id',v_row.id,
        'provider_reference',v_row.provider_reference,
        'method',v_row.method,
        'recipient_masked','509*****' || right(v_row.recipient,3)
      )
    );

    update public.plopplop_withdrawals
    set funds_reserved_at = now(),
        status = 'reserved',
        execution_state = 'new'
    where id = v_row.id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.claim_plopplop_withdrawal_execution(
  p_withdrawal_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plopplop_withdrawals%rowtype;
begin
  select * into strict v_row
  from public.plopplop_withdrawals
  where id = p_withdrawal_id and user_id = p_user_id
  for update;

  if v_row.status in ('completed','refunded','cancelled','manual_review','pending') then
    return jsonb_build_object('claimed',false,'reason',v_row.status,'withdrawal',to_jsonb(v_row));
  end if;

  if v_row.execution_state = 'processing'
     and v_row.execution_started_at > now() - interval '3 minutes' then
    return jsonb_build_object('claimed',false,'reason','processing','withdrawal',to_jsonb(v_row));
  end if;

  update public.plopplop_withdrawals
  set status = 'processing',
      execution_state = 'processing',
      execution_started_at = now(),
      last_error_code = null
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object('claimed',true,'reason','claimed','withdrawal',to_jsonb(v_row));
end;
$$;

create or replace function public.release_plopplop_withdrawal_execution(
  p_withdrawal_id uuid,
  p_user_id uuid,
  p_error_code text,
  p_provider_response jsonb
)
returns public.plopplop_withdrawals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plopplop_withdrawals%rowtype;
begin
  update public.plopplop_withdrawals
  set status = case when status = 'processing' then 'reserved' else status end,
      execution_state = 'error',
      last_error_code = left(coalesce(nullif(btrim(p_error_code),''),'temporary_error'),120),
      provider_response = coalesce(p_provider_response,'{}'::jsonb)
  where id = p_withdrawal_id and user_id = p_user_id
    and status not in ('completed','refunded','manual_review','pending')
  returning * into strict v_row;
  return v_row;
end;
$$;

create or replace function public.mark_plopplop_withdrawal_pending(
  p_withdrawal_id uuid,
  p_user_id uuid,
  p_provider_transaction_id text,
  p_api_reference text,
  p_fee numeric,
  p_provider_total numeric,
  p_error_code text,
  p_provider_response jsonb
)
returns public.plopplop_withdrawals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plopplop_withdrawals%rowtype;
  v_transaction_id text := nullif(btrim(p_provider_transaction_id),'');
  v_api_reference text := nullif(btrim(p_api_reference),'');
  v_duplicate_transaction boolean := false;
  v_duplicate_api_reference boolean := false;
begin
  select * into strict v_row
  from public.plopplop_withdrawals
  where id = p_withdrawal_id and user_id = p_user_id
  for update;

  if v_transaction_id is not null then
    select exists(
      select 1 from public.plopplop_withdrawals w
      where w.provider_transaction_id = v_transaction_id and w.id <> v_row.id
    ) into v_duplicate_transaction;
  end if;
  if v_api_reference is not null then
    select exists(
      select 1 from public.plopplop_withdrawals w
      where w.api_reference = v_api_reference and w.id <> v_row.id
    ) into v_duplicate_api_reference;
  end if;

  update public.plopplop_withdrawals
  set provider_transaction_id = case
        when v_duplicate_transaction then provider_transaction_id
        else coalesce(v_transaction_id,provider_transaction_id)
      end,
      api_reference = case
        when v_duplicate_api_reference then api_reference
        else coalesce(v_api_reference,api_reference)
      end,
      fee = coalesce(p_fee,fee),
      provider_total = coalesce(p_provider_total,provider_total),
      status = case
        when status in ('completed','refunded') then status
        when v_duplicate_transaction or v_duplicate_api_reference then 'manual_review'
        else 'pending'
      end,
      execution_state = case
        when status in ('completed','refunded') then execution_state
        else 'provider_unknown'
      end,
      last_error_code = left(case
        when v_duplicate_transaction then 'duplicate_provider_transaction_id'
        when v_duplicate_api_reference then 'duplicate_api_reference'
        else coalesce(nullif(btrim(p_error_code),''),'pending')
      end,120),
      provider_response = coalesce(p_provider_response,'{}'::jsonb),
      last_verified_at = now()
  where id = v_row.id
  returning * into v_row;

  if v_duplicate_transaction or v_duplicate_api_reference then
    insert into public.payment_provider_alerts(
      provider, alert_type, withdrawal_id, user_id, provider_reference,
      expected_amount, confirmed_amount, details
    ) values (
      'plopplop','duplicate_transaction',v_row.id,v_row.user_id,v_row.provider_reference,
      v_row.amount,null,
      jsonb_build_object(
        'error_code',v_row.last_error_code,
        'provider_transaction_id',v_transaction_id,
        'api_reference',v_api_reference,
        'provider_transaction_id_duplicate',v_duplicate_transaction,
        'api_reference_duplicate',v_duplicate_api_reference
      )
    );
  end if;

  return v_row;
end;
$$;

create or replace function public.complete_plopplop_withdrawal(
  p_withdrawal_id uuid,
  p_user_id uuid,
  p_provider_transaction_id text,
  p_api_reference text,
  p_fee numeric,
  p_provider_total numeric,
  p_provider_response jsonb
)
returns public.plopplop_withdrawals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plopplop_withdrawals%rowtype;
begin
  select * into strict v_row
  from public.plopplop_withdrawals
  where id = p_withdrawal_id and user_id = p_user_id
  for update;

  if v_row.status = 'refunded' then
    raise exception 'Le retrait a déjà été remboursé et nécessite une révision manuelle.';
  end if;
  if v_row.status = 'completed' then
    return v_row;
  end if;
  if nullif(btrim(p_provider_transaction_id),'') is null then
    raise exception 'Identifiant fournisseur requis.';
  end if;

  update public.plopplop_withdrawals
  set provider_transaction_id = btrim(p_provider_transaction_id),
      api_reference = coalesce(nullif(btrim(p_api_reference),''),api_reference),
      fee = p_fee,
      provider_total = p_provider_total,
      status = 'completed',
      execution_state = 'done',
      completed_at = now(),
      last_verified_at = now(),
      last_error_code = null,
      provider_response = coalesce(p_provider_response,'{}'::jsonb)
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.refund_plopplop_withdrawal(
  p_withdrawal_id uuid,
  p_user_id uuid,
  p_error_code text,
  p_provider_response jsonb
)
returns public.plopplop_withdrawals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plopplop_withdrawals%rowtype;
  v_refund_reference text;
begin
  select * into strict v_row
  from public.plopplop_withdrawals
  where id = p_withdrawal_id and user_id = p_user_id
  for update;

  if v_row.status = 'completed' then
    return v_row;
  end if;
  if v_row.status = 'refunded' then
    return v_row;
  end if;
  if v_row.funds_reserved_at is null then
    raise exception 'Aucun fonds réservé à rembourser.';
  end if;

  v_refund_reference := 'withdrawal-plopplop-refund-' || v_row.provider_reference;

  perform public.apply_transaction(
    p_user_id := v_row.user_id,
    p_type := 'deposit',
    p_amount := v_row.amount,
    p_reference := v_refund_reference,
    p_description := 'Remboursement retrait PlopPlop non exécuté',
    p_metadata := jsonb_build_object(
      'provider','plopplop',
      'withdrawal_id',v_row.id,
      'provider_reference',v_row.provider_reference,
      'refund',true,
      'error_code',left(coalesce(p_error_code,'provider_failed'),120)
    )
  );

  update public.plopplop_withdrawals
  set refund_reference = v_refund_reference,
      refunded_at = now(),
      status = 'refunded',
      execution_state = 'done',
      last_error_code = left(coalesce(nullif(btrim(p_error_code),''),'provider_failed'),120),
      provider_response = coalesce(p_provider_response,'{}'::jsonb),
      last_verified_at = now()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.flag_plopplop_withdrawal_manual_review(
  p_withdrawal_id uuid,
  p_user_id uuid,
  p_error_code text,
  p_provider_transaction_id text,
  p_api_reference text,
  p_provider_response jsonb
)
returns public.plopplop_withdrawals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plopplop_withdrawals%rowtype;
  v_transaction_id text := nullif(btrim(p_provider_transaction_id),'');
  v_api_reference text := nullif(btrim(p_api_reference),'');
  v_duplicate_transaction boolean := false;
  v_duplicate_api_reference boolean := false;
begin
  select * into strict v_row
  from public.plopplop_withdrawals
  where id = p_withdrawal_id and user_id = p_user_id
  for update;

  if v_row.status in ('completed','refunded') then
    return v_row;
  end if;

  if v_transaction_id is not null then
    select exists(
      select 1 from public.plopplop_withdrawals w
      where w.provider_transaction_id = v_transaction_id and w.id <> v_row.id
    ) into v_duplicate_transaction;
  end if;
  if v_api_reference is not null then
    select exists(
      select 1 from public.plopplop_withdrawals w
      where w.api_reference = v_api_reference and w.id <> v_row.id
    ) into v_duplicate_api_reference;
  end if;

  update public.plopplop_withdrawals
  set status = 'manual_review',
      execution_state = 'provider_unknown',
      provider_transaction_id = case
        when v_duplicate_transaction then provider_transaction_id
        else coalesce(provider_transaction_id,v_transaction_id)
      end,
      api_reference = case
        when v_duplicate_api_reference then api_reference
        else coalesce(api_reference,v_api_reference)
      end,
      last_error_code = left(coalesce(nullif(btrim(p_error_code),''),'manual_review'),120),
      provider_response = coalesce(p_provider_response,'{}'::jsonb),
      last_verified_at = now()
  where id = v_row.id
  returning * into v_row;

  insert into public.payment_provider_alerts(
    provider, alert_type, withdrawal_id, user_id, provider_reference,
    expected_amount, confirmed_amount, details
  ) values (
    'plopplop',case when v_duplicate_transaction or v_duplicate_api_reference then 'duplicate_transaction' else 'provider_error' end,
    v_row.id,v_row.user_id,v_row.provider_reference,
    v_row.amount,null,
    jsonb_build_object(
      'error_code',left(coalesce(p_error_code,'manual_review'),120),
      'provider_transaction_id',v_transaction_id,
      'api_reference',v_api_reference,
      'provider_transaction_id_duplicate',v_duplicate_transaction,
      'api_reference_duplicate',v_duplicate_api_reference,
      'method',v_row.method,
      'recipient_masked','509*****' || right(v_row.recipient,3)
    )
  );

  return v_row;
end;
$$;

revoke all on function public.create_or_get_plopplop_withdrawal(uuid,uuid,numeric,text,text) from public, anon, authenticated;
revoke all on function public.claim_plopplop_withdrawal_execution(uuid,uuid) from public, anon, authenticated;
revoke all on function public.release_plopplop_withdrawal_execution(uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.mark_plopplop_withdrawal_pending(uuid,uuid,text,text,numeric,numeric,text,jsonb) from public, anon, authenticated;
revoke all on function public.complete_plopplop_withdrawal(uuid,uuid,text,text,numeric,numeric,jsonb) from public, anon, authenticated;
revoke all on function public.refund_plopplop_withdrawal(uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.flag_plopplop_withdrawal_manual_review(uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;

grant execute on function public.create_or_get_plopplop_withdrawal(uuid,uuid,numeric,text,text) to service_role;
grant execute on function public.claim_plopplop_withdrawal_execution(uuid,uuid) to service_role;
grant execute on function public.release_plopplop_withdrawal_execution(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.mark_plopplop_withdrawal_pending(uuid,uuid,text,text,numeric,numeric,text,jsonb) to service_role;
grant execute on function public.complete_plopplop_withdrawal(uuid,uuid,text,text,numeric,numeric,jsonb) to service_role;
grant execute on function public.refund_plopplop_withdrawal(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.flag_plopplop_withdrawal_manual_review(uuid,uuid,text,text,text,jsonb) to service_role;

comment on table public.plopplop_withdrawals is
  'Retraits PlopPlop : fonds réservés avant appel fournisseur, idempotence, vérification et remboursement unique.';
