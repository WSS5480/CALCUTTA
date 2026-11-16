// Oddable merged build: ONE look and the glue between the engines' screens (integration owner, Nov 16 2026). Loaded BEFORE groups.js / calcutta.js /
// golf.js / events.js / catalog.js / stats.js. Not preview-only: it belongs on main with the merged engines.
//   OddLook.head(top, body)   one header-bar pattern for every overlay: [Back | Close] row + the screen title + its one sub line, inside the band
//   shared CSS                the band (--band / --onband / --bandline from index.html's theme blocks), readable gold (--gold), text on --blue buttons
//                             (--onblue), in all three themes (navy, violet light, violet dark)
//   OddGames.open(type, ref)  open an attached game from a group (calc | golf | event)
//   OddGames.startFor(group, kind)  the commissioner's "+ Add a Calcutta / golf contest / local event": opens that engine's own create flow and, when
//                             the game is created, adds it to the group (POST /integrate/attach). The engines are not changed: their create calls are watched.
//   OddLook.toast(text)       a short message at the bottom that never covers the bottom bar
(function () {
  const API = (window.ODD_GROUPS_API || location.origin + '');
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---------- one header band ----------
  // body starts with <h1>…</h1> and maybe ONE short line (<p class="?sub">, <div class="?meta|?sub">): they move into the band with the top row.
  function head(topHtml, body, mid) {
    const m = /^\s*(?:<div class="[a-z]row">\s*)?(<h1[^>]*>[\s\S]*?<\/h1>)/.exec(body || ''); let cut = 0, inner = '';
    if (m && !/^\s*<div class="[a-z]row">/.test(body)) { cut = m[0].length; inner = m[1]; const r = /^\s*<(p|div) class="[a-z]?(?:sub|meta)"[^>]*>(?:(?!<\/?(?:p|div)[ >])[\s\S])*?<\/\1>/.exec(body.slice(cut)); if (r) { inner += r[0]; cut += r[0].length; } }
    return '<div class="oband">' + topHtml + inner + '</div>' + (mid || '') + (body || '').slice(cut);
  }
  const st = document.createElement('style'); st.id = 'oddlook';
  const BANDS = '#ogrp .oband,#ocalc .oband,#ogolf .ohdr,#oevt .ehead,#ocat .ehead,#ostat .shead,#opv .pvtop';
  const each = (list, suffix) => list.split(',').map((x) => x + suffix).join(',');
  st.textContent = ''
    // the band itself
    + BANDS + '{background:var(--band)!important;color:var(--onband)!important;border-bottom:3px solid var(--bandline)!important;border-radius:0 0 22px 22px!important;box-shadow:none!important}'
    + '#ostat .stop.shtop{background:var(--band0)!important;color:var(--onband)!important}#ostat .shead{border-top:0!important}'
    + '#ogrp .oband,#ocalc .oband{margin:0 -16px 12px;padding:max(8px,env(safe-area-inset-top)) 16px 12px}#ogrp .oband{margin-left:-12px;margin-right:-12px;padding-left:12px;padding-right:12px}'
    + '#ogrp .oband .gtop,#ocalc .oband .ctop{position:static!important;margin:0!important;padding:0!important;background:none!important;border:0!important;border-radius:0!important;box-shadow:none!important;min-height:44px}'
    // everything written on the band is readable on it
    + each(BANDS, ' h1') + ',' + each(BANDS, ' b') + ',' + each(BANDS, ' button') + ',#ostat .stop.shtop button{color:var(--onband)!important}'
    + each(BANDS, ' p') + ',' + each(BANDS, ' small') + ',' + each(BANDS, ' i') + ',' + each(BANDS, ' em') + ',' + each(BANDS, ' span') + ',' + each(BANDS, ' div') + ',' + each(BANDS, ' a') + '{color:var(--onband)!important;opacity:1!important}'
    + '#ogrp .oband h1,#ocalc .oband h1{margin:6px 0 2px!important}#ogrp .oband .gsub,#ocalc .oband .csub,#ogrp .oband .gmeta,#ocalc .oband .cmeta{margin:0!important}'
    + '#ostat .shead .schips button{background:rgba(255,255,255,.14)!important;border-color:rgba(255,255,255,.5)!important;color:var(--onband)!important}#ostat .shead .schips button.on{background:#fff!important;color:#1b1340!important;border-color:#fff!important}'
    + '#ocalc .oband .cx,#ocalc .oband .cback,#ogrp .oband .gx,#ogrp .oband .gback{background:none!important;border:0!important}'
    // text on a --blue button (violet themes; the navy theme's buttons are navy with white text)
    + 'html:not(.cb) #ogrp .gpri,html:not(.cb) #ocalc .cpri,html:not(.cb) #ostat .spri,html:not(.cb) #ogolf .opri,html:not(.cb) #oevt .epri,html:not(.cb) #ocat .epri,html:not(.cb) #ovoice .vpri{background:var(--blue)!important;border-color:var(--blue)!important;color:var(--onblue)!important}'
    // gold as TEXT follows the theme (borders and fills keep the bright gold)
    + '#ogrp .ggold,#ocalc .cgold,#ogolf .ogold,#oevt .egold,#ostat .sgold,#ostat .sy,#ogrp .gbadge.gside,#ogrp .gy{color:var(--gold)!important}'
    + '#oddtoast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(96px + env(safe-area-inset-bottom));z-index:400;max-width:min(92vw,480px);padding:12px 16px;border-radius:14px;background:var(--ink,#111);color:var(--bg,#fff);font:600 15px/1.35 system-ui,-apple-system,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);text-align:center}'
    + '#oddfor{position:sticky;top:0;z-index:5;margin:0;padding:10px 14px;background:var(--panel2,#1b1f29);color:var(--ink,#eee);border-bottom:1px solid var(--line,#333);font:600 14px/1.35 system-ui,-apple-system,sans-serif;display:flex;gap:10px;align-items:center;justify-content:space-between}#oddfor button{flex:none;min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--line,#333);background:none;color:inherit;font:700 14px system-ui}';
  document.head.appendChild(st);
  function toast(text, ms) { let t = document.getElementById('oddtoast'); if (t) t.remove(); t = document.createElement('div'); t.id = 'oddtoast'; t.setAttribute('role', 'status'); t.textContent = text; document.body.appendChild(t); setTimeout(() => { if (t.parentNode) t.remove(); }, ms || 4500); }
  window.OddLook = { head, toast };

  // ---------- games inside a group ----------
  const OVER = { calc: ['#ocalc', () => window.oddCalc && window.oddCalc()], golf: ['#ogolf', () => window.oddGolf && window.oddGolf()], event: ['#oevt', () => window.oddEvents && window.oddEvents()] };
  // tap a card in an overlay's list once it has loaded (the engines have no "open this id" call of their own, except Calcutta)
  function tapWhenThere(sel, find, tries) { const e = [...document.querySelectorAll(sel)].find(find); if (e) { e.click(); return; } if ((tries || 0) < 25) setTimeout(() => tapWhenThere(sel, find, (tries || 0) + 1), 200); }
  function open(type, ref) {
    if (type === 'calc' && window.oddCalc) return window.oddCalc({ id: ref });
    const o = OVER[type]; if (!o) return toast('That game cannot be opened here yet.');
    o[1](); const id = String(ref).replace(/^golf:/, '');
    tapWhenThere(o[0] + ' [data-a="open"]', (e) => [e.getAttribute('data-id'), e.getAttribute('data-g'), e.getAttribute('data-e')].includes(id));
  }
  let FOR = null; // { gid, gname, type } while the commissioner is creating a game for a group
  function banner() {
    let b = document.getElementById('oddfor'); if (b) b.remove(); if (!FOR) return; const host = document.querySelector(OVER[FOR.type][0]); if (!host) return;
    b = document.createElement('div'); b.id = 'oddfor'; b.innerHTML = '<span>Creating this for <b>' + esc(FOR.gname) + '</b>. It is added to the group when you create it.</span><button type="button">Not for the group</button>';
    b.querySelector('button').onclick = () => { FOR = null; banner(); }; host.insertBefore(b, host.firstChild);
  }
  function startFor(group, kind) {
    const type = kind === 'golf' ? 'golf' : kind === 'event' ? 'event' : 'calc'; FOR = { gid: group.id, gname: group.name, type };
    if (type === 'calc') { if (!window.oddCalc) return toast('Calcutta is not loaded.'); window.oddCalc(); tapWhenThere('#ocalc [data-a="create"]', () => true); }
    else if (type === 'golf') { if (!window.oddGolf) return toast('Golf is not loaded.'); window.oddGolf(); }
    else { if (window.OddEvents && window.OddEvents.create) window.OddEvents.create({}); else if (window.oddCatalog) window.oddCatalog({ from: 'Groups' }); else return toast('Local events are not loaded.'); }
    setTimeout(banner, 60); setTimeout(banner, 700);
  }
  async function attach(type, ref, name) {
    const f = FOR; FOR = null; banner(); if (!f || !ref) return;
    try {
      const r = await fetch(API + '/integrate/attach', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify({ groupId: f.gid, type, ref }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
      toast('Added to ' + f.gname + ': ' + (j.name || name || 'your game') + '. It shows under the group’s contests.'); window.__oddGroupsStale = true;
    } catch (e) { toast('Created, but it could not be added to ' + f.gname + ': ' + e.message, 7000); }
  }
  // watch the engines' own create calls: a successful one while "creating for a group" attaches the new game
  const realFetch = window.fetch;
  window.fetch = function (u, o) {
    const p = realFetch.apply(this, arguments);
    try { const url = String(u && u.url ? u.url : u), m = /\/(calcutta|golf|events)\/create(?:$|\?)/.exec(url);
      if (m && FOR && ((m[1] === 'calcutta' && FOR.type === 'calc') || (m[1] === 'golf' && FOR.type === 'golf') || (m[1] === 'events' && FOR.type === 'event'))) p.then((r) => { if (!r.ok) return; r.clone().json().then((j) => { const x = j.calc || j.game || j.event; if (x && x.id) attach(FOR ? FOR.type : null, x.id, x.name || x.title); }).catch(() => {}); }).catch(() => {});
    } catch (e) {}
    return p;
  };
  // leaving the engine's overlay without creating anything drops the "for the group" note
  document.addEventListener('DOMContentLoaded', () => new MutationObserver(() => { if (FOR && !document.querySelector(OVER[FOR.type][0])) FOR = null; if (window.__oddGroupsStale && !document.querySelector('#ocalc,#ogolf,#oevt,#ocat') && document.getElementById('ogrp') && window.OddGroups && typeof window.OddGroups.refresh === 'function') { window.__oddGroupsStale = false; window.OddGroups.refresh(); } }).observe(document.body, { childList: true }));
  window.OddGames = { open, startFor };
})();
