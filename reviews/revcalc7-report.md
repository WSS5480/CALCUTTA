# Calcutta review 7: calcutta-v1 @ 8b0c40e ("Round 6") on ccf62a7
Reviewer: independent, read-only. Clone: /tmp/rv8/repo. Probes: /tmp/rv8/p (r1, r1b, r2, r4, r5, r5b, plus the old probes re-run). Screens: /tmp/rv8/play, shots in /tmp/rv8/shots.

## Verdict: SHIP AFTER FIXES
Review 6's three blockers are mostly fixed. Three new holes remain, all in the new rules. Each is a small fix.
- Before handing this to the session that ports it to the live app: fix H1, H2 and H3, and correct the HANDOFF port section (M3).
- Before Calcutta goes live on main: also fix M2 (the on/off switch).

## Review 6 defects: status
- B1 commissioner crowns his own team alone: FIXED. The final correction is "Proposed". It pays nothing (only the feed's own "reached the Super Bowl" money) and the event is not over until another member confirms. The commissioner gets 403. A member who owns no lot gets 403 when the commissioner owns the lot by account. Pinned notices go to everyone. A game in progress, suspended, delayed, rain-delayed or at halftime is refused (409).
- B2 weekend money stuck: FIXED. `nfl_wk` is over after the window, nothing in play at +10 and +60 days. A Custom table where every team is Out is over. A game with no result counts as off after 7 days, and a correction after that gets 409 `over`.
- B3 claim order swap: FIXED. The commissioner's claim of his own guest is 202 pending in either order. A buy-back while the claim is pending gets 403. Bob gets a pinned notice naming the lot and its buyer.
- M-1 ties for 1st on Champion-row tables: FIXED (see Money).
- M-2 Champion + 2nd + 3rd end states: FIXED.
- M-3 score bounds: FIXED.
- M-4 one empty answer: FIXED.
- M-5 late correction flagged for the watcher: FIXED. Old probe W5: index w=1 at once; after a restart the watcher re-reads it and removes the correction with nobody in the app.
- Low items: the watcher now rotates (150 hot Calcuttas: 150 of 150 get the final within 10 minutes). The reason must be text. `team: ['1']` is refused (404).

## High

### H1 "Event finished" lets the commissioner end a Custom table early and keep the unpaid money
Repro (r2.js F-1): Custom event, places 60/30/10, pool $1,000. Commissioner owns L1 ($100); bob, cat and dan own the others.
1. Commissioner enters his own team 1st. He has won $600; $400 is still in play.
2. `POST /calcutta/finish {id}` -> 200. Over = true; the commissioner has won $1,000. The 2nd and 3rd money rolls "pro rata to what each lot earned", and only his lot has earned anything.
3. Members cannot block it: `finish` 403, `object` 404. They only get a pinned notice.
4. With the carry rule (F-3, a wins-only table): finish after one win, $800 is "carried to the next Calcutta this commissioner runs (the commissioner holds it until then)".
5. Reopen (`finish {off:true}`) works at any time, also 3 days later after members saw their payouts (F-2).

Why: `money()` treats `c.fin` as over for ANY manualOnly table, including place and champion tables. That goes beyond the coder's own call (1), which was about tables with no champion and no place rows.

Fix:
- (a) Only offer "Event finished" on tables with no place and no champion rows. Place and champion tables end by their own rules.
- (b) Make it a proposal like a correction: another member who owns a different sold lot by account confirms it, and any member can object.
- (c) While it waits, show the roll or carry each owner would get.
- (d) Lock reopen once it is confirmed, or reopen through the same confirm.

### H2 An objection is wiped by "remove it" and posting it again
Repro (r1b.js R-1): Bob objects to the proposed final, so confirm gets 409 `disputed`. The commissioner removes the correction (200), waits 61 s and posts the same correction again (200). The objection is gone. His accomplice confirms at once (200). The event is over and the commissioner's team is champion. Bob has to notice and object again before the accomplice taps Confirm.

Fix: keep objections per GAME (`e:<id>` / `s:<team>`), not per stored correction. A re-post for the same game keeps the standing objections until each objector withdraws, or for at least 7 days.

### H3 Ownership judged by account (coder's call 4): a member with no stake confirms the commissioner's typed-name lot
Repro (r1.js B1-b): manual auction. The commissioner enters L1 for $10 under the typed name "Ann (me)". He posts the Super Bowl correction for team 1. Eve, a member who owns NO lot (a friend or a second phone), confirms: 200. "Ann (me)" won $796.88 of the $1,000 pool; over = true.

Typed names are the normal case in "Enter results" Calcuttas, where the auction is held in person, so this is not an edge case. A member who joins after the start cannot do it (409 "This auction is over", R-2), so the confirmer has to be in before the event.

Fix:
- The confirmer must ALWAYS own a sold lot by account that is not the lot the correction pays.
- Best: when the losing team's lot is sold to an account other than the commissioner's, only that owner (or a co-owner) confirms. The person who loses the money is the natural check.

## Medium

### M1 Grief: one objector holds the whole pot of a champion event for good
Repro (r1.js B1-d): the honest final correction (team 2, bob's lot) is proposed. Cat objects and never withdraws. ESPN never posts.
- After 90 days: over = false, $740 in play.
- No exit except ESPN or the objector.
- Weekend events have their 7-day exit; champion events have none.

Fix: an objection lasts 7 days unless a second member joins it. Or, after 7 days, a majority of the lot-owning members (commissioner excluded) settles it. Show "held by an objection since <date>".

### M2 `CALCUTTA_ENABLED=0` does not switch everything off, and default-on is wrong for main
- Routes (server.js line 91) and the watcher (line 65): off with `0`. Correct.
- server.js line 64: `wireGroups` is not gated. Main's `groups.wire()` also calls `require('./calcutta')` and `C.wireGroups` with no switch. With Calcutta "off", Groups would still call `potSummary`. That reads ESPN through `refresh` and writes `c.fr` / `c.kick` to rows.
- `pics/index.html` adds the 🏆 Calcutta menu item with no switch. With the server off, members get a screen that answers 404.
- Main puts features in dark (`GROUPS_ENABLED`: only `1` = on, plus owner-only / testers).

Recommend:
- Use `=== '1'` for Calcutta in main, and gate `wireGroups` / `groups.wire`'s Calcutta branch, `statsFor` and the menu item on the same switch.
- Better: reuse `groups.onFor` (owner-only, testers) for the menu and the routes.
- Default OFF in main.

### M3 HANDOFF "Port to main: Calcutta" has inaccuracies against main (8af1f79, v274)
- STATS: "`stats.register('calcutta', C.statsFor)`". Main has no `stats` module. `groups.wire()` asks for `get('stats')`, which is null on main. Lifetime stats live in `gstats.js` (picks + golf days only, no `register`). The port needs a Calcutta adapter inside `gstats.js`, or a new stats registry. Say so.
- GROUPS wiring: main's `groups.wire()` already calls `calcutta.wireGroups({ registerGame })` when it can require `./calcutta`. The extra server.js line is redundant (harmless). The doc should say wire() does it.
- Main's groups.js has its OWN older Calcutta contest kind: `cleanCalc`, `kind === 'calcutta'` with lots and a payout, and "Calcuttas are coming soon" refusals at lines 872 / 973. The port section does not mention it. The port session must retire it or route it to this engine. Otherwise there are two Calcutta models (the owner decided on one).
- Group lookup: `hooks.groupRole` defaults to reading `lock:grp:<id>` with the same member key. That matches main (`GK`, `mkOf` are identical). Main also exports `memberCheck(groupId, account)` / `canAttach`. Recommend setting `hooks.groupRole` from those, with a timeout.
- Lot sources: main's `golfday.js` has no `registerSource('golf-day', …)` / `endTime()`. The doc says this, correctly ("theirs to add").
- These match main and are accurate: `sync` (dbGet / dbPut / dbPatchIf / dbIds), `acct` (who / phoneEmail / isOwnerPhone / ownerName / namesGet), `ip.clientIp`, `limits` (keyOf / maxPeople / recordPlay), `events.calcuttaStarted` / `calcuttaSold` (listed as not wired), the routes list and the storage keys.
- Watcher load in the doc: confirmed (60 hot Calcuttas: 60 database reads per tick, 0 writes, 28 ESPN requests in 5 minutes; only site.api.espn.com).

## Low
- Status names are matched with `/SCHEDULED/`, which also matches `STATUS_UNSCHEDULED` and `STATUS_RESCHEDULED`. A blank status name is also correctable (r1.js B1-f: 200 for all three). Use an exact `STATUS_SCHEDULED` (or state `pre` with no name).
- Object / withdraw toggling: 30 taps = 30 pinned notices to every member (r1.js B1-c: 2 -> 32). Only the first objection per member per correction should be pinned; a withdrawal can be unpinned.
- A postponed / cancelled game removes the correction on the second watcher tick (40 s), because of the 30 s page cache, not the two-read rule. Fine.
- `groups.test.js`: 2 of 10 runs fail ("race join -> 409 Busy"). Same as last review. It is the Groups coder's file, unchanged since 8cb7074, not this commit.

## What I verified
- B1 (r1.js, r1b.js)
  - Proposed final pays nothing. Confirm refused for the commissioner (403) and for a member with no lot when the commissioner owns the lot (403). The losing lot's owner can confirm.
  - An objection blocks confirm (409 `disputed`). An objection after a confirm only flags it ("disputed by 1"); the money stays.
  - Outsider and junk refs (`__proto__`, `constructor`, an object) all get 404.
  - A re-post after a confirm starts again as pending (no confirm carried over).
  - An ordinary wild-card correction counts at once.
- Commissioner + one accomplice: they CAN take the pot (accomplice confirms the final: $796.88 of $1,000, over). It is visible: three pinned notices to every member (proposed, confirmed, objection). A late objection cannot undo it. The owner accepted this limit; H2 and H3 make it easier than it should be.
- B2 (r2.js, q5.js)
  - Weekend event: over at +10 days with $0 in play. A correction for the last open game is "Proposed (biggest win)". With an objection, the event closes at day +9 with the game counted as off. A new correction after that: 409 `over`.
  - Custom: over when every team is Out. Finish before the first result: 409 `notstarted`. Member finish: 403.
- B3 (q3.js K1): both orders wait for another member; a buy-back while the claim waits gets 403; pinned notice names the lot and its buyer.
- Money (r4.js, my own generator, new seed)
  - 30,000 tables: places, Champion + 2nd + 3rd, Champion + places, Champion + wins, places + wins. Variants: ties, Out teams, a champion ticked with no place, every team Out. Roll / carry, take, buy-backs.
  - Pool = paid + in play + unclaimed: 0 broken. Owners and lots add up to paid: 0 broken.
  - Finished by my definition but not over: 0. Over with money stuck: 0 (4,962 leftovers handled, 2,061 rolled by price, 10,072 carry tables).
  - Ties for 1st on Champion-row tables: 2,604 tables, 0 uneven.
  - Set-up validation: 0 differences from my rule.
- Score bounds (r5b.js)
  - NFL: 80-6 accepted; 81-10 and 76-0 refused (`scorebounds`).
  - College football: 110-11 and 100-0 accepted; 111-20 and 101-0 refused.
  - Ties, negatives, decimals, one score, text: 400. "30","3" is accepted as numbers.
  - The score is shown in the notice ("40-0 (by 40)"). A score that would take the biggest-win row is Proposed (`why=big`).
- Two-read rule (r5.js)
  - Empty / full answers alternating every 20 s: the correction stays (no flapping) and 1 pinned notice is sent.
  - Empty for 60 s or more: removed once, with one notice.
  - A result disappearing and coming back every 20 s: the member's winnings stay $9 every read, 0 notices.
  - Postponed acts on the next fresh read.
- Watcher (q2b.js): 60 hot Calcuttas cost as stated. 150 hot Calcuttas: all re-read (rotation works). A hanging feed does not pile up ticks. Restart picks up from the index. A database error during a tick: no crash.
- Freeze rules, rounds 3 to 5 (old probes pA, pA2, pB5, pG, pS re-run on 8b0c40e): all pass. Bid 1 ms before the kickoff lands; at the kickoff it is refused. Feed hanging at the kickoff: nothing sells. Restart with the feed down: still locked. Moved kickoff: open again. 40-way race. Edit-to-live-event fails closed. Attach locked.
- CALCUTTA_ENABLED: by reading the code (server.js lines 64, 65, 91); see M2.
- Screens (independent walk, my own ports 9781 / 9782; harness based on the coder's measure script, retargeted to my clone)
  - Cowboys with the dark switch OFF (checked on every page: `html.cb`, `body` has no `dark`).
  - Every screen at 360x740, 430x900 and 1280x800: 289 + 289 + 289 = 867 screens, 0 click time-outs.
  - Each pass: 0 page errors, contrast PASS (every text pair at least 4.5:1), no sideways scroll or table, no tap target under 44 px, the My Bets banner under the overlay, no "undefined", "Double lock", USGA, GHIN or DUPR text.
  - Looked at the "Proposed · does not count yet" card myself: readable; Confirm / "I object" shown to the losing lot's owner.
  - New screens (proposed, objected, disputed, can finish, finished) in Cowboys dark, violet dark and violet light at 430: see the spot-check line at the end.
- Suites, 10 runs each:
  - calcutta, review, round3, round4, round5, round6, alert, cfbd: 10 of 10 each, 0 failures.
  - groups: 8 of 10 (known flake, see Low).

## Could not verify
- Real ESPN status names for suspended / delayed games, real Supabase, the real Groups module wired on main, real golf / events sources.
- Main running with Calcutta ported. Read only: main's groups.js, gstats.js, golfday.js, events.js, server.js.
- A real phone (headless Chromium only).

## The coder's calls (HANDOFF, round 6, 8 items)
1. Custom ends when every team is Out, every slot is paid, or by "Event finished": agree with the first two. "Finished" needs H1: only on tables with no place or champion rows, and with a member confirm.
2. A weekend game with no result holds the event 7 days, then counts as off: agree (tested).
3. An objection blocks a proposed correction; a counting one only gets flagged: agree, plus H2 (objections survive a re-post) and M1 (an exit after 7 days).
4. Ownership by account only: disagree (H3). The confirmer must always own a different sold lot by account; prefer the losing side's owner.
5. Champion = 1st place on Champion-row tables: agree (2,604 ties, 0 uneven).
6. Corrections that end the event are judged oldest first: agree.
7. Score bounds NFL 80 / 75, college football 110 / 100: agree.
8. Fewer results or a missing game wait for a second read 60 s later; result, postponed, moved and live act at once: agree (no flapping, one notice).

## Blocks the hand-off to the port session
- H1, H2, H3 (engine) and M3 (doc). M2 can be done by the port session, but it must be in before anything goes live; it is the port session's switch.

## To-do for the owner
1. Upgrade The Odds API plan if the app sells. This build spends no credits.

## Spot check of the new screens (added at the end)
- New screens (proposed, objected, disputed, can finish, finished) for the commissioner and a member, at 430x900, in Cowboys dark, violet dark and violet light: 108 screens per theme.
- Every theme: 0 page errors, contrast PASS, exit 0 (no sideways scroll, small tap target, banner or text issue).
