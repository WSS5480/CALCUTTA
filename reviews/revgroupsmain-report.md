# Review: Groups rules on main (branch feat/groups-rules-on-main, 342da87, on main 8af1f79 / v274)

## Verdict: HAND OVER AFTER FIXES

Nothing live breaks. With the switches off, the server answers exactly as main does today. The rules hold. Before the hand-off:

1. **Push the branch or change the merge guide (blocker for the hand-off itself).** `feat/groups-rules-on-main` is not on GitHub; only the local clone has it. Merge guide step 1 (`git fetch <feature remote> ...`) cannot work for another session until someone pushes it. That is the manager's call; reviewers do not push.
2. **Confirm the ODDABLE odds service never sleeps (owner/manager check).** A bet added more than 30 minutes before kickoff now counts only if the server's 5-minute groups tick reads that game in the 30 minutes before kickoff. If the service is asleep (Render free plan), or restarting for that whole window, every such bet is **void** ("No posted price at kickoff"). Main graded these at even money at most. I could not see the Render plan from here.
3. **Medium (owner decision):** a group member can no longer save a bet at all on a game with no posted price yet, or within 2 minutes of kickoff. It is refused (409) and is not even kept as a personal bet. Main saved both to the group. Suggested fix: use the personal answer (200 `personal:true`, with the reason) for these two, the same way "can't find this game" is handled now.
4. **Low:** the HANDOFF's phone "lock" wording list misses three lines (below).

## 1. Regression against main
- **Diff:** 13 files. Server: groups.js, grade.js, limits.js, pairing.js. Tests: groups / phase1 / owner / r2 / r3 changed; r4, r5 and mainport added. HANDOFF. sync.js, acct.js, golfday.js, gstats.js, server.js and everything under pics/ are untouched.
- **Switches off: proven identical.**
  - I started main's server.js and the branch's on my own ports and sent 23 requests to each: /groups/on GET and POST, bet/status, bet/add, list, create, stats, invite, prop/list, reqs, contest/schedule, golfday, health, sync, acct, betpush, games, lines, and a 404.
  - Answers were byte-identical with all switches unset, and again with `GROUPS_ENABLED=1 GROUPS_OWNER_ONLY=1` for a non-owner caller.
  - Why: the one early gate in `handle()` is unchanged, and the tick is still gated in server.js. Outside groups.js, the changed modules are used only by betwatch (`grade.LG`, which is unchanged) and golfday (`onFor` and `memberCheck`, both unchanged).
- **Kept from main:** `onFor` / `enabled` exports, `memberCheck().group`, the 200 `personal:true` answer, the v274 `stats` route, the golfday hooks, `tell()` activity events (same calls), and sync.js id encoding (sync.js untouched, mirror / dbPatchIf calls the same).
- **Suites:** branch, 32 suites x 10 runs = **320/320 passed, no flakes**. Main 8af1f79: 29/29. The same "preview phone checks skipped" notes appear on main.
- **Main tests whose expectations the coder changed:**
  - **phase1:**
    - The "Saved to your group. Locked." wording changed.
    - Reasons changed: "Not NFL", "outside this contest's dates", "can't find this game".
    - The 503 sentence changed.
    - Honor fixtures now use entry 0.
    - B4: one bet moved off game 501, which has no price, because round 4 refuses it.
    - `view()` now runs the server tick before each kickoff.
    - All justified by the rules. The last one is the operational dependency in fix 2.
  - **groups / owner / r2 / r3:** the old even-money tests are replaced by "void with no price". Also: "coming soon" for head-to-head is removed, Calcutta has new wording, and "locked" became "final". These r2/r3 changes were already reviewed in rounds 5 and 6.
  - **Not changed:** groups.phone, groups.acct, groups.fix1, sync.phase1, golfday and gstats are main's own tests, unchanged, and they pass.
- **Dormant (Low):** `wire()` now registers 'calcutta' / 'events', stored under 'calc' / 'event'. `attachGame` still stores `type` as given. An engine that later attaches with type 'calcutta' would not find its pot summary. server.js never calls `wire()` today.

## 2. Main's phone against this server (Playwright 360x740 / 430x900 / 1280x800, switches on)
- **Coder's 17-screen walk, rerun on my clone:** 51 screens. Covers My groups, group, Members, Games tile (golf-day entry), contest/standings, Rules (plain and free honor), Create, Join, My stats, My Bets banner. Result: **0 page errors, no sideways scroll, nothing under the banner**. The standings screen renders correctly (screenshot checked).
- **Bet add through main's real `gHold` -> `OddGroups.gate` -> confirm "Add to my group" -> server**, at all 3 sizes (also a server-level main-vs-branch diff of 24 cases):

What a player sees, main today vs this branch:
- **Priced bet:** "Saved to your group. Locked." -> "Saved to your group." (kept, group bet)
- **Game with no posted price (single, or any parlay leg):** main saved it to the group -> now the form stays open with "No posted price for this game yet — it can't count in your group until there is one. Try closer to kickoff. Nothing was added." The bet is NOT kept (fix 3).
- **Within 2 minutes of kickoff:** main saved it -> now "Bets on this game are closed: group bets stop 2 minutes before kickoff. Nothing was added." NOT kept (fix 3).
- **Right game id, wrong teams typed:** main saved it to the group -> now a personal bet with a clear alert.
- **Unknown game / no game id:** personal on both; the new alert text is clearer.
- **ESPN down:** 503 on both; new short sentence "Couldn't check this game — try again. Nothing was added."
- **Player prop, honor off:** personal on both; the reason now names honor.
- **Other sport:** personal on both; reason "Picks: Not NFL".
- **Started game, far line, same-game / duplicate parlay legs, no stake:** same answers as main.

All the messages are plain sentences. There is no raw server text, no "undefined", no page error. The confirm step ("Add to my group · lock it") comes before the refusal, so a player confirms and is then told no. That is acceptable, but worth smoothing on the phone later.

## 3. Rules after the port
I ran the round-5/6 attack scripts (the coder's copies of them, all 27 runs) and my own checks against my clone:
- **Late news:**
  - News at T-5, bet at T-3 at the old price: graded at the post-news -220.
  - Stale read 41 minutes out: graded at the post-news price.
  - Kickoff moved: bets stay hidden and adds reopen until the new T-2.
  - Early first pitch: refused.
  - ESPN down near kickoff: 503.
  - Note: with 20% of ESPN reads failing, 19 of 64 burst adds got 503 (round 6: 0). That is the fresh read working: a retry, not a wrong bet.
- **No price at kickoff:** void, stake back, moneylines included.
- **Parlays:**
  - Whole-parlay cap: x6 kept to +500. A typed lower multiplier wins.
  - A losing leg plus a no-price leg = lost.
  - A postponed leg drops out.
  - Per-game void for every member.
- **Join requests:** paged at 50. The cap rose from 100 to 1,000.
- **Stake caps, weekly limit and hedge:** told at add (personal with the reason).
- **Honor props:**
  - Refused at create, side pot or edit when there is an entry (400).
  - A main-pot contest with money cannot be added once people joined.
  - Paid at even money however typed (+500 typed pays $100 on $100).
  - An unconfirmed result (including a false "won" the commissioner entered) became a **loss after 72 hours**.
  - The past-posting trick (naming a later game) is still SAVED at even money, and the card shows the named game and the add time. **Acceptable for free contests in my view** (no money, and the card exposes it), provided honor stays money-free.
- **Head-to-head:**
  - Schedule: no hand-made schedule once anyone joined (409). A member gets 403. Oddable draws it at the start, and re-drawing after the start is 409.
  - A week with an open bet is decided 72 hours after its last game; total owed = pool.
  - A late joiner has no matchups, is ranked last and is owed $0.
  - The weekly prize goes to the week's high scorer.
- **Money:** 5,000 random seasons (2–8 players, every format, weekly share, take, split):
  - Never over the pool, never a fraction of a cent, never negative.
  - Exactly the pool in 4,436 seasons.
  - The other 564 are places nobody is eligible for (545 "fewer eligible than paid places", 19 "nobody met the minimum"). That is the existing rule, but the money stays unassigned. Owner question: should it roll to the best eligible member?
  - The week view matches the season view in 200 of 200 checks.

## 4. The coder's "risky on main" list
- **"Weekly prize money lost":** NOT a live defect. Main 8af1f79 has no weekly prize at all, only a high-score display. It is new in this branch and adds up to the cent.
- **"Lock" wording in main's phone:** confirmed, and the HANDOFF list is incomplete. Besides groups.js 31 / 114 / 347 and index.html 1510 / 1519, it misses:
  - groups.js 139: "Rules lock when the contest starts."
  - index.html 1521 and 1706: the alerts "Group bets lock when you add them. This bet cannot be edited/deleted."
- **Phone screens missing (prop results, game void, head-to-head, weekly prize):** confirmed. Main's phone create always sends `fmt:'standings'`, entry 0, no honor, no weekly. A commissioner cannot pick these formats from the phone; only a hand-made API call can. Optional: refuse `fmt:'h2h'`, `weekly` and `honor` on the server until the phone has screens. Not required for safety.
- **"Unpaid members can still win places":** confirmed. In the 5,000-season run, an unpaid member was paid first place in 7 seasons. Unchanged from main (H4); owner decision.
- **"A prop on a cancelled game settles as a loss after 72 hours":** NOT reproduced. A prop whose game ESPN marks cancelled is voided by the server at once ("Void: the game was cancelled", stake back). Side note: other members never see that prop on their prop list, because the game never shows as started. Harmless, since it is void.

## 5. Merge guide
- Main on GitHub is still 8af1f79 (checked with `git ls-remote`). A trial `git merge --no-ff` on main is clean, and the resulting tree equals 342da87.
- The guide is accurate, except: the branch must be pushed first (fix 1), and the phone wording list is short (above).
- The HANDOFF claims match what I saw: 32 suites, honor, head-to-head and personal answers.

## Not verified
- Render plan or sleep behaviour of ODDABLE.
- Real ESPN lag.
- Phone approve UI for join requests: the walk approves through the API.
- Original reviewer attack scripts: /tmp/revg5 and /tmp/revg6 are gone, so I used the coder's copies plus my own.

## Proof nothing changed
`git -C /home/claude/calcutta-groups-main status --porcelain` -> (empty); `rev-parse feat/groups-rules-on-main` -> 342da87f485e40abbef4e794baa4c4bc1d9de731.
Work dir: /tmp/rgm (diff harness /tmp/rgm/atk, Playwright /tmp/rgm/pw, attacks /tmp/rgm/a5, /tmp/rgm/a6, my honor checks /tmp/rgm/a6/tx1.js).
