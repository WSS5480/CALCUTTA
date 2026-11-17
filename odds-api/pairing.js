// Partner suggestions for team formats (owner decision P1, Nov 16 2026). SHARED: Groups, golf (scrambles, four-ball, golf-day pairings) and
// local events (pickleball doubles and other team events) all call this one function. No network, no database, no randomness.
// BOUNDED (round 3): at most MAXP = 144 players; an exact search up to EXACT = 12 players, a fast draft-and-swap search beyond; a hard time limit of
// LIMIT_MS = 200 ms (the clock is read only for that limit; when it is hit the best split found so far is returned and `.quick` is true).
//
//   suggestPartners(players, { mode, teamSize, history, sport, top, lowerIsBetter, teamHcp }) -> [suggestion, ...]   (best first, up to `top`)
//   The returned ARRAY also carries .note (one line about missing handicaps / odd counts), .mode, .teamSize, .scale (not part of its JSON).
//   This file REPLACES the stand-in pairing.js files of the golf and events branches at merge: it accepts both of their input shapes and returns
//   every field either of them reads (teams as id arrays, names, hcps / ratings, spread, reason, notes, leftover).
//
//   players   [{ id, name, hcp?, rating?, winPct? }]
//             hcp    = Oddable Handicap Index (golf; LOWER is stronger)            } the handicap / rating the app already keeps (H1)
//             rating = Oddable rating (Elo, pickleball etc.; HIGHER is stronger)   }
//             winPct = lifetime win % (0-100), used only when a player has neither
//             A player with none of the three is counted at the middle of the group and named in `note`.
//             opt.lowerIsBetter = true: `rating` holds a golf handicap (events branch convention): treated as hcp.
//   mode      'balanced' (default): team strengths as close as possible, so matches are fair
//             'rotate'  : pairs who have not played together lately
//             'hot'     : pairs with the best record together (lifetime stats)
//   teamSize  2 (default), 3 or 4. When the players do not divide evenly the last teams are one short (never a team of one unless teamSize is 2 and
//             the count is odd: that player is listed as `sitOut`).
//   history   lifetime team results, newest or oldest first (sorted here by date): [{ date: 'YYYY-MM-DD', team: [id, id, ...], result: 'W'|'L'|'T' }]
//             One entry per team per game. Used by 'rotate' and 'hot', and as the tie-break in 'balanced' (fewer repeats first).
//             Also accepted: `players` or `ids` for `team`; `at` (ms) for `date`; no result but {place, of}: 1st = W, bottom half = L, else T.
//   teamHcp   optional (values[]) -> number: the caller's own team-handicap formula (golf scrambles); default = the team's average.
//   sport     'golf' | 'pickleball' | other: only chooses the words in the reason line.
//   top       how many ranked suggestions to return (default 3, max 5).
//
//   suggestion = { rank, mode, teams: [[id, ...], ...], names: [[name, ...], ...], teamInfo: [{ ids, names, label, strength }], hcps / ratings: [team strength],
//                  spread, repeats, score, reason, notes: [one line per team], sitOut = leftover: [ids], sitOutNames }
//   It ONLY SUGGESTS: nothing here saves teams. People choose.
const MODES = ['balanced', 'rotate', 'hot'], MAXP = 144, EXACT = 12, LIMIT_MS = 200;
// ROUND 4, the hard stop: the clock is read before EVERY evaluation of a split (not every 16th or 64th), the search stops at 40% of the limit, scoring
// what was found stops at 60%, and what is left after that is a fixed small amount of work (ranking at most 400 splits, wording 3). On a busy server
// each step is slower, so fewer splits are looked at; the answer still comes back inside the limit, marked quick.
const now = () => Date.now();
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (x) => Math.round(x * 10) / 10;
const pk = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
// Which scale the group is on: handicap when most players have one, else rating, else lifetime win %.
function scaleOf(players) {
  const n = players.length, h = players.filter((p) => num(p.hcp) !== null).length, r = players.filter((p) => num(p.rating) !== null).length, w = players.filter((p) => num(p.winPct) !== null).length;
  if (h && h >= r) return 'hcp'; if (r) return 'rating'; if (w) return 'winPct'; return n ? 'none' : 'none';
}
// Strength on one comparable number, HIGHER = stronger (a handicap is negated). Missing values get the group median.
function strengths(players, scale) {
  const raw = players.map((p) => (scale === 'none' ? null : num(p[scale]))), have = raw.filter((x) => x !== null).sort((a, b) => a - b);
  const mid = have.length ? (have.length % 2 ? have[(have.length - 1) / 2] : (have[have.length / 2 - 1] + have[have.length / 2]) / 2) : 0;
  return { val: raw.map((x) => (x === null ? mid : x)), missing: players.filter((p, i) => raw[i] === null).map((p) => p.id), sign: scale === 'hcp' ? -1 : 1 };
}
// Pair history: for every two players, games together, record together, and how many of the group's games ago they last teamed up.
function pairStats(history) {
  const day = (h) => (h.date ? String(h.date) : Number(h.at) > 0 ? new Date(Number(h.at)).toISOString().slice(0, 10) : ''), teamOf = (h) => h.team || h.players || h.ids;
  const resOf = (h) => { const r = String(h.result || '').toUpperCase().slice(0, 1); if (r) return r; const pl = Number(h.place), of = Number(h.of); return pl >= 1 && of > 1 ? (pl === 1 ? 'W' : pl > Math.ceil(of / 2) ? 'L' : 'T') : ''; };
  const H = (Array.isArray(history) ? history : []).filter((h) => h && Array.isArray(teamOf(h)) && teamOf(h).length >= 2).map((h, i) => ({ date: day(h), team: [...new Set(teamOf(h).map(String))], result: resOf(h), i }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i));
  const days = [...new Set(H.map((h) => h.date))], P = {};
  H.forEach((h) => { const ago = days.length - 1 - days.indexOf(h.date); // 0 = the most recent day anyone played
    for (let a = 0; a < h.team.length; a++) for (let b = a + 1; b < h.team.length; b++) { const k = pk(h.team[a], h.team[b]), o = (P[k] = P[k] || { g: 0, w: 0, l: 0, t: 0, ago: Infinity, last: '' });
      o.g++; if (h.result === 'W') o.w++; else if (h.result === 'L') o.l++; else if (h.result === 'T') o.t++; if (ago < o.ago) { o.ago = ago; o.last = h.date; } } });
  return P;
}
// Team sizes for n players: as many full teams as possible; a short team only when it still has 2+ players.
function sizesFor(n, k) {
  if (n < 2) return { sizes: [], sit: n };
  if (k === 2) return { sizes: Array(Math.floor(n / 2)).fill(2), sit: n % 2 };
  const t = Math.ceil(n / k), sizes = Array(t).fill(Math.floor(n / t)); for (let i = 0; i < n % t; i++) sizes[i]++; // e.g. 10 players in fours -> 4, 3, 3
  return sizes.some((s) => s < 2) ? { sizes: [n], sit: 0 } : { sizes, sit: 0 };
}
// Every way to split idx (sorted) into teams of the given sizes, each split exactly once: the lowest free player picks a team size still unused, then its
// teammates. Returns null when there are more than `cap` splits (the caller falls back to a draft + swaps search).
function allSplits(idx, sizes, cap, dead) {
  const out = []; let over = false, tick = 0;
  const rec = (free, left, acc) => {
    if (over) return; if (!left.length) { out.push(acc); if (out.length > cap || (dead && (++tick & 7) === 0 && now() > dead)) over = true; return; }
    const first = free[0], rest = free.slice(1);
    for (const size of [...new Set(left)]) { const li = left.indexOf(size), nl = left.slice(0, li).concat(left.slice(li + 1));
      const comb = (start, team) => { if (over) return; if (team.length === size) { const used = new Set(team); rec(free.filter((x) => !used.has(x)), nl, acc.concat([team])); return; }
        for (let j = start; j < rest.length; j++) comb(j + 1, team.concat(rest[j])); };
      comb(0, [first]); }
  };
  rec(idx.slice(), sizes.slice(), []); return over ? null : out;
}
// Round 3: when the players do not divide evenly there are two honest ways to split them. 7 players in threes: 3 / 2 / 2 (short teams) or 4 / 3 (one team
// one over). The caller is offered both (list.choices) and picks with opt.sizes = '3/2/2' | '4/3'.
function sizeChoices(n, k) {
  const a = sizesFor(n, k), out = []; if (a.sizes.length >= 2) out.push(a.sizes.slice().sort((x, y) => y - x));
  if (k > 2 && n % k) { const t = Math.floor(n / k); if (t >= 2) { const b = Array(t).fill(Math.floor(n / t)); for (let i = 0; i < n % t; i++) b[i]++; if (!out.some((s) => s.join('/') === b.join('/'))) out.push(b); } }
  return out.map((s) => ({ key: s.join('/'), sizes: s, label: s.length + ' teams: ' + s.join(' / ') }));
}
const keyOf = (split) => split.map((t) => t.slice().sort((a, b) => a - b).join(',')).sort().join(';');
// Large fields: a snake draft by strength, then deterministic pair swaps while the cost improves; a few rotated starts give alternatives.
function searchSplits(idx, sizes, cost, val, dead) {
  const late = () => !!dead && now() > dead;
  const order = idx.slice().sort((a, b) => val[b] - val[a] || a - b), outs = [], seen = new Set();
  for (let rot = 0; rot < Math.min(6, Math.max(1, order.length)); rot++) {
    const o = order.slice(rot).concat(order.slice(0, rot)), teams = sizes.map(() => []); let t = 0, dir = 1;
    o.forEach((p) => { let guard = 0; while (teams[t].length >= sizes[t] && guard++ < sizes.length * 2) { t += dir; if (t < 0 || t >= sizes.length) { dir = -dir; t += dir; } } teams[t].push(p); t += dir; if (t < 0 || t >= sizes.length) { dir = -dir; t += dir; } });
    if (late()) { if (!outs.length) outs.push(teams.map((x) => x.slice())); outs.quick = true; break; }
    let best = cost(teams), improved = true, loops = 0, stop = false;
    while (improved && !stop && loops++ < 40) { improved = false;
      for (let a = 0; a < teams.length && !stop; a++) for (let b = a + 1; b < teams.length && !stop; b++) for (let i = 0; i < teams[a].length && !stop; i++) for (let j = 0; j < teams[b].length; j++) {
        if (late()) { stop = true; break; }
        const x = teams[a][i], y = teams[b][j]; teams[a][i] = y; teams[b][j] = x; const c = cost(teams);
        if (c < best - 1e-9) { best = c; improved = true; } else { teams[a][i] = x; teams[b][j] = y; } } }
    const k = keyOf(teams); if (!seen.has(k)) { seen.add(k); outs.push(teams.map((x) => x.slice())); }
    if (stop || (dead && now() > dead)) { outs.quick = true; break; }
  }
  return outs;
}
const nameList = (names) => (names.length <= 2 ? names.join(' + ') : names.slice(0, -1).join(', ') + ' + ' + names[names.length - 1]);

function suggestPartners(players, opt) {
  opt = opt || {}; const mode = MODES.includes(opt.mode) ? opt.mode : 'balanced', k = [2, 3, 4].includes(Number(opt.teamSize)) ? Number(opt.teamSize) : 2, top = Math.max(1, Math.min(5, Number(opt.top) || 3));
  const seen = new Set(), P = (Array.isArray(players) ? players : []).filter((p) => p && p.id != null && !seen.has(String(p.id)) && seen.add(String(p.id))).map((p) => { const q = Object.assign({}, p, { id: String(p.id), name: String(p.name || p.id).slice(0, 30) }); if (opt.lowerIsBetter && q.hcp == null && q.rating != null) { q.hcp = q.rating; delete q.rating; } return q; });
  const sport = String(opt.sport || ''), scale = scaleOf(P), S = strengths(P, scale), word = scale === 'hcp' ? 'handicap' : scale === 'rating' ? 'rating' : scale === 'winPct' ? 'lifetime win %' : '';
  const t0 = now(), LIM = Number(opt.limitMs) > 0 ? Math.min(LIMIT_MS, Number(opt.limitMs)) : LIMIT_MS, dead = t0 + LIM * 0.4, dead2 = t0 + LIM * 0.6; /* the search itself gets half of the limit: setting up, ranking and wording the answer fit in the other half, also on a busy server */ let quick = false, sizeKey = '', choices = [];
  const done = (list, note) => Object.defineProperties(list, { note: { value: note || '' }, mode: { value: mode }, teamSize: { value: k }, scale: { value: scale }, sport: { value: sport }, quick: { value: quick }, sizes: { value: sizeKey }, choices: { value: choices } });
  if (P.length < 4) return done([], 'Add at least 4 players to make two teams.');
  if (P.length > MAXP) return done([], 'Suggest partners works for up to ' + MAXP + ' players at a time. Pick who is playing.');
  choices = sizeChoices(P.length, k).map((c) => ({ key: c.key, label: c.label }));
  const pickS = sizeChoices(P.length, k).find((c) => c.key === String(opt.sizes || '')), base = sizesFor(P.length, k), sizes = pickS ? pickS.sizes : base.sizes, sit = pickS ? 0 : base.sit; if (sizes.length < 2) return done([], 'Not enough players for two teams of ' + k + '.');
  sizeKey = sizes.slice().sort((x, y) => y - x).join('/');
  const PS = pairStats(opt.history), ps = (a, b) => PS[pk(P[a].id, P[b].id)] || null;
  const tStr = (t) => { if (typeof opt.teamHcp === 'function') return Number(opt.teamHcp(t.map((i) => S.val[i]))); let a = 0; for (let i = 0; i < t.length; i++) a += S.val[t[i]]; return a / t.length; }; // average, so a short team compares fairly
  const spreadOf = (teams) => { let lo = Infinity, hi = -Infinity; for (const t of teams) { const v = tStr(t); if (v < lo) lo = v; if (v > hi) hi = v; } return hi - lo; };
  const pairsOf = (teams) => { const o = []; teams.forEach((t) => { for (let a = 0; a < t.length; a++) for (let b = a + 1; b < t.length; b++) o.push([t[a], t[b]]); }); return o; };
  // Rotate: a pair that teamed up on the most recent day costs 1, the day before 1/2, then 1/3 ... plus a little for every game together.
  // (both pair scores are worked out once per pair, so scoring a split is a few additions: the search stays inside its time limit)
  const NP = P.length, RC = new Float64Array(NP * NP), HT = new Float64Array(NP * NP), anyRC = Object.keys(PS).length > 0;
  const eachPair = (teams, M) => { let a = 0, n = 0; for (const t of teams) for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) { a += M[t[i] * NP + t[j]]; n++; } return [a, n]; };
  const repeatCost = (teams) => (anyRC ? eachPair(teams, RC)[0] : 0);
  // Hot: each pair's smoothed win rate together (wins + 1) / (decided games + 2); pairs with no games together sit at 0.5.
  // Round 3: a pair is hot on ITS OWN record together. A pair with a losing record is not held against the split (with exactly four players, keeping the
  // winners together forces the two who lost to them together: that must not cancel the hot pair out). It only breaks ties, slightly.
  const rateOf = (s) => (s.w + 0.5 * s.t + 1) / (s.w + s.l + s.t + 2);
  if (!anyRC) HT.fill(0.5); else for (let x = 0; x < NP; x++) for (let y = 0; y < NP; y++) { if (x === y) continue; const s = ps(x, y), r = s && s.w + s.l + s.t > 0 ? rateOf(s) : 0.5; RC[x * NP + y] = s ? 1 / (1 + s.ago) + 0.05 * s.g : 0; HT[x * NP + y] = Math.max(0.5, r) - 0.01 * Math.max(0, 0.5 - r); }
  const hotOf = (teams) => { const [a, n] = eachPair(teams, HT); return n ? a / n : 0.5; };
  const range = Math.max(1e-9, Math.max(...S.val) - Math.min(...S.val));
  const cost = (teams) => (mode === 'balanced' ? spreadOf(teams) / range + 0.001 * repeatCost(teams) : mode === 'rotate' ? repeatCost(teams) + 0.01 * spreadOf(teams) / range : -hotOf(teams) + 0.001 * spreadOf(teams) / range);
  // who sits out (odd count, pairs): try each player sitting, keep the best; with history, the one who sat least recently is not known here, so cost decides.
  const idxAll = P.map((_, i) => i), cands = [];
  // who sits out (odd count, pairs): up to 12 players every player is tried; beyond that five spread across the strength order (weakest, strongest, middle ...)
  const byS = idxAll.slice().sort((a, b) => S.val[a] * S.sign - S.val[b] * S.sign || a - b), few = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => byS[Math.round(f * (byS.length - 1))]))];
  const sitSets = sit ? (P.length <= EXACT + 1 ? idxAll : few).map((i) => [i]) : [[]];
  for (const out of sitSets) { const idx = idxAll.filter((i) => !out.includes(i)); let splits = idx.length <= EXACT ? allSplits(idx, sizes, 20000, dead) : null; if (!splits) { splits = searchSplits(idx, sizes, cost, S.val.map((v) => v * S.sign), dead); if (idx.length <= EXACT || splits.quick) quick = true; }
    for (const teams of splits) { if (cands.length && now() > dead2) { quick = true; break; } cands.push({ teams, out, c: cost(teams), k: '' }); }
    if (cands.length > 30000 || now() > dead) { if (now() > dead) quick = true; break; } }
  // the best `top` (ties broken by the split's own key, so the answer never depends on input order or timing); keys are only built for the near-best
  let lim = Infinity; if (cands.length > 200) { const cs = cands.map((x) => x.c).sort((a, b) => a - b); lim = cs[Math.min(cs.length - 1, 60)] + 1e-12; }
  let near = cands.filter((x) => x.c <= lim); if (near.length > 400) { near = near.slice(0, 400); quick = true; } /* thousands of equal splits (nobody has a number or a history yet): the first 400 found, in the order searched */ near.forEach((x) => { x.k = keyOf(x.teams) + '/' + x.out.join(','); });
  near.sort((a, b) => a.c - b.c || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const picked = []; const used = new Set();
  for (const c of near) { if (used.has(c.k)) continue; used.add(c.k); picked.push(c); if (picked.length >= top) break; }
  const fmt = (v) => (scale === 'hcp' ? r1(v) : scale === 'winPct' ? r1(v) + '%' : Math.round(v));
  const list = picked.map((c, i) => {
    const teams = c.teams.map((t) => t.slice().sort((a, b) => S.val[b] * S.sign - S.val[a] * S.sign || a - b)).sort((a, b) => a[0] - b[0]);
    const strs = teams.map(tStr), spread = Math.max(...strs) - Math.min(...strs), pr = pairsOf(teams), rep = pr.map(([x, y]) => ({ x, y, s: ps(x, y) })).filter((z) => z.s);
    let reason;
    if (mode === 'balanced') reason = scale === 'none' ? 'No handicaps or ratings yet, so every split is even on paper.' : (spread < (scale === 'rating' ? 0.5 : 0.05) ? 'Dead even: every team averages ' + fmt(strs[0]) + ' ' + word + '.' : 'Fairest split: team ' + word + ' averages ' + strs.map(fmt).join(' / ') + ' (' + fmt(spread) + ' apart).');
    else if (mode === 'rotate') { if (!rep.length) reason = 'All new partners: none of these ' + (k === 2 ? 'pairs' : 'teammates') + ' have played together.'; else { const z = rep.slice().sort((a, b) => a.s.ago - b.s.ago)[0]; reason = (rep.length === 1 ? 'One repeat' : rep.length + ' repeats') + ', the most recent ' + P[z.x].name + ' + ' + P[z.y].name + ' (' + (z.s.ago === 0 ? 'last time out' : z.s.ago + ' game day' + (z.s.ago === 1 ? '' : 's') + ' ago') + '); everyone else is new together.'; } }
    else { const hot = rep.filter((z) => z.s.w + z.s.l + z.s.t > 0).sort((a, b) => (b.s.w + 1) / (b.s.w + b.s.l + 2) - (a.s.w + 1) / (a.s.w + a.s.l + 2) || b.s.g - a.s.g)[0]; reason = hot ? 'Best record together: ' + P[hot.x].name + ' + ' + P[hot.y].name + ' are ' + hot.s.w + '-' + hot.s.l + (hot.s.t ? '-' + hot.s.t : '') + ' as partners.' : 'No results together yet, so there are no hot pairs to keep.'; }
    const rs = (v) => (scale === 'none' ? null : scale === 'rating' ? Math.round(v) : r1(v)), info = teams.map((t, j) => ({ ids: t.map((x) => P[x].id), names: t.map((x) => P[x].name), label: nameList(t.map((x) => P[x].name)), strength: rs(strs[j]) }));
    const out = c.out.map((x) => P[x].id), st = info.map((x) => x.strength);
    return { rank: i + 1, mode, teams: info.map((x) => x.ids), names: info.map((x) => x.names), teamInfo: info, hcps: st, ratings: st, notes: info.map((x) => x.label + (x.strength == null ? '' : ' (' + word + ' ' + x.strength + ')')),
      sitOut: out, leftover: out, sitOutNames: c.out.map((x) => P[x].name), spread: rs(spread), repeats: rep.length, score: Math.round(c.c * 1e4) / 1e4, reason };
  });
  const notes = []; if (S.missing.length && scale !== 'none') notes.push(S.missing.length + (S.missing.length === 1 ? ' player has' : ' players have') + ' no ' + word + ' yet (counted at the middle of the group): ' + P.filter((p) => S.missing.includes(p.id)).map((p) => p.name).join(', ') + '.');
  if (sit) notes.push('Odd number of players: one sits out each round.'); if (quick) notes.push('Big field: this is a fast search, not every possible split.'); if (mode !== 'balanced' && !Object.keys(PS).length) notes.push('No team results on record yet, so this falls back to the fairest split.');
  return done(list, notes.join(' '));
}
module.exports = { suggestPartners, pairStats, sizesFor, sizeChoices, MODES, MAXP, EXACT, LIMIT_MS };
