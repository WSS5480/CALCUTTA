// Oddable Calcutta auction, phone side (branch calc-live, Nov 17 2026). A GROUP GAME: this file is fetched by pics/groups.js the first time a member taps
// the "Calcutta" tile of a group (calcutta.js?v=CDV), so only an account the server switched Groups on for ever gets it (GROUPS_ENABLED /
// GROUPS_OWNER_ONLY / GROUPS_TESTERS). Ported from the reviewed engine screens (dc5371b "Calcutta round 4"), without the preview's code.
// Full-screen overlay #ocalc above the Groups overlay; window.oddCalc({ gr }) opens the Calcuttas of group gr. Every rule, bid, clock and dollar comes
// from the server (odds-api/calcutta.js); this file only shows them. Money is information only: Oddable never collects, holds or pays money, and
// nothing here sends a message to anyone (no invite code, no share sheet, no claim link: members join from their group).
(function () {
  const API = 'https://calcutta-odds.onrender.com/calcutta/'; // the same server as pics/groups.js
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const att = (x) => esc(String(x == null ? '' : x).replace(/[^\w.:-]/g, '')); // ':' kept: source lot ids look like t:<gameId>:<tid>
  const usd = (n, sign) => { const v = Math.round((Number(n) || 0) * 100) / 100, a = Math.abs(v), s = '$' + (Number.isInteger(a) ? a.toLocaleString() : a.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })); return (v < 0 ? '-' : sign && v > 0 ? '+' : '') + s; };
  const pct = (p) => (Math.round(p * 100) / 100) + '%';
  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const fmtTime = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const MONEYLINE = 'Money is settled outside the app. Oddable keeps the score and shows who is owed what. Oddable never collects, holds or pays money.';
  const PRICE = 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game.'; // shared owner wording, no "Contact us" (L7: nothing to tap) (OWNER-DECISIONS: Limits and pricing)
  const CAPLINE = (n) => 'Up to ' + (n || 8) + ' people, the commissioner included.' + ((n || 8) <= 8 ? ' ' + PRICE : '');
  const KIND = { win: 'Each win', round: 'Reaches a round', champ: 'Champion', big: 'Biggest win margin', place: 'Finishes in a place' };
  let GR = null, MINE = false, stack = [{ t: 'home' }], H = null, EV = null, busy = false, err = '', note = '', DR = null, POLL = null, OFF = 0, TICK = null, FAILS = 0, DOWNAMT = null, UNDOAT = 0, LOTAT = 0;

  // ---------- server ----------
  async function post(op, b) {
    const sig = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined; // M2: never wait on a slow server for more than 6 s
    const r = await fetch(API + op, { method: 'POST', signal: sig, headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify(Object.assign({ myName: g('odd-name') || '' }, b || {})) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server said ' + r.status), { status: r.status, j, expired: !!j.expired, off: !!j.off }); return j;
  }
  const errText = (e) => (e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'The server did not answer in time. Look at the screen before you try again.' : e && /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Could not reach the server. It may be waking up: try again in a few seconds.' : e && e.status === 401 ? 'Sign in to use Calcutta.' : (e && e.message) || 'Something went wrong'); // 403 off / expired: the server's own sentence (Groups is not open for this account yet. / Your time has ended. ...)
  async function act(op, b, then) { if (busy) return; busy = true; err = ''; note = ''; paintBusy(true); try { const j = await post(op, b); busy = false; await then(j); } catch (e) { busy = false; if (e && e.expired) { try { localStorage.setItem('odd-exp', '1'); } catch (x) {} } err = errText(e); if (then.fail) then.fail(e); paint(); if (e && e.j && (e.j.code === 'frozen' || e.j.code === 'feed' || e.j.code === 'porlocked' || e.j.code === 'changed')) { const s = cur(), m = err; (s.d ? loadBoard(s) : s.c ? loadCalc(s) : Promise.resolve()).then(() => { err = m; paint(); }); } } paintBusy(false); }
  const cur = () => stack[stack.length - 1];
  const setCalc = (c) => { if (!c) return; OFF = (c.now || Date.now()) - Date.now(); stack.forEach((s) => { if (s.id === c.id && newer(s.c, c)) s.c = c; }); };
  const newer = (was, c) => !was || !c || (c.rev || 0) >= (was.rev || 0); // M2: a poll that answers after a bid never paints the older state over it

  // ---------- small parts ----------
  const top = (back) => '<div class="ctop">' + (back ? '<button class="cback" data-a="back">‹ ' + esc(back) + '</button>' : '<span></span>') + '<b class="cbrand">🏆<span class="cbt"> Calcutta</span></b><button class="cx" data-a="close" aria-label="Close Calcutta">Close</button></div>';
  const tile = (lab, val, cls, a, sub) => '<button class="ctile" ' + (a || 'disabled') + '><small>' + esc(lab) + (a ? ' ›' : '') + '</small><b class="' + (cls || '') + '">' + val + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</button>';
  const sw = (on, a, dis) => '<button class="csw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" ' + (dis ? 'disabled' : a) + '><i></i></button>';
  const seg = (opts, curV, a) => '<div class="cseg">' + opts.map(([v, l]) => '<button class="' + (String(v) === String(curV) ? 'on' : '') + '" ' + a + '="' + att(v) + '">' + esc(l) + '</button>').join('') + '</div>';
  const sel = (id, opts, curV, extra) => '<select id="' + id + '" class="csel" ' + (extra || '') + '>' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(curV) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
  const fresh = (c) => (c && c.notices ? c.notices.filter((n) => !/^The commissioner /.test(n.what) || (c.now || Date.now() + OFF) - n.at < 180e3) : []); // Pause / Undo / Sold now notices are live news: shown for 3 minutes (always in the history)
  const notices = (c0) => { const c = c0 && { notices: fresh(c0), me: c0.me }; return noticesOf(c); };
  const nText = (n, me) => (n.k === 'undo' && me && n.pid === me ? 'The commissioner removed your ' + usd(n.amt) + ' bid' : n.what.replace(/ \(after the auction closed\)$/, '')); // M1: an undo that names me says so plainly
  const noticesOf = (c) => (c && c.notices && c.notices.length ? '<div class="cwarn cnots" role="status"><b>' + (c.notices.slice(0, 3).every((n) => / \(after the auction closed\)$/.test(n.what)) ? 'Changed after the auction closed' : 'Notices') + '</b>' + c.notices.slice(0, 3).map((n) => esc(nText(n, c.me)) + ' · ' + esc(n.by) + ' · ' + esc(fmtTime(n.at))).join('<br>') + '</div>' : '');
  // ROUND 3 #6: every screen honours calc.started: the lock line replaces the Bid / Enter / Buy-back buttons (no more "try it and get an error")
  const lockCard = (c) => (!c ? '' : c.started ? '<div class="cwarn clockd" role="status"><b>🔒 The event has started</b>Who owns what is final. No more sales, buy-backs or player changes.</div>' : c.feedLock ? '<div class="cwarn clockd" role="status"><b>🔒 Locked for now</b>The score feed cannot be read and the event may have started. Sales and buy-backs open again if it has not.</div>' : c.kick ? '<div class="cnote ckick">🔒 Sales, buy-backs and players lock for good when the event starts: ' + esc(fmtTime(c.kick)) + '.</div>' : '');
  const badge = (c) => (c.rules && c.rules.main ? '<span class="cbadge">Main pot</span>' : '<span class="cbadge cy">Side pot</span>');
  // v279: "Waiting on the …" names each postponed / moved GAME once (board.waitGames: the lotted teams of each game, "A vs B"); an older server's
  // flat team list (board.waiting) still reads as before.
  const andList = (L) => (L.length > 3 ? L.slice(0, 3).join(', ') + ' and ' + (L.length - 3) + ' more' : L.length === 1 ? L[0] : L.slice(0, -1).join(', ') + ' and ' + L[L.length - 1]);
  const waitText = (b) => { const G = Array.isArray(b.waitGames) && b.waitGames.length ? b.waitGames.map((t) => t.join(' vs ')) : b.waiting; return esc(andList(G)) + (G.length === 1 ? ' game' : ' games'); };
  const statusText = (s) => (s === 'setup' ? 'not started' : s === 'live' ? 'auction running' : 'auction closed');
  const rowText = (r, rounds) => (r.label || KIND[r.k]) + (r.k === 'win' || r.k === 'round' ? ' (' + r.n + ')' : '');

  // ---------- home ----------
  // L7: three plain lines for someone who has never played one
  const NEWBOX = '<div class="ccard cnew"><b>New to Calcutta?</b><span>1. Each team (a "lot") is auctioned to the highest bidder in the group.</span><span>2. All the winning bids together make the pot.</span><span>3. Owners get paid from the pot as their teams win, by the payout table.</span></div>';
  function home() { // MAIN: the Calcuttas of this group (list {g}); the group's commissioner starts one, members join one from here. F8: My Calcuttas (mine) when the group is gone
    const t = MINE ? 'My Calcuttas' : 'Calcutta';
    if (!H) return '<h1>' + t + '</h1><div class="ccard">Loading ' + (MINE ? 'your' : 'the group\'s') + ' Calcuttas…</div>';
    let s = '<h1>' + t + '</h1><p class="csub">' + (MINE ? 'Every Calcutta you are in, from all your groups.' : esc(H.group || (GR && GR.name) || '') + ' · Auction the teams, own them for the whole event, get paid as they win.') + '</p>';
    if (H.orphan) s += '<div class="cwarn"><b>Group not available</b>This group could not be opened (it may have been deleted, or you left it). The Calcuttas you are in from it are still here.</div>';
    if (!H.calcs.length || !H.calcs.some((c) => c.joined)) s += NEWBOX;
    if (MINE || H.orphan) { /* no new Calcutta without a group */ }
    else if (H.comm) s += '<button class="cpri cfull" data-a="create">Start a Calcutta</button>';
    else s += '<div class="cnote">The group\'s commissioner starts each Calcutta. Join one below to bid.</div>';
    if (!H.calcs.length) s += '<div class="ccard cmut">' + (MINE ? 'You are not in a Calcutta yet. Open one from a group.' : H.orphan ? 'None to show.' : 'No Calcutta in this group yet.' + (H.comm ? ' Start one: main, side or this weekend\'s games.' : '')) + '</div>';
    s += '<div class="cgrid">' + H.calcs.map((c) => '<button class="ccard cbtn" data-a="' + (c.joined ? 'open' : 'gpre') + '" data-id="' + att(c.id) + '"><div class="crow"><b class="cname">' + esc(c.name) + '</b>' + (c.comm ? '<span class="cbadge">Commissioner</span>' : c.joined ? '<span class="cbadge">In</span>' : '<span class="cbadge cy">Join</span>') + '</div><div class="cmeta">' + esc(c.evLabel) + ' · ' + esc(statusText(c.status)) + ' · ' + c.people + (c.people === 1 ? ' person' : ' people') + ' ›</div></button>').join('') + '</div>';
    return s + '<div class="cnote">' + esc(MONEYLINE) + '</div><div class="cnote">' + esc(CAPLINE(H.max)) + '</div>';
  }
  // ---------- join (from the group: look first, then join) ----------
  function joinV() {
    const s = cur(), c = s.pre;
    let h = '<h1>Join a Calcutta</h1>';
    if (!c) return h + (!err ? '<div class="ccard">Loading…</div>' : '');
    h += '<div class="ccard"><div class="crow"><b class="cname">' + esc(c.name) + '</b>' + badge(c) + '</div><div class="cmeta">' + esc(c.evLabel) + ' · ' + c.lots.length + ' lots · ' + c.count + ' of ' + c.max + ' people · ' + esc(statusText(c.status)) + '</div></div>';
    if (c.role === 'none') h += c.status === 'closed' ? '<div class="cwarn"><b>This auction is over</b>New members cannot join.</div>' : '<button class="cpri cfull" data-a="gjoin" data-id="' + att(c.id) + '">Join ' + esc(c.name) + '</button><div class="cnote">You join with the name the group shows. You can bid once you have joined. ' + esc(CAPLINE(c.max)) + '</div>'; // MAIN: every Calcutta is a group's
    else h += '<button class="csec cfull" data-a="open" data-id="' + att(c.id) + '">You are in. Open it ›</button>';
    return h + (c.role === 'none' ? NEWBOX : '') + rulesCard(c); // L7: Join sits above the long rules card
  }
  function rulesCard(c) {
    const r = c.rules; let h = '<div class="ccard"><h2>' + (c.locked ? '🔒 Locked rules' : 'Rules (lock at the first bid)') + '</h2><div class="crules">';
    [['Event', c.evLabel], ['Auction', r.mode === 'live' ? 'Live in the app · ' + r.timer + ' s timer, resets on every bid' : 'Held in person; the commissioner enters who bought what'], ['Lowest bid', usd(r.minBid) + ' · raise by at least ' + usd(r.inc)], ['Buy back half', !c.local ? 'Not for pro teams or golfers' : r.buyBack ? 'Allowed: the players on a lot can buy back half of it for half the winning price; cost and winnings split 50/50' : 'Off'],
      ['Pot', r.main ? 'Main Calcutta: bids join the group pot' : 'Side Calcutta: its own pot, paid separately'], ["Commissioner's take", c.takeText + ' (taken from the pot before anything is paid)'], ['Unsold lots', c.unsoldText || 'If an unsold lot wins, its winnings are added to the sold lots\' payouts, shared by what each earned.'], ['Order', r.order === 'random' ? 'Random, drawn when the auction starts' : 'As listed'],
      ['Results', c.feedBacked ? 'From the score feed only. The commissioner can enter a correction only if the feed still has no result 24 hours after a game\'s scheduled end; everyone is told, and the feed replaces it when it reports.' : 'Entered by the commissioner; every result or change is sent to all members.']]
      .concat(r.rows.some((x) => x.k === 'place') ? [['Ties', 'Teams tied for a paid place split those places evenly, to the cent (two tied for 1st share 1st + 2nd; the next team is 3rd).']] : []).forEach(([k, v]) => { h += '<div><small>' + esc(k) + '</small><span>' + esc(v) + '</span></div>'; });
    h += '</div><h2 class="cmt">Payout table</h2><div class="cthd"><span>Team</span><span class="cr">% of Calcutta</span></div>';
    r.rows.forEach((x) => { h += '<div class="ckv"><span>' + esc(rowText(x, c.rounds)) + '</span><b>' + pct(x.bp / 100) + (x.n > 1 ? ' each' : '') + '</b></div>'; });
    const tot = r.rows.reduce((a, x) => a + x.bp * x.n, 0) / 100; h += '<div class="ckv ctot"><span>Total</span><b class="cpos">' + pct(tot) + '</b></div>';
    h += '<div class="cnote">The take comes off the whole pot first. These percentages split what is left. ' + MONEYLINE + '</div>';
    h += '<details class="clots"><summary>' + c.lots.length + ' lots up for auction ›</summary>' + c.lots.map((l) => '<div class="cmrow"><span>' + esc(l.name) + (l.field ? '<small>' + esc(l.teams.map((t) => t.name).join(', ')) + '</small>' : '') + '</span></div>').join('') + '</details></div>';
    return h;
  }

  // ---------- create ----------
  function draftNew() { return { name: '', ev: '', teams: [], pick: {}, bundle: true, q: '', custom: [], mode: 'live', minBid: 5, inc: 5, timer: (EV && EV.timer0) || 25, unsold: 'roll', buyBack: false, main: true, rows: [], editRows: false, takeKind: 'none', takeV: 0, order: 'listed' }; }
  const hasRef = (d, ev) => (ev.needsRef === 'evtId' ? !!d.evtId : !!(d.golf && d.golf[ev.needsRef]));
  const SOON = { // MAIN: why an event is not open yet (the server says which are open)
    pga_season: 'Coming soon. A season-long PGA Calcutta needs season standings, and the score feed has none yet.',
    golf: 'Coming soon. The PGA Tour score feed could not be plugged in.',
    'golf-day': 'Coming soon. A Calcutta on a group Golf day is not wired up yet.',
    local: 'Coming soon. Local events and pickleball arrive with their own build.' };
  function evOf(k) { return (EV && EV.events.find((e) => e.key === k)) || null; }
  function create1() {
    const d = DR; if (!EV) return '<div class="ccard">Loading events…</div>';
    let h = '<div class="crow"><h1>' + (d.id ? 'Edit Calcutta' : 'New Calcutta') + '</h1><span class="cmut">Step 1 of 2</span></div>';
    h += '<label class="clab">Name<input id="cname" class="cin" maxlength="40" placeholder="Playoff Calcutta" value="' + esc(d.name) + '"></label>';
    h += '<div class="ccard"><h2>What\'s up for auction</h2><label class="clab">Event' + sel('cev', [['', 'Pick an event']].concat(EV.events.map((e) => [e.key, e.label + (e.on ? '' : ' (coming soon)')])), d.ev) + '</label>';
    const ev = evOf(d.ev);
    if (ev && !ev.on) h += '<div class="cnote cyel">' + esc(SOON[ev.key] || 'Coming soon.') + '</div>';
    else if (ev && ev.manualOnly) {
      h += '<div class="cnote">Type each team or player. You enter the results by hand.</div>';
      d.custom.forEach((x, i) => { h += '<div class="cmrow"><span>' + esc(x.n) + (x.por.length ? '<small>Players: ' + esc(x.por.map((p) => p.name || 'Player').join(', ')) + '</small>' : '') + '</span><button class="ctiny" data-a="cdel" data-i="' + i + '">Remove</button></div>'; });
      h += '<label class="clab">Team or player<input id="cadd" class="cin" maxlength="40" placeholder="Team name"></label><label class="clab">Its players in the group (optional, names with commas)<input id="caddp" class="cin" maxlength="120" placeholder="Pat Lee, Sam Cruz"></label><div class="cnote">Only a lot\'s own players can buy back half of it. You can link them to members later.</div><button class="csec cfull" data-a="cadd">Add</button>';
    } else if (ev) {
      h += '<div class="cline"><span>Bundle long shots<small>Teams marked Field are sold as one lot ("the field")</small></span>' + sw(d.bundle, 'data-a="bundle"') + '</div>';
      if (ev.needsRef && !hasRef(d, ev)) h += '<div class="cwarn"><b>Start from the event</b>Open the ' + (ev.needsRef === 'evtId' ? 'local event or pickleball event whose pairs or teams' : 'golf day whose teams') + ' you want to auction and tap Calcutta there. Its teams and their players come over by themselves.</div>';
      else if (!d.teams.length) h += '<div class="ccard cmut">Loading teams…</div>';
      else {
        const nLot = Object.values(d.pick).filter((v) => v === 'lot').length, nF = d.bundle ? Object.values(d.pick).filter((v) => v === 'field').length : 0;
        h += '<div class="cnote"><b>' + (nLot + (nF ? 1 : 0)) + ' lots</b> · ' + nLot + ' teams on their own' + (nF ? ' · ' + nF + ' in the field' : '') + (ev.teams ? ' · this event usually has ' + ev.teams + ' teams' : '') + '</div>';
        h += '<div class="c2"><input id="cq" class="cin" placeholder="Find a team" value="' + esc(d.q) + '"><button class="csec" data-a="allteams">' + (nLot === d.teams.length ? 'Clear all' : 'Pick all') + '</button></div>';
        const q = d.q.toLowerCase(), list = d.teams.filter((t) => !q || t.name.toLowerCase().includes(q) || (t.abbr || '').toLowerCase().includes(q));
        list.slice(0, 120).forEach((t) => { const v = d.pick[t.id] || 'out'; h += '<div class="cteam"><span>' + esc(t.name) + '</span>' + seg([['out', 'Out'], ['lot', 'Own lot']].concat(d.bundle ? [['field', 'Field']] : []), v, 'data-pick-' + d.teams.indexOf(t)) + '</div>'; });
        if (list.length > 120) h += '<div class="cnote">Showing 120. Type to find more.</div>';
        h += '<div class="cnote">Put every team in the event up for auction (on its own or in the field). A team left Out belongs to nobody; games against it still count for the team that plays it.</div>';
      }
    }
    h += '</div>';
    return h + '<button class="cpri cfull" data-a="next">Next: rules and payouts</button>';
  }
  function lotsOut() {
    const d = DR, ev = evOf(d.ev); if (ev && ev.manualOnly) return d.custom.map((x) => ({ teams: [{ name: x.n }], playersOfRecord: x.por.map((p) => (p.pid ? { pid: p.pid } : p.guest ? { guest: p.guest } : { name: p.name })) }));
    const own = d.teams.filter((t) => d.pick[t.id] === 'lot'), fld = d.bundle ? d.teams.filter((t) => d.pick[t.id] === 'field') : [];
    return own.map((t) => ({ teams: [{ id: t.id, name: t.name, abbr: t.abbr }] })).concat(fld.length ? [{ name: 'The field', teams: fld.map((t) => ({ id: t.id, name: t.name, abbr: t.abbr })) }] : []);
  }
  function create2() {
    const d = DR, ev = evOf(d.ev) || { kinds: [], rounds: [] };
    let h = '<div class="crow"><h1>Calcutta rules</h1><span class="cmut">Step 2 of 2</span></div>';
    h += '<div class="ccard"><h2>How the auction runs</h2>' + seg([['live', 'Live in the app'], ['manual', 'Enter results']], d.mode, 'data-mode');
    h += '<div class="cnote">Live: one lot at a time, the timer resets on every bid. Enter results: you held the auction at the bar, type who bought what.</div>';
    h += '<div class="c2"><label class="clab">Lowest bid' + sel('cmin', (EV.minBids || [5]).map((n) => [n, '$' + n]), d.minBid) + '</label><label class="clab">Raise by at least' + sel('cinc', (EV.incs || [5]).map((n) => [n, '$' + n]), d.inc) + '</label></div>';
    if (d.mode === 'live') h += '<div class="c2"><label class="clab">Bid timer' + sel('ctimer', (EV.timers || [25]).map((n) => [n, n + ' seconds']), d.timer) + '</label><label class="clab">Order' + sel('corder', [['listed', 'As listed'], ['random', 'Random draw']], d.order) + '</label></div>';
    h += ev.local ? '<div class="cline"><span>Buy back half<small>The players on a lot can buy back half of it for half the winning price. Cost and winnings split 50/50.</small></span>' + sw(d.buyBack, 'data-a="bb"') + '</div></div>' : '</div>';
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
    h += '<label class="clab">If an unsold lot wins' + sel('cuns', (EV.unsold || [{ key: 'roll', label: 'Added to the sold lots\' payouts, shared by what each earned' }, { key: 'carry', label: 'Carried to the next Calcutta' }]).map((x) => [x.key, x.label]), d.unsold || 'roll') + '</label><div class="cnote">' + esc(((EV.unsold || []).find((x) => x.key === (d.unsold || 'roll')) || {}).text || '') + ' Members see this rule before the auction.</div>';
    h += '<div class="cnote">The commissioner\'s take comes off the whole pot first. These percentages split the Calcutta share. ' + MONEYLINE + '</div></div>';
    h += '<div class="cwarn"><b>Rules lock when the auction starts</b>Payout table, take and team list can\'t change after the first bid.</div><div class="cnote">' + esc(CAPLINE(EV.max)) + '</div>';
    return h + '<button class="cpri cfull" data-a="submit">' + (d.id ? 'Save' : 'Create Calcutta') + '</button>';
  }
  function readDraft() {
    const v = (id) => { const e = document.getElementById(id); return e ? e.value : null; }, d = DR; if (!d) return;
    if (v('cname') !== null) d.name = v('cname'); if (v('cq') !== null) d.q = v('cq');
    if (v('cmin') !== null) d.minBid = +v('cmin'); if (v('cinc') !== null) d.inc = +v('cinc'); if (v('ctimer') !== null) d.timer = +v('ctimer'); if (v('corder') !== null) d.order = v('corder'); if (v('cuns') !== null) d.unsold = v('cuns');
    d.rows.forEach((x, i) => { if (v('rk' + i) !== null) { const k = v('rk' + i); if (k !== x.k) { x.k = k; x.label = ''; if (k === 'champ' || k === 'big') x.n = 1; } } if (v('rr' + i) !== null) x.r = +v('rr' + i); if (v('rn' + i) !== null) x.n = +v('rn' + i); if (v('rp' + i) !== null) x.pct = v('rp' + i); });
    if (v('ctv') !== null) d.takeV = v('ctv');
    if (v('ctake') !== null) { const t = v('ctake'); if (t === 'none') d.takeKind = 'none'; else if (t === 'flat') { if (d.takeKind !== 'flat') d.takeV = ''; d.takeKind = 'flat'; } else if (t === 'pc') { if (d.takeKind !== 'pct' || [5, 10, 15, 20, 25].includes(Number(d.takeV))) d.takeV = ''; d.takeKind = 'pct'; } else { d.takeKind = 'pct'; d.takeV = +t.slice(1); } }
  }
  function payload() { const d = DR; return { id: d.id, name: d.name.trim(), ev: d.ev, golf: d.golf || undefined, evtId: d.evtId || undefined, lots: lotsOut(), rows: d.rows.map((x) => ({ k: x.k, r: x.r || undefined, n: Number(x.n), pct: Number(x.pct), label: x.label || undefined })), minBid: d.minBid, inc: d.inc, timer: d.timer, unsold: d.unsold || 'roll', buyBack: !!(evOf(d.ev) || {}).local && d.buyBack, main: d.main, take: { kind: d.takeKind, v: d.takeKind === 'none' ? 0 : Number(d.takeV) }, order: d.order, mode: d.mode }; }
  async function pickEv(k) { const d = DR, ev = evOf(k); d.ev = k; d.teams = []; d.pick = {}; d.rows = ev ? ev.rows.map((x) => Object.assign({}, x)) : []; paint(); if (!ev || !ev.on || ev.manualOnly) return;
    if (ev.needsRef && !hasRef(d, ev)) return; // a golf day's / local event's Calcutta is started from that screen (it sends which one)
    try { const j = await post('teams', { ev: k, golf: d.golf || undefined, evtId: d.evtId || undefined }); if (ev.needsRef && DR === d && d.ev === k) j.teams.forEach((t) => { d.pick[t.id] = 'lot'; }); /* a golf day's / local event's teams: all in by default */ if (DR !== d || d.ev !== k) return; d.teams = j.teams; if (k === 'nfl_season') d.teams.forEach((t) => { d.pick[t.id] = 'lot'; }); } catch (e) { err = errText(e); } paint(); }

  // ---------- auction (live) ----------
  const left = (c) => (c.a.paused ? (c.a.left != null ? c.a.left : null) : c.a.endsAt ? Math.max(0, c.a.endsAt - (Date.now() + OFF)) : null);
  const clock = (ms) => { if (ms == null) return '–'; const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function auctionV() {
    const s = cur(), c = s.c; if (!c) return '<div class="ccard">Loading the auction…</div>';
    const comm = c.role === 'comm', a = c.a, lot = a.cur && c.lots.find((l) => l.id === a.cur), nSold = c.sold.length, down = FAILS >= 2;
    let h = '<div class="crow"><h1>' + (a.status === 'setup' ? 'Auction' : a.status === 'closed' ? 'Auction closed' : 'Live auction') + '</h1>' + (comm ? '<span class="cbadge">Commissioner</span>' : '') + '</div>';
    h += '<div class="cmeta">' + esc(c.name) + ' · ' + esc(c.evLabel) + '</div>' + lockCard(c);
    // v279 (B3): the Reconnecting line (M2) and the error / note line sit UNDER the bid row (inside the block card, under the status line; under the
    // block card when no lot is up), never above it, so neither moves the bid buttons, the typed Bid or the status line when it comes or goes
    const slot = '<div class="cmsg cmsgin"' + (s.msgH ? ' style="min-height:' + s.msgH + 'px"' : '') + '>' + (down ? '<div class="cwarn cdown" role="status"><b>Reconnecting…</b>No answer from the server for a few seconds. What you see may be out of date, so bids are off until it answers.</div>' : '') + (err ? '<div class="cerr" role="alert">' + esc(err) + '</div>' : '') + (note ? '<div class="cok" role="status">' + esc(note) + '</div>' : '') + '</div>'; let slotIn = false;
    let m = ''; // M5: the block card comes first, notices under it; M4: tiles and the sold list go beside it on a wide screen
    if (a.status === 'setup') {
      m += '<div class="ccard cblock"><div class="cmut">Not started</div><div class="cbig">' + c.lots.length + ' lots</div><div class="cnote">' + (comm ? 'Start when everyone is in. The first lot opens; its timer starts at the first bid.' : 'Waiting for the commissioner to start.') + '</div>' + (comm && !c.started && !c.feedLock ? '<button class="cpri cfull" data-a="ctl" data-op="start">Start the auction</button>' : '') + '</div>';
    } else if (a.status === 'live') {
      if (lot) {
        const hb = a.high, l0 = left(c), frac = l0 == null ? 1 : Math.max(0, Math.min(1, l0 / (a.timer * 1000))), mine = hb && hb.pid === c.me;
        m += '<div class="ccard cblock"><div class="crow"><span class="cmut">Now on the block' + (lot.field ? ' · the field' : '') + '</span><b class="ctimer' + (l0 != null && l0 < 5000 ? ' cneg' : ' cgold') + '" id="ctime">' + (a.paused ? 'Paused' : hb ? clock(l0) : 'Open') + '</b></div>';
        m += '<div class="cbig">' + esc(lot.name) + '</div>' + (lot.field ? '<div class="cnote">' + esc(lot.teams.map((t) => t.name).join(', ')) + '</div>' : '');
        m += '<div class="cbar"><i id="cbar" style="width:' + (hb ? Math.round(frac * 100) : 100) + '%"></i></div>';
        m += '<div class="crow"><span class="cmut">' + (hb ? 'High bid · ' + esc(hb.name) + (mine ? ' (you)' : '') : 'No bids yet · opens at ' + usd(c.rules.minBid)) + '</span><b class="chigh">' + (hb ? usd(hb.amt) : '–') + '</b></div>';
        if (c.started || c.feedLock) m += ''; /* the lock line above says why there are no bid buttons */
        else if (!a.paused && c.role !== 'none') {
          const base = hb ? hb.amt : 0, q = hb ? [c.rules.inc, c.rules.inc * 2, c.rules.inc * 5] : [c.rules.minBid, c.rules.minBid + c.rules.inc, c.rules.minBid + c.rules.inc * 4], off = mine || down;
          m += '<div class="c3 cq">' + q.map((x) => '<button class="cpri" data-a="bid" data-lot="' + att(a.cur) + '" data-amt="' + (base + x) + '" aria-label="Bid ' + usd(base + x) + '"' + (off ? ' disabled' : '') + '><span>' + usd(base + x) + '</span>' + (hb ? '<small>+' + usd(x) + '</small>' : '') + '</button>').join('') + '</div>'; // L7: the total, the step small
          m += '<div class="cbidrow"><input id="camt" class="cin" type="number" inputmode="numeric" min="' + a.minNext + '" step="1" placeholder="' + usd(a.minNext) + ' or more" value="' + esc(s.amt || '') + '" aria-label="Your bid in dollars"' + (down ? ' disabled' : '') + '><button class="cgo" data-a="bidin" data-lot="' + att(a.cur) + '"' + (off ? ' disabled' : '') + '>Bid</button></div>';
        } else if (a.paused) m += '<div class="cwarn"><b>Paused</b>Bids wait until the commissioner resumes.</div>';
        m += bidStatus(s, c); m += slot; slotIn = true;
        if (a.bids.length > 1) m += '<div class="cnote">' + a.bids.slice(1, 4).map((b) => esc(b.name) + ' ' + usd(b.amt)).join(' · ') + '</div>';
        m += '</div>';
      } else {
        const just = c.sold[0], won = !!(just && just.holder.pid && just.holder.pid === c.me);
        m += '<div class="ccard cblock' + (won ? ' cwonc' : '') + '"><div class="cmut">Sold</div>' + (just ? '<div class="cbig">' + esc(just.name) + '</div>' + (won ? '<div class="cwon">You won it</div>' : '') + '<div class="crow"><span class="cmut">' + (won ? 'You' : esc(just.holder.name)) + '</span><b class="chigh">' + usd(just.amt) + '</b></div>' : '') + '<div class="cnote" id="cnext">' + (a.paused ? 'Paused.' : 'Next lot opens in a few seconds.') + '</div></div>'; // L4
      }
    } else m += '<div class="ccard cblock"><div class="cbig">All done</div><div class="cnote">' + nSold + ' of ' + c.lots.length + ' lots sold for ' + usd(c.potSoFar) + '.</div><button class="cpri cfull" data-a="board">See owners and payouts ›</button></div>';
    if (!slotIn) m += slot;
    m += notices(c);
    if (a.status === 'live' && comm && !c.started) {
      const nxt = a.order.filter((id) => id !== a.cur && !c.sold.find((x) => x.lot === id)).slice(0, 2).map((id) => (c.lots.find((l) => l.id === id) || {}).name), u = a.undo;
      m += '<div class="ccard"><h2>Commissioner controls</h2><div class="c2"><button class="csec" data-a="ctl" data-op="' + (a.paused ? 'resume' : 'pause') + '">' + (a.paused ? 'Resume' : 'Pause') + '</button><button class="csec" data-a="ctl" data-op="undo"' + (u ? '>' + (u.k === 'sale' ? 'Undo sale of ' + esc(u.name) : 'Undo last bid') : ' disabled>Undo') + '</button>';
      m += '<button class="cgreen" data-a="ctl" data-op="sold"' + (lot && a.high ? '' : ' disabled') + '>Sold now</button><button class="csec" data-a="ctl" data-op="next"' + (lot && a.high ? ' disabled' : '') + '>Next lot ›</button></div>';
      m += '<div class="cnote">' + (nxt.length ? 'Up next: ' + esc(nxt.join(', then ')) + '.' : 'This is the last lot.') + '</div><div class="c2"><button class="csec" data-a="order">Change the order</button><button class="cdanger" data-a="ctl" data-op="end">End auction</button></div></div>';
    }
    let x = '<div class="c2">' + tile('Sold', nSold + ' of ' + c.lots.length, '', 'data-a="board" data-tab="teams"') + tile('Pot so far', usd(c.potSoFar), 'cgold', 'data-a="pot"') + '</div>';
    x += '<h3 class="ch">Recently sold</h3>';
    if (!c.sold.length) x += '<div class="ccard cmut">Nothing sold yet.</div>';
    else x += '<div class="ccard clist">' + c.sold.slice(0, 8).map((y) => '<button class="cmrow cbtn" data-a="lot" data-lot="' + att(y.lot) + '"><span>' + esc(y.name) + '<small>' + esc(y.holder.name) + (y.holder.pid && y.holder.pid === c.me ? ' · you' : '') + (y.bb ? ' · half bought back by ' + esc(y.bb.name) : '') + '</small></span><b class="cr">' + usd(y.amt) + '</b></button>').join('') + '</div>';
    if (c.sold.length > 8) x += '<button class="clink" data-a="board" data-tab="teams">All ' + c.sold.length + ' sold lots ›</button>';
    x += '<div class="c2"><button class="csec" data-a="board">Owners and payouts</button><button class="csec" data-a="members">Members</button></div>';
    return h + '<div class="csplit"><div class="cmainc">' + m + '</div><div class="caside">' + x + '</div></div>';
  }
  // M1: my bid's standing, worked out again from every state the server sends (never a stale "Bid in"): high, outbid, or removed by the commissioner.
  // It belongs to one lot: a new lot on the block clears it.
  function bidStatus(s, c) {
    const a = c.a, hb = a.high; if (s.my && s.my.lot !== a.cur) s.my = null; const my = s.my;
    if (hb && hb.pid === c.me) return '<div class="cnote cpos cst" role="status">You have the high bid' + (my && my.amt === hb.amt ? ': your ' + usd(hb.amt) + ' bid is in.' : '.') + '</div>';
    if (!my) return '';
    if ((c.notices || []).some((n) => n.k === 'undo' && n.pid === c.me && n.lot === a.cur && n.amt === my.amt)) return '<div class="cnote cyel cst" role="status">The commissioner removed your ' + usd(my.amt) + ' bid.</div>';
    return hb ? '<div class="cnote cneg cst" role="status">Outbid: ' + esc(hb.name) + ' bid ' + usd(hb.amt) + '.</div>' : '';
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
    const fin = !!c.started, shut = fin || !!c.feedLock;
    let h = '<h1>' + (fin ? 'Who bought what' : 'Enter results') + '</h1><div class="cmeta">' + esc(c.name) + (fin ? ' · final' : ' · type who bought each lot and for how much') + '</div>' + notices(c) + lockCard(c);
    h += '<div class="c2">' + tile('Entered', c.sold.length + ' of ' + c.lots.length, '', 'data-a="board" data-tab="teams"') + tile('Pot', usd(c.potSoFar), 'cgold', 'data-a="pot"') + '</div>';
    const target = shut ? null : s.edit || (c.lots.find((l) => !c.sold.find((q) => q.lot === l.id)) || {}).id; // one form at a time; none once the event has started
    c.lots.forEach((l) => {
      const x = c.sold.find((q) => q.lot === l.id), open = target === l.id;
      h += '<div class="ccard' + (open ? ' clive' : '') + '"><div class="crow"><b>' + esc(l.name) + '</b>' + (x && !open ? '<b class="cr">' + usd(x.amt) + '</b>' : '') + '</div>' + (l.field ? '<div class="cnote">' + esc(l.teams.map((t) => t.name).join(', ')) + '</div>' : '');
      if (open) h += whoForm('e', c, x ? (x.holder.pid || '_') : '', x && !x.holder.pid ? x.holder.name : '') + '<div class="c2"><input id="eamt" class="cin" type="number" inputmode="numeric" min="' + c.rules.minBid + '" step="1" placeholder="Amount ($)" value="' + esc(x ? x.amt : '') + '" aria-label="Amount in dollars"><button class="cpri" data-a="enter" data-lot="' + att(l.id) + '">Save</button></div>';
      else if (x) h += '<div class="cmeta">' + esc(x.holder.name) + (x.bb ? ' · half bought back by ' + esc(x.bb.name) : '') + '</div>' + (shut ? '' : '<div class="c2"><button class="csec" data-a="edit1" data-lot="' + att(l.id) + '">Change</button><button class="cdanger" data-a="unenter" data-lot="' + att(l.id) + '">Remove</button></div>' + (c.rules.buyBack && c.local && (l.por || []).length && !x.bb ? '<button class="clink" data-a="lot" data-lot="' + att(l.id) + '">Buy back half ›</button>' : ''));
      else h += shut ? '<div class="cmeta">' + (fin ? 'Unsold' : 'Not entered yet') + '</div>' : '<button class="clink" data-a="edit1" data-lot="' + att(l.id) + '">Not entered yet · Enter ›</button>';
      h += '</div>';
    });
    if (c.a.status !== 'closed' && c.sold.length && !shut) h += '<button class="csec cfull" data-a="closeres">Done entering</button>';
    if (shut) h += '<button class="cpri cfull" data-a="board">See owners and payouts ›</button>';
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
    let h = '<div class="crow"><h1>' + esc(c.name) + '</h1>' + badge(c) + '</div><div class="cmeta">' + esc(c.evLabel) + ' · ' + b.owners.length + (b.owners.length === 1 ? ' owner · ' : ' owners · ') + esc(statusText(c.a.status)) + (b.over ? ' · final' : '') + '</div>';
    h += notices(c) + lockCard(c) + ((b.waiting || []).length && !b.over ? '<div class="cwarn" role="status"><b>Not final yet</b>Waiting on the ' + waitText(b) + '. A postponed or moved game holds the payouts open until it is final (until Thursday 12 AM CT at the latest).</div>' : '') + '<div class="csplit cbsplit"><div class="caside">'; // M4: Pot / Paid beside the table on a wide screen, above it on a phone
    h += '<div class="c2">' + tile('Pot', usd(b.pot), 'cgold', 'data-a="pot"', 'Auction ' + usd(b.pot) + (b.take ? ' · take ' + usd(b.take) : '')) + tile('Paid out so far', usd(b.paidOut), 'cpos', 'data-tab="payouts"', usd(b.inPlay) + ' still in play' + (b.carry ? ' · ' + usd(b.carry) + ' carried' : b.unclaimed ? ' · ' + usd(b.unclaimed) + ' pending roll' : '')) + '</div>';
    h += '</div><div class="cmainc"><div class="cseg c3s">' + [['owners', 'Owners'], ['teams', 'Teams'], ['payouts', 'Payouts']].map(([k, l]) => '<button class="' + (tab === k ? 'on' : '') + '" data-tab="' + k + '">' + l + '</button>').join('') + '</div>';
    if (tab === 'owners') {
      h += '<div class="cthead"><span>Owner · teams alive</span><span class="cr">Spent</span><span class="cr">Won</span></div>';
      if (!b.owners.length) h += '<div class="ccard cmut">No lots sold yet.</div>';
      b.owners.forEach((o) => { h += '<button class="ctrow' + (o.me ? ' me' : '') + (o.net > 0 ? ' hit' : !o.alive && o.net < 0 ? ' miss' : '') + '" data-a="owner" data-k="' + att(o.oid || o.pid || 'n' + o.name) + '"><span class="cpn"><b>' + esc(o.name) + (o.me ? ' · you' : '') + '</b><small class="' + (o.alive ? 'cpos' : 'cneg') + '">' + (o.alive ? o.alive + ' alive' + (o.out ? ' · ' + o.out + ' out' : '') : 'All teams out') + '</small>' + (o.pendingRoll ? '<small class="cyel">+ ' + usd(o.pendingRoll) + ' pending roll</small>' : '') + '</span><span class="cr">' + usd(o.spent) + '</span><span class="cr cv ' + (o.won > 0 ? 'cpos' : '') + '">' + usd(o.won) + '</span></button>'; });
      h += '<div class="cnote">Payouts update from final scores. Tap an owner to see their teams, what each cost and what each has earned.</div>';
    } else if (tab === 'teams') {
      h += '<div class="cthead c3h"><span>Lot · owner</span><span class="cr">Cost</span><span class="cr">Earned</span></div>';
      b.lots.forEach((l) => { const st = l.teams.map((t) => t.r ? (t.r.champ ? '🏆 champion' : t.r.pos ? placeTxt(t.r) : t.r.out ? 'out' : t.r.wins ? t.r.wins + ' win' + (t.r.wins === 1 ? '' : 's') : 'alive') : '').filter(Boolean);
        h += '<button class="ctrow c3h' + (l.earned > 0 ? ' hit' : !l.alive && l.sold ? ' miss' : '') + '" data-a="lot" data-lot="' + att(l.id) + '"><span class="cpn"><b>' + esc(l.name) + '</b><small>' + (l.holder ? esc(l.holder.name) + (l.bb ? ' + ' + esc(l.bb.name) + ' (half)' : '') : 'Unsold') + (st.length && !l.field ? ' · ' + esc(st[0]) : l.field ? ' · ' + (l.alive ? 'alive' : 'out') : '') + '</small></span><span class="cr">' + (l.sold ? usd(l.sold.amt) : '–') + '</span><span class="cr cv ' + (l.earned > 0 ? 'cpos' : '') + '">' + usd(l.earned) + '</span></button>'; });
      if (c.role === 'comm') h += '<div class="cnote">' + (c.feedBacked ? 'Results come from the score feed only. If the feed still has no result 24 hours after a game\'s scheduled end, tap the lot to enter a correction.' : 'Tap a lot to enter a result by hand. Every result or change is sent to all members.') + '</div>';
    } else {
      h += '<div class="cthead c3h"><span>Pays for</span><span class="cr">Each</span><span class="cr">Paid</span></div>';
      b.rows.forEach((r) => { h += '<div class="ctrow c3h"><span class="cpn"><b>' + esc(r.label) + '</b><small>' + pct(r.pct) + (r.n > 1 ? ' each · ' + r.hits + ' of ' + r.n + ' paid' : r.hits ? ' · paid' : ' · not yet') + (r.tie ? ' · <span class="cyel">tie: ' + r.hits + ' teams split the places they share</span>' : '') + (r.over ? ' · <span class="cyel">more results than the table pays; extras get $0</span>' : '') + (r.unused ? ' · <span class="cyel">' + r.unused + ' unused</span>' : '') + '</small></span><span class="cr">' + usd(r.each) + '</span><span class="cr cv">' + usd(r.paid) + '</span></div>'; });
      h += unsoldNote(b);
    }
    h += '</div><div class="ctail">';
    h += '<button class="clink" data-a="audit">History · ' + (d.audit || []).length + ' entries ›</button>';
    if (c.role === 'comm' && c.rules.mode === 'manual' && !c.started) h += '<button class="csec cfull" data-a="enterv">' + (c.a.status === 'closed' ? 'Change who bought what' : 'Enter results') + '</button>';
    if (c.rules.mode === 'live' && c.a.status !== 'closed') h += '<button class="csec cfull" data-a="auction">Back to the auction</button>';
    h += '<div class="cnote">' + (d.feedAt ? 'Scores checked ' + esc(fmtTime(d.feedAt)) + '. ' : '') + MONEYLINE + '</div>';
    return h + '</div></div>';
  }
  // Playbook play 10: the unsold-lot rule the commissioner picked at set-up, with the dollars it moved
  // ROUND 4 #4: the roll is paid when the event is over (never moves an owner's winnings down mid-event); the carry says where it goes
  const placeTxt = (r) => (r.tie ? 'tied ' : '') + ord(r.pos || r.place);
  const unsoldNote = (b) => { const un = b.unused && b.unused.slots ? b.unused : null, from = un && un.amt ? (un.unsoldLots ? 'won by unsold lots and left in payout places nobody filled' : 'left in payout places nobody filled') : 'won by unsold lots';
    return (un ? '<div class="cnote cyel">' + un.slots + ' payout place' + (un.slots === 1 ? '' : 's') + ' went unused (a bye, a tie or a game no lot played in): ' + usd(un.amt) + ' that ' + (b.carry ? 'carries over with the unsold money.' : 'goes to the sold lots with the unsold money.') + '</div>' : '') // F1 / F2: shown once the event is over
      + (b.rolled ? '<div class="cnote cyel">' + usd(b.rolled) + ' ' + from + ' was added to the sold lots\' payouts, ' + (b.rollBy === 'price' ? 'in proportion to the price paid (no sold lot had earned anything)' : 'shared by what each earned') + ' (rule set before the auction).</div>' : '') + (b.carry ? '<div class="cnote cyel">' + usd(b.carry) + ' ' + from + ' carries to ' + esc(b.carryTo || 'the next Calcutta') + ' (rule set before the auction).</div>' : b.unclaimed ? '<div class="cnote cyel">' + usd(b.unclaimed) + ' won by unsold lots is <b>pending roll</b>: it is paid into the sold lots\' payouts when the event is over' + (b.pendingRoll ? ' (each owner\'s share so far is shown as pending roll; it is not in Won yet)' : '') + '.</div>' : ''); };
  function potV() {
    const s = cur(), d = s.d; if (!d) return '<div class="ccard">Loading…</div>'; const b = d.board, c = d.calc;
    let h = '<h1>Pot</h1><div class="ccard"><div class="ckv"><span>Winning bids (' + d.calc.lots.filter((l) => b.lots.find((x) => x.id === l.id && x.sold)).length + ' lots)</span><b>' + usd(b.pot) + '</b></div>';
    h += '<div class="ckv"><span>Commissioner\'s take<small>' + esc(c.takeText) + '</small></span><b>' + (b.take ? '-' + usd(b.take) : '$0') + '</b></div><div class="ckv ctot"><span>Calcutta pool</span><b class="cgold">' + usd(b.pool) + '</b></div>';
    h += '<div class="ckv"><span>Paid out so far</span><b class="cpos">' + usd(b.paidOut) + '</b></div><div class="ckv"><span>Still in play</span><b>' + usd(b.inPlay) + '</b></div>' + (b.carry ? '<div class="ckv"><span>Carried<small>won by unsold lots; goes to ' + esc(b.carryTo || 'the next Calcutta') + '</small></span><b>' + usd(b.carry) + '</b></div>' : b.unclaimed ? '<div class="ckv"><span>Pending roll<small>won by unsold lots; paid to the sold lots when the event is over</small></span><b>' + usd(b.unclaimed) + '</b></div>' : '') + '<div class="cnote">Pool = paid out + still in play' + (b.carry ? ' + carried' : b.unclaimed ? ' + pending roll' : '') + '.</div></div>' + unsoldNote(b);
    h += '<div class="ccard"><h2>How the pool pays</h2><div class="cthead c3h"><span>Pays for</span><span class="cr">Each</span><span class="cr">Total</span></div>';
    b.rows.forEach((r) => { h += '<div class="ckv3"><span>' + esc(r.label) + '<small>' + pct(r.pct) + (r.n > 1 ? ' x ' + r.n : '') + '</small></span><b>' + usd(r.each) + '</b><b>' + usd(r.total) + '</b></div>'; });
    h += '</div><div class="cnote">' + (b.main ? 'Main Calcutta: these bids join the group pot.' : 'Side Calcutta: its own pot, paid separately.') + ' Rounded to the cent; any extra cent goes to the bigger payout so the payouts add up exactly to the pool. ' + MONEYLINE + '</div>';
    return h;
  }
  function ownerV() {
    const s = cur(), d = s.d; if (!d) return ''; const o = d.board.owners.find((x) => (x.oid || x.pid || 'n' + x.name).replace(/[^\w.-]/g, '') === s.k); if (!o) return '<div class="ccard cmut">Owner not found.</div>';
    let h = '<h1>' + esc(o.name) + (o.me ? ' · you' : '') + '</h1><div class="cmeta">' + ord(o.place) + ' by winnings · ' + o.lots.length + ' lot' + (o.lots.length === 1 ? '' : 's') + '</div>';
    h += '<div class="c3">' + tile('Spent', usd(o.spent)) + tile('Won', usd(o.won), o.won > 0 ? 'cpos' : '') + tile('Net', usd(o.net, true), o.net > 0 ? 'cpos' : o.net < 0 ? 'cneg' : '') + '</div>';
    if (o.pendingRoll) h += '<div class="cnote cyel">+ ' + usd(o.pendingRoll) + ' pending roll: this owner\'s share so far of what unsold lots won. It is paid when the event is over and is not in Won yet.</div>';
    h += '<div class="cthead c3h"><span>Lot</span><span class="cr">Cost</span><span class="cr">Earned</span></div>';
    o.lots.forEach((l) => { h += '<button class="ctrow c3h' + (l.earned > 0 ? ' hit' : !l.alive ? ' miss' : '') + '" data-a="lot" data-lot="' + att(l.id) + '"><span class="cpn"><b>' + esc(l.name) + '</b><small class="' + (l.alive ? 'cpos' : 'cneg') + '">' + (l.alive ? 'alive' : 'out') + (l.share !== 'all' ? ' · ' + esc(l.share) : '') + '</small></span><span class="cr">' + usd(l.cost) + '</span><span class="cr cv ' + (l.earned > 0 ? 'cpos' : '') + '">' + usd(l.earned) + '</span></button>'; });
    return h + '<div class="cnote">' + MONEYLINE + '</div>';
  }
  function lotV() {
    const s = cur(), d = s.d; if (!d) return '<div class="ccard">Loading…</div>'; const c = d.calc, l = d.board.lots.find((x) => x.id === s.lot); if (!l) return '';
    const comm = c.role === 'comm', ev = { rounds: c.rounds || [] }, byPlace = (c.rules.rows || []).some((x) => x.k === 'place') && !(c.rules.rows || []).some((x) => x.k === 'round');
    let h = '<h1>' + esc(l.name) + '</h1><div class="cmeta">' + (l.holder ? 'Owner: ' + esc(l.holder.name) + (l.bb ? ' · half bought back by ' + esc(l.bb.name) : '') : 'Unsold') + '</div>';
    h += lockCard(c) + '<div class="c3">' + tile('Cost', l.sold ? usd(l.sold.amt) : '–') + tile('Earned', usd(l.earned), l.earned > 0 ? 'cpos' : '') + tile('Status', l.alive ? 'Alive' : 'Out', l.alive ? 'cpos' : 'cneg') + '</div>';
    if (l.rolled) h += '<div class="cnote cyel">Includes ' + usd(l.rolled) + ' rolled in from unsold lots that won.</div>';
    if (l.pendingRoll) h += '<div class="cnote cyel">+ ' + usd(l.pendingRoll) + ' pending roll (its share so far of what unsold lots won; paid when the event is over).</div>';
    if (!l.sold && l.earned) h += '<div class="cnote cyel">Unsold: the ' + usd(l.earned) + ' it won ' + (d.board.unsoldRule === 'carry' ? 'carries to ' + esc(d.board.carryTo || 'the next Calcutta') + '.' : 'rolls into the sold lots\' payouts when the event is over.') + '</div>';
    l.teams.forEach((t) => {
      const r = t.r || { wins: 0, reached: 0, champ: false, out: false };
      h += '<div class="ccard"><div class="crow"><b>' + esc(t.name) + '</b><b class="cr ' + (t.earned > 0 ? 'cpos' : '') + '">' + usd(t.earned) + '</b></div><div class="cmeta">' + r.wins + ' win' + (r.wins === 1 ? '' : 's') + (r.reached && ev.rounds[r.reached - 1] ? ' · reached ' + esc(ev.rounds[r.reached - 1]) : '') + (r.champ ? ' · 🏆 champion' : '') + (r.out ? ' · out' : '') + (r.place ? ' · finished ' + placeTxt(r) : '') + (r.big ? ' · biggest win' : '') + '</div>';
      if (r.manual) h += '<div class="cnote cyel"><b>Entered by commissioner</b>' + (r.corr ? ' (correction of the score feed). Reason: ' + esc(r.reason || '') + '. The score feed replaces it the moment it reports.' : '') + '</div>'; // ROUND 4 B1: a visible tag
      if (comm && c.feedBacked && !t.fix) { if (r.corr) h += '<button class="csec cfull" data-a="rclear" data-team="' + att(t.id) + '">Remove the correction</button>'; } // feed-backed: no hand entry unless a correction is open for this team
      else if (comm) {
        if (s.rconf && s.rconf.team === t.id) { const n = c.unsold || 0; // ROUND 3 #6: the first result starts the event for good: say so first
          h += '<div class="cwarn" role="alertdialog" aria-label="Start the event?"><b>Start the event?</b>Entering a result starts the event. Sales, buy-backs and players lock for good.' + (n ? '<br><br>' + n + ' lot' + (n === 1 ? ' is' : 's are') + ' still ' + (c.rules.mode === 'manual' ? 'not entered' : 'unsold') + '. Saving this result will close the auction with ' + n + ' lot' + (n === 1 ? '' : 's') + ' unsold.' : '') + '</div>';
          h += '<button class="cpri cfull" data-a="rgo">' + (n ? 'Close the auction with ' + n + ' lot' + (n === 1 ? '' : 's') + ' unsold and save' : 'Start the event and save the result') + '</button><button class="csec cfull" data-a="rcancel">Cancel</button>';
        } else if (s.rt === t.id) {
          h += '<div class="c2"><label class="clab">Wins<input id="rw" class="cin" type="number" inputmode="numeric" min="0" max="30" value="' + esc(s.rv && s.rv.w != null ? s.rv.w : r.wins) + '"></label>' + (ev.rounds.length && !byPlace ? '<label class="clab">Furthest round' + sel('rre', [[0, 'Not yet']].concat(ev.rounds.map((n, i) => [i + 1, n])), s.rv && s.rv.re != null ? s.rv.re : r.reached) + '</label>' : '<label class="clab">Place (0 = none)<input id="rpl" class="cin" type="number" inputmode="numeric" min="0" max="200" value="' + esc(s.rv && s.rv.pl != null ? s.rv.pl : r.place || 0) + '"></label>') + '</div>'; // ROUND 3: a table that pays by place (golf day) asks for the place (was: never shown for Custom events)
          h += '<div class="cline"><span>Champion</span>' + sw(s.rc != null ? s.rc : r.champ, 'data-a="rchamp"') + '</div><div class="cline"><span>Out (eliminated)</span>' + sw(s.ro != null ? s.ro : r.out, 'data-a="rout"') + '</div>';
          if (c.feedBacked) h += '<label class="clab">Why are you correcting the score feed? (required; every member sees it)<input id="rrs" class="cin" maxlength="100" placeholder="Example: the feed never posted the final" value="' + esc(s.rrs || '') + '"></label>';
          h += '<div class="c2"><button class="cpri" data-a="rsave" data-team="' + att(t.id) + '">' + (c.feedBacked ? 'Save correction' : 'Save result') + '</button><button class="csec" data-a="rclear" data-team="' + att(t.id) + '"' + (r.manual ? '' : ' disabled') + '>' + (c.feedBacked ? 'Back to the score feed' : 'Clear this result') + '</button></div>';
        } else h += c.feedBacked ? '<div class="cnote">The score feed still has no result for this team\'s game, more than 24 hours after it was due to end.</div><button class="clink" data-a="redit1" data-team="' + att(t.id) + '">Enter a correction ›</button>' : '<button class="clink" data-a="redit1" data-team="' + att(t.id) + '">Enter a result by hand ›</button>';
      }
      h += '</div>';
    });
    if (c.local) { // players of record + buy back half (owner rule Nov 16 2026: only the lot's own player(s), half for half the price)
      const por = l.por || [], mine = por.some((p) => p.me), half = l.sold ? usd(Math.floor(l.sold.amt * 100 / 2) / 100) : '';
      const porOpen = comm && !l.sold && !l.porLocked && !c.started && !c.feedLock && !(c.rules.mode === 'live' && c.a.status !== 'setup'); // ROUND 2 D4 + ROUND 3 #5: locked for good once the lot was ever sold or entered
      h += '<div class="ccard"><h2>Players on this lot</h2>' + (por.length ? '<div class="clist0">' + por.map((p, i) => '<div class="cmrow"><span>' + esc(p.name) + (p.me ? ' <i class="cmut">· you</i>' : '') + (p.pending ? ' <i class="cmut">· has not joined yet</i>' : p.guest ? ' <i class="cmut">· guest</i>' : p.pid ? '' : ' <i class="cmut">· not in the app</i>') + '</span>' + (porOpen ? '<button class="ctiny" data-a="pordel" data-i="' + i + '" data-lot="' + att(l.id) + '">Remove</button>' : '') + '</div>').join('') + '</div>' : '<div class="cnote">None. Nobody can buy back half of this lot.</div>');
      if (porOpen) h += whoForm('p', c, '', '').replace('Buyer', 'Add one of its players').replace('Who bought it?', 'Pick a member or type a name') + '<button class="csec cfull" data-a="poradd" data-lot="' + att(l.id) + '">Add player</button><div class="cnote">Someone not in the group goes in by name. To own the lot in the app, they join the group.</div>';
      if (!porOpen && comm && por.length) h += '<div class="cnote">🔒 Locked: the lot\'s players cannot change once it is sold.</div>';
      h += '</div>';
      if (c.rules.buyBack && l.sold && por.length) {
        h += '<div class="ccard"><h2>Buy back half</h2>';
        const shut = c.started || c.feedLock;
        if (l.bb) h += '<div class="cmeta">' + esc(l.bb.name) + ' bought back half for ' + half + '. Cost and winnings split 50/50 (an odd cent goes to the winning bidder).</div>' + (!shut && (comm || l.bb.pid === c.me) ? '<button class="cdanger cfull" data-a="bbclear" data-lot="' + att(l.id) + '">Remove the buy-back</button>' : '');
        else if (shut) h += '<div class="cnote">🔒 ' + (c.started ? 'The event has started: buy-backs are closed.' : 'Locked for now: the score feed cannot be read.') + '</div>';
        else if (mine) h += '<div class="cnote">This is your lot. Buy back half from ' + esc(l.holder.name) + ' for ' + half + ' (paid outside the app); you then own half of its cost and winnings.</div><button class="cpri cfull" data-a="bbself" data-lot="' + att(l.id) + '">Buy back half for ' + half + '</button>';
        else if (comm) h += '<label class="clab">Which of its players buys back' + sel('bwho', por.map((p, i) => [i, p.name]), s.bwho || 0) + '</label><div class="cnote">Recorded on their behalf. They pay ' + esc(l.holder.name) + ' ' + half + ' outside the app and own half.</div><button class="cpri cfull" data-a="bbsave" data-lot="' + att(l.id) + '">Record the buy-back</button>';
        else h += '<div class="cnote">Only ' + esc(por.map((p) => p.name).join(', ')) + ' can buy back half of this lot.</div>';
        h += '</div>';
      }
    }
    return h + '<div class="cnote">' + (c.feedBacked ? 'Results for this event come from the score feed only. A commissioner correction opens only when the feed still has no result 24 hours after a game\'s scheduled end; it needs a reason, every member is told, and the feed replaces it the moment it reports.' : 'Results are entered by the commissioner. Every result or change is sent to all members and listed in the history.') + '</div>';
  }
  function auditV() { const s = cur(), d = s.d; if (!d) return ''; return '<h1>History</h1><div class="ccard clist">' + ((d.audit || []).map((a) => '<div class="cmrow"><span>' + esc(a.what) + '<small>' + esc(a.by) + ' · ' + esc(fmtTime(a.at)) + '</small></span></div>').join('') || '<div class="cmut">Nothing yet.</div>') + '</div>'; }
  function membersV() {
    const s = cur(), c = s.c; if (!c) return '<div class="ccard">Loading…</div>';
    let h = '<h1>Members</h1><div class="cmeta">' + c.members.length + ' of ' + c.max + ' people</div><div class="ccard">';
    if (c.a.status !== 'closed') h += '<div class="cnote">Members of ' + esc(c.groupName || (GR && GR.name) || 'the group') + ' join from the group\'s Calcutta tile.</div>'; // MAIN: no invite code
    h += '<div class="cnote">' + esc(CAPLINE(c.max)) + '</div></div><div class="ccard clist">' + c.members.map((m) => '<div class="cmrow"><span>' + esc(m.name) + (m.pid === c.me ? ' <i class="cmut">· you</i>' : '') + (m.comm ? ' <i class="cmut">· commissioner</i>' : '') + '</span></div>').join('') + '</div>';
    if (c.role === 'comm' && !c.locked) h += '<button class="csec cfull" data-a="editrules">Edit the rules</button><button class="cdanger cfull" data-a="delete">Delete this Calcutta</button>';
    return h + rulesCard(c);
  }
  // ---------- paint / poll ----------
  const el = () => document.getElementById('ocalc');
  function paintBusy(on) { const e = el(); if (e) e.classList.toggle('cbusy', !!on); }
  const VIEWS = { home, join: joinV, create1, create2, auction: auctionV, order: orderV, enter: enterV, board: boardV, pot: potV, owner: ownerV, lot: lotV, audit: auditV, members: membersV };
  function paint() {
    const e = el(); if (!e) return; const s = cur(), f = document.activeElement, fid = f && e.contains(f) ? f.id : '', fv = fid ? f.value : null, sp = fid && f.selectionStart != null ? [f.selectionStart, f.selectionEnd] : null;
    if (s.t === 'auction') { const i = document.getElementById('camt'); if (i) s.amt = i.value; const lk = (s.c && s.c.a && s.c.a.cur) || ''; if (s.msgLot !== lk) { if (s.hadLot) { LOTAT = Date.now(); if (!(i && document.activeElement === i)) { s.amt = ''; s.amtFor = ''; if (i) i.value = ''; } else if (s.amt && !s.amtFor) s.amtFor = s.msgLot || 'x'; } s.msgLot = lk; s.msgH = 0; } if (s.c) s.hadLot = true; } // v279 (B1): a new lot clears the typed box; one still being typed in is kept but marked as typed for the lot before
    const back = stack.length > 1 ? (stack[stack.length - 2].t === 'home' ? 'Calcuttas' : 'Back') : MINE ? 'Groups' : 'Group'; // MAIN: on the first screen ‹ Group goes back to the group page
    morph(e.querySelector('.cin0'), top(back) + '<div class="cvw cv-' + s.t + (s.t === 'home' ? ' cwide' : '') + '"><div class="cmsg">' + (s.t !== 'auction' && err ? '<div class="cerr" role="alert">' + esc(err) + '</div>' : '') + (s.t !== 'auction' && note ? '<div class="cok" role="status">' + esc(note) + '</div>' : '') + '</div>' + (VIEWS[s.t] ? VIEWS[s.t]() : '') + '</div>');
    // on the auction the message line keeps the tallest height it has had FOR THIS LOT (round 3: no longer for the whole session; a new lot on the
    // block starts from none), so an error or note clearing never moves the bid buttons; it is compact there so the typed Bid row stays on screen
    if (s.t === 'auction') { const m = e.querySelector('.cmsgin'); if (m) { const h = Math.ceil(m.getBoundingClientRect().height); if (h > (s.msgH || 0)) { s.msgH = h; m.style.minHeight = h + 'px'; } } }
    if (fid) { const n = document.getElementById(fid); if (n && n.tagName === 'INPUT') { if (fv != null && n.type !== 'checkbox') n.value = fv; n.focus(); try { if (sp) n.setSelectionRange(sp[0], sp[1]); } catch (x) {} } }
  }
  // L2: a repaint changes the page in place (same buttons, new labels and amounts) instead of rebuilding it, so a tap that lands during a poll's
  // repaint stays on the button it started on. Elements are matched by position, tag and id; a typed value in the box that has focus is kept.
  function morph(dst, html) { const t = document.createElement('template'); t.innerHTML = html; syncKids(dst, t.content); }
  function syncKids(a, b) {
    const nb = Array.from(b.childNodes);
    nb.forEach((y, i) => { const x = a.childNodes[i];
      if (!x) { a.appendChild(y); return; }
      if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || (x.nodeType === 1 && (x.id || '') !== (y.id || ''))) { a.replaceChild(y, x); return; }
      if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return; }
      for (const at of Array.from(x.attributes)) if (!y.hasAttribute(at.name) && !(at.name === 'open' && x.nodeName === 'DETAILS')) x.removeAttribute(at.name);
      for (const at of Array.from(y.attributes)) if (x.getAttribute(at.name) !== at.value && !(at.name === 'open' && x.nodeName === 'DETAILS')) x.setAttribute(at.name, at.value);
      syncKids(x, y);
      if (x !== document.activeElement) { if (x.nodeName === 'INPUT' && x.type !== 'checkbox' && x.type !== 'radio') x.value = y.getAttribute('value') || ''; else if (x.nodeName === 'SELECT') { const o = Array.from(x.options).findIndex((q) => q.hasAttribute('selected')); x.selectedIndex = o < 0 ? 0 : o; } }
    });
    while (a.childNodes.length > nb.length) a.removeChild(a.lastChild);
  }
  function push(o) { readDraft(); err = ''; note = ''; stack.push(o); paint(); const e = el(); if (e) e.scrollTop = 0; sched(); }
  async function loadHome() {
    const mine = async (only) => { const j = await post('mine', {}); return Object.assign({}, j, { comm: false, calcs: (j.calcs || []).filter((c) => !only || (c.group && String(c.group.groupId) === only)) }); };
    if (MINE || !GR) { try { H = await mine(null); } catch (e) { err = errText(e); if (!H) H = { calcs: [], max: 8, comm: false }; } if (cur().t === 'home') paint(); return; }
    try { H = await post('list', { g: GR.id }); } catch (e) {
      // F8: the group is gone (deleted, or I left it): its Calcuttas stay reachable from mine, never stranded
      if (e && !e.off && !e.expired && (e.status === 404 || (e.status === 403 && e.j && e.j.code === 'group'))) { try { H = Object.assign(await mine(GR.id), { orphan: true, group: GR.name }); err = ''; } catch (e2) { err = errText(e2); } } else err = errText(e);
      if (!H) H = { calcs: [], max: 8, comm: false }; }
    if (cur().t === 'home') paint(); }
  async function loadCalc(o) { try { const j = await post('get', { id: o.id }); setCalc(j.calc); o.c = j.calc; } catch (e) { err = errText(e); } paint(); }
  async function loadBoard(o) { try { const j = await post('board', { id: o.id }); o.d = j; setCalc(j.calc); err = ''; } catch (e) { err = errText(e); } paint(); }
  function sched() { // poll: 1.5 s on the live auction, 30 s on boards; nothing while the page is hidden or the overlay is closed
    clearTimeout(POLL); const s = cur(); if (!el()) return;
    // M2: the poll keeps running while a bid is in flight (an answer older than what is on screen is dropped by rev); two failed polls in a row show
    // the Reconnecting bar and turn the bid buttons off until one answers
    if (s.t === 'auction' && s.c && s.c.a.status !== 'closed') POLL = setTimeout(async () => { if (!document.hidden && el() && cur() === s) { try { const j = await post('state', { id: s.id, rev: s.c.rev }); const was = FAILS; FAILS = 0; if (!j.same && cur() === s) { if (newer(s.c, j.calc)) { setCalc(j.calc); s.c = j.calc; } paint(); } else if (j.same) { OFF = j.now - Date.now(); if (j.started != null && (!!s.c.started !== !!j.started || !!s.c.feedLock !== !!j.feedLock)) { s.c.started = !!j.started; s.c.feedLock = !!j.feedLock; paint(); } else if (was >= 2 && cur() === s) paint(); } } catch (e) { if (!e || !e.status || e.status >= 500) { FAILS++; if (FAILS === 2 && cur() === s) paint(); } } } sched(); }, 1500);
    else if (['board', 'owner', 'lot', 'pot'].includes(s.t) && s.d) POLL = setTimeout(async () => { if (!document.hidden && el() && cur() === s && !busy && s.t !== 'lot') await loadBoard(s); sched(); }, 30000);
  }
  function tickClock() { // countdown between polls (server end time + clock offset)
    const s = cur(), t = document.getElementById('ctime'), b = document.getElementById('cbar'); if (!s || s.t !== 'auction' || !s.c || !t) return; const c = s.c; if (!c.a.high || c.a.paused) return;
    const l0 = left(c); t.textContent = clock(l0); t.className = 'ctimer ' + (l0 < 5000 ? 'cneg' : 'cgold'); if (b) b.style.width = Math.round(Math.max(0, Math.min(1, l0 / (c.a.timer * 1000))) * 100) + '%';
  }
  const openCalc = (id, c) => { const mode = c && c.rules && c.rules.mode; const s = { t: 'auction', id }; if (c) s.c = c; push(s); loadCalc(s).then(() => { if (s.c && s.c.rules.mode === 'manual' && cur() === s) { stack.pop(); const o = { t: s.c.role === 'comm' && s.c.a.status !== 'closed' ? 'enter' : 'board', id, c: s.c }; push(o); if (o.t === 'board') loadBoard(o); } else if (s.c && s.c.a.status === 'closed' && cur() === s) { stack.pop(); const o = { t: 'board', id }; push(o); loadBoard(o); } sched(); }); void mode; };
  const calcOf = () => { for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].c) return stack[i].c; if (stack[i].d) return stack[i].d.calc; } return null; };
  const idOf = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].id) return stack[i].id; return null; };
  const boardOf = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].d) return stack[i].d; return null; };

  async function bid(amt, lot) {
    const s = cur(), c = s.c; if (!c || !c.a.cur) return; lot = lot || c.a.cur; if (!(Number.isInteger(amt) && amt > 0)) { err = 'Type a whole-dollar bid.'; paint(); return; }
    const done = async (j) => { if (newer(s.c, j.calc)) { setCalc(j.calc); s.c = j.calc; } s.amt = ''; s.my = { lot, amt }; const i = document.getElementById('camt'); if (i) i.value = ''; paint(); }; // M1: the status line under the bid says where it stands
    done.fail = (e) => { const j = e.j || {}; if (j.code === 'outbid' || j.code === 'sold' || j.code === 'stale') { loadCalc(s); if (j.min) { s.amt = String(j.min); const i = document.getElementById('camt'); if (i) i.value = s.amt; } } };
    await act('bid', { id: s.id, lot, amt }, done);
  }

  // L3: a typed bid is whole dollars (never rounded behind your back) and at least the lowest bid (the box resets to it)
  function bidTyped(lot) {
    const s = cur(), c = s.c, i = document.getElementById('camt'), raw = String((i && i.value) || '').trim(), v = Number(raw), mn = c && c.a.minNext; if (!c) return;
    if (s.amtFor && s.amtFor !== lot) { s.amtFor = ''; s.amt = ''; if (i) i.value = ''; err = 'The auction moved while you typed. Look at the team on the block and type your bid again.'; note = ''; paint(); return; } // v279 (B1)
    if (!raw || !isFinite(v) || v <= 0) { err = 'Type your bid in whole dollars.'; paint(); return; }
    if (!Number.isInteger(v)) { err = 'Bids are whole dollars: type ' + Math.floor(v) + ' or ' + Math.ceil(v) + ', not ' + raw + '.'; paint(); return; }
    if (mn && v < mn) { s.amt = String(mn); if (i) i.value = s.amt; err = 'The lowest bid now is ' + usd(mn) + '. The box shows it: tap Bid to send it.'; paint(); return; }
    bid(v, lot);
  }
  function down(ev) { const t = ev.target && ev.target.closest && ev.target.closest('[data-a="bid"],[data-a="bidin"]'); DOWNAMT = t ? { el: t, amt: t.getAttribute('data-amt'), lot: t.getAttribute('data-lot'), at: Date.now() } : null; }
  function click(ev) {
    const t = ev.target.closest('button,a,[data-a],[data-tab]'); const d0 = DOWNAMT; DOWNAMT = null; const moved = d0 && (d0.lot !== (t && t.getAttribute('data-lot')) || (Date.now() - d0.at < 3000 && (!t || d0.el !== t || d0.amt !== t.getAttribute('data-amt')))); // v279 (review): the lot is compared with NO time limit, so a bid held down longer than 3 s while the lot changes is refused too (quick bids and the typed Bid share this path; Enter in the box has no finger and keeps its own checks)
    if (moved || (t && /^bid(in)?$/.test(t.getAttribute('data-a') || '') && Date.now() - LOTAT < 900)) { if (cur().t === 'auction') { err = 'The auction moved while you tapped. Look again and tap the bid you want.'; note = ''; paint(); } return; }
    if (!t || t.disabled) return; const a = t.getAttribute('data-a');
    if (a === 'close' || (a === 'back' && stack.length < 2)) { window.oddCalc.close(); try { if (window.OddGroups && window.OddGroups.refresh) window.OddGroups.refresh(); } catch (x) {} return; } // back to the group page under it (v279: the Games screen under it asks its states again)
    if (a === 'back') { readDraft(); err = ''; note = ''; if (stack.length > 1) stack.pop(); const s = cur(); if (s.t === 'home') loadHome(); else if (s.t === 'auction' || s.t === 'enter' || s.t === 'members') loadCalc(s); else if (s.t === 'board') loadBoard(s); paint(); sched(); return; }
    if (t.hasAttribute('data-tab') && !a) { const s = cur(); if (s.t === 'board') { s.tab = t.getAttribute('data-tab'); paint(); } else { const o = { t: 'board', id: idOf(), tab: t.getAttribute('data-tab') }; push(o); loadBoard(o); } return; }
    if (t.hasAttribute('data-mode')) { readDraft(); DR.mode = t.getAttribute('data-mode'); paint(); return; }
    if (t.hasAttribute('data-main')) { readDraft(); DR.main = t.getAttribute('data-main') === '1'; paint(); return; }
    const pk = [...t.attributes].find((x) => x.name.startsWith('data-pick-')); if (pk) { readDraft(); const tm = DR.teams[+pk.name.slice(10)]; if (tm) DR.pick[tm.id] = pk.value; paint(); return; } // by position: ids can hold ':' or capitals, attribute names cannot
    if (a === 'create') { DR = draftNew(); push({ t: 'create1' }); if (!EV) post('events', {}).then((j) => { EV = j; paint(); }).catch((e) => { err = errText(e); paint(); }); return; }
    if (a === 'gpre') { const s = { t: 'join' }; push(s); act('gjoin', { id: t.getAttribute('data-id'), preview: true }, async (j) => { s.pre = j.calc; paint(); }); return; } // MAIN: look first, then join
    if (a === 'gjoin') { act('gjoin', { id: t.getAttribute('data-id') }, async (j) => { stack = [{ t: 'home' }]; loadHome(); openCalc(j.calc.id, j.calc); }); return; } // ROUND 4 B3: joined from its group
    if (a === 'home') { stack = [{ t: 'home' }]; err = ''; note = ''; paint(); loadHome(); return; }
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
      act(DR.id ? 'edit' : 'create', Object.assign(payload(), DR.id ? {} : { g: GR.id }), async (j) => { DR = null; stack = [{ t: 'home' }]; loadHome(); const o = { t: 'members', id: j.calc.id, c: j.calc }; push(o); note = 'Created. Members of the group join from its Calcutta tile; start the auction when they are in.'; paint(); }); return; }
    if (a === 'editrules') { const c = cur().c; DR = draftNew(); Object.assign(DR, { id: c.id, name: c.name, ev: c.ev, golf: c.golf || null, evtId: c.evtId || null, mode: c.rules.mode, minBid: c.rules.minBid, inc: c.rules.inc, timer: c.rules.timer, unsold: c.rules.unsold || 'roll', buyBack: c.rules.buyBack, main: c.rules.main, order: c.rules.order, takeKind: c.rules.take.kind, takeV: c.rules.take.v, rows: c.rules.rows.map((r) => ({ k: r.k, r: r.r, n: r.n, pct: r.bp / 100, label: r.label })) });
      c.lots.forEach((l) => l.teams.forEach((x) => { DR.pick[x.id] = l.field ? 'field' : 'lot'; })); DR.custom = c.ev === 'custom' ? c.lots.map((l) => ({ n: l.name, por: (l.por || []).map((p) => ({ pid: p.pid, name: p.name, guest: p.guest || null })) })) : []; // a guest of this Calcutta stays that guest through an edit
      push({ t: 'create1' }); const go = () => { if (c.ev !== 'custom') post('teams', { ev: c.ev, golf: c.golf || undefined, evtId: c.evtId || undefined }).then((j) => { DR.teams = j.teams; paint(); }).catch((e) => { err = errText(e); paint(); }); }; if (!EV) post('events', {}).then((j) => { EV = j; paint(); go(); }); else go(); return; }
    if (a === 'delete') { if (!confirm('Delete this Calcutta for everyone?')) return; act('delete', { id: idOf() }, async () => { stack = [{ t: 'home' }]; await loadHome(); paint(); }); return; }
    // auction
    if (a === 'bid') { bid(+t.getAttribute('data-amt'), t.getAttribute('data-lot')); return; } // L2: never a different amount from the one under the finger
    if (a === 'bidin') { bidTyped(t.getAttribute('data-lot')); return; }
    if (a === 'ctl') { const op = t.getAttribute('data-op'), s = cur(), c = s.c, b = { id: s.id, op }; if (op === 'end' && !confirm('End the auction now? Unsold lots stay unsold.')) return;
      if (op === 'undo') { const u = c && c.a.undo; if (!u) return; if (Date.now() - UNDOAT < 1500) { err = 'Undone. To remove the next one too, wait a moment and tap Undo again.'; paint(); return; } // M3: a double tap removes one bid, not two: name what goes, and send it back so the server refuses if it changed (a new bid, a double tap)
        if (u.k === 'sale') { if (!confirm('Undo the sale of ' + u.name + '? The lot goes back on the block with its bids.')) return; b.expect = { lot: u.lot }; }
        else { if (!confirm('Remove ' + u.name + '\'s ' + usd(u.amt) + ' bid?')) return; b.expect = { pid: u.pid, amt: u.amt }; } }
      if (op === 'sold' && c && c.a.high) { const l0 = left(c), lt = c.lots.find((x) => x.id === c.a.cur); if (l0 != null && l0 >= 1000 && !confirm('Sell ' + ((lt && lt.name) || 'this lot') + ' to ' + c.a.high.name + ' for ' + usd(c.a.high.amt) + ' now? ' + Math.ceil(l0 / 1000) + ' seconds are still on the clock.')) return; }
      act('ctl', b, async (j) => { if (op === 'undo') UNDOAT = Date.now(); setCalc(j.calc); s.c = j.calc; paint(); sched(); }); return; }
    if (a === 'order') { push({ t: 'order', id: idOf(), c: calcOf() }); return; }
    if (a === 'mv') { const s = cur(), i = +t.getAttribute('data-i'), dd = +t.getAttribute('data-d'), o = s.o; [o[i], o[i + dd]] = [o[i + dd], o[i]]; paint(); return; }
    if (a === 'saveorder') { const s = cur(); act('ctl', { id: s.id, op: 'reorder', order: s.o }, async (j) => { setCalc(j.calc); stack.pop(); cur().c = j.calc; note = 'Order saved.'; paint(); sched(); }); return; }
    if (a === 'members') { const o = { t: 'members', id: idOf(), c: calcOf() }; push(o); loadCalc(o); return; }
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
    if (a === 'redit1') { const s = cur(); s.rt = t.getAttribute('data-team'); s.rc = null; s.ro = null; s.rv = null; s.rrs = ''; paint(); return; }
    if (a === 'rchamp' || a === 'rout') { const s = cur(), l = s.d.board.lots.find((x) => x.id === s.lot), tm = l.teams.find((x) => x.id === s.rt), r = tm.r || {}; if (a === 'rchamp') s.rc = !(s.rc != null ? s.rc : r.champ); else s.ro = !(s.ro != null ? s.ro : r.out); paint(); return; }
    if (a === 'rsave') { const s = cur(), v = (id) => (document.getElementById(id) || {}).value, b = { id: s.id, team: t.getAttribute('data-team'), wins: Math.round(Number(v('rw') || 0)) }; s.rv = { w: v('rw'), re: v('rre'), pl: v('rpl') }; // what was typed survives a repaint (an error line, the confirm card)
      if (v('rre') != null) b.reached = +v('rre'); if (v('rpl') != null) b.place = Math.round(Number(v('rpl'))); if (s.rc != null) b.champ = s.rc; if (s.ro != null) b.out = s.ro;
      if (s.d.calc.feedBacked) { b.reason = String(v('rrs') || '').trim(); s.rrs = b.reason; if (b.reason.length < 5) { err = 'Say why you are correcting the score feed (every member will see it).'; paint(); return; } } // ROUND 4 B1
      if (!s.d.calc.started) { s.rconf = b; err = ''; paint(); return; } // the first result: confirm card first
      act('result', b, async () => { s.rt = null; note = 'Result saved.'; await loadBoard(s); }); return; }
    if (a === 'rcancel') { const s = cur(); s.rconf = null; paint(); return; }
    if (a === 'rgo') { const s = cur(), b = Object.assign({}, s.rconf, { confirm: true, closeUnsold: s.d.calc.unsold || 0 }); const done = async () => { s.rt = null; s.rconf = null; note = 'Result saved. The event has started: who owns what is final.'; await loadBoard(s); };
      done.fail = (e) => { if (e.j && e.j.code === 'confirmstart') { loadBoard(s).then(() => { err = 'The number of unsold lots changed. Check it and confirm again.'; paint(); }); } else s.rconf = null; }; act('result', b, done); return; }
    if (a === 'rclear') { const s = cur(); act('result', { id: s.id, team: t.getAttribute('data-team'), clear: true }, async () => { s.rt = null; await loadBoard(s); }); return; }
    if (a === 'bbsave') { const s = cur(), i = +((document.getElementById('bwho') || {}).value || 0); act('buyback', { id: s.id, lot: t.getAttribute('data-lot'), who: i }, async () => { note = 'Buy-back recorded.'; await loadBoard(s); }); return; }
    if (a === 'bbself') { const s = cur(); act('buyback', { id: s.id, lot: t.getAttribute('data-lot'), self: true }, async () => { note = 'You bought back half.'; await loadBoard(s); }); return; }
    if (a === 'poradd') { const s = cur(), w = whoVal('p'); if (!w) { err = 'Pick a member or type a name.'; paint(); return; } act('por', { id: s.id, lot: t.getAttribute('data-lot'), add: w }, async () => { note = 'Player added.'; await loadBoard(s); }); return; }
    if (a === 'pordel') { const s = cur(); act('por', { id: s.id, lot: t.getAttribute('data-lot'), remove: +t.getAttribute('data-i') }, async () => { await loadBoard(s); }); return; }
    if (a === 'bbclear') { const s = cur(); act('buyback', { id: s.id, lot: t.getAttribute('data-lot'), clear: true }, async () => { await loadBoard(s); }); return; }
  }
  function change(ev) {
    const id = ev.target && ev.target.id; if (!id) return; const s = cur();
    if (id === 'cev') { readDraft(); pickEv(ev.target.value); return; }
    if (ev.target.hasAttribute('data-who')) { const p = ev.target.getAttribute('data-who');  const box = ev.target.closest('.ccard'); if (box) { const n = box.querySelector('#' + p + 'name'); if (ev.target.value === '_' && !n) ev.target.closest('label').insertAdjacentHTML('afterend', '<label class="clab">Their name<input id="' + p + 'name" class="cin" maxlength="24"></label>'); if (ev.target.value !== '_' && n) n.closest('label').remove(); } return; }
    if (/^(ctake|ctv|rk\d+|rr\d+|rn\d+|rp\d+|cmin|cinc|ctimer|corder|cuns)$/.test(id)) { readDraft(); paint(); }
  }
  function input(ev) { if (ev.target && ev.target.id === 'cq') { readDraft(); paint(); } if (ev.target && ev.target.id === 'camt') { const s = cur(); if (s.amtFor) s.amtFor = ''; } } // v279 (B1): edited after the lot changed = typed for this lot
  function keydown(ev) { if (ev.key !== 'Enter' || !ev.target) return; const id = ev.target.id; if (id === 'camt') { ev.preventDefault(); const b = el().querySelector('[data-a="bidin"]'); if (!b || b.disabled) return; if (Date.now() - LOTAT < 900) { err = 'The auction moved while you tapped. Look again and tap the bid you want.'; note = ''; paint(); return; } bidTyped(b.getAttribute('data-lot')); } if (id === 'cadd') { ev.preventDefault(); el().querySelector('[data-a="cadd"]').click(); } }
  function css() {
    if (document.getElementById('occss')) return; const st = document.createElement('style'); st.id = 'occss';
    st.textContent = '/* Oddable look (owner, Nov 16 2026): every color is the live app\'s own CSS variable (--bg --panel --panel2 --line --ink --muted --blue --green --red, set on body by index.html,   so the Cowboys and the violet themes both follow); the only extra color is the app\'s gold (#f5c542, as .botd / .arbbar). Radii, chips and cards copy index.html. */#ocalc{--cbg:var(--bg);--cp:var(--panel);--cp2:var(--panel2);--cl:var(--line);--ci:var(--ink);--cm:var(--muted);--ca:var(--blue);--cg:var(--green);--cr:var(--red);--cy:#f5c542;--cyt:#f5c542;position:fixed;inset:0;z-index:96;background:var(--bg);color:var(--ink);overflow:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}html:not(.cb) body:not(.dark) #ocalc{--cyt:#7a5600}#ocalc .cin0{max-width:560px;margin:0 auto;padding:0 16px calc(48px + env(safe-area-inset-bottom))}#ocalc.cbusy{cursor:progress}#ocalc.cbusy .cpri,#ocalc.cbusy .cgo{opacity:.6}#ocalc *{box-sizing:border-box}#ocalc h1{font-size:28px;line-height:1.15;margin:14px 0 4px;overflow-wrap:anywhere;color:var(--ink);letter-spacing:-.01em}#ocalc h2{font-size:17px;margin:0 0 10px}#ocalc h2.cmt{margin-top:16px}#ocalc .csub{color:var(--muted);margin:0 0 16px}#ocalc .ctop{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin:0 -16px;padding:max(8px,env(safe-area-inset-top)) 16px 10px;background:linear-gradient(135deg,#7c3aed 0%,#4c1d95 55%,#1b1f29 100%);border-radius:0 0 26px 26px;color:#fff;box-shadow:0 6px 18px #0006}html.cb #ocalc .ctop{background:linear-gradient(135deg,#003594 0%,#002b5c 38%,#041e42 74%,#08111f 100%);border-bottom:3px solid #869397}#ocalc .cbrand{font:800 19px system-ui;white-space:nowrap}#ocalc .ctop .cx{justify-self:end}#ocalc button,#ocalc a.cpri{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}#ocalc button:disabled{opacity:.45;cursor:not-allowed}#ocalc .cback,#ocalc .cx{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.45);color:#fff;border-radius:999px;font-weight:700;min-height:44px;padding:0 14px;justify-self:start;white-space:nowrap}#ocalc .clink{display:block;width:100%;margin-top:4px;background:none;border:0;color:var(--blue);font-weight:700;min-height:44px;padding:0 4px;text-align:left}#ocalc .cpri,#ocalc .csec,#ocalc .cdanger,#ocalc .cgreen,#ocalc .cgo{min-height:48px;border-radius:12px;font-weight:700;font-size:16px;padding:10px 12px;text-decoration:none;display:flex;align-items:center;justify-content:center;text-align:center}#ocalc .cpri{background:var(--blue);border:1px solid var(--blue);color:#fff}html.cb #ocalc .cpri{background:#003594;border-color:#c6cbd7;color:#fff}#ocalc .csec{background:var(--panel2);border:1px solid var(--line);color:var(--ink)}#ocalc .cdanger{background:none;border:1px solid var(--red);color:var(--red)}#ocalc .cgreen{background:#16915a;border:1px solid var(--green);color:#fff}#ocalc .cgo{background:var(--cy);border:0;color:#1a1300;min-width:84px}#ocalc .cfull{width:100%;margin:12px 0}#ocalc .c2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin:10px 0}#ocalc .c3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0}#ocalc .c3r{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:end}#ocalc .ch{margin:20px 0 8px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}#ocalc .ccard{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:12px 14px;margin:10px 0;display:block;width:100%;text-align:left;color:var(--ink)}#ocalc .cbtn{color:inherit}#ocalc .cblock{border:2px solid var(--cy);border-radius:16px;background:linear-gradient(135deg,rgba(245,197,66,.22),rgba(255,226,140,.08)),var(--panel);box-shadow:0 0 18px rgba(245,197,66,.35)}#ocalc .clive{border-color:var(--blue)}#ocalc .crow{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}#ocalc .cname{font-size:20px;font-weight:800;flex:1;min-width:0;overflow-wrap:anywhere}#ocalc .cbadge{border:1px solid var(--blue);background:var(--panel2);color:var(--ink);border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700;white-space:nowrap}#ocalc .cbadge.cy{border-color:var(--cy);color:var(--cyt);background:rgba(245,197,66,.1)}#ocalc .cmeta{color:var(--muted);margin:2px 0}#ocalc .cmut{color:var(--muted)}#ocalc .cnote{color:var(--muted);font-size:13px;margin:8px 0;overflow-wrap:anywhere}#ocalc .cyel{color:var(--cyt)}#ocalc .cpos{color:var(--green)}#ocalc .cneg{color:var(--red)}#ocalc .cgold{color:var(--cyt)}#ocalc .ctile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;text-align:left;min-height:64px;display:block;width:100%;min-width:0;color:var(--ink)}#ocalc .ctile:disabled{opacity:1;cursor:default}#ocalc .ctile small{display:block;color:var(--muted);font-size:13px}#ocalc .ctile b{display:block;font-size:24px;line-height:1.2;overflow-wrap:anywhere}#ocalc .ctile i{display:block;font-style:normal;color:var(--muted);font-size:12px;margin-top:2px}#ocalc .clab{display:block;color:var(--muted);font-size:13px;font-weight:600;margin:12px 0 6px}#ocalc .clab .cin,#ocalc .clab .csel{margin-top:6px}#ocalc .cin,#ocalc .csel{width:100%;min-height:48px;background:var(--panel);border:1px solid var(--line);border-radius:12px;color:var(--ink);font:600 16px system-ui;padding:10px 12px;color-scheme:dark;min-width:0}#ocalc .ccodein{text-transform:uppercase;letter-spacing:.12em;font-size:19px}#ocalc .cseg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:8px;margin:6px 0}#ocalc .cseg button{min-height:44px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font-weight:700;font-size:14px;padding:6px 10px}#ocalc .cseg button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}#ocalc .c3s{margin:12px 0}#ocalc .cteam{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 10px;padding:6px 0;border-bottom:1px solid var(--line)}#ocalc .cteam>span{flex:1 1 120px;min-width:0;overflow-wrap:anywhere;font-weight:600}#ocalc .cteam .cseg{flex:1 1 220px;margin:0}#ocalc .cteam .cseg button{min-height:44px;font-size:13px}#ocalc .cline{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:52px;padding:4px 0}#ocalc .cline small{display:block;color:var(--muted);font-size:13px}#ocalc .csw{flex:0 0 auto;width:64px;height:44px;border:0;background:none;position:relative;padding:0}#ocalc .csw::before{content:"";position:absolute;left:1px;right:1px;top:4px;bottom:4px;border-radius:999px;border:1px solid var(--line);background:var(--panel2)}#ocalc .csw i{position:absolute;top:9px;left:6px;width:26px;height:26px;border-radius:50%;background:var(--muted);transition:left .15s}#ocalc .csw.on::before{background:var(--blue);border-color:var(--blue)}#ocalc .csw.on i{left:32px;background:#fff}html.cb #ocalc .csw.on::before{background:#003594;border-color:#c6cbd7}#ocalc .cwarn{border:2px solid var(--cy);border-radius:16px;padding:12px 14px;margin:12px 0;background:linear-gradient(135deg,rgba(245,197,66,.18),rgba(255,226,140,.06));color:var(--ink)}#ocalc .cwarn b{display:block;color:var(--cyt);font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px}#ocalc .cmsg{display:flow-root}#ocalc .cv-auction .cmsg .cerr,#ocalc .cv-auction .cmsg .cok{padding:6px 10px;margin:4px 0 6px;font-size:13px;line-height:1.35}#ocalc .cmsgin .cwarn{padding:6px 10px;margin:4px 0 6px;font-size:13px;line-height:1.35;border-width:1px;border-radius:10px}#ocalc .cmsgin .cwarn b{font-size:12px;margin-bottom:2px}@media (max-height:700px){#ocalc .cv-auction h1{font-size:20px;margin:8px 0 2px}#ocalc .cv-auction .cmeta{font-size:13px;margin:0}#ocalc .cv-auction .cblock{margin-top:6px}#ocalc .cv-auction .cblock .cbig{font-size:24px;margin:2px 0}#ocalc .cv-auction .cblock .cbar{margin:6px 0}#ocalc .cv-auction .cst{font-size:14px;margin:6px 0 2px}}.cerr{border:1px solid var(--red);background:#d93a2e14;color:var(--ink);border-radius:10px;padding:9px 12px;margin:8px 0}#ocalc .cok{border:1px solid var(--green);background:#16915a14;color:var(--ink);border-radius:10px;padding:9px 12px;margin:8px 0}#ocalc .ccode{display:flex;align-items:center;gap:8px;background:var(--panel2);border-radius:12px;padding:10px 12px;flex-wrap:wrap}#ocalc .ccode small{display:block;color:var(--muted)}#ocalc .ccode b{font-size:20px;letter-spacing:.1em;overflow-wrap:anywhere}#ocalc .clist{padding:4px 14px}#ocalc .cmrow{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:52px;border-bottom:1px solid var(--line);padding:6px 0;width:100%;background:none;border-left:0;border-right:0;border-top:0;text-align:left;color:var(--ink)}#ocalc .cmrow:last-child{border-bottom:0}#ocalc .cmrow>span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}#ocalc .cmrow small{display:block;color:var(--muted);font-size:12px}#ocalc .cmrow i{font-style:normal}#ocalc .cud{display:flex;gap:6px}#ocalc .ctiny{background:var(--panel2);border:1px solid var(--line);border-radius:10px;color:var(--ink);min-height:44px;min-width:52px;padding:0 10px;font-weight:600}#ocalc .cthead,#ocalc .cthd{display:grid;grid-template-columns:minmax(0,1fr) 84px 84px;gap:8px;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:12px 13px 2px}#ocalc .cthd{grid-template-columns:minmax(0,1fr) auto;padding:2px 0 4px}#ocalc .ccard .cthead{padding-left:0;padding-right:0}#ocalc .cr{text-align:right;justify-self:end}#ocalc .ctrow{display:grid;grid-template-columns:minmax(0,1fr) 84px 84px;gap:8px;align-items:center;width:100%;text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:6px 0;min-height:56px;color:var(--ink)}#ocalc .ctrow.hit{border-color:var(--green);background:#16915a14}#ocalc .ctrow.miss{border-color:var(--red);background:#d93a2e14}#ocalc .ctrow.me{box-shadow:inset 4px 0 0 var(--blue)}#ocalc .cpn{min-width:0}#ocalc .cpn b{display:block;font-size:16px;overflow-wrap:anywhere}#ocalc .cpn small{display:block;color:var(--muted);font-size:12px}#ocalc .cpn small.cpos{color:var(--green)}#ocalc .cpn small.cneg{color:var(--red)}#ocalc .cv{font-weight:800;font-size:16px}#ocalc .crules>div{display:flex;flex-direction:column;padding:8px 0;border-bottom:1px solid var(--line)}#ocalc .crules small{color:var(--muted);font-size:12px}#ocalc .crules span{overflow-wrap:anywhere}#ocalc .ckv{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}#ocalc .ckv span{min-width:0;overflow-wrap:anywhere}#ocalc .ckv small{display:block;color:var(--muted);font-size:12px}#ocalc .ckv b{text-align:right;white-space:nowrap}#ocalc .ckv.ctot{border-bottom:0}#ocalc .ckv.ctot b{font-size:20px}#ocalc .ckv3{display:grid;grid-template-columns:minmax(0,1fr) 84px 84px;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)}#ocalc .ckv3 span{min-width:0;overflow-wrap:anywhere}#ocalc .ckv3 small{display:block;color:var(--muted);font-size:12px}#ocalc .ckv3 b{text-align:right}#ocalc .crowed{border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:6px}#ocalc .clots summary{min-height:44px;list-style:none;display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--panel2);border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;margin:6px 0}#ocalc .clots summary::-webkit-details-marker{display:none}#ocalc .clots summary::after{content:\'▾\';color:var(--blue)}#ocalc .cbig{font-size:30px;font-weight:800;margin:6px 0;overflow-wrap:anywhere;line-height:1.1;letter-spacing:-.02em}#ocalc .ctimer{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums}#ocalc .chigh{font-size:40px;font-weight:800;color:var(--green);font-variant-numeric:tabular-nums;line-height:1}#ocalc .cblock>.cmut:first-child,#ocalc .cblock>.crow:first-child>.cmut:first-child{font:800 13px system-ui;letter-spacing:.08em;text-transform:uppercase;color:var(--cyt)}#ocalc .cbar{height:10px;background:var(--panel2);border-radius:8px;margin:10px 0;overflow:hidden}#ocalc .cbar i{display:block;height:100%;background:var(--cy);border-radius:8px;transition:width .2s linear}#ocalc .cbidrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;margin-top:4px}#ocalc .cgrid{display:block}#ocalc .cq .cpri{flex-direction:column;gap:0;padding:6px 4px;line-height:1.15}#ocalc .cq small{font-size:12px;font-weight:600;opacity:.85}#ocalc .cnew span{display:block;color:var(--muted);font-size:14px;margin-top:2px}#ocalc .cnew b{display:block;margin-bottom:2px}#ocalc .cwon{display:inline-block;margin:2px 0 6px;padding:4px 12px;border-radius:999px;background:var(--green);color:#04170d;font-weight:800}#ocalc .cst{font-size:15px;font-weight:700;margin:10px 0 2px}#ocalc .cdown{border-color:var(--red)}#ocalc .cdown b{color:var(--red)}@media (min-width:768px){#ocalc .cvw{max-width:760px;margin:0 auto}#ocalc .cvw.cwide{max-width:none}#ocalc .cin0{max-width:1328px;padding:0 22px calc(40px + env(safe-area-inset-bottom))}#ocalc .ctop{margin:0 -22px;padding-left:22px;padding-right:22px}#ocalc .cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0 12px;align-items:start}#ocalc .cfull{max-width:520px}#ocalc .clab{max-width:620px}#ocalc .cthead,#ocalc .ctrow,#ocalc .ckv3{grid-template-columns:minmax(0,1fr) 120px 120px}}@media (min-width:1000px){#ocalc .cv-auction,#ocalc .cv-board{max-width:1140px}#ocalc .csplit{display:grid;grid-template-columns:minmax(0,720px) minmax(260px,1fr);gap:0 28px;align-items:start;justify-content:start}#ocalc .cbsplit{grid-template-rows:auto 1fr}#ocalc .cbsplit>.ctail{align-self:start}#ocalc .cbsplit>.caside{grid-column:2;grid-row:1}#ocalc .cbsplit>.cmainc{grid-column:1;grid-row:1/span 2}#ocalc .cbsplit>.ctail{grid-column:2;grid-row:2}#ocalc .caside .cthead,#ocalc .caside .ctrow{grid-template-columns:minmax(0,1fr) 84px 84px}}@media (max-width:360px){#ocalc .cbt{display:none}#ocalc .cback,#ocalc .cx{padding:0 10px;font-size:14px}#ocalc .cthead,#ocalc .ctrow,#ocalc .ckv3{grid-template-columns:minmax(0,1fr) 72px 72px}#ocalc .c3:not(.cq){grid-template-columns:1fr 1fr}#ocalc .cq{gap:6px}#ocalc .cq .cpri{font-size:15px}}';
    document.head.appendChild(st);
  }
  // MAIN: like the Groups overlay it sits beside the tab bar, never over it (above it on a phone, to its right where the bar is a rail), and above the
  // floating My Bets banner (z 40). pics/groups.js closes it with the Groups overlay (a tab tap).
  function fit() { const e = el(), bn = document.getElementById('bn'); if (!e) { window.removeEventListener('resize', fit); return; } let r = bn ? bn.getBoundingClientRect() : null; if (r && !(r.width && r.height)) r = null; const rail = !!r && r.height > r.width; e.style.left = rail ? Math.round(r.right) + 'px' : '0'; e.style.bottom = r && !rail ? Math.max(0, Math.round(window.innerHeight - r.top)) + 'px' : '0'; }
  // entry point (MAIN): pics/groups.js calls window.oddCalc({ gr }) from a group's Calcutta tile; gr = that group ({ id, name, role }).
  window.oddCalc = function (o) {
    if (!o || (!o.mine && (!o.gr || !o.gr.id))) return; MINE = !!o.mine; GR = MINE ? null : { id: String(o.gr.id), name: String(o.gr.name || ''), role: o.gr.role || '' }; H = null; EV = null; DR = null; FAILS = 0; // F8: { mine: true } opens My Calcuttas (every group)
    css(); let e = el(); if (e) e.remove(); e = document.createElement('div'); e.id = 'ocalc'; e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', 'Calcutta');
    e.innerHTML = '<div class="cin0"></div>'; document.body.appendChild(e); fit(); window.addEventListener('resize', fit);
    stack = [{ t: 'home' }]; err = ''; note = ''; e.addEventListener('pointerdown', down, true); e.addEventListener('click', click); e.addEventListener('change', change); e.addEventListener('input', input); e.addEventListener('keydown', keydown); paint(); loadHome();
    clearInterval(TICK); TICK = setInterval(() => { if (!el()) { clearInterval(TICK); return; } tickClock(); }, 250);
  };
  window.oddCalc.close = () => { const e = el(); if (!e) return; readDraft(); clearTimeout(POLL); clearInterval(TICK); e.remove(); window.removeEventListener('resize', fit); };
})();
