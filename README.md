# Notes from the feature / preview session to the main-line session (Nov 17 2026, 2:15 AM CT)

This branch has NO app code. It is a hand-over from the session that built the preview (manager + hired coders and reviewers). Nothing here or on the feat/* branches was pushed to main, and none of them auto-deploys.

## What I learned at 2 AM
- main moved from c9a9e93 to v269 while this session worked. I read main's HANDOFF: Groups goes file by file in phases, Golf next, server picks in phase 4, my "v252/v253/v254" labels are retired. Understood. This session will NOT push to main and has dropped its own "v254" merge of server picks.
- Both sessions draw on the same weekly usage limit; it ran out twice on Nov 16.

## Newest feature heads (all newer than the ones main's HANDOFF lists), pushed as branches
| Branch | Head | Built on | Last review of an EARLIER head | State of this head |
|---|---|---|---|---|
| feat/server-picks-parlays | a29edea | c9a9e93 | rev253i: SHIP (OK to deploy) on a29edea itself | Reviewed. Conflicts with main in index.html (tiles, v254 list fix). See reviews/rev253i-report.md "Can wait a week" N1–N4 |
| feat/groups | 322d2a0 | v253-parlays d7b044f | revgroups4 on 1e47e93: DO NOT SHIP | Round-4 fixes (bet must match a real game at add time; no price at kickoff = void; void rules; "final" wording). Review was cut off by the usage limit |
| feat/calcutta | ccf62a7 | — | round-5 review on dc5371b: SHIP AFTER FIXES | Round-5 fixes (one-game correction with a fresh feed read). Review cut off |
| feat/golf | 584be99 | — | revgolf3 on 2fa88eb: SHIP AFTER FIXES | Golf v1.3: THE NEUTRAL RULE (second signature for a playing organizer), strict handicaps, truthful extra.card for stats, flights, /golf/gjoin. Fixes main HANDOFF's B1, B2, H1, H3 and the 360-wide tab. Review cut off |
| feat/local-events | 76ee6fa | — | revlocal3 on 872e74a: SHIP AFTER FIXES | v1.4, passes against the real stats/calcutta/groups modules. Not yet reviewed |
| feat/stats | a07ab04 | — | revstats3 on e214bcf: SHIP AFTER FIXES | v1.2: strict "confirmed" rule (fixes B3 farming against a typed-in guest), caps, confirm link. Review cut off |

Each branch's HANDOFF.md has its own sections with rules, decisions and contracts (handicapFor/ratingFor, Calcutta source contract, OddJoin.registerGame/openGame, limits.recordPlay).

## Owner decisions taken in THIS session (full list in OWNER-DECISIONS.md)
- G16 bets in a group are final when added, saved on the server (main's HANDOFF already has the later "no Just for me" decision; feat/groups still has the option: remove it when porting).
- S-ALL every play in the player's personal dashboard; P1 partner suggestions; H1 app play is the real handicap; E-H Enterprise director can set a tournament handicap, the real Oddable number always shown beside it.
- PB-1 (3:03 PM Nov 16): "pickle ball is in the oddable app not the group link i asked for" = he wants pickleball as a group game joined by link, not the standalone page.
- Course search bug he reported on the preview: "Once I pick a course no way to select or save it" (not yet fixed; the preview builder was mid-fix in pics/golf.js, pics/stats.js when the limit hit).
- Owner asked "what happened to the ncaa football. nothing there now" at 3:02 PM Nov 16; unknown which app. main's v254 "every game shows" fix may be related; please confirm NCAA on the live app.
- Wording: this session switched new screens from "lock" to "final/closed" (lock = weekly picks only). Owner has not confirmed.

## Manager rules that came out of the reviews (so they are not re-learned)
- Groups: a bet counts only via the server add step, matched to a real game at add time, graded at the worse of typed and kickoff price; no price at kickoff = void. No Kalshi-tag path.
- Golf: nobody settles/changes/finalises on a team they play on without a second signature from another team; nobody sets their own handicap in a money game.
- Stats: "confirmed" needs another account that actually played; at least 3 different confirmers; organizer sees the make-up.
- Calcutta: results on feed-backed events come from the feed only; "started" = a game in progress/final or the clock past the earliest kickoff, never from a scheduled bracket.
- Reviewers: read-only on clones; never the owner's Chrome; never kill processes by name.

## What this session will do next
Finish the cut-off reviews of the heads above and add the reports to reviews/ on this branch. It will not touch main. If the main-line manager wants something different, write it in main's HANDOFF under "NOTE FOR THE PREVIEW / INTEGRATION SESSION"; this session reads it at each start.

## Update Nov 17 2026, ~3 AM CT: the four cut-off reviews are finished (reports in reviews/)
| Branch / head | Verdict | Blocks real-money use |
|---|---|---|
| feat/golf 584be99 (reviews/revgolf4-report.md) | SHIP AFTER FIXES | C1 an organizer who plays as a typed-in GUEST counts as "not playing" and acts alone; H1 organizer + one helper on another team rewrite a third team's card (the affected team must sign); H2 one-and-done `oadmoney`/`endseason` bypass the signature functions; H3 guests-only money game finished/reopened alone; H4 (Enterprise) playing director finishes a no-fee tournament alone; M1 COURSE DEAD END the owner reported: with 2+ tees only "Show holes" shows and "Play the White tees" is below the fold (y=1326) at 360/430. Against main HANDOFF's list: fixed B1, B2 (partner case), H1, H2, H3, "Busy", Side-games overflow. NOT fixed: H4 offline card, H5 pick-six final stored, H6 one-and-done first final, H7 remove a player, 9-hole double rounding, skins on withdrawal. Works the same without stats.js. Recommend a "Sign all handicaps" button |
| feat/stats a07ab04 (reviews/revstats4-report.md) | SHIP AFTER FIXES | H1 three throwaway accounts set any money-game handicap in minutes (guard: confirmers 30+ days old, under 8 confirmed rounds = provisional + organizer approval, show when confirmers joined); H2 a course with NO tee data is a dead end in pics/stats.js `csList`/`cpick` (the owner's "no way to select or save it"); H3 rejected filler entries beat the per-confirmer limits |
| feat/groups 322d2a0 (reviews/revgroups5-report.md) | SHIP AFTER FIXES | H1 scoreboard cached 10 min while bets are taken to kickoff: late-news bet paid at the old price, and accepted with ESPN unreadable; H2 honor-system contests accept a "prop" after the final, self-marked won; H3 "Just for me" still on the confirm step (owner decided: remove); M3 parlay cap is per leg (x1296 on 4 legs); head-to-head, bankroll, survivor, weekly prize are hidden (not built) |
| feat/calcutta ccf62a7 (reviews/revcalc6-report.md) | SHIP AFTER FIXES | B1 commissioner alone can crown his own team via a correction of the FINAL (needs a second member's confirm + "I object"); B2 "this weekend" events never finish (no champion row); B3 guest-claim confirm bypassed by claiming first then buying back |
| feat/local-events 76ee6fa | not yet reviewed | — |
| feat/server-picks-parlays a29edea | SHIP (reviews/rev253i-report.md) | none; conflicts with main need a careful port |

No coder has been hired for these findings: waiting for the owner to say whether this session keeps building, becomes the review desk, or stands down.

## Update Nov 17 2026, afternoon: READY TO MERGE — feat/groups-rules-on-main (ff9f321)
The owner chose "keep building". Because main moves every few hours, this session now delivers each piece as a branch cut FROM main with only the reviewed rules added, instead of a side version plus notes.
- **feat/groups-rules-on-main @ ff9f321** = main 8af1f79 (v274) + the reviewed Groups betting rules. Server files only (odds-api/groups.js, grade.js, limits.js, pairing.js + tests + HANDOFF section "Groups rules on main (from the feature session)"). No phone file changed, no version or cache bump. Independent review (reviews/revgroupsmain-report.md, on 342da87): with all Groups switches off, 23 sample requests answer byte-identical to main; 32 suites x10 pass incl. all of main's; main's phone flows work against it at 360/430/1280; every earlier attack still fails. ff9f321 adds the review's follow-ups: unpriced / last-2-minutes / already-started bets are kept as `personal:true` with a clear sentence; grading falls back to ESPN summary pregame lines if the 5-minute check missed the last 30 minutes (so a sleeping server doesn't void bets). NOT yet verified against real ESPN: that `pickcenter` keeps pregame numbers on a finished game.
- Before opening Groups to everyone: put the ODDABLE odds server on a Render plan that doesn't sleep.
- Phone to-do for main (exact lines in that HANDOFF section): six "lock" wordings; no phone screens yet for head-to-head, weekly prize, honor-prop results (server supports them; main's phone can't create them, so nothing is exposed).
- Owner questions raised: unassigned prize money when nobody qualifies (suggest: best-placed qualifying member); unpaid members winning places (suggest: paid only).
- One r3 check loads /home/claude/calcutta-calc if present (ODD_CALCUTTA); not relevant on your machine.

## In progress here (same method next): golf (benefit-test round, then onto main behind GOLF switch), calcutta (round 7 fixes, then feat/calcutta-on-main), stats (approval model: organizer approves every money number; authorization fixes), local events / pickleball as a group game (fixes + approval screen). Newest review reports are in reviews/ (revgolf5, revcalc7, revstats5, revstats6, revgroups6).

## Update Nov 17 2026, later: feat/stats @ 54e0b93 (Player stats v1.5 + review-7 fixes)
- Reviewed seven times; last verdict "safe to hand over after small fixes" (reviews/revstats7-report.md), those fixes are in 54e0b93 (coder-tested, not re-reviewed).
- Model: the Oddable index/rating is always computed and shown with its make-up; in any money game, flight or tournament the ORGANIZER approves every number before the start (one tap "Use everyone's Oddable index"); nobody approves his own number without a co-sign code from another real, established account; numbers freeze at `eventStart`. Contract for engines: its HANDOFF "Player stats (v1.5) — contract for golf and events".
- This is a SIDE branch (built on old c9a9e93-era code), not cut from main: main has its own `gstats.js`. Port file by file: odds-api/stats.js, ratings.js, stats-courses.js, backfill-acctsince.js, fixtures/courses-fallback.json, pics/stats.js, pics/voicelog.js + their tests; do NOT take its groups.js, index.html or sync.js wholesale (sync.js adds `dbIdsPage` only; acct.js adds the sign-up stamp `since`/`sinceSet`).
- Deploy order: run `node odds-api/backfill-acctsince.js --launch=<Oddable launch date>` (dry run), then `--write`, right after the deploy. Needs from main-line: Oddable's launch date; `acct.createdAt(accountId)` for My Apps email accounts.
- Course pick fix (owner bug "once I pick a course no way to select or save it") is in pics/stats.js: tees as buttons, sticky "Use this course", "Course set", My courses at /stats/mycourses.

## Update Nov 17 2026: feat/calcutta-on-main @ 0f6c2de (main 8af1f79 + Calcutta engine, dark)
- Switches (all default OFF): `CALCUTTA_ENABLED` must be exactly `1`; `CALCUTTA_OWNER_ONLY`, `CALCUTTA_TESTERS` mirror the Groups switches. Off = no routes, no watcher, no ESPN reads, no menu item, pics/calcutta.js never requested.
- Independent review of 3f7fe22 (reviews/revcalcmain-report.md): round 7 money rules held; 30 requests identical to main with switches off; found D1 (a `//` comment in pics/gate.js swallowed main's `oddDays` call: the days-left / Pay now card stopped drawing — a LIVE break even with the switch off), D2 (main's team-page handler caught Calcutta's `data-team` buttons), D3 (invite links on new devices; `grpCapture` strips every `?join=`), D4 (R-CALC2 test path), D5 (no Calcutta card in Groups Games). 0f6c2de fixes D1–D5; NOT re-reviewed, but `node scripts/calcutta/main-preserved.js` proves that stripping the added lines from pics/gate.js, pics/index.html, pics/sync.js, odds-api/acct.js, odds-api/server.js, odds-api/groups.r3.test.js gives main's files byte for byte (two sanctioned one-line replacements: `grpCapture` now consumes only `g.` links; `gFlag` wrapped). Run that script before merging. Merge is clean against 8af1f79.
- `golfday.test.js` (main's file, untouched) failed 1 run in 5 on its "no money word" regex, probably matching random ids: worth a look.
- Owner note: on Custom (hand-entered) Calcutta tables the commissioner types every result; members only get notices. Feed-backed events are protected by confirm + objections.
- No version bump was made: new phone file pics/calcutta.js; changed pics/index.html, gate.js, sync.js.
- The same `grpCapture` one-line change will come with the pickleball-on-main branch (identical snippet) so both merge cleanly.
- Golf: reviews/revgolf6-report.md said do NOT ship money golf on the "benefit test"; a coder is rebuilding it on the reviewer's simpler DIRECTION RULE. Main's casual golf day is unaffected.
