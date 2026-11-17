// Phone alerts for a player's own bets when a game scores, with the app closed (v266). OFF unless env BETPUSH_ENABLED=1.
// With the switch unset: start() sets no timer, tick() makes no call (no ESPN, no database, no My Apps) and every /betpush/* route answers
// "not switched on" without reading anything.
//
// WHO SENDS: My Apps holds the push keys (VAPID_PUBLIC / VAPID_PRIVATE) and every phone's subscription (table ma_push). This server never sees a
// private key. It asks My Apps to deliver (My Apps build .36, its HANDOFF "API contract 4a"):
//   POST {MYAPPS_URL}/api/v1/push/send { slug, secret, account, title (<= 80), body (<= 240, one line), tag ([A-Za-z0-9:_-], <= 64), url (a path starting with /) }
//   -> { ok:true, sent:<devices reached> }   sent 0 = the player has no phone on file. 429 busy (60 a minute per player, 600 per app), 503 nopush (no keys).
// A 404 / 405 / 503 from it stops all sends for 10 minutes (one log line), so a My Apps without the route or the keys is never hammered.
//
// WATCHER (tick): runs every 30 s only while a game with a subscribed bettor is live or within 20 minutes of its start; otherwise one cheap look every
// 10 minutes (5 when games are on but nobody has a bet on them). Reads ESPN scoreboards (the league paths of grade.js LG). First look at a game is
// silent. Every score change = one alert per bettor per poll; basketball = quarter ends and the final unless the player chose every score.
// Storage (Supabase table oddable_sync through sync.js; the 'lock:' prefix keeps both rows out of every player list):
//   lock:betpush    { p: { <account>: { on, mode:'bets'|'final'|'off', bb:'q'|'all', fin:0|1, rid:<the player's own bets row>, dev:<ms a phone was registered>, t } } }
//   lock:betpushst  { seen: { <game id>: { a, h, st, d, per, t } }, day, n: { <account>: alerts sent today } }   (so a restart neither repeats nor bursts)
const B = require('./betstatus');
const D = {
  fetch: (...a) => fetch(...a), now: () => Date.now(), env: (k) => process.env[k], log: (...a) => console.log(...a),
  S: () => require('./sync'), A: () => require('./acct'), LG: () => require('./grade').LG, timer: (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; },
};
const FAST = 30e3, SLOW = 10 * 60e3, REBUILD = 5 * 60e3, NEAR = 20 * 60e3, STALE = 10 * 60e3, HERE = 45e3, DAYCAP = 400, TICKCAP = 300, PLAYERCAP = 300, BOARDCAP = 8, DOWN = 10 * 60e3;
const LGS = ['nfl', 'ncaaf', 'nba', 'ncaab', 'mlb', 'nhl'], BBALL = { nba: 1, ncaab: 1 };
const ROW = 'lock:betpush', STROW = 'lock:betpushst';
const APP_URL = () => { const u = String(D.env('BETPUSH_URL') || ''); return /^\/(?!\/)[^\s\\]{0,299}$/.test(u) ? u : '/?open=bets'; }; // a path inside the app (My Apps refuses anything else); the page opens My Bets on ?open=bets
const enabled = () => D.env('BETPUSH_ENABLED') === '1';
const dbReady = () => !!(String(D.env('SUPABASE_URL') || '').trim() && String(D.env('SUPABASE_KEY') || '').trim());
const keepAwakeOn = () => enabled() && D.env('BETPUSH_KEEPAWAKE') !== '0' && !!D.env('RENDER_EXTERNAL_URL');
const dayIn = (tz, t) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(t));
let M;
function reset() { M = { p: null, pAt: 0, st: null, games: new Map(), boards: {}, schedAt: 0, idx: null, idxAt: 0, pb: {}, cur: 0, here: {}, down: 0, pingAt: 0, dirty: false, active: false, live: false, ids: null, idsAt: 0, testAt: {}, timer: null, stats: { espn: 0, sends: 0, sent: 0, skipped: 0 } }; }
reset();

// ---- storage ----
async function loadPlayers(now) { if (M.p && now - M.pAt < 30 * 60e3) return M.p; const r = await D.S().dbGet(ROW); M.p = (r && r.data && r.data.p && typeof r.data.p === 'object' && r.data.p) || {}; M.pAt = now; return M.p; }
async function savePlayer(acct, change) { // read, change one player, write only if nobody wrote in between
  const S = D.S();
  for (let i = 0; i < 4; i++) {
    let r = await S.dbGet(ROW); if (!r) { await S.dbPut({ id: ROW, salt: 'x', pinhash: 'x', data: { p: {} }, updated: 1 }, true); r = await S.dbGet(ROW); if (!r) continue; }
    const p = Object.assign({}, (r.data && r.data.p) || {}), cur = change(p[acct] ? Object.assign({}, p[acct]) : null); if (cur) p[acct] = cur; else delete p[acct];
    if (await S.dbPatchIf(ROW, r.updated, { p }, Math.max(D.now(), Number(r.updated || 0) + 1))) { M.p = p; M.pAt = D.now(); return cur; }
  }
  throw new Error('Busy, try again');
}
async function loadState(now) {
  if (M.st) return M.st; let d = null; try { const r = await D.S().dbGet(STROW); d = r && r.data; } catch (e) {}
  M.st = { seen: (d && d.seen && typeof d.seen === 'object' && d.seen) || {}, day: (d && d.day) || '', n: (d && d.n && typeof d.n === 'object' && d.n) || {} }; return M.st;
}
async function saveState(now) {
  if (!M.dirty || !M.st) return; M.dirty = false;
  Object.keys(M.st.seen).forEach((k) => { if (now - (M.st.seen[k].t || 0) > 36 * 36e5) delete M.st.seen[k]; });
  try { await D.S().dbPut({ id: STROW, salt: 'x', pinhash: 'x', data: M.st, updated: now }, false); } catch (e) { M.dirty = true; }
}
const counted = (now) => { const d = dayIn('America/Chicago', now); if (M.st.day !== d) { M.st.day = d; M.st.n = {}; M.dirty = true; } return M.st.n; };

// ---- ESPN ----
const dates = (now) => { const d = dayIn('America/New_York', now), h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date(now))) % 24; return h < 6 ? [dayIn('America/New_York', now - 864e5), d] : [d]; }; // before 6 AM Eastern last night's late games are still on yesterday's board
async function board(lg, date, now) { // one league, one day. false = ESPN did not answer (the old copy is kept and nothing is compared)
  const key = lg + '|' + date, L = D.LG()[lg]; if (!L) return false;
  if (M.boards[key] && now - M.boards[key].at < 10e3) return true;
  try {
    M.stats.espn++;
    const r = await D.fetch('https://site.api.espn.com/apis/site/v2/sports/' + L.p + '/scoreboard?dates=' + date.replace(/-/g, '') + '&limit=400' + L.q, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return false; const j = await r.json(), ids = [];
    (j.events || []).forEach((e) => { const g = B.parseEvent(e, lg); if (g) { g.bk = key; M.games.set(g.id, g); ids.push(g.id); } });
    (M.boards[key] ? M.boards[key].ids : []).forEach((id) => { if (!ids.includes(id) && M.games.get(id) && M.games.get(id).bk === key) M.games.delete(id); });
    M.boards[key] = { at: now, ids }; return true;
  } catch (e) { return false; }
}
async function sched(now) {
  const ds = dates(now), want = new Set(); for (const lg of LGS) for (const d of ds) { want.add(lg + '|' + d); await board(lg, d, now); }
  Object.keys(M.boards).forEach((k) => { if (!want.has(k)) { M.boards[k].ids.forEach((id) => { if (M.games.get(id) && M.games.get(id).bk === k) M.games.delete(id); }); delete M.boards[k]; } });
  M.schedAt = now;
}
const hot = (g, now) => g.state === 'in' || (g.state === 'pre' && g.start - now <= NEAR && now - g.start < 6 * 36e5);

// ---- who has a bet on which game (each player's open bets are read at most once per 5 minutes; only subscribed players' own rows are read) ----
async function rebuild(pl, now) {
  const part = pl.length > PLAYERCAP ? Array.from({ length: PLAYERCAP }, (_, i) => pl[(M.cur + i) % pl.length]) : pl; if (pl.length > PLAYERCAP) M.cur = (M.cur + PLAYERCAP) % pl.length;
  for (let i = 0; i < part.length; i += 5) await Promise.all(part.slice(i, i + 5).map(async (acct) => {
    try { const r = await D.S().dbGet(M.p[acct].rid), bets = ((r && r.data && Array.isArray(r.data.bets) && r.data.bets) || []).filter((b) => B.isOpen(b) && B.gids(b).some((id) => M.games.has(id))).slice(0, 200); M.pb[acct] = { at: now, bets }; } catch (e) {} // a failed read keeps the last list
  }));
  const idx = new Map(); Object.keys(M.pb).forEach((acct) => { if (!pl.includes(acct)) { delete M.pb[acct]; return; } const seen = new Set(); M.pb[acct].bets.forEach((b) => B.gids(b).forEach((id) => { if (seen.has(id) || !M.games.has(id)) return; seen.add(id); if (!idx.has(id)) idx.set(id, []); idx.get(id).push(acct); })); });
  M.idx = idx; M.idxAt = now;
}

// ---- the sender: My Apps delivers; this server only asks ----
async function send(acct, msg, now) {
  if (M.down && now - M.down < DOWN) return { ok: false, off: true };
  let r; try { r = await D.A().ma('/api/v1/push/send', { account: acct, title: msg.title, body: msg.body, tag: msg.tag, url: msg.url }); } catch (e) { return { ok: false }; }
  if (r.status === 404 || r.status === 405 || r.status === 503) { M.down = now; D.log('betpush: My Apps cannot send (/api/v1/push/send HTTP ' + r.status + (r.j && r.j.error ? ' ' + String(r.j.error).slice(0, 20) : '') + '); alerts paused for 10 minutes'); return { ok: false, off: true, status: r.status }; }
  const ok = !!r.ok && !(r.j && r.j.ok === false); return { ok, sent: ok ? Number(r.j && r.j.sent) || 0 : 0, status: r.status };
}
// v268: no bet alert goes to an account whose time has ended (acct.js expired(): My Apps says so, cached 2 minutes; unknown or My Apps down = not expired).
// The player's setting and bets row are left exactly as they are, so the alerts start again by themselves the moment he pays.
async function lapsed(acct) { try { const A = D.A(); return typeof A.expired === 'function' ? !!(await A.expired(acct)) : false; } catch (e) { return false; } }
const LAPSED_MSG = 'Your time has ended. Pay to get alerts for your bets again.';
const subscribed = () => Object.keys(M.p || {}).filter((k) => { const p = M.p[k]; return p && p.on && p.mode !== 'off' && p.dev && p.rid; });

// ---- one pass. Returns the wait before the next one. ----
async function tick() {
  const now = D.now();
  if (!enabled() || !dbReady()) { M.active = M.live = false; return SLOW; }
  await loadPlayers(now); await loadState(now);
  const pl = subscribed();
  if (!pl.length || !D.A().maReady()) { M.active = M.live = false; M.idx = null; return SLOW; }
  if (now - M.schedAt >= SLOW) await sched(now);
  let hots = [...M.games.values()].filter((g) => hot(g, now));
  if (!hots.length) { M.active = M.live = false; M.idx = null; await saveState(now); return SLOW; }
  if (!M.idx || now - M.idxAt >= REBUILD) await rebuild(pl, now);
  hots = hots.filter((g) => M.idx.has(g.id));
  if (!hots.length) { M.active = M.live = false; await saveState(now); return REBUILD; }
  const keys = [...new Set(hots.map((g) => g.bk))].slice(0, BOARDCAP), fresh = new Set();
  for (const k of keys) { const [lg, d] = k.split('|'); if (await board(lg, d, now)) fresh.add(k); }
  // compare each watched game that was just read with the last look at it
  const evs = [];
  M.idx.forEach((accts, id) => { const g = M.games.get(id); if (!g || !fresh.has(g.bk) || !(hot(g, now) || (M.st.seen[id] && M.st.seen[id].st === 'in'))) return;
    const c = B.look(g), o0 = M.st.seen[id], o = o0 && now - (o0.t || 0) <= STALE ? o0 : null; // no look, or one older than 10 minutes (the server slept or restarted): silent
    if (!o0 || o0.a !== c.a || o0.h !== c.h || o0.st !== c.st || o0.d !== c.d || o0.per !== c.per) M.dirty = true;
    M.st.seen[id] = Object.assign(c, { t: now }); if (o0 && o0.st === 'post') return;
    const ch = B.change(o, c); if (ch.all || ch.bb) evs.push({ g, ch, accts }); });
  const n = counted(now), gameOf = (id) => M.games.get(String(id)), jobs = [];
  evs.forEach(({ g, ch, accts }) => accts.forEach((acct) => {
    const p = M.p[acct]; if (!p || !p.on || p.mode === 'off' || !p.dev) return;
    const kind = BBALL[g.lg] && p.bb !== 'all' ? ch.bb : ch.all; if (!kind) return;
    if (kind === 'final' ? p.fin === 0 : p.mode === 'final') return;
    if (M.here[acct] && now - M.here[acct] < HERE) { M.stats.skipped++; return; } // the app is open on a phone of his: the in-app pop-up shows this score
    if ((n[acct] || 0) >= DAYCAP) { M.stats.skipped++; return; }
    if (jobs.length >= TICKCAP) { M.stats.skipped++; return; }
    const m = B.compose(kind, g, (M.pb[acct] && M.pb[acct].bets) || [], gameOf); if (!m.lines) return;
    n[acct] = (n[acct] || 0) + 1; M.dirty = true; jobs.push({ acct, msg: { title: m.title, body: m.body, tag: ('bet-' + g.id).replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 64), url: APP_URL() } });
  }));
  for (let i = 0; i < jobs.length; i += 5) await Promise.all(jobs.slice(i, i + 5).map(async (j) => {
    if (await lapsed(j.acct)) { n[j.acct] = Math.max(0, (n[j.acct] || 1) - 1); M.stats.skipped++; return; } // v268: time ended = no alert (nothing about the player is changed)
    M.stats.sends++; const r = await send(j.acct, j.msg, now);
    if (r.ok && r.sent > 0) M.stats.sent++;
    else { n[j.acct] = Math.max(0, (n[j.acct] || 1) - 1); if (r.ok && r.sent === 0) { try { await savePlayer(j.acct, (p) => (p ? Object.assign(p, { dev: 0 }) : null)); } catch (e) {} } } // My Apps has no phone for him any more: stop until he turns it on again
  }));
  M.active = true; M.live = hots.some((g) => M.games.get(g.id) && M.games.get(g.id).state === 'in');
  // Render's free plan sleeps without inbound traffic, which would stop the watcher mid-game: ask for our own public address while a watched game is live, never otherwise
  if (M.live && keepAwakeOn() && now - M.pingAt >= SLOW) { M.pingAt = now; try { Promise.resolve(D.fetch(String(D.env('RENDER_EXTERNAL_URL')).replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(10000) })).catch(() => {}); } catch (e) {} }
  await saveState(now);
  return FAST;
}
function start() { // one line in server.js. With BETPUSH_ENABLED unset: nothing at all.
  if (!enabled() || M.timer) return false;
  const loop = async () => { let wait = SLOW; try { wait = await tick(); } catch (e) { D.log('betpush tick: ' + (e && e.message)); wait = 60e3; } M.timer = D.timer(loop, wait); };
  M.timer = D.timer(loop, 5000); return true;
}

// ---- routes: /betpush/*  (the sign-in token in x-token, as everywhere; no new request header) ----
const sendJ = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const readBody = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n > 6000) { no(new Error('too big')); req.destroy(); } else c.push(d); }); req.on('end', () => { try { const j = JSON.parse(Buffer.concat(c).toString() || '{}'); ok(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); } catch (e) { no(e); } }); req.on('error', no); });
const OFF = { enabled: false, on: false, hasDevice: false, mode: 'off', bb: 'q', finals: true };
const view = (p) => ({ enabled: true, on: !!(p && p.on && p.mode !== 'off'), hasDevice: !!(p && p.dev), mode: p && p.on ? p.mode || 'bets' : 'off', bb: p && p.bb === 'all' ? 'all' : 'q', finals: !(p && p.fin === 0), test: true });
async function rowOf(acct, now) { // the player's own bets row (phone + PIN accounts only: an account id is a one-way code of the row id)
  if (!M.ids || now - M.idsAt > 10 * 60e3 || !M.ids[acct]) { const m = {}, A = D.A(); (await D.S().dbIds()).forEach((id) => { m[A.phoneEmail(id)] = id; }); M.ids = m; M.idsAt = now; }
  return M.ids[acct] || null;
}
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (!path.startsWith('/betpush/')) return false;
  const get = path === '/betpush/status'; if (!get && !['/betpush/set', '/betpush/test', '/betpush/here'].includes(path)) return false;
  if (req.method !== (get ? 'GET' : 'POST')) { sendJ(res, 405, { error: get ? 'GET only' : 'POST only' }); return true; }
  if (!enabled()) { sendJ(res, 200, get ? OFF : Object.assign({ ok: false, error: 'Alerts are not switched on at the server yet' }, OFF)); return true; }
  const acct = D.A().who(req); if (!acct) { sendJ(res, 401, { error: 'Sign in again' }); return true; }
  const now = D.now();
  if (path === '/betpush/here') { M.here[acct] = now; if (Object.keys(M.here).length > 5000) M.here = { [acct]: now }; sendJ(res, 200, { ok: true }); return true; }
  if (!dbReady()) { sendJ(res, 503, { error: 'Alerts are not set up on the server yet' }); return true; }
  try {
    const P = await loadPlayers(now);
    if (get) { sendJ(res, 200, view(P[acct])); return true; }
    let b; try { b = await readBody(req); } catch (e) { sendJ(res, 400, { error: 'bad request' }); return true; }
    if (path === '/betpush/test') {
      const p = P[acct]; if (!p || !p.dev) { sendJ(res, 400, { error: 'Turn alerts on for this phone first' }); return true; }
      if (await lapsed(acct)) { sendJ(res, 403, { ok: false, expired: true, error: LAPSED_MSG }); return true; } // v268
      if (M.testAt[acct] && now - M.testAt[acct] < 30e3) { sendJ(res, 429, { error: 'Wait half a minute between tests' }); return true; } M.testAt[acct] = now; if (Object.keys(M.testAt).length > 5000) M.testAt = {};
      M.down = 0; const r = await send(acct, { title: 'Oddable test alert', body: 'Alerts for your bets are working on this phone.', tag: 'oddable-test', url: APP_URL() }, now);
      if (r.off) { sendJ(res, 503, { ok: false, error: 'Alerts are not switched on at My Apps yet' }); return true; }
      if (!r.ok) { sendJ(res, 502, { ok: false, error: 'Could not send the test' }); return true; }
      if (!r.sent) { try { await savePlayer(acct, (q) => (q ? Object.assign(q, { dev: 0 }) : null)); } catch (e) {} sendJ(res, 200, { ok: false, sent: 0, error: 'No phone is registered for alerts. Turn alerts on again on this phone.' }); return true; }
      sendJ(res, 200, { ok: true, sent: r.sent }); return true;
    }
    // /betpush/set { on, mode:'bets'|'final'|'off', finals:true|false, bb:'q'|'all', subscription? }
    const mode = b.mode === 'off' || b.on === false ? 'off' : b.mode === 'final' ? 'final' : b.mode === 'bets' || b.on === true ? 'bets' : null;
    if (!mode) { sendJ(res, 400, { error: 'bad request' }); return true; }
    let rid = P[acct] && P[acct].rid, dev = null;
    if (mode !== 'off' && (await lapsed(acct))) { sendJ(res, 403, { ok: false, expired: true, error: LAPSED_MSG }); return true; } // v268: turning alerts ON needs a paid-up account; turning them off always works
    if (mode !== 'off') {
      if (!rid) rid = /@phone\.oddable$/.test(acct) ? await rowOf(acct, now) : null;
      if (!rid) { sendJ(res, 400, { error: 'Sign in with your cell number and PIN to get alerts for your bets' }); return true; }
      if (b.subscription !== undefined) {
        const s = b.subscription; if (!s || typeof s !== 'object' || typeof s.endpoint !== 'string' || s.endpoint.length > 1000 || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') { sendJ(res, 400, { error: 'bad request' }); return true; }
        const r = await D.A().ma('/api/v1/push/subscribe', { account: acct, subscription: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh.slice(0, 300), auth: s.keys.auth.slice(0, 300) } } }); // the same My Apps call the renewal reminders use (/acct/push)
        if (!r.ok) { sendJ(res, r.status === 400 || r.status === 503 ? r.status : 502, { error: (r.j && r.j.error) || 'Could not register this phone for alerts' }); return true; }
        dev = now;
      }
    }
    const cur = await savePlayer(acct, (p) => { const q = p || {}; q.on = mode === 'off' ? 0 : 1; q.mode = mode; if (b.bb === 'all' || b.bb === 'q') q.bb = b.bb; else if (!q.bb) q.bb = 'q'; if (b.finals === false) q.fin = 0; else if (b.finals === true || q.fin === undefined) q.fin = 1; if (rid) q.rid = rid; if (dev) q.dev = dev; else if (!q.dev) q.dev = 0; q.t = now; return q; });
    M.idxAt = 0; // the next pass re-reads who has bets
    sendJ(res, 200, Object.assign({ ok: true }, view(cur))); return true;
  } catch (e) { sendJ(res, 502, { error: 'Could not save, try again in a moment' }); return true; }
}
module.exports = { handle, start, tick, enabled, _deps: D, _reset: reset, _m: () => M, FAST, SLOW, REBUILD, DAYCAP, LGS };
