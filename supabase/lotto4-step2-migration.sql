-- Lotto 4 Step 2 migration
-- Prépare Supabase à accepter tickets.game_type = 'lotto4' et ajoute option_type dans ticket_items.

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_game_type_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_game_type_check
  CHECK (game_type IN ('borlette', 'mariage', 'lotto3', 'lotto4'));

ALTER TABLE public.ticket_items
  ADD COLUMN IF NOT EXISTS option_type TEXT;
