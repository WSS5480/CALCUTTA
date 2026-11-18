// v280 Playwright checks: Cash out on SINGLE Kalshi bets (YES and NO side) + the owner-PIN card on My Bets, at 390 / 820 / 1180.
// Kalshi, the odds server and ESPN are MOCKED: no request leaves the browser, no order is ever placed.
// Run: serve the new pics/ on NEW_PORT and (optional) the previous build's pics/ on OLD_PORT (python3 -m http.server), then
//   NEW_PORT=8821 OLD_PORT=8822 KS_OUT=/tmp/ks node scripts/kco-single/shots.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const NEW = +process.env.NEW_PORT || 8821, OLD = +process.env.OLD_PORT || 0, OUT = (process.env.KS_OUT || require('os').tmpdir()).replace(/\/?$/, '/');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
const T0 = '2026-11-16T14:00:00-06:00', today = '2026-11-16';
const PEM = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
const team = (id, ab, name, ha, score) => ({ id: String(id), homeAway: ha, score: String(score), team: { id: String(id), abbreviation: ab, displayName: name, shortDisplayName: name.split(' ').pop(), location: name, color: '0b3d91', logo: '' }, records: [{ summary: '6-3' }] });
const GAME = { id: '401', date: '2026-11-16T19:00Z', week: { number: 11 }, status: { period: 2, displayClock: '1:56', type: { state: 'in', shortDetail: '1:56 - 2nd', detail: '1:56 - 2nd Quarter', completed: false } }, competitions: [{ id: '401', date: '2026-11-16T19:00Z', competitors: [team(33, 'BAL', 'Baltimore Ravens', 'home', 7), team(24, 'LAC', 'Los Angeles Chargers', 'away', 17)], odds: [] }] };
const BETS = [
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
      if (pa === '/appcfg') return J({ ok: true, card_theme: 'oddable' });
      if (pa === '/acct/status') return J({ gate: o.gate !== false, guest: true });
      if (pa === '/acct/me') { S.meCalls++; return o.me ? J({ me: o.me }) : J({ error: 'no' }, 401); }
      return J({});
    }
    if (u.includes('site.api.espn.com') && u.includes('/scoreboard')) return J({ events: u.includes('football/nfl/') && !/week=(?!11\b)/.test(u) ? [GAME] : [], week: { number: 11 }, season: { year: 2026, type: 2 }, leagues: [{ calendar: [] }] });
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

async function run(b, W) {
  console.log('--- ' + W);
  // 1) cash out on singles, YES and NO
  let x = await open(b, W, { port: NEW, me: ME_USER, mk: MK() }); let p = x.p;
  const yes = await box(p, 'k-KXYES-yes'), no = await box(p, 'k-KXNO-no'), combo = await box(p, 'k-KXMVE-yes');
  ok(yes && /Cash out now ≈ \$5\.50/.test(yes.text) && /10 contracts at 55¢/.test(yes.text), 'YES single shows the live value: ' + JSON.stringify(yes));
  ok(no && /Cash out now ≈ \$5\.68/.test(no.text) && /8\.6 contracts at 66¢/.test(no.text), 'NO single shows the live value at the NO bid: ' + JSON.stringify(no));
  ok(yes && yes.btn && yes.btn[0] === 'Cash out…' && yes.btn[1] >= 44, 'YES Cash out… button 44px ' + JSON.stringify(yes && yes.btn));
  ok(no && no.btn && no.btn[0] === 'Cash out…' && no.btn[1] >= 44, 'NO Cash out… button 44px ' + JSON.stringify(no && no.btn));
  ok(combo && /Cash out now ≈ \$8\.00/.test(combo.text), 'combo still shows its value ' + JSON.stringify(combo));
  eq(await box(p, 'k-KXDONE-yes'), null, 'a cashed-out single has no box');
  ok(/Cashed out on Kalshi for \$3\.50 \(\+\$1\.50\) · 5 contracts/.test(await p.evaluate(() => document.getElementById('betspage').innerText)), 'cashed-out single shows the cashed line');
  eq(await p.evaluate(() => !!document.getElementById('mbopin')), false, 'no owner-PIN card for a phone sign-in');
  eq(await side(p), 0, 'no sideways scroll');
  eq(await covered(p, '[data-kco] .kcob'), [], 'banner covers no Cash out button (at rest)');
  for (const id of ['k-KXYES-yes', 'k-KXNO-no']) { await p.evaluate((id) => { const e = [...document.querySelectorAll('[data-kco]')].find((q) => q.getAttribute('data-kco') === id); e.scrollIntoView({ block: 'center' }); }, id); await p.waitForTimeout(80); eq(await covered(p, '[data-kco="' + id + '"]'), [], 'banner over ' + id + ' box'); }
  await p.screenshot({ path: OUT + 'ks_bets_' + W + '.png', fullPage: false });
  // 2) modal + exact order body, YES
  await p.evaluate(() => kcoAsk('k-KXYES-yes')); await p.waitForTimeout(400);
  let mt = await modal(p); ok(/Sell on Kalshi\?/.test(mt) && /55¢ per contract/.test(mt) && /Contracts you sell 10/.test(mt) && /≈ \$5\.50/.test(mt), 'YES modal ' + mt);
  await p.screenshot({ path: OUT + 'ks_modal_' + W + '.png' });
  await p.click('#kcogo'); await p.waitForTimeout(600);
  eq(x.S.orders.length, 1, 'one order posted (to the mock)');
  const o1 = x.S.orders[0] && x.S.orders[0].order; ok(o1 && /^oddable-\d+-[a-z0-9]+$/.test(o1.client_order_id), 'client_order_id ' + (o1 && o1.client_order_id));
  if (o1) { const c = Object.assign({}, o1); delete c.client_order_id; eq(c, { ticker: 'KXYES', action: 'sell', side: 'yes', count: 10, type: 'limit', time_in_force: 'immediate_or_cancel', reduce_only: true, yes_price_dollars: '0.5500' }, 'YES order body'); }
  ok(x.S.orders[0] && x.S.orders[0].headers && x.S.orders[0].headers['KALSHI-ACCESS-SIGNATURE'], 'order is signed');
  ok(/✅ Sold/.test(await modal(p)), 'sold screen');
  ok(JSON.parse(await p.evaluate(() => localStorage.getItem('kco-log')) || '[]').some((l) => l.ticker === 'KXYES' && l.side === 'yes' && l.count === 10 && l.price === 55), 'kco-log entry');
  // sync reads the SELL fill -> cash / soldN on the single
  x.S.sellFill = [{ ticker: 'KXYES', side: 'yes', action: 'buy', count: 10, yes_price: 42, fee_cost: '0', created_time: '2026-11-16T15:00:00Z' }, { ticker: 'KXYES', side: 'yes', action: 'sell', count: 10, yes_price: 55, fee_cost: '0', created_time: '2026-11-16T20:00:00Z' }];
  await p.evaluate(() => kcoClose()); await p.clock.runFor(9000); await p.waitForTimeout(800); await settle(p, 2);
  const kb = await p.evaluate(() => { const b = BETS.find((q) => q.id === 'k-KXYES-yes'); return b && { cash: b.cash, soldN: b.soldN, res: b.res }; });
  ok(kb && Math.abs(kb.cash - 5.5) < 0.001 && kb.soldN === 10 && kb.res === 'won', 'sync after sale -> cash/soldN ' + JSON.stringify(kb));
  // 3) NO side order
  await p.evaluate(() => kcoAsk('k-KXNO-no')); await p.waitForTimeout(400); mt = await modal(p);
  ok(/66¢ per contract/.test(mt) && /Contracts you sell 8/.test(mt) && /0\.6 contracts stay open/.test(mt), 'NO modal ' + mt);
  await p.click('#kcogo'); await p.waitForTimeout(600);
  const o2 = x.S.orders[1] && x.S.orders[1].order; if (o2) { const c = Object.assign({}, o2); delete c.client_order_id; eq(c, { ticker: 'KXNO', action: 'sell', side: 'no', count: 8, type: 'limit', time_in_force: 'immediate_or_cancel', reduce_only: true, no_price_dollars: '0.6600' }, 'NO order body (sells the NO side at the NO bid)'); } else ok(false, 'NO order posted');
  await p.evaluate(() => kcoClose());
  // 4) refused when the price drops between the screen and Confirm
  await p.evaluate(() => kcoAsk('k-KXNO-no')); await p.waitForTimeout(400);
  x.S.mk.KXNO = { yes_bid: 30, no_bid: 60 }; await p.click('#kcogo'); await p.waitForTimeout(500);
  eq(x.S.orders.length, 2, 'no order when the price fell'); ok(/Price moved to 60¢ \(you saw 66¢\)\. Nothing was sold/.test(await modal(p)), 'refusal message ' + (await modal(p)));
  await p.evaluate(() => kcoClose());
  ok(!x.S.errs.length, 'no page errors ' + x.S.errs.join(' | ').slice(0, 300));
  await x.ctx.close();
  // 5) combos and totals unchanged vs the previous build
  if (OLD) {
    const a = await open(b, W, { port: OLD, me: ME_USER, mk: MK() }), n = await open(b, W, { port: NEW, me: ME_USER, mk: MK() });
    eq(await sums(n.p), await sums(a.p), 'My Bets tiles identical old vs new'); ok(!!(await sums(n.p)), 'tiles present');
    eq(await plbText(n.p), await plbText(a.p), 'banner text identical');
    eq(await cardOf(n.p, 'k-KXMVE-yes'), await cardOf(a.p, 'k-KXMVE-yes'), 'combo card identical');
    eq(await box(a.p, 'k-KXYES-yes'), null, '(old build had no single box)');
    await a.ctx.close(); await n.ctx.close();
  }
  // 6) owner-PIN sign-in card
  x = await open(b, W, { port: NEW, me: { email: 'owner', role: 'owner', source: 'owner', allowed: true }, mk: MK(), bets: [] }); p = x.p;
  const oc = await p.evaluate(() => { const e = document.getElementById('mbopin'); if (!e) return null; const r = e.getBoundingClientRect(), bt = e.querySelector('button').getBoundingClientRect(), cs = getComputedStyle(e); return { text: e.innerText.replace(/\s+/g, ' ').trim(), pos: cs.position, btn: [Math.round(bt.height), Math.round(bt.right)], right: Math.round(r.right), w: innerWidth }; });
  ok(oc && oc.text === 'Owner PIN sign-in has no bets. Sign in with your cell number to see yours. Sign in with cell number', 'owner-PIN card text ' + JSON.stringify(oc));
  ok(oc && oc.pos === 'static' && oc.btn[0] >= 44 && oc.right <= oc.w, 'owner-PIN card in flow, 44px, fits ' + JSON.stringify(oc));
  eq(await side(p), 0, 'no sideways scroll (owner card)');
  eq(await covered(p, '#mbopin'), [], 'banner covers nothing of the owner card');
  await p.screenshot({ path: OUT + 'ks_owner_' + W + '.png' });
  await p.click('#mbopin button'); await p.waitForLoadState('load'); await p.waitForTimeout(300); await settle(p, 3);
  const after = await p.evaluate(() => ({ tok: localStorage.getItem('odd-tok'), gate: (() => { const g = document.getElementById('gate'); return g && getComputedStyle(g).display !== 'none' ? g.innerText.replace(/\s+/g, ' ').trim() : null; })(), ph: !!document.getElementById('gdo'), card: !!document.getElementById('mbopin') }));
  ok(after.tok === null && after.ph && /Sign in|PIN/i.test(after.gate || '') && !after.card, 'button signed out and opened the cell + PIN sign-in ' + JSON.stringify(after).slice(0, 300));
  await p.screenshot({ path: OUT + 'ks_owner_after_' + W + '.png' });
  await x.ctx.close();
  // owner on a PHONE sign-in (source not owner) and an email sign-in: no card
  for (const me of [{ email: '9565550000@phone.oddable', role: 'owner', source: 'phone', allowed: true, ownerDash: true }, { email: 'a@b.com', role: 'user', source: 'trial', allowed: true }]) {
    x = await open(b, W, { port: NEW, me, mk: MK() }); eq(await x.p.evaluate(() => !!document.getElementById('mbopin')), false, 'no owner card for ' + me.email); await x.ctx.close();
  }
}
(async () => {
  const b = await chromium.launch();
  for (const W of [390, 820, 1180]) await run(b, W);
  await b.close(); console.log('pass ' + pass + ' fail ' + fail); process.exit(fail ? 1 : 0);
})();
