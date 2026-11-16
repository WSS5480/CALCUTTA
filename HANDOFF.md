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

- **Session rotation (Steve, 2026-11-13):** when a session is close to handing off, it stops coding and becomes **reviewer**; before leaving it becomes the **second reviewer**. It only leaves once the new coder has become the **first reviewer** and the old first reviewer has taken its place. Each session trains the next by these rules. Reviewers stay read-only; check afterwards that they changed nothing.
- **Test like a real user (2026-11-13):** the sign-up/"Failed to fetch" bug (missing CORS preflight) lived since v112 because tests ran in scripts that don't enforce CORS. Always test cross-origin calls from the real page in the user's Chrome, and try a real sign-up/sign-in flow before saying it works.

## How it is built / run / shipped
- No build step. `pics/` = Oddable (single-page app, mostly `pics/index.html`; `classic.html` is the older look, `sports.html` handles NBA/MLB/NHL/NCAAB).
- `public/` = Oddable Pool (Calcutta). `odds-api/` = calcutta-odds Node service (odds, lines, Kalshi sync, accounts/gate).
- Push to `main` and Render redeploys.
- Bump the version on every change, in ALL of these (the header pill was missed from v232 to v247 and still read v231): `pics/index.html` = the `<!-- Pics v### -->` comment, the header pill `>v###</span>` next to the Kalshi dot, the footer `Oddable v### (...)`, every `?v=###` (trophy.js, gate.js, alert-frozen.json, trophy-season.json); `pics/sports.html` = `gate.js?v=###`; `pics/sw.js` = `C='pics-v###'`. Check with: `grep -n -o "v=2[0-9][0-9]\|v2[0-9][0-9][^0-9]" pics/index.html pics/sports.html pics/sw.js`.
- Local check: serve `pics/` with `python3 -m http.server`, set `localStorage['pics-lg']='cfb'`, open `index.html?mirror=1`. ESPN must be mocked if outbound access is blocked.

## Change log
- Groups review fixes + contests (2026-11-16, branch `groups-v1`, no version bump) — the server grades every counted bet from ESPN finals (all leagues), keeps its own first-seen time and freezes each bet at kickoff, one database row per group, money rules lock once anyone joins, minimum bets to place in a paid spot, ties split in cents; a group now holds several contests (main pot / opt-in side pots); invite links (`?join=g.<code>`, pics/join.js); 8-people limit with owner-set enterprise / extra seats and a "Contact Oddable" form; `statsFor` for lifetime stats. Full notes in "Groups review fixes + contests" at the end.
- Groups stage 1 (2026-11-15, branch `groups-v1`, no version bump: the manager bumps at merge) — players compete in groups with their real synced bets (Standings / Best five), commissioner rules lock at start, join by code or request, money shown as information only. Full notes in the "Groups (stage 1)" section at the end.
- v252 (2026-11-15, branch `v252-server-picks`) — The SERVER computes and freezes the weekly Alert picks (Lock, division road dogs with model %, Helper); phones only display them. Picks follow the line until 30 minutes before kickoff, then are final. Phone freezing (POST /alert) removed; owner-only line correction route added; trophy-season.json / alert-frozen.json refreshed. Full notes in the v252 section at the end.
- v194 (2026-11-14) — Kalshi CASH OUT (real sale) with confirm screen. Button 'Cash out…' appears on open Kalshi bets only where a sale can work (market active, a bid >= 1c, at least 1 whole contract). Tap -> modal with live price (re-quoted every 4 s), contracts, proceeds, cost, result; 'Confirm sale' re-quotes first and refuses if the price fell below what was shown. Order = limit, immediate_or_cancel, reduce_only SELL of floor(contracts) at the bid, sent signed from the phone through the new stateless POST /kalshi/order in kalshi-sync/server.js (validates: sell only, integer count, price 0.01-0.99 dollars string, IOC, reduce_only, client_order_id; forwards a cleaned body; refuses everything else). Needs a Kalshi key with TRADING permission (read-only key -> Kalshi 401/403 -> message + `kco-ro` flag). Whole contracts only (Kalshi count is an integer), so fractional leftovers stay open. Sales are logged locally in `kco-log`. Sync now reads SELL fills: when a position is fully sold the bet gets `cash` (proceeds after fee) and `soldN`; betGradeLive/betPL use it (won/lost/push by cash vs stake, P&L = cash - stake). Cash-out value on open Kalshi bets refreshes every 10 s while My Bets is open (cache 8 s). NOT tested against real Kalshi orders (no trade was placed by Claude): first real sale must be tried by Steve on a small position. Server needs a calcutta-odds redeploy for /kalshi/order. Open: combo (MVE) markets may reject normal sell orders; partial sells show only a note; My Apps dashboard grading of cashed bets may differ from the app.
- v193 (2026-11-14) — Kalshi status light in the header (next to the version pill, every page): green flashing = Kalshi key on this device and synced in the last 20 min; orange = syncing/waiting/stale; red = key rejected or cannot connect; hidden when no key. Tap it to open My Bets; hover/aria text shows the sync line. `kdotPaint()` runs every 3 s and after each sync; `KLAST` stamps the last good sync; reduced-motion users get a steady green. Cash-out button NOT built (still preview only, needs trade-enabled key + confirm screen + signed POST; see v177 note).
- v192 (2026-11-14) — Kalshi combo synced but was easy to miss: the real $89.97 5-leg Kalshi combo DID sync (fills API) with correct legs, but (1) it was filed on Sun 11/15 (the combo market's expiry) instead of Sat 11/14 (its games), so it was not on today's My Bets; (2) its stake was 84.66 not 89.97 because Kalshi's fee_cost was left out. Fix: combos use the day of their first leg; stake = fills cost + fee_cost for combos and single Kalshi bets (matches Kalshi's ticket cost; multiplier now 9.135x for that combo); parlay re-sync now also updates a changed day. Existing synced bets are corrected on the next Kalshi sync. Open: bets edited by hand get overwritten by the next sync only when day/stake differ from Kalshi (pre-existing behaviour).
- v191 (2026-11-14) — Bet-slip photo import picked last week's games and the wrong side. Cause: the AI reader gives the picked team + opponent but no home team; betApplyMulti's matcher scored `teamMatch(undefined)` as a match for every game and had no preference for upcoming games, so with last week's finals saved in XL (lower ESPN ids sort first) it chose the stale game and then defaulted to the home side. Fix: both teams must be in the game (picked team on one side, opponent on the other), prefer today/upcoming over finals, `teamMatch` returns 0 for empty text, `xlLoad(true)` also fetches today..+3 days of the other league, no match = 'game not found, you grade this one' instead of a wrong game. Tested with a mock of the 5-leg Kalshi combo (old code reproduced MSST/GT/NU/LSU/SMU, new code gives ALA/CLEM/OSU/TEX/WAKE). Review follow-ups applied: opponent text needs a real name match (>=2) on the other side; if the opponent is a nickname (Ole Miss, Pitt) it falls back to the picked team alone but only for a game today/upcoming, never an old final; today..+3 dates are queued before bet-derived dates so slice(0,14) cannot cut them. Reviewer read-only on /tmp copy, repo checked unchanged.
- v190 (2026-11-14) — Warning before any non-football sport: tapping NBA / MLB / NHL / NCAAB (index.html chips and the sports.html chip row, not the one you are already on) opens a modal 'Not a pick model yet. Bet at own risk.' with Cancel / Continue, every tap (Steve's wording; chosen over once-per-device). `window.oddWarn(go)` lives in gate.js, so both pages need gate.js loaded.
- v189 (2026-11-14) — Dashboard drill-down to GAMES: every result opens the bets behind it. adminUsers/`/acct/dash` return `list` per player (last 300 bets: day, what, stake, odds, fin, pl). New 'Games' view (Bets tile), a 'Games · <day>' card on every day, and a 'Games' card on every player page, each row with WON/LOST/PUSH/OPEN and P/L. NOTE (Render): a late duplicate webhook for an OLD commit redeployed v184 over v188 once — after every push check list_deploys shows the NEWEST commit live on both services and re-trigger if not.
- v188 (2026-11-14) — fixes from the SECOND independent review. CRITICAL: v186 made the dashboard send an `x-dash` header, which the CORS preflight (server.js + ai.js Allow-Headers) did not allow → dashboard/name saves would fail with 'Failed to fetch' (same class as the v112 sign-up bug). Allow-Headers is now `content-type,x-token,x-dash`; ANY NEW REQUEST HEADER MUST BE ADDED THERE AND TESTED CROSS-ORIGIN FROM THE REAL PAGE. Also: /locks returns `rejected` and the client keeps those items queued (was silently dropped); deleting a settled bet subtracts it from that day's frozen record instead of erasing the day; dashboard Unsettled = n − settled after merging log+placed; throttle map evicts the oldest 1000 instead of clearing; Risked tile drills down. KNOWN: locks for games outside ESPN's current/next week are refused (retry later); FCS games are not in the cfb schedule (groups=80).
- v187 (2026-11-14) — locks schedule fix: v186 asked ESPN for a `dates=` range, which ESPN rejects (HTTP 400) → every lock POST would have answered 503. known() now reads the default scoreboard plus week+1 (`&week=N+1&seasontype=T`), the same requests the app makes. LESSON: test any new outbound URL against the real service before shipping; the sandbox cannot reach ESPN, so use the Chrome tab.
- v186 (2026-11-14) — second batch of review fixes. LOCKS: POST /locks now needs a signed-in token (x-token), checks every lock against ESPN's schedule (known game id, real kickoff time overrides the request's), and prunes locks older than 14 days; if ESPN is unreachable and nothing is cached it answers 503 and the client retries. OWNER-PHONE DASHBOARD: second factor — after the phone sign-in, the dashboard asks for the OWNER_PIN once per device (POST /acct/dunlock → signed `odd-dt` token sent as x-dash, 30 days, dies if OWNER_PIN changes); owner-PIN sign-in unchanged. DELETE A BET: its day leaves the frozen stats log and is recomputed from remaining bets (logat26 set) — fixes 'deleted bets still count'. kcoPaint no longer builds a CSS selector from the bet id. games.js: one upstream call at a time, 2-minute back-off after a failure. NOTE: Kalshi bets are stamped with the GAME day (market end), so a bet on tomorrow's game legitimately lands on tomorrow in the dashboard. OPEN: dashboard vs My Apps aggregates still differ slightly (dashboard merges the placed-day data); gate/sync owner edge cases (#12).
- v185 (2026-11-14) — fixes from the first independent review (v171-v183, My Apps .29; reviewer read-only on copies, repos verified unchanged): ip.js uses the LAST entry when the X-Forwarded-For chain has <3 entries (was the first = spoofable); owner phones cannot be created via /acct/phone create; open bets exclude `res` bets; footer account diagnostic only for owners; 7-button bar tightened on phones. OPEN from the review (need Steve's call): locks POST has no auth/known-game check and the 4000 cap can be filled (high); owner-phone dashboard guarded only by an ordinary PIN (medium); no trigger for logat26 reset / 'Reset my stats' button; dashboard vs My Apps aggregates differ; games.js credit dedupe.
- v184 (2026-11-14) — Dashboard numbers: a day with bets placed but not yet in the frozen log (or unsettled) showed 0 bets / $0 (Steve: 'numbers are not correct', Day = Nov 13 showed 0 while two bets placed that day were listed above). `adminUsers` now returns `placed` (per placed-day n/w/l/p/risk/pl/open from the bets array); dash.js `udays()` merges it with the log (log wins for w/l/pl, bets count = max). New tiles Unsettled + Risked for the period; freshness line and per-player 'synced <time>'. Junk bets with no stake/text no longer count as open. LIMIT: only a player's own app settles bets, so numbers lag until that player opens the app.
- v183 (2026-11-14) — Dashboard: player names + Day. Owner types a name on a player's page (POST `/acct/name {k,name}`, owner/OWNER_PHONE only); stored in row `lock:names` of oddable_sync (the `lock:` prefix keeps it out of player lists); `/acct/dash` returns `name` per user and every screen shows the name, else 'Player ····tag'. New **Day** chip with a date picker (any day, incl. today) plus a 'Bets placed <day>' card of unsettled bets. Phone accounts have no email, so there is no email fallback. NOT yet shown in My Apps.
- v182 (2026-11-14) — account diagnostic moved next to the version pill in the header (shows "acct: not checked" until the gate answers).
- v181 (2026-11-14) — gate.js/dash.js loaded with ?v=181 (cache-bust on every bump — bump these with the version); footer shows ' · acct <role>[+dash] <tail>' or 'acct check failed: …' so an account problem on a device can be read off the screen. Steve's iPad still lacked the Dashboard button at v180 while Chrome showed it.
- v180 (2026-11-14) — gate refresh retries every 20s (up to 4x) when the server is unreachable, e.g. during a calcutta-odds redeploy. Steve's iPad missed the v179 Dashboard button because its one /acct/me call landed during the redeploy.
- v179 (2026-11-14) — 📊 Dashboard in the main side menu, for Steve's phone account. Env var `OWNER_PHONE` (comma list of 10-digit numbers) on calcutta-odds makes those phone accounts dashboard-owners: `/acct/dash` accepts them, `/acct/phone` and `/acct/me` return `me.ownerDash`, gate.js stores `odd-dash` (wiped on sign-out/user switch) and index.html adds the nav item. Owner-PIN sign-in still works. MUST set OWNER_PHONE on Render or the button never shows.
- v178 (2026-11-14) — live win % fix: when ESPN's scoreboard omits the last-play probability, the card/bar fell back to the PREGAME % (HOU 70% while trailing 26-42, 4th qtr). Now `merge` fills `sit.wp` from the summary win-probability series (`WPH`), and `liveFetch` fetches it for every live game, not only open ones.
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
- 2026-11-15 (late evening, owner) — D1: Oddable keeps its own model (Lock + picked division road dogs). The original Calcutta model (public/model.js) is NOT merged; analysis only — owner: "Don't merge. Let's just analyze the results."
- 2026-11-15 (late evening, owner) — D2: every device shows the same weekly picks; the server/database is the ONLY source of the Alert picks (Lock, road dogs with model %, Helper). No phone computes-and-freezes for everyone and no per-phone fallback decides the official pick — owner: "All apps have the same. Not locked to the phone. All database, all see the same."
- 2026-11-15 (late evening, owner) — D3: picks are live and follow line moves until 30 minutes before kickoff, then freeze at that line and are graded at it — owner: "Lock 30 mins before game. Line moves update all picks." Manager's reading (told to the owner, not contradicted): the Lock and the Helper freeze 30 minutes before the WEEK'S FIRST kickoff and never change; each division road dog (line, model %, picked or not at 53%) freezes 30 minutes before ITS OWN kickoff.
- 2026-11-15 (late evening, owner) — D4: week 10 (frozen by a phone under v248 with a stale snapshot, PIT +3.5 / CAR +2.5) is to be graded at closing lines (nflverse games.csv: PIT +4.5, CAR +1.5). Done through the owner-only route `POST /alert/fix`, run by the manager after deploy (not run by the coder).
- 2026-11-15 (owner, Groups) — G1: groups use members' REAL bets already in My Bets (cloud-synced). "Verified only" = only bets synced from the member's own Kalshi account (`src:'kalshi'` + `kt`); "Any logged bet" = every bet — owner asked for groups on real picks and winnings; Kalshi bets cannot be added after the game.
- 2026-11-15 (owner, Groups) — G2: the commissioner sets every option at creation; ALL rules lock at the group's start (first kickoff / chosen start) for everyone, commissioner and owner included, enforced on the server — owner: "Must set these options before start of the series."
- 2026-11-15 (owner, Groups) — G3: join by invite code until start; optional "Let people ask to join" (commissioner approves/denies) and "Show in Open groups"; max members; late joining "Not allowed" or "First 2 weeks"; requests can be toggled until start — owner: "Allow switch for people to join groups with the commissioner allowing."
- 2026-11-15 (owner, Groups) — G4: per-bet cap (counted stake = min(stake, cap), winnings scaled the same), minimum bets per week (under it = flagged, that week cannot win the weekly high score), ranking by Winnings / Units / Return % / Win %, tiebreak Return % — approved mockups.
- 2026-11-15 (owner, Groups) — G5: bet-type toggles (spread, moneyline, totals, props, parlays with max legs); only matching bets count — approved mockups.
- 2026-11-15 (owner, Groups) — G6: other members' bets are hidden until their game kicks off, enforced on the server (never sent early) — nobody can copy a pick.
- 2026-11-15 (owner, Groups) — G7: money stays outside the app. Oddable never collects, holds or pays money; entry, split and take are information; the app shows the pot, who is marked paid and who is owed what. No payment links — keeps Oddable out of handling gambling money.
- 2026-11-15 (owner, Groups) — G8: all accounts are free for now; no paywall or billing change for Groups.
- 2026-11-15 (owner, Groups) — G9: members appear by their Oddable name/handle only; phones, phone hashes, PINs, tokens and sync ids are never sent to other members — privacy.
- 2026-11-15 10:49 PM CT (owner, Groups) — G10: "The commissioner can choose his take from the challenge": None / whole percent 0-50 / flat dollars (never negative, never more than the pot), validated on the server, locked at start, shown to everyone BEFORE joining or requesting; prize pool = entries marked paid minus the take; the split applies to the prize pool; leftover cents go to 1st so the split sums exactly — information only (G7).
- 2026-11-15 (coder, Groups, NEEDS OWNER OK) — G11: a counted bet is frozen in the group's ledger the first time the server sees it settled; deleting or editing it on the phone afterwards does not change the group (same idea as "deleted bets still count") — otherwise a member could delete losing bets. Also: a hand-logged bet created after its game's kickoff (bet id time) never counts, and a member who joins late counts bets from the moment they joined.
- 2026-11-16 (owner, Groups, OWNER-DECISIONS.md) — G11 CONFIRMED and extended: real bets are graded by Oddable from final scores, never by the phone; bets the app can't check count only with the commissioner's "honor system" rule (default off); "Verified only" renamed "Kalshi-synced bets only" — owner: groups on real results that nobody can fake.
- 2026-11-16 (owner, Groups) — bets first seen by the server after kickoff never count; side/line/odds/stake frozen at kickoff; other members' bets hidden until kickoff (server); kickoffs stored, never re-decided from the day — nobody can copy, back-date or edit a pick.
- 2026-11-16 (owner, Groups) — money rules (entry, take, split, cap, metric, bet rules) lock once anyone else joins or asks to join; all rules lock at start — people join on the terms they saw.
- 2026-11-16 (owner, Groups) — ties for a paid place: Return %, then the places' prize is split evenly in cents; fewest settled bets to place in a paid spot (default 10 season, 3 weekend / one week); open-bet counts visible (count only).
- 2026-11-16 (owner, Groups) — G12: all sports the app tracks (NFL, college football, NBA, MLB, NHL, college basketball); weeks run Tuesday to Monday for every sport (coder choice, one rule for all).
- 2026-11-16 (owner, Groups) — G13: a group holds several CONTESTS (picks now; Calcutta / golf / local events attach later through `attachGame`), each in the MAIN pot or its own SIDE pot; members opt in to side pots; the commissioner sets the main-pot split.
- 2026-11-16 (owner, Invites) — G14: every game has "Invite people"; link `https://steves-pics.onrender.com/?join=<g|c|golf|e>.<code>`; new people sign up from the link and land on that game's join screen; router `pics/join.js` (`window.OddJoin.register/share`).
- 2026-11-16 (owner, Limits) — G15: 8 PEOPLE per group/game on standard accounts (commissioner included, server-enforced); owner-set `enterprise` flag on an account (ceiling `ENTERPRISE_MAX_PEOPLE`, default 500) and per-group extra seats; one shared pricing string; "Contact Oddable" requests on the owner dashboard; enterprise games/players counted per month. No payment flow.
- 2026-11-15 (coder, v252) — the server never spends an Odds API credit for the picks: it reads only the many-book lines games.js already cached (owner's rule: stay under the free 500 credits/month).

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

## v156/v157 (2026-11-12) — phone + PIN is the Oddable login; owner bets dashboard; code-review fixes
- User chose: existing Oddable users keep logging in with cell number + PIN (Supabase `oddable_sync`). The live gate had been forcing them to make new My Apps accounts.
- odds-api/acct.js `/acct/phone` ({phone,pin,create}) verifies via sync.js `verifyLogin`, then maps to a My Apps account `<first 20 hex of phone-hash>@phone.oddable` (password = HMAC(GATE_KEY, id); register, else login). New My Apps accounts get the 7-day trial, then Cash App renewal. Rotating GATE_KEY / MYAPPS_SECRET breaks these derived passwords, so don't.
- pics/gate.js: sign-in screen is phone + PIN first (email is a secondary link). Phones with saved sync creds sign in automatically (no typing); Sign out sets `odd-noauto` so it doesn't re-sign-in until a manual login.
- odds-api/sync.js `/sync/admin` (POST {secret}=MYAPPS_SECRET): per-user bets, record, win %, risk, settled P/L, per-day rows from the synced `log` (finished days only). No phones (only hashes).
- My Apps build .12: `/?show=bets` (+ `&bu=id` drill, back button); link on the Oddable app page. Needs APP_SECRET_ODDABLE (already set); optional ODDABLE_API.
- Also in this batch: code-review fixes (entitlement errors not cached, XFF last entry, TRY cap) and My Apps .11 fixes.

## My Apps .13 (2026-11-12) — identify by PIN id, then Cash App name
- User: no name at signup. Phone-account users show as "User ····<id>"; the Confirm payment form has a "Cash App name" box (phone accounts only) that saves ma_users.name and replaces the label. Labels come from SQL `label` in listSubscriptions/listPayments.

## Review fixes after v157 / My Apps .14 (2026-11-12)
- Reviewer found: stored XSS via synced `log` numbers into the owner console (now coerced to numbers in sync.js adminUsers AND escaped in the bets view); phone-account squatting via public /acct/register (now `@phone.oddable` is refused there and the local part is HMAC'd with GATE_KEY, so it isn't guessable); /sync now uses the last X-Forwarded-For entry (same as acct.js); account creation throttled per IP; My Apps' Oddable fetch timeout 30s→10s.
- Known/accepted: per-phone PIN lock can be triggered by anyone who knows a number; concurrent guesses can slip past the check by a few. Bets-view user id (phone hash) differs from the My Apps account label id.

## My Apps .15 (2026-11-12) — Oddable "0 customers" explained
- User: "Oddable still 0". Real users exist (4 phone+PIN accounts, seen live in the bets view) but they only become My Apps customers when they next open the new Oddable login (auto sign-in creates the account + 7-day trial). Home tile and the Oddable page now also show "N using it" from the Oddable server (cached 5 min, fetched in the background so pages never wait).

## My Apps .16 (2026-11-13) — give free days to Oddable players who haven't signed in yet
- User couldn't give free time: players only exist in My Apps after their phone signs in. /sync/admin now returns each user's derived account email (`acct`, via acct.js phoneEmail); My Apps Bets & win % → tap a user → "Give free days" creates/extends their subscription (extendSub). grantTrial uses ON CONFLICT DO NOTHING so the pre-made access survives their first sign-in. Tested locally (+7 shows "7 days" on the Oddable page).

## My Apps .17 (2026-11-13) — Oddable tile/page shows the real players
- User circled "4 using it" on the Oddable tile: "Nothing behind it". Tapping the Oddable tile (or ?app=oddable) now opens the players list (tiles + a card per player: bets, record, win %, last active, access days left or "no access yet"); tap a player for the by-day record and "Give free days". Back goes to home.

- My Apps .18 (2026-11-13): version ("v18") shown top left next to the My Apps title, per user.

- My Apps .19 (2026-11-13): reviewer fixes — Oddable fetch timeout 40s + friendly 'waking up' with Reload; summary tiles on the players page drill to the list; access status (days left) on the player detail page; encoded ids in links. Not fixed: /days/add still gives no error message; limit=2000 users.

## Three-review pass (2026-11-13) — My Apps .20
- Reviews: phone UI, security, end-to-end flow. Fixed now: console login throttle (8 wrong/10 min per IP) + `password=%` crash (try/catch + process-level handlers); `back` redirect rejects backslash; confirm prompts on reject payment / revoke code / remove own account; Oddable "Active" tile filters to active players (`&f=active`); Oddable server: throttle on /acct/redeem (per ip + account) and on /sync/signup creates.
- Known/not fixed (decisions needed): redeem code signature is 6 hex (24-bit) and days uncapped — fixing breaks codes already handed out; trial farming (phone numbers not verified); 4-digit PINs are brute-forceable slowly and in-memory throttle resets on restart; token key derives from MYAPPS_SECRET unless GATE_KEY is set; any app secret can reset any central password (store.js adminSetPassword); no CSRF token (SameSite=Lax only); Customers tab vs home counts differ; Dose payments table on phones.

## v158 (2026-11-13) — review 3 fixes
- acct.js entitlement: only 404 (no account) / 403 (suspended) mean "no account"; any other My Apps error (400 config/DB, etc.) is "unavailable" and never cached, so a My Apps hiccup can't sign everyone out.
- gate.js: fresh phone with no cached gate state and an unreachable server now shows "Could not reach the server / Try again" instead of opening the app (12 s timeout on /status). Expired message: "Your free trial has ended" only for trial source, else "Your access has ended."
- Not fixed (open): push reminders are lost if My Apps sleeps through a day bucket (needs a cron/keepalive hitting /push/run); client counts local end-of-day while server expires on UTC date (Texas users lose access ~6–7pm on the last day; 7-day trial ≈ 8 days); payConfirm not atomic; extendSub keeps old `source`; sign-out leaves the push subscription on the old account.

## v159 / My Apps .21 (2026-11-13) — the "not fixed" list
- User: "Not fixed. You know the answers." and "Code is a generator… was already built" → the free-code generator/signature is left exactly as it was (I tried a stronger signature, reverted). Codes stay protected by the redeem throttle added earlier.
- Expiry now ends at end of the Central-time day (store.js `chiToday`, My Apps daysLeft, push SQL use America/Chicago) — Texas users no longer lose access in the evening of the last day.
- Push reminders catch up: any subscription 0–5 days out gets the nearest bucket once (smallest bucket ≥ days left), so a missed day is sent late instead of lost.
- New Oddable accounts need a PIN of 6–10 digits (existing 4-digit PINs still work).
- Still open: trial farming (phone numbers unverified; capped by 6 new accounts / IP / 15 min), token key derives from MYAPPS_SECRET unless GATE_KEY is set, adminSetPassword by any app secret, no CSRF token, payConfirm not atomic, extendSub keeps old `source`.

## v160 / My Apps .22 (2026-11-13) — full-code review: what was fixed, what is OPEN (start here next session)
Three read-only reviewers read the entire My Apps console, the Oddable server and the Oddable front end. Fixed in this commit:
- Sync data loss: client reloads in-memory BETS after a sync (pics/sync.js reloadMem); server push now patches only if `updated` is unchanged and re-merges + retries (409 after 4 tries); body decoded as bytes; merge keys ids as strings; Supabase read timeout 15 s. AI rate limit uses the last X-Forwarded-For entry.
- My Apps: customers list cached 60 s with stale-while-revalidate (sleeping apps no longer block every page load; flushed on plan/days/payment changes); adminSetPassword refuses owner accounts.
OPEN, most important first (each needs care/visual testing, so not rushed):
1. **My Bets banner covers UI** (pics/index.html `#plb` position:fixed top-right z-index 40; covers `.thm`, Analyze/Add-bet pills, sticky chips; expanded `#plbd` covers tabs/cards). Owner rule: must never cover UI. Fix: put it in normal flow inside the header or sticky under it; test every view at 390px.
2. **Bet math**: parlay with a pushed leg pays full multiplier (index.html ~607-609, needs per-leg odds); over/under totals not graded (legGrade/betGradeOne handle only ml/sp; live.js handles ou); blank-stake bets missing from banner/ROI in dollar mode.
3. **Paywall**: only /ai/* checks the account (ai.js:23). /odds, /lines, /oddsline, /backtest, /kalshi are open; gating them needs gate.js to send the token on those calls AND must not break the Calcutta pool app. /backtest is an unauthenticated amplifier (cache key = full URL; unbounded cache). Gate fails open if MYAPPS_URL/SECRET unset or GATE_OFF=1 (by design until launch; make AI fail closed in prod).
4. My Apps: payConfirm/redeem/redeemForTenant not transactional; redeem() overwrites paid plans with no end date; Mark-paid double-tap = +60 days; "Paid" KPI counts code/manual comps; money tab misses Dose/Stripe/code revenue; reset-link host from x-forwarded-host (set PUBLIC_URL and ignore the header); authed HTML (incl. app secrets on ?tab=setup) cached by the service worker (send no-store); SESSION_SECRET random per restart (set env var); secrets compared with !== (use timingSafeEqual); no top-level try/catch; login body parse breaks on '&' in password; redirects after /tenant/plan, /dose/* lose context and swallow errors; pull-to-refresh wipes minted codes; free-DB expiry alert never rendered; reminders need an external ping (service sleeps).
5. Oddable server: tombstones capped (3000) can resurrect bets and block same-id re-adds; merge precedence (result beats no-result, `log` keeps longer JSON); unbounded synced data size; owner token survives OWNER_PIN change; throttles in-memory; no timeouts on Anthropic/Kalshi calls; scryptSync blocks the loop; /odds has no in-flight dedupe; LINES grows forever; Kalshi SYNC_TOKEN in URL + open /proxy; adminUsers loads all blobs (cap 2000); signup uses merge-duplicates (race can overwrite a PIN); no process-level error handlers in odds-api.
6. Oddable front end: sw.js caches non-OK responses; model.js only in public/ (merge into next account); XSS via unescaped legText/Kalshi ids/server errors/gate.js m.tag,m.link; localStorage write failures silent; sync-pin plaintext; tap targets <44px (.thm, .legbtn); controllerchange reload can wipe an open bet form.
7. Dead code / repo: schedulerserver.js (106 KB, unrelated), node_modules committed, no .gitignore, README says deploy branch karaoke-bars.

## v161 / My Apps .23 (2026-11-13) — worked through the open list
Fixed (tested with Playwright / fake servers):
- Banner: header reserves 146px on the right so the My Bets banner never touches the title row, Add bet / Ask AI / version chip (checked 390px and 768px); the expanded list closes on any outside tap; 44px min height on .thm/.legbtn/.nchips/.bn.
- Bet math: over/under (`ou`/`tot`) graded for singles and parlay legs; parlay with pushed legs pays mult^((n−pushed)/n)−1 (legs' own odds aren't stored; assumes even pricing). Blank-stake bets in dollar mode still count $0 — by design ("1 unit only if no bet has a $ stake"); decide if you want that changed.
- Server: process-level error handlers; /backtest key normalised + whitelisted + cache capped at 30; Anthropic fetch timeout 90 s; OWNER_PIN change signs old owner tokens out; account creation uses ignore-duplicates (no PIN overwrite race).
- Front end: sw.js caches only OK responses; escH/esc on legText, sync errors, gate.js tag/expiry/price; gate.js Cash App link must be https and opens noopener; visible warning when localStorage can't save bets.
- My Apps: payConfirm is one DB transaction (days + status together, Central-date math); redeem() no longer overwrites paid plans with no end date or Cash App/Stripe source; "Paid" excludes code/manual comps; Mark-paid asks first and disables the button; reset link base = PUBLIC_URL or RENDER_EXTERNAL_URL only; authed pages are `Cache-Control: no-store` and the service worker won't cache them (cache renamed ma-2026-11-13); session secret derived from APP_PASSWORD+DATABASE_URL (stable across restarts unless SESSION_SECRET set).
STILL OPEN: paywall on /odds /lines /oddsline /backtest /kalshi (needs gate.js to send the token on those calls and must not break the Calcutta pool app); tombstone cap (3000) can resurrect old deletes; merge precedence (result beats no-result; log keeps longer JSON); unbounded synced data size; throttles in-memory; Kalshi SYNC_TOKEN in URL + open /proxy; scryptSync blocks event loop; /odds no in-flight dedupe; LINES grows forever (merges into next account); money tab misses Dose/Stripe/code revenue; free-DB expiry alert not rendered; redeemForTenant not transactional; no top-level try/catch in My Apps handler; login body parse with '&'; reminders need an external ping; schedulerserver.js dead code / node_modules committed.

## v162 (2026-11-13) — review of the fixes
- Sign-up race: after an ignore-duplicates insert the server re-reads the row and returns 409 if the stored PIN isn't the caller's (no false success for the loser). Removed a duplicate banner click listener. Note: first deploy signs the owner out once (tokens now carry a PIN version) — re-enter the owner PIN. Set PUBLIC_URL (or rely on Render's RENDER_EXTERNAL_URL) for password-reset links. Optional: set SESSION_SECRET on My Apps.

- My Apps .24 (2026-11-13): Oddable players page tiles say 'all time' (bets placed, win %); By-day list shows every finished day (was last 45). Active-this-week tile moved last.

## v163 (2026-11-13) — player bets / win $ were wrong
- Cause: results are graded live from the loaded scoreboard, and the daily log snapshot overwrote a day with whatever could be graded NOW. Once old games dropped out of the scoreboard, bets went back to "pending" and the frozen day lost settled results (e.g. a day with 4 bets showed 0-1).
- Fix: each bet remembers its first final result (`fin`, `finPL`) and uses it when the game isn't loaded; editing a bet or changing a prop/leg result clears it; the day snapshot never regresses (only overwritten by an equal-or-more-settled count); /sync/admin uses per-bet results when they cover more bets than the log. Old days already damaged can't be recovered server-side; they repair as each player's phone re-grades (games still loadable). Tested: result survives the game leaving the scoreboard.

## 2026-11-13 — My Apps build .25: one shared Cash App tag
- Cash App tag is entered once on the My Apps console home (ma_settings key `cashtag`); every app's pay link uses it. Dose Guide's box writes the same value. CASHAPP_TAG env is only a fallback. Reason: Steve wants every app to ask for it the same way he just did in the Dose Guide.
- Owner phone alerts (web push) are NOT shipped: branch `owner-push-wip` in MY_APPS_MANAGEMENT, subscribe route still failing locally.

## v164 — 2026-11-13 — banner no longer vanishes when opened
- Bug: tapping the TODAY banner (#plb) to list bets made it disappear until refresh. plbFit() measured the banner's open (taller) height, decided it was under the logo, then tucked it away and closed it. Fix: plbFit() returns while the list is open (window.__plbo). Reproduced on v163 and verified on v164 at phone width (scrolled so the logo sits under the open banner).

## v165 — 2026-11-13 — top-left version label
- The label in the header (top-left, line ~209 of pics/index.html) was a separate hard-coded string and still said v163 on v164. It now says v165. On every bump change ALL of: `<!-- Pics vNNN -->`, the header label, the footer "Oddable vNNN" line, and sw.js cache name.

## v166 — 2026-11-13 — sign-up / sign-in "Failed to fetch" FIXED (root cause of "0 customers")
- Bug: the gate posts JSON + an x-token header to /acct/*, so browsers send a CORS preflight (OPTIONS) first. The odds server had no answer for OPTIONS on /acct (acct.js returned false, server.js gave a bare 404), so every phone sign-in, new-account and free-trial call failed in a real browser with "Failed to fetch". gate.js swallowed the phone-sign-in error, so no Oddable player ever became a My Apps customer. Present since v112; earlier tests missed it because test browsers/scripts did not enforce CORS.
- Fix: odds-api/server.js answers every OPTIONS with 204 + Allow-Headers content-type,x-token. Verified locally. LESSON: test cross-origin calls from the real page origin (Chrome on steves-pics.onrender.com), not only with scripts.
- Note: every push to this repo restarts calcutta-odds (~15 s of "Failed to fetch" for anyone using it).

## v167 — 2026-11-13 — sign-out clears the person's data; a different person signing in starts clean
- Bug (users reported): sign out + another person signs in on the same phone showed the previous person's bets/log, and the old bets could merge into the new account's cloud data.
- Fix (pics/gate.js + pics/sync.js): `oddWipe()` removes bets26, betlog26, pinned26, kdel26, plbhtml26, surv26, lk26-*, splk-*, sync-ids/tomb/last/err/rl, odd-ok/push. Both sign-out buttons wipe and reload. `oddOwner(id)` records who owns the local data (`sync-owner`; phone digits or `e:email`); signing in as someone else wipes first and reloads, and a new account's sign-up never uploads the previous person's data. Same person signing back in keeps their data. Existing signed-in phones are migrated (owner = saved phone). Theme/view prefs are kept on purpose.
- Limit: a phone where someone signed out BEFORE v167 may still hold that person's old bets under no owner; the next sign-in there keeps them (cannot tell whose they are).

## v168 — 2026-11-13 — first independent review (reviewer 1) fixes
- Fixed: Kalshi key/id (`kal-id`, `kal-pem`) wiped on sign-out/identity change; classic.html redirects to index.html (it was an ungated copy of the app); server 500s now carry CORS headers (they showed as "Failed to fetch"); `allowed()` also requires the plan not to be past `expires_on` (Central date); gate shows an error instead of a stuck button when the account can't be loaded.
- STILL OPEN from that review (do next, ranked): (1) edits never bump bet `t`, so a stale device can overwrite a newer edit; clearing a result can't sync (merge keeps any copy that has a result) — merge by `t`; (2) unpinning teams never persists (pins are a union, no tombstones) and apply() doesn't reload PIN; (3) oversize sync body drops the connection with no message (locks/splk grow forever) — return 413 + prune old lk26-*; (4) rate-limit IP is the LAST X-Forwarded-For entry — verify against a live request that it is the client, not Render's proxy; (5) sign-out doesn't revoke the 30-day token or the push subscription; (6) syncNow can write account 1's data into account 2 if the user switches mid-request; apply() should only accept lk26-*/splk-* keys; (7) service worker caches every ?c= update-check URL (cache grows) — skip caching query URLs; (8) ?mirror=1 skips the gate; /odds /lines /backtest /sync are open (soft paywall); (9) "Your access ended" text shows for active pro accounts after a renew tap; (10) KERR/m.price unescaped in HTML; double-escaped & in Kalshi leg titles; (11) account enumeration via signup 409 / "No account" messages.

## v169 — 2026-11-13 — review 1 sync fixes (all remaining items except two)
- Merge now picks the bet with the newest `t`; the client stamps `t` whenever a bet changes (betsStamp in betsSave; fin/finPL are ignored). So a stale phone can't overwrite a newer edit and clearing a result syncs. Same-age ties still keep the copy with a result.
- Pins: newest change wins (`pinsAt` / localStorage `pinsat26`), so unpinning sticks; PIN in memory is reloaded after a sync. Old clients without pinsAt still union.
- Oversize sync body returns 413 with a readable message (socket no longer destroyed).
- syncNow ignores its result if the person signed out/switched while waiting; apply() only accepts lk26-* and splk-<league> keys.
- sw.js no longer caches the `?c=` update-check URLs (cache growth). KERR is escaped; Kalshi leg titles are stored raw and escaped once (no more `&amp;amp;`). "Your access ended" only shows for a really ended plan; a waiting renewal says so.
- TEMPORARY /whoami route on the odds server to check which X-Forwarded-For entry is the real client (rate limits currently use the LAST entry). Remove after checking, and fix `ip` in acct.js, sync.js, ai.js if wrong.
- NOT done (design/limits): token + push subscription are not revoked on sign-out (30-day bearer token, no server list); ?mirror=1 skips the gate and /odds /lines /backtest /sync stay open (soft paywall); account-enumeration messages on sign-up/sign-in kept for usability.

## v170 — 2026-11-13 — every visitor shared ONE rate-limit bucket (fixed)
- Verified live: X-Forwarded-For on Render is "client, Cloudflare edge, Render proxy". The old code used the LAST entry (Render's own proxy, a 10.x address), so ALL visitors counted as one IP: 6 wrong PINs from anyone locked sign-in for everyone for 15 min, "6 new accounts per 15 min" was global (could block new sign-ups), and the AI limit (40/h) was shared.
- Fix: odds-api/ip.js `clientIp(req)` = third entry from the end (falls back to the first / socket). Used by acct.js, sync.js, ai.js. The temporary /whoami route is removed.
- If Render's proxy chain ever changes, re-check with a temporary route that echoes the header.

## 2026-11-13 — test bets leaked into the owner's real account (rule)
- 9 test bets (PITT/UCLA/HOU/NY/ATL/OKC/POR/MEM, ids b1794608213749..b1794610039079, added 4:16-4:47 PM CT in his Chrome during banner testing) uploaded to his cloud account on first sign-in. He spotted them as "not mine". Removed them from his Chrome and synced the deletes.
- RULE: never add bets (or any data) while testing in his real Chrome tab if it can sync. Test on a local copy or a throwaway browser profile, and sign out / wipe afterwards.

## 2026-11-13 — owner dashboard feed: open bets (Oddable v170, odds-server only)
- odds-api/sync.js `adminUsers` now also returns `open` per user (bets with no result yet: day, label, stake, odds; newest first, max 60). Phones still never returned. My Apps (.29) shows them with WTD/MTD/YTD/Lifetime filters.

## v171 — 2026-11-13 — owner-only dashboard inside Oddable
- Sign in with the OWNER PIN (sign-in screen) -> Account box shows "📊 Owner dashboard" (pics/dash.js, full-screen overlay above the My Bets banner). Normal players never see it, and the server enforces it: POST `/acct/dash` only answers an owner token (acct.js), data from sync.js `adminUsers` (short ids, no phones/names).
- Chips WTD/MTD/YTD/Lifetime. Tiles + graphs all drill down with a Back button: P/L by day (tap bar -> that day's players), running total (tap -> day), bets per day, win % by player (tap -> player page: tiles, P/L by day, current bets, by-day list), Open bets tile -> all open bets.
- His own phone account is NOT owner (decided with him: owner PIN only). To use it he signs out and signs in with the owner PIN; sign back in as himself for his own bets.
- Tested with a mocked feed in Chromium (390px, no overflow/errors); not yet reviewed by an independent reviewer.

## v172 — 2026-11-13 — NFL spreads from many books (consensus)
- Before: game spreads came from ESPN's feed = ONE book (DraftKings), e.g. BUF -8.5 at NYJ while other apps showed lower. Super Bowl odds already used The Odds API; game spreads did not.
- Now: odds-api/games.js (route `/games`, NFL) pulls every US book's spread from The Odds API (1 credit per refresh, cached GAMES_TTL_MIN=20 min, once a day below LOW_CREDITS). Client `loadBooks/applyBooks` (index.html): for NFL games before kickoff the app's line = MEDIAN across books (half-point), ESPN's number kept in `g.espnLine`; the game detail shows "📚 N books" expandable list with each book's number and best line per side. The model/picks use the consensus line. Locked picks keep the line they were locked at.
- NFL only for now (NCAA/NBA need team-name mapping). Credits: ~3 per hour while someone has the app open; upgrade the Odds API plan when Oddable sells.
- Env: ODDS_API_KEY already set on calcutta-odds. Optional GAMES_TTL_MIN.

## 2026-11-13 — many-book spreads default refresh 20 -> 120 min (credits)
- He decided (Nov 11) to stay inside The Odds API free 500 credits/month until Oddable sells. /games at 20 min could burn ~70/day. Default GAMES_TTL_MIN is now 120 (~12 credits/day max). `/games` now also returns `remaining` (credits left). Set GAMES_TTL_MIN lower after the plan is upgraded.

## v173 — 2026-11-13 — shared locked picks (everyone sees the same lock)
- Problem: locks (lk26-<lg>-<gameId>) were saved only on the phone that had the app open before kickoff, so other users / new sign-ins / wiped phones had no lock on live and finished games ("nobody sees the lock").
- Fix: odds-api/locks.js, route `/locks` (GET ?lg=nfl|cfb; POST {lg, items:[{id,s,snap}]}), stored in the Supabase table `oddable_sync` as rows id `lock:nfl` / `lock:cfb` (excluded from the players list in `adminUsers`). Newest write before kickoff wins; after kickoff only a "late seed" is accepted (the phone's own lock time must be before the start, game started < 8h ago, and only if the server has none). Client (index.html): `lockSnap` queues an upload on every change, `lkPull` copies server locks into localStorage (overwrites once a game has started), runs at startup and every refresh. Format of the local lock is unchanged, so the cloud sync and the Locked list work as before.
- NOT covered: if NO phone had the app open before kickoff there is still no lock (the model only runs in the browser). Next idea: owner phone/Chrome kept open on game days, or a server-side model.

## v174 — 2026-11-13 — a lock with a line is never replaced by a line-less one
- Found on ILL@UCLA (live): ESPN removes the odds from the scoreboard just before kickoff, so the last pre-kickoff snapshot had L=null and overwrote the earlier lock that had the line (no spread pick on the lock). `lockSnap` (index.html) and the server (`locks.js`) now refuse to replace a lock that has a line with one that doesn't. Games already started keep what they have.

## v175 — 2026-11-13 — 🔒 on the green TAKE line for live games
- The new-style game card's green/amber TAKE lines (`takeHtml`, index.html) recomputed the pick live; for games in progress they now show the LOCKED pregame pick (lock from `lkLoad`, shared via /locks) with a 🔒 on each line. Pregame and final cards are unchanged (finals have no TAKE line). Before this, the lock mark only appeared in the small panel text and the results list.

## v176 — 2026-11-13 — bets from another account found in his; stats-log reset (logAt)
- Evidence (My Apps player days): player 38f5 and his account (cf32) had matching days (Nov 9: 4 bets 4-0 $351; Nov 10: 1 bet 1-0 $240...) = bets crossed between accounts under the pre-v167 code (no wipe when a different person signed in on a device). 6f07 showed no overlap. He deleted all 26 hand-added bets (kept his 6 Kalshi) from his account; 38f5's account was NOT touched (cleaning it needs that user's data).
- The frozen stats log (`betlog26`, "survives even if bets are deleted") still held the old days, so My Bets / the console kept showing 27-6. New: `logAt` (localStorage `logat26`). Merge (`odds-api/sync.js`): the side with the newer logAt replaces the log outright (a stale phone can't bring old days back); equal/none = union as before. Reset = set `betlog26` to {} and `logat26` to Date.now() then sync; wipe list now includes `logat26` and `pinsat26`. Tests: /tmp-style merge tests PASS (reset beats old log, stale phone can't restore it, union unchanged).
- TODO ideas: a "Reset my stats" button for any user; owner tool to clean 38f5's account (needs their consent/data).

## v177 — 2026-11-13 — Kalshi cash-out PREVIEW (read-only)
- Open Kalshi bets in My Bets show "💵 Cash out now ≈ $X (+/-$ vs your $stake) · N contracts at ¢ · preview only, nothing is sold". Kalshi bets now store `kt` (ticker), `ks` (side) and `kn` (contract count) (index.html `kalshiSync`); `kcoLoad`/`kcoPaint` read the market's current bid (`yes_bid`/`no_bid`, cents or `_dollars`) through the existing signed /kalshi/proxy GET, cached 30 s per ticker, max 15 bets per refresh. No order is ever sent from the app.
- Next (he said yes to preview first, selling later): a Cash out button needs a trade-enabled Kalshi API key (his is probably read-only), a confirm screen showing price/contracts/proceeds, an order log, and sending `POST /portfolio/orders` with action=sell through a signed proxy POST (the proxy currently only forwards GETs? check kalshi-sync/server.js). Not built.

## Football backtest (Nov 14, Oddable v190, no app change)
- Scripts in backtest/ (bt.js, exp1.js, exp2.js); run inside a page holding the game data in window.name. Walk-forward: week-w predictions use only earlier weeks (+prior-season final for carry). Independent read-only review found no leakage/math errors.
- Data: 1,497 NFL games 2021-26, closing lines for 789 (677 with week>=3). Results: closing line alone Brier .2129, 65.1% straight-up; live model blend (90/10, sd 12.5) .2135 (+.0006 ±.0008, i.e. tied/slightly worse); model alone .230-.233, 59-61%. Best model variants (decay .92, ridge 3, carry) differ by <.002. Learned blend weight on model -> 0. ATS picks 48-51% (breakeven 52.4%), ROI -3% to -8%; no edge.
- Conclusion: model works as a sane power rating but adds nothing over the line; keep line as anchor. Limit: lines only for 2021-22 + part of 2023/25/26; 5-yr consensus-line test needs paid Odds API plan.

## Player-level backtest (Nov 14, Oddable v190, no app change)
- backtest/players.js. ESPN box scores for 1,496 NFL games 2021-26 (every player's pass/rush/rec/def stats). Tested (a) player game-scores summed per lineup + player-vs-opponent and vs-division history, (b) ridge "adjusted plus-minus" player strengths fit on every earlier game, lineups A (who played, optimistic) and B (previous game, no look-ahead). Walk-forward, n=434 line games (>=300 prior training games, week>=3).
- Result: players-only Brier .226-.229 vs line .2114 (worse by .015-.020); 90/10 with line +.0005..+.0009 worse; 80/20 +.0013..+.0019 worse; learned weight on players ~0-0.05; ATS 45-51% (breakeven 52.4%), ROI -2% to -14%. Player-vs-opponent/division features were worse than plain player strength. Players-only calls ~60-63% of winners (line 65%).
- Review: no bug that could hide an edge; leaks (lineup A) all favor the model. Caveats: only 2021+ history, n=434 can't detect a 2-3 pt edge, defender score uncentered, 5 sweeps under-converged, abbreviation map only WAS->WSH.
- Next ideas if wanted: true inactives/injury feed pregame, more seasons (needs older ESPN logs), tune defender scoring.

## Pregame availability test (Nov 14, Oddable v190, no app change)
- ESPN summary `injuries` on old games returns TODAY's injury list (dates 2026-11-14), so historical pregame injury data is NOT available from ESPN. Used a proxy instead: players who played in the team's previous game but not this one (missing talent, rated by prior career score), and QB swap (last game's starting QB differs). Proxy uses actual participation (slightly optimistic).
- Walk-forward on 676 line games (week>=3): all variants within +/-.001 Brier of line (+.0002 to +.0010, CI +/-.0009 to .0024); learned weights ~0; ATS 46-52%. QB-change games (161): when home QB swapped, home beat the line by -2.0 pts avg (n72), away QB swapped +1.0 (n75); both within noise (SE ~1.5). Line already prices availability.

## College football backtest (Nov 14, Oddable v190, no app change)
- ESPN FBS (groups=80) regular season 2021-26: 5,026 games, closing lines for 2,391 (2021, 2022, 2026 mostly; 52-54 each in 2023/2025). Same walk-forward method as NFL with college settings (hfa 3.5, decay .95, ridge 1, mix .7, carry 1, W_MKT .8, SD 16). Efficiency = yds/play from totalYards/(pass att + rush att) + turnovers. Evaluated on 1,836 line games (week>=3). Player-level college test NOT run (data heavy; NFL result was negative).
- Results: line alone Brier .1719, 74.3% winners (CI 72-76). Live college model .1875 / 71.1% (+.0156 +/-.0044 worse); margin-only 70.7%, efficiency-only 68.9%, Elo 69.4%. Blends 90/10 +.0005, 80/20 +.0012, 50/50 +.0047 (all worse than line). Disagreements with line favorite: model right 82 of 223 (37%), Elo 98 of 286 (34%). ATS 47-50%, ROI -3% to -10%. Always-home 59.6%. No-line model on all 3,958 games: 72.2%.
- Conclusion same as NFL: line is best; model adds nothing. Plan agreed: lead with line-based win %, label model "reference only", build bet tracker/line shopping/arbitrage value.

## v195 – Ask AI push-to-talk (voice)
- pics/ai.js: big "🎤 Hold to talk" button in the Ask sheet. pointerdown starts SpeechRecognition (webkit prefix ok, continuous, restarts if the browser stops mid-hold); release stops, waits 450 ms for last words, puts the text in the box, sends via aiAsk(q,gid,true).
- Voice asks append a hint so Claude answers in 2-4 plain sentences; reply is shown AND spoken with speechSynthesis (markdown/emoji stripped, split in ~180-char chunks). ⏹ Stop button; closing the sheet stops speech. "Voice replies" toggle (localStorage ai-voice) also speaks typed answers.
- Unsupported browser → clear message, text box still works. Mic blocked → message to allow it in browser settings.
- Tested only with a mock (tests in /tmp/t_voice.js); real mic/speech needs Steve's first try on his phone (iOS Safari/PWA may limit SpeechRecognition).
- Also includes v194 (Kalshi cash out) if not yet pushed; reviewer report for v194 still pending at time of writing.

## v196 – review fixes for v194 cash-out
- server: body `null`/non-object on /proxy and /order now 400 (was TypeError). 
- client: Cancel/close ignored while a sale is in flight (KCOSEND); kcoAsk uses a token (M) so a cancelled/reopened modal can't leave a stale interval or show another bet's price; `kn` = bought − sold (partial sales no longer overstate); "no fill"/error wording now says check Kalshi instead of "nothing sold".
- Open (from reviewer, not fixed): upstream fetch has no timeout; no per-IP limit on /kalshi/order; confirm-button mis-tap on layout shift; kco-ro flag never clears; only first 15 open bets get live cash-out values; 45-day window can mismatch buys/sells on old positions; "result if sold" ignores sell fee. Real Kalshi semantics (reduce_only trim vs reject, fill field names, combo sells) unverified: first sale must be a small position.

## v197
- Header badge (span before #kdot in index.html) was hardcoded v194 and looked like the app was stale; bumped to v197. REMEMBER: bump this badge, the sub line, <!-- Pics --> comment, sw.js, sports.html gate.js on every release.

## v198
- SW was already network-first + skipWaiting + auto-reload on controllerchange. Added: every open app checks for a new version when it becomes visible and every 5 min (index.html, classic.html), so people with the app left open get new builds without reopening.

## v199
- Phone (<=700px): TODAY banner (#plb) is now a slim full-width strip at the very top, content pushed down (#sc padding-top) so it can never cover the header buttons, Kalshi light or game cards. Tap still expands the bet list (full width). Wide screens unchanged. Verified by local screenshot at 390px.

## v200
- Reverted v199 top-strip banner (Steve wanted the old floating TODAY box back in the corner). Instead the version badge, Kalshi light and acct text moved to their own row under the Add bet / Ask AI buttons (flex-basis 100
## v200
- Reverted the v199 top-strip banner (Steve wanted the old floating TODAY box back in its corner). The version badge, Kalshi light and acct text moved to their own row under the Add bet / Ask AI buttons (full-width wrapper in header .hbt) so the banner cannot cover them. Verified by local screenshot at 390px.

## v201
- Voice replies gave no sound on Steve's phone. Fixes in pics/ai.js: aiUnlock() (zero-volume utterance inside the tap; iPhone only speaks after a tap) on mic press, Ask/preset tap and the voice toggle; toggle now speaks "Voice replies are on. Can you hear me?" as an instant test; picks an English voice explicitly; if speech has not started after 2.5 s the sheet says to check the ringer/silent switch and volume (iPhone mutes web speech when the silent switch is on).
- Not verified on a real phone.

## v202
- Conference dropdown (#conf) now sits to the right of the team search (.srow); the old "All teams" select (#team) is kept in the DOM but hidden so pickTeam/search code still works. College: ESPN team.conferenceId captured as `cid` on each team (CONFN map: ACC, Big 12, Big Ten, SEC, Pac-12, C-USA, MAC, Mountain West, Independents, Sun Belt, American). NFL: AFC/NFC + 8 divisions from the hardcoded NFLD map. Filter applied once where `games` is built in render (affects the main list and the Live page); choice saved per league (`pics-conf-<lg>`). Cached games from before this version have no `cid` until the scoreboard refreshes.
- Live page order: live games = games with MY bets first, then highest model confidence; upcoming/final keep time order but my-bet games come first.

## v203
- Kalshi parlay card now shows the live cash-out line + "Cash out…" button (the line was only in the single/prop template before).
- kLegLink() (called at start of betsRender): Kalshi combo legs ("Alabama to win", day) are linked to that team's game in ALL/XL (unique team match within ~40 h of the leg day) by setting l.gid/side/type='ml', so legs show opponent, score, live status. Kalshi's own settled result (l.k && l.res) still wins in legGrade. Sync change-detection uses legSig (text,res,day,k only) so linking does not cause rewrites.

## v204
- "📡 View live game" button on every football game card (all states, was live/final only), on every linked parlay leg, and on single bets whose game is from the other league. Single bets show the score line (live/final) above the game card. liveBtn(gid) picks the right ESPN path (college vs NFL) for games from ALL vs XL.
- Not done: sports.html (NBA/MLB/NHL/NCAAB page) cards were not changed.

## v205
- v203/v204 linker used fuzzy team matching and linked "Georgia" to Georgia Tech, "Houston" to Sam Houston, "Virginia Tech" to Virginia. Now exact normalized team name only (St.→State, parens dropped, short display name), re-evaluated on every render (any gid on a Kalshi leg is linker-made; wrong ones are removed). Possible side effect to watch: a parlay that was graded from a wrong link in v203/v204 may have a remembered b.fin; check Kalshi parlays if anything shows lost that should not.

## v206
- The "📚 N books" control only existed inside game detail, so nobody saw it. Main game card footer (nft) now has a "📚 N books" button (NFL pre-game, when many-book data loaded) that opens a sheet (booksOpen): each book with a 2-letter initials badge (no trademarked logos), its spread and price, consensus, best line per side. "📡 Live" button now on every card state (was live/final only).
- Book logos deliberately not used (trademarks); initials badges only. NCAA still single-book.

## v207 – arbitrage / middle finder (gold)
- odds-api/games.js: each book now also returns `pa` = price of the AWAY side at that line (no extra credits).
- pics/index.html arbOf(g): pairs a home leg (book A, covers if margin > A.l) with an away leg (book B, covers if margin < B.l), different books, B.l >= A.l. ARB = implied probabilities of the two prices sum < 1 (guaranteed profit, shows %); MIDDLE = at least one whole-number margin strictly between the lines (both bets can win; shows worst case and hit %). Gold ring + "💰 ARB"/"🟡 MIDDLE" button on the NFL card (pre-game only), gold box + gold-highlighted books in the 📚 sheet. Moneyline/total arbs not covered (only spreads are fetched). Unit-tested logic in /tmp/arb.js (not committed).
- Needs calcutta-odds redeployed; cached /games data without `pa` shows no flags until the next refresh (120 min cache; restart clears it).

## v208
- Middle flags now show a rough probability of landing in the window (normal curve, sd 13.5 around the consensus line, whole-number margins strictly between the two lines) and a rough average result = p*both-win + (1-p)*worst case. It is an estimate only (ignores key-number clustering at 3/7).

## v209 – hands-free voice conversation (pics/ai.js)
- "🎙 Start conversation" button: listens (SpeechRecognition, continuous=false so it ends on a pause), sends, speaks the answer, and ONLY AFTER the speech ends starts listening again (so it never hears itself). Keeps the last 3 Q/A as context. Ends on: tap again / ⏹ / closing the sheet / saying "stop", "end", "goodbye", "that's all" / 3 silent rounds in a row / mic blocked. aiSpeak(text, done) has a length-based watchdog so a missing speech-end event cannot stall it. Hold-to-talk stays as "one question" mode.
- Tested with a mock (/tmp/t_conv.js: listen → ask → speak → listen → ask with history → silence ends). iPhone may ask for the mic again between turns; not verified on a real phone.

## v210
- Found by rendering a mock card: (1) the card footer (.nft) overflowed on phones once the MIDDLE/books/Live buttons were added; it now wraps (line text on its own row). (2) The "Best for HOME / AWAY" labels in the books list were swapped since v172 (they showed the worst number); lowest line is best for home, highest is best for away; now shown as e.g. "NYJ +8.5" / "BUF -7.5". (3) Book initials badges were duplicating (BE/BE); now built from capital letters (DK, FD, BM, BR).

## v211 – arbitrage alert bar
- #arbbar in the header (between the version/acct row and the league chips): scrolling gold strip listing flagged NFL pre-game games ("💰 ARBITRAGE BUF@NYJ: NYJ +8.5 DraftKings / BUF -7.5 FanDuel"). True arbitrage -> strip BLINKS red/gold with "🚨 ARBITRAGE ALERT 🚨"; middles only -> steady gold scroll (blinking for ~7 middles a day would be noise). Tap opens the 📚 sheet for the first hit. arbBarPaint() runs on every render and after loadBooks; hidden when nothing is flagged or on the NCAA page. prefers-reduced-motion disables the animation. Verified by local screenshot (mock games).

## v212 – yellow arb alert, arb game first
- Arbitrage bar is yellow and blinks (`.arbbar.arb`, `arbblink`); text "💰 ARBITRAGE ALERT 💰".
- A true-arb NFL pre-game is sorted first in the card list (`newBoard`, `isArb`), the rail (`railRender`, `arbF`) and `thisWeek` (`arbTop`), and its card shows a gold "💰 ARBITRAGE #1 · about +x.x% either way" tag (`.arbtag`).
- Middles keep the gold ring but are not moved. Verified with a local Playwright mock (/tmp/shot7.js), not the live tab.

## v213 – sport filter on My Bets
- Dropdown above "How I'm doing" (`bSportSet`, `BSP`, saved in localStorage `pics-bsp`) filters the My Bets cards, summary tiles, drill-downs and open count by sport. Only shown when bets span 2+ sports.
- Sport of a bet: `b.lg` (nba/mlb/nhl/ncaab); football bets have no lg, so NFL = either team abbr is an NFL team (`NFLD`), else NCAA football. Parlays match if any leg matches; props/unknown → Other.
- The TODAY box and daily log intentionally still count every sport.
- Caveat: an NCAA team whose abbr equals an NFL abbr (e.g. MIA) is counted as NFL unless the bet has lg.

## v214 – lock scoreboard
- New "🏁 Lock scoreboard (season)" box at the top of Stats (Games ▸ Stats & locked), per league: season locked-win record, locked-spread record with the 52.4% break-even, and a wrapped card per week (`lkScore(weeks)` in index.html, uses the existing per-week lock counts). Honest note when spread locks are under break-even.
- Why: Nov 14 replay of last week (NFL wk9, NCAA wk10): locked winners 13/14 NFL, spread locks 5/14; model replay matches the locks; model ≈ the line, so spread picks are leans only. Scoreboard keeps the real record visible while we decide whether to sell it.
- NCAA locks are per device unless synced via /locks, so NCAA week numbers can be partial.

## v215 – fix My Bets crash from v213 (urgent)
- v213 bSport1: `if (ab) if (!NFLAB) init; return NFLAB.has(...)` lost its braces, so any bet with no team abbreviations (props, Kalshi legs with no game) hit `NFLAB.has` on null and betsRender threw (My Bets blank, live page error). Fixed with braces. Test now includes an abbr-less prop bet (/tmp/shot8.js).
- Lesson: mock tests must include prop / parlay / no-game bets, not just single bets with teams.

## Nov 14 2026 – lock/model analysis (no app change)
- Findings (NFL, walk-forward, nflverse closing lines, 2018-25 = 1,867 games): the model, the 50/50 blend and every player-lineup variant (trailing-3-season weights 1/.6/.3, EPA-based player scores, lineup = last 3 games minus Out/Doubtful, Questionable x0.5 from the OFFICIAL injury report) are worse than the closing line (RMSE line 12.82 vs 13.24-13.46). Best spread result 52.0% (947-874) < 52.4% break-even. Predicting (result - line) from players gains nothing (12.83 vs 12.82); injury value alone vs the line = 49.4% -> the market already prices injuries. Actual-lineup (look-ahead) ceiling 51.9-53.8%.
- Winner side: app winner pick == favorite (90/10 blend); at real moneylines (2015-25) favorites by 10+ pts win 85.6% but ROI -0.6% (avg ML -719); 7-10 pts ROI -2.2%; 14+ ROI -1.3%; dogs of 10+ ROI -17%. So no winner-lock edge either.
- Decision pending from Steve: stop spread locks / label reference-only; make locks a server job and not user-dependent; tabled idea: pregame-lineup lock (scheduled probe of ESPN inactives Sun Nov 15 10:45 CT, likely moot given the results).
- Scripts: backtest/nflverse/ (bt_players.py, eval.py). Data sources: nflverse (free, reachable from the sandbox through GitHub).

## Nov 14 2026 – v216: strategy tools (info only; model and locks NOT touched, per Steve)
- Built from the review round (no strategy beat the closing line after multiple-testing; these are information/measurement tools):
  - **Wind flag** (💨 chip on outdoor NFL cards, Open-Meteo forecast at kickoff, 12+ mph shows, 15+ highlighted; sheet gives the history and a live record of flagged games kept in localStorage `wndlog26`). `parseEvents` now also stores `g.total` (ESPN overUnder) and `g.indoor`.
  - **Key numbers + best price** inside the 📚 books sheet (`keyNumHtml`, `shopHtml`): half-point worth up to -131 off 3, -125 off 7, -119 off 6, -120 off 10, else about -116.
  - **Teaser dog legs** (🎯 chip when consensus line is 1.5–2.5): break-even leg rates by price, history 77.5% of 693 legs. Weak evidence; says so.
  - **Price log** `odds-api/pricelog.js`: every 20 min saves Kalshi NFL market prices (series env `KALSHI_SERIES`, default KXNFLGAME,KXNFLSPREAD,KXNFLTOTAL; public endpoint, base env `KALSHI_PUBLIC_BASE`), cached multi-book spreads (no credits spent, uses `games.peek`) and ESPN line, into Supabase rows `plog:YYYY-MM-DD-HH` (Chicago hour; read with /pricelog?day=YYYY-MM-DD-HH). Read at `/pricelog` (status) and `/pricelog?day=YYYY-MM-DD`. NOT verified live: sandbox cannot reach Kalshi; check `/pricelog` status after deploy.
- Decision (Steve, Nov 14): keep the model out for now; the scoreboard relabel ("favorite" label, all-games baseline) is NOT built.
- Reviews' key finding: no spread/ML/total rule beats the line after correction; the shaded side loses about 7%; teaser dog leg and windy Unders are weak leads. One season of price-log data is the next real test.

## Nov 14 2026 – v217: owner dashboard wins/losses
- `pics/dash.js`: new Wins and Losses tiles on the owner dashboard home (tap opens that list), and an All / Won / Lost / Push filter (with counts) on the Bets list. The dash.js cache param in `index.html` was stuck at ?v=183: bump it whenever dash.js changes (now ?v=217).
- Steve (Nov 14): all accounts are free for now; he will change the subscription later. Do not add paywalls or billing changes until he asks.

## Nov 15 2026 – v218: owner dashboard no longer closes by itself
- Cause: background page reloads wiped the `#odash` overlay: `checkUpdate` (new version out), the service-worker `controllerchange` reload, and `sync.js` reloading when a bet is added/settled/pinned from another device.
- Fix: those three skip the reload while `#odash` exists; `dash.js` also saves `odash-open` in sessionStorage and reopens the dashboard after any reload (Close clears it). Lesson: any new auto-reload must check for `#odash`.

## Nov 15 2026 – v219: pull-down inside the owner dashboard flashed the main page
- Cause: the app's window-level pull-to-refresh (index.html, `#ptr`) still fired under the `#odash` overlay (window.scrollY is 0 while the overlay scrolls), refreshing/reloading the main page; v218's auto-reopen then made it look like flashing.
- Fix: pull-to-refresh ignores touches while `#odash` exists; overlay has `overscroll-behavior:contain`. Rule: any window-level gesture or auto-reload must check for `#odash`.

## Nov 15 2026 – win/loss totals fix (server, odds-api/sync.js `adminUsers`)
- Problem: owner-dashboard totals came from either the daily log or the per-bet results (whichever had more), so they disagreed with the bets: the log skips today and goes stale, the bets miss deleted ones.
- Rule (Steve: deleted bets still count): per day take the bets unless the log has MORE settled bets (tie goes to the bets: they hold actual money), then sum the days; settled bets with no day are added on top. Expected after deploy: 38f5 44-18-1, d3b6 35-60, 6f07 30-42 (were 41-16-1, 33-59, 27-38).
- Not verified: whether Kalshi-synced results themselves are right (they come from Kalshi settlement).

## Nov 15 2026 – dashboard Open bets list: "? ML" rows
- Cause 1: Kalshi parlays have no text/side, so the label fell back to "? ML". Parlays now read "N-leg parlay" (odds-api/sync.js `lbl`).
- Cause 2: empty bet records (only `t` and `id`, $0 stake, e.g. player 4143) passed the filter because the old regex had a stray leading space. They are now dropped from `open`.

## v220 — Underdog-off-blowout tag (info only)
- Card chip "🐶 Dog off blowout" when the market underdog lost its last game by 14+ (NFL, pre-game). Sheet explains: 2004-2025 dog covered 652-577 (53.1%, 28 pushes, 1,257 games, about +15.7 units at -110), ~break-even after juice, 1 of 24 factors tested, not significant after correction.
- Does NOT touch model, locks or scoreboard. User approved Nov 15 2026 after factor backtest found no edge.

## v221 — Trophy picks (spread): #1 = 🏆🏆, #2 = 🏆
- `pics/trophy.js` (pure functions, no DOM) + `trophy-model.json` (frozen logistic factor model, trained 2004-2025, 45 factors, never retrained in-season) + `trophy-hist.json` (2020-2025 results for last-game/h2h features). Python original: /tmp/nv/work_dogs (dogs.py, D.pkl) — parity checked: JS reproduces the Python weekly picks exactly (2026: #1 8-2, #2 6-3).
- Each week the two games with the highest model chance to COVER (either side) are #1 and #2. Card chip "🏆🏆 #1 / 🏆 #2 TEAM line". Results tab: boxes with #1 / #2 / both W-L, percent, units at -110, then a week list.
- Freeze: before the week's first kickoff the pick list is saved per phone (localStorage `trk26-wN-live`, copied to `trk26-wN` at kickoff). Weeks seen only after kickoff are marked * (picked after the fact, model frozen). Not synced to the server yet.
- Honest framing is printed on screen: same method 2018-2025 ≈ 50%, break-even 52.4%; 2026 run leaned on away teams covering ~57%.
- Old locks/scoreboard/model untouched. User asked for it Nov 15 2026 after the factor/backtest work.
- OPEN: server-side lock of trophy picks (cross-device); NFL only (hidden for NCAA).

## v222 — Top Pick cards replace Bet of the Day / Biggest Upset Pick
- Games tab: the two gold cards at the top are now "🏆🏆 Top Pick" (trophy #1) and "🏆 Second Top Pick" (trophy #2) for the shown week, with spread, model cover chance and ✓/✗ once graded. Old Bet of the Day / Upset cards remain only as a fallback (NCAA, or trophy data not loaded yet). User asked Nov 15 2026 ("I thought we changed those").

## v223 — History box in Trophy picks
- Results > Trophy picks now has a collapsible "📜 History: same method, 2014-2025": per-season #1 / #2 records (each season picked by a model trained only on earlier seasons), totals #1 108-101, #2 110-99, both 218-200 (52.2%, about -1.8 units after juice). Static array TRH in index.html (computed in /tmp/nv/work_dogs, walk-forward). User asked Nov 15 2026.

## v224 — "Lock" now means only the two weekly picks
- User (Nov 15 2026): remove the old lock lingo; "lock" is now only 🔒🔒 Double lock (best game of the week) and 🔒 Lock (second). Removed the old 🔒 Locked win/spread tiles, the Locked picks list/score box, the lock badge on result rows, the 🔒 line in the stats note and the padlock on live cards; tab renamed "Stats". Trophy picks renamed everywhere (chips, top cards, Results boxes, History box).
- Underlying per-game snapshots (lockSnap / lk* / server /locks) still run silently; only the display was removed. Dead helpers lkScore/lockedHtml remain unused.

## v225 — Locks cover the whole season even without ESPN lines
- Finished games often have no line from ESPN, which would drop those weeks from Double lock / Lock. trophyData now fills a missing line from (1) the logged line history (lmLoad), then (2) `pics/trophy-season.json` (nflverse closing spreads, weeks 1-11 of 2026, keyed `week-away-home`). Tested: with every ESPN line removed the app still shows 8-2 / 6-3 / 14-5 for weeks 1-10.
- Results (boxes + week list) are computed from live scores in ALL, so they update on every refresh. trophy-season.json is static: refresh it from games.csv weekly if the Action-logged lines ever stop covering a week.

## v226 — Drill-down on every Double lock / Lock
- Each pick in Results > Locks is tappable (›). `lkDetail(id)` opens a sheet: pick + result, model cover chance, the 8 factors that moved it most (value and +/- effect for the picked side, from `Trophy.explain`), both teams' last game, last 3 meetings, the line history for the pick team, and "Open full game ›" (`lkOpenGame`: Results > week > game for finished games, openGame for the rest). Sheet ✕ is the back button. User asked Nov 15 2026 (standing rule: tiles drill down).

## v227 — No more green "TAKE" boxes
- Game cards' old win/spread recommendations (✅ TAKE ... / 👍 Lean / pass) are now neutral grey text: "Model leans X to win · N% · info only", "Model spread lean ... · info only", "Toss-up". Only 🔒🔒 Double lock and 🔒 Lock are recommendations. Model math unchanged. User approved Nov 15 2026 after asking how the TAKE boxes work (backtest: old spread picks ~48%, below 52.4% break-even).

## v228 — Live player props
- New prop form section "Live tracking": game, player (full name), stat (rush/rec/pass yds, receptions, pass/rush/rec/any TDs, completions, rush attempts, INTs), line, over/under. Saved on the bet as `b.pp = {gid,name,stat,line,dir}`.
- `propTick()` every 30 s (and 6 s after load / right after saving) fetches ESPN `summary?event=ID` for live/just-finished games with tracked props, `parseP` reads every athlete's passing/rushing/receiving lines into `PSTAT[gid]`, `pFind` matches the name (full name, else unique last name + first initial). `propAuto` grades: over = won the moment stat > line; under = lost the moment stat > line; final: under unmet = won, over unmet = lost, exact = push. Auto results set `b.auto=true` (manual taps still win; editing a prop clears the auto result).
- Card shows "64 / 100", progress bar, "needs N more", score. Props without tracking stay manual (Won/Lost/Push buttons). Player must be in ESPN's box score (counts as 0 until he records a stat). Parlay legs that are props are still manual.
- Tested with mocked box scores (64 -> pending, 104 -> won, final under -> won). User asked Nov 15 2026.

## v229 — Every player needs a name or handle; owner is "Sir Oddable"
- Sign-up (phone+PIN and email) now has a required "Name or handle" field (2+ chars, 24 max); client and server (`/acct/phone` create, `/acct/register`) both refuse an empty name. Phone sign-ups save the name into the owner dashboard names store (`lock:names`) and into the My Apps account name.
- Existing players with no name get a one-time "Pick a name or handle" prompt after sign-in (`/acct/myname`, phone accounts; saved on the phone as `odd-name`). Email accounts already gave a name at sign-up.
- The owner's account shows as "Sir Oddable" in the dashboard (env `OWNER_NAME` overrides; default Sir Oddable). User said "I am Sir Oddable" Nov 15 2026.
- gate.js cache-bust in index.html was stuck at v=183; now v=229.
- Needs the odds server (calcutta-odds) redeployed to take effect for the server checks.

## v230 — Watch live links
- parseEvents now keeps `g.tv` (ESPN broadcast network names). Game cards (not yet played) get a "📺 CBS" chip; tap opens `tvOpen`: "Open <network>" link (Paramount+/CBS, FOX Sports, NBC, Peacock, ESPN, ABC, Prime Video, NFL Network, Netflix via TVNET map) and a "Sign in to a TV service" list (YouTube TV, Fubo, Sling, Hulu + Live TV, DirecTV, NFL+, Paramount+, Peacock). The service the user taps is remembered (`tvpref`) and listed first. Links only; Oddable never streams or sees logins. User asked Nov 15 2026.

## v231 — Cable and satellite providers in the Watch sheet
- Added a "Cable and satellite" group (Spectrum, Xfinity, Cox, Optimum, Verizon Fios, AT&T TV, DISH, Mediacom, Frontier) above the streaming services. The tapped provider name is remembered locally (`tvpref`) and listed first.
- DECISION (Nov 15 2026): Oddable does NOT store or collect TV-provider usernames/passwords. User asked to "remember credentials"; we only remember which provider they use. Reasons: storing someone's cable login in our app/sync server would make us a credential vault (breach and misuse risk, provider terms). The provider's own sign-in ("remember me") and the phone's password manager do that safely.

## v232 — Multiview
- 🔲 Multiview (Live page button, and "Add to Multiview" in the 📺 sheet): up to 4 games at once, full-screen overlay `#mv`, refreshes every 5 s from Oddable's own live data.
- Per tile: service picker (game's network, streaming, cable), 🪟 stream window (window.open, tiled by position), ↗ tab, 🔍 focus/grid toggle, ⛶ fullscreen, 🗑 remove. Top bar: add game, all streams (opens every tile's window), full screen for the grid.
- Limit: paid streams cannot be embedded (X-Frame-Options/DRM), so streams open in separate windows/tabs, not inside Oddable.
- State in localStorage `mv26` ({ids, svc}). No credentials stored.

## v233 — History box green look
- 2014-2025 History cells use the green hit / red miss boxes again: green when a season record beats break-even (52.4% at -110), red when below. Totals row too.

## v234 — TV sign-in wording, Spectrum link
- User signed in at spectrum.net and nothing linked: provider sites do not authorize the networks. Sheet now says to tap the network first and pick the provider on the network's own sign-in. Spectrum link now goes to watch.spectrum.net (Spectrum TV live). Still no credentials stored.

## v235 — Watch sheet simplified
- Removed cable/streaming provider lists (and the saved-provider pick). 📺 sheet now: network link, ESPN game page, Watch ESPN (app), Add to Multiview. Multiview service picker = game's network + ESPN. User request after Spectrum sign-in didn't link.

## College backtest route (odds-api/cfbd.js)
- `GET /cfbd/backtest` on calcutta-odds: needs env `CFBD_API_KEY` (set by owner, never in repo). Pulls FBS spread lines/scores per season from CFBD (cached 24h), walk-forward logistic model (12 features, C=0.05, trained on seasons before the test season), top 2 games/week = Double lock/Lock. Returns per-year W-L-push, totals, units at -110. Key is never echoed. Simpler factor set than NFL's 45.

## v236 — Results drill + info icon
- Results box: Double lock / Lock / Both boxes tap to a list of that group's picks (week, line, confidence, score, ✓/✗); tap a pick for the full breakdown, with a "Back to list" button. Standing rule: summary tiles drill down with a back button.
- The long caveat paragraph moved behind an ⓘ (INFO.trnote); the visible line is just the units at -110.
- `GET /cfbd/current`: replica of the app's current college spread pick (margin power ratings, last-season carry, 0.95 weekly decay, HFA 3.5) vs the same CFBD lines. Missing vs app: AP-rank prior, yards-per-play efficiency, neutral-site flag.
- `GET /cfbd/conf`: the current-model replica broken out by conference (both teams in same conference, else non-conference).

## v237 — Division road dog tag
- Informational 🏠 "Division road dog" chip on upcoming NFL games where the away team is the underdog in a division game (Trophy.isDiv in trophy.js). Sheet: 2004-2025 685-599 (53.3%, ~+24 units at -110), 14/22 seasons above break-even, home division dogs 48.6%. Labeled not proven (about a dozen slices tested). Does not change any pick or lock. Decision: user asked for it Nov 15 2026.

## v238 — Division road dog is a tracked rule (replaces the info tag in v237)
- User: "not an info tag, real code it and test it". Rule: take the road underdog (ATS) in every NFL division game. Green chip on upcoming games ("Division road dog: ABC +3"), Results tab section with "This season" and "Since added" boxes (tap to drill into the games), units at -110, info sheet. Weeks before 11 are back-filled; week 11 on (DD_START) is the real out-of-sample test. Graded vs the game's line (closing/last logged, nflverse fallback).
- Test: 2026 weeks 1-10 in the app = 17-11, same as the Python backtest. Walk-forward (bet only if prior seasons > 52.4%): 2010-2026 501-453 (52.5%, +2.5u); since 2015 352-298 (54.2%, +22u); 2004-2025 685-599 (53.3%). Chance best of ~12 slices looks this good by luck ~10%. Honest label kept: tracker, not a proven edge.
- Does not feed the Double lock / Lock picks.
- `GET /cfbd/slices`: college road dog / home dog cover rates by conference-vs-non-conference game and by conference (user asked for the NFL division road dog test in college).

## v239 — Locks that are also division road dogs get a 🏠 tag
- Double lock / Lock cards, top-pick cards and Results rows show "🏠 + division road dog" when the pick is the road underdog in a division game (trDD). Info only; lock info sheet explains. 2014-2026: those locks 48-35 (57.8%) vs 51.7% for other locks (found in the same data, not proven). 2026 wk1-10: 5 tagged picks.

## v240 — 📣 Oddable Alert of the week
- User request: make Double lock + Lock + tag-only division road dogs the "Oddable Alert of the week" with a megaphone. Banner at the top of the NFL Games board (alertBox) lists the week's picks with ✓/✗, season record and units (tap for all picks, alertDrill), ⓘ explains. History 2014-2026 combined 559-482 (53.7%, +26.2u, 1,041 games, ~80/season). 2026 wk1-10 in the app: 26-15 (63%, +8.6u); week 8 alone was 1-6. Same-data caveat kept: tracker, not a proven edge; week 11 on is the real test.

## v241 — Standalone lock cards removed from the board
- User: "remove the other locks since they're in the Oddable Alert". The Top Pick / Second Top Pick (Double lock / Lock) cards at the top of the NFL board are gone; the 📣 Oddable Alert replaces them. Lock chips on game cards and the Results tab (Locks boxes, History, Division road dogs) stay. Bet of the Day / Upset Pick do NOT come back (removed in v222).

## v242 — Units by pick type in the Oddable Alert
- Alert banner and drill sheet show record, % and units for 🔒🔒 Double lock, 🔒 Lock and 🏠 Road dog separately (alertTypes). User asked if it makes sense; it shows which pick type earns the units.

## v243 — Alert units: this week / season / 2014-26 by pick type
- Alert box shows a Week | Season | 2014-26 grid per pick type (record, %, units). Week and Season are live from the app; 2014-26 is a fixed table (ALH: Double lock 116-103, Lock 116-102, tag-only road dog 327-277, through week 10 of 2026 from the Python walk-forward). Update ALH when the season ends. Correction logged: in history the road dogs earned more units than the locks (+20.3 vs +5.9) because there are far more of them; this season is the reverse.

## v244 — Alert history = past 12 seasons (2014-2025)
- User: "add the historical data stating over the past 12 seasons" / "model over 12 seasons". The Alert grid's history column is now "12 seasons" (2014-2025 only, no 2026): Double lock 108-101 (-2.8u), Lock 110-99 (+1.0u), tag-only road dog 315-267 (+19.4u), combined 533-467 (53.3%, +17.5u, ~83 picks/season). Season-by-season table (ALY) in a "Past 12 seasons" dropdown in the Alert drill sheet. Losing seasons: 2017, 2020, 2023, 2024, 2025. Static data; refresh at season end.

## v245 — Double lock retired (user: "Kill the double lock. It's horrible.")
- The #1 weekly pick (🔒🔒 Double lock) is gone everywhere: trophyData keeps only rank 2 = 🔒 Lock. Results box shows one Lock box + History (Lock only); Alert = Lock + every division road dog that is not the Lock (former Double lock games that are division road dogs now show as 🏠 Road dog). Lock/info texts updated.
- 12-season (2014-2025) history recomputed: Lock 110-99 (52.6%, +1.0u), road dog 339-293 (53.6%, +15.2u), combined 449-392 (53.4%, +16.2u, ~70 picks/season). ALH/ALY updated (year, Lock W L, road dog W L). Double lock was 108-101 (-2.8u).
- Test on the app's 2026 wk1-10: Lock 6-3, road dogs 17-10, 23-13 (64%, +7.9u).
- Checked whether the factor model improves the road dog pick: no. Model agrees with the dog 53.1% vs disagrees 55.6% (2014-25), top-1/week 54.5%; plain "all division road dogs" is as good as any filter. So the dog factor is not combined with the model.

## v246 — Road dog picks need model 53%+ (user: "add it to the list")
- A division road dog is an Alert pick only when the frozen model gives the dog 53%+ to cover (DD_MIN, ddP: frozen per phone in `ddp26-<id>` while pre-game; back-filled games are recomputed). Under 53% = "Not picked": gray chip on the card, listed in the Alert, tracked in Results (boxes "Picked (model 53%+)" / "Not picked", each drills to games with model %).
- Alert = 🔒 Lock + picked road dogs. 12-season history (ALH/ALY, 2014-2025, excluding Lock games): picked 141-120 (54.0%, +8.2u), NOT picked 198-173 (53.4%, +7.0u), Lock 110-99; Alert total 251-219 (+9.2u, ~39 picks/season). Honest finding: the two groups are nearly equal, so the filter trims volume, it does not find better dogs.
- Test (2026 wk1-10 in app = Python): picked 8-4, not picked 9-7, Alert 14-6. Week 8 with filter: 0-2 picked (KC Lock, ATL), 0-4 not picked.
- Double lock stays retired.

## v247 — 🤝 Helper
- User: "Add the highest probability team to the list... call it the helper". Each week's highest win-chance team (app win pick, pred().conf), straight-up/moneyline. Row in the Alert with ✓/✗ and a season W-L line that drills to all weeks (helperDrill). Saved per phone before the week's first kickoff (`hlp26-wN`); earlier weeks back-filled from current ratings. NOT counted in Alert units (no moneyline prices; heavy favorites are expensive). Local test wk1-9: 6-3 (losses: DAL 76%, LA 81%, HOU 77%).

## Session rotation — Nov 15 2026, evening (owner called it: "Reviewer")
- The session that built v220-v247 is now FIRST REVIEWER and stops coding. Owner flagged repeated unit-calculation confusion in chat (parlay comparisons). Next session is the coder; start from this file.
- Review findings for the next coder (not yet fixed):
  1. Lock and road-dog picks are frozen per phone (localStorage `trk26-wN`, `ddp26-<id>`, `hlp26-wN`), so records differ by device and from the Python backtest (e.g. week 8 Lock is TEN on the owner's browser, KC in the backtest). Needs server-side freezing so every device shows the same picks and record.
  2. v232-v247 were tested locally with mocked/2026 data only. Not yet checked on the live site on a phone: the floating My Bets banner must not cover the Alert banner, Multiview, Results boxes or drill sheets (owner's standing rule).
  3. ALH/ALY (12-season history) and TRH are static tables; refresh at season end. The Helper has no moneyline prices, so its parlay payouts quoted in chat were estimates.
  4. Parlay math was chat-only analysis; nothing about parlays is in the app. If built, payouts must come from real prices, with the rule stated on screen (owner's rule: Lock + one dog, Helper only when there is a single pick).
  5. DD_START = 11 but the owner's "today" was week 10; decide whether week 10 counts as live.
  6. odds-api: /cfbd/* routes use CFBD_API_KEY; acct.js name checks need the redeploy noted earlier.

## Reviewer's review of the Nov 15 2026 evening session (written by the retired coder, now first reviewer)
Owner asked for this to be recorded. Problems in that session's work, most serious first.

Numbers that did not match
1. Three sources quoted without labels: the live app (owner's browser), the Python backtest (/tmp/nv/work_dogs, nflverse closing lines) and the local Playwright test (2026 games.csv). Result: division road dogs quoted as 18-11 and 17-11; week 8 as 0-5 and 0-6; Helper as 6-3 and 8-2; Lock as 8-2 and 6-3. RULE GOING FORWARD: every number given to the owner names its source and period.
2. Picks differ by device (per-phone localStorage freezing). Root cause of most mismatches. Being fixed by the new coder (task 3).
3. Periods shifted between 2004-2025, 2014-2025 and 2014-2026 without saying so (+26.2u vs +17.5u for the same picks). RULE: history is stated over the past 12 full seasons (2014-2025) unless the owner asks otherwise.
4. Wrong claim, later corrected: "history shows the locks earn most of the units". Over 2014-2025 the road dogs earned +19.4u and the two model picks about -1.8u combined.
5. A 16-7 record was printed next to +8.54 units, which belongs to 16-6 (the Helper loss was counted in one and not the other).

Instructions not followed
6. Owner's parlay rule was "Lock + the dog; Helper only in weeks with a single pick". First run parlayed every pick (3-4 legs). Corrected run: 4-5, +5.58u (owner's browser, weeks 1-9, -110 legs, Helper price estimated).
7. Did not roll to reviewer at the first sign of degradation; the owner had to call it.
8. Called the owner's current week "week 11"; it is week 10 in the app.

Shipped without enough checking
9. Eight Alert versions in one evening (v240-v247), each tested on local data only; none checked on a phone or against the My Bets banner rule.
10. The 53% road dog filter (v246) is live but weakly supported: excluding the Lock's games, picked 141-120 (54.0%) vs not picked 198-173 (53.4%), 2014-2025. It trims volume; it does not pick better dogs. At a 50% cutoff the result reversed.
11. Spectrum link (watch.spectrum.net) shipped unverified (now unused; coder task 5).
12. /cfbd/* routes on the odds server are unauthenticated and spend the owner's CFBD_API_KEY quota (coder task 4).

What held up (for reference): division road dogs ATS 370-316 (53.9%, +20.4u) 2014-2025 and 685-599 (53.3%) 2004-2025, about a 1-in-10 chance of luck after testing ~12 slices; Lock 110-99; Double lock 108-101 (retired); no conference / do-or-die / lost-last-week signal; college factor model 171-182; weeks 15+ road dogs 51.1% (revisit a cutoff before week 15).

## v248 — Nov 15 2026 (new coder session): units audit, phone layout check, same picks on every phone, /cfbd owner-only
Owner: "Make sure that every app shows same information. Fix all of these issues."

### Units audit (no arithmetic bug found)
- Recomputed from raw nflverse games.csv with an independent script (own grading, own tallies; only the model probability comes from trophy.js) and compared with the app's functions in Playwright: 0 mismatches. 2026 weeks 1-9: Lock 6-3 (+2.45u), Alert road dogs 8-3 (+4.27u), Alert 14-6 (+6.73u), division road dogs picked 8-4 (+3.27u) / not picked 9-7 (+1.18u), Helper 6-3.
- 12-season tables re-run from the Python walk-forward (/tmp/nv/work_dogs/D.pkl): TRH, ALY and ALH reproduce exactly (Lock 110-99 +1.00u, picked dogs 141-120 +8.18u, not picked 198-173 +7.00u, Double lock 108-101, all division road dogs 370-316). ALH = column sums of ALY; ALY Lock columns = TRH #2 columns; every per-year units cell = W*100/110 - L.
- Things that LOOK like unit errors and were confusing (fixed or explained on screen):
  1. Results said "Picked 8-4" while the Alert said "Road dog 8-3": Results counts a picked dog that was also that week's Lock (wk 8 KC +1.5); the Alert counts it once, under the Lock. divBox now says so in words. Math unchanged.
  2. A dog at 52.5% was listed under "Not picked (under 53%)" but printed "53%" (rounding). `ddPct` now never prints 53 for a dog under the bar.
  3. Alert drill sheet headed its first column with a FUTURE week (latest week with any pick, e.g. "Week 11 0-0"); now the current week.
  4. NOT changed: each unit figure is rounded to 1 decimal on its own, so parts can differ from the total by 0.1 (Lock +2.5 and road dog +4.3 next to total +6.7; exact 2.45 + 4.27 = 6.73). Owner's call whether to show 2 decimals.
  5. `trnote` info text still quoted 218-200 (Lock + retired Double lock); now quotes the Lock alone, 110-99.
- Header version pill was stuck at v231 since v232 (now bumped; see the bump list above).

### Same picks on every phone (DECISION Nov 15 2026, owner request; reason: per-phone freezes made records differ by device)
- Per week the app takes, in this order: (1) `pics/alert-frozen.json` shipped with the app, (2) the copy frozen on the server, (3) this phone's own computation, only until the server answers. Old per-phone keys `trk26-w*`, `hlp26-w*`, `ddp26-*` are deleted on load and never read. `trophyData()` builds `TRC.A[week] = {src:'ship'|'srv'|'local', bf, lock, dogs:[{id,line,p}], helper}`; `divDogs()`, `ddOf()`, `helperOf()`, `alertAll()` all read that one record.
- (1) `alert-frozen.json`: 2026 weeks 1-9 (Lock, every division road dog with line and model %, Helper), keyed `week-away-home` with nflverse names (LA, WAS). Generated Nov 15 from games.csv + the frozen model; Helper = the v247 app's back-fill in the test harness (ratings through week 9, no injuries). NOTE: a phone that had its own frozen picks will change to these (e.g. week 8 Lock is KC +1.5, not TEN). Add a finished week to this file only if the server has no copy of it.
- Lines: a started/finished game uses `trophy-season.json` first (covers 2026 weeks 1-11, 163 games, identical to games.csv), then ESPN's line, then the phone's logged history. Weeks 10-11 in that file are a Nov 15 snapshot, not closing lines: refresh from games.csv weekly as before.
- (2) Server: new `odds-api/alert.js`, route `/alert` (wired in server.js). GET returns `{weeks}`; POST `{week, rec}` needs a signed-in `x-token` (same `acct.check` as /locks). Stored in the existing Supabase table `oddable_sync`, row id `lock:alert26`, written with `dbPatchIf` on `updated` (same pattern as locks.js): the first copy wins, a stored week is never overwritten, the loser of a race gets the winner's copy back. Guard rails: only ESPN's current regular-season week of 2026 is accepted, every game id must be in that week, teams must match ESPN (with the app's WSH->WAS fix), numbers range-checked. `pre:false` marks a week frozen after its first kickoff (shown with *). The server cannot check the model numbers themselves: a signed-in user with a modified app could freeze a wrong pick for everyone (accepted risk for now; to harden, compute server-side or restrict POST to `ownerOk`).
- Phone side: `alertPull()` on load and each tick (2 min throttle), cache in localStorage `asv26` (server truth only). `alertPush()` offers the current week only when every earlier week is loaded and final with a line (a half-loaded season gives wrong model numbers: caught in testing, a first version froze SEA -6.5 at 78%), never in mirror mode, never without a token. Fallback keys `afl26-wN` / `afh26-wN` hold this phone's own pre-kickoff pick and are used only while the server has no copy.
- Road dogs are now graded at the line they were picked at (frozen line), like the Lock. Before, they were graded at whatever line the phone had.
- DD_START stays 11 (only a comment now). On-screen wording is built from the data (`bfTxt`): weeks whose record is back-filled are listed; with the shipped file that is weeks 1-9, plus week 10 once it is frozen mid-week. Info sheets say: weeks 1-9 back-filled, week 10 frozen after its first game, week 11 on is the real test.
- Tests: `node odds-api/alert.test.js` (in-memory store, fake ESPN, fake sign-in: first copy wins, no overwrite, race, wrong week/team/game refused, ESPN down = 503). Playwright, real page at 430x900 against the real alert.js behind an in-memory store: phone A (clean) froze week 10; phone B (stale trk26/ddp26/hlp26, different lm26 line history, a stale local week-10 freeze) and phone C (mirror mode) showed identical Lock, road dogs with %, Helper and records for weeks 1-11; phone D with the server unreachable kept weeks 1-9 identical and fell back to its own week 10 without posting.
- NOT verified (sandbox cannot reach them): the live calcutta-odds deploy, Supabase reading/writing row `lock:alert26`, real ESPN payloads, the real CORS preflight from a phone (Playwright answers preflights itself; the headers used are content-type and x-token, both already allowed). After deploy: open the app signed in, then GET https://calcutta-odds.onrender.com/alert and check week 10 is there; open a second device and compare. The odds server MUST be redeployed for (2); until then every phone stays on its own week 10+.
- Week 11 before ESPN makes it the current week is computed live on each phone (same inputs, so same result at the same moment) and is frozen when the first phone opens it as the current week.

### Phone layout check (430x900, screenshots read)
- Checked: NFL Games board with the Alert (scroll 0-700), Results tab (Locks box, road dog boxes, history, week list), Alert drill + 12-season table, road dog drills (picked / not picked), Helper drill, Lock list + Lock detail, Multiview. The My Bets banner covered nothing: it sits in the header's reserved corner at the top, tucks away once the sport chips reach it, and is behind sheets (z 300) and Multiview (z 250). No page-level sideways scroll; grid headers sit over their columns.
- Fixed: Alert grid cells wrapped raggedly in the 12-seasons column (now record on line 1, "% · units" on line 2); "Wk 10 *" wrapped onto two lines in Results (.trn 58px, nowrap); Multiview on a phone squeezed 4 tiles into one screen and hid each tile's buttons (now tiles take their natural height and the grid scrolls, max-width 700px only).
- Not checked: a real phone on the live site; the banner with real bets on it (taller, same tuck-away rule); the expanded banner panel still covers Add bet / Ask AI while open (known since v149).

### /cfbd routes are owner-only (review item)
- `odds-api/cfbd.js` now answers 401 unless `acct.ownerOk(req)`: the existing owner-PIN token (`x-token` from /acct/owner), or an owner phone token plus its `x-dash` second factor. Same rule as /acct/dash; no new secret. A browser address bar can no longer call them: `curl -H "x-token: <owner token>" https://calcutta-odds.onrender.com/cfbd/backtest`. Test: `node odds-api/cfbd.test.js`. The key is never logged or returned (unchanged).

### Removed dead code
- `TVSVC` and `TVCAB` (incl. the unverified Spectrum link) were referenced nowhere since v235: removed. `tvPref` is still used by Multiview's service picker (mvUrl / mvSet), so it stays.

### Open for the next session
- Deploy calcutta-odds, then verify /alert live on two real devices (above).
- Server-side check of the model numbers, or owner-only freezing (decision needed).
- Unit rounding display (1 vs 2 decimals).
- ALH / ALY / TRH are static: refresh at season end. alert-frozen.json and trophy-season.json are static: see notes above.
- Parlays: still not built (owner's rule stands: real prices only).

## v249 — Nov 15 2026: "Dog off blowout" figure corrected (text only)
- The second reviewer found a definition mismatch: the sheet quoted 53.6% of 1,303 games, from a script that also counted a team's last game of the PRIOR season as its "last game" in week 1. The app's `dogOff()` only looks at earlier games of the same season. Matching figure, 2004-2025 regular season: 652-577 with 28 pushes, 53.1%, 1,257 games (1,229 decided), about +15.7 units at -110; break-even 52.4%. The coder re-counted it from games.csv and got the same numbers.
- Changed: the `dogOpen()` sheet text and the code comment above `dogOff()` in pics/index.html, and the v220 line in this file. "About even after juice / information only / does not change any pick" wording kept. Nothing else changed. (The "1 of 24 factors tested" sentence was not re-checked.)

## v250 — Nov 15 2026: win/loss rows use the result-banner look (owner: "Use our previous banners for win loss")
- Owner circled the per-game result cards in Results (green border + tint for a hit, red for a miss, pill badges on the right) and asked for that look on the Lock week list. DECISION: every win/loss pick row uses it, for consistency.
- New helpers in pics/index.html: `resCard(result, leftHtml, pillHtml, onclick)` and `resPill(result, hitWord, missWord)`. They reuse the existing CSS (.res, .res.hit, .res.miss, .rtop, .badges, .b.hit/.miss/.push); no new colours. Pending and push = the plain .res card.
- Changed: `trophyBox()` week list (one card per week: Wk n, *, 🔒 team line, 🏠, model %, score or kickoff, ›; tap = lkDetail), `alertRow()` (Alert banner and Alert drill), `divDrill()` rows, `helperRow()`, `trDrill()` rows (tap = lkDetail with Back to list). Pills: "✓ Covered" / "✗ Missed" / "Push" for spread picks, "✓ Won" / "✗ Lost" for the Helper (it is a moneyline pick, so "Covered" would be wrong).
- Not touched: the per-game result cards themselves, record boxes, history tables, any number. Audit script re-run: 0 mismatches.
- Checked at 430x900 (screenshots read): Results Lock list, Alert banner on the Games board (weeks 9 and 10), Alert / road dog (picked, not picked) / Helper / Lock list sheets. No sideways scroll, no card overflow, My Bets banner covers nothing, taps open the right sheet. Not checked on a real phone or the live site.

## v251 — Nov 15 2026: 🏟 Field view (bigger live-game screen)
- Owner sent another app's live screen and asked for "something like this", then: "No player photo needed." DECISIONS (Nov 15 2026): (1) Oddable's own plain design, not a copy of anyone's artwork or layout; (2) no player photos or headshots, no new team logos, no images, no libraries (owner's words + keeps it light and avoids rights problems); (3) the drawn play is APPROXIMATE, start yard line to end yard line only, and the screen says so (the feed has no route or ball flight); (4) NFL only: college payloads were not checked, so the button is hidden for NCAA (`!CFB`) until someone captures a college game.
- Where: "🏟 Field view ›" on every in-progress NFL game: Games board card chips (`nCard`), Live page card (under the field strip), and the compact `liveView` card (so every Multiview tile has it). Opens in the standard sheet (z 300: above Multiview and above the My Bets banner) with a "‹ Back" button and ✕.
- Code (pics/index.html, just above `liveView`): `fvOpen(id)`, `fvHtml(g)`, `fvField(g, sit, lastPlay)` (inline SVG, viewBox 120x54: 10-yard end zones in team colours with the app's fallbacks #1d4ed8 / #7c3aed, yard numbers, blue ball line, yellow first-down line, play path), `fvPicks(g)`, `fvParse(summary, g)`, `fvPlay`, `fvKind`, `fvYL`, `fvX`, `fvSpot`, `fvLoad`, `fvTick`, `fvPaint`, `fvStop`. `parseEvents` now also keeps `sit.hto` / `sit.ato` (timeouts) and `sit.lp` (the scoreboard's own last play with start/end).
- Contents: teams + scores + quarter/clock + 🏈 possession + timeouts; "1st & 10 at CIN 35" (our own wording; "& Goal" when the distance reaches the goal line); last play text; the field; current drive (ESPN's "8 plays, 57 yards, 1:16"); last 6 plays newest first (timeouts, two-minute warning, end of period are dropped); Oddable picks on this game (Lock / road dog / Helper from the shared weekly record `TRC.A`, at the frozen line, "Covering now / Not covering now / Leading now", plain wording that nothing is final); the user's live player props for the game (`pStatHtml`). Shows only: no pick or number is changed.
- Data: scoreboard `competitions[0].situation` (already polled by the app) + `SB + 'summary?event=' + id` → `drives.current` / `drives.previous`. Polling: one summary call when opened, then every 30 s (same pace as live props) only while the sheet is open, the tab is visible and the game is in progress; the next tick after closing stops the timer without a network call. With no play-by-play the view still works from the scoreboard alone.
- ORIENTATION (the easy thing to get backwards). yardLine counts from the HOME goal line; away end zone is drawn on the left, home on the right, so x = 10 + (100 - yardLine); the away team attacks right, the home team attacks left; first-down line = yardLine + distance for the home offense, minus for the away offense. Spot wording: yardLine < 50 = "<home> nn", > 50 = "<away> 100-nn". If a play point has only yardsToEndzone: home offense yardLine = 100 - yte, away offense yardLine = yte.
- CHECKED AGAINST REAL ESPN DATA (read-only, through the owner's Chrome, own tab opened on ESPN's public API, closed afterwards; the app itself was not opened or touched): PIT at CIN, event 401873064, Nov 15 2026, captured at halftime and again live at 12:55 of the 3rd. Facts learned: situation keys = lastPlay, down, yardLine, distance, downDistanceText, shortDownDistanceText, possessionText, isRedZone, homeTimeouts, awayTimeouts, possession (possession is MISSING at halftime → we fall back to the current drive's team); `drives.current` is repeated as the last item of `drives.previous` (de-duplicated by play id); play types seen: Kickoff, Pass Reception, Pass Incompletion, Rush, Sack, Punt, Penalty, Field Goal Good/Missed, Passing Touchdown, Timeout, Official Timeout, Two-minute warning, End Period, End of Half; plays carry `isTurnover`, `scoringPlay`, start/end {yardLine, yardsToEndzone, team.id}, end.downDistanceText; a field goal by the away team ends at yardLine 0 and a home touchdown at 100; the play-by-play can be ONE PLAY BEHIND the scoreboard (so the scoreboard's lastPlay is drawn first).
  Results on the 24 captured plays: our spot wording equals ESPN's own text on 22 of 22 plays that have one (e.g. yardLine 69 → "PIT 31", 49 → "CIN 49", 62 → "PIT 38", 27 → "CIN 27"); the yardsToEndzone fallback equals yardLine on 38 of 38 points. Live re-capture: ESPN "1st & 10 at PIT 45" (yardLine 55, PIT ball) → ours "1st & 10 at PIT 45", ball at x 55, first-down line at x 65, last play (pass, yardLine 59 → 55) drawn x 51 → 55.
- Tests (Playwright, 430x900 and 1280x800, screenshots read): 5 mock games (away ball own half, home ball own half, home ball in opponent's half with a pass across midfield from yardsToEndzone only, away ball goal-to-go, no drive data) + 8 time-slices of the real capture (halftime as captured, the live re-capture, home pass across midfield, away sack, away run in own half, home pass in own half, away field goal, home touchdown): ball, first-down line and path start/end all on the expected yard lines. Punt / interception / sack / touchdown marks drawn from a gallery. Button opens from the Games board, the Live page (without toggling the card's chart) and a Multiview tile; Back closes; no sideways scroll; banner covers nothing; 0 page errors.
- NOT verified: the shipped build on the live site during a real game (unpushed code cannot run there: the real-data checks above ran locally on captured payloads); real team colours other than CIN/PIT; overtime, a real turnover, punt, penalty-only play or safety from a real feed (punt and turnover were mocks; play text in the real fixture was cut at 80 characters by the capture tool); college games.

## Nov 15 2026, late evening — session roles and analysis notes (no app change)
- OWNER'S SESSION RULE (changed Nov 15 2026): the session holder is the MANAGER. The manager hires the coder(s) and reviewers as background agents and swaps them out itself; it does not code. (This replaced the self-retiring coder rotation.) In this session: coder agent wrote v248-v251; an independent reviewer checked the road dog numbers; an analyst is running the original-model mock below.
- Independent review of the road dog numbers (raw nflverse games.csv, own scripts in /tmp/review2): all confirmed exactly (370-316 2014-25; 685-599 2004-25; lost-last 196-176; won-last 150-125; lost by 14+ 148-123; season table; home dogs 374-395; 2026 17-11). Only miss: the blowout tag's 53.6% (fixed in v249 to 53.1%). Records drop pushes.
- Division road dog cuts tested and NOT adopted: "lost previous game" (52.7% vs 54.5% for won-last, 2014-25); model filter at 50% reversed; blowout loss helped 2004-13 only. Weeks 15+ covered 51.1% (2004-25): revisit a cutoff before week 15.
- Parlays (chat analysis only, owner's rule = Lock + top picked dog, Helper only when one pick): 2026 weeks 1-9 4-5, +5.58u at -110 legs. Model's top-3 as a 3-leg parlay 2014-25: 29 of 209 weeks, -7.2u. Not in the app.
- Original Calcutta pick model (public/model.js, unchanged since Oct 25; day-one version = git b24e714, rewrite = e8bfe07): on 2026 it went 72-34 straight-up / 64-36 ATS in weeks 1-7 (hindsight: inputs dated Oct 25) and 31-10 / 13-28 ATS in weeks 8-10 (real test; favorite 34-7). A quick market-rating stand-in over 2014-25: 64.7% straight-up vs favorite 67.4%, ATS 1290-1212 (51.6%, -39.3u). A fuller walk-forward mock (reconstructed playoff % and title odds by simulation, both model versions) is being run by an analyst in /tmp/day1. OWNER: "Don't merge. Let's just analyze the results." -> analysis only, nothing goes into the app.
- Open decisions for the owner: owner-only saving of the weekly picks on the server; Alert = all division road dogs vs 53%+; week-15 cutoff; verify two real devices show the same Alert; Field view first seen live Nov 15 (PIT at CIN) - check a punt/turnover on a real game.

## v252 — Nov 15 2026 (coder agent, branch `v252-server-picks`, NOT pushed): the server picks, phones only show
Owner decisions D1-D4 are in the Decisions list at the top. Built to the manager's brief; an independent reviewer checks before the manager ships.

### What changed
- `odds-api/alert.js` (rewritten). The server runs the frozen factor model itself (`pics/trophy.js` + `trophy-model.json` + `trophy-hist.json`, loaded in Node) on ESPN's schedule/scores plus lines, and stores the result in the same row as before (`oddable_sync`, id `lock:alert26`).
  - Record v2 per week: `{ v:2, first, at, gl:{gameId:{l,s,lt,f,t,pre,late}}, lock, dogs:[], helper }`. `gl` = the line the server holds for each game (`l` home-favored points, `s` source books/espn/close, `lt` when that number was first read, `f` frozen). Each of lock / dog / helper is live until it carries `final:true` with `t` (when frozen), `pre` (true = frozen before that kickoff) and `late` (frozen more than 5 minutes after its 30-minute mark). `part:1` on a live value = "early look" (earlier results or box scores not all in).
  - Timing: Lock and Helper final at (week's first kickoff − 30 min); each road dog final at (its own kickoff − 30 min). A final part is never recomputed. A road team that is favored at its mark is frozen as "not a road dog".
  - Lines before a freeze: (1) the many-book consensus already cached by `games.js` (`peek`, no credit spent), only if fetched within the last 3 hours and before that game's kickoff; (2) ESPN's scoreboard line; (3) the last line the server stored. Finished games (model inputs) use the nflverse closing line (games.csv re-read every 6 hours), then `pics/trophy-season.json`, then the server's own stored line, then server.js's in-memory ESPN line log.
  - Who runs it: `server.js` calls `ALERT.tick()` every minute (15 s after boot) and GET /alert runs it lazily, so no phone has to be open. Weeks are computed once their first kickoff is within 9 days. A week in `alert-frozen.json` (1-9) is never recomputed. A record without `v` (week 10, frozen whole by a phone under v248) is left exactly as it is and served as final.
  - SLEEP (Render free plan): server.js already pings itself every 10 minutes when `RENDER_EXTERNAL_URL` is set, so it normally stays awake. If it still sleeps through a mark it freezes at the next tick with the last line it stored: before kickoff = `pre:true, late:1` (the app says "late: N min before kickoff"); after kickoff = `pre:false` (the app shows `*`, "not a pre-game pick"), even when the stored line was read before kickoff. With no line at all it waits for a closing line rather than invent one. If earlier results/lines are incomplete at the mark it waits until kickoff, then freezes flagged.
  - Routes: `GET /alert` (public) → `{season, now, markMin:30, tick:{at,ok}, stale, weeks}`; weeks 1-9 come back too (`src:'ship'`), stored weeks as `src:'srv'`. `POST /alert` (the old phone freeze) → 410 for everyone, including the owner. `POST /alert/fix` and `POST /alert/run` are owner-only through `acct.ownerOk` (owner-PIN token, or owner phone token + `x-dash`); `acct.check` is NOT used (it answers true while the gate is off). No new request header (CORS Allow-Headers unchanged: content-type, x-token, x-dash).
  - Logging (console, Render logs): every freeze (week, team, line, source, flags), every refusal (route only), tick/database errors (at most once per 10 minutes per message), every owner fix. No tokens, IPs, phones or secrets.
- `odds-api/helper.js` (new). The Helper is now server-sourced: a Node port of the app's NFL win pick (buildRatings + buildEff + the win-chance half of pred(): 90% line, 10% ratings). Box scores (yards per play, turnovers) are read once per finished game from ESPN's summary (12 per tick) and kept in a new row `lock:bx26`; until they are all in, the Helper is marked early look. The constants are duplicated from pics/index.html: KEEP THEM IN STEP (HFA 2.0, CAP 14, DECAY 0.85, RIDGE 6, MIXM 0.5, SD 12.5, W_MKT 0.9).
- `odds-api/server.js`: the tick, and `ALERT._deps.lines = () => LINES`.
- `pics/index.html`: picks come only from `alert-frozen.json` (weeks 1-9) or the server record. Removed `alertPush`, the phone computation (`local()`), `afl26-wN` / `afh26-wN` (deleted on load with the older keys) and the token read. `alertPull` keeps the last server answer in `asv26` (+ time in `asvt26`); if the server cannot be reached the Alert says "Could not refresh the picks from the server. Showing the server copy saved <time>." and never computes a pick. Alert rows, the Lock list, road dog drills, game-card chips and detail sheets show `live` / `live, early look` / `final` / `final *`, with a one-line legend in the Alert box. Info sheets rewritten. `fixL` now only feeds the "what moved the model" breakdown (server line first, shipped closing line for finished games).
- `pics/trophy-season.json`: refreshed from nflverse games.csv (fetched Nov 15 2026): now ONLY finished games (148: weeks 1-9 and the 12 finished week-10 games). The 15 unplayed entries (2 of week 10, 13 of week 11) were removed and 3 week-10 lines corrected to closing (CAR at NO 2.5→1.5, BUF at NYJ -7.5→-8.5, LA at ARI -9.5→-10). Stale pre-game numbers can no longer be read as closing lines.
- `pics/alert-frozen.json`: regenerated with the overtime flag. Exactly two model % changed (week 6 ARI at LA 0.5887→0.6169, week 7 TB at CAR 0.5158→0.5241); no Lock, no line, no picked/not-picked status and no record changed.
- `scripts/alert-data.js` (new): `node scripts/alert-data.js path/to/games.csv [--write]` refreshes both files and prints every change and the records. Run it when a back-filled week has to be added.
- Version v252 in every place on the bump list (plus `trophy-season.json?v=252`).

### Numbers (each with its source and period)
- 2026 weeks 1-9, shipped alert-frozen.json graded against nflverse games.csv (fetched Nov 15 2026) by `scripts/alert-data.js`, and the same from the app's own functions in the Playwright run: Lock 6-3, Alert 14-6, division road dogs picked 8-4, not picked 8-7, Helper 6-3 (app functions only). Unchanged by this version.
- CORRECTION TO EARLIER NOTES: "not picked 9-7" (v246 / v248 / the manager's brief) is weeks 1-9 PLUS week 10's Thursday game (WAS +1.5 at NYG, Nov 12, covered). Weeks 1-9 alone are 8-7 (27 road dogs: 16-11; with that game 17-11).
- Server model vs the shipped file: running `alert.js` `compute()` on a season built from games.csv with the shipped weeks switched off reproduces every week 1-9 Lock and road dog (line and model %) exactly (scratch script, not committed).
- Week 10 correction preview (frozen model on games.csv, this session): PIT at CIN +3.5 → 53.2%, +4.5 → 53.4% (picked either way); CAR at NO +2.5 → 48.6%, +1.5 → 48.3% (not picked either way). The stored % on the live server were not read.

### Tests (all local; nothing live was touched)
- `node odds-api/alert.test.js` — in-memory database (hands keys back in a different order, like Postgres), fake ESPN / nflverse / book cache / owner check: server computes with no phone; no write when nothing changed; line move before the mark updates dog, Lock and Helper; book consensus preferred while fresh, ignored when stale; live at 31 minutes, final at 29; line moves after the mark change nothing final while later dogs keep following; late wake before kickoff (pre true, late); late wake after kickoff (stored line or closing line, pre false); GET shape; POST /alert 410 for a phone and for the owner; /alert/fix and /alert/run refuse non-owners; fix dry run / apply / nflverse source / bad input / dog-would-flip refused; old v1 week untouched, served final, correctable; lost-write retry; ESPN down; database down; Helper formula; only ESPN and nflverse URLs fetched. `node odds-api/cfbd.test.js` still passes.
- Playwright (Chrome, 430x900, real `pics/index.html` in mirror mode against the real `alert.js` behind an in-memory store, ESPN fixture built from games.csv): a clean phone and a phone full of stale keys (trk26 / afl26 / afh26 / hlp26 / ddp26 / old asv26 / different line log) hold identical records and Alert text for every week; week 10 (old freeze) shows final *, week 11 shows live; server down = saved copy + note; brand-new phone with the server down = weeks 1-9 from the shipped file and no pick for weeks 10-11; Thursday of week 11 at 29 minutes = Lock and Helper final, Sunday dogs live; the page never sends anything but GET to /alert; Helper parity: the server's win chance equals the page's own `pred()` on all 13 week-11 games (max difference 0); 0 page errors. Screens read: Games board weeks 10 and 11, Alert drill, Helper drill, road dog drills, live Lock detail, live road dog sheet, info sheet, Results Lock list. No page-level sideways scroll; the My Bets banner covered nothing (top of page) and was tucked away when scrolled.

### NOT verified
- Anything live: the deployed calcutta-odds, Supabase (reading the real week-10 row, writing `lock:alert26`, creating `lock:bx26`), real ESPN payloads from the server (the sandbox cannot reach ESPN; the parser mirrors the app's), nflverse reached from Render, the real book cache contents, Render's sleep/wake timing, CORS from a real phone (no header was added).
- A real phone, the installed app, and the My Bets banner with real bets on it (mirror mode has none).
- The week-10 values used in the Playwright run are test values, except PIT +3.5 and CAR +2.5 from the brief.
- ESPN box-score reading on the server (same fields as the app's parseBox, but only tested on a fixture). First deploy needs about 13 minutes of ticks to load ~150 box scores; the Helper reads "early look" until then.

### How to ship (manager) and run the week-10 correction
1. After review: merge `v252-server-picks` into `main` and push. Both services redeploy (steves-pics static, calcutta-odds). Check Render shows the NEWEST commit live on both (see the v189 note).
2. No new Render environment variable. Existing ones used: `SUPABASE_URL`, `SUPABASE_KEY`, `OWNER_PIN` (and `RENDER_EXTERNAL_URL`, set by Render, for the keep-awake ping). Do not set `KEEP_AWAKE=0`.
3. Open `https://calcutta-odds.onrender.com/alert`: `tick.ok` should be true within a minute; `weeks.10` is the old record (`v:1`), `weeks.11` has `v:2` with live parts. Render logs show lines starting `alert:`.
4. Week-10 correction, after Monday's game (LAC at BAL) is final and nflverse has it (usually Tuesday morning). Get an owner token: `POST /acct/owner` with `{"pin":"<OWNER_PIN>"}` → `token`. Then dry run: `POST /alert/fix` with header `x-token: <token>` and body `{"week":10,"source":"nflverse"}` → read `changes` / `skipped`. Apply: same call with `"apply":true,"why":"owner Nov 15 2026: grade week 10 at closing lines"`. To do only the two named lines now: `{"week":10,"apply":true,"why":"...","fixes":[{"abbr":"PIT","line":4.5},{"abbr":"CAR","line":1.5}]}`. It changes grading lines only (original kept in `was`); it does not recompute the model % or re-choose the Lock. If `/acct/status` says `gate:false`, `/acct/owner` cannot issue a token and the route cannot be used until the gate is on.
5. Check two real devices show the same Alert for weeks 10 and 11.

### Open / needs the owner
- Week-10 correction: grading line only (built), or also recompute the model % at the closing line? On this session's data neither PIT nor CAR changes picked status.
- The 30-minute freeze uses the cached book consensus or ESPN's line and spends no credit. One Odds API credit per freeze mark (about 17 a week) would give a fresh many-book number at the mark: owner's call, off by default.
- A pick frozen after kickoff from a line the server read before kickoff is shown with `*`. Stricter than needed; say if it should count as pre-game.
- Still open from before: unit rounding (1 vs 2 decimals); Alert = all division road dogs vs 53%+; week-15 cutoff; parlays not built; ALH / ALY / TRH static until season end.
- Upgrade The Odds API plan (about $30/month) once Oddable sells.

## Groups (stage 1) — Nov 15 2026 (coder agent, branch `groups-v1`, NOT pushed, no version bump)
Owner (Nov 15 2026): "Create group for users where they can start season or anytime even a weekend to compete their picks and winnings vs the group for winners. Similar to fantasy and DraftKings but their groups. Allow switch for people to join groups with the commissioner allowing. Must set these options before start of the series." Mockups approved ("Love it. Build"): Main, CreateFormat, CreateRules, Requests, Standings, Matchup (Matchup = stage 2). Decisions G1-G11 are in the Decisions list at the top.

### Build
- `odds-api/groups.js` (new, server). Wired in `odds-api/server.js` (one line, route prefix `/groups`). Uses the signed-in token (`acct.who(req)`, new export) — commissioner = creator. No new request header (content-type + x-token are already in Allow-Headers). No new Render env var.
- `odds-api/acct.js`: exports `who` (account id from a valid token; null when the gate is off), `isOwnerPhone`, `namesGet`, `ownerName`. `odds-api/sync.js`: new `dbIds()` (all player row ids, no data) to find a phone account's own synced row.
- `pics/groups.js` (new, client overlay `#ogrp`, z-index 95, own dark violet palette scoped to the overlay; pattern of dash.js). Opened from the new "👥 Groups" item in the main menu. Screens: Groups home (my groups with place / winnings / pot tiles, open groups, pending requests), Join with a code (preview shows every rule and the take before joining), Create step 1 (name, sport, format; Head-to-head / Bankroll / Survivor shown disabled "Coming soon"; starts; runs for), Create step 2 (bets that count, winner, min bets, cap, entry, split, commissioner's take with live pot preview, weekly high-score prize disabled "Coming soon", money line G7, who can join, lock warning), Members / requests (toggle, invite code Copy / Text it, approve / deny, mark paid / undo, leave / delete / edit before start), Standings (This week with a week picker / Season / Prizes; place and pot tiles drill down; rows drill to the player), player drill-down (tiles filter the bet list; own view shows why a bet does not count; others' unstarted bets are a count only), locked-rules sheet, pot breakdown. Everything escaped; every value from the server.
- `pics/index.html` hooks (no version markers touched except the new script tag): nav item `it.push(['groups', '👥', 'Groups'])` in navRender; `navGo('groups')` -> `window.oddGroups()`; `checkUpdate`, the service-worker `controllerchange` reload and pull-to-refresh now skip while `#odash` OR `#ogrp` exists; script tag `groups.js?v=252` added to the non-mirror document.write line. `pics/sync.js`: the sync reload also skips under `#ogrp`. groups.js saves `ogrp-open` in sessionStorage and reopens after a reload (like dash.js).
- RULE (extends the #odash rule): any new auto-reload or window-level gesture must check `document.querySelector('#odash,#ogrp')`.

### Routes (all POST JSON, header `x-token`; 401 "Sign in to use Groups" without a valid token)
`/groups/mine` (my groups + open groups + my pending requests), `/groups/create`, `/groups/edit` (commissioner, before start), `/groups/get` (members: full; non-members: only open/requestable groups, rules + take, no member list), `/groups/preview` + `/groups/join` (invite code), `/groups/request`, `/groups/cancel`, `/groups/decide` (commissioner approve/deny), `/groups/requests` (toggle, before start), `/groups/paid` (commissioner, any time), `/groups/leave` (member, before start), `/groups/delete` (commissioner, before start), `/groups/standings` (`scope` season|week, `week`), `/groups/player` (`pid`, scope, week).

### Storage (Supabase `oddable_sync`; the `lock:` prefix keeps them out of player lists, /sync/admin and owner-dashboard counts — verified in sync.js adminUsers filter and the new dbIds)
- `lock:groups` = `{ groups: { <id>: group } }`, ONE row for every group, every change with `dbPatchIf` on `updated` (read → change → conditional write → retry up to 6x, else 409 "Busy"). Group = settings + `code` + `comm` (member key) + `members[{pid, mk, sid, name, joined, paid, fixedName}]` + `reqs[]` + `denied[]`. `mk` = sha256 of the account id, `sid` = the member's sync row id: both server-only, never returned. Clients only see `pid` (random 6 letters per group). Cap 400 groups (ended > 60 days are pruned when full), 20 running groups per commissioner.
- `lock:gl:<groupId>` = `{ bets: { <pid>: { <betId>: frozen bet } } }` ledger (G11).
- In memory only: rate limits, the sync-id map (10 min), names (60 s), ESPN kickoffs (5 min), member bets per group (60 s).

### How standings are computed (server)
- Member bets = their synced `bets` (sync.js row) merged with the ledger. A bet counts if: its day (America/Chicago; kickoff from ESPN when the game id is known) is inside the group window and after the member joined; verified-only passes; its type is on (Kalshi single markets: ticker SPREAD → spread, TOTAL → totals, GAME → moneyline, else prop); parlays have at most N legs; sport fits (port of the app's v213 bSport: `lg`, Kalshi ticker, else NFL abbreviation list, else college — CAVEAT: a college team with an NFL abbreviation such as MIA counts as NFL unless the bet has `lg`; legs with no teams (e.g. Kalshi combo legs) count only in "Both" groups or next to a matching known leg); a hand-logged bet (`b<ms>` id) created more than 5 minutes after its kickoff never counts.
- Result: `cash` (Kalshi sale) > `fin` > prop `res` (void = push). P/L: cash − stake, else `finPL`, else stake × payout. Cap scales P/L by min(stake, cap) / stake. Units = P/L per $1 staked (won), −1 (lost), 0 (push). Return % = winnings / counted stake. Win % = W / (W + L). Rank by the chosen metric, tiebreak Return %, then name.
- Weeks run Tuesday to Monday (an NFL week); week 1 = start day to the first Monday. Best five = only each member's five best results per week (by P/L, or units for Units / Win %). Min bets: a member with fewer counted bets (settled or open) in the current week is flagged; a short week cannot win the weekly high score.
- G6: `/groups/player` for someone else returns only counted bets whose every leg has kicked off (known ESPN kickoff, else the day is over, or the bet is settled with no future leg); the rest are a count ("N bets are hidden until their games kick off"). Standings carry no bet text at all.
- Start: the phone picks the first kickoff it knows on/after the chosen moment ("Next kickoff", "This weekend", "Next week", a date; fallback a fixed time); the server checks it is in the future and within 400 days, and works out the end ("This weekend" = the Monday after, N weeks, rest of season = Jan 11 2027 NFL / Jan 20 2027 college/both, through the playoffs = Feb 15 2027, or a custom last day). Rules lock at that start; bets count from it.

### Tests (all local; nothing live touched)
- `node odds-api/groups.test.js` — 27 checks, in-memory database (random delays so writes interleave), fake sign-in and ESPN: 22 bad inputs refused; HTML stripped from names; invite code; private group unreadable by a non-member; code preview shows the take; join idempotent; 10 wrong codes block for 15 min; only the commissioner marks paid / approves / denies / edits; denied cannot re-ask; max members; leave/delete rules; 12 simultaneous joins none lost (18 conflicting writes redone); create rate limit; after start edit / requests toggle / leave / delete refused for everyone (owner token too); late join Not allowed vs First 2 weeks; winnings with cap (181.82 → 90.91), type / legs / sport / before-start / logged-after-kickoff filters; min-bets flag and high score; hidden-until-kickoff never in any response, shown once kicked off; own view explains not-counted bets; deleted bet still counts; verified-only; ranking by each metric with Return % tiebreak; Best five; pot with % and flat take, cents, split sums exactly to the prize pool (brute force 195 cases); no sync ids / member keys / phone emails / tokens in any response; only ESPN URLs fetched. `node odds-api/alert.test.js` and `node odds-api/cfbd.test.js` still pass.
- Playwright (Chromium, 430x900, real `pics/index.html?mirror=1` + `pics/groups.js`, talking CROSS-ORIGIN to the real groups.js behind in-memory fakes with server.js's own OPTIONS answer; harness in /tmp/gplay, not committed): 17 screens captured and read (home, create 1, create 2 with flat take, new group members, standings season / week / prizes, another player with a hidden bet, own bets, Lost filter, pot, locked rules, members with requests, after approve, open group rules, join preview, joined not-started group). On every screen: no sideways scroll (overlay and page scrollWidth 430), no tap target under 44 px (switches made 64x44), the My Bets banner (forced visible with a test bet) is covered by the overlay, 0 page errors. checkUpdate does not close it; a reload reopens it; pull-to-refresh is ignored while it is open (control without the overlay refreshes); nav bar with Groups + Dashboard fits 430 px.

### NOT verified
- Anything live: Supabase reads/writes of `lock:groups` / `lock:gl:*`, `dbIds()` on the real table (`select=id&limit=5000`), real tokens from acct.js, real ESPN schedule payloads from the server, CORS from a real phone (no new header), Render.
- Real synced bets from real players (shapes taken from pics/index.html; Kalshi ticker words SPREAD / TOTAL / GAME assumed from KXNFLSPREAD / KXNFLTOTAL / KXNFLGAME).
- Email accounts and the owner-PIN sign-in have no synced bets row, so they can join and run groups but show "No synced bets" and count nothing. Only phone + PIN accounts count bets.
- If the gate is off (`/acct/status` gate:false) no tokens exist and Groups answers "Sign in to use Groups".

### Stage 2 (NOT built; shown as disabled "Coming soon" where the mockups had them)
Head-to-head with playoffs (Matchup screen), Bankroll challenge, Survivor, weekly high-score prize payouts (the weekly high score itself is shown), push alerts for join requests.

### Open items / for the owner
- G11 (ledger freeze, bets logged after kickoff never count, late joiners count from joining): confirm.
- Ties for a paid place are broken by Return % then name; equal-score ties do not split prize money.
- In-memory rate limits reset on restart (same as the rest of the server). One `lock:groups` row for all groups: fine for hundreds of groups; move to one row per group if it grows.
- "Open" bet counts of other members are visible (count only, not the pick).
- Upgrade The Odds API plan (about $30/month) once Oddable sells (unchanged; Groups spends no credits).

## Groups review fixes + contests — Nov 16 2026 (groups coder, branch `groups-v1`, NOT pushed, no version bump)
Owner decisions are in OWNER-DECISIONS.md and in the Decisions list at the top (G11 confirmed, G12-G15). This section SUPERSEDES the stage-1 "Storage" and "How standings are computed" notes above (stage 1 never shipped, so there is no live `lock:groups` row to migrate).

### Files
- `odds-api/grade.js` (new) — server grading from ESPN scoreboards (`site.api.espn.com/apis/site/v2/sports/<path>/scoreboard?dates=YYYYMMDD`, same paths the app uses) for NFL, college football (groups=80), NBA, MLB, NHL, college basketball (groups=50). Moneyline, spread (run line / puck line are spreads), totals, parlays of those (a pushed leg drops out; price = product of the legs' own American prices when every leg has one, v253 rule, else the parlay's multiplier), Kalshi GAME/SPREAD/TOTAL tickers mapped to their game (`KX<LG><MKT>-<YY><MON><DD>[time]<TEAMS>-<SFX>`, searched on the ticker day and the days either side), Kalshi combo legs "X to win" by team name. Returns `{x: reason}` for what it cannot grade (props, cash-outs, unknown tickers, missing price).
- `odds-api/limits.js` (new) — `maxPeople(accountKey, groupOrGameId)`, `ENTERPRISE_TEXT` (the one shared pricing string), `CAP_TEXT`, `keyOf`, `recordUse`, `/groups/ent/contact`, `/groups/ent/admin` (owner only, `acct.ownerOk`). Other engines: `const L = require('./limits'); await L.maxPeople(L.keyOf(acctId), gameId)`.
- `odds-api/groups.js` (rewritten) — contests, ledger, routes below, `tick()`, `statsFor`, `registerInvite`, `attachGame`.
- `odds-api/sync.js` — `id=not.like.lock:*` on the player-list query (adminUsers) and dbIds; new `dbList(prefix)`.
- `odds-api/server.js` — Groups tick every 5 minutes (only when `SUPABASE_URL` is set).
- `pics/join.js` (new, loaded first in `<head>`), `pics/gate.js` (invite banner on the sign-in screen, `OddJoin.run()` after sign-in), `pics/groups.js` (hub, contests, side pots, Invite people, Contact Oddable), `pics/dash.js` (owner: Enterprise requests tile, enterprise accounts with monthly usage, extra seats, "Make enterprise" on a player), `pics/index.html` (join.js tag; Groups nav item hidden in mirror mode).

### Storage (Supabase `oddable_sync`, every row id starts `lock:` so it never shows as a player)
- `lock:grp:<id>` one row per group (members, requests, contests, money). Every change = read, change, write only if `updated` is unchanged (`dbPatchIf`), randomized back-off, up to 16 tries, else 409 "Busy, try again".
- `lock:gl:<groupId>:<contestId>` contest ledger: per member per bet `{f: server first-seen, s: bet snapshot (frozen at kickoff), r: {legKey: {lg, gid, kick, side, kind, line...}} stored once, g: server grade, h: phone result (honor rule only), z: frozen}`.
- `lock:gm:<memberKey>` a member's own index (groups joined / requested / run). `lock:gidx` small index of every group (open groups, tick). `lock:gcode:<CODE>` invite code -> group id.
- `lock:ent` {acct: {key: {on, at, note}}, seats: {groupId: n}}, `lock:entreq` {list: [...]}, `lock:entuse` {key: {'YYYY-MM': {gameId: {n, title}}}}.

### Rules as built
- First-seen = the earlier of the server's clock and the member's synced row `updated` (stamped by sync.js on the server). A bet first seen at or after its (first) kickoff never counts. The tick reads members' rows every 5 minutes in game windows (30 otherwise) so bets are seen before kickoff even if nobody opens Groups.
- The snapshot follows edits made before kickoff; from kickoff on it is frozen (`z`). Results come only from the server grade; the phone's won/lost is used only when the contest has "Count bets the app can't check (honor system)" on.
- Visibility: every leg's kickoff known -> shown once the LAST leg kicked off (parlays too, even after a leg lost); any kickoff unknown -> shown only once graded settled. Not-counted bets of others are never sent. Open counts are sent (count only).
- Ranking: members meeting "fewest bets to place in a paid spot" first, then the metric, then Return %; still tied = same place and the places' money split evenly in cents (extra cent to the higher place). Only members meeting the minimum and with a settled bet are owed money.
- Money: main pot = entries of main-pot contests x members marked paid, commissioner's take off the top, then shared between main-pot contests (even / 50-50 / 40-60 / 60-40 / custom). Side pots: own entry, take, opt-ins, paid marks. Locks: each contest at its own start; money rules once anyone else joined or asked.
- Limits: a group's cap = min(its "most people" setting, maxPeople(creator)). Joins, approvals and requests are checked inside the conditional write, so a race fills one seat only.

### Routes added (POST JSON, `x-token`)
`/groups/invite` (PUBLIC, no token: `{type, code}` -> `{type, kind, title}` only; 40 per 10 min per IP + the wrong-code block), `/groups/limits`, `/groups/contest/add`, `/groups/contest/edit`, `/groups/contest/delete`, `/groups/sidepot`, `/groups/ent/contact`, `/groups/ent/admin` (owner: `x-token` + `x-dash`, no new header). `standings` / `player` take `cid`. `paid` takes `cid` for a side pot.

### Stats contract
`require('./groups').statsFor(userKey, {from, to})` -> one record per started picks contest the user is in: `{src:'groups', id:'<group>:<contest>', date (today while running, end day when final), sport (nfl/cfb/nba/mlb/nhl/ncaab, 'other' + extra.sports for All sports), kind:'contest', groupId, contestId, title, result (null running; W = 1st, else L when final), place {n, of}, pl, units, stake, verified (= no honor rule: every counted bet graded by the server), extra {record, metric, live?, owed?}}`. Checked against stats.js `validate` (stats-v1 branch) in the test. The stats manager must register it (`stats.register('groups', require('./groups').statsFor)`) in place of stats.js's built-in stage-1 groups adapter, which reads the old single-row format.

### Tests (all local; nothing live touched)
- `node odds-api/groups.test.js` — 50 checks (in-memory database with random delays, fake sign-in, fake ESPN for six leagues). Ran 20 times in a row: 20 of 20 passed.
- Each fix proven by MUTATION (scratch copies in /tmp/mut, not committed): undoing the fix makes the named test fail. 1 phone result trusted -> fails (server-graded totals); 1 honor rule off -> fails (fake Kalshi winner); 1 wording "Verified only" -> fails; 2 first-seen from the phone -> fails; 2 no freeze at kickoff -> fails ("frozen at kickoff"); 3 unknown kickoff visible -> fails; 3 Kalshi tickers not mapped -> fails; 4 kickoffs re-decided each pass -> fails (restart with ESPN games gone); 5 one try no back-off -> fails (12 simultaneous joins: Busy); 6 money never locks -> fails; 7 no paid-spot minimum -> fails; 8 serial reads -> fails (max 1 read at once); 8 sync.js query without lock filter -> fails; 9 float cents ($0.07 refused) -> fails; 9 parlay shown at first leg -> fails; 9 no relink on sign-in -> fails; 9 Groups in mirror mode -> fails; ties no split -> fails; ties no Return % -> fails. The old 8cb7074 code could not run the new tests unchanged (the API moved to contests), so mutation is the proof used.
- `alert.test.js`, `cfbd.test.js` still pass.
- Playwright (Chromium 430x900, real `pics/index.html` + groups.js / join.js / gate.js / dash.js, talking CROSS-ORIGIN to the real groups.js behind in-memory fakes with server.js's OPTIONS answer; harness in /tmp/gplay2, not committed). 24 screens captured and read: home, hub (commissioner: + Add a picks contest works, + Add a Calcutta / golf contest / local event = Coming soon), standings season / week / prizes, another member (parlay hidden until its last leg, count note), own bets (every result graded from scores although the phone said won +$999 on each; prop shows why it does not count), main pot, side pots, members with requests, a started group's requests (Remove only), hub not started, Invite people sheet (link `?join=g.<code>`, Copy / Text it), add contest steps 1-2 (side pot), hub with two contests, Contact Oddable form + sent, signed-out invite (`?join=` stripped from the address bar, kept in sessionStorage, gate banner "You're invited to join Valley Sharps"), after sign-in the join screen opens by itself, joined hub, owner dashboard Enterprise requests list + detail. Every screen: no sideways scroll (430), no tap target under 44 px, the overlay covers the My Bets banner, 0 page errors; Groups nav item absent in mirror mode.
- Fixed from that pass: a long group name broke mid-word beside its badges (now wraps whole words); a started group with late joining off offered Approve on requests that the server would refuse (now "Joining closed ... Remove request").
- Known look: names are cleaned by deleting characters (`<b>League</b>` shows as `bLeague/b`), same as stage 1; safe, not pretty.

### NOT verified
- Anything live (Supabase rows, `like` / `not.like` filters on the real PostgREST, real ESPN payloads per league, Kalshi ticker shapes beyond KXNFLGAME/SPREAD/TOTAL, real tokens, Render, CORS from a real phone; no new request header was added).
- ESPN college basketball `groups=50` and college football `groups=80` return only those divisions: games outside them are "Game not found" (not counted unless honor rule).
- Season end dates per sport are estimates (SEASON_END / PLAYOFF_END in groups.js).
- A member who never opens the app between placing a bet and kickoff: the bet is first seen when their phone syncs; if that sync lands after kickoff, it does not count (by design).

### New Render env var (optional)
`ENTERPRISE_MAX_PEOPLE` on calcutta-odds — most people per game for enterprise accounts. Default 500 if not set (clamped 8-5000).

### Open / for the owner
- Price of owner-granted extra seats (TBA).
- Weekly high-score prize payouts, head-to-head, bankroll, survivor: still "Coming soon".
- Calcutta / golf / local event contests: the hub shows "Coming soon"; their engines attach through `groups.attachGame(groupId, accountId, {type, ref, name, pot})` and `OddJoin.register('c'|'golf'|'e', handler)` + `groups.registerInvite(type, fn)` on the server.
