// Oddable PICKLEBALL GROUP GAMES (Nov 17 2026, branch pb-group): the preview's LOCAL EVENTS engine (local-v1 872e74a, "Local events v1.3") ported to main
// as a GROUP GAME behind the Groups switches, the way v273 brought Golf days in. File name: odds-api/local.js, routes POST /local/<op>. (main's
// odds-api/events.js is the ACTIVITY-events module for My Apps; this engine was renamed so neither overwrites the other.)
//
// WHAT IT IS (engine unchanged in its rules): games people run themselves with no live feed. Results are typed in by each match's designated scorer and
// confirmed by the opponent; disputes go to the commissioner. Every change is in an audit trail. Formats: round robin (+ optional single-elimination playoff
// of the top N), single elimination, double elimination (with bracket reset), ladder, heads-up challenges (best of 1/3/5, also as side matches), solo /
// skills scores, and bracket pick'em (a layer on any bracket / round robin event).
//
// ON MAIN, ONLY INSIDE A GROUP (handle() at the bottom = the group gate in front of the engine's own routes, core()):
//   - the same switches as Groups and Golf days (groups.js onFor: GROUPS_ENABLED / GROUPS_OWNER_ONLY / GROUPS_TESTERS). Off, or not on for this account =
//     403 {off:true} and NOTHING is read; an account whose time has ended = 403 {expired:true}. Nothing new to switch.
//   - every call names its group (`g`) and the caller must be a member of it (groups.js memberCheck); a game belongs to the group it was made in and only
//     that group's members can see, join or score it. Only PICKLEBALL can be started (other sports: "Coming soon"). Only the group's commissioner starts one.
//   - NO MONEY: entry 0, no split, no take, no pot are forced on create and edit; the "paid" route is refused. Nothing is collected, held, paid or ordered.
//   - no public "peek" and no invite link of its own: members open the group's games from the group page. Typed-in players (no account) and their claim
//     codes stay (the cap counts them).
//   - people cap = main's odds-api/limits.js maxPeople (8 standard, organizer, players, spectators and typed-in players counted).
//   - the owner's Activity event pickleballStarted(group, name, {key: <event id>}) after a game is made (events.js -> My Apps).
// Storage (Supabase oddable_sync through sync.js, 'lock:' prefix keeps rows out of player lists): 'lock:evt:<id>' one row per game; 'lock:evtidx' index
// (code, title, member keys, group id); 'lock:evr:<id>' tournament ratings (stand-in rating module). Every write is conditional on `updated` (dbPatchIf):
// read -> change -> write only if nobody wrote in between, else redo (no lost score entries).
const crypto = require('crypto');
const D = {
  S: require('./sync'),
  acct: () => require('./acct'),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)), // back-off between write retries (tests may stub it)
  ip: (req) => require('./ip').clientIp(req),
  enterprise: async (accountKey) => false, // used only by LIMSTAND / STAND (this branch on its own); the real flag is limits.isEnterprise
  limits: () => { const m = realMod('./limits'); return m && typeof m.maxPeople === 'function' && typeof m.keyOf === 'function' ? m : LIMSTAND; },
  // H1 / E-H (owner Nov 16 2026): the rating module. The stats branch's own (odds-api/stats.js: ratingFor, eventSetup, eventOverride, eventLog) when it is
  // in the build, else the STAND-IN at the bottom of this file with the same names, arguments and result shapes.
  rt: () => { const m = realMod('./stats'); return m && ['ratingFor', 'eventSetup', 'eventOverride', 'eventLog'].every((f) => typeof m[f] === 'function') ? m : STAND; },
  grp: () => require('./groups'), // main: the group gate (onFor, memberCheck)
  ev: () => require('./events'), // main: the ACTIVITY-events module (pickleballStarted -> My Apps)
  pairing: () => realFn('./pairing', 'suggestPartners'), // P1 shared contract suggestPartners(players, {mode, teamSize, history}) (odds-api/pairing.js; stand-in in this branch)
};
function realMod(mod) { try { return require(mod); } catch (e) { return null; } }
function realFn(mod, fn) { try { const m = require(mod); return m && typeof m[fn] === 'function' ? m[fn] : null; } catch (e) { return null; } }
// People cap: the SHARED check `limits.maxPeople(limits.keyOf(accountId), groupOrGameId)` (Groups branch, odds-api/limits.js: 8 per game, owner-granted extra
// seats, Enterprise ceiling). D.limits() uses that module when it is in the build; LIMSTAND below is only the fallback for this branch on its own (same names
// and signatures: keyOf, maxPeople, isEnterprise, ENTERPRISE_TEXT). Events has no ceiling of its own: whatever maxPeople answers is the cap.
const ENT_TEXT = 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.';
const LIMSTAND = { standIn: true, keyOf: (e) => e, isEnterprise: (key) => D.enterprise(key), ENTERPRISE_TEXT: ENT_TEXT,
  maxPeople: async (accountKey, groupOrGameId) => ((await D.enterprise(accountKey)) ? Math.max(8, Math.min(5000, Math.round(Number(process.env.ENTERPRISE_MAX_PEOPLE) || 500))) : 8) };
// Enterprise billing ($20 per player per game): every player of a started event is recorded through the SHARED limits.recordPlay(accountKey, gameType,
// gameId, playerKey) (Groups branch limits.js; idempotent, a no-op for standard accounts). Stand-in with the same signature and the same 'lock:entuse' row.
LIMSTAND.recordPlay = async (accountKey, gameType, gameId, playerKey, title) => { if (!accountKey || !(await D.enterprise(accountKey))) return false; const mo = new Date(D.now()).toISOString().slice(0, 7), gid = String(gameId || '').slice(0, 60);
  const pks = (Array.isArray(playerKey) ? playerKey : [playerKey]).filter((p) => p != null && p !== '').map((p) => crypto.createHash('sha256').update('oddable-play|' + String(p)).digest('hex').slice(0, 12)); if (!gid || !pks.length) return false;
  await mutateRow('lock:entuse', () => ({}), async (x) => { const a = (x[accountKey] = x[accountKey] || {}), m = (a[mo] = a[mo] || {}), o = (m[gid] = m[gid] || { n: 0 }); o.p = Array.isArray(o.p) ? o.p : []; const add = pks.filter((pk) => !o.p.includes(pk)); if (!add.length && o.type) return { nochange: true }; add.forEach((pk) => o.p.push(pk)); o.type = String(gameType || 'game'); o.n = Math.max(Number(o.n) || 0, o.p.length); if (title) o.title = String(title).slice(0, 40); return {}; }); return true; };
const BILL = new Map(); let BILLQ = Promise.resolve();
function bill(evt) { // called after every answer that carries an event: once it has started, each player (accounts and typed-in players, by seat id) is recorded once
  try { if (!evt || !(evt.drawn || evt.fin) || evt.deleted) return; const L = D.limits(); if (typeof L.recordPlay !== 'function') return; const done = BILL.get(evt.id) || new Set(), todo = seatsPlaying(evt).map((p) => p.gid).filter((g) => !done.has(g)); if (!todo.length) return;
    todo.forEach((g) => done.add(g)); BILL.set(evt.id, done); if (BILL.size > 5000) BILL.delete(BILL.keys().next().value); const ak = L.keyOf(evt.ce), id = evt.id;
    BILLQ = BILLQ.then(async () => { for (const g of todo) { try { await L.recordPlay(ak, 'event', id, g); } catch (e) { done.delete(g); console.error('local recordPlay:', e.message); } } }); } catch (e) { console.error('local bill:', e.message); }
}
const limits = { get ENTERPRISE_TEXT() { return D.limits().ENTERPRISE_TEXT || ENT_TEXT; }, maxPeople: (k, id) => D.limits().maxPeople(k, id) }; // kept for callers of events.limits
const ENTF = new Map(); // event id -> is the organizer an Enterprise account (asked from limits.isEnterprise, never guessed from the cap: extra seats are not Enterprise)
async function capFor(accountId, gameId) { const L = D.limits(), n = Math.round(Number(await L.maxPeople(L.keyOf(accountId), gameId || ''))); if (!(n >= 1)) throw bad(503, 'Could not check the people limit. Try again.'); return n; } // fail closed
async function entFor(accountId) { const L = D.limits(); try { return typeof L.isEnterprise === 'function' ? !!(await L.isEnterprise(L.keyOf(accountId))) : false; } catch (e) { return false; } }
const fullMsg = (cap) => 'This game is full: ' + cap + ' people max, counting the organizer, players and spectators. ' + limits.ENTERPRISE_TEXT; // owner: "8 people per group, all games"
const ROW = (id) => 'lock:evt:' + id, IDX = 'lock:evtidx', DAY = 864e5;
const send = (res, code, o) => { if (o && o.event && o.event.id && o.event._bill) { bill(o.event._bill); delete o.event._bill; } if (res._lg) groupScrub(o, res._lgcap); res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const bad = (status, error) => Object.assign(new Error(error), { status });
const body = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 30000) c.push(d); }); req.on('end', () => { if (n > 30000) return no(bad(413, 'Too big')); try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(bad(400, 'Bad request')); } }); req.on('error', no); });
const clone = (o) => JSON.parse(JSON.stringify(o));
// P8: "&" is kept ("Tess & Bo"): the phone escapes every name on output, and "&" alone cannot open a tag (< > are still removed)
const cleanName = (n, max) => String(n == null ? '' : n).replace(/[<>"'`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 30);
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
  const scoring = P ? (b.scoring === 'rally' ? 'rally' : 'sideout') : ''; // label only (the app does not count rallies). Side-out is the pickleball default; rally is the option
  const seeding = ['rating', 'oddable', 'random', 'manual'].includes(b.seeding) ? b.seeding : null; if (!seeding) throw bad(400, 'Pick how players are seeded');
  const courts = Math.round(Number(b.courts == null ? 1 : b.courts)); if (!(courts >= 1 && courts <= 32)) throw bad(400, 'Courts: 1 to 32');
  const tset = sport === 'tennis' && fmt !== 'solo' && to > 0 && winBy === 2; // tennis set: to 6 (or 4 / 8), win by 2, one tiebreak game at to-to (7-6)
  const R = { tset, unit, to, winBy, bestOf, scoring, seeding, courts, scorer: ['a', 'either', 'comm'].includes(b.scorer) ? b.scorer : 'a', side: !!b.side };
  if (fmt === 'rr') { R.pools = Math.round(Number(b.pools == null ? 1 : b.pools)); if (!(R.pools >= 1 && R.pools <= 8)) throw bad(400, 'Pools: 1 to 8'); R.playoff = Math.round(Number(b.playoff || 0)); if (![0, 2, 4, 8, 16].includes(R.playoff)) throw bad(400, 'Playoff: none, top 2, 4, 8 or 16'); if (R.playoff && R.playoff < R.pools) throw bad(400, 'The playoff must take at least one from each pool'); }
  // Double elimination, bracket reset (manager, Nov 16 2026): the second final is ONE tiebreak game to 15, win by 2 (pickleball rulebook) by default;
  // the organizer may choose a full match instead. Other sports always play a full match.
  if (fmt === 'de') R.reset = P && b.reset !== 'match' ? 'game15' : 'match';
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
// ruleOf: the rules one match is scored by (the double-elimination reset final may be a single game to 15).
const ruleOf = (evt, m) => (m && m.reset && evt.rules.reset === 'game15' ? Object.assign({}, evt.rules, { to: 15, winBy: 2, bestOf: 1, tset: false }) : evt.rules);
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
  if (evt.drawn) return; const np = needPartner(evt); if (np.length) throw bad(409, 'Not ready to start: ' + np.map((e) => e.name).join(', ') + (np.length > 1 ? ' have' : ' has') + ' an empty partner spot. Add the partner or remove the entry.');
  const ids = seedList(evt); if (ids.length < (evt.fmt === 'solo' ? 1 : 2)) throw bad(409, 'Needs at least 2 ' + (evt.rules.unit === 'singles' ? 'players' : 'entries') + ' to make the draw');
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
// Pool play tiebreaks = the pickleball rulebook order (Playbook fix, manager Nov 16 2026). Only confirmed results count.
//   (1) match wins; (2) head-to-head: wins in the matches among the entries tied on wins; (3) point differential over all pool matches;
//   (4) head-to-head point differential (matches among the tied only); (5) point differential against the next-highest entry (then the next, and so on).
//   Whenever a step splits off the best of a tie, the rest start over at head-to-head (review fix 10b).
//   Still tied: NEVER the seed. The organizer chooses a one-match playoff (two tied entries) or a coin flip (the server flips), and the choice is logged
//   (evt.tb[<tied ids>] = {how: 'coin', order} | {how: 'game', m}). Until then the rows carry `tie` and the event waits (no places, no playoff).
const tieKey = (ids) => ids.slice().sort().join('+');
// Manager decisions (Nov 16 2026). A tie only WAITS for the organizer when it touches a prize or a playoff spot; any other tie is a shared place.
// Places across pools are never compared by record: entries that finish in the same position in different pools share the place.
const paidPlaces = (evt) => (evt.money && Number(evt.money.entry) > 0 ? (SPLITS[evt.money.split] || []).length : 0);
const poPer = (evt) => (evt.rules && evt.rules.playoff ? Math.ceil(evt.rules.playoff / Math.max(1, (evt.pools || []).length)) : 0);
function tieBlocks(evt, ids, lo) { // lo = the best pool position the tied entries could take
  const per = poPer(evt); if (per && lo <= per) return true; const n = paidPlaces(evt); if (!n) return false;
  const pools = evt.pools && evt.pools.length ? evt.pools : [ids]; return 1 + pools.reduce((t, p) => t + Math.min(lo - 1, p.length), 0) <= n;
}
function poolTable(evt, ids, pool) {
  const T = {}; ids.forEach((id) => (T[id] = { eid: id, w: 0, l: 0, pf: 0, pa: 0, gw: 0, gl: 0, n: 0 }));
  const ms = evt.matches.filter((m) => m.st === 'pool' && (pool == null || m.pool === pool) && m.state === 'confirmed');
  ms.forEach((m) => { const A = T[m.a], B = T[m.b]; if (!A || !B) return; m.games.forEach(([x, y]) => { A.pf += x; A.pa += y; B.pf += y; B.pa += x; if (x > y) { A.gw++; B.gl++; } else { B.gw++; A.gl++; } }); A.n++; B.n++; if (m.win === 'a') { A.w++; B.l++; } else { B.w++; A.l++; } });
  const rows = Object.values(T); rows.forEach((r) => (r.diff = r.pf - r.pa));
  const entIx = (id) => (evt.entrants || []).findIndex((e) => e.eid === id), rough = rows.slice().sort((a, b) => b.w - a.w || b.diff - a.diff || b.pf - a.pf);
  const h2hIn = (grp) => { const S = new Set(grp.map((r) => r.eid)), o = {}; grp.forEach((r) => (o[r.eid] = 0)); ms.forEach((m) => { if (S.has(m.a) && S.has(m.b)) o[winnerOf(m)]++; }); return o; };
  const diffIn = (grp, only) => { const S = new Set(grp.map((r) => r.eid)), o = {}; grp.forEach((r) => (o[r.eid] = 0)); ms.forEach((m) => { const inA = S.has(m.a), inB = S.has(m.b), other = only ? (inA ? m.b : m.a) : null; if (only ? !((inA && m.b === only) || (inB && m.a === only)) : !(inA && inB)) return; const d = m.games.reduce((t, [x, y]) => t + x - y, 0); if (inA) o[m.a] += d; if (inB) o[m.b] -= d; }); return o; };
  const splitBy = (grp, f) => { const by = new Map(); grp.forEach((r) => { const k = f(r); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }); return [...by.entries()].sort((a, b) => b[0] - a[0]).map((x) => x[1]); };
  const step = (grp, s) => grp.forEach((r) => { r.steps = r.steps || []; if (!r.steps.includes(s)) r.steps.push(s); }); // the tiebreak steps that really separated this row's tie (shown on the standings)
  function undecided(grp) { // every rulebook step is level: the organizer's logged choice, else flagged as tied (neutral order: as entered)
    const key = tieKey(grp.map((r) => r.eid)), t = evt.tb && evt.tb[key], by = {}; grp.forEach((r) => (by[r.eid] = r));
    grp.forEach((r) => (r.tbKey = key)); if (t && t.how === 'coin' && Array.isArray(t.order) && t.order.every((e) => by[e])) { step(grp, 'coin flip'); return t.order.map((e) => Object.assign(by[e], { tb: 'coin flip' })); }
    if (t && t.how === 'game') { const ms = (t.ms || []).map((id) => evt.matches.find((x) => x.id === id)); if (ms.length === grp.length - 1 && ms.every((m) => m && m.state === 'confirmed')) { const o = [winnerOf(ms[ms.length - 1])].concat(ms.slice().reverse().map(loserOf)); if (o.every((e) => by[e])) { step(grp, 'tiebreak playoff'); return o.map((e) => Object.assign(by[e], { tb: 'tiebreak playoff' })); } } }
    return grp.slice().sort((a, b) => entIx(a.eid) - entIx(b.eid)).map((r) => Object.assign(r, { tie: key, tieGame: t && t.how === 'game' ? (t.ms || [])[t.ms.length - 1] || null : null }));
  }
  function order(grp, depth) {
    if (grp.length <= 1) return grp.slice(); if (depth > 30) return undecided(grp);
    const H = h2hIn(grp); grp.forEach((r) => (r.h2h = H[r.eid]));
    const hp = splitBy(grp, (r) => H[r.eid]); if (hp.length > 1) { step(grp, 'head-to-head'); return [].concat(...hp.map((p) => order(p, depth + 1))); }
    const S = new Set(grp.map((r) => r.eid)), HD = diffIn(grp), next = rough.filter((r) => !S.has(r.eid)).map((o) => { const d = diffIn(grp, o.eid); return (r) => d[r.eid]; });
    const fs = [(r) => r.diff, (r) => HD[r.eid]].concat(next), names = ['point differential', 'head-to-head point differential'];
    for (let i = 0; i < fs.length; i++) { const parts = splitBy(grp, fs[i]); if (parts.length > 1) { step(grp, names[i] || 'point differential against the next-highest entry'); return order(parts[0], depth + 1).concat(order([].concat(...parts.slice(1)), depth + 1)); } } // the best is placed, the rest start over at head-to-head
    return undecided(grp);
  }
  const out = [].concat(...splitBy(rows, (r) => r.w).map((g) => order(g, 0)));
  out.forEach((r, i) => (r.rank = i + 1));
  // A tie nobody could break: it waits for the organizer only when it touches a prize or a playoff spot (tieOpen); otherwise the place is shared.
  for (let i = 0; i < out.length; i++) { if (!out[i].tie) continue; let j = i; while (j + 1 < out.length && out[j + 1].tie === out[i].tie) j++; const open = !!out[i].tieGame || tieBlocks(evt, ids, i + 1); for (let k = i; k <= j; k++) { if (open) out[k].tieOpen = true; else { out[k].rank = i + 1; out[k].shared = true; } } i = j; }
  return out;
}
// Tiebreak playoff (the organizer's choice instead of a coin flip): the tied entries are drawn at random into a stepladder: the last two play, the winner
// plays the next one up, and so on (two tied entries = one match). Final order: winner of the last match, its loser, then earlier losers, latest first.
function tbAdvance(evt, now) { Object.keys(evt.tb || {}).forEach((key) => { const t = evt.tb[key]; if (t.how !== 'game' || !Array.isArray(t.ladder)) return; const N = t.ladder.length, k = (t.ms || []).length; if (k >= N - 1) return;
  const prev = k ? evt.matches.find((x) => x.id === t.ms[k - 1]) : null; if (k && !(prev && prev.state === 'confirmed')) return;
  const m = mkMatch({ id: 'T' + rnd(6), st: 'tb', r: k + 1, pool: t.pool, a: t.ladder[N - 2 - k], b: k ? winnerOf(prev) : t.ladder[N - 1], state: 'ready', at0: now }); evt.matches.push(m); t.ms = (t.ms || []).concat(m.id);
  audit(evt, now, 'Oddable', 'tiebreak', m.id, 'Tiebreak playoff match ' + (k + 1) + ' of ' + (N - 1) + ': ' + nameOf(evt, m.a) + ' v ' + nameOf(evt, m.b)); }); }
// Ties the rulebook order could not break, once every pool match is in: the event waits for the organizer's choice (never the seed).
function openTies(evt) {
  if (evt.fmt !== 'rr' || !evt.drawn) return []; const pool = evt.matches.filter((m) => m.st === 'pool'); if (!pool.length || pool.some((m) => m.state !== 'confirmed')) return [];
  const out = {}; (evt.pools || []).forEach((p, i) => poolTable(evt, p, i).forEach((r) => { if (r.tie && r.tieOpen) (out[r.tie] = out[r.tie] || { key: r.tie, pool: i, eids: [], game: r.tieGame || null }).eids.push(r.eid); })); return Object.values(out);
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
    if (openTies(evt).length) return null; // a tie the rulebook could not break waits for the organizer (playoff match or coin flip)
    // Cross-pool rule (manager, Nov 16 2026): entries in different pools never played each other, so the same position in different pools is a SHARED place
    // (no playoff: pool winners share 1st; with a playoff: everyone who missed it is placed by pool position, shared across pools).
    const all = [].concat(...(evt.pools || []).map((p, i) => poolTable(evt, p, i)));
    if (!evt.rules.playoff) { const o = {}; all.forEach((r) => (o[r.eid] = 1 + all.filter((x) => x.rank < r.rank).length)); return o; }
    const po = elimPlaces(evt, 'p'); if (!po) return null; const o = Object.assign({}, po), n = Object.keys(po).length, rest = all.filter((r) => !(r.eid in po)); rest.forEach((r) => (o[r.eid] = n + 1 + rest.filter((x) => x.rank < r.rank).length)); return o;
  }
  if (evt.done || (evt.endDay && now > chiEnd(evt.endDay))) { const o = {}; if (evt.fmt === 'solo') { soloRows(evt).forEach((r) => (o[r.eid] = r.place)); return o; } if (evt.fmt === 'ladder') evt.ladder.order.forEach((e, i) => (o[e] = i + 1)); else h2hTable(evt).forEach((r) => (o[r.eid] = r.rank)); return o; }
  return null;
}
function soloRows(evt) { // solo / skills: one score per entry (latest entered); higher wins unless the commissioner chose lower-is-better
  const S = evt.solo || {}, rows = evt.entrants.filter((e) => S[e.eid]).map((e) => ({ eid: e.eid, name: e.name, score: S[e.eid].v, at: S[e.eid].at, ver: !!S[e.eid].ver }));
  rows.sort((a, b) => (evt.rules.low ? a.score - b.score : b.score - a.score) || a.at - b.at); rows.forEach((r, i) => (r.place = i && rows[i - 1].score === r.score ? rows[i - 1].place : i + 1)); return rows;
}
function maybePlayoff(evt, now) { // round robin: when every pool match is confirmed, the top N go to a single-elimination playoff
  if (evt.fmt !== 'rr' || !evt.rules.playoff || evt.poSeeds || !evt.drawn || evt.poHold) return; // poHold: the commissioner reset the playoff and has not redrawn it yet
  const pool = evt.matches.filter((m) => m.st === 'pool'); if (!pool.length || pool.some((m) => m.state !== 'confirmed')) return; if (openTies(evt).length) return;
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
  // A round robin is finished by the organizer's Finish button (so a last score can still be corrected), or by itself RR_AUTO after its last result.
  if (!evt.fin) { const pl = places(evt, now); if (pl && (evt.fmt === 'se' || evt.fmt === 'de' || evt.done || (evt.fmt === 'rr' ? rrAuto(evt, now) : now > chiEnd(evt.endDay)))) { if (evt.fmt === 'rr' && !evt.done) audit(evt, now, 'Oddable', 'finish', null, 'Finished automatically: 12 hours since the last result'); evt.fin = now; evt.places = pl; cancelOpen(evt, now); } }
  return sig() !== before;
}
const RR_AUTO = 12 * 3600e3;
const lastAt = (evt) => Math.max(0, ...evt.matches.filter((m) => m.state === 'confirmed').map((m) => m.at || 0), ...Object.values(evt.tb || {}).map((t) => t.at || 0));
const rrAuto = (evt, now) => { const t = lastAt(evt); return t > 0 && now - t >= RR_AUTO; };
// A doubles / mixed pair with an empty partner spot cannot start: the draw waits until the commissioner names the partner or removes the entry.
const needPartner = (evt) => (evt.rules && UNITS[evt.rules.unit] === 2 && evt.fmt !== 'solo' ? evt.entrants.filter((e) => (e.players || []).some(isBlank)) : []);
const holdFix = (evt, now) => !evt.drawn && now >= evt.start && needPartner(evt).length > 0;
// Review fix 4: at the finish every challenge / side match not yet confirmed is cancelled (a score waiting for confirmation included); results are final.
function cancelOpen(evt, now) { evt.matches.forEach((m) => { if ((m.st === 'lad' || m.st === 'h2h' || m.st === 'side') && ['offered', 'ready', 'pending', 'disputed'].includes(m.state)) { m.state = 'void'; m.v++; audit(evt, now, 'Oddable', 'cancel', m.id, 'Event finished: challenge cancelled'); } }); }
const notFin = (evt) => { if (evt.fin || evt.done) throw bad(409, 'The event is finished. Results are final.'); };
function audit(evt, now, who, a, m, s) { evt.audit = evt.audit || []; evt.audit.push({ t: now, who: cleanName(who, 30), a, m: m || null, s: String(s || '').slice(0, 160) }); if (evt.audit.length > 400) evt.audit.splice(0, evt.audit.length - 400); }

// ---------- money (information only) ----------
const cents = (x) => Math.round(Number(x) * 100);
function potSummary(evt) {
  const M = evt.money, pl = seatsPlaying(evt), paid = pl.filter((p) => seatPaid(evt, p)).length, potC = cents(M.entry) * paid; // one entry per PLAYER: accounts and typed-in players alike; an organizer who is not playing owes nothing
  const takeC = M.take.kind === 'pct' ? Math.round(potC * M.take.v / 100) : M.take.kind === 'flat' ? Math.min(cents(M.take.v), potC) : 0, poolC = potC - takeC, sp = SPLITS[M.split] || [];
  const parts = sp.map((p) => Math.floor(poolC * p / 100)); if (parts.length) parts[0] += poolC - parts.reduce((a, x) => a + x, 0);
  return { pot: M.pot, entry: M.entry, players: pl.length, paid, total: potC / 100, take: takeC / 100, takeKind: M.take.kind, takeV: M.take.v, pool: poolC / 100, split: M.split, places: parts.map((c, i) => ({ place: i + 1, pct: sp[i], amt: c / 100 })) };
}
const seatsPlaying = (evt) => { const o = []; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (!isBlank(p)) o.push(p); })); return o; };
const seatPaid = (evt, p) => { if (p.pid) { const m = evt.members.find((x) => x.pid === p.pid); return !!(m && m.paid); } return !!p.paid; };
const takeText = (M) => (M.take.kind === 'pct' && M.take.v ? 'Commissioner keeps ' + M.take.v + '% of the pot' : M.take.kind === 'flat' && M.take.v ? 'Commissioner keeps $' + (Number.isInteger(M.take.v) ? M.take.v : M.take.v.toFixed(2)) + ' of the pot' : 'Commissioner keeps nothing');

// ---------- people (cap: 8 per game for standard accounts, organizer included) ----------
// People = every account in the event (organizer, players, spectators) + the typed-in players of entries that nobody has claimed yet.
function people(evt) { const n = evt.members.length; let typed = 0; evt.entrants.forEach((e) => { typed += (e.players || []).filter((p) => !p.pid).length; }); return n + typed; }
async function capOf(evt) { const n = await capFor(evt.ce, evt.id); ENTF.set(evt.id, await entFor(evt.ce)); if (ENTF.size > 5000) ENTF.delete(ENTF.keys().next().value); return n; }

// ---------- rate limits ----------
const RL = new Map();
function limit(key, n, ms) { const t = D.now(), a = (RL.get(key) || []).filter((x) => t - x < ms); if (a.length >= n) { RL.set(key, a); return true; } a.push(t); RL.set(key, a); if (RL.size > 20000) { let k = 0; for (const x of RL.keys()) { RL.delete(x); if (++k > 5000) break; } } return false; }
// [per account n, ms, per IP n, ms]. Every bucket is keyed by ONE account or ONE IP (the signed-out invite preview used to share a single bucket for
// everybody, so a league invite to 200 people locked itself out). The IP buckets are flood guards sized for a whole club on one Wi-Fi; guessing codes is
// stopped separately (10 wrong codes per account / IP = 15 minutes blocked).
function unrate(kind, who, ip) { for (const k of [kind + '|a|' + who, kind + '|i|' + ip]) { const a = RL.get(k); if (a && a.length) a.pop(); } } // gives back the try rate() just counted
const LIM = { create: [6, 3600e3, 15, 3600e3], join: [40, 600e3, 600, 600e3], score: [60, 600e3, 1200, 600e3], peek: [0, 0, 300, 600e3] };
function rate(kind, who, ip) { const L = LIM[kind]; if ((who && L[0] && limit(kind + '|a|' + who, L[0], L[1])) || limit(kind + '|i|' + ip, L[2], L[3])) throw bad(429, 'Too many tries. Wait a few minutes.'); }
const codeFail = (k) => { const t = D.now(), a = (RL.get(k) || []).filter((x) => t - x < 900e3); a.push(t); RL.set(k, a); };
const codeBlocked = (k) => (RL.get(k) || []).filter((x) => D.now() - x < 900e3).length >= 10;

// ---------- storage ----------
async function load(id) { if (!/^[A-Z2-9]{10}$/.test(String(id || ''))) return null; const r = await D.S.dbGet(ROW(id)); return r && r.data && !r.data.deleted ? r : null; } // review fix 10a: a deleted event is gone
// Review fix S1 (Nov 17 2026): 16 tries with a growing, jittered back-off (like limits.js rmw), so many phones writing the same row at once (the shared
// index row above all) take turns instead of all failing after six instant retries.
async function mutateRow(rowId, init, fn, tries) {
  for (let i = 0, n = tries || 16; i < n; i++) {
    if (i) await D.sleep(2 + Math.random() * Math.min(120, 8 * i));
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
function entryRatings(evt) { evt.entrants.forEach((e) => { const ps = (e.players || []).filter((p) => !isBlank(p)), rs = ps.map((p) => (Number.isFinite(useR(p)) ? useR(p) : 1500)); /* no confirmed games yet = seeded at the 1500 start */ e.or = rs.length ? Math.round(rs.reduce((a, x) => a + x, 0) / rs.length) : null; e.orReal = ps.some((p) => Number.isFinite(p.or) || Number.isFinite(p.tv)); }); }
async function prepRatings(evt) {
  if (evt.drawn || !usesOdd(evt)) return; const RT = D.rt();
  for (const e of evt.entrants) for (const p of e.players || []) { if (isBlank(p)) { delete p.or; delete p.use; delete p.tv; continue; } let r = null; try { r = await RT.ratingFor(seatKey(evt, p), ratingSport(evt), { eventId: evt.id }); } catch (x) { r = null; }
    const od = (r && r.oddable) || {}, num = (v) => (v != null && Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
    p.or = num(r && 'confirmedRating' in r ? r.confirmedRating : od.rating); p.orn = Number(od.matches) || 0; p.orc = r && Number.isFinite(Number(r.confirmedGames)) ? Number(r.confirmedGames) : null; /* the rating shown and used = confirmed games only ("x of y games confirmed") */ p.tv = r && r.setBy === 'tournament' ? num(r.event) : null; p.tat = p.tv != null ? r.at || null : null; p.treason = p.tv != null ? cleanName(r.reason, 120) : null; p.use = r ? num(r.use) : null; }
  entryRatings(evt);
}
const mutate = (id, fn) => mutateRow(ROW(id), null, async (data) => { const now = D.now(); await prepRatings(data); const t = tick(data, now); const out = await fn(data, now); if (out && out.nochange) { if (t) { data.u = now; return out.v; } return out; } tick(data, now); data.u = now; return out; });
// S1: the game row is the truth; the index only lists it (an unchanged entry is not rewritten). Once a game row is written the call has succeeded: a failed index write never turns it into an
// error (that left orphan games and made a retry duplicate them). The id waits in IDXQ and is re-indexed from its CURRENT row (never from a stale copy)
// in the background; until then list and code lookups also read the waiting rows themselves.
// N1 (review 2, Nov 17 2026): a request never waits for that repair. In the request path the index gets a few quick tries (IDX_TRIES), then the id is
// queued; one repairer runs at a time (single flight), on a timer, with the full 16 tries.
// N2 (review 2): a game's index entry is written BEFORE its row, so a restart (which empties IDXQ) can never leave a game the index does not list. Every
// later change (join, leave, finish...) only refreshes an entry that already exists: in a group the list filters by the group and reads each row itself,
// so a stale entry still shows the game correctly. If the index cannot be written at create, nothing is written and create answers "Busy, try again".
const IDXQ = new Set(), IDX_TRIES = 4; let IDXT = null, IDXRUN = null;
async function idxFix(id, tries) { await mutateRow(IDX, () => ({ ev: {} }), async (data) => { data.ev = data.ev || {}; const r = await D.S.dbGet(ROW(id)), live = r && r.data && !r.data.deleted ? r.data : null, was = data.ev[id] || null, nx = live ? idxEntry(live) : null; /* read the game row INSIDE the index write: a stale copy can never overwrite a newer entry */ if ((!nx && !was) || (nx && was && JSON.stringify(nx) === JSON.stringify(was))) return { nochange: true }; if (nx) data.ev[id] = nx; else delete data.ev[id]; return {}; }, tries); IDXQ.delete(id); }
async function idxPre(evt) { await mutateRow(IDX, () => ({ ev: {} }), async (data) => { data.ev = data.ev || {}; data.ev[evt.id] = idxEntry(evt); return {}; }); } // N2: before the row
function idxRepair() { // N1: single flight; callers never await it in a request
  if (IDXRUN) return IDXRUN;
  IDXRUN = (async () => { for (const id of [...IDXQ]) { try { await idxFix(id); } catch (e) { /* stays queued */ } } })().finally(() => { IDXRUN = null; if (IDXQ.size && !IDXT) { IDXT = setTimeout(() => { IDXT = null; idxRepair(); }, 2000); if (IDXT.unref) IDXT.unref(); } });
  return IDXRUN;
}
async function idxSafe(id) { try { await idxFix(id, IDX_TRIES); } catch (e) { if (e && e.status && e.status !== 409) throw e; IDXQ.add(id); if (!e.status) console.error('local index:', e.message); idxRepair(); } }
async function idxQueued() { if (IDXQ.size) idxRepair(); const out = {}; for (const id of [...IDXQ]) { const r = await D.S.dbGet(ROW(id)); if (r && r.data && !r.data.deleted) out[id] = idxEntry(r.data); } return out; } // N1: reads the waiting rows, never waits for the repair
const idxEntry = (evt) => ({ c: evt.code, t: evt.title, mk: evt.members.map((m) => m.mk), s: evt.start, e: evt.endDay || null, f: evt.fin || 0, g: evt.group ? evt.group.gid : null });
async function byCode(code) { const ix = await D.S.dbGet(IDX), ev = Object.assign({}, (ix && ix.data && ix.data.ev) || {}, await idxQueued()); let hit = null; Object.keys(ev).forEach((id) => { if (ev[id].c && sameCode(ev[id].c, code)) hit = id; }); return hit; }

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
// Playbook fix (manager, Nov 16 2026): each round also has an explicit lock: a lock time the commissioner sets (auto-locks at that moment, server clock)
// and a "Lock picks now" button (evt.plock[<round>] = {at, locked, by}). A lock is never undone.
const roundLock = (evt, m, now) => { const p = evt.plock && evt.plock[roundKey(m)]; return !!(p && (p.locked || (p.at && now >= p.at))); };
const pickable = (m) => ['pool', 'po', 'w', 'l', 'gf'].includes(m.st);
const lockWhy = (evt, m, now) => { const p = (evt.plock || {})[roundKey(m)] || {}; // which lock applied (button, lock time, or play)
  if (p.locked) return 'Picks for this round were locked by the commissioner' + (p.by ? ' (' + p.by + ')' : '') + '.'; if (p.at && now >= p.at) return 'Picks for this round locked at the lock time the commissioner set.';
  if (m.live || PLAYED.has(m.state) || DONE.has(m.state)) return 'Picks for this match locked when it started.'; return 'Picks for this round locked when its first match started or got a score.'; };
const pickLocked = (evt, m, now) => locked(m, now) || roundLock(evt, m, now) || evt.matches.some((x) => x !== m && roundKey(x) === roundKey(m) && (x.live || PLAYED.has(x.state) || x.state === 'confirmed'));
// Inside a group a member who is not in the game yet sees who is entered (names only, as the group shows them; no claim codes, ratings or account data).
const groupEntrants = (evt) => evt.entrants.map((e) => ({ eid: e.eid, name: e.name, players: (e.players || []).map((p) => ({ name: isBlank(p) ? '' : p.name, guest: !p.pid, blank: isBlank(p) })) }));
function pub(evt, now) {
  return { id: evt.id, title: evt.title, sport: evt.sport, fmt: evt.fmt, fmtName: FMTN[evt.fmt], start: evt.start, endDay: evt.endDay, rules: evt.rules, money: evt.money, join: evt.join, takeText: takeText(evt.money), pot: potSummary(evt),
    entries: evt.entrants.length, people: people(evt), commName: (evt.members.find((m) => m.mk === evt.comm) || {}).name || '', started: now >= evt.start || !!evt.drawn, drawn: !!evt.drawn, /* P2: an early draw counts as the start everywhere */ locked: now >= evt.start || !!evt.drawn, fin: evt.fin || 0, inGroup: !!evt.group, entText: limits.ENTERPRISE_TEXT };
}
function full(evt, mk, now, cap) {
  const o = pub(evt, now), me = memberOf(evt, mk), comm = isComm(evt, mk); o.role = comm ? 'comm' : me ? me.role : 'none'; o.me = me ? me.pid : null; o.code = evt.code; o.cap = cap; o.u = evt.u || 0;
  o.myEntries = me ? evt.entrants.filter((e) => pidsOf(e).includes(me.pid)).map((e) => e.eid) : [];
  const seedIx = (id) => (evt.seeds || []).indexOf(id), odd = usesOdd(evt);
  o.entrants = evt.entrants.map((e) => ({ eid: e.eid, name: e.name, rating: e.rating == null ? null : e.rating, seed: seedIx(e.eid) + 1 || null, linked: pidsOf(e).length, open: (e.players || []).filter((p) => !p.pid).length, oddRating: e.or == null ? null : e.or,
    players: (e.players || []).map((p) => Object.assign({ gid: p.gid, name: p.name, guest: !p.pid, me: !!(me && p.pid === me.pid), blank: isBlank(p), paid: isBlank(p) ? false : seatPaid(evt, p) }, comm && !p.pid ? { claim: evt.code + '.' + p.ct } : {},
      odd && !isBlank(p) ? { odd: Number.isFinite(p.or) || p.orn ? { rating: Number.isFinite(p.or) ? p.or : null, matches: p.orn || 0, confirmed: Number.isFinite(p.orc) ? p.orc : Number.isFinite(p.or) ? p.orn || 0 : 0 } : null, trn: Number.isFinite(p.tv) ? { v: p.tv, at: p.tat || null, reason: p.treason || '' } : null, use: useR(p) } : {})) }));
  o.odd = odd; o.ent = !!ENTF.get(evt.id); o.tlog = (evt.tlog || []).slice(-100).reverse(); o.teams = UNITS[evt.rules.unit] > 1 && evt.fmt !== 'solo';
  o.members = evt.members.map((m) => ({ pid: m.pid, name: m.name, role: m.role, paid: !!m.paid, comm: m.mk === evt.comm, plays: evt.entrants.some((e) => pidsOf(e).includes(m.pid)) })); // plays: false = no entry owed (a non-playing organizer, a spectator)
  const np = evt.drawn ? [] : needPartner(evt); o.hold = np.length ? { names: np.map((e) => e.name), eids: np.map((e) => e.eid), late: now >= evt.start } : null; o.notice = evt.notice && now - evt.notice.at < 3 * DAY ? evt.notice : null; o.poHold = evt.poHold || null;
  o.matches = evt.matches.map((m) => { const s = sideOf(evt, mk, m); return { id: m.id, st: m.st, r: m.r, pool: m.pool, court: m.court, wave: m.wave, a: m.a, b: m.b, an: nameOf(evt, m.a), bn: nameOf(evt, m.b), state: m.state, games: m.games, win: m.win, v: m.v, live: !!m.live, start: m.start || null, exp: m.exp || null, forfeit: !!m.forfeit, reset: !!m.reset, rule: m.reset && evt.rules.reset === 'game15' ? { to: 15, winBy: 2, bestOf: 1 } : null,
    sub: m.sub ? { side: m.sub.side, games: m.sub.games, by: m.sub.by, at: m.sub.at, note: m.sub.note || '' } : null, mine: s, canScore: canScore(evt, mk, m, now).ok, canConfirm: canConfirm(evt, mk, m).ok, needsComm: m.state === 'disputed' || (m.state === 'pending' && !linked(evt, m.sub && m.sub.side === 'a' ? m.b : m.a)) }; });
  o.byes = evt.byes || {}; o.pools = evt.pools || null;
  if (evt.fmt === 'rr' && evt.drawn) { o.ties = openTies(evt).map((t) => ({ key: t.key, names: t.eids.map((e) => nameOf(evt, e)), game: t.game, matches: t.eids.length - 1 })); o.poStarted = poStarted(evt); o.hasPlayoff = !!evt.poSeeds; o.tbLog = Object.values(evt.tb || {}).map((t) => ({ how: t.how, at: t.at, by: t.by, text: t.text })); }
  if (evt.fmt === 'rr' && evt.drawn) o.tables = (evt.pools || []).map((p, i) => poolTable(evt, p, i).map((r) => Object.assign(r, { name: nameOf(evt, r.eid) })));
  if (evt.fmt === 'h2h' || evt.fmt === 'ladder' || evt.rules.side) o.records = h2hTable(evt).map((r) => Object.assign(r, { name: nameOf(evt, r.eid) }));
  if (evt.fmt === 'solo') o.solo = soloRows(evt);
  if (evt.ladder) o.ladder = evt.ladder.order.map((e, i) => ({ eid: e, name: nameOf(evt, e), rank: i + 1 }));
  o.final = !!evt.fin; o.canFinish = comm && evt.fmt === 'rr' && !evt.fin && !!evt.drawn && !!places(evt, now); o.autoFinAt = o.canFinish ? lastAt(evt) + RR_AUTO : null; // places before `final` are the places so far
  o.places = evt.places || places(evt, now); o.placeRows = o.places ? Object.entries(o.places).map(([e, p]) => ({ eid: e, name: nameOf(evt, e), place: p })).sort((a, b) => a.place - b.place) : null;
  if (evt.rules.pickem) o.pickem = pickemView(evt, me, now);
  o.flags = comm ? evt.matches.filter((m) => m.state === 'disputed' || (m.state === 'pending' && !linked(evt, m.sub.side === 'a' ? m.b : m.a))).length : 0;
  o.audit = (evt.audit || []).slice(-120).reverse(); Object.defineProperty(o, '_bill', { value: evt, enumerable: false, configurable: true, writable: true }); // for bill(): never serialized
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
const seats = (evt, eid) => { const e = evt.entrants.find((x) => x.eid === eid); return e ? (e.players || []).filter((p) => !isBlank(p)).map((p) => ({ gid: p.gid, pid: p.pid || null, name: p.name })) : []; };
// Playbook fix (manager, Nov 16 2026): every match record carries the ratings of the people in it, so the Oddable rating is a real Elo (beating a
// higher-rated opponent gains more). snapRatings reads each seat's lifetime Oddable rating (never a tournament rating) just before the result is saved.
async function snapRatings(evt, m) { const out = {}, RT = D.rt(); if (!m) return out; for (const eid of [m.a, m.b]) { const e = evt.entrants.find((x) => x.eid === eid); for (const p of (e && e.players) || []) { if (isBlank(p)) continue; try { const r = await RT.ratingFor(seatKey(evt, p), ratingSport(evt)), v = r && 'confirmedRating' in r ? r.confirmedRating : r && r.oddable ? r.oddable.rating : null; if (v != null && Number.isFinite(Number(v))) out[p.gid] = Math.round(Number(v)); } catch (x) {} } } return out; }
function settle(evt, m, now, snap) { // a confirmed result takes effect. The people on each side are frozen on the match (doubles: both players), with their ratings at that moment
  const withR = (list) => list.map((p) => (snap && snap[p.gid] != null ? Object.assign(p, { r: snap[p.gid] }) : p));
  m.pp = { a: withR(seats(evt, m.a)), b: withR(seats(evt, m.b)) }; RC.clear();
  if (m.st === 'lad') ladderApply(evt, m);
  tbAdvance(evt, now); advance(evt); courtsElim(evt); maybePlayoff(evt, now);
}

// ---------- pick'em (spectators and players pick every match before it starts) ----------
// "Later rounds worth more": winners bracket / playoff round r = 2^(r-1); losers bracket round r = 2^floor((r-1)/2); the grand final (and its reset)
// = 2^(winners rounds), always the most in a double elimination (it was a flat 4, less than a 16-entry bracket's winners final).
function pickPoints(evt, m) { if (evt.rules.weight !== 'round') return 1; const k = Math.max(1, ...(evt.matches || []).filter((x) => x.st === 'w').map((x) => x.r)); if (m.st === 'gf') return Math.pow(2, k); if (m.st === 'w' || m.st === 'po') return Math.pow(2, m.r - 1); if (m.st === 'l') return Math.pow(2, Math.floor((m.r - 1) / 2)); return 1; }
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
  return { mine: mine.m || {}, tb: mine.tb == null ? null : mine.tb, table: t.rows.map((r) => (tbOpen || (me && r.pid === me.pid) ? r : Object.assign({}, r, { tb: null }))), finalTotal: t.finalTotal, counts: cnt, open: evt.matches.filter((m) => pickable(m) && m.state === 'ready' && !pickLocked(evt, m, now) && m.a && m.b && m.a !== 'BYE' && m.b !== 'BYE' && !(me && sideOf(evt, me.mk, m))).map((m) => m.id), own: me ? evt.matches.filter((m) => pickable(m) && sideOf(evt, me.mk, m)).map((m) => m.id) : [], pts: (() => { const o = {}; evt.matches.forEach((m) => { if (pickable(m)) o[m.id] = pickPoints(evt, m); }); return o; })(),
    rounds: (() => { const by = {}; evt.matches.filter((m) => pickable(m) && m.state !== 'bye').forEach((m) => { const k = roundKey(m), p = (evt.plock || {})[k] || {}; const r = by[k] = by[k] || { key: k, label: matchLabel(m), lockAt: p.at || null, locked: false, how: null, matches: 0 }; r.matches++; if (!r.locked && pickLocked(evt, m, now)) { r.locked = true; r.how = p.locked ? 'button' : p.at && now >= p.at ? 'time' : 'play'; } }); return Object.values(by); })() };
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
async function core(req, res) { // the engine's own routes; on main reached ONLY through handle() below (the group gate)
  const path = req.url.split('?')[0]; if (!path.startsWith('/local')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  try {
    const b = req._lb || await body(req), ip = D.ip(req), op = req._lop || path.slice(7);
    if (op === 'peek') { // PUBLIC: a shared link shows only the event's title and kind before sign-up
      rate('peek', null, ip); if (codeBlocked('ec|i|' + ip)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.');
      const code = normCode(b.code), id = code ? await byCode(code) : null, evt = id ? (await load(id) || {}).data : null;
      if (!evt) { codeFail('ec|i|' + ip); throw bad(404, 'No event with that code'); }
      send(res, 200, { title: evt.title, kind: FMTN[evt.fmt] + ' · ' + evt.sport }); return true;
    }
    const u = await me(req), now = D.now();
    if (op === 'mine') {
      const ix = await D.S.dbGet(IDX), ev = Object.assign({}, (ix && ix.data && ix.data.ev) || {}, await idxQueued()), out = [];
      for (const id of Object.keys(ev)) { if (req._lg && ev[id].g !== req._lg.gid) continue; if (!req._lg && !(ev[id].mk || []).includes(u.mk)) continue; /* in a group: every game of the group (a member who is not in one sees it with role none and can join it) */ const r = await load(id); if (!r) continue; const evt = r.data; tick(evt, now); const o = pub(evt, now), m = memberOf(evt, u.mk); o.role = isComm(evt, u.mk) ? 'comm' : m ? m.role : 'none'; const mp = m && evt.places ? evt.entrants.filter((e) => pidsOf(e).includes(m.pid)).map((e) => evt.places[e.eid]).filter(Boolean)[0] : null; o.myPlace = mp || null; o.todo = evt.matches.filter((x) => canConfirm(evt, u.mk, x).ok || (x.state === 'ready' && canScore(evt, u.mk, x, now).ok && sideOf(evt, u.mk, x))).length; out.push(o); if (out.length >= 40) break; }
      out.sort((a, c) => (a.fin ? 1 : 0) - (c.fin ? 1 : 0) || a.start - c.start); send(res, 200, { events: out, now }); return true;
    }
    if (op === 'create') {
      rate('create', u.mk, ip); try { /* review 2: only a create that was written counts toward the 6 an hour (a 409 "Busy", a full game or a bad form gives the try back) */ const R = cleanRules(b, now), cap = await capFor(u.e, ''), isEnt = await entFor(u.e);
      const nm = cleanName(b.myName, 24) || 'Organizer'; let id; do { id = rnd(10); } while (await D.S.dbGet(ROW(id)));
      const evt = Object.assign({ id, code: newCode(), comm: u.mk, ce: u.e, created: now, u: now, members: [], entrants: [], matches: [], picks: {}, audit: [], ops: [] }, R);
      if (req._lg) evt.group = { gid: req._lg.gid, cid: '' }; // main: made inside a group (the gate checked the commissioner); never from the body
      evt.members.push({ pid: newPid(evt), mk: u.mk, ak: u.e, name: nm, role: 'comm', joined: now, paid: false });
      const list = Array.isArray(b.entrants) ? b.entrants.slice(0, cap) : []; list.forEach((x) => addEntrant(evt, x && x.name, x && x.rating, u.mk, now));
      if (b.playIn) { const e = addEntrant(evt, b.entryName || nm, b.myRating, u.mk, now); e.players[0].pid = evt.members[0].pid; e.players[0].name = nm; }
      if (people(evt) > cap) throw bad(403, fullMsg(cap));
      ENTF.set(id, isEnt); if (isEnt && usesOdd(evt)) { try { await D.rt().eventSetup(u.e, id, { title: evt.title, sport: ratingSport(evt), lockAt: evt.start }); } catch (x) { if (!x.status) console.error('local eventSetup:', x.message); } } // E-H: register the Enterprise tournament with the rating module
      await prepRatings(evt); audit(evt, now, nm, 'create', null, 'Event created'); tick(evt, now);
      await idxPre(evt); /* N2: the index lists the game before its row exists */ try { await D.S.dbPut({ id: ROW(id), salt: 'x', pinhash: 'x', data: evt, updated: now }, true); } catch (x) { await idxSafe(id).catch(() => {}); throw x; } await idxSafe(id); req._lout = evt;
      send(res, 200, { event: full(evt, u.mk, now, cap) }); return true; } catch (x) { unrate('create', u.mk, ip); throw x; }
    }
    if (op === 'preview' || op === 'join') {
      if (codeBlocked('ec|a|' + u.mk) || codeBlocked('ec|i|' + ip)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.');
      rate('join', u.mk, ip); const code = normCode(b.code), id = code ? await byCode(code) : null;
      if (!id) { codeFail('ec|a|' + u.mk); codeFail('ec|i|' + ip); throw bad(404, 'No event with that code'); }
      if (op === 'preview') { const r = await load(id); if (!r) throw bad(404, 'No event with that code'); const evt = r.data; tick(evt, now); const cap = await capOf(evt); const o = memberOf(evt, u.mk) ? full(evt, u.mk, now, cap) : Object.assign(pub(evt, now), { role: 'none', cap, open: !evt.join.self ? [] : evt.entrants.filter((e) => (e.players || []).some(isBlank)).map((e, i) => ({ eid: e.eid, name: pidsOf(e).length ? e.name : 'Open spot ' + (i + 1), open: (e.players || []).filter(isBlank).length, seats: (e.players || []).filter(isBlank).map((p) => ({ gid: p.gid, name: 'Partner spot' })) })) }, req._lg ? { entrants: groupEntrants(evt) } : {}); send(res, 200, { event: o }); return true; }
      const r0 = await load(id), cap = r0 ? await capOf(r0.data) : 8, as = b.as === 'spectator' ? 'spectator' : 'player', nm = cleanName(b.myName, 24) || 'Player';
      const evt = await mutate(id, (evt, now) => {
        const m0 = memberOf(evt, u.mk); if (m0 && (as === 'spectator' || evt.entrants.some((e) => pidsOf(e).includes(m0.pid)))) return { nochange: true, v: evt };
        if (as === 'player' && (now >= evt.start || evt.drawn)) throw bad(409, 'Entries closed when the event started' + (evt.join.spectators ? '. You can still join to watch' + (evt.rules.pickem ? ' and pick' : '') + '.' : '.'));
        if (as === 'spectator' && !evt.join.spectators) throw bad(409, 'This event has no spectators');
        let m = m0; if (!m) { m = { pid: newPid(evt), mk: u.mk, ak: u.e, name: nm, role: as, joined: now, paid: false }; evt.members.push(m); restorePicks(evt, m); }
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
      await idxSafe(id); send(res, 200, { event: full(evt, u.mk, now, cap) }); return true;
    }
    if (op === 'claim') { // a guest typed in by name claims their seat (and every result it has) into this account: code + the guest's claim token
      if (codeBlocked('ec|a|' + u.mk) || codeBlocked('ec|i|' + ip)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.'); rate('join', u.mk, ip);
      const parts = String(b.claim || '').toUpperCase().split('.'), code = normCode(parts[0]), ct = String(parts[1] || '').replace(/[^A-Z0-9]/g, ''), eid0 = code && ct.length === 10 ? await byCode(code) : null;
      if (!eid0) { codeFail('ec|a|' + u.mk); codeFail('ec|i|' + ip); throw bad(404, 'That claim code does not match'); }
      const nm = cleanName(b.myName, 24) || 'Player';
      const evt = await mutate(eid0, (evt, now) => { let seat = null, ent = null; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (!p.pid && p.ct && sameCode(p.ct, ct)) { seat = p; ent = e; } }));
        if (!seat) { const m1 = memberOf(evt, u.mk); let mineAlready = false; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (m1 && p.pid === m1.pid && p.ct && sameCode(p.ct, ct)) mineAlready = true; })); if (mineAlready) return { nochange: true, v: evt }; /* S1: the same claim again (a retry after a lost answer) = success */ codeFail('ec|a|' + u.mk); codeFail('ec|i|' + ip); throw bad(404, 'That claim code does not match (or was already used)'); }
        let m = memberOf(evt, u.mk); if (m && pidsOf(ent).includes(m.pid)) throw bad(409, 'You are already in ' + ent.name);
        const mine = m && evt.entrants.find((e) => pidsOf(e).includes(m.pid)); if (mine) throw bad(409, 'You already have an entry in this event (' + mine.name + '). One account, one entry: a claim code cannot add a second.');
        if (!m) { m = { pid: newPid(evt), mk: u.mk, ak: u.e, name: nm, role: 'player', joined: now, paid: false }; evt.members.push(m); restorePicks(evt, m); } else if (m.role === 'spectator') m.role = 'player';
        seat.orig = seat.orig || seat.name; seat.pid = m.pid; seat.claimed = now; if (seat.paid) m.paid = true; /* the organizer had marked the typed-in player paid */ audit(evt, now, m.name, 'claim', null, 'Claimed the guest seat "' + seat.name + '" in ' + ent.name); return evt; });
      await idxSafe(eid0); send(res, 200, { event: full(evt, u.mk, now, await capOf(evt)) }); return true;
    }
    const id = String(b.id || ''); const r0 = await load(id); if (!r0) throw bad(404, 'Event not found');
    const known = memberOf(r0.data, u.mk); if (!known) throw bad(404, 'Event not found'); // private: members only (non-members use the invite code)
    const cap = await capOf(r0.data), isEnt = !!ENTF.get(id);
    if (op === 'get') {
      if (op === 'get' && b.since && Number(b.since) === Number(r0.data.u) && !(r0.data.start <= now && !r0.data.drawn) && !r0.data.matches.some((m) => m.exp && now > m.exp && m.state === 'ready') && !(r0.data.endDay && !r0.data.fin && now > chiEnd(r0.data.endDay)) && !Object.values(r0.data.plock || {}).some((p) => p.at && now >= p.at && now - p.at < 90e3) && !(r0.data.fmt === 'rr' && !r0.data.fin && r0.data.drawn && rrAuto(r0.data, now))) { send(res, 200, { same: true, u: r0.data.u }); return true; } // cheap poll (review fix 10c: not after the last day)
      const evt = await mutate(id, (evt) => ({ nochange: true, v: evt })) || r0.data; send(res, 200, { event: full(evt, u.mk, now, cap) }); return true;
    }
    const ok = (evt) => { send(res, 200, { event: full(evt, u.mk, D.now(), cap) }); return true; };
    const comm = (evt) => { if (!isComm(evt, u.mk)) throw bad(403, 'Only the commissioner can do that'); };
    const notLocked = (evt, now) => { if (now >= evt.start || evt.drawn) throw bad(409, 'Rules are locked. The event has started.'); };
    if (op === 'edit') { const evt = await mutate(id, (evt, now) => { comm(evt); notLocked(evt, now); const R = cleanRules(b, now); Object.assign(evt, R); if (people(evt) > cap) throw bad(403, fullMsg(cap)); audit(evt, now, 'Commissioner', 'edit', null, 'Rules changed'); return evt; }); if (isEnt && usesOdd(evt)) { try { await D.rt().eventSetup(u.e, id, { title: evt.title, sport: ratingSport(evt), lockAt: evt.start }); } catch (x) {} } await idxSafe(id); return ok(evt); }
    if (op === 'entrant') { // commissioner adds / renames / re-rates / removes / moves an entry, before the draw
      const evt = await mutate(id, (evt, now) => { comm(evt);
        // At the start a pair with an empty partner spot holds the draw: until it is made the commissioner may only name the missing partner or remove that entry.
        const fixing = holdFix(evt, now); if (!fixing) notLocked(evt, now); else if (!((b.do === 'partner' || b.do === 'remove') && needPartner(evt).some((e) => e.eid === String(b.eid)))) throw bad(409, 'Rules are locked. Only an entry with an empty partner spot can be completed or removed now.');
        if (b.do === 'partner') { const e = evt.entrants.find((x) => x.eid === String(b.eid)), seat = e && (e.players || []).find(isBlank); if (!e) throw bad(404, 'That entry is gone'); if (!seat) throw bad(409, e.name + ' has no empty spot'); const nm = cleanName(b.name, 24); if (nm.length < 1) throw bad(400, "Type the partner's name"); if (/^(Partner \d|Open seat)$/.test(nm)) throw bad(400, 'Type a real name');
          const first = e.players[0].name; seat.name = nm; delete seat.blank; seat.ct = rnd(10); if (e.name === first) e.name = cleanName(e.players.filter((p) => !isBlank(p)).map((p) => p.name).join(' / '), 40) || e.name; audit(evt, now, 'Commissioner', 'entries', null, 'Partner added: ' + nm + ' with ' + first); return evt; }
        if (b.do === 'add') { addEntrant(evt, b.name, b.rating, u.mk, now); if (people(evt) > cap) throw bad(403, fullMsg(cap)); }
        else { const e = evt.entrants.find((x) => x.eid === String(b.eid)); if (!e) throw bad(404, 'That entry is gone');
          if (b.do === 'remove') evt.entrants = evt.entrants.filter((x) => x !== e);
          else if (b.do === 'edit') { const nm = cleanName(b.name, 40); if (nm) e.name = nm; if (b.rating !== undefined) { const r = b.rating === '' || b.rating == null ? null : Number(b.rating); if (r !== null && !(Number.isFinite(r) && r >= 0 && r <= 9999)) throw bad(400, 'Rating: 0 to 9999'); e.rating = r === null ? null : Math.round(r * 1000) / 1000; } }
          else if (b.do === 'up' || b.do === 'down') { const i = evt.entrants.indexOf(e), j = i + (b.do === 'up' ? -1 : 1); if (j >= 0 && j < evt.entrants.length) [evt.entrants[i], evt.entrants[j]] = [evt.entrants[j], evt.entrants[i]]; }
          else throw bad(400, 'Unknown change'); }
        audit(evt, now, 'Commissioner', 'entries', null, 'Entries changed (' + evt.entrants.length + ')'); return evt; });
      return ok(evt);
    }
    if (op === 'draw') { // an early draw locks the tournament ratings in the rating module too, but ONLY once the draw has really been made (a refused draw locks nothing)
      const early = !r0.data.drawn && now < r0.data.start; const evt = await mutate(id, (evt, now) => { comm(evt); if (evt.drawn) return { nochange: true, v: evt }; draw(evt, now); return evt; });
      if (early && evt.drawn && isEnt && usesOdd(evt)) { try { await D.rt().eventSetup(u.e, id, { title: evt.title, sport: ratingSport(evt), lockAt: evt.drawn }); } catch (x) { if (!x.status) console.error('local eventSetup (draw):', x.message); } }
      return ok(evt); }
    if (op === 'leave') { const evt = await mutate(id, (evt, now) => { const m = memberOf(evt, u.mk); if (isComm(evt, u.mk)) throw bad(409, 'The commissioner cannot leave. Delete the event instead (before it starts).'); const inE = evt.entrants.some((e) => pidsOf(e).includes(m.pid)); if (inE && (now >= evt.start || evt.drawn)) throw bad(409, 'The event has started. Players stay to the end.'); evt.entrants.forEach((e) => (e.players || []).forEach((p, i) => { if (p.pid === m.pid) { p.pid = null; p.name = p.orig || (p.blank ? 'Partner ' + (i + 1) : 'Open seat'); p.ct = rnd(10); if (p.orig && m.paid) p.paid = true; else if (!p.orig) delete p.paid; delete p.claimed; delete p.orig; } })); /* review fix 9: the guest gets its name back and a NEW claim code */ evt.entrants = evt.entrants.filter((e) => !(e.by === u.mk && !pidsOf(e).length && !isComm(evt, e.by))); evt.members = evt.members.filter((x) => x !== m); if (evt.picks[m.pid]) { evt.pk = evt.pk || {}; evt.pk[m.mk] = evt.picks[m.pid]; delete evt.picks[m.pid]; } /* G16: picks belong to the account; rejoining brings them back, still locked */ return evt; }); await idxSafe(id); send(res, 200, { ok: true }); return true; }
    if (op === 'delete') { await mutate(id, (evt, now) => { comm(evt); notLocked(evt, now); evt.deleted = now; evt.code = ''; return evt; }); await idxSafe(id); send(res, 200, { ok: true }); return true; }
    if (op === 'paid') { const evt = await mutate(id, (evt, now) => { comm(evt);
      if (b.gid) { let seat = null; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (p.gid === String(b.gid) && !p.pid && !isBlank(p)) seat = p; })); if (!seat) throw bad(404, 'That typed-in player is not in the event'); if (!!seat.paid === !!b.paid) return { nochange: true, v: evt }; seat.paid = !!b.paid; audit(evt, now, 'Commissioner', 'paid', null, seat.name + ' (typed-in player)' + (seat.paid ? ' marked paid' : ' marked not paid')); return evt; }
      const m = evt.members.find((x) => x.pid === String(b.pid || '')); if (!m) throw bad(404, 'Not in the event'); if (b.paid && !evt.entrants.some((e) => pidsOf(e).includes(m.pid))) throw bad(409, m.name + ' is not playing, so no entry is owed'); if (!!m.paid === !!b.paid) return { nochange: true, v: evt }; m.paid = !!b.paid; audit(evt, now, 'Commissioner', 'paid', null, m.name + (m.paid ? ' marked paid' : ' marked not paid')); return evt; }); return ok(evt); }
    if (op === 'finish') { const evt = await mutate(id, (evt, now) => { comm(evt); if (evt.fmt === 'se' || evt.fmt === 'de') throw bad(409, 'A bracket finishes when its last match is confirmed'); if (now < evt.start && !evt.drawn) throw bad(409, 'Not started yet');
      if (evt.fmt === 'rr' && !places(evt, now)) throw bad(409, openTies(evt).length ? 'A tie for a prize or a playoff spot is still open. Settle it first (Standings).' : evt.poHold ? 'The playoff was reset. Redraw it first (Standings).' : 'Every match needs a confirmed score before the round robin can finish.'); if (evt.done) return { nochange: true, v: evt }; evt.done = now; audit(evt, now, 'Commissioner', 'finish', null, 'Event finished'); tick(evt, now); return evt; }); await idxSafe(id); return ok(evt); }
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
      const e0 = r0.data, RT = D.rt(); comm(e0); if (!isEnt) throw bad(403, 'Tournament ratings are for Enterprise events (courses, clubs and leagues). ' + limits.ENTERPRISE_TEXT); if (!usesOdd(e0)) throw bad(409, 'This event does not use the Oddable rating');
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
    // The commissioner resets a playoff that has started (the only way to correct a pool / tiebreak result after that). Its results are wiped, the reason
    // is logged and every member gets a notice. The bracket is redrawn from the table when the commissioner taps Redraw (after the corrections).
    if (op === 'poreset') { const evt = await mutate(id, (evt, now) => { comm(evt); notFin(evt); if (evt.fmt !== 'rr' || !evt.poSeeds) throw bad(409, 'There is no playoff to reset'); const reason = cleanName(b.reason, 120); if (reason.length < 2) throw bad(400, 'Give a reason (everyone sees it)');
        const n = evt.matches.filter((x) => x.st === 'po' && PLAYED.has(x.state)).length, by = myName(evt); dropPlayoff(evt); evt.poHold = { at: now, by, reason };
        evt.notice = { at: now, by, text: 'The commissioner reset the playoff: ' + reason + '. ' + (n ? n + ' playoff result' + (n > 1 ? 's were' : ' was') + ' wiped. ' : '') + 'The bracket will be redrawn from the standings.' }; audit(evt, now, by + ' (commissioner)', 'playoff', null, 'Playoff reset (' + n + ' result' + (n === 1 ? '' : 's') + ' wiped). Reason: ' + reason); return evt; }); return ok(evt); }
    if (op === 'poredraw') { const evt = await mutate(id, (evt, now) => { comm(evt); notFin(evt); if (!evt.poHold) return { nochange: true, v: evt }; if (openTies(evt).length) throw bad(409, 'A tie for a playoff spot is open. Settle it first.'); delete evt.poHold; maybePlayoff(evt, now); evt.notice = { at: now, by: myName(evt), text: 'The playoff was redrawn from the corrected standings.' }; return evt; }); return ok(evt); }
    if (op === 'tiebreak') { // round robin: a tie the rulebook order could not break. The organizer chooses a playoff match (two entries) or a coin flip; logged.
      const evt = await mutate(id, (evt, now) => { comm(evt); notFin(evt); const t = openTies(evt).find((x) => x.key === String(b.key || '')); if (!t) throw bad(409, 'That tie is already decided'); if (t.game || (evt.tb && evt.tb[t.key])) throw bad(409, 'A tiebreak playoff is already set. Enter its score.');
        const how = b.how === 'game' ? 'game' : b.how === 'coin' || b.how == null ? 'coin' : null; if (!how) throw bad(400, 'Choose a coin flip (the default) or a playoff'); /* manager, Nov 16 2026: coin flip is the default; the playoff is a house rule */ evt.tb = evt.tb || {}; const names = t.eids.map((e) => nameOf(evt, e)), by = myName(evt), why = ' (level after every tiebreak step)';
        const shuffle = (a) => { const o = a.slice(); for (let i = o.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [o[i], o[j]] = [o[j], o[i]]; } return o; };
        if (how === 'game') { const ladder = shuffle(t.eids), n = ladder.length - 1; const drawn = ladder.map((e) => nameOf(evt, e)), house = n > 1 ? 'House rule (not in the rulebook): playoff, order drawn at random: ' + drawn.join(', then ') + ' (' + drawn[n] + ' plays ' + drawn[n - 1] + ' first; the winner plays the next one up)' : 'Tiebreak playoff: one match, ' + drawn.join(' v ');
          evt.tb[t.key] = { how, ladder, ms: [], pool: t.pool, at: now, by, house: n > 1, text: house };
          audit(evt, now, by + ' (commissioner)', 'tiebreak', null, 'Tie between ' + names.join(', ') + why + '. ' + house); tbAdvance(evt, now); }
        else { const order = shuffle(t.eids), txt = order.map((e) => nameOf(evt, e)).join(', then ');
          evt.tb[t.key] = { how, order, at: now, by, text: 'Coin flip: ' + txt }; audit(evt, now, by + ' (commissioner)', 'tiebreak', null, 'Tie between ' + names.join(', ') + why + ': the organizer chose a coin flip. Oddable flipped: ' + txt); }
        return evt; });
      await idxSafe(id); return ok(evt);
    }
    // P1 (owner Nov 16 2026): "Suggest partners" for doubles / team events. Any member may look; only the commissioner applies a split, before the start.
    if (op === 'partners') {
      const evt = await mutate(id, (evt) => ({ nochange: true, v: evt })) || r0.data; const size = UNITS[evt.rules.unit] || 1; if (size < 2 || evt.fmt === 'solo') throw bad(409, 'Partner suggestions are for doubles and team events');
      const seatsAll = []; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (!isBlank(p)) seatsAll.push(p); }));
      const players = seatsAll.map((p) => ({ id: p.gid, name: p.name, rating: Number.isFinite(p.tv) ? p.tv : Number.isFinite(p.or) ? p.or : 1500 })) /* the module's `use`. main: pairing.js counts a missing rating at the middle of the known ones, so a new player goes in as 1500 here (owner H1: no games yet = 1500, as the screen says) */, history = await pairHistory(evt);
      const mode = ['balanced', 'rotate', 'hot'].includes(b.mode) ? b.mode : 'balanced', fn = D.pairing() || require('./pairing').suggestPartners;
      send(res, 200, { mode, teamSize: size, players: players.length, history: history.length, ratings: seatsAll.map((p) => ({ id: p.gid, name: p.name, use: Number.isFinite(p.tv) ? p.tv : Number.isFinite(p.or) ? p.or : null, tournament: Number.isFinite(p.tv) ? p.tv : null, oddable: Number.isFinite(p.or) ? p.or : null, matches: p.orn || 0, confirmed: Number.isFinite(p.orc) ? p.orc : Number.isFinite(p.or) ? p.orn || 0 : 0 })), locked: now >= evt.start || !!evt.drawn, suggestions: fn(players, { mode, teamSize: size, history }) }); return true;
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
    const snap = op === 'score' || op === 'confirm' ? await snapRatings(r0.data, r0.data.matches.find((x) => x.id === String(b.m || ''))) : null;
    if (op === 'score') {
      rate('score', u.mk, ip); const evt = await mutate(id, (evt, now) => {
        if (opSeen(evt)) return { nochange: true, v: evt }; // offline queue resend: already saved
        notFin(evt); const m = findM(evt); vOk(m); const c = canScore(evt, u.mk, m, now); if (!c.ok) throw bad(403, c.why);
        const g = checkGames(ruleOf(evt, m), b.games); m.v++; m.live = m.live || now;
        const s0 = sideOf(evt, u.mk, m), asComm = isComm(evt, u.mk) && (!s0 || m.state === 'disputed' || !linked(evt, s0 === 'a' ? m.b : m.a)); // a commissioner playing in the match enters like any player (the opponent confirms); final only on a dispute or vs a guest
        if (asComm) { const was = m.state === 'confirmed' ? m.win : null; if (was && was !== g.win && downstreamPlayed(evt, m)) throw bad(409, 'Later matches are already played. Fix those first.'); if (m.st === 'lad' && m.state === 'confirmed') throw bad(409, 'Ladder results cannot be changed after they move the ladder'); if (was && (m.st === 'pool' || m.st === 'tb')) reflow(evt, m, was !== g.win, now); /* review fix 3 + tiebreak-playoff corrections */ Object.assign(m, { games: g.games, win: g.win, state: 'confirmed', sub: { side: 'comm', games: g.games, by: myName(evt), at: now }, at: now, cf: { by: 'comm', at: now } }); if (was && m.st === 'pool') pruneTb(evt); audit(evt, now, myName(evt) + ' (commissioner' + (s0 ? ', own match' : '') + ')', was ? 'correct' : 'final', m.id, scoreText(evt, m)); settle(evt, m, now, snap); }
        else { const s = sideOf(evt, u.mk, m); m.state = 'pending'; m.sub = { side: s, games: g.games, win: g.win, by: myName(evt), at: now }; audit(evt, now, myName(evt), 'score', m.id, scoreText(evt, Object.assign({}, m, { win: g.win, games: g.games })) + ' (waiting for ' + (linked(evt, s === 'a' ? m.b : m.a) ? 'the other side' : 'the commissioner') + ' to confirm)'); }
        return evt; }).catch(async (e) => { if (e && e.code === 'postarted') { try { await mutate(id, (evt, now) => { audit(evt, now, myName(evt) + ' (commissioner)', 'refused', String(b.m || ''), 'Correction refused: the playoff has started, so pool and tiebreak results are final unless the commissioner resets the playoff'); return evt; }); } catch (x) {} } throw e; });
      return ok(evt);
    }
    if (op === 'confirm' || op === 'dispute') {
      const evt = await mutate(id, (evt, now) => { if (opSeen(evt)) return { nochange: true, v: evt }; notFin(evt); const m = findM(evt); vOk(m); const c = canConfirm(evt, u.mk, m); if (!c.ok) throw bad(403, 'Only the other side (or the commissioner) can ' + op + ' this score'); m.v++;
        if (op === 'confirm') { Object.assign(m, { games: m.sub.games, win: m.sub.win, state: 'confirmed', at: now, cf: { by: c.comm ? 'comm' : 'opp', name: myName(evt), at: now } }); /* cf: who made it final. Only 'opp' (an account on the other side) is a confirmed, rated result */ audit(evt, now, myName(evt) + (c.comm ? ' (commissioner)' : ''), 'confirm', m.id, scoreText(evt, m)); settle(evt, m, now, snap); }
        else { if (c.comm) throw bad(400, 'Commissioner: enter the right score instead'); m.state = 'disputed'; m.sub.note = cleanName(b.note, 120); audit(evt, now, myName(evt), 'dispute', m.id, 'Disputed' + (m.sub.note ? ': ' + m.sub.note : '') + '. The commissioner decides.'); }
        return evt; });
      return ok(evt);
    }
    if (op === 'live') { const evt = await mutate(id, (evt, now) => { notFin(evt); const m = findM(evt); if (m.live || m.state !== 'ready') return { nochange: true, v: evt }; if (!isComm(evt, u.mk) && !sideOf(evt, u.mk, m)) throw bad(403, 'Only the players or the commissioner start a match'); m.live = now; m.v++; audit(evt, now, myName(evt), 'start', m.id, 'Match started (picks locked)'); return evt; }); return ok(evt); }
    if (op === 'pick') {
      rate('score', u.mk, ip); const evt = await mutate(id, (evt, now) => { if (!evt.rules.pickem) throw bad(409, 'This event has no pick\'em'); const pm = memberOf(evt, u.mk), P = evt.picks[pm.pid] = evt.picks[pm.pid] || { m: {} };
        // Locked on entry, like group bets (G16): the server stamps a pick the moment it is made and it can never be changed or removed. The same pick sent again is fine (resend).
        let changed = false;
        if (b.tb !== undefined) { const fm = finalMatch(evt); if (fm && pickLocked(evt, fm, now)) throw bad(409, 'The final has started. The tiebreak is locked.'); const t = Number(b.tb); if (!(Number.isInteger(t) && t >= 0 && t <= 999)) throw bad(400, 'Tiebreak: total points in the final, 0 to 999'); if (P.tb != null && P.tb !== t) throw bad(409, 'Your tiebreak guess is locked. It cannot be changed once made.'); if (P.tb == null) { P.tb = t; P.tbAt = now; changed = true; } }
        if (b.m) { const m = findM(evt); if (!pickable(m)) throw bad(409, 'This match is not part of the pick\'em'); if (sideOf(evt, u.mk, m)) throw bad(403, 'You are playing in this match, so you cannot pick it. Pick the other matches.'); /* manager, Nov 16 2026 */ if (pickLocked(evt, m, now)) throw bad(409, lockWhy(evt, m, now)); if (!(m.state === 'ready' && m.a && m.b)) throw bad(409, 'This match is not set yet'); if (!['a', 'b'].includes(b.side)) throw bad(400, 'Pick a side'); const had = P.m[m.id]; if (had && had.s !== b.side) throw bad(409, 'Your pick is locked. Picks cannot be changed once made.'); if (!had) { P.m[m.id] = { s: b.side, t: now }; changed = true; } }
        if (!changed) return { nochange: true, v: evt }; P.last = now; return evt; });
      return ok(evt);
    }
    if (op === 'picklock') { // the commissioner sets a round's lock time, or locks its picks now
      const evt = await mutate(id, (evt, now) => { comm(evt); notFin(evt); if (!evt.rules.pickem) throw bad(409, 'This event has no pick\'em'); const k = String(b.round || ''), ms = evt.matches.filter((m) => pickable(m) && roundKey(m) === k); if (!ms.length) throw bad(404, 'No such round');
        if (ms.some((m) => pickLocked(evt, m, now))) throw bad(409, 'Picks for this round are already locked'); evt.plock = evt.plock || {}; const p = evt.plock[k] = evt.plock[k] || {}, lab = matchLabel(ms[0]), by = myName(evt);
        if (b.lock === true) { p.locked = now; p.by = by; audit(evt, now, by + ' (commissioner)', 'picklock', null, lab + ': picks locked now'); }
        else if (b.at === null || b.at === '') { delete p.at; audit(evt, now, by + ' (commissioner)', 'picklock', null, lab + ': lock time removed (still locks when its first match starts)'); }
        else { const at = Number(b.at); if (!(Number.isFinite(at) && at > now && at < now + 400 * DAY)) throw bad(400, 'The lock time must be in the future'); p.at = at; p.by = by; audit(evt, now, by + ' (commissioner)', 'picklock', null, lab + ': picks lock at ' + new Date(at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'); }
        return evt; });
      return ok(evt);
    }
    if (op === 'challenge') { // ladder challenge, heads-up challenge, or a side match
      rate('score', u.mk, ip); const evt = await mutate(id, (evt, now) => {
        const pm = memberOf(evt, u.mk), cm = isComm(evt, u.mk), A = evt.entrants.find((e) => e.eid === String(b.a)), B = evt.entrants.find((e) => e.eid === String(b.b));
        if (!A || !B || A === B) throw bad(400, 'Pick two different entries');
        if (!cm && !pidsOf(A).includes(pm.pid)) throw bad(403, 'Challenge from your own entry');
        if (now < evt.start && !evt.drawn) throw bad(409, 'Challenges open when the game starts'); /* P2: an early draw is the start (the ladder is set, the phone shows it live) */ if (evt.fin || evt.done) throw bad(409, 'The event is finished');
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
  } catch (e) { if (!e.status) console.error('local:', process.env.EVT_DEBUG ? e.stack : e.message); send(res, e.status || 500, { error: e.status ? e.message : 'Pickleball error, try again' }); return true; }
}
const poStarted = (evt) => evt.matches.some((x) => x.st === 'po' && (x.live || PLAYED.has(x.state)));
function dropMatches(evt, list) { const ids = new Set(list.map((x) => x.id)); if (!ids.size) return; evt.matches = evt.matches.filter((x) => !ids.has(x.id)); Object.values(evt.picks || {}).concat(Object.values(evt.pk || {})).forEach((p) => { Object.keys(p.m || {}).forEach((k) => { if (ids.has(k)) delete p.m[k]; }); }); } // picks on a match that no longer exists go with it (the new bracket may reuse the id for other players)
function dropPlayoff(evt) { dropMatches(evt, evt.matches.filter((x) => x.st === 'po')); delete evt.poSeeds; Object.keys(evt.plock || {}).forEach((k) => { if (k.startsWith('p|')) delete evt.plock[k]; }); }
// A confirmed pool or tiebreak-playoff result is corrected by the commissioner: nothing that people already played on top of it may be re-flowed.
function reflow(evt, m, flipped, now) {
  if (m.st === 'tb' && flipped) { const t = Object.values(evt.tb || {}).find((x) => (x.ms || []).includes(m.id)); if (t) { const i = t.ms.indexOf(m.id), later = t.ms.slice(i + 1).map((id) => evt.matches.find((x) => x.id === id)).filter(Boolean); if (later.some((x) => x.live || PLAYED.has(x.state))) throw bad(409, 'The next tiebreak match was already played from this result. It cannot be changed.'); t.ms = t.ms.slice(0, i + 1); dropMatches(evt, later); } }
  if (!evt.poSeeds || (m.st === 'tb' && !flipped)) return; // a tiebreak match only orders the tied entries: the same winner = the same playoff
  if (poStarted(evt)) throw Object.assign(bad(409, 'The playoff has started, so pool and tiebreak results are final. To correct one, the commissioner resets the playoff first (Standings, Reset the playoff): its results so far are wiped and everyone is told why.'), { code: 'postarted' });
  dropPlayoff(evt); audit(evt, now, 'Oddable', 'playoff', null, (m.st === 'tb' ? 'Tiebreak' : 'Pool') + ' result corrected: playoff redrawn');
}
function pruneTb(evt) { // after a pool correction: a tiebreak choice for a tie that no longer exists is dropped, unless one of its matches was played
  const used = new Set(); (evt.pools || []).forEach((p, i) => poolTable(evt, p, i).forEach((r) => { if (r.tbKey) used.add(r.tbKey); if (r.tie) used.add(r.tie); }));
  Object.keys(evt.tb || {}).forEach((k) => { if (used.has(k)) return; const ms = (evt.tb[k].ms || []).map((id) => evt.matches.find((x) => x.id === id)).filter(Boolean); if (ms.some((x) => x.live || PLAYED.has(x.state))) return; dropMatches(evt, ms); delete evt.tb[k]; });
}
const restorePicks = (evt, m) => { if (evt.pk && evt.pk[m.mk]) { evt.picks[m.pid] = evt.pk[m.mk]; delete evt.pk[m.mk]; } };
function downstreamPlayed(evt, m) { const kids = evt.matches.filter((x) => x.fa && ((x.fa.m === m.id) || (x.fb && x.fb.m === m.id))); return kids.some((k) => PLAYED.has(k.state) || k.live || downstreamPlayed(evt, k)); }
function scoreText(evt, m) { const w = m.win === 'a' ? m.a : m.b, l = m.win === 'a' ? m.b : m.a; return nameOf(evt, w) + ' beat ' + nameOf(evt, l) + ' ' + m.games.map(([x, y]) => (m.win === 'a' ? x + '-' + y : y + '-' + x)).join(', '); }

// ---------- lifetime stats contract (consumed by the stats coder) ----------
// statsFor(userKey, {from, to}) -> normalized records. userKey = the account id from acct.who(req) (same key the groups/limits code uses).
// One record per match the user played (confirmed or forfeited), one per finished event (place), one per finished bracket pick'em (kind 'contest').
// `score` is numeric only (the stats contract): solo events put their number there; game scores are in extra.games / extra.scoreText.
// RATED / CONFIRMED (manager, Nov 16 2026; the rating maths itself lives in the stats module, ratings.js): a match counts toward the Oddable rating only
// when an ACCOUNT on the other side confirmed it (m.cf.by === 'opp'). Never: a result the commissioner made final (typed-in guests, self-entered
// heads-up results, disputes), a forfeit (clock or walkover), a heads-up or side match in an event with fewer than 3 player accounts, or more than
// 2 matches against the same opponents in one day. Those still appear as records, `verified: false`, `extra.confirmed: false` + `extra.unrated` (why).
// Sent for the rating: extra.confirmed, extra.confirmedBy {name, at}, extra.oppRating, extra.partnerRating, extra.oppKey (the same opponents in any event).
const recOrder = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || ((a.extra && a.extra.at) || 0) - ((b.extra && b.extra.at) || 0) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0); // date, entry time, id: the stats module's one order (ratings.js `order`)
async function statsFor(userKey, opt) {
  const mk = mkOf(userKey), from = (opt && opt.from) || '0000-00-00', to = (opt && opt.to) || '9999-99-99', ix = await D.S.dbGet(IDX), ev = (ix && ix.data && ix.data.ev) || {}, out = [], now = D.now();
  for (const id of Object.keys(ev)) {
    if (!(ev[id].mk || []).includes(mk)) continue; const r = await load(id); if (!r) continue; const evt = r.data; tick(evt, now); const m0 = memberOf(evt, mk); if (!m0) continue;
    const myGids = new Set(); evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (p.pid === m0.pid) myGids.add(p.gid); })); // seats this account holds (typed-in guest seats it claimed included)
    const mySide = (pp) => (pp && pp.a.some((p) => myGids.has(p.gid)) ? 'a' : pp && pp.b.some((p) => myGids.has(p.gid)) ? 'b' : null);
    const base = { src: 'events', sport: STAT_SPORT[evt.sport] || 'other', game: evt.sport, groupId: evt.group ? evt.group.gid : undefined, contestId: evt.group ? evt.group.cid : undefined };
    const accts = new Set(); evt.entrants.forEach((e) => pidsOf(e).forEach((p) => accts.add(p))); const mkOfPid = {}; evt.members.forEach((m) => (mkOfPid[m.pid] = m.mk));
    evt.matches.filter((m) => m.state === 'confirmed' && m.pp).forEach((m) => {
      const side = mySide(m.pp); if (!side) return; const opp = side === 'a' ? m.b : m.a, mine = m.pp[side], theirs = m.pp[side === 'a' ? 'b' : 'a'], meSeat = mine.find((p) => myGids.has(p.gid));
      const games = m.games.map(([x, y]) => (side === 'a' ? [x, y] : [y, x])), diff = games.reduce((t, [x, y]) => t + x - y, 0), mates = mine.filter((p) => p !== meSeat), partner = mates.map((p) => p.name)[0];
      const oppAcct = theirs.some((p) => p.pid), conf = !!(m.cf && m.cf.by === 'opp' && !m.forfeit && oppAcct), small = (m.st === 'h2h' || m.st === 'side') && accts.size < 3;
      const why = m.forfeit ? 'Forfeit: not rated' : !oppAcct ? 'The other side has no Oddable account: not rated' : !conf ? 'Made final by the commissioner, not confirmed by the other side: not rated' : small ? 'Heads-up or side match in an event with fewer than 3 accounts: not rated' : undefined;
      const rt = (p) => (Number.isFinite(p.r) ? p.r : null), avg = (l) => Math.round(l.reduce((t, p) => t + (Number.isFinite(p.r) ? p.r : 1500), 0) / l.length), big = mine.length > 2 || theirs.length > 2; // teams of 3-4: each player is rated against the opposing team's AVERAGE
      out.push(Object.assign({}, base, { id: evt.id + ':' + m.id, date: chiDay(m.at || evt.start), kind: 'match', title: evt.title + ' · ' + matchLabel(m), result: m.win === side ? 'W' : 'L', opponent: nameOf(evt, opp), verified: conf,
        extra: { fmt: big ? 'teams' : mine.length === 2 ? 'doubles' : 'singles', at: m.at || undefined, myRating: Number.isFinite(meSeat.r) ? meSeat.r : undefined, oppRating: big ? [avg(theirs)] : theirs.map(rt), oppRatings: big ? theirs.map(rt) : undefined, partnerRating: big ? undefined : mates.length ? rt(mates[0]) : undefined, partnerRatings: big ? mates.map(rt) : undefined, // rating inputs: null = no confirmed games yet (counted at the 1500 start)
          confirmed: conf && !small, confirmedBy: conf ? { name: m.cf.name || 'the other side', at: m.cf.at || m.at || 0 } : undefined, unrated: why, oppKey: oppAcct ? 'e:' + crypto.createHash('sha256').update('oddable-opp|' + theirs.filter((p) => p.pid).map((p) => mkOfPid[p.pid] || p.pid).sort().join('|')).digest('hex').slice(0, 14) : undefined,
          place: null, entry: 0, payout: 0, net: 0, moneyOn: evt.id + ':event', scoreText: m.forfeit ? 'forfeit' : games.map((g) => g.join('-')).join(', '), games, partner: partner || undefined, pointDiff: diff, guestId: meSeat.gid, side: mine.map((p) => ({ id: p.gid, name: p.name, account: !!p.pid })), opp: theirs.map((p) => ({ id: p.gid, name: p.name, account: !!p.pid })), forfeit: !!m.forfeit || undefined } }));
    });
    const myE = evt.entrants.filter((e) => (e.players || []).some((p) => myGids.has(p.gid)));
    // S-ALL (owner Nov 16 2026): every play is in the player's dashboard, running or finished: one 'event' record per event they have an entry in, with the
    // money (entry, payout, net; information only). Running: result null + extra.live (an open play); finished: place + payout + net.
    // Entry counts as spent only once the organizer marked this player paid; a finished play that paid nothing sends won: 0 (stats contract v1.1).
    if (myE.length) { const fin = !!(evt.fin && evt.places), ps = fin ? myE.map((e) => evt.places[e.eid]).filter(Boolean) : [], bestE = fin && ps.length ? myE.find((e) => evt.places[e.eid] === Math.min(...ps)) : myE[0];
      const sr = fin && evt.fmt === 'solo' ? soloRows(evt).find((x) => myE.some((e) => e.eid === x.eid)) : null, mo = moneyFor(evt, bestE.eid, (bestE.players.find((p) => myGids.has(p.gid)) || {}).gid);
      if (!fin || ps.length) out.push(Object.assign({}, base, { id: evt.id + ':event', date: chiDay(fin ? evt.fin : evt.start), kind: 'event', title: evt.title + (evt.fmt === 'solo' ? ' · ' + FMTN.solo : ''), result: null, place: fin ? { n: Math.min(...ps), of: Object.keys(evt.places).length } : undefined, score: sr ? sr.score : undefined, verified: sr ? sr.ver : true,
        stake: mo.entry || undefined, won: fin ? mo.payout : undefined, pl: fin ? mo.net : undefined,
        extra: { guestId: [...myGids][0], fmt: evt.fmt, at: fin ? evt.fin : undefined, live: !fin || undefined, ended: fin || undefined, entry: mo.entry, owed: mo.owed || undefined, payout: fin ? mo.payout : null, net: fin ? mo.net : null, paid: mo.paid, moneyNote: 'Information only: Oddable never collects or pays.', solo: evt.fmt === 'solo' || undefined, scoreText: sr ? sr.score + ' ' + evt.rules.unitLabel : fin ? ord(Math.min(...ps)) + ' of ' + Object.keys(evt.places).length : 'In progress', unit: sr ? evt.rules.unitLabel : undefined } })); }
    if (evt.rules.pickem && evt.fin && evt.picks[m0.pid]) { const t = pickTable(evt).rows, row = t.find((x) => x.pid === m0.pid); if (row) out.push(Object.assign({}, base, { id: evt.id + ':pickem', date: chiDay(evt.fin), kind: 'contest', title: evt.title + " · bracket pick'em", result: null, place: { n: row.place, of: t.length }, verified: true, won: 0, extra: { pickem: true, at: evt.fin, entry: 0, payout: 0, net: 0, right: row.right, of: row.n, pts: row.pts, scoreText: row.right + ' of ' + row.n + ' right' } })); }
  }
  // At most 2 confirmed (rated) matches against the same opponents per day, across every event of this player; the 3rd and later are records only.
  const seen = {}; out.filter((x) => x.kind === 'match').sort(recOrder).forEach((x) => { const e = x.extra; if (!e.confirmed || !e.oppKey) return; const k = e.oppKey + '|' + x.date; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 2) { e.confirmed = false; e.unrated = 'More than 2 matches against the same opponents in one day: not rated'; } });
  out.forEach((x) => { x.extra = Object.assign({ game: x.game }, x.extra || {}); delete x.game; Object.keys(x).forEach((k) => { if (x[k] === undefined) delete x[k]; }); Object.keys(x.extra).forEach((k) => { if (x.extra[k] === undefined) delete x.extra[k]; }); });
  return out.filter((x) => x.date >= from && x.date <= to).sort(recOrder);
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
async function oddableOf(userKey, sport) { // STAND-IN only (this branch on its own). In the build the stats module (ratings.js eloSet) is the ONE rating calculation.
  if (/^guest:/.test(String(userKey))) return { rating: null, matches: 0, confirmed: 0 }; const key = userKey + '|' + sport, c = RC.get(key); if (c && D.now() - c.at < 30e3 && D.now() >= c.at) return c.v;
  const recs = (await statsFor(userKey, {})).filter((r) => r.kind === 'match' && r.sport === sport && (r.result === 'W' || r.result === 'L')), exp = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400)), avg = (x) => x.reduce((t, y) => t + y, 0) / x.length, n = (x) => (Number.isFinite(x) ? x : 1500);
  let r = 1500, k = 0; recs.forEach((m) => { const x = m.extra || {}; if (!x.confirmed) return; k++; const dbl = x.fmt === 'doubles', opp = (Array.isArray(x.oppRating) ? x.oppRating : [x.oppRating]).map(n).slice(0, dbl ? 2 : 1), mine = dbl ? [r, n(x.partnerRating)] : [r]; r += 32 * ((m.result === 'W' ? 1 : 0) - exp(avg(mine), avg(opp.length ? opp : [1500]))); });
  const v = { rating: k ? Math.round(r) : null, matches: recs.length, confirmed: k }; RC.set(key, { at: D.now(), v }); if (RC.size > 5000) RC.clear(); return v;
}
const STAND = {
  standIn: true,
  ratingFor: async (userKey, sport, opts) => { const sp = sport && sport !== 'golf' ? sport : 'pickleball', o = opts || {}, od = await oddableOf(userKey, sp); let d = null; if (o.eventId) { const r = await D.S.dbGet(EVR(o.eventId)); d = (r && r.data) || null; }
    const s = d && d.set && d.set[pkey(userKey)] && d.set[pkey(userKey)].rating != null ? d.set[pkey(userKey)] : null;
    const text = od.matches ? (od.rating != null ? od.rating + ' · ' : '') + od.confirmed + ' of ' + od.matches + ' game' + (od.matches === 1 ? '' : 's') + ' confirmed' : 'No games yet';
    return { sport: sp, oddable: { rating: od.rating, matches: od.matches, text, label: RLABEL }, confirmedRating: od.rating, confirmedGames: od.confirmed, text, event: s ? s.rating : null, setBy: s ? 'tournament' : null, use: s ? s.rating : od.rating != null ? od.rating : 1500, start: !s && od.rating == null, label: RLABEL, reason: s ? s.reason : undefined, at: s ? s.at : undefined, locked: d ? evrLocked(d) : undefined }; },
  eventSetup: async (directorE, eventId, o) => { if (!(await entFor(directorE))) throw bad(403, 'Only Enterprise tournaments can set ratings'); const x = o || {}, dk = mkOf(directorE);
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
// Exact to the cent: the prize cents of the places a tie covers are dealt out whole (a leftover cent goes to the entry listed first, then to its
// first-listed player), so every player's payout adds up to the prize pool. An entry is "spent" only once the organizer marked that player paid.
function moneyFor(evt, eid, gid) {
  const e = evt.entrants.find((x) => x.eid === eid), ps = ((e && e.players) || []).filter((p) => !isBlank(p)), seat = ps.find((p) => p.gid === gid) || ps[0] || null, paid = !!(seat && seatPaid(evt, seat));
  const fee = Number(evt.money.entry) || 0, entry = paid ? fee : 0, owed = paid ? 0 : fee, pl = evt.places || null; if (!pl || !pl[eid]) return { entry, owed, paid, payout: pl ? 0 : null, net: pl ? -entry : null };
  const pot = potSummary(evt), place = pl[eid], tiedE = evt.entrants.filter((x) => pl[x.eid] === place), tied = tiedE.length;
  let c = 0; for (let i = place; i < place + tied; i++) { const x = pot.places.find((y) => y.place === i); if (x) c += Math.round(x.amt * 100); }
  const share = Math.floor(c / tied) + (tiedE.indexOf(e) < c % tied ? 1 : 0), heads = Math.max(1, ps.length), mine = Math.floor(share / heads) + (Math.max(0, ps.indexOf(seat)) < share % heads ? 1 : 0), payout = mine / 100;
  return { entry, owed, paid, payout, net: Math.round((payout - entry) * 100) / 100 };
}
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function matchLabel(m) { return m.st === 'pool' ? 'Pool round ' + m.r : m.st === 'po' ? 'Playoff round ' + m.r : m.st === 'w' ? 'Round ' + m.r : m.st === 'l' ? 'Losers round ' + m.r : m.st === 'gf' ? (m.reset ? 'Final (reset)' : 'Final') : m.st === 'lad' ? 'Ladder challenge' : m.st === 'side' ? 'Side match' : m.st === 'tb' ? 'Tiebreak match' : 'Heads-up'; }

// ---------- ADAPTER: contest type 'local-event' inside a Group (for the Groups contests[] restructure and the Calcutta engine) ----------
// Server-side only (never from a client body): groups.js creates/attaches the event after it has checked the group commissioner.
const ADAPTER = {
  type: 'local-event',
  attachToGroup: (evtId, ctx) => ADAPTER.attach(evtId, ctx), // alias (name used in OWNER-DECISIONS / the Groups contests[] plan)
  attach: (evtId, ctx) => mutate(evtId, (evt) => { evt.group = { gid: String(ctx.gid).slice(0, 20), cid: String(ctx.cid).slice(0, 20) }; evt.money.pot = ctx.pot === 'side' ? 'side' : 'main'; return evt; }).then((evt) => idxSafe(evtId).then(() => evt)),
  summary: async (evtId) => { const r = await load(evtId); if (!r) return null; const evt = r.data, now = D.now(); tick(evt, now); const pl = evt.places || places(evt, now); return { id: evt.id, title: evt.title, fmt: evt.fmt, status: evt.fin ? 'final' : evt.drawn ? 'live' : 'upcoming', start: evt.start, leader: pl ? nameOf(evt, Object.keys(pl).find((e) => pl[e] === 1)) : null, places: pl ? Object.entries(pl).map(([e, p]) => ({ lot: e, name: nameOf(evt, e), place: p })) : null }; },
  potSummary: async (evtId) => { const r = await load(evtId); return r ? potSummary(r.data) : null; },
  // Calcutta `lots` source: one lot per entry (player or pair). result(lotId) tells the Calcutta engine how far that lot went.
  lots: async (evtId) => { const r = await load(evtId); if (!r) return []; const evt = r.data; return evt.entrants.map((e) => ({ id: e.eid, name: e.name, rating: e.rating, seed: (evt.seeds || []).indexOf(e.eid) + 1 || null, size: UNITS[evt.rules.unit] || 1 })); },
  lotResults: async (evtId) => { const r = await load(evtId); if (!r) return {}; const evt = r.data, now = D.now(); tick(evt, now); const pl = evt.places || places(evt, now) || {}, o = {}; evt.entrants.forEach((e) => { const ms = evt.matches.filter((m) => m.state === 'confirmed' && (m.a === e.eid || m.b === e.eid)); o[e.eid] = { place: pl[e.eid] || null, wins: ms.filter((m) => winnerOf(m) === e.eid).length, losses: ms.filter((m) => loserOf(m) === e.eid).length, alive: !pl[e.eid] && !ms.some((m) => loserOf(m) === e.eid && (m.st === 'po' || (m.st === 'w' && evt.fmt === 'se') || m.st === 'l')), final: !!evt.fin }; }); return o; },
  // CALCUTTA LOT SOURCE (Playbook fix, manager Nov 16 2026): pickleball pairs / local teams as a Calcutta source, with the Calcutta engine's contract
  // (odds-api/calcutta.js registerSource): teams(), results(calc), started(calc), startTime(calc), local: true (lots are the group's own players =
  // "players of record", buy back half). FAIL CLOSED: an event that cannot be read (missing, deleted, database error) THROWS from every hook, and
  // started() is true the moment anything says play began (start time reached, draw made, a match live / scored, finished). It never answers
  // "not started" on a guess, so ownership can only freeze early, never late. Server-side only; players of record are account ids / guest ids.
  calcuttaSource: (evtId) => {
    const idOf = (calc) => String(evtId || (calc && (calc.ref || calc.srcId || calc.evtId || calc.eventId)) || ''), need = async (calc) => { const r = await load(idOf(calc)); if (!r) throw new Error('local event not found'); const evt = r.data; if (typeof evt.start !== 'number' || !Number.isFinite(evt.start) || !(evt.start > 0)) throw new Error('local event has no valid start time'); /* a stored start that is not a number can never answer "not started" */ tick(evt, D.now()); return evt; };
    return { local: true, label: 'Local event (pairs / teams)',
      // Calcutta round 4 contract (calcutta-v1 dc5371b). organizer(calc, {viewer}) === true only for the event's organizer (the engine refuses a Calcutta
      // on someone else's event; no viewer / any doubt = false). teams(calc, {viewer}) checks the same viewer and THROWS 403 for anyone else (fail closed):
      // viewer = the account id from acct.who(req). Players of record go out server-side only: an account as { key: <account id>, accepted: true }
      // (every account in a seat took it itself: joined with the link, claimed with a claim code, or is the playing organizer), a typed-in player as
      // 'g:<guest id>' (never accepted, never a name). endTime = the scheduled end (last day; bracket / round robin: the end of the start day).
      organizer: async (calc, opt) => { const evt = await need(calc), v = opt && opt.viewer != null ? String(opt.viewer) : ''; return !!v && (v === evt.ce || mkOf(v) === evt.comm); },
      teams: async (calc, opt) => { const evt = await need(calc), v = opt && opt.viewer != null ? String(opt.viewer) : ''; if (!v || !(v === evt.ce || mkOf(v) === evt.comm)) throw Object.assign(new Error("Only the event's organizer can auction its teams"), { status: 403, code: 'organizer' });
        return evt.entrants.map((e) => ({ id: e.eid, name: e.name, abbr: e.name.slice(0, 12), players: (e.players || []).filter((p) => !isBlank(p)).map((p) => { const m = p.pid && evt.members.find((x) => x.pid === p.pid); return m ? { key: m.ak, name: m.name, accepted: true } : 'g:' + p.gid; }) })); },
      endTime: async (calc) => { const evt = await need(calc); return evt.endDay ? chiEnd(evt.endDay) : chiEnd(chiDay(Math.min(evt.start, evt.drawn || Infinity))); },
      startTime: async (calc) => { const evt = await need(calc); if (!(Number(evt.start) > 0)) throw new Error('local event has no start time'); return Math.min(evt.start, evt.drawn || Infinity); },
      started: async (calc) => { const evt = await need(calc), now = D.now(); return !!(now >= evt.start || evt.drawn || evt.fin || evt.done || evt.matches.some((m) => m.live || PLAYED.has(m.state)) || Object.keys(evt.solo || {}).length); },
      results: async (calc) => { const evt = await need(calc), now = D.now(), pl = evt.places || places(evt, now) || {}, out = {}; evt.entrants.forEach((e) => { const won = evt.matches.filter((m) => m.state === 'confirmed' && winnerOf(m) === e.eid && m.b !== 'BYE' && m.a !== 'BYE'), lost = evt.matches.some((m) => m.state === 'confirmed' && loserOf(m) === e.eid);
        if (!won.length && !lost && !pl[e.eid]) return; const ko = evt.matches.filter((m) => m.state === 'confirmed' && (m.st === 'w' || m.st === 'po' || m.st === 'gf') && (m.a === e.eid || m.b === e.eid)), reached = ko.length ? Math.max(...ko.map((m) => (m.st === 'gf' ? 99 : m.r))) : 0;
        const dead = evt.matches.some((m) => m.state === 'confirmed' && loserOf(m) === e.eid && (m.st === 'po' || (m.st === 'w' && evt.fmt === 'se') || m.st === 'l' || (m.st === 'gf' && (m.reset || m.win === 'a'))));
        out[e.eid] = { wins: won.length, winT: won.map((m) => m.at || 0), reached, reachT: {}, champ: !!(evt.fin && pl[e.eid] === 1), out: !!(evt.fin ? pl[e.eid] !== 1 : dead), place: evt.fin && pl[e.eid] ? pl[e.eid] : undefined }; }); return out; } };
  },
  // calcutta = require('./calcutta'); key defaults to 'evt:<id>'. Refuses (throws) when the Calcutta engine has no started()/startTime() support to hook into.
  registerCalcutta: (calcutta, evtId, key) => { if (!calcutta || typeof calcutta.registerSource !== 'function') throw new Error('calcutta.registerSource is missing'); const src = ADAPTER.calcuttaSource(evtId), k = key || (evtId ? 'evt:' + evtId : 'events'); calcutta.registerSource(k, src); return k; },
};
// =====================================================================================================================================================
// THE GROUP GATE (main, Nov 17 2026): every /local/<op> call on main comes through here; the engine's own routes (core) are never reached without it.
// Same switch answers as odds-api/golfday.js (v273), then: a group id, the caller is a member of that group, the game belongs to that group.
// =====================================================================================================================================================
const G = {
  GID: /^[A-Z2-9]{10}$/, EID: /^[A-Z2-9]{10}$/,
  OFF_MSG: 'Groups is not open for this account yet.', LAPSED_MSG: 'Your time has ended. Pay to use Groups again.',
  NOT_MEMBER: 'Pickleball games are for members of this group', NOT_FOUND: 'Game not found', NOT_COMM: "Only the group's commissioner can start a pickleball game",
  SOON: 'Only pickleball games can be started in a group for now. Other sports are coming soon.', NO_MONEY: 'Oddable does not track money in group games.',
  capText: (n) => 'Up to ' + n + ' people per game, counting the organizer, players, spectators and typed-in players.', // S2: the real limits.maxPeople number
  get CAP() { return G.capText(Number(D.limits().STANDARD) || 8); },
  // the engine's routes a group member may use (peek = the public invite peek, mine = every event of the account, paid = money: not on main)
  OPS: new Set(['list', 'create', 'preview', 'join', 'claim', 'get', 'edit', 'entrant', 'draw', 'leave', 'delete', 'finish', 'solo', 'score', 'confirm', 'dispute', 'live', 'pick', 'picklock', 'challenge', 'accept', 'decline', 'tiebreak', 'poreset', 'poredraw', 'partners', 'teams', 'trate']),
};
const gsend = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
// In a group: the Enterprise price sentence is never shown (v272 decision: more than 8 people is not offered on the phone) and money fields are empty.
const GERR = [['A tie for a prize or a playoff spot is still open', 'A tie for a top place or a playoff spot is still open'], ['Entries closed when the event started', 'Entries closed when the game started'], ['Event not found', 'Game not found'], ['Give the event a name', 'Give the game a name'], ['No event with that code', 'No game with that code'], ['Not a doubles or team event', 'Not a doubles or team game'], ['Not a solo event', 'Not a solo game'], ['Not in the event', 'Not in the game'],
  ['Partner suggestions are for doubles and team events', 'Partner suggestions are for doubles and team games'], ['locked. The event has started.', 'locked. The game has started.'], ['Scores open when the event starts', 'Scores open when the game starts'], ['Sign in to run or join an event', 'Sign in to run or join a game'], ['already in the event', 'already in the game'], ['player is not in the event', 'player is not in the game'],
  ['The commissioner adds the players in this event.', 'The commissioner adds the players in this game.'], ['Delete the event instead', 'Delete the game instead'], ['The event has started. Players stay to the end.', 'The game has started. Players stay to the end.'], ['The event is finished', 'The game is finished'], ['This event does not use', 'This game does not use'], ["This event has no pick'em", "This game has no pick'em"],
  ['This event has no side matches', 'This game has no side matches'], ['This event has no spectators', 'This game has no spectators'], ['Too many matches in this event', 'Too many matches in this game'], ['for Enterprise events (courses', 'for Enterprise games (courses'], ['You already have an entry in this event (', 'You already have an entry in this game ('], ['every score in this event', 'every score in this game']];
const gWords = (t) => GERR.reduce((x, [a, b]) => x.split(a).join(b), String(t)); // N3: the engine's exact error fragments only
const GAUD = { 'Event created': 'Game created', 'Event finished': 'Game finished', 'Event finished: challenge cancelled': 'Game finished: challenge cancelled' }; // N3: whole audit lines only
function groupScrub(o, n) { // n = the people limit limits.maxPeople gives this account (S2); a game's own cap wins for that game
  if (!o || typeof o !== 'object') return; const strip = (s) => String(s).split(limits.ENTERPRISE_TEXT).join('').split(ENT_TEXT).join('').replace(/\s+/g, ' ').trim();
  // P8 / N3 (review 2): group screens say "game", never "event". Only the engine's OWN sentences are reworded (the exact error texts and audit lines below);
  // anything people typed (a title "Spring Event", a dispute note "wrong event", a name) is never touched. The engine keeps its words for its tests.
  if (typeof o.error === 'string') o.error = gWords(strip(o.error)); if (o.event && Array.isArray(o.event.audit)) o.event.audit.forEach((a) => { if (a && typeof a.s === 'string' && GAUD[a.s]) a.s = GAUD[a.s]; }); const std = Number(n) >= 1 ? Number(n) : Number(D.limits().STANDARD) || 8, one = (e) => { if (e && typeof e === 'object') { e.entText = G.capText(Number(e.cap) >= 1 ? Number(e.cap) : std); e.inGroup = true; } };
  one(o.event); (o.events || []).forEach(one); if (Array.isArray(o.events)) o.capText = G.capText(std);
}
const signedIn = (req) => { try { return D.acct().who(req) || null; } catch (e) { return null; } };
const allowed = (e) => { try { return !!D.grp().onFor(e); } catch (er) { return false; } };
// v278 (server review A2): "has this account's time ended?" is asked on every /local call. acct.expired() answers false when My Apps is down, after up
// to 25 s and with no cache, so a slow My Apps stalled scoring. Same rule as the Calcutta's lapsed() (odds-api/calcutta.js): the answer is kept per
// account; a KNOWN answer is good for 2 minutes and then re-asked in the background while it is still served; My Apps not answering ('unknown',
// acct.expiredState) never changes a known answer (asked again 30 s later); an account never answered for waits at most 1.2 s, then is let in
// provisionally and asked again on the next call 30 s later.
const LAPSE = new Map(), LAPSE_MS = 120e3, LAPSE_RETRY = 30e3, LAPSE_WAIT = 1200;
const lapseSleep = (ms, v) => new Promise((ok) => { const t = setTimeout(() => ok(v), ms); if (t.unref) t.unref(); });
async function lapseAsk(e) { // -> 'ended' | 'ok' | 'unknown'
  try { const A = D.acct(); if (typeof A.expiredState === 'function') { const v = await A.expiredState(e); return v === 'ended' || v === 'ok' ? v : 'unknown'; }
    return typeof A.expired === 'function' ? ((await A.expired(e)) ? 'ended' : 'ok') : 'ok'; } catch (er) { return 'unknown'; } }
function lapsed(e) { if (!e) return Promise.resolve(false); const h = LAPSE.get(e), now = D.now();
  if (h && h.at && now >= h.at && now - h.at < h.ttl) return Promise.resolve(h.v);
  let p = h && h.busy; if (!p) { p = lapseAsk(e).then((a) => { const x = LAPSE.get(e) || {}, known = a !== 'unknown';
        const v = known ? a === 'ended' : (x.known ? x.v : false); // 'unknown': keep what was last KNOWN (or let in, provisionally, if nothing was)
        LAPSE.set(e, { at: D.now(), v, known: known || !!x.known, ttl: known ? LAPSE_MS : LAPSE_RETRY }); if (LAPSE.size > 5000) LAPSE.delete(LAPSE.keys().next().value); return v; });
    LAPSE.set(e, Object.assign({}, h || { at: 0, v: false, known: false, ttl: LAPSE_RETRY }, { busy: p })); }
  if (h && h.at) return Promise.resolve(h.v); // answered before: that answer now, the new one for the next call
  return Promise.race([p, lapseSleep(LAPSE_WAIT, null)]).then((v) => { if (v !== null) return v; const x = LAPSE.get(e); if (x && x.busy === p && !x.at) LAPSE.set(e, { at: D.now(), v: false, known: false, ttl: LAPSE_RETRY, busy: p }); return false; }); } // no answer in time: let in for now, ask again 30 s later
// create / edit inside a group: pickleball only, and no money (entry, split, take, pot) whatever the phone sent
function groupRules(b) {
  if (String(b.sport || 'pickleball') !== 'pickleball') throw bad(400, G.SOON);
  b.sport = 'pickleball'; b.entry = 0; b.split = 'none'; b.take = { kind: 'none', v: 0 }; b.pot = 'main'; return b;
}
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (path !== '/local' && !path.startsWith('/local/')) return false;
  const op = path.slice(7), e = signedIn(req);
  if (!allowed(e)) { req.resume(); gsend(res, 403, { error: G.OFF_MSG, off: true }); return true; }            // Groups off, or not on for this account: nothing is read
  if (await lapsed(e)) { req.resume(); gsend(res, 403, { error: G.LAPSED_MSG, expired: true }); return true; } // time ended: locked until paid, nothing deleted
  if (req.method !== 'POST') { req.resume(); gsend(res, 405, { error: 'POST only' }); return true; }
  res._lg = true; if (e) { try { res._lgcap = await capFor(e, ''); } catch (x) { res._lgcap = null; } } // from here on every answer goes through the group scrub (core's send and the errors below)
  try {
    if (!e) throw bad(401, 'Sign in to use Groups');
    const b = await body(req); if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad(400, 'Bad request');
    const gid = String(b.g || ''); if (!G.GID.test(gid)) throw bad(404, 'Group not found');
    if (limit('lg|' + e, 600, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.');
    if (!G.OPS.has(op)) throw bad(404, 'Not found');
    const m = await D.grp().memberCheck(gid, e); if (!m) throw bad(403, G.NOT_MEMBER);
    b.myName = cleanName(m.name, 24) || 'Player'; // the name this group shows for the member (never a phone number, email or account id)
    const mine = (evt) => !!(evt && evt.group && evt.group.gid === gid);
    if (op === 'create') { if (!m.comm) throw bad(403, G.NOT_COMM); groupRules(b); }
    else if (op === 'list') { /* the engine's "my events", only this group's */ }
    else if (op === 'claim') { // a typed-in player's claim code: only for a game of this group
      const code = normCode(String(b.claim || '').split('.')[0]), id = code ? await byCode(code) : null, r = id ? await load(id) : null;
      if (!r || !mine(r.data)) { codeFail('ec|a|' + mkOf(e)); codeFail('ec|i|' + D.ip(req)); throw bad(404, 'That claim code does not match'); }
    } else if (op === 'preview' || op === 'join') { // a member opens a game of the group by its id (no invite code needed); a code still works for a game of this group
      let r = null; if (b.id != null && b.id !== '') { r = G.EID.test(String(b.id)) ? await load(String(b.id)) : null; } else { const code = normCode(b.code), id = code ? await byCode(code) : null; r = id ? await load(id) : null; }
      if (!r || !mine(r.data)) throw bad(404, G.NOT_FOUND);
      b.code = r.data.code; delete b.id;
    } else { // every other route names the game by its id
      const r = G.EID.test(String(b.id || '')) ? await load(String(b.id)) : null; if (!r || !mine(r.data)) throw bad(404, G.NOT_FOUND);
      if (op === 'edit') groupRules(b);
    }
    req._lb = b; req._lop = op === 'list' ? 'mine' : op; req._lg = { gid, name: m.group || '' };
    await core(req, res);
    if (op === 'create' && req._lout) { // the owner's Activity (events.js -> My Apps), AFTER the write and the answer. Names only; events.js cleans them again.
      const evt = req._lout;
      try { D.ev().pickleballStarted({ id: gid, name: m.group || '' }, evt.title, { account: /@/.test(String(e)) ? String(e) : undefined, key: evt.id, detail: [m.group ? 'Group: ' + cleanName(m.group, 40) : '', FMTN[evt.fmt], UNITS[evt.rules.unit] > 1 ? evt.rules.unit : 'singles', chiDay(evt.start)].filter(Boolean).join('. ') }); } catch (er) {}
    }
  } catch (er) { if (!er.status) console.error('local gate:', er.message); const o = { error: er.status ? er.message : 'Pickleball error, try again' }; groupScrub(o); gsend(res, er.status || 500, o); }
  return true;
}

module.exports = { _lapse: LAPSE, _lapsed: lapsed, handle, _core: core, GROUP: G, groupRules, groupScrub, PICKLEBALL_FORMATS: FMTS.slice(), statsFor, ratingFor, STAND, LIMSTAND, openTies, pickPoints, _billed: () => BILLQ, snapRatings, moneyFor, pairHistory, ADAPTER, limits, SPORTS, FMTN, cleanRules, checkGames, roundRobin, buildElim, seedOrder, poolTable, places, potSummary, people, _deps: D, _mkOf: mkOf, _reset: () => { RL.clear(); RC.clear(); ENTF.clear(); BILL.clear(); }, _idxQueue: () => [...IDXQ], _idxRepairNow: async () => { if (IDXRUN) await IDXRUN; await idxRepair(); }, _idxIdle: async () => { for (let i = 0; i < 200 && IDXRUN; i++) await IDXRUN; }, _idxRestart: () => { IDXQ.clear(); if (IDXT) clearTimeout(IDXT); IDXT = null; } /* tests: what a server restart forgets */ };
