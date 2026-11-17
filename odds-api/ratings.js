// Unofficial ratings for Oddable player stats (Nov 16 2026). Pure functions, no I/O, so the golf and local-events engines can reuse them.
//
// 1) "Oddable Handicap Index" (H1 name; shown with "Calculated with the World Handicap System method.") — follows the published World Handicap System method (USGA Rules of Handicapping, verified Nov 16 2026 from
//    the 2024 USGA Rules of Handicapping, https://www.scga.org/pdfs/2024 Rules of Handicapping.pdf (Rules 3.1a, 3.1b, 5.1a, 5.2a incl. its two worked
//    examples, 5.2b, 6.1a quoted from it; re-read Nov 16 2026 by the stats coder). Rule 5.2b also matches R&A's https://www.randa.org/roh/the-rules-of-handicapping/rule-5 ):
//    - Rule 5.1a  Score Differential = (113 / Slope Rating) x (Adjusted Gross Score - Course Rating - PCC), rounded to the nearest tenth, .5 rounded up
//                 (5.1c: negative values round toward zero, e.g. -1.55 -> -1.5). Oddable uses PCC = 0 (no daily playing-conditions data).
//    - Rule 5.2a  fewer than 20 differentials: 3 -> lowest 1 minus 2.0; 4 -> lowest 1 minus 1.0; 5 -> lowest 1; 6 -> average of lowest 2 minus 1.0;
//                 7-8 -> lowest 2; 9-11 -> lowest 3; 12-14 -> lowest 4; 15-16 -> lowest 5; 17-18 -> lowest 6; 19 -> lowest 7; result rounded to the nearest tenth.
//                 Worked examples in the source: 15.3, 15.2, 16.6 -> 13.2 ; 40.7, 42.4, 36.1 -> 34.1, and after six scores lowest-two average 38.4 -> 37.4.
//    - Rule 5.2b  20 differentials: average of the lowest 8 of the most recent 20, rounded to the nearest tenth.  Rule 5.3: maximum 54.0.
//    - Rule 6.1a  Course Handicap = Handicap Index x (Slope Rating / 113) + (Course Rating - Par), rounded to the nearest whole number, .5 up.
//    - Rule 3.1b  net double bogey = par + 2 + handicap strokes received on the hole. Rule 3.1a: before a player has an index, each hole is capped at par + 5.
//    - Strokes are received from stroke index 1 upward; a plus handicap gives strokes back from stroke index 18 downward (Rule 3.2 Note 2).
//    - Rule 3.1a (Nov 16 2026 review fix): hole scores WITHOUT stroke indexes are capped at par + 5 on every hole (net double bogey needs the stroke index);
//                 a round typed as a total is capped as a total (see TYPED TOTALS below) and flagged.
//    - Rule 5.7 / 5.8 caps: the Low Handicap Index is the lowest index of the 365 days before the round, once 20 rounds exist. Soft cap: any rise beyond 3.0
//                 above the Low Handicap Index is halved. Hard cap: the index can never be more than 5.0 above it.
//    - Rule 5.9   exceptional score: a Score Differential 7.0 to 9.9 below the index in force when the round was played takes 1.0 off each of the most recent
//                 20 differentials (that round included); 10.0 or more takes 2.0 off. The reduction stays on those rounds until they leave the 20.
//    - Rule 5.1b  9-HOLE ROUNDS (WHS 2024 expected-score method): 18-hole Score Differential = 9-hole Score Differential + expected 9-hole Score Differential.
//                 9-hole Score Differential = (113 / 9-hole Slope) x (9-hole adjusted gross - 9-hole Course Rating), not rounded until the sum.
//                 Expected 9-hole Score Differential = 0.52 x Handicap Index + 1.2, rounded to the tenth. The USGA does not publish its expected-score table; this
//                 line is the commonly used fit and it reproduces the USGA's own worked example (index 14.0, 9-hole differential 7.2 -> 18-hole 15.7, expected 8.5;
//                 https://www.usga.org/content/usga/home-page/handicapping/world-handicap-system/2024-revision/2024-treatment-of-9-hole-scores-FAQ.html, read Nov 16 2026).
//                 Before a player has an index a 9-hole round waits until 54 holes are posted (USGA rule). Then the SAME expected-score method is used
//                 (review 3, L1: no more doubling): a provisional index is worked out from the rounds on file (each waiting nine counted twice, for this step
//                 only), and every waiting nine becomes 9-hole differential + expected(provisional index). 9-hole handling is an ESTIMATE of the official
//                 method (the official expected-score table is not published); My handicap says so.
//                 9-hole Course Handicap (Rule 6.1b) = index / 2 x (Slope / 113) + (Rating - par).
//    - TYPED TOTALS (review 3, M5): a round entered as a total has no holes to cap, so the TOTAL is capped: par + 2 a hole + the Course Handicap once the
//                 player has an index (net double bogey on every hole), else par + 5 a hole. Hole scores without stroke indexes: par + 5 on each hole, and
//                 the sum is also held to par + 2 a hole + the Course Handicap once an index exists.
//    - NO HANDICAP IS NEVER 0 STROKES (review 3, M7): strokesOnHole() and courseHandicap() THROW on a missing (null / undefined / NaN) handicap. An engine
//                 must handle "no handicap yet" itself (ask the organizer for a number) before it asks for strokes.
//    - Limits: index never above 54.0 (Rule 5.3) and, in Oddable, never below +10.0 (shown as -10).
//    - Same-day order: rounds and matches are always processed by date, then entry time (`at`), then id, whatever order they arrive in.
//    - Confirmed rounds (owner rule H1, manager decision Nov 16 2026): handicapSet() also works out the index from confirmed rounds only (round.confirmed = true).
//    NOT applied: PCC (no daily playing-conditions data), committee review.
//    It is NOT an official USGA / GHIN Handicap Index and must never be called one.
//
// 2) "Oddable rating" — Elo for head-to-head local sports (pickleball, tennis, ...), per sport. NOT DUPR.
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
const NOHCP = 'no handicap: a missing handicap is never 0 strokes. Handle "no handicap yet" (ask the organizer or director for a number) before asking for strokes.';
function courseHandicap(index, slope, courseRating, par) { // a missing INDEX throws (never 0, never a silent null); missing course numbers give null (nothing to work out yet)
  if (index == null || typeof index !== 'number' || !Number.isFinite(index)) throw new TypeError('courseHandicap: ' + NOHCP);
  if (![slope, courseRating, par].every(Number.isFinite)) return null; return roundWhole(index * (slope / 113) + (courseRating - par)); }
function strokesOnHole(ch, si, holes) { // handicap strokes a player receives (+) or gives back (-) on the hole with stroke index si
  const h = holes || 18; if (ch == null || typeof ch !== 'number' || !Number.isFinite(ch)) throw new TypeError('strokesOnHole: ' + NOHCP);
  if (typeof si !== 'number' || !Number.isFinite(si)) throw new TypeError('strokesOnHole: no stroke index for this hole');
  if (ch >= 0) return Math.floor(ch / h) + (si <= ch % h ? 1 : 0);
  const g = -ch, n = Math.floor(g / h) + (si > h - (g % h) ? 1 : 0); return n ? -n : 0;
}
// Adjusted gross score for one round. With hole scores + pars (+ stroke indexes once the player has a Course Handicap) each hole is capped; else the total as entered (flagged).
// `holes` lists every hole: {n, par, si, strokes, max, used} so the round drill-down can show where a net double bogey (or par + 5) cut a score.
function adjustedGross(r, ch) {
  const st = r.strokes, pars = r.pars, si = r.si, n = Array.isArray(st) ? st.length : 0;
  if (n && st.every(Number.isFinite) && Array.isArray(pars) && pars.length === n && pars.every(Number.isFinite)) {
    const hasSi = Array.isArray(si) && si.length === n && si.every(Number.isFinite);
    { // no index yet, or no stroke indexes on the card: par + 5 on every hole (Rule 3.1a); with both: net double bogey (Rule 3.1b)
      const how = ch == null || !hasSi ? 'par+5' : 'ndb', holes = st.map((x, i) => { const max = how === 'par+5' ? pars[i] + 5 : pars[i] + 2 + strokesOnHole(ch, si[i], n); return { n: i + 1, par: pars[i], si: hasSi ? si[i] : null, strokes: x, max, used: Math.min(x, max) }; });
      const sum = holes.reduce((s, h) => s + h.used, 0), out = { ags: sum, how, holes, cut: holes.filter((h) => h.used < h.strokes).length };
      if (how === 'par+5' && ch != null) { const cap = pars.reduce((a, b) => a + b, 0) + 2 * n + ch; if (sum > cap) { out.ags = cap; out.capAt = cap; out.capHow = 'ndb-total'; out.capped = sum - cap; } } // an index but no stroke indexes: the round as a whole is held to net double bogey
      return out;
    }
  }
  // A typed total: capped as a total (par + 2 a hole + Course Handicap with an index, else par + 5 a hole). `how` stays 'as-entered' (the "entered as a total" flag).
  const nh = Number(r.holes) === 9 ? 9 : 18;
  if (Number.isFinite(r.total) && Number.isFinite(r.par)) { const cap = ch != null ? r.par + 2 * nh + ch : r.par + 5 * nh; return { ags: Math.min(r.total, cap), how: 'as-entered', holes: null, cut: 0, capAt: cap, capHow: ch != null ? 'ndb-total' : 'par+5-total', capped: Math.max(0, r.total - cap) }; }
  return { ags: r.total, how: 'as-entered', holes: null, cut: 0 };
}
// Order used everywhere (handicap, Elo, My stats lists): date, then entry time (`at` or extra.at), then id. Input order never matters.
const atOf = (x) => { const v = x.at != null ? x.at : x.extra && x.extra.at; return Number.isFinite(Number(v)) ? Number(v) : 0; };
const order = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || atOf(a) - atOf(b) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
const expected9 = (index) => round1(0.52 * index + 1.2); // expected 9-hole Score Differential (see the header: fits the USGA example 14.0 -> 8.5)
const CAP = { soft: 3, hard: 5, min: -10, max: 54 };
const dayMinus = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
// rounds: [{id, date, at?, total, cr, slope, par, holes? (9 | 18), strokes?, pars?, si?, confirmed?, self?}] (own-ball rounds only). Walks them in order: each round's
// adjusted score uses the index from the rounds before it. Returns the current index, the differentials used and the history (index after each round).
function handicap(rounds) {
  const rs = rounds.filter((r) => Number.isFinite(r.total) && Number.isFinite(r.cr) && Number.isFinite(r.slope) && Number.isFinite(r.par)).slice().sort(order);
  let done = [], pend = [], cur = null, seq = 0; const history = [];
  rs.forEach((r) => {
    const nine = Number(r.holes) === 9, before = cur ? cur.index : null;
    const ch = cur ? courseHandicap(nine ? cur.index / 2 : cur.index, r.slope, r.cr, r.par) : null, a = adjustedGross(r, ch);
    if (r.slope < 55 || r.slope > 155) return;
    const e = { seq: seq++, id: r.id, date: r.date, at: atOf(r), ags: a.ags, how: a.how, diff: null, esr: 0, total: r.total, cr: r.cr, slope: r.slope, par: r.par, ch, holes: a.holes, cut: a.cut, nHoles: nine ? 9 : 18, course: r.course || '', tees: r.tees || '', idxBefore: before, confirmed: !!r.confirmed, self: !!r.self };
    if (a.capAt != null) { e.capAt = a.capAt; e.capHow = a.capHow; e.capped = a.capped; } if (r.meta) e.meta = r.meta; // meta: who confirmed it, typed or scored (stats.js fills it; shown in the make-up of a number)
    if (nine) { e.d9 = (113 / r.slope) * (a.ags - r.cr); if (cur) { e.exp9 = expected9(cur.index); e.diff = round1(e.d9 + e.exp9); } }
    else e.diff = differential(a.ags, r.cr, r.slope, 0);
    if (e.diff == null) pend.push(e); else done.push(e);
    if (!cur && pend.length && done.reduce((s, x) => s + x.nHoles, 0) + pend.length * 9 >= 54) { // 54 holes posted: the waiting nines count, by the expected-score method
      // No index yet to look the expected score up with, so a PROVISIONAL index comes from the rounds on file (each nine twice, for this step only);
      // then every waiting nine = its 9-hole differential + expected(provisional index). The same formula as after an index exists (review 3, L1).
      const prov = indexFrom(done.map((x) => x.diff).concat(pend.map((x) => round1(x.d9 * 2)))), pidx = prov ? Math.max(CAP.min, Math.min(CAP.max, prov.index)) : null;
      pend.forEach((x) => { if (pidx == null) { x.exp9 = round1(x.d9); x.diff = round1(x.d9 * 2); } else { x.exp9 = expected9(pidx); x.diff = round1(x.d9 + x.exp9); x.prov = pidx; } }); done = done.concat(pend).sort((x, y) => x.seq - y.seq); pend = [];
    }
    if (e.diff == null) return;
    if (before != null) { const gap = round1(before - e.diff), adj = gap >= 10 ? -2 : gap >= 7 ? -1 : 0; if (adj) { e.exc = adj; done.slice(-20).forEach((x) => { x.esr += adj; }); } } // Rule 5.9 exceptional score
    const raw = indexFrom(done.slice(-20).reverse().map((x) => round1(x.diff + x.esr))); if (!raw) { cur = null; return; }
    let idx = raw.index, cap = null, low = null;
    if (done.length >= 20) { // Rule 5.7: the Low Handicap Index exists once 20 rounds do
      const from = dayMinus(r.date, 365), lows = history.filter((h) => h.full && h.date >= from).map((h) => h.index); if (lows.length) low = Math.min(...lows);
      if (low != null && idx > low + CAP.soft) { idx = round1(low + CAP.soft + (idx - low - CAP.soft) / 2); cap = 'soft'; if (idx > low + CAP.hard) { idx = round1(low + CAP.hard); cap = 'hard'; } }
    }
    idx = Math.max(CAP.min, Math.min(CAP.max, idx));
    cur = { index: idx, raw: raw.index, used: raw.used, adj: raw.adj, cap, low };
    history.push({ date: r.date, index: idx, id: r.id, full: done.length >= 20 });
  });
  const recent = done.slice(-20), lowIds = new Set(recent.slice().sort((a, b) => a.diff + a.esr - (b.diff + b.esr)).slice(0, cur ? cur.used : 0).map((x) => x.id));
  const holesPosted = done.reduce((s, x) => s + x.nHoles, 0) + pend.length * 9;
  return { index: cur ? cur.index : null, raw: cur ? cur.raw : null, cap: cur ? cur.cap : null, low: cur ? cur.low : null, used: cur ? cur.used : 0, of: recent.length, adj: cur ? cur.adj : 0, rounds: done.length,
    need: cur ? 0 : Math.max(0, Math.ceil((54 - holesPosted) / 18)), toTwenty: Math.max(0, 20 - done.length), flagged: recent.filter((x) => x.how === 'as-entered').length, waiting9: pend.length,
    confirmedOf: recent.filter((x) => x.confirmed).length, selfLogged: recent.filter((x) => x.self).length,
    diffs: recent.slice().reverse().map((x) => Object.assign({ used: lowIds.has(x.id), eff: round1(x.diff + x.esr) }, x)), history: history.map((h) => ({ date: h.date, index: h.index, id: h.id })) };
}
// THE handicap calculation every screen and engine uses: the full Oddable index (every round) plus the index from confirmed rounds only.
function handicapSet(rounds) {
  const h = handicap(rounds), c = handicap(rounds.filter((r) => r.confirmed));
  h.confirmedIndex = c.index; h.confirmedRounds = c.rounds; h.confirmed = { index: c.index, rounds: c.rounds, of: c.of, used: c.used, cap: c.cap, low: c.low };
  h.confirmedDiffs = c.diffs; // the last 20 confirmed rounds, newest first, each with `used` and `meta`: the make-up of the money-game number
  h.text = hcpText(h); return h;
}
// What another person sees next to a handicap: "12.6 · 4 of 20 rounds confirmed".
function hcpText(h) { return (h.index == null ? 'No index yet' : fmtIdx(h.index)) + ' · ' + h.confirmedOf + ' of ' + h.of + ' round' + (h.of === 1 ? '' : 's') + ' confirmed'; }
const fmtIdx = (v) => (v < 0 ? '+' + (-v).toFixed(1) : v.toFixed(1)); // a plus handicap is written +1.5

// ---------- Elo ----------
const ELO = { start: 1500, K: 32 };
const expected = (me, opp) => 1 / (1 + Math.pow(10, (opp - me) / 400));
// One match. a, b = arrays of current ratings (1 player = singles, 2 = doubles). score = 1 if side a won, 0 lost, 0.5 tie. Returns the change for side a (side b gets the opposite).
function eloDelta(a, b, score, opt) {
  const avg = (x) => x.reduce((s, v) => s + v, 0) / x.length, o = opt || {};
  let k = o.K || ELO.K; if (o.mov && Number.isFinite(o.margin)) k *= Math.log(Math.abs(o.margin) + 1);
  return k * (score - expected(avg(a), avg(b)));
}
// A player's rating over their own match records, processed by date, entry time, id (never input order).
// Opponents / partners are rated at extra.oppRating (a number, or one per opponent) / extra.partnerRating when an engine or a confirmation supplied them, else the start value.
// FARMING GUARD (Nov 16 2026): repeated games against the same opponent(s) inside 7 days count less each time: the 1st at full weight, the 2nd at 1/2,
// the 3rd at 1/4 ... (weight = 0.5 ^ earlier games against them in the 7 days before). Two accounts trading wins cannot pump a rating; a normal week is untouched.
// Review 3 (M1, manager rule): the 7 days are measured on the server ENTRY time of each game (`at` / extra.at, stamped by the server when it was logged or
// made final), never on the date the player typed: twelve games entered in one sitting are twelve games in one week, whatever dates they carry.
// And at most 2 RATED games per pair in any rolling 24 hours of entry time: a third (and later) one is kept as a record with weight 0.
const FARM = { days: 7, base: 0.5, perDay: 2, dayMs: 864e5 };
const entryMs = (m) => { const t = atOf(m); return t > 0 ? t : Date.parse(m.date + 'T18:00:00Z') || 0; }; // a record with no entry time on it (old data): its day
function farmWeights(matches) { // Map(match -> weight), worked out in ENTRY order
  const W = new Map(), seen = [];
  matches.filter((m) => m.result === 'W' || m.result === 'L' || m.result === 'T').slice().sort((a, b) => entryMs(a) - entryMs(b) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)).forEach((m) => {
    const key = oppKeyOf(m), t = entryMs(m); if (key === '?') { W.set(m, 1); return; } // no opponent on the record at all: nothing to compare
    const same = seen.filter((x) => x.key === key), n7 = same.filter((x) => x.t > t - FARM.days * FARM.dayMs).length, n24 = same.filter((x) => x.w > 0 && x.t > t - FARM.dayMs).length;
    const w = n24 >= FARM.perDay ? 0 : Math.pow(FARM.base, n7); seen.push({ key, t, w }); W.set(m, w);
  });
  return W;
}
const oppKeyOf = (m) => { const ex = m.extra || {}; if (ex.oppKey) return String(ex.oppKey); const n = (Array.isArray(ex.opp) && ex.opp.length ? ex.opp.map((x) => (x && typeof x === 'object' ? x.id || x.name : x)) : [m.opponent]).map((x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '')).filter(Boolean).sort(); return n.join('|') || '?'; };
function eloFor(matches) {
  let r = ELO.start; const history = [], W = farmWeights(matches);
  matches.slice().sort(order).forEach((m) => {
    const s = m.result === 'W' ? 1 : m.result === 'L' ? 0 : m.result === 'T' ? 0.5 : null; if (s == null) return;
    const ex = m.extra || {}, dbl = ex.fmt === 'doubles' || (ex.fmt == null && Array.isArray(ex.opp) && ex.opp.length === 2);
    const opp = (Array.isArray(ex.oppRating) ? ex.oppRating.concat([null, null]) : [ex.oppRating, ex.oppRating]).map((x) => (x != null && Number.isFinite(Number(x)) ? Number(x) : ELO.start)).slice(0, dbl ? 2 : 1);
    const mine = dbl ? [r, ex.partnerRating != null && Number.isFinite(Number(ex.partnerRating)) ? Number(ex.partnerRating) : ELO.start] : [r];
    const w = W.has(m) ? W.get(m) : 1;
    r += w * eloDelta(mine, opp, s); history.push({ date: m.date, rating: Math.round(r), id: m.id, w });
  });
  const rated = history.filter((h) => h.w > 0).length;
  return { rating: Math.round(r), matches: history.length, rated, unrated: history.length - rated, history };
}
// THE rating calculation every screen and engine uses: the full Oddable rating (every game) plus the rating from confirmed games only (used for seeding).
function eloSet(matches) {
  const all = eloFor(matches), c = eloFor(matches.filter((m) => m.confirmed || (m.extra && m.extra.confirmed)));
  all.confirmedRating = c.rated ? c.rating : null; all.confirmedGames = c.rated; all.confirmedHistory = c.history; all.text = all.rating + ' · ' + c.rated + ' of ' + all.matches + ' game' + (all.matches === 1 ? '' : 's') + ' confirmed'; return all;
}
module.exports = { differential, indexFrom, courseHandicap, strokesOnHole, adjustedGross, handicap, handicapSet, hcpText, fmtIdx, expected9, CAP, order, expected, eloDelta, eloFor, eloSet, farmWeights, entryMs, FARM, ELO, round1 };
