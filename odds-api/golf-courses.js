// Oddable Golf: course search through OpenGolfAPI (free, community data, ODbL). Called from the SERVER only, cached 24 h.
// PATHS verified from the source of the official npm package @opengolfapi/mcp-server 3.6.1 (read Nov 16 2026, not a dependency):
//   GET https://api.opengolfapi.org/api/v1/courses/search?q=&state=&lat=&lng=&radius_mi=&limit=   GET /api/v1/courses/<id>   GET /api/v1/courses/<id>/tees
//   (the homepage also shows /v1/...: tried second). No key needed to read; OPENGOLFAPI_KEY is sent as Bearer only if set.
// RESPONSE FIELD NAMES were read from open-source clients of the API, NOT from a live call (sandbox cannot reach it):
//   detail: tees[] {tee_key, tee_name, tee_color, gender, course_rating, slope, par, yardage}; holes_data[] {number, par, handicap_index, yardages:{<tee color/name>: yards}}
// Optional key: env OPENGOLFAPI_KEY (sent as Authorization: Bearer ...); it works without one at a lower daily limit.
// If the API is down or unreachable, callers fall back to the saved-course list and manual entry.
'use strict';
const D = { fetch: (...a) => fetch(...a), now: () => Date.now(), key: () => String(process.env.OPENGOLFAPI_KEY || '').trim() };
const BASES = ['https://api.opengolfapi.org/api/v1', 'https://api.opengolfapi.org/v1'];
const TTL = 24 * 3600e3, C = new Map(); let down = 0;
const t = (s, n) => String(s == null ? '' : s).replace(/[<>&"'`\\\u0000-\u001f]/g, '').trim().slice(0, n || 60);
const n0 = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const ATTR = 'Course data: OpenGolfAPI contributors (ODbL) · © OpenStreetMap contributors (ODbL 1.0) via OpenGolfAPI';

async function get(path) {
  const hit = C.get(path); if (hit && D.now() - hit.at < TTL) return hit.v;
  if (down && D.now() - down < 5 * 6e4) { if (hit) return hit.v; throw new Error('course API unavailable'); }
  const h = { 'user-agent': 'oddable-golf/1' }; if (D.key()) h.authorization = 'Bearer ' + D.key();
  let last = null;
  for (const b of BASES) { try { const r = await D.fetch(b + path, { headers: h, signal: AbortSignal.timeout(8000) }); if (r.status === 404 && b !== BASES[BASES.length - 1]) { last = new Error('404'); continue; } if (!r.ok) throw new Error('HTTP ' + r.status); const v = await r.json(); C.set(path, { at: D.now(), v }); if (C.size > 500) C.delete(C.keys().next().value); down = 0; return v; } catch (e) { last = e; } }
  down = D.now(); if (hit) return hit.v; throw last || new Error('course API unavailable');
}
function normList(j) { const a = Array.isArray(j) ? j : (j && (j.courses || j.results || j.data)) || []; return a.slice(0, 30).map((c) => ({ extId: t(c.id, 40), name: t(c.name, 60), city: t(c.city, 40), state: t(c.state, 20), holes: n0(c.holes), par: n0(c.par) })).filter((c) => c.extId && c.name); }
// One course -> tees, each with its own 18 (or 9) holes: par, stroke index, yards for that tee.
function normCourse(j) {
  const c = (j && (j.course || j.data)) || j || {}, src = Array.isArray(c.holes_data) ? c.holes_data : Array.isArray(c.scorecard) ? c.scorecard : Array.isArray(c.holes) ? c.holes : [];
  const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const tees = (Array.isArray(c.tees) ? c.tees : []).map((x, i) => {
    const color = keyOf(x.tee_color), name = keyOf(x.tee_name), base = keyOf(String(x.tee_key || '').replace(/-(male|female|men|women)$/i, ''));
    const holes = src.map((h) => { const y = h.yardages || {}; let yd = null; for (const k of Object.keys(y)) { const kk = keyOf(k); if (kk && (kk === color || kk === name || kk === base)) { yd = n0(y[k]); break; } } return { n: n0(h.number ?? h.hole), par: n0(h.par), hcp: n0(h.handicap_index ?? h.handicap), yards: yd ?? n0(h.yardage) }; }).filter((h) => h.n).sort((a, b) => a.n - b.n);
    return { key: t(x.tee_key || 'tee-' + (i + 1), 40), name: t(x.tee_name || x.tee_color || 'Tee ' + (i + 1), 30), color: t(x.tee_color, 20), gender: t(x.gender, 10), rating: n0(x.course_rating), slope: n0(x.slope), par: n0(x.par), yards: n0(x.yardage), holes };
  });
  return { extId: t(c.id, 40), name: t(c.name, 60), city: t(c.city, 40), state: t(c.state, 20), tees, attribution: ATTR };
}
async function search(q, state, near) {
  const p = new URLSearchParams(); if (q) p.set('q', String(q).slice(0, 60)); if (state) p.set('state', String(state).slice(0, 4).toUpperCase());
  if (near && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(near)) { const [la, ln] = near.split(','); p.set('lat', la); p.set('lng', ln); p.set('radius_mi', '25'); }
  p.set('limit', '20');
  return normList(await get('/courses/search?' + p.toString()));
}
async function detail(extId) { if (!/^[\w-]{1,40}$/.test(String(extId || ''))) throw new Error('bad id'); const j = await get('/courses/' + encodeURIComponent(extId)); let c = normCourse(j);
  if (!c.tees.length) { try { const tj = await get('/courses/' + encodeURIComponent(extId) + '/tees'); const base = (j && (j.course || j.data)) || j || {}; c = normCourse(Object.assign({}, base, { tees: Array.isArray(tj) ? tj : (tj && (tj.tees || tj.data)) || [] })); } catch (e) {} }
  return c; }
module.exports = { search, detail, normList, normCourse, ATTR, _deps: D, _reset: () => { C.clear(); down = 0; } };
