# Local events v1.3 — third independent review

Repo: /home/claude/calcutta-local, branch local-v1, commit 872e74a (on ab77696).
Reviewer: read-only. Work was done in my own clone, /tmp/revlocal3w.
Date: Nov 16 2026.

## Verdict for a LIVE deploy: SHIP AFTER FIXES

The second review's defects are fixed on this branch, and the engine did not regress.
Two things must be fixed before it goes live (H1, H2). Neither is in the game engine itself.

- Critical: 0
- High: 2
- Medium: 6
- Low: 9

## High

### H1. Merged with the stats module, the rating-farming fix is lost
The coder flagged this in HANDOFF. I confirmed it.

- Repro: copy stats.js, ratings.js, stats-courses.js and voicelog.js from calcutta-stats e214bcf into odds-api. Create a heads-up event with one typed-in guest. Enter 5 wins over the guest yourself.
- Result: rating 1500 -> 1530, shown as "5 of 5 games confirmed". After 25 more days of one fake win a day: 1535. Each new typed-in guest is a fresh opponent, so several guests add about 30 points each in one sitting, with one account.
- Cause: stats.js `isConfirmed` treats every events match as confirmed and ignores `extra.confirmed === false`.
- Also: in that merged copy `events.rev2.test.js` fails 4 of 25 (r2, r6, r10d, r2Merged). r6 and r10d fail only because the tests stub the stand-in's Enterprise flag.
- Fix: stats `isConfirmed` must honour `extra.confirmed === false` on `src: 'events'` match records. Add one test that runs on the merged build. Do not deploy merged until `r2MergedStatsHonoursConfirmed` passes.

### H2. Enterprise billing counts the same players again in later months
- Repro: Enterprise account runs a 3-player bracket in November, to the finish. Restart the server (the in-memory "already billed" list is lost). Anyone opens that finished event in December.
- Result: `lock:entuse` shows 3 players in 2026-11 and 3 players again in 2026-12. Opened in January: a third time. At $20 per player per game the owner would over-invoice.
- Cause: `bill()` remembers billed seats only in memory, and `recordPlay` files the count under the month of the call, not the month the game started. The real groups `limits.recordPlay` uses the same month rule.
- Hits hardest: ladders and heads-up events (up to 200 days), and any old event someone re-opens.
- Fix: store the billed seat ids on the event row itself (for example `evt.billed`) and never call `recordPlay` for a seat already there. Or bill only at the moment of the draw.

## Medium

### M1. Money rules can be changed after people joined and paid
- Repro: create a round robin, $20 entry, no take, 60/30/10. Three others join; mark all paid. One minute before the start, call `edit` with take 50% and split "100".
- Result: 200. Pot $80, take $40, winner takes the other $40. No notice to players. History says only "Rules changed". Entry $20 -> $500 also goes through, and the four "paid" marks stay (pot shows $2,000 paid).
- Owner rule (Groups): money rules lock once anyone else has joined.
- Fix: lock entry, take, split and pot once a second person is in. Or at least clear the paid marks on an entry change, send the 3-day notice, and log old and new values.

### M2. Last playoff spot across pools is decided silently
- Repro: 9 entries, 3 pools, playoff top 4. Give every pool identical results.
- Result: the three pool winners go through, plus one of the three second places. Which one is chosen by pool order and the "avoid same-pool pairing" step. No open tie, no coin flip, no log line. When records differ, the spot goes by wins, point difference and points scored across pools.
- This contradicts two manager rules: "places across pools are never compared by record" and "a tie for a playoff spot waits for the organizer".
- Applies whenever the playoff size is not a multiple of the pool count (3 pools top 4 or 8; 5, 6, 7 pools top 8).
- Fix: allow only playoff sizes that are a multiple of the pool count. Or treat the wildcard as an open tie (coin flip, logged) and state the rule on the standings screen.

### M3. Pick'em: a spectator can pick against a seat, then take that seat
- Repro: double elimination with pick'em and a typed-in player G1. After the draw a spectator picks against G1 in G1's first match. Then he claims G1's seat with the claim code.
- Result: claim 200. The pick on his own match stays and scores.
- Needs the commissioner's claim code, so the risk is limited.
- Fix: on claim (and join), remove that account's picks on matches of the entry it takes, or skip them in `pickTable`.
- Related: a non-playing commissioner may pick a match and then enter its final score himself.

### M4. Two-friend farming is still open through formats other than heads-up
The "fewer than 3 accounts" rule covers heads-up and side matches only.

- Repro: two accounts. One creates a 2-entry round robin, the other joins, one match, the other side confirms. New event, repeat.
- Result on this branch: +31 on day 1 (two rated wins), 1556 after day 2, 1577 after day 3. The third match of the day is correctly unrated, across events.
- "Shrinking weight" is not in this branch. It lives only in the stats module. The stand-in is plain Elo.
- See "Rating farming: what remains" below.

### M5. Text contrast under 4.5:1 in the violet light theme
Measured on 912 screens (76 screens x 3 sizes x 4 themes).

- "Text it" button: dark text on violet, 2.48:1 (invite sheet).
- Green (winner names, "Final", "Available now", "+18"): 4.01:1 on white, 3.3:1 on tinted cards.
- Red ("Delete event", "Reset the playoff", "Dispute", "Leave event"): 4.19:1.
- Amber card titles ("Every score is in", "Not ready to start", notices): 4.19:1.
- Dark themes: grey small text and the "Disputed" pill on gold highlight cards measure about 3.95 to 4.0. Those sit on a gradient, so treat them as borderline estimates.
- Navy theme: clean apart from that pill.
- Fix: darker green, red and amber for light mode; white text on the "Text it" button.

### M6. Cornhole, darts, bowling, pool and basketball share one rating
- Repro: win one confirmed cornhole match. Open a darts event seeded by Oddable rating.
- Result: the darts seat shows 1516 from the cornhole win.
- Playbook play 40 says one rating per sport.
- Fix: key the rating by `extra.game`, not by the stats sport "other".

## Low

- L1. Stale "paid". Typed-in Al marked paid; an account claims Al; commissioner un-marks that account; the account leaves. Al's seat is paid again (pot paid count 2 -> 3). Fix: clear `seat.paid` when a member's paid mark changes, or on claim.
- L2. The word "DUPR" is on screens: "Unofficial: not a DUPR or tournament rating" (Info, partners, entries) and "My rating (optional, e.g. DUPR 4.25)" (create and join forms, plus one server error). The brief says no "DUPR". The disclaimer follows the owner rule in spirit; the manager should decide. No "USGA", "GHIN", "Double lock", "undefined" or "H2H" on any screen.
- L3. Signed-out invite preview: 300 per IP per 10 minutes. 200 people on one club Wi-Fi are fine once each; a second open each gives 100 refusals. Ten wrong codes from that Wi-Fi block everyone on it for 15 minutes. Different IPs: 200 of 200 fine.
- L4. Back after a standings drill-down goes to "My events", not back to Standings. Tiles and rows drill by filtering the Matches tab in place.
- L5. After tapping "Disputes", tapping "Status" keeps the Disputes filter (empty list).
- L6. The Money card totals (pot, prize pool) are not tappable. The detail is two cards below on the same screen.
- L7. A title sent as an object is stored as "[object Object]". Only a hand-made request can do it.
- L8. Events and self-logged matches build the opponent key differently ("e:" vs "a:"), so the stats module's repeat-opponent weight will not combine them.
- L9. `leave` sent twice at once: the second answers 404. Harmless.

## Rating farming: what remains

What is closed (all confirmed):
- Wins over your own typed-in guest: unrated, "0 of 5 games confirmed".
- Self-entered heads-up, commissioner-final results, a neutral commissioner's confirm: unrated.
- Forfeits (ladder clock): unrated, though the ladder still moves.
- Claiming your own guest with the same account: refused. A second account claiming old results later: still unrated.
- Partner cannot confirm for his own side.
- Third and later match against the same opponents in a day: unrated, across events (40 fake matches moved nothing).
- Heads-up in an event with only 2 accounts: unrated.

What is left:
- Accounts are free (any phone number and a PIN, no text-message check). So "one person" is really "one person with two accounts".
- Two accounts, 2 rated matches a day, in any format except heads-up/side. Plain Elo on this branch: about 1760 after 30 days against one throwaway account; about 2050 with four throwaway accounts.
- With the real stats module the 7-day repeat weight stalls one pair at about 1530. Each extra throwaway account is a fresh key worth about +30 a week. Ten accounts is about +250 a week.
- Four rated wins in 15 minutes by straddling midnight Central.
- Honest pairs who play each other daily gain almost nothing under the stats weights. That is the trade-off.
- Advice: keep the Playbook line "do not seed money events by Oddable rating alone". Consider rating only matches in events with 3 or more accounts in every format, and a lifetime cap on what one opponent can contribute.

## What I verified (all pass unless listed above)

Previous review's defects:
- Tiebreak-playoff correction: redraws when no playoff match is played; refused with 409 once one is live or scored; the refusal is in the history; pool corrections (even same winner) also refused. Flip of tiebreak match 1 after match 2 was played: refused.
- Playoff reset: commissioner only, reason required, results wiped, notice to every member for 3 days, finish blocked until redraw. Reset after the event is finished: refused. Race of three tiebreak choices: one wins.
- Picks survive leave and rejoin with their stamps; still locked.
- Typed-in players can be marked paid; pot counts players; non-playing organizer refused "paid" and has no record.
- Prizes to the cent: 40,000 random events (ties, pairs, teams, every split and take). Zero wrong. Payouts equal the prizes of the places taken.
- Invite limits per IP and per account; no shared bucket.
- Failed early draw locks nothing; director can still set a rating; locked after the start.
- statsFor order: date, time, id. Same as ratings.js.
- No "H2H undefined"; standings show the steps used.
- Own matches cannot be picked (403); not offered on screen.
- Ties of 3: no `how` = coin flip. Playoff logged as "House rule (not in the rulebook): playoff, order drawn at random".
- Ties touching no prize or playoff spot share the place and do not block. Checked with split 100, 70/30, 60/30/10 and playoff top 2.
- Finish button: commissioner only; auto-finish at 12 hours (11.9 h no, 12.1 h yes).
- Double elimination reset: one game to 15 by default (11-5, 15-14 and two games refused; 16-14 accepted). "match" option works. Tennis always a full match.
- Cross-pool places shared (A and B 1st, $27 each from a $60 pool).
- Weighted pick'em: 8-entry bracket pays 1, 2, 4 in the winners side, 1, 1, 2, 2 in the losers side, 8 for the final and its reset.
- Side-out is the default label.
- Suggest partners shows "Tournament rating used ... Oddable 1531 (real results, 2 of 5 games confirmed)".
- `ratingFor` returns oddable, confirmedGames, event, setBy, use (plus confirmedRating).
- Billing: one `recordPlay(account, 'event', id, seat)` per player; director and spectators not billed; signature matches groups limits.js.
- Calcutta source: `organizer()` true only for the organizer (no viewer, empty, object: false). `teams()` 403 for anyone else. Account ids go out server-side only. `started()`, `organizer()` and `results()` rethrow a database error. `events.calcutta.check.js` passes against the real calcutta.js dc5371b with groups limits.js.

Engine:
- Brackets, sizes 3 to 16, single and double: byes go to the top seeds, 300 random runs each, one champion, everyone else out on exactly 1 (or 2) losses, nothing stuck.
- Round robin schedule, 3 to 9 entries: everyone meets once, one bye per round when odd.
- Tiebreak order by hand on 5 new events (head-to-head; point differential then restart; head-to-head differential; against the next-highest; two separate 2-way ties). All matched. The earlier reviewer's 6 events still match.
- Ladder: reach, swap and shift, one open challenge, forfeit on expiry, no change after a move.
- Elo by hand: singles (6 matches, 4 players) and doubles with unequal ratings (delta 15.86). App equals hand to the point.

Security and races:
- Non-members get 404 on get and partners. Preview shows no entrants, members or claim codes. No account id or member key in any payload.
- HTML characters stripped from every text field; nothing with < or > comes back.
- Concurrent score x3, confirm/dispute/confirm: one wins, rest refused.
- Caps, locks after start, delete, claim codes: unchanged and holding.

Tests, 10 runs each:
- events.test.js (25), events.fix.test.js (14), events.owner.test.js (13), events.rev2.test.js (25): 10 of 10 pass.
- alert.test.js, cfbd.test.js: 10 of 10.
- groups.test.js: 8 of 10. Two runs failed "race join -> 409 Busy, try again". Not touched by this commit; the Groups coder's file. Flaky under load.
- `r2MergedStatsHonoursConfirmed` prints "ok" on this branch although it runs nothing (it returns early without stats.js). Print "skipped".

Playwright (headless, own harness, own ports): 360x740, 430x900, 1280x800 in navy dark, navy "light", violet dark, violet light. 76 screens each, 912 in all.
- Page errors: 0. Console errors: 0.
- Sideways scroll or tables: 0. Tap targets under 44px: 0.
- My Bets banner on top of a screen, closed or open: 0.
- Headers over their data: 0 misaligned.
- Only harness flag: 01-groups-home background (Groups overlay, not this coder's file).
- Navy looks the same with the light switch on or off. That is by design in the code ("like the app").

## What I could not verify
- Anything live. No live requests, no Supabase, no Odds API credits.
- The 2025 USA Pickleball rulebook wording (tiebreak restart, the game to 15). A person should read it.
- Real `limits.recordPlay` under load, and a full merged build of all branches. Most events tests cannot run on a merged copy because they stub the stand-ins.
- Contrast on gradient cards is an estimate.
- The previous reviewer's written report was not on disk; I worked from the scripts, HANDOFF and the commit.

## The coder's own decisions: my recommendation
- A pair with an empty partner spot holds the draw, nobody auto-withdrawn: keep.
- Entry counts as "spent" only once marked paid: keep.
- Auto-finish 12 hours after the last result: keep. The time is shown on the Finish card.
- A neutral commissioner's confirm does not rate the match: keep. Say so on the confirm button.
- Picks on a dropped playoff go with it: keep. Add it to the reset notice.
- No rating weights in events; the stats module owns them: accept, but H1 must be fixed first.
- Wildcard playoff spot by cross-pool record: change (M2).
- Billing remembered in memory only: change (H2).
- A typed-in seat keeps "paid" when its account leaves: keep, but fix the stale case (L1).
- Per-IP preview limit 300 per 10 minutes: raise, or count per code plus IP.
- Money rules editable until the start: change (M1).

## Note
/tmp/rev3 is in use by another reviewer (it now holds a stats clone). I moved to /tmp/revlocal3w at once. My clone there was replaced by theirs; I changed nothing of theirs afterwards.

Scripts: /tmp/revlocal3w/s (a1 to a8, plus the earlier reviewer's adapted), /tmp/revlocal3w/pw (harness, audit, drill). Screenshots: /tmp/revlocal3w/shots. Merged copies: /tmp/revlocal3w/merged, /tmp/revlocal3w/merged2.
