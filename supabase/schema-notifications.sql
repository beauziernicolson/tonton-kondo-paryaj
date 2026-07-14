-- Tonton Kondo – Phase 1 : schéma de base du système global de notifications
-- Ce fichier crée uniquement la table de messages reçus par les utilisateurs.
-- user_settings gère les préférences utilisateur, tandis que notifications gère
-- les messages réellement envoyés et reçus.
-- entity_id est volontairement polymorphe : il peut pointer vers plusieurs tables
-- métier distinctes selon le type de notification.
-- action_url est une route interne du site, à utiliser côté frontend pour ouvrir
-- la vue concernée à partir d’une notification.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL,
  recipient_role TEXT NOT NULL DEFAULT 'client' CHECK (recipient_role IN ('client', 'agent', 'admin', 'super_admin', 'merchant', 'employee', 'system')),
  sender_id UUID NULL,
  sender_role TEXT NULL CHECK (sender_role IS NULL OR sender_role IN ('client', 'agent', 'admin', 'super_admin', 'merchant', 'employee', 'system')),
  type TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('ticket', 'wallet', 'deposit', 'withdrawal', 'promotion', 'security', 'admin', 'merchant', 'system', 'result')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT NULL,
  action_label TEXT NULL,
  entity_type TEXT NULL,
  entity_id UUID NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ NULL,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_recipient_fk
    FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT notifications_sender_fk
    FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT notifications_read_state_check
    CHECK (
      (is_read = false AND read_at IS NULL)
      OR
      (is_read = true)
    )
);

COMMENT ON TABLE public.notifications IS
 'Table de messages utilisateur pour les notifications reçues dans Tonton Kondo. user_settings gère les préférences, notifications gère les messages réellement reçus.';

COMMENT ON COLUMN public.notifications.recipient_id IS
 'Utilisateur destinataire de la notification. La lecture et la mise à jour sont limitées à ce destinataire.';
COMMENT ON COLUMN public.notifications.sender_id IS
 'Utilisateur ou service responsable de l’événement, si connu. Peut être nul pour une notification système.';
COMMENT ON COLUMN public.notifications.type IS
 'Type métier libre de la notification (ex. ticket_won, deposit_approved, withdrawal_rejected, result_published).';
COMMENT ON COLUMN public.notifications.category IS
 'Catégorie de la notification : ticket, wallet, deposit, withdrawal, promotion, security, admin, merchant, system, result.';
COMMENT ON COLUMN public.notifications.priority IS
 'Priorité de la notification : low, normal, high, critical.';
COMMENT ON COLUMN public.notifications.action_url IS
 'Route interne du site à ouvrir lorsqu’un utilisateur clique sur la notification.';
COMMENT ON COLUMN public.notifications.entity_type IS
 'Type d’entité métier liée à la notification (ticket, deposit_request, withdrawal_request, draw_result, etc.).';
COMMENT ON COLUMN public.notifications.entity_id IS
 'Identifiant polymorphe de l’entité liée. Aucune clé étrangère n’est créée ici, car plusieurs tables métier peuvent être pointées.';
COMMENT ON COLUMN public.notifications.metadata IS
 'Métadonnées additionnelles au format JSONB pour enrichir l’affichage ou le traitement futur.';
COMMENT ON COLUMN public.notifications.is_read IS
 'Indique si la notification a été lue par le destinataire.';
COMMENT ON COLUMN public.notifications.is_archived IS
 'Indique si la notification a été archivée par le destinataire.';
COMMENT ON COLUMN public.notifications.expires_at IS
 'Date d’expiration optionnelle de la notification. Utile pour les messages temporaires ou promotionnels.';

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id
  ON public.notifications(recipient_id);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_role
  ON public.notifications(recipient_role);

CREATE INDEX IF NOT EXISTS idx_notifications_category
  ON public.notifications(category);

CREATE INDEX IF NOT EXISTS idx_notifications_type
  ON public.notifications(type);

CREATE INDEX IF NOT EXISTS idx_notifications_priority
  ON public.notifications(priority);

CREATE INDEX IF NOT EXISTS idx_notifications_is_read
  ON public.notifications(is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_is_archived
  ON public.notifications(is_archived);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at_desc
  ON public.notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_expires_at
  ON public.notifications(expires_at);

CREATE INDEX IF NOT EXISTS idx_notifications_badge_lookup
  ON public.notifications(recipient_id, is_read, is_archived, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_filtered_lists
  ON public.notifications(recipient_id, category, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own
  ON public.notifications
  FOR SELECT
  USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;

-- Aucune policy INSERT pour authenticated dans cette phase.
-- Aucune policy DELETE pour authenticated dans cette phase.
-- Aucun accès anon n’est autorisé.

CREATE OR REPLACE FUNCTION public.set_notifications_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_notifications_updated_at ON public.notifications;
CREATE TRIGGER trg_set_notifications_updated_at
BEFORE UPDATE ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.set_notifications_updated_at();

REVOKE ALL ON public.notifications FROM anon;
REVOKE ALL ON public.notifications FROM authenticated;
GRANT SELECT ON public.notifications TO authenticated;

-- Les utilisateurs peuvent uniquement lire leurs propres notifications.
-- Les actions is_read, read_at et is_archived seront gérées en Phase 2
-- par des fonctions SECURITY DEFINER strictement contrôlées.
-- Aucun UPDATE direct du frontend n’est autorisé.

-- Aucune permission INSERT/DELETE n’est octroyée à authenticated dans cette phase.
-- Aucune permission n’est octroyée à anon.
-- L’insertion des notifications sera traitée plus tard via backend / fonction sécurisée / service role.
