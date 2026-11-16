// Oddable Groups. Full-screen overlay #ogrp (same pattern as dash.js), opened from the "Groups" item in the main menu (not in mirror mode).
// A group holds members and several CONTESTS (G13): picks contests (each its own sport, dates, rules, locked at its own start), Calcuttas and other games later.
// Every rule, standing and money figure comes from the server (odds-api/groups.js); this file only shows them. Money is information only:
// Oddable never collects, holds or pays money. Results are graded by Oddable from final scores; other members' bets arrive only after their games kick off.
(function () {
  const API = (window.ODD_GROUPS_API || 'https://calcutta-odds.onrender.com') + '/groups/';
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const att = (x) => esc(String(x == null ? '' : x).replace(/[^\w.-]/g, ''));
  const usd = (n, sign) => { const v = Math.round((Number(n) || 0) * 100) / 100, a = Math.abs(v), s = '$' + (Number.isInteger(a) ? a.toLocaleString() : a.toFixed(2)); return (v < 0 ? '-' : sign && v > 0 ? '+' : '') + s; };
  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const TZ = 'America/Chicago', chiDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms));
  const chiStart = (day) => { for (const off of ['-05:00', '-06:00']) { const t = Date.parse(day + 'T00:00:00' + off); if (chiDay(t) === day && chiDay(t - 1) !== day) return t; } return Date.parse(day + 'T06:00:00Z'); };
  const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const wd = (day) => new Date(day + 'T12:00:00Z').getUTCDay();
  const fmtDay = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const fmtTime = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const SPORTS = [['all', 'All sports'], ['nfl', 'NFL'], ['ncaaf', 'College football'], ['nba', 'NBA'], ['mlb', 'MLB'], ['nhl', 'NHL'], ['ncaab', 'College basketball']], SPORT = Object.fromEntries(SPORTS);
  const FMT = { standings: 'Season standings', best5: 'Best five' };
  const METRIC = { win: 'Winnings ($)', units: 'Units', ret: 'Return %', pct: 'Win %' }, MCOL = { win: 'Winnings', units: 'Units', ret: 'Return', pct: 'Win %' };
  const TYPES = [['sp', 'Spread (incl. run and puck lines)'], ['ml', 'Moneyline'], ['ou', 'Totals (over / under)'], ['prop', 'Player props'], ['parlay', 'Parlays']];
  const SPLITN = { '60/30/10': '60 / 30 / 10', '100': 'Winner takes all', '50/30/20': '50 / 30 / 20', '70/30': '70 / 30', none: 'Bragging rights only' };
  const RUNS = { season: 'Rest of season', weekend: 'One weekend', w1: 'One week', w2: '2 weeks', w3: '3 weeks', w4: '4 weeks', w6: '6 weeks', w8: '8 weeks', playoffs: 'Through the playoffs', custom: 'Custom dates' };
  const MINPAID = [0, 1, 2, 3, 5, 8, 10, 12, 15, 20, 25, 30];
  const MONEYLINE = 'The commissioner collects entries and pays winners. Oddable keeps the score and shows who is owed what. Oddable never collects, holds or pays money.';
  const GRADED = 'Results are graded by Oddable from final scores (ESPN), at the side, line, odds and stake the bet had at kickoff. A bet first synced after its game started never counts.';
  const WEEKS = 'Weeks run Tuesday to Monday for every sport.';
  const HUBNOTE = 'Each contest has its own sport, dates and rules, all locked at its own start. Members opt in to side pots.';
  let stack = [{ t: 'home' }], H = null, LIMS = null, busy = false, err = '', DR = null;

  // ---------- server ----------
  async function post(op, b) {
    const r = await fetch(API + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify(Object.assign({ myName: g('odd-name') || '' }, b || {})) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server said ' + r.status), { status: r.status }); return j;
  }
  const errText = (e) => (e && /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Could not reach the server. It may be waking up: try again in a few seconds.' : e && e.status === 401 ? 'Sign in to use Groups.' : (e && e.message) || 'Something went wrong');
  async function act(op, b, then) { if (busy) return; busy = true; err = ''; paintBusy(true); try { const j = await post(op, b); busy = false; await then(j); } catch (e) { busy = false; err = errText(e); paint(); } paintBusy(false); }
  const ENT = () => (LIMS && LIMS.text) || 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.';

  // ---------- small parts ----------
  const top = (back, right) => '<div class="gtop">' + (back ? '<button class="gback" data-a="back">‹ ' + esc(back) + '</button>' : '<span></span>') + (right || '<button class="gx" data-a="close" aria-label="Close Groups">Close</button>') + '</div>';
  const tile = (lab, v, cls, a, sub) => '<button class="gtile" ' + a + '><small>' + esc(lab) + (a ? ' ›' : '') + '</small><b class="' + (cls || '') + '">' + v + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</button>';
  const sw = (on, a, dis) => '<button class="gsw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" ' + (dis ? 'disabled' : a) + '><i></i></button>';
  const seg = (opts, cur, a, dis) => '<div class="gseg">' + opts.map(([v, l]) => '<button class="' + (v === cur ? 'on' : '') + '" ' + (dis ? 'disabled ' : '') + a + '="' + att(v) + '">' + esc(l) + '</button>').join('') + '</div>';
  const sel = (id, opts, cur, dis) => '<select id="' + id + '" class="gsel"' + (dis ? ' disabled' : '') + '>' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
  const val = (t, metric, round) => (metric === 'win' ? (round ? usd(Math.round(t.win), true) : usd(t.win, true)) : metric === 'units' ? (t.units > 0 ? '+' : '') + t.units + 'u' : metric === 'ret' ? (t.ret == null ? '–' : (t.ret > 0 ? '+' : '') + t.ret + '%') : t.pct == null ? '–' : t.pct + '%');
  const vcls = (t, metric) => { const v = metric === 'pct' ? (t.pct == null ? 0 : t.pct - 50) : metric === 'ret' ? t.ret || 0 : metric === 'units' ? t.units : t.win; return v > 0 ? 'gpos' : v < 0 ? 'gneg' : ''; };
  const rec = (t) => t.w + '-' + t.l + (t.p ? '-' + t.p : '');
  const placeTxt = (x) => (x.tied ? 'T' : '') + x.place;
  const startsTxt = (ms) => { const d = chiDay(ms), td = chiDay(Date.now()), diff = Math.round((Date.parse(d) - Date.parse(td)) / 864e5); return 'Starts ' + (diff <= 0 ? 'today' : diff === 1 ? 'tomorrow' : diff < 7 ? new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' }) : fmtDay(d)); };
  const potBadge = (c) => '<span class="gbadge' + (c.pot === 'side' ? ' gside' : '') + '">' + (c.pot === 'side' ? 'Side pot' : 'Main pot') + '</span>';
  const scopeTxt = (r) => (r.kalshi ? 'Kalshi-synced bets only' : 'any bet in My Bets');
  const cmeta = (c) => esc(SPORT[c.sport] + ' · ' + (RUNS[c.runs] || '') + ' · ' + (c.fmt === 'best5' ? 'best five, ' : '') + 'ranked by ' + MCOL[c.rules.metric].toLowerCase());
  const picks = (gr) => (gr.contests || []).filter((c) => c.kind === 'picks');
  const cof = (gr, cid) => (gr.contests || []).find((c) => c.cid === cid);
  const curGroup = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].gr) return stack[i].gr; return null; };

  // ---------- home ----------
  function home() {
    if (!H) return '<div class="gcard">Loading your groups…</div>';
    let s = '<h1>Groups</h1><p class="gsub">Your real bets against your people. Every result is graded by Oddable from final scores.</p><div class="g2"><button class="gpri" data-a="create">Create a group</button><button class="gsec" data-a="join">Join with a code</button></div>';
    s += '<h3 class="gh">My groups</h3>';
    if (!H.groups.length) s += '<div class="gcard gmut">No groups yet. Create one, or open an invite link from a friend.</div>';
    H.groups.forEach((gr) => {
      const comm = gr.role === 'comm', P = picks(gr), first = P.find((c) => gr.mineC && gr.mineC[c.cid]) || P[0], m = first && gr.mineC && gr.mineC[first.cid];
      s += '<div class="gcard"><div class="grow"><button class="gname" data-a="hub" data-id="' + att(gr.id) + '">' + esc(gr.name) + ' ›</button>' + (comm ? '<span class="gbadge">Commissioner</span>' : '') + (!gr.started ? '<span class="gbadge gy">' + esc(startsTxt(gr.start)) + '</span>' : gr.ended ? '<span class="gbadge">Final</span>' : '') + '</div>';
      s += '<div class="gmeta">' + gr.contests.length + ' contest' + (gr.contests.length === 1 ? '' : 's') + ' · ' + esc([...new Set(P.map((c) => SPORT[c.sport]))].join(', ')) + ' · ' + gr.count + ' member' + (gr.count === 1 ? '' : 's') + '</div>';
      if (m) s += '<div class="g3">' + tile('Your place', m.place ? placeTxt({ place: m.place, tied: false }) === String(m.place) ? ord(m.place) : '–' : '–', '', 'data-a="open" data-id="' + att(gr.id) + '" data-cid="' + att(first.cid) + '"') + tile(MCOL[first.rules.metric], m.t ? val(m.t, first.rules.metric, 1) : '–', m.t ? vcls(m.t, first.rules.metric) : '', 'data-a="player" data-id="' + att(gr.id) + '" data-cid="' + att(first.cid) + '" data-pid="' + att(gr.me) + '"') + tile('Main pot', usd(Math.round(gr.pots.main.pot)), 'ggold', 'data-a="pot" data-id="' + att(gr.id) + '" data-w="main"') + '</div>';
      else s += '<button class="glink" data-a="hub" data-id="' + att(gr.id) + '">Rules lock at each contest\'s first kickoff. Review them ›</button>';
      if (comm && gr.reqCount) s += '<button class="glink gv" data-a="members" data-id="' + att(gr.id) + '">' + gr.reqCount + ' join request' + (gr.reqCount === 1 ? '' : 's') + ' waiting ›</button>';
      s += '</div>';
    });
    if (H.open.length || H.pending.length) s += '<h3 class="gh">Open to requests</h3>';
    H.open.forEach((gr) => {
      s += '<div class="gcard"><div class="grow"><b class="gname">' + esc(gr.name) + '</b><span class="gmut">' + gr.count + ' of ' + gr.join.max + ' spots</span></div><div class="gmeta">' + esc(picks(gr).map((c) => SPORT[c.sport] + ' ' + (c.fmt === 'best5' ? 'best five' : 'standings')).join(' · ')) + ' · ' + esc(startsTxt(gr.start).toLowerCase()) + '</div>';
      s += '<div class="gnote">' + esc(gr.takeText) + (gr.pots.main.entry ? ' · entry ' + usd(gr.pots.main.entry) : ' · no entry') + '</div><div class="gnote">The commissioner approves every member.</div>';
      s += '<div class="g2"><button class="gsec" data-a="rules" data-id="' + att(gr.id) + '">See the rules</button><button class="gout" data-a="request" data-id="' + att(gr.id) + '">Request to join</button></div></div>';
    });
    H.pending.forEach((p) => { s += '<div class="gcard gdash"><b>' + esc(p.name) + '</b><div class="gmut">Request sent. Waiting for the commissioner.</div><button class="glink" data-a="cancel" data-id="' + att(p.id) + '">Cancel request</button></div>'; });
    return s;
  }
  // ---------- group hub (GroupHub mockup) ----------
  function hubV() {
    const s = stack[stack.length - 1], gr = s.gr; if (!gr) return '<div class="gcard">Loading…</div>';
    const comm = gr.role === 'comm', P = gr.pots, running = gr.contests.filter((c) => c.started && !c.ended).length;
    let h = '<div class="grow"><h1>' + esc(gr.name) + '</h1>' + (comm ? '<span class="gbadge">Commissioner</span>' : '') + '</div><div class="gmeta">' + gr.count + ' member' + (gr.count === 1 ? '' : 's') + ' · ' + gr.contests.length + ' contest' + (gr.contests.length === 1 ? '' : 's') + (running ? ' · ' + running + ' running' : '') + '</div>';
    gr.contests.forEach((c) => {
      const m = s.mineC && s.mineC[c.cid], inC = c.pot !== 'side' || c.in;
      h += '<div class="gcc' + (c.kind !== 'picks' ? ' gcalc' : '') + '"><button class="gccb" data-a="' + (c.kind === 'picks' ? 'open' : 'ext') + '" data-cid="' + att(c.cid) + '"><span class="grow"><b class="gct">' + esc(c.name) + '</b>' + potBadge(c) + '</span>';
      if (c.kind === 'picks') {
        h += '<span class="gmeta">' + cmeta(c) + '</span><span class="grow gcl"><span>' + (!c.started ? esc(startsTxt(c.start)) + ', rules lock then' : m && m.place ? 'You: ' + ord(m.place) + ' of ' + m.of : inC ? 'Standings' : c.count + ' in this side pot') + '</span><span class="' + (m && m.t ? vcls(m.t, c.rules.metric) : 'gv2') + '">' + (m && m.t ? val(m.t, c.rules.metric, 1) : '') + ' ›</span></span>';
      } else h += '<span class="gmeta">' + esc(c.kind === 'calcutta' ? 'Calcutta' : String(c.type || 'Game')) + '</span><span class="grow gcl"><span>Opens in its own screen</span><span class="gv2">›</span></span>';
      h += '</button>';
      if (c.pot === 'side' && c.kind === 'picks' && !c.started) h += c.in ? (comm ? '<div class="gnote">You are in this side pot (' + (c.rules.entry ? usd(c.rules.entry) + ' entry' : 'no entry') + ').</div>' : '<button class="glink" data-a="sideout" data-cid="' + att(c.cid) + '">You are in this side pot · Leave it</button>') : '<button class="gout gfull" data-a="sidein" data-cid="' + att(c.cid) + '">Join this side pot' + (c.rules.entry ? ' · ' + usd(c.rules.entry) + ' entry' : '') + '</button>';
      h += '</div>';
    });
    if (comm) { // only the commissioner adds contests; engines not built yet show "Coming soon" (they attach later through groups.js attachGame)
      h += '<button class="gadd gadd2" data-a="addc">+ Add a picks contest</button>';
      [['Calcutta', 'calc'], ['golf contest', 'golf'], ['local event', 'event']].forEach(([n, k]) => { h += '<button class="gadd" disabled aria-disabled="true" data-soon="' + k + '">+ Add a ' + n + '<small>Coming soon</small></button>'; });
    }
    const sides = P.sides || [];
    h += '<div class="gcard gpotc"><button class="gkvb" data-a="pot" data-w="main"><span class="gmut">Main pot ›</span><b class="ggold gbig">' + usd(P.main.pot) + '</b></button><div class="gnote">' + esc(P.main.parts.map((x) => x.name + ' ' + usd(x.entries)).join(' + ') + (P.main.take ? ' · take ' + usd(P.main.take) : '') + (P.main.shares.length > 1 ? ' · split ' + P.main.shares.map((x) => x.pct).join('/') : '')) + '</div>';
    if (sides.length) h += '<button class="gkvb gtopb" data-a="pot" data-w="side"><span class="gmut">Side pots ›</span><b class="gbig2">' + usd(P.sideTotal) + '</b></button><div class="gnote">' + esc(sides.map((x) => x.name).join(', ')) + ', paid separately</div>';
    h += '</div>';
    h += Date.now() < gr.joinUntil ? '<div class="g2"><button class="gpri" data-a="invite">Invite people</button><button class="gsec" data-a="members">Members ›</button></div>' : '<button class="gsec gfull" data-a="members">Members ›</button>';
    if (comm && !gr.started) h += '<button class="gsec gfull" data-a="gedit">Group settings</button>';
    h += '<p class="gnote">' + HUBNOTE + '</p>';
    return h;
  }
  // ---------- join preview ----------
  function joinV() {
    const s = stack[stack.length - 1], gr = s.pre;
    let h = '<h1>Join a group</h1><label class="glab">Invite code<input id="gcode" class="gin gcodein" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="ABCD-1234" value="' + esc(s.code || '') + '"></label><button class="gpri gfull" data-a="preview">Look it up</button>';
    if (gr) {
      h += '<div class="gcard"><b class="gname">' + esc(gr.name) + '</b><div class="gmeta">' + gr.count + ' member' + (gr.count === 1 ? '' : 's') + ' · up to ' + gr.join.max + ' · ' + esc(gr.takeText) + '</div></div>';
      picks(gr).forEach((c) => { h += '<div class="gcard"><div class="grow"><b>' + esc(c.name) + '</b>' + potBadge(c) + '</div>' + rulesList(c, gr) + '</div>'; });
      gr.contests.filter((c) => c.kind !== 'picks').forEach((c) => { h += '<div class="gcard"><div class="grow"><b>' + esc(c.name) + '</b>' + potBadge(c) + '</div><div class="gmut">' + esc(c.kind === 'calcutta' ? 'Calcutta' : c.type) + '</div></div>'; });
      h += '<div class="gnote">' + MONEYLINE + '</div>';
      if (gr.role === 'none') h += '<button class="gpri gfull" data-a="dojoin">Join ' + esc(gr.name) + '</button><div class="gnote">Your invite lets you in directly. Side pots are opt-in after you join.</div>';
      else h += '<button class="gsec gfull" data-a="hub" data-id="' + att(gr.id) + '">You are in this group. Open it ›</button>';
    }
    return h;
  }
  // ---------- create / add / edit ----------
  function draftFrom(c, gr, mode) {
    const r = c ? c.rules : null;
    return Object.assign({ mode, gid: gr ? gr.id : null, cid: c ? c.cid : null, gname: gr ? gr.name : '', locked: !!(gr && gr.engaged && mode === 'edit') },
      c ? { name: c.name, sport: c.sport, fmt: c.fmt, startMode: 'date', startDate: c.startDay, runs: c.runs, endDay: c.endDay, kalshi: r.kalshi, honor: r.honor, types: Object.assign({}, r.types), legs: r.legs || 3, metric: r.metric, minBets: r.minBets, minPaid: r.minPaid, cap: r.cap, entry: r.entry, split: r.split, pot: c.pot, takeKind: c.pot === 'side' ? r.take.kind : gr.money.take.kind, takeV: c.pot === 'side' ? r.take.v : gr.money.take.v, msplit: 'even', join: Object.assign({}, gr.join) }
        : { name: mode === 'group' ? 'Picks standings' : '', sport: 'all', fmt: 'standings', startMode: 'weekend', startDate: '', runs: 'season', endDay: '', kalshi: false, honor: false, types: { sp: true, ml: true, ou: true, prop: false, parlay: true }, legs: 3, metric: 'win', minBets: 3, minPaid: null, cap: 100, entry: 0, split: '60/30/10', pot: mode === 'add' && gr && gr.engaged ? 'side' : 'main', takeKind: 'none', takeV: 0, msplit: '50/50', join: { requests: true, open: false, max: 8, late: 'no' } });
  }
  function games() { const o = []; try { if (typeof ALL !== 'undefined') Object.values(ALL).forEach((x) => o.push(x)); } catch (e) {} try { if (typeof XL !== 'undefined') Object.values(XL).forEach((x) => o.push(x)); } catch (e) {} return o.filter((x) => x && Number.isFinite(x.start)); }
  function startOf(d) { // the contest's start = the first kickoff this phone knows on/after the chosen moment, else a fixed time; rules lock then
    const now = Date.now(), td = chiDay(now), k = (from) => games().map((x) => x.start).filter((t) => t >= from && t > now + 120e3).sort((a, b) => a - b)[0];
    let from, fb;
    if (d.startMode === 'next') { from = now; fb = now + 15 * 6e4; }
    else if (d.startMode === 'weekend') { const w = wd(td), sat = w === 6 || w === 0 ? td : addDays(td, 6 - w); from = Math.max(now, chiStart(sat)); fb = Math.max(now + 15 * 6e4, chiStart(sat) + 12 * 36e5); }
    else if (d.startMode === 'nextweek') { const w = wd(td), tue = addDays(td, ((2 - w + 7) % 7) || 7); from = chiStart(tue); fb = chiStart(addDays(tue, 2)) + 19 * 36e5; }
    else { if (!/^\d{4}-\d{2}-\d{2}$/.test(d.startDate || '')) return null; from = Math.max(now, chiStart(d.startDate)); fb = Math.max(now + 15 * 6e4, chiStart(d.startDate)); const t = k(from); return t && chiDay(t) === d.startDate ? t : fb; }
    return k(from) || fb;
  }
  const minPaidOf = (d) => (d.minPaid == null ? (d.runs === 'weekend' || d.runs === 'w1' ? 3 : 10) : d.minPaid);
  function create1() {
    const d = DR, st = startOf(d), L = d.locked;
    const F = [['standings', 'Standings', 'Everyone on one leaderboard. Most winnings at the end takes the pot.'], ['h2h', 'Head-to-head', 'A new opponent every week, like fantasy. Win-loss record, then playoffs.'], ['bank', 'Bankroll challenge', 'Everyone starts with the same bankroll. Go broke and you are out.'], ['surv', 'Survivor', 'One winning bet a week keeps you alive. Last one standing wins.'], ['best5', 'Best five', 'Bet as much as you like. Only your five best results each week count.']];
    let h = '<div class="grow"><h1>' + (d.mode === 'edit' ? 'Edit the contest' : d.mode === 'add' ? 'Add a picks contest' : 'Create a group') + '</h1><span class="gmut">Step 1 of 2</span></div>';
    if (d.mode === 'group') h += '<label class="glab">Group name<input id="gname" class="gin" maxlength="30" placeholder="Sunday Crew" value="' + esc(d.gname) + '"></label>';
    h += '<label class="glab">Contest name<input id="gcname" class="gin" maxlength="30" placeholder="Picks standings" value="' + esc(d.name) + '"></label>';
    h += '<label class="glab">Sport' + sel('gsport', SPORTS, d.sport, L) + '</label><div class="gnote">These groups are for all games. ' + WEEKS + '</div>';
    h += '<div class="glab">How the contest competes</div>';
    F.forEach(([k, t, x]) => { const soon = k === 'h2h' || k === 'bank' || k === 'surv'; h += '<button class="gopt' + (d.fmt === k ? ' on' : '') + (soon ? ' soon' : '') + '" ' + (soon || L ? 'disabled aria-disabled="true"' : 'data-fmt="' + k + '"') + '><span class="grow"><b>' + t + '</b><small>' + (soon ? 'Coming soon' : d.fmt === k ? 'Selected' : '') + '</small></span><span class="gmut">' + x + '</span></button>'; });
    h += '<div class="g2"><label class="glab">Starts' + sel('gstart', [['next', 'Next kickoff'], ['weekend', 'This weekend'], ['nextweek', 'Next week'], ['date', 'Pick a date']], d.startMode) + '</label><label class="glab">Runs for' + sel('gruns', Object.keys(RUNS).map((k) => [k, k === 'custom' ? 'Pick a date' : RUNS[k]]), d.runs) + '</label></div>';
    if (d.startMode === 'date') h += '<label class="glab">Start date<input id="gsd" class="gin" type="date" value="' + esc(d.startDate) + '"></label>';
    if (d.runs === 'custom') h += '<label class="glab">Last day<input id="ged" class="gin" type="date" value="' + esc(d.endDay) + '"></label>';
    h += '<div class="gnote">' + (st ? 'Starts ' + esc(fmtTime(st)) + '. Rules lock then.' : 'Pick a start date.') + '</div>';
    return h + '<button class="gpri gfull" data-a="next">Next: rules and prizes</button>';
  }
  function create2() {
    const d = DR, L = d.locked, gr = curGroup(), maxM = d.mode === 'group' ? d.join.max : gr ? gr.join.max : 8, potE = (Number(d.entry) || 0) * maxM;
    const tk = d.takeKind === 'pct' ? Math.round(potE * (Number(d.takeV) || 0)) / 100 : d.takeKind === 'flat' ? Math.min(Number(d.takeV) || 0, potE) : 0;
    const mainCount = gr ? gr.contests.filter((c) => c.pot === 'main' && c.cid !== d.cid).length : 0, showTake = d.mode === 'group' || d.pot === 'side';
    let h = '<div class="grow"><h1>Rules and prizes</h1><span class="gmut">Step 2 of 2</span></div>';
    if (L) h += '<div class="gwarn glocked"><b>🔒 Money and bet rules are locked</b>People have already joined or asked to join, so the entry, take, splits, cap, ranking and bet rules can\'t change. You can still change the name and dates until the contest starts.</div>';
    h += '<div class="gcard"><h2>Which bets count</h2>' + seg([['0', 'Any bet in My Bets'], ['1', 'Kalshi-synced bets only']], d.kalshi ? '1' : '0', 'data-ver', L);
    h += '<div class="gnote">' + GRADED + '</div>';
    TYPES.forEach(([k, l]) => { h += '<div class="gline"><span>' + (k === 'parlay' ? 'Parlays, up to ' + d.legs + ' legs' : l) + '</span>' + sw(d.types[k], 'data-type="' + k + '"', L) + '</div>'; });
    if (d.types.parlay) h += '<label class="glab">Most legs in a parlay' + sel('glegs', [2, 3, 4, 5, 6, 8, 10].map((n) => [n, n + ' legs']), d.legs, L) + '</label>';
    h += '<div class="gline"><span>Count bets the app can\'t check (honor system)<small>Props, cash-outs and games Oddable can\'t match are counted on the member\'s word. Off by default.</small></span>' + sw(d.honor, 'data-honor="1"', L) + '</div></div>';
    h += '<div class="gcard"><h2>How the winner is decided</h2><div class="gseg g2w">' + Object.keys(METRIC).map((k) => '<button class="' + (d.metric === k ? 'on' : '') + '" ' + (L ? 'disabled ' : '') + 'data-metric="' + k + '">' + METRIC[k] + '</button>').join('') + '</div>';
    h += '<div class="g2"><label class="glab">Least bets a week' + sel('gmin', [[0, 'No minimum'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], d.minBets, L) + '</label><label class="glab">Most a bet can count' + sel('gcap', [[0, 'No cap'], [10, '$10'], [25, '$25'], [50, '$50'], [100, '$100'], [250, '$250'], [500, '$500']], d.cap, L) + '</label></div>';
    h += '<label class="glab">Fewest bets to place in a paid spot' + sel('gminp', MINPAID.map((n) => [n, n ? n + ' settled bets' : 'No minimum']), minPaidOf(d), L) + '</label>';
    h += '<div class="gnote">Fewer = ranked below everyone who meets it, so one lucky bet can\'t win. Ties go to the better return %; still tied = the prize money is split evenly. ' + WEEKS + '</div></div>';
    h += '<div class="gcard"><h2>Entry and payout</h2>';
    if (d.mode === 'add') h += seg([['main', 'Main pot'], ['side', 'Side pot']], d.pot, 'data-pot', gr && gr.engaged) + '<div class="gnote">' + (gr && gr.engaged ? 'The main pot is locked because people have joined: new contests are side pots (members opt in).' : 'Main pot: everyone is in and the entry joins the main pot. Side pot: members opt in, its own entry and take, paid separately.') + '</div>';
    h += '<div class="g2"><label class="glab">Entry per member<input id="gentry" class="gin" type="number" inputmode="numeric" min="0" max="10000" step="1" placeholder="0" value="' + esc(d.entry || '') + '"' + (L ? ' disabled' : '') + '></label><label class="glab">Payout split' + sel('gsplit', Object.keys(SPLITN).map((k) => [k, SPLITN[k]]), d.split, L) + '</label></div>';
    if (showTake) {
      const tsel = d.takeKind === 'none' ? 'none' : d.takeKind === 'flat' ? 'flat' : [5, 10, 15, 20, 25].includes(Number(d.takeV)) ? 'p' + d.takeV : 'pc';
      h += '<label class="glab">Commissioner\'s take' + (d.mode === 'group' ? ' (off the main pot)' : '') + sel('gtake', [['none', 'None'], ['p5', '5% of the pot'], ['p10', '10% of the pot'], ['p15', '15% of the pot'], ['p20', '20% of the pot'], ['p25', '25% of the pot'], ['pc', 'Other percent'], ['flat', 'Flat amount']], tsel, L) + '</label>';
      if (tsel === 'pc') h += '<label class="glab">Percent of the pot (0 to 50)<input id="gtv" class="gin" type="number" inputmode="numeric" min="0" max="50" step="1" value="' + esc(d.takeV) + '"' + (L ? ' disabled' : '') + '></label>';
      if (tsel === 'flat') h += '<label class="glab">Flat amount ($)<input id="gtv" class="gin" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(d.takeV) + '"' + (L ? ' disabled' : '') + '></label>';
      h += '<div class="gnote">Members see this before they join. If all ' + maxM + ' spots fill and pay: pot ' + usd(potE) + ', take ' + usd(tk) + ', prize pool ' + usd(potE - tk) + '.</div>';
    } else if (gr) h += '<div class="gnote">' + esc(gr.takeText) + ' (main pot, set for the whole group).</div>';
    if (d.mode === 'add' && d.pot === 'main' && mainCount === 1) h += '<label class="glab">Split the main pot (first contest / this one)' + sel('gms', [['50/50', '50 / 50'], ['40/60', '40 / 60'], ['60/40', '60 / 40']], d.msplit) + '</label>';
    if (d.mode === 'add' && d.pot === 'main' && mainCount > 1) h += '<div class="gnote">The main pot is split evenly between its contests.</div>';
    h += '<div class="gline gdis"><span>Weekly high-score prize<small>Coming soon. The weekly high score is shown, no prize yet.</small></span>' + sw(false, '', true) + '</div><div class="gnote">' + MONEYLINE + '</div></div>';
    if (d.mode === 'group') h += joinCard(d);
    h += '<div class="gwarn"><b>Rules lock at the first kickoff</b>After this contest\'s first game starts nobody can change its rules, the commissioner included. Money rules also lock as soon as anyone joins or asks to join.</div>';
    return h + '<button class="gpri gfull" data-a="submit">' + (d.mode === 'edit' ? 'Save' : d.mode === 'add' ? 'Add contest' : 'Create group') + '</button>';
  }
  function joinCard(d, dis) {
    const cap = (LIMS && LIMS.max) || 8, opts = [2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 5000].filter((n) => n <= cap);
    let h = '<div class="gcard"><h2>Who can join</h2><div class="gline"><span>Let people ask to join<small>You approve or deny each request.</small></span>' + sw(d.join.requests, 'data-j="requests"') + '</div>';
    h += '<div class="gline"><span>Show in Open groups<small>Off means invite link or code only.</small></span>' + sw(d.join.open, 'data-j="open"') + '</div>';
    h += '<div class="g2"><label class="glab">Most people' + sel('gmax', opts.map((n) => [n, n]), Math.min(d.join.max, cap), dis) + '</label><label class="glab">Joining after start' + sel('glate', [['no', 'Not allowed'], ['2w', 'First 2 weeks']], d.join.late) + '</label></div>';
    if (!(LIMS && LIMS.enterprise)) h += '<div class="gnote">' + esc((LIMS && LIMS.capText) || 'Up to 8 people. Need more? Ask about Oddable for clubs and courses.') + '</div><button class="glink" data-a="contact">Need more than 8? Contact Oddable ›</button>';
    return h + '</div>';
  }
  function geditV() { const d = DR; let h = '<h1>Group settings</h1><label class="glab">Group name<input id="gname" class="gin" maxlength="30" value="' + esc(d.gname) + '"></label>' + joinCard(d, d.locked); if (d.locked) h += '<div class="gnote">🔒 The size and money rules are locked: people have joined or asked to join.</div>'; return h + '<button class="gpri gfull" data-a="gsave">Save</button>'; }
  function readDraft() {
    const v = (id) => { const e = document.getElementById(id); return e && !e.disabled ? e.value : null; }, d = DR; if (!d) return;
    if (v('gname') !== null) d.gname = v('gname'); if (v('gcname') !== null) d.name = v('gcname'); if (v('gsport') !== null) d.sport = v('gsport'); if (v('gstart') !== null) d.startMode = v('gstart'); if (v('gruns') !== null) d.runs = v('gruns'); if (v('gsd') !== null) d.startDate = v('gsd'); if (v('ged') !== null) d.endDay = v('ged');
    if (v('glegs') !== null) d.legs = +v('glegs'); if (v('gmin') !== null) d.minBets = +v('gmin'); if (v('gminp') !== null) d.minPaid = +v('gminp'); if (v('gcap') !== null) d.cap = +v('gcap'); if (v('gentry') !== null) d.entry = v('gentry'); if (v('gsplit') !== null) d.split = v('gsplit'); if (v('gms') !== null) d.msplit = v('gms');
    if (v('gtv') !== null) d.takeV = v('gtv');
    if (v('gtake') !== null) { const t = v('gtake'); if (t === 'none') d.takeKind = 'none'; else if (t === 'flat') { if (d.takeKind !== 'flat') d.takeV = ''; d.takeKind = 'flat'; } else if (t === 'pc') { if (d.takeKind !== 'pct' || [5, 10, 15, 20, 25].includes(Number(d.takeV))) d.takeV = ''; d.takeKind = 'pct'; } else { d.takeKind = 'pct'; d.takeV = +t.slice(1); } }
    if (v('gmax') !== null) d.join.max = +v('gmax'); if (v('glate') !== null) d.join.late = v('glate');
  }
  const takeOf = (d) => ({ kind: d.takeKind, v: d.takeKind === 'none' ? 0 : Number(d.takeV) });
  function contestPayload() { const d = DR; return { cname: d.name.trim() || 'Picks standings', sport: d.sport, fmt: d.fmt, start: startOf(d), runs: d.runs, endDay: d.endDay, kalshi: d.kalshi, honor: d.honor, types: d.types, legs: d.legs, metric: d.metric, minBets: d.minBets, minPaid: minPaidOf(d), cap: d.cap, entry: d.entry === '' ? 0 : Number(d.entry), split: d.split, pot: d.pot, take: d.pot === 'side' ? takeOf(d) : undefined }; }
  // ---- rules list (one contest) ----
  function rulesList(c, gr) {
    const r = c.rules, rows = [
      ['Sport', SPORT[c.sport]], ['Format', FMT[c.fmt]], ['Dates', fmtDay(c.startDay) + ' to ' + fmtDay(c.endDay) + ' · ' + RUNS[c.runs] + '. ' + WEEKS], ['Starts', fmtTime(c.start) + ' (rules lock then)'],
      ['Bets that count', (r.kalshi ? 'Kalshi-synced bets only' : 'Any bet in My Bets') + ': ' + TYPES.filter(([k]) => r.types[k]).map(([k, l]) => (k === 'parlay' ? 'parlays up to ' + r.legs + ' legs' : l.replace(/ \(.*/, '').toLowerCase())).join(', ')],
      ['Results', 'Graded by Oddable from final scores, at the bet\'s side, line, odds and stake at kickoff. Bets first synced after their game started never count.'],
      ["Bets the app can't check", r.honor ? 'Counted on the member\'s word (honor system)' : 'Don\'t count'],
      ['Winner decided by', METRIC[r.metric] + ', ties to the better return %, then the prize is split'], ['Least bets a week', r.minBets ? r.minBets + ' (fewer = flagged, that week cannot win the high score)' : 'No minimum'],
      ['Fewest bets to place in a paid spot', r.minPaid ? r.minPaid + ' settled bets' : 'No minimum'], ['Most a bet can count', r.cap ? usd(r.cap) : 'No cap'],
      ['Pot', c.pot === 'side' ? 'Side pot: members opt in, paid separately' : 'Main pot'], ['Entry per member', r.entry ? usd(r.entry) : 'No entry'], ['Payout split', SPLITN[r.split]], ["Commissioner's take", c.pot === 'side' ? c.takeText : gr ? gr.takeText + ' (main pot)' : ''],
    ];
    if (gr && gr.join) rows.push(['Joining', (gr.join.requests ? 'Can ask to join' : 'Invite only') + (gr.join.open ? ', shown in Open groups' : '') + ' · up to ' + gr.join.max + ' people · after start: ' + (gr.join.late === '2w' ? 'first 2 weeks' : 'not allowed')]);
    return '<div class="grules">' + rows.map(([k, v]) => '<div><small>' + esc(k) + '</small><span>' + esc(v) + '</span></div>').join('') + '</div>';
  }
  function rulesV() {
    const s = stack[stack.length - 1], gr = s.gr; if (!gr) return '<div class="gcard">Loading…</div>';
    const cs = s.cid ? [cof(gr, s.cid)].filter(Boolean) : picks(gr);
    let h = '<h1>' + esc(gr.name) + '</h1>';
    cs.forEach((c) => {
      h += '<div class="grow"><h2>' + esc(c.name) + '</h2>' + potBadge(c) + '</div><div class="gwarn' + (c.locked ? ' glocked' : '') + '"><b>' + (c.locked ? '🔒 Rules locked' : 'Rules lock at the first kickoff') + '</b>' + (c.locked ? 'Locked at ' + esc(fmtTime(c.start)) + '. Nobody can change them, the commissioner included.' : 'They lock ' + esc(fmtTime(c.start)) + '.' + (gr.engaged ? ' Money and bet rules are already locked: people have joined.' : '')) + '</div>' + rulesList(c, gr);
      if (gr.role === 'comm' && !c.locked) h += '<button class="gsec gfull" data-a="edit" data-cid="' + att(c.cid) + '">Edit this contest</button>';
    });
    h += '<div class="gnote">' + MONEYLINE + '</div>';
    if (gr.role === 'none' && gr.join && gr.join.requests && !gr.started) h += '<button class="gpri gfull" data-a="request" data-id="' + att(gr.id) + '">Request to join</button>';
    if (gr.role === 'pending') h += '<div class="gcard gdash gmut">Request sent. Waiting for the commissioner.</div>';
    return h;
  }
  // ---- members / requests / paid ----
  function membersV() {
    const s = stack[stack.length - 1], gr = s.gr; if (!gr) return '<div class="gcard">Loading…</div>';
    const comm = gr.role === 'comm', you = gr.me, mainE = gr.pots.main.entry;
    let h = '<div class="grow"><h1>Members</h1>' + (comm ? '<span class="gbadge">Commissioner</span>' : '') + '</div><div class="gcard">';
    if (comm) h += '<div class="gline"><span><b>Accepting join requests</b><small>' + gr.count + ' of ' + gr.join.max + ' spots filled. ' + (gr.started ? 'The group has started, this cannot change now.' : 'Closes at the first kickoff.') + '</small></span>' + sw(gr.join.requests, 'data-a="reqtoggle"', gr.started) + '</div>';
    else h += '<div class="gmut">' + gr.count + ' of ' + gr.join.max + ' spots filled.</div>';
    if (!gr.started || gr.join.late === '2w') h += '<button class="gpri gfull" data-a="invite">Invite people</button><div class="gcode"><span><small>Invite code</small><b>' + esc(gr.code) + '</b></span><button class="gsec" data-a="copy">Copy code</button></div>';
    if (comm && gr.count >= gr.join.max && !(LIMS && LIMS.enterprise)) h += '<div class="gnote gyel">' + esc(ENT()) + '</div><button class="glink" data-a="contact">Contact Oddable ›</button>';
    h += '</div>';
    if (comm) {
      const q = gr.reqs || [], closed = Date.now() >= gr.joinUntil; h += '<h3 class="gh">Waiting for you · ' + q.length + '</h3>';
      if (!q.length) h += '<div class="gcard gmut">No requests right now.</div>';
      q.forEach((x) => { const days = Math.floor((Date.now() - x.at) / 864e5); h += '<div class="gcard"><div class="grow"><b class="gname">' + esc(x.name) + '</b><span class="gmut">Asked ' + (days <= 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago') + '</span></div>';
        h += '<div class="gnote">' + (x.ver ? 'Kalshi connected' : x.noBets ? 'No synced bets yet.' : 'Logs bets in My Bets (no Kalshi).') + '</div>';
        h += closed ? '<div class="gnote gyel">Joining closed ' + (gr.join.late === '2w' ? '2 weeks after the start' : 'at the first kickoff') + ', so this request can only be removed.</div><button class="gsec gfull" data-a="deny" data-pid="' + att(x.pid) + '">Remove request</button></div>'
          : '<div class="g2"><button class="gpri" data-a="approve" data-pid="' + att(x.pid) + '">Approve</button><button class="gsec" data-a="deny" data-pid="' + att(x.pid) + '">Deny</button></div></div>'; });
    }
    h += '<h3 class="gh">In the group · ' + gr.members.length + '</h3><div class="gcard glist">';
    gr.members.forEach((m) => { h += '<div class="gmrow"><span>' + esc(m.name) + (m.pid === you ? ' <i class="gmut">· you</i>' : '') + (m.comm ? ' <i class="gmut">· commissioner</i>' : '') + (m.noBets ? '<small>No synced bets: sign in with your phone number to count bets</small>' : '') + '</span>' + (mainE ? paidCtl(m.paid, comm, m.pid, '') : '') + '</div>'; });
    h += '</div>';
    (gr.contests || []).filter((c) => c.pot === 'side').forEach((c) => {
      const ins = gr.members.filter((m) => m.sides.some((x) => x.cid === c.cid)); h += '<h3 class="gh">Side pot · ' + esc(c.name) + ' · ' + ins.length + '</h3><div class="gcard glist">';
      if (!ins.length) h += '<div class="gmut">Nobody yet.</div>';
      ins.forEach((m) => { const sp = m.sides.find((x) => x.cid === c.cid); h += '<div class="gmrow"><span>' + esc(m.name) + '</span>' + (c.rules.entry ? paidCtl(sp.paid, comm, m.pid, c.cid) : '') + '</div>'; });
      h += '</div>';
    });
    if (mainE) h += '<div class="gnote">' + MONEYLINE + '</div>';
    h += '<button class="gsec gfull" data-a="rules">Rules ›</button>';
    if (!gr.started && comm) h += '<button class="gdanger gfull" data-a="delete">Delete group</button>';
    if (!gr.started && !comm) h += '<button class="gdanger gfull" data-a="leave">Leave group</button>';
    return h;
  }
  const paidCtl = (paid, comm, pid, cid) => (paid ? '<span class="gmut">Entry paid' + (comm ? ' <button class="gtiny" data-a="unpaid" data-pid="' + att(pid) + '" data-cid="' + att(cid) + '">Undo</button>' : '') + '</span>' : comm ? '<button class="gowed" data-a="paid" data-pid="' + att(pid) + '" data-cid="' + att(cid) + '">Entry owed · Mark paid</button>' : '<span class="gyel">Entry owed</span>');
  // ---- contest standings ----
  function standV() {
    const s = stack[stack.length - 1], d = s.data; if (!d) return '<div class="gcard">Loading standings…</div>';
    const gr = d.group, c = d.contest, r = c.rules, me = d.rows.find((x) => x.pid === gr.me), leader = d.rows[0];
    let h = '<div class="grow"><h1>' + esc(c.name) + '</h1>' + potBadge(c) + '</div><button class="glink" data-a="rules" data-cid="' + att(c.cid) + '">' + esc(SPORT[c.sport] + ' · ' + (c.fmt === 'best5' ? 'best five' : 'standings') + ' · ' + scopeTxt(r) + ' · ' + (c.locked ? 'rules locked' : 'rules lock ' + fmtTime(c.start))) + ' ›</button>';
    h += '<div class="gseg g3s">' + [['week', 'This week'], ['season', 'Season'], ['prizes', 'Prizes']].map(([k, l]) => '<button class="' + (s.tab === k ? 'on' : '') + '" data-tab="' + k + '">' + l + '</button>').join('') + '</div>';
    if (!c.started) h += '<div class="gwarn"><b>' + esc(startsTxt(c.start)) + '</b>The contest starts ' + esc(fmtTime(c.start)) + '. Standings fill in once games are played.</div>';
    if (s.tab === 'prizes') return h + prizesBody(d);
    if (s.tab === 'week') h += '<label class="glab">Week' + sel('gweek', Array.from({ length: d.lastW }, (_, i) => [i + 1, 'Week ' + (i + 1) + (i + 1 === d.curW ? ' (this week)' : '')]), d.week) + '</label><div class="gnote">' + esc(fmtDay(d.weekDays[0]) + ' to ' + fmtDay(d.weekDays[1]) + '. ' + WEEKS) + '</div>';
    const behind = me && leader && me !== leader ? (r.metric === 'win' ? usd(leader.t.win - me.t.win) : r.metric === 'units' ? Math.round((leader.t.units - me.t.units) * 100) / 100 + 'u' : r.metric === 'ret' ? Math.round(((leader.t.ret || 0) - (me.t.ret || 0)) * 10) / 10 + ' pts' : Math.round(((leader.t.pct || 0) - (me.t.pct || 0)) * 10) / 10 + ' pts') + ' behind 1st' : me ? 'Leading' : '';
    const share = c.pot === 'side' ? (d.pots.sides.find((x) => x.cid === c.cid) || {}).pool : (d.pots.main.shares.find((x) => x.cid === c.cid) || {}).amt;
    h += '<div class="g2">' + (me && c.started ? tile('Your place', (me.tied ? 'T' : '') + ord(me.place) + ' of ' + d.rows.length, '', 'data-a="player" data-pid="' + att(me.pid) + '"', esc(behind)) : '') + tile('Prizes', usd(share || 0), 'ggold', 'data-tab="prizes"', d.prizes.length ? d.prizes.map((p) => ord(p.place) + ' ' + usd(p.amt)).join(' · ') : 'Bragging rights only') + '</div>';
    h += '<div class="gthead"><span>#</span><span>Player</span><span class="gr">Record</span><span class="gr">' + MCOL[r.metric] + '</span></div>';
    d.rows.forEach((x) => {
      const t = x.t, sub = x.under && c.started ? '<small class="gyel">' + t.settled + ' of ' + r.minPaid + ' bets to place in a paid spot</small>' : t.short ? '<small class="gyel">Only ' + t.weekBets + ' bet' + (t.weekBets === 1 ? '' : 's') + ' this week, needs ' + r.minBets + '</small>' : '<small>' + (r.metric === 'ret' ? 'Win % ' + (t.pct == null ? '–' : t.pct + '%') : 'Return ' + (t.ret == null ? '–' : (t.ret > 0 ? '+' : '') + t.ret + '%')) + (t.streak ? ' · ' + (t.streak[0] === 'W' ? 'won ' : 'lost ') + (t.streak.slice(1) === '1' ? 'last' : t.streak.slice(1) + ' straight') : '') + (t.open ? ' · ' + t.open + ' open' : '') + (x.noBets ? ' · no synced bets' : '') + '</small>';
      h += '<button class="gtrow' + (x.pid === gr.me ? ' me' : '') + '" data-a="player" data-pid="' + att(x.pid) + '"><span class="gpl' + (x.place === 1 && (t.w + t.l) ? ' ggold' : '') + '">' + placeTxt(x) + '</span><span class="gpn"><b>' + esc(x.name) + (x.pid === gr.me ? ' · you' : '') + '</b>' + sub + '</span><span class="gr">' + rec(t) + '</span><span class="gr gv ' + vcls(t, r.metric) + '">' + val(t, r.metric) + '</span></button>';
    });
    const hs = (d.high || []).filter((x) => x.done).slice(-1)[0];
    if (hs && s.tab === 'season') h += '<button class="gcard gbtn" data-a="player" data-pid="' + att(hs.pid) + '" data-week="' + hs.week + '"><small class="gmut">Week ' + hs.week + ' high score ›</small><div>' + esc(hs.name) + ', ' + (r.metric === 'units' || r.metric === 'pct' ? (hs.val > 0 ? '+' : '') + hs.val + 'u' : usd(hs.val, true)) + ' on ' + hs.n + ' bet' + (hs.n === 1 ? '' : 's') + '</div></button>';
    h += '<div class="gnote">Tap a player to see every bet behind the number. ' + GRADED + (r.cap ? ' Bets over the ' + usd(r.cap) + ' cap count as ' + usd(r.cap) + '.' : '') + (c.fmt === 'best5' ? ' Only each player\'s five best results each week count.' : '') + ' Other players\' bets show once their last game kicks off; open bets show as a count.</div>';
    return h;
  }
  function prizesBody(d) {
    const c = d.contest, final = c.ended, owed = d.rows.filter((x) => x.owed > 0);
    let h = '<div class="gcard"><h2>' + (final ? 'Who is owed what (final)' : 'Who is owed what if it ended now') + '</h2>';
    if (!d.prizes.length) h += '<div class="gmut">Bragging rights only. No prizes.</div>';
    d.prizes.forEach((p) => { h += '<div class="gkv"><span>' + ord(p.place) + ' · ' + p.pct + '%</span><b>' + usd(p.amt) + '</b></div>'; });
    if (owed.length) h += '<h2 class="gh2">Owed now</h2>' + owed.map((x) => '<button class="gkv gkvb2" data-a="player" data-pid="' + att(x.pid) + '"><span>' + placeTxt(x) + ' · ' + esc(x.name) + (x.tied ? '<small>tied: the places\' money is split evenly</small>' : '') + '</span><b class="ggold">' + usd(x.owed) + ' ›</b></button>').join('');
    if (c.rules.minPaid) h += '<div class="gnote">Only members with at least ' + c.rules.minPaid + ' settled bets can place in a paid spot.</div>';
    h += '</div><button class="gsec gfull" data-a="pot" data-w="' + (c.pot === 'side' ? 'side' : 'main') + '">' + (c.pot === 'side' ? 'Side pots ›' : 'Main pot ›') + '</button><div class="gnote">' + MONEYLINE + '</div>';
    return h;
  }
  // ---- pots ----
  function potV() {
    const s = stack[stack.length - 1], gr = s.gr || curGroup(); if (!gr) return '<div class="gcard">Loading…</div>'; const P = gr.pots;
    let h = '<h1>' + (s.w === 'side' ? 'Side pots' : 'Main pot') + '</h1><div class="gmeta">' + esc(gr.name) + '</div>';
    if (s.w !== 'side') {
      const m = P.main; h += '<div class="gcard">';
      m.parts.forEach((x) => { h += '<button class="gkv gkvb2" data-a="open" data-cid="' + att(x.cid) + '"><span>' + esc(x.name) + '<small>' + m.paid + ' paid × ' + usd(x.entry) + '</small></span><b>' + usd(x.entries) + ' ›</b></button>'; });
      h += '<div class="gkv"><span>Entries marked paid<small>' + m.paid + ' of ' + m.members + ' members</small></span><b>' + usd(m.pot) + '</b></div><div class="gkv"><span>Expected (every member pays)</span><b>' + usd(m.expected) + '</b></div>';
      h += '<div class="gkv"><span>Commissioner\'s take<small>' + esc(m.takeText) + '</small></span><b>' + (m.take ? '-' + usd(m.take) : '$0') + '</b></div><div class="gkv gtot"><span>Prize pool</span><b class="ggold">' + usd(m.pool) + '</b></div></div>';
      h += '<h3 class="gh">How it is split</h3>';
      m.shares.forEach((x) => { h += '<button class="gcard gbtn" data-a="prizes" data-cid="' + att(x.cid) + '"><div class="gkv"><span><b>' + esc(x.name) + '</b><small>' + x.pct + '% of the prize pool · ' + esc(SPLITN[x.split]) + '</small></span><b class="ggold">' + usd(x.amt) + ' ›</b></div>' + x.places.map((p) => '<div class="gkv"><span>' + ord(p.place) + '</span><b>' + usd(p.amt) + '</b></div>').join('') + '</button>'; });
    } else {
      if (!P.sides.length) h += '<div class="gcard gmut">No side pots.</div>';
      P.sides.forEach((x) => { h += '<button class="gcard gbtn" data-a="prizes" data-cid="' + att(x.cid) + '"><div class="gkv"><span><b>' + esc(x.name) + '</b><small>' + x.paid + ' of ' + x.members + ' paid × ' + usd(x.entry) + ' · ' + esc(x.takeText) + '</small></span><b class="ggold">' + usd(x.pot) + ' ›</b></div><div class="gkv"><span>Prize pool</span><b>' + usd(x.pool) + '</b></div>' + x.places.map((p) => '<div class="gkv"><span>' + ord(p.place) + '</span><b>' + usd(p.amt) + '</b></div>').join('') + '</button>'; });
    }
    return h + '<div class="gnote">' + MONEYLINE + ' Only entries the commissioner marked paid are in a pot.</div>';
  }
  // ---- one player's bets ----
  function playerV() {
    const s = stack[stack.length - 1], d = s.data; if (!d) return '<div class="gcard">Loading bets…</div>';
    const gr = curGroup() || {}, c = cof(gr, s.cid) || { rules: { metric: 'win' } }, r = c.rules, t = d.t, f = s.f || 'all';
    let h = '<h1>' + esc(d.name) + (d.me ? ' · you' : '') + '</h1><div class="gmeta">' + esc(c.name || '') + ' · ' + (d.scope === 'week' ? 'Week ' + d.week : 'Whole contest') + (c.fmt === 'best5' ? ' · ★ = one of the five that count that week' : '') + '</div>';
    h += '<div class="gseg">' + [['season', 'Season'], ['week', 'Week ' + d.week]].map(([k, l]) => '<button class="' + (d.scope === k ? 'on' : '') + '" data-pscope="' + k + '">' + l + '</button>').join('') + '</div>';
    h += '<div class="g2">' + tile('Record', rec(t), '', 'data-f="settled"') + tile(MCOL[r.metric], val(t, r.metric), vcls(t, r.metric), 'data-f="settled"') + tile('Won', String(t.w), 'gpos', 'data-f="won"') + tile('Lost', String(t.l), 'gneg', 'data-f="lost"') + tile('Open', String(t.open), '', 'data-f="open"') + tile('Counted stake', usd(t.stake), '', 'data-f="settled"', 'Return ' + (t.ret == null ? '–' : (t.ret > 0 ? '+' : '') + t.ret + '%')) + '</div>';
    if (f !== 'all') h += '<button class="glink" data-f="all">Showing ' + (f === 'settled' ? 'settled' : f) + ' bets · show all ›</button>';
    const list = d.bets.filter((b) => f === 'all' || (f === 'settled' ? b.res && b.ok : f === 'open' ? !b.res && b.ok : b.res === f && b.ok));
    if (!list.length) h += '<div class="gcard gmut">No bets here yet.</div>';
    const TN = { sp: 'Spread', ml: 'Moneyline', ou: 'Total', prop: 'Prop', parlay: 'Parlay' };
    list.forEach((b) => {
      const pill = b.res === 'won' ? '<span class="gpill gpos">Won</span>' : b.res === 'lost' ? '<span class="gpill gneg">Lost</span>' : b.res === 'push' ? '<span class="gpill">Push</span>' : '<span class="gpill">Open</span>';
      h += '<div class="gbet' + (b.ok ? '' : ' gno') + (b.res === 'won' ? ' hit' : b.res === 'lost' ? ' miss' : '') + '"><span class="gbw"><b>' + (b.best ? '★ ' : '') + esc(b.what) + '</b><small>' + esc(TN[b.type] || b.type) + ' · ' + usd(b.stake) + (b.capped ? ' (counts as ' + usd(b.cs) + ')' : '') + (b.kalshi ? ' · Kalshi' : '') + (b.gr === 'honor' ? ' · honor system' : b.gr === 'srv' ? ' · graded by Oddable' : '') + ' · Wk ' + b.wk + ' · ' + esc(b.d ? fmtDay(b.d) : '') + '</small>' + (b.ok ? '' : '<small class="gyel">Does not count: ' + esc(b.why) + '</small>') + '</span><span class="gr">' + pill + (b.res && b.ok ? '<b class="' + (b.pl > 0 ? 'gpos' : b.pl < 0 ? 'gneg' : '') + '">' + usd(b.pl, true) + '</b>' : '') + '</span></div>';
    });
    if (d.hidden) h += '<div class="gcard gdash gmut">' + d.hidden + ' bet' + (d.hidden === 1 ? ' is' : 's are') + ' hidden until ' + (d.hidden === 1 ? 'its last game kicks' : 'their last games kick') + ' off, so nobody can copy a pick.</div>';
    return h;
  }
  // ---- contact Oddable (G15) ----
  function contactV() {
    const s = stack[stack.length - 1]; if (s.sent) return '<h1>Thanks</h1><div class="gcard">We got your request. The owner will reach out to set up Oddable for your course, club or league.</div>';
    return '<h1>Oddable for clubs</h1><div class="gwarn glocked"><b>' + esc(ENT()) + '</b>Courses, clubs and leagues get a custom license with more than 8 people per game.</div>'
      + '<label class="glab">Your name<input id="kname" class="gin" maxlength="60" autocomplete="name"></label><label class="glab">Organization or course<input id="korg" class="gin" maxlength="80"></label>'
      + '<label class="glab">Phone or email<input id="kreach" class="gin" maxlength="80" autocomplete="email"></label><label class="glab">How many people<input id="kpeople" class="gin" type="number" inputmode="numeric" min="0" max="100000"></label>'
      + '<label class="glab">What do you want to run?<textarea id="kwhat" class="gin" rows="3" maxlength="400" placeholder="Saturday scramble pool, league picks, Calcutta…"></textarea></label><button class="gpri gfull" data-a="ksend">Send</button>';
  }

  // ---------- paint ----------
  const el = () => document.getElementById('ogrp');
  function paintBusy(on) { const e = el(); if (e) e.classList.toggle('gbusy', !!on); }
  function paint() {
    const e = el(); if (!e) return; const s = stack[stack.length - 1], prev = stack[stack.length - 2];
    const back = stack.length > 1 ? (prev.t === 'home' ? 'Groups' : 'Back') : '';
    const V = { home, hub: hubV, join: joinV, create1, create2, rules: rulesV, members: membersV, stand: standV, pot: potV, player: playerV, gedit: geditV, contact: contactV }[s.t];
    e.querySelector('.gin0').innerHTML = top(back) + (err ? '<div class="gerr" role="alert">' + esc(err) + '</div>' : '') + (V ? V() : '');
  }
  function push(o) { readDraft(); err = ''; stack.push(o); paint(); const e = el(); if (e) e.scrollTop = 0; }
  async function loadHome() { try { H = await post('mine', {}); err = ''; } catch (e) { err = errText(e); if (!H) H = { groups: [], open: [], pending: [] }; } if (!LIMS) post('limits', {}).then((j) => { LIMS = j; }).catch(() => {}); if (stack[stack.length - 1].t === 'home') paint(); }
  async function loadGroup(o) { try { const j = await post('get', { id: o.id }); o.gr = j.group; const hg = H && H.groups.find((x) => x.id === o.id); if (hg) o.mineC = hg.mineC; err = ''; } catch (e) { err = errText(e); } paint(); }
  async function loadStand(o) { try { o.data = await post('standings', { id: o.id, cid: o.cid, scope: o.tab === 'week' ? 'week' : 'season', week: o.week }); o.gr = o.data.group; err = ''; } catch (e) { err = errText(e); } paint(); }
  async function loadPlayer(o) { try { o.data = await post('player', { id: o.id, cid: o.cid, pid: o.pid, scope: o.scope, week: o.week }); err = ''; } catch (e) { err = errText(e); } paint(); }
  const cur = () => stack[stack.length - 1];
  const gid = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].id) return stack[i].id; return null; };
  const gcid = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].cid) return stack[i].cid; return null; };
  async function toHub(id) { stack = [{ t: 'home' }]; await loadHome(); const o = { t: 'hub', id }; push(o); loadGroup(o); }
  function openJoin(code) { if (!el()) window.oddGroups(true); stack = [{ t: 'home' }, { t: 'join', code: String(code || ''), direct: true }]; paint(); loadHome(); act('preview', { code }, async (j) => { cur().pre = j.group; paint(); }); }

  function click(ev) {
    const t = ev.target.closest('button,a,[data-a]'); if (!t || t.disabled) return; const a = t.getAttribute('data-a'), id = t.getAttribute('data-id'), pid = t.getAttribute('data-pid'), cid = t.getAttribute('data-cid');
    if (a === 'close') { readDraft(); try { sessionStorage.removeItem('ogrp-open'); } catch (x) {} el().remove(); return; }
    if (a === 'back') { readDraft(); err = ''; if (stack.length > 1) stack.pop(); const s = cur(); if (s.t === 'home') loadHome(); else if (s.t === 'hub' || s.t === 'members' || s.t === 'rules') loadGroup(s); else if (s.t === 'stand') loadStand(s); paint(); return; }
    if (t.hasAttribute('data-fmt')) { readDraft(); DR.fmt = t.getAttribute('data-fmt'); paint(); return; }
    if (t.hasAttribute('data-ver')) { readDraft(); DR.kalshi = t.getAttribute('data-ver') === '1'; paint(); return; }
    if (t.hasAttribute('data-honor')) { readDraft(); DR.honor = !DR.honor; paint(); return; }
    if (t.hasAttribute('data-pot')) { readDraft(); DR.pot = t.getAttribute('data-pot'); paint(); return; }
    if (t.hasAttribute('data-type')) { readDraft(); const k = t.getAttribute('data-type'); DR.types[k] = !DR.types[k]; paint(); return; }
    if (t.hasAttribute('data-metric')) { readDraft(); DR.metric = t.getAttribute('data-metric'); paint(); return; }
    if (t.hasAttribute('data-j')) { readDraft(); const k = t.getAttribute('data-j'); DR.join[k] = !DR.join[k]; paint(); return; }
    if (t.hasAttribute('data-tab')) { const s = cur(); s.tab = t.getAttribute('data-tab'); if (s.tab !== 'prizes') loadStand(s); paint(); return; }
    if (t.hasAttribute('data-pscope')) { const s = cur(); s.scope = t.getAttribute('data-pscope'); s.f = 'all'; loadPlayer(s); return; }
    if (t.hasAttribute('data-f')) { const s = cur(); s.f = t.getAttribute('data-f'); paint(); const e = el(), l = e && e.querySelector('.gbet,.gcard.gmut'); if (l && s.f !== 'all') l.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (a === 'create') { DR = draftFrom(null, null, 'group'); if (!LIMS) post('limits', {}).then((j) => { LIMS = j; paint(); }).catch(() => {}); push({ t: 'create1' }); return; }
    if (a === 'addc') { DR = draftFrom(null, curGroup(), 'add'); push({ t: 'create1', id: gid() }); return; }
    if (a === 'edit') { const gr = curGroup(), c = gr && cof(gr, cid); if (!c) return; DR = draftFrom(c, gr, 'edit'); push({ t: 'create1', id: gr.id }); return; }
    if (a === 'gedit') { const gr = curGroup(); DR = { mode: 'gedit', gid: gr.id, gname: gr.name, join: Object.assign({}, gr.join), locked: gr.engaged }; push({ t: 'gedit', id: gr.id }); return; }
    if (a === 'gsave') { readDraft(); const gr = curGroup(); act('edit', { id: DR.gid, name: DR.gname, join: DR.join, take: gr.money.take, msplit: gr.money.msplit }, async () => { DR = null; stack.pop(); loadGroup(cur()); }); return; }
    if (a === 'join') { push({ t: 'join' }); setTimeout(() => { const i = document.getElementById('gcode'); if (i) i.focus(); }, 50); return; }
    if (a === 'next') { readDraft(); if (DR.mode === 'group' && DR.gname.trim().length < 2) { err = 'Give the group a name (2+ characters).'; paint(); return; } if (!startOf(DR)) { err = 'Pick a start date.'; paint(); return; } push({ t: 'create2', id: gid() }); return; }
    if (a === 'submit') {
      readDraft(); const d = DR, c = contestPayload();
      if (d.mode === 'group') act('create', { name: d.gname.trim(), take: takeOf(d), join: d.join, contest: c }, async (j) => { DR = null; await toHub(j.group.id); });
      else if (d.mode === 'add') act('contest/add', { id: d.gid, contest: c, msplit: d.pot === 'main' ? { kind: d.msplit } : undefined }, async () => { DR = null; await toHub(d.gid); });
      else act('contest/edit', { id: d.gid, cid: d.cid, contest: c }, async () => { DR = null; await toHub(d.gid); });
      return;
    }
    if (a === 'hub') { const s = { t: 'hub', id }; push(s); loadGroup(s); return; }
    if (a === 'open') { const s = { t: 'stand', id: id || gid(), cid, tab: 'season' }; push(s); loadStand(s); return; }
    if (a === 'prizes') { const s = { t: 'stand', id: gid(), cid, tab: 'prizes' }; push(s); loadStand(s); return; }
    if (a === 'ext') { const gr = curGroup(), c = gr && cof(gr, cid); if (c && window.OddGames && window.OddGames.open) window.OddGames.open(c.type, c.ref); else { err = 'This game is coming soon to Oddable.'; paint(); } return; }
    if (a === 'members') { const s = { t: 'members', id: id || gid() }; push(s); loadGroup(s); return; }
    if (a === 'rules') { const s = { t: 'rules', id: id || gid(), cid: cid || null }; const o = curGroup() || (H && H.open.find((x) => x.id === s.id)); if (o && o.id === s.id) s.gr = o; push(s); loadGroup(s); return; }
    if (a === 'pot') { const s = { t: 'pot', id: id || gid(), w: t.getAttribute('data-w') || 'main' }; const hg = (H && H.groups.find((x) => x.id === s.id)); if (!curGroup() && hg) s.gr = hg; push(s); if (!curGroup()) loadGroup(s); return; }
    if (a === 'player') { const c0 = cur(); const s = { t: 'player', id: id || gid(), cid: cid || gcid(), pid, scope: t.getAttribute('data-week') ? 'week' : (c0.t === 'stand' && c0.tab === 'week' ? 'week' : 'season'), week: +t.getAttribute('data-week') || (c0.data && c0.data.week) || undefined }; const hg = H && H.groups.find((x) => x.id === s.id); if (!curGroup() && hg) s.gr = hg; push(s); loadPlayer(s); return; }
    if (a === 'preview') { const s = cur(); s.code = (document.getElementById('gcode') || {}).value || ''; act('preview', { code: s.code }, async (j) => { s.pre = j.group; paint(); }); return; }
    if (a === 'dojoin') { const s = cur(); act('join', { code: s.code }, async (j) => { await toHub(j.group.id); }); return; }
    if (a === 'request') { act('request', { id: id || gid() }, async () => { stack = [{ t: 'home' }]; await loadHome(); paint(); }); return; }
    if (a === 'cancel') { act('cancel', { id }, async () => { await loadHome(); }); return; }
    if (a === 'sidein' || a === 'sideout') { const s = cur(); act('sidepot', { id: s.id, cid, on: a === 'sidein' }, async (j) => { s.gr = j.group; paint(); }); return; }
    if (a === 'approve' || a === 'deny') { const s = cur(); act('decide', { id: s.id, pid, ok: a === 'approve' }, async (j) => { s.gr = j.group; paint(); }); return; }
    if (a === 'paid' || a === 'unpaid') { const s = cur(); act('paid', { id: s.id, pid, cid: cid || undefined, paid: a === 'paid' }, async (j) => { s.gr = j.group; paint(); }); return; }
    if (a === 'reqtoggle') { const s = cur(); act('requests', { id: s.id, on: !s.gr.join.requests }, async (j) => { s.gr = j.group; paint(); }); return; }
    if (a === 'invite') { const gr = curGroup(); if (gr && window.OddJoin) window.OddJoin.share({ type: 'g', code: gr.code, title: gr.name }); return; }
    if (a === 'copy') { const c = curGroup() && curGroup().code; try { navigator.clipboard.writeText(c); t.textContent = 'Copied'; } catch (x) { t.textContent = c; } return; }
    if (a === 'contact') { push({ t: 'contact' }); return; }
    if (a === 'ksend') { const v = (i) => (document.getElementById(i) || {}).value || ''; const s = cur(); act('ent/contact', { name: v('kname'), org: v('korg'), reach: v('kreach'), people: v('kpeople'), what: v('kwhat') }, async () => { s.sent = true; paint(); }); return; }
    if (a === 'leave') { if (!confirm('Leave this group?')) return; act('leave', { id: cur().id }, async () => { stack = [{ t: 'home' }]; await loadHome(); paint(); }); return; }
    if (a === 'delete') { if (!confirm('Delete this group for everyone? This cannot be undone.')) return; act('delete', { id: cur().id }, async () => { stack = [{ t: 'home' }]; await loadHome(); paint(); }); return; }
  }
  function change(ev) {
    const id = ev.target && ev.target.id; if (!id) return; const s = cur();
    if (id === 'gweek') { s.week = +ev.target.value; loadStand(s); return; }
    if (['gstart', 'gruns', 'gsd', 'ged', 'gtake', 'gentry', 'gtv', 'gmax', 'glegs', 'gsport', 'gms'].includes(id)) { readDraft(); paint(); }
  }
  function css() {
    if (document.getElementById('ogcss')) return; const st = document.createElement('style'); st.id = 'ogcss';
    st.textContent = '#ogrp{--gbg:#0f0c18;--gp:#1b1630;--gp2:#14111f;--gl:#2f2850;--gi:#f1eefa;--gm:#a59fbd;--gv:#7c3aed;--gv2:#a78bfa;--gg:#4fd18b;--gr:#ff7a70;--gy:#f5c542;position:fixed;inset:0;z-index:95;background:var(--gbg);color:var(--gi);overflow:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
      + '#ogrp .gin0{max-width:560px;margin:0 auto;padding:0 16px calc(48px + env(safe-area-inset-bottom))}#ogrp.gbusy{cursor:progress}#ogrp.gbusy .gpri,#ogrp.gbusy .gout{opacity:.6}'
      + '#ogrp *{box-sizing:border-box}#ogrp h1{font-size:30px;line-height:1.15;margin:8px 0 6px}#ogrp h2{font-size:18px;margin:0 0 10px}#ogrp .gsub{color:var(--gm);margin:0 0 16px}'
      + '#ogrp .gtop{position:sticky;top:0;z-index:2;background:var(--gbg);display:flex;justify-content:space-between;align-items:center;padding:max(8px,env(safe-area-inset-top)) 0 6px}'
      + '#ogrp button,#ogrp a.gpri{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}'
      + '#ogrp .gback,#ogrp .gx,#ogrp .glink{background:none;border:0;color:var(--gv2);font-weight:600;min-height:44px;padding:0 4px;text-align:left}#ogrp .gx{color:var(--gm)}#ogrp .glink{display:block;width:100%;margin-top:4px}#ogrp .glink.gv{color:var(--gv2)}'
      + '#ogrp .gpri,#ogrp .gsec,#ogrp .gout,#ogrp .gdanger{min-height:48px;border-radius:14px;font-weight:700;font-size:16px;padding:10px 12px;text-decoration:none;display:flex;align-items:center;justify-content:center;text-align:center}'
      + '#ogrp .gpri{background:var(--gv);border:1px solid var(--gv);color:#fff}#ogrp .gsec{background:var(--gp2);border:1px solid var(--gl)}#ogrp .gout{background:none;border:2px solid var(--gv)}#ogrp .gdanger{background:none;border:1px solid #6b2a35;color:var(--gr)}#ogrp .gfull{width:100%;margin:12px 0}'
      + '#ogrp .g2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}#ogrp .g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0 4px}'
      + '#ogrp .gh{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--gm);margin:22px 0 10px}'
      + '#ogrp .gcard{background:var(--gp);border:1px solid var(--gl);border-radius:18px;padding:14px 16px;margin:10px 0;display:block;width:100%;text-align:left}#ogrp .gcard.gdash{border-style:dashed;background:none}#ogrp .gbtn{color:inherit}'
      + '#ogrp .grow{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}#ogrp .gname{font-size:20px;font-weight:700;background:none;border:0;padding:0;text-align:left;min-height:44px;flex:1 1 auto;min-width:min(100%,150px);overflow-wrap:break-word}'
      + '#ogrp .gbadge{background:#3b2a78;color:#ddd3ff;border-radius:999px;padding:4px 12px;font-size:13px;font-weight:700;white-space:nowrap}#ogrp .gbadge.gy{background:#3a3010;color:var(--gy)}'
      + '#ogrp .gmeta{color:var(--gm);margin:2px 0}#ogrp .gmut{color:var(--gm)}#ogrp .gnote{color:var(--gm);font-size:13.5px;margin:8px 0}#ogrp .gyel{color:var(--gy)}#ogrp .gpos{color:var(--gg)}#ogrp .gneg{color:var(--gr)}#ogrp .ggold{color:var(--gy)}'
      + '#ogrp .gtile{background:var(--gp2);border:1px solid var(--gl);border-radius:14px;padding:10px 12px;text-align:left;min-height:64px;display:block;width:100%;min-width:0}#ogrp .gtile small{display:block;color:var(--gm);font-size:13px}#ogrp .gtile b{display:block;font-size:22px;line-height:1.2;overflow-wrap:anywhere}#ogrp .gtile i{display:block;font-style:normal;color:var(--gm);font-size:12.5px;margin-top:2px}'
      + '#ogrp .glab{display:block;color:var(--gm);font-size:14px;font-weight:600;margin:12px 0 6px}#ogrp .glab .gin,#ogrp .glab .gsel{margin-top:6px}'
      + '#ogrp .gin,#ogrp .gsel{width:100%;min-height:48px;background:var(--gp2);border:1px solid var(--gl);border-radius:14px;color:var(--gi);font:600 16px system-ui;padding:10px 12px;color-scheme:dark}#ogrp .gcodein{text-transform:uppercase;letter-spacing:.15em;font-size:20px}'
      + '#ogrp .gseg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:8px;margin:6px 0}#ogrp .gseg.g2w{grid-auto-flow:row;grid-template-columns:1fr 1fr}#ogrp .gseg button{min-height:48px;border-radius:14px;border:1px solid var(--gl);background:var(--gp2);font-weight:700;padding:6px}#ogrp .gseg button.on{background:var(--gv);border-color:var(--gv);color:#fff}'
      + '#ogrp .gopt{display:block;width:100%;text-align:left;background:var(--gp);border:1px solid var(--gl);border-radius:16px;padding:12px 14px;margin:8px 0;min-height:56px}#ogrp .gopt b{font-size:17px}#ogrp .gopt small{color:var(--gv2);font-weight:700}#ogrp .gopt.on{border:2px solid var(--gv2);background:#221b3d}#ogrp .gopt.soon{opacity:.55;cursor:not-allowed}#ogrp .gopt.soon small{color:var(--gy)}'
      + '#ogrp .gline{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:52px;padding:4px 0}#ogrp .gline small{display:block;color:var(--gm);font-size:13px}#ogrp .gline.gdis{opacity:.6}'
      + '#ogrp .gsw{flex:0 0 auto;width:64px;height:44px;border:0;background:none;position:relative;padding:0}#ogrp .gsw::before{content:"";position:absolute;left:1px;right:1px;top:4px;bottom:4px;border-radius:999px;border:1px solid var(--gl);background:var(--gp2)}#ogrp .gsw i{position:absolute;top:9px;left:6px;width:26px;height:26px;border-radius:50%;background:#bdb5d6;transition:left .15s}#ogrp .gsw.on::before{background:#8b5cf6;border-color:#8b5cf6}#ogrp .gsw.on i{left:32px;background:#fff}#ogrp .gsw:disabled{opacity:.5}'
      + '#ogrp .gwarn{background:#2a2108;border:1px solid #8a6a12;border-radius:16px;padding:14px 16px;margin:14px 0;color:#efe6cf}#ogrp .gwarn b{display:block;color:var(--gy);font-size:17px;margin-bottom:4px}#ogrp .gwarn.glocked{background:#1d1733;border-color:var(--gl)}#ogrp .gwarn.glocked b{color:var(--gv2)}'
      + '#ogrp .gerr{background:#3a1520;border:1px solid #6b2a35;color:#ffd0d0;border-radius:12px;padding:10px 12px;margin:8px 0}'
      + '#ogrp .gcode{display:flex;align-items:center;gap:8px;background:var(--gp2);border-radius:14px;padding:10px 12px;margin-top:12px;flex-wrap:wrap}#ogrp .gcode span{flex:1;min-width:130px}#ogrp .gcode small{display:block;color:var(--gm)}#ogrp .gcode b{font-size:22px;letter-spacing:.12em}#ogrp .gcode button,#ogrp .gcode a{min-width:76px;min-height:44px;font-size:15px}'
      + '#ogrp .glist{padding:4px 16px}#ogrp .gmrow{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:52px;border-bottom:1px solid var(--gl);padding:6px 0}#ogrp .gmrow:last-child{border-bottom:0}#ogrp .gmrow>span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}#ogrp .gmrow small{display:block;color:var(--gm);font-size:12px}#ogrp .gmrow i{font-style:normal}'
      + '#ogrp .gowed{background:none;border:0;color:var(--gy);font-weight:700;min-height:44px;text-align:right}#ogrp .gtiny{background:none;border:1px solid var(--gl);border-radius:10px;color:var(--gm);min-height:44px;min-width:52px;margin-left:4px}'
      + '#ogrp .gthead,#ogrp .gtrow{display:grid;grid-template-columns:28px minmax(0,1fr) 62px 80px;gap:8px;align-items:center}#ogrp .gthead{color:var(--gm);font-size:13px;font-weight:600;padding:12px 14px 4px}#ogrp .gr{text-align:right;justify-self:end}'
      + '#ogrp .gtrow{width:100%;text-align:left;background:var(--gp);border:1px solid var(--gl);border-radius:16px;padding:12px 14px;margin:8px 0;min-height:60px}#ogrp .gtrow.me{border:2px solid var(--gv2)}#ogrp .gpl{font-size:18px;font-weight:700}#ogrp .gpn{min-width:0}#ogrp .gpn b{display:block;font-size:16px;overflow-wrap:anywhere}#ogrp .gpn small{display:block;color:var(--gm);font-size:12.5px}#ogrp .gv{font-weight:700;font-size:16px}'
      + '#ogrp .grules>div{display:flex;flex-direction:column;padding:8px 0;border-bottom:1px solid var(--gl)}#ogrp .grules>div:last-child{border-bottom:0}#ogrp .grules small{color:var(--gm);font-size:12.5px}#ogrp .grules span{overflow-wrap:anywhere}'
      + '#ogrp .gkv{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--gl)}#ogrp .gkv:last-child{border-bottom:0}#ogrp .gkv span{min-width:0}#ogrp .gkv small{display:block;color:var(--gm);font-size:12.5px}#ogrp .gkv b{text-align:right;white-space:nowrap}#ogrp .gkv.gtot b{font-size:20px}'
      + '#ogrp .gbet{display:flex;justify-content:space-between;gap:10px;background:var(--gp);border:1px solid var(--gl);border-radius:14px;padding:10px 12px;margin:8px 0}#ogrp .gbet.hit{border-color:#2e7a52;background:#14261d}#ogrp .gbet.miss{border-color:#7a2e35;background:#2a1418}#ogrp .gbet.gno{opacity:.7;border-style:dashed}#ogrp .gbw{min-width:0}#ogrp .gbw b{display:block;overflow-wrap:anywhere}#ogrp .gbw small{display:block;color:var(--gm);font-size:12.5px}#ogrp .gbet .gr{display:flex;flex-direction:column;align-items:flex-end;gap:4px}'
      + '#ogrp .gpill{border:1px solid var(--gl);border-radius:999px;padding:2px 10px;font-size:12.5px;font-weight:700;white-space:nowrap}#ogrp .gpill.gpos{border-color:#2e7a52}#ogrp .gpill.gneg{border-color:#7a2e35}'
      + '#ogrp .gbadge.gside{background:#3a2f12;color:#fcd34d}#ogrp .gv2{color:var(--gv2);font-weight:700}#ogrp .gh2{font-size:15px;margin:14px 0 4px}'
      + '#ogrp .gcc{background:var(--gp);border:1px solid var(--gl);border-radius:16px;margin:12px 0;overflow:hidden}#ogrp .gcc.gcalc{background:#2a2008;border-color:#a16207}#ogrp .gccb{display:flex;flex-direction:column;gap:8px;width:100%;text-align:left;background:none;border:0;padding:14px;min-height:64px}#ogrp .gct{font-size:17px;overflow-wrap:anywhere;flex:1;min-width:0}#ogrp .gcl{font-size:14px}#ogrp .gcc .glink,#ogrp .gcc .gnote,#ogrp .gcc .gout{margin:0 14px 12px;width:calc(100% - 28px)}'
      + '#ogrp .gadd{display:block;width:100%;min-height:48px;margin:10px 0;border:1px dashed #8b5cf6;border-radius:14px;background:none;color:#ddd6fe;font-weight:600;font-size:15px}#ogrp .gadd:disabled{opacity:.6}#ogrp .gadd small{display:block;color:var(--gy);font-size:12px}#ogrp .gadd2{border-color:#4c3f7a}'
      + '#ogrp .gpotc{padding:10px 14px}#ogrp .gkvb{display:flex;justify-content:space-between;align-items:baseline;width:100%;background:none;border:0;padding:6px 0;min-height:44px;text-align:left}#ogrp .gtopb{border-top:1px solid var(--gl);margin-top:6px}#ogrp .gbig{font-size:22px}#ogrp .gbig2{font-size:18px}'
      + '#ogrp .gkvb2{width:100%;background:none;border:0;border-bottom:1px solid var(--gl);text-align:left;min-height:44px}#ogrp textarea.gin{font-weight:500;resize:vertical}#ogrp .gsel:disabled,#ogrp .gin:disabled,#ogrp .gseg button:disabled{opacity:.55}'
      + '@media (max-width:360px){#ogrp .g3{grid-template-columns:1fr 1fr}#ogrp .gthead,#ogrp .gtrow{grid-template-columns:24px minmax(0,1fr) 56px 72px}}';
    document.head.appendChild(st);
  }
  window.oddGroups = function (keepStack) {
    css(); let e = el(); if (e) e.remove(); e = document.createElement('div'); e.id = 'ogrp'; e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', 'Groups');
    e.innerHTML = '<div class="gin0"></div>'; document.body.appendChild(e); try { sessionStorage.setItem('ogrp-open', '1'); } catch (x) {}
    e.addEventListener('click', click); e.addEventListener('change', change); if (keepStack) return; stack = [{ t: 'home' }]; err = ''; paint(); loadHome();
  };
  // G14: invite links ?join=g.<code> land here (pics/join.js calls this once the person is signed in).
  if (window.OddJoin) window.OddJoin.register('g', (code) => openJoin(code));
  // A reload while Groups is open (new version, sync from another device) puts it back instead of dropping the player on the main screen.
  try { if (sessionStorage.getItem('ogrp-open') === '1') setTimeout(() => { if (!document.getElementById('ogrp') && window.oddGroups && g('odd-tok') && !(window.OddJoin && window.OddJoin.pending())) window.oddGroups(); }, 1500); } catch (e) {}
})();
