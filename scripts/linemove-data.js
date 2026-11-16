// Builds pics/linemove.json for the "Move the line?" sheet (v253): how often an NFL game lands EXACTLY on each final margin, for games with a similar closing spread.
// That is what a half point is worth: moving a pick's line ONTO a whole number turns those games from losses into pushes, moving OFF it turns pushes into wins
// (and the reverse when points are sold). The same counts serve both sides: an underdog buying +2.5 -> +3 and a favourite buying -3.5 -> -3 both gain the games
// the favourite won by exactly 3.
// Source: nflverse games.csv (https://github.com/nflverse/nfldata/raw/master/data/games.csv), REGULAR SEASON ONLY, seasons FROM..TO below, games with a final score
// and a closing spread_line. Margin = points the closing FAVOURITE won by (negative = the underdog won; 0 = tie). A pick'em game has no favourite: the home team stands in.
// by[s] (s = 0, 0.5, ... MAXS, the pick's spread without its sign): the n games whose closing spread was within `band` points of s (band starts at BAND and is widened
// a point at a time, up to BAND + 3, until n >= MIN_N), and k[m] = how many of them ended with the favourite winning by exactly m, for every whole m within 2 points of s
// (enough for buying 1.5 or selling 1). Counts only: no smoothing, no opinion.
// half[k] = the worst price at which buying the half point OFF k (pushes become wins) is as good as the same 50/50 bet at -110 on k: the yardstick of the v216 key-number
// table (2006-2025: 3 -131, 7 -125, 6 -119, 10 -120, else about -116). The app now shows these 2014-2025 numbers instead (decision v253).
// Usage: node scripts/linemove-data.js path/to/games.csv [--write]     (without --write it prints the table only)
const fs = require('fs'), path = require('path');
const file = process.argv[2], WRITE = process.argv.includes('--write'), FROM = 2014, TO = 2025, BAND = 1, MIN_N = 150, MAXS = 20;
if (!file) { console.error('usage: node scripts/linemove-data.js path/to/games.csv [--write]'); process.exit(1); }
const L = fs.readFileSync(file, 'utf8').trim().split('\n'), hd = L[0].trim().split(','), ix = (n) => hd.indexOf(n), need = ['season', 'game_type', 'result', 'spread_line', 'home_score'].map(ix);
if (need.some((x) => x < 0)) { console.error('unexpected columns in ' + file); process.exit(1); }
const G = [], bySeason = {};
// nflverse: result = home score - away score; spread_line > 0 = home favoured by that many. Favourite's margin = result when the home team is favoured (or pick'em), else -result.
L.slice(1).forEach((l) => { const c = l.split(','), s = +c[need[0]]; if (s < FROM || s > TO || c[need[1]] !== 'REG' || c[need[4]] === '' || c[need[3]] === '' || c[need[2]] === '') return; const sl = +c[need[3]], r = +c[need[2]]; if (!Number.isFinite(sl) || !Number.isFinite(r)) return; G.push({ s: Math.abs(sl), m: sl < 0 ? -r : r }); bySeason[s] = (bySeason[s] || 0) + 1; });
const by = {};
for (let s = 0; s <= MAXS; s += 0.5) {
  let b = BAND, q; for (;;) { q = G.filter((g) => Math.abs(g.s - s) <= b + 1e-9); if (q.length >= MIN_N || b >= BAND + 3) break; b += 1; }
  const k = {}; for (let m = Math.ceil(s - 2); m <= Math.floor(s + 2); m++) k[m] = q.filter((g) => g.m === m).length;
  by[s] = { n: q.length, band: b, k };
}
const amer = (d) => (d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1))), worth = (q) => { const w0 = 0.5 * (1 - q), ev0 = w0 * (100 / 110) - w0, w1 = w0 + q; return amer(1 + (ev0 + w0) / w1); };
const half = {}; [3, 7, 6, 10, 4, 14].forEach((k) => (half[k] = worth(by[k].k[k] / by[k].n)));
const other = [1, 2, 5, 8, 9, 11, 12, 13]; half.other = worth(other.reduce((a, k) => a + by[k].k[k], 0) / other.reduce((a, k) => a + by[k].n, 0));
const out = { source: 'nflverse games.csv (github.com/nflverse/nfldata), regular season, closing spread_line and final score', seasons: FROM + '-' + TO, games: G.length, perSeason: bySeason, made: new Date().toISOString().slice(0, 10), maxS: MAXS,
  note: 'by[s]: of the n games whose closing spread was within band points of s, k[m] ended with the closing favourite winning by exactly m (m < 0 = underdog won by -m, 0 = tie). half[k]: worst price at which buying the half point off k equals the same 50/50 bet at -110 on k; half.other pools 1, 2, 5, 8, 9, 11, 12, 13.', by, half };
console.log(out.source + ' · ' + out.seasons + ' · ' + out.games + ' games'); console.log('per season: ' + JSON.stringify(bySeason));
[1, 1.5, 2.5, 3, 3.5, 6, 6.5, 7, 7.5, 10, 13.5, 14].forEach((s) => { const r = by[s]; console.log(('spread ' + s).padEnd(12) + ' n ' + String(r.n).padStart(4) + ' (±' + r.band + ')  ' + Object.keys(r.k).map(Number).sort((a, b) => a - b).map((m) => m + ':' + (r.k[m] / r.n * 100).toFixed(1) + '%').join('  ')); });
console.log('half point off the number, worth up to: ' + JSON.stringify(half) + '   (v216 table, 2006-2025: 3 -131, 7 -125, 6 -119, 10 -120, else about -116)');
if (WRITE) { fs.writeFileSync(path.join(__dirname, '..', 'pics', 'linemove.json'), JSON.stringify(out)); console.log('written pics/linemove.json'); } else console.log('dry run (add --write to save)');
