ALTER TABLE public.draw_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS draw_schedules_client_select_active ON public.draw_schedules;
DROP POLICY IF EXISTS draw_schedules_admin_read ON public.draw_schedules;
DROP POLICY IF EXISTS draw_schedules_admin_write ON public.draw_schedules;
DROP POLICY IF EXISTS draw_schedules_admin_update ON public.draw_schedules;

CREATE POLICY draw_schedules_client_select_active
ON public.draw_schedules
FOR SELECT
TO authenticated
USING (is_active = true);

CREATE POLICY draw_schedules_admin_read
ON public.draw_schedules
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  )
);

CREATE POLICY draw_schedules_admin_write
ON public.draw_schedules
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  )
);

CREATE POLICY draw_schedules_admin_update
ON public.draw_schedules
FOR UPDATE
TO authenticated
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

CREATE POLICY draw_schedules_admin_delete
ON public.draw_schedules
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  )
);
