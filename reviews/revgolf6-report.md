# Golf v1.5 review, round 6
Repo /home/claude/calcutta-golf, branch golf-v1, aa1e60e (on 13f503e). Read-only. Clone /tmp/revgolf6/repo. Scripts: /tmp/revgolf6/t (atk.js = X1-X5, m.js = X6, hon.js = honest corrections; run with GOLF_ROOT=<repo>/odds-api/ from odds-api). Not re-verified (per brief): scoring maths, payouts, course pick, offline, Playwright screens.

## Verdict for real-money golf: DO NOT SHIP on the benefit test
The benefit test judges each change by today's standings. Three of the six defects below come from that. The harmed-party test fails in three places: a change that hurts nobody yet, an objection window that Final can close at once, and a removed player who can no longer object. With one friend, a cheater can still take the pot.
Casual golf and the honest walk-throughs are fine.

## CRITICAL
### C1. Lowering your own score while it changes no place yet: nobody is "harmed", one friend signs (X1)
- 3 teams, $10 gross. After 9: Bob 0, Ann (organizer, T1) +9, Cat +36.
- Ann re-types her confirmed holes 1-8 one stroke lower each (8 requests). Each one: 202, harm=[], signers Bob/Cat. Cat signs all 8.
- Result: 0 harm entries, 0 harm notices, no NSO flag. Ann is +1 at the turn.
- She plays the back nine honestly (-1 against Bob's +1). Final: "Ann 30".
- Cause: `compareO` counts a team's own score `v` only for the team whose card changed. Every other team is harmed only if its place or payout moves NOW.
- Fix: judge score changes by direction, like `hcpBen`. A lower score for team X = X gains, and every other team in X's pot or flight is harmed (told, can decline or object). A higher score = X is harmed.

### C2. Objections close at Final, and Final can come one second after the change (X4)
- Ann (T1, +1) asks to change leader Bob's confirmed hole 5 to +2. Signers Bob/Cat. Cat signs at once (200).
- Ann then sends `final` (200) and gets "Ann 30".
- Bob: `object` 409 "The round is final". `reopen` 403 (organizer only).
- "Turn it down" on a waiting request is a race: the friend signs before the harmed player sees it.
- Fix: refuse Final while a harm entry is younger than about 15 min. Keep harm entries open for about 30 min after Final; an objection then reopens the round. Do not close objections at Final.

## HIGH
### H1. A removed player can never object (X2)
- 4 one-player teams. Ann asks to remove Dan (`kick`). Bob, who does not gain, signs: 200. The harm entry lists Dan's team.
- Dan `object`: 404 "Golf game not found". `removeIn` deletes the member, and his team is dropped.
- Fix: keep the removed player as a read-only member who can object (`left` plus object rights). Or, after the start, require the removed player's own signature and use the time-out / did-not-finish path for no-shows.

### H2. A fake card confirmed by a friend's team stands, and the pot is paid on it (X3)
- 3 teams. Bob types 18 birdies. Cat (a friend, last) confirms them (200; the N3 cross-team confirm and the old signer rule both allow it).
- Ann disputes, with `want` = par. Cat asks to settle at par: 202, needs Ann or Bob.
- `resolveEnough` needs Bob, or two other teams. There is only one other team (in a 4-team game, the other two must both sign, and the friend will not).
- Bob can also turn down every settlement request as the harmed party, in any size of game.
- Final: "Bob 30". The hole is only flagged `unsettled`.
- Fix (smallest): a dispute nobody settles by Final makes the payout show the places it decides as CONTESTED, with both numbers, not "stands as confirmed". Better also: in money games the confirmer must be from the same playing group (needs a group field).

### H3. A neutral organizer puts a $50 bet on two players after the start, alone (X6)
- Heads-up $50 player matches. After the start, before Bob and Cat score, neutral Ann `match add` Bob v Cat: 200, alone. The benefit test says "same", because nothing is played yet.
- Neither player agreed to the bet.
- Fix: `match` and `matchdel` after the start always need both sides. Never let "same" stand in for consent to a future bet.

## MEDIUM
- M1. Turning a waiting request down is an absolute veto: a declined request has no uphold route. Only an APPLIED change can be upheld. So the outcome depends on who taps first (a signer racing the harmed player).
  - Fix: a decline by the harmed side becomes an "objected" entry that two other teams can uphold, the same as an applied change.
- M2. Second accounts (X5). Ann's own second phone joins on Team 3 and signs Ann's request: 200. Golf has no account-age, history or co-sign-token guard.
  - Fix: reuse the stats co-sign rule (a token from the co-signer's phone, account age, and at least one earlier round with other people), or at least show a "new account" badge next to the signer.
- M3. Rain-shortened round: there is no way to finish it.
  - Final: 409, cards incomplete. Did not finish: 409 until the expected finish (5 h 30), and then it gives no place. A forced Final: 409.
  - Fix: a "shorten to 9" request (count the front nine) signed by every team.
- M4. A late player cannot join after the start: "Teams are set" / "That team is full".
  - Fix (optional): allow an open slot until that team's first hole, with the other teams told.

## LOW
- The 3-team stalemate the coder noted is real. "Put back" protects the status quo, which is the cheater's confirmed number in H2. The fixes above make it moot.

## Item answers
1. Gain test. The handicap direction rule is sound. Score changes (C1), money matches (H3) and removing a contender (H1, where the removed player cannot object) are judged on the snapshot. Calcutta lot holders count as gaining only when something changes now: fine for signing and upholding.
2. Chained and split changes. C1 IS the split attack: eight small changes, each harmless now. Swapping signatures (A signs B's request, B signs A's) works under the test. Only the harmed party's objection stops it, and C1/C2 show where that is missing.
3. Signer identity. Typed-in guests, accounts on no team and players who left are all correctly excluded. Second accounts are not (M2).
4. Harmed party. Covered in C2, H1, H2 and M1. Griefing: the harmed side has an absolute veto on waiting requests (M1). An honest correction against a cheater is vetoed for ever in games of 3 or fewer teams.
5. Honest play.
   - The coder's 8-player net skins + pot walk-through (exactly one "Sign all") and the 4-player casual round (zero prompts) both pass, 5/5.
   - Typo against yourself: 1 tap, no signature.
   - Typo in your favour: re-type, then 1 signature from another team. The text reads "change Team 2 hole 4 (confirmed): Bob 5 → Bob 4", which is clear.
   - Late joiner and rain-shortened 9: no path (M3, M4).
   - I did not re-render the screens at 360. The coder reports 522 screens with 0 problems.
6. Enterprise. Mechanically workable: one "Sign all" from a player on team X covers every team but X, and a second player covers X. But the incentive runs backwards: a contestant gains when everyone else plays off a lower number, and a guest gets a 60-line job.
   - Recommend owner rule E-H: the director (not playing, no lot) sets numbers alone. Every number is logged and visible with its source. Players can object before Start and the director answers.
7. Routes. Every payout POST goes through `power`/`propose`, or through its own rule (score, confirm/dispute, press offer/accept, extra/extraconfirm). Taken alone and logged: `co` (busy-checked), `scorer`, `leave` (blocked after the start for team players). `object` and `uphold` are present. No bypass found. H3 is in the function set, but its "same" verdict is wrong.
8. Suites, 5 runs each:
   - golf.test.js, golf.round3, golf.round4, golf.round5: 5/5 each.
   - golf.stats: 0/5. "A money game plays only a number the organizer approved" fails against stats 54e0b93 (moving approval model).
   - golf.calcutta: 0/5. Line 26 expects the 'notin' code; the Calcutta worktree c178485 answers 403 without a code.
   - Both stats and Calcutta failures are known and not golf.

## Is the benefit test a sound foundation? No
- It is evaluated on a snapshot, so anything whose money is still in the future escapes it.
- The coder already had to replace it with a direction rule for handicaps.
- In practice the real protection is the harmed side's veto, so the test adds complexity without adding safety.

Recommend launching money golf in this simpler, direction-based mode:
1. Every change after the start is judged by direction, never by the standings now. Worse for team X (higher score, did not finish, removed, not paid, lower handicap): X signs. Better for X: a player on another team in X's pot signs, and every other team is told and can object.
2. A bet between two sides (a match, a press, a side game added after the start) needs both sides.
3. Objections stay open 30 min after a change, Final included; an objection after Final reopens the round. Final waits until no change is younger than 15 min.
4. No referee in friend games. A dispute nobody settles leaves the hole CONTESTED: the payout shows the places it decides as contested, with both numbers, and pays no winner for them.
5. A removed or withdrawn player keeps a read-only seat to object; signers come from accounts with history (the stats co-sign token).
6. Enterprise: the director (not playing, no lot) sets numbers and settles disputes alone, all logged and shown; players object before Start.
