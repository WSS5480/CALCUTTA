// Logs the DraftKings spread for upcoming NFL games so the Pics app can chart line movement over time.
// Usage: node scripts/log-lines.js path/to/lines.json   (file is { "<eventId>": [[unixMs, homeFavoredPoints], ...] })
// Positive number = home team favored by that many points.
const fs = require('fs');
const BASE = process.env.ESPN_BASE || 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
const FIX = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
const fix = (a) => FIX[a] || a;

function parseLine(text, home, away) {
  if (!text) return null;
  if (/^(EVEN|PK|PICK)/i.test(text)) return 0;
  const m = /^([A-Z]{2,3})\s+(-?\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!m) return null;
  const fav = fix(m[1]), v = Math.abs(+m[2]);
  return fav === home ? v : fav === away ? -v : null;
}
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' -> ' + r.status); return r.json(); };

// Reads this week + next two weeks from ESPN and appends changed (or hourly) readings to db. Returns the count added.
async function logLines(db) {
  const first = await get(BASE + 'scoreboard');
  const cur = (first.week && first.week.number) || 1;
  const now = Date.now();
  let added = 0;
  for (let w = cur; w <= Math.min(18, cur + 2); w++) {
    let j;
    try { j = w === cur ? first : await get(BASE + 'scoreboard?week=' + w + '&seasontype=2'); } catch (e) { console.error(e.message); continue; }
    for (const e of j.events || []) {
      if (e.status.type.state === 'post') continue;
      const c = e.competitions[0];
      const home = c.competitors.find((x) => x.homeAway === 'home'), away = c.competitors.find((x) => x.homeAway === 'away');
      const o = c.odds && c.odds[0];
      if (!o || !home || !away) continue;
      const L = parseLine(o.details, fix(home.team.abbreviation), fix(away.team.abbreviation));
      if (L === null) continue;
      const a = (db[e.id] = db[e.id] || []);
      const last = a[a.length - 1];
      if (!last || last[1] !== L || now - last[0] > 60 * 60 * 1000) { a.push([now, L]); added++; }
    }
  }
  return added;
}

module.exports = { logLines };

if (require.main === module) {
  const file = process.argv[2];
  (async () => {
    let db = {};
    try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    const added = await logLines(db);
    fs.writeFileSync(file, JSON.stringify(db));
    console.log('readings added:', added, 'games tracked:', Object.keys(db).length);
  })().catch((e) => { console.error(e); process.exit(1); });
}
