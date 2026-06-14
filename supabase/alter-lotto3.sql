-- Lotto 3 V1 - SQL d’extension pour les tickets et résultats
-- Ce fichier ajoute la prise en charge de Lotto 3 sans casser Borlette / Mariage.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND constraint_name = 'tickets_game_type_check'
  ) THEN
    ALTER TABLE public.tickets DROP CONSTRAINT tickets_game_type_check;
  END IF;
END $$;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_game_type_check
  CHECK (game_type IN ('borlette', 'mariage', 'lotto3'));

ALTER TABLE public.draw_results
  ADD COLUMN IF NOT EXISTS first_prize_full_number TEXT;

COMMENT ON COLUMN public.draw_results.first_prize_full_number IS
  'Premier lot complet à 3 chiffres, utilisé par Lotto 3 V1.';

ALTER TABLE public.draw_results
  ADD CONSTRAINT draw_results_first_prize_full_number_check
  CHECK (first_prize_full_number IS NULL OR first_prize_full_number ~ '^[0-9]{3}$') NOT VALID;
