-- Étape 10A — tests atomiques de la couche financière PlopPlop.
-- À exécuter uniquement dans un environnement contrôlé.
-- Le script termine par ROLLBACK et ne doit laisser aucune écriture.

begin;

create temporary table step10a_results(
  test_name text,
  passed boolean,
  details jsonb
) on commit drop;

do $$
declare
  v_user uuid;
  v_wallet_id uuid;
  v_balance_before numeric;
  v_balance_after numeric;
  v_d1 public.plopplop_deposits%rowtype;
  v_d1_replay public.plopplop_deposits%rowtype;
  v_d2 public.plopplop_deposits%rowtype;
  v_d3 public.plopplop_deposits%rowtype;
  v_claim1 jsonb;
  v_claim2 jsonb;
  v_complete public.plopplop_deposits%rowtype;
  v_tx_count integer;
  v_alert_count integer;
  v_blocked boolean;
begin
  select w.user_id, w.id, w.balance
    into strict v_user, v_wallet_id, v_balance_before
  from public.wallets w
  where w.status='active'
  order by w.created_at, w.id
  limit 1;

  v_blocked := false;
  begin
    perform public.create_or_get_plopplop_deposit(v_user,'7064f225-f2b9-4709-955a-acc798ae3825'::uuid,19,'moncash');
  exception when others then v_blocked := true;
  end;
  insert into step10a_results values ('amount_below_20',v_blocked,jsonb_build_object('blocked',v_blocked));

  v_blocked := false;
  begin
    perform public.create_or_get_plopplop_deposit(v_user,'7064f225-f2b9-4709-955a-acc798ae3825'::uuid,20,'manual');
  exception when others then v_blocked := true;
  end;
  insert into step10a_results values ('invalid_method',v_blocked,jsonb_build_object('blocked',v_blocked));

  v_d1 := public.create_or_get_plopplop_deposit(v_user,'5e5adebc-29e2-4b71-b7a4-298b157281ac'::uuid,20,'moncash');
  v_d1_replay := public.create_or_get_plopplop_deposit(v_user,'5e5adebc-29e2-4b71-b7a4-298b157281ac'::uuid,20,'moncash');
  insert into step10a_results values ('same_request_id_same_deposit',v_d1.id=v_d1_replay.id,
    jsonb_build_object('same_id',v_d1.id=v_d1_replay.id,'provider_reference_same',v_d1.provider_reference=v_d1_replay.provider_reference));

  v_blocked := false;
  begin
    perform public.create_or_get_plopplop_deposit(v_user,'5e5adebc-29e2-4b71-b7a4-298b157281ac'::uuid,25,'moncash');
  exception when others then v_blocked := true;
  end;
  insert into step10a_results values ('same_request_different_amount',v_blocked,jsonb_build_object('blocked',v_blocked));

  v_blocked := false;
  begin
    perform public.create_or_get_plopplop_deposit(v_user,'5e5adebc-29e2-4b71-b7a4-298b157281ac'::uuid,20,'natcash');
  exception when others then v_blocked := true;
  end;
  insert into step10a_results values ('same_request_different_method',v_blocked,jsonb_build_object('blocked',v_blocked));

  v_claim1 := public.claim_plopplop_creation(v_d1.id,v_user);
  v_claim2 := public.claim_plopplop_creation(v_d1.id,v_user);
  insert into step10a_results values ('double_click_creation_lock',
    coalesce((v_claim1->>'claimed')::boolean,false)=true and coalesce((v_claim2->>'claimed')::boolean,true)=false,
    jsonb_build_object('first_claimed',v_claim1->>'claimed','second_claimed',v_claim2->>'claimed','second_reason',v_claim2->>'reason'));

  v_d1 := public.update_plopplop_creation(v_d1.id,v_user,'PP-STEP10A-TX-001',
    'https://plopplop.solutionip.app/pay/step10a-test',jsonb_build_object('transaction_id','PP-STEP10A-TX-001'));

  v_complete := public.complete_plopplop_deposit(v_d1.id,v_user,'PP-STEP10A-TX-001',20,
    jsonb_build_object('trans_status','ok','transaction_id','PP-STEP10A-TX-001','montant',20));
  for i in 1..10 loop
    v_complete := public.complete_plopplop_deposit(v_d1.id,v_user,'PP-STEP10A-TX-001',20,
      jsonb_build_object('trans_status','ok','transaction_id','PP-STEP10A-TX-001','montant',20));
  end loop;

  select count(*) into v_tx_count from public.transactions
  where reference='deposit-plopplop-'||v_d1.provider_reference;
  select balance into v_balance_after from public.wallets where id=v_wallet_id;
  insert into step10a_results values ('ten_verifications_single_credit',
    v_tx_count=1 and v_balance_after-v_balance_before=20 and v_complete.status='completed' and v_complete.credited_at is not null,
    jsonb_build_object('transaction_count',v_tx_count,'balance_delta',v_balance_after-v_balance_before,
      'status',v_complete.status,'credited_at_set',v_complete.credited_at is not null));

  v_d2 := public.create_or_get_plopplop_deposit(v_user,'603e460d-a07f-4455-80d9-c5602c8f55b8'::uuid,30,'natcash');
  v_d2 := public.update_plopplop_creation(v_d2.id,v_user,'PP-STEP10A-TX-002',
    'https://plopplop.solutionip.app/pay/step10a-test-2',jsonb_build_object('transaction_id','PP-STEP10A-TX-002'));
  v_d2 := public.flag_plopplop_amount_mismatch(v_d2.id,v_user,'PP-STEP10A-TX-002',35,
    jsonb_build_object('trans_status','ok','transaction_id','PP-STEP10A-TX-002','montant',35));
  select count(*) into v_alert_count from public.payment_provider_alerts
  where deposit_id=v_d2.id and alert_type='amount_mismatch';
  insert into step10a_results values ('amount_mismatch_no_credit_alert',
    v_d2.status='amount_mismatch' and v_d2.credited_at is null and v_alert_count=1,
    jsonb_build_object('status',v_d2.status,'credited',v_d2.credited_at is not null,'alerts',v_alert_count));

  v_d3 := public.create_or_get_plopplop_deposit(v_user,'7064f225-f2b9-4709-955a-acc798ae3825'::uuid,40,'kashpaw');
  v_d3 := public.update_plopplop_creation(v_d3.id,v_user,'PP-STEP10A-TX-003',
    'https://plopplop.solutionip.app/pay/step10a-test-3',jsonb_build_object('transaction_id','PP-STEP10A-TX-003'));
  v_blocked := false;
  begin
    perform public.complete_plopplop_deposit(v_d3.id,v_user,'PP-STEP10A-TX-001',40,
      jsonb_build_object('trans_status','ok','transaction_id','PP-STEP10A-TX-001','montant',40));
  exception when others then v_blocked := true;
  end;
  select count(*) into v_tx_count from public.transactions
  where reference='deposit-plopplop-'||v_d3.provider_reference;
  insert into step10a_results values ('duplicate_provider_transaction_blocked',v_blocked and v_tx_count=0,
    jsonb_build_object('blocked',v_blocked,'credit_transactions',v_tx_count));

  insert into step10a_results values ('unknown_reference_no_credit',
    not exists(select 1 from public.plopplop_deposits where provider_reference='UNKNOWN-STEP10A-REFERENCE'),
    jsonb_build_object('deposit_created',exists(select 1 from public.plopplop_deposits where provider_reference='UNKNOWN-STEP10A-REFERENCE')));
end;
$$;

select * from step10a_results order by test_name;
rollback;
