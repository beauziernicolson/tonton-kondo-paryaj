CREATE OR REPLACE FUNCTION public._normalize_mariage_number(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean TEXT;
BEGIN
  v_clean := regexp_replace(COALESCE(p_value, ''), '\s+', '', 'g');
  v_clean := regexp_replace(v_clean, '[^0-9]', '', 'g');

  IF v_clean = '' THEN
    RETURN NULL;
  END IF;

  RETURN LPAD(v_clean, 2, '0');
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._normalize_mariage_combination(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean TEXT;
  v_left TEXT;
  v_right TEXT;
BEGIN
  v_clean := regexp_replace(COALESCE(p_value, ''), '\s+', '', 'g');
  v_clean := regexp_replace(v_clean, '[^0-9-]', '', 'g');

  IF v_clean IS NULL OR v_clean NOT LIKE '%-%' THEN
    RETURN NULL;
  END IF;

  v_left := public._normalize_mariage_number(split_part(v_clean, '-', 1));
  v_right := public._normalize_mariage_number(split_part(v_clean, '-', 2));

  IF v_left IS NULL OR v_right IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_left > v_right THEN
    RETURN format('%s-%s', v_right, v_left);
  END IF;

  RETURN format('%s-%s', v_left, v_right);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_mariage_results(p_draw_result_id UUID)
RETURNS TABLE (
  tickets_checked BIGINT,
  winners BIGINT,
  losers BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result RECORD;
  v_ticket RECORD;
  v_item RECORD;
  v_checked BIGINT := 0;
  v_winners BIGINT := 0;
  v_losers BIGINT := 0;
  v_has_win BOOLEAN;
  v_first_lot TEXT;
  v_second_lot TEXT;
  v_third_lot TEXT;
  v_left_number TEXT;
  v_right_number TEXT;
BEGIN
  SELECT *
    INTO v_result
    FROM public.draw_results
   WHERE id = p_draw_result_id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Résultat Borlette introuvable pour l’identifiant fourni.';
  END IF;

  IF v_result.status <> 'published' THEN
    RAISE EXCEPTION 'Le résultat Borlette doit être published.';
  END IF;

  IF COALESCE(v_result.game_type, '') <> 'borlette' THEN
    RAISE EXCEPTION 'La fonction check_mariage_results attend un résultat Borlette.';
  END IF;

  v_first_lot := public._normalize_mariage_number(v_result.first_prize_number);
  v_second_lot := public._normalize_mariage_number(v_result.second_prize_number);
  v_third_lot := public._normalize_mariage_number(v_result.third_prize_number);

  FOR v_ticket IN
    SELECT t.id
      FROM public.tickets t
     WHERE t.game_type = 'mariage'
       AND t.draw_name = v_result.draw_name
       AND t.status = 'pending'
  LOOP
    v_checked := v_checked + 1;
    v_has_win := false;

    FOR v_item IN
      SELECT id, number_played, amount
        FROM public.ticket_items
       WHERE ticket_id = v_ticket.id
    LOOP
      v_left_number := public._normalize_mariage_number(split_part(COALESCE(v_item.number_played, ''), '-', 1));
      v_right_number := public._normalize_mariage_number(split_part(COALESCE(v_item.number_played, ''), '-', 2));

      IF v_left_number IS NOT NULL
         AND v_right_number IS NOT NULL
         AND v_left_number IN (v_first_lot, v_second_lot, v_third_lot)
         AND v_right_number IN (v_first_lot, v_second_lot, v_third_lot) THEN
        UPDATE public.ticket_items
           SET status = 'won',
               potential_win = COALESCE(v_item.amount, 0) * 5000
         WHERE id = v_item.id;

        v_has_win := true;
      ELSE
        UPDATE public.ticket_items
           SET status = 'lost',
               potential_win = 0
         WHERE id = v_item.id;
      END IF;
    END LOOP;

    IF v_has_win THEN
      UPDATE public.tickets
         SET status = 'won',
             updated_at = NOW()
       WHERE id = v_ticket.id;

      v_winners := v_winners + 1;
    ELSE
      UPDATE public.tickets
         SET status = 'lost',
             updated_at = NOW()
       WHERE id = v_ticket.id;

      v_losers := v_losers + 1;
    END IF;
  END LOOP;

  tickets_checked := v_checked;
  winners := v_winners;
  losers := v_losers;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.check_mariage_results(UUID) IS
 'Vérifie les tickets Mariage à partir des 3 lots Borlette d’un tirage publié.';

CREATE OR REPLACE FUNCTION public.pay_mariage_winnings(p_draw_result_id UUID)
RETURNS TABLE (
  tickets_paid BIGINT,
  total_paid NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draw_result RECORD;
  v_ticket RECORD;
  v_winning_amount NUMERIC := 0;
  v_tickets_paid BIGINT := 0;
  v_total_paid NUMERIC := 0;
  v_reference TEXT;
  v_already_paid BOOLEAN;
BEGIN
  SELECT id, draw_name, game_type
    INTO v_draw_result
    FROM public.draw_results
   WHERE id = p_draw_result_id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Résultat Borlette introuvable pour l’identifiant fourni.';
  END IF;

  IF COALESCE(v_draw_result.game_type, '') <> 'borlette' THEN
    RAISE EXCEPTION 'La fonction pay_mariage_winnings attend un résultat Borlette.';
  END IF;

  FOR v_ticket IN
    SELECT t.id,
           t.user_id,
           t.ticket_number,
           t.game_type,
           t.status,
           t.draw_name
      FROM public.tickets t
     WHERE t.game_type = 'mariage'
       AND t.status = 'won'
       AND t.draw_name = v_draw_result.draw_name
  LOOP
    SELECT COALESCE(SUM(ti.potential_win), 0)
      INTO v_winning_amount
      FROM public.ticket_items ti
     WHERE ti.ticket_id = v_ticket.id
       AND ti.status = 'won';

    IF v_winning_amount > 0 THEN
      v_reference := 'win-mariage-' || v_ticket.ticket_number;

      SELECT EXISTS (
        SELECT 1
        FROM public.transactions
        WHERE reference = v_reference
      )
        INTO v_already_paid;

      IF v_already_paid THEN
        UPDATE public.ticket_items
           SET status = 'paid'
         WHERE ticket_id = v_ticket.id
           AND status = 'won';

        UPDATE public.tickets
           SET status = 'paid',
               updated_at = NOW()
         WHERE id = v_ticket.id;

        CONTINUE;
      END IF;

      PERFORM public.apply_transaction(
        p_user_id := v_ticket.user_id,
        p_type := 'win',
        p_amount := v_winning_amount,
        p_reference := v_reference,
        p_description := 'Gain Mariage',
        p_metadata := jsonb_build_object(
          'game_type', 'mariage',
          'source_game_type', 'borlette',
          'draw_result_id', p_draw_result_id
        )
      );

      UPDATE public.ticket_items
         SET status = 'paid'
       WHERE ticket_id = v_ticket.id
         AND status = 'won';

      UPDATE public.tickets
         SET status = 'paid',
             updated_at = NOW()
       WHERE id = v_ticket.id;

      v_tickets_paid := v_tickets_paid + 1;
      v_total_paid := v_total_paid + v_winning_amount;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT v_tickets_paid, v_total_paid;
END;
$$;

COMMENT ON FUNCTION public.pay_mariage_winnings(UUID) IS
 'Crédite les gains Mariage à partir des 3 lots Borlette du tirage publié.';
