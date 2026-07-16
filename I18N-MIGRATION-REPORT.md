# Migration multilingue — Tonton Kondo

## Travail effectué

- 45 pages HTML actives reliées au moteur global `js/i18n.js`.
- Chemins relatifs corrigés automatiquement pour les pages racine, `jeux/`, `admin/`, `agent/` et `login-register/`.
- Français (`fr`), kreyòl ayisyen (`ht`) et anglais (`en`) disponibles.
- 1 089 textes statiques indexés dans chaque fichier de langue.
- 179 expressions communes prévues pour traduire les contenus dynamiques ajoutés par JavaScript.
- Traduction automatique des textes, placeholders, `title` et `aria-label` des anciennes pages.
- `MutationObserver` activé pour traduire aussi les éléments créés après le chargement de la page.
- Les pages déjà migrées avec `data-i18n` continuent d’utiliser leurs clés structurées.
- Les pages de règles des jeux ont reçu des corrections manuelles supplémentaires pour rendre les explications plus naturelles.

## Fichiers principaux modifiés

- `js/i18n.js`
- `locales/fr.json`
- `locales/ht.json`
- `locales/en.json`
- Toutes les pages HTML actives, sauf les deux anciennes maquettes :
  - `dashboard.backup.html`
  - `dashboard2.html`

## Vérifications effectuées

- Syntaxe de `js/i18n.js` validée avec `node --check`.
- Syntaxe de tous les scripts JavaScript inline validée.
- Les trois fichiers JSON sont valides et possèdent exactement la même structure.
- Chaque page active charge exactement une fois `js/i18n.js` avec un chemin existant.
- Chaque page active possède une initialisation i18n, ou conserve son initialisation personnalisée existante.
- Aucune modification des fichiers SQL, des RPC, des calculs, des paiements ou de la logique Supabase.

## Important

La structure multilingue est complète. Les textes longs ont été migrés en lot et les principales pages d’aide ont été polies manuellement. Une dernière relecture humaine reste recommandée pour ajuster certaines tournures spécifiques en kreyòl ou en anglais selon le ton commercial souhaité.
