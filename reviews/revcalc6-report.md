# Calcutta review 6: calcutta-v1 @ ccf62a7 ("Round 5") on dc5371b
Reviewer: independent, read-only. Clone: /tmp/rv7/repo. Probes: /tmp/rv7/p (q1, q1b, q2, q2b, q3, q4, q5).

## Verdict: SHIP AFTER FIXES
Do not put real pots on it until the three blockers below are fixed.
- Pro bracket events (NFL playoffs, CFP, March Madness, NFL season) are close: only blocker B1 applies.
- "This weekend" events and local events with buy-back are not ready (B2, B3).

## Blockers for a live deploy with real pots

### B1 (High) The commissioner can crown his own team from the final, alone
Repro (q1.js F1, q1b.js F1b): NFL playoffs, commissioner owns Team 1 for $10, members hold $990. Super Bowl listed with no result. At kickoff + 4 h + 24 h: `POST /calcutta/result {id, team:'1', reason}` -> 200.
- Board: over = true, commissioner won $796.88 of the $1,000 pool (champion + the end-of-event leftover roll).
- 1 ms earlier: 409 feedonly. Rule works as written.
- Member sees: a pinned notice with the reason, the correction in `board.corrections`, a tag on the team. Member cannot object or remove it: `result clear` 403, no object route (404).
- Feed posts the real final: removed 40 s later with nobody in the app, money flips back, pinned notice. Good.
- If the feed never changes (game never played, listing left "scheduled"): it stands for good (20 days tested).
- Also accepted 28 h late: "in progress", STATUS_SUSPENDED, STATUS_DELAYED. Refused: postponed, cancelled, forfeit, tie, time TBD.
Is 24 h + fresh read + auto-removal enough? For an ordinary game, yes. For a game that decides the champion or ends the event, no: one person, with a money interest, ends the event.
Fix: a correction that makes a champion, places 1st, or ends the event waits for one other member's confirm (reuse the `claimok` pattern; the buyer of the losing side is the natural confirmer). Until confirmed, show it as "proposed", pay nothing. Add a member "I object" button that pins a notice to all.

### B2 (High) Weekend events never finish: money stuck for good
Repro (q5.js M1): `nfl_wk`, 4 win slots + biggest win, two games, both final, one winning lot unsold. Day +1, +10, +60: over = false, pool $300, paid $120, in play $120, pending roll $60. `potSummary` the same.
Cause: on ESPN events "over" = a champion exists; weekend events have no champion row. Unused win slots and unsold winnings are never rolled or carried.
Same for a Custom table with no champion and no place rows (M2: every team Out, still not over).
Fix: window events are over when the window has passed and every listed game of a lot team is final or off. Custom with no champion / place rows: over when every team is Out, or a commissioner "Event finished" with a notice.

### B3 (High) Guest-claim confirm is bypassed by doing it in the other order
Repro (q3.js K1): Custom event, buy-back on. Commissioner adds guest "Gina" as player of record on Blue. Bob buys Blue for $200 (he saw "Gina"). Commissioner opens Gina's claim link himself -> 200 at once (no buy-back recorded yet, so no confirm). Then `buyback {lot:'L2', self:true}` -> 200. Commissioner owns half of Bob's lot for $100. Bob gets no notice at all; nothing waits in `claims`.
Fix: any claim by the commissioner of a guest of his own Calcutta needs another member's confirm, buy-back or not. Pin a notice for every claim and every buy-back.

## Medium
- M-1 Tie for 1st on a table with a Champion row is not split. q4.js: 2,455 such tables, uneven money in 2,343 (example pool $92.96: $67.20 v $8.85). The champion row goes to one team by id order. Fix: on place events treat the Champion row as 1st place inside the tie split, or refuse Champion + place tables there.
- M-2 "Champion + 2nd + 3rd": champion ticked without place 1, 3rd place empty because two teams are Out -> not over, $30 in play (q5.js M3). Also: every team Out and no champion -> never over (248 generated tables). Fix: a champion counts as placed 1st; all teams placed-or-Out = over.
- M-3 Typed score is unchecked: 300-0 accepted and takes the whole biggest-win row (q1.js F8). Fix: cap the margin per sport (e.g. football 80) and put the typed score in the notice.
- M-4 One empty 200 answer from the feed (q1.js F6, q1b F6f): a standing correction is removed with a pinned notice (5 flaps = 12 pinned notices for a member), and feed winnings drop $30 -> $0 until the next read. Never works in the commissioner's favour (empty list at correction time = 409; one page down = 409 feed). Fix: an empty page that held games before is a failed read; remove a correction as "gone" only after two reads in a row.
- M-5 A correction made after the watch window ended is not flagged in the index (q2b W5): after a restart nobody re-reads it; `potSummary` kept paying the correction for 10 minutes while the feed said the opposite, until a member opened the board. Fix: `syncIdx` after a correction is stored or cleared.

## Low
- Watcher takes the first 100 due; with more than 100 hot Calcuttas carrying corrections the rest never get a turn. Rotate.
- A database error on the first tick after boot delays the index scan 10 minutes.
- `hooks.groupRole` has no timeout (a hanging hook hangs gjoin). Default path is fine.
- Attach in set-up keeps members who joined by code but are not in the group (they can bid).
- Reason accepts an object ("[object Object]" passes the 5-character rule); `team: ['1']` is read as '1'.
- 40-correction cap on a season event: 40 typed wins = $100 of a $1,000 pool (F5). Acceptable.
- `groups.test.js` is flaky: 7 of 10 runs fail ("12 simultaneous joins", 409). Same on dc5371b, file untouched since 8cb7074. Groups coder's, not this commit.

## Verified
- Previous review's defects: all fixed. Old probes pA, pA2, pB5, pG, pS, pT all pass on ccf62a7 (start-moment, restart, feed-down, moved kickoff, 40-way race: freeze rules from rounds 3-4 hold).
- Correction shape: only one game; wins / reached / champ / out / big / place refused (400 onegame); winner must be in the game; member 403; reason required; later rounds refused before their own 24 h; HTML stripped from reason.
- Stacking: four rounds stacked only when the feed lists each game unreported 28 h late (F4: $160, $190, $220, then $1,000 and over). Each needs its own real listing. Covered by the B1 fix.
- 24 h mark: epoch based, exact to 1 ms, no time-zone or DST effect; listed time moved by 1 minute removes the correction.
- Watcher: 60 hot Calcuttas = 60 database reads per tick, 0 writes, 28 ESPN requests in 5 minutes; only site.api.espn.com is called, no Odds API credits; hanging feed: no overlapping ticks, boards answer in under 50 ms; restart picks watched Calcuttas up from the index; finished events dropped and flag cleared.
- Notices: per-member marker; "Got it" sends the notice number, so a newer correction stays pinned; cannot move another member's marker or go backwards; outsider 404.
- Place tables: 50,000 generated set-ups, validation matches my rule exactly (0 differences). 50,000 money tables (ties, Out teams, Champion + 2nd + 3rd, buy-backs, take, roll and carry): pool identity holds to the cent in all; 0 over tables with money stuck. Edit path validates too.
- Attach: refused after first entry and after Start (409 locked). Create-for-a-group: 7 wrong callers / ids all 403, no row left. gjoin: outsider, unreadable group, junk hook, deleted group all 403.
- Tests x10: calcutta (5 suites), alert, cfbd: 50 + 20 runs, 0 failures.

## Not verified
- Playwright at 360 / 430 / 1280 in every theme, contrast, tap targets, My Bets banner, `OddJoin.openGame` in a browser: not re-run this round (budget). Only the coder's own pass exists (/tmp/c5/play). Code read only: `openGame` contract and "Got it" with `data-n` are present; no "Double lock" / USGA / GHIN / DUPR text. Run an independent UI pass before deploy.
- Real ESPN payloads and statuses, real Supabase, real Groups module, real golf / events sources.

## The coder's own calls
1. No correction on series events: agree.
2. Source correction = one finishing place, place 1 makes the champion: agree only with the B1 confirm.
3. Champion + 2nd + 3rd valid: agree, after M-1 and M-2.
4. Out counts as finished: agree; extend to champion tables (M-2).
5. "In progress" after 24 h is correctable: accept for ordinary games; for the final only with the B1 confirm.
6. Leftover covers every row: agree; but it never triggers on weekend events (B2).
7. Unlisted game removes the correction: agree, after two reads (M-4).
8. Any other member, including the lot's buyer, may confirm: accept. The buyer is the one who loses half the lot, so he is the right person to ask. Two colluding people cannot be stopped by any rule. Fix B3 first.
9. Disabled buttons without opacity: fine, pending the UI pass.

## Open items
- CFP season cut-over after January 31: leave, low risk.
- Watch against the real database: fine at this scale; measure after deploy.
- Real sources need `endTime()`: until then no correction there, which is the safe side.

## To-do for the owner
1. Upgrade The Odds API plan if the app sells (this build spends no credits).
