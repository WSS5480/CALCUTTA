// Phone + PIN sync for Oddable. Stores one small JSON blob per phone number in a Supabase table (REST, no extra packages).
// Env: SUPABASE_URL (https://xxxx.supabase.co) and SUPABASE_KEY (service_role key). Table SQL is in SYNC_SETUP.md.
const crypto = require('crypto');
const FAILS = new Map();
const MAX_BODY = 1.5e6;
const origin = (u) => { try { return new URL(/^https?:/i.test(u.trim()) ? u.trim() : 'https://' + u.trim()).origin; } catch (e) { return ''; } };
const cfg = () => ({ url: origin(process.env.SUPABASE_URL || ''), key: (process.env.SUPABASE_KEY || '').trim() });
const hdr = (k) => ({ apikey: k, ...(k.startsWith('eyJ') ? { Authorization: 'Bearer ' + k } : {}), 'Content-Type': 'application/json' });
const idOf = (phone) => crypto.createHash('sha256').update('oddable|' + phone).digest('hex');
const normPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; };
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Review fix (Nov 16 2026): a row id goes into the database address with every unsafe character encoded ("#" used to start the URL fragment and cut the
// `updated=eq.N` guard off a conditional write; "&" could add a filter). ":" is put back, so every ordinary id (64-hex account ids, `lock:...`, `plog:...`:
// letters, digits and : - _ . ~) gives the SAME address as before, byte for byte (checked in groups.fix1.test.js F3).
const qid = (id) => encodeURIComponent(String(id)).replace(/%3A/g, ':');
async function dbGet(id) {
  const { url, key } = cfg();
  const r = await fetch(`${url}/rest/v1/oddable_sync?id=eq.${qid(id)}&select=*`, { headers: hdr(key), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('db read ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const j = await r.json(); return j[0] || null;
}
async function dbPut(row, ignoreDup) {
  const { url, key } = cfg();
  const r = await fetch(`${url}/rest/v1/oddable_sync`, { method: 'POST', headers: { ...hdr(key), Prefer: (ignoreDup ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates') + ',return=minimal' }, body: JSON.stringify(row) });
  if (!r.ok) throw new Error('db write ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

async function dbPatchIf(id, was, data, upd) {
  const { url, key } = cfg();
  const r = await fetch(`${url}/rest/v1/oddable_sync?id=eq.${qid(id)}&updated=eq.${Number(was || 0)}`, { method: 'PATCH', headers: { ...hdr(key), Prefer: 'return=representation' }, body: JSON.stringify({ data, updated: upd }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('db write ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return (await r.json()).length > 0;
}
const arr = (x) => (Array.isArray(x) ? x : []);
function mergeBase(a, b) { // a = stored, b = incoming. MAIN'S MERGE, UNCHANGED (only renamed): every user's bets pass through this.
  const tomb = [...new Set([...arr(a.tomb), ...arr(b.tomb)].map(String))].slice(-3000), T = new Set(tomb);
  const by = new Map();
  [...arr(a.bets), ...arr(b.bets)].forEach((x) => {
    if (!x || x.id == null || T.has(String(x.id))) return;
    const o = by.get(String(x.id));
    if (!o) by.set(String(x.id), x);
    else if ((x.t || 0) !== (o.t || 0)) by.set(String(x.id), (x.t || 0) > (o.t || 0) ? x : o); // newest edit wins, whichever phone it came from
    else if ((o.res == null) !== (x.res == null)) by.set(String(x.id), x.res != null ? x : o); // same age: keep the one with a result
    else by.set(String(x.id), x);
  });
  // A stats-log reset (logAt) wins over older copies: the side with the newer reset replaces the log outright; with no reset (or equal) the days are merged as before.
  const la = Number(a.logAt || 0), lb = Number(b.logAt || 0);
  const log = la !== lb ? { ...((la > lb ? a : b).log || {}) } : { ...(a.log || {}) };
  if (la === lb) Object.keys(b.log || {}).forEach((k) => { if (!log[k] || JSON.stringify(b.log[k]).length >= JSON.stringify(log[k]).length) log[k] = b.log[k]; });
  const locks = { ...(a.locks || {}) };
  Object.keys(b.locks || {}).forEach((k) => { const o = locks[k], x = b.locks[k]; if (!o || ((x && x.t) || 0) >= ((o && o.t) || 0)) locks[k] = x; });
  const splk = { ...(a.splk || {}) };
  Object.keys(b.splk || {}).forEach((lg) => { const m = { ...(splk[lg] || {}) }; const inc = b.splk[lg] || {}; Object.keys(inc).forEach((g) => { if (!m[g] || (inc[g] && inc[g].r && !m[g].r)) m[g] = inc[g]; }); splk[lg] = m; });
  return {
    locks, splk,
    bets: [...by.values()],
    pins: (b.pinsAt || a.pinsAt) ? (Number(b.pinsAt || 0) >= Number(a.pinsAt || 0) ? arr(b.pins) : arr(a.pins)).map(String).slice(-500) : [...new Set([...arr(a.pins), ...arr(b.pins)].map(String))].slice(-500), // newest pin change wins, so unpinning sticks
    pinsAt: Math.max(Number(a.pinsAt || 0), Number(b.pinsAt || 0)),
    log, logAt: Math.max(la, lb), kdel: [...new Set([...arr(a.kdel), ...arr(b.kdel)])].slice(-3000), tomb,
  };
}

// ---------- Groups layer over the merge (Groups Phase 1, Nov 16 2026; ported from 1e47e93) ----------
// OFF unless GROUPS_ENABLED=1: with the variable unset, merge() IS mergeBase() (same output, field for field; no stamp, no lock, nothing stripped).
// ON, two things are added AROUND mergeBase (its body is never touched):
//  1. Arrival stamp: every bet carries `sa` = the SERVER's time when that bet id first arrived. A phone-sent `sa` is ignored; a stamp, once given, never moves.
//     Bets stored before stamps existed get the row's previous write time (an upper bound).
//  2. Locked group bets (owner decision G16): a stored bet with `gl` (the server time /groups/bet/add saved it) is LOCKED. The stored copy always wins: a phone
//     can't edit, swap or delete it (its tombstone is dropped). Only the phone's own result marks (res / fin / finPL / auto, and each leg's res) are taken, so
//     My Bets still shows a result on every device; the server never grades from them. A phone can't make a bet a group bet: `gl` on an incoming bet the
//     server did not save is removed.
const groupsOn = () => process.env.GROUPS_ENABLED === '1';
const GL_KEEP = ['res', 'fin', 'finPL', 'auto'];
function lockedCopy(st, inc) {
  if (!inc || inc === st) return st; const o = Object.assign({}, st);
  GL_KEEP.forEach((k) => { if (inc[k] !== undefined) o[k] = inc[k]; else delete o[k]; });
  if (Array.isArray(st.legs) && Array.isArray(inc.legs) && inc.legs.length === st.legs.length) o.legs = st.legs.map((l, i) => Object.assign({}, l, { res: inc.legs[i] && inc.legs[i].res !== undefined ? inc.legs[i].res : l.res }));
  return o;
}
function merge(a, b, now, prevU) { // a = stored, b = incoming, now = the server's time of this write, prevU = the row's previous write time
  if (!groupsOn()) return mergeBase(a, b);
  const GL = new Map(arr(a.bets).filter((x) => x && x.id != null && Number(x.gl) > 0).map((x) => [String(x.id), x])); // the stored locked bets
  const noGL = (t) => arr(t).filter((id) => !GL.has(String(id)));
  // before: a locked bet's tombstone is dropped (both sides); `gl` the server did not save is removed from incoming bets
  const a2 = GL.size ? Object.assign({}, a, { tomb: noGL(a.tomb) }) : a;
  const b2 = Object.assign({}, b, { tomb: GL.size ? noGL(b.tomb) : b.tomb, bets: arr(b.bets).map((x) => { if (!x || x.gl === undefined || GL.has(String(x.id))) return x; const y = Object.assign({}, x); delete y.gl; return y; }) });
  const out = mergeBase(a2, b2);
  // after: every locked bet is the STORED copy (plus the phone's result marks from the last incoming copy), whatever mergeBase chose
  if (GL.size) { const inc = new Map(); [...arr(a.bets), ...arr(b2.bets)].forEach((x) => { if (x && x.id != null && GL.has(String(x.id)) && x !== GL.get(String(x.id))) inc.set(String(x.id), x); });
    out.bets = out.bets.map((x) => { const st = GL.get(String(x.id)); return st ? lockedCopy(st, inc.get(String(x.id))) : x; }); }
  // after: the arrival stamp
  const t = Number(now) > 0 ? Number(now) : Date.now(), old = new Map(arr(a.bets).filter((x) => x && x.id != null).map((x) => [String(x.id), Number(x.sa) > 0 ? Number(x.sa) : 0]));
  out.bets = out.bets.map((x) => { const st = old.get(String(x.id)); return Object.assign({}, x, { sa: st !== undefined ? (st > 0 ? st : (Number(prevU) > 0 ? Number(prevU) : t)) : t }); });
  return out;
}

function body(req) {
  return new Promise((ok, no) => { let n = 0; const ch = []; req.on('data', (c) => { n += c.length; if (n <= MAX_BODY) ch.push(c); }); req.on('end', () => { if (n > MAX_BODY) return no(Object.assign(new Error('Your saved bets are too big to sync. Delete some old bets and try again.'), { status: 413 })); try { ok(JSON.parse(Buffer.concat(ch).toString() || '{}')); } catch (e) { no(e); } }); req.on('error', no); });
}
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', '*'); res.end(JSON.stringify(o)); };
function blocked(k) { const t = (FAILS.get(k) || []).filter((x) => Date.now() - x < 15 * 60e3); FAILS.set(k, t); return t.length >= 6; }
const fail = (k) => { const t = FAILS.get(k) || []; t.push(Date.now()); FAILS.set(k, t); };

async function handle(req, res) {
  if (!req.url.startsWith('/sync')) return false;
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type'); res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  const path = req.url.split('?')[0];
  if (path === '/sync/status') { send(res, 200, { configured: !!(cfg().url && cfg().key) }); return true; }
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  if (!cfg().url || !cfg().key) { send(res, 503, { error: 'Sync is not set up on the server yet' }); return true; }
  try {
    const b = await body(req);
    if (path === '/sync/admin') { // owner dashboard feed: called by My Apps with the shared app secret. Phones are never returned (only hashes exist).
      const want = String(process.env.MYAPPS_SECRET || '').trim(), got = String(b.secret || '');
      if (!want || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) { send(res, 401, { error: 'no' }); return true; }
      send(res, 200, { users: await adminUsers(require('./acct').phoneEmail) }); return true;
    }
    // v271: a device that signed in with email + password (or just reset its PIN by email) has no PIN to send. It sends its signed-in token instead (in the body:
    // the /sync CORS header list is unchanged) and gets the SAME row the cell number + PIN opens. See tokenRow() below. Only pull / login / push; never signup.
    if (typeof b.token === 'string' && b.token && b.phone == null && b.pin == null) {
      const t = await tokenRow(b.token); if (t.status) { send(res, t.status, { error: t.error, code: t.code }); return true; }
      if (path === '/sync/login' || path === '/sync/pull') { send(res, 200, { ok: true, data: t.row.data || {}, updated: t.row.updated }); return true; }
      if (path === '/sync/push') return await pushRow(res, t.id, t.row, b);
      send(res, 404, { error: 'not found' }); return true;
    }
    const phone = normPhone(b.phone), pin = String(b.pin || '');
    if (phone.length !== 10) { send(res, 400, { error: 'Enter a 10-digit cell number' }); return true; }
    if (!/^\d{4,10}$/.test(pin)) { send(res, 400, { error: 'PIN must be 4 to 10 digits' }); return true; }
    const id = idOf(phone), ip = require('./ip').clientIp(req);
    if (blocked(id) || blocked('ip:' + ip)) { send(res, 429, { error: 'Too many wrong PINs. Try again in 15 minutes.' }); return true; }
    const row = await dbGet(id);
    if (path === '/sync/signup') {
      if (!row && !/^\d{6,10}$/.test(pin)) { send(res, 400, { error: 'New accounts need a PIN of 6 to 10 digits' }); return true; }
      if (!row && blocked('mk:' + ip)) { send(res, 429, { error: 'Too many new accounts from here. Try later.' }); return true; }
      if (!row) fail('mk:' + ip);
      if (row) { send(res, 409, { error: 'That number already has an account. Use Sign in.' }); return true; }
      const salt = crypto.randomBytes(16).toString('hex');
      const data = merge({}, b.data || {}, Date.now());
      await dbPut({ id, salt, pinhash: hashPin(pin, salt), data, updated: Date.now() }, true);
      const mine = await dbGet(id); if (!mine || !same(hashPin(pin, mine.salt), mine.pinhash)) { send(res, 409, { error: 'That number already has an account. Use Sign in.' }); return true; }
      send(res, 200, { ok: true, data, updated: Date.now() }); return true;
    }
    if (!row || !same(hashPin(pin, row.salt), row.pinhash)) { fail(id); fail('ip:' + ip); send(res, 401, { error: row ? 'Wrong PIN' : 'No account for that number. Use Create account.' }); return true; }
    if (path === '/sync/login' || path === '/sync/pull') { send(res, 200, { ok: true, data: row.data || {}, updated: row.updated }); return true; }
    if (path === '/sync/push') return await pushRow(res, id, row, b);
    send(res, 404, { error: 'not found' }); return true;
  } catch (e) { send(res, e.status || 500, { error: e.status ? e.message : 'Sync error: ' + e.message }); return true; }
}
// The push itself (v271: moved out of handle() unchanged, so the cell number + PIN path and the token path store a push the very same way).
async function pushRow(res, id, row, b) {
  let cur = row;
  for (let i = 0; i < 4; i++) { // never overwrite a write that landed since we read: patch only if `updated` is unchanged, else re-read and merge again
    const upd = Math.max(Date.now(), Number(cur.updated || 0) + 1), data = merge(cur.data || {}, b.data || {}, upd, Number(cur.updated) || 0);
    if (await dbPatchIf(id, cur.updated, data, upd)) { send(res, 200, { ok: true, data, updated: upd }); betEvents(id, cur.data, data); return true; }
    cur = await dbGet(id) || cur;
  }
  send(res, 409, { error: 'Busy, try again' }); return true;
}
// ---------- v271: the bets row of a signed-in ACCOUNT (email + password sign-in, lost-PIN reset) ----------
// A row is keyed by the cell number alone (id = sha256 of it); the PIN is only checked against `salt` + `pinhash` and is not part of the key or of the data.
// The My Apps account id of a phone account is a one-way code of the row id (acct.phoneEmail), so the row of an account is found by trying the row ids:
// acct.js notes the pair on every cell number + PIN sign-in (noteRow), anything else is found with one read of the ids (at most once in 30 s for a miss).
const ROWS = new Map(); let rowsAt = 0;
const noteRow = (acct, id) => { if (acct && id) { if (ROWS.size > 20000) ROWS.clear(); ROWS.set(String(acct), String(id)); } };
async function rowIdFor(acct) {
  acct = String(acct || ''); if (!/^[0-9a-f]{20}@phone\.oddable$/.test(acct)) return null;
  if (ROWS.has(acct)) return ROWS.get(acct);
  if (Date.now() - rowsAt < 30e3) return null; rowsAt = Date.now();
  const pe = require('./acct').phoneEmail; (await dbIds()).forEach((id) => { if (/^[0-9a-f]{64}$/.test(id)) noteRow(pe(id), id); });
  return ROWS.get(acct) || null;
}
// Who may use a token here: only a token acct.js signed for a phone account (tokenAcct: gate on, signature good, not expired, not the owner-PIN token, and not
// signed before that account's PIN or password was last reset). With the gate off no token is accepted at all (its signing key would be guessable).
async function tokenRow(tok) {
  const A = require('./acct'); let e = null; try { e = await A.tokenAcct(tok); } catch (er) {}
  if (!e) return { status: 401, code: 'token', error: 'Sign in again' };
  const id = await rowIdFor(e), row = id ? await dbGet(id) : null;
  if (!row) return { status: 404, code: 'norow', error: 'No saved bets for this account' };
  return { id, row };
}
// A new PIN for an existing row (lost-PIN reset, recover.js, after My Apps has said who proved their email). ONE write that touches only `salt` and `pinhash`:
// the id, the data (bets, log, pins, locks) and `updated` are not in it, so a push landing at the same moment cannot be lost and nothing is re-keyed.
// The old PIN stops working at once (its hash no longer matches); the wrong-PIN lock-out of that row is cleared so the owner of the new PIN can sign in.
async function setPin(id, pin) {
  id = String(id || ''); pin = String(pin || '');
  if (!/^[0-9a-f]{64}$/.test(id) || !/^\d{6,10}$/.test(pin)) return false; // same rule as a new account: 6 to 10 digits
  const { url, key } = cfg(); if (!url || !key) return false;
  const salt = crypto.randomBytes(16).toString('hex');
  const r = await fetch(`${url}/rest/v1/oddable_sync?id=eq.${qid(id)}`, { method: 'PATCH', headers: { ...hdr(key), Prefer: 'return=representation' }, body: JSON.stringify({ salt, pinhash: hashPin(pin, salt) }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('db write ' + r.status);
  const ok = (await r.json()).length === 1; if (ok) FAILS.delete(id); return ok;
}
const ready = () => !!(cfg().url && cfg().key);
// Activity events (events.js): AFTER a push is stored and answered, My Apps is told when it added new bets. Runs later (setImmediate), only reads the two
// objects, can never throw into the request, and does nothing at all with EVENTS_ENABLED=0 or when My Apps is not set up.
function betEvents(id, before, after) { setImmediate(() => { try { const EV = require('./events'); if (EV.enabled()) EV.betsPushed(require('./acct').phoneEmail(id), before || {}, after); } catch (e) {} }); }
async function adminUsers(emailOf) {
  const { url, key } = cfg();
  // Groups Phase 1: once Groups is ON (many shared 'lock:' rows), ask the database to leave those rows out, so they can never use up the 2,000-row limit.
  // NOT yet checked against the live database: if the filtered query is refused, main's own query (the line after) is used, so the owner dashboard cannot
  // break because of it. While Groups is OFF only main's own query is sent, exactly as before. The JS filter below stays either way.
  let r = groupsOn() ? await fetch(`${url}/rest/v1/oddable_sync?select=id,updated,data&id=not.like.lock:*&limit=2000`, { headers: hdr(key) }).catch(() => null) : null;
  if (!r || !r.ok) r = await fetch(`${url}/rest/v1/oddable_sync?select=id,updated,data&limit=2000`, { headers: hdr(key) });
  if (!r.ok) throw new Error('db read ' + r.status);
  const rows = (await r.json()).filter((x) => !String(x.id).startsWith('lock:')); // shared lock rows are not players
  return rows.map((x) => {
    const d = x.data || {}, bets = arr(d.bets), log = d.log || {}, days = {}, N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    let w = 0, l = 0, p = 0, risk = 0, pl = 0;
    Object.keys(log).forEach((k) => { const o = log[k] || {}; w += N(o.w); l += N(o.l); p += N(o.p); risk += N(o.risk); pl += N(o.settled); days[k] = { n: N(o.n), w: N(o.w), l: N(o.l), p: N(o.p), risk: Math.round(N(o.risk) * 100) / 100, pl: Math.round(N(o.settled) * 100) / 100 }; });
    // Per-bet remembered results (fin/finPL, v163+) are the most complete; use them when they cover at least as many bets as the frozen daily log.
    let bw = 0, bl = 0, bp = 0, bpl = 0; bets.forEach((b) => { if (b && b.fin) { if (b.fin === 'won') bw++; else if (b.fin === 'lost') bl++; else if (b.fin === 'push') bp++; bpl += N(b.finPL); } });
    // (v220) totals are rebuilt day by day below from the daily log AND the bets, see the merge after `placed`
    let dayKeys = Object.keys(days).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    const lbl = (b) => String(b.text || (b.kind === 'parlay' ? arr(b.legs).length + '-leg parlay' : (b.side || '?') + ' ' + (b.line ? (b.line > 0 ? '+' : '') + b.line : 'ML') + (b.away && b.home ? ' (' + b.away + '@' + b.home + ')' : ''))).slice(0, 90);
    const open = bets.filter((b) => b && !b.fin && !b.res && (N(b.stake) || b.text || b.side || b.kind === 'parlay')).sort((a, c) => N(c.t) - N(a.t)).slice(0, 60).map((b) => ({ day: String(b.day || '').slice(0, 10), what: lbl(b), stake: N(b.stake), odds: N(b.odds) || null }));
    const placed = {}; bets.forEach((b) => { if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.day || '').slice(0, 10))) return; if (!N(b.stake) && !b.text && !b.side) return; const k = String(b.day).slice(0, 10), o = placed[k] || (placed[k] = { n: 0, w: 0, l: 0, p: 0, risk: 0, pl: 0, o: 0 }); o.n++; o.risk += N(b.stake); if (b.fin === 'won') { o.w++; o.pl += N(b.finPL); } else if (b.fin === 'lost') { o.l++; o.pl += N(b.finPL); } else if (b.fin === 'push') { o.p++; } else o.o++; });
    Object.keys(placed).forEach((k) => { placed[k].risk = Math.round(placed[k].risk * 100) / 100; placed[k].pl = Math.round(placed[k].pl * 100) / 100; });
    // v220 win/loss fix: the daily log keeps results of deleted bets (so it can be higher than the bets) but it skips today and can go stale; the bets are current but miss deleted ones.
    // For each day take the bets unless the log has MORE settled bets (a tie goes to the bets: they hold the actual settled money, the log is figured from displayed odds), then add them up. Deleted bets keep counting (Steve, Nov 15), today and stale days are no longer missed.
    Object.keys(placed).forEach((k) => { const pd = placed[k], d = days[k], ps = pd.w + pd.l + pd.p; if (!d) { if (ps) days[k] = { n: pd.n, w: pd.w, l: pd.l, p: pd.p, risk: pd.risk, pl: pd.pl }; } else if (ps > 0 && ps >= d.w + d.l + d.p) days[k] = { n: Math.max(d.n, pd.n), w: pd.w, l: pd.l, p: pd.p, risk: Math.max(d.risk, pd.risk), pl: pd.pl }; });
    w = l = p = risk = pl = 0; Object.keys(days).forEach((k) => { const d = days[k]; w += d.w; l += d.l; p += d.p; risk += d.risk; pl += d.pl; });
    bets.forEach((x) => { if (x && x.fin && !/^\d{4}-\d{2}-\d{2}$/.test(String(x.day || '').slice(0, 10))) { if (x.fin === 'won') w++; else if (x.fin === 'lost') l++; else if (x.fin === 'push') p++; pl += N(x.finPL); } }); // settled bets with no day recorded
    dayKeys = Object.keys(days).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    const list = bets.filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(String(b.day || '').slice(0, 10)) && (N(b.stake) || b.text || b.side)).sort((a, c) => N(c.t) - N(a.t)).slice(0, 300).map((b) => ({ day: String(b.day).slice(0, 10), what: lbl(b), stake: N(b.stake), odds: N(b.odds) || null, fin: b.fin === 'won' || b.fin === 'lost' || b.fin === 'push' ? b.fin : (b.res ? 'res' : ''), pl: b.fin === 'won' || b.fin === 'lost' ? N(b.finPL) : 0 }));
    const openC = open.filter((b) => b.stake || !/^ \?/.test(b.what));
    return { id: String(x.id).slice(0, 20), placed, list, open: openC, acct: emailOf ? emailOf(String(x.id)) : null, tag: String(x.id).slice(0, 4), updated: x.updated || 0, bets: bets.length, picks: Object.keys(d.locks || {}).length, w, l, p, pct: w + l ? Math.round((w / (w + l)) * 1000) / 10 : null, risk: Math.round(risk * 100) / 100, pl: Math.round(pl * 100) / 100, first: dayKeys[0] || null, last: dayKeys[dayKeys.length - 1] || null, days: dayKeys.slice(-400).reverse().map((k) => Object.assign({ day: k }, days[k])) };
  }).sort((a, b) => b.updated - a.updated);
}

// Used by acct.js: verify (or create) a phone+PIN account. Returns the stable id (sha256 of the phone). Throws {status,error}.
async function verifyLogin(phone, pin, ip, create) {
  phone = normPhone(phone); pin = String(pin || '');
  const bad = (status, error) => Object.assign(new Error(error), { status });
  if (!cfg().url || !cfg().key) throw bad(503, 'Phone sign-in is not set up on the server');
  if (phone.length !== 10) throw bad(400, 'Enter a 10-digit cell number');
  if (!/^\d{4,10}$/.test(pin)) throw bad(400, 'PIN must be 4 to 10 digits');
  const id = idOf(phone);
  if (blocked(id) || blocked('ip:' + ip)) throw bad(429, 'Too many wrong PINs. Try again in 15 minutes.');
  const row = await dbGet(id);
  if (!row) {
    if (create && !/^\d{6,10}$/.test(pin)) throw bad(400, 'New accounts need a PIN of 6 to 10 digits');
    if (create && blocked('mk:' + ip)) throw bad(429, 'Too many new accounts from here. Try later.');
    if (!create) { fail('ip:' + ip); throw bad(401, 'No account for that number. Use Create account.'); }
    fail('mk:' + ip); const salt = crypto.randomBytes(16).toString('hex');
    await dbPut({ id, salt, pinhash: hashPin(pin, salt), data: {}, updated: Date.now() }, true);
    const mine = await dbGet(id); if (!mine || !same(hashPin(pin, mine.salt), mine.pinhash)) throw bad(409, 'That number already has an account. Use Sign in.'); // lost a simultaneous sign-up
    return { id, created: true };
  }
  if (create) throw bad(409, 'That number already has an account. Use Sign in.');
  if (!same(hashPin(pin, row.salt), row.pinhash)) { fail(id); fail('ip:' + ip); throw bad(401, 'Wrong PIN'); }
  return { id, created: false };
}
// Groups (groups.js): every player row id (no data), to find a signed-in phone account's own synced bets row. Shared 'lock:' rows are left out.
// If the database refuses the 'lock:' filter, the same read is done without it (the JS filter below still removes them).
async function dbIds() {
  const { url, key } = cfg(), o = { headers: hdr(key), signal: AbortSignal.timeout(15000) };
  let r = await fetch(`${url}/rest/v1/oddable_sync?select=id&id=not.like.lock:*&limit=5000`, o).catch(() => null);
  if (!r || !r.ok) r = await fetch(`${url}/rest/v1/oddable_sync?select=id&limit=5000`, { headers: hdr(key), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('db read ' + r.status);
  return (await r.json()).map((x) => String(x.id)).filter((id) => !id.startsWith('lock:'));
}
// (1e47e93 also added dbList(prefix); nothing in Groups calls it, so it was not ported.)
module.exports = { handle, merge, mergeBase, groupsOn, normPhone, verifyLogin, adminUsers, dbGet, dbPut, dbPatchIf, dbIds, ready, noteRow, rowIdFor, setPin, idOf }; // v271: ready / noteRow / rowIdFor / setPin / idOf (acct.js, recover.js)
