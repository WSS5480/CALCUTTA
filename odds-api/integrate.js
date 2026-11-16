// Integration of the merged build (integration owner, Nov 16 2026). This is the "manager wires these at merge" code the feature branches ask for,
// kept in ONE file so the engines stay as their coders committed them. NOT preview-only: it belongs on main together with the merged engines.
//   wire()                       groups.registerGame for Calcutta / golf / local events (pots of attached games show in the group), the stats `groups`
//                                provider, golf's handicap + limits contracts, Calcutta's golf and local-event sources. Safe to call twice.
//   POST /integrate/attach       { groupId, type: 'calc' | 'golf' | 'event', ref, pot? } the group's commissioner adds a game he runs to the group.
//                                Checked three times: signed in; runs that game (asked from the game's own engine with the caller's own token);
//                                commissioner of the group (groups.attachGame). Nothing about money moves; pots are display only.
const { Readable } = require('stream');
const mod = (m) => { try { return require('./' + m); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') console.error('integrate: ' + m + ':', e.message); return null; } };
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const bad = (status, error) => Object.assign(new Error(error), { status });
const body = (req) => new Promise((yes, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 4000) c.push(d); }); req.on('end', () => { if (n > 4000) return no(bad(413, 'Too big')); try { yes(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(bad(400, 'Bad request')); } }); req.on('error', no); });
let WIRED = null;
function wire() {
  if (WIRED) return WIRED; const done = [], G = mod('groups'), C = mod('calcutta'), GO = mod('golf'), E = mod('events'), ST = mod('stats'), LIM = mod('limits');
  const t = (name, fn) => { try { if (fn()) done.push(name); } catch (e) { console.error('integrate [' + name + ']:', e.message); } };
  t('groups game: calc', () => G && G.registerGame && C && (G.registerGame('calc', { potSummary: C.potSummary, attachToGroup: C.attachToGroup }), true));
  t('groups game: golf', () => G && G.registerGame && GO && (G.registerGame('golf', { potSummary: GO.potSummary }), true)); // golf's attach needs the organizer's account: done in the attach route below
  t('groups game: event', () => G && G.registerGame && E && (G.registerGame('event', { potSummary: E.potSummary, attachToGroup: E.ADAPTER && E.ADAPTER.attach ? (ref, gid, cid) => E.ADAPTER.attach(ref, { gid, cid, pot: 'side' }) : undefined }), true));
  t('calcutta source: local events', () => C && E && E.ADAPTER && typeof E.ADAPTER.registerCalcutta === 'function' && (E.ADAPTER.registerCalcutta(C), true));
  t('calcutta source: golf', () => C && GO && typeof GO.registerCalcutta === 'function' && GO.registerCalcutta(C));
  t('stats groups provider', () => ST && G && typeof G.statsFor === 'function' && (ST.register('groups', (k, o) => G.statsFor(k, o)), true));
  t('golf handicaps from stats', () => { if (!GO || !ST || !['handicapFor', 'eventSetup', 'eventOverride', 'eventLog'].every((f) => typeof ST[f] === 'function')) return false; const D = GO._deps;
    D.handicapFor = (k, o) => ST.handicapFor(k, o); D.eventSetup = (d, id, o) => ST.eventSetup(d, id, o); D.eventOverride = (d, id, k, o) => ST.eventOverride(d, id, k, o); D.eventLog = (d, id) => ST.eventLog(d, id); return true; });
  t('golf limits from limits.js', () => { if (!GO || !LIM || !GO.limits) return false; GO.limits.maxPeople = (e, id) => LIM.maxPeople(LIM.keyOf(e), id); GO.limits.isEnterprise = (e) => LIM.isEnterprise(LIM.keyOf(e)); return true; });
  WIRED = done; return done;
}
// ask an engine's own route in-process, as the caller (same token), so its own access rules decide
function ask(m, req, path, b) {
  return new Promise((resolve, reject) => {
    const r = Readable.from([Buffer.from(JSON.stringify(b || {}))]); r.method = 'POST'; r.url = path; r.headers = Object.assign({}, req.headers, { 'content-type': 'application/json' }); r.socket = req.socket;
    const res = { statusCode: 200, setHeader() {}, getHeader() {}, writeHead(c) { this.statusCode = c; return this; }, end(x) { let j = {}; try { j = JSON.parse(String(x || '{}')); } catch (e) {} resolve({ s: this.statusCode, j }); } };
    Promise.resolve(m.handle(r, res)).then((h) => { if (!h) resolve({ s: 404, j: {} }); }, reject);
  });
}
const RL = new Map(); const limited = (k, n, ms) => { const t = Date.now(), a = (RL.get(k) || []).filter((x) => t - x < ms); if (a.length >= n) return true; a.push(t); RL.set(k, a); if (RL.size > 5000) RL.clear(); return false; };
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (!path.startsWith('/integrate/')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  try {
    const A = require('./acct'), e = A.who(req); if (!e) throw bad(401, 'Sign in again');
    if (limited(e, 20, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.');
    const b = await body(req), G = mod('groups'); wire();
    if (path === '/integrate/attach') {
      const type = String(b.type || ''), ref = String(b.ref || ''), gid = String(b.groupId || ''); if (!G || !/^[A-Za-z0-9]{4,20}$/.test(gid) || !/^[A-Za-z0-9:_-]{2,60}$/.test(ref)) throw bad(400, 'Which group and which game?');
      let name = '', mine = false;
      if (type === 'calc') { const C = mod('calcutta'), r = C && await ask(C, req, '/calcutta/get', { id: ref }); if (!r || r.s !== 200) throw bad(404, 'Calcutta not found'); mine = r.j.calc.role === 'comm'; name = r.j.calc.name; }
      else if (type === 'golf') { const GO = mod('golf'), r = GO && await ask(GO, req, '/golf/get', { id: ref }); if (!r || r.s !== 200) throw bad(404, 'Golf game not found'); const g = r.j.game; mine = !!(g.members || []).find((m) => m.pid === g.me && m.org); name = g.title; }
      else if (type === 'event') { const E = mod('events'), r = E && await ask(E, req, '/events/get', { id: ref }); if (!r || r.s !== 200) throw bad(404, 'Event not found'); const ev = r.j.event; mine = ev.role === 'comm' || !!(ev.members || []).find((m) => m.pid === ev.me && m.comm); name = ev.title; }
      else throw bad(400, 'Unknown game type');
      if (!mine) throw bad(403, 'Only the person who runs that game can add it to a group');
      const out = await G.attachGame(gid, e, { type, ref, name, pot: b.pot === 'main' ? 'main' : 'side' });
      if (type === 'golf') { try { await mod('golf').attach(ref, gid, e, out.cid); } catch (er) { console.error('integrate: golf attach', er.message); } }
      send(res, 200, { ok: true, cid: out.cid, pot: out.pot, name }); return true;
    }
    throw bad(404, 'not found');
  } catch (er) { if (!er.status) console.error('integrate:', er.message); send(res, er.status || 500, { error: er.status ? er.message : 'Could not add the game, try again' }); return true; }
}
module.exports = { wire, handle };
