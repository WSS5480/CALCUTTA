// shared Playwright harness: mirror mode, outside network blocked, ESPN mocked, per-kind hold / fail control
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { answer } = require('./mock');
async function open(o) {
  const browser = o.browser || await chromium.launch({ args: ['--no-proxy-server'] });
  const ctx = await browser.newContext({ viewport: { width: o.w || 430, height: o.h || 900 }, deviceScaleFactor: 1, isMobile: (o.w || 430) < 800, hasTouch: (o.w || 430) < 800, serviceWorkers: 'block' });
  const ctl = { mode: {}, held: [], calls: [], outside: [] };
  await ctx.addInitScript(([lg, flag]) => { try { if (!sessionStorage.getItem('t-init')) { localStorage.clear(); sessionStorage.setItem('t-init', '1'); } localStorage.setItem('pics-lg', lg); } catch (e) {} if (flag) window.ODDCFG = { ok: true, card_theme: 'oddable', cfbteam: true }; }, [o.lg || 'cfb', !!o.flag]);
  await ctx.route('**/*', async (route) => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:')) return route.continue();
    if (/^https:\/\/site\.(web\.)?api\.espn\.com\//.test(u)) {
      const [k, body] = answer(u); ctl.calls.push(k + ' ' + u.replace(/^https:\/\/[^/]+/, '')); const md = ctl.mode[k];
      if (md === 'fail') return route.fulfill({ status: 503, body: 'no' });
      if (md === 'hold') { ctl.held.push({ route, k, body }); return; }
      if (typeof md === 'function') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(md(JSON.parse(JSON.stringify(body)))) }); // a bad-shape answer (review 1)
      if (body === null) return route.fulfill({ status: 404, body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    }
    ctl.outside.push(u.slice(0, 90)); return route.abort();
  });
  ctl.release = async (k) => { const keep = []; for (const h of ctl.held) { if (k && h.k !== k) { keep.push(h); continue; } const md = ctl.mode[h.k]; await h.route.fulfill(md === 'fail' ? { status: 503, body: 'no' } : { status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(h.body) }).catch(() => {}); } ctl.held = keep; };
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto('http://127.0.0.1:' + (o.port || 27431) + '/index.html?mirror=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.ngt .t').length > 3, null, { timeout: 30000 });
  await page.waitForTimeout(3500);
  return { browser, ctx, page, errors, ctl };
}
// layout: sideways scroll anywhere, a table wider than the screen, the My Bets banner over a control, tap targets under 40px inside the team page
async function layout(page) {
  return page.evaluate(() => {
    const W = innerWidth, out = { sideways: [], covered: [], small: [] }, vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    if (document.documentElement.scrollWidth > W + 1) out.sideways.push('page ' + document.documentElement.scrollWidth);
    document.querySelectorAll('#teampage *').forEach((e) => { if (!vis(e)) return; const r = e.getBoundingClientRect(); if (r.right > W + 1) out.sideways.push(e.tagName + '.' + e.className + ' ' + Math.round(r.right)); if (e.scrollWidth > e.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(e).overflowX)) out.sideways.push('scroller ' + e.className); });
    const plb = document.getElementById('plb');
    if (plb && vis(plb)) { const b = plb.getBoundingClientRect(); document.querySelectorAll('button,a,select,[onclick],[data-cteam],[data-team],.card,tr').forEach((e) => { if (!vis(e) || plb.contains(e)) return; const r = e.getBoundingClientRect(), ox = Math.min(r.right, b.right) - Math.max(r.left, b.left), oy = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top); if (ox > 2 && oy > 2) { const at = document.elementFromPoint(Math.max(r.left, b.left) + ox / 2, Math.max(r.top, b.top) + oy / 2); if (at && plb.contains(at)) out.covered.push(e.tagName + ' ' + (e.textContent || '').trim().slice(0, 20)); } }); }
    const tp = document.getElementById('teampage');
    if (tp && !tp.hidden) tp.querySelectorAll('button,tr[onclick],a[onclick]').forEach((e) => { if (!vis(e)) return; const r = e.getBoundingClientRect(); if (r.height < 40) out.small.push(e.tagName + ' "' + (e.textContent || '').trim().slice(0, 18) + '" ' + Math.round(r.height)); });
    return out;
  });
}
module.exports = { open, layout, chromium };
