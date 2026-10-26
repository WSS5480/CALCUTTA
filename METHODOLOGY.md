# Steve's Pics — Prediction Methodology (v19)

Applies to NFL and college football (FBS). Everything runs in the browser from ESPN's public data; nothing is hand-entered.

## 1. Inputs
- Scores and schedule: ESPN scoreboard, every week of the season, refreshed every 1 min (live) / 5 min.
- Betting line: ESPN/DraftKings point spread (current line for upcoming games; closing line for finished games). Opening line from ESPN's game summary.
- Box scores: yards per play and turnovers for every finished game (ESPN game summary).
- College only: AP Top 25 rank.
- NFL only: ESPN injury report and who played (passing/rushing/receiving/tackle usage), used for the "starters hurt" note.

## 2. Team model (same structure for both leagues)
**a) Season margin rating** — a ridge-regularized power rating (Massey-style):
- For each finished game, margin = home score − away score, capped (NFL ±24, college ±28), minus home-field edge (NFL 2.0 pts, college 2.5, none at neutral sites).
- Each team's rating = (sum of margin-adjusted-for-opponent over its games) ÷ (games + λ). λ = 3 (NFL) / 4 (college). 25 iterations.
- College ratings start from an AP-rank prior (rank 1 ≈ +15 pts, fading with games played). Unranked prior = 0.

**b) Efficiency rating**
- Per game: 8 × (yards-per-play edge) + 4 × (turnover edge), from the home team's viewpoint.
- Team rating = season total ÷ (games + 4).

**c) Model margin for a game** (home points):
`model = 0.5 × (margin rating diff + home edge) + 0.5 × (efficiency diff + home edge)`
(falls back to margin-only until a team has box-score data).

**d) Model win chance**: Φ(model ÷ SD), SD = 13.5 (NFL) / 16 (college).

## 3. Blending with the line
- Market win chance = Φ(line ÷ SD), where line = home-favored points.
- **Win chance shown = 60% market + 40% model.** The line is sharper than any model here, so it carries most weight, and the percentage moves when the line moves.
- Win pick = side with the higher blended chance.

## 4. Spread pick and cover %
- Lean = home if model margin > line, otherwise away.
- Cover % = 50% + 0.30 × (Φ((model − line) ÷ SD) − 50%) — shrunk hard toward 50% because the market is usually right.

## 5. Injuries (NFL)
Shown on upcoming games as "starters hurt (info only)". A starter = the team's season leader in passing attempts (QB), carries (RB), receiving yards (top 3) or tackles (top 4). Out/IR/Doubtful count fully; Questionable counts ~35%. **Not used in the pick**: a backtest showed no gain once the line is in the blend (the line already prices in who's out).

## 6. Records shown
- **Backtest tiles**: past games graded with *today's* ratings and the closing line. Contains hindsight; flattering.
- **🔒 Locked tiles**: the pick as it stood before kickoff, saved on the device, graded against the saved line. This is the honest record. Counts only games opened in the app before kickoff.

## 7. Honest backtest (NFL weeks 3–7, 73 games, each week predicted only from earlier weeks)
| Model | Win picks | Spread |
|---|---|---|
| Betting line alone | 60.3% | – |
| Season margin only | 56.2% | 50.7% |
| Efficiency only | 54.8% | 53.5% |
| Margin + efficiency | 57.5% | 53.5% |
| 60% line + 40% margin | 61.6% | – |
| 60% line + 40% margin + efficiency | 60.3% | – |
| + quarterback-out penalty (5.5 pts) | 58.9% alone; 57.5% with line | 53.5% |

Takeaways: the model roughly matches the line, not beats it. Differences of 1–3 points are noise at this sample size (±6 pts). The earlier model (playoff % and Super Bowl odds) scored 64.8% / 67.3% only because those odds already contained the results (hindsight).

## 8. Known limits
- College model untested out-of-sample; it reuses the NFL structure.
- Past injury reports aren't available, so non-QB injury weights are unbacktested.
- Line history only exists from the time logging started (Render logger); By-day/By-hour charts fill in over time.
- No weather, travel/rest, coaching changes, or player-level projections.
