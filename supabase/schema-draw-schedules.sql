-- Tonton Kondo – Phase 5.1 : table centrale des tirages
-- Cette table centralise les tirages actifs disponibles par jeu.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.draw_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_type TEXT NOT NULL,
  draw_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  draw_time TIME,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT draw_schedules_game_type_check
    CHECK (game_type IN ('borlette', 'mariage', 'lotto3', 'lotto4', 'lotto5')),
  CONSTRAINT draw_schedules_draw_name_not_blank
    CHECK (length(trim(draw_name)) > 0),
  CONSTRAINT draw_schedules_display_name_not_blank
    CHECK (length(trim(display_name)) > 0)
);

COMMENT ON TABLE public.draw_schedules IS
 'Tirages actifs centralisés par jeu pour Borlette, Mariage et autres jeux.';
COMMENT ON COLUMN public.draw_schedules.id IS 'Identifiant unique du tirage.';
COMMENT ON COLUMN public.draw_schedules.game_type IS 'Type de jeu associé au tirage.';
COMMENT ON COLUMN public.draw_schedules.draw_name IS 'Nom technique du tirage.';
COMMENT ON COLUMN public.draw_schedules.display_name IS 'Libellé affiché dans l’interface.';
COMMENT ON COLUMN public.draw_schedules.draw_time IS 'Heure du tirage si disponible.';
COMMENT ON COLUMN public.draw_schedules.timezone IS 'Fuseau horaire du tirage.';
COMMENT ON COLUMN public.draw_schedules.is_active IS 'Indique si le tirage est actif.';
COMMENT ON COLUMN public.draw_schedules.sort_order IS 'Ordre d’affichage des tirages.';
COMMENT ON COLUMN public.draw_schedules.created_by IS 'Admin ayant créé le tirage.';
COMMENT ON COLUMN public.draw_schedules.created_at IS 'Date de création.';
COMMENT ON COLUMN public.draw_schedules.updated_at IS 'Date de dernière modification.';

CREATE INDEX IF NOT EXISTS idx_draw_schedules_game_type ON public.draw_schedules(game_type);
CREATE INDEX IF NOT EXISTS idx_draw_schedules_active ON public.draw_schedules(is_active);
CREATE INDEX IF NOT EXISTS idx_draw_schedules_sort_order ON public.draw_schedules(game_type, sort_order, draw_name);

COMMENT ON INDEX public.idx_draw_schedules_game_type IS 'Index pour filtrer les tirages par jeu.';
COMMENT ON INDEX public.idx_draw_schedules_active IS 'Index pour filtrer les tirages actifs.';
COMMENT ON INDEX public.idx_draw_schedules_sort_order IS 'Index pour l’ordre d’affichage des tirages.';

INSERT INTO public.draw_schedules (game_type, draw_name, display_name, draw_time, timezone, is_active, sort_order)
VALUES
  ('borlette', 'New York Midday', 'New York Midday', NULL, 'America/New_York', true, 1),
  ('borlette', 'New York Evening', 'New York Evening', NULL, 'America/New_York', true, 2),
  ('borlette', 'Florida Midday', 'Florida Midday', NULL, 'America/New_York', true, 3),
  ('borlette', 'Florida Evening', 'Florida Evening', NULL, 'America/New_York', true, 4),
  ('mariage', 'New York Midday', 'New York Midday', NULL, 'America/New_York', true, 1),
  ('mariage', 'New York Evening', 'New York Evening', NULL, 'America/New_York', true, 2),
  ('mariage', 'Florida Midday', 'Florida Midday', NULL, 'America/New_York', true, 3),
  ('mariage', 'Florida Evening', 'Florida Evening', NULL, 'America/New_York', true, 4)
ON CONFLICT DO NOTHING;
