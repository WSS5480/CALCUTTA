// Run: node odds-api/betwatch.test.js   (no network: ESPN, the database, My Apps, the clock and the env are in-memory fakes)
const assert = require('assert'), http = require('http'), W = require('./betwatch'), LG = require('./grade').LG;
let n = 0; const ok = (c, m) => { n++; assert(c, m); }, eq = (a, b, m) => { n++; assert.deepStrictEqual(a, b, m); };
let NOW, env, rows, espn, espnCalls, espnDown, sent, maCalls, maMode, pings, dbReads, logs, timers;
const T0 = Date.parse('2026-11-16T19:00:00Z'); // Monday 2:00 PM Eastern
const D = W._deps;
const acctOf = (rid) => 'h' + rid + '@phone.oddable';
function fresh(keep) {
  W._reset(); NOW = T0; env = { BETPUSH_ENABLED: '1', SUPABASE_URL: 'https://db.test', SUPABASE_KEY: 'k', RENDER_EXTERNAL_URL: 'https://odds.test' };
  if (!keep) rows = {}; espn = {}; espnCalls = []; espnDown = false; sent = []; maCalls = []; maMode = 'ok'; pings = []; dbReads = []; logs = []; timers = [];
}
D.now = () => NOW; D.env = (k) => env[k]; D.log = (...a) => logs.push(a.join(' ')); D.LG = () => LG; D.timer = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
D.fetch = async (url) => {
  url = String(url);
  if (url.startsWith('https://odds.test')) { pings.push(url); return { ok: true, json: async () => ({ ok: true }) }; }
  const m = /sports\/(.+)\/scoreboard\?dates=(\d{8})/.exec(url); assert(m, 'unexpected outbound call: ' + url); espnCalls.push(m[1] + '|' + m[2]);
  if (espnDown) return { ok: false, status: 503, json: async () => ({}) };
  return { ok: true, json: async () => ({ events: (espn[m[1] + '|' + m[2]] || []).map((e) => JSON.parse(JSON.stringify(e))) }) };
};
D.S = () => ({
  dbGet: async (id) => { dbReads.push(id); return rows[id] ? JSON.parse(JSON.stringify(rows[id])) : null; },
  dbPut: async (row, ignoreDup) => { if (ignoreDup && rows[row.id]) return; rows[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (!rows[id] || rows[id].updated !== was) return false; rows[id].data = JSON.parse(JSON.stringify(data)); rows[id].updated = upd; return true; },
  dbIds: async () => { dbReads.push('ids'); return Object.keys(rows).filter((k) => !k.startsWith('lock:')); },
});
D.A = () => ({
  who: (req) => { const t = req.headers['x-token']; return t && t !== 'bad' ? t : null; }, maReady: () => true, phoneEmail: (id) => 'h' + id + '@phone.oddable',
  ma: async (path, data) => { maCalls.push({ path, data }); if (path === '/api/v1/push/subscribe') return maMode === 'subfail' ? { ok: false, status: 400, j: { error: 'Unsupported push service' } } : { ok: true, status: 200, j: { ok: true } };
    assert.strictEqual(path, '/api/v1/push/send'); if (maMode === '404') return { ok: false, status: 404, j: {} }; if (maMode === 'down') throw new Error('down'); if (maMode === '429') return { ok: false, status: 429, j: { ok: false, error: 'busy' } }; if (maMode === '503') return { ok: false, status: 503, j: { ok: false, error: 'nopush' } }; if (maMode === 'nodev') return { ok: true, status: 200, j: { ok: true, sent: 0 } };
    sent.push(data); return { ok: true, status: 200, j: { ok: true, sent: 1 } }; },
});
const ev = (id, st, a, h, d, per, A, H, start) => ({ id, date: new Date(start || T0 - 36e5).toISOString(), status: { period: per || 1, type: { state: st, shortDetail: d || '' } }, competitions: [{ competitors: [{ homeAway: 'home', score: String(h), team: { abbreviation: H || 'BAL' } }, { homeAway: 'away', score: String(a), team: { abbreviation: A || 'LAC' } }] }] });
const NFL = 'football/nfl|20261116', NBA = 'basketball/nba|20261116', NHL = 'hockey/nhl|20261116', MLB = 'baseball/mlb|20261116', CFB = 'football/college-football|20261116';
const player = (rid, bets, o) => { rows[rid] = { id: rid, salt: 's', pinhash: 'p', data: { bets }, updated: 5 }; const p = rows['lock:betpush'] || (rows['lock:betpush'] = { id: 'lock:betpush', salt: 'x', pinhash: 'x', data: { p: {} }, updated: 1 }); p.data.p[acctOf(rid)] = Object.assign({ on: 1, mode: 'bets', bb: 'q', fin: 1, rid, dev: 1, t: 1 }, o || {}); };
const step = async (ms) => { NOW += ms === undefined ? 30e3 : ms; return W.tick(); };
const sp = (gid, side, line) => ({ id: 'b' + gid + side, gid, side: side || 'LAC', type: 'sp', line: line === undefined ? 4.5 : line, stake: 50 });
const srv = http.createServer(async (req, res) => { if (!(await W.handle(req, res))) { res.statusCode = 404; res.end('{"error":"not found"}'); } });
const call = (method, path, body, tok) => new Promise((done, fail) => { const r = http.request({ port: srv.address().port, path, method, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { 'x-token': tok } : {}) }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => done({ status: res.statusCode, headers: res.headers, j: JSON.parse(b || '{}') })); }); r.on('error', fail); r.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)); });

(async () => {
  await new Promise((r) => srv.listen(0, r));
  try {
    // 1. SWITCH OFF (unset, '0', 'true'): no ESPN call, no database read, no My Apps call, no timer; routes answer "not switched on" without reading anything
    for (const v of [undefined, '0', 'true', '']) {
      fresh(); env.BETPUSH_ENABLED = v; player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 7, 0)];
      eq(W.start(), false); eq(timers.length, 0); eq(await W.tick(), W.SLOW); await step(); await step();
      eq([espnCalls.length, dbReads.length, maCalls.length, pings.length], [0, 0, 0, 0], 'off = nothing: ' + v);
      let r = await call('GET', '/betpush/status', undefined, acctOf('r1')); eq(r.status, 200); eq(r.j, { enabled: false, on: false, hasDevice: false, mode: 'off', bb: 'q', finals: true }); eq(r.headers['access-control-allow-origin'], '*');
      r = await call('POST', '/betpush/set', { on: true }, acctOf('r1')); eq(r.j.ok, false); eq(r.j.enabled, false); eq(r.j.error, 'Alerts are not switched on at the server yet');
      r = await call('POST', '/betpush/test', {}, acctOf('r1')); eq(r.j.ok, false); r = await call('POST', '/betpush/here', {}, acctOf('r1')); eq(r.j.ok, false);
      eq([espnCalls.length, dbReads.length, maCalls.length], [0, 0, 0]);
    }
    // 2. ON but nobody subscribed: the settings row is read once, ESPN is never called
    fresh(); espn[NFL] = [ev('1', 'in', 7, 0)]; eq(await W.tick(), W.SLOW); await step(W.SLOW); eq(espnCalls.length, 0); eq(maCalls.length, 0); ok(dbReads.length <= 2);
    // a player who is off / has no phone / has no bets row is not "subscribed"
    fresh(); player('r1', [sp('1')], { on: 0 }); player('r2', [sp('1')], { dev: 0 }); player('r3', [sp('1')], { mode: 'off' }); espn[NFL] = [ev('1', 'in', 7, 0)]; await W.tick(); eq(espnCalls.length, 0);

    // 3. FIRST LOOK IS SILENT; a score = one alert per bettor; same score again = nothing; 30 s pace while live
    fresh(); player('r1', [sp('1'), { id: 'o', gid: '1', side: 'O', type: 'ou', line: 44.5 }]); player('r2', [sp('1', 'BAL')]); player('r3', [sp('2')]); espn[NFL] = [ev('1', 'in', 7, 0, '9:10 - 1st'), ev('2', 'post', 20, 10, 'Final')];
    eq(await W.tick(), W.FAST); eq(sent.length, 0, 'first look silent'); eq(espnCalls.length, 6, 'one look at each league'); ok(W._m().live && W._m().active);
    espn[NFL][0] = ev('1', 'in', 14, 0, '1:56 - 2nd', 2); eq(await step(), W.FAST); eq(sent.length, 2);
    const a1 = sent.find((x) => x.account === acctOf('r1')), a2 = sent.find((x) => x.account === acctOf('r2'));
    eq(a1.title, 'LAC 14 – 0 BAL · 2nd 1:56'); eq(a1.body, 'LAC +4.5: covering by 18.5 right now; Over 44.5: needs 31 more right now'); eq(a1.tag, 'bet-1'); eq(a1.url, '/?open=bets');
    eq(a2.body, 'BAL +4.5: not covering, 9.5 short right now'); eq(Object.keys(a1).sort(), ['account', 'body', 'tag', 'title', 'url']); ok(a1.title.length <= 80 && a1.body.length <= 240 && /^[A-Za-z0-9:_-]{1,64}$/.test(a1.tag) && /^\/[^/\s]/.test(a1.url), 'inside My Apps limits');
    eq(espnCalls.slice(6), [NFL], 'while live only the board with a watched game is read');
    await step(); await step(); eq(sent.length, 2, 'no change = no alert');
    // every score is its own alert when the polls see them apart; two scores inside one poll = one alert with the new score
    espn[NFL][0] = ev('1', 'in', 14, 7, '0:40 - 2nd', 2); await step(); eq(sent.length, 4); espn[NFL][0] = ev('1', 'in', 21, 10, '12:00 - 3rd', 3); await step(); eq(sent.length, 6); eq(sent[5].title.slice(0, 15), 'LAC 21 – 10 BAL');
    // correction
    espn[NFL][0] = ev('1', 'in', 20, 10, '11:00 - 3rd', 3); await step(); eq(sent.length, 8); ok(sent[7].title.startsWith('Score corrected: LAC 20 – 10 BAL'));
    // final: one alert each, result words, never again
    espn[NFL][0] = ev('1', 'post', 27, 20, 'Final', 4); await step(); eq(sent.length, 10); const f1 = sent.slice(8).find((x) => x.account === acctOf('r1'));
    eq(f1.title, 'Final: LAC 27 – 20 BAL'); eq(f1.body, 'LAC +4.5 won; Over 44.5 won'); ok(!/right now/.test(f1.body));
    const after = await step(); eq(sent.length, 10); ok(after !== W.FAST, 'nothing live: slow again (' + after + ')'); ok(!W._m().live);
    espn[NFL][0] = ev('1', 'post', 28, 20, 'Final', 4); await step(W.SLOW); await step(W.SLOW); eq(sent.length, 10, 'a final game never alerts again');
    eq(sent.filter((x) => x.account === acctOf('r3')).length, 0, 'a bet on another (finished) game gets nothing');

    // 4. basketball: quarter ends and the final by default; every score when the player chose it. Hockey / baseball / college football: every score
    fresh(); player('r1', [Object.assign(sp('9', 'LAL'), { lg: 'nba' })]); player('r2', [Object.assign(sp('9', 'BOS'), { lg: 'nba' })], { bb: 'all' });
    player('r4', [{ id: 'h', gid: '7', side: 'DAL', type: 'ml', lg: 'nhl' }, { id: 'm', gid: '8', side: 'NYY', type: 'ml', lg: 'mlb' }, { id: 'c', gid: '6', side: 'TEX', type: 'ml' }]);
    espn[NBA] = [ev('9', 'in', 20, 18, '5:00 - 1st', 1, 'LAL', 'BOS')]; espn[NHL] = [ev('7', 'in', 0, 0, '10:00 - 1st', 1, 'DAL', 'COL')]; espn[MLB] = [ev('8', 'in', 0, 0, 'Top 1st', 1, 'NYY', 'BOS')]; espn[CFB] = [ev('6', 'in', 0, 0, '10:00 - 1st', 1, 'TEX', 'OU')];
    await W.tick(); eq(sent.length, 0);
    espn[NBA][0] = ev('9', 'in', 22, 18, '4:40 - 1st', 1, 'LAL', 'BOS'); await step(); eq(sent.map((x) => x.account), [acctOf('r2')], 'a basket: only the every-score player');
    espn[NBA][0] = ev('9', 'in', 30, 28, 'End of 1st', 1, 'LAL', 'BOS'); await step(); eq(sent.length, 3); eq(sent.find((x, i) => i > 0 && x.account === acctOf('r1')).title, 'LAL 30 – 28 BOS · End of 1st');
    await step(); eq(sent.length, 3); espn[NBA][0] = ev('9', 'in', 32, 28, '11:30 - 2nd', 2, 'LAL', 'BOS'); await step(); eq(sent.length, 4, 'after the break only the every-score player');
    espn[NBA][0] = ev('9', 'in', 60, 55, '11:00 - 3rd', 3, 'LAL', 'BOS'); await step(); eq(sent.length, 6, 'a missed break is reported once'); espn[NBA][0] = ev('9', 'post', 110, 100, 'Final', 4, 'LAL', 'BOS'); await step(); eq(sent.length, 8); ok(sent.slice(6).every((x) => x.title === 'Final: LAL 110 – 100 BOS'));
    const before = sent.length; espn[NHL][0] = ev('7', 'in', 1, 0, '9:00 - 1st', 1, 'DAL', 'COL'); await step(); espn[MLB][0] = ev('8', 'in', 0, 2, 'Bot 1st', 1, 'NYY', 'BOS'); await step(); espn[CFB][0] = ev('6', 'in', 7, 0, '8:00 - 1st', 1, 'TEX', 'OU'); await step();
    eq(sent.slice(before).map((x) => x.body), ['DAL ML: winning by 1 right now', 'NYY ML: losing by 2 right now', 'TEX ML: winning by 7 right now']); eq(sent.slice(before).map((x) => x.tag), ['bet-7', 'bet-8', 'bet-6']);

    // 5. player choices: finals only; no final; app open on his phone (here) = the in-app pop-up has it; off
    fresh(); player('r1', [sp('1')], { mode: 'final' }); player('r2', [sp('1')], { fin: 0 }); player('r3', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0)]; await W.tick();
    await call('POST', '/betpush/here', {}, acctOf('r3')); espn[NFL][0] = ev('1', 'in', 7, 0); await step(); eq(sent.map((x) => x.account), [acctOf('r2')], 'final-only and app-open players skipped');
    espn[NFL][0] = ev('1', 'in', 14, 0); await step(60e3); eq(sent.map((x) => x.account).sort(), [acctOf('r2'), acctOf('r2'), acctOf('r3')].sort(), 'the open-app mark lasts 45 s');
    sent = []; espn[NFL][0] = ev('1', 'post', 14, 0, 'Final'); await step(); eq(sent.map((x) => x.account).sort(), [acctOf('r1'), acctOf('r3')].sort(), 'final: not to the no-final player');

    // 6. safety cap 400 a day per player, then a new day
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0)]; await W.tick();
    for (let i = 1; i <= 405; i++) { espn[NFL][0] = ev('1', 'in', i, 0); await step(); } eq(sent.length, 400, 'cap'); eq(W.DAYCAP, 400);
    NOW += 12 * 36e5; W._m().schedAt = 0; espn['football/nfl|20261117'] = [ev('1', 'in', 500, 0)]; await W.tick(); espn['football/nfl|20261117'][0] = ev('1', 'in', 501, 0); await step(); espn['football/nfl|20261117'][0] = ev('1', 'in', 502, 0); await step(); ok(sent.length > 400, 'a new day counts from zero: ' + sent.length);

    // 7. RESTART: state is stored; a quick restart neither repeats nor loses a score; a long sleep rebuilds silently (no burst)
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 7, 0)]; await W.tick(); espn[NFL][0] = ev('1', 'in', 14, 0); await step(); eq(sent.length, 1); ok(rows['lock:betpushst'] && rows['lock:betpushst'].data.seen['1'].a === 14, 'state row written');
    let keepRows = rows; fresh(true); rows = keepRows; espn[NFL] = [ev('1', 'in', 14, 0)]; NOW = T0 + 90e3; await W.tick(); eq(sent.length, 0, 'restart, same score: nothing repeated');
    fresh(true); espn[NFL] = [ev('1', 'in', 21, 0)]; NOW = T0 + 150e3; await W.tick(); eq(sent.length, 1, 'restart 1 minute later with a new score: that score is not lost');
    fresh(true); espn[NFL] = [ev('1', 'in', 35, 0), ev('2', 'in', 3, 3)]; rows.r1.data.bets.push(sp('2')); NOW = T0 + 3 * 36e5; await W.tick(); eq(sent.length, 0, 'after a long sleep: silent'); espn[NFL][0] = ev('1', 'in', 42, 0); await step(); eq(sent.length, 1);
    eq(rows['lock:betpushst'].data.n[acctOf('r1')] >= 1, true, 'the daily count is stored');

    // 8. KEEP AWAKE: own address only while a watched game is live, every 10 minutes, off with BETPUSH_KEEPAWAKE=0, never when idle
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('1', 'pre', 0, 0, '', 0, 'LAC', 'BAL', T0 + 15 * 60e3)];
    eq(await W.tick(), W.FAST, 'within 20 minutes of the start = fast'); eq(pings.length, 0, 'not live yet: no ping'); eq(sent.length, 0);
    espn[NFL][0] = ev('1', 'in', 0, 0, '15:00 - 1st', 1, 'LAC', 'BAL', T0 + 15 * 60e3); await step(16 * 60e3); eq(pings, ['https://odds.test/health']); eq(sent.length, 0, 'kickoff is no alert');
    for (let i = 0; i < 19; i++) await step(); eq(pings.length, 1, 'not again inside 10 minutes'); await step(); await step(); eq(pings.length, 2);
    espn[NFL][0] = ev('1', 'post', 3, 0, 'Final', 4, 'LAC', 'BAL', T0 + 15 * 60e3); await step(); const pn = pings.length; for (let i = 0; i < 6; i++) await step(W.SLOW); eq(pings.length, pn, 'no ping once nothing is live');
    fresh(); env.BETPUSH_KEEPAWAKE = '0'; player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0)]; await W.tick(); for (let i = 0; i < 30; i++) await step(); eq(pings.length, 0);
    fresh(); delete env.RENDER_EXTERNAL_URL; player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0)]; await W.tick(); eq(pings.length, 0);

    // 9. pacing and cost: idle = 6 boards per 10 minutes and no bets rows; a game far off = slow; games on with no bettor = 5 minutes; each player's row read once per 5 minutes
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('1', 'pre', 0, 0, '', 0, 'LAC', 'BAL', T0 + 3 * 36e5)]; eq(await W.tick(), W.SLOW); eq(espnCalls.length, 6); eq(dbReads.filter((x) => x === 'r1').length, 0, 'no bets row read while nothing is near');
    await step(W.SLOW); eq(espnCalls.length, 12);
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('5', 'in', 0, 0)]; eq(await W.tick(), W.REBUILD, 'live games but no bettor on them'); eq(sent.length, 0);
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0)]; await W.tick(); for (let i = 0; i < 9; i++) await step(); eq(dbReads.filter((x) => x === 'r1').length, 1, 'bets cached 5 minutes'); await step(); await step(); eq(dbReads.filter((x) => x === 'r1').length, 2);
    eq(espnCalls.filter((x) => x === NFL).length, 12, 'one board read per 30 s'); eq(espnCalls.length, 12 + 5, 'the other leagues only in the 10-minute look');
    // a bet placed during the game is picked up at the next 5-minute read, and its first look is silent
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0), ev('2', 'in', 3, 0)]; await W.tick(); rows.r1.data.bets.push(sp('2')); espn[NFL][1] = ev('2', 'in', 10, 0); for (let i = 0; i < 11; i++) await step(); eq(sent.length, 0); espn[NFL][1] = ev('2', 'in', 17, 0); await step(); eq(sent.length, 1); eq(sent[0].tag, 'bet-2');
    // settled / sold bets and bets on games not on today's boards are not watched; ESPN down = nothing compared, nothing sent, then no burst
    fresh(); player('r1', [Object.assign(sp('1'), { fin: 'won' }), Object.assign(sp('1', 'BAL'), { res: 'lost' }), Object.assign(sp('1'), { id: 'c', cash: 60 }), sp('777')]); espn[NFL] = [ev('1', 'in', 0, 0)]; eq(await W.tick(), W.REBUILD); espn[NFL][0] = ev('1', 'in', 7, 0); await step(W.REBUILD); eq(sent.length, 0);
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0)]; await W.tick(); espnDown = true; espn[NFL][0] = ev('1', 'in', 7, 0); await step(); await step(); eq(sent.length, 0); espnDown = false; await step(); eq(sent.length, 1, 'one alert with the current score when ESPN is back'); espnDown = true; for (let i = 0; i < 25; i++) await step(); espnDown = false; espn[NFL][0] = ev('1', 'in', 28, 0); await step(); eq(sent.length, 1, 'ESPN away for more than 10 minutes: silent re-start');

    // 10. the sender: My Apps without the route (404) pauses sends for 10 minutes and logs once; no phone left (sent 0) switches the player's device off; a throw is survived
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0)]; await W.tick(); maMode = '404'; espn[NFL][0] = ev('1', 'in', 7, 0); await step(); espn[NFL][0] = ev('1', 'in', 14, 0); await step(); espn[NFL][0] = ev('1', 'in', 21, 0); await step();
    eq(maCalls.filter((c) => c.path === '/api/v1/push/send').length, 1, 'one try, then paused'); eq(logs.filter((l) => /push\/send/.test(l)).length, 1); eq(rows['lock:betpush'].data.p[acctOf('r1')].dev, 1, 'a missing route is not the player\'s fault');
    maMode = 'ok'; NOW += 10 * 60e3; W._m().st.seen['1'].t = NOW; espn[NFL][0] = ev('1', 'in', 28, 0); await step(); eq(sent.length, 1, 'sending again after the pause');
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0)]; await W.tick(); maMode = 'nodev'; espn[NFL][0] = ev('1', 'in', 7, 0); await step(); eq(rows['lock:betpush'].data.p[acctOf('r1')].dev, 0); maMode = 'ok'; espn[NFL][0] = ev('1', 'in', 14, 0); await step(); eq(sent.length, 0, 'no phone = not subscribed any more');
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0)]; await W.tick(); maMode = 'down'; espn[NFL][0] = ev('1', 'in', 7, 0); await step(); maMode = 'ok'; espn[NFL][0] = ev('1', 'in', 14, 0); await step(); eq(sent.length, 1); eq(rows['lock:betpushst'].data.n[acctOf('r1')], 1, 'a failed send is not counted');
    // 429 busy: not counted, no pause, the next score goes out; 503 nopush: paused like a missing route; BETPUSH_URL must be a path inside the app
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0)]; await W.tick(); maMode = '429'; espn[NFL][0] = ev('1', 'in', 7, 0); await step(); maMode = 'ok'; espn[NFL][0] = ev('1', 'in', 14, 0); await step(); eq(sent.length, 1); eq(rows['lock:betpushst'].data.n[acctOf('r1')], 1); eq(rows['lock:betpush'].data.p[acctOf('r1')].dev, 1);
    fresh(); player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0)]; await W.tick(); maMode = '503'; espn[NFL][0] = ev('1', 'in', 7, 0); await step(); espn[NFL][0] = ev('1', 'in', 14, 0); await step(); eq(maCalls.filter((c) => c.path === '/api/v1/push/send').length, 1, '503 nopush pauses'); eq(logs.length, 1);
    for (const [u, want] of [['/sports.html?lg=nba', '/sports.html?lg=nba'], ['https://evil.example/x', '/?open=bets'], ['//evil.example', '/?open=bets'], ['/a b', '/?open=bets'], ['', '/?open=bets']]) { fresh(); env.BETPUSH_URL = u; player('r1', [sp('1')]); espn[NFL] = [ev('1', 'in', 0, 0)]; await W.tick(); espn[NFL][0] = ev('1', 'in', 7, 0); await step(); eq(sent[0].url, want, 'url ' + u); }
    // start(): one timer, re-armed with the wait tick() gave
    fresh(); eq(W.start(), true); eq(timers.length, 1); eq(W.start(), false); await timers[0].fn(); eq(timers.length, 2); eq(timers[1].ms, W.SLOW);

    // 11. ROUTES
    fresh(); rows.r1 = { id: 'r1', salt: 's', pinhash: 'p', data: { bets: [] }, updated: 5 }; const me = acctOf('r1'), sub = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'P', auth: 'A' }, extra: 'x' };
    let r = await call('GET', '/betpush/status'); eq(r.status, 401); r = await call('GET', '/betpush/status', undefined, 'bad'); eq(r.status, 401); r = await call('POST', '/betpush/set', { on: true }); eq(r.status, 401);
    r = await call('GET', '/betpush/status', undefined, me); eq(r.j, { enabled: true, on: false, hasDevice: false, mode: 'off', bb: 'q', finals: true, test: true }); eq(r.headers['cache-control'], 'no-store');
    r = await call('POST', '/betpush/status', {}, me); eq(r.status, 405); r = await call('GET', '/betpush/set', undefined, me); eq(r.status, 405); r = await call('GET', '/betpush/nope', undefined, me); eq(r.status, 404); r = await call('POST', '/betpush/set', '{bad', me); eq(r.status, 400); r = await call('POST', '/betpush/set', {}, me); eq(r.status, 400);
    r = await call('POST', '/betpush/set', { on: true, mode: 'bets', subscription: sub }, me); eq(r.status, 200); eq(r.j, { ok: true, enabled: true, on: true, hasDevice: true, mode: 'bets', bb: 'q', finals: true, test: true });
    eq(maCalls, [{ path: '/api/v1/push/subscribe', data: { account: me, subscription: { endpoint: sub.endpoint, keys: { p256dh: 'P', auth: 'A' } } } }], 'the phone is registered at My Apps, the same call the reminders use');
    eq(rows['lock:betpush'].data.p[me].rid, 'r1'); eq(rows['lock:betpush'].data.p[me].on, 1);
    r = await call('POST', '/betpush/set', { on: true, mode: 'final', bb: 'all', finals: true }, me); eq([r.j.mode, r.j.bb, r.j.hasDevice, r.j.on], ['final', 'all', true, true]); r = await call('POST', '/betpush/set', { on: true, bb: 'junk', finals: false }, me); eq([r.j.mode, r.j.bb, r.j.finals], ['bets', 'all', false]);
    r = await call('POST', '/betpush/set', { on: false }, me); eq([r.j.on, r.j.mode, r.j.hasDevice], [false, 'off', true]); r = await call('GET', '/betpush/status', undefined, me); eq(r.j.on, false);
    for (const bad of [{ endpoint: 5 }, 'x', null, { endpoint: 'https://x', keys: {} }, { endpoint: 'h'.repeat(1001), keys: { p256dh: 'a', auth: 'b' } }]) { r = await call('POST', '/betpush/set', { on: true, subscription: bad }, me); eq(r.status, 400, JSON.stringify(bad).slice(0, 30)); }
    maMode = 'subfail'; r = await call('POST', '/betpush/set', { on: true, subscription: sub }, me); eq(r.status, 400); eq(r.j.error, 'Unsupported push service'); maMode = 'ok'; eq(rows['lock:betpush'].data.p[me].on, 0, 'a refused phone changes nothing');
    // accounts with no bets row (email sign-in, owner PIN, unknown phone)
    for (const who of ['someone@example.com', 'owner', acctOf('zzz')]) { r = await call('POST', '/betpush/set', { on: true, subscription: sub }, who); eq(r.status, 400); eq(r.j.error, 'Sign in with your cell number and PIN to get alerts for your bets'); r = await call('POST', '/betpush/set', { on: false }, who); eq(r.status, 200); }
    // on without a phone registered: saved, but hasDevice false
    rows.r2 = { id: 'r2', salt: 's', pinhash: 'p', data: {}, updated: 1 }; r = await call('POST', '/betpush/set', { on: true }, acctOf('r2')); eq([r.j.on, r.j.hasDevice], [true, false]);
    // test alert
    r = await call('POST', '/betpush/test', {}, acctOf('r2')); eq(r.status, 400); sent = []; r = await call('POST', '/betpush/test', {}, me); eq(r.j, { ok: true, sent: 1 }); eq(sent[0].title, 'Oddable test alert'); eq(sent[0].account, me);
    r = await call('POST', '/betpush/test', {}, me); eq(r.status, 429); NOW += 31e3; maMode = '404'; r = await call('POST', '/betpush/test', {}, me); eq(r.status, 503); eq(r.j.error, 'Alerts are not switched on at My Apps yet');
    NOW += 31e3; maMode = 'nodev'; r = await call('POST', '/betpush/test', {}, me); eq(r.j.ok, false); eq(r.j.sent, 0); r = await call('GET', '/betpush/status', undefined, me); eq(r.j.hasDevice, false); maMode = 'ok';
    // two players saving at once both land (conditional write)
    fresh(); for (let i = 1; i <= 6; i++) rows['q' + i] = { id: 'q' + i, salt: 's', pinhash: 'p', data: {}, updated: 1 };
    const all = await Promise.all([1, 2, 3].map((i) => call('POST', '/betpush/set', { on: true, subscription: sub }, acctOf('q' + i)))); ok(all.every((x) => x.status === 200), all.map((x) => x.status).join()); eq(Object.keys(rows['lock:betpush'].data.p).length, 3);
    // no account id, token or key ever in an answer; database down = 502 with CORS, never a crash
    const save = D.S; D.S = () => ({ dbGet: async () => { throw new Error('db down secret-k'); }, dbIds: async () => { throw new Error('x'); } }); W._reset(); r = await call('GET', '/betpush/status', undefined, me); eq(r.status, 502); ok(!/secret/.test(JSON.stringify(r.j))); eq(r.headers['access-control-allow-origin'], '*'); D.S = save;
    env.SUPABASE_KEY = ''; W._reset(); r = await call('GET', '/betpush/status', undefined, me); eq(r.status, 503); eq(await W.tick(), W.SLOW);
    // v298: followed teams. /betpush/fav saves the list; a followed team's game alerts with no bet; the star is on the team; bets still come first
    fresh(); player('r1', []); player('r2', [sp('1')]); espn[NFL] = [ev('1', 'in', 7, 0, '9:10 - 1st')]; espn[CFB] = [ev('5', 'in', 3, 10, '5:21 - 2nd', 2, 'ARK', 'TEX')];
    let fr = await call('POST', '/betpush/fav', { fav: { cfb: ['TEX', '<b>'], nfl: ['BAL'], junk: ['X'] } }, acctOf('r1')); eq(fr.status, 200); eq(fr.j.fav, { cfb: ['TEX'], nfl: ['BAL'] }); eq(fr.j.alerts, true);
    eq(rows['lock:betpush'].data.p[acctOf('r1')].fav, { cfb: ['TEX'], nfl: ['BAL'] });
    fr = await call('POST', '/betpush/fav', { fav: {} }, acctOf('nobody@x')); eq(fr.j.alerts, false, 'a player with alerts off can still save follows');
    await W.tick(); eq(sent.length, 0, 'first look silent');
    espn[CFB][0] = ev('5', 'in', 3, 17, '5:21 - 2nd', 2, 'ARK', 'TEX'); espn[CFB][0].competitions[0].situation = { downDistanceText: '1st & 10 at TEX 30', possession: 'idARK' }; espn[CFB][0].competitions[0].leaders = [{ name: 'rushingLeader', shortDisplayName: 'Rushing Leader', leaders: [{ displayValue: '7 CAR, 34 YDS', athlete: { shortName: 'C. Settles' } }] }];
    espn[NFL][0] = ev('1', 'in', 14, 0, '1:56 - 2nd', 2); await step();
    const fa = sent.filter((x) => x.account === acctOf('r1')), fb = sent.filter((x) => x.account === acctOf('r2'));
    eq(fa.length, 2, 'both followed games (no bets)'); const tx = fa.find((x) => /TEX/.test(x.title)); eq(tx.title, 'ARK 3 – 17 TEX⭐ · 2nd 5:21'); ok(/^1st & 10 at TEX 30/.test(tx.body) && /Rushing: C\. Settles 7 CAR, 34 YDS/.test(tx.body), tx.body); eq(tx.tag, 'bet-5');
    ok(fa.some((x) => x.title === 'LAC 14 – 0 BAL⭐ · 2nd 1:56'), 'NFL follow');
    eq(fb.length, 1, 'r2: his bet only (he follows nobody)'); ok(/covering/.test(fb[0].body));
    eq(W._cleanFav({ nfl: 'DAL', cfb: ['TEX', 'TEX', 'x'.repeat(9)] }), { cfb: ['TEX'] });
    console.log('betwatch.test.js: ' + n + ' checks passed');
  } finally { srv.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
