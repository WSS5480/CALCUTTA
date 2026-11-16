// "🎤 Log my score" (Nov 16 2026, owner: "Add speak to score with Claude assistant. 'Log my score'.").
// Shared voice module for every Oddable game. Speech -> text (push-to-talk from pics/ai.js: aiPTT) -> POST /voice/parse (server: same Anthropic path and
// ANTHROPIC_API_KEY as Ask Claude; strict JSON for ONE target; checked against the screen) -> confirmation card -> Save -> the target's OWN normal save route.
// Nothing is saved before the player taps Save. Browsers without speech recognition get a text box (type it, or use the keyboard's microphone).
// API: window.VoiceLog = { open(ctx), registerTarget(name, spec), has(name), supported() }
//   ctx: { target: 'self' | 'golf-hole' | 'golf-round' | 'match' | 'solo', ...screen context the engine already has (holes [{n, par}], players, team, format {to, winBy, bestOf}, unit, today) }
//   spec: { describe: string | (ctx) => string (shown to the player and sent as a screen note), save: (ctx, data) => Promise<{ok, pending?, note?}>  (a one-argument save gets {...ctx, ...data}) }
// Targets: 'self' is registered by pics/stats.js; golf-hole / golf-round by pics/golf.js and match / solo by pics/events.js when those engines are merged.
(function () {
  const BASE = () => window.ODD_STATS_API || window.ODD_GROUPS_API || 'https://calcutta-odds.onrender.com';
  const T = {}, esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tok = () => { try { return localStorage.getItem('odd-tok') || ''; } catch (e) { return ''; } };
  const supported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const KEEP = ['target', 'holes', 'players', 'team', 'teams', 'format', 'to', 'unit', 'sport', 'today']; // only these context keys go to the server
  let S = null; // { ctx, spec, parsed, confirm, heard, busy }
  const chiDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  function css() {
    if (document.getElementById('ovlcss')) return; const st = document.createElement('style'); st.id = 'ovlcss';
    st.textContent = '#ovoice{--sv:var(--blue);--sv2:var(--blue);position:fixed;inset:0;z-index:120;background:rgba(5,8,16,.8);display:flex;align-items:flex-end;justify-content:center;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink)}html.cb #ovoice{--sv:#003594;--sv2:#c6cbd7}'
      + '#ovoice *{box-sizing:border-box}#ovoice .vb{background:var(--panel);border:1px solid var(--line);border-radius:22px 22px 0 0;width:100%;max-width:560px;max-height:92vh;overflow:auto;padding:14px 16px calc(18px + env(safe-area-inset-bottom))}'
      + '#ovoice .vh{display:flex;justify-content:space-between;align-items:center;gap:8px}#ovoice .vh b{font-size:19px}#ovoice button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}'
      + '#ovoice .vx{background:none;border:0;color:var(--muted);min-height:44px;min-width:44px;font-weight:600}#ovoice .vd{color:var(--muted);font-size:13.5px;margin:4px 0 10px}'
      + '#ovoice .vmic{width:100%;min-height:72px;border-radius:999px;border:2px solid var(--sv2);background:var(--panel2);font-weight:800;font-size:18px;touch-action:none;user-select:none;-webkit-user-select:none}#ovoice .vmic.on{background:var(--sv);color:#fff}'
      + '#ovoice textarea{width:100%;min-height:76px;margin-top:10px;background:var(--bg);border:1px solid var(--line);border-radius:14px;color:var(--ink);font:600 16px system-ui;padding:10px 12px;resize:vertical}'
      + '#ovoice .vrow{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}#ovoice .vp,#ovoice .vs{min-height:48px;border-radius:14px;font-weight:700;font-size:16px;padding:8px 12px}#ovoice .vp{background:var(--sv);border:1px solid var(--sv2);color:#fff;border-radius:999px}#ovoice .vs{background:var(--panel2);border:1px solid var(--line);border-radius:999px}#ovoice .vp:disabled{opacity:.6}'
      + '#ovoice .vmsg{min-height:22px;color:var(--muted);font-size:14px;margin:8px 0 0}#ovoice .verr{background:#d93a2e14;border:1px solid var(--red);border-radius:10px;padding:10px 12px;margin-top:10px}#ovoice .vask{border:2px solid #f5c542;background:linear-gradient(135deg,rgba(245,197,66,.22),rgba(255,226,140,.08));border-radius:10px;padding:10px 12px;margin-top:10px}'
      + '#ovoice .vcard{background:#16915a14;border:2px solid var(--green);border-radius:16px;padding:14px;margin-top:12px}#ovoice .vcard small{display:block;color:var(--green);font-weight:700;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase}#ovoice .vcard b{display:block;font-size:19px;margin:4px 0;overflow-wrap:anywhere}#ovoice .vcard i{display:block;font-style:normal;color:var(--muted);font-size:13px;overflow-wrap:anywhere}';
    document.head.appendChild(st);
  }
  const desc = (spec, ctx) => { try { return typeof spec.describe === 'function' ? String(spec.describe(ctx) || '') : String(spec.describe || ''); } catch (e) { return ''; } };
  function paint() {
    const o = document.getElementById('ovoice'); if (!o || !S) return; const d = desc(S.spec, S.ctx), sup = supported();
    let h = '<div class="vb" role="dialog" aria-label="Log my score"><div class="vh"><b>🎤 Log my score</b><button class="vx" data-v="close" aria-label="Close">Close</button></div><p class="vd">' + esc(d || 'Say your score.') + '</p>';
    if (!S.parsed) {
      h += sup ? '<button class="vmic" id="vlmic">🎤 Hold to talk</button>' : '<p class="vask">Voice is not available in this browser. Type it below (or use your keyboard’s microphone).</p>';
      h += '<textarea id="vltext" placeholder="' + esc(S.ctx.target === 'golf-hole' ? 'e.g. "birdie on 7" or "we got a 4 on 12"' : S.ctx.target === 'match' ? 'e.g. "we won 11-7, 9-11, 11-5"' : 'e.g. "I shot 84 at Cedar Ridge" or "won 11-7 11-9 vs Ola"') + '">' + esc(S.heard || '') + '</textarea>';
      h += '<p class="vmsg" id="vlmsg" aria-live="polite">' + esc(S.say || '') + '</p>' + (S.ask ? '<div class="vask">' + esc(S.ask) + '</div>' : '') + (S.err ? '<div class="verr" role="alert">' + esc(S.err) + '</div>' : '');
      h += '<div class="vrow"><button class="vs" data-v="close">Cancel</button><button class="vp" data-v="read"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Reading…' : 'Read it') + '</button></div>';
    } else {
      h += '<div class="vcard"><small>Is this right?</small><b>' + esc(S.confirm) + '</b><i>You said: “' + esc(S.heard) + '”</i></div>' + (S.err ? '<div class="verr" role="alert">' + esc(S.err) + '</div>' : '') + (S.done ? '<p class="vmsg">' + esc(S.done) + '</p>' : '');
      h += '<div class="vrow"><button class="vs" data-v="redo">Change it</button><button class="vp" data-v="save"' + (S.busy || S.done ? ' disabled' : '') + '>' + (S.busy ? 'Saving…' : S.done ? 'Saved' : 'Save') + '</button></div>';
    }
    o.innerHTML = h + '</div>';
    const mic = o.querySelector('#vlmic'), ta = o.querySelector('#vltext'), say = (t) => { S.say = t; const m = o.querySelector('#vlmsg'); if (m) m.textContent = t; };
    if (ta) ta.oninput = () => { S.heard = ta.value; };
    if (mic && typeof window.aiPTT === 'function') window.aiPTT(mic, { say, idle: '🎤 Hold to talk', live: (t) => { if (ta) ta.value = t; S.heard = t; }, done: (t) => { if (ta) ta.value = t; S.heard = t; if (t) read(); } });
    else if (mic) mic.onclick = () => say('Voice needs the Ask Claude module (ai.js). Type it instead.');
  }
  async function read() {
    if (!S || S.busy) return; const text = String(S.heard || '').trim(); if (text.length < 2) { S.err = 'Say or type your score first.'; paint(); return; }
    S.busy = true; S.err = ''; S.ask = ''; paint();
    const ctx = {}; KEEP.forEach((k) => { if (S.ctx[k] != null) ctx[k] = S.ctx[k]; }); ctx.today = ctx.today || chiDay(); const hint = desc(S.spec, S.ctx); if (hint) ctx.hint = hint.slice(0, 200);
    try {
      const r = await fetch(BASE() + '/voice/parse', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': tok() }, body: JSON.stringify({ text, ctx }) }), j = await r.json().catch(() => ({}));
      S.busy = false; if (!r.ok) { if (j.ask) S.ask = j.error; else S.err = r.status === 401 ? 'Sign in to use voice scoring.' : j.error || 'Server said ' + r.status; paint(); return; }
      S.parsed = j.parsed; S.confirm = j.confirm; S.heard = j.heard || text; paint();
    } catch (e) { S.busy = false; S.err = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Could not reach the server. Try again in a few seconds.' : e.message; paint(); }
  }
  function dataFor(ctx, p) { // the shape each engine's save expects (merge adapters documented in HANDOFF)
    const d = Object.assign({}, p);
    if (p.target === 'golf-round' && Array.isArray(p.scores)) { d.count = p.holes; d.holes = p.scores; } // golf.js saveRound reads o.holes = [{hole, strokes}]
    if (p.target === 'golf-hole' && p.player && Array.isArray(ctx.players)) { const x = ctx.players.find((q) => q && typeof q === 'object' && q.name === p.player); if (x && x.pid) d.p = { [x.pid]: p.strokes }; } // golf.js saveHole reads o.p = {pid: strokes}
    return d;
  }
  async function save() {
    if (!S || S.busy || !S.parsed) return; S.busy = true; S.err = ''; paint();
    try { const fn = S.spec.save, data = dataFor(S.ctx, S.parsed), res = (await (fn.length >= 2 ? fn(S.ctx, data) : fn(Object.assign({}, S.ctx, data)))) || {};
      S.busy = false; if (res.opened) { close(); return; } S.done = res.pending ? 'Saved. Waiting for the other side to confirm.' : res.note || 'Saved.'; paint(); setTimeout(close, 1200);
    } catch (e) { S.busy = false; S.err = (e && e.message) || 'Could not save'; paint(); }
  }
  function close() { const o = document.getElementById('ovoice'); if (o) o.remove(); try { window.aiStopTalk && window.aiStopTalk(); } catch (e) {} S = null; }
  function open(ctx) {
    const c = Object.assign({}, ctx || {}), name = T[c.target] ? c.target : T.self && !c.target ? 'self' : c.target, spec = T[name];
    css(); let o = document.getElementById('ovoice'); if (o) o.remove(); o = document.createElement('div'); o.id = 'ovoice'; document.body.appendChild(o);
    o.addEventListener('click', (e) => { if (e.target === o) return close(); const b = e.target.closest('[data-v]'); if (!b || b.disabled) return; const v = b.dataset.v; if (v === 'close') close(); if (v === 'read') read(); if (v === 'save') save(); if (v === 'redo') { S.parsed = null; S.confirm = ''; S.err = ''; paint(); } });
    if (!spec) { o.innerHTML = '<div class="vb" role="dialog" aria-label="Log my score"><div class="vh"><b>🎤 Log my score</b><button class="vx" data-v="close">Close</button></div><p class="verr">Voice scoring for this screen is not ready yet. Enter the score by hand.</p></div>'; return; }
    c.target = name; c.today = c.today || chiDay(); S = { ctx: c, spec, parsed: null, heard: '', say: supported() ? 'Hold the button, say your score, let go.' : '' }; paint();
  }
  function registerTarget(name, spec) { if (!/^[a-z-]{2,20}$/.test(String(name)) || !spec || typeof spec.save !== 'function') throw new Error('VoiceLog.registerTarget(name, {save})'); T[name] = spec; }
  window.VoiceLog = { open, registerTarget, has: (n) => !!T[n], supported };
  try { window.dispatchEvent(new Event('voicelog-ready')); } catch (e) {}
})();
