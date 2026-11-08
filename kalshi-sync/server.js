// Oddable Kalshi sync: read-only. Only ever calls GET endpoints. Keys come from env vars and never leave this server.
const http = require('http'), crypto = require('crypto');
const BASE = (process.env.KALSHI_BASE || 'https://external-api.kalshi.com/trade-api/v2').replace(/\/$/, '');
const KEY_ID = process.env.KALSHI_KEY_ID || '';
const TOKEN = process.env.SYNC_TOKEN || '';
const PEM = (process.env.KALSHI_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const DAYS = +process.env.SYNC_DAYS || 45, EVERY = (+process.env.SYNC_SECONDS || 60) * 1000;
let KEY = null; try { if (PEM) KEY = crypto.createPrivateKey(PEM); } catch (e) { console.log('private key not readable:', e.message); }

function headers(method, path) {
  const ts = String(Date.now()), msg = Buffer.from(ts + method + new URL(BASE + path).pathname);
  const sig = KEY.asymmetricKeyType === 'ed25519' ? crypto.sign(null, msg, KEY)
    : crypto.sign('sha256', msg, { key: KEY, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST });
  return { 'KALSHI-ACCESS-KEY': KEY_ID, 'KALSHI-ACCESS-TIMESTAMP': ts, 'KALSHI-ACCESS-SIGNATURE': sig.toString('base64') };
}
async function get(path, q) {
  const qs = q ? '?' + new URLSearchParams(q) : '';
  const r = await fetch(BASE + path + qs, { headers: headers('GET', path) });
  if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function pages(path, key, q) { let cur = '', out = [], n = 0; do { const j = await get(path, { ...q, limit: '200', ...(cur ? { cursor: cur } : {}) }); out = out.concat(j[key] || []); cur = j.cursor || ''; } while (cur && ++n < 30); return out; }

const num = (...v) => { for (const x of v) if (x !== undefined && x !== null && x !== '' && !isNaN(+x)) return +x; return NaN; };
const cents = (o, a, b) => { const c = num(o[a]); if (!isNaN(c)) return c; const d = num(o[b]); return isNaN(d) ? NaN : d * 100; };
const day = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ_NAME || 'America/Chicago' }).format(new Date(iso));

const MK = {}; async function market(t) { if (MK[t]) return MK[t]; try { MK[t] = (await get('/markets/' + encodeURIComponent(t))).market || {}; } catch (e) { MK[t] = {}; } return MK[t]; }

let CACHE = { bets: [], at: 0, err: null, counts: {} };
async function sync() {
  if (!KEY || !KEY_ID) { CACHE.err = 'KALSHI_KEY_ID or KALSHI_PRIVATE_KEY missing/unreadable'; return; }
  try {
    const min = Math.floor(Date.now() / 1000 - DAYS * 86400);
    const fills = await pages('/portfolio/fills', 'fills', { min_ts: String(min) });
    let setl = []; try { setl = await pages('/portfolio/settlements', 'settlements', { min_ts: String(min) }); } catch (e) { CACHE.setErr = e.message; }
    const S = {}; setl.forEach((s) => { S[s.ticker] = s; });
    const by = {};
    fills.forEach((f) => {
      const side = (f.side || '').toLowerCase(), act = (f.action || 'buy').toLowerCase(); if (act !== 'buy') return; // v1: only opening buys
      const cnt = num(f.count, f.count_fp), yp = cents(f, 'yes_price', 'yes_price_dollars'), np = cents(f, 'no_price', 'no_price_dollars');
      const px = side === 'yes' ? yp : np; if (isNaN(cnt) || isNaN(px)) return;
      const k = f.ticker + '|' + side, b = by[k] = by[k] || { ticker: f.ticker, side, count: 0, cost: 0, first: f.created_time, order: f.order_id };
      b.count += cnt; b.cost += cnt * px / 100; if (f.created_time < b.first) b.first = f.created_time;
    });
    const bets = [];
    for (const b of Object.values(by)) {
      const m = await market(b.ticker), s = S[b.ticker], res = (s && s.market_result) || (m.status === 'settled' || m.status === 'finalized' ? m.result : '');
      const won = res ? res === b.side : null, push = res === 'scalar' || res === 'void';
      const pick = (b.side === 'yes' ? m.yes_sub_title : m.no_sub_title) || (b.side === 'yes' ? 'YES' : 'NO');
      const title = (m.title || b.ticker).replace(/\?$/, '');
      const stake = Math.round(b.cost * 100) / 100, payout = b.count; // $1 per contract
      bets.push({ id: 'k-' + b.ticker + '-' + b.side, src: 'kalshi', ticker: b.ticker, text: `${pick} · ${title}`, side: b.side, contracts: b.count,
        stake, mult: stake ? Math.round(payout / stake * 100) / 100 : null, res: res ? (push ? 'push' : won ? 'won' : 'lost') : null,
        day: day(b.first), t: Date.parse(b.first), close: m.close_time || m.expected_expiration_time || null });
    }
    bets.sort((a, c) => c.t - a.t);
    CACHE = { bets, at: Date.now(), err: null, counts: { fills: fills.length, settlements: setl.length, bets: bets.length } };
    console.log('synced', JSON.stringify(CACHE.counts));
  } catch (e) { CACHE.err = e.message; console.log('sync error', e.message); }
}
sync(); setInterval(sync, EVERY);

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (u.pathname === '/health') { res.writeHead(200, cors); return res.end(JSON.stringify({ ok: true, keyLoaded: !!KEY, keyId: !!KEY_ID, tokenSet: !!TOKEN, at: CACHE.at, err: CACHE.err ? 'see /debug' : null })); }
  if (!TOKEN || u.searchParams.get('token') !== TOKEN) { res.writeHead(401, cors); return res.end(JSON.stringify({ error: 'bad token' })); }
  if (u.pathname === '/bets') { if (Date.now() - CACHE.at > EVERY * 2) await sync(); res.writeHead(200, cors); return res.end(JSON.stringify({ at: CACHE.at, err: CACHE.err, bets: CACHE.bets })); }
  if (u.pathname === '/debug') { // raw look at what Kalshi returns, so mapping can be tuned. No secrets.
    let out = { err: CACHE.err, setErr: CACHE.setErr, counts: CACHE.counts };
    try { const f = await get('/portfolio/fills', { limit: '3' }); out.sampleFills = f.fills; if (f.fills && f.fills[0]) out.sampleMarket = (await get('/markets/' + encodeURIComponent(f.fills[0].ticker))).market; } catch (e) { out.fetchErr = e.message; }
    res.writeHead(200, cors); return res.end(JSON.stringify(out, null, 1));
  }
  res.writeHead(404, cors); res.end('{}');
}).listen(process.env.PORT || 8080);
