# Correction i18n — passe dynamique

## Problèmes corrigés

- Boucle infinie de `MutationObserver` supprimée.
- L'observateur surveille maintenant uniquement l'ajout de nouveaux nœuds (`childList` + `subtree`).
- Les textes dynamiques ajoutés par JavaScript sont traduits sans observer `characterData` ni les attributs.
- Un seul observateur peut être actif à la fois.
- Les formats de nombres et de dates utilisent désormais la langue active (`fr-FR`, `ht-HT`, `en-US`) au lieu d'être toujours forcés en français.
- Les traductions manquantes les plus fréquentes ont été ajoutées, notamment les textes de solde, de mises du jour, de connexion, de sélection et d'états de jeu.

## Fichiers principaux concernés

- `js/i18n.js`
- `locales/fr.json`
- `locales/ht.json`
- `locales/en.json`
- Pages HTML et scripts contenant des formats `fr-FR` codés en dur.

## Vérifications effectuées

- Syntaxe de `js/i18n.js` validée avec `node --check`.
- 78 scripts JavaScript inline extraits et validés avec `node --check`.
- Les trois JSON sont valides et ont la même structure.
- Audit des chaînes françaises dynamiques : seules trois traces de debug non visibles restent hors dictionnaire.

## Important

Le nouvel observateur est volontairement limité. Il traduit les nouveaux éléments et les nouveaux nœuds texte, mais ne surveille pas les modifications de caractères provoquées par le moteur lui-même. Cela empêche le gel des pages.
