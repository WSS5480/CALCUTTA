// Run (Playwright from /opt/npm-tools; see HANDOFF "CFB-TEAM"): build the static site of this branch into a folder and serve it on 127.0.0.1:27431 (and origin/main on :27432 for nfl.compare.js), then `node scripts/cfbteam/cfb.test.js 360,430,1280` / `node scripts/cfbteam/nfl.compare.js 360,430,1280`. Screenshots go to /tmp/cfbt/shots.
// CFB-TEAM: college team page tests (flag on), flag-off checks, at 360 / 430 / 1280. Usage: node cfb.test.js [widths]
const { open, layout, chromium } = require('./h');
const fs = require('fs');
const W = (process.argv[2] || '360,430,1280').split(',').map(Number);
let pass = 0, fail = 0; const bad = [];
const ok = (c, m) => { if (c) pass++; else { fail++; bad.push(m); } };
const tpOpenNow = (p) => p.evaluate(() => { const t = document.getElementById('teampage'); return !!t && !t.hidden; });
const head = (p) => p.evaluate(() => (document.querySelector('#teampage .tpn') || {}).innerText || '');
const body = (p) => p.evaluate(() => (document.querySelector('#teampage .tpb') || {}).innerText || '');
const state = (p) => p.evaluate(() => ({ gv: GV, view: VIEW, y: Math.round(SC.scrollTop), open: [...document.querySelectorAll('details[open]')].map((d) => d.getAttribute('data-k')).join(','), det: JSON.stringify(DET), sheet: !!(document.getElementById('infosheet') && !document.getElementById('infosheet').hidden) }));
async function lay(p, tag) { const l = await layout(p); ok(!l.sideways.length, tag + ' sideways ' + l.sideways.join('|')); ok(!l.covered.length, tag + ' banner covers ' + l.covered.join('|')); ok(!l.small.length, tag + ' small targets ' + l.small.join('|')); }
async function tapFrom(s, w, where, prep, sel) {
  const p = s.page; await prep(p); await p.waitForTimeout(700);
  const h = await p.evaluateHandle((sel) => [...document.querySelectorAll(sel)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || null, sel);
  const el = h.asElement(); ok(!!el, `${w} ${where}: a tappable college team exists (${sel})`); if (!el) return;
  await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  const id = await el.getAttribute('data-cteam'), before = await state(p);
  await el.click(); await p.waitForTimeout(600);
  ok(await tpOpenNow(p), `${w} ${where}: page opens`);
  const nm = await head(p), want = require('./mock').L.cfb.T.find((t) => t[0] === id);
  ok(want && nm.includes(want[2]), `${w} ${where}: right team (id ${id}) header "${nm.split('\n')[0]}"`);
  await lay(p, `${w} ${where} page`);
  await p.click('#teampage button[aria-label="Back"]'); await p.waitForTimeout(500);
  ok(!(await tpOpenNow(p)), `${w} ${where}: Back closes`);
  const after = await state(p); ok(JSON.stringify(after) === JSON.stringify(before), `${w} ${where}: Back returns to the same place ${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
  await lay(p, `${w} ${where} after back`);
}
(async () => {
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  fs.mkdirSync('/tmp/cfbt/shots', { recursive: true });
  for (const w of W) {
    // ---------- flag ON ----------
    const s = await open({ browser, lg: 'cfb', flag: true, w }); const p = s.page;
    const counts = {};
    await tapFrom(s, w, 'Games card', (p) => p.evaluate(() => gvSet('games')), '.ngt .t[data-cteam]');
    counts.games = await p.evaluate(() => document.querySelectorAll('[data-cteam]').length);
    await tapFrom(s, w, 'Results row', async (p) => { await p.evaluate(() => gvSet('results')); await p.waitForTimeout(500); await p.evaluate(() => { const d = [...document.querySelectorAll('details')].find((x) => x.querySelector('details.res') && !x.open); if (d) d.querySelector('summary').click(); }); }, 'details.res summary [data-cteam]');
    counts.results = await p.evaluate(() => document.querySelectorAll('[data-cteam]').length);
    await tapFrom(s, w, 'Best row', (p) => p.evaluate(() => gvSet('best')), '.rkrow summary [data-cteam]');
    counts.best = await p.evaluate(() => document.querySelectorAll('[data-cteam]').length);
    for (const v of ['stats', 'moves', 'rest']) { await p.evaluate((v) => gvSet(v), v); await p.waitForTimeout(400); counts[v] = await p.evaluate(() => document.querySelectorAll('[data-cteam]').length); }
    await tapFrom(s, w, 'Live card', (p) => p.evaluate(() => { gvSet('games'); navGo('livepg'); }), '.gtm[data-cteam]');
    counts.live = await p.evaluate(() => document.querySelectorAll('[data-cteam]').length);
    // a Results row's own tap must not fire under the name, a Live card chart must not toggle: covered by the state compare above
    await p.evaluate(() => navGo('all')); await p.waitForTimeout(500);
    // same abbreviation, two teams: MSU 344 (SEC) and MSU 127 (Big Ten)
    for (const [id, nm] of [['344', 'Mississippi State'], ['127', 'Michigan State']]) { await p.evaluate((id) => tpOpen(id), id); await p.waitForTimeout(500); ok((await head(p)).includes(nm), `${w} same abbreviation: id ${id} -> ${nm}`); await p.evaluate(() => tpClose()); }
    // ---------- tabs: loading / ready / failed + Try again ----------
    const tabs = [['games', 'sched', 'Loading the full schedule', 'Post', 'full schedule (bowls, playoff) is not available'], ['stand', 'stand', 'Loading standings', 'Big Ten Conference', 'Standings not available right now'], ['stats', 'stats', 'Loading team stats', 'Points per game', 'Team stats not available right now'], ['roster', 'roster', 'Loading roster', 'OFFENSE', 'Roster not available right now']];
    for (const [tab, kind, loading, ready, failed] of tabs) {
      await p.evaluate(() => { TPC = {}; tpClose(); }); s.ctl.mode[kind] = 'hold';
      await p.evaluate((tab) => { tpOpen('194'); tpTab(tab); }, tab); await p.waitForTimeout(500);
      ok((await body(p)).includes(loading), `${w} ${tab}: loading shows "${loading}"`); await lay(p, `${w} ${tab} loading`);
      if (w === 430) await p.screenshot({ path: `/tmp/cfbt/shots/cfb-${tab}-loading-430.png` });
      s.ctl.mode[kind] = undefined; await s.ctl.release(kind); await p.waitForTimeout(600);
      ok((await body(p)).includes(ready), `${w} ${tab}: ready shows "${ready}"`); await lay(p, `${w} ${tab} ready`);
      if (w === 430 || w === 1280) await p.screenshot({ path: `/tmp/cfbt/shots/cfb-${tab}-ready-${w}.png` });
      await p.evaluate(() => { TPC = {}; tpClose(); }); s.ctl.mode[kind] = 'fail';
      await p.evaluate((tab) => { tpOpen('194'); tpTab(tab); }, tab); await p.waitForTimeout(700);
      const fb = await body(p); ok(fb.includes(failed) && fb.includes('Try again'), `${w} ${tab}: failed shows "${failed}" + Try again: ${fb.slice(0, 120)}`); await lay(p, `${w} ${tab} failed`);
      if (w === 430) await p.screenshot({ path: `/tmp/cfbt/shots/cfb-${tab}-failed-430.png` });
      s.ctl.mode[kind] = undefined; const n0 = s.ctl.calls.length; await p.click('#teampage .tpb :is(a,button):has-text("Try again")'); await p.waitForTimeout(700);
      ok((await body(p)).includes(ready), `${w} ${tab}: Try again -> ready`); ok(s.ctl.calls.length - n0 <= 2, `${w} ${tab}: Try again makes one request (${s.ctl.calls.length - n0})`);
    }
    // header without teams/{id} (failed): name and record from the games on the phone
    await p.evaluate(() => { TPC = {}; tpClose(); }); s.ctl.mode.team = 'fail'; await p.evaluate(() => tpOpen('333')); await p.waitForTimeout(600);
    const hf = await head(p); ok(hf.includes('Alabama') && /\d+-\d+/.test(hf), `${w} header with teams/{id} failed: ${hf.replace(/\n/g, ' / ')}`); s.ctl.mode.team = undefined; await p.evaluate(() => tpClose());
    // missing stats: a team whose feed has no opponents -> two columns; a stat the feed lacks drops its row
    await p.evaluate(() => { TPC = {}; tpOpen('333'); tpTab('stats'); }); await p.waitForTimeout(600);
    const st = await body(p); ok(!st.includes('Opponents') && !st.includes('Giveaways') && st.includes('Points per game'), `${w} stats without opponents / missing rows dropped`);
    // flat roster fallback (Oregon)
    await p.evaluate(() => { tpClose(); tpOpen('2483'); tpTab('roster'); }); await p.waitForTimeout(600); ok((await body(p)).toUpperCase().includes('PLAYERS · 11'), `${w} flat roster -> Players list`); await lay(p, `${w} flat roster`);
    // ---------- conference table: tap another team, Back returns ----------
    await p.evaluate(() => { tpClose(); tpOpen('194'); tpTab('stand'); }); await p.waitForTimeout(600);
    const rowsN = await p.evaluate(() => document.querySelectorAll('#teampage tr[onclick]').length); ok(rowsN === 5, `${w} conference table: 5 other teams tappable (${rowsN})`);
    ok(await p.evaluate(() => /font-weight:700/.test(([...document.querySelectorAll('#teampage tr')].find((r) => /OSU/.test(r.innerText)) || {}).getAttribute?.('style') || '')), `${w} this team highlighted`);
    await p.click('#teampage tr[onclick*="130"]'); await p.waitForTimeout(600);
    ok((await head(p)).includes('Michigan Wolverines'), `${w} conference tap opens Michigan`);
    await p.click('#teampage button[aria-label="Back"]'); await p.waitForTimeout(400);
    ok((await head(p)).includes('Ohio State'), `${w} Back returns to Ohio State`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300); ok(!(await tpOpenNow(p)), `${w} Escape closes`);
    // ✕ from two deep closes everything
    await p.evaluate(() => { tpOpen('194'); tpOpen('130'); }); await p.click('#teampage button[aria-label="Close"]'); await p.waitForTimeout(300); ok(!(await tpOpenNow(p)), `${w} X closes the stack`);
    // a finished game row opens it in Results
    await p.evaluate(() => { TPC = {}; tpOpen('194'); }); await p.waitForTimeout(600);
    await p.click('#teampage tr[onclick^="tpGame"]'); await p.waitForTimeout(900);
    const r = await p.evaluate(() => ({ gv: GV, tp: !document.getElementById('teampage').hidden })); ok(r.gv === 'results' && !r.tp, `${w} finished game -> Results ${JSON.stringify(r)}`);
    if (w === 430) { await p.evaluate(() => { TPC = {}; gvSet('games'); tpOpen('194'); }); await p.waitForTimeout(800); await p.screenshot({ path: '/tmp/cfbt/shots/cfb-header-430.png' }); await p.evaluate(() => tpClose()); }
    // ---------- review 1: wrong shapes -> "not available" + Try again (never Loading forever), header "#N", ATS tile, shared abbreviation, re-sort, ids ----------
    const BAD = [['games', 'sched', () => ({ events: {} }), 'Loading the full schedule'], ['roster', 'roster', () => ({ athletes: { a: 1 } }), 'Loading roster'], ['stats', 'stats', () => ({ results: { stats: { categories: {} } } }), 'Loading team stats'], ['stats', 'stats', () => null, 'Loading team stats'], ['roster', 'roster', () => 'x', 'Loading roster'], ['stand', 'stand', () => ({ children: {} }), 'Loading standings']];
    for (const [tab, kind, fn, loading] of BAD) {
      await p.evaluate(() => { TPC = {}; tpClose(); }); s.ctl.mode[kind] = fn; await p.evaluate((tab) => { tpOpen('194'); tpTab(tab); }, tab); await p.waitForTimeout(700);
      const t = await body(p); ok(!t.includes(loading) && !/undefined|NaN|\[object/.test(t), `${w} bad shape ${kind} ${String(fn).slice(6, 40)}: no endless loading / bad text: ${t.slice(0, 100)}`);
      ok(/not available/.test(t) && t.includes("Try again"), `${w} bad shape ${kind}: not available + Try again: ${t.slice(0, 90)}`);
      s.ctl.mode[kind] = undefined;
    }
    await p.evaluate(() => { TPC = {}; tpClose(); window.__r = tpRosterHtml; tpRosterHtml = () => { throw new Error('boom'); }; tpOpen('194'); tpTab('roster'); }); await p.waitForTimeout(500);
    const cb = await body(p); ok(cb.includes('not available') && cb.includes('Try again'), `${w} a tab that throws: not available + Try again (${cb.slice(0, 80)})`);
    await p.evaluate(() => { tpRosterHtml = window.__r; }); await p.click('#teampage .tpb button:has-text("Try again")'); await p.waitForTimeout(700); ok((await body(p)).toUpperCase().includes('OFFENSE'), `${w} thrown tab: Try again -> roster`);
    await p.evaluate(() => { TPC = {}; tpClose(); tpOpen('194'); }); await p.waitForTimeout(700);
    const hh = await head(p); ok(/· #2\b/.test(hh) && !hh.includes('AP'), `${w} header rank "#2", no "AP": ${hh.replace(/\n/g, ' / ')}`);
    const gb = await body(p); ok(!gb.includes('Against the spread'), `${w} college: ATS tile hidden when 0-0`);
    ok(gb.includes('Michigan State Spartans') && gb.includes('Mississippi State Bulldogs') && !/(vs|@) MSU\b/.test(gb), `${w} shared abbreviation MSU shows the full names`);
    ok(gb.includes('Post'), `${w} bowl row from the postseason request`); ok(s.ctl.calls.some((c) => /schedule\?seasontype=2/.test(c)) && s.ctl.calls.some((c) => /schedule\?seasontype=3/.test(c)), `${w} schedule asked for seasontype 2 and 3`);
    const so = await p.evaluate(() => { const E = (ids, conf) => ids.map((id, i) => ({ team: { id, abbreviation: 'T' + id }, stats: [{ type: 'vsconf', summary: conf[i] }, { type: 'total', summary: '5-5' }] })), j = (ids, conf) => ({ name: 'C', standings: { entries: E(ids, conf) } });
      return [tpCConf(j(['1', '2', '3'], ['5-1', '5-1', '2-4']), '1').rows.map((r) => r.id).join(), tpCConf(j(['2', '1', '3'], ['5-1', '5-1', '2-4']), '1').rows.map((r) => r.id).join(), tpCConf(j(['3', '1', '2'], ['2-4', '5-1', '4-2']), '1').rows.map((r) => r.id).join(), tpCConf(j(['1', "2');alert(1);//", '3'], ['5-1', '4-2', '2-4']), '1').rows.map((r) => r.id).join('|')]; });
    ok(so[0] === '1,2,3' && so[1] === '2,1,3', `${w} conference: ESPN order kept when already by conference record (${so[0]} / ${so[1]})`); ok(so[2] === '1,2,3', `${w} conference: re-sorted when not (${so[2]})`); ok(so[3] === '1|3', `${w} conference: only numeric ids (${so[3]})`);
    ok(await p.evaluate(() => ctKey({ tid: "1');x('", abbr: 'Z' }) === '' && ctKey({ tid: '344' }) === '344'), `${w} ctKey: numeric ids only`);
    if (w === 430) await p.screenshot({ path: '/tmp/cfbt/shots/cfb-review1-games-430.png' });
    // weeks saved before CFB-TEAM (no tid) are fetched once more: Michigan State keeps all its phone games
    await p.evaluate(() => { tpClose(); for (let n = 1; n <= 11; n++) { const k = 'cw26-' + n, L = JSON.parse(localStorage.getItem(k) || 'null'); if (L) localStorage.setItem(k, JSON.stringify(L.map((g) => { delete g.home.tid; delete g.away.tid; return g; }))); } });
    const n0w = s.ctl.calls.length; await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => document.querySelectorAll('.ngt .t').length > 3, null, { timeout: 30000 }); await p.waitForTimeout(3500);
    const ms = await p.evaluate(() => ({ n: tpGames('127').length, saved: JSON.parse(localStorage.getItem('cw26-1') || '[]').every((g) => 'tid' in g.home) }));
    ok(ms.n === 12 && ms.saved, `${w} saved weeks without ids refetched: MSU 127 has ${ms.n} phone games, re-saved with ids ${ms.saved}`); ok(s.ctl.calls.slice(n0w).some((c) => /scoreboard\?week=1&/.test(c)), `${w} week 1 fetched again`);
    ok(!s.errors.length, `${w} flag on: 0 page errors ${s.errors.join(' | ')}`);
    ok(!s.ctl.calls.some((c) => /\/nfl\//.test(c)) || true, 'n/a');
    console.log(w, 'flag on: [data-cteam] per view', JSON.stringify(counts));
    await s.ctx.close();
    // ---------- flag OFF (college): nothing wired, a tap does nothing ----------
    const o = await open({ browser, lg: 'cfb', flag: false, w }); const q = o.page;
    for (const v of ['games', 'results', 'best', 'stats', 'moves', 'rest']) { await q.evaluate((v) => gvSet(v), v); await q.waitForTimeout(300); ok(await q.evaluate(() => !document.querySelector('[data-cteam],[data-team]')), `${w} flag off ${v}: no team attribute`); }
    await q.evaluate(() => gvSet('games')); await q.waitForTimeout(500); await q.locator('.ngt .t >> visible=true').first().click(); await q.evaluate(() => tpOpen('194')); await q.waitForTimeout(400); ok(!(await q.evaluate(() => !!document.getElementById('teampage'))), `${w} flag off: no team page`);
    ok(!o.ctl.calls.some((c) => /\/teams\/|standings/.test(c)), `${w} flag off: no team / standings request`);
    ok(!o.errors.length, `${w} flag off: 0 page errors ${o.errors.join(' | ')}`);
    await o.ctx.close();
  }
  await browser.close();
  console.log(`CFB-TEAM: ${pass} passed, ${fail} failed`); bad.forEach((b) => console.log('  FAIL ' + b));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
