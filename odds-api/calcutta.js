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
  groups: () => { try { return require('./groups'); } catch (e) { return null; } }, // the Groups module, when this build has it (its attachGame lists a new Calcutta on the group)
  corrMs: 6000, // how long a correction waits for its own brand-new feed read
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
const dayTxt = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms)).replace(',', ''); // "Sat Jan 16"
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
// ROUND 4 #6: from a ROUTE (trusted = false) a player of record is only: a current member ({ me } / { pid }), a guest created in THIS Calcutta
// ({ guest: true, name } makes one, { guest: '<its id>' } names one made here), or a typed name. Never an account id or key: the reviewer put $2,500 on
// another account's dashboard with { key: 'owner' }. Account ids / member keys / a source's own guest ids come only from TRUSTED server code
// (a lot source's teams(), setPlayersOfRecord from the group side), and an account named that way is PENDING (#5) until that person joins.
const POR_ROUTE = 'A player of record is a member of this Calcutta, a guest you add here, or a typed name';
function porEntry(x, members, trusted) {
  if (typeof x === 'string') { const v = x.trim();
    if (trusted) { if (/^[0-9a-f]{24}$/.test(v) || /^g:[\w-]{1,40}$/.test(v)) return { k: v, name: '' }; if ((v.includes('@') || v === 'owner') && v.length <= 200) return { k: mkOf(v), name: '' }; }
    const nm = cleanName(v, 24); if (nm.length >= 2) return { k: 'n:' + nm.toLowerCase(), name: nm }; throw bad(400, 'Bad player of record'); }
  if (!x || typeof x !== 'object') throw bad(400, 'Bad player of record');
  const name = cleanName(x.name, 24);
  if (x.me) { if (!members || !members._me) throw bad(400, 'Bad player of record'); return { k: members._me.mk, name: members._me.name }; }
  if (x.pid != null) { const m = (members || []).find((y) => y.pid === String(x.pid)); if (!m) throw bad(404, 'Not a member'); return { k: m.mk, name: m.name }; }
  if (x.guest === true) { if (name.length < 2) throw bad(400, 'A guest needs a name (2+ characters)'); return { k: 'g:' + rnd(12).toLowerCase(), name }; } // a NEW guest of this Calcutta (its claim link is issued when the change is saved)
  if (trusted && (x.key != null || x.guest != null)) { const e = porEntry(x.guest != null ? 'g:' + String(x.guest).replace(/^g:/, '') : String(x.key), null, true); if (/^n:/.test(e.k)) throw bad(400, 'Bad player of record'); e.name = name; if (x.accepted === true) e.ok = true; return e; }
  if (x.key != null) throw bad(400, POR_ROUTE, { code: 'porkey' });
  if (x.guest != null) { const gid = String(x.guest).replace(/^g:/, ''), g = members && members._guests && Object.prototype.hasOwnProperty.call(members._guests, gid) ? members._guests[gid] : null; if (!g) throw bad(400, 'That guest was not added in this Calcutta. ' + POR_ROUTE, { code: 'porguest' }); return { k: 'g:' + gid, name: g.name || name }; }
  if (name.length >= 2) return { k: 'n:' + name.toLowerCase(), name };
  throw bad(400, 'A player of record needs a member, a guest or a name (2+ characters)');
}
// Guests of one Calcutta: c.guests[<guest id>] = { name, th: hash of the claim token | null, at, claimed }. The token is shown ONCE to the commissioner
// (to text to that guest); only its hash is kept. ROUND 4 #7.
const tokHash = (t) => crypto.createHash('sha256').update('oddable-calc-guest|' + t).digest('hex').slice(0, 40);
function syncGuests(c) { c.guests = c.guests || {}; const links = []; c.lots.forEach((l) => (l.por || []).forEach((p) => { if (!/^g:/.test(p.k)) return; const gid = p.k.slice(2); if (Object.prototype.hasOwnProperty.call(c.guests, gid)) return; const token = c.id + '-' + rnd(20); c.guests[gid] = { name: p.name || 'Guest', th: tokHash(token), at: D.now(), claimed: null }; links.push({ guest: gid, name: p.name || 'Guest', lot: l.id, token }); })); return links; }
// The source reference a commissioner's screen sends at set-up (`golf: { gameId } | { tour, eventId }`), kept on the Calcutta as c.golf and handed to the source
// srcRef: the reference fields of a plugged event from a request body -> { golf, evtId } (both stored on the Calcutta and on the object teams() gets)
function srcRef(ev, b) { if (!ev || !ev.plug) return { golf: null, evtId: null }; const golf = ev.needsRef === 'evtId' ? null : cleanRef(b && (b.golf || b.ref)), evtId = ev.needsRef === 'evtId' && b && b.evtId != null && /^[\w:.-]{1,40}$/.test(String(b.evtId)) ? String(b.evtId) : null;
  if (ev.needsRef && !(ev.needsRef === 'evtId' ? evtId : golf && golf[ev.needsRef])) throw bad(400, ev.needsRef === 'evtId' ? 'Start this Calcutta from the local event whose pairs or teams you want to auction' : 'Start this Calcutta from the golf day whose teams you want to auction'); return { golf, evtId }; }
function cleanRef(x) { if (!x || typeof x !== 'object') return null; const o = {}; if (x.gameId != null && /^[\w-]{1,40}$/.test(String(x.gameId))) o.gameId = String(x.gameId); if (x.tour != null && /^[a-z0-9]{1,12}$/.test(String(x.tour))) o.tour = String(x.tour); if (x.eventId != null && /^[\w-]{1,24}$/.test(String(x.eventId))) o.eventId = String(x.eventId); return Object.keys(o).length ? o : null; }
const srcPlayer = (p) => (typeof p === 'string' && !/^[0-9a-f]{24}$/.test(p.trim()) && !/^g:[\w-]{1,40}$/.test(p.trim()) && !p.includes('@') && p.trim() !== 'owner' ? { name: p } : p); // a plain name from a source is a name, not an account id
function cleanPor(list, members, trusted) { if (list == null) return []; if (!Array.isArray(list) || list.length > 8) throw bad(400, 'Up to 8 players of record per lot'); const out = [], seen = new Set(); list.forEach((x) => { const e = porEntry(x, members, trusted);
  if (trusted && /^[0-9a-f]{24}$/.test(e.k) && !e.ok && !(members || []).some((m) => m.mk === e.k) && !(members && members._me && members._me.mk === e.k)) e.pend = true; delete e.ok; // #5: an account a source names is pending until that person joins (or the source says they accepted)
  if (!seen.has(e.k)) { seen.add(e.k); out.push(e); } }); return out; }
const rowLabel = (ev, r) => r.label || (r.k === 'win' ? 'Each win' : r.k === 'champ' ? 'Champion' : r.k === 'big' ? 'Biggest win margin' : r.k === 'place' ? (r.r === 1 ? 'Winner' : 'Finishes ' + ord(r.r)) : 'Reaches ' + ((ev.rounds || [])[r.r - 1] || 'round ' + r.r));
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

// ---------- rules ----------
const MINB = [1, 2, 5, 10, 20, 25, 50, 100], INCS = [1, 2, 5, 10, 25], TIMERS = [10, 20, 25, 30], TIMER0 = 25; // Playbook play 10: default 25 s
// Playbook play 10: what happens to the winnings of a lot nobody bought, picked at set-up and shown to members before the auction
const UNSOLD = { roll: 'Rolled into the sold lots\' payouts, pro rata', carry: 'Carried to the commissioner\'s next Calcutta' };
// ROUND 4 #4: the carry rule says WHERE the money goes; the roll rule says what happens when no sold lot earned anything
const carryTo = (c) => (c && c.group ? 'this group\'s next Calcutta' : 'the next Calcutta this commissioner runs') + ' (the commissioner holds it until then; Oddable never holds money)';
const unsoldText = (r, c) => (r.unsold === 'carry' ? 'If an unsold lot wins, its winnings carry to ' + carryTo(c) + '.' : 'If an unsold lot wins, its winnings roll into the payouts of the sold lots, pro rata (in proportion to what each has earned), when the event is over. If no sold lot earned anything, they are paid in proportion to the price paid.');
function cleanRows(ev, rows, nTeams) {
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
  // ROUND 5 #6: a place table pays 1st, 2nd, 3rd ... with no gap, each place once, and never more places than there are teams (checked at set-up,
  // where the number of teams is known; money() still pays any older table to the cent)
  // (with a Champion row the champion is 1st, so the place rows may start at 2nd)
  if (nTeams != null) { const pl = out.filter((x) => x.k === 'place'); if (pl.length) { const rs = pl.map((x) => x.r).sort((a, b) => a - b), s0 = rs[0] === 2 && out.some((x) => x.k === 'champ') ? 2 : 1;
    if (pl.some((x) => x.n !== 1) || rs.some((r, i) => r !== i + s0)) throw bad(400, 'Place rows must run 1st, 2nd, 3rd ... with no gap, each place once (now: ' + rs.map(ord).join(', ') + ')', { code: 'places' });
    if (rs[rs.length - 1] > nTeams) throw bad(400, 'The table pays down to ' + ord(rs[rs.length - 1]) + ' place but there are only ' + nTeams + ' teams. Pay at most ' + nTeams + ' places.', { code: 'places' }); } }
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
    let por = []; if (local) { por = cleanPor(src, members, true); cleanPor(given || [], members, false).forEach((e) => { if (!por.some((x) => x.k === e.k)) por.push(e); }); if (por.length > 8) throw bad(400, 'Up to 8 players of record per lot'); }
    return { id: 'L' + (i + 1), name: nm, teams, field: teams.length > 1, por };
  });
}
// ROUND 4 #5: a plugged source is asked on behalf of the CALLER (teams(calc, { viewer, viewerKey })), has 4 s to answer, and a Calcutta on a golf
// day / local event can only be created by that day's organizer (source.organizer(calc, { viewer, viewerKey }) === true; no hook = refused).
const SRC_MS = 4000, NOTYOURS = 'Only the organizer of that golf day or event can run a Calcutta on it';
const srcCall = (fn) => Promise.race([Promise.resolve().then(fn), sleep(SRC_MS).then(() => { throw bad(504, 'The event did not answer. Try again.'); })]);
const srcCtx = (v) => ({ viewer: v ? v.e : null, viewerKey: v ? v.mk : null });
async function organizerOk(evk, ref, viewer) { const ev = EVENTS[evk]; if (!ev || !ev.plug || !ev.needsRef) return; const S = SOURCES[ev.plug]; let ok = false;
  if (S && typeof S.organizer === 'function' && viewer) { try { ok = (await srcCall(() => S.organizer(Object.assign({ ev: evk, golf: (ref && ref.golf) || null }, ref && ref.evtId ? { evtId: ref.evtId } : {}), srcCtx(viewer)))) === true; } catch (e) { if (e.status === 504) throw e; ok = false; } }
  if (!ok) throw bad(403, NOTYOURS, { code: 'organizer' }); }
// which season an NFL / CFP event is for: the one being played, or the COMING one once that season's title game is behind us (LOWER: created in the off-season)
// ROUND 5: NFL events cut over the DAY AFTER the Super Bowl (the second Sunday of February, Chicago day); CFP after January.
const superBowlDay = (y) => { const d1 = new Date(Date.UTC(y, 1, 1)).getUTCDay(); return y + '-02-' + String(1 + ((7 - d1) % 7) + 7).padStart(2, '0'); };
function seasonFor(ev, now) { const sy = seasonYear(now, ev); if (ev.sport === 'nfl') return chiDay(now) > superBowlDay(sy + 1) ? sy + 1 : sy; return now > Date.UTC(sy + 1, 0, 31) ? sy + 1 : sy; }
async function cleanRules(b, now, members, viewer) {
  const name = cleanName(b.name, 40); if (name.length < 2) throw bad(400, 'Give the Calcutta a name (2+ characters)');
  const evk = String(b.ev || ''), ev = EVENTS[evk]; if (!ev) throw bad(400, 'Pick an event'); if (!evOn(evk)) throw bad(400, 'That event is coming soon');
  const ref = srcRef(ev, b);
  await organizerOk(evk, ref, viewer);
  let known = null; if (!ev.manualOnly) { try { const t = await teamsOf(evk, ref, viewer); if (t.length) { known = {}; t.forEach((x) => { known[x.id] = x; }); } } catch (e) { if (ev.plug) throw e.status === 403 || e.status === 504 ? e : bad(502, 'Could not load the teams. Try again.'); } }
  if (ev.plug && !known) throw bad(400, 'There are no teams to auction there yet');
  const lots = cleanLots(ev, b.lots, known, evLocal(evk), members), rows = cleanRows(ev, b.rows, lots.reduce((a, l) => a + l.teams.length, 0));
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
  let win = null; if (ev.weekend) { const td = chiDay(now), wd = new Date(td + 'T12:00:00Z').getUTCDay(), mon = [5, 6, 0].includes(wd) ? addDay(td, (1 - wd + 7) % 7) : null, from = mon ? td : addDay(td, (4 - wd + 7) % 7); win = { from, to: mon || addDay(from, 4) }; } // ROUND 4 LOWER: Mon-Thu = the COMING weekend (Thursday to Monday; a Monday is never "last weekend"); Fri-Sun = the rest of this weekend (today to Monday)
  else if (ev.win) { const td = chiDay(now), y = +td.slice(0, 4); win = ev.win(y); if (td > win.to) win = ev.win(y + 1); } // REVIEW FIX 9: the event's own dates (also when created mid-event)
  else if (ev.days) win = { from: chiDay(now), to: addDay(chiDay(now), ev.days) };
  return { name, ev: evk, golf: ref.golf, evtId: ref.evtId, lots, win, sy: ev.fetch ? seasonFor(ev, now) : null, rules: { rows, minBid, inc, timer, buyBack: !!b.buyBack, main: b.main !== false, take: { kind, v: kind === 'none' ? 0 : tv }, order, mode, unsold: uns } };
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
const LIM = { create: [5, 3600e3, 12, 3600e3], bid: [8, 5e3, 40, 5e3], ctl: [30, 10e3, 60, 10e3], join: [30, 600e3, 60, 600e3], peek: [30, 600e3, 60, 600e3], write: [60, 60e3, 120, 60e3], teams: [20, 60e3, 60, 60e3], claim: [10, 600e3, 30, 600e3], corr: [12, 60e3, 30, 60e3] };
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
async function loadRow(id, fresh) { const h = RC.get(id); if (!fresh && h && D.now() - h.at < 1000) return h.row; const r = await D.S.dbGet(ROW(id)); if (r) { RC.set(id, { at: D.now(), row: r }); if (RC.size > 300) RC.delete(RC.keys().next().value); if (r.data) watchAdd(r.data); } return r; }
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
const mutCalc = (id, fn, mk) => mutRow(ROW(id), null, async (c) => { if (c.deleted || (mk && !memberOf(c, mk))) throw bad(404, 'Calcutta not found'); settle(c, D.now()); return fn(c); }, (row) => { RC.set(String(row.id).slice(10), { at: D.now(), row }); recordPlayers(row.data); watchAdd(row.data); });
// ROUND 4: every player of a Calcutta that is under way is reported once for Enterprise billing through the shared limits.recordPlay(accountKey,
// gameType, gameId, playerKey) (Groups coder's odds-api/limits.js; nothing happens when that file / function is not there). accountKey = the
// commissioner's limits key (c.ak); playerKey = member key | 'g:<guest id>' | 'n:<typed name>'. Never an account id. A set-up nobody bid in is not a game.
const PLAYED = new Set();
function recordPlayers(c) { try { const L = D.limits(); if (!L || typeof L.recordPlay !== 'function' || !c || !c.ak || c.deleted || !c.a || (!c.locked && c.a.status === 'setup' && !c.startedAt)) return;
  const keys = new Set(); c.members.forEach((m) => keys.add(m.mk)); Object.values(c.sold || {}).forEach((s) => { if (!s.pid && s.name) keys.add('n:' + s.name.toLowerCase()); if (s.bb && !s.bb.pid) keys.add(acctK(s.bb.k) ? s.bb.k : 'n:' + String(s.bb.name || '').toLowerCase()); }); c.lots.forEach((l) => (l.por || []).forEach((p) => keys.add(p.k)));
  keys.forEach((k) => { const key = c.id + '|' + k; if (PLAYED.has(key)) return; PLAYED.add(key); if (PLAYED.size > 60000) PLAYED.clear(); Promise.resolve().then(() => L.recordPlay(c.ak, 'calcutta', c.id, k)).catch(() => { PLAYED.delete(key); }); }); } catch (e) {} }
const idxEntry = (c) => ({ name: c.name, comm: c.comm, mks: c.members.map((m) => m.mk), code: c.code, status: c.a.status, ev: c.ev, created: c.created, act: D.now(), group: c.group || null, w: worth(c) ? 1 : 0, pn: c.lots.reduce((a, l) => a + (l.por || []).length, 0), pks: [...new Set([].concat(...c.lots.map((l) => (l.por || []).filter((e) => !e.pend).map((e) => e.k).filter((k) => /^[0-9a-f]{24}$/.test(k)))))], gks: [...new Set([].concat(...c.lots.map((l) => (l.por || []).map((e) => e.k).concat(c.sold[l.id] && c.sold[l.id].bb && c.sold[l.id].bb.k ? [c.sold[l.id].bb.k] : []).filter((k) => /^g:/.test(k)))))] }); // S-ALL: players of record (account keys) find their Calcuttas too
// REVIEW FIX 8: index cached 1 s, abandoned set-ups (never started, 90+ days) pruned, failed updates retried on the next request
const IDXC = { at: 0, v: null }, PENDING = new Set(), ABANDON = 90 * DAY;
async function syncIdx(c) {
  for (let k = 0; k < 3; k++) { try { await mutRow(IDX, { calcs: {} }, (d) => { d.calcs = d.calcs || {}; const e = idxEntry(c), now = D.now(); const strip = (x) => JSON.stringify(Object.assign({}, x, { act: 0 })); let ch = !d.calcs[c.id] || strip(d.calcs[c.id]) !== strip(e) || now - (d.calcs[c.id].act || 0) >= DAY; d.calcs[c.id] = e;
      Object.keys(d.calcs).forEach((id) => { const x = d.calcs[id]; if (id !== c.id && x.status === 'setup' && !x.group && !(x.pks || []).length && !(x.gks || []).length && !x.pn /* ROUND 4 LOWER: typed-name players count too */ && (x.mks || []).length <= 1 && now - (x.act || x.created || 0) > ABANDON) /* ROUND 2 D5 + ROUND 3 #7: commissioner alone, never in a group, no team players, no activity (his own views count) */ { delete d.calcs[id]; ch = true; } });
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
function audit(c, by, what) { c.audit = c.audit || []; c.audit.push({ at: D.now(), by: cleanName(by, 24), what: cleanName(what, 340) }); if (c.audit.length > 600) c.audit = c.audit.slice(-600); }
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
async function teamsOf(evk, ref, viewer) {
  const ev = EVENTS[evk]; if (!ev || ev.manualOnly) return []; if (ev.plug) { const S = SOURCES[ev.plug]; if (!S) return [];
    const list = await srcCall(() => S.teams(Object.assign({ ev: evk, golf: (ref && ref.golf) || null }, ref && ref.evtId ? { evtId: ref.evtId } : {}), srcCtx(viewer)));
    if (list == null) throw bad(403, 'You are not in that golf day or event', { code: 'notin' }); if (!Array.isArray(list)) throw new Error('teams() must answer a list'); // FAIL CLOSED: a source that does not know the caller answers null (or throws)
    return srcTeams(list); }
  return espnTeams(ev);
}
const srcTeams = (list) => list.map((t) => ({ id: String(t.id), name: cleanName(t.name, 40), abbr: cleanName(t.abbr, 6), players: Array.isArray(t.players) ? t.players : undefined }));
async function espnTeams(ev) {
  const h = TEAMS.get(ev.path + (ev.tq || '')); if (h && D.now() - h.at < 12 * 36e5 && h.list.length) return h.list;
  const r = await D.fetch(E + ev.path + '/teams?limit=1000' + (ev.tq || ''), { signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error('teams ' + r.status);
  const j = await r.json(), list = []; (((j.sports || [])[0] || {}).leagues || []).forEach((lg) => (lg.teams || []).forEach((x) => { const t = x.team || x; if (t && t.id) list.push({ id: String(t.id), abbr: cleanName(t.abbreviation, 6), name: cleanName(t.displayName || t.name, 40) }); }));
  list.sort((a, b) => a.name.localeCompare(b.name)); TEAMS.set(ev.path + (ev.tq || ''), { at: D.now(), list }); return list;
}
// ROUND 4 #3: a placeholder / "time TBD" kickoff is not a start time. ESPN marks it timeValid:false (event or competition), writes TBD in the status
// detail, or lists the game at midnight Eastern (its placeholder hour; also a game with no date at all). Such a game says nothing about when the event
// starts until a real time, or a live / final state, appears.
const NYHM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const midnightET = (ms) => { const p = NYHM.format(new Date(ms)); return p === '00:00' || p === '24:00'; };
function tbdTime(e, c, st, t) { if ((st.state || 'pre') !== 'pre' || st.completed) return false; return !t || e.timeValid === false || c.timeValid === false || /\bTBD\b/i.test(String(st.detail || '') + ' ' + String(st.shortDetail || '')) || midnightET(t); }
function parseGames(j) {
  return (j.events || []).map((e) => { const c = (e.competitions || [])[0] || {}, st = ((e.status || c.status || {}).type || {}); const t = Date.parse(e.date) || 0; return { id: String(e.id), t, tbd: tbdTime(e, c, st, t), state: st.state || (st.completed ? 'post' : 'pre'), done: !!st.completed || st.state === 'post', off: /POSTPON|CANCEL/i.test(String(st.name || '')), sn: String(st.name || ''), st: Number((e.season || {}).type || 0), week: Number((e.week || {}).number || 0), head: String(((c.notes || [])[0] || {}).headline || ''),
    teams: (c.competitors || []).map((x) => ({ id: String((x.team || {}).id || x.id || ''), score: Number(x.score && x.score.value != null ? x.score.value : x.score) || 0, winner: !!x.winner })),
    series: c.series && Array.isArray(c.series.competitors) ? { done: !!c.series.completed, wins: Object.fromEntries(c.series.competitors.map((s) => [String(s.id), Number(s.wins) || 0])) } : null }; });
}
const GC = new Map(), GF = new Map(), GI = new Map(); // url -> { at, games, final, ttl } | a failure { at, msg } kept 30 s | the read in flight
async function getGames(url, today, force) { // force (ROUND 5, a commissioner correction): a NEW read made now; no cache, no remembered failure, no read already in flight
  const h = GC.get(url), now = D.now(); if (!force) { if (h && (h.final || (now - h.at < h.ttl && now >= h.at))) return h.games;
    const f = GF.get(url); if (f && now - f.at < 30e3 && now >= f.at) throw new Error('score feed: ' + f.msg); // ROUND 3 #4: failures cached briefly
    if (GI.has(url)) return GI.get(url); }
  let p; p = (async () => { try { const r = await D.fetch(url, { signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error('HTTP ' + r.status); const games = parseGames(await r.json()), t = D.now();
    const fin = !!today && games.length > 0 && games.every((g) => g.done) && !url.includes('dates=' + today.replace(/-/g, ''));
    const soon = !games.length || games.some((g) => !g.done && g.t - t < DAY); // a game within a day, an unfinished game already past its start (ROUND 5: a late result lands within 30 s), or nothing listed yet: re-read every 30 s, else every 5 min
    GC.set(url, { at: t, games, final: fin, ttl: soon ? 3e4 : 5 * 6e4 }); GF.delete(url); if (GC.size > 3000) GC.delete(GC.keys().next().value); return games;
  } catch (e) { GF.set(url, { at: D.now(), msg: e.message }); if (GF.size > 1000) GF.clear(); throw new Error('score feed: ' + e.message); } finally { if (GI.get(url) === p) GI.delete(url); } })(); // ROUND 2 D1: a failed fetch is an error (never an empty, fresh-looking list)
  if (!force) GI.set(url, p); return p;
}
function urlsFor(c) {
  const ev = EVENTS[c.ev]; if (ev.fetch) return ev.fetch(c.sy || seasonYear(c.created, ev)).map((q) => E + ev.path + '/' + q);
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
  if (big) { T(big.id).big = true; T(big.id).bigM = big.m; }
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
// ROUND 4 B4: everything cached about the start carries the SIGNATURE of the event it was read for (event key + edit count). Editing the event bumps
// the count, so a kickoff (or a read still in flight) of the old event can never be used for the new one.
const sigOf = (c) => c.ev + '|' + (c.er || 0);
const sigOk = (c, k) => !!k && (k.sig === undefined ? !c.er : k.sig === sigOf(c));
function setKick(id, sig, t0, live, ms) { const p0 = KICK.get(id), p = p0 && p0.sig === sig ? p0 : null, now = D.now(); KICK.set(id, { at: now, sig, t0: t0 == null ? null : t0, live: !!live || !!(p && p.live), thru: now + ms }); if (KICK.size > 3000) KICK.delete(KICK.keys().next().value); }
const kickOf = (c) => { const m0 = KICK.get(c.id), m = sigOk(c, m0) ? m0 : null, p = sigOk(c, c.kick) ? c.kick : null; return m && (!p || m.at >= p.at || m.live) ? m : p; };
// ROUND 4 B1: what the feed last listed for this Calcutta's teams (games still without a result, the source's schedule) = when a commissioner
// correction may open. In memory (GAMESOF) and on the row (c.fr), same signature rule.
const GAMESOF = new Map(); // calc id -> { sig, at, G: [{ id, t, done, tbd, teams[] }], S: { t0, end } | null }
const DUR = { nfl: 4 * 36e5, cfb: 4 * 36e5, mlb: 4 * 36e5, nba: 3 * 36e5, nhl: 3 * 36e5, ncaab: 3 * 36e5 }; // a game's scheduled end = its listed start + this
const IVL = (ev) => (ev.plug ? 5e3 : 30e3); // how often the start information is re-read while anyone has the Calcutta open
const feedResults = async (c) => (await readFeed(c, false)).R;
// One read of the feed / source for a Calcutta -> { R: results per team, gm: what it listed (also kept in GAMESOF) }. force = a brand-new read (see getGames).
async function readFeed(c, force) {
  const ev = EVENTS[c.ev], sig = sigOf(c); if (ev.manualOnly) return { R: {}, gm: null }; const ids = new Set(); c.lots.forEach((l) => l.teams.forEach((t) => ids.add(t.id)));
  const keep = new Set(Object.values(c.corr || {}).map((x) => x.game).filter(Boolean)); // games a correction stands in for are always kept in the list
  if (ev.plug) { const S = SOURCES[ev.plug]; if (!S) throw new Error('source not registered'); const R = S.results ? (await S.results(c)) || {} : {}; let on = false, t0 = null;
    if (typeof S.started === 'function') { const v = await S.started(c); if (v !== true && v !== false) throw new Error('source cannot tell whether it started'); on = v; }
    if (typeof S.startTime === 'function') { const v = await S.startTime(c); if (v != null) { t0 = Number(v instanceof Date ? v.getTime() : v); if (!Number.isFinite(t0) || t0 <= 0) throw new Error('bad startTime'); } }
    // ROUND 5 #4: the scheduled end comes ONLY from the source's own endTime(). A source without it has no scheduled end (and so no correction, ever).
    const hasEnd = typeof S.endTime === 'function'; let end = null; if (hasEnd) { try { const v = await S.endTime(c); if (v != null) { const n = Number(v instanceof Date ? v.getTime() : v); if (Number.isFinite(n) && n > 0) end = n; } } catch (e) {} }
    const gm = { sig, at: D.now(), G: [], D: [], O: [], S: { t0, end, hasEnd } }; keepMissing(c, gm, gm.at); GAMESOF.set(c.id, gm); if (GAMESOF.size > 3000) GAMESOF.delete(GAMESOF.keys().next().value);
    setKick(c.id, sig, t0, on || anyResult(R), 60e3); return { R, gm }; }
  const today = chiDay(D.now()), games = []; const urls = urlsFor(c);
  if (force) (await Promise.all(urls.map((u) => getGames(u, today, true)))).forEach((g) => games.push(...g));
  else for (let i = 0; i < urls.length; i += 4) (await Promise.all(urls.slice(i, i + 4).map((u) => getGames(u, today)))).forEach((g) => games.push(...g));
  const seen = new Set(), uniq = games.filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
  const mine = uniq.filter((g) => g.teams.some((t) => ids.has(t.id)) && (!ev.roundOf || ev.roundOf(g) != null || (ev.prelim && ev.prelim.test(g.head || ''))));
  const rel = mine.filter((g) => !g.off); // the event's games with a lot team (postponed / cancelled games do not count)
  const ts = rel.filter((g) => !g.tbd).map((g) => g.t).filter((t) => t > 0); // ROUND 4 #3: placeholder times are not kickoffs
  // a game still "time TBD": "nothing has started" is trusted only until its placeholder day begins (then for a minute at a time, re-read while anyone is in)
  const now = D.now(), tbd = rel.filter((g) => g.tbd && !g.done && g.state !== 'in'), tb = tbd.length ? Math.min(...tbd.map((g) => g.t || now)) : null;
  // G = the games still WITHOUT a result (oldest first; round = the event's round of that game, null for a play-in), D = finished, O = postponed / cancelled
  const open = rel.filter((g) => !g.done).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id)), dn = rel.filter((g) => g.done).map((g) => g.id);
  const gm = { sig, at: now, G: open.filter((g, i) => i < 120 || keep.has(g.id)).map((g) => Object.assign({ id: g.id, t: g.t, tbd: !!g.tbd, teams: g.teams.map((t) => t.id), round: ev.roundOf ? ev.roundOf(g) : 0, live: g.state === 'in' }, notSched(g) ? { nc: true } : {})),
    D: dn.slice(-400).concat(dn.slice(0, -400).filter((id) => keep.has(id))), O: mine.filter((g) => g.off).map((g) => g.id).slice(-200), S: null };
  keepMissing(c, gm, now); if (gm.miss) urls.forEach((u) => { const h = GC.get(u); if (h) { h.final = false; h.ttl = Math.min(h.ttl, 3e4); } }); // a game went missing: no page of this event is kept "for good" or for 5 minutes until that is settled
  GAMESOF.set(c.id, gm); if (GAMESOF.size > 3000) GAMESOF.delete(GAMESOF.keys().next().value);
  setKick(c.id, sig, ts.length ? Math.min(...ts) : null, rel.some((g) => g.done || g.state === 'in'), tb == null ? HORIZON : Math.max(60e3, Math.min(HORIZON, tb - now)));
  return { R: teamResults(ev, uniq, ids), gm };
}
// ROUND 6 (B1): only a game the feed still lists as SCHEDULED can be corrected. In progress, suspended, delayed, halftime ... = the feed is on it.
const notSched = (g) => g.state !== 'pre' || (!!g.sn && !/SCHEDULED/i.test(g.sn));
// ROUND 6 (M-4): ONE empty or partial answer never makes a game "no longer listed" (or a source's scheduled end "gone"). A game the last list had
// and this one does not is kept as it was until a later read, at least 60 s after the first one that missed it, still does not have it (two reads
// in a row). After a restart the last list is the one kept on the Calcutta row.
const MISS_MS = 60e3;
function keepMissing(c, gm, now) { const prev = gamesOf(c); if (!prev) return; const pm = prev.miss || {}, miss = {};
  if (gm.S) { if (gm.S.hasEnd && gm.S.end == null && prev.S && prev.S.end != null) { const t0 = pm.S || now; if (now - t0 < MISS_MS && now >= t0) { gm.S.end = prev.S.end; miss.S = t0; } } }
  else { const have = new Set(gm.G.map((x) => x.id).concat(gm.D, gm.O)); const held = (id) => { if (have.has(id)) return false; const t0 = pm[id] || now; if (now - t0 >= MISS_MS || now < t0) return false; miss[id] = t0; have.add(id); return true; };
    (prev.G || []).forEach((x) => { if (held(x.id)) gm.G.push(Object.assign({}, x, { held: true })); }); /* held = not in this read: it keeps a standing correction alive, it never opens a new one */ (prev.D || []).forEach((id) => { if (held(id)) gm.D.push(id); }); (prev.O || []).forEach((id) => { if (held(id)) gm.O.push(id); }); gm.G.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id)); }
  if (Object.keys(miss).length) gm.miss = miss; }
// ROUND 6 (M-4): a read that holds FEWER results than the last good one (a team lost a win, the champion or its place: an empty or partial page) is a
// failed read until a second read, at least 60 s later, says exactly the same. Winnings never drop to $0 on one bad answer.
const SHR = new Map(); // calc id -> { at, s }
function suspect(c, R) { const k = feedR(c), now = D.now(); const less = !!k && !!k.R && Object.keys(k.R).some((id) => { const a = k.R[id], b = (R || {})[id] || {}; return !!a && ((a.wins || 0) > (b.wins || 0) || (!!a.champ && !b.champ) || (!!a.place && !b.place)); });
  if (!less) { SHR.delete(c.id); return false; } const s = JSON.stringify(R || {}), p = SHR.get(c.id); if (p && p.s === s && now - p.at >= MISS_MS) { SHR.delete(c.id); return false; }
  if (!p || p.s !== s || now < p.at) { SHR.set(c.id, { at: now, s }); if (SHR.size > 2000) SHR.delete(SHR.keys().next().value); } return true; }
// REVIEW FIX 1 + ROUND 2 D1-D3: who owns what is final once the event has started. `c.startedAt` is written on the Calcutta row the first time
// the start is seen (sticky: never cleared, survives restarts) and every ownership change checks startState() INSIDE its transaction.
const FEEDONLY = 'Results for this event come from the score feed only. A commissioner correction opens only when the feed still has no result 24 hours after the game\'s scheduled end.', GRPCOMM = 'Only that group\'s commissioner can attach a Calcutta, and it has to be a Calcutta he runs';
const FROZEN = 'The event has started: who owns what is final now.', FEEDQ = 'The score feed cannot be read right now and the event may have started, so ownership is locked. Try again in a minute.';
// Notices: each has a number `n` (c.nseq). ROUND 5 #5: a CORRECTION notice is pinned (`pin`): it stays on the row, and is sent to every member, until that
// member has marked it seen (member.seenN = the highest notice number seen; POST /calcutta/seen). Later trivial notices never push it out.
function notice(c, by, what, raw, pin) { c.notices = c.notices || []; if (pin) { const txt = cleanName(raw ? what : what + ' (after the auction closed)', 300), lastPin = c.notices.filter((x) => x.pin).slice(-1)[0]; if (lastPin && lastPin.what === txt) return; } /* ROUND 6 (M-4): the same pinned notice is never sent twice in a row */ c.nseq = (c.nseq || 0) + 1; c.notices.push(Object.assign({ n: c.nseq, at: D.now(), by: cleanName(by, 24), what: cleanName(raw ? what : what + ' (after the auction closed)', pin ? 300 : 180) }, pin ? { pin: true } : {}));
  if (c.notices.length > 50) { const low = Math.min(...c.members.map((m) => m.seenN || 0)), open = (x) => !!x.pin && (x.n || 0) > low; c.notices = c.notices.filter(open).slice(-80).concat(c.notices.filter((x) => !open(x)).slice(-50)).sort((a, b) => (a.n || 0) - (b.n || 0)); } }
function noticesFor(c, m) { const seen = (m && m.seenN) || 0, all = c.notices || [], un = all.filter((x) => (x.n || 0) > seen), pins = un.filter((x) => x.pin), pick = new Set(pins.concat(un.slice(-30), all.slice(-5)));
  const out = all.filter((x) => pick.has(x)).reverse().map((x) => Object.assign({ n: x.n || 0, at: x.at, by: x.by, what: x.what, unread: (x.n || 0) > seen }, x.pin ? { pin: true } : {}));
  return { list: out.filter((x) => x.pin && x.unread).concat(out.filter((x) => !(x.pin && x.unread))), unread: un.length, pinned: pins.length, top: c.nseq || 0 }; } // unread corrections first, then newest first
function startOf(c) { // the earliest day the event can start (conservative): its window, else per event from the season
  if (c.win && c.win.from) return c.win.from; const ev = EVENTS[c.ev], sy = c.sy || seasonYear(c.created, ev);
  return { nfl_po: (sy + 1) + '-01-08', nfl_season: sy + '-09-03', cfp: sy + '-12-18' }[c.ev] || null; }
const near = (c, now) => { const s0 = startOf(c); return !s0 || chiDay(now) >= addDay(s0, -2); }; // the feed is only asked from 2 days before the earliest start day
function startState(c, now) { // 'started' | 'open' | 'unknown' (unknown = fail closed). Never waits.
  if (c.startedAt || Object.keys(c.manual || {}).length) return 'started';
  const ev = EVENTS[c.ev]; if (ev.manualOnly) return 'open';
  const k = kickOf(c);
  if (k) { if (k.live) return 'started';
    // ROUND 4 #2: the clock passing a CACHED kickoff starts the event only when that time was (re)confirmed: read at/after the kickoff itself, or within the
    // last refresh interval. An older time may have been moved (weather, flex): locked for now ('unknown' -> 409 feed, not sticky) until it is re-read.
    if (k.t0 != null && now >= k.t0) return k.at >= k.t0 || (now - k.at <= IVL(ev) && now >= k.at) ? 'started' : 'unknown';
    if (now < k.thru || (k.t0 != null && !ev.plug)) return 'open'; } // a known kickoff still ahead: open, however old the read
  const s0 = startOf(c); return !s0 || chiDay(now) >= s0 ? 'unknown' : 'open';
}
function refresh(c) { // one feed read per Calcutta at a time, in the background; never throws; resolves { ok, R }
  const sig = sigOf(c), x0 = RES.get(c.id) || {}, x = x0.sig === sig ? x0 : {}; if (x.busy) return x.busy; const id = c.id;
  const mine = () => { const h = RES.get(id); return h && h.sig === sig ? h : null; }; // an edit of the event in between: this read belongs to the old event and is dropped
  const p = Promise.race([feedResults(c), sleep(FEED_MS).then(() => { throw new Error('timeout'); })])
    .then((R) => { if (!mine()) return { ok: false, R: {} }; if (suspect(c, R)) throw new Error('fewer results than the last read: waiting for a second matching read'); RES.set(id, { sig, at: D.now(), tryAt: D.now(), R }); return { ok: true, R, saved: afterFeed(id) }; })
    .catch((e) => { console.error('calcutta feed:', e.message); const h = mine(); if (!h) return { ok: false, R: {} }; RES.set(id, { sig, at: h.at || 0, R: h.R || null, err: true, tryAt: D.now() }); return { ok: false, R: h.R || {} }; });
  RES.set(id, Object.assign({}, x, { sig, busy: p })); if (RES.size > 4000) RES.delete(RES.keys().next().value); return p;
}
function touch(c, now) { // called on polls, bids and controls: keeps the start information fresh without anyone waiting for it
  const ev = EVENTS[c.ev]; if (ev.manualOnly || c.deleted || !near(c, now) || (c.startedAt && !worth(c, now))) return; /* ROUND 5: after the start too, while a correction stands or a game is unfinished */ const x0 = RES.get(c.id) || {}, x = x0.sig === sigOf(c) ? x0 : {}; if (x.busy) return;
  const since = now - (x.tryAt || 0), k = kickOf(c), late = !!k && k.t0 != null && now >= k.t0 && k.at < k.t0; // ROUND 4 #2: the clock has passed a kickoff that was read before it: confirm it now
  if (since >= 0 && since < (late ? ((x.tryAt || 0) < k.t0 ? 0 : 5e3) : IVL(ev))) return; refresh(c); // ESPN: every 30 s while anyone has the Calcutta open (also after a failure); a source: every 5 s
}
function startNow(c) { // inside a transaction: mark started; an auction not finished is closed with a notice (ownership cannot change during the games)
  if (c.startedAt) return; c.startedAt = D.now(); audit(c, 'Oddable', 'The event has started: who owns what is final');
  if (c.a.status !== 'closed') { const n = c.lots.filter((l) => !c.sold[l.id]).length; c.a.status = 'closed'; c.a.cur = null; c.a.endsAt = null; c.a.nextAt = null; c.a.nextLeft = null; c.a.left = null; c.a.paused = false; c.a.closedAt = D.now(); notice(c, 'Oddable', 'The event has started: the auction is closed' + (n ? ' (' + n + ' lot' + (n === 1 ? '' : 's') + ' unsold)' : ''), true); }
}
async function markStarted(id) { try { const c = await mutCalc(id, (c) => { if (c.startedAt) return { nochange: true, v: c }; startNow(c); c.rev++; return c; }); syncIdx(c); } catch (e) { console.error('calcutta start:', e.message); } }
async function afterFeed(id) { // after a good read: keep `c.kick` on the row (restart-proof) and persist the start the moment it is seen
  try { const k = KICK.get(id); if (!k) return; const row = await loadRow(id); if (!row || row.data.deleted) return; const now = D.now();
    if (k.sig !== sigOf(row.data)) return; const h = RES.get(id), gm = GAMESOF.get(id), R = h && h.sig === k.sig && !h.err && h.R ? h.R : null, G = gm && gm.sig === k.sig ? { G: gm.G, S: gm.S } : null, frS = R ? JSON.stringify([R, G]) : null;
    // the row's copy of the kickoff is rewritten when it changed, when the event's clock has passed it (so a restart knows it was confirmed), or when it is getting old
    const stale = (p) => !p || p.sig !== k.sig || p.t0 !== k.t0 || !!p.live !== !!k.live || (k.t0 != null && k.at >= k.t0 && p.at < k.t0) || p.thru - now < Math.min(HORIZON / 2, (k.thru - k.at) / 2) && !EVENTS[row.data.ev].plug;
    const newR = (c) => !!frS && (!c.fr || c.fr.sig !== k.sig || JSON.stringify([c.fr.R, c.fr.G ? { G: c.fr.G, S: c.fr.S } : null]) !== frS || (!!c.win && !!c.win.to && !!h && chiDay(h.at) > c.win.to && !(chiDay(c.fr.at) > c.win.to))); // ROUND 6 (B2): the first read after a window event's last day is kept on the row (it is what says the event is over)
    const go = (c) => !c.startedAt && startState(c, now) === 'started', w0 = worth(row.data, now); watchAdd(row.data); if (!stale(row.data.kick) && !go(row.data) && !newR(row.data) && !voided(row.data).length && !deadCorr(row.data).length) return; let st = false;
    const c = await mutCalc(id, (c) => { if (sigOf(c) !== k.sig) return { nochange: true, v: c }; let ch = false; if (stale(c.kick)) { if (!c.kick || c.kick.t0 !== k.t0) c.rev++; c.kick = { at: k.at, sig: k.sig, t0: k.t0, live: k.live, thru: k.thru }; ch = true; }
      if (newR(c)) { c.fr = Object.assign({ at: h.at, sig: k.sig, R }, G || {}); c.rev++; ch = true; } // ROUND 4 #1: the last good results stay on the row, so stats and boards never wait on the feed (also after a restart)
      voided(c).forEach((tid) => { const tm = teamOf(c, tid); delete c.manual[tid]; const txt = 'A hand-entered result for ' + (tm ? tm.name : 'a team') + ' was removed: results for this event come from the score feed'; audit(c, 'Oddable', txt); notice(c, 'Oddable', txt, true, true); c.rev++; ch = true; });
      // ROUND 5 #3: every correction is re-checked against EVERY good read and removed, with a notice to all, the moment its game has a feed result or is cancelled, postponed, moved or no longer listed
      deadCorr(c).forEach(([k, why]) => { const txt = voidText(c, c.corr[k], why); delete c.corr[k]; audit(c, 'Oddable', txt); notice(c, 'Oddable', txt, true, true); c.rev++; ch = true; });
      if (go(c)) { startNow(c); c.rev++; ch = st = true; } return ch ? c : { nochange: true, v: c }; });
    watchAdd(c); if (st || worth(c, D.now()) !== w0) syncIdx(c);
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
const teamOf = (c, tid) => { let t = null; c.lots.forEach((l) => l.teams.forEach((x) => { if (x.id === tid) t = x; })); return t; };
const gamesOf = (c) => { const m = GAMESOF.get(c.id); if (m && m.sig === sigOf(c)) return m; return c.fr && c.fr.sig === sigOf(c) && (c.fr.G || c.fr.S) ? { at: c.fr.at, G: c.fr.G || [], D: [], O: [], S: c.fr.S || null } : null; };
const feedR = (c) => { const h = RES.get(c.id); if (h && h.sig === sigOf(c) && h.R) return { R: h.R, at: h.at }; return c.fr && c.fr.sig === sigOf(c) && c.fr.R ? { R: c.fr.R, at: c.fr.at } : null; }; // the last good feed results: memory, else the row
// ROUND 4 B1: on a feed-backed event the feed is the only source of results. The one exception is a commissioner CORRECTION (c.manual[team] with corr:true),
// which stands only while the feed still has no result for the game(s) it was entered for. The moment the feed reports, the correction is void.
const feedBacked = (c) => !EVENTS[c.ev].manualOnly;
// ---------- ROUND 5: THE COMMISSIONER CORRECTION, NARROW BY CONSTRUCTION ----------
// c.corr = { 'e:<feed game id>': { game, w, l, wn, ln, m, t, round, reason, by, at } }   one late GAME of an ESPN event: its winner (and the margin,
//                                                                                        only when the table pays the biggest win)
//        | { 's:<team id>':      { team, tn, place, end, reason, by, at } }              a plugged source WITH endTime(): one team's finishing place
// Nothing else can be typed. Wins, the round reached, "out" and the champion are DERIVED here by the engine from that one game (applyCorr); the champion
// only when that game is the event's final. A correction is made only against a brand-new, successful feed read in the same request (the route), never
// writes the permanent start, and is re-checked against every later read (afterFeed -> deadCorr): corrState() says whether it still stands.
const CORR_MAX = 40, NOW0 = D.now;
// ROUND 6 (M-3): a typed score has to be a possible score for the sport (most points by one team, biggest margin)
const SCORE = { nfl: { name: 'NFL', max: 80, margin: 75 }, cfb: { name: 'college football', max: 110, margin: 100 }, nba: { name: 'NBA', max: 200, margin: 80 }, ncaab: { name: 'college basketball', max: 200, margin: 100 }, nhl: { name: 'NHL', max: 20, margin: 15 }, mlb: { name: 'MLB', max: 35, margin: 30 }, other: { name: 'game', max: 300, margin: 300 } };
const ONEGAME = 'A correction records one late game only: which team won it (and the score when the table pays the biggest win, or the finishing place for a golf day or local event). Wins, rounds and the champion are worked out from it.';
const NOEND = 'Results for this event come from its own scoring only. It has no scheduled end, so there is no commissioner correction.';
const NOSERIES = 'Results for this event come from the score feed only. A playoff series is decided by the feed\'s own series record, so there is no commissioner correction.';
const FEEDNOW = 'The score feed could not be read just now, so a correction cannot be checked against it. Try again in a minute.';
function corrState(c, x, g, R) { // null = the correction stands | 'result' | 'off' | 'moved' | 'gone'   (g = what the feed last listed; nothing known = stands)
  if (!x) return 'gone'; if (!g) return null;
  if (x.game == null) { if (R && R[x.team] && anyResult({ x: R[x.team] })) return 'result'; if (!g.S || !g.S.hasEnd || g.S.end == null) return 'gone'; return g.S.end !== x.end ? 'moved' : null; }
  const o = (g.G || []).find((y) => y.id === x.game); if (o) return o.t !== x.t || o.tbd ? 'moved' : o.live || o.nc ? 'live' : null;
  if ((g.D || []).includes(x.game)) return 'result'; if ((g.O || []).includes(x.game)) return 'off'; return 'gone';
}
const voided = (c) => (feedBacked(c) ? Object.keys(c.manual || {}) : []); // a hand-typed team line on a feed-backed event (the round-4 format) is never used
const deadCorr = (c) => { if (!feedBacked(c)) return []; const g = GAMESOF.get(c.id); if (!g || g.sig !== sigOf(c)) return []; const f = feedR(c); return Object.keys(c.corr || {}).map((k) => [k, corrState(c, c.corr[k], g, f && f.R)]).filter((x) => x[1]); }; // only against a list read by THIS process
const corrWhat = (x) => (x.game == null ? (x.tn || 'A team') + ' finished ' + ord(x.place) : (x.wn || 'A team') + ' beat ' + (x.ln || 'its opponent') + (x.sc ? ' ' + x.sc[0] + '-' + x.sc[1] : '') + (x.m != null ? (x.sc ? ' (by ' + x.m + ')' : ' by ' + x.m) : ''));
const voidText = (c, x, why) => (why === 'result' ? 'The score feed reported ' + (x.game == null ? x.tn || 'a team' : (x.wn || 'a team') + ' v ' + (x.ln || 'its opponent')) + ': the commissioner correction is replaced by the feed'
  : 'The commissioner correction "' + corrWhat(x) + '" was removed: ' + (why === 'off' ? 'the score feed now lists that game as postponed or cancelled' : why === 'live' ? 'the score feed now shows that game in progress, suspended or delayed' : why === 'moved' ? (x.game == null ? 'the scheduled end of the event was moved' : 'the score feed moved that game to a new time') : (x.game == null ? 'the event no longer has a scheduled end' : 'the score feed no longer lists that game')));
// ---------- ROUND 6 (B1): a correction that decides the money waits for another member ----------
// A correction that MAKES A CHAMPION (its game is the final), PLACES A TEAM 1st, DECIDES THE BIGGEST-WIN ROW or ENDS THE EVENT is only PROPOSED: it pays
// nothing and changes nothing until ANOTHER member confirms it (x.ok = { by, at }; POST /calcutta/corrok). The commissioner cannot confirm; nobody who
// owns the lot it benefits can; and when the commissioner himself (or the member who shares that lot with him) owns that lot, the confirmer must own a
// different lot. Every member can OBJECT to any correction (x.obj = [{ mk, name, at }]; POST /calcutta/object): an objection keeps a proposed one from
// being confirmed, and marks one that already counts as "disputed by N members" on the board until the feed reports or the commissioner withdraws it.
// "Ends the event" is judged on every read (corrPlan), not only when the correction is typed.
const champRof = (ev) => ev.champRound || ev.final;
function critOf(c, x, R0) { const ev = EVENTS[c.ev]; if (x.game == null) return x.place === 1 ? 'first' : null;
  if ((x.round || 0) > 0 && x.round === champRof(ev)) return 'champion';
  if (x.m != null) { const cur = Object.keys(R0 || {}).find((id) => R0[id] && R0[id].big); if (!cur || !(R0[cur].bigM >= x.m)) return 'big'; } return null; }
const WHYTXT = { champion: 'it makes a champion', first: 'it places a team 1st', big: 'it decides the biggest-win row', ends: 'it ends the event' };
function corrPlan(c, R0) { // -> { on: [keys that count], pend: { key: why } }
  const g = gamesOf(c), keys = Object.keys(c.corr || {}).filter((k) => !corrState(c, c.corr[k], g, R0)), pend = {}, on = [];
  // oldest first: a confirmed correction counts; an unconfirmed one counts unless it is critical by itself, or adding it to the ones before it ends the event
  const ord2 = keys.map((k, i) => [k, i]).sort((a, b) => (c.corr[a[0]].at || 0) - (c.corr[b[0]].at || 0) || a[1] - b[1]).map((x) => x[0]);
  const overWith = (list) => { const R = clone(R0 || {}); applyCorr(c, R, R0, list); return money(c, R).over; }; let ov = null;
  ord2.forEach((k) => { const x = c.corr[k]; if (x.ok) { on.push(k); ov = null; return; } const why = critOf(c, x, R0); if (why) { pend[k] = why; return; }
    if (ov == null) ov = overWith(on); if (!ov && overWith(on.concat(k))) { pend[k] = 'ends'; return; } on.push(k); if (!ov) ov = null; });
  return { on, pend }; }
// who may confirm a proposed correction: null = this member may, else why not
function confirmBar(c, x, mk) { const m = memberOf(c, mk); if (!m) return 'Members only'; if (isComm(c, mk)) return 'Another member has to confirm this, not the commissioner';
  const tid = x.game == null ? x.team : x.w, lot = c.lots.find((l) => l.teams.some((t) => t.id === tid)), owns = (l) => { const s = c.sold[l.id]; return !!s && (s.pid === m.pid || (!!s.bb && (s.bb.pid === m.pid || s.bb.k === mk))); };
  if (!lot || !c.sold[lot.id]) return null; if (owns(lot)) return 'You own the lot this correction pays, so another member has to confirm it';
  const s = c.sold[lot.id], cm = c.members.find((y) => y.mk === c.comm), commOwns = !!cm && (s.pid === cm.pid || (!!s.bb && (s.bb.pid === cm.pid || s.bb.k === c.comm)));
  if (commOwns && !c.lots.some((l) => l.id !== lot.id && owns(l))) return 'The commissioner owns the lot this correction pays, so it has to be confirmed by a member who owns a different lot';
  return null; }
function applyCorr(c, R, R0, only) { // the engine's own derivation: one corrected game = one win for its winner (never a whole team line). only = the keys that count (corrPlan)
  const ev = EVENTS[c.ev], g = gamesOf(c), champR = ev.champRound || ev.final, T = (id) => (R[id] = R[id] || { wins: 0, winT: [], reached: 0, reachT: {}, champ: false, out: false });
  const tag = (r, x, txt) => { r.manual = true; r.corr = true; r.reason = x.reason || ''; r.cnote = txt; if ((x.obj || []).length) r.disp = Math.max(r.disp || 0, x.obj.length); };
  const cg = new Set(); Object.defineProperty(R, '_cg', { value: cg, enumerable: false, configurable: true }); // the games a counting correction stands in for
  Object.keys(c.corr || {}).filter((k) => !only || only.includes(k)).map((k) => c.corr[k]).filter((x) => !corrState(c, x, g, R0)).sort((a, b) => (a.t || 0) - (b.t || 0) || (a.at || 0) - (b.at || 0)).forEach((x) => {
    if (x.game == null) { const r = T(x.team); r.place = x.place; if (x.place === 1 && ev.kinds.includes('champ')) r.champ = true; tag(r, x, 'finished ' + ord(x.place)); return; }
    if (ev.series) return; cg.add(x.game); const w = T(x.w), l = T(x.l), rd = x.round || 0;
    [w, l].forEach((r) => { if (rd > r.reached) r.reached = rd; if (rd > 0 && r.reachT[rd] == null) r.reachT[rd] = x.t; }); // both played in that round
    if (ev.season && rd !== 0) { if (rd === champR) w.champ = true; } // season events: the title game makes the champion, it is not a regular-season win
    else { w.wins++; w.winT.push(x.t); w.winT.sort((a, b) => a - b);
      if (rd > 0) { l.out = true; if (rd === champR) w.champ = true; /* champion ONLY when the corrected game is the final */ else if (rd < (ev.rounds || []).length) { if (w.reached < rd + 1) w.reached = rd + 1; if (w.reachT[rd + 1] == null) w.reachT[rd + 1] = x.t + 1; } }
      if (x.m != null && teamOf(c, x.w)) { const cur = Object.keys(R).find((id) => R[id].big); if (!cur || !(R[cur].bigM >= x.m)) { if (cur) { R[cur].big = false; } w.big = true; w.bigM = x.m; } } }
    tag(w, x, 'won its late game against ' + (x.ln || 'its opponent')); tag(l, x, 'lost its late game to ' + (x.wn || 'its opponent')); });
}
// Which correction could the commissioner make for this team, judged against a list `g` (the board passes the last list known = a HINT; the route passes
// the brand-new read)? ESPN: this team's games still listed without a result 24 h after their scheduled end (start + the sport's game length), never a
// play-in or a time-TBD game, never a series event. A source: only with endTime(), 24 h after it, with nothing from the source for the team.
function fixable(c, tid, now, g0, R0) {
  const ev = EVENTS[c.ev], g = g0 || gamesOf(c); if (ev.manualOnly || ev.series || !g) return null;
  if (ev.plug) { const R = R0 || (feedR(c) || {}).R; if (!g.S || !g.S.hasEnd || g.S.end == null || now < g.S.end + DAY || (R && R[tid] && anyResult({ x: R[tid] }))) return null; return { games: [], end: g.S.end, place: true }; }
  const dur = DUR[ev.sport] || 4 * 36e5, late = (g.G || []).filter((x) => x.teams.length === 2 && x.teams.includes(tid) && x.round != null && x.t > 0 && !x.tbd && !x.live && !x.nc && !x.held && now >= x.t + dur + DAY); /* ROUND 6: never a game the feed shows in progress, suspended or delayed, or one this read did not list */ if (!late.length) return null;
  return { games: late.map((x) => x.id), end: Math.min(...late.map((x) => x.t)) + dur, list: late, score: c.rules.rows.some((r) => r.k === 'big') };
}
const teamName = (c, tid) => { const t = teamOf(c, tid); if (t) return t.name; const ev = EVENTS[c.ev], h = ev.path ? TEAMS.get(ev.path + (ev.tq || '')) : null, k = h && h.list.find((x) => x.id === tid); return k ? k.name : ''; };
// POST /calcutta/result on a feed-backed event. Order: commissioner -> a brand-new successful read (else 409 feed) -> a late game (else 409 feedonly) ->
// reason -> only the one game's fields (else 400 onegame).
async function correction(id, u, b, ip) {
  const r0 = await loadRow(id, true); if (!r0 || r0.data.deleted || !memberOf(r0.data, u.mk)) throw bad(404, 'Calcutta not found'); const c0 = r0.data, ev = EVENTS[c0.ev], tid = typeof b.team === 'string' || typeof b.team === 'number' ? String(b.team) : '';
  if (!isComm(c0, u.mk)) throw bad(403, 'Only the commissioner can do that'); const byName = mName(c0, memberOf(c0, u.mk).pid);
  if (b.clear) { const gk = b.game != null ? 'e:' + String(b.game) : null; return mutCalc(id, (c) => { if (!isComm(c, u.mk)) throw bad(403, 'Only the commissioner can do that'); const ks = Object.keys(c.corr || {}).filter((k) => (gk ? k === gk : c.corr[k].team === tid || c.corr[k].w === tid || c.corr[k].l === tid)); if (!ks.length) return { nochange: true, v: c };
      ks.forEach((k) => { const txt = 'Correction removed by the commissioner (back to the score feed): ' + corrWhat(c.corr[k]); delete c.corr[k]; audit(c, byName, txt); notice(c, byName, txt, true, true); }); c.rev++; return c; }, u.mk).then(async (c) => { await syncIdx(c); return c; }); }
  if (!teamOf(c0, tid)) throw bad(404, 'No such team');
  if (ev.series) throw bad(409, NOSERIES, { code: 'feedonly' });
  if (ev.plug && typeof (SOURCES[ev.plug] || {}).endTime !== 'function') throw bad(409, NOEND, { code: 'feedonly' }); // #4
  rate('corr', u.mk, ip);
  // #2: a SUCCESSFUL brand-new read, made in this request. Slow, down or timed out = 409 feed. The list of an earlier read is never used.
  let o = null; try { o = await Promise.race([readFeed(c0, true), sleep(D.corrMs, null)]); } catch (e) { o = null; }
  if (!o || !o.gm || o.gm.sig !== sigOf(c0) || suspect(c0, o.R)) throw bad(409, FEEDNOW, { code: 'feed' });
  { const h = RES.get(id), sig = sigOf(c0); RES.set(id, Object.assign(h && h.sig === sig && h.busy ? { busy: h.busy } : {}, { sig, at: D.now(), tryAt: D.now(), R: o.R })); await afterFeed(id); } // what this read says (kickoff, start, results, void corrections) is kept exactly like any other read
  const now = D.now(); if (!ev.plug && !ev.kinds.includes('champ') && c0.win && c0.win.to && chiDay(now) > addDay(c0.win.to, WIN_GRACE)) throw bad(409, 'This event closed ' + WIN_GRACE + ' days after its last day: its money is settled, so there is no correction any more.', { code: 'over' }); // ROUND 6 (B2)
  const fx = fixable(c0, tid, now, o.gm, o.R); if (!fx) throw bad(409, FEEDONLY, { code: 'feedonly' });
  const reason = typeof b.reason === 'string' ? cleanName(b.reason, 100) : ''; if (reason.length < 5) throw bad(400, 'Say why you are correcting the score feed (5+ characters). Every member will see it.', { code: 'reason' });
  if (['wins', 'reached', 'champ', 'out', 'big'].concat(fx.place ? ['winner', 'game', 'score'] : ['place']).some((k) => b[k] != null)) throw bad(400, ONEGAME, { code: 'onegame' }); // #1: never a whole team line
  let rec, key, score = null;
  if (fx.place) { const pl = Number(b.place); if (!(Number.isInteger(pl) && pl >= 1 && pl <= 200)) throw bad(400, 'Enter the finishing place of this team (1 to 200)', { code: 'onegame' }); rec = { team: tid, tn: teamName(c0, tid), place: pl, end: fx.end }; key = 's:' + tid; }
  else { const g = b.game != null ? fx.list.find((x) => x.id === String(b.game)) : fx.list.length === 1 ? fx.list[0] : null;
    if (!g) { if (b.game != null) throw bad(409, FEEDONLY, { code: 'feedonly' }); throw bad(400, 'This team has more than one late game. Pick the game you are correcting.', { code: 'whichgame' }); }
    const w = b.winner != null ? String(b.winner) : tid; if (!g.teams.includes(w)) throw bad(400, 'The winner has to be one of the two teams in that game', { code: 'onegame' }); const l = g.teams.find((x) => x !== w); let m = null;
    if (fx.score) { const sc = Array.isArray(b.score) && b.score.length === 2 ? b.score.map(Number) : null; if (!sc || !sc.every((v) => Number.isInteger(v) && v >= 0 && v <= 300) || !(sc[0] > sc[1])) throw bad(400, 'This table pays the biggest win margin: enter that game\'s final score, winner first', { code: 'score' }); m = sc[0] - sc[1];
      const lim = SCORE[ev.sport] || SCORE.other; if (sc[0] > lim.max || m > lim.margin) throw bad(400, 'That score is not a real ' + lim.name + ' score (at most ' + lim.max + ' points, a margin of at most ' + lim.margin + '). Check it and type it again.', { code: 'scorebounds' }); score = sc; } // ROUND 6 (M-3)
    else if (b.score != null) throw bad(400, ONEGAME, { code: 'onegame' });
    rec = Object.assign({ game: g.id, w, l, wn: teamName(c0, w), ln: teamName(c0, l), m, t: g.t, round: g.round }, score ? { sc: score } : {}); key = 'e:' + g.id; }
  return mutCalc(id, (c) => { if (!isComm(c, u.mk)) throw bad(403, 'Only the commissioner can do that'); if (sigOf(c) !== o.gm.sig) throw bad(409, FEEDNOW, { code: 'feed' });
    if (startState(c, D.now()) !== 'started') throw bad(409, FEEDONLY, { code: 'feedonly' }); // a correction NEVER starts the event: the start is only ever written from the feed (afterFeed above)
    c.corr = c.corr || {}; const was = c.corr[key]; if (!was && Object.keys(c.corr).length >= CORR_MAX) throw bad(409, 'There are already ' + CORR_MAX + ' corrections on this Calcutta');
    c.corr[key] = Object.assign(rec, { reason, by: byName, at: D.now() }); // a changed correction starts again: no confirm, no objections carried over
    const why = corrPlan(c, o.R).pend[key];
    const txt = (why ? 'PROPOSED by commissioner (correction, does NOT count until another member confirms it, because ' + WHYTXT[why] + ') for ' : 'Entered by commissioner (correction) for ') + (teamName(c, tid) || 'a team') + ': ' + corrWhat(rec) + (rec.game != null ? ', game of ' + dayTxt(rec.t) : '') + (was ? ' (was: ' + corrWhat(was) + ')' : '') + '. Reason: ' + reason;
    audit(c, byName, txt + '. The score feed replaces it the moment it reports.'); notice(c, byName, txt, true, true); c.rev++; return c; }, u.mk).then(async (c) => { await syncIdx(c); return c; }); // ROUND 6 (M-5): the index flag `w` is written at once, so a restart re-reads it
}
// ---------- ROUND 5 #3: the background watch ----------
// After an event has started, the feed is re-read WITHOUT anyone opening the board for as long as a correction stands or a game is unfinished, so "the
// feed overwrites it" happens within a minute. WATCH holds the Calcuttas this process knows are worth watching (every row it reads or writes, plus the
// index flag `w` read at boot and every 10 minutes, so a restart picks them up). One tick every 20 s (unref'd timer, started by watch() from server.js
// and by the first request): hot Calcuttas (a correction, or a game live / within a day / overdue) every tick, the others every 5 minutes.
const WATCH = new Map(); let WT = null, WBOOT = -1e15, TICKING = false; const WATCH_MS = 20e3;
function worth(c, now) { if (!c || c.deleted || !c.startedAt || !feedBacked(c) || !c.a) return false; const t = now == null ? D.now() : now, nc = Object.keys(c.corr || {}).length;
  const until = (c.win && c.win.to ? Date.parse(c.win.to + 'T12:00:00Z') + 3 * DAY : c.startedAt + 250 * DAY) + (nc ? 30 * DAY : 0); if (t > until) return false;
  if (nc) return true; const g = gamesOf(c); if (g && (g.G || []).length) return true; if (EVENTS[c.ev].plug) return false; const f = feedR(c); return !(f && Object.values(f.R).some((x) => x && x.champ)); } // an ESPN event with no champion yet is not finished
const hot = (c, now) => { if (Object.keys(c.corr || {}).length) return true; const g = gamesOf(c); return !!g && (g.G || []).some((x) => x.live || (x.t > 0 && x.t - now < DAY)); };
function watchAdd(c) { try { if (!c || !c.id) return; if (worth(c)) { if (!WATCH.has(c.id)) { WATCH.set(c.id, { last: 0, hot: true }); if (WATCH.size > 2000) WATCH.delete(WATCH.keys().next().value); } } } catch (e) {} }
async function watchTick(force) { // force: run even under a test clock (tests drive it by hand); answers how many Calcuttas were re-read
  if (TICKING || (!force && D.now !== NOW0)) return 0; /* under a replaced clock (tests) the timer does nothing: tests call watchTick(true) */ TICKING = true; let n = 0;
  try { const now = D.now();
    if (now - WBOOT > 6e5 || now < WBOOT) { WBOOT = now; try { const all = await idx(); Object.keys(all).forEach((id) => { if (all[id].w && !WATCH.has(id)) WATCH.set(id, { last: 0, hot: true }); }); } catch (e) {} }
    const due = [...WATCH.keys()].filter((id) => { const w = WATCH.get(id); return w.hot || now - w.last >= 5 * 6e4 || now < w.last; }).sort((a, b) => WATCH.get(a).last - WATCH.get(b).last).slice(0, 100); // ROUND 6 (low): the ones read longest ago first, so more than 100 all get a turn
    for (let i = 0; i < due.length; i += 4) await Promise.all(due.slice(i, i + 4).map(async (id) => { try { const row = await loadRow(id), c = row && row.data;
      if (!worth(c, now)) { WATCH.delete(id); if (c && !c.deleted) { const e = (await idx())[id]; if (e && e.w) await syncIdx(c); } return; }
      WATCH.set(id, { last: now, hot: hot(c, now) }); const o = await refresh(c); if (o && o.saved) await o.saved; n++; } catch (e) { console.error('calcutta watch:', e.message); } }));
  } finally { TICKING = false; } return n;
}
function watch() { if (WT) return; WT = setInterval(() => { watchTick().catch(() => {}); }, WATCH_MS); if (WT.unref) WT.unref(); }
const ENDW = new Map(); // calc id -> when a page last waited for the read after the window (at most one wait a minute per Calcutta: a hanging feed never slows every poll)
const endUnread = (c, now) => { const ev = EVENTS[c.ev]; if (ev.manualOnly || ev.plug || ev.kinds.includes('champ') || !c.win || !c.win.to || !(chiDay(now) > c.win.to)) return false; const g = gamesOf(c); if (g && chiDay(g.at) > c.win.to) return false; const w = ENDW.get(c.id); if (w != null && now - w < 60e3 && now >= w) return false; ENDW.set(c.id, now); if (ENDW.size > 2000) ENDW.delete(ENDW.keys().next().value); return true; };
// mode: true = wait for the feed (<= 4 s), false = a page (waits <= 2.5 s only when nothing at all is known), 'cache' = NEVER waits (stats, pot summaries)
async function results(c, wait) { // feed results cached 5 min per Calcutta (1 min after a failure); a page never waits long on ESPN
  const h0 = RES.get(c.id), h = h0 && h0.sig === sigOf(c) ? h0 : null, now = D.now(), fresh = h && (h.err ? now - h.tryAt < 6e4 && now >= h.tryAt : h.R && now - h.at < 5 * 6e4 && now >= h.at);
  const kept = feedR(c); let R = kept && kept.R; const done = wait === 'cache' && kept && now - kept.at < DAY && now >= kept.at && Object.values(kept.R).some((x) => x && x.champ); // a finished event is not re-read for every stats page
  if (!fresh && feedBacked(c) && !done && !(wait === 'cache' && h && h.busy)) { const p = refresh(c).then((o) => (o.ok ? o.R : R || {})); if (wait !== 'cache' && (wait || !kept || endUnread(c, now))) /* ROUND 5: a page waits only when NOTHING is known (memory or row); ROUND 6 (B2): or when a window event's days have passed and the feed was not read since */ R = await Promise.race([p, sleep(wait ? WAIT_MS : 2500, R || {})]); }
  const R0 = R || {}; R = clone(R0); if (feedBacked(c)) { const plan = corrPlan(c, R0); applyCorr(c, R, R0, plan.on); Object.defineProperty(R, '_plan', { value: plan, enumerable: false }); return R; } // ROUND 5: a feed-backed event = the feed + the standing one-game corrections, nothing typed
  Object.keys(c.manual || {}).forEach((id) => { const m = c.manual[id]; const x = R[id] = R[id] || { wins: 0, winT: [], reached: 0, reachT: {}, champ: false, out: false };
    if (m.wins != null) { const n = m.wins; while (x.winT.length < n) x.winT.push(9e15 + (m.at || 0)); /* hand-added wins are paid after the feed wins (slot order) */ x.winT = x.winT.slice(0, n); x.wins = n; }
    if (m.reached != null) { x.reached = m.reached; for (let r = 1; r <= m.reached; r++) if (x.reachT[r] == null) x.reachT[r] = 9e15 + (m.at || 0); }
    ['champ', 'out', 'big'].forEach((k) => { if (m[k] != null) x[k] = !!m[k]; }); if (m.place != null) x.place = m.place || null; x.manual = true; if (m.corr) { x.corr = true; x.reason = m.reason || ''; } });
  ['champ', 'big'].forEach((k) => { const hand = Object.keys(c.manual || {}).filter((id) => R[id] && R[id].manual && c.manual[id] && c.manual[id][k] === true); if (hand.length) Object.keys(R).forEach((id) => { if (!hand.includes(id)) R[id][k] = false; }); }); // REVIEW FIX 7: a hand-entered champion / biggest win replaces the feed's
  return R;
}

// ---------- money: pot, take, payouts (cents; slots sum exactly to the pool) ----------
function slotAmounts(rows, poolC) { // every row pays n slots of pool*bp/10000; floors + leftover cents to the bigger payouts (bp desc, row, slot)
  const sl = []; rows.forEach((r, i) => { for (let s = 0; s < r.n; s++) sl.push({ i, s, bp: r.bp, c: Math.floor(poolC * r.bp / 10000) }); });
  let left = poolC - sl.reduce((a, x) => a + x.c, 0); const ord = sl.slice().sort((a, b) => b.bp - a.bp || a.i - b.i || a.s - b.s);
  for (let k = 0; left > 0 && k < ord.length; k++, left--) ord[k].c++;
  return rows.map((r, i) => sl.filter((x) => x.i === i).map((x) => x.c));
}
function money(c, R, ctx) { // ctx (optional, tests): { now, g } = the clock and the last game list, for the end of a window event
  const ev = EVENTS[c.ev], rules = c.rules, potC = Object.values(c.sold).reduce((a, x) => a + Math.round(x.amt * 100), 0);
  const takeC = rules.take.kind === 'pct' ? Math.round(potC * rules.take.v / 100) : rules.take.kind === 'flat' ? Math.min(Math.round(rules.take.v * 100), potC) : 0, poolC = potC - takeC;
  const amts = slotAmounts(rules.rows, poolC), teamLot = {}; c.lots.forEach((l) => l.teams.forEach((t) => { teamLot[t.id] = l.id; }));
  const earnT = {}, rowsOut = [], add = (id, v) => { earnT[id] = (earnT[id] || 0) + v; };
  // ROUND 4 B2: TIES FOR A PAID PLACE split the combined places to the cent. Teams that share a place take the next places with them (two tied for
  // 1st share 1st + 2nd; the next team is 3rd, whether it was entered as 2nd or 3rd). The group's money = everything the table pays for the places it
  // covers, split evenly; leftover cents go one each to the first teams in lot order. Only teams in a lot hold a place.
  const order = {}; let oi = 0; c.lots.forEach((l) => l.teams.forEach((t) => { order[t.id] = oi++; }));
  // ROUND 6 (M-1): on a table with a Champion row THE CHAMPION IS 1st PLACE. The Champion row is the money for 1st (with a "Winner" row when the table has
  // both), so teams tied for 1st share Champion + the next places evenly, to the cent, like every other tie. A ticked champion with no place typed is 1st,
  // and a team typed 1st is paid the Champion row.
  const hasPl = rules.rows.some((r) => r.k === 'champ'), eff = (id) => { const x = R[id]; if (!x) return 0; if (hasPl && x.champ) return 1; return Number.isInteger(x.place) && x.place > 0 ? x.place : 0; };
  const placed = Object.keys(R).filter((id) => teamLot[id] && eff(id) > 0).sort((a, b) => eff(a) - eff(b) || order[a] - order[b]);
  const groups = [], posOf = {}; { let end = 0; for (let i = 0; i < placed.length;) { let j = i; while (j < placed.length && eff(placed[j]) === eff(placed[i])) j++; const ids = placed.slice(i, j), from = Math.max(eff(ids[0]), end + 1); end = from + ids.length - 1; groups.push({ ids, from, to: end }); ids.forEach((id) => { posOf[id] = { pos: from, tie: ids.length > 1, of: ids.length }; }); i = j; } }
  const covered = (p) => groups.some((g) => p >= g.from && p <= g.to), placeHit = {};
  groups.forEach((g) => { let potG = 0; rules.rows.forEach((r, i) => { if ((r.k === 'place' && r.r >= g.from && r.r <= g.to) || (r.k === 'champ' && hasPl && g.from === 1)) { potG += amts[i].reduce((s, v) => s + v, 0); placeHit[i] = g.ids.length; } });
    const each = Math.floor(potG / g.ids.length); let left = potG - each * g.ids.length; g.ids.forEach((id) => { add(id, each + (left > 0 ? 1 : 0)); if (left > 0) left--; }); });
  rules.rows.forEach((r, i) => {
    if (r.k === 'place' || (r.k === 'champ' && hasPl)) { const a = amts[i], tot = a.reduce((s, v) => s + v, 0), hit = placeHit[i] || 0; rowsOut.push({ k: r.k, r: r.r || null, n: r.n, pct: r.bp / 100, label: r.label, each: a.length ? a[0] / 100 : 0, total: tot / 100, hits: hit, paid: hit ? tot / 100 : 0, over: false, tie: hit > 1 }); return; }
    let evs = []; Object.keys(R).forEach((id) => { if (!teamLot[id]) return; const x = R[id];
      if (r.k === 'win') x.winT.forEach((t) => evs.push({ id, t }));
      else if (r.k === 'round' && x.reached >= r.r) evs.push({ id, t: x.reachT[r.r] || 0 });
      else if (r.k === 'champ' && x.champ) evs.push({ id, t: 0 });
      else if (r.k === 'big' && x.big) evs.push({ id, t: 0 }); });
    evs.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
    const a = amts[i]; let paid = 0; evs.forEach((e, k) => { const v = k < a.length ? a[k] : 0; add(e.id, v); paid += v; });
    rowsOut.push({ k: r.k, r: r.r || null, n: r.n, pct: r.bp / 100, label: r.label, each: a.length ? a[0] / 100 : 0, total: a.reduce((s, v) => s + v, 0) / 100, hits: evs.length, paid: paid / 100, over: evs.length > r.n });
  });
  // WHEN IS THE EVENT OVER? (then nothing stays "in play": what the table did not pay goes by the unsold-lot rule)
  //  hand-entered / plugged events (ROUND 4 B2, ROUND 5 #6, ROUND 6 M-2 + B2):
  //   - the commissioner marked the event finished (c.fin, Custom only), or EVERY team is done (has its place, is the champion, or is marked Out); or
  //   - place rows: every paid place is covered (a tie covers the places it takes) and, with a Champion row, somebody is 1st; or
  //   - a Champion row and no place rows: the champion is known; or
  //   - NO champion and no place rows: every slot of every row has been paid (nothing left to win).
  //  feed events: the champion is known. Events that have no champion (ROUND 6 B2: "this weekend"): the window has passed, the feed was read after it,
  //  and every listed game of a lot team is final, off (postponed / cancelled) or stands corrected; a game still open 7 days after the window counts as off.
  const over = (() => { const champK = Object.values(R).some((x) => x && x.champ);
    if (ev.manualOnly || ev.plug) { const pl = rules.rows.filter((r) => r.k === 'place'), champRow = rules.rows.some((r) => r.k === 'champ');
      const allDone = c.lots.every((l) => l.teams.every((t) => { const x = R[t.id]; return !!x && (eff(t.id) > 0 || !!x.out || !!x.champ); }));
      if ((ev.manualOnly && c.fin) || allDone) return true;
      if (pl.length) return (pl.every((r) => covered(r.r)) || placed.length === oi) && (!champRow || covered(1) || champK);
      if (champRow || champK) return champK || (champRow && covered(1));
      return rowsOut.every((x) => x.hits >= x.n); }
    if (champK) return true; if (ev.kinds.includes('champ') || !c.win || !c.win.to) return false;
    const now = ctx && ctx.now != null ? ctx.now : D.now(), g = ctx && ctx.g !== undefined ? ctx.g : gamesOf(c); if (!(chiDay(now) > c.win.to)) return false; if (chiDay(now) > addDay(c.win.to, WIN_GRACE)) return true;
    if (!g || !(chiDay(g.at) > c.win.to)) return false; const cg = R._cg || new Set(); return !(g.G || []).some((x) => !cg.has(x.id)); })();
  const lots = c.lots.map((l) => { const e = l.teams.reduce((s, t) => s + (earnT[t.id] || 0), 0), s = c.sold[l.id];
    const alive = !over && l.teams.some((t) => !(R[t.id] && R[t.id].out)); const out = { id: l.id, name: l.name, field: !!l.field, earnedC: e, alive, teams: l.teams.map((t) => ({ id: t.id, name: t.name, abbr: t.abbr, r: R[t.id] ? { wins: R[t.id].wins, reached: R[t.id].reached, champ: !!R[t.id].champ, out: !!R[t.id].out, big: !!R[t.id].big, place: R[t.id].place || null, pos: posOf[t.id] ? posOf[t.id].pos : null, tie: !!(posOf[t.id] && posOf[t.id].tie), manual: !!R[t.id].manual, corr: !!R[t.id].corr, disputed: R[t.id].disp || 0, reason: R[t.id].corr ? R[t.id].reason || '' : undefined, note: R[t.id].corr ? R[t.id].cnote || '' : undefined } : null, earned: (earnT[t.id] || 0) / 100 })) };
    if (s) { out.sold = { amt: s.amt, how: s.how, at: s.at }; out.holder = s.pid ? { pid: s.pid, name: mName(c, s.pid) } : { pid: null, name: s.name }; out._hk = hKey(c, s); if (s.bb) { const w = bbWho(c, s.bb); out.bb = { pid: w.pid, name: w.name }; out._bk = hKey(c, s.bb); } }
    return out; });
  // Playbook play 10: winnings of lots nobody bought. 'roll' (default): shared among the sold lots pro rata to what each has earned so far
  // (floors, leftover cents to the bigger earners; waits as "unclaimed" until a sold lot has earned). 'carry': set aside for the next Calcutta.
  // ROUND 5 #6: NOTHING IS STUCK "IN PLAY" WHEN THE EVENT IS OVER. Whatever the table could not pay (a paid place nobody holds because teams dropped
  // out, a win / round slot that never happened) is handled by the Calcutta's own unsold-lot rule, exactly like the winnings of an unsold lot.
  const wonC = lots.reduce((a, l) => a + l.earnedC, 0), leftC = over ? Math.max(0, poolC - wonC) : 0;
  const unsoldRule = rules.unsold === 'carry' ? 'carry' : 'roll', unsoldC = lots.filter((l) => !l.sold).reduce((a, l) => a + l.earnedC, 0) + leftC; let rolledC = 0;
  // ROUND 4 #4 + LOWER: the roll is PAID only when the event is over (an owner's winnings never go down mid-event); until then each sold lot shows its
  // share as "pending roll". Over and no sold lot earned anything: the unsold winnings are paid pro rata to the price paid, so nothing is left unpaid.
  let pendC = 0, rollBy = null;
  if (unsoldRule === 'roll' && unsoldC > 0) { let sl = lots.filter((l) => l.sold && l.earnedC > 0), w = (l) => l.earnedC; rollBy = 'earned';
    if (!sl.length && over) { sl = lots.filter((l) => l.sold); w = (l) => Math.round(l.sold.amt * 100); rollBy = 'price'; }
    const baseC = sl.reduce((a, l) => a + w(l), 0);
    if (baseC > 0) { let left = unsoldC; sl.forEach((l) => { l.shC = Math.floor(unsoldC * w(l) / baseC); left -= l.shC; }); const ord2 = sl.slice().sort((a, b) => w(b) - w(a) || a.id.localeCompare(b.id)); for (let k = 0; left > 0; k = (k + 1) % ord2.length, left--) ord2[k].shC++;
      if (over) { sl.forEach((l) => { l.rollC = l.shC; l.earnedC += l.shC; }); rolledC = unsoldC; } else { sl.forEach((l) => { l.pendC = l.shC; }); pendC = unsoldC; } } else rollBy = null; }
  const own = {}, O = (h, k) => (own[k] = own[k] || { key: k, pid: h.pid, name: h.name, spentC: 0, wonC: 0, pendC: 0, lots: [], alive: 0, out: 0 }); // ROUND 3 S-ALL: one owner per ACCOUNT (member, account key or guest id); only typed names go by name
  lots.forEach((l) => { if (!l.sold) return; const amtC = Math.round(l.sold.amt * 100);
    const pC = l.pendC || 0;
    if (l.bb) { const bbCost = Math.floor(amtC / 2), bbEarn = Math.floor(l.earnedC / 2), bbPend = Math.floor(pC / 2); const w = O(l.holder, l._hk), b = O(l.bb, l._bk);
      w.spentC += amtC - bbCost; w.wonC += l.earnedC - bbEarn; w.pendC += pC - bbPend; w.lots.push({ id: l.id, name: l.name, cost: (amtC - bbCost) / 100, earned: (l.earnedC - bbEarn) / 100, pendingRoll: (pC - bbPend) / 100, share: 'half', alive: l.alive });
      b.spentC += bbCost; b.wonC += bbEarn; b.pendC += bbPend; b.lots.push({ id: l.id, name: l.name, cost: bbCost / 100, earned: bbEarn / 100, pendingRoll: bbPend / 100, share: 'half (bought back)', alive: l.alive });
      [w, b].forEach((o) => (l.alive ? o.alive++ : o.out++)); }
    else { const w = O(l.holder, l._hk); w.spentC += amtC; w.wonC += l.earnedC; w.pendC += pC; w.lots.push({ id: l.id, name: l.name, cost: amtC / 100, earned: l.earnedC / 100, pendingRoll: pC / 100, share: 'all', alive: l.alive }); l.alive ? w.alive++ : w.out++; } });
  const owners = Object.values(own).map((o) => ({ key: o.key, oid: crypto.createHash('sha256').update(c.id + '|' + o.key).digest('hex').slice(0, 10), pid: o.pid, name: o.name, spent: o.spentC / 100, won: o.wonC / 100, net: (o.wonC - o.spentC) / 100, pendingRoll: o.pendC / 100, alive: o.alive, out: o.out, lots: o.lots }));
  owners.sort((a, b) => b.won - a.won || a.spent - b.spent || a.name.localeCompare(b.name)); owners.forEach((o, i) => { o.place = i + 1; });
  const paidC = lots.filter((l) => l.sold).reduce((a, l) => a + l.earnedC, 0), waitC = unsoldC - rolledC; // paid to owners | not (yet) with an owner
  lots.forEach((l) => { l.earned = l.earnedC / 100; l.rolled = (l.rollC || 0) / 100; l.pendingRoll = (l.pendC || 0) / 100; delete l.earnedC; delete l.rollC; delete l.pendC; delete l.shC; delete l._hk; delete l._bk; });
  return { pot: potC / 100, take: takeC / 100, takeKind: rules.take.kind, takeV: rules.take.v, pool: poolC / 100, paidOut: paidC / 100, unclaimed: waitC / 100, rolled: rolledC / 100, pendingRoll: pendC / 100, rollBy, leftover: leftC / 100, carry: unsoldRule === 'carry' ? unsoldC / 100 : 0, carryTo: unsoldRule === 'carry' ? carryTo(c) : null, unsoldRule, inPlay: (poolC - paidC - waitC) / 100, over, rows: rowsOut, lots, owners, main: rules.main };
}
const WIN_GRACE = 7; // days after a window event's last day when a game still without a result stops holding the money
const acctK = (k) => !!k && !/^n:/.test(k); // a member key or a guest id (not a typed name)
const bbWho = (c, h) => { if (h.pid) return { pid: h.pid, name: mName(c, h.pid) }; const m = acctK(h.k) ? c.members.find((x) => x.mk === h.k) : null; return m ? { pid: m.pid, name: m.name } : { pid: null, name: h.name || 'Player' }; }; // a co-owner who joined later is that member
const hKey = (c, h) => { const w = bbWho(c, h); return w.pid ? 'p:' + w.pid : acctK(h.k) ? 'k:' + h.k : 'n:' + String(h.name || '').toLowerCase(); };
const takeText = (r) => (r.take.kind === 'pct' && r.take.v ? 'Commissioner keeps ' + r.take.v + '% of the pot' : r.take.kind === 'flat' && r.take.v ? 'Commissioner keeps $' + (Number.isInteger(r.take.v) ? r.take.v : r.take.v.toFixed(2)) + ' of the pot' : 'Commissioner keeps nothing');

// ---------- views ----------
const porOut = (c, l, mk) => (l.por || []).map((e) => { const m = c.members.find((x) => x.mk === e.k); return Object.assign({ pid: m ? m.pid : null, name: m ? m.name : e.name || 'Player', me: !!mk && e.k === mk }, e.pend ? { pending: true } : {}, /^g:/.test(e.k) && mk && isComm(c, mk) ? { guest: e.k.slice(2) } : {}); }); // a guest's id goes to the commissioner only (to ask for a new claim link)
const porLocked = (c, l) => !!(l.porLockedAt || c.sold[l.id] || c.startedAt || (c.rules.mode === 'live' && c.a.status !== 'setup')); // ROUND 2 D4 + ROUND 3 #5
const isPor = (l, k) => (l.por || []).some((e) => e.k === k);
const isPorOk = (l, k) => (l.por || []).some((e) => e.k === k && !e.pend); // #5: a pending player (named by a source, has not joined) is in nobody's dashboard
function pub(c) { const ev = EVENTS[c.ev]; return { id: c.id, kind: 'calcutta', name: c.name, ev: c.ev, evLabel: ev.label, sport: ev.sport, rounds: ev.rounds || [], rules: c.rules, takeText: takeText(c.rules), unsoldText: unsoldText(c.rules, c), lots: c.lots.map((l) => ({ id: l.id, name: l.name, field: !!l.field, teams: l.teams, por: porOut(c, l, null).map((p) => ({ name: p.name })) })), local: evLocal(c.ev), feedBacked: feedBacked(c), golf: c.golf || null, evtId: c.evtId || null, count: c.members.length, max: maxOf(c), commName: mName(c, (c.members.find((m) => m.mk === c.comm) || {}).pid), status: c.a.status, locked: !!c.locked, group: c.group ? { groupId: c.group.groupId, contestId: c.group.contestId } : null }; }
function full(c, mk, now) {
  const o = pub(c), comm = isComm(c, mk); o.role = comm ? 'comm' : memberOf(c, mk) ? 'member' : 'none'; if (o.role === 'none') return o;
  o.lots = c.lots.map((l) => ({ id: l.id, name: l.name, field: !!l.field, teams: l.teams, por: porOut(c, l, mk), porLocked: porLocked(c, l) }));
  o.me = memberOf(c, mk).pid; o.code = c.code; o.members = c.members.map((m) => ({ pid: m.pid, name: m.name, comm: m.mk === c.comm }));
  const a = c.a; o.a = { status: a.status, order: a.order, cur: a.cur, endsAt: a.endsAt, paused: !!a.paused, left: a.left, nextAt: a.nextAt, nextLeft: a.nextLeft || null, just: a.just, timer: c.rules.timer };
  const hb = a.cur ? high(c, a.cur) : null; o.a.high = hb ? { pid: hb.pid, name: mName(c, hb.pid), amt: hb.amt } : null; o.a.minNext = a.cur ? (hb ? hb.amt + c.rules.inc : c.rules.minBid) : null;
  o.a.bids = a.cur ? (c.bids[a.cur] || []).slice(-6).reverse().map((b) => ({ pid: b.pid, name: mName(c, b.pid), amt: b.amt, at: b.at })) : [];
  o.sold = c.a.order.filter((id) => c.sold[id]).map((id) => { const s = c.sold[id]; return { lot: id, name: lotOf(c, id).name, holder: s.pid ? { pid: s.pid, name: mName(c, s.pid) } : { pid: null, name: s.name }, amt: s.amt, at: s.at, how: s.how, bb: s.bb ? (s.bb.pid ? { pid: s.bb.pid, name: mName(c, s.bb.pid) } : { pid: null, name: s.bb.name }) : null }; }).sort((x, y) => y.at - x.at);
  const st = startState(c, now), k = kickOf(c); o.started = st === 'started'; o.feedLock = st === 'unknown'; o.kick = !o.started && k && k.t0 ? k.t0 : null; /* the moment ownership locks, when known */ o.unsold = c.lots.filter((l) => !c.sold[l.id]).length; { const nf = noticesFor(c, memberOf(c, mk)); o.notices = nf.list; o.unread = nf.unread; o.pinned = nf.pinned; o.noticeTop = nf.top; }
  o.claims = Object.keys(c.guests || {}).filter((g) => c.guests[g].want && !c.guests[g].claimed).map((g) => ({ ref: gRef(c, g), guest: c.guests[g].name, by: c.guests[g].want.name, mine: c.guests[g].want.mk === mk })); /* ROUND 5 #8: claims waiting for another member */ if (comm) o.guests = Object.keys(c.guests || {}).map((g) => ({ guest: g, name: c.guests[g].name, claimed: !!c.guests[g].claimed })); o.a.undo = a.cur && (c.bids[a.cur] || []).length ? { k: 'bid' } : a.just && c.sold[a.just] && c.sold[a.just].how === 'auction' ? { k: 'sale', name: lotOf(c, a.just).name } : null;
  o.fin = c.fin ? { by: c.fin.by, at: c.fin.at } : null; o.canFinish = comm && !!EVENTS[c.ev].manualOnly && st === 'started'; /* ROUND 6 (B2) */ o.potSoFar = Object.values(c.sold).reduce((s, x) => s + x.amt, 0); o.now = now; o.rev = c.rev || 0; return o;
}
const canSee = (c, mk) => !!memberOf(c, mk);

// ---------- create (route + adapter) ----------
async function createCalc(e, b, opts) {
  const now = D.now(), mk = mkOf(e), nm = await nameOf(e, b && b.myName), mem = []; mem._me = { mk, name: nm }; const R = await cleanRules(b, now, mem, { e, mk }), ak = akOf(e);
  if (opts && opts.group && (await groupRole(opts.group.groupId, mk)) !== 'comm') throw bad(403, GRPCOMM, { code: 'groupcomm' }); // ROUND 4 B3
  const all = await idx(); if (Object.values(all).filter((x) => x.comm === mk && x.status !== 'closed').length >= 20) throw bad(400, 'You already run 20 open Calcuttas');
  let id; do { id = rnd(10); } while (all[id]); let code; do { code = newCode(); } while (Object.values(all).some((x) => x.code === code));
  const c = Object.assign({ id, code, comm: mk, ak, created: now, rev: 1, members: [{ pid: '', mk, name: nm, joined: now }], bids: {}, sold: {}, manual: {}, audit: [], locked: false, group: opts && opts.group ? opts.group : null }, R);
  c.members[0].pid = newPid(c); c.a = { status: 'setup', order: c.lots.map((l) => l.id), cur: null, endsAt: null, paused: false, left: null, nextAt: null, just: null };
  audit(c, nm, 'Created the Calcutta'); const links = syncGuests(c);
  await D.S.dbPut({ id: ROW(id), salt: 'x', pinhash: 'x', data: c, updated: now }, true); await capLoad(c); await syncIdx(c); touch(c, now); Object.defineProperty(c, '_links', { value: links, enumerable: false }); return c;
}

// ---------- routes ----------
async function joinCalc(id, u, nm, viaGroup, now) {
  const c = await mutCalc(id, (c) => { if (memberOf(c, u.mk)) return { nochange: true, v: c }; if (c.a.status === 'closed' && !c.lots.some((l) => isPor(l, u.mk))) throw bad(409, 'This auction is over'); /* a team's own player may still join (= accept being its player of record) after the auction */ if (c.group && !viaGroup) throw bad(409, 'Join this Calcutta from its group', { code: 'group' }); if (!c.group && viaGroup) throw bad(404, 'Calcutta not found');
    if (holders(c).size >= maxOf(c)) throw bad(409, capMsg(c, 'This Calcutta is full'), { code: 'cap' });
    c.members.push({ pid: newPid(c), mk: u.mk, name: nm, joined: now }); c.lots.forEach((l) => (l.por || []).forEach((p) => { if (p.k === u.mk) { delete p.pend; p.name = nm; } })); /* #5: joining accepts being a team's player of record */ c.rev++; audit(c, nm, viaGroup ? 'Joined from the group' : 'Joined'); return c; });
  await syncIdx(c); return c;
}
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (!path.startsWith('/calcutta')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  watch();
  try {
    const b = await body(req), ip = D.ip(req), now = D.now(), op = path.slice(10);
    if (op === 'peek') { // PUBLIC: an invite link's title before sign-in / sign-up. Only title + kind.
      rate('peek', ip, ip); /* REVIEW FIX 4: per IP (was one shared bucket) */ if (codeBlocked('c|i|' + ip)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.');
      const code = normCode(b.code), all = await idx(); let hit = null; if (code) Object.keys(all).forEach((id) => { if (sameCode(all[id].code, code)) hit = all[id]; });
      if (!hit) { codeFail('c|i|' + ip); throw bad(404, 'No Calcutta with that code'); } send(res, 200, { title: hit.name, kind: 'calcutta' }); return true;
    }
    const u = await me(req); try { await repairIdx(); } catch (e) {}
    if (op === 'events') { send(res, 200, { events: Object.keys(EVENTS).map((k) => { const ev = EVENTS[k]; return { key: k, label: ev.label, sport: ev.sport, on: evOn(k), local: evLocal(k), teams: ev.teams || 0, kinds: ev.kinds, rounds: ev.rounds || [], manualOnly: !!ev.manualOnly, weekend: !!ev.weekend, needsRef: ev.needsRef || null, plug: !!ev.plug, rows: ev.rows.map((r) => ({ k: r.k, r: r.r || null, n: r.n, pct: r.bp / 100, label: rowLabel(ev, r) })) }; }), minBids: MINB, incs: INCS, timers: TIMERS, timer0: TIMER0, unsold: Object.keys(UNSOLD).map((k) => ({ key: k, label: UNSOLD[k], text: unsoldText({ unsold: k }) })), max: await maxFor(akOf(u.e), ''), capText: PRICE }); return true; }
    if (op === 'teams') { const k = String(b.ev || ''); if (!EVENTS[k]) throw bad(400, 'Pick an event'); if (!evOn(k)) throw bad(400, 'That event is coming soon'); rate('teams', u.mk, ip); /* ROUND 4 #5: rate limit, the caller goes to the source, 4 s at most, refusals pass through */ const ref = srcRef(EVENTS[k], b); let list; try { list = await teamsOf(k, ref, u); } catch (e) { throw e.status === 403 || e.status === 504 ? e : bad(502, 'Could not load the teams. Try again.'); }
      send(res, 200, { teams: list.map((t) => ({ id: t.id, name: t.name, abbr: t.abbr, players: (t.players || []).length })) }); return true; }
    if (op === 'claim') { // ROUND 4 #7: a guest who signed up opens the claim link the commissioner sent: the guest's teams and buy-backs in THAT Calcutta move to the account
      if (codeBlocked('g|a|' + u.mk) || codeBlocked('g|i|' + ip)) throw bad(429, 'Too many wrong links. Wait 15 minutes.'); rate('claim', u.mk, ip);
      try { const o = await claimGuest(b.token, u.e, { name: await nameOf(u.e) }); if (o.pending) send(res, 202, { ok: false, pending: true, id: o.id, name: o.name, error: 'You run this Calcutta, so another member has to confirm before this guest becomes your account. Every member has been told.' }); else send(res, 200, { ok: true, id: o.id, name: o.name }); } catch (e) { if (e.status === 404) { codeFail('g|a|' + u.mk); codeFail('g|i|' + ip); } throw e; } return true; }
    if (op === 'mine') { const all = await idx(), out = []; Object.keys(all).forEach((id) => { const x = all[id]; if ((x.mks || []).includes(u.mk)) out.push({ id, name: x.name, ev: x.ev, evLabel: (EVENTS[x.ev] || {}).label || '', status: x.status, comm: x.comm === u.mk, created: x.created, group: x.group }); }); out.sort((a, b2) => b2.created - a.created); send(res, 200, { calcs: out.slice(0, 50), max: await maxFor(akOf(u.e), ''), capText: PRICE }); return true; }
    if (op === 'create') { rate('create', u.mk, ip); // { groupId } (OddJoin.openGame('calcutta', '', { groupId, create: true })): created FOR a group by that group's commissioner, and added to it
      const gid = b.groupId != null && b.groupId !== '' ? String(b.groupId) : ''; if (gid && (!/^[\w:-]{1,40}$/.test(gid) || (await groupRole(gid, u.mk)) !== 'comm')) throw bad(403, GRPCOMM, { code: 'groupcomm' });
      let c = await createCalc(u.e, b), attachError; const links = c._links || [];
      if (gid) { try { const G = D.groups(); if (G && typeof G.attachGame === 'function') await G.attachGame(gid, u.e, { type: 'calc', ref: c.id, name: c.name, pot: c.rules.main ? 'main' : 'side' }); /* Groups lists it and calls attachToGroup back */ const r1 = await loadRow(c.id, true); if (!r1.data.group) await attachToGroup(c.id, gid, ''); c = (await loadRow(c.id, true)).data; }
        catch (e) { attachError = e.status ? e.message : 'It could not be added to the group. Add it from the group.'; if (!e.status) console.error('calcutta attach:', e.message); } }
      send(res, 200, Object.assign({ calc: full(c, u.mk, now) }, links.length ? { guestLinks: links } : {}, attachError ? { attachError } : {})); return true; }
    if (op === 'gjoin') { // ROUND 4 B3: a Calcutta attached to a group is joined FROM ITS GROUP: any member of that group, by the Calcutta's id (the group screen has it). { preview: true } = look first.
      rate('join', u.mk, ip); const gid = String(b.id || ''); if (!/^[A-Z2-9]{10}$/.test(gid)) throw bad(404, 'Calcutta not found'); const r0 = await loadRow(gid); if (!r0 || r0.data.deleted || !r0.data.group) throw bad(404, 'Calcutta not found');
      if (!(await groupRole(r0.data.group.groupId, u.mk))) throw bad(403, 'Join the group first: this Calcutta is for its members', { code: 'group' }); /* ROUND 5: the group is asked every time (fail closed when it is gone or unreadable); someone already in the Calcutta opens it with get */ await capLoad(r0.data);
      if (b.preview) { send(res, 200, { calc: full(r0.data, u.mk, now) }); return true; }
      const c = await joinCalc(gid, u, await nameOf(u.e, b.myName), true, now); send(res, 200, { calc: full(c, u.mk, now) }); return true; }
    if (op === 'preview' || op === 'join') {
      if (codeBlocked('c|a|' + u.mk) || codeBlocked('c|i|' + ip)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.');
      rate('join', u.mk, ip); const code = normCode(b.code), all = await idx(); let id = null; if (code) Object.keys(all).forEach((k) => { if (sameCode(all[k].code, code)) id = k; });
      if (!id) { codeFail('c|a|' + u.mk); codeFail('c|i|' + ip); throw bad(404, 'No Calcutta with that code'); }
      { const r0 = await loadRow(id); if (r0) await capLoad(r0.data); }
      if (op === 'preview') { const c = await loadRow(id); if (!c) throw bad(404, 'No Calcutta with that code'); const o = full(c.data, u.mk, now); send(res, 200, { calc: o }); return true; }
      const c = await joinCalc(id, u, await nameOf(u.e, b.myName), false, now); send(res, 200, { calc: full(c, u.mk, now) }); return true;
    }
    const id = String(b.id || ''); if (!/^[A-Z2-9]{10}$/.test(id)) throw bad(404, 'Calcutta not found');
    { const r0 = await loadRow(id); if (r0 && !r0.data.deleted) { const c0 = r0.data; if (!c0.ak && isComm(c0, u.mk) && akOf(u.e)) { try { c0.ak = (await mutCalc(id, (c) => { if (c.ak) return { nochange: true, v: c }; c.ak = akOf(u.e); return c; })).ak; } catch (e) {} } await capLoad(c0); // the shared people limit for this Calcutta
      if (isComm(c0, u.mk) && c0.a.status === 'setup' && (op === 'get' || op === 'state' || op === 'board')) { const e0 = (await idx())[id]; if (!e0 || D.now() - (e0.act || 0) >= DAY) syncIdx(c0).catch(() => {}); } } } // ROUND 3 #7: the commissioner looking at a set-up is activity (and puts a pruned one back)
    if (op === 'get' || op === 'state') {
      let row = await loadRow(id); if (!row || !canSee(row.data, u.mk)) throw bad(404, 'Calcutta not found');
      if (needsSettle(row.data, now)) { await mutCalc(id, (c) => { c.rev++; return c; }); row = await loadRow(id); }
      touch(row.data, now); if (!row.data.startedAt && startState(row.data, now) === 'started') { await markStarted(id); row = await loadRow(id, true); } // ROUND 2 D2 + ROUND 3: at the kickoff (clock) or the first game seen live, the start is written down and a running auction closes
      if (op === 'state' && Number(b.rev) === Number(row.data.rev)) { const c = row.data; const st = startState(c, now); send(res, 200, { same: true, rev: c.rev, now, started: st === 'started', feedLock: st === 'unknown', a: { endsAt: c.a.endsAt, nextAt: c.a.nextAt, paused: !!c.a.paused } }); return true; }
      send(res, 200, { calc: full(row.data, u.mk, now) }); return true;
    }
    if (op === 'board') { let row = await loadRow(id); if (!row || !canSee(row.data, u.mk)) throw bad(404, 'Calcutta not found'); let R = await results(row.data, false);
      if (!row.data.startedAt && startState(row.data, D.now()) === 'started') { await markStarted(id); row = await loadRow(id, true); } // ROUND 2 D1: persist the start (ROUND 3: never from games that are only scheduled)
      const c = row.data, m = money(c, R);
      m.owners.forEach((o) => { o.me = o.pid === (memberOf(c, u.mk) || {}).pid; delete o.key; }); m.lots.forEach((l) => { l.por = porOut(c, lotOf(c, l.id), u.mk); l.porLocked = porLocked(c, lotOf(c, l.id)); if (isComm(c, u.mk) && feedBacked(c)) l.teams.forEach((t) => { const fx = fixable(c, t.id, now); if (fx) t.fix = { end: fx.end, place: !!fx.place, score: !!fx.score, games: (fx.list || []).map((x) => ({ id: x.id, t: x.t, teams: x.teams.map((tid) => ({ id: tid, name: teamName(c, tid) || 'Opponent' })) })) }; }); }); /* which one-game corrections look open, from the last list known (a hint: the route re-reads the feed) */ const r = RES.get(c.id);
      { const g = gamesOf(c), f = feedR(c), plan = R._plan || corrPlan(c, (f && f.R) || {}); m.corrections = Object.keys(c.corr || {}).filter((k) => !corrState(c, c.corr[k], g, f && f.R)).sort((a, b2) => c.corr[b2].at - c.corr[a].at).map((k) => { const x = c.corr[k], why = plan.pend[k] || null, nobj = (x.obj || []).length, bar = why ? confirmBar(c, x, u.mk) : null;
        return Object.assign({ ref: k, what: corrWhat(x), game: x.game || null, team: x.game == null ? x.team : x.w, lost: x.game == null ? null : x.l, day: x.game != null ? chiDay(x.t) : null, reason: x.reason, by: x.by, at: x.at, pending: !!why, objections: nobj, objected: (x.obj || []).some((o) => o.mk === u.mk), disputed: why ? 0 : nobj },
          why ? { why, whyText: WHYTXT[why], canConfirm: !bar && !nobj, bar: bar || (nobj ? 'A member objects: it cannot be confirmed while an objection stands' : null) } : {}, x.ok ? { confirmedBy: x.ok.by } : {}); }); } // ROUND 6 (B1): proposed / counts / disputed, for every member // every member sees every standing correction
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
      rate('ctl', u.mk, ip); const what = String(b.op || ''); let idxSync = false; let fz = false; if (['undo', 'sold', 'next', 'start', 'resume', 'reorder'].includes(what)) fz = await freezeCheck(id, false); /* ROUND 2 D2; ROUND 3 #4: never waits on the feed; ROUND 4: reorder too */
      const c = await mutCalc(id, (c) => {
        if (!isComm(c, u.mk)) throw bad(403, 'Only the commissioner runs the auction'); const by = mName(c, memberOf(c, u.mk).pid), a = c.a;
        if (['undo', 'sold', 'next', 'start', 'resume', 'reorder'].includes(what)) frozenIf(c, fz);
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
        else if (what === 'reorder') { if (a.status === 'closed') throw bad(409, 'The auction is over'); const o = Array.isArray(b.order) ? b.order.map(String) : []; if (o.length !== c.lots.length || new Set(o).size !== o.length || o.some((x) => !lotOf(c, x))) throw bad(400, 'Send every lot once'); a.order = o; audit(c, by, 'Changed the auction order'); }
        else if (what === 'end') { if (a.status !== 'live') throw bad(409, 'The auction is not running'); if (a.cur && high(c, a.cur)) throw bad(409, 'There is a bid on this lot. Sell it or undo the bids first.'); a.status = 'closed'; a.cur = null; a.endsAt = null; a.nextAt = null; a.closedAt = D.now(); audit(c, by, 'Ended the auction with ' + unsold(c).length + ' lot(s) unsold'); idxSync = true; }
        else throw bad(400, 'Unknown control');
        c.rev++; return c;
      }, u.mk);
      if (idxSync) await syncIdx(c); send(res, 200, { calc: full(c, u.mk, now) }); return true;
    }
    if (op === 'seen') { // ROUND 5 #5: this member has seen the notices up to number n (their own unread marker; nobody else's changes)
      rate('write', u.mk, ip); const c = await mutCalc(id, (c) => { const m = memberOf(c, u.mk), top = c.nseq || 0, n = b.n == null ? top : Math.min(Math.floor(Number(b.n)) || 0, top); if (!(n > (m.seenN || 0))) return { nochange: true, v: c }; m.seenN = n; return c; }, u.mk);
      send(res, 200, { calc: full(c, u.mk, now) }); return true; }
    if (op === 'corrok' || op === 'object') { // ROUND 6 (B1): ANOTHER member confirms a proposed correction; ANY member objects to (or withdraws an objection to) any correction
      rate('write', u.mk, ip); const key = typeof b.ref === 'string' ? b.ref : '';
      const c = await mutCalc(id, (c) => { const m = memberOf(c, u.mk), x = Object.prototype.hasOwnProperty.call(c.corr || {}, key) ? c.corr[key] : null, f = feedR(c), R0 = (f && f.R) || {};
        if (!x || corrState(c, x, gamesOf(c), R0)) throw bad(404, 'That correction is no longer there');
        if (op === 'object') { if (isComm(c, u.mk)) throw bad(403, 'The commissioner removes his own correction instead of objecting to it', { code: 'confirm' }); x.obj = x.obj || []; const i = x.obj.findIndex((o) => o.mk === u.mk);
          if (b.off) { if (i < 0) return { nochange: true, v: c }; x.obj.splice(i, 1); if (!x.obj.length) delete x.obj; const txt = m.name + ' withdrew the objection to the correction "' + corrWhat(x) + '"'; audit(c, m.name, txt); notice(c, m.name, txt, true, true); }
          else { if (i >= 0) return { nochange: true, v: c }; x.obj.push({ mk: u.mk, name: m.name, at: D.now() }); const pend = !!corrPlan(c, R0).pend[key];
            const txt = m.name + ' OBJECTS to the commissioner correction "' + corrWhat(x) + '" (' + x.obj.length + ' member' + (x.obj.length === 1 ? '' : 's') + ' object' + (x.obj.length === 1 ? 's' : '') + '). ' + (pend ? 'It cannot be confirmed while an objection stands.' : 'It still counts, marked as disputed, until the score feed reports or the commissioner withdraws it.'); audit(c, m.name, txt); notice(c, m.name, txt, true, true); }
          c.rev++; return c; }
        const why = corrPlan(c, R0).pend[key]; if (!why) return { nochange: true, v: c }; const bar = confirmBar(c, x, u.mk); if (bar) throw bad(403, bar, { code: 'confirm' });
        if ((x.obj || []).length) throw bad(409, 'A member objects to this correction: it cannot be confirmed while an objection stands', { code: 'disputed' });
        x.ok = { by: m.name, at: D.now() }; const txt = m.name + ' confirmed the commissioner correction "' + corrWhat(x) + '": it counts now (the score feed still replaces it the moment it reports)'; audit(c, m.name, txt); notice(c, m.name, txt, true, true); c.rev++; return c; }, u.mk);
      await syncIdx(c); send(res, 200, { calc: full(c, u.mk, now) }); return true; }
    if (op === 'finish') { // ROUND 6 (B2): a hand-entered (Custom) event has no feed to say it is over: the commissioner marks it finished (or opens it again), with a pinned notice to all
      rate('write', u.mk, ip); const c = await mutCalc(id, (c) => { if (!isComm(c, u.mk)) throw bad(403, 'Only the commissioner can do that'); if (!EVENTS[c.ev].manualOnly) throw bad(409, 'This event ends by its own results', { code: 'feedonly' }); const by = mName(c, memberOf(c, u.mk).pid);
        if (b.off) { if (!c.fin) return { nochange: true, v: c }; delete c.fin; const txt = 'The commissioner opened the event again: it is not finished'; audit(c, by, txt); notice(c, by, txt, true, true); c.rev++; return c; }
        if (c.fin) return { nochange: true, v: c }; if (startState(c, D.now()) !== 'started') throw bad(409, 'Enter the first result before marking the event finished', { code: 'notstarted' });
        c.fin = { by, at: D.now() }; const txt = 'The commissioner marked the event FINISHED. Money the table did not pay is ' + (c.rules.unsold === 'carry' ? 'carried to ' + carryTo(c) : 'rolled into the payouts of the sold lots, pro rata') + '.'; audit(c, by, txt); notice(c, by, txt, true, true); c.rev++; return c; }, u.mk);
      send(res, 200, { calc: full(c, u.mk, now) }); return true; }
    if (op === 'claimok') { // ROUND 5 #8: ANOTHER member confirms (or turns down) the commissioner's claim of a guest whose buy-back he recorded himself
      rate('write', u.mk, ip); const c = await mutCalc(id, (c) => { const m = memberOf(c, u.mk); if (isComm(c, u.mk)) throw bad(403, 'Another member has to confirm this, not the commissioner', { code: 'confirm' });
        const gid = Object.keys(c.guests || {}).find((g) => c.guests[g].want && !c.guests[g].claimed && gRef(c, g) === String(b.ref || '')); if (!gid) throw bad(404, 'Nothing to confirm'); const g = c.guests[gid];
        if (b.ok === false) { const txt = m.name + ' did not confirm the claim of guest ' + g.name + ' by the commissioner: it stays with the guest'; delete g.want; audit(c, m.name, txt); notice(c, m.name, txt, true, true); }
        else { const w = g.want; finishClaim(c, gid, w.mk, w.name, m.name); } c.rev++; return c; }, u.mk);
      await syncIdx(c); send(res, 200, { calc: full(c, u.mk, now) }); return true; }
    if (op === 'buyback' || op === 'por') { // OWNER DECISION Nov 16 2026: classic golf Calcutta buy-back (see HANDOFF Decisions)
      rate('write', u.mk, ip); const lot = String(b.lot || ''); let fz = false, links = []; fz = await freezeCheck(id, true);
      const c = await mutCalc(id, (c) => {
        const me = memberOf(c, u.mk), by = me.name, comm = isComm(c, u.mk), l = lotOf(c, lot); if (!l) throw bad(404, 'No such lot');
        if (!evLocal(c.ev)) throw bad(409, 'Buy back half is not available for pro teams or golfers');
        if (op === 'por') { // commissioner sets the lot's players of record (members, guest ids or names)
          if (!comm) throw bad(403, 'Only the commissioner sets players of record');
          if (porLocked(c, l) || fz || startState(c, D.now()) !== 'open') throw bad(409, 'Players of record are locked once the lot is sold (or the live auction has started)', { code: 'porlocked' }); // ROUND 2 D4 + ROUND 3 #5: sticky, a lot that was EVER sold or entered stays locked
          const was = (l.por || []).length ? porOut(c, l, null).map((p) => p.name).join(', ') : 'none';
          const mem = c.members.slice(); mem._me = me; mem._guests = c.guests || {}; let por; if (b.add) { por = (l.por || []).slice(); const e = porEntry(b.add, mem, false); if (!por.some((x) => x.k === e.k)) por.push(e); if (por.length > 8) throw bad(400, 'Up to 8 players of record per lot'); } else if (b.remove != null) { const i = Number(b.remove); por = (l.por || []).filter((x, j) => j !== i); } else por = cleanPor(b.players, mem, false);
          l.por = por; links = syncGuests(c); const ptxt = 'Players of record for ' + l.name + ': ' + (por.length ? porOut(c, l, null).map((p) => p.name).join(', ') : 'none'); audit(c, by, ptxt + ' (was: ' + was + ')'); notice(c, by, ptxt, true); c.rev++; return c; }
        if (!c.rules.buyBack) throw bad(409, 'Buy back half is off for this Calcutta'); frozenIf(c, fz); const wasClosed = c.a.status === 'closed';
        const s = c.sold[lot]; if (!s) throw bad(409, 'That lot is not sold yet');
        if (!(l.por || []).length) throw bad(409, 'Only the lot\'s own player(s) can buy it back, and this lot has none in the group');
        const mine = isPor(l, u.mk);
        if (b.clear) { if (!s.bb) return { nochange: true, v: c }; if (!comm && !(s.bb.k && s.bb.k === u.mk)) throw bad(403, 'Only the commissioner or the player who bought back can remove it'); { const txt = 'Buy-back removed on ' + l.name + ': ' + buyerOf(c, s) + ' (the buyer, $' + s.amt + ') owns all of it again'; audit(c, by, txt); notice(c, by, txt, true, true); } s.bb = null; c.rev++; return c; }
        if (s.bb) throw bad(409, 'Half of this lot is already bought back');
        let e; // which player of record buys back
        if (!comm || b.self) { if (!mine) throw bad(403, 'Only the lot\'s own player(s) can buy back half'); e = l.por.find((x) => x.k === u.mk); }
        else { const i = Number(b.who); if (!(Number.isInteger(i) && i >= 0 && i < l.por.length)) throw bad(400, 'Pick which player of record buys back'); e = l.por[i]; }
        const m = c.members.find((x) => x.mk === e.k), w = m ? { pid: m.pid, name: '' } : { pid: null, name: e.name || 'Player' };
        if (!m && /^[0-9a-f]{24}$/.test(e.k)) throw bad(409, 'That player has to join this Calcutta before a buy-back can be recorded for them', { code: 'notjoined' }); // ROUND 4 #5/#6: no money on the dashboard of an account that never joined
        if ((w.pid && w.pid === s.pid) || (!w.pid && !s.pid && w.name.toLowerCase() === s.name.toLowerCase())) throw bad(400, 'The buyer cannot buy back from themselves');
        s.bb = { pid: w.pid, name: w.name, k: e.k, at: D.now() }; if (holders(c).size > maxOf(c)) throw bad(409, capMsg(c, 'Too many people'), { code: 'cap' });
        { const txt = (w.pid ? mName(c, w.pid) : w.name) + ' bought back half of ' + l.name + ' for $' + (Math.floor(s.amt * 100 / 2) / 100) + ' from its buyer ' + buyerOf(c, s) + ' (who paid $' + s.amt + ')' + (comm && !mine ? ', recorded by the commissioner' : ''); audit(c, by, txt); notice(c, by, txt, true, true); } /* ROUND 6 (B3): every buy-back is a pinned notice to all, the buyer named */ void wasClosed; c.rev++; return c;
      }, u.mk);
      if (op === 'por') await syncIdx(c); /* S-ALL: the index knows each lot's players */ send(res, 200, Object.assign({ calc: full(c, u.mk, now) }, links.length ? { guestLinks: links } : {})); return true;
    }
    if (op === 'enter' || op === 'unenter' || op === 'result' || op === 'edit' || op === 'delete' || op === 'close' || op === 'guestlink') {
      rate('write', u.mk, ip); let idxSync = op === 'enter' || op === 'unenter' || op === 'close';
      if (op === 'edit') { const row0 = await loadRow(id, true); if (!row0 || !canSee(row0.data, u.mk)) throw bad(404, 'Calcutta not found'); const mem = row0.data.members.slice(); mem._me = memberOf(row0.data, u.mk); if (!isComm(row0.data, u.mk)) throw bad(403, 'Only the commissioner can change the rules'); mem._guests = row0.data.guests || {}; const R = await cleanRules(b, now, mem, u); let links = [];
        const c = await mutCalc(id, (c) => { if (!isComm(c, u.mk)) throw bad(403, 'Only the commissioner can change the rules'); if (c.startedAt || Object.keys(c.sold || {}).length || c.lots.some((l) => l.porLockedAt)) throw bad(409, 'A lot has been sold: the event and its lots can no longer be changed.', { code: 'sold' }); // ROUND 4 B4 (ROUND 5: answered first, with its code)
          if (c.locked || c.a.status !== 'setup') throw bad(409, 'Rules are locked. The auction has started.', { code: 'locked' });
          Object.assign(c, R); c.a.order = c.lots.map((l) => l.id); delete c.kick; delete c.fr; c.er = (c.er || 0) + 1; /* ROUND 4 B4: nothing read for the old event (kickoff, results) survives an edit */ links = syncGuests(c); c.rev++; audit(c, mName(c, memberOf(c, u.mk).pid), 'Edited the rules'); return c; }, u.mk);
        KICK.delete(id); RES.delete(id); GAMESOF.delete(id); await syncIdx(c); touch(c, now); send(res, 200, Object.assign({ calc: full(c, u.mk, now) }, links.length ? { guestLinks: links } : {})); return true; }
      if (op === 'guestlink') { // ROUND 4 #7: the commissioner asks for a NEW claim link for a guest of this Calcutta who has not claimed yet (the old link stops working)
        let out = null; await mutCalc(id, (c) => { if (!isComm(c, u.mk)) throw bad(403, 'Only the commissioner can do that'); const gid = String(b.guest || '').replace(/^g:/, ''); c.guests = c.guests || {};
          const here = Object.prototype.hasOwnProperty.call(c.guests, gid) || c.lots.some((l) => isPor(l, 'g:' + gid)); if (!gid || !here) throw bad(404, 'No such guest in this Calcutta'); const g = c.guests[gid] = c.guests[gid] || { name: 'Guest', at: D.now(), claimed: null };
          if (g.claimed) throw bad(409, 'That guest already claimed an account'); const token = c.id + '-' + rnd(20); g.th = tokHash(token); out = { guest: gid, name: g.name, token }; audit(c, mName(c, memberOf(c, u.mk).pid), 'New claim link for guest ' + g.name); return c; }, u.mk);
        send(res, 200, { guestLinks: [out] }); return true; }
      if (op === 'result') { const r0 = await loadRow(id); if (r0 && !r0.data.deleted && memberOf(r0.data, u.mk) && feedBacked(r0.data)) { const c = await correction(id, u, b, ip); send(res, 200, { calc: full(c, u.mk, D.now()) }); return true; } } // ROUND 5: a feed-backed event has ONE way in: the one-game correction
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
          if (feedBacked(c)) throw bad(409, FEEDONLY, { code: 'feedonly' }); // (the event was edited in between)
          const ev = EVENTS[c.ev], fb = false, cur = Object.assign({}, c.manual[tid] || {}), nx = {}; let fx = null, reason = '';
          if (b.clear) { if (!c.manual[tid]) return { nochange: true, v: c }; delete c.manual[tid]; const txt = fb ? 'Correction for ' + team.name + ' removed by the commissioner (back to the score feed)' : 'Hand-entered result for ' + team.name + ' cleared by the commissioner'; audit(c, by, txt); notice(c, by, txt, true); c.rev++; return c; }
          // ROUND 4 B1: a feed-backed event takes its results from the feed ONLY. One exception: a correction, when the feed still has no result for
          // this team's game 24 hours after its scheduled end; with a reason, a notice to every member, a visible tag, and the feed replaces it when it reports.
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
          c.manual[tid] = Object.assign(fb && !cur.corr ? {} : cur, nx, { at: D.now() }, fb ? { corr: true, games: fx.games, reason, by } : {}); startNow(c); /* ROUND 2 D3: a result means the event has started, for good */
          const vals = Object.keys(nx).map((k) => k + ' ' + (nx[k] === true ? 'yes' : nx[k] === false ? 'no' : nx[k])).join(', '), txt = fb ? 'Entered by commissioner (correction) for ' + team.name + ': ' + vals + '. Reason: ' + reason : 'Result entered by the commissioner for ' + team.name + ': ' + vals;
          audit(c, by, txt + (fb ? '. The score feed replaces it the moment it reports.' : '')); notice(c, by, txt, true); // every hand result or change reaches every member
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
// ROUND 4 B3 (contract with Groups: groups.registerGame('calc', { potSummary, attachToGroup }); wireGroups(G) does it):
// - attachToGroup(id, groupId, contestId): ONLY when the Calcutta's commissioner is that group's commissioner (the contract passes no caller, so the
//   engine checks the two commissioners are the same account); a Calcutta already in another group is refused. Throws 403 / 409 otherwise.
// - a group member joins with POST /calcutta/gjoin { id } (or joinFromGroup(id, accountId) from server code); join-by-code stays refused.
// - who is in a group: hooks.groupRole(groupId, memberKey) -> 'comm' | 'member' | null (the manager may set it); default = read the group's row
//   ('lock:grp:<id>', or the older one-row 'lock:groups'), same member key as Groups. Anything unreadable = not a member (fail closed).
async function groupRole(groupId, mk) {
  try { const gid = String(groupId || ''); if (!/^[\w:-]{1,40}$/.test(gid) || !mk) return null;
    if (typeof hooks.groupRole === 'function') { const r = await hooks.groupRole(gid, mk); return r === 'comm' || r === 'member' ? r : null; }
    let g = null; const r1 = await D.S.dbGet('lock:grp:' + gid); if (r1 && r1.data) g = r1.data; else { const r2 = await D.S.dbGet('lock:groups'); g = r2 && r2.data && r2.data.groups ? r2.data.groups[gid] : null; }
    if (!g || g.deleted) return null; return g.comm === mk ? 'comm' : (g.members || []).some((m) => m.mk === mk) ? 'member' : null;
  } catch (e) { return null; }
}
async function attachToGroup(id, groupId, contestId) {
  const gid = cleanName(groupId, 40), row = await loadRow(String(id), true); if (!row || row.data.deleted) throw bad(404, 'Calcutta not found');
  if ((await groupRole(gid, row.data.comm)) !== 'comm') throw bad(403, GRPCOMM, { code: 'groupcomm' });
  const c = await mutCalc(String(id), (c) => { if (c.group && c.group.groupId !== gid) throw bad(409, 'This Calcutta is already in another group', { code: 'attached' }); if (c.group) return { nochange: true, v: c };
    if (c.locked || c.a.status !== 'setup' || c.startedAt || Object.keys(c.sold || {}).length) throw bad(409, 'The rules are locked (bids are in): this Calcutta can no longer be moved into a group', { code: 'locked' }); /* ROUND 5 #7: the rule text members saw (carry, main pot) never changes after the first bid */ c.group = { groupId: gid, contestId: cleanName(contestId, 40) }; audit(c, 'Group', 'Attached to a group: it is joined from the group now'); c.rev++; return c; }); await syncIdx(c); return { id: c.id, group: c.group }; }
async function joinFromGroup(id, accountId, myName) { const u = { e: String(accountId), mk: mkOf(String(accountId)) }, row = await loadRow(String(id)); if (!row || row.data.deleted || !row.data.group) throw bad(404, 'Calcutta not found'); if (!(await groupRole(row.data.group.groupId, u.mk))) throw bad(403, 'Join the group first: this Calcutta is for its members', { code: 'group' }); await capLoad(row.data); const c = await joinCalc(String(id), u, await nameOf(u.e, myName), true, D.now()); return { id: c.id, members: c.members.length }; }
function wireGroups(G) { if (!G || typeof G.registerGame !== 'function') return false; G.registerGame('calc', { potSummary, attachToGroup }); return true; }
// potSummary: pool = paidOut + inPlay + unclaimed + carried in EVERY table. unclaimed = winnings of unsold lots waiting to roll into the sold lots
// (paid when the event is over); carried = winnings of unsold lots set aside for the next Calcutta (carry rule). main = counts in the group's MAIN pot.
// Never waits on the score feed (cached results; a background re-read).
async function potSummary(id) { const row = await loadRow(String(id)); if (!row || row.data.deleted) return null; const c = row.data, m = money(c, await results(c, 'cache')), carry = m.unsoldRule === 'carry';
  return { bids: m.pot, take: m.take, pool: m.pool, main: m.main, paidOut: m.paidOut, inPlay: m.inPlay, unclaimed: carry ? 0 : m.unclaimed, carried: carry ? m.carry : 0, carryTo: m.carryTo, unsoldRule: m.unsoldRule, over: m.over, payouts: m.owners.map((o) => ({ pid: o.pid, name: o.name, spent: o.spent, won: o.won })) }; }
// Stats contract (stats coder). OWNER DECISION S-ALL (Nov 16 2026): one record for EVERY Calcutta the user is in as a buyer, a co-owner
// (bought back half) or a team's own player (player of record), with the team(s), price paid (spent), payout (won) and net (pl).
// userKey = account id (acct.who) or member key. A team player who owns no share gets a record with spent/won/pl 0 and the team's result.
async function statsFor(userKey, opt) {
  const guest = /^g:[\w-]{1,40}$/.test(String(userKey)); // a guest id works too (a guest has no dashboard until they claim an account: claimGuest)
  const mk = guest || /^[0-9a-f]{24}$/.test(String(userKey)) ? String(userKey) : mkOf(String(userKey)), from = (opt && opt.from) || '0000-00-00', to = (opt && opt.to) || '9999-99-99';
  const all = await idx(), out = [];
  const ids = Object.keys(all).filter((id) => { const e = all[id]; return (e.mks || []).includes(mk) || (e.pks || []).includes(mk) || (e.gks || []).includes(mk) || ((!e.pks || (guest && !e.gks)) && evLocal(e.ev)); }); // old entries without pks / gks: local events are opened
  const rows = []; for (let i = 0; i < ids.length; i += 8) rows.push(...(await Promise.all(ids.slice(i, i + 8).map((id) => loadRow(id).catch(() => null))))); // 8 reads at a time
  for (const row of rows) { if (!row || row.data.deleted) continue; const c = row.data, m = memberOf(c, mk), myPid = m ? m.pid : null;
    const mine = c.lots.filter((l) => { const s = c.sold[l.id]; return isPorOk(l, mk) || (s && myPid && (s.pid === myPid || (s.bb && s.bb.pid === myPid))) || (s && s.bb && s.bb.k === mk); });
    if (!mine.length) continue; // a member who bought nothing and plays on no team is not in this Calcutta's money
    const sales = Object.values(c.sold).map((s) => s.at).filter(Boolean), date = chiDay(sales.length ? Math.min(...sales) : c.created); if (date < from || date > to) continue;
    const kept = feedR(c), mo = money(c, await results(c, 'cache')); let spentC = 0, wonC = 0, pendC = 0; const roles = new Set(), teams = []; // ROUND 4 #1: NEVER waits on a feed: the last results known (memory or the row) and a re-read in the background
    mine.forEach((l) => { const s = c.sold[l.id], ml = mo.lots.find((x) => x.id === l.id), earnC = Math.round(ml.earned * 100), amtC = s ? Math.round(s.amt * 100) : 0;
      const buyer = !!(s && myPid && s.pid === myPid), co = !!(s && s.bb && ((myPid && s.bb.pid === myPid) || s.bb.k === mk)), player = isPorOk(l, mk), prC = Math.round((ml.pendingRoll || 0) * 100);
      let cost = 0, earned = 0, pend = 0, share = 'none';
      if (buyer) { cost = s.bb ? amtC - Math.floor(amtC / 2) : amtC; earned = s.bb ? earnC - Math.floor(earnC / 2) : earnC; pend = s.bb ? prC - Math.floor(prC / 2) : prC; share = s.bb ? 'half' : 'all'; roles.add('buyer'); }
      if (co) { cost += Math.floor(amtC / 2); earned += Math.floor(earnC / 2); pend += Math.floor(prC / 2); share = buyer ? 'all' : 'half (bought back)'; roles.add('co-owner'); }
      if (player) roles.add('player');
      spentC += cost; wonC += earned; pendC += pend;
      teams.push({ lot: l.id, name: l.name, teams: l.teams.map((t) => t.name), role: [buyer && 'buyer', co && 'co-owner', player && 'player'].filter(Boolean).join(' + '), share, cost: cost / 100, earned: earned / 100, pendingRoll: pend / 100, net: (earned - cost) / 100,
        price: s ? s.amt : null, lotEarned: ml.earned, alive: ml.alive, sold: !!s, holder: ml.holder ? ml.holder.name : null }); });
    const o = mo.owners.find((x) => x.key === (myPid ? 'p:' + myPid : 'k:' + mk)); // ROUND 3 S-ALL: by account key, never by display name
    const owns = roles.has('buyer') || roles.has('co-owner');
    out.push(Object.assign({ src: 'calcutta', id: c.id, date, sport: EVENTS[c.ev].sport, kind: 'calcutta' }, c.group ? { groupId: c.group.groupId, contestId: c.group.contestId } : {}, { title: c.name, result: null },
      owns && o ? { place: { n: o.place, of: mo.owners.length } } /* REVIEW FIX 5: stats contract {n, of} */ : {},
      { spent: spentC / 100, won: wonC / 100, pl: (wonC - spentC) / 100, verified: true,
        extra: { role: [...roles], over: mo.over, ev: c.ev, pendingRoll: pendC / 100, asOf: feedBacked(c) ? (kept ? kept.at : null) : D.now(), teams, lots: teams.filter((t) => t.share !== 'none').map((t) => ({ name: t.name, cost: t.cost, earned: t.earned })) } }));
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
// Players of record from the group side (golf-day teams, pickleball pairs): players = account ids, 24-hex member keys, 'g:<guest id>' or {name}.
async function setPlayersOfRecord(id, lotId, players) { const c = await mutCalc(id, (c) => { if (!evLocal(c.ev)) throw bad(409, 'Players of record are only for local events'); const l = lotOf(c, String(lotId)); if (!l) throw bad(404, 'No such lot'); if (porLocked(c, l) || startState(c, D.now()) !== 'open') throw bad(409, 'Players of record are locked once the lot is sold (or the live auction has started)'); const was = (l.por || []).length ? porOut(c, l, null).map((p) => p.name).join(', ') : 'none'; l.por = cleanPor(players, c.members, true); syncGuests(c); audit(c, 'Group', 'Players of record for ' + l.name + ' set by the group: ' + (l.por.length ? porOut(c, l, null).map((p) => p.name).join(', ') : 'none') + ' (was: ' + was + ')'); notice(c, 'Group', 'Players of record for ' + l.name + ' set by the group', true); c.rev++; return c; }); await syncIdx(c); return { id: c.id, lot: lotId, count: lotOf(c, String(lotId)).por.length }; }
// ROUND 3 S-ALL: a guest ('g:<guest id>' player of record / co-owner) who later claims an Oddable account. The golf / events coder calls this once
// at the claim: every Calcutta that guest is in moves to the account (players of record, buy-backs), so statsFor(account) returns those plays.
// Identity only: who owns what does not change, so it is allowed after the event started. Audited. Returns { calcs: <how many were changed> }.
// ROUND 4 #7: claimGuest(token, accountIdOrMemberKey). The TOKEN is the unguessable claim link issued when the guest was created in a Calcutta
// ('<calc id>-<20 random characters>', shown once to the commissioner; only its hash is stored). It names ONE guest of ONE Calcutta and works ONCE.
// There is no way to claim by guest id any more, and a commissioner cannot name guest ids he did not create (porEntry). Server code that already
// proved a guest's identity its own way (a lot source's claim link) asks for a fresh token with reissueGuestToken(calcId, guestId) and passes it on.
// ROUND 5 #8: the history says WHO claimed. A commissioner cannot quietly become a guest he created after recording that guest's buy-back himself: his
// claim waits (c.guests[id].want) until ANOTHER member confirms it (POST /calcutta/claimok); until then the guest stays in the owner list as the guest.
const buyerOf = (c, s) => (s.pid ? mName(c, s.pid) : s.name || 'Player');
const guestLots = (c, gid) => { const gk = 'g:' + gid, out = []; c.lots.forEach((l) => { const s = c.sold[l.id]; if (isPor(l, gk) || (s && s.bb && s.bb.k === gk)) out.push(l.name + (s ? ' (bought by ' + buyerOf(c, s) + ' for $' + s.amt + (s.bb && s.bb.k === gk ? ', half bought back by this guest' : '') + ')' : ' (not sold)')); }); return out.length ? out.join('; ') : 'no lot'; };
const gRef = (c, gid) => crypto.createHash('sha256').update(c.id + '|guest|' + gid).digest('hex').slice(0, 10); // what members get instead of the guest id
function finishClaim(c, gid, mk, by, okBy) { const gk = 'g:' + gid, m = memberOf(c, mk), g = c.guests[gid], lotsTxt = guestLots(c, gid);
  c.lots.forEach((l) => { if (isPor(l, gk)) { const had = isPor(l, mk); l.por = l.por.filter((p) => p.k !== gk || !had); l.por.forEach((p) => { if (p.k === gk) { p.k = mk; p.was = gk; delete p.pend; if (m) p.name = m.name; } }); } const s = c.sold[l.id]; if (s && s.bb && s.bb.k === gk) { s.bb.k = mk; s.bb.was = gk; if (m) { s.bb.pid = m.pid; s.bb.name = ''; } } });
  g.th = null; g.claimed = D.now(); g.by = by; delete g.want; // single use
  { const txt = 'Guest ' + g.name + ' was claimed by ' + by + (okBy ? ' (confirmed by ' + okBy + ')' : '') + ': the team and buy-backs of that guest now belong to that account'; audit(c, 'Oddable', txt); notice(c, 'Oddable', txt + '. Lot: ' + lotsTxt, true, true); } } // ROUND 6 (B3): every claim is a pinned notice to all, with the lot and its buyer
async function claimGuest(token, userKey, opt) {
  const tk = String(token || ''), NO = 'That claim link is not valid or was already used'; if (!/^[A-Z2-9]{10}-[A-Z2-9]{20}$/.test(tk) || !userKey) throw bad(404, NO); const id = tk.slice(0, 10), th = tokHash(tk), mk = /^[0-9a-f]{24}$/.test(String(userKey)) ? String(userKey) : mkOf(String(userKey)); let name = '', pending = false;
  let c; try { c = await mutCalc(id, (c) => { const gid = Object.keys(c.guests || {}).find((g) => c.guests[g].th && !c.guests[g].claimed && sameCode(c.guests[g].th, th)); if (!gid) throw bad(404, NO); const gk = 'g:' + gid, m = memberOf(c, mk), g = c.guests[gid]; name = g.name;
      const by = m ? m.name : cleanName(opt && opt.name, 24) || 'Player ' + mk.slice(0, 4).toUpperCase();
      if (mk === c.comm) { pending = true; /* ROUND 6 (B3): ANY claim by the commissioner of a guest of his own Calcutta waits for another member, buy-back or not, in whatever order */ if (g.want && g.want.mk === mk) return { nochange: true, v: c }; // a guest has no account, so its buy-back was recorded by the commissioner
        g.want = { mk, name: by, at: D.now() }; const txt = 'The commissioner (' + by + ') asked to claim guest ' + name + ' as his own account. Another member has to confirm before it moves. Lot: ' + guestLots(c, gid) + '.'; audit(c, by, txt); notice(c, by, txt, true, true); c.rev++; return c; }
      finishClaim(c, gid, mk, by, null); c.rev++; return c; }); } catch (e) { if (e.status === 404) throw bad(404, NO); throw e; }
  if (pending) return { calcs: 0, pending: true, id: c.id, name };
  await syncIdx(c); return { calcs: 1, id: c.id, name };
}
async function reissueGuestToken(calcId, guestId) { let token = null; await mutCalc(String(calcId), (c) => { const gid = String(guestId || '').replace(/^g:/, ''), g = c.guests && Object.prototype.hasOwnProperty.call(c.guests, gid) ? c.guests[gid] : null; if (!g || g.claimed) throw bad(404, 'No such unclaimed guest in this Calcutta'); token = c.id + '-' + rnd(20); g.th = tokHash(token); return c; }); return token; }
const hooks = {}; // reserved for the manager (e.g. hooks.groupMember(groupId, mk) when membership moves into the group)
module.exports = { corrPlan, confirmBar, handle, createCalc, attachToGroup, joinFromGroup, wireGroups, groupRole, setPlayersOfRecord, claimGuest, reissueGuestToken, evLocal, potSummary, fixable, seasonFor, statsFor, watch, watchTick, corrState, readFeed, registerSource, capText: PRICE, startState, hooks, EVENTS, cleanRows, slotAmounts, money, teamResults, parseGames, settle, mkOf, _deps: D, _reset: () => { RL.clear(); RC.clear(); RES.clear(); GC.clear(); GF.clear(); GI.clear(); KICK.clear(); GAMESOF.clear(); SHR.clear(); ENDW.clear(); WATCH.clear(); WBOOT = -1e15; PLAYED.clear(); MAXC.clear(); TEAMS.clear(); IDS.map = null; IDXC.at = 0; NAMES = { at: 0, v: {} }; writes = 0; }, _writes: () => writes };
