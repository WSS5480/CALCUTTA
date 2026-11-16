// Oddable "Start a game" sport catalog (v1, Nov 16 2026). Overlay #ocat (z-index 96: above Groups 95, below an event 97, above the My Bets banner 40).
// Data: pics/games-catalog.json (static). Each game: one-line + full ⓘ text + status (now / soon / planned) + results (live feed / scorer enters / to be confirmed).
// Only "Available now" games start a create flow; the others show their explanation and a disabled button. Uses the styles of pics/events.js (window.OddEvents.css).
(function () {
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const att = (x) => esc(String(x == null ? '' : x).replace(/[^\w.-]/g, ''));
  let C = null, sport = 'pickleball', mode = 'own', view = null, from = '', errMsg = '';
  const el = () => document.getElementById('ocat');
  const S = () => C.sports.find((x) => x.key === sport) || C.sports[0];
  const gameName = (g) => g.name || C.games[g.key].name;
  function infoOf(g) { // full how-it-works text
    const base = C.games[g.key], k = C.localInfoKey[g.key], I = (window.OddEvents && window.OddEvents.INFO) || {};
    const F = window.OddEvents && window.OddEvents.infoFor, sp = (g.start && g.start.sport) || sport, T = (x) => (F ? F(x, sp) : I[x]); // help text accurate for the sport (pickleball rulebook wording only in pickleball)
    let t = base.info || (k ? T(k) : '') || base.line; if (g.key === 'elim' && T('de')) t = T('se') + ' Double elimination: ' + T('de');
    return t + (g.note ? ' ' + g.note : '');
  }
  const badge = (st) => '<span class="ebadge ' + (st === 'now' ? 'eg' : st === 'soon' ? 'ey' : 'ep') + '">' + esc(C.status[st]) + '</span>';
  const rbadge = (r) => '<span class="ebadge ep">' + esc(C.results[r]) + '</span>';
  function list() {
    const sp = S(), modes = [...new Set(sp.games.map((g) => g.mode))]; if (!modes.includes(mode)) mode = modes[0];
    let h = '<h1>Start a game</h1><p class="esub">Pick a sport, then a game. Tap ⓘ on any game to see how it works.</p>';
    h += '<label class="elab" for="csp">Sport<select id="csp" class="esel">' + C.sports.map((x) => '<option value="' + att(x.key) + '"' + (x.key === sport ? ' selected' : '') + '>' + esc(x.long) + '</option>').join('') + '</select></label>';
    h += '<div class="e2">' + ['pickleball', 'golf', 'football', 'basketball'].map((k) => { const x = C.sports.find((y) => y.key === k); return '<button class="esec' + (k === sport ? ' on' : '') + '" aria-pressed="' + (k === sport) + '" data-csp="' + k + '">' + esc(x.name) + '</button>'; }).join('') + '</div>';
    if (modes.length > 1) h += '<div class="eseg">' + [['own', 'Our own event'], ['pro', 'Pro events']].map(([k, l]) => '<button class="' + (k === mode ? 'on' : '') + '" aria-pressed="' + (k === mode) + '" data-mode="' + k + '">' + l + '</button>').join('') + '</div>';
    h += '<div class="enote">' + esc(sp.leagues) + ' · ' + esc(C.results[sp.feed]) + (sp.feedNote ? '. ' + esc(sp.feedNote) : '') + '</div>';
    sp.games.forEach((g, i) => {
      if (g.mode !== mode) return;
      h += '<div class="ecard' + (g.gold ? ' egoldc' : g.status !== 'now' ? ' esoon' : '') + '"><div class="erow"><button class="egame" style="flex:1;min-width:0;background:none;border:0;padding:0;min-height:44px" data-g="' + i + '"><b>' + esc(gameName(g)) + '</b></button><button class="eib" aria-label="How ' + esc(gameName(g)) + ' works" data-g="' + i + '">ⓘ</button></div>';
      h += '<button class="egame" style="width:100%;background:none;border:0;padding:0" data-g="' + i + '"><span class="emut">' + esc(C.games[g.key].line) + '</span><span class="erow" style="justify-content:flex-start;margin-top:6px">' + badge(g.status) + rbadge(g.results) + '</span></button></div>';
    });
    return h + '<p class="enote">' + esc(C.potLine) + '</p><p class="enote">' + esc(C.capLine) + '</p><p class="enote">' + esc(C.entLine) + '</p>';
  }
  function detail() {
    const sp = S(), g = sp.games[view];
    let h = '<h1>' + esc(gameName(g)) + '</h1><div class="emeta">' + esc(sp.long) + ' · ' + (g.mode === 'own' ? 'Our own event' : 'Pro events') + '</div><div class="erow" style="justify-content:flex-start;margin:8px 0">' + badge(g.status) + rbadge(g.results) + '</div>';
    h += '<div class="ecard"><h2>How it works</h2><div>' + esc(infoOf(g)) + '</div></div>';
    h += '<div class="ecard"><div class="ekv"><span>' + esc(C.status[g.status]) + '<small>' + esc(C.statusInfo[g.status]) + '</small></span></div><div class="ekv"><span>' + esc(C.results[g.results]) + '<small>' + esc(C.resultsInfo[g.results]) + '</small></span></div><div class="ekv"><span>Invite link<small>' + esc(C.invite) + '</small></span></div></div>';
    if (g.status === 'now') {
      const pick = g.start && g.start.pick; if (pick) h += '<label class="elab">Game<select id="cpick" class="esel">' + pick.map((k) => '<option value="' + att(k) + '">' + esc({ cornhole: 'Cornhole', darts: 'Darts', bowling: 'Bowling', pool: 'Pool (billiards)', other: 'Something else' }[k]) + '</option>').join('') + '</select></label>';
      h += '<button class="epri efull" data-a="start">Start ' + esc(gameName(g)) + '</button>';
    } else h += '<button class="epri efull" disabled aria-disabled="true">' + esc(C.status[g.status]) + '</button>';
    if (errMsg) h += '<div class="eerr">' + esc(errMsg) + '</div>';
    return h + '<p class="enote">' + esc(C.potLine) + ' ' + esc(C.capLine) + '</p><p class="enote">' + esc(C.entLine) + '</p>';
  }
  function paint() {
    const x = el(); if (!x) return;
    const back = view != null ? '<button class="eback" data-a="list">‹ Start a game</button>' : from ? '<button class="eback" data-a="close">‹ ' + esc(from) + '</button>' : '<span></span>';
    const topH = '<div class="etop">' + back + '<button class="ex" data-a="close" aria-label="Close">Close</button></div>', body = !C ? '<h1>Start a game</h1><div class="ecard">' + (errMsg ? esc(errMsg) : 'Loading games…') + '</div>' : view != null ? detail() : list();
    x.querySelector('.ein0').innerHTML = window.OddEvents && window.OddEvents.head ? window.OddEvents.head(topH, body) : topH + body; // the app's gradient header
  }
  function start() {
    const g = S().games[view], st = g.start || {}; errMsg = '';
    if (st.kind === 'event') { if (!window.OddEvents) { errMsg = 'Events did not load. Pull to refresh.'; paint(); return; } const p = document.getElementById('cpick'); window.OddEvents.create({ sport: p ? p.value : st.sport, fmt: st.fmt, pickem: !!st.pickem, low: !!st.low, unitLabel: st.unitLabel }); return; }
    if (st.kind === 'group') { if (window.oddGroupsCreate) { close(); window.oddGroupsCreate(); } else if (window.oddGroups) { close(); window.oddGroups(); } return; }
  }
  function close() { const x = el(); if (x) x.remove(); try { sessionStorage.removeItem('ocat-open'); } catch (e) {} }
  function click(ev) {
    const t = ev.target.closest('button'); if (!t || t.disabled) return; const a = t.getAttribute('data-a');
    if (a === 'close') { close(); return; } if (a === 'list') { view = null; errMsg = ''; paint(); el().scrollTop = 0; return; } if (a === 'start') { start(); return; }
    if (t.hasAttribute('data-csp')) { sport = t.getAttribute('data-csp'); paint(); return; }
    if (t.hasAttribute('data-mode')) { mode = t.getAttribute('data-mode'); paint(); return; }
    if (t.hasAttribute('data-g')) { view = +t.getAttribute('data-g'); errMsg = ''; paint(); el().scrollTop = 0; }
  }
  window.oddCatalog = function (o) {
    if (window.OddEvents) window.OddEvents.css(); let x = el(); if (x) x.remove();
    x = document.createElement('div'); x.id = 'ocat'; x.className = 'oo'; x.setAttribute('role', 'dialog'); x.setAttribute('aria-label', 'Start a game'); x.innerHTML = '<div class="ein0"></div>'; document.body.appendChild(x);
    x.style.zIndex = String(1 + Math.max(95, ...Array.from(document.querySelectorAll('#ogrp,#oevt,#ocat,#odash')).filter((y) => y !== x).map((y) => +getComputedStyle(y).zIndex || 0))); // always on top of the overlay it was opened from
    x.addEventListener('click', click); x.addEventListener('change', (ev) => { if (ev.target.id === 'csp') { sport = ev.target.value; paint(); } });
    from = (o && o.from) || (document.getElementById('ogrp') ? 'Groups' : document.getElementById('oevt') ? 'My events' : ''); view = null; if (o && o.sport) sport = o.sport;
    try { sessionStorage.setItem('ocat-open', '1'); } catch (e) {}
    paint(); if (!C) fetch('games-catalog.json?v=1').then((r) => r.json()).then((j) => { C = j; errMsg = ''; paint(); }).catch(() => { errMsg = 'Could not load the games list. Pull to refresh.'; paint(); });
  };
})();
