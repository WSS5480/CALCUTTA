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

async function handle(req, res) { // mounted under /kalshi/*; returns false for other paths
  const u = new URL(req.url, 'http://x'); if (!u.pathname.startsWith('/kalshi')) return false;
  const path = u.pathname.replace(/^\/kalshi/, '') || '/';
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
  const send = (code, obj) => { res.writeHead(code, cors); res.end(obj === undefined ? '' : JSON.stringify(obj, null, path === '/debug' ? 1 : 0)); return true; };
  if (req.method === 'OPTIONS') return send(204);
  if (path === '/health') return send(200, { ok: true, keyLoaded: !!KEY, keyId: !!KEY_ID, tokenSet: !!TOKEN, at: CACHE.at, err: CACHE.err ? 'see /kalshi/debug' : null });
  if (path === '/proxy' && req.method === 'POST') { // stateless: forwards a request the user's own browser already signed. Nothing is stored or logged.
    let body = ''; for await (const c of req) { body += c; if (body.length > 4000) return send(413, { error: 'too big' }); }
    let j; try { j = JSON.parse(body); } catch (e) { return send(400, { error: 'bad json' }); }
    const pth = String(j.path || ''); if (!/^\/(portfolio\/(fills|settlements)|markets\/[A-Za-z0-9._-]+)$/.test(pth)) return send(403, { error: 'path not allowed' });
    const h = j.headers || {}; const hh = { 'KALSHI-ACCESS-KEY': String(h['KALSHI-ACCESS-KEY'] || ''), 'KALSHI-ACCESS-TIMESTAMP': String(h['KALSHI-ACCESS-TIMESTAMP'] || ''), 'KALSHI-ACCESS-SIGNATURE': String(h['KALSHI-ACCESS-SIGNATURE'] || '') };
    if (!hh['KALSHI-ACCESS-KEY'] || !hh['KALSHI-ACCESS-SIGNATURE']) return send(400, { error: 'missing auth headers' });
    const qs = j.query && typeof j.query === 'object' ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(j.query).map(([k, v]) => [k, String(v)]))) : '';
    try { const r = await fetch(BASE + pth + qs, { headers: hh }); const t = await r.text(); res.writeHead(r.status, cors); res.end(t); return true; } catch (e) { return send(502, { error: 'upstream' }); }
  }
  if (!TOKEN || u.searchParams.get('token') !== TOKEN) return send(401, { error: 'bad token' });
  if (path === '/bets') { if (Date.now() - CACHE.at > EVERY * 2) await sync(); return send(200, { at: CACHE.at, err: CACHE.err, bets: CACHE.bets }); }
  if (path === '/debug') { // raw look at what Kalshi returns, so the mapping can be tuned. No secrets.
    const out = { err: CACHE.err, setErr: CACHE.setErr, counts: CACHE.counts };
    try { const f = await get('/portfolio/fills', { limit: '3' }); out.sampleFills = f.fills; if (f.fills && f.fills[0]) out.sampleMarket = (await get('/markets/' + encodeURIComponent(f.fills[0].ticker))).market; } catch (e) { out.fetchErr = e.message; }
    return send(200, out);
  }
  return send(404, {});
}
module.exports = { handle };
if (require.main === module) http.createServer(async (req, res) => { if (!(await handle(req, res))) { res.writeHead(404); res.end('{}'); } }).listen(process.env.PORT || 8080);
