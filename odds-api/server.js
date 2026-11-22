// Tiny proxy: holds the Odds API key (env ODDS_API_KEY), returns Super Bowl odds by team abbreviation.
// Cached in memory so the free plan's monthly credits last (default 6 hours).
const http = require('http');
// Calcutta (calc-live): loaded on the first /calcutta call; this week's PGA Tour event is plugged in as its 'golf' source then (calcutta-pga.js).
// A failure to plug golf in leaves golf "coming soon" and everything else working.
let CALC = null; const calcMod = () => { if (CALC) return CALC; CALC = require('./calcutta'); try { require('./calcutta-pga').register(CALC); } catch (e) { console.error('calcutta golf source:', e && e.message); } return CALC; };

// Accept the key under any spelling of ODDS_API / ODDS_API_KEY (env names are case-sensitive on Linux)
const KEYNAME = Object.keys(process.env).find((k) => /^odds_?api(_?key)?$/i.test(k));
const KEY = KEYNAME ? process.env[KEYNAME].trim() : '';
const TTL = (+process.env.CACHE_MINUTES || 1440) * 60 * 1000;
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
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) { if (cache) cache.at = Date.now() - ttl + 15 * 60 * 1000; throw new Error('upstream HTTP ' + r.status); }
  const remaining = r.headers.get('x-requests-remaining');
  const p = parse(await r.json());
  if (!p) throw new Error('no bookmaker listed all 32 teams');
  cache = { at: Date.now(), updated: new Date().toISOString(), remaining: remaining === null ? null : +remaining, ...p };
  return cache;
}

// ---- Spread tick: log every game's line each 20 minutes while this service is awake ----
const { logLines } = require('../scripts/log-lines.js');
const LINES = {};
async function tickLines() { try { const n = await logLines(LINES); if (n) console.log('lines: +' + n); } catch (e) { console.error('lines tick failed:', e.message); } }
setInterval(tickLines, 20 * 60 * 1000);
tickLines();
// Price log (Kalshi + books + ESPN line, every 20 min) for measuring book-vs-Kalshi gaps after the season
const PL = require('./pricelog.js'); const plTick = () => PL.tick(LINES, require('./games')).catch((e) => console.error('pricelog:', e.message));
setInterval(plTick, 20 * 60 * 1000); setTimeout(plTick, 90 * 1000);
// Groups (Phase 1, dark): light tick so the server re-reads running contests' group bets and their pregame prices before kickoff (groups.js spaces it: every
// 5 min in game windows, else every 30). Does NOTHING unless GROUPS_ENABLED=1 (checked here and again inside tick()). Needs Supabase.
if (process.env.SUPABASE_URL) { setInterval(() => { if (process.env.GROUPS_ENABLED !== '1') return; try { require('./groups').tick().catch((e) => console.error('groups tick:', e && e.message)); } catch (e) { console.error('groups tick:', e && e.message); } }, 5 * 60 * 1000); }
// Free Render services sleep when idle; ping our own public URL so the tick keeps running (set KEEP_AWAKE=0 to turn off)
if (process.env.RENDER_EXTERNAL_URL && process.env.KEEP_AWAKE !== '0') {
  setInterval(() => fetch(process.env.RENDER_EXTERNAL_URL + '/health').catch(() => {}), 10 * 60 * 1000);
}

try { require('./betwatch').start(); } catch (e) { console.error('betpush:', e && e.message); } // v266 score watcher for the phone alerts: sets no timer and makes no call unless BETPUSH_ENABLED=1
const kalshi = require('../kalshi-sync/server.js'); const BT = {};
process.on('uncaughtException', (e) => console.error('uncaught:', e && e.message)); process.on('unhandledRejection', (e) => console.error('unhandled:', e && e.message));
http.createServer(async (req, res) => {
  // CORS preflight for every route (the sign-in/sign-up calls send JSON + an x-token header, so the browser asks first; without this answer they fail with "Failed to fetch")
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-token,x-dash', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Max-Age': '86400' }); return res.end(); }
  if (/^\/acct\/(broadcast|announce)(\?|$)/.test(req.url)) { try { if (await require('./announce').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"announce"}'); } } // v267: owner broadcast + targeted announcements (announce.js)
  if (/^\/acct\/(link|ref|recover)(\/|\?|$)/.test(req.url)) { try { if (await require('./recover').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"recover"}'); } } // v271: email + password on an account, lost password / lost PIN, share code (recover.js)
  if (req.url.startsWith('/acct')) { try { if (await require('./acct.js').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"acct"}'); } }
  if (req.url.startsWith('/pricelog')) { try { if (await PL.handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"pricelog"}'); } }
  if (req.url.startsWith('/cfbd')) { try { if (await require('./cfbd.js').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"cfbd"}'); } }
  if (req.url.startsWith('/oddsline')) { try { if (await require('./oddslines.js').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"oddsline"}'); } }
  if (req.url.startsWith('/ai')) { try { if (await require('./ai.js').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"ai"}'); } }
  if (req.url.startsWith('/sync')) { try { if (await require('./sync.js').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"sync"}'); } }
  if (req.url.startsWith('/kalshi')) { try { if (await kalshi.handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"kalshi"}'); } }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/health')) return res.end('{"ok":true}');
  if (req.url.startsWith('/backtest')) { try { const q = new URL(req.url, 'http://x').searchParams; const lg = ['nba','nhl','ncaab','mlb'].includes(q.get('lg')) ? q.get('lg') : 'nba'; const key = [lg, Math.min(+q.get('days') || 45, 200), Math.min(+q.get('bt') || 14, 60), String(q.get('to') || '').slice(0, 12)].join('|'); const ks = Object.keys(BT); if (ks.length > 30) delete BT[ks[0]]; BT[key] = BT[key] && Date.now() - BT[key].t < 3600e3 ? BT[key] : { t: Date.now(), v: await require('./backtest.js').run(lg, Math.min(+q.get('days') || 45, 200), Math.min(+q.get('bt') || 14, 60), q.get('to') || '') }; return res.end(JSON.stringify(BT[key].v, null, 1)); } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end(JSON.stringify({ error: e.message })); } }
  if (req.url.startsWith('/alert')) { try { if (await require('./alert').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"alert error"}'); } }
  if (req.url.startsWith('/propideas')) { try { if (await require('./propideas').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"prop ideas error"}'); } }
  if (/^\/teams(\?|$)/.test(req.url)) { try { if (await require('./teamlist').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"teams"}'); } } // v300: team lists for the ⭐ My teams picker (teamlist.js)
  if (req.url.startsWith('/appcfg')) { try { if (await require('./appcfg').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"appcfg error"}'); } }
  if (req.url.startsWith('/betpush')) { try { if (await require('./betwatch').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"alerts error"}'); } } // v266 phone alerts for a player's bets: OFF unless BETPUSH_ENABLED=1
  if (req.url.startsWith('/courts')) { try { if (await require('./courts').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"court search error"}'); } }
  if (req.url.startsWith('/golfcourse')) { try { if (await require('./golfcourse').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"golf course error"}'); } } // v264 Golf GPS: /golfcourse/search, /holes, /mark, /flagreport
  // Groups (Phase 1, dark): every /groups/* answer is decided by the switches at the top of groups.js handle() (GROUPS_ENABLED, GROUPS_OWNER_ONLY, GROUPS_TESTERS).
  // If groups.js itself cannot load while Groups is off, the bet-status question still gets the safe "not in a group" answer (a failing status call must never block a bet).
  if (req.url.startsWith('/groups')) { try { if (await require('./groups').handle(req, res)) return; } catch (e) { console.error('groups:', e && e.message); res.setHeader('Access-Control-Allow-Origin', '*'); if (process.env.GROUPS_ENABLED !== '1' && req.url.split('?')[0] === '/groups/bet/status') return res.end('{"betLock":0,"canBet":false,"saved":false}'); res.statusCode = 500; return res.end('{"error":"groups error"}'); } }
  // v273 Golf days (a group game): behind the SAME switches as /groups (golfday.js asks groups.js onFor). Off = 403 {off:true}, nothing read.
  if (req.url.startsWith('/golfday')) { try { if (await require('./golfday').handle(req, res)) return; } catch (e) { console.error('golfday:', e && e.message); res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"golf day error"}'); } }
  // Pickleball as a group game (branch pb-group): the preview's local-events engine as odds-api/local.js, behind the SAME switches (local.js handle() asks groups.js onFor). Off = 403 {off:true}, nothing read.
  if (req.url === '/local' || req.url.startsWith('/local/') || req.url.startsWith('/local?')) { try { if (await require('./local').handle(req, res)) return; } catch (e) { console.error('local:', e && e.message); res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"pickleball error"}'); } }
  // Calcutta auction as a group game (calc-live): behind the SAME switches as /groups (calcutta.js asks groups.js onFor). Off = 403 {off:true}, nothing read.
  if (req.url.startsWith('/calcutta')) { try { if (await calcMod().handle(req, res)) return; } catch (e) { console.error('calcutta:', e && e.message); res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"calcutta error"}'); } }
  if (req.url.startsWith('/locks')) { try { if (await require('./locks').handle(req, res)) return; } catch (e) { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 500; return res.end('{"error":"lock error"}'); } }
  if (req.url.startsWith('/games')) { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'public, max-age=120'); try { const g = await require('./games').get('nfl', NAMES); return res.end(JSON.stringify({ updated: g.updated, remaining: g.remaining, games: g.games })); } catch (e) { res.statusCode = 502; return res.end(JSON.stringify({ error: e.message })); } }
  if (req.url.startsWith('/lines')) { res.setHeader('Cache-Control', 'public, max-age=60'); return res.end(JSON.stringify(LINES)); }
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
}).listen(process.env.PORT || 10000, () => { console.log('odds proxy up'); try { require('./cfbd.js').bootParlay(); } catch (e) {} try { require('./cfbd.js').bootEdge(); } catch (e) {} });
