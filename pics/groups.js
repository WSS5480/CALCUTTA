// Oddable Groups (stage 1). Full-screen overlay #ogrp (same pattern as dash.js), opened from the "Groups" item in the main menu.
// Every rule, standing and money figure comes from the server (odds-api/groups.js); this file only shows them. Money is information only:
// Oddable never collects, holds or pays money. Other members' bets arrive only after their games kick off (the server never sends them earlier).
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
  const SPORT = { nfl: 'NFL', ncaa: 'College', both: 'College and NFL' }, FMT = { standings: 'Season standings', best5: 'Best five' };
  const METRIC = { win: 'Winnings ($)', units: 'Units', ret: 'Return %', pct: 'Win %' }, MCOL = { win: 'Winnings', units: 'Units', ret: 'Return', pct: 'Win %' };
  const TYPES = [['sp', 'Spread'], ['ml', 'Moneyline'], ['ou', 'Totals (over / under)'], ['prop', 'Player props'], ['parlay', 'Parlays']];
  const SPLITN = { '60/30/10': '60 / 30 / 10', '100': 'Winner takes all', '50/30/20': '50 / 30 / 20', none: 'Bragging rights only' };
  const RUNS = { season: 'Rest of season', weekend: 'One weekend', w1: 'One week', w2: '2 weeks', w3: '3 weeks', w4: '4 weeks', w6: '6 weeks', w8: '8 weeks', playoffs: 'Through the playoffs', custom: 'Custom dates' };
  const MONEYLINE = 'The commissioner collects entries and pays winners. Oddable keeps the score and shows who is owed what. Oddable never collects, holds or pays money.';
  let stack = [{ t: 'home' }], H = null, busy = false, err = '', DR = null, CACHE = {};

  // ---------- server ----------
  async function post(op, b) {
    const r = await fetch(API + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify(Object.assign({ myName: g('odd-name') || '' }, b || {})) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server said ' + r.status), { status: r.status }); return j;
  }
  const errText = (e) => (e && /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Could not reach the server. It may be waking up: try again in a few seconds.' : e && e.status === 401 ? 'Sign in to use Groups.' : (e && e.message) || 'Something went wrong');
  async function act(op, b, then) { if (busy) return; busy = true; err = ''; paintBusy(true); try { const j = await post(op, b); busy = false; await then(j); } catch (e) { busy = false; err = errText(e); paint(); } paintBusy(false); }

  // ---------- small parts ----------
  const top = (back, right) => '<div class="gtop">' + (back ? '<button class="gback" data-a="back">‹ ' + esc(back) + '</button>' : '<span></span>') + (right || '<button class="gx" data-a="close" aria-label="Close Groups">Close</button>') + '</div>';
  const tile = (lab, val, cls, a, sub) => '<button class="gtile" ' + a + '><small>' + esc(lab) + (a ? ' ›' : '') + '</small><b class="' + (cls || '') + '">' + val + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</button>';
  const sw = (on, a, dis) => '<button class="gsw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" ' + (dis ? 'disabled' : a) + '><i></i></button>';
  const seg = (opts, cur, a) => '<div class="gseg">' + opts.map(([v, l]) => '<button class="' + (v === cur ? 'on' : '') + '" ' + a + '="' + att(v) + '">' + esc(l) + '</button>').join('') + '</div>';
  const sel = (id, opts, cur) => '<select id="' + id + '" class="gsel">' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
  const val = (t, metric, round) => (metric === 'win' ? (round ? usd(Math.round(t.win), true) : usd(t.win, true)) : metric === 'units' ? (t.units > 0 ? '+' : '') + t.units + 'u' : metric === 'ret' ? (t.ret == null ? '–' : (t.ret > 0 ? '+' : '') + t.ret + '%') : t.pct == null ? '–' : t.pct + '%');
  const vcls = (t, metric) => { const v = metric === 'pct' ? (t.pct == null ? 0 : t.pct - 50) : metric === 'ret' ? t.ret || 0 : metric === 'units' ? t.units : t.win; return v > 0 ? 'gpos' : v < 0 ? 'gneg' : ''; };
  const rec = (t) => t.w + '-' + t.l + (t.p ? '-' + t.p : '');
  const takeLine = (gr) => esc(gr.takeText || '');
  const startsBadge = (gr) => { const d = chiDay(gr.start), td = chiDay(Date.now()), diff = Math.round((Date.parse(d) - Date.parse(td)) / 864e5); return 'Starts ' + (diff <= 0 ? 'today' : diff === 1 ? 'tomorrow' : diff < 7 ? new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' }) : fmtDay(d)); };
  const meta = (gr) => esc((gr.fmt === 'best5' ? 'Best five' : 'Standings') + ' · ' + SPORT[gr.sport] + ' · ' + (gr.rules.verified ? 'verified bets only' : 'any logged bet') + ' · ' + RUNS[gr.runs]);

  // ---------- screens ----------
  function home() {
    if (!H) return '<div class="gcard">Loading your groups…</div>';
    let s = '<h1>Groups</h1><p class="gsub">Your real bets against your people. Best record or biggest winner takes it.</p><div class="g2"><button class="gpri" data-a="create">Create a group</button><button class="gsec" data-a="join">Join with a code</button></div>';
    s += '<h3 class="gh">My groups</h3>';
    if (!H.groups.length) s += '<div class="gcard gmut">No groups yet. Create one, or ask a friend for their invite code.</div>';
    H.groups.forEach((gr) => {
      const comm = gr.role === 'comm', st = gr.started;
      s += '<div class="gcard"><div class="grow"><button class="gname" data-a="open" data-id="' + att(gr.id) + '">' + esc(gr.name) + '</button>' + (comm ? '<span class="gbadge">Commissioner</span>' : '') + (!st ? '<span class="gbadge gy">' + esc(startsBadge(gr)) + '</span>' : gr.ended ? '<span class="gbadge">Final</span>' : '') + '</div>';
      s += '<div class="gmeta">' + esc(FMT[gr.fmt]) + ' · ' + esc(SPORT[gr.sport]) + ' · ' + gr.count + ' member' + (gr.count === 1 ? '' : 's') + (st && gr.curW ? ' · Week ' + gr.curW + ' of ' + gr.weeks : '') + '</div>';
      if (st) s += '<div class="g3">' + tile('Your place', gr.place ? ord(gr.place) : '–', '', 'data-a="open" data-id="' + att(gr.id) + '"') + tile(MCOL[gr.rules.metric], gr.myT ? val(gr.myT, gr.rules.metric, 1) : '–', gr.myT ? vcls(gr.myT, gr.rules.metric) : '', 'data-a="player" data-id="' + att(gr.id) + '" data-pid="' + att(gr.me) + '"') + tile('Pot', usd(Math.round(gr.pot.pot)), 'ggold', 'data-a="pot" data-id="' + att(gr.id) + '"') + '</div>';
      else s += '<button class="glink" data-a="rules" data-id="' + att(gr.id) + '">Rules lock at the first kickoff. Review them ›</button>';
      if (comm && gr.reqCount) s += '<button class="glink gv" data-a="members" data-id="' + att(gr.id) + '">' + gr.reqCount + ' join request' + (gr.reqCount === 1 ? '' : 's') + ' waiting ›</button>';
      else s += '<button class="glink gv" data-a="members" data-id="' + att(gr.id) + '">Members ›</button>';
      s += '</div>';
    });
    if (H.open.length || H.pending.length) s += '<h3 class="gh">Open to requests</h3>';
    H.open.forEach((gr) => {
      s += '<div class="gcard"><div class="grow"><b class="gname">' + esc(gr.name) + '</b><span class="gmut">' + gr.count + ' of ' + gr.join.max + ' spots</span></div><div class="gmeta">' + meta(gr) + ' · starts ' + esc(fmtDay(gr.startDay)) + '</div>';
      s += '<div class="gnote">' + takeLine(gr) + (gr.entry ? ' · entry ' + usd(gr.entry) : ' · no entry') + '</div><div class="gnote">The commissioner approves every member.</div>';
      s += '<div class="g2"><button class="gsec" data-a="rules" data-id="' + att(gr.id) + '">See the rules</button><button class="gout" data-a="request" data-id="' + att(gr.id) + '">Request to join</button></div></div>';
    });
    H.pending.forEach((p) => { s += '<div class="gcard gdash"><b>' + esc(p.name) + '</b><div class="gmut">Request sent. Waiting for the commissioner.</div><button class="glink" data-a="cancel" data-id="' + att(p.id) + '">Cancel request</button></div>'; });
    return s;
  }
  function joinV() {
    const s = stack[stack.length - 1], gr = s.pre;
    let h = '<h1>Join with a code</h1><label class="glab">Invite code<input id="gcode" class="gin gcodein" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="ABCD-1234" value="' + esc(s.code || '') + '"></label><button class="gpri gfull" data-a="preview">Look it up</button>';
    if (gr) {
      h += '<div class="gcard"><b class="gname">' + esc(gr.name) + '</b><div class="gmeta">' + meta(gr) + '</div>' + rulesList(gr) + '</div>';
      if (gr.role === 'none') h += '<button class="gpri gfull" data-a="dojoin">Join ' + esc(gr.name) + '</button>'; else h += '<button class="gsec gfull" data-a="open" data-id="' + att(gr.id) + '">You are in this group. Open it ›</button>';
    }
    return h;
  }
  // ---- create / edit ----
  function draftFrom(gr) {
    return gr ? { id: gr.id, name: gr.name, sport: gr.sport, fmt: gr.fmt, startMode: 'date', startDate: gr.startDay, runs: gr.runs, endDay: gr.endDay, verified: gr.rules.verified, types: Object.assign({}, gr.rules.types), legs: gr.rules.legs || 3, metric: gr.rules.metric, minBets: gr.rules.minBets, cap: gr.rules.cap, entry: gr.rules.entry, split: gr.rules.split, takeKind: gr.rules.take.kind, takeV: gr.rules.take.v, join: Object.assign({}, gr.join) }
      : { name: '', sport: 'nfl', fmt: 'standings', startMode: 'weekend', startDate: '', runs: 'season', endDay: '', verified: true, types: { sp: true, ml: true, ou: true, prop: false, parlay: true }, legs: 3, metric: 'win', minBets: 3, cap: 100, entry: 0, split: '60/30/10', takeKind: 'none', takeV: 0, join: { requests: true, open: false, max: 20, late: 'no' } };
  }
  function games() { const o = []; try { if (typeof ALL !== 'undefined') Object.values(ALL).forEach((x) => o.push(x)); } catch (e) {} try { if (typeof XL !== 'undefined') Object.values(XL).forEach((x) => o.push(x)); } catch (e) {} return o.filter((x) => x && Number.isFinite(x.start)); }
  function startOf(d) { // the group's start = the first kickoff on/after the chosen moment (from the games this phone has loaded); rules lock then
    const now = Date.now(), td = chiDay(now), k = (from) => games().map((x) => x.start).filter((t) => t >= from && t > now + 120e3).sort((a, b) => a - b)[0];
    let from, fb;
    if (d.startMode === 'next') { from = now; fb = now + 15 * 6e4; }
    else if (d.startMode === 'weekend') { const w = wd(td), sat = w === 6 || w === 0 ? td : addDays(td, 6 - w); from = Math.max(now, chiStart(sat)); fb = Math.max(now + 15 * 6e4, chiStart(sat) + 12 * 36e5); }
    else if (d.startMode === 'nextweek') { const w = wd(td), tue = addDays(td, ((2 - w + 7) % 7) || 7); from = chiStart(tue); fb = chiStart(addDays(tue, 2)) + 19 * 36e5; }
    else { if (!/^\d{4}-\d{2}-\d{2}$/.test(d.startDate || '')) return null; from = Math.max(now, chiStart(d.startDate)); fb = Math.max(now + 15 * 6e4, chiStart(d.startDate)); const t = k(from); return t && chiDay(t) === d.startDate ? t : fb; }
    return k(from) || fb;
  }
  function create1() {
    const d = DR, st = startOf(d), nextW = (() => { try { return typeof CUR !== 'undefined' && CUR ? ' (Week ' + (CUR + 1) + ')' : ''; } catch (e) { return ''; } })();
    const F = [['standings', 'Standings', 'Everyone on one leaderboard. Most winnings at the end takes the pot.'], ['h2h', 'Head-to-head', 'A new opponent every week, like fantasy. Win-loss record, then playoffs.'], ['bank', 'Bankroll challenge', 'Everyone starts with the same bankroll. Go broke and you are out.'], ['surv', 'Survivor', 'One winning bet a week keeps you alive. Last one standing wins.'], ['best5', 'Best five', 'Bet as much as you like. Only your five best results each week count.']];
    let h = '<div class="grow"><h1>' + (d.id ? 'Edit the group' : 'Create a group') + '</h1><span class="gmut">Step 1 of 2</span></div>';
    h += '<label class="glab">Group name<input id="gname" class="gin" maxlength="30" placeholder="Sunday Crew" value="' + esc(d.name) + '"></label>';
    h += '<div class="glab">Sport</div>' + seg([['nfl', 'NFL'], ['ncaa', 'College'], ['both', 'Both']], d.sport, 'data-sport');
    h += '<div class="glab">How the group competes</div>';
    F.forEach(([k, t, x]) => { const soon = k === 'h2h' || k === 'bank' || k === 'surv'; h += '<button class="gopt' + (d.fmt === k ? ' on' : '') + (soon ? ' soon' : '') + '" ' + (soon ? 'disabled aria-disabled="true"' : 'data-fmt="' + k + '"') + '><span class="grow"><b>' + t + '</b><small>' + (soon ? 'Coming soon' : d.fmt === k ? 'Selected' : '') + '</small></span><span class="gmut">' + x + '</span></button>'; });
    h += '<div class="g2"><label class="glab">Starts' + sel('gstart', [['next', 'Next kickoff'], ['weekend', 'This weekend'], ['nextweek', 'Next week' + nextW], ['date', 'Pick a date']], d.startMode) + '</label><label class="glab">Runs for' + sel('gruns', Object.keys(RUNS).map((k) => [k, k === 'custom' ? 'Pick a date' : RUNS[k]]), d.runs) + '</label></div>';
    if (d.startMode === 'date') h += '<label class="glab">Start date<input id="gsd" class="gin" type="date" value="' + esc(d.startDate) + '"></label>';
    if (d.runs === 'custom') h += '<label class="glab">Last day<input id="ged" class="gin" type="date" value="' + esc(d.endDay) + '"></label>';
    h += '<div class="gnote">' + (st ? 'Starts ' + esc(fmtTime(st)) + '. Rules lock then, at the first kickoff.' : 'Pick a start date.') + '</div>';
    return h + '<button class="gpri gfull" data-a="next">Next: rules and prizes</button>';
  }
  function create2() {
    const d = DR, maxM = d.join.max, potE = (Number(d.entry) || 0) * maxM, tk = d.takeKind === 'pct' ? Math.round(potE * (Number(d.takeV) || 0)) / 100 : d.takeKind === 'flat' ? Math.min(Number(d.takeV) || 0, potE) : 0;
    let h = '<div class="grow"><h1>Rules and prizes</h1><span class="gmut">Step 2 of 2</span></div>';
    h += '<div class="gcard"><h2>Which bets count</h2>' + seg([['1', 'Verified only'], ['0', 'Any logged bet']], d.verified ? '1' : '0', 'data-ver');
    h += '<div class="gnote">' + (d.verified ? "Verified bets sync from each member's own Kalshi account, so nobody can add a winner after the game." : 'Every bet members log in My Bets counts. Bets logged after their game started never count.') + '</div>';
    TYPES.forEach(([k, l]) => { h += '<div class="gline"><span>' + (k === 'parlay' ? 'Parlays, up to ' + d.legs + ' legs' : l) + '</span>' + sw(d.types[k], 'data-type="' + k + '"') + '</div>'; });
    if (d.types.parlay) h += '<label class="glab">Most legs in a parlay' + sel('glegs', [2, 3, 4, 5, 6, 8, 10].map((n) => [n, n + ' legs']), d.legs) + '</label>';
    h += '</div><div class="gcard"><h2>How the winner is decided</h2><div class="gseg g2w">' + Object.keys(METRIC).map((k) => '<button class="' + (d.metric === k ? 'on' : '') + '" data-metric="' + k + '">' + METRIC[k] + '</button>').join('') + '</div>';
    h += '<div class="g2"><label class="glab">Least bets a week' + sel('gmin', [[0, 'No minimum'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], d.minBets) + '</label><label class="glab">Most a bet can count' + sel('gcap', [[0, 'No cap'], [10, '$10'], [25, '$25'], [50, '$50'], [100, '$100'], [250, '$250'], [500, '$500']], d.cap) + '</label></div>';
    h += '<div class="gnote">The cap keeps one big bet from deciding the group. Ties go to the better return %.</div></div>';
    h += '<div class="gcard"><h2>Entry and payout</h2><div class="g2"><label class="glab">Entry per member<input id="gentry" class="gin" type="number" inputmode="numeric" min="0" max="10000" step="1" placeholder="0" value="' + esc(d.entry || '') + '"></label><label class="glab">Payout split' + sel('gsplit', Object.keys(SPLITN).map((k) => [k, SPLITN[k]]), d.split) + '</label></div>';
    const tsel = d.takeKind === 'none' ? 'none' : d.takeKind === 'flat' ? 'flat' : [5, 10, 15, 20, 25].includes(Number(d.takeV)) ? 'p' + d.takeV : 'pc';
    h += '<div class="g2"><label class="glab">Commissioner\'s take' + sel('gtake', [['none', 'None'], ['p5', '5% of the pot'], ['p10', '10% of the pot'], ['p15', '15% of the pot'], ['p20', '20% of the pot'], ['p25', '25% of the pot'], ['pc', 'Other percent'], ['flat', 'Flat amount']], tsel) + '</label><div class="gnote" style="align-self:end">Members see this before they join<br><b class="ggold">Prize pool = pot minus take</b></div></div>';
    if (tsel === 'pc') h += '<label class="glab">Percent of the pot (0 to 50)<input id="gtv" class="gin" type="number" inputmode="numeric" min="0" max="50" step="1" value="' + esc(d.takeV) + '"></label>';
    if (tsel === 'flat') h += '<label class="glab">Flat amount ($)<input id="gtv" class="gin" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(d.takeV) + '"></label>';
    h += '<div class="gnote">If all ' + maxM + ' spots fill and pay: pot ' + usd(potE) + ', take ' + usd(tk) + ', prize pool ' + usd(potE - tk) + '.</div>';
    h += '<div class="gline gdis"><span>Weekly high-score prize<small>Coming soon. The weekly high score is shown, no prize yet.</small></span>' + sw(false, '', true) + '</div>';
    h += '<div class="gnote">' + MONEYLINE + '</div></div>';
    h += '<div class="gcard"><h2>Who can join</h2><div class="gline"><span>Let people ask to join<small>You approve or deny each request.</small></span>' + sw(d.join.requests, 'data-j="requests"') + '</div>';
    h += '<div class="gline"><span>Show in Open groups<small>Off means invite code only.</small></span>' + sw(d.join.open, 'data-j="open"') + '</div>';
    h += '<div class="g2"><label class="glab">Most members' + sel('gmax', [2, 3, 4, 6, 8, 10, 12, 16, 20, 30, 50].map((n) => [n, n]), d.join.max) + '</label><label class="glab">Joining after start' + sel('glate', [['no', 'Not allowed'], ['2w', 'First 2 weeks']], d.join.late) + '</label></div></div>';
    h += '<div class="gwarn"><b>Rules lock at the first kickoff</b>After the first game starts nobody can change these, the commissioner included. Every member sees the locked rules.</div>';
    return h + '<button class="gpri gfull" data-a="submit">' + (d.id ? 'Save rules' : 'Create group') + '</button>';
  }
  function readDraft() { // copy the form inputs into the draft before any repaint
    const v = (id) => { const e = document.getElementById(id); return e ? e.value : null; }, d = DR; if (!d) return;
    if (v('gname') !== null) d.name = v('gname'); if (v('gstart') !== null) d.startMode = v('gstart'); if (v('gruns') !== null) d.runs = v('gruns'); if (v('gsd') !== null) d.startDate = v('gsd'); if (v('ged') !== null) d.endDay = v('ged');
    if (v('glegs') !== null) d.legs = +v('glegs'); if (v('gmin') !== null) d.minBets = +v('gmin'); if (v('gcap') !== null) d.cap = +v('gcap'); if (v('gentry') !== null) d.entry = v('gentry'); if (v('gsplit') !== null) d.split = v('gsplit');
    if (v('gtv') !== null) d.takeV = v('gtv'); // before the take picker: a changed picker resets the amount
    if (v('gtake') !== null) { const t = v('gtake'); if (t === 'none') d.takeKind = 'none'; else if (t === 'flat') { if (d.takeKind !== 'flat') d.takeV = ''; d.takeKind = 'flat'; } else if (t === 'pc') { if (d.takeKind !== 'pct' || [5, 10, 15, 20, 25].includes(Number(d.takeV))) d.takeV = ''; d.takeKind = 'pct'; } else { d.takeKind = 'pct'; d.takeV = +t.slice(1); } }
    if (v('gmax') !== null) d.join.max = +v('gmax'); if (v('glate') !== null) d.join.late = v('glate');
  }
  function payload() { const d = DR; return { id: d.id, name: d.name.trim(), sport: d.sport, fmt: d.fmt, start: startOf(d), runs: d.runs, endDay: d.endDay, verified: d.verified, types: d.types, legs: d.legs, metric: d.metric, minBets: d.minBets, cap: d.cap, entry: d.entry === '' ? 0 : Number(d.entry), split: d.split, take: { kind: d.takeKind, v: d.takeKind === 'none' ? 0 : Number(d.takeV) }, join: d.join }; }
  // ---- rules list (locked-rules sheet, join preview, open card) ----
  function rulesList(gr) {
    const r = gr.rules, rows = [
      ['Sport', SPORT[gr.sport]], ['Format', FMT[gr.fmt]], ['Dates', fmtDay(gr.startDay) + ' to ' + fmtDay(gr.endDay) + ' · ' + RUNS[gr.runs]], ['Starts', fmtTime(gr.start) + ' (first kickoff)'],
      ['Bets that count', (r.verified ? 'Verified only (synced from Kalshi)' : 'Any logged bet') + ': ' + TYPES.filter(([k]) => r.types[k]).map(([k, l]) => (k === 'parlay' ? 'parlays up to ' + r.legs + ' legs' : l.replace(/ \(.*/, '').toLowerCase())).join(', ')],
      ['Winner decided by', METRIC[r.metric] + ', ties to the better return %'], ['Least bets a week', r.minBets ? r.minBets + ' (fewer = flagged, that week cannot win the high score)' : 'No minimum'], ['Most a bet can count', r.cap ? usd(r.cap) : 'No cap'],
      ['Entry per member', r.entry ? usd(r.entry) : 'No entry'], ['Payout split', SPLITN[r.split]], ["Commissioner's take", gr.takeText],
      ['Joining', (gr.join.requests ? 'Can ask to join' : 'Invite code only') + (gr.join.open ? ', shown in Open groups' : '') + ' · up to ' + gr.join.max + ' members · after start: ' + (gr.join.late === '2w' ? 'first 2 weeks' : 'not allowed')],
    ];
    return '<div class="grules">' + rows.map(([k, v]) => '<div><small>' + esc(k) + '</small><span>' + esc(v) + '</span></div>').join('') + '</div>';
  }
  function rulesV() {
    const s = stack[stack.length - 1], gr = s.gr; if (!gr) return '<div class="gcard">Loading…</div>';
    let h = '<h1>' + esc(gr.name) + '</h1><div class="gwarn' + (gr.locked ? ' glocked' : '') + '"><b>' + (gr.locked ? '🔒 Rules locked' : 'Rules lock at the first kickoff') + '</b>' + (gr.locked ? 'Locked at ' + esc(fmtTime(gr.start)) + '. Nobody can change them, the commissioner included.' : 'They lock ' + esc(fmtTime(gr.start)) + '. After that nobody can change them, the commissioner included.') + '</div>';
    h += rulesList(gr) + '<div class="gnote">' + MONEYLINE + '</div>';
    if (gr.role === 'comm' && !gr.locked) h += '<button class="gsec gfull" data-a="edit" data-id="' + att(gr.id) + '">Edit rules</button>';
    if (gr.role === 'none' && gr.join && gr.join.requests && !gr.started) h += '<button class="gpri gfull" data-a="request" data-id="' + att(gr.id) + '">Request to join</button>';
    if (gr.role === 'pending') h += '<div class="gcard gdash gmut">Request sent. Waiting for the commissioner.</div>';
    return h;
  }
  // ---- members / requests ----
  function membersV() {
    const s = stack[stack.length - 1], gr = s.gr; if (!gr) return '<div class="gcard">Loading…</div>';
    const comm = gr.role === 'comm', you = gr.me;
    let h = '<div class="grow"><h1>Members</h1>' + (comm ? '<span class="gbadge">Commissioner</span>' : '') + '</div>';
    h += '<div class="gcard">';
    if (comm) h += '<div class="gline"><span><b>Accepting join requests</b><small>' + gr.count + ' of ' + gr.join.max + ' spots filled. ' + (gr.locked ? 'Rules are locked, this cannot change now.' : 'Closes at the first kickoff.') + '</small></span>' + sw(gr.join.requests, 'data-a="reqtoggle"', gr.locked) + '</div>';
    else h += '<div class="gmut">' + gr.count + ' of ' + gr.join.max + ' spots filled.</div>';
    if (!gr.started || gr.join.late === '2w') h += '<div class="gcode"><span><small>Invite code</small><b>' + esc(gr.code) + '</b></span><button class="gsec" data-a="copy">Copy</button><a class="gpri" href="sms:?&body=' + encodeURIComponent('Join my Oddable group "' + gr.name + '" with code ' + gr.code + ' at https://steves-pics.onrender.com/ (Menu > Groups > Join with a code)') + '">Text it</a></div>';
    h += '</div>';
    if (comm) {
      const q = gr.reqs || []; h += '<h3 class="gh">Waiting for you · ' + q.length + '</h3>';
      if (!q.length) h += '<div class="gcard gmut">No requests right now.</div>';
      q.forEach((x) => { const days = Math.floor((Date.now() - x.at) / 864e5); h += '<div class="gcard"><div class="grow"><b class="gname">' + esc(x.name) + '</b><span class="gmut">Asked ' + (days <= 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago') + '</span></div>';
        h += '<div class="gnote' + (gr.rules.verified && !x.ver ? ' gyel' : '') + '">' + (x.ver ? 'Kalshi connected, bets verified' : gr.rules.verified ? 'No Kalshi account connected. This group counts verified bets only.' : x.noBets ? 'No synced bets yet.' : 'Logs bets by hand (no Kalshi).') + '</div>';
        h += '<div class="g2"><button class="gpri" data-a="approve" data-pid="' + att(x.pid) + '">Approve</button><button class="gsec" data-a="deny" data-pid="' + att(x.pid) + '">Deny</button></div></div>'; });
    }
    h += '<h3 class="gh">In the group · ' + gr.members.length + '</h3><div class="gcard glist">';
    gr.members.forEach((m) => { h += '<div class="gmrow"><span>' + esc(m.name) + (m.pid === you ? ' <i class="gmut">· you</i>' : '') + (m.comm ? ' <i class="gmut">· commissioner</i>' : '') + (m.noBets ? '<small>No synced bets: sign in with your phone number to count bets</small>' : '') + '</span>' + (gr.rules.entry ? (m.paid ? '<span class="gmut">Entry paid' + (comm ? ' <button class="gtiny" data-a="unpaid" data-pid="' + att(m.pid) + '">Undo</button>' : '') + '</span>' : comm ? '<button class="gowed" data-a="paid" data-pid="' + att(m.pid) + '">Entry owed · Mark paid</button>' : '<span class="gyel">Entry owed</span>') : '') + '</div>'; });
    h += '</div>';
    if (gr.rules.entry) h += '<div class="gnote">' + MONEYLINE + '</div>';
    h += '<button class="gsec gfull" data-a="rules" data-id="' + att(gr.id) + '">' + (gr.locked ? '🔒 Locked rules ›' : 'Rules ›') + '</button>';
    if (!gr.started && comm) h += '<button class="gsec gfull" data-a="edit" data-id="' + att(gr.id) + '">Edit rules</button><button class="gdanger gfull" data-a="delete">Delete group</button>';
    if (!gr.started && !comm) h += '<button class="gdanger gfull" data-a="leave">Leave group</button>';
    return h;
  }
  // ---- standings ----
  function standV() {
    const s = stack[stack.length - 1], d = s.data; if (!d) return '<div class="gcard">Loading standings…</div>';
    const gr = d.group, r = gr.rules, me = d.rows.find((x) => x.pid === gr.me), leader = d.rows[0];
    let h = '<h1>' + esc(gr.name) + '</h1><button class="glink" data-a="rules" data-id="' + att(gr.id) + '">' + esc((gr.fmt === 'best5' ? 'Best five' : 'Standings') + ' · ' + SPORT[gr.sport] + ' · ' + (r.verified ? 'verified bets' : 'any logged bet') + ' · ' + (gr.locked ? 'rules locked' : 'rules lock ' + fmtTime(gr.start))) + ' ›</button>';
    h += '<div class="gseg g3s">' + [['week', 'This week'], ['season', 'Season'], ['prizes', 'Prizes']].map(([k, l]) => '<button class="' + (s.tab === k ? 'on' : '') + '" data-tab="' + k + '">' + l + '</button>').join('') + '</div>';
    if (!gr.started) h += '<div class="gwarn"><b>' + esc(startsBadge(gr)) + '</b>The group starts ' + esc(fmtTime(gr.start)) + '. Standings fill in once games are played.</div>';
    if (s.tab === 'prizes') return h + potBody(d.pot, d.rows, gr);
    if (s.tab === 'week') h += '<label class="glab">Week' + sel('gweek', Array.from({ length: d.lastW }, (_, i) => [i + 1, 'Week ' + (i + 1) + (i + 1 === d.curW ? ' (this week)' : '')]), d.week) + '</label><div class="gnote">' + esc(fmtDay(d.weekDays[0]) + ' to ' + fmtDay(d.weekDays[1])) + '</div>';
    const behind = me && leader && me !== leader ? (r.metric === 'win' ? usd(leader.t.win - me.t.win) : r.metric === 'units' ? Math.round((leader.t.units - me.t.units) * 100) / 100 + 'u' : r.metric === 'ret' ? Math.round(((leader.t.ret || 0) - (me.t.ret || 0)) * 10) / 10 + ' pts' : Math.round(((leader.t.pct || 0) - (me.t.pct || 0)) * 10) / 10 + ' pts') + ' behind 1st' : me ? 'Leading the group' : '';
    h += '<div class="g2">' + (me && gr.started ? tile('Your place', ord(me.place) + ' of ' + d.rows.length, '', 'data-a="player" data-pid="' + att(me.pid) + '"', esc(behind)) : '') + tile('Pot', usd(d.pot.pot), 'ggold', 'data-a="pot" data-id="' + att(gr.id) + '"', d.pot.places.length ? d.pot.places.map((p) => ord(p.place) + ' ' + usd(p.amt)).join(' · ') : 'Bragging rights only') + '</div>';
    h += '<div class="gthead"><span>#</span><span>Player</span><span class="gr">Record</span><span class="gr">' + MCOL[r.metric] + '</span></div>';
    d.rows.forEach((x) => {
      const t = x.t, sub = t.short ? '<small class="gyel">Only ' + t.weekBets + ' bet' + (t.weekBets === 1 ? '' : 's') + ' this week, needs ' + r.minBets + '</small>' : '<small>' + (r.metric === 'ret' ? 'Win % ' + (t.pct == null ? '–' : t.pct + '%') : 'Return ' + (t.ret == null ? '–' : (t.ret > 0 ? '+' : '') + t.ret + '%')) + (t.streak ? ' · ' + (t.streak[0] === 'W' ? 'won ' : 'lost ') + (t.streak.slice(1) === '1' ? 'last' : t.streak.slice(1) + ' straight') : '') + (t.open ? ' · ' + t.open + ' open' : '') + (x.noBets ? ' · no synced bets' : '') + '</small>';
      h += '<button class="gtrow' + (x.pid === gr.me ? ' me' : '') + '" data-a="player" data-pid="' + att(x.pid) + '"><span class="gpl' + (x.place === 1 && (t.w + t.l) ? ' ggold' : '') + '">' + x.place + '</span><span class="gpn"><b>' + esc(x.name) + (x.pid === gr.me ? ' · you' : '') + '</b>' + sub + '</span><span class="gr">' + rec(t) + '</span><span class="gr gv ' + vcls(t, r.metric) + '">' + val(t, r.metric) + '</span></button>';
    });
    const hs = (d.high || []).filter((x) => x.done).slice(-1)[0];
    if (hs && s.tab === 'season') h += '<button class="gcard gbtn" data-a="player" data-pid="' + att(hs.pid) + '" data-week="' + hs.week + '"><small class="gmut">Week ' + hs.week + ' high score ›</small><div>' + esc(hs.name) + ', ' + (r.metric === 'units' || r.metric === 'pct' ? (hs.val > 0 ? '+' : '') + hs.val + 'u' : usd(hs.val, true)) + ' on ' + hs.n + ' bet' + (hs.n === 1 ? '' : 's') + '</div></button>';
    h += '<div class="gnote">Tap a player to see every bet behind the number.' + (r.cap ? ' Bets over the ' + usd(r.cap) + ' cap count as ' + usd(r.cap) + '.' : '') + (gr.fmt === 'best5' ? ' Only each player\'s five best results each week count.' : '') + ' Other players\' bets show once their game kicks off.</div>';
    return h;
  }
  function potBody(p, rows, gr) {
    const ranked = (rows || []).filter((x) => x.t.w + x.t.l + x.t.p > 0), final = gr.ended;
    let h = '<div class="gcard"><h2>Pot</h2><div class="gkv"><span>Entries marked paid</span><b>' + p.paid + ' of ' + p.members + ' × ' + usd(p.entry) + ' = ' + usd(p.pot) + '</b></div><div class="gkv"><span>Expected pot (every member pays)</span><b>' + usd(p.expected) + '</b></div>';
    h += '<div class="gkv"><span>Commissioner\'s take<small>' + esc(gr.takeText) + '</small></span><b>' + (p.take ? '-' + usd(p.take) : '$0') + '</b></div><div class="gkv gtot"><span>Prize pool</span><b class="ggold">' + usd(p.pool) + '</b></div></div>';
    h += '<div class="gcard"><h2>' + (final ? 'Who is owed what (final)' : 'Who is owed what if it ended now') + '</h2>';
    if (!p.places.length) h += '<div class="gmut">Bragging rights only. No prizes.</div>';
    p.places.forEach((x) => { const w = ranked[x.place - 1]; h += '<div class="gkv"><span>' + ord(x.place) + ' · ' + x.pct + '%<small>' + (w ? esc(w.name) : 'Nobody yet') + '</small></span><b>' + usd(x.amt) + '</b></div>'; });
    h += '</div><div class="gnote">' + MONEYLINE + ' Only entries the commissioner marked paid are in the pot.</div>';
    return h;
  }
  function potV() { const s = stack[stack.length - 1]; if (!s.data) return '<div class="gcard">Loading…</div>'; return '<h1>' + esc(s.data.group.name) + '</h1>' + potBody(s.data.pot, s.data.rows, s.data.group); }
  // ---- one player's bets ----
  function playerV() {
    const s = stack[stack.length - 1], d = s.data; if (!d) return '<div class="gcard">Loading bets…</div>';
    const gr = s.gr || {}, r = gr.rules || { metric: 'win' }, t = d.t, f = s.f || 'all';
    let h = '<h1>' + esc(d.name) + (d.me ? ' · you' : '') + '</h1><div class="gmeta">' + (d.scope === 'week' ? 'Week ' + d.week : 'Whole group') + (gr.fmt === 'best5' ? ' · ★ = one of the five that count that week' : '') + '</div>';
    h += '<div class="gseg">' + [['season', 'Season'], ['week', 'Week ' + d.week]].map(([k, l]) => '<button class="' + (d.scope === k ? 'on' : '') + '" data-pscope="' + k + '">' + l + '</button>').join('') + '</div>';
    h += '<div class="g2">' + tile('Record', rec(t), '', 'data-f="settled"') + tile(MCOL[r.metric], val(t, r.metric), vcls(t, r.metric), 'data-f="settled"') + tile('Won', String(t.w), 'gpos', 'data-f="won"') + tile('Lost', String(t.l), 'gneg', 'data-f="lost"') + tile('Open', String(t.open), '', 'data-f="open"') + tile('Counted stake', usd(t.stake), '', 'data-f="settled"', 'Return ' + (t.ret == null ? '–' : (t.ret > 0 ? '+' : '') + t.ret + '%')) + '</div>';
    if (f !== 'all') h += '<button class="glink" data-f="all">Showing ' + (f === 'settled' ? 'settled' : f) + ' bets · show all ›</button>';
    const list = d.bets.filter((b) => f === 'all' || (f === 'settled' ? b.res && b.ok : f === 'open' ? !b.res && b.ok : b.res === f && b.ok));
    if (!list.length) h += '<div class="gcard gmut">No bets here yet.</div>';
    const TN = { sp: 'Spread', ml: 'Moneyline', ou: 'Total', prop: 'Prop', parlay: 'Parlay' };
    list.forEach((b) => {
      const pill = b.res === 'won' ? '<span class="gpill gpos">Won</span>' : b.res === 'lost' ? '<span class="gpill gneg">Lost</span>' : b.res === 'push' ? '<span class="gpill">Push</span>' : '<span class="gpill">Open</span>';
      h += '<div class="gbet' + (b.ok ? '' : ' gno') + (b.res === 'won' ? ' hit' : b.res === 'lost' ? ' miss' : '') + '"><span class="gbw"><b>' + (b.best ? '★ ' : '') + esc(b.what) + '</b><small>' + esc(TN[b.type] || b.type) + ' · ' + usd(b.stake) + (b.capped ? ' (counts as ' + usd(b.cs) + ')' : '') + (b.ver ? ' · verified' : '') + ' · Wk ' + b.wk + ' · ' + esc(b.d ? fmtDay(b.d) : '') + '</small>' + (b.ok ? '' : '<small class="gyel">Does not count: ' + esc(b.why) + '</small>') + '</span><span class="gr">' + pill + (b.res && b.ok ? '<b class="' + (b.pl > 0 ? 'gpos' : b.pl < 0 ? 'gneg' : '') + '">' + usd(b.pl, true) + '</b>' : '') + '</span></div>';
    });
    if (d.hidden) h += '<div class="gcard gdash gmut">' + d.hidden + ' bet' + (d.hidden === 1 ? ' is' : 's are') + ' hidden until ' + (d.hidden === 1 ? 'its game kicks' : 'their games kick') + ' off, so nobody can copy a pick.</div>';
    return h;
  }

  // ---------- paint ----------
  const el = () => document.getElementById('ogrp');
  function paintBusy(on) { const e = el(); if (e) e.classList.toggle('gbusy', !!on); }
  function paint() {
    const e = el(); if (!e) return; const s = stack[stack.length - 1];
    const back = stack.length > 1 ? (s.t === 'members' || s.t === 'rules' || s.t === 'pot' || s.t === 'player' ? (stack[stack.length - 2].t === 'home' ? 'Groups' : 'Back') : s.t === 'create2' ? 'Back' : 'Groups') : '';
    const body = s.t === 'home' ? home() : s.t === 'join' ? joinV() : s.t === 'create1' ? create1() : s.t === 'create2' ? create2() : s.t === 'rules' ? rulesV() : s.t === 'members' ? membersV() : s.t === 'stand' ? standV() : s.t === 'pot' ? potV() : s.t === 'player' ? playerV() : '';
    e.querySelector('.gin0').innerHTML = top(back) + (err ? '<div class="gerr" role="alert">' + esc(err) + '</div>' : '') + body;
  }
  function push(o) { readDraft(); err = ''; stack.push(o); paint(); const e = el(); if (e) e.scrollTop = 0; }
  async function loadHome() { try { H = await post('mine', {}); err = ''; } catch (e) { err = errText(e); if (!H) H = { groups: [], open: [], pending: [] }; } if (stack[stack.length - 1].t === 'home') paint(); }
  async function loadGroup(o) { try { const j = await post('get', { id: o.id }); o.gr = j.group; } catch (e) { err = errText(e); } paint(); }
  async function loadStand(o) { try { o.data = await post('standings', { id: o.id, scope: o.tab === 'week' ? 'week' : 'season', week: o.week }); err = ''; } catch (e) { err = errText(e); } paint(); }
  async function loadPlayer(o) { try { o.data = await post('player', { id: o.id, pid: o.pid, scope: o.scope, week: o.week }); if (!o.gr) { const j = await post('get', { id: o.id }); o.gr = j.group; } err = ''; } catch (e) { err = errText(e); } paint(); }
  const cur = () => stack[stack.length - 1];
  const gid = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].id) return stack[i].id; return null; };

  function click(ev) {
    const t = ev.target.closest('button,a,[data-a]'); if (!t || t.disabled) return; const a = t.getAttribute('data-a'), id = t.getAttribute('data-id'), pid = t.getAttribute('data-pid');
    if (a === 'close') { readDraft(); try { sessionStorage.removeItem('ogrp-open'); } catch (x) {} el().remove(); return; }
    if (a === 'back') { readDraft(); err = ''; if (stack.length > 1) stack.pop(); const s = cur(); if (s.t === 'home') loadHome(); else if (s.t === 'members' || s.t === 'rules') loadGroup(s); else if (s.t === 'stand') loadStand(s); paint(); return; }
    if (t.hasAttribute('data-sport')) { readDraft(); DR.sport = t.getAttribute('data-sport'); paint(); return; }
    if (t.hasAttribute('data-fmt')) { readDraft(); DR.fmt = t.getAttribute('data-fmt'); paint(); return; }
    if (t.hasAttribute('data-ver')) { readDraft(); DR.verified = t.getAttribute('data-ver') === '1'; paint(); return; }
    if (t.hasAttribute('data-type')) { readDraft(); const k = t.getAttribute('data-type'); DR.types[k] = !DR.types[k]; paint(); return; }
    if (t.hasAttribute('data-metric')) { readDraft(); DR.metric = t.getAttribute('data-metric'); paint(); return; }
    if (t.hasAttribute('data-j')) { readDraft(); const k = t.getAttribute('data-j'); DR.join[k] = !DR.join[k]; paint(); return; }
    if (t.hasAttribute('data-tab')) { const s = cur(); s.tab = t.getAttribute('data-tab'); if (s.tab !== 'prizes') loadStand(s); paint(); return; }
    if (t.hasAttribute('data-pscope')) { const s = cur(); s.scope = t.getAttribute('data-pscope'); s.f = 'all'; loadPlayer(s); return; }
    if (t.hasAttribute('data-f')) { const s = cur(); s.f = t.getAttribute('data-f'); paint(); const e = el(), l = e && e.querySelector('.gbet,.gcard.gmut'); if (l && s.f !== 'all') l.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (a === 'create') { DR = draftFrom(null); push({ t: 'create1' }); return; }
    if (a === 'join') { push({ t: 'join' }); setTimeout(() => { const i = document.getElementById('gcode'); if (i) i.focus(); }, 50); return; }
    if (a === 'next') { readDraft(); if (DR.name.trim().length < 2) { err = 'Give the group a name (2+ characters).'; paint(); return; } if (!startOf(DR)) { err = 'Pick a start date.'; paint(); return; } push({ t: 'create2' }); return; }
    if (a === 'submit') { readDraft(); const p = payload(); act(DR.id ? 'edit' : 'create', p, async (j) => { DR = null; stack = [{ t: 'home' }]; await loadHome(); push({ t: 'members', id: j.group.id, gr: j.group }); }); return; }
    if (a === 'edit') { const s = cur(); const gr = s.gr || (s.data && s.data.group); if (!gr) return; DR = draftFrom(gr); push({ t: 'create1' }); return; }
    if (a === 'open') { const s = { t: 'stand', id, tab: 'season' }; push(s); loadStand(s); return; }
    if (a === 'members') { const s = { t: 'members', id: id || gid() }; push(s); loadGroup(s); return; }
    if (a === 'rules') { const s = { t: 'rules', id: id || gid() }; const o = H && (H.groups.concat(H.open)).find((x) => x.id === s.id); if (o) s.gr = o; push(s); loadGroup(s); return; }
    if (a === 'pot') { const s = { t: 'pot', id: id || gid() }; const st = cur(); if (st.t === 'stand' && st.data) s.data = st.data; push(s); if (!s.data) post('standings', { id: s.id, scope: 'season' }).then((j) => { s.data = j; paint(); }).catch((e) => { err = errText(e); paint(); }); return; }
    if (a === 'player') { const s = { t: 'player', id: id || gid(), pid, scope: t.getAttribute('data-week') ? 'week' : (cur().t === 'stand' && cur().tab === 'week' ? 'week' : 'season'), week: +t.getAttribute('data-week') || (cur().data && cur().data.week) || undefined, gr: (cur().data && cur().data.group) || cur().gr }; push(s); loadPlayer(s); return; }
    if (a === 'preview') { const s = cur(); s.code = (document.getElementById('gcode') || {}).value || ''; act('preview', { code: s.code }, async (j) => { s.pre = j.group; paint(); }); return; }
    if (a === 'dojoin') { const s = cur(); act('join', { code: s.code }, async (j) => { stack = [{ t: 'home' }]; await loadHome(); const o = { t: 'stand', id: j.group.id, tab: 'season' }; push(o); loadStand(o); }); return; }
    if (a === 'request') { act('request', { id }, async () => { stack = [{ t: 'home' }]; await loadHome(); paint(); }); return; }
    if (a === 'cancel') { act('cancel', { id }, async () => { await loadHome(); }); return; }
    if (a === 'approve' || a === 'deny') { const s = cur(); act('decide', { id: s.id, pid, ok: a === 'approve' }, async (j) => { s.gr = j.group; paint(); }); return; }
    if (a === 'paid' || a === 'unpaid') { const s = cur(); act('paid', { id: s.id, pid, paid: a === 'paid' }, async (j) => { s.gr = j.group; paint(); }); return; }
    if (a === 'reqtoggle') { const s = cur(); act('requests', { id: s.id, on: !s.gr.join.requests }, async (j) => { s.gr = j.group; paint(); }); return; }
    if (a === 'copy') { const c = cur().gr && cur().gr.code; try { navigator.clipboard.writeText(c); t.textContent = 'Copied'; } catch (x) { t.textContent = c; } return; }
    if (a === 'leave') { if (!confirm('Leave this group?')) return; act('leave', { id: cur().id }, async () => { stack = [{ t: 'home' }]; await loadHome(); paint(); }); return; }
    if (a === 'delete') { if (!confirm('Delete this group for everyone? This cannot be undone.')) return; act('delete', { id: cur().id }, async () => { stack = [{ t: 'home' }]; await loadHome(); paint(); }); return; }
  }
  function change(ev) {
    const id = ev.target && ev.target.id; if (!id) return; const s = cur();
    if (id === 'gweek') { s.week = +ev.target.value; loadStand(s); return; }
    if (['gstart', 'gruns', 'gsd', 'ged', 'gtake', 'gentry', 'gtv', 'gmax', 'glegs'].includes(id)) { readDraft(); paint(); }
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
      + '#ogrp .grow{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}#ogrp .gname{font-size:20px;font-weight:700;background:none;border:0;padding:0;text-align:left;min-height:44px;flex:1;min-width:0;overflow-wrap:anywhere}'
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
      + '@media (max-width:360px){#ogrp .g3{grid-template-columns:1fr 1fr}#ogrp .gthead,#ogrp .gtrow{grid-template-columns:24px minmax(0,1fr) 56px 72px}}';
    document.head.appendChild(st);
  }
  window.oddGroups = function () {
    css(); let e = el(); if (e) e.remove(); e = document.createElement('div'); e.id = 'ogrp'; e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', 'Groups');
    e.innerHTML = '<div class="gin0"></div>'; document.body.appendChild(e); try { sessionStorage.setItem('ogrp-open', '1'); } catch (x) {}
    stack = [{ t: 'home' }]; err = ''; e.addEventListener('click', click); e.addEventListener('change', change); paint(); loadHome();
  };
  // A reload while Groups is open (new version, sync from another device) puts it back instead of dropping the player on the main screen.
  try { if (sessionStorage.getItem('ogrp-open') === '1') setTimeout(() => { if (!document.getElementById('ogrp') && window.oddGroups && g('odd-tok')) window.oddGroups(); }, 1500); } catch (e) {}
})();
