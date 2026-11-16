// Oddable Golf: course search through OpenGolfAPI (free, community data, ODbL). Called from the SERVER only, cached 24 h.
// PATHS (Nov 16 2026; the sandbox cannot reach api.opengolfapi.org, so no live call was made):
//   Owner's screenshot + the official npm package @opengolfapi/client 0.1.0 (dist/index.js FREE_PATHS, read from the tarball, not a dependency):
//     GET /v1/courses/search?q=&limit=  |  ?lat=&lng=&radius_mi=&limit=      GET /v1/courses/state/<XX>      GET /v1/courses/<id>      GET /v1/courses/<id>/holes
//   @opengolfapi/mcp-server 3.6.1 uses the same under /api/v1 (plus ?state= on search and /api/v1/courses/<id>/tees): tried second when /v1 answers 404.
// RESPONSE FIELDS: the search/state list is typed in @opengolfapi/client as {courses: [{id, course_name, city, state, lat, lng, par_total, holes_count}]} (VERIFIED from the typings).
//   Course detail is typed only as Record<string, any>: tees / holes field names below are read defensively from several spellings (tee_name|name, course_rating|rating,
//   slope|slope_rating, holes_data|holes|scorecard, number|hole|hole_number, handicap_index|handicap|stroke_index, yardages{tee}|yards|yardage) — NOT VERIFIED live.
// Optional key: env OPENGOLFAPI_KEY (sent as Authorization: Bearer ...); reads work without one.
// If the API is down or unreachable, callers fall back to the saved-course list and manual entry.
'use strict';
const D = { fetch: (...a) => fetch(...a), now: () => Date.now(), key: () => String(process.env.OPENGOLFAPI_KEY || '').trim() };
const BASES = ['https://api.opengolfapi.org/v1', 'https://api.opengolfapi.org/api/v1'];
const TTL = 24 * 3600e3, C = new Map(); let down = 0;
const t = (s, n) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/[<>`\\\u0000-\u001f]/g, '').trim().slice(0, n || 60); // keeps apostrophes (Pete Dye's); consumers escape
const n0 = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const ATTR = 'Course data: OpenGolfAPI contributors (ODbL)';

async function get(path) {
  const hit = C.get(path); if (hit && D.now() - hit.at < TTL) return hit.v;
  if (down && D.now() - down < 5 * 6e4) { if (hit) return hit.v; throw new Error('course API unavailable'); }
  const h = { 'user-agent': 'oddable-golf/1' }; if (D.key()) h.authorization = 'Bearer ' + D.key();
  let last = null, only404 = true;
  for (const b of BASES) { try { const r = await D.fetch(b + path, { headers: h, signal: AbortSignal.timeout(8000) }); if (r.status === 404) { last = new Error('404'); continue; } if (!r.ok) throw new Error('HTTP ' + r.status); const v = await r.json(); C.set(path, { at: D.now(), v }); if (C.size > 500) C.delete(C.keys().next().value); down = 0; return v; } catch (e) { last = e; only404 = false; } }
  if (!only404) down = D.now(); if (hit) return hit.v; throw last || new Error('course API unavailable'); // a plain 404 (no such path/course) does not mark the API down
}
function normList(j) { const a = Array.isArray(j) ? j : (j && (j.courses || j.results || j.data)) || []; return a.slice(0, 30).map((c) => ({ extId: t(c.id ?? c.course_id, 40), name: t(c.course_name || c.name, 60), city: t(c.city, 40), state: t(c.state, 20), holes: n0(c.holes_count ?? (typeof c.holes === 'number' ? c.holes : null)), par: n0(c.par_total ?? c.par) })).filter((c) => c.extId && c.name); }
// One course -> tees, each with its own 18 (or 9) holes: par, stroke index, yards for that tee.
function normCourse(j, extraHoles) {
  const c = (j && (j.course || j.data)) || j || {}, pick = (...a) => a.find((x) => Array.isArray(x) && x.length) || [];
  const hx = extraHoles && (Array.isArray(extraHoles) ? extraHoles : extraHoles.holes || extraHoles.data);
  const src = pick(c.holes_data, c.scorecard, c.holes, c._holes && (c._holes.holes || c._holes), hx);
  const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const holeN = (h) => n0(h.number ?? h.hole ?? h.hole_number), holeI = (h) => n0(h.handicap_index ?? h.handicap ?? h.stroke_index ?? h.si ?? h.hcp);
  const yOf = (h, keys) => { const y = h.yardages || h.yards_by_tee || null; if (y && typeof y === 'object' && !Array.isArray(y)) { for (const k of Object.keys(y)) { if (keys.includes(keyOf(k))) return n0(y[k]); } }
    if (Array.isArray(h.tees)) { const x = h.tees.find((z) => keys.includes(keyOf(z.tee_name || z.name || z.color || z.tee_color))); if (x) return n0(x.yards ?? x.yardage); } return n0(h.yards ?? h.yardage); };
  let teesIn = pick(c.tees, c.tee_sets, c.teeboxes); if (!teesIn.length && src.length) teesIn = [{ tee_name: 'Default' }];
  const tees = teesIn.map((x, i) => {
    const keys = [keyOf(x.tee_color || x.color), keyOf(x.tee_name || x.name), keyOf(String(x.tee_key || '').replace(/-(male|female|men|women)$/i, ''))].filter(Boolean);
    const own = Array.isArray(x.holes) && x.holes.length ? x.holes : null; // some APIs nest holes inside each tee
    const holes = (own || src).map((h) => ({ n: holeN(h), par: n0(h.par), hcp: holeI(h), yards: own ? n0(h.yards ?? h.yardage) : yOf(h, keys) })).filter((h) => h.n && h.n >= 1 && h.n <= 18).sort((a, b) => a.n - b.n);
    return { key: t(x.tee_key || x.id || 'tee-' + (i + 1), 40), name: t(x.tee_name || x.name || x.tee_color || x.color || 'Tee ' + (i + 1), 30), color: t(x.tee_color || x.color, 20), gender: t(x.gender, 10), rating: n0(x.course_rating ?? x.rating), slope: n0(x.slope ?? x.slope_rating), par: n0(x.par ?? x.par_total) ?? (holes.length ? holes.reduce((a, h) => a + (h.par || 0), 0) : null), yards: n0(x.yardage ?? x.yards ?? x.total_yards), holes };
  });
  return { extId: t(c.id ?? c.course_id, 40), name: t(c.course_name || c.name, 60), city: t(c.city, 40), state: t(c.state, 20), tees, attribution: ATTR };
}
async function search(q, state, near) {
  const st = state && /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : '';
  if (st && !q && !near) { // every course in a state: /v1/courses/state/<XX>; fall back to search?state=
    try { return normList(await get('/courses/state/' + st)).slice(0, 30); } catch (e) { /* try the search form */ } }
  const p = new URLSearchParams(); if (q) p.set('q', String(q).slice(0, 60)); if (st) p.set('state', st);
  if (near && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(near)) { const [la, ln] = near.split(','); p.set('lat', la); p.set('lng', ln); p.set('radius_mi', '25'); }
  p.set('limit', '20');
  return normList(await get('/courses/search?' + p.toString()));
}
async function detail(extId) {
  if (!/^[\w-]{1,40}$/.test(String(extId || ''))) throw new Error('bad id'); const id = encodeURIComponent(extId); const j = await get('/courses/' + id); let hj = null, c = normCourse(j);
  if (!c.tees.length || c.tees.every((x) => !x.holes.length)) { try { hj = await get('/courses/' + id + '/holes'); c = normCourse(j, hj); } catch (e) {} }
  if (!c.tees.length || c.tees.every((x) => x.rating == null && x.slope == null)) { try { const tj = await get('/courses/' + id + '/tees'), base = (j && (j.course || j.data)) || j || {}, tl = Array.isArray(tj) ? tj : (tj && (tj.tees || tj.data)) || []; if (tl.length) c = normCourse(Object.assign({}, base, { tees: tl }), hj); } catch (e) {} }
  return c;
}
module.exports = { search, detail, normList, normCourse, ATTR, _deps: D, _reset: () => { C.clear(); down = 0; } };
