// Oddable Groups (stage 1 + review fixes + owner decisions G12/G13, Nov 16 2026). Players compete with the REAL bets they track in My Bets (cloud-synced, sync.js).
// A GROUP holds members and one or more CONTESTS (G13): picks contests now (each with its own sport, dates and rules, locked at its own start), Calcuttas later
// (data model only, see cleanCalc). Each contest is in the group's MAIN POT or its own SIDE POT (members opt in to side pots).
// MONEY STAYS OUTSIDE THE APP (G7): entries, take, splits and "who is owed what" are information only. Nothing is collected, held or paid.
// RESULTS ARE GRADED BY THE SERVER (review fix 1): grade.js reads ESPN final scores; a phone's own "won/lost" is never trusted unless the contest's
// commissioner turned on "Count bets the app can't check (honor system)".
// Storage (Supabase table oddable_sync; the 'lock:' prefix keeps every row out of player lists and owner counts, see sync.js adminUsers/dbIds):
//   'lock:grp:<id>'          one row per group (settings, members, requests, contests). Every change: read -> change -> write only if `updated` is unchanged
//                            (dbPatchIf), randomized back-off, up to 16 tries (review fix 5: groups no longer share one row).
//   'lock:gl:<id>:<cid>'     one ledger per contest: every member bet the server has seen, with the server's own first-seen time, the bet as frozen at kickoff,
//                            the kickoff of each game (stored the first time known, never re-decided) and the frozen result (fixes 2, 4, G11).
//   'lock:gm:<memberKey>'    a member's own index: groups joined / requested / run (so /mine reads only that member's groups).
//   'lock:gidx'              small index of every group (end day, open-for-requests, join close) for Open groups, caps and the server tick.
// Members are shown by their Oddable name/handle only (G9). Phones, phone hashes, PINs, tokens, sync ids and member keys are never sent to anyone.
const crypto = require('crypto');
const GR = require('./grade');
const LIM = require('./limits'); // G15: 8 people per group for standard accounts, enterprise ceiling, owner-set extra seats
const D = {
  S: require('./sync'),
  acct: () => require('./acct'),
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
  ip: (req) => require('./ip').clientIp(req),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
GR._deps.fetch = (...a) => D.fetch(...a); GR._deps.now = () => D.now();
['S', 'acct', 'now', 'sleep'].forEach((k) => Object.defineProperty(LIM._deps, k, { get: () => D[k], configurable: true })); // limits.js shares this file's database, clock and sign-in
const GK = (id) => 'lock:grp:' + id, LK = (id, cid) => 'lock:gl:' + id + ':' + cid, MK = (mk) => 'lock:gm:' + mk, IDX = 'lock:gidx';
const MAXG = 2000, MAXMINE = 20, DAY = 864e5, MAXC = 8;
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const bad = (status, error) => Object.assign(new Error(error), { status });
const body = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 20000) c.push(d); }); req.on('end', () => { if (n > 20000) return no(bad(413, 'Too big')); try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(bad(400, 'Bad request')); } }); req.on('error', no); });
const clone = (o) => JSON.parse(JSON.stringify(o));
const cleanName = (n, max) => String(n == null ? '' : n).replace(/[<>&"'`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 24);
async function pmap(list, n, fn) { const out = new Array(list.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } })); return out; }

// ---------- Chicago days ----------
const chiDay = GR.chiDay;
const dnum = (day) => Math.round(Date.parse(day + 'T00:00:00Z') / DAY);
const dstr = (n) => new Date(n * DAY).toISOString().slice(0, 10);
function chiStart(day) { for (const off of ['-05:00', '-06:00']) { const t = Date.parse(day + 'T00:00:00' + off); if (chiDay(t) === day && chiDay(t - 1) !== day) return t; } return Date.parse(day + 'T06:00:00Z'); }
const chiEnd = (day) => chiStart(dstr(dnum(day) + 1)) - 1;
const okDay = GR.okDay;
// Contest weeks run Tuesday to Monday for EVERY sport (G12). Week 1 is from the start day to the first Monday.
const tue0 = (startDay) => { const n = dnum(startDay), wd = new Date(n * DAY).getUTCDay(); return n - ((wd + 5) % 7); };
const weekOf = (c, day) => Math.floor((dnum(day) - tue0(c.startDay)) / 7) + 1;
const weekDays = (c, w) => { const a = tue0(c.startDay) + (w - 1) * 7; return [dstr(Math.max(a, dnum(c.startDay))), dstr(Math.min(a + 6, dnum(c.endDay)))]; };

// ---------- rules ----------
// G12: the sports the app already tracks. 'all' = every one of them. End days are estimates for the 2026-27 seasons (owner can correct).
const SPORTS = ['all', 'nfl', 'ncaaf', 'nba', 'mlb', 'nhl', 'ncaab'];
const SPORTN = { all: 'All sports', nfl: 'NFL', ncaaf: 'College football', nba: 'NBA', mlb: 'MLB', nhl: 'NHL', ncaab: 'College basketball' };
const SEASON_END = { all: '2027-04-16', nfl: '2027-01-11', ncaaf: '2027-01-20', nba: '2027-04-12', mlb: '2027-09-27', nhl: '2027-04-16', ncaab: '2027-03-16' };
const PLAYOFF_END = { all: '2027-06-25', nfl: '2027-02-15', ncaaf: '2027-01-20', nba: '2027-06-25', mlb: '2027-11-05', nhl: '2027-06-25', ncaab: '2027-04-07' };
const leaguesOf = (sport) => (sport === 'all' ? GR.LGS.slice() : [sport]);
const SPLITS = { '60/30/10': [60, 30, 10], '100': [100], '50/30/20': [50, 30, 20], '70/30': [70, 30], 'none': [] };
const FMTS = ['standings', 'best5'], METRICS = ['win', 'units', 'ret', 'pct'];
const MAXBETS = [0, 5, 6, 7, 8, 10, 12, 15, 20, 25], CAPS = [0, 10, 25, 50, 100, 250, 500, 1000], MAXODDS = [150, 200, 300, 400, 500, 750, 1000, 2000, 3000, 5000], NOCAP = 1000, MAXM = [2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 5000], MINPAID = [0, 1, 2, 3, 5, 8, 10, 12, 15, 20, 25, 30];
const MSPLIT = { '50/50': [50, 50], '40/60': [40, 60], '60/40': [60, 40] };
function runsEnd(runs, startDay, sport, endDay) {
  const wd = new Date(dnum(startDay) * DAY).getUTCDay(), toMon = (8 - wd) % 7;
  if (runs === 'weekend') return dstr(dnum(startDay) + toMon);
  const m = /^w(\d{1,2})$/.exec(runs || ''); if (m) { const n = +m[1]; if (n < 1 || n > 20) throw bad(400, 'Pick 1 to 20 weeks'); return dstr(dnum(startDay) + n * 7 - 1); }
  if (runs === 'season') return SEASON_END[sport];
  if (runs === 'playoffs') return PLAYOFF_END[sport];
  if (runs === 'custom') { if (!okDay(endDay)) throw bad(400, 'Pick an end date'); return endDay; }
  throw bad(400, 'Pick how long the contest runs');
}
const shortRun = (runs) => runs === 'weekend' || runs === 'w1';
const cents = (x) => Math.round(Number(x) * 100);
function cleanTake(tk, maxPot) { // Commissioner's take (G10): none / whole percent 0-50 / flat dollars and cents (never negative, never more than the pot)
  const kind = String((tk && tk.kind) || 'none'); let tv = 0;
  if (kind === 'pct') { tv = Number(tk.v); if (!(Number.isInteger(tv) && tv >= 0 && tv <= 50)) throw bad(400, "Commissioner's take: a whole percent from 0 to 50"); }
  else if (kind === 'flat') { tv = Number(tk.v); if (!(Number.isFinite(tv) && tv >= 0 && Math.abs(tv * 100 - Math.round(tv * 100)) < 1e-6)) throw bad(400, "Commissioner's take: a dollar amount, not negative"); tv = Math.round(tv * 100) / 100; if (cents(tv) > cents(maxPot)) throw bad(400, "The commissioner's take cannot be more than the pot (entries x most members)"); }
  else if (kind !== 'none') throw bad(400, "Pick the commissioner's take");
  return { kind, v: kind === 'none' ? 0 : tv };
}
// One picks contest. Validates and range-checks every option. Throws {status:400}.
function cleanContest(b, now, maxMembers) {
  const name = cleanName(b.cname || b.name || 'Picks standings', 30); if (name.length < 2) throw bad(400, 'Give the contest a name (2+ characters)');
  const sport = String(b.sport || ''); if (!SPORTS.includes(sport)) throw bad(400, 'Pick a sport');
  const fmt = String(b.fmt || ''); if (!FMTS.includes(fmt)) throw bad(400, 'That format is coming soon. Pick Standings or Best five.');
  const start = Number(b.start); if (!Number.isFinite(start) || start < now + 60e3) throw bad(400, 'The start must be in the future');
  if (start > now + 400 * DAY) throw bad(400, 'The start is too far away');
  const runs = String(b.runs || ''), startDay = chiDay(start), endDay = runsEnd(runs, startDay, sport, b.endDay);
  if (dnum(endDay) < dnum(startDay)) throw bad(400, 'The end is before the start');
  if (dnum(endDay) - dnum(startDay) > 370) throw bad(400, 'A contest can run up to a year');
  const T = b.types || {}, types = { sp: !!T.sp, ml: !!T.ml, ou: !!T.ou, prop: !!T.prop, parlay: !!T.parlay };
  if (!Object.values(types).some(Boolean)) throw bad(400, 'Pick at least one kind of bet that counts');
  const legs = types.parlay ? Math.round(Number(b.legs)) : 0; if (types.parlay && !(legs >= 2 && legs <= 10)) throw bad(400, 'Parlay legs must be 2 to 10');
  const metric = String(b.metric || ''); if (!METRICS.includes(metric)) throw bad(400, 'Pick how the winner is decided');
  const minBets = Math.round(Number(b.minBets || 0)); if (!(minBets >= 0 && minBets <= 10)) throw bad(400, 'Least bets a week: 0 to 10');
  // Rules review (Nov 16 2026): Best five rewards betting MORE, not better. "Most bets per week" (default 10 in Best five, no limit in standings; 0 = no limit):
  // only the first N bets a member adds for a week count; later ones are shown as "Over the weekly limit". Set before the start, locked with the bet rules.
  const maxBets = b.maxBets == null ? (fmt === 'best5' ? 10 : 0) : Math.round(Number(b.maxBets)); if (!MAXBETS.includes(maxBets)) throw bad(400, 'Most bets a week: pick from the list (5 to 25, or no limit)');
  if (maxBets && minBets > maxBets) throw bad(400, 'Least bets a week cannot be more than most bets a week');
  const minPaid = b.minPaid == null ? (shortRun(runs) ? 3 : 10) : Math.round(Number(b.minPaid)); if (!MINPAID.includes(minPaid)) throw bad(400, 'Pick the fewest bets to place in a paid spot from the list');
  let cap = Math.round(Number(b.cap || 0)); if (!CAPS.includes(cap)) throw bad(400, 'Pick a cap from the list'); if (!cap) cap = NOCAP; // round 2: every bet has a cap; the old "no cap" means $1,000
  const maxOdds = b.maxOdds == null ? 500 : Math.round(Number(b.maxOdds)); if (!MAXODDS.includes(maxOdds)) throw bad(400, 'Longest odds that count: pick from the list (+150 to +5000)');
  const entry = Number(b.entry || 0); if (!(Number.isFinite(entry) && entry >= 0 && entry <= 10000 && Math.round(entry) === entry)) throw bad(400, 'Entry must be a whole dollar amount from 0 to 10,000');
  const split = String(b.split || 'none'); if (!(split in SPLITS)) throw bad(400, 'Pick a payout split');
  const pot = b.pot === 'side' ? 'side' : 'main';
  const take = pot === 'side' ? cleanTake(b.take, entry * (maxMembers || 50)) : { kind: 'none', v: 0 };
  return { kind: 'picks', name, pot, sport, fmt, start, startDay, endDay, runs, rules: { kalshi: !!b.kalshi, honor: !!b.honor, types, legs, metric, minBets, maxBets, minPaid, cap, maxOdds, entry, split, take } };
}
// Calcutta contest: DATA MODEL ONLY (G13; the auction and Calcutta screens are not built). Shape follows the CalcSetup / CalcAuction / CalcBoard mockups.
function cleanCalc(b) {
  const lots = (Array.isArray(b.lots) ? b.lots : []).slice(0, 128).map((l, i) => ({ id: String(i + 1), name: cleanName(l && l.name, 40), teams: (Array.isArray(l && l.teams) ? l.teams : []).slice(0, 40).map((t) => cleanName(t, 12)) })).filter((l) => l.name);
  const payout = (Array.isArray(b.payout) ? b.payout : []).slice(0, 20).map((p) => ({ when: cleanName(p && p.when, 60), pct: Math.round(Number(p && p.pct) * 100) / 100, each: !!(p && p.each), n: Math.max(1, Math.round(Number(p && p.n) || 1)) }));
  const total = Math.round(payout.reduce((a, p) => a + p.pct * (p.each ? p.n : 1), 0) * 100) / 100; if (payout.length && total !== 100) throw bad(400, 'Calcutta payouts must total 100%');
  return { kind: 'calcutta', name: cleanName(b.cname || b.name || 'Calcutta', 30), pot: b.pot === 'side' ? 'side' : 'main', event: cleanName(b.event, 60), sport: SPORTS.includes(b.sport) ? b.sport : 'nfl', lots, payout,
    rules: { minBid: [1, 5, 10, 25].includes(Number(b.minBid)) ? Number(b.minBid) : 5, timer: [10, 20, 30].includes(Number(b.timer)) ? Number(b.timer) : 20, buyBack: !!b.buyBack, mode: b.mode === 'enter' ? 'enter' : 'live', take: cleanTake(b.take, 1e6), entry: 0 }, start: null, status: 'setup' };
}
function cleanJoin(J, cap, keep) { // keep = the group's current max (an owner-raised max that is not on the list stays valid)
  J = J || {}; const max = Math.round(Number(J.max)); if (!MAXM.includes(max) && max !== keep) throw bad(400, 'Pick the most members from the list');
  if (cap && max > cap) throw bad(400, 'Up to ' + cap + ' people. ' + LIM.ENTERPRISE_TEXT);
  const late = J.late === '2w' ? '2w' : J.late === 'no' || J.late == null ? 'no' : null; if (!late) throw bad(400, 'Pick when late joining is allowed');
  return { requests: !!J.requests, open: !!J.open, max, late };
}
function cleanMsplit(ms, mains) { // how the main pot's prize pool is shared between main-pot contests (mains = contest objects)
  const mainIds = mains.map((c) => c.cid);
  if (mainIds.length <= 1) return { kind: 'entry', pct: mainIds.length ? { [mainIds[0]]: 100 } : {} };
  const kind = String((ms && ms.kind) || 'entry');
  if (kind === 'entry') { // round 2 default: weighted by each contest's entry ($0 entry -> 0); all $0 -> even. Whole cents of a percent, leftover to the biggest.
    const E = mains.map((c) => Math.max(0, Number((c.rules && c.rules.entry) || 0))), tot = E.reduce((a, x) => a + x, 0); if (!tot) return cleanMsplit({ kind: 'even' }, mains);
    const pct = {}; let used = 0; mains.forEach((c, i) => { pct[c.cid] = Math.floor(E[i] * 10000 / tot) / 100; used += pct[c.cid]; }); const big = mains[E.indexOf(Math.max(...E))].cid; pct[big] = Math.round((pct[big] + 100 - used) * 100) / 100; return { kind, pct }; }
  if (kind === 'even') { const pct = {}; mainIds.forEach((id) => (pct[id] = Math.round(10000 / mainIds.length) / 100)); return { kind, pct }; }
  if (MSPLIT[kind]) { if (mainIds.length !== 2) throw bad(400, 'That split is for two main-pot contests'); return { kind, pct: { [mainIds[0]]: MSPLIT[kind][0], [mainIds[1]]: MSPLIT[kind][1] } }; }
  if (kind === 'custom') { const pct = {}; let t = 0; mainIds.forEach((id) => { const v = Number(ms.pct && ms.pct[id]); if (!(Number.isInteger(v) && v >= 0 && v <= 100)) throw bad(400, 'Custom split: whole percents'); pct[id] = v; t += v; }); if (t !== 100) throw bad(400, 'Custom split must total 100%'); return { kind, pct }; }
  throw bad(400, 'Pick how the main pot is split');
}

// ---------- money (information only) ----------
const splitOf = (g) => g.contests.filter((c) => c.pot === 'main' && c.kind !== 'ext'); // the main-pot contests that share the picks prize pool (an attached game pays by its own rules)
const mainOf = (g) => g.contests.filter((c) => c.pot === 'main'), sideOf = (g) => g.contests.filter((c) => c.pot === 'side');
const inContest = (c, g) => (c.pot === 'side' ? g.members.filter((m) => (c.inn || []).includes(m.pid)) : g.members);
const placesOf = (poolC, split) => { const sp = SPLITS[split] || []; const parts = sp.map((p) => Math.floor(poolC * p / 100)); if (parts.length) parts[0] += poolC - parts.reduce((a, x) => a + x, 0); return parts.map((c, i) => ({ place: i + 1, pct: sp[i], amt: c / 100, c })); };
const takeOf = (potC, tk) => (tk.kind === 'pct' ? Math.round(potC * tk.v / 100) : tk.kind === 'flat' ? Math.min(cents(tk.v), potC) : 0);
// ---------- games built by other engines report their money into the group's pots (rules review, Nov 16 2026) ----------
// registerGame(type, { potSummary(ref) -> { bids | pot, take, pool, paidOut?, inPlay?, main? }, attachToGroup?(ref, groupId, contestId) })
//   Calcutta: registerGame('calc', { potSummary: C.potSummary, attachToGroup: C.attachToGroup }); golf: registerGame('golf', { potSummary: G.potSummary, attachToGroup: G.attach });
//   events: registerGame('event', { potSummary: E.potSummary }). The manager wires these in server.js at merge.
// A MAIN Calcutta (attached with pot 'main', and not reporting main: false) is listed in the group's main pot: its bids, take and prize pool are added to
// the main pot's totals. Its own payout table decides who is paid (the main-pot split between picks contests never touches it). Side games are listed
// with the side pots. Summaries are read through a 30-second cache when a group is read, so pots(g) stays a plain function. Display only, as always.
const GAMES = {}, EXTC = new Map();
function registerGame(type, api) { if (!/^[a-z]{1,8}$/.test(String(type)) || !api || typeof api.potSummary !== 'function') throw new Error('bad game type'); GAMES[type] = api; }
const m2 = (v) => { const n = Math.round(Number(v) * 100) / 100; return Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : 0; };
async function extLoad(g) {
  const list = (g.contests || []).filter((c) => c.kind === 'ext' && GAMES[c.type]); if (!list.length) return g;
  await pmap(list, 4, async (c) => { const k = c.type + ':' + c.ref, hit = EXTC.get(k); if (hit && D.now() - hit.at < 30e3) return;
    let v = null; try { const s = await GAMES[c.type].potSummary(c.ref); if (s) v = { pot: m2(s.bids != null ? s.bids : s.pot), take: m2(s.take), pool: m2(s.pool), paidOut: m2(s.paidOut), inPlay: m2(s.inPlay), main: s.main !== false }; } catch (e) { v = hit ? hit.v : null; }
    EXTC.set(k, { at: D.now(), v }); if (EXTC.size > 2000) EXTC.delete(EXTC.keys().next().value); });
  return g;
}
const extOf = (g) => (g.contests || []).filter((c) => c.kind === 'ext').map((c) => { const h = EXTC.get(c.type + ':' + c.ref), s = h && h.v; return s ? { cid: c.cid, name: c.name, type: c.type, where: c.pot === 'main' && s.main ? 'main' : 'side', pot: s.pot, take: s.take, pool: s.pool, paidOut: s.paidOut, inPlay: s.inPlay } : null; }).filter(Boolean);
function pots(g) {
  const M = splitOf(g), n = g.members.length, paid = g.members.filter((m) => m.paid).length, entryC = M.reduce((a, c) => a + cents(c.rules.entry || 0), 0);
  const potC = entryC * paid, takeC = takeOf(potC, g.money.take), poolC = potC - takeC, ms = (g.money.msplit && g.money.msplit.pct) || {};
  const ids = M.map((c) => c.cid); let used = 0; const shareC = ids.map((id) => { const v = Math.floor(poolC * (Number(ms[id]) || 0) / 100); used += v; return v; }); if (shareC.length) shareC[0] += poolC - used;
  const main = { entry: entryC / 100, members: n, paid, expected: entryC * n / 100, pot: potC / 100, take: takeC / 100, takeText: takeText(g.money.take), pool: poolC / 100, msplit: g.money.msplit,
    parts: M.map((c) => ({ cid: c.cid, name: c.name, kind: c.kind, entry: c.rules.entry || 0, entries: (cents(c.rules.entry || 0) * paid) / 100 })),
    shares: M.map((c, i) => ({ cid: c.cid, name: c.name, pct: Number(ms[c.cid]) || 0, amt: shareC[i] / 100, split: c.rules.split, places: placesOf(shareC[i], c.rules.split) })) };
  const sides = sideOf(g).map((c) => { const mem = inContest(c, g), pd = mem.filter((m) => (c.paid || {})[m.pid]).length, pC = cents(c.rules.entry || 0) * pd, tC = takeOf(pC, c.rules.take), pl = pC - tC;
    return { cid: c.cid, name: c.name, kind: c.kind, entry: c.rules.entry || 0, members: mem.length, paid: pd, expected: (c.rules.entry || 0) * mem.length, pot: pC / 100, take: tC / 100, takeText: takeText(c.rules.take), pool: pl / 100, split: c.rules.split, places: placesOf(pl, c.rules.split) }; });
  const ext = extOf(g), em = ext.filter((x) => x.where === 'main'), es = ext.filter((x) => x.where === 'side'), sum = (l, k) => l.reduce((a, x) => a + cents(x[k]), 0);
  main.games = em; main.total = (potC + sum(em, 'pot')) / 100; main.totalTake = (takeC + sum(em, 'take')) / 100; main.totalPool = (poolC + sum(em, 'pool')) / 100; // picks entries + main games (a Main Calcutta's bids)
  return { main, sides, sideGames: es, sideTotal: (sides.reduce((a, s) => a + cents(s.pot), 0) + sum(es, 'pot')) / 100 };
}
const prizeOf = (g, c) => { const P = pots(g); if (c.pot === 'side') { const s = P.sides.find((x) => x.cid === c.cid); return s ? s.places : []; } const s = P.main.shares.find((x) => x.cid === c.cid); return s ? s.places : []; };
const takeText = (tk) => (tk.kind === 'pct' ? (tk.v ? 'Commissioner keeps ' + tk.v + '% of the pot' : 'Commissioner keeps nothing') : tk.kind === 'flat' ? (tk.v ? 'Commissioner keeps $' + (Number.isInteger(tk.v) ? tk.v : tk.v.toFixed(2)) + ' of the pot' : 'Commissioner keeps nothing') : 'Commissioner keeps nothing');

// ---------- identity ----------
const IDS = { at: 0, map: null }, IDF = new Map();
async function sidOf(e, force) { // a phone account's synced bets row id. Server only.
  if (!/@phone\.oddable$/.test(e)) return null; const A = D.acct();
  const load = async () => { const m = {}; (await D.S.dbIds()).forEach((id) => { m[A.phoneEmail(id)] = id; }); IDS.map = m; IDS.at = D.now(); };
  if (!IDS.map || D.now() - IDS.at > 10 * 6e4) await load();
  if (IDS.map[e]) return IDS.map[e];
  if (force && D.now() - (IDF.get(e) || 0) > 60e3) { IDF.set(e, D.now()); if (IDF.size > 5000) IDF.clear(); await load(); return IDS.map[e] || null; } // fix 9: a member whose sync row appeared later is linked when they next open Groups
  return null;
}
const mkOf = (e) => crypto.createHash('sha256').update('oddable-group|' + e).digest('hex').slice(0, 24);
let NAMES = { at: 0, v: {} };
async function names() { if (D.now() - NAMES.at > 60e3) { try { NAMES = { at: D.now(), v: await D.acct().namesGet() }; } catch (e) { NAMES.at = D.now(); } } return NAMES.v; }
async function nameOf(e, sid, given) { const A = D.acct(); if (e === 'owner' || A.isOwnerPhone(e)) return A.ownerName(); if (sid) { const n = (await names())[String(sid).slice(0, 8)]; if (n) return cleanName(n); } return cleanName(given) || 'Player'; }
const fixed = (e, sid) => !sid || e === 'owner' || D.acct().isOwnerPhone(e);
async function me(req) { const e = D.acct().who(req); if (!e) throw bad(401, 'Sign in to use Groups'); return { e, mk: mkOf(e) }; }
const shownName = (m, nm) => ((m.sid && nm[String(m.sid).slice(0, 8)] && !m.fixedName) ? cleanName(nm[String(m.sid).slice(0, 8)]) : m.name);

// ---------- rate limits (in memory) ----------
const RL = new Map();
function limit(key, n, ms) { const t = D.now(), a = (RL.get(key) || []).filter((x) => t - x < ms); if (a.length >= n) { RL.set(key, a); return true; } a.push(t); RL.set(key, a); if (RL.size > 20000) { let k = 0; for (const x of RL.keys()) { RL.delete(x); if (++k > 5000) break; } } return false; }
const RLIM = { create: [5, 3600e3, 12, 3600e3], join: [30, 600e3, 60, 600e3], invite: [40, 600e3, 60, 600e3] };
function rate(kind, who, ip) { const L = RLIM[kind]; if (limit(kind + '|a|' + who, L[0], L[1]) || limit(kind + '|i|' + ip, L[2], L[3])) throw bad(429, 'Too many tries. Wait a few minutes.'); }
const codeFail = (k) => { const t = D.now(), a = (RL.get(k) || []).filter((x) => t - x < 900e3); a.push(t); RL.set(k, a); };
const codeBlocked = (k) => (RL.get(k) || []).filter((x) => D.now() - x < 900e3).length >= 10;

// ---------- rows: read-change-write with back-off (fix 5) ----------
// One writer at a time per row INSIDE this process (a promise chain per key): 12 people joining at once no longer race each other, so nobody burns their
// tries and sees "Busy, try again". The conditional write (dbPatchIf) stays as the guard against another server instance or sync.js writing the same row.
const QUEUE = new Map();
function serial(key, fn) {
  const prev = QUEUE.get(key) || Promise.resolve(), run = prev.then(fn, fn), tail = run.then(() => {}, () => {});
  QUEUE.set(key, tail); tail.then(() => { if (QUEUE.get(key) === tail) QUEUE.delete(key); }); return run;
}
const rmw = (key, init, fn, tries) => serial(key, () => rmw1(key, init, fn, tries));
async function rmw1(key, init, fn, tries) {
  for (let i = 0; i < (tries || 16); i++) {
    let row = await D.S.dbGet(key);
    if (!row) { if (init === null) throw bad(404, 'Group not found'); await D.S.dbPut({ id: key, salt: 'x', pinhash: 'x', data: init, updated: 1 }, true); row = await D.S.dbGet(key); if (!row) continue; }
    const data = clone(row.data || {}), out = await fn(data);
    if (out && out.nochange) return out.v;
    if (await D.S.dbPatchIf(key, row.updated, data, Math.max(D.now(), Number(row.updated || 0) + 1))) return out;
    await D.sleep(3 + Math.random() * 12 * Math.min(i + 1, 6)); // randomized back-off so racing writers spread out
  }
  throw bad(409, 'Busy, try again');
}
const gread = async (id) => { if (!/^[A-Z2-9]{10}$/.test(String(id || ''))) return null; const r = await D.S.dbGet(GK(id)); return r && r.data && r.data.id ? extLoad(r.data) : null; };
const gmut = (id, fn) => rmw(GK(id), null, async (g) => { if (!g.id) throw bad(404, 'Group not found'); return fn(g); });
async function memIdx(mk, fn) { try { await rmw(MK(mk), { g: [], q: [], own: {} }, async (x) => { x.g = x.g || []; x.q = x.q || []; x.own = x.own || {}; const before = JSON.stringify(x); fn(x); x.g = [...new Set(x.g)].slice(-200); x.q = [...new Set(x.q)].slice(-200); return JSON.stringify(x) === before ? { nochange: true } : {}; }); } catch (e) { console.error('groups: member index', e.message); } }
const gEnd = (g) => g.contests.reduce((a, c) => (c.endDay && c.endDay > a ? c.endDay : a), '0000-00-00');
const gStart = (g) => { const s = g.contests.filter((c) => c.kind === 'picks').map((c) => c.start); return s.length ? Math.min(...s) : Infinity; };
const idxOf = (g) => ({ e: gEnd(g), s: gStart(g), o: !!(g.join.open && g.join.requests), jc: joinOpenUntil(g) });
async function idxPut(g, del) { try { await rmw(IDX, { g: {} }, async (x) => { x.g = x.g || {}; if (del) delete x.g[g.id]; else x.g[g.id] = idxOf(g); return {}; }); } catch (e) { console.error('groups: index', e.message); } }

// ---------- group state ----------
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPH[b[i] % 32]; return s; };
const newCode = () => rnd(4) + '-' + rnd(4);
const CK = (code) => 'lock:gcode:' + String(code).replace('-', ''); // invite code -> group id (one small row per code)
const normCode = (c) => { const x = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return x.length === 8 ? x.slice(0, 4) + '-' + x.slice(4) : ''; };
const cStarted = (c, now) => c.kind === 'picks' && now >= c.start;
const cEnded = (c, now) => c.kind === 'picks' && now > chiEnd(c.endDay);
const started = (g, now) => now >= gStart(g);
const ended = (g, now) => g.contests.length > 0 && g.contests.every((c) => c.kind !== 'picks' || cEnded(c, now));
const joinOpenUntil = (g) => (g.join.late === '2w' ? gStart(g) + 14 * DAY : gStart(g));
const capOf = async (g) => Math.min(g.join.max, await LIM.maxPeople(g.owner, g.id)); // G15: the group's own setting, never above the creator's limit
const fullMsg = (n) => 'This group is full (' + n + ' people). ' + LIM.ENTERPRISE_TEXT;
const memberOf = (g, mk) => g.members.find((m) => m.mk === mk);
const isComm = (g, mk) => g.comm === mk;
const newPid = (g) => { let p; do { p = rnd(6); } while (g.members.some((m) => m.pid === p) || (g.reqs || []).some((m) => m.pid === p)); return p; };
// Fix 6: once anyone besides the commissioner has joined or asked to join, the money and bet rules are locked (entry, take, splits, cap, ranking, bet rules).
const engaged = (g) => !!g.engaged || g.members.length > 1 || (g.reqs || []).length > 0;
const MONEYKEYS = ['kalshi', 'honor', 'types', 'legs', 'metric', 'minBets', 'maxBets', 'minPaid', 'cap', 'maxOdds', 'entry', 'split', 'take'];
const DATEKEYS = ['start', 'startDay', 'endDay', 'runs']; // owner (round 2): contest dates also lock once anyone else has joined

// ---------- bets: the contest ledger (fixes 1-4, G11) ----------
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const legsOf = (b) => (b.kind === 'parlay' ? (Array.isArray(b.legs) ? b.legs : []) : [b]);
// What the contest keeps of a bet: only the fields that decide whether it counts and how it is graded. Never the phone's result.
function snap(b) {
  const pick = (o, ks) => { const r = {}; ks.forEach((k) => { if (o[k] !== undefined && o[k] !== null && o[k] !== '') r[k] = typeof o[k] === 'string' ? String(o[k]).slice(0, 120) : o[k]; }); return r; };
  const s = pick(b, ['kind', 'type', 'side', 'line', 'odds', 'mult', 'stake', 'lg', 'gid', 'day', 'home', 'away', 'src', 'kt', 'ks', 'text', 'cash', 'soldN']);
  if (b.kind === 'prop' && b.pp && b.pp.gid != null && !b.kt) s.pg = String(b.pp.gid).slice(0, 20);
  if (b.kind === 'parlay') s.legs = (Array.isArray(b.legs) ? b.legs : []).slice(0, 12).map((l) => pick(l || {}, ['gid', 'side', 'type', 'line', 'lg', 'home', 'away', 'text', 'day', 'o', 'k']));
  if (s.stake != null) s.stake = N(s.stake); return s;
}
const legKeys = (s) => legsOf(s).map((l) => GR.legKey(s.kind === 'parlay' ? Object.assign({ lg: s.lg }, l) : s));
const kicksOf = (s, R) => { const k = legKeys(s).map((x) => (R[x] && R[x].kick != null ? R[x].kick : null)); return { all: k.length > 0 && k.every((x) => x != null), min: k.length && k.every((x) => x != null) ? Math.min(...k) : null, max: k.length && k.every((x) => x != null) ? Math.max(...k) : null, any: k.filter((x) => x != null) }; };
function phoneResult(b) { // the phone's own result: used ONLY for honor-system contests
  const st = N(b.stake);
  if (b.cash !== undefined && b.cash !== null && st) { const r = b.cash > st + 0.005 ? 'won' : b.cash < st - 0.005 ? 'lost' : 'push'; return { res: r, pl: Math.round((N(b.cash) - st) * 100) / 100 }; }
  let r = ''; if (b.fin === 'won' || b.fin === 'lost' || b.fin === 'push') r = b.fin; else if (/^(won|lost|push|void)$/.test(String(b.res || ''))) r = b.res === 'void' ? 'push' : b.res;
  if (!r) return null;
  if (b.fin && Number.isFinite(Number(b.finPL)) && b.finPL !== null && b.finPL !== '') return { res: r, pl: Number(b.finPL) };
  const pm = GR.priceMult(b); return { res: r, pl: r === 'won' ? (pm == null ? 0 : Math.round(st * pm * 100) / 100) : r === 'lost' ? -st : 0 };
}
// Apply what the server saw (a member's live bets and their row's server-stamped `updated`) to the ledger. Pure and repeatable, so a lost write can be redone on a fresh copy.
//  - first seen = the earlier of now and the row's `updated` (both the server's own clock: sync.js stamps every write). A bet is in the row only if it was written by then.
//  - the bet is re-copied while its row was last written BEFORE the bet's kickoff (edits before kickoff count); from kickoff on, the copy is frozen.
//  - kickoffs are stored per game the first time they are known and never re-decided.
//  - a result is frozen the first time it is final (server grade), or, for honor-system bets, the first time the phone says it is settled.
function applyObs(L, obs, now) {
  let ch = 0; L.b = L.b || {};
  obs.forEach((o) => {
    const P = (L.b[o.pid] = L.b[o.pid] || {}); let e = P[o.id];
    if (!e) { if (Object.keys(P).length >= 3000) return; e = P[o.id] = { f: Math.min(now, o.gl > 0 ? o.gl : o.sa > 0 ? o.sa : o.U), s: o.s, r: {} }; if (o.gl > 0) e.gl = o.gl; ch++; } // G16: a group bet's first-seen time is the moment the server saved it
    e.r = e.r || {};
    Object.keys(o.R || {}).forEach((k) => { if (!e.r[k] && o.R[k] && o.R[k].kick != null) { e.r[k] = o.R[k]; ch++; } }); // stored once, never re-decided
    if (o.s && !e.z && !e.g) {
      const ko = kicksOf(e.s, e.r), kn = kicksOf(o.s, e.r);
      if (!e.gl && ko.all && kn.all && o.U < Math.min(ko.min, kn.min) && JSON.stringify(o.s) !== JSON.stringify(e.s)) { e.s = o.s; ch++; } // G16: a group bet is locked when added (never re-copied)
      const k2 = kicksOf(e.s, e.r); if (k2.all && (now >= k2.min || o.U >= k2.min)) { e.z = 1; ch++; }
    }
    if (o.h && !e.h) { e.h = o.h; ch++; }
  });
  return ch;
}
function applyGrades(L, gr) { let ch = 0; gr.forEach((x) => { const e = L.b && L.b[x.pid] && L.b[x.pid][x.id]; if (e && !e.g && x.g && JSON.stringify(e.s) === x.sj) { e.g = x.g; ch++; } }); return ch; }
// Classify a ledger entry for a contest: null = outside the contest (dates / before joining). Else the bet as the group sees it, ok = counts.
function judge(c, e, id, rv, now, from) {
  const s = e.s || {}, R = e.r || {}, k = kicksOf(s, R), r = c.rules;
  const sday = okDay(String(s.day || '').slice(0, 10)) ? String(s.day).slice(0, 10) : '';
  const d = k.min != null ? chiDay(k.min) : sday;
  if (!d) return null;
  if (k.min != null) { if (k.min < from || d < c.startDay || d > c.endDay) return null; } else if (d < chiDay(from) || d < c.startDay || d > c.endDay) return null;
  const type = s.kind === 'parlay' ? 'parlay' : s.kt ? GR.ktType(s.kt) : s.kind === 'prop' ? 'prop' : (s.type === 'sp' ? 'sp' : s.type === 'ou' || s.type === 'tot' ? 'ou' : 'ml');
  const g = e.g, h = e.h, srv = !!(g && g.res), stake = Math.round(N(s.stake) * 100) / 100;
  const out = { id: String(id).slice(0, 60), d, what: lbl(s), type, kalshi: s.src === 'kalshi', stake, kick: k.min, last: k.max, gr: '', res: '', vis: false, gl: !!e.gl, vr: (e.g && e.g.vr) || '' };
  // G6 + fix 3 + fix 9: every game known -> shown once the LAST one kicked off (a parlay stays hidden even after a leg lost); any unknown kickoff -> hidden until the bet is graded settled
  out.vis = k.all ? now >= k.max : (!k.any.length || now >= Math.max(...k.any)) && (srv || (!!(h && h.res) && !!sday && now > chiEnd(sday)));
  const no = (why) => Object.assign(out, { why });
  if (r.kalshi && !out.kalshi) return no('Kalshi-tagged bets only');
  if (!r.types[type]) return no('This kind of bet does not count here');
  if (type === 'parlay' && legsOf(s).length > r.legs) return no('More than ' + r.legs + ' legs');
  if (k.min != null && e.f >= k.min) return no('Synced after the game started');
  if (rv && rv.x && !srv) {
    if (rv.sport) return no(rv.x);
    if (!r.honor) return no("Oddable can't check this bet (" + rv.x + ')');
    const rl = [...new Set(Object.values(R).map((x) => x.lg).filter(Boolean))]; if (c.sport !== 'all' && (rl.length ? !(rl.length === 1 && rl[0] === c.sport) : claimSport(s) !== c.sport)) return no('Not ' + SPORTN[c.sport]);
    if (k.min == null && e.f > chiEnd(sday)) return no('Synced after its day was over');
  }
  let res = '', pl = 0;
  if (srv) { res = g.res; pl = g.pl; out.gr = 'srv'; }
  else if (rv && rv.x && r.honor && h && h.res && (k.all ? now >= k.max : !!sday && now > chiEnd(sday))) { res = h.res; pl = h.pl; out.gr = 'honor'; } // round 2: never before the game kicked off
  else if (rv && rv.x && r.honor) out.gr = 'honor';
  out.res = res; const capv = r.cap || NOCAP, cs = stake > capv ? capv : stake;
  out.cs = cs; out.capped = cs < stake; out.pl = res ? Math.round((stake > 0 ? pl * cs / stake : 0) * 100) / 100 : 0;
  out.u = res === 'won' ? Math.round((stake > 0 ? pl / stake : 0) * 1000) / 1000 : res === 'lost' ? -1 : 0;
  out.ok = true; out.f = e.f; const mk1 = mktOf(s, R); if (mk1) { out.mkt = mk1.k; out.ms = mk1.side; } return out;
}
// Round 2: the market and side of a single bet, to find a member's hedges (both sides of one market). null for parlays / props / unresolved.
function mktOf(s, R) { if (s.kind === 'parlay' || (s.kind === 'prop' && !s.kt)) return null; const r = R[GR.legKey(s)]; if (!r || !r.gid || !r.kind || r.kind === 'prop') return null;
  let side = r.kind === 'ou' ? (r.ks || r.ovr ? 'over' : 'under') : r.side; /* a Kalshi total is "over N": YES = over */ if (r.ks === 'no') side = r.kind === 'ou' ? (side === 'over' ? 'under' : 'over') : side === 'home' ? 'away' : 'home';
  return side ? { k: r.lg + '|' + r.gid + '|' + (r.kind === 'sp' ? 'sp' : r.kind), side } : null; }
function hedges(list) { const first = {}; list.filter((x) => x.ok && x.mkt).sort((a, b) => (a.f - b.f) || (a.id < b.id ? -1 : 1)).forEach((x) => { if (!first[x.mkt]) first[x.mkt] = x.ms; else if (first[x.mkt] !== x.ms) Object.assign(x, { ok: false, why: 'Hedge, not counted: the other side of a bet you already have on this game', res: x.res, pl: 0 }); }); return list; }
// "Most bets per week": per member and contest week, only the first N counted bets (by the server's first-seen time, then id) count.
function weekCap(c, list) { const n = Number(c.rules.maxBets) || 0; if (!n) return list; const seen = {};
  list.filter((x) => x.ok).sort((a, b) => (a.f - b.f) || (a.id < b.id ? -1 : 1)).forEach((x) => { const w = weekOf(c, x.d); seen[w] = (seen[w] || 0) + 1; if (seen[w] > n) Object.assign(x, { ok: false, over: 1, why: 'Over the weekly limit: only the first ' + n + ' bets you add for a week count', pl: 0 }); }); return list; }
// The sport a bet SAYS it is on (honor-system bets the server could not match to a game): its league, a Kalshi ticker, else football by team abbreviation.
function claimSport(s) { const ls = legsOf(s).map((l) => GR.normLg(l.lg || s.lg) || GR.ktLeague(l.kt || s.kt) || ((l.home || l.away) ? (GR.NFLAB.has(String(l.home).toUpperCase()) || GR.NFLAB.has(String(l.away).toUpperCase()) ? 'nfl' : 'ncaaf') : '')); const u = [...new Set(ls)]; return u.length === 1 ? u[0] : ''; }
const lbl = (b) => cleanName(String(b.text || (b.kind === 'parlay' ? (Array.isArray(b.legs) ? b.legs.length : 0) + '-leg parlay' : (b.side || '?') + ' ' + (b.type === 'ou' || b.type === 'tot' ? b.line : b.line ? (b.line > 0 ? '+' : '') + b.line : 'ML') + (b.away && b.home ? ' (' + b.away + '@' + b.home + ')' : ''))), 90);

// Read every member's synced bets, update the contest ledger, grade from ESPN, and return the judged bets per member. Cached 60 s per contest.
const CACHE = new Map(), USEM = new Map(); // USEM: last enterprise player count recorded per contest (write only on change)
async function contestBets(g, c, ctx) {
  const key = g.id + ':' + c.cid, hit = CACHE.get(key);
  if (hit && D.now() - hit.at < 60e3 && hit.u === g.u) return hit.v;
  ctx = ctx || {}; ctx.rows = ctx.rows || new Map(); if (ctx.budget == null) ctx.budget = 40;
  const now = D.now(), allowed = leaguesOf(c.sport), mem = inContest(c, g);
  let led = null; try { led = await D.S.dbGet(LK(g.id, c.cid)); } catch (e) {}
  const L0 = clone((led && led.data) || { b: {} }); L0.b = L0.b || {};
  const rowOf = (sid) => { if (!ctx.rows.has(sid)) ctx.rows.set(sid, D.S.dbGet(sid).catch(() => null)); return ctx.rows.get(sid); };
  const rows = await pmap(mem, 8, async (m) => (m.sid ? rowOf(m.sid) : null));
  const minDay = GR.addDay(c.startDay, -2), obs = [], RV = {};
  // 1. observe live bets (skip bets clearly older than the contest)
  for (let i = 0; i < mem.length; i++) {
    const m = mem[i], row = rows[i]; if (!row) continue; const bets = (row.data && Array.isArray(row.data.bets)) ? row.data.bets : [], U = Number(row.updated) || now;
    for (const b of bets) {
      if (!b || b.id == null) continue; if (!(Number(b.gl) > 0) && b.src !== 'kalshi') continue; // G16: only bets saved to the server when added (/groups/bet/add) count; a phone-only (offline / personal) bet never does. Kalshi-tagged bets come in through the Kalshi sync.
      const id = String(b.id).slice(0, 60), s = snap(b), known = L0.b[m.pid] && L0.b[m.pid][id];
      const dd = String(b.day || '').slice(0, 10), kp = b.kt ? GR.parseKt(b.kt) : null; if (!known && okDay(dd) && dd < minDay && !(kp && kp.day >= minDay)) continue;
      const o = { pid: m.pid, id, s, U, sa: Number(b.sa) > 0 ? Number(b.sa) : 0, gl: Number(b.gl) > 0 ? Number(b.gl) : 0, R: {} }; /* sa = the server's own arrival stamp for this bet id (sync.js merge) */ if (b.kind === 'prop' || b.kind === 'parlay' || b.cash != null || c.rules.honor) { const h = phoneResult(b); if (h) o.h = h; }
      obs.push(o);
    }
  }
  // 2. resolve each leg's game (kickoff, league) for live copies and frozen copies; a stored resolution is never looked up again
  const work = []; obs.forEach((o) => work.push({ pid: o.pid, id: o.id, s: o.s, o })); const live = new Set(obs.map((o) => o.pid + '|' + o.id)); Object.keys(L0.b).forEach((pid) => { if (!mem.some((m) => m.pid === pid)) return; Object.keys(L0.b[pid]).forEach((id) => { const e = L0.b[pid][id]; if (!e.g) work.push({ pid, id, s: e.s, e, o: live.has(pid + '|' + id) ? obs.find((o) => o.pid === pid && o.id === id) : null }); }); });
  const RESP = {}, RES = {}; // legKey -> resolution promise / result (failures too, this pass only)
  const resolve = (leg, k, d) => RESP[k] || (RESP[k] = GR.resolveLeg(leg, allowed, ctx, d).catch(() => ({ key: k, x: 'Bet Oddable cannot read' })).then((r) => (RES[k] = r))); // one odd bet never breaks the standings
  await pmap(work, 6, async (w) => {
    const s = w.s || {}, e = w.e || (L0.b[w.pid] && L0.b[w.pid][w.id]), stored = (e && e.r) || {}, ls = legsOf(s);
    if (!w.o) { w.o = { pid: w.pid, id: w.id, U: now, R: {} }; obs.push(w.o); } // a frozen copy (bet maybe deleted on the phone): only its resolutions are added
    for (let j = 0; j < ls.length; j++) {
      const leg = s.kind === 'parlay' ? Object.assign({ lg: s.lg }, ls[j]) : s, k = GR.legKey(leg);
      if (stored[k]) { w.o.R[k] = stored[k]; continue; }
      const r = await resolve(leg, k, String(s.day || '').slice(0, 10)); if (!r.x) w.o.R[k] = GR.store(r);
    }
  });
  // 3. ledger: apply observations, then grade frozen copies whose games are final
  const L = clone(L0); let ch = applyObs(L, obs, now);
  const grades = [];
  await pmap(Object.keys(L.b).filter((pid) => mem.some((m) => m.pid === pid)).flatMap((pid) => Object.keys(L.b[pid]).map((id) => [pid, id])), 6, async ([pid, id]) => {
    const e = L.b[pid][id]; if (e.g) return; const s = e.s || {}; const ks = legKeys(s), rv = { x: '' };
    const legs = []; for (const k of ks) { const st = e.r[k]; if (!st) { const r = RES[k]; legs.push(r && r.x ? r : { x: 'Game not found yet' }); continue; } legs.push(await GR.withGame(st, ctx)); }
    let gb; try { gb = GR.gradeBet(s, legs, { maxOdds: c.rules.maxOdds || 500 }); } catch (er) { gb = { x: 'Bet Oddable cannot read' }; } if (gb.x) { rv.x = gb.x; rv.sport = /sport/.test(gb.x) || !!gb.far; } else if (gb.res) grades.push({ pid, id, g: Object.assign({ res: gb.res, pl: gb.pl, at: now }, gb.vr ? { vr: gb.vr } : {}), sj: JSON.stringify(s) });
    RV[pid + '|' + id] = rv;
  });
  ch += applyGrades(L, grades);
  if (ch) { // write the ledger: on a conflict, redo on the fresh copy (applyObs/applyGrades are repeatable)
    try { await rmw(LK(g.id, c.cid), { b: {} }, async (x) => { x.b = x.b || {}; applyObs(x, obs, now); applyGrades(x, grades); return {}; }, 8); } catch (e) { console.error('groups: ledger', e.message); }
  }
  // 4. judge every ledger bet for each member
  const out = {};
  mem.forEach((m) => { const from = Math.max(c.start, m.joined || 0), P = L.b[m.pid] || {}; out[m.pid] = weekCap(c, hedges(Object.keys(P).map((id) => { try { return judge(c, P[id], id, RV[m.pid + '|' + id], now, from); } catch (er) { return null; } }).filter(Boolean))); });
  if (now >= c.start && g.owner && USEM.get(g.id + ':' + c.cid) !== mem.length) USEM.set(g.id + ':' + c.cid, mem.length), LIM.recordUse(g.owner, g.id + ':' + c.cid, mem.length, g.name + ' · ' + c.name).catch(() => {}); // G15: enterprise usage counter (no-op for standard accounts)
  CACHE.set(key, { at: D.now(), u: g.u, v: out }); if (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value);
  return out;
}

// ---------- G16: group bets save to the server when added, then are locked (owner, Nov 16 2026) ----------
// The phone calls /groups/bet/add BEFORE it keeps a new bet while its player is in a running or upcoming group contest. The server writes the bet straight into
// the player's synced-bets row with `sa` = `gl` = the server's time; sync.js then keeps that copy forever (no edit, swap or delete from any phone). If this call
// fails the phone does not keep the bet ("Not saved, try again"): there are no local-only group bets. A bet the server did not save this way never counts.
const LOCKED_MSG = 'Group bets lock when you add them: they cannot be edited, deleted or swapped, even before kickoff. The commissioner can only void a bet under the void rules (a postponed or cancelled game), and the reason is shown to everyone.';
RLIM.bet = [60, 600e3, 120, 600e3];
const BETKEYS = ['id', 'kind', 'type', 'side', 'line', 'odds', 'mult', 'stake', 'lg', 'gid', 'day', 'home', 'away', 'week', 'text', 'note', 'appSu', 'appConf', 'appAts', 'appLine', 'noApp', 'pp', 'legs', 'pay'];
function cleanBet(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad(400, 'No bet');
  if (x.src === 'kalshi' || x.kt) throw bad(400, 'Kalshi bets come in through the Kalshi sync');
  const id = String(x.id || ''); if (!/^[A-Za-z0-9_.-]{2,60}$/.test(id)) throw bad(400, 'Bad bet id');
  const o = {}; BETKEYS.forEach((k) => { if (x[k] !== undefined && x[k] !== null) o[k] = x[k]; });
  if (o.kind !== undefined && !['parlay', 'prop'].includes(o.kind)) throw bad(400, 'Unknown kind of bet');
  if (o.kind === 'parlay' && !(Array.isArray(o.legs) && o.legs.length >= 2 && o.legs.length <= 12)) throw bad(400, 'A parlay needs 2 to 12 legs');
  const st = Number(o.stake); if (!(Number.isFinite(st) && st > 0 && st <= 1e6)) throw bad(400, 'Enter the stake: group bets need one');
  o.stake = Math.round(st * 100) / 100; if (o.line != null && !Number.isFinite(Number(o.line))) throw bad(400, 'Bad line');
  if (!okDay(String(o.day || ''))) throw bad(400, 'Bad day');
  const j = JSON.stringify(o); if (j.length > 8000) throw bad(413, 'Bet too big'); return JSON.parse(j);
}
async function inRunning(u, now) { // the groups (with a picks contest not yet over) this player is a member of
  const mi = await D.S.dbGet(MK(u.mk)).catch(() => null), x = (mi && mi.data) || {}, ids = [...new Set([...(x.g || []), ...Object.keys(x.own || {})])].slice(-60);
  const gs = (await pmap(ids, 6, (id) => gread(id).catch(() => null))).filter((g) => g && memberOf(g, u.mk));
  return gs.filter((g) => g.contests.some((c) => c.kind === 'picks' && !cEnded(c, now) && inContest(c, g).some((m) => m.mk === u.mk)));
}
async function betAdd(u, ip, raw, now) {
  rate('bet', u.mk, ip); const bet = cleanBet(raw);
  const sid = await sidOf(u.e, true); if (!sid) throw bad(409, 'Turn on sync (sign in with your phone number) to add group bets');
  const gs = await inRunning(u, now); if (!gs.length) throw bad(409, 'You are not in a running group contest');
  return serial(sid, async () => { for (let i = 0; i < 8; i++) {
    const row = await D.S.dbGet(sid); if (!row) throw bad(409, 'Turn on sync (sign in with your phone number) to add group bets');
    const data = clone(row.data || {}); data.bets = Array.isArray(data.bets) ? data.bets : [];
    if (data.bets.some((y) => y && String(y.id) === bet.id) || (Array.isArray(data.tomb) && data.tomb.map(String).includes(bet.id))) throw bad(409, LOCKED_MSG);
    data.bets.push(Object.assign({}, bet, { t: now, sa: now, gl: now }));
    if (await D.S.dbPatchIf(sid, row.updated, data, Math.max(now, Number(row.updated || 0) + 1))) { gs.forEach((g) => g.contests.forEach((c) => CACHE.delete(g.id + ':' + c.cid))); return { ok: true, id: bet.id, gl: now, sa: now, groups: gs.length, text: 'Saved to your group. Locked.' }; }
    await D.sleep(3 + Math.random() * 20);
  }
  throw bad(409, 'Not saved, try again'); });
}

// ---------- P1: partner suggestions (owner, Nov 16 2026). The pairing itself is the shared odds-api/pairing.js; this only gathers the group's people. ----------
// Strength of each member: a number the asker typed (vals), else D.profile(accountId, sport) -> {hcp?, rating?, winPct?}. D.profile asks the stats module for
// `pairingProfile` (to be added by the stats coder so it can respect each player's sharing/consent switch); until then it returns nothing and people type
// the numbers. Team history: D.teamHistory(group, sport) -> [{date, team:[pid], result}] (golf / events engines plug in; empty by default).
// IT ONLY SUGGESTS: nothing is saved.
const PAIR = require('./pairing');
D.profile = async (e, sport) => { try { const st = require('./stats'); if (typeof st.pairingProfile === 'function') return (await st.pairingProfile(e, sport)) || {}; } catch (er) {} return {}; };
D.teamHistory = async () => [];
RLIM.partners = [60, 600e3, 120, 600e3];
async function partners(u, b) {
  if (limit('partners|a|' + u.mk, RLIM.partners[0], RLIM.partners[1])) throw bad(429, 'Too many tries. Wait a few minutes.');
  const g = await gread(b.id); if (!g || !canSee(g, u.mk)) throw bad(404, 'Group not found');
  const sport = ['golf', 'pickleball', 'other'].includes(b.sport) ? b.sport : 'golf', key = sport === 'golf' ? 'hcp' : 'rating', nm = await names();
  const want = Array.isArray(b.pids) && b.pids.length ? new Set(b.pids.map(String)) : null, vals = (b.vals && typeof b.vals === 'object') ? b.vals : {};
  const okv = (v) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && (sport === 'golf' ? n >= -10 && n <= 54 : n >= 0 && n <= 4000) ? n : null; };
  const A = D.acct(), mem = g.members.filter((m) => !want || want.has(m.pid)).slice(0, 200);
  const players = await pmap(mem, 6, async (m) => { const o = { id: m.pid, name: shownName(m, nm) }, typed = okv(vals[m.pid]);
    if (typed !== null) o[key] = typed; else if (m.sid) { let pr = {}; try { pr = (await D.profile(A.phoneEmail(m.sid), sport)) || {}; } catch (e) {} ['hcp', 'rating', 'winPct'].forEach((k) => { if (okv(pr[k]) !== null || (k === 'winPct' && Number.isFinite(Number(pr[k])))) o[k] = Number(pr[k]); }); }
    return o; });
  (Array.isArray(b.guests) ? b.guests : []).slice(0, 40).forEach((x, i) => { const name = cleanName(x && x.name, 24); if (!name) return; const o = { id: 'guest' + i, name, guest: true }, v = okv(x.val); if (v !== null) o[key] = v; players.push(o); });
  let history = []; try { history = (await D.teamHistory(g, sport)) || []; } catch (e) {}
  const list = PAIR.suggestPartners(players, { mode: b.mode, teamSize: b.teamSize, sport, history, top: 3 });
  const out = { mode: list.mode, teamSize: list.teamSize, sport, note: list.note, suggestions: list.map((x) => ({ rank: x.rank, reason: x.reason, spread: x.spread, repeats: x.repeats, teams: x.teamInfo.map((tm) => ({ names: tm.names, label: tm.label, strength: tm.strength })), sitOutNames: x.sitOutNames })) };
  return Object.assign(out, { players: players.map((p) => ({ id: p.id, name: p.name, guest: !!p.guest, has: p[key] != null })), only: 'These are suggestions. People choose their own partners.', unit: sport === 'golf' ? 'Oddable Handicap Index' : 'Oddable rating' });
}

// ---------- scoring, ranking, prizes ----------
function score(c, list, scope, week, now) {
  const r = c.rules, curW = Math.max(1, weekOf(c, chiDay(Math.min(Math.max(now, c.start), chiEnd(c.endDay))))), lastW = weekOf(c, c.endDay);
  let use = list.filter((x) => x.ok); if (scope === 'week') use = use.filter((x) => weekOf(c, x.d) === week);
  const byW = {}; use.forEach((x) => { (byW[weekOf(c, x.d)] = byW[weekOf(c, x.d)] || []).push(x); });
  const perBet = (x) => (r.metric === 'units' || r.metric === 'pct' ? x.u : x.pl);
  let counted = [];
  Object.keys(byW).forEach((w) => { const s = byW[w].filter((x) => x.res); if (c.fmt === 'best5') { s.sort((a, b) => perBet(b) - perBet(a) || a.id.localeCompare(b.id)); s.slice(0, 5).forEach((x) => (x.best = 1)); counted = counted.concat(s.slice(0, 5)); } else counted = counted.concat(s); });
  const t = { w: 0, l: 0, p: 0, open: 0, win: 0, units: 0, stake: 0, n: use.length };
  counted.forEach((x) => { if (x.res === 'won') t.w++; else if (x.res === 'lost') t.l++; else t.p++; t.win += x.pl; t.units += x.u; t.stake += x.cs; });
  use.forEach((x) => { if (!x.res) t.open++; });
  t.win = Math.round(t.win * 100) / 100; t.units = Math.round(t.units * 100) / 100; t.stake = Math.round(t.stake * 100) / 100;
  t.ret = t.stake > 0 ? Math.round(t.win / t.stake * 1000) / 10 : null; t.pct = t.w + t.l ? Math.round(t.w / (t.w + t.l) * 1000) / 10 : null;
  t.val = r.metric === 'win' ? t.win : r.metric === 'units' ? t.units : r.metric === 'ret' ? t.ret : t.pct;
  t.settled = list.filter((x) => x.ok && x.res).length; t.minOk = t.settled >= (r.minPaid || 0); // fix 7: fewest bets to place in a paid spot (whole contest)
  const wk = scope === 'week' ? week : Math.min(curW, lastW), nThis = list.filter((x) => x.ok && weekOf(c, x.d) === wk).length;
  t.weekBets = nThis; t.short = r.minBets > 0 && now >= c.start && nThis < r.minBets;
  const st = list.filter((x) => x.ok && x.res && x.res !== 'push').sort((a, b) => (b.kick || chiStart(b.d)) - (a.kick || chiStart(a.d)));
  let k = 0; while (k < st.length && st[k].res === st[0].res) k++; t.streak = st.length ? (st[0].res === 'won' ? 'W' : 'L') + k : '';
  t.weeks = {}; Object.keys(byW).forEach((w) => { const s = byW[w].filter((x) => x.res); const v = (c.fmt === 'best5' ? s.filter((x) => x.best) : s); t.weeks[w] = { n: byW[w].length, val: Math.round(v.reduce((a, x) => a + perBet(x), 0) * 100) / 100, short: r.minBets > 0 && byW[w].length < r.minBets }; });
  return t;
}
// Rank: members who meet "fewest bets to place" first; then the ranking metric; ties go to Return %; still tied = same place (prize money split, see prizes).
function rank(rows) {
  const v = (x) => (x.t.val == null ? -Infinity : x.t.val), rr = (x) => (x.t.ret == null ? -Infinity : x.t.ret);
  rows.sort((a, b) => (b.t.minOk - a.t.minOk) || v(b) - v(a) || rr(b) - rr(a) || (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0)); // pid order is random, never alphabetical
  rows.forEach((x, i) => { const p = rows[i - 1]; x.place = p && p.t.minOk === x.t.minOk && v(p) === v(x) && rr(p) === rr(x) ? p.place : i + 1; x.tied = false; x.under = !x.t.minOk; });
  rows.forEach((x) => { x.tied = rows.filter((y) => y.place === x.place).length > 1; });
  return rows;
}
// Who is owed what if the contest ended now: paid places go to members who meet the minimum and have a settled counted bet.
// Members tied on the metric AND Return % split the money of the places they cover evenly, in cents; leftover cents go to the higher place first.
function prizes(rows, places) {
  const elig = rows.filter((x) => x.t.minOk && x.t.settled > 0); const owed = {}; let i = 0;
  while (i < elig.length && i < places.length) {
    let j = i; while (j + 1 < elig.length && elig[j + 1].place === elig[i].place) j++;
    const cover = places.slice(i, Math.min(j + 1, places.length)), totC = cover.reduce((a, p) => a + p.c, 0), n = j - i + 1, each = Math.floor(totC / n); let left = totC - each * n;
    for (let k = i; k <= j; k++) { owed[elig[k].pid] = (each + (left > 0 ? 1 : 0)) / 100; if (left > 0) left--; }
    i = j + 1;
  }
  return owed;
}
async function standings(g, c, scope, week, ctx) {
  const now = D.now(), mb = await contestBets(g, c, ctx), nm = await names();
  const rows = inContest(c, g).map((m) => ({ pid: m.pid, name: shownName(m, nm), t: score(c, (mb[m.pid] || []).map((x) => Object.assign({}, x)), scope, week, now), noBets: !m.sid }));
  rank(rows); const owed = prizes(rows, prizeOf(g, c)); rows.forEach((x) => { x.owed = owed[x.pid] || 0; });
  const lastW = weekOf(c, c.endDay), curW = Math.max(1, Math.min(lastW, weekOf(c, chiDay(Math.max(now, c.start)))));
  const hs = []; for (let w = 1; w <= Math.min(curW, lastW); w++) { let best = null; rows.forEach((x) => { const s = x.t.weeks[w]; if (!s || s.short || !s.n) return; if (!best || s.val > best.val) best = { week: w, pid: x.pid, name: x.name, val: s.val, n: s.n }; }); const done = now > chiEnd(weekDays(c, w)[1]); if (best) hs.push(Object.assign(best, { done })); }
  return { rows, curW, lastW, high: hs };
}

// ---------- views (what each person may see) ----------
function cpub(c, g, now, pid) {
  const o = { cid: c.cid, kind: c.kind, name: c.name, pot: c.pot, sport: c.sport, sportName: SPORTN[c.sport] || '', started: cStarted(c, now), ended: cEnded(c, now), locked: cStarted(c, now) };
  if (c.kind === 'calcutta') return Object.assign(o, { event: c.event, lots: c.lots, payout: c.payout, rules: c.rules, status: c.status });
  if (c.kind !== 'picks') return Object.assign(o, { type: c.type, ref: c.ref, rules: { entry: c.rules.entry || 0 }, in: c.pot === 'side' && pid ? (c.inn || []).includes(pid) : undefined });
  Object.assign(o, { fmt: c.fmt, start: c.start, startDay: c.startDay, endDay: c.endDay, runs: c.runs, rules: c.rules, takeText: c.pot === 'side' ? takeText(c.rules.take) : '', weeks: weekOf(c, c.endDay), count: inContest(c, g).length });
  if (c.pot === 'side') o.in = pid ? (c.inn || []).includes(pid) : undefined;
  return o;
}
function pub(g, now) {
  return { id: g.id, name: g.name, join: g.join, count: g.members.length, commName: (g.members.find((m) => m.mk === g.comm) || {}).name || '', takeText: takeText(g.money.take), money: { take: g.money.take, msplit: g.money.msplit },
    start: gStart(g), started: started(g, now), ended: ended(g, now), joinUntil: joinOpenUntil(g), engaged: engaged(g), contests: g.contests.map((c) => cpub(c, g, now)), pots: pots(g) };
}
function full(g, mk, now) {
  const o = pub(g, now), comm = isComm(g, mk), mine = memberOf(g, mk); o.role = comm ? 'comm' : 'member'; o.code = g.code; o.me = (mine || {}).pid;
  o.contests = g.contests.map((c) => cpub(c, g, now, o.me));
  o.members = g.members.map((m) => ({ pid: m.pid, name: m.name, paid: !!m.paid, comm: m.mk === g.comm, joined: m.joined, noBets: !m.sid, sides: sideOf(g).filter((c) => (c.inn || []).includes(m.pid)).map((c) => ({ cid: c.cid, paid: !!(c.paid || {})[m.pid] })) }));
  o.capText = LIM.CAP_TEXT; o.entText = LIM.ENTERPRISE_TEXT;
  if (comm) o.reqs = (g.reqs || []).map((q) => ({ pid: q.pid, name: q.name, at: q.at, ver: q.ver, noBets: !q.sid }));
  o.reqCount = (g.reqs || []).length; return o;
}
const canSee = (g, mk) => !!memberOf(g, mk) || isComm(g, mk);
const cfind = (g, cid) => { const c = g.contests.find((x) => x.cid === String(cid || '')); if (!c) throw bad(404, 'Contest not found'); return c; };

// ---------- routes ----------
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (!path.startsWith('/groups')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  try {
    const b = await body(req), ip = D.ip(req), now = D.now(), op = path.slice(8);
    if (op === 'invite') { // G14 public invite preview: ONLY the title and kind, for the sign-up banner. Rate-limited per IP; one answer for every bad link.
      if (codeBlocked('c|i|' + ip) || limit('inv|i|' + ip, RLIM.invite[2], RLIM.invite[3])) throw bad(429, 'Too many tries. Wait a few minutes.');
      const type = String(b.type || ''), code = String(b.code || '').slice(0, 40), fn = INVITE[type];
      const out = fn ? await fn(code, now).catch(() => null) : null;
      if (!out) { if (fn) codeFail('c|i|' + ip); throw bad(404, fn ? 'This invite link is not valid or has expired.' : 'This kind of game is coming soon to Oddable.'); }
      send(res, 200, { type, kind: out.kind, title: cleanName(out.title, 40) }); return true;
    }
    const u = await me(req);
    if (op === 'limits') { const ak = LIM.keyOf(u.e); send(res, 200, { max: await LIM.maxPeople(ak, ''), enterprise: await LIM.isEnterprise(ak), standard: LIM.STANDARD, capText: LIM.CAP_TEXT, text: LIM.ENTERPRISE_TEXT }); return true; }
    if (op === 'ent/contact') { send(res, 200, await LIM.contact(u.e, ip, b)); return true; }
    if (op === 'ent/admin') { if (!D.acct().ownerOk(req)) throw bad(403, 'Owner only'); const out = await LIM.admin(b);
      if (b.op === 'seats' && /^[A-Z2-9]{10}$/.test(String(b.id || '')) && out.extraSeats > 0) { const want = Math.min(LIM.CEILING(), LIM.STANDARD + out.extraSeats); try { await gmut(String(b.id), (g) => { if (g.join.max >= want) return { nochange: true }; g.join.max = want; g.u = now; return {}; }); out.groupMax = want; } catch (e) { if (e.status !== 404) throw e; } } // round 2: the owner's extra seats also raise the group's own max
      send(res, 200, out); return true; }
    if (op === 'bet/add') { send(res, 200, await betAdd(u, ip, b.bet, now)); return true; } // G16
    if (op === 'bet/status') { const sid = await sidOf(u.e, true); send(res, 200, { betLock: (await inRunning(u, now)).length, canBet: !!sid }); return true; } // light: does this player's next bet go to a group?
    if (op === 'bet/edit' || op === 'bet/delete' || op === 'bet/swap') throw bad(409, LOCKED_MSG); // G16: never, even before kickoff
    if (op === 'partners') { send(res, 200, await partners(u, b)); return true; } // P1
    if (op === 'mine') {
      const mi = await D.S.dbGet(MK(u.mk)), x = (mi && mi.data) || {}, ids = [...new Set([...(x.g || []), ...Object.keys(x.own || {})])].slice(-60), qs = (x.q || []).slice(-60);
      const sid = await sidOf(u.e, true), ctx = { rows: new Map(), budget: 60 };
      const gs = (await pmap(ids, 6, (id) => gread(id).catch(() => null))).filter(Boolean);
      const mine = [], stale = [];
      for (const g of gs) { const m = memberOf(g, u.mk); if (!m) { stale.push(g.id); continue; } if (sid && m.sid !== sid) { try { await gmut(g.id, (gg) => { const mm = memberOf(gg, u.mk); if (!mm || mm.sid === sid) return { nochange: true }; mm.sid = sid; mm.fixedName = fixed(u.e, sid); gg.u = now; return {}; }); m.sid = sid; } catch (e) {} } mine.push(g); }
      if (stale.length) memIdx(u.mk, (y) => { y.g = y.g.filter((i) => !stale.includes(i)); stale.forEach((i) => delete y.own[i]); });
      const out = await pmap(mine, 4, async (g) => { const o = full(g, u.mk, now); o.mineC = {};
        await pmap(g.contests.filter((c) => c.kind === 'picks' && cStarted(c, now) && inContest(c, g).some((m) => m.mk === u.mk)), 3, async (c) => { try { const s = await standings(g, c, 'season', null, ctx); const r0 = s.rows.find((r) => r.pid === o.me); o.mineC[c.cid] = { place: r0 ? r0.place : null, of: s.rows.length, t: r0 ? Object.assign({}, r0.t, { weeks: undefined }) : null, owed: r0 ? r0.owed : 0, curW: s.curW }; } catch (e) {} });
        return o; });
      const pend = (await pmap(qs, 6, (id) => gread(id).catch(() => null))).filter((g) => g && (g.reqs || []).some((q) => q.mk === u.mk)).map((g) => ({ id: g.id, name: g.name }));
      const ix = await D.S.dbGet(IDX).catch(() => null), I = (ix && ix.data && ix.data.g) || {};
      const oids = Object.keys(I).filter((id) => I[id].o && now < I[id].jc && !ids.includes(id) && !pend.some((p) => p.id === id)).sort((a, c2) => I[a].s - I[c2].s).slice(0, 30);
      const open = (await pmap(oids, 6, (id) => gread(id).catch(() => null))).filter((g) => g && g.join.open && g.join.requests && !ended(g, now) && now < joinOpenUntil(g) && g.members.length < g.join.max && !(g.denied || []).includes(u.mk) && !memberOf(g, u.mk)).map((g) => pub(g, now));
      out.sort((a, c2) => a.start - c2.start);
      const betLock = mine.filter((g) => g.contests.some((c) => c.kind === 'picks' && !cEnded(c, now) && inContest(c, g).some((m) => m.mk === u.mk))).length; // G16: the phone sends new bets to /groups/bet/add while this is > 0
      send(res, 200, { groups: out, open, pending: pend, now, betLock, canBet: !!sid }); return true;
    }
    if (op === 'create') {
      rate('create', u.mk, ip); const ak = LIM.keyOf(u.e), join = cleanJoin(b.join, await LIM.maxPeople(ak, '')), C = cleanContest(Object.assign({}, b.contest || {}, { pot: 'main' }), now, join.max), gname = cleanName(b.name, 30);
      if (gname.length < 2) throw bad(400, 'Give the group a name (2+ characters)');
      const take = cleanTake(b.take, C.rules.entry * join.max);
      const mi = await D.S.dbGet(MK(u.mk)).catch(() => null), own = (mi && mi.data && mi.data.own) || {};
      if (Object.keys(own).filter((id) => own[id] >= chiDay(now)).length >= MAXMINE) throw bad(400, 'You already run ' + MAXMINE + ' groups');
      const ix = await D.S.dbGet(IDX).catch(() => null); if (ix && ix.data && Object.keys(ix.data.g || {}).length >= MAXG) { const I = ix.data.g; const old = Object.keys(I).filter((id) => I[id].e < dstr(dnum(chiDay(now)) - 60)); if (Object.keys(I).length - old.length >= MAXG) throw bad(503, 'Too many groups right now. Try later.'); try { await rmw(IDX, { g: {} }, async (y) => { old.forEach((id) => delete y.g[id]); return {}; }); } catch (e) {} }
      const sid = await sidOf(u.e, true), nm = await nameOf(u.e, sid, b.myName);
      let id; do { id = rnd(10); } while (await D.S.dbGet(GK(id)));
      let code; do { code = newCode(); } while (await D.S.dbGet(CK(code)));
      await D.S.dbPut({ id: CK(code), salt: 'x', pinhash: 'x', data: { id }, updated: now }, true);
      const cid = rnd(6), g = { id, name: gname, code, comm: u.mk, owner: ak, created: now, u: now, engaged: false, members: [], reqs: [], denied: [], join, money: { take, msplit: { kind: 'entry', pct: { [cid]: 100 } } }, contests: [Object.assign({ cid, created: now }, C)] };
      g.members.push({ pid: newPid(g), mk: u.mk, sid, name: nm, joined: now, paid: false, fixedName: fixed(u.e, sid) });
      await D.S.dbPut({ id: GK(id), salt: 'x', pinhash: 'x', data: g, updated: now }, true);
      await memIdx(u.mk, (y) => { y.g.push(id); y.own[id] = gEnd(g); }); await idxPut(g);
      send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'edit') { // group-level: name, joining, main-pot take and split
      const g0 = await gread(b.id), CAPNOW = g0 ? await LIM.maxPeople(g0.owner, g0.id) : 8;
      const g = await gmut(String(b.id || ''), (g) => {
        if (!isComm(g, u.mk)) throw bad(403, 'Only the commissioner can change the rules');
        if (started(g, now)) throw bad(409, 'Rules are locked. The group has started.');
        const name = cleanName(b.name, 30); if (name.length < 2) throw bad(400, 'Give the group a name (2+ characters)');
        const join = cleanJoin(b.join, Math.max(CAPNOW, g.join.max), g.join.max); if (join.max < g.members.length) throw bad(400, 'More members than that already');
        const mainE = mainOf(g).reduce((a, c) => a + (c.rules.entry || 0), 0), take = b.take ? cleanTake(b.take, mainE * join.max) : g.money.take;
        const ms = b.msplit ? cleanMsplit(b.msplit, splitOf(g)) : g.money.msplit;
        if (engaged(g) && (JSON.stringify(take) !== JSON.stringify(g.money.take) || JSON.stringify(ms) !== JSON.stringify(g.money.msplit) || join.max !== g.join.max)) throw bad(409, 'Money rules are locked: people have already joined or asked to join.');
        Object.assign(g, { name, join, u: now }); g.money = { take, msplit: ms }; return g; });
      await idxPut(g); send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'contest/add' || op === 'contest/edit') {
      const g = await gmut(String(b.id || ''), (g) => {
        if (!isComm(g, u.mk)) throw bad(403, 'Only the commissioner can add or change contests');
        const add = op === 'contest/add', old = add ? null : cfind(g, b.cid);
        if (old && cStarted(old, now)) throw bad(409, 'Rules are locked. This contest has started.');
        if (add && g.contests.length >= MAXC) throw bad(400, 'A group can hold up to ' + MAXC + ' contests');
        const pot = add ? (b.contest && b.contest.pot === 'side' ? 'side' : 'main') : old.pot;
        if (b.contest && b.contest.kind === 'calcutta') throw bad(400, 'Calcuttas are coming soon');
        const C = cleanContest(Object.assign({}, b.contest || {}, { pot }), now, g.join.max);
        if (add && pot === 'main' && engaged(g)) throw bad(409, 'The main pot is locked: people have already joined or asked to join. Add this contest as a side pot.');
        if (old && engaged(g)) { const keep = MONEYKEYS.filter((k) => JSON.stringify(C.rules[k]) !== JSON.stringify(old.rules[k])); if (keep.length || C.sport !== old.sport || C.fmt !== old.fmt || DATEKEYS.some((k) => String(C[k]) !== String(old[k]))) throw bad(409, 'Money, bet rules and dates are locked: people have already joined or asked to join. You can still change the name.'); }
        if (add) { const cid = rnd(6); const c = Object.assign({ cid, created: now }, C); if (pot === 'side') { c.inn = [memberOf(g, u.mk).pid]; c.paid = {}; } g.contests.push(c); }
        else { Object.assign(old, C); }
        const mids = splitOf(g).map((c) => c.cid); if (pot === 'main') { g.money.msplit = cleanMsplit(b.msplit || (mids.length === 2 && !['even', 'entry'].includes(g.money.msplit.kind) ? g.money.msplit : { kind: 'entry' }), splitOf(g)); const mainE = mainOf(g).reduce((a, c) => a + (c.rules.entry || 0), 0); if (g.money.take.kind === 'flat' && cents(g.money.take.v) > cents(mainE * g.join.max)) throw bad(400, "The commissioner's take cannot be more than the pot (entries x most members)"); }
        g.u = now; return g; });
      await idxPut(g); await memIdx(u.mk, (y) => { y.own[g.id] = gEnd(g); }); send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'contest/delete') {
      const g = await gmut(String(b.id || ''), (g) => { if (!isComm(g, u.mk)) throw bad(403, 'Only the commissioner can remove a contest'); const c = cfind(g, b.cid); if (cStarted(c, now)) throw bad(409, 'This contest has started'); if (g.contests.length < 2) throw bad(409, 'A group needs at least one contest. Delete the group instead.'); if (c.pot === 'main' && engaged(g)) throw bad(409, 'The main pot is locked: people have already joined or asked to join.'); if (c.pot === 'side' && (c.inn || []).length > 1) throw bad(409, 'Members are in this side pot'); g.contests = g.contests.filter((x) => x !== c); g.money.msplit = cleanMsplit({ kind: 'entry' }, splitOf(g)); g.u = now; return g; });
      await idxPut(g); send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'sidepot') { // a member opts in or out of a side pot, before that contest starts
      const g = await gmut(String(b.id || ''), (g) => { const m = memberOf(g, u.mk); if (!m) throw bad(404, 'Not a member'); const c = cfind(g, b.cid); if (c.pot !== 'side') throw bad(400, 'Not a side pot'); if (cStarted(c, now)) throw bad(409, 'This side pot has started');
        c.inn = c.inn || []; const on = !!b.on; if (on === c.inn.includes(m.pid)) return { nochange: true, v: g }; if (!on && isComm(g, u.mk)) throw bad(409, 'The commissioner stays in their side pot'); if (!on && (c.paid || {})[m.pid]) throw bad(409, 'Your entry is marked paid. Ask the commissioner first.');
        c.inn = on ? c.inn.concat(m.pid) : c.inn.filter((p) => p !== m.pid); g.u = now; return g; });
      send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'get') {
      const g = await gread(b.id); if (!g) throw bad(404, 'Group not found');
      if (canSee(g, u.mk)) { const o = full(g, u.mk, now); o.cap = await capOf(g); send(res, 200, { group: o }); return true; }
      if ((g.join.open && g.join.requests) || (g.reqs || []).some((q) => q.mk === u.mk)) { const o = pub(g, now); o.role = (g.reqs || []).some((q) => q.mk === u.mk) ? 'pending' : 'none'; send(res, 200, { group: o }); return true; }
      throw bad(404, 'Group not found');
    }
    if (op === 'preview' || op === 'join') {
      if (codeBlocked('c|a|' + u.mk) || codeBlocked('c|i|' + ip)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.');
      rate('join', u.mk, ip); const code = normCode(b.code); const fail = () => { codeFail('c|a|' + u.mk); codeFail('c|i|' + ip); return bad(404, 'No group with that code'); };
      if (!code) throw fail();
      const ix = await D.S.dbGet(CK(code)).catch(() => null), gid = ix && ix.data && ix.data.id; if (!gid) throw fail();
      let g = await gread(gid); if (!g || g.code !== code) throw fail();
      if (op === 'preview' && !canSee(g, u.mk) && (ended(g, now) || now >= joinOpenUntil(g))) throw bad(404, 'This invite link is not valid or has expired.');
      if (op === 'preview') { const o = canSee(g, u.mk) ? full(g, u.mk, now) : pub(g, now); if (!canSee(g, u.mk)) o.role = 'none'; send(res, 200, { group: o }); return true; }
      const sid = await sidOf(u.e, true), nm = await nameOf(u.e, sid, b.myName), cap = await capOf(g);
      g = await gmut(gid, (g) => { if (memberOf(g, u.mk)) return { nochange: true, v: g };
        if (ended(g, now) || now >= joinOpenUntil(g)) throw bad(409, g.join.late === '2w' ? 'Joining closed 2 weeks after the start' : 'Joining closed at the first kickoff');
        if (g.members.length >= cap) throw bad(409, fullMsg(cap));
        g.members.push({ pid: newPid(g), mk: u.mk, sid, name: nm, joined: now, paid: false, fixedName: fixed(u.e, sid) }); g.reqs = (g.reqs || []).filter((q) => q.mk !== u.mk); g.engaged = true; g.u = now; return g; });
      await memIdx(u.mk, (y) => { y.g.push(g.id); y.q = y.q.filter((i) => i !== g.id); });
      send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'request') {
      rate('join', u.mk, ip); const sid = await sidOf(u.e, true), nm = await nameOf(u.e, sid, b.myName); let ver = false;
      if (sid) { try { const row = await D.S.dbGet(sid); ver = ((row && row.data && row.data.bets) || []).some((x) => x && x.src === 'kalshi' && x.kt); } catch (e) {} }
      const gq = await gread(b.id), cap = gq ? await capOf(gq) : 8;
      await gmut(String(b.id || ''), (g) => { if (memberOf(g, u.mk)) throw bad(409, 'You are already in this group');
        if (!g.join.requests) throw bad(409, 'This group is not taking requests');
        if ((g.denied || []).includes(u.mk)) throw bad(409, 'The commissioner said no to this group');
        if (ended(g, now) || now >= joinOpenUntil(g)) throw bad(409, 'Joining is closed');
        if (g.members.length >= cap) throw bad(409, fullMsg(cap));
        if ((g.reqs || []).some((q) => q.mk === u.mk)) return { nochange: true };
        if ((g.reqs || []).length >= 100) throw bad(409, 'Too many requests waiting');
        g.reqs = g.reqs || []; g.reqs.push({ pid: newPid(g), mk: u.mk, sid, name: nm, at: now, ver, fixedName: fixed(u.e, sid) }); g.engaged = true; g.u = now; return {}; });
      await memIdx(u.mk, (y) => { y.q.push(String(b.id)); });
      send(res, 200, { ok: true, pending: true }); return true;
    }
    if (op === 'cancel') { await gmut(String(b.id || ''), (g) => { const n = (g.reqs || []).length; g.reqs = (g.reqs || []).filter((q) => q.mk !== u.mk); if (g.reqs.length === n) return { nochange: true }; g.u = now; return {}; }); await memIdx(u.mk, (y) => { y.q = y.q.filter((i) => i !== String(b.id)); }); send(res, 200, { ok: true }); return true; }
    if (op === 'decide') {
      const gd = await gread(b.id), cap = gd ? await capOf(gd) : 8;
      let who = null; const g = await gmut(String(b.id || ''), (g) => { if (!isComm(g, u.mk)) throw bad(403, 'Only the commissioner can approve or deny');
        const q = (g.reqs || []).find((x) => x.pid === String(b.pid || '')); if (!q) throw bad(404, 'That request is gone');
        g.reqs = g.reqs.filter((x) => x !== q); who = { mk: q.mk, ok: !!b.ok };
        if (b.ok) { if (ended(g, now) || now >= joinOpenUntil(g)) throw bad(409, 'Joining is closed'); if (g.members.length >= cap) throw bad(409, fullMsg(cap)); g.members.push({ pid: q.pid, mk: q.mk, sid: q.sid, name: q.name, joined: now, paid: false, fixedName: !!q.fixedName }); }
        else { g.denied = (g.denied || []).concat(q.mk).slice(-500); }
        g.u = now; return g; });
      if (who) await memIdx(who.mk, (y) => { y.q = y.q.filter((i) => i !== g.id); if (who.ok) y.g.push(g.id); });
      send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'requests') {
      const g = await gmut(String(b.id || ''), (g) => { if (!isComm(g, u.mk)) throw bad(403, 'Only the commissioner can change this'); if (started(g, now)) throw bad(409, 'Rules are locked. The group has started.'); g.join.requests = !!b.on; g.u = now; return g; });
      await idxPut(g); send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'paid') { // main pot entry, or (with cid) a side pot entry
      const g = await gmut(String(b.id || ''), (g) => { if (!isComm(g, u.mk)) throw bad(403, 'Only the commissioner can mark entries paid'); const m = g.members.find((x) => x.pid === String(b.pid || '')); if (!m) throw bad(404, 'Not a member');
        if (b.cid) { const c = cfind(g, b.cid); if (c.pot !== 'side' || !(c.inn || []).includes(m.pid)) throw bad(404, 'Not in that side pot'); c.paid = c.paid || {}; if (!!c.paid[m.pid] === !!b.paid) return { nochange: true, v: g }; if (b.paid) c.paid[m.pid] = true; else delete c.paid[m.pid]; }
        else { if (!!m.paid === !!b.paid) return { nochange: true, v: g }; m.paid = !!b.paid; }
        g.u = now; return g; });
      send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'leave') {
      await gmut(String(b.id || ''), (g) => { if (!memberOf(g, u.mk)) throw bad(404, 'Not a member'); if (isComm(g, u.mk)) throw bad(409, 'The commissioner cannot leave. Delete the group instead (before it starts).'); if (started(g, now)) throw bad(409, 'The group has started. Members stay to the end.'); const p = memberOf(g, u.mk).pid; g.members = g.members.filter((m) => m.mk !== u.mk); sideOf(g).forEach((c) => { c.inn = (c.inn || []).filter((x) => x !== p); }); g.u = now; return {}; });
      await memIdx(u.mk, (y) => { y.g = y.g.filter((i) => i !== String(b.id)); }); send(res, 200, { ok: true }); return true;
    }
    if (op === 'delete') {
      let g0 = null; await gmut(String(b.id || ''), (g) => { if (!isComm(g, u.mk)) throw bad(403, 'Only the commissioner can delete the group'); if (started(g, now)) throw bad(409, 'The group has started and cannot be deleted'); g0 = clone(g); g.id = ''; g.deleted = now; return {}; });
      await idxPut(g0, true); await memIdx(u.mk, (y) => { y.g = y.g.filter((i) => i !== g0.id); delete y.own[g0.id]; }); try { await rmw(CK(g0.code), { id: null }, async (x) => { x.id = null; return {}; }, 4); } catch (e) {}
      send(res, 200, { ok: true }); return true;
    }
    if (op === 'standings' || op === 'player') {
      const g = await gread(b.id); if (!g || !canSee(g, u.mk)) throw bad(404, 'Group not found');
      const c = cfind(g, b.cid || (g.contests.find((x) => x.kind === 'picks') || {}).cid); if (c.kind !== 'picks') throw bad(400, c.kind === 'calcutta' ? 'Calcuttas are coming soon' : 'This game opens in its own screen');
      const scope = b.scope === 'week' ? 'week' : 'season', lastW = weekOf(c, c.endDay), curW = Math.max(1, Math.min(lastW, weekOf(c, chiDay(Math.max(now, c.start))))), week = Math.max(1, Math.min(lastW, Math.round(Number(b.week)) || curW));
      const ctx = { rows: new Map(), budget: 60 };
      if (op === 'standings') { const s = await standings(g, c, scope, week, ctx); send(res, 200, { group: full(g, u.mk, now), contest: cpub(c, g, now, (memberOf(g, u.mk) || {}).pid), scope, week, curW: s.curW, lastW: s.lastW, weekDays: weekDays(c, week), rows: s.rows.map((x) => ({ pid: x.pid, name: x.name, place: x.place, tied: x.tied, under: x.under, owed: x.owed, noBets: x.noBets, t: Object.assign({}, x.t, { weeks: undefined }) })), high: s.high, prizes: prizeOf(g, c).map((p) => ({ place: p.place, pct: p.pct, amt: p.amt })), pots: pots(g) }); return true; }
      const m = inContest(c, g).find((x) => x.pid === String(b.pid || '')); if (!m) throw bad(404, 'Not in this contest');
      const mine = m.mk === u.mk, mb = await contestBets(g, c, ctx), list = (mb[m.pid] || []).filter((x) => scope !== 'week' || weekOf(c, x.d) === week);
      const cp = list.map((x) => Object.assign({}, x)), t = score(c, cp, scope, week, now), bestIds = new Set(cp.filter((x) => x.best).map((x) => x.id));
      const shown = list.filter((x) => mine || (x.vis && x.ok)); // G6: other members' bets only after their LAST game kicks off; unknown kickoff = only once graded; not-counted bets stay private
      const hidden = mine ? 0 : list.filter((x) => x.ok && !x.vis).length;
      const bets = shown.sort((a, c2) => (c2.kick || chiStart(c2.d || '2000-01-01')) - (a.kick || chiStart(a.d || '2000-01-01'))).slice(0, 300).map((x) => ({ id: x.id.replace(/[^\w.-]/g, '').slice(0, 40), d: x.d, wk: weekOf(c, x.d), what: x.what, type: x.type, kalshi: x.kalshi, stake: x.stake, cs: x.cs, capped: !!x.capped, res: x.res, pl: x.pl, u: x.u, ok: !!x.ok, why: x.why || '', gr: x.gr || '', best: bestIds.has(x.id), locked: !!x.gl, vr: x.vr || '' }));
      send(res, 200, { name: shownName(m, await names()), pid: m.pid, me: mine, scope, week, t: Object.assign({}, t, { weeks: undefined }), bets, hidden }); return true;
    }
    send(res, 404, { error: 'not found' }); return true;
  } catch (e) { if (!e.status) console.error('groups:', e.message); send(res, e.status || 500, { error: e.status ? e.message : 'Groups error, try again' }); return true; }
}
// Light server tick (fix 2): during game windows (a game in progress or starting within 2 hours, any league a running contest uses) every 5 minutes,
// otherwise every 30 minutes, the server reads members' synced bets so it sees new bets before their kickoff. Called by server.js every 5 minutes.
const TK = { last: new Map(), busy: false };
async function tick() {
  if (TK.busy) return { skipped: true }; TK.busy = true; let n = 0;
  try {
    const now = D.now(), ix = await D.S.dbGet(IDX), I = (ix && ix.data && ix.data.g) || {}, today = chiDay(now), ctx = { rows: new Map(), budget: 80 };
    const ids = Object.keys(I).filter((id) => I[id].e >= today && I[id].s < now + 7 * DAY).slice(0, 300);
    await pmap(ids, 4, async (id) => {
      const g = await gread(id).catch(() => null); if (!g) return;
      for (const c of g.contests.filter((c) => c.kind === 'picks' && !cEnded(c, now) && c.start < now + 7 * DAY)) {
        const k = g.id + ':' + c.cid, last = TK.last.get(k) || 0, win = await GR.windowOpen(leaguesOf(c.sport), ctx).catch(() => false);
        if (now - last < (win ? 4.5 * 6e4 : 29 * 6e4)) continue;
        TK.last.set(k, now); CACHE.delete(k); try { await contestBets(g, c, ctx); n++; } catch (e) { console.error('groups tick:', e.message); }
      }
    });
  } finally { TK.busy = false; }
  return { observed: n };
}
// ---------- G14 invite router (server side): each game type registers how to read its invite code -> {kind, title} or null ----------
const INVITE = {};
function registerInvite(type, fn) { if (!/^[a-z]{1,8}$/.test(type)) throw new Error('bad invite type'); INVITE[type] = fn; }
registerInvite('g', async (code, now) => { const c = normCode(code); if (!c) return null; const ix = await D.S.dbGet(CK(c)).catch(() => null), id = ix && ix.data && ix.data.id; const g = id ? await gread(id) : null; if (!g || g.code !== c || ended(g, now) || now >= joinOpenUntil(g)) return null; return { kind: 'group', title: g.name }; });
// ---------- lifetime stats CONTRACT (owner, Nov 16 2026) ----------
// statsFor(userKey, {from, to}) -> one record per picks contest the user is in. userKey = the account id from acct.who(req) (server-only identity, e.g. '<hex>@phone.oddable').
const STATSPORT = { nfl: 'nfl', ncaaf: 'cfb', nba: 'nba', mlb: 'mlb', nhl: 'nhl', ncaab: 'ncaab' };
// One contract record for one member of one started picks contest (shared by statsFor and memberStats). null when out of the date range or not ranked.
async function contestRec(g, c, m, now, ctx, o) {
    o = o || {}; const live = !cEnded(c, now), date = live ? chiDay(now) : c.endDay;
    if ((o.from && date < o.from) || (o.to && date > o.to)) return null;
    const st = await standings(g, c, 'season', null, ctx), r = st.rows.find((y) => y.pid === m.pid); if (!r) return null;
    const rec = { src: 'groups', id: g.id + ':' + c.cid, date, sport: STATSPORT[c.sport] || 'other', kind: 'contest', groupId: g.id, contestId: c.cid, title: cleanName(g.name + ' · ' + c.name, 60), result: live ? null : r.place === 1 ? 'W' : 'L', // finished: 1st place = a win (same rule as stats.js)
     
      place: { n: r.place, of: st.rows.length }, pl: r.t.win, units: r.t.units, stake: r.t.stake, verified: !c.rules.honor, extra: { record: r.t.w + '-' + r.t.l + '-' + r.t.p, metric: c.rules.metric } };
    if (c.sport === 'all') rec.extra.sports = GR.LGS.map((l) => STATSPORT[l]); if (live) rec.extra.live = true; if (r.owed) rec.extra.owed = r.owed;
    // S-ALL (owner, Nov 16 2026): every play lands in the player's personal dashboard with what they played, the result and the money, all from SERVER records
    // (the contest ledger graded by grade.js, never the phone). entry = this contest's entry (display only), payout = what the standings say they are owed
    // (final once the contest is over; while it runs it is "if it ended now", extra.money.final = false), net = payout - entry. Picks = the counted bets.
    const entry = Math.round(Number(c.rules.entry || 0) * 100) / 100, payout = Math.round(Number(r.owed || 0) * 100) / 100;
    const mb = (await contestBets(g, c, ctx))[m.pid] || [], counted = mb.filter((y) => y.ok).sort((p1, p2) => (p1.kick || chiStart(p1.d)) - (p2.kick || chiStart(p2.d)));
    rec.spent = entry; if (!live) rec.won = payout;
    rec.extra.derived = true; rec.extra.pot = c.pot; rec.extra.money = { entry, payout, net: Math.round((payout - entry) * 100) / 100, final: !live, paid: c.pot === 'side' ? !!(c.paid || {})[m.pid] : !!m.paid }; // paid = the commissioner marked this player's entry as paid (the prize pool only holds paid entries)
    rec.extra.picks = { n: counted.length, w: r.t.w, l: r.t.l, p: r.t.p, open: r.t.open, list: counted.slice(-60).map((y) => ({ d: y.d, what: y.what, type: y.type, res: y.res || '', pl: y.pl, stake: y.cs, locked: !!y.gl, vr: y.vr || undefined })) };
    while (rec.extra.picks.list.length && JSON.stringify(rec.extra).length > 3800) { rec.extra.picks.list.shift(); rec.extra.picks.more = counted.length - rec.extra.picks.list.length; } // stats.js caps extra at 4000 characters: keep the newest picks
    return rec;
}
async function statsFor(userKey, o) {
  o = o || {}; const mk = mkOf(userKey), now = D.now(), mi = await D.S.dbGet(MK(mk)).catch(() => null), x = (mi && mi.data) || {};
  const ids = [...new Set([...(x.g || []), ...Object.keys(x.own || {})])], ctx = { rows: new Map(), budget: 60 }, out = [];
  const gs = (await pmap(ids, 6, (id) => gread(id).catch(() => null))).filter((g) => g && memberOf(g, mk));
  for (const g of gs) for (const c of g.contests.filter((c) => c.kind === 'picks' && cStarted(c, now))) {
    const m = inContest(c, g).find((y) => y.mk === mk); if (!m) continue;
    const rec = await contestRec(g, c, m, now, ctx, o); if (rec) out.push(rec);
  }
  return out;
}
// memberStats(viewerKey, groupId, pid) -> one member's group play for another member of that group (or themselves), from SERVER records only (G16):
//   { name, me, group: {id, name, started}, contest (contract record of their first started picks contest), contests (all of them), records (one contract
//     record per counted group bet; for other viewers only bets whose last game has kicked off), hidden (count still hidden), memberKey (server only) }
// null when the group does not exist, the viewer is not in it, or pid is not a member. Used by stats.js /stats/member.
const BETRES = { won: 'W', lost: 'L', push: 'P' };
async function memberStats(viewerKey, groupId, pid) {
  const vk = mkOf(viewerKey), now = D.now(), g = await gread(groupId).catch(() => null); if (!g || !canSee(g, vk)) return null;
  const m = g.members.find((y) => y.pid === String(pid || '')); if (!m) return null; const mine = m.mk === vk, ctx = { rows: new Map(), budget: 60 }, nm = await names();
  const contests = [], records = []; let hidden = 0;
  for (const c of g.contests.filter((c) => c.kind === 'picks' && cStarted(c, now) && inContest(c, g).some((y) => y.pid === m.pid))) {
    const rec = await contestRec(g, c, m, now, ctx).catch(() => null);
    if (rec) { if (!mine) { delete rec.extra.picks.list; } contests.push(rec); } // another member's pick list is only given bet by bet below (hidden until kickoff)
    const list = ((await contestBets(g, c, ctx))[m.pid] || []).filter((y) => y.ok), shown = list.filter((y) => mine || y.vis); hidden += list.length - shown.length;
    shown.forEach((y) => records.push({ src: 'groups', id: (g.id + ':' + c.cid + ':' + String(y.id).replace(/[^\w.-]/g, '')).slice(0, 80), date: y.d, sport: STATSPORT[c.sport] || 'other', kind: 'bet', groupId: g.id, contestId: c.cid, title: y.what, result: BETRES[y.res] || null, stake: y.cs, pl: y.res ? y.pl : undefined, units: y.res ? y.u : undefined, verified: y.gr !== 'honor',
      extra: { type: y.type, at: y.kick || 0, contest: c.name, locked: !!y.gl, kalshi: !!y.kalshi, server: true, vr: y.vr || undefined } }));
  }
  return { name: shownName(m, nm), me: mine, group: { id: g.id, name: g.name, started: started(g, now) }, contest: contests[0] || null, contests, records, hidden, memberKey: m.mk };
}
// ---------- groups as containers for games built elsewhere (golf day, local event, Calcutta engine) ----------
// attachGame(groupId, accountId, {type, ref, name, pot}) - the commissioner attaches an external game (its own engine keeps the rules, people and results).
async function attachGame(groupId, e, x) {
  const mk = mkOf(e), now = D.now(); if (!/^[a-z]{1,8}$/.test(String(x && x.type))) throw bad(400, 'Unknown game type'); if (!/^[A-Za-z0-9:_-]{2,60}$/.test(String(x.ref))) throw bad(400, 'Bad game reference');
  const g = await gmut(groupId, (g) => { if (!isComm(g, mk)) throw bad(403, 'Only the commissioner can add games'); if (g.contests.length >= MAXC) throw bad(400, 'A group can hold up to ' + MAXC + ' contests'); const pot = x.pot === 'main' && !engaged(g) ? 'main' : 'side';
    g.contests.push({ cid: rnd(6), kind: 'ext', type: String(x.type), ref: String(x.ref), name: cleanName(x.name || 'Game', 30), pot, created: now, rules: { entry: 0, split: 'none', take: { kind: 'none', v: 0 } }, inn: pot === 'side' ? [memberOf(g, mk).pid] : undefined, paid: {} });
    if (pot === 'main') g.money.msplit = cleanMsplit({ kind: 'entry' }, splitOf(g)); g.u = now; return g; });
  const nc = g.contests[g.contests.length - 1], api = GAMES[nc.type];
  if (api && typeof api.attachToGroup === 'function') { try { await api.attachToGroup(nc.ref, g.id, nc.cid); } catch (er) { console.error('groups: attach', er.message); } } // the game learns which group pot it reports into
  EXTC.delete(nc.type + ':' + nc.ref); await extLoad(g);
  return { cid: nc.cid, pot: nc.pot };
}
module.exports = { handle, tick, statsFor, memberStats, registerGame, partners, betAdd, LOCKED_MSG, registerInvite, attachGame, cleanCalc, limits: LIM, cleanContest, cleanTake, pots, prizes, rank, score, judge, applyObs, weekOf, chiDay, chiStart, snap, _deps: D, _reset: () => { RL.clear(); QUEUE.clear(); EXTC.clear(); CACHE.clear(); IDS.map = null; IDF.clear(); NAMES = { at: 0, v: {} }; TK.last.clear(); GR._reset(); } };
