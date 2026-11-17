# The Oddable Playbook

Every play in Oddable, in plain words. What it is, how Oddable runs it, why, how someone could cheat or argue, and a verdict.

Written Nov 16 2026 from the owner decisions file, each build's HANDOFF notes and the code itself. Standard rules were checked against outside sources (listed at the end).

## Read this first

**Money.** Oddable never collects, holds or pays money. Every dollar figure in the app (entry, pot, take, payout, who is owed what) is information only. People settle up outside the app.

**The server is the judge.** Picks, locks, grades, auction clocks and standings are decided on the Oddable server, not on anyone's phone. Every phone shows the same thing.

**Everything leaves a trail.** Scores, bids, changes and disputes are written to a history that members can read.

**How to read the status line on each play.**

- **Built and reviewed** = committed code that an independent reviewer has been through.
- **Built, review pending** = committed, waiting on the full review you asked for (R1).
- **In the working copy** = the coder has written it, but it is not committed or reviewed yet. Your newest rules (G16, H1, E-H, P1) are in this state in Groups, Golf and Local events.
- **Not wired yet** = the pieces exist but are not connected, so players cannot use it today.

Nothing in this book is live yet. None of these builds has been pushed or deployed.

**Words used.**

- **Spread** = the points a favourite must win by. "+3.5" means that team can lose by 3 and the bet still wins.
- **Cover** = win the bet against the spread.
- **Price** = what the book charges. "-110" means bet $110 to win $100.
- **Unit** = one standard bet. "+2.5 units" means you are up two and a half bets.
- **Push** = a tie against the spread. Stake comes back.
- **Commissioner / organizer** = the person who set the game up.
- **Gross / net** = a golf score before / after handicap strokes come off.

## Contents

- Part A. Weekly picks (plays 1-6)
- Part B. Group contests (plays 7-9)
- Part C. Calcutta (plays 10-12)
- Part D. Pro golf pools (plays 13-14)
- Part E. Golf day formats (plays 15-30)
- Part F. Pickleball and local events (plays 31-38)
- Part G. Handicaps, ratings, partners and limits (plays 39-43)
- The lists: every Weak spot, and every choice not made by Steve
- Sources checked

## Part A. Weekly picks

These are Oddable's own NFL picks, shown to everyone. Nobody plays against anybody here. The risk is not cheating by players. The risk is Oddable grading itself kindly. The rules below are built to stop that.

### 1. The Lock

**Status:** Built and reviewed (v252 + v253, ships together).

**What it is.** One NFL pick against the spread each week. It is the model's second most confident pick of the week. The most confident pick used to be the "Double lock". You retired it because it did worse.

**Example.** On Wednesday the Lock is Dallas -2.5 at -108. On Saturday the line moves and the model now likes Denver +3.5 more. The Lock moves to Denver. One hour before Denver kicks off it freezes: "Final at +3.5 (-112)". Denver loses by 3. The Lock wins and is graded at -112: +0.89 units.

**How Oddable runs it.**

- The server picks it. Phones only display it (D2).
- It is a live pick until 1 hour before its own game. Then it is frozen at that line and that price, and graded there (D5, D9).
- Until it freezes it can move to another game. The screen says: "Live pick: can change until 1 hour before kickoff. Bet early at your own risk."
- A game that passes its 1-hour mark while it is not the Lock can never become the Lock that week (D9).
- There is always a Lock. If nothing else is left, the top game still in the running becomes the Lock (your call, Nov 16).
- Graded at the real price stored at the freeze. Never an assumed -110. No price stored = no payout shown (D7).
- Postponed games are not graded.

**Why it's set that way.** A pick that is frozen before the game, at a real line and a real price, cannot be improved after the fact. That is the honest way to keep a record. Most pick services quote a line nobody could actually get. Oddable does not.

**How someone could cheat or argue.**

- "The Lock changed after I bet it." True, and the screen warns about it. The record only counts the frozen pick.
- "You graded at a better line than I got." The frozen line and price are stored in the database with the time. A line first read after the 1-hour mark cannot move the Lock.
- "Oddable can pick after the result." The server never computes weeks that have shipped, and a pick frozen late is marked with a star and "frozen late".
- "Lock" sounds like a sure thing. It is not. Over 12 seasons the same method went 108-94 with 7 pushes. That is about 53.5%, against a 52.4% break-even at -110.

**Verdict: Sound.** The process is honest. The edge is thin, so keep the record and the break-even number next to the Lock every week. One coder reading to confirm: the "skip the #1 pick" rule (see the list at the end).

### 2. Division road dogs

**Status:** Built and reviewed.

**What it is.** A "road dog" is the away team when it is the underdog. A "division" game is between two teams from the same division, who play each other twice a year. Oddable lists every division road dog each week. The ones the model gives 53% or better to cover are "picked". The rest are shown as "not picked" and still tracked.

**Example.** Arizona +3.5 at San Francisco, same division. The model says 55% to cover. It is a picked road dog. Arizona loses 24-21. The pick wins.

**How Oddable runs it.**

- Each road dog freezes 1 hour before its own game: line, price, model % and picked-or-not (D5).
- If the Lock and a road dog are the same game, they freeze together at one line and one price (D9).
- Graded against the spread at the stored price (D7).
- The 53% cut-off is the picked / not picked line (D6 uses it too).

**Why it's set that way.** Division underdogs on the road have covered a little more than half the time: 53.3% from 2004 to 2025. The idea is that division teams know each other well, so the games are closer than the line says.

**How someone could cheat or argue.**

- "You found this by digging through the data." Fair. The HANDOFF says about a dozen slices were tested before this one stood out. That is how false patterns get found. The app's own info sheet says "not proven".
- "The model's 53% filter adds nothing." Close to true. Over 12 seasons picked dogs went 140-120 (53.8%). The ones the model passed on went 199-174 (53.4%).
- Grading arguments: same protection as the Lock.

**Verdict: Sound** as a tracked rule, honestly labelled. Do not sell it as a proven edge. Keep the "not proven" wording on screen.

### 3. The Oddable Alert of the week (and the Helper)

**Status:** Built and reviewed.

**What it is.** The Alert is the weekly card: the Lock plus every picked division road dog. It also shows the Helper: the team with the best chance to win outright that week. The Helper is a "to win" pick, not a spread pick.

**Example.** Week 9 Alert: Lock (Tampa Bay -3), two picked road dogs, Helper "Buffalo to win". The card shows each pick's line, price, and live or final.

**How Oddable runs it.**

- All of it comes from the server. Same on every phone (D2).
- Units are counted at real stored prices (D7). A settled pick with no price is left out of the units and counted on screen as "no price".
- The Helper freezes 1 hour before its own game, like the Lock (D9). It is not counted in the Alert's units, because heavy favourites carry a steep price.
- "Lock" now means only this weekly model pick. The old lock wording is gone. The Double lock is retired.

**Why it's set that way.** One card, one source, one record. Twelve seasons of the same method: 248-214 with 12 pushes, 53.7%, about +11.5 units at -110 on 474 picks.

**How someone could cheat or argue.**

- "The record on my phone is different." It cannot be now. Before v252, phones froze picks themselves and records differed. That is why you ordered D2.
- "Week 10 was graded wrong." Week 10 was frozen by a phone with a stale line. You ordered it regraded at closing lines (D4), through an owner-only route, and the change is logged.
- "Why isn't the Helper in the units?" Because a -400 favourite winning adds almost nothing and a loss costs four. The sheet says so.

**Verdict: Sound.**

### 4. 2-game parlay

**Status:** Built and reviewed.

**What it is.** A parlay is one bet on two or more picks. Every pick must win. It pays more because it is harder. Oddable's 2-game parlay is the Lock plus the highest-rated picked road dog (D6).

**Example.** Lock at -110 and road dog at -105. Decimal prices 1.909 and 1.952. Multiply: 3.73. A 1-unit bet wins 2.73 units if both cover. If either loses, you lose 1 unit.

**How Oddable runs it.**

- The server builds it. The road dog must be 53% or better and not the Lock's own game. No such dog = no parlay that week (D6).
- Each leg freezes with its own game. A frozen leg stays. A leg not yet frozen can still change (D9).
- Payout = the legs' real prices multiplied together. A leg with no price = no payout shown (D7).
- A pushed leg drops out: the 2-game becomes a single bet. A lost leg loses the parlay.

**Why it's set that way.** That is exactly how a sportsbook grades a parlay: multiply the prices, a push drops the leg. So the tracked result matches what a real bettor would have got.

**How someone could cheat or argue.**

- "You only show the winning weeks." Every week's parlay is listed in the drill-down, with the same legs bet straight shown next to it.
- "This season looks great." It does: 4-4, +6.50 units in weeks 1-9. But the 12-season test of the same rule is 36 wins in 147 weeks, +1.1 units, hit rate 26.1% against a 26.7% break-even, and it lost money in 8 of 12 seasons.

**Verdict: Weak spot.** The mechanics are right. The play itself is roughly break-even over 12 seasons and swings hard. **Fix:** put the 12-season line ("lost money in 8 of 12 seasons") on the parlay row itself, not only in the drill-down, and call it a tracker, not a recommendation.

### 5. 3-game parlay

**Status:** Built and reviewed.

**What it is.** The Lock plus the top two division road dogs by model %, picked or not (D6).

**Example.** Three legs at -110 each: 1.909 x 1.909 x 1.909 = 6.96. A 1-unit bet wins 5.96 units if all three cover.

**How Oddable runs it.**

- Fewer than two road dogs that week = no parlay (D6).
- A leg under 53% is labelled "not an Alert pick" (D6).
- Same freeze, price and push rules as the 2-game. A push makes it a 2-game.

**Why it's set that way.** You asked for both parlays ("Add both"). The label on weak legs is there so nobody thinks all three legs are Alert picks.

**How someone could cheat or argue.**

- "Two of your three legs weren't even your picks." The label says so.
- "Where is the history?" There is none. The 12-season test was never run for this rule. The app says "history not run yet". This season is 3-4, +13.67 units, on seven bets. Seven bets prove nothing.

**Verdict: Weak spot.** It is published every week with no long-run test behind it. **Fix:** run the 12-season backtest before promoting it. Until then show "no long-run record yet" on the row.

### 6. "Move the line?"

**Status:** Built and reviewed.

**What it is.** Books let you buy points (a better line, worse payout) or sell points (worse line, better payout). This sheet tells you whether moving is worth it for each pick and each parlay leg (D8).

**Example.** The Lock is +2.5 at -110. Buying a half point to +3 matters, because lots of NFL games end on 3. The sheet says the half point onto 3 is worth paying up to about -131. If your book charges -125, take it. If it charges -140, don't. Most other half points are only worth about -116.

**How Oddable runs it.**

- Uses real results from 2014 to 2025: 3,151 regular-season games. For each line, how often the game landed on each number.
- Shows buy 1/2, 1 and 1.5 points and sell 1/2 and 1 point. For each: chance to cover, chance to push, and the most you should pay or the least you should take.
- Never shows a made-up book price. It says "compare with your book" (D8).
- If the pick has no stored price, it compares against nothing and says so. The -110 stand-in was removed (D7).
- Dogs at +1.5 to +2.5 link to the teaser sheet.

**Why it's set that way.** Oddable has no live feed of alternate-line prices. Showing a guessed price would be a fake. So it shows the value of the move and lets you check your own book.

**How someone could cheat or argue.**

- "My book's price is different." Expected. The sheet gives a limit, not a quote.
- "Where does 'not worth it' come from?" When buying gains less than 6 cents of price, the sheet says not worth it. That 6-cent line is a coder's rule of thumb, not measured.

**Verdict: Sound.** One coder choice to confirm: the 6-cent cut-off.

## Part B. Group contests

A group is a private league. It can hold several contests. Members compete with real bets. Standard accounts hold up to 8 people.

### 7. Picks contest: Standings

**Status:** Built, review pending. The lock-on-entry rule (G16) is in the working copy.

**What it is.** Everyone bets real games. The app ranks members by the measure the commissioner chose: winnings, units, return %, or win %. Best at the end takes the pot.

**Example.** Eight members, $50 entry, ranked by winnings. Ana ends +$412, Ben +$390. Ana is 1st. A bet of $200 with a $100 cap counts as $100: a $181.82 win counts as $90.91.

**How Oddable runs it.**

- **Graded by Oddable.** Results come from final scores on the server, never from the phone (G11). Covers NFL, college football, NBA, MLB, NHL, college basketball (G12).
- **Locked when added.** A group bet is saved to the server the moment it is added. Then it cannot be edited, deleted or swapped, even before kickoff. If the save fails the bet is not placed: "Not saved, try again" (G16).
- **No late bets.** A bet the server first sees at or after kickoff never counts. Kickoff times are stored once, not re-decided later.
- **No peeking.** Other members' bets are hidden until the game kicks off. The server does not send them early. You see a count only (G6).
- **Honor system is off by default.** Bets the app cannot check (props, cash-outs, unknown games) count only if the commissioner turned on "Count bets the app can't check (honor system)".
- **Rules lock.** All rules lock at the start. Money rules (entry, take, split, cap, measure, bet types) lock as soon as anyone else joins or asks to join (G2).
- **Fewest bets to win money.** 10 for a season, 3 for a weekend. Fewer than that and you cannot place in a paid spot.
- **Ties.** Return % breaks a tie. Still tied: the tied places' prize money is added up and split evenly, to the cent.
- **Void.** Only the commissioner can void a bet, only under the void rules (a postponed game, for example), with the reason logged and shown (G16).

**Why it's set that way.** This is how fantasy and sportsbook contests work: entries lock, the house grades, nobody sees your lineup early. Locking at entry (G16) is stricter than most. It removes every "I changed my mind" argument.

**How someone could cheat or argue.**

- *Add the bet after the game.* Blocked: first-seen time is the server's clock.
- *Delete the losers.* Blocked: the server's ledger keeps them.
- *Copy the sharp guy.* Blocked: hidden until kickoff.
- *Fake a win on my phone.* Blocked: the phone's result is ignored unless honor system is on.
- *Change the rules mid-season.* Blocked for everyone, commissioner and owner included.
- *"My bet didn't count."* Your own view explains why each bet does not count. One real gap: college games outside the top division are not in the score feed, so they show "Game not found" and do not count.
- *Honor system on.* Then anyone can lie. That is why it is off by default and those contests are marked unverified in stats.

**Verdict: Sound,** once G16 is committed and reviewed. Small fix: when a player adds a bet the app cannot grade, say so right then ("This bet can't be checked and won't count"), not later.

### 8. Picks contest: Best five

**Status:** Built, review pending.

**What it is.** Same as Standings, but only each member's five best results per week count.

**Example.** Cal makes 12 bets in a week. His best five are +$310. His other seven lost $400. His week counts as +$310.

**How Oddable runs it.**

- Best five by profit (or by units, if the contest ranks by units or win %).
- Weeks run Tuesday to Monday for every sport.
- Everything else is the Standings rules: server grading, lock on entry, hidden until kickoff.

**Why it's set that way.** It keeps a bad Sunday from ending someone's season, so people stay in. Daily fantasy "best ball" leagues use the same idea.

**How someone could cheat or argue.**

- *Volume.* The more bets you make, the better your best five will look. Twelve coin-flip bets will nearly always contain five winners. A careful member who makes five bets is at a real disadvantage.
- *"A week" is unclear* for sports that play every day. Tuesday to Monday was a coder's choice.

**Verdict: Weak spot.** Best five rewards betting more, not betting better. **Fix:** add a "most bets per week" rule to this format (for example 8), or count the best five and the worst one. Show the rule before joining.

### 9. Main pot, side pots and the commissioner's take

**Status:** Built, review pending.

**What it is.** A group has one main pot and can have side pots. Every contest sits in one of them. Everyone is in the main pot. Members choose whether to join each side pot. The commissioner can take a cut.

**Example.** Eight members at $50 = $400. Take 10% = $40. Prize pool $360. Split 60/30/10 pays $216, $108, $36.

**How Oddable runs it.**

- Take: none, a whole percent from 0 to 50, or a flat dollar amount. Never more than the pot. Shown to everyone before they join (G10).
- Prize pool = entries marked paid, minus the take. The commissioner marks who has paid.
- The main pot is shared between its contests: even, 50/50, 40/60, 60/40 or custom (G13).
- Side pots have their own entry, take and paid marks.
- Money rules lock once anyone else joins. Leftover cents go to the higher place so the split always adds up exactly.
- Oddable shows who is owed what. It never moves money (G7).

**Why it's set that way.** People should join on the terms they saw. Showing the take up front is fairer than most office pools, where the organizer's cut is a surprise.

**How someone could cheat or argue.**

- *The commissioner marks himself paid and others not.* Everyone can see the paid marks and the pot breakdown.
- *The commissioner raises his take later.* Locked once anyone joins.
- *"I never agreed to the side pot."* Side pots are opt-in only.
- *The commissioner doesn't pay out.* Oddable cannot stop that. It can only show the numbers. This is true of every pot in the app.

**Verdict: Sound.** Not built yet and shown as "Coming soon": head-to-head, bankroll, survivor, weekly high-score prize. Calcutta, golf and local-event contests also show "Coming soon" inside the group hub (see play 30).

## Part C. Calcutta

A Calcutta is an auction pool. Before an event, people bid to "own" each team or player. The bids make the pot. Owners are paid by how their team does.

### 10. The Calcutta auction

**Status:** Built and reviewed (two review rounds).

**What it is.** The commissioner lists the teams ("lots"). Weak teams can be bundled as one lot called "the field". Members bid. Highest bid owns the lot.

**Example.** NFL playoffs. Kansas City sells for $201, "the field" of four long shots for $40. Total bids: $1,003. That is the pot.

**How Oddable runs it.**

- The commissioner sets: the event, the lots, lowest bid, bid step (whole dollars), timer (10, 20 or 30 seconds), order, payout table, take, and Main or Side.
- **Rules lock at the first bid.** Nobody can change them after, including the commissioner.
- **The server is the clock.** The timer starts at the first bid on a lot and resets on every new bid. When it runs out the lot is sold. The next lot opens 8 seconds later.
- You cannot raise your own high bid. Two equal bids at the same instant: exactly one lands, the other is told "Outbid".
- Commissioner tools: pause, resume, undo last bid, undo a sale, sold now, next lot, reorder, end. Each one is written to the history.
- **"Enter results" mode** for a live auction held in a bar: the commissioner types who bought what. Changes after the auction closed are flagged to every member.
- **Ownership is final once the event starts.** No bids, sales, undos or changes after the first game begins. If the score feed is down on event day, the app fails closed (stays locked).
- Events: NFL playoffs, NFL season, College Football Playoff, March Madness, NBA / NHL / MLB playoffs, this weekend's NFL or college games, and Custom (type your own teams, enter results by hand).

**Why it's set that way.** This is the standard open ascending auction used at clubs. A timer that resets on each bid is the online version of "going once, going twice". It stops last-second sniping.

**How someone could cheat or argue.**

- *Bid after the bell.* The server's clock decides, not the phone's.
- *The commissioner is also a bidder* and holds pause, undo and "sold now". He could sell a lot early to a friend. Everything he does is in the history, but people have to go and look.
- *Change who owns a team after it wins.* Blocked: frozen at the event start.
- *"The app lagged and I missed the lot."* Phones check every 1.5 seconds. On a slow connection a 10-second timer is tight. Timing under real load has not been tested.
- *Unsold lots.* If nobody buys a team and it wins, its money shows as "unclaimed" and the commissioner decides. That is an argument waiting to happen.

**Verdict: Weak spot (two small ones).** **Fix 1:** make the commissioner pick the unsold-lot rule at set-up (roll it into the remaining payouts, or give it to the champion's owner). **Fix 2:** when the commissioner uses Undo, Sold now or Pause, show a notice to every member on the auction screen, not only in the history. Also: default the timer to 20 or 30 seconds.

### 11. Buy back half

**Status:** Built and reviewed.

**What it is.** The classic golf Calcutta custom. After a team is sold, the team's own players may buy back half of themselves from the winning bidder, for half the price. Then they share the winnings half and half.

**Example.** Your scramble team sells for $201. You buy back half for $100.50. The team earns $531.69. The bidder gets $265.85 and you get $265.84.

**How Oddable runs it.**

- **Only the team's own players** can buy back. They are the lot's "players of record". Nobody else can (owner decision, Nov 16).
- Price is exactly half the winning bid. Cost and winnings split 50/50. The odd cent goes to the winning bidder.
- The commissioner can record it on a player's behalf.
- One buy-back per lot. The winning bidder cannot buy back from himself.
- Only for local events (your golf day, your pickleball pairs, Custom). Pro teams have no player in your group, so the button is hidden there.
- It is a switch per Calcutta. Off = no buy-backs.
- Players of record lock once the lot is sold. Buy-backs close when the event starts.

**Why it's set that way.** This matches the custom. Outside guides describe a team buying back half its ownership after the auction, at half the sale price, with winnings split evenly. It keeps the players trying, and it protects the bidder.

**How someone could cheat or argue.**

- *Buy back after you see you're winning.* Blocked: closes when the event starts.
- *Add yourself to a winning team's players of record.* Blocked: locked at the sale, and earlier changes are posted to members.
- *"The bidder didn't agree."* Under this rule he does not need to. Everyone knew the switch was on before bidding, because rules lock at the first bid.

**Verdict: Sound.** One thing to confirm: buy-backs stay open from the sale until the event starts. Some clubs close them the night of the auction.

### 12. Calcutta payouts, and Main or Side

**Status:** Built and reviewed. Main-pot reporting into Groups is not wired yet.

**What it is.** The payout table says what share of the pool each result earns. It must add up to exactly 100%. A Calcutta is either Main (counts in the group's main pot) or Side (its own pot).

**Example.** NFL playoffs table: 3% for each of 13 wins, 13% for each conference champion, 35% for the champion. Pot $1,003. Take 7% = $70.21. Pool $932.79. Each win pays $27.99 or $27.98. Conference champion $121.27. Champion $326.48.

**How Oddable runs it.**

- Pot = the winning bids. Take comes off the top: none, 0-50%, or flat.
- Payout rows: each win, reaching a round, champion, biggest win margin (weekend events), finishing place (golf).
- Results come from final scores. The commissioner can enter or override a result by hand, and that is logged.
- Every slot is worked out in cents. Leftover cents go to the bigger shares, so the total is exact.
- In a playoff series (NBA, NHL, MLB) a "win" is a series won, not a game. March Madness play-in games are not wins.
- More results than paid slots: the extras get $0 and are flagged. The app never pays out more than the pool.

**Why it's set that way.** A table that must equal 100% and is locked before bidding means every bidder knew the prize for every result. The classic golf Calcutta pays 70/20/10 to the top three. Bracket Calcuttas pay per round. Oddable allows both.

**How someone could cheat or argue.**

- *Change the table after the auction.* Locked at the first bid.
- *The commissioner types in a false result.* It is in the history and shown as hand-entered. For pro events the feed result is there to compare.
- *"Main or Side?"* A Main Calcutta does not yet report into the group's main pot. Until that is connected, Main and Side behave the same.

**Verdict: Weak spot.** The payout maths is sound. **Fix:** connect Main Calcuttas to the group main pot before you offer the choice, or hide the choice until then.

## Part D. Pro golf pools

Pools on real tour events. Scores come from the ESPN golf feed.

### 13. Pick six (best four count)

**Status:** Built, review pending. Lock on entry (G16) is in the working copy.

**What it is.** The field is split into six tiers, favourites to long shots. You pick one golfer from each tier. Your best four scores count. Lowest total wins.

**Example.** Your six finish -8, -5, -2, +1, +4 and one misses the cut. Best four: -8, -5, -2, +1 = -14.

**How Oddable runs it.**

- Tiers hold 6, 6, 8, 10, 12 golfers and "the rest". Smaller fields shrink in proportion. Under 12 golfers = no pool.
- Tier order comes from a ranking list the organizer types in, then the feed's order. No betting odds are used.
- Tiers are saved at the first pick and do not change.
- **Lock:** picks lock at the first tee time. If the feed is down, the pool stays locked (fails closed).
- **Group play:** a pick is saved and locked the moment it is made (G16). No re-picks, even days before.
- Others' picks are hidden until the lock.
- **Missed cut:** the organizer chooses. Default: the worst score among golfers who made the cut, plus 1. Other choices: own score plus 10, or cannot count.
- **Withdrawal before teeing off:** one free swap, same tier, once.
- **Tiebreak:** closest guess of the winning score. Or best single golfer.
- **Payouts** by field size: up to 3 entrants winner takes all; 4-6 pay 70/30; 7-11 pay 50/30/20. The organizer can set his own split.

**Why it's set that way.** Tiered pick-six with "best four of six" is the most common office golf pool. Dropping two scores keeps you alive when one golfer misses the cut.

**How someone could cheat or argue.**

- *Pick after the leaders tee off.* Blocked by the lock.
- *The organizer builds the tiers to suit himself.* He types the ranking list, and he plays too. Tiers are visible and frozen before anyone picks, but a sharp organizer could still put a hot golfer in tier 6.
- *"He was cut, not withdrawn."* The basic ESPN feed has no cut flag. The app infers it. That feed has not been tested live.
- *"Who paid?"* The golf pool counts every entrant in the pot, paid or not. Groups count only entries marked paid. Two different rules.

**Verdict: Weak spot.** **Fix 1:** build tiers from a neutral list (world ranking order), with the organizer's list as an override that is labelled "tiers set by organizer". **Fix 2:** test the ESPN golf feed on a real tournament before the first money pool. **Fix 3:** make the pot rule the same everywhere (see the list at the end).

### 14. One and done

**Status:** Built, review pending.

**What it is.** A season-long pool. Each tournament you pick one golfer. You can never pick that golfer again all season. Most earned at the end wins.

**Example.** You use Scheffler at the Masters. He wins: 100 points. Next week you must pick someone else. Two golfers tie for 3rd: each gets (45 + 40) / 2 = 42.5.

**How Oddable runs it.**

- Reusing a golfer is refused by the server.
- In group play a pick is locked once made (G16).
- Scored by finish points, not prize money, because the feed has no prize money: 100, 60, 45, 40, 35, 30, down to 1 point for 30th. Tied golfers share the points of the places they cover.

**Why it's set that way.** The one-and-done format is standard. The scoring is not. Almost every one-and-done pool uses official prize money, which makes the majors worth far more.

**How someone could cheat or argue.**

- *Change a pick mid-tournament.* Locked.
- *"A major should be worth more."* With points, every event is worth the same. People who know the format will expect prize money.

**Verdict: Weak spot.** The points table was made up by the coder. **Fix:** either confirm the table and say "points, not prize money" on the rules screen, or let the organizer type in the winner's-share money each week.

## Part E. Golf day formats

Your own round at your own course. First, three things true of every golf-day format.

**How handicap strokes work.** Each player has an Oddable Handicap Index (play 39). The app converts it for the course and tees. Strokes come off on the hardest holes first, by each hole's handicap number ("stroke index", 1 = hardest). A 14 gets one stroke on the 14 hardest holes. A 20 gets one on every hole and a second on the two hardest. On a 9-hole card the handicap is halved.

**Allowances.** In team formats nobody gets their full handicap. The percentage used is called the allowance. Oddable fills in a starting value for each format. The commissioner can change it before the start.

**How scores are kept honest.** One scorer per team enters each hole. A scorer from another team confirms the card or flags a hole. Nobody can confirm a card for a team they play on or score for, not even the organizer. Flagged holes go to the organizer to settle. A confirmed hole can only be changed by the organizer. Every entry and change is in the history. Handicaps lock at the first tee time.

One gap applies to all of them: the organizer can mark the day Final while holes are still unconfirmed. Only flagged holes block it. That is on the Weak spot list.

### 15. 4-person scramble

**Status:** Built, review pending.

**What it is.** All four tee off. The team picks the best shot. All four play from there. Repeat until the ball is in. One team score per hole.

**Example.** Course handicaps 6, 12, 18 and 24. Team handicap = 25% of 6 + 20% of 12 + 15% of 18 + 10% of 24 = 1.5 + 2.4 + 2.7 + 2.4 = 9. The team shoots 62 gross. Net 53.

**How Oddable runs it.** Team handicap 25/20/15/10, lowest handicap first. Strokes by hole. Gross, net or both leaderboards.

**Why it's set that way.** 25/20/15/10 is the allowance the USGA and R&A recommend for a four-player scramble.

**How someone could cheat or argue.** A team full of players with inflated handicaps. See play 39. Scores: the other team confirms.

**Verdict: Sound.**

### 16. 2-person scramble

**Status:** Built, review pending.

**What it is.** A scramble with two players.

**Example.** Handicaps 8 and 20. Team handicap = 35% of 8 + 15% of 20 = 2.8 + 3.0 = 5.8, so 6 strokes.

**How Oddable runs it.** Allowance 35/15, low handicap first.

**Why it's set that way.** 35% and 15% is the recommended two-player scramble allowance.

**How someone could cheat or argue.** Same as play 15.

**Verdict: Sound.**

### 17. Texas scramble

**Status:** Built, review pending.

**What it is.** A scramble where every player's tee shot must be used a set number of times. It stops one big hitter carrying the team.

**Example.** Four players, 4 drives each required. That uses 16 of 18 holes. After 14 holes Dave has only 1 drive used. The app warns: Dave needs 3 of the last 4.

**How Oddable runs it.**

- The scorer records whose drive was used on each hole.
- The app counts drives, warns when someone is running short, and flags "impossible" when the rule can no longer be met.
- Starting value: 4 drives each. Allowance 25/20/15/10.
- Teams of 2 to 4.

**Why it's set that way.** Minimum drives per player is the defining rule of a Texas scramble. The number varies by club. Four each is common for a foursome.

**How someone could cheat or argue.**

- *Claim a drive was Dave's when it wasn't.* The other team confirms the card, drives included.
- *"We missed the drive rule. What's the penalty?"* The app warns and flags. It does not apply a penalty. The organizer has to decide.
- *Teams of 2 or 3* still start from the four-player allowance.

**Verdict: Weak spot (small).** **Fix:** let the commissioner pick the penalty for a missed drive count at set-up (for example 2 strokes per missing drive, or disqualified from the prize). Start 2-player teams at 35/15 and 3-player teams at 30/20/10.

### 18. Florida (step-aside) scramble

**Status:** Built, review pending.

**What it is.** A scramble where the player whose shot was chosen sits out the next shot. So no player's ball can be used twice in a row.

**Example.** Ann's drive is used. Ann steps aside. Bob, Cy and Di hit the second shot. Di's is used. Di steps aside for the third.

**How Oddable runs it.** The scorer can list whose shot was used for each stroke. The server refuses a list with the same player twice in a row, or with the wrong number of shots. Teams of 3 or 4. Allowance 25/20/15/10.

**Why it's set that way.** That is the Florida scramble rule as clubs play it.

**How someone could cheat or argue.** The shot list is optional. A team that does not enter it is on its honour. A 3-player team uses the four-player allowance.

**Verdict: Sound.** Start 3-player teams at 30/20/10.

### 19. Shamble

**Status:** Built, review pending.

**What it is.** Everyone tees off. The team picks the best drive. From there each player plays their own ball into the hole. The best scores on each hole count.

**Example.** Four players, best 2 count. On a par 4 the net scores are 3, 4, 4, 6. The team takes 3 + 4 = 7.

**How Oddable runs it.** Starting values: best 2 scores count, each player at 80% of handicap. The commissioner can change both.

**Why it's set that way.** There is no official allowance for a shamble. The governing bodies' table does not list it. Clubs use 75% to 85%. 80% is the middle.

**How someone could cheat or argue.** "Why 80%?" Because someone had to pick. It is shown and locked before play.

**Verdict: Sound.** The 80% is a coder choice to confirm.

### 20. Best ball

**Status:** Built, review pending.

**What it is.** Everyone plays their own ball all the way. The team takes the best score on each hole (or the best two).

**Example.** Two partners on a par 4. Net 4 and net 5. The team scores 4.

**How Oddable runs it.** Starting values: best 1 score counts, each player at 90% of handicap. Teams of 2 to 4.

**Why it's set that way.** The recommended allowances depend on the game: 85% for two-player best ball stroke play, 90% for best ball match play. For four-player teams the recommended figure is lower still. Oddable starts everything at 90%.

**How someone could cheat or argue.** A four-player team at 90% taking one best ball gets too many strokes. Low-handicap teams lose out.

**Verdict: Weak spot (small).** **Fix:** start at 85% for stroke play pairs, 90% for matches, and 75% when it is the best 1 of 4. The commissioner can still change it.

### 21. Four-ball match (team against team)

**Status:** Built, review pending.

**What it is.** Two against two, best ball, hole by hole. The side with the better ball wins the hole. Most holes won wins the match.

**Example.** Playing handicaps 5, 12, 16 and 20. The 5 plays off zero. The others get 7, 11 and 15 strokes.

**How Oddable runs it.** Each player's playing handicap is worked out, then strokes are taken off the lowest player in the whole match. Net best ball per side, per hole. Shown as "2 UP", "AS" (all square), "3&2".

**Why it's set that way.** "Strokes off the low player" at 90% is the recommended four-ball match play method.

**How someone could cheat or argue.** Score entry only. Covered by confirm and dispute.

**Verdict: Sound.**

### 22. Alternate shot

**Status:** Built, review pending.

**What it is.** Two partners, one ball, taking turns on every shot. One tees off on odd holes, the other on even holes.

**Example.** Handicaps 10 and 20. Team handicap = half of 30 = 15.

**How Oddable runs it.** Allowance 50/50: half of the partners' combined handicap.

**Why it's set that way.** 50% of the combined handicap is the recommended allowance for this format (its formal name is foursomes).

**How someone could cheat or argue.** Nothing special. The app does not track who teed off where.

**Verdict: Sound.**

### 23. Chapman (Pinehurst)

**Status:** Built, review pending.

**What it is.** Both partners tee off. They swap balls for the second shot. Then they pick one ball and alternate shots into the hole.

**Example.** Handicaps 10 and 20. Team handicap = 60% of 10 + 40% of 20 = 6 + 8 = 14.

**How Oddable runs it.** Allowance 60/40: 60% of the low handicap plus 40% of the high.

**Why it's set that way.** 60/40 is the recommended Chapman allowance.

**How someone could cheat or argue.** Nothing special.

**Verdict: Sound.**

### 24. Stroke play

**Status:** Built, review pending.

**What it is.** Every stroke counts. Lowest total wins. Works for one player too: solo rounds count.

**Example.** You shoot 88 with a course handicap of 14. Net 74.

**How Oddable runs it.**

- Full handicap (100%).
- Leaderboards: gross, net, or both. "Both" shows two boards, which is how a gross flight and a net flight work.
- Flights by handicap band (A flight, B flight) are not built.

**Why it's set that way.** The recommended allowance for individual stroke play is 95%, and the same guidance says 100% is reasonable for small fields under 30 players. A standard Oddable game holds 8. So 100% is right.

**How someone could cheat or argue.** An inflated handicap wins net events. See play 39. In a solo round nobody confirms the score.

**Verdict: Sound** for 8-person games. For Enterprise fields of 30 or more, start at 95% and add handicap flights.

### 25. Stableford

**Status:** Built, review pending.

**What it is.** Points per hole instead of strokes. Most points wins. One disaster hole costs you nothing more than zero.

**Example.** Net double bogey or worse 0, bogey 1, par 2, birdie 3, eagle 4, albatross 5. Nine pars and nine bogeys = 27 points.

**How Oddable runs it.** Points on net score, full handicap.

**Why it's set that way.** That is the standard Stableford points table. Recommended allowance is 95%; 100% is fine for a small field, as in stroke play.

**How someone could cheat or argue.** Same as stroke play.

**Verdict: Sound.**

### 26. Match play, heads-up

**Status:** Built, review pending.

**What it is.** One against one (or team against team), hole by hole. Win a hole, go "1 up". The match ends when one side is more holes up than there are holes left.

**Example.** You are 3 up with 2 to play. You win "3 and 2". Handicaps 10 and 16: the 16 gets 6 strokes, on the 6 hardest holes.

**How Oddable runs it.**

- Strokes off the low side: the better player plays off zero, the other gets the difference.
- The app shows UP, DN, AS, "dormie" (up by exactly the holes left), and the closed-out result.
- Pairings: picked, random, by bracket or within the foursome.
- A dollar amount per match can be shown. Display only.

**Why it's set that way.** Full difference off the low player is the recommended singles match play allowance (100%).

**How someone could cheat or argue.** In a two-person match the only other person is your opponent, and he confirms. If you both agree, it stands.

**Verdict: Sound.**

### 27. Skins

**Status:** Built, review pending.

**What it is.** Every hole is worth one "skin". The lowest score alone wins it. If two or more tie for low, nobody wins and the skin carries to the next hole.

**Example.** Holes 1 and 2 are tied. Hole 3 is won outright. That player collects 3 skins.

**How Oddable runs it.**

- Gross or net.
- Carry-overs are automatic.
- Skins still unwon after the last hole: by default they are split between the players tied for low on the last hole. Other choice: nobody wins them.
- In team formats, skins are per team.

**Why it's set that way.** Lowest score alone wins, ties carry: that is the game everywhere. What happens to skins left over after the 18th is not standard. Groups play it differently (split, playoff, or dead), and the guides do not settle it.

**How someone could cheat or argue.**

- *The 18th is tied with 5 skins riding.* The biggest skins argument there is. Oddable has a rule, set before play.
- *Net skins with full strokes.* A high handicapper's net birdie beats a scratch player's par on the hardest holes. Many groups use half strokes for net skins. Oddable uses full.

**Verdict: Sound,** because the leftover rule is fixed before play. Two coder choices to confirm: the "split" default and full strokes for net skins.

### 28. Nassau and presses

**Status:** Built, review pending.

**What it is.** Three bets in one match: the front nine, the back nine, and all 18. A "press" is a new side bet that the losing side starts partway through a nine, for the holes left in that nine.

**Example.** $5 Nassau. You win the front 2 up, lose the back 1 down, win the 18 by 1. You are up $5. On the back you were 2 down after 13 and pressed: you won holes 14-18 by 1, so the press pays you $5 more.

**How Oddable runs it.**

- Each of the three bets is match play. Each press is one more bet of the same amount.
- **Who can press:** only the side that is down in that nine's newest bet.
- **When:** from the next hole to be played. Never back-dated. One press per starting hole.
- **Auto-press:** optional. The commissioner sets it to start when a side goes 1, 2, 3 or 4 down.
- Money shown: each bet won +amount, lost -amount, halved 0.
- 18-hole cards only.

**Why it's set that way.** Three bets, presses by the trailing side, and an automatic press at 2 down are all described as the usual way to play. One difference: in many groups a press must be accepted by the other side. In Oddable the side that is down can simply press.

**How someone could cheat or argue.**

- *Press after seeing the next hole's result.* Blocked: a press must start on a hole not yet played.
- *"I never accepted that press."* In Oddable you do not have to. If your group plays "presses must be accepted", this will cause a row.
- *Press when ahead.* Blocked.

**Verdict: Weak spot (small).** **Fix:** add a set-up switch: "Presses: automatic / must be accepted by the other side". Default to whichever you prefer.

### 29. Closest to the pin and longest drive

**Status:** Built, review pending.

**What it is.** Side prizes on chosen holes. Closest to the pin (CTP): nearest tee shot on a par 3. Longest drive (LD): longest tee shot that finishes in the fairway.

**Example.** CTP on holes 4 and 12, $20 each. Whoever is nearest on each hole wins $20.

**How Oddable runs it.** The commissioner picks the holes and amounts. The organizer or any team's scorer enters the winner. It shows on the Side games screen and in the winner's dashboard.

**Why it's set that way.** On a real course the winner is whoever's name is on the marker. Someone has to type it in.

**How someone could cheat or argue.** Any scorer can enter a winner, including his own teammate, and nobody has to confirm it. It is logged, but not checked.

**Verdict: Weak spot (small).** **Fix:** make CTP and LD winners follow the same rule as scores: entered by one team's scorer, confirmed by another team's scorer or the organizer.

### 30. Golf Calcutta

**Status:** Not wired yet.

**What it is.** A Calcutta auction on golf. Two kinds. A **golfer Calcutta** on a tour event: bid on pros. A **team Calcutta** on your own golf day: bid on the teams in your group, with buy-back.

**Example.** Twelve scramble teams. Your team sells for $100. Pot $1,200. Paid 70/20/10: $840, $240, $120. You bought back half of your own team for $50. You win. You and your bidder each get $420.

**How Oddable runs it.**

- The Calcutta engine has place-based payouts and the buy-back rule ready (plays 10-12).
- The golf engine can hand over its golfers or its golf-day teams as auction lots.
- **But the two are not connected.** Nothing in the merged build registers golf as a lot source. In the Calcutta screen, Golf shows "coming soon". In the golf screens, golfer Calcutta shows "In Groups". In the group hub, "Add a Calcutta" shows "Coming soon".
- What works today: a **Custom** Calcutta. Type the team names, name each team's players, enter the finishing places by hand. Buy-back works there.

**Why it's set that way.** Each engine was built by a different coder with a plug for the other. The manager connects them at merge. That step has not been done.

**How someone could cheat or argue.** In a Custom Calcutta the commissioner types the results. Each entry is logged, but there is no feed to compare against.

**Verdict: Weak spot.** A headline feature is not usable as designed. **Fix:** connect golf-day teams (with their players as players of record) and tour fields to the Calcutta engine, and connect Calcuttas to the group hub, before launch. Same for pickleball pairs.

## Part F. Pickleball and local events

Games you run yourselves, with no live feed: pickleball, tennis, cornhole, darts, bowling, pool, 3-on-3. The scorer enters, the other side confirms.

**How scores are kept honest.** The scorer (first-listed side, either side, or commissioner only) enters each game's score. The other side confirms or disputes with a note. Disputes go to the commissioner, whose score is final. A match against a guest with no account also goes to the commissioner. Everything is in the history. Spectators count toward the 8 people.

### 31. Pickleball match scoring

**Status:** Built and reviewed.

**What it is.** A game is played to 11, 15 or 21 points. You must win by 2. A match is best of 1, 3 or 5 games. Singles, doubles or mixed.

**Example.** 11-9 is a finished game. 11-10 is not. 13-11 is.

**How Oddable runs it.**

- The server only accepts a legal final score: at or past the target, and exactly 2 ahead once past it.
- "Rally" or "side-out" scoring is a label. The app records final game scores, not each rally.
- Other sports: points to win from 0 (highest score wins, like bowling) to 999, win by 1 or 2.

**Why it's set that way.** It matches the USA Pickleball rulebook: best two of three to 11, win by two, is the recommended format, with best of five to 11, or one game to 15 or 21, as the other options.

**How someone could cheat or argue.** Enter a false score. The other side must confirm. If both sides collude, only their own records are affected.

**Verdict: Sound.**

### 32. Round robin and playoff

**Status:** Built and reviewed.

**What it is.** Everyone plays everyone. The best records can go on to a playoff bracket.

**Example.** Five pairs. Each plays four matches. Each round one pair sits out (a "bye"). The top 4 go to a playoff.

**How Oddable runs it.**

- The schedule gives every entry each opponent once. Odd numbers get one bye per round.
- Can be split into 1 to 8 pools. Seeds are dealt across pools in a snake so pools are even.
- **Tiebreak order:** wins, then head-to-head among the tied, then point difference, then points scored, then seed.
- Optional playoff of the top 2, 4, 8 or 16. Created automatically when the last pool match is confirmed.
- Entries and rules lock at the start.

**Why it's set that way.** The format is standard. The tiebreak mostly is: the USA Pickleball rulebook breaks ties by head-to-head first, then point difference in all games. After that it uses head-to-head point difference, then point difference against the next-highest team. Oddable uses points scored, then seed.

**How someone could cheat or argue.**

- *Lose on purpose* to get an easier playoff. Possible in any round robin.
- *"Why did the higher seed win the tie?"* Because seed is the last tiebreak. If seeds came from typed ratings, that feels unfair.

**Verdict: Weak spot (small).** **Fix:** replace "points scored, then seed" with the rulebook's third and fourth tiebreaks. If still tied, a one-game playoff or a coin flip. Never the seed.

### 33. Single elimination

**Status:** Built and reviewed.

**What it is.** A knockout bracket. Lose once and you are out.

**Example.** Six entries. Seeds 1 and 2 get a bye into the semi-finals. 3 plays 6, 4 plays 5.

**How Oddable runs it.** Standard seed order (1 and 2 can only meet in the final). Top seeds get the byes. Seeding by Oddable rating, by a typed rating, random, or as entered. The draw is frozen at the start.

**Why it's set that way.** Standard bracket practice.

**How someone could cheat or argue.** *Rig the seeding.* The seeding method is chosen before the draw and shown. A director-set rating is marked "Set by tournament" (play 41).

**Verdict: Sound.**

### 34. Double elimination

**Status:** Built and reviewed.

**What it is.** You must lose twice to be out. Losers drop into a second bracket. The winner of that bracket meets the unbeaten side in the final.

**Example.** The unbeaten side loses the first final. Now both have one loss. They play one more deciding match (the "bracket reset").

**How Oddable runs it.** A full losers bracket. A reset final only when the losers-bracket champion wins the first final. Tested for every size from 2 to 16: it always finishes, and everyone except the champion has exactly two losses.

**Why it's set that way.** That is "true" double elimination. Without the reset, the unbeaten side could go out on one loss.

**How someone could cheat or argue.** Same as single elimination.

**Verdict: Sound.**

### 35. Ladder

**Status:** Built and reviewed.

**What it is.** A ranking list that runs for weeks. You challenge someone a few spots above you. Win and you move up.

**Example.** You are 6th. The ladder allows challenges up to 3 spots up. You challenge 3rd and win. You are 3rd. The old 3rd, 4th and 5th each move down one.

**How Oddable runs it.**

- The commissioner sets how far up you can challenge (1 to 10 spots).
- One open challenge per entry at a time.
- Play within a set number of days (1 to 30). If not: a forfeit win for the challenger, or the challenge is cancelled. The commissioner chooses which, at set-up.
- Winner either swaps places, or takes the spot and pushes the rest down. Chosen at set-up.

**Why it's set that way.** Standard club ladder rules. The time limit stops a top player from ducking challenges.

**How someone could cheat or argue.**

- *Duck the challenge.* The forfeit rule handles it.
- *Two friends trade wins.* It only moves them around each other.

**Verdict: Sound.**

### 36. Heads-up challenge

**Status:** Built and reviewed.

**What it is.** One against one, or pair against pair. One side challenges. The other accepts or declines. Best of 1, 3 or 5.

**Example.** You challenge Ray, best of 3. He accepts. You win 11-7, 9-11, 11-8.

**How Oddable runs it.** A challenge must be accepted before it counts. Side matches next to a tournament do not change the tournament standings. They count in each player's stats and rating.

**Why it's set that way.** A match both sides agreed to and both confirmed needs no referee.

**How someone could cheat or argue.** Two friends could invent matches to raise a rating. See play 40.

**Verdict: Sound.**

### 37. Bracket pick'em

**Status:** Built and reviewed.

**What it is.** A contest for people watching. Pick the winner of every match in the round. Most right wins.

**Example.** Quarter-finals: you pick 3 of 4 right. 3 points.

**How Oddable runs it.**

- Spectators and players can both enter.
- One point per right pick, or later rounds worth more.
- **Lock:** a whole round locks when its first match is marked live, or gets a score.
- Others' picks are hidden until the lock. After it you see counts only.
- Tiebreak: closest guess of the final's total points, then whoever finished picking first.

**Why it's set that way.** Local matches have no scheduled start time in the app. So the lock is tied to the first sign that play began.

**How someone could cheat or argue.**

- *Pick after play has started.* If nobody taps "live" and no score is entered, the round is still open while people are already playing. Someone at the court could pick with the score at 9-2.
- *A player picks his own match, then throws it.* Players may enter the pick'em.

**Verdict: Weak spot.** **Fix:** give the commissioner a "Lock picks for this round" button and an optional lock time, and lock automatically when the round's first match is opened for scoring. Consider barring players from picking their own matches.

### 38. Solo and skills games

**Status:** Built and reviewed.

**What it is.** One number per player. Highest wins, or lowest wins. Works with one person as practice.

**Example.** Putting contest: fewest strokes over 9 holes. Free-throw contest: most made out of 25.

**How Oddable runs it.** One score per entry. The commissioner sets highest-wins or lowest-wins. One-player games count in your own stats.

**Why it's set that way.** It covers everything that is not a match: bowling night, darts high score, a putting contest.

**How someone could cheat or argue.** A solo score has nobody to confirm it. It is marked unverified in stats.

**Verdict: Sound.**

## Part G. Handicaps, ratings, partners and limits

### 39. Oddable Handicap Index

**Status:** The maths is built, review pending. Using it everywhere (H1) is in the working copy.

**What it is.** A number that says how many strokes over a scratch golfer you usually play. Lower is better. It lets a 20 and a 5 have a fair game. It is worked out with the World Handicap System method. It is not an official USGA or GHIN index and the app never calls it one.

**Example.** You have 20 rounds in the app. Each round gets a "differential": (113 / Slope) x (adjusted score - Course Rating). Your index is the average of your best 8 of the last 20. Say 12.4. At a course with Slope 130, Rating 71.2, par 72: 12.4 x 130 / 113 + (71.2 - 72) = 13.5. You get 13 strokes.

**How Oddable runs it.**

- Every round played or logged in the app counts: solo, group, golf day, Calcutta golf (H1).
- It is the handicap everywhere in the app: strokes, net scores, pairings, partner suggestions (H1).
- Shown as "Oddable Handicap Index" with the line "Calculated with the World Handicap System method." (H1).
- You need 3 rounds for an index. With fewer than 20, the official short table is used (3 rounds: lowest 1 minus 2.0, and so on).
- Blow-up holes are capped at net double bogey. Before you have an index, at par + 5.
- Highest index 54.0.
- Only your own-ball, complete, 18-hole rounds on a course with Rating and Slope count. Scrambles and other team scores do not.
- No index yet: you or the organizer can type a number. It shows as "Entered 14.0". No number at all: you play off zero.
- Personal page: current index, trend, last 20 rounds with the counting 8 marked.

**Why it's set that way.** The formula, the best-8-of-20 rule, the short table, the hole cap and the 54.0 ceiling all match the official method. The coder checked them against the 2024 Rules of Handicapping, including its worked examples.

Four official safeguards are left out, and the code says so:

- The **soft cap and hard cap**, which slow and then stop an index from rising more than 3.0 and 5.0 strokes in a year.
- The **exceptional score** cut, which drops an index by 1 or 2 after a round far better than expected.
- The daily **playing conditions** adjustment.
- **9-hole rounds.**

**How someone could cheat or argue.**

- **Sandbagging.** This is the big one in all of handicap golf. A player logs a few bad solo rounds that nobody saw. His index goes up. He then wins net money games. The caps that exist to stop exactly this are not applied, and self-logged rounds count the same as confirmed ones.
- *Typing a number* when you have no index. Same problem, but it is labelled.
- *"That's not my GHIN."* Correct, and the app says so.
- There are two copies of the index maths in the code (golf and stats). They can give slightly different answers until the manager plugs in one.

**Verdict: Weak spot.** You decided app play is the real handicap (H1), and that stands. It needs guard rails. **Fix 1:** apply the soft cap, hard cap and exceptional-score cut. **Fix 2:** show "x of your last 20 rounds were confirmed by another player" next to every index. **Fix 3:** let a commissioner of a money game choose "confirmed rounds only". **Fix 4:** use one copy of the maths.

### 40. Oddable rating (pickleball and other local sports)

**Status:** Built, review pending. Using it for seeding (H1) is in the working copy.

**What it is.** A skill number for head-to-head games. It uses the Elo method, from chess. Everyone starts at 1500. Win and you go up. Lose and you go down. Beating a stronger player moves you more. It is not DUPR and the app never says it is.

**Example.** Two 1500 players. The winner goes to 1516, the loser to 1484. Beat someone 200 points above you and you gain about 24.

**How Oddable runs it.**

- Start 1500. Each match moves you by up to 32 points.
- Doubles: each side's strength is the average of its two players. Both partners move the same amount.
- Score margin is not used. 11-0 and 13-11 count the same.
- One rating per sport.
- Used for seeding, pairings and partner suggestions (H1).

**Why it's set that way.** Elo is the best-known rating method and simple to explain. DUPR is a private system and cannot be copied.

**How someone could cheat or argue.**

- **The opponent's rating is not being passed in.** The formula is built to use it. But the local-events engine does not send it, so every opponent is treated as 1500. Beating the best player in the club moves you the same as beating a beginner. Today the "rating" is close to a win-loss count.
- *Friends trade fake wins.* Possible. Both must confirm, and both names are on it.
- *Sandbagging before a seeded event.* Seeds freeze at the draw.

**Verdict: Weak spot.** **Fix:** have the events engine send each opponent's and partner's current rating with every match record. Then re-test. Until then, do not seed money events by Oddable rating alone.

### 41. Tournament-set handicaps (Enterprise)

**Status:** In the working copy.

**What it is.** In an Enterprise tournament (course, club, league), the director can enter a handicap for a player who has none, or change any player's handicap for that one tournament.

**Example.** A guest with no app rounds: the director enters 18.0. A known sandbagger: the director changes 16.2 to 12.0. Everyone sees "Oddable 16.2 (real results) · Tournament 12.0, set by director".

**How Oddable runs it.**

- Enterprise accounts only (E-H).
- Applies to that tournament only. The player's lifetime index does not change.
- Every add or change is logged: who, when, old value, new value, reason. Shown as "Set by tournament".
- Can be changed until the tournament starts (first tee time). Then locked.
- The real-results Oddable number always stays visible next to the director's number. It is never hidden or replaced (E-H addendum).
- Pickleball works the same way with the rating.

**Why it's set that way.** Every real tournament has a handicap committee with the power to adjust. That is in the official rules too. Keeping the real number visible keeps the director honest.

**How someone could cheat or argue.**

- *The director helps his friends.* Both numbers show to every member, with the reason.
- *Change it after seeing early scores.* Locked at the first tee time.

**Verdict: Sound.**

### 42. Partner suggestions

**Status:** In the working copy.

**What it is.** A "Suggest partners" step for team games. It offers ranked team line-ups with a one-line reason. People still choose (P1).

**Example.** Four golfers: 4, 10, 16, 22. Balanced suggests 4 + 22 and 10 + 16. Both pairs average 13. "Team handicaps are even."

**How Oddable runs it.**

- **Balanced** (default): team handicaps or ratings as close as possible.
- **Rotate:** pairs who have not played together lately.
- **Hot pairs:** best record together, from lifetime stats. A pair needs at least 2 games together to count.
- Up to 3 suggestions. Nothing is saved until someone picks.
- A player with no handicap is treated as an 18.

**Why it's set that way.** Balanced teams make fair matches. Rotation keeps a regular group fresh. Hot pairs is for fun.

**How someone could cheat or argue.**

- It only suggests, so there is nothing to cheat.
- *"Balanced" isn't balanced for a scramble.* It averages handicaps. A scramble's real team handicap weights the low player most. Two "even" teams can be uneven in a scramble.
- *The 18 guess* for a player with no handicap can be far off.

**Verdict: Sound.** Two small improvements: balance on the format's real team handicap, and show "no handicap, assumed 18" next to that player.

### 43. The 8-person limit and Enterprise

**Status:** Built, review pending.

**What it is.** On a standard account every group and every game holds at most 8 people, commissioner included. Courses, clubs and leagues can pay for Enterprise, which lifts the limit.

**Example.** A golf course wants a 60-player member-guest. The owner turns on Enterprise for the course's account. One game with 60 players that month: $500 + 60 x $20 = $1,700.

**How Oddable runs it.**

- 8 people, enforced on the server at every join, approval and request (G15). Two people racing for the last seat: only one gets it.
- Spectators count toward the 8 (your rule).
- The owner can give one group or game extra seats. Price not set yet.
- Enterprise is a flag only the owner can set. Price shown everywhere in the same words: "Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us."
- "Contact us" sends a request to the owner dashboard.
- The app counts games and players per Enterprise account per month, for billing. There is no payment flow.
- Enterprise ceiling: 500 people per game unless you set another number.
- Golf courses on Enterprise can see handicaps and rounds only for players who consent.

**Why it's set that way.** Eight is two foursomes, or a full pickleball court rotation, or a poker-night-sized pool. It keeps free use to friends and makes organizations pay.

**How someone could cheat or argue.**

- *Make two groups of 8.* Nothing stops that. But they are separate pots and separate boards, which is the thing a club actually needs joined.
- *Type guests in by name to dodge the limit.* Typed-in players count as people.
- *Under-report players to cut the bill.* The server counts them, not the customer.
- Each engine (Calcutta, golf, local events) was built with its own stand-in copy of the limit check, with different Enterprise ceilings (500, 400, 500). They must all be swapped for the one shared check at merge.

**Verdict: Weak spot (process).** The rule is sound. **Fix:** in the R1 review, confirm that Calcutta, golf and local events all call the one shared limit check, so an Enterprise flag set by the owner works the same in all four.

## The lists

### Every Weak spot, with its fix

1. **2-game parlay (play 4).** Roughly break-even over 12 seasons; lost money in 8 of 12. Fix: show that line on the parlay row and call it a tracker.
2. **3-game parlay (play 5).** No long-run test exists. Fix: run the 12-season backtest; until then show "no long-run record yet".
3. **Best five (play 8).** Rewards making more bets. Fix: add a most-bets-per-week rule.
4. **Calcutta auction (play 10).** Unsold lots that win are "unclaimed" with no rule. Commissioner's Undo / Sold now / Pause are only in the history. Fix: pick the unsold-lot rule at set-up; notify all members of those commissioner actions; default timer 20-30 seconds.
5. **Main or Side Calcutta (play 12).** Main does not report into the group main pot yet. Fix: connect it, or hide the choice.
6. **Pick six (play 13).** The organizer sets the tiers and also plays; the golf feed is untested live. Fix: neutral default tiers; test the feed on a real event.
7. **One and done (play 14).** Uses an invented points table, not prize money. Fix: confirm and label it, or let the organizer enter prize money.
8. **Golf-day Final (all golf formats).** A day can be marked Final with unconfirmed holes. Fix: when there is money shown, require every hole confirmed, or show "x holes never confirmed" on the results.
9. **Golf pot rule (plays 13-29).** Golf counts every entrant in the pot, paid or not. Groups and local events count only those marked paid. Fix: one rule everywhere.
10. **Texas scramble (play 17).** No penalty set for missing the drive count; 2- and 3-player teams start on the 4-player allowance. Fix: penalty chosen at set-up; right starting allowances.
11. **Best ball (play 20).** Starts at 90% for every team size. Fix: 85% pairs stroke play, 90% matches, 75% best 1 of 4.
12. **Nassau presses (play 28).** The down side can press without the other side accepting. Fix: a set-up switch.
13. **Closest to the pin / longest drive (play 29).** Any scorer enters the winner; nobody confirms. Fix: confirm like a score.
14. **Golf Calcutta and team Calcutta (play 30).** Not connected. Fix: wire golf teams, tour fields and pickleball pairs into the Calcutta engine, and Calcuttas into the group hub.
15. **Round robin tiebreak (play 32).** Ends on "points scored, then seed". Fix: use the rulebook order, then a playoff game or coin flip.
16. **Bracket pick'em (play 37).** A round only locks when someone taps live or enters a score. Fix: a lock button, a lock time, and auto-lock.
17. **Oddable Handicap Index (play 39).** No caps, no exceptional-score cut, and unconfirmed solo rounds count in full. Fix: add the caps; show how many rounds were confirmed; "confirmed rounds only" option for money games; one copy of the maths.
18. **Oddable rating (play 40).** Opponents' ratings are not passed in, so everyone is treated as 1500. Fix: send them with each match.
19. **8-person limit (play 43).** Three engines carry stand-in copies of the limit check. Fix: confirm one shared check at merge.
20. **Your newest rules are not committed yet.** G16 (lock on entry), H1 (app handicap everywhere), E-H (tournament handicaps) and P1 (partner suggestions) are in the coders' working copies in Groups, Golf and Local events. Fix: commit, then include them in the R1 review.

### Choices made by the manager or coders, not by Steve

Confirm or change each one.

**Weekly picks**

- The Lock is the first game after the #1 pick that is still in the running; the #1 is always skipped, even after its game has passed (coder's reading of D9).
- If the Lock's line is missing at its 1-hour mark, it is frozen at the last line it held (manager, applying "never a week without a Lock").
- A line first read more than 5 minutes after the mark cannot move the Lock (coder).
- Price source order: the middle price of the books showing that exact line, else ESPN's price, else "no price" (coder, applying D7).
- A pushed parlay leg drops out; the parlay continues with the legs left (recorded with D6; it is the sportsbook standard).
- The Helper is left out of the Alert's units (coder).
- "Not worth it" when buying a half point gains under 6 cents (coder rule of thumb).

**Groups**

- Weeks run Tuesday to Monday for every sport.
- Season end dates per sport are estimates.
- The leftover cent goes to the higher place.
- Main-pot split choices: even, 50/50, 40/60, 60/40, custom.
- Ten wrong invite codes blocks that person for 15 minutes.
- Group play for G16 in golf means: attached to a group, or anyone besides the organizer is in the game.
- A Kalshi-synced bet enters through the sync, not through the "add bet" button, and still counts.

**Calcutta**

- Timer choices 10 / 20 / 30 seconds; 8 seconds between lots; whole-dollar steps; you cannot raise your own high bid.
- Ownership freezes when the event starts (reviewer's fix); buy-backs stay open from the sale until then.
- Buy-back is offered only on local events.
- Unsold lots' earnings are "unclaimed".
- More results than payout slots: the extras get $0.
- A playoff series counts as one win; play-in games are not wins.
- Leftover cents go to the larger percentages first.

**Pro golf**

- Tier sizes 6 / 6 / 8 / 10 / 12 / rest; tier order from the organizer's typed list, then feed order.
- Missed-cut default: worst made-cut score plus 1.
- Tiebreak default: closest winning-score guess.
- One free swap for a golfer who withdraws before teeing off.
- One-and-done points table (100, 60, 45, 40 ...).
- Default payout split by field size (winner takes all up to 3; 70/30; 50/30/20; and so on).
- The pot counts every entrant, paid or not.

**Golf day**

- Every starting allowance: scrambles 25/20/15/10 and 35/15; alternate shot 50/50; Chapman 60/40; shamble 80% best 2; best ball 90% best 1; stroke, Stableford, Nassau and skins 100%.
- Texas scramble starts at 4 drives each; no penalty applied.
- Skins left after the last hole are split among those tied on it; net skins use full strokes.
- The down side presses without acceptance; auto-press from 1 to 4 down.
- A player with no handicap plays off zero.
- 9-hole rounds use half the handicap.
- Any scorer can enter a closest-to-the-pin or longest-drive winner.
- A day can go Final with unconfirmed holes.

**Pickleball and local events**

- Round robin tiebreak order (wins, head-to-head, point difference, points scored, seed).
- Pick'em locks a whole round at its first live match; tiebreak is the final's total points, then who picked first.
- Ladder: forfeit or cancel on a missed deadline is the commissioner's choice.
- Rally / side-out is a label only.

**Handicap, rating, partners, limits**

- Left out of the handicap: caps, exceptional-score cut, playing-conditions adjustment, 9-hole rounds.
- Self-logged and confirmed rounds count the same (this follows H1; the lack of a "confirmed" marker is the coder's).
- Rating: start 1500, 32 points per match, no score margin, opponents default to 1500.
- Partner suggestions: balance on the average; no handicap = 18; hot pairs need 2 games together.
- Enterprise ceiling 500 people per game.

## Sources checked

Standard rules were confirmed against these on Nov 16 2026.

- Handicap allowances by format: [SCGA tournament formats and allowances](https://adminhub.scga.org/blog/tournament-formats-and-allowances) and [R&A Rules of Handicapping, Appendix C](https://www.randa.org/roh/appendices/appendix-c).
- World Handicap System (best 8 of 20, caps, exceptional score, net double bogey, 54.0): [USGA WHS change summary](https://www.usga.org/content/dam/usga/pdf/WHS_Change_Summaries_Abbreviated_2020.pdf).
- Calcutta auction and buy-back custom: [GolfLink](https://golflink.com/lifestyle/golf-calcutta) and [LiveTourney](https://www.livetourney.com/blog/what-is-a-calcutta-in-golf).
- Skins: [Golf News Net, how to play skins](https://thegolfnewsnet.com/ryan_ballengee/2020/05/14/golf-betting-games-how-to-play-skins-game-rules-format-45992/).
- Nassau and presses: [Golf News Net, how to play a Nassau](https://thegolfnewsnet.com/ryan_ballengee/2026/03/13/golf-betting-games-how-to-play-nassau-press-adjust-rules-46015/).
- Pickleball scoring and round robin tiebreaks: [USA Pickleball rules, section 12](https://pickleball.cafe/rules/sanctioned-tournament-policies).

Not confirmed from a source and stated from general knowledge: the 75% figure for best 1 of 4, the 30/20/10 three-player scramble allowance, half strokes for net skins, and prize money as the usual one-and-done scoring. Check these before relying on them.

One thing outside the rules: Calcuttas and paid pools are gambling under some state laws. Oddable handles no money, but the people running a pot should know their local law. That is a question for a lawyer, not for this book.
