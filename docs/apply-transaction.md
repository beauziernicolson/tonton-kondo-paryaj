# Fonction apply_transaction()

## Pourquoi cette fonction existe
La fonction apply_transaction() centralise toutes les mises à jour de solde liées aux transactions financières.
Elle empêche les modifications directes du wallet depuis le frontend et garantit que chaque mouvement passe par une logique contrôlée.

## Pourquoi on n’update jamais wallet.balance directement
Le solde d’un wallet est une donnée critique. Il doit toujours être modifié avec une trace complète :
- type de transaction
- montant
- référence unique
- statut de validation
- journal d’activité

Modifier directement balance depuis le frontend serait non sécurisé et non traçable.

## Exemple : deposit
Une transaction de type deposit ajoute un montant au solde du wallet et enregistre l’opération dans transactions et activity_logs.

## Exemple : bet
Une transaction de type bet diminue le solde si le montant demandé est disponible.
Si le solde est insuffisant, la fonction lève une erreur et aucune modification n’est enregistrée.

## Exemple : win
Une transaction de type win augmente le solde, ce qui permet de refléter un gain gagné par le joueur.

## Exemple : solde insuffisant
Si un retrait ou une mise dépasse le solde actuel, la fonction refuse l’opération et ne modifie ni le wallet ni les logs.

## Prochaine étape
La prochaine étape consiste à créer des dépôts et retraits sécurisés côté interface admin, puis à appeler cette fonction depuis un backend ou une Edge Function contrôlée.
