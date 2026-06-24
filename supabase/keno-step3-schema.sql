CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_game_type_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_game_type_check
  CHECK (game_type IN ('borlette', 'mariage', 'lotto3', 'lotto4', 'lotto5', 'keno'));

CREATE TABLE IF NOT EXISTS public.keno_payout_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spots_count INT NOT NULL,
  matches_count INT NOT NULL,
  multiplier NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (spots_count, matches_count)
);

INSERT INTO public.keno_payout_rules (spots_count, matches_count, multiplier) VALUES
  (5, 3, 2),
  (5, 4, 10),
  (5, 5, 50),
  (6, 3, 1),
  (6, 4, 5),
  (6, 5, 25),
  (6, 6, 100),
  (7, 4, 3),
  (7, 5, 15),
  (7, 6, 75),
  (7, 7, 250),
  (8, 4, 2),
  (8, 5, 10),
  (8, 6, 50),
  (8, 7, 200),
  (8, 8, 500),
  (9, 5, 5),
  (9, 6, 25),
  (9, 7, 100),
  (9, 8, 500),
  (9, 9, 1000),
  (10, 5, 2),
  (10, 6, 10),
  (10, 7, 50),
  (10, 8, 250),
  (10, 9, 1000),
  (10, 10, 5000)
ON CONFLICT (spots_count, matches_count)
DO UPDATE SET multiplier = EXCLUDED.multiplier;

CREATE TABLE IF NOT EXISTS public.keno_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ticket_id UUID,
  ticket_item_id UUID,
  selected_numbers INT[] NOT NULL,
  drawn_numbers INT[] NOT NULL,
  matches_count INT NOT NULL DEFAULT 0,
  payout_multiplier NUMERIC NOT NULL DEFAULT 0,
  bet_amount NUMERIC NOT NULL DEFAULT 0,
  win_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'lost',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT keno_rounds_selected_numbers_check CHECK (array_length(selected_numbers, 1) BETWEEN 5 AND 10),
  CONSTRAINT keno_rounds_drawn_numbers_check CHECK (array_length(drawn_numbers, 1) = 20),
  CONSTRAINT keno_rounds_matches_count_check CHECK (matches_count >= 0),
  CONSTRAINT keno_rounds_bet_amount_check CHECK (bet_amount > 0),
  CONSTRAINT keno_rounds_win_amount_check CHECK (win_amount >= 0),
  CONSTRAINT keno_rounds_status_check CHECK (status IN ('lost', 'won', 'paid'))
);

-- Les validations avancées des numéros entre 1 et 80 et des doublons seront faites dans public.play_keno.

CREATE INDEX IF NOT EXISTS idx_keno_rounds_user_id ON public.keno_rounds(user_id);
CREATE INDEX IF NOT EXISTS idx_keno_rounds_ticket_id ON public.keno_rounds(ticket_id);
CREATE INDEX IF NOT EXISTS idx_keno_rounds_created_at ON public.keno_rounds(created_at DESC);
