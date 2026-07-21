# Phase 2 — Restauration intelligente de la localisation i18n V3

## Résultat

La version actuelle a été conservée comme base fonctionnelle. La couche i18n V3 a été restaurée depuis la dernière version stable, tandis que les ajouts récents Promotions, PlopPlop, Supabase et sécurité ont été préservés.

## Dictionnaires

| Langue | Stable V3 | Projet cassé | Après fusion | Clés récentes conservées |
|---|---:|---:|---:|---:|
| Français | 3097 | 1492 | 3110 | 13 |
| English | 3097 | 1492 | 3110 | 13 |
| Kreyòl | 3097 | 1492 | 3110 | 13 |

Parité FR/EN/HT : **confirmée**.

## Méthode de fusion HTML

- Les pages à forte régression ont repris leur couche de localisation stable.
- Les ressources JS/CSS externes ajoutées récemment ont été conservées.
- Les pages financières/authentification sensibles ont gardé leur HTML actuel ; seuls les attributs i18n fiables ont été transférés.
- `promotion.html` a été conservée.
- Les boutons Promotions ont été reliés à `promotion.html`.

| Fichier sensible | Méthode | Liaisons transférées | Non appariées |
|---|---|---:|---:|
| `dashboard.backup.html` | stable_localized_plus_current_resources | — | 0 |
| `dashboard.html` | stable_localized_plus_current_resources | — | 0 |
| `dashboard2.html` | stable_localized_plus_current_resources | — | 0 |
| `deposit.html` | bindings_transferred | 17 | 39 |
| `history.html` | stable_localized_plus_current_resources | — | 0 |
| `index.html` | stable_localized_plus_current_resources | — | 0 |
| `lotto5.html` | stable_localized_plus_current_resources | — | 0 |
| `notifications.html` | bindings_transferred | 26 | 6 |
| `profile.html` | stable_localized_plus_current_resources | — | 0 |
| `results.html` | stable_localized_plus_current_resources | — | 0 |
| `settings.html` | stable_localized_plus_current_resources | — | 0 |
| `tickets.html` | stable_localized_plus_current_resources | — | 0 |
| `wallet.html` | stable_localized_plus_current_resources | — | 0 |
| `withdraw.html` | bindings_transferred | 16 | 41 |
| `admin/dashboard.html` | stable_localized_plus_current_resources | — | 0 |
| `admin/deposits.html` | bindings_transferred | 25 | 1 |
| `admin/draw-schedules.html` | stable_localized_plus_current_resources | — | 0 |
| `admin/index.html` | stable_localized_plus_current_resources | — | 0 |
| `admin/results.html` | stable_localized_plus_current_resources | — | 0 |
| `admin/transactions.html` | stable_localized_plus_current_resources | — | 0 |
| `admin/withdrawals.html` | bindings_transferred | 25 | 0 |
| `agent/dashboard.html` | stable_localized_plus_current_resources | — | 0 |
| `components/main-site-header.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/american-roulette.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/borlette.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/games.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/help-american-roulette.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/help-borlette.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/help-horse-racing.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/help-keno.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/help-lotto3.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/help-lotto4.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/help-lotto5.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/help-lucky6.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/help-mariage.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/help-penalty.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/help-roulette.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/horse-racing.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/keno.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/lotto3.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/lotto4.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/lotto5.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/lucky6.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/mariage.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/penalty.html` | stable_localized_plus_current_resources | — | 0 |
| `jeux/roulette.html` | stable_localized_plus_current_resources | — | 0 |
| `login-register/forgot-password.html` | stable_localized_plus_current_resources | — | 0 |
| `login-register/login.html` | bindings_transferred | 18 | 4 |
| `login-register/register.html` | bindings_transferred | 25 | 0 |

## Ajouts fonctionnels préservés

Fichiers récents explicitement recopiés : **33**.

Cela comprend PlopPlop, les Edge Functions récentes, les migrations Step 10, les tests, la sécurité, Promotions et les configurations Supabase.

## Assets

Assets suivis par Git restaurés : **23**.

- `assets/Lotterie.png`
- `assets/back.png`
- `assets/hero2.png`
- `assets/heroimage.png`
- `assets/horses/horse-black-run.jpeg`
- `assets/horses/horse-brown-run.jpeg`
- `assets/horses/horse-gray-run.jpeg`
- `assets/horses/horse-roux-run.jpeg`
- `assets/horses/horse-white-run.jpeg`
- `assets/keno.png`
- `assets/lo3.png`
- `assets/lo4.png`
- `assets/lo5.png`
- `assets/logo.png`
- `assets/mariage.png`
- `assets/moncash.png`
- `assets/natcash.jpg`
- `assets/paycash.png`
- `assets/reallogo.png`
- `assets/roulette.png`
- `assets/sogebank.png`
- `assets/western-union.png`
- `assets/zelle.png`

## Pages possédant le plus de liaisons i18n après restauration

| Page | Liaisons |
|---|---:|
| `index.html` | 124 |
| `admin/transactions.html` | 114 |
| `dashboard.html` | 94 |
| `jeux/keno.html` | 80 |
| `jeux/help-borlette.html` | 65 |
| `settings.html` | 62 |
| `admin/results.html` | 60 |
| `jeux/lucky6.html` | 55 |
| `profile.html` | 52 |
| `admin/index.html` | 40 |
| `tickets.html` | 38 |
| `admin/draw-schedules.html` | 38 |
| `jeux/american-roulette.html` | 38 |
| `jeux/roulette.html` | 38 |
| `jeux/lotto4.html` | 37 |
| `jeux/lotto5.html` | 37 |
| `jeux/help-lotto4.html` | 34 |
| `jeux/help-mariage.html` | 34 |
| `promotion.html` | 33 |
| `jeux/mariage.html` | 32 |

## Vérifications techniques

- JSON FR/EN/HT valides.
- Nombre de clés final : **3110** par langue.
- Parité des clés confirmée.
- Fichiers JavaScript vérifiés avec `node --check` : **12**.
- Erreurs JavaScript : **0**.
- Marqueurs de conflit Git : **0**.
- Liens Promotions ajoutés/mis à jour : **9**.

## Limite de cette phase

Cette fusion récupère massivement la localisation, mais une QA visuelle ciblée reste nécessaire sur les pages sensibles conservées depuis la version actuelle :

- Dépôt
- Retrait
- Notifications
- Admin Dépôts
- Admin Retraits
- Connexion
- Inscription

Ces pages ont volontairement conservé leur structure fonctionnelle récente.
