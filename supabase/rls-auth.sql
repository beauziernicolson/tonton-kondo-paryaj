-- Tonton Kondo – Phase 1.4 : RLS policies de préparation
-- Ce fichier active la sécurité au niveau des lignes (RLS) sur les tables comptes.
-- Correction importante :
-- Les policies RLS ne peuvent pas utiliser OLD.role / NEW.role.
-- La protection du champ role sera renforcée plus tard avec un trigger ou une fonction admin sécurisée.

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_admin_access()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  );
$$;

COMMENT ON FUNCTION public.has_admin_access() IS
 'Vérifie si l’utilisateur connecté dispose d’un accès admin ou super_admin.';

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS
 'Vérifie si l’utilisateur connecté est administrateur.';

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'super_admin'
  );
$$;

COMMENT ON FUNCTION public.is_super_admin() IS
 'Vérifie si l’utilisateur connecté est super administrateur.';

GRANT EXECUTE ON FUNCTION public.has_admin_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_admin_access() TO anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.profiles IS
 'RLS activé sur profiles. Les politiques ci-dessous préviennent les accès non autorisés depuis le frontend.';

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  USING (id = auth.uid());

COMMENT ON POLICY profiles_select_own ON public.profiles IS
 'Un utilisateur connecté peut lire son propre profil.';

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

COMMENT ON POLICY profiles_update_own ON public.profiles IS
 'Un utilisateur connecté peut mettre à jour uniquement son propre profil. Le champ role sera protégé plus tard par trigger.';

DROP POLICY IF EXISTS profiles_select_admin ON public.profiles;
CREATE POLICY profiles_select_admin
  ON public.profiles
  FOR SELECT
  USING (public.has_admin_access());

COMMENT ON POLICY profiles_select_admin ON public.profiles IS
 'Les admins et super_admin peuvent lire tous les profils.';

DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY profiles_update_admin
  ON public.profiles
  FOR UPDATE
  USING (public.has_admin_access())
  WITH CHECK (public.has_admin_access());

COMMENT ON POLICY profiles_update_admin ON public.profiles IS
 'Les admins et super_admin peuvent modifier les profils.';

-- Note importante :
-- On ne crée PAS de policy avec OLD.role / NEW.role.
-- OLD et NEW ne sont disponibles que dans les triggers PostgreSQL.
-- Pour empêcher un client de modifier son rôle, nous ajouterons plus tard :
-- 1. un trigger prevent_role_change_for_non_admin()
-- ou
-- 2. une fonction RPC sécurisée pour les mises à jour de profil.

-- -----------------------------------------------------------------------------
-- wallets
-- -----------------------------------------------------------------------------

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.wallets IS
 'RLS activé sur wallets. Les soldes ne doivent jamais être modifiés directement depuis le frontend.';

DROP POLICY IF EXISTS wallets_select_own ON public.wallets;
CREATE POLICY wallets_select_own
  ON public.wallets
  FOR SELECT
  USING (user_id = auth.uid());

COMMENT ON POLICY wallets_select_own ON public.wallets IS
 'Un utilisateur peut lire son propre wallet.';

DROP POLICY IF EXISTS wallets_select_admin ON public.wallets;
CREATE POLICY wallets_select_admin
  ON public.wallets
  FOR SELECT
  USING (public.has_admin_access());

COMMENT ON POLICY wallets_select_admin ON public.wallets IS
 'Les admins et super_admin peuvent lire tous les wallets.';

DROP POLICY IF EXISTS wallets_block_frontend_updates ON public.wallets;
CREATE POLICY wallets_block_frontend_updates
  ON public.wallets
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY wallets_block_frontend_updates ON public.wallets IS
 'Le frontend ne doit pas pouvoir modifier directement le solde ou l’état du wallet.';

-- TODO :
-- Les agents pourront lire les wallets de leurs clients plus tard,
-- après création d’une relation agent_clients.

-- -----------------------------------------------------------------------------
-- activity_logs
-- -----------------------------------------------------------------------------

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.activity_logs IS
 'RLS activé sur activity_logs. Les logs seront créés plus tard par backend, trigger ou Edge Function.';

DROP POLICY IF EXISTS activity_logs_select_own ON public.activity_logs;
CREATE POLICY activity_logs_select_own
  ON public.activity_logs
  FOR SELECT
  USING (user_id = auth.uid());

COMMENT ON POLICY activity_logs_select_own ON public.activity_logs IS
 'Un utilisateur peut lire ses propres logs.';

DROP POLICY IF EXISTS activity_logs_select_admin ON public.activity_logs;
CREATE POLICY activity_logs_select_admin
  ON public.activity_logs
  FOR SELECT
  USING (public.has_admin_access());

COMMENT ON POLICY activity_logs_select_admin ON public.activity_logs IS
 'Les admins et super_admin peuvent lire tous les logs.';

DROP POLICY IF EXISTS activity_logs_block_frontend_writes ON public.activity_logs;
CREATE POLICY activity_logs_block_frontend_writes
  ON public.activity_logs
  FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS activity_logs_block_frontend_updates ON public.activity_logs;
CREATE POLICY activity_logs_block_frontend_updates
  ON public.activity_logs
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS activity_logs_block_frontend_deletes ON public.activity_logs;
CREATE POLICY activity_logs_block_frontend_deletes
  ON public.activity_logs
  FOR DELETE
  USING (false);

COMMENT ON POLICY activity_logs_block_frontend_writes ON public.activity_logs IS
 'Les utilisateurs normaux ne peuvent pas insérer les logs directement depuis le frontend.';

COMMENT ON POLICY activity_logs_block_frontend_updates ON public.activity_logs IS
 'Les utilisateurs normaux ne peuvent pas modifier les logs directement depuis le frontend.';

COMMENT ON POLICY activity_logs_block_frontend_deletes ON public.activity_logs IS
 'Les utilisateurs normaux ne peuvent pas supprimer les logs directement depuis le frontend.';
 
 -- Allow authenticated users to create their own profile after signup/OAuth
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;

CREATE POLICY profiles_insert_own
ON public.profiles
FOR INSERT
WITH CHECK (id = auth.uid());

COMMENT ON POLICY profiles_insert_own ON public.profiles IS
'Un utilisateur connecté peut créer uniquement son propre profil après inscription.';

-- Allow authenticated users to create their own wallet after signup/OAuth
DROP POLICY IF EXISTS wallets_insert_own ON public.wallets;

CREATE POLICY wallets_insert_own
ON public.wallets
FOR INSERT
WITH CHECK (user_id = auth.uid());

COMMENT ON POLICY wallets_insert_own ON public.wallets IS
'Un utilisateur connecté peut créer uniquement son propre wallet après inscription.';