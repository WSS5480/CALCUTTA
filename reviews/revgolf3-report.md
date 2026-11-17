# Golf v1.2 review, round 3

Repo: /home/claude/calcutta-golf, branch golf-v1, commit 2fa88eb (on top of 544803e).
Reviewer: independent, read-only. Work was done in a clone at /tmp/revgolf3/repo.
Date: Nov 16 2026.

## Verdict for a LIVE deploy: SHIP AFTER FIXES

The scoring maths and the money maths are right. Every cent adds up.
Every defect from review round 2 is fixed as written.
But the main promise of this round ("nobody can win a pot alone") still has holes.
A playing organizer can still take the pot alone, three different ways (H1, H2, H3).
A player can still build a "confirmed" handicap alone (H4).
Fix the five High items before real money games go live. The Mediums can follow in the same pass.

No Critical defects. No data leak found. No page errors.

---

## HIGH

### H1. A playing organizer rewrites an opponent's card alone (dispute, then settle)
The rule only stops him on his OWN team. Nothing stops him on the other team.
Repro (script /tmp/revgolf3/t/a1.js, case A1):
1. Ann organizes and plays Team 1. Bob is Team 2, Cat is Team 3. $10 entry, all paid.
2. All 54 holes entered and confirmed. Bob leads (net 73), Ann is second (91).
3. Ann: `dispute` Team 2 hole 4. Answer 200. (Any confirmed hole can be disputed.)
4. Ann: `resolve` Team 2 hole 4 with 15 strokes. Answer 200, status "confirmed", "Ann (organizer)".
5. Repeat on 7 more holes. `final` answers 200. Ann is 1st and gets the whole $30.
Nobody else tapped anything. Bob only finds out from the history.
A co-organizer who plays on a rival team can do the same (case A2b: 6 holes, 200 each).
Fix:
- The person who raised a dispute never settles it.
- A settlement is final only when the settler is on no team in this game. If the settler plays (organizer or co-organizer), store it as "entered" and require that team's own scorer, or an outsider from a third team, to confirm.
- Do not let a confirmed hole be disputed by a rival without a note, and tell the team's scorer (notice).

### H2. Organizer plus a co-organizer from his own team rewrite an opponent's card
Repro (a1.js, case A2), best ball, Team 1 = Ann + Bob, Team 2 = Cat + Dan:
1. Ann names her partner Bob co-organizer (`team` op `co`). 200.
2. All holes confirmed. Team 2 leads.
3. Ann `score` on Team 2 holes 1 to 6 with 15s. 200 (organizer may change confirmed holes).
4. Bob opens the card and `confirm` Team 2 holes 1 to 6. 200.
5. Ann `final`. 200. Team 1 wins, Ann and Bob get $20 each.
The check is "two people not both from the HOLE's team". Both here are from the rival team.
Fix: a hole typed by an outsider is confirmed only by that team's own scorer, or by an outsider who is not on the typer's team (and not on any team that gains). Same rule for side-game winners.

### H3. A playing organizer marks the leader "did not finish" and takes first place
Repro (a1.js, case A3):
1. Same 3-player money game. Bob leads with a full, confirmed 18-hole card.
2. Ann: `team` op `withdraw`, tid T2, reason "left early". 200.
3. Ann: `final`. 200. Bob has no place and no money. Ann is paid $30.
It is logged and Bob gets a notice, but the money has already moved.
Fix: a team with a complete card cannot be marked withdrawn. For a short card, a withdrawal by someone who plays in the game needs that team's scorer, or a person on no team, to OK it.

### H4. A "confirmed" handicap can be built alone (sandbagging into net money games)
Golf marks a round `extra.confirmed: true` when the game has more than one MEMBER. It does not check that anyone else played or confirmed.
Repro A (real stats.js in the merged tree, /tmp/revgolf3/t/i1.js case I2):
1. Dan creates a golf day, adds a typed-in guest "Ghost" on Team 2, starts, enters 18 bad holes for himself, finishes. Ghost never hits a shot. Nobody confirms a hole.
2. Three such rounds. `stats.handicapFor(dan)` answers use = 54.0, "54.0 · 3 of 3 rounds confirmed".
Repro B (case I2c): a second account only JOINS (never on a team). Same result: 3 of 3 confirmed.
That number is then THE handicap in every net money game, flight and tournament.
Note: the stats branch on its own (e214bcf) ignores golf's flag and counts every non-solo golf day as confirmed, so even a one-member "golf day" would count there. The preview copy of stats.js believes the flag.
Fix (golf): set `extra.confirmed` true only when every hole of this player's card was confirmed by another ACCOUNT (not a guest) who is not on his team (`verified` already computes almost this). Fix (stats): read `extra.confirmed === false` in the shipped stats.js (the preview already does).

### H5. Enterprise tournament with no entry fee in the app: players set their own handicap
Courses usually collect the money at the counter, so the app shows no entry. Then nothing stops self-set numbers.
Repro (/tmp/revgolf3/t/a2.js case Hc):
1. "club" is an Enterprise account. It creates a net stroke-play day with entry 0.
2. Bob joins typing 40. He plays off 40 at once.
3. Bob: `team` op `hcp` on himself with 45. Answer 200. He plays off 45. The director did nothing.
The E-H rule says the director sets handicaps in a tournament.
Fix: in an Enterprise game (`c.ent`) treat every self-typed number as "asked" (the same path as a money game), and let the director OK it or set one with a reason. Block Start in a net Enterprise game until every player has a number, as money games already do.

---

## MEDIUM

### M1. After a reopen the organizer can un-pay the winner and finish again; the paid change is not logged
Repro (a1.js, case A4): final round, Bob wins $30. Ann `reopen` with reason "fix paid list". Ann `paid` Bob = false (200). Ann `final` (200, nothing to confirm). Ann now wins $20.
Bob's only notice is the reopen text. The history has no line about the paid change.
Fix: after the first Final, every paid change is written to the history and sent as a notice ("Ann marked Bob not paid"). Better: marking someone NOT paid after a Final needs that player, or a person on no team, to OK it.

### M2. Finished pool: the organizer can mark the winner "not paid" with a typed reason and move the money to himself
Repro (/tmp/revgolf3/t/a4.js): pick six final, Cat 1st $15, Ann (organizer) 2nd $9. Ann `paid` Cat = false with reason "never paid me". 200. Ann now gets $12.50, Cat $0. Logged, everyone told.
The brief says "paid list frozen at Final". This is a soft freeze.
Fix: freeze it fully at Final for pools, or allow only "not paid to paid" after Final.

### M3. A money game can start with a handicap the player typed for himself, never OK'd
The "ask, don't set" rule looks at money at the moment the number is typed. A heads-up match adds money later and nothing is re-checked.
Repro (seen in /tmp/revgolf3/t/m1.js round 2 and a2.js case Hb):
1. Casual net game (entry 0). Ann types her own number 6.4 (or Bob types 36). It is set at once.
2. Organizer sets a $10 Nassau in set-up, then `match` op `add`. The game now shows money.
3. `start` answers 200. The self-typed number is used. `hcpok` says "No handicap is waiting for an OK".
Fix: call the "demote self-typed numbers" step (and the full-index to confirmed-index refresh) inside `match add`/`draw`, and again inside Start.

### M4. Flights without money start with everyone on 0 strokes
Repro (a2.js case Hd): 4 players, net, flights 2, entry 0. Nobody has a confirmed index. `start` answers 200. All four play off 0, and the flights are split by name order (all "0.0 to 0.0").
Flights mean the confirmed index is used, so a player with 10 unconfirmed rounds silently gets 0.
Fix: block Start when flights are on and a player has no number (same check as net money games).

### M5. Organizer sets his own teammate's (or his guest partner's) handicap in a money game, no outside OK
Repro (a2.js case He): Ann and Bob are Team 1 in a $10 best ball. Ann: `team` op `hcp` for Bob with 54. 200, "Set by Ann: 54.0".
Ann cannot set her own number, but she can set her partner's, which helps her just as much.
Fix: a number for anyone on the setter's own team needs an OK from a player on another team (the path already exists for the organizer's own number).

### M6. Sideways scroll at 360 wide: the fourth tab is cut off
On every golf-day screen with the tab row (Leaderboard, Scorecard, Matches, Side games), "Side games" runs to x = 401 on a 360 px screen. The overlay scrolls sideways (401 > 360). 18 of 174 screens in the crawl, 8 of 42 in the coder's own script.
Screens: /tmp/revgolf3/shots/360_cb_1/24_flights_leaderboard_all.png, /tmp/revgolf3/crawl/360_violet_0/c011_*.png.
Fix: let the tab row wrap to two rows, or shrink padding/font under 400 px (a 2 x 2 grid works).

### M7. Light theme (violet, dark off): gold text and one button are unreadable
Measured contrast, same on all three sizes:
- "Text it" button on the invite card: dark text on navy, 1.31:1. Cannot be read.
- "$200 pool ›", place number "1", "1 new" badge, the "Notice" and "Reopened after it was final" headings, "Picks lock at the first tee time", "Couldn't reach the course list": gold #f5c542 on white, 1.3 to 1.6:1.
- Green "-2 ›" and "6 of 6 made cut": 3.58:1.
Screens: /tmp/revgolf3/shots/430_violet_0/10_reopen_notice_for_player.png, /tmp/revgolf3/crawl/360_violet_0/c022_*.png.
The navy theme and violet-dark pass (only dimmed rows fall under 4.5, see L6).
Fix: in the light theme use a dark gold (about #8a6500) for .ogold text, white text on .opri links, and a darker green.

### M8. Big tournaments: scores bounce with "Busy, try again" and land in the "not saved" list
All of a game lives in one database row. A write retries 8 times with no pause.
Repro (/tmp/revgolf3/t/r1.js, storage slowed to 30 to 80 ms like a real database): 40 one-player teams.
- 16 scorers saving in the same second: all saved.
- 24: 8 refused with 409 "Busy, try again".
- 40: 21 refused.
The phone treats 409 as a final refusal, so those holes move to "not saved" and need a tap on Try again.
Enterprise allows up to 500 people per game, and that is the paid product.
Fix: answer 503 for Busy (the phone already retries 5xx by itself), add a short random wait between retries and more of them. Later: one row per team card.

### M9. Director's handicap log shows a junk line in the merged build
With the real stats.js, `eventLog` also holds a "Start set" row. Golf passes it through as a handicap change.
The director's "Handicap changes" card then reads ": – → 1797022800000.0 · Tournament director · Start set".
Seen in /tmp/revgolf3/t/i1.js (case I3) and pics/golf.js line 387.
Also every line says "by Tournament director", not the person's name (stats ignores golf's `byName`). E-H asks for "who".
Fix: in golf `full()` keep only rows with `field === 'hcp'`. Ask the stats coder to store `byName`.

### M10. The stats side of a tournament does not lock when golf starts
Repro (i1.js case I3): tee time 3 hours ahead, organizer starts early. Golf locks handicaps. `stats.eventOverride(...)` called directly still answers changed: true (14.2 to 30) and is logged.
Golf keeps playing off 14.2, so the stats log and what was played disagree. With no tee time set, the stats side never locks.
Fix: at Start pass `lockAt: now + 1 s` (stats refuses "not in the future"), or have stats expose a lock call.

---

## LOW

- L1. Pick six `tiers`: "someone already picked" is checked outside the write. Repro (r1.js): `pick` and `tiers` sent together both answer 200; Bob's locked picks are no longer one per tier. Fix: check inside `mutC`.
- L2. Score history shows raw engine words: "ctp winner · hole 3", "ctp confirmed", "reopen", "final". The preview copy of pics/golf.js already maps these to plain words; this commit does not. Port that map.
- L3. A flight where no paid team finishes: its share of the pool is paid to nobody (`notWon`), and the phone never shows it (pics/golf.js does not read `notWon`). 1 of 40 random games. Fix: roll it into the other flights, or show "not won".
- L4. A neutral organizer (or co-organizer) puts a press straight into other people's Nassau; the side that is up never agrees to the new bet. Suggest: an offer there too.
- L5. `lockAt` can only move earlier. A tee time moved later (rain delay) still locks handicaps at the old time.
- L6. Dimmed rows (did-not-finish row, withdrawn golfer, disabled "‹") are 2.9 to 3.8:1 in every theme.
- L7. A guest name that contains "&lt;" shows as the literal text "&lt;" (double escaped). Harmless.
- L8. An Enterprise account cannot create a golf day at all when stats.js is missing from the build (503 from `eventSetup`). Fine in the merged build; do not ship golf alone.
- L9. `groups.test.js` in this branch is flaky: 5 of 10, then 7 of 10 (machine busy), then 3 of 10 (machine idle) failed with "race join -> 409 Busy, try again". Not golf code and not changed by this commit, but the suite is not green.
- L10. A confirm with made-up `revs` is accepted without opening the card (the phone app always opens it; only a hand-made request can do this).
- L11. In a 3-way flight game the dashboard record's `place` is the place among ALL teams while money follows the flight place. Both are in the record; make sure the dashboard shows the flight place.

---

## What I verified (all pass unless listed above)

Round 2 defects, each attacked again:
- Resolve: refused on an undisputed hole (409), on the organizer's own team (403), after Final (409). Another team's scorer settles an organizer-team hole as "entered"; he cannot confirm it himself; the team's scorer can.
- Reopen: needs a reason (400 without), logged, every player gets a notice with "new" flag and a badge on My golf. After a reopen the organizer's own changed hole blocks Final; force cannot cover it.
- After Final, 21 different writes tried (score, resolve, dispute, confirm, extra, extraconfirm, extrareopen, withdraw, hcp, hcpok, co, scorer, assign, remove team, guest, match add, draw, setup, leave, paid, start): none changed anything.
- Race: Final sent together with two scores and a side winner: Final won, the others answered 409/400, nothing logged after Final.
- Partial card: money Final refused ("Team 3 has played 3 of 18 holes"), also with force. Withdrawn team: no place, no money, record shows dnf, pl = minus entry. No-money Final: short card ranks last with no place and no W.
- /golf/extra after Final: 409. Confirmed winner: changes only through `extrareopen` (organizer or co-organizer, reason, notice), then a fresh confirm by someone not on the winner's team who did not type it. Confirm pinned to the winner shown (409 when it changed).
- G16 pools: re-pick refused once anyone else is in; leave keeps the entry and the seat; the left player cannot read or pick; rejoin gives the same picks back, still locked. One and done: same after leave and rejoin; used golfers stay used.
- Custom payout table with fewer finishers: 60/30/10 with two finishers paid $14.67 / $7.33 of $22 (two thirds / one third). 50/30/20 pools exact.
- Team skins and team closest-to-pin: one prize split between the team's players (R1: 18 skins x $5 = $90.00 exactly across six records; CTP $20 = $10 + $10). Losers get an L record. An unpaid player shows $0.
- Calcutta source (direct calls and the coder's test against the real engine dc5371b, 10 of 10): `started()` throws on a database error, unknown game, bad id, feed down, no start time; `results()` answers {} when it cannot read; `organizer()` true only for the golf day's organizer (any signed-in account for a tour field, false with no viewer); `teams(calc,{viewer})` null for a stranger, no viewer, or a member key in place of an account id. Players of record go out as account ids / `g:<guest id>` to the engine only. No account id, member key, guest id or token hash in any phone response I scanned.
- Withdrawal swap: once only; refused 1 ms after the new golfer's tee time; refused when the feed has no tee times and round 1 has begun; shown to the whole pool.
- Presses: after a nine closed out 5&4 the press starts on hole 6 (next unplayed); back-dated and skipped holes refused; only the side that is down; the organizer's own press is an offer; nobody accepts his own; an offer expires once that hole is played; matches cannot be added or removed after play starts.
- Confirm pins versions: stale `revs` refuse the whole confirm and nothing is confirmed; no `revs` and no server memory: "open the card first".
- Offline: the same scorer's 2nd and 3rd correction win whatever version they were typed on; a replay of the first queued entry is a harmless duplicate; someone else's newer entry is protected both ways.
- No index in a money game: own number answers 202 "asked"; self-OK refused; a plain player cannot OK another player; the organizer's own number needs a player from another team; Start refused and names who is missing; after Start handicaps are locked.
- ONE handicap source, with the REAL stats.js: golf finds it by itself; answer has oddable, confirmedIndex, rounds, confirmedRounds, event, setBy, use; `{casual:true}` passed for casual games; the phone shows "Oddable 16.0 · 4 of 6 rounds confirmed"; a typed number is ignored when a real index exists; the organizer of a standard game cannot override a real index (409).
- Director override, real stats.js and real limits.js: Enterprise flag lifts the cap (11 members in, 500 max); director adds a number for a player with none and changes one with a real index, reason required; "Oddable 17.0 · 4 of 7 rounds confirmed · Tournament 10.0, set by director" shown; lifetime index untouched; a player cannot use the route; locked after Start in golf.
- Course search (mocked directory of 60): 25 per page, "Show more" adds 25 then 10 to the same list, 60 distinct, no drop to the manual screen; a course opens its tees with rating, slope, yards and hole list; "Enter a course yourself" is separate; service down or answering 500: "Couldn't reach the course list. Try again." plus 15 bundled sample courses (10 Rio Grande Valley), and a sample course opens with tees while the service is down. Tags in course names are stripped.
- Enterprise billing with the real limits.js: `lock:entuse` got one game, type golfday, 10 players (the director who did not play is not counted); a standard account is not billed; the stand-in row is not written.
- Attach, real groups.js: organizer who is the commissioner: 200. A stranger attaching his game to someone's group: 403. A plain member of the golf game: 403. `attachToGroup` called cold: 403. `create` with someone else's groupId: game made, not attached, `attachError` returned.
- Injection: tags, < > and backticks are stripped from title, names, team, guest, course, notes, reasons; quotes are kept and the client escapes them. Odd inputs (fractional holes, strings, negative strokes, __proto__, objects as id, 50 KB body) all refused cleanly. Stranger with a game id: 404. Wrong codes lock out after 9.

Scoring by hand (my own arithmetic, not golf-score.js; scripts m1.js and m2.js):
- Round 1, 2-person scramble net, 3 teams, $25, 10% take, 60/40, team skins, CTP: team handicaps 4.4 / 7.9 / 1.8, gross, net, places, pot $125, take $12.50, pool $112.50, payouts $45.00 / $33.75 / $33.75 all match. Skins with a 2-skin carry split three ways at the end: match.
- Round 2, four-ball best ball net (85%), Nassau $10 at 90% off the low player, with a press from hole 5: board, front / back / 18, the press, and money (+$20 / -$20 per player) all match.
- Round 3, Stableford net on 9 holes (half handicaps), 5 players, $7, 50/30/20, one unpaid, a tie for first: points, places, $11.20 / $11.20 / $5.60 match.
- Flights, four set-ups (2, 3 and 4 flights; both boards half each; gross only; net only; one unpaid; forced four-way ties): flight split, places, pool per flight and board, every payout in cents, and the dashboard records all match.
- Fuzz: 20,000 random pools/tables/ties, sums exact. 40 random finished games through the engine: pool = entries minus take, lines = pool, paid + not won = pool, dashboard records = paid, zero cents off.

Suites, 10 runs each: golf.test.js 98 checks 10/10. golf.calcutta.test.js 5 checks 10/10. alert.test.js 10/10. cfbd.test.js 10/10. groups.test.js flaky (L9).

Screens (headless Playwright, the coder's 42-screen script plus my 174-screen crawl):
- 42 screens x 80 checks at 360x740, 430x900, 1280x800 in navy, violet-dark and violet-light: 0 page errors; all 80 checks true everywhere; problems only at 360 (M6).
- Crawl (13 user/game pairs, every tab and view button) at 430 navy, 360 violet-light, 1280 violet-dark: 0 page errors, no "undefined" / NaN / "Double lock" / "USGA" / "GHIN" / "DUPR", no tap target under 44 px, no sideways tables, headers sit over their columns, the My Bets banner is fully covered by the overlay on all 174 screens (banner showing; on two of the 13 passes I also tapped it open first, but I did not separately confirm the open state rendered), every drill-down (team, hole, payouts, players, history, match, rules) returned with Back to the screen it came from.
- The look matches live Oddable (navy header band, chips, cards).

## What I could not verify
- Anything live: Supabase, real sign-in, ESPN feed, OpenGolfAPI, push, real phones.
- The client that will actually ship: the preview tree's pics/golf.js differs from this commit (API origin, plain-word history). I tested this commit's file.
- `SEEN` on two server instances or after a restart.
- scripts/golf-proof.py: it writes a file into the original repo, so I did not run it. I re-attacked each fixed item myself instead.
- The Calcutta engine's own screens with golf lots (only the source contract and the coder's engine test).

## The coder's own decisions: my recommendation
- Two people, not both from the hole's team: keep, but add "and not both from the same rival team" (H1, H2).
- Co-organizers: keep. A co-organizer who plays must not settle or confirm alone against a rival.
- Notices in the app only: fine for launch. Wire push later.
- Forced Final never covers the forcer's side; exception when no one else has an account: keep. The board already says "never confirmed".
- No Final in a money game over a short card: keep. Tighten who may withdraw a team (H3).
- Confirmed side winner changes only through a logged reopen: keep.
- G16 leave keeps the entry and seat: keep.
- Payout table re-scaled when fewer finish: keep, but ask Steve once (the other choice is "unwon places go back").
- Team prize split among players; a match is one bet per side: reasonable, needs Steve's yes. Say "per side" on the set-up screen.
- Swap only before the new golfer's own tee time: keep.
- Neutral organizer press goes straight in: make it an offer (L4).
- Confirm pins hole versions, with server memory as fallback: keep.
- Flights fixed at Start, pool shared by paid players, gross/net as set: keep. Handle the empty flight (L3) and no-number players (M4).
- One handicap source: keep. Fix what "confirmed" means (H4).
- Nobody sets his own number in a money game; the organizer needs another player's OK: keep, and extend to teammates (M5), Enterprise (H5) and money added late (M3). The extra tap for the organizer is worth it.
- Casual net game plays off 0 with no number: fine, but show "0 strokes: no handicap yet" on the card.
- Paid list: frozen for a golf day, soft for a pool: make both hard, or log every change (M1, M2).
- Best ball 85 / 75 / 85 and singles at 100%: agree.
- Attach only through Groups, started from golf: keep.
- Billing: one and done counted per tournament: Steve's call. "Per player per game" reads to me as one season = one game.

## Proof nothing was changed
`git -C /home/claude/calcutta-golf status --porcelain` printed nothing.
`git -C /home/claude/calcutta-golf rev-parse golf-v1` printed 2fa88eb12a7a238c31972b1d148a267d739c9b9a.

My scripts: /tmp/revgolf3/t (a1 to a4, c1, f1, i1, k1, m1, m2, r1, x1). Screens: /tmp/revgolf3/shots and /tmp/revgolf3/crawl.
