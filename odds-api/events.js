// Oddable LOCAL EVENTS (v1, Nov 16 2026): games people run themselves with no live feed (pickleball first; also tennis club nights, cornhole, darts, bowling, pool...).
// Results are typed in by each match's designated scorer and confirmed by the opponent; disputes go to the commissioner. Every change is in an audit trail.
// Formats: round robin (+ optional single-elimination playoff of the top N), single elimination, double elimination (with bracket reset), ladder,
// heads-up challenges (best of 1/3/5, also as side matches), and bracket pick'em for spectators (a layer on any bracket / round robin event).
// Works ON ITS OWN (create, invite with ?join=e.<code>) or INSIDE A GROUP as contest type 'local-event' (see ADAPTER at the bottom and HANDOFF.md).
// MONEY IS INFORMATION ONLY: entry, main/side pot, commissioner's take and split are shown; Oddable never collects, holds or pays money.
// Storage (Supabase oddable_sync, 'lock:' prefix keeps rows out of player lists): 'lock:evt:<id>' one row per event; 'lock:evtidx' index (code, title, member keys).
// Every write is conditional on `updated` (dbPatchIf): read -> change -> write only if nobody wrote in between, else redo (no lost score entries).
const crypto = require('crypto');
const D = {
  S: require('./sync'),
  acct: () => require('./acct'),
  now: () => Date.now(),
  ip: (req) => require('./ip').clientIp(req),
  enterprise: async (accountKey) => false, // STAND-IN: the Groups branch owns the real owner-granted `enterprise` flag (odds-api/limits.js)
  // H1 / E-H (owner Nov 16 2026): the rating module. The stats branch's own (odds-api/stats.js: ratingFor, eventSetup, eventOverride, eventLog) when it is
  // in the build, else the STAND-IN at the bottom of this file with the same names, arguments and result shapes.
  rt: () => { const m = realMod('./stats'); return m && ['ratingFor', 'eventSetup', 'eventOverride', 'eventLog'].every((f) => typeof m[f] === 'function') ? m : STAND; },
  pairing: () => realFn('./pairing', 'suggestPartners'), // P1 shared contract suggestPartners(players, {mode, teamSize, history}) (odds-api/pairing.js; stand-in in this branch)
};
function realMod(mod) { try { return require(mod); } catch (e) { return null; } }
function realFn(mod, fn) { try { const m = require(mod); return m && typeof m[fn] === 'function' ? m[fn] : null; } catch (e) { return null; } }
// STAND-IN for the Groups branch's shared `limits` module (same names and signature: maxPeople(accountKey, groupOrGameId), ENTERPRISE_TEXT).
// Standard accounts: 8 people per game, organizer included. Enterprise (owner-granted: courses, clubs, leagues) lifts the cap.
// At merge: `const limits = require('./limits')` and call `limits.maxPeople(limits.keyOf(evt.ce), evt.id)` in capFor() below (limits.js hashes the account id).
const ENT_MAX = Math.max(8, Math.min(5000, Math.round(Number(process.env.ENTERPRISE_MAX_PEOPLE) || 500)));
const limits = {
  maxPeople: async (accountKey, groupOrGameId) => ((await D.enterprise(accountKey)) ? ENT_MAX : 8),
  ENTERPRISE_TEXT: 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.',
};
const capFor = (accountId, gameId) => limits.maxPeople(accountId, gameId || '');
const fullMsg = (cap) => 'This game is full: ' + cap + ' people max, counting the organizer, players and spectators. ' + limits.ENTERPRISE_TEXT; // owner: "8 people per group, all games"
const ROW = (id) => 'lock:evt:' + id, IDX = 'lock:evtidx', DAY = 864e5;
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const bad = (status, error) => Object.assign(new Error(error), { status });
const body = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 30000) c.push(d); }); req.on('end', () => { if (n > 30000) return no(bad(413, 'Too big')); try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(bad(400, 'Bad request')); } }); req.on('error', no); });
const clone = (o) => JSON.parse(JSON.stringify(o));
const cleanName = (n, max) => String(n == null ? '' : n).replace(/[<>&"'`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 30);
const chiDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const okDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;
function chiStart(day) { for (const off of ['-05:00', '-06:00']) { const t = Date.parse(day + 'T00:00:00' + off); if (chiDay(t) === day && chiDay(t - 1) !== day) return t; } return Date.parse(day + 'T06:00:00Z'); }
const chiEnd = (day) => chiStart(new Date(Date.parse(day + 'T12:00:00Z') + DAY).toISOString().slice(0, 10)) - 1;
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPH[b[i] % 32]; return s; };
const newCode = () => rnd(4) + '-' + rnd(4); // 40 random bits; lookups are rate-limited and wrong guesses blocked
const normCode = (c) => { const x = String(c || '').toUpperCase().replace(/^E\./, '').replace(/[^A-Z0-9]/g, ''); return x.length === 8 ? x.slice(0, 4) + '-' + x.slice(4) : ''; };
const sameCode = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const mkOf = (e) => crypto.createHash('sha256').update('oddable-event|' + e).digest('hex').slice(0, 24);

// ---------- rules ----------
const SPORTS = ['pickleball', 'tennis', 'basketball', 'golf', 'cornhole', 'darts', 'bowling', 'pool', 'other'];
const STAT_SPORT = { pickleball: 'pickleball', tennis: 'tennis', golf: 'golf' }; // stats contract sports (stats.js SPORTS); the rest are 'other' with extra.game
const FMTS = ['rr', 'se', 'de', 'ladder', 'h2h', 'solo'];
const FMTN = { rr: 'Round robin', se: 'Single elimination', de: 'Double elimination', ladder: 'Ladder', h2h: 'Heads-up challenges', solo: 'Solo / skills score' };
const UNITS = { singles: 1, doubles: 2, mixed: 2, teams: 4 };
const SPLITS = { '100': [100], '60/30/10': [60, 30, 10], '50/30/20': [50, 30, 20], '70/30': [70, 30], none: [] };
function cleanRules(b, now) {
  const title = cleanName(b.title, 40); if (title.length < 2) throw bad(400, 'Give the event a name (2+ characters)');
  const sport = String(b.sport || ''); if (!SPORTS.includes(sport)) throw bad(400, 'Pick a sport');
  const fmt = String(b.fmt || ''); if (!FMTS.includes(fmt)) throw bad(400, 'Pick a format');
  const unit = String(b.unit || 'singles'); if (!(unit in UNITS)) throw bad(400, 'Pick singles, doubles, mixed or teams');
  const start = Number(b.start); if (!Number.isFinite(start) || start < now + (fmt === 'solo' ? -5 * 6e4 : 60e3)) throw bad(400, 'The start must be in the future'); // a solo / practice score can start now
  if (start > now + 400 * DAY) throw bad(400, 'The start is too far away');
  const P = sport === 'pickleball' && fmt !== 'solo';
  const to = Math.round(Number(b.to)); if (P ? ![11, 15, 21].includes(to) : !(to >= 0 && to <= 999)) throw bad(400, P ? 'Games go to 11, 15 or 21' : 'Points to win: 0 (highest score wins) to 999');
  const winBy = Number(b.winBy || (P ? 2 : 1)); if (![1, 2].includes(winBy) || (P && winBy !== 2)) throw bad(400, P ? 'Pickleball games are win by 2' : 'Win by 1 or 2');
  const bestOf = Number(b.bestOf || 1); if (![1, 3, 5].includes(bestOf)) throw bad(400, 'Matches are best of 1, 3 or 5 games');
  const scoring = P ? (b.scoring === 'sideout' ? 'sideout' : 'rally') : ''; // label only: the app does not count rallies
  const seeding = ['rating', 'oddable', 'random', 'manual'].includes(b.seeding) ? b.seeding : null; if (!seeding) throw bad(400, 'Pick how players are seeded');
  const courts = Math.round(Number(b.courts == null ? 1 : b.courts)); if (!(courts >= 1 && courts <= 32)) throw bad(400, 'Courts: 1 to 32');
  const tset = sport === 'tennis' && fmt !== 'solo' && to > 0 && winBy === 2; // tennis set: to 6 (or 4 / 8), win by 2, one tiebreak game at to-to (7-6)
  const R = { tset, unit, to, winBy, bestOf, scoring, seeding, courts, scorer: ['a', 'either', 'comm'].includes(b.scorer) ? b.scorer : 'a', side: !!b.side };
  if (fmt === 'rr') { R.pools = Math.round(Number(b.pools == null ? 1 : b.pools)); if (!(R.pools >= 1 && R.pools <= 8)) throw bad(400, 'Pools: 1 to 8'); R.playoff = Math.round(Number(b.playoff || 0)); if (![0, 2, 4, 8, 16].includes(R.playoff)) throw bad(400, 'Playoff: none, top 2, 4, 8 or 16'); if (R.playoff && R.playoff < R.pools) throw bad(400, 'The playoff must take at least one from each pool'); }
  if (fmt === 'ladder') { R.reach = Math.round(Number(b.reach || 3)); if (!(R.reach >= 1 && R.reach <= 10)) throw bad(400, 'Challenge reach: 1 to 10 spots'); R.expDays = Math.round(Number(b.expDays || 7)); if (!(R.expDays >= 1 && R.expDays <= 30)) throw bad(400, 'Challenges expire after 1 to 30 days'); R.expire = b.expire === 'void' ? 'void' : 'forfeit'; R.move = b.move === 'shift' ? 'shift' : 'swap'; }
  if (fmt === 'solo') { R.low = !!b.low; R.unitLabel = cleanName(b.unitLabel, 16) || 'points'; }
  let endDay = null; if (fmt === 'ladder' || fmt === 'h2h' || fmt === 'solo') { endDay = String(b.endDay || ''); if (!okDay(endDay) || chiEnd(endDay) < start || chiStart(endDay) - start > 200 * DAY) throw bad(400, 'Pick a last day (after the start, within 200 days)'); }
  R.pickem = !!b.pickem && ['rr', 'se', 'de'].includes(fmt); if (R.pickem) R.weight = b.weight === 'round' ? 'round' : 'flat';
  const entry = Number(b.entry || 0); if (!(Number.isFinite(entry) && entry >= 0 && entry <= 10000 && Math.round(entry) === entry)) throw bad(400, 'Entry must be a whole dollar amount from 0 to 10,000');
  const split = String(b.split || 'none'); if (!(split in SPLITS)) throw bad(400, 'Pick a payout split');
  const tk = b.take || {}, kind = String(tk.kind || 'none'); let tv = 0;
  if (kind === 'pct') { tv = Number(tk.v); if (!(Number.isInteger(tv) && tv >= 0 && tv <= 50)) throw bad(400, "Commissioner's take: a whole percent from 0 to 50"); }
  else if (kind === 'flat') { tv = Number(tk.v); if (!(Number.isFinite(tv) && tv >= 0 && Math.round(tv * 100) === Math.round(tv * 100 * 1000) / 1000)) throw bad(400, "Commissioner's take: a dollar amount, not negative"); tv = Math.round(tv * 100) / 100; }
  else if (kind !== 'none') throw bad(400, "Pick the commissioner's take");
  const money = { entry, pot: b.pot === 'side' ? 'side' : 'main', split, take: { kind, v: kind === 'none' ? 0 : tv } };
  const join = { self: b.self !== false, spectators: b.spectators !== false || R.pickem };
  return { title, sport, fmt, start, endDay, rules: R, money, join };
}
// Pickleball: game to 11/15/21, win by 2 (a game past the target ends exactly 2 ahead). Other sports: to 0 = higher score wins; win by 1 or 2.
function checkGames(R, games) {
  if (!Array.isArray(games) || games.length < 1 || games.length > R.bestOf) throw bad(400, 'Enter 1 to ' + R.bestOf + ' game scores');
  const need = Math.ceil(R.bestOf / 2); let wa = 0, wb = 0, pa = 0, pb = 0; const out = [];
  games.forEach((g, i) => {
    if (!Array.isArray(g) || g.length !== 2) throw bad(400, 'Game ' + (i + 1) + ': two scores');
    const [x, y] = g.map(Number); if (![x, y].every((v) => Number.isInteger(v) && v >= 0 && v <= 999)) throw bad(400, 'Game ' + (i + 1) + ': whole numbers 0 to 999');
    if (x === y) throw bad(400, 'Game ' + (i + 1) + ': a game cannot end in a tie');
    if (wa >= need || wb >= need) throw bad(400, 'The match was already decided before game ' + (i + 1));
    const w = Math.max(x, y), l = Math.min(x, y);
    const G = 'Game ' + (i + 1) + ': ';
    if (R.tset) { if (!((w === R.to && l <= R.to - 2) || (w === R.to + 1 && l >= R.to - 1))) throw bad(400, (R.bestOf > 1 ? 'Set ' + (i + 1) + ': ' : G) + 'a set ends ' + R.to + '-' + (R.to - 2) + ' or better, ' + (R.to + 1) + '-' + (R.to - 1) + ' or ' + (R.to + 1) + '-' + R.to + ' (tiebreak)'); }
    else if (R.to && R.winBy === 1) { if (w < R.to) throw bad(400, G + 'the winner needs ' + R.to); if (l >= R.to) throw bad(400, G + 'the game ended when someone reached ' + R.to); } // e.g. cornhole: 23-15 is fine (going over is allowed), 23-21 is not
    else if (R.to) { if (w < R.to) throw bad(400, G + 'the winner needs ' + R.to); if (w - l < R.winBy) throw bad(400, G + 'win by ' + R.winBy); if (w > R.to && w - l !== R.winBy) throw bad(400, G + 'past ' + R.to + ' a game ends ' + R.winBy + ' ahead (e.g. ' + (w) + '-' + (w - R.winBy) + ')'); }
    if (x > y) wa++; else wb++; pa += x; pb += y; out.push([x, y]);
  });
  if (wa < need && wb < need) throw bad(400, 'Best of ' + R.bestOf + ': someone needs ' + need + ' game' + (need > 1 ? 's' : ''));
  return { games: out, win: wa > wb ? 'a' : 'b', pa, pb };
}

// ---------- draw: seeding, schedules, brackets ----------
function seedOrder(P) { let a = [1, 2]; while (a.length < P) { const n = a.length * 2 + 1, x = []; a.forEach((s) => x.push(s, n - s)); a = x; } return a.slice(0, P); }
function seedList(evt) {
  const E = evt.entrants.slice(), R = evt.rules;
  const typed = (e) => (e.rating != null ? e.rating : -1), odd = R.seeding === 'oddable' || (evt.sport === 'pickleball' && R.seeding === 'rating'); // H1: pickleball "by rating" = the Oddable rating
  // Seeds come from the rating module's `use` (tournament rating, else Oddable rating, else the 1500 start). Equal numbers: real results before a new player's 1500, then the typed number (e.g. DUPR, shown only).
  const u = (e) => (odd && Number.isFinite(e.or) ? e.or : null);
  if (odd) E.sort((a, b) => (u(b) != null) - (u(a) != null) || (u(a) != null ? u(b) - u(a) : 0) || (b.orReal ? 1 : 0) - (a.orReal ? 1 : 0) || typed(b) - typed(a) || a.at - b.at);
  else if (R.seeding === 'rating') E.sort((a, b) => typed(b) - typed(a) || a.at - b.at);
  else if (R.seeding === 'random') { for (let i = E.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [E[i], E[j]] = [E[j], E[i]]; } }
  return E.map((e) => e.eid); // manual = the order the commissioner entered (or moved) them
}
// Round robin, circle method. Odd count: a bye each round (exactly one entrant sits out per round, each entrant sits once).
function roundRobin(ids) {
  const L = ids.slice(); if (L.length % 2) L.push(null); const n = L.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pr = []; for (let i = 0; i < n / 2; i++) { const a = L[i], b = L[n - 1 - i]; pr.push(r % 2 && i === 0 ? [b, a] : [a, b]); }
    rounds.push(pr); L.splice(1, 0, L.pop());
  }
  return rounds; // [[ [a,b] | [a,null] ]]
}
// Courts: matches of one round fill courts 1..C; more matches than courts = a second wave on the same courts.
function placeCourts(list, courts) { list.forEach((m, k) => { m.court = (k % courts) + 1; m.wave = Math.floor(k / courts) + 1; }); }
let MID = 0;
const mkMatch = (o) => Object.assign({ id: o.id, a: null, b: null, state: 'wait', games: [], v: 0, win: null }, o);
// Single / double elimination by feeders: {seed:k} or {m:matchId, t:'W'|'L'}. Byes ('BYE') advance automatically.
function buildElim(n, stage, de) {
  let k = 1; while ((1 << k) < n) k++; const P = 1 << k, ord = seedOrder(P), M = [], id = (s, r, i) => stage + s + r + '.' + i;
  for (let r = 1; r <= k; r++) for (let i = 0; i < P >> r; i++) M.push(mkMatch({ id: id('w', r, i), st: stage === 'p' ? 'po' : 'w', r, i, fa: r === 1 ? { seed: ord[2 * i] - 1 } : { m: id('w', r - 1, 2 * i), t: 'W' }, fb: r === 1 ? { seed: ord[2 * i + 1] - 1 } : { m: id('w', r - 1, 2 * i + 1), t: 'W' } }));
  if (!de) return { M, k, P };
  for (let j = 1; j <= k - 1; j++) {
    const cnt = P >> (j + 1), ro = 2 * j - 1, re = 2 * j;
    for (let i = 0; i < cnt; i++) M.push(mkMatch({ id: id('l', ro, i), st: 'l', r: ro, i, fa: j === 1 ? { m: id('w', 1, 2 * i), t: 'L' } : { m: id('l', ro - 1, 2 * i), t: 'W' }, fb: j === 1 ? { m: id('w', 1, 2 * i + 1), t: 'L' } : { m: id('l', ro - 1, 2 * i + 1), t: 'W' } }));
    for (let i = 0; i < cnt; i++) M.push(mkMatch({ id: id('l', re, i), st: 'l', r: re, i, fa: { m: id('l', ro, i), t: 'W' }, fb: { m: id('w', j + 1, j % 2 ? cnt - 1 - i : i), t: 'L' } })); // drop-ins flipped on alternate rounds to avoid early rematches
  }
  const lbChamp = k === 1 ? { m: id('w', 1, 0), t: 'L' } : { m: id('l', 2 * k - 2, 0), t: 'W' };
  M.push(mkMatch({ id: stage + 'gf', st: 'gf', r: 1, i: 0, fa: { m: id('w', k, 0), t: 'W' }, fb: lbChamp }));
  M.push(mkMatch({ id: stage + 'gf2', st: 'gf', r: 2, i: 0, reset: true, fa: { m: stage + 'gf', t: 'A' }, fb: { m: stage + 'gf', t: 'B' } })); // bracket reset: only played if the losers-bracket champion wins the first final
  return { M, k, P };
}
const winnerOf = (m) => (m.win === 'a' ? m.a : m.win === 'b' ? m.b : undefined);
const loserOf = (m) => (m.win === 'a' ? m.b : m.win === 'b' ? m.a : undefined);
const DONE = new Set(['confirmed', 'bye', 'void']);
const PLAYED = new Set(['pending', 'confirmed', 'disputed']);
// Fill bracket sides from feeders until nothing changes. Matches not yet played are recomputed every time (so a commissioner correction re-flows).
function advance(evt) {
  const byId = {}; evt.matches.forEach((m) => (byId[m.id] = m));
  const seedsOf = (stage) => (stage === 'p' ? evt.poSeeds || [] : evt.seeds || []);
  let changed = true, guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    evt.matches.forEach((m) => {
      if (!m.fa || PLAYED.has(m.state) || m.live) return;
      const side = (f) => { if (f.seed != null) { const s = seedsOf(m.id[0]); return f.seed < s.length ? s[f.seed] : 'BYE'; } const src = byId[f.m]; if (!src || !DONE.has(src.state)) return undefined; if (f.t === 'A') return src.a; if (f.t === 'B') return src.b; return f.t === 'W' ? winnerOf(src) : loserOf(src); };
      let a = side(m.fa), b = side(m.fb), st = 'wait', win = null;
      if (m.reset) { const gf = byId[m.fa.m]; if (gf && DONE.has(gf.state)) { if (gf.win === 'a' || gf.state === 'bye') { st = 'void'; a = gf.a; b = gf.b; } else st = 'ready'; } else { a = undefined; b = undefined; } }
      else if (a !== undefined && b !== undefined) { if (a === 'BYE' || b === 'BYE') { st = 'bye'; win = a === 'BYE' ? (b === 'BYE' ? 'a' : 'b') : 'a'; } else st = 'ready'; }
      const na = a === undefined ? null : a, nb = b === undefined ? null : b;
      if (m.a !== na || m.b !== nb || m.state !== st || m.win !== win) { Object.assign(m, { a: na, b: nb, state: st, win }); if (st !== 'bye') m.games = []; changed = true; }
    });
  }
}
function draw(evt, now) {
  if (evt.drawn) return; const ids = seedList(evt); if (ids.length < (evt.fmt === 'solo' ? 1 : 2)) throw bad(409, 'Needs at least 2 ' + (evt.rules.unit === 'singles' ? 'players' : 'entries') + ' to make the draw');
  evt.seeds = ids; evt.drawn = now; evt.matches = []; evt.byes = {}; const R = evt.rules;
  if (evt.fmt === 'rr') {
    const pools = Math.min(R.pools, Math.floor(ids.length / 2)) || 1, P = Array.from({ length: pools }, () => []);
    ids.forEach((id, i) => { const row = Math.floor(i / pools), c = i % pools; P[row % 2 ? pools - 1 - c : c].push(id); }); // snake: seeds spread evenly over the pools
    evt.pools = P; const byR = {};
    P.forEach((pl, pi) => roundRobin(pl).forEach((pairs, r) => pairs.forEach(([a, b], i) => { if (a === null || b === null) { (evt.byes[r + 1] = evt.byes[r + 1] || []).push(a === null ? b : a); return; } const m = mkMatch({ id: 'rr' + (pi + 1) + '.' + (r + 1) + '.' + i, st: 'pool', pool: pi, r: r + 1, i, a, b, state: 'ready' }); evt.matches.push(m); (byR[r + 1] = byR[r + 1] || []).push(m); })));
    Object.keys(byR).forEach((r) => placeCourts(byR[r], R.courts));
    if (evt.matches.length > 600) throw bad(400, 'Too many matches for one round robin. Use more pools.');
  } else if (evt.fmt === 'se' || evt.fmt === 'de') {
    evt.matches = buildElim(ids.length, 'x', evt.fmt === 'de').M; advance(evt); courtsElim(evt);
  } else if (evt.fmt === 'ladder') evt.ladder = { order: ids.slice() };
  else if (evt.fmt === 'solo') evt.solo = evt.solo || {};
  audit(evt, now, 'Commissioner', 'draw', null, (evt.fmt === 'ladder' ? 'Ladder set: ' : 'Draw made: ') + ids.length + ' entries, seeded ' + (R.seeding === 'oddable' || (evt.sport === 'pickleball' && R.seeding === 'rating') ? 'by Oddable rating' : R.seeding === 'rating' ? 'by rating' : R.seeding === 'random' ? 'at random' : 'as entered'));
}
function courtsElim(evt) { const by = {}; evt.matches.filter((m) => m.fa && !m.court).forEach((m) => { const k = m.st + m.r; (by[k] = by[k] || []).push(m); }); Object.values(by).forEach((l) => placeCourts(l, evt.rules.courts)); }

// ---------- standings ----------
// Pool play tiebreaks, in order: (1) match wins; (2) head-to-head: wins in the matches played only among the entries tied on wins (a mini-table);
// (3) point differential over all pool matches; (4) points scored; (5) seed. Only confirmed results count.
function poolTable(evt, ids, pool) {
  const T = {}; ids.forEach((id) => (T[id] = { eid: id, w: 0, l: 0, pf: 0, pa: 0, gw: 0, gl: 0, n: 0 }));
  const ms = evt.matches.filter((m) => m.st === 'pool' && (pool == null || m.pool === pool) && m.state === 'confirmed');
  ms.forEach((m) => { const A = T[m.a], B = T[m.b]; if (!A || !B) return; m.games.forEach(([x, y]) => { A.pf += x; A.pa += y; B.pf += y; B.pa += x; if (x > y) { A.gw++; B.gl++; } else { B.gw++; A.gl++; } }); A.n++; B.n++; if (m.win === 'a') { A.w++; B.l++; } else { B.w++; A.l++; } });
  const seedIx = (id) => (evt.seeds || []).indexOf(id), rows = Object.values(T); rows.forEach((r) => (r.diff = r.pf - r.pa));
  // Review fix 10b: within a group tied on wins, head-to-head (wins among the tied only) is applied; whenever a later tiebreak (differential, points)
  // splits off part of the group, head-to-head is applied AGAIN among those still tied (standard re-apply rule). Seed is the last resort.
  const h2hIn = (grp) => { const S = new Set(grp.map((r) => r.eid)), o = {}; grp.forEach((r) => (o[r.eid] = 0)); ms.forEach((m) => { if (S.has(m.a) && S.has(m.b)) o[winnerOf(m)]++; }); return o; };
  const splitBy = (grp, f) => { const by = new Map(); grp.forEach((r) => { const k = f(r); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }); return [...by.entries()].sort((a, b) => b[0] - a[0]).map((x) => x[1]); };
  function order(grp, depth) {
    if (grp.length <= 1 || depth > 20) return grp.slice().sort((a, b) => seedIx(a.eid) - seedIx(b.eid));
    const H = h2hIn(grp); grp.forEach((r) => (r.h2h = H[r.eid]));
    const hp = splitBy(grp, (r) => H[r.eid]); if (hp.length > 1) return [].concat(...hp.map((p) => order(p, depth + 1)));
    for (const f of [(r) => r.diff, (r) => r.pf]) { const parts = splitBy(grp, f); if (parts.length > 1) return order(parts[0], depth + 1).concat(order([].concat(...parts.slice(1)), depth + 1)); } // the best is placed, the rest start over at head-to-head
    return grp.slice().sort((a, b) => seedIx(a.eid) - seedIx(b.eid));
  }
  const out = [].concat(...splitBy(rows, (r) => r.w).map((g) => order(g, 0)));
  out.forEach((r, i) => (r.rank = i + 1)); return out;
}
function h2hTable(evt) { // heads-up / ladder records (all confirmed non-pool matches, side matches included)
  const T = {}; evt.entrants.forEach((e) => (T[e.eid] = { eid: e.eid, w: 0, l: 0, pf: 0, pa: 0 }));
  evt.matches.filter((m) => (m.st === 'h2h' || m.st === 'lad' || m.st === 'side') && m.state === 'confirmed').forEach((m) => { const A = T[m.a], B = T[m.b]; if (!A || !B) return; m.games.forEach(([x, y]) => { A.pf += x; A.pa += y; B.pf += y; B.pa += x; }); if (m.win === 'a') { A.w++; B.l++; } else { B.w++; A.l++; } });
  const rows = Object.values(T); rows.forEach((r) => (r.diff = r.pf - r.pa)); rows.sort((a, b) => b.w - a.w || a.l - b.l || b.diff - a.diff); rows.forEach((r, i) => (r.rank = i + 1)); return rows;
}
// Places for a bracket: champion 1st, then by how late each entry was knocked out (entries out in the same round share a place).
function elimPlaces(evt, stage) {
  const ms = evt.matches.filter((m) => m.fa && m.id[0] === stage), fin = ms.find((m) => m.st === 'gf' && m.reset && m.state === 'confirmed') || ms.find((m) => m.st === 'gf' && !m.reset && m.state === 'confirmed' && m.win === 'a') || ms.find((m) => (m.st === 'w' || m.st === 'po') && !ms.some((x) => (x.fa && x.fa.m === m.id) || (x.fb && x.fb.m === m.id)) && m.state === 'confirmed');
  if (!fin) return null; const out = {}; const key = (m) => (m.st === 'gf' ? 10000 + m.r : m.st === 'l' ? 100 + m.r * 2 : m.r * (evt.fmt === 'de' ? 0 : 1)), elim = [];
  const champ = winnerOf(fin); ms.filter((m) => m.state === 'confirmed').forEach((m) => { const lo = loserOf(m); if (!lo || lo === 'BYE') return; if (evt.fmt === 'de' && m.st === 'w') return; if (m.st === 'gf' && !m.reset && m.win === 'b') return; elim.push([lo, key(m)]); });
  const all = [[champ, Infinity]].concat(elim.filter(([e]) => e !== champ)); const kv = {}; all.forEach(([e, k]) => { if (kv[e] == null || k > kv[e]) kv[e] = k; });
  const ks = Object.entries(kv); ks.forEach(([e, k]) => (out[e] = 1 + ks.filter(([, k2]) => k2 > k).length)); return out;
}
function places(evt, now) { // {eid: place} once the event is finished, else null
  if (!evt.drawn) return null;
  if (evt.fmt === 'se' || evt.fmt === 'de') return elimPlaces(evt, 'x');
  if (evt.fmt === 'rr') {
    const pool = evt.matches.filter((m) => m.st === 'pool'); if (pool.some((m) => m.state !== 'confirmed')) return null;
    const tables = (evt.pools || []).map((p, i) => poolTable(evt, p, i)), merged = [].concat(...tables).sort((a, b) => a.rank - b.rank || b.w - a.w || b.diff - a.diff || b.pf - a.pf);
    if (!evt.rules.playoff) { const o = {}; merged.forEach((r, i) => (o[r.eid] = i + 1)); return o; }
    const po = elimPlaces(evt, 'p'); if (!po) return null; const o = Object.assign({}, po), n = Object.keys(po).length; merged.filter((r) => !(r.eid in po)).forEach((r, i) => (o[r.eid] = n + i + 1)); return o;
  }
  if (evt.done || (evt.endDay && now > chiEnd(evt.endDay))) { const o = {}; if (evt.fmt === 'solo') { soloRows(evt).forEach((r) => (o[r.eid] = r.place)); return o; } if (evt.fmt === 'ladder') evt.ladder.order.forEach((e, i) => (o[e] = i + 1)); else h2hTable(evt).forEach((r) => (o[r.eid] = r.rank)); return o; }
  return null;
}
function soloRows(evt) { // solo / skills: one score per entry (latest entered); higher wins unless the commissioner chose lower-is-better
  const S = evt.solo || {}, rows = evt.entrants.filter((e) => S[e.eid]).map((e) => ({ eid: e.eid, name: e.name, score: S[e.eid].v, at: S[e.eid].at, ver: !!S[e.eid].ver }));
  rows.sort((a, b) => (evt.rules.low ? a.score - b.score : b.score - a.score) || a.at - b.at); rows.forEach((r, i) => (r.place = i && rows[i - 1].score === r.score ? rows[i - 1].place : i + 1)); return rows;
}
function maybePlayoff(evt, now) { // round robin: when every pool match is confirmed, the top N go to a single-elimination playoff
  if (evt.fmt !== 'rr' || !evt.rules.playoff || evt.poSeeds || !evt.drawn) return;
  const pool = evt.matches.filter((m) => m.st === 'pool'); if (!pool.length || pool.some((m) => m.state !== 'confirmed')) return;
  const tables = evt.pools.map((p, i) => poolTable(evt, p, i)), per = Math.ceil(evt.rules.playoff / tables.length), seeds = [];
  const tiers = []; for (let r = 0; r < per; r++) tiers.push(tables.map((t) => t[r]).filter(Boolean).sort((a, b) => b.w - a.w || b.diff - a.diff || b.pf - a.pf).map((x) => x.eid)); // pool winners first, then 2nd places...
  tiers.forEach((t) => t.forEach((e) => seeds.push(e)));
  evt.poSeeds = crossPool(evt, tiers, evt.rules.playoff); if (evt.poSeeds.length < 2) return;
  buildElim(evt.poSeeds.length, 'p', false).M.forEach((m) => evt.matches.push(m)); advance(evt); courtsElim(evt);
  audit(evt, now, 'Oddable', 'playoff', null, 'Pool play done. Playoff: top ' + evt.poSeeds.length);
}
// Review fix 7: reorder players within each finishing tier (2nd places, 3rd places...) so round one of the playoff pairs players from different pools
// whenever possible (2 pools, top 4: A1 v B2, B1 v A2). Tier by tier, the order with the fewest same-pool first-round pairs wins; ties keep the record order.
function crossPool(evt, tiers, n) {
  const poolOf = {}; (evt.pools || []).forEach((p, i) => p.forEach((e) => (poolOf[e] = i)));
  let k = 1; while ((1 << k) < n) k++; const ord = seedOrder(1 << k), pairs = []; for (let i = 0; i < ord.length; i += 2) pairs.push([ord[i] - 1, ord[i + 1] - 1]);
  const clash = (list) => pairs.filter(([x, y]) => x < list.length && y < list.length && list[x] != null && list[y] != null && poolOf[list[x]] === poolOf[list[y]]).length;
  const perms = (a) => (a.length <= 1 ? [a] : a.length > 7 ? [a] : a.flatMap((x, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).map((p) => [x].concat(p))));
  let done = [];
  tiers.forEach((t, ti) => { if (ti === 0) { done = t.slice(); return; } let best = t, bc = Infinity; for (const p of perms(t)) { const c = clash(done.concat(p).slice(0, n)); if (c < bc) { bc = c; best = p; if (!c) break; } } done = done.concat(best); });
  return done.slice(0, n);
}
function ladderApply(evt, m) { // winner takes the higher spot: swap (the two trade places) or shift (challenger takes the spot, everyone between moves down one)
  if (m.win !== 'a') return; const o = evt.ladder.order, ia = o.indexOf(m.a), ib = o.indexOf(m.b); if (ia < 0 || ib < 0 || ib > ia) return;
  if (evt.rules.move === 'swap') { o[ia] = m.b; o[ib] = m.a; } else { o.splice(ia, 1); o.splice(ib, 0, m.a); }
}
// Runs on every read and write: auto-draw at the start, expired ladder challenges, playoff creation.
function tick(evt, now) {
  const sig = () => JSON.stringify([evt.drawn, evt.matches.map((m) => m.state + m.a + m.b), evt.ladder, evt.fin || 0]), before = sig();
  if (!evt.drawn && now >= evt.start && evt.entrants.length >= (evt.fmt === 'solo' ? 1 : 2)) { try { draw(evt, now); } catch (e) {} }
  if (evt.fmt === 'ladder') evt.matches.filter((m) => m.st === 'lad' && m.state === 'ready' && m.exp && now > m.exp).forEach((m) => {
    if (evt.rules.expire === 'void') { m.state = 'void'; audit(evt, now, 'Oddable', 'expired', m.id, 'Challenge expired, cancelled'); }
    else { m.state = 'confirmed'; m.win = 'a'; m.forfeit = true; m.at = now; m.pp = { a: seats(evt, m.a), b: seats(evt, m.b) }; ladderApply(evt, m); audit(evt, now, 'Oddable', 'forfeit', m.id, 'Challenge not played in ' + evt.rules.expDays + ' days: challenger wins by forfeit'); }
  });
  maybePlayoff(evt, now);
  if (!evt.fin) { const pl = places(evt, now); if (pl && (evt.fmt === 'se' || evt.fmt === 'de' || evt.fmt === 'rr' || evt.done || now > chiEnd(evt.endDay))) { evt.fin = now; evt.places = pl; cancelOpen(evt, now); } }
  return sig() !== before;
}
// Review fix 4: at the finish every challenge / side match not yet confirmed is cancelled (a score waiting for confirmation included); results are final.
function cancelOpen(evt, now) { evt.matches.forEach((m) => { if ((m.st === 'lad' || m.st === 'h2h' || m.st === 'side') && ['offered', 'ready', 'pending', 'disputed'].includes(m.state)) { m.state = 'void'; m.v++; audit(evt, now, 'Oddable', 'cancel', m.id, 'Event finished: challenge cancelled'); } }); }
const notFin = (evt) => { if (evt.fin || evt.done) throw bad(409, 'The event is finished. Results are final.'); };
function audit(evt, now, who, a, m, s) { evt.audit = evt.audit || []; evt.audit.push({ t: now, who: cleanName(who, 30), a, m: m || null, s: String(s || '').slice(0, 160) }); if (evt.audit.length > 400) evt.audit.splice(0, evt.audit.length - 400); }

// ---------- money (information only) ----------
const cents = (x) => Math.round(Number(x) * 100);
function potSummary(evt) {
  const M = evt.money, pl = evt.members.filter((m) => m.role !== 'spectator'), paid = pl.filter((m) => m.paid).length, potC = cents(M.entry) * paid;
  const takeC = M.take.kind === 'pct' ? Math.round(potC * M.take.v / 100) : M.take.kind === 'flat' ? Math.min(cents(M.take.v), potC) : 0, poolC = potC - takeC, sp = SPLITS[M.split] || [];
  const parts = sp.map((p) => Math.floor(poolC * p / 100)); if (parts.length) parts[0] += poolC - parts.reduce((a, x) => a + x, 0);
  return { pot: M.pot, entry: M.entry, players: pl.length, paid, total: potC / 100, take: takeC / 100, takeKind: M.take.kind, takeV: M.take.v, pool: poolC / 100, split: M.split, places: parts.map((c, i) => ({ place: i + 1, pct: sp[i], amt: c / 100 })) };
}
const takeText = (M) => (M.take.kind === 'pct' && M.take.v ? 'Commissioner keeps ' + M.take.v + '% of the pot' : M.take.kind === 'flat' && M.take.v ? 'Commissioner keeps $' + (Number.isInteger(M.take.v) ? M.take.v : M.take.v.toFixed(2)) + ' of the pot' : 'Commissioner keeps nothing');

// ---------- people (cap: 8 per game for standard accounts, organizer included) ----------
// People = every account in the event (organizer, players, spectators) + the typed-in players of entries that nobody has claimed yet.
function people(evt) { const n = evt.members.length; let typed = 0; evt.entrants.forEach((e) => { typed += (e.players || []).filter((p) => !p.pid).length; }); return n + typed; }
async function capOf(evt) { return capFor(evt.ce, evt.id); }

// ---------- rate limits ----------
const RL = new Map();
function limit(key, n, ms) { const t = D.now(), a = (RL.get(key) || []).filter((x) => t - x < ms); if (a.length >= n) { RL.set(key, a); return true; } a.push(t); RL.set(key, a); if (RL.size > 20000) { let k = 0; for (const x of RL.keys()) { RL.delete(x); if (++k > 5000) break; } } return false; }
const LIM = { create: [6, 3600e3, 15, 3600e3], join: [30, 600e3, 60, 600e3], score: [60, 600e3, 200, 600e3], peek: [30, 600e3, 40, 600e3] };
function rate(kind, who, ip) { const L = LIM[kind]; if (limit(kind + '|a|' + who, L[0], L[1]) || limit(kind + '|i|' + ip, L[2], L[3])) throw bad(429, 'Too many tries. Wait a few minutes.'); }
const codeFail = (k) => { const t = D.now(), a = (RL.get(k) || []).filter((x) => t - x < 900e3); a.push(t); RL.set(k, a); };
const codeBlocked = (k) => (RL.get(k) || []).filter((x) => D.now() - x < 900e3).length >= 10;

// ---------- storage ----------
async function load(id) { if (!/^[A-Z2-9]{10}$/.test(String(id || ''))) return null; const r = await D.S.dbGet(ROW(id)); return r && r.data && !r.data.deleted ? r : null; } // review fix 10a: a deleted event is gone
async function mutateRow(rowId, init, fn) {
  for (let i = 0; i < 6; i++) {
    let row = await D.S.dbGet(rowId);
    if (!row) { if (!init) throw bad(404, 'Event not found'); await D.S.dbPut({ id: rowId, salt: 'x', pinhash: 'x', data: init(), updated: 1 }, true); row = await D.S.dbGet(rowId); if (!row) continue; }
    const data = clone(row.data || {}); const out = await fn(data);
    if (out && out.nochange) return out.v;
    if (await D.S.dbPatchIf(rowId, row.updated, data, Math.max(D.now(), Number(row.updated || 0) + 1))) return out;
  }
  throw bad(409, 'Busy, try again');
}
// H1: the Oddable rating (Elo from app play, unofficial) is THE rating for pickleball seeding, pairings and fair matches; other sports use it when the
// commissioner picks "By Oddable rating". Every seat asks the rating module: ratingFor(userKey, sport, {eventId}) -> {oddable: {rating, matches}, event,
// setBy, use}. Events seeds and pairs from `use` (the director's tournament rating when one is set, else the Oddable rating, else the 1500 start) and keeps
// both numbers on the seat so the real-results rating is always shown next to a tournament rating (E-H addendum). Refreshed on every read / write until the
// draw, then frozen (what the draw used). userKey = the account id, or 'guest:<seat id>' for a player typed in by name.
const usesOdd = (evt) => !!evt.rules && evt.fmt !== 'solo' && (evt.sport === 'pickleball' || evt.rules.seeding === 'oddable');
const ratingSport = (evt) => STAT_SPORT[evt.sport] || 'other';
const seatKey = (evt, p) => { const m = p.pid && evt.members.find((x) => x.pid === p.pid); return m ? m.ak : 'guest:' + String(p.gid).toLowerCase(); };
const useR = (p) => (Number.isFinite(p.use) ? p.use : null);
function entryRatings(evt) { evt.entrants.forEach((e) => { const ps = (e.players || []).filter((p) => !isBlank(p)), rs = ps.map(useR).filter(Number.isFinite); e.or = rs.length ? Math.round(rs.reduce((a, x) => a + x, 0) / rs.length) : null; e.orReal = ps.some((p) => Number.isFinite(p.or) || Number.isFinite(p.tv)); }); }
async function prepRatings(evt) {
  if (evt.drawn || !usesOdd(evt)) return; const RT = D.rt();
  for (const e of evt.entrants) for (const p of e.players || []) { if (isBlank(p)) { delete p.or; delete p.use; delete p.tv; continue; } let r = null; try { r = await RT.ratingFor(seatKey(evt, p), ratingSport(evt), { eventId: evt.id }); } catch (x) { r = null; }
    const od = (r && r.oddable) || {}, num = (v) => (v != null && Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
    p.or = num(od.rating); p.orn = Number(od.matches) || 0; p.tv = r && r.setBy === 'tournament' ? num(r.event) : null; p.tat = p.tv != null ? r.at || null : null; p.treason = p.tv != null ? cleanName(r.reason, 120) : null; p.use = r ? num(r.use) : null; }
  entryRatings(evt);
}
const mutate = (id, fn) => mutateRow(ROW(id), null, async (data) => { const now = D.now(); await prepRatings(data); const t = tick(data, now); const out = await fn(data, now); if (out && out.nochange) { if (t) { data.u = now; return out.v; } return out; } tick(data, now); data.u = now; return out; });
const idxSet = (id, f) => mutateRow(IDX, () => ({ ev: {} }), async (data) => { data.ev = data.ev || {}; const r = f(data.ev[id] ? clone(data.ev[id]) : null); if (r === undefined) return { nochange: true }; if (r === null) delete data.ev[id]; else data.ev[id] = r; return {}; });
const idxEntry = (evt) => ({ c: evt.code, t: evt.title, mk: evt.members.map((m) => m.mk), s: evt.start, e: evt.endDay || null, f: evt.fin || 0, g: evt.group ? evt.group.gid : null });
async function byCode(code) { const ix = await D.S.dbGet(IDX), ev = (ix && ix.data && ix.data.ev) || {}; let hit = null; Object.keys(ev).forEach((id) => { if (ev[id].c && sameCode(ev[id].c, code)) hit = id; }); return hit; }

// ---------- views (what each person may see) ----------
const nameOf = (evt, eid) => { if (eid === 'BYE') return 'Bye'; const e = evt.entrants.find((x) => x.eid === eid); return e ? e.name : null; };
const isBlank = (p) => !p.pid && (p.blank || /^(Partner \d|Open seat)$/.test(p.name || '')); // pre-fix rows: placeholder names
const pidsOf = (e) => ((e && e.players) || []).filter((p) => p.pid).map((p) => p.pid);
const memberOf = (evt, mk) => evt.members.find((m) => m.mk === mk);
const isComm = (evt, mk) => evt.comm === mk;
const sideOf = (evt, mk, m) => { const me = memberOf(evt, mk); if (!me) return null; const A = evt.entrants.find((e) => e.eid === m.a), B = evt.entrants.find((e) => e.eid === m.b); if (A && pidsOf(A).includes(me.pid)) return 'a'; if (B && pidsOf(B).includes(me.pid)) return 'b'; return null; };
const linked = (evt, eid) => { const e = evt.entrants.find((x) => x.eid === eid); return !!(e && pidsOf(e).length); };
const locked = (m, now) => !!m.live || PLAYED.has(m.state) || DONE.has(m.state) || (m.start && now >= m.start);
// Review fix 6: pick'em locks a whole ROUND when its first match starts (Start tap) or gets a score. Byes and cancelled matches do not count.
const roundKey = (m) => m.id[0] + '|' + m.st + '|' + m.r;
const pickLocked = (evt, m, now) => locked(m, now) || evt.matches.some((x) => x !== m && roundKey(x) === roundKey(m) && (x.live || PLAYED.has(x.state) || x.state === 'confirmed'));
function pub(evt, now) {
  return { id: evt.id, title: evt.title, sport: evt.sport, fmt: evt.fmt, fmtName: FMTN[evt.fmt], start: evt.start, endDay: evt.endDay, rules: evt.rules, money: evt.money, join: evt.join, takeText: takeText(evt.money), pot: potSummary(evt),
    entries: evt.entrants.length, people: people(evt), commName: (evt.members.find((m) => m.mk === evt.comm) || {}).name || '', started: now >= evt.start, drawn: !!evt.drawn, locked: now >= evt.start || !!evt.drawn, fin: evt.fin || 0, inGroup: !!evt.group, entText: limits.ENTERPRISE_TEXT };
}
function full(evt, mk, now, cap) {
  const o = pub(evt, now), me = memberOf(evt, mk), comm = isComm(evt, mk); o.role = comm ? 'comm' : me ? me.role : 'none'; o.me = me ? me.pid : null; o.code = evt.code; o.cap = cap; o.u = evt.u || 0;
  o.myEntries = me ? evt.entrants.filter((e) => pidsOf(e).includes(me.pid)).map((e) => e.eid) : [];
  const seedIx = (id) => (evt.seeds || []).indexOf(id), odd = usesOdd(evt);
  o.entrants = evt.entrants.map((e) => ({ eid: e.eid, name: e.name, rating: e.rating == null ? null : e.rating, seed: seedIx(e.eid) + 1 || null, linked: pidsOf(e).length, open: (e.players || []).filter((p) => !p.pid).length, oddRating: e.or == null ? null : e.or,
    players: (e.players || []).map((p) => Object.assign({ gid: p.gid, name: p.name, guest: !p.pid, me: !!(me && p.pid === me.pid), blank: isBlank(p) }, comm && !p.pid ? { claim: evt.code + '.' + p.ct } : {},
      odd && !isBlank(p) ? { odd: Number.isFinite(p.or) ? { rating: p.or, matches: p.orn || 0 } : null, trn: Number.isFinite(p.tv) ? { v: p.tv, at: p.tat || null, reason: p.treason || '' } : null, use: useR(p) } : {})) }));
  o.odd = odd; o.ent = cap > 8; o.tlog = (evt.tlog || []).slice(-100).reverse(); o.teams = UNITS[evt.rules.unit] > 1 && evt.fmt !== 'solo';
  o.members = evt.members.map((m) => ({ pid: m.pid, name: m.name, role: m.role, paid: !!m.paid, comm: m.mk === evt.comm }));
  o.matches = evt.matches.map((m) => { const s = sideOf(evt, mk, m); return { id: m.id, st: m.st, r: m.r, pool: m.pool, court: m.court, wave: m.wave, a: m.a, b: m.b, an: nameOf(evt, m.a), bn: nameOf(evt, m.b), state: m.state, games: m.games, win: m.win, v: m.v, live: !!m.live, start: m.start || null, exp: m.exp || null, forfeit: !!m.forfeit, reset: !!m.reset,
    sub: m.sub ? { side: m.sub.side, games: m.sub.games, by: m.sub.by, at: m.sub.at, note: m.sub.note || '' } : null, mine: s, canScore: canScore(evt, mk, m, now).ok, canConfirm: canConfirm(evt, mk, m).ok, needsComm: m.state === 'disputed' || (m.state === 'pending' && !linked(evt, m.sub && m.sub.side === 'a' ? m.b : m.a)) }; });
  o.byes = evt.byes || {}; o.pools = evt.pools || null;
  if (evt.fmt === 'rr' && evt.drawn) o.tables = (evt.pools || []).map((p, i) => poolTable(evt, p, i).map((r) => Object.assign(r, { name: nameOf(evt, r.eid) })));
  if (evt.fmt === 'h2h' || evt.fmt === 'ladder' || evt.rules.side) o.records = h2hTable(evt).map((r) => Object.assign(r, { name: nameOf(evt, r.eid) }));
  if (evt.fmt === 'solo') o.solo = soloRows(evt);
  if (evt.ladder) o.ladder = evt.ladder.order.map((e, i) => ({ eid: e, name: nameOf(evt, e), rank: i + 1 }));
  o.places = evt.places || places(evt, now); o.placeRows = o.places ? Object.entries(o.places).map(([e, p]) => ({ eid: e, name: nameOf(evt, e), place: p })).sort((a, b) => a.place - b.place) : null;
  if (evt.rules.pickem) o.pickem = pickemView(evt, me, now);
  o.flags = comm ? evt.matches.filter((m) => m.state === 'disputed' || (m.state === 'pending' && !linked(evt, m.sub.side === 'a' ? m.b : m.a))).length : 0;
  o.audit = (evt.audit || []).slice(-120).reverse();
  return o;
}

// ---------- scoring permissions ----------
function canScore(evt, mk, m, now) {
  if (evt.fin || evt.done) return { ok: false, why: 'The event is finished. Results are final.' };
  if (!evt.drawn && m.st !== 'h2h' && m.st !== 'side') return { ok: false, why: 'The draw is not made yet' };
  if (isComm(evt, mk)) {
    if (m.state === 'wait' || m.state === 'bye' || m.state === 'void' || m.state === 'offered') return { ok: false, why: 'This match is not ready' };
    const own = sideOf(evt, mk, m); // review fix 1: a commissioner who plays never makes their own score final, except on a dispute or against a guest with no account
    if (own && linked(evt, own === 'a' ? m.b : m.a) && !(m.state === 'ready' || m.state === 'disputed')) return { ok: false, why: m.state === 'pending' ? 'Waiting for the other side to confirm your score' : 'Your own match: only a dispute reopens it' };
    return { ok: true };
  }
  if (m.state !== 'ready') return { ok: false, why: m.state === 'pending' ? 'A score is waiting for confirmation' : m.state === 'disputed' ? 'Disputed: the commissioner decides' : 'This match is not ready' };
  const s = sideOf(evt, mk, m); if (!s) return { ok: false, why: 'Only the players in this match (or the commissioner) enter its score' };
  const R = evt.rules; if (R.scorer === 'comm') return { ok: false, why: 'The commissioner enters every score in this event' };
  if (R.scorer === 'a' && s !== 'a' && linked(evt, m.a)) return { ok: false, why: nameOf(evt, m.a) + ' keeps score for this match' };
  return { ok: true, side: s };
}
function canConfirm(evt, mk, m) {
  if (evt.fin || evt.done) return { ok: false };
  if (m.state !== 'pending' || !m.sub) return { ok: false };
  const s = sideOf(evt, mk, m); if (s && s === m.sub.side) return { ok: false }; // nobody confirms their own side's score, the commissioner included
  if (s) return { ok: true }; return isComm(evt, mk) ? { ok: true, comm: true } : { ok: false };
}
const seats = (evt, eid) => { const e = evt.entrants.find((x) => x.eid === eid); return e ? (e.players || []).map((p) => ({ gid: p.gid, pid: p.pid || null, name: p.name })) : []; };
function settle(evt, m, now) { // a confirmed result takes effect. The people on each side are frozen on the match (doubles: both players), for per-player ratings / point differentials
  m.pp = { a: seats(evt, m.a), b: seats(evt, m.b) };
  if (m.st === 'lad') ladderApply(evt, m);
  advance(evt); courtsElim(evt); maybePlayoff(evt, now);
}

// ---------- pick'em (spectators and players pick every match before it starts) ----------
function pickPoints(evt, m) { if (evt.rules.weight !== 'round') return 1; if (m.st === 'gf') return 4; if (m.st === 'w' || m.st === 'po') return Math.pow(2, m.r - 1); return 1; }
const finalMatch = (evt) => { const ms = evt.matches.filter((m) => m.fa); if (!ms.length) return null; const gf2 = ms.find((m) => m.reset && m.state === 'confirmed'); if (gf2) return gf2; const gf = ms.find((m) => m.st === 'gf' && !m.reset); if (gf) return gf; const stage = ms.some((m) => m.id[0] === 'p') ? 'p' : 'x'; return ms.filter((m) => m.id[0] === stage && (m.st === 'w' || m.st === 'po')).sort((a, b) => b.r - a.r)[0]; };
function pickTable(evt) {
  const P = evt.picks || {}, fm = finalMatch(evt), total = fm && fm.state === 'confirmed' ? fm.games.reduce((a, [x, y]) => a + x + y, 0) : null;
  const rows = Object.keys(P).map((pid) => { const p = P[pid]; let pts = 0, right = 0, n = 0; evt.matches.forEach((m) => { const k = p.m && p.m[m.id]; if (!k || m.state !== 'confirmed') return; n++; if (k.s === m.win && !m.forfeit) { right++; pts += pickPoints(evt, m); } else if (k.s === m.win) { right++; pts += pickPoints(evt, m); } }); return { pid, name: (evt.members.find((x) => x.pid === pid) || {}).name || 'Player', pts, right, n, tb: p.tb == null ? null : p.tb, tbOff: total == null || p.tb == null ? null : Math.abs(p.tb - total), last: p.last || 0 }; });
  // Tiebreak: closest guess of the final's total points (all games of the final added up), then whoever finished their picks earlier.
  rows.sort((a, b) => b.pts - a.pts || (a.tbOff == null ? 1e9 : a.tbOff) - (b.tbOff == null ? 1e9 : b.tbOff) || a.last - b.last || a.name.localeCompare(b.name));
  rows.forEach((r, i) => (r.place = i + 1)); return { rows, finalTotal: total };
}
function pickemView(evt, me, now) {
  const P = evt.picks || {}, mine = me && P[me.pid] ? P[me.pid] : { m: {} }, t = pickTable(evt), cnt = {};
  evt.matches.forEach((m) => { if (!pickLocked(evt, m, now)) return; let a = 0, b = 0; Object.values(P).forEach((p) => { const k = p.m && p.m[m.id]; if (k && k.s === 'a') a++; else if (k && k.s === 'b') b++; }); cnt[m.id] = { a, b }; }); // others' picks only as counts, and only once the match is locked
  const fm = finalMatch(evt), tbOpen = !!evt.fin || !!(fm && pickLocked(evt, fm, now)); // review fix 8: others' tiebreak guesses only once the final has locked
  return { mine: mine.m || {}, tb: mine.tb == null ? null : mine.tb, table: t.rows.map((r) => (tbOpen || (me && r.pid === me.pid) ? r : Object.assign({}, r, { tb: null }))), finalTotal: t.finalTotal, counts: cnt, open: evt.matches.filter((m) => m.state === 'ready' && !pickLocked(evt, m, now) && m.a && m.b && m.a !== 'BYE' && m.b !== 'BYE').map((m) => m.id) };
}

// ---------- routes ----------
async function me(req) { const e = D.acct().who(req); if (!e) throw bad(401, 'Sign in to run or join an event'); return { e, mk: mkOf(e) }; }
const newPid = (evt) => { let p; do { p = rnd(6); } while (evt.members.some((m) => m.pid === p)); return p; };
const newEid = (evt) => { let p; do { p = rnd(5); } while (evt.entrants.some((m) => m.eid === p)); return p; };
// An entry = one player, a pair or a team. Each seat is a player: an account (pid) or a GUEST typed in by name (guest id + secret claim token,
// so the guest can later claim those results into an account; see the 'claim' route). Names typed "Ann / Bob" become two guests.
function addEntrant(evt, name, rating, by, now, players) {
  const size = UNITS[evt.rules.unit] || 1; let nm = cleanName(name, 40); const typed = (Array.isArray(players) ? players : size > 1 ? String(name || '').split(/\s*(?:\/|&|\+| and )\s*/i) : [name]).map((x) => cleanName(x, 24)).filter(Boolean).slice(0, size);
  if (!nm && typed.length) nm = typed.join(' / '); if (nm.length < 1) throw bad(400, 'Type a name');
  if (evt.entrants.some((e) => e.name.toLowerCase() === nm.toLowerCase())) throw bad(409, 'That name is already in the event');
  let r = null; if (rating !== '' && rating != null) { r = Number(rating); if (!(Number.isFinite(r) && r >= 0 && r <= 9999)) throw bad(400, 'Rating: a number from 0 to 9999 (e.g. DUPR 4.25)'); r = Math.round(r * 1000) / 1000; }
  const pl = []; for (let i = 0; i < size; i++) pl.push(Object.assign({ gid: 'g' + rnd(8), ct: rnd(10), name: typed[i] || (i ? 'Partner ' + (i + 1) : nm), pid: null }, typed[i] || !i ? {} : { blank: true })); // blank = an unnamed partner spot anyone with the link may take (review fix 2); named seats need their claim code
  const e = { eid: newEid(evt), name: nm, rating: r, players: pl, at: now, by }; evt.entrants.push(e); return e;
}
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (!path.startsWith('/events')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  try {
    const b = await body(req), ip = D.ip(req), op = path.slice(8);
    if (op === 'peek') { // PUBLIC: a shared link shows only the event's title and kind before sign-up
      rate('peek', 'ip', ip); if (codeBlocked('ec|i|' + ip)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.');
      const code = normCode(b.code), id = code ? await byCode(code) : null, evt = id ? (await load(id) || {}).data : null;
      if (!evt) { codeFail('ec|i|' + ip); throw bad(404, 'No event with that code'); }
      send(res, 200, { title: evt.title, kind: FMTN[evt.fmt] + ' · ' + evt.sport }); return true;
    }
    const u = await me(req), now = D.now();
    if (op === 'mine') {
      const ix = await D.S.dbGet(IDX), ev = (ix && ix.data && ix.data.ev) || {}, out = [];
      for (const id of Object.keys(ev)) { if (!(ev[id].mk || []).includes(u.mk)) continue; const r = await load(id); if (!r) continue; const evt = r.data; tick(evt, now); const o = pub(evt, now), m = memberOf(evt, u.mk); o.role = isComm(evt, u.mk) ? 'comm' : m ? m.role : 'none'; const mp = m && evt.places ? evt.entrants.filter((e) => pidsOf(e).includes(m.pid)).map((e) => evt.places[e.eid]).filter(Boolean)[0] : null; o.myPlace = mp || null; o.todo = evt.matches.filter((x) => canConfirm(evt, u.mk, x).ok || (x.state === 'ready' && canScore(evt, u.mk, x, now).ok && sideOf(evt, u.mk, x))).length; out.push(o); if (out.length >= 40) break; }
      out.sort((a, c) => (a.fin ? 1 : 0) - (c.fin ? 1 : 0) || a.start - c.start); send(res, 200, { events: out, now }); return true;
    }
    if (op === 'create') {
      rate('create', u.mk, ip); const R = cleanRules(b, now), cap = await capFor(u.e, '');
      const nm = cleanName(b.myName, 24) || 'Organizer'; let id; do { id = rnd(10); } while (await D.S.dbGet(ROW(id)));
      const evt = Object.assign({ id, code: newCode(), comm: u.mk, ce: u.e, created: now, u: now, members: [], entrants: [], matches: [], picks: {}, audit: [], ops: [] }, R);
      evt.members.push({ pid: newPid(evt), mk: u.mk, ak: u.e, name: nm, role: 'comm', joined: now, paid: false });
      const list = Array.isArray(b.entrants) ? b.entrants.slice(0, ENT_MAX) : []; list.forEach((x) => addEntrant(evt, x && x.name, x && x.rating, u.mk, now));
      if (b.playIn) { const e = addEntrant(evt, b.entryName || nm, b.myRating, u.mk, now); e.players[0].pid = evt.members[0].pid; e.players[0].name = nm; }
      if (people(evt) > cap) throw bad(403, fullMsg(cap));
      if (cap > 8 && usesOdd(evt)) { try { await D.rt().eventSetup(u.e, id, { title: evt.title, sport: ratingSport(evt), lockAt: evt.start }); } catch (x) { if (!x.status) console.error('events eventSetup:', x.message); } } // E-H: register the Enterprise tournament with the rating module
      await prepRatings(evt); audit(evt, now, nm, 'create', null, 'Event created'); tick(evt, now);
      await D.S.dbPut({ id: ROW(id), salt: 'x', pinhash: 'x', data: evt, updated: now }, true); await idxSet(id, () => idxEntry(evt));
      send(res, 200, { event: full(evt, u.mk, now, cap) }); return true;
    }
    if (op === 'preview' || op === 'join') {
      if (codeBlocked('ec|a|' + u.mk) || codeBlocked('ec|i|' + ip)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.');
      rate('join', u.mk, ip); const code = normCode(b.code), id = code ? await byCode(code) : null;
      if (!id) { codeFail('ec|a|' + u.mk); codeFail('ec|i|' + ip); throw bad(404, 'No event with that code'); }
      if (op === 'preview') { const r = await load(id); if (!r) throw bad(404, 'No event with that code'); const evt = r.data; tick(evt, now); const cap = await capOf(evt); const o = memberOf(evt, u.mk) ? full(evt, u.mk, now, cap) : Object.assign(pub(evt, now), { role: 'none', cap, open: !evt.join.self ? [] : evt.entrants.filter((e) => (e.players || []).some(isBlank)).map((e, i) => ({ eid: e.eid, name: pidsOf(e).length ? e.name : 'Open spot ' + (i + 1), open: (e.players || []).filter(isBlank).length, seats: (e.players || []).filter(isBlank).map((p) => ({ gid: p.gid, name: 'Partner spot' })) })) }); send(res, 200, { event: o }); return true; }
      const r0 = await load(id), cap = r0 ? await capOf(r0.data) : 8, as = b.as === 'spectator' ? 'spectator' : 'player', nm = cleanName(b.myName, 24) || 'Player';
      const evt = await mutate(id, (evt, now) => {
        const m0 = memberOf(evt, u.mk); if (m0 && (as === 'spectator' || evt.entrants.some((e) => pidsOf(e).includes(m0.pid)))) return { nochange: true, v: evt };
        if (as === 'player' && (now >= evt.start || evt.drawn)) throw bad(409, 'Entries closed when the event started' + (evt.join.spectators ? '. You can still join to watch' + (evt.rules.pickem ? ' and pick' : '') + '.' : '.'));
        if (as === 'spectator' && !evt.join.spectators) throw bad(409, 'This event has no spectators');
        let m = m0; if (!m) { m = { pid: newPid(evt), mk: u.mk, ak: u.e, name: nm, role: as, joined: now, paid: false }; evt.members.push(m); }
        if (as === 'player') {
          const size = UNITS[evt.rules.unit] || 1; let e = null;
          if (!evt.join.self) throw bad(403, 'The commissioner adds the players in this event. Ask for a spot (or a claim code), or join to watch.'); // review fix 2
          if (b.eid) { e = evt.entrants.find((x) => x.eid === String(b.eid)); if (!e) throw bad(404, 'That entry is gone'); if (!(e.players || []).some((p) => isBlank(p) && (!b.gid || p.gid === String(b.gid)))) throw bad(403, 'That spot belongs to a player the commissioner added. Ask the commissioner for its claim code.'); }
          else { e = addEntrant(evt, b.entryName || nm, b.rating, u.mk, now, [nm]); }
          const seat = b.eid ? e.players.find((p) => isBlank(p) && (!b.gid || p.gid === String(b.gid))) : e.players.find((p) => !p.pid); if (!seat) throw bad(409, e.name + ' is full'); seat.orig = seat.orig || (seat.blank ? null : seat.name); seat.pid = m.pid; seat.name = m.name; m.role = m.role === 'comm' ? 'comm' : 'player';
          audit(evt, now, m.name, 'join', null, 'Joined as ' + e.name);
        } else audit(evt, now, m.name, 'join', null, 'Joined to watch');
        if (people(evt) > cap) throw bad(403, fullMsg(cap));
        return evt;
      });
      await idxSet(id, () => idxEntry(evt)); send(res, 200, { event: full(evt, u.mk, now, cap) }); return true;
    }
    if (op === 'claim') { // a guest typed in by name claims their seat (and every result it has) into this account: code + the guest's claim token
      if (codeBlocked('ec|a|' + u.mk) || codeBlocked('ec|i|' + ip)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.'); rate('join', u.mk, ip);
      const parts = String(b.claim || '').toUpperCase().split('.'), code = normCode(parts[0]), ct = String(parts[1] || '').replace(/[^A-Z0-9]/g, ''), eid0 = code && ct.length === 10 ? await byCode(code) : null;
      if (!eid0) { codeFail('ec|a|' + u.mk); codeFail('ec|i|' + ip); throw bad(404, 'That claim code does not match'); }
      const nm = cleanName(b.myName, 24) || 'Player';
      const evt = await mutate(eid0, (evt, now) => { let seat = null, ent = null; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (!p.pid && p.ct && sameCode(p.ct, ct)) { seat = p; ent = e; } }));
        if (!seat) { codeFail('ec|a|' + u.mk); codeFail('ec|i|' + ip); throw bad(404, 'That claim code does not match (or was already used)'); }
        let m = memberOf(evt, u.mk); if (m && pidsOf(ent).includes(m.pid)) throw bad(409, 'You are already in ' + ent.name);
        if (!m) { m = { pid: newPid(evt), mk: u.mk, ak: u.e, name: nm, role: 'player', joined: now, paid: false }; evt.members.push(m); } else if (m.role === 'spectator') m.role = 'player';
        seat.orig = seat.orig || seat.name; seat.pid = m.pid; seat.claimed = now; audit(evt, now, m.name, 'claim', null, 'Claimed the guest seat "' + seat.name + '" in ' + ent.name); return evt; });
      await idxSet(eid0, () => idxEntry(evt)); send(res, 200, { event: full(evt, u.mk, now, await capOf(evt)) }); return true;
    }
    const id = String(b.id || ''); const r0 = await load(id); if (!r0) throw bad(404, 'Event not found');
    const known = memberOf(r0.data, u.mk); if (!known) throw bad(404, 'Event not found'); // private: members only (non-members use the invite code)
    const cap = await capOf(r0.data);
    if (op === 'get') {
      if (op === 'get' && b.since && Number(b.since) === Number(r0.data.u) && !(r0.data.start <= now && !r0.data.drawn) && !r0.data.matches.some((m) => m.exp && now > m.exp && m.state === 'ready') && !(r0.data.endDay && !r0.data.fin && now > chiEnd(r0.data.endDay))) { send(res, 200, { same: true, u: r0.data.u }); return true; } // cheap poll (review fix 10c: not after the last day)
      const evt = await mutate(id, (evt) => ({ nochange: true, v: evt })) || r0.data; send(res, 200, { event: full(evt, u.mk, now, cap) }); return true;
    }
    const ok = (evt) => { send(res, 200, { event: full(evt, u.mk, D.now(), cap) }); return true; };
    const comm = (evt) => { if (!isComm(evt, u.mk)) throw bad(403, 'Only the commissioner can do that'); };
    const notLocked = (evt, now) => { if (now >= evt.start || evt.drawn) throw bad(409, 'Rules are locked. The event has started.'); };
    if (op === 'edit') { const evt = await mutate(id, (evt, now) => { comm(evt); notLocked(evt, now); const R = cleanRules(b, now); Object.assign(evt, R); if (people(evt) > cap) throw bad(403, fullMsg(cap)); audit(evt, now, 'Commissioner', 'edit', null, 'Rules changed'); return evt; }); if (cap > 8 && usesOdd(evt)) { try { await D.rt().eventSetup(u.e, id, { title: evt.title, sport: ratingSport(evt), lockAt: evt.start }); } catch (x) {} } await idxSet(id, () => idxEntry(evt)); return ok(evt); }
    if (op === 'entrant') { // commissioner adds / renames / re-rates / removes / moves an entry, before the draw
      const evt = await mutate(id, (evt, now) => { comm(evt); notLocked(evt, now);
        if (b.do === 'add') { addEntrant(evt, b.name, b.rating, u.mk, now); if (people(evt) > cap) throw bad(403, fullMsg(cap)); }
        else { const e = evt.entrants.find((x) => x.eid === String(b.eid)); if (!e) throw bad(404, 'That entry is gone');
          if (b.do === 'remove') evt.entrants = evt.entrants.filter((x) => x !== e);
          else if (b.do === 'edit') { const nm = cleanName(b.name, 40); if (nm) e.name = nm; if (b.rating !== undefined) { const r = b.rating === '' || b.rating == null ? null : Number(b.rating); if (r !== null && !(Number.isFinite(r) && r >= 0 && r <= 9999)) throw bad(400, 'Rating: 0 to 9999'); e.rating = r === null ? null : Math.round(r * 1000) / 1000; } }
          else if (b.do === 'up' || b.do === 'down') { const i = evt.entrants.indexOf(e), j = i + (b.do === 'up' ? -1 : 1); if (j >= 0 && j < evt.entrants.length) [evt.entrants[i], evt.entrants[j]] = [evt.entrants[j], evt.entrants[i]]; }
          else throw bad(400, 'Unknown change'); }
        audit(evt, now, 'Commissioner', 'entries', null, 'Entries changed (' + evt.entrants.length + ')'); return evt; });
      return ok(evt);
    }
    if (op === 'draw') { if (cap > 8 && usesOdd(r0.data) && !r0.data.drawn && now < r0.data.start) { try { await D.rt().eventSetup(u.e, id, { title: r0.data.title, sport: ratingSport(r0.data), lockAt: now }); } catch (x) {} } /* an early draw locks the tournament ratings in the rating module too */ const evt = await mutate(id, (evt, now) => { comm(evt); if (evt.drawn) return { nochange: true, v: evt }; draw(evt, now); return evt; }); return ok(evt); }
    if (op === 'leave') { const evt = await mutate(id, (evt, now) => { const m = memberOf(evt, u.mk); if (isComm(evt, u.mk)) throw bad(409, 'The commissioner cannot leave. Delete the event instead (before it starts).'); const inE = evt.entrants.some((e) => pidsOf(e).includes(m.pid)); if (inE && (now >= evt.start || evt.drawn)) throw bad(409, 'The event has started. Players stay to the end.'); evt.entrants.forEach((e) => (e.players || []).forEach((p, i) => { if (p.pid === m.pid) { p.pid = null; p.name = p.orig || (p.blank ? 'Partner ' + (i + 1) : 'Open seat'); p.ct = rnd(10); delete p.claimed; delete p.orig; } })); /* review fix 9: the guest gets its name back and a NEW claim code */ evt.entrants = evt.entrants.filter((e) => !(e.by === u.mk && !pidsOf(e).length && !isComm(evt, e.by))); evt.members = evt.members.filter((x) => x !== m); delete evt.picks[m.pid]; return evt; }); await idxSet(id, () => idxEntry(evt)); send(res, 200, { ok: true }); return true; }
    if (op === 'delete') { await mutate(id, (evt, now) => { comm(evt); notLocked(evt, now); evt.deleted = now; evt.code = ''; return evt; }); await idxSet(id, () => null); send(res, 200, { ok: true }); return true; }
    if (op === 'paid') { const evt = await mutate(id, (evt, now) => { comm(evt); const m = evt.members.find((x) => x.pid === String(b.pid || '')); if (!m) throw bad(404, 'Not in the event'); if (!!m.paid === !!b.paid) return { nochange: true, v: evt }; m.paid = !!b.paid; audit(evt, now, 'Commissioner', 'paid', null, m.name + (m.paid ? ' marked paid' : ' marked not paid')); return evt; }); return ok(evt); }
    if (op === 'finish') { const evt = await mutate(id, (evt, now) => { comm(evt); if (!(evt.fmt === 'ladder' || evt.fmt === 'h2h' || evt.fmt === 'solo')) throw bad(409, 'Brackets and round robins finish when their last match is confirmed'); if (now < evt.start) throw bad(409, 'Not started yet'); if (evt.done) return { nochange: true, v: evt }; evt.done = now; audit(evt, now, 'Commissioner', 'finish', null, 'Event finished'); tick(evt, now); return evt; }); await idxSet(id, () => idxEntry(evt)); return ok(evt); }
    if (op === 'solo') { // solo / skills score for one entry
      rate('score', u.mk, ip); const evt = await mutate(id, (evt, now) => { if (evt.fmt !== 'solo') throw bad(409, 'Not a solo event'); if (!evt.drawn) throw bad(409, 'Scores open when the event starts'); if (evt.fin || evt.done) throw bad(409, 'The event is finished');
        const e = evt.entrants.find((x) => x.eid === String(b.eid)), pm = memberOf(evt, u.mk), cm = isComm(evt, u.mk); if (!e) throw bad(404, 'That entry is gone'); if (!cm && !pidsOf(e).includes(pm.pid)) throw bad(403, 'Enter your own score');
        const v = Number(b.score); if (!(Number.isFinite(v) && v >= -9999 && v <= 99999 && Math.round(v * 100) === Math.round(v * 100 * 1000) / 1000)) throw bad(400, 'Score: a number'); evt.solo = evt.solo || {};
        evt.solo[e.eid] = { v: Math.round(v * 100) / 100, at: now, ver: cm, by: pm.name, pp: seats(evt, e.eid) }; audit(evt, now, pm.name + (cm ? ' (commissioner)' : ''), 'solo', null, e.name + ': ' + evt.solo[e.eid].v + ' ' + evt.rules.unitLabel); return evt; });
      return ok(evt);
    }
    // ---- matches ----
    const findM = (evt) => { const m = evt.matches.find((x) => x.id === String(b.m || '')); if (!m) throw bad(404, 'Match not found'); return m; };
    const vOk = (m) => { if (b.v != null && Number(b.v) !== m.v) throw bad(409, 'This match changed on another phone. It has been reloaded.'); };
    const opSeen = (evt) => { const k = String(b.op || '').slice(0, 40); if (!k) return false; const key = u.mk.slice(0, 8) + ':' + k; if ((evt.ops || []).includes(key)) return true; evt.ops = (evt.ops || []).concat(key).slice(-300); return false; };
    const myName = (evt) => (memberOf(evt, u.mk) || {}).name || 'Player';
    // E-H (owner Nov 16 2026): in an Enterprise tournament the director (the event's commissioner on an enterprise account) can enter a rating for a player
    // with no Oddable rating, or change anyone's rating, for THIS event only. Logged (who, when, old, new, reason), shown as "Set by tournament" next to the
    // player's real-results Oddable rating (never hidden). Locked when the event starts or the draw is made. The lifetime rating is never touched.
    if (op === 'trate') { // storage, rules and the log live in the rating module (eventSetup / eventOverride / eventLog); this is the director's form's route
      const e0 = r0.data, RT = D.rt(); comm(e0); if (!(cap > 8)) throw bad(403, 'Tournament ratings are for Enterprise events (courses, clubs and leagues). ' + limits.ENTERPRISE_TEXT); if (!usesOdd(e0)) throw bad(409, 'This event does not use the Oddable rating');
      if (now >= e0.start || e0.drawn) throw bad(409, 'Ratings are locked. The event has started.');
      let seat = null; e0.entrants.forEach((e) => (e.players || []).forEach((p) => { if (p.gid === String(b.gid || '')) seat = p; })); if (!seat || isBlank(seat)) throw bad(404, 'That player is not in the event');
      const clear = b.rating === '' || b.rating == null, v = clear ? null : Math.round(Number(b.rating)); if (!clear && !(Number.isFinite(Number(b.rating)) && Number(b.rating) >= 100 && v <= 3500)) throw bad(400, 'Tournament rating: a whole number from 100 to 3500 (Oddable scale: new players start at 1500)');
      const reason = cleanName(b.reason, 120); if (reason.length < 2) throw bad(400, 'Give a reason (it is logged and shown to the players)');
      const by = myName(e0); await RT.eventSetup(u.e, id, { title: e0.title, sport: ratingSport(e0), lockAt: e0.start });
      const out = await RT.eventOverride(u.e, id, seatKey(e0, seat), { rating: v, sport: ratingSport(e0), reason, name: seat.name, byName: by }); RC.clear();
      const log = out && out.changed === false ? null : ((await RT.eventLog(u.e, id)) || {}).log || [];
      const evt = await mutate(id, (evt, now) => { if (!log) return { nochange: true, v: evt }; evt.tlog = log.slice(-100).map((x) => ({ at: x.at, by: x.by, player: x.player, old: x.old == null ? null : x.old, new: x.new == null ? null : x.new, oddable: x.oddable == null ? null : x.oddable, reason: x.reason }));
        audit(evt, now, by + ' (director)', 'rating', null, seat.name + ': tournament rating ' + (v == null ? 'removed (Oddable rating used)' : 'set to ' + v) + ' · ' + reason); return evt; });
      return ok(evt);
    }
    // P1 (owner Nov 16 2026): "Suggest partners" for doubles / team events. Any member may look; only the commissioner applies a split, before the start.
    if (op === 'partners') {
      const evt = await mutate(id, (evt) => ({ nochange: true, v: evt })) || r0.data; const size = UNITS[evt.rules.unit] || 1; if (size < 2 || evt.fmt === 'solo') throw bad(409, 'Partner suggestions are for doubles and team events');
      const seatsAll = []; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (!isBlank(p)) seatsAll.push(p); }));
      const players = seatsAll.map((p) => ({ id: p.gid, name: p.name, rating: Number.isFinite(p.tv) ? p.tv : Number.isFinite(p.or) ? p.or : null })) /* the module's `use`; a new player's 1500 start goes in as "no games yet" so the reason can say so */, history = await pairHistory(evt);
      const mode = ['balanced', 'rotate', 'hot'].includes(b.mode) ? b.mode : 'balanced', fn = D.pairing() || require('./pairing').suggestPartners;
      send(res, 200, { mode, teamSize: size, players: players.length, history: history.length, locked: now >= evt.start || !!evt.drawn, suggestions: fn(players, { mode, teamSize: size, history }) }); return true;
    }
    if (op === 'teams') { // the commissioner applies a split they chose (from the suggestions or their own)
      const evt = await mutate(id, (evt, now) => { comm(evt); notLocked(evt, now); const size = UNITS[evt.rules.unit] || 1; if (size < 2 || evt.fmt === 'solo') throw bad(409, 'Not a doubles or team event');
        const bySeat = {}; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (!isBlank(p)) bySeat[p.gid] = p; }));
        const T = Array.isArray(b.teams) ? b.teams.map((t) => (Array.isArray(t) ? t.map(String) : [])) : []; const flat = [].concat(...T);
        if (!T.length || T.some((t) => t.length < 1 || t.length > size) || new Set(flat).size !== flat.length || flat.some((g) => !bySeat[g]) || flat.length !== Object.keys(bySeat).length) throw bad(400, 'Every player must be on exactly one team of up to ' + size);
        const old = evt.entrants.slice(); evt.entrants = T.map((t, i) => { const e = old[i] || { eid: newEid(evt), at: now, by: u.mk }; const pl = t.map((g) => bySeat[g]); while (pl.length < size) pl.push({ gid: 'g' + rnd(8), ct: rnd(10), name: 'Partner ' + (pl.length + 1), pid: null, blank: true });
          return Object.assign(e, { name: cleanName(t.map((g) => bySeat[g].name).join(' / '), 40) || e.name, rating: null, players: pl }); });
        entryRatings(evt); if (people(evt) > cap) throw bad(403, fullMsg(cap)); audit(evt, now, myName(evt), 'teams', null, 'Teams set: ' + evt.entrants.map((e) => e.name).join(' · ') + (b.mode ? ' (from "Suggest partners": ' + String(b.mode).replace(/[^a-z]/g, '') + ')' : '')); return evt; });
      return ok(evt);
    }
    if (op === 'score') {
      rate('score', u.mk, ip); const evt = await mutate(id, (evt, now) => {
        if (opSeen(evt)) return { nochange: true, v: evt }; // offline queue resend: already saved
        notFin(evt); const m = findM(evt); vOk(m); const c = canScore(evt, u.mk, m, now); if (!c.ok) throw bad(403, c.why);
        const g = checkGames(evt.rules, b.games); m.v++; m.live = m.live || now;
        const s0 = sideOf(evt, u.mk, m), asComm = isComm(evt, u.mk) && (!s0 || m.state === 'disputed' || !linked(evt, s0 === 'a' ? m.b : m.a)); // a commissioner playing in the match enters like any player (the opponent confirms); final only on a dispute or vs a guest
        if (asComm) { const was = m.state === 'confirmed' ? m.win : null; if (was && was !== g.win && downstreamPlayed(evt, m)) throw bad(409, 'Later matches are already played. Fix those first.'); if (m.st === 'lad' && m.state === 'confirmed') throw bad(409, 'Ladder results cannot be changed after they move the ladder'); if (m.st === 'pool' && evt.poSeeds) { if (evt.matches.some((x) => x.st === 'po' && (x.live || PLAYED.has(x.state) || x.state === 'confirmed'))) throw bad(409, 'The playoff has started. Pool results are final.'); evt.matches = evt.matches.filter((x) => x.st !== 'po'); delete evt.poSeeds; audit(evt, now, 'Oddable', 'playoff', null, 'Pool result corrected: playoff redrawn'); } /* review fix 3 */ Object.assign(m, { games: g.games, win: g.win, state: 'confirmed', sub: { side: 'comm', games: g.games, by: myName(evt), at: now }, at: now }); audit(evt, now, myName(evt) + ' (commissioner' + (s0 ? ', own match' : '') + ')', was ? 'correct' : 'final', m.id, scoreText(evt, m)); settle(evt, m, now); }
        else { const s = sideOf(evt, u.mk, m); m.state = 'pending'; m.sub = { side: s, games: g.games, win: g.win, by: myName(evt), at: now }; audit(evt, now, myName(evt), 'score', m.id, scoreText(evt, Object.assign({}, m, { win: g.win, games: g.games })) + ' (waiting for ' + (linked(evt, s === 'a' ? m.b : m.a) ? 'the other side' : 'the commissioner') + ' to confirm)'); }
        return evt; });
      return ok(evt);
    }
    if (op === 'confirm' || op === 'dispute') {
      const evt = await mutate(id, (evt, now) => { if (opSeen(evt)) return { nochange: true, v: evt }; notFin(evt); const m = findM(evt); vOk(m); const c = canConfirm(evt, u.mk, m); if (!c.ok) throw bad(403, 'Only the other side (or the commissioner) can ' + op + ' this score'); m.v++;
        if (op === 'confirm') { Object.assign(m, { games: m.sub.games, win: m.sub.win, state: 'confirmed', at: now }); audit(evt, now, myName(evt) + (c.comm ? ' (commissioner)' : ''), 'confirm', m.id, scoreText(evt, m)); settle(evt, m, now); }
        else { if (c.comm) throw bad(400, 'Commissioner: enter the right score instead'); m.state = 'disputed'; m.sub.note = cleanName(b.note, 120); audit(evt, now, myName(evt), 'dispute', m.id, 'Disputed' + (m.sub.note ? ': ' + m.sub.note : '') + '. The commissioner decides.'); }
        return evt; });
      return ok(evt);
    }
    if (op === 'live') { const evt = await mutate(id, (evt, now) => { notFin(evt); const m = findM(evt); if (m.live || m.state !== 'ready') return { nochange: true, v: evt }; if (!isComm(evt, u.mk) && !sideOf(evt, u.mk, m)) throw bad(403, 'Only the players or the commissioner start a match'); m.live = now; m.v++; audit(evt, now, myName(evt), 'start', m.id, 'Match started (picks locked)'); return evt; }); return ok(evt); }
    if (op === 'pick') {
      rate('score', u.mk, ip); const evt = await mutate(id, (evt, now) => { if (!evt.rules.pickem) throw bad(409, 'This event has no pick\'em'); const pm = memberOf(evt, u.mk), P = evt.picks[pm.pid] = evt.picks[pm.pid] || { m: {} };
        if (b.tb !== undefined) { const fm = finalMatch(evt); if (fm && pickLocked(evt, fm, now)) throw bad(409, 'The final has started. The tiebreak is locked.'); const t = Number(b.tb); if (!(Number.isInteger(t) && t >= 0 && t <= 999)) throw bad(400, 'Tiebreak: total points in the final, 0 to 999'); P.tb = t; }
        if (b.m) { const m = findM(evt); if (pickLocked(evt, m, now)) throw bad(409, 'Picks for this round locked when its first match started'); if (!(m.state === 'ready' && m.a && m.b)) throw bad(409, 'This match is not set yet'); if (!['a', 'b'].includes(b.side)) throw bad(400, 'Pick a side'); P.m[m.id] = { s: b.side, t: now }; }
        P.last = now; return evt; });
      return ok(evt);
    }
    if (op === 'challenge') { // ladder challenge, heads-up challenge, or a side match
      rate('score', u.mk, ip); const evt = await mutate(id, (evt, now) => {
        const pm = memberOf(evt, u.mk), cm = isComm(evt, u.mk), A = evt.entrants.find((e) => e.eid === String(b.a)), B = evt.entrants.find((e) => e.eid === String(b.b));
        if (!A || !B || A === B) throw bad(400, 'Pick two different entries');
        if (!cm && !pidsOf(A).includes(pm.pid)) throw bad(403, 'Challenge from your own entry');
        if (now < evt.start) throw bad(409, 'Challenges open when the event starts'); if (evt.fin || evt.done) throw bad(409, 'The event is finished');
        const open = (e) => evt.matches.some((m) => (m.st === 'lad' || m.st === 'h2h' || m.st === 'side') && ['offered', 'ready', 'pending', 'disputed'].includes(m.state) && (m.a === e.eid || m.b === e.eid) && (m.st === 'lad') === (evt.fmt === 'ladder' && !b.side));
        let st = 'h2h';
        if (evt.fmt === 'ladder' && !b.side) { st = 'lad'; if (!evt.drawn) throw bad(409, 'The ladder is not set yet'); const o = evt.ladder.order, ia = o.indexOf(A.eid), ib = o.indexOf(B.eid); if (!(ib < ia && ia - ib <= evt.rules.reach)) throw bad(409, 'You can challenge up to ' + evt.rules.reach + ' spot' + (evt.rules.reach > 1 ? 's' : '') + ' above you'); if (open(A) || open(B)) throw bad(409, 'One of you already has a challenge open'); }
        else if (evt.fmt !== 'h2h') { if (!evt.rules.side && !b.side) throw bad(409, 'This event has no side matches'); if (!evt.rules.side) throw bad(409, 'This event has no side matches'); st = 'side'; }
        if (evt.matches.filter((m) => m.st === st).length >= 400) throw bad(409, 'Too many matches in this event');
        const m = mkMatch({ id: (st === 'lad' ? 'L' : st === 'side' ? 'S' : 'H') + rnd(6), st, r: 0, a: A.eid, b: B.eid, state: st === 'lad' || cm || !linked(evt, B.eid) ? 'ready' : 'offered', at0: now, exp: st === 'lad' ? now + evt.rules.expDays * DAY : null, by: pm.pid });
        evt.matches.push(m); audit(evt, now, myName(evt), 'challenge', m.id, A.name + ' challenged ' + B.name + (m.exp ? ' (play by ' + new Date(m.exp).toISOString().slice(0, 10) + ')' : '')); return evt; });
      return ok(evt);
    }
    if (op === 'accept' || op === 'decline') { const evt = await mutate(id, (evt, now) => { notFin(evt); const m = findM(evt); if (m.state !== 'offered') return { nochange: true, v: evt }; if (!isComm(evt, u.mk) && sideOf(evt, u.mk, m) !== 'b') throw bad(403, 'Only the challenged side can answer'); m.state = op === 'accept' ? 'ready' : 'void'; m.v++; audit(evt, now, myName(evt), op, m.id, op === 'accept' ? 'Challenge accepted' : 'Challenge declined'); return evt; }); return ok(evt); }
    send(res, 404, { error: 'not found' }); return true;
  } catch (e) { if (!e.status) console.error('events:', e.message); send(res, e.status || 500, { error: e.status ? e.message : 'Events error, try again' }); return true; }
}
function downstreamPlayed(evt, m) { const kids = evt.matches.filter((x) => x.fa && ((x.fa.m === m.id) || (x.fb && x.fb.m === m.id))); return kids.some((k) => PLAYED.has(k.state) || k.live || downstreamPlayed(evt, k)); }
function scoreText(evt, m) { const w = m.win === 'a' ? m.a : m.b, l = m.win === 'a' ? m.b : m.a; return nameOf(evt, w) + ' beat ' + nameOf(evt, l) + ' ' + m.games.map(([x, y]) => (m.win === 'a' ? x + '-' + y : y + '-' + x)).join(', '); }

// ---------- lifetime stats contract (consumed by the stats coder) ----------
// statsFor(userKey, {from, to}) -> normalized records. userKey = the account id from acct.who(req) (same key the groups/limits code uses).
// One record per match the user played (confirmed or forfeited), one per finished event (place), one per finished bracket pick'em (kind 'contest').
// `score` is numeric only (the stats contract): solo events put their number there; game scores are in extra.games / extra.scoreText.
async function statsFor(userKey, opt) {
  const mk = mkOf(userKey), from = (opt && opt.from) || '0000-00-00', to = (opt && opt.to) || '9999-99-99', ix = await D.S.dbGet(IDX), ev = (ix && ix.data && ix.data.ev) || {}, out = [], now = D.now();
  for (const id of Object.keys(ev)) {
    if (!(ev[id].mk || []).includes(mk)) continue; const r = await load(id); if (!r) continue; const evt = r.data; tick(evt, now); const m0 = memberOf(evt, mk); if (!m0) continue;
    const myGids = new Set(); evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (p.pid === m0.pid) myGids.add(p.gid); })); // seats this account holds (typed-in guest seats it claimed included)
    const mySide = (pp) => (pp && pp.a.some((p) => myGids.has(p.gid)) ? 'a' : pp && pp.b.some((p) => myGids.has(p.gid)) ? 'b' : null);
    const base = { src: 'events', sport: STAT_SPORT[evt.sport] || 'other', game: evt.sport, groupId: evt.group ? evt.group.gid : undefined, contestId: evt.group ? evt.group.cid : undefined };
    evt.matches.filter((m) => m.state === 'confirmed' && m.pp).forEach((m) => {
      const side = mySide(m.pp); if (!side) return; const opp = side === 'a' ? m.b : m.a, mine = m.pp[side], theirs = m.pp[side === 'a' ? 'b' : 'a'], meSeat = mine.find((p) => myGids.has(p.gid));
      const games = m.games.map(([x, y]) => (side === 'a' ? [x, y] : [y, x])), diff = games.reduce((t, [x, y]) => t + x - y, 0), partner = mine.filter((p) => p !== meSeat).map((p) => p.name)[0];
      out.push(Object.assign({}, base, { id: evt.id + ':' + m.id, date: chiDay(m.at || evt.start), kind: 'match', title: evt.title + ' · ' + matchLabel(m), result: m.win === side ? 'W' : 'L', opponent: nameOf(evt, opp), verified: !!(m.sub && m.sub.side !== 'comm' && !m.forfeit && theirs.some((p) => p.pid)),
        extra: { place: null, entry: 0, payout: 0, net: 0, moneyOn: evt.id + ':event', scoreText: m.forfeit ? 'forfeit' : games.map((g) => g.join('-')).join(', '), games, partner: partner || undefined, pointDiff: diff, guestId: meSeat.gid, side: mine.map((p) => ({ id: p.gid, name: p.name, account: !!p.pid })), opp: theirs.map((p) => ({ id: p.gid, name: p.name, account: !!p.pid })), forfeit: !!m.forfeit || undefined } }));
    });
    const myE = evt.entrants.filter((e) => (e.players || []).some((p) => myGids.has(p.gid)));
    // S-ALL (owner Nov 16 2026): every play is in the player's dashboard, running or finished: one 'event' record per event they have an entry in, with the
    // money (entry, payout, net; information only). Running: result null + extra.live (an open play); finished: place + payout + net.
    if (myE.length) { const fin = !!(evt.fin && evt.places), ps = fin ? myE.map((e) => evt.places[e.eid]).filter(Boolean) : [], bestE = fin && ps.length ? myE.find((e) => evt.places[e.eid] === Math.min(...ps)) : myE[0];
      const sr = fin && evt.fmt === 'solo' ? soloRows(evt).find((x) => myE.some((e) => e.eid === x.eid)) : null, mo = moneyFor(evt, bestE.eid), paid = !!m0.paid;
      if (!fin || ps.length) out.push(Object.assign({}, base, { id: evt.id + ':event', date: chiDay(fin ? evt.fin : evt.start), kind: 'event', title: evt.title + (evt.fmt === 'solo' ? ' · ' + FMTN.solo : ''), result: null, place: fin ? { n: Math.min(...ps), of: Object.keys(evt.places).length } : undefined, score: sr ? sr.score : undefined, verified: sr ? sr.ver : true,
        stake: mo.entry || undefined, won: fin && mo.entry ? mo.payout : fin && mo.payout ? mo.payout : undefined, pl: fin && (mo.entry || mo.payout) ? mo.net : undefined,
        extra: { guestId: [...myGids][0], fmt: evt.fmt, live: !fin || undefined, ended: fin || undefined, entry: mo.entry, payout: fin ? mo.payout : null, net: fin ? mo.net : null, paid, moneyNote: 'Information only: Oddable never collects or pays.', solo: evt.fmt === 'solo' || undefined, scoreText: sr ? sr.score + ' ' + evt.rules.unitLabel : fin ? ord(Math.min(...ps)) + ' of ' + Object.keys(evt.places).length : 'In progress', unit: sr ? evt.rules.unitLabel : undefined } })); }
    if (evt.rules.pickem && evt.fin && evt.picks[m0.pid]) { const t = pickTable(evt).rows, row = t.find((x) => x.pid === m0.pid); if (row) out.push(Object.assign({}, base, { id: evt.id + ':pickem', date: chiDay(evt.fin), kind: 'contest', title: evt.title + " · bracket pick'em", result: null, place: { n: row.place, of: t.length }, verified: true, extra: { pickem: true, entry: 0, payout: 0, net: 0, right: row.right, of: row.n, pts: row.pts, scoreText: row.right + ' of ' + row.n + ' right' } })); }
  }
  out.forEach((x) => { x.extra = Object.assign({ game: x.game }, x.extra || {}); delete x.game; Object.keys(x).forEach((k) => { if (x[k] === undefined) delete x[k]; }); Object.keys(x.extra).forEach((k) => { if (x.extra[k] === undefined) delete x.extra[k]; }); });
  return out.filter((x) => x.date >= from && x.date <= to).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
// P1 history: games two players of THIS event played on the same team, from their lifetime events (accounts, matched by member key) and this event
// (guests too, by seat). -> [{ids: [gid, gid...], result, at}] for suggestPartners. Server-side only; member keys never leave the server.
async function pairHistory(evt) {
  const gidOfMk = {}; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { const m = p.pid && evt.members.find((x) => x.pid === p.pid); if (m) gidOfMk[m.mk] = p.gid; }));
  const out = [], mks = Object.keys(gidOfMk), ix = await D.S.dbGet(IDX), ev = (ix && ix.data && ix.data.ev) || {};
  const sideRes = (m, side) => (m.win === side ? 'W' : 'L');
  evt.matches.filter((m) => m.state === 'confirmed' && m.pp).forEach((m) => ['a', 'b'].forEach((sd) => { const ids = m.pp[sd].map((p) => p.gid).filter((g) => evt.entrants.some((e) => (e.players || []).some((p) => p.gid === g))); if (ids.length > 1) out.push({ ids, result: sideRes(m, sd), at: m.at || 0 }); }));
  if (mks.length < 2) return out;
  let n = 0; for (const id of Object.keys(ev)) { if (id === evt.id) continue; const hit = (ev[id].mk || []).filter((k) => k in gidOfMk); if (hit.length < 2) continue; if (++n > 60) break; const r = await load(id); if (!r) continue; const o = r.data, mkOfPid = {}; o.members.forEach((m) => (mkOfPid[m.pid] = m.mk));
    o.matches.filter((m) => m.state === 'confirmed' && m.pp).forEach((m) => ['a', 'b'].forEach((sd) => { const ids = m.pp[sd].map((p) => p.pid && gidOfMk[mkOfPid[p.pid]]).filter(Boolean); if (ids.length > 1) out.push({ ids, result: sideRes(m, sd), at: m.at || 0 }); })); }
  return out;
}
// STAND-IN for the stats module (stats-v1: odds-api/stats.js), same names, arguments and result shapes; D.rt() uses the real one when it is in the build.
//   ratingFor(userKey, sport, {eventId}) -> { sport, oddable: {rating, matches, label}, event, setBy: 'tournament' | null, use, start, label, reason?, at?, locked? }
//   eventSetup(directorKey, eventId, {title, sport, lockAt})   Enterprise accounts only
//   eventOverride(directorKey, eventId, userKey, {rating, sport, reason, name, byName})   null clears; refused after lockAt; logged
//   eventLog(directorKey, eventId) -> { ok, title, locked, lockAt, log: [{at, by, player, field, old, new, oddable, reason}] }
// Oddable rating here = Elo from the player's own confirmed matches in local events (start 1500, K 32; ratings.js eloFor when present). Storage: row
// 'lock:evr:<eventId>' like stats.js. A tournament rating lives only in that row: nobody's lifetime rating or records are changed by it.
const RC = new Map(), EVR = (id) => 'lock:evr:' + id, RLABEL = 'Oddable rating (unofficial, from app play)';
const pkey = (userKey) => { const m = /^guest:([a-z0-9]{6,24})$/.exec(String(userKey || '')); return m ? 'g:' + m[1] : mkOf(userKey); };
const evrLocked = (d) => !!(d && d.lockAt && D.now() >= d.lockAt);
async function oddableOf(userKey, sport) {
  if (/^guest:/.test(String(userKey))) return { rating: null, matches: 0 }; const key = userKey + '|' + sport, c = RC.get(key); if (c && D.now() - c.at < 30e3 && D.now() >= c.at) return c.v;
  const recs = (await statsFor(userKey, {})).filter((r) => r.kind === 'match' && r.sport === sport && (r.result === 'W' || r.result === 'L')), R = realMod('./ratings');
  let v; if (R && typeof R.eloFor === 'function') { const x = R.eloFor(recs); v = { rating: x.matches ? x.rating : null, matches: x.matches }; }
  else { let r = 1500; const exp = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400)); recs.forEach((m) => { r += 32 * ((m.result === 'W' ? 1 : 0) - exp(r, 1500)); }); v = { rating: recs.length ? Math.round(r) : null, matches: recs.length }; }
  RC.set(key, { at: D.now(), v }); if (RC.size > 5000) RC.clear(); return v;
}
const STAND = {
  standIn: true,
  ratingFor: async (userKey, sport, opts) => { const sp = sport && sport !== 'golf' ? sport : 'pickleball', o = opts || {}, od = await oddableOf(userKey, sp); let d = null; if (o.eventId) { const r = await D.S.dbGet(EVR(o.eventId)); d = (r && r.data) || null; }
    const s = d && d.set && d.set[pkey(userKey)] && d.set[pkey(userKey)].rating != null ? d.set[pkey(userKey)] : null;
    return { sport: sp, oddable: { rating: od.rating, matches: od.matches, label: RLABEL }, event: s ? s.rating : null, setBy: s ? 'tournament' : null, use: s ? s.rating : od.rating != null ? od.rating : 1500, start: !s && od.rating == null, label: RLABEL, reason: s ? s.reason : undefined, at: s ? s.at : undefined, locked: d ? evrLocked(d) : undefined }; },
  eventSetup: async (directorE, eventId, o) => { if (!(await D.enterprise(directorE))) throw bad(403, 'Only Enterprise tournaments can set ratings'); const x = o || {}, dk = mkOf(directorE);
    await mutateRow(EVR(eventId), () => ({ dir: dk, set: {}, log: [] }), async (d) => { if (d.dir !== dk) throw bad(403, 'Not your tournament'); if (evrLocked(d)) throw bad(409, 'The tournament has started; ratings are locked'); d.title = cleanName(x.title, 60) || d.title || 'Tournament'; d.sport = x.sport || d.sport || 'pickleball'; d.lockAt = Number(x.lockAt) > 0 ? Number(x.lockAt) : d.lockAt || null; return {}; }); return { ok: true }; },
  eventOverride: async (directorE, eventId, userKey, o) => { const x = o || {}, raw = x.rating, val = raw == null || raw === '' ? null : Math.round(Number(raw)); if (val != null && !(val >= 100 && val <= 3500)) throw bad(400, 'Rating must be 100 to 3500');
    const dk = mkOf(directorE), pk = pkey(userKey), real = (await oddableOf(userKey, x.sport && x.sport !== 'golf' ? x.sport : 'pickleball')).rating;
    return mutateRow(EVR(eventId), null, async (d) => { if (d.dir !== dk) throw bad(403, "Only this tournament's director can change ratings"); if (evrLocked(d)) throw bad(409, 'The tournament has started; ratings are locked');
      d.set = d.set || {}; d.log = d.log || []; const cur = d.set[pk] || {}, old = cur.rating != null ? cur.rating : real; if ((cur.rating == null && val == null) || cur.rating === val) return { nochange: true, v: { ok: true, changed: false } };
      const nx = Object.assign({}, cur, { at: D.now(), reason: cleanName(x.reason, 120), name: cleanName(x.name, 30) || cur.name || '' }); if (val == null) delete d.set[pk]; else { nx.rating = val; d.set[pk] = nx; }
      d.log.push({ at: D.now(), by: cleanName(x.byName, 30) || 'Tournament director', player: nx.name || 'Player', field: 'rating', old: old == null ? null : old, new: val, oddable: real == null ? null : real, reason: cleanName(x.reason, 120) }); if (d.log.length > 2000) d.log = d.log.slice(-2000);
      return { ok: true, changed: true, old: old == null ? null : old, new: val }; }); },
  eventLog: async (directorE, eventId) => { const r = await D.S.dbGet(EVR(eventId)), d = r && r.data; if (!d || d.dir !== mkOf(directorE)) throw bad(404, 'Tournament not found'); return { ok: true, title: d.title, locked: evrLocked(d), lockAt: d.lockAt || null, log: (d.log || []).slice(-500) }; },
};
const ratingFor = (userKey, sport, opts) => D.rt().ratingFor(userKey, sport, opts);
// S-ALL money for one player in one event (information only; Oddable never collects or pays): entry = the event's entry, payout = their share of the
// prize for their entry's place (tied places share the prizes of the places they cover, in cents), net = payout - entry.
function moneyFor(evt, eid) {
  const entry = Number(evt.money.entry) || 0, pl = evt.places || null; if (!pl || !pl[eid]) return { entry, payout: pl ? 0 : null, net: pl ? -entry : null };
  const pot = potSummary(evt), place = pl[eid], tied = Object.keys(pl).filter((k) => pl[k] === place).length;
  let c = 0; for (let i = place; i < place + tied; i++) { const x = pot.places.find((y) => y.place === i); if (x) c += Math.round(x.amt * 100); }
  const e = evt.entrants.find((x) => x.eid === eid), heads = Math.max(1, ((e && e.players) || []).filter((p) => !isBlank(p)).length), payout = Math.floor(c / tied / heads) / 100;
  return { entry, payout, net: Math.round((payout - entry) * 100) / 100 };
}
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function matchLabel(m) { return m.st === 'pool' ? 'Pool round ' + m.r : m.st === 'po' ? 'Playoff round ' + m.r : m.st === 'w' ? 'Round ' + m.r : m.st === 'l' ? 'Losers round ' + m.r : m.st === 'gf' ? (m.reset ? 'Final (reset)' : 'Final') : m.st === 'lad' ? 'Ladder challenge' : m.st === 'side' ? 'Side match' : 'Heads-up'; }

// ---------- ADAPTER: contest type 'local-event' inside a Group (for the Groups contests[] restructure and the Calcutta engine) ----------
// Server-side only (never from a client body): groups.js creates/attaches the event after it has checked the group commissioner.
const ADAPTER = {
  type: 'local-event',
  attachToGroup: (evtId, ctx) => ADAPTER.attach(evtId, ctx), // alias (name used in OWNER-DECISIONS / the Groups contests[] plan)
  attach: (evtId, ctx) => mutate(evtId, (evt) => { evt.group = { gid: String(ctx.gid).slice(0, 20), cid: String(ctx.cid).slice(0, 20) }; evt.money.pot = ctx.pot === 'side' ? 'side' : 'main'; return evt; }).then((evt) => idxSet(evtId, () => idxEntry(evt)).then(() => evt)),
  summary: async (evtId) => { const r = await load(evtId); if (!r) return null; const evt = r.data, now = D.now(); tick(evt, now); const pl = evt.places || places(evt, now); return { id: evt.id, title: evt.title, fmt: evt.fmt, status: evt.fin ? 'final' : evt.drawn ? 'live' : 'upcoming', start: evt.start, leader: pl ? nameOf(evt, Object.keys(pl).find((e) => pl[e] === 1)) : null, places: pl ? Object.entries(pl).map(([e, p]) => ({ lot: e, name: nameOf(evt, e), place: p })) : null }; },
  potSummary: async (evtId) => { const r = await load(evtId); return r ? potSummary(r.data) : null; },
  // Calcutta `lots` source: one lot per entry (player or pair). result(lotId) tells the Calcutta engine how far that lot went.
  lots: async (evtId) => { const r = await load(evtId); if (!r) return []; const evt = r.data; return evt.entrants.map((e) => ({ id: e.eid, name: e.name, rating: e.rating, seed: (evt.seeds || []).indexOf(e.eid) + 1 || null, size: UNITS[evt.rules.unit] || 1 })); },
  lotResults: async (evtId) => { const r = await load(evtId); if (!r) return {}; const evt = r.data, now = D.now(); tick(evt, now); const pl = evt.places || places(evt, now) || {}, o = {}; evt.entrants.forEach((e) => { const ms = evt.matches.filter((m) => m.state === 'confirmed' && (m.a === e.eid || m.b === e.eid)); o[e.eid] = { place: pl[e.eid] || null, wins: ms.filter((m) => winnerOf(m) === e.eid).length, losses: ms.filter((m) => loserOf(m) === e.eid).length, alive: !pl[e.eid] && !ms.some((m) => loserOf(m) === e.eid && (m.st === 'po' || (m.st === 'w' && evt.fmt === 'se') || m.st === 'l')), final: !!evt.fin }; }); return o; },
};
module.exports = { handle, statsFor, ratingFor, STAND, moneyFor, pairHistory, ADAPTER, limits, SPORTS, FMTN, cleanRules, checkGames, roundRobin, buildElim, seedOrder, poolTable, places, potSummary, people, _deps: D, _mkOf: mkOf, _reset: () => { RL.clear(); RC.clear(); } };
