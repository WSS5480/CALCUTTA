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
const DAY = 864e5, SHARE = 'lock:statshare';
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
function moneyOf(o) { // {entry, payout, net} from the contract's money fields; null when the record carries no money at all
  const has = (k) => o[k] != null, entry = has('spent') ? o.spent : has('stake') ? o.stake : null;
  const net = has('pl') ? o.pl : has('won') ? r2(N(o.won) - N(entry)) : o.result === 'L' && entry != null ? -entry : o.result === 'P' && entry != null ? 0 : null;
  const payout = has('won') ? o.won : entry != null && net != null ? r2(Math.max(0, entry + net)) : null;
  return entry != null || net != null || payout != null ? { entry, payout, net } : null;
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
  { const m = moneyOf(o); if (m) o.money = m; }
  // A place-only record (a finish with no W/L and no money, e.g. 3rd of 12 in a tournament) is marked so screens show the finish, never "Open".
  if (o.place && o.result == null && !o.money) o.placeOnly = true;
  if (r.opponent != null) { const v = clean(r.opponent, 60); if (v) o.opponent = v; }
  if (r.extra != null) { if (typeof r.extra !== 'object' || Array.isArray(r.extra)) return no('extra'); const s = JSON.stringify(r.extra); if (s.length > 4000) return no('extra too big'); o.extra = JSON.parse(s); }
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
const order = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : N(a.extra && a.extra.at) - N(b.extra && b.extra.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
// Totals for a list. Derived records (Groups contests built from the same My Bets bets) never add to a total that also holds the records they come from:
// if the list holds My Bets records, derived ones are left out; a list without them (e.g. the 'contest' game type) is totalled as is.
function tot(list) {
  const base = list.some((r) => r.src === 'bets') ? list.filter((r) => !isDerived(r)) : list; // derived contests are left out only next to the My Bets bets they are built from (S-ALL: a game-type total always shows its plays)
  const t = { n: 0, w: 0, l: 0, p: 0, t: 0, open: 0, solo: 0, fin: 0, firsts: 0, staked: 0, pl: 0, units: 0, money: false };
  let best = null, worst = null; const st = [];
  base.forEach((r) => {
    const adj = r.extra && r.extra.adj;
    if (adj) { const w = N(adj.w), l = N(adj.l), p = N(adj.p); t.n += w + l + p; t.w += w; t.l += l; t.p += p; t.pl += N(r.pl); t.staked += N(r.stake); if (r.pl != null) t.money = true; return; } // deleted bets kept from the daily log (bets provider)
    t.n++;
    const live = !!(r.extra && (r.extra.live || (r.kind === 'contest' && r.extra.started && !r.extra.ended)));
    if (r.result == null && !live && (r.place || r.kind === 'calcutta')) { // a finished place (events, bracket pick'em, golf pools) or a settled Calcutta buy: a finish, not W-L, not open
      t.fin++; if (r.place && r.place.n === 1) t.firsts++;
      const mo = moneyOf(r) || {}, pl = mo.net != null ? mo.net : r.kind === 'calcutta' && r.spent != null ? -N(r.spent) : null, st = mo.entry != null ? mo.entry : null;
      if (pl != null) { t.pl += pl; t.money = true; } if (st != null) t.staked += st; if (r.units != null) t.units += r.units; return;
    }
    if (r.result == null && r.kind === 'contest') { t.open++; if (r.pl != null) { t.pl += r.pl; t.money = true; } if (r.stake != null) t.staked += r.stake; if (r.units != null) t.units += r.units; return; } // a running contest: money so far, no W/L yet
    if (r.result == null) { if (r.kind === 'golf-round' || (r.extra && r.extra.solo)) t.solo++; else t.open++; return; } // a golf round or a one-player game has no W/L: it is played, not open
    if (r.result === 'W') t.w++; else if (r.result === 'L') t.l++; else if (r.result === 'P') t.p++; else t.t++;
    const mo = moneyOf(r) || {}; if (mo.entry != null) t.staked += mo.entry; if (mo.net != null) { t.pl += mo.net; t.money = true; } if (r.units != null) t.units += r.units;
    if (r.pl != null) { if (!best || r.pl > best.pl) best = r; if (!worst || r.pl < worst.pl) worst = r; }
    if (r.result === 'W' || r.result === 'L') st.push(r);
  });
  t.staked = r2(t.staked); t.pl = r2(t.pl); t.units = r2(t.units);
  t.pct = t.w + t.l ? r1(t.w / (t.w + t.l) * 100) : null; // pushes and ties left out, like My Bets
  t.roi = t.staked > 0 ? r1(t.pl / t.staked * 100) : null;
  const pick = (r) => (r ? { id: r.id, title: r.title, date: r.date, pl: r.pl, src: r.src } : null);
  t.best = pick(best); t.worst = pick(worst && worst !== best ? worst : null);
  st.sort(order); let cur = 0, curR = '', lw = 0, ll = 0, run = 0, runR = '';
  st.forEach((r) => { if (r.result === runR) run++; else { runR = r.result; run = 1; } if (runR === 'W') lw = Math.max(lw, run); else ll = Math.max(ll, run); });
  if (st.length) { curR = st[st.length - 1].result; for (let i = st.length - 1; i >= 0 && st[i].result === curR; i--) cur++; }
  t.streak = cur ? curR + cur : ''; t.longW = lw; t.longL = ll;
  return t;
}
function calcutta(list) {
  const c = list.filter((r) => r.kind === 'calcutta'); if (!c.length) return null;
  let spent = 0, won = 0, best = null; c.forEach((r) => { spent += N(r.spent); won += N(r.won); const net = N(r.won) - N(r.spent); if (!best || net > best.net) best = { id: r.id, title: r.title, date: r.date, net: r2(net), spent: N(r.spent), won: N(r.won) }; });
  return { teams: c.length, spent: r2(spent), won: r2(won), net: r2(won - spent), roi: spent > 0 ? r1((won - spent) / spent * 100) : null, best };
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
function golfHcp(recs) { // own, complete 18-hole rounds with Course Rating + Slope
  const rounds = recs.filter((r) => ownRound(r) && holesOf(r) === 18 && r.extra && Number.isFinite(crOf(r.extra)) && Number.isFinite(slopeOf(r.extra)))
    .map((r) => { const x = r.extra, pars = Array.isArray(x.pars) ? x.pars : null; return { id: r.id, date: r.date, total: r.score, cr: crOf(x), slope: slopeOf(x), par: Number(x.par) || (pars && pars.length === 18 ? pars.reduce((a, b) => a + b, 0) : r.toPar != null ? r.score - r.toPar : 72), strokes: x.strokes || x.holeScores, pars, si: x.si || x.hcpIdx, course: clean(x.course, 40), tees: clean(x.tees, 20) }; });
  const h = R.handicap(rounds); h.label = HCP_LABEL; h.method = HCP_METHOD; h.official = false;
  h.missing = recs.filter((r) => ownRound(r) && holesOf(r) === 18 && !(r.extra && Number.isFinite(crOf(r.extra)) && Number.isFinite(slopeOf(r.extra)))).length; // rounds without rating/slope cannot count
  h.nine = recs.filter((r) => r.kind === 'golf-round' && !(r.extra && r.extra.side) && holesOf(r) === 9).length; h.team = recs.filter((r) => r.kind === 'golf-round' && teamFmt(r)).length;
  const diffTitle = {}; recs.forEach((r) => { diffTitle[r.id] = r.title; }); h.diffs.forEach((d) => { d.title = diffTitle[d.id] || ''; });
  return h;
}
function eloAll(recs) { const by = {}; recs.filter((r) => r.kind === 'match' && r.sport !== 'golf' && (r.src === 'self' || r.src === 'events') && r.result) /* golf heads-up matches use the handicap, not Elo */.forEach((r) => { (by[r.sport] = by[r.sport] || []).push(r); }); const o = {}; Object.keys(by).forEach((s) => { o[s] = Object.assign(R.eloFor(by[s]), { label: RATING_LABEL }); }); return o; }
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
const profitMult = (b) => { if (N(b.mult) > 1) return N(b.mult) - 1; let o = N(b.odds) || -110; if (Math.abs(o) < 100) o = -110; return o > 0 ? o / 100 : 100 / -o; };
function betPL(b, r) { // the P/L the app itself stored (finPL) wins, like the owner dashboard; a Kalshi sale is proceeds minus cost
  const st = N(b.stake);
  if (b.cash !== undefined && b.cash !== null && st) return r2(N(b.cash) - st);
  if (b.fin && b.finPL !== null && b.finPL !== '' && Number.isFinite(Number(b.finPL))) return Number(b.finPL);
  return r === 'W' ? st * profitMult(b) : r === 'L' ? -st : 0;
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
    if (res) { const pl = betPL(b, res); rec.pl = r2(pl); rec.units = res === 'W' ? r3(st > 0 ? pl / st : profitMult(b)) : res === 'L' ? -1 : 0; }
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
    out.push({ src: 'bets', id: 'log:' + k, date: k, sport: one, kind: 'bet', title: 'Deleted bets (kept from your daily log)', result: null, verified: false, pl, stake: r2(Math.max(0, N(o.risk) - p.stake)), extra: { adj, fromLog: true } });
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
  if (!st || typeof G.standings !== 'function') return rec;
  const s = await G.standings(g, 'season'), row = s.rows.find((x) => x.pid === m.pid); if (!row) return rec;
  const t = row.t; rec.place = { n: row.place, of: s.rows.length }; rec.stake = r2(N(t.stake)); rec.pl = r2(N(t.win)); rec.units = r3(N(t.units));
  Object.assign(rec.extra, { w: t.w, l: t.l, p: t.p, open: t.open, val: t.val });
  if (ended) rec.result = row.place === 1 ? 'W' : 'L'; // a finished group: 1st place = a win
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
function selfRecord(inp, id, now, guests) {
  const b = inp || {}, today = chiDay(now), date = String(b.date || ''), G = guests || {};
  if (!okDay(date)) throw bad(400, 'Pick a date'); if (date > today) throw bad(400, 'The date cannot be in the future'); if (date < '2000-01-01') throw bad(400, 'That date is too old');
  const notes = clean(b.notes, 200), at = now, voice = !!b.voice;
  if (b.type === 'golf') {
    const course = clean(b.course, 40); if (course.length < 2) throw bad(400, 'Enter the course');
    const tees = clean(b.tees, 20), holes = Number(b.holes) === 9 ? 9 : Number(b.holes) === 18 || b.holes == null || b.holes === '' ? 18 : null; if (!holes) throw bad(400, 'Holes: 9 or 18');
    const pars = holeList(b.pars, holes, 3, 6, 'Par'), si = holeList(b.si, holes, 1, holes, 'Stroke index');
    if (si && new Set(si).size !== holes) throw bad(400, 'Stroke index: each number 1 to ' + holes + ' once');
    const par = pars ? pars.reduce((x, y) => x + y, 0) : int(b.par == null || b.par === '' ? (holes === 18 ? 72 : 36) : b.par, holes === 18 ? 54 : 27, holes === 18 ? 80 : 40, 'Par must be ' + (holes === 18 ? '54 to 80' : '27 to 40'));
    const cr = numOpt(b.cr, holes === 18 ? 50 : 25, holes === 18 ? 85 : 43, 'Course Rating looks wrong (' + (holes === 18 ? '50 to 85' : '25 to 43') + ')'), slope = b.slope == null || b.slope === '' ? null : int(b.slope, 55, 155, 'Slope Rating must be 55 to 155');
    if ((cr == null) !== (slope == null)) throw bad(400, 'Enter both Course Rating and Slope Rating (or neither)');
    let strokes = null, sum = 0, all = true;
    if (Array.isArray(b.strokes) && b.strokes.some((x) => x != null && x !== '')) {
      if (b.strokes.length !== holes) throw bad(400, 'Enter ' + holes + ' holes'); strokes = b.strokes.map((x, i) => { const v = int(x, 1, 20, 'Hole ' + (i + 1) + ': 1 to 20 strokes', true); if (v == null) all = false; else sum += v; return v; });
    } else all = false;
    let total = int(b.total, holes === 18 ? 40 : 20, holes === 18 ? 200 : 100, 'Total score must be ' + (holes === 18 ? '40 to 200' : '20 to 100'), all);
    if (all) { if (total != null && total !== sum) throw bad(400, 'The total (' + total + ') does not match the holes (' + sum + ')'); total = sum; }
    if (total == null) throw bad(400, 'Enter the total score');
    const putts = int(b.putts, 0, holes * 6, 'Putts: 0 to ' + holes * 6, true), fw = int(b.fw, 0, 18, 'Fairways hit: 0 to 18', true), fwOf = int(b.fwOf, 0, 18, 'Fairways: 0 to 18', true), gir = int(b.gir, 0, holes, 'Greens in regulation: 0 to ' + holes, true);
    if (fw != null && fwOf != null && fw > fwOf) throw bad(400, 'Fairways hit cannot be more than fairways');
    const format = ['individual', 'scramble', 'bestball'].includes(b.format) ? b.format : 'individual', team = format !== 'individual' ? clean(b.team, 30) : '', mates = format !== 'individual' ? (Array.isArray(b.mates) ? b.mates : []).map((x) => clean(x, 30)).filter(Boolean).slice(0, 5) : [];
    const who = b.guest ? String(b.guest) : ''; if (who && !G[who]) throw bad(404, 'That guest player is not on your list');
    return { src: 'self', id, date, sport: 'golf', kind: 'golf-round', title: (format === 'scramble' ? 'Scramble · ' : format === 'bestball' ? 'Best ball · ' : '') + course + (tees ? ' · ' + tees + ' tees' : ''), result: null, score: total, toPar: total - par, verified: false,
      extra: { type: 'golf', at, course, courseId: okCid(b.courseId) || undefined, tees, holes, par, pars, si, cr, slope, strokes, putts, fw, fwOf, gir, notes, format, team, mates, guest: who || undefined, voice } };
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
    const dupr = numOpt(b.dupr, 1, 8.5, 'DUPR must be 1.000 to 8.500', 3);
    return { src: 'self', id, date, sport: 'pickleball', kind: 'match', title: (event || (fmt === 'doubles' ? 'Doubles' : 'Singles')) + ' vs ' + opponent, result: gw > gl ? 'W' : gw < gl ? 'L' : 'T', opponent, verified: false,
      extra: { type: 'pickleball', at, fmt, partner: partner ? partner.name : '', partnerGuest: partner && partner.gid, opp: opp.map((x) => x.name), oppGuest: opp.map((x) => x.gid || null), games, event, notes, scoreText: games.map((x) => x[0] + '-' + x[1]).join(', '), dupr, voice } };
  }
  if (b.type === 'other') {
    const sport = String(b.sport || ''); if (!SPORTS.includes(sport)) throw bad(400, 'Pick the sport');
    const solo = b.result === 'solo', result = ['W', 'L', 'T'].includes(b.result) ? b.result : solo ? null : undefined; if (result === undefined) throw bad(400, 'Won, lost, tied, or a one-player game?');
    const kind = b.kind === 'event' ? 'event' : 'match', opponent = solo ? '' : clean(b.opponent, 40), scoreText = clean(b.score, 30), title = clean(b.title, 40) || SPORTN[sport] + (solo ? ' (solo)' : opponent ? ' vs ' + opponent : '');
    const scoreNum = solo && /^-?\d+(\.\d+)?$/.test(scoreText) ? Number(scoreText) : null;
    const rec = { src: 'self', id, date, sport, kind, title, result, verified: false, extra: { type: 'other', at, scoreText, notes, ttl: clean(b.title, 40), solo, voice } };
    if (opponent) rec.opponent = opponent; if (scoreNum != null && Math.abs(scoreNum) < 1e6) rec.score = scoreNum;
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
async function rowMutate(id, init, fn) { // generic conditional write (same pattern as groups.js mutate)
  for (let i = 0; i < 6; i++) {
    let row = await D.S.dbGet(id);
    if (!row) { if (!init) throw bad(404, 'Not found'); await D.S.dbPut({ id, salt: 'x', pinhash: 'x', data: init(), updated: 1 }, true); row = await D.S.dbGet(id); if (!row) continue; }
    const data = clone(row.data || {}), out = fn(data);
    if (out && out.nochange) return out.v;
    if (await D.S.dbPatchIf(id, row.updated, data, Math.max(D.now(), Number(row.updated || 0) + 1))) return out;
  }
  throw bad(409, 'Busy, try again');
}
// Exported for the golf / events engines: give a guest player a result (the engine's organizer must own the guest).
async function guestAdd(orgE, gid, rec) { const v = validate(Object.assign({}, rec, { src: 'self', verified: false }), 'self'); if (!v.ok) throw bad(400, 'Bad record (' + v.why + ')'); const mk = mkOf(orgE);
  await rowMutate(GROW(gid), null, (d) => { if (d.by !== mk) throw bad(403, 'Not your guest player'); d.items = (d.items || []).filter((x) => x.id !== v.rec.id); if (d.items.length >= 2000) throw bad(400, 'Too many results'); d.items.push(v.rec); return {}; }); CACHE.clear(); return v.rec; }
async function guestRemove(orgE, gid, recId) { const mk = mkOf(orgE); await rowMutate(GROW(gid), null, (d) => { if (d.by !== mk) throw bad(403, 'Not your guest player'); const n = (d.items || []).length; d.items = (d.items || []).filter((x) => x.id !== recId); return d.items.length === n ? { nochange: true } : {}; }).catch((er) => { if (er.status !== 404) throw er; }); CACHE.clear(); }
async function selfMutate(e, fn) { // read, change, write only if nobody wrote in between (sync.js dbPatchIf), else redo
  const id = selfKey(e);
  for (let i = 0; i < 6; i++) {
    let row = await D.S.dbGet(id);
    if (!row) { await D.S.dbPut({ id, salt: 'x', pinhash: 'x', data: { items: [] }, updated: 1 }, true); row = await D.S.dbGet(id); if (!row) continue; }
    const data = clone(row.data || {}); data.items = Array.isArray(data.items) ? data.items : [];
    const out = fn(data);
    if (await D.S.dbPatchIf(id, row.updated, data, Math.max(D.now(), Number(row.updated || 0) + 1))) { CACHE.delete(e); return out; }
  }
  throw bad(409, 'Busy, try again');
}

// ---------- share switch ("Show my lifetime stats to my groups", default OFF) ----------
async function shareGet(mk) { const r = await D.S.dbGet(SHARE); return (r && r.data && r.data.users && r.data.users[mk]) || null; }
async function shareSet(e, on) {
  const mk = mkOf(e);
  for (let i = 0; i < 6; i++) {
    let row = await D.S.dbGet(SHARE);
    if (!row) { await D.S.dbPut({ id: SHARE, salt: 'x', pinhash: 'x', data: { users: {} }, updated: 1 }, true); row = await D.S.dbGet(SHARE); if (!row) continue; }
    const data = clone(row.data || {}); data.users = data.users || {};
    if (on) data.users[mk] = { e, at: D.now() }; else delete data.users[mk];
    if (await D.S.dbPatchIf(SHARE, row.updated, data, Math.max(D.now(), Number(row.updated || 0) + 1))) return !!on;
  }
  throw bad(409, 'Busy, try again');
}


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
D.limits = () => realOr('./limits', 'isEnterprise', LIMSTAND);
D.golf = () => realOr('./golf', 'coursesOwnedBy', GOLFSTAND);
const okCid = (v) => { const x = String(v || ''); return /^[\w-]{1,40}$/.test(x) ? x : ''; };
const cpid = (cid, mk) => sha('oddable-cpid|' + cid + '|' + mk).slice(0, 12); // a player's id inside one course's view only
async function ownedCourses(e) { const L = D.limits(), k = L.keyOf(e); if (!(await L.isEnterprise(k))) return []; return ((await D.golf().coursesOwnedBy(k)) || []).map((c) => ({ id: okCid(c.id), name: clean(c.name, 60) })).filter((c) => c.id); }
async function courseOwner(cid) { // does any enterprise account own this course? (stand-in scans the link row)
  if (typeof D.golf().courseOwner === 'function') return D.golf().courseOwner(cid);
  const r = await D.S.dbGet(ENTC).catch(() => null), own = (r && r.data && r.data.own) || {};
  for (const k of Object.keys(own)) { const c = (own[k] || []).find((x) => x.id === cid); if (c && (await D.limits().isEnterprise(k))) return { key: k, name: clean(c.name, 60) }; }
  return null;
}
async function cshare() { const r = await D.S.dbGet(CSH).catch(() => null); return (r && r.data && r.data.c) || {}; }
// Exported for the golf / events engines: call when a player joins a course's league or event (after showing the consent question; on = their answer).
async function consentOnJoin(e, courseId, via, on, myName) {
  const cid = okCid(courseId); if (!cid) throw bad(400, 'Bad course'); const own = await courseOwner(cid); if (!own) return { ok: true, asked: false };
  const mk = mkOf(e), v = via && via.id ? { kind: clean(via.kind, 12) || 'event', id: String(via.id).replace(/[^\w-]/g, '').slice(0, 40), title: clean(via.title, 60) } : null;
  const res = await rowMutate(CSH, () => ({ c: {} }), (d) => { d.c = d.c || {}; const c = (d.c[cid] = d.c[cid] || { name: own.name, m: {} }); c.name = own.name || c.name; const m = (c.m[mk] = c.m[mk] || { e, via: [] });
    m.e = e; m.on = !!on; m.at = D.now(); if (myName) m.name = clean(myName, 30); if (v && !m.via.some((x) => x.id === v.id)) m.via = m.via.concat(v).slice(-50); return { on: m.on }; });
  CACHE.delete(e); return { ok: true, asked: true, on: res.on, course: own.name };
}
function hcpTrend(h, today) { // arrow for the course list: index now vs the latest index from 30+ days ago (lower = better)
  if (h.index == null || !h.history.length) return { dir: '', change: null };
  const cut = new Date(Date.parse(today + 'T12:00:00Z') - 30 * DAY).toISOString().slice(0, 10), old = h.history.filter((x) => x.date <= cut).pop();
  if (!old) return { dir: '', change: null }; const ch = r1(h.index - old.index); return { dir: ch < -0.05 ? 'better' : ch > 0.05 ? 'worse' : 'steady', change: ch };
}
const shareHcp = (h) => { const x = clone(h); x.diffs = x.diffs.map((d, i) => Object.assign(d, { id: 'r' + i })); x.history = x.history.map((p) => ({ date: p.date, index: p.index })); return x; }; // record ids never leave
async function courseView(e, op, b, today) {
  const mine = await ownedCourses(e); if (op === 'course/mine') { const cs = await cshare(); return { ok: true, courses: mine.map((c) => ({ id: c.id, name: c.name, players: Object.values((cs[c.id] || {}).m || {}).filter((m) => m.on).length })) }; }
  const cid = okCid(b.courseId), course = mine.find((c) => c.id === cid); if (!course) throw bad(404, 'Course not found');
  const cs = await cshare(), members = Object.entries(((cs[cid] || {}).m) || {}).filter(([, m]) => m.on && m.e).slice(0, 400), via = String(b.via || '');
  const events = []; members.forEach(([, m]) => (m.via || []).forEach((v) => { if (!events.some((x) => x.id === v.id)) events.push(v); }));
  const pick = members.filter(([, m]) => !via || (m.via || []).some((v) => v.id === via)), mo = today.slice(0, 7) + '-01', cname = normCourse(course.name);
  const rows = []; for (const [mk, m] of pick) { let v; try { v = await cached(m.e); } catch (er) { continue; } const golfRecs = v.recs.filter((r) => r.sport === 'golf'), h = golfHcp(golfRecs), t = hcpTrend(h, today);
    rows.push({ pid: cpid(cid, mk), name: clean(m.name, 30) || 'Player', index: h.index, trend: t.dir, change: t.change, rounds: h.rounds, need: h.need, roundsMonth: golfRecs.filter((r) => ownRound(r) && r.date >= mo).length, _h: h, _recs: golfRecs }); }
  if (op === 'course/players') return { ok: true, course, events, via: via || null, label: HCP_LABEL, method: HCP_METHOD, players: rows.map(({ _h, _recs, ...x }) => x).sort((a, c) => (a.index == null) - (c.index == null) || (a.index || 0) - (c.index || 0) || a.name.localeCompare(c.name)) };
  if (op === 'course/player') { const r0 = rows.find((x) => x.pid === String(b.pid || '')); if (!r0) throw bad(404, 'Player not found'); return { ok: true, course, name: r0.name, readOnly: true, golfHcp: shareHcp(r0._h) }; }
  if (op === 'course/rounds') { const out = []; rows.forEach((x) => x._recs.filter((r) => r.kind === 'golf-round' && !(r.extra && r.extra.side) && ((r.extra && okCid(r.extra.courseId) === cid) || normCourse(r.extra && r.extra.course) === cname)).forEach((r) => { const d = x._h.diffs.find((y) => y.id === r.id); out.push({ date: r.date, pid: x.pid, name: x.name, score: r.score, toPar: r.toPar == null ? null : r.toPar, tees: clean(r.extra.tees, 20), holes: holesOf(r), team: teamFmt(r), diff: d ? d.diff : null }); }));
    return { ok: true, course, rounds: out.sort((a, c) => (a.date < c.date ? 1 : a.date > c.date ? -1 : 0)).slice(0, 500) }; }
  if (op === 'course/prefill') { const cr = numOpt(b.cr, 50, 85, 'Course Rating: 50 to 85'), slope = int(b.slope, 55, 155, 'Slope Rating: 55 to 155'), par = int(b.par, 54, 80, 'Par: 54 to 80');
    if (cr == null) throw bad(400, 'Enter the Course Rating');
    return { ok: true, course, tee: { cr, slope, par }, players: rows.map((x) => ({ pid: x.pid, name: x.name, index: x.index, ch: x.index == null ? null : R.courseHandicap(x.index, slope, cr, par) })).sort((a, c) => (a.ch == null) - (c.ch == null) || (a.ch || 0) - (c.ch || 0)) }; }
  throw bad(404, 'not found');
}
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
// Storage: 'lock:evr:<eventId>' { dir: <limits key of the director>, title, sport, lockAt, set: { <player key>: { hcp?, rating?, at, reason, name } }, log: [..] }
//   player key = groups member key (mkOf) for an account, 'g:<gid>' for a guest player (userKey 'guest:<gid>', the golf engine's convention).
// Engines call: eventSetup (once, when an Enterprise tournament is created), eventOverride (director edits), handicapFor / ratingFor (every use).
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
// The engine creating an Enterprise tournament registers it here (director = the creating account; must be an Enterprise account).
async function eventSetup(directorE, eventId, o) {
  const id = okEid(eventId); if (!id) throw bad(400, 'Bad event'); const L = D.limits(), dk = L.keyOf(directorE); if (!(await L.isEnterprise(dk))) throw bad(403, 'Only Enterprise tournaments can set handicaps');
  const x = o || {}, lockAt = Number(x.lockAt) > 0 ? Number(x.lockAt) : null;
  await rowMutate(EVR(id), () => ({ dir: dk, set: {}, log: [] }), (d) => { if (d.dir !== dk) throw bad(403, 'Not your tournament'); if (evLocked(d)) throw bad(409, 'The tournament has started; handicaps are locked');
    d.title = clean(x.title, 60) || d.title || 'Tournament'; d.sport = SPORTS.includes(x.sport) ? x.sport : d.sport || 'golf'; d.lockAt = lockAt || d.lockAt || null; return {}; });
  return { ok: true };
}
// Director adds / changes / clears (value null) one player's handicap (golf) or rating (pickleball and other Elo sports) for this tournament only.
async function eventOverride(directorE, eventId, userKey, o) {
  const id = okEid(eventId); if (!id) throw bad(400, 'Bad event'); const x = o || {}, field = x.rating !== undefined ? 'rating' : 'hcp', raw = x[field];
  const val = raw == null || raw === '' ? null : field === 'hcp' ? numOpt(raw, -10, 54, 'Handicap must be +10 to 54.0', 1) : numOpt(raw, 100, 3500, 'Rating must be 100 to 3500', 0);
  const L = D.limits(), dk = L.keyOf(directorE), pk = pkeyOf(userKey), real = field === 'hcp' ? (await handicapFor(userKey)).oddable.index : (await ratingFor(userKey, x.sport)).oddable.rating;
  const res = await rowMutate(EVR(id), null, (d) => {
    if (d.dir !== dk) throw bad(403, 'Only this tournament\'s director can change handicaps'); if (evLocked(d)) throw bad(409, 'The tournament has started; handicaps are locked');
    d.set = d.set || {}; d.log = d.log || []; const cur = d.set[pk] || {}, old = cur[field] != null ? cur[field] : real;
    if ((cur[field] == null && val == null) || cur[field] === val) return { nochange: true, v: { ok: true, changed: false } };
    const nx = Object.assign({}, cur, { at: D.now(), reason: clean(x.reason, 120), name: clean(x.name, 30) || cur.name || '' }); if (val == null) delete nx[field]; else nx[field] = val;
    if (nx.hcp == null && nx.rating == null) delete d.set[pk]; else d.set[pk] = nx;
    d.log.push({ at: D.now(), by: clean(x.byName, 30) || 'Tournament director', player: nx.name || 'Player', field, old: old == null ? null : old, new: val, oddable: real == null ? null : real, reason: clean(x.reason, 120) }); if (d.log.length > 2000) d.log = d.log.slice(-2000);
    return { ok: true, changed: true, old: old == null ? null : old, new: val };
  });
  CACHE.clear(); return res;
}
// Director's view of the tournament's edits and their log (names only; never player keys).
async function eventLog(directorE, eventId) { const ev = await evRow(eventId); if (!ev || ev.dir !== D.limits().keyOf(directorE)) throw bad(404, 'Tournament not found'); return { ok: true, title: ev.title, locked: evLocked(ev), lockAt: ev.lockAt || null, log: (ev.log || []).slice(-500) }; }
const evOver = (ev, userKey, field) => { const s = ev && ev.set && ev.set[pkeyOf(userKey)]; return s && s[field] != null ? s : null; };
// handicapFor(userKey, {eventId}) -> { oddable: {index, rounds, need, label, method}, event: <tournament value or null>, setBy: 'tournament' | null, use, label, method, reason?, at? }
//   use = the value to play off: the tournament's when the director set one, else the Oddable Handicap Index (null = no handicap yet).
async function handicapFor(userKey, opts) {
  const h = golfHcp((await recsOf(userKey)).filter((r) => r.sport === 'golf')), o = opts || {}, ev = o.eventId ? await evRow(o.eventId) : null, s = evOver(ev, userKey, 'hcp');
  const oddable = { index: h.index, rounds: h.rounds, need: h.need, label: HCP_LABEL, method: HCP_METHOD };
  return { oddable, event: s ? s.hcp : null, setBy: s ? 'tournament' : null, use: s ? s.hcp : h.index, label: HCP_LABEL, method: HCP_METHOD, reason: s ? s.reason : undefined, at: s ? s.at : undefined, locked: ev ? evLocked(ev) : undefined };
}
// ratingFor(userKey, sport = 'pickleball', {eventId}) -> same shape; oddable.rating null = no rated match yet (use falls back to the 1500 start).
async function ratingFor(userKey, sport, opts) {
  const sp = SPORTS.includes(sport) && sport !== 'golf' ? sport : 'pickleball', E = eloAll(await recsOf(userKey))[sp], o = opts || {}, ev = o.eventId ? await evRow(o.eventId) : null, s = evOver(ev, userKey, 'rating');
  const oddable = { rating: E ? E.rating : null, matches: E ? E.matches : 0, label: RATING_LABEL };
  return { sport: sp, oddable, event: s ? s.rating : null, setBy: s ? 'tournament' : null, use: s ? s.rating : E ? E.rating : R.ELO_START || 1500, start: !s && !E, label: RATING_LABEL, reason: s ? s.reason : undefined, at: s ? s.at : undefined, locked: ev ? evLocked(ev) : undefined };
}
// Course Handicap off THE handicap (tournament value when set) for one tee: strokes / net scores / flights.
async function courseHandicapFor(userKey, tee, opts) { const h = await handicapFor(userKey, opts), t = tee || {}; return Object.assign(h, { courseHandicap: h.use == null ? null : R.courseHandicap(h.use, Number(t.slope), Number(t.cr != null ? t.cr : t.rating), Number(t.par)) }); }
// Records of a tournament with a director's value for this player show "Set by tournament" (the record keeps the real Oddable value next to it).
async function markEvents(userKey, recs) {
  const ids = new Set(); recs.forEach((r) => { const x = r.extra || {}; [x.eventId, r.contestId, String(r.id).split(':')[0]].forEach((v) => { if (okEid(v) && v !== 'golf' && v !== 'b' && v !== 'g' && v !== 'log') ids.add(v); }); });
  const found = {}; let n = 0; for (const id of ids) { if (++n > 60) break; const ev = await evRow(id); if (!ev) continue; const s = ev.set && ev.set[pkeyOf(userKey)]; if (s) found[id] = { title: clean(ev.title, 60), sport: ev.sport, hcp: s.hcp != null ? s.hcp : null, rating: s.rating != null ? s.rating : null, reason: s.reason || '', at: s.at, locked: evLocked(ev) }; }
  if (!Object.keys(found).length) return { recs, events: [] };
  const H = golfHcp(recs.filter((r) => r.sport === 'golf')).index, E = eloAll(recs);
  const out = recs.map((r) => { const x = r.extra || {}, id = [x.eventId, r.contestId, String(r.id).split(':')[0]].find((v) => found[v]); if (!id) return r; const f = found[id];
    return Object.assign({}, r, { extra: Object.assign({}, x, { setBy: 'tournament', eventHcp: f.hcp, eventRating: f.rating, oddableHcp: H, oddableRating: E[r.sport] ? E[r.sport].rating : null }) }); });
  return { recs: out, events: Object.keys(found).map((id) => Object.assign({ eventId: id, oddableHcp: H, oddableRating: found[id].rating != null && E[found[id].sport] ? E[found[id].sport].rating : null }, found[id])) };
}

// ---------- registry ----------
const PROV = {};
function register(src, fn) { if (!SRC.includes(src)) throw new Error('stats.register: unknown src ' + src); if (typeof fn !== 'function') throw new Error('stats.register: ' + src + ' needs a function'); PROV[src] = fn; CACHE.clear(); }
register('bets', betsProvider); register('groups', groupsProvider); register('self', selfProvider);
// Engines merged later (calcutta.js, golf.js, events.js) export statsFor(userKey, {from, to}); collect() picks them up on its own unless the manager called
// register() for that src. A module that is not in this build is simply absent.
const MODS = { calcutta: './calcutta', golf: './golf', events: './events' }, AUTO = {};
function autoProv(src) { if (src in AUTO) return AUTO[src]; let f = null; try { const m = require(MODS[src]); if (m && typeof m.statsFor === 'function') f = (k, o) => m.statsFor(k, o); } catch (er) {} AUTO[src] = f; return f; }
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
    const mk = mkOf(e);
    if (op === 'me') {
      if (limited('r|' + mk, 120, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.');
      const v = await cached(e), mev = await markEvents(e, v.recs).catch(() => ({ recs: v.recs, events: [] })), recs = mev.recs.slice().sort((a, c) => -order(a, c)), P = periods(recs, today), sh = await shareGet(mk).catch(() => null);
      const srow = await selfRow(e).catch(() => null), sd = (srow && srow.data) || {};
      send(res, 200, { today, from: P.from, periods: P.periods, records: recs.slice(0, 3000), more: Math.max(0, recs.length - 3000), sources: sources(), errors: v.errors, share: !!sh, owner: !!D.acct().ownerOk(req),
        golfHcp: golfHcp(recs), ratings: eloAll(recs), dupr: Number.isFinite(sd.dupr) ? sd.dupr : null, guests: (sd.guests || []).length, tournaments: mev.events, courseView: (await ownedCourses(e).catch(() => [])).length > 0 }); return true;
    }
    if (op === 'self/save' || op === 'self/delete' || op === 'share' || op === 'dupr' || op.startsWith('guest/')) {
      if (limited('w|' + mk, 60, 600e3) || limited('w|i|' + ip, 120, 600e3)) throw bad(429, 'Too many changes. Wait a few minutes.');
      send(res, 200, await writeOp(op, b, e, mk, now, ip)); return true;
    }
    if (op === 'courses' || op === 'coursedetail') { // OpenGolfAPI course search for Post a round and the course handicap calculator (server-side, cached)
      if (limited('cs|' + mk, 60, 600e3)) throw bad(429, 'Too many searches. Wait a few minutes.');
      const CS = require('./stats-courses');
      try { if (op === 'courses') { const q = clean(b.q, 60); if (q.length < 2 && !b.state) throw bad(400, 'Type at least 2 letters of the course name'); send(res, 200, Object.assign({ ok: true, courses: [] }, { api: await CS.search(q, b.state, b.offset) })); }
        else send(res, 200, { ok: true, course: await CS.detail(String(b.extId || '')) }); }
      catch (er) { if (er.status) throw er; throw bad(502, "Couldn't reach the course list. Try again."); }
      return true;
    }
    if (op === 'event/log') { send(res, 200, await eventLog(e, b.eventId)); return true; } // the tournament director's change log (E-H)
    if (op === 'member') { send(res, 200, await memberView(e, mk, String(b.groupId || ''), String(b.pid || ''), now, today)); return true; }
    if (op === 'consent/get') { if (limited('r|' + mk, 120, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.'); const cid = okCid(b.courseId), own = cid ? await courseOwner(cid) : null; const m = own ? (((await cshare())[cid] || {}).m || {})[mk] : null;
      send(res, 200, { ok: true, ask: !!own, course: own ? { id: cid, name: own.name } : null, on: m ? !!m.on : null, text: own ? 'Share my handicap and rounds with ' + own.name + '?' : '' }); return true; }
    if (op === 'consent/list') { const cs = await cshare(), out = []; Object.keys(cs).forEach((cid) => { const m = (cs[cid].m || {})[mk]; if (m) out.push({ courseId: cid, name: clean(cs[cid].name, 60), on: !!m.on, at: m.at, via: (m.via || []).map((v) => ({ kind: v.kind, title: v.title })) }); }); send(res, 200, { ok: true, consents: out }); return true; }
    if (op === 'consent/set') { if (limited('w|' + mk, 60, 600e3)) throw bad(429, 'Too many changes. Wait a few minutes.'); send(res, 200, await consentOnJoin(e, b.courseId, b.via, !!b.on, b.myName)); return true; }
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
  if (op === 'dupr') { const v = b.dupr == null || b.dupr === '' ? null : numOpt(b.dupr, 1, 8.5, 'DUPR must be 1.000 to 8.500', 3); await selfMutate(e, (d) => { d.dupr = v; }); return { ok: true, dupr: v }; }
  const row = await selfRow(e), sd = (row && row.data) || {}, gmap = {}; (sd.guests || []).forEach((g) => { gmap[g.gid] = g.name; });
  const orgName = clean(b.myName, 30);
  if (op === 'self/delete') {
    const id = String(b.id || ''), old = (sd.items || []).find((x) => x.id === id); if (!old) throw bad(404, 'Not found');
    await selfMutate(e, (d) => { d.items = d.items.filter((x) => x.id !== id); });
    for (const gid of mirrorGids(old)) await guestRemove(e, gid, 'gm' + id).catch(() => {});
    return { ok: true };
  }
  if (op === 'self/save') {
    const editId = b.id ? String(b.id) : '', old = editId ? (sd.items || []).find((x) => x.id === editId) : null; if (editId && !old) throw bad(404, 'Not found');
    if (!editId && (sd.items || []).length >= 2000) throw bad(400, 'You have 2000 entries. Delete some old ones first.');
    const id = editId || 's' + rnd(10), rec = selfRecord(b.item, id, now, gmap), v = validate(rec, 'self'); if (!v.ok) throw bad(400, 'Could not save (' + v.why + ')');
    if (rec.extra.guest) { if (editId) throw bad(400, 'A guest player\'s round is changed from their page'); const gr = Object.assign({}, v.rec, { id: 'gr' + rnd(10) }); delete gr.extra.guest; gr.extra.loggedBy = orgName || 'Organizer'; await guestAdd(e, rec.extra.guest, gr); return { ok: true, record: gr, guest: rec.extra.guest }; }
    await selfMutate(e, (d) => { if (editId) { if (!d.items.some((x) => x.id === id)) throw bad(404, 'Not found'); d.items = d.items.map((x) => (x.id === id ? v.rec : x)); } else d.items.push(v.rec); });
    const now2 = mirrorGids(v.rec), was = old ? mirrorGids(old) : [];
    for (const gid of was) if (!now2.includes(gid)) await guestRemove(e, gid, 'gm' + id).catch(() => {});
    const ex = v.rec.extra || {}; for (const gid of now2) await guestAdd(e, gid, mirrorOf(v.rec, ex.partnerGuest === gid ? 'partner' : 'opp', orgName)).catch(() => {});
    return { ok: true, record: v.rec };
  }
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
  if (op === 'guest/remove-item') { if (!gmap[String(b.gid || '')]) throw bad(404, 'Not found'); await guestRemove(e, String(b.gid), String(b.id || '')); return { ok: true }; }
  if (op === 'guest/claim') {
    const fk = 'cf|' + mk, fi = 'cf|i|' + ip, fails = (k) => (RL.get(k) || []).filter((x) => D.now() - x < 900e3).length;
    if (fails(fk) >= 10 || fails(fi) >= 20) throw bad(429, 'Too many wrong links. Wait 15 minutes.');
    const m = /^(?:claim\.)?([a-z0-9]{12})-([a-z0-9]{20,40})$/.exec(String(b.code || '').trim()), fail = () => { [fk, fi].forEach((k) => { const a = (RL.get(k) || []).filter((x) => D.now() - x < 900e3); a.push(D.now()); RL.set(k, a); }); return bad(403, 'That claim link is not valid'); };
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
const claimLink = (code) => 'https://steves-pics.onrender.com/?join=claim.' + code;
const mirrorGids = (rec) => { const ex = (rec && rec.extra) || {}; return [...new Set([ex.partnerGuest].concat(ex.oppGuest || []).filter(Boolean))]; };

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

module.exports = { handle, register, statsFor, handicapFor, ratingFor, courseHandicapFor, eventSetup, eventOverride, eventLog, HCP_LABEL, HCP_METHOD, RATING_LABEL, guestAdd, guestRemove, consentOnJoin, coursePrefill, ownedCourses, golfHcp, eloAll, validate, tot, tree, periods, periodFrom, publicTree, betRecords, selfRecord, chiDay, mkOf, selfKey, SRC, SPORTS, KINDS, _deps: D,
  _reset: () => { RL.clear(); CACHE.clear(); IDS.map = null; OWN = { at: 0, v: null }; } };
