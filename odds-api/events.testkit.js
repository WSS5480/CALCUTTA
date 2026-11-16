// Shared by the events suites. On this branch alone it changes nothing. In the MERGED build (limits.js, stats.js, groups.js... next to events.js) it lets
// the REAL modules run under the tests instead of events' stand-ins: every real module reads the test's in-memory database, clock and sign-in, and the
// real limits module finds the test's Enterprise accounts in its own row ('lock:ent'). No stand-in is pinned.
const path = require('path');
module.exports = function kit(o) {
  const E = o.E, D = o.D, ENT = o.ENT, dir = o.dir || __dirname, real = {};
  for (const n of ['limits', 'stats', 'groups', 'calcutta', 'golf']) { try { real[n] = require(path.join(dir, n + '.js')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') console.error('testkit: ' + n + '.js did not load: ' + e.message); } }
  const L = real.limits, acctKey = (n) => 'acct-' + n;
  const entRow = async (id) => { const r = await D.S.dbGet(id); if (id !== 'lock:ent' || !L || !ENT) return r; const acct = Object.assign({}, r && r.data && r.data.acct); ENT.forEach((n) => { acct[L.keyOf(acctKey(n))] = { on: true, at: 1 }; }); return { id, salt: 'x', pinhash: 'x', data: Object.assign({ seats: {} }, r && r.data, { acct }), updated: (r && r.updated) || 1 }; };
  const LS = { dbGet: (id) => entRow(id), dbPut: (...a) => D.S.dbPut(...a), dbPatchIf: (...a) => D.S.dbPatchIf(...a) };
  Object.keys(real).forEach((n) => { const M = real[n]; if (!M || !M._deps) return; for (const k of ['S', 'now', 'acct', 'ip']) { if (!(k in M._deps) || !(k in D)) continue; Object.defineProperty(M._deps, k, { get: () => (k === 'S' ? LS : D[k]), set() {}, configurable: true, enumerable: true }); } if ('sleep' in M._deps) M._deps.sleep = async () => {}; });
  const resetReal = () => Object.values(real).forEach((M) => { try { if (M && typeof M._reset === 'function') M._reset(); } catch (e) {} });
  if (ENT) ['add', 'delete', 'clear'].forEach((k) => { const f = ENT[k].bind(ENT); ENT[k] = (...a) => { const r = f(...a); resetReal(); return r; }; });
  const r0 = E._reset; E._reset = () => { r0(); resetReal(); };
  return { real, merged: !!(L || real.stats), standRatings: D.rt() === E.STAND, standLimits: D.limits() === E.LIMSTAND };
};
