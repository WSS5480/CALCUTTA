/* Oddable Alert parlays + "Move the line?" math (v253). Pure functions, no DOM: used by the server (odds-api/alert.js), the app (pics/index.html),
   scripts/parlay-check.js and odds-api/alert.test.js, so every place composes, grades and prices a parlay the same way.
   Owner rules (Nov 15 2026):
     2-game parlay = 🔒 Lock + the highest-% PICKED division road dog (model 53%+, not the Lock's game). No picked dog = no 2-game parlay.
     3-game parlay = 🔒 Lock + the top two division road dogs by model % (picked or not, not the Lock's game). Fewer than two = no 3-game parlay.
     Graded at each leg's frozen line. A pushed leg drops out (3 -> 2, 2 -> single); a lost leg loses the parlay.
     Payout = product of the legs' ACTUAL decimal prices - 1. A leg with no price = no payout shown (never assumed to be -110).
   Prices are American odds (e.g. -112, +105). */
(function (root) {
  var MIN = 0.53;
  function dec(a) { return a < 0 ? 1 + 100 / -a : 1 + a / 100; }
  function amer(d) { return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1)); }
  function okPrice(a) { return typeof a === 'number' && isFinite(a) && (a <= -100 || a >= 100) && Math.abs(a) <= 5000; }
  var byP = function (a, b) { return b.p - a.p || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0); };
  // lock: {id, ...} or null; dogs: [{id, p, fin?}] = every division road dog of the week (picked or not).
  // o (optional, live server weeks only; owner D9, Nov 15 2026): { keep: { two: [ids], three: [ids] } } = dog legs that are already FROZEN in that parlay: they stay.
  // Only legs that are not frozen can change; a dog that is already frozen (its game is within the freeze time) is never ADDED to a parlay. Back-filled weeks pass no `o`.
  // Returns { two: [lock, dog] | null, three: [lock, dog, dog] | null }.
  function compose(lock, dogs, o) {
    if (!lock) return { two: null, three: null };
    var others = (dogs || []).filter(function (d) { return d && String(d.id) !== String(lock.id) && typeof d.p === 'number'; });
    var keep = function (kind) { return others.filter(function (d) { return o && o.keep && (o.keep[kind] || []).indexOf(String(d.id)) >= 0; }); };
    var free = function (kind) { var k = keep(kind); return others.filter(function (d) { return k.indexOf(d) < 0 && (!o || !d.fin); }).sort(byP); };
    var k2 = keep('two').filter(function (d) { return d.p >= MIN; }), two = k2.length ? k2[0] : free('two').filter(function (d) { return d.p >= MIN; })[0];
    var k3 = keep('three').sort(byP).slice(0, 2), three = k3.concat(free('three').slice(0, 2 - k3.length)).sort(byP);
    return { two: two ? [lock, two] : null, three: three.length >= 2 ? [lock, three[0], three[1]] : null };
  }
  // legs: [{res: 'hit'|'miss'|'push'|'' (pending), price: American odds or null}]
  // -> { res: 'hit'|'miss'|'push'|'' , left: legs still counting, reduced: a leg pushed, units: profit on 1 unit or null (no price), d: decimal payout or null }
  function grade(legs) {
    var miss = legs.some(function (l) { return l.res === 'miss'; }), open = legs.some(function (l) { return !l.res; }), live = legs.filter(function (l) { return l.res !== 'push'; });
    var priced = live.every(function (l) { return okPrice(l.price); }), d = priced && live.length ? live.reduce(function (a, l) { return a * dec(l.price); }, 1) : null;
    var base = { left: live.length, reduced: live.length < legs.length, d: d };
    if (miss) return Object.assign(base, { res: 'miss', units: -1 });
    if (open) return Object.assign(base, { res: '', units: null });
    if (!live.length) return Object.assign(base, { res: 'push', units: 0 });
    return Object.assign(base, { res: 'hit', units: d === null ? null : d - 1 });
  }
  // payout of the full parlay before any result (decimal), or null when a price is missing
  function payout(prices) { return prices.length && prices.every(okPrice) ? prices.reduce(function (a, p) { return a * dec(p); }, 1) : null; }

  // ---------- Move the line? ----------
  // T = pics/linemove.json (scripts/linemove-data.js): T.by[s] = { n, band, k: { margin: games } } for a closing spread s (abs, half points):
  // of the n games whose closing spread was within `band` of s, how many ended with the closing favourite winning by exactly `margin` points.
  // pick: { line: points the pick gets (+3 = underdog +3, -3 = favourite -3), p: model chance to cover, price: American or null }
  // A pick'em (line 0) is treated as the side getting points against the other team as "favourite".
  function tableFor(T, s) { if (!T || !T.by) return null; var k = String(Math.min(Math.round(s * 2) / 2, T.maxS || 20)); return T.by[k] || null; }
  function qOf(row, m) { if (!row || !row.n) return 0; return (row.k[String(m)] || 0) / row.n; }
  // chances (win, push, loss) for the pick when its line is moved by `delta` points in its favour (+0.5 = buy half a point, -0.5 = sell)
  function shift(pick, delta, T) {
    var x = pick.line, s = Math.abs(x), row = tableFor(T, s), fav = x < 0, isInt = function (v) { return Math.abs(v - Math.round(v)) < 1e-9; };
    var q0 = isInt(s) ? qOf(row, s) : 0, W = pick.p * (1 - q0), t0 = s, t = fav ? s - delta : s + delta; // t = the threshold in "favourite wins by" points
    // underdog wins when the favourite's margin m < t; the favourite pick wins when m > t
    var lo = Math.min(t0, t), hi = Math.max(t0, t), mass = 0;
    for (var m = Math.ceil(lo - 1e-9); m <= Math.floor(hi + 1e-9); m++) {
      var inc = fav ? m > lo + 1e-9 && m <= hi + 1e-9 : m >= lo - 1e-9 && m < hi - 1e-9; // margins that change sides: underdog lo <= m < hi, favourite lo < m <= hi
      if (inc) mass += qOf(row, m);
    }
    var gain = (fav ? t < t0 : t > t0) ? 1 : -1; W = W + gain * mass;
    var P = isInt(t) ? qOf(row, t) : 0; W = Math.max(0, Math.min(1, W)); var L = Math.max(0, 1 - W - P);
    return { line: x + delta, w: W, p: P, l: L, n: row ? row.n : 0, band: row ? row.band : null };
  }
  // the price at which the moved line is EXACTLY as good as the line you have at your price (expected value per unit staked)
  function fair(base, moved, price) { var d0 = dec(price), ev0 = base.w * (d0 - 1) - base.l; if (moved.w <= 0) return null; var d1 = 1 + (ev0 + moved.l) / moved.w; return d1 > 1.0001 ? d1 : null; }
  // inside a parlay a leg is worth W*d + P (a push drops the leg and pays 1). The decimal price at which the moved leg leaves the parlay exactly as good:
  function parFair(base, moved, price) { var d0 = dec(price); if (moved.w <= 0) return null; var d1 = (base.w * d0 + base.p - moved.p) / moved.w; return d1 > 1.0001 ? d1 : null; }
  // the ladder shown in the sheet: buy 0.5 / 1 / 1.5, sell 0.5 / 1.
  // With a stored price: d / price = the price at which the moved line is as good as the current one (pd = the same inside a parlay).
  // WITHOUT a stored price (owner D7: never assume -110): nothing is compared; d / price = the moved line's own break-even price (expected value 0 at the model %),
  // base.be = the break-even price at the current line, and real = false so the sheet says "No price stored for this pick — compare with your book".
  function ladder(pick, T) {
    var real = okPrice(pick.price), px = real ? pick.price : null, base = shift(pick, 0, T), out = [], be = function (m) { return m.w > 0 && m.l >= 0 ? 1 + m.l / m.w : null; };
    base.be = be(base);
    [0.5, 1, 1.5, -0.5, -1].forEach(function (dl) {
      var mv = shift(pick, dl, T), d = real ? fair(base, mv, px) : be(mv), cents = d && d > 1.0001 ? amer(d) : null;
      var gainPts = (mv.w - base.w) * 100; // change in win chance, points of %
      out.push({ delta: dl, line: mv.line, w: mv.w, p: mv.p, l: mv.l, d: d, price: cents, gain: gainPts, n: mv.n, band: mv.band, pd: real ? parFair(base, mv, px) : null, be: !real });
    });
    return { base: base, px: px, real: real, rows: out };
  }
  // cents between two American prices along the usual ladder (-110 -> -120 = 10, +105 -> -105 = 10)
  function cents(a, b) { var f = function (x) { return x < 0 ? x + 100 : x - 100; }; return Math.round(Math.abs(f(a) - f(b))); }
  root.Parlay = { MIN: MIN, dec: dec, amer: amer, okPrice: okPrice, compose: compose, grade: grade, payout: payout, shift: shift, fair: fair, ladder: ladder, parFair: parFair, cents: cents, tableFor: tableFor };
  if (typeof module !== 'undefined') module.exports = root.Parlay;
})(typeof window !== 'undefined' ? window : globalThis);
