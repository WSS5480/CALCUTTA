// Game spreads from many books (The Odds API), so the app can show a consensus line and every book's number.
// Costs 1 credit per refresh (one market, one region). Cached GAMES_TTL_MIN minutes (default 120); below LOW credits it refreshes once a day.
// Line convention matches the app: positive = HOME team favored by that many points.
const KEY_ = () => { const n = Object.keys(process.env).find((k) => /^odds_?api(_?key)?$/i.test(k)); return n ? process.env[n].trim() : ''; };
const TTL = () => (+process.env.GAMES_TTL_MIN || 120) * 60 * 1000, LOW = +process.env.LOW_CREDITS || 40;
const SPORT = { nfl: 'americanfootball_nfl' };
const C = {}, INF = {}, FAIL = {}; let NAMES = {};
const med = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (x) => Math.round(x * 2) / 2; // consensus on the half-point, like a posted line
function shape(json) {
  const games = [];
  (json || []).forEach((ev) => {
    const home = NAMES[ev.home_team], away = NAMES[ev.away_team]; if (!home || !away) return;
    const books = [];
    (ev.bookmakers || []).forEach((b) => { const m = (b.markets || []).find((x) => x.key === 'spreads'); const o = m && (m.outcomes || []).find((x) => x.name === ev.home_team); if (o && Number.isFinite(o.point)) books.push({ k: b.key, t: b.title, l: -o.point, p: Number.isFinite(o.price) ? o.price : null }); });
    if (!books.length) return;
    const ls = books.map((b) => b.l);
    games.push({ home, away, start: ev.commence_time, line: round(med(ls)), n: books.length, hi: Math.max(...ls), lo: Math.min(...ls), books: books.sort((a, b) => b.l - a.l) });
  });
  return games;
}
// One upstream call at a time per league (concurrent requests share it), and after a failure with nothing cached wait 2 minutes before spending another credit.
function get(lg, names) {
  const c = C[lg], ttl = c && c.remaining !== null && c.remaining < LOW ? 864e5 : TTL(); NAMES = names || NAMES;
  if (c && Date.now() - c.at < ttl) return Promise.resolve(c);
  if (!c && FAIL[lg] && Date.now() - FAIL[lg].at < 12e4) return Promise.reject(FAIL[lg].err);
  if (!INF[lg]) INF[lg] = pull(lg, names).catch((e) => { if (!C[lg]) FAIL[lg] = { at: Date.now(), err: e }; throw e; }).finally(() => { delete INF[lg]; });
  return INF[lg];
}
async function pull(lg, names) {
  NAMES = names || NAMES; const sp = SPORT[lg]; if (!sp) throw new Error('unsupported league');
  const c = C[lg], ttl = c && c.remaining !== null && c.remaining < LOW ? 864e5 : TTL();
  if (c && Date.now() - c.at < ttl) return c;
  const key = KEY_(); if (!key) throw new Error('ODDS_API_KEY is not set');
  const r = await fetch('https://api.the-odds-api.com/v4/sports/' + sp + '/odds/?regions=us&markets=spreads&oddsFormat=american&apiKey=' + key, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) { if (c) c.at = Date.now() - ttl + 5 * 60 * 1000; throw new Error('upstream HTTP ' + r.status); }
  const rem = r.headers.get('x-requests-remaining');
  return (C[lg] = { at: Date.now(), updated: new Date().toISOString(), remaining: rem === null ? null : +rem, games: shape(await r.json()) });
}
module.exports = { get, shape };
