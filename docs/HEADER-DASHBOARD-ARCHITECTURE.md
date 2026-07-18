# Architecture CSS protégée

## Fichiers

- `assets/tk-paryajpam-inspired.css` : socle global stable utilisé notamment par les jeux.
- `assets/main-header.css` : header principal, balance, notifications, menu utilisateur et barre bleue mobile.
- `assets/dashboard.css` : contenu et responsive du dashboard uniquement.
- `components/main-site-header.html` : structure HTML réutilisable du header principal.

## Ordre de chargement pour les pages principales

```html
<link rel="stylesheet" href="assets/tk-paryajpam-inspired.css">
<link rel="stylesheet" href="assets/main-header.css">
<link rel="stylesheet" href="assets/NOM-DE-LA-PAGE.css">
```

## Pages de jeux

Ne jamais charger `main-header.css` ni `dashboard.css` dans les pages de jeux déjà finalisées.
Les jeux conservent uniquement leurs CSS actuels.
