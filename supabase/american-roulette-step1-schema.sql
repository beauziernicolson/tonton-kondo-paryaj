-- Tonton Kondo / ParyajPam – American Roulette schema (step1)
-- Ajoute les tables de rondes et de mises pour American Roulette
-- Ce script est idempotent autant que possible.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Étendre la contrainte game_type sur public.tickets pour inclure american_roulette
ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_game_type_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_game_type_check
  CHECK (game_type IN (
    'borlette', 'mariage', 'lotto3', 'lotto4', 'lotto5',
    'keno', 'roulette', 'lucky6', 'penalty', 'horse_racing', 'american_roulette'
  ));

-- 2) Table des rondes American Roulette
CREATE TABLE IF NOT EXISTS public.american_roulette_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ticket_id UUID NULL,
  winning_slot TEXT NOT NULL,
  winning_color TEXT NOT NULL,
  total_bet_amount NUMERIC NOT NULL DEFAULT 0,
  total_win_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT american_roulette_rounds_winning_slot_check
    CHECK (winning_slot IN (
      '0','00','1','2','3','4','5','6','7','8','9','10',
      '11','12','13','14','15','16','17','18','19','20','21','22','23','24',
      '25','26','27','28','29','30','31','32','33','34','35','36'
    )),
  CONSTRAINT american_roulette_rounds_winning_color_check
    CHECK (winning_color IN ('green', 'red', 'black')),
  CONSTRAINT american_roulette_rounds_total_bet_amount_check
    CHECK (total_bet_amount >= 0),
  CONSTRAINT american_roulette_rounds_total_win_amount_check
    CHECK (total_win_amount >= 0),
  CONSTRAINT american_roulette_rounds_status_check
    CHECK (status IN ('completed', 'paid', 'lost'))
);

COMMENT ON TABLE public.american_roulette_rounds IS 'Rondes de American Roulette enregistrées côté Supabase.';
COMMENT ON COLUMN public.american_roulette_rounds.id IS 'Identifiant unique de la ronde.';
COMMENT ON COLUMN public.american_roulette_rounds.user_id IS 'Utilisateur ayant joué la ronde.';
COMMENT ON COLUMN public.american_roulette_rounds.ticket_id IS 'Ticket associé à la ronde, si disponible.';
COMMENT ON COLUMN public.american_roulette_rounds.winning_slot IS 'Slot gagnant (texte) : 0, 00 ou 1–36.';
COMMENT ON COLUMN public.american_roulette_rounds.winning_color IS 'Couleur gagnante : green, red ou black.';
COMMENT ON COLUMN public.american_roulette_rounds.total_bet_amount IS 'Montant total misé sur la ronde.';
COMMENT ON COLUMN public.american_roulette_rounds.total_win_amount IS 'Montant total gagné sur la ronde.';
COMMENT ON COLUMN public.american_roulette_rounds.status IS 'Statut de la ronde : completed, paid ou lost.';
COMMENT ON COLUMN public.american_roulette_rounds.metadata IS 'Métadonnées additionnelles de la ronde au format JSONB.';
COMMENT ON COLUMN public.american_roulette_rounds.created_at IS 'Date de création de la ronde.';

-- 3) Table des mises American Roulette
CREATE TABLE IF NOT EXISTS public.american_roulette_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL,
  user_id UUID NOT NULL,
  ticket_id UUID NULL,
  bet_key TEXT NOT NULL,
  bet_label TEXT,
  bet_type TEXT NOT NULL,
  bet_value TEXT,
  amount NUMERIC NOT NULL,
  payout_multiplier NUMERIC NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'lost',
  win_amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT american_roulette_bets_round_id_fk
    FOREIGN KEY (round_id) REFERENCES public.american_roulette_rounds(id) ON DELETE CASCADE,
  CONSTRAINT american_roulette_bets_amount_check
    CHECK (amount > 0),
  CONSTRAINT american_roulette_bets_payout_multiplier_check
    CHECK (payout_multiplier >= 0),
  CONSTRAINT american_roulette_bets_win_amount_check
    CHECK (win_amount >= 0),
  CONSTRAINT american_roulette_bets_outcome_check
    CHECK (outcome IN ('won', 'lost')),
  CONSTRAINT american_roulette_bets_bet_type_check
    CHECK (bet_type IN ('number','color','parity','range','dozen','column'))
);

COMMENT ON TABLE public.american_roulette_bets IS 'Mises individuelles enregistrées pour une ronde American Roulette.';
COMMENT ON COLUMN public.american_roulette_bets.id IS 'Identifiant unique de la mise.';
COMMENT ON COLUMN public.american_roulette_bets.round_id IS 'Référence vers la ronde parente.';
COMMENT ON COLUMN public.american_roulette_bets.user_id IS 'Utilisateur ayant placé la mise.';
COMMENT ON COLUMN public.american_roulette_bets.ticket_id IS 'Ticket associé à la mise, si disponible.';
COMMENT ON COLUMN public.american_roulette_bets.bet_key IS 'Clé interne de la mise (ex. n:17, n:00, red, dozen1).';
COMMENT ON COLUMN public.american_roulette_bets.bet_label IS 'Libellé humain de la mise.';
COMMENT ON COLUMN public.american_roulette_bets.bet_type IS 'Type de mise : number, color, parity, range, dozen, column.';
COMMENT ON COLUMN public.american_roulette_bets.bet_value IS 'Valeur associée à la mise si nécessaire.';
COMMENT ON COLUMN public.american_roulette_bets.amount IS 'Montant de la mise.';
COMMENT ON COLUMN public.american_roulette_bets.payout_multiplier IS 'Multiplicateur de gain associé à la mise.';
COMMENT ON COLUMN public.american_roulette_bets.outcome IS 'Résultat final de la mise : won ou lost.';
COMMENT ON COLUMN public.american_roulette_bets.win_amount IS 'Gain obtenu sur cette mise.';
COMMENT ON COLUMN public.american_roulette_bets.created_at IS 'Date de création de la mise.';

-- 4) Index utiles
CREATE INDEX IF NOT EXISTS idx_american_roulette_rounds_user_id ON public.american_roulette_rounds(user_id);
CREATE INDEX IF NOT EXISTS idx_american_roulette_rounds_ticket_id ON public.american_roulette_rounds(ticket_id);
CREATE INDEX IF NOT EXISTS idx_american_roulette_rounds_created_at ON public.american_roulette_rounds(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_american_roulette_bets_round_id ON public.american_roulette_bets(round_id);
CREATE INDEX IF NOT EXISTS idx_american_roulette_bets_user_id ON public.american_roulette_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_american_roulette_bets_ticket_id ON public.american_roulette_bets(ticket_id);

-- End of file
