// Oddable LOCAL EVENTS (v1, Nov 16 2026). Full-screen overlay #oevt (same pattern as groups.js / dash.js), z-index 97 (above Groups 95, the sport catalog 96
// and the My Bets banner 40). Every rule, score, standing and money figure comes from the server (odds-api/events.js); this file only shows them.
// Money is information only: Oddable never collects, holds or pays money. Opened from Groups ("My events"), the sport catalog, or a shared link ?join=e.<code>.
(function () {
  const API = (window.ODD_GROUPS_API || location.origin + '') + '/events/';
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const att = (x) => esc(String(x == null ? '' : x).replace(/[^\w.-]/g, ''));
  const usd = (n) => { const v = Math.round((Number(n) || 0) * 100) / 100, a = Math.abs(v); return (v < 0 ? '-' : '') + '$' + (Number.isInteger(a) ? a.toLocaleString() : a.toFixed(2)); };
  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const fmtTime = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtDay = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const SPORTN = { pickleball: 'Pickleball', tennis: 'Tennis', basketball: 'Basketball', golf: 'Golf', cornhole: 'Cornhole', darts: 'Darts', bowling: 'Bowling', pool: 'Pool (billiards)', other: 'Other game' };
  const FMTN = { rr: 'Round robin', se: 'Single elimination', de: 'Double elimination', ladder: 'Ladder', h2h: 'Heads-up challenges', solo: 'Solo / skills score' };
  const UNITN = { singles: 'Singles', doubles: 'Doubles', mixed: 'Mixed doubles', teams: 'Teams (up to 4)' };
  const SEEDN = { rating: 'By rating (typed in, e.g. DUPR)', oddable: 'By Oddable rating (unofficial; typed rating if none)', random: 'Random draw', manual: 'As I list them' };
  // H1 (owner Nov 16 2026): in pickleball the Oddable rating from app play IS the rating, so there is one "by rating" choice and it means that
  const seedOpts = (sport) => (sport === 'pickleball' ? [['rating', 'By Oddable rating (from app play)'], ['random', 'Random draw'], ['manual', 'As I list them']] : Object.keys(SEEDN).map((k) => [k, SEEDN[k]]));
  const seedName = (e) => (e.sport === 'pickleball' && (e.rules.seeding === 'rating' || e.rules.seeding === 'oddable') ? 'By Oddable rating (from app play); a player with no games yet counts as 1500' : SEEDN[e.rules.seeding]);
  const ODDNOTE = 'Oddable rating: built from the games you play in the app (Elo method, new players start at 1500). Unofficial: not a DUPR or tournament rating.';
  // E-H + addendum (owner Nov 16 2026): a director's tournament rating never hides the real-results Oddable rating
  const rateLine = (p) => (p.odd ? 'Oddable ' + p.odd.rating + ' (real results' + (p.odd.matches ? ', ' + p.odd.matches + ' game' + (p.odd.matches > 1 ? 's' : '') : '') + ')' : 'Oddable: no games yet') + (p.trn ? ' · Tournament ' + p.trn.v + ', set by director' : '');
  const PMODES = [['balanced', 'Balanced', 'Team ratings as close as possible, so matches are fair.'], ['rotate', 'Rotate', 'Partners who have not played together lately.'], ['hot', 'Hot pairs', 'The best records together, from lifetime results.']];
  const SPLITN = { '100': 'Winner takes all', '60/30/10': '60 / 30 / 10', '50/30/20': '50 / 30 / 20', '70/30': '70 / 30', none: 'No prizes' };
  const MONEY = 'Money is settled outside the app. The commissioner collects entries and pays winners; Oddable only shows who is owed what. Oddable never collects, holds or pays money.';
  const CAPLINE = 'Up to 8 people per game. Clubs, courses and leagues: contact Oddable for a license.';
  const ENTTEXT = 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.'; // same text as the server (limits.ENTERPRISE_TEXT); the server copy wins (e.entText)
  // Plain-language explanations (also used by the sport catalog through window.OddEvents.INFO)
  const INFO = {
    rr: 'Everyone plays everyone once. Odd numbers get a bye each round (one sits out, each entry once). Matches fill the courts round by round. Standings follow the pickleball rulebook: most wins, then head-to-head among the tied, point differential, head-to-head point differential, then point differential against the next-highest entry. Still level: the organizer picks a tiebreak playoff or a coin flip (logged); the seed never breaks a tie. Optional playoff: the top 2, 4, 8 or 16 go to a single-elimination bracket.',
    se: 'Lose once and you are out. Seeds come from the Oddable rating (built from games played in the app; unofficial), a random draw, or your own order; top seeds get byes when the count is not a power of two. Winners move on until one is left.',
    de: 'You are out after two losses. A first loss drops you to the losers bracket. Its winner meets the winners-bracket champion in the final; if the losers-bracket side wins that, a second final is played (bracket reset) because both now have one loss.',
    ladder: 'Everyone starts on a ranked ladder. Challenge anyone up to N spots above you; a challenge must be played within the set days. Win and you take the higher spot (swap places, or move in and push the rest down one). A challenge not played in time is a forfeit win for the challenger, or is cancelled, as the commissioner set.',
    h2h: 'Pair against pair or player against player, best of 1, 3 or 5 games. Challenge someone, they accept, you play, the scorer enters it and the other side confirms. Records and point differential build up over the event.',
    pickem: "Spectators (and players) pick the winner of every match before its round starts. Every pick is saved and locked the moment you make it. A round closes for picking at the lock time the commissioner set, when the commissioner locks it, or the moment its first match starts or gets a score, whichever comes first. Most correct picks wins; the tiebreak is the closest guess of the final's total points.",
    solo: 'A drill or skills game with a number: serves in, free throws made, a putting contest, a bowling series. Each player enters their own score (the commissioner can enter it for anyone). Highest wins, or lowest if the commissioner said so. Works with one player for practice.',
    scoring: 'Scores are typed in by the match’s designated scorer, and the other side confirms them. A disputed score goes to the commissioner, who decides. Every entry, confirmation, dispute and correction is in the event history.',
    invite: 'Every game has its own invite link. Anyone who opens it signs up for Oddable if they are new, then lands on this game to join.',
  };
  let stack = [{ t: 'home' }], H = null, busy = false, err = '', DR = null, POLL = null;
  const tok = () => ls('odd-tok') || '';

  // ---------- server ----------
  async function post(op, b) {
    const r = await fetch(API + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': tok() }, body: JSON.stringify(Object.assign({ myName: ls('odd-name') || '' }, b || {})) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server said ' + r.status), { status: r.status }); return j;
  }
  const netErr = (e) => e && /Failed to fetch|NetworkError|Load failed/i.test(e.message);
  const errText = (e) => (netErr(e) ? 'Could not reach the server. It may be waking up: try again in a few seconds.' : e && e.status === 401 ? 'Sign in to run or join an event.' : (e && e.message) || 'Something went wrong');
  async function act(op, b, then) { if (busy) return; busy = true; err = ''; paintBusy(true); try { const j = await post(op, b); busy = false; await then(j); } catch (e) { busy = false; err = errText(e); paint(); } paintBusy(false); }
  // Offline queue for score entries: kept on the phone, resent with the same op id (the server ignores a repeat), shown as "waiting to send".
  const Q = () => { try { return JSON.parse(ls('oevt-q') || '[]'); } catch (e) { return []; } };
  const Qset = (q) => ls('oevt-q', q.length ? JSON.stringify(q.slice(-50)) : null);
  async function flush() { const q = Q(); if (!q.length || !navigator.onLine) return; const keep = []; let sent = 0; for (const it of q) { if (it.fail) { keep.push(it); continue; } try { await post('score', it.b); sent++; } catch (e) { if (netErr(e)) keep.push(it); else keep.push(Object.assign(it, { fail: 'A saved score was not accepted: ' + errText(e) })); } } Qset(keep); const s = cur(); if (sent && s && s.id) load(s, true); else if (keep.some((x) => x.fail)) paint(); }
  window.addEventListener('online', flush);

  // ---------- small parts ----------
  const top = (back) => '<div class="etop">' + (back ? '<button class="eback" data-a="back">‹ ' + esc(back) + '</button>' : '<span></span>') + '<button class="ex" data-a="close" aria-label="Close events">Close</button></div>';
  const tile = (lab, val, a, sub, cls) => '<button class="etile" ' + a + '><small>' + esc(lab) + ' ›</small><b class="' + (cls || '') + '">' + val + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</button>';
  const sel = (id, opts, cur) => '<select id="' + id + '" class="esel">' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
  const sw = (on, a) => '<button class="esw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" ' + a + '><i></i></button>';
  const seg = (opts, cur, a) => '<div class="eseg">' + opts.map(([v, l]) => '<button class="' + (v === cur ? 'on' : '') + '" ' + a + '="' + att(v) + '">' + esc(l) + '</button>').join('') + '</div>';
  const fmtLine = (e) => esc(FMTN[e.fmt] + (e.rules.pickem ? " + pick'em" : '') + ' · ' + SPORTN[e.sport] + (e.fmt !== 'solo' ? ' · ' + UNITN[e.rules.unit].replace(/ \(.*/, '') : ''));
  const gameRule = (r, sport) => (r.tset ? 'Sets to ' + r.to + ', win by 2, tiebreak at ' + r.to + '-' + r.to + ' (' + (r.to + 1) + '-' + r.to + ')' : r.to && r.winBy === 1 ? 'Games to ' + r.to + ' (going over is fine)' : r.to ? 'Games to ' + r.to + ', win by ' + r.winBy : 'Highest score wins each game') + (r.bestOf > 1 ? ', best of ' + r.bestOf : '') + (sport === 'pickleball' ? ' · ' + (r.scoring === 'sideout' ? 'side-out' : 'rally') + ' scoring (label only)' : '');
  const scoreTxt = (m, games) => (games || m.games || []).map(([x, y]) => x + '-' + y).join(', ');
  const stateTxt = { wait: 'Waiting for earlier results', ready: 'To play', pending: 'Waiting for confirmation', confirmed: 'Final', disputed: 'Disputed: commissioner decides', bye: 'Bye', void: 'Not played', offered: 'Challenge waiting for an answer' };
  function rulesList(e) {
    const r = e.rules, rows = [['Format', FMTN[e.fmt] + (e.rules.pickem ? " with bracket pick'em for spectators" : '')], ['Sport', SPORTN[e.sport] + (e.fmt !== 'solo' ? ' · ' + UNITN[r.unit] : '')], ['Starts', fmtTime(e.start) + ' (rules lock then)']];
    if (e.endDay) rows.push(['Last day', fmtDay(e.endDay)]);
    if (e.fmt !== 'solo') rows.push(['Games', gameRule(r, e.sport)], ['Seeding', seedName(e)], ['Courts', String(r.courts)], ['Who enters scores', r.scorer === 'comm' ? 'The commissioner' : r.scorer === 'either' ? 'Either side, the other confirms' : 'The first-listed side, the other confirms']);
    else rows.push(['Scores', (r.low ? 'Lowest' : 'Highest') + ' ' + r.unitLabel + ' wins']);
    if (e.fmt === 'rr') rows.push(['Pools', String(r.pools)], ['Playoff', r.playoff ? 'Top ' + r.playoff + ', single elimination' : 'None'], ['Tiebreaks', 'Wins, head-to-head among the tied, point differential, head-to-head differential, differential against the next entry; then a tiebreak playoff or coin flip chosen by the organizer (never the seed)']);
    if (e.fmt === 'ladder') rows.push(['Challenges', 'Up to ' + r.reach + ' spot' + (r.reach > 1 ? 's' : '') + ' above, play within ' + r.expDays + ' days, else ' + (r.expire === 'void' ? 'cancelled' : 'challenger wins by forfeit')], ['Winner moves', r.move === 'swap' ? 'Swap places' : 'Take the spot, the rest move down one']);
    if (r.pickem) rows.push(["Pick'em", 'Pick each match before it starts; ' + (r.weight === 'round' ? 'later rounds are worth more' : '1 point per right pick') + "; tiebreak: the final's total points"]);
    rows.push(['Entry', e.money.entry ? usd(e.money.entry) + ' per player' : 'No entry'], ['Pot', e.money.pot === 'side' ? 'Side pot' : 'Main pot'], ['Payout split', SPLITN[e.money.split]], ["Commissioner's take", e.takeText], ['Joining', (e.join.self ? 'Players can add themselves' : 'The commissioner adds the players') + (e.join.spectators ? ', spectators welcome' : '')]);
    return '<div class="erules">' + rows.map(([k, v]) => '<div><small>' + esc(k) + '</small><span>' + esc(v) + '</span></div>').join('') + '</div>';
  }

  // ---------- screens ----------
  function home() {
    let h = '<h1>My events</h1><p class="esub">Games you run yourselves: pickleball, tennis nights, cornhole, darts, bowling. Scores are entered on court.</p><div class="e2"><button class="epri" data-a="catalog">Start a game</button><button class="esec" data-a="joincode">Join with a code</button></div>';
    const q = Q(); if (q.length) h += '<div class="ewarn"><b>' + q.length + ' score' + (q.length > 1 ? 's' : '') + ' waiting to send</b>' + (q.some((x) => x.fail) ? esc(q.find((x) => x.fail).fail) + '<button class="etiny" data-a="qclear">Dismiss</button>' : 'They go out as soon as the phone is back online.') + '</div>';
    if (!H) return h + '<div class="ecard">Loading your events…</div>';
    if (!H.events.length) h += '<div class="ecard emut">No events yet. Start one, or open an invite link a friend sent.</div>';
    H.events.forEach((e) => {
      h += '<button class="ecard ebtn" data-a="open" data-id="' + att(e.id) + '"><div class="erow"><b class="ename">' + esc(e.title) + '</b>' + (e.role === 'comm' ? '<span class="ebadge">Commissioner</span>' : e.role === 'spectator' ? '<span class="ebadge">Watching</span>' : '') + '</div>';
      h += '<div class="emeta">' + fmtLine(e) + '</div><div class="emeta">' + (e.fin ? 'Final' + (e.myPlace ? ' · you finished ' + ord(e.myPlace) : '') : e.started ? 'Under way' : 'Starts ' + esc(fmtTime(e.start))) + ' · ' + e.people + ' ' + (e.people === 1 ? 'person' : 'people') + (e.money.pot === 'side' ? ' · side pot' : '') + '</div>';
      if (e.todo) h += '<div class="eyel">' + e.todo + ' match' + (e.todo > 1 ? 'es need' : ' needs') + ' you ›</div>'; h += '</button>';
    });
    return h + '<div class="enote">' + esc(CAPLINE) + ' Spectators count toward the 8.</div><div class="enote">' + esc(ENTTEXT) + '</div>';
  }
  function joinCodeV() { const s = cur(); return '<h1>Join with a code</h1><label class="elab">Invite code<input id="ecode" class="ein ecodein" autocomplete="off" autocapitalize="characters" maxlength="14" placeholder="ABCD-1234" value="' + esc(s.code || '') + '"></label><button class="epri efull" data-a="lookup">Look it up</button><label class="elab">Have a guest claim code from the commissioner?<input id="eclaim" class="ein" autocomplete="off" autocapitalize="characters" maxlength="24" placeholder="ABCD-1234.XXXXXXXXXX"></label><button class="esec efull" data-a="claim">Claim my results</button><div class="enote">A claim code moves the results the commissioner typed in under your name into your account (lifetime stats).</div>'; }
  function previewV() {
    const s = cur(), e = s.ev;
    if (!e && s.peek) return '<h1>' + esc(s.peek.title) + '</h1><div class="emeta">' + esc(s.peek.kind) + '</div><div class="ecard">You were invited to this game. Sign up for Oddable (or sign in), then open the invite link again to join.</div>';
    if (!e) return '<div class="ecard">Loading…</div>';
    if (e.role && e.role !== 'none') return '<h1>' + esc(e.title) + '</h1><button class="epri efull" data-a="open" data-id="' + att(e.id) + '">You are in this event. Open it ›</button>';
    let h = '<h1>' + esc(e.title) + '</h1><div class="emeta">' + fmtLine(e) + ' · run by ' + esc(e.commName) + '</div><div class="ecard">' + rulesList(e) + '</div>';
    h += '<div class="enote">' + e.people + ' of ' + e.cap + ' people so far. ' + esc(MONEY) + '</div>';
    const open = (e.open || []).filter((x) => x.open > 0);
    if (!e.locked) {
      h += '<h3 class="eh">Join as a player</h3>';
      if (!e.join.self) h += '<div class="enote">The commissioner adds the players in this event. If you were added by name, ask the commissioner for your claim code and enter it under Join with a code.</div>';
      open.forEach((x) => x.seats.forEach((st) => { h += '<button class="esec efull" data-a="dojoin" data-eid="' + att(x.eid) + '" data-gid="' + att(st.gid) + '">Take the open partner spot: ' + esc(x.name) + '</button>'; }));
      if (e.join.self) h += '<div class="enote">Added by name by the commissioner? Use your claim code (Join with a code) to take your spot.</div>';
      if (e.join.self) h += '<label class="elab">' + (e.rules.unit === 'singles' ? 'Or join as a new player' : 'Or enter a new ' + (e.rules.unit === 'teams' ? 'team' : 'pair') + ' (your partner joins with the same link)') + '<input id="enewname" class="ein" maxlength="40" placeholder="' + (e.rules.unit === 'singles' ? 'Your name' : 'Team name') + '"></label><label class="elab">Your rating (optional, e.g. DUPR 4.25)<input id="enewrt" class="ein" type="number" inputmode="decimal" step="0.01" min="0"></label><button class="epri efull" data-a="dojoin">Join as a player</button>';
    } else h += '<div class="ewarn"><b>Entries are closed</b>The event has started.</div>';
    if (e.join.spectators) h += '<button class="esec efull" data-a="dojoin" data-as="spectator">' + (e.rules.pickem ? "Join to watch and play pick'em" : 'Join to watch') + '</button>';
    return h;
  }
  // ---- create ----
  function draftNew(o) {
    const sport = (o && o.sport) || 'pickleball', fmt = (o && o.fmt) || 'rr', d = new Date(Date.now() + 2 * 864e5); d.setHours(9, 0, 0, 0);
    const local = (t) => { const z = new Date(t - new Date(t).getTimezoneOffset() * 6e4); return z.toISOString().slice(0, 16); };
    return { title: '', sport, fmt, unit: sport === 'pickleball' || sport === 'tennis' ? 'doubles' : sport === 'basketball' ? 'teams' : 'singles', to: sport === 'pickleball' ? 11 : sport === 'tennis' ? 6 : sport === 'cornhole' ? 21 : 0, winBy: sport === 'pickleball' || sport === 'tennis' ? 2 : 1, bestOf: 1, scoring: 'rally', seeding: 'rating', courts: 2, pools: 1, playoff: fmt === 'rr' ? 4 : 0, reach: 3, expDays: 7, expire: 'forfeit', move: 'swap', endDay: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), pickem: !!(o && o.pickem), weight: 'flat', side: false, scorer: 'a', startLocal: fmt === 'solo' ? local(Date.now()) : local(d.getTime()), entries: '', playIn: true, myRating: '', entry: 0, pot: 'main', split: 'none', takeKind: 'none', takeV: 0, self: true, spectators: true, low: !!(o && o.low), unitLabel: (o && o.unitLabel) || 'points' };
  }
  function createV() {
    const d = DR, P = d.sport === 'pickleball';
    let h = '<h1>New ' + esc(SPORTN[d.sport].toLowerCase()) + ' event</h1><label class="elab">Event name<input id="ft" class="ein" maxlength="40" placeholder="Saturday Smash" value="' + esc(d.title) + '"></label>';
    h += '<div class="e2"><label class="elab">Sport' + sel('fsp', Object.keys(SPORTN).map((k) => [k, SPORTN[k]]), d.sport) + '</label><label class="elab">Format' + sel('ffm', Object.keys(FMTN).map((k) => [k, FMTN[k]]), d.fmt) + '</label></div>';
    h += '<button class="einfo" data-a="info" data-k="' + att(d.fmt) + '">ⓘ How ' + esc(FMTN[d.fmt].toLowerCase()) + ' works</button>';
    h += '<label class="elab">Starts (rules lock then)<input id="fst" class="ein" type="datetime-local" value="' + esc(d.startLocal) + '"></label>';
    if (['ladder', 'h2h', 'solo'].includes(d.fmt)) h += '<label class="elab">Last day<input id="fend" class="ein" type="date" value="' + esc(d.endDay) + '"></label>';
    if (d.fmt === 'solo') h += '<div class="ecard"><h2>Score</h2><label class="elab">What is counted<input id="fun" class="ein" maxlength="16" value="' + esc(d.unitLabel) + '"></label><div class="eline"><span>Lowest score wins<small>Off = highest wins</small></span>' + sw(d.low, 'data-tg="low"') + '</div></div>';
    else {
      h += '<div class="ecard"><h2>Matches</h2><div class="e2"><label class="elab">Play' + sel('fun2', Object.keys(UNITN).map((k) => [k, UNITN[k]]), d.unit) + '</label><label class="elab">Best of' + sel('fbo', [[1, '1 game'], [3, '3 games'], [5, '5 games']], d.bestOf) + '</label></div>';
      h += '<div class="e2"><label class="elab">Games to' + (P ? sel('fto', [[11, '11'], [15, '15'], [21, '21']], d.to) : '<input id="fto" class="ein" type="number" inputmode="numeric" min="0" max="999" value="' + esc(d.to) + '">') + '</label><label class="elab">Win by' + (P ? '<div class="ein efix">2 (pickleball)</div>' : sel('fwb', [[1, '1'], [2, '2']], d.winBy)) + '</label></div>';
      if (!P) h += '<div class="enote">Games to 0 = highest score wins (bowling, darts totals).</div>';
      if (P) h += '<label class="elab">Scoring (a label for the players)' + sel('fsc', [['rally', 'Rally scoring'], ['sideout', 'Side-out scoring']], d.scoring) + '</label>';
      h += '<div class="e2"><label class="elab">Seeding' + sel('fsd', seedOpts(d.sport), P && d.seeding === 'oddable' ? 'rating' : d.seeding) + '</label><label class="elab">Courts' + sel('fco', Array.from({ length: 12 }, (_, i) => [i + 1, String(i + 1)]), d.courts) + '</label></div>';
      if (d.fmt === 'rr') h += '<div class="e2"><label class="elab">Pools' + sel('fpo', [[1, 'One pool'], [2, '2 pools'], [3, '3 pools'], [4, '4 pools']], d.pools) + '</label><label class="elab">Playoff' + sel('fpl', [[0, 'None'], [2, 'Top 2'], [4, 'Top 4'], [8, 'Top 8']], d.playoff) + '</label></div>';
      if (d.fmt === 'ladder') h += '<div class="e2"><label class="elab">Challenge up to' + sel('fre', [1, 2, 3, 4, 5].map((n) => [n, n + ' spot' + (n > 1 ? 's' : '') + ' above']), d.reach) + '</label><label class="elab">Play within' + sel('fex', [2, 3, 5, 7, 10, 14].map((n) => [n, n + ' days']), d.expDays) + '</label></div><div class="e2"><label class="elab">Not played in time' + sel('fexp', [['forfeit', 'Challenger wins'], ['void', 'Cancelled']], d.expire) + '</label><label class="elab">Winner moves' + sel('fmv', [['swap', 'Swap places'], ['shift', 'Take the spot']], d.move) + '</label></div>';
      h += '<label class="elab">Who enters scores' + sel('fsr', [['a', 'First-listed side; other side confirms'], ['either', 'Either side; other side confirms'], ['comm', 'Only me (commissioner)']], d.scorer) + '</label>';
      if (['rr', 'se', 'de'].includes(d.fmt)) h += '<div class="eline"><span>Bracket pick\'em for spectators<small>' + esc(INFO.pickem) + '</small></span>' + sw(d.pickem, 'data-tg="pickem"') + '</div>';
      if (d.fmt !== 'h2h') h += '<div class="eline"><span>Side matches allowed<small>Heads-up challenges on the side; they do not change the standings.</small></span>' + sw(d.side, 'data-tg="side"') + '</div>';
      h += '</div>';
    }
    h += '<div class="ecard"><h2>Players</h2><div class="eline"><span>I am playing<small>Adds you as the first entry.</small></span>' + sw(d.playIn, 'data-tg="playIn"') + '</div>';
    if (d.playIn) h += '<label class="elab">My rating (optional, e.g. DUPR 4.25)<input id="fmr" class="ein" type="number" inputmode="decimal" step="0.01" min="0" value="' + esc(d.myRating) + '"></label>';
    h += '<label class="elab">' + (d.unit === 'singles' || d.fmt === 'solo' ? 'Other players' : d.unit === 'teams' ? 'Teams' : 'Pairs') + ', one per line (name, rating)<textarea id="fen" class="ein eta" rows="5" placeholder="' + (d.unit === 'singles' || d.fmt === 'solo' ? 'Bea, 4.1\nCy, 3.6' : 'Bea / Cy, 4.0\nDi / Ed') + '">' + esc(d.entries) + '</textarea></label>';
    h += '<div class="enote">Players typed in here are guests: they can join with the invite link and pick their name, or claim their results later with a claim code. ' + esc(CAPLINE) + '</div>';
    h += '<div class="eline"><span>Players can add themselves<small>With the invite link, before the start.</small></span>' + sw(d.self, 'data-tg="self"') + '</div><div class="eline"><span>Spectators can join<small>Watch the scores' + (d.pickem ? " and play pick'em" : '') + '.</small></span>' + sw(d.spectators || d.pickem, 'data-tg="spectators"') + '</div></div>';
    h += '<div class="ecard"><h2>Entry and payout</h2><div class="e2"><label class="elab">Entry per player<input id="fmo" class="ein" type="number" inputmode="numeric" min="0" step="1" value="' + esc(d.entry || '') + '" placeholder="0"></label><label class="elab">Pot' + sel('fpt', [['main', 'Main pot'], ['side', 'Side pot']], d.pot) + '</label></div>';
    h += '<div class="e2"><label class="elab">Payout split' + sel('fspl', Object.keys(SPLITN).map((k) => [k, SPLITN[k]]), d.split) + '</label><label class="elab">Commissioner\'s take' + sel('ftk', [['none', 'None'], ['pct', 'Percent'], ['flat', 'Flat $']], d.takeKind) + '</label></div>';
    if (d.takeKind !== 'none') h += '<label class="elab">' + (d.takeKind === 'pct' ? 'Percent of the pot (0 to 50)' : 'Flat amount ($)') + '<input id="ftv" class="ein" type="number" inputmode="decimal" min="0" step="' + (d.takeKind === 'pct' ? 1 : 0.01) + '" value="' + esc(d.takeV) + '"></label>';
    h += '<div class="enote">' + esc(MONEY) + '</div></div>';
    h += '<div class="ewarn"><b>Rules lock at the start</b>After the start (or once you make the draw) nobody can change the rules or the entries, the commissioner included.</div>';
    return h + '<button class="epri efull" data-a="submit">Create event</button>';
  }
  function readDraft() {
    const v = (id) => { const x = document.getElementById(id); return x ? x.value : null; }, d = DR; if (!d) return;
    const map = { ft: 'title', fst: 'startLocal', fend: 'endDay', fun: 'unitLabel', fen: 'entries', fmr: 'myRating', fmo: 'entry', ftv: 'takeV' }; Object.keys(map).forEach((k) => { if (v(k) !== null) d[map[k]] = v(k); });
    const num = { fbo: 'bestOf', fto: 'to', fwb: 'winBy', fco: 'courts', fpo: 'pools', fpl: 'playoff', fre: 'reach', fex: 'expDays' }; Object.keys(num).forEach((k) => { if (v(k) !== null) d[num[k]] = Number(v(k)); });
    const str = { fun2: 'unit', fsc: 'scoring', fsd: 'seeding', fexp: 'expire', fmv: 'move', fsr: 'scorer', fpt: 'pot', fspl: 'split', ftk: 'takeKind' }; Object.keys(str).forEach((k) => { if (v(k) !== null) d[str[k]] = v(k); });
    if (v('fsp') !== null && v('fsp') !== d.sport) { const n = draftNew({ sport: v('fsp'), fmt: d.fmt }); ['to', 'winBy', 'unit'].forEach((k) => (d[k] = n[k])); d.sport = v('fsp'); }
    if (v('ffm') !== null) d.fmt = v('ffm');
  }
  function payload() {
    const d = DR, ents = String(d.entries || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^(.*?)(?:[,;]\s*(\d+(?:\.\d+)?))?$/.exec(l); return { name: m[1].trim(), rating: m[2] || '' }; });
    return { title: d.title.trim(), sport: d.sport, fmt: d.fmt, unit: d.fmt === 'solo' ? 'singles' : d.unit, start: new Date(d.startLocal).getTime(), endDay: d.endDay, to: d.to, winBy: d.sport === 'pickleball' ? 2 : d.winBy, bestOf: d.bestOf, scoring: d.scoring, seeding: d.seeding, courts: d.courts, pools: d.pools, playoff: d.playoff, reach: d.reach, expDays: d.expDays, expire: d.expire, move: d.move, pickem: d.pickem, weight: d.weight, side: d.side, scorer: d.scorer, low: d.low, unitLabel: d.unitLabel,
      entrants: ents, playIn: d.playIn, myRating: d.myRating, entry: Number(d.entry) || 0, pot: d.pot, split: d.split, take: { kind: d.takeKind, v: Number(d.takeV) || 0 }, self: d.self, spectators: d.spectators || d.pickem };
  }
  // ---- one event ----
  function eventV() {
    const s = cur(), e = s.ev; if (!e) return '<div class="ecard">Loading…</div>';
    const comm = e.role === 'comm', tabs = [['matches', e.fmt === 'solo' ? 'Scores' : 'Matches'], ['table', e.fmt === 'ladder' ? 'Ladder' : e.fmt === 'se' || e.fmt === 'de' ? 'Bracket' : 'Standings']].concat(e.rules.pickem ? [['pick', "Pick'em"]] : []).concat([['info', 'Info']]);
    let h = '<h1>' + esc(e.title) + '</h1><div class="emeta">' + fmtLine(e) + (e.inGroup ? ' · in a group' : '') + '</div>';
    const mineNext = e.matches.filter((m) => m.mine && (m.state === 'ready' || m.state === 'pending' || m.state === 'offered')), todo = e.matches.filter((m) => m.canConfirm || (m.canScore && m.mine && m.state === 'ready'));
    h += '<div class="e3">' + tile('Status', e.fin ? 'Final' : e.drawn ? 'Live' : 'Not started', 'data-tab="' + (e.fin ? 'table' : 'matches') + '"', e.fin ? '' : e.drawn ? '' : esc(fmtTime(e.start))) + tile('For you', String(todo.length), 'data-a="todo"', todo.length ? 'need a score or OK' : mineNext.length ? 'next: ' + esc(mineNext[0].an + ' v ' + mineNext[0].bn) : 'nothing waiting', todo.length ? 'eyel' : '') + (comm ? tile('Disputes', String(e.flags), 'data-a="flags"', e.flags ? 'you decide' : 'none', e.flags ? 'eneg' : '') : tile('People', e.people + '/' + e.cap, 'data-tab="info"', '')) + '</div>';
    h += '<div class="eseg etabs">' + tabs.map(([k, l]) => '<button class="' + (s.tab === k ? 'on' : '') + '" data-tab="' + k + '">' + l + '</button>').join('') + '</div>';
    if (s.err2) h += '<div class="eerr">' + esc(s.err2) + '</div>';
    const q = Q().filter((x) => x.b.id === e.id); if (q.length) h += '<div class="ewarn"><b>' + q.length + ' score' + (q.length > 1 ? 's' : '') + ' waiting to send</b>' + (q.some((x) => x.fail) ? esc(q.find((x) => x.fail).fail) + '<button class="etiny" data-a="qclear">Dismiss</button>' : 'Saved on this phone; sent when you are back online.') + '</div>';
    if (s.tab === 'matches') h += matchesV(e, s); else if (s.tab === 'table') h += tableV(e); else if (s.tab === 'pick') h += pickV(e); else h += infoV(e);
    return h;
  }
  function matchCard(e, m) {
    const pill = '<span class="epill' + (m.state === 'confirmed' ? ' eok' : m.state === 'disputed' ? ' ebad' : m.state === 'pending' || m.state === 'offered' ? ' ewait' : '') + '">' + esc(m.state === 'ready' && m.live ? 'Playing' : stateTxt[m.state] || m.state) + '</span>';
    const where = (m.court ? 'Court ' + m.court + (m.wave > 1 ? ', wave ' + m.wave : '') : '') + (m.exp && m.state === 'ready' ? (m.court ? ' · ' : '') + 'play by ' + fmtTime(m.exp) : '');
    const nm = (x, side) => '<span class="' + (m.win === side ? 'ewin' : '') + '">' + esc(x || 'To be decided') + (m.mine === side ? ' <i class="emut">· you</i>' : '') + '</span>';
    let sc = m.state === 'confirmed' ? (m.forfeit ? 'Forfeit' : scoreTxt(m)) : m.sub && (m.state === 'pending' || m.state === 'disputed') ? scoreTxt(m, m.sub.games) + ' (entered)' : '';
    return '<button class="ematch' + (m.mine ? ' mine' : '') + (m.mine && m.state === 'confirmed' ? (m.win === m.mine ? ' hit' : ' miss') : '') + (m.canConfirm || m.needsComm ? ' act' : '') + '" data-a="match" data-m="' + att(m.id) + '"><span class="emw"><small>' + esc(label(m) + (where ? ' · ' + where : '')) + '</small>' + nm(m.an, 'a') + nm(m.bn, 'b') + '</span><span class="er">' + pill + (sc ? '<b>' + esc(sc) + '</b>' : '') + '</span></button>';
  }
  const label = (m) => (m.st === 'pool' ? 'Round ' + m.r : m.st === 'po' ? 'Playoff round ' + m.r : m.st === 'w' ? 'Round ' + m.r : m.st === 'l' ? 'Losers round ' + m.r : m.st === 'gf' ? (m.reset ? 'Final (reset)' : 'Final') : m.st === 'lad' ? 'Ladder challenge' : m.st === 'side' ? 'Side match' : m.st === 'tb' ? 'Tiebreak playoff' : 'Heads-up');
  function matchesV(e, s) {
    if (e.fmt === 'solo') return soloV(e);
    let h = '';
    if (!e.drawn) { h += '<div class="ewarn"><b>Starts ' + esc(fmtTime(e.start)) + '</b>The draw is made at the start' + (e.role === 'comm' ? ', or now if you tap below (entries and rules lock then).' : '.') + '</div>'; if (e.role === 'comm' && e.fmt !== 'h2h') h += '<button class="esec efull" data-a="draw">Make the draw now</button>'; }
    const canCh = e.drawn && !e.fin && (e.fmt === 'ladder' || e.fmt === 'h2h' || e.rules.side) && (e.myEntries.length || e.role === 'comm');
    if (canCh || (e.fmt === 'h2h' && e.started && !e.fin)) h += '<button class="epri efull" data-a="chal">' + (e.fmt === 'ladder' ? 'Challenge someone above you' : e.fmt === 'h2h' ? 'Start a heads-up challenge' : 'Start a side match') + '</button>';
    const F = s.mf || 'all', ms = e.matches.filter((m) => m.state !== 'bye' && (F === 'all' || (F === 'mine' ? m.mine : F === 'todo' ? m.canConfirm || (m.canScore && (m.mine || e.role === 'comm') && m.state !== 'confirmed') || m.needsComm : F === 'flags' ? m.needsComm : m.state === 'confirmed')));
    h += '<label class="elab">Show' + sel('emf', [['all', 'All matches'], ['mine', 'My matches'], ['todo', 'Need a score or OK']].concat(e.role === 'comm' ? [['flags', 'Disputes / you confirm']] : []).concat([['done', 'Finished']]), F) + '</label>';
    if (!ms.length) h += '<div class="ecard emut">No matches here' + (e.drawn ? '' : ' yet') + '.</div>';
    let lastK = ''; ms.forEach((m) => { const k = m.st === 'pool' ? 'Round ' + m.r + (e.pools && e.pools.length > 1 ? '' : '') : m.st === 'w' || m.st === 'po' ? (m.st === 'po' ? 'Playoff' : 'Winners bracket') + ' round ' + m.r : m.st === 'l' ? 'Losers bracket round ' + m.r : m.st === 'gf' ? 'Final' : ({ lad: 'Ladder challenges', side: 'Side matches', h2h: 'Heads-up matches' }[m.st] || label(m)); if (k !== lastK) { h += '<h3 class="eh">' + esc(k) + '</h3>'; if (m.st === 'pool' && e.byes && e.byes[m.r]) h += '<div class="enote">Bye this round: ' + esc(e.byes[m.r].map((x) => (e.entrants.find((y) => y.eid === x) || {}).name).join(', ')) + '</div>'; lastK = k; } h += matchCard(e, m); });
    return h;
  }
  function soloV(e) {
    let h = '';
    if (!e.drawn) return '<div class="ewarn"><b>Starts ' + esc(fmtTime(e.start)) + '</b>Scores open at the start.</div>';
    const mine = e.entrants.filter((x) => e.myEntries.includes(x.eid)), list = e.role === 'comm' ? e.entrants : mine;
    if (!e.fin && list.length) { h += '<div class="ecard"><h2>Enter a score</h2><label class="elab">Who' + sel('esoloe', list.map((x) => [x.eid, x.name]), list[0].eid) + '</label><label class="elab">' + esc(e.rules.unitLabel) + '<input id="esolov" class="ein" type="number" inputmode="decimal" step="any"></label><button class="epri efull" data-a="solo">Save score</button>' + voiceBtn('solo') + '</div>'; }
    h += '<h3 class="eh">Scores · ' + (e.rules.low ? 'lowest' : 'highest') + ' wins</h3><div class="ethead"><span>#</span><span>Player</span><span class="er">' + esc(e.rules.unitLabel) + '</span></div>';
    (e.solo || []).forEach((r) => { h += '<div class="etrow"><span>' + r.place + '</span><span><b>' + esc(r.name) + '</b>' + (r.ver ? '' : '<small>self-entered</small>') + '</span><span class="er"><b>' + esc(r.score) + '</b></span></div>'; });
    if (!(e.solo || []).length) h += '<div class="ecard emut">No scores yet.</div>';
    if (e.role === 'comm' && !e.fin) h += '<button class="esec efull" data-a="finish">Finish the event</button>';
    return h;
  }
  function tableV(e) {
    let h = '';
    if (e.placeRows) { h += '<h3 class="eh">Final places</h3>'; e.placeRows.forEach((r) => { h += '<div class="etrow' + (r.place === 1 ? ' egold2' : '') + '"><span class="' + (r.place === 1 ? 'egold' : '') + '">' + ord(r.place) + '</span><span><b>' + esc(r.name) + '</b></span><span></span></div>'; }); }
    if (e.fmt === 'solo') return h + soloV(e);
    if (e.tables) e.tables.forEach((t, i) => {
      h += '<h3 class="eh">' + (e.tables.length > 1 ? 'Pool ' + String.fromCharCode(65 + i) : 'Standings') + '</h3><div class="ethead e5"><span>#</span><span>Player</span><span class="er">W-L</span><span class="er">+/-</span></div>';
      t.forEach((r) => { h += '<button class="etrow e5" data-a="ent" data-eid="' + att(r.eid) + '"><span>' + r.rank + '</span><span><b>' + esc(r.name) + '</b><small>' + (r.h2h != null && r.h2h !== '' ? 'H2H ' + esc(r.h2h) + ' · ' : '') + 'scored ' + (r.pf != null ? r.pf : 0) + /* integration stop-gap: never print "undefined"; the events coder's own fix replaces this line at the next merge */ (r.tie ? ' · <span class="eyel">tied</span>' : r.tb ? ' · placed by ' + esc(r.tb) : '') + '</small></span><span class="er">' + r.w + '-' + r.l + '</span><span class="er ' + (r.diff > 0 ? 'epos' : r.diff < 0 ? 'eneg' : '') + '">' + (r.diff > 0 ? '+' : '') + r.diff + '</span></button>'; });
    });
    (e.ties || []).forEach((t) => { h += '<div class="ewarn"><b>Still tied: ' + esc(t.names.join(', ')) + '</b>Level after every tiebreak step. ' + (t.game ? 'A tiebreak playoff is on: its ' + (t.matches > 1 ? 'matches are' : 'match is') + ' on the Matches tab.' : e.role === 'comm' ? 'You choose how it is settled; the choice is logged for everyone.' : 'The organizer chooses a tiebreak playoff or a coin flip.') + (e.role === 'comm' && !t.game ? '<div class="e2"><button class="esec" data-a="tbreak" data-how="game" data-k="' + esc(t.key) + '">Tiebreak playoff (' + t.matches + ' match' + (t.matches > 1 ? 'es' : '') + ')</button><button class="esec" data-a="tbreak" data-how="coin" data-k="' + esc(t.key) + '">Coin flip</button></div>' : '') + '</div>'; });
    if (e.tables) h += '<div class="enote">Order (pickleball rulebook): most wins; head-to-head among the tied; point differential in all matches; head-to-head point differential; point differential against the next-highest entry. Still level: the organizer picks a tiebreak playoff or a coin flip (logged). The seed never breaks a tie. Only confirmed scores count.' + (e.rules.playoff ? ' Top ' + e.rules.playoff + ' go to the playoff.' : '') + '</div>';
    if (e.ladder) { h += '<h3 class="eh">Ladder</h3><div class="ethead e4"><span>#</span><span>Player</span><span class="er">Challenge</span></div>'; e.ladder.forEach((r) => { const mine = e.myEntries.includes(r.eid), my = e.ladder.find((x) => e.myEntries.includes(x.eid)), can = my && !mine && r.rank < my.rank && my.rank - r.rank <= e.rules.reach && e.drawn && !e.fin; h += '<div class="etrow e4"><span>' + r.rank + '</span><span><b>' + esc(r.name) + (mine ? ' · you' : '') + '</b></span>' + (can ? '<button class="etiny" data-a="dochal" data-a2="' + att(my.eid) + '" data-b2="' + att(r.eid) + '">Challenge</button>' : '<span></span>') + '</div>'; }); }
    if (e.records && (e.fmt === 'h2h' || e.fmt === 'ladder' || e.rules.side)) { h += '<h3 class="eh">' + (e.fmt === 'h2h' ? 'Records' : 'Challenge records') + '</h3><div class="ethead e5"><span>#</span><span>Player</span><span class="er">W-L</span><span class="er">+/-</span></div>'; e.records.forEach((r) => { h += '<button class="etrow e5" data-a="ent" data-eid="' + att(r.eid) + '"><span>' + r.rank + '</span><span><b>' + esc(r.name) + '</b></span><span class="er">' + r.w + '-' + r.l + '</span><span class="er">' + (r.diff > 0 ? '+' : '') + r.diff + '</span></button>'; }); }
    if (e.fmt === 'se' || e.fmt === 'de' || (e.fmt === 'rr' && e.matches.some((m) => m.st === 'po'))) {
      const rounds = {}; e.matches.filter((m) => m.st !== 'pool' && m.st !== 'side').forEach((m) => { const k = (m.st === 'l' ? 'Losers round ' : m.st === 'gf' ? 'Final' : m.st === 'po' ? 'Playoff round ' : 'Round ') + (m.st === 'gf' ? (m.reset ? ' (reset)' : '') : m.r); (rounds[k] = rounds[k] || []).push(m); });
      Object.keys(rounds).forEach((k) => { h += '<h3 class="eh">' + esc(k) + '</h3>'; rounds[k].forEach((m) => { if (m.state === 'void' && m.reset) return; h += matchCard(e, m); }); });
      if (!Object.keys(rounds).length) h += '<div class="ecard emut">The bracket appears after the draw.</div>';
    }
    return h || '<div class="ecard emut">Standings appear once matches are played.</div>';
  }
  function pickV(e) {
    const p = e.pickem; if (!p) return '';
    let h = '<div class="enote">' + esc(INFO.pickem) + '</div>';
    const open = e.matches.filter((m) => p.open.includes(m.id));
    h += '<h3 class="eh">Open to pick · ' + open.length + '</h3>';
    if (!open.length) h += '<div class="ecard emut">Nothing to pick right now. Later rounds open as earlier matches finish.</div>';
    open.forEach((m) => { const my = p.mine[m.id]; h += '<div class="ecard"><small class="emut">' + esc(label(m)) + '</small>' + (my ? '<div class="erow"><b class="ename">' + esc(my.s === 'a' ? m.an : m.bn) + '</b><span class="ebadge eg">Your pick · locked</span></div><div class="emeta">over ' + esc(my.s === 'a' ? m.bn : m.an) + ' · saved ' + esc(fmtTime(my.t)) + '</div>' : '<div class="e2">' + ['a', 'b'].map((sd) => '<button class="esec" data-a="pick" data-m="' + att(m.id) + '" data-side="' + sd + '">' + esc(sd === 'a' ? m.an : m.bn) + '</button>').join('') + '</div>') + '</div>'; });
    if (open.some((m) => !p.mine[m.id])) h += '<div class="enote">A pick locks the moment you make it (saved and time-stamped by Oddable). It cannot be changed.</div>';
    h += p.tb != null ? '<div class="ecard"><div class="erow"><span>Tiebreak: total points in the final</span><span class="ebadge eg">' + esc(p.tb) + ' · locked</span></div></div>' : '<label class="elab">Tiebreak: total points in the final (locks when you save it)<input id="etb" class="ein" type="number" inputmode="numeric" min="0" max="999" value=""></label><button class="esec efull" data-a="tb">Save tiebreak</button>';
    if (p.rounds && p.rounds.length) { h += '<h3 class="eh">When picks lock</h3>'; const loc = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); };
      p.rounds.forEach((r) => { h += '<div class="ecard"><div class="erow"><b class="ename">' + esc(r.label) + '</b><span class="ebadge ' + (r.locked ? 'ep' : 'ey') + '">' + (r.locked ? 'Locked' : 'Open') + '</span></div><div class="emeta">' + (r.locked ? (r.how === 'button' ? 'Locked by the commissioner.' : r.how === 'time' ? 'Locked at its lock time, ' + esc(fmtTime(r.lockAt)) + '.' : 'Locked when its first match started.') : r.lockAt ? 'Locks ' + esc(fmtTime(r.lockAt)) + ', or when its first match starts if that is sooner.' : 'Locks when its first match starts or gets a score.') + '</div>' + (e.role === 'comm' && !r.locked && !e.fin ? '<label class="elab">Lock time<input class="ein" type="datetime-local" data-plk="' + esc(r.key) + '" value="' + (r.lockAt ? loc(r.lockAt) : '') + '"></label><div class="e2"><button class="esec" data-a="plockat" data-k="' + esc(r.key) + '">Set lock time</button><button class="esec" data-a="plock" data-k="' + esc(r.key) + '">Lock picks now</button></div>' : '') + '</div>'; }); }
    h += '<h3 class="eh">Leaderboard</h3><div class="ethead e5"><span>#</span><span>Name</span><span class="er">Right</span><span class="er">Pts</span></div>';
    p.table.forEach((r) => { h += '<div class="etrow e5"><span>' + r.place + '</span><span><b>' + esc(r.name) + '</b>' + (r.tb != null && p.finalTotal != null ? '<small>tiebreak ' + r.tb + '</small>' : '') + '</span><span class="er">' + r.right + '/' + r.n + '</span><span class="er"><b>' + r.pts + '</b></span></div>'; });
    if (!p.table.length) h += '<div class="ecard emut">No picks yet.</div>';
    const locked = e.matches.filter((m) => p.counts[m.id] && m.an && m.bn); if (locked.length) { h += '<h3 class="eh">How everyone picked (after each round locked)</h3>'; locked.forEach((m) => { const c = p.counts[m.id]; h += '<div class="etrow e1"><span><b>' + esc(m.an) + ' v ' + esc(m.bn) + '</b><small>' + esc(label(m)) + ' · picked ' + esc(m.an) + ': ' + c.a + ' · picked ' + esc(m.bn) + ': ' + c.b + '</small></span></div>'; }); }
    return h;
  }
  function infoV(e) {
    const comm = e.role === 'comm';
    let h = '<button class="epri efull" data-a="invite">Invite people</button><div class="enote">' + esc(INFO.invite) + '</div>';
    h += '<div class="ecard"><h2>Rules</h2>' + rulesList(e) + '</div>';
    h += '<div class="ecard"><h2>' + (e.fmt === 'solo' ? 'Players' : 'Entries') + ' · ' + e.entrants.length + '</h2>';
    const canRate = comm && e.ent && e.odd && !e.locked;
    e.entrants.slice().sort((a, b) => (a.seed || 999) - (b.seed || 999)).forEach((x) => {
      h += '<div class="emrow"><span><b>' + (x.seed ? x.seed + '. ' : '') + esc(x.name) + '</b>' + (x.players.length > 1 && e.odd && x.oddRating != null ? '<small>Team rating ' + esc(x.oddRating) + '</small>' : '') + (x.rating != null ? '<small>Typed rating ' + esc(x.rating) + (e.odd ? ' (shown only)' : '') + '</small>' : '');
      x.players.forEach((p) => { h += '<small class="eplr">' + esc(p.name + (p.blank ? ' (open spot)' : p.guest ? ' (guest)' : '') + (p.me ? ' · you' : '')) + (e.odd && !p.blank ? '<br><span class="erate">' + esc(rateLine(p)) + '</span>' + (p.trn ? ' <span class="ebadge ey">Set by tournament</span>' : '') : '') + '</small>' + (canRate && !p.blank ? '<button class="etiny erbtn" data-a="trate" data-gid="' + att(p.gid) + '">' + (p.trn ? 'Change tournament rating' : 'Set tournament rating') + '</button>' : ''); });
      h += (comm ? x.players.filter((p) => p.claim && !p.blank).map((p) => '<small class="ecopy">Claim code for ' + esc(p.name) + ': <code>' + esc(p.claim) + '</code></small>').join('') : '') + '</span>' + (comm && !e.locked ? '<button class="etiny" data-a="rment" data-eid="' + att(x.eid) + '">Remove</button>' : '') + '</div>'; });
    if (e.odd) h += '<div class="enote">' + esc(ODDNOTE) + (e.ent ? ' In this Enterprise event the director can set a tournament rating for this event only' + (e.locked ? '; ratings locked at the start.' : ' until it starts.') : '') + '</div>';
    if (e.teams && !e.locked) h += '<button class="esec efull" data-a="partners">Suggest partners</button><div class="enote">Balanced, Rotate or Hot pairs, each with a reason. It only suggests' + (comm ? '; you choose.' : '; the commissioner sets the teams.') + '</div>';
    if (comm && !e.locked) h += '<label class="elab">Add ' + (e.rules.unit === 'singles' ? 'a player' : 'an entry') + ' (name, rating)<input id="eadd" class="ein" maxlength="50" placeholder="' + (e.rules.unit === 'singles' ? 'Bea, 4.1' : 'Bea / Cy, 4.0') + '"></label><button class="esec efull" data-a="addent">Add</button>';
    h += '<div class="enote">' + e.people + ' of ' + e.cap + ' people. ' + esc(e.cap > 8 ? 'Licensed for larger games.' : e.entText || ENTTEXT) + '</div></div>';
    const p = e.pot; h += '<div class="ecard"><h2>Money (information only)</h2><div class="ekv"><span>' + (p.pot === 'side' ? 'Side pot' : 'Main pot') + '<small>' + p.paid + ' of ' + p.players + ' paid × ' + usd(p.entry) + '</small></span><b>' + usd(p.total) + '</b></div><div class="ekv"><span>Commissioner\'s take<small>' + esc(e.takeText) + '</small></span><b>' + (p.take ? '-' + usd(p.take) : '$0') + '</b></div><div class="ekv"><span>Prize pool</span><b class="egold">' + usd(p.pool) + '</b></div>';
    p.places.forEach((x) => { const w = e.placeRows && e.placeRows.find((r) => r.place === x.place); h += '<div class="ekv"><span>' + ord(x.place) + ' · ' + x.pct + '%<small>' + (w ? esc(w.name) : 'Not decided') + '</small></span><b>' + usd(x.amt) + '</b></div>'; });
    h += '<div class="enote">' + esc(MONEY) + '</div></div>';
    h += '<div class="ecard"><h2>People · ' + e.members.length + '</h2>'; e.members.forEach((m) => { h += '<div class="emrow"><span>' + esc(m.name) + ' <i class="emut">· ' + (m.comm ? 'commissioner' : m.role === 'spectator' ? 'watching' : 'player') + (m.pid === e.me ? ', you' : '') + '</i></span>' + (e.money.entry && m.role !== 'spectator' ? (m.paid ? '<span class="emut">Paid' + (comm ? ' <button class="etiny" data-a="unpaid" data-pid="' + att(m.pid) + '">Undo</button>' : '') + '</span>' : comm ? '<button class="etiny eyel" data-a="paid" data-pid="' + att(m.pid) + '">Mark paid</button>' : '<span class="eyel">Owed</span>') : '') + '</div>'; }); h += '</div>';
    if (e.tlog && e.tlog.length) h += '<div class="ecard"><h2>Tournament ratings · ' + e.tlog.length + ' change' + (e.tlog.length > 1 ? 's' : '') + '</h2>' + e.tlog.map((a) => '<div class="eaud"><small>' + esc(fmtTime(a.at)) + ' · ' + esc(a.by) + ' (director)</small><b>' + esc(a.player) + '</b>: ' + esc(a.old == null ? 'no rating' : a.old) + ' → ' + esc(a.new == null ? 'tournament rating removed' : a.new) + '<small>Oddable (real results): ' + esc(a.oddable == null ? 'no games yet' : a.oddable) + ' · Reason: ' + esc(a.reason) + '</small></div>').join('') + '<div class="enote">These apply to this event only. Nobody\'s lifetime Oddable rating is changed.</div></div>';
    h += '<div class="ecard"><h2>History</h2>' + (e.audit.length ? e.audit.slice(0, 60).map((a) => '<div class="eaud"><small>' + esc(fmtTime(a.t)) + ' · ' + esc(a.who) + '</small>' + esc(a.s) + '</div>').join('') : '<div class="emut">Nothing yet.</div>') + '</div>';
    if (comm && !e.locked) h += '<button class="edanger efull" data-a="delete">Delete event</button>';
    if (comm && (e.fmt === 'ladder' || e.fmt === 'h2h') && e.started && !e.fin) h += '<button class="esec efull" data-a="finish">Finish the event now</button>';
    if (!comm) h += '<button class="edanger efull" data-a="leave">Leave event</button>';
    return h;
  }
  // ---- one match: score entry, confirm, dispute ----
  function voiceBtn(kind) { return window.VoiceLog && typeof window.VoiceLog.open === 'function' ? '<button class="evoice efull" data-a="voice" data-k="' + kind + '">🎤 Log my score</button>' : ''; }
  function matchV() {
    const s = cur(), e = s.ev, m = e && e.matches.find((x) => x.id === s.m); if (!m) return '<div class="ecard">Match not found.</div>';
    const r = e.rules, n = r.bestOf, g = s.g || (m.sub && m.state !== 'ready' ? m.sub.games : null) || [];
    let h = '<h1>' + esc(m.an || 'TBD') + ' v ' + esc(m.bn || 'TBD') + '</h1><div class="emeta">' + esc(label(m) + (m.court ? ' · Court ' + m.court : '') + ' · ' + gameRule(r, e.sport)) + '</div>';
    h += '<div class="ecard"><div class="erow"><b>' + esc(stateTxt[m.state] || m.state) + '</b>' + (m.state === 'confirmed' ? '<b>' + esc(m.forfeit ? 'Forfeit' : scoreTxt(m)) + '</b>' : '') + '</div>';
    if (m.sub && m.state !== 'ready') h += '<div class="enote">Entered by ' + esc(m.sub.by) + ': ' + esc(scoreTxt(m, m.sub.games)) + (m.sub.note ? ' · Dispute: ' + esc(m.sub.note) : '') + '</div>';
    if (m.needsComm) h += '<div class="eyel">' + (m.state === 'disputed' ? 'Disputed. The commissioner enters the right score.' : 'The other side has no account here, so the commissioner confirms.') + '</div>';
    h += '</div>';
    if (m.state === 'offered' && (m.mine === 'b' || e.role === 'comm')) h += '<div class="e2"><button class="epri" data-a="accept">Accept</button><button class="esec" data-a="decline">Decline</button></div>';
    if (m.canConfirm) h += '<div class="e2"><button class="epri" data-a="confirm">Confirm ' + esc(scoreTxt(m, m.sub.games)) + '</button>' + (e.role === 'comm' && !m.mine ? '' : '<button class="edanger" data-a="dispute">Dispute</button>') + '</div>' + (e.role === 'comm' && !m.mine ? '' : '<label class="elab">Why (optional, for the commissioner)<input id="enote" class="ein" maxlength="120" placeholder="It was 11-9 in game 2"></label>');
    if (m.canScore && m.state !== 'confirmed' || (m.canScore && e.role === 'comm')) {
      if (m.state === 'ready' && !m.live && e.rules.pickem && (m.mine || e.role === 'comm')) h += '<button class="esec efull" data-a="live">Start the match (locks pick\'em)</button>';
      h += '<div class="ecard"><h2>' + (m.state === 'confirmed' ? 'Correct the score (commissioner)' : 'Enter the score') + '</h2><div class="ethead e3c"><span>Game</span><span class="er">' + esc(m.an) + '</span><span class="er">' + esc(m.bn) + '</span></div>';
      for (let i = 0; i < n; i++) h += '<div class="etrow e3c"><span>' + (r.tset ? 'Set ' : 'Game ') + (i + 1) + '</span><input id="ga' + i + '" class="ein enum" type="number" inputmode="numeric" min="0" max="999" value="' + esc(g[i] ? g[i][0] : '') + '" aria-label="' + esc(m.an) + ' game ' + (i + 1) + '"><input id="gb' + i + '" class="ein enum" type="number" inputmode="numeric" min="0" max="999" value="' + esc(g[i] ? g[i][1] : '') + '" aria-label="' + esc(m.bn) + ' game ' + (i + 1) + '"></div>';
      h += '<button class="epri efull" data-a="savescore">Save score</button>' + voiceBtn('match') + '<div class="enote">' + (e.role === 'comm' && (!m.mine || m.state !== 'ready' || !((e.entrants.find((x) => x.eid === (m.mine === 'a' ? m.b : m.a)) || {}).linked)) ? 'Your entry as commissioner is final.' : 'The other side confirms it. If they disagree, the commissioner decides.') + (n > 1 ? ' Leave unplayed games empty.' : '') + '</div></div>';
    } else if (m.state === 'ready' && !m.canScore && m.mine) h += '<div class="enote">' + esc(r.scorer === 'comm' ? 'The commissioner enters every score.' : 'The other side keeps score for this match; you confirm it.') + '</div>';
    const hist = e.audit.filter((a) => a.m === m.id); if (hist.length) h += '<div class="ecard"><h2>History</h2>' + hist.map((a) => '<div class="eaud"><small>' + esc(fmtTime(a.t)) + ' · ' + esc(a.who) + '</small>' + esc(a.s) + '</div>').join('') + '</div>';
    return h;
  }
  function chalV() {
    const s = cur(), e = s.ev, mine = e.entrants.filter((x) => e.myEntries.includes(x.eid)), from = e.role === 'comm' ? e.entrants : mine;
    let h = '<h1>' + (e.fmt === 'ladder' ? 'Ladder challenge' : e.fmt === 'h2h' ? 'Heads-up challenge' : 'Side match') + '</h1><div class="enote">' + esc(e.fmt === 'ladder' ? INFO.ladder : INFO.h2h) + '</div>';
    if (!from.length) return h + '<div class="ecard emut">You need an entry in this event to challenge.</div>';
    h += '<label class="elab">From' + sel('cha', from.map((x) => [x.eid, x.name]), s.a || from[0].eid) + '</label><label class="elab">Against' + sel('chb', e.entrants.filter((x) => x.eid !== (s.a || from[0].eid)).map((x) => [x.eid, x.name]), s.b) + '</label>';
    return h + '<button class="epri efull" data-a="sendchal">Send challenge</button>';
  }
  // ---- E-H: the director sets one player's rating for this tournament ----
  function trateV() {
    const s = cur(), e = s.ev; let p = null, ent = null; e.entrants.forEach((x) => x.players.forEach((y) => { if (y.gid === s.gid) { p = y; ent = x; } })); if (!p) return '<h1>Tournament rating</h1><div class="ecard emut">That player is no longer in the event.</div>';
    let h = '<h1>Tournament rating</h1><div class="emeta">' + esc(p.name) + (ent.players.length > 1 ? ' · ' + esc(ent.name) : '') + '</div>';
    h += '<div class="ecard"><div class="ekv"><span>Oddable rating<small>Real results from app play. Never changed here.</small></span><b>' + (p.odd ? esc(p.odd.rating) : 'No games yet') + '</b></div><div class="ekv"><span>Tournament rating<small>' + (p.trn ? 'Set by the director' + (p.trn.at ? ' · ' + esc(fmtTime(p.trn.at)) : '') + (p.trn.reason ? ' · ' + esc(p.trn.reason) : '') : p.odd ? 'Not set: the Oddable rating is used' : 'Not set: counted as a new player (1500)') + '</small></span><b class="' + (p.trn ? 'egold' : '') + '">' + (p.trn ? esc(p.trn.v) : '—') + '</b></div></div>';
    if (e.locked) return h + '<div class="ewarn"><b>Locked</b>Ratings locked when the event started.</div>';
    h += '<label class="elab">Rating for this tournament (100 to 3500; new players start at 1500)<input id="etr" class="ein enum" type="number" inputmode="numeric" min="100" max="3500" step="1" value="' + esc(s.v != null ? s.v : p.trn ? p.trn.v : p.odd ? p.odd.rating : '') + '"></label>';
    h += '<label class="elab">Reason (logged and shown to the players)<input id="etrr" class="ein" maxlength="120" placeholder="Club ladder position, back from injury…" value="' + esc(s.r || '') + '"></label>';
    h += '<button class="epri efull" data-a="trsave">Save for this tournament</button>' + (p.trn ? '<button class="esec efull" data-a="trclear">Remove it (use the Oddable rating)</button>' : '');
    return h + '<div class="enote">Applies to this event only: seeding, pairings and partner suggestions here. The player\'s lifetime Oddable rating is not changed, and it stays on the screen next to the tournament rating. Every change is logged. Locks when the event starts.</div>';
  }
  // ---- P1: Suggest partners (it only suggests; the commissioner chooses) ----
  function partnersV() {
    const s = cur(), e = s.ev, comm = e.role === 'comm', md = PMODES.find((x) => x[0] === (s.mode || 'balanced'));
    let h = '<h1>Suggest partners</h1><div class="emeta">' + esc(e.title) + '</div>';
    h += '<div class="eseg">' + PMODES.map(([k, l]) => '<button class="' + (k === md[0] ? 'on' : '') + '" aria-pressed="' + (k === md[0]) + '" data-pm="' + k + '">' + l + '</button>').join('') + '</div><div class="enote">' + esc(md[2]) + ' Suggestions only: ' + (comm ? 'you choose.' : 'the commissioner sets the teams.') + '</div>';
    const d = s.sug; if (!d) return h + '<div class="ecard">Working out the teams…</div>';
    if (!d.suggestions.length) return h + '<div class="ecard emut">Add at least ' + d.teamSize + ' players first (Info → Entries).</div>';
    d.suggestions.forEach((x, i) => {
      h += '<div class="ecard' + (i === 0 ? ' egoldc' : '') + '"><div class="erow"><b class="ename">' + (i === 0 ? 'Best fit' : 'Option ' + (i + 1)) + '</b>' + (e.odd ? '<span class="ebadge ' + (i === 0 ? 'ey' : 'ep') + '">spread ' + esc(x.spread) + '</span>' : '') + '</div><div class="emeta">' + esc(x.reason) + '</div>';
      x.names.forEach((t, j) => { h += '<div class="emrow"><span><b>' + esc(t.join(' & ')) + '</b><small>' + esc(e.odd ? x.notes[j] : x.notes[j].replace(/^Avg rating \d+ · /, '')) + '</small></span></div>'; });
      if (x.leftover.length) h += '<div class="enote">Without a team yet: ' + esc(x.leftover.map((g) => { let n = g; e.entrants.forEach((en) => en.players.forEach((p) => { if (p.gid === g) n = p.name; })); return n; }).join(', ')) + '</div>';
      if (comm && !d.locked) h += '<button class="' + (i === 0 ? 'epri' : 'esec') + ' efull" data-a="useteams" data-i="' + i + '">Use these teams</button>';
      h += '</div>'; });
    return h + '<div class="enote">' + (e.odd ? esc(ODDNOTE) + ' ' : '') + 'Based on ' + d.players + ' players and ' + d.history + ' past game' + (d.history === 1 ? '' : 's') + ' they played as partners.' + (d.locked ? ' Teams locked when the event started.' : '') + '</div>';
  }
  function loadPartners(s) { s.sug = null; post('partners', { id: s.id, mode: s.mode || 'balanced' }).then((j) => { s.sug = j; if (cur() === s) paint(); }).catch((x) => { err = errText(x); s.sug = { suggestions: [], teamSize: 2, players: 0, history: 0 }; if (cur() === s) paint(); }); }
  function infoSheet() { const s = cur(); return '<h1>' + esc(s.title) + '</h1><div class="ecard">' + esc(s.text) + '</div><div class="ecard">' + esc(INFO.scoring) + '</div>'; }

  // ---------- paint ----------
  const el = () => document.getElementById('oevt');
  const cur = () => stack[stack.length - 1];
  function paintBusy(on) { const e = el(); if (e) e.classList.toggle('ebusy', !!on); }
  function paint() {
    const x = el(); if (!x) return; const s = cur();
    const back = stack.length > 1 ? (stack[stack.length - 2].t === 'home' ? 'My events' : 'Back') : '';
    const V = { home, joincode: joinCodeV, preview: previewV, create: createV, event: eventV, match: matchV, chal: chalV, info: infoSheet, trate: trateV, partners: partnersV }[s.t];
    const keep = x.scrollTop; const hd = withHead(top(back), V ? V() : ''); x.querySelector('.ein0').innerHTML = hd; if (err) { const box = document.createElement('div'); box.className = 'eerr'; box.setAttribute('role', 'alert'); box.textContent = err; x.querySelector('.ehead').insertAdjacentElement('afterend', box); } if (s.keepScroll) x.scrollTop = keep;
  }
  function push(o) { readDraft(); err = ''; stack.push(o); paint(); const x = el(); if (x) x.scrollTop = 0; }
  async function loadHome() { try { H = await post('mine', {}); err = ''; } catch (e) { err = errText(e); if (!H) H = { events: [] }; } if (cur().t === 'home') paint(); }
  async function load(s, quiet) { try { const j = await post('get', { id: s.id, since: quiet && s.ev ? s.ev.u : undefined }); if (j.same) return; s.ev = j.event; s.err2 = ''; } catch (e) { if (!quiet) err = errText(e); else s.err2 = errText(e); } stack.forEach((x) => { if (x.id === s.id && x !== s) x.ev = s.ev; }); const c = cur(); if (c.id === s.id) { c.keepScroll = quiet; paint(); c.keepScroll = false; } }
  function poll() { clearInterval(POLL); POLL = setInterval(() => { if (!el()) { clearInterval(POLL); return; } if (document.hidden) return; flush(); const s = cur(); if (s && s.id && (s.t === 'event' || s.t === 'match') && !busy && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) load(s, true); }, 10000); }
  const evOf = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].ev) return stack[i].ev; return null; };
  const readGames = (n) => { const g = []; for (let i = 0; i < n; i++) { const a = (document.getElementById('ga' + i) || {}).value, b = (document.getElementById('gb' + i) || {}).value; if (a === '' && b === '') continue; g.push([Number(a), Number(b)]); } return g; };
  function sendScore(e, m, games, done) { // through the normal scorer entry route; queued on the phone if offline
    const b = { id: e.id, m: m.id, games, v: m.v, op: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
    if (!navigator.onLine) { const q = Q(); q.push({ b, at: Date.now() }); Qset(q); stack.pop(); paint(); if (done) done({ queued: true }); return Promise.resolve({ queued: true }); }
    return new Promise((ok) => act('score', b, async (j) => { const s = stack.find((x) => x.id === e.id && x.t === 'event'); if (s) s.ev = j.event; stack.pop(); paint(); if (done) done(j); ok(j); }).then(() => { if (err && /reach the server/.test(err)) { const q = Q(); q.push({ b, at: Date.now() }); Qset(q); err = 'No connection: the score is saved on this phone and will be sent.'; paint(); } }));
  }

  function click(ev) {
    const t = ev.target.closest('button,a,[data-a]'); if (!t || t.disabled) return; const a = t.getAttribute('data-a'), id = t.getAttribute('data-id');
    if (a === 'close') { readDraft(); try { sessionStorage.removeItem('oevt-open'); } catch (x) {} clearInterval(POLL); el().remove(); return; }
    if (a === 'back') { readDraft(); err = ''; if (stack.length > 1) stack.pop(); const s = cur(); if (s.t === 'home') loadHome(); else if (s.t === 'event') load(s, true); paint(); return; }
    if (t.hasAttribute('data-tab')) { const s = cur(); s.tab = t.getAttribute('data-tab'); paint(); return; }
    if (t.hasAttribute('data-tg')) { readDraft(); const k = t.getAttribute('data-tg'); DR[k] = !DR[k]; paint(); return; }
    if (a === 'qclear') { Qset(Q().filter((x) => !x.fail)); paint(); return; }
    if (a === 'catalog') { if (window.oddCatalog) window.oddCatalog(); return; }
    if (a === 'joincode') { push({ t: 'joincode' }); return; }
    if (a === 'lookup') { const s = cur(); s.code = (document.getElementById('ecode') || {}).value || ''; openPreview(s.code); return; }
    if (a === 'claim') { const c = (document.getElementById('eclaim') || {}).value || ''; act('claim', { claim: c.trim() }, async (j) => { stack = [{ t: 'home' }]; loadHome(); push({ t: 'event', id: j.event.id, ev: j.event, tab: 'info' }); }); return; }
    if (a === 'dojoin') { const s = cur(); const as = t.getAttribute('data-as') || 'player'; act('join', { code: s.code, as, eid: t.getAttribute('data-eid') || undefined, gid: t.getAttribute('data-gid') || undefined, entryName: ((document.getElementById('enewname') || {}).value || '').trim() || undefined, rating: (document.getElementById('enewrt') || {}).value || undefined }, async (j) => { stack = [{ t: 'home' }]; loadHome(); push({ t: 'event', id: j.event.id, ev: j.event, tab: 'matches' }); }); return; }
    if (a === 'open') { const s = { t: 'event', id, tab: 'matches' }; push(s); load(s); return; }
    if (a === 'info') { const k = t.getAttribute('data-k'); push({ t: 'info', title: 'How ' + FMTN[k].toLowerCase() + ' works', text: INFO[k] }); return; }
    if (a === 'submit') { readDraft(); const p = payload(); if (p.title.length < 2) { err = 'Give the event a name (2+ characters).'; paint(); return; } act('create', p, async (j) => { DR = null; stack = [{ t: 'home' }]; loadHome(); push({ t: 'event', id: j.event.id, ev: j.event, tab: 'info' }); }); return; }
    const e = evOf(); if (!e) return;
    if (a === 'todo') { const s = cur(); s.tab = 'matches'; s.mf = 'todo'; paint(); return; }
    if (a === 'flags') { const s = cur(); s.tab = 'matches'; s.mf = 'flags'; paint(); return; }
    if (a === 'match') { push({ t: 'match', id: e.id, ev: e, m: t.getAttribute('data-m') }); return; }
    if (a === 'ent') { const s = cur(); s.tab = 'matches'; s.mf = 'all'; paint(); return; }
    if (a === 'draw') { if (!confirm('Make the draw now? Entries and rules lock for everyone.')) return; act('draw', { id: e.id }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'invite') { invite(e); return; }
    if (a === 'paid' || a === 'unpaid') { act('paid', { id: e.id, pid: t.getAttribute('data-pid'), paid: a === 'paid' }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'addent') { const v = (document.getElementById('eadd') || {}).value || '', m = /^(.*?)(?:[,;]\s*(\d+(?:\.\d+)?))?$/.exec(v.trim()); act('entrant', { id: e.id, do: 'add', name: m[1], rating: m[2] || '' }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'rment') { if (!confirm('Remove this entry?')) return; act('entrant', { id: e.id, do: 'remove', eid: t.getAttribute('data-eid') }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'delete') { if (!confirm('Delete this event for everyone?')) return; act('delete', { id: e.id }, async () => { stack = [{ t: 'home' }]; loadHome(); paint(); }); return; }
    if (a === 'leave') { if (!confirm('Leave this event?')) return; act('leave', { id: e.id }, async () => { stack = [{ t: 'home' }]; loadHome(); paint(); }); return; }
    if (a === 'finish') { if (!confirm('Finish the event now? Places are final.')) return; act('finish', { id: e.id }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'chal') { push({ t: 'chal', id: e.id, ev: e }); return; }
    if (a === 'tbreak') { const how = t.getAttribute('data-how'); if (!confirm(how === 'coin' ? 'Settle this tie with a coin flip? Oddable flips it now. It is final and logged.' : 'Settle this tie with a tiebreak playoff? The matches are added now. This cannot be switched to a coin flip later.')) return; act('tiebreak', { id: e.id, key: t.getAttribute('data-k'), how }, async (j) => { cur().ev = j.event; cur().tab = how === 'coin' ? 'table' : 'matches'; paint(); }); return; }
    if (a === 'plock') { if (!confirm('Lock picks for this round now? It cannot be undone.')) return; act('picklock', { id: e.id, round: t.getAttribute('data-k'), lock: true }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'plockat') { const inp = el().querySelector('input[data-plk="' + t.getAttribute('data-k') + '"]'), ms = inp && inp.value ? new Date(inp.value).getTime() : NaN; if (!(ms > Date.now())) { err = 'Pick a lock time in the future.'; paint(); return; } act('picklock', { id: e.id, round: t.getAttribute('data-k'), at: ms }, async (j) => { cur().ev = j.event; paint(); }); return; }
    const updAll = (j) => { stack.forEach((x) => { if (x.id === e.id) x.ev = j.event; }); };
    if (a === 'trate') { push({ t: 'trate', id: e.id, ev: e, gid: t.getAttribute('data-gid') }); return; }
    if (a === 'trsave' || a === 'trclear') { const s = cur(); s.v = (document.getElementById('etr') || {}).value; s.r = ((document.getElementById('etrr') || {}).value || '').trim(); if (s.r.length < 2) { err = 'Give a reason. It is logged and shown to the players.'; paint(); return; } act('trate', { id: e.id, gid: s.gid, rating: a === 'trclear' ? '' : s.v, reason: s.r }, async (j) => { updAll(j); stack.pop(); paint(); }); return; }
    if (a === 'partners') { const s = { t: 'partners', id: e.id, ev: e, mode: 'balanced' }; push(s); loadPartners(s); return; }
    if (t.hasAttribute('data-pm')) { const s = cur(); s.mode = t.getAttribute('data-pm'); paint(); loadPartners(s); return; }
    if (a === 'useteams') { const s = cur(), x = s.sug && s.sug.suggestions[+t.getAttribute('data-i')]; if (!x) return; if (!confirm('Use these teams?\n\n' + x.names.map((n) => n.join(' & ')).join('\n') + '\n\nYou can change them again until the event starts.')) return; act('teams', { id: e.id, teams: x.teams, mode: s.mode }, async (j) => { updAll(j); stack.pop(); cur().tab = 'info'; paint(); }); return; }
    if (a === 'dochal') { act('challenge', { id: e.id, a: t.getAttribute('data-a2'), b: t.getAttribute('data-b2') }, async (j) => { cur().ev = j.event; cur().tab = 'matches'; paint(); }); return; }
    if (a === 'sendchal') { const A = document.getElementById('cha').value, B = (document.getElementById('chb') || {}).value; act('challenge', { id: e.id, a: A, b: B, side: e.fmt !== 'ladder' && e.fmt !== 'h2h' }, async (j) => { stack.pop(); cur().ev = j.event; cur().tab = 'matches'; paint(); }); return; }
    if (a === 'pick') { const pm = e.matches.find((x) => x.id === t.getAttribute('data-m')), sd = t.getAttribute('data-side'); if (!confirm('Pick ' + (pm ? (sd === 'a' ? pm.an : pm.bn) : 'this side') + '?\n\nPicks lock the moment you make them. You cannot change it.')) return; act('pick', { id: e.id, m: t.getAttribute('data-m'), side: t.getAttribute('data-side') }, async (j) => { cur().ev = j.event; cur().keepScroll = true; paint(); cur().keepScroll = false; }); return; }
    if (a === 'tb') { const tv = Number((document.getElementById('etb') || {}).value); if (!Number.isInteger(tv) || tv < 0) { err = 'Type the total points you expect in the final.'; paint(); return; } if (!confirm('Lock in ' + tv + ' as your tiebreak guess? You cannot change it.')) return; act('pick', { id: e.id, tb: Number((document.getElementById('etb') || {}).value) }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'solo') { act('solo', { id: e.id, eid: document.getElementById('esoloe').value, score: Number(document.getElementById('esolov').value) }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'voice') { openVoice(e, t.getAttribute('data-k')); return; }
    const s = cur(), m = e.matches.find((x) => x.id === s.m); if (!m) return;
    const upd = async (j) => { stack.forEach((x) => { if (x.id === e.id) x.ev = j.event; }); paint(); };
    if (a === 'savescore') { const g = readGames(e.rules.bestOf); s.g = g; if (!g.length) { err = 'Type the game scores.'; paint(); return; } sendScore(e, m, g); return; }
    if (a === 'confirm') { act('confirm', { id: e.id, m: m.id, v: m.v, op: 'c' + Date.now().toString(36) }, upd); return; }
    if (a === 'dispute') { act('dispute', { id: e.id, m: m.id, v: m.v, note: (document.getElementById('enote') || {}).value || '' }, upd); return; }
    if (a === 'live') { act('live', { id: e.id, m: m.id }, upd); return; }
    if (a === 'accept' || a === 'decline') { act(a, { id: e.id, m: m.id }, upd); return; }
  }
  function change(ev) {
    const id = ev.target && ev.target.id; if (!id) return; const s = cur();
    if (id === 'emf') { s.mf = ev.target.value; paint(); return; }
    if (id === 'cha') { s.a = ev.target.value; paint(); return; }
    if (s.t === 'create' && /^f/.test(id) && ev.target.tagName === 'SELECT') { readDraft(); paint(); }
  }
  // ---------- invite (shared router pics/join.js when present; local fallback otherwise) ----------
  const link = (code) => location.origin + '/?join=e.' + encodeURIComponent(code);
  function invite(e) {
    const text = 'Join "' + e.title + '" (' + FMTN[e.fmt] + ', ' + SPORTN[e.sport] + ') on Oddable';
    if (window.OddJoin && typeof window.OddJoin.share === 'function') { try { window.OddJoin.share({ type: 'e', code: e.code, title: e.title, text }); return; } catch (x) {} }
    if (navigator.share) { navigator.share({ title: e.title, text, url: link(e.code) }).catch(() => {}); return; }
    const s = cur(); s.inv = 1; const x = el().querySelector('[data-a="invite"]'); if (!x) return;
    const box = document.createElement('div'); box.className = 'ecard'; box.innerHTML = '<small class="emut">Invite link</small><div class="ecopy"><code>' + esc(link(e.code)) + '</code></div><div class="e2"><button class="esec" data-a2="copy">Copy link</button><a class="epri" href="sms:?&body=' + encodeURIComponent(text + ': ' + link(e.code)) + '">Text it</a></div>';
    box.querySelector('[data-a2="copy"]').onclick = (ev2) => { ev2.stopPropagation(); try { navigator.clipboard.writeText(link(e.code)); ev2.target.textContent = 'Copied'; } catch (y) {} };
    x.insertAdjacentElement('afterend', box);
  }
  async function openPreview(code) {
    const s = { t: 'preview', code }; push(s);
    if (!tok()) { // signed out: the public peek shows only the title and kind; sign up / sign in, then the same link opens the join screen
      try { const j = await post('peek', { code }); s.peek = j; } catch (e) { err = errText(e); } paint(); return;
    }
    try { const j = await post('preview', { code }); s.ev = j.event; s.code = code; } catch (e) { err = errText(e); } paint();
  }
  // ---------- voice: "Log my score" (shared module pics/voicelog.js when present) ----------
  function openVoice(e, kind) {
    if (!window.VoiceLog) return; const s = cur(), m = kind === 'match' ? e.matches.find((x) => x.id === s.m) : null;
    // VoiceLog.open({target:'match', matchId, format, names}) (stats branch pics/voicelog.js): speech -> Claude -> confirmation card -> onSave -> the normal score route below
    try { window.VoiceLog.open(kind === 'match' ? { target: 'match', eventId: e.id, matchId: m.id, format: { to: e.rules.to, winBy: e.rules.winBy, bestOf: e.rules.bestOf, sport: e.sport }, names: [m.an, m.bn], players: { a: m.an, b: m.bn }, onSave: (data) => sendScore(e, m, data && data.games) } : { target: 'solo', eventId: e.id, unit: e.rules.unitLabel, players: e.entrants.filter((x) => e.myEntries.includes(x.eid) || e.role === 'comm').map((x) => ({ id: x.eid, name: x.name })) }); } catch (x) {}
  }
  function registerVoice() {
    if (!window.VoiceLog || typeof window.VoiceLog.registerTarget !== 'function' || window.__oevtVoice) return; window.__oevtVoice = 1;
    window.VoiceLog.registerTarget('match', {
      schema: { games: 'array of [scoreA, scoreB], one per game played, in order' },
      describe: (ctx) => 'Game scores for ' + ctx.players.a + ' against ' + ctx.players.b + ': ' + (ctx.format.to ? 'games to ' + ctx.format.to + ', win by ' + ctx.format.winBy : 'highest score wins') + ', best of ' + ctx.format.bestOf + '. First number = ' + ctx.players.a + '.',
      save: async (ctx, data) => { const evs = stack.map((x) => x.ev).filter(Boolean), e = evs.find((x) => x.id === ctx.eventId) || (await post('get', { id: ctx.eventId })).event, m = e.matches.find((x) => x.id === ctx.matchId); if (!m) throw new Error('Match not found'); const j = await post('score', { id: e.id, m: m.id, games: data.games, v: m.v, op: 'v' + Date.now().toString(36) }); stack.forEach((x) => { if (x.id === e.id) x.ev = j.event; }); if (cur().t === 'match') stack.pop(); paint(); return { ok: true, pending: j.event.matches.find((x) => x.id === m.id).state !== 'confirmed' }; },
    });
    window.VoiceLog.registerTarget('solo', { schema: { eid: 'entry id from players', score: 'number' }, describe: (ctx) => 'A ' + ctx.unit + ' score for one of: ' + ctx.players.map((p) => p.name).join(', '), save: async (ctx, data) => { const j = await post('solo', { id: ctx.eventId, eid: data.eid, score: data.score }); stack.forEach((x) => { if (x.id === ctx.eventId) x.ev = j.event; }); paint(); return { ok: true }; } });
  }

  // ---------- styles (shared with the sport catalog through window.OddEvents.css) ----------
  function css() {
    // "Render the Oddable look" (owner, Nov 16 2026): every colour comes from the live app's own variables (pics/index.html :root / body.dark / html.cb:
    // --bg --panel --panel2 --line --ink --muted --blue --green --red), so events and the catalog follow whichever theme the phone uses (navy default,
    // violet, light / dark). Shapes copy the app: .card (14px), .chips pills (999px), .nchips segmented controls (12px), .bbtn buttons (10px), .pill primary,
    // the purple / navy header gradient with 26px bottom corners, gold .botd highlight cards, .res / .res.hit / .res.miss result cards. No new palette.
    if (document.getElementById('oecss')) return; const st = document.createElement('style'); st.id = 'oecss'; const R = '.oo';
    st.textContent = R + '{--gbg:var(--bg,#0a0c10);--gp:var(--panel,#13161d);--gp2:var(--panel2,#1b1f29);--gl:var(--line,#272c38);--gi:var(--ink,#eef0f4);--gm:var(--muted,#8b93a3);--gv:var(--blue,#a78bfa);--gg:var(--green,#4fd18b);--gr:var(--red,#ff5a4d);--gy:#f5c542;--gyt:var(--gold,#d4a017);--hg:linear-gradient(135deg,#7c3aed 0%,#4c1d95 55%,#1b1f29 100%);--hs:#ede4ff;--pbg:var(--blue,#7c3aed);--pfg:var(--bg,#fff);--pbd:var(--blue,#7c3aed);position:fixed;inset:0;background:var(--gbg);color:var(--gi);overflow:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left}'
      + 'html.cb ' + R + '{--hg:linear-gradient(135deg,#003594 0%,#002b5c 38%,#041e42 74%,#08111f 100%);--hs:#c6cbd7;--pbg:#003594;--pfg:#fff;--pbd:#c6cbd7}'
      + 'html:not(.cb) body:not(.dark) ' + R + '{--gy:#b7791f;--gyt:#a16207;--pfg:#fff}' // navy (html.cb) is dark with the light switch on or off, like the app
      + '#oevt{z-index:97}#ocat{z-index:96}' + R + ' .ein0{max-width:720px;margin:0 auto;padding:0 16px calc(48px + env(safe-area-inset-bottom))}' + R + '.ebusy .epri{opacity:.6}' + R + ' *{box-sizing:border-box}'
      // header: the app's gradient header with rounded bottom corners (sticky back / close row inside it)
      + R + ' .ehead{margin:0 -16px 10px;padding:max(10px,env(safe-area-inset-top)) 16px 14px;background:var(--hg);border-radius:0 0 26px 26px;color:#fff}html.cb ' + R + ' .ehead{border-bottom:3px solid #869397}'
      + R + ' .ehead h1{color:#fff}' + R + ' .ehead .emeta,' + R + ' .ehead .esub{color:var(--hs)}' + R + ' .ehead .eback,' + R + ' .ehead .ex{color:#fff}'
      + R + ' h1{font-size:28px;line-height:1.15;margin:8px 0 2px;overflow-wrap:anywhere;color:var(--gi)}' + R + ' h2{font-size:17px;margin:0 0 10px}' + R + ' .esub{color:var(--gm);margin:2px 0 0;font-size:13px}'
      + R + ' .etop{display:flex;justify-content:space-between;align-items:center}'
      + R + ' button,' + R + ' a.epri{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}'
      + R + ' .eback,' + R + ' .ex,' + R + ' .einfo{background:none;border:0;color:var(--gv);font-weight:700;min-height:44px;padding:0 4px;text-align:left}' + R + ' .ex{opacity:.85}' + R + ' .einfo{display:block;width:100%}'
      // buttons: primary = the app's .pill, secondary = .bbtn button
      + R + ' .epri,' + R + ' .esec,' + R + ' .edanger,' + R + ' .evoice{min-height:44px;font:700 15px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:10px 14px;text-decoration:none;display:flex;align-items:center;justify-content:center;text-align:center;overflow-wrap:anywhere}'
      + R + ' .epri{background:var(--pbg);border:1px solid var(--pbd);color:var(--pfg);border-radius:999px}' + R + ' .esec{background:var(--gp2);border:1px solid var(--gl);color:var(--gi);border-radius:10px;font-weight:600}' + R + ' .esec.on{border:2px solid var(--gv);font-weight:800}' + R + ' .edanger{background:none;border:1px solid var(--gr);color:var(--gr);border-radius:10px}'
      + R + ' .evoice{background:var(--gp2);border:1px solid var(--gg);color:var(--gi);border-radius:999px;font-size:17px;min-height:52px}' + R + ' .efull{width:100%;margin:10px 0}' + R + ' button:disabled{opacity:.5;cursor:not-allowed}'
      + R + ' .e2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0}' + R + ' .e3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0}'
      + R + ' .eh{font:800 13px/1.3 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--gm);margin:18px 4px 6px}'
      // cards = .card; gold highlight = .botd (Oddable Alert / Bet of the Day look)
      + R + ' .ecard{background:var(--gp);border:1px solid var(--gl);border-radius:14px;padding:12px 14px;margin:8px 0;display:block;width:100%;text-align:left;color:var(--gi)}' + R + ' .ebtn{color:inherit}'
      + R + ' .ecard.egoldc,' + R + ' .ematch.act,' + R + ' .egold2{border:2px solid var(--gy);background:linear-gradient(135deg,rgba(245,197,66,.22),rgba(255,226,140,.08));box-shadow:0 0 18px rgba(245,197,66,.35)}' + R + ' .ecard.esoon{border-style:dashed}'
      + R + ' .erow{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}' + R + ' .ename{font-size:18px;overflow-wrap:anywhere;flex:1;min-width:0}'
      // badges = the app's .chips pills
      + R + ' .ebadge{display:inline-block;border:1px solid var(--gl);background:var(--gp);color:var(--gm);border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700;white-space:nowrap}' + R + ' .ebadge.ey{color:var(--gyt);border-color:var(--gold,var(--gy))}' + R + ' .ebadge.eg{color:var(--gg);border-color:var(--gg)}' + R + ' .ebadge.ep{color:var(--gm)}' + R + ' .ebadge.ev{color:var(--gi);border-color:var(--gv);background:var(--gp2)}'
      + R + ' .emeta{color:var(--gm);margin:2px 0}' + R + ' .emut{color:var(--gm)}' + R + ' .enote{color:var(--gm);font-size:13px;margin:8px 2px}' + R + ' .eyel{color:var(--gyt)}' + R + ' .epos{color:var(--gg)}' + R + ' .eneg{color:var(--gr)}' + R + ' .egold{color:var(--gyt)}'
      // summary tiles = the app's .nchips buttons (number on top of a label)
      + R + ' .etile{background:var(--gp);border:1px solid var(--gl);border-radius:12px;padding:8px 10px;text-align:left;min-height:64px;display:block;width:100%;min-width:0;color:var(--gi)}' + R + ' .etile small{display:block;color:var(--gm);font-size:12px;font-weight:600}' + R + ' .etile b{display:block;font-size:18px;line-height:1.2;overflow-wrap:anywhere}' + R + ' .etile i{display:block;font-style:normal;color:var(--gm);font-size:12px;margin-top:2px;overflow-wrap:anywhere}'
      + R + ' .elab{display:block;color:var(--gm);font-size:13px;font-weight:600;margin:10px 0 4px;min-width:0}' + R + ' .elab .ein,' + R + ' .elab .esel{margin-top:6px}'
      + R + ' .ein,' + R + ' .esel{width:100%;min-width:0;min-height:44px;background:var(--gp);border:1px solid var(--gl);border-radius:12px;color:var(--gi);font:600 15px system-ui,sans-serif;padding:9px 12px}body.dark ' + R + ' .ein,body.dark ' + R + ' .esel,html.cb ' + R + ' .ein,html.cb ' + R + ' .esel{color-scheme:dark}' + R + ' .eta{min-height:110px;resize:vertical;font-weight:500}' + R + ' .efix{display:flex;align-items:center;color:var(--gm)}' + R + ' .ecodein{text-transform:uppercase;letter-spacing:.15em;font-size:20px}' + R + ' .enum{text-align:right;min-height:50px;font-size:20px}'
      // segmented controls = .nchips (tabs) / .chips (choices)
      + R + ' .eseg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:8px;margin:8px 0}' + R + ' .eseg button{min-height:44px;border-radius:12px;border:1px solid var(--gl);background:var(--gp);color:var(--gi);font-weight:600;font-size:14px;padding:6px}' + R + ' .eseg button.on{border-color:var(--gv);background:var(--gp2);font-weight:800}' + R + ' .eseg.etabs{position:sticky;top:0;z-index:2;background:var(--gbg);padding:6px 0;margin:4px 0}'
      + R + ' .eline{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:48px;padding:4px 0}' + R + ' .eline small{display:block;color:var(--gm);font-size:12.5px}'
      + R + ' .esw{flex:0 0 auto;width:60px;height:44px;border:0;background:none;position:relative;padding:0}' + R + ' .esw::before{content:"";position:absolute;left:1px;right:1px;top:6px;bottom:6px;border-radius:999px;border:1px solid var(--gl);background:var(--gp2)}' + R + ' .esw i{position:absolute;top:10px;left:6px;width:24px;height:24px;border-radius:50%;background:var(--gm);transition:left .15s}' + R + ' .esw.on::before{background:var(--pbg);border-color:var(--pbd)}' + R + ' .esw.on i{left:30px;background:#fff}'
      + R + ' .ewarn{border:2px solid var(--gy);border-radius:14px;padding:10px 14px;margin:10px 0;background:linear-gradient(135deg,rgba(245,197,66,.18),rgba(255,226,140,.06));color:var(--gi)}' + R + ' .ewarn b{display:block;color:var(--gyt);font-size:15px;margin-bottom:2px}'
      + R + ' .eerr{border:1px solid var(--gr);background:#d93a2e14;color:var(--gi);border-radius:10px;padding:9px 12px;margin:8px 0}'
      // match rows = the app's .res result cards (.res.hit won / .res.miss lost, for your own matches)
      + R + ' .ematch{display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;background:var(--gp);border:1px solid var(--gl);border-radius:10px;padding:9px 12px;margin:6px 0;min-height:60px;color:var(--gi)}' + R + ' .ematch.mine{border-color:var(--gv)}' + R + ' .ematch.hit{border-color:var(--gg);background:#16915a14}' + R + ' .ematch.miss{border-color:var(--gr);background:#d93a2e14}'
      + R + ' .emw{min-width:0;display:flex;flex-direction:column}' + R + ' .emw small{color:var(--gm);font-size:12px}' + R + ' .emw span{overflow-wrap:anywhere;font-weight:600}' + R + ' .ewin{color:var(--gg)}' + R + ' .er{text-align:right;justify-self:end}' + R + ' .ematch .er{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:0 0 auto;max-width:48%}'
      + R + ' .epill{border:1px solid var(--gl);border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;text-align:right;color:var(--gm)}' + R + ' .epill.eok{border-color:var(--gg);color:var(--gg)}' + R + ' .epill.ebad{border-color:var(--gr);color:var(--gr)}' + R + ' .epill.ewait{border-color:var(--gold,var(--gy));color:var(--gyt)}'
      + R + ' .ethead,' + R + ' .etrow{display:grid;grid-template-columns:34px minmax(0,1fr) 80px;gap:8px;align-items:center}' + R + ' .ethead.e5,' + R + ' .etrow.e5{grid-template-columns:34px minmax(0,1fr) 58px 58px}' + R + ' .ethead.e4,' + R + ' .etrow.e4{grid-template-columns:34px minmax(0,1fr) 112px}' + R + ' .etrow.e1{grid-template-columns:minmax(0,1fr)}' + R + ' .ethead.e3c,' + R + ' .etrow.e3c{grid-template-columns:72px minmax(0,1fr) minmax(0,1fr)}'
      + R + ' .ethead{color:var(--gm);font-size:12px;font-weight:700;padding:6px 12px 2px}' + R + ' .etrow{width:100%;text-align:left;background:var(--gp);border:1px solid var(--gl);border-radius:14px;padding:8px 12px;margin:4px 0;min-height:48px;color:var(--gi)}' + R + ' .etrow b{display:block;overflow-wrap:anywhere}' + R + ' .etrow small{display:block;color:var(--gm);font-size:12px}' + R + ' .ecard .etrow{background:var(--gp2)}' + R + ' .ethead .er{text-align:right}'
      + R + ' .erules>div{display:flex;flex-direction:column;padding:6px 0;border-bottom:1px solid var(--gl)}' + R + ' .erules>div:last-child{border-bottom:0}' + R + ' .erules small{color:var(--gm);font-size:12px}' + R + ' .erules span{overflow-wrap:anywhere}'
      + R + ' .ekv{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--gl)}' + R + ' .ekv:last-child{border-bottom:0}' + R + ' .ekv span{min-width:0}' + R + ' .ekv small{display:block;color:var(--gm);font-size:12px}' + R + ' .ekv b{text-align:right;white-space:nowrap}'
      + R + ' .emrow{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:48px;border-bottom:1px solid var(--gl);padding:6px 0}' + R + ' .emrow:last-child{border-bottom:0}' + R + ' .emrow>span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}' + R + ' .emrow small{display:block;color:var(--gm);font-size:12px}' + R + ' .emrow i{font-style:normal}'
      + R + ' .emrow small.eplr{margin-top:5px;font-size:13px}' + R + ' .erate{color:var(--gi);font-weight:600}' + R + ' .emrow .ebadge{padding:2px 8px;font-size:11px}' + R + ' .erbtn{display:block;margin:6px 0 4px;font-size:13px}'
      + R + ' .etiny{background:var(--gp2);border:1px solid var(--gl);border-radius:10px;color:var(--gi);min-height:44px;min-width:64px;padding:0 10px;font-weight:600}' + R + ' .ecopy code{font-size:13px;overflow-wrap:anywhere;word-break:break-all;color:var(--gi)}' + R + ' .eaud{padding:6px 0;border-bottom:1px solid var(--gl);overflow-wrap:anywhere}' + R + ' .eaud:last-child{border-bottom:0}' + R + ' .eaud small{display:block;color:var(--gm);font-size:12px}'
      + R + ' .eib{width:44px;height:44px;border:0;background:none;color:var(--gv);font-size:20px;flex:0 0 auto}' + R + ' .egame{display:flex;flex-direction:column;gap:4px;text-align:left;color:inherit}' + R + ' .egame b{font-size:16px}'
      + '@media (max-width:360px){' + R + ' .e3{grid-template-columns:1fr 1fr}}';
    document.head.appendChild(st);
  }
  // The header part of a screen (its h1 and the line under it) goes into the app's gradient header, with the Back / Close row.
  function withHead(topHtml, body) { const m = /^(<h1>[\s\S]*?<\/h1>(?:<(div|p) class="e(?:meta|sub)">[^<]*(?:<[^d/][^>]*>[^<]*<\/[^>]+>[^<]*)*<\/\2>)?)/.exec(body); return '<div class="ehead">' + topHtml + (m ? m[1] : '') + '</div>' + (m ? body.slice(m[1].length) : body); }
  function mount() { css(); let x = el(); if (x) x.remove(); x = document.createElement('div'); x.id = 'oevt'; x.className = 'oo'; x.setAttribute('role', 'dialog'); x.setAttribute('aria-label', 'Events'); x.innerHTML = '<div class="ein0"></div>'; document.body.appendChild(x); x.style.zIndex = String(1 + Math.max(95, ...Array.from(document.querySelectorAll('#ogrp,#oevt,#ocat,#odash')).filter((y) => y !== x).map((y) => +getComputedStyle(y).zIndex || 0))); x.addEventListener('click', click); x.addEventListener('change', change); try { sessionStorage.setItem('oevt-open', '1'); } catch (y) {} registerVoice(); poll(); return x; }
  window.OddEvents = {
    INFO, css, esc, att, head: withHead,
    open: () => { mount(); stack = [{ t: 'home' }]; err = ''; paint(); loadHome(); flush(); },
    create: (o) => { mount(); stack = [{ t: 'home' }]; err = ''; DR = draftNew(o); stack.push({ t: 'create' }); paint(); loadHome(); },
    join: (code) => { mount(); stack = [{ t: 'home' }]; err = ''; paint(); if (tok()) loadHome(); else H = { events: [] }; openPreview(code); },
  };
  window.oddEvents = window.OddEvents.open;
  // Shared invite router (pics/join.js, Groups branch): ?join=e.<code> -> this preview. Without the router, read the link here (signed-in phones only).
  function hookJoin() {
    if (window.OddJoin && typeof window.OddJoin.register === 'function') { window.OddJoin.register('e', (code) => window.OddEvents.join(code)); return true; }
    return false;
  }
  if (!hookJoin()) { setTimeout(() => { if (hookJoin()) return; const m = /[?&]join=e\.([A-Za-z0-9-]{8,10})/.exec(location.search); if (m && tok()) { window.OddEvents.join(m[1]); try { const u = new URL(location.href); u.searchParams.delete('join'); history.replaceState(null, '', u.toString()); } catch (x) {} } }, 1200); }
  try { if (sessionStorage.getItem('oevt-open') === '1') setTimeout(() => { if (!el() && tok()) window.OddEvents.open(); }, 1500); } catch (e) {}
})();
