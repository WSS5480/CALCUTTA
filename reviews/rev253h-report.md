# Review rev253h: v253 rule rewrite (commit c72cd6f on d7b044f)

Repo /home/claude/calcutta, branch v253-parlays. Reviewed read-only from a clone in /tmp/rev253h_work/repo.
Date: Mon Nov 16 2026, about 11:30 CT.

## Verdict for a LIVE deploy: SHIP AFTER FIXES

One item blocks (H1). Everything else the brief asked about holds.

- The rule as the coder defined it holds: 0 violations in 2,400 random weeks (301,753 ticks) under my own checker, and 0 in the coder's fuzz on a seed it had not seen.
- The rule as the manager wrote it does not fully hold: a game left out of the ranking because of a late line can still decide the Lock on a later tick (H1). Reproduced on real 2026 week 11 teams with half-point moves.
- Not too sticky: after a hiccup the Lock is back on the ranking's answer on the next clean tick.

## What blocks

### H1 (High, blocking): a late line on another game still decides the Lock, a few minutes later

The rule says: if any game was excluded because of a late line, the Lock is carried. The code carries only on the tick the late line is read. From the next tick on, that game stays out of the ranking for the rest of the week, and the Lock is free to move on a ranking that is missing it.

Repro (real model, real week 11 schedule): `REPO=<clone> node /tmp/rev253h_work/x1.js`

1. Lines: NYJ@LAC 10, PIT@PHI 10, TB@DET 5.5, MIA@BUF 2.5, ARI@KC -6.5, rest as in games.csv. Sunday 9:00 ET ranking: NYJ 55.3% (#1), PIT 54.7% (the Lock), TB 54.4%.
2. Server away 9:00 to 12:30 ET. TB@DET moves 5.5 to 6 meanwhile (read 30 minutes after its mark, so late).
3. 12:30 wake: Lock carried on PIT. Correct.
4. 12:40 ET: NYJ@LAC moves 10 to 4 and PIT@PHI 10 to 7, both hours before their marks.
5. Result: the Lock moves PIT to NYJ and goes final on NYJ +4.
6. Control, same world with the server never away: the Lock stays PIT and goes final on PIT +7.

Why: with TB@DET in the ranking (at 5.5 or at 6) it is the #1, PIT is second, so PIT stays the Lock. With TB@DET left out, PIT becomes the stored #1 and the Lock drops to NYJ, the model's third pick. The late line on TB@DET is the only difference between the two runs.

How often: rare. It needs an outage across a mark, a changed number on a top-3 game, then a re-order. In my fuzz the Lock changed 6,567 times while some game was excluded for a late line; the random model did not hit this exact chain, the real-model script does every time.

Fix options (manager to choose):

- B, recommended: when a late number overwrites one that was read in time, keep the in-time number (for example `gl[id].il`) and rank the game at it. Grading stays at the frozen line. The ranking is then built only from in-time numbers and nothing is excluded. A game that never had an in-time number stays out (there is no in-time information about it).
- A, literal: also carry while any other game of the week is excluded (`|| wg.some((g) => g.id !== own.id && lateLine(g))` in `pin`). I tried it in a private copy: x1 is fixed, but the Lock was off the ranking's answer on 42% of clean ticks in my outage-heavy fuzz, and one case in alert.test.js (line 335) fails. Too sticky.
- Or the manager accepts the coder's reading in writing (clean = nothing late on this tick) and the rule text in HANDOFF is changed to say so.

## Not blocking

### M1 (Medium): the "game off the schedule" exception fires when a game is only missing from one ESPN answer

`compute()` cannot tell postponed from missing. Repro: `node /tmp/rev253h_work/x2.js` (X2, X2b).

- Clean tick: Lock MIA, MIA@BUF missing once: Lock jumps to TB, then back to MIA a minute later.
- Wake 30 minutes past the 1pm marks with MIA@BUF missing from that one answer: Lock moves to NYJ and stays there for the week.

Old behaviour, but it is now the only way a not-clean tick can move the Lock. Fix: pass postponed/cancelled games to `compute()` with a flag and apply the exception only on that flag, or after the game is missing on several reads in a row.

### L1 (Low): wording on a LIVE carried Lock with no %

The list says "no model % right now" (good). The Lock detail sheet and the Move the line sheet say "it was frozen late" although the pick is live. Fix: when the pick is not final say "No model % right now: the Lock is being kept on this game until the next check with up-to-date lines."

### L2 (Low, decision): a postponed or pick'em #1 keeps the #1 slot

X3/X4 in x2.js: ARI@KC (#1) leaves the schedule, the Lock stays MIA, which is now the model's most confident pick among games that will be played. In the fuzz the Lock was the ranking's true #1 on 775 of 44,212 checked ticks. Owner's words are "second most confident"; manager or owner should confirm this is wanted.

### L3 (Low): held Lock whose kickoff moves later

X6 in x2.js: held at its mark (earlier results missing), kickoff then moved a day: it stays held and its line stays frozen at the old mark for the whole day (16.5 while the market moved 3 points), even after the missing result arrives. Fix: clear `lockWait` and the game's `f` flag when the game is before its mark again.

### L4 (Low): live Lock left on a postponed game

If the Lock's game is postponed and nothing else is in contention, the Lock stays live on the missing game and the week ends without a final Lock (7 of 2,400 fuzz weeks). Never graded.

### L5 (Low, not from this commit): Alert sheets

- Tap targets under 44px: "Move the line?" 40 high, "Back" 66x40, "2-game/3-game parlay" 40, "Back to list" 33, "Open full game" 25.
- Violet light theme only (user can switch to it): "Move the line?" gold on white 1.45:1, the owner's "Live pick: can change until 1 hour before kickoff" line 1.62:1, unit totals 1.76 to 2.78:1, Covered/Missed 3.5 to 3.9:1. Both Cowboys themes and violet dark pass 4.5:1 inside the sheets.

### Note (design consequence, not a defect)

A carried Lock can go final on a team the model does not take at the frozen line (example: MIA -0.5 while the model takes BUF). It shows "frozen late" and no %. 169 of 2,393 finals in my outage-heavy fuzz.

## What I verified

Previous blocking defects (reference scripts in /tmp/rev253g_work, run against this commit):

- T1a, T1h (late line on the #1 while down): Lock stays MIA, final, flagged late. Fixed.
- T1b to T1g, T1i: same game and team.
- T2 (Lock later than the #1, down across the 1pm mark): Lock unchanged. Fixed.
- T3, T3b (books to ESPN after a restart, same numbers): not treated as late, Lock unchanged. Fixed.
- S4 a to f, held Lock postponed and returning: as defined; `lockWait` cleared.

My own checker and fuzz (/tmp/rev253h_work/hfuzz.js; clean/not clean decided from the simulated world, not from the record):

- Seeds 1 and 7: 2,400 weeks, 301,753 ticks, 0 violations.
- 85,768 ticks with a live Lock; 26,312 not clean; Lock carried on all of them while its game was scheduled.
- 12,651 Lock changes, all on clean ticks; 158 moves because the game left the schedule.
- 2,393 finals: 1,892 carried, 1,421 flagged late, 12 "line at mark unavailable"; every one at its game's frozen line and price.
- Covered: 8,909 restarts, 402 postponements, 476 kickoff moves, 6,491 lines crossing zero, 1,225 pick'em, 4,842 same-number source flips, line moves weighted onto the Lock's game and the #1.
- Lock and road dog on one game: same number and price, every tick.
- Never a week without a Lock; a final Lock never changed; `lockWait` always pointed at the live Lock's game.
- Stale %: a Lock never showed a % the model does not give that team at that line (stub model, exact).
- The same checker on the previous commit d7b044f reports 473 violations in 150 weeks, so it does detect the old holes.

Too sticky?

- On 44,212 clean pre-mark ticks the Lock was exactly the ranking's answer (0 mismatches).
- After a carried tick, the next clean tick was on the ranking's answer 10,407 of 10,416 times (the other 9 had no rankable game).
- A gap of exactly 5:00 is clean, 5:01 is carried for one tick, then recovers.
- A record written by d7b044f and picked up by this commit after a restart: carried one tick, re-ranked the next minute (mig.js).
- Permanent holds exist only where defined: a held Lock until kickoff, and a Lock more than 5 minutes past its own mark (final).

Suites:

- alert.test.js 10 of 10 pass, cfbd.test.js 10 of 10 pass, no flakiness.
- alert.fuzz.test.js: default seed 600 weeks 0 violations; seed 991, 1,500 weeks, 209,245 ticks, 0 violations.
- scripts/parlay-check.js on fresh games.csv: all results reproduced.
- `node scripts/alert-data.js games.csv` DRY RUN: trophy-season.json 149 finished games, 0 changes; alert-frozen.json 0 changes. It would write nothing.
- LAC@BAL (week 10 MNF) is NOT final in nflverse (scores empty, fetched 17:05 UTC). Kickoff is tonight 20:15 ET.

Other checks:

- "Double lock": no string and no rank-1 path left anywhere in pics/ (only HANDOFF mentions it). Not in the rendered pages either.
- v253 markers consistent: sw.js `pics-v253`, index.html comment, header pill and footer line. Service worker is network-first.
- Published history: this commit does not touch alert-frozen.json, trophy-season.json, the model or trophy.js. Against main, weeks 1 to 9 have the same Locks, lines and picks; two road dog percentages differ from an earlier v253 commit (week 6 ARI 58.9 to 61.7, week 7 TB 51.6 to 52.4, neither changes a pick).
- Playwright, headless, real alert.js behind an in-memory store: 360x740, 430x900, 1280x800 in four themes, with a final carried Lock and a live carried Lock (both with no %). 768 probes per run: 0 page errors, 0 console errors, 0 sideways scroll or wide tables, no "undefined", "NaN", "null", developer text, "Double lock", "USGA/GHIN/DUPR". Move the line Back returns to the Alert drill. My Bets banner covers nothing once it has settled (6 hits were 40 ms into its tuck-away animation).

## What I could not verify

- Live server, Supabase and real ESPN/book payloads (no live calls by rule). ESPN price field shapes are still unchecked against a live payload, as the code comment says.
- A full sweep of every screen in the app: I covered the screens this commit touches (board Alert box, Alert drill, Lock list, Lock detail, Move the line, parlays, Lock and Alert info, Results).
- Money maths, other users' data, HTML injection, request races: not re-attacked; this commit does not touch those paths.
- The Helper: still ranked every tick with no carry rule (the coder's open item). Not tested here.

## The coder's own decisions

- Clean is decided per tick; a late-line game is left out of later rankings: not acceptable as it stands, see H1.
- #1 slot stored as a game (`rec.top`): accept. Confirm L2 with the owner.
- `lt` follows the number, not the source or price: accept.
- D5 guard when the Lock moves on from a game off the schedule: accept.
- No % (`conf: null`) for a carried Lock the model no longer takes; "frozen late" in the app: accept, fix the live wording (L1).
- `lockWait` cleared when the held game leaves the schedule: accept. Held Lock not re-ranked when its kickoff moves: see L3.
- Removing the unused TRB card and all Double lock text: accept.
- Version stays v253: accept (v253 has not shipped; main is v251).
- Helper left on the old scheme: agree it needs the owner's or manager's decision; it has the same kind of late-line moves the Lock had.
- "GRACE must change with the tick interval" note: accept.

## Files

- /tmp/rev253h_work/hfuzz.js (checker and fuzz), x1.js (H1), x2.js (M1, L2, L3, gap boundary), mig.js, ui_h.js
- /tmp/rev253h_work/logs/ (suite logs, fuzz logs, UI output), /tmp/rev253h_work/shots/ (screenshots)
- Fresh data: /tmp/rev253h_data/games.csv

## Proof nothing was changed

`git -C /home/claude/calcutta status --porcelain` prints nothing.
`git -C /home/claude/calcutta rev-parse v253-parlays` prints c72cd6f2739165fe7eb02c3fa3d0d50df9817563.
