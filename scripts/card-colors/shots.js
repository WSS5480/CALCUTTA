// v281 Playwright: bet card colours (default oddable preset = My Bets tile colours) in all four presets, My Bets + Today's bets sheet, 390 / 820 / 1180. Everything mocked.
// Run: NEW_PORT=8821 OLD_PORT=8822 CC_OUT=/tmp/cc node scripts/card-colors/shots.js (OLD_PORT = the v280 pics/ build for the text / count / button comparison)
// Kalshi, the odds server and ESPN are MOCKED: no request leaves the browser, no order is ever placed.
// Run: serve the new pics/ on NEW_PORT and (optional) the previous build's pics/ on OLD_PORT (python3 -m http.server), then
//   NEW_PORT=8821 OLD_PORT=8822 KS_OUT=/tmp/ks node scripts/kco-single/shots.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const NEW = +process.env.NEW_PORT || 8821, OLD = +process.env.OLD_PORT || 0, OUT = (process.env.CC_OUT || require('os').tmpdir()).replace(/\/?$/, '/');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
const T0 = '2026-11-16T14:00:00-06:00', today = '2026-11-16';
const PEM = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
const team = (id, ab, name, ha, score) => ({ id: String(id), homeAway: ha, score: String(score), team: { id: String(id), abbreviation: ab, displayName: name, shortDisplayName: name.split(' ').pop(), location: name, color: '0b3d91', logo: '' }, records: [{ summary: '6-3' }] });
const GAME = { id: '401', date: '2026-11-16T19:00Z', week: { number: 11 }, status: { period: 2, displayClock: '1:56', type: { state: 'in', shortDetail: '1:56 - 2nd', detail: '1:56 - 2nd Quarter', completed: false } }, competitions: [{ id: '401', date: '2026-11-16T19:00Z', competitors: [team(33, 'BAL', 'Baltimore Ravens', 'home', 7), team(24, 'LAC', 'Los Angeles Chargers', 'away', 17)], odds: [] }] };
const GAME2 = { id: '402', date: '2026-11-16T01:00Z', week: { number: 11 }, status: { period: 4, displayClock: '0:00', type: { state: 'post', shortDetail: 'Final', detail: 'Final', completed: true } }, competitions: [{ id: '402', date: '2026-11-16T01:00Z', competitors: [team(12, 'KC', 'Kansas City Chiefs', 'home', 27), team(20, 'NYJ', 'New York Jets', 'away', 20)], odds: [] }] };
const BETS0 = [
  { id: 'b1', gid: '401', side: 'LAC', type: 'sp', line: 4.5, stake: 50, day: today, t: 1 },
  { id: 'k-KXYES-yes', kind: 'prop', src: 'kalshi', kt: 'KXYES', ks: 'yes', kn: 10, text: 'Chiefs · Will the Chiefs win', stake: 4.2, mult: 2.38, odds: -110, res: null, day: today, t: 2, week: 11, cash: null, soldN: 0 },
  { id: 'k-KXNO-no', kind: 'prop', src: 'kalshi', kt: 'KXNO', ks: 'no', kn: 8.6, text: 'No · Will the Jets win', stake: 3.1, mult: 2.77, odds: -110, res: null, day: today, t: 3, week: 11, cash: null, soldN: 0 },
  { id: 'k-KXMVE-yes', kind: 'parlay', src: 'kalshi', kt: 'KXMVE', ks: 'yes', kn: 20, legs: [{ text: 'Alabama to win' }, { text: 'Ohio State to win' }], stake: 5, mult: 4, odds: -110, day: today, t: 4, week: 11, cash: null, soldN: 0 },
  { id: 'k-KXDONE-yes', kind: 'prop', src: 'kalshi', kt: 'KXDONE', ks: 'yes', kn: 0, text: 'Bills · Will the Bills win', stake: 2, mult: 2, odds: -110, res: 'won', day: today, t: 5, week: 11, cash: 3.5, soldN: 5 },
];
// o: { port, me (the /acct/me answer, null = signed out), gate, mk (market book: ticker -> {yes_bid, no_bid, status}) }
async function open(b, W, o) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: W, height: W >= 1000 ? 820 : W >= 800 ? 1180 : 844 }, timezoneId: 'America/Chicago', locale: 'en-US' });
  const p = await ctx.newPage(); const S = { orders: [], errs: [], mk: o.mk || {}, sellFill: null, meCalls: 0 };
  p.on('pageerror', (e) => S.errs.push(e.message));
  await p.route('**/*', async (r) => {
    const u = r.request().url(), m = r.request().method(); const J = (obj, code) => r.fulfill({ status: code || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-token,x-dash', 'access-control-allow-methods': 'GET,POST,OPTIONS' }, body: JSON.stringify(obj) });
    if (u.startsWith('http://localhost:')) { const pa = new URL(u).pathname; if (pa === '/model.js' || pa.startsWith('/data/')) return r.fulfill({ status: 200, contentType: pa.endsWith('.js') ? 'application/javascript' : 'application/json', body: fs.readFileSync(path.join(__dirname, '..', '..', 'public', pa)) }); return r.continue(); }
    if (u.includes('calcutta-odds.onrender.com')) {
      const pa = new URL(u).pathname; if (m === 'OPTIONS') return J({}, 204);
      let body = null; try { body = JSON.parse(r.request().postData() || 'null'); } catch (e) {}
      if (pa === '/kalshi/order') { S.orders.push(body); return J({ order: { status: 'executed', fill_count: body.order.count, order_id: 'o-' + S.orders.length } }); } // MOCK: nothing goes to Kalshi
      if (pa === '/kalshi/proxy') {
        const kp = body.path || ''; const mm = kp.match(/^\/markets\/(.+)$/);
        if (mm) { const t = decodeURIComponent(mm[1]), x = S.mk[t]; return J({ market: x ? Object.assign({ ticker: t, status: 'active' }, x) : { ticker: t, status: 'closed' } }); }
        if (kp === '/portfolio/fills') return J({ fills: S.sellFill || [], cursor: '' });
        return J({ settlements: [], cursor: '' });
      }
      if (pa === '/appcfg') return J({ ok: true, card_theme: o.theme || 'oddable' });
      if (pa === '/acct/status') return J({ gate: o.gate !== false, guest: true });
      if (pa === '/acct/me') { S.meCalls++; return o.me ? J({ me: o.me }) : J({ error: 'no' }, 401); }
      return J({});
    }
    if (u.includes('site.api.espn.com') && u.includes('/scoreboard')) return J({ events: u.includes('football/nfl/') && !/week=(?!11\b)/.test(u) ? [GAME, GAME2] : [], week: { number: 11 }, season: { year: 2026, type: 2 }, leagues: [{ calendar: [] }] });
    return r.abort();
  });
  await p.clock.install({ time: new Date(T0) });
  const seed = Object.assign({ 'pics-lg': 'nfl', 'pics-view': 'bets', bets26: JSON.stringify(o.bets || BETS), 'kal-id': '11111111-2222-3333-4444-555555555555', 'kal-pem': PEM }, o.me ? { 'odd-tok': 'tok-1', 'odd-ok': String(Date.parse(T0)), 'odd-name': 'Tester', 'odd-gate': '1' } : {});
  await p.addInitScript((a) => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); Object.keys(a).forEach((k) => localStorage.setItem(k, a[k])); } } catch (e) {} }, seed);
  await p.goto('http://localhost:' + o.port + '/index.html', { waitUntil: 'load' });
  await settle(p);
  return { ctx, p, S };
}
const settle = async (p, n = 3) => { for (let i = 0; i < n; i++) { await p.clock.runFor(1500); await p.waitForTimeout(200); } };
const box = (p, id) => p.evaluate((id) => { const e = [...document.querySelectorAll('[data-kco]')].find((x) => x.getAttribute('data-kco') === id); if (!e) return null; const bt = e.querySelector('button'); const r = bt && bt.getBoundingClientRect(); return { text: e.innerText.replace(/\s+/g, ' ').trim(), btn: bt ? [bt.textContent.trim(), Math.round(r.height)] : null }; }, id);
const cardOf = (p, id) => p.evaluate((id) => { const e = [...document.querySelectorAll('[data-kco]')].find((x) => x.getAttribute('data-kco') === id); const c = e && e.closest('.mbc'); return c ? c.innerText.replace(/\s+/g, ' ').trim() : null; }, id);
const sums = (p) => p.evaluate(() => { const s = document.querySelector('#betspage .sums'); return s ? s.innerText.replace(/\s+/g, ' ').trim() : null; });
const plbText = (p) => p.evaluate(() => { const e = document.getElementById('plb'); return e && !e.hidden ? e.innerText.replace(/\s+/g, ' ').trim() : null; });
const modal = (p) => p.evaluate(() => { const e = document.getElementById('kcom'); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; });
const covered = (p, el) => p.evaluate((sel) => { const out = []; document.querySelectorAll(sel).forEach((c) => { const r = c.getBoundingClientRect(); const x = document.getElementById('plb'); if (!x || x.hidden) return; const q = x.getBoundingClientRect(); if (q.width && q.height && q.left < r.right - 1 && q.right > r.left + 1 && q.top < r.bottom - 1 && q.bottom > r.top + 1) out.push(sel); }); return out; }, el);
const side = (p) => p.evaluate(() => { const sc = document.getElementById('sc'); return Math.max(document.documentElement.scrollWidth - innerWidth, sc ? sc.scrollWidth - sc.clientWidth : 0); });
const cardText = (p, sel) => p.evaluate((sel) => { const e = document.querySelector(sel); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel);
const MK = () => ({ KXYES: { yes_bid: 55, no_bid: 43 }, KXNO: { yes_bid: 30, no_bid: 66 }, KXMVE: { yes_bid: 40, no_bid: 58 } });
const ME_USER = { email: '9565551234@phone.oddable', role: 'user', plan: 'pro', expires_on: null, source: 'trial', allowed: true, pending: false, price: 99, payReady: true };


const BETS = BETS0.concat([
  { id: 'b2', gid: '402', side: 'KC', type: 'ml', odds: -150, stake: 30, day: today, t: 6, res: null },
  { id: 'b3', gid: '402', side: 'NYJ', type: 'sp', line: 3.5, stake: 20, day: today, t: 7 },
  { id: 'b4', kind: 'parlay', legs: [{ gid: '401', side: 'LAC', type: 'sp', line: 4.5 }, { gid: '402', side: 'KC', type: 'ml' }], stake: 10, mult: 3, odds: 300, day: today, t: 8, week: 11 },
  { id: 'b5', kind: 'prop', text: 'Mahomes over 275.5 passing yards', stake: 15, mult: 1.9, odds: -110, res: null, day: today, t: 9, week: 11 },
]);
const ME = { email: '9565551234@phone.oddable', role: 'user', plan: 'pro', expires_on: null, source: 'trial', allowed: true, pending: false, price: 99, payReady: true };
const grab = (p) => p.evaluate(() => {
  const cards = [...document.querySelectorAll('#betspage .mbc')];
  const btns = cards.map((c) => [...c.querySelectorAll('button')].map((b) => b.innerText.trim() + '|' + (b.getAttribute('onclick') || '').slice(0, 40)));
  const bp = document.getElementById('betspage');
  return { n: cards.length, text: cards.map((c) => c.innerText.replace(/\s+/g, ' ').trim()), btns, tiles: bp.querySelector('.sums') ? bp.querySelector('.sums').innerText.replace(/\s+/g, ' ').trim() : null };
});
const colours = (p, sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); return { bg: c.backgroundColor + ' ' + c.backgroundImage.slice(0, 40), border: c.borderTopColor, color: c.color, radius: c.borderTopLeftRadius }; }, sel);
const sheetCards = (p) => p.evaluate(() => { const e = document.getElementById('tbbody'); return e ? { n: e.querySelectorAll('.scc').length, text: e.innerText.replace(/\s+/g, ' ').trim() } : null; });
async function run(b, W) {
  console.log('--- ' + W);
  let oldG = null, oldSheet = null;
  if (OLD) { const a = await open(b, W, { port: OLD, me: ME, mk: MK(), bets: BETS }); oldG = await grab(a.p); await a.p.click('#plb').catch(() => {}); await settle(a.p, 1); oldSheet = await sheetCards(a.p); await a.ctx.close(); }
  for (const th of ['oddable', 'black', 'light', 'green']) {
    const x = await open(b, W, { port: NEW, me: ME, mk: MK(), bets: BETS, theme: th }); const p = x.p;
    const g = await grab(p);
    ok(g.n >= 8, th + ' cards drawn: ' + g.n);
    if (oldG) { eq(g.n, oldG.n, th + ' card count same as v280'); eq(g.text, oldG.text, th + ' card text same as v280'); eq(g.btns, oldG.btns, th + ' buttons same as v280'); eq(g.tiles, oldG.tiles, th + ' tiles same'); }
    const tile = await colours(p, '#betspage .sum'), card = await colours(p, '#betspage .mbc:not(.bw):not(.bl)');
    console.log('  ' + th + ' tile ' + JSON.stringify(tile) + '\n  ' + th + ' card ' + JSON.stringify(card));
    if (th === 'oddable') { eq(card.bg.split(' ')[0] + card.border, tile.bg.split(' ')[0] + tile.border, 'oddable card fill + border = tile fill + border'); }
    eq(await side(p), 0, th + ' no sideways scroll');
    eq(await p.evaluate(() => [...document.querySelectorAll('#betspage .mbc button')].filter((b) => b.getBoundingClientRect().height && b.getBoundingClientRect().height < 43.5).map((b) => b.innerText)), [], th + ' all in-card buttons >= 44px');
    eq(await covered(p, '#betspage .mbc button'), [], th + ' banner covers no button at rest');
    eq(x.S.errs.filter((e) => !/Cannot read|undefined|null/.test(e)), [], th + ' page errors');
    await p.evaluate(() => window.scrollTo(0, 0)); const sc = await p.$('#sc'); if (sc) await sc.evaluate((e) => (e.scrollTop = 0));
    await p.screenshot({ path: OUT + 'cc_bets_' + th + '_' + W + '.png', fullPage: false });
    for (const i of [1, 3, 6]) { await p.evaluate((i) => { const c = document.querySelectorAll('#betspage .mbc')[i]; if (c) { c.scrollIntoView({ block: 'start' }); const sc = document.getElementById('sc'); (sc && sc.scrollHeight > sc.clientHeight ? sc : document.scrollingElement).scrollBy(0, -130); } }, i); await p.waitForTimeout(150); await p.screenshot({ path: OUT + 'cc_bets' + i + '_' + th + '_' + W + '.png' }); }
    // sheet
    await p.evaluate(() => { try { tbOpen(); } catch (e) {} }); await settle(p, 1);
    const sh = await sheetCards(p); ok(sh && sh.n >= 3, th + ' sheet cards: ' + (sh && sh.n));
    if (oldSheet && th === 'oddable') { eq(sh.n, oldSheet.n, 'sheet card count same'); eq(sh.text, oldSheet.text, 'sheet text same as v280'); }
    const shc = await colours(p, '#tbbody .scc'); console.log('  ' + th + ' sheet card ' + JSON.stringify(shc));
    await p.screenshot({ path: OUT + 'cc_sheet_' + th + '_' + W + '.png' });
    await x.ctx.close();
  }
}
(async () => {
  const b = await chromium.launch();
  for (const W of [390, 820, 1180]) await run(b, W);
  await b.close(); console.log('pass ' + pass + ' fail ' + fail); process.exit(fail ? 1 : 0);
})();
