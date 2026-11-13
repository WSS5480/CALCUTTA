// Oddable sign-in wall + $99/month subscription (Cash App). Owner is free. Fail-open if the server has no gate configured.
(function () {
  const API = 'https://calcutta-odds.onrender.com/acct';
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const s = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const GRACE = 72 * 36e5;
  let me = null, el = null, mode = 'in', busy = false;
  const css = document.createElement('style');
  css.textContent = '#gate{position:fixed;inset:0;z-index:200;background:#0b1220;color:#fff;overflow:auto;-webkit-overflow-scrolling:touch;font:15px/1.4 -apple-system,system-ui,sans-serif;padding:max(20px,env(safe-area-inset-top)) 16px 40px}#gate .gb{max-width:420px;margin:0 auto}#gate h1{font-size:28px;margin:18px 0 4px}#gate p{color:#b8c2d6;margin:6px 0 14px}#gate input{width:100%;box-sizing:border-box;padding:13px;margin:5px 0;border-radius:10px;border:1px solid #33415c;background:#141d30;color:#fff;font-size:16px}#gate button{width:100%;padding:14px;margin:8px 0;border:0;border-radius:11px;font-size:16px;font-weight:700;background:#2f7bff;color:#fff}#gate button.alt{background:#1b2740;color:#cfe0ff;font-weight:600}#gate .er{color:#ff8a8a;min-height:20px;font-size:14px}#gate .ok{color:#7be0a0}#gate .tabs{display:flex;gap:8px;margin:14px 0 6px}#gate .tabs button{margin:0;padding:10px}#gate .tabs button.on{background:#2f7bff;color:#fff}#gate a{color:#8db8ff}#gate .box{background:#141d30;border:1px solid #33415c;border-radius:12px;padding:14px;margin:12px 0}#gtoast{position:fixed;top:max(8px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:95;background:#7a4a00;color:#fff;border-radius:10px;padding:8px 12px;font:600 13px system-ui;max-width:92%}';
  document.head.appendChild(css);
  async function call(p, body) {
    const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'Error ' + r.status); e.status = r.status; throw e; } return j;
  }
  const $ = (id) => document.getElementById(id);
  function show() { if (!el) { el = document.createElement('div'); el.id = 'gate'; document.body.appendChild(el); document.documentElement.style.overflow = 'hidden'; } draw(); }
  function hide() { if (el) { el.remove(); el = null; document.documentElement.style.overflow = ''; } }
  function err(t) { const e = $('gerr'); if (e) { e.className = 'er'; e.textContent = t || ''; } }
  function draw() {
    if (!el) return;
    if (!g('odd-tok') || !me) {
      el.innerHTML = '<div class="gb"><h1>Oddable</h1><p>Sign in to see picks, locked records and your bets. New accounts get a 7-day free trial.</p>' +
        '<div class="tabs"><button class="' + (mode === 'in' ? 'on' : 'alt') + '" id="gt-in">Sign in</button><button class="' + (mode === 'up' ? 'on' : 'alt') + '" id="gt-up">Create account</button></div>' +
        (mode === 'up' ? '<input id="gname" placeholder="Name" autocomplete="name">' : '') +
        '<input id="gemail" type="email" placeholder="Email" autocomplete="email" autocapitalize="none"><input id="gpw" type="password" placeholder="Password (8+ characters)" autocomplete="' + (mode === 'up' ? 'new-password' : 'current-password') + '">' +
        '<div class="er" id="gerr"></div><button id="gdo">' + (mode === 'up' ? 'Start free trial' : 'Sign in') + '</button>' +
        '<div class="box"><b>Owner?</b><input id="gpin" type="password" inputmode="numeric" placeholder="Owner PIN" autocomplete="off"><button id="gown" class="alt">Enter with PIN</button></div></div>';
      $('gt-in').onclick = () => { mode = 'in'; draw(); }; $('gt-up').onclick = () => { mode = 'up'; draw(); }; $('gdo').onclick = auth;
      $('gpw').onkeydown = (e) => { if (e.key === 'Enter') auth(); };
      $('gown').onclick = ownerIn; $('gpin').onkeydown = (e) => { if (e.key === 'Enter') ownerIn(); };
      return;
    }
    const m = me, dl = m.expires_on ? Math.ceil((new Date(m.expires_on + 'T23:59:59') - Date.now()) / 864e5) : 0;
    el.innerHTML = '<div class="gb"><h1>Subscribe to Oddable</h1><p>' + (m.plan === 'pro' ? 'Your access ended ' + m.expires_on + '.' : (m.source === 'trial' || !m.expires_on ? 'Your free trial has ended.' : 'Your subscription has ended.')) + ' $' + m.price + ' per month unlocks everything.</p>' +
      (m.pending ? '<div class="box ok">Payment request received. You will be unlocked as soon as it is confirmed. Tap Check again in a minute.</div>' : '') +
      '<div class="box"><b>Step 1.</b> Send $' + m.price + ' on Cash App' + (m.tag ? ' to <b>' + m.tag + '</b>' : '') + '.' +
      (m.link ? '<button id="gcash">Pay $' + m.price + ' with Cash App</button>' : '<p class="er">Payment is not set up yet. Contact the owner.</p>') +
      '<b>Step 2.</b> Come back and tap below.<button id="gpaid" class="alt">I paid — unlock me</button></div>' +
      '<div class="box"><b>Have a code?</b><input id="gcode" placeholder="Access code" autocapitalize="characters"><button id="gred" class="alt">Redeem code</button></div>' +
      '<div class="er" id="gerr"></div><button id="gchk" class="alt">Check again</button><button id="gout" class="alt">Sign out</button></div>';
    if ($('gcash')) $('gcash').onclick = () => { window.open(m.link, '_blank'); };
    $('gpaid').onclick = async () => { if (busy) return; busy = true; try { await call('/pay'); await refresh(true); err(''); } catch (e) { err(e.message); } busy = false; draw(); };
    $('gred').onclick = async () => { if (busy) return; busy = true; try { const j = await call('/redeem', { code: $('gcode').value }); setMe(j.me); } catch (e) { err(e.message); } busy = false; if (el) draw(); };
    $('gchk').onclick = () => refresh(true).catch((e) => err(e.message)); $('gout').onclick = out;
  }
  async function ownerIn() {
    if (busy) return; busy = true;
    try { const j = await call('/owner', { pin: $('gpin').value }); s('odd-tok', j.token); setMe(j.me); } catch (e) { err(e.message); }
    busy = false;
  }
  async function auth() {
    if (busy) return; busy = true; const b = $('gdo'); if (b) b.textContent = 'Please wait…';
    try { const j = await call('/' + (mode === 'up' ? 'register' : 'login'), { email: $('gemail').value, password: $('gpw').value, name: mode === 'up' && $('gname') ? $('gname').value : '' }); s('odd-tok', j.token); setMe(j.me); }
    catch (e) { err(e.message); if (b) b.textContent = mode === 'up' ? 'Start free trial' : 'Sign in'; }
    busy = false;
  }
  function setMe(m) {
    me = m; if (!m) return;
    if (m.allowed) { s('odd-ok', String(Date.now())); hide(); soon(m); } else show();
  }
  function soon(m) {
    if (m.role === 'owner' || !m.expires_on) return; const d = Math.ceil((new Date(m.expires_on + 'T23:59:59') - Date.now()) / 864e5);
    if (d <= 3 && d >= 0 && !document.getElementById('gtoast')) { const t = document.createElement('div'); t.id = 'gtoast'; t.textContent = (m.source === 'trial' ? 'Free trial' : 'Subscription') + ' ends ' + (d === 0 ? 'today' : 'in ' + d + ' day' + (d > 1 ? 's' : '')) + ' — tap to renew'; t.onclick = () => { me = Object.assign({}, m, { allowed: false }); show(); t.remove(); }; document.body.appendChild(t); setTimeout(() => t.remove(), 9000); }
  }
  function out() { s('odd-tok', null); s('odd-ok', null); me = null; mode = 'in'; show(); }
  async function refresh(force) {
    const j = await call('/me'); setMe(j.me); return j.me;
  }
  window.gateOut = out;
  // Header fetch hook: attach the token to AI calls.
  const of = window.fetch; window.fetch = function (u, o) { try { if (String(u).indexOf('/ai/') > -1 && g('odd-tok')) { o = Object.assign({}, o); o.headers = Object.assign({}, o.headers, { 'x-token': g('odd-tok') }); } } catch (e) {} return of.call(this, u, o); };
  async function boot() {
    let on = false;
    try { const r = await fetch(API + '/status', { cache: 'no-store' }); on = (await r.json()).gate === true; s('odd-gate', on ? '1' : '0'); }
    catch (e) { on = g('odd-gate') === '1'; }
    if (!on) return;
    if (!g('odd-tok')) { show(); return; }
    // Offline / server asleep: keep working for 72h after the last successful check.
    const lastOk = Number(g('odd-ok') || 0);
    if (lastOk && Date.now() - lastOk < GRACE) { refresh().catch((e) => { if (e.status === 401) out(); }); return; }
    show(); $('gate').innerHTML = '<div class="gb"><h1>Oddable</h1><p>Checking your account…</p></div>';
    refresh().catch((e) => { if (e.status === 401) out(); else { if (el) el.innerHTML = '<div class="gb"><h1>Oddable</h1><p class="er">Could not reach the server. It may be waking up.</p><button id="gretry">Try again</button></div>'; const b = $('gretry'); if (b) b.onclick = () => location.reload(); } });
  }
  // Cover the app immediately to avoid a flash of content when a token exists and the gate is on.
  if (g('odd-gate') === '1' && !(g('odd-tok') && Date.now() - Number(g('odd-ok') || 0) < GRACE)) { document.addEventListener('DOMContentLoaded', () => {}); }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
