// MAIN-LINE PORT (Nov 17 2026, branch feat/pickleball-group-game-on-main): this file is the side branch local-v1's odds-api/events.js (11087cd), renamed
// localevents.js because main already has odds-api/events.js (Activity events to My Apps). Routes are POST /levents/<op> (not /events: keeps the two apart).
// Pickleball & local games are a GROUP GAME here (owner PB-1): behind LOCALEVENTS_ENABLED=1 AND the Groups switches (GROUPS_ENABLED / GROUPS_OWNER_ONLY /
// GROUPS_TESTERS, asked through groups.js onFor exactly like golfday.js), an ended account gets 403 expired, and an event is created only from a group by
// that group's commissioner. Like Golf days, the event is NOT added to the group's contests list (groups.attachGame is not called): the event row keeps the
// group id and every call checks membership with groups.memberCheck. No stats module on main: ratings use the built-in Elo (STAND); the stats adapter (ST,
// NEWM, regStats) stays in the file but is INERT until an odds-api/stats.js with the v1.5 contract is in the build.
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
  enterprise: async (accountKey) => false, // used only by LIMSTAND / STAND (this branch on its own); the real flag is limits.isEnterprise
  limits: () => { const m = realMod('./limits'); return m && typeof m.maxPeople === 'function' && typeof m.keyOf === 'function' ? m : LIMSTAND; },
  // H1 / E-H (owner Nov 16 2026): the rating module. The stats branch's own (odds-api/stats.js: ratingFor, eventSetup, eventOverride, eventLog) when it is
  // in the build, else the STAND-IN at the bottom of this file with the same names, arguments and result shapes.
  rt: () => { const m = realMod('./stats'); return m && ['ratingFor', 'eventSetup', 'eventOverride', 'eventLog'].every((f) => typeof m[f] === 'function') ? m : STAND; },
  groups: () => { const G = realMod('./groups'); return G && typeof G.memberCheck === 'function' ? { memberCheck: G.memberCheck, canAttach: G.canAttach, onFor: G.onFor } : null; }, // main port: no attachGame (the event is not a Groups contest; see the header)
  gate: () => realMod('./groups'), // main port: the Groups switches (onFor) for the /levents gate; kept apart from D.groups so the suites can fake membership
  groupOnly: () => true, // main port: create needs a groupId (the suites switch this off to keep their stand-alone checks)
  activity: () => realMod('./events'), // main's Activity events to My Apps (pickleballStarted) // the Groups engine when it is in the build: memberCheck(groupId, accountId), canAttach(groupId, accountId), attachGame(groupId, accountId, {type, ref, name, pot})
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
// Third review (H2): a play is filed under the month THE GAME STARTED (opt.at), never the month of the call, so re-opening an old event bills nothing new.
LIMSTAND.recordPlay = async (accountKey, gameType, gameId, playerKey, title, opt) => { if (!accountKey || !(await D.enterprise(accountKey))) return false; const at = opt && Number(opt.at) > 0 ? Number(opt.at) : D.now(), mo = new Date(at).toISOString().slice(0, 7), gid = String(gameId || '').slice(0, 60);
  const pks = (Array.isArray(playerKey) ? playerKey : [playerKey]).filter((p) => p != null && p !== '').map((p) => crypto.createHash('sha256').update('oddable-play|' + String(p)).digest('hex').slice(0, 12)); if (!gid || !pks.length) return false;
  await mutateRow('lock:entuse', () => ({}), async (x) => { const a = (x[accountKey] = x[accountKey] || {}), m = (a[mo] = a[mo] || {}), o = (m[gid] = m[gid] || { n: 0 }); o.p = Array.isArray(o.p) ? o.p : []; const add = pks.filter((pk) => !o.p.includes(pk)); if (!add.length && o.type) return { nochange: true }; add.forEach((pk) => o.p.push(pk)); o.type = String(gameType || 'game'); o.n = Math.max(Number(o.n) || 0, o.p.length); if (title) o.title = String(title).slice(0, 40); return {}; }); return true; };
// ONCE PER PLAYER PER GAME, EVER (third review, H2): the billed seat ids live ON THE EVENT ROW (evt.billed = {<seat id>: 'YYYY-MM'}, evt.billAt = when the
// game started), written BEFORE limits.recordPlay is called, so a restart, a later month or anyone re-opening an old event can never bill a seat again.
// A failed recordPlay takes its seat off the row again (retried on the next read). BILL only stops two answers of this process working on the same seat.
const BILL = new Map(); let BILLQ = Promise.resolve();
const hasStarted = (evt, now) => !!(evt.fin || evt.done || now >= evt.start || (evt.matches || []).some((m) => m.live || PLAYED.has(m.state)) || Object.keys(evt.solo || {}).length);
function bill(evt) { // called after every answer that carries an event: once it has started, each player (accounts and typed-in players, by seat id) is recorded once
  try { if (!evt || !evt.id || evt.deleted || !hasStarted(evt, D.now())) return; const L = D.limits(); if (typeof L.recordPlay !== 'function') return; const done = evt.billed || {}, fly = BILL.get(evt.id) || new Set(), todo = seatsPlaying(evt).map((p) => p.gid).filter((g) => !done[g] && !fly.has(g)); if (!todo.length) return;
    todo.forEach((g) => fly.add(g)); BILL.set(evt.id, fly); if (BILL.size > 5000) BILL.delete(BILL.keys().next().value); const id = evt.id;
    BILLQ = BILLQ.then(() => billRun(id, todo, L)).catch((e) => console.error('events bill:', e.message)).then(() => { todo.forEach((g) => fly.delete(g)); if (!fly.size) BILL.delete(id); }); } catch (e) { console.error('events bill:', e.message); }
}
async function billRun(id, todo, L) {
  const r0 = await D.S.dbGet(ROW(id)); if (!r0 || !r0.data || r0.data.deleted) return; const ak = L.keyOf(r0.data.ce);
  if (typeof L.isEnterprise === 'function' && !(await L.isEnterprise(ak))) return; // standard accounts are never billed: nothing is written for them
  let mine = [], at = 0, title = '';
  await mutateRow(ROW(id), null, async (d) => { mine = []; if (d.deleted) return { nochange: true }; const now = D.now(); d.billed = d.billed || {}; const playing = new Set(seatsPlaying(d).map((p) => p.gid));
    mine = todo.filter((g) => playing.has(g) && !d.billed[g]); if (!mine.length) return { nochange: true }; d.billAt = d.billAt || Math.min(Number(d.start) || now, now); at = d.billAt; title = d.title; const mo = new Date(at).toISOString().slice(0, 7); mine.forEach((g) => (d.billed[g] = mo)); return {}; });
  const failed = []; for (const g of mine) { try { await L.recordPlay(ak, 'event', id, g, title, { at, month: new Date(at).toISOString().slice(0, 7) }); } catch (e) { failed.push(g); console.error('events recordPlay:', e.message); } }
  if (failed.length) await mutateRow(ROW(id), null, async (d) => { failed.forEach((g) => { if (d.billed) delete d.billed[g]; }); return {}; });
}
const limits = { get ENTERPRISE_TEXT() { return D.limits().ENTERPRISE_TEXT || ENT_TEXT; }, maxPeople: (k, id) => D.limits().maxPeople(k, id) }; // kept for callers of events.limits
const ENTF = new Map(); // event id -> is the organizer an Enterprise account (asked from limits.isEnterprise, never guessed from the cap: extra seats are not Enterprise)
async function capFor(accountId, gameId) { const L = D.limits(), n = Math.round(Number(await L.maxPeople(L.keyOf(accountId), gameId || ''))); if (!(n >= 1)) throw bad(503, 'Could not check the people limit. Try again.'); return n; } // fail closed
async function entFor(accountId) { const L = D.limits(); try { return typeof L.isEnterprise === 'function' ? !!(await L.isEnterprise(L.keyOf(accountId))) : false; } catch (e) { return false; } }
const fullMsg = (cap) => 'This game is full: ' + cap + ' people max, counting the organizer, players and spectators. ' + limits.ENTERPRISE_TEXT; // owner: "8 people per group, all games"
const ROW = (id) => 'lock:evt:' + id, IDX = 'lock:evtidx', DAY = 864e5;
const send = (res, code, o) => { if (o && o.event && o.event.id && o.event._bill) { bill(o.event._bill); delete o.event._bill; } res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const bad = (status, error) => Object.assign(new Error(error), { status });
const body = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 30000) c.push(d); }); req.on('end', () => { if (n > 30000) return no(bad(413, 'Too big')); try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(bad(400, 'Bad request')); } }); req.on('error', no); });
const clone = (o) => JSON.parse(JSON.stringify(o));
const cleanName = (n, max) => String(typeof n === 'string' || typeof n === 'number' ? n : '').replace(/[<>&"'`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 30);
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
  // Seeds come from the rating module's `use` (tournament rating, else Oddable rating, else the 1500 start). Equal numbers: real results before a new player's 1500, then the typed number (shown only).
  const u = (e) => (odd && Number.isFinite(e.or) ? e.or : null);
  if (odd) E.sort((a, b) => (u(b) != null) - (u(a) != null) || (u(a) != null ? u(b) - u(a) : 0) || (b.orReal ? 1 : 0) - (a.orReal ? 1 : 0) || typed(b) - typed(a) || a.at - b.at);
  else if (R.seeding === 'rating') E.sort((a, b) => typed(b) - typed(a) || a.at - b.at);
  else if (R.seeding === 'random') { for (let i = E.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [E[i], E[j]] = [E[j], E[i]]; } }
  const ids = E.map((e) => e.eid); // manual = the order the commissioner entered (or moved) them
  // Seeds the organizer set by hand (Playbook: a money event is not seeded by the Oddable rating alone). Entries added afterwards follow in the usual order.
  if (R.seeding !== 'random' && Array.isArray(evt.seedSet)) { const have = new Set(ids), set = evt.seedSet.filter((x, i, a) => have.has(x) && a.indexOf(x) === i); return set.concat(ids.filter((x) => !set.includes(x))); }
  return ids;
}
const needSeats = (evt) => { const o = []; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (!isBlank(p) && p.need) o.push(p); })); return o; };
const seedHow = (evt) => { const R = evt.rules; return Array.isArray(evt.seedSet) && R.seeding !== 'random' ? 'by the organizer (set by hand; the ratings and confirmed games were shown)' : R.seeding === 'oddable' || (evt.sport === 'pickleball' && R.seeding === 'rating') ? 'by Oddable rating' : R.seeding === 'rating' ? 'by rating' : R.seeding === 'random' ? 'at random' : 'as entered'; };
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
  audit(evt, now, 'Commissioner', 'draw', null, (evt.fmt === 'ladder' ? 'Ladder set: ' : 'Draw made: ') + ids.length + ' entries, seeded ' + seedHow(evt));
  { const nd = usesOdd(evt) && R.seeding !== 'random' && R.seeding !== 'manual' && !Array.isArray(evt.seedSet) ? needSeats(evt) : []; if (nd.length && needApprove(evt)) audit(evt, now, 'Oddable', 'seeds', null, (nd.length === 1 ? cleanName(nd[0].name, 24) + "'s rating was" : nd.length + " players' ratings were") + ' not approved by the organizer before the start, so ' + (nd.length === 1 ? 'that player was' : 'they were') + ' seeded at the Oddable seed number (' + nd.map((p) => cleanName(p.name, 24) + ' ' + (Number.isFinite(p.sd) ? p.sd : 1500)).join(', ').slice(0, 90) + ').'); else if (nd.length) audit(evt, now, 'Oddable', 'seeds', null, (nd.length === 1 ? cleanName(nd[0].name, 24) + ' has' : nd.length + ' players have') + ' no usable rating yet and ' + (nd.length === 1 ? 'was seeded as a new player' : 'were seeded as new players') + ' (1500). The organizer did not set the seeds.'); }
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
// THE LAST PLAYOFF SPOT(S) ACROSS POOLS (third review M2). When the playoff size is not a multiple of the pool count (3 pools, top 4), every pool's top
// floor(N / pools) go through and the spots left go to the best of the pools' next places, compared by record: win percentage, then point difference per game,
// then points per game (M3, fourth review; stated on the standings screen and written to the history). When those records are LEVEL across the cut, nothing decides it silently (never the
// pool order): it is an OPEN tie like any other. The organizer settles it with a coin flip (the default) or a playoff, logged and shown, and the event waits.
// Fourth review M3 (manager, Nov 17 2026): across pools of UNEQUAL size the records are compared PER GAME: win percentage, then point difference per
// game, then points per game (exact: cross-multiplied, no rounding). Level on all three = an open tie (coin flip by default, or a playoff).
const perG = (a, b, k) => b[k] * Math.max(1, a.n) - a[k] * Math.max(1, b.n); // > 0 when b has more of k per game than a
const recCmp = (a, b) => perG(a, b, 'w') || perG(a, b, 'diff') || perG(a, b, 'pf'), recEq = (a, b) => !recCmp(a, b);
const XREC = 'win percentage, point difference per game, points per game';
function wildcard(evt, tables) { // null when every playoff spot belongs to a pool position
  const P = tables.length, N = (evt.rules && evt.rules.playoff) || 0, full = Math.floor(N / Math.max(1, P)), rem = P ? N % P : 0; if (!N || !rem || P < 2) return null;
  const c = tables.map((t) => t[full]).filter(Boolean).sort(recCmp), entIx = (id) => (evt.entrants || []).findIndex((e) => e.eid === id), out = { pos: full + 1, spots: rem, take: [], how: {}, open: null, key: null };
  if (c.length <= rem) { c.forEach((r) => { out.take.push(r.eid); out.how[r.eid] = 'record'; }); return out; }
  for (let i = 0; i < c.length && out.take.length < rem;) { let j = i; while (j + 1 < c.length && recEq(c[j + 1], c[i])) j++; const grp = c.slice(i, j + 1), left = rem - out.take.length;
    if (grp.length <= left) { grp.forEach((r) => { out.take.push(r.eid); out.how[r.eid] = 'record'; }); i = j + 1; continue; }
    const ids = grp.map((r) => r.eid).sort((a, b) => entIx(a) - entIx(b)), key = tieKey(ids), t = evt.tb && evt.tb[key]; out.key = key; let order = null;
    if (t && t.how === 'coin' && Array.isArray(t.order) && t.order.length === ids.length && t.order.every((e) => ids.includes(e))) order = t.order;
    else if (t && t.how === 'game') { const ms = (t.ms || []).map((id) => evt.matches.find((x) => x.id === id)); if (ms.length === ids.length - 1 && ms.every((m) => m && m.state === 'confirmed')) { const o = [winnerOf(ms[ms.length - 1])].concat(ms.slice().reverse().map(loserOf)); if (o.every((e) => ids.includes(e))) order = o; } }
    if (order) order.slice(0, left).forEach((e) => { out.take.push(e); out.how[e] = t.how === 'coin' ? 'coin flip' : 'tiebreak playoff'; });
    else out.open = { key, pool: null, x: true, spots: left, pos: full + 1, eids: ids, game: t && t.how === 'game' ? (t.ms || [])[(t.ms || []).length - 1] || null : null };
    break; }
  return out;
}
// Ties the rulebook order could not break, once every pool match is in: the event waits for the organizer's choice (never the seed, never the pool order).
function openTies(evt) {
  if (evt.fmt !== 'rr' || !evt.drawn) return []; const pool = evt.matches.filter((m) => m.st === 'pool'); if (!pool.length || pool.some((m) => m.state !== 'confirmed')) return [];
  const out = {}, tables = (evt.pools || []).map((p, i) => poolTable(evt, p, i)); tables.forEach((t, i) => t.forEach((r) => { if (r.tie && r.tieOpen) (out[r.tie] = out[r.tie] || { key: r.tie, pool: i, eids: [], game: r.tieGame || null }).eids.push(r.eid); }));
  const list = Object.values(out); if (!list.length) { const w = wildcard(evt, tables); if (w && w.open) list.push(w.open); } // pool ties first: the cross-pool spot needs every pool's order
  return list;
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
  const tables = evt.pools.map((p, i) => poolTable(evt, p, i)), fullT = Math.floor(evt.rules.playoff / tables.length), w = wildcard(evt, tables);
  const tiers = []; for (let r = 0; r < fullT; r++) tiers.push(tables.map((t) => t[r]).filter(Boolean).sort(recCmp).map((x) => x.eid)); // pool winners first, then 2nd places... (this order only seeds the bracket)
  if (w && w.take.length) tiers.push(w.take.slice()); // the spots left over: by record across pools, a level record settled by the organizer (openTies), never by pool order
  evt.poSeeds = crossPool(evt, tiers, evt.rules.playoff); if (evt.poSeeds.length < 2) return;
  buildElim(evt.poSeeds.length, 'p', false).M.forEach((m) => evt.matches.push(m)); advance(evt); courtsElim(evt);
  audit(evt, now, 'Oddable', 'playoff', null, 'Pool play done. Playoff: top ' + evt.poSeeds.length);
  if (w && w.take.length) audit(evt, now, 'Oddable', 'playoff', null, 'Last playoff spot' + (w.spots > 1 ? 's' : '') + ' across pools (best of the ' + ord(w.pos) + ' places): ' + w.take.map((e) => nameOf(evt, e) + ' (' + (w.how[e] === 'record' ? 'by record: ' + XREC : 'records level: ' + w.how[e]) + ')').join(', '));
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

// MONEY RULES ARE FINAL ONCE ANYONE OTHER THAN THE ORGANIZER HAS JOINED (third review M1; owner rule from Groups). Entry, commissioner's take, payout split
// (the payout table), pot and format cannot change while another account is in the event: `edit` answers 409. Every other detail may still change before
// the start, but each change is written to the history with its old and new value and every member gets a notice (shown for 3 days).
const SPLITTXT = { '100': 'winner takes all', '60/30/10': '60 / 30 / 10', '50/30/20': '50 / 30 / 20', '70/30': '70 / 30', none: 'no prizes' };
const usdT = (n) => '$' + (Number.isInteger(Number(n)) ? Number(n).toLocaleString('en-US') : Number(n).toFixed(2));
const ctTime = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)) + ' CT';
const othersIn = (evt) => evt.members.some((m) => m.mk !== evt.comm);
// Fourth review M1 (manager, Nov 17 2026): the money rules (entry, take, payout split, pot, format) become FINAL the moment any OTHER account has ever
// joined OR any seat (typed-in players included) is marked paid. That moment is stored on the event row (evt.moneyAt) and never cleared: leaving,
// un-marking "paid" or everyone leaving does not reopen them. Checked after every write (mutate), so no route can miss it.
const anyPaid = (evt) => evt.members.some((m) => m.paid) || evt.entrants.some((e) => (e.players || []).some((p) => p.paid));
const moneyLocked = (evt) => !!evt.moneyAt || othersIn(evt) || anyPaid(evt);
function stampMoney(evt, now) { if (evt.moneyAt || !(othersIn(evt) || anyPaid(evt))) return; evt.moneyAt = now; audit(evt, now, 'Oddable', 'money', null, 'Money rules are final from now on (' + (othersIn(evt) ? 'someone joined' : 'a player was marked paid') + '): entry, take, payout split, pot and format cannot change.'); }
const moneyFields = (x) => ({ Entry: x.money.entry ? usdT(x.money.entry) + ' per player' : 'no entry', "Commissioner's take": takeText(x.money).replace(/^Commissioner keeps /, ''), 'Payout split': SPLITTXT[x.money.split] || x.money.split, Pot: x.money.pot === 'side' ? 'side pot' : 'main pot', Format: FMTN[x.fmt] });
const yn = (v) => (v ? 'yes' : 'no');
const otherFields = (x) => { const r = x.rules || {}, solo = x.fmt === 'solo'; return { Name: x.title, Sport: x.sport, Starts: ctTime(x.start), 'Last day': x.endDay || undefined, Play: solo ? undefined : r.unit, 'Games to': solo ? undefined : r.to || 'highest score wins', 'Win by': solo ? undefined : r.winBy, 'Best of': solo ? undefined : r.bestOf, Scoring: r.scoring ? (r.scoring === 'rally' ? 'rally' : 'side-out') : undefined,
  Seeding: solo ? undefined : { rating: 'by rating', oddable: 'by Oddable rating', random: 'random draw', manual: 'as entered' }[r.seeding], Courts: solo ? undefined : r.courts, 'Who enters scores': solo ? undefined : { a: 'first-listed side', either: 'either side', comm: 'the commissioner' }[r.scorer], 'Side matches': solo || x.fmt === 'h2h' ? undefined : yn(r.side),
  Pools: r.pools, Playoff: x.fmt === 'rr' ? (r.playoff ? 'top ' + r.playoff : 'none') : undefined, 'Bracket reset': r.reset ? (r.reset === 'game15' ? 'one game to 15' : 'a full match') : undefined, 'Challenge reach': r.reach, 'Play within (days)': r.expDays, 'Not played in time': r.expire ? (r.expire === 'void' ? 'cancelled' : 'challenger wins') : undefined, 'Winner moves': r.move ? (r.move === 'swap' ? 'swap places' : 'take the spot') : undefined,
  "Pick'em": solo ? undefined : yn(r.pickem), "Pick'em points": r.pickem ? (r.weight === 'round' ? 'later rounds worth more' : '1 per right pick') : undefined, 'Lowest score wins': solo ? yn(r.low) : undefined, 'What is counted': solo ? r.unitLabel : undefined, 'Players add themselves': yn(x.join && x.join.self), Spectators: yn(x.join && x.join.spectators) }; };
const fieldDiff = (a, b) => { const out = []; [...new Set(Object.keys(a).concat(Object.keys(b)))].forEach((k) => { const x = a[k] == null ? 'not set' : String(a[k]), y = b[k] == null ? 'not set' : String(b[k]); if (x !== y) out.push({ k, a: x, b: y }); }); return out; };
// A notice every member sees on the event for 3 days (rule changes, a playoff reset, picks voided by a seat claim). The last few are kept.
function notify(evt, now, by, text) { const n = { at: now, by: cleanName(by, 30) || 'Oddable', text: String(text || '').replace(/[<>]/g, '').slice(0, 700) }; evt.notice = n; evt.notices = (evt.notices || []).filter((x) => now - x.at < 3 * DAY).concat(n).slice(-6); }
const noticesOf = (evt, now) => (Array.isArray(evt.notices) ? evt.notices : evt.notice ? [evt.notice] : []).filter((x) => x && now - x.at < 3 * DAY).slice().reverse();

// ---------- people (cap: 8 per game for standard accounts, organizer included) ----------
// People = every account in the event (organizer, players, spectators) + the typed-in players of entries that nobody has claimed yet.
function people(evt) { const n = evt.members.length; let typed = 0; evt.entrants.forEach((e) => { typed += (e.players || []).filter((p) => !p.pid).length; }); return n + typed; }
async function capOf(evt) { const n = await capFor(evt.ce, evt.id); ENTF.set(evt.id, await entFor(evt.ce)); if (ENTF.size > 5000) ENTF.delete(ENTF.keys().next().value); return n; }

// ---------- rate limits ----------
const RL = new Map(), GONE = new Map();
function limit(key, n, ms) { const t = D.now(), a = (RL.get(key) || []).filter((x) => t - x < ms); if (a.length >= n) { RL.set(key, a); return true; } a.push(t); RL.set(key, a); if (RL.size > 20000) { let k = 0; for (const x of RL.keys()) { RL.delete(x); if (++k > 5000) break; } } return false; }
// [per account n, ms, per IP n, ms]. Every bucket is keyed by ONE account or ONE IP (the signed-out invite preview used to share a single bucket for
// everybody, so a league invite to 200 people locked itself out). The IP buckets are flood guards sized for a whole club on one Wi-Fi; guessing codes is
// stopped separately (10 wrong codes per account / IP = 15 minutes blocked).
// Third review (L3): sized for 500 people on ONE Wi-Fi each opening the invite twice (1,000 opens in a few minutes) with room to spare. The signed-out
// preview is also counted per phone and code (the app's device token + the code + the IP: 30 / 10 min), and wrong codes block the PHONE that sent them
// (10 = 15 minutes); the whole IP is blocked only after 200 wrong codes in 15 minutes, so one person's typos never shut out a club.
const LIM = { create: [6, 3600e3, 15, 3600e3], join: [40, 600e3, 3000, 600e3], score: [60, 600e3, 1200, 600e3], peek: [0, 0, 3000, 600e3], glist: [120, 600e3, 3000, 600e3] }, PEEK_DEV = [30, 600e3], WRONG_IP = 200;
const devOf = (b) => { const d = String((b && b.dev) || ''); return /^[A-Za-z0-9_-]{8,40}$/.test(d) ? d : '-'; };
function rate(kind, who, ip) { const L = LIM[kind]; if ((who && L[0] && limit(kind + '|a|' + who, L[0], L[1])) || limit(kind + '|i|' + ip, L[2], L[3])) throw bad(429, 'Too many tries. Wait a few minutes.'); }
const codeFail = (k) => { const t = D.now(), a = (RL.get(k) || []).filter((x) => t - x < 900e3); a.push(t); RL.set(k, a); };
const codeBlocked = (k, n) => (RL.get(k) || []).filter((x) => D.now() - x < 900e3).length >= (n || 10);

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
// H2 (fourth review, stats contract v1.4 "the organizer approves every money-game number"): with the stats module in the build, an event with MONEY SHOWN
// (an entry) or an ENTERPRISE tournament is registered with stats.eventSetup (organizer, co-organizers, players with their entry as the team, lockAt =
// the start), and the number each player plays off (`use`) is only what the organizer APPROVED (eventApprove / eventApproveAll) or SET (eventOverride,
// with a reason). Events never computes or gates on confirmation itself. Seeds are NOT forced: if the organizer never approves, the draw is still made
// at the start, the unapproved players at their stats `seed`, and the history says so. A casual event (no money, not Enterprise) asks with
// {casual: true} and shows the full rating. Without the stats module (D.rt() = STAND) nothing here applies: events keeps its built-in Elo as before.
const NEWM = () => { const RT = D.rt(); return !RT.standIn && ['eventReview', 'eventApprove', 'eventApproveAll'].every((f) => typeof RT[f] === 'function'); };
const entEvt = (evt) => !!(evt.isEnt || ENTF.get(evt.id));
const needApprove = (evt) => usesOdd(evt) && NEWM() && (Number(evt.money && evt.money.entry) > 0 || entEvt(evt));
// ST: the ONE adapter between events and the stats approval contract: stats-v1 1426e22, "Player stats (v1.5) — contract for golf and events". Every
// stats call of the approval model goes through it, so a contract change is a few lines here (HANDOFF "Local events v1.5", "Stats contract switch").
//   ids: 'evt:' + the event's own id (10 random characters, a fresh one per game; approvals never carry over). The organizer = the account that created it.
//   co-organizers and team seats count only after that person accepts on their own phone (`accept`: only ever with the caller's own signed-in account).
//   own number: a co-sign CODE minted for the co-signer's own account (`cosignCode`), passed by the organizer's engine. Money events register `lockAt` =
//   the start; at the start events plays off the `eventNumbers` snapshot. Exact sport keys ('pickleball' | 'tennis' | 'other:<game>').
const ST = {
  id: (evt) => 'evt:' + evt.id,
  sport: (evt) => rtSport(evt),
  has: (f) => typeof D.rt()[f] === 'function',
  setup: (evt, o) => D.rt().eventSetup(evt.ce, ST.id(evt), o),
  review: (evt, e) => D.rt().eventReview(ST.id(evt), e),
  approveAll: (evt, e) => D.rt().eventApproveAll(ST.id(evt), e),
  approve: (evt, key, value, e, o) => D.rt().eventApprove(ST.id(evt), key, value, e, o || {}),
  override: (e, evt, key, o) => D.rt().eventOverride(e, ST.id(evt), key, o),
  log: (evt) => D.rt().eventLog(evt.ce, ST.id(evt)),
  accept: (evt, e) => (ST.has('eventAccept') ? D.rt().eventAccept(ST.id(evt), e) : null),
  remove: (evt, key, why) => (ST.has('eventRemove') ? D.rt().eventRemove(ST.id(evt), evt.ce, key, why) : null),
  start: (evt) => (ST.has('eventStart') ? D.rt().eventStart(ST.id(evt), evt.ce) : null),
  numbers: (evt) => (ST.has('eventNumbers') ? D.rt().eventNumbers(ST.id(evt)) : null),
  cosignCode: async (evt, signerE, playerRef, value) => (ST.has('cosignToken') ? { cosign: (await D.rt().cosignToken(ST.id(evt), playerRef, value, signerE)).code } : { cosign: signerE }), // 9aeeafa took the account id
  ro: (evt) => ({ eventId: ST.id(evt) }),
};
const STARTED = new Set(); // event ids whose stats event was started early (the organizer's early draw)
const SIG = new Map(); // event id -> what stats.eventSetup was last told by this server (re-sent only when it changes)
async function regStats(evt) {
  if (!evt || evt.deleted || !needApprove(evt) || evt.drawn || D.now() >= evt.start) return; const RT = D.rt(), players = [];
  evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (!isBlank(p)) players.push({ key: seatKey(evt, p), team: e.eid, name: p.name }); }));
  const o = { title: evt.title, sport: ST.sport(evt), kind: entEvt(evt) ? 'tournament' : 'game', money: Number(evt.money.entry) > 0, lockAt: evt.start, coOrganizers: evt.members.filter((m) => m.co && m.ak).map((m) => m.ak), directors: [], players };
  const sig = JSON.stringify(o); if (SIG.get(evt.id) === sig) return; try { await ST.setup(evt, o); SIG.set(evt.id, sig); if (SIG.size > 5000) SIG.delete(SIG.keys().next().value); } catch (x) { if (!x.status) console.error('events eventSetup:', x.message); return; }
  // a player who left (or an entry the organizer removed) leaves the stats event too, before the start (stats.eventRemove), so `ready` can become true
  try { const n = await ST.numbers(evt), now = new Set(players.map((p) => p.key)); for (const x of (n && n.numbers) || []) if (x.userKey && !now.has(x.userKey)) await ST.remove(evt, x.userKey, 'Left the event'); } catch (x) { if (!x.status) console.error('events eventRemove:', x.message); }
}
// The caller accepts HIS OWN seat / co-organizer role in the stats event (only ever with the caller's own account, from his own tap: join, claim, accept).
// markAcc: after stats accepted the caller's seat / role, the event row remembers it (members[].acc = the entry accepted, members[].coAcc), so the
// screens know who still has to accept (a team move makes a seat pending again in stats; events clears acc for the moved accounts).
async function markAcc(evt, mk) { const mine = (x) => { const m = memberOf(x, mk); if (!m) return null; const e = x.entrants.find((y) => pidsOf(y).includes(m.pid)); return { m, eid: e ? e.eid : null }; }, a = mine(evt); if (!a || ((!a.eid || a.m.acc === a.eid) && (!a.m.co || a.m.coAcc))) return evt;
  return mutate(evt.id, (x, now) => { const b = mine(x); if (!b) return { nochange: true, v: x }; let n = 0; if (b.eid && b.m.acc !== b.eid) { b.m.acc = b.eid; n++; } if (b.m.co && !b.m.coAcc) { b.m.coAcc = now; n++; } if (!n) return { nochange: true, v: x }; audit(x, now, b.m.name, 'accept', null, (b.eid ? 'Accepted the seat in ' + nameOf(x, b.eid) : '') + (b.eid && b.m.coAcc === now ? '; ' : '') + (b.m.coAcc === now ? 'accepted the co-organizer role' : '') + ' (for the ratings)'); return x; }); }
async function acceptOwn(evt, e) { if (!needApprove(evt) || evt.drawn || D.now() >= evt.start) return false; try { await regStats(evt); const r = await ST.accept(evt, e); return r ? markAcc(evt, mkOf(e)) : false; } catch (x) { if (!x.status) console.error('events eventAccept:', x.message); return false; } }
const ratingSport = (evt) => STAT_SPORT[evt.sport] || 'other';
// Third review M6 (Playbook play 40: one rating per sport): cornhole, darts, bowling, pool and basketball are all sport 'other' in the stats contract, with
// the game's name in extra.game. Each NAMED game has its own rating: events asks ratingFor(userKey, 'other', {game}) and, when the rating module answers
// without keying by game (stats-v1 e214bcf), builds that game's rating from the same records with the module's own maths (ratings.js eloSet).
// The stats contract's rating key: the sport, or 'other:<name>' for a named game ('other:cornhole'); the unnamed "Other game" stays 'other'.
const rtSport = (evt) => (D.rt() === STAND || typeof D.rt().rateKey === 'function' ? rateKeyOf(evt) : ratingSport(evt)); // what eventSetup / eventOverride are told: the per-game key when the rating module knows it
const rateKeyOf = (evt) => STAT_SPORT[evt.sport] || 'other:' + String(evt.sport || 'other'); // the plain "Other game" = 'other:other', as stats.js rateKey reads its records
async function rateFor(evt, userKey, opts) {
  const RT = D.rt(), key = rateKeyOf(evt); if (!/^other:/.test(key)) return RT.ratingFor(userKey, key, opts || {}); const game = evt.sport; let r = null;
  try { r = await RT.ratingFor(userKey, key, opts || {}); } catch (e) { r = null; } if (r && r.sport === key) return r; // the rating module keys by game itself
  r = await RT.ratingFor(userKey, 'other', Object.assign({}, opts || {}, { game })); // an older module: every "other" game in one rating; split it here
  if (!r || r.game === game || /^guest:/.test(String(userKey))) return r;
  try { const R = realMod('./ratings'); if (!R || typeof R.eloSet !== 'function' || typeof RT.statsFor !== 'function') return r;
    const recs = (await RT.statsFor(userKey, {})).filter((x) => x.kind === 'match' && x.sport === 'other' && x.result && (x.src === 'events' || x.src === 'self') && x.extra && x.extra.game === game).map((x) => Object.assign({}, x, { confirmed: !(x.src === 'events' && x.extra.confirmed === false) && (typeof RT.isConfirmed === 'function' ? RT.isConfirmed(x) : !!x.extra.confirmed) }));
    const S = recs.length ? R.eloSet(recs.map((x) => (x.confirmed ? x : Object.assign({}, x, { extra: Object.assign({}, x.extra, { confirmed: false }) })))) : null, cg = S ? S.confirmedGames : 0, cr = S && cg ? S.confirmedRating : null, trn = r.setBy === 'tournament';
    return Object.assign({}, r, { game, oddable: Object.assign({}, r.oddable, { rating: S ? S.rating : null, matches: S ? S.matches : 0, text: S ? S.text : 'No games yet' }), confirmedRating: cr, confirmedGames: cg, use: trn ? r.event : cr != null ? cr : 1500, start: !trn && cr == null });
  } catch (e) { return r; }
}
const seatKey = (evt, p) => { const m = p.pid && evt.members.find((x) => x.pid === p.pid); return m ? m.ak : 'guest:' + String(p.gid).toLowerCase(); };
const useR = (p) => (Number.isFinite(p.use) ? p.use : null);
function entryRatings(evt) { evt.entrants.forEach((e) => { const ps = (e.players || []).filter((p) => !isBlank(p)), rs = ps.map((p) => (Number.isFinite(useR(p)) ? useR(p) : Number.isFinite(p.sd) ? p.sd : 1500)); /* no confirmed games yet = seeded at the 1500 start */ e.or = rs.length ? Math.round(rs.reduce((a, x) => a + x, 0) / rs.length) : null; e.orReal = ps.some((p) => Number.isFinite(p.or) || Number.isFinite(p.tv)); }); }
async function prepRatings(evt) {
  if (evt.drawn || !usesOdd(evt)) return; const RT = D.rt();
  const nm = NEWM(), ap = nm && needApprove(evt), snap = ap && (D.now() >= evt.start || STARTED.has(evt.id)) ? await ST.numbers(evt).catch(() => null) : null, sn = {}; if (snap && snap.started) (snap.numbers || []).forEach((x) => { if (x.userKey) sn[x.userKey] = x.use; }); // stats v1.5: at the start, the eventNumbers snapshot
  const ro = nm && !ap ? { casual: true } : nm ? ST.ro(evt) : { eventId: evt.id }; // H2: a casual event asks for the full rating
  for (const e of evt.entrants) for (const p of e.players || []) { if (isBlank(p)) { delete p.or; delete p.use; delete p.tv; delete p.need; delete p.why; delete p.sd; delete p.ap; continue; } let r = null; try { r = await rateFor(evt, seatKey(evt, p), ro); } catch (x) { r = null; }
    if (nm) { const od = (r && r.oddable) || {}, num = (v) => (v != null && Number.isFinite(Number(v)) ? Math.round(Number(v)) : null), sg = (r && r.suggested) || {};
      p.or = num(od.rating); p.orn = Number(od.matches) || 0; p.orc = r && Number.isFinite(Number(r.confirmedGames)) ? Number(r.confirmedGames) : 0; p.use = r ? num(r.use) : null; if (seatKey(evt, p) in sn) p.use = num(sn[seatKey(evt, p)]); p.sd = r && num(r.seed) != null ? num(r.seed) : p.use != null ? p.use : 1500;
      p.tv = r && (r.setBy === 'tournament' || r.setBy === 'organizer') ? num(r.event) : null; p.tat = p.tv != null ? r.at || null : null; p.treason = p.tv != null ? cleanName(r.reason, 120) : null;
      p.ap = ap ? { sb: (r && r.setBy) || null, by: cleanName(r && r.by, 30) || null, cs: cleanName(r && r.cosign, 30) || null, shown: cleanName(r && r.shown, 140) || null, sv: num(sg.value), sc: !!sg.confirmed } : null; if (!p.ap) delete p.ap;
      if (ap && p.use == null) { p.need = true; p.why = 'not approved by the organizer yet'; } else { delete p.need; delete p.why; } continue; }
    const od = (r && r.oddable) || {}, num = (v) => (v != null && Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
    p.or = num(r && 'confirmedRating' in r ? r.confirmedRating : od.rating); p.orn = Number(od.matches) || 0; p.orc = r && Number.isFinite(Number(r.confirmedGames)) ? Number(r.confirmedGames) : null; /* the rating shown and used = confirmed games only ("x of y games confirmed") */ p.tv = r && r.setBy === 'tournament' ? num(r.event) : null; p.tat = p.tv != null ? r.at || null : null; p.treason = p.tv != null ? cleanName(r.reason, 120) : null; p.use = r ? num(r.use) : null;
    // stats v1.2: `use` is null until the player's confirmed games come from 3 different accounts (then the organizer sets the number); `seed` is always a number
    p.need = !!(r && p.tv == null && (r.needsSet === true || r.use == null)); p.why = p.need ? cleanName(r.why || 'no confirmed games yet', 90) : null; p.sd = r && num(r.seed) != null ? num(r.seed) : p.use != null ? p.use : 1500; if (!p.need) { delete p.need; delete p.why; } }
  entryRatings(evt);
}
const mutate = (id, fn) => mutateRow(ROW(id), null, async (data) => { const now = D.now(); await prepRatings(data); const t = tick(data, now); const out = await fn(data, now); if (out && out.nochange) { if (t) { data.u = now; return out.v; } return out; } tick(data, now); if (data.members && !data.deleted) stampMoney(data, now); data.u = now; return out; });
const idxSet = (id, f) => mutateRow(IDX, () => ({ ev: {} }), async (data) => { data.ev = data.ev || {}; const r = f(data.ev[id] ? clone(data.ev[id]) : null); if (r === undefined) return { nochange: true }; if (r === null) delete data.ev[id]; else data.ev[id] = r; return {}; });
const idxEntry = (evt) => ({ c: evt.code, t: evt.title, mk: evt.members.map((m) => m.mk), s: evt.start, e: evt.endDay || null, f: evt.fin || 0, g: evt.group ? evt.group.gid : null });
async function byCode(code) { const ix = await D.S.dbGet(IDX), ev = (ix && ix.data && ix.data.ev) || {}; let hit = null; Object.keys(ev).forEach((id) => { if (ev[id].c && sameCode(ev[id].c, code)) hit = id; }); return hit; }

// ---------- views (what each person may see) ----------
const nameOf = (evt, eid) => { if (eid === 'BYE') return 'Bye'; const e = evt.entrants.find((x) => x.eid === eid); return e ? e.name : null; };
const isBlank = (p) => !p.pid && (p.blank || /^(Partner \d|Open seat)$/.test(p.name || '')); // pre-fix rows: placeholder names
const pidsOf = (e) => ((e && e.players) || []).filter((p) => p.pid).map((p) => p.pid);
const memberOf = (evt, mk) => evt.members.find((m) => m.mk === mk);
const isComm = (evt, mk) => evt.comm === mk;
// Co-organizers (fourth review, Nov 17 2026): the organizer may name members as co-organizers before the start. They approve / set ratings with him
// (registered with the stats module as coOrganizers), co-sign his own number, and set or close pick'em closing times. Results stay with the organizer.
const isOrg = (evt, mk) => isComm(evt, mk) || !!(memberOf(evt, mk) || {}).co;
const canCosign = (evt, mk) => { const cs = evt.cs, m = memberOf(evt, mk); if (!cs || !m || !m.ak || m.pid === cs.pid) return false; const rq = evt.members.find((x) => x.pid === cs.pid), comm = (x) => x && x.mk === evt.comm; if (m.co && m.coAcc && rq && !comm(rq) && !comm(m)) return true; /* another co-organizer (never the organizer's appointee for the organizer, or the reverse: stats v1.5) */ const mine = evt.entrants.find((e) => pidsOf(e).includes(m.pid)); return !!(mine && mine.eid !== cs.eid && m.acc === mine.eid); }; // a player on ANOTHER team who accepted his seat // a co-organizer / the organizer, or a player on ANOTHER team
const orgPid = (evt, pid) => { const m = evt.members.find((x) => x.pid === pid); return !!(m && (m.mk === evt.comm || m.co)); };
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
  if (p.locked) return 'Picks for this round were closed by the commissioner' + (p.by ? ' (' + p.by + ')' : '') + '.'; if (p.at && now >= p.at) return 'Picks for this round closed at the closing time the commissioner set.';
  if (m.live || PLAYED.has(m.state) || DONE.has(m.state)) return 'Picks for this match closed when it started.'; return 'Picks for this round closed when its first match started or got a score.'; };
const pickLocked = (evt, m, now) => locked(m, now) || roundLock(evt, m, now) || evt.matches.some((x) => x !== m && roundKey(x) === roundKey(m) && (x.live || PLAYED.has(x.state) || x.state === 'confirmed'));
function pub(evt, now) {
  return { group: evt.group ? { id: evt.group.gid } : null, id: evt.id, title: evt.title, sport: evt.sport, fmt: evt.fmt, fmtName: FMTN[evt.fmt], start: evt.start, endDay: evt.endDay, rules: evt.rules, money: evt.money, join: evt.join, takeText: takeText(evt.money), pot: potSummary(evt),
    entries: evt.entrants.length, people: people(evt), commName: (evt.members.find((m) => m.mk === evt.comm) || {}).name || '', started: now >= evt.start, drawn: !!evt.drawn, locked: now >= evt.start || !!evt.drawn, fin: evt.fin || 0, inGroup: !!evt.group, entText: limits.ENTERPRISE_TEXT };
}
function full(evt, mk, now, cap) {
  const o = pub(evt, now), me = memberOf(evt, mk), comm = isComm(evt, mk); o.role = comm ? 'comm' : me ? me.role : 'none'; o.me = me ? me.pid : null; o.code = evt.code; o.cap = cap; o.u = evt.u || 0;
  o.myEntries = me ? evt.entrants.filter((e) => pidsOf(e).includes(me.pid)).map((e) => e.eid) : [];
  const seedIx = (id) => (evt.seeds || []).indexOf(id), odd = usesOdd(evt);
  o.entrants = evt.entrants.map((e) => ({ eid: e.eid, name: e.name, rating: e.rating == null ? null : e.rating, seed: seedIx(e.eid) + 1 || null, linked: pidsOf(e).length, open: (e.players || []).filter((p) => !p.pid).length, oddRating: e.or == null ? null : e.or,
    players: (e.players || []).map((p) => Object.assign({ gid: p.gid, name: p.name, guest: !p.pid, me: !!(me && p.pid === me.pid), blank: isBlank(p), paid: isBlank(p) ? false : seatPaid(evt, p) }, comm && !p.pid ? { claim: evt.code + '.' + p.ct } : {},
      odd && !isBlank(p) ? { odd: Number.isFinite(p.or) || p.orn ? { rating: Number.isFinite(p.or) ? p.or : null, matches: p.orn || 0, confirmed: Number.isFinite(p.orc) ? p.orc : Number.isFinite(p.or) ? p.orn || 0 : 0 } : null, trn: Number.isFinite(p.tv) ? { v: p.tv, at: p.tat || null, reason: p.treason || '' } : null, use: useR(p), seed: Number.isFinite(p.sd) ? p.sd : useR(p) != null ? useR(p) : 1500, needsSet: !!p.need, why: p.need ? p.why : undefined, ap: p.ap ? { setBy: p.ap.sb, by: p.ap.by, cosign: p.ap.cs, shown: p.ap.shown, suggested: p.ap.sv, confirmed: p.ap.sc } : undefined } : {})) }));
  o.seedSet = Array.isArray(evt.seedSet) && evt.rules.seeding !== 'random'; o.moneyEvent = Number(evt.money.entry) > 0; o.seedPlan = comm && !evt.drawn && evt.fmt !== 'solo' && evt.rules.seeding !== 'random' ? seedList(evt) : null; // the seeds the draw would use now (organizer only)
  o.seedNeed = odd && !evt.drawn ? needSeats(evt).map((p) => p.name) : []; // players whose rating cannot be used yet: in a money event the organizer sets the seeds
  o.odd = odd; o.ent = !!ENTF.get(evt.id); o.tlog = (evt.tlog || []).slice(-100).reverse(); o.teams = UNITS[evt.rules.unit] > 1 && evt.fmt !== 'solo';
  o.isOrg = isOrg(evt, mk); o.members = evt.members.map((m) => ({ pid: m.pid, name: m.name, role: m.role, paid: !!m.paid, comm: m.mk === evt.comm, co: !!m.co, plays: evt.entrants.some((e) => pidsOf(e).includes(m.pid)) })); // plays: false = no entry owed (a non-playing organizer, a spectator)
  const np = evt.drawn ? [] : needPartner(evt); o.hold = np.length ? { names: np.map((e) => e.name), eids: np.map((e) => e.eid), late: now >= evt.start } : null; o.notices = noticesOf(evt, now); o.notice = o.notices[0] || null; o.approve = needApprove(evt) ? (() => { const st = seatsPlaying(evt); return { open: !evt.drawn && now < evt.start, total: st.length, approved: st.filter((p) => useR(p) != null).length, need: st.filter((p) => p.need).map((p) => p.name), casual: false }; })() : null; o.casual = NEWM() && usesOdd(evt) && !o.approve; // H2: the organizer's to-do before the start
  o.cosign = evt.cs && needApprove(evt) ? { name: (evt.members.find((m) => m.pid === evt.cs.pid) || {}).name || '', kind: evt.cs.kind, value: evt.cs.value, reason: evt.cs.reason || '', at: evt.cs.at, mine: !!(me && me.pid === evt.cs.pid), canSign: canCosign(evt, mk) && !evt.drawn && now < evt.start } : null;
  if (o.approve && me && !evt.drawn && now < evt.start) { const myE = evt.entrants.find((e) => pidsOf(e).includes(me.pid)); o.acceptMe = (myE && me.acc !== myE.eid) || (me.co && !me.coAcc) ? { seat: myE && me.acc !== myE.eid ? myE.name : null, co: !!(me.co && !me.coAcc) } : null; }
  o.moneyFinal = moneyLocked(evt); o.moneyAt = evt.moneyAt || null; o.poHold = evt.poHold || null;
  o.matches = evt.matches.map((m) => { const s = sideOf(evt, mk, m); return { id: m.id, st: m.st, r: m.r, pool: m.pool, court: m.court, wave: m.wave, a: m.a, b: m.b, an: nameOf(evt, m.a), bn: nameOf(evt, m.b), state: m.state, games: m.games, win: m.win, v: m.v, live: !!m.live, start: m.start || null, exp: m.exp || null, forfeit: !!m.forfeit, reset: !!m.reset, rule: m.reset && evt.rules.reset === 'game15' ? { to: 15, winBy: 2, bestOf: 1 } : null,
    sub: m.sub ? { side: m.sub.side, games: m.sub.games, by: m.sub.by, at: m.sub.at, note: m.sub.note || '' } : null, mine: s, canScore: canScore(evt, mk, m, now).ok, canConfirm: canConfirm(evt, mk, m).ok, needsComm: m.state === 'disputed' || (m.state === 'pending' && !linked(evt, m.sub && m.sub.side === 'a' ? m.b : m.a)) }; });
  o.byes = evt.byes || {}; o.pools = evt.pools || null;
  if (evt.fmt === 'rr' && evt.drawn) { o.ties = openTies(evt).map((t) => ({ key: t.key, names: t.eids.map((e) => nameOf(evt, e)), game: t.game, matches: t.eids.length - 1, cross: !!t.x, spots: t.spots || null, pos: t.pos || null })); o.wild = wildView(evt); o.poStarted = poStarted(evt); o.hasPlayoff = !!evt.poSeeds; o.tbLog = Object.values(evt.tb || {}).map((t) => ({ how: t.how, at: t.at, by: t.by, text: t.text })); }
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
// The people on a side as frozen on the match. k = the account's key in the STATS form ('a:' + sha256('oddable-opp|' + stats member key).slice(0, 12), the
// same key stats.js builds for a self-logged match, so the two can be matched): a hash, never the account id. Typed-in players have no k.
const sKey = (ak) => 'a:' + crypto.createHash('sha256').update('oddable-opp|' + crypto.createHash('sha256').update('oddable-group|' + ak).digest('hex').slice(0, 24)).digest('hex').slice(0, 12);
// H1 (fourth review): the confirmer reference is the stats module's own acctRef(account), which also FILES it in the stats confirmer directory (without that,
// stats could not tell who confirmed and counted no event match). Same value as sKey; sKey is the fallback when the stats module is not in the build.
const refOf = (ak) => { const RT = D.rt(); if (ak && typeof RT.acctRef === 'function') { try { const r = RT.acctRef(ak); if (typeof r === 'string' && r) return r; } catch (e) {} } return sKey(ak); };
const LINKED = new Set(); // 'a:' keys already filed with stats.linkRef by this server (matches played before the fix)
async function linkRefs(evt) { const RT = D.rt(); if (typeof RT.linkRef !== 'function') return; for (const m of evt.members) { if (!m.ak) continue; const k = sKey(m.ak); if (LINKED.has(k)) continue; try { if (await RT.linkRef(k, m.ak)) LINKED.add(k); } catch (e) {} if (LINKED.size > 20000) LINKED.clear(); } }
const seats = (evt, eid) => { const e = evt.entrants.find((x) => x.eid === eid); return e ? (e.players || []).filter((p) => !isBlank(p)).map((p) => { const m = p.pid && evt.members.find((x) => x.pid === p.pid); return Object.assign({ gid: p.gid, pid: p.pid || null, name: p.name }, m && m.ak ? { k: sKey(m.ak) } : {}); }) : []; };
// Playbook fix (manager, Nov 16 2026): every match record carries the ratings of the people in it, so the Oddable rating is a real Elo (beating a
// higher-rated opponent gains more). snapRatings reads each seat's lifetime Oddable rating (never a tournament rating) just before the result is saved.
async function snapRatings(evt, m) { const out = {}, RT = D.rt(); if (!m) return out; for (const eid of [m.a, m.b]) { const e = evt.entrants.find((x) => x.eid === eid); for (const p of (e && e.players) || []) { if (isBlank(p)) continue; try { const r = await rateFor(evt, seatKey(evt, p)), v = r && 'confirmedRating' in r ? r.confirmedRating : r && r.oddable ? r.oddable.rating : null; if (v != null && Number.isFinite(Number(v))) out[p.gid] = Math.round(Number(v)); } catch (x) {} } } return out; }
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
  const rows = Object.keys(P).filter((pid) => !orgPid(evt, pid)).map((pid) => { const p = P[pid]; let pts = 0, right = 0, n = 0; evt.matches.forEach((m) => { const k = p.m && p.m[m.id]; if (!k || m.state !== 'confirmed') return; n++; if (k.s === m.win && !m.forfeit) { right++; pts += pickPoints(evt, m); } else if (k.s === m.win) { right++; pts += pickPoints(evt, m); } }); return { pid, name: (evt.members.find((x) => x.pid === pid) || {}).name || 'Player', pts, right, n, tb: p.tb == null ? null : p.tb, tbOff: total == null || p.tb == null ? null : Math.abs(p.tb - total), last: p.last || 0 }; });
  // Tiebreak: closest guess of the final's total points (all games of the final added up), then whoever finished their picks earlier.
  rows.sort((a, b) => b.pts - a.pts || (a.tbOff == null ? 1e9 : a.tbOff) - (b.tbOff == null ? 1e9 : b.tbOff) || a.last - b.last || a.name.localeCompare(b.name));
  rows.forEach((r, i) => (r.place = i + 1)); return { rows, finalTotal: total };
}
function pickemView(evt, me, now) {
  const P = evt.picks || {}, mine = me && P[me.pid] ? P[me.pid] : { m: {} }, t = pickTable(evt), cnt = {};
  evt.matches.forEach((m) => { if (!pickLocked(evt, m, now)) return; let a = 0, b = 0; Object.values(P).forEach((p) => { const k = p.m && p.m[m.id]; if (k && k.s === 'a') a++; else if (k && k.s === 'b') b++; }); cnt[m.id] = { a, b }; }); // others' picks only as counts, and only once the match is locked
  const fm = finalMatch(evt), tbOpen = !!evt.fin || !!(fm && pickLocked(evt, fm, now)); // review fix 8: others' tiebreak guesses only once the final has locked
  const org = !!(me && orgPid(evt, me.pid)); // M2: the organizer and co-organizers follow the pick'em but never pick
  return { org, mine: mine.m || {}, voided: Object.keys(mine.void || {}).map((k) => { const m = evt.matches.find((x) => x.id === k); return { m: k, an: m ? nameOf(evt, m.a) : null, bn: m ? nameOf(evt, m.b) : null, s: mine.void[k].s, at: mine.void[k].at }; }), tb: mine.tb == null ? null : mine.tb, table: t.rows.map((r) => (tbOpen || (me && r.pid === me.pid) ? r : Object.assign({}, r, { tb: null }))), finalTotal: t.finalTotal, counts: cnt, open: org ? [] : evt.matches.filter((m) => pickable(m) && m.state === 'ready' && !pickLocked(evt, m, now) && m.a && m.b && m.a !== 'BYE' && m.b !== 'BYE' && !(me && sideOf(evt, me.mk, m))).map((m) => m.id), own: me ? evt.matches.filter((m) => pickable(m) && sideOf(evt, me.mk, m)).map((m) => m.id) : [], pts: (() => { const o = {}; evt.matches.forEach((m) => { if (pickable(m)) o[m.id] = pickPoints(evt, m); }); return o; })(),
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
  let r = null; if (rating !== '' && rating != null) { r = Number(rating); if (!(Number.isFinite(r) && r >= 0 && r <= 9999)) throw bad(400, 'Rating: a number from 0 to 9999 (e.g. 3.5 skill level)'); r = Math.round(r * 1000) / 1000; }
  const pl = []; for (let i = 0; i < size; i++) pl.push(Object.assign({ gid: 'g' + rnd(8), ct: rnd(10), name: typed[i] || (i ? 'Partner ' + (i + 1) : nm), pid: null }, typed[i] || !i ? {} : { blank: true })); // blank = an unnamed partner spot anyone with the link may take (review fix 2); named seats need their claim code
  const e = { eid: newEid(evt), name: nm, rating: r, players: pl, at: now, by }; evt.entrants.push(e); return e;
}
// One way into an event as a player or a spectator: the `join` route (invite code) and the `gjoin` route (from the event's group) both end here.
async function joinEvent(id, u, b) {
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
  await regStats(evt); const ev3 = (await acceptOwn(evt, u.e)) || evt; return { evt: ev3, cap }; // the join tap is the player's own: he accepts his seat (stats v1.5)
}
const previewOf = (evt, now, cap) => Object.assign(pub(evt, now), { role: 'none', cap, open: !evt.join.self ? [] : evt.entrants.filter((e) => (e.players || []).some(isBlank)).map((e, i) => ({ eid: e.eid, name: pidsOf(e).length ? e.name : 'Open spot ' + (i + 1), open: (e.players || []).filter(isBlank).length, seats: (e.players || []).filter(isBlank).map((p) => ({ gid: p.gid, name: 'Partner spot' })) })) });
// ---------- an event that belongs to a group ----------
// Who is in a group: the Groups engine's own memberCheck when it is in the build, else the group's row (same member key as Groups). Unreadable = not a member.
async function groupRole(groupId, accountId) {
  try { const gid = String(groupId || ''); if (!/^[\w:-]{1,40}$/.test(gid) || !accountId) return null; const G = D.groups();
    if (G && typeof G.memberCheck === 'function') { const r = await G.memberCheck(gid, accountId); return r && r.member ? (r.comm ? 'comm' : 'member') : null; }
    const mk = crypto.createHash('sha256').update('oddable-group|' + accountId).digest('hex').slice(0, 24), r1 = await D.S.dbGet('lock:grp:' + gid), g = r1 && r1.data; if (!g || g.deleted) return null; return g.comm === mk ? 'comm' : (g.members || []).some((m) => m.mk === mk) ? 'member' : null;
  } catch (e) { return null; }
}
async function needGroup(evt, u) { if (memberOf(evt, u.mk)) return; if (!(await groupRole(evt.group.gid, u.e))) throw Object.assign(bad(403, 'Join the group first: this event is for its members.'), { code: 'group' }); }
// Owner's Activity in My Apps (main's events.js, type pickleball_start), sent once per event after it is saved and answered, like golfday.js golf_start.
function actStarted(evt, gid, accountId) { setImmediate(async () => { try { const A = D.activity(); if (!A || typeof A.pickleballStarted !== 'function') return; let gname = ''; try { const G = D.groups(), m = G ? await G.memberCheck(gid, accountId) : null; gname = (m && m.group) || ''; } catch (x) {}
  A.pickleballStarted({ id: gid, name: gname }, evt.title, { account: accountId, key: 'pickleball_start|' + gid + '|' + evt.id, detail: (gname ? 'Group: ' + gname + '. ' : '') + (FMTN[evt.fmt] || '') + '. ' + (SPORTS.includes(evt.sport) ? evt.sport : 'game') }); } catch (x) { console.error('levents activity:', x.message); } }); }
// MAIN-LINE GATE (same order as golfday.js): switch off -> 403 off, nothing read; not on for this account (Groups owner-only test) -> 403 off; an ended
// account -> 403 expired. Then the engine (handleOn). LOCALEVENTS_ENABLED is read on every call: unset = off for everybody, the owner too.
const LEV_ON = () => process.env.LOCALEVENTS_ENABLED === '1';
const LEV_OFF = 'Pickleball & local games are not open for this account yet.', LEV_LAPSED = 'Your time has ended. Pay to use Groups again.';
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (path !== '/levents' && !path.startsWith('/levents/')) return false;
  let e = null; try { e = D.acct().who(req) || null; } catch (x) { e = null; }
  const G = D.gate(); let on = false; try { on = LEV_ON() && !!G && typeof G.onFor === 'function' && !!G.onFor(e); } catch (x) { on = false; }
  if (!on) { req.resume(); send(res, 403, { error: LEV_OFF, off: true }); return true; }
  if (e) { let lapsed = false; try { const A = D.acct(); lapsed = typeof A.expired === 'function' ? !!(await A.expired(e)) : false; } catch (x) { lapsed = false; } if (lapsed) { req.resume(); send(res, 403, { error: LEV_LAPSED, expired: true }); return true; } }
  return handleOn(req, res);
}
async function handleOn(req, res) {
  const path = req.url.split('?')[0]; if (path !== '/levents' && !path.startsWith('/levents/')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  try {
    const b = await body(req), ip = D.ip(req), op = path.slice(9);
    if (op === 'peek') { // PUBLIC: a shared link shows only the event's title and kind before sign-up
      const dev = devOf(b), kd = 'ec|d|' + ip + '|' + dev, code = normCode(b.code); rate('peek', null, ip); if (dev !== '-' && limit('peek|d|' + ip + '|' + dev + '|' + code, PEEK_DEV[0], PEEK_DEV[1])) throw bad(429, 'Too many tries. Wait a few minutes.'); // an app version that sends no device id is held by the IP limits only
      if ((dev !== '-' && codeBlocked(kd)) || codeBlocked('ec|i|' + ip, WRONG_IP)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.');
      const id = code ? await byCode(code) : null, evt = id ? (await load(id) || {}).data : null;
      if (!evt) { if (dev !== '-') codeFail(kd); codeFail('ec|i|' + ip); throw bad(404, 'No event with that code'); }
      send(res, 200, { title: evt.title, kind: FMTN[evt.fmt] + ' · ' + evt.sport }); return true;
    }
    const u = await me(req), now = D.now();
    // MAIN PORT: one group's events for that group's members (the group's Games card and its list). Members only (groups.memberCheck); a non-member gets 403.
    if (op === 'glist') {
      rate('glist', u.mk, ip); const gid = String(b.groupId || ''); if (!/^[\w:-]{1,40}$/.test(gid)) throw bad(404, 'Group not found');
      const role = await groupRole(gid, u.e); if (!role) throw Object.assign(bad(403, 'Pickleball & local games are for members of this group.'), { code: 'group' });
      const ix = await D.S.dbGet(IDX), ev = (ix && ix.data && ix.data.ev) || {}, out = [];
      for (const id of Object.keys(ev)) { if (ev[id].g !== gid) continue; const r = await load(id); if (!r || !r.data.group || r.data.group.gid !== gid) continue; const evt = r.data; tick(evt, now); const o = pub(evt, now), m = memberOf(evt, u.mk); o.role = isComm(evt, u.mk) ? 'comm' : m ? m.role : 'none'; const mp = m && evt.places ? evt.entrants.filter((e) => pidsOf(e).includes(m.pid)).map((e) => evt.places[e.eid]).filter(Boolean)[0] : null; o.myPlace = mp || null; o.todo = m ? evt.matches.filter((x) => canConfirm(evt, u.mk, x).ok || (x.state === 'ready' && canScore(evt, u.mk, x, now).ok && sideOf(evt, u.mk, x))).length : 0; out.push(o); if (out.length >= 40) break; }
      out.sort((a, c) => (a.fin ? 1 : 0) - (c.fin ? 1 : 0) || a.start - c.start); send(res, 200, { events: out, comm: role === 'comm', now }); return true;
    }
    if (op === 'mine') {
      const ix = await D.S.dbGet(IDX), ev = (ix && ix.data && ix.data.ev) || {}, out = [];
      for (const id of Object.keys(ev)) { if (!(ev[id].mk || []).includes(u.mk)) continue; const r = await load(id); if (!r) continue; const evt = r.data; tick(evt, now); const o = pub(evt, now), m = memberOf(evt, u.mk); o.role = isComm(evt, u.mk) ? 'comm' : m ? m.role : 'none'; const mp = m && evt.places ? evt.entrants.filter((e) => pidsOf(e).includes(m.pid)).map((e) => evt.places[e.eid]).filter(Boolean)[0] : null; o.myPlace = mp || null; o.todo = evt.matches.filter((x) => canConfirm(evt, u.mk, x).ok || (x.state === 'ready' && canScore(evt, u.mk, x, now).ok && sideOf(evt, u.mk, x))).length; out.push(o); if (out.length >= 40) break; }
      out.sort((a, c) => (a.fin ? 1 : 0) - (c.fin ? 1 : 0) || a.start - c.start); send(res, 200, { events: out, now }); return true;
    }
    if (op === 'create') {
      rate('create', u.mk, ip); if ((b.groupId == null || b.groupId === '') && D.groupOnly()) throw Object.assign(bad(400, 'Start a game from your group: Groups, your group, Games, Pickleball & local games.'), { code: 'group' }); const R = cleanRules(b, now), cap = await capFor(u.e, ''), isEnt = await entFor(u.e);
      // Created from a group hub (OddJoin.openGame('events', '', {groupId, create: true})): only that group's commissioner, checked BEFORE anything is saved.
      const forGroup = b.groupId != null && b.groupId !== '' ? String(b.groupId) : ''; if (forGroup) { if (!/^[\w:-]{1,40}$/.test(forGroup)) throw bad(400, 'Which group?'); if ((await groupRole(forGroup, u.e)) !== 'comm') throw Object.assign(bad(403, "Only the group's commissioner can add a game to the group."), { code: 'groupcomm' });
        const G0 = D.groups(); if (G0 && typeof G0.canAttach === 'function' && !(await G0.canAttach(forGroup, u.e))) throw Object.assign(bad(403, 'This group cannot take the game. Nothing was created.'), { code: 'groupcomm' }); } // L1 (fourth review): Groups is asked BEFORE anything is saved
      const nm = cleanName(b.myName, 24) || 'Organizer'; let id; do { id = rnd(10); } while (await D.S.dbGet(ROW(id)));
      const evt = Object.assign({ id, code: newCode(), comm: u.mk, ce: u.e, created: now, u: now, members: [], entrants: [], matches: [], picks: {}, audit: [], ops: [] }, R);
      evt.members.push({ pid: newPid(evt), mk: u.mk, ak: u.e, name: nm, role: 'comm', joined: now, paid: false });
      const list = Array.isArray(b.entrants) ? b.entrants.slice(0, cap) : []; list.forEach((x) => addEntrant(evt, x && x.name, x && x.rating, u.mk, now));
      if (b.playIn) { const e = addEntrant(evt, b.entryName || nm, b.myRating, u.mk, now); e.players[0].pid = evt.members[0].pid; e.players[0].name = nm; }
      if (people(evt) > cap) throw bad(403, fullMsg(cap));
      ENTF.set(id, isEnt); if (isEnt) evt.isEnt = now; if (isEnt && usesOdd(evt) && !NEWM()) { try { await D.rt().eventSetup(u.e, id, { title: evt.title, sport: rtSport(evt), lockAt: evt.start }); } catch (x) { if (!x.status) console.error('events eventSetup:', x.message); } } // E-H: register the Enterprise tournament with the rating module
      await prepRatings(evt); audit(evt, now, nm, 'create', null, 'Event created'); tick(evt, now);
      await D.S.dbPut({ id: ROW(id), salt: 'x', pinhash: 'x', data: evt, updated: now }, true); await idxSet(id, () => idxEntry(evt));
      let ev2 = evt; if (forGroup) { try { const G = D.groups(); let at = null; if (G && typeof G.attachGame === 'function') at = await G.attachGame(forGroup, u.e, { type: 'event', ref: id, name: evt.title, pot: evt.money.pot }); /* Groups lists it as a contest and, when it is wired (groups.wire), calls attachToGroup back */ await attachToGroup(id, forGroup, (at && at.cid) || ''); ev2 = (await load(id)).data; }
        catch (x) { // L1 (fourth review): Groups refused (or failed): the event is taken back, so no stand-alone event is left behind. Nothing was created.
          try { await mutate(id, (e2, t2) => { e2.deleted = t2; e2.code = ''; return e2; }); await idxSet(id, () => null); } catch (y) { console.error('events group attach rollback:', y.message); }
          if (!x.status) console.error('events group attach:', x.message); throw Object.assign(bad(x.status >= 400 && x.status < 500 ? x.status : 409, (x.status ? x.message : 'The game could not be added to the group.') + ' Nothing was created.'), { code: 'group' }); } }
      await regStats(ev2); ev2 = (await acceptOwn(ev2, u.e)) || ev2; send(res, 200, { event: full(ev2, u.mk, now, cap) }); if (forGroup) actStarted(ev2, forGroup, u.e); return true;
    }
    if (op === 'preview' || op === 'join') {
      if (codeBlocked('ec|a|' + u.mk) || codeBlocked('ec|i|' + ip, WRONG_IP)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.');
      rate('join', u.mk, ip); const code = normCode(b.code), id = code ? await byCode(code) : null;
      if (!id) { codeFail('ec|a|' + u.mk); codeFail('ec|i|' + ip); throw bad(404, 'No event with that code'); }
      if (op === 'preview') { const r = await load(id); if (!r) throw bad(404, 'No event with that code'); const evt = r.data; tick(evt, now); const cap = await capOf(evt); const o = memberOf(evt, u.mk) ? full(evt, u.mk, now, cap) : previewOf(evt, now, cap); if (evt.group && o.role === 'none') o.groupOnly = !(await groupRole(evt.group.gid, u.e)); send(res, 200, { event: o }); return true; }
      const r0 = await load(id); if (r0 && r0.data.group) await needGroup(r0.data, u); // an event that belongs to a group is for that group's members, also by code
      const { evt, cap } = await joinEvent(id, u, b); await idxSet(id, () => idxEntry(evt)); send(res, 200, { event: full(evt, u.mk, now, cap) }); return true;
    }
    // JOIN FROM THE GROUP (integration, Nov 16 2026; like /calcutta/gjoin): an event that is on a group is opened and joined by ANY MEMBER OF THAT GROUP with
    // the event's id (the group hub has it; no invite code needed). { preview: true } = look first. Everybody else: 403 code 'group'. The people cap holds.
    if (op === 'gjoin') {
      rate('join', u.mk, ip); const gid = String(b.id || ''), r0 = await load(gid); if (!r0 || !r0.data.group) throw bad(404, 'Event not found'); await needGroup(r0.data, u);
      if (b.preview) { const evt = r0.data; tick(evt, now); const cap = await capOf(evt); send(res, 200, { event: memberOf(evt, u.mk) ? full(evt, u.mk, now, cap) : previewOf(evt, now, cap) }); return true; }
      const { evt, cap } = await joinEvent(gid, u, b); await idxSet(gid, () => idxEntry(evt)); send(res, 200, { event: full(evt, u.mk, now, cap) }); return true;
    }
    if (op === 'claim') { // a guest typed in by name claims their seat (and every result it has) into this account: code + the guest's claim token
      if (codeBlocked('ec|a|' + u.mk) || codeBlocked('ec|i|' + ip, WRONG_IP)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.'); rate('join', u.mk, ip);
      const parts = String(b.claim || '').toUpperCase().split('.'), code = normCode(parts[0]), ct = String(parts[1] || '').replace(/[^A-Z0-9]/g, ''), eid0 = code && ct.length === 10 ? await byCode(code) : null;
      if (!eid0) { codeFail('ec|a|' + u.mk); codeFail('ec|i|' + ip); throw bad(404, 'That claim code does not match'); }
      const nm = cleanName(b.myName, 24) || 'Player', rg = await load(eid0); if (rg && rg.data.group) await needGroup(rg.data, u);
      const evt = await mutate(eid0, (evt, now) => { let seat = null, ent = null; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (!p.pid && p.ct && sameCode(p.ct, ct)) { seat = p; ent = e; } }));
        if (!seat) { codeFail('ec|a|' + u.mk); codeFail('ec|i|' + ip); throw bad(404, 'That claim code does not match (or was already used)'); }
        let m = memberOf(evt, u.mk); if (m && pidsOf(ent).includes(m.pid)) throw bad(409, 'You are already in ' + ent.name);
        const mine = m && evt.entrants.find((e) => pidsOf(e).includes(m.pid)); if (mine) throw bad(409, 'You already have an entry in this event (' + mine.name + '). One account, one entry: a claim code cannot add a second.');
        if (!m) { m = { pid: newPid(evt), mk: u.mk, ak: u.e, name: nm, role: 'player', joined: now, paid: false }; evt.members.push(m); restorePicks(evt, m); } else if (m.role === 'spectator') m.role = 'player';
        seat.orig = seat.orig || seat.name; seat.pid = m.pid; seat.claimed = now; if (seat.paid) m.paid = true; delete seat.paid; /* the "paid" mark moves to the account (one mark per player: L1, no stale copy on the seat) */ audit(evt, now, m.name, 'claim', null, 'Claimed the guest seat "' + seat.name + '" in ' + ent.name);
        // Third review M3: taking a seat makes this account a player in that entry's matches. Its picks on those matches are voided (kept as a record, never scored) and it cannot pick them from now on (sideOf).
        const vd = voidOwnPicks(evt, m, ent, now); if (vd.length) { const txt = m.name + ' took the seat "' + seat.orig + '" in ' + ent.name + ', so ' + (vd.length > 1 ? 'their ' + vd.length + ' picks on their own matches were' : 'their pick on their own match was') + ' voided (' + vd.map((x) => nameOf(evt, x.a) + ' v ' + nameOf(evt, x.b)).join('; ').slice(0, 300) + '). Players cannot pick matches they play in.'; audit(evt, now, 'Oddable', 'pickvoid', null, txt); notify(evt, now, 'Oddable', txt); }
        return evt; });
      await regStats(evt); const ev3 = (await acceptOwn(evt, u.e)) || evt; await idxSet(eid0, () => idxEntry(ev3)); send(res, 200, { event: full(ev3, u.mk, now, await capOf(ev3)) }); return true;
    }
    const id = String(b.id || ''); const r0 = await load(id); if (!r0) throw bad(404, 'Event not found');
    const known = memberOf(r0.data, u.mk); if (!known && op === 'leave' && D.now() - (GONE.get(id + '|' + u.mk) || 0) < 120e3) { send(res, 200, { ok: true }); return true; } // L9: the same Leave tap arriving twice
    if (!known) throw bad(404, 'Event not found'); // private: members only (non-members use the invite code)
    const cap = await capOf(r0.data), isEnt = !!ENTF.get(id);
    if (op === 'get') {
      if (op === 'get' && b.since && Number(b.since) === Number(r0.data.u) && !(r0.data.start <= now && !r0.data.drawn) && !r0.data.matches.some((m) => m.exp && now > m.exp && m.state === 'ready') && !(r0.data.endDay && !r0.data.fin && now > chiEnd(r0.data.endDay)) && !Object.values(r0.data.plock || {}).some((p) => p.at && now >= p.at && now - p.at < 90e3) && !(r0.data.fmt === 'rr' && !r0.data.fin && r0.data.drawn && rrAuto(r0.data, now))) { send(res, 200, { same: true, u: r0.data.u }); return true; } // cheap poll (review fix 10c: not after the last day)
      const evt = await mutate(id, (evt) => ({ nochange: true, v: evt })) || r0.data; send(res, 200, { event: full(evt, u.mk, now, cap) }); return true;
    }
    const ok = (evt) => { send(res, 200, { event: full(evt, u.mk, D.now(), cap) }); return true; };
    const comm = (evt) => { if (!isComm(evt, u.mk)) throw bad(403, 'Only the commissioner can do that'); };
    const notLocked = (evt, now) => { if (now >= evt.start || evt.drawn) throw bad(409, 'Rules are final. The event has started.'); };
    if (op === 'edit') { const evt = await mutate(id, (evt, now) => { comm(evt); notLocked(evt, now); const R = cleanRules(b, now), nx = Object.assign({}, evt, R), mch = fieldDiff(moneyFields(evt), moneyFields(nx)), och = fieldDiff(otherFields(evt), otherFields(nx)), others = moneyLocked(evt), by = (memberOf(evt, u.mk) || {}).name || 'Commissioner';
        if (others && mch.length) throw bad(409, 'Money rules are final once anyone else has joined or a player has been marked paid: entry, take, payout split, pot and format cannot change. Refused: ' + mch.map((c) => c.k + ' stays ' + c.a + ' (not ' + c.b + ')').join('; ') + '. Other details can still change before the start, and everyone is told.');
        if (evt.entrants.length && (UNITS[R.rules.unit] || 1) !== (UNITS[evt.rules.unit] || 1) && R.fmt !== 'solo') throw bad(409, 'Singles, doubles or teams cannot change while there are entries. Remove the entries first.');
        if (!mch.length && !och.length) return { nochange: true, v: evt };
        const feeChanged = Number(evt.money.entry) !== Number(R.money.entry), hadPaid = evt.members.some((m) => m.paid) || evt.entrants.some((e) => (e.players || []).some((p) => p.paid)); Object.assign(evt, R); if (people(evt) > cap) throw bad(403, fullMsg(cap));
        mch.concat(och).forEach((c) => audit(evt, now, by + ' (commissioner)', 'edit', null, 'Rules changed. ' + c.k + ': ' + c.a + ' → ' + c.b));
        if (feeChanged && hadPaid) { evt.members.forEach((m) => { m.paid = false; }); evt.entrants.forEach((e) => (e.players || []).forEach((p) => { delete p.paid; })); audit(evt, now, 'Oddable', 'paid', null, 'The entry changed, so every "paid" mark was cleared'); }
        if (others && och.length) notify(evt, now, by, 'The commissioner changed the rules. ' + och.map((c) => c.k + ': ' + c.a + ' → ' + c.b).join('; ') + '. Money rules (entry, take, payout split, pot, format) did not change: they are final.');
        else if (mch.length) notify(evt, now, by, 'The commissioner changed the money rules before anyone joined. ' + mch.concat(och).map((c) => c.k + ': ' + c.a + ' → ' + c.b).join('; ') + '. They become final when anyone else joins or a player is marked paid.'); // M1: an allowed money change is always announced with its old and new values
        return evt; }); if (isEnt && usesOdd(evt) && !NEWM()) { try { await D.rt().eventSetup(u.e, id, { title: evt.title, sport: rtSport(evt), lockAt: evt.start }); } catch (x) {} } await regStats(evt); await idxSet(id, () => idxEntry(evt)); return ok(evt); }
    if (op === 'entrant') { // commissioner adds / renames / re-rates / removes / moves an entry, before the draw
      const evt = await mutate(id, (evt, now) => { comm(evt);
        // At the start a pair with an empty partner spot holds the draw: until it is made the commissioner may only name the missing partner or remove that entry.
        const fixing = holdFix(evt, now); if (!fixing) notLocked(evt, now); else if (!((b.do === 'partner' || b.do === 'remove') && needPartner(evt).some((e) => e.eid === String(b.eid)))) throw bad(409, 'Rules are final. Only an entry with an empty partner spot can be completed or removed now.');
        if (b.do === 'partner') { const e = evt.entrants.find((x) => x.eid === String(b.eid)), seat = e && (e.players || []).find(isBlank); if (!e) throw bad(404, 'That entry is gone'); if (!seat) throw bad(409, e.name + ' has no empty spot'); const nm = cleanName(b.name, 24); if (nm.length < 1) throw bad(400, "Type the partner's name"); if (/^(Partner \d|Open seat)$/.test(nm)) throw bad(400, 'Type a real name');
          const first = e.players[0].name; seat.name = nm; delete seat.blank; seat.ct = rnd(10); if (e.name === first) e.name = cleanName(e.players.filter((p) => !isBlank(p)).map((p) => p.name).join(' / '), 40) || e.name; audit(evt, now, 'Commissioner', 'entries', null, 'Partner added: ' + nm + ' with ' + first); return evt; }
        if (b.do === 'add') { addEntrant(evt, b.name, b.rating, u.mk, now); if (people(evt) > cap) throw bad(403, fullMsg(cap)); }
        else { const e = evt.entrants.find((x) => x.eid === String(b.eid)); if (!e) throw bad(404, 'That entry is gone');
          if (b.do === 'remove') evt.entrants = evt.entrants.filter((x) => x !== e);
          else if (b.do === 'edit') { const nm = cleanName(b.name, 40); if (nm) e.name = nm; if (b.rating !== undefined) { const r = b.rating === '' || b.rating == null ? null : Number(b.rating); if (r !== null && !(Number.isFinite(r) && r >= 0 && r <= 9999)) throw bad(400, 'Rating: 0 to 9999'); e.rating = r === null ? null : Math.round(r * 1000) / 1000; } }
          else if (b.do === 'up' || b.do === 'down') { const i = evt.entrants.indexOf(e), j = i + (b.do === 'up' ? -1 : 1); if (j >= 0 && j < evt.entrants.length) [evt.entrants[i], evt.entrants[j]] = [evt.entrants[j], evt.entrants[i]]; }
          else throw bad(400, 'Unknown change'); }
        audit(evt, now, 'Commissioner', 'entries', null, 'Entries changed (' + evt.entrants.length + ')'); return evt; });
      await regStats(evt); return ok(evt);
    }
    // Playbook (play 40) + manager, Nov 16 2026: a money event is not seeded by the Oddable rating alone. The organizer sees every player's rating with
    // "x of y games confirmed" and may set the seeds by hand before the start: POST /events/seeds {id, eid, do: 'up' | 'down'} or {id, eid, to: <seed>} or {id, clear: true}.
    if (op === 'seeds') { const evt = await mutate(id, (evt, now) => { comm(evt); notLocked(evt, now); if (evt.fmt === 'solo') throw bad(409, 'A solo event has no seeds'); if (evt.rules.seeding === 'random') throw bad(409, 'This event is drawn at random. Choose another seeding rule to set seeds by hand.');
        const by = ((memberOf(evt, u.mk) || {}).name || 'Commissioner') + ' (commissioner)';
        if (b.keep) { if (evt.seedSet) return { nochange: true, v: evt }; evt.seedSet = seedList(evt); audit(evt, now, by, 'seeds', null, 'Seeds confirmed by the organizer as shown: ' + evt.seedSet.map((x, i) => (i + 1) + '. ' + nameOf(evt, x)).join(', ')); return evt; } // "these are my seeds": the order shown becomes the organizer's own
        if (b.clear) { if (!evt.seedSet) return { nochange: true, v: evt }; delete evt.seedSet; audit(evt, now, by, 'seeds', null, 'Seeds set by hand were removed: seeded ' + seedHow(evt) + ' again'); return evt; }
        const cur = seedList(evt), eid = String(b.eid || ''), i = cur.indexOf(eid); if (i < 0) throw bad(404, 'That entry is gone'); const j = b.to != null ? Math.round(Number(b.to)) - 1 : i + (b.do === 'up' ? -1 : b.do === 'down' ? 1 : NaN); if (!(j >= 0 && j < cur.length)) throw bad(400, 'Seed: 1 to ' + cur.length); if (j === i) return { nochange: true, v: evt };
        cur.splice(i, 1); cur.splice(j, 0, eid); evt.seedSet = cur; audit(evt, now, by, 'seeds', null, 'Seed set by the organizer: ' + nameOf(evt, eid) + ' from ' + ord(i + 1) + ' to ' + ord(j + 1) + ' seed'); return evt; }); return ok(evt); }
    if (op === 'draw') { // an early draw locks the tournament ratings in the rating module too, but ONLY once the draw has really been made (a refused draw locks nothing)
      const early = !r0.data.drawn && now < r0.data.start; let stRef = null; if (early && needApprove(r0.data) && isComm(r0.data, u.mk)) { try { await ST.start(r0.data); STARTED.add(id); } catch (x) { stRef = x.status ? x.message : 'stats did not answer'; } }
      const evt = await mutate(id, (evt, now) => { comm(evt); if (stRef && !evt.drawn) audit(evt, now, 'Oddable', 'seeds', null, 'The ratings were not made final at this early draw (' + cleanName(stRef, 110) + '); the numbers in force now are used.'); if (evt.drawn) return { nochange: true, v: evt }; draw(evt, now); return evt; });
      if (early && evt.drawn && isEnt && usesOdd(evt) && !NEWM()) { try { await D.rt().eventSetup(u.e, id, { title: evt.title, sport: rtSport(evt), lockAt: evt.drawn }); } catch (x) { if (!x.status) console.error('events eventSetup (draw):', x.message); } }
      return ok(evt); }
    if (op === 'leave') { const evt = await mutate(id, (evt, now) => { const m = memberOf(evt, u.mk); if (!m) return { nochange: true, v: evt }; /* L9: the same tap sent twice: already gone */ if (isComm(evt, u.mk)) throw bad(409, 'The commissioner cannot leave. Delete the event instead (before it starts).'); const inE = evt.entrants.some((e) => pidsOf(e).includes(m.pid)); if (inE && (now >= evt.start || evt.drawn)) throw bad(409, 'The event has started. Players stay to the end.'); evt.entrants.forEach((e) => (e.players || []).forEach((p, i) => { if (p.pid === m.pid) { p.pid = null; p.name = p.orig || (p.blank ? 'Partner ' + (i + 1) : 'Open seat'); p.ct = rnd(10); if (p.orig && m.paid) p.paid = true; else delete p.paid; /* L1: the typed-in seat is "paid" only if the account leaving it is marked paid right now */ delete p.claimed; delete p.orig; } })); /* review fix 9: the guest gets its name back and a NEW claim code */ evt.entrants = evt.entrants.filter((e) => !(e.by === u.mk && !pidsOf(e).length && !isComm(evt, e.by))); evt.members = evt.members.filter((x) => x !== m); if (evt.picks[m.pid]) { evt.pk = evt.pk || {}; evt.pk[m.mk] = evt.picks[m.pid]; delete evt.picks[m.pid]; } /* G16: picks belong to the account; rejoining brings them back, still locked */ return evt; }); await regStats(evt); GONE.set(id + '|' + u.mk, D.now()); if (GONE.size > 5000) GONE.clear(); await idxSet(id, () => idxEntry(evt)); send(res, 200, { ok: true }); return true; }
    if (op === 'delete') { await mutate(id, (evt, now) => { comm(evt); notLocked(evt, now); evt.deleted = now; evt.code = ''; return evt; }); await idxSet(id, () => null); send(res, 200, { ok: true }); return true; }
    if (op === 'paid') { const evt = await mutate(id, (evt, now) => { comm(evt);
      if (b.gid) { let seat = null; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (p.gid === String(b.gid) && !p.pid && !isBlank(p)) seat = p; })); if (!seat) throw bad(404, 'That typed-in player is not in the event'); if (!!seat.paid === !!b.paid) return { nochange: true, v: evt }; seat.paid = !!b.paid; audit(evt, now, 'Commissioner', 'paid', null, seat.name + ' (typed-in player)' + (seat.paid ? ' marked paid' : ' marked not paid')); return evt; }
      const m = evt.members.find((x) => x.pid === String(b.pid || '')); if (!m) throw bad(404, 'Not in the event'); if (b.paid && !evt.entrants.some((e) => pidsOf(e).includes(m.pid))) throw bad(409, m.name + ' is not playing, so no entry is owed'); if (!!m.paid === !!b.paid) return { nochange: true, v: evt }; m.paid = !!b.paid; audit(evt, now, 'Commissioner', 'paid', null, m.name + (m.paid ? ' marked paid' : ' marked not paid')); return evt; }); return ok(evt); }
    if (op === 'seatok') { const e0 = r0.data; if (!needApprove(e0)) throw bad(409, 'Nothing to confirm in this event'); if (D.now() >= e0.start || e0.drawn) throw bad(409, 'The event has started'); const ev3 = await acceptOwn(e0, u.e); if (!ev3) throw bad(409, 'Could not accept right now. Try again.'); return ok(ev3); } // stats v1.5: the caller accepts his own seat / co-organizer role
    if (op === 'coorg') { // the organizer names (or un-names) a co-organizer, before the start
      const evt = await mutate(id, (evt, now) => { comm(evt); notLocked(evt, now); const m = evt.members.find((x) => x.pid === String(b.pid || '')); if (!m) throw bad(404, 'Not in the event'); if (m.mk === evt.comm) throw bad(409, 'You are the organizer already');
        const on = !!b.on; if (!!m.co === on) return { nochange: true, v: evt }; const P = evt.picks && evt.picks[m.pid]; if (on && P && (Object.keys(P.m || {}).length || P.tb != null)) throw bad(409, m.name + " has made pick'em picks. Co-organizers cannot pick, so choose someone else.");
        if (on) m.co = now; else delete m.co; delete m.coAcc; const by = (memberOf(evt, u.mk) || {}).name || 'Commissioner'; audit(evt, now, by + ' (commissioner)', 'coorg', null, m.name + (on ? ' is now a co-organizer (approves ratings, co-signs, sets pick\'em closing times; cannot pick)' : ' is no longer a co-organizer')); notify(evt, now, by, m.name + (on ? ' is now a co-organizer of this event.' : ' is no longer a co-organizer of this event.')); return evt; });
      await regStats(evt); return ok(evt); }
    if (op === 'finish') { const evt = await mutate(id, (evt, now) => { comm(evt); if (evt.fmt === 'se' || evt.fmt === 'de') throw bad(409, 'A bracket finishes when its last match is confirmed'); if (now < evt.start && !evt.drawn) throw bad(409, 'Not started yet');
      if (evt.fmt === 'rr' && !places(evt, now)) throw bad(409, openTies(evt).length ? 'A tie for a prize or a playoff spot is still open. Settle it first (Standings).' : evt.poHold ? 'The playoff was reset. Redraw it first (Standings).' : 'Every match needs a confirmed score before the round robin can finish.'); if (evt.done) return { nochange: true, v: evt }; evt.done = now; audit(evt, now, 'Commissioner', 'finish', null, 'Event finished'); tick(evt, now); return evt; }); await idxSet(id, () => idxEntry(evt)); return ok(evt); }
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
    // ---- H2 (fourth review, stats contract v1.4): the organizer's approval screen, set values and the co-sign of his own number ----
    const apGuard = (e0) => { if (!needApprove(e0)) throw bad(409, 'Only money events and Enterprise tournaments have ratings to approve'); if (!isOrg(e0, u.mk)) throw bad(403, 'Only the organizer or a co-organizer can do that'); };
    const apOpen = (e0) => { if (D.now() >= e0.start || e0.drawn) throw bad(409, 'Ratings are final. The event has started.'); };
    const seatBy = (e0, gid) => { let seat = null, ent = null; e0.entrants.forEach((e) => (e.players || []).forEach((p) => { if (p.gid === String(gid || '') && !isBlank(p)) { seat = p; ent = e; } })); if (!seat) throw bad(404, 'That player is not in the event'); return { seat, ent, key: seatKey(e0, seat) }; };
    const rtErr = (x, what) => Object.assign(bad(x.status || 503, x.status ? x.message : 'Could not ' + what + ' right now. Try again.'), { code: x.status === 403 && /own number/.test(x.message) ? 'cosign' : undefined });
    const apMirror = async (e0, line, who) => { RC.clear(); let log = null; try { log = ((await ST.log(e0)) || {}).log || []; } catch (x) { log = null; }
      return mutate(id, (evt, now) => { if (log) evt.tlog = log.filter((x) => x && x.player && (x.field == null || x.field === 'rating')).slice(-100).map((x) => ({ at: x.at, by: x.by && !/^(Tournament director|Organizer)$/.test(x.by) ? cleanName(x.by, 30) : (evt.members.find((m) => m.mk === evt.comm) || {}).name || 'Organizer', cosign: cleanName(x.cosign, 30) || undefined, kind: x.kind === 'approve' ? 'approve' : 'set', player: x.player, old: x.old == null ? null : x.old, new: x.new == null ? null : x.new, oddable: x.oddable == null ? null : x.oddable, reason: x.reason || '' }));
        if (typeof line === 'function') line = line(evt); if (line) audit(evt, now, who || myName(evt) + (isComm(evt, u.mk) ? ' (organizer)' : ' (co-organizer)'), 'rating', null, line); return evt; }); };
    if (op === 'review') { // read-only: one row per player now in the event (stats.eventReview is the role check; the rows come from ratingFor with the event id)
      const e0 = r0.data; apGuard(e0); await regStats(e0); try { await ST.review(e0, u.e); } catch (x) { throw rtErr(x, 'read the ratings'); }
      const rows = []; for (const e of e0.entrants) for (const p of e.players || []) { if (isBlank(p)) continue; const key = seatKey(e0, p), m = p.pid && e0.members.find((x) => x.pid === p.pid); let r = null; try { r = await rateFor(e0, key, ST.ro(e0)); } catch (x) { r = null; } const sg = (r && r.suggested) || null;
        rows.push({ gid: p.gid, eid: e.eid, entry: e.name, name: p.name, guest: !p.pid, you: !!(m && m.mk === u.mk), oddable: r && r.oddable ? r.oddable.rating : null, games: r && r.oddable ? Number(r.oddable.matches) || 0 : 0, confirmedGames: r ? Number(r.confirmedGames) || 0 : 0, suggested: sg ? { value: sg.value == null ? null : sg.value, confirmed: !!sg.confirmed, why: cleanName(sg.why, 120) } : null, makeup: (r && r.makeup) || null, flags: r && Array.isArray(r.flags) ? r.flags.slice(0, 12).map((f) => String(f).slice(0, 160)) : [], use: r && r.use != null ? r.use : null, setBy: (r && r.setBy) || null, by: (r && r.by) || null, cosign: (r && r.cosign) || null, shown: (r && r.shown) || null }); }
      send(res, 200, { review: { id, title: e0.title, open: !(now >= e0.start || e0.drawn), ready: rows.length > 0 && rows.every((x) => x.use != null), approved: rows.filter((x) => x.use != null).length, players: rows, unconfirmed: rows.filter((x) => x.suggested && x.suggested.value != null && !x.suggested.confirmed).map((x) => x.name), cosign: e0.cs ? { name: (e0.members.find((m) => m.pid === e0.cs.pid) || {}).name || '', kind: e0.cs.kind, value: e0.cs.value } : null } }); return true; }
    if (op === 'approve') { // {all: true} = "Use everyone's Oddable rating" (stats.eventApproveAll); {gid, value} = one player, the value the screen showed
      const e0 = r0.data; apGuard(e0); apOpen(e0); await regStats(e0); const RT = D.rt(); let out, line;
      try { if (b.all) { out = await ST.approveAll(e0, u.e); line = (evt) => { const st = seatsPlaying(evt), okd = st.filter((p) => p.ap && p.ap.sb === 'approved'), not = st.filter((p) => useR(p) == null); /* the event's own names (stats names come from the accounts) */
          return "Used everyone's Oddable rating: " + (okd.map((p) => p.name + ' ' + p.use + (p.ap.sc ? '' : ' (UNCONFIRMED)')).join(', ') || 'nobody') + (not.length ? '. Not approved yet: ' + not.map((p) => p.name + (seatKey(evt, p) === u.e ? ' (own number: needs a co-sign)' : '')).join(', ') : ''); }; }
        else { const { seat, key } = seatBy(e0, b.gid); out = await ST.approve(e0, key, b.value == null || b.value === '' ? null : Number(b.value), u.e); line = seat.name + ': Oddable rating ' + out.value + ' approved' + (out.confirmed ? '' : ' (UNCONFIRMED)'); } }
      catch (x) { throw rtErr(x, 'approve'); }
      const evt = await apMirror(e0, line); send(res, 200, { event: full(evt, u.mk, D.now(), cap), result: out }); return true; }
    if (op === 'rset' || (op === 'trate' && needApprove(r0.data))) { // the organizer SETS a player's rating for this event only, with a reason ('' clears it); the real Oddable rating stays beside it
      const e0 = r0.data; apGuard(e0); apOpen(e0); const { seat, key } = seatBy(e0, b.gid), clear = b.rating === '' || b.rating == null, v = clear ? null : Math.round(Number(b.rating));
      if (!clear && !(Number.isFinite(Number(b.rating)) && v >= 100 && v <= 3500)) throw bad(400, 'Rating: a whole number from 100 to 3500 (Oddable scale: new players start at 1500)'); const reason = cleanName(b.reason, 120); if (reason.length < 2) throw bad(400, 'Give a reason (it is logged and shown to the players)');
      await regStats(e0); let out; try { out = await ST.override(u.e, e0, key, { rating: v, reason, sport: ST.sport(e0), name: seat.name }); } catch (x) { throw rtErr(x, 'set the rating'); }
      const evt = await apMirror(e0, out && out.changed === false ? null : seat.name + ': ' + (entEvt(e0) ? 'tournament rating ' : 'rating for this event ') + (v == null ? 'removed (to be approved from the Oddable rating)' : 'set to ' + v) + ' · ' + reason); return ok(evt); }
    if (op === 'cosign') { // nobody approves or sets his OWN number alone (stats enforces it): the organizer asks, a co-organizer or a player on another team signs on his own phone
      const e0 = r0.data; if (!needApprove(e0)) throw bad(409, 'Only money events and Enterprise tournaments have ratings to approve'); apOpen(e0); const RT = D.rt(), me0 = memberOf(e0, u.mk);
      if (b.ask) { if (!isOrg(e0, u.mk)) throw bad(403, 'Only the organizer or a co-organizer asks for a co-sign'); let seat = null, ent = null; e0.entrants.forEach((e) => (e.players || []).forEach((p) => { if (p.pid === me0.pid) { seat = p; ent = e; } })); if (!seat) throw bad(409, 'You are not playing, so you have no rating to co-sign');
        const set = !(b.rating === undefined || b.rating === null || b.rating === ''); let value = null, reason = '';
        if (set) { value = Math.round(Number(b.rating)); if (!(Number.isFinite(Number(b.rating)) && value >= 100 && value <= 3500)) throw bad(400, 'Rating: a whole number from 100 to 3500'); reason = cleanName(b.reason, 120); if (reason.length < 2) throw bad(400, 'Give a reason (it is logged and shown to the players)'); }
        else { let r = null; try { r = await rateFor(e0, me0.ak, ST.ro(e0)); } catch (x) { r = null; } value = r && r.suggested && r.suggested.value != null ? r.suggested.value : null; if (value == null) throw bad(409, 'You have no Oddable rating yet: ask for a set rating with a reason'); }
        await regStats(e0); const evt = await mutate(id, (evt, now) => { evt.cs = { pid: me0.pid, gid: seat.gid, eid: ent.eid, kind: set ? 'set' : 'approve', value, reason, at: now }; const t = me0.name + ' asks for a co-sign on ' + (set ? 'a set rating of ' + value + ' for ' + me0.name + ' (' + reason + ')' : me0.name + "'s Oddable rating " + value) + ': a player on another team who confirmed his seat' + (isComm(e0, u.mk) ? '' : ', or another co-organizer,') + ' taps Co-sign on his own phone (nobody approves his own number alone).'; notify(evt, now, me0.name, t); audit(evt, now, me0.name, 'cosign', null, t); return evt; }); return ok(evt); }
      const cs = e0.cs; if (!cs) throw bad(409, 'Nothing is waiting for a co-sign');
      if (b.cancel) { if (me0.pid !== cs.pid && !isComm(e0, u.mk)) throw bad(403, 'Only the person who asked can cancel it'); const evt = await mutate(id, (evt, now) => { if (!evt.cs) return { nochange: true, v: evt }; delete evt.cs; audit(evt, now, myName(evt), 'cosign', null, 'Co-sign request withdrawn'); return evt; }); return ok(evt); }
      const req = e0.members.find((m) => m.pid === cs.pid); if (!req || !req.ak) throw bad(409, 'The person who asked has left'); if (!canCosign(e0, u.mk)) throw bad(403, 'Only a co-organizer or a player on another team can co-sign');
      let out; try { const code = await ST.cosignCode(e0, u.e, req.ak, cs.value); /* minted for the co-signer's OWN account, from his own tap; used once by the organizer's engine */ out = cs.kind === 'set' ? await ST.override(req.ak, e0, req.ak, Object.assign({ rating: cs.value, reason: cs.reason, sport: ST.sport(e0), name: req.name }, code)) : await ST.approve(e0, req.ak, cs.value, req.ak, code); } catch (x) { throw rtErr(x, 'co-sign'); }
      await mutate(id, (evt, now) => { delete evt.cs; notify(evt, now, myName(evt), req.name + "'s rating " + cs.value + (cs.kind === 'set' ? ' was set' : ' was approved') + ' by ' + req.name + ' with ' + myName(evt) + ' (co-sign).'); return evt; });
      const evt = await apMirror(e0, req.name + ': rating ' + cs.value + (cs.kind === 'set' ? ' set (' + cs.reason + ')' : ' approved') + ' by ' + req.name + ', co-signed by ' + myName(e0), myName(e0) + ' (co-sign)'); return ok(evt); }
    if (op === 'trate') { // storage, rules and the log live in the rating module (eventSetup / eventOverride / eventLog); this is the director's form's route
      const e0 = r0.data, RT = D.rt(); comm(e0); if (!isEnt) throw bad(403, 'Tournament ratings are for Enterprise events (courses, clubs and leagues). ' + limits.ENTERPRISE_TEXT); if (!usesOdd(e0)) throw bad(409, 'This event does not use the Oddable rating');
      if (now >= e0.start || e0.drawn) throw bad(409, 'Ratings are final. The event has started.');
      let seat = null; e0.entrants.forEach((e) => (e.players || []).forEach((p) => { if (p.gid === String(b.gid || '')) seat = p; })); if (!seat || isBlank(seat)) throw bad(404, 'That player is not in the event');
      const clear = b.rating === '' || b.rating == null, v = clear ? null : Math.round(Number(b.rating)); if (!clear && !(Number.isFinite(Number(b.rating)) && Number(b.rating) >= 100 && v <= 3500)) throw bad(400, 'Tournament rating: a whole number from 100 to 3500 (Oddable scale: new players start at 1500)');
      const reason = cleanName(b.reason, 120); if (reason.length < 2) throw bad(400, 'Give a reason (it is logged and shown to the players)');
      const by = myName(e0); await RT.eventSetup(u.e, id, { title: e0.title, sport: rtSport(e0), lockAt: e0.start });
      const out = await RT.eventOverride(u.e, id, seatKey(e0, seat), { rating: v, sport: rtSport(e0), reason, name: seat.name, byName: by }); RC.clear();
      const log = out && out.changed === false ? null : ((await RT.eventLog(u.e, id)) || {}).log || [];
      const evt = await mutate(id, (evt, now) => { if (!log) return { nochange: true, v: evt }; evt.tlog = log.filter((x) => x && (x.field == null || x.field === 'rating') && x.player).slice(-100).map((x) => ({ at: x.at, by: !x.by || x.by === 'Tournament director' ? by : x.by, player: x.player, old: x.old == null ? null : x.old, new: x.new == null ? null : x.new, oddable: x.oddable == null ? null : x.oddable, reason: x.reason }));
        audit(evt, now, by + ' (director)', 'rating', null, seat.name + ': tournament rating ' + (v == null ? 'removed (Oddable rating used)' : 'set to ' + v) + ' · ' + reason); return evt; });
      return ok(evt);
    }
    // The commissioner resets a playoff that has started (the only way to correct a pool / tiebreak result after that). Its results are wiped, the reason
    // is logged and every member gets a notice. The bracket is redrawn from the table when the commissioner taps Redraw (after the corrections).
    if (op === 'poreset') { const evt = await mutate(id, (evt, now) => { comm(evt); notFin(evt); if (evt.fmt !== 'rr' || !evt.poSeeds) throw bad(409, 'There is no playoff to reset'); const reason = cleanName(b.reason, 120); if (reason.length < 2) throw bad(400, 'Give a reason (everyone sees it)');
        const n = evt.matches.filter((x) => x.st === 'po' && PLAYED.has(x.state)).length, by = myName(evt); dropPlayoff(evt); evt.poHold = { at: now, by, reason };
        notify(evt, now, by, 'The commissioner reset the playoff: ' + reason + '. ' + (n ? n + ' playoff result' + (n > 1 ? 's were' : ' was') + ' wiped. ' : '') + (evt.rules.pickem ? "Pick'em picks on the playoff matches were wiped with them. " : '') + 'The bracket will be redrawn from the standings.'); audit(evt, now, by + ' (commissioner)', 'playoff', null, 'Playoff reset (' + n + ' result' + (n === 1 ? '' : 's') + ' wiped). Reason: ' + reason); return evt; }); return ok(evt); }
    if (op === 'poredraw') { const evt = await mutate(id, (evt, now) => { comm(evt); notFin(evt); if (!evt.poHold) return { nochange: true, v: evt }; if (openTies(evt).length) throw bad(409, 'A tie for a playoff spot is open. Settle it first.'); delete evt.poHold; maybePlayoff(evt, now); notify(evt, now, myName(evt), 'The playoff was redrawn from the corrected standings.'); return evt; }); return ok(evt); }
    if (op === 'tiebreak') { // round robin: a tie the rulebook order could not break. The organizer chooses a playoff match (two entries) or a coin flip; logged.
      const evt = await mutate(id, (evt, now) => { comm(evt); notFin(evt); const t = openTies(evt).find((x) => x.key === String(b.key || '')); if (!t) throw bad(409, 'That tie is already decided'); if (t.game || (evt.tb && evt.tb[t.key])) throw bad(409, 'A tiebreak playoff is already set. Enter its score.');
        const how = b.how === 'game' ? 'game' : b.how === 'coin' || b.how == null ? 'coin' : null; if (!how) throw bad(400, 'Choose a coin flip (the default) or a playoff'); /* manager, Nov 16 2026: coin flip is the default; the playoff is a house rule */ evt.tb = evt.tb || {}; const names = t.eids.map((e) => nameOf(evt, e)), by = myName(evt), why = t.x ? ' for the last ' + (t.spots > 1 ? t.spots + ' playoff spots' : 'playoff spot') + ' across pools (records level: ' + XREC + ')' : ' (level after every tiebreak step)', xf = t.x ? { x: true, spots: t.spots } : {};
        const shuffle = (a) => { const o = a.slice(); for (let i = o.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [o[i], o[j]] = [o[j], o[i]]; } return o; };
        if (how === 'game') { const ladder = shuffle(t.eids), n = ladder.length - 1; const drawn = ladder.map((e) => nameOf(evt, e)), house = n > 1 ? 'House rule (not in the rulebook): playoff, order drawn at random: ' + drawn.join(', then ') + ' (' + drawn[n] + ' plays ' + drawn[n - 1] + ' first; the winner plays the next one up)' : 'Tiebreak playoff: one match, ' + drawn.join(' v ');
          evt.tb[t.key] = Object.assign({ how, ladder, ms: [], pool: t.pool, at: now, by, house: n > 1, text: house }, xf);
          audit(evt, now, by + ' (commissioner)', 'tiebreak', null, 'Tie between ' + names.join(', ') + why + '. ' + house); tbAdvance(evt, now); }
        else { const order = shuffle(t.eids), txt = order.map((e) => nameOf(evt, e)).join(', then ');
          evt.tb[t.key] = Object.assign({ how, order, at: now, by, text: (t.x ? 'Last playoff spot across pools, coin flip: ' : 'Coin flip: ') + txt }, xf); audit(evt, now, by + ' (commissioner)', 'tiebreak', null, 'Tie between ' + names.join(', ') + why + ': the organizer chose a coin flip. Oddable flipped: ' + txt); }
        return evt; });
      await idxSet(id, () => idxEntry(evt)); return ok(evt);
    }
    // P1 (owner Nov 16 2026): "Suggest partners" for doubles / team events. Any member may look; only the commissioner applies a split, before the start.
    if (op === 'partners') {
      const evt = await mutate(id, (evt) => ({ nochange: true, v: evt })) || r0.data; const size = UNITS[evt.rules.unit] || 1; if (size < 2 || evt.fmt === 'solo') throw bad(409, 'Partner suggestions are for doubles and team events');
      const seatsAll = []; evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (!isBlank(p)) seatsAll.push(p); }));
      const players = seatsAll.map((p) => ({ id: p.gid, name: p.name, rating: Number.isFinite(p.tv) ? p.tv : Number.isFinite(p.or) ? p.or : null })) /* the module's `use`; a new player's 1500 start goes in as "no games yet" so the reason can say so */, history = await pairHistory(evt);
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
        evt.members.forEach((m) => { if (m.acc && !evt.entrants.some((e) => e.eid === m.acc && pidsOf(e).includes(m.pid))) delete m.acc; }); /* stats v1.5: a moved seat is pending again until its player accepts */
        entryRatings(evt); if (people(evt) > cap) throw bad(403, fullMsg(cap)); audit(evt, now, myName(evt), 'teams', null, 'Teams set: ' + evt.entrants.map((e) => e.name).join(' · ') + (b.mode ? ' (from "Suggest partners": ' + String(b.mode).replace(/[^a-z]/g, '') + ')' : '')); return evt; });
      await regStats(evt); return ok(evt);
    }
    const myRef = op === 'score' || op === 'confirm' ? refOf(u.e) : null; // H1: filed with stats
    const snap = op === 'score' || op === 'confirm' ? await snapRatings(r0.data, r0.data.matches.find((x) => x.id === String(b.m || ''))) : null;
    if (op === 'score') {
      rate('score', u.mk, ip); const evt = await mutate(id, (evt, now) => {
        if (opSeen(evt)) return { nochange: true, v: evt }; // offline queue resend: already saved
        notFin(evt); const m = findM(evt); vOk(m); const c = canScore(evt, u.mk, m, now); if (!c.ok) throw bad(403, c.why);
        const g = checkGames(ruleOf(evt, m), b.games); m.v++; m.live = m.live || now;
        const s0 = sideOf(evt, u.mk, m), asComm = isComm(evt, u.mk) && (!s0 || m.state === 'disputed' || !linked(evt, s0 === 'a' ? m.b : m.a)); // a commissioner playing in the match enters like any player (the opponent confirms); final only on a dispute or vs a guest
        if (asComm) { const was = m.state === 'confirmed' ? m.win : null; if (was && was !== g.win && downstreamPlayed(evt, m)) throw bad(409, 'Later matches are already played. Fix those first.'); if (m.st === 'lad' && m.state === 'confirmed') throw bad(409, 'Ladder results cannot be changed after they move the ladder'); if (was && (m.st === 'pool' || m.st === 'tb')) reflow(evt, m, was !== g.win, now); /* review fix 3 + tiebreak-playoff corrections */ Object.assign(m, { games: g.games, win: g.win, state: 'confirmed', sub: { side: 'comm', games: g.games, by: myName(evt), at: now, k: myRef }, at: now, cf: { by: 'comm', name: myName(evt), at: now, k: myRef, own: s0 || null } }); if (was && m.st === 'pool') pruneTb(evt); audit(evt, now, myName(evt) + ' (commissioner' + (s0 ? ', own match' : '') + ')', was ? 'correct' : 'final', m.id, scoreText(evt, m)); settle(evt, m, now, snap); }
        else { const s = sideOf(evt, u.mk, m); m.state = 'pending'; m.sub = { side: s, games: g.games, win: g.win, by: myName(evt), at: now, k: myRef }; audit(evt, now, myName(evt), 'score', m.id, scoreText(evt, Object.assign({}, m, { win: g.win, games: g.games })) + ' (waiting for ' + (linked(evt, s === 'a' ? m.b : m.a) ? 'the other side' : 'the commissioner') + ' to confirm)'); }
        return evt; }).catch(async (e) => { if (e && e.code === 'postarted') { try { await mutate(id, (evt, now) => { audit(evt, now, myName(evt) + ' (commissioner)', 'refused', String(b.m || ''), 'Correction refused: the playoff has started, so pool and tiebreak results are final unless the commissioner resets the playoff'); return evt; }); } catch (x) {} } throw e; });
      return ok(evt);
    }
    if (op === 'confirm' || op === 'dispute') {
      const evt = await mutate(id, (evt, now) => { if (opSeen(evt)) return { nochange: true, v: evt }; notFin(evt); const m = findM(evt); vOk(m); const c = canConfirm(evt, u.mk, m); if (!c.ok) throw bad(403, 'Only the other side (or the commissioner) can ' + op + ' this score'); m.v++;
        if (op === 'confirm') { Object.assign(m, { games: m.sub.games, win: m.sub.win, state: 'confirmed', at: now, cf: { by: c.comm ? 'comm' : 'opp', name: myName(evt), at: now, k: myRef } }); /* cf: who made it final. Only 'opp' (an account on the other side) is a confirmed, rated result */ audit(evt, now, myName(evt) + (c.comm ? ' (commissioner)' : ''), 'confirm', m.id, scoreText(evt, m)); settle(evt, m, now, snap); }
        else { if (c.comm) throw bad(400, 'Commissioner: enter the right score instead'); m.state = 'disputed'; m.sub.note = cleanName(b.note, 120); audit(evt, now, myName(evt), 'dispute', m.id, 'Disputed' + (m.sub.note ? ': ' + m.sub.note : '') + '. The commissioner decides.'); }
        return evt; });
      return ok(evt);
    }
    if (op === 'live') { const evt = await mutate(id, (evt, now) => { notFin(evt); const m = findM(evt); if (m.live || m.state !== 'ready') return { nochange: true, v: evt }; if (!isComm(evt, u.mk) && !sideOf(evt, u.mk, m)) throw bad(403, 'Only the players or the commissioner start a match'); m.live = now; m.v++; audit(evt, now, myName(evt), 'start', m.id, 'Match started (picks closed)'); return evt; }); return ok(evt); }
    if (op === 'pick') {
      rate('score', u.mk, ip); const evt = await mutate(id, (evt, now) => { if (!evt.rules.pickem) throw bad(409, 'This event has no pick\'em'); if (isOrg(evt, u.mk)) throw Object.assign(bad(403, "Organizers run the results, so they cannot make pick'em picks in their own event. You can still follow the pick'em."), { code: 'organizer' }); /* fourth review M2 */ const pm = memberOf(evt, u.mk), P = evt.picks[pm.pid] = evt.picks[pm.pid] || { m: {} };
        // Locked on entry, like group bets (G16): the server stamps a pick the moment it is made and it can never be changed or removed. The same pick sent again is fine (resend).
        let changed = false;
        if (b.tb !== undefined) { const fm = finalMatch(evt); if (fm && pickLocked(evt, fm, now)) throw bad(409, 'The final has started. The tiebreak is closed.'); const t = Number(b.tb); if (!(Number.isInteger(t) && t >= 0 && t <= 999)) throw bad(400, 'Tiebreak: total points in the final, 0 to 999'); if (P.tb != null && P.tb !== t) throw bad(409, 'Your tiebreak guess is final. It cannot be changed once made.'); if (P.tb == null) { P.tb = t; P.tbAt = now; changed = true; } }
        if (b.m) { const m = findM(evt); if (!pickable(m)) throw bad(409, 'This match is not part of the pick\'em'); if (sideOf(evt, u.mk, m)) throw bad(403, 'You are playing in this match, so you cannot pick it. Pick the other matches.'); /* manager, Nov 16 2026 */ if (pickLocked(evt, m, now)) throw bad(409, lockWhy(evt, m, now)); if (!(m.state === 'ready' && m.a && m.b)) throw bad(409, 'This match is not set yet'); if (!['a', 'b'].includes(b.side)) throw bad(400, 'Pick a side'); const had = P.m[m.id]; if (had && had.s !== b.side) throw bad(409, 'Your pick is final. Picks are final when you enter them.'); if (!had) { P.m[m.id] = { s: b.side, t: now }; changed = true; } }
        if (!changed) return { nochange: true, v: evt }; P.last = now; return evt; });
      return ok(evt);
    }
    if (op === 'picklock') { // the commissioner sets a round's lock time, or locks its picks now
      const evt = await mutate(id, (evt, now) => { if (!isOrg(evt, u.mk)) throw bad(403, 'Only the organizer or a co-organizer can do that'); notFin(evt); if (!evt.rules.pickem) throw bad(409, 'This event has no pick\'em'); const k = String(b.round || ''), ms = evt.matches.filter((m) => pickable(m) && roundKey(m) === k); if (!ms.length) throw bad(404, 'No such round');
        if (ms.some((m) => pickLocked(evt, m, now))) throw bad(409, 'Picks for this round are already closed'); evt.plock = evt.plock || {}; const p = evt.plock[k] = evt.plock[k] || {}, lab = matchLabel(ms[0]), by = myName(evt), rl = isComm(evt, u.mk) ? ' (commissioner)' : ' (co-organizer)';
        if (b.lock === true) { p.locked = now; p.by = by; audit(evt, now, by + rl, 'picklock', null, lab + ': picks closed now'); }
        else if (b.at === null || b.at === '') { delete p.at; audit(evt, now, by + rl, 'picklock', null, lab + ': closing time removed (picks still close when its first match starts)'); }
        else { const at = Number(b.at); if (!(Number.isFinite(at) && at > now && at < now + 400 * DAY)) throw bad(400, 'The closing time must be in the future'); p.at = at; p.by = by; audit(evt, now, by + rl, 'picklock', null, lab + ': picks close at ' + ctTime(at)); }
        return evt; });
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
  } catch (e) { if (!e.status) console.error('events:', process.env.EVT_DEBUG ? e.stack : e.message); send(res, e.status || 500, Object.assign({ error: e.status ? e.message : 'Events error, try again' }, e.status && e.code ? { code: e.code } : {})); return true; }
}
// What the standings screen says about the playoff spots left over across pools (null when the playoff size is a multiple of the pool count)
function wildView(evt) { const P = (evt.pools || []).length, N = evt.rules.playoff || 0; if (!N || P < 2 || !(N % P)) return null; const o = { pos: Math.floor(N / P) + 1, spots: N % P, per: Math.floor(N / P), decided: null };
  const pool = evt.matches.filter((m) => m.st === 'pool'); if (!pool.length || pool.some((m) => m.state !== 'confirmed')) return o; const tables = evt.pools.map((p, i) => poolTable(evt, p, i)); if (tables.some((t) => t.some((r) => r.tie && r.tieOpen))) return o;
  const w = wildcard(evt, tables); if (w && !w.open) o.decided = w.take.map((e) => ({ name: nameOf(evt, e), how: w.how[e] })); return o; }
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
  const used = new Set(), tables = (evt.pools || []).map((p, i) => poolTable(evt, p, i)); let poolOpen = false; tables.forEach((t) => t.forEach((r) => { if (r.tbKey) used.add(r.tbKey); if (r.tie) used.add(r.tie); if (r.tie && r.tieOpen) poolOpen = true; }));
  const w = wildcard(evt, tables); if (w && w.key) used.add(w.key);
  Object.keys(evt.tb || {}).forEach((k) => { if (used.has(k)) return; if (evt.tb[k].x && poolOpen) return; /* a cross-pool choice is judged only once every pool's order is known */ const ms = (evt.tb[k].ms || []).map((id) => evt.matches.find((x) => x.id === id)).filter(Boolean); if (ms.some((x) => x.live || PLAYED.has(x.state))) return; dropMatches(evt, ms); delete evt.tb[k]; });
}
function voidOwnPicks(evt, m, ent, now) { const P = evt.picks && evt.picks[m.pid]; if (!P || !P.m) return []; const out = []; evt.matches.forEach((x) => { if ((x.a === ent.eid || x.b === ent.eid) && P.m[x.id]) { P.void = P.void || {}; P.void[x.id] = Object.assign({}, P.m[x.id], { at: now }); delete P.m[x.id]; out.push(x); } }); return out; }
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
    if (!(ev[id].mk || []).includes(mk)) continue; const r = await load(id); if (!r) continue; const evt = r.data; tick(evt, now); const m0 = memberOf(evt, mk); if (!m0) continue; await linkRefs(evt); const casual = !(Number(evt.money && evt.money.entry) > 0) || undefined; // H1: casual = a no-money event
    const myGids = new Set(); evt.entrants.forEach((e) => (e.players || []).forEach((p) => { if (p.pid === m0.pid) myGids.add(p.gid); })); // seats this account holds (typed-in guest seats it claimed included)
    const mySide = (pp) => (pp && pp.a.some((p) => myGids.has(p.gid)) ? 'a' : pp && pp.b.some((p) => myGids.has(p.gid)) ? 'b' : null);
    const base = { src: 'events', sport: STAT_SPORT[evt.sport] || 'other', game: evt.sport, groupId: evt.group ? evt.group.gid : undefined, contestId: evt.group ? evt.group.cid : undefined };
    const akOfPid = {}; evt.members.forEach((m) => (akOfPid[m.pid] = m.ak)); const kOf = (p) => (p.pid ? p.k || (akOfPid[p.pid] ? sKey(akOfPid[p.pid]) : 'p:' + p.pid) : null);
    // Third review M4: in ANY format, an event rates nothing until 3 distinct accounts have confirmed play in it (a match an account on the other side confirmed).
    const live = new Set(); evt.matches.forEach((m) => { if (m.state === 'confirmed' && m.pp && m.cf && m.cf.by === 'opp' && !m.forfeit && m.pp.a.some((p) => p.pid) && m.pp.b.some((p) => p.pid)) m.pp.a.concat(m.pp.b).forEach((p) => { if (p.pid) live.add(kOf(p)); }); }); const gate = !!D.rt().standIn, small = gate && live.size < 3; // with the stats module in the build events reports the facts only: stats counts and limits confirmations (contract v1.4: engines never gate on them)
    evt.matches.filter((m) => m.state === 'confirmed' && m.pp).forEach((m) => {
      const side = mySide(m.pp); if (!side) return; const opp = side === 'a' ? m.b : m.a, mine = m.pp[side], theirs = m.pp[side === 'a' ? 'b' : 'a'], meSeat = mine.find((p) => myGids.has(p.gid));
      const games = m.games.map(([x, y]) => (side === 'a' ? [x, y] : [y, x])), diff = games.reduce((t, [x, y]) => t + x - y, 0), mates = mine.filter((p) => p !== meSeat), partner = mates.map((p) => p.name)[0];
      const oppAcct = theirs.some((p) => p.pid), conf = !!(m.cf && m.cf.by === 'opp' && !m.forfeit && oppAcct);
      const why = m.forfeit ? 'Forfeit: not rated' : !oppAcct ? 'The other side has no Oddable account: not rated' : !conf ? 'Made final by the commissioner, not confirmed by the other side: not rated' : small ? 'This event has fewer than 3 accounts with confirmed play: not rated' : undefined;
      // H1 (third review): an explicit, truthful confirmation record for the stats module. Keys are the stats-form account hashes (sKey), never account ids.
      // A confirmed result = two accounts on OPPOSITE sides agreed: one entered it (sub), the other confirmed it (cf). For the player this record belongs to,
      // `agreedWith` is the account on the OTHER side that took part (the confirmer, or the scorer when this player's own side confirmed).
      const cf = m.cf || {}, sub = m.sub || {}, flag = (p) => (p.pid ? { key: kOf(p), guest: false } : { key: null, guest: true }), confSide = cf.by === 'opp' ? (sub.side === 'a' ? 'b' : sub.side === 'b' ? 'a' : side === 'a' ? 'b' : 'a') : null;
      const cside = cf.by === 'opp' ? (confSide === side ? 'own' : 'opponent') : cf.by === 'comm' ? (cf.own ? (cf.own === side ? 'own' : 'opponent') : 'commissioner') : m.forfeit ? 'clock' : 'unknown';
      const other = conf ? (confSide === side ? { key: sub.k || theirs.filter((p) => p.pid).map(kOf)[0] || null, name: sub.by || 'the other side' } : { key: cf.k || theirs.filter((p) => p.pid).map(kOf)[0] || null, name: cf.name || 'the other side' }) : null;
      const confirmation = { agreedWith: other, v: 1, confirmed: conf, rated: conf && !small, by: m.forfeit && !m.cf ? 'clock' : cf.by === 'opp' ? 'opponent' : cf.by === 'comm' ? 'commissioner' : 'unknown', byKey: cf.k || null, bySide: cside, byName: cf.name || null, at: cf.at || m.at || null,
        enteredByKey: sub.k || null, enteredBySide: sub.side === 'comm' ? 'commissioner' : sub.side ? (sub.side === side ? 'own' : 'opponent') : null, forfeit: !!m.forfeit, played: { mine: mine.map(flag), opp: theirs.map(flag) }, oppAccounts: theirs.filter((p) => p.pid).length, oppGuests: theirs.filter((p) => !p.pid).length, eventAccounts: live.size };
      const rt = (p) => (Number.isFinite(p.r) ? p.r : null), avg = (l) => Math.round(l.reduce((t, p) => t + (Number.isFinite(p.r) ? p.r : 1500), 0) / l.length), big = mine.length > 2 || theirs.length > 2; // teams of 3-4: each player is rated against the opposing team's AVERAGE
      out.push(Object.assign({}, base, { id: evt.id + ':' + m.id, date: chiDay(m.at || evt.start), kind: 'match', title: evt.title + ' · ' + matchLabel(m), result: m.win === side ? 'W' : 'L', opponent: nameOf(evt, opp), verified: conf,
        extra: { fmt: big ? 'teams' : mine.length === 2 ? 'doubles' : 'singles', at: m.at || undefined, myRating: Number.isFinite(meSeat.r) ? meSeat.r : undefined, oppRating: big ? [avg(theirs)] : theirs.map(rt), oppRatings: big ? theirs.map(rt) : undefined, partnerRating: big ? undefined : mates.length ? rt(mates[0]) : undefined, partnerRatings: big ? mates.map(rt) : undefined, // rating inputs: null = no confirmed games yet (counted at the 1500 start)
          confirmed: conf && !small, confirmedBy: conf ? { name: m.cf.name || 'the other side', at: m.cf.at || m.at || 0, key: m.cf.k || undefined, ref: cside === 'opponent' ? m.cf.k || undefined : undefined, played: true, side: cside } : undefined, unrated: why, confirmation, ratingKey: rateKeyOf(evt),
          card: { others: theirs.filter((p) => p.pid).length, by: other ? other.key : null, byName: other ? other.name : null, at: (m.cf && m.cf.at) || m.at || 0 }, // stats contract (confInfo): the score was agreed with an account on the other team (card.by = stats.acctRef of that account)
          // oppKey = the same opponents in any event. ONE opposing account: exactly the key stats.js gives a self-logged match against that account (L8), so its repeat-opponent weight sees both.
          oppKey: oppAcct ? ((ks) => (ks.length === 1 && /^a:/.test(ks[0]) ? ks[0] : 'e:' + crypto.createHash('sha256').update('oddable-opp|' + ks.join('|')).digest('hex').slice(0, 14)))(theirs.filter((p) => p.pid).map(kOf).sort()) : undefined,
          casual, place: null, entry: 0, payout: 0, net: 0, moneyOn: evt.id + ':event', scoreText: m.forfeit ? 'forfeit' : games.map((g) => g.join('-')).join(', '), games, partner: partner || undefined, pointDiff: diff, guestId: meSeat.gid, side: mine.map((p) => ({ id: p.gid, name: p.name, account: !!p.pid })), opp: theirs.map((p) => ({ id: p.gid, name: p.name, account: !!p.pid })), forfeit: !!m.forfeit || undefined } }));
    });
    const myE = evt.entrants.filter((e) => (e.players || []).some((p) => myGids.has(p.gid)));
    // S-ALL (owner Nov 16 2026): every play is in the player's dashboard, running or finished: one 'event' record per event they have an entry in, with the
    // money (entry, payout, net; information only). Running: result null + extra.live (an open play); finished: place + payout + net.
    // Entry counts as spent only once the organizer marked this player paid; a finished play that paid nothing sends won: 0 (stats contract v1.1).
    if (myE.length) { const fin = !!(evt.fin && evt.places), ps = fin ? myE.map((e) => evt.places[e.eid]).filter(Boolean) : [], bestE = fin && ps.length ? myE.find((e) => evt.places[e.eid] === Math.min(...ps)) : myE[0];
      const sr = fin && evt.fmt === 'solo' ? soloRows(evt).find((x) => myE.some((e) => e.eid === x.eid)) : null, mo = moneyFor(evt, bestE.eid, (bestE.players.find((p) => myGids.has(p.gid)) || {}).gid);
      if (!fin || ps.length) out.push(Object.assign({}, base, { id: evt.id + ':event', date: chiDay(fin ? evt.fin : evt.start), kind: 'event', title: evt.title + (evt.fmt === 'solo' ? ' · ' + FMTN.solo : ''), result: null, place: fin ? { n: Math.min(...ps), of: Object.keys(evt.places).length } : undefined, score: sr ? sr.score : undefined, verified: sr ? sr.ver : true,
        stake: mo.entry || undefined, won: fin ? Number(mo.payout) || 0 : undefined, pl: fin ? mo.net : undefined,
        extra: { guestId: [...myGids][0], fmt: evt.fmt, casual, at: fin ? evt.fin : undefined, finishedAt: fin ? evt.fin : undefined, live: !fin || undefined, ended: fin || undefined, entry: mo.entry, owed: mo.owed || undefined, payout: fin ? mo.payout : null, net: fin ? mo.net : null, paid: mo.paid, moneyNote: 'Information only: Oddable never collects or pays.', solo: evt.fmt === 'solo' || undefined, scoreText: sr ? sr.score + ' ' + evt.rules.unitLabel : fin ? ord(Math.min(...ps)) + ' of ' + Object.keys(evt.places).length : 'In progress', unit: sr ? evt.rules.unitLabel : undefined } })); }
    if (evt.rules.pickem && evt.fin && evt.picks[m0.pid]) { const t = pickTable(evt).rows, row = t.find((x) => x.pid === m0.pid); if (row) out.push(Object.assign({}, base, { id: evt.id + ':pickem', date: chiDay(evt.fin), kind: 'contest', title: evt.title + " · bracket pick'em", result: null, place: { n: row.place, of: t.length }, verified: true, won: 0, extra: { pickem: true, casual, at: evt.fin, finishedAt: evt.fin, entry: 0, payout: 0, net: 0, right: row.right, of: row.n, pts: row.pts, scoreText: row.right + ' of ' + row.n + ' right' } })); }
  }
  // At most 2 confirmed (rated) matches against the same opponents in any ROLLING 24 HOURS (server time of the confirmation; no calendar day to straddle),
  // across every event of this player; the 3rd and later are records only.
  const seen = {}; if (D.rt().standIn) out.filter((x) => x.kind === 'match').sort((a, b) => (a.extra.at || 0) - (b.extra.at || 0) || recOrder(a, b)).forEach((x) => { const e = x.extra; if (!e.confirmed || !e.oppKey) return; const at = e.at || 0, l = (seen[e.oppKey] = (seen[e.oppKey] || []).filter((t) => at - t < DAY)); if (l.length >= 2) { e.confirmed = false; e.unrated = 'More than 2 matches against the same opponents in 24 hours: not rated'; e.confirmation.rated = false; } else l.push(at); });
  out.forEach((x) => { if (x.kind === 'match' && x.extra.confirmation) x.extra.confirmation.reason = x.extra.unrated || null; });
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
async function oddableOf(userKey, sport, game) { // STAND-IN only (this branch on its own). In the build the stats module (ratings.js eloSet) is the ONE rating calculation.
  if (/^guest:/.test(String(userKey))) return { rating: null, matches: 0, confirmed: 0 }; const key = userKey + '|' + sport + '|' + (game || ''), c = RC.get(key); if (c && D.now() - c.at < 30e3 && D.now() >= c.at) return c.v;
  const recs = (await statsFor(userKey, {})).filter((r) => r.kind === 'match' && r.sport === sport && (sport !== 'other' || !game || (r.extra && r.extra.game === game)) && (r.result === 'W' || r.result === 'L')), exp = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400)), avg = (x) => x.reduce((t, y) => t + y, 0) / x.length, n = (x) => (Number.isFinite(x) ? x : 1500);
  let r = 1500, k = 0; recs.forEach((m) => { const x = m.extra || {}; if (!x.confirmed) return; k++; const dbl = x.fmt === 'doubles', opp = (Array.isArray(x.oppRating) ? x.oppRating : [x.oppRating]).map(n).slice(0, dbl ? 2 : 1), mine = dbl ? [r, n(x.partnerRating)] : [r]; r += 32 * ((m.result === 'W' ? 1 : 0) - exp(avg(mine), avg(opp.length ? opp : [1500]))); });
  const v = { rating: k ? Math.round(r) : null, matches: recs.length, confirmed: k }; RC.set(key, { at: D.now(), v }); if (RC.size > 5000) RC.clear(); return v;
}
const STAND = {
  standIn: true,
  ratingFor: async (userKey, sport, opts) => { const named = /^other:([a-z0-9-]{1,24})$/.exec(String(sport || '')), sp = named ? 'other' : sport && sport !== 'golf' ? sport : 'pickleball', o = Object.assign({}, opts || {}, named ? { game: named[1] } : {}), od = await oddableOf(userKey, sp, sp === 'other' ? o.game : null); let d = null; if (o.eventId) { const r = await D.S.dbGet(EVR(o.eventId)); d = (r && r.data) || null; }
    const s = d && d.set && d.set[pkey(userKey)] && d.set[pkey(userKey)].rating != null ? d.set[pkey(userKey)] : null;
    const text = od.matches ? (od.rating != null ? od.rating + ' · ' : '') + od.confirmed + ' of ' + od.matches + ' game' + (od.matches === 1 ? '' : 's') + ' confirmed' : 'No games yet';
    return { sport: named ? 'other:' + named[1] : sp, game: sp === 'other' && o.game ? o.game : undefined, oddable: { rating: od.rating, matches: od.matches, text, label: RLABEL }, confirmedRating: od.rating, confirmedGames: od.confirmed, text, event: s ? s.rating : null, setBy: s ? 'tournament' : null, use: s ? s.rating : od.rating != null ? od.rating : 1500, seed: s ? s.rating : od.rating != null ? od.rating : 1500, needsSet: false, start: !s && od.rating == null, label: RLABEL, reason: s ? s.reason : undefined, at: s ? s.at : undefined, locked: d ? evrLocked(d) : undefined }; },
  eventSetup: async (directorE, eventId, o) => { if (!(await entFor(directorE))) throw bad(403, 'Only Enterprise tournaments can set ratings'); const x = o || {}, dk = mkOf(directorE);
    await mutateRow(EVR(eventId), () => ({ dir: dk, set: {}, log: [] }), async (d) => { if (d.dir !== dk) throw bad(403, 'Not your tournament'); if (evrLocked(d)) throw bad(409, 'The tournament has started; ratings are final'); d.title = cleanName(x.title, 60) || d.title || 'Tournament'; d.sport = x.sport || d.sport || 'pickleball'; d.lockAt = Number(x.lockAt) > 0 ? Number(x.lockAt) : d.lockAt || null; return {}; }); return { ok: true }; },
  eventOverride: async (directorE, eventId, userKey, o) => { const x = o || {}, raw = x.rating, val = raw == null || raw === '' ? null : Math.round(Number(raw)); if (val != null && !(val >= 100 && val <= 3500)) throw bad(400, 'Rating must be 100 to 3500');
    const dk = mkOf(directorE), pk = pkey(userKey), nm0 = /^other:([a-z0-9-]{1,24})$/.exec(String(x.sport || '')), real = (await oddableOf(userKey, nm0 ? 'other' : x.sport && x.sport !== 'golf' ? x.sport : 'pickleball', nm0 ? nm0[1] : null)).rating;
    return mutateRow(EVR(eventId), null, async (d) => { if (d.dir !== dk) throw bad(403, "Only this tournament's director can change ratings"); if (evrLocked(d)) throw bad(409, 'The tournament has started; ratings are final');
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
  // L2 (fourth review): attach(evtId, {gid, cid, pot, by}) — by = the CALLER's account id, which must be that group's commissioner (asked from Groups,
  // fail closed); group ids up to 40 characters; the event's organizer must be the same commissioner (attachToGroup). The pot follows ctx.pot only while
  // the money rules are still open (M1).
  attach: async (evtId, ctx) => { const c = ctx || {}, gid = String(c.gid || ''), by = String(c.by || c.accountId || ''); if (!/^[\w:-]{1,40}$/.test(gid)) throw bad(400, 'Which group?');
    if (!by || (await groupRole(gid, by)) !== 'comm') throw Object.assign(bad(403, "Only the group's commissioner can add a game to the group."), { code: 'groupcomm' });
    await attachToGroup(evtId, gid, c.cid); const pot = c.pot === 'side' ? 'side' : 'main';
    return mutate(String(evtId), (evt) => { if (evt.money.pot === pot || moneyLocked(evt)) return { nochange: true, v: evt }; evt.money.pot = pot; return evt; }); },
  summary: async (evtId) => { const r = await load(evtId); if (!r) return null; const evt = r.data, now = D.now(); tick(evt, now); const pl = evt.places || places(evt, now); return { id: evt.id, title: evt.title, fmt: evt.fmt, status: evt.fin ? 'final' : evt.drawn ? 'live' : 'upcoming', start: evt.start, leader: pl ? nameOf(evt, Object.keys(pl).find((e) => pl[e] === 1)) : null, places: pl ? Object.entries(pl).map(([e, p]) => ({ lot: e, name: nameOf(evt, e), place: p })) : null }; },
  potSummary: async (evtId) => { const r = await load(evtId); return r ? potSummary(r.data) : null; }, joinFromGroup: (evtId, accountId, opts) => joinFromGroup(evtId, accountId, opts),
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
// ---------- for the Groups engine (groups.wire: registerGame('event', {potSummary, attachToGroup}), registerInvite('e', inviteInfo)) ----------
// attachToGroup(eventId, groupId, contestId): the event's organizer must be THAT group's commissioner (asked from Groups, fail closed); one group per event.
async function attachToGroup(evtId, groupId, contestId) {
  const gid = String(groupId || ''), r = await load(String(evtId)); if (!r) throw bad(404, 'Event not found'); if (!/^[\w:-]{1,40}$/.test(gid)) throw bad(400, 'Which group?');
  if ((await groupRole(gid, r.data.ce)) !== 'comm') throw Object.assign(bad(403, "Only the group's commissioner can add his own event to the group."), { code: 'groupcomm' });
  const evt = await mutate(String(evtId), (evt, now) => { if (evt.group && evt.group.gid !== gid) throw Object.assign(bad(409, 'This event is already in another group'), { code: 'attached' }); const cid = String(contestId || (evt.group && evt.group.cid) || '').slice(0, 20); if (evt.group && evt.group.cid === cid) return { nochange: true, v: evt }; const first = !evt.group; evt.group = { gid: gid.slice(0, 40), cid }; if (first) audit(evt, now, 'Group', 'group', null, 'Added to a group: its members can join from the group'); return evt; });
  await idxSet(String(evtId), () => idxEntry(evt)); return { id: evt.id, group: evt.group };
}
async function joinFromGroup(evtId, accountId, opts) { const u = { e: String(accountId), mk: mkOf(String(accountId)) }, r = await load(String(evtId)); if (!r || !r.data.group) throw bad(404, 'Event not found'); await needGroup(r.data, u); const { evt } = await joinEvent(String(evtId), u, opts || {}); await idxSet(evt.id, () => idxEntry(evt)); return { id: evt.id, people: people(evt) }; }
// potSummary(<event id>) for a group's pot card: {pot, take, pool, paidOut, inPlay, main, over} in dollars (information only). potSummary(<event>) = the event screen's own summary.
function potSummaryAny(x) { if (x && typeof x === 'object') return potSummary(x); return load(String(x || '')).then((r) => { if (!r) return null; const evt = r.data, p = potSummary(evt), fin = !!(evt.fin && evt.places); let paid = 0; if (fin) evt.entrants.forEach((e) => (e.players || []).forEach((s) => { if (!isBlank(s)) paid += Math.round((moneyFor(evt, e.eid, s.gid).payout || 0) * 100); }));
  return { pot: p.total, take: p.take, pool: p.pool, paidOut: fin ? paid / 100 : 0, inPlay: fin ? 0 : p.pool, unclaimed: fin ? Math.round(p.pool * 100 - paid) / 100 : 0, over: fin, main: p.pot === 'main', players: p.players, paid: p.paid, entry: p.entry }; }); }
async function inviteInfo(code, now) { try { const c = normCode(code), id = c ? await byCode(c) : null, r = id ? await load(id) : null; return r ? { kind: 'event', title: r.data.title } : null; } catch (e) { return null; } }
module.exports = { handle, handleOn, LEV_ON, attachToGroup, joinFromGroup, inviteInfo, groupRole, statsFor, ratingFor, STAND, LIMSTAND, openTies, pickPoints, _billed: () => BILLQ, snapRatings, moneyFor, pairHistory, ADAPTER, limits, SPORTS, FMTN, cleanRules, checkGames, roundRobin, buildElim, seedOrder, poolTable, places, potSummary: potSummaryAny, people, _deps: D, _mkOf: mkOf, _reset: () => { RL.clear(); RC.clear(); ENTF.clear(); BILL.clear(); GONE.clear(); LINKED.clear(); SIG.clear(); STARTED.clear(); } };
