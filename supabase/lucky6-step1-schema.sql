CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'tickets_game_type_check'
  ) THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_game_type_check
      CHECK (game_type IN ('borlette','mariage','lotto3','lotto4','lotto5','keno','roulette'));
  END IF;
END $$;

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_game_type_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_game_type_check
  CHECK (game_type IN ('borlette','mariage','lotto3','lotto4','lotto5','keno','roulette','lucky6'));

CREATE TABLE IF NOT EXISTS public.lucky6_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ticket_id UUID NULL,
  ticket_item_id UUID NULL,
  selected_numbers INT[] NOT NULL,
  drawn_numbers INT[] NOT NULL,
  matches_count INT NOT NULL DEFAULT 0,
  sixth_match_position INT NULL,
  payout_multiplier NUMERIC NOT NULL DEFAULT 0,
  bet_amount NUMERIC NOT NULL DEFAULT 0,
  win_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'lost',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lucky6_rounds_selected_numbers_length_check CHECK (array_length(selected_numbers, 1) = 6),
  CONSTRAINT lucky6_rounds_drawn_numbers_length_check CHECK (array_length(drawn_numbers, 1) = 35),
  CONSTRAINT lucky6_rounds_matches_count_check CHECK (matches_count BETWEEN 0 AND 6),
  CONSTRAINT lucky6_rounds_sixth_match_position_check CHECK (sixth_match_position IS NULL OR (sixth_match_position BETWEEN 6 AND 35)),
  CONSTRAINT lucky6_rounds_payout_multiplier_check CHECK (payout_multiplier >= 0),
  CONSTRAINT lucky6_rounds_bet_amount_check CHECK (bet_amount > 0),
  CONSTRAINT lucky6_rounds_win_amount_check CHECK (win_amount >= 0),
  CONSTRAINT lucky6_rounds_status_check CHECK (status IN ('won','lost','paid','completed'))
);

CREATE INDEX IF NOT EXISTS idx_lucky6_rounds_user_id ON public.lucky6_rounds (user_id);
CREATE INDEX IF NOT EXISTS idx_lucky6_rounds_ticket_id ON public.lucky6_rounds (ticket_id);
CREATE INDEX IF NOT EXISTS idx_lucky6_rounds_created_at ON public.lucky6_rounds (created_at DESC);
