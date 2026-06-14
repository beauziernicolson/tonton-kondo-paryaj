-- Garde-fous de production pour Borlette / Mariage.
-- Ces contraintes doivent être appliquées avec prudence et sans casser les anciens tickets.

-- Contraintes de base sur les jeux autorisés.
ALTER TABLE tickets
  ADD CONSTRAINT tickets_game_type_check
  CHECK (game_type IN ('borlette', 'mariage'));

-- Recommandation de sécurité pour draw_name.
-- IMPORTANT : corriger d’abord les anciens tickets ayant draw_name NULL avant de rendre cette colonne NOT NULL.
-- Une version plus stricte pourra être activée ensuite avec :
-- ALTER TABLE tickets
--   ALTER COLUMN draw_name SET NOT NULL;

-- Version sûre et non bloquante pour les données existantes :
ALTER TABLE tickets
  ADD CONSTRAINT tickets_draw_name_not_null_recommended
  CHECK (draw_name IS NOT NULL) NOT VALID;

-- Notes de déploiement :
-- 1) Vérifier les tickets existants avec draw_name NULL.
-- 2) Corriger les anciens tickets si nécessaire.
-- 3) Ensuite, si le contexte le permet, valider la contrainte avec :
-- ALTER TABLE tickets VALIDATE CONSTRAINT tickets_draw_name_not_null_recommended;
