// Run: node odds-api/teamlist.test.js  (no network)
const assert = require('assert'), http = require('http'), T = require('./teamlist');
let n = 0, calls = 0, down = false, NOW = 1e12; const eq = (a, b, m) => { n++; assert.deepStrictEqual(a, b, m); };
T._deps.now = () => NOW;
T._deps.fetch = async (u) => { calls++; if (down) return { ok: false, status: 503, json: async () => ({}) }; assert(/site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/nfl\/teams\?limit=1000$/.test(u) || /college-football\/teams\?limit=1000&groups=80$/.test(u), u);
  return { ok: true, json: async () => ({ sports: [{ leagues: [{ teams: [{ team: { id: '28', abbreviation: 'WSH', displayName: 'Washington Commanders', logos: [{ href: 'https://a.espncdn.com/x.png' }] } }, { team: { id: '6', abbreviation: 'DAL', displayName: 'Dallas Cowboys', logos: [{ href: 'https://evil.test/x.png' }] } }, { team: { id: 'x', abbreviation: 'BAD' } }, { team: { id: '9', abbreviation: '<b>', displayName: 'Old', isActive: false } }] }] }] }) }; };
const srv = http.createServer(async (q, s) => { if (!(await T.handle(q, s))) { s.statusCode = 404; s.end('{}'); } });
srv.listen(0, async () => { const get = async (p) => { const r = await fetch('http://127.0.0.1:' + srv.address().port + p); return { s: r.status, j: await r.json() }; };
  try {
    let r = await get('/teams?lg=nfl'); eq(r.s, 200); eq(r.j.teams, [{ id: '6', abbr: 'DAL', name: 'Dallas Cowboys', logo: '' }, { id: '28', abbr: 'WAS', name: 'Washington Commanders', logo: 'https://a.espncdn.com/x.png' }]);
    await get('/teams?lg=nfl'); eq(calls, 1, 'cached'); NOW += 864e5 + 1; down = true; r = await get('/teams?lg=nfl'); eq([r.s, r.j.teams.length], [200, 2], 'old copy when ESPN is down');
    r = await get('/teams?lg=cfb'); eq(r.s, 502); down = false; r = await get('/teams?lg=cfb'); eq(r.s, 200);
    r = await get('/teams?lg=xfl'); eq(r.s, 400); r = await get('/teamsx'); eq(r.s, 404);
    console.log('teamlist.test.js: ' + n + ' checks passed');
  } catch (e) { console.error('FAILED', e); process.exitCode = 1; } srv.close(); });
