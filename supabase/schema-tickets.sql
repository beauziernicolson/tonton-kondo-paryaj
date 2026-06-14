-- Tonton Kondo – Phase 2.2 : schéma des tickets Borlette
-- Cette structure prépare l’enregistrement réel des tickets et de leurs lignes.
-- L’interface Borlette reste encore locale pour l’instant ; la persistance réelle
-- sera branchée dans la prochaine étape via Supabase.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL DEFAULT 'borlette',
  total_amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'HTG',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tickets_game_type_check
    CHECK (game_type IN ('borlette', 'mariage')),
  CONSTRAINT tickets_status_check
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'lost', 'won', 'paid')),
  CONSTRAINT tickets_total_amount_positive
    CHECK (total_amount > 0)
);

COMMENT ON TABLE public.tickets IS
 'Tickets Borlette enregistrés dans Supabase. Un ticket regroupe une commande de jeu avec un montant total.';
COMMENT ON COLUMN public.tickets.id IS 'Identifiant unique du ticket.';
COMMENT ON COLUMN public.tickets.ticket_number IS 'Numéro unique du ticket généré pour l’identification et le suivi.';
COMMENT ON COLUMN public.tickets.user_id IS 'Utilisateur propriétaire du ticket, lié à public.profiles(id).';
COMMENT ON COLUMN public.tickets.game_type IS 'Type de jeu : borlette ou mariage.';
COMMENT ON COLUMN public.tickets.total_amount IS 'Montant total du ticket en devise HTG.';
COMMENT ON COLUMN public.tickets.currency IS 'Devise utilisée pour le ticket.';
COMMENT ON COLUMN public.tickets.status IS 'Statut du ticket : pending, confirmed, cancelled, lost, won, paid.';
COMMENT ON COLUMN public.tickets.created_at IS 'Date de création du ticket.';
COMMENT ON COLUMN public.tickets.updated_at IS 'Date de dernière modification du ticket.';

CREATE TABLE IF NOT EXISTS public.ticket_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  number_played TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  potential_win NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ticket_items_number_played_check
    CHECK (length(trim(number_played)) > 0),
  CONSTRAINT ticket_items_status_check
    CHECK (status IN ('pending', 'lost', 'won', 'paid')),
  CONSTRAINT ticket_items_amount_positive
    CHECK (amount > 0),
  CONSTRAINT ticket_items_potential_win_non_negative
    CHECK (potential_win IS NULL OR potential_win >= 0)
);

COMMENT ON TABLE public.ticket_items IS
 'Lignes de ticket associées à un ticket principal. Chaque ligne représente un numéro joué et son montant.';
COMMENT ON COLUMN public.ticket_items.id IS 'Identifiant unique de la ligne de ticket.';
COMMENT ON COLUMN public.ticket_items.ticket_id IS 'Référence vers le ticket parent.';
COMMENT ON COLUMN public.ticket_items.number_played IS 'Numéro joué pour cette ligne du ticket.';
COMMENT ON COLUMN public.ticket_items.amount IS 'Montant de cette ligne.';
COMMENT ON COLUMN public.ticket_items.potential_win IS 'Gain potentiel estimé pour la ligne, laissé nul jusqu’au calcul métier.';
COMMENT ON COLUMN public.ticket_items.status IS 'Statut de la ligne : pending, lost, won, paid.';
COMMENT ON COLUMN public.ticket_items.created_at IS 'Date de création de la ligne.';

CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON public.tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON public.tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_items_ticket_id ON public.ticket_items(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_items_status ON public.ticket_items(status);

COMMENT ON INDEX public.idx_tickets_user_id IS 'Index pour retrouver les tickets d’un utilisateur.';
COMMENT ON INDEX public.idx_tickets_status IS 'Index pour filtrer les tickets par statut.';
COMMENT ON INDEX public.idx_tickets_created_at IS 'Index pour trier les tickets par date.';
COMMENT ON INDEX public.idx_ticket_items_ticket_id IS 'Index pour retrouver rapidement les lignes d’un ticket.';
COMMENT ON INDEX public.idx_ticket_items_status IS 'Index pour filtrer les lignes par statut.';
