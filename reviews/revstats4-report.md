# Player stats v1.2: independent review (reviewer 4)

Reviewed: /home/claude/calcutta-stats, branch stats-v1, commits 99f409a, 809f8f0, a07ab04 on top of e214bcf. Cloned to /tmp/rev4/repo, read-only. Nov 16-17 2026.
Scripts: /tmp/rev4/w (rule1.js, rule2.js, rule3.js, link.js, r3fix.js, whs4.py, whs_cmp.js, course.py) and /tmp/rev4/w3 (round-3 scripts re-pointed). Screens: /tmp/rev4/shots9, /tmp/rev4/w/shots.

## Verdict for a LIVE deploy: SHIP AFTER FIXES

The round-3 fixes are real and hold. Handicap maths is right. Money totals reconcile. No account id, key or token left the server.

Blocks a live deploy:
- **H1**: three throwaway accounts set any money-game handicap in minutes.
- **H2**: a course with no tee data is a dead end in Post a round (the owner's "no way to select or save it").

Fix in the same pass: **H3** (the per-confirmer limits are beaten by filler entries).

Nothing on this branch plays a money game off the number yet (no golf engine here, and golf-v1 sends no `card`). H1 and H3 must be closed before the golf merge uses `handicapFor` for money.

## The cheapest way to get a chosen number

### One person, one account: not possible
- 5 typed rounds: `use` null, "needs 3 confirmed rounds (0 so far)". Casual index 34.3 only with `casual: true`.
- Claiming my own player row: 400. Confirming my own entry: 400.
- Sending `confirmedBy`, `card`, `confirmed`, `src: 'golf'` in the save: all dropped.
- What is left is asking the organizer for a number. It shows as set by the organizer.

### One friend: blocked for a new player, +5.0 for an established one
- New player, 6 rounds confirmed by the friend: 2 count, 1 confirmer, `use` null.
- Established player (20 honest game rounds, 3 markers, index 9.5), friend confirms 130s by link:
  - 40 entries, 13 min: 9.8
  - 100 entries, 33 min: 11.2
  - 140 entries, 47 min: 14.5 (hard cap: Low Index 9.5 + 5.0)
  - 200 entries, 67 min: `use` null (the friend is now 20 of 20, one confirmer)
- So one friend adds 5 strokes in under an hour while 2 old honest markers are still in the last 20. This is H3.
- Visible: the make-up reads "Bob: 14" and "confirmed by link". An organizer who reads it will see it.
- Rating (pickleball): 45 link wins against one friend in a sitting: 2 count, then nothing. 10 a day for 30 days: `use` null. Well guarded.

### Three throwaway accounts: any number, minutes, no cap
Repro (rule1.js): Ann signs up today. T1, T2, T3 sign up today (phone and PIN, no text-message check). Ann adds each as a player, each claims. Ann types three rounds of 200 dated today, one confirmed by each. Everything from one IP address.
- 15 requests. `use` 54.0, `needsSet` false. Course handicap on 71.2 / 128 / par 72: **60 strokes**.
- Three 98s give 21.7. Three 57s give +10.0 (shown -10). Any number in between by picking the score.
- Caps: none apply. Soft and hard cap need 20 confirmed rounds and a Low Index. Exceptional score only lowers. There is no floor and no ceiling for a new account except 54.0 and +10.0. The typed total is cut to par + 5 a hole (162), which still gives 54.0.
- Established account with three throwaways: held to Low Index + 5.0 by the hard cap, same as the one-friend route.
- Visible: "3 typed totals confirmed by link · confirmed by 3 players", then T3: 1, T2: 1, T1: 1 and three rows "Typed total, confirmed by link", all the same date. It does not show that the three confirmers joined today, that everything was logged in ten minutes, or that it all came from one address. With ordinary-looking names it reads as a normal new member.
- Rating: 3 throwaways, 2 wins each: seed 1566. 10 throwaways: 1678. Minutes.

## Defects

### High

**H1. Three throwaway accounts set any money-game handicap (above).**
Suggested fix, smallest first:
1. A confirmer counts toward "3 different players" only if their account is at least 30 days old on the server sign-up stamp (accounts with no stamp count as old). Say so in `why`: "confirmed by players who joined less than 30 days ago".
2. Until a player has 8 confirmed rounds, return the number as provisional: `use` stays null / `needsSet` true, with `suggest: 21.7` and the make-up, so the organizer taps to accept it or types another. Never auto-apply a number built from 3 to 7 rounds.
3. At most 1 link-confirmed round counts per date played.
4. Add to the make-up: each confirmer's "joined" date, "all rounds logged on one day", and a plain warning line when any of these is true.

**H2. A course with no tee data is a dead end.**
Repro (course.py, 360x740 and 430x900): Post a round, type "Cedar", Search courses, tap a course whose detail has no tees and no holes. The card shows the course name, "Pick your tees:" and nothing to tap. The Course field still says "Cedar". No Use button, no Back to results. Screenshot /tmp/rev4/w/shots/c360_4_no_tees.png. Same in the calculator.
Cause: pics/stats.js `csList` treats `c.tees` as a tee list even when it is empty; `cpick` never puts the name in the form.
Fix: on `cpick` fill the course name at once. With no tees show "No ratings on file for this course. Enter Rating and Slope from the scorecard." and a "Use this course" button. Add "Back to results" on the tee step.
Could not check how often the live course list returns no tees.

**H3. The per-confirmer limits are beaten by filler entries.**
`confirmMarks` counts "2 of 20" and "8 of 20" over the last 19 confirmable entries, and a rejected entry still takes a place in that window. So one confirmer ends up with 14, 18, then 20 of the 20 rounds that actually make the index (one-friend route above).
Fix: apply the limit to the counting set. Keep only each confirmer's newest 2 link rounds and newest 8 game rounds among the last 20 confirmed; drop the rest; rejected entries never enter the window. Nothing freezes, because a newer round from the same confirmer replaces their older one.

### Medium

**M1. Course flow: nothing says the course was taken, and it is not kept.**
With tees the flow works: search, 25 results, "Show more courses (25 of 40)" to 40, tees with Rating / Slope / yards, tap a tee, form filled (course, tees, 71.3, 125, 72), Save, round stored. But:
- After the tee tap the list just disappears. No "Cedar Ridge · Blue tees set" line, no Change.
- A tee with no Rating / Slope fills the name and leaves Rating and Slope empty without a word.
- The saved round has no `courseId` (`ctee` passes an empty id), so "Rounds here" in the course view matches by name only.
- The next Post a round starts empty. No recent courses.
- Calculator: the pick survives leaving the page and coming back, and is lost on app reload.
Fix: a confirmation line with Change; pass the course id; remember the last 5 courses with tees on the server and offer them first.

**M2. One person counts as two confirmers for a rating.**
An event opponent is `e:<hash>`, a link confirmer `a:<hash>`. One friend who played Ann in an event and confirmed one link shows as 2 confirmers (r3fix.js). A third key (a doubles pairing) would make 3. HANDOFF flags it. Fix at the merge: events sends `card.by = stats.acctRef(account)`.

**M3. Confirmers' names go to people they never agreed to.**
The make-up (`who`, `byName`) is shown to the player, to the director of a course the player shares with, and to any organizer through `handicapFor`. The confirm sheet does not say so. Names only; no keys. Fix: one line on the confirm sheet: "Your name is shown to organizers next to this round."

**M4. Accounts older than the sign-up stamp start "today".**
An account with no stamp (every account that exists now, unless the table has a created column) gets `since` = first use. A round dated 10 days back is marked `preAcct` and can never be confirmed. Harmless on day one; say it on the form, or backfill the stamp at deploy.

### Low
- L1. A confirm link can be re-made and used months later, as long as the entry was logged within 7 days of play. Matches the written rule; noted.
- L2. A signed-in stranger holding a link sees the logger's name, course, date and score (cannot confirm). Same as review 3.
- L3. The phone script timed out once in 11 runs (violet 360, waiting on the golf-day prefill); 2 of 2 clean on a fresh harness.
- L4. groups.test.js failed 2 of 10 (stage-1 groups, not a stats file).
- L5. "Double lock" still on 8 lines of pics/index.html (left for the merge, per HANDOFF).
- L6. Throwaway sign-up cost was not tested (acct.js / My Apps trial rules are outside this branch).

## Is the rule good enough for real-money club games?

As an automatic number: no. As a number the organizer reads and approves: yes, after H1 and H3.
- It stops the round-3 attack (one friend, new player) completely.
- It does not stop made-up accounts, and a new account has no cap at all.
- Two real friends colluding cannot be stopped in the app; the hard cap holds an established player to 5 strokes a year, and the make-up names them.
- Organizers setting numbers themselves is the real safeguard. Make the screen say "provisional" loudly when the number is young.

### Combined cap (8 game + 2 link by one person)
Tested: 12 honest 84s, then one person confirms 8 game 120s and 2 link 120s. Make-up "B: 10". Index stays 11.3, because 10 honest rounds remain and the best 8 are all honest.
- Raising an index needs 13 or more bad rounds in the 20. One person at 10 cannot do it.
- Lowering needs only 8, and 8 is already allowed.
- So 8 + 2 separately is acceptable, once H3 makes the limits real. A combined cap of 8 on the counting set is tidier and costs honest groups nothing; recommended, not required.

### Link-confirmed matches with no hard per-pair 24-hour cap
Not a problem. Link matches are held harder than game matches: 2 of 20 per confirmer, and the rating weights (2 rated per pair per 24 hours, halving inside 7 days) are worked out on the confirmed games, link ones included. 45 wins in one sitting moved nothing after the second. No change needed.

### Too strict for honest groups?
- **Regular foursome, hole by hole in games, markers rotate**: 30 of 30 count, index 12.6. Fine.
- **Regular foursome, same marker every week**: `use` null, "needs rounds confirmed by 3 different players". Two markers: also null. The group must rotate who confirms. Say this on the card screen.
- **Regular foursome by link only, 30 weekly rounds**: 12 of 30 count, index 12.2 against 12.6 on all rounds. Works, on fewer rounds.
- **A couple who only play together**: never get a number, by link or in games. The organizer sets it every time. Acceptable for money; the screen says why.
- **New member with 20 solo rounds**: `use` null, full index shown for casual play, organizer sets the number. Correct: solo rounds should not set a money handicap.
- Today no golf-day round counts at all, because golf-v1 sends no `card`. Until it does, every money-game golf number is organizer-set.

## Round-3 fixes: confirmed
- Forfeits and engine-marked unconfirmed matches: 5 of them give `use` null, seed 1500, 0 confirmed games. Wins against typed guests: 0 confirmed.
- Sign-up stamp: a bet id from 2014 and a daily-log day from 2016 in the phone's own row are ignored. New account: today counts; 1 to 30 days back saved as "before you joined", never confirmed; 31 days back refused.
- `/stats/event/log`: two players named "Sam Smith", each sees only their own line; no key in the answer. The phone route can no longer create a tournament (403).
- Typed totals: 200 with no index counts 162; with course handicap 10 counts 118. At most 5 typed of 20.
- `strokesOnHole` and `courseHandicap` throw on null, undefined, NaN, "" and "10". 0 works. `courseHandicapFor` gives `courseHandicap: null`, `needsSet: true`. `pairingProfile` gives `pairOn: null`. `handicapFor('guest:...')` null. Organizer-typed 0 is used as 0; typed 99 ignored.
- Forms keep typing: Post a round, pickleball and "any other game", all 9 runs.
- Lists: 3,150 records show "Showing 100 of 3,150" with Show more; my 3,092-record set pages to 3,092 unique rows.
- 9-hole rounds before an index use the expected-score method (matches my own code).
- Rating per named game: cornhole has its own; `ratingFor(key, 'golf')` throws.
- Contrast: no filled button or toast under 4.5:1 in any theme.
- Owner dashboard and My stats: a won bet with no price is "not known", left out of P/L, on both. `settledPL` returns `known: false`. No -110.
- Confirm link: 8 requests at once give 1 link; a new link kills the old (409); two players racing one link: one wins; 6 d 23 h 59 min works, 7 d + 1 min is 410; an entry dated 8 days back gets no link; edit or delete removes the confirmer's copy; stranger 403, signed out 401; 10 wrong codes then locked out.

## Handicap maths
My own implementation (whs4.py, updated for the typed-total cap and the 9-hole change) against ratings.js on 800 random histories (1 to 60 rounds, 9 and 18 holes, gaps, outliers): 0 mismatches at every step. 111 histories ended on the soft cap, 51 on the hard cap, 655 exceptional-score rounds, 1,716 nine-hole rounds in the final windows.

## S-ALL reconciliation
3,092 mixed records. Week, month, year, lifetime: overall = sports = game types = rows, on plays, W, L, net, risked, at stake, open and "not known". 0 mismatches, lifetime checked against the paged list. A record still running is now left out of W-L, so record and money agree.

## Privacy
Every route as owner of the data, another player, director, owner, signed out: no account id, sync id, member key, row key, token or confirmer reference in any answer. Others' entries, guests, links, course views, logs: 403 or 404. Who sees who confirmed whose rounds: the player; a course director for players who share with that course; a money-game organizer through the engine. Group members and pairing screens do not. See M3.

## Tests, 10 runs each
- stats.test.js 10 of 10. stats-fixes.test.js 10 of 10. stats-r3.test.js 10 of 10 (22 groups).
- alert 10 of 10. cfbd 10 of 10. groups 8 of 10.
- Phone script: 9 runs (360, 430, 1280 in navy, violet light, violet dark), 384 checks, 1 script timeout, 0 problem screens, 0 page errors. No sideways scroll, no target under 44, banner covered, no banned names, no "undefined".

## Could not verify
- Anything live: Supabase, Render, a real sign-up writing the stamp, whether the table has a created column, real course data.
- The merged build: golf.js and events.js against this contract; that a money game refuses to start on `needsSet`.
- The owner's report on the merged preview itself (there the search goes through the golf engine's `/golf/coursedetail`, not this branch's route). The dead end in H2 is in the shared screen code, so it applies to both.
- Bottom bar, drill-downs and headers were covered by the coder's script, not re-measured by hand.

## The coder's own decisions
- "Recorded as having played" = a claimed players-list row: keep. It is the right anchor. It does nothing against made-up accounts (H1).
- Sliding window over confirmable entries: replace (H3).
- 8 game + 2 link counted separately: acceptable; a combined 8 on the counting set is tidier.
- No extra per-pair cap for link matches: keep.
- `ratingFor().use` null until 3 confirmers, `seed` always a number: keep.
- 30 days back before sign-up, never confirmed: keep; backfill stamps (M4).
- Tournament start within 366 days, 5 moves, 14 days slip: keep.
- A money row never shows a loss bigger than its entry: keep; it reconciles.

## Proof nothing was changed
`git -C /home/claude/calcutta-stats status --porcelain`: empty.
`git -C /home/claude/calcutta-stats rev-parse stats-v1`: a07ab040d7244732d74ee064c239bc1499cacbcd
