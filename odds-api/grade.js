// Oddable Groups: the SERVER grades bets from ESPN final scores (Nov 16 2026, review fix 1 + owner decision G12 "these groups are for all games").
// Nothing a phone says about a result is trusted here: side, line/total, the bet's own odds and stake come from the bet as it was BEFORE kickoff
// (groups.js freezes it), the score comes from ESPN. Same ESPN scoreboard paths the app already uses (pics/index.html xlLoad / xlSports, sports.html).
// Bets this file cannot grade (props, Kalshi markets it cannot map to a game, cash-outs, legs with no game) return {x: reason}; a contest counts
// them only with the commissioner's honor-system rule on.
const D = { fetch: (...a) => fetch(...a), now: () => Date.now() };
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
  return { lg, id: String(e.id), start, state: String(st.state || 'pre'), done: !!st.completed && String(st.state) === 'post', off: /POSTPON|CANCEL|SUSPEND|FORFEIT/i.test(name), home: side(h), away: side(a) };
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
    const g = await findGame(lgs, String(l.gid), d, ctx); if (!g) return { key, x: 'Game not found in ' + lgs.map((x) => LG[x].name).join(' / ') + ' games' };
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
// A stored leg resolution (no game object) -> the same with its current game attached (scores), for grading.
async function withGame(r, ctx) { if (!r || r.x || !r.gid) return r; const g = await findGame([r.lg], String(r.gid), chiDay(r.kick), ctx); return Object.assign({}, r, { g: g || undefined }); }
const store = (r) => { const o = {}; ['key', 'lg', 'gid', 'kick', 'side', 'kind', 'line', 'ovr', 'over', 'ks', 'lose'].forEach((k) => { if (r[k] !== undefined && r[k] !== null && !(typeof r[k] === 'number' && !isFinite(r[k]))) o[k] = r[k]; }); return o; };
// Result of one resolved leg from the final score: 'won' | 'lost' | 'push' | '' (not final yet)
function legResult(r) {
  const g = r.g; if (!g || !g.done || g.home.score == null || g.away.score == null) return '';
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
const dec = (a) => (a < 0 ? 1 + 100 / -a : 1 + a / 100);

// Grade a frozen bet snapshot. legs = resolved legs (same order as the bet's legs). Returns
//   { res: 'won'|'lost'|'push', pl } (pl uncapped, for the whole stake) when final, { res: '' } when not final yet, { x: reason } when it cannot be graded.
function gradeBet(b, legs) {
  const stake = Number(b.stake); if (!(stake > 0 && stake <= 1e6)) return { x: 'No stake' };
  if (b.kind === 'prop' && !b.kt) return { x: 'Player prop' };
  if (b.cash != null || Number(b.soldN) > 0) return { x: 'Cashed out on Kalshi (Oddable cannot check the sale)' };
  if (legs.some((r) => r.x)) return { x: legs.find((r) => r.x).x };
  if (b.kind === 'parlay') {
    const rs = legs.map(legResult);
    if (rs.some((r) => r === 'lost')) return { res: 'lost', pl: -stake };
    if (rs.some((r) => !r)) return { res: '' };
    const n = rs.length, live = rs.filter((r) => r !== 'push').length;
    if (!live) return { res: 'push', pl: 0 };
    if (b.src === 'kalshi' && live < n) return { x: 'Kalshi combo with a void leg (Oddable cannot check its payout)' };
    const L = Array.isArray(b.legs) ? b.legs : [];
    let d; // own leg prices when every leg has one (v253 parlay rule: product of the legs' decimal prices); else the parlay's own multiplier, a pushed leg dropping out
    if (L.length === n && L.every((l) => okPrice(Number(l.o)))) d = L.reduce((a, l, i) => (rs[i] === 'push' ? a : a * dec(Number(l.o))), 1);
    else { const m = b.src === 'kalshi' ? Number(b.mult) : Number(b.mult) > 1 ? Number(b.mult) : null; if (!(m > 1 && m <= 1001)) return { x: 'Parlay with no payout' }; d = live < n ? Math.pow(m, live / n) : m; }
    return { res: 'won', pl: Math.round(stake * (d - 1) * 100) / 100 };
  }
  const r = legResult(legs[0]); if (!r) return { res: '' };
  if (r === 'lost') return { res: 'lost', pl: -stake }; if (r === 'push') return { res: 'push', pl: 0 };
  const pm = priceMult(b); if (pm == null) return { x: 'Odds Oddable cannot use' };
  return { res: 'won', pl: Math.round(stake * pm * 100) / 100 };
}
// Is a game window open for any of these leagues right now (a game in progress, or one starting within 2 hours)? Used for the light server tick.
async function windowOpen(lgs, ctx) {
  const now = D.now(), d = chiDay(now);
  for (const lg of lgs) for (const dd of [d, addDay(d, 1)]) { const gs = await day(lg, dd, ctx); if (gs.some((g) => (g.state === 'in') || (g.start > now - 15 * 6e4 && g.start < now + 2 * 36e5))) return true; }
  return false;
}
module.exports = { LG, LGS, normLg, parseKt, ktLeague, ktType, legKey, resolveLeg, withGame, store, legResult, gradeBet, priceMult, windowOpen, day, chiDay, okDay, addDay, NFLAB, _deps: D, _reset: () => { DAYC.clear(); FLY.clear(); BYID.clear(); } };
