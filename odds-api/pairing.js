// Oddable PARTNER SUGGESTIONS (P1, owner Nov 16 2026: "Recommendations on the group play to choose the next partner").
// STAND-IN with the shared contract (the Groups / golf branches may ship their own odds-api/pairing.js; same signature, same output):
//
//   suggestPartners(players, { mode, teamSize, history }) -> [{ mode, teams: [[id, ...]], names: [[name, ...]], ratings: [avg], spread, reason, notes: [line per team], leftover: [id] }]
//     players  = [{ id, name, rating }]   rating = the app's own number: Oddable rating (pickleball Elo) or Oddable Handicap Index (golf); null = no games yet
//     mode     = 'balanced' (default) | 'rotate' | 'hot'
//     teamSize = 2 (doubles / two-person teams) .. 4
//     history  = [{ ids: [id, id, ...], result: 'W' | 'L' | 'T', at }]   past games these players played ON THE SAME TEAM (lifetime stats)
//     lowerIsBetter = true for golf handicaps (only changes the wording; balance is the same either way)
//
// It only SUGGESTS: up to 3 different full splits, best first, each with a one-line reason. People choose.
//   Balanced: team ratings as close as possible (fair matches).   Rotate: pairs who have not played together lately.   Hot pairs: best record together.
const DEF = 1500; // a player with no games yet is counted at the Elo start value (golf: callers pass a handicap; unknown handicaps use the field average)
const MODES = ['balanced', 'rotate', 'hot'];
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const r0 = (x) => Math.round(x), r1 = (x) => Math.round(x * 10) / 10;

function suggestPartners(players, opt) {
  const o = opt || {}, mode = MODES.includes(o.mode) ? o.mode : 'balanced', size = Math.max(2, Math.min(4, Math.round(Number(o.teamSize) || 2)));
  const P = (Array.isArray(players) ? players : []).filter((p) => p && p.id != null).map((p) => ({ id: String(p.id), name: String(p.name || p.id), rating: Number.isFinite(Number(p.rating)) && p.rating !== null && p.rating !== '' ? Number(p.rating) : null }));
  const known = P.filter((p) => p.rating != null), fill = known.length ? known.reduce((a, p) => a + p.rating, 0) / known.length : DEF;
  const R = {}; P.forEach((p) => (R[p.id] = p.rating != null ? p.rating : o.lowerIsBetter ? fill : DEF));
  const nm = {}; P.forEach((p) => (nm[p.id] = p.name));
  if (P.length < size) return [];
  // pair history: games together, wins together, most recent game together
  const H = {}; (Array.isArray(o.history) ? o.history : []).forEach((h) => { const ids = (h && h.ids || []).map(String); for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = pairKey(ids[i], ids[j]), x = H[k] = H[k] || { n: 0, w: 0, l: 0, last: 0 }; x.n++; if (h.result === 'W') x.w++; else if (h.result === 'L') x.l++; x.last = Math.max(x.last, Number(h.at) || 0); } });
  const nTeams = Math.floor(P.length / size), used = nTeams * size;
  const avg = (t) => t.reduce((a, id) => a + R[id], 0) / t.length;
  const pairsOf = (t) => { const out = []; for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) out.push(pairKey(t[i], t[j])); return out; };
  const spreadOf = (teams) => { const a = teams.map(avg); return Math.max(...a) - Math.min(...a); };
  const lastAll = Object.values(H).reduce((m, x) => Math.max(m, x.last), 0);
  const repeatW = (k) => { const x = H[k]; if (!x) return 0; const age = lastAll && x.last ? Math.max(0, (lastAll - x.last) / 864e5) : 0; return x.n * (1 + 30 / (30 + age)); }; // more games together and more recent = bigger repeat
  const hotV = (k) => { const x = H[k]; if (!x) return 0; return (x.w - x.l) + x.w * 0.1; };
  const cost = (teams) => { const sp = spreadOf(teams); if (mode === 'balanced') return sp; let c = 0; teams.forEach((t) => pairsOf(t).forEach((k) => { c += mode === 'rotate' ? repeatW(k) : -hotV(k); })); return c * 1000 + sp; };
  // candidate splits: snake order by rating, then random restarts; each improved by swapping players between teams (hill climb)
  const ids = P.map((p) => p.id).sort((a, b) => R[b] - R[a] || (a < b ? -1 : 1)), rand = rng(hash(ids.join(',') + mode));
  const build = (order) => { const teams = Array.from({ length: nTeams }, () => []); const left = order.slice(used); order.slice(0, used).forEach((id, i) => { const row = Math.floor(i / nTeams), col = i % nTeams; teams[row % 2 ? nTeams - 1 - col : col].push(id); }); return { teams, left }; };
  const improve = (s) => { let best = cost(s.teams), moved = true, guard = 0; while (moved && guard++ < 200) { moved = false;
    for (let a = 0; a < s.teams.length; a++) for (let b = a + 1; b < s.teams.length; b++) for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) { const ta = s.teams[a], tb = s.teams[b]; [ta[i], tb[j]] = [tb[j], ta[i]]; const c = cost(s.teams); if (c < best - 1e-9) { best = c; moved = true; } else [ta[i], tb[j]] = [tb[j], ta[i]]; }
    for (let a = 0; a < s.teams.length; a++) for (let i = 0; i < size; i++) for (let l = 0; l < s.left.length; l++) { const ta = s.teams[a]; [ta[i], s.left[l]] = [s.left[l], ta[i]]; const c = cost(s.teams); if (c < best - 1e-9) { best = c; moved = true; } else [ta[i], s.left[l]] = [s.left[l], ta[i]]; } }
    return Object.assign(s, { c: best }); };
  const canon = (s) => s.teams.map((t) => t.slice().sort().join('+')).sort().join(' / ');
  const seen = new Map(); const tries = [ids.slice()]; for (let k = 0; k < 40; k++) { const x = ids.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } tries.push(x); }
  tries.forEach((order) => { const s = improve(build(order)); const key = canon(s); if (!seen.has(key)) seen.set(key, s); });
  const ranked = [...seen.values()].sort((a, b) => a.c - b.c || (canon(a) < canon(b) ? -1 : 1)).slice(0, 3);
  const fmtR = (x) => (o.lowerIsBetter ? r1(x).toFixed(1) : String(r0(x)));
  const unknownN = P.filter((p) => p.rating == null).length, unk = unknownN ? ' (' + unknownN + ' with no games yet counted at ' + (o.lowerIsBetter ? 'the field average' : DEF) + ')' : '';
  return ranked.map((s) => {
    const teams = s.teams.map((t) => t.slice().sort((a, b) => R[b] - R[a] || (a < b ? -1 : 1))), A = teams.map(avg), sp = spreadOf(teams), names = teams.map((t) => t.map((id) => nm[id]));
    const pairLine = (t) => pairsOf(t).map((k) => H[k]).filter(Boolean);
    const notes = teams.map((t) => { const h = pairsOf(t).map((k) => H[k]).filter(Boolean); const rec = h.length ? h.reduce((x, y) => ({ w: x.w + y.w, l: x.l + y.l, n: x.n + y.n }), { w: 0, l: 0, n: 0 }) : null; return (o.lowerIsBetter ? 'Avg handicap ' : 'Avg rating ') + fmtR(avg(t)) + (rec ? ' · ' + rec.w + '-' + rec.l + ' together' : ' · first time together'); });
    let reason;
    if (mode === 'balanced') reason = (fmtR(sp) === fmtR(0) ? 'Every team ' + (o.lowerIsBetter ? 'handicap' : 'rating') + ' is ' + fmtR(A[0]) + ': dead even' : 'Team ' + (o.lowerIsBetter ? 'handicaps ' : 'ratings ') + fmtR(Math.min(...A)) + '–' + fmtR(Math.max(...A)) + ': within ' + fmtR(sp) + (o.lowerIsBetter ? ' strokes' : ' points')) + ', the fairest split' + unk + '.';
    else if (mode === 'rotate') { const reps = teams.reduce((n, t) => n + pairLine(t).length, 0), games = teams.reduce((n, t) => n + pairLine(t).reduce((a, x) => a + x.n, 0), 0); reason = reps ? 'Fewest repeats: ' + reps + ' pair' + (reps > 1 ? 's have' : ' has') + ' played together before (' + games + ' game' + (games > 1 ? 's' : '') + '); everyone else gets a new partner.' : 'Everyone gets a partner they have not played with before.'; }
    else { const best = teams.map((t, i) => ({ i, h: pairLine(t).reduce((x, y) => ({ w: x.w + y.w, l: x.l + y.l }), { w: 0, l: 0 }) })).filter((x) => x.h.w + x.h.l > 0).sort((a, b) => (b.h.w - b.h.l) - (a.h.w - a.h.l));
      reason = best.length ? best.slice(0, 2).map((x) => names[x.i].join(' & ') + ' are ' + x.h.w + '-' + x.h.l + ' together').join('; ') + '.' : 'No partner history yet, so these are the most balanced teams.'; }
    return { mode, teams, names, ratings: A.map((x) => (o.lowerIsBetter ? r1(x) : r0(x))), spread: o.lowerIsBetter ? r1(sp) : r0(sp), reason, notes, leftover: s.left.slice() };
  });
}
module.exports = { suggestPartners, MODES, DEF };
