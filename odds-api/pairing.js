// Partner suggestions (owner rule P1, Nov 16 2026). STAND-IN with the shared contract's exact signature; the shared module replaces this file at merge.
//   suggestPartners(players, {mode, teamSize, history, teamHcp}) -> [{teams: [[id, ...], ...], reason, mode, score, hcps: [team handicap]}]  (best first, up to 3)
//   players: [{id, name, hcp}]      hcp = the player's app handicap (golf: Oddable Handicap Index course handicap; pickleball: Oddable rating)
//   mode:    'balanced' (default) team handicaps as close as possible | 'rotate' pairs who have not played together lately | 'hot' best record together
//   history: [{players: [id, ...] (one team), date: 'YYYY-MM-DD', result: 'W'|'L'|'T'|null, place?: n, of?: n}]  (lifetime stats, newest anywhere)
//   teamHcp: optional (hcps[]) -> number; default = the average handicap of the team.
// It only suggests: nothing is saved, people choose. Pure and deterministic (seeded search), no I/O.
'use strict';
const MODES = ['balanced', 'rotate', 'hot'];
const r1 = (x) => Math.round(x * 10) / 10;
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e6) / 1e6; }; }
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

function pairStats(history) { // per pair: games together, "good" results (win or top half), days since last together
  const P = {}; let newest = '';
  (history || []).forEach((h) => { if (h && h.date > newest) newest = h.date; });
  (history || []).forEach((h) => {
    const ids = (h && h.players) || []; const good = h.result === 'W' || (h.place && h.of && h.place <= Math.ceil(h.of / 2) && h.of > 1) ? 1 : 0;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = pairKey(String(ids[i]), String(ids[j])), x = P[k] = P[k] || { n: 0, good: 0, wins: 0, last: '' }; x.n++; x.good += good; if (h.result === 'W' || h.place === 1) x.wins++; if (h.date > x.last) x.last = h.date; }
  });
  const daysAgo = (d) => (d && newest ? Math.round((Date.parse(newest) - Date.parse(d)) / 864e5) : 9999);
  Object.values(P).forEach((x) => { x.ago = daysAgo(x.last); });
  return P;
}

function suggestPartners(players, opt) {
  opt = opt || {}; const mode = MODES.includes(opt.mode) ? opt.mode : 'balanced', size = Math.max(1, Math.min(4, Number(opt.teamSize) || 2));
  const ps = (players || []).filter((p) => p && p.id != null).map((p) => ({ id: String(p.id), name: String(p.name || p.id), hcp: Number.isFinite(Number(p.hcp)) ? Number(p.hcp) : null }));
  if (ps.length < 2 || size < 2) return [];
  const H = {}; ps.forEach((p) => (H[p.id] = p.hcp == null ? 18 : p.hcp)); const N = {}; ps.forEach((p) => (N[p.id] = p.name));
  const th = typeof opt.teamHcp === 'function' ? opt.teamHcp : (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const PS = pairStats(opt.history), nT = Math.ceil(ps.length / size);
  const tH = (t) => th(t.map((id) => H[id]));
  const spread = (teams) => { const v = teams.map(tH); return Math.max(...v) - Math.min(...v); };
  const pairsOf = (teams) => { const o = []; teams.forEach((t) => { for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) o.push(pairKey(t[i], t[j])); }); return o; };
  const recent = (k) => { const x = PS[k]; return x ? x.n * Math.max(0.1, 1 - x.ago / 365) : 0; }; // repeat pairs weigh more when recent
  const hot = (k) => { const x = PS[k]; return x && x.n >= 1 ? (x.good + 1) / (x.n + 2) * Math.min(1, x.n / 3) : 0; }; // shrunk toward 1/2; one round together counts a little, three or more count in full
  const cost = (teams) => { const s = spread(teams);
    if (mode === 'rotate') return pairsOf(teams).reduce((a, k) => a + recent(k), 0) * 10 + s * 0.01;
    if (mode === 'hot') return -pairsOf(teams).reduce((a, k) => a + hot(k), 0) * 10 + s * 0.01;
    return s; };
  const seed = ps.map((p) => p.id).join(',').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) ^ (mode.length * 2654435761);
  const R = rng(seed), seen = new Map();
  const build = (order) => { const t = Array.from({ length: nT }, () => []); order.forEach((id, i) => { const r = Math.floor(i / nT), c = r % 2 ? nT - 1 - (i % nT) : i % nT; t[c].push(id); }); return t; }; // snake draft
  const improve = (teams) => { let best = cost(teams), better = true, guard = 0;
    while (better && guard++ < 200) { better = false;
      for (let a = 0; a < teams.length; a++) for (let b = a + 1; b < teams.length; b++) for (let i = 0; i < teams[a].length; i++) for (let j = 0; j < teams[b].length; j++) {
        [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]]; const c = cost(teams); if (c < best - 1e-9) { best = c; better = true; } else [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]]; } }
    return teams; };
  const sorted = ps.slice().sort((a, b) => H[a.id] - H[b.id] || a.id.localeCompare(b.id)).map((p) => p.id);
  const starts = [sorted]; for (let k = 0; k < 24; k++) { const o = sorted.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } starts.push(o); }
  const enumerate = () => { // small groups (up to 10 players): every split, so the top 3 are truly the best 3
    const sizes = Array.from({ length: nT }, (_, i) => (i < ps.length - (nT - 1) * size ? size : size)).map((x, i) => (i === nT - 1 ? ps.length - size * (nT - 1) : x)), out = [];
    const rec = (left, si, acc) => { if (!left.length) { out.push(acc.map((t) => t.slice())); return; } const first = left[0], rest = left.slice(1), k = sizes[si] - 1;
      const comb = (start, pick) => { if (pick.length === k) { rec(rest.filter((x) => !pick.includes(x)), si + 1, acc.concat([[first].concat(pick)])); return; } for (let i = start; i < rest.length; i++) comb(i + 1, pick.concat(rest[i])); }; comb(0, []); };
    rec(sorted, 0, []); return out; };
  if (ps.length <= 10) enumerate().forEach((t0) => { const t = t0.map((x) => x.slice().sort()).sort((x, y) => (x[0] < y[0] ? -1 : 1)); const key = JSON.stringify(t); if (!seen.has(key)) seen.set(key, { teams: t, c: cost(t) }); });
  else starts.forEach((o) => { const t = improve(build(o)).map((x) => x.slice().sort()).sort((x, y) => (x[0] < y[0] ? -1 : 1)); const key = JSON.stringify(t); if (!seen.has(key)) seen.set(key, { teams: t, c: cost(t) }); });
  const ranked = [...seen.values()].sort((a, b) => a.c - b.c || (JSON.stringify(a.teams) < JSON.stringify(b.teams) ? -1 : 1)).slice(0, 3);
  return ranked.map((x) => {
    const hc = x.teams.map((t) => r1(tH(t))), s = r1(spread(x.teams)), prs = pairsOf(x.teams); let reason;
    if (mode === 'rotate') { const rep = prs.filter((k) => PS[k]); if (!rep.length) reason = 'No repeat pairs: everyone gets a partner they have not played with in the app.';
      else { const k = rep.sort((a, b) => PS[a].ago - PS[b].ago)[0], [a, b] = k.split('|'); reason = rep.length + ' repeat pair' + (rep.length > 1 ? 's' : '') + '; most recent ' + N[a] + ' + ' + N[b] + ' (' + PS[k].last + ').'; } }
    else if (mode === 'hot') { const g = prs.filter((k) => PS[k] && PS[k].good > 0).sort((a, b) => hot(b) - hot(a)); if (!g.length) reason = 'No pair here has a good finish together in the app yet, so this is the most balanced split.';
      else { const k = g[0], [a, b] = k.split('|'); reason = N[a] + ' + ' + N[b] + ': ' + PS[k].good + ' good finish' + (PS[k].good === 1 ? '' : 'es') + ' in ' + PS[k].n + ' round' + (PS[k].n === 1 ? '' : 's') + ' together (' + PS[k].wins + ' win' + (PS[k].wins === 1 ? '' : 's') + ').'; } }
    else reason = 'Team handicaps ' + hc.join(', ') + ': within ' + s + ' stroke' + (s === 1 ? '' : 's') + ' of each other.';
    return { teams: x.teams, reason, mode, score: r1(x.c), hcps: hc };
  });
}
module.exports = { suggestPartners, pairStats, MODES };
