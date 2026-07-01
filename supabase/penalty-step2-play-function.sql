CREATE OR REPLACE FUNCTION public.play_penalty(
  p_user_id UUID,
  p_bets JSONB
)
RETURNS TABLE (
  ticket_id UUID,
  ticket_number TEXT,
  round_id UUID,
  result_type TEXT,
  result_value TEXT,
  result_label TEXT,
  total_bet_amount NUMERIC,
  total_win_amount NUMERIC,
  status TEXT,
  bets JSONB,
  result JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := p_user_id;
  v_bets JSONB := p_bets;
  v_bets_array JSONB;
  v_bet JSONB;
  v_bet_type TEXT;
  v_bet_value TEXT;
  v_bet_amount NUMERIC;
  v_bet_label TEXT;
  v_total_bet_amount NUMERIC := 0;
  v_total_win_amount NUMERIC := 0;
  v_wallet_balance NUMERIC;
  v_result_type TEXT;
  v_result_value TEXT;
  v_result_label TEXT;
  v_result_color TEXT;
  v_ticket_id UUID;
  v_ticket_number TEXT;
  v_round_id UUID;
  v_status TEXT;
  v_outcome TEXT;
  v_payout_multiplier NUMERIC;
  v_win_amount NUMERIC;
  v_ticket_item_status TEXT;
  v_result_json JSONB;
  v_bets_result JSONB := '[]'::jsonb;
  v_index INT := 0;
  v_rand NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id est requis.';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> v_user_id THEN
    RAISE EXCEPTION 'Utilisateur non autorisé.';
  END IF;

  IF v_bets IS NULL THEN
    RAISE EXCEPTION 'p_bets ne peut pas être NULL.';
  END IF;

  IF jsonb_typeof(v_bets) <> 'object' THEN
    RAISE EXCEPTION 'p_bets doit être un objet JSONB.';
  END IF;

  IF NOT v_bets ? 'bets' THEN
    RAISE EXCEPTION 'p_bets doit contenir la clé "bets".';
  END IF;

  IF jsonb_typeof(v_bets -> 'bets') <> 'array' THEN
    RAISE EXCEPTION 'p_bets->"bets" doit être un tableau JSONB.';
  END IF;

  IF jsonb_array_length(v_bets -> 'bets') = 0 THEN
    RAISE EXCEPTION 'p_bets->"bets" ne peut pas être vide.';
  END IF;

  v_bets_array := v_bets -> 'bets';

  SELECT w.balance
    INTO v_wallet_balance
    FROM public.wallets w
   WHERE w.user_id = v_user_id
   LIMIT 1;

  IF v_wallet_balance IS NULL THEN
    RAISE EXCEPTION 'Aucun wallet trouvé pour cet utilisateur.';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS temp_penalty_bets (
    bet_type TEXT,
    bet_value TEXT,
    bet_label TEXT,
    amount NUMERIC,
    payout_multiplier NUMERIC,
    outcome TEXT,
    win_amount NUMERIC
  ) ON COMMIT DROP;

  FOR v_index IN 0 .. jsonb_array_length(v_bets_array) - 1 LOOP
    v_bet := v_bets_array -> v_index;

    IF jsonb_typeof(v_bet) <> 'object' THEN
      RAISE EXCEPTION 'Chaque élément de p_bets->"bets" doit être un objet.';
    END IF;

    v_bet_type := v_bet ->> 'type';
    v_bet_value := v_bet ->> 'value';

    IF v_bet_type IS NULL OR v_bet_type = '' THEN
      RAISE EXCEPTION 'Chaque mise doit contenir un type valide.';
    END IF;

    IF v_bet_value IS NULL OR v_bet_value = '' THEN
      RAISE EXCEPTION 'Chaque mise doit contenir une valeur valide.';
    END IF;

    IF NOT (jsonb_typeof(v_bet -> 'amount') = 'number') THEN
      RAISE EXCEPTION 'Le montant de chaque mise doit être numérique.';
    END IF;

    v_bet_amount := (v_bet ->> 'amount')::numeric;
    IF v_bet_amount IS NULL OR v_bet_amount <= 0 THEN
      RAISE EXCEPTION 'Le montant de la mise doit être supérieur à 0.';
    END IF;

    IF v_bet_type = 'sector' THEN
      IF v_bet_value !~ '^[0-9]+$' OR (v_bet_value::int NOT BETWEEN 1 AND 24) THEN
        RAISE EXCEPTION 'Valeur de secteur invalide : %', v_bet_value;
      END IF;
      v_bet_label := 'Secteur ' || v_bet_value;
    ELSIF v_bet_type = 'range' THEN
      IF v_bet_value NOT IN ('1-8', '9-16', '17-24') THEN
        RAISE EXCEPTION 'Valeur de range invalide : %', v_bet_value;
      END IF;
      v_bet_label := v_bet_value;
    ELSIF v_bet_type = 'color' THEN
      IF v_bet_value NOT IN ('yellow', 'blue') THEN
        RAISE EXCEPTION 'Valeur de color invalide : %', v_bet_value;
      END IF;
      v_bet_label := CASE
        WHEN v_bet_value = 'yellow' THEN 'Jòn'
        ELSE 'Blu'
      END;
    ELSIF v_bet_type = 'event' THEN
      IF v_bet_value NOT IN ('post', 'miss') THEN
        RAISE EXCEPTION 'Valeur de event invalide : %', v_bet_value;
      END IF;
      v_bet_label := CASE
        WHEN v_bet_value = 'post' THEN 'Poto'
        ELSE 'Rate/Kenbe'
      END;
    ELSIF v_bet_type = 'random' THEN
      IF v_bet_value <> 'random' THEN
        RAISE EXCEPTION 'Valeur de random invalide : %', v_bet_value;
      END IF;
      v_bet_label := 'Hasard';
    ELSE
      RAISE EXCEPTION 'Type de mise non supporté : %', v_bet_type;
    END IF;

    v_total_bet_amount := v_total_bet_amount + v_bet_amount;
  END LOOP;

  IF v_wallet_balance < v_total_bet_amount THEN
    RAISE EXCEPTION 'Solde insuffisant pour jouer au Penalty.';
  END IF;

  v_rand := random();
  IF v_rand < 0.10 THEN
    v_result_type := 'event';
    v_result_value := 'post';
    v_result_label := 'Poto';
    v_result_color := NULL;
  ELSIF v_rand < 0.20 THEN
    v_result_type := 'event';
    v_result_value := 'miss';
    v_result_label := 'Rate/Kenbe';
    v_result_color := NULL;
  ELSE
    v_result_type := 'sector';
    v_result_value := ((floor(random() * 24)::int) + 1)::text;
    v_result_label := 'Secteur ' || v_result_value;
    v_result_color := CASE
      WHEN v_result_value::int IN (2,4,6,8,9,11,13,15,18,20,22,24) THEN 'yellow'
      ELSE 'blue'
    END;
  END IF;

  v_result_json := jsonb_strip_nulls(jsonb_build_object(
    'type', v_result_type,
    'value', v_result_value,
    'label', v_result_label,
    'color', v_result_color
  ));

  FOR v_index IN 0 .. jsonb_array_length(v_bets_array) - 1 LOOP
    v_bet := v_bets_array -> v_index;
    v_bet_type := v_bet ->> 'type';
    v_bet_value := v_bet ->> 'value';
    v_bet_amount := (v_bet ->> 'amount')::numeric;

    v_outcome := 'lost';
    v_payout_multiplier := 0;
    v_win_amount := 0;

    IF v_bet_type = 'sector' THEN
      v_payout_multiplier := 20;
      IF v_result_type = 'sector' AND v_result_value = v_bet_value THEN
        v_outcome := 'won';
        v_win_amount := v_bet_amount * v_payout_multiplier;
      END IF;
    ELSIF v_bet_type = 'range' THEN
      v_payout_multiplier := 2.5;
      IF v_result_type = 'sector' THEN
        IF v_bet_value = '1-8' AND v_result_value::int BETWEEN 1 AND 8 THEN
          v_outcome := 'won';
        ELSIF v_bet_value = '9-16' AND v_result_value::int BETWEEN 9 AND 16 THEN
          v_outcome := 'won';
        ELSIF v_bet_value = '17-24' AND v_result_value::int BETWEEN 17 AND 24 THEN
          v_outcome := 'won';
        END IF;
        IF v_outcome = 'won' THEN
          v_win_amount := v_bet_amount * v_payout_multiplier;
        END IF;
      END IF;
    ELSIF v_bet_type = 'color' THEN
      v_payout_multiplier := 1.8;
      IF v_result_type = 'sector' AND v_result_color = v_bet_value THEN
        v_outcome := 'won';
        v_win_amount := v_bet_amount * v_payout_multiplier;
      END IF;
    ELSIF v_bet_type = 'event' THEN
      v_payout_multiplier := CASE
        WHEN v_bet_value = 'post' THEN 5
        ELSE 3
      END;
      IF v_result_type = 'event' AND v_result_value = v_bet_value THEN
        v_outcome := 'won';
        v_win_amount := v_bet_amount * v_payout_multiplier;
      END IF;
    ELSIF v_bet_type = 'random' THEN
      v_payout_multiplier := 1.5;
      IF v_result_type = 'sector' THEN
        v_outcome := 'won';
        v_win_amount := v_bet_amount * v_payout_multiplier;
      END IF;
    END IF;

    IF v_outcome = 'won' THEN
      v_ticket_item_status := 'paid';
    ELSE
      v_ticket_item_status := 'lost';
    END IF;

    v_total_win_amount := v_total_win_amount + v_win_amount;

    INSERT INTO temp_penalty_bets (
      bet_type,
      bet_value,
      bet_label,
      amount,
      payout_multiplier,
      outcome,
      win_amount
    ) VALUES (
      v_bet_type,
      v_bet_value,
      CASE
        WHEN v_bet_type = 'sector' THEN 'Secteur ' || v_bet_value
        WHEN v_bet_type = 'range' THEN v_bet_value
        WHEN v_bet_type = 'color' AND v_bet_value = 'yellow' THEN 'Jòn'
        WHEN v_bet_type = 'color' THEN 'Blu'
        WHEN v_bet_type = 'event' AND v_bet_value = 'post' THEN 'Poto'
        WHEN v_bet_type = 'event' THEN 'Rate/Kenbe'
        ELSE 'Hasard'
      END,
      v_bet_amount,
      v_payout_multiplier,
      v_outcome,
      v_win_amount
    );
  END LOOP;

  v_status := CASE WHEN v_total_win_amount > 0 THEN 'paid' ELSE 'lost' END;
  v_ticket_number := 'TKPEN-' || to_char(NOW(), 'YYYYMMDD-HH24MISS') || '-' || substring(md5(random()::text) FROM 1 FOR 6);

  INSERT INTO public.tickets (
    ticket_number,
    user_id,
    game_type,
    total_amount,
    status
  ) VALUES (
    v_ticket_number,
    v_user_id,
    'penalty',
    v_total_bet_amount,
    v_status
  ) RETURNING id INTO v_ticket_id;

  INSERT INTO public.ticket_items (
    ticket_id,
    number_played,
    amount,
    potential_win,
    status
  )
  SELECT
    v_ticket_id,
    bet_label,
    amount,
    win_amount,
    CASE WHEN outcome = 'won' THEN 'paid' ELSE 'lost' END
  FROM temp_penalty_bets;

  PERFORM public.apply_transaction(
    p_user_id := v_user_id,
    p_type := 'bet',
    p_amount := v_total_bet_amount,
    p_reference := 'bet-penalty-' || v_ticket_number,
    p_description := 'Mise Penalty',
    p_metadata := jsonb_build_object(
      'game_type', 'penalty',
      'ticket_number', v_ticket_number,
      'bets', v_bets_array,
      'result', v_result_json
    )
  );

  IF v_total_win_amount > 0 THEN
    PERFORM public.apply_transaction(
      p_user_id := v_user_id,
      p_type := 'win',
      p_amount := v_total_win_amount,
      p_reference := 'win-penalty-' || v_ticket_number,
      p_description := 'Gain Penalty',
      p_metadata := jsonb_build_object(
        'game_type', 'penalty',
        'ticket_number', v_ticket_number,
        'bets', v_bets_array,
        'result', v_result_json,
        'total_win_amount', v_total_win_amount
      )
    );
  END IF;

  INSERT INTO public.penalty_rounds (
    user_id,
    ticket_id,
    total_bet_amount,
    total_win_amount,
    result_type,
    result_value,
    result_label,
    status,
    metadata
  ) VALUES (
    v_user_id,
    v_ticket_id,
    v_total_bet_amount,
    v_total_win_amount,
    v_result_type,
    v_result_value,
    v_result_label,
    v_status,
    jsonb_build_object(
      'game_type', 'penalty',
      'ticket_number', v_ticket_number,
      'bets', v_bets_array,
      'result', v_result_json
    )
  ) RETURNING id INTO v_round_id;

  INSERT INTO public.penalty_bets (
    round_id,
    user_id,
    ticket_id,
    bet_type,
    bet_value,
    bet_label,
    amount,
    payout_multiplier,
    outcome,
    win_amount
  )
  SELECT
    v_round_id,
    v_user_id,
    v_ticket_id,
    bet_type,
    bet_value,
    bet_label,
    amount,
    payout_multiplier,
    outcome,
    win_amount
  FROM temp_penalty_bets;

  SELECT jsonb_agg(
    jsonb_build_object(
      'bet_type', bet_type,
      'bet_value', bet_value,
      'bet_label', bet_label,
      'amount', amount,
      'payout_multiplier', payout_multiplier,
      'outcome', outcome,
      'win_amount', win_amount
    )
  )
  INTO v_bets_result
  FROM temp_penalty_bets;

  RETURN QUERY
  SELECT
    v_ticket_id,
    v_ticket_number,
    v_round_id,
    v_result_type,
    v_result_value,
    v_result_label,
    v_total_bet_amount,
    v_total_win_amount,
    v_status,
    v_bets_result,
    v_result_json;
END;
$$;
