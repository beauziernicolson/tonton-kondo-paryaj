-- Tonton Kondo – Phase 2.2 : politique RLS pour les tickets Borlette
-- Les règles ci-dessous préparent l’accès réel sans modifier l’interface de Borlette.

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tickets_client_select_own ON public.tickets;
DROP POLICY IF EXISTS tickets_client_insert_own ON public.tickets;
DROP POLICY IF EXISTS tickets_admin_select_all ON public.tickets;

DROP POLICY IF EXISTS ticket_items_client_select_own ON public.ticket_items;
DROP POLICY IF EXISTS ticket_items_client_insert_own ON public.ticket_items;
DROP POLICY IF EXISTS ticket_items_admin_select_all ON public.ticket_items;

CREATE POLICY tickets_client_select_own
ON public.tickets
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY tickets_client_insert_own
ON public.tickets
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY tickets_admin_select_all
ON public.tickets
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  )
);

CREATE POLICY ticket_items_client_select_own
ON public.ticket_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.tickets t
    WHERE t.id = ticket_items.ticket_id
      AND t.user_id = auth.uid()
  )
);

CREATE POLICY ticket_items_client_insert_own
ON public.ticket_items
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.tickets t
    WHERE t.id = ticket_items.ticket_id
      AND t.user_id = auth.uid()
  )
);

CREATE POLICY ticket_items_admin_select_all
ON public.ticket_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  )
);

-- Remarque : les droits de mise à jour / suppression des statuts seront étendus
-- plus tard pour les admins et super_admins, dans la phase de gestion des tickets.
