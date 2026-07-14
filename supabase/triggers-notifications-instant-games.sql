-- Tonton Kondo — Phase 3C-2
-- Notifications automatiques pour Keno, Lucky 6, Roulette,
-- Roulette Américaine, Penalty et Course Cheval.

CREATE OR REPLACE FUNCTION public.notify_instant_game_round_result()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_old_row JSONB;
  v_ticket_id UUID;
  v_status TEXT;
  v_old_status TEXT;
  v_win_amount NUMERIC := 0;
  v_currency TEXT := 'HTG';
BEGIN
  v_row := to_jsonb(NEW);
  v_old_row := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;

  BEGIN
    v_ticket_id := NULLIF(v_row ->> 'ticket_id', '')::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_ticket_id := NULL;
  END;

  IF v_ticket_id IS NULL THEN
    RAISE WARNING
      'Notification jeu instantané ignorée : ticket_id absent/invalide dans %.%',
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME;
    RETURN NEW;
  END IF;

  v_status := lower(COALESCE(NULLIF(btrim(v_row ->> 'status'), ''), ''));
  v_old_status := lower(COALESCE(NULLIF(btrim(v_old_row ->> 'status'), ''), ''));

  IF TG_OP = 'UPDATE'
     AND v_old_status IS NOT DISTINCT FROM v_status
     AND COALESCE(v_old_row ->> 'win_amount', v_old_row ->> 'total_win_amount', '0')
         IS NOT DISTINCT FROM
         COALESCE(v_row ->> 'win_amount', v_row ->> 'total_win_amount', '0')
  THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_win_amount := COALESCE(
      NULLIF(v_row ->> 'win_amount', '')::NUMERIC,
      NULLIF(v_row ->> 'total_win_amount', '')::NUMERIC,
      0
    );
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_win_amount := 0;
  END;

  v_currency := COALESCE(NULLIF(btrim(v_row ->> 'currency'), ''), 'HTG');

  BEGIN
    IF v_status IN ('paid', 'completed') AND v_win_amount > 0 THEN
      PERFORM public.notify_ticket_won(
        p_ticket_id => v_ticket_id,
        p_win_amount => v_win_amount,
        p_currency => v_currency
      );

      PERFORM public.notify_ticket_paid(
        p_ticket_id => v_ticket_id,
        p_paid_amount => v_win_amount,
        p_currency => v_currency
      );

    ELSIF v_status = 'won' THEN
      PERFORM public.notify_ticket_won(
        p_ticket_id => v_ticket_id,
        p_win_amount => v_win_amount,
        p_currency => v_currency
      );

    ELSIF v_status = 'lost'
       OR (v_status = 'completed' AND v_win_amount <= 0)
    THEN
      PERFORM public.notify_ticket_lost(
        p_ticket_id => v_ticket_id,
        p_currency => v_currency
      );
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING
        'Erreur notification jeu instantané %.% / ticket % : %',
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME,
        v_ticket_id,
        SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_instant_game_round_result() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_instant_game_round_result() FROM anon;
REVOKE ALL ON FUNCTION public.notify_instant_game_round_result() FROM authenticated;

DROP TRIGGER IF EXISTS trg_notify_keno_round_result ON public.keno_rounds;
CREATE TRIGGER trg_notify_keno_round_result
AFTER INSERT OR UPDATE ON public.keno_rounds
FOR EACH ROW EXECUTE FUNCTION public.notify_instant_game_round_result();

DROP TRIGGER IF EXISTS trg_notify_lucky6_round_result ON public.lucky6_rounds;
CREATE TRIGGER trg_notify_lucky6_round_result
AFTER INSERT OR UPDATE ON public.lucky6_rounds
FOR EACH ROW EXECUTE FUNCTION public.notify_instant_game_round_result();

DROP TRIGGER IF EXISTS trg_notify_roulette_round_result ON public.roulette_rounds;
CREATE TRIGGER trg_notify_roulette_round_result
AFTER INSERT OR UPDATE ON public.roulette_rounds
FOR EACH ROW EXECUTE FUNCTION public.notify_instant_game_round_result();

DROP TRIGGER IF EXISTS trg_notify_american_roulette_round_result ON public.american_roulette_rounds;
CREATE TRIGGER trg_notify_american_roulette_round_result
AFTER INSERT OR UPDATE ON public.american_roulette_rounds
FOR EACH ROW EXECUTE FUNCTION public.notify_instant_game_round_result();

DROP TRIGGER IF EXISTS trg_notify_penalty_round_result ON public.penalty_rounds;
CREATE TRIGGER trg_notify_penalty_round_result
AFTER INSERT OR UPDATE ON public.penalty_rounds
FOR EACH ROW EXECUTE FUNCTION public.notify_instant_game_round_result();

DROP TRIGGER IF EXISTS trg_notify_horse_race_round_result ON public.horse_race_rounds;
CREATE TRIGGER trg_notify_horse_race_round_result
AFTER INSERT OR UPDATE ON public.horse_race_rounds
FOR EACH ROW EXECUTE FUNCTION public.notify_instant_game_round_result();

NOTIFY pgrst, 'reload schema';