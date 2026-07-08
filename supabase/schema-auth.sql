-- Tonton Kondo – Phase 1.3 : schéma Supabase pour les comptes
-- Ce fichier crée uniquement la structure de base attendue pour les profils, rôles,
-- portefeuilles et journaux d’activité. Les politiques RLS seront ajoutées à l’étape suivante.

-- Remarque importante :
-- Les tables ci-dessous sont prévues pour être liées à auth.users.
-- Les politiques de sécurité (RLS) ne sont pas encore activées ici.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table des profils utilisateurs.
-- Chaque utilisateur auth.users possède un profil associé.
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  full_name TEXT,
  phone TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'client',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_role_check
    CHECK (role IN ('client', 'agent', 'admin', 'super_admin')),
  CONSTRAINT profiles_status_check
    CHECK (status IN ('active', 'inactive', 'suspended'))
);

COMMENT ON TABLE profiles IS 'Profils utilisateurs de Tonton Kondo. Les rôles autorisés sont client, agent, admin et super_admin.';
COMMENT ON COLUMN profiles.id IS 'Identifiant lié à auth.users.id.';
COMMENT ON COLUMN profiles.full_name IS 'Nom complet affiché dans l’interface.';
COMMENT ON COLUMN profiles.phone IS 'Numéro de téléphone de contact.';
COMMENT ON COLUMN profiles.email IS 'Adresse email principale du compte.';
COMMENT ON COLUMN profiles.role IS 'Rôle utilisateur : client, agent, admin, super_admin.';
COMMENT ON COLUMN profiles.status IS 'Statut du compte : active, inactive, suspended.';
COMMENT ON COLUMN profiles.created_at IS 'Date de création du profil.';
COMMENT ON COLUMN profiles.updated_at IS 'Date de dernière modification du profil.';

-- Table des portefeuilles.
-- Un portefeuille est associé à un profil utilisateur.
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  balance NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'HTG',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallets_user_fk
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT wallets_status_check
    CHECK (status IN ('active', 'inactive', 'locked'))
);

COMMENT ON TABLE wallets IS 'Portefeuilles utilisateurs. Les montants seront gérés côté backend à l’étape suivante.';
COMMENT ON COLUMN wallets.id IS 'Identifiant unique du portefeuille.';
COMMENT ON COLUMN wallets.user_id IS 'Référence vers profiles.id.';
COMMENT ON COLUMN wallets.balance IS 'Solde courant du portefeuille.';
COMMENT ON COLUMN wallets.currency IS 'Devise utilisée. Valeur par défaut HTG.';
COMMENT ON COLUMN wallets.status IS 'Statut du portefeuille : active, inactive, locked.';
COMMENT ON COLUMN wallets.created_at IS 'Date de création du portefeuille.';
COMMENT ON COLUMN wallets.updated_at IS 'Date de dernière modification du portefeuille.';

-- Table de journalisation des actions.
-- Utilisée pour tracer les activités utilisateur sans exposer la logique métier côté frontend.
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT activity_logs_user_fk
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE activity_logs IS 'Journal des événements utilisateurs. Les politiques RLS seront ajoutées dans la prochaine étape.';
COMMENT ON COLUMN activity_logs.user_id IS 'Utilisateur concerné par l’action, si disponible.';
COMMENT ON COLUMN activity_logs.action IS 'Nom de l’action effectuée.';
COMMENT ON COLUMN activity_logs.details IS 'Détails de l’action au format JSONB.';
COMMENT ON COLUMN activity_logs.created_at IS 'Date et heure de l’événement.';

-- Index utiles pour les recherches fréquentes.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_unique ON public.profiles(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_status ON wallets(status);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);

-- Les RLS policies seront ajoutées à l’étape suivante.
-- Ce fichier ne crée pas encore de sécurité avancée, uniquement la base structurelle.
