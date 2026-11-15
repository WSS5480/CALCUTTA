/* Oddable trophy picks: frozen factor model (trained 2004-2025, never retrained in-season). Pure functions, no DOM.
   #1 pick of the week = double trophy, #2 = single trophy. Pick = the side the model gives the best chance to COVER the spread. */
(function (root) {
  var M = null, H = null, DIV = null;
  var CONF = { BUF: 1, MIA: 1, NE: 1, NYJ: 1, BAL: 1, CIN: 1, CLE: 1, PIT: 1, HOU: 1, IND: 1, JAX: 1, TEN: 1, DEN: 1, KC: 1, LV: 1, LAC: 1 };
  var FIXT = { LAR: 'LA', WSH: 'WAS', JAC: 'JAX', OAK: 'LV', SD: 'LAC', STL: 'LA' };
  var T = function (a) { return FIXT[a] || a; };
  function init(model, hist) { M = model; H = hist.map(function (r) { return { season: r[0], week: r[1], home: r[2], away: r[3], hs: r[4], as: r[5], L: r[6], ot: r[7], t: Date.parse(r[8] + 'T17:00:00Z') }; }); DIV = {}; model.div.forEach(function (k) { DIV[k] = 1; }); }
  function ready() { return !!M; }
  // every finished game we know about, as plain rows: {season,week,home,away,hs,as,L,ot,t}
  function pool(cur, season) {
    var rows = H.slice();
    cur.forEach(function (g) { if (g.state === 'post' && g.line !== null && g.line !== undefined) rows.push({ season: season, week: g.week, home: T(g.home.abbr), away: T(g.away.abbr), hs: g.home.score, as: g.away.score, L: g.line, ot: /OT/.test(g.detail || '') ? 1 : 0, t: g.start, id: g.id }); });
    return rows.sort(function (a, b) { return a.t - b.t; });
  }
  function teamHist(rows, team, before, id) { return rows.filter(function (r) { return (r.home === team || r.away === team) && (r.t < before) && r.id !== id; }).map(function (r) { var h = r.home === team; return { season: r.season, week: r.week, margin: h ? r.hs - r.as : r.as - r.hs, spr: h ? r.L : -r.L, ot: r.ot, t: r.t, opp: h ? r.away : r.home, home: r.home, L: r.L, hs: r.hs, as: r.as }; }); }
  function side(rows, team, g, season, week) {
    var Hh = teamHist(rows, team, g.start, g.id), cur = Hh.filter(function (x) { return x.season === season; }), last = Hh[Hh.length - 1], d = {};
    d.prev_margin = last ? last.margin : 0; d.prev_close_loss = +(!!last && last.margin >= -3 && last.margin < 0); d.prev_ot_loss = +(!!last && !!last.ot && last.margin <= 0);
    d.prev_blowout_loss = +(!!last && last.margin <= -14); d.prev_lost_as_fav = +(!!last && last.spr > 0 && last.margin < 0); d.prev_big_win = +(!!last && last.margin >= 14);
    d.prev_cover_margin = last ? last.margin + last.spr : 0;
    var l3 = Hh.slice(-3); d.ats3 = l3.length ? l3.filter(function (x) { return x.margin + x.spr > 0; }).length / l3.length : 0.5;
    d.rest = last && last.season === season ? Math.round((g.start - last.t) / 864e5) : 7; d.short = +(d.rest <= 5); d.bye = +(d.rest >= 10);
    var w = cur.filter(function (x) { return x.margin > 0; }).length, l = cur.filter(function (x) { return x.margin < 0; }).length, n = cur.length;
    d.winpct = n ? (w + 0.5 * (n - w - l)) / n : 0.5; d.gp = n;
    d.late_bubble = +(week >= 12 && d.winpct >= 0.4 && d.winpct <= 0.7); d.late_dead = +(week >= 12 && d.winpct < 0.3); d.late_contender = +(week >= 12 && d.winpct >= 0.7);
    d.recent_loss_streak = +(Hh.length >= 2 && Hh[Hh.length - 1].margin < 0 && Hh[Hh.length - 2].margin < 0);
    return d;
  }
  // chance the market underdog covers, plus the pieces needed to read it
  function dogCover(g, rows, season) {
    if (g.line === null || g.line === undefined || g.line === 0) return null;
    var home = T(g.home.abbr), away = T(g.away.abbr), dogHome = g.line < 0 ? 1 : 0, dog = dogHome ? home : away, fav = dogHome ? away : home;
    var sd = side(rows, dog, g, season, g.week), sf = side(rows, fav, g, season, g.week);
    var hm = rows.filter(function (r) { return r.t < g.start && r.id !== g.id && season - r.season <= 6 && ((r.home === home && r.away === away) || (r.home === away && r.away === home)); }).slice(-3).map(function (r) { var dh = r.home === dog; return [dh ? r.hs - r.as : r.as - r.hs, dh ? r.L : -r.L]; });
    var cf = (CONF[home] ? 1 : 0) === (CONF[away] ? 1 : 0) ? 1 : 0, dv = DIV[[home, away].sort().join('-')] ? 1 : 0;
    var f = { h2h_n: hm.length, h2h_cover: hm.length ? hm.filter(function (x) { return x[0] + x[1] > 0; }).length / hm.length : 0.5, h2h_lastlost: +(hm.length > 0 && hm[hm.length - 1][0] < 0), h2h_avgmargin: hm.length ? hm.reduce(function (a, x) { return a + x[0]; }, 0) / hm.length : 0, div: dv, conf: cf, dog_home: dogHome, sp: Math.abs(g.line), f_dead: sf.late_dead };
    Object.keys(sd).forEach(function (k) { f['d_' + k] = sd[k]; }); Object.keys(sf).forEach(function (k) { f['f_' + k] = sf[k]; });
    f.both_bubble = +(sd.late_bubble && sf.late_bubble); f.dog_dontdie = +(sd.late_bubble && g.week >= 13 && cf);
    var z = M.b; for (var i = 0; i < M.cols.length; i++) z += M.coef[i] * (((f[M.cols[i]] || 0) - M.mean[i]) / M.scale[i]);
    return { p: 1 / (1 + Math.exp(-z)), dog: dogHome ? g.home : g.away, fav: dogHome ? g.away : g.home, dogHome: dogHome, f: f };
  }
  // one pick per game: the side more likely to cover, with its chance
  function pickOf(g, rows, season) {
    var c = dogCover(g, rows, season); if (!c) return null; var onDog = c.p >= 0.5, pick = onDog ? c.dog : c.fav, line = onDog ? Math.abs(g.line) : -Math.abs(g.line);
    var hit = null; if (g.state === 'post') { var mg = g.home.score - g.away.score, dm = c.dogHome ? mg : -mg, v = dm + Math.abs(g.line); hit = v === 0 ? 'push' : (v > 0) === onDog ? 'hit' : 'miss'; }
    return { id: g.id, week: g.week, abbr: pick.abbr, other: (onDog ? c.fav : c.dog).abbr, line: line, conf: onDog ? c.p : 1 - c.p, dog: onDog, away: !((c.dogHome ? onDog : !onDog)), hit: hit, g: g };
  }
  // all weeks: rank #1 / #2 by model chance among games with a line
  function weekly(cur, season) {
    if (!M) return {};
    var rows = pool(cur, season), by = {};
    cur.forEach(function (g) { if (g.state === 'canceled') return; var p = pickOf(g, rows, season); if (p) (by[g.week] = by[g.week] || []).push(p); });
    Object.keys(by).forEach(function (k) { by[k].sort(function (a, b) { return b.conf - a.conf; }); by[k].forEach(function (p, i) { p.rank = i + 1; }); by[k] = by[k].slice(0, 2); });
    return by;
  }
  root.Trophy = { init: init, ready: ready, weekly: weekly, pickOf: pickOf, pool: pool, dogCover: dogCover };
  if (typeof module !== 'undefined') module.exports = root.Trophy;
})(typeof window !== 'undefined' ? window : globalThis);
