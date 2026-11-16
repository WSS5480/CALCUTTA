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
  // Real course data for the bundled sample list (fixtures/courses-fallback.json): one line per tee, read back from the log by the builder.
  try { const CO = require('./golf-courses'), seen = new Set(), want = [];
    const add = (rows, area) => rows.forEach((c) => { if (!seen.has(c.extId)) { seen.add(c.extId); want.push([c, area]); } });
    add((await CO.searchPage('', '', '26.2034,-98.2300', 0)).results, 'Rio Grande Valley'); add((await CO.searchPage('', '', '26.2034,-98.2300', 25)).results, 'Rio Grande Valley'); add((await CO.searchPage('', '', '26.1906,-97.6961', 0)).results, 'Rio Grande Valley'); add((await CO.searchPage('', '', '25.9017,-97.4975', 0)).results, 'Rio Grande Valley');
    for (const nm of ['Pebble Beach Golf Links', 'Bethpage', 'Torrey Pines', 'TPC Sawgrass', 'Pinehurst', 'Memorial Park Golf Course', 'Brackenridge', 'TPC Scottsdale', 'Bandon Dunes', 'Harbour Town']) { try { add((await CO.searchPage(nm, '', '', 0)).results.slice(0, 2), ''); } catch (e) {} }
    say('data: ' + want.length + ' courses found'); let n = 0;
    for (const [c, area] of want.slice(0, 60)) { let d; try { d = await CO.detail(c.extId); } catch (e) { continue; } const tees = d.tees.filter((t) => t.holes.length === 18 && t.rating && t.slope).slice(0, 5); if (!tees.length) { say('data-skip: ' + c.name + ' (' + c.city + ') tees ' + d.tees.length + ' holes ' + (d.tees[0] ? d.tees[0].holes.length : 0)); continue; }
      n++; tees.forEach((t) => console.log('coursedata: ' + [n, d.name, d.city, d.state, area, t.name, t.gender || '', t.rating, t.slope, t.par, t.yards || '', t.holes.map((h) => [h.par || '', h.hcp || '', h.yards || ''].join('.')).join(',')].join('|'))); }
    say('data: ' + n + ' courses written');
  } catch (e) { say('data failed: ' + e.message); }
  say('end'); return OUT.slice();
}
module.exports = { run, last: () => OUT.slice() };
