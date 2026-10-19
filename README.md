# Calcutta 2026

Static site (no build step). Shows every Calcutta group with team records, playoff probability,
title odds, expected payout and value vs. price paid.

## Weekly update (only `public/data/teams.json` changes)
- `w / l / t / pf / pa`: records and points for/against (Covers.com NFL standings)
- `playoffPct`: market chance to make the playoffs, 0-100 (Kalshi via Covers.com "NFL playoff odds")
- `sbOdds`: American Super Bowl odds (DraftKings via Covers.com "Super Bowl odds")
- `updated`, `asOf`, `sources`: labels shown at the top and bottom of the page

Everything else is calculated in `public/model.js` in the browser. Push to the main branch and Render redeploys.

`public/data/lots.json` holds groups, buyers and prices. `public/data/payouts.json` holds the payout sheet.
Buyers listed in `LOGOS` in `public/index.html` get a custom avatar (Navas = The Dive logo).
