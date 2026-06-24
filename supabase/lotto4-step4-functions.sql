CREATE OR REPLACE FUNCTION public.check_lotto4_results(p_draw_result_id UUID)
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
  v_first_prize TEXT;
  v_second_prize TEXT;
  v_third_prize TEXT;
  v_option1 TEXT;
  v_option2 TEXT;
  v_option3 TEXT;
  v_item_number TEXT;
BEGIN
  SELECT *
    INTO v_result
    FROM public.draw_results
   WHERE id = p_draw_result_id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Résultat Lotto 4 introuvable.';
  END IF;

  IF COALESCE(v_result.game_type, '') <> 'lotto4' THEN
    RAISE EXCEPTION 'La fonction check_lotto4_results attend un résultat Lotto 4.';
  END IF;

  IF COALESCE(v_result.status, '') <> 'published' THEN
    RAISE EXCEPTION 'Le résultat Lotto 4 doit être published.';
  END IF;

  v_first_prize := NULLIF(TRIM(COALESCE(v_result.first_prize_number, '')), '');
  v_second_prize := NULLIF(TRIM(COALESCE(v_result.second_prize_number, '')), '');
  v_third_prize := NULLIF(TRIM(COALESCE(v_result.third_prize_number, '')), '');

  IF v_first_prize IS NULL OR v_second_prize IS NULL OR v_third_prize IS NULL THEN
    RAISE EXCEPTION 'Les 3 lots Lotto 4 sont obligatoires.';
  END IF;

  IF v_first_prize !~ '^[0-9]{2}$' OR v_second_prize !~ '^[0-9]{2}$' OR v_third_prize !~ '^[0-9]{2}$' THEN
    RAISE EXCEPTION 'Chaque lot Lotto 4 doit être exactement 2 chiffres.';
  END IF;

  v_option1 := v_second_prize || v_third_prize;
  v_option2 := v_first_prize || v_second_prize;
  v_option3 := v_first_prize || v_third_prize;

  FOR v_ticket IN
    SELECT t.id
      FROM public.tickets t
     WHERE t.game_type = 'lotto4'
       AND t.draw_name = v_result.draw_name
       AND t.status = 'pending'
  LOOP
    v_checked := v_checked + 1;

    FOR v_item IN
      SELECT id, number_played, option_type, amount
        FROM public.ticket_items
       WHERE ticket_id = v_ticket.id
    LOOP
      v_item_number := LPAD(REGEXP_REPLACE(COALESCE(v_item.number_played, ''), '[^0-9]', '', 'g'), 4, '0');

      IF (v_item.option_type = 'option1' AND v_item_number = LPAD(v_option1, 4, '0'))
         OR (v_item.option_type = 'option2' AND v_item_number = LPAD(v_option2, 4, '0'))
         OR (v_item.option_type = 'option3' AND v_item_number = LPAD(v_option3, 4, '0')) THEN
        UPDATE public.ticket_items
           SET status = 'won',
               potential_win = COALESCE(v_item.amount, 0) * 5000
         WHERE id = v_item.id;
      ELSE
        UPDATE public.ticket_items
           SET status = 'lost',
               potential_win = 0
         WHERE id = v_item.id;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
        FROM public.ticket_items
       WHERE ticket_id = v_ticket.id
         AND status = 'won'
    ) THEN
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

COMMENT ON FUNCTION public.check_lotto4_results(UUID) IS
  'Vérifie les tickets Lotto 4 et met à jour les statuts des lignes et des tickets.';

CREATE OR REPLACE FUNCTION public.pay_lotto4_winnings(p_draw_result_id UUID)
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
    RAISE EXCEPTION 'Résultat Lotto 4 introuvable pour l’identifiant fourni.';
  END IF;

  IF COALESCE(v_draw_result.game_type, '') <> 'lotto4' THEN
    RAISE EXCEPTION 'La fonction pay_lotto4_winnings attend un résultat Lotto 4.';
  END IF;

  FOR v_ticket IN
    SELECT t.id,
           t.user_id,
           t.ticket_number,
           t.game_type,
           t.status,
           t.draw_name
      FROM public.tickets t
     WHERE t.game_type = 'lotto4'
       AND t.status = 'won'
       AND t.draw_name = v_draw_result.draw_name
  LOOP
    SELECT COALESCE(SUM(ti.potential_win), 0)
      INTO v_winning_amount
      FROM public.ticket_items ti
     WHERE ti.ticket_id = v_ticket.id
       AND ti.status = 'won';

    IF v_winning_amount > 0 THEN
      v_reference := 'win-lotto4-' || v_ticket.ticket_number;

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
        p_description := 'Gain Lotto 4',
        p_metadata := jsonb_build_object(
          'game_type', 'lotto4',
          'draw_result_id', p_draw_result_id,
          'ticket_number', v_ticket.ticket_number
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

COMMENT ON FUNCTION public.pay_lotto4_winnings(UUID) IS
  'Crédite les gains Lotto 4 après validation des tickets gagnants.';
