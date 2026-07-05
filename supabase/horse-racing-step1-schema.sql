CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_game_type_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_game_type_check
  CHECK (
    game_type::text = ANY (
      ARRAY[
        'borlette'::text,
        'mariage'::text,
        'lotto3'::text,
        'lotto4'::text,
        'lotto5'::text,
        'keno'::text,
        'roulette'::text,
        'lucky6'::text,
        'penalty'::text,
        'horse_racing'::text
      ]
    )
  );

CREATE TABLE IF NOT EXISTS public.horse_race_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ticket_id UUID NULL,
  selected_horse_id TEXT NOT NULL,
  selected_horse_name TEXT NOT NULL,
  winner_horse_id TEXT NOT NULL,
  winner_horse_name TEXT NOT NULL,
  bet_amount NUMERIC NOT NULL,
  payout_multiplier NUMERIC NOT NULL DEFAULT 0,
  win_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'lost',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT horse_race_rounds_selected_horse_id_check
    CHECK (selected_horse_id IN ('zekle', 'lakay', 'bel_gason', 'mapou', 'towo')),
  CONSTRAINT horse_race_rounds_winner_horse_id_check
    CHECK (winner_horse_id IN ('zekle', 'lakay', 'bel_gason', 'mapou', 'towo')),
  CONSTRAINT horse_race_rounds_bet_amount_check
    CHECK (bet_amount > 0),
  CONSTRAINT horse_race_rounds_payout_multiplier_check
    CHECK (payout_multiplier >= 0),
  CONSTRAINT horse_race_rounds_win_amount_check
    CHECK (win_amount >= 0),
  CONSTRAINT horse_race_rounds_status_check
    CHECK (status IN ('won', 'lost', 'paid', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_horse_race_rounds_user_id
  ON public.horse_race_rounds (user_id);

CREATE INDEX IF NOT EXISTS idx_horse_race_rounds_ticket_id
  ON public.horse_race_rounds (ticket_id);

CREATE INDEX IF NOT EXISTS idx_horse_race_rounds_created_at
  ON public.horse_race_rounds (created_at DESC);

COMMENT ON TABLE public.horse_race_rounds IS 'Rondes de course de chevaux enregistrées côté Supabase.';
COMMENT ON COLUMN public.horse_race_rounds.id IS 'Identifiant unique de la ronde.';
COMMENT ON COLUMN public.horse_race_rounds.user_id IS 'Utilisateur ayant joué la ronde.';
COMMENT ON COLUMN public.horse_race_rounds.ticket_id IS 'Ticket associé à la ronde, si disponible.';
COMMENT ON COLUMN public.horse_race_rounds.selected_horse_id IS 'Identifiant du cheval sélectionné par l’utilisateur.';
COMMENT ON COLUMN public.horse_race_rounds.selected_horse_name IS 'Nom du cheval sélectionné par l’utilisateur.';
COMMENT ON COLUMN public.horse_race_rounds.winner_horse_id IS 'Identifiant du cheval gagnant de la ronde.';
COMMENT ON COLUMN public.horse_race_rounds.winner_horse_name IS 'Nom du cheval gagnant de la ronde.';
COMMENT ON COLUMN public.horse_race_rounds.bet_amount IS 'Montant misé sur la ronde.';
COMMENT ON COLUMN public.horse_race_rounds.payout_multiplier IS 'Multiplicateur de gain associé à la ronde.';
COMMENT ON COLUMN public.horse_race_rounds.win_amount IS 'Gain obtenu sur cette ronde.';
COMMENT ON COLUMN public.horse_race_rounds.status IS 'Statut de la ronde : won, lost, paid ou completed.';
COMMENT ON COLUMN public.horse_race_rounds.metadata IS 'Métadonnées additionnelles de la ronde au format JSONB.';
COMMENT ON COLUMN public.horse_race_rounds.created_at IS 'Date de création de la ronde.';
