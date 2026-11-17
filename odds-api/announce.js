// v267. Messages from the owner to every Oddable user ("broadcast"). My Apps owns the engine (who gets it, the phone pushes, the 5-a-day limit);
// this file is the Oddable side of My Apps "API contract 4":
//   POST /acct/broadcast  OWNER ONLY  {title, body, link?, audience, test?} -> My Apps /api/v1/broadcast -> {ok, id, people, devices, sent}
//   v269  the same route with dry:true = COUNT ONLY, nothing is sent: -> {ok, dry:true, people, alerts, devices, left}. An old My Apps does not know `dry` and
//         would SEND the message, so a dry call goes to /api/v1/broadcast ONLY after My Apps has said it can count: `caps` holding "broadcast_dry" in its
//         /api/v1/app/settings answer (asked here, kept 5 minutes; "no" is asked again after 1 minute). Without it: {ok:false, error:'nodry'} and no broadcast call.
//   GET  /acct/announce   signed in   -> My Apps /api/v1/announce/for {account} -> {ok, announce|null}   (the latest message aimed at this account)
//   clean(a)              the ONE check for an announcement that goes to a phone; appcfg.js uses it for the public "Everyone" message.
// Text is plain text, always. Nothing from My Apps is passed on as it came: every answer is rebuilt field by field.
// No new request header (x-token / x-dash only), so the CORS Allow-Headers list in server.js is unchanged.
const D = {
  ma: (path, data) => require('./acct').ma(path, data), maReady: () => require('./acct').maReady(),
  ownerOk: (req) => require('./acct').ownerOk(req), who: (req) => require('./acct').who(req), isOwnerPhone: (e) => require('./acct').isOwnerPhone(e), gateOn: () => require('./acct').on(),
  ip: (req) => require('./ip').clientIp(req), now: () => Date.now()
};
const TITLE_MAX = 60, BODY_MAX = 240, DAYS = 14;
const AUDIENCES = ['all', 'active', 'expired'];
// The only places a message may open. The phone gets the URL (same list in pics/announce.js); My Apps gets the same URL for the push.
// The four the My Apps console offers (BC_LINKS in its store.js: / , /sports.html, /pga.html, /pickleball.html) plus My Bets, Live and Golf GPS. Real pages in pics/ only.
const LINKS = { home: '/', bets: '/?open=bets', live: '/?open=live', sports: '/sports.html', pga: '/pga.html', pickleball: '/pickleball.html', golfgps: '/golfgps.html' };
const linkOf = (v) => { if (typeof v !== 'string') return ''; const s = v.trim(); if (Object.prototype.hasOwnProperty.call(LINKS, s)) return LINKS[s]; return Object.values(LINKS).includes(s) ? s : ''; };
// One line of plain text: control characters and line breaks become spaces, runs of spaces collapse, trimmed. null = not text.
const line = (v) => (typeof v !== 'string' ? null : v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim());
const isoOf = (v) => { const t = typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.length < 40 ? Date.parse(v) : NaN; return Number.isFinite(t) && t > 0 && t < 4e12 ? new Date(t).toISOString() : ''; };
// An announcement as My Apps gives it -> {id, title, body, link, at} or null. Wrong type, too long, empty, too old or from the future = null (never cut to fit).
function clean(a, now) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const id = typeof a.id === 'number' && Number.isFinite(a.id) ? String(a.id) : typeof a.id === 'string' ? a.id.trim() : '';
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) return null;
  const title = line(a.title), body = line(a.body), at = isoOf(a.at);
  if (!title || !body || title.length > TITLE_MAX || body.length > BODY_MAX || !at) return null;
  const t = Date.parse(at), n = now == null ? Date.now() : now;
  if (t > n + 10 * 6e4 || n - t > DAYS * 864e5) return null;
  return { id, title, body, link: a.link == null || a.link === '' ? '' : linkOf(a.link), at };
}
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const MAX = 20000;
const body = (req) => new Promise((res, rej) => { let n = 0, over = false; const c = []; req.on('data', (d) => { n += d.length; if (n > MAX) { over = true; c.length = 0; } else if (!over) c.push(d); }); /* too big: read to the end without keeping it, then say 400 (no dropped connection) */ req.on('end', () => { if (over) return rej(new Error('too big')); try { const j = JSON.parse(Buffer.concat(c).toString() || '{}'); res(j && typeof j === 'object' && !Array.isArray(j) ? j : null); } catch (e) { rej(e); } }); req.on('error', rej); });
// Same slow-down as the neighbouring owner routes in acct.js (8 per 10 minutes per key); the oldest keys go first when the map is full.
let TRY = new Map(), FOR = new Map();
function throttled(k, max) { if (TRY.size > 5000) { let n = 0; for (const x of TRY.keys()) { TRY.delete(x); if (++n >= 1000) break; } } const t = D.now(), a = (TRY.get(k) || []).filter((x) => t - x < 600e3); if (a.length >= (max || 8)) { TRY.set(k, a); return true; } a.push(t); TRY.set(k, a); return false; }
const NOT_READY = 'My Apps is not ready for this yet.';
const ERR = {
  limit: [429, 'You have sent 5 today. Try again tomorrow.'],
  dup: [409, 'You already sent this same message in the last 10 minutes.'],
  busy: [429, 'Too many sends right now. Try again in a few minutes.'],
  contact: [400, 'Take the phone number or email out of the message.']
};
// v269. Can My Apps count without sending? Only a good /api/v1/app/settings answer whose top-level `caps` list holds "broadcast_dry" says yes.
// Anything else (old build, down, slow, wrong shape) is no. Never guessed, never remembered past CAP_YES.
const CAP = 'broadcast_dry', CAP_YES = 5 * 6e4, CAP_NO = 6e4, CAP_WAIT = 6000;
let DRY = { t: 0, ok: false };
async function canDry() {
  const now = D.now(); if (DRY.t && now < DRY.t) return DRY.ok;
  let ok = false, timer;
  try {
    const late = new Promise((r) => { timer = setTimeout(() => r(null), CAP_WAIT); });
    const r = await Promise.race([D.ma('/api/v1/app/settings', {}), late]);
    ok = !!(r && r.ok && r.j && r.j.ok === true && Array.isArray(r.j.caps) && r.j.caps.includes(CAP));
  } catch (e) {} finally { clearTimeout(timer); }
  DRY = { t: now + (ok ? CAP_YES : CAP_NO), ok };
  return ok;
}
const count = (v) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };
async function broadcast(req, res) {
  if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'POST only' }); return; }
  if (!D.ownerOk(req)) { // nobody but the owner gets past this line, and My Apps is not called
    let e = null; try { e = D.who(req); } catch (x) {}
    if (e && D.isOwnerPhone(e)) send(res, 401, { ok: false, error: 'Owner PIN needed', need: 'owner-pin' }); else if (e) send(res, 403, { ok: false, error: 'Owner only' }); else send(res, 401, { ok: false, error: 'Sign in again' });
    return;
  }
  let b = null, bodyBad = false; try { b = await body(req); } catch (e) { bodyBad = true; }
  // strictly `true` is a count; a count has its own slow-down (20 / 40 per 10 minutes) so counting never uses up the tries for real sends
  const dry = !!b && b.dry === true;
  if (dry ? (throttled(D.ip(req) + '|bcdry', 20) || throttled('owner|bcdry', 40)) : (throttled(D.ip(req) + '|bcast') || throttled('owner|bcast', 16))) { send(res, 429, { ok: false, code: 'slow', error: 'Too many tries, wait a few minutes' }); return; }
  if (!b || bodyBad) { send(res, 400, { ok: false, code: 'bad', error: 'bad request' }); return; }
  if (b.dry != null && typeof b.dry !== 'boolean') { send(res, 400, { ok: false, code: 'bad', error: 'bad request' }); return; }
  const title = line(b.title), text = line(b.body), aud = b.audience == null ? 'all' : b.audience;
  if (!title) { send(res, 400, { ok: false, code: 'title', error: 'Type a title.' }); return; }
  if (title.length > TITLE_MAX) { send(res, 400, { ok: false, code: 'title', error: 'Keep the title to ' + TITLE_MAX + ' characters or less.' }); return; }
  if (!text) { send(res, 400, { ok: false, code: 'body', error: 'Type a message.' }); return; }
  if (text.length > BODY_MAX) { send(res, 400, { ok: false, code: 'body', error: 'Keep the message to ' + BODY_MAX + ' characters or less.' }); return; }
  if (!AUDIENCES.includes(aud)) { send(res, 400, { ok: false, code: 'audience', error: 'Pick who gets it.' }); return; }
  let link = '';
  if (b.link != null && b.link !== '') { link = typeof b.link === 'string' && Object.prototype.hasOwnProperty.call(LINKS, b.link) ? LINKS[b.link] : ''; if (!link) { send(res, 400, { ok: false, code: 'link', error: 'Pick where it opens from the list.' }); return; } }
  if (b.test != null && typeof b.test !== 'boolean') { send(res, 400, { ok: false, code: 'bad', error: 'bad request' }); return; }
  if (dry && b.test === true) { send(res, 400, { ok: false, code: 'bad', error: 'bad request' }); return; } // a count of a test makes no sense (My Apps says 400 too)
  let ready = false; try { ready = !!D.maReady(); } catch (e) {}
  if (!ready) { send(res, 502, { ok: false, code: 'notready', error: NOT_READY }); return; }
  // THE GATE: no count is asked of a My Apps that has not said it can count (it would send the message for real)
  if (dry && !(await canDry())) { send(res, 200, { ok: false, code: 'nodry', error: 'nodry' }); return; }
  const out = { title, body: text, audience: aud }; if (link) out.link = link; if (b.test === true) out.test = true; if (dry) out.dry = true; // a real send never carries `dry`
  let r; try { r = await D.ma('/api/v1/broadcast', out); } catch (e) { send(res, 502, { ok: false, code: 'notready', error: NOT_READY }); return; }
  const j = (r && r.j && typeof r.j === 'object') ? r.j : {};
  if (dry && r && r.ok && j.ok === true) {
    if (j.dry === true) { send(res, 200, { ok: true, dry: true, people: count(j.people), alerts: count(j.alerts), devices: count(j.devices), left: count(j.left) }); return; }
    // My Apps said it can count but answered like a real send. Stop counting and tell the owner the truth so he does not send it twice.
    DRY = { t: D.now() + CAP_NO, ok: false };
    send(res, 502, { ok: false, code: 'drysent', error: 'My Apps may have SENT this message instead of counting. Check My Apps before you send it again.' }); return;
  }
  if (r && r.ok && j.ok === true) {
    send(res, 200, { ok: true, test: b.test === true, id: typeof j.id === 'string' || typeof j.id === 'number' ? String(j.id).slice(0, 64) : null, people: count(j.people), devices: count(j.devices), sent: count(j.sent) });
    return;
  }
  const code = typeof j.error === 'string' ? j.error : '', m = Object.prototype.hasOwnProperty.call(ERR, code) ? ERR[code] : null;
  if (m) { send(res, m[0], { ok: false, code, error: m[1] }); return; }
  if (!r || r.status === 404 || r.status >= 500 || !r.status) { send(res, 502, { ok: false, code: 'notready', error: NOT_READY }); return; }
  // any other answer (another 400 code, a refused secret): a plain sentence, never My Apps' own text
  send(res, r.status === 400 ? 400 : 502, { ok: false, code: r.status === 400 && /^[a-z_]{1,24}$/.test(code) ? code : 'failed', error: r.status === 400 ? 'My Apps did not take that message. Check the words and try again.' : 'Could not send. Please try again later.' });
}
// The latest message aimed at the signed-in account (paid / trial only, expired only). One My Apps read per account per 5 minutes; a failed read is kept 1 minute.
const FOR_TTL = 5 * 6e4, FOR_RETRY = 6e4, FOR_WAIT = 6000;
async function announceFor(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') { send(res, 405, { ok: false, error: 'GET only' }); return; }
  let on = false; try { on = !!D.gateOn(); } catch (e) {}
  if (!on) { send(res, 200, { ok: true, announce: null }); return; } // no accounts while the gate is off
  let e = null; try { e = D.who(req); } catch (x) {}
  if (!e) { send(res, 401, { ok: false, error: 'Sign in again' }); return; }
  if (e === 'owner') { send(res, 200, { ok: true, announce: null }); return; } // the owner-PIN sign-in is not a My Apps account
  if (throttled(e + '|annfor', 30)) { send(res, 429, { ok: false, error: 'Too many tries, wait a few minutes' }); return; }
  const now = D.now(), c = FOR.get(e);
  if (c && now < c.t) { send(res, 200, { ok: true, announce: clean(c.v, now) }); return; }
  if (FOR.size > 2000) { let n = 0; for (const k of FOR.keys()) { FOR.delete(k); if (++n >= 500) break; } }
  let v = null, good = false, timer;
  try {
    const late = new Promise((r) => { timer = setTimeout(() => r(null), FOR_WAIT); });
    const r = await Promise.race([D.ma('/api/v1/announce/for', { account: e }), late]);
    if (r && r.ok && r.j && r.j.ok === true) { good = true; v = clean(r.j.announce, now); }
  } catch (x) {} finally { clearTimeout(timer); }
  FOR.set(e, { t: now + (good ? FOR_TTL : FOR_RETRY), v });
  send(res, 200, { ok: true, announce: v });
}
async function handle(req, res) {
  if (req.method === 'OPTIONS') return false;
  const path = req.url.split('?')[0];
  if (path === '/acct/broadcast') { await broadcast(req, res); return true; }
  if (path === '/acct/announce') { await announceFor(req, res); return true; }
  return false;
}
module.exports = { handle, clean, linkOf, LINKS, AUDIENCES, TITLE_MAX, BODY_MAX, _deps: D, _reset: () => { TRY = new Map(); FOR = new Map(); DRY = { t: 0, ok: false }; } };
