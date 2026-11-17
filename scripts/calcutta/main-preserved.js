// Run: node scripts/calcutta/main-preserved.js [base]   (default base 8af1f79 = main v274, the commit the Calcutta-on-main branch is built on)
// Proves that the Calcutta feature changed NOTHING of main's code in the files it touched: for each file, the lines the branch ADDED are removed, the few
// SANCTIONED one-line replacements (listed below, each with its reason) are put back to main's text, and the result must equal main's file byte for byte.
// Any other removed or changed line of main's = FAIL.
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), BASE = process.argv[2] || '8af1f79';
const FILES = ['pics/gate.js', 'pics/index.html', 'pics/sync.js', 'odds-api/acct.js', 'odds-api/server.js', 'odds-api/groups.r3.test.js'];
// [file, main's line (exact), the branch's line that replaces it (exact), why]
const SANCTIONED = [
  ['pics/index.html', "function grpCapture() { try { const u = new URL(location.href), m = /^g\\.([A-Za-z0-9-]{4,40})$/.exec(u.searchParams.get('join') || ''); if (!u.searchParams.has('join')) return; if (m) grpPend(m[1]); u.searchParams.delete('join'); history.replaceState(history.state, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash); } catch (e) {} }",
    "function grpCapture() { try { const u = new URL(location.href), m = /^g\\.([A-Za-z0-9-]{4,40})$/.exec(u.searchParams.get('join') || ''); if (!m) return; grpPend(m[1]); u.searchParams.delete('join'); history.replaceState(history.state, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash); } catch (e) {} } // only g. (group) links: c. / e. links are left for their own game",
    'review D3: grpCapture consumed ANY ?join= link; now only g. links (the shared snippet in HANDOFF, identical on the pickleball-on-main branch)'],
  ['odds-api/acct.js', "function gFlag(me, e) { if (!me || process.env.GROUPS_ENABLED !== '1') return me; try { return require('./groups').onFor(e) ? Object.assign({}, me, { groups: true }) : me; } catch (er) { return me; } }",
    "function gFlag0(me, e) { if (!me || process.env.GROUPS_ENABLED !== '1') return me; try { return require('./groups').onFor(e) ? Object.assign({}, me, { groups: true }) : me; } catch (er) { return me; } }",
    'renamed only (body byte-identical): the new gFlag = cFlag(gFlag0(me, e), e) adds `calcutta` only while CALCUTTA_ENABLED=1'],
  ['odds-api/groups.r3.test.js', "  const src = process.env.ODD_CALCUTTA || '/home/claude/calcutta-calc/odds-api/calcutta.js'; let C, real = false;",
    "  const src = process.env.ODD_CALCUTTA || path.join(__dirname, 'calcutta.js'); let C, real = false; const ce0 = process.env.CALCUTTA_ENABLED; process.env.CALCUTTA_ENABLED = '1'; try { // Calcutta on main: the engine in this tree, switched on for this check only",
    'review D4: R-CALC2 read an engine copy outside the repo; it now uses this tree\'s and switches it on inside the check (restored in finally)'],
];
let bad = 0;
for (const f of FILES) {
  const main = execFileSync('git', ['show', BASE + ':' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 }), cur = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const diff = execFileSync('git', ['diff', '--no-color', '-U0', BASE, '--', f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 });
  const added = new Set(), minus = [], plus = []; let nl = 0;
  diff.split('\n').forEach((l) => { const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l); if (h) { nl = Number(h[1]); return; } if (l.startsWith('+++') || l.startsWith('---')) return; if (l.startsWith('+')) { added.add(nl); plus.push([nl, l.slice(1)]); nl++; } else if (l.startsWith('-')) minus.push(l.slice(1)); });
  const san = SANCTIONED.filter((s) => s[0] === f), lines = cur.split('\n'), back = [];
  let ok = true, nSan = 0;
  minus.forEach((m) => { const s = san.find((x) => x[1] === m); if (!s) { ok = false; console.log('  FAIL ' + f + ': a line of main\'s was removed or changed: ' + m.slice(0, 140)); } });
  lines.forEach((l, i) => { const n = i + 1; if (!added.has(n)) { back.push(l); return; } const s = san.find((x) => x[2] === l); if (s) { back.push(s[1]); nSan++; } });
  const same = back.join('\n') === main; if (!same) ok = false;
  console.log((ok ? '  ok   ' : '  FAIL ') + f + ': ' + (plus.length - nSan) + ' added line(s), ' + nSan + ' sanctioned replacement(s); without them the file is ' + (same ? 'main\'s, byte for byte' : 'NOT main\'s'));
  san.forEach((s) => { if (lines.includes(s[2])) console.log('         sanctioned: ' + s[3]); });
  if (!ok) bad++;
}
console.log(bad ? 'FAILED: ' + bad + ' file(s) changed main\'s code' : 'PASS: main preserved in all ' + FILES.length + ' files (base ' + BASE + ')'); process.exit(bad ? 1 : 0);
