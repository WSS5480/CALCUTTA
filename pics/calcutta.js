// Oddable Calcutta (engine v1, Nov 16 2026). Full-screen overlay #ocalc (pattern of dash.js / groups.js), opened from the "Calcutta" menu item
// or an invite link (?join=c.<code>, routed by pics/join.js -> OddJoin.register('c', ...)). Every rule, bid, clock and dollar comes from the
// server (odds-api/calcutta.js); this file only shows them. Money is information only: Oddable never collects, holds or pays money.
(function () {
  const API = (window.ODD_CALC_API || window.ODD_GROUPS_API || 'https://calcutta-odds.onrender.com') + '/calcutta/';
  const SITE = 'https://steves-pics.onrender.com/';
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const att = (x) => esc(String(x == null ? '' : x).replace(/[^\w.-]/g, ''));
  const usd = (n, sign) => { const v = Math.round((Number(n) || 0) * 100) / 100, a = Math.abs(v), s = '$' + (Number.isInteger(a) ? a.toLocaleString() : a.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })); return (v < 0 ? '-' : sign && v > 0 ? '+' : '') + s; };
  const pct = (p) => (Math.round(p * 100) / 100) + '%';
  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const fmtTime = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const MONEYLINE = 'Money is settled outside the app. Oddable keeps the score and shows who is owed what. Oddable never collects, holds or pays money.';
  const PRICE = 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.'; // shared owner wording (OWNER-DECISIONS: Limits and pricing)
  const CAPLINE = (n) => 'Up to ' + (n || 8) + ' people, the commissioner included.' + ((n || 8) <= 8 ? ' ' + PRICE : '');
  const KIND = { win: 'Each win', round: 'Reaches a round', champ: 'Champion', big: 'Biggest win margin', place: 'Finishes in a place' };
  let stack = [{ t: 'home' }], H = null, EV = null, busy = false, err = '', note = '', DR = null, POLL = null, OFF = 0, TICK = null;

  // ---------- server ----------
  async function post(op, b) {
    const r = await fetch(API + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify(Object.assign({ myName: g('odd-name') || '' }, b || {})) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server said ' + r.status), { status: r.status, j }); return j;
  }
  const errText = (e) => (e && /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Could not reach the server. It may be waking up: try again in a few seconds.' : e && e.status === 401 ? 'Sign in to use Calcutta.' : (e && e.message) || 'Something went wrong');
  async function act(op, b, then) { if (busy) return; busy = true; err = ''; note = ''; paintBusy(true); try { const j = await post(op, b); busy = false; await then(j); } catch (e) { busy = false; err = errText(e); if (then.fail) then.fail(e); paint(); } paintBusy(false); }
  const cur = () => stack[stack.length - 1];
  const setCalc = (c) => { if (!c) return; OFF = (c.now || Date.now()) - Date.now(); stack.forEach((s) => { if (s.id === c.id) s.c = c; }); };

  // ---------- small parts ----------
  const top = (back) => '<div class="ctop">' + (back ? '<button class="cback" data-a="back">‹ ' + esc(back) + '</button>' : '<span></span>') + '<button class="cx" data-a="close" aria-label="Close Calcutta">Close</button></div>';
  const tile = (lab, val, cls, a, sub) => '<button class="ctile" ' + (a || 'disabled') + '><small>' + esc(lab) + (a ? ' ›' : '') + '</small><b class="' + (cls || '') + '">' + val + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</button>';
  const sw = (on, a, dis) => '<button class="csw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" ' + (dis ? 'disabled' : a) + '><i></i></button>';
  const seg = (opts, curV, a) => '<div class="cseg">' + opts.map(([v, l]) => '<button class="' + (String(v) === String(curV) ? 'on' : '') + '" ' + a + '="' + att(v) + '">' + esc(l) + '</button>').join('') + '</div>';
  const sel = (id, opts, curV, extra) => '<select id="' + id + '" class="csel" ' + (extra || '') + '>' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(curV) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
  const notices = (c) => (c && c.notices && c.notices.length ? '<div class="cwarn" role="status"><b>Changed after the auction closed</b>' + c.notices.slice(0, 3).map((n) => esc(n.what.replace(/ \(after the auction closed\)$/, '')) + ' · ' + esc(n.by) + ' · ' + esc(fmtTime(n.at))).join('<br>') + '</div>' : '');
  const badge = (c) => (c.rules && c.rules.main ? '<span class="cbadge">Main pot</span>' : '<span class="cbadge cy">Side pot</span>');
  const statusText = (s) => (s === 'setup' ? 'not started' : s === 'live' ? 'auction running' : 'auction closed');
  const rowText = (r, rounds) => (r.label || KIND[r.k]) + (r.k === 'win' || r.k === 'round' ? ' (' + r.n + ')' : '');

  // ---------- home ----------
  function home() {
    if (!H) return '<div class="ccard">Loading your Calcuttas…</div>';
    let s = '<h1>Calcutta</h1><p class="csub">Auction the teams, own them for the whole event, get paid as they win. Built by the commissioner.</p><div class="c2"><button class="cpri" data-a="create">Create a Calcutta</button><button class="csec" data-a="join">Join with a code</button></div>';
    s += '<h3 class="ch">My Calcuttas</h3>';
    if (!H.calcs.length) s += '<div class="ccard cmut">None yet. Create one, or open an invite link from a friend.</div>';
    H.calcs.forEach((c) => { s += '<button class="ccard cbtn" data-a="open" data-id="' + att(c.id) + '"><div class="crow"><b class="cname">' + esc(c.name) + '</b>' + (c.comm ? '<span class="cbadge">Commissioner</span>' : '') + '</div><div class="cmeta">' + esc(c.evLabel) + ' · ' + esc(statusText(c.status)) + ' ›</div></button>'; });
    return s + '<div class="cnote">' + esc(CAPLINE(H.max)) + '</div>';
  }
  // ---------- join (code or invite link) ----------
  function joinV() {
    const s = cur(), c = s.pre;
    let h = '<h1>Join a Calcutta</h1>';
    if (!s.fromLink) h += '<label class="clab">Invite code<input id="ccode" class="cin ccodein" autocomplete="off" autocapitalize="characters" maxlength="20" placeholder="ABCD EFGH JKLM" value="' + esc(s.code || '') + '"></label><button class="cpri cfull" data-a="preview">Look it up</button>';
    if (!c) return h + (s.fromLink && !err ? '<div class="ccard">Loading the invite…</div>' : '');
    h += '<div class="ccard"><div class="crow"><b class="cname">' + esc(c.name) + '</b>' + badge(c) + '</div><div class="cmeta">' + esc(c.evLabel) + ' · ' + c.lots.length + ' lots · ' + c.count + ' of ' + c.max + ' people · ' + esc(statusText(c.status)) + '</div></div>';
    h += rulesCard(c);
    if (c.role === 'none') h += c.status === 'closed' ? '<div class="cwarn"><b>This auction is over</b>New members cannot join.</div>' : '<button class="cpri cfull" data-a="dojoin">Join ' + esc(c.name) + '</button><div class="cnote">You can bid once you have joined. ' + esc(CAPLINE(c.max)) + '</div>';
    else h += '<button class="csec cfull" data-a="open" data-id="' + att(c.id) + '">You are in. Open it ›</button>';
    return h;
  }
  function rulesCard(c) {
    const r = c.rules; let h = '<div class="ccard"><h2>' + (c.locked ? '🔒 Locked rules' : 'Rules (lock at the first bid)') + '</h2><div class="crules">';
    [['Event', c.evLabel], ['Auction', r.mode === 'live' ? 'Live in the app · ' + r.timer + ' s timer, resets on every bid' : 'Held in person; the commissioner enters who bought what'], ['Lowest bid', usd(r.minBid) + ' · raise by at least ' + usd(r.inc)], ['Buy back half', !c.local ? 'Not for pro teams or golfers' : r.buyBack ? 'Allowed: a lot\'s own player(s) can buy back half of it for half the winning price; cost and winnings split 50/50' : 'Off'],
      ['Pot', r.main ? 'Main Calcutta: bids join the group pot' : 'Side Calcutta: its own pot, paid separately'], ["Commissioner's take", c.takeText + ' (off the top)'], ['Order', r.order === 'random' ? 'Random, drawn when the auction starts' : 'As listed']].forEach(([k, v]) => { h += '<div><small>' + esc(k) + '</small><span>' + esc(v) + '</span></div>'; });
    h += '</div><h2 class="cmt">Payout table</h2><div class="cthd"><span>Team</span><span class="cr">% of Calcutta</span></div>';
    r.rows.forEach((x) => { h += '<div class="ckv"><span>' + esc(rowText(x, c.rounds)) + '</span><b>' + pct(x.bp / 100) + (x.n > 1 ? ' each' : '') + '</b></div>'; });
    const tot = r.rows.reduce((a, x) => a + x.bp * x.n, 0) / 100; h += '<div class="ckv ctot"><span>Total</span><b class="cpos">' + pct(tot) + '</b></div>';
    h += '<div class="cnote">The take comes off the whole pot first. These percentages split what is left. ' + MONEYLINE + '</div>';
    h += '<details class="clots"><summary>' + c.lots.length + ' lots up for auction ›</summary>' + c.lots.map((l) => '<div class="cmrow"><span>' + esc(l.name) + (l.field ? '<small>' + esc(l.teams.map((t) => t.name).join(', ')) + '</small>' : '') + '</span></div>').join('') + '</details></div>';
    return h;
  }

  // ---------- create ----------
  function draftNew() { return { name: '', ev: '', teams: [], pick: {}, bundle: true, q: '', custom: [], mode: 'live', minBid: 5, inc: 5, timer: 20, buyBack: false, main: true, rows: [], editRows: false, takeKind: 'none', takeV: 0, order: 'listed' }; }
  function evOf(k) { return (EV && EV.events.find((e) => e.key === k)) || null; }
  function create1() {
    const d = DR; if (!EV) return '<div class="ccard">Loading events…</div>';
    let h = '<div class="crow"><h1>' + (d.id ? 'Edit Calcutta' : 'New Calcutta') + '</h1><span class="cmut">Step 1 of 2</span></div>';
    h += '<label class="clab">Name<input id="cname" class="cin" maxlength="40" placeholder="Playoff Calcutta" value="' + esc(d.name) + '"></label>';
    h += '<div class="ccard"><h2>What\'s up for auction</h2><label class="clab">Event' + sel('cev', [['', 'Pick an event']].concat(EV.events.map((e) => [e.key, e.label + (e.on ? '' : ' (coming soon)')])), d.ev) + '</label>';
    const ev = evOf(d.ev);
    if (ev && !ev.on) h += '<div class="cnote cyel">Coming soon. Golfers arrive with the golf build.</div>';
    else if (ev && ev.manualOnly) {
      h += '<div class="cnote">Type each team or player. You enter the results by hand.</div>';
      d.custom.forEach((x, i) => { h += '<div class="cmrow"><span>' + esc(x.n) + (x.por.length ? '<small>Players: ' + esc(x.por.map((p) => p.name || 'Player').join(', ')) + '</small>' : '') + '</span><button class="ctiny" data-a="cdel" data-i="' + i + '">Remove</button></div>'; });
      h += '<label class="clab">Team or player<input id="cadd" class="cin" maxlength="40" placeholder="Team name"></label><label class="clab">Its players in the group (optional, names with commas)<input id="caddp" class="cin" maxlength="120" placeholder="Pat Lee, Sam Cruz"></label><div class="cnote">Players of record are the only people who can buy back half of their own lot. You can link them to members later.</div><button class="csec cfull" data-a="cadd">Add</button>';
    } else if (ev) {
      h += '<div class="cline"><span>Bundle long shots<small>Teams marked Field are sold as one lot ("the field")</small></span>' + sw(d.bundle, 'data-a="bundle"') + '</div>';
      if (!d.teams.length) h += '<div class="ccard cmut">Loading teams…</div>';
      else {
        const nLot = Object.values(d.pick).filter((v) => v === 'lot').length, nF = d.bundle ? Object.values(d.pick).filter((v) => v === 'field').length : 0;
        h += '<div class="cnote"><b>' + (nLot + (nF ? 1 : 0)) + ' lots</b> · ' + nLot + ' teams on their own' + (nF ? ' · ' + nF + ' in the field' : '') + (ev.teams ? ' · this event usually has ' + ev.teams + ' teams' : '') + '</div>';
        h += '<div class="c2"><input id="cq" class="cin" placeholder="Find a team" value="' + esc(d.q) + '"><button class="csec" data-a="allteams">' + (nLot === d.teams.length ? 'Clear all' : 'Pick all') + '</button></div>';
        const q = d.q.toLowerCase(), list = d.teams.filter((t) => !q || t.name.toLowerCase().includes(q) || (t.abbr || '').toLowerCase().includes(q));
        list.slice(0, 120).forEach((t) => { const v = d.pick[t.id] || 'out'; h += '<div class="cteam"><span>' + esc(t.name) + '</span>' + seg([['out', 'Out'], ['lot', 'Own lot']].concat(d.bundle ? [['field', 'Field']] : []), v, 'data-pick-' + att(t.id)) + '</div>'; });
        if (list.length > 120) h += '<div class="cnote">Showing 120. Type to find more.</div>';
      }
    }
    h += '</div>';
    return h + '<button class="cpri cfull" data-a="next">Next: rules and payouts</button>';
  }
  function lotsOut() {
    const d = DR, ev = evOf(d.ev); if (ev && ev.manualOnly) return d.custom.map((x) => ({ teams: [{ name: x.n }], playersOfRecord: x.por.map((p) => (p.pid ? { pid: p.pid } : { name: p.name })) }));
    const own = d.teams.filter((t) => d.pick[t.id] === 'lot'), fld = d.bundle ? d.teams.filter((t) => d.pick[t.id] === 'field') : [];
    return own.map((t) => ({ teams: [{ id: t.id, name: t.name, abbr: t.abbr }] })).concat(fld.length ? [{ name: 'The field', teams: fld.map((t) => ({ id: t.id, name: t.name, abbr: t.abbr })) }] : []);
  }
  function create2() {
    const d = DR, ev = evOf(d.ev) || { kinds: [], rounds: [] };
    let h = '<div class="crow"><h1>Calcutta rules</h1><span class="cmut">Step 2 of 2</span></div>';
    h += '<div class="ccard"><h2>How the auction runs</h2>' + seg([['live', 'Live in the app'], ['manual', 'Enter results']], d.mode, 'data-mode');
    h += '<div class="cnote">Live: one lot at a time, the timer resets on every bid. Enter results: you held the auction at the bar, type who bought what.</div>';
    h += '<div class="c2"><label class="clab">Lowest bid' + sel('cmin', (EV.minBids || [5]).map((n) => [n, '$' + n]), d.minBid) + '</label><label class="clab">Raise by at least' + sel('cinc', (EV.incs || [5]).map((n) => [n, '$' + n]), d.inc) + '</label></div>';
    if (d.mode === 'live') h += '<div class="c2"><label class="clab">Bid timer' + sel('ctimer', (EV.timers || [20]).map((n) => [n, n + ' seconds']), d.timer) + '</label><label class="clab">Order' + sel('corder', [['listed', 'As listed'], ['random', 'Random draw']], d.order) + '</label></div>';
    h += ev.local ? '<div class="cline"><span>Buy back half<small>A lot\'s own player(s) can buy back half of it for half the winning price. Cost and winnings split 50/50.</small></span>' + sw(d.buyBack, 'data-a="bb"') + '</div></div>' : '</div>';
    h += '<div class="ccard"><h2>Main or side Calcutta</h2>' + seg([['1', 'Main Calcutta'], ['0', 'Side Calcutta']], d.main ? '1' : '0', 'data-main') + '<div class="cnote">Main: auction bids join the group\'s pot with the entries. Side: same members, its own pot, tracked and paid separately.</div></div>';
    const tot = Math.round(d.rows.reduce((a, x) => a + (Number(x.pct) || 0) * (Number(x.n) || 0), 0) * 100) / 100;
    h += '<div class="ccard"><h2>Calcutta payouts</h2><div class="cthd"><span>Team reaches</span><span class="cr">% of Calcutta</span></div>';
    if (!d.editRows) d.rows.forEach((x) => { h += '<div class="ckv"><span>' + esc((x.label || KIND[x.k]) + (x.k === 'win' || x.k === 'round' ? ' (' + x.n + ')' : '')) + '</span><b>' + pct(Number(x.pct) || 0) + (x.n > 1 ? ' each' : '') + '</b></div>'; });
    else d.rows.forEach((x, i) => {
      h += '<div class="crowed"><div class="c2"><label class="clab">Pays for' + sel('rk' + i, ev.kinds.map((k) => [k, KIND[k]]), x.k, 'data-row="' + i + '"') + '</label>' + (x.k === 'round' ? '<label class="clab">Round' + sel('rr' + i, ev.rounds.map((n, j) => [j + 1, n]), x.r || 1, 'data-row="' + i + '"') + '</label>' : x.k === 'place' ? '<label class="clab">Place<input id="rr' + i + '" class="cin" type="number" inputmode="numeric" min="1" max="100" value="' + esc(x.r || 1) + '"></label>' : '<span></span>') + '</div>';
      h += '<div class="c3r"><label class="clab">Times it pays<input id="rn' + i + '" class="cin" type="number" inputmode="numeric" min="1" max="400" value="' + esc(x.n) + '"' + (x.k === 'champ' || x.k === 'big' ? ' disabled' : '') + '></label><label class="clab">% each<input id="rp' + i + '" class="cin" type="number" inputmode="decimal" min="0" max="100" step="0.01" value="' + esc(x.pct) + '"></label><button class="ctiny" data-a="rdel" data-i="' + i + '">Remove</button></div></div>';
    });
    h += '<div class="ckv ctot"><span class="' + (tot === 100 ? '' : 'cyel') + '">Total must equal 100%</span><b class="' + (tot === 100 ? 'cpos' : 'cneg') + '">' + pct(tot) + '</b></div>';
    h += d.editRows ? '<div class="c2"><button class="csec" data-a="radd">Add a row</button><button class="csec" data-a="rdone">Done</button></div>' : '<button class="csec cfull" data-a="redit">Edit payout table</button>';
    const tsel = d.takeKind === 'none' ? 'none' : d.takeKind === 'flat' ? 'flat' : [5, 10, 15, 20, 25].includes(Number(d.takeV)) ? 'p' + d.takeV : 'pc';
    h += '<label class="clab">Commissioner\'s take' + sel('ctake', [['none', 'None'], ['p5', '5% of the pot'], ['p10', '10% of the pot'], ['p15', '15% of the pot'], ['p20', '20% of the pot'], ['p25', '25% of the pot'], ['pc', 'Other percent'], ['flat', 'Flat amount']], tsel) + '</label>';
    if (tsel === 'pc') h += '<label class="clab">Percent of the pot (0 to 50)<input id="ctv" class="cin" type="number" inputmode="numeric" min="0" max="50" step="1" value="' + esc(d.takeV) + '"></label>';
    if (tsel === 'flat') h += '<label class="clab">Flat amount ($)<input id="ctv" class="cin" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(d.takeV) + '"></label>';
    h += '<div class="cnote">The commissioner\'s take comes off the whole pot first. These percentages split the Calcutta share. ' + MONEYLINE + '</div></div>';
    h += '<div class="cwarn"><b>Rules lock when the auction starts</b>Payout table, take and team list can\'t change after the first bid.</div><div class="cnote">' + esc(CAPLINE(EV.max)) + '</div>';
    return h + '<button class="cpri cfull" data-a="submit">' + (d.id ? 'Save' : 'Create Calcutta') + '</button>';
  }
  function readDraft() {
    const v = (id) => { const e = document.getElementById(id); return e ? e.value : null; }, d = DR; if (!d) return;
    if (v('cname') !== null) d.name = v('cname'); if (v('cq') !== null) d.q = v('cq');
    if (v('cmin') !== null) d.minBid = +v('cmin'); if (v('cinc') !== null) d.inc = +v('cinc'); if (v('ctimer') !== null) d.timer = +v('ctimer'); if (v('corder') !== null) d.order = v('corder');
    d.rows.forEach((x, i) => { if (v('rk' + i) !== null) { const k = v('rk' + i); if (k !== x.k) { x.k = k; x.label = ''; if (k === 'champ' || k === 'big') x.n = 1; } } if (v('rr' + i) !== null) x.r = +v('rr' + i); if (v('rn' + i) !== null) x.n = +v('rn' + i); if (v('rp' + i) !== null) x.pct = v('rp' + i); });
    if (v('ctv') !== null) d.takeV = v('ctv');
    if (v('ctake') !== null) { const t = v('ctake'); if (t === 'none') d.takeKind = 'none'; else if (t === 'flat') { if (d.takeKind !== 'flat') d.takeV = ''; d.takeKind = 'flat'; } else if (t === 'pc') { if (d.takeKind !== 'pct' || [5, 10, 15, 20, 25].includes(Number(d.takeV))) d.takeV = ''; d.takeKind = 'pct'; } else { d.takeKind = 'pct'; d.takeV = +t.slice(1); } }
  }
  function payload() { const d = DR; return { id: d.id, name: d.name.trim(), ev: d.ev, lots: lotsOut(), rows: d.rows.map((x) => ({ k: x.k, r: x.r || undefined, n: Number(x.n), pct: Number(x.pct), label: x.label || undefined })), minBid: d.minBid, inc: d.inc, timer: d.timer, buyBack: !!(evOf(d.ev) || {}).local && d.buyBack, main: d.main, take: { kind: d.takeKind, v: d.takeKind === 'none' ? 0 : Number(d.takeV) }, order: d.order, mode: d.mode }; }
  async function pickEv(k) { const d = DR, ev = evOf(k); d.ev = k; d.teams = []; d.pick = {}; d.rows = ev ? ev.rows.map((x) => Object.assign({}, x)) : []; paint(); if (!ev || !ev.on || ev.manualOnly) return;
    try { const j = await post('teams', { ev: k }); if (DR !== d || d.ev !== k) return; d.teams = j.teams; if (k === 'nfl_season') d.teams.forEach((t) => { d.pick[t.id] = 'lot'; }); } catch (e) { err = errText(e); } paint(); }

  // ---------- auction (live) ----------
  const left = (c) => (c.a.paused ? (c.a.left != null ? c.a.left : null) : c.a.endsAt ? Math.max(0, c.a.endsAt - (Date.now() + OFF)) : null);
  const clock = (ms) => { if (ms == null) return '–'; const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function auctionV() {
    const s = cur(), c = s.c; if (!c) return '<div class="ccard">Loading the auction…</div>';
    const comm = c.role === 'comm', a = c.a, lot = a.cur && c.lots.find((l) => l.id === a.cur), nSold = c.sold.length;
    let h = '<div class="crow"><h1>' + (a.status === 'setup' ? 'Auction' : a.status === 'closed' ? 'Auction closed' : 'Live auction') + '</h1>' + (comm ? '<span class="cbadge">Commissioner</span>' : '') + '</div>';
    h += '<div class="cmeta">' + esc(c.name) + ' · ' + esc(c.evLabel) + '</div>' + notices(c);
    h += '<div class="c2">' + tile('Sold', nSold + ' of ' + c.lots.length, '', 'data-a="board" data-tab="teams"') + tile('Pot so far', usd(c.potSoFar), 'cgold', 'data-a="pot"') + '</div>';
    if (a.status === 'setup') {
      h += '<div class="ccard cblock"><div class="cmut">Not started</div><div class="cbig">' + c.lots.length + ' lots</div><div class="cnote">' + (comm ? 'Start when everyone is in. The first lot opens; its timer starts at the first bid.' : 'Waiting for the commissioner to start.') + '</div>' + (comm ? '<button class="cpri cfull" data-a="ctl" data-op="start">Start the auction</button>' : '') + '</div>';
    } else if (a.status === 'live') {
      if (lot) {
        const hb = a.high, l0 = left(c), frac = l0 == null ? 1 : Math.max(0, Math.min(1, l0 / (a.timer * 1000))), mine = hb && hb.pid === c.me;
        h += '<div class="ccard cblock"><div class="crow"><span class="cmut">Now on the block' + (lot.field ? ' · the field' : '') + '</span><b class="ctimer' + (l0 != null && l0 < 5000 ? ' cneg' : ' cgold') + '" id="ctime">' + (a.paused ? 'Paused' : hb ? clock(l0) : 'Open') + '</b></div>';
        h += '<div class="cbig">' + esc(lot.name) + '</div>' + (lot.field ? '<div class="cnote">' + esc(lot.teams.map((t) => t.name).join(', ')) + '</div>' : '');
        h += '<div class="cbar"><i id="cbar" style="width:' + (hb ? Math.round(frac * 100) : 100) + '%"></i></div>';
        h += '<div class="crow"><span class="cmut">' + (hb ? 'High bid · ' + esc(hb.name) + (mine ? ' (you)' : '') : 'No bids yet · opens at ' + usd(c.rules.minBid)) + '</span><b class="chigh">' + (hb ? usd(hb.amt) : '–') + '</b></div>';
        if (!a.paused && c.role !== 'none') {
          const base = hb ? hb.amt : 0, q = hb ? [c.rules.inc, c.rules.inc * 2, c.rules.inc * 5] : [c.rules.minBid, c.rules.minBid + c.rules.inc, c.rules.minBid + c.rules.inc * 4];
          h += '<div class="c3">' + q.map((x) => '<button class="cpri" data-a="bid" data-amt="' + (base + x) + '"' + (mine ? ' disabled' : '') + '>' + (hb ? '+' + usd(x) : usd(x)) + '</button>').join('') + '</div>';
          h += '<div class="cbidrow"><input id="camt" class="cin" type="number" inputmode="numeric" min="' + a.minNext + '" step="1" placeholder="' + usd(a.minNext) + ' or more" value="' + esc(s.amt || '') + '" aria-label="Your bid in dollars"><button class="cgo" data-a="bidin"' + (mine ? ' disabled' : '') + '>Bid</button></div>';
          if (mine) h += '<div class="cnote cpos">You have the high bid.</div>';
        } else if (a.paused) h += '<div class="cwarn"><b>Paused</b>Bids wait until the commissioner resumes.</div>';
        if (a.bids.length > 1) h += '<div class="cnote">' + a.bids.slice(1, 4).map((b) => esc(b.name) + ' ' + usd(b.amt)).join(' · ') + '</div>';
        h += '</div>';
      } else {
        const just = c.sold[0]; h += '<div class="ccard cblock"><div class="cmut">Sold</div>' + (just ? '<div class="cbig">' + esc(just.name) + '</div><div class="crow"><span class="cmut">' + esc(just.holder.name) + '</span><b class="chigh">' + usd(just.amt) + '</b></div>' : '') + '<div class="cnote" id="cnext">' + (a.paused ? 'Paused.' : 'Next lot opens in a few seconds.') + '</div></div>';
      }
      if (comm) {
        const nxt = a.order.filter((id) => id !== a.cur && !c.sold.find((x) => x.lot === id)).slice(0, 2).map((id) => (c.lots.find((l) => l.id === id) || {}).name);
        h += '<div class="ccard"><h2>Commissioner controls</h2><div class="c2"><button class="csec" data-a="ctl" data-op="' + (a.paused ? 'resume' : 'pause') + '">' + (a.paused ? 'Resume' : 'Pause') + '</button><button class="csec" data-a="ctl" data-op="undo"' + (a.undo ? (a.undo.k === 'sale' ? ' data-sale="' + esc(a.undo.name) + '">Undo sale of ' + esc(a.undo.name) : '>Undo last bid') : ' disabled>Undo') + '</button>';
        h += '<button class="cgreen" data-a="ctl" data-op="sold"' + (lot && a.high ? '' : ' disabled') + '>Sold now</button><button class="csec" data-a="ctl" data-op="next"' + (lot && a.high ? ' disabled' : '') + '>Next lot ›</button></div>';
        h += '<div class="cnote">' + (nxt.length ? 'Up next: ' + esc(nxt.join(', then ')) + '.' : 'This is the last lot.') + '</div><div class="c2"><button class="csec" data-a="order">Change the order</button><button class="cdanger" data-a="ctl" data-op="end">End auction</button></div></div>';
      }
    } else h += '<div class="ccard cblock"><div class="cbig">All done</div><div class="cnote">' + nSold + ' of ' + c.lots.length + ' lots sold for ' + usd(c.potSoFar) + '.</div><button class="cpri cfull" data-a="board">See owners and payouts ›</button></div>';
    h += '<h3 class="ch">Recently sold</h3>';
    if (!c.sold.length) h += '<div class="ccard cmut">Nothing sold yet.</div>';
    else h += '<div class="ccard clist">' + c.sold.slice(0, 8).map((x) => '<button class="cmrow cbtn" data-a="lot" data-lot="' + att(x.lot) + '"><span>' + esc(x.name) + '<small>' + esc(x.holder.name) + (x.holder.pid && x.holder.pid === c.me ? ' · you' : '') + (x.bb ? ' · half bought back by ' + esc(x.bb.name) : '') + '</small></span><b class="cr">' + usd(x.amt) + '</b></button>').join('') + '</div>';
    if (c.sold.length > 8) h += '<button class="clink" data-a="board" data-tab="teams">All ' + c.sold.length + ' sold lots ›</button>';
    h += '<div class="c2"><button class="csec" data-a="board">Owners and payouts</button><button class="csec" data-a="members">Members · invite</button></div>';
    return h;
  }
  function orderV() {
    const s = cur(), c = s.c; if (!c) return ''; const o = s.o || (s.o = c.a.order.slice());
    let h = '<h1>Auction order</h1><div class="cnote">Move lots up or down. Sold lots stay where they were sold.</div><div class="ccard clist">';
    o.forEach((id, i) => { const l = c.lots.find((x) => x.id === id), sold = c.sold.find((x) => x.lot === id); h += '<div class="cmrow"><span>' + (i + 1) + '. ' + esc(l.name) + (sold ? '<small>Sold</small>' : id === c.a.cur ? '<small>On the block</small>' : '') + '</span><span class="cud"><button class="ctiny" data-a="mv" data-i="' + i + '" data-d="-1"' + (i ? '' : ' disabled') + ' aria-label="Move up">↑</button><button class="ctiny" data-a="mv" data-i="' + i + '" data-d="1"' + (i < o.length - 1 ? '' : ' disabled') + ' aria-label="Move down">↓</button></span></div>'; });
    return h + '</div><button class="cpri cfull" data-a="saveorder">Save the order</button>';
  }

  // ---------- enter results (auction held in person) ----------
  function enterV() {
    const s = cur(), c = s.c; if (!c) return '<div class="ccard">Loading…</div>';
    let h = '<h1>Enter results</h1><div class="cmeta">' + esc(c.name) + ' · type who bought each lot and for how much</div>' + notices(c);
    h += '<div class="c2">' + tile('Entered', c.sold.length + ' of ' + c.lots.length, '', 'data-a="board" data-tab="teams"') + tile('Pot', usd(c.potSoFar), 'cgold', 'data-a="pot"') + '</div>';
    const target = s.edit || (c.lots.find((l) => !c.sold.find((q) => q.lot === l.id)) || {}).id; // one form at a time
    c.lots.forEach((l) => {
      const x = c.sold.find((q) => q.lot === l.id), open = target === l.id;
      h += '<div class="ccard' + (open ? ' cblock' : '') + '"><div class="crow"><b>' + esc(l.name) + '</b>' + (x && !open ? '<b class="cr">' + usd(x.amt) + '</b>' : '') + '</div>' + (l.field ? '<div class="cnote">' + esc(l.teams.map((t) => t.name).join(', ')) + '</div>' : '');
      if (open) h += whoForm('e', c, x ? (x.holder.pid || '_') : '', x && !x.holder.pid ? x.holder.name : '') + '<div class="c2"><input id="eamt" class="cin" type="number" inputmode="numeric" min="' + c.rules.minBid + '" step="1" placeholder="Amount ($)" value="' + esc(x ? x.amt : '') + '" aria-label="Amount in dollars"><button class="cpri" data-a="enter" data-lot="' + att(l.id) + '">Save</button></div>';
      else if (x) h += '<div class="cmeta">' + esc(x.holder.name) + (x.bb ? ' · half bought back by ' + esc(x.bb.name) : '') + '</div><div class="c2"><button class="csec" data-a="edit1" data-lot="' + att(l.id) + '">Change</button><button class="cdanger" data-a="unenter" data-lot="' + att(l.id) + '">Remove</button></div>' + (c.rules.buyBack && c.local && (l.por || []).length ? '<button class="clink" data-a="lot" data-lot="' + att(l.id) + '">Buy back half ›</button>' : '');
      else h += '<button class="clink" data-a="edit1" data-lot="' + att(l.id) + '">Not entered yet · Enter ›</button>';
      h += '</div>';
    });
    if (c.a.status !== 'closed' && c.sold.length) h += '<button class="csec cfull" data-a="closeres">Done entering</button>';
    return h + '<div class="cnote">Every entry and change is kept in the history. ' + MONEYLINE + '</div>';
  }
  function whoForm(p, c, curPid, curName) {
    const opts = [['', 'Who bought it?']].concat(c.members.map((m) => [m.pid, m.name + (m.pid === c.me ? ' (you)' : '')])).concat([['_', 'Someone not in the app (type a name)']]);
    return '<label class="clab">Buyer' + sel(p + 'who', opts, curPid, 'data-who="' + p + '"') + '</label>' + (curPid === '_' ? '<label class="clab">Their name<input id="' + p + 'name" class="cin" maxlength="24" value="' + esc(curName) + '"></label>' : '');
  }
  const whoVal = (p) => { const w = (document.getElementById(p + 'who') || {}).value || '', n = (document.getElementById(p + 'name') || {}).value || ''; return w === '_' ? { name: n } : w ? { pid: w } : null; };

  // ---------- board: owners / teams / payouts ----------
  function boardV() {
    const s = cur(), d = s.d; if (!d) return '<div class="ccard">Loading owners and payouts…</div>';
    const c = d.calc, b = d.board, tab = s.tab || 'owners';
    let h = '<div class="crow"><h1>' + esc(c.name) + '</h1>' + badge(c) + '</div><div class="cmeta">' + esc(c.evLabel) + ' · ' + b.owners.length + ' owners · ' + esc(statusText(c.a.status)) + (b.over ? ' · final' : '') + '</div>';
    h += notices(c) + '<div class="cseg c3s">' + [['owners', 'Owners'], ['teams', 'Teams'], ['payouts', 'Payouts']].map(([k, l]) => '<button class="' + (tab === k ? 'on' : '') + '" data-tab="' + k + '">' + l + '</button>').join('') + '</div>';
    h += '<div class="c2">' + tile('Pot', usd(b.pot), 'cgold', 'data-a="pot"', 'Auction ' + usd(b.pot) + (b.take ? ' · take ' + usd(b.take) : '')) + tile('Paid out so far', usd(b.paidOut), 'cpos', 'data-tab="payouts"', usd(b.inPlay) + ' still in play') + '</div>';
    if (tab === 'owners') {
      h += '<div class="cthead"><span>Owner · teams alive</span><span class="cr">Spent</span><span class="cr">Won</span></div>';
      if (!b.owners.length) h += '<div class="ccard cmut">No lots sold yet.</div>';
      b.owners.forEach((o) => { h += '<button class="ctrow' + (o.me ? ' me' : '') + '" data-a="owner" data-k="' + att(o.pid || 'n' + o.name) + '"><span class="cpn"><b>' + esc(o.name) + (o.me ? ' · you' : '') + '</b><small class="' + (o.alive ? 'cpos' : 'cneg') + '">' + (o.alive ? o.alive + ' alive' + (o.out ? ' · ' + o.out + ' out' : '') : 'All teams out') + '</small></span><span class="cr">' + usd(o.spent) + '</span><span class="cr cv ' + (o.won > 0 ? 'cpos' : '') + '">' + usd(o.won) + '</span></button>'; });
      h += '<div class="cnote">Payouts update from final scores. Tap an owner to see their teams, what each cost and what each has earned.</div>';
    } else if (tab === 'teams') {
      h += '<div class="cthead c3h"><span>Lot · owner</span><span class="cr">Cost</span><span class="cr">Earned</span></div>';
      b.lots.forEach((l) => { const st = l.teams.map((t) => t.r ? (t.r.champ ? '🏆 champion' : t.r.out ? 'out' : t.r.wins ? t.r.wins + ' win' + (t.r.wins === 1 ? '' : 's') : 'alive') : '').filter(Boolean);
        h += '<button class="ctrow c3h" data-a="lot" data-lot="' + att(l.id) + '"><span class="cpn"><b>' + esc(l.name) + '</b><small>' + (l.holder ? esc(l.holder.name) + (l.bb ? ' + ' + esc(l.bb.name) + ' (half)' : '') : 'Unsold') + (st.length && !l.field ? ' · ' + esc(st[0]) : l.field ? ' · ' + (l.alive ? 'alive' : 'out') : '') + '</small></span><span class="cr">' + (l.sold ? usd(l.sold.amt) : '–') + '</span><span class="cr cv ' + (l.earned > 0 ? 'cpos' : '') + '">' + usd(l.earned) + '</span></button>'; });
      if (c.role === 'comm') h += '<div class="cnote">Tap a lot to enter a result by hand (any event without a score feed, or to correct one).</div>';
    } else {
      h += '<div class="cthead c3h"><span>Pays for</span><span class="cr">Each</span><span class="cr">Paid</span></div>';
      b.rows.forEach((r) => { h += '<div class="ctrow c3h"><span class="cpn"><b>' + esc(r.label) + '</b><small>' + pct(r.pct) + (r.n > 1 ? ' each · ' + r.hits + ' of ' + r.n + ' paid' : r.hits ? ' · paid' : ' · not yet') + (r.over ? ' · <span class="cyel">more results than the table pays; extras get $0</span>' : '') + '</small></span><span class="cr">' + usd(r.each) + '</span><span class="cr cv">' + usd(r.paid) + '</span></div>'; });
      if (b.unclaimed) h += '<div class="cnote cyel">' + usd(b.unclaimed) + ' was earned by unsold lots (no owner). The commissioner decides what happens to it.</div>';
    }
    h += '<button class="clink" data-a="audit">History · ' + (d.audit || []).length + ' entries ›</button>';
    if (c.role === 'comm' && c.rules.mode === 'manual') h += '<button class="csec cfull" data-a="enterv">' + (c.a.status === 'closed' ? 'Change who bought what' : 'Enter results') + '</button>';
    if (c.rules.mode === 'live' && c.a.status !== 'closed') h += '<button class="csec cfull" data-a="auction">Back to the auction</button>';
    h += '<div class="cnote">' + (d.feedAt ? 'Scores checked ' + esc(fmtTime(d.feedAt)) + '. ' : '') + MONEYLINE + '</div>';
    return h;
  }
  function potV() {
    const s = cur(), d = s.d; if (!d) return '<div class="ccard">Loading…</div>'; const b = d.board, c = d.calc;
    let h = '<h1>Pot</h1><div class="ccard"><div class="ckv"><span>Winning bids (' + d.calc.lots.filter((l) => b.lots.find((x) => x.id === l.id && x.sold)).length + ' lots)</span><b>' + usd(b.pot) + '</b></div>';
    h += '<div class="ckv"><span>Commissioner\'s take<small>' + esc(c.takeText) + '</small></span><b>' + (b.take ? '-' + usd(b.take) : '$0') + '</b></div><div class="ckv ctot"><span>Calcutta pool</span><b class="cgold">' + usd(b.pool) + '</b></div>';
    h += '<div class="ckv"><span>Paid out so far</span><b class="cpos">' + usd(b.paidOut) + '</b></div><div class="ckv"><span>Still in play</span><b>' + usd(b.inPlay) + '</b></div></div>';
    h += '<div class="ccard"><h2>How the pool pays</h2><div class="cthead c3h"><span>Pays for</span><span class="cr">Each</span><span class="cr">Total</span></div>';
    b.rows.forEach((r) => { h += '<div class="ckv3"><span>' + esc(r.label) + '<small>' + pct(r.pct) + (r.n > 1 ? ' x ' + r.n : '') + '</small></span><b>' + usd(r.each) + '</b><b>' + usd(r.total) + '</b></div>'; });
    h += '</div><div class="cnote">' + (b.main ? 'Main Calcutta: these bids join the group pot.' : 'Side Calcutta: its own pot, paid separately.') + ' Rounded to the cent; any extra cent goes to the bigger payout so the payouts add up exactly to the pool. ' + MONEYLINE + '</div>';
    return h;
  }
  function ownerV() {
    const s = cur(), d = s.d; if (!d) return ''; const o = d.board.owners.find((x) => (x.pid || 'n' + x.name).replace(/[^\w.-]/g, '') === s.k); if (!o) return '<div class="ccard cmut">Owner not found.</div>';
    let h = '<h1>' + esc(o.name) + (o.me ? ' · you' : '') + '</h1><div class="cmeta">' + ord(o.place) + ' by winnings · ' + o.lots.length + ' lot' + (o.lots.length === 1 ? '' : 's') + '</div>';
    h += '<div class="c3">' + tile('Spent', usd(o.spent)) + tile('Won', usd(o.won), o.won > 0 ? 'cpos' : '') + tile('Net', usd(o.net, true), o.net > 0 ? 'cpos' : o.net < 0 ? 'cneg' : '') + '</div>';
    h += '<div class="cthead c3h"><span>Lot</span><span class="cr">Cost</span><span class="cr">Earned</span></div>';
    o.lots.forEach((l) => { h += '<button class="ctrow c3h" data-a="lot" data-lot="' + att(l.id) + '"><span class="cpn"><b>' + esc(l.name) + '</b><small class="' + (l.alive ? 'cpos' : 'cneg') + '">' + (l.alive ? 'alive' : 'out') + (l.share !== 'all' ? ' · ' + esc(l.share) : '') + '</small></span><span class="cr">' + usd(l.cost) + '</span><span class="cr cv ' + (l.earned > 0 ? 'cpos' : '') + '">' + usd(l.earned) + '</span></button>'; });
    return h + '<div class="cnote">' + MONEYLINE + '</div>';
  }
  function lotV() {
    const s = cur(), d = s.d; if (!d) return '<div class="ccard">Loading…</div>'; const c = d.calc, l = d.board.lots.find((x) => x.id === s.lot); if (!l) return '';
    const comm = c.role === 'comm', ev = { rounds: c.rounds || [] };
    let h = '<h1>' + esc(l.name) + '</h1><div class="cmeta">' + (l.holder ? 'Owner: ' + esc(l.holder.name) + (l.bb ? ' · half bought back by ' + esc(l.bb.name) : '') : 'Unsold') + '</div>';
    h += '<div class="c3">' + tile('Cost', l.sold ? usd(l.sold.amt) : '–') + tile('Earned', usd(l.earned), l.earned > 0 ? 'cpos' : '') + tile('Status', l.alive ? 'Alive' : 'Out', l.alive ? 'cpos' : 'cneg') + '</div>';
    l.teams.forEach((t) => {
      const r = t.r || { wins: 0, reached: 0, champ: false, out: false };
      h += '<div class="ccard"><div class="crow"><b>' + esc(t.name) + '</b><b class="cr ' + (t.earned > 0 ? 'cpos' : '') + '">' + usd(t.earned) + '</b></div><div class="cmeta">' + r.wins + ' win' + (r.wins === 1 ? '' : 's') + (r.reached && ev.rounds[r.reached - 1] ? ' · reached ' + esc(ev.rounds[r.reached - 1]) : '') + (r.champ ? ' · 🏆 champion' : '') + (r.out ? ' · out' : '') + (r.place ? ' · finished ' + ord(r.place) : '') + (r.big ? ' · biggest win' : '') + (r.manual ? ' · entered by hand' : '') + '</div>';
      if (comm) {
        if (s.rt === t.id) {
          h += '<div class="c2"><label class="clab">Wins<input id="rw" class="cin" type="number" inputmode="numeric" min="0" max="30" value="' + esc(r.wins) + '"></label>' + (ev.rounds.length ? '<label class="clab">Furthest round' + sel('rre', [[0, 'Not yet']].concat(ev.rounds.map((n, i) => [i + 1, n])), r.reached) + '</label>' : '<label class="clab">Place (0 = none)<input id="rpl" class="cin" type="number" inputmode="numeric" min="0" max="200" value="' + esc(r.place || 0) + '"></label>') + '</div>';
          h += '<div class="cline"><span>Champion</span>' + sw(s.rc != null ? s.rc : r.champ, 'data-a="rchamp"') + '</div><div class="cline"><span>Out (eliminated)</span>' + sw(s.ro != null ? s.ro : r.out, 'data-a="rout"') + '</div>';
          h += '<div class="c2"><button class="cpri" data-a="rsave" data-team="' + att(t.id) + '">Save result</button><button class="csec" data-a="rclear" data-team="' + att(t.id) + '"' + (r.manual ? '' : ' disabled') + '>Back to the score feed</button></div>';
        } else h += '<button class="clink" data-a="redit1" data-team="' + att(t.id) + '">Enter a result by hand ›</button>';
      }
      h += '</div>';
    });
    if (c.local) { // players of record + buy back half (owner rule Nov 16 2026: only the lot's own player(s), half for half the price)
      const por = l.por || [], mine = por.some((p) => p.me), half = l.sold ? usd(Math.floor(l.sold.amt * 100 / 2) / 100) : '';
      h += '<div class="ccard"><h2>Players of record</h2>' + (por.length ? '<div class="clist0">' + por.map((p, i) => '<div class="cmrow"><span>' + esc(p.name) + (p.me ? ' <i class="cmut">· you</i>' : '') + (p.pid ? '' : ' <i class="cmut">· not in the app</i>') + '</span>' + (comm && !l.bb ? '<button class="ctiny" data-a="pordel" data-i="' + i + '" data-lot="' + att(l.id) + '">Remove</button>' : '') + '</div>').join('') + '</div>' : '<div class="cnote">None. Nobody can buy back half of this lot.</div>');
      if (comm && !l.bb) h += whoForm('p', c, '', '').replace('Buyer', 'Add a player of record').replace('Who bought it?', 'Pick a member or type a name') + '<button class="csec cfull" data-a="poradd" data-lot="' + att(l.id) + '">Add player</button>';
      h += '</div>';
      if (c.rules.buyBack && l.sold && por.length) {
        h += '<div class="ccard"><h2>Buy back half</h2>';
        if (l.bb) h += '<div class="cmeta">' + esc(l.bb.name) + ' bought back half for ' + half + '. Cost and winnings split 50/50 (an odd cent goes to the winning bidder).</div>' + (comm || l.bb.pid === c.me ? '<button class="cdanger cfull" data-a="bbclear" data-lot="' + att(l.id) + '">Remove the buy-back</button>' : '');
        else if (mine) h += '<div class="cnote">This is your lot. Buy back half from ' + esc(l.holder.name) + ' for ' + half + ' (paid outside the app); you then own half of its cost and winnings.</div><button class="cpri cfull" data-a="bbself" data-lot="' + att(l.id) + '">Buy back half for ' + half + '</button>';
        else if (comm) h += '<label class="clab">Which player of record buys back' + sel('bwho', por.map((p, i) => [i, p.name]), s.bwho || 0) + '</label><div class="cnote">Recorded on their behalf. They pay ' + esc(l.holder.name) + ' ' + half + ' outside the app and own half.</div><button class="cpri cfull" data-a="bbsave" data-lot="' + att(l.id) + '">Record the buy-back</button>';
        else h += '<div class="cnote">Only ' + esc(por.map((p) => p.name).join(', ')) + ' can buy back half of this lot.</div>';
        h += '</div>';
      }
    }
    return h + '<div class="cnote">Hand-entered results override the score feed for that team and are listed in the history.</div>';
  }
  function auditV() { const s = cur(), d = s.d; if (!d) return ''; return '<h1>History</h1><div class="ccard clist">' + ((d.audit || []).map((a) => '<div class="cmrow"><span>' + esc(a.what) + '<small>' + esc(a.by) + ' · ' + esc(fmtTime(a.at)) + '</small></span></div>').join('') || '<div class="cmut">Nothing yet.</div>') + '</div>'; }
  function membersV() {
    const s = cur(), c = s.c; if (!c) return '<div class="ccard">Loading…</div>';
    let h = '<h1>Members</h1><div class="cmeta">' + c.members.length + ' of ' + c.max + ' people</div><div class="ccard">';
    if (c.a.status !== 'closed') h += '<div class="ccode"><span><small>Invite code</small><b>' + esc(c.code.replace(/(.{4})(?=.)/g, '$1 ')) + '</b></span></div><button class="cpri cfull" data-a="invite">Invite people</button>';
    h += '<div class="cnote">' + esc(CAPLINE(c.max)) + '</div></div><div class="ccard clist">' + c.members.map((m) => '<div class="cmrow"><span>' + esc(m.name) + (m.pid === c.me ? ' <i class="cmut">· you</i>' : '') + (m.comm ? ' <i class="cmut">· commissioner</i>' : '') + '</span></div>').join('') + '</div>';
    if (s.share) h += shareSheet(c);
    if (c.role === 'comm' && !c.locked) h += '<button class="csec cfull" data-a="editrules">Edit the rules</button><button class="cdanger cfull" data-a="delete">Delete this Calcutta</button>';
    return h + rulesCard(c);
  }
  const link = (c) => SITE + '?join=c.' + c.code;
  const shareText = (c) => 'Join my Calcutta "' + c.name + '" on Oddable: ' + link(c);
  function shareSheet(c) { return '<div class="ccard"><h2>Send the invite</h2><div class="cnote">' + esc(link(c)) + '</div><div class="c3">' + (navigator.share ? '<button class="csec" data-a="nshare">Share…</button>' : '') + '<button class="csec" data-a="copylink">Copy link</button><a class="cpri" href="sms:?&body=' + encodeURIComponent(shareText(c)) + '">Text it</a></div><div class="cnote">New to Oddable? The link signs them up first, then opens this Calcutta to join.</div></div>'; }

  // ---------- paint / poll ----------
  const el = () => document.getElementById('ocalc');
  function paintBusy(on) { const e = el(); if (e) e.classList.toggle('cbusy', !!on); }
  const VIEWS = { home, join: joinV, create1, create2, auction: auctionV, order: orderV, enter: enterV, board: boardV, pot: potV, owner: ownerV, lot: lotV, audit: auditV, members: membersV };
  function paint() {
    const e = el(); if (!e) return; const s = cur(), f = document.activeElement, fid = f && e.contains(f) ? f.id : '', fv = fid ? f.value : null, sp = fid && f.selectionStart != null ? [f.selectionStart, f.selectionEnd] : null;
    if (s.t === 'auction') { const i = document.getElementById('camt'); if (i) s.amt = i.value; }
    const back = stack.length > 1 ? (stack[stack.length - 2].t === 'home' ? 'Calcutta' : 'Back') : '';
    e.querySelector('.cin0').innerHTML = top(back) + (err ? '<div class="cerr" role="alert">' + esc(err) + '</div>' : '') + (note ? '<div class="cok" role="status">' + esc(note) + '</div>' : '') + (VIEWS[s.t] ? VIEWS[s.t]() : '');
    if (fid) { const n = document.getElementById(fid); if (n && n.tagName === 'INPUT') { if (fv != null && n.type !== 'checkbox') n.value = fv; n.focus(); try { if (sp) n.setSelectionRange(sp[0], sp[1]); } catch (x) {} } }
  }
  function push(o) { readDraft(); err = ''; note = ''; stack.push(o); paint(); const e = el(); if (e) e.scrollTop = 0; sched(); }
  async function loadHome() { try { H = await post('mine', {}); } catch (e) { err = errText(e); if (!H) H = { calcs: [], max: 8 }; } if (cur().t === 'home') paint(); }
  async function loadCalc(o) { try { const j = await post('get', { id: o.id }); setCalc(j.calc); o.c = j.calc; } catch (e) { err = errText(e); } paint(); }
  async function loadBoard(o) { try { const j = await post('board', { id: o.id }); o.d = j; setCalc(j.calc); err = ''; } catch (e) { err = errText(e); } paint(); }
  function sched() { // poll: 1.5 s on the live auction, 30 s on boards; nothing while the page is hidden or the overlay is closed
    clearTimeout(POLL); const s = cur(); if (!el()) return;
    if (s.t === 'auction' && s.c && s.c.a.status !== 'closed') POLL = setTimeout(async () => { if (!document.hidden && el() && cur() === s && !busy) { try { const j = await post('state', { id: s.id, rev: s.c.rev }); if (!j.same && cur() === s) { setCalc(j.calc); s.c = j.calc; paint(); } else if (j.same) { OFF = j.now - Date.now(); } } catch (e) {} } sched(); }, 1500);
    else if (['board', 'owner', 'lot', 'pot'].includes(s.t) && s.d) POLL = setTimeout(async () => { if (!document.hidden && el() && cur() === s && !busy && s.t !== 'lot') await loadBoard(s); sched(); }, 30000);
  }
  function tickClock() { // countdown between polls (server end time + clock offset)
    const s = cur(), t = document.getElementById('ctime'), b = document.getElementById('cbar'); if (!s || s.t !== 'auction' || !s.c || !t) return; const c = s.c; if (!c.a.high || c.a.paused) return;
    const l0 = left(c); t.textContent = clock(l0); t.className = 'ctimer ' + (l0 < 5000 ? 'cneg' : 'cgold'); if (b) b.style.width = Math.round(Math.max(0, Math.min(1, l0 / (c.a.timer * 1000))) * 100) + '%';
  }
  const openCalc = (id, c) => { try { sessionStorage.setItem('ocalc-open', id); } catch (x) {} const mode = c && c.rules && c.rules.mode; const s = { t: 'auction', id }; if (c) s.c = c; push(s); loadCalc(s).then(() => { if (s.c && s.c.rules.mode === 'manual' && cur() === s) { stack.pop(); const o = { t: s.c.role === 'comm' && s.c.a.status !== 'closed' ? 'enter' : 'board', id, c: s.c }; push(o); if (o.t === 'board') loadBoard(o); } else if (s.c && s.c.a.status === 'closed' && cur() === s) { stack.pop(); const o = { t: 'board', id }; push(o); loadBoard(o); } sched(); }); void mode; };
  const calcOf = () => { for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].c) return stack[i].c; if (stack[i].d) return stack[i].d.calc; } return null; };
  const idOf = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].id) return stack[i].id; return null; };
  const boardOf = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].d) return stack[i].d; return null; };

  function invite(c) { // shared router first (pics/join.js), else a local sheet
    if (window.OddJoin && typeof window.OddJoin.share === 'function') { try { window.OddJoin.share({ type: 'c', code: c.code, title: c.name, text: 'Join my Calcutta "' + c.name + '" on Oddable' }); return; } catch (e) {} }
    const s = cur(); if (s.t !== 'members') { push({ t: 'members', id: c.id, c, share: true }); return; } s.share = true; paint();
  }
  async function bid(amt) {
    const s = cur(), c = s.c; if (!c || !c.a.cur) return; if (!(Number.isInteger(amt) && amt > 0)) { err = 'Type a whole-dollar bid.'; paint(); return; }
    const done = async (j) => { setCalc(j.calc); s.c = j.calc; s.amt = ''; note = 'Bid in: ' + usd(amt); paint(); };
    done.fail = (e) => { const j = e.j || {}; if (j.code === 'outbid' || j.code === 'sold' || j.code === 'stale') { loadCalc(s); if (j.min) s.amt = String(j.min); } };
    await act('bid', { id: s.id, lot: c.a.cur, amt }, done);
  }

  function click(ev) {
    const t = ev.target.closest('button,a,[data-a],[data-tab]'); if (!t || t.disabled) return; const a = t.getAttribute('data-a');
    if (a === 'close') { readDraft(); clearTimeout(POLL); try { sessionStorage.removeItem('ocalc-open'); } catch (x) {} el().remove(); return; }
    if (a === 'back') { readDraft(); err = ''; note = ''; if (stack.length > 1) stack.pop(); const s = cur(); if (s.t === 'home') loadHome(); else if (s.t === 'auction' || s.t === 'enter' || s.t === 'members') loadCalc(s); else if (s.t === 'board') loadBoard(s); paint(); sched(); return; }
    if (t.hasAttribute('data-tab') && !a) { const s = cur(); if (s.t === 'board') { s.tab = t.getAttribute('data-tab'); paint(); } else { const o = { t: 'board', id: idOf(), tab: t.getAttribute('data-tab') }; push(o); loadBoard(o); } return; }
    if (t.hasAttribute('data-mode')) { readDraft(); DR.mode = t.getAttribute('data-mode'); paint(); return; }
    if (t.hasAttribute('data-main')) { readDraft(); DR.main = t.getAttribute('data-main') === '1'; paint(); return; }
    const pk = [...t.attributes].find((x) => x.name.startsWith('data-pick-')); if (pk) { readDraft(); DR.pick[pk.name.slice(10)] = pk.value; paint(); return; }
    if (a === 'create') { DR = draftNew(); push({ t: 'create1' }); if (!EV) post('events', {}).then((j) => { EV = j; paint(); }).catch((e) => { err = errText(e); paint(); }); return; }
    if (a === 'join') { push({ t: 'join' }); setTimeout(() => { const i = document.getElementById('ccode'); if (i) i.focus(); }, 50); return; }
    if (a === 'preview') { const s = cur(); s.code = (document.getElementById('ccode') || {}).value || ''; act('preview', { code: s.code }, async (j) => { s.pre = j.calc; paint(); }); return; }
    if (a === 'dojoin') { const s = cur(); act('join', { code: s.code }, async (j) => { stack = [{ t: 'home' }]; loadHome(); openCalc(j.calc.id, j.calc); }); return; }
    if (a === 'open') { openCalc(t.getAttribute('data-id')); return; }
    if (a === 'bundle') { readDraft(); DR.bundle = !DR.bundle; paint(); return; }
    if (a === 'allteams') { readDraft(); const all = DR.teams.every((x) => DR.pick[x.id] === 'lot'); DR.teams.forEach((x) => { DR.pick[x.id] = all ? 'out' : 'lot'; }); paint(); return; }
    if (a === 'cadd') { readDraft(); const i = document.getElementById('cadd'), v = (i && i.value || '').trim(); const pp = ((document.getElementById('caddp') || {}).value || '').split(',').map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 8).map((x) => ({ name: x.slice(0, 24) })); if (v && DR.custom.length < 80) DR.custom.push({ n: v.slice(0, 40), por: pp }); paint(); const n = document.getElementById('cadd'); if (n) n.focus(); return; }
    if (a === 'cdel') { readDraft(); DR.custom.splice(+t.getAttribute('data-i'), 1); paint(); return; }
    if (a === 'next') { readDraft(); if (DR.name.trim().length < 2) { err = 'Give it a name (2+ characters).'; paint(); return; } if (!DR.ev) { err = 'Pick an event.'; paint(); return; } if (lotsOut().length < 2) { err = 'Put at least 2 lots up for auction.'; paint(); return; } push({ t: 'create2' }); return; }
    if (a === 'bb') { readDraft(); DR.buyBack = !DR.buyBack; paint(); return; }
    if (a === 'redit') { readDraft(); DR.editRows = true; paint(); return; }
    if (a === 'rdone') { readDraft(); DR.editRows = false; paint(); return; }
    if (a === 'radd') { readDraft(); const ev = evOf(DR.ev); DR.rows.push({ k: ev.kinds[0], n: 1, pct: 0, r: 1 }); paint(); return; }
    if (a === 'rdel') { readDraft(); DR.rows.splice(+t.getAttribute('data-i'), 1); paint(); return; }
    if (a === 'submit') { readDraft(); const tot = Math.round(DR.rows.reduce((s, x) => s + (Number(x.pct) || 0) * (Number(x.n) || 0), 0) * 100) / 100; if (tot !== 100) { err = 'Payouts must total exactly 100% (now ' + tot + '%).'; DR.editRows = true; paint(); return; }
      act(DR.id ? 'edit' : 'create', payload(), async (j) => { DR = null; stack = [{ t: 'home' }]; loadHome(); const o = { t: 'members', id: j.calc.id, c: j.calc }; push(o); note = 'Created. Invite people, then start the auction.'; paint(); }); return; }
    if (a === 'editrules') { const c = cur().c; DR = draftNew(); Object.assign(DR, { id: c.id, name: c.name, ev: c.ev, mode: c.rules.mode, minBid: c.rules.minBid, inc: c.rules.inc, timer: c.rules.timer, buyBack: c.rules.buyBack, main: c.rules.main, order: c.rules.order, takeKind: c.rules.take.kind, takeV: c.rules.take.v, rows: c.rules.rows.map((r) => ({ k: r.k, r: r.r, n: r.n, pct: r.bp / 100, label: r.label })) });
      c.lots.forEach((l) => l.teams.forEach((x) => { DR.pick[x.id] = l.field ? 'field' : 'lot'; })); DR.custom = c.ev === 'custom' ? c.lots.map((l) => ({ n: l.name, por: (l.por || []).map((p) => ({ pid: p.pid, name: p.name })) })) : [];
      push({ t: 'create1' }); const go = () => { if (c.ev !== 'custom') post('teams', { ev: c.ev }).then((j) => { DR.teams = j.teams; paint(); }).catch((e) => { err = errText(e); paint(); }); }; if (!EV) post('events', {}).then((j) => { EV = j; paint(); go(); }); else go(); return; }
    if (a === 'delete') { if (!confirm('Delete this Calcutta for everyone?')) return; act('delete', { id: idOf() }, async () => { stack = [{ t: 'home' }]; await loadHome(); paint(); }); return; }
    // auction
    if (a === 'bid') { bid(+t.getAttribute('data-amt')); return; }
    if (a === 'bidin') { const v = (document.getElementById('camt') || {}).value; bid(Math.round(Number(v))); return; }
    if (a === 'ctl') { const op = t.getAttribute('data-op'), s = cur(); if (op === 'end' && !confirm('End the auction now? Unsold lots stay unsold.')) return; if (op === 'undo' && t.hasAttribute('data-sale') && !confirm('Undo the sale of ' + t.getAttribute('data-sale') + '? The lot goes back on the block with its bids.')) return; act('ctl', { id: s.id, op }, async (j) => { setCalc(j.calc); s.c = j.calc; paint(); sched(); }); return; }
    if (a === 'order') { push({ t: 'order', id: idOf(), c: calcOf() }); return; }
    if (a === 'mv') { const s = cur(), i = +t.getAttribute('data-i'), dd = +t.getAttribute('data-d'), o = s.o; [o[i], o[i + dd]] = [o[i + dd], o[i]]; paint(); return; }
    if (a === 'saveorder') { const s = cur(); act('ctl', { id: s.id, op: 'reorder', order: s.o }, async (j) => { setCalc(j.calc); stack.pop(); cur().c = j.calc; note = 'Order saved.'; paint(); sched(); }); return; }
    if (a === 'members') { const o = { t: 'members', id: idOf(), c: calcOf() }; push(o); loadCalc(o); return; }
    if (a === 'invite') { invite(cur().c); return; }
    if (a === 'nshare') { const c = cur().c; navigator.share({ title: c.name, text: 'Join my Calcutta "' + c.name + '" on Oddable', url: link(c) }).catch(() => {}); return; }
    if (a === 'copylink') { const c = cur().c; try { navigator.clipboard.writeText(link(c)); t.textContent = 'Copied'; } catch (x) { t.textContent = link(c); } return; }
    // results / boards
    if (a === 'board') { const o = { t: 'board', id: idOf(), tab: t.getAttribute('data-tab') || 'owners' }; push(o); loadBoard(o); return; }
    if (a === 'auction') { stack.pop(); const s = cur(); if (s.t !== 'auction') { const o = { t: 'auction', id: idOf() }; push(o); loadCalc(o).then(sched); } else { loadCalc(s).then(sched); } paint(); return; }
    if (a === 'enterv') { const o = { t: 'enter', id: idOf() }; push(o); loadCalc(o); return; }
    if (a === 'pot') { const o = { t: 'pot', id: idOf(), d: boardOf() }; push(o); if (!o.d) loadBoard(o); return; }
    if (a === 'owner') { push({ t: 'owner', id: idOf(), d: boardOf(), k: t.getAttribute('data-k') }); return; }
    if (a === 'lot') { const o = { t: 'lot', id: idOf(), d: boardOf(), lot: t.getAttribute('data-lot') }; push(o); loadBoard(o); return; }
    if (a === 'audit') { push({ t: 'audit', id: idOf(), d: boardOf() }); return; }
    if (a === 'edit1') { cur().edit = t.getAttribute('data-lot'); paint(); return; }
    if (a === 'enter') { const s = cur(), w = whoVal('e'), amt = Math.round(Number((document.getElementById('eamt') || {}).value)); if (!w) { err = 'Pick who bought it.'; paint(); return; } act('enter', Object.assign({ id: s.id, lot: t.getAttribute('data-lot'), amt }, w), async (j) => { setCalc(j.calc); s.c = j.calc; s.edit = null; note = 'Saved.'; paint(); }); return; }
    if (a === 'unenter') { if (!confirm('Remove this result?')) return; const s = cur(); act('unenter', { id: s.id, lot: t.getAttribute('data-lot') }, async (j) => { s.c = j.calc; s.edit = null; paint(); }); return; }
    if (a === 'closeres') { const s = cur(); act('close', { id: s.id }, async () => { const o = { t: 'board', id: s.id }; stack.pop(); push(o); loadBoard(o); }); return; }
    if (a === 'redit1') { const s = cur(); s.rt = t.getAttribute('data-team'); s.rc = null; s.ro = null; paint(); return; }
    if (a === 'rchamp' || a === 'rout') { const s = cur(), l = s.d.board.lots.find((x) => x.id === s.lot), tm = l.teams.find((x) => x.id === s.rt), r = tm.r || {}; if (a === 'rchamp') s.rc = !(s.rc != null ? s.rc : r.champ); else s.ro = !(s.ro != null ? s.ro : r.out); paint(); return; }
    if (a === 'rsave') { const s = cur(), v = (id) => (document.getElementById(id) || {}).value, b = { id: s.id, team: t.getAttribute('data-team'), wins: Math.round(Number(v('rw') || 0)) };
      if (v('rre') != null) b.reached = +v('rre'); if (v('rpl') != null) b.place = Math.round(Number(v('rpl'))); if (s.rc != null) b.champ = s.rc; if (s.ro != null) b.out = s.ro;
      act('result', b, async () => { s.rt = null; note = 'Result saved.'; await loadBoard(s); }); return; }
    if (a === 'rclear') { const s = cur(); act('result', { id: s.id, team: t.getAttribute('data-team'), clear: true }, async () => { s.rt = null; await loadBoard(s); }); return; }
    if (a === 'bbsave') { const s = cur(), i = +((document.getElementById('bwho') || {}).value || 0); act('buyback', { id: s.id, lot: t.getAttribute('data-lot'), who: i }, async () => { note = 'Buy-back recorded.'; await loadBoard(s); }); return; }
    if (a === 'bbself') { const s = cur(); act('buyback', { id: s.id, lot: t.getAttribute('data-lot'), self: true }, async () => { note = 'You bought back half.'; await loadBoard(s); }); return; }
    if (a === 'poradd') { const s = cur(), w = whoVal('p'); if (!w) { err = 'Pick a member or type a name.'; paint(); return; } act('por', { id: s.id, lot: t.getAttribute('data-lot'), add: w }, async () => { note = 'Player of record added.'; await loadBoard(s); }); return; }
    if (a === 'pordel') { const s = cur(); act('por', { id: s.id, lot: t.getAttribute('data-lot'), remove: +t.getAttribute('data-i') }, async () => { await loadBoard(s); }); return; }
    if (a === 'bbclear') { const s = cur(); act('buyback', { id: s.id, lot: t.getAttribute('data-lot'), clear: true }, async () => { await loadBoard(s); }); return; }
  }
  function change(ev) {
    const id = ev.target && ev.target.id; if (!id) return; const s = cur();
    if (id === 'cev') { readDraft(); pickEv(ev.target.value); return; }
    if (ev.target.hasAttribute('data-who')) { const p = ev.target.getAttribute('data-who');  const box = ev.target.closest('.ccard'); if (box) { const n = box.querySelector('#' + p + 'name'); if (ev.target.value === '_' && !n) ev.target.closest('label').insertAdjacentHTML('afterend', '<label class="clab">Their name<input id="' + p + 'name" class="cin" maxlength="24"></label>'); if (ev.target.value !== '_' && n) n.closest('label').remove(); } return; }
    if (/^(ctake|ctv|rk\d+|rr\d+|rn\d+|rp\d+|cmin|cinc|ctimer|corder)$/.test(id)) { readDraft(); paint(); }
  }
  function input(ev) { if (ev.target && ev.target.id === 'cq') { readDraft(); paint(); } }
  function keydown(ev) { if (ev.key !== 'Enter' || !ev.target) return; const id = ev.target.id; if (id === 'camt') { ev.preventDefault(); bid(Math.round(Number(ev.target.value))); } if (id === 'cadd') { ev.preventDefault(); el().querySelector('[data-a="cadd"]').click(); } if (id === 'ccode') { ev.preventDefault(); el().querySelector('[data-a="preview"]').click(); } }
  function css() {
    if (document.getElementById('occss')) return; const st = document.createElement('style'); st.id = 'occss';
    st.textContent = '#ocalc{--cbg:#0f0c18;--cp:#1b1630;--cp2:#14111f;--cl:#2f2850;--ci:#f1eefa;--cm:#a59fbd;--cv:#7c3aed;--cv2:#a78bfa;--cg:#4fd18b;--cr:#ff7a70;--cy:#f5c542;position:fixed;inset:0;z-index:96;background:var(--cbg);color:var(--ci);overflow:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
      + '#ocalc .cin0{max-width:560px;margin:0 auto;padding:0 16px calc(48px + env(safe-area-inset-bottom))}#ocalc.cbusy{cursor:progress}#ocalc.cbusy .cpri,#ocalc.cbusy .cgo{opacity:.6}'
      + '#ocalc *{box-sizing:border-box}#ocalc h1{font-size:30px;line-height:1.15;margin:8px 0 6px;overflow-wrap:anywhere}#ocalc h2{font-size:18px;margin:0 0 10px}#ocalc h2.cmt{margin-top:16px}#ocalc .csub{color:var(--cm);margin:0 0 16px}'
      + '#ocalc .ctop{position:sticky;top:0;z-index:2;background:var(--cbg);display:flex;justify-content:space-between;align-items:center;padding:max(8px,env(safe-area-inset-top)) 0 6px}'
      + '#ocalc button,#ocalc a.cpri{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}#ocalc button:disabled{opacity:.45;cursor:not-allowed}'
      + '#ocalc .cback,#ocalc .cx,#ocalc .clink{background:none;border:0;color:var(--cv2);font-weight:600;min-height:44px;padding:0 4px;text-align:left}#ocalc .cx{color:var(--cm)}#ocalc .clink{display:block;width:100%;margin-top:4px}'
      + '#ocalc .cpri,#ocalc .csec,#ocalc .cdanger,#ocalc .cgreen,#ocalc .cgo{min-height:48px;border-radius:14px;font-weight:700;font-size:16px;padding:10px 12px;text-decoration:none;display:flex;align-items:center;justify-content:center;text-align:center}'
      + '#ocalc .cpri{background:var(--cv);border:1px solid var(--cv);color:#fff}#ocalc .csec{background:var(--cp2);border:1px solid var(--cl)}#ocalc .cdanger{background:none;border:1px solid #6b2a35;color:var(--cr)}#ocalc .cgreen{background:#1a5c34;border:1px solid #1a5c34;color:#e8ffe8}#ocalc .cgo{background:var(--cy);border:0;color:#1a1300;min-width:84px}#ocalc .cfull{width:100%;margin:12px 0}'
      + '#ocalc .c2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin:10px 0}#ocalc .c3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0}#ocalc .c3r{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:end}'
      + '#ocalc .ch{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--cm);margin:22px 0 10px}'
      + '#ocalc .ccard{background:var(--cp);border:1px solid var(--cl);border-radius:18px;padding:14px 16px;margin:10px 0;display:block;width:100%;text-align:left}#ocalc .cbtn{color:inherit}#ocalc .cblock{border:2px solid var(--cv2);background:#221b3d}'
      + '#ocalc .crow{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}#ocalc .cname{font-size:20px;font-weight:700;flex:1;min-width:0;overflow-wrap:anywhere}'
      + '#ocalc .cbadge{background:#3b2a78;color:#ddd3ff;border-radius:999px;padding:4px 12px;font-size:13px;font-weight:700;white-space:nowrap}#ocalc .cbadge.cy{background:#3a3010;color:var(--cy)}'
      + '#ocalc .cmeta{color:var(--cm);margin:2px 0}#ocalc .cmut{color:var(--cm)}#ocalc .cnote{color:var(--cm);font-size:13.5px;margin:8px 0;overflow-wrap:anywhere}#ocalc .cyel{color:var(--cy)}#ocalc .cpos{color:var(--cg)}#ocalc .cneg{color:var(--cr)}#ocalc .cgold{color:var(--cy)}'
      + '#ocalc .ctile{background:var(--cp2);border:1px solid var(--cl);border-radius:14px;padding:10px 12px;text-align:left;min-height:64px;display:block;width:100%;min-width:0}#ocalc .ctile:disabled{opacity:1;cursor:default}#ocalc .ctile small{display:block;color:var(--cm);font-size:13px}#ocalc .ctile b{display:block;font-size:22px;line-height:1.2;overflow-wrap:anywhere}#ocalc .ctile i{display:block;font-style:normal;color:var(--cm);font-size:12.5px;margin-top:2px}'
      + '#ocalc .clab{display:block;color:var(--cm);font-size:14px;font-weight:600;margin:12px 0 6px}#ocalc .clab .cin,#ocalc .clab .csel{margin-top:6px}'
      + '#ocalc .cin,#ocalc .csel{width:100%;min-height:48px;background:var(--cp2);border:1px solid var(--cl);border-radius:14px;color:var(--ci);font:600 16px system-ui;padding:10px 12px;color-scheme:dark;min-width:0}#ocalc .ccodein{text-transform:uppercase;letter-spacing:.12em;font-size:19px}'
      + '#ocalc .cseg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:8px;margin:6px 0}#ocalc .cseg button{min-height:48px;border-radius:14px;border:1px solid var(--cl);background:var(--cp2);font-weight:700;padding:6px}#ocalc .cseg button.on{background:var(--cv);border-color:var(--cv);color:#fff}#ocalc .c3s{margin:12px 0}'
      + '#ocalc .cteam{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 10px;padding:6px 0;border-bottom:1px solid var(--cl)}#ocalc .cteam>span{flex:1 1 120px;min-width:0;overflow-wrap:anywhere;font-weight:600}#ocalc .cteam .cseg{flex:1 1 220px;margin:0}#ocalc .cteam .cseg button{min-height:44px;font-size:14px}'
      + '#ocalc .cline{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:52px;padding:4px 0}#ocalc .cline small{display:block;color:var(--cm);font-size:13px}'
      + '#ocalc .csw{flex:0 0 auto;width:64px;height:44px;border:0;background:none;position:relative;padding:0}#ocalc .csw::before{content:"";position:absolute;left:1px;right:1px;top:4px;bottom:4px;border-radius:999px;border:1px solid var(--cl);background:var(--cp2)}#ocalc .csw i{position:absolute;top:9px;left:6px;width:26px;height:26px;border-radius:50%;background:#bdb5d6;transition:left .15s}#ocalc .csw.on::before{background:#8b5cf6;border-color:#8b5cf6}#ocalc .csw.on i{left:32px;background:#fff}'
      + '#ocalc .cwarn{background:#2a2108;border:1px solid #8a6a12;border-radius:16px;padding:14px 16px;margin:14px 0;color:#efe6cf}#ocalc .cwarn b{display:block;color:var(--cy);font-size:17px;margin-bottom:4px}'
      + '#ocalc .cerr{background:#3a1520;border:1px solid #6b2a35;color:#ffd0d0;border-radius:12px;padding:10px 12px;margin:8px 0}#ocalc .cok{background:#12301f;border:1px solid #2e7a52;color:#cff5df;border-radius:12px;padding:10px 12px;margin:8px 0}'
      + '#ocalc .ccode{display:flex;align-items:center;gap:8px;background:var(--cp2);border-radius:14px;padding:10px 12px;flex-wrap:wrap}#ocalc .ccode small{display:block;color:var(--cm)}#ocalc .ccode b{font-size:20px;letter-spacing:.1em;overflow-wrap:anywhere}'
      + '#ocalc .clist{padding:4px 16px}#ocalc .cmrow{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:52px;border-bottom:1px solid var(--cl);padding:6px 0;width:100%;background:none;border-left:0;border-right:0;border-top:0;text-align:left}#ocalc .cmrow:last-child{border-bottom:0}#ocalc .cmrow>span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}#ocalc .cmrow small{display:block;color:var(--cm);font-size:12.5px}#ocalc .cmrow i{font-style:normal}#ocalc .cud{display:flex;gap:6px}'
      + '#ocalc .ctiny{background:none;border:1px solid var(--cl);border-radius:10px;color:var(--cm);min-height:44px;min-width:52px;padding:0 10px}'
      + '#ocalc .cthead,#ocalc .cthd{display:grid;grid-template-columns:minmax(0,1fr) 84px 84px;gap:8px;color:var(--cm);font-size:13px;font-weight:600;padding:12px 14px 4px}#ocalc .cthd{grid-template-columns:minmax(0,1fr) auto;padding:2px 0 4px}#ocalc .ccard .cthead{padding-left:0;padding-right:0}#ocalc .cr{text-align:right;justify-self:end}'
      + '#ocalc .ctrow{display:grid;grid-template-columns:minmax(0,1fr) 84px 84px;gap:8px;align-items:center;width:100%;text-align:left;background:var(--cp);border:1px solid var(--cl);border-radius:16px;padding:12px 14px;margin:8px 0;min-height:60px}#ocalc .ctrow.me{border:2px solid var(--cv2)}#ocalc .cpn{min-width:0}#ocalc .cpn b{display:block;font-size:16px;overflow-wrap:anywhere}#ocalc .cpn small{display:block;color:var(--cm);font-size:12.5px}#ocalc .cpn small.cpos{color:var(--cg)}#ocalc .cpn small.cneg{color:var(--cr)}#ocalc .cv{font-weight:700;font-size:16px}'
      + '#ocalc .crules>div{display:flex;flex-direction:column;padding:8px 0;border-bottom:1px solid var(--cl)}#ocalc .crules small{color:var(--cm);font-size:12.5px}#ocalc .crules span{overflow-wrap:anywhere}'
      + '#ocalc .ckv{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--cl)}#ocalc .ckv span{min-width:0;overflow-wrap:anywhere}#ocalc .ckv small{display:block;color:var(--cm);font-size:12.5px}#ocalc .ckv b{text-align:right;white-space:nowrap}#ocalc .ckv.ctot{border-bottom:0}#ocalc .ckv.ctot b{font-size:20px}'
      + '#ocalc .ckv3{display:grid;grid-template-columns:minmax(0,1fr) 84px 84px;gap:8px;padding:10px 0;border-bottom:1px solid var(--cl)}#ocalc .ckv3 span{min-width:0;overflow-wrap:anywhere}#ocalc .ckv3 small{display:block;color:var(--cm);font-size:12.5px}#ocalc .ckv3 b{text-align:right}'
      + '#ocalc .crowed{border-bottom:1px solid var(--cl);padding-bottom:8px;margin-bottom:6px}#ocalc .clots summary{min-height:44px;display:flex;align-items:center;color:var(--cv2);font-weight:600;cursor:pointer}'
      + '#ocalc .cbig{font-size:28px;font-weight:800;margin:6px 0;overflow-wrap:anywhere;line-height:1.15}#ocalc .ctimer{font-size:26px;font-variant-numeric:tabular-nums}#ocalc .chigh{font-size:34px;color:var(--cg);font-variant-numeric:tabular-nums}'
      + '#ocalc .cbar{height:10px;background:var(--cp2);border-radius:99px;margin:10px 0;overflow:hidden}#ocalc .cbar i{display:block;height:100%;background:var(--cy);border-radius:99px;transition:width .2s linear}'
      + '#ocalc .cbidrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;margin-top:4px}'
      + '@media (max-width:360px){#ocalc .cthead,#ocalc .ctrow,#ocalc .ckv3{grid-template-columns:minmax(0,1fr) 72px 72px}#ocalc .c3{grid-template-columns:1fr 1fr}}';
    document.head.appendChild(st);
  }
  // entry point: window.oddCalc() opens the list; oddCalc({join: code}) opens the join preview for an invite code; oddCalc({id}) opens one Calcutta
  window.oddCalc = function (o) {
    css(); let e = el(); if (e) e.remove(); e = document.createElement('div'); e.id = 'ocalc'; e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', 'Calcutta');
    e.innerHTML = '<div class="cin0"></div>'; document.body.appendChild(e); try { sessionStorage.setItem('ocalc-open', o && o.id ? o.id : '1'); } catch (x) {}
    stack = [{ t: 'home' }]; err = ''; note = ''; e.addEventListener('click', click); e.addEventListener('change', change); e.addEventListener('input', input); e.addEventListener('keydown', keydown); paint(); loadHome();
    clearInterval(TICK); TICK = setInterval(() => { if (!el()) { clearInterval(TICK); return; } tickClock(); }, 250);
    if (o && o.join) { const s = { t: 'join', code: String(o.join), fromLink: true }; push(s); act('preview', { code: s.code }, async (j) => { s.pre = j.calc; paint(); }); }
    else if (o && o.id) openCalc(String(o.id));
  };
  // invite links: pics/join.js routes ?join=c.<code> here (after sign-up / sign-in)
  const reg = () => { if (window.OddJoin && typeof window.OddJoin.register === 'function' && !reg.done) { reg.done = true; window.OddJoin.register('c', (x) => window.oddCalc({ join: typeof x === 'string' ? x : x && x.code })); } };
  reg(); if (!reg.done) { document.addEventListener('DOMContentLoaded', reg); setTimeout(reg, 1500); }
  // A reload while it is open (new version, sync from another device) puts it back.
  try { const v = sessionStorage.getItem('ocalc-open'); if (v) setTimeout(() => { if (!el() && window.oddCalc && g('odd-tok')) window.oddCalc(v === '1' ? null : { id: v }); }, 1500); } catch (e) {}
})();
