// Shared Claude UI (Ask AI sheet). Each page defines aiCtx(gid) returning the data text to send.
(function(){var st=document.createElement('style');st.textContent='#aisheet{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.6);display:flex;align-items:flex-end}#aisheet[hidden]{display:none}#aisheet .isb{background:var(--panel);color:var(--ink);width:100%;max-height:85vh;overflow:auto;border-radius:22px 22px 0 0;padding:16px 18px calc(24px + env(safe-area-inset-bottom));line-height:1.45}#aisheet .ish{display:flex;justify-content:space-between;align-items:center;font-size:18px;margin-bottom:8px}#aisheet .ish button{border:0;background:var(--panel2);color:var(--ink);border-radius:999px;width:34px;height:34px;font-size:16px}#aisheet .apill{border:1px solid #c6cbd7;background:#003594;color:#fff;border-radius:999px;padding:8px 14px;font:700 14px system-ui;cursor:pointer}';document.head.appendChild(st);})();
// ---- Claude (Anthropic API) via our server: slip reading + Ask Claude. Key lives on the server only. ----
const aiG = (id) => (typeof ALL !== 'undefined' && ALL[id]) || (typeof GAMES !== 'undefined' && GAMES.find((x) => String(x.id) === String(id))) || null;
const AIURL = 'https://calcutta-odds.onrender.com/ai';
let AIOK = null;
async function aiReady() { if (AIOK !== null) return AIOK; try { const r = await fetch(AIURL + '/status', { cache: 'no-store' }); AIOK = r.ok && (await r.json()).ok === true; } catch (e) { AIOK = false; } return AIOK; }
async function aiAsk(q, gid) {
  const out = document.getElementById('aiout'); if (out) out.textContent = 'Thinking…';
  try {
    const r = await fetch(AIURL + '/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q, ctx: aiCtx(gid) }) }); const j = await r.json();
    if (out) { if (r.ok) out.innerHTML = String(j.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); else out.textContent = j.error || 'Failed'; }
  } catch (e) { if (out) out.textContent = 'Could not reach Claude: ' + (e.message || e); }
}
async function aiOpen(gid, auto) {
  let o = document.getElementById('aisheet');
  if (!o) { o = document.createElement('div'); o.id = 'aisheet'; o.onclick = (e) => { if (e.target === o) o.hidden = true; }; document.body.appendChild(o); }
  const g = gid ? aiG(gid) : null, pre = g ? [['Take or pass?', `Should I take ${g.away.abbr} @ ${g.home.abbr}? Moneyline and spread, brief reasoning.`]] : [['Best plays today', 'Which games on this slate are the best plays and which should I pass? Short list.'], ['Review my bets', 'Review my open bets: what looks good, what looks risky?']];
  o.innerHTML = '<div class="isb"><div class="ish"><b>🤖 Ask Claude' + (g ? ' · ' + g.away.abbr + ' @ ' + g.home.abbr : '') + '</b><button onclick="document.getElementById(\'aisheet\').hidden=true">✕</button></div><div id="aipre" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' + pre.map((x, i) => `<button class="apill" data-q="${x[1].replace(/"/g, '&quot;')}">${x[0]}</button>`).join('') + '</div><div style="display:flex;gap:6px"><input id="aiq" placeholder="Ask about the games or your bets" style="flex:1;min-width:0;padding:10px;border-radius:10px;border:1px solid var(--line,#444);background:transparent;color:inherit;font-size:16px"><button class="apill" id="aigo">Ask</button></div><div id="aiout" style="white-space:pre-wrap;margin-top:12px;line-height:1.45"></div></div>';
  o.hidden = false;
  const go = (q) => { if (q) aiAsk(q, gid); };
  o.querySelectorAll('#aipre button').forEach((b) => (b.onclick = () => go(b.dataset.q)));
  o.querySelector('#aigo').onclick = () => go(o.querySelector('#aiq').value.trim());
  o.querySelector('#aiq').onkeydown = (e) => { if (e.key === 'Enter') go(e.target.value.trim()); };
  if (!(await aiReady())) document.getElementById('aiout').textContent = 'Claude is not connected yet. Add ANTHROPIC_API_KEY to the calcutta-odds service in Render.'; else if (auto) go(auto);
}
