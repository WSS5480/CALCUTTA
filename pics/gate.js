// Oddable sign-in wall + $99/month subscription (Cash App). Owner is free. Fail-open if the server has no gate configured.
// v268: GUEST MODE. No wall on open: a visitor with no account (and an account whose time has ended) browses the open things; picks, My Bets and Groups show a
// locked card that opens this file's sign-up / pay screen as a sheet with a Back. Switch: /acct/status `guest` (env GUEST_MODE on the odds server). See "v268 GUEST MODE" below.
// v271: every account has an email + password as well as the cell number + PIN (sign-up asks for both; older accounts get a reminder card), "Lost my password" /
// "Lost my PIN" by a code emailed from My Apps, and Share Oddable with the person's share / influencer code. See the "v271" block below and HANDOFF "## v271".
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
    try { const ks = []; for (let i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i)); ks.forEach((k) => { if (/^(bets26|betlog26|logat26|pinsat26|pinned26|kdel26|plbhtml26|surv26|sync-ids|sync-tomb|sync-last|sync-err|sync-rl|odd-ok|odd-exp|odd-dash|odd-dt|odd-push|odd-me|odd-treq|odd-stok|odd-eml|odd-myref|odd-grp|odd-gbl|kal-id|kal-pem)$/.test(k) || /^(lk26-|splk-)/.test(k)) localStorage.removeItem(k); }); } catch (e) {}
  };
  // v271: `acct` (optional) = the account id the server answered with. The same person can now sign in two ways on one phone (cell number + PIN, or email +
  // password: two different `id`s, one account), so the sign-in is the same person when EITHER the id or the account matches the last one. Called with one
  // argument (sync.js) it behaves exactly as before.
  window.oddOwner = function (id, acct) { // call right before saving a new sign-in; returns true if the previous person's data was cleared
    const k = String(id || '').toLowerCase().replace(/\s/g, ''); if (!k) return false; const a = String(acct || '').toLowerCase(), prev = g('sync-owner'), pa = g('odd-oacct'); s('sync-owner', k); s('odd-oacct', a || null);
    if (prev && prev !== k && !(pa && a && pa === a)) { window.oddWipe(); window.__oddReload = true; return true; } return false;
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
    hdr(); if (ch) { try { if (window.oddGuestChanged) window.oddGuestChanged(v !== '', v); } catch (e) {} } try { emCard(); } catch (e) {}
  }
  // "?ref=<code>" (a sharing link, for a later build): the first one seen is remembered and sent with the sign-up. No screen shows it.
  const REF_RE = /^[A-Za-z0-9_-]{1,24}$/;
  try { const m = /[?&]ref=([^&#]*)/.exec(location.search); if (m) { const c = decodeURIComponent(m[1]); if (REF_RE.test(c) && !g('odd-ref')) s('odd-ref', c); } } catch (e) {}
  const refOf = () => { const c = g('odd-ref'); return c && REF_RE.test(c) ? c : ''; };
  // ================= end of block 1 =================
  const css = document.createElement('style');
  css.textContent = '#gate{position:fixed;inset:0;z-index:200;background:#0b1220;color:#fff;overflow:auto;-webkit-overflow-scrolling:touch;font:15px/1.4 -apple-system,system-ui,sans-serif;padding:max(20px,env(safe-area-inset-top)) 16px 40px}#gate .gb{max-width:420px;margin:0 auto}#gate h1{font-size:28px;margin:18px 0 4px}#gate p{color:#b8c2d6;margin:6px 0 14px}#gate input{width:100%;box-sizing:border-box;padding:13px;margin:5px 0;border-radius:10px;border:1px solid #33415c;background:#141d30;color:#fff;font-size:16px}#gate button{width:100%;padding:14px;margin:8px 0;border:0;border-radius:11px;font-size:16px;font-weight:700;background:#2f7bff;color:#fff}#gate button.alt{background:#1b2740;color:#cfe0ff;font-weight:600}#gate .er{color:#ff8a8a;min-height:20px;font-size:14px}#gate .ok{color:#7be0a0}#gate .tabs{display:flex;gap:8px;margin:14px 0 6px}#gate .tabs button{margin:0;padding:10px}#gate .tabs button.on{background:#2f7bff;color:#fff}#gate a{color:#8db8ff}#gate .box{background:#141d30;border:1px solid #33415c;border-radius:12px;padding:14px;margin:12px 0}#gate textarea{display:block;width:100%;box-sizing:border-box;min-height:48px;padding:13px;margin:5px 0 2px;border-radius:10px;border:1px solid #33415c;background:#141d30;color:#fff;font:16px/1.3 -apple-system,system-ui,sans-serif;resize:vertical}#gate label{display:block;margin:10px 0 0;font-weight:600}#gate .hl{font-size:13px;color:#8fa0bf;overflow-wrap:anywhere}#gate.gsh .tabs button{min-height:44px}#gback{width:auto!important;min-height:44px;padding:10px 16px!important;margin:0 0 4px!important}#gbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;flex:0 0 100%;margin:6px 0 2px}#gbar button{min-height:40px;border-radius:999px;padding:8px 16px;font:800 14px system-ui;cursor:pointer;margin:0}#gbar .gbp{border:0;background:#2f7bff;color:#fff}#gbar .gbs{border:1px solid currentColor;background:transparent;color:inherit;font-weight:600;font-size:13px;padding:8px 12px;opacity:.9}html.gst header .hrow{padding-right:0!important}html.gst #odiag,html.gst #spset,html.gst #bpset,html.gst #nsw,html.gst #plb,html.gst #bpinv,html.gst #arbbar,html.gst #syncpill{display:none!important}.glk{display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap;border:1px dashed var(--line,#33415c);border-radius:12px;padding:8px 10px;margin:8px 0;background:var(--panel2,#141d30);color:var(--ink,#eef0f4);font:600 14px/1.35 system-ui,sans-serif;box-sizing:border-box;cursor:pointer;text-align:left;min-width:0}.glk .glt{flex:1 1 150px;min-width:0;overflow-wrap:anywhere}.glk .glb{display:flex;gap:8px;flex-wrap:wrap;flex:0 1 auto}.glk button{min-height:40px;border:0;border-radius:10px;padding:8px 14px;margin:0;background:#2f7bff;color:#fff;font:800 14px system-ui,sans-serif;cursor:pointer;width:auto}.glk button.alt{background:transparent;color:inherit;border:1px solid var(--line,#33415c);font-weight:700}.glk.big{padding:14px;margin:12px 0;font-size:15px}#gate .gf label{margin:8px 0 0}#gate .gf .opt{font-weight:400;color:#8fa0bf}#gate .fe{min-height:0;font-size:13px;margin:0 0 2px;overflow-wrap:anywhere}#gate .pwr{display:flex;gap:8px;align-items:stretch}#gate .pwr input{flex:1 1 auto;min-width:0}#gate .pwr .shw{flex:0 0 auto;width:auto;min-width:68px;min-height:44px;margin:5px 0;padding:0 12px;font-size:14px}#gate .msk{-webkit-text-security:disc}#gate button.lnk{background:none;color:#8db8ff;font-weight:600;font-size:15px;min-height:44px;padding:10px 8px;margin:2px 0;text-decoration:underline}#gate button:disabled{opacity:.6}#gate form.box b,#gate .box>b{font-size:16px}#gate .box p{margin:6px 0 8px}#gate .gb.gw{max-width:520px}#gate .g2>*{min-width:0}@media(min-width:760px){#gate .gb.gw{max-width:720px}#gate .g2{display:grid;grid-template-columns:1fr 1fr;gap:0 18px;align-items:start}#gate .g2b .box{margin:6px 0}}@media(min-width:900px){#gate .gb.gw{max-width:1200px}}@media(min-width:1500px){#gate .gb.gw{max-width:1360px}}#emc{background:var(--panel,#121a33);color:var(--ink,#eee);border:1px solid var(--line,#fff3);border-left:5px solid #2fb37a;border-radius:14px;padding:12px 14px;margin:10px 0 12px;font:15px/1.4 system-ui,-apple-system,sans-serif;text-align:left;min-width:0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere}#emc .emt{font-weight:700}#emc .emb{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}#emc button{min-height:44px;min-width:44px;padding:8px 16px;border-radius:10px;font:700 14px system-ui,-apple-system,sans-serif;cursor:pointer;margin:0;border:1px solid #2f66c9;background:#0b3d91;color:#fff}#emc button.alt{background:var(--panel2,#1a2340);border-color:var(--line,#fff3);color:var(--ink,#eee)}html.gst #emc{display:none!important}#gtoast{position:fixed;top:max(8px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:95;background:#7a4a00;color:#fff;border-radius:10px;padding:8px 12px;font:600 13px system-ui;max-width:92%}';
  document.head.appendChild(css);
  async function call(p, body) {
    const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'Error ' + r.status); e.status = r.status; e.code = j.code; throw e; } return j;
  }
  const $ = (id) => document.getElementById(id);
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function show() { if (el) el.classList.toggle('gsh', sheet); if (!el) { el = document.createElement('div'); el.id = 'gate'; document.body.appendChild(el); document.documentElement.style.overflow = 'hidden'; el.classList.toggle('gsh', sheet); } draw(); }
  function hide() { if (el) { el.remove(); el = null; document.documentElement.style.overflow = ''; } sheet = false; scr = ''; }
  const BACK = '<button id="gback" class="alt" type="button" aria-label="Back">‹ Back</button>'; // v268: only on a screen opened from a button (sheet), never on the wall. v270: v267's "← Back to Oddable" is this button too
  const BACK0 = '<button id="gback" class="alt" style="width:auto;min-height:44px;padding:10px 16px;margin:0!important">← Back to Oddable</button>'; // GUEST_MODE=0: the v267-v269 button, letter for letter (only the early pay screen has a Back there)
  function wireBack() { const b = $('gback'); if (b) b.onclick = closeSheet; }
  function err(t) { const e = $('gerr'); if (e) { e.className = 'er'; e.textContent = t || ''; } }
  // ================= v271: email + password on every account, lost PIN / lost password, share code =================
  // Owner, Nov 16-17 2026: "All sign ups have an email login and a password and a PIN option, with lost my PIN or password option." + influencer codes.
  // WHAT AN ACCOUNT IS: the bets live on the server in ONE row keyed by the cell number; the PIN opens it. So a new account is still made with cell number + PIN
  // (/acct/phone, unchanged), and the email + password is ATTACHED to that same account (My Apps `link`: a 6-digit code is mailed, /acct/link then /acct/link/verify).
  // Signing in with the email + password then opens the same account, and this phone syncs the bets with its sign-in token instead of the PIN ('odd-stok').
  // Mail may not be switched on in My Apps yet (`nomail`): every screen says so in plain words and nothing ever stops there.
  // Kept on the phone: 'odd-way' (last sign-in way), 'odd-stok' (sync by token), 'odd-eml' ({a,e,h,st,up,open}: an email waiting to be confirmed; never a password),
  // 'odd-emc' ({a,n,t}: the reminder card's "Not now"), 'odd-myref' ({a,r,t}: my share code, 1 hour), 'odd-refat' (the account a remembered code was sent for).
  const EM_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,}$/, PH_ACCT = /^[0-9a-f]{20}@phone\.oddable$/;
  const NOMAIL_UP = "Email isn't switched on yet. Your account works with your cell number and PIN. We'll ask you to confirm your email later.";
  const NOMAIL_LOST = "Email isn't switched on yet. Ask Sir Oddable to reset it for you.";
  const WHY = 'Your cell number and PIN are needed: your bets are saved under them, and they sign you in fast on this phone. Your email and password get you back in if you lose the PIN.';
  let scr = '', F = {}, FE = {}, notice = '', LX = null, EX = null, rsAt = 0, reB = false;
  const jget = (k) => { try { const o = JSON.parse(g(k) || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } };
  const digits = (x) => String(x || '').replace(/\D/g, '');
  const way = () => (g('odd-way') === 'email' ? 'email' : 'phone');
  // One field: label above, the box, an optional hint, and its own error line right under it. o.pw adds Show / Hide; o.msk hides the digits of a NEW PIN without
  // making it a password box (so a password manager saves the email + password, not the PIN).
  function fld(id, label, attrs, o) {
    o = o || {}; const inp = '<input id="' + id + '" data-f="' + id + '" ' + attrs + ' aria-describedby="' + id + '-e"' + (FE[id] ? ' aria-invalid="true"' : '') + ' value="' + esc(F[id] || '') + '"' + (o.msk ? ' class="msk" data-msk="1"' : '') + '>';
    return '<div class="gf"><label for="' + id + '">' + label + '</label>' + (o.pw ? '<div class="pwr">' + inp + '<button type="button" class="alt shw" data-shw="' + id + '" aria-pressed="false" aria-label="Show ' + (o.what || 'password') + '">Show</button></div>' : inp) +
      '<div class="er fe" id="' + id + '-e" role="alert">' + esc(FE[id] || '') + '</div>' + (o.hint ? '<div class="hl">' + o.hint + '</div>' : '') + '</div>';
  }
  const EMAIL_AT = 'type="email" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="200"';
  const CODE_AT = 'type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code"';
  const NEWPIN_AT = 'type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="10"';
  function wireF() {
    if (!el) return;
    el.querySelectorAll('input[data-f]').forEach((i) => { i.oninput = () => { const k = i.getAttribute('data-f'); F[k] = i.value; if (FE[k]) { FE[k] = ''; const e = $(k + '-e'); if (e) e.textContent = ''; i.removeAttribute('aria-invalid'); } }; });
    el.querySelectorAll('button[data-shw]').forEach((b) => { b.onclick = () => { const i = $(b.getAttribute('data-shw')); if (!i) return; const m = i.hasAttribute('data-msk'), on = m ? i.classList.contains('msk') : i.type === 'password'; if (m) i.classList.toggle('msk', !on); else i.type = on ? 'text' : 'password'; b.textContent = on ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); }; });
    el.querySelectorAll('form').forEach((f) => { f.onsubmit = (e) => { e.preventDefault(); const b = f.querySelector('button[data-go]'); if (b) b.click(); }; });
  }
  // Errors next to the field: fe({gemail:'…'}) marks the fields and puts the cursor in the first; a plain string goes to the line above the button.
  function fe(o) { FE = Object.assign({}, o); draw(); const k = Object.keys(o)[0], i = k && $(k); if (i && i.focus) { try { i.focus(); } catch (e) {} } }
  const netMsg = (e) => (e && e.status ? e.message : 'Could not reach the server. Check your connection and try again.');
  // ---- signed out: the sign-in sheet (two ways), the sign-up sheet, lost my password / PIN ----
  const HEAD = () => '<h1>Oddable</h1><p>Sign in to see picks, locked records and your bets. New accounts get a 7-day free trial.</p>';
  const DEVNOTE = '<p style="font-size:13px;color:#8fa0bf;margin:14px 0 0">This app is in development. Credit card payments are coming soon.</p>';
  const OWNERBOX = '<div class="box"><b>Owner?</b><input id="gpin" type="password" inputmode="numeric" placeholder="Owner PIN" autocomplete="off" aria-label="Owner PIN"><button id="gown" class="alt" type="button">Enter with PIN</button></div>';
  function drawOut() {
    if (scr && !/^lost[12]$/.test(scr)) scr = '';
    const back = sheet || scr ? BACK : '';
    if (scr) { drawLost(back); return; }
    const up = mode === 'up';
    const tabs = '<div class="tabs"><button type="button" class="' + (!up ? 'on' : 'alt') + '" id="gt-in">Sign in</button><button type="button" class="' + (up ? 'on' : 'alt') + '" id="gt-up">Create account</button></div>';
    const note = notice ? '<div class="box ok" id="gnote" role="status">' + esc(notice) + '</div>' : '';
    let h;
    if (up) {
      if (F.gref == null) F.gref = refOf();
      h = '<form id="gfu" novalidate><div class="g2">' +
        '<div>' + fld('gname', 'Name or handle', 'autocomplete="nickname" maxlength="24" placeholder="How you show up in Oddable"') +
        fld('gemail', 'Email', EMAIL_AT + ' autocomplete="email" placeholder="you@example.com"') +
        fld('gpw', 'Password', 'type="password" autocomplete="new-password" maxlength="200" placeholder="8 or more characters"', { pw: 1 }) + '</div>' +
        '<div>' + fld('gph', 'Cell number', 'type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="(956) 555-1234"') +
        fld('gpn', 'PIN', NEWPIN_AT + ' placeholder="6 to 10 digits"', { msk: 1, pw: 1, what: 'PIN', hint: WHY }) +
        fld('gref', 'Have a code? <span class="opt">(optional)</span>', 'autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="24" placeholder="Friend or influencer code"') + '</div>' +
        '</div><div class="er" id="gerr" role="alert"></div><button id="gdo" data-go="1" type="submit">Start free trial</button></form>';
    } else {
      const fe_ = '<form class="box" id="gfe" novalidate><b>Email and password</b>' +
        fld('gemail', 'Email', EMAIL_AT + ' autocomplete="username" placeholder="you@example.com"') +
        fld('gpw', 'Password', 'type="password" autocomplete="current-password" maxlength="200"', { pw: 1 }) +
        '<button id="gdoe" data-go="1" type="submit">Sign in</button><button type="button" class="lnk" id="glpw">Lost my password</button></form>';
      const fp = '<form class="box" id="gfp" novalidate><b>Cell number and PIN</b>' +
        fld('gph', 'Cell number', 'type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="(956) 555-1234"') +
        fld('gpn', 'PIN', 'type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="10"') +
        '<button id="gdo" data-go="1" type="submit">Sign in</button><button type="button" class="lnk" id="glpin">Lost my PIN</button></form>';
      h = '<div class="g2 g2b">' + (way() === 'email' ? fe_ + fp : fp + fe_) + '</div><div class="er" id="gerr" role="alert"></div>';
    }
    el.innerHTML = '<div class="gb gw">' + back + HEAD() + tabs + note + h + DEVNOTE + OWNERBOX + '</div>';
    $('gt-in').onclick = () => { mode = 'in'; FE = {}; draw(); }; $('gt-up').onclick = () => { mode = 'up'; FE = {}; draw(); };
    if (up) $('gdo').onclick = signUp; else { $('gdo').onclick = () => signIn('phone'); $('gdoe').onclick = () => signIn('email'); $('glpw').onclick = () => lostOpen('password'); $('glpin').onclick = () => lostOpen('pin'); }
    $('gown').onclick = ownerIn; $('gpin').onkeydown = (e) => { if (e.key === 'Enter') ownerIn(); }; wireBack(); wireF();
  }
  const btnBusy = (id, t) => { const b = $(id); if (b) { if (t) { b.dataset.t = b.dataset.t || b.textContent; b.textContent = t; b.disabled = true; } else { if (b.dataset.t) b.textContent = b.dataset.t; b.disabled = false; } } };
  // Saves a finished sign-in. k = who this is on the phone (cell number, or 'e:<email>'); j = the server's { token, me }. true = the page is reloading (another person's data was cleared).
  function signedIn(j, k, o) {
    o = o || {}; const acct = String((j.me && j.me.email) || '').toLowerCase();
    window.oddOwner(k || 'a:' + acct, acct);
    if (o.phone) { s('sync-phone', o.phone); s('sync-pin', o.pin); s('odd-stok', null); } else { s('sync-phone', null); s('sync-pin', null); s('odd-stok', PH_ACCT.test(acct) ? '1' : null); } // no PIN on this phone: the bets sync with the sign-in token (sync.js)
    if (o.way) s('odd-way', o.way);
    s('odd-tok', j.token); s('odd-noauto', null); notice = ''; F = {}; FE = {}; LX = null; scr = '';
    if (o.before) o.before();
    setMe(j.me);
    if (window.__oddReload) { window.__oddReload = false; location.reload(); return true; }
    setTimeout(() => { try { if (window.OddSync && window.OddSync.kick) window.OddSync.kick(); } catch (e) {} }, 2600); // pull this person's bets now and keep pushing (sync.js starts its timer only on a page that opened signed in)
    return false;
  }
  async function signIn(w) {
    if (busy) return; const id = w === 'email' ? 'gdoe' : 'gdo';
    let j;
    if (w === 'email') {
      const em = String(F.gemail || '').trim(), pw = String(F.gpw || '');
      if (!EM_RE.test(em)) return fe({ gemail: 'Enter your email address.' }); if (!pw) return fe({ gpw: 'Enter your password.' });
      busy = true; btnBusy(id, 'Please wait…');
      try { j = await call('/login', { email: em, password: pw }); } catch (e) { busy = false; btnBusy(id); return e.status ? fe({ gpw: e.message }) : err(netMsg(e)); }
      busy = false; if (!signedIn(j, 'e:' + em, { way: 'email' }) && !me) { btnBusy(id); err('Could not load your account. Please try again.'); }
    } else {
      const ph = digits(F.gph).replace(/^1(\d{10})$/, '$1'), pn = String(F.gpn || '').trim();
      if (ph.length !== 10) return fe({ gph: 'Enter your 10-digit cell number.' }); if (!/^\d{4,10}$/.test(pn)) return fe({ gpn: 'Enter your PIN (4 to 10 digits).' });
      busy = true; btnBusy(id, 'Please wait…');
      try { j = await call('/phone', { phone: ph, pin: pn, create: false, name: '' }); } catch (e) { busy = false; btnBusy(id); return !e.status ? err(netMsg(e)) : /PIN/.test(e.message) ? fe({ gpn: e.message }) : /number/i.test(e.message) ? fe({ gph: e.message }) : err(e.message); }
      busy = false; if (!signedIn(j, ph, { way: 'phone', phone: ph, pin: pn }) && !me) { btnBusy(id); err('Could not load your account. Please try again.'); }
    }
  }
  // New account: 1. the account is made exactly as before (cell number + PIN, name, the remembered or typed code); 2. the email + password is attached (a code is
  // mailed); 3. the app is open underneath while the code is typed. Mail off / a refused address / any failure in step 2 never undoes or blocks step 1.
  async function signUp() {
    if (busy) return;
    const nm = String(F.gname || '').trim(), em = String(F.gemail || '').trim(), pw = String(F.gpw || ''), ph = digits(F.gph).replace(/^1(\d{10})$/, '$1'), pn = String(F.gpn || '').trim(), rc = String(F.gref || '').trim();
    const bad = {};
    if (nm.length < 2) bad.gname = 'Enter a name or handle (2+ characters).';
    if (!EM_RE.test(em)) bad.gemail = 'Enter a valid email address.';
    if (pw.length < 8) bad.gpw = 'Use 8 or more characters.';
    if (ph.length !== 10) bad.gph = 'Enter your 10-digit cell number.';
    if (!/^\d{6,10}$/.test(pn)) bad.gpn = 'Pick a PIN of 6 to 10 digits.';
    if (rc && !REF_RE.test(rc)) bad.gref = 'A code is letters and numbers only. Leave it empty if you have none.';
    if (Object.keys(bad).length) return fe(bad);
    if (rc !== refOf()) s('odd-ref', rc || null); // what is in the box wins over a code from a link only when the person changed it (emptied = no code)
    busy = true; btnBusy('gdo', 'Please wait…');
    let j;
    try { j = await call('/phone', Object.assign({ phone: ph, pin: pn, create: true, name: nm }, rc ? { ref: rc } : {})); }
    catch (e) { busy = false; btnBusy('gdo'); const m = netMsg(e), k = !e.status ? '' : /name or handle/i.test(m) ? 'gname' : /PIN/.test(m) ? 'gpn' : /number/i.test(m) ? 'gph' : ''; return k ? fe({ [k]: m }) : err(m); }
    const acct = String((j.me && j.me.email) || '').toLowerCase();
    s('odd-tok', j.token); // the next call is made as this new account
    let st = 'todo', hint = '', emsg = '';
    try { const l = await call('/link', { email: em, password: pw }); if (l && l.ok && l.pending) { st = 'code'; hint = l.hint || ''; } else if (l && l.ok && l.verified) { st = 'done'; hint = l.hint || ''; } else if (l && l.code === 'nomail') st = 'nomail'; else emsg = (l && l.error) || ''; }
    catch (e) { if (e.code === 'taken' || e.code === 'email') { st = 'taken'; emsg = e.message; } else emsg = netMsg(e); }
    busy = false;
    EX = { up: 1, e: em, pw: pw, h: hint, st: st, msg: emsg };
    if (st === 'code') rsAt = Date.now();
    if (rc) s('odd-refat', acct); // the code went with the sign-up: it is not sent a second time
    // 'odd-eml' is written after the last person's data is cleared (oddOwner, inside signedIn), so it survives the reload that follows a change of person
    if (signedIn(j, ph, { way: 'phone', phone: ph, pin: pn, before: () => { if (st !== 'done') s('odd-eml', JSON.stringify({ a: acct, e: em, h: hint, st: st === 'code' ? 'code' : st === 'nomail' ? 'nomail' : 'todo', up: 1, open: 1, t: Date.now() })); } })) return; // reloading: setMe() opens the email step again from 'odd-eml' (emResume)
    if (!me) return;
    if (st === 'done') return emDone(); // that address was already proven on this account (My Apps): live at once, no code
    if (st === 'nomail') cardSnooze(false); // mail is off: the reminder card waits 14 days ("we'll ask you later"), not counted as a "Not now"
    F.gemail2 = em; F.gpw2 = pw; // only in memory, for "send it again" / another address; never saved on the phone
    emShow(st === 'code' ? 'emcode' : st === 'taken' || (st === 'todo' && emsg) ? 'emform' : 'emdone', st === 'taken' ? { gemail2: emsg } : null, st === 'todo' ? emsg : '');
  }
  // ---- lost my password / lost my PIN (signed out). The answer to "send me a code" is the same whether or not the email has an account. ----
  function lostOpen(kind) { LX = { kind: kind, sent: false, ticket: '' }; F.lemail = F.lemail || F.gemail || ''; F.lcode = ''; F.lnew = ''; FE = {}; scr = 'lost1'; draw(); }
  function drawLost(back) {
    const pin = LX && LX.kind === 'pin', t = pin ? 'Lost my PIN' : 'Lost my password';
    if (scr === 'lost1') {
      el.innerHTML = '<div class="gb gw">' + back + '<h1>' + t + '</h1><div class="g2 g2b"><form class="box" id="gfl" novalidate><b>Step 1 of 2</b>' + fld('lemail', 'Email on your account', EMAIL_AT + ' autocomplete="email" placeholder="you@example.com"') +
        '<div class="er" id="gerr" role="alert"></div><button id="gls" data-go="1" type="submit">Email me a code</button></form>' +
        '<div class="box"><b>How it works</b><p>We email you a 6-digit code' + (pin ? '. You type it here with a new PIN. Your bets stay just as they are.' : '. You type it here with a new password.') + '</p>' +
        '<p class="hl">No email on your account yet? ' + (pin ? 'Ask Sir Oddable.' : 'Sign in with your cell number and PIN, then add one in your Account box.') + '</p></div></div></div>';
      $('gls').onclick = lostStart;
    } else {
      el.innerHTML = '<div class="gb gw">' + back + '<h1>' + t + '</h1><div class="g2 g2b"><form class="box" id="gfl" novalidate><b>Step 2 of 2</b>' + fld('lcode', 'Code from the email', CODE_AT) +
        (pin ? fld('lnew', 'New PIN', NEWPIN_AT + ' placeholder="6 to 10 digits"', { msk: 1, pw: 1, what: 'PIN' }) : fld('lnew', 'New password', 'type="password" autocomplete="new-password" maxlength="200" placeholder="8 or more characters"', { pw: 1 })) +
        '<div class="er" id="gerr" role="alert"></div><button id="glg" data-go="1" type="submit">' + (pin ? 'Save my new PIN' : 'Save my new password') + '</button></form>' +
        '<div class="box"><div class="ok" id="glsent" role="status">If that email has an account, a code is on its way.</div><p class="hl">The code works for 15 minutes. Look in spam too.</p><button type="button" class="lnk" id="glr">Send the code again</button></div></div></div>';
      $('glg').onclick = lostFinish; $('glr').onclick = () => { if (Date.now() - rsAt < 30000) { err('Please wait half a minute before asking for another code.'); return; } lostStart(true); };
    }
    wireBack(); wireF();
  }
  async function lostStart(again) {
    if (busy || !LX) return; const em = String(F.lemail || '').trim();
    if (!EM_RE.test(em)) { scr = 'lost1'; return fe({ lemail: 'Enter a valid email address.' }); }
    busy = true; btnBusy(again === true ? 'glr' : 'gls', 'Please wait…'); let j = null, m = '';
    try { j = await call('/recover/start', { email: em, kind: LX.kind }); } catch (e) { m = netMsg(e); if (e.code === 'email') { busy = false; scr = 'lost1'; return fe({ lemail: m }); } }
    busy = false; btnBusy(again === true ? 'glr' : 'gls');
    if (j && j.ok) { rsAt = Date.now(); LX.sent = true; LX.ticket = ''; LX.email = em; F.lcode = ''; FE = {}; scr = 'lost2'; draw(); if (again === true) err('A new code is on its way. The old one no longer works.'); const c = $('lcode'); if (c) { try { c.focus(); } catch (e) {} } return; }
    err(j && j.code === 'nomail' ? NOMAIL_LOST : m || 'Could not send a code right now. Please try again later.');
  }
  async function lostFinish() {
    if (busy || !LX) return; const pin = LX.kind === 'pin', code = digits(F.lcode), nw = String(F.lnew || '');
    if (!/^\d{6}$/.test(code) && !LX.ticket) return fe({ lcode: 'Enter the 6-digit code from the email.' });
    if (pin ? !/^\d{6,10}$/.test(nw.trim()) : nw.length < 8) return fe({ lnew: pin ? 'Pick a PIN of 6 to 10 digits.' : 'Use 8 or more characters.' });
    busy = true; btnBusy('glg', 'Please wait…');
    const stop = (e) => { busy = false; btnBusy('glg'); const m = netMsg(e), c = e && e.code; if (c === 'ticket') LX.ticket = ''; return c === 'code' || c === 'expired' || c === 'locked' ? fe({ lcode: m }) : c === 'password' || c === 'pin' ? fe({ lnew: m }) : err(m); };
    try {
      if (pin) { // one request: the code and the new PIN. The server checks the code, changes the PIN on this account's own saved row and signs this phone in.
        const j = await call('/recover/pin', { email: LX.email, code: code, pin: nw.trim() });
        busy = false; if (!j || !j.token || !j.me) { btnBusy('glg'); return err('Could not finish. Please start again.'); }
        if (!signedIn(j, '', { before: () => { EX = { pin: 1, st: 'pin' }; } }) && me) emShow('emdone');
        return;
      }
      if (!LX.ticket) LX.ticket = (await call('/recover/check', { email: LX.email, code: code })).ticket || '';
      await call('/recover/password', { ticket: LX.ticket, password: nw }); LX.ticket = '';
    } catch (e) { return stop(e); }
    // the new password works now: sign in with it
    try { const j = await call('/login', { email: LX.email, password: nw }); busy = false; signedIn(j, 'e:' + LX.email, { way: 'email' }); }
    catch (e) { busy = false; scr = ''; mode = 'in'; s('odd-way', 'email'); F = { gemail: LX.email }; FE = {}; notice = 'Your password is changed. Sign in with it.'; draw(); }
  }
  // ---- signed in: add / confirm the email (after sign-up, from the reminder card, from the Account box) ----
  const emlGet = () => { const o = jget('odd-eml'); return o && me && o.a === String(me.email || '').toLowerCase() ? o : null; };
  const emlSet = (o) => s('odd-eml', o ? JSON.stringify(o) : null);
  const canLink = (m) => !!m && m.role !== 'owner' && PH_ACCT.test(String(m.email || '')) && m.has_email_login === false; // strictly false: an older My Apps does not say, and then nothing is offered
  function emShow(sc, fes, msg) { scr = sc; FE = fes || {}; sheet = true; show(); if (msg) err(msg); const f = el && el.querySelector('input[data-f]'); if (f && sc !== 'emdone') { try { f.focus({ preventScroll: true }); } catch (e) {} } if (sc === 'emdone') refFresh(); }
  function emClose() { if (EX && EX.up && (scr === 'emcode' || scr === 'emform')) cardSnooze(false, 1); const o = emlGet(); if (o && o.open) { delete o.open; emlSet(o); } /* a code that was sent stays good for its 15 minutes: the card / Account box go straight back to the code box */ scr = ''; EX = null; F = {}; FE = {}; hide(); emCard(); drawAcct(); }
  // Opens "Add an email and password" (the card, the Account box). A code that is still waiting (asked less than 15 minutes ago) goes straight to the code box.
  window.oddAddEmail = function () {
    if (!g('odd-tok') || !canLink(me)) return false; const o = emlGet();
    EX = { e: (o && o.e) || '', pw: '', h: (o && o.h) || '', st: '', up: 0 }; F.gemail2 = EX.e; F.gpw2 = '';
    emShow(o && o.st === 'code' && Date.now() - (Number(o.t) || 0) < 15 * 60e3 ? 'emcode' : 'emform'); return true;
  };
  function drawEm() {
    const x = EX || {};
    if (scr === 'emcode') {
      el.innerHTML = '<div class="gb gw">' + BACK + '<h1>Check your email</h1><div class="g2 g2b"><form class="box" id="gfc" novalidate><p id="gcsay">Enter the 6-digit code we emailed to <b>' + esc(x.h || 'your address') + '</b>.</p>' +
        fld('gcode2', 'Code from the email', CODE_AT) + '<div class="er" id="gerr" role="alert"></div><button id="gcv" data-go="1" type="submit">Confirm my email</button></form>' +
        '<div class="box"><b>No code?</b><p class="hl">It works for 15 minutes. Look in spam too.</p><button type="button" class="lnk" id="gcr">Resend the code</button><button type="button" class="lnk" id="gce">Use a different email</button><button type="button" class="alt" id="gcs">Skip for now</button>' +
        '<p class="hl">Skipping is fine: your account works with your cell number and PIN, and we will remind you later.</p></div></div></div>';
      $('gcv').onclick = emVerify; $('gcr').onclick = emResend; $('gce').onclick = () => { F.gemail2 = x.e || ''; F.gpw2 = ''; emShow('emform'); }; $('gcs').onclick = () => { const o = emlGet(); if (o) { o.st = 'todo'; emlSet(o); } x.st = 'skip'; if (x.up) cardSnooze(false, 1); emShow('emdone'); };
    } else if (scr === 'emform') {
      el.innerHTML = '<div class="gb gw">' + BACK + '<h1>Add an email and password</h1><div class="g2 g2b"><form class="box" id="gfa" novalidate>' + fld('gemail2', 'Email', EMAIL_AT + ' autocomplete="email" placeholder="you@example.com"') + fld('gpw2', 'Password', 'type="password" autocomplete="new-password" maxlength="200" placeholder="8 or more characters"', { pw: 1 }) +
        '<div class="er" id="gerr" role="alert"></div><button id="gas" data-go="1" type="submit">Email me a code</button></form>' +
        '<div class="box"><b>Why</b><p>So you can sign in on any device and get back in if you lose your PIN. We email a 6-digit code to confirm the address is yours.</p><button type="button" class="alt" id="gan">Not now</button></div></div></div>';
      $('gas').onclick = emSend; $('gan').onclick = () => { if (x.up) { x.st = 'skip'; cardSnooze(false, 1); emShow('emdone'); } else emClose(); };
    } else {
      const st = x.st, up = !!x.up;
      const t = st === 'pin' ? 'Your PIN is changed' : up ? "You're in" : st === 'ok' || st === 'done' ? 'Email added' : 'Not yet';
      const line = st === 'pin' ? 'Your bets are just as you left them. Use your cell number and the new PIN on your other devices: they have been signed out.'
        : st === 'ok' || st === 'done' ? 'Your email is confirmed' + (x.h ? ' (' + esc(x.h) + ')' : '') + '. You can sign in with it and your password on any device, and use it if you ever lose your PIN.'
        : st === 'nomail' ? (up ? NOMAIL_UP : "Email isn't switched on yet. Your account still works with your cell number and PIN. We'll ask you again later.")
        : 'Your account works with your cell number and PIN. We will remind you to confirm your email, so you can get back in if you lose the PIN.';
      el.innerHTML = '<div class="gb gw">' + BACK + '<h1>' + t + '</h1><div class="g2 g2b"><div class="box"><div' + (st === 'nomail' ? '' : ' class="ok"') + ' id="gdm" role="status">' + line + '</div><button type="button" id="gok">Continue</button></div>' +
        '<div class="box"><b>Know someone who would like Oddable?</b><p class="hl">Signing up is free.</p><button type="button" class="alt" id="gsh">📤 Share Oddable</button><div class="hl" id="gshm" role="status" style="min-height:20px"></div></div></div></div>';
      $('gsh').onclick = () => shareTap('gshm'); $('gok').onclick = emClose;
    }
    wireBack(); wireF();
  }
  // What a link answer means for the screen. j = the server's answer, e = a thrown error.
  function emAfterLink(j, e, em) {
    const x = EX || (EX = {}); const acct = String(me.email || '').toLowerCase(), keep = (st) => emlSet({ a: acct, e: em, h: x.h || '', st: st, up: x.up ? 1 : 0, open: 1, t: Date.now() });
    if (j && j.ok && j.pending) { rsAt = Date.now(); x.e = em; x.h = j.hint || ''; keep('code'); F.gcode2 = ''; return emShow('emcode'); }
    if (j && j.ok && j.verified) { x.h = j.hint || ''; return emDone(); }
    if (j && j.code === 'nomail') { x.e = em; x.st = 'nomail'; keep('nomail'); cardSnooze(false); return emShow('emdone'); }
    const m = e ? netMsg(e) : (j && j.error) || 'Could not send the code. Please try again later.', c = e && e.code;
    emShow('emform', c === 'taken' || c === 'email' ? { gemail2: m } : c === 'password' ? { gpw2: m } : null, c === 'taken' || c === 'email' || c === 'password' ? '' : m);
  }
  async function emSend() {
    if (busy || !me) return; const em = String(F.gemail2 || '').trim(), pw = String(F.gpw2 || ''), bad = {};
    if (!EM_RE.test(em)) bad.gemail2 = 'Enter a valid email address.'; if (pw.length < 8) bad.gpw2 = 'Use 8 or more characters.';
    if (Object.keys(bad).length) return fe(bad);
    busy = true; btnBusy('gas', 'Please wait…'); let j = null, er = null;
    try { j = await call('/link', { email: em, password: pw }); } catch (e) { er = e; }
    busy = false; if (EX) EX.pw = pw; emAfterLink(j, er, em);
  }
  async function emResend() {
    const x = EX || {}; if (busy) return;
    if (Date.now() - rsAt < 30000) return err('Please wait half a minute before asking for another code.');
    if (!x.pw || !x.e) { F.gemail2 = x.e || ''; F.gpw2 = ''; return emShow('emform', null, 'Type your password again and we will send a new code.'); } // the password is never kept on the phone: after a reload it has to be typed again
    busy = true; btnBusy('gcr', 'Please wait…'); let j = null, er = null;
    try { j = await call('/link', { email: x.e, password: x.pw }); } catch (e) { er = e; }
    busy = false; btnBusy('gcr');
    if (j && j.ok && j.pending) { rsAt = Date.now(); x.h = j.hint || x.h; const o = emlGet(); if (o) { o.t = Date.now(); o.st = 'code'; emlSet(o); } F.gcode2 = ''; draw(); return err('A new code is on its way. The old one no longer works.'); }
    emAfterLink(j, er, x.e);
  }
  async function emVerify() {
    if (busy) return; const code = digits(F.gcode2);
    if (!/^\d{6}$/.test(code)) return fe({ gcode2: 'Enter the 6-digit code from the email.' });
    busy = true; btnBusy('gcv', 'Please wait…'); let j = null;
    try { j = await call('/link/verify', { code: code }); } catch (e) { busy = false; btnBusy('gcv'); const c = e.code; if (c === 'taken') { F.gemail2 = ''; return emShow('emform', { gemail2: netMsg(e) }); } return c === 'code' || c === 'expired' || c === 'locked' ? fe({ gcode2: netMsg(e) }) : err(netMsg(e)); }
    busy = false; if (j && j.ok) { if (EX) EX.h = j.hint || EX.h; return emDone(); } btnBusy('gcv'); err('Could not confirm the code. Please try again.');
  }
  function emDone() { const x = EX || (EX = {}); x.st = 'ok'; x.pw = ''; emlSet(null); s('odd-emc', null); if (me) { me = Object.assign({}, me, { has_email_login: true, has_contact: true, contact_verified: true, contact_hint: x.h || me.contact_hint || '' }); } emShow('emdone'); emCard(); drawAcct(); }
  // ---- the reminder card for accounts that have no email sign-in yet (index.html only: top of the list, in normal page flow, under the message and days-left cards) ----
  // "Not now" hides it for 14 days; it comes back at most 3 times. It asks the server nothing: it reads what /acct/me already said.
  // count = a "Not now" on the card (14 days, counted). Not counted: mail is not switched on yet (14 days), and a skip / mail-off right at sign-up (the card waits
  // a day, so the person who just said "skip" is not asked again on the very next screen).
  function cardSnooze(count, days) { if (!me) return; const a = String(me.email || '').toLowerCase(), o = jget('odd-emc'), n = o && o.a === a ? Number(o.n) || 0 : 0; s('odd-emc', JSON.stringify({ a: a, n: n + (count ? 1 : 0), t: Date.now() + (days || 14) * 864e5 })); emCard(); }
  function emCard() {
    try {
      const old = $('emc'), main = document.querySelector('main');
      if (!main || !$('nb') || lock !== '' || !g('odd-tok') || !canLink(me) || !me.allowed || (el && scr)) { if (old) old.remove(); return; }
      const a = String(me.email || '').toLowerCase(), o = jget('odd-emc'); if (o && o.a === a && ((Number(o.n) || 0) >= 4 || Date.now() < (Number(o.t) || 0))) { if (old) old.remove(); return; }
      const p = emlGet(), wait = !!(p && p.e);
      let c = old; if (!c) { c = document.createElement('section'); c.id = 'emc'; c.setAttribute('aria-label', 'Add an email and password'); }
      const above = $('annc') || $('dlc'), want = above && above.parentNode === main ? above.nextSibling : main.firstChild; // the days-left card and the owner's message stay above (announce.js puts them first)
      if (c.parentNode !== main || (want !== c && c.previousElementSibling !== above)) main.insertBefore(c, want);
      const k = wait ? 'w' : 'a'; if (c.getAttribute('data-k') === k) return; c.setAttribute('data-k', k);
      c.innerHTML = '<div class="emt">' + (wait ? '✉️ Confirm your email so you can recover your account.' : '✉️ Add an email and password so you can recover your account.') + '</div><div class="emb"><button type="button" id="emc-go">' + (wait ? 'Confirm email' : 'Add email and password') + '</button><button type="button" class="alt" id="emc-no">Not now</button></div>';
      $('emc-go').onclick = () => window.oddAddEmail(); $('emc-no').onclick = () => cardSnooze(true);
    } catch (e) {}
  }
  // ---- share links ----
  // FOR EVERY CODER WHO BUILDS A LINK THAT LEAVES THE APP (Groups phase 2: group / Calcutta / golf invites): build it with window.oddShareUrl(path).
  //   oddShareUrl('')                    -> https://<this site>/?ref=K7QP2M9X
  //   oddShareUrl('golfgps.html?c=123')  -> https://<this site>/golfgps.html?c=123&ref=K7QP2M9X
  // It adds ?ref=<code> for a signed-in person: the code of their influencer, their own influencer code, or their personal share code (My Apps decides, /acct/ref).
  // A guest has no code: the plain link. It answers at once from what the phone knows (kept 1 hour); window.oddShare(path, {title, text}) refreshes the code first,
  // then opens the phone's own share sheet, or copies the link where there is none. It resolves to 'shared' | 'copied' | 'cancel' | 'fail'.
  const refMine = () => { const o = jget('odd-myref'); return o && me && g('odd-tok') && o.a === String(me.email || '').toLowerCase() && REF_RE.test(String(o.r || '')) ? o : null; };
  window.oddShareUrl = function (path) {
    let u; const base = new URL('.', location.href); try { u = new URL(String(path || ''), base); if (u.origin !== base.origin) u = base; } catch (e) { u = base; }
    u.searchParams.delete('ref'); const c = refMine(); if (c) u.searchParams.set('ref', c.r); return u.href;
  };
  let refP = null;
  function refFresh() { // one small read, at most once an hour per account on this phone; a failure keeps the last code
    if (!g('odd-tok') || !me || (me.role === 'owner' && me.source === 'owner')) return Promise.resolve('');
    const c = refMine(); if (c && Date.now() - (Number(c.t) || 0) < 3600e3) return Promise.resolve(c.r);
    if (refP) return refP; const a = String(me.email || '').toLowerCase();
    refP = fetch(API + '/ref', { headers: { 'x-token': g('odd-tok') || '' }, signal: AbortSignal.timeout(4000) }).then((r) => r.json()).then((j) => { if (j && j.ok && REF_RE.test(String(j.ref || ''))) { s('odd-myref', JSON.stringify({ a: a, r: j.ref, t: Date.now() })); if (me && me.influencer) drawAcct(); return j.ref; } return c ? c.r : ''; }).catch(() => (c ? c.r : '')).then((v) => { refP = null; return v; });
    return refP;
  }
  async function copyText(t) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t); return true; } } catch (e) {}
    try { const a = document.createElement('textarea'); a.value = t; a.setAttribute('readonly', ''); a.style.cssText = 'position:fixed;left:0;top:0;opacity:0;font-size:16px'; (el || document.body).appendChild(a); a.select(); const ok = document.execCommand('copy'); a.remove(); return !!ok; } catch (e) { return false; }
  }
  window.oddShare = async function (path, o) {
    o = o || {}; await refFresh(); const url = window.oddShareUrl(path);
    if (navigator.share && !o.copy) { try { await navigator.share({ title: o.title || 'Oddable', text: o.text || 'Scores, picks and your bets in one place. Sign up free:', url: url }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; } }
    return (await copyText(url)) ? 'copied' : 'fail';
  };
  async function shareTap(msgId, copy) { const m = $(msgId), r = await window.oddShare('', { copy: !!copy }); if (m) m.textContent = r === 'copied' ? 'Link copied' : r === 'fail' ? 'Could not copy. Your link: ' + window.oddShareUrl('') : ''; }
  // A code remembered from a link (or typed) for an account that ALREADY exists: sent once after sign-in, only while My Apps says the box is still open.
  function refAttach(m) {
    const c = refOf(); if (!c || !m || m.ref_locked !== false || !g('odd-tok') || m.role === 'owner') return; const a = String(m.email || '').toLowerCase(); if (!a || g('odd-refat') === a) return;
    s('odd-refat', a); call('/ref/attach', { ref: c }).then((j) => { if (j && j.attributed) s('odd-myref', null); }).catch((e) => { if (!e.status || e.status >= 500 || e.status === 429) s('odd-refat', null); }); // not reached / busy: once more on the next open. Any real answer (also "too late", "already set"): never again, and nothing is shown
  }
  // ---- a reset somewhere else (lost PIN / lost password) signed this phone out: sign in again, nothing on the phone is cleared ----
  async function reauth(msg, noAuto) {
    if (reB) return; reB = true;
    try {
      s('odd-tok', null); me = null;
      if (!noAuto && g('sync-phone') && g('sync-pin') && !g('odd-noauto') && (await autoPhone())) return; // the PIN on this phone is still right (the password was changed): signed in again without a word
      s('sync-pin', null); s('odd-stok', null); s('odd-ok', null); s('odd-exp', null);
      mode = 'in'; scr = ''; F = {}; FE = {}; notice = msg || 'Sign in again.'; sheet = !!gmode; setLock(gmode ? 'guest' : ''); show(); drawAcct(); emCard();
    } finally { reB = false; }
  }
  window.oddReauth = reauth;
  const gone = (e) => { if (e && e.code === 'resign') reauth(e.message); else out(); };
  // ================= end v271 =================
  function draw() {
    if (!el) return;
    if (!g('odd-tok') || !me) { drawOut(); return; } // v271: the sign-in / sign-up / lost PIN and password screens
    if (scr) { drawEm(); return; } // v271: add / confirm the email, for somebody who is signed in
    const m = me, dl = m.expires_on ? Math.ceil((new Date(m.expires_on + 'T23:59:59') - Date.now()) / 864e5) : 0;
    el.innerHTML = '<div class="gb">' + (sheet ? (gmode ? BACK : BACK0) : '') + '<h1>Subscribe to Oddable</h1><p>' + (early ? esc(dlText(early)) + '.' : m.plan === 'pro' ? (m.expires_on && String(m.expires_on).slice(0, 10) < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()) ? 'Your access ended ' + esc(m.expires_on) + '.' : 'Your renewal is waiting for the owner to confirm. Tap Check again in a bit.') : (m.source === 'trial' ? 'Your free trial has ended.' : 'Your access has ended.')) + ' $' + esc(m.price) + ' per month unlocks everything.</p>' +
      (m.pending ? '<div class="box ok">Payment request received. You will be unlocked as soon as it is confirmed. Tap Check again in a minute.</div>' : '') +
      '<div class="box"><b>Step 1.</b> Send $' + m.price + ' on Cash App' + (m.tag ? ' to <b>' + esc(m.tag) + '</b>' : '') + '.' +
      (/^https:\/\//.test(m.link || '') ? '<button id="gcash">Pay $' + m.price + ' with Cash App</button>' : '<p class="er">Payment is not set up yet. Contact the owner.</p>') +
      '<b>Step 2.</b> Come back and tap below.<label for="gtag">Your Cash App $handle</label><input id="gtag" placeholder="$yourtag" maxlength="21" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" aria-describedby="gtaghl gtagerr" value="' + esc(tagDraft != null ? tagDraft : (m.cashtag || '')) + '"><div class="hl" id="gtaghl">So we can match your payment.</div><div class="er" id="gtagerr" role="alert">' + esc(tagErr) + '</div><button id="gpaid" class="alt">I paid — unlock me</button></div>' +
      '<div class="box"><b>Have a code?</b><input id="gcode" placeholder="Access code" autocapitalize="characters"><button id="gred" class="alt">Redeem code</button></div>' +
      (m.role === 'owner' || (early && !timeNear(early) && !trLine()) ? '' : '<div class="box" id="gtime">' + timeHtml('gt', false, early ? timeNear(early) : true) + '</div>') +
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
  // ---- v267: days-left reminders. The card itself is drawn by announce.js (index.html) from oddMe(); the pay screen is the ONE subscribe screen above. ----
  // "5 free days left" (trial) / "5 days left" (paid) / "1 day left" / "Ends today".
  const dlText = (m) => { const d = daysLeft(m), tr = m && m.source === 'trial'; return d == null ? '' : d <= 0 ? 'Ends today' : d + (tr ? ' free' : '') + ' day' + (d === 1 ? '' : 's') + ' left'; };
  let early = null, wantPay = false; try { wantPay = /[?&]pay=1(&|$)/.test(location.search); } catch (e) {} // /?pay=1 = opened from a renewal reminder: straight to the pay screen after sign-in
  // Opens the subscribe / pay screen for an account that still has time ("Pay now"). Back returns to the app without asking the server.
  // v270 (merge of v268 guest mode): it is the same sheet as every other pay entry, with the one Back button (BACK / closeSheet). An account that still has time
  // always gets the Back, in guest mode and with GUEST_MODE=0 (as v267-v269 did); an ended account gets it only in guest mode (GUEST_MODE=0 = the subscribe wall).
  function payOpen() { if (!me || !g('odd-tok') || me.role === 'owner') return false; if (me.allowed) { if (!me.expires_on) return false; early = me; me = Object.assign({}, me, { allowed: false }); } sheet = !!early || (gmode && lock === 'expired'); show(); try { el.scrollTop = 0; } catch (e) {} return true; }
  function payBack() { if (!early) return false; me = early; early = null; hide(); return true; }
  // window.oddPay (the days-left card, /?pay=1) is set in "v268 GUEST MODE block 2" below: one function for every "Pay now".
  // What the page may know about the signed-in account for the days-left card: no token, no secret. null = signed out / owner / not loaded yet.
  window.oddMe = function () { const m = early || me; if (!m || !g('odd-tok') || m.role === 'owner') return null; return { acct: String(m.email || ''), allowed: !!m.allowed, pending: !!m.pending, ends: !!m.expires_on, days: daysLeft(m), text: dlText(m), price: Number(m.price) > 0 ? Number(m.price) : 0, canAsk: timeNear(m) }; };
  // "Request free time" on the card: opens Disclosures and brings the existing box in the Account section into view.
  window.oddTimeBox = function () { try { const d = document.querySelector('header details.dsc'); if (d) d.open = true; drawAcct(); const b = $('acct-time') || $('acct'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'center' }); const n = $('at-note'); if (n) setTimeout(() => { try { n.focus({ preventScroll: true }); } catch (e) {} }, 50); } catch (e) {} };
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
  function timePaint() { const c = $('gtime'); if (c && me) { c.innerHTML = timeHtml('gt', false, early ? timeNear(early) : true); timeWire('gt'); } drawAcct(); }
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
  // People who already use Oddable have their number + PIN saved on this phone: sign them in without typing.
  async function autoPhone() {
    const ph = g('sync-phone'), pn = g('sync-pin'); if (!ph || !pn || g('odd-noauto')) return false;
    try { const j = await call('/phone', { phone: ph, pin: pn }); s('odd-tok', j.token); setMe(j.me); return true; } catch (e) { return false; }
  }
  function setMe(m) {
    me = m; early = null; if (!m) return; setTimeout(drawAcct, 0);
    // v272 Groups phase 2: the server says, on the `me` this phone already gets, whether Groups is on for THIS account (odds-api/acct.js gFlag). Not said = no Groups: no tab, no file, no call.
    try { const gv = m.groups === true ? '1' : null; if (g('odd-grp') !== gv) s('odd-grp', gv); if (window.oddGroupsChanged) setTimeout(() => { try { window.oddGroupsChanged(); } catch (e) {} }, 0); } catch (e) {} setTimeout(() => { try { if (window.oddDays) window.oddDays(); } catch (e) {} }, 0);
    // Calcutta (feature session, Nov 17 2026): the server says, on the same `me`, whether Calcutta is on for THIS account (odds-api/acct.js cFlag). Not said = no menu item, no file, no call.
    try { const cv = m.calcutta === true ? '1' : null, ch = g('odd-calc') !== cv; if (ch) s('odd-calc', cv); if (window.oddCalcChanged) setTimeout(() => { try { window.oddCalcChanged(ch); } catch (e) {} }, 0); } catch (e) {}
    // v267 /?pay=1 (a renewal reminder): straight to the ONE pay screen. v270: time left = the early screen; time ended in guest mode = the pay sheet (it is not up by itself any more); GUEST_MODE=0 and ended = the subscribe wall is already up.
    if (wantPay) { wantPay = false; try { history.replaceState(null, '', location.pathname); } catch (e) {} if (m.role !== 'owner' && (m.allowed ? !!m.expires_on : gmode)) setTimeout(() => { try { window.oddPay(); } catch (e) {} }, 0); }
    setTimeout(() => timeCheck(m), 0); try { const dg = document.getElementById('odiag'); if (dg) dg.textContent = (m.ownerDash || (m.role === 'owner' && m.source === 'owner')) ? ' · acct ' + (m.role || '?') + (m.ownerDash ? '+dash' : '') + ' ' + String(m.email || '').slice(-8) : ''; s('odd-dash', (m.role === 'owner' && m.source === 'owner') || m.ownerDash ? '1' : null); if (window.navRender) setTimeout(window.navRender, 0); } catch (e) {}
    setTimeout(() => refAttach(m), 0); // v271: a remembered sharing code for an account that already existed (once, only while My Apps says the box is open)
    if (m.allowed) { s('odd-ok', String(Date.now())); s('odd-exp', null); if (!(el && scr)) hide(); /* v271: an open "confirm your email" screen stays */ setLock(''); afterRun(); soon(m); setTimeout(namePrompt, 1200); setTimeout(emResume, 0); setTimeout(emCard, 0); }
    else if (gmode) { s('odd-exp', '1'); setLock('expired'); if (el && sheet) draw(); else hide(); } // v268: time has ended = browse as a guest, everything of theirs locked until paid (nothing is wiped). The pay screen stays up only when they opened it.
    else show(); // GUEST_MODE=0: the subscribe wall, as before
  }
  // v271: after a sign-up that reloaded the page (another person's data was cleared first), the "confirm your email" step opens again. The password is not kept.
  function emResume() { const o = emlGet(); if (!o || !o.open || el) return; if (!canLink(me)) { emlSet(null); return; } EX = { up: o.up ? 1 : 0, e: o.e || '', pw: '', h: o.h || '', st: o.st === 'nomail' ? 'nomail' : 'skip' }; emShow(o.st === 'code' && Date.now() - (Number(o.t) || 0) < 15 * 60e3 ? 'emcode' : 'emdone'); }
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
    if (d <= 3 && d >= 0 && !document.getElementById('gtoast')) { const t = document.createElement('div'); t.id = 'gtoast'; t.textContent = (m.source === 'trial' ? 'Free trial' : 'Subscription') + ' ends ' + (d === 0 ? 'today' : 'in ' + d + ' day' + (d > 1 ? 's' : '')) + ' — tap to renew'; t.onclick = () => { if (!payOpen()) { me = Object.assign({}, m, { allowed: false }); sheet = gmode; show(); } t.remove(); }; /* v270: the one pay screen (v267 early wording, Back) */ document.body.appendChild(t); setTimeout(() => t.remove(), 9000); }
  }
  function out() { s('odd-noauto', '1'); s('odd-grp', null); s('odd-gbl', null); s('odd-tok', null); s('odd-ok', null); s('odd-exp', null); s('odd-push', null); s('sync-phone', null); s('sync-pin', null); s('sync-owner', null); s('odd-oacct', null); window.oddWipe(); me = null; mode = 'in'; location.reload(); }
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
    // v271: the email sign-in ("Email: s•••@gmail.com ✓" or the button to add one), Share Oddable, and an influencer's own code
    const AB = ' style="min-height:44px;margin:4px 6px 4px 0;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font:700 14px inherit"';
    const pend = emlGet(), mine = refMine();
    const emLine = !PH_ACCT.test(String(me.email || '')) ? '' : me.has_email_login === true ? '<div class="sub" id="acct-eml">Email: <span id="acct-eh"></span> ✓</div>' : canLink(me) ? '<div><button id="acct-addem"' + AB + '>' + (pend && pend.e ? 'Confirm your email' : 'Add email and password') + '</button></div>' : '';
    const shLine = (me.influencer ? '<div class="sub" id="acct-inf" style="margin:6px 0 0">Your influencer code: <b id="acct-ic"></b></div>' : '') + '<div><button id="acct-share"' + AB + '>📤 Share Oddable</button>' + (me.influencer ? '<button id="acct-icp"' + AB + '>Copy link</button>' : '') + '</div><div class="sub" id="acct-shm" role="status"></div>';
    box.innerHTML = '<div class="sub"><b>Account</b>: <span id="acct-em"></span></div>' + emLine +
      (owner ? '<button id="acct-dash" style="min-height:44px;margin:4px 0;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:#0b3d91;color:#fff;font:700 14px inherit">📊 Owner dashboard</button>' : (g('odd-push') === '1' ? '<div class="sub">Renewal reminders are on.</div>' : '<button id="acct-push" style="min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font:700 14px inherit">Turn on renewal reminders</button>')) +
      '<div class="sub" id="acct-st"></div>' + (!owner && (timeNear(me) || trLine()) ? '<div id="acct-time" style="margin:8px 0;padding:8px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">' + timeHtml('at', true, timeNear(me)) + '</div>' : '') + shLine + '<button id="acct-out" style="min-height:44px;margin-top:6px;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font:700 14px inherit">Sign out</button>';
    const em = $('acct-em'); if (em) em.textContent = me.email || ''; const pb = $('acct-push'); if (pb) pb.onclick = pushOn; const db = $('acct-dash'); if (db) db.onclick = () => { if (window.oddDash) window.oddDash(); }; $('acct-out').onclick = out; timeWire('at');
    const eh = $('acct-eh'); if (eh) eh.textContent = me.contact_hint || 'added'; const ae = $('acct-addem'); if (ae) ae.onclick = () => window.oddAddEmail();
    $('acct-share').onclick = () => shareTap('acct-shm'); const ic = $('acct-ic'), cp = $('acct-icp'); if (cp) cp.onclick = () => shareTap('acct-shm', true);
    if (ic) { ic.textContent = mine ? mine.r : '…'; if (!mine && !refTried) { refTried = true; refFresh(); } } // an influencer's own code is their share code: one read per app open
  }
  let refTried = false;
  // Opening ⓘ Disclosures (where Share Oddable lives) fetches the share code ahead of the tap, so the phone's share sheet opens straight from the tap. At most once an hour.
  document.addEventListener('toggle', (e) => { try { const d = e.target; if (d && d.open && d.classList && d.classList.contains('dsc') && g('odd-tok') && me) refFresh(); } catch (er) {} }, true);
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
  function closeSheet() {
    if (scr === 'lost2' || scr === 'lost1') { scr = scr === 'lost2' ? 'lost1' : ''; FE = {}; draw(); return; } // v271: one Back, one step back: code -> email -> the sign-in sheet
    if (scr) { emClose(); return; } // v271: the email screens of somebody who is signed in: Back = not now
    notice = ''; FE = {};
    try { sessionStorage.removeItem(AK); } catch (e) {} if (payBack()) return; /* v267 early pay screen: back to the app, the server is not asked */ const fake = me && me.allowed === false && lock === ''; hide(); if (fake) refresh().catch(() => {}); /* the "ends soon" toast showed the pay screen for an account that is still good */ }
  // Opens the sign-up screen ('up', the default), the sign-in screen ('in') or, for an account whose time has ended, the pay screen ('pay'; 'time' = scrolled to
  // "Request free time"), as a full-screen sheet with ‹ Back. Somebody who is already signed in and paid up goes straight to the hook.
  window.oddSignUp = function (target, m) {
    try { sessionStorage.setItem(AK, String(target || '')); } catch (e) {}
    if (!lock) { if (g('odd-tok') || g('odd-gate') === '0') { afterRun(); return; } }
    if (g('odd-tok') && (lock === 'expired' || me)) { // signed in: the pay screen
      sheet = true; show(); if (!me) { el.innerHTML = '<div class="gb">' + BACK + '<h1>Oddable</h1><p>Checking your account…</p><div class="er" id="gerr"></div></div>'; wireBack(); refresh().then(() => { if (el && me && !me.allowed) { sheet = true; draw(); } }).catch((e) => { if (e.status === 401) gone(e); else err('Could not reach the server. It may be waking up. Go back and try again.'); }); return; }
      if (m === 'time') { const t = $('gtime'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start' }); } return;
    }
    mode = m === 'in' ? 'in' : 'up'; scr = ''; FE = {}; sheet = true; if (/^group:/.test(String(target || ''))) notice = 'You were invited to a group on Oddable. Create your free account (or sign in) and you go straight to it.'; /* v272: only a group invite link gets here with this target */ show();
  };
  // v270: ONE "Pay now" for every entry point. An account that still has time (v267: days-left card, /?pay=1, the "ends soon" toast) -> payOpen(), the early wording.
  // An ended account in guest mode, or nobody signed in -> the sheet through oddSignUp (pay screen / sign-up).
  window.oddPay = function () { if (me && g('odd-tok') && lock !== 'expired') return payOpen(); window.oddSignUp('', 'pay'); return true; };
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
    if (j.groups === true) { s('odd-gsw', '1'); try { if (window.oddGroupsSw) window.oddGroupsSw(); } catch (e) {} } else if (g('odd-gsw')) { s('odd-gsw', null); s('odd-grp', null); } // v272: Groups exists on the server at all (GROUPS_ENABLED=1). Not said = dark: nothing Groups-related is kept or run
    if (j.calcutta === true) { s('odd-csw', '1'); try { if (window.oddCalcSw) window.oddCalcSw(); } catch (e) {} } else if (g('odd-csw')) s('odd-csw', null); // Calcutta (feature session): Calcutta exists on the server (CALCUTTA_ENABLED=1); not said = nothing kept or run
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
      if (gmode) { setLock('guest'); if (wantPay) { mode = 'in'; sheet = true; show(); } return; } // v268: NO WALL. A visitor with no account lands in the app as a guest. v270: /?pay=1 (a renewal reminder opened on a phone that is signed out) = the sign-in sheet with a Back, then the pay screen
      setLock(''); show(); return; // GUEST_MODE=0: the sign-in wall, as before
    }
    if (!gmode && lock) setLock(''); // GUEST_MODE=0: nobody browses locked; the checks below put up the wall where it belongs
    // Offline / server asleep: keep working for 72h after the last successful check.
    const lastOk = Number(g('odd-ok') || 0), ended = gmode && g('odd-exp') === '1'; // ended: this account's time had run out the last time we looked; it browses as a guest while we look again (no cover, no wall)
    if (ended || (lastOk && Date.now() - lastOk < GRACE)) { const again = (n) => refresh().catch((e) => { if (e.status === 401) gone(e); else if (n < 4) setTimeout(() => again(n + 1), 20000); }); again(0); return; } // retry while the server redeploys
    show(); $('gate').innerHTML = '<div class="gb"><h1>Oddable</h1><p>Checking your account…</p></div>';
    refresh().catch((e) => { if (e.status === 401) gone(e); else waking(); });
  }
  // ================= end of block 3 =================
  // Cover the app immediately to avoid a flash of content when a token exists and the gate is on.
  if (g('odd-gate') === '1' && !(g('odd-tok') && Date.now() - Number(g('odd-ok') || 0) < GRACE)) { document.addEventListener('DOMContentLoaded', () => {}); }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
