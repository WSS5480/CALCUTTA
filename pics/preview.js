// TEST PREVIEW ONLY (branch `preview`). Not part of the live app.
//  - "TEST PREVIEW, not live" ribbon in its own strip above everything (the app and every overlay start below it, so it never covers UI)
//  - Demo user switcher (commissioner / player / tournament director): POST /preview/as on the preview server, then reload as that person
//  - 🎮 Play hub (#opv): one door to Groups, Calcutta, Golf, Start a game, My events, My stats, My handicap, Partner suggestions, Tournament handicaps
//  - Screens whose engine is not committed yet say "Preview: in progress" and read stand-in routes (/preview/pairing, /preview/hcp)
// Money is display only. Nothing is collected, held or paid.
(function () {
  const API = 'https://oddable-preview-api.onrender.com';
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const s = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = (n) => (n == null || !Number.isFinite(+n) ? '' : (n < 0 ? '-$' : '$') + Math.abs(+n).toFixed(2).replace(/\.00$/, ''));
  const signed = (n) => (n == null || !Number.isFinite(+n) ? '' : (n > 0 ? '+' : n < 0 ? '-' : '') + '$' + Math.abs(+n).toFixed(2).replace(/\.00$/, ''));
  async function post(path, body) {
    const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'Error ' + r.status); e.status = r.status; throw e; } return j;
  }
  // ---------- styles ----------
  const st = document.createElement('style');
  st.textContent = ':root{--pvh:calc(30px + env(safe-area-inset-top))}'
    + '#pvrib{position:fixed;top:0;left:0;right:0;height:var(--pvh);box-sizing:border-box;padding:env(safe-area-inset-top) 8px 0;z-index:1000;background:#f5c542;color:#1a1300;font:700 12px/30px system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:space-between;gap:8px;white-space:nowrap;transform:translate3d(0,0,0)}'
    + '#pvrib span{overflow:hidden;text-overflow:ellipsis}#pvrib button{flex:none;height:24px;min-width:44px;padding:0 10px;border-radius:999px;border:1px solid #1a1300;background:#1a1300;color:#f5c542;font:700 12px system-ui;max-width:55vw;overflow:hidden;text-overflow:ellipsis}'
    + '#sc{top:var(--pvh)!important}#plb{top:calc(var(--pvh) + 10px)!important}#ogrp,#ocalc,#ogolf,#oevt,#ocat,#odash,#opv,#gate,#oddwarn,#gnm{top:var(--pvh)!important}@media(min-width:900px){.bn{top:var(--pvh)!important}}'
    + '#opv,#pvpick{position:fixed;inset:0;background:var(--bg,#0b1020);color:var(--ink,#eee);overflow:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font:15px/1.4 system-ui,-apple-system,sans-serif}#opv{z-index:94}#pvpick{z-index:900;top:var(--pvh)}'
    + '.pvin{max-width:560px;margin:0 auto;padding:0 14px calc(48px + env(safe-area-inset-bottom))}.pvtop{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;min-height:52px;margin:0 -14px 10px;padding:6px 14px;background:#041e42;color:#fff}'
    + '.pvtop b{font-size:18px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pvtop button{min-height:44px;min-width:44px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.4);background:none;color:#fff;font:700 14px system-ui}'
    + '.pvc{display:block;width:100%;box-sizing:border-box;text-align:left;margin:0 0 10px;padding:12px 14px;border-radius:14px;border:1px solid var(--line,#2b3f66);background:var(--panel,#121a33);color:inherit;font:inherit}button.pvc{min-height:56px}'
    + '.pvc h3{margin:0 0 2px;font-size:16px}.pvc p{margin:0;color:var(--muted,#8fa0bf);font-size:13px}.pvr{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}.pvr>*{min-width:0}'
    + '.pvtag{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:#f5c542;color:#1a1300;font:700 11px system-ui;vertical-align:middle;white-space:nowrap}.pvok{background:#4fd18b}'
    + '.pvg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 10px}.pvt{min-height:76px;padding:10px 12px;border-radius:14px;border:1px solid var(--line,#2b3f66);background:var(--panel,#121a33);color:inherit;font:inherit;text-align:left}'
    + '.pvt small{display:block;color:var(--muted,#8fa0bf);font-size:12px}.pvt b{display:block;font-size:20px;margin-top:2px}.pvt i{font-style:normal;font-size:12px;color:var(--muted,#8fa0bf)}'
    + '.pvh{margin:16px 0 8px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#8fa0bf)}.pvw{color:#4fd18b}.pvl{color:#ff7a70}.pvm{color:var(--muted,#8fa0bf)}'
    + '.pvsel{width:100%;min-height:44px;margin:0 0 10px;padding:8px 10px;border-radius:10px;border:1px solid var(--line,#2b3f66);background:var(--panel,#121a33);color:inherit;font:inherit}'
    + '.pvbtn{min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid var(--line,#2b3f66);background:#0b3d91;color:#fff;font:700 14px system-ui}.pvbtn.alt{background:none;color:inherit}'
    + '.pvchips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}.pvchips button{min-height:44px;padding:6px 14px;border-radius:999px;border:1px solid var(--line,#2b3f66);background:none;color:inherit;font:700 13px system-ui}.pvchips button.on{background:#0b3d91;color:#fff;border-color:#0b3d91}'
    + '.pvnote{margin:0 0 10px;padding:10px 12px;border-radius:12px;border:1px dashed #f5c542;font-size:13px}.pvin input{width:100%;box-sizing:border-box;min-height:44px;margin:4px 0 8px;padding:8px 10px;border-radius:10px;border:1px solid var(--line,#2b3f66);background:var(--bg,#0b1020);color:inherit;font:inherit}';
  document.head.appendChild(st);
  const WIP = '<span class="pvtag">Preview: in progress</span>';

  // ---------- ribbon + demo user ----------
  const ROLE = () => g('pv-role'), WHO = () => { try { return JSON.parse(g('pv-user') || 'null'); } catch (e) { return null; } };
  function ribbon() {
    let r = document.getElementById('pvrib'); if (!r) { r = document.createElement('div'); r.id = 'pvrib'; document.body.appendChild(r); }
    const u = WHO(); r.innerHTML = '<span>TEST PREVIEW, not live</span><button id="pvsw" aria-label="Switch demo user">' + (u ? '👤 ' + esc(u.name) + ' · ' + esc(u.label) + ' ▾' : '👤 Demo user ▾') + '</button>';
    document.getElementById('pvsw').onclick = () => picker(true);
  }
  let USERS = null;
  async function users() { if (USERS) return USERS; const r = await fetch(API + '/preview/status', { cache: 'no-store' }); const j = await r.json(); USERS = j; return j; }
  async function become(role) {
    const j = await post('/preview/as', { role });
    if (window.oddWipe) window.oddWipe();
    try { ['odd-noauto', 'odd-dash', 'odd-dt', 'odd-join'].forEach((k) => localStorage.removeItem(k)); sessionStorage.clear(); } catch (e) {}
    s('odd-tok', j.token); s('sync-phone', j.phone); s('sync-pin', j.pin); s('sync-owner', j.phone); s('odd-name', j.user.name); s('odd-ok', String(Date.now())); s('odd-gate', '1');
    s('pv-role', j.user.role); s('pv-user', JSON.stringify(j.user)); s('pv-ids', JSON.stringify(j.ids || {}));
    location.href = location.pathname;
  }
  function picker(canClose) {
    let p = document.getElementById('pvpick'); if (p) p.remove(); p = document.createElement('div'); p.id = 'pvpick';
    p.innerHTML = '<div class="pvin"><div class="pvtop"><b>Who do you want to be?</b>' + (canClose ? '<button id="pvx">Close</button>' : '') + '</div><div class="pvnote">This is a <b>test copy</b> of the new Oddable with made-up people, bets and scores. Nothing here touches the live app, and no money is ever collected or paid.</div><div id="pvul"><div class="pvc">Waking the test server… this can take up to a minute the first time.</div></div></div>';
    document.body.appendChild(p); if (canClose) document.getElementById('pvx').onclick = () => p.remove();
    const load = (n) => users().then((j) => {
      const row = (u) => '<button class="pvc" data-role="' + esc(u.role) + '"><h3>' + esc(u.label) + ': ' + esc(u.name) + (u.role === ROLE() ? ' <span class="pvtag pvok">you now</span>' : '') + '</h3><p>' + esc(u.blurb || 'Another member of the demo group.') + '</p></button>';
      document.getElementById('pvul').innerHTML = j.users.map(row).join('') + '<details style="margin:6px 0 10px"><summary style="min-height:44px;line-height:44px">More demo players</summary>' + j.others.map(row).join('') + '</details>'
        + '<div class="pvc"><p>' + (j.seeded ? 'Demo data is ready.' : 'Demo data is still loading; pick someone in a few seconds.') + ' The data is rebuilt whenever the test server restarts, so anything you add may not be there tomorrow.</p><p id="pverr" class="pvl"></p></div>';
      p.querySelectorAll('[data-role]').forEach((b) => { b.onclick = () => { b.disabled = true; become(b.getAttribute('data-role')).catch((e) => { b.disabled = false; document.getElementById('pverr').textContent = e.message; }); }; });
    }).catch(() => { USERS = null; if (n < 12 && document.getElementById('pvpick') === p) setTimeout(() => load(n + 1), 6000); else if (document.getElementById('pvul')) document.getElementById('pvul').innerHTML = '<div class="pvc">Could not reach the test server. <button class="pvbtn" onclick="location.reload()">Try again</button></div>'; });
    load(0);
  }

  // ---------- overlay shell with a screen stack (Back always returns to where you were) ----------
  let stack = [];
  const el = () => document.getElementById('opv');
  function open(first) { let e = el(); if (e) e.remove(); e = document.createElement('div'); e.id = 'opv'; e.setAttribute('role', 'dialog'); e.innerHTML = '<div class="pvin"></div>'; document.body.appendChild(e); e.addEventListener('click', click); e.addEventListener('change', change); stack = [first]; paint(); }
  function close() { const e = el(); if (e) e.remove(); stack = []; }
  const push = (x) => { const e = el(); if (stack.length) stack[stack.length - 1].y = e ? e.scrollTop : 0; stack.push(x); paint(); if (e) e.scrollTop = 0; };
  const back = () => { if (stack.length > 1) { stack.pop(); paint(); const e = el(); if (e) e.scrollTop = stack[stack.length - 1].y || 0; } else close(); };
  const top = (title) => '<div class="pvtop"><button data-a="back" aria-label="Back">' + (stack.length > 1 ? '‹ Back' : '✕ Close') + '</button><b>' + title + '</b></div>';
  function paint() { const e = el(); if (!e || !stack.length) return; const sc = stack[stack.length - 1]; e.firstChild.innerHTML = SCREENS[sc.t](sc); }

  const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th');
  // ---------- screens ----------
  const SCREENS = {
    hub() {
      const u = WHO() || {}, ids = (() => { try { return JSON.parse(g('pv-ids') || '{}'); } catch (e) { return {}; } })();
      const card = (a, icon, title, text, tag) => '<button class="pvc" data-a="' + a + '"><h3>' + icon + ' ' + title + (tag || '') + '</h3><p>' + text + '</p></button>';
      let h = top('🎮 Play') + '<div class="pvnote">You are <b>' + esc(u.name || '?') + '</b> (' + esc(u.label || '') + '). Use the yellow bar at the top to switch person.</div>';
      h += '<div class="pvh">Play with your people</div>';
      h += card('go-groups', '👥', 'Groups', 'Contests on real bets, main pot and side pots, invite people. Demo group: Valley Sharps.');
      h += card('go-calc', '🏆', 'Calcutta', 'Live auction or enter results, payouts from final scores. Demo: a Main and a Side Calcutta.');
      h += card('go-golf', '⛳', 'Golf', 'Pro pools and golf days: scrambles, best ball, skins, heads-up. Demo: Saturday scramble.');
      h += card('go-catalog', '🏓', 'Start a game', 'Every sport and format with how it works: pickleball, cornhole, tennis and more.');
      h += card('go-events', '📅', 'My events', 'Round robins, brackets, ladders and pick\'em. Demo: Friday pickleball round robin.');
      h += '<div class="pvh">Me</div>';
      h += card('me', '📈', 'My stats', 'Every play you are in: bets, contests, Calcuttas, golf, events. Totals drill down to the plays.');
      h += card('hcp', '🏌️', 'My handicap', 'Oddable Handicap Index from real app rounds, last 20 rounds, Post a round, course handicap calculator.');
      h += card('log', '✍️', 'Log my play', 'Keep your own results: a golf round, a pickleball match, any game. One-player games count.');
      h += '<div class="pvh">Coming together</div>';
      h += card('pair', '🤝', 'Suggest partners', 'Balanced, Rotate or Hot pairs for scrambles and doubles. It only suggests; people choose.', WIP);
      h += card('thcp', '🎯', 'Tournament handicaps', 'Enterprise directors can add or change a handicap for one tournament. The real-results number always stays visible.', WIP);
      h += card('voice', '🎤', 'Log my score by voice', 'Speak a score, check the card, save. Needs the AI key, which this test copy does not have.', WIP);
      h += card('status', 'ℹ️', 'What is in this test copy', 'Which parts are finished, which are still being built, and where the demo data came from.');
      return h;
    },
    status() {
      let h = top('About this test copy') + '<div class="pvc"><h3>TEST PREVIEW, not live</h3><p>Runs on its own test server with made-up data kept in memory. It never reads or writes the live database, never uses an Odds API credit (lines come from free sources and saved files only), and never collects, holds or pays money.</p></div>';
      if (!ST) { users().then((j) => { ST = j; paint(); }).catch(() => {}); return h + '<div class="pvc">Loading…</div>'; }
      h += '<div class="pvh">Demo data</div>' + ST.steps.map((x) => '<div class="pvc"><div class="pvr"><h3>' + esc(x.name) + '</h3>' + (x.ok ? '<span class="pvtag pvok">ready</span>' : '<span class="pvtag">not ready</span>') + '</div>' + (x.err ? '<p>' + esc(x.err) + '</p>' : '') + '</div>').join('');
      h += '<div class="pvh">Built and in this copy</div>' + ['Server picks, 1-hour freeze, parlays, actual prices, Move the line (v252/v253)', 'Groups: contests, main and side pots, server grading, invites, 8-person limit, Enterprise contact', 'Calcutta: setup, live auction, enter results, payouts, buy-back half option', 'Golf: pro pools, golf days in every format, heads-up, courses', 'Local events: pickleball and more, round robin, brackets, ladder, pick\'em, sport catalog', 'My stats: personal dashboard with drill-downs, My handicap (WHS method), Oddable rating, Log my play, guests'].map((x) => '<div class="pvc"><p>✅ ' + esc(x) + '</p></div>').join('');
      h += '<div class="pvh">Preview: in progress</div>' + ['Suggest partners (Balanced / Rotate / Hot pairs): test version here', 'Tournament handicaps set by an Enterprise director: test version here', 'Group bets lock the moment they are added (G16): being built', 'Voice score logging: server part is built, the phone screen is not, and this copy has no AI key', 'Golf handicaps flowing into strokes, flights and pairings automatically (H1)'].map((x) => '<div class="pvc"><p>🚧 ' + esc(x) + '</p></div>').join('');
      return h;
    },
    pair(sc) {
      let h = top('🤝 Suggest partners') + '<div class="pvnote">' + WIP + ' Test version. It only suggests; people choose.</div>';
      h += '<div class="pvchips">' + [['golf', '⛳ Golf scramble'], ['pickleball', '🏓 Pickleball doubles']].map(([k, l]) => '<button data-a="psport" data-v="' + k + '" class="' + ((sc.sport || 'golf') === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
      h += '<div class="pvchips">' + [['balanced', 'Balanced'], ['rotate', 'Rotate'], ['hot', 'Hot pairs']].map(([k, l]) => '<button data-a="pmode" data-v="' + k + '" class="' + ((sc.mode || 'balanced') === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
      const key = (sc.sport || 'golf') + '|' + (sc.mode || 'balanced');
      if (sc.key !== key) { sc.key = key; sc.d = null; sc.err = ''; post('/preview/pairing', { sport: sc.sport || 'golf', mode: sc.mode || 'balanced' }).then((j) => { sc.d = j; paint(); }).catch((e) => { sc.err = e.message; paint(); }); }
      if (sc.err) return h + '<div class="pvc">' + esc(sc.err) + '</div>'; if (!sc.d) return h + '<div class="pvc">Working it out…</div>';
      h += '<div class="pvc"><p>' + esc(sc.d.how) + '</p></div><div class="pvh">Players</div><div class="pvc">' + sc.d.players.map((p) => '<div class="pvr" style="padding:4px 0"><span>' + esc(p.name) + '</span><b>' + esc(p.show) + '</b></div>').join('') + '</div><div class="pvh">Suggestions, best first</div>';
      h += sc.d.suggestions.map((x, i) => '<div class="pvc"><h3>' + (i + 1) + '. ' + x.teams.map((t) => esc(t.names.join(' + ')) + ' <span class="pvm">(' + esc(t.show) + ')</span>').join('<br>vs ') + '</h3><p>' + esc(x.reason) + '</p></div>').join('');
      return h;
    },
    thcp(sc) {
      let h = top('🎯 Tournament handicaps') + '<div class="pvnote">' + WIP + ' Test version of the Enterprise rule: a director can add or change a handicap for one tournament. The Oddable number from real results always stays next to it.</div>';
      if (!sc.d && !sc.err) { post('/preview/hcp', { op: 'get' }).then((j) => { sc.d = j; paint(); }).catch((e) => { sc.err = e.message; paint(); }); }
      if (sc.err) return h + '<div class="pvc">' + esc(sc.err) + '</div>'; if (!sc.d) return h + '<div class="pvc">Loading…</div>';
      const d = sc.d; h += '<div class="pvc"><h3>' + esc(d.title) + '</h3><p>' + esc(d.when) + ' · ' + (d.locked ? 'Started: handicaps are locked.' : 'Handicaps can change until the first tee time.') + '</p><p>' + (d.canEdit ? 'You are the tournament director. Tap a player to add or change.' : 'Only the tournament director (Pro Shop Pat, Enterprise) can change these. Switch demo user to try it.') + '</p></div>';
      h += d.players.map((p, i) => '<' + (d.canEdit && !d.locked ? 'button data-a="thedit" data-i="' + i + '"' : 'div') + ' class="pvc"><h3>' + esc(p.name) + (p.me ? ' <span class="pvtag pvok">you</span>' : '') + '</h3><p style="color:inherit;font-size:14px">' + esc(p.line) + '</p>' + (p.tour != null ? '<p>Set by tournament' + (p.log && p.log.length ? ' · ' + esc(p.log[p.log.length - 1].why || '') : '') + '</p>' : '') + '</' + (d.canEdit && !d.locked ? 'button' : 'div') + '>').join('');
      if (d.log && d.log.length) h += '<div class="pvh">Change log</div>' + d.log.slice().reverse().map((x) => '<div class="pvc"><p>' + esc(x.at) + ' · ' + esc(x.by) + ' set ' + esc(x.player) + ' from ' + esc(x.old == null ? 'none' : x.old) + ' to ' + esc(x.val) + (x.why ? ' · ' + esc(x.why) : '') + '</p></div>').join('');
      return h;
    },
    thedit(sc) {
      const p = sc.p; return top('Set handicap') + '<div class="pvc"><h3>' + esc(p.name) + '</h3><p style="color:inherit">' + esc(p.line) + '</p></div><div class="pvc"><label>Tournament handicap<input id="pvtv" type="number" inputmode="decimal" step="0.1" value="' + esc(p.tour != null ? p.tour : p.odd != null ? p.odd : '') + '"></label><label>Reason (members can see it)<input id="pvtw" maxlength="80" placeholder="For example: club handicap, committee decision"></label><button class="pvbtn" data-a="thsave">Save for this tournament</button> <button class="pvbtn alt" data-a="thclear">Remove tournament number</button><p id="pvte" class="pvl"></p><p>This changes only this tournament. The player\'s Oddable Handicap Index is not changed.</p></div>';
    },
    voice() { return top('🎤 Log my score by voice') + '<div class="pvnote">' + WIP + '</div><div class="pvc"><h3>How it will work</h3><p>Tap the mic, say "Ray made a 5 on hole 7" or "we won 11 to 8", check the card Oddable shows you, then Save. The save goes through the normal score entry, so the other team still confirms.</p></div><div class="pvc"><p>The server part is built and tested. The phone screen is still being built, and this test copy has no AI key on purpose, so nothing can be spoken here yet.</p></div>'; },
  };
  function click(ev) {
    const t = ev.target.closest('[data-a]'); if (!t) return; const a = t.getAttribute('data-a'), sc = stack[stack.length - 1];
    if (a === 'back') return back();
    if (a === 'go-groups') return window.oddGroups && window.oddGroups();
    if (a === 'go-calc') return window.oddCalc && window.oddCalc();
    if (a === 'go-golf') return window.oddGolf && window.oddGolf();
    if (a === 'go-catalog') return window.oddCatalog && window.oddCatalog({ from: 'Play' });
    if (a === 'go-events') return window.oddEvents && window.oddEvents();
    if (a === 'me') return window.oddStats && window.oddStats();
    if (a === 'hcp') return window.oddStats && window.oddStats({ t: 'hcp' });
    if (a === 'log') return window.oddStats && window.oddStats({ t: 'log' });
    if (['pair', 'thcp', 'voice', 'status'].includes(a)) return push({ t: a });
    if (a === 'psport') { sc.sport = t.getAttribute('data-v'); return paint(); }
    if (a === 'pmode') { sc.mode = t.getAttribute('data-v'); return paint(); }
    if (a === 'thedit') return push({ t: 'thedit', p: sc.d.players[+t.getAttribute('data-i')] });
    if (a === 'thsave' || a === 'thclear') { const v = a === 'thclear' ? null : document.getElementById('pvtv').value; post('/preview/hcp', { op: 'set', pid: sc.p.pid, value: v, why: document.getElementById('pvtw').value }).then(() => { stack.pop(); const p = stack[stack.length - 1]; p.d = null; paint(); }).catch((e) => { document.getElementById('pvte').textContent = e.message; }); return; }
  }
  function change() {}
  window.oddHub = () => open({ t: 'hub' });
  window.oddPreview = { open: (t) => open({ t }), picker, become };

  // ---------- start ----------
  function start() {
    ribbon();
    const q = /[?&]as=([a-z0-9]+)/.exec(location.search); // ?as=player opens the copy as that demo person (handy for sharing a link to one view)
    if (q && q[1] !== ROLE()) { become(q[1]).catch(() => picker(false)); return; }
    if (!ROLE() || !g('odd-tok')) { picker(false); return; }
    // the test server forgets everything when it restarts: if the saved sign-in is no longer known, sign the same demo person in again without asking
    post('/acct/me', {}).catch((e) => { if (e.status === 401) become(ROLE()).catch(() => picker(false)); });
    const o = /[?&]open=([a-z]+)/.exec(location.search); if (o && SCREENS[o[1]]) setTimeout(() => open({ t: o[1] }), 600);
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
