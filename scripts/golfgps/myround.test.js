const G = require(require('path').join(__dirname, '../../pics/golfgps.js')); const assert = require('assert');
let posts = [], online = true;
G._deps.fetch = async (u, o) => { if (!online) throw new Error('off'); posts.push([u, o && o.body]); const ok = (j) => ({ ok: true, status: 200, json: async () => j });
  if (/\/rounds$/.test(u) && (!o || o.method === 'GET')) return ok({ ok: true, rounds: [{ id: 'srv1', course: { id: 'way/1', name: 'X' }, date: '2026-11-01', at: 1, par: { 1: 4 }, players: [{ name: 'A', s: { 1: 3 } }], putts: {}, fw: {} }] });
  return ok({ ok: true }); };
const course = { id: 'way/1', name: 'Test', holeCount: 18, holes: [{ n: 1, par: 5, hazards: [] }, { n: 2, hazards: [] }] };
// guest round
let r = G.myStart(course, ['Steve', '', 'Bo']); assert.equal(r.players.length, 2); assert.equal(r.par[1], 5); assert.equal(r.par[2], 4); assert.equal(r.holes, 18);
r.players[0].s[1] = 6; r.players[0].s[2] = 3; G.mySave(r); assert.deepEqual(G.myTotals(G.myRound(), 0), { strokes: 9, par: 9, toPar: 0, holes: 2 });
(async () => {
  let f = await G.myFinish(G.myRound()); assert.equal(f.saved, 'phone'); assert.equal(G.myRound(), null); assert.equal(posts.length, 0, 'a guest sends nothing');
  let l = await G.myRounds(); assert.equal(l.rounds.length, 1); assert.equal(l.where, 'phone');
  // par fix as guest: phone only
  const p = await G.savePar(course, 2, 3); assert.equal(p.where, 'phone'); assert.equal(course.holes[1].par, 3);
  // signed in
  G._deps.set('odd-tok', 'tok'); r = G.myStart(course, []); assert.equal(r.players[0].name, 'Me'); assert.equal(r.par[2], 3, 'fixed par on the new card');
  online = false; f = await G.myFinish(r); assert.equal(f.saved, 'phone-later');
  online = true; l = await G.myRounds(); assert.equal(l.where, 'account'); assert.equal(l.rounds.length, 3, 'server + 2 on phone'); assert.ok(posts.some((x) => /rounds/.test(x[0]) && x[1] && /"round"/.test(x[1])), 'unsent round sent');
  const q = await G.savePar(course, 1, 4); assert.equal(q.where, 'course'); assert.ok(posts.some((x) => /mark/.test(x[0]) && /"par":4/.test(x[1])));
  await G.myDelete('srv1'); assert.ok(posts.some((x) => /"del":"srv1"/.test(x[1] || '')));
  console.log('myround ok');
})().catch((e) => { console.error(e); process.exit(1); });
