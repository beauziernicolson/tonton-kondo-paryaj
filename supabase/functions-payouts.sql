-- Tonton Kondo – Phase 2.7 : paiement automatique des gains Borlette
-- Cette fonction crédite les wallets des tickets gagnants sans modifier la logique d’authentification,
-- la page Borlette ni la page historique. Elle ne fait que calculer les gains et appliquer les transactions.

CREATE OR REPLACE FUNCTION public.pay_borlette_winnings(p_draw_result_id UUID)
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
  SELECT id, status
    INTO v_draw_result
    FROM public.draw_results
   WHERE id = p_draw_result_id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Résultat introuvable pour l’identifiant fourni.';
  END IF;

  FOR v_ticket IN
    SELECT t.id,
           t.user_id,
           t.ticket_number,
           t.game_type,
           t.status
      FROM public.tickets t
     WHERE t.game_type = 'borlette'
       AND t.status = 'won'
  LOOP
    SELECT COALESCE(SUM(ti.potential_win), 0)
      INTO v_winning_amount
      FROM public.ticket_items ti
     WHERE ti.ticket_id = v_ticket.id
       AND ti.status = 'won';

    IF v_winning_amount IS NULL THEN
      v_winning_amount := 0;
    END IF;

    IF v_winning_amount > 0 THEN
      v_reference := 'win-borlette-' || v_ticket.ticket_number;

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
        p_description := 'Paiement automatique des gains Borlette',
        p_metadata := jsonb_build_object(
          'draw_result_id', p_draw_result_id,
          'ticket_id', v_ticket.id,
          'ticket_number', v_ticket.ticket_number,
          'game_type', v_ticket.game_type,
          'mode', 'automatic_payout'
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

COMMENT ON FUNCTION public.pay_borlette_winnings(UUID) IS
 'Crédite automatiquement les gains Borlette pour les tickets statut won, sans modifier l’authentification ni les pages de jeu.';
