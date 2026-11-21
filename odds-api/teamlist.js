// v300: GET /teams?lg=nfl|cfb|nba|ncaab|nhl|mlb -> { ok, lg, teams:[{ id, abbr, name, logo }] } for the ⭐ My teams picker (pics/myteams.js).
// ESPN's team lists do not answer a web page (no CORS), so this server reads them: public data, cached 24 h per league, last good copy kept when
// ESPN fails. College football: FBS only (groups=80); college basketball: Division I (groups=50). NFL abbreviations the app's way (WSH -> WAS ...).
const D = { fetch: (...a) => fetch(...a), now: () => Date.now() };
const P = { nfl: 'football/nfl', cfb: 'football/college-football', nba: 'basketball/nba', ncaab: 'basketball/mens-college-basketball', nhl: 'hockey/nhl', mlb: 'baseball/mlb' };
const Q = { cfb: '&groups=80', ncaab: '&groups=50' };
const FIX = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
const C = {}, DAY = 864e5;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function parse(j, lg) {
  const out = [], seen = new Set();
  (((j && j.sports && j.sports[0] && j.sports[0].leagues && j.sports[0].leagues[0] && j.sports[0].leagues[0].teams) || [])).forEach((x) => {
    const t = x && x.team; if (!t || !/^\d{1,8}$/.test(String(t.id)) || seen.has(String(t.id)) || t.isActive === false) return; seen.add(String(t.id));
    const raw = clean(t.abbreviation, 8); if (!raw) return;
    const logo = (Array.isArray(t.logos) && t.logos[0] && typeof t.logos[0].href === 'string' && /^https:\/\/a\.espncdn\.com\//.test(t.logos[0].href)) ? t.logos[0].href : '';
    out.push({ id: String(t.id), abbr: lg === 'nfl' ? FIX[raw] || raw : raw, name: clean(t.displayName || t.shortDisplayName || raw, 60), logo });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
async function list(lg) {
  const c = C[lg], now = D.now(); if (c && now - c.at < DAY) return c.teams;
  try { const r = await D.fetch('https://site.api.espn.com/apis/site/v2/sports/' + P[lg] + '/teams?limit=1000' + (Q[lg] || ''), { signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error(r.status); const t = parse(await r.json(), lg); if (!t.length) throw new Error('empty'); C[lg] = { at: now, teams: t }; return t; }
  catch (e) { if (c) { c.at = now - DAY + 10 * 60e3; return c.teams; } throw e; } // ESPN down: the old copy, asked again in 10 minutes
}
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', code === 200 ? 'public, max-age=3600' : 'no-store'); res.end(JSON.stringify(o)); };
async function handle(req, res) {
  const u = new URL(req.url, 'http://x'); if (u.pathname !== '/teams') return false;
  if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'GET only' }); return true; }
  const lg = u.searchParams.get('lg'); if (!P[lg]) { send(res, 400, { ok: false, error: 'lg must be one of ' + Object.keys(P).join(', ') }); return true; }
  try { send(res, 200, { ok: true, lg, teams: await list(lg) }); } catch (e) { send(res, 502, { ok: false, error: 'Could not load the teams. Try again.' }); }
  return true;
}
module.exports = { handle, _deps: D, _parse: parse, _cache: C };
