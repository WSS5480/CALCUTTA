// Run: node odds-api/events.test.js   (no network: My Apps is a fake behind events.js _deps.ma, the database a fake behind fetch; the real events.js / sync.js / acct.js)
// Activity events to My Apps (Nov 16 2026): what is sent, what is never sent, and that it can never slow or break a request.
const assert = require('assert'), { EventEmitter } = require('events');
process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_KEY = 'k'; process.env.MYAPPS_URL = 'https://fake.myapps'; process.env.MYAPPS_SECRET = 'app-secret-for-tests';
delete process.env.GROUPS_ENABLED; delete process.env.EVENTS_ENABLED;
const J = (x) => JSON.stringify(x), C = (x) => JSON.parse(J(x)), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ---- fake PostgREST (table oddable_sync); any other outside call is an error ----
const DB = {}, OUT = [];
global.fetch = async (url, opt) => {
  url = String(url); opt = opt || {}; OUT.push(url); if (!url.startsWith('https://fake.supabase.co/rest/v1/oddable_sync')) throw new Error('unexpected outside call: ' + url);
  const q = new URL(url).searchParams, m = (opt.method || 'GET').toUpperCase(), eq = (k) => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  const ok = (j, s) => ({ ok: true, status: s || 200, json: async () => C(j), text: async () => J(j) });
  if (m === 'GET') { const id = eq('id'); return ok(id ? (DB[id] ? [DB[id]] : []) : Object.values(DB)); }
  if (m === 'POST') { const row = JSON.parse(opt.body), ign = /ignore-duplicates/.test((opt.headers || {}).Prefer || ''); if (DB[row.id] && ign) return ok([], 201); DB[row.id] = Object.assign({}, DB[row.id] || {}, row); return ok([], 201); }
  if (m === 'PATCH') { const id = eq('id'), was = eq('updated'); if (!DB[id] || (was != null && Number(DB[id].updated) !== Number(was))) return ok([]); Object.assign(DB[id], JSON.parse(opt.body)); return ok([DB[id]]); }
  throw new Error('fake db: ' + m);
};
const EV = require('./events'), S = require('./sync'), A = require('./acct');
const REAL = Object.assign({}, EV._deps), CFG0 = Object.assign({}, EV._cfg);
// fake My Apps: records every call; `answer` decides what it says
const M = { calls: [], answer: null, ready: true, now: null, logs: [] };
const OKA = { ok: true, status: 200, j: { ok: true } };
function fresh(o) {
  EV._reset(); Object.assign(EV._cfg, CFG0, { gap: 2 }, o || {}); M.calls = []; M.answer = null; M.ready = true; M.now = null; M.logs = []; delete process.env.EVENTS_ENABLED;
  EV._deps.ma = async (p, d) => { M.calls.push({ p, d: C(d), at: Date.now() }); const a = M.answer ? await M.answer(M.calls.length, d) : OKA; if (a instanceof Error) throw a; return a; };
  EV._deps.maReady = () => M.ready; EV._deps.now = () => (M.now == null ? Date.now() : M.now); EV._deps.log = (...a) => M.logs.push(a.join(' '));
}
const idle = async (ms) => { for (let i = 0; i < (ms || 2000) / 5; i++) { const s = EV._state(); if (!s.queued && !s.busy) { await sleep(8); const t = EV._state(); if (!t.queued && !t.busy) return; } await sleep(5); } throw new Error('events never went idle: ' + J(EV._state())); };
// My Apps' own test (store.js evContact, build .34), copied: what it answers 400 "contact" to
const MA_CONTACT = (t) => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(t) || /\d{7,}/.test(t) || /(?<!\d)\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}(?!\d)/.test(t);
const MA_NOTE = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
const okText = (t, max) => typeof t === 'string' && t.length <= max && !MA_CONTACT(MA_NOTE(t)) && MA_NOTE(t) === t && !/@/.test(t) && !/[\u0000-\u001f<>]/.test(t);
const tests = []; const test = (n, f) => tests.push([n, f]);

test('E1 the contract: POST /api/v1/event through ma() with type, title, and account / detail / key only when there are any; every allowed type; an unknown type or an empty title sends nothing', async () => {
  fresh(); assert.strictEqual(EV.emit('group_new', { account: 'Ab12@Phone.Oddable', title: 'New group: Sunday crew', detail: 'Started by Ann', key: 'group_new|ABC' }), true); await idle();
  assert.deepStrictEqual(M.calls.map((c) => [c.p, c.d]), [['/api/v1/event', { type: 'group_new', title: 'New group: Sunday crew', account: 'ab12@phone.oddable', detail: 'Started by Ann', key: 'group_new|ABC' }]]);
  fresh(); EV.emit('other', { title: 'Hello' }); await idle(); assert.deepStrictEqual(M.calls[0].d, { type: 'other', title: 'Hello' }, 'no empty account / detail / key fields');
  fresh(); assert.deepStrictEqual(EV.TYPES, ['bet_new', 'group_new', 'group_join', 'contest_start', 'calcutta_start', 'calcutta_sold', 'golf_start', 'pickleball_start', 'other']);
  EV.TYPES.forEach((t) => assert.strictEqual(EV.emit(t, { title: 'x' }), true, t)); await idle(); assert.deepStrictEqual(M.calls.map((c) => c.d.type), EV.TYPES);
  fresh(); for (const [t, o] of [['bet_deleted', { title: 'x' }], ['', { title: 'x' }], [null, { title: 'x' }], ['bet_new', {}], ['bet_new', { title: '   ' }], ['bet_new', { title: 'someone@example.com' }], ['bet_new', null], ['__proto__', { title: 'x' }], ['constructor', { title: 'x' }]]) assert.strictEqual(EV.emit(t, o), false, J([t, o]));
  await sleep(30); assert.strictEqual(M.calls.length, 0);
  fresh(); EV.emit('other', { title: 'x', account: 'not an email' }); EV.emit('other', { title: 'x', account: { a: 1 } }); EV.emit('other', { title: 'x', account: 'a@b.co\n' + 'x'.repeat(300) }); await idle(); M.calls.forEach((c) => assert.ok(!('account' in c.d), 'a bad account is left out, the event still goes: ' + J(c.d)));
});

test('E2 text My Apps would refuse never leaves: 80 / 160 characters, no 7+ digits in a row, no email address, no number written like a phone number (the check My Apps runs, copied), no tags or control characters (30,000 random texts too)', async () => {
  fresh();
  assert.strictEqual(EV.clean('  New   group:\n<b>Sunday</b>\tcrew  ', 80), 'New group: b Sunday /b crew');
  assert.strictEqual(EV.clean('Call 9565551234 now', 80), 'Call now'); assert.strictEqual(EV.clean('123456 ok', 80), '123456 ok', 'six digits stay');
  assert.strictEqual(EV.clean('mail steve@example.com today', 80), 'mail today'); assert.strictEqual(EV.clean('LAC@DEN', 80), 'LAC DEN', 'every @ goes, so nothing can read as an address');
  assert.strictEqual(EV.clean('12345a@b.co67890', 80), '', 'digits on both sides of an address cannot join into a long number');
  for (const [t, want] of [['call 956-555-1234 ok', 'call ok'], ['(956) 555-1234 called', 'called'], ['956.555.1234', ''], ['956 555 1234 x', 'x'], ['956\u200b555\u200b1234 x', 'x'], ['95\n6555-1234', '95 6555-1234'], ['1 956-555-1234', '1'], ['956-555-12345', '956-555-12345']]) { assert.strictEqual(EV.clean(t, 80), want, J(t)); assert.ok(!MA_CONTACT(EV.clean(t, 80))); }
  for (const t of ['Chiefs -3 (-110) $25.00', 'NFL · 2026-11-16 · 3 legs · pot 123456', 'LAC +4.5 (LAC at DEN)', 'Over 47.5 -110', 'To Rick for $1,250.50']) assert.strictEqual(EV.clean(t, 160), t, 'ordinary bet text is untouched: ' + t);
  assert.strictEqual(EV.clean('x'.repeat(500), 80).length, 80); assert.strictEqual(EV.clean('x'.repeat(500), 160).length, 160);
  for (const v of [null, undefined, {}, [], () => 1, Symbol.iterator, { toString() { throw new Error('boom'); } }, Object.create(null), true]) assert.strictEqual(EV.clean(v, 80), ''); assert.strictEqual(EV.clean(0, 80), '0'); assert.strictEqual(EV.clean(12.5, 80), '12.5');
  let s = 20261116; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }, bits = ['9565551234', '1234567', '123456', 'a@b.co', 'steve.smith+x@mail.example.org', '@', ' ', '.', '-', 'LAC', '+4.5', '\n', '<', '>', '\u0000', '１２３４５６７８', '99', 'é', '$250', '0', '956-555-1234', '(956) 555-1234', '956.555.', '555', '1234', '(', ')', '\u200b', '\ufeff', '2026-11-16', '-110'];
  for (let i = 0; i < 30000; i++) { let t = ''; const n = 1 + Math.floor(rnd() * 14); for (let k = 0; k < n; k++) t += bits[Math.floor(rnd() * bits.length)];
    const b = EV.build('other', { title: 'T ' + t, detail: t, account: t, key: t }); assert.ok(b && okText(b.title, 80), 'title ' + J(t) + ' -> ' + J(b)); if (b.detail !== undefined) assert.ok(okText(b.detail, 160) && b.detail.length > 0, 'detail ' + J(t) + ' -> ' + J(b.detail)); if (b.key !== undefined) assert.ok(b.key.length <= 120 && typeof b.key === 'string'); if (b.account !== undefined) assert.ok(b.account.length <= 200); }
});

test('E3 never in the request path, never throws: emit() returns before My Apps is called, with My Apps hanging, throwing, or the helper itself broken', async () => {
  fresh(); let called = 0; EV._deps.ma = () => { called++; return new Promise(() => {}); }; const t0 = Date.now();
  for (let i = 0; i < 50; i++) EV.emit('other', { title: 'n' + i }); assert.strictEqual(called, 0, 'nothing is sent inside emit()'); assert.ok(Date.now() - t0 < 50, '50 emits take no time');
  fresh(); EV._deps.ma = () => { throw new Error('sync throw'); }; assert.strictEqual(EV.emit('other', { title: 'a' }), true); await idle(); // swallowed
  fresh(); EV._deps.maReady = () => { throw new Error('boom'); }; assert.strictEqual(EV.emit('other', { title: 'a' }), false);
  fresh(); EV._deps.now = () => { throw new Error('clock'); }; assert.strictEqual(EV.emit('other', { title: 'a' }), false);
  fresh(); const evil = { get title() { throw new Error('getter'); } }; assert.strictEqual(EV.emit('other', evil), false); assert.strictEqual(EV.betsPushed('a@b.co', evil, evil), false); assert.strictEqual(typeof EV.calcuttaStarted(evil, evil, evil), 'boolean'); assert.strictEqual(typeof EV.calcuttaSold(evil, evil, evil, evil, evil), 'boolean'); assert.strictEqual(typeof EV.golfStarted(evil, evil, { get key() { throw new Error('k'); } }), 'boolean'); await idle(); M.calls.forEach((c) => assert.ok(!/object/.test(J(c.d)), 'an object is never sent as text: ' + J(c.d)));
  let unhandled = 0; const h = () => { unhandled++; }; process.on('unhandledRejection', h); fresh(); M.answer = async () => { throw new Error('rejected'); }; EV.emit('other', { title: 'a' }); await idle(); await sleep(20); process.removeListener('unhandledRejection', h); assert.strictEqual(unhandled, 0, 'no unhandled rejection');
});

test('E4 switches: nothing is sent (and nothing waits) when My Apps is not set up, or with EVENTS_ENABLED=0; default is ON', async () => {
  fresh(); M.ready = false; assert.strictEqual(EV.emit('other', { title: 'a' }), false); assert.strictEqual(EV.calcuttaStarted('G', 'A'), false); assert.strictEqual(EV._state().queued, 0); await sleep(30); assert.strictEqual(M.calls.length, 0);
  for (const v of ['0', ' 0 ', 'off', 'false', 'no', 'OFF']) { fresh(); process.env.EVENTS_ENABLED = v; assert.strictEqual(EV.enabled(), false, v); assert.strictEqual(EV.emit('other', { title: 'a' }), false); assert.strictEqual(EV.betsPushed('a@b.co', {}, { bets: [{ id: 1, t: Date.now() }] }), false); assert.strictEqual(EV._state().queued, 0); await sleep(15); assert.strictEqual(M.calls.length, 0, v); }
  for (const v of [undefined, '', '1', 'on', 'yes']) { fresh(); if (v === undefined) delete process.env.EVENTS_ENABLED; else process.env.EVENTS_ENABLED = v; assert.strictEqual(EV.enabled(), true, String(v)); assert.strictEqual(EV.emit('other', { title: 'a' }), true); await idle(); assert.strictEqual(M.calls.length, 1); }
  fresh({ gap: 40 }); for (let i = 0; i < 5; i++) EV.emit('other', { title: 'n' + i }); await sleep(10); process.env.EVENTS_ENABLED = '0'; await sleep(150); const n = M.calls.length; assert.ok(n <= 1, 'switched off while events wait: the rest are dropped, sent ' + n); assert.strictEqual(EV._state().queued, 0); delete process.env.EVENTS_ENABLED;
  // the real maReady: false without MYAPPS_URL / MYAPPS_SECRET
  fresh(); EV._deps.maReady = REAL.maReady; const u = process.env.MYAPPS_URL; delete process.env.MYAPPS_URL; assert.strictEqual(EV.emit('other', { title: 'a' }), false); process.env.MYAPPS_URL = u; assert.strictEqual(EV.emit('other', { title: 'a' }), true); await idle();
});

test('E5 a burst cannot hammer My Apps: 200 wait at most (the oldest are dropped), one send at a time, 100 ms apart by default', async () => {
  assert.strictEqual(CFG0.gap, 100); assert.strictEqual(CFG0.max, 200); assert.strictEqual(CFG0.wait, 5000); assert.strictEqual(CFG0.pause, 300000); assert.strictEqual(CFG0.fails, 3);
  fresh({ gap: 100 }); let live = 0, most = 0; M.answer = async () => { live++; most = Math.max(most, live); await sleep(15); live--; return OKA; };
  for (let i = 0; i < 1000; i++) EV.emit('other', { title: 'n' + i }); assert.strictEqual(EV._state().queued, 200); assert.strictEqual(EV._state().dropped, 800);
  await sleep(560); const n = M.calls.length; assert.ok(n >= 3 && n <= 6, 'about one per 100 ms: ' + n + ' in 560 ms'); assert.strictEqual(most, 1, 'never two at once');
  for (let i = 1; i < M.calls.length; i++) assert.ok(M.calls[i].at - M.calls[i - 1].at >= 95, 'gap ' + (M.calls[i].at - M.calls[i - 1].at));
  assert.strictEqual(M.calls[0].d.title, 'n800', 'the newest 200 are kept');
  EV._cfg.gap = 1; await idle(8000); assert.strictEqual(M.calls.length, 200); assert.strictEqual(M.calls[199].d.title, 'n999');
});

test('E6 every answer is swallowed: ok, dup, 400, 429 busy, 500, a thrown error; a refused event (400) is not sent again, a failed one gets one more try', async () => {
  fresh(); const seq = [OKA, { ok: true, status: 200, j: { ok: true, dup: true } }, { ok: false, status: 400, j: { error: 'bad' } }, OKA]; M.answer = async (n) => seq[n - 1] || OKA;
  ['a', 'b', 'c', 'd'].forEach((t) => EV.emit('other', { title: t })); await idle(); assert.deepStrictEqual(M.calls.map((c) => c.d.title), ['a', 'b', 'c', 'd'], 'a 400 is dropped and the queue goes on'); assert.strictEqual(EV._state().until, 0, 'no pause'); assert.strictEqual(EV._state().fails, 0);
  fresh(); const seq2 = [{ ok: false, status: 429, j: { error: 'busy' } }, OKA, { ok: false, status: 500, j: {} }, new Error('network'), OKA]; M.answer = async (n) => seq2[n - 1] || OKA;
  ['a', 'b', 'c'].forEach((t) => EV.emit('other', { title: t })); await idle(); assert.deepStrictEqual(M.calls.map((c) => c.d.title), ['a', 'a', 'b', 'b', 'c'], 'busy / 500 / error: tried once more, then dropped'); assert.strictEqual(EV._state().until, 0);
  fresh(); M.answer = async () => null; EV.emit('other', { title: 'a' }); await idle(); assert.strictEqual(M.calls.length, 2, 'a garbage answer counts as a failure, no crash');
});

test('E7 back off for 5 minutes after a 404 (My Apps has no route yet) and after three failures in a row; then it starts again by itself', async () => {
  fresh(); M.now = 1e12; M.answer = async () => ({ ok: false, status: 404, j: {} });
  ['a', 'b', 'c'].forEach((t) => EV.emit('other', { title: t })); await sleep(60); assert.strictEqual(M.calls.length, 1, 'one 404 and it stops'); assert.strictEqual(EV._state().until, 1e12 + 300000); assert.strictEqual(M.logs.length, 1);
  M.now += 299000; EV.emit('other', { title: 'd' }); await sleep(40); assert.strictEqual(M.calls.length, 1, 'still paused at 4 min 59 s');
  M.answer = null; M.now += 2000; await EV._drain(); await idle(); assert.deepStrictEqual(M.calls.map((c) => c.d.title), ['a', 'b', 'c', 'd'], 'after 5 minutes the waiting events go (the one that got the 404 is gone)');
  // three failures in a row
  fresh(); M.now = 2e12; M.answer = async () => { throw new Error('down'); }; ['a', 'b', 'c', 'd', 'e'].forEach((t) => EV.emit('other', { title: t })); await sleep(80);
  assert.strictEqual(M.calls.length, 3, 'three failed sends, then silence: ' + M.calls.length); assert.strictEqual(EV._state().until, 2e12 + 300000);
  // a success in between resets the count
  fresh(); let n = 0; M.answer = async () => (++n % 3 === 0 ? OKA : new Error('flaky')); for (let i = 0; i < 6; i++) EV.emit('other', { title: 'n' + i }); await idle(); assert.strictEqual(EV._state().until, 0, 'two failures, a success, two failures: no pause');
  // events that waited longer than 10 minutes are thrown away, not sent late
  fresh(); M.now = 3e12; M.answer = async () => ({ ok: false, status: 404, j: {} }); ['old1', 'old2', 'old3'].forEach((t) => EV.emit('other', { title: t })); await sleep(40); M.answer = null; M.now += 11 * 60000; EV.emit('other', { title: 'new' }); await EV._drain(); await idle();
  assert.deepStrictEqual(M.calls.map((c) => c.d.title), ['old1', 'new'], 'stale events are dropped');
});

test('E8 a send that does not answer is given up after the limit (5 s by default) and the queue moves on', async () => {
  fresh({ wait: 40 }); let n = 0; M.answer = () => (++n <= 2 ? new Promise(() => {}) : OKA); const t0 = Date.now();
  EV.emit('other', { title: 'hang' }); EV.emit('other', { title: 'next' }); await idle(); const ms = Date.now() - t0;
  assert.deepStrictEqual(M.calls.map((c) => c.d.title), ['hang', 'hang', 'next']); assert.ok(ms >= 75 && ms < 600, 'two 40 ms limits: ' + ms);
});

// ---------- new bets ----------
const NOW = 1794700000000, MIN = 60000;
const bet = (id, o) => Object.assign({ id, t: NOW - MIN, type: 'sp', side: 'LAC', line: 4.5, away: 'LAC', home: 'DEN', odds: -110, stake: 50, day: '2026-11-22' }, o || {});
test('E9 which bets count as new: in the stored result, not in the row before, and made in the last 15 minutes. Not edits, results, deletes, old history or junk', async () => {
  fresh(); const ids = (b, a) => EV.newBets(b, a, NOW).map((x) => String(x.id));
  assert.deepStrictEqual(ids({ bets: [] }, { bets: [bet('b1')] }), ['b1']); assert.deepStrictEqual(ids({}, { bets: [bet('b1'), bet('b2')] }), ['b1', 'b2']); assert.deepStrictEqual(ids(null, { bets: [bet(7)] }), ['7']);
  assert.deepStrictEqual(ids({ bets: [bet('b1')] }, { bets: [bet('b1', { t: NOW, line: 5.5 })] }), [], 'an edit is not a new bet');
  assert.deepStrictEqual(ids({ bets: [bet('b1')] }, { bets: [bet('b1', { t: NOW, res: 'won', fin: 'won', finPL: 45 })] }), [], 'a result is not a new bet');
  assert.deepStrictEqual(ids({ bets: [bet('b1'), bet('b2')] }, { bets: [bet('b2')], tomb: ['b1'] }), [], 'a delete is not a new bet');
  assert.deepStrictEqual(ids({ bets: [bet(1)] }, { bets: [bet('1')] }), [], 'ids compare as text, like the merge');
  assert.deepStrictEqual(ids({}, { bets: [bet('old', { t: NOW - 16 * MIN }), bet('edge', { t: NOW - 15 * MIN }), bet('new', { t: NOW - 14 * MIN })] }), ['edge', 'new'], 'older than 15 minutes = history');
  assert.deepStrictEqual(ids({}, { bets: Array.from({ length: 400 }, (_, i) => bet('h' + i, { t: NOW - 30 * 864e5 + i })) }), [], 'a new device uploading 400 old bets announces nothing');
  assert.deepStrictEqual(ids({}, { bets: [bet('f', { t: NOW + 16 * MIN }), bet('n', { t: undefined }), bet('z', { t: 0 }), bet('s', { t: 'soon' }), null, 5, 'x', { t: NOW }, bet('ok', { t: NOW + MIN })] }), ['ok'], 'no time, a wrong time, a far-future time, no id, junk: not counted');
  for (const v of [undefined, null, 5, 'x', [], { bets: 'no' }, { bets: { length: 3 } }]) { assert.deepStrictEqual(EV.newBets(v, v, NOW), []); assert.deepStrictEqual(EV.newBets({}, v, NOW), []); }
  const b = { bets: [bet('b1')] }, a = { bets: [bet('b1'), bet('b2')] }, jb = J(b), ja = J(a); Object.freeze(b); Object.freeze(a); Object.freeze(a.bets); a.bets.forEach(Object.freeze); EV.newBets(b, a, NOW); EV.betsPushed('p@phone.oddable', b, a); assert.strictEqual(J(b), jb); assert.strictEqual(J(a), ja, 'inputs are only read');
});

test('E10 the bet event: one per push, "Added 1 bet" / "Added N bets", a short line for the first bet, no stake or dollar amount, key = account + first new bet id', async () => {
  fresh(); M.now = NOW; const acct = 'ab12cd34ef56ab12cd34@phone.oddable';
  assert.strictEqual(EV.betsPushed(acct, { bets: [] }, { bets: [bet('b1794699940000')] }), true); await idle();
  assert.deepStrictEqual(M.calls[0].d, { type: 'bet_new', title: 'Added 1 bet', account: acct, detail: 'LAC +4.5 (LAC at DEN)', key: acct + '|b1794699940000' });
  fresh(); M.now = NOW; EV.betsPushed(acct, { bets: [bet('a')] }, { bets: [bet('a'), bet('p', { kind: 'parlay', legs: [{}, {}, {}], side: undefined }), bet('c'), bet('d')] }); await idle();
  assert.strictEqual(M.calls.length, 1, 'ONE event for the push'); assert.deepStrictEqual(M.calls[0].d, { type: 'bet_new', title: 'Added 3 bets', account: acct, detail: '3-leg parlay (first of 3)', key: acct + '|p' });
  fresh(); M.now = NOW; assert.strictEqual(EV.betsPushed(acct, { bets: [bet('a')] }, { bets: [bet('a', { res: 'won' })] }), false); assert.strictEqual(EV.betsPushed(acct, {}, { bets: [bet('a', { t: NOW - 3600e3 })] }), false); await sleep(20); assert.strictEqual(M.calls.length, 0, 'nothing new = no event');
  const T = (o) => EV.betText(bet('x', o));
  assert.strictEqual(T({}), 'LAC +4.5 (LAC at DEN)'); assert.strictEqual(T({ line: -3 }), 'LAC -3 (LAC at DEN)'); assert.strictEqual(T({ type: 'ml', line: undefined }), 'LAC ML (LAC at DEN)');
  assert.strictEqual(T({ type: 'ou', side: 'Over', line: 47.5 }), 'Over 47.5 (LAC at DEN)'); assert.strictEqual(T({ away: '', home: '' }), 'LAC +4.5');
  assert.strictEqual(T({ kind: 'prop', text: 'Mahomes over 275.5 pass yds $50 to win $45.45' }), 'Mahomes over 275.5 pass yds to win', 'dollar amounts typed into a bet text are taken out');
  assert.strictEqual(T({ kind: 'prop', text: 'Call me 9565551234 or x@y.com' }), 'Call me or'); assert.strictEqual(T({ kind: 'parlay', legs: [1, 2] }), '2-leg parlay'); assert.strictEqual(T({ kind: 'parlay', legs: undefined }), 'parlay');
  for (const k of ['stake', 'odds', 'pay', 'win', 'finPL']) assert.ok(!T({ [k]: 987 }).includes('987'), k + ' is never in the text');
  for (const v of [null, undefined, 5, 'x', {}, [], { side: {} }, { text: { a: 1 } }, { legs: 'no' }]) assert.strictEqual(typeof EV.betText(v), 'string');
  fresh(); M.now = NOW; EV.betsPushed('', {}, { bets: [bet('q', { side: undefined, text: undefined })] }); await idle(); assert.deepStrictEqual(M.calls[0].d, { type: 'bet_new', title: 'Added 1 bet', key: 'player|q' }, 'no account and nothing to describe: still a valid event');
});

// ---------- the real sync.js push ----------
const serve = (mod, urlPath, bodyObj) => new Promise((done) => {
  const req = new EventEmitter(); req.url = urlPath; req.method = 'POST'; req.headers = { 'x-forwarded-for': '5.5.5.5' }; req.socket = { remoteAddress: '5.5.5.5' };
  const out = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k] = v; }, end(s) { done({ status: this.statusCode, body: s, h: this.h }); } };
  Promise.resolve(mod.handle(req, out)).catch((e) => done({ status: 500, body: J({ error: String(e) }) }));
  setImmediate(() => { req.emit('data', Buffer.from(J(bodyObj))); req.emit('end'); });
});
const PHONE = '9565550101', PIN = '246810', wipe = () => { Object.keys(DB).forEach((k) => delete DB[k]); OUT.length = 0; };
const rowId = () => Object.keys(DB)[0];
test('E11 the real /sync/push: the event goes AFTER the answer, carries the phone account My Apps knows (acct.phoneEmail), and the answer + stored row are the same with events on, off, or My Apps failing', async () => {
  const run = async (mode) => {
    wipe(); fresh(); if (mode === 'off') process.env.EVENTS_ENABLED = '0'; if (mode === 'notready') M.ready = false; if (mode === 'throw') { EV._deps.ma = () => { throw new Error('x'); }; } if (mode === '404') M.answer = async () => ({ ok: false, status: 404, j: {} });
    const realNow = Date.now; let clock = NOW; Date.now = () => clock; const res = [];
    try {
      const steps = [['/sync/signup', { bets: [bet('h1', { t: NOW - 40 * 864e5 }), bet('h2', { t: NOW - 20 * MIN })] }], ['/sync/push', { bets: [bet('h1', { t: NOW - 40 * 864e5 }), bet('h2', { t: NOW - 20 * MIN }), bet('n1', { t: NOW - 1000 })] }],
        ['/sync/push', { bets: [bet('n1', { t: NOW + 5, res: 'won', fin: 'won', finPL: 45 })] }], ['/sync/push', { bets: [], tomb: ['h1'] }], ['/sync/push', { bets: [bet('n2', { t: NOW + 10, kind: 'parlay', legs: [{}, {}] }), bet('n3', { t: NOW + 11 })] }], ['/sync/pull', {}], ['/sync/push', { bets: [bet('n3', { t: NOW + 11 })] }]];
      for (const [p, data] of steps) { clock += 1000; const before = M.calls.length, r = await serve(S, p, { phone: PHONE, pin: PIN, data }); assert.strictEqual(M.calls.length, before, 'My Apps is not called before the answer is out (' + p + ')'); res.push([p, r.status, r.body, J(r.h)]); await new Promise((r2) => setImmediate(r2)); await sleep(15); }
    } finally { Date.now = realNow; }
    return { res, row: J(DB[rowId()].data) + '|' + DB[rowId()].updated, calls: M.calls.map((c) => c.d), db: OUT.filter((u) => u.startsWith('https://fake.supabase.co')).length };
  };
  const on = await run('on'), acct = A.phoneEmail(rowId());
  assert.match(acct, /^[0-9a-f]{20}@phone\.oddable$/);
  assert.deepStrictEqual(on.calls, [
    { type: 'bet_new', title: 'Added 1 bet', account: acct, detail: 'LAC +4.5 (LAC at DEN)', key: acct + '|n1' },
    { type: 'bet_new', title: 'Added 2 bets', account: acct, detail: '2-leg parlay (first of 2)', key: acct + '|n2' },
  ], 'sign-up history, a result, a delete, a pull and an unchanged push announce nothing');
  for (const mode of ['off', 'notready', 'throw', '404']) { const o = await run(mode); assert.deepStrictEqual(o.res, on.res, 'answers identical: ' + mode); assert.strictEqual(o.row, on.row, 'stored row identical: ' + mode); assert.strictEqual(o.db, on.db, 'same database calls: ' + mode); if (mode === 'off' || mode === 'notready') assert.strictEqual(o.calls.length, 0, mode + ': My Apps never called'); }
  fresh();
});

// ---------- hooks for Calcutta / golf / pickleball ----------
test('E12 hooks for the games not built yet: calcuttaStarted, calcuttaSold, golfStarted, pickleballStarted send the right type, clean text and a de-dup key', async () => {
  fresh(); M.now = Date.parse('2026-11-22T18:00:00Z');
  assert.strictEqual(EV.calcuttaStarted({ id: 'ABCDEFGHJK', name: 'Sunday crew' }, 'Week 12 auction'), true); assert.strictEqual(EV.calcuttaSold('Sunday crew', 'Kansas City', 'Rick', 120, { account: 'a@b.co', key: 'auc1|KC' }), true);
  assert.strictEqual(EV.golfStarted('Sunday crew', 'Saturday skins', { key: 'golf|r9' }), true); assert.strictEqual(EV.pickleballStarted({ id: 'P1', name: 'Dive crew' }, 'Round robin', { detail: '8 players' }), true); await idle();
  assert.deepStrictEqual(M.calls.map((c) => c.d), [
    { type: 'calcutta_start', title: 'Calcutta started: Week 12 auction', detail: 'Group: Sunday crew', key: 'calcutta_start|ABCDEFGHJK|Week 12 auction|2026-11-22' },
    { type: 'calcutta_sold', title: 'Calcutta sold: Kansas City', account: 'a@b.co', detail: 'To Rick for $120. Group: Sunday crew', key: 'auc1|KC' },
    { type: 'golf_start', title: 'Golf started: Saturday skins', detail: 'Group: Sunday crew', key: 'golf|r9' },
    { type: 'pickleball_start', title: 'Pickleball started: Round robin', detail: '8 players', key: 'pickleball_start|P1|Round robin|2026-11-22' },
  ]);
  fresh(); EV.calcuttaStarted(); EV.calcuttaSold(); EV.golfStarted(null, null, null); EV.pickleballStarted(undefined, ''); EV.calcuttaSold('G', 'KC', 'Rick', 12.5); EV.calcuttaSold('G', 'KC', null, 'abc'); EV.calcuttaSold('G', 'KC', 'x'.repeat(200), 99999999, {}); EV.calcuttaStarted('Group 9565551234 a@b.co', 'x'.repeat(300)); await idle();
  assert.deepStrictEqual(M.calls.map((c) => c.d.title).slice(0, 4), ['Calcutta started', 'Calcutta sold', 'Golf started', 'Pickleball started']); assert.strictEqual(M.calls[4].d.detail, 'To Rick for $12.50. Group: G'); assert.strictEqual(M.calls[5].d.detail, 'Group: G');
  M.calls.forEach((c) => { assert.ok(okText(c.d.title, 80), c.d.title); if (c.d.detail !== undefined) assert.ok(okText(c.d.detail, 160), c.d.detail); assert.ok(c.d.key && c.d.key.length <= 120); });
  fresh(); M.ready = false; assert.strictEqual(EV.calcuttaSold('G', 'KC', 'Rick', 5), false); fresh(); process.env.EVENTS_ENABLED = '0'; assert.strictEqual(EV.golfStarted('G', 'x'), false); delete process.env.EVENTS_ENABLED;
});

test('E13 the real acct.ma(): the event is posted to MYAPPS_URL/api/v1/event with slug + secret added, and a real 404 / dropped connection is swallowed', async () => {
  fresh(); EV._deps.ma = REAL.ma; EV._deps.maReady = REAL.maReady; const keep = global.fetch, got = []; let mode = 'ok';
  global.fetch = async (url, opt) => { got.push({ url: String(url), body: JSON.parse(opt.body), method: opt.method }); if (mode === 'drop') throw new Error('socket hang up'); return mode === '404' ? { ok: false, status: 404, json: async () => { throw new Error('not json'); } } : { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  try {
    EV.emit('group_new', { title: 'New group: A', key: 'k1' }); await idle();
    assert.deepStrictEqual(got, [{ url: 'https://fake.myapps/api/v1/event', method: 'POST', body: { slug: 'oddable', secret: 'app-secret-for-tests', type: 'group_new', title: 'New group: A', key: 'k1' } }]);
    mode = 'drop'; EV.emit('other', { title: 'b' }); await idle(); assert.strictEqual(got.length, 3, 'a dropped connection: one more try, then gone');
    mode = '404'; EV.emit('other', { title: 'c' }); await sleep(40); assert.strictEqual(got.length, 4); assert.ok(EV._state().until > Date.now(), 'paused after the 404');
    fresh(); EV._deps.ma = async () => ({ ok: false, status: 403, j: { ok: false, error: 'Bad app secret' } }); EV.emit('other', { title: 'd' }); EV.emit('other', { title: 'e' }); await sleep(40); assert.ok(EV._state().until > Date.now(), 'a refused app secret pauses too (no hammering with a wrong secret)'); assert.strictEqual(EV._state().queued, 1);
  } finally { global.fetch = keep; fresh(); }
});

(async () => {
  let bad = 0;
  for (const [n, f] of tests) { try { await f(); console.log('  PASS ' + n); } catch (e) { bad++; console.log('  FAIL ' + n + '\n        ' + String((e && e.stack) || e).split('\n').slice(0, 8).join('\n        ')); } }
  Object.assign(EV._deps, REAL); Object.assign(EV._cfg, CFG0); EV._reset();
  console.log(bad ? '\n' + bad + ' OF ' + tests.length + ' EVENTS CHECKS FAILED' : '\nALL ' + tests.length + ' EVENTS CHECKS PASSED'); process.exit(bad ? 1 : 0);
})();
