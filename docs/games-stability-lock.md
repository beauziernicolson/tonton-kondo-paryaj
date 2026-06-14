# Games Stability Lock

## Objectif
Ce document sert de garde-fou pour Borlette et Mariage pendant le développement de Lotto 3, Lotto 4, Lotto 5 et des outils Agents.

## Borlette
- tickets.game_type doit rester `borlette` pour les tickets Borlette.
- tickets.draw_name doit toujours être renseigné pour les tickets Borlette.
- ticket_items.number_played doit contenir la boule jouée, au format `00` à `99`.
- Le résultat Borlette repose sur 3 lots (1er, 2e, 3e lot).
- Les gains Borlette sont calculés avec les multiplicateurs :
  - 1er lot : x60
  - 2e lot : x20
  - 3e lot : x10
- Le trigger de résultat Borlette doit continuer à traiter uniquement les tickets Borlette.
- Le paiement doit passer par `potential_win` et non par une logique réutilisée ailleurs.

## Mariage
- tickets.game_type doit rester `mariage` pour les tickets Mariage.
- tickets.draw_name doit toujours être renseigné pour les tickets Mariage.
- ticket_items.number_played doit contenir la combinaison, au format `AA-BB`.
- Mariage dépend des 3 lots Borlette du même tirage.
- Les deux numéros doivent être présents dans les 3 lots du tirage.
- L’ordre des deux numéros n’a pas d’importance.
- Le gain Mariage est calculé avec x5000.
- Mariage ne doit pas être traité comme un résultat séparé de Borlette.

## Règles critiques
- Ne jamais retirer `draw_name` de `tickets`.
- Ne jamais forcer `Mariage` en `game_type = borlette`.
- Ne jamais réutiliser la même `reference` de transaction pour `bet` et `win`.

## Règles de développement
- Les futures évolutions Lotto 3 / Lotto 4 / Lotto 5 doivent conserver la logique Borlette/Mariage intacte.
- Les modifications de résultats, paiements et tickets doivent rester isolées des autres jeux.
- Toute nouvelle logique doit d’abord vérifier la cohérence des tickets, des tirages et des références de transaction.
