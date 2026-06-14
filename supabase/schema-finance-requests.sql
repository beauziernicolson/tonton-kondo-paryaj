-- Tonton Kondo – Phase 3.1 : schéma des demandes financières manuelles
-- Cette structure prépare les demandes de dépôt et de retrait V1.
-- Aucune logique de wallet ni de crédit/débit n’est appliquée ici.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.deposit_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'HTG',
  method TEXT NOT NULL CHECK (method IN ('moncash', 'natcash', 'manual')),
  phone TEXT,
  reference TEXT,
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'HTG',
  method TEXT NOT NULL CHECK (method IN ('moncash', 'natcash', 'manual')),
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.deposit_requests IS
 'Demandes de dépôt manuel pour les utilisateurs Tonton Kondo.';
COMMENT ON COLUMN public.deposit_requests.id IS 'Identifiant unique de la demande de dépôt.';
COMMENT ON COLUMN public.deposit_requests.user_id IS 'Utilisateur qui a créé la demande.';
COMMENT ON COLUMN public.deposit_requests.amount IS 'Montant demandé pour le dépôt.';
COMMENT ON COLUMN public.deposit_requests.currency IS 'Devise utilisée pour la demande, par défaut HTG.';
COMMENT ON COLUMN public.deposit_requests.method IS 'Moyen de dépôt : moncash, natcash ou manual.';
COMMENT ON COLUMN public.deposit_requests.phone IS 'Numéro de téléphone associé au dépôt si nécessaire.';
COMMENT ON COLUMN public.deposit_requests.reference IS 'Référence externe ou numéro de confirmation.';
COMMENT ON COLUMN public.deposit_requests.proof_url IS 'Lien vers une preuve de paiement ou une capture.';
COMMENT ON COLUMN public.deposit_requests.status IS 'Statut de validation : pending, approved, rejected, cancelled.';
COMMENT ON COLUMN public.deposit_requests.admin_note IS 'Commentaire saisi par l’administration.';
COMMENT ON COLUMN public.deposit_requests.reviewed_by IS 'Admin ou super_admin ayant traité la demande.';
COMMENT ON COLUMN public.deposit_requests.reviewed_at IS 'Date de validation ou de refus de la demande.';
COMMENT ON COLUMN public.deposit_requests.created_at IS 'Date de création de la demande.';
COMMENT ON COLUMN public.deposit_requests.updated_at IS 'Date de dernière modification de la demande.';

COMMENT ON TABLE public.withdrawal_requests IS
 'Demandes de retrait manuel pour les utilisateurs Tonton Kondo.';
COMMENT ON COLUMN public.withdrawal_requests.id IS 'Identifiant unique de la demande de retrait.';
COMMENT ON COLUMN public.withdrawal_requests.user_id IS 'Utilisateur qui a créé la demande.';
COMMENT ON COLUMN public.withdrawal_requests.amount IS 'Montant demandé pour le retrait.';
COMMENT ON COLUMN public.withdrawal_requests.currency IS 'Devise utilisée pour la demande, par défaut HTG.';
COMMENT ON COLUMN public.withdrawal_requests.method IS 'Moyen de retrait : moncash, natcash ou manual.';
COMMENT ON COLUMN public.withdrawal_requests.phone IS 'Numéro de téléphone de réception du retrait.';
COMMENT ON COLUMN public.withdrawal_requests.status IS 'Statut de validation : pending, approved, rejected, cancelled.';
COMMENT ON COLUMN public.withdrawal_requests.admin_note IS 'Commentaire saisi par l’administration.';
COMMENT ON COLUMN public.withdrawal_requests.reviewed_by IS 'Admin ou super_admin ayant traité la demande.';
COMMENT ON COLUMN public.withdrawal_requests.reviewed_at IS 'Date de validation ou de refus de la demande.';
COMMENT ON COLUMN public.withdrawal_requests.created_at IS 'Date de création de la demande.';
COMMENT ON COLUMN public.withdrawal_requests.updated_at IS 'Date de dernière modification de la demande.';

CREATE INDEX IF NOT EXISTS idx_deposit_requests_user_id ON public.deposit_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_status ON public.deposit_requests(status);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_created_at ON public.deposit_requests(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_id ON public.withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON public.withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_created_at ON public.withdrawal_requests(created_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deposit_requests_updated_at ON public.deposit_requests;
CREATE TRIGGER trg_deposit_requests_updated_at
BEFORE UPDATE ON public.deposit_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_withdrawal_requests_updated_at ON public.withdrawal_requests;
CREATE TRIGGER trg_withdrawal_requests_updated_at
BEFORE UPDATE ON public.withdrawal_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
