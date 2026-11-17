// Run: node scripts/golfgps/golfgps.test.js   (the phone's data layer pics/golfgps.js in Node: no browser, no network; the server is a fake)
const assert = require('assert'), G = require('../../pics/golfgps.js'), F = require('./fixtures.js');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }, eq = (a, b, m) => { n++; assert.deepStrictEqual(a, b, m); }, near = (a, b, t, m) => { n++; assert.ok(Math.abs(a - b) <= t, (m || '') + ' got ' + a + ' want ' + b); };
const rejects = async (p, re, m) => { n++; try { await p; } catch (e) { assert.ok(re.test(e.message), (m || '') + ' got "' + e.message + '"'); return e; } assert.fail((m || '') + ' did not refuse'); };
let NOW = new Date(2026, 10, 16, 9, 0, 0).getTime(), calls = [], server = null;
G._deps.now = () => NOW;
G._deps.fetch = async (u, o) => { calls.push({ u, o }); const r = server(u, o); if (r === 'down') throw new Error('net'); return { ok: r.s < 400, status: r.s, json: async () => r.j }; };
const fresh = () => { G._reset(); calls = []; };

(async () => {
  // ---- geometry ----
  const O = { lat: 26.2, lon: -98.23 };
  near(G.yards(O, { lat: 26.201, lon: -98.23 }), 121.6, 1, '0.001 deg north'); near(G.bearing(O, { lat: 26.201, lon: -98.23 }), 0, 0.01, 'north'); near(G.bearing(O, { lat: 26.2, lon: -98.229 }), 90, 0.01, 'east'); near(G.bearing(O, { lat: 26.199, lon: -98.231 }), 222, 1.5, 'south-west');
  near(G.yards(O, G.toward(O, { lat: 26.201, lon: -98.23 }, 4)), 4, 0.01, '4 yards toward'); near(G.yards(O, G.toward(O, { lat: 26.201, lon: -98.23 }, 500)), 121.6, 1, 'never past the target'); eq(G.yards(O, null), null);
  eq([G.fmtYd(152.4), G.fmtYd(1234.5), G.fmtYd(null), G.fmtYd(20000)], ['152', '1,235', '–', '11.4 mi']); eq([G.ord(1), G.ord(2), G.ord(3), G.ord(5), G.ord(11), G.ord(12), G.ord(13), G.ord(18)], ['1st', '2nd', '3rd', '5th', '11th', '12th', '13th', '18th']);

  // ---- loading a course ----
  fresh(); server = (u) => (/\/holes\?id=way\/100$/.test(u) ? { s: 200, j: F.course() } : { s: 404, j: { ok: false, error: 'That course is not on the map.' } });
  const C = await G.loadCourse('way/100'); eq([C.name, C.holeCount, C.holes.length, C.offline], ['Test Links', 18, 4, undefined]);
  const h1 = G.hole(C, 1), h3 = G.hole(C, 3), h9 = G.hole(C, 9); ok(h1.green.front && h1.green.outline.length >= 4 && h1.tee && h1.par === 4, 'hole 1 whole'); ok(h3.green.approx && !h3.green.front, 'hole 3 approximate'); eq([h9.n, h9.mapped, h9.green], [9, false, undefined], 'a hole the map does not have is a stub');
  eq(G.recent().map((c) => c.id), ['way/100'], 'remembered as recent');
  await rejects(G.loadCourse('way/999'), /not on the map/); await rejects(G.loadCourse('x'), /not a course/);
  // no signal: the saved copy, and it says so
  server = () => 'down'; const C2 = await G.loadCourse('way/100'); eq([C2.offline, C2.name, C2.holes.length], [true, 'Test Links', 4]); await rejects(G.loadCourse('way/101'), /No answer/);

  // ---- pin placement: Short / Center / Long ----
  const yd = G.yards, g = h1.green, depth = yd(g.front, g.back); near(depth, 24 / 0.9144, 0.2, 'green 1 is 26.2 yd deep');
  near(yd(g.front, G.placePoint(g, 'front')), 4, 0.05, 'Short = 4 yd in from the front edge'); near(yd(g.back, G.placePoint(g, 'back')), 4, 0.05, 'Long = 4 yd in from the back edge'); near(yd(g.center, G.placePoint(g, 'center')), 0, 0.01, 'Center');
  near(yd(h1.tee, G.placePoint(g, 'back')) - yd(h1.tee, G.placePoint(g, 'front')), depth - 8, 0.1, 'Long plays the depth minus 8 yd longer than Short');
  { const tiny = { center: g.center, front: G.toward(g.center, g.front, 2.5), back: G.toward(g.center, g.back, 2.5) }; near(yd(tiny.front, G.placePoint(tiny, 'front')), 1.25, 0.02, 'tiny green: half way to the centre, never past it'); ok(yd(h1.tee, G.placePoint(tiny, 'front')) < yd(h1.tee, G.placePoint(tiny, 'center')) && yd(h1.tee, G.placePoint(tiny, 'center')) < yd(h1.tee, G.placePoint(tiny, 'back')), 'still short < center < long'); }
  near(yd(h3.green.center, G.placePoint(h3.green, 'front')), 0, 0.01, 'no outline: centre whatever the placement'); eq(G.placePoint(null, 'front'), null);

  // ---- today's round: colour, placement, per hole, next day ----
  let R = G.round('way/100'); eq([R.allDay, R.sel, R.day], [true, null, '2026-11-16']);
  let P = G.pin(C, 1, R); eq([P.by, P.shown, P.label], ['center', 'center', 'Center (no flag colour chosen)']);
  G.setSel(R, 1, { color: 'red' }); P = G.pin(C, 1, R); eq([P.by, P.place, P.color, P.label], ['color', 'front', 'red', 'Red flag = Short']); near(yd(g.front, P.point), 4, 0.05);
  eq(G.pin(C, 2, R).place, 'front', 'same colour all day: hole 2 too'); eq(G.pin(C, 2, G.round('way/100')).color, 'red', 'kept on the phone');
  G.setSel(R, 1, { color: 'blue' }); eq(G.pin(C, 1, R).label, 'Blue flag = Long'); G.setSel(R, 1, { color: 'yellow' }); eq(G.pin(C, 1, R).place, 'back', 'Yellow = Long by default'); G.setSel(R, 1, { color: 'white' }); eq(G.pin(C, 1, R).place, 'center');
  G.setSel(R, 1, { place: 'back' }); P = G.pin(C, 1, R); eq([P.by, P.place, P.color, P.label], ['place', 'back', null, 'Pin Long'], 'Pin today: Long, no colour');
  P = G.pin(C, 3, R); eq([P.noOutline, P.shown, P.label], [true, 'center', 'Center of the green'], 'no outline: centre, and it says so'); eq(G.pin(C, 9, R), null, 'no green at all: no pin');
  // per hole
  G.setSel(R, 1, { color: 'red' }); G.setAllDay(R, false, 1); G.setSel(R, 2, { color: 'blue' }); eq([G.pin(C, 1, R).color, G.pin(C, 2, R).color, G.pin(C, 7, R).color], ['red', 'blue', 'red'], 'hole 2 has its own; the others keep the day\'s');
  G.setSel(R, 7, null); eq(G.pin(C, 7, R).by, 'center', 'a hole can be set to no colour'); eq(G.pin(C, 2, G.round('way/100')).color, 'blue', 'per-hole choice kept');
  G.setAllDay(R, true, 2); eq([G.pin(C, 1, R).color, G.pin(C, 2, R).color, G.pin(C, 7, R).color], ['blue', 'blue', 'blue'], 'back to all day: the colour on screen becomes the day\'s');
  // a pin placed by tapping is for that hole only
  const spot = G.toward(g.center, g.back, 3); G.setPin(R, 1, spot); P = G.pin(C, 1, R); eq([P.by, P.label], ['you', 'Pin placed by you']); near(yd(P.point, spot), 0, 0.01); eq(G.pin(C, 2, R).by, 'color', 'hole 2 untouched'); G.clearPin(R, 1); eq(G.pin(C, 1, R).by, 'color');
  // distances
  { const d = G.distances(h1.tee, h1, G.pin(C, 1, R).point); near(d.center, 300 / 0.9144, 0.3, 'tee to centre 328 yd'); near(d.front, 288 / 0.9144, 0.3); near(d.back, 312 / 0.9144, 0.3); near(d.pin, 312 / 0.9144 - 4, 0.3, 'blue = Long'); const e = G.distances(null, h1, null); eq([e.pin, e.center], [null, null]); const f3 = G.distances(h3.tee, h3, h3.green.center); eq([f3.front, f3.back], [null, null]); }
  // next day / another course: clean
  NOW += 864e5; R = G.round('way/100'); eq([R.sel, R.allDay, Object.keys(R.pins).length, R.day], [null, true, 0, '2026-11-17'], 'next day starts clean'); NOW -= 864e5;
  R = G.round('way/100'); eq(R.sel, { color: 'blue' }, 'same day still there'); eq(G.round('way/200').sel, null, 'another course starts clean');
  G.setDefColor('way/100', 'white'); NOW += 864e5; eq(G.round('way/100').sel, { color: 'white' }, 'a new day starts with the course\'s default colour'); NOW -= 864e5; G.setDefColor('way/100', '');

  // ---- what the colours mean: this phone, the course (locked), reports ----
  fresh(); server = (u) => ({ s: 200, j: F.course() }); let K = await G.loadCourse('way/100'); R = G.round('way/100');
  let fm = G.flagMap(K); eq([fm.src, fm.locked, fm.map], ['default', false, { red: 'front', white: 'center', blue: 'back', yellow: 'back' }]); eq(G.mapText(fm.map), 'Red = Short, White = Center, Blue = Long, Yellow = Long');
  let r = await G.saveFlagMap(K, { red: 'back', white: 'center', blue: 'front', yellow: 'center' }); eq([r.where, /this phone only \(not signed in\)/.test(r.msg)], ['phone', true], 'not signed in: this phone only'); eq(calls.filter((c) => /mark/.test(c.u)).length, 0, 'no server call without a sign-in');
  fm = G.flagMap(K); eq([fm.src, fm.map.red, fm.map.blue], ['phone', 'back', 'front']); G.setSel(R, 1, { color: 'red' }); eq(G.pin(K, 1, R).label, 'Red flag = Long', 'the remap moves the pin'); eq(G.flagMap({ id: 'way/200' }).src, 'default', 'only for that course');
  await rejects(G.saveFlagMap(K, { red: 'back' }), /each colour/); await rejects(G.saveFlagMap(K, { red: 'up', white: 'center', blue: 'front', yellow: 'center' }), /each colour/);
  // signed in, server reachable: stored for the course and locked
  G._deps.set('odd-tok', 'tok-ann'); let posted = null;
  server = (u, o) => { if (/\/mark$/.test(u)) { posted = { body: JSON.parse(o.body), tok: o.headers['x-token'] }; return { s: 200, j: { ok: true, flags: { map: posted.body.flags, locked: true, at: 5, canChange: true } } }; } return { s: 200, j: F.course() }; };
  r = await G.saveFlagMap(K, { red: 'front', white: 'center', blue: 'back', yellow: 'center' }); eq(r.where, 'course'); eq(posted, { body: { id: 'way/100', what: 'flags', flags: { red: 'short', white: 'center', blue: 'long', yellow: 'center' } }, tok: 'tok-ann' }, 'sent as short / center / long with the sign-in');
  fm = G.flagMap(K); eq([fm.src, fm.locked, fm.canChange, fm.map.yellow], ['course', true, true, 'center'], 'the course\'s colours win over the phone\'s'); eq(G.pin(K, 1, R).label, 'Red flag = Short');
  // signed in but no signal: phone only, and it says why
  K = G._tidy(F.course()); server = () => 'down'; r = await G.saveFlagMap(K, { red: 'back', white: 'center', blue: 'front', yellow: 'center' }); eq([r.where, /no signal/.test(r.msg)], ['phone', true], 'offline fallback');
  server = () => ({ s: 503, j: { ok: false, error: 'x' } }); r = await G.saveFlagMap(K, { red: 'back', white: 'center', blue: 'front', yellow: 'back' }); eq(r.where, 'phone', 'server cannot save: phone');
  // a course locked by someone else
  server = (u, o) => (/\/mark$/.test(u) ? { s: 403, j: { ok: false, locked: true, error: 'Ask the organizer to change it', flags: { map: { red: 'long' }, locked: true, at: 1, canChange: false } } } : /flagreport/.test(u) ? ((posted = JSON.parse(o.body)), { s: 200, j: { ok: true, pending: true } }) : { s: 200, j: F.course({ flags: { map: { red: 'short', white: 'center', blue: 'long', yellow: 'long' }, locked: true, at: 1, canChange: false } }) });
  K = await G.loadCourse('way/100'); fm = G.flagMap(K); eq([fm.locked, fm.canChange, fm.pending, fm.review], [true, false, false, undefined]);
  const er = await rejects(G.saveFlagMap(K, { red: 'back', white: 'center', blue: 'front', yellow: 'back' }), /Ask the organizer to change it/); ok(er.locked, 'locked');
  await rejects(G.reportFlags(K, { red: 'front', white: 'center', blue: 'back', yellow: 'back' }, ''), /already this course/, 'identical report refused before it is sent');
  r = await G.reportFlags(K, { red: 'back', white: 'center', blue: 'front', yellow: 'front' }, '  new   flags  '); eq(r.msg, 'Sent. The organizer will review it.'); eq(posted, { id: 'way/100', flags: { red: 'long', white: 'center', blue: 'short', yellow: 'short' }, note: 'new flags' }); eq(G.flagMap(K).pending, true, 'waiting for review');
  G._deps.set('odd-tok', null); await rejects(G.reportFlags(K, { red: 'back', white: 'center', blue: 'front', yellow: 'front' }, ''), /Sign in/); G._deps.set('odd-tok', 'tok-owner');
  // the reviewer's copy
  K = G._tidy(F.course({ flags: { map: { red: 'short', white: 'center', blue: 'long', yellow: 'long' }, locked: true, at: 1, canChange: true }, pendingFlags: { flags: { red: 'long', white: 'center', blue: 'short' }, note: '<b>x</b>', from: 'Player bob', at: 2 } }));
  fm = G.flagMap(K); eq([fm.review.from, fm.review.note, fm.review.map.red, fm.review.map.yellow], ['Player bob', '<b>x</b>', 'back', 'back']);
  server = (u, o) => ((posted = JSON.parse(o.body)), { s: 200, j: posted.action === 'accept' ? { ok: true, flags: { map: { red: 'long', white: 'center', blue: 'short' }, locked: true, at: 3, canChange: true } } : { ok: true } });
  r = await G.reviewFlags(K, 'accept'); eq(posted, { id: 'way/100', action: 'accept' }); fm = G.flagMap(K); eq([fm.map.red, fm.map.blue, fm.review, fm.pending], ['back', 'front', undefined, false], 'accepted: the new colours, report gone');
  K = G._tidy(F.course({ flags: { map: { red: 'short' }, locked: true, at: 1, canChange: true }, pendingFlags: { flags: { red: 'long' }, note: '', from: 'x', at: 2 } })); await G.reviewFlags(K, 'dismiss'); fm = G.flagMap(K); eq([fm.map.red, fm.review, fm.pending], ['front', undefined, false], 'dismissed: unchanged, report gone');

  // ---- marks ----
  fresh(); server = () => ({ s: 200, j: F.course() }); K = await G.loadCourse('way/100'); const g3 = F.at(500, 400);
  r = await G.mark(K, 9, 'green', g3); eq([r.where, /not signed in/.test(r.msg)], ['phone', true]); eq([G.hole(K, 9).green.marked, G.hole(K, 9).mapped], ['phone', false]); near(yd(G.hole(K, 9).green.center, g3), 0, 0.2);
  K = await G.loadCourse('way/100'); eq(G.hole(K, 9).green.marked, 'phone', 'the phone\'s mark is laid over the course again on the next load');
  r = await G.mark(K, 1, 'green', G.toward(G.hole(K, 1).green.center, G.hole(K, 1).green.back, 2)); ok(G.hole(K, 1).green.outline && G.hole(K, 1).green.front && G.hole(K, 1).green.marked === 'phone', 'a mark inside the drawn green keeps its outline');
  await rejects(G.mark(K, 9, 'green', F.at(400, 3600)), /more than 3 km/); await rejects(G.mark(K, 9, 'pin', g3), /Nothing to mark/); await rejects(G.mark(K, 0, 'green', g3), /Nothing to mark/); await rejects(G.mark(K, 9, 'green', { lat: 'a' }), /Nothing to mark/);
  G._deps.set('odd-tok', 't'); server = (u, o) => (/mark/.test(u) ? ((posted = JSON.parse(o.body)), { s: 200, j: { ok: true } }) : { s: 200, j: F.course() });
  r = await G.mark(K, 3, 'tee', F.at(501, 2)); eq(r.where, 'course'); eq([posted.id, posted.n, posted.what], ['way/100', 3, 'tee']); eq(G.hole(K, 3).teeMarked, 'course');
  server = () => 'down'; r = await G.mark(K, 12, 'green', F.at(50, 800)); eq([r.where, /no signal/.test(r.msg)], ['phone', true], 'no signal: kept on the phone');
  server = () => ({ s: 409, j: { ok: false, error: 'This course already has 60 marks.' } }); await rejects(G.mark(K, 13, 'green', F.at(50, 700)), /60 marks/);

  // ---- "Looks like you're on the 5th tee" ----
  fresh(); server = () => ({ s: 200, j: F.course() }); K = await G.loadCourse('way/100'); const t2 = G.hole(K, 2).tee;
  let w = G.teeWatch(null, G.toward(t2, O, 10), K, 1, 1000); eq([w.suggest, w.st.n, w.st.since], [0, 2, 1000], 'near the 2nd tee: not yet'); w = G.teeWatch(w.st, t2, K, 1, 9000); eq(w.suggest, 0, '8 s: not yet'); w = G.teeWatch(w.st, t2, K, 1, 11000); eq(w.suggest, 2, '10 s: suggest hole 2');
  w = G.teeWatch(w.st, G.toward(t2, G.hole(K, 2).green.center, 40), K, 1, 12000); eq([w.suggest, w.st], [0, null], '40 yd away: nothing, and the clock starts again'); eq(G.teeWatch(null, t2, K, 2, 99999).suggest, 0, 'the tee of the hole already showing never suggests'); eq(G.teeWatch(null, null, K, 1, 1).st, null);

  // ---- GPS wording ----
  eq(G.gpsState(null, 'denied', K).kind, 'denied'); eq(G.gpsState(null, '', K).kind, 'none'); eq(G.gpsState(null, 'unsupported', K).kind, 'denied');
  let s = G.gpsState({ lat: t2.lat, lon: t2.lon, acc: 4 }, '', K); eq([s.kind, s.text], ['ok', 'GPS ±4 yd']); s = G.gpsState({ lat: t2.lat, lon: t2.lon, acc: 20.1 }, '', K); eq([s.kind, /^GPS ±22 yd/.test(s.text)], ['poor', true]);
  s = G.gpsState({ lat: t2.lat + 0.05, lon: t2.lon, acc: 5 }, '', K); eq([s.kind, /not at the course\. Distances are from where you are/.test(s.text)], ['far', true]); eq(G.gpsState({ lat: t2.lat + 0.02, lon: t2.lon, acc: 5 }, '', K).kind, 'ok', '1.4 miles away is still "at the course"');

  // ---- search ----
  server = (u) => ((posted = u), { s: 200, j: { ok: true, courses: [], radius: 15, center: {} } }); await G.search({ q: 'McAllen, TX' }, 30); ok(/\/golfcourse\/search\?q=McAllen%2C%20TX&r=30$/.test(posted), posted); await G.search({ lat: 26.2, lon: -98.23 }); ok(/search\?lat=26\.20000&lon=-98\.23000$/.test(posted)); await rejects(G.search({ q: 'a' }), /Type a course/);
  server = () => ({ s: 502, j: { ok: false, error: 'The course map is not answering right now. Try again in a minute.' } }); await rejects(G.search({ q: 'McAllen' }), /not answering/);
  // junk from the server never breaks the page
  eq(G._tidy({ holes: [null, { n: 'x' }, { n: 2, green: { center: { lat: 'a' } }, hazards: 'no', line: [[1], 'x'] }], flags: { map: { red: 'up' } } }).holes, [{ n: 2, mapped: false, hazards: [], line: [] }]);
  console.log('golfgps.test.js: ' + n + ' checks passed');
})().catch((e) => { console.error('FAILED', e); process.exitCode = 1; });
