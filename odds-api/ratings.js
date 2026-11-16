// Unofficial ratings for Oddable player stats (Nov 16 2026). Pure functions, no I/O, so the golf and local-events engines can reuse them.
//
// 1) "Oddable handicap (unofficial)" — follows the published World Handicap System method (USGA Rules of Handicapping, verified Nov 16 2026 from
//    https://scga.org/pdfs/Rules of Handicapping_USGA_Final.pdf ; Course Handicap formula also in https://www.usga.org/content/dam/usga/pdf/WHS_Change_Summaries_2020.pdf):
//    - Rule 5.1a  Score Differential = (113 / Slope Rating) x (Adjusted Gross Score - Course Rating - PCC), rounded to the nearest tenth, .5 rounded up
//                 (5.1c: negative values round toward zero, e.g. -1.55 -> -1.5). Oddable uses PCC = 0 (no daily playing-conditions data).
//    - Rule 5.2a  fewer than 20 differentials: 3 -> lowest 1 minus 2.0; 4 -> lowest 1 minus 1.0; 5 -> lowest 1; 6 -> average of lowest 2 minus 1.0;
//                 7-8 -> lowest 2; 9-11 -> lowest 3; 12-14 -> lowest 4; 15-16 -> lowest 5; 17-18 -> lowest 6; 19 -> lowest 7; result rounded to the nearest tenth.
//                 Worked examples in the source: 15.3, 15.2, 16.6 -> 13.2 ; 40.7, 42.4, 36.1 -> 34.1, and after six scores lowest-two average 38.4 -> 37.4.
//    - Rule 5.2b  20 differentials: average of the lowest 8 of the most recent 20, rounded to the nearest tenth.  Rule 5.3: maximum 54.0.
//    - Rule 6.1a  Course Handicap = Handicap Index x (Slope Rating / 113) + (Course Rating - Par), rounded to the nearest whole number, .5 up.
//    - Rule 3.1b  net double bogey = par + 2 + handicap strokes received on the hole. Rule 3.1a: before a player has an index, each hole is capped at par + 5.
//    - Strokes are received from stroke index 1 upward; a plus handicap gives strokes back from stroke index 18 downward (Rule 3.2 Note 2).
//    NOT applied (documented in HANDOFF): PCC, soft/hard cap and Low Handicap Index, exceptional score reduction, 9-hole score combining, committee review.
//    It is NOT an official USGA / GHIN Handicap Index and must never be called one.
//
// 2) "Oddable rating (unofficial)" — Elo for head-to-head local sports (pickleball, tennis, ...), per sport. NOT DUPR.
//    Start 1500, K = 32, expected = 1 / (1 + 10^((opp - me) / 400)), new = old + K x (actual - expected), actual 1 win / 0 loss / 0.5 tie.
//    Doubles: each side's strength is the average of its two players; every player on a side moves by the same amount.
//    Margin of victory: OFF in v1 (option `mov: true` multiplies K by ln(point margin + 1), documented, not used by the app).
const round1 = (v) => { const x = Math.round(v * 10 + 1e-9) / 10; return Object.is(x, -0) ? 0 : x; }; // Math.round rounds .5 toward +infinity: 12.35 -> 12.4, -1.55 -> -1.5 (toward zero), as Rule 5.1
const roundWhole = (v) => Math.round(v + 1e-9);
function differential(ags, courseRating, slope, pcc) {
  if (![ags, courseRating, slope].every(Number.isFinite) || slope < 55 || slope > 155) return null; // Slope Ratings run 55-155
  return round1((113 / slope) * (ags - courseRating - (pcc || 0)));
}
const TABLE = [[3, 1, -2], [4, 1, -1], [5, 1, 0], [6, 2, -1], [8, 2, 0], [11, 3, 0], [14, 4, 0], [16, 5, 0], [18, 6, 0], [19, 7, 0], [20, 8, 0]]; // [up to n scores, lowest used, adjustment]
function indexFrom(diffs) { // diffs = most recent first (or any order of the most recent 20); returns null with fewer than 3
  const d = diffs.filter(Number.isFinite).slice(0, 20), n = d.length; if (n < 3) return null;
  const row = TABLE.find((r) => n <= r[0]), low = d.slice().sort((a, b) => a - b).slice(0, row[1]);
  const v = round1(low.reduce((s, x) => s + x, 0) / low.length + row[2]);
  return { index: Math.min(54, v), used: row[1], of: n, adj: row[2] };
}
function courseHandicap(index, slope, courseRating, par) { if (![index, slope, courseRating, par].every(Number.isFinite)) return null; return roundWhole(index * (slope / 113) + (courseRating - par)); }
function strokesOnHole(ch, si, holes) { // handicap strokes a player receives (+) or gives back (-) on the hole with stroke index si
  const h = holes || 18; if (!Number.isFinite(ch) || !Number.isFinite(si)) return 0;
  if (ch >= 0) return Math.floor(ch / h) + (si <= ch % h ? 1 : 0);
  const g = -ch, n = Math.floor(g / h) + (si > h - (g % h) ? 1 : 0); return n ? -n : 0;
}
// Adjusted gross score for one round. With hole scores + pars (+ stroke indexes once the player has a Course Handicap) each hole is capped; else the total as entered (flagged).
function adjustedGross(r, ch) {
  const st = r.strokes, pars = r.pars, si = r.si, n = Array.isArray(st) ? st.length : 0;
  if (n && st.every(Number.isFinite) && Array.isArray(pars) && pars.length === n && pars.every(Number.isFinite)) {
    if (ch == null) return { ags: st.reduce((s, x, i) => s + Math.min(x, pars[i] + 5), 0), how: 'par+5' }; // no index yet (Rule 3.1a)
    if (Array.isArray(si) && si.length === n && si.every(Number.isFinite)) return { ags: st.reduce((s, x, i) => s + Math.min(x, pars[i] + 2 + strokesOnHole(ch, si[i], n)), 0), how: 'ndb' };
  }
  return { ags: r.total, how: 'as-entered' };
}
// rounds: [{date, total, cr, slope, par, strokes?, pars?, si?}] (18-hole individual rounds only). Walks them in date order: each round's adjusted score uses the
// index from the rounds before it. Returns the current index, the differentials used and the history (index after each round).
function handicap(rounds) {
  const rs = rounds.filter((r) => Number.isFinite(r.total) && Number.isFinite(r.cr) && Number.isFinite(r.slope) && Number.isFinite(r.par)).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const done = [], history = []; let cur = null;
  rs.forEach((r) => {
    const ch = cur ? courseHandicap(cur.index, r.slope, r.cr, r.par) : null, a = adjustedGross(r, ch), diff = differential(a.ags, r.cr, r.slope, 0);
    if (diff == null) return; done.push({ id: r.id, date: r.date, ags: a.ags, how: a.how, diff, total: r.total, cr: r.cr, slope: r.slope, par: r.par });
    cur = indexFrom(done.slice(-20).reverse().map((x) => x.diff)); if (cur) history.push({ date: r.date, index: cur.index });
  });
  const recent = done.slice(-20), lowIds = new Set(recent.slice().sort((a, b) => a.diff - b.diff).slice(0, cur ? cur.used : 0).map((x) => x.id));
  return { index: cur ? cur.index : null, used: cur ? cur.used : 0, of: recent.length, adj: cur ? cur.adj : 0, rounds: done.length, need: Math.max(0, 3 - done.length), flagged: recent.filter((x) => x.how === 'as-entered').length,
    diffs: recent.slice().reverse().map((x) => Object.assign({ used: lowIds.has(x.id) }, x)), history };
}

// ---------- Elo ----------
const ELO = { start: 1500, K: 32 };
const expected = (me, opp) => 1 / (1 + Math.pow(10, (opp - me) / 400));
// One match. a, b = arrays of current ratings (1 player = singles, 2 = doubles). score = 1 if side a won, 0 lost, 0.5 tie. Returns the change for side a (side b gets the opposite).
function eloDelta(a, b, score, opt) {
  const avg = (x) => x.reduce((s, v) => s + v, 0) / x.length, o = opt || {};
  let k = o.K || ELO.K; if (o.mov && Number.isFinite(o.margin)) k *= Math.log(Math.abs(o.margin) + 1);
  return k * (score - expected(avg(a), avg(b)));
}
// A player's rating over their own match records (in date order). Opponents / partners are rated at extra.oppRating / extra.partnerRating when an engine knows them, else the start value.
function eloFor(matches) {
  let r = ELO.start; const history = [];
  matches.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach((m) => {
    const s = m.result === 'W' ? 1 : m.result === 'L' ? 0 : m.result === 'T' ? 0.5 : null; if (s == null) return;
    const ex = m.extra || {}, dbl = ex.fmt === 'doubles' || (Array.isArray(ex.opp) && ex.opp.length === 2);
    const opp = (Array.isArray(ex.oppRating) ? ex.oppRating : [ex.oppRating, ex.oppRating]).map((x) => (Number.isFinite(x) ? x : ELO.start)).slice(0, dbl ? 2 : 1);
    const mine = dbl ? [r, Number.isFinite(ex.partnerRating) ? ex.partnerRating : ELO.start] : [r];
    r += eloDelta(mine, opp, s); history.push({ date: m.date, rating: Math.round(r) });
  });
  return { rating: Math.round(r), matches: history.length, history };
}
module.exports = { differential, indexFrom, courseHandicap, strokesOnHole, adjustedGross, handicap, expected, eloDelta, eloFor, ELO, round1 };
