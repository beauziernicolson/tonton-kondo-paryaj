# Architecture de base de données des comptes

## Rôle de profiles
La table profiles stocke les informations principales de chaque compte utilisateur.
Elle sert de référence pour le nom, le téléphone, l’email, le rôle et le statut.

## Rôle de wallets
La table wallets conserve le solde et la devise de chaque compte utilisateur.
Elle est prévue pour évoluer vers des opérations de dépôt, retrait et suivi financier.

## Rôle de activity_logs
La table activity_logs enregistre les événements liés aux comptes et aux actions utilisateur.
Elle permet de tracer ce qui s’est passé sans exposer la logique métier côté frontend.

## Pourquoi séparer profile et wallet
La séparation est importante pour distinguer :
- les informations d’identité et de compte (profiles)
- les informations financières (wallets)

Cela rend la structure plus claire, plus sécurisée et plus facile à maintenir.

## Pourquoi le wallet ne doit pas être modifié directement depuis le frontend
Le frontend ne doit pas modifier directement les soldes ou les états du portefeuille.
Ces opérations doivent passer par une logique backend sécurisée, avec validation et traçabilité.

## Étape suivante
La prochaine étape consiste à ajouter les politiques RLS et les déclencheurs nécessaires dans Supabase.
Cela permettra de sécuriser les accès aux tables et de préparer une vraie implémentation de compte.
