// Run: node odds-api/wx.test.js   (no network: ESPN, api.weather.gov and Supabase are in-memory fakes)
// v301 GET /wx/nfl: NWS parsing, roofs (dome / retractable / neutral / ESPN indoor), 60-minute cache per stadium, failure = "na" (never a guess),
// forecast past its end = "later", stored forecasts only from before kickoff, the route itself.
const assert = require('assert'), http = require('http'), W = require('./wx');
let n = 0; const t = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
// ---- pure parsing ----
eq(W.parseWind('12 mph'), 12, '12 mph');
eq(W.parseWind('5 to 10 mph'), 5, 'range = lower end');
eq(W.parseWind('9 mph'), 9, '9 mph');
t(Math.abs(W.parseWind('16 km/h') - 9.94) < 0.01, 'km/h converted');
eq(W.parseWind({ unitCode: 'wmoUnit:km_h-1', value: 32.2 }) > 20, true, 'gridpoint object km/h');
eq(W.parseWind({ unitCode: 'wmoUnit:mph', value: 11 }), 11, 'gridpoint object mph');
eq(W.parseWind({ unitCode: 'wmoUnit:km_h-1', value: null }), null, 'null value');
eq(W.parseWind('calm'), null, 'words = not available');
eq(W.parseWind(''), null, 'empty');
eq(W.parseWind(undefined), null, 'missing');
eq(W.parseWind('12 knots'), null, 'unknown unit');
const P = [{ startTime: '2026-11-22T12:00:00-05:00', endTime: '2026-11-22T13:00:00-05:00', windSpeed: '8 mph' }, { startTime: '2026-11-22T13:00:00-05:00', endTime: '2026-11-22T14:00:00-05:00', windSpeed: '14 mph' }];
eq(W.windAt(P, Date.parse('2026-11-22T18:25:00Z')), { mph: 14 }, 'period holding kickoff (1:25 PM ET)');
eq(W.windAt(P, Date.parse('2026-11-22T17:00:00Z')), { mph: 8 }, 'start of an hour belongs to that hour');
eq(W.windAt(P, Date.parse('2026-11-22T19:00:00Z')), { later: true }, 'kickoff after the forecast ends');
eq(W.windAt(P, Date.parse('2026-11-22T10:00:00Z')), null, 'kickoff before the first period');
eq(W.windAt([{ startTime: 'x', endTime: 'y', windSpeed: '12 mph' }], 1), null, 'bad times');
eq(W.windAt([], 1), null, 'no periods');
eq(W.roofOf('GB', false), 'open', 'Lambeau open');
eq(W.roofOf('GB', true), 'dome', 'ESPN says indoor');
eq(W.roofOf('DET', false), 'dome', 'fixed dome');
['ARI', 'ATL', 'DAL', 'HOU', 'IND'].forEach((a) => eq(W.roofOf(a, false), 'retract', a + ' retractable'));
eq(W.roofOf('XYZ', false), 'unknown', 'unknown stadium');

// ---- the route with fakes ----
const NOW0 = Date.parse('2026-11-21T18:00:00Z'); let NOW = NOW0;
const ev = (id, away, home, date, o) => Object.assign({ id, date, status: { type: { state: 'pre' } }, competitions: [{ neutralSite: false, venue: { indoor: false }, odds: [{ overUnder: 44.5 }], competitors: [{ homeAway: 'home', team: { abbreviation: home } }, { homeAway: 'away', team: { abbreviation: away } }] }] }, o || {});
let espn, nws, calls, failNws = false, failPts = false, badHourly = false;
const per = (fromIso, hours, mph) => { const a = Date.parse(fromIso), out = []; for (let i = 0; i < hours; i++) out.push({ startTime: new Date(a + i * 36e5).toISOString(), endTime: new Date(a + (i + 1) * 36e5).toISOString(), windSpeed: (typeof mph === 'function' ? mph(i) : mph) + ' mph', temperature: 40 }); return out; };
function reset() {
  calls = { espn: 0, pts: 0, hr: 0, ua: [] };
  espn = { week: { number: 12 }, season: { type: 2, year: 2026 }, events: [
    ev('1', 'CHI', 'GB', '2026-11-22T18:00Z'), // open, windy 14
    ev('2', 'NYJ', 'BUF', '2026-11-22T18:00Z'), // open, 9 mph
    ev('3', 'CAR', 'ATL', '2026-11-22T18:00Z'), // retractable
    ev('4', 'LV', 'DET', '2026-11-22T18:00Z'), // dome
    ev('5', 'MIA', 'WSH', '2026-11-22T18:00Z', { competitions: [{ neutralSite: true, venue: { indoor: false }, odds: [{ overUnder: 47 }], competitors: [{ homeAway: 'home', team: { abbreviation: 'WSH' } }, { homeAway: 'away', team: { abbreviation: 'MIA' } }] }] }), // neutral
    ev('6', 'KC', 'DEN', '2026-11-30T01:20Z'), // past the forecast end
    ev('7', 'PIT', 'CLE', '2026-11-20T01:15Z', { status: { type: { state: 'post' } } }), // finished: not listed
    ev('8', 'SEA', 'SF', '2026-11-22T21:25Z', { competitions: [{ neutralSite: false, venue: { indoor: true }, odds: [], competitors: [{ homeAway: 'home', team: { abbreviation: 'SF' } }, { homeAway: 'away', team: { abbreviation: 'SEA' } }] }] }), // ESPN says indoor
  ] };
  nws = { // per stadium key lat,lon
    '44.5,-88.06': per('2026-11-21T18:00:00Z', 156, 14),
    '42.77,-78.79': per('2026-11-21T18:00:00Z', 156, 9),
    '39.74,-105.02': per('2026-11-21T18:00:00Z', 100, 20),
  };
}
const db = {}; let dbOn = true;
W._deps.hasDb = () => dbOn;
W._deps.S = {
  dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null),
  dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
};
W._deps.now = () => NOW;
W._deps.fetch = async (url, o) => {
  if (url.includes('site.api.espn.com')) { calls.espn++; return { ok: true, json: async () => espn }; }
  calls.ua.push(o && o.headers && o.headers['User-Agent']);
  let m = /api\.weather\.gov\/points\/([-\d.]+),([-\d.]+)$/.exec(url);
  if (m) { calls.pts++; if (failPts) return { ok: false, status: 500 }; const k = (+m[1]) + ',' + (+m[2]); return { ok: true, json: async () => ({ properties: { forecastHourly: badHourly ? 'https://evil.example/x' : 'https://api.weather.gov/gridpoints/X/' + encodeURIComponent(k) + '/forecast/hourly' } }) }; }
  m = /api\.weather\.gov\/gridpoints\/X\/([^/]+)\/forecast\/hourly$/.exec(url);
  if (m) { calls.hr++; if (failNws) return { ok: false, status: 503 }; const k = decodeURIComponent(m[1]); return nws[k] ? { ok: true, json: async () => ({ properties: { periods: nws[k] } }) } : { ok: false, status: 404 }; }
  throw new Error('unexpected fetch ' + url);
};
const srv = http.createServer(async (req, res) => { if (!(await W.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
const get = async (port, path, method) => { const r = await fetch('http://127.0.0.1:' + port + (path || '/wx/nfl'), { method: method || 'GET' }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {} return { s: r.status, j, h: r.headers }; };
const by = (j) => Object.fromEntries(j.games.map((g) => [g.id, g]));
srv.listen(0, async () => {
  const PORT = srv.address().port; let r;
  try {
    reset(); W._reset();
    r = await get(PORT); eq(r.s, 200, 'ok'); eq(r.h.get('access-control-allow-origin'), '*', 'CORS');
    const g = by(r.j);
    eq(g['1'].status, 'ok', 'GB ok'); eq(g['1'].mph, 14, 'GB 14 mph'); eq(g['1'].roof, 'open', 'GB open'); eq(g['1'].pulled, NOW0, 'pulled time'); eq(g['1'].tot, 44.5, 'ESPN total kept');
    eq(g['2'].mph, 9, 'BUF 9 mph (the phone decides 9 < 10)');
    eq(g['3'].status, 'skip', 'ATL skipped'); eq(g['3'].note, 'Roof may be closed: not counted', 'retractable wording');
    eq(g['4'].status, 'skip', 'DET skipped'); eq(g['4'].roof, 'dome', 'dome');
    eq(g['5'].status, 'skip', 'neutral skipped'); eq(g['5'].roof, 'neutral', 'neutral');
    eq(g['6'].status, 'later', 'DEN after the forecast end'); eq(g['6'].mph, undefined, 'no number for later');
    t(!g['7'], 'finished game not listed');
    eq(g['8'].status, 'skip', 'ESPN indoor skipped'); eq(g['8'].roof, 'dome', 'ESPN indoor = dome');
    eq(r.j.src, 'National Weather Service hourly forecast (api.weather.gov)', 'source named');
    t(calls.ua.length > 0 && calls.ua.every((u) => /Oddable/.test(u)), 'descriptive User-Agent on every NWS call');
    eq(calls.pts, 3, 'one gridpoint lookup per open stadium'); eq(calls.hr, 3, 'one hourly forecast per open stadium');
    eq(r.j.past, [], 'nothing has kicked off yet');
    t(db[W.ROW] && db[W.ROW].data.g['1'] && db[W.ROW].data.g['1'].mph === 14 && db[W.ROW].data.g['1'].at === NOW0, 'forecast stored before kickoff');
    t(!db[W.ROW].data.g['3'] && !db[W.ROW].data.g['4'] && !db[W.ROW].data.g['6'], 'skipped / later games not stored');
    // cache: 59 minutes later no new NWS call; 61 minutes later one per stadium
    NOW = NOW0 + 59 * 6e4; r = await get(PORT); eq(calls.hr, 3, 'cached for 60 min'); eq(by(r.j)['1'].pulled, NOW0, 'cached pull time shown');
    NOW = NOW0 + 61 * 6e4; nws['44.5,-88.06'] = per('2026-11-21T18:00:00Z', 156, 16); r = await get(PORT); eq(calls.hr, 6, 'refetched after 60 min'); eq(calls.pts, 3, 'gridpoint lookup kept 24 h'); eq(by(r.j)['1'].mph, 16, 'new forecast'); eq(db[W.ROW].data.g['1'].mph, 16, 'stored forecast updated (still before kickoff)');
    // failure path: NWS down -> "na", never a number; failure retried after 5 minutes, not on every request
    W._reset(); reset(); failNws = true; NOW = NOW0 + 2 * 36e5;
    r = await get(PORT); eq(by(r.j)['1'].status, 'na', 'NWS down = na'); eq(by(r.j)['1'].note, 'Forecast not available', 'wording'); eq(by(r.j)['1'].mph, undefined, 'no guess');
    const h1 = calls.hr; NOW += 60e3; await get(PORT); eq(calls.hr, h1, 'failure not retried within 5 min');
    failNws = false; NOW += 5 * 6e4; r = await get(PORT); eq(by(r.j)['1'].status, 'ok', 'recovers after 5 min');
    W._reset(); reset(); failPts = true; r = await get(PORT); eq(by(r.j)['1'].status, 'na', 'gridpoint lookup failing = na'); failPts = false;
    W._reset(); reset(); badHourly = true; r = await get(PORT); eq(by(r.j)['1'].status, 'na', 'hourly url outside api.weather.gov refused'); badHourly = false;
    W._reset(); reset(); nws['44.5,-88.06'] = per('2026-11-21T18:00:00Z', 156, 'calm'); r = await get(PORT); eq(by(r.j)['1'].status, 'na', 'unreadable wind = na');
    W._reset(); reset(); espn = { bad: true }; r = await get(PORT); eq(r.s, 200, 'empty ESPN still answers'); eq(r.j.games, [], 'no games');
    W._reset(); reset(); W._deps.fetch = ((f) => async (url, o) => { if (url.includes('espn')) return { ok: false, status: 500 }; return f(url, o); })(W._deps.fetch); r = await get(PORT); eq(r.s, 502, 'ESPN down = 502'); eq(r.j.ok, false, 'not ok');
  } catch (e) { console.error(e); process.exitCode = 1; srv.close(); return; }
  // past / live-record rows (fresh fetch fake)
  try {
    delete require.cache[require.resolve('./wx')];
  } catch (e) {}
  const W2 = require('./wx');
  Object.keys(db).forEach((k) => delete db[k]);
  W2._deps.hasDb = () => dbOn; W2._deps.S = W._deps.S; NOW = NOW0; W2._deps.now = () => NOW;
  reset();
  W2._deps.fetch = async (url) => {
    if (url.includes('espn')) { calls.espn++; return { ok: true, json: async () => espn }; }
    if (/\/points\//.test(url)) { const m = /points\/([-\d.]+),([-\d.]+)$/.exec(url); return { ok: true, json: async () => ({ properties: { forecastHourly: 'https://api.weather.gov/gridpoints/X/' + encodeURIComponent((+m[1]) + ',' + (+m[2])) + '/forecast/hourly' } }) }; }
    const m = /gridpoints\/X\/([^/]+)\/forecast/.exec(url), k = decodeURIComponent(m[1]); return nws[k] ? { ok: true, json: async () => ({ properties: { periods: nws[k] } }) } : { ok: false, status: 404 };
  };
  const srv2 = http.createServer(async (req, res) => { if (!(await W2.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
  srv2.listen(0, async () => {
    const PORT2 = srv2.address().port; let r;
    try {
      r = await get(PORT2); t(db[W2.ROW].data.g['1'], 'stored');
      // after kickoff: game 1 is in `past`; a row whose pull came AFTER kickoff is never listed
      db[W2.ROW].data.g['99'] = { mph: 20, at: Date.parse('2026-11-22T19:00Z'), ko: Date.parse('2026-11-22T18:00Z'), tot: 40, h: 'NE', a: 'NYJ', wk: 12 }; db[W2.ROW].updated += 1; W2._reset();
      espn.events.forEach((e) => { if (e.id === '1' || e.id === '2') e.status.type.state = 'post'; });
      NOW = Date.parse('2026-11-23T02:00Z'); r = await get(PORT2);
      const ids = r.j.past.map((x) => x.id).sort(); eq(ids, ['1', '2'], 'past = games stored before kickoff that have kicked off (not the after-kickoff row)');
      const p1 = r.j.past.find((x) => x.id === '1'); eq([p1.mph, p1.tot, p1.h, p1.a], [14, 44.5, 'GB', 'CHI'], 'past row fields');
      t(p1.at < p1.ko, 'stored before kickoff');
      // no database: memory only, same answer shape
      dbOn = false; W2._reset(); NOW = NOW0; espn.events.forEach((e) => { if (e.id === '1' || e.id === '2') e.status.type.state = 'pre'; }); r = await get(PORT2); eq(r.j.stored, false, 'memory only flagged'); eq(by(r.j)['1'].status, 'ok', 'works without a database');
      // playoffs / other season: forecast shown, nothing stored
      dbOn = true; Object.keys(db).forEach((k) => delete db[k]); W2._reset(); espn.season.type = 3; r = await get(PORT2); eq(by(r.j)['1'].status, 'ok', 'playoff forecast shown'); t(!db[W2.ROW] || !Object.keys(db[W2.ROW].data.g).length, 'playoffs not stored'); espn.season.type = 2;
      // route details
      r = await get(PORT2, '/wx/nfl', 'POST'); eq(r.s, 405, 'GET only');
      r = await get(PORT2, '/wx/other'); eq(r.s, 404, 'other paths not handled');
      console.log('wx.test.js: ' + n + ' checks passed');
    } catch (e) { console.error(e); process.exitCode = 1; }
    srv2.close(); srv.close();
  });
});
