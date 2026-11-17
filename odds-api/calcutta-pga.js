// Calcutta source "golf" (branch calc-live, Nov 17 2026): THIS WEEK'S PGA Tour event, its golfers as the lots.
// Read through the app's own PGA data layer, pics/pga.js (PGA.parse = the one place that knows ESPN's golf scoreboard shape), so the Calcutta and
// the Golf tab read the same numbers. Plugged in by server.js with register(); the engine's own suites keep 'golf' unregistered ("coming soon").
//   teams(q)     -> the field of the event on the scoreboard now (q.golf.eventId, when given, must be that event; anything else = no field)
//                   ids 'e<eventId>d<yyyymmdd>:p<golferId>': which event and its start day travel with every lot, so the results can be read after
//                   the scoreboard has moved on to next week's event (scoreboard?dates=<yyyymmdd>, the same read PGA.loadEvent makes).
//   started(c)   -> true once ESPN shows the event in progress, suspended or final; false before; THROWS when the feed cannot be read (fail closed)
//   startTime(c) -> F5: the first tee time once ESPN lists it; until then the event's start date (midnight Eastern, ESPN's placeholder: the
//                   engine locks then at the latest). The engine also locks the moment started() is true.
//   endTime(c)   -> the event's end date
//   final(c)     -> F2: true once ESPN shows the event final (the engine then treats the Calcutta as over: paid places no lotted golfer took follow
//                   the unsold rule, and no commissioner correction opens)
//   results(c)   -> {} until the event is final, except a golfer the FEED flags wd / dq / cut (out). At final: place = the finishing position
//                   (ties share it: T3, T3 -> 3, 3, the engine splits the places they cover), everyone who did not finish = out, and (F3) every
//                   lotted golfer missing from the final board = out.
//   teams(q)     -> F6: no golfers once the event is in progress or final (throws 409 code 'underway' with a sentence the phone shows).
// NOT VERIFIED against the live feed on a tournament week: the field before Thursday, a round in progress, a playoff, the dated read (see pga.js).
// Nothing here touches money, accounts or messages.
const PGA = require('../pics/pga.js');
const CACHE = new Map(), TTL = 60e3;
let F = null; // fetch, handed in by register() (the engine's own, so the tests' fake ESPN answers)
async function board(url, eventId) {
  const key = url + '|' + (eventId || ''), h = CACHE.get(key); if (h && Date.now() - h.at < TTL) return h.p;
  const r = await F(url, { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('ESPN golf answered ' + r.status);
  const p = PGA.parse(await r.json(), eventId ? { eventId } : {}); CACHE.set(key, { at: Date.now(), p }); if (CACHE.size > 50) CACHE.delete(CACHE.keys().next().value); return p;
}
const ymd = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0'); };
const safe = (s) => String(s == null ? '' : s).replace(/[^\w-]/g, '').slice(0, 20);
const ID = /^e([\w-]{1,20})d(\d{8}):p([\w-]{1,20})$/;
const UNDERWAY = (ev) => (ev.status === 'final' ? 'This week\'s Tour event (' + String(ev.name || 'the event').slice(0, 60) + ') is over' : 'This week\'s Tour event (' + String(ev.name || 'the event').slice(0, 60) + ') has already started') + ', so its golfers can\'t be auctioned. Next week\'s field shows here once ESPN lists it (usually Monday or Tuesday).';
// which event a Calcutta is on: from its lots (every lot carries it)
function eventOf(c) { for (const l of (c && c.lots) || []) for (const t of l.teams || []) { const m = ID.exec(String(t.id)); if (m) return { id: m[1], day: m[2] }; } return null; }
async function eventBoard(c) {
  const e = eventOf(c); if (!e) throw new Error('not a PGA Calcutta');
  const now = await board(PGA.SB); if (now.event && safe(now.event.id) === e.id) return now;
  const p = await board(PGA.SB + '?dates=' + e.day, e.id); if (p.event && safe(p.event.id) === e.id) return p;
  throw new Error('the event is not on the scoreboard'); // fail closed: never "not started"
}
const source = {
  async teams(q) {
    const p = await board(PGA.SB), ev = p.event; if (!ev || !ev.dates.start || ev.status === 'canceled') return [];
    if (ev.status === 'in' || ev.status === 'suspended' || ev.status === 'final') throw Object.assign(new Error(UNDERWAY(ev)), { status: 409, code: 'underway' });
    const want = q && q.golf && q.golf.eventId; if (want && String(want) !== safe(ev.id)) return [];
    const pre = 'e' + safe(ev.id) + 'd' + ymd(ev.dates.start) + ':p';
    return p.players.filter((x) => x.status !== 'wd' && x.status !== 'dq' && safe(x.id)).map((x) => ({ id: pre + safe(x.id), name: x.name, abbr: '' }));
  },
  async started(c) { const ev = (await eventBoard(c)).event; return ev.status === 'in' || ev.status === 'suspended' || ev.status === 'final'; },
  async startTime(c) { const ev = (await eventBoard(c)).event; return Number.isFinite(ev.firstTee) && ev.firstTee > 0 ? ev.firstTee : Number.isFinite(ev.dates.start) && ev.dates.start > 0 ? ev.dates.start : null; },
  async final(c) { return (await eventBoard(c)).event.status === 'final'; },
  async endTime(c) { const ev = (await eventBoard(c)).event; return ev.dates.end || null; },
  async results(c) {
    const p = await eventBoard(c), e = eventOf(c), pre = 'e' + e.id + 'd' + e.day + ':p', R = {}, fin = p.event.status === 'final';
    p.players.forEach((x) => { const id = pre + safe(x.id); if (x.status !== 'active') { if (fin || x.statusSrc === 'feed') R[id] = { out: true }; return; }
      if (fin) { const m = /\d+/.exec(x.pos || ''); if (m) R[id] = { place: +m[0] }; else R[id] = { out: true }; } });
    if (fin) ((c && c.lots) || []).forEach((l) => (l.teams || []).forEach((t) => { if (!R[t.id]) R[t.id] = { out: true }; })); // F3: not on the final board = did not finish
    return R;
  },
};
function register(C) { F = (u, o) => C._deps.fetch(u, o); C.registerSource('golf', source); return source; }
module.exports = { register, source, eventOf, _reset: () => CACHE.clear() };
