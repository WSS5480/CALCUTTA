// Run: node scripts/joinlinks/joinlinks.test.js   (pre-merged Calcutta + pickleball branch; no network: Supabase and My Apps are in-memory fakes)
// Review D1 / D2 / the merge test: the three invite links ?join=g. (group), ?join=e. (pickleball event) and ?join=c. (Calcutta), each opened in a real
// headless browser on THIS tree's pics/ against THIS tree's real acct / sync / groups / localevents / calcutta modules:
//   A. /acct/status and `me` carry `groups`, `levents`, `calcutta` exactly as the switches allow (one combined early line; gFlag = cFlag(lFlag(gFlag0()))).
//   B. Both switches ON (CALCUTTA_ENABLED=1, LOCALEVENTS_ENABLED=1, Groups on): each link lands on ITS join screen (#ogrp / #oevt / #ocalc) and leaves the address bar.
//   C. Both OFF (Groups still on): g. still opens the group; e. and c. are left alone (still in the address bar, nothing kept, no overlay, no file requested).
// Part A always runs. B and C need Playwright (headless Chromium); without it they print SKIPPED (the exit code stays 0, so read the output).
const assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
Object.assign(process.env, { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'k', MYAPPS_URL: 'https://fake.myapps', MYAPPS_SECRET: 's3cret', OWNER_PIN: '4321', OWNER_PHONE: '(956) 555-0001', OWNER_NAME: 'Steve' });
['GROUPS_ENABLED', 'GROUPS_OWNER_ONLY', 'GROUPS_TESTERS', 'GATE_OFF', 'GATE_KEY', 'EVENTS_ENABLED', 'LOCALEVENTS_ENABLED', 'CALCUTTA_ENABLED', 'CALCUTTA_OWNER_ONLY', 'CALCUTTA_TESTERS'].forEach((k) => delete process.env[k]);
const J = (x) => JSON.stringify(x), DB = {}, real = global.fetch;
global.fetch = async (url, opt) => {
  url = String(url); opt = opt || {}; if (url.startsWith('http://127.0.0.1:')) return real(url, opt);
  const ok = (j, s) => ({ ok: true, status: s || 200, json: async () => JSON.parse(J(j)), text: async () => J(j) });
  if (url.startsWith('https://fake.myapps/')) { const p = new URL(url).pathname, b = JSON.parse(opt.body || '{}'); if (p === '/api/v1/account') return ok({ email: b.email, role: 'user', plan: 'pro', expires_on: null }); return ok({ ok: true }); }
  if (url.startsWith('https://site.api.espn.com/')) return ok({ events: [] });
  if (!url.startsWith('https://fake.supabase.co/rest/v1/oddable_sync')) throw new Error('unexpected outside call: ' + url);
  const q = new URL(url).searchParams, m = (opt.method || 'GET').toUpperCase(), eq = (k) => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  if (m === 'GET') { const id = eq('id'); if (id) return ok(DB[id] ? [DB[id]] : []); let rows = Object.values(DB); if (q.get('id') === 'not.like.lock:*') rows = rows.filter((r) => !String(r.id).startsWith('lock:')); return ok(q.get('select') === 'id' ? rows.map((r) => ({ id: r.id })) : rows); }
  if (m === 'POST') { const row = JSON.parse(opt.body), ign = /ignore-duplicates/.test((opt.headers || {}).Prefer || ''); if (DB[row.id] && ign) return ok([], 201); DB[row.id] = Object.assign({}, DB[row.id] || {}, row); return ok([], 201); }
  if (m === 'PATCH') { const id = eq('id'), was = eq('updated'); if (!DB[id] || (was != null && Number(DB[id].updated) !== Number(was))) return ok([]); Object.assign(DB[id], JSON.parse(opt.body)); return ok([DB[id]]); }
  throw new Error('fake db: ' + m);
};
const M = (n) => require(path.join(ROOT, 'odds-api', n)), ACCT = M('acct'), SYNC = M('sync'), G = M('groups'), LE = M('localevents'), C = M('calcutta');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.svg': 'image/svg+xml' };
const srv = http.createServer(async (req, res) => { const u = req.url.split('?')[0]; // pics/ files first (on Render they are a separate static site: /calcutta.js is a FILE, not the /calcutta API); then the API in server.js's order
  { const f0 = path.join(ROOT, 'pics', u.replace(/^\/+/, '')); if (/\.[a-z0-9]+$/i.test(u) && f0.startsWith(path.join(ROOT, 'pics')) && fs.existsSync(f0) && fs.statSync(f0).isFile()) { res.setHeader('content-type', TYPES[path.extname(f0)] || 'application/octet-stream'); res.end(fs.readFileSync(f0)); return; } }
  try {
    if (u.startsWith('/acct') && await ACCT.handle(req, res)) return; if (u.startsWith('/sync') && await SYNC.handle(req, res)) return; if (u.startsWith('/groups') && await G.handle(req, res)) return;
    if (process.env.CALCUTTA_ENABLED === '1' && u.startsWith('/calcutta') && await C.handle(req, res)) return; if (process.env.LOCALEVENTS_ENABLED === '1' && u.startsWith('/levents') && await LE.handle(req, res)) return;
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-token,x-dash', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); res.end(); return; }
  } catch (e) { res.statusCode = 500; res.end('{}'); return; }
  const f = path.join(ROOT, 'pics', u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
  if (f.startsWith(path.join(ROOT, 'pics')) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f)); return; }
  res.statusCode = 404; res.setHeader('access-control-allow-origin', '*'); res.end('{"error":"not found"}');
});
let n = 0; const ok = (m) => { n++; console.log('  ok', m); };
const ON = () => Object.assign(process.env, { GROUPS_ENABLED: '1', LOCALEVENTS_ENABLED: '1', CALCUTTA_ENABLED: '1' }), OFF = () => { process.env.GROUPS_ENABLED = '1'; delete process.env.LOCALEVENTS_ENABLED; delete process.env.CALCUTTA_ENABLED; };
srv.listen(0, '127.0.0.1', async () => {
  const PORT = srv.address().port, base = 'http://127.0.0.1:' + PORT; let failed = 0, browser = null;
  const post = async (p, b, tok) => { const r = await real(base + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': '9.9.' + (1 + (n % 200)) + '.1' }, tok ? { 'x-token': tok } : {}), body: J(b || {}) }); const j = await r.json().catch(() => null); if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + J(j)); return j; };
  const status = async () => (await (await real(base + '/acct/status')).json());
  try {
    // ---------- A. /acct/status and me (review D2) ----------
    const person = async (phone, pin, name) => { await post('/sync/signup', { phone, pin, data: { bets: [] } }); const j = await post('/acct/phone', { phone, pin, name }); return { tok: j.token, name, phone, pin }; };
    const ann = await person('9565552001', '135792', 'Ann'), bo = await person('9565552002', '135793', 'Bo');
    const me = async (p) => (await post('/acct/me', {}, p.tok)).me, keys = (o) => ['groups', 'levents', 'calcutta'].filter((k) => o[k] === true).join(',');
    const MAIN = { gate: true, guest: true }; // what main answers with every switch unset (gate on, guest mode on in this harness)
    const st0 = await status(); for (const k of ['groups', 'levents', 'calcutta']) assert.ok(!(k in st0), k); assert.strictEqual(keys(await me(bo)), ''); 
    const cases = [[{}, '', ''], [{ GROUPS_ENABLED: '1' }, 'groups', 'groups'], [{ LOCALEVENTS_ENABLED: '1' }, '', ''], [{ CALCUTTA_ENABLED: '1' }, 'calcutta', 'calcutta'], [{ GROUPS_ENABLED: '1', LOCALEVENTS_ENABLED: '1' }, 'groups,levents', 'groups,levents'],
      [{ GROUPS_ENABLED: '1', CALCUTTA_ENABLED: '1' }, 'groups,calcutta', 'groups,calcutta'], [{ LOCALEVENTS_ENABLED: '1', CALCUTTA_ENABLED: '1' }, 'calcutta', 'calcutta'], [{ GROUPS_ENABLED: '1', LOCALEVENTS_ENABLED: '1', CALCUTTA_ENABLED: '1' }, 'groups,levents,calcutta', 'groups,levents,calcutta'],
      [{ GROUPS_ENABLED: '1', LOCALEVENTS_ENABLED: '0', CALCUTTA_ENABLED: 'true' }, 'groups', 'groups']];
    for (const [env, sk, mk] of cases) { ['GROUPS_ENABLED', 'LOCALEVENTS_ENABLED', 'CALCUTTA_ENABLED'].forEach((k) => delete process.env[k]); Object.assign(process.env, env);
      const st = await status(); assert.strictEqual(keys(st), sk, 'status ' + J(env) + ' ' + J(st)); assert.deepStrictEqual(Object.keys(st).slice(0, 2), ['gate', 'guest']); assert.strictEqual(keys(await me(bo)), mk, 'me ' + J(env)); }
    { const m0 = { role: 'member', email: 'x@phone.oddable' }; ['GROUPS_ENABLED', 'LOCALEVENTS_ENABLED', 'CALCUTTA_ENABLED'].forEach((k) => delete process.env[k]); assert.strictEqual(ACCT.gFlag(m0, 'x@phone.oddable'), m0, 'all unset: the very same object (main)'); }
    ok('A (review D2): /acct/status and me say groups / levents / calcutta exactly as the switches allow, for 9 switch sets; all unset = main\'s answer and the very same `me`');

    let PW = null; for (const p of ['playwright', '/opt/npm-tools/node_modules/playwright']) { try { PW = require(p); break; } catch (e) {} }
    if (!PW) { console.log('  SKIPPED B and C: Playwright is not installed here (npm i playwright; npx playwright install chromium)'); throw 'skip'; }
    browser = await PW.chromium.launch();
    const open = async (who, link) => { const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' }), log = { files: [], errs: [] };
      await ctx.addInitScript(([t, nm, ph, pn]) => { if (!sessionStorage.getItem('__init')) { sessionStorage.setItem('__init', '1'); localStorage.setItem('odd-tok', t); localStorage.setItem('odd-name', nm); localStorage.setItem('sync-phone', ph); localStorage.setItem('sync-pin', pn); localStorage.setItem('odd-ok', '1'); } }, [who.tok, who.name, who.phone, who.pin]);
      await ctx.route('**/*', async (route) => { const u = route.request().url();
        if (u.startsWith(base)) { log.files.push(u.slice(base.length).split('?')[0]); return route.continue(); }
        if (u.startsWith('https://calcutta-odds.onrender.com/')) { try { return route.fulfill({ response: await route.fetch({ url: u.replace('https://calcutta-odds.onrender.com', base) }) }); } catch (e) { return route.abort(); } }
        if (/\.(js|css)(\?|$)/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: /espn/.test(u) ? '{"events":[]}' : '{}' }); });
      const page = await ctx.newPage(); page.on('pageerror', (e) => log.errs.push(String(e && e.message || e))); await page.goto(base + link); return { ctx, page, log }; };
    const settle = (page) => page.waitForTimeout(3500);
    const state = (page) => page.evaluate(() => ({ q: location.search, g: sessionStorage.getItem('odd-join'), e: sessionStorage.getItem('odd-join-e'), c: sessionStorage.getItem('odd-cjoin'), ogrp: !!document.getElementById('ogrp'), oevt: !!document.getElementById('oevt'), ocalc: !!document.getElementById('ocalc'),
      text: ['ogrp', 'oevt', 'ocalc'].map((id) => { const x = document.getElementById(id); return x ? x.innerText : ''; }).join(' | ').slice(0, 2000) }));

    // ---------- B. both ON ----------
    ON(); const cal = await person('9565552003', '135794', 'Cal');
    const grp = (await post('/groups/create', { name: 'Linkers', join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, take: { kind: 'none' }, contest: { cname: 'Picks standings', sport: 'nfl', fmt: 'standings', start: Date.now() + 5 * 864e5, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 4, metric: 'units', minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' }, myName: 'Ann' }, ann.tok)).group;
    await post('/groups/join', { code: grp.code, myName: 'Bo' }, bo.tok);
    const ev = (await post('/levents/create', { groupId: grp.id, title: 'Link Night', sport: 'pickleball', fmt: 'rr', unit: 'singles', to: 11, winBy: 2, bestOf: 1, start: Date.now() + 864e5, playIn: true, myName: 'Ann', entrants: [], self: true, spectators: true, seeding: 'random', courts: 2, pools: 1, playoff: 0, scorer: 'a', entry: 0, pot: 'main', split: 'none', take: { kind: 'none', v: 0 } }, ann.tok)).event;
    const calc = (await post('/calcutta/create', { name: 'Link Calcutta', ev: 'custom', lots: [{ teams: [{ name: 'Red' }] }, { teams: [{ name: 'Blue' }] }], rows: [{ k: 'champ', n: 1, pct: 100 }], minBid: 5, inc: 5, timer: 10, buyBack: false, take: { kind: 'none' }, order: 'listed', mode: 'manual' }, ann.tok)).calc;
    const links = { g: 'g.' + grp.code, e: 'e.' + ev.code, c: 'c.' + calc.code };
    { const { ctx, page, log } = await open(cal, '/?join=' + links.g + '&ref=R1'); await page.waitForSelector('#ogrp', { timeout: 15000 }); await settle(page); const s = await state(page);
      assert.strictEqual(s.q, '?ref=R1', 'g. link left the address bar'); assert.ok(s.ogrp && !s.oevt && !s.ocalc, J(s)); assert.ok(/Linkers/.test(s.text), 'the group\'s join screen: ' + s.text.slice(0, 200)); assert.deepStrictEqual(log.errs, []); await ctx.close(); }
    ok('B: both on, ?join=g.<code>: the GROUP join screen (#ogrp, "Linkers"), link out of the address bar, ?ref kept, no page errors');
    { const { ctx, page, log } = await open(bo, '/?join=' + links.e + '&ref=R1'); await page.waitForSelector('#oevt', { timeout: 15000 }); await page.waitForFunction(() => /Link Night/.test((document.getElementById('oevt') || {}).innerText || ''), null, { timeout: 15000 }); const s = await state(page);
      assert.strictEqual(s.q, '?ref=R1', 'e. link left the address bar'); assert.ok(s.oevt && !s.ocalc, J(s)); assert.ok(/Link Night/.test(s.text)); assert.strictEqual(s.e, null, 'the code was used'); assert.deepStrictEqual(log.errs, []); await ctx.close(); }
    ok('B: both on, ?join=e.<code> (a member of the group): the EVENT join screen (#oevt, "Link Night"), link out of the address bar');
    { const { ctx, page, log } = await open(cal, '/?join=' + links.c + '&ref=R1'); await page.waitForSelector('#ocalc', { timeout: 15000 }); await page.waitForFunction(() => /Link Calcutta/.test((document.getElementById('ocalc') || {}).innerText || ''), null, { timeout: 15000 }); const s = await state(page);
      assert.strictEqual(s.q, '?ref=R1', 'c. link left the address bar'); assert.ok(s.ocalc && !s.oevt, J(s)); assert.ok(/Link Calcutta/.test(s.text)); assert.deepStrictEqual(log.errs, []); await ctx.close(); }
    ok('B: both on, ?join=c.<code>: the CALCUTTA join screen (#ocalc, "Link Calcutta"), link out of the address bar');

    // ---------- C. both OFF (Groups on) ----------
    OFF();
    { const { ctx, page, log } = await open(cal, '/?join=' + links.g + '&ref=R1'); await page.waitForSelector('#ogrp', { timeout: 15000 }); await settle(page); const s = await state(page);
      assert.strictEqual(s.q, '?ref=R1'); assert.ok(s.ogrp && !s.oevt && !s.ocalc && /Linkers/.test(s.text), J(s)); assert.ok(!log.files.some((f) => /localevents\.js|calcutta\.js/.test(f)), J(log.files)); assert.deepStrictEqual(log.errs, []); await ctx.close(); }
    ok('C: both off, ?join=g.<code>: still the group join screen (Groups is main\'s); localevents.js / calcutta.js never requested');
    for (const k of ['e', 'c']) { const { ctx, page, log } = await open(bo, '/?join=' + links[k] + '&ref=R1'); await settle(page); await page.waitForTimeout(1500); const s = await state(page);
      assert.strictEqual(s.q, '?join=' + links[k] + '&ref=R1', k + '. link left alone in the address bar'); assert.ok(!s.oevt && !s.ocalc && !s.g && !s.e && !s.c, J(s)); assert.ok(!log.files.some((f) => /localevents\.js|calcutta\.js/.test(f)), J(log.files)); assert.deepStrictEqual(log.errs, []); await ctx.close(); }
    ok('C: both off, ?join=e.<code> and ?join=c.<code>: left alone (still in the address bar, nothing kept, no overlay, no file requested, no page errors)');
  } catch (e) { if (e !== 'skip') { failed++; console.error('FAIL', e && e.stack || e); } }
  if (browser) await browser.close().catch(() => {});
  console.log(failed ? '\nFAILED' : '\nPASS ' + n + ' join-link checks'); srv.close(); process.exit(failed ? 1 : 0);
});
