// Oddable accounts + paywall. Talks to My Apps (MY_APPS_MANAGEMENT) with Oddable's app secret; the browser never sees it.
// Env: MYAPPS_URL (e.g. https://my-apps.onrender.com), MYAPPS_SECRET (= APP_SECRET_ODDABLE on My Apps). Optional: GATE_KEY (token signing), GATE_OFF=1, OWNER_PIN (owner enters it on the sign-in screen: free access, no payment).
// With MYAPPS_URL or MYAPPS_SECRET missing the gate is OFF and the app stays open (fail-open until configured).
const crypto = require('crypto');
const SLUG = 'oddable';
const syncMod = require('./sync');
const URL_ = () => (process.env.MYAPPS_URL || '').trim().replace(/\/$/, '');
const SECRET = () => (process.env.MYAPPS_SECRET || '').trim();
const KEY = () => process.env.GATE_KEY || crypto.createHash('sha256').update('oddable-gate|' + SECRET()).digest('hex');
const on = () => !!(URL_() && SECRET()) && process.env.GATE_OFF !== '1';
// ---- v268 guest mode ----
// GUEST_MODE (Render env on the odds server): unset / anything else = ON, visitors with no account browse scores, standings, PGA, Golf GPS and Pickleball and are asked to
// sign up for picks, My Bets and Groups. GUEST_MODE=0 (or false / off / no) = the full sign-in wall before anything, exactly as before v268. The phone reads it from /acct/status.
const guestMode = () => !/^(0|false|off|no)$/i.test(String(process.env.GUEST_MODE == null ? '' : process.env.GUEST_MODE).trim());
// A sharing code the phone remembered from "?ref=<code>" and sends with the sign-up. Letters, digits, - and _, at most 24; anything else is dropped. Passed on to My Apps
// `register`, which ignores fields it does not know (store.register destructures slug / secret / email / password / name / code), so it does nothing until My Apps reads it.
const cleanRef = (r) => (typeof r === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(r) ? r : '');
// ---- end v268 ----
const TOK_DAYS = 30;
const b64 = (s) => Buffer.from(s).toString('base64url');
const sig = (p) => crypto.createHmac('sha256', KEY()).update(p).digest('base64url');
const pinVer = () => crypto.createHash('sha256').update('pin|' + String(process.env.OWNER_PIN || '')).digest('hex').slice(0, 8);
function mint(email) { const p = b64(JSON.stringify(email === 'owner' ? { e: email, v: pinVer(), x: Date.now() + TOK_DAYS * 864e5 } : { e: email, x: Date.now() + TOK_DAYS * 864e5 })); return p + '.' + sig(p); }
function verify(t) {
  const [p, s] = String(t || '').split('.'); if (!p || !s) return null;
  const want = sig(p); if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); if (o.e === 'owner' && o.v !== pinVer()) return null; // changing OWNER_PIN signs the old owner tokens out
    if (o.x > Date.now() && REV[o.e] && o.x - TOK_DAYS * 864e5 < REV[o.e]) return null; // v271: signed before this account's PIN / password was last reset (see revoke)
    return o.x > Date.now() ? o.e : null; } catch (e) { return null; }
}
// ---- v271: sign every device out after a lost-PIN or lost-password reset ----
// A token carries no issue time, but it is always signed for TOK_DAYS, so it was issued at (x - TOK_DAYS). revoke(account) stamps "now" for the account; verify()
// then refuses that account's tokens issued before the stamp, on this server at once and for good: the stamps are kept in the row 'lock:pinrev' of oddable_sync
// (the 'lock:' prefix keeps it out of every player list) and read back at most once a minute (revLoad), so a restart does not forget them. A stamp older than
// TOK_DAYS is dropped (those tokens have expired anyway). If the row cannot be read or written the reset still goes through; the stamp then lives in memory only.
let REV = {}, revAt = 0;
const revClean = (m) => { const o = {}, lim = Date.now() - (TOK_DAYS + 1) * 864e5; Object.keys(m || {}).forEach((k) => { const t = Number(m[k]); if (t > lim) o[k] = t; }); return o; };
async function revLoad(force) {
  if (!syncMod.ready() || (!force && Date.now() - revAt < 60e3)) return; revAt = Date.now();
  try { const r = await syncMod.dbGet('lock:pinrev'), m = revClean(r && r.data && r.data.rev); Object.keys(REV).forEach((k) => { if (!(m[k] >= REV[k])) m[k] = REV[k]; }); REV = revClean(m); } catch (e) {}
}
async function revoke(account) {
  const t = Date.now(); REV[account] = t;
  if (!syncMod.ready()) return;
  for (let i = 0; i < 4; i++) {
    try {
      let r = await syncMod.dbGet('lock:pinrev'); if (!r) { await syncMod.dbPut({ id: 'lock:pinrev', salt: 'x', pinhash: 'x', data: { rev: {} }, updated: 1 }, true); r = await syncMod.dbGet('lock:pinrev'); if (!r) continue; }
      const rev = revClean(Object.assign({}, r.data && r.data.rev, { [account]: t }));
      if (await syncMod.dbPatchIf('lock:pinrev', r.updated, { rev }, Math.max(Date.now(), Number(r.updated || 0) + 1))) return;
    } catch (e) { return; }
  }
}
// Was this a good token of ours that a reset has since signed out? (so the phone can say "sign in again" instead of treating it as a stranger)
function revoked(t) { try { const [p, s] = String(t || '').split('.'); if (!p || !s) return false; const w = sig(p); if (s.length !== w.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(w))) return false; const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return !!(REV[o.e] && o.x > Date.now() && o.x - TOK_DAYS * 864e5 < REV[o.e]); } catch (e) { return false; } }
// For sync.js and recover.js: the account inside a good token (never the owner-PIN token), or null. The gate must be on: with it off the signing key is guessable.
async function tokenAcct(t) { if (!on()) return null; await revLoad(); const e = verify(t); return e && e !== 'owner' ? e : null; }
// ---- end v271 ----
const MAX = 20000;
const body = (req) => new Promise((res, rej) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n > MAX) { rej(new Error('too big')); req.destroy(); } else c.push(d); }); req.on('end', () => { try { res(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { rej(e); } }); req.on('error', rej); });
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
async function ma(path, data) {
  const r = await fetch(URL_() + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ slug: SLUG, secret: SECRET() }, data)), signal: AbortSignal.timeout(25000) });
  const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j };
}
// Slow-down for password guessing: 8 tries / 10 min per ip+email.
const TRY = new Map();
function throttled(k, max) { if (TRY.size > 5000) { let n = 0; for (const k of TRY.keys()) { TRY.delete(k); if (++n >= 1000) break; } } /* evict the oldest, never wipe every throttle */ const t = Date.now(), a = (TRY.get(k) || []).filter((x) => t - x < 600e3); if (a.length >= (max || 8)) { TRY.set(k, a); return true; } a.push(t); TRY.set(k, a); return false; }
const OWNER_PIN = () => String(process.env.OWNER_PIN || '').trim();
const OWNER_ME = { email: 'owner', role: 'owner', plan: 'pro', expires_on: null, source: 'owner', allowed: true, pending: false, price: 99, link: null, tag: null, payReady: true };
const chiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
// v263. A customer's Cash App handle as My Apps stores it (optional $, 1-20 letters, digits, _ or -); anything else is not passed on to the phone.
const okHint = (h) => (typeof h === 'string' && h.length <= 80 && !/[<>&"'\u0000-\u001f]/.test(h) ? h : ''); // v271: a masked address like "s•••@gmail.com", never the address itself
const okTag = (t) => (typeof t === 'string' && /^\$?[A-Za-z0-9_-]{1,20}$/.test(t.trim()) ? t.trim() : '');
// v263. Free-time request note: plain text, control characters and line breaks become spaces, runs of spaces collapse, trimmed. null = not text.
const cleanNote = (n) => (n == null ? '' : typeof n !== 'string' ? null : n.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim());
const TIME_ERR = { limit: [429, 'You have asked 3 times in the last 7 days. Please try again later.'], busy: [429, 'Lots of requests right now. Please try again later.'], note: [400, 'Keep the note to 140 characters or less.'] };
const isoOrNull = (x) => (typeof x === 'string' && x.length < 40 && !isNaN(Date.parse(x)) ? x : null);
const allowed = (a) => a && (a.role === 'owner' || (a.plan === 'pro' && !(a.expires_on && String(a.expires_on).slice(0, 10) < chiToday()))); // an ended plan never counts, even if the console still says pro
// Entitlement cache so every AI call does not hit My Apps.
const CACHE = new Map();
async function entitlement(email, fresh) {
  const c = CACHE.get(email); if (!fresh && c && Date.now() - c.t < 120e3) return c.v;
  const r = await ma('/api/v1/account', { email });
  if (!r.ok && r.status !== 404 && r.status !== 403) throw new Error('Account service unavailable'); // asleep or misconfigured: never treat as "no account", never cache
  const v = r.ok ? r.j : null; CACHE.set(email, { t: Date.now(), v }); return v;
}
async function shape(email, fresh) {
  const a = await entitlement(email, fresh); if (!a) return null;
  const info = await ma('/api/v1/pay/info', { account: email });
  const p = info.ok ? info.j : {};
  return { email: a.email, role: a.role, plan: a.plan, expires_on: a.expires_on, source: a.source, allowed: !!allowed(a), pending: !!a.pending || !!p.pending,
    price: p.price || a.price || 99, link: p.link || null, tag: p.tag || null, payReady: !!p.configured, cashtag: okTag(p.cashtag), // tag = the OWNER's tag (where to pay); cashtag = this customer's own saved handle (v263)
    // v271, from My Apps /api/v1/account (builds .38 and .41), at the END so every older field is where it was. An older My Apps does not send them: then
    // has_email_login is null ("not known": the phone offers nothing) and ref_locked is true (the phone never sends a code).
    has_contact: a.has_contact === true, contact_verified: a.contact_verified === true, contact_hint: okHint(a.contact_hint),
    has_email_login: a.has_email_login === true ? true : a.has_email_login === false ? false : null, influencer: a.influencer === true, ref_locked: a.ref_locked !== false };
}
// For other routes (AI): returns true if the request carries a valid token for an allowed account (or the gate is off).
async function check(req) {
  if (!on()) return true;
  const e = verify(req.headers['x-token']); if (!e) return false;
  if (e === 'owner') return !!OWNER_PIN();
  try { return !!allowed(await entitlement(e, false)); } catch (er) { return false; }
}
// v268 (owner, Nov 16 2026: an account whose time has ended is "as guest until they pay"). true ONLY when My Apps answers with the account and its time has ended.
// Gate off, the owner, no account id, an account My Apps does not know, or My Apps not answering = false (never lock somebody out, or drop an alert, on a guess).
// Uses the 2-minute entitlement cache above, so betwatch.js and groups.js can ask on every pass. An account with no end date (everything is free for now) is never expired.
async function expired(e) { if (!on() || !e || e === 'owner') return false; try { const a = await entitlement(e, false); return !!a && !allowed(a); } catch (er) { return false; } }
async function handle(req, res) {
  if (req.method === 'OPTIONS') return false;
  const path = req.url.split('?')[0];
  if (path === '/acct/status') { send(res, 200, { gate: on(), guest: guestMode() }); return true; } // v268: guest = visitors with no account may browse scores (see guestMode)
  if (req.method !== 'POST' && !(req.method === 'GET' && path === '/acct/time/status')) return false; // v263: the time status may also be read with GET (x-token header)
  if (!on()) { send(res, 200, { gate: false }); return true; }
  const ip = require('./ip').clientIp(req); // third from the end of X-Forwarded-For (see ip.js)
  let b; try { b = await body(req); } catch (e) { send(res, 400, { error: 'bad request' }); return true; }
  const email = String(b.email || '').trim().toLowerCase();
  const cleanName = (n) => String(n || '').replace(/[<>&"'\u0000-\u001f]/g, '').trim().slice(0, 24);
  try {
    if (path === '/acct/owner') {
      if (!OWNER_PIN()) { send(res, 400, { error: 'Owner PIN is not set on the server' }); return true; }
      if (throttled(ip + '|owner')) { send(res, 429, { error: 'Too many tries, wait a few minutes' }); return true; }
      const a = Buffer.from(String(b.pin || '')), w = Buffer.from(OWNER_PIN());
      if (a.length !== w.length || !crypto.timingSafeEqual(a, w)) { send(res, 401, { error: 'Wrong PIN' }); return true; }
      send(res, 200, { token: mint('owner'), me: OWNER_ME }); return true;
    }
    if (path === '/acct/phone') {
      // Existing Oddable users keep their cell number + PIN. It maps to a My Apps account (7-day trial, then Cash App renewal).
      if (b.create && OWNER_PHONES().includes(syncMod.normPhone(b.phone))) { send(res, 403, { error: 'This number cannot be created here' }); return true; } // an owner phone is never created by a stranger
      const nm0 = cleanName(b.name); if (b.create && nm0.length < 2) { send(res, 400, { error: 'Enter a name or handle to create your account' }); return true; }
      let v; try { v = await syncMod.verifyLogin(b.phone, b.pin, ip, !!b.create); } catch (er) { send(res, er.status || 500, { error: er.message }); return true; }
      const pe = phoneEmail(v.id), pw = crypto.createHmac('sha256', KEY()).update('phone|' + v.id).digest('hex').slice(0, 32);
      syncMod.noteRow(pe, v.id); // v271: remembered so a token for this account can find its bets row (sync.js rowIdFor)
      const rf = b.create ? cleanRef(b.ref) : ''; // v268: the sharing code goes along only when an account is being created
      let r = await ma('/api/v1/auth/register', Object.assign({ email: pe, password: pw, name: b.create && nm0 ? nm0 : 'Phone ' + v.id.slice(0, 4) }, rf ? { ref: rf } : {}));
      if (b.create && nm0) { try { await namesSet(String(v.id).slice(0, 8), nm0); } catch (er) {} }
      if (!r.ok && r.status === 409) r = await ma('/api/v1/auth/login', { email: pe, password: pw });
      if (!r.ok) { send(res, 502, { error: r.j.error || 'Could not open your account' }); return true; }
      CACHE.delete(pe);
      const me = await shape(pe, true); if (me && isOwnerPhone(pe)) me.ownerDash = true; send(res, 200, { token: mint(pe), me }); return true;
    }
    if (path === '/acct/login' || path === '/acct/register') {
      if (path === '/acct/register' && cleanName(b.name).length < 2) { send(res, 400, { error: 'Enter a name or handle to create your account' }); return true; }
      if (/@phone\.oddable$/.test(email)) { send(res, 400, { error: 'Use your cell number and PIN to sign in' }); return true; }
      if (throttled(ip + '|' + email)) { send(res, 429, { error: 'Too many tries, wait a few minutes' }); return true; }
      const rf = path === '/acct/register' ? cleanRef(b.ref) : ''; // v268: sharing code, sign-up only
      const r = await ma(path === '/acct/login' ? '/api/v1/auth/login' : '/api/v1/auth/register', Object.assign({ email, password: b.password, name: cleanName(b.name) }, rf ? { ref: rf } : {}));
      if (!r.ok) { send(res, r.status === 401 || r.status === 409 || r.status === 400 ? r.status : 502, { error: r.j.error || 'Could not sign in' }); return true; }
      // v271 (My Apps contract 5i): "Use `account` from the login answer, never the email the person typed." An email + password that is LINKED to a phone account
      // answers with that phone account's id, so the token, the plan and the bets row are the same ones the cell number + PIN opens. For an ordinary email
      // account `account` is the email itself, and an older My Apps sends none: both give exactly what this line did before.
      const ja = typeof r.j.account === 'string' ? r.j.account.trim().toLowerCase() : '';
      const acct = ja && (ja === email || /^[0-9a-f]{20}@phone\.oddable$/.test(ja)) ? ja : email;
      CACHE.delete(acct);
      const me = await shape(acct, true); if (me && acct !== email && isOwnerPhone(acct)) me.ownerDash = true;
      send(res, 200, { token: mint(acct), me }); return true;
    }
    await revLoad(); // v271: at most one small read a minute (the reset stamps)
    const e = verify(b.token || req.headers['x-token']);
    if (!e) { send(res, 401, revoked(b.token || req.headers['x-token']) ? { error: 'Your PIN or password was changed. Sign in again.', code: 'resign' } : { error: 'Sign in again' }); return true; }
    if (path === '/acct/dunlock') {
      if (!isOwnerPhone(e) || !OWNER_PIN()) { send(res, 403, { error: 'Not an owner account' }); return true; }
      if (throttled(ip + '|dunlock') || throttled(e + '|dunlock')) { send(res, 429, { error: 'Too many tries, wait a few minutes' }); return true; }
      const a = Buffer.from(String(b.pin || '')), w = Buffer.from(OWNER_PIN()); if (a.length !== w.length || !crypto.timingSafeEqual(a, w)) { send(res, 401, { error: 'Wrong owner PIN' }); return true; }
      send(res, 200, { dash: dmint(e) }); return true;
    }
    if (path === '/acct/myname') { // a signed-in player sets or reads their own name / handle (phone accounts; email accounts gave a name at sign-up)
      if (!/@phone\.oddable$/.test(e)) { send(res, 200, { ok: true, name: e === 'owner' ? OWNER_NAME() : '' }); return true; }
      const us = await require('./sync').adminUsers(phoneEmail), u = us.find((x) => phoneEmail(x.id) === e); if (!u) { send(res, 404, { error: 'Account not found' }); return true; }
      const k = String(u.id).slice(0, 8), nm = await namesGet().catch(() => ({})), nn = cleanName(b.name);
      if (isOwnerPhone(e)) { send(res, 200, { ok: true, name: OWNER_NAME() }); return true; }
      if (!b.name) { send(res, 200, { ok: true, name: nm[k] || '' }); return true; }
      if (nn.length < 2) { send(res, 400, { error: 'Enter a name or handle (2+ characters)' }); return true; }
      try { await namesSet(k, nn); send(res, 200, { ok: true, name: nn }); } catch (er) { send(res, 502, { error: 'Could not save the name' }); } return true;
    }
    if ((path === '/acct/name' || path === '/acct/dash') && isOwnerPhone(e) && !dok(req.headers['x-dash'], e)) { send(res, 401, { error: 'Owner PIN needed', need: 'owner-pin' }); return true; }
    if (path === '/acct/name' && ((e === 'owner' && OWNER_PIN()) || isOwnerPhone(e))) {
      const k = String(b.k || ''), name = String(b.name || '').replace(/[<>&"'\u0000-\u001f]/g, '').trim().slice(0, 24);
      if (!/^[0-9a-f]{8}$/.test(k)) { send(res, 400, { error: 'Bad player' }); return true; }
      try { await namesSet(k, name); send(res, 200, { ok: true, name }); } catch (er) { send(res, 502, { error: 'Could not save the name: ' + er.message }); } return true;
    }
    if (path === '/acct/dash' && ((e === 'owner' && OWNER_PIN()) || isOwnerPhone(e))) {
  { try { const us = await require('./sync').adminUsers(null); const nm = await namesGet().catch(() => ({})); send(res, 200, { users: us.map((u) => ({ k: String(u.id).slice(0, 8), name: (isOwnerPhone(phoneEmail(u.id)) ? OWNER_NAME() : nm[String(u.id).slice(0, 8)]) || '', tag: u.tag, updated: u.updated, bets: u.bets, w: u.w, l: u.l, p: u.p, risk: u.risk, pl: u.pl, open: u.open, placed: u.placed, list: u.list, days: u.days })) }); } catch (er) { send(res, 502, { error: 'Could not read players: ' + er.message }); } return true; }
    }
    if (e === 'owner') { if (!OWNER_PIN()) { send(res, 401, { error: 'Sign in again' }); return true; }
      if (path === '/acct/me') { send(res, 200, { me: OWNER_ME }); return true; } send(res, 400, { error: 'Owner has full access' }); return true; }
    if (path === '/acct/me') { const me = await shape(e, true); if (!me) { send(res, 401, { error: 'Account not found or suspended' }); return true; } if (isOwnerPhone(e)) me.ownerDash = true; send(res, 200, { me }); return true; }
    if (path === '/acct/push-key') {
      if (e === 'owner') { send(res, 400, { error: 'Owner has no renewals' }); return true; }
      const r = await ma('/api/v1/push/key', {}); send(res, r.ok ? 200 : (r.status || 502), r.ok ? { key: r.j.key } : { error: r.j.error || 'Reminders are not set up yet' }); return true;
    }
    if (path === '/acct/push') {
      if (e === 'owner') { send(res, 400, { error: 'Owner has no renewals' }); return true; }
      const r = await ma('/api/v1/push/subscribe', { account: e, subscription: b.subscription });
      send(res, r.ok ? 200 : (r.status || 502), r.ok ? { ok: true } : { error: r.j.error || 'Could not turn reminders on' }); return true;
    }
    if (path === '/acct/pay') {
      // v263: optional Cash App handle of the payer, so the owner can match the payment. My Apps owns the rule; its 400 message is passed on.
      const ct = typeof b.cashtag === 'string' ? b.cashtag.trim().slice(0, 40) : '';
      const r = await ma('/api/v1/pay/request', ct ? { account: e, cashtag: ct } : { account: e });
      if (!r.ok) { send(res, r.status === 400 && ct ? 400 : 502, { error: r.j.error || 'Could not record your payment' }); return true; }
      CACHE.delete(e); send(res, 200, { ok: true, ref: r.j.ref, link: r.j.link, amount: r.j.amount, cashtag: okTag(r.j.cashtag) }); return true;
    }
    if (path === '/acct/time/request') { // v263: ask the owner for free time. The account is the signed-in one from the token, never one sent by the phone.
      if (throttled(ip + '|timereq') || throttled(e + '|timereq')) { send(res, 429, { ok: false, error: 'Too many tries, wait a few minutes' }); return true; }
      const note = cleanNote(b.note);
      if (note === null || note.length > 140) { send(res, 400, { ok: false, code: 'note', error: TIME_ERR.note[1] }); return true; }
      const r = await ma('/api/v1/time/request', note ? { account: e, note } : { account: e });
      if (r.ok && r.j.ok !== false) { send(res, 200, { ok: true, status: 'pending', already: !!r.j.already }); return true; }
      const m = TIME_ERR[r.j.error]; // anything else (bad secret, unknown app, My Apps down) gets a plain message, never the upstream text
      send(res, m ? m[0] : 502, { ok: false, code: m ? r.j.error : 'failed', error: m ? m[1] : 'Could not send your request. Please try again later.' }); return true;
    }
    if (path === '/acct/time/status') { // v263: the latest request of the signed-in account
      if (throttled(e + '|timest', 30)) { send(res, 429, { ok: false, error: 'Too many tries, wait a few minutes' }); return true; }
      const r = await ma('/api/v1/time/status', { account: e }), st = r.j.status;
      if (!r.ok || r.j.ok === false || !['none', 'pending', 'granted', 'declined'].includes(st)) { send(res, 502, { ok: false, code: 'failed', error: 'Could not check your request. Please try again later.' }); return true; }
      const d = Number(r.j.days);
      if (st === 'granted') CACHE.delete(e); // the days are already on the account: read it fresh next time
      send(res, 200, { ok: true, status: st, days: st === 'granted' && r.j.days != null && Number.isFinite(d) && d > 0 ? d : null, requested_at: isoOrNull(r.j.requested_at), decided_at: isoOrNull(r.j.decided_at) }); return true;
    }
    if (path === '/acct/redeem') {
      if (throttled(ip + '|redeem') || throttled(e + '|redeem')) { send(res, 429, { error: 'Too many tries, wait a few minutes' }); return true; }
      const r = await ma('/api/v1/redeem', { account: e, code: String(b.code || '').trim() });
      if (!r.ok) { send(res, 400, { error: r.j.error || 'Code not valid' }); return true; }
      CACHE.delete(e); send(res, 200, { me: await shape(e, true) }); return true;
    }
  } catch (er) { send(res, 502, { error: 'Account service is waking up, try again in a moment' }); return true; }
  return false;
}
// Player names the owner types in the dashboard. Stored in the row 'lock:names' (the 'lock:' prefix keeps it out of every player list).
const OWNER_NAME = () => process.env.OWNER_NAME || 'Sir Oddable';
async function namesGet() { const r = await syncMod.dbGet('lock:names'); return (r && r.data && r.data.names) || {}; }
async function namesSet(k, name) {
  for (let i = 0; i < 4; i++) {
    let r = await syncMod.dbGet('lock:names'); if (!r) { await syncMod.dbPut({ id: 'lock:names', salt: 'x', pinhash: 'x', data: { names: {} }, updated: 1 }, true); r = await syncMod.dbGet('lock:names'); if (!r) continue; }
    const names = { ...((r.data && r.data.names) || {}) }; if (name) names[k] = name; else delete names[k];
    if (await syncMod.dbPatchIf('lock:names', r.updated, { names }, Date.now())) return names;
  } throw new Error('Busy, try again');
}
const OWNER_PHONES = () => String(process.env.OWNER_PHONE || '').split(',').map((x) => syncMod.normPhone(x)).filter((x) => x.length === 10);
const isOwnerPhone = (e) => /@phone\.oddable$/.test(String(e)) && OWNER_PHONES().some((p) => phoneEmail(crypto.createHash('sha256').update('oddable|' + p).digest('hex')) === e);
// Second factor for owner-phone dashboards: the phone PIN alone is not enough, the owner PIN is entered once per device (30 days).
const dmint = (e) => { const p = Buffer.from(JSON.stringify({ e, v: pinVer(), x: Date.now() + 30 * 864e5 })).toString('base64url'); return p + '.' + crypto.createHmac('sha256', KEY()).update('dash|' + p).digest('hex'); };
function dok(tok, e) { try { const [p, sg] = String(tok || '').split('.'); if (!p || !sg) return false; const w = crypto.createHmac('sha256', KEY()).update('dash|' + p).digest('hex'); if (sg.length !== w.length || !crypto.timingSafeEqual(Buffer.from(sg), Buffer.from(w))) return false; const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.e === e && o.v === pinVer() && o.x > Date.now(); } catch (er) { return false; } }
const dashOk = (e, req, b) => (e === 'owner' && !!OWNER_PIN()) || (isOwnerPhone(e) && dok(req.headers['x-dash'] || (b && b.dash), e));
const phoneEmail = (id) => crypto.createHmac('sha256', KEY()).update('phoneid|' + id).digest('hex').slice(0, 20) + '@phone.oddable';
// Owner-only check for other routes (e.g. /cfbd): an owner-PIN token, or an owner-phone token plus its dashboard second factor (x-dash). Same rule as /acct/dash.
function ownerOk(req) { const e = verify(req.headers['x-token']); return !!e && dashOk(e, req); }
// Groups (groups.js): who is signed in (the account id inside a valid token, or null). Never sent to other players.
function who(req) { if (!on()) return null; const e = verify(req.headers['x-token']); if (!e) return null; if (e === 'owner' && !OWNER_PIN()) return null; return e; }
module.exports = { guestMode, expired, handle, check, on, phoneEmail, ownerOk, ma, maReady: () => !!(URL_() && SECRET()), who, isOwnerPhone, namesGet, ownerName: OWNER_NAME,
  tokenAcct, revoke, revLoad, mint, shape, cleanRef, uncache: (e) => CACHE.delete(e) }; // v271 (second line): for sync.js (token sync) and recover.js // ma / maReady: courts.js reads the app settings from My Apps; who / isOwnerPhone / namesGet / ownerName: groups.js
