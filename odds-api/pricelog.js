// Price log: every 20 min, stores Kalshi NFL market prices (public, read-only) next to the cached multi-book spreads and ESPN line,
// so book-vs-Kalshi gaps and opening/closing movement can be measured offline after a season. Reads only; never places anything.
// Storage: one row per Chicago hour in the same Supabase table as the locks (id 'plog:YYYY-MM-DD-HH'). Spends NO odds-api credits (uses the cached /games data only).
const S = require('./sync');
const BASE = (process.env.KALSHI_PUBLIC_BASE || 'https://api.elections.kalshi.com/trade-api/v2').replace(/\/$/, '');
const SERIES = (process.env.KALSHI_SERIES || 'KXNFLGAME,KXNFLSPREAD,KXNFLTOTAL').split(',').map((x) => x.trim()).filter(Boolean);
const num = (...v) => { for (const x of v) if (x !== undefined && x !== null && x !== '' && !isNaN(+x)) return +x; return null; };
const cents = (m, a, b) => { const c = num(m[a]); if (c !== null) return c; const d = num(m[b]); return d === null ? null : Math.round(d * 100); };
const dayKey = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) + '-' + String(new Date(t).toLocaleString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false })).slice(0, 2); // one row per Chicago hour keeps rows small
let last = '', status = { at: 0, ok: null, err: null, markets: 0, saved: 0 };
async function kalshiMarkets() {
  const out = [];
  for (const s of SERIES) {
    let cur = '', n = 0;
    do {
      const q = new URLSearchParams({ series_ticker: s, status: 'open', limit: '200' }); if (cur) q.set('cursor', cur);
      const r = await fetch(BASE + '/markets?' + q, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) { if (r.status === 404) break; throw new Error(s + ' ' + r.status); }
      const j = await r.json(); (j.markets || []).forEach((m) => out.push([m.ticker, cents(m, 'yes_bid', 'yes_bid_dollars'), cents(m, 'yes_ask', 'yes_ask_dollars'), num(m.volume, m.volume_fp), num(m.open_interest, m.open_interest_fp), m.close_time ? Date.parse(m.close_time) : null]));
      cur = j.cursor || '';
    } while (cur && ++n < 10);
  }
  const lim = Date.now() + 5 * 864e5; return out.filter((m) => !m[5] || m[5] < lim).slice(0, 1500); // games in the next 5 days only
}
function bookRows(games) { // consensus + best number each side from the cached multi-book feed
  const c = games && games.games || []; return c.map((g) => [g.away + '@' + g.home, Date.parse(g.start) || null, g.line, g.n, g.lo, g.hi, (g.books || []).map((b) => [b.k, b.l, b.p, b.pa])]);
}
async function tick(LINES, gamesMod) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) { status = { ...status, at: Date.now(), ok: false, err: 'no database configured' }; return; }
  let k = []; try { k = await kalshiMarkets(); status.err = null; } catch (e) { status.err = 'kalshi: ' + e.message; }
  const pk = gamesMod && gamesMod.peek ? gamesMod.peek('nfl') : null, now = Date.now();
  const es = []; Object.keys(LINES || {}).forEach((id) => { const a = LINES[id], l = a && a[a.length - 1]; if (l && now - l[0] < 45 * 6e4) es.push([id, l[1]]); });
  if (!k.length && !es.length && !(pk && pk.games && pk.games.length)) { status = { ...status, at: now, ok: false, markets: 0 }; return; }
  const snap = { t: now, k, b: bookRows(pk), e: es, bt: pk ? Date.parse(pk.updated) || null : null };
  const sig = JSON.stringify([snap.k, snap.b, snap.e]); status = { ...status, at: now, ok: true, markets: k.length };
  if (sig === last) return; last = sig;
  const id = 'plog:' + dayKey(now);
  for (let tries = 0; tries < 4; tries++) {
    let row = await S.dbGet(id); if (!row) { await S.dbPut({ id, salt: 'x', pinhash: 'x', data: { snaps: [] }, updated: 1 }, true); row = await S.dbGet(id); if (!row) continue; }
    const snaps = ((row.data && row.data.snaps) || []); snaps.push(snap);
    if (await S.dbPatchIf(id, row.updated, { snaps }, Date.now())) { status.saved++; return; }
  }
}
async function handle(req, res) {
  const u = new URL(req.url, 'http://x'); if (u.pathname !== '/pricelog') return false;
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json');
  const d = u.searchParams.get('day');
  if (!d) { res.end(JSON.stringify({ status, series: SERIES })); return true; }
  if (!/^\d{4}-\d{2}-\d{2}(-\d{2})?$/.test(d)) { res.statusCode = 400; res.end('{"error":"bad day"}'); return true; }
  try { const row = await S.dbGet('plog:' + d); res.end(JSON.stringify({ day: d, snaps: (row && row.data && row.data.snaps) || [] })); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
  return true;
}
module.exports = { tick, handle };
