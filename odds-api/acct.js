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
const TOK_DAYS = 30;
const b64 = (s) => Buffer.from(s).toString('base64url');
const sig = (p) => crypto.createHmac('sha256', KEY()).update(p).digest('base64url');
const pinVer = () => crypto.createHash('sha256').update('pin|' + String(process.env.OWNER_PIN || '')).digest('hex').slice(0, 8);
function mint(email) { const p = b64(JSON.stringify(email === 'owner' ? { e: email, v: pinVer(), x: Date.now() + TOK_DAYS * 864e5 } : { e: email, x: Date.now() + TOK_DAYS * 864e5 })); return p + '.' + sig(p); }
function verify(t) {
  const [p, s] = String(t || '').split('.'); if (!p || !s) return null;
  const want = sig(p); if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); if (o.e === 'owner' && o.v !== pinVer()) return null; // changing OWNER_PIN signs the old owner tokens out
    return o.x > Date.now() ? o.e : null; } catch (e) { return null; }
}
const MAX = 20000;
const body = (req) => new Promise((res, rej) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n > MAX) { rej(new Error('too big')); req.destroy(); } else c.push(d); }); req.on('end', () => { try { res(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { rej(e); } }); req.on('error', rej); });
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
async function ma(path, data) {
  const r = await fetch(URL_() + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ slug: SLUG, secret: SECRET() }, data)), signal: AbortSignal.timeout(25000) });
  const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j };
}
// Slow-down for password guessing: 8 tries / 10 min per ip+email.
const TRY = new Map();
function throttled(k) { if (TRY.size > 5000) TRY.clear(); const t = Date.now(), a = (TRY.get(k) || []).filter((x) => t - x < 600e3); if (a.length >= 8) { TRY.set(k, a); return true; } a.push(t); TRY.set(k, a); return false; }
const OWNER_PIN = () => String(process.env.OWNER_PIN || '').trim();
const OWNER_ME = { email: 'owner', role: 'owner', plan: 'pro', expires_on: null, source: 'owner', allowed: true, pending: false, price: 99, link: null, tag: null, payReady: true };
const allowed = (a) => a && (a.role === 'owner' || a.plan === 'pro');
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
    price: p.price || a.price || 99, link: p.link || null, tag: p.tag || null, payReady: !!p.configured };
}
// For other routes (AI): returns true if the request carries a valid token for an allowed account (or the gate is off).
async function check(req) {
  if (!on()) return true;
  const e = verify(req.headers['x-token']); if (!e) return false;
  if (e === 'owner') return !!OWNER_PIN();
  try { return !!allowed(await entitlement(e, false)); } catch (er) { return false; }
}
async function handle(req, res) {
  if (req.method === 'OPTIONS') return false;
  const path = req.url.split('?')[0];
  if (path === '/acct/status') { send(res, 200, { gate: on() }); return true; }
  if (req.method !== 'POST') return false;
  if (!on()) { send(res, 200, { gate: false }); return true; }
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim(); // Render appends the real client address last
  let b; try { b = await body(req); } catch (e) { send(res, 400, { error: 'bad request' }); return true; }
  const email = String(b.email || '').trim().toLowerCase();
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
      let v; try { v = await syncMod.verifyLogin(b.phone, b.pin, ip, !!b.create); } catch (er) { send(res, er.status || 500, { error: er.message }); return true; }
      const pe = phoneEmail(v.id), pw = crypto.createHmac('sha256', KEY()).update('phone|' + v.id).digest('hex').slice(0, 32);
      let r = await ma('/api/v1/auth/register', { email: pe, password: pw, name: 'Phone ' + v.id.slice(0, 4) });
      if (!r.ok && r.status === 409) r = await ma('/api/v1/auth/login', { email: pe, password: pw });
      if (!r.ok) { send(res, 502, { error: r.j.error || 'Could not open your account' }); return true; }
      CACHE.delete(pe);
      send(res, 200, { token: mint(pe), me: await shape(pe, true) }); return true;
    }
    if (path === '/acct/login' || path === '/acct/register') {
      if (/@phone\.oddable$/.test(email)) { send(res, 400, { error: 'Use your cell number and PIN to sign in' }); return true; }
      if (throttled(ip + '|' + email)) { send(res, 429, { error: 'Too many tries, wait a few minutes' }); return true; }
      const r = await ma(path === '/acct/login' ? '/api/v1/auth/login' : '/api/v1/auth/register', { email, password: b.password, name: b.name });
      if (!r.ok) { send(res, r.status === 401 || r.status === 409 || r.status === 400 ? r.status : 502, { error: r.j.error || 'Could not sign in' }); return true; }
      CACHE.delete(email);
      const me = await shape(email, true);
      send(res, 200, { token: mint(email), me }); return true;
    }
    const e = verify(b.token || req.headers['x-token']);
    if (!e) { send(res, 401, { error: 'Sign in again' }); return true; }
    if (e === 'owner') { if (!OWNER_PIN()) { send(res, 401, { error: 'Sign in again' }); return true; } if (path === '/acct/me') { send(res, 200, { me: OWNER_ME }); return true; } send(res, 400, { error: 'Owner has full access' }); return true; }
    if (path === '/acct/me') { const me = await shape(e, true); if (!me) { send(res, 401, { error: 'Account not found or suspended' }); return true; } send(res, 200, { me }); return true; }
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
      const r = await ma('/api/v1/pay/request', { account: e });
      if (!r.ok) { send(res, 502, { error: r.j.error || 'Could not record your payment' }); return true; }
      CACHE.delete(e); send(res, 200, { ok: true, ref: r.j.ref, link: r.j.link, amount: r.j.amount }); return true;
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
const phoneEmail = (id) => crypto.createHmac('sha256', KEY()).update('phoneid|' + id).digest('hex').slice(0, 20) + '@phone.oddable';
module.exports = { handle, check, on, phoneEmail };
