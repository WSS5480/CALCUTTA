# Groups round 3 review (v254, commit 1e47e93 on groups-v1)

Reviewer, read-only. Nov 16 2026. Reviewed in my own clone at /tmp/revg4/repo. Nothing in /home/claude/calcutta* was changed. No pushes, no live calls, no Odds API credits.

## Verdict: DO NOT SHIP to live money contests yet

Most of the round-3 rules hold up under attack. Three things do not:

1. A player can still get even money on any heavy favorite (Critical 1). It is a one-request trick.
2. The "even money with no reference" rule itself leaves a real edge (High 1). This is the rule as decided, not a bug.
3. The commissioner can void bets while a game is being played (High 2).

Fix Critical 1 and High 2, and make a decision on High 1, then it is close.

## Is there still a way to gain an edge in a money contest? Yes, three.

- **Unmatched-game trick (Critical 1).** Bet a -1600 favorite, get paid +100. Honest player with the same bet gets +$6.25 on $100; the cheat gets +$100.
- **Even money when ESPN has nothing posted (High 1).** Legal under the rule. Any favorite with no ESPN odds at kickoff pays +100.
- **Commissioner void during a delay or a moved game (High 2).** The commissioner can wipe a rival's winning bet, or their own losing one, mid-game.

Everything else I tried failed: forged phone fields, Kalshi tags, replayed phone state, edits and deletes, two phones, racing adds, adding after kickoff, off-market lines in every sport, same-game and repeated parlay legs, both sides, split stakes, huge stakes.

## Residual risk of "even money with no reference"

- Who it hits: games ESPN posts no odds for at kickoff. Typical cases are big-school vs small-school college football, many early-season college basketball games, and any ESPN odds outage.
- Size: a favorite that wins 90% of the time, paid at +100, returns about +80% per dollar. A fair price returns about 0%.
- Run, my harness: Duke over a small school, nothing posted, typed +100, $100 stake: +$100. NY Giants with nothing posted, typed +500: +$100.
- Parlays multiply it: four legs (three with nothing posted) paid +$757 on $100.
- With 10 bets a week at the cap in a "Winnings" contest, this decides the contest.
- Favorites with a spread but no moneyline are handled (capped from the spread) in NFL, college football, NBA, college basketball only. Not in NHL or MLB.
- Suggested rule: no reference at kickoff = the moneyline does not count (same as spreads and totals already). Or let the commissioner choose, default off.

## Defects

### Critical

**C1. A bet the server cannot match to a game when added is accepted, then graded at even money after the game.**
- Why: the add step keeps a leg it cannot match ("judged later"). After the final the game is found in the score cache, with no pregame reference, so the moneyline rule falls to even money. The add time is before kickoff, so it counts.
- Repro A (always works, "All sports" contests; NBA, MLB, NHL, college basketball games):
  1. Group with an All-sports contest, bob is a member.
  2. Before the game, POST /groups/bet/add with `{id:'w1', gid:'<NBA event id>', home:'NE', away:'KC', day:'<a day 3+ days from the game, inside the contest>', side:'BOS', type:'ml', odds:100, stake:100}`. No `lg`.
  3. Answer: 200 "Saved to your group. Locked." The stored bet has no game attached.
  4. After the final (any other bet or tick loads that day's scores): won, +$100. ESPN had BOS at -1600; the honest bet paid +$6.25.
- Repro B (every league, every contest): same request with the right league, when ESPN's event lookup (`summary?event=`) fails or answers in another shape. NFL contest, SF at -500: +$100 instead of +$20. The coder never ran that lookup against real ESPN, and I could not (sandbox blocks ESPN).
- Why A dodges the lookup: only the first two candidate leagues are tried by event id (`resolveLeg`, `lgs.slice(0, 2)`); football-looking team codes put NFL and college football first.
- Scripts: /tmp/revg4/atk/t1.js (part 2), t8.js.
- Fix:
  1. In `addCheck`, refuse any game leg (has `gid` or a game ticker) that does not match a game right now: "Oddable can't find that game right now. Nothing was added." Keep only true props for the honor system.
  2. In grading, a leg first matched after its kickoff never counts.
  3. `follow` should try every allowed league, not two.
  4. Add a test for each.

### High

**H1. "No reference = even money" pays favorites far above fair.** See the residual-risk section. Decision for the manager and owner; my recommendation is "does not count".

**H2. The commissioner can void bets on a game in progress.**
- Why: "postponed" for the void screen includes any status with DELAY or SUSPEND, and any game whose start moved more than 6 hours, with no check that the game has not started.
- Repro (delay): ann (commissioner) has NE, bob has MIA. Third quarter, ESPN status STATUS_DELAYED (lightning). `bet/voidable` lists both bets. ann voids both as "postponed". MIA wins; bob's winning bet is a push. Script: /tmp/revg4/atk/t4.js part H.
- Repro (moved time): bets added while ESPN showed a placeholder time; real kickoff 15 hours later. In the 4th quarter the commissioner voids her own losing bet. Result: push instead of -$100. Script: t4.js part H2.
- The reason is logged and shown, but the money effect stands.
- Fix: allow the "postponed" void only when the game has not started (state "pre") or is cancelled, or after the 48 hours. Never while state is "in" or once a score exists. Drop DELAY from the "off" test for games in progress.

### Medium

**M1. A kickoff time stored once can be a placeholder.**
- A bet stores its game's kickoff when added and never re-reads it. If ESPN later sets the real time (college football TBD times, NFL week 18, playoffs):
  - other members can see the bet from the placeholder time, hours before the real kickoff, while adds are still open (t4.js H2: ann saw bob's KC bet 2 hours early and could still add). Owner rule G6 says hidden until kickoff.
  - the reference price stops updating at the placeholder time.
- Not verified against real ESPN placeholders (sandbox).
- Fix: until the game really starts, follow the event's current start time for visibility, freeze and reference.

**M2. The price rule depends on a server tick before kickoff.**
- No tick between ESPN posting odds and kickoff (server down or restarting): the bet is graded on what was known when added.
- Runs (t2.js part B): SF added at +100 before odds were posted, no tick: +$100. With one tick 30 minutes before kickoff: +$20. MIA typed +380 early, closing +140, no tick: +$380.
- The keep-awake ping makes this narrow, but only the first 300 running groups are ticked.
- Fix: store the time of the last reference read; if it is older than about 30 minutes before kickoff, treat as "no reference". Remove the 300 limit or page through it.

**M3. The rules shown to players are wrong in two places (pics/groups.js lines 226 and 229).**
- "never better than the market price Oddable saw (+10 cents). Bets first synced after their game started never count." The 10 cents is gone and bets are added, not synced.
- "Longest odds that count: +500 cap on top; when Oddable has no market price; otherwise the market price + 10 cents" does not read as a sentence and is wrong.
- Screenshot: /tmp/revg4/shots/430x900-navy/03_rules_sheet_round3.png
- Fix: one line each, matching the rule in HANDOFF.

**M4. "Saved to your group. Locked." for bets that will never count.**
- Accepted then not counted: a 5-leg parlay in a 4-leg contest, a bet type the contest does not allow, the other side of a game (hedge), bets past the weekly 10, a total with a bad number.
- The player finds out later and cannot remove it.
- Fix: at add time, check the player's contests and say so ("Saved, but it will not count in Sunday Crew: more than 4 legs"), or refuse when it counts nowhere.

**M5. A bet can be shown with a line it was not graded on.**
- `type:'SP'` (capitals) with `line:60.5` is graded as a moneyline at the market price, but members see "KC +60.5 ... won". Same for a moneyline sent with a `line`.
- No money edge. It looks like the old fake-line cheat and will cause arguments.
- Fix: in `cleanBet`, accept only `sp`, `ml`, `ou`/`tot`, and drop `line` from moneylines.

### Low

- L1. Suggest partners screen prints "not a USGA or GHIN index" and "Not an official DUPR rating". The brief bans those words; owner rule H1 asks for only "Calculated with the World Handicap System method."
- L2. Violet theme: purple buttons are white on lilac at 2.7:1 (Invite people, Void this bet, Create group, Add to my group). Disabled items 3.0 to 3.6:1 in every theme. In violet light the Groups screens stay dark.
- L3. "Coming soon" still shows on the hub (Add a Calcutta / golf contest / local event) and on Create (three formats, weekly prize). The engines are not in this branch.
- L4. Suggest partners' 200 ms limit is wall-clock: 154 ms worst alone, 596 ms once while the test suites were running.
- L5. Enterprise billing: `recordPlay` files a contest under the current month, so a season-long contest is counted again every month. Confirm that is how "$20 per player per game" should bill.
- L6. 100 waiting requests is the limit; person 101 at a club is refused until some are approved.
- L7. Version stayed v254 and the service worker cache name did not change. If any phone already loaded a v254 build, bump before shipping.
- L8. Standings header "#" sits 5 px left of the place numbers.

## What I verified (works as specified)

- **Rule 1, one way in.** Synced bets with forged `gl`, `sa`, Kalshi tag, `fin`/`finPL`: zero counted, `gl` stripped. Added bets survive phone edit, delete, tombstone, "sold". `bet/edit|delete|swap` answer 409. Kalshi bet goes through the same add step.
- **Rule 2, price at kickoff.** Typed +400 on a -150 side: paid at -150. Line or price moving after the add: kickoff price used. Nothing posted: +100 at most. Spreads and totals refused with no line. Holes: C1, M2.
- **Rule 3, parlays.** Same leg twice, two legs one game (also via league spelling, a total, a text leg): refused. Five legs: not counted. Multiplier is the product of graded leg prices (typed x900 paid x5.52).
- **Rule 4, tolerance.** NFL 1.5 / 2, NBA 1.5 / 3, NHL and MLB main line only, in both directions. Inside tolerance priced worse: KC +4 vs +2.5 is -207, Over 45.5 vs 47.5 is -166. I checked the per-point values against key numbers; they are worse than fair.
- **Rule 5, idempotent add.** Five racing identical adds: one bet. Same id other content: 409. Retry after kickoff of a saved bet: success. Status by id works and is per account.
- **Rule 6, joins.** 100 preview + join from one IP: all 100 accepted as requests. Wrong codes block at 10 per account.
- **Rule 7, partners.** 144 players max, 7 players in threes gives 3/2/2 or 4/3, Hot pairs with four uses each pair's record, hostile input safe.
- **Rule 8.** Same $100 bet 20 times plus 6 parlays on the same game, cap $100: $200 counted on the game. $1,000,000 stake counts up to the cap. Hedges caught across moneyline, spread, parlay leg, Kalshi NO, over/under. Weekly 10 by default.
- **Rule 9, invites.** Codes make requests; commissioner's code joins directly only with the switch on; denied player refused by link, code and request; members never receive the commissioner's code; 20 racing joins into 8 seats gives exactly 8.
- **Rule 10.** Cancelled 0-0 "completed" game: void. Postponed and played 3 days later: void at 48 hours.
- **Rule 11.** Members cannot list or void. A normal bet cannot be voided as duplicate or postponed. Hole: H2.
- **Rules 12, 13.** Covered by the coder's tests (invite routing, recordPlay, attach rollback, Main Calcutta in the main pot), which pass. Signed-out Calcutta, golf, event links show a sign-in banner in the browser run.
- **Pots.** 4,000 random pots with takes, splits, side pots and ties: every sum exact to the cent.
- **Privacy.** Before kickoff another member gets no bet, stake or pick, only counts. A parlay that lost a leg stays hidden and unscored until its last game. Non-members get 404, signed-out 401. No member keys, sync ids or codes in any answer. Hole: M1.
- **v254 markers.** index.html, sports.html, sw.js and every script tag say 254.
- **Tests, 10 runs each.** alert, cfbd, pairing (10), groups (50), groups.r2 (16), groups.r3 (37), groups.owner (16): 70 of 70 runs passed, no flakes. On 486f127 the r3 suite fails 37 of 37, as claimed.
- **Previous attack scripts** (a1 to a7): all earlier holes closed.
- **Browser, 9 runs** (360x740, 430x900, 1280x800 in navy, violet dark, violet light; 30 screens each): 0 page errors, no sideways scroll or sideways tables, no Groups tap target under 44 px, My Bets banner always covered by the overlays, headers over their columns, Back worked on every scripted path, no "undefined", no "Double lock". Screenshots in /tmp/revg4/shots/.

## What I could not verify

- Anything against real ESPN: the event lookup shape (matters for C1 repro B and postponed games), placeholder kickoff times, which games have no odds. The sandbox blocks ESPN.
- Real Supabase, a real phone, a real Kalshi sync, the share sheet.
- pics/classic.html (no group add step there).
- The real Calcutta engine with groups (the coder's test falls back to a stand-in when the engine is not on the machine).
- Browser walk beyond the 30 scripted screens per run; drill-downs only on those paths.
- The previous review's written report was not on disk; I worked from HANDOFF, the commit, the r3 test names and the old attack scripts.

## Recommendations on the coder's own choices

1. Alternate-line K values and the moneyline-from-spread cap: keep. They are on the safe side.
2. A bet counts in a group joined later if the game kicks off after joining: keep. Confirmed it works that way; it was locked before kickoff either way.
3. Per-game cap = 2 x the contest cap: keep.
4. Offline, phone last knew "no group": bet kept personal silently. Acceptable.
5. Duplicate void only before the game starts: keep, and apply the same "not started" test to the postponed void (H2).
6. Wrong codes: 10 per account, 150 per address in 15 minutes: keep.
7. "Just for me" next to "Add to my group": no edge found, since the choice is made before kickoff. Still the owner's call under G16.
8. Even money with no reference, favorite or not (manager decision): change it, see High 1.

## Files

- Attack scripts and harness: /tmp/revg4/atk/ (h.js, t1.js to t8.js)
- Test logs: /tmp/revg4/runs/ (suites.txt has all 70 results)
- Browser runs: /tmp/revg4/pw/ (run.js, report-*.json), screenshots /tmp/revg4/shots/
