// Oddable sign-in wall + $99/month subscription (Cash App). Owner is free. Fail-open if the server has no gate configured.
// v268: GUEST MODE. No wall on open: a visitor with no account (and an account whose time has ended) browses the open things; picks, My Bets and Groups show a
// locked card that opens this file's sign-up / pay screen as a sheet with a Back. Switch: /acct/status `guest` (env GUEST_MODE on the odds server). See "v268 GUEST MODE" below.
(function () {
  const API = 'https://calcutta-odds.onrender.com/acct';
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    // Warning before opening any sport that has no pick model (everything but NFL and NCAA football). Shown on every tap.
  window.oddWarn = function (go) {
    try {
      if (document.getElementById('oddwarn')) return; const o = document.createElement('div'); o.id = 'oddwarn';
      o.style.cssText = 'position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px';
      o.innerHTML = '<div style="max-width:340px;width:100%;background:var(--panel,#121a33);color:var(--ink,#eee);border:1px solid var(--line,#fff3);border-radius:16px;padding:18px;font:15px/1.4 system-ui"><div style="font-size:30px">⚠️</div><h3 style="margin:6px 0 8px;font-size:18px">Not a pick model yet</h3><p style="margin:0 0 14px">Bet at own risk.</p><div style="display:flex;gap:10px"><button id="oddw-no" style="flex:1;min-height:44px;border-radius:10px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);color:var(--ink,#eee);font:700 14px inherit">Cancel</button><button id="oddw-ok" style="flex:1;min-height:44px;border-radius:10px;border:0;background:#0b3d91;color:#fff;font:700 14px inherit">Continue</button></div></div>';
      document.body.appendChild(o); document.getElementById('oddw-no').onclick = () => o.remove(); document.getElementById('oddw-ok').onclick = () => { o.remove(); go(); };
    } catch (e) { go(); }
  };
  const s = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  // One person's data per phone. wipeData() clears everything that belongs to the signed-in person (bets, daily log, pins, locked picks, caches of them);
  // ownerSwitch(id) wipes it when a DIFFERENT person signs in on this phone, so nobody ever sees the previous user's data or uploads it into their own account.
  window.oddWipe = function () {
    try { const ks = []; for (let i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i)); ks.forEach((k) => { if (/^(bets26|betlog26|logat26|pinsat26|pinned26|kdel26|plbhtml26|surv26|sync-ids|sync-tomb|sync-last|sync-err|sync-rl|odd-ok|odd-exp|odd-dash|odd-dt|odd-push|odd-me|odd-treq|kal-id|kal-pem)$/.test(k) || /^(lk26-|splk-)/.test(k)) localStorage.removeItem(k); }); } catch (e) {}
  };
  window.oddOwner = function (id) { // call right before saving a new sign-in; returns true if the previous person's data was cleared
    const k = String(id || '').toLowerCase().replace(/\s/g, ''); if (!k) return false; const prev = g('sync-owner'); s('sync-owner', k);
    if (prev && prev !== k) { window.oddWipe(); window.__oddReload = true; return true; } return false;
  };
  (function () { const p = g('sync-phone'); if (p && !g('sync-owner')) s('sync-owner', p); })();
  const GRACE = 72 * 36e5;
  let me = null, el = null, mode = 'in', busy = false;
  // ================= v268 GUEST MODE (block 1 of 3: the switch and the state) =================
  // Owner, Nov 16 2026: anyone can browse scores, standings, PGA, Golf GPS and Pickleball without an account; picks and the Lock, Groups and My Bets ask them to
  // sign up. Later the same night: an account whose time has ended is "as guest until they pay" (its data is kept, never wiped).
  // THE SWITCH: /acct/status answers { gate, guest } (odds server env GUEST_MODE, default on; GUEST_MODE=0 = the full sign-in wall exactly as before v268).
  // When the server does not say (an older server), this constant decides.
  const GUEST_MODE = true;
  const CTA = 'Sign up free', PAY = 'Pay now', ENDED = 'Your time has ended. Pay now to unlock your picks, bets and groups.'; // "free" = signing up costs nothing; the sign-up screen itself keeps its own trial / price wording
  window.ODD_CTA = CTA; window.ODD_PAY = PAY; window.ODD_ENDED = ENDED;
  const savedAcct = () => !!(g('sync-phone') && g('sync-pin') && !g('odd-noauto')); // this phone has a number + PIN saved: it is signed in automatically, as before
  const guestOn = () => { const c = g('odd-guest'); return c === '1' ? true : c === '0' ? false : GUEST_MODE; }; // the last answer of the server, else the constant
  let gmode = guestOn(); // is guest mode switched on (as far as this phone knows)
  // lock: '' = signed in and paid up (or no gate at all): everything shows, exactly as before v268. 'guest' = no account. 'expired' = signed in, time has ended.
  // The first value is a guess from what is saved on the phone (the page's own first guess uses the same rule); boot() and setMe() correct it.
  const guess = () => (g('odd-gate') === '0' || !gmode ? '' : g('odd-tok') ? (g('odd-exp') === '1' ? 'expired' : '') : savedAcct() ? '' : 'guest');
  let lock = window.__oddLock === undefined ? guess() : String(window.__oddLock || ''), sheet = false; // sheet: the sign-in / pay screen was opened from a button and has a Back
  window.oddGuest = () => lock !== ''; window.oddLockMode = () => lock;
  function setLock(v) {
    v = v === 'guest' || v === 'expired' ? v : ''; const ch = v !== lock || window.__oddLock !== v; lock = v; window.__oddLock = v; window.__oddGuest = v !== '';
    try { const c = document.documentElement.classList; c.toggle('gst', v !== ''); c.toggle('gexp', v === 'expired'); } catch (e) {}
    hdr(); if (ch) { try { if (window.oddGuestChanged) window.oddGuestChanged(v !== '', v); } catch (e) {} }
  }
  // "?ref=<code>" (a sharing link, for a later build): the first one seen is remembered and sent with the sign-up. No screen shows it.
  const REF_RE = /^[A-Za-z0-9_-]{1,24}$/;
  try { const m = /[?&]ref=([^&#]*)/.exec(location.search); if (m) { const c = decodeURIComponent(m[1]); if (REF_RE.test(c) && !g('odd-ref')) s('odd-ref', c); } } catch (e) {}
  const refOf = () => { const c = g('odd-ref'); return c && REF_RE.test(c) ? c : ''; };
  // ================= end of block 1 =================
  const css = document.createElement('style');
  css.textContent = '#gate{position:fixed;inset:0;z-index:200;background:#0b1220;color:#fff;overflow:auto;-webkit-overflow-scrolling:touch;font:15px/1.4 -apple-system,system-ui,sans-serif;padding:max(20px,env(safe-area-inset-top)) 16px 40px}#gate .gb{max-width:420px;margin:0 auto}#gate h1{font-size:28px;margin:18px 0 4px}#gate p{color:#b8c2d6;margin:6px 0 14px}#gate input{width:100%;box-sizing:border-box;padding:13px;margin:5px 0;border-radius:10px;border:1px solid #33415c;background:#141d30;color:#fff;font-size:16px}#gate button{width:100%;padding:14px;margin:8px 0;border:0;border-radius:11px;font-size:16px;font-weight:700;background:#2f7bff;color:#fff}#gate button.alt{background:#1b2740;color:#cfe0ff;font-weight:600}#gate .er{color:#ff8a8a;min-height:20px;font-size:14px}#gate .ok{color:#7be0a0}#gate .tabs{display:flex;gap:8px;margin:14px 0 6px}#gate .tabs button{margin:0;padding:10px}#gate .tabs button.on{background:#2f7bff;color:#fff}#gate a{color:#8db8ff}#gate .box{background:#141d30;border:1px solid #33415c;border-radius:12px;padding:14px;margin:12px 0}#gate textarea{display:block;width:100%;box-sizing:border-box;min-height:48px;padding:13px;margin:5px 0 2px;border-radius:10px;border:1px solid #33415c;background:#141d30;color:#fff;font:16px/1.3 -apple-system,system-ui,sans-serif;resize:vertical}#gate label{display:block;margin:10px 0 0;font-weight:600}#gate .hl{font-size:13px;color:#8fa0bf;overflow-wrap:anywhere}#gate.gsh .tabs button{min-height:44px}#gback{width:auto!important;min-height:44px;padding:10px 16px!important;margin:0 0 4px!important}#gbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;flex:0 0 100%;margin:6px 0 2px}#gbar button{min-height:40px;border-radius:999px;padding:8px 16px;font:800 14px system-ui;cursor:pointer;margin:0}#gbar .gbp{border:0;background:#2f7bff;color:#fff}#gbar .gbs{border:1px solid currentColor;background:transparent;color:inherit;font-weight:600;font-size:13px;padding:8px 12px;opacity:.9}html.gst header .hrow{padding-right:0!important}html.gst #odiag,html.gst #spset,html.gst #bpset,html.gst #nsw,html.gst #plb,html.gst #bpinv,html.gst #arbbar,html.gst #syncpill{display:none!important}.glk{display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap;border:1px dashed var(--line,#33415c);border-radius:12px;padding:8px 10px;margin:8px 0;background:var(--panel2,#141d30);color:var(--ink,#eef0f4);font:600 14px/1.35 system-ui,sans-serif;box-sizing:border-box;cursor:pointer;text-align:left;min-width:0}.glk .glt{flex:1 1 150px;min-width:0;overflow-wrap:anywhere}.glk .glb{display:flex;gap:8px;flex-wrap:wrap;flex:0 1 auto}.glk button{min-height:40px;border:0;border-radius:10px;padding:8px 14px;margin:0;background:#2f7bff;color:#fff;font:800 14px system-ui,sans-serif;cursor:pointer;width:auto}.glk button.alt{background:transparent;color:inherit;border:1px solid var(--line,#33415c);font-weight:700}.glk.big{padding:14px;margin:12px 0;font-size:15px}#gtoast{position:fixed;top:max(8px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:95;background:#7a4a00;color:#fff;border-radius:10px;padding:8px 12px;font:600 13px system-ui;max-width:92%}';
  document.head.appendChild(css);
  async function call(p, body) {
    const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'Error ' + r.status); e.status = r.status; e.code = j.code; throw e; } return j;
  }
  const $ = (id) => document.getElementById(id);
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function show() { if (el) el.classList.toggle('gsh', sheet); if (!el) { el = document.createElement('div'); el.id = 'gate'; document.body.appendChild(el); document.documentElement.style.overflow = 'hidden'; el.classList.toggle('gsh', sheet); } draw(); }
  function hide() { if (el) { el.remove(); el = null; document.documentElement.style.overflow = ''; } sheet = false; }
  const BACK = '<button id="gback" class="alt" type="button" aria-label="Back">‹ Back</button>'; // v268: only on a screen opened from a button (sheet), never on the wall
  function wireBack() { const b = $('gback'); if (b) b.onclick = closeSheet; }
  function err(t) { const e = $('gerr'); if (e) { e.className = 'er'; e.textContent = t || ''; } }
  function draw() {
    if (!el) return;
    if (!g('odd-tok') || !me) {
      const em = mode === 'ein' || mode === 'eup', up = mode === 'up' || mode === 'eup';
      el.innerHTML = '<div class="gb">' + (sheet ? BACK : '') + '<h1>Oddable</h1><p>Sign in to see picks, locked records and your bets. New accounts get a 7-day free trial.</p>' +
        '<div class="tabs"><button class="' + (!up ? 'on' : 'alt') + '" id="gt-in">Sign in</button><button class="' + (up ? 'on' : 'alt') + '" id="gt-up">Create account</button></div>' +
        (up ? '<input id="gname" placeholder="Name or handle (required)" autocomplete="nickname" maxlength="24">' : '') + (em ? 
          '<input id="gemail" type="email" placeholder="Email" autocomplete="email" autocapitalize="none"><input id="gpw" type="password" placeholder="Password (8+ characters)" autocomplete="' + (up ? 'new-password' : 'current-password') + '">'
          : '<input id="gph" type="tel" inputmode="numeric" placeholder="Cell number" autocomplete="tel"><input id="gpn" type="password" inputmode="numeric" placeholder="PIN (new accounts: 6-10 digits)" autocomplete="off">') +
        '<div class="er" id="gerr"></div><button id="gdo">' + (up ? 'Start free trial' : 'Sign in') + '</button>' +
        '<button id="gsw" class="alt">' + (em ? 'Use cell number + PIN instead' : 'Use email + password instead') + '</button>' +
        '<p style="font-size:13px;color:#8fa0bf;margin:14px 0 0">This app is in development. Credit card payments are coming soon.</p>' +
        '<div class="box"><b>Owner?</b><input id="gpin" type="password" inputmode="numeric" placeholder="Owner PIN" autocomplete="off"><button id="gown" class="alt">Enter with PIN</button></div></div>';
      $('gt-in').onclick = () => { mode = em ? 'ein' : 'in'; draw(); }; $('gt-up').onclick = () => { mode = em ? 'eup' : 'up'; draw(); }; $('gdo').onclick = auth;
      $('gsw').onclick = () => { mode = em ? (up ? 'up' : 'in') : (up ? 'eup' : 'ein'); draw(); };
      const pf = $(em ? 'gpw' : 'gpn'); pf.onkeydown = (e) => { if (e.key === 'Enter') auth(); };
      $('gown').onclick = ownerIn; $('gpin').onkeydown = (e) => { if (e.key === 'Enter') ownerIn(); }; wireBack();
      return;
    }
    const m = me, dl = m.expires_on ? Math.ceil((new Date(m.expires_on + 'T23:59:59') - Date.now()) / 864e5) : 0;
    el.innerHTML = '<div class="gb">' + (sheet ? BACK : '') + '<h1>Subscribe to Oddable</h1><p>' + (m.plan === 'pro' ? (m.expires_on && String(m.expires_on).slice(0, 10) < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()) ? 'Your access ended ' + esc(m.expires_on) + '.' : 'Your renewal is waiting for the owner to confirm. Tap Check again in a bit.') : (m.source === 'trial' ? 'Your free trial has ended.' : 'Your access has ended.')) + ' $' + esc(m.price) + ' per month unlocks everything.</p>' +
      (m.pending ? '<div class="box ok">Payment request received. You will be unlocked as soon as it is confirmed. Tap Check again in a minute.</div>' : '') +
      '<div class="box"><b>Step 1.</b> Send $' + m.price + ' on Cash App' + (m.tag ? ' to <b>' + esc(m.tag) + '</b>' : '') + '.' +
      (/^https:\/\//.test(m.link || '') ? '<button id="gcash">Pay $' + m.price + ' with Cash App</button>' : '<p class="er">Payment is not set up yet. Contact the owner.</p>') +
      '<b>Step 2.</b> Come back and tap below.<label for="gtag">Your Cash App $handle</label><input id="gtag" placeholder="$yourtag" maxlength="21" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" aria-describedby="gtaghl gtagerr" value="' + esc(tagDraft != null ? tagDraft : (m.cashtag || '')) + '"><div class="hl" id="gtaghl">So we can match your payment.</div><div class="er" id="gtagerr" role="alert">' + esc(tagErr) + '</div><button id="gpaid" class="alt">I paid — unlock me</button></div>' +
      '<div class="box"><b>Have a code?</b><input id="gcode" placeholder="Access code" autocapitalize="characters"><button id="gred" class="alt">Redeem code</button></div>' +
      (m.role === 'owner' ? '' : '<div class="box" id="gtime">' + timeHtml('gt', false, true) + '</div>') +
      '<div class="er" id="gerr"></div><button id="gchk" class="alt">Check again</button><button id="gout" class="alt">Sign out</button>' + '<p style="font-size:13px;color:#8fa0bf;margin:14px 0 0">This app is in development. Credit card payments are coming soon.</p>' + '</div>';
    wireBack(); if ($('gcash')) $('gcash').onclick = () => { window.open(m.link, '_blank', 'noopener'); };
    // v263: the payer's Cash App handle goes with "I paid" so the owner can match the payment. Same rule as My Apps; its own message is shown if it still says no.
    const tg = $('gtag'), tagSay = (t) => { tagErr = t || ''; const te = $('gtagerr'); if (te) te.textContent = tagErr; if (tg) tg.setAttribute('aria-invalid', t ? 'true' : 'false'); };
    tg.oninput = () => { tagDraft = tg.value; if (tagErr) tagSay(''); };
    $('gpaid').onclick = async () => {
      if (busy) return; const v = String(tg.value || '').trim(); tagDraft = v;
      if (!v) { tagSay('Enter your Cash App $handle so we can match your payment.'); tg.focus(); return; }
      if (!TAG_RE.test(v)) { tagSay(TAG_MSG); tg.focus(); return; }
      busy = true; tagErr = ''; try { await call('/pay', { cashtag: v }); tagDraft = null; await refresh(true); err(''); } catch (e) { tagErr = e.status ? e.message : 'Could not reach the server. Check your connection and try again.'; } busy = false; draw();
    };
    timeWire('gt');
    $('gred').onclick = async () => { if (busy) return; busy = true; try { const j = await call('/redeem', { code: $('gcode').value }); setMe(j.me); } catch (e) { err(e.message); } busy = false; if (el) draw(); };
    $('gchk').onclick = () => refresh(true).then(() => { const t = trGet(); if (t && t.s === 'pending' && me && !me.allowed) timeCheck(me, true); }).catch((e) => err(e.message)); $('gout').onclick = out;
  }
  // ---- v263: "Request free time" (the owner is alerted in My Apps and answers there) ----
  const TAG_RE = /^\$?[A-Za-z0-9_-]{1,20}$/, TAG_MSG = 'That is not a Cash App tag. Use up to 20 letters, numbers, _ or -, like $yourtag.';
  let tagDraft = null, tagErr = '', noteDraft = '', trMsg = '', trBusy = false, trStop = false, trChecked = false;
  // The last known answer is kept on the phone in 'odd-treq' ({s: pending|granted|declined, d: days, t: time}); wiped on sign-out / user switch.
  const trGet = () => { try { const o = JSON.parse(g('odd-treq') || 'null'); return o && typeof o === 'object' && /^(pending|granted|declined)$/.test(o.s) ? o : null; } catch (e) { return null; } };
  const trSet = (o) => s('odd-treq', o ? JSON.stringify(o) : null);
  const daysLeft = (m) => { if (!m || !m.expires_on) return null; const n = new Date(), d = Math.round((new Date(String(m.expires_on).slice(0, 10) + 'T00:00:00') - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5); return isNaN(d) ? null : d; }; // whole calendar days until the last day (0 = ends today)
  // True when the account's time has ended or ends within 5 days. An account with no end date (everything is free for now) is never "near", so nothing shows.
  const timeNear = (m) => { if (!m || m.role === 'owner') return false; if (!m.allowed) return true; const d = daysLeft(m); return d != null && d <= 5; };
  function trLine() {
    const t = trGet(); if (!t) return ''; if (t.s === 'pending') return '<b>Pending.</b> Request sent. Sir Oddable will answer soon.';
    if (Date.now() - (Number(t.t) || 0) > 7 * 864e5) return ''; // an old answer is not shown for ever
    if (t.s === 'granted') { const d = Math.round(Number(t.d)); return d > 0 ? 'You got ' + d + ' day' + (d === 1 ? '' : 's') + '.' : 'You got more time.'; }
    return 'Not this time.';
  }
  // p = id prefix ('gt' on the subscribe screen, 'at' in the Account box); app = inside the app (uses the app's colours); btn = may ask now.
  function timeHtml(p, app, btn) {
    const t = trGet(), line = trLine(), can = btn && !(t && t.s === 'pending') && !trStop;
    const bs = app ? ' style="min-height:44px;margin:4px 0;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font:700 14px inherit"' : ' class="alt"';
    const ts = app ? ' style="display:block;width:100%;max-width:420px;box-sizing:border-box;min-height:48px;margin:6px 0 2px;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font-family:inherit;font-size:16px;line-height:1.3;resize:vertical"' : '';
    const dim = app ? ' class="sub"' : ' class="hl"';
    return '<div' + (app ? ' class="sub"' : '') + '><b>' + (can ? 'Need more time?' : 'Free time request') + '</b></div>' +
      (line ? '<div id="' + p + '-ln" role="status"' + (app ? ' class="sub" style="margin:4px 0"' : ' class="' + (t && t.s === 'declined' ? 'hl' : 'ok') + '" style="margin:6px 0' + (t && t.s === 'declined' ? ';font-size:15px;color:#cfe0ff' : '') + '"') + '>' + line + '</div>' : '') +
      (can ? '<textarea id="' + p + '-note" maxlength="140" rows="2" placeholder="Add a note (optional)" aria-label="Note for the owner (optional, 140 characters)"' + ts + '>' + esc(noteDraft) + '</textarea>' +
        '<div id="' + p + '-cnt"' + dim + ' style="text-align:right;font-size:12px' + (app ? ';max-width:420px' : '') + '">' + noteDraft.length + '/140</div>' +
        '<button id="' + p + '-go"' + bs + (trBusy ? ' disabled' : '') + '>' + (trBusy ? 'Sending…' : 'Request free time') + '</button>' : '') +
      '<div id="' + p + '-msg" role="status"' + (app ? ' class="sub" style="color:var(--ink);font-weight:600;overflow-wrap:anywhere"' : ' class="er" style="min-height:0"') + '>' + esc(trMsg) + '</div>';
  }
  function timeWire(p) {
    const n = $(p + '-note'), c = $(p + '-cnt'), b = $(p + '-go');
    if (n) n.oninput = () => { if (n.value.length > 140) n.value = n.value.slice(0, 140); noteDraft = n.value; if (c) c.textContent = n.value.length + '/140'; };
    if (b) b.onclick = timeSend;
  }
  // Repaints only the two request boxes, so nothing else typed on the screen is lost.
  function timePaint() { const c = $('gtime'); if (c && me) { c.innerHTML = timeHtml('gt', false, true); timeWire('gt'); } drawAcct(); }
  async function timeSend() {
    if (trBusy || !g('odd-tok')) return; trBusy = true; trMsg = ''; timePaint(); const note = noteDraft.replace(/\s+/g, ' ').trim().slice(0, 140);
    try { const j = await call('/time/request', note ? { note: note } : {}); if (j && j.ok) { trSet({ s: 'pending', t: Date.now() }); noteDraft = ''; } else trMsg = 'Requests are not open right now.'; }
    catch (e) { if (e.code === 'limit') trStop = true; trMsg = !e.status ? 'Could not send your request. Check your connection and try again.' : (e.code || e.status === 429 || e.status === 401) ? e.message : 'Could not send your request. Please try again later.'; }
    trBusy = false; timePaint(); // one try per tap: no automatic retry
  }
  // One status read per app open, and only when this phone has a request waiting or the account is ending / has ended. The answer is kept in 'odd-treq'.
  async function timeCheck(m, force) {
    if (!m || m.role === 'owner' || !g('odd-tok')) return; const t = trGet(), was = t && t.s;
    if (!force && (trChecked || !(was === 'pending' || timeNear(m)))) return; trChecked = true;
    let j; try { j = await call('/time/status', {}); } catch (e) { return; } if (!j || !j.ok) return;
    if (j.status === 'none') trSet(null); else if (/^(pending|granted|declined)$/.test(j.status)) trSet({ s: j.status, d: Number(j.days) > 0 ? Number(j.days) : null, t: Date.parse(j.decided_at || j.requested_at || '') || Date.now() }); else return;
    timePaint();
    if (was === 'pending' && j.status === 'granted' && m.allowed === false && me === m) refresh().catch(() => {}); // the days are on the account already: re-check once so the app opens without a reload
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
        if (up && String(($('gname') || {}).value || '').trim().length < 2) { err('Enter a name or handle (2+ characters).'); busy = false; if (b) b.textContent = 'Start free trial'; return; }
        j = await call('/phone', Object.assign({ phone: ph, pin: pn, create: up, name: up && $('gname') ? $('gname').value : '' }, up && refOf() ? { ref: refOf() } : {})); // v268: + the remembered sharing code, on sign-up only
        const np = ph.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1'); window.oddOwner(np);
        s('sync-phone', np); s('sync-pin', pn);
      } else { if (up && String(($('gname') || {}).value || '').trim().length < 2) { err('Enter a name or handle (2+ characters).'); busy = false; if (b) b.textContent = 'Start free trial'; return; } j = await call('/' + (up ? 'register' : 'login'), Object.assign({ email: $('gemail').value, password: $('gpw').value, name: up && $('gname') ? $('gname').value : '' }, up && refOf() ? { ref: refOf() } : {})); window.oddOwner('e:' + String($('gemail').value || '')); s('sync-phone', null); s('sync-pin', null); }
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
    me = m; if (!m) return; setTimeout(drawAcct, 0); setTimeout(() => timeCheck(m), 0); try { const dg = document.getElementById('odiag'); if (dg) dg.textContent = (m.ownerDash || (m.role === 'owner' && m.source === 'owner')) ? ' · acct ' + (m.role || '?') + (m.ownerDash ? '+dash' : '') + ' ' + String(m.email || '').slice(-8) : ''; s('odd-dash', (m.role === 'owner' && m.source === 'owner') || m.ownerDash ? '1' : null); if (window.navRender) setTimeout(window.navRender, 0); } catch (e) {}
    if (m.allowed) { s('odd-ok', String(Date.now())); s('odd-exp', null); hide(); setLock(''); afterRun(); soon(m); setTimeout(namePrompt, 1200); }
    else if (gmode) { s('odd-exp', '1'); setLock('expired'); if (el && sheet) draw(); else hide(); } // v268: time has ended = browse as a guest, everything of theirs locked until paid (nothing is wiped). The pay screen stays up only when they opened it.
    else show(); // GUEST_MODE=0: the subscribe wall, as before
  }
  // Everyone needs a name or handle. New accounts type one at sign-up; accounts made before that get asked once.
  async function namePrompt() {
    if (!g('odd-tok') || g('odd-name') || document.getElementById('gnm') || !g('sync-phone')) return;
    let cur = ''; try { cur = (await call('/myname', {})).name || ''; } catch (e) { return; }
    if (cur) { s('odd-name', cur); return; }
    const o = document.createElement('div'); o.id = 'gnm'; o.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(5,10,20,.92);display:flex;align-items:center;justify-content:center;padding:20px;font:15px/1.4 -apple-system,system-ui,sans-serif;color:#fff';
    o.innerHTML = '<div style="max-width:380px;width:100%;background:#13203a;border:1px solid #2b3f66;border-radius:16px;padding:18px"><b style="font-size:18px">Pick a name or handle</b><p style="color:#8fa0bf;margin:8px 0">Every Oddable player needs one. It is how you show up in your account and to the owner.</p><input id="gnmi" placeholder="Name or handle" maxlength="24" autocapitalize="words" style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2b3f66;background:#0b1220;color:#fff;font-size:16px"><div id="gnme" style="color:#ff6b6b;min-height:18px;font-size:13px;margin:6px 0"></div><button id="gnms" style="width:100%;padding:12px;border-radius:10px;border:0;background:#7c3aed;color:#fff;font-size:16px;font-weight:700">Save</button></div>';
    document.body.appendChild(o); const go = async () => { const v = ($('gnmi').value || '').trim(); if (v.length < 2) { $('gnme').textContent = 'Enter at least 2 characters.'; return; } try { const j = await call('/myname', { name: v }); s('odd-name', j.name || v); o.remove(); } catch (e) { $('gnme').textContent = e.message; } };
    $('gnms').onclick = go; $('gnmi').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }
  function soon(m) {
    if (m.role === 'owner' || !m.expires_on) return; const d = Math.ceil((new Date(m.expires_on + 'T23:59:59') - Date.now()) / 864e5);
    if (d <= 3 && d >= 0 && !document.getElementById('gtoast')) { const t = document.createElement('div'); t.id = 'gtoast'; t.textContent = (m.source === 'trial' ? 'Free trial' : 'Subscription') + ' ends ' + (d === 0 ? 'today' : 'in ' + d + ' day' + (d > 1 ? 's' : '')) + ' — tap to renew'; t.onclick = () => { me = Object.assign({}, m, { allowed: false }); sheet = gmode; show(); t.remove(); }; document.body.appendChild(t); setTimeout(() => t.remove(), 9000); }
  }
  function out() { s('odd-noauto', '1'); s('odd-tok', null); s('odd-ok', null); s('odd-exp', null); s('odd-push', null); s('sync-phone', null); s('sync-pin', null); s('sync-owner', null); window.oddWipe(); me = null; mode = 'in'; location.reload(); }
  async function refresh(force) {
    let j; try { j = await call('/me'); } catch (e) { const dg = document.getElementById('odiag'); if (dg && g('odd-dash') === '1') dg.textContent = ' · acct check failed: ' + (e.message || e.status); throw e; } setMe(j.me); return j.me;
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
      '<div class="sub" id="acct-st"></div>' + (!owner && (timeNear(me) || trLine()) ? '<div id="acct-time" style="margin:8px 0;padding:8px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">' + timeHtml('at', true, timeNear(me)) + '</div>' : '') + '<button id="acct-out" style="min-height:44px;margin-top:6px;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font:700 14px inherit">Sign out</button>';
    const em = $('acct-em'); if (em) em.textContent = me.email || ''; const pb = $('acct-push'); if (pb) pb.onclick = pushOn; const db = $('acct-dash'); if (db) db.onclick = () => { if (window.oddDash) window.oddDash(); }; $('acct-out').onclick = out; timeWire('at');
  }
  window.gateAcct = drawAcct;
  // Header fetch hook: attach the token to AI calls.
  const of = window.fetch; window.fetch = function (u, o) { try { if (String(u).indexOf('/ai/') > -1 && g('odd-tok')) { o = Object.assign({}, o); o.headers = Object.assign({}, o.headers, { 'x-token': g('odd-tok') }); } } catch (e) {} return of.call(this, u, o); };
  // ================= v268 GUEST MODE (block 2 of 3: buttons, the sign-up / pay sheet, the hook) =================
  // Header buttons. A guest: "Sign up free" + a smaller "Sign in". Time ended: "Pay now". Anyone else: nothing (the account diagnostic stays as it was).
  function hdr() {
    try {
      let b = $('gbar'); const dg = $('odiag'); if (!lock) { if (b) b.remove(); return; }
      const h = document.querySelector('header'); if (!h) return;
      if (!b) { b = document.createElement('div'); b.id = 'gbar'; const row = dg && dg.parentNode, hb = h.querySelector('.hbt'); if (row && row.parentNode) row.parentNode.insertBefore(b, row.nextSibling); else (hb || h).appendChild(b); }
      if (b.dataset.m === lock) return; b.dataset.m = lock;
      b.innerHTML = lock === 'expired' ? '<button type="button" class="gbp" id="gb-pay">' + PAY + '</button>' : '<button type="button" class="gbp" id="gb-up">' + CTA + '</button><button type="button" class="gbs" id="gb-in">Sign in</button>';
      if ($('gb-pay')) $('gb-pay').onclick = () => window.oddSignUp('', 'pay'); if ($('gb-up')) $('gb-up').onclick = () => window.oddSignUp('', 'up'); if ($('gb-in')) $('gb-in').onclick = () => window.oddSignUp('', 'in');
    } catch (e) {}
  }
  // afterSignIn(target): THE HOOK. Each page may define window.afterSignIn(target); it is called once the person who tapped a locked thing is signed in (or has paid),
  // with the target that was passed to oddSignUp(target). Targets used today: '' (header), 'pick:<game id>', 'alert', 'props', 'bets', 'add', 'bet:<game id>', 'watch:<game id>',
  // 'ai', 'ai:<game id>', 'surv', 'view:<stats|results|rest|best>', 'team:<abbr>', 'fv:<game id>', 'golf'. GROUPS PHASE 2: open an invite / preview link with
  // oddSignUp('group:<type>:<code>') and continue to the invite in afterSignIn. The target survives a reload (sessionStorage 'odd-after').
  const AK = 'odd-after';
  function afterRun() { let t = null; try { t = sessionStorage.getItem(AK); } catch (e) {} if (t === null || window.__oddReload) return; try { sessionStorage.removeItem(AK); } catch (e) {} setTimeout(() => { try { if (window.afterSignIn) window.afterSignIn(t); } catch (e) {} }, 0); }
  function closeSheet() { try { sessionStorage.removeItem(AK); } catch (e) {} const fake = me && me.allowed === false && lock === ''; hide(); if (fake) refresh().catch(() => {}); /* the "ends soon" toast showed the pay screen for an account that is still good */ }
  // Opens the sign-up screen ('up', the default), the sign-in screen ('in') or, for an account whose time has ended, the pay screen ('pay'; 'time' = scrolled to
  // "Request free time"), as a full-screen sheet with ‹ Back. Somebody who is already signed in and paid up goes straight to the hook.
  window.oddSignUp = function (target, m) {
    try { sessionStorage.setItem(AK, String(target || '')); } catch (e) {}
    if (!lock) { if (g('odd-tok') || g('odd-gate') === '0') { afterRun(); return; } }
    if (g('odd-tok') && (lock === 'expired' || me)) { // signed in: the pay screen
      sheet = true; show(); if (!me) { el.innerHTML = '<div class="gb">' + BACK + '<h1>Oddable</h1><p>Checking your account…</p><div class="er" id="gerr"></div></div>'; wireBack(); refresh().then(() => { if (el && me && !me.allowed) { sheet = true; draw(); } }).catch((e) => { if (e.status === 401) out(); else err('Could not reach the server. It may be waking up. Go back and try again.'); }); return; }
      if (m === 'time') { const t = $('gtime'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start' }); } return;
    }
    mode = m === 'in' ? 'in' : 'up'; sheet = true; show();
  };
  window.oddPay = () => window.oddSignUp('', 'pay');
  // Every locked card on every page: <div class="glk" data-gt="<target>">…<button>…</button></div>. One listener; a tap anywhere on the card opens the sheet.
  document.addEventListener('click', (e) => { const c = e.target && e.target.closest ? e.target.closest('[data-gt]') : null; if (!c) return; e.preventDefault(); e.stopPropagation(); const b = e.target.closest('[data-gp]'); window.oddSignUp(c.getAttribute('data-gt') || '', lock === 'expired' ? ((b && b.getAttribute('data-gp')) || 'pay') : 'up'); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el && sheet) closeSheet(); });
  // Functions that live in other files (loaded after this one) and must ask for an account first.
  function guard(name, target) { const f = window[name]; if (typeof f !== 'function' || f.__gst) return; const w = function () { if (lock) { window.oddSignUp(typeof target === 'function' ? target.apply(null, arguments) : target); return undefined; } return f.apply(this, arguments); }; w.__gst = true; try { window[name] = w; } catch (e) {} }
  const guards = () => { guard('aiOpen', (gid) => 'ai' + (gid && typeof gid !== 'object' ? ':' + gid : '')); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', guards); else setTimeout(guards, 0);
  // ================= end of block 2 =================
  // ================= v268 GUEST MODE (block 3 of 3: what happens on open) =================
  const WAKING = '<div class="gb"><h1>Oddable</h1><p class="er">Could not reach the server. It may be waking up.</p><button id="gretry">Try again</button></div>';
  const waking = () => { show(); if (el) { el.innerHTML = WAKING; const rb = $('gretry'); if (rb) rb.onclick = () => location.reload(); } };
  async function status() { // -> true / false = is the gate on; throws when the server cannot be reached
    const r = await fetch(API + '/status', { cache: 'no-store', signal: AbortSignal.timeout(12000) }), j = await r.json(); const on = j.gate === true; s('odd-gate', on ? '1' : '0');
    if (typeof j.guest === 'boolean') { gmode = j.guest; s('odd-guest', gmode ? '1' : '0'); } else { gmode = GUEST_MODE; s('odd-guest', null); } // an older server does not say: the constant decides
    return on;
  }
  async function boot() {
    setLock(lock); guards();
    const open = !!window.ODD_OPEN_PAGE; // a page that never had the wall (Pickleball): it only gets the header buttons, and does nothing at all for a phone with an account
    if (open && (g('odd-tok') || savedAcct())) { setLock(''); return; }
    let on = false, sfail = false;
    try { on = await status(); }
    catch (e) {
      const k = g('odd-gate'); sfail = true;
      if (!g('odd-tok') && !savedAcct()) { // v268: no account on this phone and the server cannot be reached: browse as a guest (scores only) instead of the "Could not reach the server" wall
        if (gmode && k !== '0') { setLock('guest'); let n = 0; const again = () => status().then((o) => { if (!o) setLock(''); else if (!gmode && !open) { setLock(''); show(); } }).catch(() => { if (++n < 4) setTimeout(again, 20000); }); setTimeout(again, 20000); return; }
        if (open) { setLock(''); return; }
      }
      if (k === null) { setLock(''); waking(); return; } on = k === '1'; // a phone WITH an account: as before
    }
    if (!on) { setLock(''); return; }
    if (open) { setLock(gmode ? 'guest' : ''); return; }
    if (!g('odd-tok')) {
      if (savedAcct()) { setLock(''); show(); $('gate').innerHTML = '<div class="gb"><h1>Oddable</h1><p>Signing you in…</p></div>'; if (await autoPhone()) return; if (gmode && !sfail) { setLock('guest'); mode = 'in'; sheet = true; draw(); return; } show(); return; } // the saved PIN no longer works: the sign-in screen, with a Back to guest browsing (server unreachable: the plain sign-in wall, as before)
      if (gmode) { setLock('guest'); return; } // v268: NO WALL. A visitor with no account lands in the app as a guest.
      setLock(''); show(); return; // GUEST_MODE=0: the sign-in wall, as before
    }
    if (!gmode && lock) setLock(''); // GUEST_MODE=0: nobody browses locked; the checks below put up the wall where it belongs
    // Offline / server asleep: keep working for 72h after the last successful check.
    const lastOk = Number(g('odd-ok') || 0), ended = gmode && g('odd-exp') === '1'; // ended: this account's time had run out the last time we looked; it browses as a guest while we look again (no cover, no wall)
    if (ended || (lastOk && Date.now() - lastOk < GRACE)) { const again = (n) => refresh().catch((e) => { if (e.status === 401) out(); else if (n < 4) setTimeout(() => again(n + 1), 20000); }); again(0); return; } // retry while the server redeploys
    show(); $('gate').innerHTML = '<div class="gb"><h1>Oddable</h1><p>Checking your account…</p></div>';
    refresh().catch((e) => { if (e.status === 401) out(); else waking(); });
  }
  // ================= end of block 3 =================
  // Cover the app immediately to avoid a flash of content when a token exists and the gate is on.
  if (g('odd-gate') === '1' && !(g('odd-tok') && Date.now() - Number(g('odd-ok') || 0) < GRACE)) { document.addEventListener('DOMContentLoaded', () => {}); }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
