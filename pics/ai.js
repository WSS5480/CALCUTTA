// Shared Claude UI (Ask AI sheet). Each page defines aiCtx(gid) returning the data text to send.
(function(){var st=document.createElement('style');st.textContent='#aisheet{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.6);display:flex;align-items:flex-end}#aisheet[hidden]{display:none}#aisheet .isb{background:var(--panel);color:var(--ink);width:100%;max-height:85vh;overflow:auto;border-radius:22px 22px 0 0;padding:16px 18px calc(24px + env(safe-area-inset-bottom));line-height:1.45}#aisheet .ish{display:flex;justify-content:space-between;align-items:center;font-size:18px;margin-bottom:8px}#aisheet .ish button{border:0;background:var(--panel2);color:var(--ink);border-radius:999px;width:34px;height:34px;font-size:16px}#aisheet .mic{width:100%;margin:2px 0 10px;padding:16px;border-radius:16px;border:2px solid #003594;background:#003594;color:#fff;font:700 18px system-ui;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}#aisheet .mic.alt{background:transparent;color:inherit;font-size:15px;padding:10px}#aisheet .mic.alt.on{background:#d92d20;color:#fff}#aisheet #aiconv.on{background:#d92d20;border-color:#d92d20;animation:aimic 1s ease-in-out infinite}#aisheet .mic.on{background:#d92d20;border-color:#d92d20;animation:aimic 1s ease-in-out infinite}@keyframes aimic{0%,100%{box-shadow:0 0 0 0 rgba(217,45,32,.6)}50%{box-shadow:0 0 0 10px rgba(217,45,32,0)}}#aisheet .vrow{display:flex;gap:10px;align-items:center;justify-content:space-between;font-size:13px;opacity:.9;margin:0 0 8px}#aisheet .vrow button{border:1px solid #c6cbd7;background:none;color:inherit;border-radius:999px;padding:4px 10px;font:600 12px system-ui;width:auto;height:auto}#aisheet .apill{border:1px solid #c6cbd7;background:#003594;color:#fff;border-radius:999px;padding:8px 14px;font:700 14px system-ui;cursor:pointer}';document.head.appendChild(st);})();
// ---- Claude (Anthropic API) via our server: slip reading + Ask Claude. Key lives on the server only. ----
const aiG = (id) => (typeof ALL !== 'undefined' && ALL[id]) || (typeof GAMES !== 'undefined' && GAMES.find((x) => String(x.id) === String(id))) || null;
const AIURL = 'https://calcutta-odds.onrender.com/ai';
let AIOK = null;
async function aiReady() { if (AIOK !== null) return AIOK; try { const r = await fetch(AIURL + '/status', { cache: 'no-store' }); AIOK = r.ok && (await r.json()).ok === true; } catch (e) { AIOK = false; } return AIOK; }
const AICONV = { on: false, rec: null, hist: [], empty: 0, gid: null, busy: false };
async function aiAsk(q, gid, byVoice, done) {
  const out = document.getElementById('aiout'); if (out) out.textContent = 'Thinking…'; let spoke = false;
  try {
    const hist = AICONV.on || byVoice ? AICONV.hist.slice(-3).map((h) => 'Q: ' + h[0] + '\nA: ' + h[1]).join('\n') : '';
    const qq = byVoice ? (hist ? 'Earlier in this conversation:\n' + hist.slice(-900) + '\n\nNew question: ' : '') + q + '\n\n(This will be read aloud: answer in 2 to 4 short plain sentences, no lists, no markdown, no emojis.)' : q;
    const r = await fetch(AIURL + '/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: qq, ctx: aiCtx(gid) }) }); const j = await r.json();
    if (out) { if (r.ok) { out.innerHTML = String(j.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); AICONV.hist.push([q.slice(0, 200), String(j.text).slice(0, 300)]); AICONV.hist = AICONV.hist.slice(-4); if (byVoice || aiVoiceOn()) { spoke = true; aiSpeak(j.text, done); } } else out.textContent = j.error || 'Failed'; }
  } catch (e) { if (out) out.textContent = 'Could not reach Claude: ' + (e.message || e); }
  if (!spoke && done) done(); // nothing to speak: still continue the conversation
}
// ---- Push to talk: hold the mic, speak, let go; Claude answers out loud ----
const aiVoiceOn = () => { try { return localStorage.getItem('ai-voice') === '1'; } catch (e) { return false; } };
function aiStopTalk() { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {} const b = document.getElementById('aistop'); if (b) b.hidden = true; }
let aiVoiceObj = null;
function aiPickVoice() { try { const v = window.speechSynthesis.getVoices(); aiVoiceObj = v.find((x) => /^en[-_]US/i.test(x.lang) && x.localService) || v.find((x) => /^en/i.test(x.lang)) || null; } catch (e) {} }
try { if (window.speechSynthesis) { aiPickVoice(); window.speechSynthesis.onvoiceschanged = aiPickVoice; } } catch (e) {}
function aiUnlock() { try { const ss = window.speechSynthesis; if (!ss) return; ss.cancel(); const u = new SpeechSynthesisUtterance(' '); u.volume = 0; ss.speak(u); } catch (e) {} } // must run inside a tap: iPhone only allows speech that follows a tap
function aiSpeak(text, done) {
  let fin = false; const finish = () => { if (fin) return; fin = true; const x = document.getElementById('aistop'); if (x) x.hidden = true; if (done) done(); };
  const ss = window.speechSynthesis; if (!ss) { finish(); return; } aiStopTalk();
  const clean = String(text || '').replace(/\*\*/g, '').replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F]/gu, '').replace(/\s+/g, ' ').trim(); if (!clean) { finish(); return; }
  setTimeout(finish, Math.min(90000, 5000 + clean.length * 95)); // safety: never get stuck if the phone never reports the end of speech
  const parts = clean.match(/[^.!?]+[.!?]*\s*/g) || [clean], chunks = []; let cur = ''; parts.forEach((p) => { if ((cur + p).length > 180 && cur) { chunks.push(cur); cur = p; } else cur += p; }); if (cur) chunks.push(cur);
  const b = document.getElementById('aistop'); if (b) b.hidden = false;
  let started = false; setTimeout(() => { if (!started) { const m = document.getElementById('aimsg'); if (m) m.textContent = 'No sound? Turn the phone ringer/silent switch to ring, raise the volume, and tap the voice button again.'; } }, 2500);
  chunks.forEach((c, i) => { const u = new SpeechSynthesisUtterance(c); u.rate = 1.03; u.lang = 'en-US'; if (aiVoiceObj) u.voice = aiVoiceObj; u.onstart = () => { started = true; }; u.onerror = () => { if (i === chunks.length - 1) finish(); }; if (i === chunks.length - 1) u.onend = finish; ss.speak(u); });
}
// ---- Conversation mode: Claude answers out loud, then listens again by itself. Tap again (or ⏹) to end. ----
function aiConvEnd(msg) {
  AICONV.on = false; try { if (AICONV.rec) { AICONV.rec.onend = null; AICONV.rec.onresult = null; AICONV.rec.onerror = null; AICONV.rec.stop(); } } catch (e) {} AICONV.rec = null;
  const b = document.getElementById('aiconv'); if (b) { b.classList.remove('on'); b.textContent = '🎙 Start conversation'; } const m = document.getElementById('aimsg'); if (m && msg) m.textContent = msg;
}
function aiConvListen() {
  if (!AICONV.on) return; const SR = window.SpeechRecognition || window.webkitSpeechRecognition, m = document.getElementById('aimsg'), q = document.getElementById('aiq'); if (!SR) { aiConvEnd('Voice input is not available in this browser.'); return; }
  let text = '', sent = false, rec; try { rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1; } catch (e) { aiConvEnd('Could not start the microphone.'); return; }
  AICONV.rec = rec;
  rec.onresult = (ev) => { let t = ''; for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript + ' '; text = t.trim(); if (m) m.textContent = '🎙 ' + (text || 'Listening…'); };
  rec.onerror = (ev) => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { sent = true; aiConvEnd('Microphone is blocked. Allow the microphone for this site in your browser settings.'); } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') { sent = true; aiConvEnd('Voice error: ' + ev.error + '. Tap Start conversation to try again.'); } };
  rec.onend = () => {
    if (sent || !AICONV.on) return; const t = text.trim();
    if (!t) { AICONV.empty++; if (AICONV.empty >= 3) { aiConvEnd('Paused because I heard nothing. Tap Start conversation to continue.'); return; } setTimeout(aiConvListen, 250); return; }
    AICONV.empty = 0; sent = true; if (q) q.value = t; if (m) m.textContent = 'You said: ' + t;
    if (/^(stop|end|goodbye|that's all|thats all|thank you[, ]*(that's|thats)? ?all)\W*$/i.test(t)) { aiConvEnd('Conversation ended.'); return; }
    aiAsk(t, AICONV.gid, true, () => { if (AICONV.on) setTimeout(aiConvListen, 350); }); // speak the answer, THEN listen again (so it never hears itself)
  };
  try { rec.start(); if (m) m.textContent = '🎙 Listening… just talk'; } catch (e) { setTimeout(aiConvListen, 500); }
}
function aiMicInit(o, gid) {
  const cb = o.querySelector('#aiconv'); if (cb) cb.onclick = () => { if (AICONV.on) { aiStopTalk(); aiConvEnd('Conversation ended.'); return; } AICONV.on = true; AICONV.empty = 0; AICONV.gid = gid; AICONV.hist = []; cb.classList.add('on'); cb.textContent = '⏹ End conversation'; aiUnlock(); aiConvListen(); };
  const sb = o.querySelector('#aistop'), vb = o.querySelector('#aivoice'); sb.onclick = () => { aiStopTalk(); aiConvEnd('Stopped.'); }; vb.onclick = () => { const on = !aiVoiceOn(); try { localStorage.setItem('ai-voice', on ? '1' : '0'); } catch (e) {} vb.textContent = on ? '🔊 Voice replies: on' : '🔇 Voice replies: off'; if (!on) aiStopTalk(); else { aiUnlock(); aiSpeak('Voice replies are on. Can you hear me?'); } };
  const mic = o.querySelector('#aimic'), msg = o.querySelector('#aimsg'), SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, text = '', held = false, started = 0;
  const say = (t) => { msg.textContent = t; };
  if (!SR) { mic.onclick = () => say('Voice input is not available in this browser. On iPhone use Safari; or tap the text box and use the keyboard microphone.'); return; }
  const start = (e) => {
    e.preventDefault(); if (held) return; aiConvEnd(); held = true; text = ''; aiStopTalk();
    aiUnlock();
    try { rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1; } catch (x) { held = false; say('Could not start the microphone.'); return; }
    rec.onresult = (ev) => { let t = ''; for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript + ' '; text = t.trim(); say('🎤 ' + (text || 'Listening…')); };
    rec.onerror = (ev) => { held = false; mic.classList.remove('on'); say(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'Microphone is blocked. Allow the microphone for this site in your browser settings.' : ev.error === 'no-speech' ? 'I did not hear anything. Hold the button and talk.' : 'Voice error: ' + ev.error); };
    rec.onend = () => { if (held) { try { rec.start(); } catch (x) {} } }; // some browsers stop on a pause; keep listening while the finger is down
    try { rec.start(); started = Date.now(); mic.classList.add('on'); mic.textContent = '🎤 Listening… let go to send'; say('Listening…'); } catch (x) { held = false; say('Could not start the microphone.'); }
  };
  const end = (e) => {
    if (e) e.preventDefault(); if (!held) return; held = false; mic.classList.remove('on'); mic.textContent = '🎤 Hold to talk (one question)';
    const finish = () => { const q = text.trim(); if (!q) { say('I did not catch that. Hold the button, talk, then let go.'); return; } o.querySelector('#aiq').value = q; say('You said: ' + q); aiAsk(q, gid, true); };
    try { rec.onend = null; rec.stop(); } catch (x) {} setTimeout(finish, 450); // the last words arrive just after release
  };
  mic.addEventListener('pointerdown', start); ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => mic.addEventListener(ev, end)); mic.addEventListener('contextmenu', (e) => e.preventDefault());
}
async function aiOpen(gid, auto) {
  let o = document.getElementById('aisheet');
  if (!o) { o = document.createElement('div'); o.id = 'aisheet'; o.onclick = (e) => { if (e.target === o) { o.hidden = true; aiStopTalk(); aiConvEnd(); } }; document.body.appendChild(o); }
  const g = gid ? aiG(gid) : null, pre = g ? [['Take or pass?', `Should I take ${g.away.abbr} @ ${g.home.abbr}? Moneyline and spread, brief reasoning.`]] : [['Best plays today', 'Which games on this slate are the best plays and which should I pass? Short list.'], ['Review my bets', 'Review my open bets: what looks good, what looks risky?']];
  o.innerHTML = '<div class="isb"><div class="ish"><b>🤖 Ask Claude' + (g ? ' · ' + g.away.abbr + ' @ ' + g.home.abbr : '') + '</b><button onclick="document.getElementById(\'aisheet\').hidden=true;aiStopTalk();aiConvEnd()">✕</button></div><button class="mic" id="aiconv">🎙 Start conversation</button><button class="mic alt" id="aimic">🎤 Hold to talk (one question)</button><div class="vrow"><span id="aimsg">Hold the button, ask your question, let go. Claude answers out loud.</span><span><button id="aistop" hidden>⏹ Stop</button> <button id="aivoice">🔇 Voice replies: off</button></span></div><div id="aipre" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' + pre.map((x, i) => `<button class="apill" data-q="${x[1].replace(/"/g, '&quot;')}">${x[0]}</button>`).join('') + '</div><div style="display:flex;gap:6px"><input id="aiq" placeholder="Ask about the games or your bets" style="flex:1;min-width:0;padding:10px;border-radius:10px;border:1px solid var(--line,#444);background:transparent;color:inherit;font-size:16px"><button class="apill" id="aigo">Ask</button></div><div id="aiout" style="white-space:pre-wrap;margin-top:12px;line-height:1.45"></div></div>';
  o.hidden = false; aiMicInit(o, gid); { const v = o.querySelector('#aivoice'); if (v && aiVoiceOn()) v.textContent = '🔊 Voice replies: on'; }
  const go = (q) => { if (q) { aiUnlock(); aiAsk(q, gid); } };
  o.querySelectorAll('#aipre button').forEach((b) => (b.onclick = () => go(b.dataset.q)));
  o.querySelector('#aigo').onclick = () => go(o.querySelector('#aiq').value.trim());
  o.querySelector('#aiq').onkeydown = (e) => { if (e.key === 'Enter') go(e.target.value.trim()); };
  if (!(await aiReady())) document.getElementById('aiout').textContent = 'Claude is not connected yet. Add ANTHROPIC_API_KEY to the calcutta-odds service in Render.'; else if (auto) go(auto);
}
