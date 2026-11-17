// Run: node odds-api/groups.owner.test.js — owner rules of Nov 16 2026: G16 (group bets save to the server when added, then are locked),
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
const OD2 = (details, ou) => ({ details, overUnder: ou, overOdds: -110, underOdds: -110, awayTeamOdds: { moneyLine: 140, spreadOdds: -110 }, homeTeamOdds: { moneyLine: -160, spreadOdds: -110 } });
const GAMES = [
  { id: '501', start: START, away: T('DAL', 'Dallas Cowboys'), home: T('NYG', 'New York Giants'), as: 20, hs: 24, odds: OD2('NYG -3', 41) }, // round 4: every game these checks bet on has a posted price (a bet with none is refused); 505 has none
  { id: '502', start: START + 3 * H, away: T('KC', 'Kansas City Chiefs'), home: T('BUF', 'Buffalo Bills'), as: 27, hs: 24, odds: ODDS },
  { id: '503', start: Z('2026-11-29T18:00:00Z'), away: T('GB', 'Green Bay Packers'), home: T('CHI', 'Chicago Bears'), as: 14, hs: 21, odds: OD2('CHI -3', 41) },
  { id: '504', start: START, away: T('MIA', 'Miami Dolphins'), home: T('NE', 'New England Patriots'), as: 0, hs: 0, off: 'STATUS_POSTPONED', offFrom: START - H, odds: OD2('NE -3', 40) }, // postponed an hour before kickoff
  { id: '505', start: START, away: T('DEN', 'Denver Broncos'), home: T('LV', 'Las Vegas Raiders'), as: 10, hs: 20 }, // nothing posted on ESPN
];
const ymd = (ms) => GR.chiDay(ms).replace(/-/g, '');
D.fetch = async (u) => {
  const m = /sports\/football\/nfl\/scoreboard\?dates=(\d{8})/.exec(u);
  const evs = !m ? [] : GAMES.filter((g) => ymd(g.start) === m[1]).map((g0) => { const now = D.now(), g = Object.assign({}, g0, { off: g0.off && !(g0.offFrom && now < g0.offFrom) ? g0.off : '' }), st = g.off ? (now < g.start ? 'pre' : 'post') : now < g.start ? 'pre' : now < g.start + 3.5 * H ? 'in' : 'post';
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
// Round 4 (the server as it runs live): (1) every book entry gets the game match the add step would have made at ITS OWN add time (G.addCheck; a bet the
// add step refuses stays unmatched and can never count); (2) the server ticks when a bet is added and 5 minutes before each kickoff.
const RMEMO = new Map(), TICKED = new Map();
const SERVERRAN = async () => { const keep = NOW; let stamp = '';
  for (const k of Object.keys(db)) { if (k.startsWith('lock:grp:')) stamp += k; if (!k.startsWith('lock:gb:')) continue; const B = (db[k].data && db[k].data.b) || {}; for (const id of Object.keys(B)) { const e = B[id]; stamp += k + id + e.at; if (e.r || !(e.at > 0)) continue; const mk = k + '|' + id + '|' + e.at + '|' + JSON.stringify(e.s); if (!RMEMO.has(mk)) { NOW = e.at; GR._reset(); let r = null; try { r = await G.addCheck(e.s, e.at); } catch (er) {} RMEMO.set(mk, r); } if (RMEMO.get(mk)) e.r = JSON.parse(JSON.stringify(RMEMO.get(mk))); } }
  const us = [...new Set(SEEN.splice(0).concat(GAMES.map((g) => g.start - 5 * 6e4)))].filter((u) => u < keep && TICKED.get(u) !== stamp).sort((x, y) => x - y);
  for (const u of us) { NOW = u; GR._reset(); await G.tick({ force: true }); TICKED.set(u, stamp); } NOW = keep; GR._reset(); };
const srv = http.createServer(async (req, res) => { if (!(await G.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P; const call = async (who, op, b) => { await SERVERRAN(); const r = await fetch('http://127.0.0.1:' + P + '/groups/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '', 'x-ip': '9.9.9.' + WHO.indexOf(who) }, body: JSON.stringify(b || {}) }); return { s: r.status, j: await r.json() }; };
const CDEF = { cname: 'Picks', sport: 'nfl', fmt: 'standings', start: START - H, runs: 'w4', kalshi: false, honor: false, types: { sp: true, ml: true, ou: true, prop: true, parlay: true }, legs: 3, metric: 'win', minBets: 0, minPaid: 0, cap: 0, entry: 25, split: '100' };
const mk = async (who, c, join) => { NOW = START - 3 * DAY; G._reset(); const r = await call(who, 'create', { name: 'G' + Math.random().toString(36).slice(2, 7), take: { kind: 'none', v: 0 }, join: Object.assign({ requests: true, open: false, auto: true, max: 8, late: 'no' }, join || {}), contest: Object.assign({}, CDEF, c || {}) }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); return r.j.group; };
const joinAll = async (g, ws) => { for (const w of ws) { const r = await call(w, 'join', { code: g.code }); assert.strictEqual(r.s, 200, w + ' join ' + JSON.stringify(r.j)); } };
const mine = async (w, g) => { NOW = START + 2 * DAY; G._reset(); const st = await call(w, 'standings', { id: g.id, cid: g.contests[0].cid }); assert.strictEqual(st.s, 200, JSON.stringify(st.j)); const me = st.j.rows.find((x) => x.name === w.toUpperCase() + 'name'); const p = await call(w, 'player', { id: g.id, cid: g.contests[0].cid, pid: me.pid }); return { row: me, bets: p.j.bets, t: p.j.t }; };
const bet = (id, gid, side, type, odds, stake, o) => { const g = GAMES.find((x) => x.id === gid); return Object.assign({ id, gid, lg: 'nfl', away: g.away.abbr, home: g.home.abbr, day: GR.chiDay(g.start), side, type, odds, stake, fin: 'won', finPL: 99999 }, o || {}); };
const TESTS = [];
const personal = (r, re) => { assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.personal, true, 'answered as a personal bet: ' + JSON.stringify(r.j)); assert.strictEqual(r.j.gl, 0, 'not locked'); assert.ok(!/Saved to your group/.test(JSON.stringify(r.j)), 'never told "Saved to your group"'); if (re) assert.match(r.j.why, re); return r; }; // Phase 1 (B2): the answer when no contest can count a bet
const test = (name, fn) => TESTS.push([name, fn]);


const addBet = (w, b) => call(w, 'bet/add', { bet: b });
const push = (w, incoming, at) => { const cur = db[SID[w]]; cur.data = S.merge(cur.data, incoming, at, cur.updated); cur.updated = at; }; // what /sync/push does with a phone's copy
test('G16: a group bet is saved by the server the moment it is added (server stamp, locked) and counts', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H;
  const r = await addBet('bob', bet('b1', '502', 'KC', 'ml', 130, 100, { gl: 1, sa: 1 })); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.gl, NOW); assert.strictEqual(r.j.text, 'Saved to your group.'); assert.strictEqual(r.j.note, 'Bets are final when you add them.');
  const st = db[SID.bob].data.bets.find((x) => x.id === 'b1'); assert.ok(st, 'in the server row'); assert.strictEqual(st.gl, NOW, 'the phone cannot choose the stamp'); assert.strictEqual(st.sa, NOW); assert.ok(!('fin' in st) && !('finPL' in st), 'the phone\'s own result is not stored by the add');
  const { bets, t } = await mine('bob', g); const b = bets.find((x) => x.id === 'b1'); assert.ok(b && b.ok && b.locked, JSON.stringify(b)); assert.strictEqual(b.res, 'won'); assert.strictEqual(t.n, 1);
});
test('G16: the server REJECTS AN EDIT (route 409; a synced edit or swap from any phone is ignored, even before kickoff)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H; assert.strictEqual((await addBet('bob', bet('b1', '502', 'BUF', 'ml', -150, 100))).s, 200);
  for (const op of ['bet/edit', 'bet/swap']) { const r = await call('bob', op, { bet: bet('b1', '502', 'KC', 'ml', 130, 500) }); assert.strictEqual(r.s, 409, op); assert.match(r.j.error, /final when you add them/); }
  NOW = START - 4 * H; push('bob', { bets: [bet('b1', '502', 'KC', 'ml', 130, 500, { t: NOW + 999, gl: 5 })] }, NOW); // still 4 hours before kickoff
  const st = db[SID.bob].data.bets.find((x) => x.id === 'b1'); assert.strictEqual(st.side, 'BUF'); assert.strictEqual(st.stake, 100); assert.strictEqual(st.odds, -150); assert.strictEqual(st.gl, START - 5 * H, 'stamp unchanged');
  const again = await addBet('bob', bet('b1', '502', 'KC', 'ml', 130, 500)); assert.strictEqual(again.s, 409, 'adding the same bet id again (a swap) is refused');
  const { bets } = await mine('bob', g); const b = bets.find((x) => x.id === 'b1'); assert.strictEqual(b.res, 'lost', 'graded as the bet that was added: BUF lost'); assert.strictEqual(b.pl, -100); assert.strictEqual(b.stake, 100);
});
test('G16: the server REJECTS A DELETE (route 409; a synced delete is dropped and the bet still counts)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H; assert.strictEqual((await addBet('bob', bet('b1', '502', 'BUF', 'ml', -150, 100))).s, 200);
  const r = await call('bob', 'bet/delete', { id: 'b1' }); assert.strictEqual(r.s, 409); assert.match(r.j.error, /cannot be edited, deleted or swapped/);
  NOW = START - 4 * H; push('bob', { bets: [], tomb: ['b1'] }, NOW);
  assert.ok(db[SID.bob].data.bets.some((x) => x.id === 'b1'), 'still in the server row'); assert.ok(!db[SID.bob].data.tomb.includes('b1'), 'its tombstone was dropped');
  const { bets, t } = await mine('bob', g); assert.ok(bets.find((x) => x.id === 'b1').ok); assert.strictEqual(t.win, -100, 'the losing bet could not be deleted away');
});
test('G16: an OFFLINE ADD IS NOT COUNTED (a bet that only reached the server through the phone\'s sync, even hours before kickoff, even claiming to be a group bet)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 6 * H;
  push('bob', { bets: [bet('off1', '502', 'KC', 'ml', 130, 100), bet('off2', '501', 'NYG', 'ml', -110, 100, { gl: NOW })] }, NOW);
  assert.ok(db[SID.bob].data.bets.every((x) => !(x.gl > 0)), 'a phone cannot mark its own bet as a group bet');
  const { bets, t } = await mine('bob', g); assert.strictEqual(bets.length, 0, 'not in the contest at all: ' + JSON.stringify(bets)); assert.strictEqual(t.n, 0); assert.strictEqual(t.win, 0);
});
test('G16: if the upload fails the bet is NOT placed (nothing stored, clear error); who can add', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H;
  DOWN = true; const r = await addBet('bob', bet('b9', '502', 'KC', 'ml', 130, 100)); DOWN = false; assert.notStrictEqual(r.s, 200); assert.ok(!db[SID.bob].data.bets.some((x) => x.id === 'b9'), 'nothing stored');
  personal(await addBet('cat', bet('c1', '502', 'KC', 'ml', 130, 100)), /not in a running group contest/); { const bk = db['lock:gb:' + MKOF(pe(SID.cat))]; assert.ok(!(bk && bk.data && bk.data.b && bk.data.b.c1) && !db[SID.cat].data.bets.some((x) => x.id === 'c1'), 'Phase 1 (B2): not in any contest = a personal bet; nothing written to a group book or to My Bets by the server (was a 409)'); }
  assert.strictEqual((await addBet('bob', bet('b2', '502', 'KC', 'ml', 130, 0))).s, 400, 'needs a stake');
  assert.strictEqual((await addBet('bob', { id: 'k1', src: 'kalshi', kt: 'KXNFLGAME-26NOV22KCBUF-KC', kind: 'prop', stake: 5, day: '2026-11-22' })).s, 400, 'Kalshi bets come through the Kalshi sync');
  assert.strictEqual((await call('', 'bet/add', { bet: bet('z', '502', 'KC', 'ml', 130, 5) })).s, 401, 'signed in only');
  PH.phoneCheck((ph) => { const cs = ph('pics/groups.js'), ix = ph('pics/index.html');
  assert.ok(cs.includes('Bets lock when you add them'), 'confirm step wording'); assert.ok(cs.includes('Not saved — try again'), 'failure wording'); assert.ok(/OddGroups/.test(ix) && /gPlace\(/.test(ix), 'My Bets sends new bets through the group add first'); });
});
test('G16: a bet added after its game started is REFUSED with an honest message (round 3); a void (postponed game) shows its reason to every member', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']); NOW = START - 5 * H; assert.strictEqual((await addBet('bob', bet('p1', '504', 'MIA', 'ml', 120, 100))).s, 200);
  NOW = START + H; const late = await addBet('bob', bet('late', '501', 'NYG', 'ml', -110, 100)); assert.strictEqual(late.s, 409); assert.match(late.j.error, /already started.*Nothing was added/);
  NOW = START + 3 * DAY; G._reset(); const st = await call('cat', 'standings', { id: g.id, cid: g.contests[0].cid }); const bob = st.j.rows.find((x) => x.name === 'BOBname');
  const p = await call('cat', 'player', { id: g.id, cid: g.contests[0].cid, pid: bob.pid }); const v = p.j.bets.find((x) => x.id === 'p1'); assert.ok(v, 'another member sees it'); assert.strictEqual(v.res, 'push'); assert.match(v.vr, /postponed or cancelled/);
  const own = await call('bob', 'player', { id: g.id, cid: g.contests[0].cid, pid: bob.pid }); assert.ok(!own.j.bets.some((x) => x.id === 'late'), 'the refused bet is nowhere');
  assert.strictEqual((await call('ann', 'bet/delete', { id: 'p1', pid: bob.pid })).s, 409, 'the commissioner has no other way to remove a bet');
});
test('S-ALL: statsFor gives each player\'s group contest result (picks, record, entry, payout, net) from SERVER records, not the phone', async () => {
  const g = await mk('ann', { entry: 25, split: '100' }); await joinAll(g, ['bob', 'cat']); for (const m of (await call('ann', 'get', { id: g.id })).j.group.members) assert.strictEqual((await call('ann', 'paid', { id: g.id, pid: m.pid, paid: true })).s, 200); NOW = START - 5 * H;
  assert.strictEqual((await addBet('bob', bet('b1', '502', 'KC', 'ml', 130, 100))).s, 200); assert.strictEqual((await addBet('bob', bet('b2', '501', 'DAL', 'ml', -110, 50))).s, 200); // KC won (+130), DAL lost (-50)
  assert.strictEqual((await addBet('cat', bet('c1', '502', 'BUF', 'ml', -150, 100))).s, 200); // lost
  push('bob', { bets: [bet('b2', '501', 'DAL', 'ml', -110, 50, { fin: 'won', finPL: 99999 })] }, START - 4 * H); // the phone claims a win
  NOW = START + 2 * DAY; await SERVERRAN(); G._reset(); let recs = await G.statsFor(pe(SID.bob), {}); let r = recs.find((x) => x.groupId === g.id); assert.ok(r, 'bob has a record');
  assert.strictEqual(r.src, 'groups'); assert.strictEqual(r.kind, 'contest'); assert.strictEqual(r.extra.record, '1-1-0'); assert.strictEqual(r.inner.pl, 80, 'server-graded: +130 - 50 (stats v1.1: the bets inside sit under inner)');
  assert.strictEqual(r.extra.picks.n, 2); assert.deepStrictEqual(r.extra.picks.list.map((x) => x.res).sort(), ['lost', 'won']); assert.ok(r.extra.picks.list.every((x) => x.locked && x.what && x.d));
  assert.deepStrictEqual(r.extra.money, { entry: 25, payout: 75, net: 50, final: false, paid: true }, 'running: "if it ended now" (3 x $25, winner takes all)'); assert.strictEqual(r.spent, 25); assert.strictEqual(r.won, undefined, 'no winnings booked while the contest runs');
  NOW = Z('2027-01-15T12:00:00Z'); G._reset(); r = (await G.statsFor(pe(SID.bob), {})).find((x) => x.groupId === g.id); assert.strictEqual(r.result, 'W'); assert.deepStrictEqual(r.extra.money, { entry: 25, payout: 75, net: 50, final: true, paid: true }); assert.strictEqual(r.won, 75);
  const c = (await G.statsFor(pe(SID.cat), {})).find((x) => x.groupId === g.id); assert.strictEqual(c.extra.record, '0-1-0'); assert.deepStrictEqual(c.extra.money, { entry: 25, payout: 0, net: -25, final: true, paid: true }); assert.strictEqual(c.result, 'L'); assert.strictEqual(c.extra.picks.n, 1);
  const a = (await G.statsFor(pe(SID.ann), {})).find((x) => x.groupId === g.id); assert.strictEqual(a.extra.picks.n, 0, 'a member with no picks still gets the record (entry, net)'); assert.strictEqual(a.extra.money.net, -25);
  const sp = '/home/claude/calcutta-stats/odds-api/stats.js'; if (fs.existsSync(sp)) { let V = null; try { V = require(sp).validate; } catch (e) {} if (V) [r, c, a].forEach((x) => { const v = V(x, 'groups'); assert.ok(v.ok, 'stats.js validate: ' + v.why); assert.strictEqual(v.rec.spent, 25); }); }
});
test('S-ALL: a long contest still fits the stats record (newest picks kept, count of the rest)', async () => {
  const g = await mk('ann', { maxBets: 0 }); await joinAll(g, ['bob']); NOW = START - 5 * H; row('bob', Array.from({ length: 70 }, (_, i) => bet('m' + i, i % 2 ? '502' : '501', i % 2 ? 'KC' : 'NYG', 'ml', -110, 5)));
  NOW = START + 2 * DAY; await SERVERRAN(); G._reset(); const r = (await G.statsFor(pe(SID.bob), {})).find((x) => x.groupId === g.id); assert.strictEqual(r.extra.picks.n, 70); assert.ok(JSON.stringify(r.extra).length <= 4000, 'extra ' + JSON.stringify(r.extra).length); assert.strictEqual(r.extra.picks.list.length + r.extra.picks.more, 70);
});
test('memberStats(viewerKey, groupId, pid) for stats.js: a member\'s group bets from server records; others see a bet only after its last game kicks off', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']); NOW = START - 5 * H;
  assert.strictEqual((await addBet('bob', bet('b1', '502', 'KC', 'ml', 130, 100))).s, 200); assert.strictEqual((await addBet('bob', bet('b2', '503', 'CHI', 'ml', -120, 60))).s, 200); // 503 kicks off Nov 29
  push('bob', { bets: [bet('pers', '501', 'NYG', 'ml', -110, 999)] }, NOW); // a personal (phone-only) bet: never in the group
  const pid = (await call('ann', 'get', { id: g.id })).j.group.members.find((m) => m.name === 'BOBname').pid;
  NOW = START + 2 * DAY; await SERVERRAN(); G._reset(); const other = await G.memberStats(pe(SID.cat), g.id, pid); assert.ok(other && !other.me); assert.strictEqual(other.name, 'BOBname'); assert.strictEqual(other.group.started, true);
  assert.deepStrictEqual(other.records.map((r) => r.title.slice(0, 2)), ['KC'], 'only the bet whose game has kicked off'); assert.strictEqual(other.hidden, 1); assert.strictEqual(other.records[0].result, 'W'); assert.strictEqual(other.records[0].pl, 130); assert.strictEqual(other.records[0].kind, 'bet'); assert.ok(other.records[0].extra.locked && other.records[0].extra.server);
  assert.ok(other.contest && other.contest.kind === 'contest' && !other.contest.extra.picks.list, 'contest record without the pick list for other viewers'); assert.ok(!JSON.stringify(other.records).includes('CHI'), 'the hidden pick is nowhere in the answer'); assert.ok(!('memberKey' in other) && !/memberKey|"mk"/.test(JSON.stringify(other)) && !JSON.stringify(other).includes(SID.bob.slice(0, 12)), 'round 3: no member key in the answer');
  const own = await G.memberStats(pe(SID.bob), g.id, pid); assert.ok(own.me); assert.strictEqual(own.records.length, 2); assert.strictEqual(own.hidden, 0); assert.ok(!own.records.some((r) => /NYG/.test(JSON.stringify(r)) || r.stake === 999), 'the personal bet is not a group bet ' + JSON.stringify(own.records));
  assert.strictEqual(await G.memberStats(pe(SID.eve), g.id, pid), null, 'not a member: null'); assert.strictEqual(await G.memberStats(pe(SID.cat), g.id, 'NOPE'), null); assert.strictEqual(await G.memberStats(pe(SID.cat), 'ZZZZZZZZZZ', pid), null);
  const sp = '/home/claude/calcutta-stats/odds-api/stats.js'; if (fs.existsSync(sp)) { let V = null; try { V = require(sp).validate; } catch (e) {} if (V) own.records.concat([own.contest]).forEach((x) => { const v = V(x, 'groups'); assert.ok(v.ok, 'stats.js validate: ' + v.why); }); }
});
test('JOIN BURST: 30 people open one invite link at the same moment (slow database, another server instance writing too): all 30 get in, nobody sees "Busy"', async () => {
  const big = Array.from({ length: 30 }, (_, i) => 'q' + String(i).padStart(2, '0')); big.forEach((w, i) => { SID[w] = (('0' + (i + 10).toString(16)).slice(-2).repeat(4) + 'e'.repeat(56)); NAMES[SID[w].slice(0, 8)] = w.toUpperCase() + 'name'; row(w, []); });
  let r = await call('owner', 'ent/admin', { op: 'enterprise', email: pe(SID.ann), on: true }); assert.strictEqual(r.s, 200); G.limits._reset();
  const g = await mk('ann', {}, { max: 50 }); const gk = 'lock:grp:' + g.id, real = D.S, slow = () => new Promise((x) => setTimeout(x, Math.random() * 12)); let outside = 6, lost = 0;
  D.S = Object.assign({}, real, { dbGet: async (id) => { await slow(); return real.dbGet(id); }, dbPatchIf: async (id, was, data, upd) => { await slow(); if (id === gk && outside > 0 && Math.random() < 0.5) { outside--; db[id].updated += 1; } const ok = await real.dbPatchIf(id, was, data, upd); if (!ok) lost++; return ok; } });
  try { const rs = await Promise.all(big.map((w, i) => fetch('http://127.0.0.1:' + P + '/groups/join', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': 't-' + w, 'x-ip': '7.7.' + i + '.1' }, body: JSON.stringify({ code: g.code }) }).then(async (x) => ({ s: x.status, j: await x.json() }))));
    rs.forEach((x, i) => assert.strictEqual(x.s, 200, big[i] + ': ' + JSON.stringify(x.j).slice(0, 120))); } finally { D.S = real; }
  const fin = (await call('ann', 'get', { id: g.id })).j.group; assert.strictEqual(fin.members.length, 31); assert.strictEqual(new Set(fin.members.map((m) => m.pid)).size, 31, 'one seat each, no duplicates'); assert.ok(lost <= 6, 'only the outside conflicts were redone: ' + lost);
});
test('JOIN BURST at the limit: 12 people race for the last 3 seats of an 8-person group: exactly 3 get in, 9 get the clear "full" message (never "Busy")', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat', 'dan', 'eve']); const ws = Array.from({ length: 12 }, (_, i) => 'q' + String(i).padStart(2, '0')); ws.forEach((w) => row(w, []));
  const rs = await Promise.all(ws.map((w, i) => fetch('http://127.0.0.1:' + P + '/groups/join', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': 't-' + w, 'x-ip': '8.8.' + i + '.1' }, body: JSON.stringify({ code: g.code }) }).then(async (x) => ({ s: x.status, j: await x.json() }))));
  assert.strictEqual(rs.filter((x) => x.s === 200).length, 3); const no = rs.filter((x) => x.s !== 200); assert.strictEqual(no.length, 9); no.forEach((x) => { assert.strictEqual(x.s, 409); assert.match(x.j.error, /full \(8 people\)/); assert.ok(!/Busy/.test(x.j.error)); });
  assert.strictEqual((await call('ann', 'get', { id: g.id })).j.group.members.length, 8);
});
test('RULES REVIEW: "most bets per week" (Best five default 10; set before start, locked after people join): only the first N bets a member adds for a week count', async () => {
  const g = await mk('ann', { fmt: 'best5' }); assert.strictEqual(g.contests[0].rules.maxBets, 10, 'Best five default'); const s0 = await mk('ann'); assert.strictEqual(s0.contests[0].rules.maxBets, 10, 'round 3: Standings also default to 10 a week');
  assert.strictEqual((await call('ann', 'create', { name: 'Bad', take: { kind: 'none', v: 0 }, join: { requests: true, open: false, max: 8, late: 'no' }, contest: Object.assign({}, CDEF, { maxBets: 3 }) })).s, 400, 'from the list only');
  const g5 = await mk('ann', { fmt: 'best5', maxBets: 5 }); await joinAll(g5, ['bob']);
  assert.strictEqual((await call('ann', 'contest/edit', { id: g5.id, cid: g5.contests[0].cid, contest: Object.assign({}, CDEF, { fmt: 'best5', maxBets: 20 }) })).s, 409, 'locked once someone joined');
  NOW = START - 6 * H; for (let i = 0; i < 8; i++) { NOW += 60e3; const r = await addBet('bob', i % 2 ? bet('v' + i, '502', 'KC', 'sp', -110, 10 + i, { line: 2.5 }) : bet('v' + i, '501', 'NYG', 'ml', -110, 10 + i)); if (i < 5) assert.strictEqual(r.s, 200, JSON.stringify(r.j)); else personal(r, /Over the weekly limit: only the first 5 bets/); }
  const { bets, t } = await mine('bob', g5); const ok = bets.filter((x) => x.ok).map((x) => x.id).sort(), over = bets.filter((x) => !x.ok);
  assert.deepStrictEqual(ok, ['v0', 'v1', 'v2', 'v3', 'v4'], 'the first five added'); assert.strictEqual(over.length, 0); assert.strictEqual(t.n, 5);
  PH.phoneCheck((ph) => { const cs = ph('pics/groups.js'); assert.ok(cs.includes('Most bets a week'), 'shown in the rules and the create screen'); });
});
test('RULES REVIEW: a Main Calcutta (or any attached game) reports into the group main pot through registerGame {potSummary, attachToGroup}; side games go with the side pots', async () => {
  const seen = []; let bids = 400;
  G.registerGame('calc', { potSummary: async (ref) => (ref === 'CALC-MAIN1' ? { bids, take: bids / 10, pool: bids * 0.9, main: true, paidOut: 0, inPlay: bids * 0.9, payouts: [{ pid: 'x', name: 'secret', spent: 1, won: 2 }] } : ref === 'CALC-SIDE1' ? { bids: 100, take: 0, pool: 100, main: false } : null), attachToGroup: async (ref, gid, cid) => { seen.push([ref, gid, cid]); return { id: ref } } });
  const g = await mk('ann', { entry: 25 }); const m0 = (await call('ann', 'get', { id: g.id })).j.group.members[0]; await call('ann', 'paid', { id: g.id, pid: m0.pid, paid: true });
  const a1 = await G.attachGame(g.id, pe(SID.ann), { type: 'calc', ref: 'CALC-MAIN1', name: 'Super Bowl Calcutta', pot: 'main' }); assert.strictEqual(a1.pot, 'main'); assert.deepStrictEqual(seen[0], ['CALC-MAIN1', g.id, a1.cid], 'the Calcutta was told its group and contest');
  const a2 = await G.attachGame(g.id, pe(SID.ann), { type: 'calc', ref: 'CALC-SIDE1', name: 'Side Calcutta', pot: 'main' }); // the game itself says main: false -> listed with the side pots
  let P = (await call('ann', 'get', { id: g.id })).j.group.pots;
  assert.strictEqual(P.main.pot, 25, 'picks entries marked paid'); assert.deepStrictEqual(P.main.games.map((x) => [x.name, x.pot, x.take, x.pool]), [['Super Bowl Calcutta', 400, 40, 360]]); assert.strictEqual(P.main.total, 425); assert.strictEqual(P.main.totalPool, 385); assert.strictEqual(P.main.totalTake, 40);
  assert.deepStrictEqual(P.sideGames.map((x) => [x.name, x.pot]), [['Side Calcutta', 100]]); assert.strictEqual(P.sideTotal, 100); assert.ok(!JSON.stringify(P).includes('secret'), 'no per-person Calcutta money in the group pot');
  assert.strictEqual(P.main.shares.find((x) => x.cid === g.contests[0].cid).amt, 25, 'the picks contest still splits only the picks entries (a Calcutta pays by its own table)');
  bids = 600; NOW += 31e3; P = (await call('ann', 'get', { id: g.id })).j.group.pots; assert.strictEqual(P.main.total, 625, 'follows the live auction (30-second cache)');
  const none = await mk('ann'); assert.deepStrictEqual((await call('ann', 'get', { id: none.id })).j.group.pots.main.games, []); assert.strictEqual((await call('ann', 'get', { id: none.id })).j.group.pots.main.total, 0);
  assert.throws(() => G.registerGame('calc', {}), /bad game type/);
});
test('LIMITS: limits.maxPeople(accountKey, groupOrGameId) is the one shared check: 8 standard, +owner seats per game, one Enterprise ceiling (500)', async () => {
  const L = G.limits, k = L.keyOf(pe(SID.ann)); assert.strictEqual(L.STANDARD, 8); assert.strictEqual(await L.maxPeople(k, 'any'), 8); assert.strictEqual(L.CEILING(), 500);
  assert.strictEqual((await call('owner', 'ent/admin', { op: 'enterprise', email: pe(SID.ann), on: true })).s, 200); L._reset(); assert.strictEqual(await L.maxPeople(k, 'any'), 500);
  assert.strictEqual(await L.maxPeople(L.keyOf(pe(SID.bob)), 'any'), 8, 'other accounts stay standard'); assert.match(L.ENTERPRISE_TEXT, /Need more than 8\?.*\$500\/month \+ \$20 per player per game/);
});
test('RULES REVIEW: parlay rows carry small honest labels (picks unchanged); v254 everywhere on the bump list', async () => {
  // Phase 1: a phone-only check (the preview build's parlay labels and its v254 markers). Main is at v256 with no Groups phone code, so it runs only against a 1e47e93 checkout.
  PH.phoneCheck((ph) => { const ix = ph('pics/index.html'), sp = ph('pics/sports.html'), sw = ph('pics/sw.js');
  assert.ok(ix.includes("two: 'About break-even over 12 seasons, tracked for fun'") && ix.includes("three: 'No long-run record yet'")); assert.ok((ix.match(/\$\{PLH\[(x\.kind|k)\]\}/g) || []).length >= 2, 'on the parlay row and on the season tile');
  assert.ok(ix.includes('<!-- Pics v254 -->') && ix.includes('>v254</span>') && ix.includes('Oddable v254 (') && !/\?v=253/.test(ix) && (ix.match(/\?v=254/g) || []).length >= 9, 'index.html'); assert.ok(/gate\.js\?v=254/.test(sp) && !/\?v=253/.test(sp), 'sports.html'); assert.ok(sw.includes("C='pics-v254'"), 'sw.js'); });
});
test('P1: /groups/partners suggests teams for the group (Balanced default, Rotate, Hot pairs), one-line reasons, saves nothing', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat', 'dan']); const before = JSON.stringify(db['lock:grp:' + g.id]);
  const pid = (n) => g2.members.find((m) => m.name === n.toUpperCase() + 'name').pid; const g2 = (await call('ann', 'get', { id: g.id })).j.group;
  const vals = { [pid('ann')]: 4, [pid('bob')]: 10, [pid('cat')]: 20, [pid('dan')]: 26 };
  let r = await call('bob', 'partners', { id: g.id, sport: 'golf', vals }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.mode, 'balanced'); assert.strictEqual(r.j.suggestions.length, 3);
  const top = r.j.suggestions[0]; assert.deepStrictEqual(top.teams.map((t) => t.names.slice().sort().join('+')).sort(), ['ANNname+DANname', 'BOBname+CATname']); assert.strictEqual(top.spread, 0); assert.ok(top.reason.length > 10 && top.reason.length < 160); assert.match(r.j.only, /suggestions/i);
  D.teamHistory = async () => [{ date: '2026-11-01', team: [pid('ann'), pid('dan')], result: 'W' }, { date: '2026-11-01', team: [pid('bob'), pid('cat')], result: 'L' }];
  r = await call('ann', 'partners', { id: g.id, sport: 'golf', mode: 'rotate', vals }); assert.strictEqual(r.j.suggestions[0].repeats, 0); assert.match(r.j.suggestions[0].reason, /All new partners/);
  r = await call('ann', 'partners', { id: g.id, sport: 'golf', mode: 'hot', vals }); assert.match(r.j.suggestions[0].reason, /ANNname \+ DANname are 1-0 as partners/); D.teamHistory = async () => [];
  r = await call('ann', 'partners', { id: g.id, sport: 'pickleball', teamSize: 2, guests: [{ name: 'Guest Gil', val: 1500 }, { name: 'Guest Hana' }] }); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.players.length, 6); assert.strictEqual(r.j.suggestions[0].teams.length, 3); assert.match(r.j.note, /no rating yet/);
  assert.strictEqual((await call('eve', 'partners', { id: g.id })).s, 404, 'members only'); assert.strictEqual(JSON.stringify(db['lock:grp:' + g.id]), before, 'nothing saved');
  assert.ok(!JSON.stringify(r.j).includes(SID.bob.slice(0, 12)), 'no sync ids');
});

srv.listen(0, async () => {
  P = srv.address().port; let fail = 0;
  for (const [name, fn] of TESTS) { db = {}; writes = {}; WHO.forEach((w) => row(w, [])); G._reset(); G.limits._reset(); try { await fn(); console.log('  PASS', name); } catch (e) { fail++; console.log('  FAIL', name, '\n       ', String(e.message).slice(0, 300)); } }
  console.log(fail ? '\n' + fail + ' OF ' + TESTS.length + ' OWNER-RULE CHECKS FAILED' : '\nALL ' + TESTS.length + ' OWNER-RULE CHECKS PASSED'); process.exitCode = fail ? 1 : 0; srv.close();
});
