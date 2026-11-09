// Anthropic API bridge for Oddable. Key stays on the server. Env: ANTHROPIC_API_KEY (required), AI_MODEL (optional).
const MODEL = () => process.env.AI_MODEL || 'claude-sonnet-5-5';
const HITS = new Map(); // ip -> [timestamps]
const MAX_BODY = 7e6;
const body = (req) => new Promise((res, rej) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n > MAX_BODY) { rej(new Error('too big')); req.destroy(); } else c.push(d); }); req.on('end', () => { try { res(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { rej(e); } }); req.on('error', rej); });
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
function limited(ip) { const t = Date.now(), a = (HITS.get(ip) || []).filter((x) => t - x < 3600e3); if (a.length >= 40) { HITS.set(ip, a); return true; } a.push(t); HITS.set(ip, a); return false; }
async function claude(system, content, max) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL(), max_tokens: max, system, messages: [{ role: 'user', content }] }) });
  const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'api ' + r.status);
  const t = (j.content || []).map((x) => x.text || '').join('').trim(); if (!t) throw new Error('Empty answer (' + (j.stop_reason || '?') + '), try again'); return t;
}
const SLIP = 'You read screenshots of sports bet slips (Kalshi, Underdog, sportsbooks). Transcribe the slip as plain text, one line per item, keeping the exact wording and numbers you see: teams, the pick/side, bet type (moneyline/spread/total/parlay with each leg), line, odds or chance %, cost/stake, payout. Do not guess missing numbers. Output only the text, no commentary.';
const CHAT = 'You are the assistant inside Oddable, a personal sports pick and bet-tracking app. Be terse and practical. Plain text, short lines, at most 12 lines total; use ** only for headings. Use only the data given (model win %, lines, user bets); say when something is not in the data. Model numbers are estimates, not guarantees. Give reasoning in a few short lines. Not licensed financial advice; no guarantees.';
async function handle(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type'); res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS'); res.statusCode = 204; res.end(); return true; }
  const path = req.url.split('?')[0];
  if (path === '/ai/status') { send(res, 200, { ok: !!(process.env.ANTHROPIC_API_KEY || '').trim(), model: MODEL() }); return true; }
  if (req.method !== 'POST') return false;
  if (!(process.env.ANTHROPIC_API_KEY || '').trim()) { send(res, 503, { error: 'AI not set up (ANTHROPIC_API_KEY missing)' }); return true; }
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (limited(ip)) { send(res, 429, { error: 'Hourly limit reached, try later' }); return true; }
  let b; try { b = await body(req); } catch (e) { send(res, 400, { error: 'bad request' }); return true; }
  try {
    if (path === '/ai/slip') {
      const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(b.image || ''); if (!m) { send(res, 400, { error: 'image required' }); return true; }
      const text = await claude(SLIP, [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: 'Transcribe this bet slip.' }], 4000);
      send(res, 200, { text }); return true;
    }
    if (path === '/ai/chat') {
      const q = String(b.q || '').slice(0, 1500), ctx = String(b.ctx || '').slice(0, 14000); if (!q) { send(res, 400, { error: 'question required' }); return true; }
      const text = await claude(CHAT, `DATA:\n${ctx}\n\nQUESTION: ${q}`, 4000);
      send(res, 200, { text }); return true;
    }
  } catch (e) { send(res, 502, { error: String(e.message || e).slice(0, 200) }); return true; }
  return false;
}
module.exports = { handle };
