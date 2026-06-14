-- Tonton Kondo – Phase 2.5 : schéma des résultats de tirages Borlette
-- Cette table prépare la saisie manuelle des résultats officiels.
-- Les calculs de gains et l’impact sur les tickets seront ajoutés ultérieurement.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.draw_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_type TEXT NOT NULL DEFAULT 'borlette',
  draw_name TEXT NOT NULL,
  draw_date DATE NOT NULL,
  winning_number TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'published',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT draw_results_game_type_check
    CHECK (game_type IN ('borlette', 'mariage')),
  CONSTRAINT draw_results_source_check
    CHECK (source IN ('manual', 'api', 'import')),
  CONSTRAINT draw_results_status_check
    CHECK (status IN ('draft', 'published', 'cancelled')),
  CONSTRAINT draw_results_winning_number_check
    CHECK (length(trim(winning_number)) > 0)
);

COMMENT ON TABLE public.draw_results IS
 'Résultats officiels des tirages Borlette. La saisie est manuelle en V1, avec intégration API prévue plus tard.';
COMMENT ON COLUMN public.draw_results.id IS 'Identifiant unique du résultat de tirage.';
COMMENT ON COLUMN public.draw_results.game_type IS 'Type de jeu : borlette ou mariage.';
COMMENT ON COLUMN public.draw_results.draw_name IS 'Nom du tirage, par exemple New York Midday.';
COMMENT ON COLUMN public.draw_results.draw_date IS 'Date du tirage officiel.';
COMMENT ON COLUMN public.draw_results.winning_number IS 'Numéro gagnant officiel.';
COMMENT ON COLUMN public.draw_results.source IS 'Source du résultat : manual, api, import.';
COMMENT ON COLUMN public.draw_results.status IS 'Statut du résultat : draft, published, cancelled.';
COMMENT ON COLUMN public.draw_results.created_by IS 'Admin ayant saisi le résultat.';
COMMENT ON COLUMN public.draw_results.created_at IS 'Date de création du résultat.';
COMMENT ON COLUMN public.draw_results.updated_at IS 'Date de dernière modification du résultat.';

CREATE INDEX IF NOT EXISTS idx_draw_results_game_type ON public.draw_results(game_type);
CREATE INDEX IF NOT EXISTS idx_draw_results_draw_date ON public.draw_results(draw_date DESC);
CREATE INDEX IF NOT EXISTS idx_draw_results_status ON public.draw_results(status);
CREATE INDEX IF NOT EXISTS idx_draw_results_created_by ON public.draw_results(created_by);

COMMENT ON INDEX public.idx_draw_results_game_type IS 'Index pour filtrer les résultats par jeu.';
COMMENT ON INDEX public.idx_draw_results_draw_date IS 'Index pour trier les tirages par date.';
COMMENT ON INDEX public.idx_draw_results_status IS 'Index pour filtrer les résultats par statut.';
COMMENT ON INDEX public.idx_draw_results_created_by IS 'Index pour retrouver les résultats saisis par un administrateur.';
