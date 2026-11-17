// Run: node odds-api/acct.test.js   (no network: My Apps is a fake behind acct.js ma(), which is the only thing that calls fetch here)
// Covers v263: /acct/time/request, /acct/time/status, the cashtag on /acct/pay and in /acct/me.
process.env.MYAPPS_URL = 'https://myapps.test'; process.env.MYAPPS_SECRET = 'sek-ret-XYZ'; process.env.GATE_KEY = 'test-gate-key'; process.env.OWNER_PIN = '4321'; delete process.env.GATE_OFF;
const assert = require('assert'), http = require('http'), crypto = require('crypto'), A = require('./acct');
const tok = (e, ms) => { const p = Buffer.from(JSON.stringify({ e, x: Date.now() + (ms || 864e5) })).toString('base64url'); return p + '.' + crypto.createHmac('sha256', 'test-gate-key').update(p).digest('base64url'); };
const ownerTok = () => { const v = crypto.createHash('sha256').update('pin|4321').digest('hex').slice(0, 8), p = Buffer.from(JSON.stringify({ e: 'owner', v, x: Date.now() + 864e5 })).toString('base64url'); return p + '.' + crypto.createHmac('sha256', 'test-gate-key').update(p).digest('base64url'); };
let calls, myapps;
const realFetch = global.fetch;
global.fetch = async (url, o) => { // the fake My Apps: records what ma() sent
  const path = String(url).replace('https://myapps.test', ''), data = JSON.parse(o.body); calls.push({ path, data });
  assert.strictEqual(o.method, 'POST'); assert.strictEqual(data.slug, 'oddable'); assert.strictEqual(data.secret, 'sek-ret-XYZ');
  const a = await myapps(path, data); return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.j };
};
const srv = http.createServer(async (req, res) => { if (!(await A.handle(req, res))) { res.statusCode = 404; res.end('{"none":1}'); } });
let ipn = 0, ME = '';
const hit = (path, body, o) => new Promise((done, fail) => {
  o = o || {}; const h = { 'content-type': 'application/json', 'x-forwarded-for': o.ip || ('10.0.' + (++ipn >> 8) + '.' + (ipn & 255) + ', 1.1.1.1, 2.2.2.2') }; ME = 'carl' + ipn + '@x.test'; if (o.token !== null) h['x-token'] = o.token || tok(ME); // a new account per call, so the per-account rate limit only bites in the rate-limit tests
  const r = http.request({ port: srv.address().port, path, method: o.method || 'POST', headers: h }, (res) => { let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => { let j = {}; try { j = JSON.parse(t); } catch (e) {} done({ status: res.statusCode, headers: res.headers, text: t, j }); }); });
  r.on('error', fail); if ((o.method || 'POST') === 'POST') r.write(o.raw != null ? o.raw : JSON.stringify(body || {})); r.end();
});
const start = (f) => { calls = []; myapps = f || (() => ({ status: 200, j: { ok: true, status: 'pending' } })); };
const last = () => calls[calls.length - 1];
let n = 0; const t = (name) => { n++; process.stdout.write('  ok ' + n + ' ' + name + '\n'); };
(async () => {
  await new Promise((r) => srv.listen(0, r));
  try {
    // ---- /acct/time/request
    start(); let r = await hit('/acct/time/request', { note: '  Out of town\n this  week\t ' });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.j, { ok: true, status: 'pending', already: false }); assert.strictEqual(r.headers['access-control-allow-origin'], '*');
    assert.strictEqual(calls.length, 1); assert.deepStrictEqual(last(), { path: '/api/v1/time/request', data: { slug: 'oddable', secret: 'sek-ret-XYZ', account: ME, note: 'Out of town this week' } }); t('request forwards the token account and a cleaned note');

    start(); r = await hit('/acct/time/request', { note: 'hi', account: 'victim@x.test', email: 'victim@x.test', tenant: 'victim', slug: 'dose', secret: 'x' }, { token: tok('me@x.test') });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(last().data, { slug: 'oddable', secret: 'sek-ret-XYZ', account: 'me@x.test', note: 'hi' }); t('an account / slug / secret sent by the phone is ignored');

    start(); r = await hit('/acct/time/request', {}); assert.strictEqual(r.status, 200); assert.deepStrictEqual(last().data, { slug: 'oddable', secret: 'sek-ret-XYZ', account: ME });
    start(); r = await hit('/acct/time/request', { note: '   \n ' }); assert.strictEqual(r.status, 200); assert(!('note' in last().data)); t('no note / blank note = no note field');

    start(() => ({ status: 200, j: { ok: true, status: 'pending', already: true } })); r = await hit('/acct/time/request', { note: 'again' }); assert.deepStrictEqual(r.j, { ok: true, status: 'pending', already: true }); t('already:true is passed through');

    start(); r = await hit('/acct/time/request', { note: 'x'.repeat(140) }); assert.strictEqual(r.status, 200); assert.strictEqual(last().data.note.length, 140);
    start(); r = await hit('/acct/time/request', { note: ' ' + 'x'.repeat(140) + '  ' }); assert.strictEqual(r.status, 200, '140 after trimming is fine');
    start(); r = await hit('/acct/time/request', { note: 'x'.repeat(141) }); assert.strictEqual(r.status, 400); assert.strictEqual(r.j.ok, false); assert.strictEqual(r.j.code, 'note'); assert.match(r.j.error, /140 characters/); assert.strictEqual(calls.length, 0);
    for (const bad of [7, true, ['a'], { a: 1 }]) { start(); r = await hit('/acct/time/request', { note: bad }); assert.strictEqual(r.status, 400, JSON.stringify(bad)); assert.strictEqual(calls.length, 0); } t('note: 140 max after trimming, text only; a bad note never reaches My Apps');

    start(); r = await hit('/acct/time/request', { note: '<b>hi</b> & "x"' }); assert.strictEqual(last().data.note, '<b>hi</b> & "x"'); assert(!r.text.includes('<b>')); t('the note is passed on as plain text and never echoed');

    start(() => ({ status: 429, j: { ok: false, error: 'limit' } })); r = await hit('/acct/time/request', {}); assert.strictEqual(r.status, 429); assert.deepStrictEqual(r.j, { ok: false, code: 'limit', error: 'You have asked 3 times in the last 7 days. Please try again later.' });
    start(() => ({ status: 429, j: { ok: false, error: 'busy' } })); r = await hit('/acct/time/request', {}); assert.strictEqual(r.status, 429); assert.strictEqual(r.j.code, 'busy'); assert.match(r.j.error, /try again later/i);
    start(() => ({ status: 400, j: { ok: false, error: 'note' } })); r = await hit('/acct/time/request', { note: 'ok' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.j.code, 'note'); t('limit / busy / note get friendly messages');

    for (const up of [{ status: 403, j: { ok: false, error: 'Bad app secret' } }, { status: 404, j: { ok: false, error: 'Unknown app' } }, { status: 404, j: { error: 'No such endpoint' } }, { status: 500, j: { ok: false, error: 'Not available right now' } }, { status: 400, j: { ok: false, error: 'account' } }, { status: 200, j: { ok: false, error: 'weird <script>' } }, { status: 502, j: {} }]) {
      start(() => up); r = await hit('/acct/time/request', {}); assert.strictEqual(r.status, 502, JSON.stringify(up)); assert.deepStrictEqual(r.j, { ok: false, code: 'failed', error: 'Could not send your request. Please try again later.' }); assert(!/secret|Unknown app|script|endpoint/i.test(r.text));
    } t('other My Apps failures = one plain message, no upstream text');
    start(() => { throw new Error('connect ECONNREFUSED sek-ret-XYZ'); }); r = await hit('/acct/time/request', {}); assert.strictEqual(r.status, 502); assert(!r.text.includes('sek-ret')); assert.match(r.j.error, /waking up/); t('My Apps unreachable = 502, no secret in the answer');

    for (const bad of [null, 'junk', tok('carl@x.test', -1000), tok('carl@x.test') + 'x']) { start(); r = await hit('/acct/time/request', {}, { token: bad === null ? null : bad }); assert.strictEqual(r.status, 401); assert.strictEqual(calls.length, 0); }
    start(); r = await hit('/acct/time/status', {}, { token: null }); assert.strictEqual(r.status, 401); assert.strictEqual(calls.length, 0); t('no token / bad token / expired token = 401, My Apps not called');
    start(); r = await hit('/acct/time/request', {}, { token: ownerTok() }); assert.strictEqual(r.status, 400); assert.strictEqual(calls.length, 0);
    start(); r = await hit('/acct/time/status', {}, { token: ownerTok() }); assert.strictEqual(r.status, 400); assert.strictEqual(calls.length, 0); t('the owner-PIN token has no time requests');
    start(); r = await hit('/acct/time/request', null, { raw: '{not json' }); assert.strictEqual(r.status, 400); assert.strictEqual(calls.length, 0);
    start(); r = await hit('/acct/time/request', null, { method: 'GET' }); assert.strictEqual(r.status, 404, 'GET is not a request'); assert.strictEqual(calls.length, 0); t('bad JSON = 400; GET /acct/time/request is not handled');

    // rate limit: 8 per 10 minutes per account (and per IP), like /acct/redeem
    start(); const who = tok('flood@x.test'); for (let i = 0; i < 8; i++) { r = await hit('/acct/time/request', {}, { token: who }); assert.strictEqual(r.status, 200, 'try ' + i); }
    r = await hit('/acct/time/request', {}, { token: who }); assert.strictEqual(r.status, 429); assert.match(r.j.error, /Too many tries/); assert.strictEqual(calls.length, 8);
    start(); for (let i = 0; i < 8; i++) { r = await hit('/acct/time/request', {}, { token: tok('ip' + i + '@x.test'), ip: '9.9.9.9, 1.1.1.1, 2.2.2.2' }); assert.strictEqual(r.status, 200); }
    r = await hit('/acct/time/request', {}, { token: tok('ip9@x.test'), ip: '9.9.9.9, 1.1.1.1, 2.2.2.2' }); assert.strictEqual(r.status, 429); assert.strictEqual(calls.length, 8); t('rate limit per account and per IP');

    // ---- /acct/time/status
    const full = { ok: true, status: 'granted', days: 7, requested_at: '2026-11-16T15:00:00.000Z', decided_at: '2026-11-16T16:00:00.000Z', note: 'private note', account: ME, secret: 'zzz' };
    start(() => ({ status: 200, j: full })); r = await hit('/acct/time/status', {});
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.j, { ok: true, status: 'granted', days: 7, requested_at: '2026-11-16T15:00:00.000Z', decided_at: '2026-11-16T16:00:00.000Z' }); assert.deepStrictEqual(last(), { path: '/api/v1/time/status', data: { slug: 'oddable', secret: 'sek-ret-XYZ', account: ME } }); t('status: whitelisted fields only');
    start(() => ({ status: 200, j: full })); r = await hit('/acct/time/status', null, { method: 'GET' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.j.status, 'granted'); assert.strictEqual(last().data.account, ME); t('status also answers GET with the x-token header');
    start(() => ({ status: 200, j: full })); r = await hit('/acct/time/status', { account: 'victim@x.test', token: tok('body@x.test') }, { token: null }); assert.strictEqual(last().data.account, 'body@x.test'); t('status account comes from the token (body token is the existing rule), never the account field');
    for (const s of ['none', 'pending', 'declined']) { start(() => ({ status: 200, j: { ok: true, status: s, days: 7, requested_at: null, decided_at: 'not a date' } })); r = await hit('/acct/time/status', {}); assert.deepStrictEqual(r.j, { ok: true, status: s, days: null, requested_at: null, decided_at: null }, s); } t('days only when granted; junk dates = null');
    for (const d of [null, 'abc', -3, 0, {}, []]) { start(() => ({ status: 200, j: { ok: true, status: 'granted', days: d } })); r = await hit('/acct/time/status', {}); assert.strictEqual(r.j.days, null, JSON.stringify(d)); } t('granted with junk days = days null');
    for (const up of [{ status: 200, j: { ok: true, status: '<img>' } }, { status: 200, j: { ok: true } }, { status: 200, j: { ok: false, error: 'x' } }, { status: 403, j: { ok: false, error: 'Bad app secret' } }, { status: 404, j: { error: 'No such endpoint' } }, { status: 500, j: {} }]) {
      start(() => up); r = await hit('/acct/time/status', {}); assert.strictEqual(r.status, 502, JSON.stringify(up)); assert.deepStrictEqual(r.j, { ok: false, code: 'failed', error: 'Could not check your request. Please try again later.' });
    } t('status: unknown status or My Apps failure = 502 plain message');
    start(() => ({ status: 200, j: { ok: true, status: 'none' } })); const sw = tok('poll@x.test'); for (let i = 0; i < 30; i++) { r = await hit('/acct/time/status', {}, { token: sw }); assert.strictEqual(r.status, 200); } r = await hit('/acct/time/status', {}, { token: sw }); assert.strictEqual(r.status, 429); t('status rate limit: 30 per 10 minutes per account');

    // ---- cashtag on /acct/pay
    const payOk = (extra) => () => ({ status: 200, j: Object.assign({ ok: true, ref: 'R1', link: 'https://cash.app/$owner/99', amount: 99 }, extra) });
    start(payOk({ cashtag: '$Carl_99' })); r = await hit('/acct/pay', { cashtag: '  $Carl_99 ' });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.j, { ok: true, ref: 'R1', link: 'https://cash.app/$owner/99', amount: 99, cashtag: '$Carl_99' }); assert.deepStrictEqual(last(), { path: '/api/v1/pay/request', data: { slug: 'oddable', secret: 'sek-ret-XYZ', account: ME, cashtag: '$Carl_99' } }); t('pay forwards a trimmed cashtag and returns the saved one');
    for (const none of [undefined, '', '   ', null, 5, ['$a'], { a: 1 }]) { start(payOk({ cashtag: '' })); r = await hit('/acct/pay', none === undefined ? {} : { cashtag: none }); assert.strictEqual(r.status, 200); assert.deepStrictEqual(last().data, { slug: 'oddable', secret: 'sek-ret-XYZ', account: ME }, JSON.stringify(none)); assert.strictEqual(r.j.cashtag, ''); } t('pay without a cashtag works as before (field not sent)');
    const MSG = 'That is not a Cash App tag. Use up to 20 letters, numbers, _ or -, like $yourtag.';
    start(() => ({ status: 400, j: { error: MSG } })); r = await hit('/acct/pay', { cashtag: 'bad tag!' }); assert.strictEqual(r.status, 400); assert.deepStrictEqual(r.j, { error: MSG }); assert.strictEqual(last().data.cashtag, 'bad tag!'); t('My Apps 400 for a bad cashtag is passed on with its message');
    start(() => ({ status: 400, j: { error: 'Payments are not configured' } })); r = await hit('/acct/pay', {}); assert.strictEqual(r.status, 502); assert.strictEqual(r.j.error, 'Payments are not configured');
    start(() => ({ status: 500, j: {} })); r = await hit('/acct/pay', { cashtag: '$ok' }); assert.strictEqual(r.status, 502); assert.strictEqual(r.j.error, 'Could not record your payment'); t('other pay failures are still 502 (unchanged)');
    start(payOk()); r = await hit('/acct/pay', { cashtag: 'x'.repeat(500) }); assert.strictEqual(last().data.cashtag.length, 40); t('an oversized cashtag is cut to 40 before it is sent on (My Apps rejects it)');
    start(payOk({ cashtag: '<script>' })); r = await hit('/acct/pay', { cashtag: '$a' }); assert.strictEqual(r.j.cashtag, ''); t('a junk cashtag in the My Apps answer is not passed to the phone');
    start(payOk()); r = await hit('/acct/pay', { cashtag: '$me', account: 'victim@x.test' }, { token: tok('payer@x.test') }); assert.strictEqual(last().data.account, 'payer@x.test'); t('pay account comes from the token');

    // ---- cashtag in /acct/me (pay info)
    const acct = (info) => (path, data) => path === '/api/v1/account' ? { status: 200, j: { email: data.email, role: 'user', plan: 'pro', expires_on: null, source: 'manual' } } : path === '/api/v1/pay/info' ? { status: 200, j: info } : { status: 404, j: {} };
    start(acct({ configured: true, price: 99, link: 'https://cash.app/$owner/99', tag: '$owner', cashtag: '$Carl_99', pending: false })); r = await hit('/acct/me', {}, { token: tok('me1@x.test') });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.j.me.cashtag, '$Carl_99'); assert.strictEqual(r.j.me.tag, '$owner'); assert.strictEqual(r.j.me.allowed, true); assert.strictEqual(r.j.me.expires_on, null); assert.strictEqual(r.j.me.price, 99); assert.strictEqual(r.j.me.payReady, true);
    assert.deepStrictEqual(calls.map((c) => c.path), ['/api/v1/account', '/api/v1/pay/info'], '/acct/me makes the same two My Apps calls as before'); t('/acct/me returns the saved cashtag next to the owner tag; no extra My Apps call');
    for (const junk of [undefined, '', null, 7, '<b>x</b>', '$' + 'a'.repeat(21), '$a b', '$$a']) { start(acct({ configured: true, cashtag: junk })); r = await hit('/acct/me', {}, { token: tok('j' + Math.random() + '@x.test') }); assert.strictEqual(r.j.me.cashtag, '', JSON.stringify(junk)); } t('/acct/me cashtag is "" when none or junk');
    start(); r = await hit('/acct/me', {}, { token: ownerTok() }); assert.strictEqual(r.status, 200); assert.strictEqual(r.j.me.role, 'owner'); assert.strictEqual(calls.length, 0); t('owner /acct/me unchanged (no My Apps call)');

    // ---- gate off: nothing is forwarded (fail-open stays as it was)
    process.env.GATE_OFF = '1'; start();
    for (const p of ['/acct/time/request', '/acct/time/status', '/acct/pay']) { r = await hit(p, { note: 'x', cashtag: '$a' }); assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.j, { gate: false }, p); }
    r = await hit('/acct/time/status', null, { method: 'GET' }); assert.deepStrictEqual(r.j, { gate: false }); r = await hit('/acct/status', null, { method: 'GET', token: null }); assert.deepStrictEqual(r.j, { gate: false }); assert.strictEqual(calls.length, 0); delete process.env.GATE_OFF;
    r = await hit('/acct/status', null, { method: 'GET', token: null }); assert.deepStrictEqual(r.j, { gate: true }); t('gate off: every route answers {gate:false} and My Apps is never called');

    console.log('acct.test.js: ' + n + ' tests passed');
  } catch (e) { console.error('FAILED after ' + n + ' tests:', e); process.exitCode = 1; }
  finally { global.fetch = realFetch; srv.close(); }
})();
