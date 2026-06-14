# Architecture des tickets Borlette

## Objectif
Ce document définit la structure de base attendue pour enregistrer les tickets Borlette dans Supabase.
Il prépare la prochaine étape de branchement de la page Borlette sur la base de données sans modifier l’interface actuelle.

## Différence entre tickets et ticket_items
- La table tickets représente le ticket principal : un ensemble de numéros joués, un montant total, un statut et un propriétaire.
- La table ticket_items représente les lignes détaillées de ce ticket : chaque numéro joué, son montant, et son état de traitement.

En pratique :
- 1 ticket = 1 commande / 1 validation de jeu
- 1 ticket peut contenir plusieurs numéros, car un utilisateur peut jouer plusieurs lignes dans un même coupon

## Pourquoi un ticket peut contenir plusieurs numéros
Un coupon Borlette permet de jouer plusieurs combinaisons dans un même envoi.
Par exemple, un joueur peut choisir 3 numéros différents avec des montants distincts, et chaque numéro doit être gardé séparément pour le suivi, les gains et les statuts de ligne.

## Statuts prévus
### tickets
- pending : ticket créé mais non encore confirmé
- confirmed : ticket validé et prêt pour le traitement
- cancelled : ticket annulé
- lost : ticket perdu après tirage
- won : ticket gagnant
- paid : gain versé ou ticket finalisé

### ticket_items
- pending : ligne en attente
- lost : ligne perdante
- won : ligne gagnante
- paid : montant de ligne payé

## Rôle des politiques RLS
Les règles de sécurité prévues permettent de garantir que :
- un client ne peut lire ou créer que ses propres tickets
- un client ne peut lire ou créer que les lignes associées à ses tickets
- un admin ou super_admin peut lire les tickets et items de tous les utilisateurs

Ces règles sont conçues pour préparer un branchement sécurisé sur la page Borlette, sans exposer la logique métier dans l’UI.

## Prochaine étape
La prochaine phase consistera à brancher la page Borlette sur Supabase en:
1. récupérant le coupon local
2. créant le ticket principal dans public.tickets
3. créant les lignes correspondantes dans public.ticket_items
4. puis gérer les statuts et les résultats après intégration complète

## Remarque de conception
Les calculs de gains, les tirages et les résultats ne sont pas encore implémentés dans cette phase.
Les fichiers SQL et la documentation ajoutés ici servent uniquement de base structurelle et de sécurité pour l’étape suivante.
