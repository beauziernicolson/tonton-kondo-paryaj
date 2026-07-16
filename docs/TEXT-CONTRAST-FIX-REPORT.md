# Tonton Kondo — Text Contrast Fix

## Problem corrected
The white/navy redesign kept several legacy page rules such as `color: #fff`, `color: var(--text)` and pale gray text. Those rules were written for the former dark theme and could therefore produce white or very pale text on newly white surfaces.

## Correction
A centralized contrast layer was appended to `assets/tk-wow-redesign.css`.

It now enforces:
- navy text for titles, values and labels on white cards;
- readable muted blue-gray for secondary descriptions;
- dark text in tables, forms, inputs and select options;
- readable status badge colors;
- white text only inside intentionally navy areas such as headers, footers, bottom navigation and dark feature sections;
- preserved yellow accents.

## Scope
- No JavaScript changed.
- No SQL changed.
- No Supabase query changed.
- No feature or page structure changed.
- All 45 active HTML pages already use the shared redesign stylesheet and therefore receive the correction automatically.
