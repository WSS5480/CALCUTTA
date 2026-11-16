// Golf phone-check harness (review round 2 screens). The real odds-api/golf.js + golf-courses.js with in-memory storage, fake sign-in, a fake tour feed,
// the fake stats contract (golf.fakestats.js) and a mocked course directory, on :8822. Static files: pics/ on :8823 (python3 -m http.server).
// Run: node scripts/golf-shots/harness.js &  then  python3 scripts/golf-shots/play.py   (screenshots in /tmp/golf-shots2). No network, no database.
const http = require('http'), path = require('path'), R = path.join(__dirname, '../../odds-api/'), G = require(R + 'golf.js'), D = G._deps, CO = require(R + 'golf-courses.js');
require(R + 'golf.fakestats.js').install(G);
let db = {};
D.S = { dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null), dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); }, dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; } };
const NM = { ann: 'Sir Oddable', bob: 'ChalkEater', cat: 'HookAndLadder', dan: 'PuntReturn', eve: 'MiddleMan', fay: 'OverUnderDog', gus: 'RoadDogRay', hal: 'TeaserTina', ivy: 'Ivy', kim: 'Kim Vu', lou: "Lou O'Neil", max: 'Max Trevino' };
D.acct = () => ({ who: (req) => { const w = String(req.headers['x-token'] || '').replace(/^t-/, ''); return NM[w] ? w + '@phone.oddable' : null; }, isOwnerPhone: () => false, ownerName: () => 'Sir Oddable' });
D.ownerOk = () => false; let OFF = 0; D.now = () => Date.now() + OFF; D.ip = () => '1.2.3.' + Math.floor(Math.random() * 200);
const NOW = Date.now(), TEE = NOW + 2 * 864e5, names = ['Scottie Scheffler', 'Rory McIlroy', 'Xander Schauffele', 'Collin Morikawa', 'Ludvig Aberg', 'Viktor Hovland', 'Patrick Cantlay', 'Tommy Fleetwood', 'Hideki Matsuyama', 'Wyndham Clark', 'Max Homa', 'Sahith Theegala'];
let WD = null, LIVE = false;
const field = () => Array.from({ length: 60 }, (_, i) => { const id = 'p' + (i + 1), wd = id === WD; return { id, name: names[i] || 'Golfer ' + (i + 1), pos: '', toPar: LIVE && !wd && i % 3 === 0 ? i - 6 : null, today: null, thru: '', rounds: [], st: wd ? 'wd' : 'active', tee: TEE + i * 11 * 60e3, started: LIVE && !wd && i % 3 === 0, earn: null, sort: i }; });
D.feed = { events: async () => [{ id: 'E1', tour: 'pga', name: 'RSM Classic', start: TEE, end: TEE + 4 * 864e5, state: 'pre' }], board: async (tour, ev) => ({ event: { id: ev || 'E1', tour, name: 'RSM Classic', start: TEE, end: TEE + 4 * 864e5, state: LIVE ? 'in' : 'pre', round: LIVE ? 1 : null, done: false }, golfers: field(), firstTee: TEE, earnings: false }) };
// course directory: 60 "Valley" courses in pages of 25; DOWN = the service cannot be reached (the bundled sample list is offered)
let DOWN = false; const par18 = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], si = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 4, 16, 2, 12, 6, 18, 14, 10];
CO._deps.fetch = async (u) => { if (DOWN) throw new Error('ECONNRESET'); const U = new URL(u), q = U.searchParams, off = Number(q.get('offset') || 0), ok = (j) => ({ ok: true, status: 200, json: async () => j });
  if (/\/courses\/search/.test(U.pathname)) { const n = Math.min(25, Math.max(0, 60 - off)); return ok({ total: 60, courses: Array.from({ length: n }, (_, i) => ({ id: 'og-' + (off + i + 1), course_name: ['Palm Valley Golf Club', 'Valley View Golf Course', 'Valley Oaks Country Club'][(off + i) % 3] + (off + i > 2 ? ' ' + (off + i + 1) : ''), city: ['McAllen', 'Mission', 'Harlingen'][(off + i) % 3], state: 'TX', par_total: 72, holes_count: 18 })) }); }
  if (/\/tees$/.test(U.pathname)) return ok({ tees: [{ tee_key: 'blue-male', tee_name: 'Blue', tee_color: 'blue', gender: 'Male', course_rating: 72.1, slope: 128, par: 72, yardage: 6612 }, { tee_key: 'white-male', tee_name: 'White', tee_color: 'white', gender: 'Male', course_rating: 70.0, slope: 121, par: 72, yardage: 6198 }] });
  if (/\/holes$/.test(U.pathname)) return ok({ holes: par18.map((p, i) => ({ number: i + 1, par: p, handicap_index: si[i], yardages: { blue: p * 90 + 40 + i, white: p * 85 + 20 + i } })) });
  if (/\/courses\/og-/.test(U.pathname)) return ok({ id: U.pathname.split('/').pop(), course_name: 'Palm Valley Golf Club', city: 'McAllen', state: 'TX' }); return { ok: false, status: 404, json: async () => ({}) }; };
D.courses = CO;
const srv = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-token,x-dash', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); return res.end(); }
  if (req.url === '/__down') { DOWN = true; CO._reset(); return res.end('ok'); } if (req.url === '/__up') { DOWN = false; CO._reset(); return res.end('ok'); }
  if (!(await G.handle(req, res))) { res.statusCode = 404; res.end('{}'); }
});
const call = async (who, op, b, soft) => { const r = await fetch('http://127.0.0.1:8822/golf/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': 't-' + who }, body: JSON.stringify(Object.assign({ myName: NM[who] }, b || {})) }); const j = await r.json(); if (!r.ok && !soft) throw new Error(who + ' ' + op + ' ' + JSON.stringify(j).slice(0, 300)); return j; };
const course = { name: 'Palm Valley Golf Club', tees: 'White', holes: 18, par: par18, hcp: si, rating: 70.0, slope: 121, yards: par18.map((p, i) => p * 85 + 20 + i), city: 'McAllen' };
const conf = async (who, id, tid, from, to) => { const g = (await call(who, 'get', { id })).game, revs = {}; Object.keys(g.day.scores[tid] || {}).forEach((h) => (revs[h] = g.day.scores[tid][h].rev)); return call(who, 'confirm', { id, tid, from: from || 1, to: to || 18, revs }); };
// one-player teams: names[0] organizes and plays T1
const mk1 = async (ws, title, day, pot, paid) => { const g = (await call(ws[0], 'create', { kind: 'day', title, course, day: Object.assign({ fmt: 'stroke', teams: ws.length, teamSize: 1, net: 'gross' }, day || {}), pot })).game; for (let i = 1; i < ws.length; i++) await call(ws[i], 'join', { code: g.code, tid: 'T' + (i + 1) }); await call(ws[0], 'team', { id: g.id, op: 'assign', pid: g.me, tid: 'T1' });
  const g2 = (await call(ws[0], 'get', { id: g.id })).game, pid = {}; ws.forEach((w) => (pid[w] = g2.members.find((m) => m.name === NM[w]).pid)); for (const w of paid || ws) await call(ws[0], 'paid', { id: g.id, pid: pid[w], paid: true }); return { id: g.id, code: g.code, pid }; };
const play = async (id, who, tid, p, f, from, to) => { for (let h = from || 1; h <= (to || 18); h++) await call(who, 'score', { id, tid, hole: h, p: { [p]: f(h) } }); };
srv.listen(8822, async () => {
  try { const out = {};
    // A. a final money round, reopened by the organizer who then changed her own card: notice for Bob, "your own side" block for the organizer
    { const { id, pid } = await mk1(['ann', 'bob'], 'Saturday skins', { extras: { ctp: [3], ctpAmt: 50 } }, { entry: 100 }); out.flip = id; await call('ann', 'start', { id }); await play(id, 'ann', 'T1', pid.ann, (h) => par18[h - 1] + 1); await play(id, 'bob', 'T2', pid.bob, (h) => par18[h - 1]);
      await conf('bob', id, 'T1'); await conf('ann', id, 'T2'); await call('ann', 'extra', { id, kind: 'ctp', hole: 3, who: pid.ann, note: '6 ft' }); await call('bob', 'extraconfirm', { id, kind: 'ctp', hole: 3 }); await call('ann', 'final', { id });
      await call('ann', 'reopen', { id, reason: 'Hole 7 was written down wrong' }); await call('ann', 'score', { id, tid: 'T1', hole: 7, p: { [pid.ann]: 2 } }); }
    // B. a final round (reopen form, frozen paid list)
    { const { id, pid } = await mk1(['ann', 'bob', 'cat'], 'Sunday stroke play', {}, { entry: 20, split: [50, 30, 20] }, ['ann', 'bob']); out.fin = id; await call('ann', 'start', { id }); for (const [w, t, d] of [['ann', 'T1', 1], ['bob', 'T2', 0], ['cat', 'T3', 2]]) await play(id, w, t, pid[w], (h) => par18[h - 1] + (h <= d * 4 ? 1 : 0));
      await conf('bob', id, 'T1'); await conf('ann', id, 'T2'); await conf('ann', id, 'T3'); await call('ann', 'final', { id }); }
    // C. a money round where one player stopped after one hole
    { const { id, pid } = await mk1(['ann', 'gus', 'hal'], 'Friday money game', {}, { entry: 50 }); out.dnf = id; await call('ann', 'start', { id }); await play(id, 'gus', 'T2', pid.gus, (h) => par18[h - 1] + (h <= 5 ? 1 : 0)); await play(id, 'ann', 'T1', pid.ann, (h) => par18[h - 1] + 1); await play(id, 'hal', 'T3', pid.hal, () => 4, 1, 1);
      await conf('gus', id, 'T1'); await conf('ann', id, 'T2'); await conf('ann', id, 'T3'); }
    // D. flights, both boards, final
    { const ws = ['ann', 'bob', 'cat', 'dan', 'eve', 'fay'], hc = [2, 6, 11, 15, 21, 28], over = [0, 2, 8, 13, 18, 23]; const g = (await call('ann', 'create', { kind: 'day', title: 'Club flight day', course, day: { fmt: 'stroke', teams: 6, teamSize: 1, net: 'both', flights: 2, payBy: 'both' }, pot: { entry: 20, split: [70, 30] } })).game; out.flt = g.id;
      for (let i = 1; i < 6; i++) await call(ws[i], 'join', { code: g.code, tid: 'T' + (i + 1) }); await call('ann', 'team', { id: g.id, op: 'assign', pid: g.me, tid: 'T1' }); const g2 = (await call('ann', 'get', { id: g.id })).game, pid = {}; ws.forEach((w) => (pid[w] = g2.members.find((m) => m.name === NM[w]).pid));
      for (let i = 0; i < 6; i++) { await call('ann', 'team', { id: g.id, op: 'rename', tid: 'T' + (i + 1), name: NM[ws[i]] }); await call('ann', 'paid', { id: g.id, pid: pid[ws[i]], paid: true }); if (i) await call('ann', 'team', { id: g.id, op: 'hcp', pid: pid[ws[i]], hcp: hc[i] }, true); } await call('ann', 'team', { id: g.id, op: 'hcp', pid: pid.ann, hcp: hc[0] }, true); await call('bob', 'team', { id: g.id, op: 'hcpok', pid: pid.ann }, true); // players who already have 3 confirmed rounds in this seed keep their confirmed index
      await call('ann', 'start', { id: g.id }); for (let i = 0; i < 6; i++) await play(g.id, ws[i], 'T' + (i + 1), pid[ws[i]], (h) => par18[h - 1] + (h <= over[i] ? 1 : 0) + (h <= over[i] - 18 ? 1 : 0)); for (let i = 0; i < 6; i++) await conf(ws[(i + 1) % 6], g.id, 'T' + (i + 1)); await call('ann', 'final', { id: g.id }); }
    // E. a net money game in set-up: numbers asked for, waiting for an OK; flights preview
    { const g = (await call('kim', 'create', { kind: 'day', title: 'Net skins Saturday', course, day: { fmt: 'stroke', teams: 4, teamSize: 1, net: 'net', flights: 2, myHcp: 8, extras: { skins: { on: true, net: true, amt: 5 } } }, pot: { entry: 20 } })).game; out.ask = g.id; out.askCode = g.code;
      for (const [w, h, t] of [['lou', 20, 'T2'], ['max', 4, 'T3'], ['ivy', null, 'T4']]) await call(w, 'join', { code: g.code, tid: t, hcp: h == null ? undefined : h }); await call('kim', 'team', { id: g.id, op: 'assign', pid: g.me, tid: 'T1' }); }
    // F. Nassau: front nine closed out after 5, holes 6 and 7 played; the organizer is in the match
    { const { id, pid } = await mk1(['ann', 'bob'], 'Nassau with Bob', { hu: { on: true, kind: 'team', type: 'nassau', amt: 5 } }, undefined, []); out.nas = id; const mid = (await call('ann', 'match', { id, op: 'add', a: 'T1', b: 'T2' })).game.day.matches[0].mid; out.nasMid = mid; await call('ann', 'start', { id });
      await play(id, 'ann', 'T1', pid.ann, (h) => (h <= 5 ? par18[h - 1] + 1 : par18[h - 1] - 1), 1, 7); await play(id, 'bob', 'T2', pid.bob, (h) => par18[h - 1], 1, 7); }
    // G. a dispute on the organizer's own team
    { const { id, pid } = await mk1(['ann', 'bob', 'cat'], 'Dispute day', {}, { entry: 10 }); out.dis = id; await call('ann', 'team', { id, op: 'co', pid: pid.cat }); await call('ann', 'start', { id }); await play(id, 'ann', 'T1', pid.ann, (h) => par18[h - 1], 1, 4); await play(id, 'bob', 'T2', pid.bob, (h) => par18[h - 1], 1, 4); await conf('bob', id, 'T1', 1, 2); await call('bob', 'dispute', { id, tid: 'T1', hole: 3, note: 'That was a 4, not a 3' }); }
    // H. a pick six pool: Bob's golfer withdrew before teeing off and he swapped (shown to the pool)
    { const g = (await call('ann', 'create', { kind: 'pro', title: 'Sunday Crew six', pro: { tour: 'pga', game: 'six', eventId: 'E1', mc: 'w1', tb: 'best' }, pot: { entry: 20 } })).game; out.six = g.id; out.sixCode = g.code; for (const w of ['bob', 'cat']) await call(w, 'join', { code: g.code }); const T = g.tiers;
      await call('ann', 'pick', { id: g.id, picks: T.map((t) => t[1]) }); await call('bob', 'pick', { id: g.id, picks: T.map((t) => t[0]) }); await call('cat', 'pick', { id: g.id, picks: T.map((t) => t[2] || t[0]) }); await call('cat', 'leave', { id: g.id });
      OFF = 2 * 864e5 + 60e3; LIVE = true; WD = T[0][0]; const late = T[0].filter((x) => x !== WD).map((x) => field().find((y) => y.id === x)).filter((y) => !y.started && y.tee > D.now())[0]; await call('bob', 'swap', { id: g.id, from: WD, to: late.id }); out.wdName = field().find((y) => y.id === WD).name; out.lateName = late.name; }
    require('fs').writeFileSync('/tmp/golf-shots2/seed.json', JSON.stringify(out)); G._reset(); console.log('harness ready');
  } catch (e) { console.error('SEED FAIL', e); process.exit(1); }
});
