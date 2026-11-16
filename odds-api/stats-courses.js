// Course search for My stats (Post a round, course handicap calculator) — OpenGolfAPI (free community data, ODbL), called from the SERVER only.
// After the golf merge the golf engine's odds-api/golf-courses.js (same API, richer tee parsing) is used; until then this small client does the same calls.
// Paths (from @opengolfapi/client 0.1.0, as documented in golf-courses.js; the sandbox cannot reach api.opengolfapi.org, so NOT verified live):
//   GET /v1/courses/search?q=&state=&limit=   GET /v1/courses/<id>   GET /v1/courses/<id>/holes      (then /api/v1/... when /v1 answers 404)
// Optional env var OPENGOLFAPI_KEY (sent as Authorization: Bearer ...); reads work without one. Attribution shown with every result.
'use strict';
const D = { fetch: (...a) => fetch(...a), now: () => Date.now(), key: () => String(process.env.OPENGOLFAPI_KEY || '').trim(), golf: () => { try { const m = require('./golf-courses'); return m && typeof m.search === 'function' ? m : null; } catch (e) { return null; } } };
const BASES = ['https://api.opengolfapi.org/v1', 'https://api.opengolfapi.org/api/v1'], ATTR = 'Course data: OpenGolfAPI contributors (ODbL)';
const C = new Map(); let down = 0;
const t = (s, n) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/[<>`\\\u0000-\u001f]/g, '').trim().slice(0, n || 60);
const n0 = (v) => { const x = Number(v); return v != null && v !== '' && Number.isFinite(x) ? x : null; };
async function get(path) {
  const hit = C.get(path); if (hit && D.now() - hit.at < 24 * 3600e3) return hit.v;
  if (down && D.now() - down < 5 * 6e4) { if (hit) return hit.v; throw new Error('down'); }
  const h = { 'user-agent': 'oddable-stats/1' }; if (D.key()) h.authorization = 'Bearer ' + D.key(); let last = null;
  for (const b of BASES) { try { const r = await D.fetch(b + path, { headers: h, signal: AbortSignal.timeout(8000) }); if (r.status === 404) { last = new Error('404'); continue; } if (!r.ok) throw new Error('HTTP ' + r.status); const v = await r.json(); C.set(path, { at: D.now(), v }); if (C.size > 300) C.delete(C.keys().next().value); down = 0; return v; } catch (e) { last = e; if (e.message !== '404') down = D.now(); } }
  throw last || new Error('down');
}
const list = (j) => (Array.isArray(j) ? j : (j && (j.courses || j.results || j.data)) || []).slice(0, 20).map((c) => ({ extId: t(c.id != null ? c.id : c.course_id, 40), name: t(c.course_name || c.name, 60), city: t(c.city, 40), state: t(c.state, 20), holes: n0(c.holes_count), par: n0(c.par_total != null ? c.par_total : c.par) })).filter((c) => c.extId && c.name);
function course(j, hj) {
  const c = (j && (j.course || j.data)) || j || {}, arr = (...a) => a.find((x) => Array.isArray(x) && x.length) || [];
  const holes = arr(c.holes_data, c.scorecard, c.holes, hj && (Array.isArray(hj) ? hj : hj.holes || hj.data)).map((h) => ({ n: n0(h.number != null ? h.number : h.hole != null ? h.hole : h.hole_number), par: n0(h.par), hcp: n0(h.handicap_index != null ? h.handicap_index : h.handicap != null ? h.handicap : h.stroke_index) })).filter((h) => h.n >= 1 && h.n <= 18).sort((a, b) => a.n - b.n);
  const tees = arr(c.tees, c.tee_sets).map((x, i) => ({ name: t(x.tee_name || x.name || x.tee_color || x.color || 'Tee ' + (i + 1), 30), rating: n0(x.course_rating != null ? x.course_rating : x.rating), slope: n0(x.slope != null ? x.slope : x.slope_rating), par: n0(x.par != null ? x.par : x.par_total) || (holes.length ? holes.reduce((a, h) => a + (h.par || 0), 0) : null), yards: n0(x.total_yards != null ? x.total_yards : x.yards), holes: Array.isArray(x.holes) && x.holes.length ? x.holes.map((h) => ({ n: n0(h.number || h.hole), par: n0(h.par), hcp: n0(h.handicap || h.stroke_index) })) : holes }));
  return { extId: t(c.id != null ? c.id : c.course_id, 40), name: t(c.course_name || c.name, 60), city: t(c.city, 40), state: t(c.state, 20), tees: tees.length ? tees : holes.length ? [{ name: 'Default', rating: null, slope: null, par: holes.reduce((a, h) => a + (h.par || 0), 0), holes }] : [], attribution: ATTR };
}
async function search(q, state) {
  const G = D.golf(); if (G) return { results: await G.search(q, state), attribution: ATTR };
  const p = new URLSearchParams(); if (q) p.set('q', String(q).slice(0, 60)); if (/^[A-Za-z]{2}$/.test(String(state || ''))) p.set('state', String(state).toUpperCase()); p.set('limit', '20');
  return { results: list(await get('/courses/search?' + p.toString())), attribution: ATTR };
}
async function detail(extId) {
  if (!/^[\w-]{1,40}$/.test(String(extId || ''))) throw new Error('bad id'); const G = D.golf(); if (G) return G.detail(extId);
  const id = encodeURIComponent(extId), j = await get('/courses/' + id); let c = course(j); if (!c.tees.some((x) => x.holes.length)) { try { c = course(j, await get('/courses/' + id + '/holes')); } catch (e) {} } return c;
}
module.exports = { search, detail, ATTR, _deps: D, _reset: () => { C.clear(); down = 0; } };
