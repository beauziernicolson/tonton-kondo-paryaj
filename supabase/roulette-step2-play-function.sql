CREATE OR REPLACE FUNCTION public.play_roulette(
  p_user_id UUID,
  p_bets JSONB
)
RETURNS TABLE (
  ticket_id UUID,
  ticket_number TEXT,
  round_id UUID,
  winning_number INT,
  winning_color TEXT,
  total_bet_amount NUMERIC,
  total_win_amount NUMERIC,
  status TEXT,
  bets JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := p_user_id;
  v_bets JSONB := p_bets;
  v_bets_obj JSONB;
  v_bet_keys TEXT[];
  v_bet_key TEXT;
  v_bet_value JSONB;
  v_amount NUMERIC;
  v_total_bet_amount NUMERIC := 0;
  v_total_win_amount NUMERIC := 0;
  v_winning_number INT;
  v_winning_color TEXT;
  v_status TEXT;
  v_ticket_id UUID;
  v_ticket_number TEXT;
  v_round_id UUID;
  v_wallet_balance NUMERIC;
  v_bet_label TEXT;
  v_bet_type TEXT;
  v_bet_value_text TEXT;
  v_payout_multiplier NUMERIC;
  v_outcome TEXT;
  v_win_amount NUMERIC;
  v_bet_number INT;
  v_bet_item JSONB;
  v_bets_result JSONB := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id ne peut pas être NULL.';
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

  v_bets_obj := v_bets;
  v_bet_keys := ARRAY(
    SELECT jsonb_object_keys(v_bets_obj)
    ORDER BY 1
  );

  IF array_length(v_bet_keys, 1) IS NULL OR array_length(v_bet_keys, 1) < 1 THEN
    RAISE EXCEPTION 'Au moins une mise est requise.';
  END IF;

  SELECT w.balance
    INTO v_wallet_balance
    FROM public.wallets w
   WHERE w.user_id = v_user_id
   LIMIT 1;

  IF v_wallet_balance IS NULL THEN
    RAISE EXCEPTION 'Aucun wallet trouvé pour cet utilisateur.';
  END IF;

  FOREACH v_bet_key IN ARRAY v_bet_keys
  LOOP
    IF NOT (
      v_bet_key IN ('red', 'black', 'even', 'odd', 'low', 'high', 'dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3')
      OR left(v_bet_key, 2) = 'n:'
    ) THEN
      RAISE EXCEPTION 'Clé de mise non supportée : %', v_bet_key;
    END IF;

    v_bet_value := v_bets_obj -> v_bet_key;

    IF left(v_bet_key, 2) = 'n:' THEN
      IF length(substring(v_bet_key from 3)) = 0 THEN
        RAISE EXCEPTION 'La mise exacte % est invalide.', v_bet_key;
      END IF;

    IF substring(v_bet_key from 3) !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'La mise exacte % est invalide.', v_bet_key;
     END IF;

      IF CAST(substring(v_bet_key from 3) AS INT) NOT BETWEEN 0 AND 36 THEN
        RAISE EXCEPTION 'La mise exacte % est invalide.', v_bet_key;
      END IF;
    END IF;

    IF jsonb_typeof(v_bet_value) <> 'number' THEN
      RAISE EXCEPTION 'Le montant de la mise % doit être numérique.', v_bet_key;
    END IF;

    v_amount := (v_bet_value #>> '{}')::numeric;

    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Le montant de la mise % doit être strictement positif.', v_bet_key;
    END IF;

    v_total_bet_amount := v_total_bet_amount + v_amount;
  END LOOP;

  IF v_wallet_balance < v_total_bet_amount THEN
    RAISE EXCEPTION 'Solde insuffisant pour jouer à la roulette.';
  END IF;

  v_winning_number := floor(random() * 37)::int;

  IF v_winning_number = 0 THEN
    v_winning_color := 'green';
  ELSIF v_winning_number IN (1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36) THEN
    v_winning_color := 'red';
  ELSE
    v_winning_color := 'black';
  END IF;

  CREATE TEMP TABLE temp_roulette_bet_results (
    bet_key TEXT,
    bet_label TEXT,
    bet_type TEXT,
    bet_value TEXT,
    amount NUMERIC,
    payout_multiplier NUMERIC,
    outcome TEXT,
    win_amount NUMERIC
  ) ON COMMIT DROP;

  FOREACH v_bet_key IN ARRAY v_bet_keys
  LOOP
    v_bet_value := v_bets_obj -> v_bet_key;
    v_amount := (v_bet_value #>> '{}')::numeric;

    v_bet_label := CASE
      WHEN v_bet_key = 'red' THEN 'Rouge'
      WHEN v_bet_key = 'black' THEN 'Noir'
      WHEN v_bet_key = 'even' THEN 'Pair'
      WHEN v_bet_key = 'odd' THEN 'Impair'
      WHEN v_bet_key = 'low' THEN '1-18'
      WHEN v_bet_key = 'high' THEN '19-36'
      WHEN v_bet_key = 'dozen1' THEN '1er 12'
      WHEN v_bet_key = 'dozen2' THEN '2e 12'
      WHEN v_bet_key = 'dozen3' THEN '3e 12'
      WHEN v_bet_key = 'col1' THEN 'Colonne 1'
      WHEN v_bet_key = 'col2' THEN 'Colonne 2'
      WHEN v_bet_key = 'col3' THEN 'Colonne 3'
      WHEN left(v_bet_key, 2) = 'n:' THEN 'N° ' || substring(v_bet_key from 3)
      ELSE v_bet_key
    END;

    v_bet_type := CASE
      WHEN left(v_bet_key, 2) = 'n:' THEN 'number'
      WHEN v_bet_key IN ('red', 'black') THEN 'color'
      WHEN v_bet_key IN ('even', 'odd') THEN 'parity'
      WHEN v_bet_key IN ('low', 'high') THEN 'range'
      WHEN v_bet_key IN ('dozen1', 'dozen2', 'dozen3') THEN 'dozen'
      WHEN v_bet_key IN ('col1', 'col2', 'col3') THEN 'column'
      ELSE 'number'
    END;

    v_bet_value_text := CASE
      WHEN left(v_bet_key, 2) = 'n:' THEN substring(v_bet_key from 3)
      ELSE v_bet_key
    END;

    v_payout_multiplier := 0;
    v_outcome := 'lost';
    v_win_amount := 0;

    IF left(v_bet_key, 2) = 'n:' THEN
      v_bet_number := substring(v_bet_key from 3)::int;
      v_payout_multiplier := 35;
      IF v_winning_number = v_bet_number THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 35;
      END IF;
    ELSIF v_bet_key = 'red' THEN
      v_payout_multiplier := 2;
      IF v_winning_color = 'red' THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 2;
      END IF;
    ELSIF v_bet_key = 'black' THEN
      v_payout_multiplier := 2;
      IF v_winning_color = 'black' THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 2;
      END IF;
    ELSIF v_bet_key = 'even' THEN
      v_payout_multiplier := 2;
      IF v_winning_number <> 0 AND v_winning_number % 2 = 0 THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 2;
      END IF;
    ELSIF v_bet_key = 'odd' THEN
      v_payout_multiplier := 2;
      IF v_winning_number <> 0 AND v_winning_number % 2 = 1 THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 2;
      END IF;
    ELSIF v_bet_key = 'low' THEN
      v_payout_multiplier := 2;
      IF v_winning_number <> 0 AND v_winning_number BETWEEN 1 AND 18 THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 2;
      END IF;
    ELSIF v_bet_key = 'high' THEN
      v_payout_multiplier := 2;
      IF v_winning_number <> 0 AND v_winning_number BETWEEN 19 AND 36 THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 2;
      END IF;
    ELSIF v_bet_key = 'dozen1' THEN
      v_payout_multiplier := 3;
      IF v_winning_number <> 0 AND v_winning_number BETWEEN 1 AND 12 THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 3;
      END IF;
    ELSIF v_bet_key = 'dozen2' THEN
      v_payout_multiplier := 3;
      IF v_winning_number <> 0 AND v_winning_number BETWEEN 13 AND 24 THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 3;
      END IF;
    ELSIF v_bet_key = 'dozen3' THEN
      v_payout_multiplier := 3;
      IF v_winning_number <> 0 AND v_winning_number BETWEEN 25 AND 36 THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 3;
      END IF;
    ELSIF v_bet_key = 'col1' THEN
      v_payout_multiplier := 3;
      IF v_winning_number <> 0 AND v_winning_number % 3 = 1 THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 3;
      END IF;
    ELSIF v_bet_key = 'col2' THEN
      v_payout_multiplier := 3;
      IF v_winning_number <> 0 AND v_winning_number % 3 = 2 THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 3;
      END IF;
    ELSIF v_bet_key = 'col3' THEN
      v_payout_multiplier := 3;
      IF v_winning_number <> 0 AND v_winning_number % 3 = 0 THEN
        v_outcome := 'won';
        v_win_amount := v_amount * 3;
      END IF;
    END IF;

    v_total_win_amount := v_total_win_amount + v_win_amount;

    INSERT INTO temp_roulette_bet_results (
      bet_key,
      bet_label,
      bet_type,
      bet_value,
      amount,
      payout_multiplier,
      outcome,
      win_amount
    )
    VALUES (
      v_bet_key,
      v_bet_label,
      v_bet_type,
      v_bet_value_text,
      v_amount,
      v_payout_multiplier,
      v_outcome,
      v_win_amount
    );
  END LOOP;

  v_status := CASE WHEN v_total_win_amount > 0 THEN 'paid' ELSE 'lost' END;
  v_ticket_number := 'TKROUL-' || to_char(NOW(), 'YYYYMMDD-HH24MISS') || '-' || substring(md5(random()::text) FROM 1 FOR 6);

  INSERT INTO public.tickets (
    ticket_number,
    user_id,
    game_type,
    total_amount,
    status
  )
  VALUES (
    v_ticket_number,
    v_user_id,
    'roulette',
    v_total_bet_amount,
    v_status
  )
  RETURNING id INTO v_ticket_id;

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
  FROM temp_roulette_bet_results;

  PERFORM public.apply_transaction(
    v_user_id,
    'bet',
    v_total_bet_amount,
    'bet-roulette-' || v_ticket_number,
    'Mise Roulette',
    jsonb_build_object(
      'game_type', 'roulette',
      'ticket_number', v_ticket_number,
      'bets', v_bets_obj,
      'winning_number', v_winning_number
    )
  );

  IF v_total_win_amount > 0 THEN
    PERFORM public.apply_transaction(
      v_user_id,
      'win',
      v_total_win_amount,
      'win-roulette-' || v_ticket_number,
      'Gain Roulette',
      jsonb_build_object(
        'game_type', 'roulette',
        'ticket_number', v_ticket_number,
        'bets', v_bets_obj,
        'winning_number', v_winning_number,
        'winning_color', v_winning_color,
        'total_win_amount', v_total_win_amount
      )
    );
  END IF;

  INSERT INTO public.roulette_rounds (
    user_id,
    ticket_id,
    winning_number,
    winning_color,
    total_bet_amount,
    total_win_amount,
    status,
    metadata
  )
  VALUES (
    v_user_id,
    v_ticket_id,
    v_winning_number,
    v_winning_color,
    v_total_bet_amount,
    v_total_win_amount,
    v_status,
    jsonb_build_object(
      'ticket_number', v_ticket_number,
      'bets', v_bets_obj
    )
  )
  RETURNING id INTO v_round_id;

  INSERT INTO public.roulette_bets (
    round_id,
    user_id,
    ticket_id,
    bet_key,
    bet_label,
    bet_type,
    bet_value,
    amount,
    payout_multiplier,
    outcome,
    win_amount
  )
  SELECT
    v_round_id,
    v_user_id,
    v_ticket_id,
    bet_key,
    bet_label,
    bet_type,
    bet_value,
    amount,
    payout_multiplier,
    outcome,
    win_amount
  FROM temp_roulette_bet_results;

  SELECT jsonb_agg(
    jsonb_build_object(
      'bet_key', bet_key,
      'bet_label', bet_label,
      'bet_type', bet_type,
      'bet_value', bet_value,
      'amount', amount,
      'payout_multiplier', payout_multiplier,
      'outcome', outcome,
      'win_amount', win_amount
    )
  )
    INTO v_bets_result
    FROM temp_roulette_bet_results;

  IF v_bets_result IS NULL THEN
    v_bets_result := '[]'::jsonb;
  END IF;

  RETURN QUERY
  SELECT
    v_ticket_id,
    v_ticket_number,
    v_round_id,
    v_winning_number,
    v_winning_color,
    v_total_bet_amount,
    v_total_win_amount,
    v_status,
    v_bets_result;
END;
$$;
