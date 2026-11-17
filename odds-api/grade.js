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
//  3. ROUND 4 (manager rule, replaces "even money with no reference"): NO REFERENCE AT KICKOFF = THE BET IS VOID, every market, moneylines included, every
//     sport. A reference is a posted PRICE for that market (and the line, for spreads and totals) that the server read inside the last 30 minutes before
//     the game's real kickoff (ra = the time of that read, stored with the price). The decision is made when the bet is graded, from what is stored: it
//     does not matter whether a server tick "ran". A parlay with a leg that has no reference at its kickoff is void as a whole.
//  4. Spreads and totals need a reference LINE and price. A line better for the bettor than the main line by more
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
  // Round 4: "postponed" means an EXPLICIT postponed / cancelled status. A delay or a suspension is a game in progress, never "off".
  const off = /POSTPON|CANCEL|FORFEIT|ABANDON/i.test(name) && !/FINAL|FULL_TIME/i.test(name), canc = /CANCEL|FORFEIT|ABANDON/i.test(name);
  // round 3: postponed / cancelled is read BEFORE final. A cancelled game that ESPN marks "completed" at 0-0 is never a final score.
  return { lg, id: String(e.id), start, state: String(st.state || 'pre'), done: !!st.completed && String(st.state) === 'post' && !off, off, canc: off && canc, home: side(h), away: side(a), odds: parseOdds(c, side(h).abbr, side(a).abbr, lg), at: D.now() }; // at = when the server read this from ESPN
}
// ESPN pregame odds (scoreboard competitions[0].odds[0]): classic fields (homeTeamOdds.moneyLine, spread, overUnder, *Odds) and the newer
// moneyline / pointSpread / total blocks. Spread kept as the HOME team's line (home -2.5 = favored by 2.5). Prices must look American.
// Round 5 (L2): the price is the block's CURRENT or CLOSE value, else the classic field. The OPEN price is never used: an opening number can be hours old.
// Round 5 (L3): the team code in the old "WSH -3" text is read through the same rewrite as the teams (WSH = WAS, JAC = JAX, LA = LAR).
const am = (v) => { const n = typeof v === 'string' ? Number(String(v).replace(/^\+/, '').replace(/^EVEN$/i, '100')) : Number(v); return Number.isFinite(n) && (n <= -100 || n >= 100) && Math.abs(n) <= 100000 ? n : null; };
const num = (v) => { if (v == null || String(v).trim() === '') return null; const n = Number(String(v).trim().replace(/^[ou]/i, '')); return Number.isFinite(n) ? n : null; };
function parseOdds(c, habbr, aabbr, lg) {
  const o = (c && Array.isArray(c.odds) && c.odds[0]) || null; if (!o) return null;
  const pick = (blk, k) => blk && (blk.current && blk.current[k] != null ? blk.current[k] : blk.close && blk.close[k] != null ? blk.close[k] : null);
  const H = o.homeTeamOdds || {}, A = o.awayTeamOdds || {}, out = {};
  const mh = am(pick(o.moneyline && o.moneyline.home, 'odds')) || am(H.moneyLine), ma = am(pick(o.moneyline && o.moneyline.away, 'odds')) || am(A.moneyLine);
  if (mh || ma) out.ml = { home: mh, away: ma };
  let hl = num(pick(o.pointSpread && o.pointSpread.home, 'line'));
  if (hl == null && typeof o.details === 'string') { const m = /^([A-Z0-9]{2,6})\s+([+-]?\d+(?:\.\d+)?)$/.exec(o.details.trim()); if (m) { const v = Number(m[2]), is = (ab) => m[1] === ab || canon(m[1], lg) === ab || FIX[m[1]] === ab; hl = is(habbr) ? v : is(aabbr) ? -v : null; } /* the code as written, or through the NFL rewrite (also when the caller gave no league) */ else if (/^(EVEN|PK|PICK)/i.test(o.details.trim())) hl = 0; }
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
// rs: source, at: when the server read it, full: a posted PRICE for this market (and its line, for spreads / totals) }. null = nothing posted.
// Round 4: a moneyline with no moneyline price has NO reference (the price worked out from the spread is gone with the even-money path).
function refOf(r) {
  const g = r && r.g, E = eqv(r); if (!g || !E) return null; const O = g.odds || {}; let rp = null, rl, rs = 'espn', at = Number(g.at) || 0;
  const nflLine = () => { if (g.lg !== 'nfl') return null; const pk = D.peek('nfl'), b = pk && Array.isArray(pk.games) && pk.games.find((x) => x.home === g.home.abbr && x.away === g.away.abbr); return b && Number.isFinite(b.line) ? Object.assign({ _at: Number(pk.at) > 0 ? Math.min(Number(pk.at), at || Number(pk.at)) : at }, b) : null; }; // games.js cache: line = HOME favored points
  if (E.kind === 'ml') { if (O.ml) rp = O.ml[E.side]; }
  else if (E.kind === 'sp') {
    if (O.sp) { rl = E.side === 'home' ? O.sp.home : -O.sp.home; rp = E.side === 'home' ? O.sp.ph : O.sp.pa; }
    if (rl == null) { const b = nflLine(); if (b) { rl = E.side === 'home' ? -b.line : b.line; rs = 'books'; at = b._at; const ps = (b.books || []).filter((k) => k.l === b.line).map((k) => (E.side === 'home' ? k.p : k.pa)).filter((x) => am(x)); if (ps.length) rp = ps.sort((x, y) => x - y)[ps.length >> 1]; } }
  } else if (O.ou) { rl = O.ou.line; rp = E.ovr ? O.ou.over : O.ou.under; }
  if (rp == null && rl == null) return null;
  return { rp: rp == null ? null : rp, rl, rs, at, full: rp != null && !!am(rp) && (E.kind === 'ml' || (rl != null && Number.isFinite(Number(rl)))) };
}
// ROUND 4, THE COUNTING RULE: does this stored leg have a reference AT KICKOFF? A posted price for its market (and the line for a spread / total) that the
// server read inside the last REFWIN (30 minutes) before the game's real kickoff. Settled from the stored fields only (rp, rl, ra, kick).
const REFWIN = 30 * 6e4;
const NOREF = 'No posted price at kickoff — this bet did not count', NOREFP = 'No posted price at kickoff on one leg — this parlay did not count';
function refOk(r) { const E = eqv(r); if (!E || !(r.rp != null && am(r.rp))) return false; if (E.kind !== 'ml' && !(r.rl != null && Number.isFinite(Number(r.rl)))) return false; const k = Number(r.kick), a = Number(r.ra); return a > 0 && a < k && a >= k - REFWIN; }
// ESPN says the game really started (in progress or over) and it is not postponed / cancelled: only then is "no reference at kickoff" final.
const kicked = (r) => !!(r && r.g && !r.g.off && r.g.state !== 'pre' && D.now() >= Number(r.kick));
const fav = (a) => a; // round 3: no tolerance on the price (kept for older callers)
const amOfPm = (pm) => (pm >= 1 ? Math.round(pm * 100) : -Math.round(100 / pm)); // profit per $1 -> American price
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
  if (!refOk(r)) return { v: NOREF }; // round 4: no reference at kickoff = void (never even money)
  let ref; if (E.kind === 'ml') ref = pmOf(Number(r.rp)); else { const w = lineWhy(r); if (w) return { x: w }; ref = altPm(r); }
  return { pm: Math.min(typed == null ? ref : Math.min(typed, ref), (Number(maxOdds) || 500) / 100), ref: 1 };
}
// ctx.fail (round 4) is set whenever ESPN could not be read for a day that was asked for (request failed, or the pass ran out of its request budget):
// the add step then says "Couldn't check this game — try again" instead of treating the game as missing.
async function day(lg, d, ctx) { const gs = await day0(lg, d, ctx), c = DAYC.get(lg + '|' + d); if (ctx && c && !c.ok) ctx.fail = true; return gs; }
// ROUND 5 (review H1 / M2): the copy of a day that has a game about to start (45 minutes before its listed kickoff to 15 minutes after, still "not started")
// is kept 1 minute, not 10, so the kickoff price and "the game has started" are never more than a minute old on any read. `force` (the add step, see
// freshGame) reads ESPN again unless a GOOD answer is under 5 seconds old; it also skips the 2-minute wait after a failed read.
const NEAR_B = 45 * 6e4, NEAR_A = 15 * 6e4, FRESH_MS = 5000;
const nearKick = (games, now) => games.some((g) => g.state === 'pre' && !g.off && g.start - now < NEAR_B && now - g.start < NEAR_A);
async function day0(lg, d, ctx, force) { // all games of one league on one date (ESPN's date), cached: 10 min for unfinished days (1 min near a kickoff), 12 h once every game is final
  const k = lg + '|' + d, c = DAYC.get(k), now = D.now();
  if (c && (force ? c.ok && now - c.at <= FRESH_MS : now - c.at < (c.ok ? (c.all ? 12 * 36e5 : nearKick(c.games, now) ? 6e4 : 10 * 6e4) : 2 * 6e4))) return c.games;
  if (FLY.has(k)) return FLY.get(k);
  if (ctx && ctx.budget != null) { if (ctx.budget <= 0) { ctx.fail = true; return c ? c.games : []; } ctx.budget--; }
  const p = (async () => {
    let games = c ? c.games : [], ok = false;
    try {
      const r = await D.fetch('https://site.api.espn.com/apis/site/v2/sports/' + LG[lg].p + '/scoreboard?dates=' + d.replace(/-/g, '') + '&limit=400' + LG[lg].q, { signal: AbortSignal.timeout(12000) });
      if (r.ok) { const j = await r.json(); games = (j.events || []).map((e) => parseEv(e, lg)).filter(Boolean); ok = true; games.forEach((g) => { g.dk = d; BYID.set(lg + '|' + g.id, g); }); }
    } catch (e) {}
    DAYC.set(k, { at: D.now(), ok, all: ok && games.length > 0 && games.every((g) => g.done || g.off), games });
    if (DAYC.size > 3000) DAYC.delete(DAYC.keys().next().value);
    if (BYID.size > 30000) { let n = 0; for (const x of BYID.keys()) { BYID.delete(x); if (++n > 5000) break; } }
    return games;
  })();
  FLY.set(k, p); try { return await p; } finally { FLY.delete(k); }
}
// ROUND 5 (H1): ONE GAME READ FRESH, for the add step. Returns { g } (ESPN answered just now and shows the game), { fail: true } (ESPN did not answer:
// the add is refused, "Couldn't check this game — try again") or { gone: true } (ESPN answered and the game is not on its board any more).
async function freshGame(g0, ctx) {
  const lg = g0.lg, d0 = chiDay(g0.start), ds = [g0.dk, d0, addDay(d0, -1), addDay(d0, 1)].filter((d, i, a) => okDay(d) && a.indexOf(d) === i); let failed = false;
  for (const d of ds) { const gs = await day0(lg, d, ctx, true), c = DAYC.get(lg + '|' + d); if (!c || !c.ok || D.now() - c.at > FRESH_MS) { failed = true; continue; } const g = gs.find((x) => x.id === String(g0.id)); if (g) return { g }; }
  return failed ? { fail: true } : { gone: true };
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
// Round 4: kick = NaN is the ADD step (the bet names a game that is not on the day it gives). The event lookup must ANSWER: a game is returned only when
// ESPN shows it (the summary, or failing that the scoreboards of the next days). When ESPN did not answer and the game was not found, ctx.fail is set
// and nothing is cached, so the add is refused with "Couldn't check this game — try again" and never accepted blind.
function follow(lg, gid, kick, ctx, hint) { const k = lg + '|' + gid; if (FFLY.has(k)) return FFLY.get(k); const p = follow1(lg, gid, kick, ctx, hint).finally(() => FFLY.delete(k)); FFLY.set(k, p); return p; }
async function follow1(lg, gid, kick, ctx, hint) {
  const k = lg + '|' + gid, c = FOLLOW.get(k), now = D.now(); if (c && now - c.at < 10 * 6e4) return c.g;
  let g = null, sure = false; // sure = ESPN answered (found, or a plain "no such event in this league")
  try { const r = await D.fetch('https://site.api.espn.com/apis/site/v2/sports/' + LG[lg].p + '/summary?event=' + encodeURIComponent(gid), { signal: AbortSignal.timeout(12000) });
    if (r.ok) { const j = await r.json(), h = j && j.header, cp = h && (h.competitions || [])[0]; sure = !!j && typeof j === 'object'; if (h && cp && String(h.id) === String(gid)) g = parseEv({ id: h.id, date: cp.date, status: cp.status, competitions: [cp] }, lg); }
    else if (r.status === 404 || r.status === 400) sure = true; } catch (e) {}
  if (!g && Number.isFinite(kick)) { const d0 = chiDay(kick); for (let i = 2; i <= 11 && !g; i++) { const dd = addDay(d0, i); if (dd > addDay(chiDay(now), 1)) break; g = (await day(lg, dd, ctx)).find((x) => x.id === String(gid)) || null; } }
  else if (!g && !sure) { const d0 = okDay(hint) ? hint : chiDay(now); for (let i = 2; i <= 9 && !g; i++) g = (await day(lg, addDay(d0, i), ctx)).find((x) => x.id === String(gid)) || null; }
  if (!g && !sure && ctx) ctx.fail = true;
  if (g || sure || Number.isFinite(kick)) { FOLLOW.set(k, { at: now, g }); if (FOLLOW.size > 2000) FOLLOW.delete(FOLLOW.keys().next().value); }
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
    return g ? { key, lg: g.lg, gid: g.id, kick: g.start, kind: 'prop', g } : { key, x: lgs.length ? 'Game not found' : 'Not in this contest\'s sport', nf: 1 };
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
    if (!g) { for (const lg of lgs) { g = await follow(lg, String(l.gid), NaN, ctx, d).catch(() => null); if (g) break; } } // not on the day the bet names (a parlay leg next week, a moved game): ask ESPN for the event itself, in EVERY league the contest allows (round 4)
    const NF = { key, x: 'Game not found in ' + lgs.map((x) => LG[x].name).join(' / ') + ' games', nf: 1 }; if (!g) return NF;
    if (ctx && ctx.strict) { // round 4, the add step: the leg must BE that game. The teams it names are that game's teams and the day it names is that game's day (a day either side for time zones).
      const dd = String(l.day || '').slice(0, 10), hs = l.home ? sideIn(g, l.home) : '', as = l.away ? sideIn(g, l.away) : '';
      if ((l.home && !hs) || (l.away && !as) || (hs && hs === as) || (okDay(dd) && Math.abs(Date.parse(dd + 'T12:00:00Z') - Date.parse(chiDay(g.start) + 'T12:00:00Z')) > 1.5 * 864e5)) return NF; }
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
  if (!g || (g.off && !g.canc && D.now() > r.kick - 36e5)) { const f = await follow(r.lg, String(r.gid), r.kick, ctx || {}).catch(() => null); if (f && (!g || f.start !== g.start || f.done || !f.off)) g = f; }
  return Object.assign({}, r, { g: g || undefined });
}
// Stored with a leg: rp / rl / rs (the last pregame reference), ra (when the server read a FULL reference: price, and line for spreads / totals),
// kick (the kickoff as ESPN has it now, followed until the game really starts), pp (the kickoff a game had when ESPN first marked it postponed).
const REFK = ['rp', 'rl', 'rs', 'ra'], FOLK = ['kick', 'pp', 'go'].concat(REFK); // go (round 5, L1) = ESPN showed the game in progress or over
const takeRef = (ref, o) => { ['rp', 'rl', 'rs'].forEach((k) => { if (ref[k] != null) o[k] = ref[k]; }); if (ref.full && ref.at > 0) o.ra = ref.at; };
const store = (r) => { const o = {}, g = r.g; const ref = g && g.state === 'pre' && !g.off && D.now() < g.start ? refOf(r) : null; if (ref) takeRef(ref, r); ['key', 'lg', 'gid', 'kick', 'side', 'kind', 'line', 'ovr', 'over', 'ks', 'lose', 'rp', 'rl', 'rs', 'ra', 'al', 'pp'].forEach((k) => { if (r[k] !== undefined && r[k] !== null && !(typeof r[k] === 'number' && !isFinite(r[k]))) o[k] = r[k]; }); return o; };
// A stored leg read against ESPN again (round 4). Returns only what changed-able: { kick?, pp?, rp?, rl?, rs?, ra? } or null.
//   kick  ESPN's CURRENT start time while the game has not started (a placeholder time that ESPN later fixes, a game flexed to another slot): hidden
//         bets stay hidden, and the reference keeps updating, until the REAL kickoff. Once ESPN shows the game in progress or over it never moves.
//   pp    the game is explicitly postponed: the kickoff it had then is kept for the 48-hour void rule.
//   ref   the pregame reference, only while ESPN shows the game as not started and its start time is still ahead. Nothing read at or after kickoff.
async function refresh(r, ctx, opt) {
  if (!r || !r.gid) return null; ctx = ctx || {}; const now = D.now();
  let g = await findGame([r.lg], String(r.gid), chiDay(r.kick), ctx); if (!g) g = await follow(r.lg, String(r.gid), r.kick, ctx).catch(() => null);
  if (!g) return null; const o = {};
  if (g.off) { if (!g.canc && !(Number(r.pp) > 0)) o.pp = Number(r.kick); return Object.keys(o).length ? o : null; }
  if (g.state !== 'pre' && !r.go) o.go = 1; // round 5 (L1): ESPN itself shows the game started. Other members' bets on it are shown from now on, never from the listed time alone.
  if (Number(r.pp) > 0 && !(opt && opt.carry)) return Object.keys(o).length ? o : null; // postponed, and this contest does not carry postponed games: the bet stays on its original kickoff (void at 48 hours)
  if ((g.state === 'pre' || g.start < Number(r.kick)) && g.start !== Number(r.kick)) o.kick = g.start;
  if (r.kind !== 'prop' && g.state === 'pre' && now < g.start) { const ref = refOf(Object.assign({}, r, { g })); if (ref) takeRef(ref, o); } // a prop (round 5) follows its game's kickoff and start, never a price
  return Object.keys(o).length ? o : null;
}
// REVIEW OF 342da87, FIX 2 (server sleep / restart): the kickoff reference is normally a pregame read inside the 30 minutes before kickoff, made by an add
// or by the 5-minute Groups tick. If the server slept or restarted through that whole window there is no such read. At GRADING time such a leg gets ONE
// fallback: ESPN's event summary (`pickcenter` = the pregame lines ESPN keeps on the event), read only once ESPN shows the game started (or over), one call per
// game, cached 6 hours (a failed call is not cached: tried again on the next pass). Taken as the reference AT KICKOFF (ra = kickoff - 1 minute, rs
// 'espn-pregame'). Only when that has no posted price for the bet's market either is the bet void. The CURRENT / CLOSE price of each block is used (parseOdds).
const PCK = new Map(), PCK_MS = 6 * 36e5;
async function pregameOdds(r) {
  if (!r || !r.gid || !LG[r.lg] || !r.g || !r.g.home) return null; const k = r.lg + '|' + r.gid, c = PCK.get(k), now = D.now(); if (c && now - c.at < PCK_MS) return c.v;
  let v = null;
  try { const res = await D.fetch('https://site.api.espn.com/apis/site/v2/sports/' + LG[r.lg].p + '/summary?event=' + encodeURIComponent(r.gid), { signal: AbortSignal.timeout(12000) });
    if (!res.ok) { if (res.status >= 500 || res.status === 429) return undefined; } else { const j = await res.json(), pc = j && Array.isArray(j.pickcenter) ? j.pickcenter.filter((x) => x && typeof x === 'object') : []; if (pc.length) v = parseOdds({ odds: pc }, r.g.home.abbr, r.g.away.abbr, r.lg); } }
  catch (e) { return undefined; } // undefined = ESPN did not answer: nothing decided, asked again on the next pass
  PCK.set(k, { at: now, v }); if (PCK.size > 2000) PCK.delete(PCK.keys().next().value); return v;
}
// withGame + the fallback above. Returns the leg with its game; when the fallback found a full reference, also rp / rl / rs / ra (the caller stores them).
async function withRef(r, ctx) {
  const w = await withGame(r, ctx); if (!w || w.x || !w.gid || w.kind === 'prop' || !eqv(w) || refOk(w) || !kicked(w) || w.g.canc || w.cv) return w;
  const O = await pregameOdds(w); if (O === undefined) return Object.assign(w, { refWait: 1 }); if (!O) return w; /* refWait: the caller does not grade this pass */ const ra = Number(w.kick) - 6e4, ref = refOf(Object.assign({}, w, { g: Object.assign({}, w.g, { odds: O, at: ra }) }));
  if (!ref || !ref.full || ref.rs !== 'espn') return w; return Object.assign(w, { rp: ref.rp, rl: ref.rl, rs: 'espn-pregame', ra });
}
// The void rule (the only way a bet is voided besides the commissioner's void, which follows the same rules). Returns '' or the reason.
//   cancelled / forfeited: void right away. Postponed, suspended or moved to a later time: void once 48 hours have passed since the ORIGINAL kickoff
//   without a final score, unless the contest carries postponed games to their new date (opt.carry, set before the start); a carried game that is
//   still not played when the contest ends (opt.endAt) is void.
const VOID = 'Void: the game was postponed or cancelled and not played within 48 hours';
const k0Of = (r) => (Number(r.pp) > 0 ? Number(r.pp) : Number.isFinite(Number(r.kick)) ? Number(r.kick) : r.g ? r.g.start : NaN); // the kickoff the 48 hours count from
const VOIDC = 'Void: the game was cancelled', VOIDE = 'Void: the game was postponed and not played before the contest ended';
const VOIDCM = 'Void: the commissioner voided this game for everyone (postponed or cancelled)';
function voidWhy(r, opt) {
  if (r && r.cv) return VOIDCM + (r.cv.why ? ': ' + String(r.cv.why).slice(0, 120) : ''); // round 5 (M4): the commissioner's void is on the GAME, stored on every member's leg at once
  const g = r && r.g; if (!g) return ''; opt = opt || {}; const now = D.now(), kick = k0Of(r);
  if (g.canc) return VOIDC;
  if (!g.off && !(Number(r.pp) > 0)) return ''; // round 4: only an explicit postponed status (now, or seen earlier and stored as pp). A moved time alone is not "postponed".
  if (opt.carry) return (!g.done || g.off) && opt.endAt && now > opt.endAt ? VOIDE : '';
  if (g.done && !g.off && g.start <= kick + 48 * 36e5) return ''; // played within the 48 hours after all
  return now > kick + 48 * 36e5 ? VOID : '';
}
const isVoid = (r, opt) => !!voidWhy(r, opt);
// Result of one resolved leg from the final score: 'won' | 'lost' | 'push' | '' (not final yet). Postponed / cancelled is checked BEFORE final.
function legResult(r, opt) {
  if (r.cv) return 'push'; const g = r.g; if (!g) return ''; if (voidWhy(r, opt)) return 'push';
  if (!(opt && opt.carry) && (g.off || (Number(r.pp) > 0 && g.start > k0Of(r) + 48 * 36e5))) return ''; // waiting out the 48 hours
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
  // Round 5 (H2): a prop is tied to its game (kind 'prop'). The server never grades the prop itself; it only voids it with its game (cancelled, postponed
  // past 48 hours, or the commissioner's game void), exactly like every other bet on that game.
  if (legs.length === 1 && legs[0] && !legs[0].x && legs[0].kind === 'prop') { const vr = voidWhy(legs[0], opt); return vr ? { res: 'push', pl: 0, vr } : { x: 'Player prop' }; }
  if (b.kind === 'prop' && !b.kt) return { x: 'Player prop' };
  if (legs.some((r) => r.x)) return { x: legs.find((r) => r.x).x };
  if (b.kind === 'parlay') {
    const pw = parlayWhy(legs); if (pw) return { x: pw, rule: 1 };
    const L = Array.isArray(b.legs) ? b.legs : [], n = legs.length, own = L.length === n && L.every((l) => okPrice(Number(l.o)));
    const m = b.src === 'kalshi' ? Number(b.mult) : Number(b.mult) > 1 ? Number(b.mult) : null, hasM = m > 1 && m <= 1001;
    if (!own && !hasM) return { x: 'Parlay with no payout' };
    const P = legs.map((r, i) => legPrice(r, own ? pmOf(Number(L[i].o)) : null, MX)); // every leg passes the rule on its own
    const badLeg = P.find((p) => p.x); if (badLeg) return { x: 'A leg does not count: ' + badLeg.x, rule: 1 };
    // Round 4: a leg with no posted price at its kickoff voids the WHOLE parlay (a cancelled / postponed leg still only drops out). Nothing is decided
    // while a leg's price is not settled yet (its game has not started), so a parlay is never called lost and then void.
    // ROUND 5 (M5): A PARLAY THAT ALREADY HAS A LOSING LEG IS A LOSS. A leg that had its price at kickoff and lost settles the parlay as lost the moment
    // that game is final, whatever happens to the legs still to come (a later leg with no price changes nothing). A no-price leg voids the parlay only
    // when no priced leg has lost. The first of the two to happen is stored and never re-decided.
    const v0 = legs.map((r) => voidWhy(r, opt)), rs = legs.map((r) => legResult(r, opt));
    if (legs.some((r, i) => !v0[i] && !P[i].v && rs[i] === 'lost')) return { res: 'lost', pl: -stake };
    if (legs.some((r, i) => !v0[i] && P[i].v && kicked(r))) return { res: 'push', pl: 0, vr: NOREFP, nr: 1 };
    if (legs.some((r, i) => !v0[i] && P[i].v)) return { res: '' };
    if (rs.some((r) => !r)) return { res: '' };
    const vs = legs.map((r) => voidWhy(r, opt)), live = rs.filter((r) => r !== 'push').length, vr = vs.some(Boolean) ? (vs.every(Boolean) ? vs[0] : 'A leg is void (' + vs.find(Boolean).replace(/^Void: /, '') + '): that leg drops out') : '';
    if (!live) return Object.assign({ res: 'push', pl: 0 }, vr ? { vr } : {});
    let d = rs.reduce((a, r, i) => (r === 'push' ? a : a * (1 + P[i].pm)), 1); // the product of the graded leg prices
    if (hasM) d = Math.min(d, live < n ? Math.pow(m, live / n) : m); // the typed multiplier only when it is lower
    d = Math.min(d, 1 + MX / 100); // ROUND 5 (M3): "Longest odds that count" caps the WHOLE parlay. +500 = at most 6x the stake back in total, however many legs.
    return Object.assign({ res: 'won', pl: Math.round(stake * (d - 1) * 100) / 100, px: Math.round(d * 100) / 100 }, vr ? { vr } : {});
  }
  const typed = priceMult(b); if (typed == null) { const r0 = legResult(legs[0], opt); return r0 === 'lost' ? { res: 'lost', pl: -stake } : r0 ? { x: 'Odds Oddable cannot use', rule: 1 } : { res: '' }; } // a price nobody can use never wins (and the add step refuses it)
  const gv = voidWhy(legs[0], opt), p = gv ? { pm: 0 } : legPrice(legs[0], typed, MX); if (p.x) return { x: p.x, rule: 1 };
  if (p.v) return kicked(legs[0]) ? { res: 'push', pl: 0, vr: NOREF, nr: 1 } : { res: '' }; // round 4: no reference at kickoff = void, told plainly; before the real kickoff nothing is decided
  const r = legResult(legs[0], opt); if (!r) return { res: '' };
  const pa = amOfPm(p.pm); // the price the bet was graded at (shown to the player)
  if (r === 'lost') return { res: 'lost', pl: -stake, pa }; if (r === 'push') { const vr = voidWhy(legs[0], opt); return Object.assign({ res: 'push', pl: 0 }, vr ? { vr } : {}); }
  return { res: 'won', pl: Math.round(stake * p.pm * 100) / 100, ref: p.ref, pa };
}
// Is a game window open for any of these leagues right now (a game in progress, or one starting within 2 hours)? Used for the light server tick.
async function windowOpen(lgs, ctx) {
  const now = D.now(), d = chiDay(now);
  for (const lg of lgs) for (const dd of [d, addDay(d, 1)]) { const gs = await day(lg, dd, ctx); if (gs.some((g) => (g.state === 'in') || (g.start > now - 15 * 6e4 && g.start < now + 2 * 36e5))) return true; }
  return false;
}
module.exports = { withRef, pregameOdds, freshGame, FRESH_MS, VOIDCM, FOLK, REFWIN, NOREF, NOREFP, refOk, kicked, k0Of, amOfPm, REFK, VOID, VOIDC, VOIDE, voidWhy, eqv, legPrice, altPm, lineWhy, addWhy, lineFar, parlayWhy, refresh, follow, better, tolOf, TOLS, mlFromSpread, pmOf, impl, refOf, parseOdds, fav, TOL, LINE_TOL, LG, LGS, normLg, parseKt, ktLeague, ktType, legKey, resolveLeg, withGame, store, legResult, gradeBet, priceMult, windowOpen, day, chiDay, okDay, addDay, NFLAB, _deps: D, _reset: () => { PCK.clear(); DAYC.clear(); FLY.clear(); BYID.clear(); FOLLOW.clear(); FFLY.clear(); } };
