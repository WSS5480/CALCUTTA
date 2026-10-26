/* Calcutta model. Pure function: (teams, lots, payouts) -> per-team, per-group and per-buyer numbers.
   Inputs that change weekly live in data/teams.json (records, playoff %, Super Bowl odds). */
(function (root) {
  const american = (o) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));

  function compute(teamData, lots, pay) {
    const teams = teamData.teams.map((t) => ({ ...t }));
    const by = {};
    const pool = lots.reduce((a, l) => a + l.paid, 0);

    // 1) Champion probability: Super Bowl odds with the sportsbook margin removed.
    const raw = teams.map((t) => american(t.sbOdds));
    const rawSum = raw.reduce((a, b) => a + b, 0);

    teams.forEach((t, i) => {
      t.c = raw[i] / rawSum; // P(win Super Bowl)
      t.m = Math.max(t.playoffPct / 100, t.c); // P(make playoffs), market price
      // Per-playoff-game win chance consistent with c = m * p^4
      t.p = Math.min(0.99, Math.pow(t.c / t.m, 0.25));
      t.a1 = t.m * t.p; // P(win a wild-card game)
      t.a2 = t.m * t.p ** 2; // P(win a divisional game)
      t.a3 = t.m * t.p ** 3; // P(win conference) = reach Super Bowl
      // Heuristic for "worst record": more losses than wins, and unlikely to make playoffs
      t.worst = Math.exp(0.6 * (t.l - t.w)) * (1 - t.m) ** 2;
      by[t.abbr] = t;
    });

    // Game-prediction strength: z-scored blend of season strength (playoff odds) and title odds.
    // (t.p above only describes playoff games and barely separates good from bad teams.)
    const zs = (arr) => {
      const mu = arr.reduce((a, b) => a + b, 0) / arr.length;
      const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mu) ** 2, 0) / arr.length) || 1;
      return arr.map((v) => (v - mu) / sd);
    };
    const lg = (x) => Math.log(x / (1 - x));
    const zm = zs(teams.map((t) => lg(Math.min(0.985, Math.max(0.01, t.playoffPct / 100)))));
    const zc = zs(teams.map((t) => Math.log(t.c)));
    teams.forEach((t, i) => (t.rating = 0.5 * zm[i] + 0.5 * zc[i]));

    // 2) Make each round add up to the real number of winners (6 / 4 / 2 / 1)
    const rescale = (key, target) => {
      for (let n = 0; n < 40; n++) {
        const s = teams.reduce((a, t) => a + t[key], 0);
        const k = target / s;
        teams.forEach((t) => (t[key] = Math.min(t[key] * k, t.m)));
      }
    };
    rescale('a1', pay.wildCard.games);
    rescale('a2', pay.divisional.games);
    rescale('a3', pay.conference.games);
    teams.forEach((t) => {
      t.a3 = Math.max(t.a3, t.c);
      t.a2 = Math.max(t.a2, t.a3);
    });
    const ws = teams.reduce((a, t) => a + t.worst, 0);
    teams.forEach((t) => (t.worst /= ws));

    // 3) Expected share of the pool per team
    const f = (x) => x.pct / 100;
    teams.forEach((t) => {
      t.sbLoss = t.a3 - t.c; // reached the Super Bowl and lost
      t.parts = {
        nalgas: t.worst * f(pay.nalgas),
        wildCard: t.a1 * (f(pay.wildCard) / pay.wildCard.games),
        divisional: t.a2 * (f(pay.divisional) / pay.divisional.games),
        conference: t.a3 * (f(pay.conference) / pay.conference.games),
        sbLoser: t.sbLoss * f(pay.sbLoser),
        champion: t.c * f(pay.champion),
      };
      t.evShare = Object.values(t.parts).reduce((a, b) => a + b, 0);
      t.ev = t.evShare * pool;
    });

    // 4) Groups (lots)
    const groups = lots.map((l) => {
      const ts = l.teams.map((a) => by[a]);
      const g = { ...l, ts };
      g.ev = ts.reduce((a, t) => a + t.ev, 0);
      g.edge = g.ev - l.paid;
      g.edgePct = g.edge / l.paid;
      g.pPlayoffs = 1 - ts.reduce((a, t) => a * (1 - t.m), 1); // at least one team makes it
      g.pTitle = ts.reduce((a, t) => a + t.c, 0);
      g.pSB = ts.reduce((a, t) => a + t.a3, 0);
      g.pWorst = ts.reduce((a, t) => a + t.worst, 0);
      g.paidShare = l.paid / pool;
      g.parts = {};
      Object.keys(pay).forEach((k) => (g.parts[k] = ts.reduce((a, t) => a + t.parts[k], 0) * pool));
      return g;
    });

    // 5) Buyers
    const buyers = {};
    groups.forEach((g) => {
      const b = (buyers[g.buyer] = buyers[g.buyer] || { name: g.buyer, groups: [], paid: 0, ev: 0, pTitle: 0, noPlayoffs: 1 });
      b.groups.push(g);
      b.paid += g.paid;
      b.ev += g.ev;
      b.pTitle += g.pTitle;
      b.noPlayoffs *= 1 - g.pPlayoffs;
    });
    const buyerList = Object.values(buyers).map((b) => ({
      ...b,
      edge: b.ev - b.paid,
      edgePct: (b.ev - b.paid) / b.paid,
      pPlayoffs: 1 - b.noPlayoffs,
    }));

    return { pool, teams, by, groups, buyers: buyerList };
  }

  // Head-to-head win chance for team A vs team B: logistic on the rating gap plus home field.
  // Backtested on Weeks 1-7 of 2026 (see README); K and HOME are deliberately a bit conservative.
  const K = 0.4;
  const HOME = 0.15; // logit points, roughly a 54% home edge between equals
  function winProb(by, a, b, homeAbbr) {
    const A = by[a], B = by[b];
    if (!A || !B) return 0.5;
    const home = homeAbbr === a ? HOME : homeAbbr === b ? -HOME : 0;
    return 1 / (1 + Math.exp(-(K * (A.rating - B.rating) + home)));
  }

  const api = { compute, american, winProb };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calcutta = api;
})(typeof window !== 'undefined' ? window : globalThis);
