# Vérification automatique des tickets Borlette

## Objectif
Cette fonction prépare la vérification automatique des tickets Borlette après publication d’un résultat officiel.

## Comment fonctionne la vérification
1. L’administrateur publie un résultat dans public.draw_results.
2. La fonction public.check_borlette_results(p_draw_result_id) récupère ce résultat.
3. Elle parcourt tous les tickets Borlette encore en statut pending.
4. Pour chaque ticket, elle examine toutes les lignes de ticket_items.
5. Si une ligne correspond au numéro gagnant, cette ligne passe en statut won.
6. Si aucune ligne ne correspond, la ligne passe en statut lost.
7. Si au moins une ligne d’un ticket est gagnante, le ticket passe en statut won.
8. Sinon, le ticket passe en statut lost.

## Pourquoi séparer vérification et paiement
La vérification ne fait que déterminer si un ticket est gagnant ou perdant.
Le paiement des gains, les modifications de wallet et les transactions financières seront traités dans une prochaine phase.
Cela permet de séparer clairement :
- l’analyse des résultats
- la comptabilité / paiement

## Ce qui est volontairement exclu ici
La fonction ne fait pas encore :
- calculer les montants gagnés
- payer les gains
- modifier wallet.balance
- créer des transactions
- appliquer des règles avancées de pari

## Prochaine étape
La prochaine phase consistera à automatiser le paiement des gains détectés par cette vérification.
