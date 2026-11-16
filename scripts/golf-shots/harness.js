// Golf phone-check harness (review round 3 screens). The real odds-api/golf.js + golf-courses.js with in-memory storage, fake sign-in, a fake tour feed,
// the fake stats contract (golf.fakestats.js) and a mocked course directory, on :8842. Static files: pics/ on :8843 (python3 -m http.server 8843).
// Run: node scripts/golf-shots/harness.js &   then   python3 scripts/golf-shots/walk.py   (screens and report in /tmp/golf-shots3). No network, no database.
// WRITES ONLY UNDER /tmp (the seed file /tmp/golf-shots3/seed.json).
const http = require('http'), fs = require('fs'), path = require('path'), R = path.join(__dirname, '../../odds-api/'), G = require(R + 'golf.js'), D = G._deps, CO = require(R + 'golf-courses.js');
require(R + 'golf.fakestats.js').install(G); D.limitsMod = () => null; D.groups = () => null;
const OUT = '/tmp/golf-shots3/', PORT = Number(process.env.PORT || 8842); fs.mkdirSync(OUT, { recursive: true });
let db = {};
D.S = { dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null), dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); }, dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; } };
const NM = { ann: 'Sir Oddable', bob: 'ChalkEater', cat: 'HookAndLadder', dan: 'PuntReturn', eve: 'MiddleMan', fay: 'OverUnderDog', gus: 'RoadDogRay', hal: 'TeaserTina', ivy: 'Ivy', kim: 'Kim Vu', lou: "Lou O'Neil", max: 'Max Trevino', pro: 'Palm Valley Pro Shop' };
const WHO = {}; Object.keys(NM).forEach((w) => (WHO[NM[w]] = w));
D.acct = () => ({ who: (req) => { const w = String(req.headers['x-token'] || '').replace(/^t-/, ''); return NM[w] ? w + '@phone.oddable' : null; }, isOwnerPhone: () => false, ownerName: () => 'Sir Oddable' });
D.ownerOk = () => false; let OFF = 0; D.now = () => Date.now() + OFF; D.ip = () => '1.2.3.' + Math.floor(Math.random() * 200);
const NOW = Date.now(), TEE = NOW + 2 * 864e5, names = ['Scottie Scheffler', 'Rory McIlroy', 'Xander Schauffele', 'Collin Morikawa', 'Ludvig Aberg', 'Viktor Hovland', 'Patrick Cantlay', 'Tommy Fleetwood', 'Hideki Matsuyama', 'Wyndham Clark', 'Max Homa', 'Sahith Theegala'];
let LIVE = false, DONE = false;
const field = () => Array.from({ length: 60 }, (_, i) => ({ id: 'p' + (i + 1), name: names[i] || 'Golfer ' + (i + 1), pos: LIVE ? String(i + 1) : '', toPar: LIVE ? i - 8 : null, today: LIVE ? (i % 5) - 2 : null, thru: LIVE ? 'F' : '', rounds: LIVE ? [70, 69] : [], st: LIVE && i > 44 ? 'cut' : 'active', tee: TEE + i * 11 * 60e3, started: LIVE, earn: null, sort: i }));
D.feed = { events: async () => [{ id: 'E1', tour: 'pga', name: 'RSM Classic', start: TEE, end: TEE + 4 * 864e5, state: 'pre' }], board: async (tour, ev) => ({ event: { id: ev || 'E1', tour, name: 'RSM Classic', start: TEE, end: TEE + 4 * 864e5, state: DONE ? 'post' : LIVE ? 'in' : 'pre', round: LIVE ? 4 : null, done: DONE }, golfers: field(), firstTee: TEE, earnings: false }) };
const par18 = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], si = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 4, 16, 2, 12, 6, 18, 14, 10];
CO._deps.fetch = async (u) => { const U = new URL(u), q = U.searchParams, off = Number(q.get('offset') || 0), ok = (j) => ({ ok: true, status: 200, json: async () => j });
  if (/\/courses\/search/.test(U.pathname)) { const n = Math.min(25, Math.max(0, 60 - off)); return ok({ total: 60, courses: Array.from({ length: n }, (_, i) => ({ id: 'og-' + (off + i + 1), course_name: ['Palm Valley Golf Club', 'Valley View Golf Course', 'Valley Oaks Country Club'][(off + i) % 3] + (off + i > 2 ? ' ' + (off + i + 1) : ''), city: ['McAllen', 'Mission', 'Harlingen'][(off + i) % 3], state: 'TX', par_total: 72, holes_count: 18 })) }); }
  if (/\/tees$/.test(U.pathname)) return ok({ tees: [{ tee_key: 'blue-male', tee_name: 'Blue', tee_color: 'blue', gender: 'Male', course_rating: 72.1, slope: 128, par: 72, yardage: 6612 }, { tee_key: 'white-male', tee_name: 'White', tee_color: 'white', gender: 'Male', course_rating: 70.0, slope: 121, par: 72, yardage: 6198 }] });
  if (/\/holes$/.test(U.pathname)) return ok({ holes: par18.map((p, i) => ({ number: i + 1, par: p, handicap_index: si[i], yardages: { blue: p * 90 + 40 + i, white: p * 85 + 20 + i } })) });
  if (/\/courses\/og-/.test(U.pathname)) return ok({ id: U.pathname.split('/').pop(), course_name: 'Palm Valley Golf Club', city: 'McAllen', state: 'TX' }); return { ok: false, status: 404, json: async () => ({}) }; };
D.courses = CO;
const srv = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-token,x-dash', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); return res.end(); }
  if (req.url === '/__reseed') { try { const o = await seed(); res.setHeader('Access-Control-Allow-Origin', '*'); return res.end(JSON.stringify(o)); } catch (e) { res.statusCode = 500; return res.end(String(e)); } }
  if (!(await G.handle(req, res))) { res.statusCode = 404; res.end('{}'); }
});
const call = async (who, op, b, soft) => { const r = await fetch('http://127.0.0.1:' + PORT + '/golf/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': 't-' + who }, body: JSON.stringify(Object.assign({ myName: NM[who] }, b || {})) }); const j = await r.json(); if (!r.ok && !soft) throw new Error(who + ' ' + op + ' ' + JSON.stringify(j).slice(0, 300)); j._s = r.status; return j; };
// THE NEUTRAL RULE in the seed: an action that waits is signed by the first person who may sign it (unless the scene wants it left waiting)
const sg = async (j, id) => { if (!j.pending || !j.n) return j; const q = j.game.pending.find((x) => x.n === j.n); return call(WHO[q.who[0]], 'sign', { id, n: q.n }); };
const course = { name: 'Palm Valley Golf Club', tees: 'White', holes: 18, par: par18, hcp: si, rating: 70.0, slope: 121, yards: par18.map((p, i) => p * 85 + 20 + i), city: 'McAllen' };
const conf = async (who, id, tid, from, to) => { const g = (await call(who, 'get', { id })).game, revs = {}; Object.keys(g.day.scores[tid] || {}).forEach((h) => (revs[h] = g.day.scores[tid][h].rev)); return call(who, 'confirm', { id, tid, from: from || 1, to: to || 18, revs }); };
const nums = async (ws, id, pid, opt) => { for (let i = opt.orgOut ? 1 : 0; i < ws.length; i++) { const r = await call(ws[0], 'team', { id, op: 'hcp', pid: pid[ws[i]], hcp: (opt.hc || [])[i] != null ? opt.hc[i] : 4 + i * 5, reason: 'club card' }, true); if (r._s === 202 && !r.n) { for (let k = 1; k < ws.length; k++) { const q = await call(ws[k], 'team', { id, op: 'hcpok', pid: pid[ws[i]] }, true); if (q._s === 200) break; } } else await sg(r, id); } };
// one-player teams: ws[0] organizes and plays T1 (orgOut: the organizer does not play). Everyone marked paid before the start; numbers set through the rule.
const mk1 = async (ws, title, day, pot, opt) => { opt = opt || {}; const g = (await call(ws[0], 'create', { kind: 'day', title, course, day: Object.assign({ fmt: 'stroke', teams: ws.length - (opt.orgOut ? 1 : 0), teamSize: 1, net: 'net' }, day || {}), pot })).game, id = g.id;
  for (let i = 1; i < ws.length; i++) await call(ws[i], 'join', { code: g.code, tid: 'T' + (opt.orgOut ? i : i + 1) }); if (!opt.orgOut) await call(ws[0], 'team', { id, op: 'assign', pid: g.me, tid: 'T1' });
  const g2 = (await call(ws[0], 'get', { id })).game, pid = {}; ws.forEach((w) => (pid[w] = g2.members.find((m) => m.name === NM[w]).pid)); for (let i = 0; i < ws.length; i++) { await call(ws[0], 'team', { id, op: 'rename', tid: 'T' + (opt.orgOut ? i : i + 1), name: NM[ws[i]] }, true); }
  for (const w of opt.paid || ws) if (!(opt.orgOut && w === ws[0])) await call(ws[0], 'paid', { id, pid: pid[w], paid: true });
  if (!opt.noNums) await nums(ws, id, pid, opt);
  return { id, code: g.code, pid }; };
const play = async (id, who, tid, p, f, from, to) => { for (let h = from || 1; h <= (to || 18); h++) await call(who, 'score', { id, tid, hole: h, p: { [p]: f(h) } }); };
// seed(): every scene from scratch. The walker asks for it again (GET /__reseed) before each size and theme, because walking signs and turns things down.
async function seed() {
  { db = {}; OFF = 0; LIVE = false; DONE = false; G._reset(); const out = {};
    // A. LIVE MONEY ROUND WITH THINGS WAITING FOR A SIGNATURE: the organizer plays. She asked to change an opponent's confirmed hole, to mark the team that is
    //    short of holes did not finish, and to mark a player not paid; a hole on her own card is disputed and she asked for a number.
    { const { id, pid } = await mk1(['ann', 'bob', 'cat'], 'Saturday money game', { extras: { skins: { on: true, net: true, amt: 5 }, ctp: [3], ctpAmt: 20 }, hu: { on: true, kind: 'team', type: 'nassau', amt: 10 } }, { entry: 20 }); out.wait = id;
      await sg(await call('ann', 'match', { id, op: 'add', a: 'T1', b: 'T2' }), id); await call('ann', 'start', { id });
      await play(id, 'ann', 'T1', pid.ann, (h) => par18[h - 1] + (h % 3 === 0 ? 1 : 0)); await play(id, 'bob', 'T2', pid.bob, (h) => par18[h - 1] + (h % 4 === 0 ? 1 : 0)); await play(id, 'cat', 'T3', pid.cat, (h) => par18[h - 1] + 1, 1, 9);
      await conf('bob', id, 'T1'); await conf('cat', id, 'T2'); await conf('ann', id, 'T3', 1, 6);
      await call('ann', 'extra', { id, kind: 'ctp', hole: 3, who: pid.bob, note: '4 ft' }); await call('cat', 'extraconfirm', { id, kind: 'ctp', hole: 3 });
      await call('cat', 'dispute', { id, tid: 'T1', hole: 7, note: 'I counted a 4, not a 3' });
      await call('ann', 'score', { id, tid: 'T2', hole: 4, p: { [pid.bob]: 7 } }); await call('ann', 'team', { id, op: 'withdraw', tid: 'T3', reason: 'Left after nine holes' }); await call('ann', 'paid', { id, pid: pid.bob, paid: false, reason: 'cheque bounced' }); await call('ann', 'resolve', { id, tid: 'T1', hole: 7, p: { [pid.ann]: 3 } }); }
    // (before B) Lou has three finished rounds, each signed by a different player on another team: his number has a make-up to show
    for (const w of ['max', 'ivy', 'kim']) { const { id, pid } = await mk1(['lou', w], 'Lou and ' + NM[w], { net: 'gross' }, undefined, { paid: [], noNums: true }); await call('lou', 'start', { id }); await play(id, 'lou', 'T1', pid.lou, (h) => par18[h - 1] + 1); await play(id, w, 'T2', pid[w], (h) => par18[h - 1] + (h % 2)); await conf(w, id, 'T1'); await conf('lou', id, 'T2'); await call('lou', 'final', { id }); }
    // B. A NET MONEY GAME IN SET-UP: numbers asked for, the organizer's numbers waiting for a signature, flights preview
    { const g = (await call('kim', 'create', { kind: 'day', title: 'Net skins Saturday', course, day: { fmt: 'stroke', teams: 4, teamSize: 1, net: 'net', flights: 2, myHcp: 8, extras: { skins: { on: true, net: true, amt: 5 } }, hu: { on: true, kind: 'team', type: 'match', amt: 10 } }, pot: { entry: 20 } })).game; out.ask = g.id; out.askCode = g.code;
      for (const [w, h, t] of [['lou', 20, 'T2'], ['max', 4, 'T3'], ['ivy', null, 'T4']]) await call(w, 'join', { code: g.code, tid: t, hcp: h == null ? undefined : h }); await call('kim', 'team', { id: g.id, op: 'assign', pid: g.me, tid: 'T1' });
      const g2 = (await call('kim', 'get', { id: g.id })).game, P = (w) => g2.members.find((m) => m.name === NM[w]).pid; await call('kim', 'team', { id: g.id, op: 'hcp', pid: P('max'), hcp: 4 }, true); await call('kim', 'team', { id: g.id, op: 'hcp', pid: P('ivy'), hcp: 16 }); await call('kim', 'match', { id: g.id, op: 'add', a: 'T1', b: 'T3' }); }
    // C. A FINAL ROUND: the forced finish was signed by another player; the playing organizer has asked to reopen it (waiting)
    { const { id, pid } = await mk1(['ann', 'bob', 'cat'], 'Sunday stroke play', {}, { entry: 20, split: [50, 30, 20] }, { paid: ['ann', 'bob'] }); out.fin = id; await call('ann', 'start', { id }); for (const [w, t, d] of [['ann', 'T1', 1], ['bob', 'T2', 0], ['cat', 'T3', 2]]) await play(id, w, t, pid[w], (h) => par18[h - 1] + (h <= d * 4 ? 1 : 0));
      await conf('bob', id, 'T1'); await conf('ann', id, 'T2'); await sg(await call('ann', 'final', { id, force: true, reason: 'HookAndLadder left; her card was signed on paper' }), id); await call('ann', 'reopen', { id, reason: 'Hole 7 was written down wrong' }); }
    // D. FLIGHTS, BOTH BOARDS, FINAL; nobody in Flight B finished, so its share went to Flight A
    { const ws = ['ann', 'bob', 'cat', 'dan'], { id, pid } = await mk1(ws, 'Club flight day', { net: 'both', flights: 2, payBy: 'both' }, { entry: 20, split: [70, 30] }, { hc: [2, 6, 21, 28] }); out.flt = id; await call('ann', 'start', { id });
      await play(id, 'ann', 'T1', pid.ann, (h) => par18[h - 1]); await play(id, 'bob', 'T2', pid.bob, (h) => par18[h - 1] + (h <= 4 ? 1 : 0)); await play(id, 'cat', 'T3', pid.cat, (h) => par18[h - 1] + 1, 1, 5); await play(id, 'dan', 'T4', pid.dan, (h) => par18[h - 1] + 1, 1, 3);
      await conf('bob', id, 'T1'); await conf('ann', id, 'T2'); for (const t of ['T3', 'T4']) await sg(await call('ann', 'team', { id, op: 'withdraw', tid: t, reason: 'Rained off after a few holes' }), id); await call('ann', 'final', { id }); }
    // E. AN ENTERPRISE TOURNAMENT IN SET-UP, the director does not play: he sets numbers alone (logged, every player told)
    { db['lock:ent'] = { id: 'lock:ent', data: { keys: { 'pro@phone.oddable': true } }, updated: 1 }; G._reset();
      const g = (await call('pro', 'create', { kind: 'day', title: 'Club Championship', course, day: { fmt: 'stroke', teams: 3, teamSize: 1, net: 'net', teeTime: Date.now() + 9 * 864e5 }, pot: { entry: 0 } })).game; out.ent = g.id;
      for (const [w, t, h] of [['gus', 'T1', 40], ['hal', 'T2', null], ['eve', 'T3', null]]) await call(w, 'join', { code: g.code, tid: t, hcp: h == null ? undefined : h }); const g2 = (await call('pro', 'get', { id: g.id })).game, P = (w) => g2.members.find((m) => m.name === NM[w]).pid;
      await call('pro', 'team', { id: g.id, op: 'hcp', pid: P('gus'), hcp: 14.2, reason: 'Club card' }); await call('pro', 'team', { id: g.id, op: 'hcp', pid: P('hal'), hcp: 9, reason: 'Committee review' }); }
    // F. NASSAU with a press offered by the side that is down
    { const { id, pid } = await mk1(['ann', 'bob'], 'Nassau with ChalkEater', { hu: { on: true, kind: 'team', type: 'nassau', amt: 5 } }, undefined, { paid: [] }); out.nas = id; await sg(await call('ann', 'match', { id, op: 'add', a: 'T1', b: 'T2' }), id); await nums(['ann', 'bob'], id, pid, {}); await call('ann', 'start', { id });
      await play(id, 'ann', 'T1', pid.ann, (h) => par18[h - 1] + 1, 1, 3); await play(id, 'bob', 'T2', pid.bob, (h) => par18[h - 1], 1, 3); const g = (await call('ann', 'get', { id })).game; await call('ann', 'match', { id, op: 'press', mid: g.day.matches[0].mid, from: 4 }, true); }
    // G. a casual net game, live (nobody typed a number: 0 strokes, said so on the card) and a solo round
    { const { id, pid } = await mk1(['ann', 'dan'], 'Casual nine and nine', {}, undefined, { paid: [], noNums: true }); out.cas = id; await call('ann', 'start', { id }); await play(id, 'ann', 'T1', pid.ann, (h) => par18[h - 1], 1, 4); await play(id, 'dan', 'T2', pid.dan, (h) => par18[h - 1] + 1, 1, 4);
      const s = (await call('ann', 'create', { kind: 'day', solo: true, title: 'Solo round', course, day: {} })).game; out.solo = s.id; for (let h = 1; h <= 5; h++) await call('ann', 'score', { id: s.id, tid: 'T1', hole: h, p: { [s.me]: par18[h - 1] + (h % 2) } }); }
    // H. PICK SIX POOL, final: a late payment asked for by the playing organizer (waiting); nobody can be marked not paid any more
    { const g = (await call('ann', 'create', { kind: 'pro', title: 'Sunday Crew six', pro: { tour: 'pga', game: 'six', eventId: 'E1', mc: 'w1', tb: 'best' }, pot: { entry: 20 } })).game; out.six = g.id; out.sixCode = g.code; for (const w of ['bob', 'cat']) await call(w, 'join', { code: g.code }); const T = g.tiers;
      await call('ann', 'pick', { id: g.id, picks: T.map((t) => t[1]) }); await call('bob', 'pick', { id: g.id, picks: T.map((t) => t[0]) }); await call('cat', 'pick', { id: g.id, picks: T.map((t) => t[2] || t[0]) }); const mem6 = (await call('ann', 'get', { id: g.id })).game.members, P = (w) => mem6.find((m) => m.name === NM[w]).pid;
      await call('ann', 'paid', { id: g.id, pid: P('ann'), paid: true }); await call('ann', 'paid', { id: g.id, pid: P('bob'), paid: true }); OFF = 6 * 864e5; LIVE = true; DONE = true; await call('ann', 'paid', { id: g.id, pid: P('cat'), paid: true, reason: 'Paid cash at the bar on Thursday' }); }
    // I. a pick six pool still open (set-up screens, picks)
    { OFF = 0; LIVE = false; DONE = false; const g = (await call('bob', 'create', { kind: 'pro', title: 'Open pool', pro: { tour: 'pga', game: 'six', eventId: 'E1', mc: 'w1', tb: 'score' }, pot: { entry: 10 } })).game; out.open = g.id; await call('ann', 'join', { code: g.code }); OFF = 6 * 864e5; LIVE = true; DONE = true; }
    fs.writeFileSync(OUT + 'seed.json', JSON.stringify(out)); G._reset(); return out; }
}
srv.listen(PORT, async () => { try { await seed(); console.log('harness ready on :' + PORT); } catch (e) { console.error('SEED FAIL', e); process.exit(1); } });
