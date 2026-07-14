-- Tonton Kondo — Couche commune des événements de notifications
-- Fichier : supabase/notifications-events.sql
--
-- Prérequis :
--   1) public.notifications
--   2) public.create_system_notification(...)
--   3) public.tickets
--   4) public.draw_results
--
-- Ce fichier :
--   - ne crée aucun trigger ;
--   - ne modifie aucun ticket, résultat, wallet ou transaction ;
--   - centralise uniquement les messages de notification ;
--   - n'insère jamais directement dans public.notifications.

DROP FUNCTION IF EXISTS public.notify_result_published(UUID);
DROP FUNCTION IF EXISTS public.notify_ticket_paid(UUID, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.notify_ticket_lost(UUID, TEXT);
DROP FUNCTION IF EXISTS public.notify_ticket_won(UUID, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.format_notification_amount(NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.get_notification_game_label(TEXT);

CREATE FUNCTION public.get_notification_game_label(p_game_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(COALESCE(p_game_type, ''))
    WHEN 'borlette' THEN 'Borlette'
    WHEN 'mariage' THEN 'Mariage'
    WHEN 'lotto3' THEN 'Lotto 3'
    WHEN 'lotto4' THEN 'Lotto 4'
    WHEN 'lotto5' THEN 'Lotto 5'
    WHEN 'keno' THEN 'Keno'
    WHEN 'lucky6' THEN 'Lucky 6'
    WHEN 'roulette' THEN 'Roulette'
    WHEN 'american_roulette' THEN 'Roulette Américaine'
    WHEN 'roulette_ameri' THEN 'Roulette Américaine'
    WHEN 'penalty' THEN 'Penalty'
    WHEN 'horse_racing' THEN 'Course Cheval'
    ELSE 'Jeu'
  END;
$$;

REVOKE ALL ON FUNCTION public.get_notification_game_label(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_notification_game_label(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_notification_game_label(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_game_label(TEXT) TO service_role;

CREATE FUNCTION public.format_notification_amount(
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'HTG'
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT format(
    '%s %s',
    to_char(COALESCE(p_amount, 0), 'FM999G999G999G999G990D00'),
    COALESCE(NULLIF(btrim(p_currency), ''), 'HTG')
  );
$$;

REVOKE ALL ON FUNCTION public.format_notification_amount(NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.format_notification_amount(NUMERIC, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.format_notification_amount(NUMERIC, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.format_notification_amount(NUMERIC, TEXT) TO service_role;

CREATE FUNCTION public.notify_ticket_won(
  p_ticket_id UUID,
  p_win_amount NUMERIC DEFAULT 0,
  p_currency TEXT DEFAULT 'HTG'
)
RETURNS TABLE (created BOOLEAN, skipped_reason TEXT, notification_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket RECORD;
  v_game_label TEXT;
  v_message TEXT;
  v_currency TEXT;
BEGIN
  IF p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'p_ticket_id est requis.';
  END IF;

  SELECT t.id, t.user_id, t.ticket_number, t.game_type, t.total_amount, t.status
  INTO v_ticket
  FROM public.tickets AS t
  WHERE t.id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket introuvable : %', p_ticket_id;
  END IF;

  v_game_label := public.get_notification_game_label(v_ticket.game_type);
  v_currency := COALESCE(NULLIF(btrim(p_currency), ''), 'HTG');

  IF COALESCE(p_win_amount, 0) > 0 THEN
    v_message := format(
      'Félicitations ! Votre ticket %s sur %s a gagné %s.',
      COALESCE(NULLIF(btrim(v_ticket.ticket_number), ''), '—'),
      v_game_label,
      public.format_notification_amount(p_win_amount, v_currency)
    );
  ELSE
    v_message := format(
      'Félicitations ! Votre ticket %s sur %s est gagnant.',
      COALESCE(NULLIF(btrim(v_ticket.ticket_number), ''), '—'),
      v_game_label
    );
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.create_system_notification(
    p_recipient_id => v_ticket.user_id,
    p_type => 'ticket_won',
    p_category => 'ticket',
    p_title => 'Ticket gagnant',
    p_message => v_message,
    p_action_url => 'tickets.html',
    p_action_label => 'Voir mon ticket',
    p_entity_type => 'ticket',
    p_entity_id => v_ticket.id,
    p_metadata => jsonb_build_object(
      'ticket_id', v_ticket.id,
      'ticket_number', v_ticket.ticket_number,
      'game_type', v_ticket.game_type,
      'total_amount', v_ticket.total_amount,
      'win_amount', COALESCE(p_win_amount, 0),
      'currency', v_currency,
      'status', v_ticket.status
    ),
    p_priority => 'high',
    p_dedup_key => 'ticket_won:' || v_ticket.id::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_ticket_won(UUID, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_ticket_won(UUID, NUMERIC, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.notify_ticket_won(UUID, NUMERIC, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_ticket_won(UUID, NUMERIC, TEXT) TO service_role;

CREATE FUNCTION public.notify_ticket_lost(
  p_ticket_id UUID,
  p_currency TEXT DEFAULT 'HTG'
)
RETURNS TABLE (created BOOLEAN, skipped_reason TEXT, notification_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket RECORD;
  v_game_label TEXT;
  v_currency TEXT;
  v_message TEXT;
BEGIN
  IF p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'p_ticket_id est requis.';
  END IF;

  SELECT t.id, t.user_id, t.ticket_number, t.game_type, t.total_amount, t.status
  INTO v_ticket
  FROM public.tickets AS t
  WHERE t.id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket introuvable : %', p_ticket_id;
  END IF;

  v_game_label := public.get_notification_game_label(v_ticket.game_type);
  v_currency := COALESCE(NULLIF(btrim(p_currency), ''), 'HTG');
  v_message := format(
    'Votre ticket %s sur %s n’est pas gagnant.',
    COALESCE(NULLIF(btrim(v_ticket.ticket_number), ''), '—'),
    v_game_label
  );

  RETURN QUERY
  SELECT *
  FROM public.create_system_notification(
    p_recipient_id => v_ticket.user_id,
    p_type => 'ticket_lost',
    p_category => 'ticket',
    p_title => 'Ticket terminé',
    p_message => v_message,
    p_action_url => 'tickets.html',
    p_action_label => 'Voir mon ticket',
    p_entity_type => 'ticket',
    p_entity_id => v_ticket.id,
    p_metadata => jsonb_build_object(
      'ticket_id', v_ticket.id,
      'ticket_number', v_ticket.ticket_number,
      'game_type', v_ticket.game_type,
      'total_amount', v_ticket.total_amount,
      'currency', v_currency,
      'status', v_ticket.status
    ),
    p_priority => 'normal',
    p_dedup_key => 'ticket_lost:' || v_ticket.id::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_ticket_lost(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_ticket_lost(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.notify_ticket_lost(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_ticket_lost(UUID, TEXT) TO service_role;

CREATE FUNCTION public.notify_ticket_paid(
  p_ticket_id UUID,
  p_paid_amount NUMERIC DEFAULT 0,
  p_currency TEXT DEFAULT 'HTG'
)
RETURNS TABLE (created BOOLEAN, skipped_reason TEXT, notification_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket RECORD;
  v_currency TEXT;
  v_message TEXT;
BEGIN
  IF p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'p_ticket_id est requis.';
  END IF;

  SELECT t.id, t.user_id, t.ticket_number, t.game_type, t.total_amount, t.status
  INTO v_ticket
  FROM public.tickets AS t
  WHERE t.id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket introuvable : %', p_ticket_id;
  END IF;

  v_currency := COALESCE(NULLIF(btrim(p_currency), ''), 'HTG');

  IF COALESCE(p_paid_amount, 0) > 0 THEN
    v_message := format(
      'Votre gain de %s pour le ticket %s a été crédité dans votre portefeuille.',
      public.format_notification_amount(p_paid_amount, v_currency),
      COALESCE(NULLIF(btrim(v_ticket.ticket_number), ''), '—')
    );
  ELSE
    v_message := format(
      'Le gain de votre ticket %s a été crédité dans votre portefeuille.',
      COALESCE(NULLIF(btrim(v_ticket.ticket_number), ''), '—')
    );
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.create_system_notification(
    p_recipient_id => v_ticket.user_id,
    p_type => 'ticket_paid',
    p_category => 'wallet',
    p_title => 'Gain crédité',
    p_message => v_message,
    p_action_url => 'wallet.html',
    p_action_label => 'Voir mon portefeuille',
    p_entity_type => 'ticket',
    p_entity_id => v_ticket.id,
    p_metadata => jsonb_build_object(
      'ticket_id', v_ticket.id,
      'ticket_number', v_ticket.ticket_number,
      'game_type', v_ticket.game_type,
      'paid_amount', COALESCE(p_paid_amount, 0),
      'currency', v_currency,
      'status', v_ticket.status
    ),
    p_priority => 'high',
    p_dedup_key => 'ticket_paid:' || v_ticket.id::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_ticket_paid(UUID, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_ticket_paid(UUID, NUMERIC, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.notify_ticket_paid(UUID, NUMERIC, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_ticket_paid(UUID, NUMERIC, TEXT) TO service_role;

CREATE FUNCTION public.notify_result_published(
  p_draw_result_id UUID
)
RETURNS TABLE (
  recipients_count INTEGER,
  created_count INTEGER,
  skipped_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result RECORD;
  v_recipient RECORD;
  v_created BOOLEAN;
  v_skipped_reason TEXT;
  v_notification_id UUID;
  v_recipients_count INTEGER := 0;
  v_created_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_game_label TEXT;
  v_result_label TEXT;
BEGIN
  IF p_draw_result_id IS NULL THEN
    RAISE EXCEPTION 'p_draw_result_id est requis.';
  END IF;

  SELECT
    dr.id,
    dr.game_type,
    dr.draw_name,
    dr.status,
    dr.draw_date,
    dr.first_prize_number,
    dr.second_prize_number,
    dr.third_prize_number,
    dr.created_at
  INTO v_result
  FROM public.draw_results AS dr
  WHERE dr.id = p_draw_result_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Résultat introuvable : %', p_draw_result_id;
  END IF;

  v_game_label := public.get_notification_game_label(v_result.game_type);
  v_result_label := COALESCE(NULLIF(btrim(v_result.draw_name), ''), v_game_label);

  FOR v_recipient IN
    SELECT DISTINCT t.user_id
    FROM public.tickets AS t
    WHERE lower(COALESCE(t.game_type, '')) = lower(COALESCE(v_result.game_type, ''))
      AND (
        NULLIF(btrim(v_result.draw_name), '') IS NULL
        OR NULLIF(btrim(t.draw_name), '') IS NULL
        OR lower(btrim(t.draw_name)) = lower(btrim(v_result.draw_name))
      )
  LOOP
    v_recipients_count := v_recipients_count + 1;

    SELECT result.created, result.skipped_reason, result.notification_id
    INTO v_created, v_skipped_reason, v_notification_id
    FROM public.create_system_notification(
      p_recipient_id => v_recipient.user_id,
      p_type => 'result_published',
      p_category => 'result',
      p_title => 'Nouveau résultat publié',
      p_message => format('Le résultat de %s est maintenant disponible.', v_result_label),
      p_action_url => 'results.html',
      p_action_label => 'Voir le résultat',
      p_entity_type => 'draw_result',
      p_entity_id => v_result.id,
      p_metadata => jsonb_build_object(
        'draw_result_id', v_result.id,
        'game_type', v_result.game_type,
        'draw_name', v_result.draw_name,
        'status', v_result.status,
        'draw_date', v_result.draw_date,
        'first_prize_number', v_result.first_prize_number,
        'second_prize_number', v_result.second_prize_number,
        'third_prize_number', v_result.third_prize_number
      ),
      p_priority => 'normal',
      p_dedup_key => 'result_published:' || v_result.id::text || ':' || v_recipient.user_id::text
    ) AS result;

    IF COALESCE(v_created, false) THEN
      v_created_count := v_created_count + 1;
    ELSE
      v_skipped_count := v_skipped_count + 1;
    END IF;
  END LOOP;

  recipients_count := v_recipients_count;
  created_count := v_created_count;
  skipped_count := v_skipped_count;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_result_published(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_result_published(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.notify_result_published(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_result_published(UUID) TO service_role;

NOTIFY pgrst, 'reload schema