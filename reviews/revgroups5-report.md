# Groups round 4 review (v254, commit 322d2a0 on groups-v1, on top of 1e47e93)

Reviewer, read-only. Nov 16-17 2026. Worked only in my own clone at /tmp/revg5/repo. Nothing in /home/claude/calcutta* was changed. No pushes, no live calls, no Odds API credits, no owner browser.

## Verdict: SHIP AFTER FIXES (not as it stands, for live money contests)

The round-3 holes are closed. The new counting rule is sound in its main line: I could not get a price better than the posted one before kickoff, and I could not turn a losing bet into a void on purpose.

Four things must be done before live money:

1. Fix High 1 (stale price in the last minutes before kickoff). It is a real edge.
2. Fix High 2 (honor-system contests can be won with made-up props) or keep the honor switch hidden.
3. Remove "Just for me" (High 3, owner decision).
4. Run one check against real ESPN on a game night (see "Could not verify"). The whole rule rests on ESPN showing odds in the last 30 minutes before kickoff. Nobody has seen that yet.

## Does any way remain to gain an edge? Yes, two real ones and three small ones.

Real:
- **Late news, old price (High 1).** Bet in the last minutes after news breaks. You are paid at the price the server read up to 10 minutes earlier (up to 30 if ESPN is not answering). Run: MIA went from +140 to -220 five minutes before kickoff. Bob bet MIA one minute before kickoff and was paid +$140. The honest player got +$45.45.
- **Honor-system contests (High 2).** Only where the commissioner turned it on. A member added a "prop" after the game was over, marked it won, and was credited +$1,000,000 on $100.

Small:
- A game that starts a few minutes before its listed time can be bet after it started, for up to 10 minutes (Medium 2).
- If ESPN moves a kickoff later after the listed time has passed, others' bets were already shown and adds open again (Low 1).
- The commissioner can void one member's whole parlay, and not her own identical one, when its first leg is postponed (Medium 4).

Not an edge but it decides contests: a 4-leg parlay pays up to x1296 with "Longest odds +500" (Medium 3).

Everything else failed: forcing a void after seeing a result, server-outage voids on purpose, the 30-minute window edges, duplicate rule, postponement, weekly limit, stake splitting, both sides, alternate lines in every sport, favourite / dog sign handling (25 price pairs), props without the honor system, a member turning the honor system on, Kalshi path, replay, same id twice, unknown game ids.

## How often will honest players see voids?

From the rule, with the server healthy and ESPN showing odds until kickoff:
- NFL, NBA, MLB, NHL: rare. About 1 bet in 50 to 100. Causes: a game taken off the board near kickoff, an ESPN blip longer than about 20 minutes.
- College football and basketball: a bet with no price is refused when added, which is clear. Of the ones accepted, I estimate 2 to 5 in 100 void, where the book pulls the price before kickoff.
- My live-like run (tick every 5 minutes): 6 of 6 honest moneylines across 4 sports graded, 0 voids.

Bad days void everything on a game at once:
- Server down or asleep for the 30 minutes before a kickoff: every bet on that game voids (run A3).
- ESPN not answering from 31+ minutes before kickoff: same (run A2).
- If ESPN removes odds from the scoreboard more than 30 minutes before kickoff in any league, 100% of bets in that league void (run A4). This is the unverified risk.

## Defects

### High

**H1. Price can be up to 10 minutes old (30 in an outage), and bets are taken until kickoff.**
- Why: the scoreboard is cached 10 minutes. The add step uses that cache. Grading uses the last read before kickoff, even if it is older than the bet.
- Repro: /tmp/revg5/atk/t9.js, runs A1 and A2.
  1. Server reads ESPN 9 minutes before kickoff: NE -160 / MIA +140.
  2. 5 minutes before kickoff ESPN shows MIA -220.
  3. Bob adds MIA moneyline, typed +140, 1 minute before kickoff. Answer 200.
  4. MIA wins. Bob: +$140, "Moneyline at +140 (the price at kickoff)". Honest Cat: +$45.45.
- A2: ESPN stops answering 29 minutes before kickoff. Bob's late bet is still accepted and paid +$140. The rule says "ESPN unreadable: refused". The add step only refuses when the game is missing from the cache.
- Where it bites: NBA late scratches, MLB pitcher changes, weather.
- Fix:
  1. In the add step, when the game starts within 45 minutes, read ESPN fresh (no cache). If that read fails, refuse with "Couldn't check this game".
  2. Cache 1 minute, not 10, for a league-day with a game starting inside 45 minutes.
  3. A bet needs a price read at or after it was added (ra >= add time), else void. Or close adds 5 minutes before kickoff.

**H2. Honor-system contests: a prop can be added after the game, with any payout.**
- Repro: /tmp/revg5/atk/t10.js, run C3. Contest with honor on, cap $100, longest odds +500.
  1. After the KC@BUF final, same day, Bob adds `{kind:'prop', text:'Mahomes over 250 pass yds', odds:5000, stake:100}` with no game id. Answer "Saved to your group."
  2. His phone syncs `fin:'won', finPL:1000000`.
  3. Standings: Bob +$1,000,900, first place.
  4. He also added "Chiefs to win" as a prop after the final: +$900. So "Player props only, game bets are always graded by Oddable" is not true.
- A prop that names its game (pp.gid) is refused after kickoff. Leaving the game out skips the check.
- Fix: a prop must name its game and be added before that kickoff. Pay from the typed price at add time, capped at "Longest odds", never from finPL. Apply the stake cap. Until then, hide the honor switch.

**H3. "Just for me (does not count in groups)" is still on the confirm step.**
- pics/groups.js line 598. Owner has decided: no such choice in a group contest.
- Fix: remove the button. Also review coder choice 4 (offline, phone last knew "no group": the bet is kept personal without a message).

### Medium

**M1. "Saved to your group." for a bet that is already sure to void.**
- Run A2: ESPN down from 31 minutes before kickoff. A bet added 1 minute before kickoff gets "Saved", then voids.
- Fix: same as H1 step 1.

**M2. In-game bet when a game starts before its listed time.**
- Repro: /tmp/revg5/atk/t9b.js. MLB game, first pitch 8 minutes early, another member already has a bet on it (so the scoreboard is cached). Bob bets 7 minutes into the game: "Saved", graded, +$71.43.
- Likely cases: second game of a doubleheader, resumed games.
- Fix: H1 step 1 covers it.

**M3. A parlay can pay x1296 while the rules say "Longest odds that count +500".**
- /tmp/revg5/atk/t11.js: four +900 legs, cap +500: $129,500 on $100. The cap is per leg.
- Not an edge against the price, but in a "Winnings" contest one such parlay decides the season. The rules sheet says "A bet at longer odds is graded as +500".
- Fix (manager decision): cap the whole parlay, or say "per leg" on the rules sheet and the create screen.

**M4. Commissioner can void a whole parlay, one member at a time, for a postponed first leg.**
- Repro: t10.js run D. Ann and Bob hold the same 2-leg parlay. Leg 1 is postponed. Ann voids only Bob's. Leg 2 wins. Ann +$62.50, Bob $0.
- The automatic rule already drops that leg at 48 hours.
- Fix: the "postponed" void acts on the game for every member at once, and in a parlay only drops that leg.

**M5. A lost parlay can come back as void.**
- Run P: leg 1 lost Sunday. Leg 2 the next week had no price at kickoff. The parlay shows nothing for a week, then "void".
- Nobody can force it, so no edge. It will cause arguments.
- Fix: a parlay with a lost leg is lost. A no-price leg voids it only when no leg lost.

### Low

- L1. ESPN moves a kickoff later after the listed time passed: bets were shown for a few minutes, then hidden again, and adds reopen (run F). Fix: show others' bets only once ESPN says the game is in progress.
- L2. Odds reading takes the "open" price when the new block has no "close", even if the classic field has a current price (-150 used, -260 current). Not seen on real ESPN. Fix: current or close first, never open.
- L3. NFL spreads for Washington, Jacksonville and the LA Rams are lost when ESPN only sends the old "WSH -3" text. Result: "No line posted", never a wrong grade.
- L4. Wording. "Any bet in My Bets" on the rules sheet, standings line and create screen (only added bets count). "1 settled bets". The version line in index.html says "group bets lock when added".
- L5. index.html in this branch still draws "Double Lock" in the main app. Not from this commit. Check at merge.
- L6. Sign-in screen (main app): "Sign in" at 3.9:1, the words "coming soon" and "locked". Not Groups files.
- L7. A commissioner's void uses a weekly slot; a no-price void does not.
- L8. An early bettor whose line runs their way is paid very little (BUF -2.5, closes -7: $2.69 on $100). By the rule, but nothing at add time warns of it.

## What a commissioner can and cannot create now

Can create:
- A group with a picks contest in the main pot.
- Formats: Standings, Best five. Nothing else.
- Sports: All, NFL, college football, NBA, MLB, NHL, college basketball.
- Length: weekend, 1 to 8 weeks, season, playoffs, custom dates.
- Bets: spread, moneyline, totals, props (honor only), parlays 2 to 10 legs, Kalshi-tagged only.
- Winner by Winnings, Units, Return %, Win %. Weekly most / least bets. Stake cap. Longest odds. Fewest bets to place.
- Entry, payout split, commissioner's take (none / percent / flat).
- More picks contests, main pot or side pots. Members opt in to side pots. Main-pot split.
- Invite link and code, requests, approve / deny, mark paid, void under the rules, Suggest partners.

Cannot create (missing against the owner's Groups decisions and the earlier promise):
- Head-to-head with playoffs. Hidden.
- Bankroll challenge. Hidden.
- Survivor. Hidden.
- Weekly high-score prize payout. Hidden. The server still works out the weekly high score; the prize line is gone.
- Calcutta, golf contest, local event inside a group: no button in this branch, because no engine is in it. The button appears only when an engine registers a start handler. The owner's rule says a group holds picks contests, Calcuttas, golf and local events. This depends on the merge.

Owner rules that are met: graded from final scores, honor off by default, hidden until kickoff, rules final at start, money rules final once someone joins, take, ties, minimum bets, all six sports, several contests with main and side pots, invites, 8 people, enterprise text and billing count.

## Previous review: each defect

- C1 unmatched game paid even money: fixed. Every variant refused.
- H1 even money with no price: fixed. Refused at add, void at kickoff.
- H2 void during play: fixed. Delay in the 3rd quarter and moved time both give an empty void list.
- M1 placeholder kickoff: fixed (but see L1).
- M2 depended on a tick: fixed. Decided from stored read time.
- M3 rules text: fixed, see L4.
- M4 "Saved" for bets that never count: fixed for legs, hedge, limits, bet kind. One case left (M1 above).
- M5 label differs from grade: fixed. "SP" refused, moneyline line dropped, "Graded as" shown.
- L1 USGA / GHIN / DUPR: gone. L2 contrast: clean. L3 "Coming soon": gone from Groups. L5 billing: once per player per game, 12 racing calls counted once. L6 requests: pages of 50. L7 cache name changed. L8 header: aligned.

## What I verified

- Counting rule 1 to 7 as written, except the ESPN-unreadable case in H1.
- Worse-of price: 25 typed and posted pairs, favourites and dogs, always the lower profit.
- Window: read exactly 30:00 before kickoff counts; 1 ms earlier, or at kickoff, is void.
- Line moves with a live-like server: early BUF -2.5, close -7: -3718. Early Over 47.5, close 51: -232. Typed +140, close -160: -160. Puck line typed +150, market -200: -200.
- Alternate-line prices are worse than fair in every sport, both directions.
- Member cannot turn on the honor system (403). Props, game bets dressed as props, non-game Kalshi markets and prop legs in parlays are all refused with honor off.
- Earlier attack scripts t1 to t8 rerun: joins, 100 from one IP, code visibility, hidden bets, pots to the cent (4,000 random pots), idempotent add, two phones, stake caps, hedges. All hold.
- `OddJoin.registerGame / openGame / canCreate`: work as documented, both type names, empty code never reaches an invite handler.
- Tests: 8 suites, 10 runs each, 80 of 80 passed, no flakes. The r4 suite fails 19 of 19 on 1e47e93, as claimed.
- Browser: 360x740, 430x900, 1280x800 in navy, violet dark, violet light. 28 screens each. 0 page errors. On Groups screens: no sideways scroll, no target under 44 px, banner covered, headers over data, contrast clean, no "lock", "undefined", "Double lock", "USGA", "GHIN", "DUPR". Violet light is light.
- Void row reads: "No posted price at kickoff — this bet did not count. Your stake is back: no win, no loss."

## What I could not verify

- Anything on real ESPN (sandbox blocks it): whether odds stay on the scoreboard until kickoff in each league, the odds field shape, the event lookup, status names for postponed and delayed games, placeholder times.
- Real Supabase, a real phone, a real Kalshi sync.
- Calcutta, golf and events engines with groups (not in this branch).
- Tick duration with thousands of groups.
- pics/classic.html.

## Coder's own choices

1. 30-minute window: keep, with the H1 fixes.
2. Refuse at add when no price is posted: keep.
3. No-price leg voids the whole parlay: change as in M5.
4. No-price void uses no weekly slot and is not a push: keep.
5. Honor system for true props only: right intent, not enforced. See H2.
6. Save when it counts in at least one contest, list the rest: keep.
7. Hide head-to-head, bankroll, survivor and the weekly prize: honest. The manager must tell the owner they are missing.
8. "Final" wording: keep. Finish L4.

## Files

- Attack scripts: /tmp/revg5/atk (t9.js, t9b.js, t10.js, t11.js, plus t1 to t8 and h.js)
- Outputs: /tmp/revg5/runs (t9.txt, t9b.txt, t10.txt, t11.txt, old-t1..8.txt, suites.txt)
- Browser: /tmp/revg5/pw (run.js, report-*.json), screenshots /tmp/revg5/shots

## Proof nothing was changed

- `git -C /home/claude/calcutta-groups status --porcelain`: empty
- `git -C /home/claude/calcutta-groups rev-parse groups-v1`: 322d2a0591fb137473fe1b1ffc7b32cf97103c8d
