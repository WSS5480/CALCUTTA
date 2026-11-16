// Run: node odds-api/alert.fuzz.test.js      (no network, no database; SEED=253 N=600 by default; WEEK=n runs one week of the seed, TRACE=1 prints its ticks)
// Seeded fuzz of the weekly Lock: N random weeks driven tick by tick through alert.compute(), every tick checked BEFORE and AFTER by alert-check.js.
// Each week is a synthetic 2026 week 2 (12 games: Thursday, Sunday 1pm x6, Sunday 4pm x3, Sunday night, Monday night) on top of a finished week 1. Random events:
//   line moves (also through zero and to pick'em), lines pulled and put back, price changes, outages (7 minutes to 25 hours), restarts (the stored weeks reloaded
//   from JSON, previous tick unknown), the book cache coming and going (source flips with the same or another number), games postponed (off the schedule, some come
//   back later in the week), kickoffs moved (earlier, later, a day later), earlier results arriving late (inputs incomplete), closing lines posted after games.
// Odd weeks use the real model (pics/trophy.js); even weeks a seeded stub that changes side and confidence with every half point, to force Lock moves and flips.
// Pass = 0 violations (see alert-check.js for the list), every week ends with a Lock, and a Lock whose game was played is final by the end of the week.
const A = require('./alert'), D = A._deps, TR = require('../pics/trophy.js'), CHK = require('./alert-check').install(A);
const SEED = +process.env.SEED || 253, N = +process.env.N || 600, ONE = process.env.WEEK ? +process.env.WEEK : null, MIN = 6e4, H = 3600e3, MARK = H, GRACE = 5 * MIN;
D.ship = {}; D.trs = {}; D.shipMax = 0; D.log = () => {}; D.lines = () => null;
const keep = { pickOf: TR.pickOf, dogCover: TR.dogCover };
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const K1 = Date.parse('2026-09-18T00:15:00Z'), KS = Date.parse('2026-09-20T17:00:00Z'), K4 = KS + 3 * H + 25 * MIN, KN = Date.parse('2026-09-21T00:20:00Z'), KM = Date.parse('2026-09-22T00:15:00Z');
const W1 = [['PHI', 'DAL', 24, 20, -2.5], ['GB', 'CHI', 10, 27, -3], ['KC', 'DEN', 20, 17, -1], ['BUF', 'MIA', 14, 31, -6.5], ['WAS', 'NYG', 16, 13, 2.5], ['LAR', 'SEA', 28, 21, 3], ['NE', 'DET', 30, 10, 7], ['LV', 'SF', 23, 17, 6.5]]; // away, home, home score, away score, closing line (home favoured +)
const W2 = [['DAL', 'NYG', K1, 3], ['CHI', 'DET', KS, 6.5], ['MIA', 'NE', KS, 1.5], ['SF', 'GB', KS, 4], ['ATL', 'NO', KS, -2.5], ['CLE', 'PIT', KS, 7], ['HOU', 'IND', KS, -1], ['DEN', 'LV', K4, -2.5], ['SEA', 'LAR', K4, 3.5], ['KC', 'BUF', K4, 1], ['PHI', 'WAS', KN, -6], ['TB', 'CAR', KM, -3]];
const nvKey = (wk, a, h) => wk + '-' + (a === 'LAR' ? 'LA' : a) + '-' + (h === 'LAR' ? 'LA' : h);
const tot = { weeks: 0, ticks: 0, outages: 0, restarts: 0, flips: 0, moves: 0, pulled: 0, postponed: 0, returned: 0, kickoffs: 0, incomplete: 0, noLock: 0, liveAtEnd: 0, liveAtEndGone: 0 }, bad = [];
function week(it) {
  const R = rng(SEED * 7919 + it), pick = (a) => a[Math.floor(R() * a.length)], stub = it % 2 === 0; let epoch = 0;
  if (stub) { TR.pickOf = (g) => { if (!g.line) return null; const h = hash(g.id + '|' + g.line + '|' + epoch + '|' + it), home = (h & 1) === 1; return { id: g.id, week: g.week, abbr: home ? g.home.abbr : g.away.abbr, other: home ? g.away.abbr : g.home.abbr, line: home ? -g.line : g.line, conf: 0.5 + ((h >>> 1) % 1000) / 10000, dog: (home ? -g.line : g.line) > 0 }; }; TR.dogCover = (g) => ({ p: 0.44 + (hash('d' + g.id + g.line + it) % 200) / 1000 }); }
  else { TR.pickOf = keep.pickOf; TR.dogCover = keep.dogCover; }
  const nv = {}, pr = {}; Object.defineProperty(nv, 'pr', { value: pr, enumerable: false });
  const G = W1.map((x, i) => ({ id: '10' + (i + 1), week: 1, start: K1 - 7 * 864e5 + i * H, state: 'post', detail: 'Final', neutral: false, home: { abbr: x[1], score: x[2] }, away: { abbr: x[0], score: x[3] }, espn: null, espnP: null }));
  W1.forEach((x) => { nv[nvKey(1, x[0], x[1])] = x[4]; pr[nvKey(1, x[0], x[1])] = [-110, -110]; });
  const late1 = R() < 0.2 ? G[7] : null, late1At = K1 - 30 * H + R() * 6 * 864e5; if (late1) { late1.state = 'in'; delete nv[nvKey(1, 'LV', 'SF')]; tot.incomplete++; } // the last week-1 game is not final yet: inputs incomplete
  const W = W2.map((x, i) => { let l = x[3] + pick([-2, -1, -0.5, 0, 0, 0, 0.5, 1, 2]); if (l === 0) l = 0.5; return { id: '2' + String(i + 1).padStart(3, '0'), week: 2, start: x[2], state: 'pre', detail: '', neutral: false, home: { abbr: x[1], score: 0 }, away: { abbr: x[0], score: 0 }, espn: R() < 0.06 ? null : l, espnP: R() < 0.8 ? [-110, -110] : null, gone: false, bd: 0, last: l }; });
  G.push(...W);
  // scheduled events of this week
  const span = () => K1 - 30 * H + R() * (KM + 3 * H - (K1 - 30 * H)), ev = [];
  if (R() < 0.3) { const g = pick(W), at = span(); ev.push({ at, f: () => { if (g.state !== 'pre') return; g.gone = true; tot.postponed++; } }); if (R() < 0.5) ev.push({ at: at + (1 + R() * 40) * H, f: () => { if (!g.gone) return; g.gone = false; g.start = Math.max(g.start, KM) + pick([20, 24, 44]) * H; tot.returned++; } }); }
  if (R() < 0.3) { const g = pick(W), at = span(), by = pick([-2, -1, 1, 3, 24]) * H; ev.push({ at, f: () => { if (g.state !== 'pre' || g.gone) return; g.start += by; tot.kickoffs++; } }); }
  ev.sort((a, b) => a.at - b.at);
  let booksOn = R() < 0.5, booksAt = 0; D.peek = () => (booksOn ? { at: booksAt, games: W.filter((g) => !g.gone && g.espn !== null).map((g) => ({ home: g.home.abbr, away: g.away.abbr, start: new Date(g.start).toISOString(), line: g.espn + g.bd, books: g.bp ? [{ l: g.espn + g.bd, p: g.bp[0], pa: g.bp[1] }] : [] })) } : null);
  let weeks = {}, ll = {}, t = K1 - 30 * H, lastT = null, hadLock = false; const end = () => Math.max(KM, ...W.filter((g) => !g.gone).map((g) => g.start)) + 5 * H, v0 = CHK.V.length;
  let closing = 0; // after the last game: two more ticks (the server may have been away over the end of the week)
  while (t < end() || closing++ < 2) {
    if (closing === 1 && t < end() + H) t = end() + H;
    // the world moves
    while (ev.length && ev[0].at <= t) ev.shift().f();
    W.forEach((g) => {
      if (g.gone) return;
      if (g.state === 'pre' && t >= g.start) g.state = 'in';
      if (g.state === 'in' && t >= g.start + 3.3 * H) { g.state = 'post'; g.detail = 'Final'; g.home.score = 10 + Math.floor(R() * 25); g.away.score = 10 + Math.floor(R() * 25); }
      if (g.state === 'post' && nv[nvKey(2, g.away.abbr, g.home.abbr)] === undefined && R() < 0.3) { const k = nvKey(2, g.away.abbr, g.home.abbr); nv[k] = g.last + pick([-0.5, 0, 0, 0.5]); pr[k] = [-110, -110]; }
      if (g.state !== 'pre') return;
      if (R() < 0.06) { const d = pick([-1.5, -1, -0.5, -0.5, 0.5, 0.5, 1, 1.5]); if (g.espn === null) g.espn = g.last; g.espn += d; if (Math.abs(g.espn) > 20) g.espn = g.last; if (g.espn === 0 && R() < 0.7) g.espn = d > 0 ? 0.5 : -0.5; g.last = g.espn; tot.moves++; }
      else if (R() < 0.004) { g.espn = g.espn === null ? g.last : null; tot.pulled++; }
      if (R() < 0.05) g.espnP = R() < 0.85 ? [pick([-105, -108, -110, -112, -115, -120, 100]), pick([-105, -108, -110, -112, -115, -120, 100])] : null;
    });
    if (late1 && late1.state !== 'post' && t >= late1At) { late1.state = 'post'; nv[nvKey(1, 'LV', 'SF')] = 6.5; pr[nvKey(1, 'LV', 'SF')] = [-110, -110]; epoch++; }
    if (R() < 0.02) { booksOn = !booksOn; tot.flips++; W.forEach((g) => { g.bd = R() < 0.6 ? 0 : pick([-0.5, 0.5, 1]); g.bp = R() < 0.8 ? [pick([-105, -110, -115]), pick([-105, -110, -115])] : null; }); }
    booksAt = t - pick([1, 5, 30, 170, 200]) * MIN; // sometimes older than the 3 hours the server accepts
    // the tick
    const restart = lastT !== null && R() < 0.03; if (restart) { weeks = JSON.parse(JSON.stringify(weeks)); ll = JSON.parse(JSON.stringify(ll)); tot.restarts++; }
    const games = G.filter((g) => !g.gone).map((g) => ({ id: g.id, week: g.week, start: g.start, state: g.state, detail: g.detail, neutral: false, home: Object.assign({}, g.home), away: Object.assign({}, g.away), espn: g.espn, espnP: g.espnP && g.espn !== null ? g.espnP.slice() : null }));
    const b = weeks[2] && weeks[2].lock ? Object.assign({}, weeks[2].lock) : null;
    D.now = () => t; A.compute(weeks, games, 2, nv, { map: {}, full: R() < 0.9 }, t, ll, restart ? null : lastT); tot.ticks++;
    const L = weeks[2] && weeks[2].lock; if (L) hadLock = true;
    if (process.env.TRACE && ONE !== null) console.log(`  ${new Date(t).toISOString().slice(5, 16)}${restart ? ' RESTART' : lastT !== null && t - lastT > GRACE ? ' gap ' + Math.round((t - lastT) / MIN) + 'm' : ''}  ${CHK.show(b)}  ->  ${CHK.show(L)}${weeks[2].lockWait ? ' wait=' + weeks[2].lockWait : ''} out=${(weeks[2].lockOut || []).join(',')}`);
    lastT = t;
    // next tick: mostly every minute or few; sometimes an outage; often landing around a freeze mark
    if (closing) { t += MIN; continue; }
    let dt; if (R() < 0.07) { dt = pick([7, 20, 45, 90, 180, 400, 1500]) * MIN; tot.outages++; } else dt = pick([1, 1, 1, 2, 5, 5, 15, 30, 60, 120]) * MIN;
    const marks = W.filter((g) => !g.gone).map((g) => g.start - MARK).filter((m) => m > t).sort((x, y) => x - y);
    if (marks.length && (marks[0] - t <= dt || R() < 0.02) && R() < 0.75) dt = Math.max(MIN, marks[0] - t + pick([-2, -1, 0, 0, 1, 4, 5, 6, 12, 30, 61, 70]) * MIN);
    t += dt;
  }
  tot.weeks++; const L = weeks[2] && weeks[2].lock, lg = L && G.find((g) => g.id === String(L.id));
  if (!L) { if (W.some((g) => !g.gone && weeks[2].gl[g.id])) { tot.noLock++; bad.push(`week ${it}: no Lock at the end of the week`); } }
  else if (!L.final) { if (lg && !lg.gone) { tot.liveAtEnd++; bad.push(`week ${it}: the Lock is still live at the end of the week though its game was played: ${CHK.show(L)}`); } else tot.liveAtEndGone++; }
  for (let i = v0; i < CHK.V.length; i++) bad.push(`week ${it}: ${CHK.V[i]}`);
}
const t0 = Date.now();
if (ONE !== null) week(ONE); else for (let it = 1; it <= N; it++) week(it);
TR.pickOf = keep.pickOf; TR.dogCover = keep.dogCover;
console.log(`alert.fuzz.test.js: seed ${SEED}, ${tot.weeks} weeks, ${tot.ticks} ticks in ${((Date.now() - t0) / 1000).toFixed(0)}s; outages ${tot.outages}, restarts ${tot.restarts}, book cache on/off ${tot.flips}, line moves ${tot.moves}, lines pulled/put back ${tot.pulled}, postponed ${tot.postponed} (came back ${tot.returned}), kickoffs moved ${tot.kickoffs}, weeks with late results ${tot.incomplete}; Lock still live at week end on a game off the schedule ${tot.liveAtEndGone}`);
console.log(CHK.report('fuzz'));
if (process.env.NOTES) CHK.INFO.slice(0, 40).forEach((x) => console.log('  note ' + x));
if (bad.length) { const cls = {}; bad.forEach((x) => { const m = /\[([A-Za-z0-9-]+)\]/.exec(x); cls[m ? m[1] : 'week-end'] = (cls[m ? m[1] : 'week-end'] || 0) + 1; }); console.log('  by kind: ' + JSON.stringify(cls)); console.log(bad.slice(0, process.env.ALL ? 1e9 : 30).map((x) => '  VIOLATION ' + x).join('\n')); console.log(`alert.fuzz.test.js: FAILED, ${bad.length} violations`); process.exitCode = 1; } else console.log('alert.fuzz.test.js: all passed (0 violations)');
