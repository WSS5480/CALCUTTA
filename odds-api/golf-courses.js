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
function normList(j, cap) { const a = Array.isArray(j) ? j : (j && (j.courses || j.results || j.data)) || []; return a.slice(0, cap || 30).map((c) => ({ extId: t(c.id ?? c.course_id, 40), name: t(c.course_name || c.name, 60), city: t(c.city, 40), state: t(c.state, 20), holes: n0(c.holes_count ?? (typeof c.holes === 'number' ? c.holes : null)), par: n0(c.par_total ?? c.par), lat: n0(c.latitude ?? c.lat), lng: n0(c.longitude ?? c.lng), mi: n0(c.distance_mi) })).filter((c) => c.extId && c.name); }
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
// VERIFIED LIVE from Render, Nov 16 2026 (preview coursecheck): no key needed. /v1/courses/search takes q (matches the COURSE NAME only, not the city),
// state, lat + lng + radius_mi, limit (default 25) and offset, and answers {courses, total}. /v1/courses/<id> has name, city, state, par and
// scorecard [{hole, par}] only; /v1/courses/<id>/tees has {tees: [{tee_key, tee_name, tee_color, gender, course_rating, slope, par, yardage}]};
// /v1/courses/<id>/holes has {holes: [{number, par, handicap_index, yardages: {<tee color>: yards}}]}. So one course = those three answers together.
const PAGE = 25;
const CITIES = { mcallen: [26.2034, -98.23], edinburg: [26.3017, -98.1633], mission: [26.2159, -98.3253], pharr: [26.1948, -98.1836], weslaco: [26.1595, -97.9908], harlingen: [26.1906, -97.6961], brownsville: [25.9017, -97.4975], 'san juan': [26.1892, -98.1553], alamo: [26.1837, -98.123], donna: [26.1704, -98.0519], mercedes: [26.1498, -97.9136], 'san benito': [26.1326, -97.6311], 'rio grande city': [26.3798, -98.8203], 'south padre island': [26.1118, -97.1681], 'rio grande valley': [26.2034, -98.23], rgv: [26.2034, -98.23],
  houston: [29.7604, -95.3698], 'san antonio': [29.4241, -98.4936], dallas: [32.7767, -96.797], austin: [30.2672, -97.7431], 'fort worth': [32.7555, -97.3308], 'corpus christi': [27.8006, -97.3964], laredo: [27.5306, -99.4803], 'el paso': [31.7619, -106.485] };
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const pub = (c) => ({ extId: c.extId, name: c.name, city: c.city, state: c.state, holes: c.holes, par: c.par, mi: c.mi == null ? undefined : Math.round(c.mi * 10) / 10 });
// One page of results: { results, total, next (offset of the next page, or null), near (the place the "nearby" rows are around, or null) }.
async function searchPage(q, state, near, offset) {
  const st = state && /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : '', off = Math.max(0, Math.round(Number(offset) || 0)), qq = String(q || '').trim().slice(0, 60);
  const page = async (path, p) => { p.set('limit', String(PAGE)); if (off) p.set('offset', String(off)); const j = await get(path + '?' + p.toString()), rows = normList(j, PAGE), total = n0(j && j.total); return { rows, total: total == null ? off + rows.length : total }; };
  const out = (x, nearName, extra) => { const rows = x.rows.concat(extra || []), seen = new Set(), list = rows.filter((c) => (seen.has(c.extId) ? false : (seen.add(c.extId), true))); return { results: list.map(pub), total: Math.max(x.total, off + x.rows.length) + (extra ? extra.filter((c) => !x.rows.some((y) => y.extId === c.extId)).length : 0), next: off + x.rows.length < x.total ? off + x.rows.length : null, near: nearName || null }; };
  if (near && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(near)) { const [la, ln] = near.split(','); const p = new URLSearchParams(); p.set('lat', la); p.set('lng', ln); p.set('radius_mi', '25'); return out(await page('/courses/search', p)); }
  if (!qq && st) return out(await page('/courses/state/' + st, new URLSearchParams()));
  const p = new URLSearchParams(); if (qq) p.set('q', qq); if (st) p.set('state', st); const x = await page('/courses/search', p);
  // The directory matches course NAMES only. People type a city ("McAllen"), so on the first page also list the courses AROUND that place:
  // a known city, else the first hit when its own city is what was typed. Never fails the search: the name matches are returned on any error here.
  if (!off && qq && x.total <= PAGE) { try { const k = norm(qq), hit = x.rows.find((c) => norm(c.city) === k && c.lat != null && c.lng != null), at = CITIES[k] || (hit ? [hit.lat, hit.lng] : null);
    if (at) { const r = new URLSearchParams(); r.set('lat', String(at[0])); r.set('lng', String(at[1])); r.set('radius_mi', '25'); r.set('limit', '40'); const nearRows = normList(await get('/courses/search?' + r.toString()), 40).sort((a, b) => (a.mi == null ? 1e9 : a.mi) - (b.mi == null ? 1e9 : b.mi)); if (nearRows.length) return out(x, CITIES[k] ? qq : hit.city, nearRows); } } catch (e) { /* keep the name matches */ } }
  return out(x);
}
async function search(q, state, near, offset) { return (await searchPage(q, state, near, offset)).results; }
async function detail(extId) {
  if (/^fb-[\w-]{1,36}$/.test(String(extId || ''))) { const f = fallbackAll().find((c) => c.extId === extId); if (!f) throw new Error('not found'); return f; } // a bundled sample course
  if (!/^[\w-]{1,40}$/.test(String(extId || ''))) throw new Error('bad id'); const id = encodeURIComponent(extId); const j = await get('/courses/' + id);
  let hj = null, tj = null; try { hj = await get('/courses/' + id + '/holes'); } catch (e) {} try { tj = await get('/courses/' + id + '/tees'); } catch (e) {}
  const base = (j && (j.course || j.data)) || j || {}, tl = Array.isArray(tj) ? tj : (tj && (tj.tees || tj.data)) || [], hl = hj && (Array.isArray(hj) ? hj : hj.holes || hj.data);
  // holes: the /holes answer (par, stroke index, yards per tee colour) wins over the bare scorecard of the course answer
  const merged = Object.assign({}, base, tl.length ? { tees: tl } : {}, Array.isArray(hl) && hl.length ? { holes_data: hl, scorecard: undefined, holes: undefined } : {});
  return normCourse(merged, hj);
}
// ---------- bundled sample courses (fallback) ----------
// Used ONLY when the live course list cannot be reached, so a search never comes back empty. Real courses, saved from OpenGolfAPI answers
// (fixtures/courses-fallback.json; ODbL, same attribution). Callers must label them: "Sample courses saved in the app".
let FB = null;
function fallbackAll() { if (FB) return FB; try { FB = (require('./fixtures/courses-fallback.json').courses || []).map((c) => Object.assign({}, c, { attribution: ATTR, sample: true })); } catch (e) { FB = []; } return FB; }
function fallbackSearch(q, state) { const k = norm(q), st = String(state || '').toUpperCase(), all = fallbackAll(), area = CITIES[k] ? all.filter((c) => c.area && norm(c.area) === (k === 'rgv' ? 'rio grande valley' : k)) : [];
  const hit = all.filter((c) => (!st || c.state === st) && (!k || norm(c.name + ' ' + c.city + ' ' + (c.area || '')).includes(k))), seen = new Set();
  let list = hit.concat(area).filter((c) => (seen.has(c.extId) ? false : (seen.add(c.extId), true))); if (!list.length) list = all.filter((c) => !st || c.state === st);
  return list.slice(0, 40).map((c) => ({ extId: c.extId, name: c.name, city: c.city, state: c.state, holes: 18, par: (c.tees[0] && c.tees[0].par) || null, sample: true })); }
const DOWN_TEXT = "Couldn't reach the course list. Try again.";
const SAMPLE_TEXT = 'Sample courses saved in the app (the live course list could not be reached).';
// What every caller should answer for a search: the live page, or (API down) the labelled sample list. Never throws.
async function searchSafe(q, state, near, offset) {
  try { const r = await searchPage(q, state, near, offset); return { ok: true, results: r.results, total: r.total, next: r.next, near: r.near, attribution: ATTR }; }
  catch (e) { const fb = Number(offset) > 0 ? [] : fallbackSearch(q, state); return { ok: false, down: true, error: DOWN_TEXT, results: fb, fallback: fb.length ? SAMPLE_TEXT : '', total: fb.length, next: null, near: null, attribution: fb.length ? ATTR : '' }; }
}
module.exports = { search, searchPage, searchSafe, fallbackSearch, fallbackAll, DOWN_TEXT, SAMPLE_TEXT, detail, normList, normCourse, ATTR, _deps: D, _reset: () => { C.clear(); down = 0; } };
