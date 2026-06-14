# Payouts architecture — Borlette

## Objectif

Cette phase ajoute uniquement la logique SQL de paiement automatique des gains Borlette après vérification des tickets gagnants. Elle ne touche pas l’authentification, la page Borlette, ni la page d’historique.

## Fonction ajoutée

- public.pay_borlette_winnings(p_draw_result_id UUID)

## Règles métier

1. La fonction parcourt les tickets Borlette en statut won.
2. Pour chaque ticket, elle additionne les montants des lignes gagnantes avec le multiplicateur V1 de 50.
3. Elle appelle public.apply_transaction(..., type = 'win') pour créditer le wallet de l’utilisateur.
4. Elle marque les lignes gagnantes et le ticket comme paid.
5. Elle évite de repayer un ticket déjà paid.

## Limites de la phase

- Aucun paiement n’est calculé dans le frontend.
- Aucun wallet, gain ou transaction n’est créé hors de la fonction SQL dédiée.
- Les pages existantes restent inchangées.

## Résultat retourné

- tickets_paid : nombre de tickets payés
- total_paid : montant total crédité
