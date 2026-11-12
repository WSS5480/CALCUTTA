// Real moneylines from the odds server (The Odds API, budgeted). Fills g.mlH / g.mlA and g.mlBook; anything missing stays "estimated".
(function () {
  const API = 'https://calcutta-odds.onrender.com/oddsline?lg=';
  const IDX = {}; let LG = null;
  const nn = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const nick = (s) => nn(s).split(' ').pop();
  const nm = (t) => (t && (t.full || t.name || t.displayName)) || '';
  function index(games) { Object.keys(IDX).forEach((k) => delete IDX[k]); (games || []).forEach((o) => { if (o.mlH == null || o.mlA == null) return; IDX[nn(o.home) + '|' + nn(o.away)] = o; IDX[nick(o.home) + '|' + nick(o.away)] = o; }); }
  function find(g) { const h = nm(g.home), a = nm(g.away); if (!h || !a) return null; return IDX[nn(h) + '|' + nn(a)] || IDX[nick(h) + '|' + nick(a)] || null; }
  window.oddsML = function (g) { const o = find(g); return o ? { h: o.mlH, a: o.mlA, book: o.mlBook, bestH: o.bestH, bestA: o.bestA } : null; };
  window.oddsFill = function (g) { try { const o = find(g); if (o && g.state !== 'post') { g.mlH = o.mlH; g.mlA = o.mlA; g.mlBook = o.mlBook; } } catch (e) {} return g; };
  window.oddsRefresh = async function (lg, cb) {
    LG = lg; let c = null; try { c = JSON.parse(localStorage.getItem('odl-' + lg)); } catch (e) {}
    if (c && Date.now() - c.t < 20 * 60e3) { index(c.games); if (cb) cb(); return; }
    if (c) index(c.games);
    try { const r = await fetch(API + lg), j = await r.json(); if (j && Array.isArray(j.games)) { if (j.games.length || !c) { try { localStorage.setItem('odl-' + lg, JSON.stringify({ t: Date.now(), games: j.games })); } catch (e) {} index(j.games.length ? j.games : (c ? c.games : [])); } if (cb) cb(); } } catch (e) {}
  };
})();
