# Architecture d’authentification Tonton Kondo

## Objectif
Cette structure prépare l’intégration Supabase Auth sans activer de connexion réelle pour l’instant.

## Pourquoi des rôles
Les rôles permettent de séparer les parcours utilisateur dès la phase de conception :
- client : accès standard au tableau de bord personnel
- agent : futur accès de support / gestion de transactions
- admin : supervision et gestion des opérations
- super_admin : administration avancée avec droits étendus

## Rôles prévus
- client -> dashboard.html
- agent -> agent/dashboard.html
- admin -> admin/dashboard.html
- super_admin -> admin/dashboard.html

## Fonctionnement prévu
1. Le développeur remplit les vraies valeurs Supabase dans js/auth-config.js.
2. Les fonctions de js/auth.js seront branchées aux appels Supabase Auth.
3. Les formulaires HTML utiliseront ces fonctions sans logique dangereuse côté frontend.
4. Les pages de destination seront choisies selon le rôle de l’utilisateur une fois l’authentification réelle activée.

## Étape suivante Supabase
- créer la configuration projet dans Supabase
- renseigner URL et clé anon dans js/auth-config.js
- activer les politiques et rôles côté base de données
- connecter les fonctions de js/auth.js aux vrais appels Auth
- ajouter les règles de redirection et de session de manière sécurisée
