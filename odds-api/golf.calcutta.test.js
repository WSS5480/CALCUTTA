// Run: node odds-api/golf.calcutta.test.js   Golf's lot sources against the REAL Calcutta engine (calcutta-v1 dc5371b, "Round 4" contract).
// The engine is not in this branch: it is loaded from CALC=<path>, ./calcutta (merged build) or the Calcutta worktree; with none of them the test is skipped.
// No network, no database: both modules share one in-memory store and one fake sign-in.
'use strict';
const assert = require('assert'), http = require('http'), fs = require('fs'), G = require('./golf'), D = G._deps;
let C = null, from = ''; for (const p of [process.env.CALC, './calcutta', '/home/claude/calcutta-calc/odds-api/calcutta.js'].filter(Boolean)) { if (!C) { try { C = require(p); from = p; } catch (e) {} } }
if (!C || typeof C.registerSource !== 'function') { console.log('SKIPPED: no calcutta.js to test against'); process.exit(0); }
require('./golf.fakestats').install(G);
let db = {}; const S = { dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null), dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); }, dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; }, dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')) };
const ACC = (w) => w + '@phone.oddable', acct = () => ({ who: (req) => { const x = String(req.headers['x-token'] || ''); return x.startsWith('t-') ? ACC(x.slice(2)) : null; }, phoneEmail: (x) => x, isOwnerPhone: () => false, namesGet: async () => ({}), ownerName: () => 'Sir Oddable' });
let NOW = Date.parse('2026-11-18T18:00:00Z');
[D, C._deps].forEach((d) => { d.S = S; d.acct = acct; d.now = () => NOW; d.ip = () => '1.1.1.' + Math.floor(Math.random() * 200); }); C._deps.fetch = async () => { throw new Error('no network in tests'); };
C._deps.limits = () => ({ keyOf: (e) => 'k' + G._mk(e), maxPeople: async () => 8, recordPlay: async () => {} });
D.feed = { events: async () => [], board: async () => { throw new Error('down'); } };
const srv = http.createServer(async (req, res) => { if (await G.handle(req, res)) return; if (await C.handle(req, res)) return; res.statusCode = 404; res.end('{}'); });
let P, pass = 0; const t = (m) => { pass++; console.log('  ok ' + m); };
const call = async (who, path, b) => { const r = await fetch('http://127.0.0.1:' + P + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '' }, body: JSON.stringify(Object.assign({ myName: who[0].toUpperCase() + who.slice(1) }, b || {})) }); const x = await r.text(); let j = {}; try { j = JSON.parse(x); } catch (e) {} return { s: r.status, j, raw: x }; };
const ok = (r, m) => assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300));
const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], SI = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 4, 16, 2, 12, 6, 18, 14, 10], course = { name: 'Test CC', tees: 'White', holes: 18, par: PAR, hcp: SI, rating: 71.2, slope: 125 };
srv.listen(0, async () => { P = srv.address().port; try {
  assert.strictEqual(G.registerCalcutta(C), true, 'the real engine accepts golf\'s sources (' + from + ')');
  // a golf day: ann organizes and plays, bob joined by himself, Joe is a guest ann typed in; zed is a stranger who knows the game id
  let r = await call('ann', '/golf/create', { kind: 'day', title: 'Member day', course, day: { fmt: 'stroke', teams: 3, teamSize: 1, net: 'gross', teeTime: NOW + 2 * 3600e3 } }); ok(r); const gd = r.j.game;
  ok(await call('bob', '/golf/join', { code: gd.code, tid: 'T2' })); ok(await call('ann', '/golf/team', { id: gd.id, op: 'assign', pid: gd.me, tid: 'T1' })); r = await call('ann', '/golf/team', { id: gd.id, op: 'guest', name: 'Walk-in Joe', tid: 'T3' }); ok(r); const joe = r.j.guest;
  const ref = { ev: 'golf-day', golf: { gameId: gd.id } };
  r = await call('zed', '/calcutta/teams', ref); assert.deepStrictEqual([r.s, r.j.code, r.j.teams], [403, 'notin', undefined], 'a stranger who knows the game id gets no team list'); r = await call('zed', '/calcutta/teams', { ev: 'golf-day', golf: { gameId: 'NOSUCHGAME' } }); assert.ok(r.s >= 400 && !r.j.teams, 'an unknown game: nothing');
  r = await call('bob', '/calcutta/teams', ref); ok(r, 'a player in that golf day'); assert.deepStrictEqual(r.j.teams.map((x) => x.name), ['Team 1', 'Team 2', 'Team 3']); assert.ok(!r.raw.includes('@phone.oddable') && !r.raw.includes(joe.gid), 'no account id or guest id reaches the phone');
  t('teams(calc, {viewer}): only people in the golf day see its teams (403 notin for a stranger); no account ids in the answer');
  const mk = (who) => call(who, '/calcutta/create', Object.assign({ name: 'Member day Calcutta', lots: ['T1', 'T2', 'T3'].map((x) => ({ teams: [{ id: 't:' + gd.id + ':' + x, name: x }] })), rows: [{ k: 'place', r: 1, n: 1, pct: 100 }], minBid: 5, inc: 5, take: { kind: 'none' }, order: 'listed', mode: 'manual' }, ref));
  r = await mk('bob'); assert.deepStrictEqual([r.s, r.j.code], [403, 'organizer'], 'a player cannot build a Calcutta on someone else\'s golf day'); r = await mk('zed'); assert.strictEqual(r.s, 403);
  r = await mk('ann'); ok(r, 'the golf day\'s organizer can'); const calc = r.j.calc; assert.strictEqual(calc.started, false); assert.ok(!r.raw.includes('@phone.oddable'), 'the engine keeps keys, not account ids');
  t('organizer(calc, {viewer}): only the golf day\'s organizer creates a Calcutta on it (403 organizer otherwise)');
  // players of record: the two accounts joined the golf day themselves (accepted), the guest goes by 'g:<guest id>'
  const row = Object.values(db).map((x) => x.data).find((x) => x && x.id === calc.id) || {}, por = (row.lots || []).map((l) => (l.por || []).map((e) => [!!e.pend, /^g:/.test(String(e.k)) || !!e.guest]));
  assert.deepStrictEqual(por, [[[false, false]], [[false, false]], [[false, true]]], 'ann and bob are players of record at once (not pending); Joe is a guest: ' + JSON.stringify((row.lots || []).map((l) => l.por)));
  const sb = await C.statsFor(ACC('bob'), {}); assert.ok(Array.isArray(sb), 'statsFor answers for a player of record');
  t('players of record: accounts that joined the golf day themselves are sent accepted (never pending); a guest as g:<guest id>');
  // started(): false in set-up, true once the round starts (and for good); a read problem is thrown, never "started"
  const src = G.calcuttaSource; assert.strictEqual(await src.started(ref), false); assert.strictEqual(await src.startTime(ref), NOW + 2 * 3600e3); assert.strictEqual(await src.endTime(ref), NOW + 8 * 3600e3);
  { const g0 = S.dbGet; S.dbGet = async () => { throw new Error('db down'); }; await assert.rejects(src.started(ref), /db down/); S.dbGet = g0; } await assert.rejects(src.started({ golf: { gameId: 'NOSUCHGAME' } }));
  r = await call('ann', '/calcutta/get', { id: calc.id }); ok(r); assert.strictEqual(r.j.calc.started, false, 'the engine: not started while the golf day is in set-up');
  ok(await call('ann', '/golf/start', { id: gd.id })); assert.strictEqual(await src.started(ref), true); for (let i = 0; i < 6 && !(r.j.calc && r.j.calc.started === true); i++) { NOW += 6e3; r = await call('ann', '/calcutta/get', { id: calc.id }); ok(r); await new Promise((z) => setTimeout(z, 60)); } /* the engine re-reads a source in the background, every 5 s while someone has the Calcutta open */ assert.strictEqual(r.j.calc.started, true, 'the engine locks ownership once the round has started');
  assert.deepStrictEqual(await src.results(ref), {}, 'no results until the round is Final');
  t('started() / startTime() / endTime(): false then true for good; a database error or an unknown game is thrown, never answered as started');
  // results come only from the golf engine, once the round is Final
  const pid = {}; (await call('ann', '/golf/get', { id: gd.id })).j.game.members.forEach((m) => (pid[m.name] = m.pid));
  for (let h = 1; h <= 18; h++) { ok(await call('ann', '/golf/score', { id: gd.id, tid: 'T1', hole: h, p: { [pid.Ann]: PAR[h - 1] + 1 } })); ok(await call('bob', '/golf/score', { id: gd.id, tid: 'T2', hole: h, p: { [pid.Bob]: PAR[h - 1] } })); }
  ok(await call('ann', '/golf/team', { id: gd.id, op: 'withdraw', tid: 'T3', reason: 'Joe did not show' })); ok(await call('ann', '/golf/final', { id: gd.id })); const res = await src.results(ref);
  assert.deepStrictEqual(['T1', 'T2', 'T3'].map((x) => { const v = res['t:' + gd.id + ':' + x]; return [v.place || null, v.champ, v.out]; }), [[2, false, false], [1, true, false], [null, false, true]], 'places from the Final board; the team that did not finish is out');
  r = await call('ann', '/calcutta/result', { id: calc.id, team: 't:' + gd.id + ':T1', place: 1, confirm: true }); assert.ok(r.s === 409 || r.s === 400, 'no hand result on a golf day: results come from the golf engine (' + r.s + ' ' + (r.j.code || '') + ')');
  t('results: only from the golf engine once the round is Final (did-not-finish = out); a hand result is refused by the engine');
  console.log('\nALL ' + pass + ' GOLF x CALCUTTA CHECKS PASSED (engine: ' + from + ')'); srv.close(); process.exit(0);
} catch (e) { console.error('FAIL', e); srv.close(); process.exit(1); } });
