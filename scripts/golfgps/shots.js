// Playwright checks for pics/golfgps.html (v264): phones 390 / 430, tablets 768 / 820x1180 / 1180x820, desktop 1280 / 1440.
// The odds server, the satellite tiles and the phone's GPS are all faked; service workers are blocked. Fixtures: ./fixtures.js (hand-made course).
// Run: (cd pics && python3 -m http.server 8823) then  NODE_PATH=<where playwright lives> GPS_OUT=/some/dir node scripts/golfgps/shots.js
const { chromium } = require('playwright'), zlib = require('zlib');
const F = require('./fixtures.js'), G = require('../../pics/golfgps.js');
const OUT = (process.env.GPS_OUT || require('os').tmpdir()).replace(/\/?$/, '/'), PORT = +process.env.GPS_PORT || 8823, BASE = 'http://localhost:' + PORT + '/', URL0 = BASE + 'golfgps.html';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
const near = (a, b, t, m) => ok(typeof a === 'number' && Math.abs(a - b) <= t, m + ' got ' + a + ' want ' + b + ' ±' + t);
// a 256 px tile: dark green with a lighter grid, so a turned map is visibly turned in the screenshots
const TILE = (() => { const W = 256, raw = Buffer.alloc((W * 3 + 1) * W); for (let y = 0; y < W; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3, g = x % 64 === 0 || y % 64 === 0; raw[o] = g ? 70 : 34; raw[o + 1] = g ? 120 : 84 + ((x + y) % 7); raw[o + 2] = g ? 70 : 40; } }
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const ch = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(W, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]); })();
const SIZES = { 390: [390, 844], 430: [430, 932], 768: [768, 1024], 820: [820, 1180], 1180: [1180, 820], 1280: [1280, 900], 1440: [1440, 900] };
const yd = (a, b) => G.yards(a, b), C0 = G._tidy(F.course()), H1 = C0.holes[0], H2 = C0.holes[1], H3 = C0.holes[2];

// o: { geo: {lat,lon,acc} | null, perm: 'granted' | 'denied' | 'prompt', tok, course: () => holes answer | 'fail', tiles: 'ok' | 'fail', ls: {k:v} }
async function open(b, W, o = {}) {
  const [w, h] = SIZES[W], ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, hasTouch: w < 1000, timezoneId: 'America/Chicago', locale: 'en-US', geolocation: o.geo ? { latitude: o.geo.lat, longitude: o.geo.lon, accuracy: o.geo.acc == null ? 4 : o.geo.acc } : undefined, permissions: o.perm === 'granted' || (o.geo && !o.perm) ? ['geolocation'] : [] });
  const p = await ctx.newPage(), S = { o, hits: [], posts: [], errs: [], tiles: 0, ctx };
  p.on('pageerror', (e) => { S.errs.push(e.message); console.log('PAGEERR', e.message); });
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) { S.errs.push(m.text()); console.log('CONSOLE', m.text().slice(0, 200)); } });
  if (o.perm === 'denied') await p.addInitScript(() => { const g = navigator.geolocation; g.watchPosition = (ok, err) => { setTimeout(() => err({ code: 1, message: 'denied' }), 10); return 1; }; g.getCurrentPosition = (ok, err) => setTimeout(() => err({ code: 1 }), 10); navigator.permissions.query = async () => ({ state: 'denied' }); });
  if (o.perm === 'prompt') await p.addInitScript(() => { navigator.permissions.query = async () => ({ state: 'prompt' }); }); // headless Chromium answers 'denied' when nothing is granted; a real phone answers 'prompt'
  await p.addInitScript((a) => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); Object.keys(a.ls).forEach((k) => localStorage.setItem(k, a.ls[k])); if (a.tok) localStorage.setItem('odd-tok', a.tok); } } catch (e) {} }, { ls: o.ls || {}, tok: o.tok || '' });
  await p.route('**/*', async (r) => {
    const u = r.request().url(), J = (obj, code) => r.fulfill({ status: code || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(obj) });
    if (u.startsWith(BASE)) return r.continue();
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-token', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
    if (u.includes('arcgisonline.com')) { S.tiles++; return S.o.tiles === 'fail' ? r.abort() : r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: TILE }); }
    if (u.includes('/golfcourse/search')) { S.hits.push(u); const f = S.o.search ? S.o.search(u) : F.search(); return f === 'fail' ? J({ ok: false, error: 'The course map is not answering right now. Try again in a minute.' }, 502) : J(f); }
    if (u.includes('/golfcourse/holes')) { S.hits.push(u); const f = S.o.course ? S.o.course(u, r.request().headers()['x-token']) : F.course(); return f === 'fail' ? J({ ok: false, error: 'The course map is not answering right now. Try again in a minute.' }, 502) : f === 'abort' ? r.abort() : J(f); }
    if (u.includes('/golfcourse/mark') || u.includes('/golfcourse/flagreport')) { const body = JSON.parse(r.request().postData() || '{}'), tok = r.request().headers()['x-token'] || ''; S.posts.push({ path: u.split('/golfcourse')[1], body, tok }); const a = S.o.post ? S.o.post(u, body, tok) : { s: 200, j: { ok: true } }; return a === 'abort' ? r.abort() : J(a.j, a.s); }
    if (u.includes('calcutta-odds.onrender.com/acct/status')) return J({ gate: false });
    return r.abort();
  });
  S.p = p; return S;
}
const T = (p, s) => p.locator(s).first().textContent().then((x) => (x || '').replace(/\s+/g, ' ').trim()).catch(() => null);
const num = async (p, s) => { const t = await T(p, s); return t == null || t === '–' ? null : +t.replace(/,/g, ''); };
const state = (p) => p.evaluate(() => window.GolfGPSPage.state());
const noSide = async (p, m) => ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), m + ': no sideways scroll (' + (await p.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth)) + ')');
// every button / select / input a finger can reach is at least 44 px tall (and the buttons at least 44 wide)
async function taps(p, m) { const bad = await p.evaluate(() => [...document.querySelectorAll('button,select,a.home,input[type=search],input[type=text]')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.id || e.textContent || e.className).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 44 || x.w < 44)); ok(!bad.length, m + ': tap targets 44+ ' + JSON.stringify(bad.slice(0, 4))); }
const tapMap = async (p, pt) => { await p.evaluate(() => document.querySelector('#mapbox').scrollIntoView({ block: 'center' })); await p.waitForTimeout(60); const s = await p.evaluate((q) => window.GolfGPSPage.screenOf(q), pt); await p.mouse.click(s.x, s.y); await p.waitForTimeout(80); return s; };
const openCourse = async (S, q) => { await S.p.goto(URL0 + (q || '?course=way/100&hole=1')); await S.p.waitForSelector('#hole:not([hidden])'); await S.p.waitForTimeout(350); };
const shot = (p, name, full) => p.screenshot({ path: OUT + name + '.png', fullPage: !!full });

(async () => {
  const b = await chromium.launch(); let S, p, s;

  // ===== 1. search -> hole screen, at every width =====
  for (const W of [390, 430, 768, 820, 1180, 1280, 1440]) {
    S = await open(b, W, { geo: { lat: H1.tee.lat, lon: H1.tee.lon, acc: 4 } }); p = S.p;
    await p.goto(URL0); await p.waitForSelector('#pv:not([hidden])'); await noSide(p, W + ' pick'); await taps(p, W + ' pick');
    ok(!(await p.locator('#hv').isVisible()), W + ' starts on the course picker'); eq(await state(p).then((x) => x.watching), false, W + ' no GPS on the picker');
    await p.fill('#q', 'McAllen, TX'); await p.click('#sb'); await p.waitForSelector('.cc');
    eq(await p.locator('#sres .cc').count(), 3, W + ' three result cards'); ok(/Test Links/.test(await T(p, '#sres .cc')) && /0\.4 mi · 3 of 18 holes mapped/.test(await T(p, '#sres .cc')), W + ' card text: ' + (await T(p, '#sres .cc')));
    ok(/Palm <b>View<\/b> & Sons/.test(await p.locator('#sres .cc').nth(1).textContent()) && (await p.locator('#sres .cc b b').count()) === 0, W + ' course names are escaped'); ok(/q=McAllen%2C%20TX&r=15/.test(S.hits[0]), W + ' search call ' + S.hits[0]);
    if (W >= 768) { const xs = await p.evaluate(() => [...document.querySelectorAll('#sres .cc')].map((e) => Math.round(e.getBoundingClientRect().top))); ok(xs[0] === xs[1], W + ' results sit side by side in a grid ' + xs); }
    await noSide(p, W + ' results'); await shot(p, W + '-01-search');
    await p.locator('#sres .cc').first().click(); await p.waitForSelector('#hole:not([hidden])'); await p.waitForTimeout(400);
    ok(/course=way\/100&hole=1/.test(p.url()), W + ' url carries the course ' + p.url()); eq(await T(p, '#cname'), 'Test Links', W + ' course name'); eq(await p.locator('#hsel option').count(), 18, W + ' 18 holes in the dropdown'); ok(/Hole 1 · Par 4/.test(await T(p, '#hsel option')), W + ' hole option');
    s = await state(p); ok(s.watching && s.fix && s.wake !== undefined, W + ' GPS runs on the hole screen (permission already granted)');
    // standing on the 1st tee: centre 300 m = 328 yd, Short edge 288 m, Long edge 312 m
    near(await num(p, '#dcenter'), 300 / 0.9144, 1, W + ' Center'); near(await num(p, '#dfront'), 288 / 0.9144, 1, W + ' Short'); near(await num(p, '#dback'), 312 / 0.9144, 1, W + ' Long'); near(await num(p, '#dpin'), 300 / 0.9144, 1, W + ' pin = centre with no colour'); eq(await T(p, '#dfrom'), 'from you', W + ' from you');
    eq(await p.locator('.scl button span').allTextContents(), ['Short', 'Center', 'Long'], W + ' owner wording'); ok(!/Front|Middle|Back(?! to)/.test(await p.locator('#hole').innerText()), W + ' no Front / Middle / Back anywhere');
    eq(await T(p, '#gpst'), 'GPS ±4 yd', W + ' GPS line'); await noSide(p, W + ' hole'); await taps(p, W + ' hole');
    ok(S.tiles > 0, W + ' satellite tiles asked for'); ok(/Esri/.test(await T(p, '#attr')) && /OpenStreetMap contributors/.test(await T(p, '#attr')), W + ' attribution shown');
    // layout: phones stack, tablets and up put the map beside the numbers; the page is as wide as index.html's Games view
    const L = await p.evaluate(() => { const r = (q) => { const e = document.querySelector(q).getBoundingClientRect(); return { l: Math.round(e.left), r: Math.round(e.right), t: Math.round(e.top), w: Math.round(e.width), h: Math.round(e.height) }; }; return { map: r('#mapbox'), dist: r('#dist'), main: r('main'), w: innerWidth }; });
    if (W >= 768) { ok(L.map.r <= L.dist.l && Math.abs(L.map.t - L.dist.t) < 30, W + ' map on one side, numbers beside it ' + JSON.stringify(L)); ok(L.map.w > L.dist.w * 1.3, W + ' the map is the large side'); } else ok(L.dist.t < L.map.t && L.map.w > L.w - 40, W + ' phone: numbers, then the map full width');
    const want = W >= 1500 ? 1360 : W >= 900 ? 1200 : 720; eq(L.main.w, Math.min(want, L.w - (W >= 900 ? 104 : 0)), W + ' content width matches index.html (' + want + ', beside the 104 px rail from 900)');
    ok(await p.evaluate(() => { const h = document.querySelector('header h1'), a = document.querySelector('.hbar b'); return h.getClientRects().length === 1 && h.offsetHeight < 40 && a.offsetHeight < 30; }), W + ' header cells do not wrap');
    await shot(p, W + '-02-hole1'); await shot(p, W + '-02-hole1-full', true);
    eq(S.errs, [], W + ' no page errors'); await S.ctx.close();
  }

  // ===== 2. page width against index.html's own main column =====
  for (const W of [768, 820, 1180, 1440]) {
    S = await open(b, W, {}); p = S.p; await p.goto(BASE + 'index.html?mirror=1').catch(() => {}); await p.waitForTimeout(600);
    const a = await p.evaluate(() => { const m = document.querySelector('main'), h = document.querySelector('header'); const r = m.getBoundingClientRect(), cs = getComputedStyle(m), hs = getComputedStyle(h); return { l: Math.round(r.left + parseFloat(cs.paddingLeft)), r: Math.round(r.right - parseFloat(cs.paddingRight)), hl: Math.round(parseFloat(hs.paddingLeft)), hr: Math.round(innerWidth - parseFloat(hs.paddingRight)) }; }).catch(() => null);
    await p.goto(URL0); await p.waitForSelector('#pv:not([hidden])');
    const g = await p.evaluate(() => { const m = document.querySelector('main'), h = document.querySelector('header'); const r = m.getBoundingClientRect(), cs = getComputedStyle(m), hs = getComputedStyle(h); return { l: Math.round(r.left + parseFloat(cs.paddingLeft)), r: Math.round(r.right - parseFloat(cs.paddingRight)), hl: Math.round(parseFloat(hs.paddingLeft)), hr: Math.round(innerWidth - parseFloat(hs.paddingRight)) }; });
    if (a) eq(g, a, W + ' content and header edges equal index.html\'s'); else ok(false, W + ' could not read index.html');
    await S.ctx.close();
  }

  // ===== 3. flag colour moves the pin and the big number; Pin today buttons; per hole vs all day; remap =====
  for (const W of [390, 1280]) {
    S = await open(b, W, { geo: { lat: H1.tee.lat, lon: H1.tee.lon, acc: 4 } }); p = S.p; await openCourse(S);
    const g = H1.green, want = { front: yd(H1.tee, G.placePoint(g, 'front')), center: yd(H1.tee, g.center), back: yd(H1.tee, G.placePoint(g, 'back')) };
    near(want.front, 288 / 0.9144 + 4, 0.3, 'hand calculation: Short = front edge + 4 yd = 319 yd'); near(want.back, 312 / 0.9144 - 4, 0.3, 'hand calculation: Long = back edge - 4 yd = 337 yd');
    const flagAt = () => p.evaluate(() => { const e = document.querySelector('.gi.flag svg circle:last-child'); if (!e) return null; const r = e.getBoundingClientRect(); return window.GolfGPSPage.pointAt(r.left + r.width / 2, r.top + r.height / 2); }); // the little circle at the foot of the pole is the marker's own position, however the map is turned
    const fills = () => p.evaluate(() => document.querySelector('.gi.flag path').getAttribute('fill'));
    for (const [c, pl, name] of [['red', 'front', 'Red flag = Short'], ['white', 'center', 'White flag = Center'], ['blue', 'back', 'Blue flag = Long'], ['yellow', 'back', 'Yellow flag = Long']]) {
      await p.click('.fbs [data-color="' + c + '"]'); near(await num(p, '#dpin'), want[pl], 1, W + ' ' + c + ': big number'); eq(await T(p, '#dwhy'), name, W + ' ' + c + ' label');
      eq(await p.locator('.fbs button.on').getAttribute('data-color'), c, W + ' ' + c + ' button lit'); eq(await p.locator('.scl button.on').getAttribute('data-place'), pl, W + ' ' + c + ' lights ' + pl);
      const col = { red: '#d93a2e', white: '#ffffff', blue: '#2563eb', yellow: '#f5c542' }[c]; eq(await fills(), col, W + ' flag on the map is ' + c);
      if (c !== 'yellow') await shot(p, W + '-03-flag-' + c);
    }
    await p.click('.fbs [data-color=""]'); near(await num(p, '#dpin'), want.center, 1, W + ' no colour = centre'); eq(await T(p, '#dwhy'), 'Center (no flag colour chosen)', W + ' no colour label'); eq(await p.locator('.scl button.on').count(), 0, W + ' no placement lit');
    // the three placements directly
    await p.click('.scl [data-place="back"]'); near(await num(p, '#dpin'), want.back, 1, W + ' Pin today: Long'); eq(await T(p, '#dwhy'), 'Pin Long', W + ' Long label'); eq(await p.locator('.fbs button.on').count(), 0, W + ' no colour lit when the placement is picked directly');
    await p.click('.scl [data-place="front"]'); near(await num(p, '#dpin'), want.front, 1, W + ' Pin today: Short'); await p.click('.scl [data-place="center"]'); near(await num(p, '#dpin'), want.center, 1, W + ' Pin today: Center');
    // the flag marker really moves on the map
    await p.click('.fbs [data-color="red"]'); const fa = await flagAt(); await p.click('.fbs [data-color="blue"]'); const fb = await flagAt(); ok(fa && fb, W + ' flag markers found');
    if (fa && fb) { near(yd(fa, G.placePoint(g, 'front')), 0, 2.5, W + ' red flag stands at Short'); near(yd(fb, G.placePoint(g, 'back')), 0, 2.5, W + ' blue flag stands at Long'); }
    // same colour all day (default ON): hole 2 gets blue too
    await p.click('#next'); eq(await p.locator('.fbs button.on').getAttribute('data-color'), 'blue', W + ' all day: hole 2 is blue too'); ok(/all 18 holes/.test(await T(p, '.fl .lab')), W + ' says all 18 holes');
    near(await num(p, '#dpin'), yd(H1.tee, G.placePoint(H2.green, 'back')), 1, W + ' hole 2 Long from where the player stands');
    // per hole: OFF, hole 2 red; hole 1 stays blue
    await p.locator('#allday').uncheck(); ok(/this hole only/.test(await T(p, '.fl .lab')), W + ' says this hole only'); await p.click('.fbs [data-color="red"]'); await p.click('#prev'); eq(await p.locator('.fbs button.on').getAttribute('data-color'), 'blue', W + ' per hole: hole 1 still blue'); await p.click('#next'); eq(await p.locator('.fbs button.on').getAttribute('data-color'), 'red', W + ' per hole: hole 2 red');
    await p.reload(); await p.waitForSelector('#hole:not([hidden])'); await p.waitForTimeout(300); eq(await p.locator('.fbs button.on').getAttribute('data-color'), 'red', W + ' remembered after a reload'); eq(await p.locator('#hsel').inputValue(), '2', W + ' reload stays on hole 2');
    await p.locator('#allday').check(); await p.click('#prev'); eq(await p.locator('.fbs button.on').getAttribute('data-color'), 'red', W + ' all day again: the colour on screen is the day\'s');
    // remap for this course (not signed in -> this phone only)
    await p.click('#fset'); await p.waitForSelector('#sheet:not([hidden])'); ok(await p.locator('#shback').isVisible(), W + ' the sheet has a Back button'); await noSide(p, W + ' sheet'); await taps(p, W + ' sheet');
    eq(await p.locator('#sheet [data-fc] option').evaluateAll((o) => [...new Set(o.map((x) => x.textContent))]), ['Short', 'Center', 'Long'], W + ' sheet says Short / Center / Long'); await shot(p, W + '-04-sheet-colours');
    await p.selectOption('#sheet [data-fc="red"]', 'back'); await p.selectOption('#fdef', 'white'); await p.click('#shsave'); await p.waitForSelector('#sheet', { state: 'hidden' });
    ok(/Saved on this phone only \(not signed in\)/.test(await T(p, '#toast')), W + ' toast: ' + (await T(p, '#toast'))); eq(await T(p, '#dwhy'), 'Red flag = Long', W + ' remap: red now means Long'); near(await num(p, '#dpin'), want.back, 1, W + ' remap moves the number');
    ok(/Flag colours: Red = Long, White = Center, Blue = Long, Yellow = Long/.test(await T(p, '.cfl')) && /this phone only/.test(await T(p, '.cfl')), W + ' colours line: ' + (await T(p, '.cfl'))); eq(S.posts.length, 0, W + ' nothing sent without a sign-in');
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('ggps-flags'))['way/100']), { def: 'white', map: { red: 'back', white: 'center', blue: 'back', yellow: 'back' } }, W + ' stored per course');
    await p.click('#fset'); await p.click('#shback'); ok(!(await p.locator('#sheet').isVisible()), W + ' Back closes the sheet');
    // next day: the round is clean and starts with the course's default colour
    await p.evaluate(() => { const r = JSON.parse(localStorage.getItem('ggps-round')); r.day = '2026-01-01'; localStorage.setItem('ggps-round', JSON.stringify(r)); }); await p.reload(); await p.waitForSelector('#hole:not([hidden])'); await p.waitForTimeout(300);
    eq(await p.locator('.fbs button.on').getAttribute('data-color'), 'white', W + ' next day: default colour (white)'); ok(await p.locator('#allday').isChecked(), W + ' next day: all day ON again');
    eq(S.errs, [], W + ' no page errors (flags)'); await S.ctx.close();
  }

  // ===== 4. tap to measure, tap the green to place the pin (map turned and north-up) =====
  for (const W of [390, 820, 1280]) {
    const me = F.at(10, 60); S = await open(b, W, { geo: { lat: me.lat, lon: me.lon, acc: 3 } }); p = S.p; await openCourse(S);
    s = await state(p); near(s.rot, G.bearing(me, H1.green.center), 1, W + ' line of play points up (map turned ' + Math.round(s.rot) + ' deg)');
    const up = await p.evaluate((q) => { const a = window.GolfGPSPage.screenOf(q.me), g = window.GolfGPSPage.screenOf(q.g); return { dx: g.x - a.x, dy: g.y - a.y }; }, { me, g: H1.green.center }); ok(Math.abs(up.dx) < 3 && up.dy < -100, W + ' the green is straight above the player on screen ' + JSON.stringify(up));
    const inBox = await p.evaluate((q) => { const b = document.querySelector('#mapbox').getBoundingClientRect(); return q.every((x) => { const s = window.GolfGPSPage.screenOf(x); return s.x > b.left && s.x < b.right && s.y > b.top + 10 && s.y < b.bottom - 10; }); }, [me, H1.green.center, H1.green.back]); ok(inBox, W + ' player and green are both in view');
    const spot = F.at(-20, 200), a = yd(me, spot), c = yd(spot, H1.green.center);
    await tapMap(p, spot); ok(await p.locator('#mread').isVisible(), W + ' measure readout'); const m1 = +(await T(p, '#m1')).replace(/[^\d]/g, ''), m2 = +(await T(p, '#m2')).replace(/[^\d]/g, '');
    near(m1, a, 2, W + ' to that spot (hand: ' + Math.round(a) + ')'); near(m2, c, 2, W + ' from there to the pin (hand: ' + Math.round(c) + ')'); ok(/To that spot: \d+ yd/.test(await T(p, '#m1')) && /From there to the pin: \d+ yd/.test(await T(p, '#m2')), W + ' readout wording'); await shot(p, W + '-05-measure');
    await tapMap(p, F.at(30, 150)); ok(!(await p.locator('#mread').isVisible()), W + ' second tap clears'); eq((await state(p)).meas, null, W + ' cleared');
    // place the pin by tapping the green
    await p.click('#placepin'); ok(/Tap the green where the pin is/.test(await T(p, '#mmode')), W + ' pin mode banner'); await p.waitForTimeout(500);
    await tapMap(p, F.at(0, 180)); ok(/not on the green/.test(await T(p, '#toast')), W + ' a tap off the green is refused'); eq((await state(p)).mode, 'pin', W + ' still waiting for the green');
    const pinAt = F.at(5, 306); await tapMap(p, pinAt); eq(await T(p, '#dwhy'), 'Pin placed by you', W + ' label'); near(await num(p, '#dpin'), yd(me, pinAt), 2, W + ' distance to my pin'); ok(await p.locator('#unpin').isVisible(), W + ' Remove my pin offered'); ok(/Pin placed by you on this hole/.test(await T(p, '#flags .note')), W + ' the colour row says the colour is not used here');
    await p.click('.fbs [data-color="red"]'); eq(await T(p, '#dwhy'), 'Pin placed by you', W + ' a manual pin overrides the colour on that hole'); await shot(p, W + '-06-my-pin');
    await p.click('#next'); eq(await T(p, '#dwhy'), 'Red flag = Short', W + ' hole 2 uses the colour (manual pin was hole 1 only)'); await p.click('#prev'); await p.click('#unpin'); eq(await T(p, '#dwhy'), 'Red flag = Short', W + ' removed: back to the colour');
    // north up: not turned, still measures right
    await p.click('#ori'); s = await state(p); eq([s.rot, s.holeUp], [0, false], W + ' north up'); eq(await T(p, '#ori'), 'Hole up', W + ' button offers Hole up'); await tapMap(p, spot); near(+(await T(p, '#m1')).replace(/[^\d]/g, ''), a, 2, W + ' north up measure'); await shot(p, W + '-07-north-up'); await tapMap(p, spot);
    await p.click('#zin'); await p.click('#zout'); await p.click('#fit'); await p.click('#ori'); near((await state(p)).rot, G.bearing(me, H1.green.center), 1, W + ' hole up again');
    eq(S.errs, [], W + ' no page errors (map)'); await S.ctx.close();
  }

  // ===== 5. unmapped green -> mark it (GPS and tap), signed in and not =====
  for (const W of [390, 1280]) {
    const me = F.at(500, 398), posts = []; S = await open(b, W, { geo: { lat: me.lat, lon: me.lon, acc: 5 }, tok: 'tok-ann', post: (u, body) => { posts.push(body); return { s: 200, j: { ok: true, n: body.n, what: body.what, point: body.point } }; } }); p = S.p; await openCourse(S, '?course=way/100&hole=3');
    eq(await p.locator('#hsel').inputValue(), '3', W + ' deep link opens hole 3'); ok(/This green is not drawn on the map/.test(await T(p, '#more')), W + ' says the green is not drawn'); ok(/no outline on the map yet, showing centre/.test(await T(p, '#flags .note')), W + ' colour note'); ok(await p.locator('.fbs [data-color="red"]').isDisabled() && await p.locator('.scl [data-place="front"]').isDisabled(), W + ' colour and placement buttons disabled'); eq(await T(p, '#dwhy'), 'Center of the green', W + ' label'); await shot(p, W + '-08-unmapped-3');
    await p.click('[data-mark="green"]'); await p.waitForTimeout(200); eq(posts.length, 1, W + ' mark sent'); eq([posts[0].id, posts[0].n, posts[0].what], ['way/100', 3, 'green'], W + ' mark body'); near(yd(posts[0].point, me), 0, 0.3, W + ' marked where the player stands'); eq(S.posts[0].tok, 'tok-ann', W + ' sent with the sign-in'); ok(/Green marked for hole 3\. Saved for everyone/.test(await T(p, '#toast')), W + ' toast ' + (await T(p, '#toast'))); near(await num(p, '#dpin'), 0, 1, W + ' standing on it: 0 yd');
    // hole 9 has nothing: tap the map to mark its green, then the tee
    await p.selectOption('#hsel', '9'); ok(/This green is not on the map yet/.test(await T(p, '#more')) && (await T(p, '#dpin')) === '–', W + ' hole 9: nothing yet'); ok(/not mapped/.test(await p.locator('#hsel option').nth(8).textContent()), W + ' dropdown says not mapped');
    await p.click('[data-tapmark="green"]'); ok(/Tap the middle of the green for hole 9/.test(await T(p, '#mmode')), W + ' banner'); await p.click('#mcancel'); eq((await state(p)).mode, 'measure', W + ' Cancel'); await p.click('[data-tapmark="green"]'); await p.waitForTimeout(500);
    const g9 = F.at(520, 430); await tapMap(p, g9); await p.waitForTimeout(200); eq([posts[1].n, posts[1].what], [9, 'green'], W + ' hole 9 green'); near(yd(posts[1].point, g9), 0, 2, W + ' at the tapped spot'); near(await num(p, '#dpin'), yd(me, g9), 2, W + ' distance appears'); ok(!/not mapped/.test(await p.locator('#hsel option').nth(8).textContent()), W + ' dropdown updated');
    await p.click('[data-tapmark="tee"]'); await p.waitForTimeout(500); await tapMap(p, F.at(520, 300)); await p.waitForTimeout(200); eq([posts[2].n, posts[2].what], [9, 'tee'], W + ' hole 9 tee'); await shot(p, W + '-09-marked-9');
    eq(S.errs, [], W + ' no page errors (mark)'); await S.ctx.close();
    // poor accuracy: standing-on-it mark refused; not signed in + tap: this phone only
    S = await open(b, W, { geo: { lat: me.lat, lon: me.lon, acc: 20.1 } }); p = S.p; await openCourse(S, '?course=way/100&hole=3');
    ok(/^GPS ±22 yd/.test(await T(p, '#gpst')), W + ' poor accuracy shown: ' + (await T(p, '#gpst'))); ok(await p.locator('.gps.bad').count() === 1, W + ' flagged'); await shot(p, W + '-10-poor-gps');
    await p.click('[data-mark="green"]'); ok(/only good to ±22 yd/.test(await T(p, '#toast')), W + ' mark refused on weak GPS'); eq(S.posts.length, 0, W + ' nothing sent');
    await p.click('[data-tapmark="green"]'); await p.waitForTimeout(500); await tapMap(p, F.at(500, 401)); await p.waitForTimeout(150); ok(/Saved on this phone only \(not signed in\)/.test(await T(p, '#toast')), W + ' device-only mark'); eq(S.posts.length, 0, W + ' not sent'); ok(await p.evaluate(() => !!JSON.parse(localStorage.getItem('ggps-marks'))['way/100']['3:green']), W + ' kept on the phone'); ok(/Marked on this phone/.test(await T(p, '#more')), W + ' says so');
    eq(S.errs, [], W + ' no page errors (poor)'); await S.ctx.close();
  }

  // ===== 6. GPS states: denied, not asked yet, far away, hidden page =====
  for (const W of [390, 1280]) {
    S = await open(b, W, { perm: 'denied' }); p = S.p; await openCourse(S);
    ok(/Location is turned off for this page/.test(await T(p, '#gpst')), W + ' denied text: ' + (await T(p, '#gpst'))); eq(await T(p, '#dfrom'), 'from the tee', W + ' denied: from the tee'); near(await num(p, '#dpin'), 300 / 0.9144, 1, W + ' denied: tee distance'); ok(await p.locator('#gpson').isVisible(), W + ' Turn on GPS offered'); await shot(p, W + '-11-gps-denied');
    await p.click('[data-mark="green"]'); ok(/No GPS fix yet/.test(await T(p, '#toast')), W + ' no fix: standing mark refused'); eq(S.errs, [], W + ' no page errors (denied)'); await S.ctx.close();
    // permission not given yet: nothing is asked until the tap
    S = await open(b, W, { geo: { lat: H1.tee.lat, lon: H1.tee.lon }, perm: 'prompt' }); p = S.p; await openCourse(S); s = await state(p); eq([s.watching, s.fix], [false, null], W + ' no permission yet: GPS not started by itself'); ok(/GPS is off/.test(await T(p, '#gpst')), W + ' says GPS is off'); eq(await T(p, '#dfrom'), 'from the tee', W + ' from the tee');
    await S.ctx.grantPermissions(['geolocation']); await p.click('#gpson'); await p.waitForFunction(() => window.GolfGPSPage.state().fix); eq(await T(p, '#dfrom'), 'from you', W + ' after the tap: from you'); ok(!(await p.locator('#gpson').count()), W + ' button gone');
    // GPS only while visible
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); }); eq((await state(p)).watching, false, W + ' hidden: GPS stopped');
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); }); eq((await state(p)).watching, true, W + ' visible again: GPS back on');
    await p.click('#back'); eq((await state(p)).watching, false, W + ' back on the picker: GPS off'); ok(await p.locator('#pv').isVisible() && /Test Links/.test(await T(p, '#recent')), W + ' Back returns to the picker with the recent course'); await S.ctx.close();
    // far from the course
    const far = { lat: H1.tee.lat + 0.06, lon: H1.tee.lon }; S = await open(b, W, { geo: far }); p = S.p; await openCourse(S); ok(/You're not at the course\. Distances are from where you are\./.test(await T(p, '#gpst')), W + ' far text: ' + (await T(p, '#gpst'))); near(await num(p, '#dpin'), yd(far, H1.green.center), 3, W + ' far: distance from where you are'); await noSide(p, W + ' far'); await shot(p, W + '-12-far'); eq(S.errs, [], W + ' no page errors (far)'); await S.ctx.close();
  }

  // ===== 7. "Looks like you're on the 2nd tee": suggested after 10 s, never switched silently =====
  { S = await open(b, 390, { geo: { lat: H2.tee.lat, lon: H2.tee.lon } }); p = S.p; await openCourse(S); await p.waitForTimeout(4000); ok(!(await p.locator('#sug').isVisible()), 'tee: nothing after 4 s'); eq(await p.locator('#hsel').inputValue(), '1', 'tee: still hole 1');
    await p.waitForSelector('#sug:not([hidden])', { timeout: 12000 }); eq(await T(p, '#sug span'), 'Looks like you\'re on the 2nd tee. Switch?', 'tee: suggestion text'); eq(await p.locator('#hsel').inputValue(), '1', 'tee: not switched by itself'); await noSide(p, 'tee bar'); await shot(p, '390-13-tee-suggest');
    await p.click('#sugn'); await p.waitForTimeout(4500); ok(!(await p.locator('#sug').isVisible()), 'tee: No is respected while standing there'); await S.ctx.setGeolocation({ latitude: H1.tee.lat, longitude: H1.tee.lon, accuracy: 4 }); await p.waitForTimeout(2500); await S.ctx.setGeolocation({ latitude: H2.tee.lat, longitude: H2.tee.lon, accuracy: 4 });
    await p.waitForSelector('#sug:not([hidden])', { timeout: 16000 }); await p.click('#sugy'); eq(await p.locator('#hsel').inputValue(), '2', 'tee: Switch goes to hole 2'); eq(S.errs, [], 'no page errors (tee)'); await S.ctx.close(); }

  // ===== 8. course colours stored for the course: set + locked, another account, report, review, offline =====
  for (const W of [390, 1280]) {
    const MAPW = { red: 'short', white: 'center', blue: 'long', yellow: 'long' };
    // (a) signed in, nothing set: saving stores it for the course and locks it
    let srv = {}; S = await open(b, W, { geo: { lat: H1.tee.lat, lon: H1.tee.lon }, tok: 'tok-ann', course: () => F.course(srv), post: (u, body) => { srv = { flags: { map: body.flags, locked: true, at: 1, canChange: true } }; return { s: 200, j: { ok: true, flags: srv.flags } }; } }); p = S.p; await openCourse(S);
    ok(/Not set for this course yet/.test(await T(p, '.cfl')), W + ' (a) not set yet'); await p.click('#fset'); ok(/Once saved, this is locked for the course/.test(await T(p, '#sheetin')), W + ' (a) sheet warns it locks'); await p.selectOption('#sheet [data-fc="yellow"]', 'center'); await p.click('#shsave'); await p.waitForSelector('#sheet', { state: 'hidden' });
    eq(S.posts[0], { path: '/mark', body: { id: 'way/100', what: 'flags', flags: { red: 'short', white: 'center', blue: 'long', yellow: 'center' } }, tok: 'tok-ann' }, W + ' (a) posted'); ok(/Saved for this course/.test(await T(p, '#toast')), W + ' (a) toast');
    ok(/Course flag colours: Red = Short, White = Center, Blue = Long, Yellow = Center 🔒/.test(await T(p, '.cfl')), W + ' (a) locked line: ' + (await T(p, '.cfl'))); eq(await T(p, '#fset'), 'Change', W + ' (a) who set it may change'); await shot(p, W + '-14-course-colours-locked'); await S.ctx.close();
    // (b) another account: just uses it; Report a change
    let pend = false; S = await open(b, W, { geo: { lat: H1.tee.lat, lon: H1.tee.lon }, tok: 'tok-bob', course: () => F.course(Object.assign({ flags: { map: { red: 'long', white: 'center', blue: 'short', yellow: 'short' }, locked: true, at: 1, canChange: false } }, pend ? { flagsPending: true } : {})), post: (u, body) => { if (/flagreport/.test(u)) { pend = true; return { s: 200, j: { ok: true, pending: true } }; } return { s: 403, j: { ok: false, error: 'Ask the organizer to change it' } }; } }); p = S.p; await openCourse(S);
    ok(/Course flag colours: Red = Long, White = Center, Blue = Short, Yellow = Short 🔒/.test(await T(p, '.cfl')), W + ' (b) sees the course colours'); ok(!(await p.locator('#fset').count()) && await p.locator('#frep').isVisible(), W + ' (b) no Change, Report a change instead');
    await p.click('.fbs [data-color="red"]'); eq(await T(p, '#dwhy'), 'Red flag = Long', W + ' (b) the course meaning is used'); eq(await p.locator('.fbs .red small').textContent(), 'Long', W + ' (b) button shows the course meaning');
    await p.click('#frep'); await p.waitForSelector('#sheet:not([hidden])'); eq(await T(p, '#sheetin h2'), 'What do the flags mean at this course now?', W + ' (b) report sheet title'); eq(await p.locator('#sheet [data-fc="red"]').inputValue(), 'back', W + ' (b) prefilled with the current meaning'); eq(await p.locator('#fnote').getAttribute('maxlength'), '100', W + ' (b) note 100 chars'); await noSide(p, W + ' report sheet'); await taps(p, W + ' report sheet'); await shot(p, W + '-15-report-sheet');
    await p.click('#shsave'); ok(/already this course/.test(await T(p, '#shmsg')), W + ' (b) identical refused'); eq(S.posts.length, 0, W + ' (b) not sent');
    await p.selectOption('#sheet [data-fc="red"]', 'front'); await p.fill('#fnote', 'New <i>flags</i> this month'); await p.click('#shsave'); await p.waitForSelector('#sheet', { state: 'hidden' });
    eq(S.posts[0], { path: '/flagreport', body: { id: 'way/100', flags: { red: 'short', white: 'center', blue: 'short', yellow: 'short' }, note: 'New <i>flags</i> this month' }, tok: 'tok-bob' }, W + ' (b) report posted'); eq(await T(p, '#toast'), 'Sent. The organizer will review it.', W + ' (b) toast'); eq(await T(p, '#pend'), 'Change reported, waiting for review.', W + ' (b) line'); eq(await T(p, '#dwhy'), 'Red flag = Long', W + ' (b) nothing changes until review'); await shot(p, W + '-16-reported');
    await p.reload(); await p.waitForSelector('#hole:not([hidden])'); eq(await T(p, '#pend'), 'Change reported, waiting for review.', W + ' (b) still waiting after a reload'); await S.ctx.close();
    // (c) not signed in on a locked course: no report button, told to ask
    S = await open(b, W, { course: () => F.course({ flags: { map: MAPW, locked: true, at: 1, canChange: false } }) }); p = S.p; await openCourse(S); ok(!(await p.locator('#frep').count()) && !(await p.locator('#fset').count()) && /Ask the organizer to change it/.test(await T(p, '#more')), W + ' (c) not signed in: ask the organizer'); await S.ctx.close();
    // (d) the owner reviews: accept / dismiss; texts escaped
    for (const act of ['accept', 'dismiss']) {
      let st = { flags: { map: MAPW, locked: true, at: 1, canChange: true }, pendingFlags: { flags: { red: 'long', white: 'center', blue: 'short', yellow: 'short' }, note: 'saw it <img src=x onerror=alert(1)>', from: 'Player <b>bob</b>', at: 2 } };
      S = await open(b, W, { tok: 'tok-owner', course: () => F.course(st), post: (u, body) => { if (body.action === 'accept') { st = { flags: { map: st.pendingFlags.flags, locked: true, at: 3, canChange: true } }; return { s: 200, j: { ok: true, flags: st.flags } }; } st = { flags: st.flags }; return { s: 200, j: { ok: true } }; } }); p = S.p; await openCourse(S);
      ok(/Proposed change from Player <b>bob<\/b>: Red = Long, White = Center, Blue = Short, Yellow = Short/.test(await T(p, '#review')), W + ' (d) proposal shown: ' + (await T(p, '#review'))); eq(await p.locator('#review img, #review b b').count(), 0, W + ' (d) texts escaped'); ok(/saw it <img/.test(await T(p, '#review .note')), W + ' (d) note shown as text'); if (act === 'accept') { await noSide(p, W + ' review'); await shot(p, W + '-17-review'); }
      await p.click(act === 'accept' ? '#rvacc' : '#rvdis'); await p.waitForSelector('#review', { state: 'detached' }); eq(S.posts[0], { path: '/flagreport', body: { id: 'way/100', action: act }, tok: 'tok-owner' }, W + ' (d) ' + act + ' posted');
      ok(new RegExp(act === 'accept' ? 'Course flag colours: Red = Long, White = Center, Blue = Short, Yellow = Short 🔒' : 'Course flag colours: Red = Short, White = Center, Blue = Long, Yellow = Long 🔒').test(await T(p, '.cfl')), W + ' (d) after ' + act + ': ' + (await T(p, '.cfl'))); eq(S.errs, [], W + ' no page errors (review)'); await S.ctx.close();
    }
    // (e) signed in but the server cannot be reached when saving: this phone only, and it says so
    S = await open(b, W, { tok: 'tok-ann', post: () => 'abort' }); p = S.p; await openCourse(S); await p.click('#fset'); await p.selectOption('#sheet [data-fc="blue"]', 'center'); await p.click('#shsave'); await p.waitForSelector('#sheet', { state: 'hidden' }); ok(/Saved on this phone only \(no signal\)/.test(await T(p, '#toast')), W + ' (e) offline fallback: ' + (await T(p, '#toast'))); ok(/Blue = Center/.test(await T(p, '.cfl')) && /this phone only/.test(await T(p, '.cfl')) && !/🔒/.test(await T(p, '.cfl')), W + ' (e) line'); await S.ctx.close();
  }

  // ===== 9. failures: course map down, saved copy, tiles down, bad link =====
  { let mode = 'ok'; S = await open(b, 390, { course: () => (mode === 'ok' ? F.course() : mode) }); p = S.p; await openCourse(S); mode = 'abort'; await p.reload(); await p.waitForSelector('#hole:not([hidden])'); ok(/No signal: showing the copy of this course saved on this phone/.test(await T(p, '#cmsg')), 'offline: saved copy used and said'); near(await num(p, '#dcenter'), 300 / 0.9144, 1, 'offline: distances still work'); await shot(p, '390-18-offline-copy'); await S.ctx.close();
    S = await open(b, 390, { course: () => 'fail' }); p = S.p; await p.goto(URL0 + '?course=way/100'); await p.waitForSelector('#retry'); ok(/not answering right now/.test(await T(p, '#cmsg')), 'course map down: plain message'); ok(await p.locator('#back').isVisible(), 'failed course: Back is there'); await noSide(p, 'failed'); await shot(p, '390-19-course-failed'); S.o.course = null; await p.click('#retry'); await p.waitForSelector('#hole:not([hidden])'); ok(true, 'Try again works'); await S.ctx.close();
    S = await open(b, 390, { tiles: 'fail', geo: { lat: H1.tee.lat, lon: H1.tee.lon } }); p = S.p; await openCourse(S); await p.waitForTimeout(600); ok(/satellite picture is not loading/.test(await T(p, '#attr')), 'tiles down: said under the map'); near(await num(p, '#dpin'), 300 / 0.9144, 1, 'tiles down: numbers unaffected'); ok(await p.locator('.gi.flag').count() === 1, 'tiles down: flag still drawn'); await shot(p, '390-20-no-tiles'); eq(S.errs, [], 'no page errors (tiles down)'); await S.ctx.close();
    S = await open(b, 390, {}); p = S.p; await p.goto(URL0 + '?course=way/1%3Cscript%3E&hole=2'); await p.waitForSelector('#pv:not([hidden])'); ok(true, 'a bad course in the link falls back to the picker'); eq(S.hits.length, 0, 'bad link: nothing asked of the server');
    S.o.search = () => 'fail'; await p.fill('#q', 'Mission'); await p.click('#sb'); await p.waitForSelector('#smsg .card.err'); ok(/not answering/.test(await T(p, '#smsg')), 'search down: message'); await p.fill('#q', 'a'); await p.click('#sb'); ok(/Type a course name or a city/.test(await T(p, '#smsg')), 'one letter refused'); eq(S.errs, [], 'no page errors (failures)'); await S.ctx.close();
    // near me: location asked only on the tap; denied says so
    S = await open(b, 390, { geo: { lat: 26.2, lon: -98.23 } }); p = S.p; await p.goto(URL0); await p.click('#near'); await p.waitForSelector('.cc'); ok(/search\?lat=26\.20000&lon=-98\.23000&r=15/.test(S.hits[0]), 'near me call ' + S.hits[0]); await S.ctx.close();
    S = await open(b, 390, { perm: 'denied' }); p = S.p; await p.goto(URL0); await p.click('#near'); await p.waitForSelector('#smsg .card.warn'); ok(/Location is turned off/.test(await T(p, '#smsg')), 'near me denied'); await S.ctx.close(); }

  // ===== 10. the ways in: PGA page button, League menu =====
  { S = await open(b, 390, {}); p = S.p; await p.route('**/site.api.espn.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' })); await p.goto(BASE + 'pga.html'); await p.waitForSelector('#gpslink'); eq(await T(p, '#gpslink'), '📍 Golf GPS (your round)', 'PGA page button text'); ok(await p.evaluate(() => document.querySelector('#gpslink').getBoundingClientRect().height >= 44), 'PGA page button 44+'); await noSide(p, 'pga page'); await shot(p, '390-21-pga-entry');
    ok(await p.locator('#lgsel option[value="golfgps"]').count() === 1, 'PGA page League menu has Golf GPS'); await p.click('#gpslink'); await p.waitForURL(/golfgps\.html/); ok(true, 'PGA button opens Golf GPS'); await p.click('a.home[href="pga.html"]'); await p.waitForURL(/pga\.html/); await p.selectOption('#lgsel', 'golfgps'); await p.waitForURL(/golfgps\.html/); ok(true, 'League menu on the PGA page opens Golf GPS'); await S.ctx.close(); }

  await b.close();
  console.log('golfgps shots: ' + pass + ' passed, ' + fail + ' failed. Screenshots in ' + OUT);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
