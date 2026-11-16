// TEST HELPER ONLY (golf.test.js, the Playwright harness). NOT loaded by the server.
// A small fake of the stats module's handicap contract (stats-v1 e214bcf, HANDOFF "Player stats (v1.1)"), so golf can be tested on this branch,
// where stats.js is not in the build. Golf itself keeps no index, no override store and no director log: in the merged build golf._deps.stats()
// finds the real odds-api/stats.js and this file is never used.
//   handicapFor(userKey, {eventId, casual, typed}) -> { oddable: {index, rounds, text}, confirmedIndex, rounds, confirmedRounds, event, setBy, use, needsSet, text }
//   eventSetup / eventOverride / eventLog: one row 'lock:evr:<eventId>' { dir, title, lockAt, set: {<player key>: {hcp, at, reason, name}}, log: [...] }
'use strict';
const crypto = require('crypto');
const R = require('./ratings');
const bad = (status, error) => Object.assign(new Error(error), { status });
const keyOf = (e) => crypto.createHash('sha256').update('fake-stats|' + e).digest('hex').slice(0, 24);
const pk = (userKey) => (/^guest:/.test(String(userKey)) ? 'g:' + String(userKey).slice(6) : keyOf(userKey));
const EVR = (id) => 'lock:evr:' + id;
// install(golf, opts) -> the fake. opts.isEnterprise(accountId) decides who may run a tournament (default: golf's own limits).
function install(G, opts) {
  const D = G._deps, o = opts || {}, isEnt = o.isEnterprise || ((e) => G.limits.isEnterprise(e)), locked = (ev) => !!(ev && ev.lockAt && D.now() >= ev.lockAt);
  // The index: WHS method (ratings.js, the stats module's own file) over the player's own complete rounds from the golf engine. confirmed = not a solo round.
  async function hcp(userKey) {
    const recs = (await G.statsFor(userKey, {})).filter((r) => r.kind === 'golf-round' && r.extra && r.extra.ownBall && !r.extra.teamBall && r.extra.rating != null && r.extra.slope != null && r.score != null);
    return R.handicapSet(recs.map((r) => ({ id: r.id, date: r.date, holes: r.extra.of, total: r.score, cr: Number(r.extra.rating), slope: Number(r.extra.slope), par: r.extra.pars.reduce((a, x) => a + x, 0), strokes: r.extra.holeScores, pars: r.extra.pars, si: r.extra.hcpIdx, at: r.extra.at, confirmed: !r.extra.solo })));
  }
  const row = async (id) => { const r = await D.S.dbGet(EVR(id)); return r || null; };
  async function mutate(id, init, fn) { for (let i = 0; i < 8; i++) { let r = await row(id); if (!r) { if (!init) throw bad(404, 'Tournament not found'); await D.S.dbPut({ id: EVR(id), salt: 'x', pinhash: 'x', data: init(), updated: 1 }, true); r = await row(id); if (!r) continue; }
    const data = JSON.parse(JSON.stringify(r.data)), out = await fn(data); if (out && out.nochange) return out.v; if (await D.S.dbPatchIf(EVR(id), r.updated, data, Math.max(D.now(), Number(r.updated) + 1))) return out; } throw bad(409, 'Busy, try again'); }
  const F = {
    handicapFor: async (userKey, opts2) => { const x = opts2 || {}, h = await hcp(userKey), r = x.eventId ? await row(x.eventId) : null, ev = r && r.data, s = ev && ev.set && ev.set[pk(userKey)] && ev.set[pk(userKey)].hcp != null ? ev.set[pk(userKey)] : null;
      const conf = h.confirmedRounds >= 3 ? h.confirmedIndex : null, typed = x.typed != null && x.typed !== '' && Number.isFinite(Number(x.typed)) ? Math.round(Number(x.typed) * 10) / 10 : null;
      let use = null, setBy = null; if (s) { use = s.hcp; setBy = 'tournament'; } else if (x.casual === true) use = h.index; else if (conf != null) use = conf; else if (typed != null) { use = typed; setBy = 'organizer'; }
      return { oddable: { index: h.index, rounds: h.rounds, text: h.text }, confirmedIndex: conf, rounds: h.rounds, confirmedRounds: h.confirmedRounds, event: s ? s.hcp : null, setBy, use, needsSet: use == null && x.casual !== true, text: h.text, reason: s ? s.reason : undefined, at: s ? s.at : undefined, locked: ev ? locked(ev) : undefined }; },
    eventSetup: async (directorE, eventId, x0) => { if (!(await isEnt(directorE))) throw bad(403, 'Only Enterprise tournaments can set handicaps'); const x = x0 || {}, dk = keyOf(directorE), la = Number(x.lockAt) > 0 ? Number(x.lockAt) : null;
      await mutate(eventId, () => ({ dir: dk, set: {}, log: [] }), (d) => { if (d.dir !== dk) throw bad(403, 'Not your tournament'); if (locked(d)) throw bad(409, 'The tournament has started; handicaps are locked'); d.title = String(x.title || d.title || 'Tournament').slice(0, 60); d.sport = 'golf'; d.lockAt = la || d.lockAt || null; return {}; }); return { ok: true }; },
    eventOverride: async (directorE, eventId, userKey, x0) => { const x = x0 || {}, v = x.hcp == null || x.hcp === '' ? null : Math.round(Number(x.hcp) * 10) / 10, reason = String(x.reason || '').trim().slice(0, 120); if (!reason) throw bad(400, 'Enter a reason for the change'); if (v != null && !(v >= -10 && v <= 54)) throw bad(400, 'Handicap must be +10 to 54.0');
      if (!(await isEnt(directorE))) throw bad(403, 'Only an Enterprise account can set tournament handicaps'); const dk = keyOf(directorE), k = pk(userKey), real = (await hcp(userKey)).index;
      return mutate(eventId, null, (d) => { if (d.dir !== dk) throw bad(403, 'Only this tournament\'s director can change handicaps'); if (locked(d)) throw bad(409, 'The tournament has started; handicaps are locked'); d.set = d.set || {}; d.log = d.log || []; const cur = d.set[k] || {}, old = cur.hcp != null ? cur.hcp : real;
        if ((cur.hcp == null && v == null) || cur.hcp === v) return { nochange: true, v: { ok: true, changed: false } }; if (v == null) delete d.set[k]; else d.set[k] = { hcp: v, at: D.now(), reason, name: String(x.name || '').slice(0, 30) };
        d.log.push({ at: D.now(), by: String(x.byName || 'Tournament director').slice(0, 30), player: String(x.name || 'Player').slice(0, 30), field: 'hcp', old: old == null ? null : old, new: v, oddable: real == null ? null : real, reason }); return { ok: true, changed: true, old: old == null ? null : old, new: v }; }); },
    eventLog: async (callerE, eventId) => { const r = await row(eventId), ev = r && r.data; if (!ev || ev.dir !== keyOf(callerE)) throw bad(404, 'Tournament not found'); return { ok: true, director: true, title: ev.title, locked: locked(ev), lockAt: ev.lockAt || null, log: (ev.log || []).slice(-500) }; },
  };
  D.stats = () => F; return F;
}
module.exports = { install };
