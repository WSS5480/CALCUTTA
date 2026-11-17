// Run: node odds-api/localevents.links.test.js   (review D1: the invite-link captures in pics/index.html, run in a sandbox with a fake address bar.)
// grpCapture takes ONLY g. links (Calcutta's line, byte for byte); levCapture takes ONLY e. links and ONLY while the server said the game exists ('odd-lsw' = '1');
// calcCapture (when the Calcutta branch is in the build) takes ONLY c. links. Every other link is left in the address bar for whoever owns it.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const ix = fs.readFileSync(path.join(__dirname, '..', 'pics', 'index.html'), 'utf8').split('\n');
const pick = (start) => { const L = ix.filter((l) => l.startsWith(start)); assert.strictEqual(L.length, 1, start); return L[0]; };
const has = (start) => ix.some((l) => l.startsWith(start));
const CALC = has('function calcCapture()');
const src = [pick('const grpPend = '), pick('function grpCapture()'), pick('const levPend = '), pick('function levCapture()')].concat(CALC ? [pick('const calcPend = '), pick('function calcCapture()')] : []).join('\n');
let n = 0; const ok = (m) => { n++; console.log('  ok', m); };
function run(href, lsw, order) {
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
  const ss = store(), ls = store(); if (lsw) ls.setItem('odd-lsw', lsw);
  const loc = { href }, ctx = { URL, location: loc, sessionStorage: ss, localStorage: ls, lsg: (k) => ls.getItem(k), history: { state: null, replaceState: (s, t, u) => { loc.href = new URL(u, loc.href).href; } } };
  vm.createContext(ctx); vm.runInContext(src + '\n' + order.map((f) => f + '();').join(' '), ctx);
  return { href: loc.href.replace('https://steves-pics.onrender.com', ''), g: ss.getItem('odd-join'), e: ss.getItem('odd-join-e'), c: ss.getItem('odd-cjoin') };
}
const B = 'https://steves-pics.onrender.com/', ALL = ['grpCapture', 'levCapture'].concat(CALC ? ['calcCapture'] : []); // gate.js order: oddGroupsSw (grpCapture, levCapture), then oddCalcSw
// g. links
let r = run(B + '?join=g.ABCD-1234&ref=x#top', '1', ALL); assert.deepStrictEqual(r, { href: '/?ref=x#top', g: 'ABCD-1234', e: null, c: null }); ok('g. link: Groups keeps the code, the link leaves the address bar, ?ref and #hash stay');
// e. links
r = run(B + '?join=e.ABCD-1234&ref=x', '1', ALL); assert.deepStrictEqual(r, { href: '/?ref=x', g: null, e: 'ABCD-1234', c: null }); ok('e. link with the game on (odd-lsw=1): levCapture keeps it, grpCapture leaves it');
for (const lsw of [null, '0', 'true']) { r = run(B + '?join=e.ABCD-1234', lsw, ALL); assert.deepStrictEqual(r, { href: '/?join=e.ABCD-1234', g: null, e: null, c: null }, String(lsw)); } ok('e. link with the game off: nothing kept, the link stays in the address bar (as Calcutta does for its own links while off)');
// c. links
r = run(B + '?join=c.ABCD-1234', '1', ALL); assert.deepStrictEqual(r, CALC ? { href: '/', g: null, e: null, c: 'ABCD-1234' } : { href: '/?join=c.ABCD-1234', g: null, e: null, c: null }); ok('c. link: grpCapture and levCapture leave it' + (CALC ? '; calcCapture takes it' : ' (no Calcutta in this build)'));
// junk and none
for (const j of ['x.ABCD-1234', 'g.', 'e.ab', 'e.ABCD 1234', 'golf.ABCD-1234']) { r = run(B + '?join=' + encodeURIComponent(j), '1', ALL); assert.strictEqual(r.g || r.e || r.c, null, j); assert.ok(r.href.startsWith('/?join='), j); } ok('anything else (unknown kinds, bad codes) is left alone by every capture');
r = run(B + '?ref=y', '1', ALL); assert.deepStrictEqual(r, { href: '/?ref=y', g: null, e: null, c: null }); ok('no join= at all: nothing happens');
// either order gives the same result (no capture eats another's link)
for (const u of ['?join=g.ABCD-1234', '?join=e.ABCD-1234', '?join=c.ABCD-1234']) assert.deepStrictEqual(run(B + u, '1', ALL.slice().reverse()), run(B + u, '1', ALL), u); ok('the captures do not depend on their order');
// grpCapture is exactly the Calcutta branch's line; the wrapper calls levCapture right after main's oddGroupsSw (grpCapture first)
assert.ok(pick('function grpCapture()').includes("if (!m) return; grpPend(m[1]);"), 'grpCapture = the g.-only line');
assert.ok(ix.some((l) => l.startsWith('{ const os = window.oddGroupsSw; window.oddGroupsSw = function () { const r = os.apply(this, arguments); levCapture();')), 'levCapture runs inside oddGroupsSw, right after main\'s (grpCapture) part'); ok('grpCapture is the g.-only line; levCapture is called from oddGroupsSw right after it');
console.log('\nPASS ' + n + ' link checks' + (CALC ? ' (with Calcutta)' : ''));
