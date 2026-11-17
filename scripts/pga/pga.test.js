// Run: node scripts/pga/pga.test.js   (no network; fixtures are hand-made, see fixtures.js)
'use strict';
const assert = require('assert'), P = require('../../pics/pga.js'), F = require('./fixtures.js');
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n', e); process.exit(1); } };
const by = (r, name) => r.players.find((p) => p.name === name);

t('helpers', () => {
  assert.strictEqual(P.teeParse('Thu Nov 12 13:46:00 PST 2026'), Date.UTC(2026, 10, 12, 21, 46, 0));
  assert.strictEqual(P.teeParse('Fri Jul 17 08:05:00 EDT 2026'), Date.UTC(2026, 6, 17, 12, 5, 0));
  assert.strictEqual(P.teeParse('2026-11-19T12:00Z'), Date.UTC(2026, 10, 19, 12));
  ['70', '-', '', 'Thu Nov 12 13:46:00 XYZ 2026', 'soon', null, 5, {}].forEach((v) => assert.strictEqual(P.teeParse(v), null));
  assert.deepStrictEqual([P.fmtPar(0), P.fmtPar(-4), P.fmtPar(3), P.fmtPar(null)], ['E', '-4', '+3', '']);
});

t('final: positions from the score, ties, rounds, tee time, event', () => {
  const r = P.parse(F.final()), e = r.event;
  assert.strictEqual(e.id, '401811999'); assert.strictEqual(e.name, 'Austin Championship pres. by Compliance Solutions');
  assert.strictEqual(e.status, 'final'); assert.strictEqual(e.round, 4); assert.strictEqual(e.course, ''); assert.strictEqual(e.location, ''); assert.strictEqual(e.purse, null);
  assert.strictEqual(e.dates.start, Date.parse('2026-11-12T05:00Z')); assert.strictEqual(e.dates.end, Date.parse('2026-11-16T05:00Z'));
  assert.strictEqual(e.playoff, false); assert.strictEqual(e.firstTee, Date.UTC(2026, 10, 12, 21, 46));
  assert.strictEqual(r.players.length, 12);
  assert.deepStrictEqual(r.players.slice(0, 9).map((p) => p.pos + ' ' + p.name + ' ' + P.fmtPar(p.toPar)), ['1 Wade Winner -20', '2 Rory Runner -17', 'T3 Tom Tied -15', 'T3 Tim Tied -15', 'T3 Ted Tied -15', '6 Sam Sixth -12', '7 Evan Even E', '8 Luke Line +1', '9 Otto Over +3']);
  const w = by(r, 'Wade Winner');
  assert.deepStrictEqual(w.rounds.map((x) => [x.n, x.strokes, x.toPar]), [[1, 68, -4], [2, 68, -4], [3, 67, -5], [4, 65, -7]]);
  assert.strictEqual(w.total, 268); assert.strictEqual(w.today, -7); assert.strictEqual(w.thru, 'F'); assert.strictEqual(w.status, 'active'); assert.strictEqual(w.country, 'USA'); assert.strictEqual(w.id, '1');
  assert.strictEqual(by(r, 'Rory Runner').country, 'NIR');
});

t('final: missed cut is inferred, no-card player is "no score posted", nobody is called WD/DQ', () => {
  const r = P.parse(F.final());
  const h = by(r, "Sean O'Home"), m = by(r, 'Mike Missed'), nc = by(r, 'Nat Nocard');
  assert.deepStrictEqual([h.status, h.statusSrc, h.pos, h.toPar, h.rounds.length], ['cut', 'inferred', '', 1, 2]);
  assert.strictEqual(m.status, 'cut');
  assert.deepStrictEqual([nc.status, nc.toPar, nc.pos, nc.rounds.length, nc.today, nc.thru, nc.total], ['ns', null, '', 0, null, '', null]); // the feed says score "E": never shown as even par
  assert.ok(!r.players.some((p) => p.status === 'wd' || p.status === 'dq'));
  assert.deepStrictEqual(r.players.slice(9).map((p) => p.name), ["Sean O'Home", 'Mike Missed', 'Nat Nocard']); // out of the weekend below the field, no card last
  // the worst 36-hole score that went on to play round 3 is -1 (Otto, Luke); Sean went home at +1
  assert.strictEqual(r.event.cutLine, -1); assert.strictEqual(r.event.cutLineSrc, 'field');
});

t('in progress: today, thru, tee time before a player starts, live status', () => {
  const r = P.parse(F.live()), e = r.event;
  assert.strictEqual(e.status, 'in'); assert.strictEqual(e.round, 2); assert.strictEqual(e.cutLine, null);
  const a = by(r, 'Ann Alpha'), b = by(r, 'Bea Bravo'), c = by(r, 'Cal Charlie'), ev = by(r, 'Eve Echo');
  assert.deepStrictEqual([a.pos, a.toPar, a.today, a.thru], ['T1', -8, -2, '11']);
  assert.deepStrictEqual([b.pos, b.today, b.thru], ['T1', -4, 'F']);
  assert.deepStrictEqual([c.pos, c.toPar, c.today, c.thru, c.teeTime], ['3', -5, null, '', Date.UTC(2026, 10, 20, 18, 10)]);
  assert.deepStrictEqual([ev.today, ev.thru, ev.teeTime, ev.status], [null, '', null, 'active']);
  assert.ok(r.players.every((p) => p.status === 'active'));
  const r2 = P.parse(F.live(true)); assert.deepStrictEqual([by(r2, 'Ann Alpha').pos, by(r2, 'Ann Alpha').toPar, by(r2, 'Ann Alpha').thru, by(r2, 'Dee Delta').pos], ['1', -9, '12', '3']);
});

t('before round 1: no scores, no positions, tee times, first tee', () => {
  const r = P.parse(F.pre());
  assert.strictEqual(r.event.status, 'pre'); assert.strictEqual(r.event.round, 0); assert.strictEqual(r.event.firstTee, Date.UTC(2026, 10, 19, 12, 0));
  r.players.forEach((p) => assert.deepStrictEqual([p.status, p.toPar, p.pos, p.today, p.thru, p.rounds.length], ['active', null, '', null, '', 0]));
  assert.strictEqual(by(r, 'Bea Bravo').teeTime, Date.UTC(2026, 10, 19, 12, 11)); assert.strictEqual(by(r, 'Cal Charlie').teeTime, null);
});

t('cut made, round 3 under way: leaders waiting to tee off are NOT cut', () => {
  const r = P.parse(F.round3());
  assert.strictEqual(r.event.round, 3);
  assert.deepStrictEqual(r.players.map((p) => p.name + ':' + p.status), ['Lee Leader:active', 'Sy Second:active', 'Bo Bubble:active', 'Earl Early:active', 'Gil Gone:cut', 'Hal Home:cut', 'Wes Walked:cut']);
  assert.strictEqual(r.event.cutLine, 0); assert.strictEqual(r.event.cutLineSrc, 'field');
  const l = by(r, 'Lee Leader'); assert.deepStrictEqual([l.pos, l.today, l.thru], ['1', null, '']);
  assert.deepStrictEqual([by(r, 'Earl Early').thru, by(r, 'Earl Early').today, by(r, 'Gil Gone').today, by(r, 'Gil Gone').thru], ['5', 1, 1, 'F']);
});

t('WD / DQ / CUT only when the feed flags them', () => {
  const r = P.parse(F.flagged());
  assert.deepStrictEqual(["Sean O'Home", 'Mike Missed', 'Nat Nocard'].map((n2) => by(r, n2).status + '/' + by(r, n2).statusSrc), ['cut/feed', 'wd/feed', 'dq/feed']);
});

t('playoff: four regulation rounds kept, winner by feed order, loser second', () => {
  const r = P.parse(F.playoff());
  assert.strictEqual(r.event.playoff, true);
  const w = by(r, 'Wade Winner'), l = by(r, 'Rory Runner');
  assert.deepStrictEqual([w.pos, w.rounds.length, w.toPar, w.total, w.playoff], ['1', 4, -20, 268, true]);
  assert.deepStrictEqual([l.pos, l.rounds.length, l.toPar, l.today], ['2', 4, -20, -8]);
  assert.strictEqual(by(r, 'Tom Tied').pos, 'T3');
});

t('suspended', () => { const r = P.parse(F.suspended()); assert.strictEqual(r.event.status, 'suspended'); assert.strictEqual(r.event.round, 2); });

t('missing fields and junk never throw', () => {
  [null, undefined, 5, 'x', [], {}, { events: null }, { events: [] }, { events: [null] }, F.empty()].forEach((j) => assert.deepStrictEqual(P.parse(j), { event: null, players: [] }));
  let r = P.parse({ events: [{}] }); assert.strictEqual(r.event.name, 'PGA Tour event'); assert.strictEqual(r.event.status, 'pre'); assert.deepStrictEqual(r.players, []); assert.deepStrictEqual(r.event.dates, { start: null, end: null });
  r = P.parse({ events: [{ id: 9, name: '<b>Odd</b> Open', date: 'nope', competitions: [{ competitors: [null, 7, {}, { athlete: null, score: null, linescores: 'x' }, { id: 5, athlete: { displayName: 'Only <i>Name</i>' }, score: { displayValue: '-3' }, linescores: [null, { period: 'x' }, { period: 1, value: 69, displayValue: '-3' }, { period: 99, value: 1 }] }] }] }] });
  assert.strictEqual(r.event.name, 'Odd Open'); assert.strictEqual(r.players.length, 3);
  const o = by(r, 'Only Name'); assert.deepStrictEqual([o.pos, o.toPar, o.thru, o.rounds.length, o.status], ['1', -3, 'F', 1, 'active']);
  assert.strictEqual(r.event.status, 'in'); // no state in the feed but a score exists
  assert.deepStrictEqual(r.players.filter((p) => p.name === 'Unknown').map((p) => p.status), ['ns', 'ns']);
  r = P.parse({ events: [{ id: 1, competitions: [{ competitors: [{ id: 1, athlete: { displayName: 'A' }, linescores: [{ period: 1, value: 70, displayValue: '-2' }, { period: 2, value: 30, displayValue: '+1' }] }] }] }] });
  assert.deepStrictEqual([r.players[0].toPar, r.players[0].thru, r.players[0].today], [-1, '', 1]); // score missing: summed from the rounds; partial round without a hole list: thru unknown
  assert.strictEqual(P.parse(F.final(), { eventId: 'nope' }).event, null); assert.strictEqual(P.parse(F.final(), { eventId: 401811999 }).event.id, '401811999');
});

t('optional extras when the feed has them', () => {
  const j = F.final(), ev = j.events[0]; ev.courses = [{ name: 'Test Hills CC', address: { city: 'Austin', state: 'TX' } }]; ev.displayPurse = '$8,400,000'; ev.tournament = { cutScore: 1, numberOfRounds: 4 }; ev.competitions[0].competitors[0].movement = 2;
  const r = P.parse(j); assert.deepStrictEqual([r.event.course, r.event.location, r.event.purse, r.event.cutLine, r.event.cutLineSrc], ['Test Hills CC', 'Austin, TX', 8400000, 1, 'feed']);
  assert.strictEqual(by(r, 'Wade Winner').movement, 2); assert.strictEqual(by(r, 'Rory Runner').movement, undefined);
});

t('big field parses (120 players)', () => {
  const r = P.parse(F.finalBig()); assert.strictEqual(r.players.length, 120);
  assert.strictEqual(r.players.filter((p) => p.status === 'cut').length, 49); assert.strictEqual(r.players.filter((p) => p.status === 'ns').length, 1); assert.strictEqual(r.players[0].name, 'Wade Winner');
});

t('schedule: names and dates, state by date and by the event on the board', () => {
  const now = Date.parse('2026-11-16T20:00Z'), s = P.schedule(F.final(), now);
  assert.deepStrictEqual(s.map((x) => x.name.slice(0, 10) + ':' + x.state), ['The Sentry:done', 'Fall Test :done', 'Austin Cha:done', 'Sea Island:next', 'Desert Tes:next']);
  assert.strictEqual(s[0].start, Date.parse('2026-01-08T08:00Z')); assert.strictEqual(s[0].id, '401811927');
  assert.strictEqual(P.schedule(F.live(), Date.parse('2026-11-20T20:00Z'))[3].state, 'now');
  assert.strictEqual(P.schedule(F.pre(), Date.parse('2026-11-17T20:00Z'))[2].state, 'done'); // Austin, a day and a half after its end date
  [null, {}, { leagues: [] }, { leagues: [{ calendar: ['2026-01-01T08:00Z', null, {}] }] }].forEach((j) => assert.deepStrictEqual(P.schedule(j, now), []));
});

(async () => { // load / current / loadEvent with a fake fetch
  const D = P._deps; let url = '', body = F.final(), ok = true; D.now = () => Date.parse('2026-11-16T20:00Z');
  D.fetch = async (u) => { url = u; if (!ok) throw new Error('down'); return { ok: true, status: 200, json: async () => body }; };
  P._reset(); assert.strictEqual(P.current(), null);
  const d = await P.load(); assert.strictEqual(url, P.SB); assert.strictEqual(d.players.length, 12); assert.strictEqual(d.schedule.length, 5); assert.strictEqual(d.at, D.now()); assert.strictEqual(P.current(), d);
  ok = false; await assert.rejects(P.load()); assert.strictEqual(P.current(), d, 'a failed read keeps the last good answer');
  ok = true; const le = await P.loadEvent('401811999', Date.parse('2026-11-12T05:00Z')); assert.strictEqual(url, P.SB + '?dates=20261112'); assert.strictEqual(le.event.id, '401811999');
  await assert.rejects(P.loadEvent('nope', Date.parse('2026-11-12T05:00Z')));
  D.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) }); await assert.rejects(P.load(), /503/);
  console.log('pga.test.js: ' + (n + 1) + ' groups passed');
})().catch((e) => { console.error(e); process.exit(1); });
