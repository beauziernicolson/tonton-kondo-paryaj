-- Tonton Kondo — Phase 3C-1
-- Branchement des notifications pour les jeux utilisant public.draw_results :
-- borlette, mariage, lotto3, lotto4 et lotto5.
--
-- Prérequis :
--   1) public.notify_result_published(UUID)
--   2) public.notify_ticket_won(UUID, NUMERIC, TEXT)
--   3) public.notify_ticket_lost(UUID, TEXT)
--   4) public.notify_ticket_paid(UUID, NUMERIC, TEXT)
--
-- Stratégie retenue :
--   - un trigger sur public.draw_results signale la publication du résultat ;
--   - un trigger séparé sur public.tickets réagit uniquement après le changement
--     réel du statut du ticket ;
--   - ainsi, aucune dépendance fragile à l’ordre d’exécution entre triggers de
--     draw_results n’est nécessaire ;
--   - les fonctions de calcul et de paiement existantes ne sont pas modifiées ;
--   - une erreur de notification ne bloque jamais le calcul ou le paiement.

-- =========================================================
-- 1. RÉSULTAT PUBLIÉ
-- =========================================================

CREATE OR REPLACE FUNCTION public.notify_draw_result_published_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sur INSERT : agir seulement si le résultat est déjà publié.
  -- Sur UPDATE : agir seulement lors du passage réel vers published.
  IF lower(COALESCE(NEW.status, '')) = 'published'
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM NEW.status
     )
  THEN
    BEGIN
      PERFORM public.notify_result_published(NEW.id);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING
          'Erreur notification résultat publié % : %',
          NEW.id,
          SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_draw_result_published_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_draw_result_published_event() FROM anon;
REVOKE ALL ON FUNCTION public.notify_draw_result_published_event() FROM authenticated;

DROP TRIGGER IF EXISTS trg_notify_draw_result_published_event
ON public.draw_results;

CREATE TRIGGER trg_notify_draw_result_published_event
AFTER INSERT OR UPDATE OF status
ON public.draw_results
FOR EACH ROW
EXECUTE FUNCTION public.notify_draw_result_published_event();

-- =========================================================
-- 2. CHANGEMENT DE STATUT D’UN TICKET
-- =========================================================

CREATE OR REPLACE FUNCTION public.notify_draw_game_ticket_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_type TEXT;
  v_status TEXT;
  v_gain_amount NUMERIC := 0;
  v_currency TEXT := 'HTG';
BEGIN
  -- Ne rien faire si le statut n’a pas réellement changé.
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_game_type := lower(COALESCE(NEW.game_type, ''));
  v_status := lower(COALESCE(NEW.status, ''));

  -- Cette phase couvre uniquement les jeux pilotés par draw_results.
  IF v_game_type NOT IN (
    'borlette',
    'mariage',
    'lotto3',
    'lotto4',
    'lotto5'
  ) THEN
    RETURN NEW;
  END IF;

  -- Calcul du gain réel à partir des lignes gagnantes/payées.
  -- COALESCE garantit 0 si aucune ligne n’est trouvée.
  SELECT COALESCE(
    SUM(
      CASE
        WHEN lower(COALESCE(ti.status, '')) IN ('won', 'paid')
          THEN COALESCE(ti.potential_win, 0)
        ELSE 0
      END
    ),
    0
  )
  INTO v_gain_amount
  FROM public.ticket_items AS ti
  WHERE ti.ticket_id = NEW.id;

  -- Toute erreur de notification est capturée afin de ne jamais bloquer
  -- le moteur de résultat, les paiements ou les transactions wallet.
  BEGIN
    IF v_status = 'lost' THEN
      PERFORM public.notify_ticket_lost(
        p_ticket_id => NEW.id,
        p_currency => v_currency
      );

    ELSIF v_status = 'won' THEN
      PERFORM public.notify_ticket_won(
        p_ticket_id => NEW.id,
        p_win_amount => v_gain_amount,
        p_currency => v_currency
      );

    ELSIF v_status = 'paid' THEN
      -- Crée d’abord la notification de victoire, puis celle du crédit.
      -- Les clés de déduplication internes empêchent les doublons.
      PERFORM public.notify_ticket_won(
        p_ticket_id => NEW.id,
        p_win_amount => v_gain_amount,
        p_currency => v_currency
      );

      PERFORM public.notify_ticket_paid(
        p_ticket_id => NEW.id,
        p_paid_amount => v_gain_amount,
        p_currency => v_currency
      );
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING
        'Erreur notification statut ticket % (% -> %) : %',
        NEW.id,
        OLD.status,
        NEW.status,
        SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_draw_game_ticket_status_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_draw_game_ticket_status_change() FROM anon;
REVOKE ALL ON FUNCTION public.notify_draw_game_ticket_status_change() FROM authenticated;

DROP TRIGGER IF EXISTS trg_notify_draw_game_ticket_status_change
ON public.tickets;

CREATE TRIGGER trg_notify_draw_game_ticket_status_change
AFTER UPDATE OF status
ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.notify_draw_game_ticket_status_change();

NOTIFY pgrst, 'reload schema';