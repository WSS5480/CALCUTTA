// Run: node odds-api/betpush.sw.test.js   (loads pics/sw.js in a made-up service-worker scope; no browser, no network)
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'pics', 'sw.js'), 'utf8');
let n = 0; const eq = (a, b, m) => { n++; assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, m); }, ok = (c, m) => { n++; assert(c, m); };
const UA = { android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', crios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1', deskchrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' };
function scope(ua, wins, broken) {
  const L = {}, shown = [], opened = [], S = { shown, opened };
  const self = { addEventListener: (k, f) => { L[k] = f; }, skipWaiting() {}, navigator: { userAgent: ua }, registration: { showNotification: async (t, o) => { shown.push({ t, o }); } }, clients: { claim() {} } };
  const clients = { matchAll: async () => { if (broken) throw new Error('no'); return wins; }, openWindow: async (u) => { opened.push(u); } };
  vm.runInNewContext(src, { self, clients, caches: { keys: async () => [], open: async () => ({ put() {} }), match: async () => null }, location: { origin: 'https://steves-pics.onrender.com' }, URL, fetch: async () => ({ ok: false }), Promise, JSON, String });
  S.push = async (data) => { let p; L.push({ data: data === undefined ? null : { json: () => { if (data === 'BAD') throw new Error('x'); return data; } }, waitUntil: (x) => { p = x; } }); await p; };
  S.click = async (url, action) => { let p, closed = false; L.notificationclick({ action: action || '', notification: { close: () => { closed = true; }, data: url === undefined ? undefined : { url } }, waitUntil: (x) => { p = x; } }); await p; return closed; };
  return S;
}
const win = (vis, nav) => { const w = { visibilityState: vis, focused: 0, msgs: [], navs: [], focus() { w.focused++; return Promise.resolve(w); }, postMessage(m) { w.msgs.push(m); } }; if (nav !== false) w.navigate = (u) => { if (nav === 'fail') return Promise.reject(new Error('not controlled')); w.navs.push(u); return Promise.resolve(w); }; return w; };
const bet = { title: 'LAC 17, BAL 7 · 2nd 1:56', body: 'LAC +4.5: covering by 14.5 right now', tag: 'bet-401', url: '/?open=bets' };
const PAY = 'https://my-apps-management.onrender.com/pay/tok_123', renew = { title: 'Oddable subscription ends tomorrow', body: 'Tap to renew with Cash App ($99).', url: PAY, tag: 'renew-oddable', actions: [{ action: 'pay', title: 'Pay now' }] }, cast = { title: 'PGA Tour is live', body: 'The leaderboard is up.', url: '/pga.html', tag: 'oddable' };
(async () => {
  // 1. a bet alert, app closed: title, body, tag (the same game replaces the older alert), renotify, the url kept for the tap
  for (const k of Object.keys(UA)) { const s = scope(UA[k], []); await s.push(bet); eq(s.shown.length, 1, k); eq(s.shown[0].t, bet.title); eq(s.shown[0].o.body, bet.body); eq(s.shown[0].o.tag, 'bet-401'); eq(s.shown[0].o.renotify, true); eq(s.shown[0].o.data, { url: '/?open=bets' }); eq(s.shown[0].o.icon, '/icon-192.png'); }
  // 2. app open in the background (hidden): still shown
  for (const k of Object.keys(UA)) { const s = scope(UA[k], [win('hidden')]); await s.push(bet); eq(s.shown.length, 1, k); }
  // 3. app open and VISIBLE: skipped on Android / desktop Chrome (the in-app pop-up has it); ALWAYS shown on iPhone / iPad / Chrome on iPhone (Safari revokes silent pushes)
  for (const k of ['android', 'deskchrome']) { const s = scope(UA[k], [win('hidden'), win('visible')]); await s.push(bet); eq(s.shown.length, 0, k); }
  for (const k of ['iphone', 'ipad', 'crios']) { const s = scope(UA[k], [win('visible')]); await s.push(bet); eq(s.shown.length, 1, k); }
  // if the list of windows cannot be read, the alert is shown
  { const s = scope(UA.android, [], true); await s.push(bet); eq(s.shown.length, 1); }
  // 4. renewal reminders, broadcasts and the test alert are NOT bet alerts: always shown, even with the app visible; no renotify unless asked; the reminder's button is passed on
  for (const k of Object.keys(UA)) { const s = scope(UA[k], [win('visible')]); await s.push(renew);
    eq(s.shown, [{ t: renew.title, o: { body: renew.body, tag: 'renew-oddable', data: { url: PAY }, icon: '/icon-192.png', badge: '/icon-192.png', actions: [{ action: 'pay', title: 'Pay now' }] } }], k);
    await s.push({ title: 'Oddable test alert', body: 'x', tag: 'oddable-test' }); eq(s.shown.length, 2); ok(!('renotify' in s.shown[1].o) && !('actions' in s.shown[1].o));
    await s.push(cast); eq(s.shown[2], { t: cast.title, o: { body: cast.body, tag: 'oddable', data: { url: '/pga.html' }, icon: '/icon-192.png', badge: '/icon-192.png' } });
    await s.push(Object.assign({ renotify: true }, cast)); eq(s.shown[3].o.renotify, true); }
  // an old-style reminder (no actions, the app's own address) is shown as before; junk actions are dropped, at most two kept
  { const s = scope(UA.android, []); await s.push({ title: 'T', body: 'B', url: 'https://steves-pics.onrender.com', tag: 'renew-oddable' }); eq(s.shown[0], { t: 'T', o: { body: 'B', tag: 'renew-oddable', data: { url: 'https://steves-pics.onrender.com' }, icon: '/icon-192.png', badge: '/icon-192.png' } });
    await s.push({ title: 'T', actions: [null, { action: 5 }, { action: 'a', title: 'A', icon: 'x' }, { action: '', title: 'no' }, { action: 'b', title: 'B' }, { action: 'c', title: 'C' }] }); eq(s.shown[1].o.actions, [{ action: 'a', title: 'A' }, { action: 'b', title: 'B' }]); await s.push({ title: 'T', actions: 'pay' }); ok(!('actions' in s.shown[2].o)); }
  // 5. empty / unreadable payloads still show something (as before)
  { const s = scope(UA.android, []); await s.push(undefined); await s.push('BAD'); await s.push({}); await s.push(null); await s.push(7); eq(s.shown.map((x) => [x.t, x.o.body, x.o.tag, x.o.data.url]), Array(5).fill(['Oddable', '', 'oddable', '/'])); }
  // 6. TAP, bet alert: an open Oddable window is brought forward and told to open My Bets (no reload); none open = My Bets is opened
  { const w = win('hidden'), s = scope(UA.android, [w]); eq(await s.click(bet.url), true); eq([w.focused, w.msgs, w.navs, s.opened], [1, [{ type: 'bp-open' }], [], []]); }
  { const s = scope(UA.iphone, []); await s.click(bet.url); eq(s.opened, ['/?open=bets']); const s2 = scope(UA.android, [], true); await s2.click(bet.url); eq(s2.opened, ['/?open=bets'], 'windows unreadable: opened'); }
  { const w = win('visible'), s = scope(UA.android, [w]); await s.click('https://steves-pics.onrender.com/?open=bets'); eq([w.focused, w.msgs.length, s.opened], [1, 1, []], 'the app\'s own address written in full is the same place'); }
  // 7. TAP, broadcast: the open window is taken to the path; none open = it is opened; a window that cannot be navigated = it is opened
  { const w = win('hidden'), s = scope(UA.android, [w]); await s.click('/pga.html'); eq([w.focused, w.navs, w.msgs, s.opened], [1, ['/pga.html'], [], []]); }
  { const s = scope(UA.android, []); await s.click('/pga.html'); eq(s.opened, ['/pga.html']); }
  { const w = win('visible', 'fail'), s = scope(UA.android, [w]); await s.click('/sports.html?lg=nba'); eq([w.focused, s.opened], [1, ['/sports.html?lg=nba']]); const w2 = win('visible', false), s2 = scope(UA.android, [w2]); await s2.click('/pga.html'); eq(s2.opened, ['/pga.html']); }
  { const w = win('visible'), s = scope(UA.android, [w]); await s.click('/?pay=1'); eq(w.navs, ['/?pay=1'], 'a deep link on the front page is followed'); }
  // 8. TAP, renewal reminder: the body and the "Pay now" button both open the My Apps pay page (a new window, even with Oddable open)
  for (const action of ['', 'pay']) { const w = win('visible'), s = scope(UA.iphone, [w]); eq(await s.click(PAY, action), true); eq([s.opened, w.navs, w.focused], [[PAY], [], 0], 'action "' + action + '"'); const s2 = scope(UA.android, []); await s2.click(PAY, action); eq(s2.opened, [PAY]); }
  // an old reminder (the app's own address, or nothing): the open window comes forward, nothing reloads; none open = the app opens
  { const w = win('visible'), s = scope(UA.android, [w]); await s.click('https://steves-pics.onrender.com'); eq([w.focused, w.msgs, w.navs, s.opened], [1, [], [], []]); const s2 = scope(UA.android, []); await s2.click(undefined); eq(s2.opened, ['/']); await s2.click('/'); eq(s2.opened, ['/', '/']); }
  // 9. a tap never leaves for an address that is not Oddable or the My Apps site: it goes to the front page instead
  for (const bad of ['https://evil.example/pay', '//evil.example/x', 'http://my-apps-management.onrender.com/pay/x', 'https://my-apps-management.onrender.com.evil.example/pay', 'https://my-apps-management.onrender.com@evil.example/', 'javascript:alert(1)', 'data:text/html,x', 'https://calcutta-odds.onrender.com/x', '\\\\evil.example']) {
    const w = win('visible'), s = scope(UA.android, [w]); await s.click(bad); eq([s.opened, w.navs, w.focused], [[], [], 1], 'refused with a window open: ' + bad); const s2 = scope(UA.android, []); await s2.click(bad); eq(s2.opened, ['/'], 'refused, none open: ' + bad); }
  console.log('betpush.sw.test.js: ' + n + ' checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
