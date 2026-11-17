# Golf v1.3 review, round 4

Repo /home/claude/calcutta-golf, branch golf-v1, commit 584be99 (on 2fa88eb).
Independent, read-only. Work done in a clone at /tmp/revgolf4/repo. Nov 17 2026.

## Verdict for a LIVE deploy with real pots: SHIP AFTER FIXES

Scoring and money maths are right to the cent. Handicap rules hold. Every round-3 High is fixed as written.
But the neutral rule itself still has holes. One lets an organizer take a pot alone (C1). Two more need only one helper (H1, H2).

Blocks a live deploy with real pots: C1, H1, H2, H3.
Blocks Enterprise only: H4. Should go in the same pass: M1 (course pick), M2.

---

## CRITICAL

### C1. An organizer who plays as a typed-in guest is "not playing" and acts alone
The rule looks only at whether the organizer's ACCOUNT is on a team.
Repro (/tmp/revgolf4/t/qa1.js, case A4), $10 stroke play:
1. Ann creates the game, stays off every team, adds guest "Ann S" on Team 1 and keeps that card. Bob is Team 2, Cat Team 3. All paid. Start.
2. Cards entered and confirmed. Bob leads.
3. Ann sends `score` on Team 2 holes 1 to 8 with 15s. Every answer is 200. Eight CONFIRMED holes changed, no signature.
4. Ann `final`: 200. Team 1 ("Ann S") is 1st and takes the $30.
Also alone: `withdraw` on a leader with 17 holes (200), `paid` false on a rival mid-round (200).
Bob only gets a notice afterwards: "Ann (organizer, not playing): change Team 2 hole 1...".
Fix: an organizer who scores for a team, or who added a guest that plays, counts as interested for that team (use `teamSide`, not `players.includes`). And even a truly neutral organizer should need the affected team's signature to change a confirmed hole, withdraw a team or un-pay a player whenever that team has an account.

## HIGH

### H1. Organizer plus ONE helper on another team rewrite a third team's card
The signer only has to be "not on the actor's team". The victim never agrees.
Repro (qa1.js A2): Ann T1, Bob T2 (leader), Cat T3 (helper). All confirmed.
1. Ann `score` Team 2 holes 1,2,3,5,...,10 with 15: each 202 "needs Bob or Cat".
2. Cat `sign` each: 200.
3. Ann `final`: 200. Ann 1st, $30. Bob tapped nothing.
Same pair can mark Bob "not paid" (pool test qa4.js: Bob signs "mark Cat not paid", 200) and mark a short card "did not finish".
Variant A3: before Bob's holes are confirmed, Ann overwrites 8 of them (no `rev` sent, 200 each) and Cat confirms them.
Fix: a change to team X's confirmed hole, standing or paid mark needs team X's own signature when X has an account. A third party signs only when X has none. An organizer's `score` on another team's entered hole must send `rev` and be refused when it differs.

### H2. One and done pool: playing organizer types the prize money and ends the season alone
`oadmoney` and `endseason` do not go through the function set at all.
Repro (qa4.js): $10 pool, Ann (organizer, entrant) and Bob. After the event Ann sends `oadmoney` with her golfer $5,000,000 and Bob's $0: 200. `endseason`: 200. Bob gets no notice (unseen 0).
Fix: route both through `propose` (new ACT kinds), with a notice.

### H3. Guests-only money game: the organizer finishes, reopens and rewrites alone
Repro (qa2.js B1): Ann plus two typed-in guests, $10. Forced Final alone: 200. Reopen alone: 200. Ann changes her own 18 holes to 2s, forced Final again: 200, Ann 1st, $30. Only the log shows it.
Assessment: "never confirmed" on the board is not enough where money is shown. The guests cannot see the app at all.
Recommend: with money on, allow the first forced Final alone, but after it no reopen and no score change (closed for good), and print "Scores kept by the organizer only" on the board and payouts. Or require one other account before a money game can start.

### H4. Enterprise with no fee in the app: a playing director finishes alone
`finalBlock` looks at money shown, not at "Enterprise".
Repro (qa3.js E): club directs and plays T1, entry 0. Director's 18 holes unconfirmed, Bob has 5 of 18. `final`: 200, director 1st.
Fix: use `stakes(c)` (money or Enterprise) in `finalBlock` for both the short-card check and the unconfirmed check.

## MEDIUM

### M1. Course picker: the button that selects a course is hidden (the owner's "no way to select or save")
This branch still has it, at 360 and 430.
A course with two or more tees opens with only tee rows that say "Show holes ›". No select button on screen.
After tapping a tee, "Play the White tees" sits under 18 hole rows at y = 1326, below the fold (740 and 900 high screens).
It does work once found: returns to set-up with the course filled in, and the created game keeps it.
Screens: /tmp/revgolf4/cs/360_05_detail_complete_first_view.png, 360_06_detail_tee_open.png.
Fix: put "Use these tees" as a primary button on every tee card, above "Show holes". Keep a sticky one when holes are open.
Incomplete data: a single-tee course opens expanded with "Check the holes, then play..." and saves fine. A tee with 10 holes only: holes 11 to 18 are pre-filled par 4, index 11 to 18, and "Save and use this course" accepts them untouched. Mark those rows "not on file" and make the user confirm.

### M2. A joined-only account freezes a small money game
Repro (qa2.js B2): Ann v a guest, $10, and Zed joined but is on no team. Nobody can confirm (403), forced Final refused (409 "cannot cover your own side"), Zed cannot leave after Start (409). The game can never finish. Way out today: name Zed co-organizer, then he confirms. Nobody would guess that.
Fix: count only accounts that can sign in `gated`/`finalBlock` (`signers().length`), not every account in the game.

### M3. A request can be pushed out by someone else
- Same hole: Ann's request on Team 2 hole 1 replaces Bob's own waiting request for that hole (key has no author). Bob's is gone, no notice.
- 46 requests by Ann pushed Bob's older one off the list (cap 40). 404 "no longer waiting".
Fix: key by author too; cap per person; tell the author when a request is dropped.

### M4. The signer does not see the whole change
- Set-up: text is only "change the rules of the game: the side games". No old and new values (skins $5 to $500 reads the same).
- Hole: "change Team 2 hole 4 (confirmed) to 7". The old score is not shown.
- Not listed at all: match percent, "off the low player", the course when another rule changed with it.
The request itself is pinned (signing number n signs exactly what was stored; a replaced one answers 404; a hole that moved answers 409). Only the wording is thin.
Fix: "skins $5 → $500", "hole 4: 4 → 7".

### M5. Organizer names and removes co-organizers freely during play
Removing Bob as co-organizer mid-round made him a valid signer at once (qa2.js B7). Not a new hole by itself (see H1), but it should be logged in the actions list and announced.

### M6. Still open from the other session's list (see table below)
Finished pick six shows nothing when the feed is gone; one and done keeps the first "final" reading; nobody can be removed from a game; reopening the app with no signal shows no card; 9-hole double rounding; skins vanish on withdrawal.

## LOW
- L1. Own-team dispute answers "You can't confirm a card..." (wrong word).
- L2. Forced-Final request text counts unconfirmed holes at the time of asking; shown number can be stale when signed (checks are re-run, so safe).
- L3. Stale tier request stays on the waiting list after picks exist (expires only when someone taps Sign).
- L4. groups.test.js still flaky: 5 of 10 failed (not golf code).
- L5. An organizer who is on no team but owns a lot in a linked Calcutta is treated as neutral. Read from code only, not run.
- L6. A second account of the organizer on another team is a valid signer. Cannot be solved in golf; say so in the rules text.

---

## The other session's list (older 2fa88eb): is it fixed in 584be99?
1. B1 playing organizer disputes and re-settles a rival's confirmed hole alone: FIXED (403 for the one who raised it; a settle is 202). Not fixed for the guest-playing organizer (C1).
2. B2 organizer + partner overwrite and confirm the other team's card: FIXED for a partner. Still open with a helper on another team (H1).
3. H1 self-typed handicap, money match added later: FIXED (number goes back to "asked", Start refused).
4. H2 leader marked "not paid" mid-round silently: FIXED (202, signature, history, notice). Open through C1 and H1.
5. H3 finished confirmed leader marked "did not finish": FIXED (409 complete card, for everyone).
6. H4 reopening the app with no signal loses the scorecard: NOT FIXED. Queued scores are kept on the phone, but the game is not cached, so no card shows until signal returns.
7. H5 finished pick six depends on ESPN forever: NOT FIXED. Nothing is stored at the end; feed down 30 days later = empty board.
8. H6 one and done stores a bad first "final" reading: NOT FIXED. Stored once, never re-read. Only the organizer's `oadmoney` changes it (H2).
9. H7 nobody can be removed from a game: NOT FIXED. No remove route; a player cannot leave after Start (causes M2).
10. "Busy" with ten groups writing: FIXED. 60 saves at once, 30 to 80 ms store: 60 of 60 saved, on one instance and on two.
11. "Side games" tab overflow under 416 px: FIXED (two rows of two; no sideways scroll at 360).
12. 9-hole handicap off by one (double rounding): NOT FIXED. `courseHcp` rounds the 18-hole number, `playHcp` halves and rounds again.
13. Skins vanish when a team withdraws: NOT FIXED. A withdrawn team is dropped from skins, so skins it had won go to others.

## Does the neutral rule work WITHOUT the stats module?
Yes. Run with stats absent (NOSTATS=1 qa3.js): identical answers. Own number only asked; organizer's number needs another team; organizer's set needs a signature; un-assign trick demoted at Start; money match later demotes; flights and net money refuse Start with no numbers; casual plays off 0 with the note.
One limit: an Enterprise NET tournament cannot start without stats (director's number answers 503 on signing). Gross Enterprise days work. For "Golf alone" either hide Enterprise net, or let the director's number be stored in golf until stats arrives.
C1, H1 to H4 are the same with or without stats.

---

## What I verified
- Round-3 Highs: H1, H2 (partner), H3, H4, H5 and M1 to M5, M8 to M10 fixed. M6 fixed (tabs). M7 contrast: walk reports none.
- Every POST route read. Outside the function set: `oadmoney`, `endseason` (H2), `co`, `scorer` (M5), plain `final` in a no-money Enterprise day (H4). Everything else that moves money goes through `propose` / `signAct`.
- Fallbacks: two-team game, the other side signs; every other team has an organizer, one of them signs; joined-only account cannot sign (403); partner cannot sign; signer cannot be the asker; a player cannot sign his own handicap while anyone else can.
- Signature pins the change: old number answers 404, moved hole 409 and dropped. Race of two signers, a take-back and a new ask together: one 200, two 404, new ask 202, nothing lost.
- Handicaps: nobody sets their own in Enterprise, flights or net money; Start blocked until every number exists; never 0 by default there; money match after Start refused on a non-strict net game; playing director's own number needs a signature.
- Real stats.js and ratings.js at a07ab04 (copy): typed-in guest, a joined-only co-organizer who "confirmed", another account with nothing confirmed, a signer with no card of his own, ONE helper for 6 rounds: all give use = null. Three different accounts give a number (that is three helpers).
- Scoring and money by hand (previous reviewer's own arithmetic, re-run here): scramble net with take, skins and CTP; four-ball net with Nassau and a press; 9-hole Stableford with a tie and an unpaid player; four flight set-ups. All match. 20,000 random payout tables: 0 cents off. 40 random finished games: 0 off.
- Calcutta against the real calcutta.js at ccf62a7: 5 checks, 10 of 10 (`endTime`, `organizer`, `teams(calc,{viewer})`, `started` that throws). `/golf/gjoin` covered by the round-3 suite. `OddJoin.openGame` is in the client; not driven in a browser.
- Race: 60 saves at once, no lost update. Median 3.5 s, last one 6.9 s. Acceptable for launch because the phone shows the entry at once and queues; not good for a 500-player day (one row per team card next).
- Suites x10: golf.test 10/10, golf.round3 10/10, golf.calcutta 10/10, golf.stats 10/10, alert 10/10, cfbd 10/10, groups 5/10.
- Screens: the coder's 46-screen walk at 360, 430, 1280 in navy, violet-light, violet-dark: 0 problems, 0 page errors (I read its measuring code: sideways, 44 px, banner, contrast, junk text). My own course flow at 360 and 430: no sideways scroll, no page errors, no "lock" wording.

## Usability
- Waiting card is clear: who asked, what, who can sign, Sign it / Turn it down, badge on My golf. Add old → new values (M4).
- One signature per handicap is too much for eight players (up to 7 taps by signers, one at a time). Recommend "Sign all handicaps (7)" on the waiting card, listing each number.

## Could not verify
Anything live (Supabase, sign-in, ESPN, OpenGolfAPI, push, real phones). `SEEN` across two instances. The merged client file. Banner open state.

## Coder's own decisions
- Guests-only game finishes alone: tighten for money (H3).
- Notices in-app only: fine for launch.
- Complete card can never be withdrawn: keep.
- Final pool: nobody marked not paid: keep.
- Every press is an offer: keep.
- Write queue, 503 instead of Busy: keep.
- "final"/"closed" wording: done, keep.

## Proof nothing was changed
Printed at the end of the run (see the reviewer's message). Scripts: /tmp/revgolf4/t (qa1 to qa4, q5, q6, course.py, r3/). Screens: /tmp/revgolf4/shots, /tmp/revgolf4/cs.
