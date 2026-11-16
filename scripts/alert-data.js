// Refreshes the two static tables the Oddable Alert ships with, from nflverse games.csv (closing lines and final scores):
//   pics/trophy-season.json = closing line of every FINISHED 2026 regular-season game (key week-away-home, positive = home favored). Unplayed games are left out
//                             on purpose: a pre-game snapshot goes stale and must never be used as a closing line.
//   pics/alert-frozen.json  = Lock and division road dogs (line + model %) of the back-filled weeks already in the file, recomputed with the frozen model
//                             (pics/trophy.js), including the overtime flag. The Helper entries are kept as they are (they came from the app's ratings).
// Usage: node scripts/alert-data.js path/to/games.csv [--write]      (without --write it only prints what would change)
// games.csv: https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv
const fs = require('fs'), path = require('path'), P = path.join(__dirname, '..', 'pics');
const file = process.argv[2], WRITE = process.argv.includes('--write'), SEASON = 2026;
if (!file) { console.error('usage: node scripts/alert-data.js path/to/games.csv [--write]'); process.exit(1); }
const Trophy = require(path.join(P, 'trophy.js')); Trophy.init(JSON.parse(fs.readFileSync(path.join(P, 'trophy-model.json'))), JSON.parse(fs.readFileSync(path.join(P, 'trophy-hist.json'))));
const L = fs.readFileSync(file, 'utf8').trim().split('\n'), hd = L[0].trim().split(','), ix = (n) => hd.indexOf(n), r4 = (x) => Math.round(x * 1e4) / 1e4;
const utc = (d, t) => Date.parse(d + 'T' + (t || '13:00') + ':00Z') + (d < SEASON + '-11-01' ? 4 : 5) * 3600e3; // kickoff is US Eastern in the file (daylight time ends Nov 1 2026)
const gs = [], season = {};
L.slice(1).forEach((l) => {
  const c = l.split(','); if (+c[ix('season')] !== SEASON || c[ix('game_type')] !== 'REG') return;
  const wk = +c[ix('week')], a = c[ix('away_team')], h = c[ix('home_team')], done = c[ix('home_score')] !== '', sl = c[ix('spread_line')] === '' ? null : +c[ix('spread_line')];
  if (done && sl !== null) season[wk + '-' + a + '-' + h] = sl;
  gs.push({ id: c[ix('espn')] || wk + '-' + a + '-' + h, k: wk + '-' + a + '-' + h, week: wk, state: done ? 'post' : 'pre', start: utc(c[ix('gameday')], c[ix('gametime')]), line: sl, detail: done ? (c[ix('overtime')] === '1' ? 'Final/OT' : 'Final') : '', home: { abbr: h, score: done ? +c[ix('home_score')] : 0 }, away: { abbr: a, score: done ? +c[ix('away_score')] : 0 } });
});
const oldS = JSON.parse(fs.readFileSync(path.join(P, 'trophy-season.json'))), ks = new Set([...Object.keys(oldS), ...Object.keys(season)]); let n = 0;
ks.forEach((k) => { if (oldS[k] !== season[k]) { n++; console.log('trophy-season ' + k + ': ' + (oldS[k] === undefined ? '(none)' : oldS[k]) + ' -> ' + (season[k] === undefined ? '(removed: not played yet)' : season[k])); } });
console.log('trophy-season.json: ' + Object.keys(season).length + ' finished games, ' + n + ' change(s)');
const AF = JSON.parse(fs.readFileSync(path.join(P, 'alert-frozen.json'))), rows = Trophy.pool(gs, SEASON), W = Trophy.weekly(gs, SEASON); let m = 0;
const grade = (v) => (v === 0 ? 'push' : v > 0 ? 'W' : 'L'), rec = { lock: { W: 0, L: 0, push: 0 }, pick: { W: 0, L: 0, push: 0 }, not: { W: 0, L: 0, push: 0 }, alert: { W: 0, L: 0, push: 0 } };
Object.keys(AF.weeks).forEach((w) => {
  const wg = gs.filter((g) => g.week === +w); if (wg.some((g) => g.state !== 'post')) { console.log('week ' + w + ' is not finished in this games.csv: left as it is'); return; }
  const p = (W[w] || []).find((x) => x.rank === 2), s = AF.weeks[w], lock = p ? { k: p.g.k, side: p.abbr === p.g.home.abbr ? 'home' : 'away', line: p.line, conf: r4(p.conf), dog: !!p.dog } : null;
  const dogs = wg.filter((g) => g.line > 0 && Trophy.isDiv(g.away.abbr, g.home.abbr)).map((g) => { const c = Trophy.dogCover(g, rows, SEASON); return { k: g.k, line: g.line, p: c && c.p > 0 ? r4(c.p) : 0.5 }; });
  const show = (x) => JSON.stringify(x);
  if (show(lock) !== show(s.lock)) { m++; console.log('week ' + w + ' LOCK: ' + show(s.lock) + ' -> ' + show(lock)); }
  const od = {}; (s.dogs || []).forEach((d) => (od[d.k] = d)); dogs.forEach((d) => { if (show(od[d.k]) !== show(d)) { m++; console.log('week ' + w + ' dog ' + d.k + ': ' + show(od[d.k]) + ' -> ' + show(d) + (od[d.k] && (od[d.k].p >= 0.53) !== (d.p >= 0.53) ? '  *** PICKED STATUS CHANGES ***' : '')); } delete od[d.k]; });
  Object.keys(od).forEach((k) => { m++; console.log('week ' + w + ' dog ' + k + ' no longer listed'); });
  s.lock = lock; s.dogs = dogs;
  if (lock) { const g = wg.find((x) => x.k === lock.k), r = grade((lock.side === 'home' ? 1 : -1) * (g.home.score - g.away.score) + lock.line); rec.lock[r]++; rec.alert[r]++; }
  dogs.forEach((d) => { const g = wg.find((x) => x.k === d.k), r = grade(g.away.score - g.home.score + d.line), pk = d.p >= 0.53; rec[pk ? 'pick' : 'not'][r]++; if (pk && !(lock && lock.k === d.k)) rec.alert[r]++; });
});
const f = (r) => r.W + '-' + r.L + (r.push ? '-' + r.push : '');
console.log('alert-frozen.json: ' + m + ' change(s). Weeks ' + Object.keys(AF.weeks).join(',') + ' from this file: Lock ' + f(rec.lock) + ', Alert (Lock + picked dogs, a Lock that is also a dog counted once) ' + f(rec.alert) + ', dogs picked ' + f(rec.pick) + ', not picked ' + f(rec.not));
if (WRITE) { AF.made = new Date().toISOString().slice(0, 10); fs.writeFileSync(path.join(P, 'trophy-season.json'), JSON.stringify(season)); fs.writeFileSync(path.join(P, 'alert-frozen.json'), JSON.stringify(AF)); console.log('written'); } else console.log('dry run (add --write to save)');
