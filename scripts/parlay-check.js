// Reproduces the Oddable Alert parlay results for the back-filled 2026 weeks 1-9 and FAILS (exit 1) if any differs from the numbers given to the owner on Nov 15 2026.
// Picks + legs + closing prices: pics/alert-frozen.json (written by scripts/alert-data.js). Final scores: nflverse games.csv (pass its path).
// Composition and grading: pics/parlay.js (the same code the server and the app use). Prices = nflverse closing spread prices of the picked side.
// Usage: node scripts/parlay-check.js path/to/games.csv
const fs = require('fs'), path = require('path'), P = path.join(__dirname, '..', 'pics'), Parlay = require(path.join(P, 'parlay.js'));
const file = process.argv[2]; if (!file) { console.error('usage: node scripts/parlay-check.js path/to/games.csv'); process.exit(1); }
const L = fs.readFileSync(file, 'utf8').trim().split('\n'), hd = L[0].trim().split(','), ix = (n) => hd.indexOf(n), G = {};
L.slice(1).forEach((l) => { const c = l.split(','); if (c[ix('season')] !== '2026' || c[ix('game_type')] !== 'REG' || c[ix('home_score')] === '') return; G[c[ix('week')] + '-' + c[ix('away_team')] + '-' + c[ix('home_team')]] = { hs: +c[ix('home_score')], as: +c[ix('away_score')], o: [+c[ix('away_spread_odds')], +c[ix('home_spread_odds')]] }; });
const AF = JSON.parse(fs.readFileSync(path.join(P, 'alert-frozen.json'))), cls = (v) => (v === 0 ? 'push' : v > 0 ? 'hit' : 'miss');
const EXPECT = {
  two: { rec: '4-4', units: 6.5, none: [7], wk: { 1: ['ARI/SF', 'hit', 2.87], 2: ['ATL/MIN', 'miss'], 3: ['WAS/ARI', 'hit', 2.57], 4: ['DAL/NE', 'hit', 2.57], 5: ['BUF/NYG', 'hit', 2.5], 6: ['DAL/ARI', 'miss'], 8: ['KC/ATL', 'miss'], 9: ['TB/ARI', 'miss'] }, straight: [5.03, 16] },
  three: { rec: '3-4', units: 13.67, none: [3, 9], wk: { 1: ['ARI/SF/DEN', 'miss'], 2: ['ATL/MIN/WAS', 'miss'], 4: ['DAL/NE/ATL', 'hit', 5.54], 5: ['BUF/NYG/SF', 'hit', 5.67], 6: ['DAL/ARI/NYJ', 'miss'], 7: ['DAL/TB/MIA', 'hit', 6.45], 8: ['KC/ATL/PHI', 'miss'] }, straight: [5.77, 21] },
};
let bad = 0; const fail = (m) => { bad++; console.log('  MISMATCH: ' + m); };
['two', 'three'].forEach((kind) => {
  const E = EXPECT[kind]; let w = 0, l = 0, u = 0, su = 0, sn = 0; const none = [];
  console.log((kind === 'two' ? '2-game' : '3-game') + ' parlay, 2026 weeks 1-9 (pics/alert-frozen.json legs, nflverse closing prices and scores):');
  Object.keys(AF.weeks).map(Number).sort((a, b) => a - b).forEach((wk) => {
    const s = AF.weeks[wk], ks = s.parlays && s.parlays[kind]; if (!ks) { none.push(wk); console.log('  week ' + wk + ': no parlay'); return; }
    const legs = ks.map((k, i) => {
      const g = G[k]; if (!g) throw new Error('no final score for ' + k);
      if (i === 0) { const lk = s.lock; if (lk.k !== k) throw new Error('first leg is not the Lock'); const sideHome = lk.side === 'home', v = (sideHome ? 1 : -1) * (g.hs - g.as) + lk.line; if (lk.o !== g.o[sideHome ? 1 : 0]) fail('week ' + wk + ' Lock price ' + lk.o + ' vs games.csv ' + g.o[sideHome ? 1 : 0]); return { team: k.split('-')[sideHome ? 2 : 1], res: cls(v), price: lk.o }; }
      const d = s.dogs.find((x) => x.k === k), v = g.as - g.hs + d.line; if (d.o !== g.o[0]) fail('week ' + wk + ' dog price ' + d.o + ' vs games.csv ' + g.o[0]); return { team: k.split('-')[1], res: cls(v), price: d.o };
    });
    const r = Parlay.grade(legs), name = legs.map((x) => x.team).join('/'), e = E.wk[wk];
    legs.forEach((x) => { if (x.res === 'push') return; sn++; su += x.res === 'hit' ? Parlay.dec(x.price) - 1 : -1; });
    if (r.res === 'hit') w++; else if (r.res === 'miss') l++; u += r.units || 0;
    console.log('  week ' + wk + ': ' + name + ' ' + legs.map((x) => x.res + '@' + x.price).join(' ') + ' -> ' + (r.res === 'hit' ? 'WON ' : r.res === 'miss' ? 'LOST ' : r.res.toUpperCase() + ' ') + (r.units >= 0 ? '+' : '') + r.units.toFixed(2) + 'u' + (r.reduced ? ' (reduced to ' + r.left + ' legs)' : ''));
    if (!e) fail('week ' + wk + ' has a parlay, expected none'); else { if (e[0] !== name) fail('week ' + wk + ' legs ' + name + ' expected ' + e[0]); if (e[1] !== r.res) fail('week ' + wk + ' result ' + r.res + ' expected ' + e[1]); if (e[2] !== undefined && Math.abs(e[2] - r.units) > 0.005) fail('week ' + wk + ' units ' + r.units.toFixed(2) + ' expected ' + e[2]); }
  });
  console.log('  total ' + w + '-' + l + ', ' + (u >= 0 ? '+' : '') + u.toFixed(2) + ' units; no parlay week(s) ' + none.join(', ') + '; same legs bet straight ' + (su >= 0 ? '+' : '') + su.toFixed(2) + 'u on ' + sn + ' bets');
  if (w + '-' + l !== E.rec) fail('record ' + w + '-' + l + ' expected ' + E.rec); if (Math.abs(u - E.units) > 0.005) fail('units ' + u.toFixed(2) + ' expected ' + E.units); if (none.join() !== E.none.join()) fail('no-bet weeks ' + none + ' expected ' + E.none);
  if (Math.abs(su - E.straight[0]) > 0.005 || sn !== E.straight[1]) fail('straight ' + su.toFixed(2) + ' on ' + sn + ' expected ' + E.straight[0] + ' on ' + E.straight[1]);
});
console.log(bad ? bad + ' mismatch(es)' : 'parlay-check: all results reproduced'); process.exitCode = bad ? 1 : 0;
