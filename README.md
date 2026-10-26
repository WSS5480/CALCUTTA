# Calcutta 2026

Static site (no build step). Shows every Calcutta group with team records, playoff probability,
title odds, expected payout and value vs. price paid.

## Weekly update (only `public/data/teams.json` changes)
- `w / l / t / pf / pa`: records and points for/against (Covers.com NFL standings)
- `playoffPct`: market chance to make the playoffs, 0-100 (Kalshi via Covers.com "NFL playoff odds")
- `sbOdds`: American Super Bowl odds (DraftKings via Covers.com "Super Bowl odds")
- `updated`, `asOf`, `sources`: labels shown at the top and bottom of the page

Everything else is calculated in `public/model.js` in the browser. Push to the main branch and Render redeploys.

`public/data/lots.json` holds groups, buyers and prices. `public/data/payouts.json` holds the payout sheet.
Buyers listed in `LOGOS` in `public/index.html` get a custom avatar (Navas = The Dive logo).

## Live games
The Games tab polls ESPN's public scoreboard every minute while a game is live (or starts within 20 min), otherwise every 5 minutes. Each card shows score, clock, spread/over-under, current drive, quarter line score, and Calcutta stats (owner, lot, playoff %, title %, EV) for both teams.

## Pick model (Picks tab)
Win chance = logistic(0.4 x rating gap + 0.15 home field). Rating = average of the z-scored logit of playoff odds and the z-scored log of title odds (both from `teams.json`).
Backtest on Weeks 1-7 (105 games, ESPN finals): old model (playoff-game strength + 0.22 home) 46% (below a coin flip); new rating 69% (64% Weeks 3-7).
Caveat: past games are graded with today's prices, which already include those results, so the backtest flatters the model. Walk-forward Elo with no market input, which has no leakage, scored 52-58%.
Adding in-season point margin on top of the market rating did not help. Predictions are only as fresh as the weekly `playoffPct` and `sbOdds` update.
