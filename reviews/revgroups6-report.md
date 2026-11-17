# Groups round 5 review (v254, commit 4d3c130 on groups-v1, on top of 322d2a0)

Reviewer, read-only. Nov 17 2026. I worked only in my own clone at /tmp/revg6/repo. Nothing in /home/claude/calcutta* was changed. No pushes, no live calls, no Odds API credits, no owner browser.

## Verdict: SHIP AFTER FIXES (live money contests)

The late-news edge is closed. The parlay cap, the parlay loss rule, the per-game void and "Just for me" are all done as the rules say. Money adds up to the cent over 5,000 random seasons.

Before the porting session starts:

1. **Rewrite the port notes against main as it is now (B1).** They were written against main v271 (9eba403). Main is now v273 (9dbfd05). It already has its own Phone Groups file and Golf days. If the porter follows the notes as written, the Groups tab and Golf days stop working.
2. **Honor system: keep the switch hidden for live money, or fix H1 to H3.** With the switch on, a player can still bet on a result he already knows (H1). He can also type any price he likes (H2), and the commissioner can keep a losing prop from ever counting (H3).
3. **Manager decision:** 409 refuse or 200 `personal: true` for a bet that no contest can count (item 5 below).

Everything else can go with the port, or follow it.

## Is there still a way to gain an edge in a money contest?

**With the honor switch off: no real edge found.** These are the small ones left:
- The commissioner can shuffle the head-to-head schedule as many times as he likes before the start, and keep the draw he prefers (M3).
- A member can throw his week against a friend by not betting. Every head-to-head format has this; there is no fix in code (L3).
- In a "carry" contest the commissioner decides when a postponed game is voided. He knows his own parlays when he decides (L4).
- The real risk I cannot test here: how far ESPN's odds trail the books in the last minutes. Our side is fresh. ESPN's lag is not known.

**With the honor switch on: yes, three real edges (H1, H2, H3).**

## Defects

### Blocker for the hand-off

**B1. The port notes are out of date. Followed as written, they break main's Groups tab and Golf days.**
- The notes say: "`pics/groups.js`, `pics/join.js` — new files for main (Phase 2). Take them WHOLE." Main now has its own `pics/groups.js` (v272, 311 lines). Main's `index.html` calls `OddGroups.open`, `.close`, `.join`, `.poke` and `.active`. Main's file also loads `pics/golfday.js` for the Golf day tile (v273).
  - This branch's `OddGroups` has none of `open`, `close`, `join`, `poke`, `isOpen` or `lockChanged`.
  - Taking it whole breaks the Groups tab, invite links and the Golf day tile.
  - The branch's bet, prop, head-to-head, void and weekly-prize screens must be merged INTO main's file.
- The notes say "show the Groups menu item only when GET /groups/on". Main already uses the `me.groups` flag instead (acct.js `gFlag`, groups.js `onFor`).
- The "keep from main" list is missing three things added after v271:
  - The `onFor` and `enabled` exports. acct.js and golfday.js both read them inside try/catch. If they are missing, Groups silently turns off for everyone and every Golf day call is refused.
  - `memberCheck`'s `group` field (used for golfday activity events).
- The test list after the port is missing `groups.phone.test.js` and `golfday.test.js`.
- I tried taking the four server files whole into main (scratch copy /tmp/revg6/porttry):
  - groups, r2, r3, owner, phase1, acct, fix1, phone and golfday all fail; sync.phase1 and pairing pass.
  - fix1 shows that an `__proto__` invite type gives 500 on this branch. Main fixed this; it is on the keep list.
- **Accurate claims** (checked against main):
  - Main's `addCheck`: budget 24, `fresh`, `ctx.miss`, 15-minute `FRESH_MS`, 503 "can't check".
  - `.seen` and `ctx.miss` are read only in main's groups.js `addCheck`.
  - This branch has not touched sync.js since 1e47e93.
  - Main's limits.js and pairing.js equal 1e47e93.
  - Branch changes since then: limits.js 5+ / 2- lines (the notes say 7), pairing.js 11+ / 5-.
  - The `gmut` guard is identical on both sides.
  - Main's `personalOut` / `countable` / `plausible` are as described.
  - Main's parseEv still treats DELAY and SUSPEND as "off". The branch's grade.js changes that, as intended.
- Fix: the coder re-does "Port to main" against 9dbfd05. That means a phone file merge plan, plus `onFor`, `enabled`, `memberCheck.group` and the two test files.

### High (only when the commissioner turns the honor system on)

**H1. Betting on a result you already know: name a later game.**
- Repro: /tmp/revg6/atk/t14.js.
  1. KC@BUF is final.
  2. Bob adds the prop "Mahomes 2+ pass TD" at +500 and names next week's GB@CHI as its game. Answer: "Saved to your group."
  3. After GB@CHI ends, the commissioner's Prop results card shows only the prop text, the stake and the payout. It does not show which game the prop was tied to, or when it was added.
- An honest commissioner will enter "Won", because it is true.
- Fix:
  1. Show the named game and the add time on every prop card.
  2. Build props only from that game's players (main has `propideas.js`), or at least warn "a prop about any other game is void".
  3. Add a "Wrong / not this game" answer that voids the prop (see H3).

**H2. The prop price is whatever the player types.**
- Repro: t13.js, P0 / P5. Bob adds "Mahomes 1+ pass attempt" at +500 (a certainty), and a second one at +5000 (capped to +500). Both are entered and confirmed honestly. Bob: +$1,000, first place.
- The card shows "pays $500 if it won", but nothing lets a member challenge the price.
- Fix: price props at a fixed even money, or need a second member to approve the price at add time. At least say on the rules sheet and the label: "prop odds are typed by the player and not checked".

**H3. A losing prop can be kept from ever counting. No timeout, and nobody can reject a result.**
- Repro: t13.js, P4 / P5.
  1. Ann (commissioner) never enters the result of her own losing prop.
  2. Ann enters a false "Won" on Cat's losing prop. Bob and Dan do not confirm it.
  3. 40 days after the contest, both props are still open. Ann and Cat each have $100 of losses that never count.
- Commissioner plus one friend cannot make a false WIN count: a third member must confirm. Checked: the bettor cannot confirm, and the commissioner cannot confirm her own entry.
- But one person (the commissioner), or a commissioner plus friend, can keep a true LOSS out.
- The same open prop also holds that week's head-to-head matchup and the weekly prize forever (M1).
- Fix:
  1. Add a "Disagree" answer for confirmers.
  2. A prop with no confirmed result 72 hours after its game is settled LOST (or void, by a rule set before the start).
  3. Show "N props waiting for a result" to everyone.
- Is the label honest? "Honor system: results entered by the commissioner" is true but not enough. Suggested: "Honor system: props are priced by the player and settled by the commissioner and one other member. Use only with people you trust."

### Medium

**M1. One open bet in a week holds that week's matchup and weekly prize forever. The money is never paid.**
- Repro: /tmp/revg6/atk/sim2.js. Pool $100, weekly prize 20% ($4 a week). One bet stays open in week 2:
  - Owed total drops to $96.
  - Week 2's two matchups show "not decided".
- Only honor props can stay open indefinitely; every other bet settles or voids.
- Fix: the H3 timeout. Also: at the contest's end, an open week's prize goes to the next week, or to first place, like an empty week.

**M2. A late joiner in head-to-head can place above people who played.**
- Repro: t13.js, Q4. U001 joins after the start (late joining "2 weeks"). He has no matchups, 0-0-0, net +$125. He is ranked 3rd, above Cat (0-0-1) and two players at 0-1-1.
- Ranking is wins, then fewest losses, then net. A player with no games has no losses.
- In a contest where most people have losing records early, he can take a paid place.
- Fix: in head-to-head, a member with no scheduled games ranks below every scheduled member, or late joining is turned off for head-to-head.

**M3. The commissioner can shuffle the schedule without limit before the start.**
- The screen offers "Shuffle the schedule again". Members see nothing of the earlier draws.
- He can reroll until his bye falls in a week he will miss, or he meets the weakest player in a big week.
- Other members' bets are hidden before the start, so this is about the draw, not the bets.
- Fix: one server-made schedule, fixed at the start from a seed nobody controls (the server already does this when there is none). Or log each shuffle with time and count, visible to members.

### Low

- **L1. The handoff overstates the "re-read every minute" claim.** The day copy is kept 1 minute, but the groups tick runs every 5 minutes (4.5-minute spacing per contest). Unless an add reads the game fresh, the kickoff price is the last tick, up to about 5 minutes before kickoff. Adds close at 2 minutes, so this is no edge (t12 A6: a bet added before the news is paid at the pre-news price, same as early bettors). Members on one game can be graded at slightly different kickoff prices: the late adder's own read versus the last tick. Fix the wording, or read every game once inside the last 3 minutes.
- **L2. Weekly prize money can move backward.** If week 2 is still open when week 3 is settled, week 1's carried prize goes to week 3's winner. When week 2 settles later, it moves to week 2's winner. Display only, but "owed" changes after it was shown.
- **L3. Throwing a week.** A member who does not bet hands his opponent a win at no cost. There is no code fix. Say it in the rules ("a forfeit is a loss").
- **L4. Commissioner's game void in "carry" contests.** He can void a postponed game (dropping that leg from every parlay) instead of waiting for the replay, while knowing his own parlays. Fix: in carry contests, only void at 48 hours, or after the contest ends.
- **L5. Head-to-head places ignore "no settled bet".** A member with 0 settled bets can share a place with one who has bets. The money is still right (prizes() skips him), but the "T1" shown is wrong (5,000-season run: shown only when nobody met the minimum).
- **L6. Two void boxes with one key.** The void screen keys each reason box by `pid.bid`. A parlay holding two postponed games gives two "void this game" cards with the same key, so the reason typed in the second box is not found ("Give the reason"). Fix: key by game.
- **L7. A group member who is NOT in a side pot can confirm that side pot's prop results** (`propSet` checks group membership only).
- **L8. Unpaid members can win.** A member not marked paid is still paid places and the weekly prize (main's H4, unchanged here).
- **L9. "Not locked" wording.** The `personal: true` toast says "is not locked" (main's server text); the owner's word is "final".
- **L10. Main-app My Bets (not Groups files, same as the coder reported):**
  - League chips scroll sideways at 360 and 430, and NHL / NCAAB are off screen.
  - 35 to 40 px controls.
  - In violet dark, "Analyze", "Add bet" and "Save prop" are at 2.7:1. In violet light, "Disclosures" is at 1.2:1.
  - On those screens the banner is not under an overlay. The messages are toasts, not Groups overlays.

## Item by item, as asked

**1. Late news.** I attacked it with /tmp/revg6/atk/t12.js and the reruns of t9 / t9b. The add-time fresh read closes the edge.
- News at T-5, Bob types the old +140 at T-3: Saved, but graded at -220 (+$45.45). Same as the early honest bettor.
- 31 to 35 minutes out, with a read from T-41 and news at T-36: graded -220. The 1-minute copy near kickoff, plus the kickoff price, cover it.
- Kickoff delayed 30 minutes at T-10:
  - Adds reopen until the new T-2, then close.
  - The earlier bet stays hidden from others, because ESPN never showed the game in progress.
  - No edge: nothing is shown and the game has not started.
- Early start (t9b): refused.
- ESPN down inside 30 minutes (t9 A2): 503 at every outage length.
- Burst: 64 members in 8 groups add on one game over 16 seconds of server time, ESPN answering in 400 ms:
  - 2 scoreboard reads, 64 of 64 saved.
  - With 20% of ESPN reads failing: also 64 of 64 in my run, because only 2 reads were made. A failed read would refuse the adds that share it inside 5 seconds.
  - Our limiter is 60 bets per account per 10 minutes. It never refused an honest burst.
  - Load on ESPN: at most 1 read per 5 seconds per league-day.
- Worse-of for both sides, favourites and dogs, spreads and totals with alternate lines (t11 rerun): unchanged code, same results as round 4. Always the lower profit.

**2. Whole-parlay cap.**
- Stated on the rules sheet with the $10 example.
- Three +400/+140/+130 dogs win: x6 under +500.
- Typed x2.5, lower than the product: x2.5.
- A dropped leg (postponed): the cap still applies to what is left (code: the cap is applied last).
- Four +900 legs: x6.

**3. Parlay rules.** All as stated:
- Losing leg then a no-price leg: lost (t9 P).
- No-price leg with no loss: void.
- Postponed leg: drops.
- Game void: every member at once (t10 D: Ann and Bob, same result). Members are told at once, and it uses no weekly slot.

**4. Honor props.**
- Result entered during the game: 409.
- Bettor confirming his own: 403. Commissioner confirming her own entry: 403.
- Editing after confirmation: 409.
- Prop with no game: refused.
- Prop added after its game: refused.
- Price over the cap: paid at the cap.
- Commissioner plus one friend cannot make a false win count. See H1 to H3 and M1 for what they CAN do.

**5. "Just for me" and 409 vs `personal: true`.**
- "Just for me" is gone: the confirm step has "Add to my group" and "Cancel" only (Playwright, every size and theme).
- The phone keeps a `personal: true` answer as a personal bet, without the group flag, and shows a toast.
- The server difference is as the notes say: branch 409 with the reason, main 200 `personal: true`. The notes' two-line change to keep main's answer is right.
- The notes are out of date on the phone side (B1).

**6. Head-to-head.**
- Schedules for 2 to 8 players over 1 to 20 weeks: everyone exactly once a week, pairs balanced within 1, byes balanced within 1.
- Frozen at the start: a shuffle after the start is 409. A member cannot shuffle (403).
- The server makes one at the start if there is none.
- Week winner by graded net. Equal nets = tie. Forfeit for fewer than "least bets". Both short = tie (t13 Q2).
- Money over 5,000 random seasons (2 to 8 players, every format, every weekly share, take and split, random entries in cents):
  - Never more than the pool.
  - Never a fraction of a cent, never negative.
  - Exactly the pool in 4,405. The other 595 are places with nobody eligible (562 "fewer eligible than places", 33 "nobody met the minimum"), which is the existing rule.
  - Open bets break this (M1).
- Collusion: see M3 and L3.

**7. The coder's two bugs.**
- This-week prize: fixed. 200 week views compared with the season view: 0 differ in who is owed what.
- Void reason box: fixed. The selector and the markup use the same key, and the void goes through in Playwright. One edge remains (L6).

## Tests

- 9 suites, 10 runs each: 90 of 90 passed, no flakes.
  - alert, cfbd, pairing 10, groups 50, r2 16, r3 37, owner 16, r4 19, r5 23.
  - Log: /tmp/revg6/suites.txt.
- `groups.r5` on 322d2a0: "23 OF 23 ROUND-5 CHECKS FAILED", as claimed.

## Browser

Playwright (Chromium, headless, my clone, the coder's walk script with my own extra checks for off-screen elements, header alignment and "lock" words) at 360x740, 430x900 and 1280x800 in navy, violet dark and violet light. 40 screens each, including Matchups, the schedule screen, Prop results, the void screen, the create screens and the rules sheet.

- 0 page errors.
- On every Groups screen (00 to 26 and 34):
  - No sideways scroll, nothing off screen, no target under 44 px.
  - Headers over their data.
  - Contrast at least 4.5:1.
  - The banner is under the overlay.
  - No "undefined", "Double lock", "USGA", "GHIN", "DUPR" or "lock".
- Issues only on the main app's My Bets screens 27 to 33 (L10) and one "not locked" toast (L9).
- I looked at the Matchups, schedule and prop-confirm screenshots myself: clean, in the live Oddable look.
- Screenshots: /tmp/revg6/shots/<size>-<theme>/. Reports: /tmp/revg6/pw/report-*.json.
- All nine size and theme runs finished. The first batch hit my background time limit after five, and the other four were run again separately.

## Could not verify

- Real ESPN: whether odds stay on the scoreboard until kickoff, how far they trail the books, the real status names.
- Real Supabase, a real phone, a real port onto main's phone file.
- Main's `groups.phase1` checks run against a properly merged tree (only the naive drop-in, B1).

## Coder's own choices (a to h)

- **(a) 5-second reuse:** keep.
- **(b) 1-minute copy near kickoff:** keep, and fix the wording (L1).
- **(c) Forfeit on no counted bet; late joiner has no matchups:** keep the forfeit. Change the late-joiner ranking (M2).
- **(d) Weekly shares, carry, rest to first:** keep, and add an end rule for open weeks (M1).
- **(e) A no-price leg that lost still voids unless a priced leg lost:** keep. A no-price leg never wins, so it is no edge.
- **(f) Commissioner can change a prop result until confirmed:** keep, but add "Disagree" and a timeout (H3).
- **(g) 503 for "could not check":** keep (matches main).
- **(h) Any void uses no weekly slot:** keep.
- **Manager:** Bankroll and Survivor are not built, and head-to-head has no playoffs. Tell the owner.

## Files

- Attack scripts: /tmp/revg6/atk
  - t12: late news, burst, delay, cap
  - t13: honor props, head-to-head
  - t14: past-posting
  - sim / sim2 / sim3: money
  - t9, t9b, t10, t11 rerun
- Outputs: /tmp/revg6/runs
- Port drop-in trial: /tmp/revg6/porttry
- Main checkout: /tmp/revg6/mainx (9dbfd05)

## Proof nothing was changed

- `git -C /home/claude/calcutta-groups status --porcelain`: empty
- `git -C /home/claude/calcutta-groups rev-parse groups-v1`: 4d3c130259de28009aa22658018bf88b79700325
