// TEST PREVIEW ONLY: believable demo data, written through the real engine routes (so the screens show what the engines really answer).
// Past dates are made by moving each engine's clock (its _deps.now) while seeding, then putting the real clock back.
// Demo NFL games use made-up ids (pv101...) served by a small fake scoreboard merged into ESPN's answer, so the server can grade them with no live game needed.
const GR = require('./grade');
const HOUR = 3600e3, DAY = 864e5;
const chiDay = GR.chiDay, ymd = (ms) => chiDay(ms).replace(/-/g, '');
// the last finished Sunday and the next Sunday, from the real clock (noon CT kickoffs)
function sundays(now) {
  let d = now - DAY; while (new Date(chiDay(d) + 'T12:00:00Z').getUTCDay() !== 0) d -= DAY;
  let n = now + DAY; while (new Date(chiDay(n) + 'T12:00:00Z').getUTCDay() !== 0) n += DAY;
  const noon = (ms) => Date.parse(chiDay(ms) + 'T18:00:00Z');
  return { last: noon(d), next: noon(n) };
}
const T = (abbr, name, short, loc) => ({ abbr, name, short, loc });
const TEAMS = { DAL: T('DAL', 'Dallas Cowboys', 'Cowboys', 'Dallas'), NYG: T('NYG', 'New York Giants', 'Giants', 'New York'), KC: T('KC', 'Kansas City Chiefs', 'Chiefs', 'Kansas City'), BUF: T('BUF', 'Buffalo Bills', 'Bills', 'Buffalo'),
  SF: T('SF', 'San Francisco 49ers', '49ers', 'San Francisco'), LAR: T('LAR', 'Los Angeles Rams', 'Rams', 'Los Angeles'), GB: T('GB', 'Green Bay Packers', 'Packers', 'Green Bay'), CHI: T('CHI', 'Chicago Bears', 'Bears', 'Chicago'),
  HOU: T('HOU', 'Houston Texans', 'Texans', 'Houston'), TEN: T('TEN', 'Tennessee Titans', 'Titans', 'Tennessee'), PHI: T('PHI', 'Philadelphia Eagles', 'Eagles', 'Philadelphia'), BAL: T('BAL', 'Baltimore Ravens', 'Ravens', 'Baltimore'), PIT: T('PIT', 'Pittsburgh Steelers', 'Steelers', 'Pittsburgh') };
let GAMES = [];
function demoGames(now) {
  const { last, next } = sundays(now), g = (id, start, a, h, as, hs) => ({ lg: 'nfl', id, start, away: TEAMS[a], home: TEAMS[h], as, hs });
  GAMES = [g('pv101', last, 'DAL', 'NYG', 20, 24), g('pv102', last, 'HOU', 'TEN', 27, 17), g('pv103', last + 3.4 * HOUR, 'KC', 'BUF', 24, 27), g('pv104', last + 3.4 * HOUR, 'SF', 'LAR', 24, 20), g('pv105', last + 7.3 * HOUR, 'GB', 'CHI', 14, 21),
    g('pv201', next, 'PHI', 'DAL', 0, 0), g('pv202', next + 3.4 * HOUR, 'BAL', 'PIT', 0, 0), g('pv203', next + 7.3 * HOUR, 'KC', 'HOU', 0, 0)];
  return { last, next };
}
// ESPN-shaped scoreboard events for the demo games on one day
function demoEvents(lgPath, dates, now) {
  if (lgPath !== 'football/nfl') return [];
  return GAMES.filter((g) => ymd(g.start) === dates).map((g) => { const st = now < g.start ? 'pre' : now < g.start + 3.5 * HOUR ? 'in' : 'post', tm = (t) => ({ abbreviation: t.abbr, displayName: t.name, shortDisplayName: t.short, location: t.loc });
    return { id: g.id, date: new Date(g.start).toISOString(), name: g.away.name + ' at ' + g.home.name, shortName: g.away.abbr + ' @ ' + g.home.abbr, status: { type: { state: st, completed: st === 'post', name: st === 'post' ? 'STATUS_FINAL' : st === 'in' ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED' } },
      competitions: [{ competitors: [{ homeAway: 'home', score: st === 'pre' ? '0' : String(g.hs), team: tm(g.home) }, { homeAway: 'away', score: st === 'pre' ? '0' : String(g.as), team: tm(g.away) }] }] }; });
}
// fetch for the bet-grading engines: ESPN's real answer (when reachable) plus the demo games of that day
function wrapFetch(real, nowFn, live) {
  return async (u, o) => {
    const m = /sports\/(.+)\/scoreboard\?(?:.*&)?dates=(\d{8})/.exec(String(u)); if (!m) return real(u, o);
    const extra = demoEvents(m[1], m[2], nowFn()); let j = { events: [] };
    if (live()) { try { const r = await real(u, o); if (r.ok) j = await r.json(); else if (!extra.length) return r; } catch (e) { if (!extra.length) throw e; } }
    j.events = (j.events || []).concat(extra); return { ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) };
  };
}

async function run(X) {
  const { step, ok, byRole, STATE, S } = X, REAL = Date.now(); let NOW = REAL, LIVE = false;
  const mods = {}; ['groups', 'calcutta', 'golf', 'events', 'stats', 'limits'].forEach((m) => { try { mods[m] = require('./' + m); } catch (e) { console.error('preview: engine ' + m + ' missing:', e.message); } });
  const setNow = (t) => { NOW = t; }; const clock = () => NOW;
  const reset = () => Object.values(mods).forEach((M) => { try { if (M._reset) M._reset(); } catch (e) {} });
  Object.values(mods).forEach((M) => { if (M._deps && typeof M._deps.now === 'function') M._deps.now = clock; });
  const { last, next } = demoGames(REAL);
  const GD = mods.groups._deps, realFetch = GD.fetch; GD.fetch = wrapFetch(realFetch, clock, () => LIVE);
  const C = { X, mods, setNow, clock, reset, last, next, REAL, HOUR, DAY, chiDay, GAMES, ids: STATE.ids, row: async (role, fn) => { const u = byRole(role), r = await S.dbGet(u.id); fn(r.data); await S.dbPut({ id: u.id, data: r.data, updated: NOW }); } };
  require('./preview-glue').wire(C); // shared contracts: limits, stats providers, handicap / rating
  for (const part of ['groups', 'calcutta', 'golf', 'events', 'stats']) {
    let P; try { P = require('./preview-seed-' + part); } catch (e) { if (e.code === 'MODULE_NOT_FOUND' && /preview-seed-/.test(e.message)) { STATE.steps.push({ name: part + ' demo data', ok: false, err: 'not built yet' }); continue; } throw e; }
    await step(part + ' demo data', () => P.seed(C)); reset();
  }
  NOW = REAL; LIVE = true; Object.values(mods).forEach((M) => { if (M._deps && typeof M._deps.now === 'function') M._deps.now = () => Date.now(); }); reset();
}
module.exports = { run, sundays };
