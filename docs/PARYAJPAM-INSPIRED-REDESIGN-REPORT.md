# Tonton Kondo — ParyajPam-inspired public redesign

## Direction

- Compact navy application shell
- White editorial content surfaces
- Yellow actions and active-state accents
- Dense horizontal navigation inspired by entertainment portals
- Compact game catalogue rails
- Stronger separation between navigation, account summary, games and account tools

## Scope

37 public/player-facing HTML pages were connected to the new design system:

- Root player pages
- Login and registration pages
- Game catalogue
- Game pages
- Game help pages

The following were intentionally excluded:

- `admin/`
- `agent/`
- backup dashboard files

## Main files

- `assets/tk-paryajpam-inspired.css`
- Public HTML pages received a final stylesheet link and page-specific body classes.
- Public/player headers received a compact horizontal category navigation where appropriate.

## Preserved

- Supabase calls
- SQL files
- Authentication logic
- Wallet/deposit/withdrawal logic
- Ticket and results logic
- Existing form IDs and data attributes
- Game calculations and play functions
- i18n dictionaries and runtime behavior

## Responsive behavior

- 320–430 px: compact header, horizontally scrolling navigation and game rails, stacked summaries and forms
- 768 px: reduced grids, reorganized hero and account summary
- 1024 px: two-column editorial layouts
- 1366 px+: full catalogue and account shell
- 1600 px+: expanded content width without excessive stretching

## Verification

- 37/37 public pages linked to the new design system
- All inline JavaScript blocks passed `node --check`
- `js/i18n.js` passed `node --check`
- `fr.json`, `ht.json`, and `en.json` parsed successfully
