// Phone + PIN sync for Oddable. Stores one small JSON blob per phone number in a Supabase table (REST, no extra packages).
// Env: SUPABASE_URL (https://xxxx.supabase.co) and SUPABASE_KEY (service_role key). Table SQL is in SYNC_SETUP.md.
const crypto = require('crypto');
const FAILS = new Map();
const MAX_BODY = 1.5e6;
const cfg = () => ({ url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key: process.env.SUPABASE_KEY || '' });
const hdr = (k) => ({ apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' });
const idOf = (phone) => crypto.createHash('sha256').update('oddable|' + phone).digest('hex');
const normPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; };
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function dbGet(id) {
  const { url, key } = cfg();
  const r = await fetch(`${url}/rest/v1/oddable_sync?id=eq.${id}&select=*`, { headers: hdr(key) });
  if (!r.ok) throw new Error('db read ' + r.status);
  const j = await r.json(); return j[0] || null;
}
async function dbPut(row) {
  const { url, key } = cfg();
  const r = await fetch(`${url}/rest/v1/oddable_sync`, { method: 'POST', headers: { ...hdr(key), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
  if (!r.ok) throw new Error('db write ' + r.status);
}

const arr = (x) => (Array.isArray(x) ? x : []);
function merge(a, b) { // a = stored, b = incoming
  const tomb = [...new Set([...arr(a.tomb), ...arr(b.tomb)].map(String))].slice(-3000), T = new Set(tomb);
  const by = new Map();
  [...arr(a.bets), ...arr(b.bets)].forEach((x) => {
    if (!x || x.id == null || T.has(String(x.id))) return;
    const o = by.get(x.id);
    if (!o) by.set(x.id, x);
    else if ((o.res == null) !== (x.res == null)) by.set(x.id, x.res != null ? x : o);
    else by.set(x.id, (x.t || 0) >= (o.t || 0) ? x : o);
  });
  const log = { ...(a.log || {}) };
  Object.keys(b.log || {}).forEach((k) => { if (!log[k] || JSON.stringify(b.log[k]).length >= JSON.stringify(log[k]).length) log[k] = b.log[k]; });
  const locks = { ...(a.locks || {}) };
  Object.keys(b.locks || {}).forEach((k) => { const o = locks[k], x = b.locks[k]; if (!o || ((x && x.t) || 0) >= ((o && o.t) || 0)) locks[k] = x; });
  const splk = { ...(a.splk || {}) };
  Object.keys(b.splk || {}).forEach((lg) => { const m = { ...(splk[lg] || {}) }; const inc = b.splk[lg] || {}; Object.keys(inc).forEach((g) => { if (!m[g] || (inc[g] && inc[g].r && !m[g].r)) m[g] = inc[g]; }); splk[lg] = m; });
  return {
    locks, splk,
    bets: [...by.values()],
    pins: [...new Set([...arr(a.pins), ...arr(b.pins)].map(String))].slice(-500),
    log, kdel: [...new Set([...arr(a.kdel), ...arr(b.kdel)])].slice(-3000), tomb,
  };
}

function body(req) {
  return new Promise((ok, no) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > MAX_BODY) { no(new Error('too big')); req.destroy(); } }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { no(e); } }); req.on('error', no); });
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
    const b = await body(req), phone = normPhone(b.phone), pin = String(b.pin || '');
    if (phone.length !== 10) { send(res, 400, { error: 'Enter a 10-digit cell number' }); return true; }
    if (!/^\d{4,10}$/.test(pin)) { send(res, 400, { error: 'PIN must be 4 to 10 digits' }); return true; }
    const id = idOf(phone), ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (blocked(id) || blocked('ip:' + ip)) { send(res, 429, { error: 'Too many wrong PINs. Try again in 15 minutes.' }); return true; }
    const row = await dbGet(id);
    if (path === '/sync/signup') {
      if (row) { send(res, 409, { error: 'That number already has an account. Use Sign in.' }); return true; }
      const salt = crypto.randomBytes(16).toString('hex');
      const data = merge({}, b.data || {});
      await dbPut({ id, salt, pinhash: hashPin(pin, salt), data, updated: Date.now() });
      send(res, 200, { ok: true, data, updated: Date.now() }); return true;
    }
    if (!row || !same(hashPin(pin, row.salt), row.pinhash)) { fail(id); fail('ip:' + ip); send(res, 401, { error: row ? 'Wrong PIN' : 'No account for that number. Use Create account.' }); return true; }
    if (path === '/sync/login' || path === '/sync/pull') { send(res, 200, { ok: true, data: row.data || {}, updated: row.updated }); return true; }
    if (path === '/sync/push') {
      const data = merge(row.data || {}, b.data || {});
      await dbPut({ id, salt: row.salt, pinhash: row.pinhash, data, updated: Date.now() });
      send(res, 200, { ok: true, data, updated: Date.now() }); return true;
    }
    send(res, 404, { error: 'not found' }); return true;
  } catch (e) { send(res, 500, { error: 'Sync error: ' + e.message }); return true; }
}
module.exports = { handle, merge, normPhone };
