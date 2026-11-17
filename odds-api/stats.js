// Oddable player stats (v1, Nov 16 2026). Owner: "Keep everybody's stats, lifetime stats, gameplay on every different sport they do.
// Whether it's Calcutta, whether it's just playing, or if they just want to keep their own stats based on their play."
//
// SHARED STATS CONTRACT (every engine module implements it; full text in HANDOFF.md "Player stats (v1)"):
//   statsFor(userKey, {from, to}) -> array of normalized records
//   {src: 'bets'|'groups'|'calcutta'|'golf'|'events'|'self', id, date (YYYY-MM-DD America/Chicago), sport, kind, groupId?, contestId?, title,
//    result: 'W'|'L'|'P'|'T'|null, place?: {n, of}, stake?, pl?, spent?, won?, units?, score?, toPar?, opponent?, verified: bool, extra?: {}}
//   Money fields are tracking info only (the app never moves money).
//   userKey = the signed-in account id from acct.who(req) (e.g. '<hex>@phone.oddable', an email, or 'owner'). Server-only, never sent to a phone.
//
// Providers: stats.register(src, fn). Built in: 'bets' (synced My Bets), 'groups' (Groups stage 1 contests), 'self' (My own stats, logged by hand).
// 'calcutta' / 'golf' / 'events' are registered later by the manager; a missing provider is simply absent, a failing one is skipped and named in `errors`.
// Storage (Supabase oddable_sync; the 'lock:' prefix keeps these rows out of every player list / owner count):
//   'lock:self:<sha256("oddable-self|"+userKey) first 32 hex>'  { items: [record] }   one row per player, conditional writes on `updated`
//   'lock:statshare'  { users: { <groups member key>: { e: userKey, at } } }   only players who switched ON "Show my lifetime stats to my groups"
// v1.1 (review fixes, Nov 16 2026; HANDOFF "Player stats (v1.1)"): contest records move stake / pl / units into `inner` (the bets inside, counted on the bets);
// record.money = {entry, payout, net, state: 'settled' | 'open' | 'unknown', atStake?}; rows 'lock:cfm:<cid>' (confirm links), 'lock:evp:<hash>' (a player's tournaments).
// Never returned to anyone: phones, phone hashes, sync row ids, account ids, member keys, PINs, tokens.
const crypto = require('crypto');
const D = {
  S: require('./sync'),
  acct: () => require('./acct'),
  groups: () => require('./groups'),
  now: () => Date.now(),
  ip: (req) => require('./ip').clientIp(req),
};
const SRC = ['bets', 'groups', 'calcutta', 'golf', 'events', 'self'];
const SPORTS = ['nfl', 'cfb', 'nba', 'wnba', 'ncaab', 'mlb', 'nhl', 'soccer', 'golf', 'pickleball', 'tennis', 'racing', 'horse', 'fight', 'other'];
const KINDS = ['bet', 'contest', 'calcutta', 'golf-round', 'golf-pool', 'match', 'event', 'tournament'];
// H1 naming (owner, Nov 16 2026): THE handicap is the "Oddable Handicap Index" with one small line under it; never called USGA / GHIN. Pickleball: "Oddable rating" (Elo), never DUPR.
const HCP_LABEL = 'Oddable Handicap Index', HCP_METHOD = 'Calculated with the World Handicap System method.', RATING_LABEL = 'Oddable rating';
const RESULTS = ['W', 'L', 'P', 'T'];
const DAY = 864e5, SHARE = 'lock:statshare', LOCKMS = 48 * 36e5; // self-logged entries can be edited or deleted for 48 hours after they are entered
const CACHE = new Map(); // userKey -> { at, v } (60 s)
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const bad = (status, error) => Object.assign(new Error(error), { status });
const body = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 20000) c.push(d); }); req.on('end', () => { if (n > 20000) return no(bad(413, 'Too big')); try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(bad(400, 'Bad request')); } }); req.on('error', no); });
const clone = (o) => JSON.parse(JSON.stringify(o));
const clean = (v, max) => String(v == null ? '' : v).replace(/[<>&"'`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 40);
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000, r1 = (x) => Math.round(x * 10) / 10;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- Central-time days and periods (same as the owner dashboard chips) ----------
const chiDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const okDay = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s; };
const PERIODS = ['wtd', 'mtd', 'ytd', 'all'];
function periodFrom(p, today) { // WTD starts Monday (dash.js from())
  if (p === 'ytd') return today.slice(0, 4) + '-01-01'; if (p === 'mtd') return today.slice(0, 7) + '-01';
  if (p === 'wtd') { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }
  return '';
}

// ---------- the contract: validate + normalize one record ----------
// ONE money rule for every record (S-ALL review fix, Nov 16 2026). Tiles, totals and rows all read this, so a total always equals its drill-down.
//   entry  = spent, else stake.   net = pl, else won - entry, else -entry for a loss / 0 for a push.   payout = won, else entry + net.
//   state 'settled' : the net is known and the play is over            -> counts in P/L, risked and ROI.
//   state 'open'    : still running, or no result and no payout yet     -> "Open: $150 at stake" (atStake), NOT in P/L until it settles.
//   state 'unknown' : over, but the record carries no payout / price    -> "Net: not known", NOT in P/L, still counted as a play. Never guessed (no -110).
// GROUP CONTESTS: a contest's own money is its entry and prize (spent / won). stake / pl / units on a contest record are the member's bets inside it; those
// bets are their own My Bets records (the same synced row, marked `gl`), so that money is counted there, once, and never on the contest.
const running = (o) => { const x = o.extra || {}; return x.live === true || x.over === false || x.settled === false || (x.started === true && x.ended === false); };
function moneyOf(o) {
  // A match made of several equal bets (a Nassau: front, back, total and each press; the golf engine sends stake = one bet and extra.bets = how many):
  // the entry is every bet together, so "entry $20, net -$40" can never show. money.per / money.bets keep the breakdown ("3 bets x $20").
  const has = (k) => o[k] != null, c = o.kind === 'contest', nb = !has('spent') && has('stake') && Number((o.extra || {}).bets) > 1 ? Math.min(50, Math.round(Number(o.extra.bets))) : 1;
  const entry = has('spent') ? o.spent : !c && has('stake') ? r2(o.stake * nb) : null;
  let net = !c && has('pl') ? o.pl : has('won') ? r2(N(o.won) - N(entry)) : o.result === 'L' && entry != null ? -entry : (o.result === 'P' || o.result === 'T') && entry != null ? 0 : null; // a tie hands the stake back, like a push (review 3, L6)
  // A row must add up on its own (review 3, L6): nobody loses more than they put in. A loss bigger than the entry on the record (a Nassau sent without
  // extra.bets, a deleted-bets day whose stake was lost from the log) means the entry on the record is short, so the entry shown is the loss itself.
  let entry0 = null, short = !c && !has('spent') && net != null && net < -0.005 && (entry == null || net < -entry - 0.005); if (short && entry != null) entry0 = entry;
  return moneyRow(o, short ? r2(-net) : entry, net, nb, entry0);
}
function moneyRow(o, entry, net, nb, entry0) {
  const has = (k) => o[k] != null;
  const payout = entry != null && net != null ? r2(Math.max(0, entry + net)) : has('won') ? o.won : null; // what came back: always entry + net when both are known, so a row adds up
  if (entry == null && net == null && payout == null) return null;
  const live = running(o), state = live ? 'open' : net != null ? 'settled' : o.result == null && !o.place && (o.extra || {}).over !== true ? 'open' : 'unknown';
  const m = state === 'settled' ? { entry, payout, net, state } : { entry, payout: null, net: null, state }; if (nb > 1 && entry0 == null) { m.per = o.stake; m.bets = nb; } if (entry0 != null) m.entryWas = entry0;
  if (state === 'settled') return m; if (state === 'open') { m.atStake = entry != null ? entry : 0; if (net != null) m.soFar = net; } return m;
}
const numKeys = ['stake', 'pl', 'spent', 'won', 'units', 'score', 'toPar'];
function validate(r, src) {
  const no = (why) => ({ ok: false, why });
  if (!r || typeof r !== 'object' || Array.isArray(r)) return no('not an object');
  if (!SRC.includes(r.src)) return no('src');
  if (src && r.src !== src) return no('src does not match the provider');
  if ((typeof r.id !== 'string' && typeof r.id !== 'number') || !String(r.id).length || String(r.id).length > 80) return no('id');
  if (!okDay(r.date)) return no('date');
  if (!SPORTS.includes(r.sport)) return no('sport');
  if (!KINDS.includes(r.kind)) return no('kind');
  if (r.result != null && !RESULTS.includes(r.result)) return no('result');
  if (typeof r.verified !== 'boolean') return no('verified');
  const o = { src: r.src, id: String(r.id).replace(/[^\w.:-]/g, '').slice(0, 80), date: r.date, sport: r.sport, kind: r.kind, title: clean(r.title, 90) || r.kind, result: r.result == null ? null : r.result, verified: r.verified };
  if (!o.id) return no('id');
  for (const k of ['groupId', 'contestId']) if (r[k] != null) { const v = String(r[k]).replace(/[^\w.:-]/g, '').slice(0, 40); if (v) o[k] = v; }
  if (r.place != null) { const n = Math.round(Number(r.place.n)), of = Math.round(Number(r.place.of)); if (!(n >= 1 && of >= n && of <= 100000)) return no('place'); o.place = { n, of }; }
  for (const k of numKeys) if (r[k] != null && r[k] !== '') { const v = Number(r[k]); if (!Number.isFinite(v) || Math.abs(v) > 1e9) return no(k); o[k] = k === 'units' ? r3(v) : k === 'score' || k === 'toPar' ? r1(v) : r2(v); }
  // S-ALL (owner, Nov 16 2026): every record shows the money as entry / payout / net (display only). Worked out from the contract fields:
  //   entry = spent (Calcutta) else stake; net = pl, else won - spent, else -stake for a loss; payout = won, else entry + net. A field that cannot be known is null.
  if (o.kind === 'contest' && (o.stake != null || o.pl != null || o.units != null)) { o.inner = {}; ['stake', 'pl', 'units'].forEach((k) => { if (o[k] != null) { o.inner[k] = o[k]; delete o[k]; } }); } // the bets inside a contest: shown, never totalled (see moneyOf)
  if (r.opponent != null) { const v = clean(r.opponent, 60); if (v) o.opponent = v; }
  if (r.extra != null) { if (typeof r.extra !== 'object' || Array.isArray(r.extra)) return no('extra'); const s = JSON.stringify(r.extra); if (s.length > 4000) return no('extra too big'); o.extra = JSON.parse(s); }
  { const m = moneyOf(o); if (m) o.money = m; } // after extra: live / over flags decide open vs settled
  // A place-only record (a finish with no W/L and no money, e.g. 3rd of 12 in a tournament) is marked so screens show the finish, never "Open".
  if (o.place && o.result == null && !o.money) o.placeOnly = true;
  return { ok: true, rec: o };
}

// ---------- aggregation ----------
const isDerived = (r) => !!(r.extra && r.extra.derived);
// Team rounds: the team score is not the player's own. Self-logged formats (individual / scramble / bestball) and the golf engine's formats
// (golf-score.js FORMATS: scramble4, scramble2, texas, florida, altshot, chapman are one team ball; shamble / bestball count only the team's best balls)
// are treated alike: only individual / stroke / stableford / nassau / skins rounds are a player's own score.
const OWNFMT = new Set(['individual', 'stroke', 'stableford', 'nassau', 'skins']);
const teamFmt = (r) => { const x = r.extra || {}; if (x.teamBall === true) return true; return !!(x.format && !OWNFMT.has(x.format)); };
// Holes: self rounds store extra.holes = 9 | 18; golf-engine rounds store extra.of = holes on the card and extra.holes = holes played so far.
const holesOf = (r) => { const x = r.extra || {}; return Number(x.of || x.holes) === 9 ? 9 : 18; };
const complete = (r) => { const x = r.extra || {}; return !x.of || Number(x.holes) >= Number(x.of); };
const order = (a, b) => require('./ratings').order(a, b); // date, entry time, id: the ONE order (ratings.js)
// What a play is, for the counts: 'W' | 'L' | 'P' | 'T' | 'open' (running) | 'fin' (a finished place or a settled Calcutta) | 'solo' (played, no W/L) | 'adj'.
function playState(r) {
  const x = r.extra || {}; if (x.adj) return 'adj'; if (running(r)) return 'open'; if (r.result) return r.result; if (r.place) return 'fin'; // still running = open, even when the engine already wrote a W or L on it: the record and the money always agree (review 3, L6)
  if (r.kind === 'golf-round' || x.solo) return 'solo'; if (r.kind === 'calcutta') { const m = moneyOf(r); return x.over === true || (m && m.state === 'settled') ? 'fin' : 'open'; } return 'open';
}
// Totals for a list. Every record is counted once, with moneyOf's one rule, so overall = the sum of the sports = the sum of the game types, and each total
// equals the rows in its drill-down: pl / staked from settled plays only, atStake from open ones, unknown = plays whose net is not known.
function tot(list) {
  const t = { n: 0, w: 0, l: 0, p: 0, t: 0, open: 0, solo: 0, fin: 0, firsts: 0, staked: 0, pl: 0, units: 0, atStake: 0, openMoney: 0, unknown: 0, money: false };
  let best = null, worst = null; const st = [];
  list.forEach((r) => {
    const ps = playState(r), m = moneyOf(r);
    if (ps === 'adj') { const a = r.extra.adj, w = N(a.w), l = N(a.l), p = N(a.p); t.n += w + l + p; t.w += w; t.l += l; t.p += p; } // deleted bets kept from the daily log (bets provider)
    else { t.n++; if (ps === 'W') t.w++; else if (ps === 'L') t.l++; else if (ps === 'P') t.p++; else if (ps === 'T') t.t++; else if (ps === 'open') t.open++; else if (ps === 'solo') t.solo++; else { t.fin++; if (r.place && r.place.n === 1) t.firsts++; } }
    if (m && m.state === 'settled') { t.pl += m.net; t.staked += N(m.entry); t.money = true; if (r.result && ps !== 'adj' && ps !== 'open') { if (!best || m.net > best.net) best = { r, net: m.net }; if (!worst || m.net < worst.net) worst = { r, net: m.net }; } }
    else if (m && m.state === 'open') { t.atStake += N(m.atStake); t.openMoney++; }
    else if (m) t.unknown++;
    if (r.units != null && r.kind !== 'contest' && ps !== 'open') t.units += r.units;
    if (ps === 'W' || ps === 'L') st.push(r);
  });
  t.staked = r2(t.staked); t.pl = r2(t.pl); t.units = r2(t.units); t.atStake = r2(t.atStake);
  t.pct = t.w + t.l ? r1(t.w / (t.w + t.l) * 100) : null; // pushes and ties left out, like My Bets
  t.roi = t.staked > 0 ? r1(t.pl / t.staked * 100) : null;
  const pick = (b) => (b ? { id: b.r.id, title: b.r.title, date: b.r.date, pl: b.net, src: b.r.src } : null);
  t.best = pick(best); t.worst = pick(worst && best && worst.r !== best.r ? worst : null);
  st.sort(order); let cur = 0, curR = '', lw = 0, ll = 0, run = 0, runR = '';
  st.forEach((r) => { if (r.result === runR) run++; else { runR = r.result; run = 1; } if (runR === 'W') lw = Math.max(lw, run); else ll = Math.max(ll, run); });
  if (st.length) { curR = st[st.length - 1].result; for (let i = st.length - 1; i >= 0 && st[i].result === curR; i--) cur++; }
  t.streak = cur ? curR + cur : ''; t.longW = lw; t.longL = ll;
  return t;
}
function calcutta(list) { // settled buys only in spent / won / net; open ones are listed as at stake
  const c = list.filter((r) => r.kind === 'calcutta'); if (!c.length) return null;
  let spent = 0, won = 0, atStake = 0, open = 0, best = null;
  c.forEach((r) => { const m = moneyOf(r); if (!m) return; if (m.state === 'open') { atStake += N(m.atStake); open++; return; } if (m.state !== 'settled') return; spent += N(m.entry); won += N(m.payout); if (!best || m.net > best.net) best = { id: r.id, title: r.title, date: r.date, net: r2(m.net), spent: N(m.entry), won: N(m.payout) }; });
  return { teams: c.length, open, atStake: r2(atStake), spent: r2(spent), won: r2(won), net: r2(won - spent), roi: spent > 0 ? r1((won - spent) / spent * 100) : null, best };
}
function golf(list) {
  const rounds = list.filter(ownRound).sort(order), teamRounds = list.filter((r) => r.kind === 'golf-round' && teamFmt(r)).length, pools = list.filter((r) => r.kind === 'golf-pool');
  if (!rounds.length && !pools.length) return null;
  const r18 = rounds.filter((r) => holesOf(r) === 18), r9 = rounds.filter((r) => holesOf(r) === 9), mean = (a) => (a.length ? r1(a.reduce((s, x) => s + x, 0) / a.length) : null);
  const tp = (r) => (r.toPar != null ? r.toPar : null), main = r18.length ? r18 : r9;
  const withTp = main.filter((r) => tp(r) != null);
  let best = null; withTp.forEach((r) => { if (!best || r.toPar < best.toPar || (r.toPar === best.toPar && r.date > best.date)) best = r; });
  // "Scoring trend": average to-par of the best 40% of the last 20 rounds (8 of 20). NOT an official handicap index.
  const last = withTp.slice(-20), k = Math.max(1, Math.round(last.length * 0.4)), low = last.map(tp).sort((a, b) => a - b).slice(0, k);
  const rec5 = withTp.slice(-5).map(tp), prev5 = withTp.slice(-10, -5).map(tp), d = rec5.length && prev5.length ? r1(mean(rec5) - mean(prev5)) : null;
  const fin = pools.filter((r) => r.place);
  return {
    teamRounds, rounds: rounds.length, rounds18: r18.length, rounds9: r9.length, avg: mean(r18.map((r) => r.score)), avg9: mean(r9.map((r) => r.score)), avgToPar: mean(withTp.map(tp)), holes: r18.length ? 18 : 9,
    best: best ? { id: best.id, title: best.title, date: best.date, score: best.score, toPar: best.toPar } : null,
    trend: last.length ? { value: mean(low), of: last.length, used: k, change5: d, dir: d == null ? '' : d < -0.4 ? 'better' : d > 0.4 ? 'worse' : 'steady', pts: last.map((r) => ({ date: r.date, toPar: r.toPar })) } : null,
    pools: pools.length, poolWins: fin.filter((r) => r.place.n === 1).length, poolTop3: fin.filter((r) => r.place.n <= 3).length,
    poolBest: fin.length ? fin.reduce((a, r) => (r.place.n < a.place.n ? r : a)).place : null,
  };
}
const LOCAL = ['pickleball', 'tennis'];
function local(list) {
  const l = list.filter((r) => LOCAL.includes(r.sport) || r.src === 'events'); if (!l.length) return null;
  const m = l.filter((r) => r.kind === 'match'), ev = l.filter((r) => r.kind === 'event');
  let gw = 0, gl = 0, pd = 0, hasG = false;
  m.forEach((r) => { const g = r.extra && Array.isArray(r.extra.games) ? r.extra.games : []; g.forEach((x) => { if (!Array.isArray(x)) return; const a = N(x[0]), b = N(x[1]); hasG = true; if (a > b) gw++; else if (b > a) gl++; pd += a - b; }); });
  return { matches: m.length, w: m.filter((r) => r.result === 'W').length, l: m.filter((r) => r.result === 'L').length, games: hasG ? gw + gl : 0, gw, gl, gamePct: gw + gl ? r1(gw / (gw + gl) * 100) : null, pointDiff: hasG ? pd : null,
    events: ev.length, titles: ev.filter((r) => (r.place && r.place.n === 1) || (!r.place && r.result === 'W')).length };
}
function node(list) { const o = { tot: tot(list) }; const c = calcutta(list), g = golf(list), lo = local(list); if (c) o.calcutta = c; if (g) o.golf = g; if (lo) o.local = lo; return o; }
function tree(list) {
  const o = node(list); o.bySport = {}; o.byKind = {};
  const bs = {}, bk = {}; list.forEach((r) => { (bs[r.sport] = bs[r.sport] || []).push(r); (bk[r.kind] = bk[r.kind] || []).push(r); });
  Object.keys(bs).forEach((s) => { const n = node(bs[s]); n.byKind = {}; const k2 = {}; bs[s].forEach((r) => { (k2[r.kind] = k2[r.kind] || []).push(r); }); Object.keys(k2).forEach((k) => { n.byKind[k] = node(k2[k]); }); o.bySport[s] = n; });
  Object.keys(bk).forEach((k) => { o.byKind[k] = node(bk[k]); });
  return o;
}
// Lifetime-only numbers (a period slice of a handicap or a rating means nothing): the Oddable Handicap Index (golf) and the Oddable rating (Elo) per local sport.
const R = require('./ratings');
// Course Rating / stroke index / hole scores under either naming: self rounds (cr, si, strokes) or golf-engine rounds (rating, hcpIdx, holeScores). MERGE NOTE in HANDOFF.
const crOf = (x) => (Number.isFinite(Number(x.cr)) && x.cr !== null && x.cr !== '' ? Number(x.cr) : x.rating !== null && x.rating !== '' && Number.isFinite(Number(x.rating)) ? Number(x.rating) : NaN);
const slopeOf = (x) => (x.slope !== null && x.slope !== '' && Number.isFinite(Number(x.slope)) ? Number(x.slope) : NaN);
const normCourse = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ownRound = (r) => r.kind === 'golf-round' && r.score != null && !teamFmt(r) && !(r.extra && r.extra.side) && complete(r);
// CONFIRMED (MANAGER RULE, Nov 16 2026, review 3; owner rule H1). Used by money games, flights, tournaments and seeding; golf rounds and matches alike.
// A round or match is confirmed ONLY when
//   (a) GAME: it was scored in an Oddable game (golf: hole by hole) where at least one OTHER account also had a scored card in the same game, and an
//       account on another team confirmed the card. The engine says so on the record:
//         extra.card = { others: <other accounts with a scored card in this game>, by: <stats.acctRef(confirmer account)> (or a list of them), byName, at }
//       A golf round also needs its hole scores on the record (extra.holeScores / extra.strokes, every hole). A match record from the events engine is
//       also read in its own shape: extra.confirmed === true + extra.confirmedBy {name, at} + extra.opp [{account: true}] + extra.oppKey.
//   (b) LINK: a self-logged entry confirmed through its confirm link by an account that is RECORDED AS HAVING PLAYED in that same round
//       (extra.confirmedBy = { name, ref, played: true, at }, written only by /stats/confirm/do after it checked the player slot on the entry).
// NEVER confirmed: extra.confirmed === false (a forfeit, an engine-marked unrated match: always believed), a one-player game, a typed-in guest, an account
// that only joined the game, a link confirmer who did not play, an entry dated before the account existed.
// COUNTING LIMITS (confirmMarks below, worked out in play order over a player's own records):
//   - LINK confirmations: no more than 2 of any 20 confirmable entries in a row from the same confirmer (the 3rd says why it does not count);
//   - GAME rounds (scored hole by hole in an Oddable game, another account's scored card, card confirmed by another team): one confirmer may account
//     for up to 8 of any 20 (manager change, Nov 16 2026: a regular foursome must not be held to 6 counting rounds);
//   - GAME matches (an event the engine marked confirmed: 3 or more accounts, the other side confirmed): no per-confirmer limit here; the
//     repeat-opponent weights in ratings.js (7-day halving, 2 rated per pair per rolling 24 hours) are the guard;
//   - typed totals (no hole scores) are confirmable by link only, and at most 5 of any 20 count.
// DIVERSITY: the money-game number needs at least 3 DIFFERENT confirming accounts across the counting entries (the last 20 confirmed); otherwise
// `use` is null, needsSet is true and the organizer / director sets the number ("needs rounds confirmed by 3 different players").
// REVIEW 4 (manager, Nov 17 2026; H1 three throwaway accounts, H3 filler entries):
//   - a confirmer counts only when its account was at least 30 days old WHEN IT CONFIRMED (byAgeDays; server sign-up stamp, else the earliest
//     server-stamped record) and it has itself at least 3 rounds or matches scored in Oddable games (byActs). Otherwise the confirmation is recorded and
//     shown, and does not count ("confirmer too new");
//   - fewer than 8 counting confirmed rounds (fullRounds) = a PROVISIONAL number: never used on its own, the organizer approves it on the make-up screen;
//   - at most 1 link-confirmed round counts per date played (linkPerDate); at most 3 rounds logged on one day count (perDay);
//   - the per-confirmer limits run over the COUNTING set only: 2 of any 20 by link (perBy), 8 of any 20 in all, link and game together (allPerBy).
const CONF = { perBy: 2, gamePerBy: 8, allPerBy: 8, win: 20, typedMax: 5, needBy: 3, minRounds: 3, fullRounds: 8, byAgeDays: 30, byActs: 3, perDay: 3, linkPerDate: 1, joinWeek: 7, joinRecentDays: 180, seasonMove: 1.0, seasonMoveRating: 25, linkDays: 7, linkLife: 7 * DAY, linkOpen: 30 * DAY, backDays: 30 }; // perBy = by LINK; allPerBy = link + game together (gamePerBy kept as the old name)
const isSelfLogged = (r) => r.src === 'self';
const holeScored = (r) => { const x = r.extra || {}, hs = x.holeScores || x.strokes, n = Number(x.of) === 9 || (!x.of && Number(x.holes) === 9) ? 9 : 18; return Array.isArray(hs) && hs.filter((v) => Number.isFinite(Number(v)) && Number(v) > 0 && v !== null && v !== '').length >= n; };
const refList = (v) => (Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'string' ? x : '')).filter((x) => /^[\w:.-]{6,40}$/.test(x)).slice(0, 8);
// What ONE record says about its own confirmation (before the counting limits): { ok, by: [refs], name, typed, how: 'game' | 'link', why }.
function confInfo(r, meRef) {
  const x = r.extra || {}, golfR = r.kind === 'golf-round', typed = golfR && !holeScored(r), no = (why) => ({ ok: false, by: [], name: '', typed, how: r.src === 'self' ? 'link' : 'game', why, at: 0 }), noon = Date.parse(r.date + 'T18:00:00Z') || 0;
  if (x.confirmed === false) return no(clean(x.unrated, 90) || (x.forfeit ? 'Forfeit: not counted' : 'The game marked this one as not confirmed'));
  if (x.solo) return no('A one-player game is never confirmed');
  if (x.preAcct) return no('Dated before you joined Oddable: counts as played, never confirmed');
  if (r.src === 'self') {
    const cb = x.confirmedBy; if (!cb) return no(x.claimed || x.loggedBy ? 'Kept for you by another player: not confirmed' : 'Not confirmed yet');
    if (!(cb.played === true && typeof cb.ref === 'string' && cb.ref)) return no('Confirmed by someone who is not recorded as playing in it: not counted');
    return { ok: true, by: [cb.ref], name: clean(cb.name, 30) || 'Another player', typed, how: 'link', why: '', at: N(cb.at) || N(x.at) || noon };
  }
  const card = x.card && typeof x.card === 'object' ? x.card : null, legacy = !card && r.kind === 'match' && x.confirmed === true && x.confirmedBy && typeof x.confirmedBy === 'object'; // the events engine's own shape
  if (!card && !legacy) return no('No scored card from another account confirmed by another team');
  const others = card ? Math.round(N(card.others)) : (Array.isArray(x.opp) ? x.opp.filter((o) => o && o.account === true).length : 0);
  if (others < 1) return no('No other account had a scored card in this game');
  if (golfR && typed) return no('No hole-by-hole scores on this round');
  const by = refList(card ? card.by : x.confirmedBy.ref || x.oppKey).filter((b) => b !== meRef); if (!by.length) return no('No account on another team confirmed the card');
  return { ok: true, by, name: clean(card ? card.byName : x.confirmedBy.name, 30) || 'Another player', typed: false, how: 'game', why: '', at: N(card ? card.at : x.confirmedBy.at) > 1.4e12 ? N(card ? card.at : x.confirmedBy.at) : N(x.at) || noon };
}
// WHO A CONFIRMER IS (review 4). A reference on a record ('a:<hash>' from acctRef, or an engine's own key such as the events 'e:<hash>') is looked up in
// the server-only directory 'lock:cref' { r: { <ref>: <account id> } } and turned into ONE identity per account, so the same person is one confirmer
// whether they confirmed in an event or through a link. acctRef(accountId) files the account's own reference; an engine that uses another key calls
// stats.linkRef(key, accountId). A reference with no account on file cannot be checked and never counts.
const REFS = new Map(), CREF = 'lock:cref'; let CREFC = { at: 0, v: {} };
function refNote(ref, e) {
  const k = String(e || ''); if (!ref || !k || /^guest:/.test(k) || REFS.get(ref) === k) return Promise.resolve();
  REFS.set(ref, k); if (REFS.size > 20000) REFS.delete(REFS.keys().next().value);
  return rowMutate(CREF, () => ({ r: {} }), (d) => { d.r = d.r || {}; if (d.r[ref] === k) return { nochange: true }; d.r[ref] = k; return {}; }).catch(() => {});
}
async function refAcct(ref) {
  if (REFS.has(ref)) return REFS.get(ref);
  if (D.now() - CREFC.at > 30e3 || CREFC.at > D.now()) { const r = await D.S.dbGet(CREF).catch(() => null); CREFC = { at: D.now(), v: (r && r.data && r.data.r) || {} }; }
  return CREFC.v[ref] || null;
}
// An engine's own opponent / confirmer key -> the account behind it (events: stats.linkRef(extra.oppKey, accountId) for a singles opponent).
async function linkRef(ref, accountId) {
  const r = String(ref || ''), e = String(accountId || ''); if (!/^[\w:.-]{6,40}$/.test(r) || !e || /^guest:/.test(e)) return false;
  if (/^a:/.test(r) && r !== oppKeyFor(mkOf(e))) return false; // an account reference always belongs to its own account
  await refNote(r, e); return true;
}
// A game that counts as the confirmer's own activity: a round or match SCORED IN AN ODDABLE GAME (an engine record, not a one-player game, not self-logged).
const gameScored = (r) => (r.src === 'golf' || r.src === 'events') && (r.kind === 'golf-round' || r.kind === 'match') && !(r.extra && (r.extra.solo || r.extra.confirmed === false));
// Review 5, H3: a confirmer's OWN play counts only as a FINISHED game (a complete 9 or 18 holes scored hole by hole, or a match with a final result)
// that was itself confirmed by ANOTHER account. A one-hole golf day with typed-in guests, or a game nobody else confirmed, is not their own play.
const finished = (r) => (r.kind === 'golf-round' ? complete(r) && holeScored(r) : !!r.result && !running(r));
const ownPlay = (r, ownRef) => gameScored(r) && finished(r) && confInfo(r, ownRef).ok;
const BYC = new Map();
// Everything the rule needs to know about the confirmers of a set of records: Map(ref -> { key (one per account), name, since (ms), acts }).
async function confCtx(recs, meRef, now) {
  const t = now || D.now(), refs = new Set(), by = new Map(), keys = new Map(), VO = await vouchRow();
  (recs || []).forEach((r) => { if (r.kind !== 'golf-round' && !(r.kind === 'match' && r.sport !== 'golf')) return; const c = confInfo(r, meRef); if (c.ok) c.by.forEach((b) => refs.add(b)); });
  for (const ref of [...refs].slice(0, 80)) {
    try {
      if (typeof D.confirmer === 'function') { const v = await D.confirmer(ref); if (v) { by.set(ref, v); keys.set(v.key, v); } continue; } // TEST SWITCH (like D.auto): the older suites treat every confirmer as an established account. Never set in the app.
      const e = await refAcct(ref); if (!e) continue;
      let c = BYC.get(e); if (!c || t - c.at > 60e3 || c.at > t) {
        const si = await sinceOf(e, t), v = await cached(e), own = oppKeyFor(mkOf(e));
        c = { at: t, v: { key: own, name: (await nameOf(e).catch(() => '')) || '', since: si.known ? si.t : null, sinceKnown: si.known, acts: v.recs.filter((r) => ownPlay(r, own)).length, vouched: vouchedBy(VO, mkOf(e)) } }; BYC.set(e, c); if (BYC.size > 2000) BYC.delete(BYC.keys().next().value);
      }
      by.set(ref, c.v); keys.set(c.v.key, c.v);
    } catch (er) { /* a confirmer that cannot be read does not count */ }
  }
  return { by, keys, now: t };
}
// One confirmer of one record, at the time it confirmed -> { ok, key, known, name, why }.
function byCheck(ctx, ref, at, name) {
  const c = ctx && ctx.by && ctx.by.get(ref), nm = (c && c.name) || name || 'The confirmer';
  if (!c) return { ok: false, known: false, key: ref, name: name || '', why: 'confirmer not checked: ' + nm + ' has no Oddable account on file for this confirmation' };
  const vouched = c.vouched && c.vouched.length; // review 5 (E): a member a club director vouched for counts whatever the account's age
  if (!vouched && c.since == null) return { ok: false, known: true, key: c.key, name: nm, why: 'confirmer not checked: ' + nm + '\'s join date is not on file yet' };
  if (!vouched && at - c.since < CONF.byAgeDays * DAY) return { ok: false, known: true, key: c.key, name: nm, why: 'confirmer too new: ' + nm + ' joined Oddable less than ' + CONF.byAgeDays + ' days before confirming' };
  if (c.acts < CONF.byActs) return { ok: false, known: true, key: c.key, name: nm, why: 'confirmer too new: ' + nm + ' has fewer than ' + CONF.byActs + ' rounds or matches scored in Oddable games (finished, confirmed by another account)' };
  return { ok: true, known: true, key: c.key, name: nm, why: '' };
}
const entryOf = (r) => N(r.extra && r.extra.at) || Date.parse(r.date + 'T18:00:00Z') || 0;
// THE COUNTING SET (review 4, H1 + H3), worked out over ONE family of a player's records (their own golf rounds, or their matches in one game).
// -> Map(record id -> { cand, confirmed, by (one key per account, server only), name, typed, how, why, recBy, date, at }).
//   1. confInfo: what the record says. 2. byCheck: the confirmer was old enough and active enough (else "recorded, not counted").
//   3. golf rounds logged by hand: the first 3 logged on one day, and one link-confirmed round per date played.
//   4. the per-confirmer limits, walked from the NEWEST entry back over the entries that COUNT: among any 20 counting entries in a row one confirmer has
//      at most 2 by link and 8 in all (golf), and at most 5 are typed totals. An entry that does not count never takes a place, so filler entries
//      cannot push good rounds out, and a newer round from the same confirmer takes the place of their older one (nothing freezes).
function confirmMarks(list, meRef, ctx) {
  const out = new Map(), sorted = list.slice().sort(order), cands = [];
  sorted.forEach((r) => {
    const c = confInfo(r, meRef), m = { cand: c.ok, confirmed: false, by: null, name: c.name, typed: c.typed, how: c.how, why: c.why, recBy: null, date: r.date, at: c.at || 0, ent: entryOf(r) };
    out.set(r.id, m); if (!c.ok) return;
    const chk = c.by.map((b) => byCheck(ctx, b, c.at, c.name)).filter((k) => k.key !== meRef), good = chk.filter((k) => k.ok), first = chk.find((k) => k.known) || chk[0];
    if (!first) { m.cand = false; m.why = 'No account on another team confirmed the card'; return; }
    m.recBy = first.key; if (first.known) m.name = first.name;
    if (!good.length) { m.why = 'Recorded, not counted (' + first.why + ')'; return; }
    m.keys = [...new Set(good.map((k) => k.key))]; m.names = {}; good.forEach((k) => { m.names[k.key] = k.name; }); cands.push({ r, m });
  });
  const late = new Set(), dup = new Set(), perDay = {}, perDate = {};
  sorted.filter((r) => r.kind === 'golf-round' && isSelfLogged(r)).sort((a, b) => entryOf(a) - entryOf(b) || order(a, b)).forEach((r) => { const d = chiDay(entryOf(r)); perDay[d] = (perDay[d] || 0) + 1; if (perDay[d] > CONF.perDay) late.add(r.id); });
  cands.filter((x) => x.r.kind === 'golf-round' && x.m.how === 'link' && !late.has(x.r.id)).sort((a, b) => entryOf(a.r) - entryOf(b.r) || order(a.r, b.r)).forEach((x) => { perDate[x.r.date] = (perDate[x.r.date] || 0) + 1; if (perDate[x.r.date] > CONF.linkPerDate) dup.add(x.r.id); });
  const win = []; // the counting entries newer than the one being looked at (the 19 nearest)
  cands.slice().reverse().forEach(({ r, m }) => {
    const golfR = r.kind === 'golf-round', link = m.how === 'link', cnt = (k, how) => win.filter((w) => w.by === k && (!how || w.how === how)).length;
    if (late.has(r.id)) { m.why = 'Not counted: only the first ' + CONF.perDay + ' rounds logged on one day count toward the money-game number'; return; }
    if (dup.has(r.id)) { m.why = 'Not counted: only one link-confirmed round counts per day played'; return; }
    const key = m.keys.find((k) => (!link || cnt(k, 'link') < CONF.perBy) && (!golfR || cnt(k) < CONF.allPerBy));
    if (!key) { const k0 = m.keys[0], nm = m.names[k0] || m.name; m.name = nm; m.why = link && cnt(k0, 'link') >= CONF.perBy ? 'Not counted: ' + nm + ' already confirmed ' + CONF.perBy + ' of your last ' + CONF.win + ' counting ' + (golfR ? 'rounds' : 'games') + ' by link' : 'Not counted: ' + nm + ' already confirmed ' + CONF.allPerBy + ' of your last ' + CONF.win + ' counting rounds'; return; }
    if (m.typed && win.filter((w) => w.typed).length >= CONF.typedMax) { m.why = 'Not counted: only ' + CONF.typedMax + ' typed totals count in any ' + CONF.win + ' confirmed rounds'; return; }
    m.confirmed = true; m.by = key; m.name = m.names[key] || m.name; win.push({ by: key, typed: m.typed, how: m.how }); if (win.length > CONF.win - 1) win.shift();
  });
  return out;
}
// One record on its own (no counting limits): could it count as confirmed? Exported for the engines and the old callers.
const isConfirmed = (r) => confInfo(r).ok;
const hasRating = (r) => !!(r.extra && Number.isFinite(crOf(r.extra)) && Number.isFinite(slopeOf(r.extra)));
// The make-up of a number (manager rule: the organizer of a money game sees it before approving the game; the player sees the same on My handicap / My rating).
// items = the counting entries, newest first: [{ date, what, score?, diff?, used?, meta: {by, name, typed, how} }]. Refs never leave: names and counts only.
// REVIEW 4: `who` lists EVERY confirmer of the recent entries, counting or not, each with when they joined, how many they confirmed and the flags an
// organizer should see ("joined this week", "confirmed 14 of 20", "does not count: ..."); `flags` / `warn` say what is odd about the whole number
// ("all rounds on one date", "all logged on one day"). marks = the family's confirmMarks (for the recorded-but-not-counting confirmations).
function makeupOf(items, unit, ctx, marks) {
  const U = unit || 'round', now = (ctx && ctx.now) || D.now(), info = (k) => (ctx && ctx.keys && ctx.keys.get(k)) || null, byRef = new Map();
  const seat = (k, name) => { let e = byRef.get(k); if (!e) { const c = info(k); e = { name: (c && c.name) || name || 'Another player', n: 0, recorded: 0, since: c ? c.since : null, acct: !!c, acts: c ? c.acts : null, vouched: (c && c.vouched) || [], why: '' }; byRef.set(k, e); } return e; };
  items.forEach((d) => { const m = d.meta || {}; if (m.by) seat(m.by, m.name).n++; });
  const recent = marks ? [...marks.values()].filter((m) => m.cand && m.recBy).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.ent - a.ent)).slice(0, CONF.win) : [];
  recent.forEach((m) => { const e = seat(m.by || m.recBy, m.name); e.recorded++; if (!m.confirmed && m.why && (!e.why || (/^Recorded, not counted \(/.test(m.why) && !e.tooNew))) { e.tooNew = /^Recorded, not counted \(/.test(m.why); e.why = m.why.replace(/^Recorded, not counted \(/, '').replace(/\)$/, '').replace(/^Not counted: /, ''); } });
  const scored = items.filter((d) => d.meta && d.meta.how === 'game').length, typed = items.filter((d) => d.meta && d.meta.typed).length, linked = items.length - scored - typed;
  const counting = [...byRef.values()].filter((e) => e.n > 0), nby = counting.length, tot = Math.max(recent.length, items.length);
  const parts = []; if (scored) parts.push(scored + ' scored in games'); if (linked) parts.push(linked + ' confirmed by link'); if (typed) parts.push(typed + ' typed total' + (typed === 1 ? '' : 's') + ' confirmed by link');
  const who = [...byRef.values()].sort((a, b) => b.n - a.n || b.recorded - a.recorded).map((e) => {
    const days = e.since == null ? null : Math.floor((now - e.since) / DAY), flags = [], rec = Math.max(e.recorded, e.n);
    if (days != null && days < 1) flags.push('joined today'); else if (days != null && days < 7) flags.push('joined this week'); else if (days != null && days < CONF.byAgeDays) flags.push('joined less than ' + CONF.byAgeDays + ' days ago');
    if (e.acts != null && e.acts < CONF.byActs) flags.push('fewer than ' + CONF.byActs + ' rounds or matches of their own scored in games');
    if (tot >= 4 && rec * 2 >= tot) flags.push('confirmed ' + rec + ' of ' + tot);
    if (!e.acct) flags.push('no Oddable account on file'); else if (e.since == null) flags.push('join date not on file yet');
    if (e.vouched.length) flags.push('vouched by ' + e.vouched.join(', '));
    return { name: e.name, n: e.n, recorded: rec, of: tot, joined: e.since == null ? null : chiDay(e.since), since: e.since, vouched: e.vouched, counts: e.n > 0, why: e.n > 0 ? '' : e.why || 'none of their confirmations count', flags };
  });
  // Review 5 (F): 3 or more confirmers who joined within a week of each other (and recently: within CONF.joinRecentDays) is worth a look.
  const js = who.filter((w) => w.since != null && now - w.since < CONF.joinRecentDays * DAY).map((w) => w.since).sort((a, b) => a - b); let near = 0;
  for (let i = 0; i < js.length; i++) { let j = i; while (j + 1 < js.length && js[j + 1] - js[i] <= CONF.joinWeek * DAY) j++; near = Math.max(near, j - i + 1); }
  who.forEach((w) => { delete w.since; });
  const flags = [], dates = new Set((items.length ? items : recent).map((d) => d.date)), entDays = new Set(recent.map((m) => chiDay(m.ent)));
  if ((items.length || recent.length) >= 2 && dates.size === 1) flags.push('all ' + U + 's on one date');
  if (recent.length >= 2 && entDays.size === 1 && recent.some((m) => m.how === 'link')) flags.push('all logged on one day');
  if (near >= 3) flags.push(near + ' confirmers joined within a week of each other');
  who.forEach((w) => w.flags.forEach((f) => { if (/^joined|^confirmed|^no Oddable|^join date/.test(f)) flags.push(w.name + ': ' + f); }));
  return { n: items.length, scored, linked, typed, confirmers: nby, need: CONF.needBy, ok: nby >= CONF.needBy, full: CONF.fullRounds, who, flags, warn: flags.length ? 'Check before approving: ' + flags.join('; ') + '.' : '',
    why: nby >= CONF.needBy ? '' : 'needs ' + U + 's confirmed by ' + CONF.needBy + ' different players',
    text: items.length ? parts.join(', ') + ' · confirmed by ' + nby + ' player' + (nby === 1 ? '' : 's') : 'no confirmed ' + U + 's yet',
    rounds: items.map((d) => ({ date: d.date, what: d.what || '', score: d.score != null ? d.score : null, diff: d.diff != null ? d.diff : null, used: !!d.used, how: d.meta && d.meta.how === 'game' ? 'Scored in a game' : d.meta && d.meta.typed ? 'Typed total, confirmed by link' : 'Hole by hole, confirmed by link', typed: !!(d.meta && d.meta.typed), byName: (d.meta && d.meta.name) || '' })) };
}
// THE SUGGESTED NUMBER (review 5, manager B). Nothing is used automatically in a money game any more: the organizer approves every number. What he is
// offered: the CONFIRMED index / rating when the confirmed rule is met (3 or more counting confirmed entries from 3 or more different confirmers, after
// the age, activity and per-confirmer checks), else the full Oddable number marked "unconfirmed". -> { value, confirmed, label, why }
function suggestOf(confVal, n, mk, unit, soFar, full) {
  const U = unit || 'round', met = confVal != null && n >= CONF.minRounds && mk.ok;
  if (met) return { value: confVal, confirmed: true, label: 'confirmed', why: '' };
  return { value: full == null ? null : full, confirmed: false, label: 'unconfirmed', why: confVal == null || n < CONF.minRounds ? 'needs ' + CONF.minRounds + ' confirmed ' + U + 's (' + soFar + ' so far)' : mk.why };
}
// THE handicap calculation (one copy of the maths: ratings.js handicapSet). Used by /stats/me, handicapFor, the course view, guests and pairingProfile alike.
// ctx = confCtx(recs, meRef): who the confirmers are. Without it no confirmer can be checked, so nothing counts as confirmed (the safe direction).
function golfHcp(recs, meRef, ctx) { // own, complete 9- or 18-hole rounds with Course Rating + Slope
  const own = recs.filter((r) => ownRound(r) && hasRating(r)), marks = confirmMarks(own, meRef, ctx);
  const rounds = own
    .map((r) => { const x = r.extra, n = holesOf(r), pars = Array.isArray(x.pars) ? x.pars : null, mk0 = marks.get(r.id); return { id: r.id, date: r.date, at: x.at, holes: n, total: r.score, cr: crOf(x), slope: slopeOf(x), par: Number(x.par) || (pars && pars.length === n ? pars.reduce((a, b) => a + b, 0) : r.toPar != null ? r.score - r.toPar : n === 9 ? 36 : 72), strokes: x.strokes || x.holeScores, pars, si: x.si || x.hcpIdx, course: clean(x.course, 40), tees: clean(x.tees, 20), confirmed: mk0.confirmed, self: isSelfLogged(r), meta: { by: mk0.by, name: mk0.confirmed ? mk0.name : '', typed: mk0.typed, how: mk0.how, why: mk0.confirmed ? '' : mk0.why } }; });
  const h = R.handicapSet(rounds); h.label = HCP_LABEL; h.method = HCP_METHOD; h.official = false;
  // The make-up of the money-game number + the diversity rule. Confirmer refs stay here: only names, join dates and counts go out.
  h.makeup = makeupOf(h.confirmedDiffs.map((d) => ({ date: d.date, what: (d.course || 'Round') + (d.nHoles === 9 ? ' (9 holes)' : ''), score: d.total, diff: d.eff, used: d.used, meta: d.meta })), 'round', ctx, marks);
  h.suggested = suggestOf(h.confirmedIndex, h.makeup.n, h.makeup, 'round', h.confirmedRounds, h.index);
  h.moneyIndex = h.suggested.confirmed ? h.suggested.value : null; // the CONFIRMED number (flights by confirmed handicap); null = only the unconfirmed full index to suggest
  h.moneyWhy = h.suggested.why; h.makeup.suggested = h.suggested.value; h.makeup.confirmed = h.suggested.confirmed;
  const strip = (d) => { if (d.meta) { d.meta = { name: d.meta.name, typed: d.meta.typed, how: d.meta.how, why: d.meta.why }; } return d; }; h.diffs.forEach(strip); delete h.confirmedDiffs;
  h.conf = {}; marks.forEach((m, id) => { h.conf[id] = { confirmed: m.confirmed, name: m.confirmed || m.recBy ? m.name : '', typed: m.typed, how: m.how, why: m.confirmed ? '' : m.why }; }); // per round, for the notes on each record
  h.missing = recs.filter((r) => ownRound(r) && !hasRating(r)).length; // rounds without rating/slope cannot count (each one says so: hcpNote)
  h.nine = rounds.filter((r) => r.holes === 9).length; h.team = recs.filter((r) => r.kind === 'golf-round' && teamFmt(r)).length;
  const diffTitle = {}; recs.forEach((r) => { diffTitle[r.id] = r.title; }); h.diffs.forEach((d) => { d.title = diffTitle[d.id] || ''; });
  return h;
}
// Why a golf round does or does not count toward the handicap, said on the round itself.
function hcpNote(r, h) {
  if (r.kind !== 'golf-round' || (r.extra && r.extra.side)) return null;
  if (teamFmt(r)) return 'Team score: counts as played, not toward your handicap.'; if (!complete(r)) return 'Not finished: does not count toward your handicap.';
  if (r.score == null) return null; if (!hasRating(r)) return 'Does not count toward your handicap: no Course Rating and Slope on this round.';
  const nine = holesOf(r) === 9, cm = h && h.conf && h.conf[r.id]; if (h && h.diffs.some((d) => d.id === r.id)) return (nine ? '9-hole round: counts toward your handicap with an expected score for the other nine (an estimate of the official method).' : 'Counts toward your handicap.') + (cm && cm.confirmed ? '' : ' ' + ((cm && cm.why) || 'Not confirmed yet') + '.');
  return nine && h && h.waiting9 && h.index == null ? '9-hole round: it will count once 54 holes are posted.' : 'Older than your last 20 rounds.';
}
const ELOSRC = (r) => r.kind === 'match' && r.sport !== 'golf' && (r.src === 'self' || r.src === 'events') && r.result; // golf heads-up matches use the handicap, not Elo
// ONE RATING PER NAMED SPORT (review 3): pickleball, tennis ... each have their own; a game logged under "Other" is rated under its own name, so cornhole
// and darts never share a rating. Key: the sport, or 'other:<name>' ('other:cornhole'). The name comes from the engine (extra.game) or from what the
// player typed in "What did you play?" (extra.ttl); an unnamed "other" game stays under 'other'.
const gameSlug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-').slice(0, 24);
const rateKey = (r) => { if (r.sport !== 'other') return r.sport; const x = r.extra || {}, g = gameSlug(x.game || x.ttl); return g ? 'other:' + g : 'other'; };
const rateName = (key, recs) => { if (!/^other:/.test(key)) return SPORTN[key] || key; const r = (recs || []).find((x) => rateKey(x) === key), x = (r && r.extra) || {}; return clean(x.game || x.ttl, 30) || key.slice(6); };
const normSport = (sport) => { const v = String(sport == null ? 'pickleball' : sport).toLowerCase().trim(); if (v === 'golf') throw bad(400, 'Golf has no rating: use handicapFor'); if (SPORTS.includes(v)) return v; const g = gameSlug(v.replace(/^other:/, '')); if (!g) throw bad(400, 'Unknown sport'); return 'other:' + g; };
// THE rating calculation (ratings.js eloSet): the full Oddable rating plus the rating from confirmed games only (the one used for seeding).
function eloAll(recs, meRef, ctx) {
  const by = {}; recs.filter(ELOSRC).forEach((r) => { const k = rateKey(r); (by[k] = by[k] || []).push(r); }); const o = {};
  Object.keys(by).forEach((k) => {
    const marks = confirmMarks(by[k], meRef, ctx), list = by[k].map((r) => Object.assign({}, r, { confirmed: marks.get(r.id).confirmed, extra: Object.assign({}, r.extra, { confirmed: marks.get(r.id).confirmed }) }));
    const E = Object.assign(R.eloSet(list), { label: RATING_LABEL, key: k, name: rateName(k, by[k]), sport: by[k][0].sport }), cset = new Set((E.confirmedHistory || []).filter((h) => h.w > 0).map((h) => h.id));
    const counted = list.filter((r) => cset.has(r.id)).sort((a, c) => -order(a, c)).slice(0, CONF.win);
    E.makeup = makeupOf(counted.map((r) => ({ date: r.date, what: clean(r.title, 60), used: true, meta: marks.get(r.id) })), 'game', ctx, marks);
    E.suggested = suggestOf(E.confirmedGames ? E.confirmedRating : null, E.makeup.n, E.makeup, 'game', E.makeup.n, E.rating != null ? E.rating : R.ELO.start);
    E.seedRating = E.suggested.confirmed ? E.suggested.value : null; E.seedWhy = E.seedRating != null ? '' : E.confirmedGames ? E.suggested.why : 'no confirmed games yet'; if (!E.confirmedGames) E.suggested.why = 'no confirmed games yet'; E.makeup.suggested = E.suggested.value; E.makeup.confirmed = E.suggested.confirmed;
    E.conf = {}; marks.forEach((m, id) => { E.conf[id] = { confirmed: m.confirmed, name: m.confirmed || m.recBy ? m.name : '', how: m.how, why: m.confirmed ? '' : m.why }; }); delete E.confirmedHistory;
    o[k] = E;
  });
  return o;
}
function periods(recs, today) { const o = {}, from = {}; PERIODS.forEach((p) => { const f = periodFrom(p, today); from[p] = f; o[p] = tree(recs.filter((r) => !f || r.date >= f)); }); return { periods: o, from }; }
// What another person may see of someone's lifetime stats: totals only. No titles, ids, open counts or dated best/worst bets (nothing that could reveal a pick).
function publicTree(t) {
  const strip = (n) => { if (!n) return n; const x = clone(n); if (x.tot) { x.tot.best = x.tot.best ? { pl: x.tot.best.pl } : null; x.tot.worst = x.tot.worst ? { pl: x.tot.worst.pl } : null; x.tot.open = 0; x.tot.n = x.tot.w + x.tot.l + x.tot.p + x.tot.t + (x.tot.fin || 0) + (x.tot.solo || 0); }
    if (x.calcutta && x.calcutta.best) x.calcutta.best = { net: x.calcutta.best.net }; if (x.golf) { if (x.golf.best) x.golf.best = { score: x.golf.best.score, toPar: x.golf.best.toPar }; if (x.golf.trend) x.golf.trend.pts = []; } return x; };
  const o = strip(t); ['bySport', 'byKind'].forEach((b) => { Object.keys(t[b] || {}).forEach((k) => { o[b][k] = strip(t[b][k]); if (t[b][k].byKind) Object.keys(t[b][k].byKind).forEach((j) => { o[b][k].byKind[j] = strip(t[b][k].byKind[j]); }); }); });
  return o;
}

// ---------- identity ----------
const mkOf = (e) => sha('oddable-group|' + e).slice(0, 24); // same as groups.js (member key)
const selfKey = (e) => 'lock:self:' + sha('oddable-self|' + e).slice(0, 32);
const IDS = { at: 0, map: null };
async function sidOf(e) { // a phone account's synced bets row id (sha256 of the phone). Server only.
  if (!/@phone\.oddable$/.test(String(e))) return null; const A = D.acct();
  for (let i = 0; i < 2; i++) {
    if (!IDS.map || D.now() - IDS.at > 10 * 6e4 || i) { const m = {}; (await D.S.dbIds()).forEach((id) => { m[A.phoneEmail(id)] = id; }); IDS.map = m; IDS.at = D.now(); }
    if (IDS.map[e]) return IDS.map[e];
  }
  return null;
}

// ---------- provider: My Bets (synced bets) ----------
const NFLAB = new Set(['BUF', 'MIA', 'NE', 'NYJ', 'BAL', 'CIN', 'CLE', 'PIT', 'HOU', 'IND', 'JAX', 'TEN', 'DEN', 'KC', 'LV', 'LAC', 'DAL', 'NYG', 'PHI', 'WSH', 'WAS', 'CHI', 'DET', 'GB', 'MIN', 'ATL', 'CAR', 'NO', 'TB', 'ARI', 'LAR', 'LA', 'SF', 'SEA']);
// Port of the app's v213 bSport1 (index.html): lg first; Kalshi ticker; else NFL if either team abbreviation is an NFL team, else college football; no teams = other.
// Same CAVEAT as the app: a college team whose abbreviation equals an NFL one (MIA) counts as NFL unless the bet has lg.
function sport1(o, kt) {
  const lg = String(o.lg || '').toLowerCase(); if (lg === 'cfb' || lg === 'ncaa') return 'cfb'; if (['nfl', 'nba', 'wnba', 'mlb', 'nhl', 'ncaab'].includes(lg)) return lg;
  if (kt) { const t = String(kt).toUpperCase(); if (/NCAAF|CFB/.test(t)) return 'cfb'; if (/WNBA/.test(t)) return 'wnba'; if (/NCAAB|NCAAMB/.test(t)) return 'ncaab'; if (/NFL/.test(t)) return 'nfl'; if (/NBA/.test(t)) return 'nba'; if (/MLB/.test(t)) return 'mlb'; if (/NHL/.test(t)) return 'nhl'; }
  if (o.home || o.away) return NFLAB.has(o.home) || NFLAB.has(o.away) ? 'nfl' : 'cfb';
  return '?';
}
function betSport(b) { // one sport per record: a parlay whose known legs share one sport gets it; mixed or unknown legs = other (extra.sports lists them)
  if (b.kind === 'parlay') {
    if (b.kt) { const k = sport1({}, b.kt); if (k !== '?') return { s: k }; }
    const S = [...new Set((Array.isArray(b.legs) ? b.legs : []).map((l) => sport1(l || {}, l && l.kt)).filter((x) => x !== '?'))];
    return S.length === 1 ? { s: S[0] } : { s: 'other', all: S };
  }
  const s = sport1(b, b.kt); return { s: s === '?' ? 'other' : s };
}
function betResult(b) { // same order as the app and groups.js: Kalshi sale > remembered final > prop result
  if (b.cash !== undefined && b.cash !== null && N(b.stake)) return b.cash > N(b.stake) + 0.005 ? 'W' : b.cash < N(b.stake) - 0.005 ? 'L' : 'P';
  if (b.fin === 'won') return 'W'; if (b.fin === 'lost') return 'L'; if (b.fin === 'push') return 'P';
  if (b.kind === 'prop' && /^(won|lost|push|void)$/.test(String(b.res || ''))) return { won: 'W', lost: 'L', push: 'P', void: 'P' }[b.res];
  return null;
}
// D7 / S-ALL: actual prices only. A bet with no stored P/L and no usable price (American odds of at least 100 either way, or a parlay multiplier) has NO
// known winnings: null, never an assumed -110.
const profitMult = (b) => { if (N(b.mult) > 1) return N(b.mult) - 1; const o = N(b.odds); if (Math.abs(o) < 100) return null; return o > 0 ? o / 100 : 100 / -o; };
function betPL(b, r) { // the P/L the app itself stored (finPL) wins, like the owner dashboard; a Kalshi sale is proceeds minus cost
  const st = N(b.stake);
  if (b.cash !== undefined && b.cash !== null && st) return r2(N(b.cash) - st);
  if (b.fin && b.finPL !== null && b.finPL !== '' && Number.isFinite(Number(b.finPL))) return Number(b.finPL);
  if (r === 'W') { const pm = profitMult(b); return pm == null ? null : st * pm; } return r === 'L' ? -st : 0;
}
const createdAt = (b) => { const m = /^b(\d{12,14})$/.exec(String(b.id || '')); return m ? +m[1] : null; };
const betLabel = (b) => clean(String(b.text || (b.kind === 'parlay' ? (Array.isArray(b.legs) ? b.legs.length : 0) + '-leg parlay' : (b.side || '?') + ' ' + (b.type === 'ou' || b.type === 'tot' ? (b.line != null ? b.line : '') : b.line ? (b.line > 0 ? '+' : '') + b.line : 'ML') + (b.away && b.home ? ' (' + b.away + '@' + b.home + ')' : ''))), 90);
const betType = (b) => (b.kind === 'parlay' ? 'parlay' : b.kind === 'prop' ? 'prop' : b.type === 'sp' ? 'sp' : b.type === 'ou' || b.type === 'tot' ? 'ou' : 'ml');
// Records from one synced row. DELETED BETS (HANDOFF, Steve Nov 15: "deleted bets still count"): the same per-day rule as the owner dashboard (sync.js adminUsers):
// for each finished day the frozen daily log wins when it has MORE settled bets than the bets still on the phone (a tie goes to the bets); then one
// adjustment record 'log:<day>' carries the difference (extra.adj = {w, l, p}, pl, stake), so lifetime totals equal the owner dashboard's.
function betRecords(data) {
  const d = data || {}, bets = Array.isArray(d.bets) ? d.bets : [], log = d.log || {}, out = [], perDay = {};
  bets.forEach((b) => {
    if (!b || b.id == null || !(N(b.stake) || b.text || b.side || b.kind === 'parlay')) return;
    const day0 = String(b.day || '').slice(0, 10), leg0 = Array.isArray(b.legs) && b.legs[0] ? String(b.legs[0].day || '').slice(0, 10) : '', at = createdAt(b) || N(b.t);
    const date = okDay(day0) ? day0 : okDay(leg0) ? leg0 : at > 0 ? chiDay(at) : ''; if (!date) return;
    const res = betResult(b), sp = betSport(b), st = N(b.stake);
    const rec = { src: 'bets', id: 'b:' + String(b.id).slice(0, 60), date, sport: sp.s, kind: 'bet', title: betLabel(b) || 'Bet', result: res, verified: b.src === 'kalshi' && !!b.kt, extra: { type: betType(b), at } };
    if (st) rec.stake = r2(st);
    if (res) { const pl = betPL(b, res); if (pl != null) { rec.pl = r2(pl); rec.units = res === 'W' ? r3(st > 0 ? pl / st : profitMult(b) || 0) : res === 'L' ? -1 : 0; } else rec.extra.noPrice = true; } // won with no price and no stored P/L: "Net: not known"
    if (Number(b.gl) > 0) rec.extra.group = true; // a group bet (saved and locked by the server, G16): the SAME row the group contest is built from, so its money is counted here, once
    if (sp.all && sp.all.length) rec.extra.sports = sp.all;
    if (b.kind === 'parlay') rec.extra.legs = Array.isArray(b.legs) ? b.legs.length : 0;
    out.push(rec);
    if (okDay(day0)) { const p = perDay[day0] || (perDay[day0] = { w: 0, l: 0, p: 0, pl: 0, stake: 0, sports: new Set() }); p.sports.add(sp.s); if (res) { if (res === 'W') p.w++; else if (res === 'L') p.l++; else p.p++; p.pl += rec.pl || 0; p.stake += st; } }
  });
  Object.keys(log).filter(okDay).forEach((k) => {
    const o = log[k] || {}, lw = N(o.w), ll = N(o.l), lp = N(o.p), ls = lw + ll + lp, p = perDay[k] || { w: 0, l: 0, p: 0, pl: 0, stake: 0, sports: new Set() }, ps = p.w + p.l + p.p;
    if (ps > 0 && ps >= ls) return; // the bets win (tie included)
    const adj = { w: lw - p.w, l: ll - p.l, p: lp - p.p }, pl = r2(N(o.settled) - p.pl);
    if (!adj.w && !adj.l && !adj.p && !pl) return;
    const one = p.sports.size === 1 ? [...p.sports][0] : 'other';
    out.push({ src: 'bets', id: 'log:' + k, date: k, sport: one, kind: 'bet', title: 'Deleted bets (kept from your daily log)', result: null, verified: false, pl, stake: (() => { const st = r2(Math.max(0, N(o.risk) - p.stake)); return st > 0 ? st : undefined; })(), extra: { adj, fromLog: true } }); // no stake left in the log = entry not known (never "$0 entry, -$206 net")
  });
  return out;
}
async function betsProvider(e) { const sid = await sidOf(e); if (!sid) return []; const row = await D.S.dbGet(sid); return row ? betRecords(row.data) : []; }

// ---------- provider: Groups stage 1 contests (one record per group the player is in) ----------
const gSport = (g) => (g.sport === 'ncaa' ? 'cfb' : g.sport === 'nfl' ? 'nfl' : 'other');
async function groupsRow() { const r = await D.S.dbGet('lock:groups'); return (r && r.data && r.data.groups) || {}; }
async function contestRec(g, m, now) {
  const G = D.groups(), st = now >= g.start, ended = g.endDay < chiDay(now);
  const rec = { src: 'groups', id: 'g:' + g.id, date: g.startDay, sport: gSport(g), kind: 'contest', groupId: g.id, contestId: g.id, title: clean(g.name, 60) || 'Group', result: null, verified: !!(g.rules && g.rules.verified), extra: { derived: true, metric: g.rules && g.rules.metric, started: st, ended, endDay: g.endDay, members: g.members.length } };
  if (g.sport === 'both') rec.extra.sports = ['nfl', 'cfb'];
  const entry = N(g.rules && g.rules.entry); if (st && entry > 0) rec.spent = r2(entry); // review 3, L12: a stage-1 contest's own money = its entry and (once it ends) its prize
  if (!st || typeof G.standings !== 'function') return rec;
  const s = await G.standings(g, 'season'), row = s.rows.find((x) => x.pid === m.pid); if (!row) return rec;
  const t = row.t; rec.place = { n: row.place, of: s.rows.length }; rec.stake = r2(N(t.stake)); rec.pl = r2(N(t.win)); rec.units = r3(N(t.units));
  Object.assign(rec.extra, { w: t.w, l: t.l, p: t.p, open: t.open, val: t.val });
  if (ended) { rec.result = row.place === 1 ? 'W' : 'L'; // a finished group: 1st place = a win
    if (entry > 0) { let prize = 0; try { const pz = typeof G.pot === 'function' ? G.pot(g).places : [], tied = s.rows.filter((x) => x.place === row.place).length || 1; let c = 0; for (let i = row.place; i < row.place + tied; i++) { const pp = pz.find((x) => x.place === i); if (pp) c += Math.round(pp.amt * 100); } prize = Math.floor(c / tied) / 100; } catch (er) { prize = null; } if (prize != null) rec.won = r2(prize); } }
  return rec;
}
// Lifetime results survive a group being deleted or a member leaving: every started contest is copied into the player's own row ('hist', keyed by record id)
// whenever it changes; a contest that is no longer in the groups row comes from that copy. (Stage-1 rules already refuse delete/leave after the start.)
// MERGE (Groups coder, Nov 16 2026): when groups.js exports its own statsFor (contests storage format, groups-v1), it is used and this stage-1 adapter is only
// the fallback. Either way contest records are marked extra.derived (they are built from the same My Bets bets, so they never add to a total twice) and
// the history copy below keeps them after a group is deleted or left.
async function groupsProvider(e, opt) {
  const G = D.groups(); let out = [];
  if (G && typeof G.statsFor === 'function') { out = ((await G.statsFor(e, { from: '', to: '' })) || []).slice(0, 200).map((r) => Object.assign({}, r, { extra: Object.assign({}, r.extra, { derived: true, started: true, ended: !(r.extra && r.extra.live) }) })); }
  else { const mk = mkOf(e), gs = await groupsRow(), now = D.now(); for (const g of Object.values(gs)) { const m = (g.members || []).find((x) => x.mk === mk); if (!m) continue; try { out.push(await contestRec(g, m, now)); } catch (er) {} if (out.length >= 60) break; } }
  const row = await selfRow(e), hist = (row && row.data && row.data.hist) || {}, live = new Set(out.map((r) => r.id)), upd = {};
  out.forEach((r) => { if (r.extra && r.extra.started && JSON.stringify(hist[r.id]) !== JSON.stringify(r)) upd[r.id] = r; });
  Object.keys(hist).forEach((id) => { if (!live.has(id)) out.push(Object.assign({}, hist[id], { extra: Object.assign({}, hist[id].extra, { kept: true }) })); });
  if (Object.keys(upd).length) { try { await rowMutate(selfKey(e), () => ({ items: [] }), (d) => { d.hist = Object.assign(d.hist || {}, upd); const ks = Object.keys(d.hist); if (ks.length > 300) ks.slice(0, ks.length - 300).forEach((k) => delete d.hist[k]); return {}; }); } catch (er) {} }
  return out;
}

// ---------- provider: My own stats (logged by hand, verified:false) ----------
async function selfRow(e) { const r = await D.S.dbGet(selfKey(e)); return r || null; }
async function selfProvider(e) { // own entries + results kept for me as a guest player before I had an account (claimed with the claim link)
  const r = await selfRow(e), d = (r && r.data) || {}, out = (d.items || []).filter((x) => !(x.extra && x.extra.guest)).map((x) => Object.assign({}, x, { verified: false, src: 'self' }));
  for (const gid of (d.claimed || []).slice(0, 50)) { try { const g = await D.S.dbGet(GROW(gid)); if (!g || !g.data || g.data.claimedBy !== mkOf(e)) continue; (g.data.items || []).forEach((x) => out.push(Object.assign({}, x, { id: 'c' + gid.slice(0, 6) + x.id, verified: false, src: 'self', extra: Object.assign({}, x.extra, { claimed: true }) }))); } catch (er) {} }
  return out;
}
const ALPH = 'abcdefghjkmnpqrstuvwxyz23456789';
const rnd = (n) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPH[b[i] % ALPH.length]; return s; };
const int = (v, lo, hi, what, opt) => { if (opt && (v == null || v === '')) return null; const x = Number(v); if (!Number.isInteger(x) || x < lo || x > hi) throw bad(400, what); return x; };
const SPORTN = { nfl: 'NFL', cfb: 'College football', nba: 'NBA', wnba: 'WNBA', ncaab: 'College basketball', mlb: 'MLB', nhl: 'NHL', soccer: 'Soccer', golf: 'Golf', pickleball: 'Pickleball', tennis: 'Tennis', racing: 'Racing', horse: 'Horse racing', fight: 'Fighting', other: 'Other' };
// Turns a "Log my play" form into a contract record. Throws 400 with a plain message. guests = the organizer's own guest players {gid: name} (slots may name one).
const numOpt = (v, lo, hi, what, dp) => { if (v == null || v === '') return null; const x = Number(v), m = Math.pow(10, dp || 1); if (!Number.isFinite(x) || x < lo || x > hi) throw bad(400, what); return Math.round(x * m) / m; };
function holeList(arr, n, lo, hi, what) { // optional per-hole numbers: all blank -> null; otherwise every hole filled
  if (!Array.isArray(arr) || !arr.some((x) => x != null && x !== '')) return null; if (arr.length !== n) throw bad(400, what + ': enter all ' + n + ' holes');
  return arr.map((x, i) => int(x, lo, hi, what + ', hole ' + (i + 1) + ': ' + lo + ' to ' + hi));
}
const dayAdd = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
function selfRecord(inp, id, now, guests, since) { // since = the day the account signed up (acctSince, server-stamped). Entries may go back 30 days before it; those are marked and never confirmed.
  const b = inp || {}, today = chiDay(now), date = String(b.date || ''), G = guests || {};
  if (!okDay(date)) throw bad(400, 'Pick a date'); if (date > today) throw bad(400, 'The date cannot be in the future'); if (date < '2000-01-01') throw bad(400, 'That date is too old');
  const first = since ? dayAdd(since, -CONF.backDays) : null;
  if (first && date < first) throw bad(400, 'That date is more than ' + CONF.backDays + ' days before you joined Oddable (' + since + '). The earliest you can log is ' + first + '.');
  const notes = clean(b.notes, 200), at = now, voice = !!b.voice, preAcct = since && date < since ? true : undefined;
  const rec = selfRecord0(b, id, date, G, notes, at, voice); if (preAcct) rec.extra.preAcct = true; return rec;
}
function selfRecord0(b, id, date, G, notes, at, voice) {
  if (b.type === 'golf') {
    const course = clean(b.course, 40); if (course.length < 2) throw bad(400, 'Enter the course');
    const tees = clean(b.tees, 20), holes = Number(b.holes) === 9 ? 9 : Number(b.holes) === 18 || b.holes == null || b.holes === '' ? 18 : null; if (!holes) throw bad(400, 'Holes: 9 or 18');
    const pars = holeList(b.pars, holes, 3, 6, 'Par'), si = holeList(b.si, holes, 1, holes, 'Stroke index');
    if (si && new Set(si).size !== holes) throw bad(400, 'Stroke index: each number 1 to ' + holes + ' once');
    const par = pars ? pars.reduce((x, y) => x + y, 0) : int(b.par == null || b.par === '' ? (holes === 18 ? 72 : 36) : b.par, holes === 18 ? 54 : 27, holes === 18 ? 80 : 40, 'Par must be ' + (holes === 18 ? '54 to 80' : '27 to 40'));
    const cr = numOpt(b.cr, holes === 18 ? 55 : 27.5, holes === 18 ? 85 : 42.5, 'Course Rating looks wrong (' + (holes === 18 ? '55 to 85' : '27.5 to 42.5 for 9 holes') + ')'), slope = b.slope == null || b.slope === '' ? null : int(b.slope, 55, 155, 'Slope Rating must be 55 to 155');
    if ((cr == null) !== (slope == null)) throw bad(400, 'Enter both Course Rating and Slope Rating (or neither)');
    let strokes = null, sum = 0, all = true;
    if (Array.isArray(b.strokes) && b.strokes.some((x) => x != null && x !== '')) {
      if (b.strokes.length !== holes) throw bad(400, 'Enter ' + holes + ' holes'); strokes = b.strokes.map((x, i) => { const v = int(x, 1, 20, 'Hole ' + (i + 1) + ': 1 to 20 strokes', true); if (v == null) all = false; else sum += v; return v; });
    } else all = false;
    let total = int(b.total, holes === 18 ? 40 : 20, holes === 18 ? 200 : 100, 'Total score must be ' + (holes === 18 ? '40 to 200' : '20 to 100'), all);
    if (all) { if (total != null && total !== sum) throw bad(400, 'The total (' + total + ') does not match the holes (' + sum + ')'); total = sum; }
    if (total == null) throw bad(400, 'Enter the total score');
    if (cr != null && total < cr - (holes === 18 ? 15 : 7.5)) throw bad(400, 'That score is more than ' + (holes === 18 ? 15 : 7.5) + ' under the Course Rating (' + cr + '). Check the score and the Rating.');
    const putts = int(b.putts, 0, holes * 6, 'Putts: 0 to ' + holes * 6, true), fw = int(b.fw, 0, 18, 'Fairways hit: 0 to 18', true), fwOf = int(b.fwOf, 0, 18, 'Fairways: 0 to 18', true), gir = int(b.gir, 0, holes, 'Greens in regulation: 0 to ' + holes, true);
    if (fw != null && fwOf != null && fw > fwOf) throw bad(400, 'Fairways hit cannot be more than fairways');
    const format = ['individual', 'scramble', 'bestball'].includes(b.format) ? b.format : 'individual', team = format !== 'individual' ? clean(b.team, 30) : '', mates = format !== 'individual' ? (Array.isArray(b.mates) ? b.mates : []).map((x) => clean(x, 30)).filter(Boolean).slice(0, 5) : [];
    const yards = int(b.yards, holes === 18 ? 1000 : 500, holes === 18 ? 9000 : 4500, 'Yards: ' + (holes === 18 ? '1,000 to 9,000' : '500 to 4,500'), true);
    const who = b.guest ? String(b.guest) : ''; if (who && !G[who]) throw bad(404, 'That guest player is not on your list');
    // PLAYED WITH (review 3): the people recorded as playing in this round, picked from the logger's own players list. Only one of THEM can confirm it.
    const withGuests = [...new Set((Array.isArray(b.withGuests) ? b.withGuests : []).map((x) => String(x || '')).filter(Boolean))].slice(0, 3); withGuests.forEach((x) => { if (!G[x]) throw bad(404, 'That player is not on your list'); if (x === who) throw bad(400, 'The player whose round this is cannot also be listed as playing with them'); });
    return { src: 'self', id, date, sport: 'golf', kind: 'golf-round', title: (format === 'scramble' ? 'Scramble · ' : format === 'bestball' ? 'Best ball · ' : '') + course + (tees ? ' · ' + tees + ' tees' : ''), result: null, score: total, toPar: total - par, verified: false,
      extra: { type: 'golf', at, course, courseId: okCid(b.courseId) || undefined, tees, holes, par, pars, si, cr, slope, yards: yards != null ? yards : undefined, strokes, putts, fw, fwOf, gir, notes, format, team, mates, guest: who || undefined, withGuests: withGuests.length ? withGuests : undefined, withNames: withGuests.length ? withGuests.map((x) => G[x]) : undefined, voice } };
  }
  if (b.type === 'pickleball') {
    const fmt = b.fmt === 'doubles' ? 'doubles' : b.fmt === 'singles' ? 'singles' : null; if (!fmt) throw bad(400, 'Singles or doubles?');
    const slot = (name, gid, what) => { const g = gid ? String(gid) : ''; if (g && !G[g]) throw bad(404, 'That guest player is not on your list'); return { name: g ? G[g] : clean(name, 30), gid: g || undefined, what }; };
    const partner = fmt === 'doubles' ? slot(b.partner, b.partnerGuest, 'partner') : null;
    const opp = (Array.isArray(b.opp) ? b.opp : []).slice(0, fmt === 'doubles' ? 2 : 1).map((x, i) => slot(x, (Array.isArray(b.oppGuest) ? b.oppGuest : [])[i], 'opp')).filter((x) => x.name);
    if (!opp.length) throw bad(400, 'Enter who you played');
    const games = (Array.isArray(b.games) ? b.games : []).filter((x) => Array.isArray(x) && (x[0] !== '' && x[0] != null) && (x[1] !== '' && x[1] != null)).map((x, i) => { const a = int(x[0], 0, 30, 'Game ' + (i + 1) + ': points 0 to 30'), c = int(x[1], 0, 30, 'Game ' + (i + 1) + ': points 0 to 30'); if (a === c) throw bad(400, 'Game ' + (i + 1) + ' cannot be a tie'); return [a, c]; });
    if (!games.length) throw bad(400, 'Enter at least one game score'); if (games.length > 5) throw bad(400, 'Up to 5 games');
    const gw = games.filter((x) => x[0] > x[1]).length, gl = games.length - gw, event = clean(b.event, 40), opponent = opp.map((x) => x.name).join(' / ');
    return { src: 'self', id, date, sport: 'pickleball', kind: 'match', title: (event || (fmt === 'doubles' ? 'Doubles' : 'Singles')) + ' vs ' + opponent, result: gw > gl ? 'W' : gw < gl ? 'L' : 'T', opponent, verified: false,
      extra: { type: 'pickleball', at, fmt, partner: partner ? partner.name : '', partnerGuest: partner && partner.gid, opp: opp.map((x) => x.name), oppGuest: opp.map((x) => x.gid || null), games, event, notes, scoreText: games.map((x) => x[0] + '-' + x[1]).join(', '), voice } };
  }
  if (b.type === 'other') {
    const sport = String(b.sport || ''); if (!SPORTS.includes(sport)) throw bad(400, 'Pick the sport');
    const solo = b.result === 'solo', result = ['W', 'L', 'T'].includes(b.result) ? b.result : solo ? null : undefined; if (result === undefined) throw bad(400, 'Won, lost, tied, or a one-player game?');
    const og = !solo && b.oppGuest ? String(b.oppGuest) : ''; if (og && !G[og]) throw bad(404, 'That player is not on your list');
    const kind = b.kind === 'event' ? 'event' : 'match', opponent = solo ? '' : og ? G[og] : clean(b.opponent, 40), scoreText = clean(b.score, 30), title = clean(b.title, 40) || SPORTN[sport] + (solo ? ' (solo)' : opponent ? ' vs ' + opponent : '');
    const scoreNum = solo && /^-?\d+(\.\d+)?$/.test(scoreText) ? Number(scoreText) : null;
    const rec = { src: 'self', id, date, sport, kind, title, result, verified: false, extra: { type: 'other', at, scoreText, notes, ttl: clean(b.title, 40), solo, voice } };
    if (opponent) rec.opponent = opponent; if (og) rec.extra.oppGuest = [og]; if (scoreNum != null && Math.abs(scoreNum) < 1e6) rec.score = scoreNum;
    return rec;
  }
  throw bad(400, 'Pick what to log: golf round, pickleball match or other game');
}
// ---------- guest players (people without an account yet: a golf partner, a pickleball opponent typed by the organizer) ----------
// Row 'lock:guest:<gid>' { name, by: organizer member key, th: sha256(claim token), claimedBy: claimant member key | null, items: [records] }.
// The organizer's self row keeps { gid, name, token } so only the organizer can see / resend the claim link. Results attach to an account ONLY through
// the claim link (gid + token, compared in constant time); names are never matched to accounts.
const GROW = (gid) => 'lock:guest:' + gid;
const mirrorOf = (rec, role, orgName) => { // the same match from the guest's side
  const flip = role === 'opp', ex = rec.extra || {}, games = (ex.games || []).map((x) => (flip ? [x[1], x[0]] : x.slice()));
  const res = flip ? (rec.result === 'W' ? 'L' : rec.result === 'L' ? 'W' : rec.result) : rec.result;
  const you = clean(orgName, 30) || 'Organizer', oppNames = flip ? [you].concat(ex.fmt === 'doubles' && ex.partner ? [ex.partner] : []) : ex.opp || [];
  return { src: 'self', id: 'gm' + rec.id, date: rec.date, sport: rec.sport, kind: rec.kind, title: (ex.event || (ex.fmt === 'doubles' ? 'Doubles' : 'Singles')) + ' vs ' + oppNames.join(' / '), result: res, opponent: oppNames.join(' / '), verified: false,
    extra: { type: 'pickleball', at: ex.at, fmt: ex.fmt, opp: oppNames, games, event: ex.event, scoreText: games.map((x) => x[0] + '-' + x[1]).join(', '), loggedBy: you, from: rec.id } };
};
// WRITES ARE QUEUED PER ROW inside this process (a promise chain per row id, the pattern groups-v1 486f127 uses): a burst of saves to one row no longer
// race each other and burn their tries ("Busy, try again"). The conditional write (dbPatchIf on `updated`) stays as the guard against another server
// instance or sync.js writing the same row; a lost race there is simply redone, a few times.
const QUEUE = new Map();
function serial(key, fn) {
  const prev = QUEUE.get(key) || Promise.resolve(), run = prev.then(fn, fn), tail = run.then(() => {}, () => {});
  QUEUE.set(key, tail); tail.then(() => { if (QUEUE.get(key) === tail) QUEUE.delete(key); }); return run;
}
function rowMutate(id, init, fn) { // read, change, write only if nobody else wrote in between
  return serial(id, async () => {
    for (let i = 0; i < 5; i++) {
      let row = await D.S.dbGet(id);
      if (!row) { if (!init) throw bad(404, 'Not found'); await D.S.dbPut({ id, salt: 'x', pinhash: 'x', data: init(), updated: 1 }, true); row = await D.S.dbGet(id); if (!row) continue; }
      const data = clone(row.data || {}), out = fn(data);
      if (out && out.nochange) return out.v;
      if (await D.S.dbPatchIf(id, row.updated, data, Math.max(D.now(), Number(row.updated || 0) + 1))) return out;
    }
    throw bad(409, 'Busy, try again');
  });
}
// Exported for the golf / events engines: give a guest player a result (the engine's organizer must own the guest).
// CLAIMED = FROZEN (review fix 1): once the player has claimed the row it is theirs. The organizer who made the guest can no longer add to it or remove
// from it (that changed the claimant's handicap); only the claimant removes items (claimedRemove).
const FROZEN = 'This player has claimed their results. Only they can change them now.';
async function guestAdd(orgE, gid, rec) { const v = validate(Object.assign({}, rec, { src: 'self', verified: false }), 'self'); if (!v.ok) throw bad(400, 'Bad record (' + v.why + ')'); const mk = mkOf(orgE);
  await rowMutate(GROW(gid), null, (d) => { if (d.by !== mk) throw bad(403, 'Not your guest player'); if (d.claimedBy) throw bad(409, FROZEN); d.items = (d.items || []).filter((x) => x.id !== v.rec.id); if (d.items.length >= 2000) throw bad(400, 'Too many results'); d.items.push(v.rec); return {}; }); CACHE.clear(); return v.rec; }
async function guestRemove(orgE, gid, recId) { const mk = mkOf(orgE); await rowMutate(GROW(gid), null, (d) => { if (d.by !== mk) throw bad(403, 'Not your guest player'); if (d.claimedBy) throw bad(409, FROZEN); const n = (d.items || []).length; d.items = (d.items || []).filter((x) => x.id !== recId); return d.items.length === n ? { nochange: true } : {}; }).catch((er) => { if (er.status !== 404) throw er; }); CACHE.clear(); }
// The claimant removes one claimed item (ids in their stats are 'c' + first 6 of the guest id + the stored id).
async function claimedRemove(e, id, claimed) {
  const mk = mkOf(e); for (const gid of (claimed || []).slice(0, 50)) { const pre = 'c' + gid.slice(0, 6); if (!id.startsWith(pre)) continue; const rid = id.slice(pre.length);
    const hit = await rowMutate(GROW(gid), null, (d) => { if (d.claimedBy !== mk) return { nochange: true, v: false }; const n = (d.items || []).length; d.items = (d.items || []).filter((x) => x.id !== rid); if (d.items.length === n) return { nochange: true, v: false }; d.removed = (d.removed || []).concat({ id: rid, at: D.now() }).slice(-200); return { ok: true }; }).catch(() => false);
    if (hit) { CACHE.delete(e); return true; } }
  return false;
}
function selfMutate(e, fn) { return rowMutate(selfKey(e), () => ({ items: [] }), (d) => { d.items = Array.isArray(d.items) ? d.items : []; return fn(d); }).then((out) => { CACHE.delete(e); return out; }); }

// ---------- MY COURSES (review 4, H2; ONE store for My stats and the golf engine) ----------
// The courses a player picked lately and their home course, kept on the SERVER in the player's own stats row: data.mc = { home: <id> | null, list: [course] }.
// course = { id, name, city, state, tees, rating, slope, par, yards, holes (9 | 18), at, n }   id = the course id saved on a round as extra.courseId
// (an OpenGolfAPI extId, or the golf engine's own course id); tees / rating / slope / par / yards = the tee picked last (rating and slope null = none on file).
// Routes (POST, x-token):  /stats/mycourses {} -> { ok, home: course | null, recent: [course] (newest first, at most 8, the home course first) }
//   /stats/mycourses/use { course }  /stats/mycourses/home { id | null }  /stats/mycourses/remove { id }   -> the same answer.
// Server side (golf engine): stats.myCourses(userKey), stats.myCourseUse(userKey, course), stats.myCourseHome(userKey, id).
const MCMAX = 8;
function mcClean(c) {
  const x = c && typeof c === 'object' ? c : {}, id = okCid(x.id || x.courseId || x.extId), name = clean(x.name || x.course, 60); if (!id || name.length < 2) throw bad(400, 'Pick a course first');
  const t = x.tee && typeof x.tee === 'object' ? x.tee : x, num = (v, lo, hi) => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  const holes = Number(x.holes) === 9 || Number(t.holes) === 9 ? 9 : 18;
  return { id, name, city: clean(x.city, 40), state: clean(x.state, 20), tees: clean(t.name != null && t !== x ? t.name : x.tees, 30), rating: num(t.rating != null ? t.rating : t.cr, 27.5, 85), slope: num(t.slope, 55, 155), par: num(t.par, 27, 80), yards: num(t.yards, 500, 9000), holes };
}
function mcOut(sd) { const mc = (sd && sd.mc) || {}, list = (Array.isArray(mc.list) ? mc.list : []).slice().sort((a, b) => N(b.at) - N(a.at)), home = list.find((c) => c.id === mc.home) || null; return { home, recent: (home ? [home] : []).concat(list.filter((c) => c !== home)).slice(0, MCMAX).map((c) => Object.assign({}, c, { home: !!home && c.id === home.id })) }; }
async function myCourses(e) { const r = await selfRow(e); return Object.assign({ ok: true }, mcOut((r && r.data) || {})); }
async function myCourseUse(e, course) { const c = mcClean(course), now = D.now();
  return Object.assign({ ok: true }, await selfMutate(e, (d) => { const mc = (d.mc = d.mc && typeof d.mc === 'object' ? d.mc : { home: null, list: [] }); mc.list = Array.isArray(mc.list) ? mc.list : []; const old = mc.list.find((y) => y.id === c.id);
    mc.list = mc.list.filter((y) => y.id !== c.id); mc.list.push(Object.assign(c, { at: now, n: N(old && old.n) + 1 })); mc.list.sort((a, b) => N(b.at) - N(a.at)); const keep = mc.list.filter((y) => y.id === mc.home).concat(mc.list.filter((y) => y.id !== mc.home).slice(0, MCMAX - 1)); mc.list = keep; return mcOut(d); })); }
async function myCourseHome(e, id) { const cid = id == null || id === '' ? null : okCid(id); if (id != null && id !== '' && !cid) throw bad(400, 'Pick a course first');
  return Object.assign({ ok: true }, await selfMutate(e, (d) => { const mc = (d.mc = d.mc && typeof d.mc === 'object' ? d.mc : { home: null, list: [] }); if (cid && !(mc.list || []).some((y) => y.id === cid)) throw bad(404, 'Use that course once first, then make it your home course'); mc.home = cid; return mcOut(d); })); }
async function myCourseRemove(e, id) { const cid = okCid(id); return Object.assign({ ok: true }, await selfMutate(e, (d) => { const mc = d.mc || { home: null, list: [] }; mc.list = (mc.list || []).filter((y) => y.id !== cid); if (mc.home === cid) mc.home = null; d.mc = mc; return mcOut(d); })); }

// ---------- share switch ("Show my lifetime stats to my groups", default OFF) ----------
async function shareGet(mk) { const r = await D.S.dbGet(SHARE); return (r && r.data && r.data.users && r.data.users[mk]) || null; }
async function shareSet(e, on) { const mk = mkOf(e); await rowMutate(SHARE, () => ({ users: {} }), (d) => { d.users = d.users || {}; if (on) d.users[mk] = { e, at: D.now() }; else delete d.users[mk]; return {}; }); return !!on; }
// The account's OWN name (the one it signed up with, row 'lock:names'; the owner's is fixed). Used wherever a name is shown to someone else or written to
// a log: course lists, tournament logs, guest mirrors, confirmations. Never text sent by the caller.
let NMC = { at: 0, v: {} };
async function nameOf(e) {
  const A = D.acct(); if (e === 'owner' || (typeof A.isOwnerPhone === 'function' && A.isOwnerPhone(e))) return clean(A.ownerName(), 30);
  const sid = await sidOf(e).catch(() => null); if (!sid) return '';
  if (D.now() - NMC.at > 60e3) { NMC = { at: D.now(), v: (await A.namesGet().catch(() => ({}))) || {} }; }
  return clean(NMC.v[String(sid).slice(0, 8)], 30);
}
// WHEN THE ACCOUNT STARTED. Review 5 (H1, H2), manager Nov 17 2026:
//   1. The sign-up stamp acct.js writes for every new account (row 'lock:acctsince'). WHEN A STAMP EXISTS IT IS THE ONLY ANSWER: no confirmation copy,
//      no entry time, nothing the phone or another player can write ever moves it (H2: a mirror of a match logged 29 days ahead used to age a new account).
//   2. Accounts older than the stamp get theirs from the ONE-TIME BACKFILL (odds-api/backfill-acctsince.js, run before the new code serves anything):
//      the earliest of the first bet id time and the first daily-log day, else deploy minus 30 days. It writes the marker row 'lock:acctsince:done'.
//   3. BOOT GUARD: until that marker row exists nothing is stamped "on first look". An account with no stamp then reads as known: false ("join date not on
//      file yet"); its age is not checked and its entries are never marked as dated before it joined. After the backfill, an account with no stamp is one
//      that first reached Oddable after it (every new account is stamped at sign-up), so it is stamped now, once.
const BFROW = 'lock:acctsince:done'; let BF = { at: 0, v: null }, BFWARN = false;
async function backfilled() {
  if (BF.v && BF.v.at) return BF.v; if (D.now() - BF.at < 30e3 && BF.at <= D.now()) return null;
  const r = await D.S.dbGet(BFROW).catch(() => null); BF = { at: D.now(), v: (r && r.data && r.data.at) ? r.data : null };
  if (!BF.v && !BFWARN) { BFWARN = true; console.error('stats: ACCOUNT START BACKFILL NOT RUN (row ' + BFROW + ' missing). Run: node odds-api/backfill-acctsince.js --write. Until then no account is stamped on first look.'); }
  return BF.v;
}
// -> { t: ms, known: bool }
async function sinceOf(e, now) {
  const t = now || D.now(); if (/^guest:/.test(String(e || ''))) return { t, known: false };
  const A = D.acct(); let stamp = null; try { if (typeof A.since === 'function') stamp = Number(await A.since(e)) || null; } catch (er) {}
  if (stamp && stamp > 1.4e12) return { t: Math.min(stamp, t), known: true };
  if (!(await backfilled())) return { t, known: false };
  if (typeof A.sinceSet === 'function') { try { const got = Number(await A.sinceSet(e, t)); if (got > 1.4e12) return { t: Math.min(got, t), known: true }; } catch (er) {} }
  return { t, known: false };
}
async function acctSince(e, sd, now) { return (await sinceOf(e, now)).t; } // kept for callers that only want a time; sd is no longer read (H2)

// ---------- golf COURSES (enterprise accounts) see consenting players' handicaps and rounds (owner decision, Nov 16 2026) ----------
// A player is asked "Share my handicap and rounds with <Course>?" when joining that course's league / event (default ON for that join), and can revoke in
// My stats > Sharing. Revoked = the course sees nothing of that player (history hidden too). Only rounds and the Oddable handicap are shared, never bets.
// Storage: 'lock:cshare' { c: { <courseId>: { name, m: { <member key>: { e, name, on, at, via: [{kind, id, title}] } } } } }
// STAND-INS with the SAME NAMES as the real helpers (the manager swaps them at merge; see HANDOFF "Player stats (v1)"):
//   limits.keyOf(e), limits.isEnterprise(accountKey)  -> Groups branch odds-api/limits.js ('lock:ent' {acct: {key: {on}}}, same row shape)
//   golf.coursesOwnedBy(accountKey) -> [{id, name}]   -> golf engine (not built there yet); stand-in row 'lock:entcourses' {own: {key: [{id, name}]}}
const CSH = 'lock:cshare', ENTC = 'lock:entcourses';
const LIMSTAND = {
  keyOf: (e) => sha('oddable-acct|' + String(e || '')).slice(0, 24), // same formula as limits.js keyOf
  isEnterprise: async (key) => { const r = await D.S.dbGet('lock:ent').catch(() => null), a = (r && r.data && r.data.acct) || {}; return !!(a[key] && a[key].on); },
};
const GOLFSTAND = { coursesOwnedBy: async (key) => { const r = await D.S.dbGet(ENTC).catch(() => null); return ((r && r.data && r.data.own && r.data.own[key]) || []).slice(0, 20); } };
const realOr = (mod, fn, stand) => { try { const m = require(mod); if (m && typeof m[fn] === 'function') return m; } catch (er) {} return stand; };
D.limits = () => (D.auto === false ? LIMSTAND : realOr('./limits', 'isEnterprise', LIMSTAND)); // `auto === false` (tests only, ported from the preview) = this file's own fallbacks
D.golf = () => (D.auto === false ? GOLFSTAND : realOr('./golf', 'coursesOwnedBy', GOLFSTAND));
const okCid = (v) => { const x = String(v || ''); return /^[\w-]{1,40}$/.test(x) ? x : ''; };
const cpid = (cid, mk) => sha('oddable-cpid|' + cid + '|' + mk).slice(0, 12); // a player's id inside one course's view only
// ONE consent store, ONE ownership answer (complete review, Medium 18): consents live only in stats ('lock:cshare'); the golf engine calls consentOnJoin and
// reads courseMembers / coursePrefill, and keeps no list of its own. Who runs a course is read from every place a link can be today, so the consent prompt
// and the director's list can never disagree: the golf module's coursesOwnedBy (or the stand-in row 'lock:entcourses'), and the golf engine's own
// 'lock:ent' { keys, courses: {accountKey: [courseId]} } with names from 'lock:golf:courses'. Enterprise = limits.isEnterprise or that row's keys.
async function entLinks(e) { // -> { ent: bool, courses: [{id, name}] } for one account
  const L = D.limits(), k = L.keyOf(e), out = new Map(); let ent = false;
  try { ent = !!(await L.isEnterprise(k)); } catch (er) {}
  const g = await D.S.dbGet('lock:ent').catch(() => null), gd = (g && g.data) || {}, gk = [String(e), k].filter((x) => gd.keys && gd.keys[x]); if (gk.length) ent = true;
  if (!ent) return { ent: false, courses: [] };
  try { for (const key of [k, String(e)]) ((await D.golf().coursesOwnedBy(key)) || []).forEach((c) => { const id = okCid(c && c.id); if (id) out.set(id, clean(c.name, 60)); }); } catch (er) {}
  const ids = [].concat(...[String(e), k].map((x) => (gd.courses && gd.courses[x]) || [])).map(okCid).filter((id) => id && !out.has(id));
  if (ids.length) { const cr = await D.S.dbGet('lock:golf:courses').catch(() => null), all = (cr && cr.data && cr.data.courses) || {}; ids.forEach((id) => out.set(id, clean(all[id] && all[id].name, 60) || 'Course')); }
  return { ent: true, courses: [...out].slice(0, 50).map(([id, name]) => ({ id, name })) };
}
// VOUCH (review 5, manager E). A club / Enterprise director vouches for a member: the member shows "vouched by <club>" in every make-up, and their
// confirmations count whatever the account's age (the activity check still applies). Logged in the row and revocable.
// Row 'lock:vouch' { c: { <courseId>: { name, m: { <member key>: { at, by } } } }, log: [{ at, club, by, player, on }] }. Server only.
const VOUCH = 'lock:vouch'; let VOC = { at: 0, v: null };
async function vouchRow() { if (VOC.v && D.now() - VOC.at < 30e3 && VOC.at <= D.now()) return VOC.v; const r = await D.S.dbGet(VOUCH).catch(() => null); VOC = { at: D.now(), v: (r && r.data) || { c: {} } }; return VOC.v; }
const vouchedBy = (VO, mk) => Object.keys((VO && VO.c) || {}).filter((cid) => VO.c[cid].m && VO.c[cid].m[mk]).map((cid) => clean(VO.c[cid].name, 60) || 'Club').slice(0, 5);
async function vouch(courseOrClubId, playerRef, directorE, on) {
  const cid = okCid(courseOrClubId); if (!cid) throw bad(400, 'Pick a club');
  const club = (await ownedCourses(directorE)).find((c) => c.id === cid); if (!club) throw bad(403, 'Only that club\'s Enterprise director can vouch for its members');
  if (/^guest:/.test(String(playerRef || '')) || !playerRef) throw bad(400, 'Only an Oddable account can be vouched for');
  const mk = mkOf(playerRef), by = (await nameOf(directorE)) || 'Club director', player = (await nameOf(playerRef)) || 'Player', yes = on !== false;
  await rowMutate(VOUCH, () => ({ c: {}, log: [] }), (d) => { d.c = d.c || {}; d.log = d.log || []; const c = d.c[cid] = d.c[cid] || { name: club.name, m: {} }; c.name = club.name || c.name; c.m = c.m || {};
    if (yes === !!c.m[mk]) return { nochange: true }; if (yes) c.m[mk] = { at: D.now(), by }; else delete c.m[mk];
    d.log.push({ at: D.now(), club: c.name, by, player, on: yes }); if (d.log.length > 2000) d.log = d.log.slice(-2000); return {}; });
  VOC = { at: 0, v: null }; BYC.clear(); CACHE.clear(); return { ok: true, club: club.name, player, vouched: yes };
}
const unvouch = (courseOrClubId, playerRef, directorE) => vouch(courseOrClubId, playerRef, directorE, false);
async function vouchLog(directorE, courseOrClubId) { const cid = okCid(courseOrClubId); if (!(await ownedCourses(directorE)).some((c) => c.id === cid)) throw bad(403, 'Not your club'); const v = await vouchRow(), club = v.c && v.c[cid]; return { ok: true, log: ((v.log) || []).filter((l) => club && l.club === club.name).slice(-200) }; }
async function ownedCourses(e) { return (await entLinks(e)).courses; }
async function courseOwner(cid) { // does any enterprise account run this course? -> { name } | null (the consent prompt asks only then)
  if (typeof D.golf().courseOwner === 'function') { const o = await D.golf().courseOwner(cid); if (o) return o; }
  const r = await D.S.dbGet(ENTC).catch(() => null), own = (r && r.data && r.data.own) || {};
  for (const k of Object.keys(own)) { const c = (own[k] || []).find((x) => x.id === cid); if (c && (await D.limits().isEnterprise(k).catch(() => false))) return { key: k, name: clean(c.name, 60) }; }
  const g = await D.S.dbGet('lock:ent').catch(() => null), gd = (g && g.data) || {};
  for (const k of Object.keys(gd.courses || {})) { if (!(gd.courses[k] || []).includes(cid)) continue; if (!((gd.keys && gd.keys[k]) || (await D.limits().isEnterprise(k).catch(() => false)) || (await D.limits().isEnterprise(D.limits().keyOf(k)).catch(() => false)))) continue;
    const cr = await D.S.dbGet('lock:golf:courses').catch(() => null), all = (cr && cr.data && cr.data.courses) || {}; return { key: k, name: clean(all[cid] && all[cid].name, 60) || 'Course' }; }
  return null;
}
async function cshare() { const r = await D.S.dbGet(CSH).catch(() => null); return (r && r.data && r.data.c) || {}; }
// Exported for the golf / events engines: call when a player joins a course's league or event (after showing the consent question; on = their answer).
// IDENTITY (review fix 7): the row is keyed by the caller's own account and the name shown to the course is the account's own name (nameOf), read again
// every time the course looks. A name sent by the caller is ignored, so nobody can appear under another name.
const ROUTE = Symbol('from the phone route'); // only the route handlers in this file can say a call came from a phone
async function consentOnJoin(e, courseId, via, on, from) {
  const fromRoute = from === ROUTE;
  const cid = okCid(courseId); if (!cid) throw bad(400, 'Bad course'); const own = await courseOwner(cid); if (!own) return { ok: true, asked: false };
  // Review 3, L5: a phone can only switch its OWN existing share on or off. Joining a course's list, and the league / event named on it, come only from
  // the engine that saw the player join (this function called server-side, fromRoute false). Text a phone sends is never shown to the director.
  if (fromRoute) { const cur = ((((await cshare())[cid] || {}).m) || {})[mkOf(e)]; if (!cur) throw bad(403, 'Join one of this course\'s leagues or events first. Sharing starts there.'); via = null; }
  const mk = mkOf(e), v = via && via.id ? { kind: clean(via.kind, 12) || 'event', id: String(via.id).replace(/[^\w-]/g, '').slice(0, 40), title: clean(via.title, 60) } : null;
  const res = await rowMutate(CSH, () => ({ c: {} }), (d) => { d.c = d.c || {}; const c = (d.c[cid] = d.c[cid] || { name: own.name, m: {} }); c.name = own.name || c.name; const m = (c.m[mk] = c.m[mk] || { e, via: [] });
    m.e = e; m.on = !!on; m.at = D.now(); delete m.name; if (v && !m.via.some((x) => x.id === v.id)) m.via = m.via.concat(v).slice(-50); return { on: m.on }; });
  CACHE.delete(e); return { ok: true, asked: true, on: res.on, course: own.name };
}
function hcpTrend(h, today) { // arrow for the course list: index now vs the latest index from 30+ days ago (lower = better)
  if (h.index == null || !h.history.length) return { dir: '', change: null };
  const cut = new Date(Date.parse(today + 'T12:00:00Z') - 30 * DAY).toISOString().slice(0, 10), old = h.history.filter((x) => x.date <= cut).pop();
  if (!old) return { dir: '', change: null }; const ch = r1(h.index - old.index); return { dir: ch < -0.05 ? 'better' : ch > 0.05 ? 'worse' : 'steady', change: ch };
}
const shareHcp = (h) => { const x = clone(h); delete x.conf; x.diffs = x.diffs.map((d, i) => Object.assign(d, { id: 'r' + i })); x.history = x.history.map((p) => ({ date: p.date, index: p.index })); return x; }; // record ids never leave; each diff keeps self / confirmed
async function courseView(e, op, b, today) {
  const mine = await ownedCourses(e); if (op === 'course/mine') { const cs = await cshare(); return { ok: true, courses: mine.map((c) => ({ id: c.id, name: c.name, players: Object.values((cs[c.id] || {}).m || {}).filter((m) => m.on).length })) }; }
  const cid = okCid(b.courseId), course = mine.find((c) => c.id === cid); if (!course) throw bad(404, 'Course not found');
  const cs = await cshare(), members = Object.entries(((cs[cid] || {}).m) || {}).filter(([, m]) => m.on && m.e).slice(0, 400), via = String(b.via || '');
  const events = []; members.forEach(([, m]) => (m.via || []).forEach((v) => { if (!events.some((x) => x.id === v.id)) events.push(v); }));
  const pick = members.filter(([, m]) => !via || (m.via || []).some((v) => v.id === via)), mo = today.slice(0, 7) + '-01', cname = normCourse(course.name);
  const rows = []; for (const [mk, m] of pick) { let v; try { v = await cached(m.e); } catch (er) { continue; } const golfRecs = v.recs.filter((r) => r.sport === 'golf'), h = golfHcp(golfRecs, oppKeyFor(mk), await confCtx(golfRecs, oppKeyFor(mk))), t = hcpTrend(h, today);
    rows.push({ pid: cpid(cid, mk), name: (await nameOf(m.e).catch(() => '')) || 'Player', index: h.index, confirmedIndex: h.moneyIndex, suggested: h.suggested, confirmedRounds: h.confirmedRounds, confirmedOf: h.confirmedOf, of: h.of, selfLogged: h.selfLogged, text: h.text, why: h.moneyWhy, makeup: { n: h.makeup.n, text: h.makeup.text, who: h.makeup.who, flags: h.makeup.flags, warn: h.makeup.warn, provisional: h.makeup.provisional, scored: h.makeup.scored, linked: h.makeup.linked, typed: h.makeup.typed, confirmers: h.makeup.confirmers }, trend: t.dir, change: t.change, rounds: h.rounds, need: h.need, roundsMonth: golfRecs.filter((r) => ownRound(r) && r.date >= mo).length, _h: h, _recs: golfRecs }); }
  if (op === 'course/players') return { ok: true, course, events, via: via || null, label: HCP_LABEL, method: HCP_METHOD, players: rows.map(({ _h, _recs, ...x }) => x).sort((a, c) => (a.index == null) - (c.index == null) || (a.index || 0) - (c.index || 0) || a.name.localeCompare(c.name)) };
  if (op === 'course/player') { const r0 = rows.find((x) => x.pid === String(b.pid || '')); if (!r0) throw bad(404, 'Player not found'); return { ok: true, course, name: r0.name, readOnly: true, golfHcp: shareHcp(r0._h) }; }
  if (op === 'course/rounds') { const out = []; rows.forEach((x) => x._recs.filter((r) => r.kind === 'golf-round' && !(r.extra && r.extra.side) && ((r.extra && okCid(r.extra.courseId) === cid) || normCourse(r.extra && r.extra.course) === cname)).forEach((r) => { const d = x._h.diffs.find((y) => y.id === r.id); out.push({ date: r.date, pid: x.pid, name: x.name, score: r.score, toPar: r.toPar == null ? null : r.toPar, tees: clean(r.extra.tees, 20), holes: holesOf(r), team: teamFmt(r), diff: d ? d.diff : null, self: isSelfLogged(r), confirmed: !!(x._h.conf[r.id] && x._h.conf[r.id].confirmed), how: (() => { const c = x._h.conf[r.id] || {}, typed = c.typed ? 'typed total' : 'hole by hole'; return isSelfLogged(r) ? (c.confirmed ? 'Self-logged (' + typed + '), confirmed by ' + (c.name || 'a player who was there') : 'Self-logged (' + typed + '), not confirmed') : c.confirmed ? 'Scored in a game, card confirmed by ' + (c.name || 'another team') : 'Scored in the app, not confirmed'; })() }); }));
    return { ok: true, course, rounds: out.sort((a, c) => (a.date < c.date ? 1 : a.date > c.date ? -1 : 0)).slice(0, 500) }; }
  if (op === 'course/prefill') { const cr = numOpt(b.cr, 55, 85, 'Course Rating: 55 to 85'), slope = int(b.slope, 55, 155, 'Slope Rating: 55 to 155'), par = int(b.par, 54, 80, 'Par: 54 to 80');
    if (cr == null) throw bad(400, 'Enter the Course Rating');
    return { ok: true, course, tee: { cr, slope, par }, note: 'Course handicaps come from confirmed rounds only. A player needs 3 confirmed rounds, confirmed by 3 different players; until then they have none: set a number for them.',
      players: rows.map((x) => ({ pid: x.pid, name: x.name, index: x.index, confirmedIndex: x.confirmedIndex, suggested: x.suggested, confirmedRounds: x.confirmedRounds, text: x.text, why: x.why, makeup: x.makeup, needsSet: x.confirmedIndex == null, ch: x.confirmedIndex == null ? null : R.courseHandicap(x.confirmedIndex, slope, cr, par) })).sort((a, c) => (a.ch == null) - (c.ch == null) || (a.ch || 0) - (c.ch || 0)) }; }
  throw bad(404, 'not found');
}
// Exported for the golf engine's director screens: the consenting members of one of the director's courses, each with the Oddable index, the CONFIRMED
// index and the "12.6 · 4 of 20 rounds confirmed" line. -> { ok, course, events, players: [{pid, name, index, confirmedIndex, confirmedRounds, text, ...}] }
async function courseMembers(directorE, courseId, via) { return courseView(directorE, 'course/players', { courseId, via: via || '' }, chiDay(D.now())); }
// Exported for the golf engine's golf-day setup: consenting players' course handicaps for one tee.
async function coursePrefill(ownerE, courseId, tee) { return courseView(ownerE, 'course/prefill', Object.assign({ courseId }, tee || {}), chiDay(D.now())); }
// Owner-only stand-in admin (until the owner dashboard has it): mark an account enterprise / link it to a course. `tag` = the 8-letter player tag the owner dashboard shows.
async function courseAdmin(b) {
  const A = D.acct(), tag = String(b.tag || '').toLowerCase(); if (!/^[0-9a-f]{8}$/.test(tag)) throw bad(400, 'Player tag: 8 letters from the dashboard');
  const id = (await D.S.dbIds()).find((x) => x.startsWith(tag)); if (!id) throw bad(404, 'No player with that tag'); const key = D.limits().keyOf(A.phoneEmail(id));
  if (b.op === 'ent') { await rowMutate('lock:ent', () => ({ acct: {}, seats: {} }), (d) => { d.acct = d.acct || {}; d.acct[key] = { on: !!b.on, at: D.now() }; return {}; }); return { ok: true, enterprise: !!b.on }; }
  if (b.op === 'link' || b.op === 'unlink') { const cid = okCid(b.courseId), name = clean(b.name, 60); if (!cid) throw bad(400, 'Course id'); if (b.op === 'link' && name.length < 2) throw bad(400, 'Course name');
    await rowMutate(ENTC, () => ({ own: {} }), (d) => { d.own = d.own || {}; const l = (d.own[key] || []).filter((c) => c.id !== cid); if (b.op === 'link') l.push({ id: cid, name }); d.own[key] = l.slice(0, 20); return {}; }); return { ok: true }; }
  throw bad(400, 'op: ent | link | unlink');
}

// ---------- H1 + E-H: THE handicap / rating every engine uses (golf strokes, net scores, flights, pairings, partner suggestions) ----------
// H1 (owner, Nov 16 2026): every round played or logged in the app counts; the Oddable Handicap Index (WHS method) is the handicap everywhere.
// E-H (owner, Nov 16 2026): in an Enterprise tournament the director may ADD a handicap / rating for a player who has none, or CHANGE anyone's, for that
// tournament only, until it starts (lockAt); every add/change is logged (who, when, old, new, reason) and shows "Set by tournament". A director's edit
// never touches the player's lifetime Oddable index. Addendum: "But Oddable is there as real results": the real Oddable value is always returned next
// to the tournament one ({oddable, event, setBy}), and My handicap always shows the real one.
// EVENTS: who plays off what (review 5, manager Nov 17 2026: "stop the arms race, simplify").
//   A. The Oddable number is always worked out from all app play and shown with its make-up.
//   B. In ANY money game, flight or tournament the number a player plays off is APPROVED (or set) by the organizer / director before the start. Nothing is
//      used automatically. handicapFor / ratingFor give `use` only when the event has an approval or a set value for that player.
//   C. One tap: eventApproveAll ("Use everyone's Oddable index") approves each player's suggested number. An approval stands for that event; in a group or
//      league SEASON (kind 'season') it stands until the suggested number moves by CONF.seasonMove (1.0) or more (ratings: CONF.seasonMoveRating points).
//   D. WHO MAY APPROVE is checked HERE: the organizer, a co-organizer or an Enterprise director registered by eventSetup. Nobody approves or sets his OWN
//      number: that needs a co-sign from a different organizer / director or from a player on another team (both names are kept). Every approval and set
//      value goes in the event log, which every player in the event can read ("12.6 approved by Coach Mo"), next to the real Oddable number.
// Row 'lock:evr:<eventId>' { org, co: [keys], dirs: [keys], dir (legacy: the Enterprise creator), kind, money, title, sport, lockAt, lockAt0, moves,
//   pl: { <player key>: { u (userKey, server only), name, team } }, set: { <player key>: { hcp?, rating?, at, reason, name, by, cosign } },
//   ap: { <player key>: { hcp?, rating?, base, confirmed, at, name, by, cosign } }, log: [..] }
//   role keys = limits keyOf(account); player key = groups member key (mkOf) for an account, 'g:<gid>' for a guest player (userKey 'guest:<gid>').
const EVR = (id) => 'lock:evr:' + id;
const okEid = (v) => { const x = String(v || ''); return /^[\w.:-]{1,60}$/.test(x) ? x : ''; };
const pkeyOf = (userKey) => { const m = /^guest:([a-z0-9]{6,24})$/.exec(String(userKey || '')); return m ? 'g:' + m[1] : mkOf(userKey); };
async function recsOf(userKey) { // a player's validated records (an account through every provider; a guest from the guest row)
  const m = /^guest:([a-z0-9]{6,24})$/.exec(String(userKey || ''));
  if (!m) return (await cached(userKey)).recs;
  const g = await D.S.dbGet(GROW(m[1])).catch(() => null); return ((g && g.data && g.data.items) || []).map((x) => validate(Object.assign({}, x, { src: 'self', verified: false }), 'self')).filter((v) => v.ok).map((v) => v.rec);
}
async function evRow(eventId) { const id = okEid(eventId); if (!id) return null; const r = await D.S.dbGet(EVR(id)).catch(() => null); return (r && r.data) || null; }
const evLocked = (ev) => !!(ev && ev.lockAt && D.now() >= ev.lockAt);
const KINDS_EV = ['game', 'flight', 'tournament', 'season'];
const evSport = (v) => { const x = String(v == null ? '' : v).toLowerCase().trim(); if (!x || x === 'golf') return 'golf'; try { return normSport(x); } catch (er) { return 'golf'; } };
const fieldOf = (ev) => ((ev && ev.sport) && ev.sport !== 'golf' ? 'rating' : 'hcp');
async function pname(userKey, fallback) { const gm = /^guest:([a-z0-9]{6,24})$/.exec(String(userKey || '')); if (gm) { const gr = await D.S.dbGet(GROW(gm[1])).catch(() => null); return clean(gr && gr.data && gr.data.name, 30) || clean(fallback, 30) || 'Guest'; } return (await nameOf(userKey).catch(() => '')) || clean(fallback, 30) || 'Player'; }
// The caller's role in an event: 'org' | 'co' | 'dir' | null. A director (and the creator of an Enterprise TOURNAMENT) must still be Enterprise.
async function roleOf(ev, e) {
  if (!ev || !e || /^guest:/.test(String(e))) return null; const k = D.limits().keyOf(e), entNow = async () => (await entLinks(e)).ent;
  if (ev.org === k || (!ev.org && ev.dir === k)) { if ((ev.kind === 'tournament' || !ev.org) && !(await entNow())) return null; return 'org'; }
  if ((ev.co || []).includes(k)) return 'co';
  if ((ev.dirs || []).includes(k) && (await entNow())) return 'dir';
  return null;
}
const NOROLE = 'Only this event\'s organizer, a co-organizer or its Enterprise director can approve or set numbers';
// Registers a money game / flight / tournament / season (the ENGINE, server-side, when it is created; the phone route can only change the start time and
// title of an event its caller organizes, never create one or add people).
//   o = { title, sport ('golf' | a rating sport | a game's name), kind ('game' | 'flight' | 'tournament' | 'season'), lockAt, money,
//         coOrganizers: [accountId], directors: [accountId] (Enterprise accounts), players: [userKey | { key, team, name }], reason }
// lockAt (the first tee time / start) rules, review fix 5 + review 3, L4: it can be moved LATER only, only before it passes, at most EVT.moves times and
// never more than EVT.slipDays days past the first start; it must be within a year; every set / move is logged; after it passes nothing changes.
// A TOURNAMENT (E-H) needs an Enterprise creator and a start time before any number is set.
const EVT = { aheadDays: 366, moves: 5, slipDays: 14 };
async function eventSetup(organizerE, eventId, o, from) {
  const fromRoute = from === ROUTE;
  const id = okEid(eventId); if (!id) throw bad(400, 'Bad event'); const L = D.limits(), dk = L.keyOf(organizerE), x = o || {};
  if (!organizerE || /^guest:/.test(String(organizerE))) throw bad(403, 'Sign in first');
  const ent = (await entLinks(organizerE)).ent, cur = await evRow(id);
  if (!cur) { if (fromRoute) throw bad(404, 'Event not found'); const kind = KINDS_EV.includes(x.kind) ? x.kind : ent ? 'tournament' : 'game'; if (kind === 'tournament' && !ent) throw bad(403, 'Only Enterprise tournaments can set handicaps (an Enterprise account creates a tournament)'); }
  const lockAt = Number(x.lockAt) > 0 ? Math.round(Number(x.lockAt)) : null, by = (await nameOf(organizerE)) || 'Organizer';
  const keysOf = (list, max) => (Array.isArray(list) ? list : []).filter((v) => v && !/^guest:/.test(String(v))).slice(0, max).map((v) => L.keyOf(v));
  const dirsOk = []; if (!fromRoute) for (const de of (Array.isArray(x.directors) ? x.directors : []).slice(0, 5)) { if (de && (await entLinks(de)).ent) dirsOk.push(L.keyOf(de)); else throw bad(403, 'A director must be an Enterprise account'); }
  const pls = []; if (!fromRoute) for (const p of (Array.isArray(x.players) ? x.players : []).slice(0, 400)) { const u = typeof p === 'string' ? p : p && p.key; if (!u) continue; pls.push({ pk: pkeyOf(u), u: String(u), team: clean(p && p.team, 30), name: await pname(u, p && p.name) }); }
  if (cur && (!(await roleOf(cur, organizerE)) || (fromRoute && (cur.org || cur.dir) !== dk))) throw bad(403, 'Not your event (only its organizer or Enterprise director)');
  await rowMutate(EVR(id), fromRoute ? null : () => ({ org: dk, dir: ent ? dk : undefined, co: [], dirs: [], kind: KINDS_EV.includes(x.kind) ? x.kind : ent ? 'tournament' : 'game', set: {}, ap: {}, pl: {}, log: [] }), (d) => {
    if (!d.org && d.dir) d.org = d.dir; // rows written before review 5
    if (d.org !== dk && !(d.co || []).includes(dk) && !(d.dirs || []).includes(dk)) throw bad(403, 'Not your event (only its organizer or Enterprise director)');
    if (evLocked(d)) throw bad(409, 'The event has started; numbers and the start time are locked');
    const now = D.now(); d.log = d.log || []; d.pl = d.pl || {}; d.ap = d.ap || {}; d.set = d.set || {};
    if (lockAt != null && lockAt !== d.lockAt) {
      if (d.lockAt && lockAt < d.lockAt) throw bad(400, 'The start can only be moved later, not earlier'); if (lockAt <= now) throw bad(400, 'The tournament start must be in the future');
      if (lockAt > now + EVT.aheadDays * DAY) throw bad(400, 'The tournament start must be within a year');
      if (d.lockAt) { const first = d.lockAt0 || d.lockAt; if (N(d.moves) >= EVT.moves) throw bad(409, 'The start has already been moved ' + EVT.moves + ' times. It cannot be moved again.'); if (lockAt > first + EVT.slipDays * DAY) throw bad(400, 'The start cannot be moved more than ' + EVT.slipDays + ' days past the first start that was set'); d.moves = N(d.moves) + 1; } else d.lockAt0 = lockAt;
      d.log.push({ at: now, by, player: '', field: 'lockAt', old: d.lockAt || null, new: lockAt, oddable: null, reason: clean(x.reason, 120) || (d.lockAt ? 'Start moved later' : 'Start set') }); d.lockAt = lockAt;
    }
    if (!fromRoute && d.org === dk) {
      d.co = [...new Set((d.co || []).concat(keysOf(x.coOrganizers, 10)))].filter((k) => k !== d.org).slice(0, 10); d.dirs = [...new Set((d.dirs || []).concat(dirsOk))].slice(0, 5);
      pls.forEach((p) => { d.pl[p.pk] = { u: p.u, name: p.name, team: p.team || (d.pl[p.pk] && d.pl[p.pk].team) || '' }; });
      if (Object.keys(d.pl).length > 400) throw bad(400, 'At most 400 players in one event');
      if (x.money != null) d.money = !!x.money;
    }
    d.title = clean(x.title, 60) || d.title || 'Tournament'; if (x.sport != null && !fromRoute) d.sport = evSport(x.sport); d.sport = d.sport || 'golf'; d.lockAt = d.lockAt || null; return {}; });
  return { ok: true };
}
// Who may co-sign when the approver is the player himself: a different organizer / co-organizer / director, or a player on ANOTHER team in this event.
async function cosignOk(ev, approverE, playerKey, cosignE) {
  if (!cosignE || pkeyOf(cosignE) === playerKey || pkeyOf(cosignE) === pkeyOf(approverE)) return null;
  if (await roleOf(ev, cosignE)) return (await nameOf(cosignE)) || 'Organizer';
  const me = ev.pl && ev.pl[pkeyOf(approverE)], them = ev.pl && ev.pl[pkeyOf(cosignE)];
  if (me && them && me.team && them.team && me.team !== them.team) return (await nameOf(cosignE)) || them.name || 'Player';
  return null;
}
const SELF = 'You cannot approve or set your own number. A different organizer or director, or a player on another team, has to co-sign it';
const nowNumber = async (userKey, ev) => (fieldOf(ev) === 'hcp' ? await handicapFor(userKey) : await ratingFor(userKey, ev.sport));
// eventApprove(eventId, playerRef, value, approverAccount, {cosign, reason}): the organizer approves the number he was shown (`value`, or null = the
// player's suggested number now). If the suggested number changed since the screen was drawn, nothing is approved (409: look again).
async function eventApprove(eventId, playerRef, value, approverE, opts) {
  const id = okEid(eventId); if (!id) throw bad(400, 'Bad event'); const ev0 = await evRow(id); if (!ev0) throw bad(404, 'Event not found'); const o = opts || {};
  const role = await roleOf(ev0, approverE); if (!role) throw bad(403, NOROLE); if (evLocked(ev0)) throw bad(409, 'The event has started; numbers are locked');
  const field = fieldOf(ev0), pk = pkeyOf(playerRef); let cosign = null;
  if (pk === pkeyOf(approverE)) { cosign = await cosignOk(ev0, approverE, pk, o.cosign); if (!cosign) throw bad(403, SELF); }
  const f = await nowNumber(playerRef, ev0), sug = f.suggested || {}, real = field === 'hcp' ? f.oddable.index : f.oddable.rating;
  if (sug.value == null) throw bad(409, 'No Oddable number for this player yet. Set one for this event.');
  const want = value == null || value === '' ? sug.value : Number(value); if (!Number.isFinite(want) || Math.abs(want - sug.value) > 1e-9) throw bad(409, 'The number changed (now ' + (field === 'hcp' ? R.fmtIdx(sug.value) : sug.value) + '). Look at it again before approving.');
  const by = (await nameOf(approverE)) || 'Organizer', name = await pname(playerRef);
  await rowMutate(EVR(id), null, (d) => { if (evLocked(d)) throw bad(409, 'The event has started; numbers are locked'); d.ap = d.ap || {}; d.pl = d.pl || {}; d.log = d.log || [];
    const old = d.ap[pk] && d.ap[pk][field] != null ? d.ap[pk][field] : null;
    d.ap[pk] = Object.assign({}, d.ap[pk], { [field]: want, base: sug.value, confirmed: !!sug.confirmed, at: D.now(), name, by, cosign: cosign || undefined });
    if (!d.pl[pk]) d.pl[pk] = { u: String(playerRef), name, team: '' };
    d.log.push({ at: D.now(), by, cosign: cosign || undefined, player: name, pk, field, kind: 'approve', old, new: want, oddable: real == null ? null : real, reason: clean(o.reason, 120) || (sug.confirmed ? 'Oddable number approved (confirmed)' : 'Oddable number approved (UNCONFIRMED)') }); if (d.log.length > 2000) d.log = d.log.slice(-2000);
    return {}; });
  await evIndexAdd(pk, id); CACHE.clear();
  return { ok: true, player: name, value: want, confirmed: !!sug.confirmed, by, cosign: cosign || undefined };
}
// "Use everyone's Oddable index": approves the suggested number of every registered player who has no number yet. The approver's own number is left for
// a co-sign; a player with no Oddable number is left for a typed one. -> { ok, approved: [{name, value, confirmed}], skipped: [{name, why}] }
async function eventApproveAll(eventId, approverE, opts) {
  const ev = await evRow(eventId); if (!ev) throw bad(404, 'Event not found'); if (!(await roleOf(ev, approverE))) throw bad(403, NOROLE);
  const field = fieldOf(ev), out = { ok: true, approved: [], skipped: [] };
  for (const pk of Object.keys(ev.pl || {})) {
    const p = ev.pl[pk], cur = await nowNumber(p.u, ev);
    if (ev.set && ev.set[pk] && ev.set[pk][field] != null) { out.skipped.push({ name: p.name, why: 'set by the organizer' }); continue; }
    if (pk === pkeyOf(approverE)) { out.skipped.push({ name: p.name, why: 'your own number: another organizer or director, or a player on another team, co-signs it' }); continue; }
    if (!cur.suggested || cur.suggested.value == null) { out.skipped.push({ name: p.name, why: 'no Oddable number yet: set one' }); continue; }
    try { const r = await eventApprove(eventId, p.u, cur.suggested.value, approverE, opts); out.approved.push({ name: r.player, value: r.value, confirmed: r.confirmed }); } catch (er) { out.skipped.push({ name: p.name, why: er.message }); }
  }
  return out;
}
// Director / organizer adds, changes or clears (value null) one player's number for this event only. A reason is required. A tournament (E-H) needs its
// start time first. The log's "by" and the player's name come from the accounts themselves (nameOf), never from text the caller sent.
async function eventOverride(directorE, eventId, userKey, o) {
  const id = okEid(eventId); if (!id) throw bad(400, 'Bad event'); const x = o || {}, ev0 = await evRow(id);
  if (!ev0) throw bad(404, 'Event not found'); if (!(await roleOf(ev0, directorE))) throw bad(403, NOROLE);
  const field = x.rating !== undefined ? 'rating' : 'hcp', raw = x[field];
  const val = raw == null || raw === '' ? null : field === 'hcp' ? numOpt(raw, -10, 54, 'Handicap must be +10 to 54.0', 1) : numOpt(raw, 100, 3500, 'Rating must be 100 to 3500', 0);
  const reason = clean(x.reason, 120); if (!reason) throw bad(400, 'Enter a reason for the change');
  const pk = pkeyOf(userKey); let cosign = null; if (pk === pkeyOf(directorE)) { cosign = await cosignOk(ev0, directorE, pk, x.cosign); if (!cosign) throw bad(403, SELF); }
  const real = field === 'hcp' ? (await handicapFor(userKey, { casual: true })).oddable.index : (await ratingFor(userKey, x.sport == null || x.sport === 'golf' ? (ev0.sport && ev0.sport !== 'golf' ? ev0.sport : 'pickleball') : x.sport, { casual: true })).oddable.rating;
  const by = (await nameOf(directorE)) || 'Tournament director', name = await pname(userKey, x.name || (ev0.pl && ev0.pl[pk] && ev0.pl[pk].name));
  const res = await rowMutate(EVR(id), null, (d) => {
    if (ev0.kind === 'tournament' && !d.lockAt) throw bad(409, 'Set the tournament start time first. Handicaps can be set until the start.'); if (evLocked(d)) throw bad(409, 'The tournament has started; handicaps are locked');
    d.set = d.set || {}; d.log = d.log || []; d.pl = d.pl || {}; const cur = d.set[pk] || {}, old = cur[field] != null ? cur[field] : real;
    if ((cur[field] == null && val == null) || cur[field] === val) return { nochange: true, v: { ok: true, changed: false } };
    const nx = Object.assign({}, cur, { at: D.now(), reason, name: name || cur.name || '', by, cosign: cosign || undefined }); if (val == null) delete nx[field]; else nx[field] = val;
    if (nx.hcp == null && nx.rating == null) delete d.set[pk]; else d.set[pk] = nx;
    if (!d.pl[pk]) d.pl[pk] = { u: String(userKey), name: nx.name, team: '' };
    d.log.push({ at: D.now(), by, cosign: cosign || undefined, player: nx.name || 'Player', pk, field, kind: 'set', old: old == null ? null : old, new: val, oddable: real == null ? null : real, reason }); if (d.log.length > 2000) d.log = d.log.slice(-2000); // pk = the player's key (server only, stripped by logOut)
    return { ok: true, changed: true, old: old == null ? null : old, new: val };
  });
  if (res && res.changed) await evIndexAdd(pk, id);
  CACHE.clear(); return res;
}
// The event log. Organizers / directors read all of it; EVERY PLAYER IN THE EVENT reads every approval and set value too (manager D: "12.6 approved by
// Coach Mo" is visible to all the players), next to the real Oddable number. Anyone else gets 404. Player keys never leave.
const logOut = (l) => ({ at: l.at, by: l.by, cosign: l.cosign || undefined, player: l.player, field: l.field, kind: l.kind || (l.field === 'lockAt' ? 'start' : 'set'), old: l.old, new: l.new, oddable: l.oddable, reason: l.reason });
const logMine = (ev, pk) => (ev.log || []).filter((l) => l.field !== 'lockAt' && l.pk === pk); // a player's own lines (the "Set by tournament" card)
const inEvent = (ev, pk) => !!((ev.pl && ev.pl[pk]) || (ev.set && ev.set[pk]) || (ev.ap && ev.ap[pk]));
async function eventLog(callerE, eventId) {
  const ev = await evRow(eventId); if (!ev) throw bad(404, 'Tournament not found'); const base = { ok: true, title: clean(ev.title, 60) || 'Tournament', sport: ev.sport || 'golf', kind: ev.kind || 'tournament', locked: evLocked(ev), lockAt: ev.lockAt || null };
  const field = fieldOf(ev), shown = (pk, x) => ({ name: x.name || 'Player', hcp: x.hcp != null ? x.hcp : null, rating: x.rating != null ? x.rating : null, reason: x.reason || '', by: x.by || '', cosign: x.cosign || undefined, at: x.at });
  const lines = (ev.log || []).slice(-500).map(logOut), approvals = Object.keys(ev.ap || {}).filter((pk) => ev.ap[pk][field] != null).map((pk) => Object.assign(shown(pk, ev.ap[pk]), { confirmed: !!ev.ap[pk].confirmed }));
  const set = Object.keys(ev.set || {}).map((pk) => shown(pk, ev.set[pk]));
  if (await roleOf(ev, callerE)) return Object.assign(base, { director: true, set, approvals, log: lines });
  const pk = pkeyOf(callerE); if (!inEvent(ev, pk)) throw bad(404, 'Tournament not found');
  const s = ev.set && ev.set[pk];
  return Object.assign(base, { director: false, mine: s ? { hcp: s.hcp != null ? s.hcp : null, rating: s.rating != null ? s.rating : null, reason: s.reason || '', at: s.at } : null, set, approvals, log: lines.filter((l) => l.field !== 'lockAt') });
}
// The organizer's approval screen, one row per registered player: the real Oddable number, the suggested one (confirmed or UNCONFIRMED), the make-up and
// its flags, and what is approved or set. `ready` = every player has a number to play off (engines block Start in a money game until it is true).
async function eventReview(eventId, callerE) {
  const ev = await evRow(eventId); if (!ev) throw bad(404, 'Event not found'); if (!(await roleOf(ev, callerE))) throw bad(403, NOROLE);
  const rows = []; for (const pk of Object.keys(ev.pl || {})) { const p = ev.pl[pk], f = fieldOf(ev) === 'hcp' ? await handicapFor(p.u, { eventId }) : await ratingFor(p.u, ev.sport, { eventId });
    rows.push({ name: p.name, team: p.team || '', you: pk === pkeyOf(callerE), oddable: fieldOf(ev) === 'hcp' ? f.oddable.index : f.oddable.rating, suggested: f.suggested, makeup: f.makeup, flags: f.flags, vouched: f.vouched, use: f.use, setBy: f.setBy, by: f.by, cosign: f.cosign, shown: f.shown, why: f.why }); }
  return { ok: true, title: clean(ev.title, 60), kind: ev.kind || 'game', sport: ev.sport || 'golf', field: fieldOf(ev), locked: evLocked(ev), players: rows, ready: rows.length > 0 && rows.every((r) => r.use != null), unconfirmed: rows.filter((r) => r.suggested && r.suggested.value != null && !r.suggested.confirmed).map((r) => r.name), noNumber: rows.filter((r) => !r.suggested || r.suggested.value == null).map((r) => r.name) };
}
// What the player plays off in one event. -> { use, setBy, by, cosign, event, lapsed, at, reason }
function evUse(ev, userKey, field, sug) {
  const pk = pkeyOf(userKey), s = ev && ev.set && ev.set[pk] && ev.set[pk][field] != null ? ev.set[pk] : null, a = ev && ev.ap && ev.ap[pk] && ev.ap[pk][field] != null ? ev.ap[pk] : null;
  if (s) return { use: s[field], setBy: ev.kind === 'tournament' || (!ev.org && ev.dir) ? 'tournament' : 'organizer', by: s.by || '', cosign: s.cosign, event: s[field], at: s.at, reason: s.reason };
  if (a) { const move = field === 'hcp' ? CONF.seasonMove : CONF.seasonMoveRating, cur = sug && sug.value;
    if (ev.kind === 'season' && cur != null && Math.abs(cur - N(a.base)) >= move - 1e-9) return { use: null, lapsed: true, event: null, reason: 'Approval lapsed: the Oddable number moved from ' + (field === 'hcp' ? R.fmtIdx(a.base) : a.base) + ' to ' + (field === 'hcp' ? R.fmtIdx(cur) : cur) + '. The organizer approves it again.' };
    return { use: a[field], setBy: 'approved', by: a.by || '', cosign: a.cosign, event: a[field], at: a.at, approvedConfirmed: !!a.confirmed }; }
  return { use: null, event: null };
}
// handicapFor(userKey, {eventId, casual}) ->
//   { oddable: {index, rounds, ...}, confirmedIndex, rounds, confirmedRounds, makeup, flags, suggested: {value, confirmed, label, why}, vouched,
//     event, setBy ('tournament' | 'organizer' | 'approved' | null), by, cosign, use, needsSet, shown, why, ask, ... }
//   oddable.index = the Oddable Handicap Index from EVERY round played or logged in the app (H1). Always there.
//   confirmedIndex = the index over the counting confirmed rounds, when the confirmed rule is met (else null).
//   suggested = what the organizer is offered: the confirmed index when the rule is met, else the full index marked "unconfirmed".
//   use = {casual: true}: the full index. Otherwise ONLY the event's approved or set value; null without one (needsSet). A NULL use IS NEVER 0:
//   ratings.strokesOnHole / courseHandicap throw on it. The engine stops and asks the organizer.
//   shown = what every player in the event sees: "12.6 approved by Coach Mo · Oddable 12.6 (real results)".
const meRefOf = (userKey) => (/^guest:/.test(String(userKey || '')) ? '' : oppKeyFor(mkOf(userKey)));
const showLine = (u, fmt, real) => (u.use == null ? '' : fmt(u.use) + (u.setBy === 'approved' ? ' approved by ' : ' set by ') + (u.by || (u.setBy === 'tournament' ? 'the tournament' : 'the organizer')) + (u.cosign ? ' with ' + u.cosign : '') + ' · Oddable ' + (real == null ? 'none yet' : fmt(real)) + ' (real results)');
async function handicapFor(userKey, opts) {
  const golfRecs = (await recsOf(userKey)).filter((r) => r.sport === 'golf'), h = golfHcp(golfRecs, meRefOf(userKey), await confCtx(golfRecs, meRefOf(userKey))), o = opts || {}, ev = o.eventId ? await evRow(o.eventId) : null;
  const oddable = { index: h.index, rounds: h.rounds, need: h.need, selfLogged: h.selfLogged, confirmedOf: h.confirmedOf, of: h.of, text: h.text, cap: h.cap, label: HCP_LABEL, method: HCP_METHOD };
  const sug = h.suggested, u = o.casual === true ? { use: h.index, event: null } : evUse(ev, userKey, 'hcp', sug), needsSet = u.use == null && o.casual !== true, vouched = /^guest:/.test(String(userKey)) ? [] : vouchedBy(await vouchRow(), mkOf(userKey));
  const flags = (h.makeup.flags || []).slice(); if (!sug.confirmed && sug.value != null) flags.unshift('unconfirmed: ' + sug.why); if (vouched.length) flags.push('vouched by ' + vouched.join(', '));
  const why = needsSet ? (u.reason || (ev ? 'not approved for this event yet' : 'a money game plays only a number the organizer approved')) : '';
  return { oddable, confirmedIndex: h.moneyIndex, rounds: h.rounds, confirmedRounds: h.confirmedRounds, makeup: h.makeup, flags, suggested: sug, vouched, event: u.event != null ? u.event : null, setBy: u.setBy || null, by: u.by || undefined, cosign: u.cosign || undefined, lapsed: u.lapsed || undefined, use: u.use, needsSet,
    shown: showLine(u, R.fmtIdx, h.index) || undefined, why: why || undefined, unconfirmedWhy: sug.confirmed ? undefined : sug.why,
    ask: needsSet ? 'The organizer approves a number before the game: suggested ' + (sug.value == null ? 'none (no rounds yet: set one)' : R.fmtIdx(sug.value) + (sug.confirmed ? ' (confirmed)' : ' (UNCONFIRMED: ' + sug.why + ')')) + '.' : undefined,
    text: h.text, label: HCP_LABEL, method: HCP_METHOD, reason: u.use != null ? u.reason : why || undefined, at: u.at, locked: ev ? evLocked(ev) : undefined };
}
// ratingFor(userKey, sport = 'pickleball', {eventId, casual}): the same for the Oddable rating (one per named sport; 'golf' THROWS).
//   suggested = the confirmed rating when the rule is met, else the full rating (1500 with no games) marked unconfirmed. use = casual: the full rating;
//   otherwise the event's approved / set value, else null. seed = use, else the confirmed rating, else 1500 (for an engine's own seeding maths only).
async function ratingFor(userKey, sport, opts) {
  const sp = normSport(sport), recsAll = await recsOf(userKey), E = eloAll(recsAll, meRefOf(userKey), await confCtx(recsAll.filter(ELOSRC), meRefOf(userKey)))[sp], o = opts || {}, ev = o.eventId ? await evRow(o.eventId) : null;
  const oddable = { rating: E ? E.rating : null, matches: E ? E.matches : 0, text: E ? E.text : 'No games yet', label: RATING_LABEL }, cg = E ? E.confirmedGames : 0, cr = E ? E.seedRating : null, START = R.ELO.start;
  const sug = E ? E.suggested : { value: START, confirmed: false, label: 'unconfirmed', why: 'no games yet' }, u = o.casual === true ? { use: E ? E.rating : START, event: null } : evUse(ev, userKey, 'rating', sug), needsSet = u.use == null && o.casual !== true;
  const vouched = /^guest:/.test(String(userKey)) ? [] : vouchedBy(await vouchRow(), mkOf(userKey)), mk = E ? E.makeup : makeupOf([], 'game');
  const flags = (mk.flags || []).slice(); if (!sug.confirmed) flags.unshift('unconfirmed: ' + sug.why); if (vouched.length) flags.push('vouched by ' + vouched.join(', '));
  const why = needsSet ? (u.reason || (ev ? 'not approved for this event yet' : 'a money game plays only a number the organizer approved')) : '';
  return { sport: sp, name: E ? E.name : rateName(sp), oddable, confirmedRating: cr, confirmedGames: cg, makeup: mk, flags, suggested: sug, vouched, event: u.event != null ? u.event : null, setBy: u.setBy || null, by: u.by || undefined, cosign: u.cosign || undefined, lapsed: u.lapsed || undefined, use: u.use, seed: u.use != null ? u.use : cr != null ? cr : START, needsSet,
    shown: showLine(u, (v) => String(v), oddable.rating) || undefined, why: why || undefined, unconfirmedWhy: sug.confirmed ? undefined : sug.why,
    start: o.casual === true ? !E : u.use == null && cr == null, text: oddable.text, label: RATING_LABEL, reason: u.use != null ? u.reason : why || undefined, at: u.at, locked: ev ? evLocked(ev) : undefined };
}
// Course Handicap off THE handicap (tournament value when set) for one tee: strokes / net scores / flights.
// Course Handicap off THE handicap (tournament value when set) for one tee: strokes / net scores / flights.
async function courseHandicapFor(userKey, tee, opts) { const h = await handicapFor(userKey, opts), t = tee || {}; return Object.assign(h, { courseHandicap: h.use == null ? null : R.courseHandicap(h.use, Number(t.slope), Number(t.cr != null ? t.cr : t.rating), Number(t.par)) }); } // courseHandicap null = no handicap yet (needsSet): never play it as 0
// pairingProfile(accountId, sport) -> what the pairing / "Suggest partners" screen may use and show for one player (P1), respecting the sharing switch.
//   Always (the game itself needs it): { sport, use, needsSet | start, setBy } = the number to pair on (confirmed index / confirmed rating, the same as a money game).
//   Only when the player switched ON "Show my lifetime stats to my groups": show: true, text ("12.6 · 4 of 20 rounds confirmed"), oddable (full index / rating)
//   and lifetime { n, w, l, pct, rounds?, avg? } for that sport. With sharing OFF: show: false and none of those; the screen shows the name and the pairing only.
async function pairingProfile(accountId, sport) {
  const sp = sport == null || sport === 'golf' ? 'golf' : normSport(sport), guest = /^guest:/.test(String(accountId || '')), sh = guest ? null : await shareGet(mkOf(accountId)).catch(() => null), show = !!(sh && sh.e);
  const f = sp === 'golf' ? await handicapFor(accountId) : await ratingFor(accountId, sp), out = { sport: sp, shared: show, show, setBy: f.setBy };
  // Review 3, L11: with sharing OFF the number is handed over only as `pairOn` (for the pairing maths) with print: false. `use` (a number a screen may
  // print) is there only when the player switched sharing on. An engine must never print pairOn.
  out.pairOn = f.use != null ? f.use : sp === 'golf' ? f.suggested.value : f.seed; out.print = show; if (show) out.use = out.pairOn; // review 5: pairing (no money) uses the suggested number
  if (sp === 'golf') out.needsSet = out.pairOn == null; else out.start = f.start;
  if (!show) return out;
  const recs = (await recsOf(accountId)).filter((r) => (sp === 'golf' ? r.sport === 'golf' : rateKey(r) === sp || r.sport === sp)), n = node(recs), t = n.tot;
  out.text = f.text; out.oddable = sp === 'golf' ? { index: f.oddable.index, rounds: f.oddable.rounds } : { rating: f.oddable.rating, matches: f.oddable.matches };
  out.lifetime = { n: t.n, w: t.w, l: t.l, pct: t.pct }; if (n.golf) { out.lifetime.rounds = n.golf.rounds; out.lifetime.avg = n.golf.avg; } return out;
}
// Records of a tournament with a director's value for this player show "Set by tournament" (the record keeps the real Oddable value next to it).
// A player's tournaments are found from their records AND from the per-player index the override writes ('lock:evp:<player key>' { ev: [eventId] }), so the
// "Set by tournament" card on My handicap / My rating is filled the moment a director sets a number, before a shot is hit.
const EVP = (pk) => 'lock:evp:' + sha('oddable-evp|' + pk).slice(0, 32);
async function evIndexAdd(pk, id) { try { await rowMutate(EVP(pk), () => ({ ev: [] }), (d) => { d.ev = d.ev || []; if (d.ev.includes(id)) return { nochange: true }; d.ev = d.ev.concat(id).slice(-100); return {}; }); } catch (er) {} }
async function markEvents(userKey, recs) {
  const ids = new Set(), pk = pkeyOf(userKey); recs.forEach((r) => { const x = r.extra || {}; [x.eventId, r.contestId, String(r.id).split(':')[0]].forEach((v) => { if (okEid(v) && v !== 'golf' && v !== 'b' && v !== 'g' && v !== 'log') ids.add(v); }); });
  const ix = await D.S.dbGet(EVP(pk)).catch(() => null); ((ix && ix.data && ix.data.ev) || []).slice(-60).forEach((v) => { if (okEid(v)) ids.add(v); });
  const found = {}; let n = 0; for (const id of ids) { if (++n > 120) break; const ev = await evRow(id); if (!ev) continue; const s = ev.set && ev.set[pk]; if (s) found[id] = { title: clean(ev.title, 60), sport: ev.sport, hcp: s.hcp != null ? s.hcp : null, rating: s.rating != null ? s.rating : null, reason: s.reason || '', at: s.at, locked: evLocked(ev), lockAt: ev.lockAt || null,
    log: logMine(ev, pk).slice(-10).map((l) => ({ at: l.at, by: l.by, field: l.field, old: l.old, new: l.new, oddable: l.oddable, reason: l.reason })) }; }
  if (!Object.keys(found).length) return { recs, events: [] };
  const ctx = await confCtx(recs, meRefOf(userKey)), HH = golfHcp(recs.filter((r) => r.sport === 'golf'), meRefOf(userKey), ctx), H = HH.index, E = eloAll(recs, meRefOf(userKey), ctx), EK = (r) => E[rateKey(r)] || E[r.sport];
  const out = recs.map((r) => { const x = r.extra || {}, id = [x.eventId, r.contestId, String(r.id).split(':')[0]].find((v) => found[v]); if (!id) return r; const f = found[id];
    return Object.assign({}, r, { extra: Object.assign({}, x, { setBy: 'tournament', eventHcp: f.hcp, eventRating: f.rating, oddableHcp: H, oddableRating: EK(r) ? EK(r).rating : null }) }); });
  return { recs: out, events: Object.keys(found).map((id) => Object.assign({ eventId: id, oddableHcp: H, oddableText: HH.text, oddableRating: found[id].rating != null && E[found[id].sport] ? E[found[id].sport].rating : null }, found[id])) };
}

// ---------- registry ----------
const PROV = {};
function register(src, fn) { if (!SRC.includes(src)) throw new Error('stats.register: unknown src ' + src); if (typeof fn !== 'function') throw new Error('stats.register: ' + src + ' needs a function'); PROV[src] = fn; CACHE.clear(); }
register('bets', betsProvider); register('groups', groupsProvider); register('self', selfProvider);
// Engines merged later (calcutta.js, golf.js, events.js) export statsFor(userKey, {from, to}); collect() picks them up on its own unless the manager called
// register() for that src. A module that is not in this build is simply absent.
const MODS = { calcutta: './calcutta', golf: './golf', events: './events' }, AUTO = {};
function autoProv(src) { if (D.auto === false) return null; /* test switch (ported from the preview): do not pick up the engines that sit next to this file. Never set in the app. */ if (src in AUTO) return AUTO[src]; let f = null; try { const m = require(MODS[src]); if (m && typeof m.statsFor === 'function') f = (k, o) => m.statsFor(k, o); } catch (er) {} AUTO[src] = f; return f; }
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
// Every provider for one player: validated records + which providers failed (names only) + how many records were dropped as invalid.
async function collect(userKey, opts) {
  const o = opts || {}, recs = [], errors = [], seen = new Set(); let dropped = 0;
  for (const src of SRC) {
    const fn = PROV[src] || (MODS[src] ? autoProv(src) : null); if (!fn) continue; // a provider not registered yet (calcutta / golf / events) is simply absent
    let list; try { list = await withTimeout(Promise.resolve(fn(userKey, { from: o.from || '', to: o.to || '' })), 15000); } catch (er) { errors.push(src); if (!/timeout/.test(er && er.message)) console.error('stats provider ' + src + ':', er && er.message); continue; }
    (Array.isArray(list) ? list : []).forEach((r) => { const v = validate(r, src); if (!v.ok) { dropped++; return; } const k = src + '|' + v.rec.id; if (seen.has(k)) { dropped++; return; } seen.add(k); if ((o.from && v.rec.date < o.from) || (o.to && v.rec.date > o.to)) return; recs.push(v.rec); });
  }
  return { recs, errors, dropped };
}
async function statsFor(userKey, opts) { return (await collect(userKey, opts)).recs; }
async function cached(e) {
  const c = CACHE.get(e); if (c && D.now() - c.at < 60e3) return c.v;
  const v = await collect(e); CACHE.set(e, { at: D.now(), v }); if (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value); return v;
}
const sources = () => { const o = {}; SRC.forEach((s) => { o[s] = !!(PROV[s] || (MODS[s] && autoProv(s))); }); return o; };

// ---------- rate limits (in memory) ----------
const RL = new Map();
function limited(key, n, ms) { const t = D.now(), a = (RL.get(key) || []).filter((x) => t - x < ms); if (a.length >= n) { RL.set(key, a); return true; } a.push(t); RL.set(key, a); if (RL.size > 20000) { let k = 0; for (const x of RL.keys()) { RL.delete(x); if (++k > 5000) break; } } return false; }

// Everything /stats/me and /stats/list show for one player: the records (newest first) with the notes each one carries, the handicap, the ratings.
// The handicap and the ratings come from the SAME functions the engines call (golfHcp / eloAll -> ratings.js), over the records as collected; the
// newest-first sort is for the lists only.
const MAXREC = 3000, PAGE = 100; // /stats/me carries the newest 3,000 records; lists show 100 at a time ("Showing 100 of N", Show more) and page through /stats/list beyond that
async function meData(e, now, today) {
  const v = await cached(e), mev = await markEvents(e, v.recs).catch(() => ({ recs: v.recs, events: [] })), me = meRefOf(e), ctx = await confCtx(mev.recs, me, now), H = golfHcp(mev.recs, me, ctx), E = eloAll(mev.recs, me, ctx);
  const srow = await selfRow(e).catch(() => null), sd = (srow && srow.data) || {}, edits = {};
  const recs = mev.recs.map((r) => { const x = Object.assign({}, r.extra), note = hcpNote(r, H);
    if (note) x.hcpNote = note;
    if (r.kind === 'golf-round' || ELOSRC(r)) { const cm = r.kind === 'golf-round' ? H.conf[r.id] : ((E[rateKey(r)] || {}).conf || {})[r.id], one = cm || (() => { const c = confInfo(r, me); return { confirmed: c.ok, name: c.name, how: c.how, why: c.why }; })();
      x.confirmed = !!one.confirmed; if (one.confirmed) { x.confirmedHow = one.how; x.confirmedName = one.name; } else { if (one.why) x.confirmWhy = one.why; if (/^Recorded, not counted/.test(one.why || '')) x.confirmRecorded = one.name || 'Another player'; } if (isSelfLogged(r)) x.selfLogged = true; }
    if (ELOSRC(r)) x.rateKey = rateKey(r);
    if (r.src === 'self' && !x.claimed) { x.locked = now - N(x.ent || x.at) > LOCKMS; const h = (sd.edits || {})[r.id]; if (h && h.length) edits[r.id] = h.length > 10 ? [h[0]].concat(h.slice(-9)) : h; // the ORIGINAL is always shown, then the latest changes
      if (canConfirm(r)) { const lk = linkState(r, sd, now); x.canLink = lk.ok; if (!lk.ok) x.linkWhy = lk.why; else if (lk.live) x.linkLive = true; } }
    if (x.confirmedBy) x.confirmedBy = { name: x.confirmedBy.name, at: x.confirmedBy.at, as: x.confirmedBy.as }; // slot ids and confirmer refs stay on the server
    delete x.card; return Object.assign({}, r, { extra: x }); }).sort((a, c) => -order(a, c));
  return { recs, H, E, sd, edits, events: mev.events, errors: v.errors };
}

// ---------- routes (all POST JSON with x-token; /stats/owner also takes x-dash like /acct/dash) ----------
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (!path.startsWith('/stats')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  try {
    const b = await body(req), op = path.slice(7), now = D.now(), today = chiDay(now), ip = D.ip(req);
    if (op === 'owner') { // aggregates across players for the owner dashboard (owner PIN token, or owner phone + its dashboard second factor)
      if (!D.acct().ownerOk(req)) throw bad(403, 'Owner only');
      if (limited('own|' + ip, 30, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.');
      send(res, 200, await ownerView(today)); return true;
    }
    const e = D.acct().who(req); if (!e) throw bad(401, 'Sign in to see your stats');
    const mk = mkOf(e); await refNote(oppKeyFor(mk), e); // the confirmer directory (review 4): who an 'a:' reference is
    if (op === 'me' || op === 'list') {
      if (limited('r|' + mk, op === 'me' ? 120 : 240, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.');
      const M = await meData(e, now, today);
      if (op === 'list') { // review 3 (lists over 3,000 records): any list, filtered and paged by the server, with the full count. Totals always come from /stats/me (every record).
        const sp = String(b.sport || ''), kd = String(b.kind || ''), f = String(b.f || ''), per = PERIODS.includes(b.period) ? b.period : 'all', from = periodFrom(per, today), off = Math.max(0, Math.round(N(b.offset))), lim = Math.min(200, Math.max(1, Math.round(N(b.limit)) || PAGE));
        const all = M.recs.filter((r) => (!from || r.date >= from) && (!sp || r.sport === sp) && (!kd || r.kind === kd) && (f === 'money' ? !!r.money : f === 'res' ? !!(r.result || (r.extra && r.extra.adj)) : true));
        send(res, 200, { ok: true, total: all.length, offset: off, rows: all.slice(off, off + lim) }); return true;
      }
      const P = periods(M.recs, today), sh = await shareGet(mk).catch(() => null), sd = M.sd, si = await sinceOf(e, now), since = si.t;
      send(res, 200, { today, from: P.from, periods: P.periods, records: M.recs.slice(0, MAXREC), total: M.recs.length, more: Math.max(0, M.recs.length - MAXREC), page: PAGE, sources: sources(), errors: M.errors, share: !!sh, owner: !!D.acct().ownerOk(req),
        golfHcp: M.H, ratings: M.E, guests: (sd.guests || []).length, tournaments: M.events, edits: M.edits, gone: (sd.gone || []).slice(-50).reverse().map((g) => ({ at: g.at, was: g.was })), lockHours: LOCKMS / 36e5, since: si.known ? chiDay(since) : null, logFrom: si.known ? dayAdd(chiDay(since), -CONF.backDays) : null, confirmRules: { linkDays: CONF.linkDays, needBy: CONF.needBy, perBy: CONF.perBy, gamePerBy: CONF.gamePerBy, allPerBy: CONF.allPerBy, typedMax: CONF.typedMax, fullRounds: CONF.fullRounds, byAgeDays: CONF.byAgeDays, byActs: CONF.byActs, perDay: CONF.perDay, linkOpenDays: CONF.linkOpen / DAY }, myCourses: mcOut(sd),
        courseView: (await ownedCourses(e).catch(() => [])).length > 0 }); return true;
    }
    if (op === 'self/save' || op === 'self/delete' || op === 'share' || op.startsWith('guest/') || op.startsWith('confirm/')) {
      if (limited('w|' + mk, 60, 600e3) || limited('w|i|' + ip, 120, 600e3)) throw bad(429, 'Too many changes. Wait a few minutes.');
      send(res, 200, await writeOp(op, b, e, mk, now, ip)); return true;
    }
    if (op === 'mycourses' || op.startsWith('mycourses/')) { // MY COURSES (review 4, H2): recent courses + the home course, one store for stats and golf
      if (limited((op === 'mycourses' ? 'r|' : 'w|') + mk, op === 'mycourses' ? 120 : 60, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.');
      send(res, 200, op === 'mycourses' ? await myCourses(e) : op === 'mycourses/use' ? await myCourseUse(e, b.course) : op === 'mycourses/home' ? await myCourseHome(e, b.id) : op === 'mycourses/remove' ? await myCourseRemove(e, b.id) : (() => { throw bad(404, 'not found'); })()); return true;
    }
    if (op === 'courses' || op === 'coursedetail') { // OpenGolfAPI course search for Post a round and the course handicap calculator (server-side, cached)
      if (limited('cs|' + mk, 60, 600e3)) throw bad(429, 'Too many searches. Wait a few minutes.');
      const CS = require('./stats-courses');
      try { if (op === 'courses') { const q = clean(b.q, 60); if (q.length < 2 && !b.state) throw bad(400, 'Type at least 2 letters of the course name'); send(res, 200, Object.assign({ ok: true, courses: [] }, { api: await CS.search(q, b.state, b.offset) })); } // paged; when the live list is down: api.error + the labelled sample list (never a bare failure)
        else send(res, 200, { ok: true, course: await CS.detail(String(b.extId || '')) }); }
      catch (er) { if (er.status) throw er; throw bad(502, "Couldn't reach the course list. Try again."); }
      return true;
    }
    if (op === 'event/log') { if (limited('r|' + mk, 120, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.'); send(res, 200, await eventLog(e, b.eventId)); return true; } // E-H: the ONE tournament change log (director: all of it; a player: their own lines)
    if (op === 'event/setup') { if (limited('w|' + mk, 60, 600e3)) throw bad(429, 'Too many changes. Wait a few minutes.'); send(res, 200, await eventSetup(e, b.eventId, { title: b.title, sport: b.sport, lockAt: b.lockAt, reason: b.reason }, ROUTE)); return true; } // the director's own account only (e from the token)
    if (op === 'member') { send(res, 200, await memberView(e, mk, String(b.groupId || ''), String(b.pid || ''), now, today)); return true; }
    if (op === 'consent/get') { if (limited('r|' + mk, 120, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.'); const cid = okCid(b.courseId), own = cid ? await courseOwner(cid) : null; const m = own ? (((await cshare())[cid] || {}).m || {})[mk] : null;
      send(res, 200, { ok: true, ask: !!own, course: own ? { id: cid, name: own.name } : null, on: m ? !!m.on : null, text: own ? 'Share my handicap and rounds with ' + own.name + '?' : '' }); return true; }
    if (op === 'consent/list') { const cs = await cshare(), out = []; Object.keys(cs).forEach((cid) => { const m = (cs[cid].m || {})[mk]; if (m) out.push({ courseId: cid, name: clean(cs[cid].name, 60), on: !!m.on, at: m.at, via: (m.via || []).map((v) => ({ kind: v.kind, title: v.title })) }); }); send(res, 200, { ok: true, consents: out }); return true; }
    if (op === 'consent/set') { if (limited('w|' + mk, 60, 600e3)) throw bad(429, 'Too many changes. Wait a few minutes.'); send(res, 200, await consentOnJoin(e, b.courseId, null, !!b.on, ROUTE)); return true; }
    if (op.startsWith('course/')) {
      if (limited('c|' + mk, 120, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.');
      if (op === 'course/admin') { if (!D.acct().ownerOk(req)) throw bad(403, 'Owner only'); send(res, 200, await courseAdmin(b)); return true; }
      send(res, 200, await courseView(e, op, b, today)); return true;
    }
    send(res, 404, { error: 'not found' }); return true;
  } catch (er) { if (!er.status) console.error('stats:', er.message); send(res, er.status || 500, { error: er.status ? er.message : 'Stats error, try again' }); return true; }
}

// Every write. Self entries live in the caller's own row, so only that person can change or delete them.
async function writeOp(op, b, e, mk, now, ip) {
  if (op === 'share') { const on = await shareSet(e, !!b.on); CACHE.delete(e); return { ok: true, share: on }; }
  const row = await selfRow(e), sd = (row && row.data) || {}, gmap = {}; (sd.guests || []).forEach((g) => { gmap[g.gid] = g.name; });
  const orgName = (await nameOf(e)) || 'Organizer'; // the account's own name, never text from the caller
  const lockedMsg = 'Entries lock ' + LOCKMS / 36e5 + ' hours after they are logged. This one can no longer be changed or deleted.';
  const isLocked = (it) => now - N((it.extra || {}).ent || (it.extra || {}).at) > LOCKMS;
  if (op === 'self/delete') {
    const id = String(b.id || ''), old = (sd.items || []).find((x) => x.id === id);
    if (!old) { if (await claimedRemove(e, id, sd.claimed)) return { ok: true, claimed: true }; throw bad(404, 'Not found'); } // a result kept for me as a guest and claimed: mine to remove, any time
    if (isLocked(old)) throw bad(409, lockedMsg);
    const cfby = await selfMutate(e, (d) => { d.items = d.items.filter((x) => x.id !== id); d.gone = (d.gone || []).concat({ id, at: now, was: snapOf(old) }).slice(-200); if (d.cf) delete d.cf[id]; const c = d.cfby && d.cfby[id]; if (c) delete d.cfby[id]; return { c: c || null }; });
    for (const gid of mirrorGids(old)) await guestRemove(e, gid, 'gm' + id).catch(() => {});
    await mirrorDrop(cfby && cfby.c, id); // the confirmer's own copy of a confirmed match goes with it (review 3, M6)
    return { ok: true };
  }
  if (op === 'self/save') {
    const editId = b.id ? String(b.id) : '', old = editId ? (sd.items || []).find((x) => x.id === editId) : null; if (editId && !old) throw bad(404, 'Not found');
    if (old && (old.extra || {}).from) throw bad(400, 'This entry was logged by the other player. You can delete it, not change it.');
    if (old && isLocked(old)) throw bad(409, lockedMsg);
    if (!editId && (sd.items || []).length >= 2000) throw bad(400, 'You have 2000 entries. Delete some old ones first.');
    const si = await sinceOf(e, now), id = editId || 's' + rnd(10), rec = selfRecord(b.item, id, now, gmap, si.known ? chiDay(si.t) : null); // no known start (before the backfill): nothing is marked as dated before it
    if (old) { const ox = old.extra || {}; rec.extra.at = ox.at; rec.extra.rev = N(ox.rev) + 1; rec.extra.editedAt = now; } // an edit keeps its entry time (order + the 48-hour lock) and loses any confirmation; the revision is set again INSIDE the queued write below
    const v = validate(rec, 'self'); if (!v.ok) throw bad(400, 'Could not save (' + v.why + ')');
    if (rec.extra.guest) { if (editId) throw bad(400, 'A guest player\'s round is changed from their page'); const gr = Object.assign({}, v.rec, { id: 'gr' + rnd(10) }); delete gr.extra.guest; gr.extra.loggedBy = orgName; await guestAdd(e, rec.extra.guest, gr); return { ok: true, record: gr, guest: rec.extra.guest }; }
    const done = await selfMutate(e, (d) => { delete d.since; // review 5, H2: the stats row no longer keeps a start of its own
      if (editId) { const cur = d.items.find((x) => x.id === id); if (!cur) throw bad(404, 'Not found');
        v.rec.extra.rev = N((cur.extra || {}).rev) + 1; v.rec.extra.at = (cur.extra || {}).at; // review 3, L3: the counter is read where the write is queued, so 50 edits in a burst end at revision 50
        const hist = (d.edits = d.edits || {})[id] || []; hist.push({ at: now, was: snapOf(cur), rev: N((cur.extra || {}).rev) }); d.edits[id] = hist.length > 20 ? [hist[0]].concat(hist.slice(-19)) : hist; // review 3, L2: the ORIGINAL entry is never dropped
        if (d.cf) delete d.cf[id]; const c = d.cfby && d.cfby[id]; if (c) delete d.cfby[id]; d.items = d.items.map((x) => (x.id === id ? v.rec : x)); return { c: c || null }; }
      d.items.push(v.rec); return { c: null }; });
    if (editId) await mirrorDrop(done && done.c, id); // an edit drops the confirmation, so the confirmer's copy goes too
    const now2 = mirrorGids(v.rec), was = old ? mirrorGids(old) : [];
    for (const gid of was) if (!now2.includes(gid)) await guestRemove(e, gid, 'gm' + id).catch(() => {});
    const ex = v.rec.extra || {}; for (const gid of now2) await guestAdd(e, gid, mirrorOf(v.rec, ex.partnerGuest === gid ? 'partner' : 'opp', orgName)).catch(() => {});
    return { ok: true, record: v.rec };
  }
  if (op.startsWith('confirm/')) return confirmOp(op, b, e, mk, now, ip, sd);
  if (op === 'guest/create') {
    const name = clean(b.name, 30); if (name.length < 2) throw bad(400, 'Enter their name (2+ characters)'); if ((sd.guests || []).length >= 200) throw bad(400, 'You have 200 guest players');
    const gid = rnd(12), token = rnd(24); // 31^24 ~ 2^119 possible tokens: unguessable. Code gid-token fits the shared join link (pics/join.js: ?join=claim.<code>)
    await D.S.dbPut({ id: GROW(gid), salt: 'x', pinhash: 'x', data: { name, by: mk, th: sha('oddable-claim|' + token), claimedBy: null, items: [], at: now }, updated: 1 }, true);
    await selfMutate(e, (d) => { d.guests = (d.guests || []).concat({ gid, name, token, at: now }); });
    return { ok: true, guest: { gid, name, code: gid + '-' + token, link: claimLink(gid + '-' + token), claimed: false, n: 0 } };
  }
  if (op === 'guest/list' || op === 'guest/get') {
    const list = []; for (const g of (sd.guests || []).slice(0, 200)) { if (op === 'guest/get' && g.gid !== String(b.gid || '')) continue; let r = null; try { r = await D.S.dbGet(GROW(g.gid)); } catch (er) {} const gd = (r && r.data) || {};
      list.push({ gid: g.gid, name: g.name, code: g.gid + '-' + g.token, link: claimLink(g.gid + '-' + g.token), claimed: !!gd.claimedBy, n: (gd.items || []).length, items: op === 'guest/get' ? (gd.items || []).slice().sort((x, y) => -order(x, y)) : undefined }); }
    if (op === 'guest/get') { if (!list.length) throw bad(404, 'Not found'); return { ok: true, guest: list[0], tree: tree(list[0].items), hcp: golfHcp(list[0].items), ratings: eloAll(list[0].items) }; }
    return { ok: true, guests: list };
  }
  if (op === 'guest/remove-item') { if (!gmap[String(b.gid || '')]) throw bad(404, 'Not found'); await guestRemove(e, String(b.gid), String(b.id || '')); return { ok: true }; } // 409 once the guest has claimed (frozen)
  if (op === 'guest/claim') {
    const fail0 = linkFails(mk, ip), fail = () => fail0('That claim link is not valid'), m = /^(?:claim\.)?([a-z0-9]{12})-([a-z0-9]{20,40})$/.exec(String(b.code || '').trim());
    if (!m) throw fail(); const gid = m[1], want = sha('oddable-claim|' + m[2]);
    const g = await D.S.dbGet(GROW(gid)); if (!g || !g.data) throw fail();
    const x = Buffer.from(String(g.data.th || '')), y = Buffer.from(want); if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) throw fail();
    if (g.data.by === mk) throw bad(400, 'This is one of your own guest players. Send the link to them.');
    await rowMutate(GROW(gid), null, (d) => { if (d.claimedBy && d.claimedBy !== mk) throw bad(409, 'Someone already claimed these results'); if (d.claimedBy === mk) return { nochange: true }; d.claimedBy = mk; d.claimedAt = D.now(); return {}; });
    await selfMutate(e, (d) => { d.claimed = [...new Set((d.claimed || []).concat(gid))].slice(-50); });
    return { ok: true, name: clean(g.data.name, 30), n: (g.data.items || []).length };
  }
  throw bad(404, 'not found');
}
// ---------- "Confirmed by a player who was there" (MANAGER RULE, Nov 16 2026, review 3) ----------
// The player who logged a golf round or a match asks someone who PLAYED IN IT to confirm it.
//   WHO CAN CONFIRM: only an account recorded on the entry as having played. On a self-logged entry that is a player the logger picked from their own
//   players list when logging (golf "Played with", pickleball partner / opponent slots) AND who has claimed that player row with their own account. A
//   name that was only typed, a player who never claimed, and any other account holding the link are refused ("Only a player recorded on this entry...").
//   THE LINK: one live link per entry (pointer d.cf[entry id] in the logger's row, written inside the queued row write: five requests at once get the
//   same link; asking for a new one kills the old); it lives 7 days; it is only made for an entry that was logged within 7 days of the day it was played;
//   it works once (the confirmation is written on the ENTRY, in one queued write, only if it has none yet, and the pointer is removed with it).
//   AFTER: extra.confirmedBy = { name, ref, played: true, as: 'partner' | 'opp' | 'with', at }. The side comes from the slot on the entry, never from the
//   confirmer. A confirmed MATCH is also written into the confirmer's own stats from their side (id 'cm' + id); the logger's row remembers where
//   (d.cfby[id] = { e, mid }, server only), and deleting or editing the entry removes that copy again.
// Row 'lock:cfm:<cid>' { e, mk, rid, rev, th: sha256(token), at, by: confirmer member key | null, byAt }.
const CFM = (cid) => 'lock:cfm:' + cid, HOST = () => String(process.env.ODDABLE_APP_URL || 'https://steves-pics.onrender.com').replace(/\/+$/, '');
const snapOf = (r) => { const x = r.extra || {}; return { date: r.date, title: r.title, result: r.result, score: r.score != null ? r.score : null, toPar: r.toPar != null ? r.toPar : null, cr: x.cr != null ? x.cr : null, slope: x.slope != null ? x.slope : null, par: x.par != null ? x.par : null, holes: x.holes != null ? x.holes : null, scoreText: x.scoreText || '', opponent: r.opponent || '', confirmedBy: x.confirmedBy ? x.confirmedBy.name : null }; };
const canConfirm = (it) => { const x = (it && it.extra) || {}; return !!it && it.src !== 'bets' && !x.guest && !x.from && !x.loggedBy && !x.claimed && !x.solo && (it.kind === 'golf-round' || (it.kind === 'match' && !!it.result)); };
const oppKeyFor = (mk) => 'a:' + sha('oddable-opp|' + mk).slice(0, 12);
const acctRef = (userKey) => { const ref = oppKeyFor(mkOf(userKey)); refNote(ref, userKey); return ref; }; // files the reference in the confirmer directory (review 4), so stats can check the account's age and activity. Exported: how an engine names the confirming account in extra.card.by (a one-way reference, never the account id)
const slotsOf = (it) => { const x = (it && it.extra) || {}, out = []; (x.withGuests || []).forEach((g) => out.push({ gid: g, as: 'with' })); if (x.partnerGuest) out.push({ gid: x.partnerGuest, as: 'partner' }); (x.oppGuest || []).forEach((g) => { if (g) out.push({ gid: g, as: 'opp' }); }); return out.filter((o) => /^[a-z0-9]{6,24}$/.test(String(o.gid))).slice(0, 6); };
const daysApart = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / DAY);
// Can this entry get a confirm link at all? -> { ok, why, live }
function linkState(it, sd, now) {
  const x = (it && it.extra) || {};
  if (!canConfirm(it)) return { ok: false, why: 'Only your own golf rounds and matches against someone can be confirmed' };
  if (x.confirmedBy) return { ok: false, why: 'Already confirmed' };
  if (x.preAcct) return { ok: false, why: 'Dated before you joined Oddable: it counts as played and cannot be confirmed' };
  if (daysApart(chiDay(N(x.at) || now), it.date) > CONF.linkDays) return { ok: false, why: 'It was logged more than ' + CONF.linkDays + ' days after it was played, so it cannot be confirmed' };
  if (now - (N(x.at) || now) > CONF.linkOpen) return { ok: false, why: 'It was logged more than ' + CONF.linkOpen / DAY + ' days ago, so it can no longer be confirmed' }; // review 4, L1: no link re-made months later
  if (!slotsOf(it).length) return { ok: false, why: 'Nobody is recorded as playing in it. Edit it and pick who you played with from your players list: only a player recorded on the entry can confirm it' };
  const c = sd && sd.cf && sd.cf[it.id]; return { ok: true, why: '', live: !!(c && c.rev === N(x.rev) && now - N(c.at) < CONF.linkLife) };
}
// Is this account recorded on the entry as having played? -> 'partner' | 'opp' | 'with' | null. A slot counts only when it is one of the LOGGER's own
// player rows and this account has claimed it.
async function playedAs(it, loggerMk, mk) {
  for (const sl of slotsOf(it)) { const g = await D.S.dbGet(GROW(sl.gid)).catch(() => null), gd = g && g.data; if (gd && gd.by === loggerMk && gd.claimedBy && gd.claimedBy === mk) return sl.as; }
  return null;
}
async function mirrorDrop(c, rid) { // remove the confirmer's own copy of an entry that was deleted or changed
  if (!c || !c.e || !c.mid) return; try { await rowMutate(selfKey(c.e), null, (d) => { const n = (d.items || []).length; d.items = (d.items || []).filter((y) => !(y.id === c.mid && y.extra && y.extra.from === rid)); return d.items.length === n ? { nochange: true } : {}; }); } catch (er) {} CACHE.delete(c.e);
}
function linkFails(mk, ip) { const fk = 'cf|' + mk, fi = 'cf|i|' + ip, fails = (k) => (RL.get(k) || []).filter((x) => D.now() - x < 900e3).length;
  if (fails(fk) >= 10 || fails(fi) >= 20) throw bad(429, 'Too many wrong links. Wait 15 minutes.');
  return (msg) => { [fk, fi].forEach((k) => { const a = (RL.get(k) || []).filter((x) => D.now() - x < 900e3); a.push(D.now()); RL.set(k, a); }); return bad(403, msg); }; }
async function confirmOp(op, b, e, mk, now, ip, sd) {
  if (op === 'confirm/link') {
    const id = String(b.id || ''), it = (sd.items || []).find((x) => x.id === id); if (!it) throw bad(404, 'Not found');
    const x = it.extra || {}; if (x.confirmedBy) return { ok: true, confirmed: true, by: clean(x.confirmedBy.name, 30) };
    const st = linkState(it, sd, now); if (!st.ok) throw bad(400, st.why);
    const fresh = { cid: rnd(12), token: rnd(24), rev: N(x.rev), at: now }, wantNew = b.fresh === true;
    // ONE live link per entry: decided inside the queued write of the logger's row. A burst of requests all get the first one; `fresh: true` (or an
    // expired / out-of-date pointer) replaces the pointer, which kills the old link wherever it was sent.
    const got = await selfMutate(e, (d) => { const cur = d.items.find((y) => y.id === id); if (!cur) throw bad(404, 'Not found'); if ((cur.extra || {}).confirmedBy) return { nochange: true, v: { done: true } };
      d.cf = d.cf || {}; const c = d.cf[id], live = c && c.rev === N((cur.extra || {}).rev) && now - N(c.at) < CONF.linkLife;
      if (live && !wantNew) return { nochange: true, v: { c } };
      fresh.rev = N((cur.extra || {}).rev); d.cf[id] = fresh; const ks = Object.keys(d.cf); if (ks.length > 300) ks.slice(0, ks.length - 300).forEach((k) => delete d.cf[k]); return { c: fresh, made: true }; });
    if (got.done) return { ok: true, confirmed: true };
    const c = got.c; if (got.made) await D.S.dbPut({ id: CFM(c.cid), salt: 'x', pinhash: 'x', data: { e, mk, rid: id, rev: c.rev, th: sha('oddable-confirm|' + c.token), at: c.at, by: null }, updated: 1 }, true);
    const code = c.cid + '-' + c.token, names = slotsOf(it).map((sl) => sd.guests && (sd.guests.find((g) => g.gid === sl.gid) || {}).name).filter(Boolean);
    return { ok: true, confirmed: false, code, link: HOST() + '/?join=confirm.' + code, expires: c.at + CONF.linkLife, days: CONF.linkDays, who: names, text: 'Please confirm my ' + (it.kind === 'golf-round' ? 'round' : 'match') + ' on Oddable: ' + HOST() + '/?join=confirm.' + code };
  }
  if (op !== 'confirm/get' && op !== 'confirm/do') throw bad(404, 'not found');
  const fail = linkFails(mk, ip), m = /^(?:confirm\.)?([a-z0-9]{12})-([a-z0-9]{20,40})$/.exec(String(b.code || '').trim()); if (!m) throw fail('That confirm link is not valid');
  const cr = await D.S.dbGet(CFM(m[1])); if (!cr || !cr.data) throw fail('That confirm link is not valid');
  const xb = Buffer.from(String(cr.data.th || '')), yb = Buffer.from(sha('oddable-confirm|' + m[2])); if (xb.length !== yb.length || !crypto.timingSafeEqual(xb, yb)) throw fail('That confirm link is not valid');
  const c = cr.data, orow = await selfRow(c.e), od = (orow && orow.data) || {}, it = (od.items || []).find((x) => x.id === c.rid), x = (it && it.extra) || {}, myRef = oppKeyFor(mk);
  const DEAD = 'That entry was changed or deleted, or a newer link was made. Ask for a new link.', OLD = 'This confirm link has expired (links last ' + CONF.linkDays + ' days). Ask for a new one.';
  if (!it) throw bad(409, DEAD);
  const cb = x.confirmedBy || null, byMe = !!(cb && cb.ref === myRef), ptr = od.cf && od.cf[c.rid], liveNow = !!(ptr && ptr.cid === m[1] && N(x.rev) === N(c.rev));
  if (!cb && !liveNow) throw bad(409, DEAD);                 // not the entry's one live link (a newer one replaced it, or the entry changed)
  if (!cb && now - N(c.at) >= CONF.linkLife) throw bad(410, OLD); // 7 days
  const loggedBy = (await nameOf(c.e)) || 'Another player', mine = c.mk === mk, role = mine ? null : await playedAs(it, c.mk, mk);
  const NOTPLAYER = 'Only a player recorded on this entry can confirm it. Ask ' + loggedBy + ' to pick you as a player on the entry (you claim your player link from them once), then to send a new link.';
  const NOTPLAYER0 = 'Only a player recorded on this entry can confirm it. Ask the person who sent you the link to pick you as a player on the entry (you claim your player link from them once), then to send a new link.';
  if (op === 'confirm/get' && !mine && !role && !byMe) return { ok: true, mine: false, confirmed: !!cb, byMe: false, loggedBy: '', canConfirm: false, as: null, why: NOTPLAYER0, entry: null }; // review 4, L2: no name, course, date or score for someone who did not play
  if (op === 'confirm/get') return { ok: true, mine, confirmed: !!cb, byMe, loggedBy, canConfirm: !cb && !mine && !!role, as: role, why: cb || mine || role ? '' : NOTPLAYER, expires: N(c.at) + CONF.linkLife, shown: 'Your name and the date you joined Oddable are shown next to this ' + (it.kind === 'golf-round' ? 'round' : 'match') + ' to ' + loggedBy + ', to organizers of money games and to course directors.',
    entry: { kind: it.kind, sport: it.sport, title: it.title, date: it.date, result: it.result, score: it.score != null ? it.score : null, toPar: it.toPar != null ? it.toPar : null, scoreText: x.scoreText || '', course: x.course || '', tees: x.tees || '', fmt: x.fmt || '', holes: x.holes || null } };
  if (mine) throw bad(400, 'You cannot confirm your own entry. Send the link to someone who played with you.');
  if (cb) { if (byMe) return { ok: true, already: true }; throw bad(409, 'Someone already confirmed this entry'); }
  if (!role) throw bad(403, NOTPLAYER0);
  if (daysApart(chiDay(N(x.at) || now), it.date) > CONF.linkDays || x.preAcct) throw bad(409, 'This entry cannot be confirmed: it was logged more than ' + CONF.linkDays + ' days after it was played.');
  if (now - (N(x.at) || now) > CONF.linkOpen) throw bad(410, 'This entry was logged more than ' + CONF.linkOpen / DAY + ' days ago and can no longer be confirmed.');
  await refNote(myRef, e); await refNote(oppKeyFor(c.mk), c.e); // the confirmer directory: both accounts, so each one's age and activity can be checked
  const myName = (await nameOf(e)) || 'Another player', match = it.kind === 'match', singles = match && x.fmt !== 'doubles' && !(Array.isArray(x.opp) && x.opp.length > 1), mid = ('cm' + c.rid).slice(0, 80);
  const sp = match ? rateKey(it) : null, mineUse = match ? (await ratingFor(e, sp)).seed : null, theirUse = match ? (await ratingFor(c.e, sp)).seed : null; // seeding ratings BEFORE this match counts
  // THE single use: one queued write on the ENTRY's row. It goes through only while the entry is unchanged, unconfirmed and this is still its live link.
  await rowMutate(selfKey(c.e), null, (d) => { const cur = (d.items || []).find((y) => y.id === c.rid); if (!cur || N((cur.extra || {}).rev) !== N(c.rev)) throw bad(409, DEAD);
    const had = (cur.extra || {}).confirmedBy; if (had) { if (had.ref === myRef) return { nochange: true, v: {} }; throw bad(409, 'Someone already confirmed this entry'); }
    const p2 = d.cf && d.cf[c.rid]; if (!p2 || p2.cid !== m[1]) throw bad(409, DEAD);
    cur.extra = Object.assign({}, cur.extra, { confirmedBy: { name: myName, ref: myRef, played: true, as: role, at: now } }, match ? { oppKey: myRef } : {}, singles ? { oppRating: mineUse } : {});
    delete d.cf[c.rid]; if (match) { d.cfby = d.cfby || {}; d.cfby[c.rid] = { e, mid }; const ks = Object.keys(d.cfby); if (ks.length > 500) ks.slice(0, ks.length - 500).forEach((k) => delete d.cfby[k]); } return {}; });
  CACHE.delete(c.e);
  await rowMutate(CFM(m[1]), null, (d) => { d.by = mk; d.byAt = now; return {}; }).catch(() => {});
  if (match) { const flip = (r0) => (r0 === 'W' ? 'L' : r0 === 'L' ? 'W' : r0), mr = x.type === 'other' ? { src: 'self', id: mid, date: it.date, sport: it.sport, kind: 'match', title: (clean(x.ttl, 40) || SPORTN[it.sport] || 'Game') + ' vs ' + loggedBy, result: flip(it.result), opponent: loggedBy, verified: false, extra: { type: 'other', at: x.at, ttl: x.ttl, scoreText: x.scoreText || '', opp: [loggedBy] } }
      : mirrorOf(it, role === 'partner' ? 'partner' : 'opp', loggedBy); // the side is the slot the logger put this player in
    Object.assign(mr, { id: mid }); Object.assign(mr.extra, { ent: now, from: c.rid, loggedBy, confirmedBy: { name: loggedBy, ref: oppKeyFor(c.mk), played: true, as: role, at: now }, oppKey: oppKeyFor(c.mk) }, singles ? { oppRating: theirUse } : {});
    const v = validate(mr, 'self'); if (v.ok) await selfMutate(e, (d) => { if (d.items.some((y) => y.id === mid) || d.items.length >= 2000) return; d.items.push(v.rec); }); }
  return { ok: true, confirmed: true, loggedBy, as: role };
}
const claimLink = (code) => HOST() + '/?join=claim.' + code; // review item 23: the app address comes from ODDABLE_APP_URL when set (the preview), else the live app
const mirrorGids = (rec) => { const ex = (rec && rec.extra) || {}; if (ex.type !== 'pickleball') return []; return [...new Set([ex.partnerGuest].concat(ex.oppGuest || []).filter(Boolean))]; };

// One member's stats inside one group, for another member of that group (or themselves): that group's contest only; other members' bets only after
// their games kick off (groups.js marks vis, same rule as /groups/player); lifetime totals only if that member switched sharing ON.
// G16 (owner, Nov 16 2026: "If it is a group play once they add their bet. Always upload. That's locked."): group bets come from SERVER records only.
// When groups.js exports memberStats(viewerKey, groupId, pid) (the G16 build: every group bet saved and locked on the server the moment it is added) it is
// the ONLY source: { name, me, group: {id, name, started}, contest (contract record), records (contract records of that member's group bets, already
// hidden-until-kickoff for other viewers), hidden (count), memberKey (server only, for the sharing switch) }. Nothing from the phone's own bet list is used.
// Without it (stage-1 build) the adapter below reads the stage-1 group ledger.
async function memberViewG16(G, e, gid, pid, today) {
  const m = await G.memberStats(e, gid, pid); if (!m) throw bad(404, 'Group not found');
  const recs = (Array.isArray(m.records) ? m.records : []).map((r) => validate(Object.assign({}, r, { src: 'groups', groupId: gid, extra: Object.assign({}, r.extra, { server: true }) }), 'groups')).filter((v) => v.ok).map((v) => v.rec).sort((a, c) => -order(a, c));
  let lifetime = null, shared = false;
  if (!m.me && m.memberKey) { const sh = await shareGet(String(m.memberKey)).catch(() => null); if (sh && sh.e) { shared = true; const v = await cached(sh.e), P = periods(v.recs, today); lifetime = {}; PERIODS.forEach((p) => { lifetime[p] = publicTree(P.periods[p]); }); } }
  const ct = m.contest ? validate(Object.assign({}, m.contest, { src: 'groups' }), 'groups') : null;
  return { name: clean(m.name, 30), me: !!m.me, group: { id: gid, name: clean(m.group && m.group.name, 60), started: !!(m.group && m.group.started) }, contest: ct && ct.ok ? ct.rec : null, group_tree: tree(recs), records: recs.slice(0, 300), hidden: Math.max(0, Math.round(N(m.hidden))), shared, lifetime, from: Object.fromEntries(PERIODS.map((p) => [p, periodFrom(p, today)])), source: 'server' };
}
async function memberView(e, mk, gid, pid, now, today) {
  const G = D.groups(); if (G && typeof G.memberStats === 'function') return memberViewG16(G, e, gid, pid, today);
  const gs = await groupsRow(), g = gs[gid];
  if (!g || !(g.members || []).some((m) => m.mk === mk)) throw bad(404, 'Group not found');
  const m = g.members.find((x) => x.pid === pid); if (!m) throw bad(404, 'Not a member');
  const mine = m.mk === mk, contest = await contestRec(g, m, now);
  let list = []; if (typeof G.memberBets === 'function' && now >= g.start) list = (await G.memberBets(g))[m.pid] || [];
  const okList = list.filter((x) => x.ok), shown = okList.filter((x) => mine || x.vis), hidden = okList.length - shown.length;
  const RES = { won: 'W', lost: 'L', push: 'P' };
  const recs = shown.map((x) => { const v = validate({ src: 'groups', id: 'g:' + g.id + ':' + String(x.id).slice(0, 40), date: x.d, sport: gSport(g), kind: 'bet', groupId: g.id, contestId: g.id, title: x.what, result: RES[x.res] || null, stake: x.cs, pl: x.res ? x.pl : undefined, units: x.res ? x.u : undefined, verified: !!x.ver, extra: { type: x.type, at: x.kick || 0 } }, 'groups'); return v.ok ? v.rec : null; }).filter(Boolean).sort((a, c) => -order(a, c));
  let name = m.name; try { if (typeof G.standings === 'function' && now >= g.start) { const s = await G.standings(g, 'season'); const r0 = s.rows.find((x) => x.pid === m.pid); if (r0) name = r0.name; } } catch (er) {}
  let lifetime = null, shared = false;
  if (!mine) { const sh = await shareGet(m.mk).catch(() => null); if (sh && sh.e) { shared = true; const v = await cached(sh.e), P = periods(v.recs, today); lifetime = {}; PERIODS.forEach((p) => { lifetime[p] = publicTree(P.periods[p]); }); } }
  return { name: clean(name, 30), me: mine, group: { id: g.id, name: clean(g.name, 60), started: now >= g.start }, contest: validate(contest, 'groups').rec || null, group_tree: tree(recs), records: recs.slice(0, 300), hidden, shared, lifetime, from: Object.fromEntries(PERIODS.map((p) => [p, periodFrom(p, today)])) };
}

// Owner view: every player's totals by period and sport (bets + their own logged play). Names as the owner typed them, else a short tag. Cached 5 minutes.
let OWN = { at: 0, v: null };
async function ownerView(today) {
  if (OWN.v && D.now() - OWN.at < 5 * 6e4 && OWN.v.today === today) return OWN.v;
  const A = D.acct(), ids = (await D.S.dbIds()).slice(0, 500), names = await A.namesGet().catch(() => ({})), users = [];
  for (const id of ids) {
    let recs = []; try { const row = await D.S.dbGet(id); recs = betRecords(row && row.data); } catch (er) {}
    try { const e = A.phoneEmail(id), s = await D.S.dbGet(selfKey(e)); ((s && s.data && s.data.items) || []).forEach((x) => { const v = validate(Object.assign({}, x, { verified: false }), 'self'); if (v.ok) recs.push(v.rec); }); } catch (er) {}
    if (!recs.length) continue;
    const per = {}; PERIODS.forEach((p) => { const f = periodFrom(p, today), l = recs.filter((r) => !f || r.date >= f), bs = {}; l.forEach((r) => { (bs[r.sport] = bs[r.sport] || []).push(r); }); per[p] = { tot: tot(l), bySport: Object.fromEntries(Object.keys(bs).map((s) => [s, tot(bs[s])])) }; });
    const k = String(id).slice(0, 8); users.push({ k, name: (A.isOwnerPhone(A.phoneEmail(id)) ? A.ownerName() : clean(names[k], 30)) || '', tag: String(id).slice(0, 4), periods: per });
  }
  OWN = { at: D.now(), v: { today, from: Object.fromEntries(PERIODS.map((p) => [p, periodFrom(p, today)])), users } }; return OWN.v;
}

module.exports = { handle, register, statsFor, handicapFor, ratingFor, courseHandicapFor, pairingProfile, courseMembers, isConfirmed, confInfo, confirmMarks, confCtx, makeupOf, linkRef, acctRef, myCourses, myCourseUse, myCourseHome, CONF, EVT, rateKey, acctSince, moneyOf, playState, nameOf, eventSetup, eventOverride, eventLog, eventApprove, eventApproveAll, eventReview, vouch, unvouch, vouchLog, sinceOf, backfilled, ownPlay, BFROW, HCP_LABEL, HCP_METHOD, RATING_LABEL, guestAdd, guestRemove, consentOnJoin, coursePrefill, ownedCourses, golfHcp, eloAll, validate, tot, tree, periods, periodFrom, publicTree, betRecords, selfRecord, chiDay, mkOf, selfKey, SRC, SPORTS, KINDS, _deps: D,
  // Tests: _isolate() makes this module ignore whatever other engines sit next to it in a merged build (auto providers off, Enterprise / course-owner
  // stand-ins on), so the stats suite checks stats alone and runs the same on the stats branch and on the merged preview.
  _isolate: () => { Object.keys(MODS).forEach((k) => { AUTO[k] = null; }); D.limits = () => LIMSTAND; D.golf = () => GOLFSTAND; },
  _reset: () => { VOC = { at: 0, v: null }; BF = { at: 0, v: null }; RL.clear(); CACHE.clear(); QUEUE.clear(); REFS.clear(); BYC.clear(); CREFC = { at: 0, v: {} }; IDS.map = null; NMC = { at: 0, v: {} }; OWN = { at: 0, v: null }; } };
