// Oddable Groups: the SERVER grades bets from ESPN final scores (Nov 16 2026, review fix 1 + owner decision G12 "these groups are for all games").
// Nothing a phone says about a result is trusted here: side, line/total, the bet's own odds and stake come from the bet as it was BEFORE kickoff
// (groups.js freezes it), the score comes from ESPN. Same ESPN scoreboard paths the app already uses (pics/index.html xlLoad / xlSports, sports.html).
// Bets this file cannot grade (props, Kalshi markets it cannot map to a game, cash-outs, legs with no game) return {x: reason}; a contest counts
// them only with the commissioner's honor-system rule on.
const D = { fetch: (...a) => fetch(...a), now: () => Date.now(), peek: (lg) => { try { return require('./games').peek(lg); } catch (e) { return null; } } };
// ROUND 3 (Nov 16 2026, manager decisions after the "do not ship" review). THE GRADING RULE, in one place:
//  1. A bet's price is settled at KICKOFF. Until then the server re-reads the free pregame reference (ESPN scoreboard odds; for NFL spreads the consensus
//     line games.js already cached; never an Odds API call) and keeps the last one it saw (groups.js stores rp / rl on the bet's resolution). Nothing read
//     at or after kickoff is used.
//  2. The bet is graded at the WORSE (for the bettor) of the price typed and the reference price. No tolerance.
//  3. No reference price for that market at kickoff: EVEN MONEY at most (+100). A moneyline with a spread line but no moneyline price is capped lower
//     still for the favorite (fair price from the spread, see mlFromSpread).
//  4. Spreads and totals need a reference LINE. None posted before kickoff = the bet does not count. A line better for the bettor than the main line by more
//     than the sport's tolerance (TOLS) is refused when added. Inside the tolerance, or when the main line moved after the bet, the bet is priced as an
//     ALTERNATE line (altPm): implied chance of the reference price (even money when there is none) plus K for every point the bettor's line is better.
//     K is set ABOVE what a point is really worth (NFL spread 10 points of chance per point: the key number 3 lands about 9.5% of the time), so an
//     alternate line is always priced worse than fair. A line WORSE for the bettor earns a small credit (KD per point, 10 points at most) in football
//     and basketball, none elsewhere.
//  5. "Longest odds that count" (contest rule, default +500) is an upper cap on top of all of this, never a substitute.
//  6. Parlays: every leg is priced by rules 1-5 on its own; the multiplier is the product of those leg prices, or the typed one when that is LOWER.
//     Two legs on one game, or the same leg twice, never count.
const TOL = 0, LINE_TOL = 2; // kept for older callers; the real tolerances are per sport and market (TOLS)
const FB = { sp: { tol: 1.5, k: 0.10, kd: 0.02 }, ou: { tol: 2, k: 0.05, kd: 0.02 } }, BB = { sp: { tol: 1.5, k: 0.06, kd: 0.02 }, ou: { tol: 3, k: 0.03, kd: 0.015 } }, MAIN = { sp: { tol: 0, k: 0.25, kd: 0 }, ou: { tol: 0, k: 0.20, kd: 0 } };
const TOLS = { nfl: FB, ncaaf: FB, nba: BB, ncaab: BB, nhl: MAIN, mlb: MAIN, soccer: MAIN }; // any league not listed: main line only
const SD = { nfl: 13.5, ncaaf: 16, nba: 12, ncaab: 11 }; // spread -> chance of winning (normal approximation), only to cap a moneyline that has no price
const tolOf = (lg, kind) => (TOLS[lg] || MAIN)[kind === 'ou' ? 'ou' : 'sp'];
const LG = {
  nfl: { p: 'football/nfl', q: '', name: 'NFL' },
  ncaaf: { p: 'football/college-football', q: '&groups=80', name: 'College football' },
  nba: { p: 'basketball/nba', q: '', name: 'NBA' },
  mlb: { p: 'baseball/mlb', q: '', name: 'MLB' },
  nhl: { p: 'hockey/nhl', q: '', name: 'NHL' },
  ncaab: { p: 'basketball/mens-college-basketball', q: '&groups=50', name: 'College basketball' },
};
const LGS = Object.keys(LG);
const normLg = (x) => { const s = String(x || '').toLowerCase(); return s === 'cfb' || s === 'ncaa' || s === 'ncaaf' ? 'ncaaf' : s === 'ncaab' || s === 'ncaam' || s === 'cbb' ? 'ncaab' : LG[s] ? s : ''; };
// NFL abbreviations the app rewrites (pics/index.html FIX): WSH->WAS, JAC->JAX, LA->LAR. Compared both ways.
const FIX = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
const canon = (a, lg) => { const s = String(a || '').toUpperCase().trim(); return lg === 'nfl' && FIX[s] ? FIX[s] : s; };
const NFLAB = new Set(['BUF', 'MIA', 'NE', 'NYJ', 'BAL', 'CIN', 'CLE', 'PIT', 'HOU', 'IND', 'JAX', 'JAC', 'TEN', 'DEN', 'KC', 'LV', 'LAC', 'DAL', 'NYG', 'PHI', 'WSH', 'WAS', 'CHI', 'DET', 'GB', 'MIN', 'ATL', 'CAR', 'NO', 'TB', 'ARI', 'LAR', 'LA', 'SF', 'SEA']);
const chiDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const addDay = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const okDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00Z'));

// ---------- ESPN scoreboards by league and date (cached; one request per league/date at a time) ----------
const DAYC = new Map(), FLY = new Map(), BYID = new Map();
function parseEv(e, lg) {
  const c = (e.competitions || [])[0] || {}, st = (e.status && e.status.type) || (c.status && c.status.type) || {};
  const side = (x) => ({ abbr: canon(x.team && x.team.abbreviation, lg), name: String((x.team && x.team.displayName) || ''), short: String((x.team && x.team.shortDisplayName) || ''), loc: String((x.team && x.team.location) || ''), score: Number.isFinite(parseInt(x.score, 10)) ? parseInt(x.score, 10) : null });
  const cs = c.competitors || []; const h = cs.find((x) => x.homeAway === 'home'), a = cs.find((x) => x.homeAway === 'away');
  const start = Date.parse(e.date || c.date || ''); if (!e.id || !h || !a || !Number.isFinite(start)) return null;
  const name = String(st.name || '');
  const off = /POSTPON|CANCEL|SUSPEND|FORFEIT|ABANDON|DELAY/i.test(name) && !/FINAL|FULL_TIME/i.test(name), canc = /CANCEL|FORFEIT|ABANDON/i.test(name);
  // round 3: postponed / cancelled is read BEFORE final. A cancelled game that ESPN marks "completed" at 0-0 is never a final score.
  return { lg, id: String(e.id), start, state: String(st.state || 'pre'), done: !!st.completed && String(st.state) === 'post' && !off, off, canc: off && canc, home: side(h), away: side(a), odds: parseOdds(c, side(h).abbr, side(a).abbr) };
}
// ESPN pregame odds (scoreboard competitions[0].odds[0]): classic fields (homeTeamOdds.moneyLine, spread, overUnder, *Odds) and the newer
// moneyline / pointSpread / total blocks (close, else open). Spread kept as the HOME team's line (home -2.5 = favored by 2.5). Prices must look American.
const am = (v) => { const n = typeof v === 'string' ? Number(String(v).replace(/^\+/, '').replace(/^EVEN$/i, '100')) : Number(v); return Number.isFinite(n) && (n <= -100 || n >= 100) && Math.abs(n) <= 100000 ? n : null; };
const num = (v) => { if (v == null || String(v).trim() === '') return null; const n = Number(String(v).trim().replace(/^[ou]/i, '')); return Number.isFinite(n) ? n : null; };
function parseOdds(c, habbr, aabbr) {
  const o = (c && Array.isArray(c.odds) && c.odds[0]) || null; if (!o) return null;
  const pick = (blk, k) => blk && (blk.close && blk.close[k] != null ? blk.close[k] : blk.open && blk.open[k] != null ? blk.open[k] : null);
  const H = o.homeTeamOdds || {}, A = o.awayTeamOdds || {}, out = {};
  const mh = am(pick(o.moneyline && o.moneyline.home, 'odds')) || am(H.moneyLine), ma = am(pick(o.moneyline && o.moneyline.away, 'odds')) || am(A.moneyLine);
  if (mh || ma) out.ml = { home: mh, away: ma };
  let hl = num(pick(o.pointSpread && o.pointSpread.home, 'line'));
  if (hl == null && typeof o.details === 'string') { const m = /^([A-Z0-9]{2,6})\s+([+-]?\d+(?:\.\d+)?)$/.exec(o.details.trim()); if (m) { const v = Number(m[2]); hl = m[1] === habbr ? v : m[1] === aabbr ? -v : null; } else if (/^(EVEN|PK|PICK)/i.test(o.details.trim())) hl = 0; }
  if (hl != null) out.sp = { home: hl, ph: am(pick(o.pointSpread && o.pointSpread.home, 'odds')) || am(H.spreadOdds), pa: am(pick(o.pointSpread && o.pointSpread.away, 'odds')) || am(A.spreadOdds) };
  const tl = num(pick(o.total && o.total.over, 'line')) || num(o.overUnder);
  if (tl) out.ou = { line: tl, over: am(pick(o.total && o.total.over, 'odds')) || am(o.overOdds), under: am(pick(o.total && o.total.under, 'odds')) || am(o.underOdds) };
  return Object.keys(out).length ? out : null;
}
// The pick of a resolved leg in plain terms, whatever it came from (a typed bet, a Kalshi YES / NO contract, a combo leg "X to lose"):
//   { kind: 'ml'|'sp'|'ou', side: 'home'|'away' (ml, sp), line (sp: that side's line; ou: the total), ovr (ou) }
function eqv(r) {
  if (!r || !r.kind || r.kind === 'prop') return null; const other = (x) => (x === 'home' ? 'away' : 'home');
  if (r.ks) { const yes = r.ks !== 'no';
    if (r.kind === 'ml') return r.side ? { kind: 'ml', side: yes ? r.side : other(r.side) } : null;
    if (r.kind === 'sp') return r.side && Number.isFinite(Number(r.over)) ? { kind: 'sp', side: yes ? r.side : other(r.side), line: yes ? -Number(r.over) : Number(r.over) } : null; // "X wins by more than N" = X -N; NO = the other team +N
    return Number.isFinite(Number(r.over)) ? { kind: 'ou', ovr: yes, line: Number(r.over) } : null; }
  if (r.kind === 'ou') return { kind: 'ou', ovr: !!r.ovr, line: Number(r.line) };
  if (!r.side) return null;
  return r.kind === 'sp' ? { kind: 'sp', side: r.side, line: Number(r.line) } : { kind: 'ml', side: r.lose ? other(r.side) : r.side };
}
const ncdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const amOfP = (p) => { const q = Math.min(0.99, Math.max(0.01, p)); return q >= 0.5 ? -Math.round(100 * q / (1 - q)) : Math.round(100 * (1 - q) / q); };
// A moneyline with no price but a spread line: the favorite's fair price from the spread, pushed 3 points of chance against the bettor. Never better than even money.
function mlFromSpread(lg, sideLine) { const sd = SD[lg]; if (!sd || !Number.isFinite(Number(sideLine))) return null; const p = Math.min(0.97, ncdf(-Number(sideLine) / sd) + 0.03); return p > 0.5 ? amOfP(p) : null; }
// The reference for one resolved leg from the game's PREGAME odds: { rp (American price or null), rl (the main line for this side / total, sp and ou only),
// rd (moneyline only: price cap worked out from the spread when there is no moneyline price), rs: source }. null = nothing posted.
function refOf(r) {
  const g = r && r.g, E = eqv(r); if (!g || !E) return null; const O = g.odds || {}; let rp = null, rl, rd, rs = 'espn';
  const nflLine = () => { if (g.lg !== 'nfl') return null; const pk = D.peek('nfl'), b = pk && Array.isArray(pk.games) && pk.games.find((x) => x.home === g.home.abbr && x.away === g.away.abbr); return b && Number.isFinite(b.line) ? b : null; }; // games.js cache: line = HOME favored points
  if (E.kind === 'ml') { if (O.ml) rp = O.ml[E.side]; if (rp == null) { let hl = O.sp ? O.sp.home : null; if (hl == null) { const b = nflLine(); if (b) hl = -b.line; } if (hl != null) rd = mlFromSpread(g.lg, E.side === 'home' ? hl : -hl); } }
  else if (E.kind === 'sp') {
    if (O.sp) { rl = E.side === 'home' ? O.sp.home : -O.sp.home; rp = E.side === 'home' ? O.sp.ph : O.sp.pa; }
    if (rl == null) { const b = nflLine(); if (b) { rl = E.side === 'home' ? -b.line : b.line; rs = 'books'; const ps = (b.books || []).filter((k) => k.l === b.line).map((k) => (E.side === 'home' ? k.p : k.pa)).filter((x) => am(x)); if (ps.length) rp = ps.sort((x, y) => x - y)[ps.length >> 1]; } }
  } else if (O.ou) { rl = O.ou.line; rp = E.ovr ? O.ou.over : O.ou.under; }
  if (rp == null && rl == null && rd == null) return null;
  const o = { rp: rp == null ? null : rp, rl, rs }; if (rd != null) o.rd = rd; return o;
}
const fav = (a) => a; // round 3: no tolerance on the price (kept for older callers)
const pmOf = (a) => (a > 0 ? a / 100 : 100 / -a); // profit per $1 at an American price
const impl = (a) => (a > 0 ? 100 / (a + 100) : -a / (-a + 100)); // chance a price implies (the book's margin stays in: worse for the bettor)
// Points the bettor's line is BETTER for them than a main line (negative = worse). null when there is no line to compare.
function better(r, mainLine) { const E = eqv(r); if (!E || E.kind === 'ml' || mainLine == null || !Number.isFinite(Number(mainLine)) || !Number.isFinite(E.line)) return null; return E.kind === 'sp' ? E.line - Number(mainLine) : E.ovr ? Number(mainLine) - E.line : E.line - Number(mainLine); }
const lineTxt = (r, v) => { const E = eqv(r) || {}, g = r.g; if (E.kind === 'ou') return (E.ovr ? 'Over ' : 'Under ') + v; const t = g ? g[E.side].abbr : ''; return (t ? t + ' ' : '') + (v > 0 ? '+' : '') + v; };
// The line check, WITH OR WITHOUT a reference price, whenever there is a reference line. Returns '' or the reason the line is refused.
//   - no line at all: spreads / totals do not count ("No line posted yet")
//   - better than the main line by more than the sport's tolerance: refused, unless the bet was inside the tolerance of the line when it was added (al)
function lineWhy(r) {
  const E = eqv(r); if (!E || E.kind === 'ml') return '';
  if (r.rl == null || !Number.isFinite(Number(r.rl))) return 'No line posted yet for this game — try closer to kickoff';
  const T = tolOf(r.lg || (r.g && r.g.lg), E.kind), d = better(r, r.rl); if (d == null) return 'Line Oddable cannot read';
  if (d > T.tol + 1e-9 && !(r.al != null && better(r, r.al) <= T.tol + 1e-9)) return T.tol ? 'Line too far from the market: the main line is ' + lineTxt(r, Number(r.rl)) + ', and a group bet can be at most ' + T.tol + ' points better' : 'Main line only in this sport: ' + lineTxt(r, Number(r.rl));
  return '';
}
const lineFar = (r) => !!lineWhy(r);
// Add-time check only: in main-line-only sports (hockey, baseball, soccer) the line must BE the main line, either direction.
function addWhy(r) { const w = lineWhy(r); if (w) return w; const E = eqv(r); if (!E || E.kind === 'ml') return ''; const T = tolOf(r.lg || (r.g && r.g.lg), E.kind), d = better(r, r.rl); return !T.tol && Math.abs(d) > 1e-9 ? 'Main line only in this sport: ' + lineTxt(r, Number(r.rl)) : ''; }
// ALTERNATE LINE PRICE (documented in HANDOFF "Round 3 grading rule"). Profit per $1 for a spread / total at the bettor's line, from the main line's price:
//   p0 = chance implied by the reference price (0.5 when there is no price)          d = points the bettor's line is better than the main line
//   d > 0:  p = min(0.98, p0 + K * d)                 K by sport and market (TOLS), above the real worth of a point
//   d < 0:  p = max(0.25, p0 - KD * min(-d, 10))      only when there is a reference price; else no credit
//   price = (1 - p) / p   and never better than even money when there was no reference price
function altPm(r) {
  const E = eqv(r), T = tolOf(r.lg || (r.g && r.g.lg), E.kind), d = better(r, r.rl) || 0, has = r.rp != null && !!am(r.rp), p0 = has ? impl(Number(r.rp)) : 0.5;
  let p = p0; if (d > 1e-9) p = Math.min(0.98, p0 + T.k * d); else if (d < -1e-9 && has && T.kd) p = Math.max(0.25, p0 - T.kd * Math.min(-d, 10));
  const pm = (1 - p) / p; return has ? pm : Math.min(1, pm);
}
// Profit per $1 of ONE leg after the whole rule. typed = the leg's own profit per $1 (null when the leg has no price of its own). Returns { pm } or { x: reason }.
function legPrice(r, typed, maxOdds) {
  const E = eqv(r); if (!E) return { x: 'Bet Oddable cannot read' };
  let ref; if (E.kind === 'ml') ref = r.rp != null && am(r.rp) ? pmOf(Number(r.rp)) : Math.min(1, r.rd != null && am(r.rd) ? pmOf(Number(r.rd)) : 1);
  else { const w = lineWhy(r); if (w) return { x: w }; ref = altPm(r); }
  return { pm: Math.min(typed == null ? ref : Math.min(typed, ref), (Number(maxOdds) || 500) / 100), ref: r.rp != null ? 1 : 0 };
}
async function day(lg, d, ctx) { // all games of one league on one date (ESPN's date), cached: 10 min for unfinished days, 12 h once every game is final
  const k = lg + '|' + d, c = DAYC.get(k), now = D.now();
  if (c && now - c.at < (c.ok ? (c.all ? 12 * 36e5 : 10 * 6e4) : 2 * 6e4)) return c.games;
  if (FLY.has(k)) return FLY.get(k);
  if (ctx && ctx.budget != null) { if (ctx.budget <= 0) return c ? c.games : []; ctx.budget--; }
  const p = (async () => {
    let games = c ? c.games : [], ok = false;
    try {
      const r = await D.fetch('https://site.api.espn.com/apis/site/v2/sports/' + LG[lg].p + '/scoreboard?dates=' + d.replace(/-/g, '') + '&limit=400' + LG[lg].q, { signal: AbortSignal.timeout(12000) });
      if (r.ok) { const j = await r.json(); games = (j.events || []).map((e) => parseEv(e, lg)).filter(Boolean); ok = true; games.forEach((g) => BYID.set(lg + '|' + g.id, g)); }
    } catch (e) {}
    DAYC.set(k, { at: D.now(), ok, all: ok && games.length > 0 && games.every((g) => g.done || g.off), games });
    if (DAYC.size > 3000) DAYC.delete(DAYC.keys().next().value);
    if (BYID.size > 30000) { let n = 0; for (const x of BYID.keys()) { BYID.delete(x); if (++n > 5000) break; } }
    return games;
  })();
  FLY.set(k, p); try { return await p; } finally { FLY.delete(k); }
}
async function findGame(lgs, gid, d, ctx) { // a game by ESPN id, searching the given leagues on day d and the days either side
  for (const lg of lgs) { const c = BYID.get(lg + '|' + gid); if (c && (c.done || c.off) && !ctx.fresh) return c; }
  if (!okDay(d)) { for (const lg of lgs) { const c = BYID.get(lg + '|' + gid); if (c) return c; } return null; }
  for (const lg of lgs) for (const dd of [d, addDay(d, -1), addDay(d, 1)]) { const g = (await day(lg, dd, ctx)).find((x) => x.id === String(gid)); if (g) return g; }
  return null;
}

// Round 3: a postponed game that moves to a new date keeps its ESPN event id. Follow THE EVENT (ESPN's summary by event id), not the day it was first
// listed on. When the summary cannot be read, look for the same event id on the scoreboards of the next 10 days. Cached 10 minutes per event.
const FOLLOW = new Map(), FFLY = new Map();
function follow(lg, gid, kick, ctx) { const k = lg + '|' + gid; if (FFLY.has(k)) return FFLY.get(k); const p = follow1(lg, gid, kick, ctx).finally(() => FFLY.delete(k)); FFLY.set(k, p); return p; }
async function follow1(lg, gid, kick, ctx) {
  const k = lg + '|' + gid, c = FOLLOW.get(k), now = D.now(); if (c && now - c.at < 10 * 6e4) return c.g;
  let g = null;
  try { const r = await D.fetch('https://site.api.espn.com/apis/site/v2/sports/' + LG[lg].p + '/summary?event=' + encodeURIComponent(gid), { signal: AbortSignal.timeout(12000) });
    if (r.ok) { const j = await r.json(), h = j && j.header, cp = h && (h.competitions || [])[0]; if (h && cp && String(h.id) === String(gid)) g = parseEv({ id: h.id, date: cp.date, status: cp.status, competitions: [cp] }, lg); } } catch (e) {}
  if (!g && Number.isFinite(kick)) { const d0 = chiDay(kick); for (let i = 2; i <= 11 && !g; i++) { const dd = addDay(d0, i); if (dd > addDay(chiDay(now), 1)) break; g = (await day(lg, dd, ctx)).find((x) => x.id === String(gid)) || null; } }
  FOLLOW.set(k, { at: now, g }); if (FOLLOW.size > 2000) FOLLOW.delete(FOLLOW.keys().next().value);
  return g;
}

// ---------- Kalshi tickers -> league, date, teams, market ----------
const KLG = { NFL: 'nfl', NCAAF: 'ncaaf', NBA: 'nba', MLB: 'mlb', NHL: 'nhl', NCAAMB: 'ncaab', NCAAB: 'ncaab' };
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
// e.g. KXNFLGAME-26NOV22KCBUF-KC (series KXNFLGAME, event 26NOV22 + KC + BUF, market KC). Returns null when the shape is not a single-game market.
function parseKt(kt) {
  const m = /^KX(NFL|NCAAF|NBA|MLB|NHL|NCAAMB|NCAAB)(GAME|SPREAD|TOTAL)-(\d{2})([A-Z]{3})(\d{2})\d{0,4}([A-Z]{2,10})-([A-Z0-9]+)$/.exec(String(kt || '').toUpperCase());
  if (!m || !MON[m[4]]) return null;
  const day = '20' + m[3] + '-' + String(MON[m[4]]).padStart(2, '0') + '-' + m[5]; if (!okDay(day) || new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) !== day) return null;
  return { lg: KLG[m[1]], mk: m[2], day, teams: m[6], sfx: m[7] };
}
const ktLeague = (kt) => { const m = /^KX(?:MVE)?(NFL|NCAAF|NBA|MLB|NHL|NCAAMB|NCAAB)/.exec(String(kt || '').toUpperCase()); return m ? KLG[m[1]] : ''; };
const ktType = (kt) => { const t = String(kt || '').toUpperCase(); return /SPREAD/.test(t) ? 'sp' : /TOTAL/.test(t) ? 'ou' : /GAME/.test(t) ? 'ml' : 'prop'; };
const variants = (a, lg) => { const s = canon(a, lg), v = new Set([s, String(a || '').toUpperCase()]); Object.keys(FIX).forEach((k) => { if (lg === 'nfl' && FIX[k] === s) v.add(k); }); return v; };
function ktGame(games, p) { // the game whose two team codes, joined, make the ticker's team part (either order)
  for (const g of games) {
    for (const [x, y] of [[g.away, g.home], [g.home, g.away]]) for (const a of variants(x.abbr, g.lg)) for (const b of variants(y.abbr, g.lg)) if (a + b === p.teams) return g;
  }
  return null;
}
const sideIn = (g, code) => { const c = String(code || '').toUpperCase(); if (variants(g.home.abbr, g.lg).has(c)) return 'home'; if (variants(g.away.abbr, g.lg).has(c)) return 'away'; return ''; };
const kname = (x) => String(x || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[.'’]/g, '').replace(/\bst\b/g, 'state').replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- resolve one leg (or a single bet) to its game ----------
// Returns { key, lg, gid, kick, side: 'home'|'away'|'', kind: 'ml'|'sp'|'ou', line, over, g } or { key, x: reason } when no game can be found.
// One key per game AND pick (side / type / line, Kalshi YES or NO): two bets on the same game must never share a resolution.
const legKey = (l) => (l.pg != null && l.pg !== '' ? 'p' + l.pg : l.gid != null && l.gid !== '' ? 'g' + l.gid + '|' + String(l.side || '').slice(0, 20) + '|' + String(l.type || 'ml') + '|' + (l.type === 'sp' || l.type === 'ou' || l.type === 'tot' ? Number(l.line) : '') + '|' + String(l.lg || '') : l.kt ? 'k' + l.kt + '|' + String(l.ks || 'yes').toLowerCase() + '|' + String(l.text || '').slice(0, 80) : 't' + String(l.text || '').slice(0, 60) + '|' + String(l.day || '').slice(0, 10));
function candLgs(l, allowed) { // leagues to search, most likely first; only leagues the contest allows
  const own = normLg(l.lg) || ktLeague(l.kt);
  let c = own ? [own] : (l.home || l.away) ? (NFLAB.has(String(l.home).toUpperCase()) || NFLAB.has(String(l.away).toUpperCase()) ? ['nfl', 'ncaaf'] : ['ncaaf', 'nfl']) : LGS.slice();
  if (!own && (l.home || l.away)) c = c.concat(LGS.filter((x) => !c.includes(x)));
  return c.filter((x) => allowed.includes(x));
}
async function resolveLeg(l, allowed, ctx, dayHint) {
  const key = legKey(l), d = okDay(String(l.day || '').slice(0, 10)) ? String(l.day).slice(0, 10) : dayHint;
  if (l.pg != null && l.pg !== '') { // a player prop tied to a game (pics/index.html propSave b.pp.gid): the game gives kickoff and league; the prop itself is never graded here
    const lgs = candLgs(l, allowed); const g = lgs.length ? await findGame(lgs, String(l.pg), d, ctx) : null;
    return g ? { key, lg: g.lg, gid: g.id, kick: g.start, kind: 'prop' } : { key, x: lgs.length ? 'Game not found' : 'Not in this contest\'s sport' };
  }
  if (l.kt) { // a single Kalshi market
    const p = parseKt(l.kt); if (!p) return { key, x: 'Kalshi market Oddable cannot match to a game' };
    if (!allowed.includes(p.lg)) return { key, lg: p.lg, x: 'Not in this contest\'s sport' };
    let g = null; for (const dd of [p.day, addDay(p.day, -1), addDay(p.day, 1)]) { g = ktGame(await day(p.lg, dd, ctx), p); if (g) break; }
    if (!g) return { key, lg: p.lg, x: 'Kalshi market Oddable cannot match to a game' };
    const o = { key, lg: g.lg, gid: g.id, kick: g.start, g, kind: p.mk === 'GAME' ? 'ml' : p.mk === 'SPREAD' ? 'sp' : 'ou', ks: String(l.ks || 'yes').toLowerCase() === 'no' ? 'no' : 'yes' };
    if (p.mk === 'GAME') { o.side = sideIn(g, p.sfx); if (!o.side) return { key, lg: g.lg, gid: g.id, kick: g.start, x: 'Kalshi market Oddable cannot read' }; }
    else if (p.mk === 'SPREAD') { const n = /wins? by (?:more than|over) (\d+(?:\.\d+)?)/i.exec(String(l.text || '')), t = sideIn(g, String(p.sfx).replace(/\d+$/, '')); if (!n || !t) return { key, lg: g.lg, gid: g.id, kick: g.start, x: 'Kalshi spread Oddable cannot read' }; o.side = t; o.over = Number(n[1]); }
    else { const n = /(?:over|more than) (\d+(?:\.\d+)?)/i.exec(String(l.text || '')); if (!n) return { key, lg: g.lg, gid: g.id, kick: g.start, x: 'Kalshi total Oddable cannot read' }; o.over = Number(n[1]); }
    return o;
  }
  if (l.gid != null && l.gid !== '') {
    const lgs = candLgs(l, allowed); if (!lgs.length) return { key, x: 'Not in this contest\'s sport' };
    let g = await findGame(lgs, String(l.gid), d, ctx);
    if (!g) { for (const lg of lgs.slice(0, 2)) { g = await follow(lg, String(l.gid), NaN, ctx).catch(() => null); if (g) break; } } // not on the day the bet names (a parlay leg next week, a moved game): ask ESPN for the event itself
    if (!g) return { key, x: 'Game not found in ' + lgs.map((x) => LG[x].name).join(' / ') + ' games' };
    const t = String(l.type || 'ml'), kind = t === 'sp' ? 'sp' : t === 'ou' || t === 'tot' ? 'ou' : 'ml', o = { key, lg: g.lg, gid: g.id, kick: g.start, g, kind, line: Number(l.line) };
    if (kind === 'ou') { const s = String(l.side || ''); if (!/^[OU]/i.test(s) || !(Number(l.line) > 0)) return Object.assign(o, { g: undefined, x: 'Total with no over/under or no number' }); o.ovr = /^O/i.test(s); }
    else { o.side = sideIn(g, l.side); if (!o.side) return Object.assign(o, { g: undefined, x: 'Team not in that game' }); if (kind === 'sp' && !Number.isFinite(Number(l.line))) return Object.assign(o, { g: undefined, x: 'Spread with no number' }); }
    return o;
  }
  const m = /^(.+) to (win|lose)$/i.exec(String(l.text || '').trim()); // a Kalshi combo leg: "Pittsburgh to win" on a day
  if (m && okDay(d)) {
    const k = kname(m[1]); const lgs = candLgs(l, allowed); let hit = null, many = false;
    for (const lg of lgs) for (const dd of [d, addDay(d, -1), addDay(d, 1)]) (await day(lg, dd, ctx)).forEach((g) => { ['home', 'away'].forEach((s) => { const t = g[s]; if ([t.name, t.short, t.loc].some((n) => n && kname(n) === k)) { if (hit && hit.g !== g) many = true; hit = { g, s }; } }); });
    if (!hit || many) return { key, x: 'Combo leg Oddable cannot match to one game' };
    return { key, lg: hit.g.lg, gid: hit.g.id, kick: hit.g.start, g: hit.g, kind: 'ml', side: hit.s, lose: /lose/i.test(m[2]) };
  }
  return { key, x: 'No game on this leg' };
}
// A stored leg resolution (no game object) -> the same with its current game attached (scores), for grading. A game that is missing from its day, postponed,
// or past due is followed by its event id (round 3).
async function withGame(r, ctx) {
  if (!r || r.x || !r.gid) return r; let g = await findGame([r.lg], String(r.gid), chiDay(r.kick), ctx || {});
  if ((!g || (g.off && !g.canc)) && D.now() > r.kick - 36e5) { const f = await follow(r.lg, String(r.gid), r.kick, ctx || {}).catch(() => null); if (f && (!g || f.start !== g.start || f.done || !f.off)) g = f; }
  return Object.assign({}, r, { g: g || undefined });
}
const REFK = ['rp', 'rl', 'rd', 'rs'];
const store = (r) => { const o = {}; const ref = r.g && r.g.state === 'pre' && D.now() < r.g.start ? refOf(r) : null; if (ref) REFK.forEach((k) => { if (ref[k] != null) r[k] = ref[k]; }); ['key', 'lg', 'gid', 'kick', 'side', 'kind', 'line', 'ovr', 'over', 'ks', 'lose', 'rp', 'rl', 'rd', 'rs', 'al'].forEach((k) => { if (r[k] !== undefined && r[k] !== null && !(typeof r[k] === 'number' && !isFinite(r[k]))) o[k] = r[k]; }); return o; };
// The pregame reference of a stored resolution, read again (rule 1): { rp?, rl?, rd?, rs } with only the fields ESPN has right now, or null. Never after kickoff.
async function refresh(r, ctx) {
  if (!r || !r.gid || r.kind === 'prop' || !(D.now() < r.kick)) return null; const g = await findGame([r.lg], String(r.gid), chiDay(r.kick), ctx || {});
  if (!g || g.state !== 'pre' || !(D.now() < g.start)) return null; const ref = refOf(Object.assign({}, r, { g })); if (!ref) return null;
  const o = {}; REFK.forEach((k) => { if (ref[k] != null) o[k] = ref[k]; }); return o;
}
// The void rule (the only way a bet is voided besides the commissioner's void, which follows the same rules). Returns '' or the reason.
//   cancelled / forfeited: void right away. Postponed, suspended or moved to a later time: void once 48 hours have passed since the ORIGINAL kickoff
//   without a final score, unless the contest carries postponed games to their new date (opt.carry, set before the start); a carried game that is
//   still not played when the contest ends (opt.endAt) is void.
const VOID = 'Void: the game was postponed or cancelled and not played within 48 hours';
const VOIDC = 'Void: the game was cancelled', VOIDE = 'Void: the game was postponed and not played before the contest ended';
function voidWhy(r, opt) {
  const g = r && r.g; if (!g) return ''; opt = opt || {}; const now = D.now(), kick = Number.isFinite(Number(r.kick)) ? Number(r.kick) : g.start;
  if (g.canc) return VOIDC;
  const moved = g.start > kick + 6 * 36e5; if (!g.off && !moved) return '';
  if (opt.carry) return (!g.done || g.off) && opt.endAt && now > opt.endAt ? VOIDE : '';
  if (g.done && !g.off && g.start <= kick + 48 * 36e5) return ''; // played within the 48 hours after all
  return now > kick + 48 * 36e5 ? VOID : '';
}
const isVoid = (r, opt) => !!voidWhy(r, opt);
// Result of one resolved leg from the final score: 'won' | 'lost' | 'push' | '' (not final yet). Postponed / cancelled is checked BEFORE final.
function legResult(r, opt) {
  const g = r.g; if (!g) return ''; if (voidWhy(r, opt)) return 'push';
  const kick = Number.isFinite(Number(r.kick)) ? Number(r.kick) : g.start; if (!(opt && opt.carry) && (g.off || g.start > kick + 48 * 36e5)) return ''; // waiting out the 48 hours
  if (g.off || !g.done || g.home.score == null || g.away.score == null) return '';
  const hs = g.home.score, as = g.away.score, tot = hs + as;
  if (r.ks) { // Kalshi market (YES/NO contracts): a tie never says YES to "X wins"
    let yes;
    if (r.kind === 'ml') yes = (r.side === 'home' ? hs - as : as - hs) > 0;
    else if (r.kind === 'sp') yes = (r.side === 'home' ? hs - as : as - hs) > r.over;
    else yes = tot > r.over;
    return (r.ks === 'yes') === yes ? 'won' : 'lost';
  }
  let m;
  if (r.kind === 'ou') m = r.ovr ? tot - r.line : r.line - tot;
  else { const margin = r.side === 'home' ? hs - as : as - hs; m = r.kind === 'sp' ? margin + r.line : margin; }
  if (r.lose) m = -m;
  return m > 0 ? 'won' : m < 0 ? 'lost' : 'push';
}
// Profit multiple of a single bet from its own price: decimal - 1. Kalshi: contracts/stake (each contract pays $1). Null when the price is unusable.
function priceMult(b) {
  if (b.src === 'kalshi') { const m = Number(b.mult); return m > 1 && m <= 100 ? m - 1 : null; }
  if (Number(b.mult) > 1) return Number(b.mult) <= 1001 ? Number(b.mult) - 1 : null;
  const o = Number(b.odds); if (!Number.isFinite(o) || (o > -100 && o < 100) || Math.abs(o) > 100000) return null;
  return o > 0 ? o / 100 : 100 / -o;
}
const okPrice = (a) => typeof a === 'number' && isFinite(a) && (a <= -100 || a >= 100) && Math.abs(a) <= 5000; // same rule as pics/parlay.js (v253)
// Parlay shape (rule 6): the same leg twice, or two legs on one game, never count. legs = resolved legs. Returns '' or the reason.
function parlayWhy(legs) {
  const keys = new Set(), games = new Set();
  for (const r of legs) { if (!r) continue; if (r.key != null) { if (keys.has(r.key)) return 'The same leg is in this parlay twice'; keys.add(r.key); } if (r.gid) { const k = r.lg + '|' + r.gid; if (games.has(k)) return 'Two legs of this parlay are on the same game'; games.add(k); } }
  return '';
}

// Grade a frozen bet. legs = resolved legs (same order as the bet's legs), each with its stored reference (rp / rl / rd / al) and its current game.
// opt = { maxOdds, carry, endAt }. Returns { res: 'won'|'lost'|'push', pl } (pl for the whole stake) when final, { res: '' } when not final yet,
// { x: reason } when it cannot be graded; rule: 1 marks a refusal by the rules above (never handed to the honor system).
function gradeBet(b, legs, opt) {
  opt = opt || {}; const MX = Number(opt.maxOdds) || 500;
  const stake = Number(b.stake); if (!(stake > 0 && stake <= 1e9)) return { x: 'No stake' };
  if (b.kind === 'prop' && !b.kt) return { x: 'Player prop' };
  if (legs.some((r) => r.x)) return { x: legs.find((r) => r.x).x };
  if (b.kind === 'parlay') {
    const pw = parlayWhy(legs); if (pw) return { x: pw, rule: 1 };
    const L = Array.isArray(b.legs) ? b.legs : [], n = legs.length, own = L.length === n && L.every((l) => okPrice(Number(l.o)));
    const m = b.src === 'kalshi' ? Number(b.mult) : Number(b.mult) > 1 ? Number(b.mult) : null, hasM = m > 1 && m <= 1001;
    if (!own && !hasM) return { x: 'Parlay with no payout' };
    const P = legs.map((r, i) => legPrice(r, own ? pmOf(Number(L[i].o)) : null, MX)); // every leg passes the rule on its own
    const badLeg = P.find((p) => p.x); if (badLeg) return { x: 'A leg does not count: ' + badLeg.x, rule: 1 };
    const rs = legs.map((r) => legResult(r, opt));
    if (rs.some((r) => r === 'lost')) return { res: 'lost', pl: -stake };
    if (rs.some((r) => !r)) return { res: '' };
    const vs = legs.map((r) => voidWhy(r, opt)), live = rs.filter((r) => r !== 'push').length, vr = vs.some(Boolean) ? (vs.every(Boolean) ? vs[0] : 'A leg is void (' + vs.find(Boolean).replace(/^Void: /, '') + '): that leg drops out') : '';
    if (!live) return Object.assign({ res: 'push', pl: 0 }, vr ? { vr } : {});
    let d = rs.reduce((a, r, i) => (r === 'push' ? a : a * (1 + P[i].pm)), 1); // the product of the graded leg prices
    if (hasM) d = Math.min(d, live < n ? Math.pow(m, live / n) : m); // the typed multiplier only when it is lower
    return Object.assign({ res: 'won', pl: Math.round(stake * (d - 1) * 100) / 100 }, vr ? { vr } : {});
  }
  const typed = priceMult(b); if (typed == null) { const r0 = legResult(legs[0], opt); return r0 === 'lost' ? { res: 'lost', pl: -stake } : r0 ? { x: 'Odds Oddable cannot use', rule: 1 } : { res: '' }; } // a price nobody can use never wins (and the add step refuses it)
  const p = legPrice(legs[0], typed, MX); if (p.x) return { x: p.x, rule: 1 };
  const r = legResult(legs[0], opt); if (!r) return { res: '' };
  if (r === 'lost') return { res: 'lost', pl: -stake }; if (r === 'push') { const vr = voidWhy(legs[0], opt); return Object.assign({ res: 'push', pl: 0 }, vr ? { vr } : {}); }
  return { res: 'won', pl: Math.round(stake * p.pm * 100) / 100, ref: p.ref };
}
// Is a game window open for any of these leagues right now (a game in progress, or one starting within 2 hours)? Used for the light server tick.
async function windowOpen(lgs, ctx) {
  const now = D.now(), d = chiDay(now);
  for (const lg of lgs) for (const dd of [d, addDay(d, 1)]) { const gs = await day(lg, dd, ctx); if (gs.some((g) => (g.state === 'in') || (g.start > now - 15 * 6e4 && g.start < now + 2 * 36e5))) return true; }
  return false;
}
module.exports = { REFK, VOID, VOIDC, VOIDE, voidWhy, eqv, legPrice, altPm, lineWhy, addWhy, lineFar, parlayWhy, refresh, follow, better, tolOf, TOLS, mlFromSpread, pmOf, impl, refOf, parseOdds, fav, TOL, LINE_TOL, LG, LGS, normLg, parseKt, ktLeague, ktType, legKey, resolveLeg, withGame, store, legResult, gradeBet, priceMult, windowOpen, day, chiDay, okDay, addDay, NFLAB, _deps: D, _reset: () => { DAYC.clear(); FLY.clear(); BYID.clear(); FOLLOW.clear(); FFLY.clear(); } };
