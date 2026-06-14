-- Tonton Kondo – Phase 2.5 : politiques RLS pour les résultats de tirages
-- Les clients peuvent lire les résultats publiés, les admins gèrent la saisie manuelle.

ALTER TABLE public.draw_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS draw_results_client_select_published ON public.draw_results;
DROP POLICY IF EXISTS draw_results_admin_select_all ON public.draw_results;
DROP POLICY IF EXISTS draw_results_admin_manage ON public.draw_results;

CREATE POLICY draw_results_client_select_published
ON public.draw_results
FOR SELECT
USING (status = 'published');

CREATE POLICY draw_results_admin_select_all
ON public.draw_results
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  )
);

CREATE POLICY draw_results_admin_manage
ON public.draw_results
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  )
);

CREATE POLICY draw_results_admin_update
ON public.draw_results
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  )
);

CREATE POLICY draw_results_admin_delete
ON public.draw_results
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  )
);

-- Remarque : les vérifications des tickets gagnants seront ajoutées dans la phase suivante.
