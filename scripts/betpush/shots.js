// Playwright checks for the v266 "Phone alerts for my bets" setting and the invitation card in pics/index.html, at 390 / 430 / 820 / 1180.
// The odds server, ESPN, the push service and the clock are faked; service workers are blocked (a real push cannot be tested in a headless browser).
// Run: (cd pics && python3 -m http.server 8813) then  NODE_PATH=<where playwright lives> BP_OUT=/some/dir node scripts/betpush/shots.js
const { chromium } = require('playwright');
const OUT = (process.env.BP_OUT || require('os').tmpdir()).replace(/\/?$/, '/'), PORT = +process.env.BP_PORT || 8813, BASE = 'http://localhost:' + PORT + '/index.html';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
const T0 = '2026-11-16T14:00:00-06:00', IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const today = '2026-11-16';
const fs = require('fs'), path = require('path');
const team = (id, ab, name, ha, score) => ({ id: String(id), homeAway: ha, score: String(score), team: { id: String(id), abbreviation: ab, displayName: name, shortDisplayName: name.split(' ').pop(), location: name, color: '0b3d91', logo: '' }, records: [{ summary: '6-3' }] });
const GAME = { id: '401', date: '2026-11-16T19:00Z', week: { number: 11 }, status: { period: 2, displayClock: '1:56', type: { state: 'in', shortDetail: '1:56 - 2nd', detail: '1:56 - 2nd Quarter', completed: false } }, competitions: [{ id: '401', date: '2026-11-16T19:00Z', competitors: [team(33, 'BAL', 'Baltimore Ravens', 'home', 7), team(24, 'LAC', 'Los Angeles Chargers', 'away', 17)], odds: [] }] };

// o: { betpush (appcfg flag), status (the /betpush/status answer), perm ('granted'|'denied'|'default'), sub (this device already has a push subscription), push (false = the browser has no push at all),
//      ua, touch, standalone, tok (false = signed out), ls, query, gate }
async function open(b, W, o = {}) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: W, height: W >= 1000 ? 820 : W >= 800 ? 1180 : 844 }, hasTouch: true, timezoneId: 'America/Chicago', locale: 'en-US', userAgent: o.ua });
  const p = await ctx.newPage(); const S = { calls: [], errs: [], status: o.status, setAnswer: null };
  p.on('pageerror', (e) => { S.errs.push(e.message); console.log('PAGEERR', e.message.slice(0, 300)); });
  await p.route('**/*', async (r) => {
    const u = r.request().url(), m = r.request().method(); const J = (obj, code) => r.fulfill({ status: code || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-token,x-dash', 'access-control-allow-methods': 'GET,POST,OPTIONS' }, body: JSON.stringify(obj) });
    if (u.startsWith('http://localhost:' + PORT)) { const pa = new URL(u).pathname; if (pa === '/model.js' || pa.startsWith('/data/')) return r.fulfill({ status: 200, contentType: pa.endsWith('.js') ? 'application/javascript' : 'application/json', body: fs.readFileSync(path.join(__dirname, '..', '..', 'public', pa)) }); return r.continue(); } // the live site serves the pool's model.js and data/ beside the app
    if (u.includes('calcutta-odds.onrender.com')) {
      const path = new URL(u).pathname; if (m === 'OPTIONS') return J({}, 204);
      let body = null; try { body = JSON.parse(r.request().postData() || 'null'); } catch (e) {}
      if (path.startsWith('/betpush') || path === '/appcfg' || path === '/acct/push-key') S.calls.push({ path, m, body, tok: r.request().headers()['x-token'] || '' });
      if (path === '/appcfg') return J(o.betpush ? { ok: true, card_theme: 'oddable', betpush: true } : { ok: true, card_theme: 'oddable' });
      if (path === '/betpush/status') return J(S.status || { enabled: false, on: false, hasDevice: false, mode: 'off', bb: 'q', finals: true });
      if (path === '/betpush/set') { if (o.setFail) return J({ error: o.setFail }, 400); S.status = Object.assign({}, S.status, { ok: true, enabled: true, on: body.on !== false, mode: body.on === false ? 'off' : 'bets', hasDevice: !!(body.subscription || (S.status && S.status.hasDevice)), bb: body.bb || (S.status && S.status.bb) || 'q', test: true }); return J(S.status); }
      if (path === '/betpush/test') return J({ ok: true, sent: 1 });
      if (path === '/betpush/here') return J({ ok: true });
      if (path === '/acct/push-key') return J({ key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' });
      if (path === '/acct/status') return J({ gate: !!o.gate });
      if (path === '/acct/me') return J({ me: { email: 'abc@phone.oddable', role: 'user', plan: 'pro', expires_on: null, source: 'trial', allowed: true, pending: false, price: 99, payReady: true } });
      return J({});
    }
    if (u.includes('site.api.espn.com') && u.includes('/scoreboard')) return J({ events: u.includes('football/nfl/') && !/week=(?!11\b)/.test(u) ? [GAME] : [], week: { number: 11 }, season: { year: 2026, type: 2 }, leagues: [{ calendar: [] }] });
    return r.abort();
  });
  await p.clock.install({ time: new Date(o.now || T0) });
  const seed = Object.assign({ 'pics-lg': 'nfl' }, o.tok === false ? {} : { 'odd-tok': 'tok-1', 'odd-ok': String(Date.parse(o.now || T0)), 'odd-name': 'Tester' }, o.ls || {});
  await p.addInitScript((a) => {
    try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); Object.keys(a.seed).forEach((k) => localStorage.setItem(k, a.seed[k])); } } catch (e) {}
    window.__asked = 0; window.__subscribed = 0;
    const fakeSub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'P', auth: 'A' } }; } };
    let sub = a.sub ? fakeSub : null;
    const reg = { update: async () => {}, pushManager: { getSubscription: async () => sub, subscribe: async () => { window.__subscribed++; sub = fakeSub; return sub; } } };
    const sw = { ready: Promise.resolve(reg), getRegistration: async () => reg, getRegistrations: async () => [], register: async () => reg, addEventListener() {}, controller: null };
    if (a.push === false) { try { delete window.PushManager; } catch (e) {} Object.defineProperty(window, 'PushManager', { value: undefined, configurable: true }); delete window.PushManager; Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => sw, configurable: true }); }
    else { Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => sw, configurable: true }); window.PushManager = window.PushManager || function () {}; }
    let perm = a.perm || 'default';
    if (a.push !== false) window.Notification = { get permission() { return perm === 'ask-granted' ? (window.__asked ? 'granted' : 'default') : perm; }, requestPermission: async () => { window.__asked++; return perm === 'ask-granted' ? 'granted' : perm; } };
    else { try { delete window.Notification; } catch (e) {} }
    if (a.touch) Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => a.touch, configurable: true });
    if (a.standalone) Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
  }, { seed, sub: !!o.sub, push: o.push, perm: o.perm, touch: o.touch, standalone: o.standalone });
  await p.goto(BASE + (o.query || ''), { waitUntil: 'load' }); await p.clock.runFor(4200); await p.waitForTimeout(250); await p.clock.runFor(1200); await p.waitForTimeout(150);
  return { ctx, p, S };
}
const bp = (S, path) => S.calls.filter((c) => c.path.startsWith(path || '/betpush'));
const card = (p) => p.evaluate(() => { const c = document.getElementById('bpinv'); if (!c || c.hidden || !c.getBoundingClientRect().height) return null; const r = c.getBoundingClientRect(), cs = getComputedStyle(c); return { text: c.innerText.replace(/\s+/g, ' ').trim(), small: c.classList.contains('sm'), pos: cs.position, top: Math.round(r.top), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), next: c.nextElementSibling && c.nextElementSibling.id, buttons: [...c.querySelectorAll('button')].map((x) => { const q = x.getBoundingClientRect(); return [x.textContent.trim() || x.getAttribute('aria-label'), Math.round(q.width), Math.round(q.height)]; }) }; });
const rect = (p, sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null; }, sel);
const topOf = (p, sel) => p.evaluate((sel) => Math.round(document.querySelector(sel).getBoundingClientRect().top), sel);
const noSide = (p) => p.evaluate(() => { const sc = document.getElementById('sc'); let worst = 0, who = ''; document.querySelectorAll('#bpinv, #bpinv *, #bpset, #bpset *').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) { worst = Math.max(worst, r.right - innerWidth, -r.left); who = el.id || el.className; } }); return { doc: Math.max(document.documentElement.scrollWidth - innerWidth, sc ? sc.scrollWidth - sc.clientWidth : 0), worst, who }; });
// the card must not be under any fixed UI: the My Bets banner, the bottom bar / rail, the header menus
const covered = (p, sel) => p.evaluate((sel) => { const c = document.querySelector(sel); if (!c) return ['missing']; const r = c.getBoundingClientRect(), out = []; ['#plb', '#bn', '#lgsel', '#gvsel', '#spop'].forEach((s) => { const x = document.querySelector(s); if (!x || x.hidden) return; const q = x.getBoundingClientRect(); if (q.width && q.height && q.left < r.right - 1 && q.right > r.left + 1 && q.top < r.bottom - 1 && q.bottom > r.top + 1) out.push(s); }); return out; }, sel);
const openDisc = async (p) => { await p.evaluate(() => { document.querySelector('details.dsc').open = true; document.getElementById('bpset').scrollIntoView({ block: 'center' }); }); await p.waitForTimeout(80); };
const setting = (p) => p.evaluate(() => ({ sel: document.getElementById('bpsel').value, msg: document.getElementById('bpmsg').textContent, bb: !document.getElementById('bpbbw').hidden, bbv: document.getElementById('bpbb').value, test: !document.getElementById('bptest').hidden, text: document.getElementById('bpset').innerText.replace(/\s+/g, ' ').trim() }));
const pick = async (p, id, v) => { await p.selectOption('#' + id, v); await p.waitForTimeout(250); await p.clock.runFor(300); await p.waitForTimeout(100); };
const tapYes = async (p) => { await p.locator('#bpiy').click(); await p.waitForTimeout(250); await p.clock.runFor(300); await p.waitForTimeout(100); };
// The page checks the card once a second. Playwright's clock also runs in real time, and now and then a jump lands short (seen: 1 of 48 repeats, 0.6 s short), so a view change is given two jumps.
const turn = async (p, v) => { await p.evaluate((v) => setView(v), v); await p.clock.runFor(1500); await p.waitForTimeout(60); await p.clock.runFor(1500); await p.waitForTimeout(40); };
const OFFST = { enabled: true, on: false, hasDevice: false, mode: 'off', bb: 'q', finals: true, test: true };
const bet = (extra) => JSON.stringify([Object.assign({ id: 'b1', gid: '401', side: 'LAC', type: 'sp', line: 4.5, stake: 50, day: today, t: 1 }, extra || {})]);

// The floating My Bets banner (shown when the player has a bet today) with and without the card: same place, same size, never over the card.
async function banner(b, W) {
  let x = await open(b, W, { ls: { bets26: bet() } }); const plb0 = await rect(x.p, '#plb'), bn0 = await rect(x.p, '#bn'); ok(!!plb0, 'I banner is up without the card (' + W + ')'); eq(await card(x.p), null, 'I no card with the switch off'); await x.ctx.close();
  for (const [name, o] of [['card', {}], ['one-line card', { sub: true, perm: 'granted' }]]) {
    x = await open(b, W, Object.assign({ betpush: true, status: OFFST, ls: { bets26: bet() } }, o)); const p = x.p; ok(!!(await card(p)), 'I ' + name + ' up on Games');
    eq(await rect(p, '#plb'), plb0, 'I ' + name + ': banner in the same place, same size'); eq(await rect(p, '#bn'), bn0, 'I ' + name + ': bottom bar same'); eq(await covered(p, '#bpinv'), [], 'I ' + name + ': card under no fixed UI');
    await turn(p, 'bets'); ok(!!(await card(p)), 'I ' + name + ' up on My Bets'); eq(await covered(p, '#bpinv'), [], 'I ' + name + ' on My Bets: under no fixed UI (banner included)');
    const s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'I ' + name + ' no sideways scroll'); if (name === 'card') await p.screenshot({ path: OUT + 'bp-card-banner-' + W + '.png' });
    await tapYes(p); const c = await card(p); eq(await rect(p, '#plb') !== null, true, 'I banner still up after the tap'); eq(await covered(p, '#bpinv'), [], 'I ' + name + ' with its message: under no fixed UI ' + (c && c.text)); await x.ctx.close();
  }
}
(async () => {
  const b = await chromium.launch();
  for (const W of [390, 430, 820, 1180]) {
    if (process.env.BP_ONLY === 'settled') { for (let i = 0; i < 30; i++) { const x = await open(b, W, { betpush: true, status: OFFST, ls: { bets26: bet({ fin: 'won' }) } }); const before = await card(x.p); await turn(x.p, 'bets'); const c = await card(x.p); if (c) console.log('FLAKE', i, JSON.stringify({ before: !!before, st: await x.p.evaluate(() => ({ view: VIEW, shown: BP.shown, gone: BP.gone, t: BP.t, en: BP.enabled, has: !!BP.st, now: Date.now() })) })); else pass++; await x.ctx.close(); } continue; }
    await banner(b, W); if (process.env.BP_ONLY === 'banner') continue;
    console.log('== width ' + W);
    // ---- A. server switch OFF: no card, no /betpush request at all (the page learns "off" from the /appcfg call it already makes), the setting says so ----
    let x = await open(b, W, {}), p = x.p, S = x.S;
    eq(await card(p), null, 'A no card'); eq(bp(S).length, 0, 'A no /betpush request'); eq(S.calls.filter((c) => c.path === '/appcfg').length, 1, 'A one /appcfg (as before v266)');
    const plbA = await rect(p, '#plb'), bnA = await rect(p, '#bn'), nbA = await topOf(p, '#nb'), lgA = await rect(p, '#lgsel');
    await openDisc(p); let st = await setting(p); eq([st.sel, st.bb, st.test], ['off', false, false], 'A setting off');
    ok(st.text.includes('Phone alerts for my bets: every score, and the final.') && st.text.includes('Needs Oddable added to your Home Screen on iPhone or iPad, and notifications allowed.'), 'A setting text: ' + st.text);
    let s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'A no sideways scroll ' + JSON.stringify(s)); eq(await covered(p, '#bpsel'), [], 'A setting not under fixed UI');
    const selR = await rect(p, '#bpsel'); ok(selR && selR[3] >= 44, 'A select 44 high ' + selR);
    await p.screenshot({ path: OUT + 'bp-setting-off-' + W + '.png' });
    await pick(p, 'bpsel', 'on'); st = await setting(p); eq([st.sel, st.msg], ['off', 'Alerts are not switched on at the server yet.'], 'A choosing On says the server is off'); eq(bp(S).length, 0, 'A still no /betpush request'); eq(await p.evaluate(() => window.__asked), 0, 'A no permission question');
    eq(S.errs, [], 'A no page errors'); await x.ctx.close();
    // signed out: nothing, even with the server on
    x = await open(b, W, { betpush: true, status: OFFST, tok: false }); eq(await card(x.p), null, 'A2 signed out: no card'); eq(bp(x.S).length, 0, 'A2 signed out: no /betpush request'); await x.ctx.close();
    // mirror copy (?mirror=1): nothing
    x = await open(b, W, { betpush: true, status: OFFST, query: '?mirror=1' }); eq(await card(x.p), null, 'A3 mirror: no card'); eq(bp(x.S).length, 0, 'A3 mirror: no /betpush request'); await x.ctx.close();

    // ---- B. server ON, setting off, no subscription: the card, in the page flow above the list; nothing fixed moves ----
    x = await open(b, W, { betpush: true, status: OFFST, perm: 'ask-granted' }); p = x.p; S = x.S;
    let c = await card(p); ok(!!c, 'B card shown'); eq(bp(S).map((q) => q.path + ' ' + q.m + ' ' + q.tok), ['/betpush/status GET tok-1'], 'B exactly one /betpush/status per load');
    if (c) {
      eq(c.text, '🔔 Get score alerts for your bets. A notification every time a game you bet on scores, even with Oddable closed. Turn on Not now', 'B text'); eq([c.small, c.pos, c.next], [false, 'static', 'nb'], 'B in flow, before the list');
      ok(c.buttons.length === 2 && c.buttons.every((q) => q[2] >= 44), 'B buttons 44 high ' + JSON.stringify(c.buttons)); ok(c.left >= 0 && c.right <= W, 'B inside the screen');
    }
    eq(await rect(p, '#plb'), plbA, 'B My Bets banner did not move'); eq(await rect(p, '#bn'), bnA, 'B bottom bar did not move'); eq(await rect(p, '#lgsel'), lgA, 'B header menu did not move');
    const nbB = await topOf(p, '#nb'); ok(c && nbB >= nbA + c.h, 'B the list starts below the card (' + JSON.stringify([nbA, nbB, c && c.h]) + ')');
    eq(await covered(p, '#bpinv'), [], 'B card under no fixed UI'); s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'B no sideways scroll ' + JSON.stringify(s));
    await p.screenshot({ path: OUT + 'bp-card-' + W + '.png' });
    // Not now (1st): gone, 14 days
    await p.locator('#bpin').click(); await p.clock.runFor(2500); eq(await card(p), null, 'B Not now hides it'); eq(await topOf(p, '#nb'), nbA, 'B list back where it was');
    let iv = await p.evaluate(() => JSON.parse(localStorage.getItem('pics-bpinv'))); eq(iv.n, 1, 'B first Not now stored');
    await turn(p, 'bets'); await turn(p, 'main'); eq(await card(p), null, 'B not again in this app open');
    await p.reload(); await p.clock.runFor(5500); await p.waitForTimeout(250); await p.clock.runFor(1500); eq(await card(p), null, 'B reload next minute: hidden (14 days)');
    await x.ctx.close();
    const at = (d) => new Date(Date.parse(T0) + d * 864e5).toISOString(), saved = (n) => ({ 'pics-bpinv': JSON.stringify({ n, t: Date.parse(T0) }) });
    x = await open(b, W, { betpush: true, status: OFFST, ls: saved(1), now: at(13.9) }); eq(await card(x.p), null, 'B day 13.9: still hidden'); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST, ls: saved(1), now: at(14.1) }); ok(!!(await card(x.p)), 'B day 14.1: shown again');
    await x.p.locator('#bpin').click(); await x.p.clock.runFor(1500); iv = await x.p.evaluate(() => JSON.parse(localStorage.getItem('pics-bpinv'))); eq(iv.n, 2, 'B second Not now stored'); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST, ls: saved(2), now: at(400), perm: 'ask-granted' }); p = x.p; S = x.S; eq(await card(p), null, 'B after the second Not now: never again'); eq(await p.evaluate(() => window.__asked), 0, 'B the permission question was never asked by the page itself');
    // ...but the setting in Disclosures still works after "never"
    await openDisc(p); await pick(p, 'bpsel', 'on'); st = await setting(p); eq([st.sel, st.msg, st.bb, st.test], ['on', 'Allowed. Alerts are on for this phone.', true, true], 'B setting On after dismissals');
    eq(S.errs, [], 'B no page errors'); await x.ctx.close();

    // ---- C. Turn on from the card (Android / desktop Chrome, permission allowed on the tap) ----
    x = await open(b, W, { betpush: true, status: OFFST, perm: 'ask-granted' }); p = x.p; S = x.S; eq(await p.evaluate(() => window.__asked), 0, 'C no permission question before the tap');
    await tapYes(p); eq(await p.evaluate(() => [window.__asked, window.__subscribed]), [1, 1], 'C asked once, on the tap; subscribed once');
    eq(S.calls.filter((q) => q.path !== '/appcfg' && q.path !== '/betpush/here').map((q) => q.path), ['/betpush/status', '/acct/push-key', '/betpush/set'], 'C calls in order');
    eq(bp(S, '/betpush/set')[0].body, { on: true, mode: 'bets', subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'P', auth: 'A' } } }, 'C set body'); eq(bp(S, '/betpush/set')[0].tok, 'tok-1', 'C token in x-token');
    c = await card(p); ok(c && c.text === '🔔 Alerts are on for this phone.', 'C card confirms: ' + (c && c.text)); await p.clock.runFor(5000); eq(await card(p), null, 'C then goes away'); eq(await p.evaluate(() => localStorage.getItem('pics-bpinv')), null, 'C turning on is not a dismissal'); eq(await p.evaluate(() => localStorage.getItem('odd-push')), '1', 'C the Account box knows this phone is registered (same subscription as the renewal reminders)');
    ok(bp(S, '/betpush/here').length >= 1, 'C tells the server the app is open'); const h0 = bp(S, '/betpush/here').length; await p.clock.runFor(51000); await p.waitForTimeout(100); eq(bp(S, '/betpush/here').length, h0 + 2, 'C every 25 s while open');
    await openDisc(p); st = await setting(p); eq([st.sel, st.bb, st.bbv, st.test], ['on', true, 'q', true], 'C setting shows On, basketball choice, test button');
    ok(st.text.includes('Basketball') && st.text.includes('Every score in basketball can mean 150+ alerts a game.'), 'C basketball helper'); s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'C no sideways scroll ' + JSON.stringify(s)); eq(await covered(p, '#bpbb'), [], 'C basketball menu not under fixed UI'); eq(await covered(p, '#bptest'), [], 'C test button not under fixed UI');
    await p.screenshot({ path: OUT + 'bp-setting-on-' + W + '.png' });
    await pick(p, 'bpbb', 'all'); eq(bp(S, '/betpush/set').pop().body, { on: true, mode: 'bets', bb: 'all' }, 'C basketball every score saved'); eq((await setting(p)).bbv, 'all', 'C basketball menu keeps it');
    await p.locator('#bptest').click(); await p.waitForTimeout(250); eq(bp(S, '/betpush/test').length, 1, 'C test sent'); eq((await setting(p)).msg, 'Test sent. It should show on this phone in a few seconds.', 'C test message');
    await pick(p, 'bpsel', 'off'); eq(bp(S, '/betpush/set').pop().body, { on: false }, 'C off saved'); st = await setting(p); eq([st.sel, st.msg, st.bb, st.test], ['off', 'Alerts are off.', false, false], 'C setting Off');
    const h1 = bp(S, '/betpush/here').length; await p.clock.runFor(60000); eq(bp(S, '/betpush/here').length, h1, 'C no "app is open" calls once off'); eq(S.errs, [], 'C no page errors'); await x.ctx.close();

    // ---- D. blocked in Settings / dismissed question / no push in this browser / server refuses ----
    x = await open(b, W, { betpush: true, status: OFFST, perm: 'denied' }); p = x.p; await tapYes(p); c = await card(p); ok(c && c.text.includes('Blocked in Settings. Allow notifications for Oddable in your phone\'s Settings, then turn this on again.'), 'D blocked: ' + (c && c.text)); eq(bp(x.S, '/betpush/set').length, 0, 'D blocked: nothing saved');
    s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'D no sideways scroll ' + JSON.stringify(s)); await openDisc(p); await pick(p, 'bpsel', 'on'); st = await setting(p); eq(st.sel, 'off', 'D setting stays Off'); ok(st.msg.startsWith('Blocked in Settings.'), 'D setting says blocked'); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST, perm: 'default' }); await tapYes(x.p); c = await card(x.p); ok(c && c.text.includes('Notifications were not allowed.'), 'D question dismissed: ' + (c && c.text)); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST, push: false }); await tapYes(x.p); c = await card(x.p); ok(c && c.text.includes('This browser cannot get alerts.'), 'D no push: ' + (c && c.text)); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST, perm: 'granted', setFail: 'Sign in with your cell number and PIN to get alerts for your bets' }); await tapYes(x.p); c = await card(x.p); ok(c && c.text.includes('Sign in with your cell number and PIN to get alerts for your bets'), 'D server refusal shown: ' + (c && c.text)); await x.ctx.close();

    // ---- E. iPhone and iPad in a browser tab: the Home Screen steps, the card stays, no permission question, not counted as a dismissal ----
    for (const [name, ua, touch] of [['iPhone', IPHONE, 5], ['iPad saying Macintosh', IPAD, 5]]) {
      x = await open(b, W, { betpush: true, status: OFFST, ua, touch, push: false }); p = x.p; await tapYes(p); c = await card(p);
      ok(c && c.text.includes('Add to Home Screen first. 1. Tap Share. 2. Add to Home Screen. 3. Open Oddable from that icon and tap Turn on again.'), 'E ' + name + ' steps: ' + (c && c.text)); ok(c && c.buttons.length === 2, 'E ' + name + ' card kept with both buttons');
      eq(await p.evaluate(() => localStorage.getItem('pics-bpinv')), null, 'E ' + name + ' not a dismissal'); eq(bp(x.S, '/betpush/set').length, 0, 'E ' + name + ' nothing saved'); s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'E ' + name + ' no sideways scroll ' + JSON.stringify(s)); eq(await covered(p, '#bpinv'), [], 'E ' + name + ' card under no fixed UI');
      if (name === 'iPhone') await p.screenshot({ path: OUT + 'bp-card-ios-' + W + '.png' });
      await p.reload(); await p.clock.runFor(5500); await p.waitForTimeout(250); await p.clock.runFor(1500); ok(!!(await card(p)), 'E ' + name + ' card is there next time');
      await openDisc(p); await pick(p, 'bpsel', 'on'); st = await setting(p); eq(st.sel, 'off', 'E ' + name + ' setting stays Off'); ok(st.msg.startsWith('Add to Home Screen first.'), 'E ' + name + ' setting shows the steps: ' + st.msg); await x.ctx.close();
    }
    // a real Mac (Macintosh, no touch) is not an iPad; an iPhone opened from the Home Screen icon goes straight to the permission question
    x = await open(b, W, { betpush: true, status: OFFST, ua: IPAD, touch: 0, perm: 'ask-granted' }); await tapYes(x.p); eq(bp(x.S, '/betpush/set').length, 1, 'E a Mac turns on normally'); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST, ua: IPHONE, touch: 5, standalone: true, perm: 'ask-granted' }); await tapYes(x.p); eq(await x.p.evaluate(() => window.__asked), 1, 'E iPhone from the Home Screen: asked'); eq(bp(x.S, '/betpush/set').length, 1, 'E iPhone from the Home Screen: on'); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST, ua: IPHONE, touch: 5, standalone: true, push: false }); await tapYes(x.p); c = await card(x.p); ok(c && c.text.includes('Alerts need iOS or iPadOS 16.4 or newer.'), 'E old iOS on the Home Screen: ' + (c && c.text)); await x.ctx.close();

    // ---- F. this phone already allowed notifications (renewal reminders): the one-line version, no permission question ----
    x = await open(b, W, { betpush: true, status: OFFST, sub: true, perm: 'granted' }); p = x.p; c = await card(p); ok(c && c.small && c.text.startsWith('Score alerts for your bets are available. Turn on'), 'F one line: ' + JSON.stringify(c));
    ok(c && c.buttons.every((q) => q[1] >= 44 && q[2] >= 44), 'F buttons 44+ ' + JSON.stringify(c && c.buttons)); eq(await covered(p, '#bpinv'), [], 'F under no fixed UI'); s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'F no sideways scroll'); eq(await rect(p, '#plb'), plbA, 'F banner did not move');
    await p.screenshot({ path: OUT + 'bp-card-small-' + W + '.png' }); await openDisc(p); eq((await setting(p)).sel, 'off', 'F setting is still Off by default'); await p.evaluate(() => { document.querySelector('details.dsc').open = false; document.getElementById('sc').scrollTop = 0; });
    await tapYes(p); eq(await p.evaluate(() => [window.__asked, window.__subscribed]), [0, 0], 'F no question, no new subscription'); eq(x.S.calls.filter((q) => q.path === '/acct/push-key').length, 0, 'F no key needed'); eq(bp(x.S, '/betpush/set').length, 1, 'F on'); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST, sub: true, perm: 'granted' }); await x.p.locator('#bpin').click(); await x.p.clock.runFor(1500); eq(await card(x.p), null, 'F ✕ = Not now'); eq((await x.p.evaluate(() => JSON.parse(localStorage.getItem('pics-bpinv')))).n, 1, 'F ✕ stored'); await x.ctx.close();

    // ---- G. already on (this device): no card; on for the account but not on this device: card offers this device ----
    x = await open(b, W, { betpush: true, status: Object.assign({}, OFFST, { on: true, hasDevice: true, mode: 'bets' }), sub: true, perm: 'granted' }); eq(await card(x.p), null, 'G already on: no card'); await openDisc(x.p); eq((await setting(x.p)).sel, 'on', 'G setting On'); eq(bp(x.S, '/betpush/status').length, 1, 'G one status'); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: Object.assign({}, OFFST, { on: true, hasDevice: true, mode: 'bets' }), perm: 'default' }); ok(!!(await card(x.p)), 'G on elsewhere, not on this device: card'); await openDisc(x.p); eq((await setting(x.p)).sel, 'off', 'G this device shows Off'); await x.ctx.close();
    // the server says enabled in /appcfg but /betpush/status says not: nothing
    x = await open(b, W, { betpush: true, status: { enabled: false, on: false, hasDevice: false, mode: 'off' } }); eq(await card(x.p), null, 'G status says off: no card'); await x.ctx.close();

    // ---- H. never over a sheet / the sign-in gate; My Bets only with an open bet today ----
    x = await open(b, W, { betpush: true, status: OFFST, gate: true, tok: false }); eq(await card(x.p), null, 'H sign-in gate: no card'); ok(await x.p.locator('#gate').count() === 1, 'H gate is up'); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST, ls: { 'pics-bpinv': JSON.stringify({ n: 1, t: Date.parse(T0) - 13 * 864e5 }) } }); eq(await card(x.p), null, 'H dismissed 13 days ago: hidden'); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST, ls: { 'pics-bpinv': 'junk{' } }); ok(!!(await card(x.p)), 'H unreadable saved value: shown'); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST }); p = x.p; ok(!!(await card(p)), 'H card up'); await turn(p, 'bets'); eq(await card(p), null, 'H My Bets without an open bet today: not shown'); await turn(p, 'main'); ok(!!(await card(p)), 'H back on Games'); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST, ls: { bets26: bet() } }); p = x.p; await turn(p, 'bets'); c = await card(p); ok(c && c.next === 'betspage', 'H My Bets with an open bet today: shown above the bets ' + JSON.stringify(c && c.next));
    eq(await covered(p, '#bpinv'), [], 'H on My Bets under no fixed UI'); s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'H My Bets no sideways scroll'); await p.screenshot({ path: OUT + 'bp-card-bets-' + W + '.png' }); await x.ctx.close();
    x = await open(b, W, { betpush: true, status: OFFST, ls: { bets26: bet({ fin: 'won' }) } }); await turn(x.p, 'bets'); eq(await card(x.p), null, 'H a settled bet does not count'); await x.ctx.close();
    // a sheet opened before the card's first showing holds it back until the sheet closes
    x = await open(b, W, { betpush: true, status: OFFST, ls: { 'pics-view': 'bets' } }); p = x.p; eq(await card(p), null, 'H started on My Bets with no bet: not shown'); await p.evaluate(() => { sheetOpen('<p>hello</p>'); setView('main'); }); await p.clock.runFor(3000); eq(await card(p), null, 'H not shown while a sheet is open'); await p.evaluate(() => sheetClose()); await p.clock.runFor(1500); ok(!!(await card(p)), 'H shown once the sheet is closed'); await x.ctx.close();
    // a tapped alert ("?open=bets") opens My Bets
    x = await open(b, W, { query: '?open=bets' }); eq(await x.p.evaluate(() => [VIEW, location.search]), ['bets', ''], 'H ?open=bets opens My Bets'); await x.ctx.close();
  }
  await b.close();
  console.log('betpush shots: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
