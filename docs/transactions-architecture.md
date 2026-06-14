# Architecture des transactions financières Tonton Kondo

## Pourquoi une table transactions
La table transactions centralise les mouvements financiers liés aux comptes utilisateurs.
Elle permet d’enregistrer chaque opération avec un type, un montant, un statut et une référence unique.

## Pourquoi wallets.balance ne doit pas être modifié directement
Le solde du wallet est une donnée sensible.
Il ne doit jamais être ajusté directement depuis le frontend, car cela pourrait créer des incohérences, des erreurs de comptabilité ou des manipulations non sécurisées.

## Différence entre les types de transactions
- deposit : ajout de fonds
- withdrawal : retrait de fonds
- bet : mise effectuée par l’utilisateur
- win : gain obtenu
- refund : remboursement ou retour de montant
- commission : frais ou commission appliqués
- adjustment : correction ou ajustement manuel

## Pourquoi le statut est important
Le statut permet de suivre l’état de chaque mouvement :
- pending : en attente
- approved : validé
- rejected : refusé
- cancelled : annulé
- completed : terminé

## Comment la transaction influencera le solde plus tard
Une transaction servira de source de vérité pour les opérations financières.
Plus tard, une fonction SQL sécurisée ou une Edge Function appliquera la transaction au wallet en validant le montant, le type et le statut.

## Prochaine étape
La prochaine étape consiste à créer la fonction SQL sécurisée apply_transaction(), puis à brancher cette logique côté backend.
