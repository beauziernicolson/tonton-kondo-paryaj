# Refonte des composants de la page d’accueil

## Direction
La palette blanche, bleu navy et jaune a été conservée. La composition de `index.html` a été entièrement reconstruite afin d’abandonner les anciennes cartes répétitives et l’apparence de dashboard générique.

## Nouveaux composants
- hero éditorial asymétrique ;
- bande de contrôle du compte ;
- sélection de jeux sous forme de catalogue éditorial ;
- parcours en trois étapes ;
- accès directs au portefeuille, tickets et résultats ;
- bande de moyens de paiement ;
- grand appel à l’action jaune ;
- footer simplifié.

## Compatibilité préservée
Les identifiants utilisés par le JavaScript ont été conservés : solde, tickets actifs, gains du jour, mises du jour, actions du hero et liste des jeux.

Aucune requête Supabase, fonction JavaScript métier, table SQL, route de page ou logique de jeu n’a été modifiée.
