-- Tonton Kondo — Phase 3A
-- Moteur central sécurisé de création des notifications.
--
-- Ce fichier :
-- - ne crée aucun trigger métier ;
-- - ne crée aucune page frontend ;
-- - n’accorde aucun accès à anon ou authenticated ;
-- - respecte les préférences stockées dans public.user_settings ;
-- - empêche les doublons grâce à p_dedup_key ;
-- - utilise public.notifications comme table centrale.

-- =========================================================
-- Nettoyage des anciennes signatures
-- =========================================================

DROP FUNCTION IF EXISTS public.create_system_notification(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  JSONB,
  TEXT,
  TIMESTAMPTZ,
  TEXT
);

DROP FUNCTION IF EXISTS public.create_notification(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  JSONB,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TEXT
);

-- =========================================================
-- Fonction centrale de création
-- =========================================================
--
-- Les paramètres obligatoires sont placés avant tous les
-- paramètres possédant une valeur DEFAULT.
-- Ceci est obligatoire en PostgreSQL.

CREATE FUNCTION public.create_notification(
  p_recipient_id UUID,
  p_recipient_role TEXT,
  p_type TEXT,
  p_category TEXT,
  p_title TEXT,
  p_message TEXT,
  p_priority TEXT DEFAULT 'normal',
  p_action_url TEXT DEFAULT NULL,
  p_action_label TEXT DEFAULT NULL,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_sender_id UUID DEFAULT NULL,
  p_sender_role TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_dedup_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  created BOOLEAN,
  skipped_reason TEXT,
  notification_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient_exists BOOLEAN;
  v_sender_exists BOOLEAN;
  v_effective_metadata JSONB;
  v_notification_id UUID;
  v_preference_enabled BOOLEAN := true;

  v_notification_results BOOLEAN;
  v_notification_deposits BOOLEAN;
  v_notification_withdrawals BOOLEAN;
  v_notification_promotions BOOLEAN;
  v_notification_security BOOLEAN;

  v_duplicate_exists BOOLEAN := false;
  v_clean_dedup_key TEXT;
BEGIN
  -- -------------------------------------------------------
  -- Destinataire
  -- -------------------------------------------------------

  IF p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'p_recipient_id est requis.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id = p_recipient_id
  )
  INTO v_recipient_exists;

  IF NOT v_recipient_exists THEN
    RAISE EXCEPTION
      'Le destinataire % n’existe pas dans auth.users.',
      p_recipient_id;
  END IF;

  -- -------------------------------------------------------
  -- Rôles
  -- -------------------------------------------------------

  IF p_recipient_role IS NULL
     OR p_recipient_role NOT IN (
       'client',
       'agent',
       'admin',
       'super_admin',
       'merchant',
       'employee',
       'system'
     )
  THEN
    RAISE EXCEPTION 'p_recipient_role invalide.';
  END IF;

  IF p_sender_role IS NOT NULL
     AND p_sender_role NOT IN (
       'client',
       'agent',
       'admin',
       'super_admin',
       'merchant',
       'employee',
       'system'
     )
  THEN
    RAISE EXCEPTION 'p_sender_role invalide.';
  END IF;

  -- -------------------------------------------------------
  -- Expéditeur
  -- -------------------------------------------------------

  IF p_sender_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM auth.users AS auth_user
      WHERE auth_user.id = p_sender_id
    )
    INTO v_sender_exists;

    IF NOT v_sender_exists THEN
      RAISE EXCEPTION
        'Le sender_id % n’existe pas dans auth.users.',
        p_sender_id;
    END IF;
  END IF;

  -- -------------------------------------------------------
  -- Catégorie et priorité
  -- -------------------------------------------------------

  IF p_category IS NULL
     OR p_category NOT IN (
       'ticket',
       'wallet',
       'deposit',
       'withdrawal',
       'promotion',
       'security',
       'admin',
       'merchant',
       'system',
       'result'
     )
  THEN
    RAISE EXCEPTION 'p_category invalide.';
  END IF;

  IF p_priority IS NULL
     OR p_priority NOT IN (
       'low',
       'normal',
       'high',
       'critical'
     )
  THEN
    RAISE EXCEPTION 'p_priority invalide.';
  END IF;

  -- -------------------------------------------------------
  -- Champs textuels obligatoires
  -- -------------------------------------------------------

  IF p_type IS NULL OR btrim(p_type) = '' THEN
    RAISE EXCEPTION 'p_type ne peut pas être vide.';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'p_title ne peut pas être vide.';
  END IF;

  IF p_message IS NULL OR btrim(p_message) = '' THEN
    RAISE EXCEPTION 'p_message ne peut pas être vide.';
  END IF;

  -- -------------------------------------------------------
  -- URL interne
  -- -------------------------------------------------------

  IF p_action_url IS NOT NULL THEN
    p_action_url := NULLIF(btrim(p_action_url), '');

    IF p_action_url IS NOT NULL THEN
      -- Refus des protocoles externes ou dangereux.
      IF p_action_url ~* '^(javascript:|data:|vbscript:|https?://|//)' THEN
        RAISE EXCEPTION
          'p_action_url doit être une route interne relative.';
      END IF;

      -- Refus des antislashs et caractères de contrôle.
      IF p_action_url ~ '[\\[:cntrl:]]' THEN
        RAISE EXCEPTION
          'p_action_url contient des caractères interdits.';
      END IF;

      -- Accepte par exemple :
      -- tickets.html
      -- tickets.html?id=123
      -- /tickets.html
      -- jeux/games.html
      -- results.html#latest
      IF p_action_url !~
        '^/?[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*(\?[A-Za-z0-9._~!$&''()*+,;=:@/?%-]*)?(#[A-Za-z0-9._~!$&''()*+,;=:@/?%-]*)?$'
      THEN
        RAISE EXCEPTION
          'p_action_url doit être une route interne relative valide.';
      END IF;
    END IF;
  END IF;

  -- -------------------------------------------------------
  -- Métadonnées
  -- -------------------------------------------------------

  v_effective_metadata := COALESCE(p_metadata, '{}'::jsonb);

  IF jsonb_typeof(v_effective_metadata) <> 'object' THEN
    RAISE EXCEPTION
      'p_metadata doit être un objet JSONB.';
  END IF;

  -- -------------------------------------------------------
  -- Expiration
  -- -------------------------------------------------------

  IF p_expires_at IS NOT NULL
     AND p_expires_at <= now()
  THEN
    RAISE EXCEPTION
      'p_expires_at doit être une date future.';
  END IF;

  -- -------------------------------------------------------
  -- Préférences utilisateur
  -- -------------------------------------------------------
  --
  -- Si aucune ligne user_settings n’existe, les variables
  -- restent NULL et COALESCE applique les valeurs système.

  SELECT
    settings.notification_results,
    settings.notification_deposits,
    settings.notification_withdrawals,
    settings.notification_promotions,
    settings.notification_security
  INTO
    v_notification_results,
    v_notification_deposits,
    v_notification_withdrawals,
    v_notification_promotions,
    v_notification_security
  FROM public.user_settings AS settings
  WHERE settings.user_id = p_recipient_id;

  CASE p_category
    WHEN 'result' THEN
      v_preference_enabled :=
        COALESCE(v_notification_results, true);

    WHEN 'ticket' THEN
      v_preference_enabled :=
        COALESCE(v_notification_results, true);

    WHEN 'deposit' THEN
      v_preference_enabled :=
        COALESCE(v_notification_deposits, true);

    WHEN 'withdrawal' THEN
      v_preference_enabled :=
        COALESCE(v_notification_withdrawals, true);

    WHEN 'promotion' THEN
      v_preference_enabled :=
        COALESCE(v_notification_promotions, false);

    WHEN 'security' THEN
      v_preference_enabled :=
        COALESCE(v_notification_security, true);

    ELSE
      -- wallet, admin, merchant et system ne sont pas bloqués
      -- par une préférence dans cette version.
      v_preference_enabled := true;
  END CASE;

  IF NOT v_preference_enabled THEN
    RETURN QUERY
    SELECT
      false,
      'preference_disabled'::TEXT,
      NULL::UUID;

    RETURN;
  END IF;

  -- -------------------------------------------------------
  -- Déduplication
  -- -------------------------------------------------------

  v_clean_dedup_key := NULLIF(btrim(p_dedup_key), '');

  IF v_clean_dedup_key IS NOT NULL THEN
    -- Verrou transactionnel empêchant deux appels simultanés
    -- de créer la même notification.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        p_recipient_id::TEXT || ':' || v_clean_dedup_key,
        0
      )
    );

    v_effective_metadata :=
      v_effective_metadata
      || jsonb_build_object('dedup_key', v_clean_dedup_key);

    SELECT EXISTS (
      SELECT 1
      FROM public.notifications AS notification
      WHERE notification.recipient_id = p_recipient_id
        AND notification.is_archived = false
        AND (
          notification.expires_at IS NULL
          OR notification.expires_at > now()
        )
        AND notification.metadata ->> 'dedup_key'
          = v_clean_dedup_key
    )
    INTO v_duplicate_exists;

    IF v_duplicate_exists THEN
      RETURN QUERY
      SELECT
        false,
        'duplicate'::TEXT,
        NULL::UUID;

      RETURN;
    END IF;
  END IF;

  -- -------------------------------------------------------
  -- Création
  -- -------------------------------------------------------

  INSERT INTO public.notifications (
    recipient_id,
    recipient_role,
    sender_id,
    sender_role,
    type,
    category,
    priority,
    title,
    message,
    action_url,
    action_label,
    entity_type,
    entity_id,
    metadata,
    expires_at
  )
  VALUES (
    p_recipient_id,
    p_recipient_role,
    p_sender_id,
    p_sender_role,
    btrim(p_type),
    p_category,
    p_priority,
    btrim(p_title),
    btrim(p_message),
    p_action_url,
    NULLIF(btrim(p_action_label), ''),
    NULLIF(btrim(p_entity_type), ''),
    p_entity_id,
    v_effective_metadata,
    p_expires_at
  )
  RETURNING notifications.id
  INTO v_notification_id;

  RETURN QUERY
  SELECT
    true,
    NULL::TEXT,
    v_notification_id;
END;
$$;

-- Aucun accès PUBLIC, anon ou authenticated.
REVOKE ALL ON FUNCTION public.create_notification(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  JSONB,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TEXT
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_notification(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  JSONB,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TEXT
) FROM anon;

REVOKE ALL ON FUNCTION public.create_notification(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  JSONB,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.create_notification(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  JSONB,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TEXT
) TO service_role;

COMMENT ON FUNCTION public.create_notification(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  JSONB,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TEXT
) IS
'Point central sécurisé de création des notifications. Respecte les préférences de user_settings, refuse les URL externes, empêche les doublons via p_dedup_key et reste inaccessible au frontend.';

-- =========================================================
-- Fonction système simplifiée
-- =========================================================

CREATE FUNCTION public.create_system_notification(
  p_recipient_id UUID,
  p_type TEXT,
  p_category TEXT,
  p_title TEXT,
  p_message TEXT,
  p_action_url TEXT DEFAULT NULL,
  p_action_label TEXT DEFAULT NULL,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_priority TEXT DEFAULT 'normal',
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_dedup_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  created BOOLEAN,
  skipped_reason TEXT,
  notification_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient_role TEXT;
BEGIN
  -- profiles.id correspond à auth.users.id dans ce projet.
  SELECT profile.role
  INTO v_recipient_role
  FROM public.profiles AS profile
  WHERE profile.id = p_recipient_id;

  v_recipient_role :=
    COALESCE(v_recipient_role, 'client');

  RETURN QUERY
  SELECT
    result.created,
    result.skipped_reason,
    result.notification_id
  FROM public.create_notification(
    p_recipient_id => p_recipient_id,
    p_recipient_role => v_recipient_role,
    p_type => p_type,
    p_category => p_category,
    p_title => p_title,
    p_message => p_message,
    p_priority => p_priority,
    p_action_url => p_action_url,
    p_action_label => p_action_label,
    p_entity_type => p_entity_type,
    p_entity_id => p_entity_id,
    p_metadata => p_metadata,
    p_sender_id => NULL,
    p_sender_role => 'system',
    p_expires_at => p_expires_at,
    p_dedup_key => p_dedup_key
  ) AS result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_system_notification(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  JSONB,
  TEXT,
  TIMESTAMPTZ,
  TEXT
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_system_notification(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  JSONB,
  TEXT,
  TIMESTAMPTZ,
  TEXT
) FROM anon;

REVOKE ALL ON FUNCTION public.create_system_notification(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  JSONB,
  TEXT,
  TIMESTAMPTZ,
  TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.create_system_notification(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  JSONB,
  TEXT,
  TIMESTAMPTZ,
  TEXT
) TO service_role;

COMMENT ON FUNCTION public.create_system_notification(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  JSONB,
  TEXT,
  TIMESTAMPTZ,
  TEXT
) IS
'Fonction système interne simplifiée. Récupère le rôle du destinataire depuis public.profiles puis délègue la création à public.create_notification().';

NOTIFY pgrst, 'reload schema';