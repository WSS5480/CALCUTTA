// Run: see cfb.test.js. Needs origin/main served on :27432 and this branch on :27431 (static build of each).
// Before / after: main (origin/main, :27432) vs this branch with the switch OFF and ON (:27431). NFL everywhere, plus college with the switch off.
const { open, chromium } = require('./h');
const crypto = require('crypto'); const H = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const W = (process.argv[2] || '430,1280').split(',').map(Number);
async function capture(browser, port, flag, lg, w) {
  const s = await open({ browser, port, flag, lg, w }), p = s.page, out = {};
  const views = lg === 'nfl' ? ['games', 'stats', 'best', 'moves', 'results', 'rest', 'stand', 'tstats', 'season'] : ['games', 'stats', 'best', 'moves', 'results', 'rest'];
  for (const v of views) { await p.evaluate((v) => gvSet(v), v); await p.waitForTimeout(700); out['view ' + v] = await p.evaluate(() => document.querySelector('main').innerHTML.replace(/Updated[^<]*/g, '')); out['teams ' + v] = await p.evaluate(() => [...document.querySelectorAll('[data-team],[data-cteam]')].map((e) => e.outerHTML).join('\n')); }
  await p.evaluate(() => { gvSet('games'); navGo('livepg'); }); await p.waitForTimeout(700); out['live'] = await p.evaluate(() => [...document.querySelectorAll('[data-team],[data-cteam]')].map((e) => e.outerHTML).join('\n'));
  await p.evaluate(() => navGo('all')); await p.waitForTimeout(500);
  if (lg === 'nfl') {
    const el = p.locator('.ngt .t[data-team] >> visible=true').first(); await el.scrollIntoViewIfNeeded(); await el.click(); await p.waitForTimeout(800);
    out['opened by tap'] = await p.evaluate(() => { const t = document.getElementById('teampage'); return t && !t.hidden ? t.querySelector('.tpn').innerText : 'closed'; });
    await p.evaluate(() => tpClose());
    for (const a of ['BUF', 'CIN']) for (const k of ['games', 'picks', 'stats', 'stand', 'roster', 'news']) {
      await p.evaluate(([a, k]) => { tpClose(); tpOpen(a); tpTab(k); }, [a, k]); await p.waitForTimeout(700);
      out[`page ${a} ${k}`] = await p.evaluate(() => document.getElementById('teampage').innerHTML);
      out[`shot ${a} ${k}`] = H(await p.screenshot());
    }
    await p.evaluate(() => { tpClose(); tpOpen('BUF'); tpTab('stand'); }); await p.waitForTimeout(500); await p.click('#teampage tr[onclick*="MIA"]'); await p.waitForTimeout(500);
    out['stand tap'] = await p.evaluate(() => document.querySelector('#teampage .tpn').innerText); await p.click('#teampage button[aria-label="Back"]'); out['stand back'] = await p.evaluate(() => document.querySelector('#teampage .tpn').innerText);
    await p.evaluate(() => tpClose());
  }
  out.errors = s.errors.join('|'); out.calls = s.ctl.calls.map((c) => c.replace(/\d{10,}/g, '')).sort().join('\n');
  await s.ctx.close(); return out;
}
(async () => {
  const browser = await chromium.launch({ args: ['--no-proxy-server'] }); let diffs = 0, n = 0;
  for (const w of W) for (const lg of ['nfl', 'cfb']) {
    const M = await capture(browser, 27432, false, lg, w), runs = [['branch switch off', await capture(browser, 27431, false, lg, w)]];
    if (lg === 'nfl') runs.push(['branch switch on', await capture(browser, 27431, true, lg, w)]);
    for (const [name, B] of runs) { const keys = Object.keys(M); let d = 0; for (const k of keys) { n++; if (M[k] !== B[k]) { d++; diffs++; console.log(`DIFF ${w} ${lg} ${name}: ${k}  main=${H(M[k] || '')} branch=${H(B[k] || '')}`); if (M[k].length < 400) console.log('   main:', JSON.stringify(M[k]), '\n   branch:', JSON.stringify(B[k])); } } console.log(`${w} ${lg} main vs ${name}: ${keys.length - d} of ${keys.length} identical; page errors main "${M.errors}" branch "${B.errors}"; opened by tap: ${(B['opened by tap'] || '-').replace(/\n/g, ' / ')}`); }
  }
  await browser.close(); console.log(`before/after: ${n - diffs} of ${n} identical`); process.exit(diffs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
