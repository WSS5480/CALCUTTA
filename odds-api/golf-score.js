// Oddable Golf: pure scoring engine (no I/O). Used by odds-api/golf.js and its tests.
// Every allowance / percentage below is a COMMISSIONER-SET NUMBER stored on the contest; the defaults are only starting values in the form.
'use strict';

// ---------- handicap strokes ----------
// Strokes a player/team with course handicap `ch` gets on a hole whose stroke index is `si` (1 = hardest), on an n-hole round.
// ch 20 on 18 holes: 1 stroke on every hole, a 2nd on SI 1-2. A plus handicap (ch < 0) gives strokes BACK on the easiest holes (SI 18, 17, ...).
function strokesOn(ch, si, n) {
  n = n || 18; ch = Math.round(Number(ch) || 0); si = Number(si);
  if (ch >= 0) return Math.floor(ch / n) + (si <= ch % n ? 1 : 0);
  const p = -ch, k = Math.floor(p / n) + (si > n - (p % n) ? 1 : 0); return k ? -k : 0;
}
// Team handicap from players' handicaps and the commissioner's allowance list, applied low handicap first.
// e.g. 4-person scramble allowance [25,20,15,10]: 25% of the lowest + 20% of the next + ... ; alternate shot [50,50]; Chapman [60,40].
function teamHcp(hcps, allow) {
  const h = hcps.map(Number).filter(Number.isFinite).sort((a, b) => a - b), a = (allow || []).map(Number);
  let t = 0; h.forEach((x, i) => { t += x * (Number.isFinite(a[i]) ? a[i] : 0) / 100; });
  return Math.round(t * 10) / 10; // stored to 0.1; strokes use Math.round
}
const playHcp = (ch, pct) => Math.round((Number(ch) || 0) * (pct == null ? 100 : Number(pct)) / 100);

// ---------- formats ----------
// ballKind: 'team' = one ball / one score per team per hole (scrambles, alternate shot, Chapman); 'player' = each player's own score per hole.
const FORMATS = {
  scramble4: { name: '4-person scramble', ball: 'team', size: [4, 4], allow: [25, 20, 15, 10], help: 'Everyone tees off, the team picks the best shot, everyone plays from there, and the team writes down one score per hole.' },
  scramble2: { name: '2-person scramble', ball: 'team', size: [2, 2], allow: [35, 15], help: 'Both players hit every shot, the team picks the better one and both play from there; one team score per hole.' },
  texas: { name: 'Texas scramble', ball: 'team', size: [2, 4], allow: [25, 20, 15, 10], drives: 4, help: 'A scramble where each player\'s tee shot must be used at least the set number of times in the round; the app counts drives used and warns when someone is running short.' },
  florida: { name: 'Florida (step-aside) scramble', ball: 'team', size: [3, 4], allow: [25, 20, 15, 10], help: 'A scramble where the player whose shot was used sits out the very next shot, so no player\'s shot can be used twice in a row.' },
  shamble: { name: 'Shamble', ball: 'player', size: [2, 4], count: 2, pct: 80, help: 'Everyone tees off, the team picks the best drive, then each player plays their own ball into the hole; the best set number of scores on each hole count.' },
  bestball: { name: 'Best ball', ball: 'player', size: [2, 4], count: 1, pct: 90, help: 'Everyone plays their own ball the whole hole and the team takes the best one (or best two) scores on each hole.' },
  altshot: { name: 'Alternate shot', ball: 'team', size: [2, 2], allow: [50, 50], help: 'Two players hit one ball, taking turns on every shot (one tees off on odd holes, the other on even holes).' },
  chapman: { name: 'Chapman (Pinehurst)', ball: 'team', size: [2, 2], allow: [60, 40], help: 'Both partners tee off, swap balls for the second shot, pick one ball after that, and alternate shots into the hole.' },
  stroke: { name: 'Stroke play', ball: 'player', size: [1, 4], pct: 100, help: 'Every stroke counts; lowest total for the round wins.' },
  stableford: { name: 'Stableford', ball: 'player', size: [1, 4], pct: 100, help: 'Points per hole against par: double bogey or worse 0, bogey 1, par 2, birdie 3, eagle 4, albatross 5; most points wins.' },
  nassau: { name: 'Nassau', ball: 'player', size: [1, 2], pct: 100, help: 'Three bets in one match: the front nine, the back nine and the full 18, each won by winning more holes; a press starts a new bet for the rest of that nine.' },
  skins: { name: 'Skins', ball: 'player', size: [1, 4], pct: 100, help: 'Each hole is worth a skin; the lowest score alone wins it, and if anyone ties the skin carries over to the next hole.' },
};
const STABLEFORD = (net, par) => Math.max(0, 2 - (net - par));

// Course check: par and stroke index for n holes (9 or 18); stroke index must be 1..n, each once.
function checkCourse(c) {
  const n = Number(c && c.holes) === 9 ? 9 : 18, par = (c.par || []).map(Number), si = (c.hcp || []).map(Number);
  if (par.length !== n || par.some((p) => !(p >= 3 && p <= 6 && Number.isInteger(p)))) return 'Enter par 3 to 6 for every hole';
  if (si.length !== n || [...si].sort((a, b) => a - b).some((v, i) => v !== i + 1)) return 'Each hole needs a different handicap index from 1 to ' + n;
  return null;
}

// ---------- one team's hole score ----------
// team: {tid, players:[pid]}; hole entry e: {g (team gross), p:{pid:strokes}}; ctx: {fmt, course, net, hcp:{pid:playing hcp}, thcp (team hcp), count}
// Returns {gross, net, pts?} for that hole, or null when not complete.
function teamHole(team, e, i, ctx) {
  const F = FORMATS[ctx.fmt], par = ctx.course.par[i], si = ctx.course.hcp[i], n = ctx.course.par.length;
  if (!e) return null;
  if (F.ball === 'team') { const g = Number(e.g); if (!(g >= 1)) return null; const net = g - (ctx.net ? strokesOn(Math.round(ctx.thcp || 0), si, n) : 0); return { gross: g, net }; }
  const s = team.players.map((pid) => { const g = Number(e.p && e.p[pid]); if (!(g >= 1)) return null; const nt = g - (ctx.net ? strokesOn(ctx.hcp[pid] || 0, si, n) : 0); return { pid, gross: g, net: nt, pts: STABLEFORD(nt, par) }; });
  if (s.some((x) => !x)) return null;
  if (ctx.fmt === 'shamble' || ctx.fmt === 'bestball') {
    const k = Math.max(1, Math.min(s.length, Number(ctx.count) || F.count || 1)), by = ctx.net ? 'net' : 'gross';
    const best = [...s].sort((a, b) => a[by] - b[by]).slice(0, k);
    return { gross: best.reduce((a, x) => a + x.gross, 0), net: best.reduce((a, x) => a + x.net, 0), par: par * k, used: best.map((x) => x.pid) };
  }
  if (ctx.fmt === 'stableford') return { gross: s.reduce((a, x) => a + x.gross, 0), net: s.reduce((a, x) => a + x.net, 0), pts: s.reduce((a, x) => a + x.pts, 0), par: par * s.length };
  return { gross: s.reduce((a, x) => a + x.gross, 0), net: s.reduce((a, x) => a + x.net, 0), par: par * s.length };
}
// A team's round: totals, to-par over the holes played, thru.
function teamRound(team, holes, ctx) {
  const n = ctx.course.par.length; let g = 0, nt = 0, pp = 0, thru = 0, pts = 0; const per = [];
  for (let i = 0; i < n; i++) { const r = teamHole(team, holes[i + 1], i, ctx); per.push(r); if (!r) continue; thru++; g += r.gross; nt += r.net; pp += r.par || ctx.course.par[i]; pts += r.pts || 0; }
  return { gross: g, net: nt, toParG: g - pp, toParN: nt - pp, thru, pts, per };
}

// ---------- Texas scramble drives ----------
// drives = list of pid (one per hole played, whose tee shot was used); min = drives each player must have. Warn when a player is short.
function texasDrives(players, drives, min, nHoles) {
  const cnt = {}; players.forEach((p) => (cnt[p] = 0)); drives.forEach((p) => { if (p in cnt) cnt[p]++; });
  const left = (nHoles || 18) - drives.length, need = {}; let total = 0; const warn = [];
  players.forEach((p) => { need[p] = Math.max(0, min - cnt[p]); total += need[p]; if (need[p] > 0 && need[p] >= left - 1) warn.push(p); });
  return { count: cnt, need, left, impossible: total > left, warn: total > left ? players.filter((p) => need[p] > 0) : warn };
}
// ---------- Florida step-aside ----------
// shots = whose shot was used for each stroke on the hole, in order. The player whose shot was used sits out the next shot, so the same player can't be used twice in a row.
function floridaCheck(shots, strokes) {
  if (!Array.isArray(shots) || !shots.length) return null;
  if (strokes != null && shots.length !== Number(strokes)) return 'One shot per stroke: ' + strokes + ' strokes but ' + shots.length + ' shots listed';
  for (let i = 1; i < shots.length; i++) if (shots[i] === shots[i - 1]) return 'Shot ' + (i + 1) + ': the player whose shot was used must sit out the next shot';
  return null;
}

// ---------- skins ----------
// scores: [{id, s:[per-hole score or null]}]; lowest score alone wins the hole plus every carried skin; ties carry. Stops at the first hole not everyone has played.
function skins(scores, nHoles) {
  const out = { holes: [], won: {}, carry: 0 };
  for (let i = 0; i < nHoles; i++) {
    const v = scores.map((x) => ({ id: x.id, s: x.s[i] })); if (v.some((x) => x.s == null)) break;
    const lo = Math.min(...v.map((x) => x.s)), w = v.filter((x) => x.s === lo); out.carry++;
    if (w.length === 1) { out.holes.push({ hole: i + 1, win: w[0].id, skins: out.carry }); out.won[w[0].id] = (out.won[w[0].id] || 0) + out.carry; out.carry = 0; }
    else out.holes.push({ hole: i + 1, win: null, carried: out.carry });
  }
  return out;
}

// ---------- match play ----------
// a, b: per-hole scores (index 0..n-1, null = not played). Holes are played in order from `from` (0-based) for `len` holes.
// Returns status: up (a's lead), played, left, dormie, closed (won before the end), result W/L/T for side a once decided, text "3&2" / "1 up" / "AS".
function match(a, b, from, len) {
  from = from || 0; len = len || a.length; let up = 0, played = 0; const holes = [];
  for (let i = from; i < from + len; i++) {
    if (a[i] == null || b[i] == null) break; const w = a[i] < b[i] ? 1 : a[i] > b[i] ? -1 : 0; up += w; played++; holes.push(w);
    if (Math.abs(up) > len - played) break; // closed out
  }
  const left = len - played, closed = Math.abs(up) > left, done = closed || left === 0;
  const res = done ? (up > 0 ? 'W' : up < 0 ? 'L' : 'T') : null;
  const text = closed && left > 0 ? Math.abs(up) + '&' + left : done ? (up === 0 ? 'Halved' : Math.abs(up) + ' up') : up === 0 ? 'All square' : Math.abs(up) + (up > 0 ? ' up' : ' down');
  return { up, played, left, dormie: !done && left > 0 && Math.abs(up) === left, closed: closed && left > 0, done, res, text, holes };
}
// Nassau between sides a and b on 18 holes: front 9, back 9, total 18; presses = [{nine:'front'|'back', from:hole number}] each a new bet from that hole to the end of its nine.
// autoPress: when a side goes N down within a nine, a press starts automatically on the next hole (one per deficit trigger, counted from the newest bet of that nine).
function nassau(a, b, presses, autoPress) {
  const front = match(a, b, 0, 9), back = match(a, b, 9, 9), total = match(a, b, 0, 18), P = [];
  const add = (nine, from) => { const end = nine === 'front' ? 9 : 18; if (from < (nine === 'front' ? 1 : 10) || from > end) return; if (P.some((p) => p.nine === nine && p.from === from)) return; P.push({ nine, from, m: match(a, b, from - 1, end - from + 1) }); };
  (presses || []).forEach((p) => add(p.nine === 'back' ? 'back' : 'front', Number(p.from)));
  if (autoPress > 0) ['front', 'back'].forEach((nine) => {
    const s0 = nine === 'front' ? 1 : 10, end = s0 + 8; let start = s0;
    for (let guard = 0; guard < 9; guard++) { const m = match(a, b, start - 1, end - start + 1); let run = 0, at = null; for (let k = 0; k < m.holes.length; k++) { run += m.holes[k]; if (Math.abs(run) >= autoPress) { at = start + k + 1; break; } } if (!at || at > end) break; add(nine, at); start = at; }
  });
  P.sort((x, y) => x.from - y.from);
  return { front, back, total, presses: P };
}

// ---------- pro: pick six ----------
// golfers: {id: {st:'active'|'cut'|'wd'|'dq', toPar (number|null), started (bool)}}. mc = 'w1' worst made-cut +1 | 'p10' own score +10 | 'out' cannot count.
function golferScore(g, field, mc) {
  if (!g) return null; if (g.toPar == null && g.st === 'active') return null;
  if (g.st === 'active') return { v: g.toPar, mc: false };
  if (!g.started && g.st === 'wd') return { v: null, mc: true, wd0: true }; // withdrew before teeing off (swap allowed)
  if (mc === 'out') return { v: null, mc: true };
  if (mc === 'p10') return { v: (g.toPar || 0) + 10, mc: true };
  const made = Object.values(field).filter((x) => x.st === 'active' && x.toPar != null).map((x) => x.toPar);
  return { v: (made.length ? Math.max(...made) : (g.toPar || 0)) + 1, mc: true };
}
// One entry's score: best four of the six. Missing counters (under 'out') rank below complete entries.
function pickSix(picks, field, mc) {
  const s = picks.map((id) => ({ id, r: golferScore(field[id], field, mc) }));
  const ok = s.filter((x) => x.r && x.r.v != null).sort((a, b) => a.r.v - b.r.v), best = ok.slice(0, 4);
  return { total: best.length ? best.reduce((a, x) => a + x.r.v, 0) : null, counting: best.map((x) => x.id), n: best.length, alive: picks.filter((id) => field[id] && field[id].st === 'active').length, per: s };
}
// Rank entries: complete (4 counting) first, then lower total, then the tiebreaker (closest winning-score guess, or best single golfer), then name.
function rankSix(entries, field, mc, tb, winScore) {
  const rows = entries.map((e) => { const sc = pickSix(e.picks, field, mc); const bestOne = sc.per.filter((x) => x.r && x.r.v != null).map((x) => x.r.v); return Object.assign({}, e, sc, { tbv: tb === 'best' ? (bestOne.length ? Math.min(...bestOne) : 999) : winScore == null || e.guess == null ? 999 : Math.abs(Number(e.guess) - winScore) }); });
  rows.sort((x, y) => (y.n >= 4) - (x.n >= 4) || (x.total == null) - (y.total == null) || (x.total - y.total) || (x.tbv - y.tbv) || String(x.name).localeCompare(String(y.name)));
  let place = 0; rows.forEach((r, i) => { const p = rows[i - 1]; if (!p || p.total !== r.total || p.tbv !== r.tbv || (p.n >= 4) !== (r.n >= 4)) place = i + 1; r.place = place; });
  return rows;
}
// Tiers: ordered golfer ids -> 6 tiers (sizes 6, 6, 8, 10, 12, rest).
function tiers(order) { const sz = [6, 6, 8, 10, 12], t = []; let k = 0; sz.forEach((n) => { t.push(order.slice(k, k + n)); k += n; }); t.push(order.slice(k)); return t; }

// ---------- pro: one and done points (when the feed has no prize money) ----------
const PTS = [100, 60, 45, 40, 35, 30, 28, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
// Tied places share the points of the places they cover, averaged (T3 for two = (45+40)/2).
function finishPoints(pos, nTied) { const p = Math.max(1, pos | 0), k = Math.max(1, nTied | 0); let s = 0; for (let i = p; i < p + k; i++) s += PTS[i - 1] || 0; return Math.round(s / k * 10) / 10; }

module.exports = { strokesOn, teamHcp, playHcp, FORMATS, STABLEFORD, checkCourse, teamHole, teamRound, texasDrives, floridaCheck, skins, match, nassau, golferScore, pickSix, rankSix, tiers, finishPoints };
