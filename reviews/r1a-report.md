# Oddable test preview: Reviewer A report (features, rules, security)

Reviewed: branch `preview` at 9c6d5c21ef4d6aa04071b8ffe55669ee79252143, cloned to /tmp/r1a. Read-only.
Date: Nov 16 2026.

## Read this first: the branch moved during the review

- The full review below was done on 9c6d5c2, the head when I cloned.
- While I was testing, someone else pushed a "Preview refresh 2" to the same branch (commits 02:14 to 02:22). `preview` is now 4dd2dbb. It merges newer Groups (v254), Golf v1.1, Local events v1.2 and Calcutta round 3.
- I re-ran my attack scripts, the HTTP checks and every test suite (5 runs) on 4dd2dbb, cloned to /tmp/r1a2. The section "Status on 4dd2dbb" right below says what is fixed and what still stands. Where it says "not re-checked", the 9c6d5c2 finding is the last word I have.
- The verdict is the same on both heads.

## Verdict: DO NOT SHIP the merged build to the live app

## Status on 4dd2dbb (the newer head)

### Still open

- **Critical 1, made-up bets: still open.** Group bets now go through a new add-bet route, and it accepts any line. Lefty Lou (last place) adds DAL +60.5 for $1,000 at -110 before kickoff: accepted "Saved to your group. Locked." After the game he is 1st, +$841.50, owed $54. The opposite side on the same game is now refused as a hedge, and the commissioner can cap the longest odds, but nothing checks the line.
- **High 7, invites: still open.** Signed-out Calcutta, golf and event links still say "This kind of game is coming soon to Oddable." Only groups register with the server router.
- **High 8, tests: worse.** Three suites now fail on every one of 5 runs:
  - stats.test.js: same failure at check 5; 19 of 23 groups of checks never run.
  - golf.test.js: stops at the Suggest partners check (line 232 in four runs, line 218 in one, so it also varies).
  - events.owner.test.js: 2 of 13 fail, both Suggest partners.
  - The other 11 suites pass 5 of 5 (alert, calcutta x3, cfbd, events x2, groups x3, pairing).
- **Medium 10, Calcutta hand results on a pro event with no notice: still open.** It now asks the commissioner to confirm first.
- **Medium 11, Calcutta ties not split: still open.**
- **Medium 13, attached Calcutta cannot be joined; Main Calcutta not in the group pot: still open.**
- **Medium 14, organizer reopens a final round and rewrites a confirmed hole: still open.** Marking it final with unconfirmed holes is now refused.
- **High 3, golf side games after final: half fixed.** A press after the round is refused. A scorer can still make himself closest-to-the-pin winner after the round is final (it now shows as "entered", waiting for a confirm).
- **Medium 16, typed rounds move the handicap (12.4 to 51): still open.**
- **Medium 17, record money: partly fixed.** The event record now carries its $10 entry. The group contest shows entry $25 but payout $89.10 (entry plus bet winnings), not the $9 prize. The Nassau row shows entry $20 with net minus $40.
- **Medium 18, Enterprise: partly fixed.** Calcutta now gives the director 500. A course's consenting players still never reach the director. Usage for billing is still recorded only by group contests.
- **Medium 19, 20, 21 and Low 22, 23, 25, 28 (preview guards, Kalshi path, memory fallback, golf attach, claim link, Anthropic key, dropped invite): unchanged.** 20, 22 and 28 re-run; the rest confirmed in the code.

### New on 4dd2dbb

- **Adding a group bet after kickoff answers "Saved to your group. Locked."** The bet is then shown as not counted ("Synced after the game started"). The player is told the wrong thing. Medium, groups.
- **G16 has no commissioner void.** The lock message promises one "under the void rules", but there is no void route. Medium, groups.
- **Suggest partners in Groups ignores handicaps.** /groups/partners answers "No handicaps or ratings yet, so every split is even on paper" for the demo group, whose members all have an Oddable index. Golf's own Suggest partners uses them and works in all three modes. Medium, groups.
- **Two tournament-handicap logs.** The golf engine now logs a director's change (who, old, new, Oddable number, reason). The stats "Set by tournament" card is still empty and /stats/event/log still answers 404. Medium, stats with golf.
- Golf no longer strips quotes from names on the server. Every client escape helper covers quotes and I found no script running, so this is a note, not a defect.

### Fixed between the two heads (re-tested)

- G16 lock on entry: built. A bet added to a group cannot be edited, deleted or swapped; an edited copy pushed through the phone's sync is ignored and graded as first added.
- H1 in golf: a joiner now gets the Oddable index (Ray 12.4, Bea 7.9 even though she declared 54); setting your own number is refused; the demo tournament is prefilled for everyone.
- E-H in golf: the director sets Lefty Lou to 8.5 with a reason; the engine uses 8.5 "tournament"; the log keeps Oddable 14.7; a player and the commissioner are refused; the lifetime index stays 14.7.
- My stats double count: gone. Ray's lifetime P/L is minus $472.15 and equals its rows. Golf total equals its rows. Nassau counts front, back and total (minus $40).
- /stats/member: the commissioner can open a member's group stats; a non-member still gets 404.
- Calcutta: a result during a live auction needs an explicit confirm that names the unsold count (Medium 12 closed). Enterprise cap is 500.
- Golf: press after the round refused; final with unconfirmed holes refused.
- The two preview stand-in routes (/preview/hcp, /preview/pairing) are gone.

### Decision audit on 4dd2dbb (partly re-tested)

Built and working 55. Built but broken 10. Stand-in 6. Missing 1. Not provable here 6.
- Broken: bets nobody can fake; G16 void; signed-out invites; usage count; Calcutta payouts (ties, silent results); closest to the pin after final; course consent view; money on records; Suggest partners in Groups; "Set by tournament" in stats.
- Stand-in: Calcutta, golf and events inside a group; one shared limits helper (not re-checked); Main or Side; golf and team lots (not re-checked); golfer Calcutta and bets v group; team Calcutta.
- Missing: net / gross flights.

---

# Full review at 9c6d5c2

One exception: the weekly picks work (v252 + v253) had no defect in this review and can ship on its own once someone checks it against real ESPN (this machine cannot reach ESPN).

Why not the rest:
- A group contest can be won with made-up bets (Critical 1).
- Your G16 rule (a group bet locks when added) is not built.
- Golf side-game winners and presses can be changed after the round is final.
- Your H1 rule is not in the golf engine: players who join a golf day play off 0, or type their own number.
- My stats counts every group bet twice.
- Many decisions run on stand-ins that only the preview wires together.

## How this was tested

- Preview server run locally from the clone with PREVIEW=1 on port 10111, with a guard that logged and refused every outbound call except localhost.
- Attack and money tests ran two ways: HTTP against that server, and an in-process copy of the same seeded preview where the clock can be moved (needed to get past kickoffs and finals). Scripts are in /tmp/r1a-tools (t1.js to t17.js, pw/*.js).
- Browser checks with Playwright at 430x900.
- Nothing was pushed. No live write. No Odds API credit. No call to steves-pics, calcutta-odds or Supabase.

Not provable on this machine:
- Picks on screen: ESPN is unreachable from here, so the local preview shows no weeks. Picks rest on alert.test.js (fake ESPN) plus the route checks below.
- Pro golf pools and the ESPN golf feed, OpenGolfAPI course search, voice scoring (no key in the preview), the owner dashboard (the preview has no owner).

## Defects, ranked

### Critical

**1. A group contest can be won with made-up bets.** Owner: groups.
The server grades the result from the final score, but the line, the price and the stake are whatever the player typed. Nothing is checked against a real market.
Repro: in the demo group, Lefty Lou (last place, minus $100) logs two bets on next Sunday's PHI at DAL before kickoff: DAL +60.5 and PHI +60.5, each $100,000 at +99999. Both win. After the game he is 1st with +$199,997,932 and is shown as owed the $54 first prize. Script t2.js.
Only a "Kalshi-synced bets only" contest is safe. A per-bet cap limits the stake but not the line or the price.

### High

**2. G16 is not built: a group bet can be changed after it is added.** Owner: groups.
Repro: RGV Ray's bet "DAL ML $30" on next Sunday's game is edited on the phone to "PHI ML $999" before kickoff. The group now shows PHI ML $999 and grades it as a $1,498.50 win. There is no "add bet" route, no "Not saved, try again", and no commissioner void with a reason. Deleting a bet on the phone does leave it in the group. Script t2.js.

**3. Golf: side-game winners and presses can be changed after the round is final.** Owner: golf.
Repro on the finished demo day "Saturday Best Ball":
- Scorer RGV Ray posts /golf/extra and makes himself closest-to-the-pin winner. Accepted (200).
- Team 2's scorer adds a Nassau press "from hole 12" after the round is final, already knowing the back nine. Accepted (200) and scored as a won press.
Neither route checks the round's status, and a press is not checked against holes already played. Script t10.js.

**4. H1 is not in the golf engine.** Owner: golf (with stats).
- A player who joins a golf day gets handicap 0, not their Oddable index. Ray (index 12.4) joins a new day: the game uses 0. Only the organizer's number is prefilled.
- Any player can set their own number before the start: Ray set 36, Birdie Bea joined declaring 54. Both accepted.
- In the demo "Member-Guest Scramble" the real golf engine has Coach Mo, Lefty Lou, Birdie Bea, Dinker Dee, Ace Abe and Tex Tina all at 0, while the Tournament handicaps test screen says they "play off the Oddable number" (9.0, 14.7, 7.9 and so on). The screen and the engine disagree. Scripts t10.js and the live HTTP check.

**5. My stats counts every group bet twice.** Owner: stats (with groups).
Ray's lifetime P/L shows minus $391.80. His 7 group bets (+$64.10) are counted once as bets and again as the contest. The real figure is minus $455.90. The NFL total shows $870 risked where $690 is right. groups.statsFor does not mark its record as built from My Bets. Seen in /stats/me and on the My stats screen. Script t9.js.

**6. Golf money does not add up.** Owner: golf (with stats).
- The golf board shows no dollar totals at all, only "$5 a skin" and "$20 a match (info)".
- Nassau: the app's own help says three bets (front, back, total). Team 1 halved the front and lost the back and the total. Stats shows minus $20 (total only). Presses never reach the money.
- Skins: stats pays "skins won x $5" (Ray +$10) with nobody paying in, while golf's own pot summary calls the same $5 "per entrant". Three skins carried past 18 are left unsettled.
- The $20 entry never resolves: place 2 of 2, entry $20, payout blank.
- The golf total (minus $10) does not equal its own rows (minus $20, plus $10, plus $10). Script t8.js, t9.js.

**7. Invite links for Calcutta, golf and events tell a new person "This kind of game is coming soon to Oddable."** Owner: groups (join router) with calcutta, golf, events.
Repro: open /?join=c.<code>, /?join=golf.<code> or /?join=e.<code> signed out. Only group links show "You're invited to join ...". The server router /groups/invite knows only the group kind (404 for c, golf, e). Signed-in links do land on the right join screen. Script pw/join.js, t15.js.

**8. The stats test suite does not run in the merged build.** Owner: stats.
stats.test.js fails 5 of 5 runs at the fifth check ("missing providers": it expects no Calcutta engine). 19 of its 23 groups of checks never run, including the handicap maths, privacy sweep, S-ALL, G16 and E-H checks. On the stats branch alone it passes all 23.

**9. The shared contracts are wired only by preview-only code.** Owner: preview / manager.
odds-api/preview-glue.js is what connects limits, the handicap, the rating and the groups stats provider. It is a preview-only file. Without it golf uses its own cap stand-in and a handicap hook that always answers "none", and events use their own Enterprise stand-in.

### Medium

**10. Calcutta: the commissioner can type any result for a pro event, with no notice to members.** Owner: calcutta.
Repro: in the NFL Playoff Calcutta, in November, Coach Mo posts /calcutta/result making his own Chiefs lot champion with 4 wins. The board shows him winning $918, "over", and members get no notice (history only). Results can also be flipped later with no notice. Script t5.js, t6.js.

**11. Calcutta: a tie for a paid place is not split.** Owner: calcutta.
Two teams entered as 1st: the first by id gets the whole $107.03, the other $0, and the 2nd-place $64.22 stays unpaid. Script t6.js.

**12. Calcutta: one result typed during a live auction closes the auction for good.** Owner: calcutta.
Posting a result closed the Side Calcutta with 5 of 7 lots unsold. Clearing the result does not reopen it. Script t6.js.

**13. Calcutta attached to a group cannot be joined, and a "Main" Calcutta is not in the group's main pot.** Owner: calcutta with groups.
Joining the demo Side Calcutta by code answers "Join this Calcutta from its group", and the group has no Calcutta screen ("Calcuttas are coming soon"). The group's main pot lists only the picks contest.

**14. Golf: the organizer can reopen a final round and overwrite a confirmed hole on his own team.** Owner: golf.
Coach Mo reopened the day, changed hole 18 for Team 1, and marked it final again with that hole unconfirmed. The winner flipped (125 v 130 became 122 v 125). It is in the audit trail only. Script t10.js.

**15. A group member cannot see another member's group stats.** Owner: stats with groups.
/stats/member answers 404 "Group not found" for the commissioner looking at a member of his own group (groups.js does not export memberStats).

**16. Typed rounds move the handicap with no check.** Owner: stats.
Ray posted 20 made-up rounds in one day and his index went from 12.4 to 51. This follows H1 as written ("every round logged counts"), but that number is meant to drive strokes in money games. There is no "confirmed" marker and no cap. Script t12.js.

**17. Stats records are missing money.** Owner: stats with events and groups.
- A finished pickleball event with a $10 entry shows "1st of 6" with no entry, payout or net, and no win.
- A group contest shows the sum of bet stakes ($180) as its "entry", not the $25 entry, and leaves out the $9 owed.

**18. Enterprise is set in four separate places and they disagree.** Owner: limits (groups) with calcutta, golf, stats.
- The Enterprise director gets 500 in groups and golf but still 8 in Calcutta.
- A course's consenting players never reach the director: the consent prompt reads one store (stats, lock:entcourses) and the director's course list reads another (golf, lock:ent). After Ray consented, the director's list stayed empty. Script t13.js.
- Monthly usage for billing is recorded only for group picks contests. The director's 10-golfer tournament is not counted.
- golf.js and limits.js both write the row lock:ent with different shapes.

**19. Preview: anyone can sign in as any tester, and anyone can wipe the test copy.** Owner: preview.
- The preview signs tokens with a fixed key that is in the source. Knowing only a tester's cell number, a forged token read that tester's stats (200). Proven.
- POST /preview/reseed needs no sign-in and erased everything.
This is preview-only, but testers may type a real cell number and PIN.

**20. Preview: the "no real Kalshi orders" block can be stepped around.** Owner: preview.
/kalshi/order answers 403, but /kalshi/./order and /kalshi/x/../order reach the real order code ("only sell orders are allowed"). It still needs the tester's own Kalshi key and a hand-built request; a browser cannot send that path.

**21. sync.js now runs in memory whenever SUPABASE_URL is missing, even without PREVIEW.** Owner: preview.
A normal boot with no database answers /sync/status "configured: true" and would keep accounts in memory. This edit must not reach main.

### Low

22. Golf: /golf/attach accepts any group id, with no check the organizer is in that group. Owner: golf.
23. Guest claim links from the preview point at https://steves-pics.onrender.com (hard-coded in stats.js). Owner: stats.
24. Preview demo clock: next Sunday's demo games never go final until the service restarts. Owner: preview.
25. ANTHROPIC_API_KEY is not on the preview's scrub list; if it is ever set there, any tester can spend it through voice scoring. Owner: preview.
26. Naming: the golf solo-round screen says "unofficial Oddable handicap (not an official USGA/GHIN index)"; stats says "Oddable Handicap Index". "Double lock" labels remain in the Results history code. Owner: golf, picks.
27. A member not marked paid is still shown as owed a prize (Coach Mo, $27). Owner: groups.
28. Preview: a signed-out invite link lands on the demo-person picker and the invite is dropped once a person is chosen. Owner: preview.
29. Play hub says "Demo: Saturday scramble"; the demo is "Saturday Best Ball". Owner: preview.
30. /golf/board answers 503 "Could not read the leaderboard" for a golf day; a bid sent as [50] is accepted as 50. Owner: golf, calcutta.
31. The preview page reads lines.json from the live repo's public GitHub branch (read-only). Owner: preview.

## Attack testing: what held

- Demo switcher: /preview/as, /preview/status, /preview/reseed, /preview/hcp, /preview/pairing and the static site all answer 404 on a boot without PREVIEW=1. A preview-key token is refused there (401). ?as=owner does nothing.
- Live secrets: booted the preview with fake SUPABASE, ODDS_API, MYAPPS, OWNER_PIN, OWNER_PHONE, CFBD and ODDS_UPSTREAM values set. No call went to any of them. /odds and /games answer "not set". The only outbound calls the server tried were ESPN, plus Anthropic and OpenGolfAPI when asked. The browser tried only ESPN and the GitHub lines file.
- Reading other people's data: non-members get 404 on every group, Calcutta, golf and event read. Other members' bets stay hidden until kickoff. /stats/me ignores a foreign key. /stats/owner, enterprise admin routes and course admin are refused.
- Acting as commissioner or director: every commissioner route in groups, Calcutta, golf and events refused a player (403). A player and the commissioner were both refused on the tournament handicap screen.
- 8-person cap: held in groups, Calcutta, golf and events, including bursts of joins at the same moment, approvals at the cap, typed guests and spectators.
- After the start: group rules and money rules, Calcutta rules after the first bid, Calcutta ownership, buy-backs and players of record after a result, event rules and entries were all locked.
- Bids: negative, zero, fractions, text, over $100,000, self-raise, under-bid, sold lot and after-the-bell were all refused.
- Pickleball scores: wrong targets, win-by-2, own-side confirm, outsiders and changes after the finish were all refused.
- Injection: HTML and quotes were stripped by the server in every free-text field of every engine (one sweep of all responses found none). Voice text could not be tested.

## Money maths

- Groups: pot $100 (4 paid x $25), take $10, pool $90, prizes $54 / $27 / $9. Adds up. Bet grading checked by hand for one player ($165.18).
- Calcutta: pot $1,700, take $170, pool $1,530; rows $596.70 + $397.80 + $535.50. Custom Calcutta with odd percentages and a $3.33 take: rows equal the pool ($192.67), owners' winnings equal paid out, nets equal minus the take, buy-back split $53.52 / $53.51 with the odd cent to the winning bidder.
- Events: $21 pot, 15% take $3.15, pool $17.85, places $10.72 / $5.35 / $1.78. Adds up.
- Golf: does not add up (High 6).
- Stats totals: do not add up (High 5, Medium 17).
- Wording: nothing found that says Oddable holds, collects or pays money.

## Test suites, 5 runs each

- alert.test.js: 5 of 5 pass.
- calcutta.test.js (25 checks): 5 of 5.
- calcutta.review.test.js (26): 5 of 5.
- cfbd.test.js: 5 of 5.
- events.test.js (25): 5 of 5.
- events.fix.test.js (13): 5 of 5.
- golf.test.js (51): 5 of 5.
- groups.test.js (50): 5 of 5, plus 12 more runs with no failure. The "1 in 5" flake in HANDOFF did not show in 17 runs.
- stats.test.js: 0 of 5. Same failure every time (High 8).
No test reached the network.

## Stand-ins still in use

- limits: Calcutta has its own in-memory cap. Golf and events have their own, swapped for limits.js only by preview-glue.js.
- OddJoin: the client router is real, but the server router knows only groups.
- VoiceLog: merged, cannot answer in the preview (no key).
- statsFor providers: all six are on. The groups provider is swapped in by preview-glue.js; stats.js still carries the older one.
- Pairing (P1): /preview/pairing with made-up history. Not in any golf or pickleball setup screen.
- handicapFor / ratingFor (H1, E-H): the real ones in stats.js are not called by golf or events. /preview/hcp is a test screen with its own log, keyed on the demo role. /stats/event/log answers 404.
- Calcutta sources: golf and team lots are "coming soon". Calcutta, golf and local events inside a group are "Coming soon".

## Where two components disagree

- Tournament handicap screen v golf engine: different numbers for the same players.
- Stats v groups: group bets counted twice; /stats/member has no partner in groups.
- Stats v golf: Nassau and skins money; what "$5 skins" means; the handicap name.
- Stats v golf: where a course's owner is stored.
- limits v Calcutta: Enterprise cap.
- limits v golf: the same database row with two shapes.
- Calcutta v groups: "Main" pot flag; joining an attached Calcutta.
- Server invite router v the three other engines.
- HANDOFF says the member-guest handicaps are "prefilled from the Oddable index"; only the organizer's is.
- HANDOFF says stats.test.js fails only in its group sections; it stops at check 5.

## Decision audit (78 items)

Counts: Built and working 45. Built but broken 13. Stand-in or in progress 11. Missing 3. Built but not provable on this machine 6.

### Picks
- D2 server is the only source: working (POST /alert refused 410; fix and run are owner-only).
- D5 / D9 one-hour freeze at each pick's own game: working (suite; server reports 60 minutes).
- D6 parlays: working (suite).
- D7 actual prices: working (suite; no -110 on the board).
- D8 Move the line: not provable here (needs picks on screen).
- Own model kept, Double lock retired: working; old label still in history code.

### Groups
- Graded by Oddable from final scores, nobody can fake: BROKEN (Critical 1).
- Honor system off by default: working.
- "Verified only" renamed: working ("Kalshi-synced bets only").
- Bets first seen after kickoff never count: working.
- Frozen at kickoff: working.
- Others' bets hidden until kickoff: working.
- Kickoffs stored: working.
- All rules lock at start: working.
- Money rules lock once anyone joins: working.
- Take none / percent / flat, shown before joining: working.
- Ties split in cents: working.
- Minimum bets to place: working.
- Open-bet counts: working.
- Six sports: working (soccer not offered).
- Several picks contests, main and side pots, opt in: working.
- Calcutta, golf and events inside a group: stand-in.
- Money never held: working.

### G16
- Lock on entry: MISSING.

### Invites
- Invite people on every game: BROKEN for signed-out Calcutta, golf and event links.

### Limits and pricing
- 8 people, server-enforced: working in all four engines.
- Owner extra seats: not provable (owner only).
- Enterprise flag lifts the cap: BROKEN (not in Calcutta).
- Shared price text: working.
- Contact form saved for the owner: working on the server; owner screen not provable.
- Monthly usage count: BROKEN (group contests only).
- One shared limits helper: stand-in.

### Calcutta
- Commissioner builds it (event, lots, field, payout 100%, lowest bid, timer): working.
- Buy back half: working, local events only.
- Main or Side: stand-in.
- Take: working.
- Rules lock at first bid: working.
- Live auction on the server clock, or enter results: working.
- Payouts from final scores: BROKEN (ties, silent hand results); feed not reachable here.
- Golf and team lots: stand-in.

### Golf
- Pick six, one and done: not provable (feed).
- Golfer Calcutta, bets v group: stand-in.
- ESPN golf feed: not verified.
- All 12 formats: working.
- Heads-up match play: working.
- Net / gross flights: MISSING.
- Team Calcutta: stand-in.
- Skins, closest to the pin, longest drive: BROKEN (High 3, High 6).
- Scorer enters, other team confirms: working.
- With or without a group, one-player rounds: working.
- OpenGolfAPI course data: not provable (typed course works).
- Courses see consenting players: BROKEN (Medium 18).

### Pickleball and local events
- Formats: working.
- Pickleball rules: working.
- Scorer and opponent confirm: working.
- With or without a group: working standalone.
- Sport catalog: working.

### Stats
- Lifetime results by sport and game: BROKEN (double count).
- Guests and claim links: working.
- Individual stats, one-player games, self-logging: working.
- Handicap (WHS) and rating: working. Rounds 3 to 21 matched the WHS table exactly.
- My handicap data: working.
- Voice Log my score: not provable.
- statsFor contract: working, six sources on.
- Privacy: BROKEN on the group-member view; private by default works.

### S-ALL
- Every play in the dashboard: working.
- Entry, payout, net on each record: BROKEN.
- Totals that drill down: BROKEN.

### P1
- Suggest partners: stand-in.

### H1
- Every round counts: working.
- The handicap everywhere: BROKEN (High 4).
- Name and WHS line: working in stats.

### E-H
- Director adds or changes: stand-in.
- That tournament only: stand-in (lifetime index stayed 14.9).
- Logged, "Set by tournament": stand-in (stats card empty).
- Locked at start: stand-in.
- Pickleball the same way: MISSING.
- Addendum, both numbers shown: BROKEN (the engine uses a third number, 0).

## End state

At the end of the review:
- `git -C /home/claude/calcutta-preview rev-parse preview` = 3b78d58a10049f6a92e856c0e910f58d8da6ee63 at 02:29 (9c6d5c2 when I cloned, 4dd2dbb when I re-tested). 3b78d58 was not reviewed.
- `git -C /home/claude/calcutta-preview status --porcelain` at 02:29: modified odds-api/golf-courses.js, odds-api/golf.js, odds-api/preview.js, odds-api/stats-courses.js, odds-api/stats.js, pics/golf.js, pics/stats.js; untracked odds-api/fixtures/courses-fallback.json. (At 02:24 it was odds-api/golf.js and odds-api/preview-glue.js.) Someone is editing that folder live.
- I did not make those changes. I wrote only under /tmp (/tmp/r1a, /tmp/r1a2, /tmp/r1a-stats, /tmp/r1a-tools, this report). The new commits and the two edited files come from whoever ran the preview refresh while I was reviewing. Two things follow: the uncommitted edits were not reviewed at all, and the read-only rule cannot be confirmed from the porcelain output alone.
