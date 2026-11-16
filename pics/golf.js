// Oddable Golf (engine v1). Full-screen overlay #ogolf (pattern of dash.js / groups.js), opened from the "Golf" menu item or a ?join=golf.<code> link.
// Every score, standing and rule comes from the server (odds-api/golf.js); this file only shows them and sends entries.
// Money is information only: Oddable never collects, holds or pays money.
(function () {
  const API = (window.ODD_GOLF_API || window.ODD_GROUPS_API || location.origin + '') + '/golf/';
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const att = (x) => esc(String(x == null ? '' : x).replace(/[^\w.:-]/g, ''));
  const usd = (n) => { const v = Math.round((Number(n) || 0) * 100) / 100; return '$' + (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)); };
  const tp = (v) => (v == null ? '–' : v === 0 ? 'E' : v > 0 ? '+' + v : String(v));
  const tcls = (v) => (v == null || v === 0 ? '' : v < 0 ? 'opos' : 'oneg');
  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const HCPL = 'Oddable Handicap Index', HCPN = 'Calculated with the World Handicap System method.';
  const CAPLINE = 'Up to 8 golfers. Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.';
  const MONEY = 'Money is settled outside the app. Oddable never collects, holds or pays money.';
  const FMT = {
    scramble4: ['4-person scramble', 'team', 'Everyone tees off, the team picks the best shot, everyone plays from there, and the team writes down one score per hole.'],
    scramble2: ['2-person scramble', 'team', 'Both players hit every shot, the team picks the better one and both play from there; one team score per hole.'],
    texas: ['Texas scramble', 'team', "A scramble where each player's tee shot must be used at least the set number of times; the app counts drives used and warns when someone is running short."],
    florida: ['Florida (step-aside)', 'team', 'A scramble where the player whose shot was used sits out the very next shot, so no one\'s shot is used twice in a row.'],
    shamble: ['Shamble', 'team', 'Everyone tees off, the team picks the best drive, then each player plays their own ball in; the best set number of scores on each hole count.'],
    bestball: ['Best ball', 'team', 'Everyone plays their own ball the whole hole and the team takes the best one (or best two) scores on each hole.'],
    altshot: ['Alternate shot', 'team', 'Two players hit one ball, taking turns on every shot (one tees off on odd holes, the other on even holes).'],
    chapman: ['Chapman', 'team', 'Both partners tee off, swap balls for the second shot, pick one ball after that, and alternate shots into the hole.'],
    stroke: ['Stroke play', 'ind', 'Every stroke counts; lowest total for the round wins.'],
    stableford: ['Stableford', 'ind', 'Points per hole against par: double bogey or worse 0, bogey 1, par 2, birdie 3, eagle 4, albatross 5; most points wins.'],
    nassau: ['Nassau', 'ind', 'Three bets in one match: the front nine, the back nine and the full 18, each won by winning more holes; a press starts a new bet for the rest of that nine.'],
    skins: ['Skins only', 'ind', 'Each hole is worth a skin; the lowest score alone wins it, and if anyone ties the skin carries over to the next hole.'],
  };
  const TEAMBALL = { scramble4: 1, scramble2: 1, texas: 1, florida: 1, altshot: 1, chapman: 1 };
  const ALLOW = { scramble4: [25, 20, 15, 10], scramble2: [35, 15], texas: [25, 20, 15, 10], florida: [25, 20, 15, 10], altshot: [50, 50], chapman: [60, 40] };
  const SIZE = { scramble4: 4, scramble2: 2, texas: 4, florida: 4, shamble: 4, bestball: 4, altshot: 2, chapman: 2, stroke: 4, stableford: 4, nassau: 2, skins: 4 };
  const STATES = [['','Any state'],['AL','AL'],['AK','AK'],['AZ','AZ'],['AR','AR'],['CA','CA'],['CO','CO'],['CT','CT'],['DE','DE'],['DC','DC'],['FL','FL'],['GA','GA'],['HI','HI'],['ID','ID'],['IL','IL'],['IN','IN'],['IA','IA'],['KS','KS'],['KY','KY'],['LA','LA'],['ME','ME'],['MD','MD'],['MA','MA'],['MI','MI'],['MN','MN'],['MS','MS'],['MO','MO'],['MT','MT'],['NE','NE'],['NV','NV'],['NH','NH'],['NJ','NJ'],['NM','NM'],['NY','NY'],['NC','NC'],['ND','ND'],['OH','OH'],['OK','OK'],['OR','OR'],['PA','PA'],['RI','RI'],['SC','SC'],['SD','SD'],['TN','TN'],['TX','TX'],['UT','UT'],['VT','VT'],['VA','VA'],['WA','WA'],['WV','WV'],['WI','WI'],['WY','WY']];
  const MC = { w1: 'Worst made-cut score +1', p10: 'Own score +10', out: 'Out of your four' }, TB = { score: 'Guess the winning score', best: 'Best single golfer' };
  let stack = [{ t: 'home' }], busy = false, err = '', DR = null, timer = null;

  // ---------- server + offline queue ----------
  async function post(op, b) {
    const r = await fetch(API + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': ls('odd-tok') || '' }, body: JSON.stringify(Object.assign({ myName: ls('odd-name') || '' }, b || {})) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server said ' + r.status), { status: r.status, j }); return j;
  }
  const offline = (e) => e && /Failed to fetch|NetworkError|Load failed|network/i.test(e.message || '');
  const errText = (e) => (offline(e) ? 'Could not reach the server. It may be waking up: try again in a few seconds.' : e && e.status === 401 ? 'Sign in to use Golf.' : (e && e.message) || 'Something went wrong');
  async function act(op, b, then, pre) { if (busy) return; busy = true; err = ''; paintBusy(true); try { const j = await post(op, b); busy = false; await then(j); } catch (e) { busy = false; err = (pre || '') + errText(e); paint(); } paintBusy(false); }
  const G16 = 'In group play your pick is saved on the server the moment you add it, and it is locked: it cannot be changed.', NOTSAVED = 'Not saved, try again. ';
  // OFFLINE SCORES ARE NEVER LOST (review fix, Nov 16 2026). Every entry is written to the phone first (with an eid, so a retry is harmless), then sent.
  //  - no answer / server error / rate limit / signed out: the entry STAYS in the queue and is retried (every 10 s, when the signal returns, when the app is reopened)
  //  - the server refuses it for good (hole confirmed, changed by someone else ...): it moves to the "not saved" list, shown on the board with Try again / Discard.
  //    Nothing is ever dropped without the scorer seeing it. Entries are removed one by one by eid, so a score typed while another is sending is kept.
  const MEM = { 'golf-q': [], 'golf-qf': [] };
  const qGet = (k) => { const raw = ls(k); if (raw == null) return MEM[k].slice(); try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (e) { return MEM[k].slice(); } };
  const qPut = (k, q) => { MEM[k] = q.slice(); ls(k, q.length ? JSON.stringify(q) : null); };
  const Q = () => qGet('golf-q'), QF = () => qGet('golf-qf');
  const qDrop = (k, eid) => qPut(k, qGet(k).filter((x) => x.eid !== eid));
  const keepTrying = (e) => !e || !e.status || e.status >= 500 || e.status === 429 || e.status === 408 || e.status === 401;
  let flushing = false, qWhy = '';
  async function flush() {
    if (flushing) return; flushing = true; let changed = false;
    try { for (let guard = 0; guard < 500; guard++) { const it = Q()[0]; if (!it) break;
      try { const j = await post('score', it); qDrop('golf-q', it.eid); qWhy = ''; changed = true; const s = stack.find((x) => x.id === it.id && x.g); if (s) s.g = j.game; setG(j.game); }
      catch (e) { if (keepTrying(e)) { qWhy = e && e.status === 401 ? 'Sign in again to send them.' : ''; break; }
        qDrop('golf-q', it.eid); qPut('golf-qf', QF().concat(Object.assign({}, it, { why: (e && e.message) || 'The server refused it', at: Date.now() }))); changed = true; } } }
    finally { flushing = false; }
    if (changed) paint();
  }
  window.addEventListener('online', flush); document.addEventListener('visibilitychange', () => { if (!document.hidden && Q().length) flush(); }); setInterval(() => { if (Q().length) flush(); }, 10000);
  function queueScore(b) { const it = Object.assign({ eid: Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }, b); qPut('golf-q', Q().concat(it)); return flush(); }
  const qBox = (g) => { const q = Q().filter((x) => x.id === g.id), f = QF().filter((x) => x.id === g.id); let h = '';
    if (q.length) h += '<div class="owarn"><b>' + q.length + ' score' + (q.length === 1 ? '' : 's') + ' waiting to send</b>Saved on this phone (hole' + (q.length === 1 ? ' ' : 's ') + esc(q.map((x) => x.hole).join(', ')) + '). They send by themselves when the server answers. ' + esc(qWhy) + '<button class="osec ofull" data-a="qsend">Send now</button></div>';
    f.forEach((x) => { h += '<div class="owarn omiss"><b>Not saved: ' + esc(tname(g, x.tid)) + ' hole ' + esc(x.hole) + '</b>' + esc(x.why) + ' Your entry is kept here until you decide.<div class="o2"><button class="osec" data-a="qretry" data-eid="' + att(x.eid) + '">Try again</button><button class="osec" data-a="qdrop" data-eid="' + att(x.eid) + '">Discard</button></div></div>'; });
    return h; };

  // ---------- small parts ----------
  const top = (back, right) => '<div class="otop">' + (back ? '<button class="oback" data-a="back">‹ ' + esc(back) + '</button>' : '<span></span>') + (right || '<button class="ox" data-a="close" aria-label="Close Golf">Close</button>') + '</div>';
  const seg = (opts, cur, a) => '<div class="oseg">' + opts.map(([v, l]) => '<button class="' + (String(v) === String(cur) ? 'on' : '') + '" ' + a + '="' + att(v) + '">' + esc(l) + '</button>').join('') + '</div>';
  const sel = (id, opts, cur) => '<select id="' + id + '" class="osel">' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
  const sw = (on, a) => '<button class="osw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" ' + a + '><i></i></button>';
  const info = (k) => '<button class="oi" data-a="info" data-k="' + att(k) + '" aria-label="What is this?">ⓘ</button>';
  const cur = () => stack[stack.length - 1];
  const G = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].g) return stack[i].g; return null; };
  const nm = (g, pid) => { const m = (g.members || []).find((x) => x.pid === pid); return m ? m.name : 'Player'; };
  const tname = (g, tid) => { const t = ((g.day && g.day.teams) || []).find((x) => x.tid === tid); return t ? t.name : tid; };
  const side = (g, kind, id) => (kind === 'player' ? nm(g, id) : tname(g, id));

  // ---------- home ----------
  function home() {
    const s = cur(); let h = '<h1>Golf</h1><p class="osub">Pools on the pro tours, or your own golf day with every format and heads-up matches.</p>';
    h += '<div class="o2"><button class="opri" data-a="newpro">Pro tournament</button><button class="opri" data-a="newday">Our golf day</button></div>';
    h += '<div class="o2"><button class="osec" data-a="solo">Solo round</button><button class="osec" data-a="join">Join with a code</button></div>';
    h += '<div class="onote">' + CAPLINE + '</div><h3 class="oh">My golf</h3>';
    if (!s.list) h += '<div class="ocard omut">Loading…</div>'; else if (!s.list.length) h += '<div class="ocard omut">Nothing yet. Start one, or ask a friend for their invite link.</div>';
    (s.list || []).forEach((x) => { const sub = x.kind === 'pro' ? (x.pro.game === 'six' ? 'Pick six' : 'One and done') + (x.pro.eventName ? ' · ' + x.pro.eventName : '') : (x.day.solo ? 'Solo round' : (FMT[x.day.fmt] || [''])[0]) + ' · ' + x.day.course.name + ' · ' + (x.day.status === 'live' ? 'live' : x.day.status === 'final' ? 'final' : 'setting up');
      h += '<button class="ocard obtn" data-a="open" data-id="' + att(x.id) + '"><div class="orow"><b class="oname">' + esc(x.title) + '</b>' + (x.role === 'org' ? '<span class="obadge">Organizer</span>' : '') + '</div><div class="ometa">' + esc(sub) + ' · ' + x.count + ' golfer' + (x.count === 1 ? '' : 's') + ' ›</div></button>'; });
    return h;
  }
  function joinV() {
    const s = cur(), gr = s.pre; let h = '<h1>Join a golf game</h1><label class="olab">Invite code<input id="ocode" class="oin ocodein" autocomplete="off" autocapitalize="characters" maxlength="20" placeholder="ABCDE23456" value="' + esc(s.code || '') + '"></label><button class="opri ofull" data-a="look">Look it up</button>';
    if (gr) {
      h += '<div class="ocard"><b class="oname">' + esc(gr.title) + '</b><div class="ometa">' + (gr.kind === 'pro' ? 'Pro tournament · ' + esc(gr.pro.game === 'six' ? 'Pick six' : 'One and done') + (gr.pro.eventName ? ' · ' + esc(gr.pro.eventName) : '') : 'Golf day · ' + esc((FMT[gr.day.fmt] || [''])[0]) + ' · ' + esc(gr.day.course.name + ' · ' + gr.day.course.tees + ' tees')) + '</div>' + rulesList(gr) + '</div>';
      if (gr.role !== 'none') h += '<button class="osec ofull" data-a="open" data-id="' + att(gr.id) + '">You are in. Open it ›</button>';
      else { h += '<label class="olab">Your handicap (optional)<input id="ojh" class="oin" type="number" inputmode="decimal" step="0.1" min="-10" max="54" placeholder="e.g. 14"></label><div class="onote">Unofficial. The organizer can change it.</div>';
        h += '<button class="opri ofull" data-a="dojoin">Join ' + esc(gr.title) + '</button>';
        if (gr.kind === 'day' && gr.day.open && gr.day.open.length) h += '<h3 class="oh">Or claim an open team spot</h3>' + gr.day.open.map((t) => '<button class="osec ofull" data-a="dojoin" data-tid="' + att(t.tid) + '">Join ' + esc(t.name) + ' · ' + t.free + ' spot' + (t.free === 1 ? '' : 's') + ' open</button>').join(''); }
      h += '<div class="onote">' + CAPLINE + '</div>';
    }
    return h;
  }
  function rulesList(g) {
    const rows = [], p = g.pot || { entry: 0, take: { kind: 'none' } };
    if (g.kind === 'pro') { rows.push(['Tour', (g.pro.tour || '').toUpperCase()]); if (g.pro.game === 'six') { rows.push(['Game', 'Pick six: one golfer from each of six tiers, best four scores count, lowest total wins']); rows.push(['Missed cut', MC[g.pro.mc]]); rows.push(['Tiebreaker', TB[g.pro.tb]]); rows.push(['Picks lock', fmtTime(g.pro.lockAt) + ' (first tee time)']); } else rows.push(['Game', 'One and done: one golfer per tournament all season, never the same one twice']); }
    else { const d = g.day; rows.push(['Course', d.course.name + ' · ' + d.course.tees + ' tees · par ' + d.course.par.reduce((a, x) => a + x, 0)]); rows.push(['Format', (FMT[d.fmt] || [''])[0] + (d.count ? ' (best ' + d.count + ')' : '')]); rows.push(['Scoring', d.net === 'gross' ? 'Gross' : d.net === 'both' ? 'Gross and net' : 'Net with handicaps']); if (d.heads && d.heads.on) rows.push(['Heads-up', (d.heads.type === 'nassau' ? 'Nassau' : 'Match play') + ', ' + d.heads.kind + ' vs ' + d.heads.kind + (d.heads.amt ? ', ' + usd(d.heads.amt) + ' a match' : '')]);
      const ex = []; if (d.extras.skins.on) ex.push('skins' + (d.extras.skins.amt ? ' ' + usd(d.extras.skins.amt) : '')); if (d.extras.ctp.length) ex.push('closest to the pin #' + d.extras.ctp.join(', #')); if (d.extras.ld.length) ex.push('longest drive #' + d.extras.ld.join(', #')); if (ex.length) rows.push(['Extras', ex.join(' · ')]); }
    rows.push(['Entry', p.entry ? usd(p.entry) + ' · ' + (p.pot === 'side' ? 'side pot' : 'main pot') : 'No entry']); rows.push(["Organizer's take", p.take.kind === 'pct' ? p.take.v + '% of the pot' : p.take.kind === 'flat' ? usd(p.take.v) : 'None']);
    rows.push(['Golfers', g.count + ' of ' + (g.max > 8 ? g.max : 8)]);
    return '<div class="orules">' + rows.map(([k, v]) => '<div><small>' + esc(k) + '</small><span>' + esc(v) + '</span></div>').join('') + '</div><div class="onote">' + MONEY + '</div>';
  }

  // ---------- pro setup ----------
  function proSetup() {
    const d = DR; let h = '<div class="orow"><h1>Golf</h1><span class="omut">Add a golf contest</span></div>';
    h += seg([['pro', 'Pro tournament'], ['day', 'Our golf day']], 'pro', 'data-kind') + '<div class="onote">Pro tournament: scores come in live from the tour leaderboard. Our golf day: your own outing, your teams, scores typed in by the scorers.</div>';
    h += '<label class="olab">Name<input id="otitle" class="oin" maxlength="40" placeholder="Sunday Crew pool" value="' + esc(d.title) + '"></label>';
    h += '<label class="olab">Tour' + sel('otour', [['pga', 'PGA TOUR'], ['lpga', 'LPGA'], ['eur', 'DP World Tour'], ['liv', 'LIV Golf']], d.tour) + '</label>';
    h += '<div class="olab">Game ' + info(d.game === 'oad' ? 'oad' : 'six') + '</div>';
    [['six', 'Pick six (tiers)', 'One golfer from each of six tiers. Best four scores count. Lowest total wins.'], ['calc', 'Golfer Calcutta', 'Auction every golfer. Set up in the Calcutta screen of your group; this game only supplies the golfers.'], ['oad', 'One and done', 'Pick one golfer per event all season, never the same one twice. Most prize money (or finish points) wins.'], ['bets', 'Bets vs the group', 'Your real golf bets on the group leaderboard. Set up in Groups; golf bets are settled by hand (honor system).']].forEach(([k, t, x]) => { const off = k === 'calc' || k === 'bets'; h += '<button class="oopt' + (d.game === k ? ' on' : '') + (off ? ' soon' : '') + '" ' + (off ? 'disabled aria-disabled="true"' : 'data-game="' + k + '"') + '><span class="orow"><b>' + t + '</b><small>' + (off ? 'In Groups' : d.game === k ? 'Selected' : '') + '</small></span><span class="omut">' + x + '</span></button>'; });
    if (d.game === 'six') {
      const evs = d.events || []; h += '<label class="olab">Tournament' + (evs.length ? sel('oev', evs.map((e) => [e.id, e.name + (e.start ? ' · ' + new Date(e.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')]), d.eventId) : '<div class="ocard omut">' + (d.evErr ? esc(d.evErr) : 'Loading the schedule…') + '</div>') + '</label>';
      h += '<div class="o2"><label class="olab">Missed cut' + sel('omc', Object.entries(MC), d.mc) + '</label><label class="olab">Tiebreaker' + sel('otb', Object.entries(TB), d.tb) + '</label></div>';
      h += '<label class="olab">Tier order (optional): paste a ranking, one golfer per line<textarea id="orank" class="oin ota" rows="3" placeholder="Best golfer first">' + esc(d.rank) + '</textarea></label><div class="onote">Leave it empty for neutral tiers: the world ranking when the tour feed has it, else alphabetical by last name, so nobody chooses the order. If you paste your own list, that is logged and shown to everyone in the pool. No betting odds are used.</div>';
    }
    h += potForm(d) + '<div class="owarn"><b>Picks lock at the first tee time</b>' + (d.game === 'six' ? "Thursday's first group off. A golfer who withdraws before teeing off can be swapped once." : 'Each tournament locks at its own first tee time. Never the same golfer twice.') + '</div>';
    return h + '<div class="onote">' + CAPLINE + '</div><button class="opri ofull" data-a="createpro">Add golf contest</button>';
  }
  const potForm = (d) => '<div class="o2"><label class="olab">Entry ($)<input id="oentry" class="oin" type="number" inputmode="numeric" min="0" max="10000" step="1" value="' + esc(d.entry || '') + '" placeholder="0"></label><label class="olab">Pot' + sel('opot', [['main', 'Main pot'], ['side', 'Side pot']], d.pot) + '</label></div><label class="olab">Organizer\'s take' + sel('otake', [['none', 'None'], ['5', '5% of the pot'], ['10', '10% of the pot'], ['20', '20% of the pot']], d.take) + '</label><label class="olab">Payout table (% by place; leave empty for automatic)<input id="osplit" class="oin" inputmode="numeric" placeholder="e.g. 60 30 10" value="' + esc(d.split || '') + '"></label><div class="onote">Automatic pays fewer places in a small field: 2-3 players winner takes all, 4-6 pays 70/30, 7-11 pays 50/30/20. ' + MONEY + '</div>';
  function readDraft() {
    const v = (id) => { const e = document.getElementById(id); return e ? e.value : null; }, d = DR; if (!d) return;
    [['otitle', 'title'], ['otour', 'tour'], ['oev', 'eventId'], ['omc', 'mc'], ['otb', 'tb'], ['orank', 'rank'], ['oentry', 'entry'], ['opot', 'pot'], ['otake', 'take'], ['ofmt', 'fmt'], ['onet', 'net'], ['opct', 'pct'], ['ocount', 'count'], ['odrives', 'drives'], ['oteams', 'teams'], ['opair', 'pair'], ['ohkind', 'hkind'], ['ohtype', 'htype'], ['ohamt', 'hamt'], ['oskamt', 'skamt'], ['octp', 'ctp'], ['old', 'ld'], ['omyh', 'myHcp'], ['odate', 'date'], ['otee', 'tee'], ['osplit', 'split'], ['oskend', 'skend'], ['otsize', 'tsize'], ['odpen', 'dpen'], ['opress', 'press'], ['ohpct', 'hpct']].forEach(([id, k]) => { const x = v(id); if (x !== null) d[k] = x; });
    [0, 1, 2, 3].forEach((i) => { const x = v('oal' + i); if (x !== null) d.allow[i] = x; });
  }
  const potPayload = (d) => ({ split: String(d.split || '').trim() ? String(d.split).split(/[^0-9]+/).filter(Boolean).map(Number) : undefined, entry: Number(d.entry) || 0, pot: d.pot, take: d.take === 'none' ? { kind: 'none' } : { kind: 'pct', v: Number(d.take) } });

  // ---------- golf day setup ----------
  function daySetup() {
    const d = DR, c = d.course; let h = '<div class="orow"><h1>' + (d.solo ? 'Solo round' : 'Golf day format') + '</h1><span class="omut">' + (d.solo ? 'just you' : 'Our golf day · organizer') + '</span></div>';
    h += '<div class="olab">Course and tees</div><button class="ocard obtn" data-a="course">' + (c ? '<b>' + esc(c.name) + '</b> · ' + esc(c.tees) + ' tees · par ' + c.par.reduce((a, x) => a + x, 0) + (c.rating ? ' · ' + c.rating + ' / ' + c.slope : '') + ' ›' : '<b>Pick a course</b><div class="omut">Search, pick a saved one, or type it in ›</div>') + '</button>';
    h += '<label class="olab">Name<input id="otitle" class="oin" maxlength="40" placeholder="' + (d.solo ? 'Saturday round' : 'Crew Golf Day') + '" value="' + esc(d.title) + '"></label><label class="olab">Date<input id="odate" class="oin" type="date" value="' + esc(d.date) + '"></label>';
    h += '<label class="olab">Your handicap (only if you have no ' + HCPL + ' yet)<input id="omyh" class="oin" type="number" inputmode="decimal" step="0.1" min="-10" max="54" value="' + esc(d.myHcp) + '" placeholder="e.g. 14"></label><div class="onote">Every round you play or log in the app counts toward your ' + HCPL + ', and that index is your handicap here. ' + HCPN + '</div>';
    if (d.solo) return h + '<div class="onote">Stroke play, hole by hole. Your round counts toward your stats and your ' + HCPL + '.</div><button class="opri ofull" data-a="createday">Start my round</button>';
    h += '<label class="olab">First tee time (optional; handicaps lock then)<input id="otee" class="oin" type="datetime-local" value="' + esc(d.tee || '') + '"></label>';
    const fb = (k) => '<span class="ofmtw"><button class="ofmt' + (d.fmt === k ? ' on' : '') + '" data-fmt="' + k + '">' + esc(FMT[k][0]) + '</button>' + info('fmt:' + k) + '</span>';
    h += '<div class="ocard"><h2>Team formats</h2><div class="o2g">' + ['scramble4', 'scramble2', 'texas', 'florida', 'shamble', 'bestball', 'altshot', 'chapman'].map(fb).join('') + '</div><div class="onote">' + esc(FMT[d.fmt][2]) + '</div>';
    if (TSIZES[d.fmt]) h += '<label class="olab">Players per team' + sel('otsize', TSIZES[d.fmt].map((n) => [n, n + ' players']), tsz(d)) + '</label>';
    if (TEAMBALL[d.fmt]) h += '<div class="olab">Team handicap allowance (%), lowest handicap first ' + info('allow') + '</div><div class="o4">' + alw(d).map((x, i) => '<input id="oal' + i + '" class="oin" type="number" inputmode="numeric" min="0" max="100" value="' + esc(d.allow[i] == null ? x : d.allow[i]) + '" aria-label="Allowance ' + (i + 1) + '">').join('') + '</div><div class="onote">Starting numbers: 2 players 35/15, 3 players 30/20/10, 4 players 25/20/15/10. Change them if your group plays it differently.</div>';
    if (d.fmt === 'texas') h += '<div class="o2"><label class="olab">Drives each player must use<input id="odrives" class="oin" type="number" inputmode="numeric" min="1" max="9" value="' + esc(d.drives) + '"></label><label class="olab">Penalty per missing drive (strokes)<input id="odpen" class="oin" type="number" inputmode="numeric" min="0" max="10" value="' + esc(d.dpen) + '"></label></div><div class="onote">A team that finishes short of the drive count takes the penalty for each missing drive.</div>';
    if (d.fmt === 'shamble' || d.fmt === 'bestball') h += '<label class="olab">Scores that count per hole' + sel('ocount', [[1, 'Best 1'], [2, 'Best 2']], d.count) + '</label>';
    h += '</div><div class="ocard"><h2>Individual formats</h2><div class="o2g">' + ['stroke', 'stableford', 'nassau', 'skins'].map(fb).join('') + '</div>';
    if (!TEAMBALL[d.fmt]) h += '<label class="olab">Handicap used (% of each player\'s)<input id="opct" class="oin" type="number" inputmode="numeric" min="0" max="100" value="' + esc(d.pct) + '" placeholder="' + bbPct(d) + ' (usual)"></label>' + (d.fmt === 'bestball' ? '<div class="onote">Usual best ball numbers: pairs 85%, best 1 of 4 75%, a four-ball match 90%. Leave empty to use them.</div>' : '');
    h += '</div>';
    h += '<div class="ocard' + (d.hu ? ' oon' : '') + '"><div class="oline"><span><b>Heads-up matches ' + info('heads') + '</b><small>Match play, team vs team or player vs player, on top of the main format</small></span>' + sw(d.hu, 'data-tog="hu"') + '</div>';
    if (d.hu) h += '<div class="o2"><label class="olab">Pairings' + sel('opair', [['bracket', 'Bracket'], ['foursome', 'Same foursome'], ['pick', 'I pick'], ['random', 'Random draw']], d.pair) + '</label><label class="olab">Per match ($, info)<input id="ohamt" class="oin" type="number" inputmode="numeric" min="0" value="' + esc(d.hamt) + '"></label></div><div class="o2"><label class="olab">Who plays' + sel('ohkind', [['team', 'Team vs team'], ['player', 'Player vs player']], d.hkind) + '</label><label class="olab">Match type' + sel('ohtype', [['match', 'Match play'], ['nassau', 'Nassau']], d.htype) + '</label></div>' + (d.htype === 'nassau' ? '<label class="olab">Presses' + sel('opress', [['accept', 'A press must be accepted by the other side'], ['auto2', 'Auto press when 2 down']], d.press) + '</label>' : '') + (d.fmt === 'bestball' && d.hkind === 'team' ? '<label class="olab">Handicap used in the matches (%)<input id="ohpct" class="oin" type="number" inputmode="numeric" min="0" max="100" value="' + esc(d.hpct) + '" placeholder="90 (usual)"></label>' : '');
    h += '</div><div class="ocard"><h2>Scoring and extras</h2><div class="ohelp">Gross or net ' + info('net') + '</div>' + sel('onet', [['net', 'Net (handicaps)'], ['gross', 'Gross'], ['both', 'Both']], d.net);
    h += '<div class="oline"><span><b>Skins ' + info('skins') + '</b><small>Carry-overs; ' + (d.sknet ? 'net' : 'gross') + '</small></span>' + sw(d.skins, 'data-tog="skins"') + '</div>';
    if (d.skins) h += '<div class="o2"><button class="osec" data-tog="sknet">' + (d.sknet ? 'Net skins' : 'Gross skins') + '</button><label class="olab">Per skin ($, info)<input id="oskamt" class="oin" type="number" inputmode="numeric" min="0" value="' + esc(d.skamt) + '"></label></div><label class="olab">Skins still riding after the last hole' + sel('oskend', [['split', 'Shared by those tied on the last hole'], ['none', 'Nobody wins them']], d.skend || 'split') + '</label>';
    h += '<div class="ohelp">Closest to the pin and longest drive ' + info('ctp') + '</div><div class="o2"><label class="olab">Closest to the pin (holes)<input id="octp" class="oin" inputmode="numeric" placeholder="3, 12" value="' + esc(d.ctp) + '"></label><label class="olab">Longest drive (holes)<input id="old" class="oin" inputmode="numeric" placeholder="9" value="' + esc(d.ld) + '"></label></div>';
    h += '<label class="olab">Number of teams<input id="oteams" class="oin" type="number" inputmode="numeric" min="0" max="100" value="' + esc(d.teams) + '"></label>' + potForm(d) + '</div>';
    h += '<div class="onote">Team Calcutta: the teams are offered to your group\'s Calcutta. ' + CAPLINE + '</div>';
    return h + '<button class="opri ofull" data-a="createday">Next: teams and handicaps</button>';
  }
  // Starting allowances (all editable): scrambles by team size, best ball by game.
  const SCR = { 2: [35, 15], 3: [30, 20, 10], 4: [25, 20, 15, 10] }, TSIZES = { texas: [2, 3, 4], florida: [3, 4], bestball: [2, 3, 4], shamble: [2, 3, 4] };
  const tsz = (d) => { const f = d.solo ? 'stroke' : d.fmt, o = TSIZES[f]; return o && o.includes(Number(d.tsize)) ? Number(d.tsize) : SIZE[f]; };
  const alw = (d) => (['scramble4', 'scramble2', 'texas', 'florida'].includes(d.fmt) ? SCR[tsz(d)] || ALLOW[d.fmt] : ALLOW[d.fmt] || []);
  const bbPct = (d) => (d.fmt === 'bestball' ? (tsz(d) === 2 ? 85 : Number(d.count) === 1 && tsz(d) === 4 ? 75 : 90) : d.fmt === 'shamble' ? 80 : 100);
  const holes = (s) => String(s || '').split(/[^0-9]+/).map(Number).filter((x) => x >= 1 && x <= 18);
  function dayPayload() {
    const d = DR, fmt = d.solo ? 'stroke' : d.fmt;
    return { kind: 'day', solo: !!d.solo, title: d.title.trim() || (d.solo ? 'Solo round' : 'Golf day'), course: d.course, courseId: d.courseId || undefined, pot: potPayload(d),
      day: { fmt, net: d.net, allow: TEAMBALL[fmt] ? alw(d).map((x, i) => Number(d.allow[i] == null || d.allow[i] === '' ? x : d.allow[i])) : [], pct: d.pct === '' || d.pct == null ? null : Number(d.pct), count: Number(d.count), drives: Number(d.drives), drivePen: Number(d.dpen), teams: Number(d.teams) || 0, teamSize: tsz(d), date: d.date, myHcp: d.myHcp === '' ? null : Number(d.myHcp), teeTime: d.tee && Date.parse(d.tee) ? Date.parse(d.tee) : undefined,
        extras: { skins: { on: d.skins, net: d.sknet, amt: Number(d.skamt) || 0, end: d.skend === 'none' ? 'none' : 'split' }, ctp: holes(d.ctp), ld: holes(d.ld) }, hu: { on: d.hu, pair: d.pair, kind: d.hkind, type: d.htype, amt: Number(d.hamt) || 0, press: d.press === 'auto2' ? 'auto2' : 'accept', pct: d.hpct === '' || d.hpct == null ? null : Number(d.hpct) } } };
  }

  // ---------- course picker ----------
  function courseV() {
    const s = cur(); let h = '<h1>Pick a course</h1><label class="olab">Search by name or city<input id="oq" class="oin" value="' + esc(s.q || '') + '" placeholder="Palm Valley" autocomplete="off"></label><label class="olab">State' + sel('ost', STATES, s.st || '') + '</label><div class="onote">Pick a state alone to list its courses.</div><button class="opri ofull" data-a="csearch">Search</button>';
    const savedRow = (c) => '<button class="ocard obtn" data-a="csaved" data-id="' + att(c.id) + '"><b>' + esc(c.name) + '</b> · ' + esc(c.tees) + ' tees<div class="omut">Par ' + c.par.reduce((a, x) => a + x, 0) + (c.rating ? ' · rating ' + c.rating + ' · slope ' + c.slope : '') + (c.city ? ' · ' + esc(c.city) : '') + ' ›</div></button>';
    if (s.res && s.res.owned && s.res.owned.length) h += '<h3 class="oh">Your course</h3>' + s.res.owned.map(savedRow).join('');
    if (s.res) {
      if (s.res.courses.length) h += '<h3 class="oh">Saved courses</h3>' + s.res.courses.map(savedRow).join('');
      // PREVIEW FIX (course search): the list grows in place with "Show more courses"; a failed search says so and shows the labelled sample courses;
      // typing a course in is a separate, clearly named last choice.
      const A = s.res.api || {}, R = A.results || [], dirRow = (c) => '<button class="ocard obtn" data-a="cdir" data-x="' + att(c.extId) + '"><b>' + esc(c.name) + '</b><div class="omut">' + esc([c.city, c.state].filter(Boolean).join(', ')) + (c.par ? ' · par ' + c.par : '') + (c.mi != null ? ' · ' + c.mi + ' mi' : '') + ' ›</div></button>';
      if (A.error) h += '<div class="ocard"><b>' + esc(A.error) + '</b><button class="osec ofull" style="margin-top:10px" data-a="csearch">Try again</button></div>';
      if (R.length) h += '<h3 class="oh">' + (A.fallback ? 'Sample courses' : 'Course directory') + '</h3>' + (A.fallback ? '<div class="onote">' + esc(A.fallback) + '</div>' : '') + (A.near ? '<div class="onote">Courses with that name first, then courses near ' + esc(A.near) + '.</div>' : '') + R.map(dirRow).join('')
        + (A.next != null ? '<button class="osec ofull" data-a="cmore">Show more courses (' + R.length + ' of ' + (A.total || R.length) + ')</button>' : '') + '<div class="oattr">' + esc(A.attribution || '') + '</div>';
      else if (A.ok) h += '<h3 class="oh">Course directory</h3><div class="ocard omut">No course by that name. Try the city, or pick the state alone to list its courses.</div>';
    }
    return h + '<h3 class="oh">Can\'t find it?</h3><button class="osec ofull" data-a="cmanual">Enter a course yourself</button>';
  }
  function courseDetailV() {
    const s = cur(), c = s.c; if (!c) return '<div class="ocard">Loading the course…</div>';
    let h = '<h1>' + esc(c.name) + '</h1><div class="ometa">' + esc([c.city, c.state].filter(Boolean).join(', ')) + '</div>';
    if (!c.tees.length) h += '<div class="ocard omut">No tees are on file for this course.</div><button class="osec ofull" data-a="cmanual">Enter this course yourself</button>';
    c.tees.forEach((t, i) => { const open = s.ti === i;
      h += '<div class="ocard"><button class="otee" data-a="tee" data-i="' + i + '"><span><b>' + esc(t.name) + '</b>' + (t.gender ? ' <span class="omut">· ' + esc(t.gender) + '</span>' : '') + '</span><span class="ogrid4 ohd"><span>Yards</span><span>Par</span><span>Rating</span><span>Slope</span></span><span class="ogrid4"><span>' + (t.yards || '–') + '</span><span>' + (t.par || '–') + '</span><span>' + (t.rating || '–') + '</span><span>' + (t.slope || '–') + '</span></span><span class="olink">' + (open ? 'Hide holes' : 'Show holes') + ' ›</span></button>';
      if (open) { h += '<div class="ogrid4 ohd"><span>Hole</span><span>Par</span><span>Yards</span><span>Index</span></div>' + t.holes.map((x) => '<div class="ogrid4 ohole"><span>' + x.n + '</span><span>' + (x.par || '–') + '</span><span>' + (x.yards || '–') + '</span><span>' + (x.hcp || '–') + '</span></div>').join('');
        // PREVIEW FIX (course search): say plainly what the directory has. Complete, checked holes -> Play. Holes with no yardages (the directory's
        // placeholder list) -> Play is still offered, with a warning and a way to check them. Missing holes -> finish the card (rating, slope, yards kept).
        const n = t.holes.length, okH = n === 18 || n === 9, sure = t.checked !== false && okH && t.holes.every((x) => x.par && x.hcp);
        if (sure) h += '<button class="opri ofull" data-a="usetee" data-i="' + i + '">Play the ' + esc(t.name) + ' tees</button>';
        else if (okH && t.holes.every((x) => x.par && x.hcp)) h += '<div class="onote">The directory has no yardage for each hole on these tees, so the hole order may be wrong. Check the pars and handicap indexes against the scorecard.</div><button class="opri ofull" data-a="edittee" data-i="' + i + '">Check the holes, then play the ' + esc(t.name) + ' tees</button>';
        else h += '<div class="onote">' + (n ? 'The directory has ' + n + ' of 18 holes for these tees.' : 'The directory has no hole-by-hole card for these tees.') + ' Rating, slope and yards are filled in for you: add the holes from the scorecard.</div><button class="opri ofull" data-a="edittee" data-i="' + i + '">Add the holes for the ' + esc(t.name) + ' tees</button>'; }
      h += '</div>'; });
    return h + '<div class="oattr">' + esc(c.attribution || '') + '</div>';
  }
  function manualV() {
    const s = cur(), m = s.m; let h = '<h1>Type a course in</h1><label class="olab">Course name<input id="mname" class="oin" maxlength="50" value="' + esc(m.name) + '"></label><div class="o2"><label class="olab">Tees<input id="mtees" class="oin" maxlength="20" placeholder="White" value="' + esc(m.tees) + '"></label><label class="olab">Holes' + sel('mholes', [[18, '18'], [9, '9']], m.holes) + '</label></div>';
    h += '<div class="o2"><label class="olab">Course Rating<input id="mrating" class="oin" type="number" inputmode="decimal" step="0.1" value="' + esc(m.rating) + '" placeholder="70.4"></label><label class="olab">Slope Rating<input id="mslope" class="oin" type="number" inputmode="numeric" min="55" max="155" value="' + esc(m.slope) + '" placeholder="125"></label></div><div class="onote">Rating and slope are on the scorecard; they are needed for your ' + HCPL + '.</div>';
    h += '<div class="ogrid4 ohd"><span>Hole</span><span>Par</span><span>Index</span><span>Yards</span></div>';
    for (let i = 0; i < m.holes; i++) h += '<div class="ogrid4 ohole"><span>' + (i + 1) + '</span>' + sel('mp' + i, [[3, 3], [4, 4], [5, 5], [6, 6]], m.par[i] || 4) + sel('mh' + i, Array.from({ length: m.holes }, (_, k) => [k + 1, k + 1]), m.hcp[i] || i + 1) + '<input id="my' + i + '" class="oin" type="number" inputmode="numeric" min="50" max="800" value="' + esc(m.yards[i] || '') + '" aria-label="Yards hole ' + (i + 1) + '"></div>';
    return h + '<div class="onote">Each hole needs a different handicap index (1 = hardest).</div><button class="opri ofull" data-a="msave">Save and use this course</button>';
  }
  function readManual() { const m = cur().m; if (!m) return; const v = (id) => { const e = document.getElementById(id); return e ? e.value : null; }; ['name', 'tees', 'rating', 'slope'].forEach((k) => { const x = v('m' + k); if (x !== null) m[k] = x; }); const hn = v('mholes'); if (hn) m.holes = +hn; for (let i = 0; i < 18; i++) { const p = v('mp' + i), x = v('mh' + i), y = v('my' + i); if (p !== null) m.par[i] = +p; if (x !== null) m.hcp[i] = +x; if (y !== null) m.yards[i] = y; } }

  // ---------- pro board (Pool / My golfers / Tour board) ----------
  function proV() {
    const s = cur(), g = s.g; if (!g || !g.pro) return '<div class="ocard">Loading…</div>'; const tab = s.tab || 'pool';
    let h = '<h1>' + esc(g.title) + '</h1><div class="ometa">' + esc(g.pro.eventName || (g.pro.game === 'oad' ? 'One and done · ' + (g.oad && g.oad.season) : '')) + (g.feed && g.feed.ok && g.feed.event.round ? ' · Round ' + g.feed.event.round + (g.feed.event.done ? ' · final' : ' in progress') : '') + ' · ' + g.count + ' entr' + (g.count === 1 ? 'y' : 'ies') + '</div>';
    h += '<div class="ohelp">How it works ' + info(g.pro.game === 'oad' ? 'oad' : 'six') + '</div>';
    if (g.pro.game === 'oad') return h + oadV(g, s);
    h += seg([['pool', 'Pool'], ['mine', 'My golfers'], ['tour', 'Tour board']], tab, 'data-tab');
    if (!g.feed.ok) h += '<div class="owarn"><b>Leaderboard not reachable</b>Scores will show when the tour feed answers.</div>';
    if (tab === 'pool') {
      if (!g.pro.locked) h += '<div class="owarn"><b>Picks lock ' + esc(fmtTime(g.pro.lockAt)) + '</b>Other entries stay hidden until then. ' + (g.waiting.length ? g.waiting.length + ' still to pick.' : '') + '</div>';
      h += '<div class="othead"><span>#</span><span>Entry · golfers alive</span><span class="or">Today</span><span class="or">Total</span></div>';
      g.entries.forEach((e) => { const mine = e.pid === g.me; h += '<button class="otrow' + (mine ? ' me' : '') + '" data-a="entry" data-pid="' + att(e.pid) + '"><span class="opl' + (e.place === 1 ? ' ogold' : '') + '">' + (e.place || '–') + '</span><span class="opn"><b>' + esc(e.name) + (mine ? ' · you' : '') + '</b><small class="' + (e.alive >= 6 ? 'opos' : e.alive >= 4 ? 'ogold' : 'oneg') + '">' + (e.alive != null && g.pro.locked ? e.alive + ' of 6 made cut' : 'picked') + '</small></span><span class="or ' + tcls(e.today) + '">' + tp(e.today) + '</span><span class="or ob">' + (e.total == null ? '–' : tp(e.total)) + '</span></button>'; });
      if (!g.entries.length) h += '<div class="ocard omut">No picks yet.</div>';
      h += tierNote(g);
      if (g.mine && g.mine.picks) h += '<h3 class="oh">Your golfers · best four count</h3>' + golferList(g, g.entries.find((e) => e.pid === g.me) || {}, g.mine.picks);
      h += '<div class="onote">Scores refresh from the tour leaderboard every few minutes. Tap an entry to see all six of their golfers.</div>';
    } else if (tab === 'mine') h += pickV(g, s);
    else { h += '<div class="othead o3c"><span>Pos</span><span>Golfer</span><span class="or">Total</span></div>' + g.golfers.slice(0, s.more ? 400 : 60).map((x) => '<div class="otrow o3c"><span class="opl">' + esc(x.pos || (x.st === 'active' ? '–' : x.st.toUpperCase())) + '</span><span class="opn"><b>' + esc(x.name) + '</b><small>' + (x.st !== 'active' ? (x.st === 'cut' ? 'Missed cut' : x.st === 'wd' ? 'Withdrew' : 'DQ') : x.thru ? 'thru ' + esc(x.thru) + ' · today ' + tp(x.today) : x.tee ? 'tees off ' + esc(fmtTime(x.tee)) : '') + '</small></span><span class="or ob ' + tcls(x.toPar) + '">' + tp(x.toPar) + '</span></div>').join('');
      if (!s.more && g.golfers.length > 60) h += '<button class="osec ofull" data-a="more">Show all ' + g.golfers.length + ' golfers</button>'; }
    return h + payRow(g) + inviteBtn(g);
  }
  // How the tiers were ordered, and every organizer change (shown to every entrant).
  const tierNote = (g) => { if (!g.tierBasis) return ''; let h = '<div class="' + (g.tierBasis.k === 'list' ? 'owarn' : 'onote') + '">' + (g.tierBasis.k === 'list' ? '<b>Tier order set by the organizer</b>' : '') + esc(g.tierBasis.text) + '</div>';
    (g.tierLog || []).forEach((x) => { h += '<div class="ocard"><b>' + esc(x.what) + '</b><div class="omut">' + esc(x.by) + ' · ' + esc(fmtTime(x.at)) + (x.moved ? ' · ' + x.moved + ' golfer' + (x.moved === 1 ? '' : 's') + ' changed tier' : '') + '</div>' + (x.top && x.top.length ? '<div class="omut">Top of the list: ' + esc(x.top.join(', ')) + '</div>' : '') + '</div>'; }); return h; };
  function golferList(g, e, picks) {
    const by = {}; g.golfers.forEach((x) => (by[x.id] = x)); const per = {}; (e.per || []).forEach((x) => (per[x.id] = x));
    return '<div class="ocard olist">' + picks.map((id, i) => { const x = by[id] || { name: 'Golfer', st: 'active' }, p = per[id] || {}, counts = (e.counting || []).includes(id);
      const sub = x.st !== 'active' ? (x.st === 'cut' ? 'Missed cut' : x.st === 'wd' ? (x.started ? 'Withdrew' : 'Withdrew before teeing off') : 'Disqualified') + (p.v != null ? ' · counts as ' + tp(p.v) : ' · not counting') : esc(x.pos || '') + (x.thru ? ' · thru ' + esc(x.thru) : x.tee ? ' · tees off ' + fmtTime(x.tee) : '');
      return '<div class="omrow' + (counts ? '' : ' odim') + '"><span><b>' + esc(x.name) + '</b> · Tier ' + (i + 1) + '<small class="' + (x.st !== 'active' ? 'oneg' : '') + '">' + sub + '</small></span><span class="or ' + tcls(x.today) + '">' + tp(x.st === 'active' ? x.today : null) + '</span><span class="or ob">' + tp(p.v != null ? p.v : x.toPar) + '</span></div>'; }).join('') + '</div>';
  }
  function pickV(g, s) {
    const mine = g.mine, by = {}; g.golfers.forEach((x) => (by[x.id] = x));
    if (g.pro.locked) { if (!mine) return '<div class="ocard omut">Picks are locked. You did not pick for this one.</div>';
      let h = golferList(g, g.entries.find((e) => e.pid === g.me) || {}, mine.picks); const wd = mine.picks.map((id, i) => [id, i]).filter(([id]) => by[id] && by[id].st === 'wd' && !by[id].started);
      if (wd.length && !mine.swap) wd.forEach(([id, i]) => { const opts = g.tiers[i].filter((x) => by[x] && by[x].st === 'active' && !by[x].started && !mine.picks.includes(x)); h += '<div class="owarn"><b>' + esc(by[id].name) + ' withdrew before teeing off</b>You get one free swap from tier ' + (i + 1) + '.' + sel('oswap' + i, opts.map((x) => [x, by[x].name]), '') + '<button class="opri ofull" data-a="swap" data-from="' + att(id) + '" data-i="' + i + '">Swap</button></div>'; });
      if (mine.swap) h += '<div class="onote">Swap used: ' + esc((by[mine.swap.from] || {}).name || '') + ' → ' + esc((by[mine.swap.to] || {}).name || '') + '.</div>';
      return h; }
    if (!g.tiers) return '<div class="ocard omut">The field is not posted yet. Picks open when the tour posts it.</div>';
    if (mine && mine.picks && g.g16) return '<div class="ocard oalert"><b>Your picks are in and locked</b><div class="omut">Saved on the server' + (mine.at ? ' ' + esc(fmtTime(mine.at)) : '') + '. ' + G16 + '</div></div>' + golferList(g, g.entries.find((e) => e.pid === g.me) || {}, mine.picks);
    const cur0 = s.picks || (mine && mine.picks) || []; let h = '<div class="onote">One golfer from each tier. Picks lock ' + esc(fmtTime(g.pro.lockAt)) + '.</div>' + tierNote(g) + (g.g16 ? '<div class="owarn"><b>Locked when you save</b>' + G16 + '</div>' : '');
    g.tiers.forEach((tier, i) => { h += '<label class="olab">Tier ' + (i + 1) + sel('opk' + i, [['', 'Pick a golfer']].concat(tier.map((id) => [id, (by[id] || {}).name || id])), cur0[i] || '') + '</label>'; });
    if (g.pro.tb === 'score') h += '<label class="olab">Tiebreaker: winning score to par<input id="oguess" class="oin" type="number" inputmode="numeric" min="-40" max="40" placeholder="-15" value="' + esc(s.guess != null ? s.guess : mine && mine.guess != null ? mine.guess : '') + '"></label>';
    return h + '<button class="opri ofull" data-a="savepicks">' + (g.g16 ? 'Save and lock my picks' : mine ? 'Update my picks' : 'Save my picks') + '</button>';
  }
  function oadV(g, s) {
    let h = '<div class="othead o3c"><span>#</span><span>Player</span><span class="or">' + 'Total' + '</span></div><div class="onote">Totals are <b>Oddable points</b> by finish (1st 100, 2nd 60, 3rd 45 ...) unless the feed or the organizer gives the real prize money for a tournament.</div>' + g.table.map((r) => '<div class="otrow o3c' + (r.pid === g.me ? ' me' : '') + '"><span class="opl">' + r.place + '</span><span class="opn"><b>' + esc(r.name) + '</b></span><span class="or ob">' + r.total.toLocaleString() + '</span></div>').join('');
    h += '<h3 class="oh">Pick for a tournament</h3>' + (s.events ? '<label class="olab">Tournament' + sel('ooev', s.events.map((e) => [e.id, e.name]), s.oev || (s.events[0] || {}).id) + '</label>' : '<div class="ocard omut">Loading the schedule…</div>');
    const mineEv = (g.oad.events.find((E) => E.id === s.oev) || { picks: [] }).picks.find((p) => p.pid === g.me);
    if (mineEv && g.g16) h += '<div class="ocard oalert"><b>Your pick is in and locked: ' + esc(mineEv.name) + '</b><div class="omut">' + G16 + '</div></div>';
    else if (s.field) { const used = new Set(g.oad.used); h += (g.g16 ? '<div class="owarn"><b>Locked when you save</b>' + G16 + '</div>' : '') + '<label class="olab">Golfer' + sel('oog', s.field.filter((x) => x.st === 'active').map((x) => [x.id, x.name + (used.has(x.id) ? ' (used)' : '')]), '') + '</label><button class="opri ofull" data-a="oadpick">Save pick</button>'; }
    h += '<div class="onote">You used: ' + (g.oad.used.length ? g.oad.used.length + ' golfer' + (g.oad.used.length === 1 ? '' : 's') : 'nobody yet') + '. Never the same golfer twice. Scored by prize money when the feed has it, else by Oddable points for the finish (1st 100, 2nd 60, 3rd 45 …).</div>';
    g.oad.events.forEach((E) => { const money = E.by === 'money' || E.by === 'money-manual';
      h += '<div class="ocard"><b>' + esc(E.name) + '</b><div class="omut">' + (E.res ? 'Final · ' + (E.by === 'money-manual' ? 'prize money entered by ' + esc((E.manual || {}).by || 'the organizer') : money ? 'prize money' : 'Oddable points') : E.locked ? 'Locked' : 'Locks ' + esc(fmtTime(E.lockAt))) + '</div>' + E.picks.map((p) => '<div class="oline"><span>' + esc(nm(g, p.pid)) + '<small>' + esc(p.name) + '</small></span><b>' + (p.pts == null ? '' : (money ? '$' : '') + p.pts.toLocaleString()) + '</b></div>').join('');
      if (g.role === 'org' && E.locked && E.golfers && E.golfers.length) h += '<div class="olab">Enter prize money instead of Oddable points</div>' + E.golfers.map((x) => '<label class="olab">' + esc(x.name) + ' ($)<input class="oin" type="number" inputmode="numeric" min="0" data-om="' + att(E.id) + '" data-g="' + att(x.id) + '" value="' + (E.by === 'money-manual' && E.res ? esc(E.res[x.id]) : '') + '" placeholder="0 if missed the cut"></label>').join('') + '<button class="osec ofull" data-a="oadmoney" data-ev="' + att(E.id) + '">Save prize money</button>';
      h += '</div>'; });
    (g.oad.log || []).forEach((x) => { h += '<div class="onote">' + esc(x.what) + ' · ' + esc(x.by) + ' · ' + esc(fmtTime(x.at)) + '</div>'; });
    return h + payRow(g) + inviteBtn(g);
  }
  // Payouts: a summary row that drills down to the table behind it (entry, pot, take, places paid). Information only.
  const payRow = (g) => { const p = g.payout; if (!p || !p.entry) return ''; return '<button class="ocard obtn" data-a="payv"><div class="orow"><b>Payouts</b><span class="ogold">' + usd(p.pool) + ' pool ›</span></div><div class="omut">' + usd(p.entry) + ' entry · ' + (p.paidN || 0) + ' of ' + p.entrants + ' paid · pays ' + p.places.length + ' place' + (p.places.length === 1 ? '' : 's') + (p.final ? ' · final' : '') + '</div></button>'; };
  function payV() { const g = G(), p = g.payout || { places: [] }; let h = '<h1>Payouts</h1><div class="ometa">' + esc(g.title) + '</div><div class="orules">' + [['Entry', usd(p.entry) + ' each'], ['Entrants', p.entrants], ['Marked paid', (p.paidN == null ? 0 : p.paidN) + ' of ' + p.entrants], ['Pot (paid entries only)', usd(p.pot)], ["Organizer's take", p.take ? usd(p.take) : 'None'], ['Prize pool', usd(p.pool)], ['Payout table', p.custom ? 'Set by the organizer' : 'Automatic for this field size']].map(([k, v]) => '<div><small>' + esc(k) + '</small><span>' + esc(v) + '</span></div>').join('') + '</div>';
    h += '<div class="othead o3c"><span>Place</span><span>Share</span><span class="or">Amount</span></div>' + p.places.map((x) => '<div class="otrow o3c"><span class="opl' + (x.place === 1 ? ' ogold' : '') + '">' + ord(x.place) + '</span><span class="opn"><b>' + x.pct + '%</b></span><span class="or ob">' + usd(x.amt) + '</span></div>').join('');
    if (p.final) h += '<h3 class="oh">Who won what</h3>' + (p.paid && p.paid.length ? '<div class="ocard olist">' + p.paid.map((x) => '<div class="omrow"><span>' + esc(x.name) + '</span><b class="ogold">' + usd(x.amt) + '</b></div>').join('') + '</div>' : '<div class="ocard omut">No prize money in this game.</div>');
    else if (g.kind === 'pro' && g.entries && g.entries.some((e) => e.payout != null)) h += '<h3 class="oh">Who won what</h3><div class="ocard olist">' + g.entries.filter((e) => e.payout > 0).map((e) => '<div class="omrow"><span>' + esc(e.name) + '</span><b class="ogold">' + usd(e.payout) + '</b></div>').join('') + '</div>';
    h += '<h3 class="oh">Who has paid</h3><div class="onote">The pot counts only entrants marked paid, and only they can win pot money.' + (g.role === 'org' ? ' Tap to mark an entry paid.' : ' The organizer marks entries paid.') + '</div><div class="ocard olist">' + g.members.map((m) => '<div class="omrow"><span>' + esc(m.name) + '<small class="' + (m.paid ? 'opos' : 'omut') + '">' + (m.paid ? 'Paid' : 'Not paid') + '</small></span>' + (g.role === 'org' ? sw(m.paid, 'data-a="paid" data-pid="' + att(m.pid) + '" data-on="' + (m.paid ? 0 : 1) + '" aria-label="Paid: ' + esc(m.name) + '"') : '') + '</div>').join('') + '</div>';
    return h + '<div class="onote">Small fields pay fewer places. Tied places share the prizes of the places they cover. A team prize is split evenly among its players. ' + MONEY + '</div>'; }

  // ---------- golf day board ----------
  function dayV() {
    const s = cur(), g = s.g; if (!g) return '<div class="ocard">Loading…</div>'; const d = g.day, b = g.board, tab = s.tab || 'lb', org = g.role === 'org';
    const maxThru = Math.max(0, ...b.rows.map((r) => r.thru));
    let h = '<div class="orow"><h1>' + esc(g.title) + '</h1><span class="olive' + (d.status === 'live' ? '' : ' off') + '">' + (d.status === 'live' ? 'Live · hole ' + Math.min(b.holes, maxThru + 1) : d.status === 'final' ? 'Final' : 'Setting up') + '</span></div>';
    h += '<div class="ometa">' + esc(d.course.name + ' · ' + (d.solo ? 'solo round' : (FMT[d.fmt] || [''])[0] + ' · ' + ((n) => n + ' team' + (n === 1 ? '' : 's'))(d.teams.filter((t) => t.players.length).length)) + ' · ' + (d.net === 'gross' ? 'gross' : 'net with handicaps')) + '</div>';
    if (d.status === 'setup') return h + setupTeamsV(g, s);
    const tabs = [['lb', 'Leaderboard'], ['card', 'Scorecard']]; if (!d.solo) tabs.push(['mt', 'Matches'], ['side', 'Side games']); h += seg(tabs, tab, 'data-tab');
    h += qBox(g);
    const disp = b.rows.filter((r) => r.disputed.length); if (disp.length) h += '<div class="owarn"><b>Disputed holes</b>' + disp.map((r) => esc(r.name) + ': #' + r.disputed.join(', #')).join(' · ') + (org ? ' · tap a team to settle.' : ' · the organizer settles them.') + '</div>';
    if (d.forced) h += '<div class="owarn"><b>' + d.forced.holes + ' hole' + (d.forced.holes === 1 ? '' : 's') + ' never confirmed</b>Finished anyway by ' + esc(d.forced.by) + ' · ' + esc(fmtTime(d.forced.at)) + ' · ' + esc(d.forced.reason) + '</div>';
    else if (d.status === 'live' && d.money && !d.solo && d.unconfirmed && d.unconfirmed.n) h += '<div class="onote">' + d.unconfirmed.n + ' hole' + (d.unconfirmed.n === 1 ? '' : 's') + ' not confirmed yet. Money is on this round: every hole is confirmed by another team before it can be finished.</div>';
    if (tab === 'lb') {
      const st = d.fmt === 'stableford'; h += '<div class="othead"><span>#</span><span>' + (d.solo ? 'Golfer' : 'Team') + '</span><span class="or">Thru</span><span class="or">' + (st ? 'Points' : d.net === 'gross' ? 'Gross' : 'Net') + '</span></div>';
      b.rows.forEach((r) => { const mine = r.tid === d.myTeam, v = st ? (b.by === 'net' ? r.pts : r.ptsG) : b.by === 'net' ? r.toParN : r.toParG;
        h += '<button class="otrow' + (mine ? ' me' : '') + '" data-a="team" data-tid="' + att(r.tid) + '"><span class="opl' + (r.place === 1 ? ' ogold' : '') + '">' + (r.place || '–') + '</span><span class="opn"><b>' + esc(r.name) + (mine ? (d.solo ? ' · you' : ' · your team') : '') + '</b><small>' + esc(d.teams.find((t) => t.tid === r.tid).players.map((p) => p.name).join(', ')) + (d.net === 'both' ? ' · gross ' + tp(r.toParG) : '') + '</small>' + (d.net === 'gross' ? '' : hiLines(g, r.tid)) + '<small>' + (r.pen ? ' · <span class="oneg">+' + r.pen.strokes + ' penalty: ' + r.pen.drives + ' drive' + (r.pen.drives === 1 ? '' : 's') + ' short</span>' : '') + (r.drives && r.drives.warn.length && !r.pen ? ' · <span class="ogold">' + esc(r.drives.impossible ? 'drive rule cannot be met' : 'drives short: ' + r.drives.warn.map((p) => nm(g, p)).join(', ')) + '</span>' : '') + '</small></span><span class="or">' + (r.thru >= b.holes ? 'F' : r.thru) + '</span><span class="or ob ' + (st ? '' : tcls(v)) + '">' + (st ? v : tp(v)) + '</span></button>'; });
      h += scoreBox(g);
    } else if (tab === 'card') h += cardV(g, s);
    else if (tab === 'mt') h += matchesV(g);
    else h += sideV(g);
    if (org && d.status === 'live') h += '<button class="osec ofull" data-a="final">Finish the round</button>'; if (org && d.status === 'final') h += '<button class="osec ofull" data-a="reopen">Reopen scoring</button>';
    h += payRow(g) + (d.solo ? '' : '<button class="osec ofull" data-a="hcpv">Players and handicaps ›</button>') + '<button class="olink" data-a="auditv">Score history (audit) ›</button>';
    return h + (d.solo ? '' : inviteBtn(g)) + '<div class="onote">Calcutta, skins and prizes are in the group\'s pots. ' + MONEY + '</div>';
  }
  // Handicap line per player (E-H: the real-results Oddable index always shows; a director's tournament handicap shows next to it, never instead of it).
  const hiOf = (g, pid) => (g.day.hi && g.day.hi[pid]) || { text: '', src: 'none' };
  const hiLines = (g, tid) => { const t = g.day.teams.find((x) => x.tid === tid); if (!t) return ''; return t.players.map((p) => '<small class="ohi' + (hiOf(g, p.pid).src === 'tournament' ? ' oset' : '') + '">' + (t.players.length > 1 ? esc(p.name) + ': ' : '') + esc(hiOf(g, p.pid).text) + '</small>').join(''); };
  // One card per player: the handicap played off, the real-results Oddable index next to it, and (director of an Enterprise tournament, before the start)
  // the add / change form: tournament handicap + reason. Used on the tournament setup screen and on "Players and handicaps".
  function hcpCards(g) {
    const d = g.day, dir = g.ent && g.role === 'org', can = dir && !d.hlocked; let h = '';
    g.members.forEach((m) => { const x = hiOf(g, m.pid), t = d.teams.find((y) => y.players.some((p) => p.pid === m.pid));
      h += '<div class="ocard' + (x.src === 'tournament' ? ' oalert' : '') + '"><div class="orow"><b class="oname">' + esc(m.name) + (m.guest ? ' <i class="omut">· guest</i>' : '') + '</b><span class="obadge">' + (x.used == null ? '–' : esc(Number(x.used).toFixed(1))) + '</span></div><div class="omut">' + esc(t ? t.name : 'Not on a team') + (x.ch != null ? ' · ' + x.ch + ' stroke' + (Math.abs(x.ch) === 1 ? '' : 's') + ' on this course' : '') + '</div><div class="ohi2">' + esc(x.text) + '</div>';
      if (x.src === 'tournament') h += '<div class="oset2">Set by tournament' + (x.set ? ' · ' + esc(x.set.by) + ' · ' + esc(fmtTime(x.set.at)) + ' · ' + esc(x.set.reason) : '') + '</div>';
      if (can) h += '<div class="o2"><label class="olab">Tournament handicap<input id="oth_' + att(m.pid) + '" class="oin" type="number" inputmode="decimal" step="0.1" min="-10" max="54" placeholder="e.g. 12.0"></label><label class="olab">Reason<input id="otr_' + att(m.pid) + '" class="oin" maxlength="80" placeholder="Club card, committee ..."></label></div><button class="osec ofull" data-a="sethcp" data-pid="' + att(m.pid) + '">' + (x.src === 'tournament' ? 'Change' : x.oddable != null ? 'Override for this tournament' : 'Set handicap') + '</button>';
      h += '</div>'; });
    h += hlogHtml(g);
    return h;
  }
  function hlogHtml(g) { const d = g.day, dir = g.ent && g.role === 'org'; let h = '';
    if (dir && d.hlog && d.hlog.length) h += '<h3 class="oh">Handicap changes</h3>' + d.hlog.map((x) => '<div class="ocard"><b>' + esc(x.name) + ': ' + esc(x.old == null ? '–' : Number(x.old).toFixed(1)) + ' → ' + esc(Number(x.new).toFixed(1)) + '</b><div class="omut">' + esc(x.by) + ' · ' + esc(fmtTime(x.at)) + ' · ' + esc(x.reason) + '</div><div class="omut">' + (x.oddable == null ? 'Oddable: no rounds yet' : 'Oddable ' + esc(Number(x.oddable).toFixed(1)) + ' (real results)') + '</div></div>').join('');
    return h; }
  function hcpsV() {
    const g = G(), d = g.day;
    let h = '<h1>Players and handicaps</h1><div class="ometa">' + esc(g.title) + (g.ent ? ' · tournament' : '') + '</div><div class="onote"><b>' + HCPL + '.</b> ' + HCPN + ' It comes from every round played or logged in the app.' + (g.ent ? ' The tournament director can enter or change a handicap for this tournament only; a player\'s own index is never changed by that.' : '') + '</div>';
    if (g.ent) h += '<div class="' + (d.hlocked ? 'owarn' : 'onote') + '">' + (d.hlocked ? '<b>Handicaps are locked</b>The tournament has started.' : 'Handicaps can be changed until the tournament starts' + (d.lockAt ? ' (' + esc(fmtTime(d.lockAt)) + ')' : '') + '.') + '</div>';
    return h + hcpCards(g);
  }
  // P1 Suggest partners: Balanced (default), Rotate, Hot pairs. It only suggests; the organizer chooses.
  async function loadSuggest(o, g) { try { o.res = await post('suggest', { id: g.id, mode: o.mode, teamSize: Math.max(2, SIZE[g.day.fmt] > 1 ? g.day.teamSize : 2) }); err = ''; } catch (e) { err = errText(e); o.res = { suggestions: [], note: '' }; } paint(); }
  function suggestV() {
    const s = cur(), g = G(), r = s.res; let h = '<h1>Suggest partners</h1><div class="ometa">' + esc(g.title) + ' · teams of ' + (r ? r.teamSize : g.day.teamSize) + '</div>';
    h += '<div class="oseg">' + [['balanced', 'Balanced'], ['rotate', 'Rotate'], ['hot', 'Hot pairs']].map(([v, l]) => '<button class="' + (s.mode === v ? 'on' : '') + '" data-smode="' + v + '">' + l + '</button>').join('') + '</div>';
    h += '<div class="onote">' + ({ balanced: 'Balanced: team handicaps as close as possible, so the matches are fair.', rotate: 'Rotate: partners who have not played together lately.', hot: 'Hot pairs: the best records together, from lifetime results in the app.' })[s.mode] + '</div>';
    if (!r) return h + '<div class="ocard omut">Working it out…</div>'; if (!r.suggestions.length) return h + '<div class="ocard omut">Not enough players yet. Invite people first.</div>';
    r.suggestions.forEach((x, i) => { h += '<div class="ocard' + (i === 0 ? ' oalert' : '') + '"><div class="orow"><b>' + (i === 0 ? 'Top suggestion' : 'Option ' + (i + 1)) + '</b><span class="omut">' + esc(x.hcps.join(' · ')) + '</span></div><div class="oreason">' + esc(x.reason) + '</div>' + x.teams.map((t, k) => '<div class="omrow"><span><b>Team ' + (k + 1) + '</b><small>' + t.map((p) => esc(p.name) + ' (' + esc(p.hi.used == null ? '–' : Number(p.hi.used).toFixed(1)) + ')').join(' + ') + '</small></span><b>' + esc(x.hcps[k]) + '</b></div>').join('') + '<button class="osec ofull" data-a="usesug" data-i="' + i + '">Use these teams</button></div>'; });
    return h + '<div class="onote">' + esc(r.note || '') + '</div>';
  }
  async function applySuggest(g, sg) { if (busy) return; busy = true; paintBusy(true); try { let cur0 = g;
      for (let i = cur0.day.teams.length; i < sg.teams.length; i++) cur0 = (await post('team', { id: g.id, op: 'add' })).game;
      for (const m of cur0.members) cur0 = (await post('team', { id: g.id, op: 'assign', pid: m.pid })).game;
      for (let i = 0; i < sg.teams.length; i++) for (const p of sg.teams[i]) cur0 = (await post('team', { id: g.id, op: 'assign', pid: p.pid, tid: cur0.day.teams[i].tid })).game;
      setG(cur0); err = ''; stack.pop(); } catch (e) { err = NOTSAVED + errText(e); try { setG((await post('get', { id: g.id })).game); } catch (x) {} } busy = false; paintBusy(false); paint(); }
  function scoreBox(g) {
    const d = g.day; if (d.status !== 'live') return ''; const mine = d.iScore.concat(g.role === 'org' ? d.teams.filter((t) => t.players.length && !d.iScore.includes(t.tid)).map((t) => t.tid) : []);
    if (!mine.length) return '<div class="onote">Only each team\'s scorer enters scores. Another team\'s scorer confirms them.</div>';
    const vb = window.VoiceLog && window.VoiceLog.open ? '<button class="osec ofull obig" data-a="voice">🎤 Log my score</button>' : '';
    if (d.solo) { const sc = d.scores[mine[0]] || {}, next = Math.min(d.course.par.length, Object.keys(sc).length + 1); return '<div class="ocard"><h2>My round</h2><button class="opri ofull obig" data-a="enter" data-tid="' + att(mine[0]) + '" data-h="' + next + '">Enter hole ' + next + ' ›</button>' + vb + '<div class="onote">Say it the way you would tell a friend: "hole 4, a five with two putts" or a whole nine at once.</div></div>'; }
    let h = '<div class="ocard"><h2>Enter a score</h2>' + mine.slice(0, 8).map((tid) => { const sc = d.scores[tid] || {}, next = Math.min(d.course.par.length, Object.keys(sc).length + 1); return '<button class="opri ofull obig" data-a="enter" data-tid="' + att(tid) + '" data-h="' + next + '">' + esc(tname(g, tid)) + ' · hole ' + next + ' ›</button>'; }).join('');
    const others = d.teams.filter((t) => t.players.length && !d.iScore.includes(t.tid)); if ((d.iScore.length || g.role === 'org') && others.length && !d.solo) h += '<div class="olab">Confirm another team\'s card</div>' + others.map((t) => '<button class="osec ofull" data-a="confirmv" data-tid="' + att(t.tid) + '">Check ' + esc(t.name) + ' ›</button>').join('');
    return h + '<div class="onote">Only your team\'s scorer can enter. The other team\'s scorer confirms at the turn.</div></div>';
  }
  // Scorecard: one wrapped card per hole (no sideways table)
  function cardV(g, s) {
    const d = g.day, tid = s.ctid || d.myTeam || (d.teams.find((t) => t.players.length) || {}).tid; if (!tid) return '<div class="ocard omut">No teams yet.</div>'; const t = d.teams.find((x) => x.tid === tid), sc = d.scores[tid] || {}, team = TEAMBALL[d.fmt], r0 = g.board.rows.find((x) => x.tid === tid);
    let h = sel('octid', d.teams.filter((x) => x.players.length).map((x) => [x.tid, x.name]), tid) + '<div class="ocardg">';
    d.course.par.forEach((par, i) => { const e = sc[i + 1], v = e ? (team ? e.g : t.players.map((p) => e.p && e.p[p.pid]).join(' · ')) : '–';
      h += '<button class="ohc' + (e ? ' ' + (e.st === 'confirmed' ? 'ocf' : e.st === 'disputed' ? 'odp' : '') : '') + '" data-a="hole" data-tid="' + att(tid) + '" data-h="' + (i + 1) + '"><small>#' + (i + 1) + ' · par ' + par + ' · idx ' + d.course.hcp[i] + (d.course.yards && d.course.yards[i] ? ' · ' + d.course.yards[i] + 'y' : '') + '</small><b>' + esc(v) + '</b><i>' + (e ? (e.st === 'confirmed' ? '✓ confirmed' : e.st === 'disputed' ? '⚠ disputed' : 'entered') : '') + '</i></button>'; });
    return h + '</div>' + (team ? '' : '<div class="onote">Scores are each player\'s strokes, in team order: ' + esc(t.players.map((p) => p.name).join(' · ')) + '.</div>') + (d.net === 'gross' ? '' : '<div class="ocard"><h2>Handicaps on this card</h2>' + t.players.map((p) => '<div class="omrow"><span>' + esc(p.name) + '<small class="ohi' + (hiOf(g, p.pid).src === 'tournament' ? ' oset' : '') + '">' + esc(hiOf(g, p.pid).text) + '</small></span><b>' + (hiOf(g, p.pid).ch == null ? '' : hiOf(g, p.pid).ch + ' str') + '</b></div>').join('') + (r0 && r0.thcp != null ? '<div class="omut">Team handicap ' + r0.thcp + '</div>' : '') + '<div class="omut">' + HCPL + '. ' + HCPN + '</div></div>');
  }
  function entryV() {
    const s = cur(), g = G(), d = g.day, t = d.teams.find((x) => x.tid === s.tid), hole = s.h, i = hole - 1, team = TEAMBALL[d.fmt], cur0 = (d.scores[s.tid] || {})[hole];
    if (!s.v) { s.v = {}; if (cur0) { if (team) s.v.g = cur0.g; else t.players.forEach((p) => (s.v[p.pid] = cur0.p[p.pid])); s.drive = cur0.drive; s.putts = cur0.putts; } else { if (team) s.v.g = d.course.par[i]; else t.players.forEach((p) => (s.v[p.pid] = d.course.par[i])); } }
    let h = '<div class="ohole0"><button class="ostep" data-a="hprev" aria-label="Previous hole"' + (hole <= 1 ? ' disabled' : '') + '>‹</button><span><b>Hole ' + hole + '</b><small>Par ' + d.course.par[i] + ' · index ' + d.course.hcp[i] + (d.course.yards && d.course.yards[i] ? ' · ' + d.course.yards[i] + ' yds' : '') + '</small></span><button class="ostep" data-a="hnext" aria-label="Next hole"' + (hole >= d.course.par.length ? ' disabled' : '') + '>›</button></div>';
    h += '<div class="ometa">' + esc(t.name) + (cur0 ? ' · entered by ' + esc(cur0.by) + (cur0.st === 'confirmed' ? ' · confirmed' : cur0.st === 'disputed' ? ' · disputed: ' + esc(cur0.note || '') : '') : '') + '</div>';
    const row = (k, label) => '<div class="ostk"><span>' + esc(label) + '</span><button class="ostep" data-a="dec" data-k="' + att(k) + '" aria-label="One less">−</button><b>' + (s.v[k] || '–') + '</b><button class="ostep" data-a="inc" data-k="' + att(k) + '" aria-label="One more">+</button></div>';
    h += '<div class="ocard">' + (team ? row('g', 'Team strokes') : t.players.map((p) => row(p.pid, p.name)).join('')) + '</div>';
    if (d.fmt === 'texas') { const r = g.board.rows.find((x) => x.tid === t.tid), dr = r && r.drives; h += '<div class="olab">Whose drive was used?</div><div class="o2">' + t.players.map((p) => '<button class="' + (s.drive === p.pid ? 'opri' : 'osec') + '" data-a="drive" data-pid="' + att(p.pid) + '">' + esc(p.name) + (dr ? ' · ' + dr.count[p.pid] + ' used' + (dr.need[p.pid] ? ', needs ' + dr.need[p.pid] : '') : '') + '</button>').join('') + '</div>' + (dr && dr.warn.length ? '<div class="owarn"><b>' + (dr.impossible ? 'Drive rule can no longer be met' : 'Running short on drives') + '</b>' + esc(dr.warn.map((p) => nm(g, p) + ' needs ' + dr.need[p]).join(', ')) + ' with ' + dr.left + ' holes left.</div>' : ''); }
    if (d.fmt === 'florida') h += '<div class="onote">Florida rule: the player whose shot was used sits out the next shot.</div>';
    h += '<div class="ostk"><span>Putts (optional' + (team ? ', team' : '') + ')</span><button class="ostep" data-a="pdec" aria-label="One less putt">−</button><b>' + (s.putts == null ? '–' : s.putts) + '</b><button class="ostep" data-a="pinc" aria-label="One more putt">+</button></div>';
    h += '<button class="opri ofull obig" data-a="savehole">Save hole ' + hole + '</button>';
    if (window.VoiceLog && window.VoiceLog.open) h += '<button class="osec ofull obig" data-a="voice">🎤 Log my score</button>';
    return h;
  }
  function confirmV() {
    const s = cur(), g = G(), d = g.day, t = d.teams.find((x) => x.tid === s.tid), sc = d.scores[s.tid] || {}, team = TEAMBALL[d.fmt];
    let h = '<h1>Check ' + esc(t.name) + '</h1><div class="onote">Compare with your own card. Confirm the holes that match; flag a hole that looks wrong and the organizer settles it.</div><div class="ocardg">';
    d.course.par.forEach((par, i) => { const e = sc[i + 1]; h += '<div class="ohc' + (e ? (e.st === 'confirmed' ? ' ocf' : e.st === 'disputed' ? ' odp' : '') : '') + '"><small>#' + (i + 1) + ' · par ' + par + '</small><b>' + (e ? esc(team ? e.g : t.players.map((p) => e.p[p.pid]).join(' · ')) : '–') + '</b>' + (e && e.st !== 'confirmed' ? '<button class="otiny" data-a="dispute" data-h="' + (i + 1) + '">Flag</button>' : '<i>' + (e && e.st === 'confirmed' ? '✓' : '') + '</i>') + '</div>'; });
    h += '</div><div class="o2"><button class="opri" data-a="confirm" data-f="1" data-t="9">Confirm 1-9</button><button class="opri" data-a="confirm" data-f="10" data-t="18">Confirm 10-18</button></div>';
    if (g.role === 'org') { const dis = Object.keys(sc).filter((k) => sc[k].st === 'disputed'); dis.forEach((k) => { h += '<button class="osec ofull" data-a="hole" data-tid="' + att(t.tid) + '" data-h="' + k + '" data-settle="1">Settle hole ' + k + (sc[k].note ? ': ' + esc(sc[k].note) : '') + ' ›</button>'; }); }
    return h;
  }
  function matchesV(g) {
    const b = g.board, d = g.day; const hh = '<div class="ohelp">Match play terms ' + info('heads') + '</div>'; if (!b.matches.length) return hh + '<div class="ocard omut">No heads-up matches.' + (g.role === 'org' ? ' Add them in setup.' : '') + '</div>';
    return hh + b.matches.map((m) => { const st = m.m || (m.nassau && m.nassau.total), lead = st.up > 0 ? side(g, m.kind, m.a) : st.up < 0 ? side(g, m.kind, m.b) : '';
      const txt = st.done ? (st.res === 'T' ? 'Halved' : (st.res === 'W' ? side(g, m.kind, m.a) : side(g, m.kind, m.b)) + ' won ' + st.text) : st.up === 0 ? 'All square' + (st.played ? ', ' + st.left + ' to play' : '') : lead + ' ' + Math.abs(st.up) + ' up, ' + st.left + ' to play' + (st.dormie ? ' · dormie' : '');
      return '<button class="ocard obtn' + resCls(g, m, st) + '" data-a="match" data-mid="' + att(m.mid) + '"><div class="orow"><b class="oname">' + esc(side(g, m.kind, m.a)) + ' vs ' + esc(side(g, m.kind, m.b)) + '</b><span class="obadge">' + esc(st.done ? (st.closed ? st.short : st.res === 'T' ? 'Halved' : 'Final') : st.up === 0 ? 'AS' : Math.abs(st.up) + ' UP' + (st.dormie ? ' · dormie' : '')) + '</span></div><div class="' + (st.done ? 'ogold' : 'omut') + '">' + esc((m.type === 'nassau' ? 'Nassau total: ' : '') + txt) + '</div>' + (m.amt ? '<div class="omut">' + usd(m.amt) + ' a match (info)</div>' : '') + '</button>'; }).join('');
  }
  // result-banner look (.res.hit / .res.miss): green when your side won a finished bet, red when it lost
  function resCls(g, m, st) { if (!st || !st.done || st.res === 'T') return ''; const me = m.kind === 'player' ? g.me : g.day.myTeam, sideMe = m.a === me ? 'W' : m.b === me ? 'L' : null; if (!sideMe) return ''; return st.res === sideMe ? ' ohit' : ' omiss'; }
  function matchV() {
    const s = cur(), g = G(), m = g.board.matches.find((x) => x.mid === s.mid); if (!m) return '<div class="ocard omut">Match not found.</div>';
    const A = side(g, m.kind, m.a), B = side(g, m.kind, m.b), bet = (lab, st) => '<div class="ocard' + resCls(g, m, st) + '"><div class="orow"><b>' + esc(lab) + '</b><span class="' + (st.done ? 'ogold' : 'omut') + '">' + esc(st.done ? (st.res === 'T' ? 'Halved' : (st.res === 'W' ? A : B) + ' won ' + st.text) : st.up === 0 ? 'All square' : (st.up > 0 ? A : B) + ' ' + Math.abs(st.up) + ' up') + '</span></div><div class="omut">' + st.played + ' played, ' + st.left + ' to play' + (st.dormie ? ' · dormie' : '') + (st.closed ? ' · closed out' : '') + '</div><div class="ostrip">' + st.holes.map((w, i) => '<span class="' + (w > 0 ? 'opos' : w < 0 ? 'oneg' : '') + '">' + (w > 0 ? 'A' : w < 0 ? 'B' : '–') + '</span>').join('') + '</div></div>';
    let h = '<h1>' + esc(A) + ' vs ' + esc(B) + '</h1><div class="ometa">A = ' + esc(A) + ' · B = ' + esc(B) + (m.net ? ' · net, strokes off the low side' : ' · gross') + (m.amt ? ' · ' + usd(m.amt) + ' (info)' : '') + '</div>';
    if (m.nassau) { h += bet('Front nine', m.nassau.front) + bet('Back nine', m.nassau.back) + bet('Total 18', m.nassau.total) + m.nassau.presses.map((p) => bet('Press from hole ' + p.from, p.m)).join('');
      (m.offers || []).forEach((o) => { h += '<div class="owarn"><b>Press offered from hole ' + o.from + '</b>' + esc(o.by) + ' (' + esc(o.side === 'a' ? A : B) + ') wants a new bet for the rest of the ' + o.nine + ' nine. ' + (o.expired ? 'Nobody accepted before the hole was played: it does not count.' : 'It counts only if the other side accepts before hole ' + o.from + ' is played.') + '<div class="o2"><button class="osec" data-a="paccept" data-from="' + o.from + '">' + (o.expired ? 'Clear' : 'Accept') + '</button><button class="osec" data-a="pdecline" data-from="' + o.from + '">Decline</button></div></div>'; });
      if (m.press === 'auto2') h += '<div class="onote">Presses start by themselves when a side goes 2 down in a nine.' + (m.amt ? ' Each bet (front, back, 18 and every press) is ' + usd(m.amt) + '.' : '') + '</div>';
      else { ['front', 'back'].forEach((nine) => { const nm0 = m.nassau[nine], s0 = nine === 'front' ? 0 : 9, bets = [nm0].concat(m.nassau.presses.filter((p) => p.nine === nine).map((p) => p.m)), nw = bets[bets.length - 1], from = s0 + nm0.played + 1;
        if (nm0.played > 0 && nm0.played < 9 && nw.up !== 0 && !m.nassau.presses.some((p) => p.from === from) && !(m.offers || []).some((p) => p.from === from)) h += '<button class="osec ofull" data-a="press" data-from="' + from + '">' + esc((nw.up < 0 ? A : B) + ' offers a press on the ' + nine + ' nine from hole ' + from) + '</button>'; });
        h += '<div class="onote">A press is a new bet for the rest of that nine. Only the side that is down can offer one, from the next hole to be played, and it counts once the other side accepts.' + (m.amt ? ' Each bet (front, back, 18 and every press) is ' + usd(m.amt) + '.' : '') + '</div>'; } }
    else h += bet('Match', m.m);
    return h;
  }
  function sideV(g) {
    const b = g.board, d = g.day; let h = '<div class="ohelp">Skins ' + info('skins') + ' · Closest to the pin / longest drive ' + info('ctp') + '</div><div class="ocard olist">';
    if (b.skins) { const won = Object.entries(b.skins.won); h += '<button class="omrow obtnr" data-a="skins"><span>Skins' + '<small>' + (d.extras.skins.amt ? usd(d.extras.skins.amt) + ' a skin · ' : '') + won.reduce((a, [, n]) => a + n, 0) + ' won, ' + b.skins.carry + ' carried over' + (b.skins.net ? ' · net' : ' · gross') + '</small></span><b class="ogold">' + (b.skins.carry ? b.skins.carry + ' riding ›' : '›') + '</b></button>'; }
    b.extras.ctp.forEach((x) => { h += '<button class="omrow obtnr" data-a="extra" data-k="ctp" data-h="' + x.hole + '"><span>Closest to the pin · #' + x.hole + '<small>' + (x.win ? esc(nm(g, x.win.who) || tname(g, x.win.who)) + (x.win.note ? ' · ' + esc(x.win.note) : '') + (x.win.st === 'confirmed' ? ' · ✓ confirmed' : ' · not confirmed yet') : 'Not played yet') + '</small></span><b>' + (d.extras.ctpAmt ? usd(d.extras.ctpAmt) : '') + ' ›</b></button>'; });
    b.extras.ld.forEach((x) => { h += '<button class="omrow obtnr" data-a="extra" data-k="ld" data-h="' + x.hole + '"><span>Longest drive · #' + x.hole + '<small>' + (x.win ? esc(nm(g, x.win.who)) + (x.win.note ? ' · ' + esc(x.win.note) : '') + (x.win.st === 'confirmed' ? ' · ✓ confirmed' : ' · not confirmed yet') : 'Not played yet') + '</small></span><b>' + (d.extras.ldAmt ? usd(d.extras.ldAmt) : '') + ' ›</b></button>'; });
    if (!b.skins && !b.extras.ctp.length && !b.extras.ld.length) h += '<div class="omut">No side games set up.</div>';
    return h + '</div><div class="onote">Team Calcutta: the teams are offered to your group\'s Calcutta as lots.</div>';
  }
  function skinsV() { const g = G(), b = g.board; return '<h1>Skins</h1><div class="ometa">' + (b.skins.net ? 'Net' : 'Gross') + ' · ties carry to the next hole</div>' + (b.skins.split ? '<div class="owarn"><b>' + b.skins.split.skins + ' skin' + (b.skins.split.skins === 1 ? '' : 's') + ' still riding after the last hole</b>Shared by those tied on it: ' + esc(b.skins.split.ids.map((id) => (nm(g, id) !== 'Player' ? nm(g, id) : tname(g, id))).join(', ')) + ' (' + b.skins.split.each + ' each).</div>' : b.skins.dead ? '<div class="owarn"><b>' + b.skins.dead + ' skin' + (b.skins.dead === 1 ? '' : 's') + ' not won</b>Still riding after the last hole; this game pays nobody for them.</div>' : '') + '<div class="ocardg">' + b.skins.holes.map((x) => '<div class="ohc' + (x.win ? ' ocf' : '') + '"><small>#' + x.hole + '</small><b>' + esc(x.win ? (nm(g, x.win) !== 'Player' ? nm(g, x.win) : tname(g, x.win)) : 'Carry') + '</b><i>' + (x.win ? x.skins + ' skin' + (x.skins === 1 ? '' : 's') : x.carried + ' riding') + '</i></div>').join('') + '</div>'; }
  function extraV() {
    const s = cur(), g = G(), d = g.day, w = ((d.win || {})[s.k] || {})[s.h]; const can = g.role === 'org' || d.iScore.length;
    let h = '<h1>' + (s.k === 'ctp' ? 'Closest to the pin' : 'Longest drive') + ' · #' + s.h + '</h1><div class="ometa">' + (w ? 'Winner: ' + esc(nm(g, w.who)) + (w.note ? ' · ' + esc(w.note) : '') + ' (entered by ' + esc(w.by) + ')' : 'No winner entered yet') + '</div>';
    if (w) h += w.st === 'confirmed' ? '<div class="ocard ohit"><b>✓ Confirmed</b><div class="omut">by ' + esc(w.cf || '') + '</div></div>' : '<div class="owarn"><b>Not confirmed yet</b>Like a score, the winner counts once someone who is not on the winner\'s team (another team\'s scorer or the organizer) confirms it.' + (can ? '<button class="opri ofull" data-a="xconfirm">Confirm this winner</button>' : '') + '</div>';
    if (!can) return h + '<div class="onote">A scorer or the organizer enters the winner.</div>';
    return h + '<label class="olab">Winner' + sel('oxw', [['', 'Nobody / clear']].concat(g.members.map((m) => [m.pid, m.name])), w ? w.who : '') + '</label><label class="olab">Note (distance)<input id="oxn" class="oin" maxlength="40" placeholder="4 ft 2 in" value="' + esc(w ? w.note : '') + '"></label><button class="opri ofull" data-a="saveextra">Save</button>';
  }
  // integration fix (screens review): the history shows plain words, never the engine's short codes ("ld winner", "ctp winner")
  const AUDITN = { 'ld winner': 'Longest drive winner entered', 'ctp winner': 'Closest to the pin winner entered', 'ld cleared': 'Longest drive winner removed', 'ctp cleared': 'Closest to the pin winner removed', 'ld confirmed': 'Longest drive winner confirmed', 'ctp confirmed': 'Closest to the pin winner confirmed', confirmed: 'Scores confirmed', disputed: 'Score disputed', settled: 'Dispute settled by the organizer', start: 'Round started', final: 'Round made final', reopen: 'Round reopened', 'final forced': 'Made final with unconfirmed holes', handicap: 'Handicap changed', press: 'Press', 'press offered': 'Press offered', 'press accepted': 'Press accepted', 'press declined': 'Press declined', 'press expired': 'Press offer ran out', score: 'Score entered', entered: 'Score entered', changed: 'Score changed' };
  function auditV() { const g = G(); return '<h1>Score history</h1><div class="onote">Every entry, change, confirmation, dispute and settlement, newest first.</div>' + (g.day.audit.length ? g.day.audit.map((a) => '<div class="ocard"><b>' + esc(AUDITN[a.what] || String(a.what || 'Change').replace(/^./, (c) => c.toUpperCase())) + (a.hole ? ' · hole ' + a.hole + (a.to && typeof a.to === 'number' ? '-' + a.to : '') : '') + (a.tid ? ' · ' + esc(tname(g, a.tid)) : '') + '</b><div class="omut">' + esc(a.by) + ' · ' + esc(fmtTime(a.at)) + (a.note ? ' · ' + esc(a.note) : '') + (a.from ? ' · was ' + esc(a.from.g != null ? a.from.g : Object.values(a.from.p || {}).join('/')) : '') + '</div></div>').join('') : '<div class="ocard omut">Nothing yet.</div>'); }

  // ---------- organizer: teams and handicaps ----------
  function setupTeamsV(g, s) {
    const d = g.day, org = g.role === 'org'; let h = '<h2 class="oh2">Teams and handicaps</h2>';
    if (!org) { h += '<div class="onote">The organizer is setting up teams.</div>' + d.teams.map((t) => '<div class="ocard"><b>' + esc(t.name) + '</b><div class="omut">' + (t.players.map((p) => esc(p.name)).join(', ') || 'Open') + ' · ' + (t.slots - t.players.length) + ' open</div>' + (t.players.length < t.slots && !t.players.some((p) => p.pid === g.me) ? '<button class="osec ofull" data-a="claim" data-tid="' + att(t.tid) + '">Join this team</button>' : '') + '</div>').join('');
      const mh = hiOf(g, g.me); h += '<div class="ocard"><b>My handicap</b><div class="ohi2">' + esc(mh.text) + '</div><div class="omut">' + HCPL + '. ' + HCPN + '</div></div>';
      return h + (mh.src === 'typed' || mh.src === 'none' ? (g.ent ? '<div class="onote">The tournament director enters handicaps for players with no rounds in the app yet.</div>' : '<label class="olab">My handicap (until I have an index)<input id="omh" class="oin" type="number" inputmode="decimal" step="0.1" value="' + esc(d.hcp[g.me]) + '"></label><button class="osec ofull" data-a="myhcp">Save my handicap</button>') : '') + '<button class="osec ofull" data-a="hcpv">Players and handicaps ›</button>' + inviteBtn(g); }
    const un = d.unassigned; if (un.length) h += '<div class="owarn"><b>' + un.length + ' not on a team</b>' + esc(un.map((x) => x.name).join(', ')) + '</div>';
    d.teams.forEach((t) => { h += '<div class="ocard"><div class="orow"><b class="oname">' + esc(t.name) + '</b><span class="omut">' + t.players.length + ' of ' + t.slots + '</span></div>';
      t.players.forEach((p) => { h += '<div class="omrow"><span>' + esc(p.name) + (t.scorer === p.pid ? ' <i class="ogold">· scorer</i>' : '') + '<small class="ohi' + (hiOf(g, p.pid).src === 'tournament' ? ' oset' : '') + '">' + esc(hiOf(g, p.pid).text) + '</small></span>' + (!g.ent && (hiOf(g, p.pid).src === 'typed' || hiOf(g, p.pid).src === 'none') ? '<input class="oin ohin" type="number" inputmode="decimal" step="0.1" data-hcp="' + att(p.pid) + '" value="' + esc(p.hcp == null ? '' : p.hcp) + '" aria-label="Handicap for ' + esc(p.name) + '">' : '<b class="ohv">' + esc(p.hcp == null ? '–' : Number(p.hcp).toFixed(1)) + '</b>') + (t.scorer !== p.pid ? '<button class="otiny" data-a="scorer" data-tid="' + att(t.tid) + '" data-pid="' + att(p.pid) + '">Scorer</button>' : '') + '<button class="otiny" data-a="unassign" data-pid="' + att(p.pid) + '">Remove</button></div>'; });
      if (t.players.length < t.slots && un.length) h += '<label class="olab">Add a player' + sel('oas_' + t.tid, [['', 'Pick a player']].concat(un.map((x) => [x.pid, x.name])), '') + '</label><button class="osec ofull" data-a="assign" data-tid="' + att(t.tid) + '">Add to ' + esc(t.name) + '</button>';
      h += '</div>'; });
    if (g.members.length >= 2 && d.teamSize >= 2) h += '<button class="opri ofull" data-a="suggest">Suggest partners</button><div class="onote">Balanced, Rotate or Hot pairs, each with the reason. It only suggests: you choose.</div>';
    if (g.ent) h += '<h2 class="oh2">Tournament handicaps</h2><div class="' + (d.hlocked ? 'owarn' : 'onote') + '">' + (d.hlocked ? '<b>Handicaps are locked</b>The tournament has started.' : 'Add a handicap for a player with no rounds in the app, or change anyone\'s for this tournament only. A reason is required and every change is logged. Their own ' + HCPL + ' is never changed. Locks when the tournament starts' + (d.lockAt ? ' (' + esc(fmtTime(d.lockAt)) + ')' : '') + '.') + '</div>' + hcpCards(g);
    else h += '<button class="osec ofull" data-a="hcpv">Players and handicaps ›</button>';
    h += '<div class="o2"><button class="osec" data-a="addteam">Add a team</button><button class="osec" data-a="guest">Add a guest</button></div><div class="onote">Guests are golfers without Oddable. They can claim their rounds later.</div>';
    if (d.heads && d.heads.on) { h += '<div class="ocard"><h2>Heads-up matches</h2>' + (d.matches.length ? d.matches.map((m) => '<div class="omrow"><span>' + esc(side(g, m.kind, m.a)) + ' vs ' + esc(side(g, m.kind, m.b)) + '</span><button class="otiny" data-a="unmatch" data-mid="' + att(m.mid) + '">Remove</button></div>').join('') : '<div class="omut">None yet.</div>');
      const ids = d.heads.kind === 'player' ? g.members.map((m) => [m.pid, m.name]) : d.teams.filter((t) => t.players.length).map((t) => [t.tid, t.name]);
      h += '<div class="o2">' + sel('oma', ids, '') + sel('omb', ids, (ids[1] || [])[0]) + '</div><div class="o2"><button class="osec" data-a="addmatch">Add match</button><button class="osec" data-a="draw">' + ({ bracket: 'Make bracket', foursome: 'Pair foursomes', random: 'Random draw', pick: 'Pair in order' })[d.heads.pair] + '</button></div></div>'; }
    h += '<button class="opri ofull obig" data-a="start">Start the round</button><div class="onote">Teams, handicaps and setup lock when the round starts. Handicaps: ' + HCPL + '. ' + HCPN + ' ' + CAPLINE + '</div>';
    return h + inviteBtn(g);
  }
  // ---------- invite ----------
  const link = (g) => location.origin + '/?join=golf.' + encodeURIComponent(g.code || '');
  function inviteBtn(g) { if (!g.code) return ''; return '<button class="osec ofull" data-a="invite">Invite people</button>' + (cur().inv ? '<div class="ocard"><div class="ocode"><span><small>Invite link</small><b>' + esc(link(g)) + '</b></span></div><div class="o2"><button class="osec" data-a="copylink">Copy link</button><a class="opri" href="sms:?&body=' + encodeURIComponent('Join "' + g.title + '" on Oddable: ' + link(g)) + '">Text it</a></div></div>' : ''); }
  function invite(g) {
    const text = 'Join "' + g.title + '" on Oddable', url = link(g);
    if (window.OddJoin && window.OddJoin.share) return window.OddJoin.share({ type: 'golf', code: g.code, title: g.title, text });
    if (navigator.share) return navigator.share({ title: g.title, text, url }).catch(() => { cur().inv = 1; paint(); });
    cur().inv = 1; paint();
  }

  // ---------- info sheets ----------
  const INFO = {
    heads: 'Match play: each hole is won, lost or halved; the match is about holes, not total strokes. "2 UP" = ahead by two holes, "AS" = all square, "dormie" = ahead by as many holes as are left, "3&2" = won 3 up with 2 to play (closed out). Net matches: the higher handicap gets the difference in strokes (strokes off the low side), on the holes with the lowest handicap index.',
    skins: 'Each hole is worth one skin. The lowest score alone wins it; if two or more tie for low, nobody wins and the skin carries over, so the next hole is worth two, and so on. Net skins take each player\'s handicap strokes off first.',
    net: 'Net = gross strokes minus handicap strokes. A player gets one stroke on each hole whose handicap index (1 = hardest) is at or below their course handicap; over 18 a second stroke starts again from index 1. The organizer sets the percent of each handicap used (and the team allowance in team formats).',
    six: 'Six tiers of golfers. Pick one from each. After the tournament the best four of your six scores (to par) are added up; lowest total wins. A golfer who misses the cut counts as the organizer chose (worst made-cut score +1, own score +10, or out of your four). If one of yours withdraws before teeing off you get one free swap from the same tier. Picks lock at the first tee time.',
    oad: 'One golfer per tournament for the whole season, and never the same golfer twice. Your golfer earns their prize money (or Oddable points by finish when the feed has no money); most at the end of the season wins. Each tournament locks at its own first tee time.',
    ctp: 'Closest to the pin: on the par 3s you choose, whoever finishes nearest the hole with the tee shot wins. Longest drive: on the holes you choose, the longest drive that ends in the fairway wins. A scorer or the organizer enters the winner.',
    allow: 'Team handicap = the percents you set here, applied to the players\' handicaps from lowest to highest, added up. Common choices are shown as defaults; your group decides. Strokes then go on the holes with the lowest handicap index first.' };
  const ITITLE = { heads: 'Heads-up match play', skins: 'Skins', net: 'Gross and net', six: 'Pick six', oad: 'One and done', ctp: 'Closest to the pin and longest drive', allow: 'Team handicap allowance' };
  function infoV() { const s = cur(), k = s.k; const f = /^fmt:/.test(k) ? FMT[k.slice(4)] : null; return '<h1>' + esc(f ? f[0] : ITITLE[k] || 'Help') + '</h1><div class="ocard">' + esc(f ? f[2] : INFO[k] || '') + '</div>'; }

  // ---------- paint ----------
  const el = () => document.getElementById('ogolf');
  function paintBusy(on) { const e = el(); if (e) e.classList.toggle('obusy', !!on); }
  function paint() {
    const e = el(); if (!e) return; const s = cur(), back = stack.length > 1 ? (stack[stack.length - 2].t === 'home' ? 'Golf' : 'Back') : '';
    const V = { pay: payV, hcps: hcpsV, suggest: suggestV, home, join: joinV, prosetup: proSetup, daysetup: daySetup, course: courseV, cdetail: courseDetailV, manual: manualV, pro: proV, day: dayV, entry: entryV, confirm: confirmV, match: matchV, skins: skinsV, extra: extraV, audit: auditV, info: infoV }[s.t];
    e.querySelector('.oin0').innerHTML = top(back) + (err ? '<div class="oerr" role="alert">' + esc(err) + '</div>' : '') + (V ? V() : '');
  }
  function push(o) { readDraft(); err = ''; stack.push(o); paint(); const e = el(); if (e) e.scrollTop = 0; }
  async function loadHome() { const s = stack[0]; try { s.list = (await post('mine', {})).games; err = ''; } catch (e) { err = errText(e); s.list = s.list || []; } paint(); }
  async function loadGame(s) { try { const j = await post('get', { id: s.id }); s.g = j.game; if (s.g && (s.t === 'pro' || s.t === 'day')) s.t = s.g.kind === 'day' ? 'day' : 'pro'; err = ''; } catch (e) { if (!offline(e)) err = errText(e); } paint(); }
  function openGame(id) { const s = { t: 'pro', id }; push(s); loadGame(s).then(() => { if (s.g && s.g.kind === 'day') { s.t = 'day'; paint(); } if (s.g && s.g.kind === 'pro' && s.g.pro.game === 'oad') loadOadEvents(s); }); }
  async function loadOadEvents(s) { try { s.events = (await post('events', { tour: s.g.pro.tour })).events.filter((e) => e.state !== 'post'); paint(); if (s.events[0]) loadOadField(s, s.events[0].id); } catch (e) { err = errText(e); paint(); } }
  async function loadOadField(s, ev) { s.oev = ev; s.field = null; try { s.field = (await post('board', { tour: s.g.pro.tour, event: ev })).golfers; } catch (e) { err = errText(e); } paint(); }
  // Poll while a board is open and the page is visible (leaderboard updates by polling)
  function tick() { const s = cur(); if (!el() || document.hidden || busy) return; if ((s.t === 'day' || s.t === 'pro') && s.id && !(s.t === 'pro' && s.tab === 'mine')) loadGame(s); }
  function draftPro() { return { title: '', tour: 'pga', game: 'six', eventId: '', mc: 'w1', tb: 'score', rank: '', entry: '', pot: 'main', take: 'none', events: null }; }
  function draftDay(solo) { return { solo: !!solo, title: '', course: null, date: new Date().toLocaleDateString('en-CA'), fmt: 'scramble4', net: 'net', allow: [], pct: '', tsize: '', dpen: 2, press: 'accept', hpct: '', count: 2, drives: 4, teams: 2, hu: false, pair: 'pick', hkind: 'team', htype: 'match', hamt: '', skins: false, sknet: true, skamt: '', ctp: '', ld: '', entry: '', pot: 'main', take: 'none', myHcp: '', hsrc: '' }; }
  async function loadEvents() { const d = DR; d.events = null; d.evErr = ''; paint(); try { const j = await post('events', { tour: d.tour }); d.events = j.events.filter((e) => e.state !== 'post'); if (!d.eventId || !d.events.some((e) => e.id === d.eventId)) d.eventId = (d.events[0] || {}).id || ''; } catch (e) { d.evErr = errText(e); d.events = []; } paint(); }
  const courseFromTee = (c, t) => ({ name: c.name, tees: t.name, holes: t.holes.length === 9 ? 9 : 18, par: t.holes.map((x) => x.par), hcp: t.holes.map((x) => x.hcp), yards: t.holes.map((x) => x.yards), rating: t.rating, slope: t.slope, city: c.city, src: 'opengolfapi', extId: c.extId, teeKey: t.key });
  function useCourse(c, id) { stack = stack.filter((x) => !['course', 'cdetail', 'manual'].includes(x.t)); DR.course = c; DR.courseId = id || null; paint(); }

  function click(ev) {
    const t = ev.target.closest('button,a,[data-a]'); if (!t || t.disabled) return; const a = t.getAttribute('data-a'), s = cur(), g = G();
    if (a === 'close') { readDraft(); try { sessionStorage.removeItem('ogolf-open'); } catch (x) {} clearInterval(timer); el().remove(); return; }
    if (a === 'back') { readDraft(); err = ''; if (stack.length > 1) stack.pop(); const c = cur(); if (c.t === 'home') loadHome(); else if (c.id && (c.t === 'day' || c.t === 'pro')) loadGame(c); paint(); return; }
    if (t.hasAttribute('data-kind')) { readDraft(); const k = t.getAttribute('data-kind'); if (k === 'day') { DR = draftDay(false); stack[stack.length - 1] = { t: 'daysetup' }; paint(); } return; }
    if (t.hasAttribute('data-game')) { readDraft(); DR.game = t.getAttribute('data-game'); paint(); return; }
    if (t.hasAttribute('data-fmt')) { readDraft(); DR.fmt = t.getAttribute('data-fmt'); DR.allow = []; paint(); return; }
    if (t.hasAttribute('data-tog')) { readDraft(); const k = t.getAttribute('data-tog'); DR[k] = !DR[k]; paint(); return; }
    if (t.hasAttribute('data-tab')) { s.tab = t.getAttribute('data-tab'); paint(); return; }
    if (a === 'info') { push({ t: 'info', k: t.getAttribute('data-k') }); return; }
    if (a === 'newpro') { DR = draftPro(); push({ t: 'prosetup' }); loadEvents(); return; }
    if (a === 'newday' || a === 'solo') { DR = draftDay(a === 'solo'); push({ t: 'daysetup' }); return; }
    if (a === 'join') { push({ t: 'join' }); return; }
    if (a === 'open') { openGame(t.getAttribute('data-id')); return; }
    if (a === 'look') { s.code = (document.getElementById('ocode') || {}).value || ''; act('look', { code: s.code }, async (j) => { s.pre = j.game; paint(); }); return; }
    if (a === 'dojoin') { const h = (document.getElementById('ojh') || {}).value; act('join', { code: s.code, tid: t.getAttribute('data-tid') || undefined, hcp: h === '' || h == null ? undefined : Number(h) }, async (j) => { stack = [stack[0]]; loadHome(); const o = { t: j.game.kind === 'day' ? 'day' : 'pro', id: j.game.id, g: j.game }; push(o); }); return; }
    if (a === 'createpro') { readDraft(); const d = DR; act('create', { kind: 'pro', title: d.title.trim(), pro: { tour: d.tour, game: d.game, eventId: d.eventId, mc: d.mc, tb: d.tb, rank: d.rank }, pot: potPayload(d) }, async (j) => { DR = null; stack = [stack[0]]; loadHome(); const o = { t: 'pro', id: j.game.id, g: j.game, tab: 'mine' }; push(o); if (j.game.pro.game === 'oad') loadOadEvents(o); }); return; }
    if (a === 'createday') { readDraft(); if (!DR.course) { err = 'Pick a course first.'; paint(); return; } act('create', dayPayload(), async (j) => { DR = null; stack = [stack[0]]; loadHome(); push({ t: 'day', id: j.game.id, g: j.game, tab: j.game.day.solo ? 'card' : 'lb' }); }); return; }
    if (a === 'course') { readDraft(); push({ t: 'course', q: '' }); act('courses', {}, async (j) => { cur().res = j; paint(); }); return; }
    if (a === 'csearch') { s.q = (document.getElementById('oq') || {}).value || ''; s.st = (document.getElementById('ost') || {}).value || ''; act('courses', { q: s.q, state: s.st }, async (j) => { s.res = j; paint(); }); return; }
    if (a === 'cmore') { const A = s.res && s.res.api; if (!A || A.next == null) return; act('courses', { q: s.q, state: s.st, offset: A.next }, async (j) => { const B = j.api || {}; if (B.ok) { const have = new Set(A.results.map((c) => c.extId)); A.results = A.results.concat((B.results || []).filter((c) => !have.has(c.extId))); A.next = B.next; A.total = Math.max(A.total || 0, B.total || 0, A.results.length); } else { err = B.error || "Couldn't reach the course list. Try again."; } paint(); }); return; }
    if (a === 'csaved') { const c = s.res.courses.concat(s.res.owned || []).find((x) => x.id === t.getAttribute('data-id')); if (c) { useCourse({ name: c.name, tees: c.tees, holes: c.holes, par: c.par, hcp: c.hcp, yards: c.yards || undefined, rating: c.rating, slope: c.slope, city: c.city }, c.id); } return; }
    if (a === 'cdir') { const o = { t: 'cdetail' }; push(o); act('coursedetail', { extId: t.getAttribute('data-x') }, async (j) => { o.c = j.course; o.ti = j.course.tees.length === 1 ? 0 : null; paint(); }); return; }
    if (a === 'tee') { const i = +t.getAttribute('data-i'); s.ti = s.ti === i ? null : i; paint(); return; }
    if (a === 'usetee') { const c = s.c, tee = c.tees[+t.getAttribute('data-i')]; useCourse(courseFromTee(c, tee)); return; }
    if (a === 'edittee') { const c = s.c, tee = c.tees[+t.getAttribute('data-i')], n = 18; push({ t: 'manual', m: { name: c.name, tees: tee.name, holes: n, rating: tee.rating || '', slope: tee.slope || '', par: Array.from({ length: n }, (_, i) => (tee.holes.find((x) => x.n === i + 1) || {}).par || 4), hcp: Array.from({ length: n }, (_, i) => (tee.holes.find((x) => x.n === i + 1) || {}).hcp || i + 1), yards: Array.from({ length: n }, (_, i) => (tee.holes.find((x) => x.n === i + 1) || {}).yards || '') } }); return; }
    if (a === 'cmanual') { push({ t: 'manual', m: { name: '', tees: '', holes: 18, rating: '', slope: '', par: Array(18).fill(4), hcp: Array.from({ length: 18 }, (_, i) => i + 1), yards: Array(18).fill('') } }); return; }
    if (a === 'msave') { readManual(); const m = s.m, n = m.holes; const c = { name: m.name.trim(), tees: m.tees.trim(), holes: n, par: m.par.slice(0, n), hcp: m.hcp.slice(0, n), yards: m.yards.slice(0, n).map((y) => (y === '' ? null : Number(y))), rating: m.rating === '' ? null : Number(m.rating), slope: m.slope === '' ? null : Number(m.slope) };
      act('course', { course: c }, async () => { useCourse(c); }); return; }
    if (a === 'entry') { const e = g.entries.find((x) => x.pid === t.getAttribute('data-pid')); if (!e || !e.picks) { err = 'Their golfers show once picks lock.'; paint(); return; } push({ t: 'info', k: '', html: 1, g, e }); cur().t = 'entryd'; paint(); return; }
    if (a === 'more') { s.more = 1; paint(); return; }
    if (a === 'savepicks') { const picks = g.tiers.map((_, i) => (document.getElementById('opk' + i) || {}).value || ''); s.picks = picks; const gv = (document.getElementById('oguess') || {}).value; s.guess = gv; if (picks.some((x) => !x)) { err = 'Pick a golfer in every tier.'; paint(); return; } if (g.g16 && !confirm('Save and lock these six golfers? They cannot be changed.')) return; act('pick', { id: g.id, picks, guess: gv === '' ? null : Number(gv) }, async (j) => { s.g = j.game; s.picks = null; s.tab = 'pool'; paint(); }, NOTSAVED); return; }
    if (a === 'swap') { const i = t.getAttribute('data-i'); act('swap', { id: g.id, from: t.getAttribute('data-from'), to: (document.getElementById('oswap' + i) || {}).value }, async (j) => { s.g = j.game; paint(); }); return; }
    if (a === 'oadmoney') { const ev = t.getAttribute('data-ev'), money = {}; document.querySelectorAll('#ogolf [data-om="' + ev + '"]').forEach((i) => { money[i.getAttribute('data-g')] = Number(i.value) || 0; }); act('oadmoney', { id: g.id, event: ev, money }, async (j) => { s.g = j.game; paint(); }, NOTSAVED); return; }
    if (a === 'oadpick') { if (g.g16 && !confirm('Save and lock this pick? It cannot be changed.')) return; act('pick', { id: g.id, event: s.oev, golfer: (document.getElementById('oog') || {}).value }, async (j) => { s.g = j.game; paint(); }, NOTSAVED); return; }
    if (a === 'team') { if (g.role === 'org' && g.board.rows.find((r) => r.tid === t.getAttribute('data-tid') && r.disputed.length)) { push({ t: 'confirm', tid: t.getAttribute('data-tid') }); return; } s.tab = 'card'; s.ctid = t.getAttribute('data-tid'); paint(); return; }
    if (a === 'enter' || a === 'hole') { const tid = t.getAttribute('data-tid'), h = +t.getAttribute('data-h'); const can = g.role === 'org' || g.day.iScore.includes(tid); if (!can || g.day.status !== 'live') return; push({ t: 'entry', tid, h, id: g.id, settle: !!t.getAttribute('data-settle') }); return; }
    if (a === 'hprev' || a === 'hnext') { s.h += a === 'hnext' ? 1 : -1; s.v = null; s.drive = null; s.putts = null; paint(); return; }
    if (a === 'inc' || a === 'dec') { const k = t.getAttribute('data-k'); s.v[k] = Math.max(1, Math.min(15, (s.v[k] || 0) + (a === 'inc' ? 1 : -1))); paint(); return; }
    if (a === 'pinc' || a === 'pdec') { s.putts = Math.max(0, Math.min(10, (s.putts == null ? (a === 'pinc' ? -1 : 1) : s.putts) + (a === 'pinc' ? 1 : -1))); paint(); return; }
    if (a === 'drive') { s.drive = t.getAttribute('data-pid'); paint(); return; }
    if (a === 'savehole') { saveHole(s); return; }
    if (a === 'qsend') { flush().then(paint); return; }
    if (a === 'qretry' || a === 'qdrop') { const eid = t.getAttribute('data-eid'), it = QF().find((x) => x.eid === eid); if (!it) { paint(); return; } if (a === 'qdrop' && !confirm('Discard the entry for hole ' + it.hole + '? It was not saved on the server.')) return; qDrop('golf-qf', eid);
      if (a === 'qretry') { const b = Object.assign({}, it); delete b.why; delete b.at; delete b.rev; delete b.eid; queueScore(b).then(paint); } paint(); return; }
    if (a === 'voice') { const d = g.day, tm = d.teams.find((x) => x.tid === s.tid); openVoice(g, s.tid || (d.teams.find((x) => x.players.some((p) => p.pid === g.me)) || d.teams[0]).tid, s.h || null, s.t !== 'entry'); return; }
    if (a === 'confirmv') { push({ t: 'confirm', tid: t.getAttribute('data-tid') }); return; }
    if (a === 'confirm') { act('confirm', { id: g.id, tid: s.tid, from: +t.getAttribute('data-f'), to: +t.getAttribute('data-t') }, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'dispute') { const note = prompt('What looks wrong on hole ' + t.getAttribute('data-h') + '?') || ''; act('dispute', { id: g.id, tid: s.tid, hole: +t.getAttribute('data-h'), note }, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'match') { push({ t: 'match', mid: t.getAttribute('data-mid') }); return; }
    if (a === 'press') { act('match', { id: g.id, op: 'press', mid: s.mid, from: +t.getAttribute('data-from') }, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'skins') { push({ t: 'skins' }); return; }
    if (a === 'extra') { push({ t: 'extra', k: t.getAttribute('data-k'), h: +t.getAttribute('data-h') }); return; }
    if (a === 'saveextra') { act('extra', { id: g.id, kind: s.k, hole: s.h, who: (document.getElementById('oxw') || {}).value, note: (document.getElementById('oxn') || {}).value }, async (j) => { setG(j.game); stack.pop(); paint(); }); return; }
    if (a === 'auditv') { push({ t: 'audit' }); return; }
    if (a === 'payv') { push({ t: 'pay' }); return; }
    if (a === 'paid') { act('paid', { id: g.id, pid: t.getAttribute('data-pid'), paid: t.getAttribute('data-on') === '1' }, async (j) => { setG(j.game); paint(); }, NOTSAVED); return; }
    if (a === 'xconfirm') { act('extraconfirm', { id: g.id, kind: s.k, hole: s.h }, async (j) => { setG(j.game); paint(); }, NOTSAVED); return; }
    if (a === 'paccept' || a === 'pdecline') { act('match', { id: g.id, op: a === 'paccept' ? 'accept' : 'decline', mid: s.mid, from: +t.getAttribute('data-from') }, async (j) => { setG(j.game); paint(); }, NOTSAVED); return; }
    if (a === 'hcpv') { saveHcps(g, () => push({ t: 'hcps' })); return; }
    if (a === 'sethcp') { const pid = t.getAttribute('data-pid'), v = (document.getElementById('oth_' + pid) || {}).value, why = (document.getElementById('otr_' + pid) || {}).value || ''; if (v === '' || v == null) { err = 'Type the tournament handicap.'; paint(); return; } act('team', { id: g.id, op: 'hcp', pid, hcp: Number(v), reason: why }, async (j) => { setG(j.game); paint(); }, NOTSAVED); return; }
    if (a === 'suggest') { saveHcps(g, () => { const o = { t: 'suggest', mode: 'balanced' }; push(o); loadSuggest(o, g); }); return; }
    if (t.hasAttribute('data-smode')) { s.mode = t.getAttribute('data-smode'); s.res = null; paint(); loadSuggest(s, g); return; }
    if (a === 'usesug') { const sg = s.res && s.res.suggestions[+t.getAttribute('data-i')]; if (!sg) return; if (!confirm('Put the players on these teams? You can still change them before the round starts.')) return; applySuggest(g, sg); return; }
    if (a === 'final' || a === 'reopen') { if (a === 'final' && !confirm('Finish the round? Scores lock.')) return; const un = a === 'final' && g.day.money && !g.day.solo ? g.day.unconfirmed.n : 0; let body = { id: g.id };
      if (un) { const why = prompt(un + ' hole' + (un === 1 ? ' was' : 's were') + ' never confirmed by another team. Money is on this round, so they should be confirmed first. To finish anyway, type the reason (it is logged and shown to everyone):'); if (!why) { err = un + ' hole' + (un === 1 ? ' was' : 's were') + " never confirmed. Have another team's scorer confirm them, or finish anyway with a reason."; paint(); return; } body = { id: g.id, force: true, reason: why }; }
      act(a, body, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'start') { saveHcps(g, () => act('start', { id: g.id }, async (j) => { setG(j.game); paint(); })); return; }
    if (a === 'claim') { act('join', { code: g.code, tid: t.getAttribute('data-tid') }, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'myhcp') { act('team', { id: g.id, op: 'hcp', pid: g.me, hcp: Number((document.getElementById('omh') || {}).value) }, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'assign') { const tid = t.getAttribute('data-tid'), pid = (document.getElementById('oas_' + tid) || {}).value; if (!pid) return; act('team', { id: g.id, op: 'assign', pid, tid }, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'unassign') { act('team', { id: g.id, op: 'assign', pid: t.getAttribute('data-pid') }, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'scorer') { act('team', { id: g.id, op: 'scorer', tid: t.getAttribute('data-tid'), pid: t.getAttribute('data-pid') }, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'addteam') { act('team', { id: g.id, op: 'add' }, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'guest') { const name = prompt('Guest name'); if (!name) return; act('team', { id: g.id, op: 'guest', name }, async (j) => { setG(j.game); err = ''; paint(); if (j.guest) alert('Guest added. Claim code for ' + name + ' (shown once): ' + j.guest.gid + '-' + j.guest.token); }); return; }
    if (a === 'addmatch') { act('match', { id: g.id, op: 'add', a: (document.getElementById('oma') || {}).value, b: (document.getElementById('omb') || {}).value }, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'unmatch') { act('match', { id: g.id, op: 'remove', mid: t.getAttribute('data-mid') }, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'draw') { act('match', { id: g.id, op: 'draw' }, async (j) => { setG(j.game); paint(); }); return; }
    if (a === 'invite') { invite(g); return; }
    if (a === 'copylink') { try { navigator.clipboard.writeText(link(g)); t.textContent = 'Copied'; } catch (x) { t.textContent = link(g); } return; }
  }
  // 🎤 Log my score: the shared voice module (speech -> Claude -> confirmation card) saves through OddGolf.saveHole / saveRound = the normal scorer route.
  function openVoice(g, tid, hole, round) { const d = g.day, tm = d.teams.find((x) => x.tid === tid) || d.teams[0], sc = d.scores[tm.tid] || {}, next = hole || Math.min(d.course.par.length, Object.keys(sc).length + 1);
    window.VoiceLog.open({ target: round || d.solo ? 'golf-round' : 'golf-hole', roundId: g.id, teamId: tm.tid, tid: tm.tid, holes: d.course.par.map((par, i) => ({ n: i + 1, par, index: d.course.hcp[i], entered: !!sc[i + 1] })), hole: next, current: next, teamBall: !!TEAMBALL[d.fmt], format: d.fmt, team: tm.name, names: tm.players.map((p) => p.name), players: tm.players.map((p) => ({ pid: p.pid, name: p.name })) }); }
  function setG(game) { stack.forEach((x) => { if (x.g && x.g.id === game.id) x.g = game; }); }
  function saveHcps(g, then) { const ins = [...document.querySelectorAll('#ogolf [data-hcp]')].filter((i) => i.value !== '' && Number(i.value) !== g.day.hcp[i.getAttribute('data-hcp')]); (async () => { for (const i of ins) { try { const j = await post('team', { id: g.id, op: 'hcp', pid: i.getAttribute('data-hcp'), hcp: Number(i.value) }); setG(j.game); } catch (e) { err = errText(e); paint(); return; } } then(); })(); }
  // Save one hole through the normal scorer route (queued on the phone if offline). Also used by the voice target.
  function holeBody(g, tid, hole, v, drive, putts) { const d = g.day, t = d.teams.find((x) => x.tid === tid), cur0 = (d.scores[tid] || {})[hole]; const b = { id: g.id, tid, hole, rev: cur0 ? cur0.rev : undefined }; if (TEAMBALL[d.fmt]) b.g = v.g; else { b.p = {}; t.players.forEach((p) => (b.p[p.pid] = v[p.pid])); } if (drive) b.drive = drive; if (putts != null) b.putts = putts; return b; }
  function saveHole(s) {
    const g = G(), b = holeBody(g, s.tid, s.h, s.v, s.drive, s.putts);
    if (g.day.fmt === 'texas' && !b.drive) { err = 'Whose drive was used?'; paint(); return; }
    if (s.settle) { act('resolve', b, async (j) => { setG(j.game); stack.pop(); paint(); }); return; }
    const sc = g.day.scores[s.tid] = g.day.scores[s.tid] || {}; sc[s.h] = Object.assign({}, sc[s.h] || {}, { g: b.g, p: b.p, st: 'entered', by: 'you (sending)', rev: sc[s.h] ? sc[s.h].rev : 0 }); // optimistic
    queueScore(b).then(() => { const q = Q(); if (!q.some((x) => x.id === g.id && x.hole === s.h)) { /* sent */ } paint(); });
    if (s.h < g.day.course.par.length) { s.h++; s.v = null; s.drive = null; s.putts = null; } else stack.pop(); err = ''; paint();
  }
  // Public hooks: the shared voice module (VoiceLog) and the join router (OddJoin) call these.
  window.OddGolf = {
    open: () => window.oddGolf(),
    // saveHole({roundId, tid, hole, strokes (team) | p:{pid:strokes}, drive, putts}) goes through the same scorer route: scorer-only, confirmation rules apply.
    saveHole: async (o) => { const j = await post('get', { id: o.roundId }); const g = j.game, tid = o.tid || o.teamId || g.day.myTeam; const v = TEAMBALL[g.day.fmt] ? { g: o.strokes } : Object.assign({}, o.p || { [g.me]: o.strokes }); return queueScore(holeBody(g, tid, o.hole, v, o.drive, o.putts)); },
    saveRound: async (o) => { for (const h of o.holes || []) await window.OddGolf.saveHole(Object.assign({ roundId: o.roundId, tid: o.tid }, h)); },
  };
  if (window.VoiceLog && window.VoiceLog.registerTarget) { try { ['golf-hole', 'golf-round'].forEach((n) => window.VoiceLog.registerTarget(n, { schema: { hole: 'number', strokes: 'number', putts: 'number?', p: 'object?' }, describe: 'Golf score for one hole (or a whole round as holes[])', save: (o) => (o.holes ? window.OddGolf.saveRound(o) : window.OddGolf.saveHole(o)) })); } catch (e) {} }

  function change(ev) {
    const id = ev.target && ev.target.id; if (!id) return; const s = cur();
    if (id === 'otour') { readDraft(); loadEvents(); return; }
    if (id === 'octid') { s.ctid = ev.target.value; paint(); return; }
    if (id === 'ooev') { loadOadField(s, ev.target.value); return; }
    if (id === 'mholes') { readManual(); paint(); return; }
    if (id === 'otsize') { readDraft(); DR.allow = []; paint(); return; }
    if (['ofmt', 'onet', 'ohkind', 'ohtype', 'opair', 'ocount'].includes(id)) { readDraft(); paint(); }
  }
  function css() {
    if (document.getElementById('ogocss')) return; const st = document.createElement('style'); st.id = 'ogocss';
    st.textContent = '#ogolf{--p:var(--panel,#0b1a30);--p2:var(--panel,#0b1a30);--sel:var(--panel2,#10264a);--l:var(--line,#1f3d69);--i:var(--ink,#f3f6fa);--m:var(--muted,#9aabbf);--gl:var(--green,#4fd18b);--r:var(--red,#ff5a4d);--y:var(--gold,#f5c542);--v:var(--blue,#c6cbd7);--nv:#003594;--sv:#c6cbd7;position:fixed;inset:0;z-index:96;background:var(--bg,#050c17);color:var(--i);overflow:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
      + '#ogolf *{box-sizing:border-box}#ogolf .oin0{max-width:560px;margin:0 auto;padding:0 16px calc(48px + env(safe-area-inset-bottom))}#ogolf.obusy .opri{opacity:.6}#ogolf h1{font-size:28px;line-height:1.15;margin:8px 0 2px;overflow-wrap:anywhere}#ogolf h2{font-size:18px;margin:0 0 10px}#ogolf .oh2{margin:16px 0 4px}#ogolf .osub{color:var(--m);margin:0 0 14px}'
      + '#ogolf .otop{display:flex;justify-content:space-between;align-items:center;padding:0}'
      + '#ogolf .ohdr{margin:0 -16px 12px;padding:max(10px,env(safe-area-inset-top)) 16px 14px;background:linear-gradient(135deg,#003594 0%,#002b5c 38%,#041e42 74%,#08111f 100%);border-bottom:3px solid #869397;border-radius:0 0 26px 26px;color:#fff}#ogolf .ohdr h1{color:#fff}#ogolf .ohdr .ometa,#ogolf .ohdr .osub,#ogolf .ohdr .omut,#ogolf .ohdr .ohelp{color:#c6cbd7}#ogolf .ohdr .oback{color:#fff}#ogolf .ohdr .ox{color:#c6cbd7}#ogolf .ohdr .oi{color:#fff}'
      + '#ogolf button,#ogolf a.opri{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}'
      + '#ogolf .oback,#ogolf .ox,#ogolf .olink{background:none;border:0;color:var(--v);font-weight:600;min-height:44px;padding:0 4px;text-align:left}#ogolf .ox{color:var(--m)}#ogolf .olink{display:block;width:100%}'
      + '#ogolf .opri,#ogolf .osec{min-height:48px;border-radius:12px;font-weight:700;font-size:16px;padding:10px 12px;text-decoration:none;display:flex;align-items:center;justify-content:center;text-align:center}#ogolf .opri{background:var(--nv);border:1px solid var(--sv);color:#fff}#ogolf .osec{background:var(--p2);border:1px solid var(--l);color:var(--i)}#ogolf .ofull{width:100%;margin:12px 0}#ogolf .obig{min-height:64px;font-size:19px}'
      + '#ogolf .o2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}#ogolf .o2>*{min-width:0}#ogolf .o2g{display:grid;grid-template-columns:1fr 1fr;gap:10px}#ogolf .o4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}'
      + '#ogolf .oh{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--m);margin:22px 0 10px}#ogolf .ocard{background:var(--p);border:1px solid var(--l);border-radius:14px;padding:12px 14px;margin:10px 0;display:block;width:100%;text-align:left}#ogolf .ocard.oon{border:2px solid var(--y);background:#f5c54210}#ogolf .obtn{color:inherit}'
      + '#ogolf .orow{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}#ogolf .oname{font-size:19px;font-weight:700;overflow-wrap:anywhere;min-width:0}#ogolf .obadge{background:var(--sel);color:var(--i);border:1px solid var(--sv);border-radius:999px;padding:4px 12px;font-size:13px;font-weight:700}'
      + '#ogolf .olive{background:#4fd18b1f;border:1px solid var(--gl);color:var(--gl);border-radius:999px;padding:5px 12px;font-weight:700;font-size:14px;white-space:nowrap}#ogolf .olive.off{background:rgba(198,203,215,.12);border-color:rgba(198,203,215,.4);color:#e3e7ee}'
      + '#ogolf .ometa{color:var(--m);margin:2px 0 8px}#ogolf .omut{color:var(--m)}#ogolf .onote{color:var(--m);font-size:13.5px;margin:8px 0}#ogolf .opos{color:var(--gl)}#ogolf .oneg{color:var(--r)}#ogolf .ogold{color:var(--y)}#ogolf .ob{font-weight:800}#ogolf .oattr{color:var(--m);font-size:12px;margin:6px 0}'
      + '#ogolf .olab{display:block;color:var(--m);font-size:14px;font-weight:600;margin:12px 0 6px}#ogolf .olab .oin,#ogolf .olab .osel{margin-top:6px}'
      + '#ogolf .oin,#ogolf .osel{width:100%;min-height:48px;background:var(--p2);border:1px solid var(--l);border-radius:10px;color:var(--i);font:600 16px system-ui;padding:10px 12px;color-scheme:dark;min-width:0}#ogolf .ota{min-height:80px}#ogolf .ocodein{text-transform:uppercase;letter-spacing:.12em;font-size:19px}'
      + '#ogolf .oseg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:8px;margin:8px 0 12px}#ogolf .oseg button{min-height:44px;border-radius:999px;border:1px solid var(--l);background:var(--p);color:var(--i);font-size:14px;padding:6px 12px}#ogolf .oseg button.on{background:#fff;border-color:#fff;color:#041e42;font-weight:700}'
      + '#ogolf .oopt{display:block;width:100%;text-align:left;background:var(--p);border:1px solid var(--l);border-radius:14px;color:var(--i);padding:12px 14px;margin:8px 0;min-height:56px}#ogolf .oopt b{font-size:17px}#ogolf .oopt small{color:var(--y);font-weight:700}#ogolf .oopt.on{border:2px solid var(--y);background:#f5c54210}#ogolf .oopt.soon{opacity:.6;cursor:not-allowed}#ogolf .oopt.soon small{color:var(--y)}'
      + '#ogolf .ofmtw{display:flex;gap:4px;min-width:0}#ogolf .ofmt{flex:1;min-width:0;min-height:48px;border-radius:999px;border:1px solid var(--l);background:var(--p);color:var(--i);font-weight:600;padding:6px 10px;font-size:14px}#ogolf .ofmt.on{background:var(--sel);border-color:var(--sv);font-weight:700}#ogolf .oi{flex:0 0 44px;width:44px;min-height:44px;border:0;background:none;color:var(--v);font-size:18px}'
      + '#ogolf .oline{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:52px;padding:4px 0}#ogolf .oline small{display:block;color:var(--m);font-size:13px}'
      + '#ogolf .osw{flex:0 0 auto;width:64px;height:44px;border:0;background:none;position:relative;padding:0}#ogolf .osw::before{content:"";position:absolute;left:1px;right:1px;top:4px;bottom:4px;border-radius:999px;border:1px solid var(--l);background:var(--p2)}#ogolf .osw i{position:absolute;top:9px;left:6px;width:26px;height:26px;border-radius:50%;background:#869397;transition:left .15s}#ogolf .osw.on::before{background:var(--nv);border-color:var(--sv)}#ogolf .osw.on i{left:32px;background:#fff}'
      + '#ogolf .owarn{background:#f5c54210;border:2px solid var(--y);border-radius:14px;padding:10px 12px;margin:8px 0;color:var(--i)}#ogolf .owarn b{display:block;color:var(--y);font-size:17px;margin-bottom:4px}#ogolf .owarn .osel{margin-top:8px}'
      + '#ogolf .oerr{background:#d93a2e14;border:1px solid var(--r);color:var(--i);border-radius:10px;padding:10px 12px;margin:8px 0}'
      + '#ogolf .othead,#ogolf .otrow{display:grid;grid-template-columns:28px minmax(0,1fr) 54px 60px;gap:8px;align-items:center}#ogolf .othead.o3c,#ogolf .otrow.o3c{grid-template-columns:44px minmax(0,1fr) 60px}#ogolf .othead{color:var(--m);font-size:13px;font-weight:600;padding:12px 14px 4px}#ogolf .or{text-align:right;justify-self:end}'
      + '#ogolf .otrow{width:100%;text-align:left;background:var(--p);border:1px solid var(--l);border-radius:14px;padding:12px 14px;margin:8px 0;min-height:60px;color:inherit}#ogolf .otrow.me{border:2px solid var(--y);background:#f5c54210}#ogolf .opl{font-size:18px;font-weight:700}#ogolf .opn{min-width:0}#ogolf .opn b{display:block;font-size:16px;overflow-wrap:anywhere}#ogolf .opn small{display:block;color:var(--m);font-size:12.5px}#ogolf .opn small.opos{color:var(--gl)}#ogolf .opn small.ogold{color:var(--y)}#ogolf .opn small.oneg{color:var(--r)}'
      + '#ogolf .olist{padding:4px 16px}#ogolf .omrow{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:56px;border-bottom:1px solid var(--l);padding:6px 0;flex-wrap:wrap}#ogolf .omrow:last-child{border-bottom:0}#ogolf .omrow>span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}#ogolf .omrow small{display:block;color:var(--m);font-size:12.5px}#ogolf .omrow i{font-style:normal}#ogolf .omrow .or{min-width:44px}#ogolf .odim{opacity:.6}#ogolf .obtnr{width:100%;background:none;border:0;border-bottom:1px solid var(--l);text-align:left}'
      + '#ogolf .ohin{width:84px;flex:0 0 84px}#ogolf .otiny{background:none;border:1px solid var(--l);border-radius:10px;color:var(--m);min-height:44px;min-width:60px;padding:0 8px}'
      + '#ogolf .orules>div{display:flex;flex-direction:column;padding:8px 0;border-bottom:1px solid var(--l)}#ogolf .orules>div:last-child{border-bottom:0}#ogolf .orules small{color:var(--m);font-size:12.5px}#ogolf .orules span{overflow-wrap:anywhere}'
      + '#ogolf .ogrid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;align-items:center;text-align:right}#ogolf .ogrid4>:first-child{text-align:left}#ogolf .ohd{color:var(--m);font-size:13px;font-weight:600;padding:6px 0 2px}#ogolf .ohole{min-height:48px;border-bottom:1px solid var(--l)}#ogolf .ohole .osel,#ogolf .ohole .oin{min-height:44px;padding:6px}'
      + '#ogolf .otee{display:block;width:100%;background:none;border:0;text-align:left;padding:0}#ogolf .otee .olink{margin-top:6px;min-height:36px}'
      + '#ogolf .ocode{display:flex;gap:8px;background:var(--sel);border-radius:10px;padding:10px 12px;flex-wrap:wrap}#ogolf .ocode small{display:block;color:var(--m)}#ogolf .ocode b{font-size:14px;overflow-wrap:anywhere}'
      + '#ogolf .ocardg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}#ogolf .ohc{background:var(--p);border:1px solid var(--l);border-radius:14px;padding:8px;min-height:72px;text-align:left;display:flex;flex-direction:column;gap:2px;min-width:0;color:inherit}#ogolf .ohc small{color:var(--m);font-size:11.5px}#ogolf .ohc b{font-size:19px;overflow-wrap:anywhere}#ogolf .ohc i{font-style:normal;font-size:11.5px;color:var(--m)}#ogolf .ohc.ocf{border-color:var(--gl);background:#16915a14}#ogolf .ohc.odp{border-color:var(--r);background:#d93a2e14}#ogolf .ohc .otiny{min-height:44px;margin-top:4px}'
      + '#ogolf .ohole0{display:grid;grid-template-columns:64px 1fr 64px;align-items:center;gap:8px;margin:8px 0;text-align:center}#ogolf .ohole0 b{display:block;font-size:26px}#ogolf .ohole0 small{color:var(--m)}'
      + '#ogolf .ostep{min-width:64px;min-height:64px;border-radius:12px;color:var(--i);border:1px solid var(--l);background:var(--p2);font-size:30px;font-weight:700}#ogolf .ostep:disabled{opacity:.35}'
      + '#ogolf .ostk{display:grid;grid-template-columns:minmax(0,1fr) 64px 56px 64px;gap:8px;align-items:center;min-height:76px;border-bottom:1px solid var(--l)}#ogolf .ostk:last-child{border-bottom:0}#ogolf .ostk>span{overflow-wrap:anywhere;font-weight:600}#ogolf .ostk b{font-size:30px;text-align:center}'
      + '#ogolf .ostrip{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}#ogolf .ostrip span{min-width:26px;text-align:center;border:1px solid var(--l);border-radius:8px;font-size:12px;padding:2px 0}'
      + '#ogolf .oalert{border:2px solid var(--y)!important;background:#f5c54210!important}#ogolf .ohi{display:block;color:var(--m);font-size:13px;line-height:1.35;margin-top:2px;white-space:normal;overflow-wrap:anywhere}#ogolf .ohi.oset{color:var(--y);font-weight:600}#ogolf .ohi2{font-size:15px;line-height:1.4;margin-top:6px;overflow-wrap:anywhere}#ogolf .oset2{color:var(--y);font-weight:700;font-size:13px;margin-top:4px;overflow-wrap:anywhere}#ogolf .oreason{font-size:15px;line-height:1.4;margin:6px 0 4px}#ogolf .ohv{min-width:48px;text-align:right}#ogolf .owarn .osec{margin-top:8px}'
      + '#ogolf .ohit{border-color:var(--gl)!important;background:#16915a14!important}#ogolf .omiss{border-color:var(--r)!important;background:#d93a2e14!important}#ogolf .ostrip span.opos{border-color:var(--gl)}#ogolf .ostrip span.oneg{border-color:var(--r)}'
      + '#ogolf .ohelp{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--m);font-size:13.5px;margin:6px 0}'
      + '@media (max-width:360px){#ogolf .ocardg{grid-template-columns:repeat(2,minmax(0,1fr))}#ogolf .ostk{grid-template-columns:minmax(0,1fr) 56px 44px 56px}}';
    document.head.appendChild(st);
  }
  // entry detail (someone's six golfers) reuses golferList
  const _V = { entryd: () => { const s = cur(); return '<h1>' + esc(s.e.name) + '</h1><div class="ometa">' + (s.e.place ? ord(s.e.place) + ' · ' : '') + 'Total ' + tp(s.e.total) + ' · best four count</div>' + golferList(s.g, s.e, s.e.picks); } };
  // Oddable header treatment: the back/close row, the screen title and its meta line sit in the app's navy gradient band (owner Nov 16 2026: "Render the Oddable look").
  function hdr() { const e = el(); if (!e) return; const w = e.querySelector('.oin0'), t = w && w.querySelector(':scope > .otop'); if (!t) return; const hb = document.createElement('div'); hb.className = 'ohdr'; w.insertBefore(hb, t); hb.appendChild(t);
    let n = hb.nextElementSibling; while (n && n.classList.contains('oerr')) n = n.nextElementSibling; if (!n || !(n.tagName === 'H1' || (n.classList.contains('orow') && n.querySelector('h1')))) return; hb.appendChild(n);
    let m = n === hb.lastElementChild ? hb.nextElementSibling : null; while (m && m.classList.contains('oerr')) m = m.nextElementSibling; while (m && (m.classList.contains('ometa') || m.classList.contains('osub') || m.classList.contains('ohelp'))) { const x = m.nextElementSibling; hb.appendChild(m); m = x; } }
  const _paint = paint; paint = function () { const s = cur(); if (_V[s.t]) { const e = el(); if (!e) return; e.querySelector('.oin0').innerHTML = top('Back') + (err ? '<div class="oerr" role="alert">' + esc(err) + '</div>' : '') + _V[s.t](); hdr(); return; } _paint(); hdr(); };
  window.oddGolf = function (start) {
    css(); let e = el(); if (e) e.remove(); e = document.createElement('div'); e.id = 'ogolf'; e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', 'Golf');
    e.innerHTML = '<div class="oin0"></div>'; document.body.appendChild(e); try { sessionStorage.setItem('ogolf-open', '1'); } catch (x) {}
    stack = [{ t: 'home' }]; err = ''; e.addEventListener('click', click); e.addEventListener('change', change); paint(); loadHome();
    if (start && start.code) { const o = { t: 'join', code: start.code }; push(o); act('look', { code: start.code }, async (j) => { o.pre = j.game; paint(); }); }
    clearInterval(timer); timer = setInterval(tick, 20000); flush();
  };
  // ?join=golf.<code>: hand to the shared router if present, else open the join preview here (after sign-in).
  const joinHandler = (code) => { const c = String(code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20); if (!c) return; const go = () => { if (ls('odd-tok')) window.oddGolf({ code: c }); else setTimeout(go, 1500); }; go(); };
  if (window.OddJoin && window.OddJoin.register) window.OddJoin.register('golf', joinHandler);
  else { try { const m = /[?&]join=golf\.([A-Za-z0-9]+)/.exec(location.search); if (m) setTimeout(() => joinHandler(m[1]), 800); } catch (e) {} }
  try { if (sessionStorage.getItem('ogolf-open') === '1' && !/[?&]join=golf\./.test(location.search)) setTimeout(() => { if (!el() && ls('odd-tok')) window.oddGolf(); }, 1500); } catch (e) {}
})();
