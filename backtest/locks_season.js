// Walk-forward replay of a season's weekly Double lock / Lock with the app's own pics/trophy.js (frozen model, only games before each week's first kickoff).
// Usage: node backtest/locks_season.js /path/to/nflverse/games.csv   (games.csv from github.com/nflverse/nfldata, data/games.csv)
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..', 'pics') + '/';
const Trophy = require(R + 'trophy.js');
Trophy.init(JSON.parse(fs.readFileSync(R + 'trophy-model.json')), JSON.parse(fs.readFileSync(R + 'trophy-hist.json')));
const lines = fs.readFileSync(process.argv[2] || '/tmp/nv/games.csv', 'utf8').trim().split('\n');
const hd = lines[0].split(','); const ix = (k) => hd.indexOf(k);
function parseCsv(l) { const out = []; let cur = '', q = false; for (const c of l) { if (c === '"') q = !q; else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }
// ET kickoff -> ms (EDT before Nov 1 2026, EST after)
function etMs(day, time) { const off = day < '2026-11-01' ? '-04:00' : '-05:00'; return Date.parse(day + 'T' + (time || '13:00') + ':00' + off); }
const all = lines.slice(1).map(parseCsv).filter((r) => r[ix('season')] === (process.argv[3] || '2026') && r[ix('game_type')] === 'REG').map((r) => {
  const hs = r[ix('home_score')], as = r[ix('away_score')], L = r[ix('spread_line')];
  return { id: r[ix('espn')], week: +r[ix('week')], start: etMs(r[ix('gameday')], r[ix('gametime')]), state: hs === '' ? 'pre' : 'post', detail: r[ix('overtime')] === '1' ? 'Final/OT' : 'Final',
    home: { abbr: r[ix('home_team')], score: hs === '' ? 0 : +hs }, away: { abbr: r[ix('away_team')], score: as === '' ? 0 : +as }, line: L === '' ? null : +L };
});
const maxWk = Math.max(...all.filter((g) => g.state === 'post').map((g) => g.week));
const out = [];
for (let wk = 1; wk <= maxWk; wk++) {
  // what the app would know just before this week's first kickoff: finished games before it, this week's games all 'pre'
  const first = Math.min(...all.filter((g) => g.week === wk).map((g) => g.start));
  const view = all.filter((g) => g.week <= wk).map((g) => (g.week === wk || g.start >= first) ? { ...g, state: 'pre', home: { ...g.home, score: 0 }, away: { ...g.away, score: 0 }, detail: '' } : g);
  const W = Trophy.weekly(view, +(process.argv[3] || 2026))[wk] || [];
  W.forEach((p) => {
    const g = all.find((x) => x.id === p.id); const mine = g.home.abbr === p.abbr ? g.home : g.away, oth = mine === g.home ? g.away : g.home;
    const m = mine.score - oth.score, c = m + p.line;
    out.push({ wk, rank: p.rank, pick: p.abbr, line: p.line, conf: +p.conf.toFixed(3), game: g.away.abbr + '@' + g.home.abbr, score: g.away.score + '-' + g.home.score, done: g.state === 'post',
      ats: g.state !== 'post' ? null : c === 0 ? 'P' : c > 0 ? 'W' : 'L', su: g.state !== 'post' ? null : m === 0 ? 'T' : m > 0 ? 'W' : 'L', dog: p.dog, id: p.id });
  });
}
// sanity: same game twice in one week?
const dup = {}; out.forEach((r) => { const k = r.wk + ':' + r.id; dup[k] = (dup[k] || 0) + 1; });
console.log('duplicates in a week:', Object.entries(dup).filter(([k, v]) => v > 1));
console.log(JSON.stringify(out));
