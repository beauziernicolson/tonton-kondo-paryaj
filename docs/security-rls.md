# Sécurité RLS pour les comptes Tonton Kondo

## Qu’est-ce que RLS
RLS (Row Level Security) permet de limiter l’accès aux lignes d’une table selon l’utilisateur connecté.
Il s’agit d’une couche de sécurité indispensable pour éviter que le frontend ne manipule directement des données sensibles.

## Pourquoi c’est obligatoire
Les tables profiles, wallets et activity_logs contiennent des informations liées au compte, au solde et à l’historique des actions.
Sans RLS, un utilisateur pourrait potentiellement accéder ou modifier des données qui ne lui appartiennent pas.

## Pourquoi le wallet ne doit jamais être modifié depuis le frontend
Le solde est une donnée sensible et critique.
Les modifications de balance doivent toujours passer par un backend sécurisé, une fonction SQL dédiée ou une Edge Function, afin d’éviter toute corruption ou manipulation non autorisée.

## Pourquoi le rôle ne doit jamais être modifié par le client
Le rôle détermine les droits d’accès et les permissions de l’utilisateur.
Un client ne doit pas pouvoir s’octroyer des droits d’admin ou de super_admin via le frontend.
Cette modification doit être contrôlée uniquement côté backend ou via des règles métier strictes.

## Prochaine étape
La prochaine étape consiste à ajouter des fonctions sécurisées pour les transactions, puis à connecter les politiques RLS à des appels backend fiables.
