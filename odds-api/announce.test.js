// Run: node odds-api/announce.test.js   (no network: My Apps is a fake behind announce.js _deps.ma; tokens are real acct.js tokens)
// Covers v267: POST /acct/broadcast (owner only) and GET /acct/announce (the signed-in account's targeted message).
process.env.MYAPPS_URL = 'https://myapps.test'; process.env.MYAPPS_SECRET = 'sek-ret-XYZ'; process.env.GATE_KEY = 'test-gate-key'; process.env.OWNER_PIN = '4321'; process.env.OWNER_PHONE = '9565550101'; delete process.env.GATE_OFF;
const assert = require('assert'), http = require('http'), crypto = require('crypto'), A = require('./acct'), N = require('./announce');
const hm = (k, p, enc) => crypto.createHmac('sha256', 'test-gate-key').update(k + p).digest(enc);
const pinV = (pin) => crypto.createHash('sha256').update('pin|' + pin).digest('hex').slice(0, 8);
const tok = (e, ms) => { const p = Buffer.from(JSON.stringify({ e, x: Date.now() + (ms || 864e5) })).toString('base64url'); return p + '.' + hm('', p, 'base64url'); };
const ownerTok = (pin) => { const p = Buffer.from(JSON.stringify({ e: 'owner', v: pinV(pin || '4321'), x: Date.now() + 864e5 })).toString('base64url'); return p + '.' + hm('', p, 'base64url'); };
const OWNER_E = A.phoneEmail(crypto.createHash('sha256').update('oddable|9565550101').digest('hex'));
const dashTok = (e, pin, ms) => { const p = Buffer.from(JSON.stringify({ e, v: pinV(pin || '4321'), x: Date.now() + (ms || 864e5) })).toString('base64url'); return p + '.' + hm('dash|', p, 'hex'); };
let calls, myapps, NOW = 0;
const realFetch = global.fetch; global.fetch = async () => { throw new Error('the real fetch must never be called in this test'); };
Object.assign(N._deps, { ma: async (path, data) => { calls.push({ path, data: JSON.parse(JSON.stringify(data)) }); const a = await myapps(path, data); return { ok: a.status >= 200 && a.status < 300, status: a.status, j: a.j }; }, now: () => NOW || Date.now() });
const srv = http.createServer(async (req, res) => { if (!(await N.handle(req, res))) { res.statusCode = 404; res.end('{"none":1}'); } });
let ipn = 0;
const hit = (path, body, o) => new Promise((done, fail) => {
  o = o || {}; const h = { 'content-type': 'application/json', 'x-forwarded-for': o.ip || ('10.1.' + (++ipn >> 8) + '.' + (ipn & 255) + ', 1.1.1.1, 2.2.2.2') }; if (o.token) h['x-token'] = o.token; if (o.dash) h['x-dash'] = o.dash;
  const m = o.method || (path === '/acct/announce' ? 'GET' : 'POST');
  const r = http.request({ port: srv.address().port, path, method: m, headers: h }, (res) => { let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => { let j = {}; try { j = JSON.parse(t); } catch (e) {} done({ status: res.statusCode, headers: res.headers, text: t, j }); }); });
  r.on('error', fail); if (m === 'POST') r.write(o.raw != null ? o.raw : JSON.stringify(body || {})); r.end();
});
const OKJ = { ok: true, id: 'b_9', people: 12, devices: 7, sent: 7 };
const start = (f) => { N._reset(); NOW = 0; calls = []; myapps = f || (() => ({ status: 200, j: OKJ })); };
const last = () => calls[calls.length - 1];
const MSG = { title: 'Picks are up', body: 'The Alert of the week is ready.', audience: 'all' };
const own = { token: ownerTok() };
let n = 0; const t = (name) => { n++; process.stdout.write('  ok ' + n + ' ' + name + '\n'); };
(async () => {
  await new Promise((r) => srv.listen(0, r));
  try {
    // ---- POST /acct/broadcast: who may send
    start(); let r = await hit('/acct/broadcast', MSG, own);
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.j, { ok: true, test: false, id: 'b_9', people: 12, devices: 7, sent: 7 }); assert.strictEqual(r.headers['access-control-allow-origin'], '*');
    assert.deepStrictEqual(calls, [{ path: '/api/v1/broadcast', data: { title: 'Picks are up', body: 'The Alert of the week is ready.', audience: 'all' } }]); t('owner-PIN token sends; the message is forwarded as title / body / audience only');

    start(); r = await hit('/acct/broadcast', MSG, { token: tok(OWNER_E), dash: dashTok(OWNER_E) }); assert.strictEqual(r.status, 200); assert.strictEqual(calls.length, 1); t('owner phone + dashboard unlock (x-dash) sends');

    start(); r = await hit('/acct/broadcast', MSG, { token: tok(OWNER_E) }); assert.strictEqual(r.status, 401); assert.strictEqual(r.j.need, 'owner-pin'); assert.strictEqual(calls.length, 0);
    for (const d of ['junk', dashTok('someone@phone.oddable'), dashTok(OWNER_E, '9999'), dashTok(OWNER_E, '4321', -1000), dashTok(OWNER_E).slice(0, -2) + 'zz']) { r = await hit('/acct/broadcast', MSG, { token: tok(OWNER_E), dash: d }); assert.strictEqual(r.status, 401, d.slice(-12)); assert.strictEqual(r.j.need, 'owner-pin'); }
    assert.strictEqual(calls.length, 0); t('owner phone WITHOUT a good dashboard unlock = 401 need owner-pin, My Apps not called');

    start();
    for (const o of [{ token: tok('carl@x.test') }, { token: tok('abcdef0123456789abcd@phone.oddable') }, { token: tok('carl@x.test'), dash: dashTok(OWNER_E) }, { token: tok('carl@x.test'), dash: dashTok('carl@x.test') }]) { r = await hit('/acct/broadcast', MSG, o); assert.strictEqual(r.status, 403); assert.deepStrictEqual(r.j, { ok: false, error: 'Owner only' }); }
    for (const o of [{}, { token: 'junk' }, { token: 'a.b' }, { token: tok('carl@x.test', -1000) }, { token: ownerTok('1111') }, { token: tok('owner') + 'x' }, { dash: dashTok(OWNER_E) }]) { r = await hit('/acct/broadcast', MSG, o); assert.strictEqual(r.status, 401, JSON.stringify(o).slice(0, 30)); assert.strictEqual(r.j.error, 'Sign in again'); }
    r = await hit('/acct/broadcast', Object.assign({ token: ownerTok(), owner: true, role: 'owner' }, MSG), { token: tok('carl@x.test') }); assert.strictEqual(r.status, 403);
    assert.strictEqual(calls.length, 0); t('a signed-in customer gets 403, no / bad / expired token gets 401, an owner token in the BODY does nothing: My Apps is never called');

    // ---- what is forwarded
    start(); r = await hit('/acct/broadcast', { title: '  Game\n day \t', body: ' Line one\r\nline   two ', audience: 'active', link: 'bets', test: true, slug: 'dose', secret: 'x', account: 'victim@x.test', id: 5, people: 99, html: '<b>' }, own);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.j.test, true);
    assert.deepStrictEqual(last().data, { title: 'Game day', body: 'Line one line two', audience: 'active', link: '/?open=bets', test: true }); t('text is cleaned to one line; link name -> URL; test flag; slug / secret / account / extra fields from the phone are ignored');
    for (const [k, u] of Object.entries(N.LINKS)) { start(); r = await hit('/acct/broadcast', Object.assign({}, MSG, { link: k }), own); assert.strictEqual(r.status, 200); assert.strictEqual(last().data.link, u); }
    assert.deepStrictEqual(N.LINKS, { home: '/', bets: '/?open=bets', live: '/?open=live', sports: '/sports.html', pga: '/pga.html', pickleball: '/pickleball.html', golfgps: '/golfgps.html' });
    for (const u of Object.values(N.LINKS)) assert(/^\/(?!\/)[^\s\\]{0,299}$/.test(u) && !u.includes('//'), 'My Apps link rule: ' + u);
    for (const none of [undefined, null, '']) { start(); r = await hit('/acct/broadcast', Object.assign({}, MSG, { link: none }), own); assert.strictEqual(r.status, 200); assert(!('link' in last().data)); assert(!('test' in last().data)); } t('each place on the fixed list maps to its URL; no link = no link field');
    for (const aud of ['all', 'active', 'expired']) { start(); r = await hit('/acct/broadcast', Object.assign({}, MSG, { audience: aud }), own); assert.strictEqual(last().data.audience, aud); }
    start(); r = await hit('/acct/broadcast', { title: 'a', body: 'b' }, own); assert.strictEqual(last().data.audience, 'all'); t('audiences all / active / expired; none given = all');
    start(); r = await hit('/acct/broadcast', { title: '<script>alert(1)</script>', body: '<img src=x onerror=1> & "q"', audience: 'all' }, own); assert.strictEqual(last().data.title, '<script>alert(1)</script>'); assert.strictEqual(last().data.body, '<img src=x onerror=1> & "q"'); t('tags are plain characters: sent as typed, never changed into anything');
    start(); r = await hit('/acct/broadcast', { title: 'x'.repeat(60), body: 'y'.repeat(240), audience: 'all' }, own); assert.strictEqual(r.status, 200); assert.strictEqual(last().data.title.length, 60); assert.strictEqual(last().data.body.length, 240); t('60 / 240 characters are allowed');

    // ---- validation: nothing is forwarded
    start();
    const badv = [[{ title: '' }, 'title', 'Type a title.'], [{ title: '  \n ' }, 'title', 'Type a title.'], [{ title: 7 }, 'title', 'Type a title.'], [{ title: null }, 'title', 'Type a title.'], [{ title: 'x'.repeat(61) }, 'title', 'Keep the title to 60 characters or less.'],
      [{ body: '' }, 'body', 'Type a message.'], [{ body: ['a'] }, 'body', 'Type a message.'], [{ body: 'y'.repeat(241) }, 'body', 'Keep the message to 240 characters or less.'],
      [{ audience: 'everyone' }, 'audience', 'Pick who gets it.'], [{ audience: '' }, 'audience', 'Pick who gets it.'], [{ audience: ['all'] }, 'audience', 'Pick who gets it.'], [{ audience: 5 }, 'audience', 'Pick who gets it.'],
      [{ link: 'https://evil.example' }, 'link', 'Pick where it opens from the list.'], [{ link: '/?open=bets' }, 'link', 'Pick where it opens from the list.'], [{ link: 'javascript:alert(1)' }, 'link', 'Pick where it opens from the list.'], [{ link: '__proto__' }, 'link', 'Pick where it opens from the list.'], [{ link: 'constructor' }, 'link', 'Pick where it opens from the list.'], [{ link: 7 }, 'link', 'Pick where it opens from the list.'], [{ link: { a: 1 } }, 'link', 'Pick where it opens from the list.'],
      [{ test: 'yes' }, 'bad', 'bad request'], [{ test: 1 }, 'bad', 'bad request']];
    for (const [b, code, msg] of badv) { N._reset(); r = await hit('/acct/broadcast', Object.assign({}, MSG, b), own); assert.strictEqual(r.status, 400, JSON.stringify(b).slice(0, 40)); assert.deepStrictEqual(r.j, { ok: false, code, error: msg }); }
    N._reset(); r = await hit('/acct/broadcast', null, Object.assign({ raw: '{not json' }, own)); assert.strictEqual(r.status, 400); r = await hit('/acct/broadcast', null, Object.assign({ raw: '[1,2]' }, own)); assert.strictEqual(r.status, 400); r = await hit('/acct/broadcast', null, Object.assign({ raw: JSON.stringify({ title: 'a', body: 'x'.repeat(30000) }) }, own)); assert.strictEqual(r.status, 400);
    r = await hit('/acct/broadcast', MSG, Object.assign({ method: 'GET' }, own)); assert.strictEqual(r.status, 405);
    assert.strictEqual(calls.length, 0); t('empty / too long / wrong type / unknown audience / a link not on the list / junk body / GET: 400 or 405 and My Apps is never called');

    // ---- My Apps answers
    const up = async (status, j) => { start(typeof status === 'function' ? status : () => ({ status, j })); return hit('/acct/broadcast', MSG, own); };
    r = await up(429, { ok: false, error: 'limit' }); assert.strictEqual(r.status, 429); assert.deepStrictEqual(r.j, { ok: false, code: 'limit', error: 'You have sent 5 today. Try again tomorrow.' });
    r = await up(409, { ok: false, error: 'dup' }); assert.strictEqual(r.status, 409); assert.deepStrictEqual(r.j, { ok: false, code: 'dup', error: 'You already sent this same message in the last 10 minutes.' });
    r = await up(429, { ok: false, error: 'busy' }); assert.strictEqual(r.status, 429); assert.deepStrictEqual(r.j, { ok: false, code: 'busy', error: 'Too many sends right now. Try again in a few minutes.' });
    r = await up(400, { ok: false, error: 'contact' }); assert.strictEqual(r.status, 400); assert.deepStrictEqual(r.j, { ok: false, code: 'contact', error: 'Take the phone number or email out of the message.' }); t('limit / dup (409) / busy / contact get their own sentences');
    for (const f of [[404, { error: 'Not found' }], [500, { error: 'boom sek-ret-XYZ' }], [502, {}], [503, {}], [0, {}], () => { throw new Error('down sek-ret-XYZ'); }]) { r = Array.isArray(f) ? await up(f[0], f[1]) : await up(f); assert.strictEqual(r.status, 502); assert.deepStrictEqual(r.j, { ok: false, code: 'notready', error: 'My Apps is not ready for this yet.' }); }
    const u0 = process.env.MYAPPS_URL; process.env.MYAPPS_URL = ''; start(); r = await hit('/acct/broadcast', MSG, own); process.env.MYAPPS_URL = u0; assert.strictEqual(r.status, 502); assert.strictEqual(r.j.error, 'My Apps is not ready for this yet.'); assert.strictEqual(calls.length, 0); t('My Apps unreachable, 404, 5xx or not set up: "My Apps is not ready for this yet."');
    r = await up(400, { ok: false, error: 'title' }); assert.strictEqual(r.status, 400); assert.deepStrictEqual(r.j, { ok: false, code: 'title', error: 'My Apps did not take that message. Check the words and try again.' });
    r = await up(400, { ok: false, error: 'Bad thing <b>sek-ret-XYZ</b> happened' }); assert.deepStrictEqual(r.j, { ok: false, code: 'failed', error: 'My Apps did not take that message. Check the words and try again.' });
    for (const st of [401, 403]) { r = await up(st, { error: 'Bad app secret sek-ret-XYZ' }); assert.strictEqual(r.status, 502); assert.deepStrictEqual(r.j, { ok: false, code: 'failed', error: 'Could not send. Please try again later.' }); }
    r = await up(200, { ok: false, error: 'limit' }); assert.strictEqual(r.status, 429); r = await up(200, { nope: 1 }); assert.strictEqual(r.status, 502); assert.strictEqual(r.j.code, 'failed');
    r = await up(429, { error: '__proto__' }); assert.strictEqual(r.j.code, 'failed'); assert(!r.text.includes('sek-ret')); t('any other answer is a plain sentence; My Apps text and the secret never reach the phone');
    r = await up(200, { ok: true, id: null, people: 1, devices: 2, sent: 2 }); assert.deepStrictEqual(r.j, { ok: true, test: false, id: null, people: 1, devices: 2, sent: 2 });
    r = await up(200, { ok: true, id: 77, people: '12', devices: null, sent: -4, secret: 'sek-ret-XYZ', accounts: ['a@x.test'], phones: ['9565550101'] }); assert.deepStrictEqual(r.j, { ok: true, test: false, id: '77', people: 12, devices: null, sent: null }); assert(!/x\.test|956555|sek-ret/.test(r.text)); t('only id and the three counts are passed back (numbers or null)');

    // ---- rate limit (8 per 10 minutes per IP, like the neighbouring owner routes), checked AFTER the owner check
    start(); for (let i = 0; i < 8; i++) { r = await hit('/acct/broadcast', MSG, Object.assign({ ip: '9.9.9.9, 1.1.1.1, 2.2.2.2' }, own)); assert.strictEqual(r.status, 200); }
    r = await hit('/acct/broadcast', MSG, Object.assign({ ip: '9.9.9.9, 1.1.1.1, 2.2.2.2' }, own)); assert.strictEqual(r.status, 429); assert.strictEqual(r.j.code, 'slow'); assert.strictEqual(calls.length, 8);
    for (let i = 0; i < 20; i++) { r = await hit('/acct/broadcast', MSG, { token: tok('carl@x.test'), ip: '9.9.9.8, 1.1.1.1, 2.2.2.2' }); assert.strictEqual(r.status, 403); } r = await hit('/acct/broadcast', MSG, Object.assign({ ip: '9.9.9.8, 1.1.1.1, 2.2.2.2' }, own)); assert.strictEqual(r.status, 200, 'strangers cannot use up the owner\'s tries'); t('9th send in 10 minutes from one address = 429; non-owners do not count');
    start(); for (let i = 0; i < 16; i++) { r = await hit('/acct/broadcast', MSG, own); assert.strictEqual(r.status, 200); } r = await hit('/acct/broadcast', MSG, own); assert.strictEqual(r.status, 429); NOW = Date.now() + 601e3; r = await hit('/acct/broadcast', MSG, own); assert.strictEqual(r.status, 200); t('16 in 10 minutes over all addresses, then it opens again');

    // ---- GET /acct/announce
    const AT = new Date(Date.now() - 3600e3).toISOString(), ANN = { id: 't_3', title: 'Your access ended', body: 'Renew to see this week.', link: '/?open=bets', at: AT };
    start(() => ({ status: 200, j: { ok: true, announce: Object.assign({ audience: 'expired', secret: 'sek-ret-XYZ', account: 'me@x.test' }, ANN) } }));
    r = await hit('/acct/announce', null, { token: tok('me@x.test') }); assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.j, { ok: true, announce: ANN }); assert.strictEqual(r.headers['cache-control'], 'no-store');
    assert.deepStrictEqual(calls, [{ path: '/api/v1/announce/for', data: { account: 'me@x.test' } }]); t('announce: the account comes from the token; five fields come back');
    r = await hit('/acct/announce?account=victim@x.test', null, { token: tok('me@x.test') }); r = await hit('/acct/announce', { account: 'victim@x.test' }, { token: tok('me@x.test'), method: 'POST' }); assert.deepStrictEqual(r.j, { ok: true, announce: ANN }); assert.strictEqual(calls.length, 1); t('cached per account: three reads = one My Apps call; an account in the query or body is ignored');
    r = await hit('/acct/announce', null, { token: tok('other@x.test') }); assert.strictEqual(calls.length, 2); assert.strictEqual(last().data.account, 'other@x.test'); NOW = Date.now() + 5 * 6e4 + 5; myapps = () => ({ status: 200, j: { ok: true, announce: null } }); r = await hit('/acct/announce', null, { token: tok('me@x.test') }); assert.strictEqual(calls.length, 3); assert.deepStrictEqual(r.j, { ok: true, announce: null }); t('another account has its own cache; after 5 minutes it is read again; null = none');
    for (const o of [{}, { token: 'junk' }, { token: tok('me@x.test', -5) }]) { start(); r = await hit('/acct/announce', null, o); assert.strictEqual(r.status, 401); assert.strictEqual(calls.length, 0); }
    start(); r = await hit('/acct/announce', null, { token: ownerTok() }); assert.deepStrictEqual(r.j, { ok: true, announce: null }); assert.strictEqual(calls.length, 0); t('no token = 401; the owner-PIN sign-in has no account: null and no My Apps call');
    for (const f of [() => ({ status: 404, j: {} }), () => ({ status: 500, j: { error: 'x' } }), () => { throw new Error('down'); }, () => ({ status: 200, j: { ok: true, announce: Object.assign({}, ANN, { title: 'x'.repeat(61) }) } }), () => ({ status: 200, j: { ok: true, announce: Object.assign({}, ANN, { at: '2020-01-01T00:00:00Z' }) } }), () => ({ status: 200, j: { ok: true, announce: 'hello' } }), () => ({ status: 200, j: { ok: false, announce: ANN } })]) { start(f); r = await hit('/acct/announce', null, { token: tok('me@x.test') }); assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.j, { ok: true, announce: null }); }
    start(() => ({ status: 500, j: {} })); await hit('/acct/announce', null, { token: tok('me@x.test') }); await hit('/acct/announce', null, { token: tok('me@x.test') }); assert.strictEqual(calls.length, 1); NOW = Date.now() + 6e4 + 5; await hit('/acct/announce', null, { token: tok('me@x.test') }); assert.strictEqual(calls.length, 2); t('My Apps down / 404 / a bad announcement = null (never an error on the phone); a failed read is tried again after 1 minute');
    start(() => ({ status: 200, j: { ok: true, announce: Object.assign({}, ANN, { link: 'https://evil.example', title: '<b>x</b>' }) } })); r = await hit('/acct/announce', null, { token: tok('me@x.test') }); assert.strictEqual(r.j.announce.link, ''); assert.strictEqual(r.j.announce.title, '<b>x</b>'); t('a link that is not on the list is dropped; text stays plain text');
    start(() => new Promise(() => {})); const realST = global.setTimeout; global.setTimeout = (f, ms) => realST(f, ms === 6000 ? 5 : ms); try { r = await hit('/acct/announce', null, { token: tok('me@x.test') }); } finally { global.setTimeout = realST; } assert.deepStrictEqual(r.j, { ok: true, announce: null }); t('a slow My Apps does not hang the route (6 s limit)');
    start(); for (let i = 0; i < 30; i++) { r = await hit('/acct/announce', null, { token: tok('me@x.test') }); assert.strictEqual(r.status, 200); } r = await hit('/acct/announce', null, { token: tok('me@x.test') }); assert.strictEqual(r.status, 429); t('31st read in 10 minutes for one account = 429');
    process.env.GATE_OFF = '1'; start(); r = await hit('/acct/announce', null, { token: tok('me@x.test') }); assert.deepStrictEqual(r.j, { ok: true, announce: null }); r = await hit('/acct/announce', null, {}); assert.strictEqual(r.status, 200); assert.strictEqual(calls.length, 0);
    r = await hit('/acct/broadcast', MSG, { token: tok('carl@x.test') }); assert.notStrictEqual(r.status, 200); assert.strictEqual(calls.length, 0); r = await hit('/acct/broadcast', MSG, own); assert.strictEqual(r.status, 200); delete process.env.GATE_OFF; t('gate off: announce answers null without My Apps; broadcast still needs the owner');

    // ---- routing
    start(); r = await hit('/acct/broadcastx', MSG, own); assert.strictEqual(r.status, 404); r = await hit('/acct/me', {}, own); assert.strictEqual(r.status, 404); r = await hit('/acct/broadcast?x=1', MSG, own); assert.strictEqual(r.status, 200); t('only the two paths are handled here');
    console.log('announce.test.js: ' + n + ' tests passed');
  } catch (e) { console.error('FAILED after ' + n + ' tests:', e); process.exitCode = 1; }
  finally { global.fetch = realFetch; srv.close(); }
})();
