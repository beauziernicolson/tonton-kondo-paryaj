-- Tonton Kondo – Phase 1.5 : schéma des transactions financières
-- Cette table prépare l’historique des mouvements financiers.
-- Les soldes ne doivent pas être modifiés directement depuis le frontend.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'HTG',
  status TEXT NOT NULL DEFAULT 'pending',
  reference TEXT UNIQUE,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transactions_type_check
    CHECK (type IN ('deposit', 'withdrawal', 'bet', 'win', 'refund', 'commission', 'adjustment')),
  CONSTRAINT transactions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
  CONSTRAINT transactions_amount_positive
    CHECK (amount > 0)
);

COMMENT ON TABLE public.transactions IS
 'Historique des mouvements financiers pour les comptes Tonton Kondo.';
COMMENT ON COLUMN public.transactions.id IS 'Identifiant unique de la transaction.';
COMMENT ON COLUMN public.transactions.user_id IS 'Utilisateur concerné par la transaction.';
COMMENT ON COLUMN public.transactions.wallet_id IS 'Portefeuille associé à la transaction.';
COMMENT ON COLUMN public.transactions.type IS 'Type de mouvement : deposit, withdrawal, bet, win, refund, commission, adjustment.';
COMMENT ON COLUMN public.transactions.amount IS 'Montant de la transaction. Doit toujours être strictement positif.';
COMMENT ON COLUMN public.transactions.currency IS 'Devise de la transaction, par défaut HTG.';
COMMENT ON COLUMN public.transactions.status IS 'Statut de la transaction : pending, approved, rejected, cancelled, completed.';
COMMENT ON COLUMN public.transactions.reference IS 'Référence unique de la transaction.';
COMMENT ON COLUMN public.transactions.description IS 'Description humaine de l’opération.';
COMMENT ON COLUMN public.transactions.metadata IS 'Métadonnées additionnelles au format JSONB.';
COMMENT ON COLUMN public.transactions.created_by IS 'Utilisateur ou service qui a créé la transaction.';
COMMENT ON COLUMN public.transactions.created_at IS 'Date de création de la transaction.';
COMMENT ON COLUMN public.transactions.updated_at IS 'Date de dernière modification de la transaction.';

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON public.transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON public.transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON public.transactions(reference);

COMMENT ON INDEX public.idx_transactions_user_id IS 'Index pour filtrer les transactions par utilisateur.';
COMMENT ON INDEX public.idx_transactions_wallet_id IS 'Index pour filtrer les transactions par portefeuille.';
COMMENT ON INDEX public.idx_transactions_type IS 'Index pour filtrer les transactions par type.';
COMMENT ON INDEX public.idx_transactions_status IS 'Index pour filtrer les transactions par statut.';
COMMENT ON INDEX public.idx_transactions_created_at IS 'Index pour trier les transactions par date.';
COMMENT ON INDEX public.idx_transactions_reference IS 'Index pour la recherche rapide par référence unique.';

-- Remarque de sécurité :
-- Les modifications de solde seront gérées plus tard via une fonction SQL sécurisée ou une Edge Function.
