// Run: node odds-api/golf.main.test.js   (money golf on main, feature session Nov 17 2026: the switches end to end in MAIN's own modules: acct.js gFlag and
// /acct/status, server.js, golf-gate.js, the phone loader in pics/index.html / gate.js / sync.js, and the clash checks against golfday.js / Golf GPS / the rest
// of main. No network, no database: golf.js and signup-since.js share one in-memory store.)
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), { Readable } = require('stream');
['GOLF_MONEY_ENABLED', 'GOLF_MONEY_OWNER_ONLY', 'GOLF_MONEY_TESTERS', 'GROUPS_ENABLED', 'CALCUTTA_ENABLED'].forEach((k) => delete process.env[k]);
const ROOT = path.join(__dirname, '..'), rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let n = 0; const ok = (m) => { n++; console.log('  ok', m); };
const A = require('./acct'), ME = { role: 'member', email: 'x@phone.oddable' };
const status = (hd) => new Promise((done) => { const res = { h: {}, statusCode: 0, setHeader(k, v) { this.h[k] = v; }, end(b) { done(JSON.parse(b)); } }; A.handle({ method: 'GET', url: '/acct/status', headers: hd || {} }, res); });
(async () => {
  // 1. everything unset: main's answers, and nothing golf is even loaded
  const s0 = await status(); assert.strictEqual(A.gFlag(ME, 'x@phone.oddable'), ME, 'the same object'); assert.strictEqual(A.gFlag(null, 'x'), null); assert.ok(!('golfMoney' in s0), JSON.stringify(s0));
  assert.ok(!Object.keys(require.cache).some((k) => /[\\/](golf|golf-gate|signup-since)\.js$/.test(k)), 'acct.js never requires golf, golf-gate or signup-since while the switch is off');
  ok('GOLF_MONEY_ENABLED unset: gFlag returns the very same `me`; /acct/status has no golfMoney; golf.js / golf-gate.js / signup-since.js are not even loaded');
  // 2. server.js: both golf lines are behind the exact switch; the route is /golf/ with the slash (main's /golfday and /golfcourse never reach it)
  const srv = rd('odds-api/server.js'), gl = srv.split('\n').filter((l) => /golf-gate/.test(l) && !/^\s*\/\//.test(l));
  assert.strictEqual(gl.length, 2, gl.join('\n')); assert.ok(gl.every((l) => l.includes("process.env.GOLF_MONEY_ENABLED === '1'")), gl.join('\n')); assert.ok(gl.some((l) => l.includes("req.url.startsWith('/golf/')")));
  const GG = require('./golf-gate'), fakeRes = () => { const r = { statusCode: 0, h: {}, setHeader(k, v) { r.h[k] = v; }, end(b) { r.body = b; } }; return r; };
  for (const u of ['/golfday/list', '/golfcourse/search?q=x', '/golf', '/golfx/create']) assert.strictEqual(await GG.handle({ url: u, method: 'POST', headers: {}, resume() {} }, fakeRes()), false, u);
  ok('server.js: the boot line and the /golf/ route need GOLF_MONEY_ENABLED === "1"; golf-gate.handle() answers only /golf/<op> (never /golfday, /golfcourse, /golf, /golfx)');
  // 3. ENABLED=1 but the sign-up dates are not filled in (no backfill marker): the switch REFUSES at boot, says why in the log, and every caller is blocked
  const G = require('./golf'), SS = require('./signup-since'); let db = {}; const S = { dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null), dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); }, dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; } };
  G._deps.S = S; SS._deps.S = S; const who = { cur: null }; GG._deps.acct = () => ({ who: () => who.cur, isOwnerPhone: (e) => e === 'boss@phone.oddable', expired: async (e) => e === 'late@phone.oddable' });
  const call = async (u, e, b) => { who.cur = e || null; const req = Readable.from([Buffer.from(JSON.stringify(b || {}))]); req.url = u; req.method = 'POST'; req.headers = {}; req.socket = { remoteAddress: '10.0.0.1' }; const res = fakeRes(); await GG.handle(req, res); return { s: res.statusCode, j: JSON.parse(res.body) }; };
  process.env.GOLF_MONEY_ENABLED = '1'; const err = console.error, said = []; console.error = (m) => said.push(String(m)); let st; try { st = await GG.boot(); } finally { console.error = err; }
  assert.strictEqual(st.on, false); assert.ok(said.some((m) => /golf money stays OFF/.test(m) && /backfill-acctsince/.test(m)), said.join(' | ')); assert.strictEqual(GG.on(), false);
  assert.deepStrictEqual((await call('/golf/on', 'x@phone.oddable')).j, { on: false }); let r = await call('/golf/create', 'x@phone.oddable', { kind: 'day' }); assert.deepStrictEqual([r.s, r.j.off], [403, true]); r = await call('/golf/preview', null, { code: 'ABCDEFGHJK' }); assert.strictEqual(r.s, 404);
  assert.strictEqual(A.gFlag(ME, 'x@phone.oddable'), ME); assert.ok(!('golfMoney' in (await status()))); assert.deepStrictEqual(Object.keys(db), [], 'nothing written');
  ok('GOLF_MONEY_ENABLED=1 without the backfill: boot REFUSES with a log line naming the fix; /golf/on {on:false}, other ops 403 {off:true}, preview 404; no golfMoney on `me` or /acct/status; nothing written');
  // 4. with the backfill marker: on. `me` and /acct/status say golfMoney; the status field is ADDED to main's answer (Groups' flag kept)
  db[SS.BFROW] = { id: SS.BFROW, data: { at: Date.now() - 864e5, launch: Date.parse('2026-01-01T00:00:00Z') }, updated: 1 }; SS._reset(); GG._set({ on: false }); st = await GG.boot();
  assert.deepStrictEqual([st.on, st.minDays, G.SIGNER_MIN_DAYS], [true, 1, 1]); assert.deepStrictEqual(A.gFlag(ME, 'x@phone.oddable'), Object.assign({}, ME, { golfMoney: true })); assert.ok(!('golfMoney' in ME), 'a copy');
  process.env.GROUPS_ENABLED = '1'; const s1 = await status(); assert.deepStrictEqual([s1.golfMoney, s1.groups, s1.gate], [true, true, s0.gate]); delete process.env.GROUPS_ENABLED;
  assert.deepStrictEqual((await call('/golf/on', 'x@phone.oddable')).j, { on: true }); r = await call('/golf/mine', 'x@phone.oddable'); assert.strictEqual(r.s, 401, 'reaches golf.js (whose own sign-in check uses main\'s acct.who)');
  r = await call('/golf/mine', 'late@phone.oddable'); assert.deepStrictEqual([r.s, r.j.expired], [403, true], 'an account whose time has ended');
  ok('with the backfill marker: boot ON (signers need 1 day, owner GOLF-AGE); `me` gets golfMoney: true (a copy); /acct/status gets golfMoney ADDED to main\'s answer (groups kept); /golf/* reaches golf.js; an ended account gets 403 expired');
  // 5. owner only / testers; only exactly "1"
  process.env.GOLF_MONEY_OWNER_ONLY = '1'; assert.strictEqual(A.gFlag(ME, 'x@phone.oddable'), ME, 'not the owner'); assert.strictEqual(A.gFlag(ME, 'owner').golfMoney, true, 'owner PIN'); assert.strictEqual(A.gFlag(ME, 'boss@phone.oddable').golfMoney, true, 'owner phone');
  r = await call('/golf/create', 'x@phone.oddable', {}); assert.deepStrictEqual([r.s, r.j.off], [403, true]); r = await call('/golf/preview', null, { code: 'ABCDEFGHJK' }); assert.strictEqual(r.s, 404, 'signed-out preview in owner-only mode');
  process.env.GOLF_MONEY_TESTERS = require('./limits').keyOf('x@phone.oddable'); assert.strictEqual(A.gFlag(ME, 'x@phone.oddable').golfMoney, true, 'a tester'); assert.deepStrictEqual((await call('/golf/on', 'x@phone.oddable')).j, { on: true });
  // review fix 6: owner-only, /acct/status carries golfMoney ONLY for a request signed in as an allowed account (guests' phones never catch ?join=golf.)
  process.env.MYAPPS_URL = 'https://myapps.test'; process.env.MYAPPS_SECRET = 'test-secret'; const tk = (e) => ({ 'x-token': A.mint(e) });
  assert.ok(!('golfMoney' in (await status())), 'owner-only: no token, no flag'); assert.ok(!('golfMoney' in (await status(tk('y@phone.oddable')))), 'owner-only: an account not let in');
  assert.ok(!('golfMoney' in (await status({ 'x-token': 'junk.sig' }))), 'a bad token'); assert.strictEqual((await status(tk('x@phone.oddable'))).golfMoney, true, 'a tester'); assert.strictEqual((await status(tk('boss@phone.oddable'))).golfMoney, true, 'the owner\'s phone');
  delete process.env.GOLF_MONEY_OWNER_ONLY; assert.strictEqual((await status()).golfMoney, true, 'not owner-only: everyone (money golf exists)'); process.env.GOLF_MONEY_OWNER_ONLY = '1';
  delete process.env.MYAPPS_URL; delete process.env.MYAPPS_SECRET; assert.ok(/if \(golfOn\(\)\) golfCapture\(\)/.test(rd('pics/index.html').split('\n').find((l) => l.startsWith('window.oddGolfChanged'))), 'allowed accounts catch the link from me.golfMoney');
  ok('owner-only: /acct/status says golfMoney only to a signed-in account the switches let in (tester, owner phone), never to a guest or another account; the phone catches the link from `me` instead');
  delete process.env.GOLF_MONEY_TESTERS; delete process.env.GOLF_MONEY_OWNER_ONLY;
  for (const v of ['0', 'true', ' 1', '']) { process.env.GOLF_MONEY_ENABLED = v; assert.strictEqual(A.gFlag(ME, 'x'), ME, v); assert.strictEqual(GG.onFor('x'), false, v); assert.ok(!('golfMoney' in (await status())), v); }
  delete process.env.GOLF_MONEY_ENABLED; ok('GOLF_MONEY_OWNER_ONLY / GOLF_MONEY_TESTERS decide like Groups and Calcutta; only exactly "1" switches it on');
  // 6. the phone: pics/golf.js only through golfLoad(), only when the server said so for this account; gate.js keeps the flags; status before the Groups line
  const ix = rd('pics/index.html'), gt = rd('pics/gate.js'), sy = rd('pics/sync.js');
  assert.ok(!/<script[^>]+golf\.js/.test(ix), 'no script tag'); assert.strictEqual((ix.match(/golf\.js\?v=/g) || []).length, 1); assert.ok(/function golfOn\(\) \{[^\n]*localStorage\.getItem\('odd-golfm'\) === '1' && !!localStorage\.getItem\('odd-tok'\)/.test(ix)); assert.ok(/mirror=1/.test(ix.split('\n').find((l) => l.startsWith('function golfOn'))));
  assert.ok(/m\.golfMoney === true \? '1' : null/.test(gt) && /if \(j\.golfMoney === true\) \{ s\('odd-gmsw', '1'\)/.test(gt)); const gl2 = gt.split('\n'); assert.ok(gl2.findIndex((l) => l.includes('j.golfMoney === true')) < gl2.findIndex((l) => l.includes('j.groups === true')), 'golf link kept before main\'s grpCapture runs');
  ['checkUpdate', 'controllerchange', 'touchstart'].forEach((w) => assert.ok(ix.split('\n').some((l) => l.includes('ogolf') && l.includes(w === 'checkUpdate' ? "getElementById('ogolf')) return" : w)), w)); assert.ok(sy.includes("document.getElementById('ogolf') && sig(gatherFrom(local)) !== sig(gather())"));
  ok('phone: the overlay loads only through golfLoad() when gate.js kept `me.golfMoney`; no script tag; ?mirror=1 never; no reload / pull-to-refresh / sync reload under #ogolf');
  // 7. no clash with main: routes, element ids, document-level click attributes, storage keys, globals
  // MAIN's files at the merge base (git merge-base HEAD origin/main, or GOLF_BASE), not this branch's added lines; plus every pics file that is NOT at the
  // base (other dark features merged beside golf, e.g. calcutta.js / localevents.js), read from the tree, so their ids are checked too.
  const cp = require('child_process'), BASE = process.env.GOLF_BASE || cp.execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const atBase = new Set(cp.execFileSync('git', ['ls-tree', '--name-only', BASE, 'pics/'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).map((f) => f.slice(5)));
  const gj = rd('pics/golf.js'), mainPics = fs.readdirSync(path.join(ROOT, 'pics')).filter((f) => /\.(js|html)$/.test(f) && f !== 'golf.js').map((f) => atBase.has(f) ? cp.execFileSync('git', ['show', BASE + ':pics/' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 }) : rd('pics/' + f)).join('\n');
  ['data-team', 'data-gt', 'data-gp', 'data-lm', 'data-lmmode', 'data-ga'].forEach((a) => assert.ok(!new RegExp(a + '[=\\]"\']').test(gj), a));
  const ids = new Set(); (gj.match(/id="([A-Za-z][\w-]*)"/g) || []).concat(gj.match(/id = '([A-Za-z][\w-]*)'/g) || []).forEach((x) => ids.add(/['"]([A-Za-z][\w-]*)['"]/.exec(x)[1])); (gj.match(/getElementById\('([A-Za-z][\w-]*)'/g) || []).forEach((x) => ids.add(/'([A-Za-z][\w-]*)'/.exec(x)[1]));
  const clash = [...ids].filter((i) => new RegExp('id="' + i + '"|id=\'' + i + '\'|getElementById\\(\'' + i + '\'\\)|\\.id = \'' + i + '\'|#' + i + '[\\s,{.:\\[>)\'"]').test(mainPics)); assert.deepStrictEqual(clash, [], 'element ids also used by main: ' + clash);
  assert.ok(!/window\.(OddGolfDay|oddGroupsChanged|oddCalc)\s*=/.test(gj), 'golf.js defines none of main\'s globals'); assert.ok(!/\boddGolf\b|\bOddGolf\b/.test(mainPics.replace(/OddGolfDay/g, '')), 'main has no oddGolf / OddGolf of its own (only index.html\'s added loader)' );
  const gs = rd('odds-api/golf.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'), keys = (gs.match(/'lock:[a-z:]*/g) || []).map((x) => x.slice(1)); assert.ok(keys.length && keys.every((k) => k.startsWith('lock:golf:') && !k.startsWith('lock:golfmark')), keys.join());
  const mainKeys = fs.readdirSync(__dirname).filter((f) => /\.js$/.test(f) && !/^golf|^signup-since|^backfill|test/.test(f)).map((f) => rd('odds-api/' + f)).join('\n'); assert.ok(!/'lock:golf:/.test(mainKeys), 'no main file uses lock:golf:'); assert.ok(!/'lock:acctsince/.test(mainKeys.replace(rd('odds-api/signup-since.js'), '')), 'no main file uses lock:acctsince');
  ok('no clash: golf.js uses none of main\'s document-level click attributes; none of its ' + ids.size + ' element ids is used by main; rows lock:golf:* only (golf\'s own enterprise row renamed from main\'s lock:ent); lock:acctsince only in signup-since.js');
  // 8. main's code preserved; no code after a // comment; the rules sheet; golfday untouched
  require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'golf', 'main-preserved.js')], { cwd: ROOT, stdio: 'pipe' }); ok('main\'s code preserved in every touched file, and no code hides after a // comment (scripts/golf/main-preserved.js)');
  assert.ok(/never collects, holds or pays money/.test(gj.slice(gj.indexOf('rule: {'), gj.indexOf('heads:'))), 'the rules sheet says it'); ok('the rules sheet (ⓘ The rule) says Oddable never collects, holds or pays money');
  // relative to the base: unchanged, or changed only by another feature (no added line of the diff mentions money golf)
  const ch = cp.execFileSync('git', ['diff', '--no-color', '-U0', BASE, '--', 'odds-api/golfday.js', 'pics/golfday.js', 'odds-api/golfcourse.js', 'pics/golfgps.js', 'pics/golfgps.html', 'pics/groups.js', 'odds-api/groups.js', 'odds-api/limits.js', 'odds-api/pairing.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 }).split('\n').filter((l) => /^[+-][^+-]/.test(l) && /GOLF_MONEY|golf-gate|signup-since|oddGolf|OddGolf\b|ogolf|odd-golfm|lock:golf:/.test(l)); assert.deepStrictEqual(ch, [], ch.join('\n'));
  ok('golfday.js (both), golfcourse.js, Golf GPS, groups.js (both), limits.js and pairing.js: money golf changed no line of them (base ' + BASE.slice(0, 7) + ')');
  console.log('PASS ' + n + ' money-golf-on-main checks'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
