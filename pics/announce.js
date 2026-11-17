// v267. Messages from Oddable (the owner's "send to everyone") and the days-left card. In-app cards + the list under Disclosures. index.html only; never in ?mirror=1.
// Where the message comes from: the page already reads GET /appcfg once per load (bcLoad in index.html) and hands the answer to window.oddAnn();
// `announce` in it is the latest message for everyone. A signed-in phone then asks GET /acct/announce ONCE per load for a message aimed at its
// account (paid / trial only, expired only). The newer of the two that this device has not dismissed is shown. No polling, no retry.
// Every word from the server is put on the page with textContent. Links are only the fixed in-app places below (same list as odds-api/announce.js).
// Saved on this device in localStorage `odd-ann`: { dis: {id: time}, seen: [{id,title,body,link,at,t,o}] } (last 14 days, at most 12).
(function () {
  if (window.MIRROR || /[?&]mirror=1/.test(location.search)) return;
  const API = 'https://calcutta-odds.onrender.com/acct/announce', K = 'odd-ann', DAYS = 14, KEEP = 12;
  const LINKS = { '/': 'home', '/?open=bets': 'bets', '/?open=live': 'live', '/sports.html': 'sports', '/pga.html': 'pga', '/pickleball.html': 'pickleball', '/golfgps.html': 'golfgps' };
  const PAGES = { sports: 'sports.html', pga: 'pga.html', pickleball: 'pickleball.html', golfgps: 'golfgps.html' };
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const mine = () => g('sync-owner') || '';
  // ---- checks (the server checked already; the phone checks again and takes nothing else) ----
  function valid(a, targeted) {
    if (!a || typeof a !== 'object') return null;
    const id = typeof a.id === 'string' ? a.id : '', title = typeof a.title === 'string' ? a.title.trim() : '', body = typeof a.body === 'string' ? a.body.trim() : '', at = typeof a.at === 'string' ? Date.parse(a.at) : NaN;
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(id) || !title || !body || title.length > 60 || body.length > 240 || !isFinite(at)) return null;
    if (Date.now() - at > DAYS * 864e5) return null;
    const o = { id: id, title: title, body: body, link: typeof a.link === 'string' && Object.prototype.hasOwnProperty.call(LINKS, a.link) ? a.link : '', at: at };
    if (targeted) { o.t = 1; o.o = mine(); } // a message aimed at one account is only listed for that person on this phone
    return o;
  }
  function load() {
    let s = null; try { s = JSON.parse(g(K) || 'null'); } catch (e) {}
    const out = { dis: {}, seen: [] }; if (!s || typeof s !== 'object') return out;
    const now = Date.now();
    if (s.dis && typeof s.dis === 'object') Object.keys(s.dis).forEach((k) => { const t = Number(s.dis[k]); if (/^[A-Za-z0-9_.:-]{1,64}$/.test(k) && isFinite(t) && now - t < 60 * 864e5) out.dis[k] = t; });
    if (Array.isArray(s.seen)) s.seen.forEach((x) => { const v = x && typeof x === 'object' ? valid({ id: x.id, title: x.title, body: x.body, link: x.link, at: typeof x.at === 'number' ? new Date(x.at).toISOString() : '' }, false) : null; if (v) { if (x.t) { v.t = 1; v.o = typeof x.o === 'string' ? x.o : ''; } out.seen.push(v); } });
    return out;
  }
  function save(s) { try { localStorage.setItem(K, JSON.stringify(s)); } catch (e) {} }
  let ST = load(), CUR = [null, null], asked = false;
  // "Hide" in My Apps: the server always answers with the LATEST message that is still live. So anything saved here that is newer than that answer (or anything
  // at all when the answer is "none") was hidden or has ended, and leaves the list too. Only called after a GOOD answer. own = the answer for this account.
  function prune(a, own) { ST = load(); const me = mine(), n = ST.seen.length; ST.seen = ST.seen.filter((x) => { const aimed = !!x.t; if (own ? !(aimed && x.o === me) : aimed) return true; return !!a && (x.id === a.id || x.at <= a.at); }); if (ST.seen.length !== n) save(ST); }
  function remember(a) { if (!a) return; ST = load(); ST.seen = ST.seen.filter((x) => x.id !== a.id); ST.seen.push(a); ST.seen.sort((x, y) => y.at - x.at); ST.seen = ST.seen.slice(0, KEEP); save(ST); }
  const listed = () => ST.seen.filter((x) => !x.t || x.o === mine());
  // ---- where a message opens ----
  function go(link) {
    const k = LINKS[link]; if (!k) return;
    try {
      if (PAGES[k]) { location.href = PAGES[k]; return; }
      const d = document.querySelector('header details.dsc'); if (d) d.open = false;
      if (typeof window.setView === 'function') window.setView(k === 'home' ? 'main' : k);
    } catch (e) {}
  }
  const when = (t) => { try { return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // One card. o.dismiss = function for the Dismiss button (none = no button); o.open === false = the Open button does nothing (owner's preview).
  function card(a, o) {
    o = o || {}; const c = el('section', 'annc'); c.setAttribute('aria-label', 'Message from Oddable');
    c.appendChild(el('div', 'annt', '📣 ' + a.title)); c.appendChild(el('div', 'annb', a.body));
    const f = el('div', 'annf'); f.appendChild(el('span', 'annd', when(a.at))); const bs = el('span', 'annbs');
    if (a.link && LINKS[a.link]) { const b = el('button', 'anno', 'Open'); b.type = 'button'; if (o.open !== false) b.onclick = () => go(a.link); bs.appendChild(b); }
    if (o.dismiss) { const x = el('button', 'annx', '✕ Dismiss'); x.type = 'button'; x.onclick = o.dismiss; bs.appendChild(x); }
    f.appendChild(bs); c.appendChild(f); return c;
  }
  function css() {
    if (document.getElementById('anncss')) return; const st = document.createElement('style'); st.id = 'anncss';
    st.textContent = '.annc{background:var(--panel,#121a33);color:var(--ink,#eee);border:1px solid var(--line,#fff3);border-left:5px solid #4f8cff;border-radius:14px;padding:12px 14px;margin:10px 0 12px;font:15px/1.4 system-ui,-apple-system,sans-serif;text-align:left;min-width:0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;word-break:break-word}'
      + '.annc .annt{font-weight:800;font-size:16px;line-height:1.3}.annc .annb{margin:6px 0 2px;max-width:80ch;white-space:normal}'
      + '.annc .annf{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}.annc .annd{font-size:12px;opacity:.75}.annc .annbs{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto}'
      + '.annc .anno,.annc .annx,#odash .annc .anno,#odash .annc .annx{min-height:44px;min-width:44px;padding:8px 16px;border-radius:10px;font:700 14px system-ui,-apple-system,sans-serif;cursor:pointer;margin:0}'
      + '.annc .anno,#odash .annc .anno{background:#0b3d91;border:1px solid #2f66c9;color:#fff}.annc .annx,#odash .annc .annx{background:var(--panel2,#1a2340);border:1px solid var(--line,#fff3);color:var(--ink,#eee)}'
      + '.annc.dlc{border-left-color:#e0a100}#dlc .annf{justify-content:flex-start}#dlc .annbs{margin-left:0}#annm{margin:8px 0 2px}#annm>summary{display:flex;align-items:center;min-height:44px;font-size:13px}#annm .annc{margin:6px 0;border-left-width:3px}#annm .annc .annt{font-size:14px}#annm .annc .annb{font-size:13px}';
    document.head.appendChild(st);
  }
  // ---- the card at the top of the page (normal page flow: first thing inside <main>, under the header; nothing floats) ----
  function paint() {
    const main = document.querySelector('main'); if (!main) return;
    const pick = CUR.filter((a) => a && !ST.dis[a.id]).sort((x, y) => y.at - x.at)[0] || null;
    let box = document.getElementById('annc');
    if (!pick) { if (box) box.remove(); } else {
      css(); if (!box) { box = document.createElement('div'); box.id = 'annc'; const dl = document.getElementById('dlc'); main.insertBefore(box, dl ? dl.nextSibling : main.firstChild); } // the days-left card, when there is one, stays first
      if (box.getAttribute('data-id') !== pick.id) { box.textContent = ''; box.setAttribute('data-id', pick.id); box.appendChild(card(pick, { dismiss: () => { ST = load(); ST.dis[pick.id] = Date.now(); save(ST); paint(); } })); }
    }
    history();
  }
  // ---- Disclosures -> "Messages from Oddable": the last 14 days on this device, so a dismissed one can be read again ----
  function history() {
    const d = document.querySelector('header details.dsc'); if (!d) return; const L = listed(); let m = document.getElementById('annm');
    if (!L.length) { if (m) m.remove(); return; }
    css(); const was = m ? m.open : false; if (!m) { m = document.createElement('details'); m.id = 'annm'; d.appendChild(m); }
    m.textContent = ''; m.appendChild(el('summary', '', '📣 Messages from Oddable (' + L.length + ')')); L.forEach((a) => m.appendChild(card(a, {}))); m.open = was;
  }
  // ---- Days-left card (same slot, same look, always ABOVE a message). Drawn from gate.js oddMe(), which the gate already has from /acct/me: no request is made here.
  // Shown to a signed-in account that HAS an end date and is still open: every day of the last 5 days (5,4,3,2,1, ends today), and on each Monday however far the
  // end is. "Not today" hides it for this account until tomorrow (localStorage `odd-dlc` = account|date). No end date (free for now) = nothing, ever.
  const DK = 'odd-dlc', p2 = (n) => (n < 10 ? '0' : '') + n;
  const today = () => { const n = new Date(); return n.getFullYear() + '-' + p2(n.getMonth() + 1) + '-' + p2(n.getDate()); };
  function days() {
    const main = document.querySelector('main'); if (!main) return;
    let m = null; try { m = typeof window.oddMe === 'function' ? window.oddMe() : null; } catch (e) {}
    let box = document.getElementById('dlc'); const d = m ? m.days : null, stamp = m ? m.acct + '|' + today() : '';
    const show = !!m && m.allowed && m.ends && !m.pending && typeof d === 'number' && d >= 0 && (d <= 5 || new Date().getDay() === 1) && g(DK) !== stamp;
    if (!show) { if (box) box.remove(); return; }
    const key = stamp + '|' + d + '|' + m.text + '|' + m.price; if (box && box.getAttribute('data-k') === key) return;
    css(); if (!box) { box = document.createElement('div'); box.id = 'dlc'; main.insertBefore(box, main.firstChild); }
    box.textContent = ''; box.setAttribute('data-k', key);
    const c = el('section', 'annc dlc'); c.setAttribute('aria-label', 'Days left');
    c.appendChild(el('div', 'annt', '⏳ ' + m.text)); c.appendChild(el('div', 'annb', 'Keep your picks and bets.' + (m.price > 0 ? ' $' + (m.price % 1 ? m.price.toFixed(2) : m.price) + ' a month.' : '')));
    const f = el('div', 'annf'), bs = el('span', 'annbs');
    const pay = el('button', 'anno', 'Pay now'); pay.type = 'button'; pay.onclick = () => { try { if (window.oddPay) window.oddPay(); } catch (e) {} }; bs.appendChild(pay);
    if (d <= 5 && m.canAsk) { const rq = el('button', 'annx', 'Request free time'); rq.type = 'button'; rq.onclick = () => { try { if (window.oddTimeBox) window.oddTimeBox(); } catch (e) {} }; bs.appendChild(rq); }
    const no = el('button', 'annx', '✕ Not today'); no.type = 'button'; no.onclick = () => { try { localStorage.setItem(DK, stamp); } catch (e) {} box.remove(); }; bs.appendChild(no);
    f.appendChild(bs); c.appendChild(f); box.appendChild(c);
  }
  window.oddDays = days; // gate.js calls it each time the account is read
  try { document.addEventListener('visibilitychange', () => { if (!document.hidden) days(); }); } catch (e) {} // a phone left open over midnight
  function targeted() {
    if (asked) return; const tok = g('odd-tok'); if (!tok) return; asked = true; // signed out (or no accounts yet): no call at all. v270: a guest who signs up or in without a reload (guest mode) is asked once then (index.html runs bcLoad again after a sign-in)
    let ctl = null, to = null; try { ctl = new AbortController(); to = setTimeout(() => ctl.abort(), 8000); } catch (e) {}
    fetch(API, { headers: { 'x-token': tok }, cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then((r) => (r.ok ? r.json() : null)).then((j) => { clearTimeout(to); if (g('odd-tok') !== tok || !j || j.ok !== true) return; let a = valid(j.announce, true); prune(a, true); if (a && CUR[0] && CUR[0].id === a.id) a = null; /* the same message everyone got */ CUR[1] = a; if (a) remember(a); paint(); }).catch(() => { clearTimeout(to); });
  }
  // Called by bcLoad (index.html) with the /appcfg answer. A failed /appcfg read never gets here, and then nothing is shown and nothing more is asked.
  window.oddAnn = function (cfg) {
    try { if (!cfg || cfg.ok !== true) return; const a = valid(cfg.announce, false); CUR[0] = a; prune(a, false); if (a) remember(a); paint(); targeted(); } catch (e) {}
  };
  window.oddAnnCard = function (a, o) { css(); return card(a, o); }; // the owner's preview in the dashboard draws the very same card
  window.oddAnnLinks = LINKS;
  try { if (window.ODDCFG) window.oddAnn(window.ODDCFG); else history(); } catch (e) {}
  try { days(); } catch (e) {}
  // A phone alert opens "/?open=bets" or "/?open=live": go to that screen once the app is up, and clean the address.
  try { const m = /[?&]open=(bets|live)(&|$)/.exec(location.search); if (m) setTimeout(() => { try { window.history.replaceState(null, '', location.pathname); } catch (e) {} try { if (typeof window.setView === 'function') window.setView(m[1]); } catch (e) {} }, 1200); } catch (e) {}
})();
