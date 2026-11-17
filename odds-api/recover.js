// v271. Email + password on an Oddable account, "lost my password", "lost my PIN", and the share / influencer code. Wired in server.js one line above the
// /acct line (like announce.js); acct.js keeps sign-in itself. Everything here is a thin, checked, rate-limited forward to My Apps (contracts 5 and 6 in the
// My Apps HANDOFF) through acct.ma(); the app secret never leaves the server.
//
//   Signed in (x-token; the account always comes from the token, never from the body):
//     POST /acct/link          {email, password}   -> My Apps /api/v1/link          (step 1: a 6-digit code is mailed; nothing is live yet)
//     POST /acct/link/verify   {code}              -> My Apps /api/v1/link/verify   (step 2: the email + password now opens this same account)
//     GET|POST /acct/ref                           -> My Apps /api/v1/ref/mine      {ok, ref}: the code this person's share links carry (kept 1 hour)
//     POST /acct/ref/attach    {ref}               -> My Apps /api/v1/ref/attach    a code for an account that already exists
//   Signed out:
//     POST /acct/recover/start    {email, kind}            -> /api/v1/recover/start    ALWAYS {ok:true} for a well-formed email (never says if it has an account)
//     POST /acct/recover/check    {email, code}            -> /api/v1/recover/check    password only: {ok, ticket}
//     POST /acct/recover/password {ticket, password}       -> /api/v1/recover/password {ok}; every device of that account is signed out
//     POST /acct/recover/pin      {email, code, pin}       -> recover/check (pin) -> recover/redeem -> the new PIN is written here -> {ok, token, me}
//
// Rules kept here: no answer carries My Apps' own text, an account id, or whether an email has an account; codes, tickets, passwords and PINs are never
// logged (this file logs nothing at all); no new request header (the CORS list in server.js is unchanged); `nomail` (email not switched on in My Apps) is a
// plain 200 {ok:false, code:'nomail'} so the phone can say so and carry on.
const crypto = require('crypto');
const A = require('./acct'), S = require('./sync');
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n > 4000) { no(new Error('too big')); req.destroy(); } else c.push(d); }); req.on('end', () => { try { const j = JSON.parse(Buffer.concat(c).toString() || '{}'); ok(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); } catch (e) { no(e); } }); req.on('error', no); });
// Slow-down: n tries per 10 minutes per key (same shape as acct.js; its own map so these routes cannot use up the sign-in tries).
const TRY = new Map();
function slow(k, max) { if (TRY.size > 5000) { let n = 0; for (const x of TRY.keys()) { TRY.delete(x); if (++n >= 1000) break; } } const t = Date.now(), a = (TRY.get(k) || []).filter((x) => t - x < 600e3); if (a.length >= max) { TRY.set(k, a); return true; } a.push(t); TRY.set(k, a); return false; }
const h8 = (x) => crypto.createHash('sha256').update(String(x)).digest('hex').slice(0, 16); // an email is never a key in memory, only this
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,}$/;
const okEmail = (e) => (typeof e === 'string' && e.trim().length <= 200 && EMAIL.test(e.trim()) && !/@phone\.[a-z0-9-]+$/i.test(e.trim()) ? e.trim().toLowerCase() : '');
const okPw = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;
const okCode = (c) => (typeof c === 'string' || typeof c === 'number') && /^\d{6}$/.test(String(c).trim()) ? String(c).trim() : '';
const okHint = (h) => (typeof h === 'string' && h.length <= 80 && !/[<>&"'\u0000-\u001f]/.test(h) ? h : '');
const PHONE_ACCT = /^[0-9a-f]{20}@phone\.oddable$/;
// What the phone is told. Never My Apps' own words.
const MSG = {
  nomail: [200, "Email isn't switched on yet."],
  limit: [429, 'Too many tries. Wait a while and try again.'],
  slow: [429, 'Too many tries, wait a few minutes'],
  taken: [409, 'That email is already used by another Oddable account.'],
  has_login: [409, 'This account already signs in with an email and password.'],
  email: [400, 'Enter a valid email address.'],
  password: [400, 'Use a password of 8 to 200 characters.'],
  mail: [502, 'The email could not be sent. Try again in a minute.'],
  code: [400, 'That code is not right. Check the email and try again.'],
  expired: [410, 'That code has expired. Ask for a new one.'],
  locked: [429, 'Too many wrong tries. Ask for a new code.'],
  ticket: [400, 'That took too long. Start again.'],
  pin: [400, 'Use a PIN of 6 to 10 digits.'],
  kind: [400, 'Bad request'],
  nopin: [409, 'This account signs in with an email and password. It has no PIN.'],
  norow: [404, 'Could not find the saved bets for this account. Ask Sir Oddable.'],
  failed: [502, 'Could not do that right now. Please try again later.'],
};
const no = (res, code) => { const m = MSG[code] || MSG.failed; send(res, m[0], { ok: false, code: MSG[code] ? code : 'failed', error: m[1] }); return true; };
// My Apps' error word -> ours, only from the list a route expects; anything else (bad secret, unknown app, 404 account, 5xx, down) = failed.
const word = (r, list) => { const w = r && r.j && typeof r.j.error === 'string' ? r.j.error : ''; return list.includes(w) ? w : 'failed'; };
const good = (r) => !!(r && r.ok && r.j && r.j.ok !== false);
async function ma(path, data) { try { return await A.ma(path, data); } catch (e) { return { ok: false, status: 0, j: {} }; } }
const REFC = new Map(); // account -> { t, ref }: /acct/ref, 1 hour

async function handle(req, res) {
  if (req.method === 'OPTIONS') return false;
  const path = req.url.split('?')[0];
  if (!/^\/acct\/(link|link\/verify|ref|ref\/attach|recover\/(start|check|password|pin))$/.test(path)) return false;
  if (req.method !== 'POST' && !(req.method === 'GET' && path === '/acct/ref')) return false;
  if (!A.on()) { send(res, 200, { gate: false }); return true; }
  const ip = String(require('./ip').clientIp(req) || '').slice(0, 64);
  let b = {}; if (req.method === 'POST') { try { b = await body(req); } catch (e) { send(res, 400, { ok: false, code: 'bad', error: 'bad request' }); return true; } }

  // ---------- signed out: lost my password / lost my PIN ----------
  if (path === '/acct/recover/start') {
    const kind = b.kind === 'pin' ? 'pin' : b.kind === 'password' ? 'password' : '', email = okEmail(b.email);
    if (!kind) return no(res, 'kind'); if (!email) return no(res, 'email');
    if (slow(ip + '|rs', 8) || slow(h8(email) + '|rs', 5)) return no(res, 'slow'); // counted the same for an email with an account and one without
    const r = await ma('/api/v1/recover/start', { email, kind, ip });
    if (good(r)) { send(res, 200, { ok: true }); return true; } // My Apps answers before it looks the account up: same answer, same time, account or not
    return no(res, word(r, ['nomail', 'limit', 'email']));
  }
  if (path === '/acct/recover/check') { // password only. The PIN kind is never checked on its own: its answer names the account (see /acct/recover/pin)
    const email = okEmail(b.email), code = okCode(b.code);
    if (!email) return no(res, 'email'); if (!code) return no(res, 'code');
    if (slow(ip + '|rc', 20) || slow(h8(email) + '|rc', 12)) return no(res, 'slow');
    const r = await ma('/api/v1/recover/check', { email, code, kind: 'password', ip });
    if (good(r) && typeof r.j.ticket === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(r.j.ticket)) { send(res, 200, { ok: true, ticket: r.j.ticket }); return true; }
    return no(res, word(r, ['code', 'expired', 'locked', 'limit']));
  }
  if (path === '/acct/recover/password') {
    const ticket = typeof b.ticket === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(b.ticket) ? b.ticket : '';
    if (!ticket) return no(res, 'ticket'); if (!okPw(b.password)) return no(res, 'password'); // a bad password never reaches My Apps and never spends the ticket
    if (slow(ip + '|rp', 12)) return no(res, 'slow');
    const r = await ma('/api/v1/recover/password', { ticket, password: b.password });
    if (!good(r)) return no(res, word(r, ['password', 'ticket', 'taken']));
    const acct = typeof r.j.account === 'string' ? r.j.account.trim().toLowerCase() : '';
    if (acct) { try { await A.revoke(acct); } catch (e) {} A.uncache(acct); } // every device signed in to that account signs in again (a phone with the cell number + PIN saved does it by itself)
    send(res, 200, { ok: true }); return true;
  }
  if (path === '/acct/recover/pin') {
    // The PIN hand-off (contract 5g). One request: the code AND the new PIN. Order: 1. the shapes are checked (a bad PIN never spends the code); 2. My Apps checks
    // the code and gives a ticket + the account; 3. the ticket is redeemed HERE, once, right before the write, and must name that same account; 4. only then is
    // the new PIN written on that account's own row (sync.setPin: salt + pinhash only; the bets are not touched); 5. every older sign-in of the account is
    // revoked; 6. this phone gets a fresh token. The phone never holds the ticket and never names the account.
    const email = okEmail(b.email), code = okCode(b.code), pin = typeof b.pin === 'string' ? b.pin.trim() : '';
    if (!email) return no(res, 'email'); if (!code) return no(res, 'code'); if (!/^\d{6,10}$/.test(pin)) return no(res, 'pin');
    if (slow(ip + '|rn', 12) || slow(h8(email) + '|rn', 12)) return no(res, 'slow');
    const c = await ma('/api/v1/recover/check', { email, code, kind: 'pin', ip });
    if (!good(c)) return no(res, word(c, ['code', 'expired', 'locked', 'limit']));
    const ticket = typeof c.j.ticket === 'string' ? c.j.ticket : '', acct = typeof c.j.account === 'string' ? c.j.account.trim().toLowerCase() : '';
    if (!ticket || !acct) return no(res, 'failed');
    const d = await ma('/api/v1/recover/redeem', { ticket });
    if (!good(d) || d.j.kind !== 'pin' || String(d.j.account || '').trim().toLowerCase() !== acct) return no(res, 'ticket'); // anything but a clean yes for the SAME account = start again
    if (!PHONE_ACCT.test(acct)) return no(res, 'nopin'); // an email-only account has no PIN row
    let id = null; try { id = await S.rowIdFor(acct); } catch (e) { return no(res, 'failed'); }
    if (!id) return no(res, 'norow');
    let done = false; try { done = await S.setPin(id, pin); } catch (e) { done = false; }
    if (!done) return no(res, 'failed'); // nothing was changed: the old PIN still works
    try { await A.revoke(acct); } catch (e) {} A.uncache(acct);
    let me = null; try { me = await A.shape(acct, true); } catch (e) {}
    if (me && A.isOwnerPhone(acct)) me.ownerDash = true;
    send(res, 200, { ok: true, token: A.mint(acct), me: A.gFlag(me, acct) }); return true; // v272: the same Groups flag as every other sign-in answer (nothing is added while GROUPS_ENABLED is unset)
  }

  // ---------- signed in ----------
  const tok = (typeof b.token === 'string' && b.token) || req.headers['x-token'];
  const e = await A.tokenAcct(tok);
  if (!e) { send(res, 401, { ok: false, error: 'Sign in again' }); return true; }
  if (path === '/acct/ref') {
    if (slow(e + '|ref', 30)) return no(res, 'slow');
    const c = REFC.get(e); if (c && Date.now() - c.t < 3600e3) { send(res, 200, { ok: true, ref: c.ref }); return true; }
    const r = await ma('/api/v1/ref/mine', { account: e }), ref = good(r) ? A.cleanRef(r.j.ref) : '';
    if (!ref) { send(res, 200, { ok: false, ref: '' }); return true; } // My Apps not ready: the phone shares a plain link; not kept, so the next tap asks again
    if (REFC.size > 5000) REFC.clear(); REFC.set(e, { t: Date.now(), ref });
    send(res, 200, { ok: true, ref }); return true;
  }
  if (path === '/acct/ref/attach') {
    const ref = A.cleanRef(typeof b.ref === 'string' ? b.ref.trim() : '');
    if (!ref) { send(res, 200, { ok: true, attributed: false, code: 'ref' }); return true; }
    if (slow(ip + '|ra', 8) || slow(e + '|ra', 8)) return no(res, 'slow');
    const r = await ma('/api/v1/ref/attach', { account: e, ref });
    if (good(r)) { REFC.delete(e); A.uncache(e); send(res, 200, { ok: true, attributed: r.j.attributed === true }); return true; } // the share code may now be the influencer's
    const w = word(r, ['set', 'late', 'self', 'ref', 'limit']);
    if (w === 'limit') return no(res, 'limit'); if (w === 'failed') return no(res, 'failed');
    send(res, 200, { ok: true, attributed: false, code: w }); return true; // set / late / self / no such code: nothing to tell the person, and the phone does not ask again
  }
  // link + link/verify: only a phone account can gain an email sign-in (an email account already has one)
  if (!PHONE_ACCT.test(e)) return no(res, 'has_login');
  if (path === '/acct/link') {
    const email = okEmail(b.email);
    if (!email) return no(res, 'email'); if (!okPw(b.password)) return no(res, 'password');
    if (slow(ip + '|lk', 8) || slow(e + '|lk', 8)) return no(res, 'slow');
    const r = await ma('/api/v1/link', { account: e, email, password: b.password, ip });
    if (!good(r)) return no(res, word(r, ['nomail', 'limit', 'taken', 'has_login', 'email', 'password', 'mail']));
    if (r.j.pending === false && r.j.verified === true) { A.uncache(e); send(res, 200, { ok: true, pending: false, verified: true, hint: okHint(r.j.login_hint) }); return true; } // that address was already proven on this account: live at once
    send(res, 200, { ok: true, pending: true, hint: okHint(r.j.login_hint) }); return true;
  }
  if (path === '/acct/link/verify') {
    const code = okCode(b.code); if (!code) return no(res, 'code');
    if (slow(e + '|lv', 20)) return no(res, 'slow');
    const r = await ma('/api/v1/link/verify', { account: e, code, ip });
    if (!good(r)) return no(res, word(r, ['code', 'expired', 'locked', 'taken', 'limit']));
    A.uncache(e); send(res, 200, { ok: true, verified: true, hint: okHint(r.j.login_hint) }); return true;
  }
  return false;
}
module.exports = { handle };
