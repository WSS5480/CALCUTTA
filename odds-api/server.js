// Tiny proxy: holds the Odds API key (env ODDS_API_KEY), returns Super Bowl odds by team abbreviation.
// Cached in memory so the free plan's monthly credits last (default 6 hours).
const http = require('http');

// Accept the key under any spelling of ODDS_API / ODDS_API_KEY (env names are case-sensitive on Linux)
const KEYNAME = Object.keys(process.env).find((k) => /^odds_?api(_?key)?$/i.test(k));
const KEY = KEYNAME ? process.env[KEYNAME].trim() : '';
const TTL = (+process.env.CACHE_MINUTES || 360) * 60 * 1000;
const UPSTREAM = process.env.ODDS_UPSTREAM ||
  'https://api.the-odds-api.com/v4/sports/americanfootball_nfl_super_bowl_winner/odds/';

const NAMES = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI', 'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC', 'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB', 'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};

// Pick one bookmaker: DraftKings if it lists all 32 teams, else the first one that does.
function parse(json) {
  const books = [];
  (json || []).forEach((ev) => (ev.bookmakers || []).forEach((b) => {
    const m = (b.markets || []).find((x) => x.key === 'outrights') || (b.markets || [])[0];
    if (!m) return;
    const odds = {};
    (m.outcomes || []).forEach((o) => { const a = NAMES[o.name]; if (a && Number.isFinite(o.price)) odds[a] = o.price; });
    books.push({ key: b.key, odds });
  }));
  const full = books.filter((b) => Object.keys(b.odds).length === 32);
  const pick = full.find((b) => b.key === 'draftkings') || full[0];
  return pick ? { book: pick.key, odds: pick.odds } : null;
}

let cache = null;
const LOW = +process.env.LOW_CREDITS || 40; // below this many credits left, refresh only once a day
async function getOdds() {
  const ttl = cache && cache.remaining !== null && cache.remaining < LOW ? 24 * 60 * 60 * 1000 : TTL;
  if (cache && Date.now() - cache.at < ttl) return cache;
  if (!KEY && !process.env.ODDS_UPSTREAM) throw new Error('ODDS_API_KEY is not set');
  const url = UPSTREAM + '?regions=us&oddsFormat=american' + (KEY ? '&apiKey=' + KEY : '');
  const r = await fetch(url);
  if (!r.ok) { if (cache) cache.at = Date.now() - ttl + 15 * 60 * 1000; throw new Error('upstream HTTP ' + r.status); }
  const remaining = r.headers.get('x-requests-remaining');
  const p = parse(await r.json());
  if (!p) throw new Error('no bookmaker listed all 32 teams');
  cache = { at: Date.now(), updated: new Date().toISOString(), remaining: remaining === null ? null : +remaining, ...p };
  return cache;
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/health')) return res.end('{"ok":true}');
  if (!req.url.startsWith('/odds')) { res.statusCode = 404; return res.end('{"error":"not found"}'); }
  try {
    const c = await getOdds();
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(JSON.stringify({ updated: c.updated, book: c.book, creditsLeft: c.remaining, odds: c.odds }));
  } catch (e) {
    res.statusCode = cache ? 200 : 503;
    if (cache) return res.end(JSON.stringify({ updated: cache.updated, book: cache.book, odds: cache.odds, stale: true }));
    res.end(JSON.stringify({ error: e.message }));
  }
}).listen(process.env.PORT || 10000, () => console.log('odds proxy up'));
