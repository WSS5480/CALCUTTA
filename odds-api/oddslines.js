// Real moneylines + spreads from The Odds API, budgeted to stay under the free plan (500 credits/month).
// Each call = 2 credits (h2h + spreads, 1 region). Lazy: only fetched when the app asks, cached per league, capped per day,
// and refused entirely when the account's remaining credits fall below a floor. Falls back to stale data / nothing (app then estimates).
const SPORTS = { nfl: 'americanfootball_nfl', cfb: 'americanfootball_ncaaf', nba: 'basketball_nba', nhl: 'icehockey_nhl', mlb: 'baseball_mlb', ncaab: 'basketball_ncaab' };
const KEYNAME = Object.keys(process.env).find((k) => /^odds_?api(_?key)?$/i.test(k));
const KEY = () => (KEYNAME ? process.env[KEYNAME].trim() : '');
const TTL = (+process.env.LINES_TTL_MIN || 300) * 60e3;            // 5 h per league
const IDLE_TTL = 24 * 60 * 60e3;                                    // no games within 2 days -> once a day
const DAILY = +process.env.LINES_DAILY_CREDITS || 12;               // 6 calls a day ~ 360/month
const FLOOR = +process.env.LINES_FLOOR || 60;                       // never spend below this many remaining credits
const CACHE = {}; let day = '', spent = 0, remaining = null;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
function pick(books, mkt) { const pref = ['draftkings', 'fanduel', 'betmgm', 'caesars']; const b = pref.map((k) => books.find((x) => x.key === k && (x.markets || []).some((m) => m.key === mkt))).find(Boolean) || books.find((x) => (x.markets || []).some((m) => m.key === mkt)); return b; }
function shape(ev) {
  const books = ev.bookmakers || [], out = { home: ev.home_team, away: ev.away_team, start: +new Date(ev.commence_time) };
  const bm = pick(books, 'h2h'); if (bm) { const m = bm.markets.find((x) => x.key === 'h2h'), h = m.outcomes.find((o) => o.name === ev.home_team), a = m.outcomes.find((o) => o.name === ev.away_team); if (h && a) { out.mlH = h.price; out.mlA = a.price; out.mlBook = bm.key; } }
  let bh = null, ba = null; books.forEach((b) => { const m = (b.markets || []).find((x) => x.key === 'h2h'); if (!m) return; m.outcomes.forEach((o) => { if (o.name === ev.home_team && (!bh || o.price > bh.p)) bh = { p: o.price, b: b.key }; if (o.name === ev.away_team && (!ba || o.price > ba.p)) ba = { p: o.price, b: b.key }; }); });
  if (bh) out.bestH = bh; if (ba) out.bestA = ba;
  const sb = pick(books, 'spreads'); if (sb) { const m = sb.markets.find((x) => x.key === 'spreads'), h = m.outcomes.find((o) => o.name === ev.home_team); if (h && h.point != null) { out.spH = h.point; out.spPrice = h.price; out.spBook = sb.key; } }
  return out;
}
async function get(lg) {
  const sport = SPORTS[lg]; if (!sport) return { error: 'unknown league' };
  if (!KEY()) return { error: 'ODDS_API_KEY not set' };
  const t = today(); if (t !== day) { day = t; spent = 0; }
  const c = CACHE[lg], now = Date.now();
  const soon = c && c.games.some((g) => g.start > now - 4 * 3600e3 && g.start < now + 48 * 3600e3);
  const ttl = c ? (soon ? TTL : IDLE_TTL) : 0;
  if (c && now - c.at < ttl) return { ...c, budget: { spentToday: spent, daily: DAILY, remaining } };
  if (spent + 2 > DAILY || (remaining !== null && remaining < FLOOR)) return c ? { ...c, stale: true, budget: { spentToday: spent, daily: DAILY, remaining } } : { games: [], skipped: 'budget', budget: { spentToday: spent, daily: DAILY, remaining } };
  const r = await fetch('https://api.the-odds-api.com/v4/sports/' + sport + '/odds/?regions=us&markets=h2h,spreads&oddsFormat=american&apiKey=' + KEY(), { signal: AbortSignal.timeout(20000) });
  const rem = r.headers.get('x-requests-remaining'); if (rem !== null) remaining = +rem;
  spent += 2;
  if (!r.ok) { if (c) { c.at = now - ttl + 20 * 60e3; return { ...c, stale: true }; } return { games: [], error: 'upstream ' + r.status }; }
  const j = await r.json(); CACHE[lg] = { at: now, updated: new Date().toISOString(), games: (j || []).map(shape) };
  return { ...CACHE[lg], budget: { spentToday: spent, daily: DAILY, remaining } };
}
async function handle(req, res) {
  if (!req.url.startsWith('/oddsline')) return false;
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'public, max-age=300');
  try { const lg = new URL(req.url, 'http://x').searchParams.get('lg') || ''; res.end(JSON.stringify(await get(lg))); } catch (e) { res.statusCode = 200; res.end(JSON.stringify({ games: [], error: e.message })); }
  return true;
}
module.exports = { handle };
