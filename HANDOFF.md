# HANDOFF — Oddable (pics/) + Oddable Pool (public/)

Start here if you are a new AI session picking up this repo. Update this file in the same commit as every change.

## How Steve works / his rules
- Terse, often voice-dictated from his phone. Give concise, practical answers with the reasoning.
- End every reply about Oddable / Steve's Pics with the app link: https://steves-pics.onrender.com/
- Phone first: wrap info (dropdown pickers, wrapped cards) instead of sideways-scrolling tables.
- Table headers sit over their data (numbers right, text left).
- Summary numbers/tiles drill down to the detail behind them, with a way back.
- The floating TODAY / My Bets banner must never cover other UI (tabs, buttons, cards). Check every new or changed screen.
- After each build, remind him (as a to-do) to upgrade The Odds API plan (~$30/mo) once Oddable sells. Until then stay under the free 500 credits/month.
- Values to copy (keys, tokens) go in their own copy box with no stray spaces.
- When a session gets long, hand off to a fresh session using this file.

## How it is built / run / shipped
- No build step. `pics/` = Oddable (single-page app, mostly `pics/index.html`; `classic.html` is the older look, `sports.html` handles NBA/MLB/NHL/NCAAB).
- `public/` = Oddable Pool (Calcutta). `odds-api/` = calcutta-odds Node service (odds, lines, Kalshi sync, accounts/gate).
- Push to `main` and Render redeploys.
- Bump the version on every change: `v###` in 3 places in `pics/index.html` plus `C='pics-v###'` in `pics/sw.js`, so phones pick up the update.
- Local check: serve `pics/` with `python3 -m http.server`, set `localStorage['pics-lg']='cfb'`, open `index.html?mirror=1`. ESPN must be mocked if outbound access is blocked.

## Change log
- 2026-11-12 v142: Results stat tiles follow a week. Tapping a week in Results points the 4 tiles (and the locked-picks list) at that week, and closing it returns to the season. A "Showing" dropdown above the tiles picks the whole season or any week. The TODAY banner now tucks away once you scroll far enough that the sport chips would slide under it, and comes back at the top.
- 2026-11-12 v141: Record dashboard tiles shown on the Results sub-tab.

## Decisions (date — decision — why)
- 2026-11-12 — Week filter is in-memory only (resets to whole season on reload) — the season record is the default view; one week is a quick look.
- 2026-11-12 — The game-card stat strip (NST) stays season-wide — it describes the model overall, not a week.
- 2026-11-12 — TODAY banner hides on scroll rather than shrinking — any floating box over scrolling content covers something, which breaks his no-overlap rule.
- 2026-11-07 — Each user signs in to their own Kalshi account, not one shared key.
- 2026-11-10 — Sold at $99/month via Cash App pay link + "I paid" confirmation in his My Apps console, with a 7-day trial; owner is free.

## Open items
- Upgrade The Odds API plan once Oddable sells.
- `classic.html` does not have the week filter or the banner tuck-away (only `index.html`, the live look).
