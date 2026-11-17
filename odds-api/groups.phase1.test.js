// Run: node odds-api/groups.phase1.test.js   (no network, no database: Supabase, ESPN and sign-in are in-memory fakes; the real groups.js / grade.js / limits.js / sync.js merge)
// GROUPS PHASE 1 (Nov 16 2026): the fixes this phase adds on top of 1e47e93, one or more checks per fix.
//   A  the switches (review blocker B3): GROUPS_ENABLED (master, default off), GROUPS_OWNER_ONLY, GROUPS_TESTERS, /groups/on, /groups/access
//   B  a bet no contest can count is answered "personal": not saved, not locked, never "Saved to your group. Locked." (B2 server part)
//   C  ESPN cannot confirm the game: the bet is refused with "try again", never saved, never "Locked" (H5)
//   D  the member index write after an approval is retried, and a missing entry is rebuilt (H3)
//   E  NOT fixed here, waiting for the owner (H1, H2, H4): written as checks that FAIL today, skipped with the reason. Run them with ODD_RUN_OPEN=1.
const assert = require('assert'), http = require('http'), crypto = require('crypto');
const G = require('./groups'), GR = require('./grade'), S = require('./sync'), LIM = require('./limits'), D = G._deps;
const ENV = (o) => { ['GROUPS_ENABLED', 'GROUPS_OWNER_ONLY', 'GROUPS_TESTERS'].forEach((k) => { if (o && o[k] != null) process.env[k] = o[k]; else delete process.env[k]; }); };
const X = { db: {}, reads: 0, writes: 0, NOREAD: false, failKey: '', failN: 0, espn: 'ok', fetches: 0 };
D.S = {
  dbGet: async (id) => { X.reads++; await new Promise((r) => setImmediate(r)); if (X.NOREAD) throw new Error('db read 503'); return X.db[id] ? JSON.parse(JSON.stringify(X.db[id])) : null; },
  dbPut: async (row, ign) => { X.writes++; if (X.db[row.id] && ign) return; X.db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { X.writes++; if (X.failKey && id === X.failKey && X.failN > 0) { X.failN--; throw new Error('db write 503'); } if (!X.db[id] || X.db[id].updated !== Number(was)) return false; X.db[id].data = JSON.parse(JSON.stringify(data)); X.db[id].updated = upd; return true; },
  dbIds: async () => { X.reads++; return Object.keys(X.db).filter((k) => !k.startsWith('lock:')); },
};
const WHO = ['steve', 'ann', 'bob', 'cat', 'dan', 'tess', 'stranger'], SID = {}, NAMES = {};
WHO.forEach((w, i) => { SID[w] = ((i + 1).toString(16).padStart(4, '0').repeat(2) + '0'.repeat(56)); NAMES[SID[w].slice(0, 8)] = w.toUpperCase() + 'name'; });
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable', E = (w) => pe(SID[w]);
const MKOF = (e) => crypto.createHash('sha256').update('oddable-group|' + e).digest('hex').slice(0, 24);
// sign-in fake: 't-owner' = the owner-PIN sign-in; 't-steve' = the owner's own phone account (OWNER_PHONE); everyone else an ordinary phone account
D.acct = () => ({ who: (req) => { const w = String(req.headers['x-token'] || '').replace(/^t-/, ''); return SID[w] ? E(w) : w === 'owner' ? 'owner' : null; }, phoneEmail: pe, isOwnerPhone: (e) => e === E('steve'),
  ownerOk: (req) => String(req.headers['x-token']) === 't-owner' || (String(req.headers['x-token']) === 't-steve' && req.headers['x-dash'] === 'unlocked'), namesGet: async () => NAMES, ownerName: () => 'Sir Oddable' });
D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1'); D.sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5)));
const Z = (s) => Date.parse(s), H = 3600e3, DAY = 864e5, START = Z('2026-11-22T18:00:00Z');
const T = (abbr, name) => ({ abbr, name, short: name.split(' ').pop(), loc: name.split(' ').slice(0, -1).join(' ') });
const O = (details, ou, aml, hml) => ({ details, overUnder: ou, overOdds: -110, underOdds: -110, awayTeamOdds: { moneyLine: aml, spreadOdds: -110 }, homeTeamOdds: { moneyLine: hml, spreadOdds: -110 } });
const PATH = { nfl: 'football/nfl', nba: 'basketball/nba' };
const GAMES = [
  { id: '501', start: START, away: T('DAL', 'Dallas Cowboys'), home: T('NYG', 'New York Giants'), as: 3, hs: 45 }, // nothing posted on ESPN (H1)
  { id: '502', start: START + 3 * H, away: T('KC', 'Kansas City Chiefs'), home: T('BUF', 'Buffalo Bills'), as: 27, hs: 24, odds: O('BUF -2.5', 47.5, 130, -150) },
  { id: '509', start: START + 2 * H, away: T('MIA', 'Miami Dolphins'), home: T('NE', 'New England Patriots'), as: 17, hs: 10, odds: O('NE -3', 40, 140, -160) },
  { id: '503', start: START + 7 * DAY, away: T('GB', 'Green Bay Packers'), home: T('CHI', 'Chicago Bears'), as: 14, hs: 21, odds: O('CHI -3', 41, 140, -160) },
  { id: '701', lg: 'nba', start: START, away: T('LAL', 'Los Angeles Lakers'), home: T('BOS', 'Boston Celtics'), as: 105, hs: 110, odds: O('BOS -4', 214.5, 150, -170) },
];
const ymd = (ms) => GR.chiDay(ms).replace(/-/g, '');
D.fetch = async (u) => {
  X.fetches++; if (!/^https:\/\/site\.api\.espn\.com\//.test(u)) throw new Error('unexpected outside call: ' + u);
  if (X.espn === 'throw') throw new Error('ESPN down'); if (X.espn === '500') return { ok: false, status: 503, json: async () => ({}) };
  const m = /sports\/([a-z-]+\/[a-z-]+)\/scoreboard\?dates=(\d{8})/.exec(u);
  const evs = !m ? [] : GAMES.filter((g) => PATH[g.lg || 'nfl'] === m[1] && ymd(g.start) === m[2]).map((g) => { const now = D.now(), st = now < g.start ? 'pre' : now < g.start + 3.5 * H ? 'in' : 'post', tm = (t) => ({ abbreviation: t.abbr, displayName: t.name, shortDisplayName: t.short, location: t.loc });
    return { id: g.id, date: new Date(g.start).toISOString(), status: { type: { state: st, completed: st === 'post', name: st === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED' } }, competitions: [{ odds: g.odds ? [g.odds] : undefined, competitors: [{ homeAway: 'home', score: st === 'pre' ? '0' : String(g.hs), team: tm(g.home) }, { homeAway: 'away', score: st === 'pre' ? '0' : String(g.as), team: tm(g.away) }] }] }; });
  return { ok: true, status: 200, json: async () => ({ events: evs }) };
};
let NOW = START - 3 * DAY; D.now = () => NOW;
// activity events (events.js): every emit groups.js makes is recorded here instead of going anywhere
const EVS = [], EVFAKE = { emit: (type, o) => { EVS.push(Object.assign({ type }, o)); return true; } }; D.ev = () => EVFAKE;
const fresh = (env) => { EVS.length = 0; D.ev = () => EVFAKE; X.db = {}; WHO.forEach((w) => { X.db[SID[w]] = { id: SID[w], salt: 's', pinhash: 'h', data: { bets: [] }, updated: 1 }; }); Object.assign(X, { NOREAD: false, failKey: '', failN: 0, espn: 'ok', reads: 0, writes: 0, fetches: 0 }); G._reset(); LIM._reset(); NOW = START - 3 * DAY; ENV(env === undefined ? { GROUPS_ENABLED: '1' } : env); };
const srv = http.createServer(async (req, res) => { if (!(await G.handle(req, res))) { res.statusCode = 404; res.end('{}'); } }); let P;
const call = async (who, op, b, o) => { o = o || {}; const r = await fetch('http://127.0.0.1:' + P + '/groups/' + op, { method: o.method || 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-ip': '9.9.9.' + (WHO.indexOf(who) + 1) }, who ? { 'x-token': 't-' + who } : {}, o.headers || {}), body: o.method === 'GET' ? undefined : JSON.stringify(b || {}) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j, h: r.headers }; };
const CDEF = { cname: 'Picks', sport: 'nfl', fmt: 'standings', start: START - H, runs: 'w4', kalshi: false, honor: false, types: { sp: true, ml: true, ou: true, prop: true, parlay: true }, legs: 4, metric: 'win', minBets: 0, minPaid: 0, cap: 0, entry: 25, split: '100' };
const mk = async (who, c, join) => { const r = await call(who, 'create', { name: 'G' + Math.random().toString(36).slice(2, 7), take: { kind: 'none', v: 0 }, join: Object.assign({ requests: true, open: false, auto: true, max: 8, late: 'no' }, join || {}), contest: Object.assign({}, CDEF, c || {}) }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); return r.j.group; };
const joinAll = async (g, ws) => { for (const w of ws) { const r = await call(w, 'join', { code: g.code }); assert.strictEqual(r.s, 200, w + ' join ' + JSON.stringify(r.j)); assert.ok(r.j.group && r.j.group.members, w + ' is a member'); } };
const bet = (id, gid, side, type, odds, stake, o) => { const g = GAMES.find((x) => x.id === gid); return Object.assign({ id, gid, lg: g.lg || 'nfl', away: g.away.abbr, home: g.home.abbr, day: GR.chiDay(g.start), side, type, odds, stake }, o || {}); };
const add = (w, b) => call(w, 'bet/add', { bet: b });
const book = (w) => ((X.db['lock:gb:' + MKOF(E(w))] || {}).data || {}).b || {};
// Main-line port of the round 4/5 rules: the kickoff reference must be read inside the last 30 minutes before kickoff (in production the 5-minute tick
// does it). The clock jumps here, so before a jump FORWARD the harness runs the tick the server would have run 5 minutes before each kickoff on the way.
const kickTicks = async (to) => { const ts = [...new Set(GAMES.map((g) => g.start - 5 * 6e4))].filter((t) => t > NOW && t <= to).sort((a, b) => a - b); for (const t of ts) { NOW = t; await G.tick({ force: true }); } };
const view = async (w, g, at, cid) => { if (at != null) { await kickTicks(at); NOW = at; } G._reset(); const st = await call(w, 'standings', { id: g.id, cid: cid || g.contests[0].cid }); assert.strictEqual(st.s, 200, JSON.stringify(st.j)); const me = st.j.rows.find((x) => x.name === w.toUpperCase() + 'name'); const p = await call(w, 'player', { id: g.id, cid: cid || g.contests[0].cid, pid: me.pid }); return { st: st.j, row: me, bets: p.j.bets, t: p.j.t, by: Object.fromEntries(p.j.bets.map((b) => [b.id, b])) }; };
const personal = (r, re) => { assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.personal, true, 'answered as a personal bet: ' + JSON.stringify(r.j)); assert.strictEqual(r.j.gl, 0); assert.strictEqual(r.j.saved, false); assert.ok(!/Saved to your group/.test(JSON.stringify(r.j)), 'never told "Saved to your group"'); assert.match(r.j.text, /NOT added to a group: it stays a personal bet/); if (re) assert.match(r.j.why, re); return r; };
const NOTIN = { betLock: 0, canBet: false, saved: false };
// every route of /groups (besides on, bet/status, invite, preview), with a body that would be valid enough to reach its code
const OPS = ['mine', 'create', 'edit', 'get', 'join', 'request', 'cancel', 'decide', 'requests', 'paid', 'leave', 'delete', 'standings', 'player', 'limits', 'partners', 'sidepot', 'contest/add', 'contest/edit', 'contest/delete', 'bet/add', 'bet/edit', 'bet/delete', 'bet/swap', 'bet/void', 'bet/voidable', 'ent/contact', 'ent/admin', 'access', 'nonsense'];
const tests = [], skips = []; const test = (n, f) => tests.push([n, f]); const open = (n, why, f) => (process.env.ODD_RUN_OPEN === '1' ? tests.push(['[OPEN, expected to FAIL today] ' + n, f]) : skips.push([n, why]));

// =============================== A. the switches ===============================
test('A1 MASTER SWITCH off (GROUPS_ENABLED unset, the default): every caller, the owner included, gets the safe answers; the database and ESPN are never touched; the tick does nothing', async () => {
  for (const env of [{}, { GROUPS_OWNER_ONLY: '1', GROUPS_TESTERS: LIM.keyOf(E('tess')) }, { GROUPS_ENABLED: '0' }, { GROUPS_ENABLED: 'true' }, { GROUPS_ENABLED: 'on' }]) {
    fresh(env);
    for (const w of ['', 'stranger', 'tess', 'steve', 'owner', 'bogus-token']) {
      for (const b of [{}, { id: 'b123' }]) { const r = await call(w, 'bet/status', b); assert.strictEqual(r.s, 200, 'bet/status is 200 for ' + (w || 'nobody') + ' with ' + JSON.stringify(env)); assert.deepStrictEqual(r.j, NOTIN); }
      let r = await call(w, 'bet/status', null, { method: 'GET' }); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j, NOTIN);
      for (const op of ['invite', 'preview']) { r = await call(w, op, { type: 'g', code: 'ABCD-EFGH' }); assert.strictEqual(r.s, 404); assert.strictEqual(r.j.error, 'This invite link is not valid or has expired.'); }
      for (const m of ['GET', 'POST']) { r = await call(w, 'on', {}, { method: m }); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j, { on: false }); }
      for (const op of OPS.concat('access/request')) { r = await call(w, op, { id: 'ABCDEFGHJK', bet: bet('x1', '502', 'KC', 'ml', 130, 10), name: 'x' }); assert.strictEqual(r.s, 403, op + ' is refused for ' + (w || 'nobody')); assert.strictEqual(r.j.off, true); assert.match(r.j.error, /not open for this account/); }
    }
    assert.deepStrictEqual(await G.tick(), { off: true }); assert.deepStrictEqual(await G.tick({ force: true }), { off: true });
    assert.deepStrictEqual([X.reads, X.writes, X.fetches], [0, 0, 0], 'no database read, no database write, no ESPN call while Groups is off (' + JSON.stringify(env) + ')');
    assert.deepStrictEqual(Object.keys(X.db).filter((k) => k.startsWith('lock:')), [], 'no Groups row exists');
  }
});
test('A2 OWNER ONLY (GROUPS_ENABLED=1, GROUPS_OWNER_ONLY=1): the owner-PIN sign-in, the owner\'s phone account and a listed tester get normal Groups', async () => {
  fresh({ GROUPS_ENABLED: '1', GROUPS_OWNER_ONLY: '1', GROUPS_TESTERS: ' ' + LIM.keyOf(E('tess')).toUpperCase() + ' , 9565551234, not-a-key,,' }); // spaces / capitals are tolerated; a phone number or junk is ignored
  for (const w of ['owner', 'steve', 'tess']) { for (const m of ['GET', 'POST']) { const r = await call(w, 'on', {}, { method: m }); assert.deepStrictEqual(r.j, { on: true }, w); assert.match(r.h.get('cache-control'), /private, max-age=300/); assert.match(r.h.get('vary') || '', /x-token/i); } }
  const g = await mk('steve'); await joinAll(g, ['tess']); let r = await call('owner', 'mine', {}); assert.strictEqual(r.s, 200); r = await call('owner', 'join', { code: g.code }); assert.strictEqual(r.s, 200, 'the owner-PIN sign-in can join');
  r = await call('tess', 'mine', {}); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.groups.length, 1); assert.strictEqual(r.j.betLock, 1);
  r = await call('tess', 'bet/status', {}); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j, { betLock: 1, canBet: true }, 'the normal answer for a member');
  NOW = START - 5 * H; r = await add('tess', bet('t1', '502', 'KC', 'ml', 130, 20)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.text, 'Saved to your group.'); r = await add('steve', bet('s1', '502', 'BUF', 'ml', -150, 20)); assert.strictEqual(r.s, 200, 'the owner\'s phone account places a group bet');
  r = await add('owner', bet('o1', '502', 'KC', 'ml', 130, 20)); assert.strictEqual(r.s, 409); assert.match(r.j.error, /Turn on sync/, 'the owner-PIN sign-in has no synced bets: it can run groups but not place a group bet (as reviewed)');
  r = await call('steve', 'standings', { id: g.id, cid: g.contests[0].cid }); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.rows.length, 3);
});
test('A3 OWNER ONLY: everyone else (signed in or not) is told "not in a group" by bet/status with HTTP 200, always, even with the database down; invites are "not valid"; every other route is a clear 403; nothing is read', async () => {
  fresh({ GROUPS_ENABLED: '1', GROUPS_OWNER_ONLY: '1', GROUPS_TESTERS: LIM.keyOf(E('tess')) });
  const g = await mk('steve'); assert.ok(g.code && g.link); const r0 = [X.reads, X.writes, X.fetches];
  for (const w of ['', 'stranger', 'ann', 'bogus-token']) {
    for (const down of [false, true]) { X.NOREAD = down; for (const b of [{}, { id: 'b123' }, { id: { $bad: 1 } }]) { const r = await call(w, 'bet/status', b); assert.strictEqual(r.s, 200, 'never 401 / 403 / 404 / 500 for ' + (w || 'nobody')); assert.deepStrictEqual(r.j, NOTIN); } } X.NOREAD = false;
    let r = await fetch('http://127.0.0.1:' + P + '/groups/bet/status', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': w ? 't-' + w : '' }, body: '{not json' }); assert.strictEqual(r.status, 200, 'even a broken body'); assert.deepStrictEqual(await r.json(), NOTIN);
    r = await call(w, 'invite', { type: 'g', code: g.code }); assert.strictEqual(r.s, 404, 'a REAL invite code is "not valid" for a blocked caller'); assert.strictEqual(r.j.error, 'This invite link is not valid or has expired.'); assert.ok(!JSON.stringify(r.j).includes(g.name));
    r = await call(w, 'preview', { code: g.code }); assert.strictEqual(r.s, 404); assert.strictEqual(r.j.error, 'This invite link is not valid or has expired.');
    for (const op of OPS) { r = await call(w, op, { id: g.id, code: g.code, cid: g.contests[0].cid, bet: bet('x1', '502', 'KC', 'ml', 130, 10) }); assert.strictEqual(r.s, 403, op + ' refused for ' + (w || 'nobody') + ': ' + JSON.stringify(r.j)); assert.deepStrictEqual(r.j, { error: 'Groups is not open for this account yet.', off: true }); assert.ok(!JSON.stringify(r.j).includes(g.name)); }
    r = await call(w, 'on', {}, { method: 'GET' }); assert.deepStrictEqual(r.j, { on: false });
  }
  assert.deepStrictEqual([X.reads, X.writes, X.fetches], r0, 'blocked callers cost no database read, no write and no ESPN call');
  assert.strictEqual(X.db['lock:grp:' + g.id].data.members.length, 1, 'nobody got into the owner\'s group'); assert.strictEqual((X.db['lock:grp:' + g.id].data.reqs || []).length, 0);
});
test('A4 OWNER ONLY, letting a tester in: a signed-in person asks (/groups/access/request), the owner reads their ACCOUNT KEY (/groups/access, owner only), adds it to GROUPS_TESTERS, and they are in', async () => {
  fresh({ GROUPS_ENABLED: '1', GROUPS_OWNER_ONLY: '1' }); const g = await mk('steve');
  let r = await call('', 'access/request', { name: 'Nobody' }); assert.strictEqual(r.s, 403, 'signed in only');
  r = await call('ann', 'access/request', { name: 'Ann <b>from golf</b>' }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.ok, true); r = await call('ann', 'access/request', { name: 'Ann again' }); assert.strictEqual(r.s, 200); assert.strictEqual(X.db['lock:gaccess'].data.list.length, 1, 'one line per account');
  for (let i = 0; i < 3; i++) r = await call('ann', 'access/request', { name: 'Ann again' }); assert.strictEqual(r.s, 429, 'three a day per account');
  for (const w of ['ann', 'tess', 'stranger', '']) { r = await call(w, 'access', {}); assert.strictEqual(r.s, 403, 'the list is not for ' + (w || 'nobody')); }
  r = await call('steve', 'access', {}); assert.strictEqual(r.s, 403, 'the owner\'s phone needs its dashboard unlock for the list (same rule as the dashboard)'); assert.strictEqual(r.j.error, 'Owner only');
  r = await call('steve', 'access', {}, { headers: { 'x-dash': 'unlocked' } }); assert.strictEqual(r.s, 200); const viaPhone = r.j; r = await call('owner', 'access', { op: 'list' }); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j, viaPhone);
  assert.deepStrictEqual([r.j.enabled, r.j.ownerOnly, r.j.testers], [true, true, []]); assert.strictEqual(r.j.requests.length, 1); const q = r.j.requests[0];
  assert.strictEqual(q.key, LIM.keyOf(E('ann'))); assert.match(q.key, /^[0-9a-f]{24}$/); assert.strictEqual(q.name, 'Ann again'); assert.strictEqual(q.kind, 'phone'); assert.strictEqual(q.listed, false);
  const all = JSON.stringify(r.j); assert.ok(!all.includes(SID.ann) && !all.includes(E('ann')) && !all.includes(MKOF(E('ann'))), 'no phone hash, no account id, no member key in the list: only the account key');
  r = await call('owner', 'access', { op: 'find', q: 'bobna' }); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j.found, [{ key: LIM.keyOf(E('bob')), name: 'BOBname', tag: SID.bob.slice(0, 8), kind: 'phone', listed: false }], 'find by the name the owner typed in the dashboard');
  r = await call('owner', 'access', { op: 'find', q: SID.cat.slice(0, 6) }); assert.strictEqual(r.j.found[0].key, LIM.keyOf(E('cat')), 'or by player tag'); r = await call('owner', 'access', { op: 'find', q: 'Pal@Example.com' }); assert.strictEqual(r.j.found[0].key, LIM.keyOf('pal@example.com'), 'or by email');
  assert.strictEqual((await call('ann', 'join', { code: g.code })).s, 403, 'asking is not being let in');
  process.env.GROUPS_TESTERS = q.key + ',' + LIM.keyOf(E('bob')); // what the owner sets on Render
  assert.deepStrictEqual((await call('ann', 'on', {}, { method: 'GET' })).j, { on: true }); await joinAll(g, ['ann', 'bob']); assert.deepStrictEqual((await call('ann', 'bet/status', {})).j, { betLock: 1, canBet: true });
  r = await call('ann', 'access/request', {}); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.on, true); r = await call('owner', 'access', {}); assert.strictEqual(r.j.requests[0].listed, true); assert.deepStrictEqual(r.j.testers.sort(), [q.key, LIM.keyOf(E('bob'))].sort());
  process.env.GROUPS_TESTERS = LIM.keyOf(E('bob')); // a tester taken off the list again
  assert.deepStrictEqual((await call('ann', 'bet/status', {})).j, NOTIN, 'off the list = "not in a group" again (their new bets are personal), still HTTP 200'); assert.strictEqual((await call('ann', 'mine', {})).s, 403);
  assert.ok(X.db['lock:grp:' + g.id].data.members.some((m) => m.mk === MKOF(E('ann'))), 'their seat and bets stay in the group until the commissioner acts');
});
test('A5 OPEN (GROUPS_ENABLED=1, GROUPS_OWNER_ONLY unset): Groups is open to every signed-in account exactly as designed; removing the variable needs no code change', async () => {
  fresh({ GROUPS_ENABLED: '1', GROUPS_OWNER_ONLY: '1' }); assert.strictEqual((await call('stranger', 'create', {})).s, 403);
  delete process.env.GROUPS_OWNER_ONLY; // the only thing that changes
  const g = await mk('stranger'); await joinAll(g, ['ann']); assert.deepStrictEqual((await call('ann', 'bet/status', {})).j, { betLock: 1, canBet: true }); assert.deepStrictEqual((await call('dan', 'bet/status', {})).j, { betLock: 0, canBet: true }, 'the normal "not in a group" answer');
  for (const w of ['', 'stranger', 'owner']) assert.deepStrictEqual((await call(w, 'on', {}, { method: 'GET' })).j, { on: true });
  assert.strictEqual((await call('', 'mine', {})).s, 401, 'signed out: "Sign in to use Groups", as before'); assert.strictEqual((await call('', 'invite', { type: 'g', code: g.code })).j.title, g.name, 'the public invite banner works');
  for (const v of ['0', 'true', '']) { process.env.GROUPS_OWNER_ONLY = v; assert.strictEqual((await call('dan', 'mine', {})).s, 200, 'only the exact value 1 means owner-only'); }
  assert.strictEqual((await call('ann', 'access', {})).s, 403, 'the access list stays owner only'); assert.strictEqual((await call('owner', 'access', {})).j.ownerOnly, false);
});
test('A6 the bet merge follows the same master switch: a group bet is locked in My Bets only while GROUPS_ENABLED=1 (sync.js)', async () => {
  fresh(); const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H; assert.strictEqual((await add('bob', bet('m1', '502', 'KC', 'ml', 130, 50))).s, 200);
  const row = () => X.db[SID.bob], push = (inc) => { const cur = row(); cur.data = S.merge(cur.data, inc, NOW, cur.updated); cur.updated = NOW; };
  assert.ok(row().data.bets.find((b) => b.id === 'm1').gl > 0, 'the server put the locked copy in My Bets'); NOW += 1000; push({ bets: [], tomb: ['m1'] }); assert.ok(row().data.bets.some((b) => b.id === 'm1'), 'on: a phone cannot delete it');
  ENV({}); NOW += 1000; assert.strictEqual(S.groupsOn(), false); assert.deepStrictEqual((await call('bob', 'bet/status', { id: 'm1' })).j, NOTIN, 'off: the status call is the safe answer');
  assert.ok(Object.keys(book('bob')).includes('m1'), 'the group book (what a contest reads) is untouched by the switch');
});

// =============================== B. a bet no contest can count ===============================
test('B1 another sport: an NBA bet from a member of an NFL-only contest is answered "personal" (not saved, not locked), even when that game has already started; an NFL bet still locks', async () => {
  fresh(); const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H;
  personal(await add('bob', bet('n1', '701', 'BOS', 'ml', -170, 30)), /Not NFL/);
  NOW = START + H; personal(await add('bob', bet('n2', '701', 'LAL', 'ml', 150, 30)), /outside your contests/); // the NBA game is in progress: still a personal bet, not "already started, nothing added"
  let r = await add('bob', bet('f0', '501', 'NYG', 'ml', -110, 30)); assert.strictEqual(r.s, 409); assert.match(r.j.error, /already started.*Nothing was added/, 'a late bet INSIDE the contest is still refused (round 3 L2)');
  r = await add('bob', bet('f1', '502', 'KC', 'ml', 130, 30)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.text, 'Saved to your group.'); assert.strictEqual(r.j.counted, 1);
  assert.deepStrictEqual(Object.keys(book('bob')), ['f1'], 'only the bet a contest can count is in the group book'); assert.deepStrictEqual(X.db[SID.bob].data.bets.map((b) => b.id), ['f1'], 'and only it was written to My Bets by the server');
  const v = await view('bob', g, START + 2 * DAY); assert.deepStrictEqual(Object.keys(v.by), ['f1']);
});
test('B2 dates: a game before the contest starts, a game after it ends, and a member whose contests are all over: personal each time, with the reason', async () => {
  fresh(); const g = await mk('ann', { start: START + DAY, runs: 'w4' }); await joinAll(g, ['bob']); NOW = START - 5 * H;
  personal(await add('bob', bet('d1', '502', 'KC', 'ml', 130, 10)), /Picks: The game is outside this contest's dates/);
  assert.strictEqual((await add('bob', bet('d2', '503', 'CHI', 'ml', -160, 10))).j.text, 'Saved to your group.', 'a game inside the dates locks');
  fresh(); const w = await mk('ann', { runs: 'weekend' }); await joinAll(w, ['bob']); NOW = START - 5 * H;
  personal(await add('bob', bet('d3', '503', 'CHI', 'ml', -160, 10)), /Picks: The game is outside this contest's dates/);
  NOW = START + 6 * DAY; assert.deepStrictEqual((await call('bob', 'bet/status', {})).j, { betLock: 0, canBet: true }); personal(await add('bob', bet('d4', '503', 'CHI', 'ml', -160, 10)), /not in a running group contest/); // the weekend contest is over
  assert.deepStrictEqual(Object.keys(book('bob')), []);
});
test('B3 a bet the server cannot check (a player prop): personal in an ordinary contest; saved and locked, and SAID to be honor-only, in a contest with the honor rule', async () => {
  fresh(); const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H; const prop = (id) => ({ id, kind: 'prop', text: 'Mahomes over 250.5 passing yards', odds: -110, stake: 20, day: '2026-11-22', lg: 'nfl', pp: { gid: '502' } });
  personal(await add('bob', prop('p1')), /count only where the commissioner turned on the honor system/);
  fresh(); const h = await mk('ann', { honor: true, entry: 0 }) /* main-line port: honor props only in a free contest */; await joinAll(h, ['bob']); NOW = START - 5 * H; const r = await add('bob', prop('p2')); assert.strictEqual(r.s, 200); assert.ok(r.j.gl > 0 && r.j.honor === true, JSON.stringify(r.j)); assert.match(r.j.text, /^Saved to your group\. Oddable can't check this prop itself: the commissioner enters its result after the game and another member confirms it\.$/);
});
test('B4 two contests, one can count it: saved and locked once, told how many count it; over the weekly limit in the only contest: personal', async () => {
  fresh(); const g1 = await mk('ann'); await joinAll(g1, ['bob']); const g2 = await mk('cat', { sport: 'nba' }); await joinAll(g2, ['bob']); NOW = START - 5 * H;
  let r = await add('bob', bet('n1', '701', 'BOS', 'ml', -170, 30)); assert.strictEqual(r.s, 200); assert.deepStrictEqual([r.j.text, r.j.counted, r.j.groups], ['Saved to your group.', 1, 2]);
  r = await add('bob', bet('f1', '502', 'KC', 'ml', 130, 30)); assert.deepStrictEqual([r.j.text, r.j.counted], ['Saved to your group.', 1]);
  let v = await view('bob', g1, START + 2 * DAY); assert.deepStrictEqual([v.by.f1.ok, v.by.n1.ok, v.t.n], [true, false, 1], 'the NFL contest counts the NFL bet only'); v = await view('bob', g2, START + 2 * DAY, g2.contests[0].cid); assert.deepStrictEqual([v.by.n1.ok, v.by.f1.ok, v.t.n], [true, false, 1], 'the NBA contest counts the NBA bet only');
  fresh(); const g5 = await mk('ann', { maxBets: 5 }); await joinAll(g5, ['bob']); NOW = START - 5 * H;
  const five = [bet('w1', '509', 'NE', 'sp', -110, 10, { line: -3 }) /* 501 has no posted price: round 4 refuses it */, bet('w2', '502', 'BUF', 'ml', -150, 10), bet('w3', '509', 'NE', 'ml', -160, 10), bet('w4', '502', 'Over', 'ou', -110, 10, { line: 47.5 }), bet('w5', '509', 'Over', 'ou', -110, 10, { line: 40 })];
  for (const b of five) { NOW += 1000; r = await add('bob', b); assert.ok(r.s === 200 && r.j.gl > 0, b.id + JSON.stringify(r.j)); }
  NOW += 1000; personal(await add('bob', bet('w6', '502', 'BUF', 'sp', -110, 10, { line: -2.5 })), /Over the weekly limit: only the first 5 bets/); assert.deepStrictEqual(Object.keys(book('bob')).sort(), ['w1', 'w2', 'w3', 'w4', 'w5']);
  assert.ok((await add('bob', bet('w7', '503', 'CHI', 'ml', -160, 10))).j.gl > 0, 'a game in NEXT week still goes in');
});
test('B5 plain sync does NOT reject a personal bet: after the "personal" answer the phone keeps it and its ordinary sync stores it, editable and deletable, outside every contest', async () => {
  fresh(); const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H; const nb = bet('n1', '701', 'BOS', 'ml', -170, 30); personal(await add('bob', nb), /Not NFL/); assert.strictEqual((await add('bob', bet('f1', '502', 'KC', 'ml', 130, 30))).s, 200);
  const row = () => X.db[SID.bob], push = (inc) => { NOW += 1000; const cur = row(); cur.data = S.merge(cur.data, inc, NOW, cur.updated); cur.updated = NOW; };
  push({ bets: [Object.assign({ t: NOW }, nb)] }); let st = row().data.bets.find((b) => b.id === 'n1'); assert.ok(st && !st.gl, 'stored as an ordinary bet'); push({ bets: [Object.assign({}, nb, { t: NOW + 5000, stake: 99 })] }); assert.strictEqual(row().data.bets.find((b) => b.id === 'n1').stake, 99, 'editable');
  push({ bets: [], tomb: ['n1'] }); assert.ok(!row().data.bets.some((b) => b.id === 'n1'), 'deletable'); assert.ok(row().data.bets.some((b) => b.id === 'f1' && b.gl > 0), 'the group bet beside it stays locked');
  assert.deepStrictEqual(Object.keys((await view('bob', g, START + 2 * DAY)).by), ['f1']);
});

// =============================== C. ESPN cannot confirm the game ===============================
test('C1 ESPN not answering (an error, or a 5xx): the bet is REFUSED with "try again" (503), nothing saved, nothing locked, never "Saved to your group"; it goes in once ESPN is back', async () => {
  for (const mode of ['throw', '500']) {
    fresh(); const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H; X.espn = mode;
    let r = await add('bob', bet('e1', '502', 'KC', 'ml', 130, 30)); assert.strictEqual(r.s, 503, mode + ': ' + JSON.stringify(r.j)); assert.match(r.j.error, /Couldn't check this game — try again\. Nothing was added/); assert.ok(!/Saved/.test(JSON.stringify(r.j)));
    r = await add('bob', { id: 'e2', kind: 'parlay', stake: 10, day: '2026-11-22', lg: 'nfl', legs: [{ gid: '502', side: 'KC', type: 'ml', o: 130, lg: 'nfl', home: 'BUF', away: 'KC', day: '2026-11-22' }, { gid: '509', side: 'MIA', type: 'ml', o: 140, lg: 'nfl', home: 'NE', away: 'MIA', day: '2026-11-22' }] }); assert.strictEqual(r.s, 503, 'a parlay too');
    assert.deepStrictEqual(Object.keys(book('bob')), []); assert.deepStrictEqual(X.db[SID.bob].data.bets, []); assert.deepStrictEqual((await call('bob', 'bet/status', { id: 'e1' })).j, { betLock: 1, canBet: true, saved: false }, 'the phone asking by id is told it was not saved');
    X.espn = 'ok'; NOW += 3 * 6e4; r = await add('bob', bet('e1', '502', 'KC', 'ml', 130, 30)); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.text, 'Saved to your group.'); assert.deepStrictEqual(Object.keys(book('bob')), ['e1']);
  }
});
test('C2 the H5 case itself: a LATE bet while ESPN is down is never told "Saved to your group. Locked." (the old code saved it and threw it out later); an old copy of the scoreboard is not proof either', async () => {
  fresh(); const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H; assert.strictEqual((await add('bob', bet('a0', '502', 'KC', 'ml', 130, 10))).s, 200); // the server now holds a copy of that day's games, all "not started"
  NOW = START + 2.5 * H; X.espn = 'throw'; // game 509 kicked off 30 minutes ago and ESPN is down
  let r = await add('bob', bet('late', '509', 'MIA', 'ml', 140, 100)); assert.notStrictEqual(r.s, 200); assert.ok(!/Saved|Locked\./.test(JSON.stringify(r.j).replace('Nothing was locked.', ''))); assert.ok(!book('bob').late);
  fresh(); const g2 = await mk('ann'); await joinAll(g2, ['bob']); NOW = START - 5 * H; assert.strictEqual((await add('bob', bet('a0', '502', 'KC', 'ml', 130, 10))).s, 200);
  NOW += 20 * 6e4; X.espn = 'throw'; // 20 minutes later, still before every kickoff, ESPN is down: the copy the server holds is 20 minutes old
  r = await add('bob', bet('old', '509', 'MIA', 'ml', 140, 100)); assert.strictEqual(r.s, 503, 'a 20-minute-old copy is not "checked just now": ' + JSON.stringify(r.j)); assert.ok(!book('bob').old);
  X.espn = 'ok'; NOW += 3 * 6e4; r = await add('bob', bet('old', '509', 'MIA', 'ml', 140, 100)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.text, 'Saved to your group.');
});
test('C3 an ESPN outage does not block bets that are outside every contest (personal), and a game ESPN simply does not list is not an outage', async () => {
  fresh(); const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H; X.espn = 'throw';
  personal(await add('bob', bet('n1', '701', 'BOS', 'ml', -170, 30)), /outside your contests/); // NBA bet, NFL contest, ESPN down
  X.espn = 'ok'; NOW += 3 * 6e4; const r = await add('bob', Object.assign(bet('x1', '502', 'KC', 'ml', 130, 30), { gid: '99999' })); personal(r, /can't find this game/); // ESPN answered: no such game. Not checked, no honor rule: personal
});

// =============================== D. the member index ===============================
test('D1 the index write after an approval is retried: one failed write no longer strands the approved member', async () => {
  fresh(); const g = await mk('ann', {}, { auto: false }); let r = await call('bob', 'join', { code: g.code }); assert.strictEqual(r.j.pending, true);
  const req = (await call('ann', 'get', { id: g.id })).j.group.reqs[0]; X.failKey = 'lock:gm:' + MKOF(E('bob')); X.failN = 1; // the next write of bob's index row fails once
  r = await call('ann', 'decide', { id: g.id, pid: req.pid, ok: true }); assert.strictEqual(r.s, 200); assert.strictEqual(X.failN, 0, 'the failure happened');
  const ix = X.db[X.failKey].data; assert.ok(ix.g.includes(g.id) && !ix.q.includes(g.id), 'written on the second try'); r = await call('bob', 'mine', {}); assert.deepStrictEqual(r.j.groups.map((x) => x.id), [g.id]); assert.strictEqual(r.j.betLock, 1);
});
test('D2 if every try fails, opening Groups (and the bet status before that) rebuilds the missing entry from the group row, which is the truth', async () => {
  fresh(); const g = await mk('ann', {}, { auto: false }); await call('bob', 'join', { code: g.code }); const req = (await call('ann', 'get', { id: g.id })).j.group.reqs[0];
  X.failKey = 'lock:gm:' + MKOF(E('bob')); X.failN = 99; let r = await call('ann', 'decide', { id: g.id, pid: req.pid, ok: true }); assert.strictEqual(r.s, 200, 'the approval itself stands'); assert.ok(r.j.group.members.length === 2);
  assert.ok(!X.db[X.failKey].data.g.includes(g.id), 'the index entry is missing (the old code left bob stranded here: approved, but no group on his phone)'); X.failN = 0;
  r = await call('bob', 'bet/status', {}); assert.deepStrictEqual(r.j, { betLock: 1, canBet: true }, 'his next bet already goes to the group'); NOW = START - 5 * H; assert.strictEqual((await add('bob', bet('r1', '502', 'KC', 'ml', 130, 10))).j.text, 'Saved to your group.');
  r = await call('bob', 'mine', {}); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j.groups.map((x) => x.id), [g.id], 'opening Groups shows the group'); assert.deepStrictEqual(r.j.pending, []); assert.strictEqual(r.j.betLock, 1);
  const ix = X.db[X.failKey].data; assert.ok(ix.g.includes(g.id) && !ix.q.includes(g.id), 'and the index entry is back');
  X.failKey = 'lock:gm:' + MKOF(E('cat')); X.failN = 99; r = await call('cat', 'mine', {}); assert.strictEqual(r.s, 200, 'a failing index never breaks opening Groups'); assert.deepStrictEqual(r.j.groups, []);
});

// =============================== V. activity events to My Apps (events.js), Nov 16 2026 ===============================
const evs = (type) => EVS.filter((x) => x.type === type);
test('V1 a group is created: ONE group_new event, after the write, with the creator\'s account; a refused create makes none', async () => {
  fresh(); let r = await call('ann', 'create', { name: 'x', join: {}, contest: CDEF }); assert.strictEqual(r.s, 400); assert.strictEqual(EVS.length, 0, 'a refused create tells nobody');
  const g = await mk('ann'); assert.strictEqual(EVS.length, 1, JSON.stringify(EVS)); const e = EVS[0];
  assert.strictEqual(e.type, 'group_new'); assert.strictEqual(e.title, 'New group: ' + g.name); assert.strictEqual(e.account, E('ann')); assert.strictEqual(e.key, 'group_new|' + g.id); assert.match(e.detail, /^Started by ANNname\. Up to 8 people\.$/);
  assert.ok(X.db['lock:grp:' + g.id], 'the group row was written before the event');
  EVS.length = 0; await mk('owner'); assert.strictEqual(EVS.length, 1); assert.strictEqual(EVS[0].account, undefined, 'the owner-PIN sign-in has no account email: none is sent');
});
test('V2 joining: ONE group_join per person who really joins (direct link, or approved by the commissioner); a request, a denial, a repeat join and a refused join make none', async () => {
  fresh(); const g = await mk('ann'); EVS.length = 0;
  let r = await call('bob', 'join', { code: g.code }); assert.strictEqual(r.s, 200); assert.strictEqual(EVS.length, 1, JSON.stringify(EVS));
  assert.deepStrictEqual(EVS[0], { type: 'group_join', account: E('bob'), title: 'Joined group: ' + g.name, detail: 'BOBname joined with the invite link. 2 in the group.', key: 'group_join|' + g.id + '|' + MKOF(E('bob')) });
  r = await call('bob', 'join', { code: g.code }); assert.strictEqual(r.s, 200); assert.strictEqual(EVS.length, 1, 'already a member: joining again is not a join');
  r = await call('cat', 'join', { code: 'ZZZZ-ZZZZ' }); assert.strictEqual(r.s, 404); assert.strictEqual(EVS.length, 1, 'a wrong code tells nobody');
  // the members' link asks first: no event for the request, one when the commissioner approves, none for a denial
  r = await call('cat', 'join', { code: g.link }); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.pending, true); assert.strictEqual(EVS.length, 1, 'a request is not a join');
  r = await call('dan', 'request', { id: g.id }); assert.strictEqual(r.s, 200); assert.strictEqual(EVS.length, 1);
  const reqs = (await call('ann', 'get', { id: g.id })).j.group.reqs, pidOf = (n) => reqs.find((q) => q.name === n).pid;
  r = await call('bob', 'decide', { id: g.id, pid: pidOf('CATname'), ok: true }); assert.strictEqual(r.s, 403); assert.strictEqual(EVS.length, 1, 'only the commissioner approves');
  r = await call('ann', 'decide', { id: g.id, pid: pidOf('CATname'), ok: true }); assert.strictEqual(r.s, 200); assert.strictEqual(EVS.length, 2, JSON.stringify(EVS));
  assert.deepStrictEqual(EVS[1], { type: 'group_join', account: undefined, title: 'Joined group: ' + g.name, detail: 'CATname was approved by the commissioner. 3 in the group.', key: 'group_join|' + g.id + '|' + MKOF(E('cat')) });
  r = await call('ann', 'decide', { id: g.id, pid: pidOf('DANname'), ok: false }); assert.strictEqual(r.s, 200); assert.strictEqual(EVS.length, 2, 'a denial is not a join');
  assert.strictEqual(evs('group_new').length, 0); assert.strictEqual(evs('contest_start').length, 0);
});
test('V3 a contest reaching its start: the tick tells it ONCE (not before the start, not again on later ticks, not for a contest that started more than 12 hours ago)', async () => {
  fresh(); const g = await mk('ann', { start: START }); await joinAll(g, ['bob']); EVS.length = 0; const k = 'contest_start|' + g.id + ':' + g.contests[0].cid;
  NOW = START - 10 * 60e3; await G.tick({ force: true }); assert.strictEqual(EVS.length, 0, 'not before the start');
  NOW = START + 60e3; await G.tick({ force: true }); assert.strictEqual(EVS.length, 1, JSON.stringify(EVS));
  assert.deepStrictEqual(EVS[0], { type: 'contest_start', account: undefined, title: 'Contest started: Picks', detail: 'Group: ' + g.name + '. 2 in the group.', key: k });
  NOW += 5 * 60e3; await G.tick({ force: true }); await G.tick(); NOW += H; await G.tick({ force: true }); assert.strictEqual(EVS.length, 1, 'later ticks say nothing more');
  G._reset(); NOW = START + 2 * H; await G.tick({ force: true }); assert.strictEqual(EVS.length, 2, 'after a restart inside 12 hours it is sent again with the SAME key (My Apps drops the repeat)'); assert.strictEqual(EVS[1].key, k);
  G._reset(); NOW = START + 13 * H; await G.tick({ force: true }); assert.strictEqual(EVS.length, 2, 'a restart later than 12 hours after the start announces nothing');
});
test('V4 Groups OFF (dark): no event from any route or from the tick, for any caller; and an events module that throws can never break a Groups answer', async () => {
  fresh({}); for (const w of [null, 'owner', 'steve', 'ann']) for (const op of OPS.concat(['on', 'bet/status', 'invite', 'preview'])) await call(w, op, { name: 'Dark group', id: 'ABCDEFGHJK', code: 'ABCD-EFGH', join: {}, contest: CDEF });
  NOW = START + 60e3; assert.deepStrictEqual(await G.tick({ force: true }), { off: true }); assert.strictEqual(EVS.length, 0, 'dark = no events: ' + JSON.stringify(EVS)); assert.strictEqual(X.reads + X.writes + X.fetches, 0, 'and no database or outside call');
  fresh(); D.ev = () => { throw new Error('events module broken'); }; const g = await mk('ann'); assert.ok(g.id, 'create still answers'); assert.strictEqual((await call('bob', 'join', { code: g.code })).s, 200);
  D.ev = () => ({ emit: () => { throw new Error('emit broken'); } }); assert.strictEqual((await call('cat', 'join', { code: g.code })).s, 200); NOW = START + 60e3; assert.ok((await G.tick({ force: true })).observed >= 0, 'the tick still runs');
});
test('V5 with the REAL events.js: a group name is user text, so what reaches My Apps is cut to length and holds no email and no long number; nothing is sent when My Apps is not set up', async () => {
  const EV = require('./events'), sent = [], keep = Object.assign({}, EV._deps), gap = EV._cfg.gap; EV._reset(); EV._cfg.gap = 1; delete process.env.EVENTS_ENABLED;
  try {
    fresh(); D.ev = () => EV; EV._deps.maReady = () => false; EV._deps.ma = async (p, d) => { sent.push([p, d]); return { ok: true, status: 200, j: { ok: true } }; };
    await mk('ann'); await new Promise((r) => setTimeout(r, 40)); assert.strictEqual(sent.length, 0, 'My Apps not set up: nothing is sent');
    EV._deps.maReady = () => true;
    let r = await call('ann', 'create', { name: 'Call 9565551234 x@y.com now', take: { kind: 'none', v: 0 }, join: { requests: true, auto: true, max: 8, late: 'no' }, contest: CDEF }); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
    for (let i = 0; i < 100 && sent.length < 1; i++) await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(sent.length, 1); const [p, d] = sent[0]; assert.strictEqual(p, '/api/v1/event'); assert.strictEqual(d.type, 'group_new'); assert.strictEqual(d.account, E('ann'));
    for (const t of [d.title, d.detail]) { assert.ok(!/\d{7,}/.test(t) && !/@/.test(t), 'clean text: ' + t); } assert.ok(d.title.length <= 80 && d.detail.length <= 160); assert.match(d.title, /^New group: Call/);
  } finally { Object.assign(EV._deps, keep); EV._cfg.gap = gap; EV._reset(); }
});

// =============================== E. decide before public launch (NOT changed in Phase 1) ===============================
open('H1 a moneyline on a game with NO odds on ESPN must not pay even money to a heavy favourite', 'DECIDE BEFORE PUBLIC LAUNCH (owner). Today: no reference price = even money at most, so a 42-point favourite typed at +100 is paid +100. Fix to decide: such a bet does not count (or counts only at a price a second source confirms). Pricing rule: needs the owner\'s word.', async () => {
  fresh(); const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H; assert.strictEqual((await add('bob', bet('fav', '501', 'NYG', 'ml', 100, 100))).s, 200);
  const v = await view('bob', g, START + 2 * DAY); assert.ok(!(v.by.fav && v.by.fav.pl === 100), 'NYG won 45-3 with nothing posted and the bet paid +100: ' + JSON.stringify(v.by.fav));
});
open('H2 an honor-system contest must not take the phone\'s win AMOUNT at face value', 'DECIDE BEFORE PUBLIC LAUNCH (owner). Today: with the honor rule on, a bet the server cannot check counts with the result AND the dollar amount the phone reports. Fix to decide: keep the phone\'s won / lost, but work the amount out on the server from the bet\'s own price, capped by "Longest odds that count".', async () => {
  fresh(); const g = await mk('ann', { honor: true, entry: 0 }) /* main-line port: honor props only in a free contest */; await joinAll(g, ['bob']); NOW = START - 5 * H; const p = { id: 'hp', kind: 'prop', text: 'Mahomes over 250.5 passing yards', odds: -110, stake: 1, day: '2026-11-22', lg: 'nfl', pp: { gid: '502' } };
  assert.strictEqual((await add('bob', p)).s, 200); const cur = X.db[SID.bob]; cur.data = S.merge(cur.data, { bets: [Object.assign({}, p, { res: 'won', fin: 'won', finPL: 1000000 })] }, NOW + 1, cur.updated); cur.updated = NOW + 1;
  const v = await view('bob', g, START + 2 * DAY); assert.ok(!(v.by.hp && v.by.hp.pl >= 1000), 'a $1 prop "won" $' + (v.by.hp && v.by.hp.pl));
});
open('H4 a member who is not marked paid must not be shown as owed a prize', 'DECIDE BEFORE PUBLIC LAUNCH (owner). Today: the prize pool only holds the entries marked paid, but an unpaid member who finishes first is still shown as owed first prize (out of the others\' entries). Fix to decide: only members marked paid can be owed; the place passes to the next paid member, or the screen says "pay your entry to be eligible".', async () => {
  fresh(); const g = await mk('ann', { split: '100' }); await joinAll(g, ['bob', 'cat']); const full = (await call('ann', 'get', { id: g.id })).j.group;
  for (const m of full.members.filter((x) => x.name !== 'BOBname')) assert.strictEqual((await call('ann', 'paid', { id: g.id, pid: m.pid, paid: true })).s, 200); // bob never pays
  NOW = START - 5 * H; assert.strictEqual((await add('bob', bet('w1', '502', 'KC', 'ml', 130, 100))).s, 200); assert.strictEqual((await add('cat', bet('l1', '502', 'BUF', 'ml', -150, 100))).s, 200);
  const v = await view('bob', g, START + 2 * DAY); assert.strictEqual(v.row.place, 1); assert.strictEqual(v.row.owed, 0, 'unpaid bob is shown as owed $' + v.row.owed);
});

srv.listen(0, '127.0.0.1', async () => {
  P = srv.address().port; let bad = 0;
  for (const [n, f] of tests) { try { await f(); console.log('  PASS ' + n); } catch (e) { bad++; console.log('  FAIL ' + n + '\n        ' + String((e && e.message) || e).split('\n').slice(0, 10).join('\n        ')); } }
  skips.forEach(([n, why]) => console.log('  SKIP ' + n + '\n        ' + why));
  ENV({}); console.log(bad ? '\n' + bad + ' OF ' + tests.length + ' PHASE-1 CHECKS FAILED' : '\nALL ' + tests.length + ' PHASE-1 CHECKS PASSED' + (skips.length ? ' (' + skips.length + ' skipped on purpose: owner decisions, see above)' : '')); srv.close(); process.exit(bad && process.env.ODD_RUN_OPEN !== '1' ? 1 : 0);
});
