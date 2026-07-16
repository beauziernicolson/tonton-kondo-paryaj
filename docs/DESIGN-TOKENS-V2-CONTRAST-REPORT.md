# Tonton Kondo — Design Tokens V2 / Contrast repair

## Scope
A global contrast layer was added to `assets/tk-paryajpam-inspired.css`.
No JavaScript, SQL, Supabase query, game logic, ID, route, or form behavior was changed.

## What was fixed
- Dark navy text for headings and primary content on white surfaces.
- Stronger grey-blue text for descriptions, dates, metadata, and helper text.
- White/yellow text reserved for real navy surfaces.
- Ticket cards, ticket metadata, ticket codes, filters, buttons, statuses, and details.
- Inputs, placeholders, selects, tables, links, empty states, errors, headers, and footers.
- Semantic aliases for the legacy variables `--text`, `--muted`, `--panel`, and `--line`.

## Simple explanation
The old pages were designed for a dark background, so some text was white or very pale blue. The new pages use white cards. This update gives each type of surface a rule:
- white surface → dark navy text;
- navy surface → white text;
- important action or active state → yellow;
- secondary information → readable grey-blue.

The change is centralized, so every public page linked to the shared stylesheet benefits from it.
