CREATE OR REPLACE FUNCTION public.play_lucky6(
  p_user_id UUID,
  p_selected_numbers INT[],
  p_amount NUMERIC
)
RETURNS TABLE (
  ticket_id UUID,
  ticket_number TEXT,
  round_id UUID,
  ticket_item_id UUID,
  selected_numbers INT[],
  drawn_numbers INT[],
  matches_count INT,
  sixth_match_position INT,
  payout_multiplier NUMERIC,
  bet_amount NUMERIC,
  win_amount NUMERIC,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := p_user_id;
  v_selected_numbers INT[] := p_selected_numbers;
  v_amount NUMERIC := p_amount;
  v_drawn_numbers INT[];
  v_matches_count INT := 0;
  v_sixth_match_position INT;
  v_payout_multiplier NUMERIC := 0;
  v_win_amount NUMERIC := 0;
  v_status TEXT := 'lost';
  v_ticket_id UUID;
  v_ticket_number TEXT;
  v_ticket_item_id UUID;
  v_round_id UUID;
  v_wallet_balance NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id est requis.';
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount doit être supérieur à 0.';
  END IF;

  IF v_selected_numbers IS NULL THEN
    RAISE EXCEPTION 'p_selected_numbers est requis.';
  END IF;

  IF array_length(v_selected_numbers, 1) IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'Vous devez sélectionner exactement 6 numéros.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_selected_numbers) AS n(n)
    WHERE n < 1 OR n > 48
  ) THEN
    RAISE EXCEPTION 'Tous les numéros doivent être compris entre 1 et 48.';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM (
      SELECT unnest(v_selected_numbers) AS n
    ) AS s
  ) <> (
    SELECT COUNT(*)
    FROM (
      SELECT DISTINCT unnest(v_selected_numbers) AS n
    ) AS d
  ) THEN
    RAISE EXCEPTION 'Les numéros sélectionnés ne doivent pas contenir de doublons.';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> v_user_id THEN
    RAISE EXCEPTION 'Utilisateur non autorisé.';
  END IF;

  SELECT balance
  INTO v_wallet_balance
  FROM public.wallets
  WHERE user_id = v_user_id
  LIMIT 1;

  IF v_wallet_balance IS NULL THEN
    RAISE EXCEPTION 'Wallet introuvable.';
  END IF;

  IF v_wallet_balance < v_amount THEN
    RAISE EXCEPTION 'Solde insuffisant.';
  END IF;

  SELECT ARRAY(
    SELECT n
    FROM (
      SELECT generate_series(1, 48) AS n
    ) AS all_numbers
    ORDER BY random()
    LIMIT 35
  )
  INTO v_drawn_numbers;

  SELECT COUNT(*)
  INTO v_matches_count
  FROM unnest(v_drawn_numbers) AS drawn(number)
  JOIN unnest(v_selected_numbers) AS selected(number) ON drawn.number = selected.number;

  IF v_matches_count = 6 THEN
    SELECT ord::INT
    INTO v_sixth_match_position
    FROM (
      SELECT
        d.ord,
        d.number,
        row_number() OVER (ORDER BY d.ord) AS match_rank
      FROM unnest(v_drawn_numbers) WITH ORDINALITY AS d(number, ord)
      WHERE d.number = ANY (v_selected_numbers)
    ) AS matched
    WHERE match_rank = 6;
  ELSE
    v_sixth_match_position := NULL;
  END IF;

  IF v_matches_count = 6 AND v_sixth_match_position IS NOT NULL THEN
    IF v_sixth_match_position BETWEEN 6 AND 10 THEN
      v_payout_multiplier := 50;
    ELSIF v_sixth_match_position BETWEEN 11 AND 15 THEN
      v_payout_multiplier := 15;
    ELSIF v_sixth_match_position BETWEEN 16 AND 20 THEN
      v_payout_multiplier := 5;
    ELSIF v_sixth_match_position BETWEEN 21 AND 25 THEN
      v_payout_multiplier := 2;
    ELSIF v_sixth_match_position BETWEEN 26 AND 30 THEN
      v_payout_multiplier := 1.2;
    ELSIF v_sixth_match_position BETWEEN 31 AND 35 THEN
      v_payout_multiplier := 0.5;
    ELSE
      v_payout_multiplier := 0;
    END IF;
  ELSE
    v_payout_multiplier := 0;
  END IF;

  v_win_amount := v_amount * v_payout_multiplier;

  IF v_win_amount > 0 THEN
    v_status := 'paid';
  ELSE
    v_status := 'lost';
  END IF;

  v_ticket_number := 'TKL6-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || TO_CHAR(CURRENT_TIMESTAMP, 'HH24MISS') || '-' || FLOOR(RANDOM() * 10000)::INT;

  INSERT INTO public.tickets (
    user_id,
    game_type,
    ticket_number,
    total_amount,
    status
  )
  VALUES (
    v_user_id,
    'lucky6',
    v_ticket_number,
    v_amount,
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
  VALUES (
    v_ticket_id,
    ARRAY_TO_STRING(v_selected_numbers, ','),
    v_amount,
    v_win_amount,
    v_status
  )
  RETURNING id INTO v_ticket_item_id;

  PERFORM public.apply_transaction(
    p_user_id := v_user_id,
    p_type := 'bet',
    p_amount := v_amount,
    p_reference := 'bet-lucky6-' || v_ticket_number,
    p_description := 'Mise Lucky 6',
    p_metadata := jsonb_build_object(
      'game_type', 'lucky6',
      'ticket_number', v_ticket_number,
      'selected_numbers', to_jsonb(v_selected_numbers),
      'drawn_numbers', to_jsonb(v_drawn_numbers)
    )
  );

  IF v_win_amount > 0 THEN
    PERFORM public.apply_transaction(
      p_user_id := v_user_id,
      p_type := 'win',
      p_amount := v_win_amount,
      p_reference := 'win-lucky6-' || v_ticket_number,
      p_description := 'Gain Lucky 6',
      p_metadata := jsonb_build_object(
        'game_type', 'lucky6',
        'ticket_number', v_ticket_number,
        'selected_numbers', to_jsonb(v_selected_numbers),
        'drawn_numbers', to_jsonb(v_drawn_numbers),
        'sixth_match_position', v_sixth_match_position,
        'payout_multiplier', v_payout_multiplier,
        'win_amount', v_win_amount
      )
    );
  END IF;

  INSERT INTO public.lucky6_rounds (
    user_id,
    ticket_id,
    ticket_item_id,
    selected_numbers,
    drawn_numbers,
    matches_count,
    sixth_match_position,
    payout_multiplier,
    bet_amount,
    win_amount,
    status,
    metadata
  )
  VALUES (
    v_user_id,
    v_ticket_id,
    v_ticket_item_id,
    v_selected_numbers,
    v_drawn_numbers,
    v_matches_count,
    v_sixth_match_position,
    v_payout_multiplier,
    v_amount,
    v_win_amount,
    v_status,
    jsonb_build_object(
      'game_type', 'lucky6',
      'ticket_number', v_ticket_number
    )
  )
  RETURNING id INTO v_round_id;

  RETURN QUERY
  SELECT
    v_ticket_id,
    v_ticket_number,
    v_round_id,
    v_ticket_item_id,
    v_selected_numbers,
    v_drawn_numbers,
    v_matches_count,
    v_sixth_match_position,
    v_payout_multiplier,
    v_amount,
    v_win_amount,
    v_status;
END;
$$;