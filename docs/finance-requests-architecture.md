# Architecture des demandes financières V1

## Objectif
Les tables deposit_requests et withdrawal_requests permettent de préparer les demandes financières manuelles sans encore modifier les soldes wallet.

## Tables prévues

### deposit_requests
Stocke les demandes de dépôt manuel avec les champs suivants :
- user_id : utilisateur qui a créé la demande
- amount, currency, method : montant, devise et moyen de paiement
- phone, reference, proof_url : informations de suivi et justificatif
- status : pending, approved, rejected, cancelled
- admin_note, reviewed_by, reviewed_at : éléments de validation admin

### withdrawal_requests
Stocke les demandes de retrait manuel avec les champs suivants :
- user_id : utilisateur qui a créé la demande
- amount, currency, method : montant, devise et moyen de paiement
- phone : numéro de réception obligatoire
- status : pending, approved, rejected, cancelled
- admin_note, reviewed_by, reviewed_at : éléments de validation admin

## Règles métier attendues
- Le client peut créer une demande pour lui-même.
- Le client peut consulter ses propres demandes.
- Les admins et super_admin peuvent consulter toutes les demandes.
- Les admins et super_admin peuvent valider ou refuser une demande.
- Le client ne doit pas pouvoir modifier lui-même le statut, le validateur ni la date de revue.

## Limite volontaire de la phase V1
Aucune logique de crédit ou de débit n’est encore appliquée dans cette phase.
La table sert uniquement d’outil de collecte et de suivi de demandes financières.

## Sécurité
Les politiques RLS seront utilisées pour verrouiller les accès par utilisateur et par rôle.
L’objectif est de garder les opérations de validation côté administration, sans exposer la modification du solde au frontend.

## Prochaines étapes prévues
1. Ajouter les pages HTML de dépôt / retrait / validation admin.
2. Brancher les demandes à la logique backend sécurisée.
3. Mettre en place la création de transactions et l’ajustement des wallets uniquement après validation.
