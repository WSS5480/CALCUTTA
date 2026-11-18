// Run: node odds-api/groups.nocontest.test.js — v284: a Golf group is created with NO picks contest ({noContest:true}). Borrowed set-up of groups.owner.test.js.
// (older header) node odds-api/groups.owner.test.js — owner rules of Nov 16 2026: G16 (group bets save to the server when added, then are locked),
// S-ALL (every group contest result reaches the player's dashboard through statsFor, from server records) and P1 (/groups/partners).
// No network, no database: in-memory fakes like groups.test.js.
const PH = require('./groups.testenv'); // Phase 1: switches set to "Groups open"; phone-file checks run only where the Groups phone code exists (see that file)
const assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path');
const G = require('./groups'), GR = require('./grade'), S = require('./sync'), D = G._deps;
let db = {}, writes = {}, DOWN = false;
D.S = {
  dbGet: async (id) => { await new Promise((r) => setImmediate(r)); return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; },
  dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); writes[row.id] = (writes[row.id] || 0) + 1; },
  dbPatchIf: async (id, was, data, upd) => { if (DOWN) throw new Error('db write 503'); if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; writes[id] = (writes[id] || 0) + 1; return true; },
  dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')),
};
const WHO = ['ann', 'bob', 'cat', 'dan', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jo'], SID = {}, NAMES = {};
WHO.forEach((w, i) => { SID[w] = (String.fromCharCode(97 + i).repeat(8) + '0'.repeat(56)); NAMES[SID[w].slice(0, 8)] = w.toUpperCase() + 'name'; });
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable';
D.acct = () => ({ who: (req) => { const w = String(req.headers['x-token'] || '').replace(/^t-/, ''); return SID[w] ? pe(SID[w]) : w === 'owner' ? 'owner' : null; }, phoneEmail: pe, isOwnerPhone: () => false,
  ownerOk: (req) => String(req.headers['x-token']) === 't-owner', namesGet: async () => NAMES, ownerName: () => 'Sir Oddable' });
D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1'); D.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Z = (s) => Date.parse(s), H = 3600e3, DAY = 864e5, START = Z('2026-11-22T18:00:00Z');
const T = (abbr, name) => ({ abbr, name, short: name.split(' ').pop(), loc: name.split(' ').slice(0, -1).join(' ') });
const ODDS = { details: 'BUF -2.5', overUnder: 47.5, spread: -2.5, overOdds: -110, underOdds: -110, awayTeamOdds: { moneyLine: 130, spreadOdds: -110, favorite: false }, homeTeamOdds: { moneyLine: -150, spreadOdds: -110, favorite: true } };
const GAMES = [
  { id: '501', start: START, away: T('DAL', 'Dallas Cowboys'), home: T('NYG', 'New York Giants'), as: 20, hs: 24 }, // no odds on ESPN
  { id: '502', start: START + 3 * H, away: T('KC', 'Kansas City Chiefs'), home: T('BUF', 'Buffalo Bills'), as: 27, hs: 24, odds: ODDS },
  { id: '503', start: Z('2026-11-29T18:00:00Z'), away: T('GB', 'Green Bay Packers'), home: T('CHI', 'Chicago Bears'), as: 14, hs: 21 },
  { id: '504', start: START, away: T('MIA', 'Miami Dolphins'), home: T('NE', 'New England Patriots'), as: 0, hs: 0, off: 'STATUS_POSTPONED' },
];
const ymd = (ms) => GR.chiDay(ms).replace(/-/g, '');
D.fetch = async (u) => {
  const m = /sports\/football\/nfl\/scoreboard\?dates=(\d{8})/.exec(u);
  const evs = !m ? [] : GAMES.filter((g) => ymd(g.start) === m[1]).map((g) => { const now = D.now(), st = g.off ? (now < g.start ? 'pre' : 'post') : now < g.start ? 'pre' : now < g.start + 3.5 * H ? 'in' : 'post';
    const tm = (t) => ({ abbreviation: t.abbr, displayName: t.name, shortDisplayName: t.short, location: t.loc });
    return { id: g.id, date: new Date(g.start).toISOString(), status: { type: { state: st, completed: !g.off && st === 'post', name: g.off || (st === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED') } },
      competitions: [{ odds: g.odds ? [g.odds] : undefined, competitors: [{ homeAway: 'home', score: st === 'pre' ? '0' : String(g.hs), team: tm(g.home) }, { homeAway: 'away', score: st === 'pre' ? '0' : String(g.as), team: tm(g.away) }] }] }; });
  return { ok: true, json: async () => ({ events: evs }) };
};
let NOW = START - 3 * DAY; D.now = () => NOW;
const GLB = (b, u) => (b && b.src !== 'kalshi' && b.gl === undefined ? Object.assign({ gl: b.sa > 0 ? b.sa : u }, b) : b); // G16: stamped like /groups/bet/add (gl: 0 = phone-only)
// Round 3: the ONE way a bet counts is the server add step, which writes the member's BOOK ('lock:gb:<memberKey>'). This helper plays that step for a whole
// list of bets at time u (it also keeps the synced row, as My Bets would have it). A bet with gl: 0 is a phone-only bet: it is not in the book.
const MKOF = (e) => require('crypto').createHash('sha256').update('oddable-group|' + e).digest('hex').slice(0, 24);
const SEEN = []; // the server reads a new bet's pregame reference when it is added: the helper replays that with one forced tick at the add time
const BOOKPUT = (sid, bets, u) => { SEEN.push(u); const b = {}; bets.forEach((x) => { if (!x || x.id == null) return; const at = Number(x.gl) > 0 ? Number(x.gl) : x.gl === 0 ? 0 : (Number(x.sa) > 0 ? Number(x.sa) : u); if (!(at > 0)) return; const s = Object.assign({}, x); ['gl', 'sa', 't', 'res', 'fin', 'finPL', 'auto', 'cash', 'soldN'].forEach((k) => delete s[k]); b[String(x.id)] = { s, at }; }); db['lock:gb:' + MKOF(pe(sid))] = { id: 'lock:gb:' + MKOF(pe(sid)), salt: 'x', pinhash: 'x', data: { b }, updated: u }; };
const row = (w, bets, U) => { const u = U == null ? START - 2 * H : U; BOOKPUT(SID[w], bets, u); db[SID[w]] = { id: SID[w], salt: 's', pinhash: 'h', data: { bets: bets.map((b) => GLB(b, u)) }, updated: u }; };
const srv = http.createServer(async (req, res) => { if (!(await G.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P; const call = async (who, op, b) => { if (SEEN.length) { const keep = NOW, us = [...new Set(SEEN.splice(0))].sort((x, y) => x - y); for (const u of us) { if (u < keep) { NOW = u; await G.tick({ force: true }); } } NOW = keep; } const r = await fetch('http://127.0.0.1:' + P + '/groups/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '', 'x-ip': '9.9.9.' + WHO.indexOf(who) }, body: JSON.stringify(b || {}) }); return { s: r.status, j: await r.json() }; };
const CDEF = { cname: 'Picks', sport: 'nfl', fmt: 'standings', start: START - H, runs: 'w4', kalshi: false, honor: false, types: { sp: true, ml: true, ou: true, prop: true, parlay: true }, legs: 3, metric: 'win', minBets: 0, minPaid: 0, cap: 0, entry: 25, split: '100' };
const mk = async (who, c, join) => { NOW = START - 3 * DAY; G._reset(); const r = await call(who, 'create', { name: 'G' + Math.random().toString(36).slice(2, 7), take: { kind: 'none', v: 0 }, join: Object.assign({ requests: true, open: false, auto: true, max: 8, late: 'no' }, join || {}), contest: Object.assign({}, CDEF, c || {}) }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); return r.j.group; };
const joinAll = async (g, ws) => { for (const w of ws) { const r = await call(w, 'join', { code: g.code }); assert.strictEqual(r.s, 200, w + ' join ' + JSON.stringify(r.j)); } };
const mine = async (w, g) => { NOW = START + 2 * DAY; G._reset(); const st = await call(w, 'standings', { id: g.id, cid: g.contests[0].cid }); assert.strictEqual(st.s, 200, JSON.stringify(st.j)); const me = st.j.rows.find((x) => x.name === w.toUpperCase() + 'name'); const p = await call(w, 'player', { id: g.id, cid: g.contests[0].cid, pid: me.pid }); return { row: me, bets: p.j.bets, t: p.j.t }; };
const bet = (id, gid, side, type, odds, stake, o) => { const g = GAMES.find((x) => x.id === gid); return Object.assign({ id, gid, lg: 'nfl', away: g.away.abbr, home: g.home.abbr, day: GR.chiDay(g.start), side, type, odds, stake, fin: 'won', finPL: 99999 }, o || {}); };
const TESTS = [];
const personal = (r, re) => { assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.personal, true, 'answered as a personal bet: ' + JSON.stringify(r.j)); assert.strictEqual(r.j.gl, 0, 'not locked'); assert.ok(!/Saved to your group/.test(JSON.stringify(r.j)), 'never told "Saved to your group"'); if (re) assert.match(r.j.why, re); return r; }; // Phase 1 (B2): the answer when no contest can count a bet
const test = (name, fn) => TESTS.push([name, fn]);

const mkG = async (who, b) => { NOW = START - 3 * DAY; G._reset(); return call(who, 'create', Object.assign({ name: 'Golf crew', take: { kind: 'none', v: 0 }, join: { requests: true, open: false, auto: true, max: 8, late: 'no' } }, b)); };
test('v284: noContest:true makes a group with NO picks contest; members can join; mine lists it; it is not "started" or "ended"', async () => {
  const r = await mkG('ann', { noContest: true }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); const g = r.j.group;
  assert.deepStrictEqual(g.contests, []); assert.strictEqual(g.nopicks, true); assert.strictEqual(g.started, false); assert.strictEqual(g.ended, false); assert.strictEqual(g.role, 'comm');
  assert.strictEqual((await call('bob', 'join', { code: g.code })).s, 200, 'a member can join');
  NOW += 400 * DAY; G._reset(); assert.strictEqual((await call('bob', 'join', { code: g.code })).s, 200, 'idempotent / still open a year later');
  const m = await call('ann', 'mine', {}); assert.strictEqual(m.s, 200); const x = m.j.groups.find((y) => y.id === g.id); assert.ok(x && x.nopicks && x.count === 2, JSON.stringify(m.j));
  assert.strictEqual((await call('ann', 'delete', { id: g.id })).s, 200, 'the commissioner can delete it');
});
test('v284: a normal create is unchanged (contest required, nopicks false); noContest must be exactly true; no contest and no flag still errors', async () => {
  let r = await mkG('ann', { contest: CDEF }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.group.contests.length, 1); assert.strictEqual(r.j.group.nopicks, false); assert.strictEqual(r.j.group.contests[0].kind, 'picks');
  r = await mkG('ann', {}); assert.strictEqual(r.s, 400, 'no contest, no flag: refused'); r = await mkG('ann', { noContest: 'yes' }); assert.strictEqual(r.s, 400, 'only the boolean true');
});
test('v284: mine never carries Infinity for a no-contest group', async () => {
  const g = (await mkG('ann', { noContest: true })).j.group; const r = await call('ann', 'mine', {}); assert.strictEqual(r.s, 200);
  assert.ok(!JSON.stringify(r.j).includes('Infinity'));
});
test('v284: the group is made FIRST; the commissioner adds the picks contest later, even after people joined (no entry); an entry or a second main pot is still refused', async () => {
  const g = (await mkG('ann', { noContest: true })).j.group; await call('bob', 'join', { code: g.code });
  const C = Object.assign({}, CDEF, { start: START, entry: 0, split: 'none' });
  let r = await call('bob', 'contest/add', { id: g.id, contest: C }); assert.strictEqual(r.s, 403, 'only the commissioner');
  r = await call('ann', 'contest/add', { id: g.id, contest: Object.assign({}, C, { entry: 25 }) }); assert.strictEqual(r.s, 409, 'an entry is not allowed after people joined');
  r = await call('ann', 'contest/add', { id: g.id, contest: C }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.group.nopicks, false); assert.strictEqual(r.j.group.contests.length, 1); assert.strictEqual(r.j.group.contests[0].kind, 'picks');
  assert.ok(Number.isFinite(r.j.group.start) && r.j.group.start >= START, 'a real start now');
  r = await call('ann', 'contest/add', { id: g.id, contest: C }); assert.strictEqual(r.s, 409, 'a second MAIN pot after people joined is still locked');
});

test('v285: a person runs at most 20 groups, no-contest groups count; a deleted one frees a place; the refusal says so', async () => {
  NOW = START - 3 * DAY; const ids = [];
  for (let i = 0; i < 20; i++) { G._reset(); const r = await call('ann', 'create', { name: 'Cap' + i, take: { kind: 'none', v: 0 }, noContest: true, join: { requests: true, open: false, auto: true, max: 8, late: 'no' } }); assert.strictEqual(r.s, 200, i + ' ' + JSON.stringify(r.j)); ids.push(r.j.group.id); }
  G._reset(); let r = await call('ann', 'create', { name: 'Cap21', take: { kind: 'none', v: 0 }, noContest: true, join: { requests: true, open: false, auto: true, max: 8, late: 'no' } });
  assert.strictEqual(r.s, 400); assert.ok(/You already run 20 groups\. Delete one to start another\./.test(JSON.stringify(r.j)), JSON.stringify(r.j));
  G._reset(); r = await call('bob', 'create', { name: 'Bobs', take: { kind: 'none', v: 0 }, noContest: true, join: { requests: true, open: false, auto: true, max: 8, late: 'no' } }); assert.strictEqual(r.s, 200, 'another person is not blocked');
  G._reset(); r = await call('ann', 'delete', { id: ids[0] }); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  G._reset(); r = await call('ann', 'create', { name: 'Cap22', take: { kind: 'none', v: 0 }, noContest: true, join: { requests: true, open: false, auto: true, max: 8, late: 'no' } }); assert.strictEqual(r.s, 200, 'a deleted group frees a place');
});

srv.listen(0, async () => {
  P = srv.address().port; let fail = 0;
  for (const [name, fn] of TESTS) { db = {}; writes = {}; WHO.forEach((w) => row(w, [])); G._reset(); G.limits._reset(); try { await fn(); console.log('  PASS', name); } catch (e) { fail++; console.log('  FAIL', name, '\n   ', e && e.stack || e); } }
  console.log(fail ? '\n' + fail + ' OF ' + TESTS.length + ' NO-CONTEST CHECKS FAILED' : '\nALL ' + TESTS.length + ' NO-CONTEST CHECKS PASSED'); process.exitCode = fail ? 1 : 0; srv.close();
});
