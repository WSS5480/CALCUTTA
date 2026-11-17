# Review rev253i: release gate for a29edea (v253-parlays, on c72cd6f)

Repo /home/claude/calcutta, branch v253-parlays. Reviewed read-only from a clone in /tmp/rev253i_work/repo.
Date: Mon Nov 16 2026, 12:55 to 14:00 CT.

## Verdict: OK TO DEPLOY TONIGHT (SHIP)

Nothing I found blocks a live deploy.

- The blocking defect of the last review (H1) is fixed, and so is M1.
- My own checker found no rule violation in 1,750 random weeks (730,780 ticks, three seeds). The one thing it flagged is N1 below, a rare chain on a postponed game that can wait a week.
- Published history is untouched: the data dry run shows 0 changes and every parlay result reproduces on a games.csv fetched at 19:31 UTC.
- Both test suites passed 10 of 10. 1,536 screen probes: 0 page errors, 0 sideways scroll, banner covers nothing.

What the manager should know before pressing the button:

- LAC at BAL (week 10, tonight 20:15 ET) is NOT final in nflverse (scores empty at 19:03 and 19:31 UTC). HANDOFF "How to ship" step 1 (run `alert-data.js --write` once it is final) cannot be done before a deploy tonight. That is safe: the server reads the closing line from nflverse itself (re-read every 6 hours). Until then week 11 picks read "early look". Do the `--write` step in a follow-up commit, usually Tuesday morning.
- Deploy before 20:15 ET if you can, so the server stores LAC at BAL's pre-game line itself. Not required.
- None of this has ever run live. See "Residual risk" below for the list.

## What blocks

Nothing.

## Can wait a week

### N1 (Medium): a Lock made final "game postponed: no result" is graded anyway if the game comes back and is played

New with L4. Repro: `REPO=<clone> node /tmp/rev253i_work/xo.js` (real week 11, real model).

1. Lines: CIN at WAS 16.5 (WAS +16.5), TB 1, NYJ 1, PIT -1, MIA 2.5, rest as games.csv. The Lock is WAS +16.5 (Monday night) all Sunday; 12 of 13 games pass their mark.
2. After Sunday night's kickoff ESPN flags CIN at WAS postponed. No game is left, so the Lock goes final: WAS +16.5, flagged off. Correct by L4.
3. ESPN puts the game back for Tuesday. The line is now WAS +13. The game freezes at +13 at its new mark.
4. WAS loses 14-30. The stored Lock is still WAS +16.5, off.
5. The app grades every final game that is not postponed (`trGrade`, pics/index.html line 1624), so this Lock counts as a WIN at +16.5, under a label that says "game postponed: no result". At the game's real line (+13) it lost. If that game also has a road dog, Lock and dog are at different lines.

How often: needs the Lock on the week's last game, a postponement flag, and the game played in the same ESPN week. In my fuzz (a postponement in about a quarter of weeks, most aimed at the Lock's game) 20 off-finals in 1,600 weeks, and the game came back in 14 (played in 11) of them. In real life close to never.

Fix (one of):
- App: do not grade a pick flagged `off` (`trGrade` returns null when the pick is off; same in the Alert and parlay rows). Then "no result" is true. Smallest change.
- Server: when an off Lock's game is back on the schedule before its mark, drop `off` and `final`, carry the Lock live on that game and freeze it at the new mark.

### N2 (Low): screens for an off Lock

Seen in my OFF-final pass (/tmp/rev253i_work/shots/OFF-final_*):
- Lock list sheet and the Results row show "MIA 0–BUF 0" for the postponed game. The Alert box correctly says "postponed". Fix: use the same `g.pp ? 'postponed'` text in the Lock list and Results row.
- Tapping that Lock in the list opens nothing (`lkDetail` returns silently because the postponed game is not in the model pool). No page error. Fix: open the sheet with "game postponed: no result" and no factor table.
- Not new with this commit (a Lock frozen normally whose game is then postponed gets the same screens), but L4 adds a second way in.

### N3 (Low): wording of L1

Live carried Lock with no %: "No model % right now: live pick; confidence updates on the next clean read". "Clean read" is developer language (HANDOFF says so too). Suggested: "No model % right now. This is a live pick; the % comes back at the next check."

### N4 (Low): one way a game can still be left out of the ranking

H1 keeps a late-line game in the ranking at its last in-time number. A game has no such number when its kickoff is moved EARLIER so far that the new mark is before the time its current number was first read (in practice: a kickoff moved to less than an hour away). It is then left out for the rest of the week, with no carry, which is the H1 pattern. In the fuzz, where kickoffs are moved on purpose in a third of weeks: 505 of 177,492 checked clean ticks had such a game. In real life: an NFL kickoff does not move to inside the hour. Fix if wanted: when a kickoff moves earlier past `lt`, keep the number as in-time (it was read while the game was still before its old mark).

### Still open from rev253h (unchanged, listed in HANDOFF)

- L2: a postponed or pick'em #1 keeps the #1 slot. Owner to confirm.
- L3: a held Lock whose kickoff moves later stays held at the old line. I add: this applies to any frozen game, not only a held Lock. A game that froze and is then moved a day keeps its old frozen line for its road dog too.
- L5: tap targets of 40px ("Move the line?", "Back", parlay buttons), 33px ("Back to list"), 25px ("Open full game"); violet light theme contrast 1.45 to 4.08:1 on gold and green text. Same list as before, nothing new. The other three themes pass 4.5:1 in every sheet.
- The Helper has no carry rule.

## Were the rev253h defects fixed?

- H1 (blocking): FIXED. The reviewer's x1.js now prints "RESULT: same Lock" (PIT +7 final in both runs; TB at DET stored `l` 6, `il` 5.5, ranked at 5.5). My checker compares the server's stored in-time number with my own for every game on every tick: 0 differences. On c72cd6f the same checker reports thousands (11,693 in 40 weeks).
- M1: FIXED. x2.js X2 and X2b stay MIA. Through the real tick path (`A.tick()` with a fake ESPN, /tmp/rev253i_work/tk.js):
  - game missing for good, schedule re-read every 5 minutes: Lock carried, moved on at 12 minutes (3 reads spanning 10 minutes), log line "missing on 3 reads";
  - missing from one read: 0 Lock changes;
  - ESPN flag STATUS_POSTPONED: moved on at the next read;
  - ESPN read failing for 20 minutes: nothing counted, 0 changes;
  - restart in the middle of the count: the counter survives (it is in the stored row), moved on at 12 minutes.
- L4: implemented as described. See the next section.
- L1: changed on both sheets (Lock sheet and Move the line); a final one still reads "frozen late". See N3 for the wording.

## L4: is the reading acceptable?

Yes, with one fix later (N1).

- The Lock's game is postponed and a game is still before its mark: the Lock moves on by the ranking. 389 such moves in my fuzz, each onto the ranking's answer, never onto a game past its mark. If only the #1 game is left, it becomes the Lock, which is how I read the owner's "Use that game as Lock"; my checker uses the same fallback and agreed every time.
- No game left: the Lock goes final where it stands, flagged off. I checked each off-final: no game with a usable line was still before its mark. The week keeps a Lock on screen; the record does not count it (Lock record stayed 7-3 in my screens).
- Why this and not the other reading: taking a game that is past its mark breaks D5 and D9, and would often mean picking a game already under way. A Lock with "no result" is the honest outcome. The owner's "never a week without a Lock" is met in name only that week, so tell the owner in one line: "If the Lock's game is postponed after every other game has locked, that week's Lock shows no result."

## Ranking at a stale in-time number: is it ever worse than leaving the game out?

Yes, rarely, and never in a way that puts a stale number on the Lock.

- The Lock itself never takes the in-time number. A late-line game is always past its mark, so it is either out of contention or it is the Lock's own game, which is carried and graded at the frozen (real) line. Fuzz: 123 Locks went final on a game holding a separate in-time number; all were at the frozen line and price, none at the in-time one.
- So the stale number only decides whether that game holds the #1 slot. /tmp/rev253i_work/xv.js, real week 11, eight chains, each run with the server away and never away:
  - a (the x1 chain, late game #3, half a point): same Lock now; different on c72cd6f.
  - b2, c, d, f (late game is #1 and its line fell from 16.5 to 7; late game is the Lock itself; three late games at once; #1 fell from 16.5 to 3 while away since Friday): same Lock.
  - e, worse than leaving out: away 46 hours, TB at DET moved 5.5 to 1.5 unseen. Ranked at 5.5 it keeps the #1 slot, so the Lock ends on PIT +7 (54.06%), which at real lines is the model's #1, not its #2 (NYJ +4, 54.01%). c72cd6f happened to match the control here.
  - b, g: different from the control on both commits. The line move made a 1pm game the Lock in the control, and a server that slept through that mark may not take the game up (D5). No ranking rule can fix that.
- Measured: 120 outage-heavy weeks, same worlds, a29edea against c72cd6f against a server that never sleeps: the two commits ended on the same Lock in all 120; both matched the never-away server in 88. The difference between the two rules shows only in rare chains.
- In the fuzz 1,700 games got an in-time number; 664 of them were 2 points or more off the real line, 94 were more than 24 hours old.
- Acceptable under "the pick can change; if you take early you risk": yes. The Lock is always a game before its mark at its current line and price, or a carried pick flagged late. If the owner wants a cap later: leave a game out when its in-time number is older than, say, 6 hours. Not needed tonight.

A carried Lock can still go final on a team at a line that moved a lot while the server was away (flagged late, "frozen late", no %). 124 of 1,588 finals in my outage-heavy fuzz. Same as rev253h's note; accepted design, and the server pings itself to stay awake.

## What I verified

Own checker and fuzz, /tmp/rev253i_work/ifuzz.js. The world (line moves, prices, book cache, postponements, kickoff moves) is generated up front, independent of the server's ticks; the checker keeps its own record of what the server has read and decides clean / not clean from that.

- Seeds 11 and 29, 800 weeks each: 1,600 weeks, 669,746 ticks, 0 violations. Seed 3: 150 more weeks, 61,034 ticks, 0 violations. Total 1,750 weeks, 730,780 ticks.
- A first pass of seeds 11 and 29 printed 442 lines. All were triaged, then the same 1,600 weeks were re-run clean: 426 "Lock and dog differ" lines = N1 (off Lock whose game came back); 12 "Lock live at week end" = games rescheduled past the end of my simulated week (now counted, not flagged); 4 lines in 2 weeks = my own model missing the server's "book line must be within 36 hours of the kickoff ESPN shows" rule (fixed in the checker).
- The same checker on c72cd6f, 40 weeks: 11,720 violations (27 "Lock changed while its game is only missing", the rest in-time number differences). So it sees both old holes.
- What the 1,600 weeks contained: 14,866 outages, 13,399 restarts, 4,068 book-cache switches, 241,191 line moves (15,928 on the Lock's own game, 16,673 on the top-ranked game), 17,021 moves through zero, 2,973 to pick'em, 343 kickoff moves, 366 postponements (178 flagged by ESPN, 188 only missing; 179 came back), 2,144 feed gaps of one to six reads.
- Source flips, counted on a 100-week sample of seed 11 (42,482 ticks): 4,625 clean ticks with a flip at the SAME number (treated as clean, Lock free to move, not marked late) and 2,988 ticks with a flip and a new number (Lock carried). 0 violations.
- Live Lock on 269,150 ticks; 38,289 of them not clean; carried on 37,062 (the rest: its game was missing or off the schedule). 10,803 Lock changes, every one on a clean tick, none from a game more than 5 minutes past its mark, none onto one.
- Game missing without proof: 3,059 ticks, the Lock identical before and after on each. Proven off the schedule 409 times (83 by flag, 326 by 3 reads over 10 minutes): 389 moves on, 20 off-finals, never left live.
- 1,588 Locks went final (12 weeks ended with the Lock's game rescheduled past the simulated week): each at its game's frozen line and that side's frozen price; 824 flagged late, each one due and none missing; 7 "line at mark unavailable"; 124 with no %.
- Lock and road dog on one game: 309,764 ticks checked, same number and price on all (off Locks aside, N1).
- A final Lock never changed. No week lost its Lock. A game never came back into contention, and none was put out before its mark.
- Stale %: a Lock never showed a % the model does not give that team at that line (stub model weeks, exact).
- Lock ranking with in-time numbers in play: 14,960 clean ticks; on 2,220 of them the #1 slot was held by a late-line game at its in-time number.

Not too sticky:
- 177,492 clean pre-mark ticks: the Lock was my ranking's answer on all of them (my ranking uses the in-time number for late-line games).
- After a carried tick the next clean tick was on the ranking's answer 17,526 times; 13 times there was no rankable candidate.

Reference scripts from rev253h on this commit:
- hfuzz.js seeds 1 and 7: 2,400 weeks, 301,846 ticks. 7 lines, all "Lock made final on a game off the schedule" = L4 (that checker predates it). Ranking check 44,168 ticks, 0 mismatches.
- The coder's fuzz on two seeds it had not seen (4421, 87): 3,000 weeks, 419,830 ticks, 0 violations.

Suites and data:
- alert.test.js 10 of 10, cfbd.test.js 10 of 10. No flakiness.
- `node scripts/alert-data.js games.csv` dry run: trophy-season.json 149 finished games, 0 changes; alert-frozen.json 0 changes. Same on the 19:31 UTC file.
- `node scripts/parlay-check.js games.csv`: all results reproduced (2-game 4-4 +6.50u, 3-game 3-4 +13.67u), on both fetches.
- LAC at BAL: not final (see top).
- v253 markers consistent: sw.js `pics-v253`, `<!-- Pics v253 -->`, header pill, footer, six `?v=253` files in index.html, `gate.js?v=253` in sports.html. `dash.js?v=219` is right (file unchanged).
- Owner routes with the real `acct.ownerOk`: POST /alert 410; /alert/fix and /alert/run 401 without or with a bad token; 0 database writes.

Screens (/tmp/rev253i_work/ui_i.js, real page against the real alert.js behind an in-memory store; 360x740, 430x900, 1280x800; four themes; four states: final carried Lock with no %, live carried Lock with no %, Lock moved on after an ESPN postponement, final off Lock):
- 1,536 probes: 0 page errors, 0 console errors, 0 sideways scroll or wide tables, no "undefined", "NaN", "null", developer text, "Double lock", "USGA/GHIN/DUPR". The My Bets banner covers nothing. Move the line Back returns to the Alert drill.
- Live carried: Lock list "no model % right now", Lock sheet and Move the line show the new L1 line. Final carried: "frozen late". Lock info sheet has the new postponed sentence.
- Postponed, moved on: Alert, Lock list, Lock sheet and Move the line all show the new Lock (TB +6.5, 55%).
- Off: Alert box "postponed ... 🔒 Final at +16.5 (-110) (game postponed: no result)"; Lock record unchanged at 7-3; "No 2-game parlay in week 11" text. See N2.
- Tap targets and violet light contrast: the L5 list only.

## Residual risk of the deploy: v252 + v253 against main (c9a9e93)

The change set is 21 files, +1,730 lines. Main is v251, where a phone froze the week. This deploy moves the picks to the server. Items below have no independent review evidence in HANDOFF or in the reports I can read.

Never run against the real thing (every review, mine included, used fakes):
- Real ESPN JSON on the server: event shape, the spread price fields (two guessed shapes; if neither matches, picks store "no price" and units and parlay payouts stay empty), the status names behind the new postponed flag. ESPN is blocked from this sandbox.
- Supabase: the conditional write of row `lock:alert26`, creating `lock:bx26`, row growth (lines, in-time numbers, last-line log for every game).
- nflverse and ESPN box scores fetched from Render; Render sleep and the keep-awake ping; the first 13 minutes of box-score loading.
- A real phone and the installed app; a phone still holding the v251 page against the new server (it gets 410 on its old freeze call until it reloads).
- The owner's week-10 correction (`POST /alert/fix`) on the live row.

Reviewed only by the coder's own tests:
- 🤝 Helper on the server (odds-api/helper.js): win-chance parity with the page, box-score reading. No carry rule; rev253h and I did not test it. It can move on a late line or after an outage the way the Lock used to.
- Move the line maths (`Parlay.shift`, `fair`, `ladder`) and pics/linemove.json (2014-2025 landing rates). The first v253 review changed its wording (no -110), I see no independent re-computation of the numbers.
- The 12-season tables typed into index.html (Lock 108-94-7, Alert 248-214-12, 2-game parlay history) from backtest/parlay/*.py.
- Boot safety (a missing data file disables picks instead of crashing).
- Live parlay legs: until today only the coder's tests. I added a check in my fuzz (150 weeks, 60,237 parlay ticks: Lock first, frozen dog legs stay, a frozen dog is never added, a final parlay never changes): 0 violations.

Independently reviewed (seven rounds plus this one): the Lock rules in `compute()`, Lock and road dog sharing one line, weeks 1-9 history and parlay results, the screens named above.

First things to check after the deploy: `GET /alert` shows `tick.ok` true, `markMin` 60, `weeks.11` with `v:2`; Render logs show `alert:` lines and no `PICKS DISABLED`; the week 11 Lock shows a price (if it says "no price", the ESPN price shape is the reason); two real phones show the same Alert.

## What I could not verify

- Anything live (rules: no live calls). I did not call the live server at all, because GET /alert also runs a tick.
- Real ESPN payloads (host blocked).
- Money maths, other users' data, HTML injection, request races: not re-attacked. This commit adds no route and no text from user input; the only new field the app reads from the server is the yes/no `off`.
- Screens outside the ones this commit touches.

## The coder's and manager's decisions in this commit

- H1 as "keep the last in-time number" (`il`), carry only on the tick itself: accept.
- Storing the in-time prices (`ihp`, `iap`, `ips`): unused by any code; harmless.
- M1 as "flag, or 3 reads spanning 10 minutes" with the counter in the stored row: accept. The Lock then leaves a truly vanished game 10 to 12 minutes after it vanished.
- L4 final flagged off: accept; fix N1 within the week; one line to the owner.
- L1 wording "next clean read": change (N3).
- Two older tests changed to flag the game postponed instead of deleting it: accept, that is the new rule.
- Version stays v253: accept.

## Worth remembering (for the main session)

- From this review: the sandbox proxy blocks site.api.espn.com, so no reviewer here can check real ESPN payloads; raw.githubusercontent.com works.
- From this review: the machine was shared (load 10 to 12 on 2 cores); a 1,600-week fuzz took about 35 minutes instead of 9.

## Files

- /tmp/rev253i_work/ifuzz.js (own checker and fuzz; MODE=out|ctl for the comparison), xv.js (x1 variations), xo.js (N1), tk.js (M1 through the real tick), auth.js, ui_i.js
- /tmp/rev253i_work/logs/ (all outputs), /tmp/rev253i_work/shots/ (screens)
- Fresh data: /tmp/rev253i_work/data/games.csv (19:03 UTC), games2.csv (19:31 UTC)

## Proof nothing was changed

`git -C /home/claude/calcutta status --porcelain` prints nothing.
`git -C /home/claude/calcutta rev-parse v253-parlays` prints a29edeada7a127e41458b8f859de316111bf0167.
