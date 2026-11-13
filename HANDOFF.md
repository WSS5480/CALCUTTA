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
- 2026-11-12 v151: the 'Connect Kalshi' card no longer stays open when this device already has a Kalshi key (kal-id + kal-pem); the open flag was only cleared by Connect/Cancel. Note: the Kalshi key lives in each device's localStorage, so a second device (phone vs computer) must connect on its own; bets sync across devices, the key does not.
- 2026-11-12 v150: Kalshi multi-game combos (market has mve_selected_legs) now import as a normal parlay card: one row per leg ('Pittsburgh to win'), each leg's ✓/✗ set from its own Kalshi market result, per-leg date, 'x of n hitting'. Kalshi legs have no manual ✓/✗ buttons and no Edit (Delete still hides it). Leg markets are re-fetched at most every 5 min until settled. Non-winner legs fall back to 'YES · <market title>'. Single Kalshi markets are still 'prop' bets.
- 2026-11-12 v149 (from independent UI review; reviewers did not touch the repo): taps no longer wait ~850 ms (a capture-phase click listener clears the scroll guard, so Final/Live chips, week arrows, lab buttons respond at once). Team filter: Show all teams also resets the dropdown and search box, clearing the search box now clears the saved team, and a team on a bye lands on the next week with games (not the last). Header chips / tabs / banner button min-height 40px. sports.html: My Bets banner now tucks away when scrolled (ported plbFit). Open from review: expanded banner panel covers Add bet/Ask AI at scroll 0; header chip rows scroll sideways with no edge cue; ⓘ buttons are ~23 px; sports.html is a separate older build (v127 label).
- 2026-11-12 v148 (from independent logic review): odds-api/oddslines.js now counts the 2 credits BEFORE the call, shares one in-flight request across simultaneous phones, backs off 20 min after a failure, reads the remaining-credit header from the free /v4/sports call on boot, and keeps day/spent/remaining in os.tmpdir() so a process restart doesn't reset the daily cap (a fresh deploy still resets it; the FLOOR protects the monthly total). server.js Super Bowl fetch got a 20 s timeout. Bet of the Day / Biggest Upset only consider games not yet started. Survivor plan rows skip a week with no game for the planned team (was able to blank the page). Backtest tiles are graded without the QB rule (documented in the info sheet). Open: spread pick on unlocked finished games drops the QB rule (pred only sets inj for non-final games); QB rule also applies to next-week 'Rest of season' projections with the current injury list; lines.js nickname fallback can swap two same-nickname games; sw.js caches non-OK responses.
- 2026-11-12 v147: the 'Showing only X games · Show all teams' banner now sits under the header (#tban) so it shows on every sub-tab (it was missing on Results). Cause of 'NCAA missing' on desktop: saved team filter RGV on that device (filters are per device).
- 2026-11-12 v146: (1) Results week rows: first tap flashed and only the second opened, because the re-render ran before the toggle event updated DET; swkTap now sets DET['r'+n] immediately. (2) A saved team filter (e.g. RGV on NCAA, kept per league in localStorage `pics-team-<lg>`) made NCAA look empty; added a 'Showing only X games · Show all teams' banner above the board/list.
- 2026-11-12 v145: Fix NCAA (and any league) landing on Week 1. newBoard saved the clamped week into WKV on the first render, before the live week (CUR) had loaded, so the board stuck on the earliest week with all finals. WKV is now only remembered after the user picks a week; default is CUR, else the latest week.
- 2026-11-12 v144: QB-out rule ON by default (NFL). If a team's season-top QB is Out/IR/Suspension/Doubtful (not Questionable) its margin drops QBP=5.5, which moves the SPREAD pick only; win pick/confidence untouched. Lab modes: Off / QB spread (default, localStorage `injm`=qb) / Model / Model+line (tests). Reason (decision): backtest of 949 games, 2023-2026 (past lines from ESPN core odds API; 2023 checked against 6 books): QB-out spread picks 148-135 (52%) -> 184-99 (65%), same direction every season and every book; win picks did not improve (Model+line worse); RB/WR/defense out added nothing (info only). Caveats: QB-out known after the fact in the backtest; live ESPN injury list accuracy unverified; ratings in-sample. lockSnap now stores su0/ats0 (pick without the injury) when the rule changes a pick, to compare later.
- 2026-11-12 v143: 🧪 Injury lab (NFL only, Stats tab). Test switch Off / Model / Model+line (localStorage `injm`, default Off so picks are unchanged) plus a QB-out penalty picker (`qbp`, default 5.5). pred(g,o) takes overrides {a,h,mode}: hurt-starter points shift the model margin ('model') and, for 'line', also the line-implied win chance. Lab shows this week's hurt starters with base vs adjusted pick, a what-if tester (tick players out), a backtest of games where the season QB / RB1 / WR1 did not play (base vs adjusted win and spread record, picks changed), and a QB penalty sweep. lockSnap stores su0/dInj/im when the test is on so locked results can be compared later. Info sheet text updated. Backtest uses today's ratings and closing lines (in-sample, rough).
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

## v152 (2026-11-12) — bigger tap targets
- User: "Buttons hard to hit". Chips, tags, leg buttons, nav bars, ⓘ, pills, week/game bars now min 44px high (ⓘ 44px box). Closes the "ⓘ ~23px" open item.
- My Apps: Oddable added to console ($99/mo, Cash App, 7-day trial). Console deploys from branch `karaoke-bars` (not main). Env vars still to set: My Apps CASHAPP_TAG + APP_SECRET_ODDABLE; calcutta-odds MYAPPS_URL + MYAPPS_SECRET.

## v153 (2026-11-12) — Kalshi connect card never reopens on load
- User: "the Kalshi still there". Card no longer restores from `kal-formopen` at startup (still opens when tapping Connect Kalshi or after a failed connect; draft kept for retry). Decision: an open card must never survive a reload.

## v154 (2026-11-12) — Owner PIN on Oddable sign-in
- User asked for PIN login (4-digit, set in Render as OWNER_PIN on calcutta-odds) so the owner gets in free without paying, like the Dive app. Sign-in screen has an "Owner?" box; server mints an owner token; 8 tries/10 min throttle per IP.
- Decision: owner access by PIN, not by a My Apps free account. Same PIN also set as the My Apps console password (APP_PASSWORD) at his request.

## v154 (2026-11-12) — renewal reminders (push) in Oddable
- User wants Cash App renewal + phone push reminders on Oddable, Dose Guide, TX Case Desk; price per app set from My Apps (done: Setup tab). Oddable is first; Dose Guide and TX Case Desk still to wire (each needs: sw.js push + notificationclick handlers, a "turn on reminders" button, and server routes calling My Apps /api/v1/push/key + /push/subscribe).
- Oddable: sw.js push handlers, gate.js Account box under Disclosures (turn on reminders, sign out), acct.js /acct/push-key and /acct/push. iPhone needs Home Screen install.
- Needs VAPID_PUBLIC/VAPID_PRIVATE on My Apps (set in Render).

## v155 (2026-11-12) — in-development notice
- User: show "This app is in development. Credit card payments are coming soon." on Oddable sign-in and subscribe screens. Add the same line to Dose Guide and TX Case Desk when their pay screens are wired. Card payments are a later build.
