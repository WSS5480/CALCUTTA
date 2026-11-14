// Shared locked picks: the pick the model made BEFORE kickoff, the same for everyone. The first phone that has the app open before kickoff
// saves it here (updated while the line moves); every other phone (and new sign-ins) pulls it, so nobody is missing a lock. The newest pre-kickoff write wins (it is the last snapshot before the game starts); nothing is accepted after kickoff.
const S = require('./sync');
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
const LG = new Set(['nfl', 'cfb']), CAP = 4000, rl = new Map();
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const abbr = (x) => typeof x === 'string' && /^[A-Za-z0-9&.\-]{1,8}$/.test(x);
function clean(it, now) {
  if (!it || !/^\d{5,12}$/.test(String(it.id)) || !num(it.s) || it.s - now > 9 * 864e5) return null;
  const late = it.s <= now; // a phone that locked the pick BEFORE kickoff (its own lock time is earlier than the start) may hand it in while the game is on, only if nobody has yet
  if (late && !(num(it.t) && it.t < it.s && now - it.s < 8 * 36e5)) return null;
  const n = it.snap || {}; if (!abbr(n.su) || !num(n.conf) || n.conf < 0 || n.conf > 1 || !(n.L === null || num(n.L))) return null;
  const o = { su: n.su, conf: n.conf, L: n.L, t: now };
  if (n.ats) { if (!abbr(n.ats.side) || !num(n.ats.cover)) return null; o.ats = { side: n.ats.side, cover: n.ats.cover }; } else o.ats = null;
  return { id: String(it.id), v: o, late };
}
function body(req) { return new Promise((res, rej) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n > 200000) rej(Object.assign(new Error('too big'), { status: 413 })); else c.push(d); }); req.on('end', () => { try { res(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { rej(Object.assign(new Error('bad json'), { status: 400 })); } }); }); }
let cache = {};
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (path !== '/locks') return false;
  try {
    const lg = req.method === 'GET' ? new URL(req.url, 'http://x').searchParams.get('lg') : null;
    if (req.method === 'GET') {
      if (!LG.has(lg)) { send(res, 400, { error: 'bad league' }); return true; }
      const c = cache[lg]; if (c && Date.now() - c.at < 20000) { send(res, 200, { locks: c.locks }); return true; }
      const row = await S.dbGet('lock:' + lg); const locks = (row && row.data && row.data.locks) || {}; cache[lg] = { at: Date.now(), locks }; send(res, 200, { locks }); return true;
    }
    if (req.method !== 'POST') return false;
    const ip = require('./ip').clientIp(req), k = ip + ':' + Math.floor(Date.now() / 6e4); rl.set(k, (rl.get(k) || 0) + 1); if (rl.size > 5000) rl.clear();
    if (rl.get(k) > 30) { send(res, 429, { error: 'slow down' }); return true; }
    const b = await body(req); if (!LG.has(b.lg)) { send(res, 400, { error: 'bad league' }); return true; }
    const now = Date.now(), items = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map((i) => clean(i, now)).filter(Boolean);
    if (!items.length) { send(res, 200, { added: 0 }); return true; }
    const id = 'lock:' + b.lg; let added = 0;
    for (let tries = 0; tries < 4; tries++) {
      let row = await S.dbGet(id); if (!row) { await S.dbPut({ id, salt: 'x', pinhash: 'x', data: { locks: {} }, updated: 1 }, true); row = await S.dbGet(id); if (!row) continue; }
      const locks = Object.assign({}, (row.data && row.data.locks) || {}); added = 0;
      items.forEach((i) => { const o = locks[i.id]; if (o && i.late) return; if (!o) { if (Object.keys(locks).length < CAP) { locks[i.id] = i.v; added++; } } else if (o.su !== i.v.su || o.conf !== i.v.conf || o.L !== i.v.L || JSON.stringify(o.ats) !== JSON.stringify(i.v.ats)) { locks[i.id] = i.v; added++; } });
      if (!added) break;
      if (await S.dbPatchIf(id, row.updated, { locks }, Date.now())) { delete cache[b.lg]; break; } added = 0;
    }
    send(res, 200, { added }); return true;
  } catch (e) { send(res, e.status || 500, { error: e.status ? e.message : 'Lock error: ' + e.message }); return true; }
}
module.exports = { handle, clean };
