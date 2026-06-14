-- Tonton Kondo – Automatisation automatique des résultats Borlette
-- Ce trigger exécute la vérification puis le paiement dès qu’un résultat est publié.

CREATE OR REPLACE FUNCTION public.handle_draw_result_published()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.game_type = 'borlette' THEN
    PERFORM public.check_borlette_results(NEW.id);
    PERFORM public.pay_borlette_winnings(NEW.id);

    BEGIN
      PERFORM public.check_mariage_results(NEW.id);
      PERFORM public.pay_mariage_winnings(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Mariage processing failed: %', SQLERRM;
    END;

    BEGIN
      PERFORM public.check_lotto3_results(NEW.id);
      PERFORM public.pay_lotto3_winnings(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Lotto3 processing failed: %', SQLERRM;
    END;
  ELSIF NEW.game_type = 'mariage' THEN
    -- Mariage est calculé automatiquement à partir des 3 lots Borlette.
    NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_draw_result_published_auto ON public.draw_results;

CREATE TRIGGER trigger_draw_result_published_auto
AFTER INSERT ON public.draw_results
FOR EACH ROW
WHEN (NEW.status = 'published')
EXECUTE FUNCTION public.handle_draw_result_published();
