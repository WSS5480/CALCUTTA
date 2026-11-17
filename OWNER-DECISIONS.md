# Owner decisions — Oddable, Nov 15–16 2026 (Steve, owner)
Every coder/reviewer reads this and records the decisions that apply in HANDOFF.md (date + reason).

## Picks (v252/v253)
- D2: server/database is the ONLY source of weekly picks; every device shows the same; nothing decided on the phone.
- D5/D9: Lock, Helper, each division road dog and each parlay leg are LIVE recommendations until 1 HOUR before THEIR OWN game, then frozen and graded at that line and price. A game past its mark can never become the Lock. Screen text: "Live pick: can change until 1 hour before kickoff. Bet early at your own risk."
- D6: 2-game parlay = Lock + top picked (53%+) division road dog; 3-game = Lock + top two road dogs (legs under 53% labelled "not an Alert pick").
- D7: actual prices only — never assume -110; missing price = no payout shown.
- D8: "Move the line?" advice per pick/leg, from 2014-2025 data; never show a fake book price; compare with your book.
- Keep Oddable's own model; the original Calcutta model is not merged. Double lock retired.

## Groups (G1–G15)
- Real bets graded by Oddable from final scores (not the phone). Bets the app can't check count only if the commissioner enables "honor system" (default off). Rename "Verified only" honestly.
- Bets first seen by the server after kickoff never count; side/line/odds/stake frozen at kickoff; other members' bets hidden until kickoff (server-enforced); kickoffs stored, never re-decided from the day.
- All rules lock at start; money rules (entry, take, split, cap, metric) lock once anyone else has joined.
- Commissioner's take: none / % of pot (0-50) / flat; shown before joining; prize pool = pot minus take.
- Ties for a paid place: Return %, then split prize evenly in cents. Min bets to place in a paid spot (10 season, 3 weekend). Open-bet counts visible (count only).
- All sports: NFL, college football, NBA, MLB, NHL, college basketball (plus soccer etc. where the app tracks them).
- A group holds several CONTESTS (picks contests, Calcuttas, golf, local events), each in the MAIN pot or its own SIDE pot; members opt in to side pots; commissioner sets the main-pot split. Members can be in many groups.
- Money is never collected, held or paid by Oddable.

## Invites
- Every group/contest/Calcutta/golf/event has "Invite people" (share sheet, copy, text). Link: https://steves-pics.onrender.com/?join=<g|c|golf|e>.<code>. New people sign up for Oddable from the link and land on that game's join screen; commissioner approval still applies. Router: pics/join.js (`window.OddJoin.register/share`), owned by the Groups coder.

## Limits and pricing
- Standard accounts: every group and every game tops out at 8 PEOPLE, commissioner included (server-enforced). Owner can grant extra seats per group (pricing TBA).
- Enterprise (courses, clubs, leagues): owner-set `enterprise` flag on the account lifts the cap. Price: $500/month + $20 per player per game. Shared text: "Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us." Contact form -> owner dashboard "Enterprise requests". Count games and players per enterprise account per month for billing. No payment flow.
- Shared helper `limits.maxPeople(accountKey, groupOrGameId)` (Groups coder owns; others use a stand-in with the same signature).

## Calcutta
- The commissioner builds and runs it: event, lots ("the field" bundles), payout table (= 100%), lowest bid, timer, buy-back-half (exact rule to confirm with owner — implement as an option and flag), Main or Side Calcutta, take; rules lock at the first bid; live auction (server clock, polling) or "enter results"; payouts from final scores; any number of Calcuttas per group, any sport.

## Golf
- Pro: pick six tiers (best four), golfer Calcutta, one and done, bets vs group; ESPN golf feed (verify).
- Golf day: every format (4- and 2-person scramble, Texas, Florida/step-aside, shamble, best ball, alternate shot, Chapman, stroke play, Stableford, Nassau, skins), heads-up match play, net/gross flights, team Calcutta, skins/CTP/LD, scorer enters + other team confirms.
- Works with or without a group: pick your course as a team, invite people, or build in a group. One-player rounds count.
- Course data: free OpenGolfAPI (https://api.opengolfapi.org/v1/... ; spec at /openapi.json and /llms.txt; npm @opengolfapi/mcp-server; no key needed; optional env OPENGOLFAPI_KEY). Show courses, tees, yardage, par, rating, slope, hole-by-hole. Attribute "Course data: OpenGolfAPI contributors (ODbL)"; store only selected courses.
- Golf COURSES (enterprise) can see handicaps/rounds of players who CONSENT; flights by handicap; pre-filled course handicaps; owner links an enterprise account to its course(s).

## Pickleball / local events
- Round robin + playoff, single/double elimination, ladder, heads-up, bracket pick'em; pickleball rules (11/15/21 win by 2, singles/doubles/mixed, seeding by rating or random, byes, tiebreaks); scorer + opponent confirm; with or without a group; sport catalog "Start a game" with how-it-works for every sport.

## Stats
- Everyone keeps lifetime results by sport and game (incl. guests added by name, who claim history via an unguessable link when they sign up). Individual stats inside team games. One-player games count. Self-logging ("Log my play").
- Oddable handicap (unofficial, WHS method, verified against USGA sources) and Oddable rating (Elo) for pickleball — never called official GHIN/DUPR.
- Personal "My handicap" page: current, trend, last 20 rounds (counting 8 marked), Post a round, course handicap calculator, round drill-down.
- Voice "🎤 Log my score": speech -> Claude (existing ai.js Anthropic path + env var) -> confirmation card -> Save through the normal entry route.
- Stats contract: each engine exports statsFor(userKey,{from,to}) -> normalized records (see HANDOFF "Player stats (v1)").
- Privacy: lifetime stats private unless shared; group members see group results only.

## Process
- Never push, merge to main or deploy; the manager ships after an independent review. No live data writes. Tests + Playwright at 430x900. Owner UI rules in HANDOFF. HANDOFF updated in every commit.

## G16 — Group bets lock on entry (Steve, Nov 16 2026 1:20am CT)
"If it is a group play once they add their bet. Always upload. That's locked."
- In any group contest, a bet saves to the server the moment the player adds it. It is never kept only on the phone.
- Once added, it is locked: the player can't edit, delete or swap it, even before kickoff. Only the server stamp counts.
- If the upload fails, the bet is NOT placed. Show "Not saved, try again". No local-only bets in groups.
- Commissioner may void a bet only through the existing void rules (for example a postponed game), with the reason logged and visible to members.

## S-ALL — Every play lands in the player's personal dashboard (Steve, Nov 16 2026 1:23am CT)
"Every play has the data of every pay personal or tournament in there personal dashboard"
- Every play a player is in shows in their own personal dashboard: solo or self-logged, group contests, Calcutta, golf (round, pool, golf day, heads-up), pickleball and local events, and tournaments.
- Each record shows what they played, the result and the money: entry, winnings or payout, net. Money is display only; Oddable never collects or pays.
- Every component must register its records with statsFor(userKey). A play that doesn't show in the dashboard is a bug.
- The dashboard has totals by sport and by game type, and each total drills down to the plays behind it, with a back button.

## P1 — Partner suggestions in group play (Steve, Nov 16 2026 1:24am CT)
"Recommendations on the group play to choose the next partner"
- In any team format (golf scrambles, four-ball, golf day pairings, pickleball doubles, other team events), add a "Suggest partners" step for the commissioner or player.
- It shows ranked suggestions with a one-line reason. It only suggests; people choose.
  1. Balanced (default): team handicaps or ratings as close as possible, so matches are fair.
  2. Rotate: pairs who haven't played together lately.
  3. Hot pairs: best record together, from lifetime stats.
- It uses each player's app handicap (golf) or Oddable rating (pickleball) and lifetime stats.

## H1 — App play is the real handicap (Steve, Nov 16 2026 1:24am CT)
"Keep app play as a real handicap"
- Every round played or logged in the app (solo, group, golf day, Calcutta golf) counts toward the player's handicap, calculated by the WHS method.
- That handicap is THE handicap everywhere in the app: strokes, net scores, flights, pairings and partner suggestions.
- Naming: "Oddable Handicap Index". It still can't be called a USGA or GHIN Handicap Index (that requires a licensed club), so add one small line: "Calculated with the World Handicap System method." Pickleball works the same with the Oddable rating.

## E-H — Enterprise tournaments can add and change handicaps (Steve, Nov 16 2026 1:25am CT)
"Allow enterprise tournament to add the handy caps if not on audible and can change."
- In an Enterprise tournament (course, club or league), the tournament director can enter a handicap for a player who has no Oddable handicap yet: a guest, a new player, or someone with no rounds in the app.
- The director can also change any player's handicap for that tournament, including one that came from the Oddable index.
- The change applies only to that tournament. The player's lifetime Oddable Handicap Index is not changed by a director's edit.
- Every add or change is logged (who, when, old value, new value, reason) and shows as "Set by tournament" next to that player.
- Handicaps can be changed until the tournament starts (first tee time or lockAt); after that they are locked like everything else.
- Pickleball and other Enterprise events work the same way with the Oddable rating.
- E-H addendum (Steve, 1:26am): "But Oddable is there as real results." The Oddable Handicap Index or rating, built from real app results, always stays visible next to a tournament-set number, e.g. "Oddable 12.4 (real results) · Tournament 10.0, set by director". Members, the director and the player all see both. A director override never hides or replaces the real-results number anywhere.

## R1 — Complete review once the preview is up (Steve, Nov 16 2026 1:35am CT)
"Once up I want a complete review."
- As soon as the test preview is live, run a complete independent review of the whole thing: every screen on phone and desktop, every feature against every decision in this file, the code, the tests, security (fake prices, locks, freezes), and the look. Reviewers are read-only. Steve gets the full report.

## PB-1 — Pickleball belongs in Groups, by link (Steve, Nov 16 2026 3:03pm CT)
"pickle ball is in the oddable app not the group link i asked for"
- The standalone 🏓 Pickleball button/page that another session shipped to the live app (its "v253", pics/pickleball.html, points only, phone-only storage) is NOT what he asked for.
- What he asked for: pickleball (and local events) as a group game, set up by a commissioner, joined by invite/sign-up link, with stats, ratings and the rest (the local-v1 build).
- v255 plan: the group/link pickleball replaces the standalone page; any games people logged on the standalone page are offered an import, not lost. Until then, ask Steve whether to hide the standalone button.
