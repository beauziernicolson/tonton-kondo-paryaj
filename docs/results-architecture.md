# Architecture des résultats Borlette

## Objectif
Cette phase prépare la saisie manuelle des tirages officiels Borlette dans Supabase.
Elle ne calcule pas encore les gagnants, ne modifie pas les tickets et ne paie aucun gain.

## Pourquoi une table draw_results
La table draw_results sert de source de vérité pour les résultats officiels.
Elle permet de stocker le tirage, sa date, le numéro gagnant, son statut et l’admin qui l’a saisi.

## V1 : saisie manuelle
Dans cette première version, les résultats arrivent manuellement depuis des sources externes.
L’interface admin permet d’entrer les informations directement dans la base de données.

## Évolution prévue
Plus tard, la même table pourra être alimentée par une API de tirage externe.
La logique de comparaison avec les tickets Borlette sera ajoutée ensuite pour détecter les gagnants.

## Ce qui est volontairement hors périmètre
Pour cette phase, les éléments suivants ne sont pas encore implémentés :
- calcul des gains
- paiement des gains
- modification des tickets
- modification des wallets
- intégration automatique des tirages

## Prochaine étape
La prochaine étape consistant à comparer les résultats enregistrés avec les tickets Borlette afin de préparer la détection des gagnants.
