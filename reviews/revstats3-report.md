# Player stats v1.1: independent review (reviewer 3)

Reviewed: /home/claude/calcutta-stats, branch stats-v1, commit e214bcf on top of c084625. Cloned to /tmp/rev3/repo, read-only. Nov 16 2026.
Scripts: /tmp/rev3/w (a1.js to a5.js, hand.js, whs.py, whs_cmp.js, shots/). Screenshots: /tmp/rev3/sw_<theme>_<width>/.

## Verdict for a LIVE deploy: SHIP AFTER FIXES

The v1.1 fixes are real and hold. The handicap maths is right. Money totals reconcile. Privacy held on every route.
Three things must be fixed first (High 1 to 3). High 1 is the hole the coder flagged himself; it is wide enough to decide a money game.

## Defects

### High

**H1. One friend can set any money-game handicap in minutes.**
Repro (a2.js, D2): Ann types three rounds of 130, makes a confirm link for each, Bob taps Confirm three times.
- handicapFor(Ann) with no options (the money-game default) returns use 49.9, text "49.9 · 3 of 3 rounds confirmed", needsSet false.
- Course handicap on 71.2 / 128 / par 72: 56 strokes.
- 27 more rounds were confirmed in the same 10 minutes before the rate limit stopped it.
- A second phone number of the same person works just as well; the server only checks the confirmer is a different account.
- Player with 20 engine-scored rounds (use 11.3): 20 friend-confirmed 130s, all dated today, move use to 16.3. The hard cap holds him to +5.0, which is still 5 strokes.
Limits that exist today: one confirmer per entry, own entry refused, 60 writes per 10 minutes, Rating/Slope/score ranges, caps once 20 confirmed rounds exist, 3-round minimum. Nothing limits who confirms or how often.
Suggested guard (smallest change that closes it):
1. Friend-confirmed typed rounds count toward the money-game index only when at least 3 different accounts have confirmed among the rounds used, and no single account confirms more than 2 of the last 20.
2. A typed round can be confirmed only if it was entered within 7 days of its date.
3. Until a player has 3 engine-scored rounds, the money-game number stays "organizer sets it" (the E-H path that already exists).
4. Show the organizer the make-up next to the number: "12.6 · 4 scored in games, 3 confirmed by 1 player".

**H2. Typing in Post a round or Log a pickleball match is wiped when the guest list arrives.**
Repro (shots/wipe.py, guest list delayed 1.5 s): open My handicap, Post a round, type "Cedar Ridge" and total 86. When /stats/guest/list answers, the form redraws and both fields are empty. Same for the pickleball opponent.
Cause: pics/stats.js line 37 `fetchInto` (and line 36 `load`) call paint() without readForm(). On a cold Render start the delay is seconds, so real users will hit it. It also made the coder's own phone script fail 3 of my 9 runs ("Enter the course").
Present in c084625 too; the earlier review missed it.
Fix: call readForm() before paint() in fetchInto and load.

**H3. A forfeit or an engine-marked unconfirmed match still moves the seeding rating.**
Repro (a2.js, F): five events-engine matches carrying extra.confirmed:false and "Forfeit" give ratingFor use 1573, 5 of 5 confirmed.
Cause: stats.js isConfirmed treats every engine record that is not solo as confirmed.
The preview branch already has the one-line fix (commit 343c1d8). It is not in e214bcf; port it before this ships.

### Medium

**M1. The repeat-opponent guard uses the typed date.** Ann logs 12 losses to Bob in one sitting, each dated 8 days apart, Bob confirms each. Bob's seeding rating: 1626. Same 12 all dated today: 1530. Fix: weight by entry time, or by the later of entry time and date.

**M2. "No dates before the account" can be bypassed, and blocks honest new players.**
- The account age falls back to the oldest bet id or daily-log day in the player's own synced row, which the phone writes. A bet with id b1400000000001 made a new account's first day 2014; a round dated 2015-06-01 was accepted. A daily-log key 2016-01-01 did the same.
- A brand-new account with no bets cannot log yesterday's round ("before your Oddable account existed (today)").
Fix: stamp the sign-up time in acct.js (the coder's own note) and use only that.

**M3. Doubles: the confirmer picks his own side.** Ann logs a doubles win over Bob / Cy. Bob confirms with `as: "partner"`. Bob's stats now hold a confirmed WIN "Doubles vs Bob / Cy", seeding 1516. Fix: take the side from the names on the entry, or drop `as` and always mirror as opponent unless the logger named the partner.

**M4. Tournament log: a player can read another player's lines if the names match.** Two accounts both named "Sam Smith" in one tournament: /stats/event/log for the first returns both players' lines, with the other's reason and number. Names are self-chosen and can be changed any time (/acct/myname), so this can be done on purpose before the director sets a number. Cause: the player view filters `l.player === s.name`. Fix: store the player key on each log line (never send it out) and filter on that.

**M5. The par + 5 cap is skipped by typing a total.** Three typed totals of 200 (Rating 71.2, Slope 128) give differential 113.7 and index 54.0. The same score hole by hole is cut to 162. Also, a player who already has an index but leaves stroke indexes blank gets par + 5 (162) where net double bogey would give 118. Fix: cap a typed total at par + 5 per hole, and at par + 2 per hole plus the course handicap once an index exists.

**M6. Confirm link: no expiry, and not strictly single use.**
- A link still confirmed 400 days later.
- Five parallel /stats/confirm/link calls gave five live links for one match. Five accounts each confirmed; each got a confirmed win in its own stats.
- If the logger deletes the entry after the confirm, the confirmer keeps the confirmed win.
Fix: expire after 14 days; create the link inside the queued row write; key the confirm on the entry, not the link row.

**M7. A null handicap turns into 0 strokes if an engine passes it straight on.** With fewer than 3 confirmed rounds, `use` is null and courseHandicap is null (correct). But ratings.strokesOnHole(null, si) returns 0 and Number(null) is 0. Nothing inside stats does this. Golf was not run against the new default (HANDOFF). Fix: make strokesOnHole throw on a missing handicap, and add a merged-build test: money game, player with needsSet, no number entered, must refuse to start.

**M8. groups.test.js failed 6 of 10 runs** ("race join -> 409 Busy"). HANDOFF says about 1 in 3. Stage-1 groups.js, not a stats file, same on c084625.

### Low

- L1. 9-hole rounds before an index count as the nine doubled (six nines of 45 on 34.0/113: 22.0 each, index 21.0). With the expected-score method the same nine is 23.1. About one stroke kind to the player.
- L2. Edit history keeps 20; the 21st edit drops the original score. The player sees the last 10. Deletes are kept but not shown.
- L3. Fifty parallel edits of one entry all saved, but the revision counter ended at 1 (read outside the queue).
- L4. /stats/event/setup: any Enterprise account can register any unused event id and becomes its director (the real director then gets "Not your tournament"). A start in year 3237 is accepted. The start can be pushed later without limit (each move is logged).
- L5. /stats/consent/set: any player can add himself to any linked course's list, and the event title he sends shows in the director's event filter (HTML stripped).
- L6. Money rows that do not add up on their own: "Deleted bets" row with entry $0 and net -$206.12; a Nassau where the engine leaves out extra.bets shows entry $20, net -$40 again; a tie with a stake shows "Net: not known"; an engine record that is live and already W or L is counted in the record while its money is open.
- L7. More than 3,000 records: totals include all, the list stops at 3,000, so lifetime totals no longer equal the rows shown.
- L8. Contrast: "Saved" toast is white on green, 1.9:1, every theme. Violet theme primary buttons (Save, Log my play, Get a confirm link, "Yes, that is right") are 2.7:1.
- L9. "Double lock" is still in pics/index.html 8 times (results history; not touched by this commit). WTD / MTD / YTD chips remain.
- L10. ratingFor(key, "golf") quietly answers for pickleball.
- L11. pairingProfile returns the pairing number (`use`) with sharing off. The engine must not print it.
- L12. Stage-1 group contests on this branch carry no entry or prize (only "bets inside"). The merged groups-v1 statsFor sends them.

## Confirmed fixed (each re-tested)

- Claimed guest rows are frozen. After the claim the organizer's add, edit, delete and remove-item change nothing on the claimant's side (409 or ignored). A second claimer gets 409. The organizer cannot claim his own guest. The claimant can remove. Claimed results stay unconfirmed.
- Typed-round limits: Rating 55 to 85, Slope 55 to 155, total 40 to 200, 15 under the Rating refused, future dates refused, bad dates refused.
- 48-hour lock: edit at 47.9 h accepted, edit and delete at 48.1 h refused (409). An edit keeps its entry time and drops the confirmation; the old link then answers 409.
- handicapFor / ratingFor default is strict: `use` is the confirmed number, null under 3 confirmed rounds with needsSet true; only `casual: true` (exactly) gives the full index; a typed number is used only when there is no confirmed index; solo engine rounds, team formats and rounds without a Rating do not count.
- Unconfirmed self-logged matches do not move seeding (10 typed wins: use 1500, full 1631).
- E-H: reason required (blank refused); no override before lockAt; lockAt in the past or earlier refused; later accepted and logged; everything refused after the start; Enterprise re-checked on every call (switched off: 403); a second Enterprise account, a player and the owner are refused; "by" and player names come from the accounts (sent text ignored); the lifetime index is untouched; handicapFor returns the tournament number and the real Oddable number together; My handicap shows both with the log.
- /stats/event/log: director sees all, a player with a number sees his lines (but see M4), everyone else 404, signed out 401.
- One consent store: the prompt and the director's list agree; revoking empties the list, the old player id and the rounds; a sent name is ignored.
- Money: the group contest shows entry $25, prize $9, net -$16, bets inside listed but not totalled. Nassau with extra.bets: entry $60, net -$40. A won bet with no price: "Net: not known", never -110.
- Write queue: 50 parallel saves, 50 of 50 stored. 50 parallel confirms by 5 accounts: one winner. 50 parallel claims: one winner.
- Bottom bar: exactly five buttons (Games, Live, My Bets, Groups, More) at 360, 430 and 1280 wide in all three themes: 70x48, 84x48 and 87x70. More sheet rows 57 high, Close 46x44, outside tap closes, no sideways scroll, banner touches nothing.
- No DUPR, USGA, GHIN or "unofficial" on any stats screen.

## Handicap maths

An independent re-implementation (whs.py) matched ratings.js on 600 random histories (1 to 60 rounds, 9- and 18-hole, gaps, low and high outliers): 0 mismatches in every index along the way.
Worked by hand (hand.js), all correct:
- Soft and hard cap. 20 rounds of 82 on 72.0/113 (index 10.0, Low Index 10.0), then rounds of 100. After 13: 12.3, no cap. After 14: raw 14.5, soft cap 13.8. After 15: raw 16.8, 14.9. After 16: raw 19.0, hard cap 15.0. Stays 15.0.
- Exceptional score. Index 10.0, then a 73 (differential 1.0, 9.0 under): 1.0 off the last 20, index 7.9. Then a 62 (-10.0, 17.9 under): 2.0 more off, index 3.5. The next round carries no reduction. Boundaries 6.9 / 7.0 / 9.9 / 10.0 give 0 / -1 / -1 / -2.
- Fewer than 20. 15.3, 15.2, 16.6 gives 13.2 (the rule book's example). Rounds 4 to 20 checked one by one against the table.
- Low Index window. A Low Index of 5.0 caps a rise to 9.0; a round 430 days later has no Low Index in its 365 days and is not capped (10.0).
- Confirmed-only index: no cap until 20 confirmed rounds, then the same caps.
- par + 5: 18 holes of 12 on par 4s count 162 with no index; 118 with a course handicap of 10 and stroke indexes.

9-hole expected score (0.52 x index + 1.2):
- The USGA FAQ example is index 14.0, 9-hole score 41, 9-hole differential 7.2, 18-hole differential 15.7. The code returns exactly that (expected 8.5).
- The USGA page publishes no table or formula. It says the expected score is the average differential for a player of that index and does not change with the course.
- The line is not from the USGA. A golf forum post gives the same formula, and a table rebuilt from a third-party site for index 0 to 18 matches it to 0.1 at every whole index.
- Drift: none seen from 0 to 18. Above 18, below 0 and near 54 there is nothing public to check against; treat it as unknown there (the code gives 14.2 at 25, 19.9 at 36, 29.3 at 54, -1.4 at +5).
- Before an index exists the USGA holds the nines until 54 holes and then gives each an 18-hole differential. The code doubles the nine instead (L1).
Sources: usga.org .../2024-revision/2024-treatment-of-9-hole-scores-FAQ.html ; forums.golfmonthly.com/threads/9-hole-ch-calculation.116362

## S-ALL reconciliation

2,490 random mixed records (1,050 bets with deleted-bet days, 200 Calcutta, 600 golf, 500 events, 100 group contests, 40 self-logged; open, live, no-price, Nassau, place-only).
For week, month, year and lifetime: overall = sum of sports = sum of game types = sum of the rows, and each sport = its game types = its rows, on plays, W, L, net, risked, at stake, open count and "not known". 0 mismatches.
With 3,092 records the only mismatch is the 3,000-row cut (L7).

## Privacy

Every route called as owner of the data, another player, a director, the owner and signed out; all responses scanned for account ids, sync ids, member keys, row keys and tokens: nothing found.
Other people's entries, guests, confirm links, course views and logs: 404 or 403. Confirm link shows the logger's name, course, tees, date, score and nothing else; it needs sign-in. courseMembers refuses a non-director. pairingProfile hides text, index and lifetime with sharing off. HTML in course, tees, notes and guest names is stripped.

## Tests, 10 runs each

- stats.test.js: 10 of 10.
- stats-fixes.test.js: 10 of 10.
- alert.test.js: 10 of 10. cfbd.test.js: 10 of 10.
- groups.test.js: 4 of 10 (M8).
- The coder's phone script (31 checks): 31 of 31 at 360, 430 and 1280 in navy. In violet, 3 of 6 runs stopped at check 18 because of H2.

## Screens

Nine runs: 360x740, 430x900, 1280x800 in navy, violet light, violet dark. About 40 screens each.
No page errors. No sideways scroll or wide element. No tap target under 44. The overlay covers the banner; the banner covers no button. No "undefined", "NaN", developer words or banned names. Contrast failures are L8 only. Drill-downs and Back worked on every path the script takes.

## Could not verify

- Anything live: Supabase, real tokens, Render, the real sign-up path.
- The merged build: golf.js and events.js against the new strict default (M7 is from reading, not a run).
- Which bottom-bar button is lit after a More choice: the sandbox has no game feed and the bar does not redraw there.
- The first reviewer's exact defect list (lost). "Confirmed fixed" is measured against the commit message and HANDOFF.
- Table headers over their columns were looked at on screenshots, not measured.
- Voice logging with a real key.

## The coder's own decisions

- "Net: not known" for a won bet with no price: keep. It follows D7. Fix the owner dashboard (-110 in sync.js) so the two agree.
- One money rule for contests (entry and prize on the contest, bets counted under Bets): keep. It reconciles.
- Five-button bar with a More sheet: keep. Note the merged preview bar has a Play button; decide where Play goes before merging.
- 0.52 x index + 1.2: keep, and say on the info sheet that it is an estimate. Replace the doubling before an index (L1).
- Account age from the oldest bet: replace with a sign-up stamp (M2).
- Confirm by link with one confirmer: keep the flow, add the guard in H1 and the expiry in M6.
- 7-day repeat-opponent guard: keep, but on entry time (M1).
- par + 5 when stroke indexes are missing: acceptable before an index; use the M5 cap after.
- Queued writes per row: keep. Move the revision bump inside the queue (L3).

## New since the task was written

- H2 and M8 were found outside the listed attack areas.
- The preview branch has moved on (50a3ae2) and already carries the H3 fix; nothing else from this review was checked there.
