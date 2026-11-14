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
- Bump the version on every change: `v###` in 3 places in `pics/index.html` plus `C='pics-v###'` in `pics/sw.js`, so phones pick up the update.
- Local check: serve `pics/` with `python3 -m http.server`, set `localStorage['pics-lg']='cfb'`, open `index.html?mirror=1`. ESPN must be mocked if outbound access is blocked.

## Change log
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
