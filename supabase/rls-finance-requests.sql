-- Tonton Kondo – Phase 3.1 : RLS des demandes de dépôt et de retrait
-- Les clients ne peuvent gérer que leurs propres demandes.
-- Les admins et super_admin peuvent consulter toutes les demandes et les traiter.

ALTER TABLE public.deposit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deposit_requests_client_insert ON public.deposit_requests;
DROP POLICY IF EXISTS deposit_requests_client_select_own ON public.deposit_requests;
DROP POLICY IF EXISTS deposit_requests_client_update_own ON public.deposit_requests;
DROP POLICY IF EXISTS deposit_requests_admin_select_all ON public.deposit_requests;
DROP POLICY IF EXISTS deposit_requests_admin_update_all ON public.deposit_requests;

DROP POLICY IF EXISTS withdrawal_requests_client_insert ON public.withdrawal_requests;
DROP POLICY IF EXISTS withdrawal_requests_client_select_own ON public.withdrawal_requests;
DROP POLICY IF EXISTS withdrawal_requests_client_update_own ON public.withdrawal_requests;
DROP POLICY IF EXISTS withdrawal_requests_admin_select_all ON public.withdrawal_requests;
DROP POLICY IF EXISTS withdrawal_requests_admin_update_all ON public.withdrawal_requests;

CREATE POLICY deposit_requests_client_insert
ON public.deposit_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY deposit_requests_client_select_own
ON public.deposit_requests
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY deposit_requests_client_update_own
ON public.deposit_requests
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
  AND reviewed_by IS NULL
  AND reviewed_at IS NULL
);

CREATE POLICY deposit_requests_admin_select_all
ON public.deposit_requests
FOR SELECT
TO authenticated
USING (public.is_admin() OR public.is_super_admin());

CREATE POLICY deposit_requests_admin_update_all
ON public.deposit_requests
FOR UPDATE
TO authenticated
USING (public.is_admin() OR public.is_super_admin())
WITH CHECK (public.is_admin() OR public.is_super_admin());

CREATE POLICY withdrawal_requests_client_insert
ON public.withdrawal_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY withdrawal_requests_client_select_own
ON public.withdrawal_requests
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY withdrawal_requests_client_update_own
ON public.withdrawal_requests
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
  AND reviewed_by IS NULL
  AND reviewed_at IS NULL
);

CREATE POLICY withdrawal_requests_admin_select_all
ON public.withdrawal_requests
FOR SELECT
TO authenticated
USING (public.is_admin() OR public.is_super_admin());

CREATE POLICY withdrawal_requests_admin_update_all
ON public.withdrawal_requests
FOR UPDATE
TO authenticated
USING (public.is_admin() OR public.is_super_admin())
WITH CHECK (public.is_admin() OR public.is_super_admin());
