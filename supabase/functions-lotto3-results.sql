CREATE OR REPLACE FUNCTION public.check_lotto3_results(p_draw_result_id UUID)
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
  v_full_number TEXT;
  v_item_number TEXT;
BEGIN
  SELECT *
    INTO v_result
    FROM public.draw_results
   WHERE id = p_draw_result_id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Résultat Borlette introuvable.';
  END IF;

  IF COALESCE(v_result.game_type, '') <> 'borlette' THEN
    RAISE EXCEPTION 'La fonction check_lotto3_results attend un résultat Borlette.';
  END IF;

  IF COALESCE(v_result.status, '') <> 'published' THEN
    RAISE EXCEPTION 'Le résultat Borlette doit être published.';
  END IF;

  v_full_number := NULLIF(TRIM(COALESCE(v_result.first_prize_full_number, '')), '');

  IF v_full_number IS NULL THEN
    RAISE EXCEPTION 'Le champ first_prize_full_number est obligatoire pour Lotto 3.';
  END IF;

  FOR v_ticket IN
    SELECT t.id
      FROM public.tickets t
     WHERE t.game_type = 'lotto3'
       AND t.draw_name = v_result.draw_name
       AND t.status = 'pending'
  LOOP
    v_checked := v_checked + 1;

    FOR v_item IN
      SELECT id, number_played, amount
        FROM public.ticket_items
       WHERE ticket_id = v_ticket.id
    LOOP
      v_item_number := LPAD(REGEXP_REPLACE(COALESCE(v_item.number_played, ''), '[^0-9]', '', 'g'), 3, '0');

      IF v_item_number = LPAD(v_full_number, 3, '0') THEN
        UPDATE public.ticket_items
           SET status = 'won',
               potential_win = COALESCE(v_item.amount, 0) * 500
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

COMMENT ON FUNCTION public.check_lotto3_results(UUID) IS
  'Vérifie les tickets Lotto 3 à partir du premier lot complet Borlette.';

CREATE OR REPLACE FUNCTION public.pay_lotto3_winnings(p_draw_result_id UUID)
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
    RAISE EXCEPTION 'La fonction pay_lotto3_winnings attend un résultat Borlette.';
  END IF;

  FOR v_ticket IN
    SELECT t.id,
           t.user_id,
           t.ticket_number,
           t.game_type,
           t.status,
           t.draw_name
      FROM public.tickets t
     WHERE t.game_type = 'lotto3'
       AND t.status = 'won'
       AND t.draw_name = v_draw_result.draw_name
  LOOP
    SELECT COALESCE(SUM(ti.potential_win), 0)
      INTO v_winning_amount
      FROM public.ticket_items ti
     WHERE ti.ticket_id = v_ticket.id
       AND ti.status = 'won';

    IF v_winning_amount > 0 THEN
      v_reference := 'win-lotto3-' || v_ticket.ticket_number;

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
        p_description := 'Gain Lotto 3',
        p_metadata := jsonb_build_object(
          'game_type', 'lotto3',
          'source_game_type', 'borlette',
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

COMMENT ON FUNCTION public.pay_lotto3_winnings(UUID) IS
  'Crédite les gains Lotto 3 à partir du premier lot complet Borlette.';
