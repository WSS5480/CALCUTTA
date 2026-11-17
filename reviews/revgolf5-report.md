# Golf v1.4 review, round 5

Repo /home/claude/calcutta-golf, branch golf-v1, commit 13f503e (on 584be99). Independent, read-only. Clone at /tmp/revgolf5/repo. Nov 17 2026.
Main fetched: 8af1f79 (v274). Stats read at 250a4b9, plus UNCOMMITTED work in its working tree (stats.js, pics/stats.js, stats-r5.test.js): it is mid-change.
Scripts: /tmp/revgolf5/t (run_a1..a6.js = attacks, h9.js = 9-hole check). Screens: /tmp/revgolf5/shots.

## Verdict for a LIVE deploy with real pots: SHIP AFTER FIXES

Every round-4 item is fixed as written: C1, H1 (helper refused), H3 (two accounts), H4, M1 to M5.
But five new routes to a pot remain. Each needs at most ONE friend, and two need nobody.

Blocks real-money golf: N1, N2, N3, N4, N5, N6.
Blocks handing to the port session: N7 (stats contract) and P1 to P3 (port facts below). The rule fixes can land before or during the port. They are all in golf.js, and the port copies that file whole.

---

## HIGH (new; each is a way to the pot)

### N1. "Did not finish" after 30 idle minutes: a neutral organizer ALONE, or a playing organizer plus one friend
Repro (run_a1.js B, B2), $10 gross.
- Ann organizes and does not play. Bob (T1) leads after 9 holes. Cat is T2.
- 31 minutes with nothing typed. Ann `team withdraw T1`: 200, with NO signature.
- Bob's undo: 403 "Only the organizer". His hole 10: 409 "withdrawn".
- Final: Cat gets $30. The board shows "WD" and "NSO".
- B2: Ann plays on T3. The same request answers 202 with Cat as signer. Cat signs: 200.

Why it matters: many groups type their scores at the turn or at the end, so 30 minutes with nothing typed is normal.

Fix:
- The idle path always needs a signature, a neutral organizer's too.
- The team's own account can put itself back in, and keep scoring, whenever it likes.
- Measure idle from the expected finish (start + about 4 h 30 min), not 30 minutes.
- Send the team a "still playing?" notice and give it 15 minutes to answer before anyone can sign.

### N2. A playing organizer removes a rival alone, 10 minutes into the round
Repro (run_a1.js C):
- Ann (T1), Bob (T2) and Cat (T3), $10, round started.
- 11 minutes in, Bob has not typed a hole yet. Ann `team kick pid=Bob`: 200, no signature.
- Bob, his card and his paid entry are gone from the game.

The `solo` rule in ACT.remove covers any account whose team has no hole typed yet. It should only cover an account on NO team (the round-4 M2 case).
Fix: `solo` only when `teamsOfP(c, pid).length === 0`. A player on a team goes through the affected-side rule.

### N3. Forced Final signed by the team whose holes were never confirmed
Repro (run_a6.js):
- Ann's card and Bob's card are confirmed. Cat types 18 birdies on his own card; nobody confirms them.
- Ann `final {force: true, reason}`: 202, signers "Bob, Cat". Cat signs: 200. Final.
- Cat is 1st with 54 and takes $30. The round is now "closed for good", so Bob cannot get it reopened.

Fix:
- ACT.final.sig gives `not:` = every team that has unconfirmed holes.
- The signer must come from a side with nothing unconfirmed. Best: a team that ranks lower if those holes count.
- No such signer: refuse.

### N4. One and done prize money: the entrant who gains signs it
Repro (run_a5.js): $10 pool. Ann organizes; Bob and Cat are entrants (Ann also counts as an entrant).
- Ann `oadmoney` puts Cat's golfer at $5,000,000. Answer 202, signers "Bob, Cat".
- Cat signs: 200. Cat is 1st. Bob never agreed.

H2 is fixed for two entrants only. `oadmoney`, `oadrefresh` and `endseason` use `sig: () => ({})`.
Fix:
- The signer must be an entrant whose total does NOT go up from the change. Best: one whose place gets worse.
- Allow manual money only when the feed has no earnings.

### N5. A neutral referee plus one friend change a confirmed hole of the leader to any number
Repro (run_a1.js A, D):
- Ann organizes and does not play. Cat (T2), or Dan (a co-organizer who joined only), disputes Bob's confirmed hole 1 with the note "wrong score".
- Ann `resolve` hole 1 to 15: 200 alone. The board flags NSO.
- In a close game one hole decides the pot.
- Ann can then name another co-organizer to dispute the next hole (naming one mid-round is not signed).

Side effect, possibly a bug: after one settle, Ann counts as INTERESTED (`putHole` stamps `bp = Ann`, so `keeps()` is true). Her next settle on that team needs Bob. So a referee settles one hole per team, then stops being neutral for the rest of the round.

This answers owner question 3, for money games where the organizer is a friend of one team:
- Do NOT let the referee settle a CONFIRMED hole alone. A confirmed hole already had two signatures; it is a `correct` and needs the team's signature.
- The referee alone settles only holes that were entered but never confirmed.
- The value must be one of the two numbers in the dispute (the entered score, or the score the disputer states). Add a required "score it should be" to the dispute.
- Settling should not make the referee "keep" the card. Stamp `bp` as the original typer, or add a `ref` flag that `keeps()` ignores.

### N6. Handicap: organizer and friend inflate the friend's number in a net money game
Repro (run_a2.js G, G2), net $10:
- Cat asks for 36. Neutral Ann `hcpok`: 200 alone. Start: Cat plays off 36.
- G2: playing Ann sets Cat at 36 (nobody asked). Cat signs: 200.
- The 360 screenshot shows the same pattern: "Set by Sir Oddable: 9.0, signed by ChalkEater" on ChalkEater's own row.

The coder treated the player as the affected side. A HIGHER number helps the player and hurts everyone else. This is the same logic the coder already used for PAID / NOT PAID.
Fix:
- Raising a number (above the Oddable / suggested number, or above the last agreed number) needs another team's account.
- Lowering a number needs the player's own signature.
- The stats module is moving to "the organizer approves the Oddable number". Keep golf's gate in front of `eventApprove` (see N7).

## MEDIUM
- M-a. Guests-only teams with two friends. Ann plus one friend account on another team rewrite the cards of teams made only of typed-in guests. Only the NSO flag shows it (rule 3, by design). Suggest: in money games, show "Changed without the team's sign-off" on the payout lines too, and/or require one account on every team that wins money.
- M-b. A Calcutta lot holder is a "side of one" (`lot:pid`). A person who bought Bob's team counts as "the other side" and can sign Bob's own requests. `setLotHolders` should take `{account, teams}` so the holder carries the teams they own.
- M-c. Incomplete course data. Holes not on file play as "standard par" with a warning and one confirm. In NET money games their stroke indexes are made up. Block net money until every hole has an index, or ask for each one.
- M-d. Custom payout table accepts rising splits ("10 30 60" pays 3rd the most). Require non-increasing values.

## LOW
- Ratings show as "70 / 121", not "70.0 / 121".
- No screen check of the organizer's "Remove X from the game" link (CSS min-height 44 is fine; colour `--r` in violet-light not measured).
- groups.test.js "race join" Busy: 7 of 10 failed. Not golf code.
- L2 and L6 from round 4 are still open (stated in HANDOFF).

---

## Item by item
1. Neutral rule.
   - Fixed: C1 (refused), H1 helper (403), H2 with two entrants, H3 (`needTwo`, and casual strips every amount: pot, skins, CTP and match amounts all 0; only the "paid" flags remain, harmless), H4, M3 to M5, Sign all (only the numbers that signer may sign).
   - Holes: N1 to N6.
   - Every POST op was grepped. Not in the route table, all read-only or own data: preview, look, board, events, mine, makeup, suggest, courses, coursedetail. No unguarded writer found.
   - Pending-request cases: covered by round4 M3/M4 (10/10), not re-attacked.
   - `setLotHolders` default: safe. Main has no calcutta.js, so `lotOf` is always false there.
   - Joined-only account removed after 10 minutes: right.
2. Course pick: fixed. 234/234 flow checks at 360x740 and 430x900 (coder's course.py, run on my ports). I checked the screens myself:
   - tee buttons, disabled sticky "Use this course" until a tee is picked, "Back to results", "Course set" card, the 10-of-18 warning, My courses.
   - TWO STORES: golf keeps `lock:golf:myc` and `/golf/mycourse`; the stats contract says one store (`/stats/mycourses*`, `lock:self.data.mc`), with a different course shape. Main's golfcourse.js (OSM `way/...` ids, Golf GPS) is a third course identity.
3. Offline: the list and the card show with no signal, and a typed score waits and sends when back.
   - Exactly once: 3 parallel sends with the same eid gave rev 1 and 1 audit line.
   - Service-worker app shell with no signal: not verified.
4. Other pool and handicap items.
   - Pick six final stored: round4 test 10/10.
   - One and done two reads plus refresh: test 10/10 (but see N4).
   - 9-hole handicap: 2,705 cases (index 0 to 54, 5 ratings) against my own WHS 9-hole formula (index/2 x slope/113 + CR9 - par9, rounded once): 0 off.
   - Skins on withdrawal: hand-checked. "stand" keeps the withdrawn team's won skins, and unwon ones carry among the rest; "void" replays without the team.
   - Without stats.js: Enterprise net starts on the director's numbers (test 10/10).
5. Stats contract (read at 250a4b9 + uncommitted work). Golf must:
   a. Send `extra.card.by = stats.acctRef(accountId)` (a list for team cards), or call `stats.linkRef(key, accountId)`, for every confirmer. golf.stats.test check 3 fails because the two new confirmers are under 30 days old with fewer than 3 games: a FIXTURE problem. Set `S._deps.confirmer` or age the accounts in the test. It passes 10/10 against a07ab04.
   b. Call `eventSetup(directorKey, eventId, {title, sport:'golf', kind: game|flight|tournament|season, lockAt, money, coOrganizers, players:[{key, team, name}]})` for EVERY money game, flight and tournament (today golf calls it for Enterprise only). Re-call it when players, teams or co-organizers change.
   c. Read `use` only (null until approved). Show `suggested`, `provisional`, `makeup` (via `OddStats.makeupHtml`), `reason`, `text`. Never play a provisional number.
   d. Approvals: run golf's own rule first (N6 direction), then call `eventApprove(eventId, playerRef, value, approverAccount, {cosign: signerName, reason})`. "Sign all handicaps" = `eventApproveAll` after golf has the signatures. Handle 409 "suggested number moved".
   e. Director edits through `eventOverride` (already done). Drop golf's own director log (`tset.local` only when stats is absent) and its course-consent list.
   f. My courses: call `stats.myCourseUse` server-side when stats is in the build, and use `/stats/mycourses` in pics/golf.js. Keep `lock:golf:myc` only as the Golf-alone fallback.
   g. Send `won: 0` on finished plays with no payout, and `extra.at` = the server time the result became final.
   h. Pass `{casual: true}` for solo and casual games.
   Re-read stats HANDOFF once the stats coder commits: its working tree changes `eventApprove`, the "organizer always approves" rule and `suggested`.
6. Main (below).
7. Money and screens.
   - 20,000 random payout tables: sums exact, no negatives, ties within 1 cent (only rising custom splits break order; M-d).
   - Two hand-worked rounds: stroke play $10x3 (88 / 72 / 106, Bob $30) and skins (Bob 17, Ann 1, carry on the hole-5 tie): match.
   - Suites x10: golf 10/10, round3 10/10, round4 10/10, calcutta 10/10, alert 10/10, cfbd 10/10, golf.stats 0/10 against stats HEAD (10/10 against a07ab04), groups 3/10.
   - Walk: 504 screens (360, 430, 1280 x navy, violet-light, violet-dark): 0 problems, 0 page errors.

## 6. MAIN (v274) versus this branch: the port

What main has:
- `golfday.js` (240 lines) plus `pics/golfday.js` (inside Groups), behind the Groups switches.
- NO MONEY: no entry, pot or payout.
- The commissioner creates the day (course from golfcourse.js / Golf GPS), and members join with self-typed playing strokes.
- Scores count at once, with no confirmation. The commissioner corrects any hole alone (logged) and changes strokes alone before the first score.
- Closed days feed `gstats.js` lifetime stats (wins, best net).
- `golfcourse.js` (OSM ids), `pics/golfgps.*`, `pics/pga.*`.
- No golf.js, no stats.js, no ratings.js, no calcutta.js.

Which money holes exist on main today:
- None as money holes, because main's golf has no money.
- The trust gaps are wider than this branch's (no second signature at all; a playing commissioner rewrites rivals alone). They only touch "golf wins" in lifetime stats.
- C1, H1 and H3 have no target there. Running golfday.test: 17/17.
- Main's `groups.js wire()` auto-requires `./golf` and registers `potSummary` / `attach`. So the moment golf.js lands on main, golf pots show in the group's main pot. Port the rule fixes WITH golf.js, never golf.js first.

Smallest safe port (golf-v1 forked from v251 at c9a9e93; main is 45 commits ahead):
1. Add, new on main, no conflict: odds-api/golf.js, golf-score.js, golf-feed.js, golf-courses.js, fixtures/*golf*, courses-fallback.json, the golf.*.test.js files, golf.fakestats.js, pics/golf.js, scripts/golf-proof.py, scripts/golf-shots/*.
2. ratings.js: golf-score.js `require('./ratings')`. Main has none, so golf.js will not even load without it. Take the STATS branch's ratings.js (189 lines), not golf-v1's older 153-line copy, then re-run golf.test.
3. server.js: add only the `/golf/` route line and the guarded `registerCalcutta` line. Do NOT take golf-v1's `/groups` line or its ALERT lines (main has its own, newer).
4. pics/sync.js: add `#ogolf` to the "don't repaint" selector (main lacks it).
5. Do NOT port golf-v1's groups.js, pics/groups.js, pairing.js, acct.js, sync.js, alert.js, helper.js, index.html, sports.html or sw.js. Main already exports what golf needs: `acct.who / isOwnerPhone / namesGet / ownerName`, `sync.dbIds`, `limits.keyOf / maxPeople / isEnterprise / recordPlay`, `groups.attachGame`. Bump main's own sw.js and version.
6. Entry point: main's Groups screen has a "Golf day" tile into golfday.js. Decide one of these:
   - (a) Keep golfday for casual group rounds, and add golf.js as "Money golf" behind its own switch (GOLF_ENABLED off by default), opened from the More sheet.
   - (b) Retire golfday after golf.js is live.
   Two golf engines with two course sources (OSM vs OpenGolfAPI) and two stores is the main risk. Golf has no `inviteInfo` export, so group invites cannot open a golf game: add it, or keep `gjoin`.
7. Order: fix N1 to N6 on golf-v1, then ratings.js, then golf files, then the server.js route, then the sync.js guard, then the switch. Stats integration (item 5) after the stats branch merges.

Conflicts expected: none in golf files (all new). Main's own HANDOFF (append a section). Watch `lock:golf:*` against `lock:gd:*` (distinct rows).

## Coder's own decisions (recommendations)
- Skins stand on withdrawal (default): keep.
- 30-minute idle DNF: change (N1).
- Referee settles alone: only unconfirmed holes, and only to one of the two disputed numbers (N5).
- Enterprise guests-only one forced Final: keep.
- Organizer and player agree a handicap: change direction (N6).
- Lot-holder default: keep, plus teams (M-b).
- NOT PAID by the player, PAID by another side: keep.
- Two reads for a pool result: keep.

## Could not verify
Anything live. The service worker with no signal. Real phones. The stats branch's uncommitted code (moving). Main's golf-day screens (not run).

## Proof nothing changed
`git -C /home/claude/calcutta-golf status --porcelain` printed nothing. `rev-parse golf-v1` = 13f503ef88758e6fd878a90cfb18e9836e09def9. Stats HEAD is still 250a4b9; I only read it.
