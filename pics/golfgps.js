// 📍 Golf GPS data layer (v264). No DOM code in this file: pics/golfgps.html is the screen, and a later Golf-days build can use this directly.
//   Browser: window.GolfGPS          Node: require('./golfgps.js') returns the same object (scripts/golfgps/golfgps.test.js).
// Course data: the odds server's /golfcourse/* routes (odds-api/golfcourse.js), which read OpenStreetMap. Points are {lat, lon}.
// OWNER'S WORDS for where the pin is: Short (front of the green) / Center / Long (back). Inside the code the three placements are 'front' | 'center' | 'back';
// the server stores what a colour means as 'short' | 'center' | 'long'.
//
// CONTRACT (for the Golf-days coder)
//   Deep link:  golfgps.html?course=<way|relation|node>/<osm id>[&hole=<1..36>]   opens the hole screen for that course.
//   GolfGPS.search({q} | {lat, lon}, miles?)  -> { courses:[{id, name, lat, lon, miles, holes, holesMapped}], center, note?, stale? }   (throws Error(message))
//   GolfGPS.loadCourse(id)                    -> course { id, name, center, holes:[...], holeCount, holesMapped, flags?, pendingFlags?, flagsPending?, note?, offline? }
//                                               (device marks laid over it; the last good copy of up to 3 courses is kept on the phone for when there is no signal)
//   GolfGPS.hole(course, n)                   -> { n, par?, tee?, line?, green?:{center, front?, back?, outline?, marked?, approx?}, hazards:[], mapped }
//   GolfGPS.flagMap(course)                   -> { map:{red,white,blue,yellow -> 'front'|'center'|'back'}, src:'course'|'phone'|'default', locked, canChange, pending, review? }
//   GolfGPS.saveFlagMap(course, map)          -> { where:'course'|'phone', msg }   course = stored on the server and LOCKED for everyone; phone = this device only
//   GolfGPS.reportFlags(course, map, note)    -> { msg }      tell the organizer the course changed its colours (owner alert 'course_change' in My Apps)
//   GolfGPS.reviewFlags(course, 'accept'|'dismiss')
//   GolfGPS.round(courseId)                   -> today's round on this phone { course, day, allDay, sel, holes:{n:sel}, pins:{n:{lat,lon}} }  sel = {color} | {place} | null
//   GolfGPS.setSel / setAllDay / setPin / clearPin, GolfGPS.selFor(round, n), GolfGPS.pin(course, n, round) -> { point, place, color, by, label, noOutline }
//   GolfGPS.distances(from, hole, pinPoint)   -> { pin, front, center, back } in yards (null when unknown)
//   GolfGPS.mark(course, n, 'green'|'tee', point) -> { where:'course'|'phone', msg }
//   GolfGPS.yards(a, b), bearing(a, b), toward(a, b, yd), teeWatch(...), gpsState(...)
// STORAGE on the phone (localStorage, every access in try/catch):
//   ggps-round   today's round (one course, one day: it resets the next day or when another course is opened)
//   ggps-flags   { <course id>: { map, def } }   this phone's own colour meanings + default colour, used only while the course has none stored on the server
//   ggps-marks   { <course id>: { '5:green': {lat, lon} } }   greens / tees marked on this phone when not signed in or with no signal
//   ggps-recent  last 6 courses opened          ggps-c:<id>  last good copy of a course (3 kept)          ggps-wake  '0' = do not keep the screen on
(function (root) {
  'use strict';
  const MEM = {};
  const D = {
    api: 'https://calcutta-odds.onrender.com/golfcourse',
    fetch: (...a) => root.fetch(...a), now: () => Date.now(),
    get: (k) => { try { return root.localStorage ? root.localStorage.getItem(k) : (k in MEM ? MEM[k] : null); } catch (e) { return null; } },
    set: (k, v) => { try { if (root.localStorage) { if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v); } else if (v == null) delete MEM[k]; else MEM[k] = String(v); return true; } catch (e) { return false; } },
    keys: () => { try { if (!root.localStorage) return Object.keys(MEM); const o = []; for (let i = 0; i < root.localStorage.length; i++) o.push(root.localStorage.key(i)); return o; } catch (e) { return []; } }
  };
  const CFG = {
    PIN_IN_YD: 4,        // Short = this far in from the front edge, Long = this far in from the back edge
    TEE_YD: 30, TEE_HOLD_MS: 10000, // "Looks like you're on the 5th tee": within 30 yd of another hole's tee for 10 s
    FAR_MI: 2,           // farther than this from the course: "You're not at the course"
    POOR_M: 15,          // GPS accuracy worse than this is called poor; marking a green by standing on it needs this or better
    PIN_TAP_YD: 45,      // a pin placed by tapping must be within this of the green's centre
    // The ONE place the map pictures come from. To move to Google later: a Maps JavaScript API key (restricted by website) delivered through /appcfg,
    // and this object becomes { kind:'google', key } with the page loading Google's script instead of Leaflet tiles. See HANDOFF v264.
    TILES: { kind: 'xyz', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxNativeZoom: 19, maxZoom: 21, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }
  };
  const COLORS = ['red', 'white', 'blue', 'yellow'], PLACES = ['front', 'center', 'back'];
  const LABEL = { front: 'Short', center: 'Center', back: 'Long' }, CNAME = { red: 'Red', white: 'White', blue: 'Blue', yellow: 'Yellow' };
  const DEFAULT_MAP = { red: 'front', white: 'center', blue: 'back', yellow: 'back' };
  const WIRE = { front: 'short', center: 'center', back: 'long' }, UNWIRE = { short: 'front', center: 'center', long: 'back' };

  // ---------- geometry ----------
  const RAD = Math.PI / 180, EARTH = 6371008.8, YD = 0.9144;
  const okPt = (p) => !!p && typeof p.lat === 'number' && typeof p.lon === 'number' && isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
  const metres = (a, b) => { const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD, h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2; return EARTH * 2 * Math.asin(Math.min(1, Math.sqrt(h))); };
  const yards = (a, b) => (okPt(a) && okPt(b) ? metres(a, b) / YD : null);
  // Compass bearing from a to b in degrees (0 = north, 90 = east).
  const bearing = (a, b) => { const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD), x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD); return (Math.atan2(y, x) / RAD + 360) % 360; };
  // The point `yd` yards from a toward b (never past b).
  function toward(a, b, yd) { const d = yards(a, b); if (!d || d <= 0) return { lat: a.lat, lon: a.lon }; const f = Math.max(0, Math.min(1, yd / d)); return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f }; }
  function inside(p, outline) { // outline = [[lat, lon], ...]
    if (!okPt(p) || !Array.isArray(outline) || outline.length < 3) return false; let c = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) { const a = outline[i], b = outline[j]; if ((a[0] > p.lat) !== (b[0] > p.lat) && p.lon < ((b[1] - a[1]) * (p.lat - a[0])) / (b[0] - a[0]) + a[1]) c = !c; }
    return c;
  }
  const fmtYd = (n) => (n == null || !isFinite(n) ? '–' : n >= 10000 ? (n / 1760).toFixed(1) + ' mi' : Math.round(n).toLocaleString('en-US'));
  const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  // ---------- small storage helpers ----------
  const jget = (k, dflt) => { try { const v = JSON.parse(D.get(k)); return v && typeof v === 'object' ? v : dflt; } catch (e) { return dflt; } };
  const jset = (k, v) => D.set(k, JSON.stringify(v));
  const token = () => D.get('odd-tok') || '';
  const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const ID_RE = /^(way|relation|node)\/[1-9]\d{0,14}$/;

  // ---------- server ----------
  async function call(path, opt) {
    let r; const o = opt || {}, h = {}; const t = token(); if (t) h['x-token'] = t; if (o.body) h['content-type'] = 'application/json';
    try { r = await D.fetch(D.api + path, { method: o.body ? 'POST' : 'GET', headers: h, body: o.body ? JSON.stringify(o.body) : undefined, cache: 'no-store', signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(o.ms || 70000) : undefined }); }
    catch (e) { throw Object.assign(new Error('No answer from the server. Check your signal and try again.'), { offline: true }); }
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok || !j || j.ok === false) throw Object.assign(new Error((j && j.error) || 'The server did not answer properly (' + r.status + ').'), { status: r.status, body: j });
    return j;
  }
  async function search(where, miles) {
    const w = where || {}, r = miles ? '&r=' + encodeURIComponent(miles) : '';
    if (okPt(w)) return call('/search?lat=' + w.lat.toFixed(5) + '&lon=' + w.lon.toFixed(5) + r);
    const q = String(w.q || '').trim(); if (q.length < 2) throw new Error('Type a course name or a city.');
    return call('/search?q=' + encodeURIComponent(q) + r);
  }

  // ---------- marks kept on this phone ----------
  const devMarks = (id) => { const all = jget('ggps-marks', {}), m = all[id]; return m && typeof m === 'object' ? m : {}; };
  // Lays marks ({ '5:green': {lat,lon} }) over a course's holes. Same rule as the server: a mark inside the drawn green only moves its centre.
  function applyMarks(course, marks, tag) {
    Object.keys(marks || {}).forEach((k) => {
      const m = /^([1-9]\d?):(green|tee)$/.exec(k), p = marks[k]; if (!m || !okPt(p)) return; const n = +m[1], pt = { lat: p.lat, lon: p.lon };
      let h = course.holes.find((x) => x.n === n); if (!h) { h = { n, mapped: false, hazards: [] }; course.holes.push(h); course.holes.sort((a, b) => a.n - b.n); }
      if (m[2] === 'tee') { h.tee = pt; h.teeMarked = tag; }
      else if (h.green && h.green.outline && inside(pt, h.green.outline)) { h.green.center = pt; h.green.marked = tag; delete h.green.approx; }
      else { h.green = { center: pt, marked: tag }; h.mapped = false; }
    });
    return course;
  }
  function tidy(j) { // never trust the shape
    const c = { id: String(j.id || ''), name: String(j.name || 'Golf course'), center: okPt(j.center) ? j.center : null, holes: [], holeCount: 18, holesMapped: +j.holesMapped || 0, note: j.note ? String(j.note) : '', stale: !!j.stale };
    (Array.isArray(j.holes) ? j.holes : []).forEach((h) => {
      if (!h || !Number.isInteger(h.n) || h.n < 1 || h.n > 36) return; const o = { n: h.n, mapped: !!h.mapped, hazards: [] };
      if (h.par >= 3 && h.par <= 6) o.par = h.par; if (h.handicap >= 1 && h.handicap <= 18) o.handicap = h.handicap;
      if (okPt(h.tee)) o.tee = h.tee; if (h.teeMarked) o.teeMarked = 'course';
      if (Array.isArray(h.line)) o.line = h.line.filter((p) => Array.isArray(p) && okPt({ lat: p[0], lon: p[1] }));
      if (h.green && okPt(h.green.center)) { const g = { center: h.green.center }; if (okPt(h.green.front) && okPt(h.green.back)) { g.front = h.green.front; g.back = h.green.back; } if (Array.isArray(h.green.outline)) { const ol = h.green.outline.filter((p) => Array.isArray(p) && okPt({ lat: p[0], lon: p[1] })); if (ol.length >= 3) g.outline = ol; } if (h.green.marked) g.marked = 'course'; if (h.green.approx) g.approx = true; o.green = g; }
      (Array.isArray(h.hazards) ? h.hazards : []).slice(0, 12).forEach((z) => { if (z && okPt(z.center)) o.hazards.push({ type: z.type === 'water' ? 'water' : 'bunker', center: z.center, outline: Array.isArray(z.outline) ? z.outline.filter((p) => Array.isArray(p) && okPt({ lat: p[0], lon: p[1] })) : [] }); });
      c.holes.push(o);
    });
    c.holes.sort((a, b) => a.n - b.n);
    c.holeCount = Math.min(36, Math.max(+j.holeCount || 18, c.holes.length ? c.holes[c.holes.length - 1].n : 0));
    setFlags(c, j);
    return c;
  }
  const cleanMap = (m, vals) => { const o = {}; if (!m || typeof m !== 'object') return null; COLORS.forEach((k) => { if (vals.includes(m[k])) o[k] = m[k]; }); return Object.keys(o).length ? o : null; };
  function setFlags(c, j) {
    delete c.flags; delete c.pendingFlags; delete c.flagsPending;
    const m = j && j.flags && cleanMap(j.flags.map, ['short', 'center', 'long']);
    if (m) { c.flags = { map: m, canChange: !!j.flags.canChange, at: +j.flags.at || 0 };
      const p = j.pendingFlags && cleanMap(j.pendingFlags.flags, ['short', 'center', 'long']);
      if (p) c.pendingFlags = { flags: p, note: String(j.pendingFlags.note || '').slice(0, 100), from: String(j.pendingFlags.from || 'A player').slice(0, 40), at: +j.pendingFlags.at || 0 }; else if (j.flagsPending) c.flagsPending = true; }
  }
  const CACHE_N = 3;
  function keep(id, raw) {
    if (!jset('ggps-c:' + id, { at: D.now(), j: raw })) return;
    const ks = D.keys().filter((k) => k && k.indexOf('ggps-c:') === 0).map((k) => ({ k, at: (jget(k, {}).at) || 0 })).sort((a, b) => b.at - a.at);
    ks.slice(CACHE_N).forEach((x) => D.set(x.k, null));
  }
  async function loadCourse(id) {
    if (!ID_RE.test(String(id))) throw new Error('That is not a course this page knows.');
    let raw, offline = false, at = D.now();
    try { raw = await call('/holes?id=' + id); keep(id, raw); }
    catch (e) { const c = jget('ggps-c:' + id, null); if (!c || !c.j || (e.status && e.status < 500)) throw e; raw = c.j; offline = true; at = c.at; }
    const course = applyMarks(tidy(raw), devMarks(id), 'phone'); course.id = id;
    if (offline) { course.offline = true; course.savedAt = at; }
    addRecent(course);
    return course;
  }
  const hole = (course, n) => (course && course.holes.find((h) => h.n === n)) || { n, mapped: false, hazards: [] };
  function recent() { const a = jget('ggps-recent', []); return Array.isArray(a) ? a.filter((c) => c && ID_RE.test(c.id) && typeof c.name === 'string').slice(0, 6) : []; }
  function addRecent(c) { const a = recent().filter((x) => x.id !== c.id); a.unshift({ id: c.id, name: String(c.name).slice(0, 100), holesMapped: c.holesMapped || 0, holes: c.holeCount || c.holes || 18 }); jset('ggps-recent', a.slice(0, 6)); }

  // ---------- what each flag colour means at a course ----------
  const devFlags = (id) => { const all = jget('ggps-flags', {}), f = all[id]; return f && typeof f === 'object' ? f : {}; };
  function flagMap(course) {
    const full = (m) => Object.assign({}, DEFAULT_MAP, m || {});
    if (course && course.flags) { const m = {}; COLORS.forEach((k) => { if (course.flags.map[k]) m[k] = UNWIRE[course.flags.map[k]]; }); const o = { map: full(m), src: 'course', locked: true, canChange: !!course.flags.canChange, pending: !!(course.flagsPending || course.pendingFlags) }; if (course.pendingFlags) { const pm = {}; COLORS.forEach((k) => { if (course.pendingFlags.flags[k]) pm[k] = UNWIRE[course.pendingFlags.flags[k]]; }); o.review = { map: full(pm), note: course.pendingFlags.note, from: course.pendingFlags.from }; } return o; }
    const d = course ? cleanMap(devFlags(course.id).map, PLACES) : null;
    return { map: full(d), src: d ? 'phone' : 'default', locked: false, canChange: true, pending: false };
  }
  const mapText = (map) => COLORS.map((k) => CNAME[k] + ' = ' + LABEL[map[k]]).join(', ');
  const wireMap = (map) => { const o = {}; COLORS.forEach((k) => { if (PLACES.includes(map[k])) o[k] = WIRE[map[k]]; }); return o; };
  function saveDevFlags(id, patch) { const all = jget('ggps-flags', {}); all[id] = Object.assign({}, devFlags(id), patch); return jset('ggps-flags', all); }
  // Saves what the colours mean. Signed in + server reachable = stored for the course and locked for everyone. Otherwise this phone only.
  async function saveFlagMap(course, map) {
    const m = cleanMap(map, PLACES); if (!m || Object.keys(m).length !== 4) throw new Error('Pick Short, Center or Long for each colour.');
    const phone = (why) => { saveDevFlags(course.id, { map: m }); return { where: 'phone', msg: 'Saved on this phone only' + (why ? ' (' + why + ')' : '') + '.' }; };
    if (course.flags && !course.flags.canChange) throw Object.assign(new Error('Ask the organizer to change it'), { locked: true });
    if (!token()) return phone('not signed in');
    try { const j = await call('/mark', { body: { id: course.id, what: 'flags', flags: wireMap(m) }, ms: 20000 }); setFlags(course, { flags: j.flags }); return { where: 'course', msg: 'Saved for this course. Everyone playing here now gets these colours.' }; }
    catch (e) {
      if (e.status === 403) { if (e.body && e.body.flags) setFlags(course, { flags: e.body.flags, flagsPending: course.flagsPending }); throw Object.assign(new Error('Ask the organizer to change it'), { locked: true }); }
      if (e.status === 400 || e.status === 429) throw e;
      return phone(e.offline ? 'no signal' : e.status === 401 ? 'not signed in' : 'the server could not save it');
    }
  }
  async function reportFlags(course, map, note) {
    const m = cleanMap(map, PLACES); if (!m || Object.keys(m).length !== 4) throw new Error('Pick Short, Center or Long for each colour.');
    if (!token()) throw new Error('Sign in to Oddable to report a change.');
    const cur = flagMap(course).map; if (COLORS.every((k) => cur[k] === m[k])) throw new Error('Those are already this course\'s colours.');
    await call('/flagreport', { body: { id: course.id, flags: wireMap(m), note: String(note || '').replace(/\s+/g, ' ').trim().slice(0, 100) }, ms: 20000 });
    course.flagsPending = true; return { msg: 'Sent. The organizer will review it.' };
  }
  async function reviewFlags(course, action) {
    const j = await call('/flagreport', { body: { id: course.id, action }, ms: 20000 });
    if (j.flags) setFlags(course, { flags: j.flags }); else { delete course.pendingFlags; delete course.flagsPending; }
    return { msg: action === 'accept' ? 'Accepted. These are now the course\'s colours.' : 'Dismissed.' };
  }
  const defColor = (id) => { const c = devFlags(id).def; return COLORS.includes(c) ? c : ''; };
  const setDefColor = (id, c) => saveDevFlags(id, { def: COLORS.includes(c) ? c : '' });

  // ---------- today's round on this phone ----------
  const cleanSel = (s) => (s && COLORS.includes(s.color) ? { color: s.color } : s && PLACES.includes(s.place) ? { place: s.place } : null);
  function round(courseId, now) {
    const day = dayOf(now == null ? D.now() : now), r = jget('ggps-round', null);
    if (r && r.course === courseId && r.day === day) { const o = { course: courseId, day, allDay: r.allDay !== false, sel: cleanSel(r.sel), holes: {}, pins: {} }; Object.keys(r.holes || {}).forEach((k) => { if (/^[1-9]\d?$/.test(k)) o.holes[k] = cleanSel(r.holes[k]); }); Object.keys(r.pins || {}).forEach((k) => { if (/^[1-9]\d?$/.test(k) && okPt(r.pins[k])) o.pins[k] = { lat: r.pins[k].lat, lon: r.pins[k].lon }; }); return o; }
    const d = defColor(courseId); // a new day, or another course: start clean, with the course's default colour if the player chose one
    return { course: courseId, day, allDay: true, sel: d ? { color: d } : null, holes: {}, pins: {} };
  }
  const saveRound = (r) => { jset('ggps-round', r); return r; };
  // The choice in force on hole n: the day's colour, unless "same colour all day" is off and this hole has its own.
  const selFor = (r, n) => (!r.allDay && Object.prototype.hasOwnProperty.call(r.holes, n) ? r.holes[n] : r.sel);
  function setSel(r, n, sel) { const s = cleanSel(sel); if (r.allDay) { r.sel = s; r.holes = {}; } else r.holes[n] = s; return saveRound(r); }
  function setAllDay(r, on, n) { r.allDay = !!on; if (on) { const cur = Object.prototype.hasOwnProperty.call(r.holes, n) ? r.holes[n] : r.sel; r.sel = cur; r.holes = {}; } return saveRound(r); }
  function setPin(r, n, p) { if (okPt(p)) r.pins[n] = { lat: p.lat, lon: p.lon }; return saveRound(r); }
  function clearPin(r, n) { delete r.pins[n]; return saveRound(r); }
  // Where a placement sits on a green: Short = PIN_IN_YD in from the front edge toward the centre, Long = the same in from the back edge.
  // On a tiny green the step is never more than half way to the centre.
  function placePoint(green, place) {
    if (!green || !okPt(green.center)) return null;
    if (place === 'center' || !place || !okPt(green.front) || !okPt(green.back)) return { lat: green.center.lat, lon: green.center.lon };
    const edge = place === 'front' ? green.front : green.back, d = yards(edge, green.center);
    return toward(edge, green.center, Math.min(CFG.PIN_IN_YD, d / 2));
  }
  // The pin on hole n for today. by: 'you' (placed by tapping), 'color', 'place', 'center' (nothing chosen). null when the hole has no green at all.
  function pin(course, n, r) {
    const h = hole(course, n), g = h.green, mine = r && r.pins[n];
    if (mine) return { point: mine, by: 'you', place: null, color: null, label: 'Pin placed by you', noOutline: false };
    if (!g || !okPt(g.center)) return null;
    const sel = r ? selFor(r, n) : null, fm = flagMap(course).map, place = sel ? (sel.color ? fm[sel.color] : sel.place) : null, color = sel && sel.color ? sel.color : null;
    const noOutline = !(okPt(g.front) && okPt(g.back));
    const use = noOutline ? 'center' : place || 'center';
    return { point: placePoint(g, use), by: !sel ? 'center' : color ? 'color' : 'place', place: place || null, shown: use, color, noOutline,
      label: noOutline ? 'Center of the green' : !sel ? 'Center (no flag colour chosen)' : color ? CNAME[color] + ' flag = ' + LABEL[place] : 'Pin ' + LABEL[place] };
  }
  function distances(from, h, pinPoint) {
    const g = h && h.green; return { pin: yards(from, pinPoint), front: g ? yards(from, g.front) : null, center: g ? yards(from, g.center) : null, back: g ? yards(from, g.back) : null };
  }

  // ---------- marking a green / tee ----------
  async function mark(course, n, what, point) {
    if (!okPt(point) || (what !== 'green' && what !== 'tee') || !(n >= 1 && n <= 36)) throw new Error('Nothing to mark.');
    if (course.center && metres(course.center, point) > 3000) throw new Error('That point is more than 3 km from this course.');
    const p = { lat: Math.round(point.lat * 1e6) / 1e6, lon: Math.round(point.lon * 1e6) / 1e6 }, m = {}; m[n + ':' + what] = p;
    const phone = (why) => { const all = jget('ggps-marks', {}); all[course.id] = Object.assign({}, devMarks(course.id), m); jset('ggps-marks', all); applyMarks(course, m, 'phone'); return { where: 'phone', msg: 'Saved on this phone only' + (why ? ' (' + why + ')' : '') + '.' }; };
    if (!token()) return phone('not signed in');
    try { await call('/mark', { body: { id: course.id, n, what, point: p }, ms: 20000 }); applyMarks(course, m, 'course'); return { where: 'course', msg: 'Saved for everyone who plays this course.' }; }
    catch (e) { if (e.status === 400 || e.status === 409 || e.status === 429) throw e; return phone(e.offline ? 'no signal' : e.status === 401 ? 'not signed in' : 'the server could not save it'); }
  }

  // ---------- "Looks like you're on the 5th tee" ----------
  // st = { n, since } carried between GPS readings. Returns { st, suggest } where suggest is a hole number only after TEE_HOLD_MS near that tee.
  function teeWatch(st, pos, course, cur, now) {
    let best = 0, bd = CFG.TEE_YD;
    if (okPt(pos) && course) course.holes.forEach((h) => { if (h.n === cur || !okPt(h.tee)) return; const d = yards(pos, h.tee); if (d <= bd) { bd = d; best = h.n; } });
    if (best) { const curTee = hole(course, cur).tee; if (okPt(curTee) && yards(pos, curTee) <= bd) best = 0; } // standing just as close to the tee of the hole already showing: say nothing
    if (!best) return { st: null, suggest: 0 };
    const s = st && st.n === best ? st : { n: best, since: now };
    return { st: s, suggest: now - s.since >= CFG.TEE_HOLD_MS ? best : 0 };
  }

  // ---------- GPS wording ----------
  // fix = { lat, lon, acc (metres) } | null; err = 'denied' | 'unavailable' | 'unsupported' | ''.
  function gpsState(fix, err, course) {
    if (err === 'denied') return { kind: 'denied', text: 'Location is turned off for this page. Allow it in your browser settings, then tap Turn on GPS. Until then, distances are from the tee.' };
    if (err === 'unsupported') return { kind: 'denied', text: 'This phone\'s browser does not share its location. Distances are from the tee.' };
    if (!okPt(fix)) return { kind: 'none', text: err === 'unavailable' ? 'No GPS fix yet. Step outside, away from buildings. Distances are from the tee.' : 'Waiting for GPS… Distances are from the tee until it locks on.' };
    const acc = Math.round((fix.acc || 0) / YD), pm = 'GPS ±' + acc + ' yd';
    if (course && course.center && metres(fix, course.center) / 1609.344 > CFG.FAR_MI) return { kind: 'far', acc, text: 'You\'re not at the course. Distances are from where you are. ' + pm + '.' };
    if ((fix.acc || 0) > CFG.POOR_M) return { kind: 'poor', acc, text: pm + '. Weak GPS: give it a few seconds in the open.' };
    return { kind: 'ok', acc, text: pm };
  }

  const API = { cfg: CFG, COLORS, PLACES, LABEL, CNAME, DEFAULT_MAP, yards, bearing, toward, inside, fmtYd, ord, okPt, search, loadCourse, hole, recent, flagMap, mapText, saveFlagMap, reportFlags, reviewFlags, defColor, setDefColor,
    round, selFor, setSel, setAllDay, setPin, clearPin, placePoint, pin, distances, mark, teeWatch, gpsState, signedIn: () => !!token(), _deps: D, _applyMarks: applyMarks, _tidy: tidy, _reset: () => { Object.keys(MEM).forEach((k) => delete MEM[k]); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.GolfGPS = API;
})(typeof window !== 'undefined' ? window : globalThis);
