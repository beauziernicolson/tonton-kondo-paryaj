-- Tonton Kondo – Borlette V2 : ajout des 3 lots et compatibilité potentiel

ALTER TABLE public.draw_results
  ADD COLUMN IF NOT EXISTS first_prize_number TEXT,
  ADD COLUMN IF NOT EXISTS second_prize_number TEXT,
  ADD COLUMN IF NOT EXISTS third_prize_number TEXT;

ALTER TABLE public.ticket_items
  ADD COLUMN IF NOT EXISTS potential_win NUMERIC;

COMMENT ON COLUMN public.draw_results.first_prize_number IS 'Premier lot Borlette.';
COMMENT ON COLUMN public.draw_results.second_prize_number IS 'Deuxième lot Borlette.';
COMMENT ON COLUMN public.draw_results.third_prize_number IS 'Troisième lot Borlette.';
COMMENT ON COLUMN public.ticket_items.potential_win IS 'Gain potentiel calculé par lot pour Borlette et autres jeux.';
