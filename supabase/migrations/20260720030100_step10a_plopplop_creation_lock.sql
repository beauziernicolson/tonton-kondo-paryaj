-- Étape 10A — verrou de création fournisseur pour empêcher deux appels simultanés

alter table public.plopplop_deposits
  add column if not exists creation_state text not null default 'new'
    check (creation_state in ('new','processing','ready','error')),
  add column if not exists creation_started_at timestamptz,
  add column if not exists last_error_code text;

create or replace function public.claim_plopplop_creation(
  p_deposit_id uuid,
  p_user_id uuid
)
returns jsonb
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

  if v_row.payment_url is not null and length(btrim(v_row.payment_url)) > 0 then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'ready',
      'deposit', to_jsonb(v_row)
    );
  end if;

  if v_row.creation_state = 'processing'
     and v_row.creation_started_at is not null
     and v_row.creation_started_at > now() - interval '2 minutes' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'processing',
      'deposit', to_jsonb(v_row)
    );
  end if;

  update public.plopplop_deposits
  set creation_state = 'processing',
      creation_started_at = now(),
      last_error_code = null
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'claimed', true,
    'reason', 'claimed',
    'deposit', to_jsonb(v_row)
  );
end;
$$;

create or replace function public.fail_plopplop_creation(
  p_deposit_id uuid,
  p_user_id uuid,
  p_error_code text,
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
  set creation_state = 'error',
      last_error_code =
        left(coalesce(nullif(btrim(p_error_code),''),'provider_error'),120),
      provider_response = coalesce(p_provider_response,'{}'::jsonb)
  where id = p_deposit_id
    and user_id = p_user_id
    and status <> 'completed'
  returning * into strict v_row;

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
      status = 'pending',
      creation_state = 'ready',
      last_error_code = null
  where id = p_deposit_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.claim_plopplop_creation(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.fail_plopplop_creation(uuid,uuid,text,jsonb)
  from public, anon, authenticated;

grant execute on function public.claim_plopplop_creation(uuid,uuid)
  to service_role;
grant execute on function public.fail_plopplop_creation(uuid,uuid,text,jsonb)
  to service_role;
