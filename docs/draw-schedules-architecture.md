# Draw schedules architecture

## Objectif

Centraliser les tirages disponibles par jeu dans une table unique, afin de supprimer les listes codées en dur dans Borlette, Mariage et l’admin résultats.

## Structure

La table public.draw_schedules contient :
- le type de jeu
- le nom technique du tirage
- le nom affiché
- l’heure prévue si disponible
- le fuseau horaire
- l’état actif/inactif
- l’ordre d’affichage

## Règles

- Les tirages actifs sont visibles pour les clients.
- Les admins et super_admin peuvent créer, modifier et désactiver les tirages.
- Les pages frontend doivent filtrer sur `game_type` et `is_active = true`.

## Intégration attendue

- Borlette utilisera `game_type = 'borlette'`.
- Mariage utilisera `game_type = 'mariage'`.
- L’admin résultats chargera les tirages dynamiquement selon le jeu choisi.

Cette couche reste additive et n’impacte pas la logique existante des tickets, des fonds, des transactions et des résultats.
