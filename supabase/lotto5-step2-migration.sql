ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_game_type_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_game_type_check
  CHECK (game_type IN ('borlette', 'mariage', 'lotto3', 'lotto4', 'lotto5'));

ALTER TABLE public.ticket_items
  ADD COLUMN IF NOT EXISTS option_type TEXT;
