// Oddable Calcutta engine v1 (Nov 16 2026). Commissioner builds it; members bid on lots (teams, or "the field" bundle) in a live
// auction the SERVER clocks, or the commissioner types in the results of an auction held in person. Payouts come from a payout
// table (per win / reaches round X / champion / biggest win / place) that must total exactly 100% of the prize pool.
// MONEY STAYS OUTSIDE THE APP: pot = all winning bids, commissioner's take comes off the top, everything is information only.
// Storage (Supabase table oddable_sync; the 'lock:' prefix keeps rows out of player lists / owner counts, see sync.js adminUsers):
//   'lock:calc:<id>'  one row per Calcutta (rules, lots, members, auction state, bids, sales, manual results, audit)
//   'lock:calcs'      index { calcs: { <id>: { name, comm, mks[], code, status, ev, created, group } } } for "my Calcuttas" and invite codes
// Every write = read -> change -> dbPatchIf on `updated` -> retry (two simultaneous bids: exactly one wins, the other re-validates).
// Members are shown by Oddable name/handle only; account ids, member keys, sync ids, tokens never leave the server.
const crypto = require('crypto');
const D = {
  S: require('./sync'),
  acct: () => require('./acct'),
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
  ip: (req) => require('./ip').clientIp(req),
  limits: () => { if (LIMS === undefined) { try { LIMS = require('./limits'); } catch (e) { LIMS = null; } } return LIMS; }, // the shared people limits (Groups coder's odds-api/limits.js)
};
let LIMS;
const IDX = 'lock:calcs', ROW = (id) => 'lock:calc:' + id;
const DAY = 864e5;
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const bad = (status, error, extra) => Object.assign(new Error(error), { status }, extra || {});
const body = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 40000) c.push(d); }); req.on('end', () => { if (n > 40000) return no(bad(413, 'Too big')); try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(bad(400, 'Bad request')); } }); req.on('error', no); });
const clone = (o) => JSON.parse(JSON.stringify(o));
const cleanName = (n, max) => String(n == null ? '' : n).replace(/[<>&"'`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 24);
const chiDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const addDay = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);

// ---------- people cap (OWNER DECISION G15: standard accounts top out at 8 people, commissioner included; Enterprise 500) ----------
// ONE shared check for every engine: odds-api/limits.js `await maxPeople(keyOf(accountId), gameId)` (8 standard, the Enterprise ceiling when the owner
// turned Enterprise on for the commissioner's account, plus owner-set extra seats for one game). This engine has NO ceiling or Enterprise flag of
// its own. `c.ak` = limits.keyOf(commissioner's account id), stored at creation. Until limits.js is in this branch (merge) the cap is the standard 8.
const PRICE = 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.';
const STD = 8, MAXC = new Map(); // calc id -> { at, n }: the shared answer, kept 30 s so the checks inside a transaction stay synchronous
const akOf = (e) => { const L = D.limits(); return L && L.keyOf ? L.keyOf(e) : null; };
async function maxFor(ak, id) { const L = D.limits(); if (!L || !ak) return STD; try { const n = Number(await L.maxPeople(ak, id || '')); return n >= 1 ? n : STD; } catch (e) { return STD; } }
async function capLoad(c) { const h = MAXC.get(c.id); if (h && D.now() - h.at < 30e3 && D.now() >= h.at) return h.n; const n = await maxFor(c.ak, c.id); MAXC.set(c.id, { at: D.now(), n }); if (MAXC.size > 2000) MAXC.delete(MAXC.keys().next().value); return n; }

// ---------- events and lots sources ----------
// A source gives the teams for the commissioner's picker and the finished games for grading. ESPN leagues use the same
// site.api.espn.com paths the app already reads. Golf (and anything else) plugs in with registerSource(key, {teams, results}).
const E = 'https://site.api.espn.com/apis/site/v2/sports/';
const rx = (pairs) => (g) => { const h = g.head || ''; for (const [re, r] of pairs) if (re.test(h)) return r; return null; };
const EVENTS = {
  nfl_po: { label: 'NFL playoffs', sport: 'nfl', path: 'football/nfl', teams: 14, kinds: ['win', 'round', 'champ'], rounds: ['Wild Card', 'Divisional round', 'Conference championship', 'Super Bowl'], final: 4,
    fetch: (sy) => [1, 2, 3, 5].map((w) => 'scoreboard?seasontype=3&week=' + w + '&dates=' + sy), roundOf: (g) => (g.st === 3 ? { 1: 1, 2: 2, 3: 3, 5: 4 }[g.week] || null : null),
    rows: [{ k: 'win', n: 13, bp: 300 }, { k: 'round', r: 4, n: 2, bp: 1300, label: 'Conference champion' }, { k: 'champ', n: 1, bp: 3500, label: 'Wins the Super Bowl' }] },
  nfl_season: { label: 'NFL season (all 32 teams)', sport: 'nfl', path: 'football/nfl', teams: 32, kinds: ['win', 'champ'], rounds: [], final: 4, season: true,
    fetch: (sy) => Array.from({ length: 18 }, (_, i) => 'scoreboard?seasontype=2&week=' + (i + 1) + '&dates=' + sy).concat(['scoreboard?seasontype=3&week=5&dates=' + sy]),
    roundOf: (g) => (g.st === 2 ? 0 : g.st === 3 && g.week === 5 ? 4 : null), champRound: 4,
    rows: [{ k: 'win', n: 272, bp: 25, label: 'Each regular-season win' }, { k: 'champ', n: 1, bp: 3200, label: 'Wins the Super Bowl' }] },
  cfp: { label: 'College Football Playoff', sport: 'cfb', path: 'football/college-football', tq: '&groups=80', teams: 12, kinds: ['win', 'round', 'champ'], rounds: ['First round', 'Quarterfinal', 'Semifinal', 'National championship'], final: 4,
    fetch: (sy) => [1, 2].map((w) => 'scoreboard?seasontype=3&week=' + w + '&dates=' + sy + '&groups=80&limit=400'),
    roundOf: (g) => (!/playoff|national championship/i.test(g.head || '') ? null : rx([[/national championship/i, 4], [/semifinal/i, 3], [/quarterfinal/i, 2], [/first round/i, 1]])(g)),
    rows: [{ k: 'win', n: 11, bp: 400 }, { k: 'round', r: 4, n: 2, bp: 1300, label: 'Reaches the title game' }, { k: 'champ', n: 1, bp: 3000, label: 'National champion' }] },
  mm: { label: 'March Madness', sport: 'ncaab', path: 'basketball/mens-college-basketball', tq: '&groups=50', teams: 68, kinds: ['win', 'round', 'champ'], rounds: ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Title game'], final: 6, win: (y) => ({ from: y + '-03-14', to: y + '-04-10' }), dq: '&groups=100&limit=400', prelim: /first four/i, // REVIEW FIX 2: First Four games are not tournament wins; their losers are out
    roundOf: (g) => (!/men's basketball championship/i.test(g.head || '') ? null : rx([[/first four/i, null], [/national championship/i, 6], [/final four/i, 5], [/elite 8|elite eight/i, 4], [/sweet 16|sweet sixteen/i, 3], [/2nd round|second round/i, 2], [/1st round|first round/i, 1]])(g)),
    rows: [{ k: 'win', n: 63, bp: 100 }, { k: 'round', r: 5, n: 4, bp: 400, label: 'Reaches the Final Four' }, { k: 'champ', n: 1, bp: 2100, label: 'National champion' }] },
  nba_po: { label: 'NBA playoffs', sport: 'nba', path: 'basketball/nba', teams: 16, series: true, kinds: ['win', 'round', 'champ'], rounds: ['First round', 'Conference semifinals', 'Conference finals', 'NBA Finals'], final: 4, win: (y) => ({ from: y + '-04-12', to: y + '-06-25' }), dq: '&limit=400', prelim: /play-in/i,
    roundOf: (g) => (g.st !== 3 || /play-in/i.test(g.head || '') ? null : rx([[/nba finals/i, 4], [/(east|west|conf\w*) finals/i, 3], [/semifinal/i, 2], [/1st round|first round/i, 1]])(g)),
    rows: [{ k: 'win', n: 15, bp: 400, label: 'Each series win' }, { k: 'round', r: 4, n: 2, bp: 1000, label: 'Reaches the Finals' }, { k: 'champ', n: 1, bp: 2000, label: 'Wins the title' }] },
  nhl_po: { label: 'NHL playoffs', sport: 'nhl', path: 'hockey/nhl', teams: 16, series: true, kinds: ['win', 'round', 'champ'], rounds: ['First round', 'Second round', 'Conference final', 'Stanley Cup Final'], final: 4, win: (y) => ({ from: y + '-04-15', to: y + '-06-25' }), dq: '&limit=400',
    roundOf: (g) => (g.st !== 3 ? null : rx([[/stanley cup final/i, 4], [/conference final|conf\w* final/i, 3], [/2nd round|second round/i, 2], [/1st round|first round/i, 1]])(g)),
    rows: [{ k: 'win', n: 15, bp: 400, label: 'Each series win' }, { k: 'round', r: 4, n: 2, bp: 1000, label: 'Reaches the Cup Final' }, { k: 'champ', n: 1, bp: 2000, label: 'Wins the Stanley Cup' }] },
  mlb_po: { label: 'MLB playoffs', sport: 'mlb', path: 'baseball/mlb', teams: 12, series: true, kinds: ['win', 'round', 'champ'], rounds: ['Wild Card', 'Division Series', 'League Championship', 'World Series'], final: 4, win: (y) => ({ from: y + '-09-28', to: y + '-11-08' }), dq: '&limit=400',
    roundOf: (g) => (g.st !== 3 ? null : rx([[/world series/i, 4], [/championship series|alcs|nlcs/i, 3], [/division series|alds|nlds/i, 2], [/wild card/i, 1]])(g)),
    rows: [{ k: 'win', n: 11, bp: 400, label: 'Each series win' }, { k: 'round', r: 4, n: 2, bp: 1300, label: 'Reaches the World Series' }, { k: 'champ', n: 1, bp: 3000, label: 'Wins the World Series' }] },
  nfl_wk: { label: "NFL this weekend's games", sport: 'nfl', path: 'football/nfl', teams: 0, kinds: ['win', 'big'], rounds: [], days: 6, weekend: true, dq: '',
    roundOf: (g) => (g.st === 2 || g.st === 3 ? 0 : null), rows: [{ k: 'win', n: 16, bp: 500 }, { k: 'big', n: 1, bp: 2000, label: 'Biggest win margin' }] },
  cfb_wk: { label: "College football this weekend's games", sport: 'cfb', path: 'football/college-football', tq: '&groups=80', teams: 0, kinds: ['win', 'big'], rounds: [], days: 6, weekend: true, dq: '&groups=80&limit=400',
    roundOf: (g) => (g.st === 2 || g.st === 3 ? 0 : null), rows: [{ k: 'win', n: 20, bp: 400 }, { k: 'big', n: 1, bp: 2000, label: 'Biggest win margin' }] },
  golf: { label: 'Golf tournament', sport: 'golf', kinds: ['place'], rounds: [], plug: 'golf', rows: [{ k: 'place', r: 1, n: 1, bp: 5000, label: 'Winner' }, { k: 'place', r: 2, n: 1, bp: 2000 }, { k: 'place', r: 3, n: 1, bp: 1000 }, { k: 'place', r: 4, n: 1, bp: 1000 }, { k: 'place', r: 5, n: 1, bp: 1000 }] },
  // GOLF DAY (golf coder, golf-v1): the teams of ONE golf day are the lots; which day = the Calcutta's source reference `c.golf = { gameId }`
  'golf-day': { label: 'Golf day (the teams of a golf day)', sport: 'golf', kinds: ['place', 'champ'], rounds: [], plug: 'golf-day', needsRef: 'gameId', rows: [{ k: 'place', r: 1, n: 1, bp: 6000, label: 'Winner' }, { k: 'place', r: 2, n: 1, bp: 3000 }, { k: 'place', r: 3, n: 1, bp: 1000 }] },
  // LOCAL EVENT / PICKLEBALL (events coder, local-v1): the pairs / teams of ONE local event are the lots; which event = `c.evtId` (one source 'events' serves every event)
  local: { label: 'Local event or pickleball (its pairs / teams)', sport: 'other', kinds: ['win', 'round', 'champ', 'place'], rounds: ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5', 'Round 6'], final: 0, plug: 'events', needsRef: 'evtId',
    rows: [{ k: 'place', r: 1, n: 1, bp: 6000, label: 'Winner' }, { k: 'place', r: 2, n: 1, bp: 3000 }, { k: 'place', r: 3, n: 1, bp: 1000 }] },
  custom: { local: true, label: 'Custom (type the teams, enter results by hand)', sport: 'other', kinds: ['win', 'round', 'champ', 'place'], rounds: ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5', 'Round 6'], final: 0, manualOnly: true,
    rows: [{ k: 'win', n: 7, bp: 500 }, { k: 'round', r: 3, n: 2, bp: 1500, label: 'Reaches the final' }, { k: 'champ', n: 1, bp: 3500, label: 'Champion' }] },
};
// PLUGGED SOURCES (golf, local events). Contract, see HANDOFF "Lot source contract":
//   teams(calc):        async -> [{ id, name, abbr?, players?: [...] }]            the lots the commissioner can pick. `calc` = the Calcutta (or, before
//                       it exists, { ev, golf }): `calc.golf` is the SOURCE REFERENCE the commissioner's screen sent at set-up, kept on the Calcutta:
//                       { gameId } = one golf day, or { tour, eventId } = one tour event (nothing = the source's default, e.g. this week).
//                       Local events / pickleball: `calc.evtId` = '<event id>' (a string) instead. One registered source serves every event this way.
//                       ids: letters, digits, _ - . : up to 60 chars (e.g. 't:<gameId>:<tid>', 'g:<golferId>'). players (local sources) = the lot's
//                       players of record: { key: <24-hex member key> } | account id | 'g:<guest id>' | { guest, name } | { name } | a plain name.
//   results(calc):      async -> { <teamId>: { wins, winT[], reached, reachT{}, champ, out, place } }   {} until something has happened
//   startTime(calc):    async -> ms since 1970 of the first tee time / first match, or null when not scheduled yet   (REQUIRED: this or started)
//   started(calc):      async -> true once play is under way, false before. TRUE IS FOR GOOD (the Calcutta is frozen and never unlocks), so when the
//                       source cannot tell (database / feed down) it must THROW or answer null, never true                (REQUIRED: this or startTime)
//   local: true         when the lots are the group's own players/teams (players of record + buy back half)
// Ownership (sales, entries, buy-backs, players of record) FREEZES for good as soon as started() is true, the server clock reaches startTime(),
// or results() holds any result. FAIL CLOSED: a source that throws, times out (4 s), answers started() with anything but true/false, or returns a bad startTime keeps ownership locked
// (409 code 'feed') until it answers again; that lock is NOT sticky.
const SOURCES = {};
function registerSource(key, src) { if (!src || typeof src.teams !== 'function') throw new Error('registerSource: teams() is required'); if (typeof src.started !== 'function' && typeof src.startTime !== 'function') console.error('calcutta source "' + key + '": no started()/startTime() hook, the start is only seen from results()'); SOURCES[key] = src; }
const evOn = (k) => { const ev = EVENTS[k]; return !!ev && (!ev.plug || !!SOURCES[ev.plug]); };
// LOCAL events (custom, or a plugged source with local:true such as a golf-day team or pickleball pair) have lots whose own players can be
// in the group = "players of record". Only those lots can be bought back (OWNER DECISION Nov 16 2026). Pro teams/golfers: never.
const evLocal = (k) => { const ev = EVENTS[k]; return !!ev && (!!ev.local || (!!ev.plug && !!SOURCES[ev.plug] && !!SOURCES[ev.plug].local)); };
// Players of record: [{ k, name }], k = member key (24 hex, sha256 of the account id) | 'g:<guest id>' | 'n:<lower-case name>'. Never sent out.
function porEntry(x, members) {
  if (typeof x === 'string') { const v = x.trim(); if (/^[0-9a-f]{24}$/.test(v)) return { k: v, name: '' }; if (/^g:[\w-]{1,40}$/.test(v)) return { k: v, name: '' }; if (v.length >= 3 && v.length <= 200) return { k: mkOf(v), name: '' }; throw bad(400, 'Bad player of record'); }
  if (!x || typeof x !== 'object') throw bad(400, 'Bad player of record');
  const name = cleanName(x.name, 24);
  if (x.me) { if (!members || !members._me) throw bad(400, 'Bad player of record'); return { k: members._me.mk, name: members._me.name }; }
  if (x.pid != null) { const m = (members || []).find((y) => y.pid === String(x.pid)); if (!m) throw bad(404, 'Not a member'); return { k: m.mk, name: m.name }; }
  if (x.key != null || x.guest != null) { const e = porEntry(x.guest != null ? 'g:' + String(x.guest) : String(x.key)); e.name = name; return e; }
  if (name.length >= 2) return { k: 'n:' + name.toLowerCase(), name };
  throw bad(400, 'A player of record needs a member, a guest id or a name (2+ characters)');
}
// The source reference a commissioner's screen sends at set-up (`golf: { gameId } | { tour, eventId }`), kept on the Calcutta as c.golf and handed to the source
// srcRef: the reference fields of a plugged event from a request body -> { golf, evtId } (both stored on the Calcutta and on the object teams() gets)
function srcRef(ev, b) { if (!ev || !ev.plug) return { golf: null, evtId: null }; const golf = ev.needsRef === 'evtId' ? null : cleanRef(b && (b.golf || b.ref)), evtId = ev.needsRef === 'evtId' && b && b.evtId != null && /^[\w:.-]{1,40}$/.test(String(b.evtId)) ? String(b.evtId) : null;
  if (ev.needsRef && !(ev.needsRef === 'evtId' ? evtId : golf && golf[ev.needsRef])) throw bad(400, ev.needsRef === 'evtId' ? 'Start this Calcutta from the local event whose pairs or teams you want to auction' : 'Start this Calcutta from the golf day whose teams you want to auction'); return { golf, evtId }; }
function cleanRef(x) { if (!x || typeof x !== 'object') return null; const o = {}; if (x.gameId != null && /^[\w-]{1,40}$/.test(String(x.gameId))) o.gameId = String(x.gameId); if (x.tour != null && /^[a-z0-9]{1,12}$/.test(String(x.tour))) o.tour = String(x.tour); if (x.eventId != null && /^[\w-]{1,24}$/.test(String(x.eventId))) o.eventId = String(x.eventId); return Object.keys(o).length ? o : null; }
const srcPlayer = (p) => (typeof p === 'string' && !/^[0-9a-f]{24}$/.test(p.trim()) && !/^g:[\w-]{1,40}$/.test(p.trim()) && !p.includes('@') && p.trim() !== 'owner' ? { name: p } : p); // a plain name from a source is a name, not an account id
function cleanPor(list, members) { if (list == null) return []; if (!Array.isArray(list) || list.length > 8) throw bad(400, 'Up to 8 players of record per lot'); const out = [], seen = new Set(); list.forEach((x) => { const e = porEntry(x, members); if (!seen.has(e.k)) { seen.add(e.k); out.push(e); } }); return out; }
const rowLabel = (ev, r) => r.label || (r.k === 'win' ? 'Each win' : r.k === 'champ' ? 'Champion' : r.k === 'big' ? 'Biggest win margin' : r.k === 'place' ? (r.r === 1 ? 'Winner' : 'Finishes ' + ord(r.r)) : 'Reaches ' + ((ev.rounds || [])[r.r - 1] || 'round ' + r.r));
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

// ---------- rules ----------
const MINB = [1, 2, 5, 10, 20, 25, 50, 100], INCS = [1, 2, 5, 10, 25], TIMERS = [10, 20, 25, 30], TIMER0 = 25; // Playbook play 10: default 25 s
// Playbook play 10: what happens to the winnings of a lot nobody bought, picked at set-up and shown to members before the auction
const UNSOLD = { roll: 'Rolled into the sold lots\' payouts, pro rata', carry: 'Carried to the next Calcutta' };
const unsoldText = (r) => (r.unsold === 'carry' ? 'If an unsold lot wins, its winnings carry to the next Calcutta.' : 'If an unsold lot wins, its winnings roll into the payouts of the sold lots, pro rata (in proportion to what each has earned).');
function cleanRows(ev, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 12) throw bad(400, 'The payout table needs 1 to 12 rows');
  const out = rows.map((x) => {
    const k = String(x && x.k || ''); if (!ev.kinds.includes(k)) throw bad(400, 'That payout kind does not fit this event');
    const pct = Number(x.pct != null ? x.pct : Number(x.bp) / 100), bp = Math.round(pct * 100);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100 || Math.abs(bp - pct * 100) > 1e-6) throw bad(400, 'Percentages: 0 to 100, at most 2 decimals');
    const n = Math.round(Number(x.n)); if (!(n >= 1 && n <= 400 && n === Number(x.n))) throw bad(400, 'How many times a row pays: 1 to 400');
    if ((k === 'champ' || k === 'big') && n !== 1) throw bad(400, 'Champion and biggest-win rows pay once');
    let r = 0; if (k === 'round') { r = Math.round(Number(x.r)); if (!(r >= 1 && r <= (ev.rounds || []).length)) throw bad(400, 'Pick a round from the list'); }
    if (k === 'place') { r = Math.round(Number(x.r)); if (!(r >= 1 && r <= 100)) throw bad(400, 'Place must be 1 to 100'); }
    const o = { k, n, bp }; if (r) o.r = r; const lab = cleanName(x.label, 40); if (lab) o.label = lab; o.label = rowLabel(ev, o); return o;
  });
  const tot = out.reduce((a, x) => a + x.bp * x.n, 0);
  if (tot !== 10000) throw bad(400, 'Payouts must total exactly 100% (now ' + (tot / 100) + '%)', { total: tot / 100 });
  return out;
}
function cleanLots(ev, lots, known, local, members) {
  if (!Array.isArray(lots) || lots.length < 2 || lots.length > 80) throw bad(400, 'Put 2 to 80 lots up for auction');
  const seen = new Set(); let x = 0;
  return lots.map((l, i) => {
    const ts = Array.isArray(l && l.teams) ? l.teams : []; if (!ts.length || ts.length > 70) throw bad(400, 'Each lot needs at least one team');
    const teams = ts.map((t) => {
      let id = String(t && t.id || ''); const name = cleanName(t && t.name, 40); if (!name) throw bad(400, 'Every team needs a name');
      if (ev.manualOnly) id = 'x' + (++x); else if (!(ev.plug ? /^[\w:.-]{1,60}$/ : /^[\w-]{1,24}$/).test(id)) throw bad(400, 'Unknown team');
      if (known && !ev.manualOnly && !known[id]) throw bad(400, 'Unknown team: ' + name);
      if (seen.has(id)) throw bad(400, name + ' is in two lots'); seen.add(id);
      return { id, name: known && known[id] ? known[id].name : name, abbr: cleanName(known && known[id] ? known[id].abbr : t.abbr, 6) };
    });
    const nm = cleanName(l.name, 40) || (teams.length === 1 ? teams[0].name : 'The field (' + teams.length + ' teams)');
    const src = []; if (known) ts.forEach((t) => { const k = known[String(t && t.id || '')]; if (k && Array.isArray(k.players)) src.push(...k.players.map(srcPlayer)); }); // the lot source's own players
    const given = l.playersOfRecord != null ? l.playersOfRecord : null; if (!local && ((given && given.length) || src.length)) throw bad(400, 'Players of record are only for local events (pro teams and golfers have none)');
    const por = local ? cleanPor(src.concat(given || []), members) : [];
    return { id: 'L' + (i + 1), name: nm, teams, field: teams.length > 1, por };
  });
}
async function cleanRules(b, now, members) {
  const name = cleanName(b.name, 40); if (name.length < 2) throw bad(400, 'Give the Calcutta a name (2+ characters)');
  const evk = String(b.ev || ''), ev = EVENTS[evk]; if (!ev) throw bad(400, 'Pick an event'); if (!evOn(evk)) throw bad(400, 'That event is coming soon');
  const ref = srcRef(ev, b);
  let known = null; if (!ev.manualOnly) { try { const t = await teamsOf(evk, ref); if (t.length) { known = {}; t.forEach((x) => { known[x.id] = x; }); } } catch (e) { if (ev.plug) throw bad(502, 'Could not load the teams. Try again.'); } }
  if (ev.plug && !known) throw bad(400, 'There are no teams to auction there yet');
  const lots = cleanLots(ev, b.lots, known, evLocal(evk), members), rows = cleanRows(ev, b.rows);
  if (b.buyBack && !evLocal(evk)) throw bad(400, 'Buy back half is only for local events, where the auctioned player or team is in the group');
  const minBid = Number(b.minBid); if (!MINB.includes(minBid)) throw bad(400, 'Pick the lowest bid from the list');
  const inc = Number(b.inc || 5); if (!INCS.includes(inc)) throw bad(400, 'Pick the bid step from the list');
  const timer = Number(b.timer == null || b.timer === '' ? TIMER0 : b.timer); if (!TIMERS.includes(timer)) throw bad(400, 'Bid timer: 10, 20, 25 or 30 seconds');
  const mode = b.mode === 'manual' ? 'manual' : b.mode === 'live' ? 'live' : null; if (!mode) throw bad(400, 'Pick Live in the app or Enter results');
  const order = ['listed', 'random'].includes(b.order) ? b.order : null; if (!order) throw bad(400, 'Pick the auction order');
  const uns = b.unsold == null || b.unsold === '' ? 'roll' : String(b.unsold); if (!UNSOLD[uns]) throw bad(400, 'Pick what happens when an unsold lot wins');
  const tk = b.take || {}, kind = String(tk.kind || 'none'); let tv = 0;
  if (kind === 'pct') { tv = Number(tk.v); if (!(Number.isInteger(tv) && tv >= 0 && tv <= 50)) throw bad(400, "Commissioner's take: a whole percent from 0 to 50"); }
  else if (kind === 'flat') { tv = Number(tk.v); if (!(Number.isFinite(tv) && tv >= 0 && tv <= 100000 && Math.abs(Math.round(tv * 100) - tv * 100) < 1e-6)) throw bad(400, "Commissioner's take: a dollar amount, not negative"); }
  else if (kind !== 'none') throw bad(400, "Pick the commissioner's take");
  let win = null; if (ev.weekend) { const td = chiDay(now), wd = new Date(td + 'T12:00:00Z').getUTCDay(), from = [5, 6, 0, 1].includes(wd) ? addDay(td, -((wd - 4 + 7) % 7)) : addDay(td, 4 - wd); win = { from, to: addDay(from, 4) }; } // Thursday to Monday of this (or the coming) weekend
  else if (ev.win) { const td = chiDay(now), y = +td.slice(0, 4); win = ev.win(y); if (td > win.to) win = ev.win(y + 1); } // REVIEW FIX 9: the event's own dates (also when created mid-event)
  else if (ev.days) win = { from: chiDay(now), to: addDay(chiDay(now), ev.days) };
  return { name, ev: evk, golf: ref.golf, evtId: ref.evtId, lots, win, rules: { rows, minBid, inc, timer, buyBack: !!b.buyBack, main: b.main !== false, take: { kind, v: kind === 'none' ? 0 : tv }, order, mode, unsold: uns } };
}

// ---------- identity (same member key as Groups so the manager can match members) ----------
const mkOf = (e) => crypto.createHash('sha256').update('oddable-group|' + e).digest('hex').slice(0, 24);
const IDS = { at: 0, map: null };
async function sidOf(e) { if (!/@phone\.oddable$/.test(e)) return null; const A = D.acct(); for (let i = 0; i < 2; i++) { if (!IDS.map || D.now() - IDS.at > 6e5 || i) { const m = {}; (await D.S.dbIds()).forEach((id) => { m[A.phoneEmail(id)] = id; }); IDS.map = m; IDS.at = D.now(); } if (IDS.map[e]) return IDS.map[e]; } return null; }
let NAMES = { at: 0, v: {} };
async function names() { if (D.now() - NAMES.at > 60e3) { try { NAMES = { at: D.now(), v: await D.acct().namesGet() }; } catch (e) { NAMES.at = D.now(); } } return NAMES.v; }
async function nameOf(e, given) { const A = D.acct(); if (e === 'owner' || A.isOwnerPhone(e)) return A.ownerName(); let sid = null; try { sid = await sidOf(e); } catch (x) {} if (sid) { const n = (await names())[String(sid).slice(0, 8)]; if (n) return cleanName(n); } void given; return 'Player ' + mkOf(e).slice(0, 4).toUpperCase(); } // REVIEW FIX 10: never a typed name (it could copy someone else's)
async function me(req) { const e = D.acct().who(req); if (!e) throw bad(401, 'Sign in to use Calcutta'); return { e, mk: mkOf(e) }; }

// ---------- rate limits ----------
const RL = new Map();
function limit(key, n, ms) { const t = D.now(), a = (RL.get(key) || []).filter((x) => t - x < ms); if (a.length >= n) { RL.set(key, a); return true; } a.push(t); RL.set(key, a); if (RL.size > 20000) { let k = 0; for (const x of RL.keys()) { RL.delete(x); if (++k > 5000) break; } } return false; }
const LIM = { create: [5, 3600e3, 12, 3600e3], bid: [8, 5e3, 40, 5e3], ctl: [30, 10e3, 60, 10e3], join: [30, 600e3, 60, 600e3], peek: [30, 600e3, 60, 600e3], write: [60, 60e3, 120, 60e3] };
function rate(kind, who, ip) { const L = LIM[kind]; if (limit(kind + '|a|' + who, L[0], L[1]) || limit(kind + '|i|' + ip, L[2], L[3])) throw bad(429, kind === 'bid' ? 'Too many bids at once. Wait a second.' : 'Too many tries. Wait a few minutes.'); }
const codeFail = (k) => { const t = D.now(), a = (RL.get(k) || []).filter((x) => t - x < 900e3); a.push(t); RL.set(k, a); };
const codeBlocked = (k) => (RL.get(k) || []).filter((x) => D.now() - x < 900e3).length >= 10;

// ---------- rows ----------
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPH[b[i] % 32]; return s; };
const newCode = () => rnd(12); // 60 random bits; link https://steves-pics.onrender.com/?join=c.<code>
const normCode = (c) => { const x = String(c || '').toUpperCase().replace(/^C\./, '').replace(/[^A-Z0-9]/g, ''); return x.length === 12 ? x : ''; };
const sameCode = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const RC = new Map(); // read cache: id -> { at, row } (1 s) so polling phones cost at most one database read per second per Calcutta
async function loadRow(id, fresh) { const h = RC.get(id); if (!fresh && h && D.now() - h.at < 1000) return h.row; const r = await D.S.dbGet(ROW(id)); if (r) { RC.set(id, { at: D.now(), row: r }); if (RC.size > 300) RC.delete(RC.keys().next().value); } return r; }
let writes = 0;
async function mutRow(rowId, init, fn, after) {
  for (let i = 0; i < 8; i++) {
    let row = await D.S.dbGet(rowId);
    if (!row) { if (!init) throw bad(404, 'Calcutta not found'); await D.S.dbPut({ id: rowId, salt: 'x', pinhash: 'x', data: init, updated: 1 }, true); row = await D.S.dbGet(rowId); if (!row) continue; }
    const data = clone(row.data || {}); const out = await fn(data);
    if (out && out.nochange) return out.v !== undefined ? out.v : data;
    const upd = Math.max(D.now(), Number(row.updated || 0) + 1);
    if (await D.S.dbPatchIf(rowId, row.updated, data, upd)) { writes++; if (after) after({ id: rowId, data, updated: upd }); return out === undefined ? data : out; }
  }
  throw bad(409, 'Busy, try again');
}
const mutCalc = (id, fn, mk) => mutRow(ROW(id), null, async (c) => { if (c.deleted || (mk && !memberOf(c, mk))) throw bad(404, 'Calcutta not found'); settle(c, D.now()); return fn(c); }, (row) => RC.set(String(row.id).slice(10), { at: D.now(), row }));
const idxEntry = (c) => ({ name: c.name, comm: c.comm, mks: c.members.map((m) => m.mk), code: c.code, status: c.a.status, ev: c.ev, created: c.created, act: D.now(), group: c.group || null, pks: [...new Set([].concat(...c.lots.map((l) => (l.por || []).map((e) => e.k).filter((k) => /^[0-9a-f]{24}$/.test(k)))))], gks: [...new Set([].concat(...c.lots.map((l) => (l.por || []).map((e) => e.k).concat(c.sold[l.id] && c.sold[l.id].bb && c.sold[l.id].bb.k ? [c.sold[l.id].bb.k] : []).filter((k) => /^g:/.test(k)))))] }); // S-ALL: players of record (account keys) find their Calcuttas too
// REVIEW FIX 8: index cached 1 s, abandoned set-ups (never started, 90+ days) pruned, failed updates retried on the next request
const IDXC = { at: 0, v: null }, PENDING = new Set(), ABANDON = 90 * DAY;
async function syncIdx(c) {
  for (let k = 0; k < 3; k++) { try { await mutRow(IDX, { calcs: {} }, (d) => { d.calcs = d.calcs || {}; const e = idxEntry(c), now = D.now(); const strip = (x) => JSON.stringify(Object.assign({}, x, { act: 0 })); let ch = !d.calcs[c.id] || strip(d.calcs[c.id]) !== strip(e) || now - (d.calcs[c.id].act || 0) >= DAY; d.calcs[c.id] = e;
      Object.keys(d.calcs).forEach((id) => { const x = d.calcs[id]; if (id !== c.id && x.status === 'setup' && !x.group && !(x.pks || []).length && !(x.gks || []).length && (x.mks || []).length <= 1 && now - (x.act || x.created || 0) > ABANDON) /* ROUND 2 D5 + ROUND 3 #7: commissioner alone, never in a group, no team players, no activity (his own views count) */ { delete d.calcs[id]; ch = true; } });
      if (!ch) return { nochange: true }; return {}; }, (row) => { IDXC.at = D.now(); IDXC.v = row.data.calcs; }); PENDING.delete(c.id); IDXC.at = 0; return; } catch (e) { if (k === 2) { console.error('calcutta index:', e.message); PENDING.add(c.id); } } }
}
async function repairIdx() { if (!PENDING.size) return; for (const id of [...PENDING].slice(0, 5)) { PENDING.delete(id); const r = await D.S.dbGet(ROW(id)); if (r && r.data && !r.data.deleted) await syncIdx(r.data); } }
async function idx() { if (IDXC.v && D.now() - IDXC.at < 1000) return IDXC.v; const r = await D.S.dbGet(IDX); IDXC.v = (r && r.data && r.data.calcs) || {}; IDXC.at = D.now(); return IDXC.v; }

// ---------- auction state machine (server is the clock) ----------
// c.a = { status: 'setup'|'live'|'closed', order[lotIds], cur: lotId|null, endsAt, paused, left, nextAt, nextLeft, just: lotId|null }
// c.bids[lotId] = [{pid, amt, at}]   c.sold[lotId] = {pid|null, name, amt, at, how:'auction'|'entered', bb:{pid|null,name,at}|null}
const NEXT_MS = 8000; // after a sale the next lot opens by itself 8 s later (the commissioner's Next lot opens it at once)
const lotOf = (c, id) => c.lots.find((l) => l.id === id);
const high = (c, lot) => { const b = (c.bids[lot] || []); return b.length ? b[b.length - 1] : null; };
const unsold = (c) => c.a.order.filter((id) => !c.sold[id]);
const holders = (c) => { const s = new Set(); c.members.forEach((m) => s.add('p:' + m.pid)); Object.values(c.sold).forEach((x) => { if (!x.pid && x.name) s.add('n:' + x.name.toLowerCase()); if (x.bb && !x.bb.pid) { const m = x.bb.k && !/^n:/.test(x.bb.k) ? c.members.find((y) => y.mk === x.bb.k) : null; if (!m) s.add(x.bb.k && !/^n:/.test(x.bb.k) ? 'k:' + x.bb.k : 'n:' + String(x.bb.name || '').toLowerCase()); } }); return s; };
function audit(c, by, what) { c.audit = c.audit || []; c.audit.push({ at: D.now(), by: cleanName(by, 24), what: cleanName(what, 160) }); if (c.audit.length > 600) c.audit = c.audit.slice(-600); }
const porLock = (c, lotId, at) => { const l = lotOf(c, lotId); if (l && !l.porLockedAt) l.porLockedAt = at || D.now(); }; // ROUND 3 #5: sticky, survives unenter / undo
function sell(c, lotId, at, by) { const h = high(c, lotId); porLock(c, lotId, at); c.sold[lotId] = { pid: h.pid, name: '', amt: h.amt, at, how: 'auction', bb: null }; c.a.just = lotId; c.a.cur = null; c.a.endsAt = null; c.a.left = null; audit(c, by || 'Timer', 'Sold ' + lotOf(c, lotId).name + ' to ' + mName(c, h.pid) + ' for $' + h.amt);
  if (!unsold(c).length) { c.a.status = 'closed'; c.a.closedAt = at; c.a.nextAt = null; audit(c, 'Auction', 'Every lot sold. Auction closed.'); } else c.a.nextAt = c.a.paused ? null : at + NEXT_MS, c.a.nextLeft = c.a.paused ? NEXT_MS : null; }
function openNext(c, from) { const u = unsold(c); if (!u.length) return; const ord = c.a.order, i0 = from ? ord.indexOf(from) : -1; let pick = null; for (let k = 1; k <= ord.length; k++) { const id = ord[(i0 + k + ord.length) % ord.length]; if (!c.sold[id] && id !== from) { pick = id; break; } } if (!pick) pick = u[0]; c.a.cur = pick; c.a.endsAt = null; c.a.left = null; c.a.nextAt = null; c.a.nextLeft = null; }
function settle(c, now) { // lazy clock: called before every read-modify-write and on polls
  if (!c.a || c.a.status !== 'live' || c.a.paused) return false; let ch = false;
  if (c.a.cur && c.a.endsAt && now >= c.a.endsAt && high(c, c.a.cur) && !pastLock(c, c.a.endsAt)) { sell(c, c.a.cur, c.a.endsAt); ch = true; } // ROUND 3 #3: a bell that rings at/after the kickoff sells nothing
  if (c.a.status === 'live' && !c.a.cur && c.a.nextAt && now >= c.a.nextAt) { openNext(c, c.a.just); ch = true; }
  return ch;
}
const pastLock = (c, t) => { const k = kickOf(c); return (c.startedAt != null && t >= c.startedAt) || !!(k && k.t0 != null && t >= k.t0); }; // is time t at/after the moment ownership locked?
const needsSettle = (c, now) => c.a && c.a.status === 'live' && !c.a.paused && ((c.a.cur && c.a.endsAt && now >= c.a.endsAt && high(c, c.a.cur) && !pastLock(c, c.a.endsAt)) || (!c.a.cur && c.a.nextAt && now >= c.a.nextAt));
const mName = (c, pid) => (c.members.find((m) => m.pid === pid) || {}).name || 'Player';
const memberOf = (c, mk) => c.members.find((m) => m.mk === mk);
const isComm = (c, mk) => c.comm === mk;
const newPid = (c) => { let p; do { p = rnd(6); } while (c.members.some((m) => m.pid === p)); return p; };
const maxOf = (c) => (MAXC.get(c.id) || { n: STD }).n; // capLoad(c) runs first on every route
const capMsg = (c, what) => what + ' (up to ' + maxOf(c) + ' people, the commissioner included). ' + (maxOf(c) <= 8 ? PRICE : 'Contact Oddable.');

// ---------- results (ESPN finals, pluggable sources, manual overrides) ----------
const seasonYear = (ms, ev) => { const d = new Date(ms), y = d.getUTCFullYear(), m = d.getUTCMonth(); return ev.sport === 'nfl' || ev.sport === 'cfb' ? (m >= 6 ? y : y - 1) : y; };
const TEAMS = new Map(); // ev -> { at, list }
async function teamsOf(evk, ref) {
  const ev = EVENTS[evk]; if (!ev || ev.manualOnly) return []; if (ev.plug) return SOURCES[ev.plug] ? ((await SOURCES[ev.plug].teams(Object.assign({ ev: evk, golf: (ref && ref.golf) || null }, ref && ref.evtId ? { evtId: ref.evtId } : {}))) || []).map((t) => ({ id: String(t.id), name: cleanName(t.name, 40), abbr: cleanName(t.abbr, 6), players: Array.isArray(t.players) ? t.players : undefined })) : [];
  const h = TEAMS.get(ev.path + (ev.tq || '')); if (h && D.now() - h.at < 12 * 36e5 && h.list.length) return h.list;
  const r = await D.fetch(E + ev.path + '/teams?limit=1000' + (ev.tq || ''), { signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error('teams ' + r.status);
  const j = await r.json(), list = []; (((j.sports || [])[0] || {}).leagues || []).forEach((lg) => (lg.teams || []).forEach((x) => { const t = x.team || x; if (t && t.id) list.push({ id: String(t.id), abbr: cleanName(t.abbreviation, 6), name: cleanName(t.displayName || t.name, 40) }); }));
  list.sort((a, b) => a.name.localeCompare(b.name)); TEAMS.set(ev.path + (ev.tq || ''), { at: D.now(), list }); return list;
}
function parseGames(j) {
  return (j.events || []).map((e) => { const c = (e.competitions || [])[0] || {}, st = ((e.status || c.status || {}).type || {}); return { id: String(e.id), t: Date.parse(e.date) || 0, state: st.state || (st.completed ? 'post' : 'pre'), done: !!st.completed || st.state === 'post', off: /POSTPON|CANCEL/i.test(String(st.name || '')), st: Number((e.season || {}).type || 0), week: Number((e.week || {}).number || 0), head: String(((c.notes || [])[0] || {}).headline || ''),
    teams: (c.competitors || []).map((x) => ({ id: String((x.team || {}).id || x.id || ''), score: Number(x.score && x.score.value != null ? x.score.value : x.score) || 0, winner: !!x.winner })),
    series: c.series && Array.isArray(c.series.competitors) ? { done: !!c.series.completed, wins: Object.fromEntries(c.series.competitors.map((s) => [String(s.id), Number(s.wins) || 0])) } : null }; });
}
const GC = new Map(), GF = new Map(), GI = new Map(); // url -> { at, games, final, ttl } | a failure { at, msg } kept 30 s | the read in flight
async function getGames(url, today) {
  const h = GC.get(url), now = D.now(); if (h && (h.final || (now - h.at < h.ttl && now >= h.at))) return h.games;
  const f = GF.get(url); if (f && now - f.at < 30e3 && now >= f.at) throw new Error('score feed: ' + f.msg); // ROUND 3 #4: failures cached briefly
  if (GI.has(url)) return GI.get(url);
  const p = (async () => { try { const r = await D.fetch(url, { signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error('HTTP ' + r.status); const games = parseGames(await r.json()), t = D.now();
    const fin = !!today && games.length > 0 && games.every((g) => g.done) && !url.includes('dates=' + today.replace(/-/g, ''));
    const soon = !games.length || games.some((g) => !g.done && Math.abs(g.t - t) < DAY); // a game within a day, or nothing listed yet: re-read every 30 s, else every 5 min
    GC.set(url, { at: t, games, final: fin, ttl: soon ? 3e4 : 5 * 6e4 }); GF.delete(url); if (GC.size > 3000) GC.delete(GC.keys().next().value); return games;
  } catch (e) { GF.set(url, { at: D.now(), msg: e.message }); if (GF.size > 1000) GF.clear(); throw new Error('score feed: ' + e.message); } finally { GI.delete(url); } })(); // ROUND 2 D1: a failed fetch is an error (never an empty, fresh-looking list)
  GI.set(url, p); return p;
}
function urlsFor(c) {
  const ev = EVENTS[c.ev]; if (ev.fetch) return ev.fetch(seasonYear(c.created, ev)).map((q) => E + ev.path + '/' + q);
  if (!c.win) return []; const out = [], today = chiDay(D.now()); const thru = addDay(today, 1); /* ROUND 3: tomorrow's schedule too, so kickoff times are known a day ahead */ for (let d = c.win.from; d <= c.win.to && d <= thru && out.length < 90; d = addDay(d, 1)) out.push(E + ev.path + '/scoreboard?dates=' + d.replace(/-/g, '') + (ev.dq || ''));
  return out;
}
// One team's results: wins (with times), furthest round reached (+time), champion, out (eliminated), big (biggest win margin)
function teamResults(ev, games, inEvent) {
  const R = {}, T = (id) => (R[id] = R[id] || { wins: 0, winT: [], reached: 0, reachT: {}, champ: false, out: false });
  // REVIEW FIX 3: a game counts when ANY lot team plays in it (its opponent may be in no lot); roundOf decides if it is part of the event
  const preLost = new Set(); games.forEach((g) => { if (ev.prelim && g.done && g.teams.length === 2 && ev.prelim.test(g.head || '') && g.teams.some((t) => inEvent.has(t.id))) { const [a, b] = g.teams, w = a.winner ? a : b.winner ? b : a.score > b.score ? a : b; preLost.add((w === a ? b : a).id); } });
  const champR = ev.champRound || ev.final; // ROUND 2 Low: the final always counts (so the event ends even when its champion is in no lot)
  const gs = games.filter((g) => g.teams.length === 2).map((g) => Object.assign({}, g, { round: ev.roundOf ? ev.roundOf(g) : 0 })).filter((g) => g.round != null && (g.teams.some((t) => inEvent.has(t.id)) || (champR && g.round === champR)));
  gs.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id)); const seriesDone = new Set();
  let big = null;
  gs.forEach((g) => {
    g.teams.forEach((t) => { const x = T(t.id); if (g.round > x.reached) { x.reached = g.round; } if (x.reachT[g.round] == null) x.reachT[g.round] = g.t; });
    if (ev.series && g.round > 0) { // a "win" = a series won
      if (g.series && g.series.done) { const key = g.round + '|' + g.teams.map((t) => t.id).sort().join('-'); if (seriesDone.has(key)) return; seriesDone.add(key); const [a, b] = g.teams, wa = g.series.wins[a.id] || 0, wb = g.series.wins[b.id] || 0; if (wa === wb) return; const w = wa > wb ? a : b, l = wa > wb ? b : a; T(w.id).wins++; T(w.id).winT.push(g.t); T(l.id).out = true; if (g.round === champR) T(w.id).champ = true; }
      return;
    }
    if (!g.done) return; const [a, b] = g.teams; const w = a.winner ? a : b.winner ? b : a.score > b.score ? a : b.score > a.score ? b : null; if (!w) return; const l = w === a ? b : a;
    if (ev.season && g.round !== 0) { if (g.round === champR) { T(w.id).champ = true; } return; } // season: champion only from the title game, wins from the regular season
    T(w.id).wins++; T(w.id).winT.push(g.t); if (g.round > 0) T(l.id).out = true; if (g.round > 0 && g.round === champR) T(w.id).champ = true;
    const m = Math.abs(w.score - l.score); if (inEvent.has(w.id) && (!big || m > big.m)) big = { id: w.id, m, t: g.t };
  });
  if (big) T(big.id).big = true;
  // ROUND 2 D6: a play-in / First Four loser is out only once the real bracket has begun without it (a 7v8 play-in loser still has a second chance)
  const realBegun = gs.some((g) => g.round >= 1); preLost.forEach((id) => { const x = T(id); if (!(x.reached >= 1) && realBegun) x.out = true; });
  return R;
}
// ---------- has the event started? (ROUND 3, Nov 16 2026) ----------
// "Started" = a game of a lot team is in progress or final, OR the server clock is at/past the earliest kickoff, OR a hand-entered result exists,
// OR (plugged sources) the source says started / its start time has come / it holds any result. NEVER from a game that is only scheduled
// (teamResults' `reached` is set by scheduled games too and is not used here).
// What is known about the start lives in two places: KICK (in memory, the last good read) and `c.kick` on the Calcutta row (same shape, survives
// restarts): { at, t0: earliest kickoff ms | null, live: a game in progress/final, thru: until when "nothing scheduled" may be trusted }.
// startState() is PURE (row + cache + clock): bids and controls never wait on the feed; the feed is re-read in the background (touch -> refresh).
const RES = new Map(); // calc id -> { at, R, err, tryAt, busy }  the last results read
const KICK = new Map(); // calc id -> { at, t0, live, thru }
const HORIZON = 12 * 36e5, FEED_MS = 15000, WAIT_MS = 4000;
const anyResult = (R) => Object.values(R || {}).some((x) => x && (x.wins || x.reached || x.champ || x.out || x.big || x.place));
const sleep = (ms, v) => new Promise((ok) => { const t = setTimeout(() => ok(v), ms); if (t.unref) t.unref(); });
function setKick(id, t0, live, ms) { const p = KICK.get(id), now = D.now(); KICK.set(id, { at: now, t0: t0 == null ? null : t0, live: !!live || !!(p && p.live), thru: now + ms }); if (KICK.size > 3000) KICK.delete(KICK.keys().next().value); }
const kickOf = (c) => { const m = KICK.get(c.id), p = c.kick || null; return m && (!p || m.at >= p.at || m.live) ? m : p; };
async function feedResults(c) {
  const ev = EVENTS[c.ev]; if (ev.manualOnly) return {}; const ids = new Set(); c.lots.forEach((l) => l.teams.forEach((t) => ids.add(t.id)));
  if (ev.plug) { const S = SOURCES[ev.plug]; if (!S) throw new Error('source not registered'); const R = S.results ? (await S.results(c)) || {} : {}; let on = false, t0 = null;
    if (typeof S.started === 'function') { const v = await S.started(c); if (v !== true && v !== false) throw new Error('source cannot tell whether it started'); on = v; }
    if (typeof S.startTime === 'function') { const v = await S.startTime(c); if (v != null) { t0 = Number(v instanceof Date ? v.getTime() : v); if (!Number.isFinite(t0) || t0 <= 0) throw new Error('bad startTime'); } }
    setKick(c.id, t0, on || anyResult(R), 60e3); return R; }
  const today = chiDay(D.now()), games = []; const urls = urlsFor(c);
  for (let i = 0; i < urls.length; i += 4) (await Promise.all(urls.slice(i, i + 4).map((u) => getGames(u, today)))).forEach((g) => games.push(...g));
  const seen = new Set(), uniq = games.filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
  const rel = uniq.filter((g) => !g.off && g.teams.some((t) => ids.has(t.id)) && (!ev.roundOf || ev.roundOf(g) != null || (ev.prelim && ev.prelim.test(g.head || '')))); // the event's games with a lot team (postponed / cancelled games do not count)
  const ts = rel.map((g) => g.t).filter((t) => t > 0);
  setKick(c.id, ts.length ? Math.min(...ts) : null, rel.some((g) => g.done || g.state === 'in'), HORIZON);
  return teamResults(ev, uniq, ids);
}
// REVIEW FIX 1 + ROUND 2 D1-D3: who owns what is final once the event has started. `c.startedAt` is written on the Calcutta row the first time
// the start is seen (sticky: never cleared, survives restarts) and every ownership change checks startState() INSIDE its transaction.
const FROZEN = 'The event has started: who owns what is final now.', FEEDQ = 'The score feed cannot be read right now and the event may have started, so ownership is locked. Try again in a minute.';
function notice(c, by, what, raw) { c.notices = c.notices || []; c.notices.push({ at: D.now(), by: cleanName(by, 24), what: cleanName(raw ? what : what + ' (after the auction closed)', 180) }); if (c.notices.length > 50) c.notices = c.notices.slice(-50); }
function startOf(c) { // the earliest day the event can start (conservative): its window, else per event from the season
  if (c.win && c.win.from) return c.win.from; const ev = EVENTS[c.ev], sy = seasonYear(c.created, ev);
  return { nfl_po: (sy + 1) + '-01-08', nfl_season: sy + '-09-03', cfp: sy + '-12-18' }[c.ev] || null; }
const near = (c, now) => { const s0 = startOf(c); return !s0 || chiDay(now) >= addDay(s0, -2); }; // the feed is only asked from 2 days before the earliest start day
function startState(c, now) { // 'started' | 'open' | 'unknown' (unknown = fail closed). Never waits.
  if (c.startedAt || Object.keys(c.manual || {}).length) return 'started';
  const ev = EVENTS[c.ev]; if (ev.manualOnly) return 'open';
  const k = kickOf(c);
  if (k) { if (k.live || (k.t0 != null && now >= k.t0)) return 'started'; if (now < k.thru || (k.t0 != null && !ev.plug)) return 'open'; } // a known kickoff still ahead: open, however old the read
  const s0 = startOf(c); return !s0 || chiDay(now) >= s0 ? 'unknown' : 'open';
}
function refresh(c) { // one feed read per Calcutta at a time, in the background; never throws; resolves { ok, R }
  const x = RES.get(c.id) || {}; if (x.busy) return x.busy; const id = c.id;
  const p = Promise.race([feedResults(c), sleep(FEED_MS).then(() => { throw new Error('timeout'); })])
    .then((R) => { RES.set(id, { at: D.now(), tryAt: D.now(), R }); afterFeed(id); return { ok: true, R }; })
    .catch((e) => { console.error('calcutta feed:', e.message); const h = RES.get(id) || {}; RES.set(id, { at: h.at || 0, R: h.R || null, err: true, tryAt: D.now() }); return { ok: false, R: h.R || {} }; });
  RES.set(id, Object.assign({}, x, { busy: p })); return p;
}
function touch(c, now) { // called on polls, bids and controls: keeps the start information fresh without anyone waiting for it
  const ev = EVENTS[c.ev]; if (ev.manualOnly || c.startedAt || c.deleted || !near(c, now)) return; const x = RES.get(c.id) || {}; if (x.busy) return;
  const since = now - (x.tryAt || 0); if (since >= 0 && since < (ev.plug ? 5e3 : 30e3)) return; refresh(c); // ESPN: every 30 s while anyone has the Calcutta open (also after a failure); a source: every 5 s
}
function startNow(c) { // inside a transaction: mark started; an auction not finished is closed with a notice (ownership cannot change during the games)
  if (c.startedAt) return; c.startedAt = D.now(); audit(c, 'Oddable', 'The event has started: who owns what is final');
  if (c.a.status !== 'closed') { const n = c.lots.filter((l) => !c.sold[l.id]).length; c.a.status = 'closed'; c.a.cur = null; c.a.endsAt = null; c.a.nextAt = null; c.a.nextLeft = null; c.a.left = null; c.a.paused = false; c.a.closedAt = D.now(); notice(c, 'Oddable', 'The event has started: the auction is closed' + (n ? ' (' + n + ' lot' + (n === 1 ? '' : 's') + ' unsold)' : ''), true); }
}
async function markStarted(id) { try { const c = await mutCalc(id, (c) => { if (c.startedAt) return { nochange: true, v: c }; startNow(c); c.rev++; return c; }); syncIdx(c); } catch (e) { console.error('calcutta start:', e.message); } }
async function afterFeed(id) { // after a good read: keep `c.kick` on the row (restart-proof) and persist the start the moment it is seen
  try { const k = KICK.get(id); if (!k) return; const row = await loadRow(id); if (!row || row.data.deleted) return; const now = D.now();
    const stale = (p) => !p || p.t0 !== k.t0 || !!p.live !== !!k.live || p.thru - now < Math.min(HORIZON / 2, (k.thru - k.at) / 2) && !EVENTS[row.data.ev].plug;
    const go = (c) => !c.startedAt && startState(c, now) === 'started'; if (!stale(row.data.kick) && !go(row.data)) return; let st = false;
    const c = await mutCalc(id, (c) => { let ch = false; if (stale(c.kick)) { if (!c.kick || c.kick.t0 !== k.t0) c.rev++; c.kick = { at: k.at, t0: k.t0, live: k.live, thru: k.thru }; ch = true; } if (go(c)) { startNow(c); c.rev++; ch = st = true; } return ch ? c : { nochange: true, v: c }; });
    if (st) syncIdx(c);
  } catch (e) { console.error('calcutta kick:', e.message); }
}
// Before an ownership change. wait=false (bids, auction controls): the row, the cached kickoff times and the clock only (at most 300 ms, and only
// when nothing at all is known and the answer would otherwise be "locked"). wait=true (enter, unenter, buy-back): asks the feed/source first (<= 4 s).
// Returns 'started' (persisted), 'unknown' (fail closed) or false.
async function freezeCheck(id, wait) {
  const row = await loadRow(id, !!wait); if (!row) return false; const c = row.data, now = D.now(), ev = EVENTS[c.ev]; let st = startState(c, now);
  if (st !== 'started' && !ev.manualOnly && near(c, now)) {
    if (wait) { const x = RES.get(id) || {}, age = now - (x.at || 0); if (ev.plug || x.err || !x.at || age > 6e4 || age < 0) { const o = await Promise.race([refresh(c), sleep(WAIT_MS, { ok: false })]); if (!o.ok && ev.plug) return 'unknown'; /* a source that cannot answer: locked */ } }
    else { touch(c, now); if (st === 'unknown') await Promise.race([refresh(c), sleep(300)]); }
    st = startState(c, D.now());
  }
  if (st === 'started') { if (!c.startedAt) await markStarted(id); return 'started'; }
  return st === 'unknown' ? 'unknown' : false;
}
const frozenIf = (c, fz) => { const st = startState(c, D.now()); if (st === 'started' || fz === 'started') throw bad(409, FROZEN, { code: 'frozen' }); if (st === 'unknown' || fz === 'unknown') throw bad(409, FEEDQ, { code: 'feed' }); }; // inside the transaction
async function results(c, wait) { // feed results cached 5 min per Calcutta (1 min after a failure); a page never waits long on ESPN
  const h = RES.get(c.id), now = D.now(), fresh = h && (h.err ? now - h.tryAt < 6e4 && now >= h.tryAt : h.R && now - h.at < 5 * 6e4 && now >= h.at);
  let R = h && h.R; if (!fresh) { const p = refresh(c).then((o) => o.R); if (wait || !R) R = await Promise.race([p, sleep(wait ? 20000 : 2500, R || {})]); }
  R = clone(R || {}); Object.keys(c.manual || {}).forEach((id) => { const m = c.manual[id], x = R[id] = R[id] || { wins: 0, winT: [], reached: 0, reachT: {}, champ: false, out: false };
    if (m.wins != null) { const n = m.wins; while (x.winT.length < n) x.winT.push(9e15 + (m.at || 0)); /* hand-added wins are paid after the feed wins (slot order) */ x.winT = x.winT.slice(0, n); x.wins = n; }
    if (m.reached != null) { x.reached = m.reached; for (let r = 1; r <= m.reached; r++) if (x.reachT[r] == null) x.reachT[r] = 9e15 + (m.at || 0); }
    ['champ', 'out', 'big'].forEach((k) => { if (m[k] != null) x[k] = !!m[k]; }); if (m.place != null) x.place = m.place || null; x.manual = true; });
  ['champ', 'big'].forEach((k) => { const hand = Object.keys(c.manual || {}).filter((id) => c.manual[id][k] === true); if (hand.length) Object.keys(R).forEach((id) => { if (!hand.includes(id)) R[id][k] = false; }); }); // REVIEW FIX 7: a hand-entered champion / biggest win replaces the feed's
  return R;
}

// ---------- money: pot, take, payouts (cents; slots sum exactly to the pool) ----------
function slotAmounts(rows, poolC) { // every row pays n slots of pool*bp/10000; floors + leftover cents to the bigger payouts (bp desc, row, slot)
  const sl = []; rows.forEach((r, i) => { for (let s = 0; s < r.n; s++) sl.push({ i, s, bp: r.bp, c: Math.floor(poolC * r.bp / 10000) }); });
  let left = poolC - sl.reduce((a, x) => a + x.c, 0); const ord = sl.slice().sort((a, b) => b.bp - a.bp || a.i - b.i || a.s - b.s);
  for (let k = 0; left > 0 && k < ord.length; k++, left--) ord[k].c++;
  return rows.map((r, i) => sl.filter((x) => x.i === i).map((x) => x.c));
}
function money(c, R) {
  const ev = EVENTS[c.ev], rules = c.rules, potC = Object.values(c.sold).reduce((a, x) => a + Math.round(x.amt * 100), 0);
  const takeC = rules.take.kind === 'pct' ? Math.round(potC * rules.take.v / 100) : rules.take.kind === 'flat' ? Math.min(Math.round(rules.take.v * 100), potC) : 0, poolC = potC - takeC;
  const amts = slotAmounts(rules.rows, poolC), teamLot = {}; c.lots.forEach((l) => l.teams.forEach((t) => { teamLot[t.id] = l.id; }));
  const earnT = {}, rowsOut = [], add = (id, v) => { earnT[id] = (earnT[id] || 0) + v; };
  rules.rows.forEach((r, i) => {
    let evs = []; Object.keys(R).forEach((id) => { if (!teamLot[id]) return; const x = R[id];
      if (r.k === 'win') x.winT.forEach((t) => evs.push({ id, t }));
      else if (r.k === 'round' && x.reached >= r.r) evs.push({ id, t: x.reachT[r.r] || 0 });
      else if (r.k === 'champ' && x.champ) evs.push({ id, t: 0 });
      else if (r.k === 'big' && x.big) evs.push({ id, t: 0 });
      else if (r.k === 'place' && x.place === r.r) evs.push({ id, t: 0 }); });
    evs.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
    const a = amts[i]; let paid = 0; evs.forEach((e, k) => { const v = k < a.length ? a[k] : 0; add(e.id, v); paid += v; });
    rowsOut.push({ k: r.k, r: r.r || null, n: r.n, pct: r.bp / 100, label: r.label, each: a.length ? a[0] / 100 : 0, total: a.reduce((s, v) => s + v, 0) / 100, hits: evs.length, paid: paid / 100, over: evs.length > r.n });
  });
  const over = (() => { if (ev.manualOnly || ev.plug) { if (Object.values(R).some((x) => x.champ)) return true; const pl = rules.rows.filter((r) => r.k === 'place'); return !rules.rows.some((r) => r.k === 'champ') && pl.length > 0 && pl.every((r) => Object.values(R).some((x) => x.place === r.r)); } /* over = champion known, or every paid place filled (was: over from the start when the table had no champion row) */ return Object.values(R).some((x) => x.champ); })();
  const lots = c.lots.map((l) => { const e = l.teams.reduce((s, t) => s + (earnT[t.id] || 0), 0), s = c.sold[l.id];
    const alive = !over && l.teams.some((t) => !(R[t.id] && R[t.id].out)); const out = { id: l.id, name: l.name, field: !!l.field, earnedC: e, alive, teams: l.teams.map((t) => ({ id: t.id, name: t.name, abbr: t.abbr, r: R[t.id] ? { wins: R[t.id].wins, reached: R[t.id].reached, champ: !!R[t.id].champ, out: !!R[t.id].out, big: !!R[t.id].big, place: R[t.id].place || null, manual: !!R[t.id].manual } : null, earned: (earnT[t.id] || 0) / 100 })) };
    if (s) { out.sold = { amt: s.amt, how: s.how, at: s.at }; out.holder = s.pid ? { pid: s.pid, name: mName(c, s.pid) } : { pid: null, name: s.name }; out._hk = hKey(c, s); if (s.bb) { const w = bbWho(c, s.bb); out.bb = { pid: w.pid, name: w.name }; out._bk = hKey(c, s.bb); } }
    return out; });
  // Playbook play 10: winnings of lots nobody bought. 'roll' (default): shared among the sold lots pro rata to what each has earned so far
  // (floors, leftover cents to the bigger earners; waits as "unclaimed" until a sold lot has earned). 'carry': set aside for the next Calcutta.
  const unsoldRule = rules.unsold === 'carry' ? 'carry' : 'roll', unsoldC = lots.filter((l) => !l.sold).reduce((a, l) => a + l.earnedC, 0); let rolledC = 0;
  if (unsoldRule === 'roll' && unsoldC > 0) { const sl = lots.filter((l) => l.sold && l.earnedC > 0), baseC = sl.reduce((a, l) => a + l.earnedC, 0);
    if (baseC > 0) { let left = unsoldC; sl.forEach((l) => { l.rollC = Math.floor(unsoldC * l.earnedC / baseC); left -= l.rollC; }); const ord2 = sl.slice().sort((a, b) => b.earnedC - a.earnedC || a.id.localeCompare(b.id)); for (let k = 0; left > 0; k = (k + 1) % ord2.length, left--) ord2[k].rollC++; sl.forEach((l) => { l.earnedC += l.rollC; }); rolledC = unsoldC; } }
  const own = {}, O = (h, k) => (own[k] = own[k] || { key: k, pid: h.pid, name: h.name, spentC: 0, wonC: 0, lots: [], alive: 0, out: 0 }); // ROUND 3 S-ALL: one owner per ACCOUNT (member, account key or guest id); only typed names go by name
  lots.forEach((l) => { if (!l.sold) return; const amtC = Math.round(l.sold.amt * 100);
    if (l.bb) { const bbCost = Math.floor(amtC / 2), bbEarn = Math.floor(l.earnedC / 2); const w = O(l.holder, l._hk), b = O(l.bb, l._bk);
      w.spentC += amtC - bbCost; w.wonC += l.earnedC - bbEarn; w.lots.push({ id: l.id, name: l.name, cost: (amtC - bbCost) / 100, earned: (l.earnedC - bbEarn) / 100, share: 'half', alive: l.alive });
      b.spentC += bbCost; b.wonC += bbEarn; b.lots.push({ id: l.id, name: l.name, cost: bbCost / 100, earned: bbEarn / 100, share: 'half (bought back)', alive: l.alive });
      [w, b].forEach((o) => (l.alive ? o.alive++ : o.out++)); }
    else { const w = O(l.holder, l._hk); w.spentC += amtC; w.wonC += l.earnedC; w.lots.push({ id: l.id, name: l.name, cost: amtC / 100, earned: l.earnedC / 100, share: 'all', alive: l.alive }); l.alive ? w.alive++ : w.out++; } });
  const owners = Object.values(own).map((o) => ({ key: o.key, oid: crypto.createHash('sha256').update(c.id + '|' + o.key).digest('hex').slice(0, 10), pid: o.pid, name: o.name, spent: o.spentC / 100, won: o.wonC / 100, net: (o.wonC - o.spentC) / 100, alive: o.alive, out: o.out, lots: o.lots }));
  owners.sort((a, b) => b.won - a.won || a.spent - b.spent || a.name.localeCompare(b.name)); owners.forEach((o, i) => { o.place = i + 1; });
  const paidC = lots.filter((l) => l.sold).reduce((a, l) => a + l.earnedC, 0), waitC = unsoldC - rolledC; // paid to owners | not (yet) with an owner
  lots.forEach((l) => { l.earned = l.earnedC / 100; l.rolled = (l.rollC || 0) / 100; delete l.earnedC; delete l.rollC; delete l._hk; delete l._bk; });
  return { pot: potC / 100, take: takeC / 100, takeKind: rules.take.kind, takeV: rules.take.v, pool: poolC / 100, paidOut: paidC / 100, unclaimed: waitC / 100, rolled: rolledC / 100, carry: unsoldRule === 'carry' ? unsoldC / 100 : 0, unsoldRule, inPlay: (poolC - paidC - waitC) / 100, over, rows: rowsOut, lots, owners, main: rules.main };
}
const acctK = (k) => !!k && !/^n:/.test(k); // a member key or a guest id (not a typed name)
const bbWho = (c, h) => { if (h.pid) return { pid: h.pid, name: mName(c, h.pid) }; const m = acctK(h.k) ? c.members.find((x) => x.mk === h.k) : null; return m ? { pid: m.pid, name: m.name } : { pid: null, name: h.name || 'Player' }; }; // a co-owner who joined later is that member
const hKey = (c, h) => { const w = bbWho(c, h); return w.pid ? 'p:' + w.pid : acctK(h.k) ? 'k:' + h.k : 'n:' + String(h.name || '').toLowerCase(); };
const takeText = (r) => (r.take.kind === 'pct' && r.take.v ? 'Commissioner keeps ' + r.take.v + '% of the pot' : r.take.kind === 'flat' && r.take.v ? 'Commissioner keeps $' + (Number.isInteger(r.take.v) ? r.take.v : r.take.v.toFixed(2)) + ' of the pot' : 'Commissioner keeps nothing');

// ---------- views ----------
const porOut = (c, l, mk) => (l.por || []).map((e) => { const m = c.members.find((x) => x.mk === e.k); return { pid: m ? m.pid : null, name: m ? m.name : e.name || 'Player', me: !!mk && e.k === mk }; });
const porLocked = (c, l) => !!(l.porLockedAt || c.sold[l.id] || c.startedAt || (c.rules.mode === 'live' && c.a.status !== 'setup')); // ROUND 2 D4 + ROUND 3 #5
const isPor = (l, k) => (l.por || []).some((e) => e.k === k);
function pub(c) { const ev = EVENTS[c.ev]; return { id: c.id, kind: 'calcutta', name: c.name, ev: c.ev, evLabel: ev.label, sport: ev.sport, rounds: ev.rounds || [], rules: c.rules, takeText: takeText(c.rules), unsoldText: unsoldText(c.rules), lots: c.lots.map((l) => ({ id: l.id, name: l.name, field: !!l.field, teams: l.teams, por: porOut(c, l, null).map((p) => ({ name: p.name })) })), local: evLocal(c.ev), golf: c.golf || null, evtId: c.evtId || null, count: c.members.length, max: maxOf(c), commName: mName(c, (c.members.find((m) => m.mk === c.comm) || {}).pid), status: c.a.status, locked: !!c.locked, group: c.group ? { groupId: c.group.groupId, contestId: c.group.contestId } : null }; }
function full(c, mk, now) {
  const o = pub(c), comm = isComm(c, mk); o.role = comm ? 'comm' : memberOf(c, mk) ? 'member' : 'none'; if (o.role === 'none') return o;
  o.lots = c.lots.map((l) => ({ id: l.id, name: l.name, field: !!l.field, teams: l.teams, por: porOut(c, l, mk), porLocked: porLocked(c, l) }));
  o.me = memberOf(c, mk).pid; o.code = c.code; o.members = c.members.map((m) => ({ pid: m.pid, name: m.name, comm: m.mk === c.comm }));
  const a = c.a; o.a = { status: a.status, order: a.order, cur: a.cur, endsAt: a.endsAt, paused: !!a.paused, left: a.left, nextAt: a.nextAt, nextLeft: a.nextLeft || null, just: a.just, timer: c.rules.timer };
  const hb = a.cur ? high(c, a.cur) : null; o.a.high = hb ? { pid: hb.pid, name: mName(c, hb.pid), amt: hb.amt } : null; o.a.minNext = a.cur ? (hb ? hb.amt + c.rules.inc : c.rules.minBid) : null;
  o.a.bids = a.cur ? (c.bids[a.cur] || []).slice(-6).reverse().map((b) => ({ pid: b.pid, name: mName(c, b.pid), amt: b.amt, at: b.at })) : [];
  o.sold = c.a.order.filter((id) => c.sold[id]).map((id) => { const s = c.sold[id]; return { lot: id, name: lotOf(c, id).name, holder: s.pid ? { pid: s.pid, name: mName(c, s.pid) } : { pid: null, name: s.name }, amt: s.amt, at: s.at, how: s.how, bb: s.bb ? (s.bb.pid ? { pid: s.bb.pid, name: mName(c, s.bb.pid) } : { pid: null, name: s.bb.name }) : null }; }).sort((x, y) => y.at - x.at);
  const st = startState(c, now), k = kickOf(c); o.started = st === 'started'; o.feedLock = st === 'unknown'; o.kick = !o.started && k && k.t0 ? k.t0 : null; /* the moment ownership locks, when known */ o.unsold = c.lots.filter((l) => !c.sold[l.id]).length; o.notices = (c.notices || []).slice(-5).reverse(); o.a.undo = a.cur && (c.bids[a.cur] || []).length ? { k: 'bid' } : a.just && c.sold[a.just] && c.sold[a.just].how === 'auction' ? { k: 'sale', name: lotOf(c, a.just).name } : null;
  o.potSoFar = Object.values(c.sold).reduce((s, x) => s + x.amt, 0); o.now = now; o.rev = c.rev || 0; return o;
}
const canSee = (c, mk) => !!memberOf(c, mk);

// ---------- create (route + adapter) ----------
async function createCalc(e, b, opts) {
  const now = D.now(), mk = mkOf(e), nm = await nameOf(e, b && b.myName), mem = []; mem._me = { mk, name: nm }; const R = await cleanRules(b, now, mem), ak = akOf(e);
  const all = await idx(); if (Object.values(all).filter((x) => x.comm === mk && x.status !== 'closed').length >= 20) throw bad(400, 'You already run 20 open Calcuttas');
  let id; do { id = rnd(10); } while (all[id]); let code; do { code = newCode(); } while (Object.values(all).some((x) => x.code === code));
  const c = Object.assign({ id, code, comm: mk, ak, created: now, rev: 1, members: [{ pid: '', mk, name: nm, joined: now }], bids: {}, sold: {}, manual: {}, audit: [], locked: false, group: opts && opts.group ? opts.group : null }, R);
  c.members[0].pid = newPid(c); c.a = { status: 'setup', order: c.lots.map((l) => l.id), cur: null, endsAt: null, paused: false, left: null, nextAt: null, just: null };
  audit(c, nm, 'Created the Calcutta');
  await D.S.dbPut({ id: ROW(id), salt: 'x', pinhash: 'x', data: c, updated: now }, true); await capLoad(c); await syncIdx(c); touch(c, now); return c;
}

// ---------- routes ----------
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (!path.startsWith('/calcutta')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  try {
    const b = await body(req), ip = D.ip(req), now = D.now(), op = path.slice(10);
    if (op === 'peek') { // PUBLIC: an invite link's title before sign-in / sign-up. Only title + kind.
      rate('peek', ip, ip); /* REVIEW FIX 4: per IP (was one shared bucket) */ if (codeBlocked('c|i|' + ip)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.');
      const code = normCode(b.code), all = await idx(); let hit = null; if (code) Object.keys(all).forEach((id) => { if (sameCode(all[id].code, code)) hit = all[id]; });
      if (!hit) { codeFail('c|i|' + ip); throw bad(404, 'No Calcutta with that code'); } send(res, 200, { title: hit.name, kind: 'calcutta' }); return true;
    }
    const u = await me(req); try { await repairIdx(); } catch (e) {}
    if (op === 'events') { send(res, 200, { events: Object.keys(EVENTS).map((k) => { const ev = EVENTS[k]; return { key: k, label: ev.label, sport: ev.sport, on: evOn(k), local: evLocal(k), teams: ev.teams || 0, kinds: ev.kinds, rounds: ev.rounds || [], manualOnly: !!ev.manualOnly, needsRef: ev.needsRef || null, plug: !!ev.plug, rows: ev.rows.map((r) => ({ k: r.k, r: r.r || null, n: r.n, pct: r.bp / 100, label: rowLabel(ev, r) })) }; }), minBids: MINB, incs: INCS, timers: TIMERS, timer0: TIMER0, unsold: Object.keys(UNSOLD).map((k) => ({ key: k, label: UNSOLD[k], text: unsoldText({ unsold: k }) })), max: await maxFor(akOf(u.e), ''), capText: PRICE }); return true; }
    if (op === 'teams') { const k = String(b.ev || ''); if (!EVENTS[k]) throw bad(400, 'Pick an event'); if (!evOn(k)) throw bad(400, 'That event is coming soon'); const ref = srcRef(EVENTS[k], b); try { send(res, 200, { teams: (await teamsOf(k, ref)).map((t) => ({ id: t.id, name: t.name, abbr: t.abbr, players: (t.players || []).length })) }); } catch (e) { throw bad(502, 'Could not load the teams. Try again.'); } return true; }
    if (op === 'mine') { const all = await idx(), out = []; Object.keys(all).forEach((id) => { const x = all[id]; if ((x.mks || []).includes(u.mk)) out.push({ id, name: x.name, ev: x.ev, evLabel: (EVENTS[x.ev] || {}).label || '', status: x.status, comm: x.comm === u.mk, created: x.created, group: x.group }); }); out.sort((a, b2) => b2.created - a.created); send(res, 200, { calcs: out.slice(0, 50), max: await maxFor(akOf(u.e), ''), capText: PRICE }); return true; }
    if (op === 'create') { rate('create', u.mk, ip); const c = await createCalc(u.e, b); send(res, 200, { calc: full(c, u.mk, now) }); return true; }
    if (op === 'preview' || op === 'join') {
      if (codeBlocked('c|a|' + u.mk) || codeBlocked('c|i|' + ip)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.');
      rate('join', u.mk, ip); const code = normCode(b.code), all = await idx(); let id = null; if (code) Object.keys(all).forEach((k) => { if (sameCode(all[k].code, code)) id = k; });
      if (!id) { codeFail('c|a|' + u.mk); codeFail('c|i|' + ip); throw bad(404, 'No Calcutta with that code'); }
      { const r0 = await loadRow(id); if (r0) await capLoad(r0.data); }
      if (op === 'preview') { const c = await loadRow(id); if (!c) throw bad(404, 'No Calcutta with that code'); const o = full(c.data, u.mk, now); send(res, 200, { calc: o }); return true; }
      const nm = await nameOf(u.e, b.myName);
      const c = await mutCalc(id, (c) => { if (memberOf(c, u.mk)) return { nochange: true, v: c }; if (c.a.status === 'closed') throw bad(409, 'This auction is over'); if (c.group) throw bad(409, 'Join this Calcutta from its group');
        if (holders(c).size >= maxOf(c)) throw bad(409, capMsg(c, 'This Calcutta is full'), { code: 'cap' });
        c.members.push({ pid: newPid(c), mk: u.mk, name: nm, joined: now }); c.rev++; audit(c, nm, 'Joined'); return c; });
      await syncIdx(c); send(res, 200, { calc: full(c, u.mk, now) }); return true;
    }
    const id = String(b.id || ''); if (!/^[A-Z2-9]{10}$/.test(id)) throw bad(404, 'Calcutta not found');
    { const r0 = await loadRow(id); if (r0 && !r0.data.deleted) { const c0 = r0.data; if (!c0.ak && isComm(c0, u.mk) && akOf(u.e)) { try { c0.ak = (await mutCalc(id, (c) => { if (c.ak) return { nochange: true, v: c }; c.ak = akOf(u.e); return c; })).ak; } catch (e) {} } await capLoad(c0); // the shared people limit for this Calcutta
      if (isComm(c0, u.mk) && c0.a.status === 'setup' && (op === 'get' || op === 'state' || op === 'board')) { const e0 = (await idx())[id]; if (!e0 || D.now() - (e0.act || 0) >= DAY) syncIdx(c0).catch(() => {}); } } } // ROUND 3 #7: the commissioner looking at a set-up is activity (and puts a pruned one back)
    if (op === 'get' || op === 'state') {
      let row = await loadRow(id); if (!row || !canSee(row.data, u.mk)) throw bad(404, 'Calcutta not found');
      if (needsSettle(row.data, now)) { await mutCalc(id, (c) => { c.rev++; return c; }); row = await loadRow(id); }
      touch(row.data, now); if (!row.data.startedAt && startState(row.data, now) === 'started') { await markStarted(id); row = await loadRow(id, true); } // ROUND 2 D2 + ROUND 3: at the kickoff (clock) or the first game seen live, the start is written down and a running auction closes
      if (op === 'state' && Number(b.rev) === Number(row.data.rev)) { const c = row.data; send(res, 200, { same: true, rev: c.rev, now, a: { endsAt: c.a.endsAt, nextAt: c.a.nextAt, paused: !!c.a.paused } }); return true; }
      send(res, 200, { calc: full(row.data, u.mk, now) }); return true;
    }
    if (op === 'board') { let row = await loadRow(id); if (!row || !canSee(row.data, u.mk)) throw bad(404, 'Calcutta not found'); let R = await results(row.data, false);
      if (!row.data.startedAt && startState(row.data, D.now()) === 'started') { await markStarted(id); row = await loadRow(id, true); } // ROUND 2 D1: persist the start (ROUND 3: never from games that are only scheduled)
      const c = row.data, m = money(c, R);
      m.owners.forEach((o) => { o.me = o.pid === (memberOf(c, u.mk) || {}).pid; delete o.key; }); m.lots.forEach((l) => { l.por = porOut(c, lotOf(c, l.id), u.mk); l.porLocked = porLocked(c, lotOf(c, l.id)); }); const r = RES.get(c.id);
      send(res, 200, { calc: full(c, u.mk, now), board: m, audit: (c.audit || []).slice(-120).reverse(), feedAt: r && r.at ? r.at : null, manual: Object.keys(c.manual || {}).length }); return true; }
    if (op === 'bid') {
      rate('bid', u.mk, ip); const amt = Number(b.amt), lot = String(b.lot || ''); const fz = await freezeCheck(id, false); // ROUND 3 #4: never waits on the feed
      if (!(Number.isInteger(amt) && amt > 0 && amt <= 100000)) throw bad(400, 'Bids are whole dollars up to $100,000');
      const c = await mutCalc(id, (c) => {
        const m = memberOf(c, u.mk); if (!m) throw bad(403, 'Join this Calcutta to bid');
        if (c.members.indexOf(m) >= maxOf(c)) throw bad(403, capMsg(c, 'Only the first ' + maxOf(c) + ' people can bid'), { code: 'cap' });
        if (c.rules.mode !== 'live') throw bad(409, 'This Calcutta is entered by the commissioner, not bid live');
        frozenIf(c, fz);
        if (c.a.status !== 'live') throw bad(409, c.a.status === 'closed' ? 'The auction is over' : 'The auction has not started');
        if (c.sold[lot]) throw bad(409, 'Sold. That lot is gone.', { code: 'sold' });
        if (c.a.cur !== lot) throw bad(409, 'That lot is not on the block', { code: 'stale' });
        if (c.a.paused) throw bad(409, 'The auction is paused');
        const h = high(c, lot), min = h ? h.amt + c.rules.inc : c.rules.minBid;
        if (h && h.pid === m.pid) throw bad(409, 'You already have the high bid', { code: 'high' });
        if (amt < min) throw bad(409, h ? 'Outbid. The high bid is now $' + h.amt + ' (' + mName(c, h.pid) + '). Next bid at least $' + min + '.' : 'Lowest bid is $' + min, { code: h ? 'outbid' : 'min', high: h ? h.amt : null, min });
        (c.bids[lot] = c.bids[lot] || []).push({ pid: m.pid, amt, at: now }); if (c.bids[lot].length > 400) c.bids[lot] = c.bids[lot].slice(-400);
        c.a.endsAt = now + c.rules.timer * 1000; if (!c.locked) { c.locked = true; audit(c, m.name, 'First bid. Rules are locked.'); } c.rev++; return c;
      });
      send(res, 200, { ok: true, calc: full(c, u.mk, now) }); return true;
    }
    if (op === 'ctl') {
      rate('ctl', u.mk, ip); const what = String(b.op || ''); let idxSync = false; let fz = false; if (['undo', 'sold', 'next', 'start', 'resume'].includes(what)) fz = await freezeCheck(id, false); /* ROUND 2 D2; ROUND 3 #4: never waits on the feed */
      const c = await mutCalc(id, (c) => {
        if (!isComm(c, u.mk)) throw bad(403, 'Only the commissioner runs the auction'); const by = mName(c, memberOf(c, u.mk).pid), a = c.a;
        if (['undo', 'sold', 'next', 'start', 'resume'].includes(what)) frozenIf(c, fz);
        const tell = (txt) => { audit(c, by, txt); notice(c, by, txt, true); }; // Playbook play 10: Undo / Sold now / Pause reach every member live (notice on the auction screen), not only the history
        if (what === 'start') { if (c.rules.mode !== 'live') throw bad(409, 'This Calcutta is entered by hand'); if (a.status !== 'setup') throw bad(409, 'Already started');
          if (c.rules.order === 'random') { const o = a.order.slice(); for (let i = o.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [o[i], o[j]] = [o[j], o[i]]; } a.order = o; }
          a.status = 'live'; openNext(c, null); audit(c, by, 'Started the auction'); idxSync = true; }
        else if (what === 'pause') { if (a.status !== 'live' || a.paused) return { nochange: true, v: c }; a.paused = true; a.left = a.endsAt ? Math.max(1000, a.endsAt - D.now()) : null; a.endsAt = null; a.nextLeft = a.nextAt ? Math.max(0, a.nextAt - D.now()) : null; a.nextAt = null; tell('The commissioner paused the auction'); }
        else if (what === 'resume') { if (a.status !== 'live' || !a.paused) return { nochange: true, v: c }; a.paused = false; a.endsAt = a.left != null ? D.now() + a.left : null; a.nextAt = a.nextLeft != null ? D.now() + a.nextLeft : (!a.cur ? D.now() : null); a.left = null; a.nextLeft = null; tell('The commissioner resumed the auction'); }
        else if (what === 'undo') {
          if (a.cur && (c.bids[a.cur] || []).length) { const x = c.bids[a.cur].pop(); a.endsAt = c.bids[a.cur].length && !a.paused ? D.now() + c.rules.timer * 1000 : null; if (a.paused) a.left = c.bids[a.cur].length ? c.rules.timer * 1000 : null; tell('The commissioner undid a $' + x.amt + ' bid by ' + mName(c, x.pid) + ' on ' + lotOf(c, a.cur).name); }
          else if (a.just && c.sold[a.just] && c.sold[a.just].how === 'auction') { const lot = a.just, s = c.sold[lot]; delete c.sold[lot]; a.cur = lot; /* REVIEW FIX 6: the bids stay; the winning bid is the high bid again */ a.just = null; a.nextAt = null; a.nextLeft = null; if (a.status === 'closed') { a.status = 'live'; a.closedAt = null; idxSync = true; }
            a.endsAt = (c.bids[lot] || []).length && !a.paused ? D.now() + c.rules.timer * 1000 : null; if (a.paused) a.left = (c.bids[lot] || []).length ? c.rules.timer * 1000 : null; tell('The commissioner undid the sale of ' + lotOf(c, lot).name + ' ($' + s.amt + '); the lot is back on the block with its bids'); }
          else throw bad(409, 'Nothing to undo');
        }
        else if (what === 'sold') { if (a.status !== 'live' || !a.cur || !high(c, a.cur)) throw bad(409, 'No bid to sell'); { const h = high(c, a.cur); notice(c, by, 'The commissioner used Sold now: ' + lotOf(c, a.cur).name + ' to ' + mName(c, h.pid) + ' for $' + h.amt, true); } sell(c, a.cur, D.now(), by); if (a.status === 'closed') idxSync = true; }
        else if (what === 'next') { if (a.status !== 'live') throw bad(409, 'The auction is not running'); if (a.cur && high(c, a.cur)) throw bad(409, 'There is a bid on this lot. Sell it or undo the bids first.'); const from = a.cur || a.just; openNext(c, from); a.just = null; if (a.paused) { a.left = null; } audit(c, by, 'Opened ' + lotOf(c, a.cur).name); }
        else if (what === 'reorder') { const o = Array.isArray(b.order) ? b.order.map(String) : []; if (o.length !== c.lots.length || new Set(o).size !== o.length || o.some((x) => !lotOf(c, x))) throw bad(400, 'Send every lot once'); a.order = o; audit(c, by, 'Changed the auction order'); }
        else if (what === 'end') { if (a.status !== 'live') throw bad(409, 'The auction is not running'); if (a.cur && high(c, a.cur)) throw bad(409, 'There is a bid on this lot. Sell it or undo the bids first.'); a.status = 'closed'; a.cur = null; a.endsAt = null; a.nextAt = null; a.closedAt = D.now(); audit(c, by, 'Ended the auction with ' + unsold(c).length + ' lot(s) unsold'); idxSync = true; }
        else throw bad(400, 'Unknown control');
        c.rev++; return c;
      }, u.mk);
      if (idxSync) await syncIdx(c); send(res, 200, { calc: full(c, u.mk, now) }); return true;
    }
    if (op === 'buyback' || op === 'por') { // OWNER DECISION Nov 16 2026: classic golf Calcutta buy-back (see HANDOFF Decisions)
      rate('write', u.mk, ip); const lot = String(b.lot || ''); let fz = false; fz = await freezeCheck(id, true);
      const c = await mutCalc(id, (c) => {
        const me = memberOf(c, u.mk), by = me.name, comm = isComm(c, u.mk), l = lotOf(c, lot); if (!l) throw bad(404, 'No such lot');
        if (!evLocal(c.ev)) throw bad(409, 'Buy back half is not available for pro teams or golfers');
        if (op === 'por') { // commissioner sets the lot's players of record (members, guest ids or names)
          if (!comm) throw bad(403, 'Only the commissioner sets players of record');
          if (porLocked(c, l) || fz || startState(c, D.now()) !== 'open') throw bad(409, 'Players of record are locked once the lot is sold (or the live auction has started)', { code: 'porlocked' }); // ROUND 2 D4 + ROUND 3 #5: sticky, a lot that was EVER sold or entered stays locked
          const was = (l.por || []).length ? porOut(c, l, null).map((p) => p.name).join(', ') : 'none';
          const mem = c.members.slice(); mem._me = me; let por; if (b.add) { por = (l.por || []).slice(); const e = porEntry(b.add, mem); if (!por.some((x) => x.k === e.k)) por.push(e); if (por.length > 8) throw bad(400, 'Up to 8 players of record per lot'); } else if (b.remove != null) { const i = Number(b.remove); por = (l.por || []).filter((x, j) => j !== i); } else por = cleanPor(b.players, mem);
          l.por = por; const ptxt = 'Players of record for ' + l.name + ': ' + (por.length ? porOut(c, l, null).map((p) => p.name).join(', ') : 'none'); audit(c, by, ptxt + ' (was: ' + was + ')'); notice(c, by, ptxt, true); c.rev++; return c; }
        if (!c.rules.buyBack) throw bad(409, 'Buy back half is off for this Calcutta'); frozenIf(c, fz); const wasClosed = c.a.status === 'closed';
        const s = c.sold[lot]; if (!s) throw bad(409, 'That lot is not sold yet');
        if (!(l.por || []).length) throw bad(409, 'Only the lot\'s own player(s) can buy it back, and this lot has none in the group');
        const mine = isPor(l, u.mk);
        if (b.clear) { if (!s.bb) return { nochange: true, v: c }; if (!comm && !(s.bb.k && s.bb.k === u.mk)) throw bad(403, 'Only the commissioner or the player who bought back can remove it'); audit(c, by, 'Removed the buy-back on ' + l.name); if (wasClosed) notice(c, by, 'Removed the buy-back on ' + l.name); s.bb = null; c.rev++; return c; }
        if (s.bb) throw bad(409, 'Half of this lot is already bought back');
        let e; // which player of record buys back
        if (!comm || b.self) { if (!mine) throw bad(403, 'Only the lot\'s own player(s) can buy back half'); e = l.por.find((x) => x.k === u.mk); }
        else { const i = Number(b.who); if (!(Number.isInteger(i) && i >= 0 && i < l.por.length)) throw bad(400, 'Pick which player of record buys back'); e = l.por[i]; }
        const m = c.members.find((x) => x.mk === e.k), w = m ? { pid: m.pid, name: '' } : { pid: null, name: e.name || 'Player' };
        if ((w.pid && w.pid === s.pid) || (!w.pid && !s.pid && w.name.toLowerCase() === s.name.toLowerCase())) throw bad(400, 'The buyer cannot buy back from themselves');
        s.bb = { pid: w.pid, name: w.name, k: e.k, at: D.now() }; if (holders(c).size > maxOf(c)) throw bad(409, capMsg(c, 'Too many people'), { code: 'cap' });
        audit(c, by, (w.pid ? mName(c, w.pid) : w.name) + ' bought back half of ' + l.name + ' for $' + (Math.floor(s.amt * 100 / 2) / 100) + (comm && !mine ? ' (recorded by the commissioner)' : '')); if (wasClosed) notice(c, by, (w.pid ? mName(c, w.pid) : w.name) + ' bought back half of ' + l.name); c.rev++; return c;
      }, u.mk);
      if (op === 'por') await syncIdx(c); /* S-ALL: the index knows each lot's players */ send(res, 200, { calc: full(c, u.mk, now) }); return true;
    }
    if (op === 'enter' || op === 'unenter' || op === 'result' || op === 'edit' || op === 'delete' || op === 'close') {
      rate('write', u.mk, ip); let idxSync = op === 'enter' || op === 'unenter' || op === 'close';
      if (op === 'edit') { const row0 = await loadRow(id, true); if (!row0 || !canSee(row0.data, u.mk)) throw bad(404, 'Calcutta not found'); const mem = row0.data.members.slice(); mem._me = memberOf(row0.data, u.mk); const R = await cleanRules(b, now, mem); const c = await mutCalc(id, (c) => { if (!isComm(c, u.mk)) throw bad(403, 'Only the commissioner can change the rules'); if (c.locked || c.a.status !== 'setup') throw bad(409, 'Rules are locked. The auction has started.'); Object.assign(c, R); c.a.order = c.lots.map((l) => l.id); c.rev++; audit(c, mName(c, memberOf(c, u.mk).pid), 'Edited the rules'); return c; }, u.mk); await syncIdx(c); send(res, 200, { calc: full(c, u.mk, now) }); return true; }
      if (op === 'delete') { await mutCalc(id, (c) => { if (!isComm(c, u.mk)) throw bad(403, 'Only the commissioner can delete it'); if (c.locked) throw bad(409, 'Bids are in. It cannot be deleted.'); c.a.status = 'closed'; c.deleted = true; c.members = c.members.filter((m) => m.mk === c.comm); c.rev++; return c; }, u.mk);
        try { await mutRow(IDX, { calcs: {} }, (d) => { delete d.calcs[id]; return {}; }); } catch (e) {} IDXC.at = 0; send(res, 200, { ok: true }); return true; }
      let fz = false; if (op === 'enter' || op === 'unenter') fz = await freezeCheck(id, true);
      const c = await mutCalc(id, (c) => {
        if (!isComm(c, u.mk)) throw bad(403, 'Only the commissioner can do that'); if (op === 'enter' || op === 'unenter') frozenIf(c, fz); const wasClosed = c.a.status === 'closed'; const by = mName(c, memberOf(c, u.mk).pid), lot = String(b.lot || '');
        const who = () => { if (b.pid) { const m = c.members.find((x) => x.pid === String(b.pid)); if (!m) throw bad(404, 'Not a member'); return { pid: m.pid, name: '' }; } const n = cleanName(b.name, 24); if (n.length < 2) throw bad(400, 'Type who bought it (2+ characters) or pick a member'); return { pid: null, name: n }; };
        if (op === 'enter') { if (c.rules.mode !== 'manual') throw bad(409, 'This Calcutta is bid live in the app'); if (!lotOf(c, lot)) throw bad(404, 'No such lot'); const amt = Number(b.amt); if (!(Number.isInteger(amt) && amt >= c.rules.minBid && amt <= 100000)) throw bad(400, 'Amount: whole dollars, at least $' + c.rules.minBid);
          const w = who(); const before = c.sold[lot]; if (!lotOf(c, lot).porLockedAt) { porLock(c, lot); if (evLocal(c.ev)) audit(c, by, 'Players of record for ' + lotOf(c, lot).name + ' are locked (the lot was entered)'); } c.sold[lot] = { pid: w.pid, name: w.name, amt, at: D.now(), how: 'entered', bb: before && before.bb && (before.bb.pid ? before.bb.pid !== w.pid : true) ? before.bb : null };
          if (holders(c).size > maxOf(c)) throw bad(409, capMsg(c, 'Too many people'), { code: 'cap' });
          if (!c.locked) { c.locked = true; } c.a.status = unsold(c).length ? 'live' : 'closed'; const txt = (before ? 'Changed ' : 'Entered ') + lotOf(c, lot).name + ': ' + (w.pid ? mName(c, w.pid) : w.name) + ' $' + amt + (before ? ' (was ' + (before.pid ? mName(c, before.pid) : before.name) + ' $' + before.amt + ')' : ''); audit(c, by, txt); if (wasClosed) notice(c, by, txt); }
        else if (op === 'unenter') { if (c.rules.mode !== 'manual') throw bad(409, 'Use Undo in the live auction'); const s = c.sold[lot]; if (!s) throw bad(404, 'Nothing entered for that lot'); delete c.sold[lot]; c.a.status = 'live'; /* REVIEW FIX 1: never unlocks once anything was entered */ const txt = 'Removed the result for ' + lotOf(c, lot).name + ' (' + (s.pid ? mName(c, s.pid) : s.name) + ' $' + s.amt + ')'; audit(c, by, txt); if (wasClosed) notice(c, by, txt); }
        else if (op === 'result') { // manual result entry (fallback for any event without a feed); every change is in the audit trail
          const tid = String(b.team || ''); let team = null; c.lots.forEach((l) => l.teams.forEach((t) => { if (t.id === tid) team = t; })); if (!team) throw bad(404, 'No such team');
          const ev = EVENTS[c.ev], cur = Object.assign({}, c.manual[tid] || {}), nx = {};
          if (b.clear) { if (!c.manual[tid]) return { nochange: true, v: c }; delete c.manual[tid]; audit(c, by, 'Cleared the hand-entered result for ' + team.name + ' (back to the score feed)'); c.rev++; return c; }
          if (b.wins != null) { const v = Number(b.wins); if (!(Number.isInteger(v) && v >= 0 && v <= 30)) throw bad(400, 'Wins: 0 to 30'); nx.wins = v; }
          if (b.reached != null) { const v = Number(b.reached); if (!(Number.isInteger(v) && v >= 0 && v <= (ev.rounds || []).length)) throw bad(400, 'Pick a round from the list'); nx.reached = v; }
          if (b.place != null) { const v = Number(b.place); if (!(Number.isInteger(v) && v >= 0 && v <= 200)) throw bad(400, 'Place: 0 to 200'); nx.place = v; }
          ['champ', 'out', 'big'].forEach((k) => { if (b[k] != null) nx[k] = !!b[k]; });
          if (!Object.keys(nx).length) throw bad(400, 'Nothing to change');
          if (startState(c, D.now()) !== 'started') { // ROUND 3 #6: the FIRST result starts the event for good; the commissioner must say so, and say so again when lots are still unsold
            const n = c.lots.filter((l) => !c.sold[l.id]).length, msg = 'Entering a result starts the event. Sales, buy-backs and players lock for good.' + (n ? ' ' + n + ' lot' + (n === 1 ? ' is' : 's are') + ' still ' + (c.rules.mode === 'manual' ? 'not entered' : 'unsold') + ': this will close the auction with ' + n + ' lot' + (n === 1 ? '' : 's') + ' unsold.' : '');
            if (b.confirm !== true || (n > 0 && Number(b.closeUnsold) !== n)) throw bad(409, msg, { code: 'confirmstart', unsold: n });
            audit(c, by, 'Confirmed: entering a result starts the event' + (n ? ' and closes the auction with ' + n + ' lot' + (n === 1 ? '' : 's') + ' unsold' : '')); idxSync = true; }
          if (nx.champ) Object.keys(c.manual).forEach((k) => { if (k !== tid && c.manual[k].champ) c.manual[k].champ = false; });
          c.manual[tid] = Object.assign(cur, nx, { at: D.now() }); startNow(c); /* ROUND 2 D3: a result means the event has started, for good */ audit(c, by, 'Result for ' + team.name + ': ' + Object.keys(nx).map((k) => k + ' ' + (nx[k] === true ? 'yes' : nx[k] === false ? 'no' : nx[k])).join(', '));
        }
        else if (op === 'close') { if (c.rules.mode !== 'manual') throw bad(409, 'Use End auction'); c.a.status = 'closed'; audit(c, by, 'Closed the results'); }
        c.rev++; return c;
      }, u.mk);
      if (idxSync) await syncIdx(c); send(res, 200, { calc: full(c, u.mk, now) }); return true;
    }
    send(res, 404, { error: 'not found' }); return true;
  } catch (e) { if (!e.status) console.error('calcutta:', e.message); const o = { error: e.status ? e.message : 'Calcutta error, try again' }; ['code', 'high', 'min', 'total', 'unsold'].forEach((k) => { if (e[k] !== undefined) o[k] = e[k]; }); send(res, e.status || 500, o); return true; }
}

// ---------- adapter for Groups (manager wires these later; see HANDOFF "Calcutta (engine v1)") ----------
async function attachToGroup(id, groupId, contestId) { const c = await mutCalc(id, (c) => { c.group = { groupId: cleanName(groupId, 40), contestId: cleanName(contestId, 40) }; c.rev++; return c; }); await syncIdx(c); return { id: c.id, group: c.group }; }
async function potSummary(id) { const row = await loadRow(id); if (!row) return null; const c = row.data, m = money(c, await results(c, false)); return { bids: m.pot, take: m.take, pool: m.pool, main: m.main, paidOut: m.paidOut, inPlay: m.inPlay, payouts: m.owners.map((o) => ({ pid: o.pid, name: o.name, spent: o.spent, won: o.won })) }; }
// Stats contract (stats coder). OWNER DECISION S-ALL (Nov 16 2026): one record for EVERY Calcutta the user is in as a buyer, a co-owner
// (bought back half) or a team's own player (player of record), with the team(s), price paid (spent), payout (won) and net (pl).
// userKey = account id (acct.who) or member key. A team player who owns no share gets a record with spent/won/pl 0 and the team's result.
async function statsFor(userKey, opt) {
  const guest = /^g:[\w-]{1,40}$/.test(String(userKey)); // a guest id works too (a guest has no dashboard until they claim an account: claimGuest)
  const mk = guest || /^[0-9a-f]{24}$/.test(String(userKey)) ? String(userKey) : mkOf(String(userKey)), from = (opt && opt.from) || '0000-00-00', to = (opt && opt.to) || '9999-99-99';
  const all = await idx(), out = [];
  for (const id of Object.keys(all)) { const e = all[id]; if (!(e.mks || []).includes(mk) && !(e.pks || []).includes(mk) && !(e.gks || []).includes(mk) && !((!e.pks || (guest && !e.gks)) && evLocal(e.ev))) continue; // old entries without pks / gks: local events are opened
    const row = await loadRow(id); if (!row || row.data.deleted) continue; const c = row.data, m = memberOf(c, mk), myPid = m ? m.pid : null;
    const mine = c.lots.filter((l) => { const s = c.sold[l.id]; return isPor(l, mk) || (s && myPid && (s.pid === myPid || (s.bb && s.bb.pid === myPid))) || (s && s.bb && s.bb.k === mk); });
    if (!mine.length) continue; // a member who bought nothing and plays on no team is not in this Calcutta's money
    const sales = Object.values(c.sold).map((s) => s.at).filter(Boolean), date = chiDay(sales.length ? Math.min(...sales) : c.created); if (date < from || date > to) continue;
    const mo = money(c, await results(c, true)); let spentC = 0, wonC = 0; const roles = new Set(), teams = [];
    mine.forEach((l) => { const s = c.sold[l.id], ml = mo.lots.find((x) => x.id === l.id), earnC = Math.round(ml.earned * 100), amtC = s ? Math.round(s.amt * 100) : 0;
      const buyer = !!(s && myPid && s.pid === myPid), co = !!(s && s.bb && ((myPid && s.bb.pid === myPid) || s.bb.k === mk)), player = isPor(l, mk);
      let cost = 0, earned = 0, share = 'none';
      if (buyer) { cost = s.bb ? amtC - Math.floor(amtC / 2) : amtC; earned = s.bb ? earnC - Math.floor(earnC / 2) : earnC; share = s.bb ? 'half' : 'all'; roles.add('buyer'); }
      if (co) { cost += Math.floor(amtC / 2); earned += Math.floor(earnC / 2); share = buyer ? 'all' : 'half (bought back)'; roles.add('co-owner'); }
      if (player) roles.add('player');
      spentC += cost; wonC += earned;
      teams.push({ lot: l.id, name: l.name, teams: l.teams.map((t) => t.name), role: [buyer && 'buyer', co && 'co-owner', player && 'player'].filter(Boolean).join(' + '), share, cost: cost / 100, earned: earned / 100, net: (earned - cost) / 100,
        price: s ? s.amt : null, lotEarned: ml.earned, alive: ml.alive, sold: !!s, holder: ml.holder ? ml.holder.name : null }); });
    const o = mo.owners.find((x) => x.key === (myPid ? 'p:' + myPid : 'k:' + mk)); // ROUND 3 S-ALL: by account key, never by display name
    const owns = roles.has('buyer') || roles.has('co-owner');
    out.push(Object.assign({ src: 'calcutta', id: c.id, date, sport: EVENTS[c.ev].sport, kind: 'calcutta' }, c.group ? { groupId: c.group.groupId, contestId: c.group.contestId } : {}, { title: c.name, result: null },
      owns && o ? { place: { n: o.place, of: mo.owners.length } } /* REVIEW FIX 5: stats contract {n, of} */ : {},
      { spent: spentC / 100, won: wonC / 100, pl: (wonC - spentC) / 100, verified: true,
        extra: { role: [...roles], over: mo.over, ev: c.ev, teams, lots: teams.filter((t) => t.share !== 'none').map((t) => ({ name: t.name, cost: t.cost, earned: t.earned })) } }));
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
// Players of record from the group side (golf-day teams, pickleball pairs): players = account ids, 24-hex member keys, 'g:<guest id>' or {name}.
async function setPlayersOfRecord(id, lotId, players) { const c = await mutCalc(id, (c) => { if (!evLocal(c.ev)) throw bad(409, 'Players of record are only for local events'); const l = lotOf(c, String(lotId)); if (!l) throw bad(404, 'No such lot'); if (porLocked(c, l) || startState(c, D.now()) !== 'open') throw bad(409, 'Players of record are locked once the lot is sold (or the live auction has started)'); const was = (l.por || []).length ? porOut(c, l, null).map((p) => p.name).join(', ') : 'none'; l.por = cleanPor(players, c.members); audit(c, 'Group', 'Players of record for ' + l.name + ' set by the group: ' + (l.por.length ? porOut(c, l, null).map((p) => p.name).join(', ') : 'none') + ' (was: ' + was + ')'); notice(c, 'Group', 'Players of record for ' + l.name + ' set by the group', true); c.rev++; return c; }); await syncIdx(c); return { id: c.id, lot: lotId, count: lotOf(c, String(lotId)).por.length }; }
// ROUND 3 S-ALL: a guest ('g:<guest id>' player of record / co-owner) who later claims an Oddable account. The golf / events coder calls this once
// at the claim: every Calcutta that guest is in moves to the account (players of record, buy-backs), so statsFor(account) returns those plays.
// Identity only: who owns what does not change, so it is allowed after the event started. Audited. Returns { calcs: <how many were changed> }.
async function claimGuest(guestId, userKey) {
  const gk = 'g:' + String(guestId).replace(/^g:/, ''); if (!/^g:[\w-]{1,40}$/.test(gk)) throw bad(400, 'Bad guest id'); const mk = /^[0-9a-f]{24}$/.test(String(userKey)) ? String(userKey) : mkOf(String(userKey));
  const all = await idx(); let n = 0;
  for (const id of Object.keys(all)) { const e = all[id]; if (!(e.gks ? e.gks.includes(gk) : evLocal(e.ev))) continue; const row = await loadRow(id, true); if (!row || row.data.deleted) continue;
    const hit = (c) => c.lots.some((l) => isPor(l, gk) || (c.sold[l.id] && c.sold[l.id].bb && c.sold[l.id].bb.k === gk)); if (!hit(row.data)) continue;
    const c = await mutCalc(id, (c) => { if (!hit(c)) return { nochange: true, v: c }; const m = memberOf(c, mk);
      c.lots.forEach((l) => { if (isPor(l, gk)) { const had = isPor(l, mk); l.por = l.por.filter((p) => p.k !== gk || !had); l.por.forEach((p) => { if (p.k === gk) { p.k = mk; p.was = gk; if (m) p.name = m.name; } }); } const s = c.sold[l.id]; if (s && s.bb && s.bb.k === gk) { s.bb.k = mk; s.bb.was = gk; if (m) { s.bb.pid = m.pid; s.bb.name = ''; } } });
      audit(c, 'Oddable', 'A guest player claimed an Oddable account: their teams and buy-backs now belong to that account'); c.rev++; return c; });
    await syncIdx(c); n++; }
  return { calcs: n };
}
const hooks = {}; // reserved for the manager (e.g. hooks.groupMember(groupId, mk) when membership moves into the group)
module.exports = { handle, createCalc, attachToGroup, setPlayersOfRecord, claimGuest, evLocal, potSummary, statsFor, registerSource, capText: PRICE, startState, hooks, EVENTS, cleanRows, slotAmounts, money, teamResults, parseGames, settle, mkOf, _deps: D, _reset: () => { RL.clear(); RC.clear(); RES.clear(); GC.clear(); GF.clear(); GI.clear(); KICK.clear(); MAXC.clear(); TEAMS.clear(); IDS.map = null; IDXC.at = 0; NAMES = { at: 0, v: {} }; writes = 0; }, _writes: () => writes };
