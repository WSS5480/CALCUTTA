# Squares app — HANDOFF (start here)

**Live:** https://cowboys-squares.onrender.com (Render static site `cowboys-squares`, MY APPS workspace, srv-dc4a0rrl550s738ksqqg)
**Code:** github.com/WSS5480/CALCUTTA, branch `cowboys-squares` (its own orphan branch; nothing to do with the Calcutta/Oddable main branch). Push = auto-deploy in ~10s.

## How Steve works
- Terse, voice-dictated messages; act, don't ask, unless it's expensive/irreversible.
- End every reply with the links (app, FLX page, archive, new game, Render dashboard, Dev Billing https://dev-billing.onrender.com).
- Phone-first: wrapped cards, no sideways tables. Tiles drill down with a back button.
- No PIN on this app (his call, Nov 26 2026): anyone with the link can add/edit games.

## How it's built
- Static HTML/JS, no build step. Pages: `index.html` (full 100-square board), `flx.html` (holdings — a group's own squares), `archive.html`, `new.html`. Shared code in `common.js`.
- Data: Supabase project **ODDABLE** (xpienbliztnplwccsnlo), table `squares_games` (id, kind `board|holdings`, title, status `live|archived`, sort, data jsonb). Public read; writes only through RPCs `squares_save`, `squares_finalize`, `squares_set_status` (security definer).
- Live scores: ESPN public API in the browser (`common.js` espnBoardUrl/espnFind by team abbreviations + date + league).
- Photo reading: Supabase edge function `squares-parse` → Claude (model `claude-opus-5-5`, override with secret SQUARES_MODEL). Secret `ANTHROPIC_API_KEY` added by Steve Nov 26 2026.
- Self-update: run `./bump.sh` before every push — stamps version.json + APP_VERSION so open phones reload themselves.

## Rules baked in
- Winning square = last digit of column-team score × row-team score. Wrong way = digits swapped, paid the full amount (Steve, Nov 26 2026).
- FLX/holdings: Right, Wrong (flipped), +5 Right, +5 Wrong; amounts × share. A square whose right and wrong number are the same (e.g. 3–3) counts both (follows his sheet; flagged to him).
- FLX winnings split equally Rick / Raul / Felix (Steve, Nov 26 2026).
- At ESPN final, the page locks every number into the saved game and archives it (`squares_finalize`).

## Change log
- 2026-11-26: Built Cowboys–Eagles board (Mike Leal's Numbers!), ESPN auto-fill, ticker, pop-ups, wrong way, FLX page, split, self-update, DB-backed games, auto-archive, Archive tab, New game from photo.

## Open items
- True push notifications with the page closed need a server (not built).
