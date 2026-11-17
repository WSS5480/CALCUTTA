// Run: node odds-api/calcutta.main.test.js   (Calcutta on main, feature session Nov 17 2026: the switches end to end in MAIN's own modules: acct.js gFlag,
// groups.js wire(), server.js, the phone loader in pics/index.html / gate.js. No network, no database.)
const assert = require('assert'), fs = require('fs'), path = require('path');
delete process.env.CALCUTTA_ENABLED; delete process.env.CALCUTTA_OWNER_ONLY; delete process.env.CALCUTTA_TESTERS; delete process.env.GROUPS_ENABLED;
const A = require('./acct'), G = require('./groups'), C = require('./calcutta'), ROOT = path.join(__dirname, '..'), rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let n = 0; const ok = (m) => { n++; console.log('  ok', m); };
const ME = { role: 'member', email: 'x@phone.oddable' };
// 1. everything unset: main's answers are untouched
assert.strictEqual(A.gFlag(ME, 'x@phone.oddable'), ME, 'the same object'); assert.strictEqual(A.gFlag(null, 'x'), null); ok('switches unset: gFlag returns the very same `me` (no calcutta, no groups field)');
assert.deepStrictEqual(G.wire({ calcutta: C, golf: null, events: null, stats: null }), [], 'nothing wired'); ok('switches unset: groups.wire() wires no Calcutta');
for (const v of ['0', 'true', ' 1', '']) { process.env.CALCUTTA_ENABLED = v; assert.strictEqual(A.gFlag(ME, 'x'), ME, v); assert.strictEqual(C.onFor('x'), false); } delete process.env.CALCUTTA_ENABLED; ok('only exactly "1" switches it on');
// 2. on
process.env.CALCUTTA_ENABLED = '1'; assert.deepStrictEqual(A.gFlag(ME, 'x@phone.oddable'), Object.assign({}, ME, { calcutta: true })); assert.ok(!('calcutta' in ME), 'a copy'); ok('CALCUTTA_ENABLED=1: `me` says calcutta: true (Groups still off: no groups field)');
process.env.CALCUTTA_OWNER_ONLY = '1'; assert.strictEqual(A.gFlag(ME, 'x@phone.oddable'), ME, 'not the owner'); assert.deepStrictEqual(A.gFlag(ME, 'owner').calcutta, true, 'the owner PIN sign-in');
process.env.CALCUTTA_TESTERS = require('./limits').keyOf('x@phone.oddable'); assert.strictEqual(A.gFlag(ME, 'x@phone.oddable').calcutta, true, 'a tester'); delete process.env.CALCUTTA_TESTERS; delete process.env.CALCUTTA_OWNER_ONLY; ok('CALCUTTA_OWNER_ONLY / CALCUTTA_TESTERS decide the flag like Groups');
process.env.GROUPS_ENABLED = '1'; { const m = A.gFlag(ME, 'x@phone.oddable'); assert.deepStrictEqual([m.groups, m.calcutta], [true, true]); } assert.deepStrictEqual(G.wire({ calcutta: C, golf: null, events: null, stats: null }), ['pot:calc']); ok('with Groups on too: both flags; groups.wire() registers the Calcutta pot (and nothing else)');
delete process.env.GROUPS_ENABLED; delete process.env.CALCUTTA_ENABLED;
// 3. server.js: both Calcutta lines are behind the exact switch
const srv = rd('odds-api/server.js'), lines = srv.split('\n').filter((l) => /calcutta'\)|\/calcutta/.test(l) && !/^\s*\/\//.test(l));
assert.ok(lines.length >= 2 && lines.every((l) => l.includes("process.env.CALCUTTA_ENABLED === '1'")), lines.join('\n')); ok('server.js: the route and the wiring / watcher lines need CALCUTTA_ENABLED === "1"');
// 4. the phone: pics/calcutta.js only through calcLoad(), only when the server said so for this account
const ix = rd('pics/index.html'), gt = rd('pics/gate.js');
assert.ok(!/<script[^>]+calcutta\.js/.test(ix), 'no script tag'); assert.ok(/function calcOn\(\) \{[^\n]*localStorage\.getItem\('odd-calc'\) === '1' && !!localStorage\.getItem\('odd-tok'\)/.test(ix)); assert.strictEqual((ix.match(/calcutta\.js\?v=/g) || []).length, 1);
assert.ok(/m\.calcutta === true \? '1' : null/.test(gt) && /if \(j\.calcutta === true\) \{ s\('odd-csw', '1'\)/.test(gt), 'gate.js keeps the flag from `me` and the server switch from /acct/status'); ok('phone: the overlay loads only through calcLoad() when gate.js kept `me.calcutta`; no script tag');
// review D1: main's setMe line (the days-left card: window.oddDays) is untouched and every phone / server file is main's plus added lines (and the listed replacements)
assert.ok(gt.split('\n').some((l) => l.startsWith("    try { const gv = m.groups === true ? '1' : null;") && l.includes('window.oddDays()')), 'main\'s oddDays call is still on its line');
require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'calcutta', 'main-preserved.js')], { cwd: ROOT, stdio: 'pipe' }); ok('review D1: main\'s code preserved in every touched file (scripts/calcutta/main-preserved.js)');
// review D2: the overlay carries no attribute that main's document-level click handlers catch ([data-team] team page, [data-gt] / [data-gp] sign-up, [data-lm] / [data-lmmode], [data-ga])
const cj = rd('pics/calcutta.js'); ['data-team', 'data-gt', 'data-gp', 'data-lm', 'data-lmmode', 'data-ga'].forEach((a) => assert.ok(!new RegExp(a + '[=\\]"\']').test(cj), a)); ok('review D2: pics/calcutta.js uses none of the attributes main catches at document level');
// review D3: /acct/status says `calcutta` only while CALCUTTA_ENABLED=1
{ const http = require('http'), call = (env) => new Promise((done) => { const s0 = process.env.CALCUTTA_ENABLED; if (env) process.env.CALCUTTA_ENABLED = env; else delete process.env.CALCUTTA_ENABLED; const res = { h: {}, statusCode: 0, setHeader(k, v) { this.h[k] = v; }, end(b) { if (s0 === undefined) delete process.env.CALCUTTA_ENABLED; else process.env.CALCUTTA_ENABLED = s0; done(JSON.parse(b)); } }; A.handle({ method: 'GET', url: '/acct/status', headers: {} }, res); });
  (async () => { const off = await call(null), on = await call('1'); assert.ok(!('calcutta' in off), JSON.stringify(off)); assert.strictEqual(on.calcutta, true); ok('review D3: /acct/status says calcutta only while CALCUTTA_ENABLED=1'); console.log('PASS ' + n + ' Calcutta-on-main checks'); })().catch((e) => { console.error('FAIL', e); process.exit(1); }); }
