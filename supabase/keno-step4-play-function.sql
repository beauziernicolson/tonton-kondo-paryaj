CREATE OR REPLACE FUNCTION public.play_keno(
  p_user_id UUID,
  p_selected_numbers INT[],
  p_amount NUMERIC
)
RETURNS TABLE (
  ticket_id UUID,
  ticket_number TEXT,
  selected_numbers INT[],
  drawn_numbers INT[],
  matches_count INT,
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
  v_selected_count INT;
  v_drawn_numbers INT[];
  v_spots_count INT;
  v_payout_multiplier NUMERIC := 0;
  v_matches_count INT;
  v_ticket_id UUID;
  v_ticket_item_id UUID;
  v_ticket_number TEXT;
  v_status TEXT;
  v_number_played TEXT;
  v_wallet_balance NUMERIC;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id ne peut pas être NULL.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount doit être strictement positif.';
  END IF;

  IF p_selected_numbers IS NULL THEN
    RAISE EXCEPTION 'p_selected_numbers ne peut pas être NULL.';
  END IF;

  SELECT w.balance
    INTO v_wallet_balance
    FROM public.wallets w
   WHERE w.user_id = p_user_id
   LIMIT 1;

  IF v_wallet_balance IS NULL THEN
    RAISE EXCEPTION 'Aucun wallet trouvé pour cet utilisateur.';
  END IF;

  IF v_wallet_balance < p_amount THEN
    RAISE EXCEPTION 'Solde insuffisant pour jouer au Keno.';
  END IF;

  v_selected_count := array_length(p_selected_numbers, 1);

  IF v_selected_count IS NULL OR v_selected_count < 5 OR v_selected_count > 10 THEN
    RAISE EXCEPTION 'p_selected_numbers doit contenir entre 5 et 10 numéros.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(p_selected_numbers) AS n
     WHERE n < 1 OR n > 80
  ) THEN
    RAISE EXCEPTION 'Tous les numéros doivent être compris entre 1 et 80.';
  END IF;

  IF (
    SELECT COUNT(*) FROM unnest(p_selected_numbers) AS n
  ) <> (
    SELECT COUNT(DISTINCT n) FROM unnest(p_selected_numbers) AS n
  ) THEN
    RAISE EXCEPTION 'Les numéros choisis ne doivent pas contenir de doublons.';
  END IF;

  v_drawn_numbers := (
    SELECT array_agg(n ORDER BY n)
      FROM (
        SELECT n
          FROM generate_series(1, 80) AS n
         ORDER BY random()
         LIMIT 20
      ) AS draw
  );

  v_matches_count := (
    SELECT COUNT(*)
      FROM unnest(p_selected_numbers) AS sel(n)
     WHERE n = ANY(v_drawn_numbers)
  );

  v_spots_count := v_selected_count;

  SELECT kpr.multiplier
    INTO v_payout_multiplier
    FROM public.keno_payout_rules kpr
   WHERE kpr.spots_count = v_spots_count
     AND kpr.matches_count = v_matches_count
   LIMIT 1;

  IF v_payout_multiplier IS NULL THEN
    v_payout_multiplier := 0;
  END IF;

  bet_amount := p_amount;
  win_amount := p_amount * v_payout_multiplier;
  status := CASE WHEN win_amount > 0 THEN 'paid' ELSE 'lost' END;

  v_ticket_number := 'TKKENO-' || to_char(NOW(), 'YYYYMMDD-HH24MISS') || '-' || substring(md5(random()::text) FROM 1 FOR 6);
  v_number_played := array_to_string(p_selected_numbers, ',');

  INSERT INTO public.tickets (
    ticket_number,
    user_id,
    game_type,
    draw_name,
    total_amount,
    status
  ) VALUES (
    v_ticket_number,
    p_user_id,
    'keno',
    'Keno Instant',
    p_amount,
    status
  )
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.ticket_items (
    ticket_id,
    number_played,
    amount,
    potential_win,
    status
  ) VALUES (
    v_ticket_id,
    v_number_played,
    p_amount,
    win_amount,
    status
  )
  RETURNING id INTO v_ticket_item_id;

  PERFORM public.apply_transaction(
    p_user_id,
    'bet',
    p_amount,
    'bet-keno-' || v_ticket_number,
    'Mise Keno',
    jsonb_build_object(
      'game_type', 'keno',
      'ticket_number', v_ticket_number,
      'selected_numbers', p_selected_numbers
    )
  );

  IF win_amount > 0 THEN
    PERFORM public.apply_transaction(
      p_user_id,
      'win',
      win_amount,
      'win-keno-' || v_ticket_number,
      'Gain Keno',
      jsonb_build_object(
        'game_type', 'keno',
        'ticket_number', v_ticket_number,
        'selected_numbers', p_selected_numbers,
        'drawn_numbers', v_drawn_numbers,
        'matches_count', v_matches_count
      )
    );
  END IF;

  INSERT INTO public.keno_rounds (
    user_id,
    ticket_id,
    ticket_item_id,
    selected_numbers,
    drawn_numbers,
    matches_count,
    payout_multiplier,
    bet_amount,
    win_amount,
    status
  ) VALUES (
    p_user_id,
    v_ticket_id,
    v_ticket_item_id,
    p_selected_numbers,
    v_drawn_numbers,
    v_matches_count,
    v_payout_multiplier,
    p_amount,
    win_amount,
    status
  );

  RETURN QUERY SELECT
    v_ticket_id,
    v_ticket_number,
    p_selected_numbers,
    v_drawn_numbers,
    v_matches_count,
    v_payout_multiplier,
    p_amount,
    win_amount,
    status;
END;
$$;
