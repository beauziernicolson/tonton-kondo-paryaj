# Lotto 3 V1 — architecture

## Objectif
Lotto 3 V1 utilise un numéro unique à 3 chiffres (000 à 999) et compare ce numéro au premier lot complet officiel du tirage Borlette.

## Flux principal
1. L’utilisateur choisit un tirage Lotto 3.
2. Il saisit un numéro à 3 chiffres et une mise.
3. Le ticket est enregistré dans public.tickets avec game_type = lotto3.
4. Le résultat Borlette publié déclenche la vérification Lotto 3.
5. Les tickets gagnants sont payés via public.apply_transaction.

## Règles V1
- Ordre exact obligatoire.
- Gain = mise × 500.
- Le résultat est basé sur le 1er lot complet Borlette.
- Les écritures de ticket, résultat et paiement restent isolées des autres jeux.

## Notes de stabilité
- Ne pas modifier Borlette / Mariage / Wallet / Transactions / Auth.
- Les fonctions Lotto 3 doivent être ajoutées sans casser les fonctions existantes.
