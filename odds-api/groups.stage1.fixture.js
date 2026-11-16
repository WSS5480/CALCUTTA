// TEST FIXTURE ONLY (preview merge): the Groups STAGE 1 engine exactly as it is in the stats branch (stats-v1 c084625), the version odds-api/stats.test.js was written against.
// stats.test.js loads this file so its stage-1 group checks (contest record, member view, share switch, history copy) still run in the merged tree.
// The app never loads it: server.js and stats.js use odds-api/groups.js (v254). Delete this file when stats.test.js is rewritten for v254.
// Oddable Groups (stage 1, Nov 15 2026). Players compete with the REAL bets they already track in My Bets (cloud-synced, sync.js).
// The commissioner (creator) sets every rule at creation; every rule locks at the group's start, for everyone (commissioner and owner included). Enforced here.
// MONEY STAYS OUTSIDE THE APP: entry, payout split and the commissioner's take are information only. Nothing is collected, held or paid.
// Storage (Supabase table oddable_sync, 'lock:' prefix keeps these rows out of every player list / owner count, see sync.js adminUsers):
//   'lock:groups'      { groups: { <id>: group } }   one row, every change written with dbPatchIf on `updated` (concurrent joins cannot lose updates)
//   'lock:gl:<id>'     { bets: { <pid>: { <betId>: frozen bet } } }   ledger: a counted, settled bet is frozen the first time the server sees it,
//                       so deleting or editing it later on a phone does not change the group
// Members are shown by their Oddable name/handle only. Phones, phone hashes, PINs, tokens and sync ids are never sent to anyone.
const crypto = require('crypto');
const D = {
  S: require('./sync'),
  acct: () => require('./acct'),
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
  ip: (req) => require('./ip').clientIp(req),
};
const ROW = 'lock:groups', GL = (id) => 'lock:gl:' + id;
const MAXG = 400, MAXMINE = 20, DAY = 864e5;
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const bad = (status, error) => Object.assign(new Error(error), { status });
const body = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 20000) c.push(d); }); req.on('end', () => { if (n > 20000) return no(bad(413, 'Too big')); try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(bad(400, 'Bad request')); } }); req.on('error', no); });
const clone = (o) => JSON.parse(JSON.stringify(o));
const cleanName = (n, max) => String(n == null ? '' : n).replace(/[<>&"'`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 24);

// ---------- Chicago days ----------
const chiDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const dnum = (day) => Math.round(Date.parse(day + 'T00:00:00Z') / DAY); // day string -> whole day number (calendar arithmetic)
const dstr = (n) => new Date(n * DAY).toISOString().slice(0, 10);
function chiStart(day) { for (const off of ['-05:00', '-06:00']) { const t = Date.parse(day + 'T00:00:00' + off); if (chiDay(t) === day && chiDay(t - 1) !== day) return t; } return Date.parse(day + 'T06:00:00Z'); }
const chiEnd = (day) => chiStart(dstr(dnum(day) + 1)) - 1;
const okDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(dnum(s)) && dstr(dnum(s)) === s;
// Group weeks run Tuesday to Monday (an NFL week). Week 1 is from the start day to the first Monday.
const tue0 = (startDay) => { const n = dnum(startDay), wd = new Date(n * DAY).getUTCDay(); return n - ((wd + 5) % 7); }; // Tuesday on or before
const weekOf = (g, day) => Math.floor((dnum(day) - tue0(g.startDay)) / 7) + 1;
const weekDays = (g, w) => { const a = tue0(g.startDay) + (w - 1) * 7; return [dstr(Math.max(a, dnum(g.startDay))), dstr(Math.min(a + 6, dnum(g.endDay)))]; };

// ---------- rules ----------
const SEASON_END = { nfl: '2027-01-11', ncaa: '2027-01-20', both: '2027-01-20' }; // day after NFL week 18 Monday / after the college title game
const PLAYOFF_END = '2027-02-15'; // day after Super Bowl LXI (Feb 14 2027)
const SPLITS = { '60/30/10': [60, 30, 10], '100': [100], '50/30/20': [50, 30, 20], 'none': [] };
const SPORTS = ['nfl', 'ncaa', 'both'], FMTS = ['standings', 'best5'], METRICS = ['win', 'units', 'ret', 'pct'];
const CAPS = [0, 10, 25, 50, 100, 250, 500], MAXM = [2, 3, 4, 6, 8, 10, 12, 16, 20, 30, 50];
function runsEnd(runs, startDay, sport, endDay) {
  const wd = new Date(dnum(startDay) * DAY).getUTCDay(), toMon = (8 - wd) % 7; // days to the Monday on/after
  if (runs === 'weekend') return dstr(dnum(startDay) + toMon);
  let m = /^w(\d{1,2})$/.exec(runs || ''); if (m) { const n = +m[1]; if (n < 1 || n > 20) throw bad(400, 'Pick 1 to 20 weeks'); return dstr(dnum(startDay) + n * 7 - 1); }
  if (runs === 'season') return SEASON_END[sport];
  if (runs === 'playoffs') return PLAYOFF_END;
  if (runs === 'custom') { if (!okDay(endDay)) throw bad(400, 'Pick an end date'); return endDay; }
  throw bad(400, 'Pick how long the group runs');
}
// Validates and range-checks every option. Returns the clean group settings (no members). Throws {status:400}.
function cleanRules(b, now) {
  const name = cleanName(b.name, 30); if (name.length < 2) throw bad(400, 'Give the group a name (2+ characters)');
  const sport = String(b.sport || ''); if (!SPORTS.includes(sport)) throw bad(400, 'Pick NFL, College or Both');
  const fmt = String(b.fmt || ''); if (!FMTS.includes(fmt)) throw bad(400, 'That format is coming soon. Pick Standings or Best five.');
  const start = Number(b.start); if (!Number.isFinite(start) || start < now + 60e3) throw bad(400, 'The start must be in the future');
  if (start > now + 400 * DAY) throw bad(400, 'The start is too far away');
  const startDay = chiDay(start), endDay = runsEnd(String(b.runs || ''), startDay, sport, b.endDay);
  if (dnum(endDay) < dnum(startDay)) throw bad(400, 'The end is before the start');
  if (dnum(endDay) - dnum(startDay) > 200) throw bad(400, 'A group can run up to 200 days');
  const T = b.types || {}, types = { sp: !!T.sp, ml: !!T.ml, ou: !!T.ou, prop: !!T.prop, parlay: !!T.parlay };
  if (!Object.values(types).some(Boolean)) throw bad(400, 'Pick at least one kind of bet that counts');
  const legs = types.parlay ? Math.round(Number(b.legs)) : 0; if (types.parlay && !(legs >= 2 && legs <= 10)) throw bad(400, 'Parlay legs must be 2 to 10');
  const metric = String(b.metric || ''); if (!METRICS.includes(metric)) throw bad(400, 'Pick how the winner is decided');
  const minBets = Math.round(Number(b.minBets || 0)); if (!(minBets >= 0 && minBets <= 10)) throw bad(400, 'Least bets a week: 0 to 10');
  const cap = Math.round(Number(b.cap || 0)); if (!CAPS.includes(cap)) throw bad(400, 'Pick a cap from the list');
  const entry = Number(b.entry || 0); if (!(Number.isFinite(entry) && entry >= 0 && entry <= 10000 && Math.round(entry) === entry)) throw bad(400, 'Entry must be a whole dollar amount from 0 to 10,000');
  const split = String(b.split || 'none'); if (!(split in SPLITS)) throw bad(400, 'Pick a payout split');
  const tk = b.take || {}, kind = String(tk.kind || 'none'); let tv = 0;
  if (kind === 'pct') { tv = Number(tk.v); if (!(Number.isInteger(tv) && tv >= 0 && tv <= 50)) throw bad(400, "Commissioner's take: a whole percent from 0 to 50"); }
  else if (kind === 'flat') { tv = Number(tk.v); if (!(Number.isFinite(tv) && tv >= 0 && Math.round(tv * 100) === tv * 100)) throw bad(400, "Commissioner's take: a dollar amount, not negative"); }
  else if (kind !== 'none') throw bad(400, "Pick the commissioner's take");
  const J = b.join || {}, max = Math.round(Number(J.max)); if (!MAXM.includes(max)) throw bad(400, 'Pick the most members from the list');
  if (kind === 'flat' && tv > entry * max) throw bad(400, "The commissioner's take cannot be more than the pot (entry x most members)");
  const late = J.late === '2w' ? '2w' : J.late === 'no' || J.late == null ? 'no' : null; if (!late) throw bad(400, 'Pick when late joining is allowed');
  return {
    name, sport, fmt, start, startDay, endDay, runs: String(b.runs),
    rules: { verified: !!b.verified, types, legs, metric, minBets, cap, entry, split, take: { kind, v: kind === 'none' ? 0 : tv } },
    join: { requests: !!J.requests, open: !!J.open, max, late },
  };
}

// ---------- money (information only) ----------
const cents = (x) => Math.round(Number(x) * 100);
function pot(g) {
  const r = g.rules, n = g.members.length, paid = g.members.filter((m) => m.paid).length, potC = cents(r.entry) * paid;
  const takeC = r.take.kind === 'pct' ? Math.round(potC * r.take.v / 100) : r.take.kind === 'flat' ? Math.min(cents(r.take.v), potC) : 0;
  const poolC = potC - takeC, sp = SPLITS[r.split] || [];
  const parts = sp.map((p) => Math.floor(poolC * p / 100)); if (parts.length) parts[0] += poolC - parts.reduce((a, x) => a + x, 0); // leftover cents go to 1st, so the split sums exactly to the prize pool
  return { entry: r.entry, members: n, paid, expected: r.entry * n, pot: potC / 100, take: takeC / 100, takeKind: r.take.kind, takeV: r.take.v, pool: poolC / 100, split: r.split, places: parts.map((c, i) => ({ place: i + 1, pct: sp[i], amt: c / 100 })) };
}
const takeText = (r) => (r.take.kind === 'pct' ? (r.take.v ? 'Commissioner keeps ' + r.take.v + '% of the pot' : 'Commissioner keeps nothing') : r.take.kind === 'flat' ? (r.take.v ? 'Commissioner keeps $' + (Number.isInteger(r.take.v) ? r.take.v : r.take.v.toFixed(2)) + ' of the pot' : 'Commissioner keeps nothing') : 'Commissioner keeps nothing');

// ---------- identity ----------
const IDS = { at: 0, map: null };
async function sidOf(e) { // a phone account's synced bets row id (sha256 of the phone). Kept on the server only.
  if (!/@phone\.oddable$/.test(e)) return null; const A = D.acct();
  for (let i = 0; i < 2; i++) {
    if (!IDS.map || D.now() - IDS.at > 10 * 6e4 || i) { const m = {}; (await D.S.dbIds()).forEach((id) => { m[A.phoneEmail(id)] = id; }); IDS.map = m; IDS.at = D.now(); }
    if (IDS.map[e]) return IDS.map[e];
  }
  return null;
}
const mkOf = (e) => crypto.createHash('sha256').update('oddable-group|' + e).digest('hex').slice(0, 24);
let NAMES = { at: 0, v: {} };
async function names() { if (D.now() - NAMES.at > 60e3) { try { NAMES = { at: D.now(), v: await D.acct().namesGet() }; } catch (e) { NAMES.at = D.now(); } } return NAMES.v; }
async function nameOf(e, sid, given) {
  const A = D.acct(); if (e === 'owner' || A.isOwnerPhone(e)) return A.ownerName();
  if (sid) { const n = (await names())[String(sid).slice(0, 8)]; if (n) return cleanName(n); }
  return cleanName(given) || 'Player';
}
const fixed = (e, sid) => !sid || e === 'owner' || D.acct().isOwnerPhone(e); // names that never come from the names store
async function me(req) {
  const e = D.acct().who(req); if (!e) throw bad(401, 'Sign in to use Groups');
  return { e, mk: mkOf(e) };
}

// ---------- rate limits (in memory, per account and per IP) ----------
const RL = new Map();
function limit(key, n, ms) { const t = D.now(), a = (RL.get(key) || []).filter((x) => t - x < ms); if (a.length >= n) { RL.set(key, a); return true; } a.push(t); RL.set(key, a); if (RL.size > 20000) { let k = 0; for (const x of RL.keys()) { RL.delete(x); if (++k > 5000) break; } } return false; }
const LIM = { create: [5, 3600e3, 12, 3600e3], join: [30, 600e3, 60, 600e3], code: [10, 900e3, 20, 900e3] };
function rate(kind, who, ip) { const L = LIM[kind]; if (limit(kind + '|a|' + who, L[0], L[1]) || limit(kind + '|i|' + ip, L[2], L[3])) throw bad(429, 'Too many tries. Wait a few minutes.'); }
const codeFail = (k) => { const t = D.now(), a = (RL.get(k) || []).filter((x) => t - x < 900e3); a.push(t); RL.set(k, a); };
const codeBlocked = (k) => (RL.get(k) || []).filter((x) => D.now() - x < 900e3).length >= 10;

// ---------- the groups row ----------
async function load() { const r = await D.S.dbGet(ROW); return r || null; }
async function mutate(fn) { // read, change, write only if nobody wrote in between; else read again and redo (lost updates are impossible)
  for (let i = 0; i < 6; i++) {
    let row = await load();
    if (!row) { await D.S.dbPut({ id: ROW, salt: 'x', pinhash: 'x', data: { groups: {} }, updated: 1 }, true); row = await load(); if (!row) continue; }
    const data = clone(row.data || {}); data.groups = data.groups || {};
    const out = await fn(data);
    if (out && out.nochange) return out.v;
    if (await D.S.dbPatchIf(ROW, row.updated, data, Math.max(D.now(), Number(row.updated || 0) + 1))) { CACHE.clear(); return out; }
  }
  throw bad(409, 'Busy, try again');
}
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPH[b[i] % 32]; return s; };
const newCode = () => rnd(4) + '-' + rnd(4); // 40 random bits; wrong guesses are throttled
const normCode = (c) => { const x = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return x.length === 8 ? x.slice(0, 4) + '-' + x.slice(4) : ''; };
const sameCode = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const started = (g, now) => now >= g.start;
const ended = (g, now) => now > chiEnd(g.endDay);
const joinOpenUntil = (g) => (g.join.late === '2w' ? g.start + 14 * DAY : g.start);
const memberOf = (g, mk) => g.members.find((m) => m.mk === mk);
const isComm = (g, mk) => g.comm === mk;
const newPid = (g) => { let p; do { p = rnd(6); } while (g.members.some((m) => m.pid === p) || (g.reqs || []).some((m) => m.pid === p)); return p; };

// ---------- bets: classify, count, score ----------
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
let NFLAB = new Set(['BUF', 'MIA', 'NE', 'NYJ', 'BAL', 'CIN', 'CLE', 'PIT', 'HOU', 'IND', 'JAX', 'TEN', 'DEN', 'KC', 'LV', 'LAC', 'DAL', 'NYG', 'PHI', 'WSH', 'WAS', 'CHI', 'DET', 'GB', 'MIN', 'ATL', 'CAR', 'NO', 'TB', 'ARI', 'LAR', 'LA', 'SF', 'SEA']);
const OTHER = new Set(['nba', 'mlb', 'nhl', 'ncaab']);
// Sport of one bet or leg, server copy of the app's v213 bSport1: lg if set; Kalshi ticker; else NFL if either team abbreviation is an NFL team, else college.
// CAVEAT (same as the app): a college team whose abbreviation equals an NFL one (e.g. MIA) counts as NFL unless the bet has lg. No teams at all = unknown.
function sportOf(o, kt) {
  const lg = String(o.lg || '').toLowerCase(); if (lg === 'cfb' || lg === 'ncaa') return 'ncaa'; if (lg === 'nfl') return 'nfl'; if (OTHER.has(lg)) return 'other';
  if (kt) { if (/NCAAF|CFB/i.test(kt)) return 'ncaa'; if (/NFL/i.test(kt)) return 'nfl'; if (/NBA|MLB|NHL|NCAAB|WNBA/i.test(kt)) return 'other'; }
  if (o.home || o.away) return NFLAB.has(o.home) || NFLAB.has(o.away) ? 'nfl' : 'ncaa';
  return '?';
}
function sportOk(b, sport) { // every known leg must be in the group's sport; unknown legs (no teams) only count in 'Both' groups or next to a known matching leg
  const ok = (s) => s === sport || (sport === 'both' && (s === 'nfl' || s === 'ncaa'));
  const S = b.kind === 'parlay' ? (Array.isArray(b.legs) ? b.legs : []).map((l) => sportOf(l, null)) : [sportOf(b, b.kt)];
  if (b.kind === 'parlay' && b.kt) { const k = sportOf({}, b.kt); if (k !== '?') return ok(k) && S.every((s) => s === '?' || ok(s)); }
  if (S.some((s) => s === 'other' || (s !== '?' && !ok(s)))) return false;
  return S.some((s) => s !== '?') || sport === 'both';
}
function typeOf(b) {
  if (b.kind === 'parlay') return 'parlay';
  if (b.kind === 'prop') { if (b.src === 'kalshi' && b.kt) { const t = String(b.kt).toUpperCase(); if (/SPREAD/.test(t)) return 'sp'; if (/TOTAL/.test(t)) return 'ou'; if (/GAME/.test(t)) return 'ml'; } return 'prop'; }
  const t = String(b.type || 'ml'); return t === 'sp' ? 'sp' : t === 'ou' || t === 'tot' ? 'ou' : 'ml';
}
const verified = (b) => b.src === 'kalshi' && !!b.kt;
function result(b) {
  if (b.cash !== undefined && b.cash !== null && N(b.stake)) return b.cash > N(b.stake) + 0.005 ? 'won' : b.cash < N(b.stake) - 0.005 ? 'lost' : 'push';
  if (b.fin === 'won' || b.fin === 'lost' || b.fin === 'push') return b.fin;
  if (b.kind === 'prop' && /^(won|lost|push|void)$/.test(String(b.res || ''))) return b.res === 'void' ? 'push' : b.res;
  return '';
}
const profitMult = (b) => { if (N(b.mult) > 1) return N(b.mult) - 1; let o = N(b.odds) || -110; if (Math.abs(o) < 100) o = -110; return o > 0 ? o / 100 : 100 / -o; };
function plOf(b, r) {
  const st = N(b.stake);
  if (b.cash !== undefined && b.cash !== null && st) return Math.round((N(b.cash) - st) * 100) / 100;
  if (b.fin && Number.isFinite(Number(b.finPL)) && b.finPL !== null && b.finPL !== '') return Number(b.finPL);
  return r === 'won' ? st * profitMult(b) : r === 'lost' ? -st : 0;
}
const lbl = (b) => cleanName(String(b.text || (b.kind === 'parlay' ? (Array.isArray(b.legs) ? b.legs.length : 0) + '-leg parlay' : (b.side || '?') + ' ' + (b.type === 'ou' || b.type === 'tot' ? b.line : b.line ? (b.line > 0 ? '+' : '') + b.line : 'ML') + (b.away && b.home ? ' (' + b.away + '@' + b.home + ')' : ''))), 90);
const legsOf = (b) => (b.kind === 'parlay' ? (Array.isArray(b.legs) ? b.legs : []) : [b]);
const created = (b) => { const m = /^b(\d{12,14})$/.exec(String(b.id || '')); return m ? +m[1] : null; }; // manual bets carry their creation time in the id
// Kickoff of each game the bet is on, from ESPN's schedule (current + next week, NFL and college), cached 5 minutes. Unknown games return null.
const KN = { at: 0, map: {} };
async function kickoffs() {
  if (D.now() - KN.at < 5 * 6e4) return KN.map; const map = Object.assign({}, KN.map);
  for (const [path, x] of [['nfl', ''], ['college-football', '&groups=80']]) {
    const base = 'https://site.api.espn.com/apis/site/v2/sports/football/' + path + '/scoreboard?limit=400' + x;
    try { const r = await D.fetch(base, { signal: AbortSignal.timeout(12000) }); if (!r.ok) continue; const j = await r.json(); (j.events || []).forEach((e) => { const t = Date.parse(e.date); if (e.id && Number.isFinite(t)) map[String(e.id)] = t; });
      const wk = j.week && j.week.number, st = j.season && j.season.type; if (wk && st) { const r2 = await D.fetch(base + '&week=' + (wk + 1) + '&seasontype=' + st, { signal: AbortSignal.timeout(12000) }); if (r2.ok) ((await r2.json()).events || []).forEach((e) => { const t = Date.parse(e.date); if (e.id && Number.isFinite(t)) map[String(e.id)] = t; }); }
    } catch (e) {}
  }
  const ks = Object.keys(map); if (ks.length > 6000) ks.slice(0, ks.length - 6000).forEach((k) => delete map[k]);
  KN.map = map; KN.at = D.now(); return map;
}
// When each leg starts: known kickoff, else the start of its day (Chicago). Visible to other members only once EVERY leg has kicked off (G6).
function timing(b, kn, now) {
  const today = chiDay(now); let first = Infinity, allStarted = true, day = '', future = false;
  legsOf(b).forEach((l) => {
    const t = l.gid != null && kn[String(l.gid)] != null ? kn[String(l.gid)] : null, d = okDay(String(l.day || '').slice(0, 10)) ? String(l.day).slice(0, 10) : okDay(String(b.day || '').slice(0, 10)) ? String(b.day).slice(0, 10) : '';
    if (t != null) { first = Math.min(first, t); if (now < t) { allStarted = false; future = true; } if (!day || chiDay(t) < day) day = chiDay(t); }
    else if (d) { first = Math.min(first, chiStart(d)); if (d >= today) allStarted = false; if (d > today) future = true; if (!day || d < day) day = d; } // unknown kickoff today or later: hidden until the day is over
    else allStarted = false;
  });
  if (!day) day = okDay(String(b.day || '').slice(0, 10)) ? String(b.day).slice(0, 10) : '';
  const kt = legsOf(b).map((l) => (l.gid != null ? kn[String(l.gid)] : null)).filter((x) => x != null);
  return { day, first: Number.isFinite(first) ? first : null, visible: allStarted || (!future && !!result(b)), kick: kt.length ? Math.min(...kt) : null };
}
// One member's bet as the group sees it, or null if it does not count. why = reason it does not count (for the member's own view).
function judge(g, b, kn, now, from) {
  if (!b || b.id == null) return null; const r = g.rules, tm = timing(b, kn, now);
  const out = { id: String(b.id).slice(0, 60), d: tm.day, what: lbl(b), type: typeOf(b), ver: verified(b), stake: Math.round(N(b.stake) * 100) / 100, res: result(b), vis: tm.visible, kick: tm.kick };
  if (!tm.day || tm.day < chiDay(from) || tm.day > g.endDay) return null; // outside the group's dates (or before this member joined)
  if (tm.kick != null && tm.kick < from) return null;
  if (r.verified && !out.ver) return Object.assign(out, { why: 'Not verified (not synced from Kalshi)' });
  if (!r.types[out.type]) return Object.assign(out, { why: 'This kind of bet does not count here' });
  if (out.type === 'parlay' && legsOf(b).length > r.legs) return Object.assign(out, { why: 'More than ' + r.legs + ' legs' });
  if (!sportOk(b, g.sport)) return Object.assign(out, { why: 'Not ' + (g.sport === 'nfl' ? 'NFL' : g.sport === 'ncaa' ? 'college football' : 'football') });
  const c = created(b); if (!out.ver && c && ((tm.kick != null && c > tm.kick + 5 * 6e4) || (tm.kick == null && c > chiEnd(tm.day)))) return Object.assign(out, { why: 'Logged after the game started' });
  const pl = out.res ? plOf(b, out.res) : 0, cs = r.cap && out.stake > r.cap ? r.cap : out.stake;
  out.cs = cs; out.capped = cs < out.stake; out.pl = out.res ? Math.round((out.stake > 0 ? pl * cs / out.stake : 0) * 100) / 100 : 0;
  out.u = out.res === 'won' ? Math.round((out.stake > 0 ? pl / out.stake : profitMult(b)) * 1000) / 1000 : out.res === 'lost' ? -1 : 0;
  out.ok = true; return out;
}
// Score a list of counted bets for one member (ranking metric + Best five + min bets per week).
function score(g, list, scope, week, now) {
  const r = g.rules, curW = Math.max(1, weekOf(g, chiDay(Math.min(Math.max(now, g.start), chiEnd(g.endDay))))), lastW = weekOf(g, g.endDay);
  let use = list.filter((x) => x.ok); if (scope === 'week') use = use.filter((x) => weekOf(g, x.d) === week);
  const byW = {}; use.forEach((x) => { (byW[weekOf(g, x.d)] = byW[weekOf(g, x.d)] || []).push(x); });
  const perBet = (x) => (r.metric === 'units' || r.metric === 'pct' ? x.u : x.pl);
  let counted = [];
  Object.keys(byW).forEach((w) => { const s = byW[w].filter((x) => x.res); if (g.fmt === 'best5') { s.sort((a, b) => perBet(b) - perBet(a) || a.id.localeCompare(b.id)); s.slice(0, 5).forEach((x) => (x.best = 1)); counted = counted.concat(s.slice(0, 5)); } else counted = counted.concat(s); });
  const t = { w: 0, l: 0, p: 0, open: 0, win: 0, units: 0, stake: 0, n: use.length };
  counted.forEach((x) => { if (x.res === 'won') t.w++; else if (x.res === 'lost') t.l++; else t.p++; t.win += x.pl; t.units += x.u; t.stake += x.cs; });
  use.forEach((x) => { if (!x.res) t.open++; });
  t.win = Math.round(t.win * 100) / 100; t.units = Math.round(t.units * 100) / 100; t.stake = Math.round(t.stake * 100) / 100;
  t.ret = t.stake > 0 ? Math.round(t.win / t.stake * 1000) / 10 : null; t.pct = t.w + t.l ? Math.round(t.w / (t.w + t.l) * 1000) / 10 : null;
  t.val = r.metric === 'win' ? t.win : r.metric === 'units' ? t.units : r.metric === 'ret' ? t.ret : t.pct;
  const wk = scope === 'week' ? week : Math.min(curW, lastW), nThis = list.filter((x) => x.ok && weekOf(g, x.d) === wk).length;
  t.weekBets = nThis; t.short = r.minBets > 0 && now >= g.start && nThis < r.minBets; // flagged: under the weekly minimum
  const st = list.filter((x) => x.ok && x.res && x.res !== 'push').sort((a, b) => (b.kick || chiStart(b.d)) - (a.kick || chiStart(a.d)));
  let k = 0; while (k < st.length && st[k].res === st[0].res) k++; t.streak = st.length ? (st[0].res === 'won' ? 'W' : 'L') + k : '';
  t.weeks = {}; Object.keys(byW).forEach((w) => { const s = byW[w].filter((x) => x.res); const v = (g.fmt === 'best5' ? s.filter((x) => x.best) : s); t.weeks[w] = { n: byW[w].length, val: Math.round(v.reduce((a, x) => a + (r.metric === 'units' || r.metric === 'pct' ? x.u : x.pl), 0) * 100) / 100, short: r.minBets > 0 && byW[w].length < r.minBets }; });
  return t;
}
const rank = (g, rows) => { const v = (x) => (x.t.val == null ? -Infinity : x.t.val), rr = (x) => (x.t.ret == null ? -Infinity : x.t.ret); rows.sort((a, b) => v(b) - v(a) || rr(b) - rr(a) || a.name.localeCompare(b.name)); rows.forEach((x, i) => (x.place = i + 1)); return rows; };

// Every member's counted bets (live bets merged with the frozen ledger), cached 60 s per group.
const CACHE = new Map();
async function memberBets(g) {
  const hit = CACHE.get(g.id); if (hit && D.now() - hit.at < 60e3 && hit.u === g.u) return hit.v;
  const now = D.now(), kn = await kickoffs(); let led = null; try { led = await D.S.dbGet(GL(g.id)); } catch (e) {}
  const L = clone((led && led.data && led.data.bets) || {}); let add = 0; const out = {};
  for (const m of g.members) {
    let bets = []; if (m.sid) { try { const row = await D.S.dbGet(m.sid); bets = (row && row.data && Array.isArray(row.data.bets)) ? row.data.bets : []; } catch (e) {} }
    const from = Math.max(g.start, m.joined || 0), seen = {}, list = [];
    bets.forEach((b) => { const j = judge(g, b, kn, now, from); if (!j) return; seen[j.id] = 1; const f = L[m.pid] && L[m.pid][j.id]; if (f) { list.push(Object.assign({}, f, { vis: f.vis || j.vis })); return; } list.push(j);
      if (j.ok && j.res && now >= g.start) { L[m.pid] = L[m.pid] || {}; if (Object.keys(L[m.pid]).length < 3000) { L[m.pid][j.id] = j; add++; } } });
    Object.keys(L[m.pid] || {}).forEach((id) => { if (!seen[id]) { const f = L[m.pid][id]; list.push(Object.assign({}, f, { vis: f.vis || (f.kick != null ? now >= f.kick : !!f.d && f.d < chiDay(now)) })); } }); // deleted on the phone after it settled: still counts
    out[m.pid] = list;
  }
  if (add) { try { if (!led) { await D.S.dbPut({ id: GL(g.id), salt: 'x', pinhash: 'x', data: { bets: L }, updated: 1 }, true); } else await D.S.dbPatchIf(GL(g.id), led.updated, { bets: L }, Math.max(D.now(), Number(led.updated || 0) + 1)); } catch (e) {} } // a lost write is redone on the next read
  CACHE.set(g.id, { at: D.now(), u: g.u, v: out }); if (CACHE.size > 200) CACHE.delete(CACHE.keys().next().value);
  return out;
}
async function standings(g, scope, week) {
  const now = D.now(), mb = await memberBets(g), nm = await names();
  const rows = g.members.map((m) => ({ pid: m.pid, name: (m.sid && nm[String(m.sid).slice(0, 8)] && !m.fixedName) ? cleanName(nm[String(m.sid).slice(0, 8)]) : m.name, t: score(g, (mb[m.pid] || []).map((x) => Object.assign({}, x)), scope, week, now), noBets: !m.sid }));
  rank(g, rows);
  const lastW = weekOf(g, g.endDay), curW = Math.max(1, Math.min(lastW, weekOf(g, chiDay(Math.max(now, g.start)))));
  const hs = []; for (let w = 1; w <= Math.min(curW, lastW); w++) { let best = null; rows.forEach((x) => { const s = x.t.weeks[w]; if (!s || s.short || !s.n) return; if (!best || s.val > best.val) best = { week: w, pid: x.pid, name: x.name, val: s.val, n: s.n }; }); const done = now > chiEnd(weekDays(g, w)[1]); if (best) hs.push(Object.assign(best, { done })); }
  return { rows, week: scope === 'week' ? week : null, curW, lastW, high: hs };
}

// ---------- views (what each person may see) ----------
function pub(g, now) { // anyone with the code, or any signed-in player for an open group: rules, take and counts, no member list
  return { id: g.id, name: g.name, sport: g.sport, fmt: g.fmt, start: g.start, startDay: g.startDay, endDay: g.endDay, runs: g.runs, rules: g.rules, join: { requests: g.join.requests, open: g.join.open, max: g.join.max, late: g.join.late },
    count: g.members.length, commName: (g.members.find((m) => m.mk === g.comm) || {}).name || '', takeText: takeText(g.rules), started: started(g, now), ended: ended(g, now), locked: started(g, now), joinUntil: joinOpenUntil(g), weeks: weekOf(g, g.endDay), entry: g.rules.entry, pot: pot(g) };
}
function full(g, mk, now) {
  const o = pub(g, now), comm = isComm(g, mk); o.role = comm ? 'comm' : 'member'; o.code = g.code; o.me = (memberOf(g, mk) || {}).pid;
  o.members = g.members.map((m) => ({ pid: m.pid, name: m.name, paid: !!m.paid, comm: m.mk === g.comm, joined: m.joined, noBets: !m.sid }));
  if (comm) o.reqs = (g.reqs || []).map((q) => ({ pid: q.pid, name: q.name, at: q.at, ver: q.ver, noBets: !q.sid }));
  o.reqCount = (g.reqs || []).length; return o;
}
const canSee = (g, mk) => !!memberOf(g, mk) || isComm(g, mk);
function find(data, id) { const g = data.groups[String(id || '')]; if (!g) throw bad(404, 'Group not found'); return g; }

// ---------- routes ----------
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (!path.startsWith('/groups')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  try {
    const b = await body(req), u = await me(req), ip = D.ip(req), now = D.now(), op = path.slice(8);
    if (op === 'mine') {
      const row = await load(), G = Object.values((row && row.data && row.data.groups) || {});
      const mine = [], open = [], pending = [];
      for (const g of G) {
        if (canSee(g, u.mk)) { const o = full(g, u.mk, now); if (started(g, now) && mine.length < 12) { try { const s = await standings(g, 'season'); const r0 = s.rows.find((x) => x.pid === o.me); o.place = r0 ? r0.place : null; o.myT = r0 ? r0.t : null; o.curW = s.curW; } catch (e) {} } mine.push(o); }
        else if ((g.reqs || []).some((q) => q.mk === u.mk)) pending.push({ id: g.id, name: g.name });
        else if (g.join.open && g.join.requests && !ended(g, now) && now < joinOpenUntil(g) && g.members.length < g.join.max && !(g.denied || []).includes(u.mk)) open.push(pub(g, now));
      }
      mine.sort((a, b) => a.start - b.start); open.sort((a, b) => a.start - b.start);
      send(res, 200, { groups: mine, open: open.slice(0, 30), pending, now }); return true;
    }
    if (op === 'create') {
      rate('create', u.mk, ip); const R = cleanRules(b, now), sid = await sidOf(u.e), nm = await nameOf(u.e, sid, b.myName);
      const g = await mutate((data) => {
        const all = Object.values(data.groups); if (all.length >= MAXG) { all.filter((x) => ended(x, now) && now - chiEnd(x.endDay) > 60 * DAY).forEach((x) => delete data.groups[x.id]); if (Object.keys(data.groups).length >= MAXG) throw bad(503, 'Too many groups right now. Try later.'); }
        if (all.filter((x) => x.comm === u.mk && !ended(x, now)).length >= MAXMINE) throw bad(400, 'You already run ' + MAXMINE + ' groups');
        let id; do { id = rnd(10); } while (data.groups[id]); let code; do { code = newCode(); } while (all.some((x) => x.code === code));
        const gg = Object.assign({ id, code, comm: u.mk, created: now, u: now, members: [], reqs: [], denied: [] }, R);
        gg.members.push({ pid: newPid(gg), mk: u.mk, sid, name: nm, joined: now, paid: false, fixedName: fixed(u.e, sid) });
        data.groups[id] = gg; return gg;
      });
      send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'edit') {
      const g = await mutate((data) => { const g = find(data, b.id); if (!isComm(g, u.mk)) throw bad(403, 'Only the commissioner can change the rules'); if (started(g, now)) throw bad(409, 'Rules are locked. The group has started.');
        const R = cleanRules(b, now); if (R.join.max < g.members.length) throw bad(400, 'More members than that already'); Object.assign(g, R, { u: now }); return g; });
      send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'get') {
      const row = await load(), g = row && row.data && row.data.groups && row.data.groups[String(b.id || '')];
      if (!g) throw bad(404, 'Group not found');
      if (canSee(g, u.mk)) { send(res, 200, { group: full(g, u.mk, now) }); return true; }
      if ((g.join.open && g.join.requests) || (g.reqs || []).some((q) => q.mk === u.mk)) { const o = pub(g, now); o.role = (g.reqs || []).some((q) => q.mk === u.mk) ? 'pending' : 'none'; send(res, 200, { group: o }); return true; }
      throw bad(404, 'Group not found');
    }
    if (op === 'preview' || op === 'join') {
      if (codeBlocked('c|a|' + u.mk) || codeBlocked('c|i|' + ip)) throw bad(429, 'Too many wrong codes. Wait 15 minutes.');
      rate('join', u.mk, ip); const code = normCode(b.code); if (!code) { codeFail('c|a|' + u.mk); codeFail('c|i|' + ip); throw bad(404, 'No group with that code'); }
      const pick = (data) => { const gs = Object.values(data.groups); let hit = null; gs.forEach((g) => { if (sameCode(g.code, code)) hit = g; }); if (!hit) { codeFail('c|a|' + u.mk); codeFail('c|i|' + ip); throw bad(404, 'No group with that code'); } return hit; };
      if (op === 'preview') { const row = await load(); const g = pick((row && row.data) || { groups: {} }); const o = canSee(g, u.mk) ? full(g, u.mk, now) : pub(g, now); if (!canSee(g, u.mk)) o.role = 'none'; send(res, 200, { group: o }); return true; }
      const sid = await sidOf(u.e), nm = await nameOf(u.e, sid, b.myName);
      const g = await mutate((data) => { const g = pick(data); if (memberOf(g, u.mk)) return { nochange: true, v: g };
        if (ended(g, now) || now >= joinOpenUntil(g)) throw bad(409, g.join.late === '2w' ? 'Joining closed 2 weeks after the start' : 'Joining closed at the first kickoff');
        if (g.members.length >= g.join.max) throw bad(409, 'This group is full');
        g.members.push({ pid: newPid(g), mk: u.mk, sid, name: nm, joined: now, paid: false, fixedName: fixed(u.e, sid) }); g.reqs = (g.reqs || []).filter((q) => q.mk !== u.mk); g.u = now; return g; });
      send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'request') {
      rate('join', u.mk, ip); const sid = await sidOf(u.e), nm = await nameOf(u.e, sid, b.myName); let ver = false;
      if (sid) { try { const row = await D.S.dbGet(sid); ver = ((row && row.data && row.data.bets) || []).some((x) => x && x.src === 'kalshi' && x.kt); } catch (e) {} }
      await mutate((data) => { const g = find(data, b.id); if (memberOf(g, u.mk)) throw bad(409, 'You are already in this group');
        if (!g.join.requests) throw bad(409, 'This group is not taking requests');
        if ((g.denied || []).includes(u.mk)) throw bad(409, 'The commissioner said no to this group');
        if (ended(g, now) || now >= joinOpenUntil(g)) throw bad(409, 'Joining is closed');
        if (g.members.length >= g.join.max) throw bad(409, 'This group is full');
        if ((g.reqs || []).some((q) => q.mk === u.mk)) return { nochange: true };
        if ((g.reqs || []).length >= 100) throw bad(409, 'Too many requests waiting');
        g.reqs = g.reqs || []; g.reqs.push({ pid: newPid(g), mk: u.mk, sid, name: nm, at: now, ver, fixedName: fixed(u.e, sid) }); g.u = now; return {}; });
      send(res, 200, { ok: true, pending: true }); return true;
    }
    if (op === 'cancel') { await mutate((data) => { const g = find(data, b.id), n = (g.reqs || []).length; g.reqs = (g.reqs || []).filter((q) => q.mk !== u.mk); if (g.reqs.length === n) return { nochange: true }; g.u = now; return {}; }); send(res, 200, { ok: true }); return true; }
    if (op === 'decide') {
      const g = await mutate((data) => { const g = find(data, b.id); if (!isComm(g, u.mk)) throw bad(403, 'Only the commissioner can approve or deny');
        const q = (g.reqs || []).find((x) => x.pid === String(b.pid || '')); if (!q) throw bad(404, 'That request is gone');
        g.reqs = g.reqs.filter((x) => x !== q);
        if (b.ok) { if (ended(g, now) || now >= joinOpenUntil(g)) throw bad(409, 'Joining is closed'); if (g.members.length >= g.join.max) throw bad(409, 'The group is full'); g.members.push({ pid: q.pid, mk: q.mk, sid: q.sid, name: q.name, joined: now, paid: false, fixedName: !!q.fixedName }); }
        else { g.denied = (g.denied || []).concat(q.mk).slice(-500); }
        g.u = now; return g; });
      send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'requests') {
      const g = await mutate((data) => { const g = find(data, b.id); if (!isComm(g, u.mk)) throw bad(403, 'Only the commissioner can change this'); if (started(g, now)) throw bad(409, 'Rules are locked. The group has started.'); g.join.requests = !!b.on; g.u = now; return g; });
      send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'paid') {
      const g = await mutate((data) => { const g = find(data, b.id); if (!isComm(g, u.mk)) throw bad(403, 'Only the commissioner can mark entries paid'); const m = g.members.find((x) => x.pid === String(b.pid || '')); if (!m) throw bad(404, 'Not a member'); if (!!m.paid === !!b.paid) return { nochange: true, v: g }; m.paid = !!b.paid; g.u = now; return g; });
      send(res, 200, { group: full(g, u.mk, now) }); return true;
    }
    if (op === 'leave') {
      await mutate((data) => { const g = find(data, b.id); if (!memberOf(g, u.mk)) throw bad(404, 'Not a member'); if (isComm(g, u.mk)) throw bad(409, 'The commissioner cannot leave. Delete the group instead (before it starts).'); if (started(g, now)) throw bad(409, 'The group has started. Members stay to the end.'); g.members = g.members.filter((m) => m.mk !== u.mk); g.u = now; return {}; });
      send(res, 200, { ok: true }); return true;
    }
    if (op === 'delete') {
      await mutate((data) => { const g = find(data, b.id); if (!isComm(g, u.mk)) throw bad(403, 'Only the commissioner can delete the group'); if (started(g, now)) throw bad(409, 'The group has started and cannot be deleted'); delete data.groups[g.id]; return {}; });
      send(res, 200, { ok: true }); return true;
    }
    if (op === 'standings' || op === 'player') {
      const row = await load(), g = row && row.data && row.data.groups && row.data.groups[String(b.id || '')];
      if (!g || !canSee(g, u.mk)) throw bad(404, 'Group not found');
      const scope = b.scope === 'week' ? 'week' : 'season', lastW = weekOf(g, g.endDay), curW = Math.max(1, Math.min(lastW, weekOf(g, chiDay(Math.max(now, g.start))))), week = Math.max(1, Math.min(lastW, Math.round(Number(b.week)) || curW));
      if (op === 'standings') { const s = await standings(g, scope, week); send(res, 200, { group: full(g, u.mk, now), scope, week, curW: s.curW, lastW: s.lastW, weekDays: weekDays(g, week), rows: s.rows.map((x) => ({ pid: x.pid, name: x.name, place: x.place, noBets: x.noBets, t: Object.assign({}, x.t, { weeks: undefined }) })), high: s.high, pot: pot(g) }); return true; }
      const m = g.members.find((x) => x.pid === String(b.pid || '')); if (!m) throw bad(404, 'Not a member');
      const mine = m.mk === u.mk, mb = await memberBets(g), list = (mb[m.pid] || []).filter((x) => scope !== 'week' || weekOf(g, x.d) === week);
      const cp = list.map((x) => Object.assign({}, x)), t = score(g, cp, scope, week, now), bestIds = new Set(cp.filter((x) => x.best).map((x) => x.id)); // Best five is marked on ALL the member's bets
      const shown = list.filter((x) => mine || (x.vis && x.ok)); // G6: other members' bets only after kickoff; their not-counted bets stay private
      const hidden = mine ? 0 : list.filter((x) => x.ok && !x.vis).length;
      const bets = shown.sort((a, c) => (c.kick || chiStart(c.d || '2000-01-01')) - (a.kick || chiStart(a.d || '2000-01-01'))).slice(0, 300).map((x) => ({ id: x.id.replace(/[^\w.-]/g, '').slice(0, 40), d: x.d, wk: weekOf(g, x.d), what: x.what, type: x.type, ver: x.ver, stake: x.stake, cs: x.cs, capped: !!x.capped, res: x.res, pl: x.pl, u: x.u, ok: !!x.ok, why: x.why || '', best: bestIds.has(x.id) }));
      send(res, 200, { name: m.name, pid: m.pid, me: mine, scope, week, t: Object.assign({}, t, { weeks: undefined }), bets, hidden }); return true;
    }
    send(res, 404, { error: 'not found' }); return true;
  } catch (e) { if (!e.status) console.error('groups:', e.message); send(res, e.status || 500, { error: e.status ? e.message : 'Groups error, try again' }); return true; }
}
module.exports = { handle, cleanRules, pot, judge, score, sportOk, typeOf, weekOf, chiDay, chiStart, _deps: D, _reset: () => { RL.clear(); CACHE.clear(); IDS.map = null; NAMES = { at: 0, v: {} }; KN.at = 0; KN.map = {}; } };
// Player stats (stats.js, Nov 16 2026) reads standings and counted bets through these. Additive only.
Object.assign(module.exports, { standings, memberBets });
