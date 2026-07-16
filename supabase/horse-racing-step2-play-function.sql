DROP FUNCTION IF EXISTS public.play_horse_race(UUID, TEXT, NUMERIC);

CREATE FUNCTION public.play_horse_race(
  p_user_id UUID,
  p_horse_id TEXT,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := p_user_id;
  v_horse_id TEXT := p_horse_id;
  v_amount NUMERIC := p_amount;
  v_selected_horse_name TEXT;
  v_selected_odds NUMERIC;
  v_winner_horse_id TEXT;
  v_winner_horse_name TEXT;
  v_winner_odds NUMERIC;
  v_payout_multiplier NUMERIC := 0;
  v_win_amount NUMERIC := 0;
  v_status TEXT := 'lost';
  v_ticket_id UUID;
  v_ticket_number TEXT;
  v_round_id UUID;
  v_wallet_balance NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id est requis.';
  END IF;

  IF v_horse_id IS NULL OR v_horse_id NOT IN ('zekle', 'lakay', 'bel_gason', 'mapou', 'towo') THEN
    RAISE EXCEPTION 'p_horse_id est invalide.';
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount doit être supérieur à 0.';
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
    RAISE EXCEPTION 'Aucun wallet trouvé pour cet utilisateur.';
  END IF;

  IF v_wallet_balance < v_amount THEN
    RAISE EXCEPTION 'Solde insuffisant.';
  END IF;

  v_selected_horse_name := CASE v_horse_id
    WHEN 'zekle' THEN 'Zeklè'
    WHEN 'lakay' THEN 'Lakay'
    WHEN 'bel_gason' THEN 'Bèl Gason'
    WHEN 'mapou' THEN 'Mapou'
    WHEN 'towo' THEN 'Towo'
  END;

  v_selected_odds := CASE v_horse_id
    WHEN 'zekle' THEN 5.0
    WHEN 'lakay' THEN 4.2
    WHEN 'bel_gason' THEN 6.5
    WHEN 'mapou' THEN 7.5
    WHEN 'towo' THEN 3.8
  END;

  SELECT horse_id
    INTO v_winner_horse_id
    FROM (
      VALUES ('zekle'), ('lakay'), ('bel_gason'), ('mapou'), ('towo')
    ) AS horses(horse_id)
   ORDER BY random()
   LIMIT 1;

  v_winner_horse_name := CASE v_winner_horse_id
    WHEN 'zekle' THEN 'Zeklè'
    WHEN 'lakay' THEN 'Lakay'
    WHEN 'bel_gason' THEN 'Bèl Gason'
    WHEN 'mapou' THEN 'Mapou'
    WHEN 'towo' THEN 'Towo'
  END;

  v_winner_odds := CASE v_winner_horse_id
    WHEN 'zekle' THEN 5.0
    WHEN 'lakay' THEN 4.2
    WHEN 'bel_gason' THEN 6.5
    WHEN 'mapou' THEN 7.5
    WHEN 'towo' THEN 3.8
  END;

  IF v_horse_id = v_winner_horse_id THEN
    v_payout_multiplier := v_selected_odds;
    v_win_amount := v_amount * v_selected_odds;
    v_status := 'paid';
  ELSE
    v_payout_multiplier := 0;
    v_win_amount := 0;
    v_status := 'lost';
  END IF;

  v_ticket_number := 'TKHR-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || TO_CHAR(CURRENT_TIMESTAMP, 'HH24MISS') || '-' || FLOOR(RANDOM() * 10000)::INT;

  INSERT INTO public.tickets (
    user_id,
    game_type,
    ticket_number,
    total_amount,
    status
  )
  VALUES (
    v_user_id,
    'horse_racing',
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
    v_selected_horse_name,
    v_amount,
    v_win_amount,
    v_status
  );

  PERFORM public.apply_transaction(
    p_user_id := v_user_id,
    p_type := 'bet',
    p_amount := v_amount,
    p_reference := 'bet-horse-racing-' || v_ticket_number,
    p_description := 'Mise Course Cheval',
    p_metadata := jsonb_build_object(
      'game_type', 'horse_racing',
      'ticket_number', v_ticket_number,
      'selected_horse_id', v_horse_id,
      'winner_horse_id', v_winner_horse_id
    )
  );

  IF v_win_amount > 0 THEN
    PERFORM public.apply_transaction(
      p_user_id := v_user_id,
      p_type := 'win',
      p_amount := v_win_amount,
      p_reference := 'win-horse-racing-' || v_ticket_number,
      p_description := 'Gain Course Cheval',
      p_metadata := jsonb_build_object(
        'game_type', 'horse_racing',
        'ticket_number', v_ticket_number,
        'selected_horse_id', v_horse_id,
        'winner_horse_id', v_winner_horse_id,
        'win_amount', v_win_amount
      )
    );
  END IF;

  INSERT INTO public.horse_race_rounds (
    user_id,
    ticket_id,
    selected_horse_id,
    selected_horse_name,
    winner_horse_id,
    winner_horse_name,
    bet_amount,
    payout_multiplier,
    win_amount,
    status,
    metadata
  )
  VALUES (
    v_user_id,
    v_ticket_id,
    v_horse_id,
    v_selected_horse_name,
    v_winner_horse_id,
    v_winner_horse_name,
    v_amount,
    v_payout_multiplier,
    v_win_amount,
    v_status,
    jsonb_build_object(
      'game_type', 'horse_racing',
      'ticket_number', v_ticket_number,
      'selected_horse_id', v_horse_id,
      'selected_horse_name', v_selected_horse_name,
      'winner_horse_id', v_winner_horse_id,
      'winner_horse_name', v_winner_horse_name,
      'selected_odds', v_selected_odds,
      'winner_odds', v_winner_odds
    )
  )
  RETURNING id INTO v_round_id;

  SELECT balance
    INTO v_new_balance
    FROM public.wallets
   WHERE user_id = v_user_id
   LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_number', v_ticket_number,
    'selected_horse_id', v_horse_id,
    'winner_id', v_winner_horse_id,
    'amount', v_amount,
    'odds', v_selected_odds,
    'gain', v_win_amount,
    'status',
      CASE
        WHEN v_horse_id = v_winner_horse_id THEN 'Gagné'
        ELSE 'Perdu'
      END,
    'new_balance', COALESCE(v_new_balance, v_wallet_balance)
  );
END;
$$;
