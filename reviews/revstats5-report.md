# Player stats v1.3: independent review (reviewer 5)

Reviewed: /home/claude/calcutta-stats, branch stats-v1, commit 250a4b9 on top of a07ab04. Cloned to /tmp/rev5/repo, read-only. Nov 17 2026.
Scripts: /tmp/rev5/w (atk.js = attacks A1/A2, club.js = club of 40, live.js = live account with no stamp, gh.js + whs_cmp.js = maths). Course shots: /tmp/rev5/shots-navy, /tmp/rev5/shots-violet-dark.

## Verdict for a LIVE deploy: SHIP AFTER FIXES

The review-4 fixes work as described. Three throwaway accounts made today get nothing. One friend is held to 2 of 20. The course pick flow is fixed. Handicap maths, money totals and privacy are unchanged and still right.

What blocks handing this to the port session:
- **H1**: the sign-up date is wrong for every live account (no backfill), so long-time users are shown as "joined today" and their recent rounds can never be confirmed. This must be fixed before the deploy, not after it.
- **H2**: confirming one match ages a brand-new account by up to 29 days, and the make-up then shows a false "joined" date.

Can follow in the port session, but must be done before any money game uses the number:
- **H3**: four throwaway accounts made 31 days ago give any number, auto-used, in 3 days, with no flag.
- **H4**: stats never checks who approves a provisional number, so the engines must.

## 1. The cheapest fake now

### One person: not possible
Unchanged since review 4. The r4 suite covers it and passes 10 of 10.

### One friend
- New player, friend confirms: 1 confirmer, `use` null, nothing provisional.
- Established player with a hundred 130s confirmed by one friend: 11.6 to 11.8. The friend holds 2 of the 20, and the make-up flags "confirmed 20 of 20".
- This is closed.

### Three or ten throwaways made today: blocked
- Each round reads "Recorded, not counted (confirmer too new)". There is no number and nothing provisional.
- Waiting 45 days does not help, because age is checked at the time of confirming.
- The make-up flags "joined today", "all rounds on one date" and "all logged on one day".
- Ratings: seed 1500.

### Aged throwaways: any number in 3 days, nothing flagged (H3)
Repro (atk.js, A2):
- Four accounts sign up 31 days ago.
- Each one gets 3 "games of their own". In the test these are one-hole golf records with no card and `solo: false`: a golf day with only typed-in guests.
- A beneficiary account logs 8 hole-by-hole 200s, dated across the last 8 days and logged 3 a day for 3 days. Each throwaway confirms 2.
- Result: `use` 54.0 (auto, not provisional), course handicap **60**, `flags: []`, `warn` empty.
- The make-up lists 4 players, 2 rounds each, all "joined 2026-10-16" (the same day). Nothing points that out.
- Total cost: 30 days of waiting (no other effort), then about 15 minutes over 3 days.

### Can "3 rounds or matches of their own" come from guests-only or self-made games? Yes
- `gameScored` (stats.js ~273) counts any golf or events record that is not solo and not `confirmed:false`.
- It does not need another account in the game, a confirmed card or a finished round.
- golf-v1 emits a round record as soon as one hole is scored (`if (thru)`), and `solo` is false for a day with guest members.
- Events, by contrast, set `confirmed:false` for matches against guests. So guests-only events do not count. A 3-account round robin among throwaways does count (2 matches each).

### Is the sign-up stamp settable or resettable? Not directly, but the effective date can be moved (H2)
- `sinceSet` is set once and keyed by account, so re-registering does not reset it.
- `acctSince` still takes the earliest of the stamp and every `extra.at` in the account's own stats row.
- A confirmed match writes a mirror into the confirmer's row with `extra.at` = the logger's entry time (stats.js ~1238).
- Repro (A1):
  1. Ann (established) adds guest "Tia" and logs a pickleball match against her, 29 days ahead of time.
  2. Tia signs up today, claims, and confirms (allowed, because the link window is 30 days).
  3. Tia's `since` becomes 2026-10-18, against a stamp of 2026-11-16.
- Two days later Tia, Tom and Ted (all made that day, all prepared the same way) confirm Dan's three 200s. The result is provisional 54.0, approve gives course handicap 60, and the make-up shows them as "joined 2026-10-18" with no "joined" flag. The only flag is "all logged on one day".
- One logged match per future throwaway, prepared once, removes the 30-day wait, and the make-up shows a false join date.

### "No stamp: start at the earliest server-stamped record": abusable?
Only through the mirror route above. Bet ids and daily-log days are still ignored, and `updated` is server-set.

### Deploy-backfill gap (H1): worse than HANDOFF says
Per SYNC_SETUP.md, `oddable_sync` has no `created_at`. So a live account's start becomes its sync row's last write (about the deploy day). It is stamped permanently the first time anyone looks at it: its own /stats/me, or as someone else's confirmer.

Repro (live.js): a 2-year user who synced an hour ago logs Saturday's round on Tuesday.
- The round is saved `preAcct: true`, which means it is **never confirmable**.
- `me.since` shows yesterday.
- On every make-up the user is "Joined Oddable <deploy day>" with the flag "joined today" or "joined this week". Organizers get a false warning about real members.
- None of their confirmations count for 30 days.

**Recommendation:**
1. Run a one-time backfill before the new code serves anything: for every existing sync row, set `lock:acctsince` to the earliest of the first bet-id timestamp and the first daily-log day. Phone-written data is acceptable here, because it was written before the rule existed. If neither exists, use deploy minus 30 days.
2. Until that backfill has run, have `acctSince` stop calling `sinceSet` lazily.

## 2. Too strict? Honest cases
These are the r4 scenarios, re-read and re-run 10 of 10, plus my own club run.
- **Rotating foursome, hole by hole in games:** provisional at 3 rounds, used at 8, then all 30 count. Fine.
- **Same marker every week, or two markers:** never a number. The screen says to rotate.
- **Link-only foursome:** 2 per confirmer by link means at most 6 can count, so the number is **provisional for ever** and the organizer approves it every game. This is workable, but the screen should say so, and the engines should let the organizer's approval stand for that player until the number changes, not ask again every game.
- **Couple:** never. The organizer sets it. Acceptable.
- **New member with 20 solo rounds:** no money number, casual index shown. Correct.
- **Club of 40, everyone new to Oddable in month one, weekly golf days, cards confirmed by another team** (club.js):
  - Weeks 1 to 5: nothing (0 counting rounds).
  - Week 6: 1. Week 7: 2.
  - Week 8 (day 50): provisional.
  - Week 13 (day 85): auto-used.
  - The first 5 weeks of honest rounds never count for money.
  - The organizer types or approves 40 numbers a game for about 3 months. That is not workable for an Enterprise club, and live users after deploy hit the same wall until H1 is fixed.
  - Recommend an Enterprise director switch "members vouched by this club". It waives the age test for confirmations made inside that club's own games. The director is already trusted under E-H.
  - Also recommend a one-tap "use each player's Oddable index" for the organizer, with the make-up shown.

## 3. Course pick flow: fixed
I ran course.py in navy and violet-dark (106 checks each, 0 failed) and looked at the 360 shots myself.
- **5 tees:** big buttons. "Use this course" and "Back to results" are on a bar stuck to the bottom, visible without scrolling at 360x740 and 430x900.
- **1 tee:** already picked.
- **No tee data:** "No ratings on file for this course" with optional Tees, Course Rating, Slope and Yards, plus Use and Back. This was the owner's bug, and it is gone.
- **Incomplete holes:** the code (`useCourse`) keeps pars and stroke index only when all 9 or 18 are numbers; otherwise it drops them and keeps the rest. Code read only; no screen test.
- **After Use:** the form shows course and tees filled, a green "Course set ... Change" card, and a "Course set" toast. The pick persists (course id saved).
- **My courses:** offered first, home course kept, survives reload.
- **Calculator:** keeps its course across an app reload.
- **`/stats/mycourses` privacy and ownership:** only the caller's own row, by token. Input is cleaned (no HTML). It is rate-limited. It appears in nobody else's view.
- Low:
  - The no-tees screen uses placeholder values ("71.3", "125", "6400") that read like real ratings. Use "e.g. 71.3" or leave them blank.
  - The "Course set" toast briefly sits over the Format field at 360.

## 4. Maths, money, privacy, tests
- **Handicap maths:**
  - ratings.js is byte-identical to a07ab04.
  - 300 new random histories: review 4's independent Python WHS against ratings.js gave 0 mismatches (40 soft caps, 13 hard caps, 267 exceptional, 599 nine-hole).
  - My own check that stats' new path (`golfHcp` with `confCtx`) gives exactly `ratings.handicap` for both index and confirmed index: 0 mismatches in 300.
  - I did not write a third WHS implementation, because the maths file did not change.
- **S-ALL reconciliation:** no money function changed (diff hunks touch only the confirm, make-up, since and My courses code). The reconciliation tests in the suites pass 10 of 10. Not re-proved on a 3,092-record set.
- **Privacy:**
  - No `a:` or `e:` reference, account id or `lock:` key in /stats/me or /stats/mycourses (A2 leak scan).
  - The confirm sheet now tells the confirmer: "Your name and the date you joined Oddable are shown ... to <logger>, to organizers of money games and to course directors." This matches where the make-up goes: the player, the course director for players who share, and the engines (organizers).
  - Group members and pairing do not get it.
  - A stranger with a confirm link gets nothing (L2 fixed).
- **Tests, 10 runs each, all 10 of 10:** stats, stats-fixes, stats-r3, stats-r4, groups (the review-4 flake is gone), alert, cfbd.
- **Phone script (play.py):**
  - 9 runs (navy, violet, violet-dark at 360, 430 and 1280): 459 checks, 0 failed, 0 problem screens, 0 page errors.
  - No "Double lock" left in pics/index.html or pics/stats.js.
  - Note: it writes to /tmp/stats-shots4, the coder's folder.

## Defects

### High
**H1. Live accounts get a wrong, permanent sign-up date at deploy.** See section 1. Fix: the one-time backfill described there, and no lazy `sinceSet` until it has run. **Blocks the port.**

**H2. A confirmed match ages a new account by up to 29 days, and the make-up shows a false join date.**
- Repro: atk.js A1.
- Fix:
  - When a stamp exists, `acctSince` returns the stamp and nothing else.
  - With no stamp, ignore items carrying `extra.from` or `loggedBy` (mirrors), and use only `extra.ent || extra.at` of entries the account logged itself.
  - Also stop the mirror's old `at` being copied into `d.since` on the next save.
- **Blocks the port** (it is a small fix in the same function as H1).

**H3. Aged throwaways give any number with no flag.**
- Repro: atk.js A2.
- Fixes:
  1. A confirmer's "own games" count only if the record is itself confirmed by another account (`confInfo(r).ok`, or `card.others >= 1` with a confirmed card) and is a complete 9 or 18 holes, or a finished match.
  2. Add a make-up flag when 3 or more confirmers joined within 7 days of each other, and when the confirmers' own games were played only with each other or with this player.
  3. While a number is built mainly from link-confirmed rounds, keep it provisional.
- This can be done in the port session, but before any money game plays `use`.

**H4. Nothing in stats checks who passes `{approved:true}` or `{typed:n}`.**
- They are only engine arguments (no HTTP route takes them, which is good). But the organizer can be the player, approving their own 54.0.
- Contract for golf and events: only the game's organizer or director may approve; never for their own number unless another account in the game co-signs (golf already has signatures); and every player in the game sees "Approved by <organizer>" with the make-up.
- Blocks any money use, not the port.

### Medium
- **M1. Club month one** (section 2): no usable number for about 7 weeks. Owner decision. Recommend the director-vouched switch.
- **M2. Link-only groups are provisional for ever.** Say so, and let one approval stand until the number changes.
- **M3. `confCtx` loads every confirmer's full records** (all providers, up to 80 accounts) on each /stats/me and handicapFor, with a 60 s cache. This is fine in tests but untested against live latency. Measure after port.

### Low
- L1. Placeholder values on the no-tees screen look like real ratings.
- L2. The toast overlaps the Format field for a moment at 360.
- L3. play.py's default output folder is the coder's /tmp/stats-shots4.

## The coder's own decisions
- **Age measured at confirmation, not today:** right; otherwise throwaways just wait. Keep it, but fix H2, which undoes it.
- **Limits walked from the newest entry back over counting entries:** right. Verified no freeze in the honest scenarios.
- **3 a day and one per date for hand-logged golf only:** right.
- **Link usable for 30 days; strangers see nothing:** right.
- **Stamp from the earliest server record:** fine in principle. As built it produces H1 and H2. Replace it with a deploy backfill.
- **Event matches count nothing until events sends `acctRef` or `linkRef`:** right, and safe. golf-v1 already sends `card.by` through `stats.acctRef`.
- **groups.js retries 6 to 14 (not to port):** fine. 10 of 10 here.

## Could not verify
- Anything live (Supabase, a real sign-up, real course data).
- golf.js and events.js against the new approval contract.
- Whether golf-v1 lets a game with only guests start and score one hole in practice (code read says yes).
