# Mariage results automation V2

## Objectif

La logique Mariage est désormais calculée automatiquement à partir des 3 lots Borlette d’un tirage publié, sans créer de résultat Mariage indépendant.

## Flux V2

1. L’administrateur publie un résultat Borlette dans public.draw_results avec les champs :
   - game_type = 'borlette'
   - draw_name
   - first_prize_number
   - second_prize_number
   - third_prize_number
   - status = 'published'
2. Le trigger public.handle_draw_result_published() exécute dans l’ordre :
   - public.check_borlette_results(NEW.id)
   - public.pay_borlette_winnings(NEW.id)
   - public.check_mariage_results(NEW.id)
   - public.pay_mariage_winnings(NEW.id)
3. Les tickets Mariage en statut pending sont vérifiés à partir des 3 lots Borlette du même tirage.
4. Les tickets gagnants obtiennent un gain potentiel égal à amount × 5000.
5. Le paiement est effectué via public.apply_transaction() avec metadata.game_type = 'mariage' et metadata.source_game_type = 'borlette'.

## Règles métiers

- Un ticket Mariage contient deux numéros au format 12-85.
- Les deux numéros doivent figurer parmi les 3 lots Borlette du tirage.
- L’ordre n’a pas d’importance.
- Gain potentiel : mise × 5000.
- Les tickets déjà payés ne doivent pas être repayés.

## Notes de conformité

- Borlette n’est pas modifiée.
- apply_transaction, wallet et auth restent inchangés.
- La page admin ne publie plus de résultat Mariage indépendant.
