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
