-- Lotto 4 Step 2b migration
-- Copie les tirages Lotto 3 existants vers Lotto 4 sans modifier les triggers ou les fonctions.

INSERT INTO public.draw_schedules (
  game_type,
  draw_name,
  display_name,
  draw_time,
  timezone,
  is_active,
  sort_order,
  created_by,
  created_at,
  updated_at
)
SELECT
  'lotto4' AS game_type,
  REPLACE(REPLACE(src.draw_name, 'lotto3', 'lotto4'), 'lotto-3', 'lotto-4') AS draw_name,
  REPLACE(src.display_name, 'Lotto 3', 'Lotto 4') AS display_name,
  src.draw_time,
  src.timezone,
  src.is_active,
  src.sort_order,
  src.created_by,
  NOW() AS created_at,
  NOW() AS updated_at
FROM public.draw_schedules src
WHERE src.game_type = 'lotto3'
  AND NOT EXISTS (
    SELECT 1
    FROM public.draw_schedules dst
    WHERE dst.game_type = 'lotto4'
      AND dst.draw_name = REPLACE(REPLACE(src.draw_name, 'lotto3', 'lotto4'), 'lotto-3', 'lotto-4')
      AND dst.draw_time = src.draw_time
  );
