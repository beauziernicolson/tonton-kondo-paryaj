-- Tonton Kondo – schéma dédié aux préférences utilisateur
-- Fichier autonome pour la future page settings.html.
-- Aucune modification des tables existantes n’est effectuée ici.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  language TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'ht', 'en')),
  currency TEXT NOT NULL DEFAULT 'HTG' CHECK (currency IN ('HTG', 'USD')),
  notification_results BOOLEAN NOT NULL DEFAULT true,
  notification_deposits BOOLEAN NOT NULL DEFAULT true,
  notification_withdrawals BOOLEAN NOT NULL DEFAULT true,
  notification_promotions BOOLEAN NOT NULL DEFAULT false,
  notification_security BOOLEAN NOT NULL DEFAULT true,
  game_sounds BOOLEAN NOT NULL DEFAULT true,
  notification_sounds BOOLEAN NOT NULL DEFAULT true,
  reduced_motion BOOLEAN NOT NULL DEFAULT false,
  ui_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  game_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_settings_user_fk
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Exemples de contenu futurs pour les JSONB (commentaires uniquement, pas de données insérées) :
-- ui_preferences = {
--   "compact_mode": false,
--   "show_balance": true,
--   "theme": "dark"
-- }
--
-- game_preferences = {
--   "favorite_game": "keno",
--   "default_bet": 25,
--   "confirm_large_bets": true
-- }

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON public.user_settings(user_id);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_settings_select_own ON public.user_settings;
CREATE POLICY user_settings_select_own
  ON public.user_settings
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_settings_insert_own ON public.user_settings;
CREATE POLICY user_settings_insert_own
  ON public.user_settings
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_settings_update_own ON public.user_settings;
CREATE POLICY user_settings_update_own
  ON public.user_settings
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_user_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_user_settings_updated_at ON public.user_settings;
CREATE TRIGGER trg_set_user_settings_updated_at
BEFORE UPDATE ON public.user_settings
FOR EACH ROW
EXECUTE FUNCTION public.set_user_settings_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_user_settings(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  language TEXT,
  currency TEXT,
  notification_results BOOLEAN,
  notification_deposits BOOLEAN,
  notification_withdrawals BOOLEAN,
  notification_promotions BOOLEAN,
  notification_security BOOLEAN,
  game_sounds BOOLEAN,
  notification_sounds BOOLEAN,
  reduced_motion BOOLEAN,
  ui_preferences JSONB,
  game_preferences JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Accès refusé : vous ne pouvez garantir que les paramètres que vous avez demandé pour cet utilisateur.';
  END IF;

  INSERT INTO public.user_settings (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN QUERY
  SELECT
    us.id,
    us.user_id,
    us.language,
    us.currency,
    us.notification_results,
    us.notification_deposits,
    us.notification_withdrawals,
    us.notification_promotions,
    us.notification_security,
    us.game_sounds,
    us.notification_sounds,
    us.reduced_motion,
    us.ui_preferences,
    us.game_preferences,
    us.created_at,
    us.updated_at
  FROM public.user_settings us
  WHERE us.user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_user_settings(UUID) TO authenticated;
