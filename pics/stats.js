// Oddable "My stats" (player stats v1, Nov 16 2026). Full-screen overlay #ostat (pattern of groups.js / dash.js), opened from "📈 My stats" in the main menu.
// Every number comes from the server (odds-api/stats.js /stats/*); this file only shows it. Money is tracking information only.
// Screens: home (period chips WTD/MTD/YTD/Lifetime, tiles -> records) -> sport -> game type -> records -> one record; Log my play (golf round incl. hole by hole,
// pickleball match, any game); My handicap (Oddable Handicap Index, WHS method) -> round drill-down; Pickleball rating (Oddable rating, Elo); Sharing;
// Guest players + claim links; Course view (golf courses with an enterprise account, consenting players only). Back on every screen.
// Public: window.oddStats(), window.OddStats = { open, askCourseConsent(course, via), reload }. Registers the 'self' VoiceLog target and the 'claim' join type.
(function () {
  const BASE = () => window.ODD_STATS_API || window.ODD_GROUPS_API || 'https://oddable-preview-api.onrender.com';
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const att = (x) => esc(String(x == null ? '' : x).replace(/[^\w.:-]/g, ''));
  const usd = (n, sign) => { const v = Math.round((Number(n) || 0) * 100) / 100, a = Math.abs(v), s = '$' + (Number.isInteger(a) ? a.toLocaleString() : a.toFixed(2)); return (v < 0 ? '-' : sign && v > 0 ? '+' : '') + s; };
  const ordn = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const pcls = (v) => (v > 0 ? 'spos' : v < 0 ? 'sneg' : '');
  const chiDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
  const fmtDay = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.slice(0, 4) === chiDay(Date.now()).slice(0, 4) ? undefined : 'numeric', timeZone: 'UTC' }) : '');
  const SPORTN = { nfl: 'NFL', cfb: 'College football', nba: 'NBA', wnba: 'WNBA', ncaab: 'College basketball', mlb: 'MLB', nhl: 'NHL', soccer: 'Soccer', golf: 'Golf', pickleball: 'Pickleball', tennis: 'Tennis', racing: 'Racing', horse: 'Horse racing', fight: 'Fighting', other: 'Other' };
  const SPORTI = { nfl: '🏈', cfb: '🏈', nba: '🏀', wnba: '🏀', ncaab: '🏀', mlb: '⚾', nhl: '🏒', soccer: '⚽', golf: '⛳', pickleball: '🏓', tennis: '🎾', racing: '🏁', horse: '🐎', fight: '🥊', other: '🎯' };
  const KINDN = { bet: 'Bets', contest: 'Group contests', calcutta: 'Calcuttas', 'golf-round': 'Golf rounds', 'golf-pool': 'Golf pools', match: 'Matches', event: 'Events', tournament: 'Tournaments' };
  const KINDI = { bet: '🧾', contest: '👥', calcutta: '🔨', 'golf-round': '⛳', 'golf-pool': '🏆', match: '🤝', event: '🎯', tournament: '🏅' };
  const SRCN = { bets: 'My Bets', groups: 'Group', calcutta: 'Calcutta', golf: 'Golf', events: 'Event', self: 'Logged by me' };
  const PER = [['wtd', 'WTD'], ['mtd', 'MTD'], ['ytd', 'YTD'], ['all', 'Lifetime']], PERN = { wtd: 'this week', mtd: 'this month', ytd: 'this year', all: 'lifetime' };
  const WHS = 'Calculated with the World Handicap System method.';
  const HCPINFO = 'Your Oddable Handicap Index is worked out with the World Handicap System method from every round you play or log in the app. Each 18-hole round gives a Score Differential = (113 ÷ Slope Rating) × (adjusted gross score − Course Rating), to the tenth. With 20 rounds your index is the average of your lowest 8 of the most recent 20; with 3 to 19 rounds the system’s table is used (3 rounds: lowest 1 minus 2.0; 4: lowest 1 minus 1.0; 5: lowest 1; 6: lowest 2 minus 1.0; 7-8: lowest 2; 9-11: lowest 3; 12-14: lowest 4; 15-16: lowest 5; 17-18: lowest 6; 19: lowest 7). Hole scores are capped at net double bogey (par + 2 + your strokes on that hole) once you have an index, and at par + 5 before that; rounds entered as a total are used as entered. Course Handicap = index × (Slope ÷ 113) + (Course Rating − par). Not applied: daily playing conditions, soft and hard caps, exceptional score reduction, 9-hole rounds, committee review. A tournament director can set a different handicap for one tournament; that never changes this index.';
  const ELOINFO = 'Your Oddable rating is an Elo rating per sport, from the matches you play or log in the app: everyone starts at 1500; after each match your rating moves by 32 × (result − expected), where result is 1 for a win, 0 for a loss, 0.5 for a tie and expected = 1 ÷ (1 + 10^((their rating − yours) ÷ 400)). In doubles each side counts as the average of its two players. Opponents without an Oddable rating count as 1500. A tournament director can set a different rating for one tournament; that never changes this rating.';
  let stack = [{ t: 'home' }], ME = null, P = 'all', busy = false, err = '', msg = '', DR = {}, CACHE = {}, INFO = null;

  // ---------- server ----------
  async function post(op, b) {
    const r = await fetch(BASE() + '/stats/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify(Object.assign({ myName: g('odd-name') || '' }, b || {})) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server said ' + r.status), { status: r.status }); return j;
  }
  const errText = (e) => (e && /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Could not reach the server. It may be waking up: try again in a few seconds.' : e && e.status === 401 ? 'Sign in to see your stats.' : (e && e.message) || 'Something went wrong');
  async function act(op, b, then) { if (busy) return; busy = true; err = ''; msg = ''; paintBusy(true); try { const j = await post(op, b); busy = false; await then(j); } catch (e) { busy = false; err = errText(e); paint(); } paintBusy(false); }
  async function load() { try { ME = await post('me'); err = ''; } catch (e) { err = errText(e); } paint(); }
  async function fetchInto(key, op, b) { try { CACHE[key] = await post(op, b); } catch (e) { CACHE[key] = { error: errText(e) }; } paint(); }

  // ---------- small parts ----------
  const el = () => document.getElementById('ostat');
  const cur = () => stack[stack.length - 1];
  const top = (back) => '<div class="stop' + (cur().t === 'home' ? ' shtop' : '') + '">' + (back ? '<button class="sback" data-a="back">‹ ' + esc(back) + '</button>' : '<span></span>') + '<button class="sx" data-a="close" aria-label="Close My stats">Close</button></div>';
  const tile = (lab, v, cls, a, sub) => '<button class="stile" ' + (a || 'disabled') + '><small>' + esc(lab) + (a ? ' ›' : '') + '</small><b class="' + (cls || '') + '">' + v + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</button>';
  const chips = () => '<div class="schips" role="tablist">' + PER.map(([k, l]) => '<button role="tab" aria-selected="' + (k === P) + '" class="' + (k === P ? 'on' : '') + '" data-a="per" data-p="' + k + '">' + l + '</button>').join('') + '</div>';
  const rec = (t) => (t ? t.w + '-' + t.l + (t.p ? '-' + t.p : '') + (t.t ? '-' + t.t : '') : '–');
  const sub = (t) => (t ? [t.open ? t.open + ' open' : '', t.solo ? t.solo + ' played' : '', t.fin ? t.fin + ' finish' + (t.fin === 1 ? '' : 'es') + (t.firsts ? ' (' + t.firsts + ' 1st)' : '') : '', t.p ? 'W-L-P' : ''].filter(Boolean).join(' · ') : '');
  const roi = (t) => (t && t.roi != null ? (t.roi > 0 ? '+' : '') + t.roi + '%' : '–');
  const seg = (opts, curv, a) => '<div class="sseg">' + opts.map(([v, l]) => '<button class="' + (String(v) === String(curv) ? 'on' : '') + '" ' + a + '="' + att(v) + '">' + esc(l) + '</button>').join('') + '</div>';
  const inp = (id, lab, v, o) => { o = o || {}; return '<label class="slab">' + esc(lab) + (o.opt ? ' <em>optional</em>' : '') + '<input id="' + id + '" class="sin" ' + (o.type ? 'type="' + o.type + '"' : 'type="text"') + (o.mode ? ' inputmode="' + o.mode + '"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.max ? ' max="' + esc(o.max) + '"' : '') + ' value="' + esc(v == null ? '' : v) + '" autocomplete="off"></label>'; };
  const sel = (id, lab, opts, v) => '<label class="slab">' + esc(lab) + '<select id="' + id + '" class="sin">' + opts.map(([k, l]) => '<option value="' + esc(k) + '"' + (String(k) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>';
  const sw = (on, a) => '<button class="ssw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" ' + a + '><i></i></button>';
  const info = (k) => '<button class="sinfo" data-a="info" data-k="' + k + '" aria-label="How it is worked out">ⓘ</button>';
  const resPill = (r) => r.result === 'W' ? '<span class="b hit">✓ Won</span>' : r.result === 'L' ? '<span class="b miss">✗ Lost</span>' : r.result === 'P' ? '<span class="b spill">Push</span>' : r.result === 'T' ? '<span class="b spill">Tie</span>' : r.place && !(r.extra && r.extra.live) ? '<span class="b ' + (r.place.n === 1 ? 'hit' : 'spill') + '">' + ordn(r.place.n) + ' of ' + r.place.of + '</span>' : r.kind === 'calcutta' ? '<span class="b spill">Settled</span>' : r.kind === 'golf-round' || (r.extra && r.extra.solo) ? '<span class="b spill">Played</span>' : r.extra && r.extra.adj ? '<span class="b spill">Kept</span>' : '<span class="b spill sy">Open</span>';
  const mny = (r) => { const m = r.money; if (!m) return ''; const v = (x, sign) => (x == null ? '–' : usd(x, sign)); return '<span class="smny"><span><small>Entry</small><b>' + v(m.entry) + '</b></span><span><small>Payout</small><b>' + v(m.payout) + '</b></span><span><small>Net</small><b class="' + pcls(m.net) + '">' + v(m.net, true) + '</b></span></span>'; };
  const setBy = (r) => (r.extra && r.extra.setBy === 'tournament' ? '<span class="b spill stour">Set by tournament</span>' : '');
  // Tournament handicaps / ratings a director set for one event (E-H): always shown WITH the real Oddable value; the big number above never changes.
  const tourCard = (f, sport) => { const L = ((ME && ME.tournaments) || []).filter((x) => (f === 'hcp' ? x.hcp != null : x.rating != null && (!sport || x.sport === sport))); if (!L.length) return '';
    return '<h3 class="sh">Tournament ' + (f === 'hcp' ? 'handicaps' : 'ratings') + '</h3>' + L.map((x) => { const real = f === 'hcp' ? x.oddableHcp : x.oddableRating; return '<div class="scard"><div class="skv"><span><b>' + esc(x.title) + '</b><small>' + setBy({ extra: { setBy: 'tournament' } }) + (x.reason ? ' ' + esc(x.reason) : '') + '</small></span><b>' + esc(f === 'hcp' ? x.hcp : x.rating) + '</b></div><div class="skv"><span>Your Oddable ' + (f === 'hcp' ? 'Handicap Index' : 'rating') + ' (real results)</span><b>' + (real != null ? esc(real) : 'none yet') + '</b></div></div>'; }).join('') + '<p class="snote">A tournament’s number is used in that tournament only. It never changes your Oddable ' + (f === 'hcp' ? 'Handicap Index' : 'rating') + '.</p>'; };
  const recRow = (r) => { const right = r.pl != null ? '<b class="' + pcls(r.pl) + '">' + usd(r.pl, true) + '</b>' : r.score != null ? '<b>' + esc(r.score) + (r.toPar != null ? ' <small>(' + (r.toPar > 0 ? '+' : '') + r.toPar + ')</small>' : '') + '</b>' : '';
    return '<button class="srec res ' + (r.result === 'W' ? 'hit' : r.result === 'L' ? 'miss' : '') + '" data-a="rec" data-id="' + att(r.id) + '"><span class="srw"><b>' + esc(r.title) + '</b><small>' + esc(fmtDay(r.date) + ' · ' + (SPORTN[r.sport] || r.sport) + ' · ' + (SRCN[r.src] || r.src) + (r.verified ? ' · ✓ checked' : '')) + '</small>' + setBy(r) + '</span><span class="sr">' + resPill(r) + right + '</span>' + mny(r) + '</button>'; };
  const inPer = (r) => !ME || !ME.from[P] || r.date >= ME.from[P];
  const node = (s, k) => { const n = ME && ME.periods[P]; if (!n) return null; if (!s) return k ? n.byKind[k] : n; const x = n.bySport[s]; return x && k ? x.byKind[k] : x; };
  const today = () => (ME && ME.today) || chiDay(Date.now());
  const recById = (id) => (ME ? ME.records.find((r) => r.id === id) : null);
  const trendChart = (pts, val, lab, a) => { // pts [{date, v, id}] oldest first; tap a point strip -> a (data-a) with data-id
    if (!pts.length) return ''; const W = 360, H = 150, pl = 34, pr = 10, pt = 12, pb = 22, vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1, n = pts.length;
    const x = (i) => pl + (n === 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (n - 1)), y = (v) => pt + (1 - (v - lo) / span) * (H - pt - pb);
    let s = '<svg class="schart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(lab) + '">';
    [hi, (hi + lo) / 2, lo].forEach((v) => { s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="sgrid"/><text x="' + (pl - 4) + '" y="' + (y(v) + 4) + '" text-anchor="end" class="saxis">' + esc(val(v)) + '</text>'; });
    s += '<polyline fill="none" class="sline" points="' + pts.map((p, i) => x(i) + ',' + y(p.v)).join(' ') + '"/>';
    pts.forEach((p, i) => { s += '<circle cx="' + x(i) + '" cy="' + y(p.v) + '" r="4" class="sdot"/>'; });
    s += '<text x="' + pl + '" y="' + (H - 6) + '" class="saxis">' + esc(fmtDay(pts[0].date)) + '</text><text x="' + (W - pr) + '" y="' + (H - 6) + '" text-anchor="end" class="saxis">' + esc(fmtDay(pts[n - 1].date)) + '</text>';
    if (a) { const w = n === 1 ? W - pl - pr : (W - pl - pr) / (n - 1); pts.forEach((p, i) => { const x0 = Math.max(0, x(i) - w / 2), x1 = Math.min(W, x(i) + w / 2); s += '<rect x="' + x0 + '" y="0" width="' + (x1 - x0) + '" height="' + H + '" fill="transparent" data-a="' + a + '" data-id="' + att(p.id) + '"><title>' + esc(fmtDay(p.date) + ': ' + val(p.v)) + '</title></rect>'; }); }
    return s + '</svg>';
  };

  // ---------- home ----------
  function home() {
    if (!ME) return err ? '' : '<div class="scard">Loading your stats…</div>';
    const n = node(), t = n.tot, all = ME.records.filter(inPer), H = ME.golfHcp, pk = ME.ratings && ME.ratings.pickleball;
    let s = '<div class="shead"><h1>My stats</h1><p class="ssub">Every play you are in, lifetime: bets, groups, Calcuttas, golf, pickleball, events, tournaments and your own games. Private unless you share it.</p>' + chips() + '</div>';
    s += '<div class="s3">' + tile('Record', rec(t), '', 'data-a="list" data-f="res"', sub(t) || PERN[P]) + tile('P/L', t.money ? usd(t.pl, true) : '–', pcls(t.pl), 'data-a="list" data-f="money"', t.staked ? usd(t.staked) + ' risked' : 'money tracked') + tile('ROI', roi(t), pcls(t.roi), 'data-a="list" data-f="money"', t.pct != null ? t.pct + '% won' : '') + '</div>';
    s += '<div class="s2"><button class="spri" data-a="log">＋ Log my play</button><button class="ssec" data-a="voice">🎤 Log my score</button></div>';
    s += '<h3 class="sh">Ratings</h3><div class="s2">';
    s += '<button class="scard sbig" data-a="hcp"><small>⛳ Oddable Handicap Index</small><b>' + (H.index != null ? esc(H.index) : '–') + '</b><i>' + (H.index != null ? H.rounds + ' round' + (H.rounds === 1 ? '' : 's') + (H.toTwenty ? ' · ' + H.toTwenty + ' to a full 20' : '') : H.need + ' more round' + (H.need === 1 ? '' : 's') + ' to get one') + '</i><em>My handicap ›</em></button>';
    s += '<button class="scard sbig" data-a="rating" data-s="pickleball"><small>🏓 Oddable rating</small><b>' + (pk ? esc(pk.rating) : '–') + '</b><i>' + (pk ? pk.matches + ' match' + (pk.matches === 1 ? '' : 'es') : 'log a match to start') + '</i><em>pickleball ›</em></button></div>';
    const sports = Object.keys(n.bySport).sort((a, b) => n.bySport[b].tot.n - n.bySport[a].tot.n);
    s += '<h3 class="sh">By sport · ' + esc(PERN[P]) + '</h3>';
    if (!sports.length) s += '<div class="scard smut">Nothing ' + esc(PERN[P]) + ' yet. Bets you track in My Bets and games you log show up here.</div>';
    sports.forEach((k) => { const x = n.bySport[k], tt = x.tot, extra = x.golf ? (x.golf.rounds ? x.golf.rounds + ' round' + (x.golf.rounds === 1 ? '' : 's') + (x.golf.avg != null ? ' · avg ' + x.golf.avg : '') : '') : x.local && x.local.matches ? x.local.matches + ' match' + (x.local.matches === 1 ? '' : 'es') : '';
      s += '<button class="scard srowc" data-a="sport" data-s="' + att(k) + '"><span class="sic">' + (SPORTI[k] || '🎯') + '</span><span class="srw"><b>' + esc(SPORTN[k] || k) + '</b><small>' + esc([rec(tt) !== '0-0' ? rec(tt) : '', extra, tt.open ? tt.open + ' open' : ''].filter(Boolean).join(' · ') || tt.n + ' entries') + '</small></span><span class="sr">' + (tt.money ? '<b class="' + pcls(tt.pl) + '">' + usd(tt.pl, true) + '</b>' : '') + '<i>›</i></span></button>'; });
    const kinds = Object.keys(n.byKind).sort((a, b) => n.byKind[b].tot.n - n.byKind[a].tot.n);
    if (kinds.length) s += '<h3 class="sh">By game type · ' + esc(PERN[P]) + '</h3>';
    kinds.forEach((k) => { const tk = n.byKind[k].tot; s += '<button class="scard srowc" data-a="kind" data-s="" data-k="' + att(k) + '"><span class="sic">' + (KINDI[k] || '🎯') + '</span><span class="srw"><b>' + esc(KINDN[k] || k) + '</b><small>' + esc([tk.n + (tk.n === 1 ? ' play' : ' plays'), rec(tk) !== '0-0' ? rec(tk) : '', sub(tk)].filter(Boolean).join(' · ')) + '</small></span><span class="sr">' + (tk.money ? '<b class="' + pcls(tk.pl) + '">' + usd(tk.pl, true) + '</b>' : '') + '<i>›</i></span></button>'; });
    if (ME.errors && ME.errors.length) s += '<p class="snote syel">Some results could not load right now (' + esc(ME.errors.join(', ')) + '). Pull them again later.</p>';
    s += '<h3 class="sh">More</h3>';
    s += '<button class="scard srowc" data-a="sharing"><span class="sic">🔒</span><span class="srw"><b>Sharing</b><small>' + (ME.share ? 'Your groups see your lifetime totals' : 'Private: only you see your lifetime stats') + '</small></span><span class="sr"><i>›</i></span></button>';
    s += '<button class="scard srowc" data-a="guests"><span class="sic">👤</span><span class="srw"><b>Guest players</b><small>' + (ME.guests ? ME.guests + ' guest' + (ME.guests === 1 ? '' : 's') : 'Keep results for people without Oddable yet') + '</small></span><span class="sr"><i>›</i></span></button>';
    if (ME.courseView) s += '<button class="scard srowc" data-a="courses"><span class="sic">🏌️</span><span class="srw"><b>Course view</b><small>Players who share their handicap with your course</small></span><span class="sr"><i>›</i></span></button>';
    s += '<p class="snote">Money figures are tracking only: Oddable never collects, holds or pays money. ' + all.length + ' entries ' + esc(PERN[P]) + '.</p>';
    return s;
  }
  // ---------- sport -> game type -> records ----------
  function sportScr(c) {
    const x = node(c.s); let s = '<h1>' + (SPORTI[c.s] || '') + ' ' + esc(SPORTN[c.s] || c.s) + '</h1>' + chips();
    if (!x) return s + '<div class="scard smut">Nothing ' + esc(PERN[P]) + ' in this sport.</div>';
    const t = x.tot; s += '<div class="s3">' + tile('Record', rec(t), '', 'data-a="list" data-f="res" data-s="' + att(c.s) + '"', sub(t)) + tile('P/L', t.money ? usd(t.pl, true) : '–', pcls(t.pl), 'data-a="list" data-f="money" data-s="' + att(c.s) + '"') + tile('ROI', roi(t), pcls(t.roi), 'data-a="list" data-f="money" data-s="' + att(c.s) + '"') + '</div>';
    if (x.golf) { const G = x.golf; s += '<div class="s3">' + tile('Rounds', G.rounds, '', 'data-a="kind" data-s="golf" data-k="golf-round"', G.rounds9 ? G.rounds9 + ' of 9 holes' : '') + tile('Average', G.avg != null ? G.avg : G.avg9 != null ? G.avg9 : '–', '', 'data-a="kind" data-s="golf" data-k="golf-round"', G.avgToPar != null ? (G.avgToPar > 0 ? '+' : '') + G.avgToPar + ' to par' : '') + tile('Best', G.best ? G.best.score : '–', '', G.best ? 'data-a="rec" data-id="' + att(G.best.id) + '"' : '', G.best ? fmtDay(G.best.date) : '') + '</div>';
      s += '<button class="scard srowc" data-a="hcp"><span class="sic">⛳</span><span class="srw"><b>My handicap</b><small>Oddable Handicap Index: ' + (ME.golfHcp.index != null ? ME.golfHcp.index : 'not yet') + '</small></span><span class="sr"><i>›</i></span></button>'; if (G.teamRounds) s += '<p class="snote">' + G.teamRounds + ' team round' + (G.teamRounds === 1 ? '' : 's') + ' (scramble / best ball) count as played but not in your scoring average.</p>'; }
    if (x.local) { const L = x.local; s += '<div class="s3">' + tile('Matches', L.w + '-' + L.l, '', 'data-a="kind" data-s="' + att(c.s) + '" data-k="match"') + tile('Games won', L.gamePct != null ? L.gamePct + '%' : '–', '', 'data-a="kind" data-s="' + att(c.s) + '" data-k="match"', L.games ? L.gw + ' of ' + L.games : '') + tile('Point diff', L.pointDiff != null ? (L.pointDiff > 0 ? '+' : '') + L.pointDiff : '–', pcls(L.pointDiff), 'data-a="kind" data-s="' + att(c.s) + '" data-k="match"') + '</div>';
      if (ME.ratings && ME.ratings[c.s]) s += '<button class="scard srowc" data-a="rating" data-s="' + att(c.s) + '"><span class="sic">' + (SPORTI[c.s] || '') + '</span><span class="srw"><b>My rating</b><small>Oddable rating: ' + ME.ratings[c.s].rating + '</small></span><span class="sr"><i>›</i></span></button>'; }
    if (x.calcutta) { const C = x.calcutta; s += '<div class="s3">' + tile('Teams bought', C.teams, '', 'data-a="kind" data-s="' + att(c.s) + '" data-k="calcutta"') + tile('Spent → won', usd(C.spent) + ' → ' + usd(C.won), '', 'data-a="kind" data-s="' + att(c.s) + '" data-k="calcutta"') + tile('Net', usd(C.net, true), pcls(C.net), 'data-a="kind" data-s="' + att(c.s) + '" data-k="calcutta"', C.roi != null ? C.roi + '% ROI' : '') + '</div>'; }
    s += '<h3 class="sh">Game types</h3>';
    Object.keys(x.byKind).forEach((k) => { const tk = x.byKind[k].tot; s += '<button class="scard srowc" data-a="kind" data-s="' + att(c.s) + '" data-k="' + att(k) + '"><span class="srw"><b>' + esc(KINDN[k] || k) + '</b><small>' + esc(tk.n + ' · ' + rec(tk) + (tk.open ? ' · ' + tk.open + ' open' : '') + (tk.solo ? ' · ' + tk.solo + ' played' : '')) + '</small></span><span class="sr">' + (tk.money ? '<b class="' + pcls(tk.pl) + '">' + usd(tk.pl, true) + '</b>' : '') + '<i>›</i></span></button>'; });
    return s;
  }
  function kindScr(c) {
    const x = node(c.s, c.k), list = ME.records.filter((r) => inPer(r) && (!c.s || r.sport === c.s) && r.kind === c.k);
    let s = '<h1>' + esc(KINDN[c.k] || c.k) + '</h1><p class="ssub">' + esc((c.s ? SPORTN[c.s] || c.s : 'Every sport') + ' · ' + PERN[P]) + '</p>' + chips();
    if (x) { const t = x.tot; s += '<div class="s3">' + tile('Record', rec(t), '', '', sub(t)) + tile('P/L', t.money ? usd(t.pl, true) : '–', pcls(t.pl)) + tile('Streak', t.streak || '–', '', '', t.longW ? 'best W' + t.longW : '') + '</div>'; }
    return s + recList(list);
  }
  function listScr(c) {
    let list = ME.records.filter((r) => inPer(r) && (!c.s || r.sport === c.s));
    if (c.f === 'money') list = list.filter((r) => r.pl != null); if (c.f === 'res') list = list.filter((r) => r.result || (r.extra && r.extra.adj));
    return '<h1>' + (c.f === 'money' ? 'Money' : 'Results') + '</h1><p class="ssub">' + esc((c.s ? SPORTN[c.s] + ' · ' : '') + PERN[P]) + '</p>' + chips() + recList(list);
  }
  const recList = (list) => (list.length ? list.slice(0, 300).map(recRow).join('') + (list.length > 300 ? '<p class="snote">Showing the newest 300 of ' + list.length + '.</p>' : '') : '<div class="scard smut">Nothing here ' + esc(PERN[P]) + '.</div>');
  function recScr(c) {
    const r = recById(c.id); if (!r) return '<div class="scard smut">That entry is gone.</div>';
    const x = r.extra || {}, kv = (k, v) => (v == null || v === '' ? '' : '<div class="skv"><span>' + esc(k) + '</span><b>' + v + '</b></div>');
    let s = '<h1 class="sh1w">' + esc(r.title) + '</h1><p class="ssub">' + esc(fmtDay(r.date) + ' · ' + (SPORTN[r.sport] || r.sport) + ' · ' + (KINDN[r.kind] || r.kind)) + '</p><div class="scard">';
    s += kv('Result', resPill(r)) + kv('Score', r.score != null ? esc(r.score) + (r.toPar != null ? ' (' + (r.toPar > 0 ? '+' : '') + r.toPar + ')' : '') : x.scoreText ? esc(x.scoreText) : '') + kv('Place', r.place ? ordn(r.place.n) + ' of ' + r.place.of : '') + kv('Opponent', r.opponent ? esc(r.opponent) : '') + kv('Partner', x.partner ? esc(x.partner) : '');
    if (r.money) { const m = r.money, v = (x, sign) => (x == null ? 'not known' : usd(x, sign)); s += kv('Entry', v(m.entry)) + kv('Payout', v(m.payout)) + kv('Net', m.net == null ? 'not known' : '<span class="' + pcls(m.net) + '">' + usd(m.net, true) + '</span>'); }
    else s += kv('Money', r.placeOnly ? 'None recorded for this finish' : 'None recorded');
    if (x.setBy === 'tournament') s += (x.eventHcp != null ? kv('Handicap in this tournament', esc(x.eventHcp) + ' ' + setBy(r)) + kv('Your Oddable Handicap Index (real results)', x.oddableHcp != null ? esc(x.oddableHcp) : 'none yet') : '') + (x.eventRating != null ? kv('Rating in this tournament', esc(x.eventRating) + ' ' + setBy(r)) + kv('Your Oddable rating (real results)', x.oddableRating != null ? esc(x.oddableRating) : 'none yet') : '');
    s += kv('Course', x.course ? esc(x.course) + (x.tees ? ' · ' + esc(x.tees) + ' tees' : '') : '') + kv('Rating / Slope', x.cr != null && x.slope != null ? esc(x.cr) + ' / ' + esc(x.slope) : '') + kv('Putts', x.putts) + kv('Fairways', x.fw != null ? x.fw + (x.fwOf ? ' of ' + x.fwOf : '') : '') + kv('Greens in regulation', x.gir);
    s += kv('Where it came from', esc(SRCN[r.src] || r.src) + (r.verified ? ' · ✓ checked by Oddable' : '')) + kv('Notes', x.notes ? esc(x.notes) : '') + (x.loggedBy ? kv('Logged by', esc(x.loggedBy)) : '') + '</div>';
    if (r.kind === 'golf-round' && ME.golfHcp.diffs.some((d) => d.id === r.id)) s += '<button class="ssec sfull" data-a="round" data-id="' + att(r.id) + '">See the handicap math for this round ›</button>';
    if (r.money) s += '<p class="snote">Money is tracking only. Oddable never collects, holds or pays.</p>';
    if (x.adj) s += '<p class="snote">These bets were deleted from My Bets but stay in your daily log, so your lifetime record matches the owner dashboard.</p>';
    if (r.src === 'self' && !x.claimed && !x.loggedBy) s += '<div class="s2"><button class="ssec" data-a="edit" data-id="' + att(r.id) + '">Edit</button><button class="sdanger" data-a="del" data-id="' + att(r.id) + '">Delete</button></div>';
    return s;
  }

  // ---------- Log my play ----------
  const TYPES = [['golf', '⛳ Golf round'], ['pickleball', '🏓 Pickleball match'], ['other', '🎯 Any other game']];
  function logScr(c) {
    if (!c.type) return '<h1>Log my play</h1><p class="ssub">Your own results. They count in your lifetime stats (marked "Logged by me").</p>' + TYPES.map(([k, l]) => '<button class="sopt" data-a="type" data-k="' + k + '"><b>' + l + '</b><small>' + (k === 'golf' ? 'Total or hole by hole; counts toward your Oddable Handicap Index' : k === 'pickleball' ? 'Singles or doubles, game scores; moves your Oddable rating' : 'Bowling, darts, cards, a one-player game…') + '</small></button>').join('') + '<button class="ssec sfull" data-a="voice">🎤 Say it instead</button>';
    const d = DR, h = c.edit ? '<h1>Edit entry</h1>' : '<h1>' + esc((TYPES.find((x) => x[0] === c.type) || [])[1] || '') + '</h1>';
    let s = h + (msg ? '<div class="sok">' + esc(msg) + '</div>' : '') + inp('sf_date', 'Date', d.date || today(), { type: 'date', max: today() });
    if (c.type === 'golf') {
      const holes = Number(d.holes) === 9 ? 9 : 18, mode = d.mode || 'total', guests = CACHE.guests && CACHE.guests.guests ? CACHE.guests.guests : [];
      if (!c.edit && guests.length) s += sel('sf_guest', 'Who played', [['', 'Me']].concat(guests.map((x) => [x.gid, x.name + ' (guest)'])), d.guest || '');
      s += inp('sf_course', 'Course', d.course, { ph: 'Course name' });
      s += '<button class="ssec sfull" data-a="csearch">Search courses (ratings, slope, holes)</button>' + (CACHE.cs && CACHE.csFor !== 'calc' ? csList() : '');
      s += inp('sf_tees', 'Tees', d.tees, { ph: 'Blue, White…', opt: true }) + '<span class="slab">Holes</span>' + seg([[18, '18 holes'], [9, '9 holes']], holes, 'data-a="holes" data-v');
      s += sel('sf_format', 'Format', [['individual', 'My own ball (counts for handicap)'], ['scramble', 'Scramble (team score)'], ['bestball', 'Best ball (team score)']], d.format || 'individual');
      if (d.format && d.format !== 'individual') s += inp('sf_team', 'Team name', d.team, { opt: true }) + inp('sf_mates', 'Teammates (commas)', d.mates, { opt: true });
      s += '<div class="s3i">' + inp('sf_cr', 'Course Rating', d.cr, { mode: 'decimal', ph: '71.3' }) + inp('sf_slope', 'Slope', d.slope, { mode: 'numeric', ph: '125' }) + inp('sf_par', 'Par', d.par, { mode: 'numeric', ph: holes === 18 ? '72' : '36' }) + '</div><p class="snote">Rating and Slope are on the scorecard. Without them the round counts as played but not for your handicap.</p>';
      s += '<span class="slab">Score</span>' + seg([['total', 'Total'], ['holes', 'Hole by hole']], mode, 'data-a="mode" data-v');
      if (mode === 'total') s += inp('sf_total', 'Total score', d.total, { mode: 'numeric', ph: holes === 18 ? '88' : '44' });
      else { s += holeGrid('st', 'Strokes', holes, d.st || []); s += '<div class="sline2"><span><b>Pars and stroke index</b><small>Needed to cap bad holes at net double bogey</small></span>' + sw(!!d.pars, 'data-a="parsw"') + '</div>'; if (d.pars) s += holeGrid('pa', 'Par', holes, d.pa || []) + holeGrid('si', 'Stroke index (1 = hardest)', holes, d.si || []); }
      s += '<details class="smore"' + (d.putts || d.fw || d.gir ? ' open' : '') + '><summary>More stats (optional)</summary><div class="s3i">' + inp('sf_putts', 'Putts', d.putts, { mode: 'numeric' }) + inp('sf_fw', 'Fairways hit', d.fw, { mode: 'numeric' }) + inp('sf_fwOf', 'Fairways', d.fwOf, { mode: 'numeric', ph: '14' }) + '</div>' + inp('sf_gir', 'Greens in regulation', d.gir, { mode: 'numeric' }) + '</details>';
    }
    if (c.type === 'pickleball') {
      const fmt = d.fmt || 'singles', games = d.games && d.games.length ? d.games : [['', ''], ['', ''], ['', '']], guests = CACHE.guests && CACHE.guests.guests ? CACHE.guests.guests : [], gopts = [['', 'Typed name']].concat(guests.map((x) => [x.gid, x.name + ' (guest)']));
      s += '<span class="slab">Format</span>' + seg([['singles', 'Singles'], ['doubles', 'Doubles']], fmt, 'data-a="fmt" data-v');
      if (fmt === 'doubles') s += inp('sf_partner', 'My partner', d.partner) + (guests.length ? sel('sf_partnerGuest', 'Partner is a guest player?', gopts, d.partnerGuest || '') : '');
      s += inp('sf_opp0', fmt === 'doubles' ? 'Opponent 1' : 'Opponent', d.opp0) + (guests.length ? sel('sf_oppG0', 'Opponent is a guest player?', gopts, d.oppG0 || '') : '');
      if (fmt === 'doubles') s += inp('sf_opp1', 'Opponent 2', d.opp1) + (guests.length ? sel('sf_oppG1', 'Opponent 2 is a guest player?', gopts, d.oppG1 || '') : '');
      s += '<div class="sgh"><span>Game</span><span class="sr">Us</span><span class="sr">Them</span></div>' + games.map((x, i) => '<div class="sgr"><span>Game ' + (i + 1) + '</span><input class="sin" id="sf_g' + i + 'a" inputmode="numeric" aria-label="Game ' + (i + 1) + ' our points" value="' + esc(x[0]) + '"><input class="sin" id="sf_g' + i + 'b" inputmode="numeric" aria-label="Game ' + (i + 1) + ' their points" value="' + esc(x[1]) + '"></div>').join('');
      if (games.length < 5) s += '<button class="slink" data-a="addgame">＋ Add a game</button>';
      s += inp('sf_event', 'Event or league', d.event, { opt: true, ph: 'Tuesday ladder' });
    }
    if (c.type === 'other') {
      const res = d.result || 'W';
      s += sel('sf_sport', 'Sport', Object.keys(SPORTN).filter((k) => k !== 'golf' && k !== 'pickleball').map((k) => [k, SPORTN[k]]), d.sport || 'other') + inp('sf_title', 'What did you play?', d.title, { ph: 'Bowling, darts, chess…', opt: true });
      s += '<span class="slab">Result</span>' + seg([['W', 'Won'], ['L', 'Lost'], ['T', 'Tied'], ['solo', 'Solo']], res, 'data-a="res" data-v');
      if (res !== 'solo') s += inp('sf_opponent', 'Opponent', d.opponent, { opt: true }); s += inp('sf_score', res === 'solo' ? 'Your score' : 'Score', d.score, { opt: true, ph: res === 'solo' ? '142' : '3-1' });
    }
    s += inp('sf_notes', 'Notes', d.notes, { opt: true });
    s += '<button class="spri sfull" data-a="save">' + (c.edit ? 'Save changes' : 'Save') + '</button>' + (c.edit ? '' : '<button class="ssec sfull" data-a="voice">🎤 Say it instead</button>');
    return s;
  }
  const holeGrid = (k, lab, n, vals) => '<span class="slab">' + esc(lab) + '</span><div class="shg">' + Array.from({ length: n }, (_, i) => '<label><small>' + (i + 1) + '</small><input class="sin" id="sf_' + k + i + '" inputmode="numeric" aria-label="' + esc(lab) + ' hole ' + (i + 1) + '" value="' + esc(vals[i] == null ? '' : vals[i]) + '"></label>').join('') + '</div>' + (k === 'st' ? '<p class="snote">Total: <b id="sf_sum">' + (vals.filter((x) => x !== '' && x != null).reduce((a, b) => a + Number(b), 0) || '–') + '</b></p>' : '');
  function csList() {
    const c = CACHE.cs; if (c.loading) return '<div class="scard smut">Searching…</div>'; if (c.error) return '<div class="serr">' + esc(c.error) + '</div>'; if (c.tees) return '<div class="scard"><b>' + esc(c.name) + '</b><p class="snote">Pick your tees:</p>' + c.tees.map((t, i) => '<button class="sopt" data-a="ctee" data-i="' + i + '"><b>' + esc(t.name) + '</b><small>' + esc([t.rating ? 'Rating ' + t.rating : '', t.slope ? 'Slope ' + t.slope : '', t.par ? 'Par ' + t.par : '', t.yards ? t.yards + ' yds' : ''].filter(Boolean).join(' · ')) + '</small></button>').join('') + '<p class="snote">' + esc(c.attribution || 'Course data: OpenGolfAPI contributors (ODbL)') + '</p></div>';
    const L = (c.courses || []).map((x, i) => ['s', i, x]).concat(((c.api && c.api.results) || []).map((x, i) => ['a', i, x]));
    return '<div class="scard">' + (L.length ? L.slice(0, 12).map(([w, i, x]) => '<button class="sopt" data-a="cpick" data-w="' + w + '" data-i="' + i + '"><b>' + esc(x.name) + '</b><small>' + esc([x.city, x.state, x.tees ? x.tees + ' tees' : ''].filter(Boolean).join(', ')) + '</small></button>').join('') : '<span class="smut">No courses found. Type it in.</span>') + (c.api && c.api.attribution ? '<p class="snote">' + esc(c.api.attribution) + '</p>' : '') + '</div>';
  }
  function readForm() { // inputs -> DR (no repaint)
    const r = el(); if (!r) return; r.querySelectorAll('input[id^="sf_"],select[id^="sf_"]').forEach((i) => { const k = i.id.slice(3), m = /^(st|pa|si)(\d+)$/.exec(k), gm = /^g(\d)([ab])$/.exec(k);
      if (m) { (DR[m[1]] = DR[m[1]] || [])[+m[2]] = i.value; } else if (gm) { DR.games = DR.games && DR.games.length ? DR.games : [['', ''], ['', ''], ['', '']]; (DR.games[+gm[1]] = DR.games[+gm[1]] || ['', ''])[gm[2] === 'a' ? 0 : 1] = i.value; } else DR[k] = i.value; });
  }
  function itemFrom(type) {
    const d = DR, holes = Number(d.holes) === 9 ? 9 : 18, num = (v) => (v === '' || v == null ? null : Number(v));
    if (type === 'golf') { const it = { type: 'golf', date: d.date || today(), course: d.course, courseId: d.courseId || undefined, tees: d.tees, holes, format: d.format || 'individual', team: d.team, mates: String(d.mates || '').split(',').map((x) => x.trim()).filter(Boolean), cr: num(d.cr), slope: num(d.slope), par: num(d.par), putts: num(d.putts), fw: num(d.fw), fwOf: num(d.fwOf), gir: num(d.gir), notes: d.notes, guest: d.guest || undefined, voice: !!d.voice };
      if ((d.mode || 'total') === 'total') it.total = num(d.total); else { it.strokes = Array.from({ length: holes }, (_, i) => num((d.st || [])[i])); if (d.pars) { it.pars = Array.from({ length: holes }, (_, i) => num((d.pa || [])[i])); it.si = Array.from({ length: holes }, (_, i) => num((d.si || [])[i])); if (it.pars.every((x) => x == null)) delete it.pars; if (it.si.every((x) => x == null)) delete it.si; } }
      return it; }
    if (type === 'pickleball') { const fmt = d.fmt || 'singles'; return { type: 'pickleball', date: d.date || today(), fmt, partner: d.partner, partnerGuest: d.partnerGuest || undefined, opp: fmt === 'doubles' ? [d.opp0, d.opp1] : [d.opp0], oppGuest: fmt === 'doubles' ? [d.oppG0 || null, d.oppG1 || null] : [d.oppG0 || null], games: (d.games || []).filter((x) => x && x[0] !== '' && x[1] !== ''), event: d.event, notes: d.notes, voice: !!d.voice }; }
    return { type: 'other', date: d.date || today(), sport: d.sport || 'other', title: d.title, result: d.result || 'W', opponent: d.opponent, score: d.score, notes: d.notes, voice: !!d.voice };
  }
  function draftFrom(r) { // a saved self record -> form draft (edit)
    const x = r.extra || {}, d = { date: r.date, notes: x.notes || '' };
    if (x.type === 'golf') Object.assign(d, { course: x.course, courseId: x.courseId, tees: x.tees, holes: x.holes, format: x.format, team: x.team, mates: (x.mates || []).join(', '), cr: x.cr, slope: x.slope, par: x.par, putts: x.putts, fw: x.fw, fwOf: x.fwOf, gir: x.gir, mode: x.strokes ? 'holes' : 'total', total: r.score, st: x.strokes || [], pars: !!(x.pars || x.si), pa: x.pars || [], si: x.si || [] });
    if (x.type === 'pickleball') Object.assign(d, { fmt: x.fmt, partner: x.partner, opp0: (x.opp || [])[0], opp1: (x.opp || [])[1], games: (x.games || []).map((gm) => [String(gm[0]), String(gm[1])]), event: x.event });
    if (x.type === 'other') Object.assign(d, { sport: r.sport, title: x.ttl, result: x.solo ? 'solo' : r.result, opponent: r.opponent, score: x.scoreText });
    return d;
  }

  // ---------- My handicap ----------
  function hcpScr(c) {
    const ro = c.ro, data = ro ? CACHE['cp:' + c.cid + ':' + c.pid] : null; if (ro && !data) return '<div class="scard">Loading…</div>'; if (data && data.error) return '<div class="serr">' + esc(data.error) + '</div>';
    const H = ro ? data.golfHcp : ME.golfHcp, who = ro ? data.name : '';
    let s = '<h1>' + (ro ? esc(who) + '’s handicap' : 'My handicap') + ' ' + info('hcp') + '</h1>';
    s += '<div class="sbigc"><small>Oddable Handicap Index</small><b>' + (H.index != null ? esc(H.index) : '–') + '</b><i>' + (H.index != null ? 'from ' + (H.used === 1 ? 'your lowest round' : 'the lowest ' + H.used) + ' of ' + H.of + ' round' + (H.of === 1 ? '' : 's') + (H.adj ? ' ' + (H.adj > 0 ? '+' : '') + H.adj.toFixed(1) : '') : H.need + ' more 18-hole round' + (H.need === 1 ? '' : 's') + ' with Course Rating and Slope to get one') + '</i><em>' + esc(H.method || WHS) + '</em></div>' + (ro ? '' : tourCard('hcp'));
    if (H.index != null && H.toTwenty) s += '<p class="snote">' + H.toTwenty + ' more round' + (H.toTwenty === 1 ? '' : 's') + ' until it uses a full 20 (best 8 of 20).</p>';
    if (H.history.length > 1) s += '<h3 class="sh">Trend <small>tap a point</small></h3>' + trendChart(H.history.map((p) => ({ date: p.date, v: p.index, id: p.id })), (v) => (Math.round(v * 10) / 10).toFixed(1), 'Handicap after each round', ro ? '' : 'round');
    if (!ro) s += '<div class="s2"><button class="spri" data-a="post">＋ Post a round</button><button class="ssec" data-a="voice">🎤 Say a round</button></div>';
    s += '<h3 class="sh">Last ' + Math.min(20, H.diffs.length) + ' rounds <small>★ = counts</small></h3>';
    if (!H.diffs.length) s += '<div class="scard smut">No rounds with Course Rating and Slope yet.</div>';
    else s += '<div class="sthead"><span>Round</span><span class="sr">Score</span><span class="sr">Diff</span></div>' + H.diffs.map((d) => '<button class="strow' + (d.used ? ' cnt' : '') + '" ' + (ro ? 'disabled' : 'data-a="round" data-id="' + att(d.id) + '"') + '><span class="srw"><b>' + (d.used ? '★ ' : '') + esc(fmtDay(d.date)) + '</b><small>' + esc((d.course || d.title || 'Round') + (d.tees ? ' · ' + d.tees : '')) + '</small></span><span class="sr"><b>' + esc(d.total) + '</b>' + (d.ags !== d.total ? '<small>adj ' + esc(d.ags) + '</small>' : '') + '</span><span class="sr"><b>' + esc(d.diff.toFixed(1)) + '</b>' + (d.how === 'as-entered' ? '<small>total</small>' : '') + '</span></button>').join('');
    const notes = []; if (H.missing) notes.push(H.missing + ' round' + (H.missing === 1 ? '' : 's') + ' without Course Rating / Slope'); if (H.nine) notes.push(H.nine + ' nine-hole round' + (H.nine === 1 ? '' : 's')); if (H.team) notes.push(H.team + ' team round' + (H.team === 1 ? '' : 's'));
    if (notes.length) s += '<p class="snote">Not counted: ' + esc(notes.join(', ')) + '.</p>'; if (H.flagged) s += '<p class="snote">' + H.flagged + ' of these were entered as a total, so no hole was capped.</p>';
    if (!ro) s += calcCard(H);
    return s;
  }
  function calcCard(H) {
    const d = DR.calc || {}, idx = d.idx != null && d.idx !== '' ? Number(d.idx) : H.index, cr = Number(d.cr), sl = Number(d.slope), par = Number(d.par);
    const ok = Number.isFinite(idx) && cr >= 50 && cr <= 85 && sl >= 55 && sl <= 155 && par >= 54 && par <= 80, ch = ok ? Math.round(idx * (sl / 113) + (cr - par) + 1e-9) : null;
    let s = '<h3 class="sh">Course handicap calculator</h3><div class="scard">';
    s += inp('sc_name', 'Course', d.name || '', { ph: 'Course name', opt: true }) + '<button class="ssec sfull" data-a="csearch" data-for="calc">Search courses</button>' + (CACHE.cs && CACHE.csFor === 'calc' ? csList() : '');
    s += '<div class="s2i">' + inp('sc_idx', 'Handicap', idx != null ? idx : '', { mode: 'decimal' }) + inp('sc_par', 'Par', d.par || '', { mode: 'numeric', ph: '72' }) + '</div><div class="s2i">' + inp('sc_cr', 'Course Rating', d.cr || '', { mode: 'decimal', ph: '71.3' }) + inp('sc_slope', 'Slope', d.slope || '', { mode: 'numeric', ph: '125' }) + '</div>';
    s += '<div class="sbigc ssm"><small>' + esc(d.name ? d.name + (d.tees ? ' · ' + d.tees : '') : 'Today’s course handicap') + '</small><b id="sc_out">' + (ch != null ? ch : '–') + '</b><i>handicap × Slope ÷ 113 + (Rating − par), rounded</i></div></div>';
    return s;
  }
  function roundScr(c) {
    const d = ME.golfHcp.diffs.find((x) => x.id === c.id), r = recById(c.id); if (!d) return '<div class="scard smut">That round is no longer in your last 20.</div>';
    let s = '<h1 class="sh1w">' + esc(d.course || d.title || 'Round') + '</h1><p class="ssub">' + esc(fmtDay(d.date) + (d.tees ? ' · ' + d.tees + ' tees' : '')) + '</p>';
    s += '<div class="scard"><div class="skv"><span>Gross score</span><b>' + d.total + '</b></div><div class="skv"><span>Adjusted gross score</span><b>' + d.ags + '</b></div><div class="skv"><span>Course Rating / Slope / Par</span><b>' + d.cr + ' / ' + d.slope + ' / ' + d.par + '</b></div>';
    s += '<div class="skv"><span>Handicap before this round</span><b>' + (d.idxBefore != null ? d.idxBefore : 'none yet') + '</b></div>' + (d.ch != null ? '<div class="skv"><span>Course handicap that day</span><b>' + d.ch + '</b></div>' : '');
    s += '<div class="skv"><span>Score Differential<small>(113 ÷ ' + d.slope + ') × (' + d.ags + ' − ' + d.cr + ')</small></span><b>' + d.diff.toFixed(1) + '</b></div><div class="skv"><span>Counts now</span><b>' + (d.used ? '★ Yes (one of the lowest)' : 'No') + '</b></div></div>';
    if (d.holes) { const cut = d.holes.filter((h) => h.used < h.strokes);
      s += '<h3 class="sh">Hole by hole</h3><p class="snote">' + (d.how === 'ndb' ? 'Each hole is capped at net double bogey: par + 2 + your handicap strokes on that hole.' : 'No handicap yet, so each hole is capped at par + 5.') + (cut.length ? ' ' + cut.length + ' hole' + (cut.length === 1 ? ' was' : 's were') + ' cut.' : ' No hole was cut.') + '</p>';
      for (let a = 0; a < d.holes.length; a += 9) { const hs = d.holes.slice(a, a + 9), row = (lab, f, cls) => '<div class="shr' + (cls || '') + '"><span>' + lab + '</span>' + hs.map((h) => '<span class="' + (h.used < h.strokes ? 'scut' : '') + '">' + f(h) + '</span>').join('') + '</div>';
        s += '<div class="shole">' + row('Hole', (h) => h.n, ' shh') + row('Par', (h) => h.par) + (hs[0].si != null ? row('SI', (h) => h.si) : '') + row('Score', (h) => h.strokes) + row('Max', (h) => h.max) + row('Used', (h) => h.used, ' shu') + '</div>'; }
      if (cut.length) s += '<p class="snote">' + cut.map((h) => 'Hole ' + h.n + ': ' + h.strokes + ' → ' + h.used).join(' · ') + '</p>';
    } else s += '<p class="snote">This round was entered as a total, so it is used as entered (no hole caps). Enter it hole by hole with pars and stroke index to apply net double bogey.</p>';
    if (r) s += '<button class="ssec sfull" data-a="rec" data-id="' + att(r.id) + '">Open the entry ›</button>';
    return s;
  }
  // ---------- Pickleball (and other racket sports) rating ----------
  function ratingScr(c) {
    const R = ME.ratings && ME.ratings[c.s], list = ME.records.filter((r) => r.sport === c.s && r.kind === 'match');
    let s = '<h1>' + esc(SPORTN[c.s] || c.s) + ' rating ' + info('elo') + '</h1><div class="sbigc"><small>Oddable rating</small><b>' + (R ? R.rating : '–') + '</b><i>' + (R ? R.matches + ' rated match' + (R.matches === 1 ? '' : 'es') + ' · start 1500, K 32' : 'Log a match to start at 1500') + '</i><em>From your results in the app.</em></div>' + tourCard('rating', c.s);
    if (R && R.history.length > 1) { const ids = list.slice().reverse().filter((r) => r.result).map((r) => r.id); s += '<h3 class="sh">Trend <small>tap a point</small></h3>' + trendChart(R.history.map((p, i) => ({ date: p.date, v: p.rating, id: ids[i] || '' })), (v) => String(Math.round(v)), 'Rating after each match', 'rec'); }
    s += '<div class="s2"><button class="spri" data-a="logpb">＋ Log a match</button><button class="ssec" data-a="voice">🎤 Say a match</button></div>';
    if (c.s === 'pickleball') s += '<div class="scard"><div class="s2i">' + inp('sd_dupr', 'Your DUPR (typed by you)', ME.dupr != null ? ME.dupr : '', { mode: 'decimal', ph: '4.250', opt: true }) + '<button class="ssec sdupr" data-a="dupr">Save</button></div><p class="snote">For your own reference only. Oddable never uses it: games, seeding and partner suggestions use your Oddable rating.</p></div>';
    s += '<h3 class="sh">Matches</h3>' + (list.length ? list.slice(0, 100).map(recRow).join('') : '<div class="scard smut">No matches yet.</div>');
    return s;
  }
  // ---------- Sharing ----------
  function sharingScr() {
    const L = CACHE.consents; let s = '<h1>Sharing</h1><p class="ssub">Your lifetime stats are private unless you turn sharing on. Group members always see their own group’s results.</p>';
    s += '<div class="scard"><div class="sline2"><span><b>Show my lifetime totals to my groups</b><small>Totals only (record, P/L, ROI, golf scores): never your picks or bet titles</small></span>' + sw(ME.share, 'data-a="share"') + '</div></div>';
    s += '<h3 class="sh">Golf courses</h3><p class="snote">Courses you shared your handicap and rounds with when you joined their league or event. Turn one off and that course sees none of your rounds, old ones included.</p>';
    if (!L) s += '<div class="scard">Loading…</div>'; else if (L.error) s += '<div class="serr">' + esc(L.error) + '</div>'; else if (!L.consents.length) s += '<div class="scard smut">No courses yet.</div>';
    else L.consents.forEach((x) => { s += '<div class="scard"><div class="sline2"><span><b>' + esc(x.name) + '</b><small>' + esc(x.via.map((v) => v.title).filter(Boolean).join(', ') || 'Course') + ' · ' + (x.on ? 'sharing' : 'not sharing') + '</small></span>' + sw(x.on, 'data-a="consent" data-id="' + att(x.courseId) + '" data-on="' + (x.on ? 1 : 0) + '"') + '</div></div>'; });
    return s;
  }
  // ---------- Guest players ----------
  function guestsScr() {
    const L = CACHE.guests; let s = '<h1>Guest players</h1><p class="ssub">People you play with who are not on Oddable yet. Their results wait for them; send their claim link and the results move into their own account when they sign up. Names are never matched: only the link claims.</p>';
    s += '<div class="s2i">' + inp('sg_name', 'Name', DR.gname, { ph: 'Gary' }) + '<button class="spri sdupr" data-a="gadd">Add</button></div>';
    if (!L) return s + '<div class="scard">Loading…</div>'; if (L.error) return s + '<div class="serr">' + esc(L.error) + '</div>';
    if (!L.guests.length) s += '<div class="scard smut">No guest players yet. Add one, then pick them in a golf round or pickleball match.</div>';
    L.guests.forEach((x) => { s += '<button class="scard srowc" data-a="guest" data-id="' + att(x.gid) + '"><span class="sic">👤</span><span class="srw"><b>' + esc(x.name) + '</b><small>' + x.n + ' result' + (x.n === 1 ? '' : 's') + ' · ' + (x.claimed ? '✓ claimed' : 'not claimed yet') + '</small></span><span class="sr"><i>›</i></span></button>'; });
    return s;
  }
  function guestScr(c) {
    const G = CACHE['g:' + c.id]; if (!G) return '<div class="scard">Loading…</div>'; if (G.error) return '<div class="serr">' + esc(G.error) + '</div>';
    const x = G.guest; let s = '<h1>' + esc(x.name) + '</h1><p class="ssub">' + (x.claimed ? '✓ Claimed: new results go straight to their account.' : 'Not claimed yet.') + '</p>';
    if (!x.claimed) s += '<div class="scard"><b>Claim link</b><p class="snote">Send this to ' + esc(x.name) + ' only. Whoever opens it first and signs up gets these results.</p><div class="scopy" id="sg_link">' + esc(x.link) + '</div><div class="s2"><button class="ssec" data-a="gcopy">Copy</button><button class="ssec" data-a="gshare">Share / text</button></div></div>';
    const t = G.tree && G.tree.tot; if (t) s += '<div class="s3">' + tile('Record', rec(t), '', '', sub(t)) + tile('Handicap', G.hcp && G.hcp.index != null ? G.hcp.index : '–', '', '', 'Oddable index') + tile('Rating', G.ratings && G.ratings.pickleball ? G.ratings.pickleball.rating : '–', '', '', 'pickleball') + '</div>';
    s += '<h3 class="sh">Results</h3>' + (x.items.length ? x.items.map((r) => '<div class="srec res ' + (r.result === 'W' ? 'hit' : r.result === 'L' ? 'miss' : '') + '"><span class="srw"><b>' + esc(r.title) + '</b><small>' + esc(fmtDay(r.date) + ' · ' + (SPORTN[r.sport] || r.sport)) + '</small></span><span class="sr">' + resPill(r) + (r.score != null ? '<b>' + esc(r.score) + '</b>' : '') + '<button class="stiny" data-a="grm" data-id="' + att(r.id) + '" aria-label="Remove">✕</button></span></div>').join('') : '<div class="scard smut">No results yet.</div>');
    return s;
  }
  // ---------- Course view (enterprise courses) ----------
  function coursesScr() {
    const L = CACHE.courses; let s = '<h1>Course view</h1><p class="ssub">Players who agreed to share their Oddable Handicap Index and rounds with your course. They can stop sharing at any time.</p>';
    if (!L) return s + '<div class="scard">Loading…</div>'; if (L.error) return s + '<div class="serr">' + esc(L.error) + '</div>';
    if (!L.courses.length) return s + '<div class="scard smut">No course is linked to this account yet. Ask Oddable to link your course.</div>';
    L.courses.forEach((x) => { s += '<button class="scard srowc" data-a="course" data-id="' + att(x.id) + '"><span class="sic">🏌️</span><span class="srw"><b>' + esc(x.name) + '</b><small>' + x.players + ' sharing player' + (x.players === 1 ? '' : 's') + '</small></span><span class="sr"><i>›</i></span></button>'; });
    return s;
  }
  function courseScr(c) {
    const key = 'c:' + c.id + ':' + (c.via || ''), L = CACHE[key], tab = c.tab || 'players'; if (!L) return '<div class="scard">Loading…</div>'; if (L.error) return '<div class="serr">' + esc(L.error) + '</div>';
    let s = '<h1>' + esc(L.course.name) + '</h1><div class="schips">' + [['players', 'Players'], ['flights', 'Flights'], ['rounds', 'Rounds here'], ['prefill', 'Golf day']].map(([k, l]) => '<button class="' + (k === tab ? 'on' : '') + '" data-a="ctab" data-k="' + k + '">' + l + '</button>').join('') + '</div>';
    if (L.events.length) s += sel('sv_via', 'League / event', [['', 'All sharing players']].concat(L.events.map((v) => [v.id, v.title || v.kind])), c.via || '');
    const P2 = L.players;
    if (tab === 'players') { s += '<div class="sthead"><span>Player</span><span class="sr">Handicap</span><span class="sr">Month</span></div>' + (P2.length ? P2.map((p) => '<button class="strow" data-a="cplayer" data-id="' + att(p.pid) + '"><span class="srw"><b>' + esc(p.name) + '</b><small>' + (p.rounds + ' round' + (p.rounds === 1 ? '' : 's')) + (p.index == null ? ' · needs ' + p.need + ' more' : '') + '</small></span><span class="sr"><b>' + (p.index != null ? p.index : '–') + ' ' + (p.trend === 'better' ? '<span class="spos" aria-label="improving">▼</span>' : p.trend === 'worse' ? '<span class="sneg" aria-label="going up">▲</span>' : p.trend === 'steady' ? '<span class="smut">•</span>' : '') + '</b>' + (p.change != null ? '<small>' + (p.change > 0 ? '+' : '') + p.change + ' / 30 days</small>' : '') + '</span><span class="sr"><b>' + p.roundsMonth + '</b><small>rounds</small></span></button>').join('') : '<div class="scard smut">No sharing players' + (c.via ? ' in this league / event' : '') + ' yet.</div>') + '<p class="snote">▼ = handicap went down (better) over the last 30 days. Oddable Handicap Index. ' + WHS + '</p>'; }
    if (tab === 'flights') { const n = Number(DR.flights) || 3, rated = P2.filter((p) => p.index != null).sort((a, b) => a.index - b.index), per = Math.ceil(rated.length / n) || 1;
      s += '<span class="slab">Number of flights</span>' + seg([[2, '2'], [3, '3'], [4, '4']], n, 'data-a="flights" data-v') + '<p class="snote">Equal-size flights by handicap, lowest first. Players without a handicap are listed at the end.</p>';
      for (let i = 0; i < n; i++) { const f = rated.slice(i * per, (i + 1) * per); if (!f.length) continue; s += '<div class="scard"><b>Flight ' + String.fromCharCode(65 + i) + ' · ' + f[0].index + ' to ' + f[f.length - 1].index + '</b>' + f.map((p) => '<div class="skv"><span>' + esc(p.name) + '</span><b>' + p.index + '</b></div>').join('') + '</div>'; }
      const un = P2.filter((p) => p.index == null); if (un.length) s += '<div class="scard"><b>No handicap yet</b>' + un.map((p) => '<div class="skv"><span>' + esc(p.name) + '</span><b>–</b></div>').join('') + '</div>'; }
    if (tab === 'rounds') { const R2 = CACHE['cr:' + c.id]; if (!R2) s += '<div class="scard">Loading…</div>'; else if (R2.error) s += '<div class="serr">' + esc(R2.error) + '</div>'; else { const rs = R2.rounds.filter((r) => !c.via || P2.some((p) => p.pid === r.pid));
      s += '<div class="sthead"><span>Round</span><span class="sr">Score</span><span class="sr">Diff</span></div>' + (rs.length ? rs.map((r) => '<button class="strow" data-a="cplayer" data-id="' + att(r.pid) + '"><span class="srw"><b>' + esc(r.name) + '</b><small>' + esc(fmtDay(r.date) + (r.tees ? ' · ' + r.tees : '') + (r.team ? ' · team' : '') + (r.holes === 9 ? ' · 9 holes' : '')) + '</small></span><span class="sr"><b>' + esc(r.score) + '</b>' + (r.toPar != null ? '<small>' + (r.toPar > 0 ? '+' : '') + r.toPar + '</small>' : '') + '</span><span class="sr"><b>' + (r.diff != null ? r.diff.toFixed(1) : '–') + '</b></span></button>').join('') : '<div class="scard smut">No rounds posted here yet.</div>'); } }
    if (tab === 'prefill') { const F = CACHE['cf:' + c.id]; s += '<p class="snote">Setting up a golf day: enter the tee’s Rating, Slope and par to get every sharing player’s course handicap. The golf engine fills these in automatically once it is merged.</p><div class="s3i">' + inp('sv_cr', 'Rating', DR.vcr, { mode: 'decimal', ph: '71.3' }) + inp('sv_slope', 'Slope', DR.vslope, { mode: 'numeric', ph: '125' }) + inp('sv_par', 'Par', DR.vpar, { mode: 'numeric', ph: '72' }) + '</div><button class="spri sfull" data-a="prefill">Work out course handicaps</button>';
      if (F && F.error) s += '<div class="serr">' + esc(F.error) + '</div>'; else if (F) s += '<div class="sthead"><span>Player</span><span class="sr">Handicap</span><span class="sr">Course</span></div>' + F.players.filter((p) => !c.via || P2.some((q) => q.pid === p.pid)).map((p) => '<div class="strow"><span class="srw"><b>' + esc(p.name) + '</b></span><span class="sr"><b>' + (p.index != null ? p.index : '–') + '</b></span><span class="sr"><b>' + (p.ch != null ? p.ch : '–') + '</b></span></div>').join(''); }
    return s;
  }

  // ---------- paint ----------
  const SCR = { home, sport: sportScr, kind: kindScr, list: listScr, rec: recScr, log: logScr, hcp: hcpScr, round: roundScr, rating: ratingScr, sharing: sharingScr, guests: guestsScr, guest: guestScr, courses: coursesScr, course: courseScr };
  const BACKN = { home: 'My stats', sport: 'Sport', kind: 'Games', list: 'Records', rec: 'Entry', log: 'Log', hcp: 'Handicap', round: 'Round', rating: 'Rating', sharing: 'Sharing', guests: 'Guests', guest: 'Guest', courses: 'Courses', course: 'Course' };
  function paint() {
    const e = el(); if (!e) return; const c = cur(), prev = stack[stack.length - 2];
    let h = top(prev ? BACKN[prev.t] : '') + (err ? '<div class="serr" role="alert">' + esc(err) + '</div>' : '') + (ME || c.t === 'home' ? SCR[c.t](c) : '<div class="scard">Loading…</div>');
    if (INFO) h += '<div class="sinfoov" data-a="infox"><div class="sinfobox" role="dialog" aria-label="How it is worked out"><b>How it is worked out</b><p>' + esc(INFO) + '</p><button class="spri sfull" data-a="infox">Got it</button></div></div>';
    const y = e.scrollTop, same = e.dataset.scr === stack.length + c.t; e.querySelector('.sin0').innerHTML = h; e.dataset.scr = stack.length + c.t; if (same) e.scrollTop = y;
  }
  const paintBusy = (on) => { const e = el(); if (e) e.classList.toggle('sbusy', on); };
  function go(o) { readForm(); stack.push(o); err = ''; paint(); el().scrollTop = 0; enter(o); }
  function enter(o) { // data each screen needs
    if (o.t === 'sharing') fetchInto('consents', 'consent/list');
    if (o.t === 'guests' || (o.t === 'log' && o.type && o.type !== 'other')) fetchInto('guests', 'guest/list');
    if (o.t === 'guest') fetchInto('g:' + o.id, 'guest/get', { gid: o.id });
    if (o.t === 'courses') fetchInto('courses', 'course/mine');
    if (o.t === 'course') { fetchInto('c:' + o.id + ':' + (o.via || ''), 'course/players', { courseId: o.id, via: o.via || '' }); if (o.tab === 'rounds') fetchInto('cr:' + o.id, 'course/rounds', { courseId: o.id }); }
    if (o.t === 'hcp' && o.ro) fetchInto('cp:' + o.cid + ':' + o.pid, 'course/player', { courseId: o.cid, pid: o.pid });
  }
  function back() { readForm(); stack.pop(); if (!stack.length) stack = [{ t: 'home' }]; err = ''; msg = ''; CACHE.cs = null; paint(); }
  function close() { const e = el(); if (e) e.remove(); try { sessionStorage.removeItem('ostat-open'); } catch (x) {} }
  async function copy(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } }
  function pickTee(t, name, id) { // a course tee from the golf engine -> form or calculator
    const pars = (t.holes || []).map((h) => h.par), si = (t.holes || []).map((h) => h.hcp), full = pars.length === 18 || pars.length === 9;
    if (CACHE.csFor === 'calc') DR.calc = Object.assign({}, DR.calc, { cr: t.rating, slope: t.slope, par: t.par, name, tees: t.name });
    else Object.assign(DR, { course: name, courseId: id || undefined, tees: t.name, cr: t.rating != null ? t.rating : DR.cr, slope: t.slope != null ? t.slope : DR.slope, par: t.par != null ? t.par : DR.par }, full && pars.every(Number.isFinite) ? { holes: pars.length, pars: true, pa: pars, si: si.every(Number.isFinite) ? si : [] } : {});
    CACHE.cs = null; paint();
  }
  async function golfPost(op, b) { if (!window.OddGolf) { try { return await post(op, b); } catch (e) { throw new Error(errText(e)); } } // no golf engine in this build: the stats server asks OpenGolfAPI itself
    const r = await fetch(BASE() + '/golf/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify(b || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Course search is not available right now. Type it in.'); return j; }

  function click(ev) {
    const b = ev.target.closest('[data-a]'); if (!b || !el().contains(b) || b.disabled) return; const a = b.dataset.a, c = cur();
    if (a === 'close') return close(); if (a === 'back') return back();
    if (a === 'info') { INFO = b.dataset.k === 'elo' ? ELOINFO : HCPINFO; return paint(); } if (a === 'infox') { if (ev.target === b || b.tagName === 'BUTTON') { INFO = null; paint(); } return; }
    if (a === 'per') { P = b.dataset.p; return paint(); }
    if (a === 'list') return go({ t: 'list', f: b.dataset.f, s: b.dataset.s || '' });
    if (a === 'sport') return go({ t: 'sport', s: b.dataset.s }); if (a === 'kind') return go({ t: 'kind', s: b.dataset.s, k: b.dataset.k }); if (a === 'rec') { if (!b.dataset.id) return; return go({ t: 'rec', id: b.dataset.id }); }
    if (a === 'hcp') return go({ t: 'hcp' }); if (a === 'round') { if (!b.dataset.id) return; return go({ t: 'round', id: b.dataset.id }); } if (a === 'rating') return go({ t: 'rating', s: b.dataset.s || 'pickleball' });
    if (a === 'sharing') return go({ t: 'sharing' }); if (a === 'guests') return go({ t: 'guests' }); if (a === 'guest') return go({ t: 'guest', id: b.dataset.id }); if (a === 'courses') return go({ t: 'courses' });
    if (a === 'course') return go({ t: 'course', id: b.dataset.id, tab: 'players' });
    if (a === 'ctab') { c.tab = b.dataset.k; enter(c); return paint(); }
    if (a === 'cplayer') return go({ t: 'hcp', ro: true, cid: c.id, pid: b.dataset.id });
    if (a === 'flights') { DR.flights = b.dataset.v; return paint(); }
    if (a === 'prefill') { readForm(); DR.vcr = DR.vcr; return act('course/prefill', { courseId: c.id, cr: DR.vcr, slope: DR.vslope, par: DR.vpar }, (j) => { CACHE['cf:' + c.id] = j; paint(); }); }
    if (a === 'log') { DR = {}; return go({ t: 'log' }); } if (a === 'post') { DR = {}; return go({ t: 'log', type: 'golf' }); } if (a === 'logpb') { DR = {}; return go({ t: 'log', type: 'pickleball' }); }
    if (a === 'type') { DR = {}; c.type = b.dataset.k; enter(c); return paint(); }
    if (a === 'voice') { if (window.VoiceLog) window.VoiceLog.open({ target: 'self', today: today() }); return; }
    if (['holes', 'mode', 'fmt', 'res'].includes(a)) { readForm(); DR[a === 'res' ? 'result' : a] = b.dataset.v; return paint(); }
    if (a === 'parsw') { readForm(); DR.pars = !DR.pars; return paint(); }
    if (a === 'addgame') { readForm(); DR.games = (DR.games && DR.games.length ? DR.games : [['', ''], ['', ''], ['', '']]).concat([['', '']]).slice(0, 5); return paint(); }
    if (a === 'csearch') { readForm(); CACHE.csFor = b.dataset.for || 'form'; const q = CACHE.csFor === 'calc' ? (DR.calc && DR.calc.name) || '' : DR.course || ''; if (String(q).trim().length < 2) { CACHE.cs = { error: 'Type at least 2 letters of the course name first.' }; return paint(); } CACHE.cs = { loading: true }; paint(); golfPost('courses', { q }).then((j) => { CACHE.cs = j; paint(); }).catch((e) => { CACHE.cs = { error: e.message }; paint(); }); return; }
    if (a === 'cpick') { const w = b.dataset.w, i = +b.dataset.i, cs = CACHE.cs; if (w === 's') { const x = cs.courses[i]; const t = { name: x.tees || '', rating: x.rating, slope: x.slope, par: Array.isArray(x.par) ? x.par.reduce((p, q) => p + q, 0) : x.par, holes: Array.isArray(x.par) ? x.par.map((p, k) => ({ n: k + 1, par: p, hcp: (x.hcp || [])[k] })) : [] }; return pickTee(t, x.name, x.id); }
      const x = cs.api.results[i]; golfPost('coursedetail', { extId: x.extId }).then((j) => { CACHE.cs = j.course; paint(); }).catch((e) => { CACHE.cs = { error: e.message }; paint(); }); return; }
    if (a === 'ctee') return pickTee(CACHE.cs.tees[+b.dataset.i], CACHE.cs.name, '');
    if (a === 'save') { readForm(); const item = itemFrom(c.type); return act('self/save', Object.assign({ item }, c.edit ? { id: c.edit } : {}), async () => { const was = stack.length; await load(); stack = stack.slice(0, Math.max(1, was - 1)); msg = ''; DR = {}; paint(); toast('Saved'); }); }
    if (a === 'edit') { const r = recById(b.dataset.id); DR = draftFrom(r); return go({ t: 'log', type: r.extra.type, edit: r.id }); }
    if (a === 'del') { if (!confirm('Delete this entry? It leaves your lifetime stats.')) return; return act('self/delete', { id: b.dataset.id }, async () => { await load(); stack.pop(); paint(); toast('Deleted'); }); }
    if (a === 'dupr') { readForm(); return act('dupr', { dupr: DR.dupr }, async () => { await load(); toast('Saved'); }); }
    if (a === 'share') return act('share', { on: !ME.share }, async () => { await load(); });
    if (a === 'consent') { const on = b.dataset.on !== '1'; return act('consent/set', { courseId: b.dataset.id, on }, async () => { await fetchInto('consents', 'consent/list'); toast(on ? 'Sharing again' : 'Stopped sharing'); }); }
    if (a === 'gadd') { readForm(); return act('guest/create', { name: DR.gname }, async () => { DR.gname = ''; await fetchInto('guests', 'guest/list'); load(); }); }
    if (a === 'gcopy') { const G = CACHE['g:' + c.id]; copy(G.guest.link).then((ok) => toast(ok ? 'Copied' : 'Press and hold the link to copy')); return; }
    if (a === 'gshare') { const G = CACHE['g:' + c.id], t = 'Your results are waiting on Oddable. Open this to claim them: ' + G.guest.link; if (navigator.share) navigator.share({ title: 'Oddable', text: t }).catch(() => {}); else location.href = 'sms:?&body=' + encodeURIComponent(t); return; }
    if (a === 'grm') { if (!confirm('Remove this result from the guest?')) return; return act('guest/remove-item', { gid: c.id, id: b.dataset.id }, async () => { await fetchInto('g:' + c.id, 'guest/get', { gid: c.id }); }); }
  }
  function input(ev) {
    const t = ev.target; if (!t.id) return;
    if (/^sf_st\d+$/.test(t.id)) { const sum = [...el().querySelectorAll('input[id^="sf_st"]')].map((i) => Number(i.value)).filter((v) => v > 0).reduce((x, y) => x + y, 0), o = document.getElementById('sf_sum'); if (o) o.textContent = sum || '–'; }
    if (/^sc_/.test(t.id)) { DR.calc = Object.assign({}, DR.calc, { [t.id.slice(3)]: t.value }); const H = ME.golfHcp, d = DR.calc, idx = d.idx != null && d.idx !== '' ? Number(d.idx) : H.index, cr = Number(d.cr), sl = Number(d.slope), par = Number(d.par), o = document.getElementById('sc_out');
      if (o) o.textContent = Number.isFinite(idx) && cr >= 50 && cr <= 85 && sl >= 55 && sl <= 155 && par >= 54 && par <= 80 ? Math.round(idx * (sl / 113) + (cr - par) + 1e-9) : '–'; }
    if (t.id === 'sd_dupr') DR.dupr = t.value; if (t.id === 'sg_name') DR.gname = t.value; if (/^sv_(cr|slope|par)$/.test(t.id)) DR['v' + t.id.slice(3)] = t.value;
  }
  function change(ev) { const t = ev.target; if (t.id === 'sf_format') { readForm(); paint(); } if (t.id === 'sv_via') { const c = cur(); c.via = t.value; enter(c); paint(); } if (t.id === 'sf_guest') readForm(); }
  function toast(t) { const d = document.createElement('div'); d.className = 'stoast'; d.setAttribute('role', 'status'); d.textContent = t; (el() || document.body).appendChild(d); setTimeout(() => d.remove(), 1800); }

  // ---------- styles (own palette, scoped to the overlays; same look as Groups) ----------
  function css() {
    if (document.getElementById('ostcss')) return; const st = document.createElement('style'); st.id = 'ostcss'; const R = '#ostat';
    // Owner, Nov 16 2026: "Render the Oddable look to these plays." Colours come from the app's own theme variables (pics/index.html :root, body.dark, html.cb):
    // no palette of our own. Accent buttons = the app's .pill (violet) / html.cb .pill (#003594 + silver border); big cards = the header gradient; ratings = the gold
    // Oddable Alert card (.botd); result rows = the app's .res / .res.hit / .res.miss and .b pills; chips = .nchips.
    st.textContent = R + '{--sbg:var(--bg);--sp:var(--panel);--sp2:var(--panel2);--sl:var(--line);--si:var(--ink);--sm:var(--muted);--sv:var(--blue);--svt:#fff;--sv2:var(--blue);--sg:var(--green);--sr:var(--red);--sy:#d4a017;--shero:linear-gradient(135deg,#7c3aed 0%,#4c1d95 55%,#1b1f29 100%);position:fixed;inset:0;z-index:95;background:var(--sbg);color:var(--si);overflow:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
      + 'html.cb ' + R + ',html.cb #ovoice,html.cb #ostcons{--sv:#003594;--sv2:#c6cbd7;--shero:linear-gradient(135deg,#003594 0%,#002b5c 38%,#041e42 74%,#08111f 100%)}' + R + ' *{box-sizing:border-box}' + R + ' .sin0{max-width:560px;margin:0 auto;padding:0 16px calc(56px + env(safe-area-inset-bottom))}' + R + '.sbusy .spri{opacity:.6}'
      + R + ' h1{font-size:28px;line-height:1.15;margin:8px 0 6px;overflow-wrap:anywhere;display:flex;align-items:center;gap:6px;flex-wrap:wrap}' + R + ' h1.sh1w{font-size:23px}' + R + ' .ssub{color:var(--sm);margin:0 0 12px}'
      + R + ' .stop{position:sticky;top:0;z-index:3;background:var(--sbg);display:flex;justify-content:space-between;align-items:center;padding:max(8px,env(safe-area-inset-top)) 0 6px}'
      + R + ' button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}' + R + ' .sback,' + R + ' .sx,' + R + ' .slink{background:none;border:0;color:var(--sv2);font-weight:600;min-height:44px;padding:0 4px;text-align:left}' + R + ' .sx{color:var(--sm)}' + R + ' .slink{display:block;width:100%}'
      + R + ' .spri,' + R + ' .ssec,' + R + ' .sdanger{min-height:48px;border-radius:14px;font-weight:700;font-size:16px;padding:10px 12px;display:flex;align-items:center;justify-content:center;text-align:center}' + R + ' .spri{background:var(--sv);border:1px solid var(--sv2);color:#fff;border-radius:999px}' + R + ' .ssec,' + R + ' .sdanger{border-radius:999px}' + R + ' .ssec{background:var(--sp2);border:1px solid var(--sl)}' + R + ' .sdanger{background:none;border:1px solid var(--red);color:var(--red)}' + R + ' .sfull{width:100%;margin:12px 0}'
      + R + ' .s2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}' + R + ' .s3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0 4px}' + R + ' .s3i{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}' + R + ' .s2i{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:end}'
      + R + ' .sh{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--sm);margin:22px 0 10px}' + R + ' .sh small{text-transform:none;letter-spacing:0;font-weight:400}'
      + R + ' .scard{background:var(--sp);color:var(--si);border:1px solid var(--sl);border-radius:14px;padding:12px 14px;margin:8px 0;display:block;width:100%;text-align:left}' + R + ' .smut{color:var(--sm)}'
      + R + ' .srowc{display:flex;align-items:center;gap:12px;min-height:64px}' + R + ' .sic{font-size:24px;flex:0 0 auto}' + R + ' .srw{flex:1;min-width:0}' + R + ' .srw b{display:block;overflow-wrap:anywhere}' + R + ' .srw small{display:block;color:var(--sm);font-size:13px;overflow-wrap:anywhere}' + R + ' .sr{text-align:right;justify-self:end;display:flex;flex-direction:column;align-items:flex-end;gap:2px}' + R + ' .sr i{font-style:normal;color:var(--sm);font-size:20px}' + R + ' .sr small{color:var(--sm);font-size:12px}'
      + R + ' .sbig{text-align:left;min-height:120px;border:2px solid #f5c542;border-radius:16px;background:linear-gradient(135deg,rgba(245,197,66,.22),rgba(255,226,140,.08));box-shadow:0 0 18px rgba(245,197,66,.35)}' + R + ' .sbig small{display:block;font:800 12px system-ui;letter-spacing:.08em;text-transform:uppercase;color:#d4a017}' + R + ' .sbig b{display:block;font-size:34px;line-height:1.15}' + R + ' .sbig i{display:block;font-style:normal;color:var(--sm);font-size:12.5px}' + R + ' .sbig em{display:block;font-style:normal;color:#d4a017;font-size:12.5px;font-weight:700;margin-top:4px}'
      + R + ' .sbigc{background:var(--shero);color:#fff;border:2px solid #f5c542;box-shadow:0 0 18px rgba(245,197,66,.3);border-radius:26px;padding:16px;text-align:center;margin:10px 0}' + R + ' .sbigc small{display:block;color:#f5c542;font:800 12px system-ui;letter-spacing:.08em;text-transform:uppercase}' + R + ' .sbigc b{display:block;font-size:64px;line-height:1.1;letter-spacing:-.02em}' + R + ' .sbigc i{display:block;font-style:normal;color:#dfe5ee}' + R + ' .sbigc em{display:block;font-style:normal;color:#f5c542;font-size:13px;margin-top:6px}' + R + ' .sbigc.ssm b{font-size:44px}'
      + R + ' .stile{background:var(--sp);color:var(--si);border:1px solid var(--sl);border-radius:14px;padding:10px 12px;text-align:left;min-height:64px;display:block;width:100%;min-width:0}' + R + ' .stile:disabled{cursor:default;opacity:1}' + R + ' .stile small{display:block;color:var(--sm);font-size:13px}' + R + ' .stile b{display:block;font-size:20px;line-height:1.2;overflow-wrap:anywhere}' + R + ' .stile i{display:block;font-style:normal;color:var(--sm);font-size:12px;margin-top:2px;overflow-wrap:anywhere}'
      + R + ' .shead{background:var(--shero);color:#fff;margin:0 -16px 12px;padding:2px 16px 14px;border-radius:0 0 26px 26px}' + R + ' .shead h1{color:#fff}' + R + ' .shead .ssub{color:#dfe5ee}' + R + ' .shead .schips button{background:rgba(198,203,215,.10);border-color:rgba(198,203,215,.5);color:#fff;border-radius:999px}' + R + ' .shead .schips button.on{background:#fff;color:#041e42}' + R + ' .stop.shtop{background:#003594;margin:0 -16px;padding-left:16px;padding-right:16px}' + R + ' .stop.shtop .sx{color:#dfe5ee}' + 'html:not(.cb) ' + R + ' .stop.shtop{background:#7c3aed}'
      + R + ' .schips{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px;margin:8px 0}' + R + ' .schips button{min-height:44px;border-radius:12px;border:1px solid var(--sl);background:var(--sp);color:var(--si);font-weight:600;font-size:13px;padding:4px 2px}' + R + ' .schips button.on{border-color:var(--blue);background:var(--sp2)}'
      + R + ' .sseg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:8px;margin:6px 0}' + R + ' .sseg button{min-height:48px;border-radius:12px;border:1px solid var(--sl);background:var(--sp);color:var(--si);font-weight:600;padding:6px}' + R + ' .sseg button.on{border-color:var(--blue);background:var(--sp2)}'
      + R + ' .slab{display:block;color:var(--sm);font-size:14px;font-weight:600;margin:12px 0 6px}' + R + ' .slab em{font-style:normal;font-weight:400;font-size:12.5px}' + R + ' .slab .sin{margin-top:6px}' + R + ' .sin{width:100%;min-height:48px;background:var(--sbg);border:1px solid var(--sl);border-radius:12px;color:var(--si);font:600 16px system-ui;padding:10px 12px;min-width:0}' + 'html.cb ' + R + ' .sin,body.dark ' + R + ' .sin{color-scheme:dark}'
      + R + ' .shg{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}' + R + ' .shg label{display:block;text-align:center}' + R + ' .shg small{display:block;color:var(--sm);font-size:12px}' + R + ' .shg .sin{padding:8px 2px;text-align:center}'
      + R + ' .sgh,' + R + ' .sgr{display:grid;grid-template-columns:minmax(0,1fr) 90px 90px;gap:8px;align-items:center}' + R + ' .sgh{color:var(--sm);font-size:13px;font-weight:600;margin:12px 0 4px}' + R + ' .sgr{margin:6px 0}' + R + ' .sgr .sin{text-align:right}'
      + R + ' .sopt{display:block;width:100%;text-align:left;background:var(--sp);border:1px solid var(--sl);border-radius:16px;padding:12px 14px;margin:8px 0;min-height:56px}' + R + ' .sopt b{font-size:17px;display:block}' + R + ' .sopt small{color:var(--sm)}'
      + R + ' .sline2{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:52px;padding:4px 0}' + R + ' .sline2 small{display:block;color:var(--sm);font-size:13px}' + R + ' .sline2>span{min-width:0}'
      + R + ' .ssw{flex:0 0 auto;width:64px;height:44px;border:0;background:none;position:relative;padding:0}' + R + ' .ssw::before{content:"";position:absolute;left:1px;right:1px;top:4px;bottom:4px;border-radius:999px;border:1px solid var(--sl);background:var(--sp2)}' + R + ' .ssw i{position:absolute;top:9px;left:6px;width:26px;height:26px;border-radius:50%;background:#bdb5d6;transition:left .15s}' + R + ' .ssw.on::before{background:var(--sv);border-color:var(--sv2)}' + R + ' .ssw.on i{left:32px;background:#fff}'
      + R + ' .srec{display:flex;justify-content:space-between;gap:10px;color:var(--si);border:1px solid var(--sl);width:100%;text-align:left;min-height:56px;align-items:center}'
      + R + ' .srec{flex-wrap:wrap}' + R + ' .smny{flex:0 0 100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;border-top:1px solid var(--sl);padding-top:6px;margin-top:2px}' + R + ' .smny span{display:block;text-align:right;min-width:0}' + R + ' .smny small{display:block;color:var(--sm);font-size:12px}' + R + ' .smny b{font-size:14.5px}' + R + ' .stour{display:inline-block;margin-top:4px;color:#d4a017;border-color:#f5c542;font-size:12px}'
      + R + ' .spill{border-color:var(--sl)}' + R + ' .spill.sy{color:#d4a017;border-color:#f5c542}'
      + R + ' .spos{color:var(--sg)}' + R + ' .sneg{color:var(--sr)}' + R + ' .syel{color:var(--sy)}' + R + ' .snote{color:var(--sm);font-size:13.5px;margin:8px 0}' + R + ' .serr{background:#d93a2e14;border:1px solid var(--red);border-radius:10px;padding:10px 12px;margin:8px 0}' + R + ' .sok{background:#16915a14;border:1px solid var(--green);border-radius:10px;padding:10px 12px;margin:8px 0}'
      + R + ' .skv{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--sl)}' + R + ' .skv:last-child{border-bottom:0}' + R + ' .skv span{min-width:0;overflow-wrap:anywhere}' + R + ' .skv small{display:block;color:var(--sm);font-size:12.5px}' + R + ' .skv b{text-align:right}'
      + R + ' .sthead,' + R + ' .strow{display:grid;grid-template-columns:minmax(0,1fr) 72px 72px;gap:8px;align-items:center}' + R + ' .sthead{color:var(--sm);font-size:13px;font-weight:600;padding:8px 14px 2px}' + R + ' .strow{width:100%;text-align:left;background:var(--sp);color:var(--si);border:1px solid var(--sl);border-radius:10px;padding:9px 12px;margin:6px 0;min-height:56px}' + R + ' .strow:disabled{cursor:default;opacity:1}' + R + ' .strow.cnt{border:2px solid #f5c542;background:linear-gradient(135deg,rgba(245,197,66,.18),rgba(255,226,140,.05))}'
      + R + ' .shole{background:var(--sp);border:1px solid var(--sl);border-radius:14px;padding:6px 8px;margin:8px 0}' + R + ' .shr{display:grid;grid-template-columns:48px repeat(9,minmax(0,1fr));gap:2px;text-align:center;font-size:14px;padding:3px 0}' + R + ' .shr span:first-child{text-align:left;color:var(--sm);font-size:12px}' + R + ' .shr.shh{color:var(--sm);font-size:12px;border-bottom:1px solid var(--sl)}' + R + ' .shr.shu{font-weight:700;border-top:1px solid var(--sl)}' + R + ' .scut{color:var(--sy);font-weight:700}'
      + R + ' .schart{width:100%;height:auto;display:block;background:var(--sp);border:1px solid var(--sl);border-radius:14px}' + R + ' .sgrid{stroke:var(--line);stroke-width:1}' + R + ' .saxis{fill:var(--muted);font:10px system-ui}' + R + ' .sline{stroke:#f5c542;stroke-width:2.5}' + R + ' .sdot{fill:var(--ink)}' + R + ' .schart rect{cursor:pointer}'
      + R + ' .sinfo{background:none;border:1px solid var(--sl);border-radius:999px;min-width:44px;min-height:44px;color:var(--sv2);font-size:18px}' + R + ' .sinfoov{position:fixed;inset:0;z-index:5;background:rgba(5,8,16,.8);display:flex;align-items:center;justify-content:center;padding:16px}' + R + ' .sinfobox{background:var(--sp);border:1px solid var(--sl);border-radius:18px;padding:16px;max-width:480px;max-height:85vh;overflow:auto}' + R + ' .sinfobox p{color:var(--si);font-size:14.5px}'
      + R + ' .scopy{background:var(--sp2);border:1px dashed var(--sl);border-radius:12px;padding:10px;font:600 14px ui-monospace,monospace;overflow-wrap:anywhere;user-select:all;margin:8px 0}' + R + ' .stiny{background:none;border:1px solid var(--sl);border-radius:10px;color:var(--sm);min-height:44px;min-width:44px}' + R + ' .sdupr{margin-bottom:0}'
      + R + ' .smore{margin:12px 0}' + R + ' .smore summary{min-height:44px;display:flex;align-items:center;color:var(--sv2);font-weight:600;cursor:pointer}'
      + R + ' .stoast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--green);color:#fff;border-radius:999px;padding:10px 18px;font-weight:700;z-index:6}'
      + '#ostcons{--sv:var(--blue);--sv2:var(--blue);position:fixed;inset:0;z-index:118;background:rgba(5,8,16,.82);display:flex;align-items:center;justify-content:center;padding:16px;font:15px/1.4 system-ui,-apple-system,sans-serif}#ostcons .obox{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:22px;padding:18px;max-width:380px;width:100%}#ostcons .r{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:12px 0}#ostcons small{color:var(--muted);display:block}#ostcons .r>span{min-width:0;flex:1}#ostcons button{font:inherit;cursor:pointer}#ostcons .ok{width:100%;min-height:48px;border-radius:999px;border:1px solid var(--sv2);background:var(--sv);color:#fff;font-weight:700;font-size:16px}#ostcons .ssw{flex:0 0 auto;width:64px;height:44px;border:0;background:none;position:relative;padding:0}#ostcons .ssw::before{content:"";position:absolute;left:1px;right:1px;top:4px;bottom:4px;border-radius:999px;border:1px solid var(--line);background:var(--panel2)}#ostcons .ssw i{position:absolute;top:9px;left:6px;width:26px;height:26px;border-radius:50%;background:#bdb5d6;transition:left .15s}#ostcons .ssw.on::before{background:var(--sv);border-color:var(--sv2)}#ostcons .ssw.on i{left:32px;background:#fff}'
      + '@media (max-width:360px){' + R + ' .s3{grid-template-columns:1fr 1fr}' + R + ' .sthead,' + R + ' .strow{grid-template-columns:minmax(0,1fr) 64px 64px}' + R + ' .sgh,' + R + ' .sgr{grid-template-columns:minmax(0,1fr) 76px 76px}}';
    document.head.appendChild(st);
  }

  // ---------- open / public hooks ----------
  window.oddStats = function (start) {
    css(); let e = el(); if (e) e.remove(); e = document.createElement('div'); e.id = 'ostat'; e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', 'My stats');
    e.innerHTML = '<div class="sin0"></div>'; document.body.appendChild(e); try { sessionStorage.setItem('ostat-open', '1'); } catch (x) {}
    stack = [{ t: 'home' }]; err = ''; INFO = null; e.addEventListener('click', click); e.addEventListener('input', input); e.addEventListener('change', change);
    paint(); load().then(() => { if (start) go(start); });
  };
  // Consent question for a golf course's league / event (the golf engine calls this when a player joins; default ON for that join). Resolves true/false, or null when
  // the course has no enterprise account (nothing to ask). Saves the answer through /stats/consent/set.
  async function askCourseConsent(course, via) {
    const cid = course && (course.id || course.courseId); if (!cid) return null; let q; try { q = await post('consent/get', { courseId: cid }); } catch (e) { return null; } if (!q.ask) return null;
    css(); return new Promise((done) => { const o = document.createElement('div'); o.id = 'ostcons'; let on = true;
      o.innerHTML = '<div class="obox" role="dialog" aria-label="Share with the course"><b style="font-size:18px">' + esc(q.text) + '</b><div class="r"><span><b>Share my handicap and rounds</b><small>Only ' + esc(q.course.name) + ' sees them. Never your bets. Turn it off any time in My stats › Sharing.</small></span><button class="ssw on" role="switch" aria-checked="true" id="ostcsw"><i></i></button></div><button class="ok" id="ostcok">Continue</button></div>';
      document.body.appendChild(o); const s2 = o.querySelector('#ostcsw'); s2.onclick = () => { on = !on; s2.classList.toggle('on', on); s2.setAttribute('aria-checked', on ? 'true' : 'false'); };
      o.querySelector('#ostcok').onclick = async () => { try { await post('consent/set', { courseId: cid, on, via: via || null }); } catch (e) {} o.remove(); done(on); }; });
  }
  // Claim link (?join=claim.<code>): the shared join router hands the code over once the person is signed in.
  async function claim(code) {
    css(); const o = document.createElement('div'); o.id = 'ostcons'; o.innerHTML = '<div class="obox" role="dialog" aria-label="Claim results"><b style="font-size:18px">Claiming your results…</b><p id="ostcm"></p><button class="ok" id="ostcok">OK</button></div>'; document.body.appendChild(o);
    const m = o.querySelector('#ostcm'); o.querySelector('#ostcok').onclick = () => { o.remove(); if (ok) window.oddStats(); }; let ok = false;
    try { const j = await post('guest/claim', { code }); ok = true; o.querySelector('b').textContent = 'Results claimed'; m.textContent = j.n + ' result' + (j.n === 1 ? '' : 's') + ' kept for ' + j.name + ' are now in your lifetime stats.'; } catch (e) { o.querySelector('b').textContent = 'Could not claim'; m.textContent = errText(e); }
  }
  window.OddStats = { open: (s) => window.oddStats(s), askCourseConsent, claim, reload: () => (el() ? load() : null) };
  if (window.OddJoin && typeof window.OddJoin.register === 'function') window.OddJoin.register('claim', claim);
  else { // no shared join router in this build: read ?join=claim.<code> ourselves (kept in sessionStorage across sign-up)
    try { const u = new URL(location.href), v = u.searchParams.get('join'); if (v && /^claim\.[a-z0-9]{12}-[a-z0-9]{20,40}$/.test(v)) { sessionStorage.setItem('ostat-claim', v.slice(6)); u.searchParams.delete('join'); history.replaceState(history.state, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams : '') + u.hash); } } catch (e) {}
    const tryClaim = () => { let c = null; try { c = sessionStorage.getItem('ostat-claim'); } catch (e) {} if (c && g('odd-tok')) { try { sessionStorage.removeItem('ostat-claim'); } catch (e) {} claim(c); return true; } return false; };
    if (!tryClaim()) { let n = 0; const t = setInterval(() => { if (tryClaim() || ++n > 120) clearInterval(t); }, 2500); }
  }
  // Voice target 'self' (My stats). Golf rounds / matches without the details a save needs open the form pre-filled instead of saving.
  function voiceSelf() {
    if (!window.VoiceLog || typeof window.VoiceLog.registerTarget !== 'function' || window.__ostatVoice) return; window.__ostatVoice = 1;
    window.VoiceLog.registerTarget('self', { describe: 'Anything you played: a golf round, a pickleball match, or any other game (win, loss, tie or a one-player score).', save: async (ctx, p) => {
      const open = (type, d, why) => { DR = Object.assign({ voice: true }, d); if (!el()) window.oddStats({ t: 'log', type }); else go({ t: 'log', type }); msg = why; paint(); return { ok: true, opened: true, note: why }; };
      if (p.target === 'golf-round') { const d = { date: p.date || ctx.today, course: p.course || '', total: p.total, holes: p.holes }; if (!p.course || p.total == null) return open('golf', d, 'Check the round, add the course (and Rating / Slope for your handicap), then Save.'); const j = await post('self/save', { item: { type: 'golf', date: d.date, course: d.course, total: d.total, holes: d.holes, voice: true } }); if (el()) load(); return { ok: true, record: j.record }; }
      if (p.target === 'match') { const fmt = p.fmt || (p.opponents.length === 2 ? 'doubles' : 'singles'), d = { fmt, partner: p.partner || '', opp0: p.opponents[0] || '', opp1: p.opponents[1] || '', games: p.games.map((x) => [String(x[0]), String(x[1])]) }; if (!p.opponents.length || (fmt === 'doubles' && !p.partner)) return open('pickleball', d, 'Add who you played' + (fmt === 'doubles' ? ' and your partner' : '') + ', then Save.');
        const j = await post('self/save', { item: { type: 'pickleball', date: ctx.today, fmt, partner: p.partner, opp: p.opponents, games: p.games, voice: true } }); if (el()) load(); return { ok: true, record: j.record }; }
      const j = await post('self/save', { item: { type: 'other', date: ctx.today, sport: p.sport, result: p.result, opponent: p.opponent, score: p.score, notes: p.notes, voice: true } }); if (el()) load(); return { ok: true, record: j.record };
    } });
  }
  voiceSelf(); window.addEventListener('voicelog-ready', voiceSelf);
  try { if (sessionStorage.getItem('ostat-open') === '1') setTimeout(() => { if (!el() && g('odd-tok')) window.oddStats(); }, 1500); } catch (e) {}
})();
