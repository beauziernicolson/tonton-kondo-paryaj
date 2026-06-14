CREATE OR REPLACE FUNCTION public.check_borlette_results(p_draw_result_id UUID)
RETURNS TABLE (
  tickets_checked BIGINT,
  winners BIGINT,
  losers BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_result RECORD;
  v_ticket RECORD;
  v_item RECORD;
  v_checked BIGINT := 0;
  v_winners BIGINT := 0;
  v_losers BIGINT := 0;
  v_has_win BOOLEAN;
  v_first_prize TEXT;
  v_second_prize TEXT;
  v_third_prize TEXT;
  v_item_number TEXT;
  v_multiplier INTEGER;
BEGIN
  SELECT *
  INTO v_result
  FROM public.draw_results
  WHERE id = p_draw_result_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Résultat introuvable.';
  END IF;

  IF v_result.status <> 'published' THEN
    RAISE EXCEPTION 'Le résultat doit être published.';
  END IF;

  IF v_result.game_type <> 'borlette' THEN
    RAISE EXCEPTION 'Cette vérification ne s’applique qu’aux résultats Borlette.';
  END IF;

  v_first_prize := COALESCE(NULLIF(TRIM(v_result.first_prize_number), ''), NULLIF(TRIM(v_result.winning_number), ''));
  v_second_prize := NULLIF(TRIM(COALESCE(v_result.second_prize_number, '')), '');
  v_third_prize := NULLIF(TRIM(COALESCE(v_result.third_prize_number, '')), '');

  FOR v_ticket IN
    SELECT t.id, t.draw_name
    FROM public.tickets t
    WHERE t.game_type = v_result.game_type
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
      v_item_number := LPAD(TRIM(v_item.number_played), 2, '0');
      v_multiplier := 0;

      IF v_first_prize IS NOT NULL AND v_item_number = LPAD(TRIM(v_first_prize), 2, '0') THEN
        v_multiplier := 60;
      ELSIF v_second_prize IS NOT NULL AND v_item_number = LPAD(TRIM(v_second_prize), 2, '0') THEN
        v_multiplier := 20;
      ELSIF v_third_prize IS NOT NULL AND v_item_number = LPAD(TRIM(v_third_prize), 2, '0') THEN
        v_multiplier := 10;
      END IF;

      IF v_multiplier > 0 THEN
        UPDATE public.ticket_items
        SET status = 'won',
            potential_win = COALESCE(v_item.amount, 0) * v_multiplier
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