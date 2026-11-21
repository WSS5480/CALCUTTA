// Oddable Groups, phone side (v272, Groups phase 2: owner-only first). Loaded by index.html ONLY when the server said Groups is on for this account
// (`me.groups` from /acct/me, kept in localStorage 'odd-grp'); sports.html loads it the same way for the bet step only. Nobody else ever gets this file.
// Screens (all on the phase 1 server, odds-api/groups.js): my groups, create a group, invite, join with a code or link, the group page, members
// (the commissioner approves requests), the contest (rules + standings), leave / delete. Every tile opens the detail behind it; Back returns.
// Money: none here. Groups made on this screen have no entry and no payout ("bragging rights"); nothing is collected, held or paid, no order is placed and
// no message is sent for anyone (Invite opens the phone's own share sheet, or copies the link). Other members see a name or handle and a short member id:
// never a phone number, an email or a PIN (the server does not send them).
// Bets: while this phone last knew the player is in a group contest, a NEW bet goes to the server first (window.OddGroups.gate). Review blockers fixed here:
//   B1  a bet is refused ("Couldn't reach your group") only when this phone last KNEW the player was in a group. Never knew, or knew "not in a group" = the
//       bet is kept as a personal bet at once, with no call and no wait. The status question waits 6 s (was 20 s).
//   B2  every bet counts for the group (owner decision G16): the confirm step has no "Just for me". A bet no contest can count comes back from the server
//       as `personal: true` and is kept as a personal bet with the server's own sentence.
// v274 (groups-stats): the group page has ONE "Games" tile = the games catalog (the registry GAMES below: Picks contest, Golf day), and "My stats" on the
// Groups home plus a tap on any member's name open that member's group record (POST /groups/stats, odds-api/gstats.js). See HANDOFF "## v274 (groups-stats)".
(function () {
  if (window.OddGroups) return;
  const ROOT = 'https://calcutta-odds.onrender.com', API = ROOT + '/groups/';
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} return null; };
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const att = (x) => String(x == null ? '' : x).replace(/[^\w.-]/g, '');
  const TZ = 'America/Chicago', chiDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms));
  const chiStart = (day) => { for (const off of ['-05:00', '-06:00']) { const t = Date.parse(day + 'T00:00:00' + off); if (chiDay(t) === day && chiDay(t - 1) !== day) return t; } return Date.parse(day + 'T06:00:00Z'); };
  const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const fmtDay = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const SPORTS = [['nfl', 'NFL'], ['ncaaf', 'College football'], ['nba', 'NBA'], ['nhl', 'NHL'], ['ncaab', 'College basketball'], ['mlb', 'MLB'], ['all', 'All sports']], SPORT = Object.fromEntries(SPORTS);
  const RUNS = [['weekend', 'One weekend'], ['w1', 'One week'], ['w2', '2 weeks'], ['w4', '4 weeks'], ['w8', '8 weeks'], ['season', 'Rest of the season']], RUN = Object.assign(Object.fromEntries(RUNS), { w3: '3 weeks', w6: '6 weeks', playoffs: 'Through the playoffs', custom: 'Custom dates' });
  const METRICS = [['units', 'Units won'], ['pct', 'Win %'], ['ret', 'Return %']], MCOL = { win: 'Winnings', units: 'Units', ret: 'Return', pct: 'Win %' };
  const TYPES = [['sp', 'Spread'], ['ml', 'Moneyline'], ['ou', 'Totals (over / under)'], ['prop', 'Player props'], ['parlay', 'Parlays']];
  const MAXM = [2, 3, 4, 5, 6, 7, 8];
  const LOCKNOTE = 'Bets lock when you add them: a group bet is saved to Oddable the moment you add it and cannot be edited or deleted, even before kickoff.';
  const ENDED = () => window.ODD_ENDED || 'Your time has ended. Pay now to unlock your picks, bets and groups.';
  const expired = () => window.__oddLock === 'expired';
  let stack = [{ t: 'home' }], H = null, busy = false, err = '', DR = null, WANT = '';

  // ---------- server ----------
  const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('Failed to fetch')), ms))]);
  async function post(op, b) {
    const r = await fetch(op.charAt(0) === '/' ? ROOT + op : API + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify(Object.assign({ myName: g('odd-name') || '' }, b || {})) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server said ' + r.status), { status: r.status, expired: !!j.expired, off: !!j.off }); return j;
  }
  const errText = (e) => (e && /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Could not reach the server. It may be waking up: try again in a few seconds.' : e && e.status === 401 ? 'Sign in to use Groups.' : (e && e.message) || 'Something went wrong');
  // One call at a time. An ended account (the server says expired) gets the lock card; an account Groups was switched off for is told so.
  async function act(op, b, then) {
    if (busy) return; busy = true; err = ''; paintBusy(true);
    try { const j = await post(op, b); busy = false; await then(j); }
    catch (e) { busy = false; if (e && e.expired) { try { localStorage.setItem('odd-exp', '1'); } catch (x) {} } err = errText(e); paint(); }
    paintBusy(false);
  }

  // ---------- small parts ----------
  const el = () => document.getElementById('ogrp');
  const top = (back) => '<div class="ogtop">' + (back ? '<button type="button" class="ogback" data-a="back">‹ Back</button>' : '<span></span>') + '<button type="button" class="ogx" data-a="close" aria-label="Close Groups">Close</button></div>';
  const tile = (lab, v, a, sub) => '<button type="button" class="ogtile" ' + a + '><small>' + esc(lab) + ' ›</small><b>' + v + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</button>';
  const sel = (id, opts, cur) => '<select id="' + id + '" class="ogsel">' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
  const picks = (gr) => (gr.contests || []).filter((c) => c.kind === 'picks');
  const whenTxt = (gr) => (gr.nopicks ? 'Games' : gr.ended ? 'Final' : gr.started ? 'Running' : 'Starts ' + fmtDay(chiDay(gr.start)));
  const lockCard = () => '<div class="glk big" data-gt="' + (WANT ? 'group:g:' + att(WANT) : 'groups') + '"><span aria-hidden="true">🔒</span><span class="glt">' + esc(ENDED()) + '</span><span class="glb"><button type="button" data-gp="pay">' + esc(window.ODD_PAY || 'Pay now') + '</button><button type="button" class="alt" data-gp="time">Request free time</button></span></div>';
  const cur = () => stack[stack.length - 1];
  const curGroup = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].gr) return stack[i].gr; return null; };
  const setGroup = (gr) => { stack.forEach((s) => { if (s.gr && s.gr.id === gr.id) s.gr = gr; }); if (H) { const i = H.groups.findIndex((x) => x.id === gr.id); if (i >= 0) H.groups[i] = Object.assign({}, H.groups[i], gr); } };

  // ---------- home: my groups ----------
  function home() {
    let s = '<h1>Groups</h1><p class="ogsub">You and your people, one board. Results are graded by Oddable from final scores. No money moves through Oddable.</p>';
    s += '<div class="og2"><button type="button" class="ogpri" data-a="create">Create a group</button><button type="button" class="ogsec" data-a="join">Join with a code</button></div>';
    s += '<div class="og3">' + tile('My stats', '📊 My record', 'data-a="mstats"', 'Finished contests and Golf days') + '</div>'; // v274
    if (!H) return s + '<div class="ogcard ogmut">Loading your groups…</div>';
    s += '<h3 class="ogh">My groups</h3>';
    if (!H.groups.length) s += '<div class="ogcard ogmut">No groups yet. Create one, or open an invite link from a friend.<br>Make the group first, then pick its games (Picks contest, ⛳ Golf day, …).</div>';
    s += '<div class="oggrid">' + H.groups.map((gr) => {
      const P = picks(gr);
      return '<button type="button" class="ogcard ogbtn" data-a="hub" data-id="' + att(gr.id) + '"><span class="ogrow"><b class="ogname">' + esc(gr.name) + '</b><span class="ogbadge">' + esc(whenTxt(gr)) + '</span></span>'
        + '<span class="ogmeta">' + (gr.role === 'comm' ? 'You run this group · ' : '') + gr.count + ' of ' + gr.join.max + ' members' + (P.length ? ' · ' + esc([...new Set(P.map((c) => SPORT[c.sport] || c.sportName))].join(', ')) : '') + '</span>'
        + (gr.role === 'comm' && gr.reqCount ? '<span class="ogmeta ogy">' + gr.reqCount + ' join request' + (gr.reqCount === 1 ? '' : 's') + ' waiting</span>' : '') + '<span class="oggo">Open ›</span></button>';
    }).join('') + '</div>';
    s += '<button type="button" class="ogsec" data-a="mycalc">🏆 My Calcuttas ›</button>'; // calc-live F8
    if (H.pending.length) s += '<h3 class="ogh">Waiting for an answer</h3><div class="oggrid">' + H.pending.map((p) => '<div class="ogcard"><b class="ogname">' + esc(p.name) + '</b><div class="ogmeta">Request sent. The commissioner approves who joins.</div><button type="button" class="ogsec" data-a="cancel" data-id="' + att(p.id) + '">Cancel my request</button></div>').join('') + '</div>';
    return s;
  }
  function loadHome() { act('mine', {}, async (j) => { H = { groups: j.groups || [], pending: j.pending || [] }; blSet(j.betLock); const s = cur(); if (s.t === 'hub' && s.gr) { const n = H.groups.find((x) => x.id === s.gr.id); if (n) s.gr = n; } paint(); if (WANTG) gamesGo(); }); }
  // v283: the what's-new pop-up's "Golf days" / "Group pickleball" items open the Games catalog: straight to a group's Games screen when the person is in
  // exactly ONE group, else My groups (pick a group, then Games). WANTG is cleared by any other way into Groups (open() without keep, a join link).
  let WANTG = false;
  function gamesGo() { WANTG = false; const s = cur(); if (expired() || !H || s.t !== 'home' || stack.length !== 1 || H.groups.length !== 1) return; const gr = H.groups[0]; stack.push({ t: 'hub', gr }); gamesOpen(gr); }
  function openGames() { open(); if (expired()) return; WANTG = true; if (H && !busy) gamesGo(); }

  // ---------- group page ----------
  function hub() {
    const gr = cur().gr, comm = gr.role === 'comm', P = picks(gr), c = P[0];
    let s = '<div class="ogrow"><h1>' + esc(gr.name) + '</h1>' + (comm ? '<span class="ogbadge">Commissioner</span>' : '') + '</div><p class="ogsub">' + esc(whenTxt(gr)) + (gr.commName && !comm ? ' · run by ' + esc(gr.commName) : '') + '</p>';
    s += '<div class="og3">' + tile('Members', gr.count + ' of ' + gr.join.max, 'data-a="members"', comm && gr.reqCount ? gr.reqCount + ' asking to join' : '')
      + tile('Games', GAMES.length + (GAMES.length === 1 ? ' game' : ' games'), 'data-a="games"', esc(runTxt(gr))) // v274: the games catalog; v285: the subtitle says what is RUNNING in the group
      + (c ? tile('Rules', esc(RUN[c.runs] || 'Dates'), 'data-a="rules" data-cid="' + att(c.cid) + '"', esc(fmtDay(c.startDay) + ' to ' + fmtDay(c.endDay))) : '') + '</div>';
    s += '<div class="oggrid">';
    if (!gr.ended && (gr.nopicks || Date.now() < gr.joinUntil)) s += '<div class="ogcard"><b>Invite people</b><div class="ogmeta">' + (comm ? (gr.join.auto ? 'Anyone who opens your link joins straight away.' : 'People who open your link ask to join. You approve each one.') : 'People who open your link ask to join. The commissioner approves each one.') + (gr.nopicks ? '' : ' Joining closes when the contest starts.') + '</div><button type="button" class="ogpri" data-a="invite">Invite</button><div id="ginv"></div></div>';
    else s += '<div class="ogcard ogmut">Joining is closed: the contest has started.</div>';
    if (!gr.nopicks) s += '<div class="ogcard ogmut">' + esc(LOCKNOTE) + ' Every new bet you add to My Bets while a contest runs counts for the group.</div>';
    if (gr.started && !gr.ended) s += '<div class="ogcard ogmut">The group has started. Members stay to the end.</div>';
    s += '</div>';
    if (comm) s += '<button type="button" class="ogdan" data-a="delete">Delete this group</button>'; else if (!gr.started) s += '<button type="button" class="ogdan" data-a="leave">Leave this group</button>';
    return s;
  }
  // ---------- members ----------
  function members() {
    const gr = cur().gr, comm = gr.role === 'comm';
    let s = '<h1>Members</h1><p class="ogsub">' + esc(gr.name) + ' · ' + gr.count + ' of ' + gr.join.max + '</p>';
    if (comm && (gr.reqs || []).length) s += '<h3 class="ogh">Asking to join</h3><div class="oggrid">' + gr.reqs.map((q) => '<div class="ogcard"><b class="ogname">' + esc(q.name) + '</b><div class="ogmeta">Asked ' + esc(new Date(q.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + '</div><div class="og2"><button type="button" class="ogpri" data-a="decide" data-pid="' + att(q.pid) + '" data-ok="1">Approve</button><button type="button" class="ogsec" data-a="decide" data-pid="' + att(q.pid) + '" data-ok="0">Decline</button></div></div>').join('') + '</div>';
    s += '<h3 class="ogh">In the group</h3><div class="oggrid">' + (gr.members || []).map((m) => '<button type="button" class="ogcard ogbtn" data-a="mstats" data-pid="' + att(m.pid) + '"><span class="ogrow"><b class="ogname">' + esc(m.name) + '</b>' + (m.comm ? '<span class="ogbadge">Commissioner</span>' : '') + (m.pid === gr.me ? '<span class="ogbadge ogy">You</span>' : '') + '</span><span class="ogmeta">Joined ' + esc(new Date(m.joined).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + '</span><span class="oggo">Group record ›</span></button>').join('') + '</div>'; // v274: a name opens that member's group record
    return s;
  }
  // ---------- contest: rules, and the standings once it has started ----------
  const cof = (gr, cid) => (gr.contests || []).find((c) => c.cid === cid) || picks(gr)[0];
  function rulesRows(c) {
    const r = c.rules || {}, ty = TYPES.filter(([k]) => r.types && r.types[k]).map(([, l]) => l).join(', ');
    return [['Sport', SPORT[c.sport] || c.sportName], ['Dates', fmtDay(c.startDay) + ' to ' + fmtDay(c.endDay)], ['Ranked by', MCOL[r.metric] || r.metric], ['Bets that count', ty + (r.types && r.types.parlay ? ' (up to ' + r.legs + ' legs)' : '')],
      ['Most bets a week', r.maxBets ? String(r.maxBets) : 'No limit'], ['Entry', 'None. Bragging rights only.']]
      .map(([k, v]) => '<div class="ogrw"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>').join('');
  }
  function rules() { const s = cur(), c = cof(s.gr, s.cid); return '<h1>Rules</h1><p class="ogsub">' + esc(c.name) + ' · ' + (c.locked ? 'locked: the contest has started' : 'they lock when the contest starts') + '</p><div class="oggrid"><div class="ogcard">' + rulesRows(c) + '</div><div class="ogcard ogmut">' + esc(LOCKNOTE) + ' Results are graded by Oddable from final scores, at no better than the market price at kickoff.</div></div>'; }
  const valTxt = (t, m) => (m === 'units' ? (t.units > 0 ? '+' : '') + t.units + 'u' : m === 'ret' ? (t.ret == null ? '–' : (t.ret > 0 ? '+' : '') + t.ret + '%') : m === 'pct' ? (t.pct == null ? '–' : t.pct + '%') : (t.win > 0 ? '+' : '') + t.win);
  function contest() {
    const s = cur(), c = cof(s.gr, s.cid), m = (c.rules || {}).metric;
    let h = '<h1>' + esc(c.name) + '</h1><p class="ogsub">' + esc((SPORT[c.sport] || c.sportName || '') + ' · ' + fmtDay(c.startDay) + ' to ' + fmtDay(c.endDay)) + '</p>';
    const side = '<div class="ogcard"><b>Rules</b>' + rulesRows(c) + '</div>';
    if (!c.started) return h + '<div class="oggrid"><div class="ogcard">Standings start with the first game on ' + esc(fmtDay(c.startDay)) + '. Until then members can still join.</div>' + side + '</div>';
    if (!s.rows) return h + '<div class="ogcard ogmut">Loading the standings…</div>';
    // a list of rows, not a table: place and name left, the ranking number right, the record under the name. Nothing scrolls sideways.
    h += '<div class="ogcols"><div class="ogst"><div class="ogsth"><span>Place · member</span><span>' + esc(MCOL[m] || '') + '</span></div>' + s.rows.map((x) => '<button type="button" class="ogstr' + (x.pid === s.gr.me ? ' me' : '') + '" data-a="mstats" data-pid="' + att(x.pid) + '"><span class="ogpl">' + (x.none ? '–' : (x.tied ? 'T' : '') + x.place) + '</span><span class="ognm"><b>' + esc(x.name) + (x.pid === s.gr.me ? ' (you)' : '') + '</b><small>' + x.t.w + '-' + x.t.l + (x.t.p ? '-' + x.t.p : '') + (x.t.open ? ' · ' + x.t.open + ' open' : '') + ' · record ›</small></span><span class="ogvl">' + esc(valTxt(x.t, m)) + '</span></button>').join('') + '</div>'; // v274: a row opens that member's group record
    return h + side + '</div>';
  }
  // ---------- create ----------
  const draft = () => ({ name: '', sport: 'nfl', day: addDays(chiDay(Date.now()), 1), runs: 'w4', metric: 'units', types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, max: 8, auto: false, legs: 4 });
  function create() { // v284 (owner, Nov 17 10:37 PM CT): the GROUP first (name, size, joining); the games, and the picks contest's sport and dates, are chosen inside it
    const d = DR;
    return '<h1>Create a group</h1><p class="ogsub">Make the group first. Next you pick its games: Picks contest, Golf day and more. No entry, no payout.</p><div class="ogcard ogform">'
      + '<label>Group name<input id="gn" class="ogin" maxlength="30" autocomplete="off" placeholder="Sunday crew" value="' + esc(d.name) + '"></label>'
      + '<label>Most members' + sel('gmx', MAXM.map((n) => [n, n + ' people']), d.max) + '</label></div>'
      + '<div class="oggrid"><div class="ogcard"><label class="ogck"><input type="checkbox" id="gau"' + (d.auto ? ' checked' : '') + '><span>Anyone with my invite link joins without my approval</span></label><div class="ogmeta">Off: people ask to join and you approve each one.</div></div></div><button type="button" class="ogpri" data-a="docreate">Create the group</button>';
  }
  // v284: the old contest fields, now a screen INSIDE the group (Games > Picks contest > Start a picks contest)
  function pcreate() {
    const d = DR, min = addDays(chiDay(Date.now()), 1), gr = cur().gr;
    return '<h1>Start a picks contest</h1><p class="ogsub">' + esc(gr.name) + ' · no entry, no payout. Rules lock when the contest starts.</p><div class="ogcard ogform">'
      + '<label>Sport' + sel('gsp', SPORTS, d.sport) + '</label>'
      + '<label>First day that counts<input id="gd" class="ogin" type="date" min="' + min + '" value="' + esc(d.day) + '"></label>'
      + '<label>Runs for' + sel('gr', RUNS, d.runs) + '</label>'
      + '<label>Ranked by' + sel('gm', METRICS, d.metric) + '</label>'
      + '<label>Parlay legs (if parlays count)' + sel('gleg', [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [n, n + ' legs']), d.legs) + '</label></div>'
      + '<div class="oggrid"><div class="ogcard"><b>Bets that count</b>' + TYPES.map(([k, l]) => '<label class="ogck"><input type="checkbox" data-ty="' + k + '"' + (d.types[k] ? ' checked' : '') + '><span>' + esc(l) + '</span></label>').join('') + '</div>'
      + '<div class="ogcard ogmut">' + esc(LOCKNOTE) + '</div></div><button type="button" class="ogpri" data-a="dopcreate">Start the picks contest</button>';
  }
  function readDraft() { const e = el(), v = (id) => { const x = e && e.querySelector('#' + id); return x ? x.value : ''; }; if (!DR || !e) return;
    if (e.querySelector('#gn')) { DR.name = v('gn'); DR.max = Number(v('gmx')) || 8; DR.auto = !!(e.querySelector('#gau') || {}).checked; }
    if (e.querySelector('#gd')) { DR.sport = v('gsp'); DR.day = v('gd'); DR.runs = v('gr'); DR.metric = v('gm'); DR.legs = Number(v('gleg')) || 4; e.querySelectorAll('[data-ty]').forEach((c) => { DR.types[c.getAttribute('data-ty')] = c.checked; }); } }
  function doCreate() {
    readDraft(); const d = DR;
    if (d.name.trim().length < 2) { err = 'Give the group a name (2 or more characters).'; return paint(); }
    act('create', { name: d.name.trim(), join: { requests: true, open: false, auto: d.auto, max: d.max, late: 'no' }, take: { kind: 'none' }, noContest: true }, // v284: no picks contest yet; the games are picked next
      async (j) => { DR = null; if (H) H.groups.push(j.group); stack = [{ t: 'home' }, { t: 'hub', gr: j.group }]; gamesOpen(j.group, true); blStatus(); });
  }
  function doPcreate() {
    readDraft(); const d = DR, s = cur(), gr = s.gr;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.day) || d.day <= chiDay(Date.now())) { err = 'Pick a first day after today.'; return paint(); }
    if (!Object.values(d.types).some(Boolean)) { err = 'Pick at least one kind of bet that counts.'; return paint(); }
    act('contest/add', { id: gr.id, contest: { cname: 'Picks standings', sport: d.sport, fmt: 'standings', start: chiStart(d.day), runs: d.runs, types: d.types, legs: d.legs, metric: d.metric, minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' } },
      async (j) => { setGroup(j.group); const n = j.group; stack.pop(); stack.forEach((x) => { if (x.gr && x.gr.id === n.id) x.gr = n; }); blStatus(); const t = cur(); if (t.t === 'games') gamesState(t); else paint(); });
  }
  // ---------- join with a code or an invite link ----------
  function join() {
    const s = cur();
    if (s.done) return '<h1>' + (s.done.pending ? 'Request sent' : 'You are in') + '</h1><div class="ogcard">' + esc(s.done.text) + '</div><button type="button" class="ogpri" data-a="' + (s.done.pending ? 'home' : 'hubnew') + '">' + (s.done.pending ? 'Back to my groups' : 'Open the group') + '</button>';
    if (!s.pv) return '<h1>Join a group</h1><p class="ogsub">Type the code from your invite. It looks like ABCD-EFGH.</p><div class="ogcard ogform"><label>Invite code<input id="gcode" class="ogin" maxlength="12" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH" value="' + esc(s.code || '') + '"></label></div><button type="button" class="ogpri" data-a="lookup">Find the group</button>';
    const p = s.pv, c = picks(p)[0], mine = p.role === 'comm' || p.role === 'member';
    let h = '<h1>' + esc(p.name) + '</h1><p class="ogsub">' + (p.commName ? 'Run by ' + esc(p.commName) + ' · ' : '') + p.count + ' of ' + p.join.max + ' members · ' + esc(whenTxt(p)) + '</p>';
    if (c) h += '<div class="ogcard"><b>' + esc(c.name) + '</b>' + rulesRows(c) + '</div>';
    if (mine) return h + '<div class="ogcard">You are already in this group.</div><button type="button" class="ogpri" data-a="hubnew">Open the group</button>';
    if (p.role === 'pending') return h + '<div class="ogcard">Your request is with the commissioner.</div><button type="button" class="ogsec" data-a="home">Back to my groups</button>';
    if (p.denied) return h + '<div class="ogcard">The commissioner said no to this group.</div>';
    if (p.closed) return h + '<div class="ogcard">This group is not taking new people right now.</div>';
    return h + '<div class="ogcard ogmut">' + (p.needsOk ? 'The commissioner approves who joins. ' : '') + esc(LOCKNOTE) + '</div><button type="button" class="ogpri" data-a="dojoin">' + (p.needsOk ? 'Ask to join' : 'Join this group') + '</button>';
  }
  const normCode = (c) => { const x = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return x.length === 8 ? x.slice(0, 4) + '-' + x.slice(4) : ''; };
  function lookup(code) { const c = normCode(code); cur().code = String(code || ''); if (!c) { err = 'That code is not complete. It has 8 letters and numbers.'; return paint(); } act('preview', { code: c }, async (j) => { const s = cur(); s.code = c; s.pv = j.group; paint(); }); }
  function doJoin() { const s = cur(); act('join', { code: s.code }, async (j) => { s.done = j.pending ? { pending: true, text: j.text || 'Request sent. The commissioner approves who joins.' } : { pending: false, text: 'You joined ' + (j.group ? j.group.name : 'the group') + '.' }; s.gr = j.pending ? null : j.group; H = null; paint(); blStatus(); }); }
  // An invite link (?join=g.<code>) lands here once the person is signed in (index.html grpJoinRun, also through gate.js afterSignIn('group:g:<code>')).
  function openJoin(code) { WANT = String(code || ''); WANTG = false; open(true); if (window.OddLocal) { try { window.OddLocal.close(); } catch (x) {} } try { if (window.oddCalc && window.oddCalc.close) window.oddCalc.close(); } catch (x) {} /* v283 (review A4): a join link closes the Calcutta too */ stack = [{ t: 'home' }, { t: 'join', code: WANT }]; err = ''; paint(); if (expired()) return; WANT = ''; lookup(cur().code); }

  // ---------- invite ----------
  async function invite() {
    const gr = cur().gr, code = gr.role === 'comm' && gr.code ? gr.code : gr.link; if (!code) return;
    const path = '?join=g.' + String(code).replace(/[^A-Za-z0-9]/g, ''), box = () => el() && el().querySelector('#ginv');
    // window.oddShareUrl / oddShare (gate.js, v271): the link carries this person's share / influencer code (?ref=). The phone's own share sheet, else a copy.
    const url = () => (window.oddShareUrl ? window.oddShareUrl(path) : new URL(path, new URL('.', location.href)).href);
    let r = ''; try { if (window.oddShare) r = await window.oddShare(path, { title: 'Oddable', text: 'Join my group "' + gr.name + '" on Oddable:' }); } catch (e) {}
    const b = box(); if (!b) return;
    b.innerHTML = '<div class="ogmeta" role="status">' + (r === 'copied' ? 'Link copied. Paste it in a text or an email.' : r === 'shared' ? 'Shared.' : 'Your invite link:') + '</div><input class="ogin" readonly aria-label="Invite link" value="' + esc(url()) + '"><div class="ogmeta">Or give them the code <b>' + esc(code) + '</b> for "Join with a code".</div>';
    const i = b.querySelector('input'); i.onfocus = () => i.select();
  }

  // ---------- paint ----------
  function paint() {
    const e = el(); if (!e) return; const s = cur();
    const body = expired() ? '<h1>Groups</h1>' + lockCard() : s.t === 'hub' ? hub() : s.t === 'members' ? members() : s.t === 'contest' ? contest() : s.t === 'rules' ? rules() : s.t === 'create' ? create() : s.t === 'pcreate' ? pcreate() : s.t === 'join' ? join() : s.t === 'golf' ? (window.OddGolfDay ? window.OddGolfDay.view(s, GDX) : '<h1>Golf day</h1><div class="ogcard ogmut">Loading…</div>') : s.t === 'games' ? games() : s.t === 'stats' ? statsView() : s.t === 'statsd' ? statsList() : home();
    e.querySelector('.ogin0').innerHTML = top(stack.length > 1 && !expired()) + (err && !expired() ? '<div class="ogerr" role="alert">' + esc(err) + '</div>' : '') + '<div class="ogbody">' + body + '</div>';
  }
  function paintBusy(on) { const e = el(); if (!e) return; e.classList.toggle('ogbusy', !!on); e.querySelectorAll('button[data-a]').forEach((b) => { if (!/^(back|close)$/.test(b.getAttribute('data-a'))) b.disabled = !!on; }); }
  function back() { err = ''; if (cur().t === 'create' || cur().t === 'pcreate') readDraft(); if (cur().t === 'golf' && window.OddGolfDay) { try { window.OddGolfDay.leave(cur(), GDX); } catch (e) {} } if (stack.length > 1) stack.pop(); if (cur().t === 'home' && !H) loadHome(); if (cur().t === 'games' && !expired()) return gamesState(cur()), (el().scrollTop = 0); /* v283: back on the Games screen = its states asked again */ if (cur().t === 'golf' && window.OddGolfDay) { try { window.OddGolfDay.back(cur(), GDX); } catch (e) {} } paint(); el().scrollTop = 0; }
  function push(v) { err = ''; stack.push(v); paint(); el().scrollTop = 0; }
  // v273 Golf days (a group game): the screens live in pics/golfday.js, fetched the first time a member opens the Golf day tile. It draws inside this
  // overlay and uses the same stack (Back), the same one-call-at-a-time `act` (so an ended account gets the same lock card) and the same classes.
  let GDL = null; const GDV = '293';
  const GDX = { esc, att, fmtDay, chiDay, addDays, push, back: () => back(), paint: () => paint(), cur, el, act, post, errText, tile, sel, busy: () => busy, setErr: (m) => { err = m || ''; }, me: () => g('odd-name') || '' };
  function gdOpen(gr) {
    push({ t: 'golf', v: 'home', gr });
    const go = () => { const s = cur(); if (s.t === 'golf' && s.v === 'home') window.OddGolfDay.open(s, GDX); };
    if (window.OddGolfDay) return go();
    if (!GDL) GDL = new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'golfday.js?v=' + GDV; sc.onload = ok; sc.onerror = () => { GDL = null; sc.remove(); no(); }; document.head.appendChild(sc); });
    GDL.then(go, () => { err = 'Could not load Golf days. Check your signal and try again.'; paint(); });
  }
  // Pickleball (branch pb-group; v283 integration: a Games catalog entry, key 'pickleball', registered below with addGame): the screens live in pics/local.js,
  // fetched the first time a member taps the Pickleball card on the Games screen (same tag as Golf days: GDV = the app version). It draws its own screen
  // (#oevt) exactly over this one, one z-index above, so the tab bar stays visible; its Back on the first screen returns here (the Games screen).
  let PBL = null;
  function pbOpen(gr) {
    const from = cur(); // the screen the card was tapped on: if the member moved on while local.js loads, nothing opens over the new screen
    const go = () => { if (el() && cur() === from && !expired()) window.OddLocal.open({ id: gr.id, name: gr.name, role: gr.role }); };
    if (window.OddLocal) return go();
    if (!PBL) PBL = new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'local.js?v=' + GDV; sc.onload = ok; sc.onerror = () => { PBL = null; sc.remove(); no(); }; document.head.appendChild(sc); });
    busy = true; paintBusy(true); PBL.then(() => { busy = false; paintBusy(false); go(); }, () => { busy = false; paintBusy(false); err = 'Could not load Pickleball. Check your signal and try again.'; paint(); });
  }

  // ---------- v274: the games catalog. A REGISTRY: one entry per game a group can play. Another module adds a game with ONE call:
  //   window.OddGroups.addGame({ key, title, blurb, open(gr), state(gr) })
  //     key    a-z / 0-9, 1 to 16 characters, unique (the same key again replaces the entry)
  //     title  the card's name; blurb: one line saying what the game is
  //     open   called with the group (the object the group page holds) when the card is tapped: push your own screen (GDX.push / push) so Back works
  //     state  optional: (gr) -> {k: 'none' | 'open' | 'finished', text} or a Promise of it. Shown on the card ('None yet' / 'Open' / 'Finished').
  // Only games that exist on main are registered here: the Picks contest (v272), Golf days (v273) and, since the v283 integration, group Pickleball (pics/local.js) and the Calcutta (pics/calcutta.js).
  const GAMES = [];
  function addGame(x) { if (!x || !/^[a-z][a-z0-9]{0,15}$/.test(String(x.key || '')) || !x.title || typeof x.open !== 'function') return false; const i = GAMES.findIndex((y) => y.key === x.key); if (i >= 0) GAMES[i] = x; else GAMES.push(x); return true; }
  const span = (c) => esc(SPORT[c.sport] || c.sportName || '') + ' · ' + esc(fmtDay(c.startDay) + ' to ' + fmtDay(c.endDay));
  addGame({ key: 'picks', title: 'Picks contest', blurb: 'Everyone\'s bets on one board, graded by Oddable from final scores. Bragging rights only.',
    state: (gr) => { const c = picks(gr)[0]; return !c ? { k: 'none', text: gr.role === 'comm' ? 'No picks contest yet: start one' : 'No picks contest yet' } : c.ended ? { k: 'finished', text: 'Final · ' + span(c) } : c.started ? { k: 'open', text: 'Running · ' + span(c) } : { k: 'open', text: 'Starts ' + esc(fmtDay(c.startDay)) + ' · ' + span(c) }; },
    open: (gr) => { const c = picks(gr)[0]; if (!c) { if (gr.role !== 'comm') { err = 'No picks contest yet. The commissioner can start one.'; return paint(); } DR = DR || draft(); return push({ t: 'pcreate', gr }); } openContest(gr, c.cid); } });
  addGame({ key: 'golf', title: 'Golf day', blurb: 'A round at one course: each player logs their own score hole by hole, live leaderboard, Golf GPS for the course.',
    state: (gr) => within(post('/golfday/list', { g: gr.id }), 12000).then((j) => (j.open ? { k: 'open', text: 'Open · ' + esc(j.open.name) + ' · ' + esc(fmtDay(j.open.date)) } : (j.past || []).length ? { k: 'finished', text: 'Last one · ' + esc(j.past[0].name) + ' · ' + esc(fmtDay(j.past[0].date)) } : { k: 'none', text: 'No Golf day yet' + (j.comm ? ': start one' : '') })),
    open: (gr) => gdOpen(gr) });
  // v283 (integration): group pickleball (pics/local.js, server odds-api/local.js) as a catalog entry. State: ONE POST /local/list for the group (the call
  // its own home screen makes; local.js is NOT fetched for it): Open (a game not finished: under way, or its start) / Finished (the last one) / None yet.
  const pbDay = (ms) => esc(new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
  addGame({ key: 'pickleball', title: 'Pickleball', blurb: 'Round robin, brackets, ladder and heads-up games: scores entered on court, live standings. Bragging rights only.',
    state: (gr) => within(post('/local/list', { g: gr.id }), 12000).then((j) => { const E = Array.isArray(j.events) ? j.events : [], o = E.filter((x) => !x.fin), f = E.filter((x) => x.fin).sort((a, b) => (b.fin || 0) - (a.fin || 0));
      return o.length ? { k: 'open', text: 'Open · ' + esc(o[0].title) + ' · ' + (o[0].started ? 'under way' : 'starts ' + pbDay(o[0].start)) + (o.length > 1 ? ' · ' + o.length + ' games' : '') } : f.length ? { k: 'finished', text: 'Last one · ' + esc(f[0].title) + ' · ' + pbDay(f[0].start) } : { k: 'none', text: 'No pickleball game yet' + (gr.role === 'comm' ? ': start one' : '') }; }),
    open: (gr) => pbOpen(gr) });
  // v283 (integration): the Calcutta (pics/calcutta.js, server odds-api/calcutta.js) as a catalog entry; its old hub tile is gone. State: ONE POST
  // /calcutta/list for the group (the call its own first screen makes; calcutta.js is NOT fetched for it). That list knows each auction's status
  // (not started / running / closed), not whether the event's games are over, so a Calcutta stays Open after its auction closes (owners are paid as
  // teams win); None yet when the group has none.
  const CST = { setup: 'auction not started', live: 'auction running', closed: 'auction closed' };
  addGame({ key: 'calcutta', title: 'Calcutta', blurb: 'Auction the teams, own them for the whole event, get paid as they win: football weekends, playoffs and seasons, this week\'s PGA Tour event, or your own teams. Money is settled outside the app.',
    state: (gr) => within(post('/calcutta/list', { g: gr.id }), 12000).then((j) => { const C = Array.isArray(j.calcs) ? j.calcs : [], c = C.find((x) => x.status !== 'closed') || C[0];
      return c ? { k: 'open', text: 'Open · ' + esc(c.name) + ' · ' + esc(CST[c.status] || '') + (C.length > 1 ? ' · ' + C.length + ' Calcuttas' : '') } : { k: 'none', text: 'No Calcutta yet' + (j.comm ? ': start one' : '') }; }),
    open: (gr) => calcOpen(gr) });
  const STN ={ none: 'None yet', open: 'Open', finished: 'Finished' };
  function games() {
    const s = cur(), gr = s.gr, st = s.st || {};
    return '<h1>Games</h1><p class="ogsub">' + (s.pick ? '<b>Pick a game for your group.</b> ' : '') + esc(gr.name) + ' · the games this group can play. Tap one to open it.</p><div class="oggrid ogfit">' + GAMES.map((x) => { const v = st[x.key];
      return '<button type="button" class="ogcard ogbtn" data-a="game" data-k="' + att(x.key) + '"><span class="ogrow"><b class="ogname">' + esc(x.title) + '</b><span class="ogbadge' + (v && v.k === 'open' ? ' ogy' : '') + '">' + esc(v ? STN[v.k] || '–' : 'Checking…') + '</span></span><span class="ogmeta">' + esc(x.blurb || '') + '</span>'
        + '<span class="ogmeta">' + (v ? v.text : 'Checking…') + '</span><span class="oggo">Open ›</span></button>'; }).join('') + '</div>';
  }
  // v285: what is RUNNING in a group, for the Games tile on the group page. ONE cache per group (GST[group id].st), filled by the same catalog state() calls the
  // Games list makes (that list writes into it too, so coming back to it refreshes the tile); the group page asks once per group, never on every paint.
  const GST = {};
  function gstOf(gr) { return GST[gr.id] || (GST[gr.id] = { st: {}, asked: false }); }
  function runTxt(gr) {
    const c = gstOf(gr); if (!c.asked) { c.asked = true; GAMES.forEach((x) => { let v; try { v = x.state ? x.state(gr) : null; } catch (e) { v = null; }
      const set = (r) => { c.st[x.key] = r && STN[r.k] ? r : { k: '' }; c.n = (c.n || 0) + 1; if (c.n >= GAMES.length && cur() && cur().t === 'hub' && cur().gr && cur().gr.id === gr.id && !busy) paint(); };
      if (v && typeof v.then === 'function') v.then(set, () => set(null)); else set(v); }); }
    if (Object.keys(c.st).length < GAMES.length) return 'Checking…';
    const on = GAMES.filter((x) => c.st[x.key] && c.st[x.key].k === 'open').map((x) => x.title + (x.key === 'picks' && /^Running/.test(c.st[x.key].text || '') ? ' running' : ' open'));
    return on.length ? on.join(' · ') : 'Pick a game';
  }
  function gamesOpen(gr, pick) { const s = { t: 'games', gr, st: gstOf(gr).st, pick: !!pick }; push(s); gamesState(s); }
  // v283: the states are asked again when the person comes BACK to the Games screen (from a game's screens: Back in groups.js, or Back on the first
  // Pickleball screen through OddGroups.refresh()), so a game started meanwhile shows Open. The last answer stays on the card until the new one arrives.
  function gamesState(s) {
    const gr = s.gr, n = (s.n = (s.n || 0) + 1);
    GAMES.forEach((x) => { let v; try { v = x.state ? x.state(gr) : null; } catch (e) { v = null; } const set = (r) => { if (s.n !== n) return; s.st[x.key] = r && STN[r.k] ? r : { k: '', text: 'Could not check right now' }; if (cur() === s && !busy) paint(); };
      if (v && typeof v.then === 'function') v.then(set, () => set(null)); else s.st[x.key] = v && STN[v.k] ? v : { k: '', text: '' }; });
    paint();
  }
  function refresh() { const s = cur(); if (el() && s && s.t === 'games' && !expired()) gamesState(s); }
  // v283: open a registered game for the group the Groups screen is on (pics/local.js's "Open the group contest" / "Open Golf day" buttons). false = nothing opened.
  function openGame(k) { const gr = curGroup(), x = GAMES.find((y) => y.key === k); if (!el() || !gr || !x || busy || expired()) return false; try { x.open(gr); return true; } catch (e) { err = 'Could not open that game.'; paint(); return false; } }
  function openContest(gr, cid) { const c = cof(gr, cid); push({ t: 'contest', gr, cid }); if (c && c.started) act('standings', { id: gr.id, cid }, async (j) => { const s = cur(); if (s.t === 'contest') { s.rows = j.rows || []; if (j.group) setGroup(j.group); } paint(); }); }

  // ---------- v274: lifetime stats (a member's group record). Server: POST /groups/stats (odds-api/gstats.js). ----------
  const sg = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
  const par0 = (v) => (v === 0 ? 'E' : sg(v));
  const unitsTxt = (u) => (u > 0 ? '+' : u < 0 ? '−' : '') + Math.abs(u).toFixed(2) + 'u';
  const placeTxt = (p, tied) => (p == null ? '–' : (tied ? 'T' : '') + p);
  const rec = (x) => x.w + '-' + x.l + '-' + x.p;
  function statsOpen(gr, pid) { const s = { t: 'stats', gr: gr || null, pid: pid || '' }; push(s); act('stats', gr && pid ? { id: gr.id, pid } : {}, async (j) => { s.data = j; paint(); }); }
  function statsView() {
    const s = cur(), d = s.data, who = !s.gr || !s.pid || (d && d.me) ? 'My stats' : (d ? esc(d.name) + '\'s group record' : 'Group record');
    if (!d) return '<h1>' + who + '</h1><div class="ogcard ogmut">Loading the record…</div>';
    const P = d.picks, Gf = d.golf, b = P.best;
    let h = '<h1>' + who + '</h1><p class="ogsub">' + esc(d.source.scope) + (d.me ? '' : '. Only groups you are both in count.') + '</p>';
    h += '<h3 class="ogh">Picks contests</h3><p class="ogmeta">' + esc(d.source.picks) + '</p><div class="og3">'
      + tile('Contests played', String(P.played), 'data-a="sd" data-k="picks"', P.won + ' won' + (P.shared ? ' (' + P.shared + ' shared)' : ''))
      + tile('Best finish', b ? esc(placeTxt(b.place, b.tied)) + ' of ' + b.of : '–', 'data-a="sd" data-k="picks"', b ? esc(b.contest + ' · ' + b.group) : 'No settled bet yet')
      + tile('Record', P.played ? esc(rec(P)) : '–', 'data-a="sd" data-k="record"', P.played ? esc(unitsTxt(P.units)) + ' units' + (P.open ? ' · ' + P.open + ' still grading' : '') : 'Won-lost-push') + '</div>';
    h += '<h3 class="ogh">Golf days</h3><p class="ogmeta">' + esc(d.source.golf) + '</p><div class="og3">'
      + tile('Golf days played', String(Gf.played), 'data-a="sd" data-k="golf"', Gf.wins + (Gf.wins === 1 ? ' win' : ' wins') + (Gf.shared ? ' (' + Gf.shared + ' shared)' : ''))
      + tile('Best net to par', Gf.bestNet ? esc(par0(Gf.bestNet.v)) : '–', 'data-a="sd" data-k="net"', Gf.bestNet ? esc(Gf.bestNet.holesName + ' · ' + Gf.bestNet.course) : 'No finished card yet')
      + tile('Best Stableford', Gf.bestSf ? Gf.bestSf.v + ' pts' : '–', 'data-a="sd" data-k="sf"', Gf.bestSf ? esc(Gf.bestSf.holesName + ' · ' + Gf.bestSf.course) : 'No Stableford card yet') + '</div>';
    h += '<div class="oggrid"><div class="ogcard ogmut ogfull">How it is counted: only contests that have finished and Golf days the commissioner closed, in groups ' + (d.me ? 'you are in' : 'you are both in') + '. Never personal bets. A shared first place counts as a win. Best scores need a finished card.' + (d.failed ? ' Some results could not be read right now; try again later.' : '') + '</div></div>';
    return h;
  }
  const SDH = { picks: ['Contests played', 'Units'], record: ['Record by contest', 'Record'], golf: ['Golf days played', 'Score'], net: ['Net to par, best first', 'Net'], sf: ['Stableford days', 'Points'] };
  function statsList() {
    const s = cur(), d = s.data, k = s.k, hd = SDH[k] || SDH.picks; let rows = '', n = 0;
    if (k === 'picks' || k === 'record') { const L = d.picks.list; n = L.length;
      rows = L.map((x) => '<div class="ogstr"><span class="ogpl">' + esc(placeTxt(x.place, x.tied)) + '</span><span class="ognm"><b>' + esc(x.contest) + '</b><small>' + esc(x.group + ' · ' + (x.sport ? x.sport + ' · ' : '') + fmtDay(x.start) + ' to ' + fmtDay(x.end) + ' · ' + (x.place == null ? 'no settled bet' : 'of ' + x.of) + (k === 'picks' ? ' · ' + rec(x) : ' · ' + unitsTxt(x.units)) + (x.open ? ' · ' + x.open + ' still grading' : '')) + '</small></span><span class="ogvl">' + esc(k === 'record' ? rec(x) : unitsTxt(x.units)) + '</span></div>').join(''); }
    else { let L = d.golf.list.slice(); if (k === 'sf') L = L.filter((x) => x.format === 'stableford'); if (k === 'net') L.sort((a, b) => (a.net2par == null) - (b.net2par == null) || (a.net2par - b.net2par) || (b.date > a.date ? 1 : -1)); n = L.length;
      rows = L.map((x) => { const v = k === 'net' ? (x.net2par == null ? 'thru ' + x.thru : par0(x.net2par)) : k === 'sf' ? (x.pts == null ? 'thru ' + x.thru : x.pts + ' pts') : (x.format === 'stableford' ? (x.pts == null ? 'thru ' + x.thru : x.pts + ' pts') : par0(x.toPar));
        return '<div class="ogstr"><span class="ogpl">' + esc(placeTxt(x.place, x.tied)) + '</span><span class="ognm"><b>' + esc(x.name) + '</b><small>' + esc(x.group + ' · ' + x.course + ' · ' + fmtDay(x.date) + ' · ' + x.formatName + ' · ' + x.holesName + (x.done ? '' : ' · thru ' + x.thru + ' of ' + x.holesN) + ' · ' + x.of + (x.of === 1 ? ' player' : ' players')) + '</small></span><span class="ogvl">' + esc(v) + '</span></div>'; }).join(''); }
    const src = k === 'picks' || k === 'record' ? d.source.picks : d.source.golf;
    let h = '<h1>' + esc(hd[0]) + '</h1><p class="ogsub">' + esc(d.me ? 'My stats' : d.name) + ' · ' + esc(src) + '</p>';
    if (!n) return h + '<div class="oggrid"><div class="ogcard ogmut ogfull">' + (k === 'sf' ? 'No closed Stableford day yet.' : k === 'net' || k === 'golf' ? 'No closed Golf day yet.' : 'No finished contest yet.') + '</div></div>';
    return h + '<div class="ogcols"><div class="ogst"><div class="ogsth"><span>Place · ' + (k === 'picks' || k === 'record' ? 'contest' : 'Golf day') + '</span><span>' + esc(hd[1]) + '</span></div>' + rows + '</div><div class="ogcard ogmut">'
      + (k === 'picks' || k === 'record' ? 'Place and record are the contest\'s own final standings. "T" = a shared place. "–" = no settled bet in that contest.' : 'Net to par = strokes after the playing strokes, minus par, on a finished card (no strokes on a gross day). "thru N" = the card was not finished.') + '</div></div>';
  }

  // Calcutta auction (a group game, calc-live): the screens live in pics/calcutta.js, fetched the first time a member opens it (since the v283
  // integration: the Calcutta card on the Games screen, or "My Calcuttas" on the Groups home). Its own full-screen overlay (#ocalc) opens above
  // this one, beside the tab bar; ‹ Group and Close come back here; closing Groups closes it too.
  let CDL = null; const CDV = GDV; // F11: calcutta.js?v= moves with every app version (see HANDOFF bump list)
  function calcOpen(gr) { // gr null: My Calcuttas (every group), so a Calcutta whose group was deleted stays reachable
    const from = cur(); // v283: same guard as pbOpen: opened only if Groups is still open on the same screen and the account has not ended
    const go = () => { if (el() && cur() === from && !expired()) window.oddCalc(gr ? { gr: { id: gr.id, name: gr.name, role: gr.role } } : { mine: true }); };
    if (window.oddCalc) return go();
    if (!CDL) CDL = new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'calcutta.js?v=' + CDV; sc.onload = ok; sc.onerror = () => { CDL = null; sc.remove(); no(); }; document.head.appendChild(sc); });
    busy = true; paintBusy(true); CDL.then(() => { busy = false; paintBusy(false); go(); }, () => { busy = false; paintBusy(false); err = 'Could not load Calcutta. Check your signal and try again.'; paint(); });
  }
  function click(ev) {
    const b = ev.target.closest && ev.target.closest('button[data-a]'); if (!b || b.disabled) return; const a = b.getAttribute('data-a'), id = b.getAttribute('data-id'), gr = curGroup();
    if (a === 'close') return close(); if (a === 'back') return back(); if (busy) return;
    if (a.slice(0, 2) === 'gd') { if (cur().t === 'golf' && window.OddGolfDay && !expired()) window.OddGolfDay.click(a, b, cur(), GDX); return; } // v273: every Golf day button
    if (a === 'home') { stack = [{ t: 'home' }]; err = ''; paint(); return loadHome(); }
    if (a === 'create') { DR = DR || draft(); return push({ t: 'create' }); }
    if (a === 'docreate') return doCreate();
    if (a === 'dopcreate') return doPcreate();
    if (a === 'pcreate') { DR = DR || draft(); return push({ t: 'pcreate', gr }); }
    if (a === 'join') return push({ t: 'join', code: '' });
    if (a === 'lookup') return lookup((el().querySelector('#gcode') || {}).value);
    if (a === 'dojoin') return doJoin();
    if (a === 'hubnew') { const s = cur(), gnew = s.gr || (s.pv && s.pv.members ? s.pv : null); stack = [{ t: 'home' }]; if (gnew) stack.push({ t: 'hub', gr: gnew }); err = ''; paint(); return loadHome(); }
    if (a === 'hub') { const x = H && H.groups.find((y) => y.id === id); if (x) push({ t: 'hub', gr: x }); return; }
    if (a === 'cancel') return act('cancel', { id }, async () => { loadHome(); });
    if (a === 'mstats') { const p = b.getAttribute('data-pid'); return statsOpen(p ? gr : null, p || ''); } // v274: My stats (home) or a member's record (a name)
    if (a === 'sd') { const s = cur(); if (s.data) push({ t: 'statsd', k: b.getAttribute('data-k'), data: s.data, gr: s.gr }); return; }
    if (a === 'mycalc') return calcOpen(null); // calc-live F8
    if (!gr) return;
    if (a === 'members') { push({ t: 'members', gr }); return act('get', { id: gr.id }, async (j) => { setGroup(j.group); paint(); }); }
    if (a === 'rules') return push({ t: 'rules', gr, cid: b.getAttribute('data-cid') });
    if (a === 'contest') return openContest(gr, b.getAttribute('data-cid'));
    if (a === 'golf') return gdOpen(gr);
    if (a === 'games') return gamesOpen(gr); // v274
    if (a === 'game') { const x = GAMES.find((y) => y.key === b.getAttribute('data-k')); if (x) { try { x.open(gr); } catch (e) { err = 'Could not open that game.'; paint(); } } return; }
    if (a === 'invite') return invite();
    if (a === 'decide') return act('decide', { id: gr.id, pid: b.getAttribute('data-pid'), ok: b.getAttribute('data-ok') === '1' }, async (j) => { setGroup(j.group); paint(); });
    if (a === 'leave') { if (!confirm('Leave "' + gr.name + '"? You can ask to join again before it starts.')) return; return act('leave', { id: gr.id }, async () => { stack = [{ t: 'home' }]; H = null; paint(); loadHome(); blStatus(); }); }
    if (a === 'delete') { if (!confirm('Delete "' + gr.name + '" for everyone? This cannot be undone. Bets already placed stay in each player\'s My Bets.')) return; return act('delete', { id: gr.id }, async () => { stack = [{ t: 'home' }]; H = null; paint(); loadHome(); blStatus(); }); }
  }
  // The overlay sits beside the tab bar, never over it: above it on a phone, to its right where the bar is a rail (900 px and wider). It covers the page's
  // own header and the floating My Bets banner (z-index 40), so the banner can never sit on a Groups button. Sign-up / pay sheets (z 200+) open above it.
  function fit() { const e = el(), bn = document.getElementById('bn'); if (!e) return; let r = bn ? bn.getBoundingClientRect() : null; if (r && !(r.width && r.height)) r = null; const rail = !!r && r.height > r.width; e.style.left = rail ? Math.round(r.right) + 'px' : '0'; e.style.bottom = r && !rail ? Math.max(0, Math.round(window.innerHeight - r.top)) + 'px' : '0'; }
  function css() {
    if (document.getElementById('ogrpcss')) return; const st = document.createElement('style'); st.id = 'ogrpcss';
    st.textContent = '#ogrp{position:fixed;top:0;right:0;left:0;bottom:0;z-index:45;background:var(--bg,#0b1020);color:var(--ink,#eee);overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font:15px/1.4 system-ui,-apple-system,sans-serif}'
      + '#ogrp .ogin0{max-width:1328px;margin:0 auto;padding:0 14px 28px;box-sizing:border-box}'
      + '#ogrp .ogtop{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--bg,#0b1020);padding:max(8px,env(safe-area-inset-top)) 0 6px}'
      + '#ogrp button{font:inherit;cursor:pointer;color:inherit}#ogrp .ogback,#ogrp .ogx{min-height:44px;min-width:44px;padding:0 12px;border-radius:12px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);font-weight:700}'
      + '#ogrp h1{font-size:24px;margin:8px 0 2px;overflow-wrap:anywhere}#ogrp .ogsub{color:var(--muted,#9aa6c2);margin:0 0 12px}#ogrp .ogh{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#9aa6c2);margin:18px 0 8px}'
      + '#ogrp .oggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;align-items:start}#ogrp .og2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0}#ogrp .og3{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 12px}'
      + '#ogrp .ogcard{display:block;width:100%;box-sizing:border-box;text-align:left;background:var(--panel,#121a33);border:1px solid var(--line,#fff2);border-radius:14px;padding:12px 14px;margin:0 0 12px}#ogrp .oggrid>.ogcard{margin:0}#ogrp .ogbtn{min-height:76px}#ogrp .ogmut{color:var(--muted,#9aa6c2)}'
      + '#ogrp .ogrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;justify-content:space-between}#ogrp .ogname{font-size:17px;overflow-wrap:anywhere}#ogrp .ogmeta{display:block;color:var(--muted,#9aa6c2);font-size:13px;margin:4px 0}#ogrp .ogy{color:#f5c542}#ogrp .oggo{display:block;margin-top:6px;font-weight:700;color:var(--blue,#6aa5ff)}'
      + '#ogrp .ogbadge{flex:none;font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;border:1px solid var(--line,#fff4);white-space:nowrap}'
      + '#ogrp .ogtile{display:flex;flex-direction:column;gap:2px;text-align:left;min-height:76px;background:var(--panel,#121a33);border:1px solid var(--line,#fff2);border-radius:14px;padding:10px 12px}#ogrp .ogtile small{color:var(--muted,#9aa6c2);font-size:12px}#ogrp .ogtile b{font-size:19px;overflow-wrap:anywhere}#ogrp .ogtile i{font-style:normal;font-size:12px;color:var(--muted,#9aa6c2)}'
      + '#ogrp .ogpri,#ogrp .ogsec,#ogrp .ogdan{display:block;width:100%;min-height:48px;margin:8px 0;padding:10px 14px;border-radius:14px;font-weight:800;font-size:16px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340)}#ogrp .ogpri{background:#2f7bff;border-color:#2f7bff;color:#fff}#ogrp .ogdan{color:#ff8a8a;border-color:#7a2f3a;background:none}#ogrp .og2 .ogpri,#ogrp .og2 .ogsec{margin:0}'
      + '#ogrp .glk button{min-height:44px}#ogrp button:disabled{opacity:.55}#ogrp .ogerr{background:#3a1520;border:1px solid #7a2f3a;color:#ffd0d0;border-radius:12px;padding:10px 12px;margin:6px 0 10px}'
      + '#ogrp .ogform label,#ogrp .ogck{display:block;font-size:13px;color:var(--muted,#9aa6c2);margin:0 0 10px}#ogrp .ogin,#ogrp .ogsel{display:block;width:100%;box-sizing:border-box;min-height:48px;margin-top:4px;padding:10px 12px;border-radius:12px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);color:var(--ink,#eee);font:600 16px system-ui,-apple-system,sans-serif}'
      + '#ogrp .ogck{display:flex;align-items:center;gap:10px;min-height:44px;margin:0;color:var(--ink,#eee);font-size:15px}#ogrp .ogck input{width:22px;height:22px;flex:none}'
      + '#ogrp .ogrw{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #8883}#ogrp .ogrw:first-child{border-top:0}#ogrp .ogrw span{color:var(--muted,#9aa6c2);flex:none}#ogrp .ogrw b{text-align:right;overflow-wrap:anywhere}'
      + '#ogrp .ogst{background:var(--panel,#121a33);border:1px solid var(--line,#fff2);border-radius:14px;padding:4px 14px;margin:0 0 12px}#ogrp .ogsth,#ogrp .ogstr{display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #8883}#ogrp .ogsth{grid-template-columns:1fr auto;border-top:0;font-size:12px;color:var(--muted,#9aa6c2);text-transform:uppercase;letter-spacing:.05em}#ogrp .ogsth span:last-child,#ogrp .ogvl{text-align:right}#ogrp .ogpl{font-weight:800;font-size:18px}#ogrp .ognm b{display:block;overflow-wrap:anywhere}#ogrp .ognm small{color:var(--muted,#9aa6c2)}#ogrp .ogvl{font-weight:800;font-variant-numeric:tabular-nums}#ogrp .ogstr.me{background:#2f7bff14}#ogrp .ogfit{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}#ogrp .ogfull{grid-column:1/-1}#ogrp button.ogstr{width:100%;min-height:52px;text-align:left;background:none;border:0;border-top:1px solid #8883;border-radius:0;font:inherit;color:inherit}#ogrp .ognm small{display:block}'
      + '@media (min-width:768px){#ogrp .ogin0{padding:0 22px 32px}#ogrp .ogbody>.ogpri,#ogrp .ogbody>.ogsec,#ogrp .ogbody>.ogdan{max-width:420px}#ogrp .ogbody>.og2,#ogrp .ogbody>.ogcard:not(.ogform){max-width:620px}#ogrp .ogform{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0 16px}}@media (min-width:900px){#ogrp .ogcols{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:12px;align-items:start}}'
      + '#oglock{position:fixed;inset:0;z-index:120;background:rgba(5,8,16,.78);display:flex;align-items:center;justify-content:center;padding:16px;font:15px/1.4 system-ui,-apple-system,sans-serif}#oglock .ogq{max-width:400px;width:100%;box-sizing:border-box;background:var(--panel,#121a33);color:var(--ink,#eee);border:1px solid var(--line,#fff3);border-radius:18px;padding:18px}#oglock h2{margin:0 0 8px;font-size:19px}#oglock p{margin:0 0 12px;color:var(--muted,#9aa6c2)}#oglock button{display:block;width:100%;min-height:48px;margin:8px 0 0;border-radius:14px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);color:inherit;font:800 16px system-ui,-apple-system,sans-serif}#oglock button.ogpri{background:#2f7bff;border-color:#2f7bff;color:#fff}';
    document.head.appendChild(st);
  }
  function open(keep) {
    css(); let e = el(); if (!e) { e = document.createElement('div'); e.id = 'ogrp'; e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', 'Groups'); e.innerHTML = '<div class="ogin0"></div>'; document.body.appendChild(e); e.addEventListener('click', click); window.addEventListener('resize', fit); }
    fit(); try { if (window.navRender) window.navRender(); } catch (x) {} fit(); if (window.OddLocal) { try { window.OddLocal.fit(); } catch (x) {} }
    if (keep) return; WANTG = false; if (window.OddLocal) { try { window.OddLocal.close(); } catch (x) {} } try { if (window.oddCalc && window.oddCalc.close) window.oddCalc.close(); } catch (x) {} /* v283 (review A4): and the Calcutta */ stack = [{ t: 'home' }]; err = ''; paint(); if (!expired()) loadHome(); // the Groups tab again = my groups, Pickleball closed
  }
  function close() { try { if (window.oddCalc && window.oddCalc.close) window.oddCalc.close(); } catch (x) {} const e = el(); if (!e) return; if (window.OddGolfDay) { try { window.OddGolfDay.stop(); } catch (x) {} } if (window.OddLocal) { try { window.OddLocal.close(); } catch (x) {} } e.remove(); window.removeEventListener('resize', fit); busy = false; try { if (window.navRender) window.navRender(); } catch (x) {} }
  // gate.js tells the page when the lock changes (paid, signed out, time ended): the open screen follows without a reload.
  function lockChanged() { if (!el()) return; if (!g('odd-tok') || g('odd-grp') !== '1') return close(); if (window.OddLocal) { try { window.OddLocal.close(); } catch (x) {} } if (expired()) { try { if (window.oddCalc && window.oddCalc.close) window.oddCalc.close(); } catch (x) {} } /* calc-live: an ended account sees the lock card, not a Calcutta */ err = ''; paint(); if (!expired()) { if (cur().t === 'join' && cur().code && !cur().pv) lookup(cur().code); else if (!H) loadHome(); } }

  // ---------- group bets: a NEW bet of a group member is saved on the server first, then it is locked ----------
  const TK = () => (g('odd-tok') || '').slice(-12);
  const BL = { n: 0, at: 0 }; try { const c = JSON.parse(g('odd-gbl') || 'null'); if (c && c.tok === TK()) { BL.n = c.n || 0; BL.at = c.at || 0; } } catch (e) {}
  const blSet = (n) => { BL.n = Number(n) || 0; BL.at = Date.now(); try { localStorage.setItem('odd-gbl', JSON.stringify({ n: BL.n, at: BL.at, tok: TK() })); } catch (e) {} };
  // Is this player in a running or upcoming group contest? known: false = the server could not be asked (BL keeps what the phone last knew).
  async function blStatus(id) {
    if (!g('odd-tok') || expired()) return { n: 0, known: true };
    try { const j = await within(post('bet/status', id ? { id: id } : {}), 6000); blSet(j.betLock); return { n: BL.n, known: true, saved: !!j.saved, bet: j.bet || null }; } catch (e) { return { n: BL.n, known: false, auth: !!(e && e.status === 401) }; }
  }
  let PK = 0; const poke = () => { if (Date.now() - PK < 60000 || document.hidden) return; PK = Date.now(); blStatus(); }; // a quiet refresh (page open, back to the app, the bet form opens): at most once a minute
  function ask() { // the step: Save my bet (personal), Add to my group (locks), or Cancel. v288: B2 ("every bet counts for the group") overridden by the owner Nov 18-19.
    css(); return new Promise((done) => {
      const o = document.createElement('div'); o.id = 'oglock'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'Add this bet to your group');
      o.innerHTML = '<div class="ogq"><h2>Where does this bet go?</h2><p>Save it as your own bet, or add it to your group contest. <b>Group bets lock:</b> no edits or deletes, even before kickoff.</p><button type="button" class="ogpri" data-k="me">Save my bet</button><button type="button" data-k="group">Add to my group · lock it</button><button type="button" data-k="">Cancel</button></div>';
      o.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b && ev.target !== o) return; o.remove(); done(b ? (b.getAttribute('data-k') || false) : false); });
      document.body.appendChild(o);
    });
  }
  function saving(on) { let o = document.getElementById('oglock'); if (o) o.remove(); if (!on) return; css(); o = document.createElement('div'); o.id = 'oglock'; o.setAttribute('role', 'status'); o.innerHTML = '<div class="ogq"><h2>Saving…</h2><p>Adding your bet to your group. This can take up to a minute if the server is waking up. Keep this screen open.</p></div>'; document.body.appendChild(o); }
  const NOTSAVED = 'Not saved. Try again.', NOREACH = "Couldn't reach your group, so the bet was not added. Try again.";
  // One bet id per bet, reused on every retry: tapping Save again after a lost upload sends the SAME id, and the server answers with the bet it already holds.
  const sigOf = (b) => { const c = Object.assign({}, b); ['id', 't', 'gl', 'sa', 'res', 'fin', 'finPL', 'auto', 'cash', 'soldN'].forEach((k) => delete c[k]); return JSON.stringify(c); };
  const pend = () => { try { const p = JSON.parse(ss('odd-gpend') || '{}'), now = Date.now(); Object.keys(p).forEach((k) => { if (now - p[k].at > 30 * 60e3) delete p[k]; }); return p; } catch (e) { return {}; } };
  const pendSet = (p) => ss('odd-gpend', JSON.stringify(p));
  function stableId(bet) { const p = pend(), k = sigOf(bet); if (p[k]) bet.id = p[k].id; else { p[k] = { id: bet.id, at: Date.now() }; pendSet(p); } }
  const pendDone = (bet) => { const p = pend(); delete p[sigOf(bet)]; pendSet(p); };
  // -> {ok:true, gl, sa} placed and locked · {ok:true, personal:true, text} no contest can count it: keep it as a personal bet · {ok:false, error} NOT placed.
  async function place(bet) {
    stableId(bet); saving(true);
    try {
      let j = null, fail = null; try { j = await within(post('bet/add', { bet }), 60000); } catch (e) { fail = e; }
      if (j && j.ok && j.personal) { pendDone(bet); return { ok: true, personal: true, text: j.text || 'No contest in your groups can count this bet. It stays a personal bet.' }; }
      if (j && j.ok && j.gl > 0) { pendDone(bet); return { ok: true, gl: j.gl, sa: j.sa, text: j.honor ? j.text : '' }; }
      if (fail && fail.status && (fail.status < 500 || fail.status === 503)) { if (fail.status !== 401 && fail.status !== 429 && fail.status !== 503) pendDone(bet); return { ok: false, error: fail.status === 401 ? 'Not saved. Sign in first.' : fail.message || NOTSAVED }; } // the server said no, and why (503 = it could not check the game: nothing was added)
      let st = null; for (const ms of [0, 4000, 8000]) { if (ms) await new Promise((r) => setTimeout(r, ms)); st = await blStatus(bet.id); if (st.known && st.saved && st.bet && st.bet.gl > 0) { pendDone(bet); return { ok: true, gl: st.bet.gl, sa: st.bet.sa }; } } // no answer: ask by id before saying anything
      return { ok: false, error: st && st.known ? NOTSAVED + ' If you add it again it will not be added twice.' : NOREACH };
    } finally { saving(false); }
  }
  // gate(bet): the whole step for a NEW bet. true = keep it (bet.gl is set when it is a group bet) · false = cancelled · a string = show it, do not keep the bet.
  async function gate(bet) {
    if (!g('odd-tok') || expired() || !(BL.n > 0)) return true; // B1: this phone never knew, or knew "not in a group": a personal bet, kept at once, nothing asked
    const st = await blStatus(); if (!st.known) return st.auth ? true : NOREACH; if (!st.n) return true; // the contest is over or the player left: personal
    const pick = await ask(); if (!pick) return false; if (pick === 'me') return true; // v288: a personal bet, kept like any non-group player's
    if (!(Number(bet.stake) > 0)) return 'Group bets need a stake. Enter it and save again.';
    const r = await place(bet); if (!r.ok) return r.error;
    if (r.personal) return true; // no contest counts this kind of bet: it stays a personal bet (no pop-up)
    bet.gl = r.gl; bet.sa = r.sa; if (r.text) { try { alert(r.text); } catch (e) {} } return true;
  }
  window.OddGroups = { open, close, join: openJoin, gate, poke, lockChanged, isOpen: () => !!el(), active: () => BL.n > 0 && !!g('odd-tok') && !expired(), locked: (b) => !!(b && Number(b.gl) > 0), LOCKNOTE, addGame, games: () => GAMES.map((x) => ({ key: x.key, title: x.title, blurb: x.blurb })), openGame, openGames, refresh }; // v274: addGame = the games catalog registry; v283: openGame(key) opens a registered game for the group on screen (pics/local.js's games list uses it), openGames() = Groups at the Games catalog (the what's-new pop-up), refresh() = the Games screen asks its states again (pics/local.js Back)
  window.oddGroups = () => open();
  if (g('odd-tok')) setTimeout(poke, 3000);
  // v287: Golf day scores kept on this phone with no signal (pics/golfgps.js, key ggps-sq) are sent when the app opens: the queue's file is fetched only when one waits
  try { const q = JSON.parse(localStorage.getItem('ggps-sq') || 'null'); if (q && typeof q === 'object' && Object.keys(q).length && g('odd-tok') && !window.GolfGPS) { const sc = document.createElement('script'); sc.src = 'golfgps.js?v=' + GDV; document.head.appendChild(sc); } } catch (x) {}
  document.addEventListener('visibilitychange', () => { if (!document.hidden && g('odd-tok')) poke(); });
})();
