-- Tonton Kondo – Phase 2 : fonctions RPC sécurisées pour la lecture et la gestion des notifications
-- Cette phase ne crée pas la création de notifications. Elle expose uniquement des RPC
-- de lecture et de mise à jour contrôlée, avec auth.uid() comme source de vérité.
-- Aucune fonction n’accepte un recipient_id libre depuis le frontend.

CREATE OR REPLACE FUNCTION public.get_notifications(
  p_category TEXT DEFAULT NULL,
  p_unread_only BOOLEAN DEFAULT false,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  recipient_id UUID,
  recipient_role TEXT,
  sender_id UUID,
  sender_role TEXT,
  type TEXT,
  category TEXT,
  priority TEXT,
  title TEXT,
  message TEXT,
  action_url TEXT,
  action_label TEXT,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB,
  is_read BOOLEAN,
  read_at TIMESTAMPTZ,
  is_archived BOOLEAN,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour accéder aux notifications.';
  END IF;

  IF p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit doit être compris entre 1 et 100.';
  END IF;

  IF p_offset < 0 THEN
    RAISE EXCEPTION 'p_offset doit être supérieur ou égal à 0.';
  END IF;

  IF p_category IS NOT NULL AND p_category NOT IN ('ticket', 'wallet', 'deposit', 'withdrawal', 'promotion', 'security', 'admin', 'merchant', 'system', 'result') THEN
    RAISE EXCEPTION 'Catégorie de notification invalide.';
  END IF;

  RETURN QUERY
  SELECT
    n.id,
    n.recipient_id,
    n.recipient_role,
    n.sender_id,
    n.sender_role,
    n.type,
    n.category,
    n.priority,
    n.title,
    n.message,
    n.action_url,
    n.action_label,
    n.entity_type,
    n.entity_id,
    n.metadata,
    n.is_read,
    n.read_at,
    n.is_archived,
    n.expires_at,
    n.created_at,
    n.updated_at
  FROM public.notifications AS n
  WHERE n.recipient_id = v_user_id
    AND n.is_archived = false
    AND (n.expires_at IS NULL OR n.expires_at > now())
    AND (p_category IS NULL OR n.category = p_category)
    AND (p_unread_only = false OR n.is_read = false)
  ORDER BY
    CASE n.priority
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'normal' THEN 3
      WHEN 'low' THEN 4
      ELSE 5
    END ASC,
    n.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_notifications(TEXT, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notifications(TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.count_unread_notifications()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_count BIGINT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour accéder aux notifications.';
  END IF;

  SELECT COUNT(*)::BIGINT
    INTO v_count
  FROM public.notifications AS n
  WHERE n.recipient_id = v_user_id
    AND n.is_read = false
    AND n.is_archived = false
    AND (n.expires_at IS NULL OR n.expires_at > now());

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.count_unread_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_unread_notifications() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_notification_read(
  p_notification_id UUID
)
RETURNS TABLE (
  id UUID,
  is_read BOOLEAN,
  read_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour accéder aux notifications.';
  END IF;

  UPDATE public.notifications AS n
     SET is_read = true,
         read_at = COALESCE(n.read_at, now()),
         updated_at = now()
   WHERE n.id = p_notification_id
     AND n.recipient_id = v_user_id
   RETURNING
     n.id,
     n.is_read,
     n.read_at,
     n.updated_at
  INTO id, is_read, read_at, updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification introuvable ou non autorisée pour cet utilisateur.';
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_rows_updated INTEGER;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour accéder aux notifications.';
  END IF;

  UPDATE public.notifications AS n
     SET is_read = true,
         read_at = now(),
         updated_at = now()
   WHERE n.recipient_id = v_user_id
     AND n.is_read = false
     AND n.is_archived = false
     AND (n.expires_at IS NULL OR n.expires_at > now());

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_notification(
  p_notification_id UUID
)
RETURNS TABLE (
  id UUID,
  is_archived BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour accéder aux notifications.';
  END IF;

  UPDATE public.notifications AS n
     SET is_archived = true,
         updated_at = now()
   WHERE n.id = p_notification_id
     AND n.recipient_id = v_user_id
   RETURNING
     n.id,
     n.is_archived,
     n.updated_at
  INTO id, is_archived, updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification introuvable ou non autorisée pour cet utilisateur.';
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_notification(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_notification(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.unarchive_notification(
  p_notification_id UUID
)
RETURNS TABLE (
  id UUID,
  is_archived BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour accéder aux notifications.';
  END IF;

  UPDATE public.notifications AS n
     SET is_archived = false,
         updated_at = now()
   WHERE n.id = p_notification_id
     AND n.recipient_id = v_user_id
   RETURNING
     n.id,
     n.is_archived,
     n.updated_at
  INTO id, is_archived, updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification introuvable ou non autorisée pour cet utilisateur.';
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.unarchive_notification(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unarchive_notification(UUID) TO authenticated;
