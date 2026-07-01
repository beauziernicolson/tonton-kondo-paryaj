-- Tonton Kondo / ParyajPam – Penalty V1 schema
-- Ajout du support penalty pour les tickets et création des tables de ronde et de mises.
-- Ce script est safe à exécuter plusieurs fois autant que possible.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Étendre la contrainte game_type sur public.tickets
ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_game_type_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_game_type_check
  CHECK (game_type IN ('borlette', 'mariage', 'lotto3', 'lotto4', 'lotto5', 'keno', 'roulette', 'lucky6', 'penalty'));

-- 2) Table des rondes Penalty
CREATE TABLE IF NOT EXISTS public.penalty_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ticket_id UUID NULL,
  total_bet_amount NUMERIC NOT NULL DEFAULT 0,
  total_win_amount NUMERIC NOT NULL DEFAULT 0,
  result_type TEXT NOT NULL,
  result_value TEXT NOT NULL,
  result_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT penalty_rounds_total_bet_amount_check
    CHECK (total_bet_amount >= 0),
  CONSTRAINT penalty_rounds_total_win_amount_check
    CHECK (total_win_amount >= 0),
  CONSTRAINT penalty_rounds_result_type_check
    CHECK (result_type IN ('sector', 'event')),
  CONSTRAINT penalty_rounds_status_check
    CHECK (status IN ('completed', 'paid', 'lost'))
);

COMMENT ON TABLE public.penalty_rounds IS 'Rondes de penalty enregistrées côté Supabase.';
COMMENT ON COLUMN public.penalty_rounds.id IS 'Identifiant unique de la ronde.';
COMMENT ON COLUMN public.penalty_rounds.user_id IS 'Utilisateur ayant joué la ronde.';
COMMENT ON COLUMN public.penalty_rounds.ticket_id IS 'Ticket associé à la ronde, si disponible.';
COMMENT ON COLUMN public.penalty_rounds.total_bet_amount IS 'Montant total misé sur la ronde.';
COMMENT ON COLUMN public.penalty_rounds.total_win_amount IS 'Montant total gagné sur la ronde.';
COMMENT ON COLUMN public.penalty_rounds.result_type IS 'Type de résultat : sector ou event.';
COMMENT ON COLUMN public.penalty_rounds.result_value IS 'Valeur du résultat : numéro de secteur ou événement.';
COMMENT ON COLUMN public.penalty_rounds.result_label IS 'Libellé humain du résultat.';
COMMENT ON COLUMN public.penalty_rounds.status IS 'Statut de la ronde : completed, paid ou lost.';
COMMENT ON COLUMN public.penalty_rounds.metadata IS 'Métadonnées additionnelles de la ronde au format JSONB.';
COMMENT ON COLUMN public.penalty_rounds.created_at IS 'Date de création de la ronde.';

-- 3) Table des mises Penalty
CREATE TABLE IF NOT EXISTS public.penalty_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL,
  user_id UUID NOT NULL,
  ticket_id UUID NULL,
  bet_type TEXT NOT NULL,
  bet_value TEXT NOT NULL,
  bet_label TEXT,
  amount NUMERIC NOT NULL,
  payout_multiplier NUMERIC NOT NULL DEFAULT 0,
  win_amount NUMERIC NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'lost',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT penalty_bets_round_id_fk
    FOREIGN KEY (round_id) REFERENCES public.penalty_rounds(id) ON DELETE CASCADE,
  CONSTRAINT penalty_bets_amount_check
    CHECK (amount > 0),
  CONSTRAINT penalty_bets_payout_multiplier_check
    CHECK (payout_multiplier >= 0),
  CONSTRAINT penalty_bets_win_amount_check
    CHECK (win_amount >= 0),
  CONSTRAINT penalty_bets_outcome_check
    CHECK (outcome IN ('won', 'lost')),
  CONSTRAINT penalty_bets_bet_type_check
    CHECK (bet_type IN ('sector', 'range', 'color', 'event', 'random'))
);

COMMENT ON TABLE public.penalty_bets IS 'Mises individuelles enregistrées pour une ronde Penalty.';
COMMENT ON COLUMN public.penalty_bets.id IS 'Identifiant unique de la mise.';
COMMENT ON COLUMN public.penalty_bets.round_id IS 'Référence vers la ronde parente.';
COMMENT ON COLUMN public.penalty_bets.user_id IS 'Utilisateur ayant placé la mise.';
COMMENT ON COLUMN public.penalty_bets.ticket_id IS 'Ticket associé à la mise, si disponible.';
COMMENT ON COLUMN public.penalty_bets.bet_type IS 'Type de mise : sector, range, color, event ou random.';
COMMENT ON COLUMN public.penalty_bets.bet_value IS 'Valeur associée à la mise (secteur, plage, couleur, événement ou random).';
COMMENT ON COLUMN public.penalty_bets.bet_label IS 'Libellé humain de la mise.';
COMMENT ON COLUMN public.penalty_bets.amount IS 'Montant de la mise.';
COMMENT ON COLUMN public.penalty_bets.payout_multiplier IS 'Multiplicateur de gain associé à la mise.';
COMMENT ON COLUMN public.penalty_bets.win_amount IS 'Gain obtenu sur cette mise.';
COMMENT ON COLUMN public.penalty_bets.outcome IS 'Résultat de la mise : won ou lost.';
COMMENT ON COLUMN public.penalty_bets.created_at IS 'Date de création de la mise.';

-- 4) Index utiles
CREATE INDEX IF NOT EXISTS idx_penalty_rounds_user_id ON public.penalty_rounds(user_id);
CREATE INDEX IF NOT EXISTS idx_penalty_rounds_ticket_id ON public.penalty_rounds(ticket_id);
CREATE INDEX IF NOT EXISTS idx_penalty_rounds_created_at ON public.penalty_rounds(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_penalty_bets_round_id ON public.penalty_bets(round_id);
CREATE INDEX IF NOT EXISTS idx_penalty_bets_user_id ON public.penalty_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_penalty_bets_ticket_id ON public.penalty_bets(ticket_id);

-- 5) Tests SQL
-- Vérifier la contrainte tickets
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'tickets_game_type_check';

-- Vérifier les tables
SELECT to_regclass('public.penalty_rounds') AS penalty_rounds;
SELECT to_regclass('public.penalty_bets') AS penalty_bets;

-- Vérifier les index
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('penalty_rounds', 'penalty_bets');

-- Insert de test
WITH inserted_round AS (
  INSERT INTO public.penalty_rounds (user_id, ticket_id, total_bet_amount, total_win_amount, result_type, result_value, result_label)
  VALUES (gen_random_uuid(), NULL, 100, 180, 'sector', '7', 'Secteur 7')
  RETURNING id
)
INSERT INTO public.penalty_bets (round_id, user_id, ticket_id, bet_type, bet_value, bet_label, amount, payout_multiplier, win_amount, outcome)
SELECT id, gen_random_uuid(), NULL, 'sector', '7', 'Secteur 7', 100, 20, 180, 'won'
FROM inserted_round;

-- Delete de nettoyage
DELETE FROM public.penalty_rounds
WHERE result_label = 'Secteur 7'
  AND result_value = '7';
