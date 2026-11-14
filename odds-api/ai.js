// Anthropic API bridge for Oddable. Key stays on the server. Env: ANTHROPIC_API_KEY (required), AI_MODEL (optional).
const MODEL = () => process.env.AI_MODEL || 'claude-sonnet-5-5';
const HITS = new Map(); // ip -> [timestamps]
const MAX_BODY = 7e6;
const body = (req) => new Promise((res, rej) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n > MAX_BODY) { rej(new Error('too big')); req.destroy(); } else c.push(d); }); req.on('end', () => { try { res(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { rej(e); } }); req.on('error', rej); });
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
function limited(ip) { const t = Date.now(), a = (HITS.get(ip) || []).filter((x) => t - x < 3600e3); if (a.length >= 40) { HITS.set(ip, a); return true; } a.push(t); HITS.set(ip, a); return false; }
async function claude(system, content, max) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL(), max_tokens: max, system, messages: [{ role: 'user', content }] }), signal: AbortSignal.timeout(90000) });
  const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'api ' + r.status);
  const t = (j.content || []).map((x) => x.text || '').join('').trim(); if (!t) throw new Error('Empty answer (' + (j.stop_reason || '?') + '), try again'); return t;
}
const SLIPJ = 'You read a screenshot of a sports bet slip (Kalshi, Underdog, DraftKings, FanDuel, PrizePicks, etc.). Reply with ONLY one JSON object, no markdown, no commentary: {"kind":"single" or "parlay","status":"open"|"won"|"lost"|"push","stake":number or null (what was risked / cost),"payout":number or null (total payout or to-win),"multiplier":number or null (e.g. 3.5 for 3.5x),"american_odds":number or null,"legs":[{"team":"the team/side picked, as written","opponent":"the other team in that game or null","type":"ml" (to win) | "spread" | "total" | "prop","line":number or null (for spread: the line for the picked team, negative if favored, positive if underdog; for total: the number),"text":"the leg exactly as written on the slip"}]}. One entry in legs per pick. Never invent anything not on the slip; use null when unsure.';
const SURV = 'You read a screenshot from a Survivor / Survival pool (Yahoo Sports, ESPN, etc.) showing which NFL teams the user has already picked, week by week. Reply with ONLY one JSON object, no markdown, no commentary: {"picks":[{"team":"full NFL team name like Kansas City Chiefs","week":number or null,"result":"won"|"lost"|"pending"|null}]}. Include only the USER\'S OWN picks, one per week, never the opponents or other players. If a week number is not shown, use null. If you cannot find any picks return {"picks":[]}.';
const SLIP = 'You read screenshots of sports bet slips (Kalshi, Underdog, sportsbooks). Transcribe the slip as plain text, one line per item, keeping the exact wording and numbers you see: teams, the pick/side, bet type (moneyline/spread/total/parlay with each leg), line, odds or chance %, cost/stake, payout. Do not guess missing numbers. Output only the text, no commentary.';
const CHAT = 'You are the assistant inside Oddable, a personal sports pick and bet-tracking app. Be terse and practical. Plain text, short lines, at most 12 lines total; use ** only for headings. Use only the data given (model win %, lines, user bets); say when something is not in the data. Model numbers are estimates, not guarantees. Give reasoning in a few short lines. Not licensed financial advice; no guarantees.';
async function handle(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type,x-token,x-dash'); res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS'); res.statusCode = 204; res.end(); return true; }
  const path = req.url.split('?')[0];
  if (path === '/ai/status') { send(res, 200, { ok: !!(process.env.ANTHROPIC_API_KEY || '').trim(), model: MODEL() }); return true; }
  if (req.method !== 'POST') return false;
  if (!(await require('./acct.js').check(req))) { send(res, 401, { error: 'Sign in to use AI' }); return true; }
  if (!(process.env.ANTHROPIC_API_KEY || '').trim()) { send(res, 503, { error: 'AI not set up (ANTHROPIC_API_KEY missing)' }); return true; }
  const ip = require('./ip').clientIp(req);
  if (limited(ip)) { send(res, 429, { error: 'Hourly limit reached, try later' }); return true; }
  let b; try { b = await body(req); } catch (e) { send(res, 400, { error: 'bad request' }); return true; }
  try {
    if (path === '/ai/slip') {
      const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(b.image || ''); if (!m) { send(res, 400, { error: 'image required' }); return true; }
      const text = await claude(SLIP, [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: 'Transcribe this bet slip.' }], 4000);
      send(res, 200, { text }); return true;
    }
    if (path === '/ai/slipjson') {
      const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(b.image || ''); if (!m) { send(res, 400, { error: 'image required' }); return true; }
      const text = await claude(SLIPJ, [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: 'Return the JSON for this bet slip.' }], 3000);
      const mm = /\{[\s\S]*\}/.exec(text || ''); let data = null; try { data = JSON.parse(mm ? mm[0] : ''); } catch (e) {}
      if (!data || !Array.isArray(data.legs)) { send(res, 502, { error: 'Could not read that slip', text }); return true; }
      send(res, 200, { data }); return true;
    }
    if (path === '/ai/survivor') {
      const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(b.image || ''); if (!m) { send(res, 400, { error: 'image required' }); return true; }
      const text = await claude(SURV, [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: 'Return the JSON of my picks.' }], 2000);
      const mm = /\{[\s\S]*\}/.exec(text || ''); let data = null; try { data = JSON.parse(mm ? mm[0] : ''); } catch (e) {}
      if (!data || !Array.isArray(data.picks)) { send(res, 502, { error: 'Could not read that screenshot', text }); return true; }
      send(res, 200, { data }); return true;
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
