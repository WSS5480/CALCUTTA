// Playwright checks for pics/pga.html (v262): 390 / 430 / 1280, ESPN mocked with the hand-made fixtures, service workers blocked, the clock faked.
// Run: (cd pics && python3 -m http.server 8812) then  NODE_PATH=<where playwright lives> PGA_OUT=/some/dir node scripts/pga/shots.js   (screenshots go to PGA_OUT, default the OS temp dir)
const { chromium } = require('playwright');
const F = require('./fixtures.js');
const OUT = (process.env.PGA_OUT || require('os').tmpdir()).replace(/\/?$/, '/'), PORT = +process.env.PGA_PORT || 8812, URL0 = 'http://localhost:' + PORT + '/pga.html';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));

async function open(b, W, o = {}) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: W, height: W > 800 ? 900 : 844 }, hasTouch: W < 800, timezoneId: 'America/Chicago', locale: 'en-US', reducedMotion: o.reduce ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage(); const S = { feed: o.feed, last: o.last, hits: [], errs: [] };
  p.on('pageerror', (e) => { S.errs.push(e.message); console.log('PAGEERR', e.message); });
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) { S.errs.push(m.text()); console.log('CONSOLE', m.text().slice(0, 200)); } });
  await p.route('**/*', async (r) => {
    const u = r.request().url(); const J = (obj, code) => r.fulfill({ status: code || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
    if (u.startsWith('http://localhost:' + PORT)) return r.continue();
    if (u.includes('/sports/golf/pga/scoreboard')) { S.hits.push(u); const f = u.includes('dates=') ? S.last : S.feed; const j = typeof f === 'function' ? f() : f; if (j == null || j === 'fail') return J({}, 500); if (j === 'abort') return r.abort(); return J(j); }
    if (u.includes('calcutta-odds.onrender.com/acct/status')) return J({ gate: false });
    return r.abort();
  });
  await p.clock.install({ time: new Date(o.now || '2026-11-16T14:00:00-06:00') });
  if (o.ls) await p.addInitScript((ls) => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); Object.keys(ls).forEach((k) => localStorage.setItem(k, ls[k])); } } catch (e) {} }, o.ls);
  await p.goto(URL0, { waitUntil: 'load' }); await p.waitForTimeout(350);
  return { ctx, p, S };
}
const noSide = (p) => p.evaluate(() => { const de = document.documentElement; let worst = 0, who = ''; document.querySelectorAll('body *').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width && r.right > innerWidth + 0.5 && r.right - innerWidth > worst) { worst = r.right - innerWidth; who = el.tagName + '.' + el.className; } }); return { doc: de.scrollWidth - de.clientWidth, worst, who }; });
const rows = (p, sel) => p.evaluate((sel) => [...document.querySelectorAll((sel || '#lb') + ' .pr')].map((r) => r.querySelector('.ps').textContent + ' ' + r.querySelector('.pn').childNodes[0].textContent + ' ' + r.querySelector('.tp').textContent + ' ' + r.querySelector('.td').textContent + ' ' + r.querySelector('.th').textContent), sel);
const heads = (p) => p.evaluate(() => [...document.querySelectorAll('#lb .gh, #last .gh')].map((x) => x.childNodes[0].textContent.trim()));
const small = (p) => p.evaluate(() => { const bad = []; document.querySelectorAll('button, select, input, a.home, .pm').forEach((el) => { const r = el.getBoundingClientRect(); if (!r.width || el.closest('[hidden]')) return; if (r.height < 40 || r.width < 40) bad.push(el.tagName + '.' + el.className + '#' + el.id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }); return bad; });
// header cells sit over their columns: text columns share a left edge, number columns share a right edge
const align = (p) => p.evaluate(() => { const out = []; document.querySelectorAll('#lb .lh').forEach((lh) => { const row = lh.nextElementSibling; if (!row || !row.classList.contains('pr')) return; const h = [...lh.querySelectorAll(':scope > div > span')].map((x) => x.getBoundingClientRect()), c = ['.ps', '.pn', '.tp', '.td', '.th'].map((s) => row.querySelector(s).getBoundingClientRect()); out.push(Math.max(Math.abs(h[0].left - c[0].left), Math.abs(h[1].left - c[1].left), Math.abs(h[2].right - c[2].right), Math.abs(h[3].right - c[3].right), Math.abs(h[4].right - c[4].right))); }); return out; });

(async () => {
  const b = await chromium.launch();
  for (const W of [390, 430, 1280]) {
    console.log('== width ' + W);
    // ---- A. final event (between tournaments: last event final + next event) ----
    let x = await open(b, W, { feed: F.finalBig() }), p = x.p;
    ok(await p.locator('#evc .tag').textContent() === 'Last event', 'A tag Last event');
    ok((await p.locator('#evc').innerText()).includes('Final') && (await p.locator('#evc').innerText()).includes('Nov 12 – 15, 2026'), 'A header final + dates: ' + (await p.locator('#evc').innerText()).replace(/\n/g, ' | '));
    ok((await p.locator('#hd').innerText()).includes('NEXT EVENT') && (await p.locator('#hd').innerText()).includes('Sea Island Test Classic') && (await p.locator('#hd').innerText()).includes('Starts Thu, Nov 19'), 'A next event card');
    ok(!(await p.locator('#evc').innerText()).match(/course|undefined|null|NaN/i), 'A nothing invented in header');
    eq((await rows(p)).length, 120, 'A 120 rows'); eq(await heads(p), ['Final leaderboard', 'Did not play the weekend'], 'A section heads');
    eq((await rows(p)).slice(0, 3), ['1 Wade Winner -20 -7 F', '2 Rory Runner -17 -5 F', 'T3 Tom Tied -15 -4 F'], 'A top rows');
    eq((await rows(p)).pop(), '– Nat Nocard – – –', 'A no-card row');
    ok((await p.locator('#updt').textContent()).startsWith('Updated 2:00 PM · Scores from ESPN · checks every 10 minutes'), 'A updated line: ' + await p.locator('#updt').textContent());
    let s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'A no sideways scroll ' + JSON.stringify(s));
    eq(await small(p), [], 'A tap targets 40+'); const al = await align(p); ok(al.length === 2 && al.every((d) => d < 1), 'A headers aligned ' + al);
    ok(await p.locator('#plb').count() === 0 && await p.locator('#oddwarn').count() === 0, 'A no banner, no warning modal on this page');
    await p.screenshot({ path: OUT + 'final-' + W + '.png' });
    // expand / close
    await p.locator('#lb .pm').nth(2).click(); ok(await p.locator('.pd').count() === 1, 'A expand');
    eq(await p.evaluate(() => [...document.querySelectorAll('.pd .rds > div')].map((d) => d.innerText.replace(/\n/g, ' '))), ['R1 69 -3', 'R2 68 -4', 'R3 68 -4', 'R4 68 -4'], 'A rounds');
    ok((await p.locator('.pd .sub2').innerText()).includes('Finished T3. Total strokes: 273.'), 'A detail text: ' + await p.locator('.pd .sub2').innerText());
    s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'A no sideways scroll expanded'); eq(await small(p), [], 'A tap targets expanded');
    await p.screenshot({ path: OUT + 'final-open-' + W + '.png' });
    await p.locator('.pd [data-close]').click(); ok(await p.locator('.pd').count() === 0, 'A close');
    await p.locator('#lb .pr').last().locator('.pm').scrollIntoViewIfNeeded(); await p.locator('#lb .pr').nth(118).locator('.pm').click(); ok((await p.locator('.pd .sub2').innerText()).includes('Did not play the weekend. ESPN'), 'A cut detail honest'); await p.locator('.pd [data-close]').click();
    // stars
    await p.locator('#lb [data-star="5"]').click(); await p.locator('#lb [data-star="8"]').first().click();
    eq((await heads(p)).slice(0, 2), ['⭐ My players', 'Final leaderboard'], 'A my players pinned'); eq((await rows(p)).slice(0, 2).map((r) => r.split(' ').slice(1, 3).join(' ')), ['Ted Tied', 'Otto Over'], 'A pinned rows');
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('pga-stars')).sort()), ['5', '8'], 'A stars saved');
    await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: OUT + 'stars-' + W + '.png' });
    // filters + search
    await p.selectOption('#flt', 'top'); let r = await rows(p); ok(r.length === 10 || r.length === 11 || r.length === 12, 'A top 10 count ' + r.length); ok(r.every((t) => parseInt(t.replace(/^T/, ''), 10) <= 10), 'A top 10 positions'); ok(await p.locator('#bk').isVisible(), 'A back button shows');
    await p.selectOption('#flt', 'cut'); eq((await rows(p)).length, 70, 'A made cut 70'); eq(await heads(p), ['Final leaderboard'], 'A made cut heads');
    await p.selectOption('#flt', 'my'); eq((await rows(p)).length, 2, 'A my players filter');
    await p.locator('#bk').click(); eq((await rows(p)).length, 122, 'A back to all (120 + 2 pinned)'); ok(!(await p.locator('#bk').isVisible()), 'A back hidden');
    await p.fill('#q', 'tied'); eq((await rows(p)).map((t) => t.split(' ')[1]), ['Tom', 'Tim', 'Ted'], 'A search'); ok(await p.evaluate(() => document.activeElement.id === 'q'), 'A search keeps focus');
    await p.fill('#q', 'zzz'); ok((await p.locator('#lb').innerText()).includes('No players match'), 'A empty search'); await p.screenshot({ path: OUT + 'search-empty-' + W + '.png' });
    await p.locator('#bk').click(); eq(await p.inputValue('#q'), '', 'A back clears search');
    // tiles drill down + back
    await p.locator('.sum[data-dr="cut"]').click(); eq((await rows(p)).length, 70, 'A tile: played the weekend'); eq(await p.inputValue('#flt'), 'cut', 'A tile sets menu'); await p.locator('#bk').click();
    await p.locator('.sum[data-dr="lead"]').click(); ok((await p.locator('.pd .sub2').innerText()).includes('Finished 1.'), 'A leader tile opens the winner'); await p.locator('.pd [data-close]').click();
    // persisted stars after reload
    await p.reload(); await p.waitForTimeout(300); eq((await heads(p))[0], '⭐ My players', 'A stars survive reload');
    // schedule
    await p.selectOption('#vwsel', 'sched'); await p.waitForTimeout(100);
    eq(await p.evaluate(() => [...document.querySelectorAll('#sch .card')].map((c) => c.querySelector('b').textContent.slice(0, 10) + '|' + c.querySelector('.b').textContent + '|' + c.querySelector('small').textContent)), ['The Sentry|Finished|Jan 8 – 11, 2026', 'Fall Test |Finished|Nov 5 – 8, 2026', 'Austin Cha|Finished|Nov 12 – 15, 2026 · tap for the leaderboard', 'Sea Island|Upcoming|Nov 19 – 22, 2026', 'Desert Tes|Upcoming|Dec 3 – 6, 2026'], 'A schedule');
    ok(!(await p.locator('#week').isVisible()), 'A week hidden in schedule'); s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'A schedule no sideways scroll'); eq(await small(p), [], 'A schedule tap targets');
    await p.screenshot({ path: OUT + 'schedule-' + W + '.png' });
    await p.locator('#schcur').click(); ok(await p.locator('#week').isVisible() && await p.inputValue('#vwsel') === 'week', 'A schedule -> this week');
    // idle polling: nothing for 9 minutes, one read at 10
    let n0 = x.S.hits.length; await p.clock.runFor(9 * 60000); eq(x.S.hits.length, n0, 'A idle: no read in 9 min'); await p.clock.runFor(61000); await p.waitForTimeout(100); eq(x.S.hits.length, n0 + 1, 'A idle: one read at 10 min');
    eq(x.S.errs, [], 'A page errors'); await x.ctx.close();

    // ---- B. live round ----
    let bump = false; x = await open(b, W, { feed: () => F.live(bump), now: '2026-11-20T13:00:00-06:00' }); p = x.p;
    ok((await p.locator('#evc').innerText()).includes('Round 2 in progress') && await p.locator('#evc .tag').textContent() === 'This week', 'B header live: ' + (await p.locator('#evc').innerText()).replace(/\n/g, ' | '));
    eq(await rows(p), ['T1 Ann Alpha -8 -2 11', 'T1 Bea Bravo -8 -4 F', '3 Cal Charlie -5 – 12:10 PM', '4 Dee Delta -3 -1 6', '5 Eve Echo E – –', '6 Flo Foxtrot +4 +2 9'], 'B rows');
    ok((await p.locator('#updt').textContent()).includes('checks every minute'), 'B checks every minute'); ok((await p.locator('#evc').innerText()).includes('Co-leader'), 'B co-leader tile');
    await p.locator('#lb .pm').nth(2).click(); ok((await p.locator('.pd .sub2').innerText()).includes('Tees off Fri 12:10 PM (your time).'), 'B tee detail: ' + await p.locator('.pd .sub2').innerText());
    eq(x.S.hits.length, 1, 'B one read on load'); await p.clock.runFor(59000); eq(x.S.hits.length, 1, 'B no read before 60 s');
    bump = true; await p.clock.runFor(1500); await p.waitForTimeout(150); eq(x.S.hits.length, 2, 'B read at 60 s');
    eq((await rows(p)).slice(0, 4), ['1 Ann Alpha -9 -3 12', '2 Bea Bravo -8 -4 F', '3 Dee Delta -6 -4 6', '4 Cal Charlie -5 – 12:10 PM'], 'B live change');
    eq(await p.evaluate(() => [...document.querySelectorAll('.pr.chg')].map((r) => r.dataset.pid).sort()), ['21', '22', '23', '24'], 'B changed rows highlighted (position or score moved)');
    ok(await p.locator('.pd').count() === 1 && (await p.locator('.pd').getAttribute('data-pd')) === 'a:23', 'B open player stays open through an update');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('.pr.chg')).animationName) === 'pgaflash', 'B flash animation'); await p.screenshot({ path: OUT + 'live-change-' + W + '.png' });
    await p.clock.runFor(3100); await p.waitForTimeout(50); eq(await p.locator('.pr.chg').count(), 0, 'B highlight clears');
    ok((await p.locator('#updt').textContent()).startsWith('Updated 1:01 PM'), 'B updated time moved: ' + await p.locator('#updt').textContent());
    // hidden: no reads; visible again: read at once
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    let n1 = x.S.hits.length; await p.clock.runFor(5 * 60000); eq(x.S.hits.length, n1, 'B hidden: no reads in 5 min');
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(150); eq(x.S.hits.length, n1 + 1, 'B visible again: one read');
    // manual refresh
    await p.locator('#rf').click(); await p.waitForTimeout(150); eq(x.S.hits.length, n1 + 2, 'B manual refresh = one read');
    // feed fails after good data: last good scores stay, labelled
    x.S.feed = 'fail'; await p.clock.runFor(61000); await p.waitForTimeout(150);
    ok((await p.locator('#warn').innerText()).includes('ESPN did not answer at') && (await p.locator('#warn').innerText()).includes('Showing the last scores read, from'), 'B stale warning: ' + (await p.locator('#warn').innerText()).replace(/\n/g, ' | ')); eq((await rows(p)).length, 6, 'B last good rows stay');
    s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'B no sideways scroll'); eq(await small(p), [], 'B tap targets'); await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: OUT + 'live-stale-' + W + '.png' });
    let n2 = x.S.hits.length; await p.locator('[data-retry]').click(); await p.waitForTimeout(150); eq(x.S.hits.length, n2 + 1, 'B Try again = exactly one read');
    x.S.feed = () => F.live(true); await p.locator('[data-retry]').click(); await p.waitForTimeout(150); eq(await p.locator('#warn .card').count(), 0, 'B recovers');
    // reload while the feed is down: the copy kept on the phone, labelled with its time
    x.S.feed = 'abort'; await p.clock.runFor(30 * 60000); await p.reload(); await p.waitForTimeout(300);
    ok((await p.locator('#warn').innerText()).includes('Showing the last scores read, from') && (await rows(p)).length === 6, 'B reload offline shows kept copy with its time: ' + (await p.locator('#warn').innerText()).replace(/\n/g, ' | '));
    eq(x.S.errs, [], 'B page errors'); await x.ctx.close();

    // ---- C. failed from the start, then empty feed ----
    x = await open(b, W, { feed: 'fail' }); p = x.p;
    ok((await p.locator('#warn').innerText()).includes('Could not load PGA Tour scores') && (await rows(p)).length === 0 && !(await p.locator('#ctl').isVisible()), 'C failed state, no scores'); eq(x.S.hits.length, 1, 'C one read');
    await p.screenshot({ path: OUT + 'failed-' + W + '.png' }); eq(await small(p), [], 'C tap targets');
    await p.locator('[data-retry]').click(); await p.waitForTimeout(150); eq(x.S.hits.length, 2, 'C Try again single shot');
    x.S.feed = F.empty(); await p.locator('[data-retry]').click(); await p.waitForTimeout(150); ok((await p.locator('#hd').innerText()).includes('No PGA Tour event on ESPN'), 'C empty feed state'); await p.screenshot({ path: OUT + 'empty-' + W + '.png' });
    eq(x.S.errs, [], 'C page errors'); await x.ctx.close();

    // ---- D. between tournaments, next event not started: field + last event's final leaderboard ----
    x = await open(b, W, { feed: F.pre(), last: F.finalBig(), now: '2026-11-17T09:00:00-06:00' }); p = x.p; await p.waitForTimeout(200);
    ok(await p.locator('#evc .tag').textContent() === 'Next event' && (await p.locator('#evc').innerText()).includes('Starts Thu 6:00 AM'), 'D header: ' + (await p.locator('#evc').innerText()).replace(/\n/g, ' | '));
    eq(await rows(p), ['– Ann Alpha – – Thu 6:00 AM', '– Bea Bravo – – Thu 6:11 AM', '– Cal Charlie – – –'], 'D field rows'); eq(await heads(p), ['Field', 'Last event · final leaderboard'], 'D heads');
    ok(x.S.hits.some((u) => u.endsWith('?dates=20261112')), 'D last event asked by start day'); eq((await rows(p, '#last')).length, 10, 'D last event top 10'); eq((await rows(p, '#last'))[0], '1 Wade Winner -20 -7 F', 'D last winner');
    s = await noSide(p); ok(s.doc <= 0 && s.worst === 0, 'D no sideways scroll ' + JSON.stringify(s)); eq(await small(p), [], 'D tap targets'); await p.screenshot({ path: OUT + 'between-' + W + '.png', fullPage: true });
    await p.locator('#lastall').click(); eq((await rows(p, '#last')).length, 120, 'D show all'); await p.locator('#last .pm').first().click(); ok(await p.locator('#last + * .pd, #last .pd').count() === 1, 'D expand in last event');
    eq(x.S.errs, [], 'D page errors'); await x.ctx.close();
    x = await open(b, W, { feed: F.pre(), last: 'fail', now: '2026-11-17T09:00:00-06:00' }); p = x.p; await p.waitForTimeout(200);
    ok((await p.locator('#last').innerText()).includes('did not load'), 'D last event failed note'); let n3 = x.S.hits.length; x.S.last = F.final(); await p.locator('#lastgo').click(); await p.waitForTimeout(200); eq(x.S.hits.length, n3 + 1, 'D last Try again one read'); eq((await rows(p, '#last')).length, 9, 'D last loads after retry');
    eq(x.S.errs, [], 'D2 page errors'); await x.ctx.close();

    // ---- E. round 3 (cut made), suspended, playoff, flagged ----
    x = await open(b, W, { feed: F.round3(), now: '2026-11-21T10:00:00-06:00' }); p = x.p;
    eq(await heads(p), ['Leaderboard', 'Did not play the weekend'], 'E heads'); ok((await p.locator('#evc').innerText()).includes('Cut line E') && (await p.locator('#evc').innerText()).includes('worked out'), 'E cut line labelled'); eq((await rows(p))[0], '1 Lee Leader -10 – –', 'E leader waiting');
    await p.screenshot({ path: OUT + 'round3-' + W + '.png' }); x.S.feed = F.suspended(); await p.locator('#rf').click(); await p.waitForTimeout(150); ok((await p.locator('#evc').innerText()).includes('Round 2 suspended') && (await p.locator('#updt').textContent()).includes('every 10 minutes'), 'E suspended');
    x.S.feed = F.playoff(); await p.locator('#rf').click(); await p.waitForTimeout(150); ok((await p.locator('#evc').innerText()).includes('Final · decided in a playoff'), 'E playoff'); eq((await rows(p)).slice(0, 2), ['1 Wade Winner -20 -7 F', '2 Rory Runner -20 -8 F'], 'E playoff rows');
    x.S.feed = F.flagged(); await p.locator('#rf').click(); await p.waitForTimeout(150); eq((await heads(p)).pop(), 'Missed the cut / withdrew', 'E flagged heads'); eq(await p.evaluate(() => [...document.querySelectorAll('#lb .pr')].slice(-3).map((r) => r.querySelector('.pn small').textContent)), ['Missed the cut', 'Withdrew', 'Disqualified'], 'E flagged tags');
    eq(x.S.errs, [], 'E page errors'); await x.ctx.close();

    // ---- F. reduced motion ----
    bump = false; x = await open(b, W, { feed: () => F.live(bump), now: '2026-11-20T13:00:00-06:00', reduce: true }); p = x.p; bump = true; await p.clock.runFor(61000); await p.waitForTimeout(150);
    ok(await p.locator('.pr.chg').count() === 4 && await p.evaluate(() => getComputedStyle(document.querySelector('.pr.chg')).animationName) === 'none', 'F reduced motion: marked, not animated'); await x.ctx.close();
  }
  await b.close(); console.log(`\npga page: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
