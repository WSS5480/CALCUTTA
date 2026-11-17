// Oddable Golf days, phone side (v273). A GROUP GAME: this file is fetched by pics/groups.js the first time a member taps the "Golf day" tile of a group,
// so only an account the server switched Groups on for ever gets it (GROUPS_ENABLED / GROUPS_OWNER_ONLY / GROUPS_TESTERS). Server: odds-api/golfday.js.
// It draws inside the Groups overlay (#ogrp) and uses its stack (‹ Back), its one-call-at-a-time `act` (an ended account gets the same lock card) and its
// classes. Screens: Golf day home (the open day, earlier days), start a Golf day (the commissioner: course from the Golf GPS search, date, format, holes,
// par and stroke index), the day (tiles: Leaderboard, Players, Rules, Changes; Golf GPS for the course; Join; Log my score; Close), the leaderboard (a row
// opens that player's card), a card, Log my score, players, rules, the change log.
// NO MONEY: no entry, no payout, nothing is collected, held, paid or ordered, and nothing is sent to anyone.
// Rules (manager defaults, HANDOFF "## v273"): gross / net / Stableford; 18, front 9 or back 9; each member types his own playing strokes; a member enters
// only his own scores; the commissioner may correct a hole (logged); ties share a place; the commissioner closes the day.
(function () {
  if (window.OddGolfDay) return;
  const FORMATS = [['gross', 'Stroke play (gross)'], ['net', 'Stroke play (net)'], ['stableford', 'Stableford (net points)']], FNAME = Object.fromEntries(FORMATS);
  const HOLES = [['all', '18 holes'], ['front', 'Front 9'], ['back', 'Back 9']], HNAME = Object.fromEntries(HOLES);
  const NEED_SI = 'Net and Stableford are not offered yet: they need a stroke index on every hole (1 to 18, each used once). Type them in below, or play stroke play gross.';
  const holesOf = (h) => (h === 'front' ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : h === 'back' ? [10, 11, 12, 13, 14, 15, 16, 17, 18] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  const isInt = (v, a, b) => typeof v === 'number' && Number.isInteger(v) && v >= a && v <= b;
  const DAYS = {}; let LIST = null, DR = null, TIMER = 0, SEARCHING = false;

  const css = () => {
    if (document.getElementById('ogdcss')) return; const st = document.createElement('style'); st.id = 'ogdcss';
    st.textContent = '#ogrp .ogda{display:block;box-sizing:border-box;width:100%;min-height:48px;margin:8px 0;padding:12px 14px;border-radius:14px;font-weight:800;font-size:16px;text-align:center;text-decoration:none;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);color:inherit}'
      + '#ogrp .ogdl{background:var(--panel,#121a33);border:1px solid var(--line,#fff2);border-radius:14px;padding:4px 14px;margin:0 0 12px}'
      + '#ogrp .ogdlh,#ogrp .ogdlr{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:10px;align-items:center;width:100%;box-sizing:border-box;padding:10px 0;border:0;border-top:1px solid #8883;background:none;text-align:left;min-height:56px}'
      + '#ogrp .ogdlh{grid-template-columns:minmax(0,1fr) auto;border-top:0;min-height:0;font-size:12px;color:var(--muted,#9aa6c2);text-transform:uppercase;letter-spacing:.05em}#ogrp .ogdlh span:last-child,#ogrp .ogdlr .ogvl{text-align:right}#ogrp .ogdlr.me{background:#2f7bff14}#ogrp .ogdlr .ogvl small{display:block;font-weight:600;font-size:12px;color:var(--muted,#9aa6c2)}'
      // a card (hole by hole): four columns, the header over each one; text left, numbers right. It never scrolls sideways.
      + '#ogrp .ogdt{background:var(--panel,#121a33);border:1px solid var(--line,#fff2);border-radius:14px;padding:4px 14px;margin:0 0 12px}#ogrp .ogdtr{display:grid;grid-template-columns:minmax(0,1.3fr) repeat(3,minmax(0,1fr));gap:8px;align-items:center;padding:9px 0;border-top:1px solid #8883;font-variant-numeric:tabular-nums}'
      + '#ogrp .ogdtr:first-child{border-top:0;font-size:12px;color:var(--muted,#9aa6c2);text-transform:uppercase;letter-spacing:.05em}#ogrp .ogdtr span{text-align:right}#ogrp .ogdtr span:first-child{text-align:left}#ogrp .ogdtr.tot{font-weight:800}#ogrp .ogdtr.off{opacity:.45}'
      // set-up: hole, par, stroke index (three columns, the header over each)
      + '#ogrp .ogbody>.ogcard.ogdw{max-width:none}#ogrp .ogdp{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:0 28px}#ogrp .ogdpr{display:grid;grid-template-columns:minmax(0,1fr) minmax(84px,150px) minmax(84px,150px);gap:10px;align-items:center;padding:4px 0}#ogrp .ogdpr.h{font-size:12px;color:var(--muted,#9aa6c2);text-transform:uppercase;letter-spacing:.05em}#ogrp .ogdpr.h span+span{text-align:right}'
      + '#ogrp .ogdpr select,#ogrp .ogdpr input{width:100%;box-sizing:border-box;min-height:44px;padding:6px 8px;border-radius:10px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);color:var(--ink,#eee);font:600 16px system-ui,-apple-system,sans-serif;text-align:right}'
      // Log my score: a grid of holes and a big stepper
      + '#ogrp .ogdh{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:0 0 12px;align-content:start}#ogrp .ogdh button{min-height:52px;border-radius:12px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);font-weight:800;padding:2px}#ogrp .ogdh button small{display:block;font-weight:600;font-size:12px;color:var(--muted,#9aa6c2)}#ogrp .ogdh button.on{border-color:#2f7bff;box-shadow:0 0 0 2px #2f7bff inset}#ogrp .ogdh button.has small{color:#7ee2a8}'
      + '#ogrp .ogds{display:grid;grid-template-columns:64px minmax(0,1fr) 64px;gap:10px;align-items:center;margin:10px 0}#ogrp .ogds button{min-height:64px;border-radius:16px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);font-size:30px;font-weight:800}#ogrp .ogds b{font-size:44px;text-align:center;font-variant-numeric:tabular-nums}'
      + '#ogrp .ogdres{display:grid;gap:8px;margin:8px 0}#ogrp .ogdres button{min-height:52px;text-align:left;border-radius:12px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);padding:8px 12px}#ogrp .ogdres small{display:block;color:var(--muted,#9aa6c2)}'
      + '#ogrp .ogdlog{padding:9px 0;border-top:1px solid #8883}#ogrp .ogdlog:first-child{border-top:0}#ogrp .ogdlog small{display:block;color:var(--muted,#9aa6c2)}#ogrp select:disabled,#ogrp option:disabled{opacity:.5}'
      + '#ogrp .ogd2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;align-items:start}#ogrp .ogd2>.ogcard{margin:0}'
      + '@media (min-width:768px){#ogrp .ogdh{grid-template-columns:repeat(9,minmax(0,1fr))}#ogrp .ogds{max-width:420px}#ogrp .ogbody>.ogda{max-width:420px}}';
    document.head.appendChild(st);
  };

  // ---------- words ----------
  const toPar = (n) => (n === 0 ? 'E' : n > 0 ? '+' + n : '−' + Math.abs(n));
  const statusOf = (d) => (d.closed ? 'Final' + (d.short ? ' · ' + (d.short === 'front' ? 'front 9' : 'back 9') + ' only' : '') : d.started ? 'In play' : 'Open for joining');
  const valHead = (d) => (d.format === 'stableford' ? 'Points' : d.format === 'net' ? 'Net to par' : 'To par');
  const valOf = (d, r) => (r.none ? '–' : d.format === 'stableford' ? r.pts + ' pts' : toPar(r.toPar));
  const placeOf = (r) => (r.none ? '–' : (r.tied ? 'T' : '') + r.place);
  const thruOf = (r) => (r.none ? 'Not started' : r.done ? 'Finished' : 'Thru ' + r.thru);
  const when = (ms) => { try { return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
  const sub = (X, d) => X.esc(d.course.name + ' · ' + X.fmtDay(d.date) + ' · ' + (FNAME[d.format] || d.format) + ' · ' + (HNAME[d.holes] || ''));
  const keep = (j) => { if (j && j.day) DAYS[j.day.id] = j.day; return j && j.day; };
  const dayOf = (s) => DAYS[s.id] || null;
  const rowOf = (d, pid) => (d.board || []).find((r) => r.pid === pid) || null;

  // ---------- home ----------
  function home(s, X) {
    const gr = s.gr; let h = '<h1>Golf day</h1><p class="ogsub">' + X.esc(gr.name) + ' · Everyone logs their own score on the phone, one leaderboard. No money moves through Oddable.</p>';
    if (!LIST || LIST.g !== gr.id) return h + '<div class="ogcard ogmut">Loading…</div><button type="button" class="ogsec" data-a="gdreload">Try again</button>';
    const cardOf = (d) => '<button type="button" class="ogcard ogbtn" data-a="gdopen" data-id="' + X.att(d.id) + '"><span class="ogrow"><b class="ogname">' + X.esc(d.name) + '</b><span class="ogbadge">' + X.esc(statusOf(d)) + '</span></span><span class="ogmeta">' + X.esc(d.course.name + ' · ' + X.fmtDay(d.date)) + '</span><span class="ogmeta">' + X.esc((FNAME[d.format] || '') + ' · ' + (HNAME[d.holes] || '') + ' · ' + d.players + (d.players === 1 ? ' player' : ' players')) + '</span><span class="oggo">Open ›</span></button>';
    if (LIST.open) h += '<h3 class="ogh">Open now</h3><div class="oggrid">' + cardOf(LIST.open) + '</div>';
    else h += LIST.comm ? '<div class="ogcard">No Golf day is open. Pick the course, the date and the format, then your members join from here.</div><button type="button" class="ogpri" data-a="gdnew">Start a Golf day</button>' : '<div class="ogcard ogmut">No Golf day is open. The commissioner starts one, then you join from here.</div>';
    if (LIST.past.length) h += '<h3 class="ogh">Earlier Golf days</h3><div class="oggrid">' + LIST.past.map(cardOf).join('') + '</div>';
    return h;
  }
  function load(s, X) { X.act('/golfday/list', { g: s.gr.id }, async (j) => { LIST = { g: s.gr.id, comm: !!j.comm, open: j.open || null, past: j.past || [] }; X.paint(); }); }
  function openDay(s, X, id, v) { X.push({ t: 'golf', v: v || 'day', gr: s.gr, id }); X.act('/golfday/get', { g: s.gr.id, id }, async (j) => { keep(j); X.paint(); }); }

  // ---------- start a Golf day (the commissioner) ----------
  const draft = (X) => { const par = {}; for (let h = 1; h <= 18; h++) par[h] = 4; return { q: '', res: null, msg: '', course: null, note: '', name: '', date: X.chiDay(Date.now()), format: 'gross', holes: 'all', par, si: {}, parOk: false }; };
  const siOk = (d) => { const hs = holesOf(d.holes), seen = new Set(); for (const h of hs) { const v = d.si[h]; if (!isInt(v, 1, 18) || seen.has(v)) return false; seen.add(v); } return true; };
  function setup(s, X) {
    const d = DR, ok = siOk(d), hs = holesOf(d.holes);
    let h = '<h1>Start a Golf day</h1><p class="ogsub">' + X.esc(s.gr.name) + ' · No entry, no payout. Members join from the group page and log their own scores.</p>';
    h += '<div class="ogcard ogdw"><b>1. Course</b>';
    if (d.course) h += '<div class="ogrow"><span class="ogname">' + X.esc(d.course.name) + '</span><button type="button" class="ogback" data-a="gdrecourse">Change</button></div>' + (d.note ? '<div class="ogmeta">' + X.esc(d.note) + '</div>' : '');
    else {
      h += '<div class="ogform"><label>Course name or city<input id="gdq" class="ogin" type="search" maxlength="80" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="e.g. McAllen, TX" value="' + X.esc(d.q) + '"></label></div><button type="button" class="ogsec" data-a="gdsearch"' + (SEARCHING ? ' disabled' : '') + '>Search courses</button>';
      if (d.msg) h += '<div class="ogmeta" role="status">' + X.esc(d.msg) + '</div>';
      if (d.res) h += '<div class="ogdres">' + d.res.map((c, i) => '<button type="button" data-a="gdpick" data-i="' + i + '"><b>' + X.esc(c.name) + '</b><small>' + (c.miles != null && isFinite(c.miles) ? X.esc((Math.round(c.miles * 10) / 10) + ' mi · ') : '') + (Number(c.holesMapped) > 0 ? X.esc(c.holesMapped + ' holes drawn on the map') : 'holes not drawn on the map yet') + '</small></button>').join('') + '</div>';
    }
    h += '</div>';
    h += '<div class="ogcard ogform"><label>Name of the day (optional)<input id="gdn" class="ogin" maxlength="30" autocomplete="off" placeholder="' + X.esc(d.course ? d.course.name.slice(0, 30) : 'Saturday game') + '" value="' + X.esc(d.name) + '"></label>'
      + '<label>Date<input id="gdd" class="ogin" type="date" min="' + X.chiDay(Date.now()) + '" value="' + X.esc(d.date) + '"></label>'
      + '<label>Holes' + X.sel('gdh', HOLES, d.holes) + '</label>'
      + '<label>Format<select id="gdf" class="ogsel">' + FORMATS.map(([v, l]) => '<option value="' + v + '"' + (v === d.format ? ' selected' : '') + (v !== 'gross' && !ok ? ' disabled' : '') + '>' + X.esc(l) + '</option>').join('') + '</select></label></div>';
    h += '<div class="ogcard ogmut ogdw" id="gdsi"' + (ok ? ' hidden' : '') + '>' + X.esc(NEED_SI) + '</div>';
    const row = (n) => '<div class="ogdpr"><span>Hole ' + n + '</span><select data-par="' + n + '" aria-label="Par, hole ' + n + '">' + [3, 4, 5, 6].map((p) => '<option' + (d.par[n] === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select><input data-si="' + n + '" type="number" inputmode="numeric" min="1" max="18" step="1" aria-label="Stroke index, hole ' + n + '" placeholder="–" value="' + (isInt(d.si[n], 1, 18) ? d.si[n] : '') + '"></div>';
    const block = (list) => '<div><div class="ogdpr h"><span>Hole</span><span>Par</span><span>Stroke index</span></div>' + list.map(row).join('') + '</div>';
    h += '<div class="ogcard ogdw"><b>2. Par and stroke index</b><div class="ogmeta">' + X.esc(d.course ? d.parNote || '' : 'Every hole starts at par 4. Pick the course first: the map may know the pars.') + ' Stroke index 1 is the hardest hole. Leave it empty to play gross.</div><div class="ogdp">' + (hs.length === 18 ? block(hs.slice(0, 9)) + block(hs.slice(9)) : block(hs)) + '</div>'
      + '<label class="ogck"><input type="checkbox" id="gdok"' + (d.parOk ? ' checked' : '') + '><span>I checked the par of every hole</span></label></div>';
    return h + '<button type="button" class="ogpri" data-a="gdcreate">Start the Golf day</button>';
  }
  function readDraft(X) {
    const e = X.el(), d = DR; if (!d || !e || !e.querySelector('#gdd')) return; const v = (id) => { const x = e.querySelector('#' + id); return x ? x.value : ''; };
    if (e.querySelector('#gdq')) d.q = v('gdq'); d.name = v('gdn'); d.date = v('gdd'); d.holes = v('gdh') || d.holes; d.parOk = !!(e.querySelector('#gdok') || {}).checked;
    e.querySelectorAll('[data-par]').forEach((x) => { d.par[+x.getAttribute('data-par')] = Number(x.value) || 4; });
    e.querySelectorAll('[data-si]').forEach((x) => { const n = +x.getAttribute('data-si'), t = String(x.value).trim(); if (t === '') delete d.si[n]; else d.si[n] = /^\d{1,2}$/.test(t) ? Number(t) : NaN; });
    const f = v('gdf'); d.format = f && (f === 'gross' || siOk(d)) ? f : 'gross';
  }
  // typing in the form: keep what is typed, and offer net / Stableford only while the stroke index is complete (no repaint, so the keyboard stays up)
  function typed(ev, X) {
    const s = X.cur(); if (!s || s.t !== 'golf' || s.v !== 'new' || !DR) return; const e = X.el(), holesWas = DR.holes; readDraft(X);
    if (ev.target && ev.target.id === 'gdh' && DR.holes !== holesWas) return X.paint();
    const ok = siOk(DR), f = e.querySelector('#gdf'), note = e.querySelector('#gdsi'); if (note) note.hidden = ok;
    if (f) { [...f.options].forEach((o) => { o.disabled = o.value !== 'gross' && !ok; }); if (f.value !== DR.format) f.value = DR.format; }
  }
  const gps = (X, then, fail) => { // the Golf GPS data layer (pics/golfgps.js: no screen code in it), fetched once. The SAME course search as the Golf GPS page.
    if (window.GolfGPS) return then(window.GolfGPS);
    const sc = document.createElement('script'); sc.src = 'golfgps.js?v=275'; sc.onload = () => (window.GolfGPS ? then(window.GolfGPS) : fail()); sc.onerror = () => { sc.remove(); fail(); }; document.head.appendChild(sc);
  };
  function search(X) {
    readDraft(X); const d = DR, q = d.q.trim(); if (SEARCHING) return; X.setErr(''); if (q.length < 2) { d.msg = 'Type a course name or a city.'; return X.paint(); }
    SEARCHING = true; d.res = null; d.msg = 'Searching… this can take up to a minute.'; X.paint();
    const done = (msg, res) => { SEARCHING = false; if (DR !== d) return; d.msg = msg; d.res = res || null; const s = X.cur(); if (s.t === 'golf' && s.v === 'new') { readDraft(X); X.paint(); } };
    gps(X, (G) => { G.search({ q }).then((j) => { const list = (Array.isArray(j.courses) ? j.courses : []).filter((c) => c && /^(way|relation|node)\/[1-9]\d{0,14}$/.test(String(c.id)) && c.name).slice(0, 25); done(list.length ? (j.note ? String(j.note) : 'Pick your course:') : 'No course found there. Try the name of the town, or the course name.', list.length ? list : null); }, (e) => done((e && e.message) || 'The search did not answer. Try again.')); },
      () => done('Could not load the course search. Check your signal and try again.'));
  }
  function pick(X, i) {
    readDraft(X); const d = DR, c = d.res && d.res[i]; if (!c) return; X.setErr('');
    d.course = { id: String(c.id), name: String(c.name), lat: c.lat, lon: c.lon }; d.res = null; d.msg = ''; d.note = 'Reading the pars from the course map…'; d.parNote = 'Every hole is set to par 4 until the map answers. Check each one.'; X.paint();
    const fill = (course) => { if (DR !== d || !d.course || d.course.id !== String(c.id)) return; let np = 0, ns = 0; const si = {};
      ((course && course.holes) || []).forEach((h) => { if (!isInt(h.n, 1, 18)) return; if (isInt(h.par, 3, 6)) { d.par[h.n] = h.par; np++; } if (isInt(h.handicap, 1, 18)) { si[h.n] = h.handicap; ns++; } });
      if (ns && !Object.keys(d.si).length) d.si = si; // the map's stroke indexes only when the commissioner has typed none
      d.note = ''; d.parNote = np >= 18 ? 'The pars came from the course map. Check each one.' : np ? 'The course map has the par of ' + np + ' holes; the others are set to 4. Check each one.' : 'The course map has no pars for this course: every hole is set to 4. Check each one.';
      if (ns) d.parNote += ' The map also had a stroke index for ' + ns + (ns === 1 ? ' hole' : ' holes') + ': check them too.';
      const s = X.cur(); if (s.t === 'golf' && s.v === 'new') { readDraftKeep(X, np, ns); X.paint(); } };
    gps(X, (G) => { G.loadCourse(String(c.id)).then(fill, () => fill(null)); }, () => fill(null));
  }
  // while the map was being read the commissioner may have typed a name or a date: keep those, but not the par / stroke index boxes the map just filled
  function readDraftKeep(X, np, ns) { const e = X.el(), d = DR; if (!e || !e.querySelector('#gdd')) return; const v = (id) => { const x = e.querySelector('#' + id); return x ? x.value : ''; }; d.name = v('gdn'); d.date = v('gdd'); d.parOk = false; if (!siOk(d)) d.format = 'gross'; }
  function create(s, X) {
    readDraft(X); const d = DR, hs = holesOf(d.holes);
    if (!d.course) { X.setErr('Pick the course first: search by its name or the city.'); return X.paint(); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.date < X.chiDay(Date.now())) { X.setErr('Pick a date: today or later.'); return X.paint(); }
    if (Object.keys(d.si).some((h) => hs.includes(+h)) && !siOk(d)) { X.setErr('The stroke index is not complete: every hole needs a number from 1 to 18, each used once. Finish it, or empty the boxes to play gross.'); return X.paint(); }
    if (!d.parOk) { X.setErr('Check the par of every hole, then tick "I checked the par of every hole".'); return X.paint(); }
    const par = {}, si = {}; hs.forEach((h) => { par[h] = d.par[h]; si[h] = d.si[h]; });
    X.act('/golfday/create', { g: s.gr.id, name: d.name.trim(), course: d.course, date: d.date, format: d.format, holes: d.holes, par, si: siOk(d) ? si : null, parOk: true }, async (j) => { DR = null; LIST = null; const c = X.cur(); c.v = 'day'; c.id = keep(j).id; X.paint(); });
  }

  // ---------- the day ----------
  function day(s, X) {
    const d = dayOf(s); if (!d) return '<h1>Golf day</h1><div class="ogcard ogmut">Loading…</div>';
    const lead = (d.board || []).find((r) => !r.none), n = d.players;
    let h = '<div class="ogrow"><h1>' + X.esc(d.name) + '</h1><span class="ogbadge">' + X.esc(statusOf(d)) + '</span></div><p class="ogsub">' + sub(X, d) + '</p>';
    h += '<div class="og3">' + X.tile('Leaderboard', lead ? X.esc(lead.name) : 'No scores yet', 'data-a="gdv" data-v="board"', lead ? X.esc(valOf(d, lead) + ' · ' + thruOf(lead)) : X.esc(valHead(d)))
      + X.tile('Players', String(n), 'data-a="gdv" data-v="players"', d.started ? 'Joining is closed' : 'Joining is open')
      + X.tile('Rules', X.esc(d.format === 'stableford' ? 'Stableford' : d.format === 'net' ? 'Net' : 'Gross'), 'data-a="gdv" data-v="rules"', X.esc(HNAME[d.holes] || ''))
      + X.tile('Changes', String((d.log || []).length), 'data-a="gdv" data-v="log"', 'Every correction is listed') + '</div>';
    h += '<div class="oggrid">';
    // my part
    if (d.closed) h += '<div class="ogcard">This Golf day is closed. The leaderboard is final' + (d.short ? ': only the ' + (d.short === 'front' ? 'front' : 'back') + ' 9 count.' : '.') + '</div>';
    else if (d.joined) {
      h += '<div class="ogcard"><b>You are in</b>' + (d.usesHcp ? '<div class="ogmeta">Your playing strokes: <b>' + d.myHcp + '</b></div>' : '');
      if (d.canScore) h += '<button type="button" class="ogpri" data-a="gdv" data-v="score">Log my score</button>'; else h += '<div class="ogmeta">Scores open on the day of the round, ' + X.esc(X.fmtDay(d.scoreFrom)) + '.</div>';
      if (!d.started) h += (d.usesHcp ? '<div class="ogform"><label>Change my playing strokes (0 to 54)<input id="gdhcp" class="ogin" type="number" inputmode="numeric" min="0" max="54" step="1" value="' + d.myHcp + '"></label></div><button type="button" class="ogsec" data-a="gdjoin">Save my playing strokes</button>' : '') + '<button type="button" class="ogdan" data-a="gdleave">Leave this Golf day</button>';
      h += '</div>';
    } else if (d.canJoin) h += '<div class="ogcard"><b>Join this Golf day</b>' + (d.usesHcp ? '<div class="ogform"><label>My playing strokes (0 to 54)<input id="gdhcp" class="ogin" type="number" inputmode="numeric" min="0" max="54" step="1" placeholder="e.g. 12" value="' + X.esc(s.hcp == null ? '' : s.hcp) + '"></label></div><div class="ogmeta">The strokes you get for this round. The commissioner can change the number before the first score; then it is frozen.</div>' : '<div class="ogmeta">Stroke play gross: no playing strokes.</div>') + '<button type="button" class="ogpri" data-a="gdjoin">Join</button></div>';
    else h += '<div class="ogcard ogmut">Joining closed when the first score was logged. You can still follow the leaderboard.</div>';
    // the course on Golf GPS (the existing page)
    h += '<div class="ogcard"><b>' + X.esc(d.course.name) + '</b><div class="ogmeta">Yards to the pin on your phone. Come back to Groups to log your score.</div><a class="ogda" href="golfgps.html?course=' + encodeURIComponent(d.course.id).replace(/%2F/g, '/') + '">📍 Open Golf GPS for this course</a></div>';
    if (d.comm && !d.closed) {
      h += '<div class="ogcard"><b>Commissioner</b>';
      if (!d.started) h += '<div class="ogmeta">No score yet. You can cancel this Golf day, or change a player\'s strokes under Players.</div><button type="button" class="ogdan" data-a="gdcancel">Cancel this Golf day</button>';
      else { h += '<div class="ogmeta">Closing makes the leaderboard final. Nobody can change a score after that.</div><button type="button" class="ogsec" data-a="gdclose" data-s="">Close the Golf day</button>';
        (d.canShort || []).forEach((k) => { h += '<button type="button" class="ogsec" data-a="gdclose" data-s="' + k + '">Close as the ' + (k === 'front' ? 'front' : 'back') + ' 9 only</button>'; });
        if (d.holes === 'all' && !(d.canShort || []).length) h += '<div class="ogmeta">Shortened to 9: possible once every player has all nine of those holes.</div>'; }
      h += '</div>';
    }
    return h + '</div>';
  }
  const ruleRows = (X, d) => [['Course', d.course.name], ['Date', X.fmtDay(d.date)], ['Format', FNAME[d.format]], ['Holes', (HNAME[d.holes] || '') + (d.short ? ' (closed as the ' + d.short + ' 9)' : '')], ['Par', String((d.count || []).reduce((a, h) => a + (d.par[h] || 0), 0))], ['Entry', 'None. Bragging rights only.']].map(([k, v]) => '<div class="ogrw"><span>' + X.esc(k) + '</span><b>' + X.esc(v) + '</b></div>').join('');
  function board(s, X) {
    const d = dayOf(s); if (!d) return '<h1>Leaderboard</h1><div class="ogcard ogmut">Loading…</div>';
    let h = '<h1>Leaderboard</h1><p class="ogsub">' + X.esc(d.name + ' · ' + statusOf(d)) + '</p><div class="ogcols"><div>';
    if (!d.board.length) h += '<div class="ogcard ogmut">Nobody has joined yet.</div>';
    else h += '<div class="ogdl"><div class="ogdlh"><span>Place · player</span><span>' + X.esc(valHead(d)) + '</span></div>' + d.board.map((r) => '<button type="button" class="ogdlr' + (r.pid === d.me ? ' me' : '') + '" data-a="gdcard" data-pid="' + X.att(r.pid) + '"><span class="ogpl">' + placeOf(r) + '</span><span class="ognm"><b>' + X.esc(r.name) + (r.pid === d.me ? ' (you)' : '') + '</b><small>' + X.esc(thruOf(r) + (r.none ? '' : ' · gross ' + r.gross) + (d.usesHcp ? ' · ' + r.hcp + (r.hcp === 1 ? ' stroke' : ' strokes') : '')) + '</small></span><span class="ogvl">' + X.esc(valOf(d, r)) + '<small>card ›</small></span></button>').join('') + '</div>';
    h += '<div class="ogmeta">Ties share a place. An unfinished card is ranked by its score so far.</div><button type="button" class="ogsec" data-a="gdrefresh">Refresh</button></div><div class="ogcard"><b>Rules</b>' + ruleRows(X, d) + '</div></div>';
    return h;
  }
  function card(s, X) {
    const d = dayOf(s), r = d && rowOf(d, s.pid); if (!d || !r) return '<h1>Card</h1><div class="ogcard ogmut">' + (d ? 'This player is not in the Golf day.' : 'Loading…') + '</div>';
    const sc = d.scores[r.pid] || {}, gv = (d.given || {})[r.pid] || {}, cnt = d.count || [], sf = d.format === 'stableford', net = d.format !== 'gross', mine = r.pid === d.me;
    const last = sf ? 'Points' : net ? 'Net' : '+ / −';
    let h = '<h1>' + X.esc(r.name) + (mine ? ' (you)' : '') + '</h1><p class="ogsub">' + X.esc(placeOf(r) === '–' ? 'Not started' : 'Place ' + placeOf(r) + ' · ' + valOf(d, r) + ' · ' + thruOf(r)) + (d.usesHcp ? ' · ' + r.hcp + ' playing strokes' : '') + '</p>';
    h += '<div class="ogcols"><div class="ogdt"><div class="ogdtr"><span>Hole</span><span>Par</span><span>Strokes</span><span>' + last + '</span></div>';
    holesOf(d.holes).forEach((n) => { const v = sc[n], has = isInt(v, 1, 20), g = gv[n] || 0, nv = has ? v - g : null;
      h += '<div class="ogdtr' + (cnt.includes(n) ? '' : ' off') + '"><span>' + n + (g ? ' ' + '•'.repeat(Math.min(g, 3)) : '') + '</span><span>' + d.par[n] + '</span><span>' + (has ? v : '–') + '</span><span>' + (!has ? '–' : sf ? Math.max(0, 2 + d.par[n] - nv) : net ? nv : toPar(v - d.par[n])) + '</span></div>'; });
    h += '<div class="ogdtr tot"><span>Total</span><span>' + r.par + '</span><span>' + (r.none ? '–' : r.gross) + '</span><span>' + (r.none ? '–' : sf ? r.pts : net ? r.net : toPar(r.gross - r.par)) + '</span></div></div><div>';
    if (d.usesHcp) h += '<div class="ogcard ogmut">• = a stroke given on that hole. Par and totals are for the holes played so far.</div>';
    h += '<button type="button" class="ogsec" data-a="mstats" data-pid="' + X.att(r.pid) + '">' + (mine ? 'My stats' : X.esc(r.name) + '\'s group record') + ' ›</button>'; // v274: groups.js opens the lifetime record (a name anywhere opens it)
    if (mine && d.canScore) h += '<button type="button" class="ogpri" data-a="gdv" data-v="score">Log my score</button>';
    const done = holesOf(d.holes).filter((n) => isInt(sc[n], 1, 20));
    if (d.comm && !mine && !d.closed && done.length) h += '<div class="ogcard"><b>Correct a hole (commissioner)</b><div class="ogmeta">Only a hole ' + X.esc(r.name) + ' has entered. The change is shown to everyone under Changes.</div><div class="ogform"><label>Hole' + X.sel('gdfh', done.map((n) => [n, 'Hole ' + n + ' (now ' + sc[n] + ')']), s.fh || done[0]) + '</label><label>Correct strokes<input id="gdfs" class="ogin" type="number" inputmode="numeric" min="1" max="20" step="1" value="' + X.esc(s.fs == null ? '' : s.fs) + '"></label></div><button type="button" class="ogsec" data-a="gdfix">Save the correction</button></div>';
    return h + '</div></div>';
  }
  // ---------- Log my score ----------
  function nextHole(d, from) { const hs = holesOf(d.holes), sc = d.scores[d.me] || {}, i = Math.max(0, hs.indexOf(from)); for (let k = 0; k < hs.length; k++) { const n = hs[(i + k) % hs.length]; if (!isInt(sc[n], 1, 20)) return n; } return from || hs[0]; }
  function score(s, X) {
    const d = dayOf(s); if (!d) return '<h1>Log my score</h1><div class="ogcard ogmut">Loading…</div>';
    if (!d.joined) return '<h1>Log my score</h1><div class="ogcard">Join this Golf day first.</div>';
    if (d.closed) return '<h1>Log my score</h1><div class="ogcard">This Golf day is closed. Scores can no longer be changed.</div>';
    if (!d.canScore) return '<h1>Log my score</h1><div class="ogcard">Scores open on the day of the round, ' + X.esc(X.fmtDay(d.scoreFrom)) + '.</div>';
    const hs = holesOf(d.holes), sc = d.scores[d.me] || {}, me = rowOf(d, d.me); if (!hs.includes(s.h)) { s.h = nextHole(d, hs[0]); s.n = null; }
    const has = isInt(sc[s.h], 1, 20); if (!isInt(s.n, 1, 20)) s.n = has ? sc[s.h] : d.par[s.h];
    const g = ((d.given || {})[d.me] || {})[s.h] || 0;
    let h = '<h1>Log my score</h1><p class="ogsub">' + X.esc(d.name + (me && !me.none ? ' · ' + thruOf(me) + ' · ' + valOf(d, me) + ' · place ' + placeOf(me) : ' · no hole yet')) + '</p>';
    h += '<div class="ogcols"><div class="ogdh" role="group" aria-label="Holes">' + hs.map((n) => '<button type="button" data-a="gdhole" data-h="' + n + '" class="' + (n === s.h ? 'on ' : '') + (isInt(sc[n], 1, 20) ? 'has' : '') + '" aria-label="Hole ' + n + (isInt(sc[n], 1, 20) ? ', ' + sc[n] + ' strokes' : ', no score') + '">' + n + '<small>' + (isInt(sc[n], 1, 20) ? sc[n] : '–') + '</small></button>').join('') + '</div>';
    h += '<div class="ogcard"><b>Hole ' + s.h + '</b><div class="ogmeta">Par ' + d.par[s.h] + (d.si ? ' · stroke index ' + d.si[s.h] : '') + (d.usesHcp ? ' · you get ' + g + (g === 1 ? ' stroke' : ' strokes') : '') + (has ? ' · saved: ' + sc[s.h] : '') + '</div>'
      + '<div class="ogds"><button type="button" data-a="gdstep" data-k="-1" aria-label="One stroke fewer">−</button><b id="gdnum" aria-live="polite">' + s.n + '</b><button type="button" data-a="gdstep" data-k="1" aria-label="One stroke more">+</button></div>'
      + '<button type="button" class="ogpri" data-a="gdsave">' + (has ? 'Change hole ' + s.h + ' to ' : 'Save hole ' + s.h + ': ') + '<span id="gdnum2">' + s.n + '</span></button>' + (has ? '<button type="button" class="ogdan" data-a="gdclear">Clear hole ' + s.h + '</button>' : '') + '</div></div>';
    return h + '<div class="ogmeta">Your score counts at once. You can change a hole until the commissioner closes the day; every change is listed under Changes.</div>';
  }
  function players(s, X) {
    const d = dayOf(s); if (!d) return '<h1>Players</h1><div class="ogcard ogmut">Loading…</div>';
    const edit = d.comm && !d.started && !d.closed;
    let h = '<h1>Players</h1><p class="ogsub">' + X.esc(d.name) + ' · ' + d.players + (d.started ? ' · joining is closed' : ' · joining is open until the first score') + '</p>';
    if (!d.board.length) return h + '<div class="ogcard ogmut">Nobody has joined yet. Members of the group join from the Golf day page.</div>';
    h += '<div class="oggrid">' + d.board.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).map((r) => '<div class="ogcard"><span class="ogrow"><b class="ogname">' + X.esc(r.name) + '</b>' + (r.pid === d.me ? '<span class="ogbadge ogy">You</span>' : '') + '</span><div class="ogmeta">' + (d.usesHcp ? 'Playing strokes: <b>' + r.hcp + '</b> · ' : '') + X.esc(thruOf(r)) + '</div>'
      + (edit ? (d.usesHcp ? '<div class="ogform"><label>Playing strokes (0 to 54)<input class="ogin" type="number" inputmode="numeric" min="0" max="54" step="1" data-hin="' + X.att(r.pid) + '" value="' + r.hcp + '"></label></div><button type="button" class="ogsec" data-a="gdhcp" data-pid="' + X.att(r.pid) + '">Save strokes</button>' : '') + '<button type="button" class="ogdan" data-a="gdremove" data-pid="' + X.att(r.pid) + '">Remove from this Golf day</button>' : '') + '</div>').join('') + '</div>';
    if (d.comm && d.started && !d.closed && d.usesHcp) h += '<div class="ogcard ogmut">Playing strokes are frozen: the first score is in.</div>';
    return h;
  }
  function rules(s, X) {
    const d = dayOf(s); if (!d) return '<h1>Rules</h1><div class="ogcard ogmut">Loading…</div>';
    const L = [d.format === 'gross' ? 'Stroke play gross: the fewest strokes against par wins. No playing strokes are used.' : d.format === 'net' ? 'Stroke play net: your strokes minus the strokes you are given, against par. The number you typed when joining is your playing strokes; they fall on the hardest holes first (stroke index 1, 2, 3…).' : 'Stableford: 2 points for a net par, 3 for a net birdie, 4 for a net eagle, 1 for a net bogey, 0 for worse. Most points wins. The number you typed when joining is your playing strokes; they fall on the hardest holes first.',
      'You enter only your own scores. A score counts at once.', 'You can change your own hole until the day is closed. Every change is listed under Changes.', 'The commissioner can correct a hole a player has entered. Every correction is listed with who, the hole, the old and the new number, and when.',
      d.usesHcp ? 'The commissioner can change a player\'s playing strokes before the first score only (listed under Changes). After the first score they are frozen.' : null, 'Joining is open until the first score is logged. Only members of this group can play.', 'Ties share a place (T2). There is no count-back.', 'A card that is not finished shows "Thru" and is ranked by its score so far.',
      d.holes === 'all' ? 'The commissioner closes the day. An 18-hole day can be closed as the front 9 or the back 9 only, when every player has all nine of those holes: then only those holes count.' : 'The commissioner closes the day.', 'No money: no entry and no payout. Oddable collects nothing and pays nothing.'].filter(Boolean);
    return '<h1>Rules</h1><p class="ogsub">' + X.esc(d.name) + '</p><div class="ogd2"><div class="ogcard">' + ruleRows(X, d) + '</div><div class="ogcard">' + L.map((t) => '<div class="ogdlog">' + X.esc(t) + '</div>').join('') + '</div></div>';
  }
  function logText(x) {
    const st = (v) => (v == null ? '–' : v);
    if (x.kind === 'hcp') return (x.by === x.who ? x.who + ' changed their own playing strokes' : x.by + ' changed ' + x.who + '\'s playing strokes') + ': ' + st(x.old) + ' → ' + st(x.new);
    if (x.kind === 'edit') return x.who + ' changed hole ' + x.hole + ': ' + st(x.old) + ' → ' + st(x.new);
    if (x.kind === 'clear') return x.who + ' cleared hole ' + x.hole + ' (was ' + st(x.old) + ')';
    if (x.kind === 'fix') return x.by + ' (commissioner) corrected ' + x.who + ', hole ' + x.hole + ': ' + st(x.old) + ' → ' + st(x.new);
    if (x.kind === 'remove') return x.by + ' (commissioner) removed ' + x.who + ' before the first score';
    if (x.kind === 'close') return x.by + ' closed the Golf day' + (x.short ? ' as the ' + x.short + ' 9 only' : '');
    return 'Change';
  }
  function log(s, X) {
    const d = dayOf(s); if (!d) return '<h1>Changes</h1><div class="ogcard ogmut">Loading…</div>';
    return '<h1>Changes</h1><p class="ogsub">' + X.esc(d.name) + ' · every change to a score or to playing strokes, newest first</p><div class="ogcard ogdw">' + ((d.log || []).length ? d.log.map((x) => '<div class="ogdlog">' + X.esc(logText(x)) + '<small>' + X.esc(when(x.at)) + '</small></div>').join('') : '<span class="ogmut">No changes. A first score on a hole is not a change.</span>') + '</div>';
  }

  // ---------- what groups.js calls ----------
  function view(s, X) { css(); hook(X); const v = s.v; return v === 'new' ? setup(s, X) : v === 'day' ? day(s, X) : v === 'board' ? board(s, X) : v === 'card' ? card(s, X) : v === 'score' ? score(s, X) : v === 'players' ? players(s, X) : v === 'rules' ? rules(s, X) : v === 'log' ? log(s, X) : home(s, X); }
  function hook(X) { const e = X.el(); if (!e || e.__gd) return; e.__gd = 1; const f = (ev) => { try { typed(ev, X); } catch (x) {} }; e.addEventListener('input', f); e.addEventListener('change', f); poll(X); }
  // A quiet refresh of the open day every 30 s while its page or its leaderboard is on screen (no spinner, nothing typed is lost: those screens have no boxes
  // except the join box, which is kept). Stops with the overlay.
  function poll(X) { stop(); TIMER = setInterval(() => { const s = X.el() && X.cur(); if (!s) return stop(); const d = s.t === 'golf' && (s.v === 'board' || s.v === 'day') ? dayOf(s) : null; if (!d || d.closed || X.busy() || document.hidden || window.__oddLock === 'expired') return;
    const a = document.activeElement; if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    X.post('/golfday/get', { g: s.gr.id, id: s.id }).then((j) => { if (X.cur() !== s || X.busy()) return; const b = document.activeElement; if (b && /^(INPUT|SELECT|TEXTAREA)$/.test(b.tagName)) return; keep(j); X.paint(); }, () => {}); }, 30000); }
  function stop() { if (TIMER) clearInterval(TIMER); TIMER = 0; }
  function open(s, X) { css(); LIST = null; load(s, X); }
  function leave(s, X) { if (s.v === 'new') readDraft(X); }
  // ‹ Back landed on this Golf screen: the home list is read again quietly (a day may have been made, closed or joined meanwhile)
  function back(s, X) { if (s.v !== 'home') return; X.post('/golfday/list', { g: s.gr.id }).then((j) => { LIST = { g: s.gr.id, comm: !!j.comm, open: j.open || null, past: j.past || [] }; if (X.cur() === s && !X.busy()) X.paint(); }, () => {}); }
  function click(a, b, s, X) {
    const d = dayOf(s), gid = s.gr.id, e = X.el(), num = (sel) => { const x = e.querySelector(sel), t = x ? String(x.value).trim() : ''; return /^\d{1,2}$/.test(t) ? Number(t) : NaN; };
    const send = (op, body, then) => X.act('/golfday/' + op, Object.assign({ g: gid, id: s.id }, body), async (j) => { keep(j); if (then) then(j); X.paint(); });
    if (a === 'gdreload') return load(s, X);
    if (a === 'gdopen') return openDay(s, X, b.getAttribute('data-id'));
    if (a === 'gdnew') { DR = DR || draft(X); return X.push({ t: 'golf', v: 'new', gr: s.gr }); }
    if (a === 'gdsearch') return search(X);
    if (a === 'gdpick') return pick(X, +b.getAttribute('data-i'));
    if (a === 'gdrecourse') { readDraft(X); DR.course = null; DR.note = ''; DR.msg = ''; return X.paint(); }
    if (a === 'gdcreate') return create(s, X);
    if (!d) return;
    if (a === 'gdv') { const v = b.getAttribute('data-v'); X.push({ t: 'golf', v, gr: s.gr, id: s.id, pid: v === 'score' ? d.me : undefined }); if (v === 'board' || v === 'log' || v === 'players') X.act('/golfday/get', { g: gid, id: s.id }, async (j) => { keep(j); X.paint(); }); return; }
    if (a === 'gdcard') return X.push({ t: 'golf', v: 'card', gr: s.gr, id: s.id, pid: b.getAttribute('data-pid') });
    if (a === 'gdrefresh') return send('get', {});
    if (a === 'gdjoin') { let hcp = 0; if (d.usesHcp) { hcp = num('#gdhcp'); s.hcp = (e.querySelector('#gdhcp') || {}).value; if (!isInt(hcp, 0, 54)) { X.setErr('Type your playing strokes: a whole number from 0 to 54.'); return X.paint(); } } return send('join', { hcp }); }
    if (a === 'gdleave') { if (!confirm('Leave "' + d.name + '"? You can join again until the first score is logged.')) return; return send('leave', {}); }
    if (a === 'gdcancel') { if (!confirm('Cancel "' + d.name + '" for everyone? No score has been logged.')) return; return X.act('/golfday/cancel', { g: gid, id: s.id }, async () => { delete DAYS[s.id]; LIST = null; X.back(); }); } // back to the Golf day home, which reads the list again
    if (a === 'gdclose') { const k = b.getAttribute('data-s') || ''; if (!confirm(k ? 'Close "' + d.name + '" as the ' + k + ' 9 only? Only those nine holes will count, and nobody can change a score after that.' : 'Close "' + d.name + '"? The leaderboard becomes final and nobody can change a score after that.')) return; return send('close', { short: k }, () => { LIST = null; }); }
    if (a === 'gdhcp') { const pid = b.getAttribute('data-pid'), x = e.querySelector('[data-hin="' + X.att(pid) + '"]'), t = x ? String(x.value).trim() : '', hcp = /^\d{1,2}$/.test(t) ? Number(t) : NaN; if (!isInt(hcp, 0, 54)) { X.setErr('Playing strokes: a whole number from 0 to 54.'); return X.paint(); } return send('hcp', { pid, hcp }); }
    if (a === 'gdremove') { const pid = b.getAttribute('data-pid'), r = rowOf(d, pid); if (!r || !confirm('Remove ' + r.name + ' from "' + d.name + '"? They can join again until the first score is logged.')) return; return send('remove', { pid }); }
    if (a === 'gdfix') { const hole = num('#gdfh'), st = num('#gdfs'); s.fh = hole; s.fs = (e.querySelector('#gdfs') || {}).value; if (!isInt(st, 1, 20)) { X.setErr('Type the correct strokes: a whole number from 1 to 20.'); return X.paint(); } return send('score', { pid: s.pid, hole, strokes: st }, () => { s.fs = null; }); }
    if (a === 'gdhole') { s.h = +b.getAttribute('data-h'); s.n = null; X.setErr(''); return X.paint(); }
    if (a === 'gdstep') { s.n = Math.min(20, Math.max(1, (isInt(s.n, 1, 20) ? s.n : 4) + (+b.getAttribute('data-k')))); const n1 = e.querySelector('#gdnum'), n2 = e.querySelector('#gdnum2'); if (n1) n1.textContent = s.n; if (n2) n2.textContent = s.n; return; }
    if (a === 'gdsave') { const hole = s.h; return send('score', { hole, strokes: s.n }, (j) => { s.h = nextHole(j.day, hole); s.n = null; }); }
    if (a === 'gdclear') { if (!confirm('Clear your score on hole ' + s.h + '?')) return; return send('score', { hole: s.h, strokes: null }, () => { s.n = null; }); }
  }
  window.OddGolfDay = { view, click, open, leave, back, stop, _logText: logText };
})();
