create or replace function public.flag_plopplop_manual_review(
  p_deposit_id uuid,
  p_user_id uuid,
  p_alert_type text,
  p_error_code text,
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
  v_alert_type text;
  v_clean_transaction_id text;
  v_transaction_is_duplicate boolean := false;
begin
  v_alert_type := case
    when p_alert_type in ('duplicate_transaction','provider_error') then p_alert_type
    else 'provider_error'
  end;
  v_clean_transaction_id := nullif(btrim(p_provider_transaction_id), '');

  select * into strict v_row
  from public.plopplop_deposits
  where id = p_deposit_id and user_id = p_user_id
  for update;

  if v_row.status = 'completed' then
    return v_row;
  end if;

  if v_clean_transaction_id is not null then
    select exists (
      select 1
      from public.plopplop_deposits d
      where d.provider_transaction_id = v_clean_transaction_id
        and d.id <> v_row.id
    ) into v_transaction_is_duplicate;
  end if;

  update public.plopplop_deposits
  set provider_transaction_id = case
        when v_transaction_is_duplicate then provider_transaction_id
        else coalesce(v_clean_transaction_id, provider_transaction_id)
      end,
      confirmed_amount = coalesce(p_confirmed_amount, confirmed_amount),
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      last_verified_at = now(),
      last_error_code = left(coalesce(nullif(btrim(p_error_code),''),'manual_review'),120),
      status = 'manual_review'
  where id = v_row.id
  returning * into v_row;

  insert into public.payment_provider_alerts(
    provider,
    alert_type,
    deposit_id,
    user_id,
    provider_reference,
    expected_amount,
    confirmed_amount,
    details
  ) values (
    'plopplop',
    case when v_transaction_is_duplicate then 'duplicate_transaction' else v_alert_type end,
    v_row.id,
    v_row.user_id,
    v_row.provider_reference,
    v_row.amount,
    p_confirmed_amount,
    jsonb_build_object(
      'error_code', left(coalesce(p_error_code,'manual_review'),120),
      'provider_transaction_id', v_clean_transaction_id,
      'provider_transaction_id_duplicate', v_transaction_is_duplicate
    )
  );

  return v_row;
end;
$$;

revoke all on function public.flag_plopplop_manual_review(uuid,uuid,text,text,text,numeric,jsonb)
from public, anon, authenticated;
grant execute on function public.flag_plopplop_manual_review(uuid,uuid,text,text,text,numeric,jsonb)
to service_role;
