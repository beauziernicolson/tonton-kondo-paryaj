-- Lotto4 trigger automation migration
-- Met à jour la fonction de publication des résultats pour inclure Lotto4.

CREATE OR REPLACE FUNCTION public.handle_draw_result_published()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  IF NEW.game_type = 'borlette' THEN
    PERFORM public.check_borlette_results(NEW.id);
    PERFORM public.pay_borlette_winnings(NEW.id);
  ELSIF NEW.game_type = 'mariage' THEN
    PERFORM public.check_mariage_results(NEW.id);
    PERFORM public.pay_mariage_winnings(NEW.id);
  ELSIF NEW.game_type = 'lotto3' THEN
    PERFORM public.check_lotto3_results(NEW.id);
    PERFORM public.pay_lotto3_winnings(NEW.id);
  ELSIF NEW.game_type = 'lotto4' THEN
    PERFORM public.check_lotto4_results(NEW.id);
    PERFORM public.pay_lotto4_winnings(NEW.id);
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
