// Oddable sign-in wall + $99/month subscription (Cash App). Owner is free. Fail-open if the server has no gate configured.
(function () {
  const API = 'https://calcutta-odds.onrender.com/acct';
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const s = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  // One person's data per phone. wipeData() clears everything that belongs to the signed-in person (bets, daily log, pins, locked picks, caches of them);
  // ownerSwitch(id) wipes it when a DIFFERENT person signs in on this phone, so nobody ever sees the previous user's data or uploads it into their own account.
  window.oddWipe = function () {
    try { const ks = []; for (let i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i)); ks.forEach((k) => { if (/^(bets26|betlog26|logat26|pinsat26|pinned26|kdel26|plbhtml26|surv26|sync-ids|sync-tomb|sync-last|sync-err|sync-rl|odd-ok|odd-dash|odd-push|odd-me|kal-id|kal-pem)$/.test(k) || /^(lk26-|splk-)/.test(k)) localStorage.removeItem(k); }); } catch (e) {}
  };
  window.oddOwner = function (id) { // call right before saving a new sign-in; returns true if the previous person's data was cleared
    const k = String(id || '').toLowerCase().replace(/\s/g, ''); if (!k) return false; const prev = g('sync-owner'); s('sync-owner', k);
    if (prev && prev !== k) { window.oddWipe(); window.__oddReload = true; return true; } return false;
  };
  (function () { const p = g('sync-phone'); if (p && !g('sync-owner')) s('sync-owner', p); })();
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
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function show() { if (!el) { el = document.createElement('div'); el.id = 'gate'; document.body.appendChild(el); document.documentElement.style.overflow = 'hidden'; } draw(); }
  function hide() { if (el) { el.remove(); el = null; document.documentElement.style.overflow = ''; } }
  function err(t) { const e = $('gerr'); if (e) { e.className = 'er'; e.textContent = t || ''; } }
  function draw() {
    if (!el) return;
    if (!g('odd-tok') || !me) {
      const em = mode === 'ein' || mode === 'eup', up = mode === 'up' || mode === 'eup';
      el.innerHTML = '<div class="gb"><h1>Oddable</h1><p>Sign in to see picks, locked records and your bets. New accounts get a 7-day free trial.</p>' +
        '<div class="tabs"><button class="' + (!up ? 'on' : 'alt') + '" id="gt-in">Sign in</button><button class="' + (up ? 'on' : 'alt') + '" id="gt-up">Create account</button></div>' +
        (em ? (up ? '<input id="gname" placeholder="Name" autocomplete="name">' : '') +
          '<input id="gemail" type="email" placeholder="Email" autocomplete="email" autocapitalize="none"><input id="gpw" type="password" placeholder="Password (8+ characters)" autocomplete="' + (up ? 'new-password' : 'current-password') + '">'
          : '<input id="gph" type="tel" inputmode="numeric" placeholder="Cell number" autocomplete="tel"><input id="gpn" type="password" inputmode="numeric" placeholder="PIN (new accounts: 6-10 digits)" autocomplete="off">') +
        '<div class="er" id="gerr"></div><button id="gdo">' + (up ? 'Start free trial' : 'Sign in') + '</button>' +
        '<button id="gsw" class="alt">' + (em ? 'Use cell number + PIN instead' : 'Use email + password instead') + '</button>' +
        '<p style="font-size:13px;color:#8fa0bf;margin:14px 0 0">This app is in development. Credit card payments are coming soon.</p>' +
        '<div class="box"><b>Owner?</b><input id="gpin" type="password" inputmode="numeric" placeholder="Owner PIN" autocomplete="off"><button id="gown" class="alt">Enter with PIN</button></div></div>';
      $('gt-in').onclick = () => { mode = em ? 'ein' : 'in'; draw(); }; $('gt-up').onclick = () => { mode = em ? 'eup' : 'up'; draw(); }; $('gdo').onclick = auth;
      $('gsw').onclick = () => { mode = em ? (up ? 'up' : 'in') : (up ? 'eup' : 'ein'); draw(); };
      const pf = $(em ? 'gpw' : 'gpn'); pf.onkeydown = (e) => { if (e.key === 'Enter') auth(); };
      $('gown').onclick = ownerIn; $('gpin').onkeydown = (e) => { if (e.key === 'Enter') ownerIn(); };
      return;
    }
    const m = me, dl = m.expires_on ? Math.ceil((new Date(m.expires_on + 'T23:59:59') - Date.now()) / 864e5) : 0;
    el.innerHTML = '<div class="gb"><h1>Subscribe to Oddable</h1><p>' + (m.plan === 'pro' ? (m.expires_on && String(m.expires_on).slice(0, 10) < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()) ? 'Your access ended ' + esc(m.expires_on) + '.' : 'Your renewal is waiting for the owner to confirm. Tap Check again in a bit.') : (m.source === 'trial' ? 'Your free trial has ended.' : 'Your access has ended.')) + ' $' + esc(m.price) + ' per month unlocks everything.</p>' +
      (m.pending ? '<div class="box ok">Payment request received. You will be unlocked as soon as it is confirmed. Tap Check again in a minute.</div>' : '') +
      '<div class="box"><b>Step 1.</b> Send $' + m.price + ' on Cash App' + (m.tag ? ' to <b>' + esc(m.tag) + '</b>' : '') + '.' +
      (/^https:\/\//.test(m.link || '') ? '<button id="gcash">Pay $' + m.price + ' with Cash App</button>' : '<p class="er">Payment is not set up yet. Contact the owner.</p>') +
      '<b>Step 2.</b> Come back and tap below.<button id="gpaid" class="alt">I paid — unlock me</button></div>' +
      '<div class="box"><b>Have a code?</b><input id="gcode" placeholder="Access code" autocapitalize="characters"><button id="gred" class="alt">Redeem code</button></div>' +
      '<div class="er" id="gerr"></div><button id="gchk" class="alt">Check again</button><button id="gout" class="alt">Sign out</button>' + '<p style="font-size:13px;color:#8fa0bf;margin:14px 0 0">This app is in development. Credit card payments are coming soon.</p>' + '</div>';
    if ($('gcash')) $('gcash').onclick = () => { window.open(m.link, '_blank', 'noopener'); };
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
    if (busy) return; busy = true; const b = $('gdo'), up = mode === 'up' || mode === 'eup'; if (b) b.textContent = 'Please wait…';
    try {
      let j;
      if (mode === 'in' || mode === 'up') {
        const ph = $('gph').value, pn = $('gpn').value;
        j = await call('/phone', { phone: ph, pin: pn, create: up });
        const np = ph.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1'); window.oddOwner(np);
        s('sync-phone', np); s('sync-pin', pn);
      } else { j = await call('/' + (up ? 'register' : 'login'), { email: $('gemail').value, password: $('gpw').value, name: up && $('gname') ? $('gname').value : '' }); window.oddOwner('e:' + String($('gemail').value || '')); s('sync-phone', null); s('sync-pin', null); }
      s('odd-tok', j.token); s('odd-noauto', null); setMe(j.me);
      if (window.__oddReload) { window.__oddReload = false; location.reload(); return; }
      if (!me) { err('Could not load your account. Please try again.'); if (b) b.textContent = up ? 'Start free trial' : 'Sign in'; }
    } catch (e) { err(e.message); if (b) b.textContent = up ? 'Start free trial' : 'Sign in'; }
    busy = false;
  }
  // People who already use Oddable have their number + PIN saved on this phone: sign them in without typing.
  async function autoPhone() {
    const ph = g('sync-phone'), pn = g('sync-pin'); if (!ph || !pn || g('odd-noauto')) return false;
    try { const j = await call('/phone', { phone: ph, pin: pn }); s('odd-tok', j.token); setMe(j.me); return true; } catch (e) { return false; }
  }
  function setMe(m) {
    me = m; if (!m) return; setTimeout(drawAcct, 0); try { s('odd-dash', (m.role === 'owner' && m.source === 'owner') || m.ownerDash ? '1' : null); if (window.navRender) setTimeout(window.navRender, 0); } catch (e) {}
    if (m.allowed) { s('odd-ok', String(Date.now())); hide(); soon(m); } else show();
  }
  function soon(m) {
    if (m.role === 'owner' || !m.expires_on) return; const d = Math.ceil((new Date(m.expires_on + 'T23:59:59') - Date.now()) / 864e5);
    if (d <= 3 && d >= 0 && !document.getElementById('gtoast')) { const t = document.createElement('div'); t.id = 'gtoast'; t.textContent = (m.source === 'trial' ? 'Free trial' : 'Subscription') + ' ends ' + (d === 0 ? 'today' : 'in ' + d + ' day' + (d > 1 ? 's' : '')) + ' — tap to renew'; t.onclick = () => { me = Object.assign({}, m, { allowed: false }); show(); t.remove(); }; document.body.appendChild(t); setTimeout(() => t.remove(), 9000); }
  }
  function out() { s('odd-noauto', '1'); s('odd-tok', null); s('odd-ok', null); s('odd-push', null); s('sync-phone', null); s('sync-pin', null); s('sync-owner', null); window.oddWipe(); me = null; mode = 'in'; location.reload(); }
  async function refresh(force) {
    const j = await call('/me'); setMe(j.me); return j.me;
  }
  window.gateOut = out;
  // Renewal reminders (phone push). Works from the Account box under Disclosures.
  const b64u = (k) => { const p = '='.repeat((4 - k.length % 4) % 4), r = atob((k + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  async function pushOn() {
    const st = $('acct-st'); const say = (t) => { if (st) st.textContent = t; };
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) { say('This browser cannot get reminders. On iPhone, add Oddable to your Home Screen first, then open it from there.'); return; }
      const perm = await Notification.requestPermission(); if (perm !== 'granted') { say('Notifications are blocked. Allow them in your phone settings for Oddable.'); return; }
      const key = (await call('/push-key')).key; const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) }));
      await call('/push', { subscription: sub.toJSON() }); s('odd-push', '1'); say('Reminders are on for this phone.'); drawAcct();
    } catch (e) { say(e.message || 'Could not turn reminders on'); }
  }
  function drawAcct() {
    const box = $('acct'); if (!box) return; if (!g('odd-tok') || !me) { box.innerHTML = ''; return; }
    const owner = (me.role === 'owner' && me.source === 'owner') || !!me.ownerDash;
    box.innerHTML = '<div class="sub"><b>Account</b>: <span id="acct-em"></span></div>' +
      (owner ? '<button id="acct-dash" style="min-height:44px;margin:4px 0;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:#0b3d91;color:#fff;font:700 14px inherit">📊 Owner dashboard</button>' : (g('odd-push') === '1' ? '<div class="sub">Renewal reminders are on.</div>' : '<button id="acct-push" style="min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font:700 14px inherit">Turn on renewal reminders</button>')) +
      '<div class="sub" id="acct-st"></div><button id="acct-out" style="min-height:44px;margin-top:6px;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font:700 14px inherit">Sign out</button>';
    const em = $('acct-em'); if (em) em.textContent = me.email || ''; const pb = $('acct-push'); if (pb) pb.onclick = pushOn; const db = $('acct-dash'); if (db) db.onclick = () => { if (window.oddDash) window.oddDash(); }; $('acct-out').onclick = out;
  }
  window.gateAcct = drawAcct;
  // Header fetch hook: attach the token to AI calls.
  const of = window.fetch; window.fetch = function (u, o) { try { if (String(u).indexOf('/ai/') > -1 && g('odd-tok')) { o = Object.assign({}, o); o.headers = Object.assign({}, o.headers, { 'x-token': g('odd-tok') }); } } catch (e) {} return of.call(this, u, o); };
  async function boot() {
    let on = false;
    try { const r = await fetch(API + '/status', { cache: 'no-store', signal: AbortSignal.timeout(12000) }); on = (await r.json()).gate === true; s('odd-gate', on ? '1' : '0'); }
    catch (e) { const k = g('odd-gate'); if (k === null) { show(); if (el) { el.innerHTML = '<div class="gb"><h1>Oddable</h1><p class="er">Could not reach the server. It may be waking up.</p><button id="gretry">Try again</button></div>'; const rb = $('gretry'); if (rb) rb.onclick = () => location.reload(); } return; } on = k === '1'; }
    if (!on) return;
    if (!g('odd-tok')) { if (g('sync-phone') && g('sync-pin') && !g('odd-noauto')) { show(); $('gate').innerHTML = '<div class="gb"><h1>Oddable</h1><p>Signing you in…</p></div>'; if (await autoPhone()) return; } show(); return; }
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
