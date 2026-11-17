// Run: node scripts/golf/main-preserved.js [base]   (default base 8af1f79 = main v274, the commit the golf-money-on-main branch is built on)
// Proves that money golf changed NOTHING of main's code in main's files it touched: for each file, the lines the branch ADDED are removed and the result must
// equal main's file byte for byte (no line of main's is removed or changed; there are NO sanctioned replacements on this branch). Any other change = FAIL.
// Also (the mistake found twice in this project): every ADDED line is scanned for a `//` comment followed by more code on the same line (code after a
// line comment never runs). The scan strips strings, template text and regex literals first; a hit = FAIL with the line.
// The new golf files (golf.js, golf-gate.js, signup-since.js, ...) are not main's, so they are not listed here; the same `//` scan runs over every line of them.
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), BASE = process.argv[2] || '8af1f79';
const FILES = ['pics/gate.js', 'pics/index.html', 'pics/sync.js', 'odds-api/acct.js', 'odds-api/server.js'];
const NEW = ['odds-api/golf.js', 'odds-api/golf-gate.js', 'odds-api/signup-since.js', 'odds-api/backfill-acctsince.js', 'odds-api/golf-score.js', 'odds-api/golf-feed.js', 'odds-api/golf-courses.js', 'odds-api/ratings.js', 'pics/golf.js'];
// Code after a line comment: strip quoted text and regex literals, find `//`, and look for statement code in what follows (a `;` or `}` followed by code,
// or a keyword that starts a statement right after a `;`). Prose in comments rarely has `; if (` or `} else` or `) {`.
function strip(l) { let o = '', q = null, re = false, prev = '';
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; o += ' '; continue; }
    if (re) { if (c === '\\') { i++; continue; } if (c === '/') re = false; o += ' '; continue; }
    if (c === '/' && l[i + 1] === '/') return { code: o, comment: l.slice(i + 2) };
    if (c === '/' && l[i + 1] === '*') { const e = l.indexOf('*/', i + 2); if (e < 0) return { code: o, comment: '' }; i = e + 1; o += ' '; continue; }
    if (c === '/' && /[(,=:[!&|?{};]\s*$|^\s*$|\breturn\s*$/.test(o)) { re = true; o += ' '; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; o += ' '; continue; }
    o += c; prev = c; }
  return { code: o, comment: null }; }
const CODEY = /\b(?:if|for|while|switch)\s*\(.*\)\s*\{|=>\s*[{(]|\{\s*[^{}]*;\s*\}|;\s*(?:const|let|var)\s+[\w$[{]+\s*=|\b(?:catch|finally)\s*(?:\([^)]*\)\s*)?\{|;\s*[\w$.]+\s*\([^)]*\)\s*;/;
// Self-test on the two real cases found in this project: review D1 (gate.js setMe swallowed main's oddDays call) and review round 8 (golf.js N5 guard).
['    try { const cv = 1; } catch (e) {} // Calcutta: the flag setTimeout(() => { try { if (window.oddDays) window.oddDays(); } catch (e) {} }, 0);',
 "      if (x) { no.push(h); continue; } // fix 5: after Final, never a hole your own team confirmed if ((!isBoss(d, me) && !sidesOf(d, me.pid).length) || (stakes(d) && !teamsOfP(d, me.pid).length)) { no.push(h); continue; }"]
  .forEach((l) => { if (!swallow(l)) { console.log('SELF-TEST FAILED: the scan misses a known case'); process.exit(2); } });
function swallow(line) { const { comment } = strip(line); return comment != null && CODEY.test(comment) ? comment.trim().slice(0, 120) : null; }
let bad = 0;
for (const f of FILES) {
  const main = execFileSync('git', ['show', BASE + ':' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 }), cur = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const diff = execFileSync('git', ['diff', '--no-color', '-U0', BASE, '--', f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 });
  const added = new Set(), minus = [], plus = []; let nl = 0;
  diff.split('\n').forEach((l) => { const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l); if (h) { nl = Number(h[1]); return; } if (l.startsWith('+++') || l.startsWith('---')) return; if (l.startsWith('+')) { added.add(nl); plus.push([nl, l.slice(1)]); nl++; } else if (l.startsWith('-')) minus.push(l.slice(1)); });
  let ok = true; minus.forEach((m) => { ok = false; console.log('  FAIL ' + f + ': a line of main\'s was removed or changed: ' + m.slice(0, 140)); });
  const back = cur.split('\n').filter((l, i) => !added.has(i + 1)).join('\n'), same = back === main; if (!same) ok = false;
  const sw = plus.map(([n, l]) => [n, swallow(l)]).filter((x) => x[1]); sw.forEach(([n, c]) => { ok = false; console.log('  FAIL ' + f + ':' + n + ': code after a // comment: ' + c); });
  console.log((ok ? '  ok   ' : '  FAIL ') + f + ': ' + plus.length + ' added line(s), 0 replaced; without them the file is ' + (same ? 'main\'s, byte for byte' : 'NOT main\'s') + '; // scan of the added lines: ' + (sw.length ? sw.length + ' HIT(S)' : 'clean'));
  if (!ok) bad++;
}
for (const f of NEW) { const ls = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n'), hits = ls.map((l, i) => [i + 1, swallow(l)]).filter((x) => x[1]); hits.forEach(([n, c]) => console.log('  FAIL ' + f + ':' + n + ': code after a // comment: ' + c)); if (hits.length) bad++; else console.log('  ok   ' + f + ': // scan of ' + ls.length + ' lines: clean'); }
console.log(bad ? 'FAILED: ' + bad + ' file(s)' : 'PASS: main preserved in all ' + FILES.length + ' files (base ' + BASE + '), and no code hides after a // comment in them or in the ' + NEW.length + ' new golf files'); process.exit(bad ? 1 : 0);
