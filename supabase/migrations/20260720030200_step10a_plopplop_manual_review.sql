-- Étape 10A — révision manuelle en cas de réponse fournisseur incohérente

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
begin
  v_alert_type :=
    case
      when p_alert_type in ('duplicate_transaction','provider_error')
        then p_alert_type
      else 'provider_error'
    end;

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
        coalesce(nullif(btrim(p_provider_transaction_id),''),provider_transaction_id),
      confirmed_amount = coalesce(p_confirmed_amount,confirmed_amount),
      provider_response = coalesce(p_provider_response,'{}'::jsonb),
      last_verified_at = now(),
      last_error_code =
        left(coalesce(nullif(btrim(p_error_code),''),'manual_review'),120),
      status = 'manual_review'
  where id = v_row.id
  returning * into v_row;

  insert into public.payment_provider_alerts(
    provider, alert_type, deposit_id, user_id, provider_reference,
    expected_amount, confirmed_amount, details
  )
  values (
    'plopplop', v_alert_type, v_row.id, v_row.user_id,
    v_row.provider_reference, v_row.amount, p_confirmed_amount,
    jsonb_build_object(
      'error_code',
      left(coalesce(p_error_code,'manual_review'),120)
    )
  );

  return v_row;
end;
$$;

revoke all on function public.flag_plopplop_manual_review(
  uuid,uuid,text,text,text,numeric,jsonb
) from public, anon, authenticated;

grant execute on function public.flag_plopplop_manual_review(
  uuid,uuid,text,text,text,numeric,jsonb
) to service_role;
