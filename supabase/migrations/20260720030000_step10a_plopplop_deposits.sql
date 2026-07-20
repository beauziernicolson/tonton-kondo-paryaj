-- Étape 10A — structure sécurisée des dépôts PlopPlop

create table if not exists public.plopplop_deposits (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  provider text not null default 'plopplop' check (provider = 'plopplop'),
  provider_reference text not null,
  provider_transaction_id text,
  amount numeric(18,2) not null check (amount >= 20 and amount = round(amount, 2)),
  confirmed_amount numeric(18,2),
  payment_method text not null check (payment_method in ('moncash','natcash','kashpaw','all')),
  status text not null default 'pending'
    check (status in ('pending','completed','failed','amount_mismatch','manual_review','cancelled')),
  payment_url text,
  credited_at timestamptz,
  provider_response jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_response) = 'object'),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plopplop_deposits_request_id_key unique (request_id),
  constraint plopplop_deposits_provider_reference_key unique (provider_reference),
  constraint plopplop_deposits_completed_credit_check check (
    (status = 'completed' and credited_at is not null and confirmed_amount is not null)
    or status <> 'completed'
  )
);

create unique index if not exists plopplop_deposits_provider_transaction_id_uidx
  on public.plopplop_deposits(provider_transaction_id)
  where provider_transaction_id is not null;
create index if not exists plopplop_deposits_user_id_idx
  on public.plopplop_deposits(user_id);
create index if not exists plopplop_deposits_status_idx
  on public.plopplop_deposits(status);
create index if not exists plopplop_deposits_created_at_idx
  on public.plopplop_deposits(created_at desc);
create index if not exists plopplop_deposits_provider_reference_idx
  on public.plopplop_deposits(provider_reference);

create table if not exists public.payment_provider_alerts (
  id uuid primary key default extensions.gen_random_uuid(),
  provider text not null,
  alert_type text not null
    check (alert_type in ('amount_mismatch','duplicate_transaction','provider_error')),
  deposit_id uuid references public.plopplop_deposits(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  provider_reference text,
  expected_amount numeric(18,2),
  confirmed_amount numeric(18,2),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payment_provider_alerts_created_at_idx
  on public.payment_provider_alerts(created_at desc);
create index if not exists payment_provider_alerts_deposit_id_idx
  on public.payment_provider_alerts(deposit_id);

alter table public.plopplop_deposits enable row level security;
alter table public.payment_provider_alerts enable row level security;

drop policy if exists plopplop_deposits_select_own
  on public.plopplop_deposits;
create policy plopplop_deposits_select_own
on public.plopplop_deposits for select to authenticated
using (user_id = auth.uid());

drop policy if exists plopplop_deposits_select_admin
  on public.plopplop_deposits;
create policy plopplop_deposits_select_admin
on public.plopplop_deposits for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.role in ('admin','super_admin')
  )
);

drop policy if exists payment_provider_alerts_select_admin
  on public.payment_provider_alerts;
create policy payment_provider_alerts_select_admin
on public.payment_provider_alerts for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.role in ('admin','super_admin')
  )
);

revoke all on public.plopplop_deposits from anon, authenticated;
grant select on public.plopplop_deposits to authenticated;
grant all on public.plopplop_deposits to service_role;

revoke all on public.payment_provider_alerts from anon, authenticated;
grant select on public.payment_provider_alerts to authenticated;
grant all on public.payment_provider_alerts to service_role;

create or replace function private.touch_plopplop_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_plopplop_deposits_updated_at
  on public.plopplop_deposits;
create trigger trg_plopplop_deposits_updated_at
before update on public.plopplop_deposits
for each row execute function private.touch_plopplop_updated_at();

create or replace function public.create_or_get_plopplop_deposit(
  p_user_id uuid,
  p_request_id uuid,
  p_amount numeric,
  p_payment_method text
)
returns public.plopplop_deposits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plopplop_deposits%rowtype;
  v_reference text;
begin
  if p_user_id is null or p_request_id is null then
    raise exception 'Utilisateur et request_id requis.';
  end if;

  if p_amount is null or p_amount < 20 or p_amount <> round(p_amount, 2) then
    raise exception 'Le montant minimum est de 20 HTG avec au maximum deux décimales.';
  end if;

  p_payment_method := lower(nullif(btrim(p_payment_method), ''));
  if p_payment_method not in ('moncash','natcash','kashpaw','all') then
    raise exception 'Méthode de paiement invalide.';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.status = 'active'
  ) then
    raise exception 'Compte utilisateur inactif ou introuvable.';
  end if;

  v_reference := 'TKP-PLOP-' || replace(p_request_id::text, '-', '');

  insert into public.plopplop_deposits(
    user_id, request_id, provider_reference, amount, payment_method, status
  )
  values (
    p_user_id, p_request_id, v_reference, p_amount, p_payment_method, 'pending'
  )
  on conflict (request_id) do nothing;

  select *
  into strict v_row
  from public.plopplop_deposits
  where request_id = p_request_id
  for update;

  if v_row.user_id <> p_user_id
     or v_row.amount <> p_amount
     or v_row.payment_method <> p_payment_method then
    raise exception 'Ce request_id existe déjà avec des paramètres différents.';
  end if;

  return v_row;
end;
$$;

create or replace function public.update_plopplop_creation(
  p_deposit_id uuid,
  p_user_id uuid,
  p_provider_transaction_id text,
  p_payment_url text,
  p_provider_response jsonb
)
returns public.plopplop_deposits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plopplop_deposits%rowtype;
begin
  select *
  into strict v_row
  from public.plopplop_deposits
  where id = p_deposit_id and user_id = p_user_id
  for update;

  if v_row.status = 'completed' then
    return v_row;
  end if;

  if nullif(btrim(p_payment_url), '') is null then
    raise exception 'URL de paiement absente.';
  end if;

  update public.plopplop_deposits
  set provider_transaction_id =
        coalesce(nullif(btrim(p_provider_transaction_id), ''), provider_transaction_id),
      payment_url = btrim(p_payment_url),
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      status = 'pending'
  where id = p_deposit_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.mark_plopplop_pending(
  p_deposit_id uuid,
  p_user_id uuid,
  p_provider_transaction_id text,
  p_confirmed_amount numeric,
  p_provider_response jsonb
)
returns public.plopplop_deposits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plopplop_deposits%rowtype;
begin
  update public.plopplop_deposits
  set provider_transaction_id =
        coalesce(nullif(btrim(p_provider_transaction_id), ''), provider_transaction_id),
      confirmed_amount = coalesce(p_confirmed_amount, confirmed_amount),
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      last_verified_at = now(),
      status = case when status = 'completed' then status else 'pending' end
  where id = p_deposit_id and user_id = p_user_id
  returning * into strict v_row;

  return v_row;
end;
$$;

create or replace function public.flag_plopplop_amount_mismatch(
  p_deposit_id uuid,
  p_user_id uuid,
  p_provider_transaction_id text,
  p_confirmed_amount numeric,
  p_provider_response jsonb
)
returns public.plopplop_deposits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plopplop_deposits%rowtype;
begin
  select *
  into strict v_row
  from public.plopplop_deposits
  where id = p_deposit_id and user_id = p_user_id
  for update;

  if v_row.status = 'completed' then
    return v_row;
  end if;

  update public.plopplop_deposits
  set provider_transaction_id =
        coalesce(nullif(btrim(p_provider_transaction_id), ''), provider_transaction_id),
      confirmed_amount = p_confirmed_amount,
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      last_verified_at = now(),
      status = 'amount_mismatch'
  where id = p_deposit_id
  returning * into v_row;

  insert into public.payment_provider_alerts(
    provider, alert_type, deposit_id, user_id, provider_reference,
    expected_amount, confirmed_amount, details
  )
  values (
    'plopplop', 'amount_mismatch', v_row.id, v_row.user_id,
    v_row.provider_reference, v_row.amount, p_confirmed_amount,
    jsonb_build_object('payment_method', v_row.payment_method)
  );

  return v_row;
end;
$$;

create or replace function public.complete_plopplop_deposit(
  p_deposit_id uuid,
  p_user_id uuid,
  p_provider_transaction_id text,
  p_confirmed_amount numeric,
  p_provider_response jsonb
)
returns public.plopplop_deposits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plopplop_deposits%rowtype;
  v_financial_reference text;
begin
  select *
  into strict v_row
  from public.plopplop_deposits
  where id = p_deposit_id and user_id = p_user_id
  for update;

  if v_row.status = 'completed' then
    return v_row;
  end if;

  if p_confirmed_amount is null or p_confirmed_amount <> v_row.amount then
    raise exception 'Le montant confirmé ne correspond pas au montant attendu.';
  end if;

  if nullif(btrim(p_provider_transaction_id), '') is null then
    raise exception 'Identifiant de transaction fournisseur requis.';
  end if;

  if exists (
    select 1
    from public.plopplop_deposits d
    where d.provider_transaction_id = btrim(p_provider_transaction_id)
      and d.id <> v_row.id
  ) then
    insert into public.payment_provider_alerts(
      provider, alert_type, deposit_id, user_id, provider_reference,
      expected_amount, confirmed_amount, details
    )
    values (
      'plopplop', 'duplicate_transaction', v_row.id, v_row.user_id,
      v_row.provider_reference, v_row.amount, p_confirmed_amount,
      jsonb_build_object('reason','provider_transaction_id_already_used')
    );

    raise exception 'Identifiant de transaction fournisseur déjà utilisé.';
  end if;

  v_financial_reference := 'deposit-plopplop-' || v_row.provider_reference;

  perform public.apply_transaction(
    p_user_id := v_row.user_id,
    p_type := 'deposit',
    p_amount := v_row.amount,
    p_reference := v_financial_reference,
    p_description := 'Dépôt PlopPlop confirmé',
    p_metadata := jsonb_build_object(
      'provider','plopplop',
      'deposit_id',v_row.id,
      'provider_reference',v_row.provider_reference,
      'provider_transaction_id',btrim(p_provider_transaction_id),
      'payment_method',v_row.payment_method
    )
  );

  update public.plopplop_deposits
  set provider_transaction_id = btrim(p_provider_transaction_id),
      confirmed_amount = p_confirmed_amount,
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      last_verified_at = now(),
      status = 'completed',
      credited_at = now()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_or_get_plopplop_deposit(uuid,uuid,numeric,text)
  from public, anon, authenticated;
revoke all on function public.update_plopplop_creation(uuid,uuid,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.mark_plopplop_pending(uuid,uuid,text,numeric,jsonb)
  from public, anon, authenticated;
revoke all on function public.flag_plopplop_amount_mismatch(uuid,uuid,text,numeric,jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_plopplop_deposit(uuid,uuid,text,numeric,jsonb)
  from public, anon, authenticated;

grant execute on function public.create_or_get_plopplop_deposit(uuid,uuid,numeric,text)
  to service_role;
grant execute on function public.update_plopplop_creation(uuid,uuid,text,text,jsonb)
  to service_role;
grant execute on function public.mark_plopplop_pending(uuid,uuid,text,numeric,jsonb)
  to service_role;
grant execute on function public.flag_plopplop_amount_mismatch(uuid,uuid,text,numeric,jsonb)
  to service_role;
grant execute on function public.complete_plopplop_deposit(uuid,uuid,text,numeric,jsonb)
  to service_role;

comment on table public.plopplop_deposits is
  'Dépôts PlopPlop idempotents. Écriture réservée aux Edge Functions; lecture personnelle via RLS.';
comment on column public.plopplop_deposits.provider_response is
  'Réponse fournisseur nettoyée, sans secrets, JWT, cookies ni en-têtes Authorization.';
