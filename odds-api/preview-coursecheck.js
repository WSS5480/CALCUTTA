// TEST PREVIEW ONLY: at start, ask OpenGolfAPI (free, no key) a few questions from this server and write what came back to the log, one line each
// ("coursecheck: ..."). The build sandbox cannot reach api.opengolfapi.org and the free Render plan keeps no request log, so this is how the real
// paths and field names get verified. Also answered at GET /preview/coursecheck.
const OUT = [];
const say = (s) => { const line = 'coursecheck: ' + s; OUT.push(line); console.log(line.slice(0, 1800)); };
async function ask(url) {
  const h = { 'user-agent': 'oddable-golf/1', accept: 'application/json' }; if (process.env.OPENGOLFAPI_KEY) h.authorization = 'Bearer ' + String(process.env.OPENGOLFAPI_KEY).trim();
  try { const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(12000) }), txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {} return { s: r.status, j, txt, ct: r.headers.get('content-type') }; } catch (e) { return { s: 0, err: String(e && (e.cause && e.cause.code || e.message)) }; }
}
const shape = (j) => { if (Array.isArray(j)) return 'array[' + j.length + ']'; if (j && typeof j === 'object') return '{' + Object.keys(j).slice(0, 25).map((k) => k + (Array.isArray(j[k]) ? '[' + j[k].length + ']' : '')).join(',') + '}'; return typeof j; };
const first = (j) => { const a = Array.isArray(j) ? j : j && (j.courses || j.results || j.data || j.items); return Array.isArray(a) && a.length ? a[0] : null; };
async function run() {
  OUT.length = 0; say('start, key ' + (process.env.OPENGOLFAPI_KEY ? 'set' : 'not set'));
  const B = 'https://api.opengolfapi.org';
  let r = await ask(B + '/openapi.json'); say('openapi.json -> ' + r.s + (r.err ? ' ' + r.err : '') + (r.j && r.j.paths ? ' paths: ' + Object.keys(r.j.paths).join(' ') : ' ' + String(r.txt || '').slice(0, 200)));
  if (r.j && r.j.servers) say('servers: ' + JSON.stringify(r.j.servers).slice(0, 300));
  let id = null, base = null;
  for (const p of ['/v1/courses/search?q=mcallen&limit=5', '/api/v1/courses/search?q=mcallen&limit=5', '/v1/courses/search?q=McAllen&state=TX&limit=5', '/v1/courses?q=mcallen&limit=5', '/v1/courses/state/TX', '/api/v1/courses/state/TX', '/v1/courses/search?lat=26.2034&lng=-98.2300&radius_mi=25&limit=5']) {
    r = await ask(B + p); const f = first(r.j); say(p + ' -> ' + r.s + (r.err ? ' ' + r.err : '') + ' ' + (r.j ? shape(r.j) : String(r.txt || '').slice(0, 160)) + (f ? ' first: ' + JSON.stringify(f).slice(0, 500) : ''));
    if (f && id == null && (f.id != null || f.course_id != null)) { id = f.id != null ? f.id : f.course_id; base = p.startsWith('/api') ? '/api/v1' : '/v1'; }
  }
  if (id != null) for (const p of ['/courses/' + id, '/courses/' + id + '/holes', '/courses/' + id + '/tees', '/courses/' + id + '/scorecard']) { r = await ask(B + base + p); say(base + p + ' -> ' + r.s + ' ' + (r.j ? shape(r.j) + ' ' + JSON.stringify(r.j).slice(0, 1300) : String(r.txt || r.err || '').slice(0, 160))); }
  else say('no course id found: detail not checked');
  try { const CO = require('./golf-courses'); CO._reset(); const L = await CO.search('mcallen', '', ''); say('golf-courses.search("mcallen") -> ' + L.length + ' ' + JSON.stringify(L.slice(0, 2))); if (L[0]) { const d = await CO.detail(L[0].extId); say('golf-courses.detail -> tees ' + d.tees.length + ' ' + JSON.stringify(d).slice(0, 900)); } } catch (e) { say('golf-courses.search threw: ' + e.message); }
  // (The one-off dump that produced fixtures/courses-fallback.json was removed: it asked the directory about 50 questions at every start.)
  say('end'); return OUT.slice();
}
module.exports = { run, last: () => OUT.slice() };
