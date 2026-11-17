// Activity events: the Oddable server tells My Apps what happened (a new bet, a new group, a join, a contest starting...) so the owner can get an alert.
// My Apps contract: POST /api/v1/event {slug, secret, type, account?, title, detail?, key?} through acct.js ma() (it adds slug + secret).
//   type    one of TYPES below.
//   title   plain text, 80 characters at most.   detail  plain text, 160 at most.
//           Neither may hold 7 or more digits in a row or an email address (My Apps refuses those), so clean() removes them here first.
//   account the player's My Apps account email (a phone account = acct.phoneEmail(row id)); My Apps shows the saved handle for it. Left out when unknown.
//   key     de-dup key, 120 characters at most: My Apps answers {ok:true,dup:true} to the same type + key inside 10 minutes.
//   answers {ok:true} | {ok:true,dup:true} | 400 {error: type|title|detail|contact|account|key} | 429 "busy" (over 120 recorded events in 10 minutes) |
//           403 bad secret | 404 unknown app, or no such route on a My Apps older than build .34. EVERY answer and every failure is swallowed here.
// Rules of this file: emit() never throws, never waits and never runs in the caller's request (the send happens later, on a timer); nothing is sent when
// My Apps is not set up (maReady() false) or EVENTS_ENABLED is 0. Events wait in memory (200 at most, the oldest is dropped), one is sent at a time with
// 100 ms between sends and a 5 s limit each. After a 404 / 403, or three failed sends in a row, nothing is sent for 5 minutes. An event older than 10 minutes is
// thrown away instead of sent late (there is no "happened at" field, so a late event would read as new). Nothing here is logged except one line per pause.
// Env: EVENTS_ENABLED (default ON; 0 / off / false / no = everything off).
const D = {
  ma: (path, data) => require('./acct').ma(path, data), maReady: () => require('./acct').maReady(),
  now: () => Date.now(), log: (...a) => console.error('events:', ...a),
};
const CFG = { gap: 100, wait: 5000, max: 200, pause: 5 * 6e4, fails: 3, maxAge: 10 * 6e4 };
const TYPES = ['bet_new', 'group_new', 'group_join', 'contest_start', 'calcutta_start', 'calcutta_sold', 'golf_start', 'pickleball_start', 'other'];
let Q, ST;
function reset() { if (ST && ST.timer) clearTimeout(ST.timer); Q = []; ST = { timer: null, busy: false, fails: 0, until: 0, sent: 0, dropped: 0 }; }
reset();
const enabled = () => !/^(0|off|false|no)$/i.test(String(process.env.EVENTS_ENABLED == null ? '' : process.env.EVENTS_ENABLED).trim());

// Plain text My Apps will take (it answers 400 "contact" otherwise). Its own checks, copied from My Apps store.js (build .34): an email address `x@y.z`,
// 7 or more digits in a row, and a number written like 956-555-1234 / (956) 555-1234 / 956.555.1234. The text is normalised the way My Apps does it first
// (control and zero-width characters become a space, runs of spaces collapse), then everything that matches is taken out, again and again until nothing
// matches (taking one thing out can push two runs of digits together); every "@" goes too, and tags' angle brackets. Dates, odds and money stay.
const EMAIL = /[^\s@<>()[\],;:"']+@[^\s@<>()[\],;:"']+\.[A-Za-z0-9-]{2,}/g, MA_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/, MA_DIGITS = /\d{7,}/, MA_PHONE = /(?<!\d)\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}(?!\d)/;
const contact = (t) => MA_EMAIL.test(t) || MA_DIGITS.test(t) || MA_PHONE.test(t);
const norm = (x) => x.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\ufeff<>]/g, ' ').replace(/\s+/g, ' ').trim();
function clean(s, max) {
  if (typeof s !== 'string' && typeof s !== 'number') return ''; // only real text: an object never becomes "[object Object]"
  let x = norm(String(s).slice(0, 2000));
  for (let i = 0; i < 8; i++) { const y = norm(x.replace(EMAIL, ' ').replace(/@/g, ' ').replace(/[\d０-９]{7,}/g, ' ').replace(new RegExp(MA_PHONE.source, 'g'), ' ')); if (y === x) break; x = y; }
  x = x.slice(0, max).trim();
  return contact(x) ? norm(x.replace(/[\d@]/g, ' ')).slice(0, max).trim() : x; // last resort (not reached in 1,000,000 random texts): no digits at all
}
const cleanAccount = (a) => { const x = typeof a === 'string' ? a.trim().toLowerCase() : ''; return x.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) ? x : ''; };
const cleanKey = (k) => (k == null ? '' : String(k).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120));

// The body that would be sent (null = nothing to send). Exported for tests and for callers that want to see what My Apps gets.
function build(type, o) {
  try {
    o = o || {}; const t = TYPES.includes(type) ? type : null, title = clean(o.title, 80); if (!t || !title) return null;
    const ev = { type: t, title }, account = cleanAccount(o.account), detail = clean(o.detail, 160), key = cleanKey(o.key);
    if (account) ev.account = account; if (detail) ev.detail = detail; if (key) ev.key = key;
    return ev;
  } catch (e) { return null; }
}

function emit(type, o) {
  try {
    if (!enabled()) return false;
    let ready = false; try { ready = !!D.maReady(); } catch (e) {}
    if (!ready) return false;
    const ev = build(type, o); if (!ev) return false;
    Q.push({ ev, at: D.now(), tries: 0 }); while (Q.length > CFG.max) { Q.shift(); ST.dropped++; }
    arm(0); return true;
  } catch (e) { return false; }
}
function arm(ms) { if (ST.timer || ST.busy) return; ST.timer = setTimeout(() => { ST.timer = null; drain().catch(() => {}); }, Math.max(0, ms)); if (ST.timer.unref) ST.timer.unref(); }
function pause(why) { ST.fails = 0; ST.until = D.now() + CFG.pause; try { D.log('paused for 5 minutes (' + why + ')'); } catch (e) {} }
async function drain() {
  if (ST.busy) return; ST.busy = true; let next = CFG.gap; if (ST.timer) { clearTimeout(ST.timer); ST.timer = null; }
  try {
    const now = D.now();
    while (Q.length && now - Q[0].at > CFG.maxAge) { Q.shift(); ST.dropped++; }
    if (!Q.length) return;
    if (!enabled()) { ST.dropped += Q.length; Q.length = 0; return; }
    if (now < ST.until) { next = ST.until - now; return; }
    const it = Q.shift(); let r = null, timer;
    try { r = await Promise.race([Promise.resolve().then(() => D.ma('/api/v1/event', it.ev)), new Promise((ok) => { timer = setTimeout(() => ok(null), CFG.wait); })]); } catch (e) { r = null; } finally { clearTimeout(timer); }
    const status = r && Number(r.status) || 0;
    if (r && r.ok) { ST.fails = 0; ST.sent++; } // {ok:true} and {ok:true,dup:true}
    else if (status === 404 || status === 403) { ST.dropped++; pause(status === 404 ? 'My Apps has no event route, or does not know this app' : 'My Apps refused the app secret'); } // this event is gone; try again later with newer ones
    else if (status === 400) { ST.dropped++; } // My Apps refused this one event: not a reason to stop
    else { // 429 busy, 5xx, no answer in 5 s, network error: one more try for this event, then it is dropped
      if (++it.tries < 2) Q.unshift(it); else ST.dropped++;
      if (++ST.fails >= CFG.fails) pause('My Apps is not answering');
    }
    if (D.now() < ST.until) next = ST.until - D.now();
  } catch (e) { /* never throws */ } finally { ST.busy = false; if (Q.length) arm(next); }
}

// ---------- new bets (called by sync.js after a push is stored and answered) ----------
const arr = (x) => (Array.isArray(x) ? x : []);
const BET_FRESH = 15 * 6e4;
const sgn = (n) => (n > 0 ? '+' : '') + n;
// A short line for one bet, from the fields the phone really stores. No stake and no payout (the stake is dollars or units depending on a setting only the
// phone knows), and any "$12" inside a typed bet text is taken out.
function betText(b) {
  try {
    if (!b || typeof b !== 'object') return '';
    const legs = arr(b.legs), s = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
    let x;
    if (b.kind === 'parlay' || legs.length > 1) x = (legs.length || '') + (legs.length ? '-leg ' : '') + 'parlay';
    else if (b.kind === 'prop' || (!s(b.side) && s(b.text))) x = s(b.text);
    else if (s(b.side)) { const ln = Number(b.line), ou = b.type === 'ou' || b.type === 'tot';
      x = s(b.side) + ' ' + (ou ? (Number.isFinite(ln) && b.line != null && b.line !== '' ? ln : '') : b.type === 'sp' && Number.isFinite(ln) && b.line != null && b.line !== '' ? sgn(ln) : 'ML') + (s(b.away) && s(b.home) ? ' (' + s(b.away) + ' at ' + s(b.home) + ')' : ''); }
    else x = '';
    return clean(String(x).replace(/[$€£]\s?\d[\d,]*(\.\d+)?/g, ' '), 160);
  } catch (e) { return ''; }
}
// Which bets did this push ADD? In the stored result, not in the row before, with the bet's own time `t` inside the last 15 minutes (so a phone that
// uploads its old history for the first time is not announced). Edits, results and deletes are never "new": their ids were already in the row.
function newBets(before, after, now) {
  try {
    const had = new Set(arr(before && before.bets).filter((x) => x && x.id != null).map((x) => String(x.id)));
    return arr(after && after.bets).filter((x) => { if (!x || typeof x !== 'object' || x.id == null || had.has(String(x.id))) return false; const t = Number(x.t); return Number.isFinite(t) && t > 0 && Math.abs(now - t) <= BET_FRESH; });
  } catch (e) { return []; }
}
// One event for one push. `account` = the player's My Apps account email. Reads only; never changes `before` or `after`.
function betsPushed(account, before, after) {
  try {
    if (!enabled()) return false;
    let ready = false; try { ready = !!D.maReady(); } catch (e) {}
    if (!ready) return false;
    const fresh = newBets(before, after, D.now()); if (!fresh.length) return false;
    const n = fresh.length, acct = cleanAccount(account);
    return emit('bet_new', { account: acct, title: n === 1 ? 'Added 1 bet' : 'Added ' + n + ' bets', detail: betText(fresh[0]) + (n > 1 && betText(fresh[0]) ? ' (first of ' + n + ')' : ''), key: (acct || 'player') + '|' + String(fresh[0].id) });
  } catch (e) { return false; }
}

// ---------- hooks for the games that are not built yet (Calcutta, golf, pickleball) ----------
// group = the group's name, or the group object ({id, name}). o (optional) = { account, key, detail }.
// Pass o.key = something that names THIS auction / round / session (its own id): the same key is announced once only. With no key, one is made from the
// group, the name and today's date, so the same thing started twice in a day is announced once.
const gname = (g) => (g && typeof g === 'object' ? g.name : g), gid = (g) => (g && typeof g === 'object' && g.id != null ? String(g.id) : String(gname(g) == null ? '' : gname(g)));
const day = () => new Date(D.now()).toISOString().slice(0, 10);
function hook(type, label, group, name, o) {
  try {
    o = o || {}; const gn = clean(gname(group), 40), nm = clean(name, 50);
    return emit(type, { account: o.account, title: label + (nm ? ': ' + nm : ''), detail: o.detail != null ? o.detail : (gn ? 'Group: ' + gn : ''), key: o.key != null ? o.key : type + '|' + gid(group) + '|' + nm + '|' + day() });
  } catch (e) { return false; }
}
const calcuttaStarted = (group, name, o) => hook('calcutta_start', 'Calcutta started', group, name, o);
const golfStarted = (group, name, o) => hook('golf_start', 'Golf started', group, name, o);
const pickleballStarted = (group, name, o) => hook('pickleball_start', 'Pickleball started', group, name, o);
// One lot sold in a Calcutta auction. lot = what was sold ("Kansas City"), buyer = the buyer's shown name, price = whole dollars (optional).
function calcuttaSold(group, lot, buyer, price, o) {
  try {
    o = o || {}; const gn = clean(gname(group), 40), lt = clean(lot, 50), by = clean(buyer, 30), p = Number(price), money = Number.isFinite(p) && p > 0 && p < 1e6 ? '$' + (Number.isInteger(p) ? p : p.toFixed(2)) : '';
    return emit('calcutta_sold', { account: o.account, title: 'Calcutta sold' + (lt ? ': ' + lt : ''), detail: [by ? 'To ' + by : '', money ? 'for ' + money : ''].filter(Boolean).join(' ') + (gn ? (by || money ? '. ' : '') + 'Group: ' + gn : ''), key: o.key != null ? o.key : 'calcutta_sold|' + gid(group) + '|' + lt + '|' + day() });
  } catch (e) { return false; }
}

module.exports = { emit, build, clean, betText, newBets, betsPushed, calcuttaStarted, calcuttaSold, golfStarted, pickleballStarted, TYPES, enabled,
  _deps: D, _cfg: CFG, _reset: reset, _state: () => ({ queued: Q.length, fails: ST.fails, until: ST.until, sent: ST.sent, dropped: ST.dropped, busy: ST.busy }), _drain: drain };
