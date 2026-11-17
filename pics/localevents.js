// MAIN-LINE PORT (Nov 17 2026, branch feat/pickleball-group-game-on-main): the side branch local-v1's pics/events.js (11087cd), renamed localevents.js
// (main has its own odds-api/events.js). Talks to POST /levents/<op>. Loaded by index.html ONLY for an account the server says it is on for (me.levents,
// kept in 'odd-lev'), right after groups.js. Registers the group game "Pickleball & local games" with OddGroups.addGame (key 'pickleball'); a group's
// card opens OddEvents.openFromGroup(groupId, group). Games are created from a group by its commissioner only (the server refuses others); the catalog page
// of the side branch is NOT ported (the "how it works" text lives here: infoFor / the ⓘ buttons). The overlay sits beside the tab bar like Groups (fit()).
// Oddable LOCAL EVENTS (v1, Nov 16 2026). Full-screen overlay #oevt (same pattern as groups.js / dash.js), z-index 97 (above Groups 95, the sport catalog 96
// and the My Bets banner 40). Every rule, score, standing and money figure comes from the server (odds-api/events.js); this file only shows them.
// Money is information only: Oddable never collects, holds or pays money. Opened from Groups ("My events"), the sport catalog, or a shared link ?join=e.<code>.
(function () {
  const API = (window.ODD_GROUPS_API || 'https://calcutta-odds.onrender.com') + '/levents/';
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
  const SEEDN = { rating: 'By rating (typed in, e.g. 3.5 skill level)', oddable: 'By Oddable rating (unofficial; typed rating if none)', random: 'Random draw', manual: 'As I list them' };
  // H1 (owner Nov 16 2026): in pickleball the Oddable rating from app play IS the rating, so there is one "by rating" choice and it means that
  const seedOpts = (sport) => (sport === 'pickleball' ? [['rating', 'By Oddable rating (from app play)'], ['random', 'Random draw'], ['manual', 'As I list them']] : Object.keys(SEEDN).map((k) => [k, SEEDN[k]]));
  const seedName = (e) => (e.sport === 'pickleball' && (e.rules.seeding === 'rating' || e.rules.seeding === 'oddable') ? 'By Oddable rating (from app play); a player with no games yet counts as 1500' : SEEDN[e.rules.seeding]);
  const ODDNOTE = 'Oddable rating: built from the games you play in the app that the other side confirmed (Elo method, new players start at 1500). Games against typed-in players, results the commissioner made final and forfeits are kept as records but do not move it. Unofficial: it is Oddable\'s own number, not an official rating from any rating body.';
  // E-H + addendum (owner Nov 16 2026): a director's tournament rating never hides the real-results Oddable rating
  // "x of y games confirmed" goes next to every rating: only games confirmed by an account on the other side move it
  const confTxt = (o) => (o && o.matches ? (o.confirmed || 0) + ' of ' + o.matches + ' game' + (o.matches === 1 ? '' : 's') + ' confirmed' : 'no games yet');
  const oddTxt = (o) => (!o || !o.matches ? 'Oddable: no games yet' : o.rating == null ? 'Oddable: no confirmed games yet (' + confTxt(o) + '; seeded as a new player, 1500)' : 'Oddable ' + o.rating + ' (real results, ' + confTxt(o) + ')');
  const needTxt = (p) => 'Oddable: no rating to use yet (' + (p.why || 'needs games confirmed by 3 different players') + (p.odd && p.odd.matches ? '; ' + confTxt(p.odd) : '') + '); seeded as a new player, 1500, unless the organizer sets the seed';
  const rateLine = (p) => (p.ap ? (p.ap.shown ? p.ap.shown : (p.odd && p.odd.rating != null ? 'Oddable ' + p.odd.rating + ' (real results, ' + confTxt(p.odd) + ')' : 'Oddable: no games yet') + ' · not approved by the organizer yet')
    : (p.needsSet && !p.trn ? needTxt(p) : oddTxt(p.odd)) + (p.trn ? ' · Tournament ' + p.trn.v + ', set by director' : '')); // fourth review H2: "1520 approved by Ann · Oddable 1520 (real results)"
  const PMODES = [['balanced', 'Balanced', 'Team ratings as close as possible, so matches are fair.'], ['rotate', 'Rotate', 'Partners who have not played together lately.'], ['hot', 'Hot pairs', 'The best records together, from lifetime results.']];
  const SPLITN = { '100': 'Winner takes all', '60/30/10': '60 / 30 / 10', '50/30/20': '50 / 30 / 20', '70/30': '70 / 30', none: 'No prizes' };
  const MONEY = 'Money is settled outside the app. The commissioner collects entries and pays winners; Oddable only shows who is owed what. Oddable never collects, holds or pays money.';
  const CAPLINE = 'Up to 8 people per game. Clubs, courses and leagues: contact Oddable for a license.';
  const ENTTEXT = 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.'; // same text as the server (limits.ENTERPRISE_TEXT); the server copy wins (e.entText)
  // Plain-language explanations, accurate for the sport and the rules in force (also used by the sport catalog through window.OddEvents.infoFor / INFO).
  const infoFor = (k, sport, rules) => {
    const P = sport === 'pickleball', pt = sport === 'tennis' ? 'game' : 'point', r = rules || {};
    const T = {
      rr: 'Everyone plays everyone once. Odd numbers get a bye each round (one sits out, each entry once). Matches fill the courts round by round. Standings follow ' + (P ? 'the pickleball rulebook order' : 'one order for every sport in Oddable') + ': most wins, then head-to-head among the tied, ' + pt + ' differential, head-to-head ' + pt + ' differential, then ' + pt + ' differential against the next-highest entry. A tie nothing breaks is a shared place, unless it decides a prize or a playoff spot: then the organizer settles it with a coin flip (the default) or a playoff (a house rule, order drawn at random), and the choice is logged. The seed never breaks a tie. With more than one pool, entries that finish in the same position in different pools share the place. Optional playoff: the top 2, 4, 8 or 16 go to a single-elimination bracket. The organizer taps Finish once every score is right (it also finishes by itself 12 hours after the last result).',
      se: 'Lose once and you are out. Seeds come from ' + (P ? 'the Oddable rating (built from confirmed games played in the app; unofficial), a random draw, or your own order' : 'the typed rating, the Oddable rating (unofficial, from confirmed games in the app), a random draw, or your own order') + '; top seeds get byes when the count is not a power of two. Winners move on until one is left.',
      de: 'You are out after two losses. A first loss drops you to the losers bracket. Its winner meets the winners-bracket champion in the final; if the losers-bracket side wins that, a second final decides it (bracket reset) because both now have one loss. ' + (P && r.reset !== 'match' ? 'The reset is one game to 15, win by 2 (pickleball rulebook)' + (rules ? '.' : '; the organizer can choose a full match instead.') : 'The reset is a full match under the normal rules of the event.'),
      ladder: 'Everyone starts on a ranked ladder. Challenge anyone up to N spots above you; a challenge must be played within the set days. Win and you take the higher spot (swap places, or move in and push the rest down one). A challenge not played in time is a forfeit win for the challenger, or is cancelled, as the commissioner set.',
      h2h: 'Pair against pair or player against player, best of 1, 3 or 5 ' + (sport === 'tennis' ? 'sets' : 'games') + '. Challenge someone, they accept, you play, the scorer enters it and the other side confirms. Records and ' + pt + ' differential build up over the event.',
      pickem: "Spectators (and players) pick the winner of every match before its round starts. Players cannot pick their own matches. Picks are final when you enter them (saved and time-stamped by Oddable). A round closes for picking at the closing time the commissioner set, when the commissioner closes it, or the moment its first match starts or gets a score, whichever comes first. Most correct picks wins (or later rounds count more, the final the most, if the commissioner chose that); the tiebreak is the closest guess of the final's total points.",
      solo: 'A drill or skills game with a number: serves in, free throws made, a putting contest, a bowling series. Each player enters their own score (the commissioner can enter it for anyone). Highest wins, or lowest if the commissioner said so. Works with one player for practice.',
      scoring: 'Scores are typed in by the match’s designated scorer, and the other side confirms them. A disputed score goes to the commissioner, who decides. Every entry, confirmation, dispute and correction is in the event history.' + (P || r.seeding === 'oddable' ? ' Only a result confirmed by an account on the other side counts toward the Oddable rating: results against typed-in players, results the commissioner made final, forfeits, more than 2 matches in 24 hours against the same opponents, and matches in an event with fewer than 3 accounts with confirmed play do not.' : ''),
      invite: 'Every game has its own invite link. Anyone who opens it signs up for Oddable if they are new, then lands on this game to join.',
    };
    return T[k] || '';
  };
  const INFO = {}; ['rr', 'se', 'de', 'ladder', 'h2h', 'pickem', 'solo', 'scoring', 'invite'].forEach((k) => { INFO[k] = infoFor(k, 'pickleball'); }); // pickleball wording; other sports ask infoFor(k, sport)
  let stack = [{ t: 'home' }], H = null, busy = false, err = '', DR = null, POLL = null;
  const tok = () => ls('odd-tok') || '';
  // a random id for this phone, sent only with the signed-out invite preview so its limit is counted per phone, not per Wi-Fi
  const dev = () => { let d = ls('oevt-dev'); if (!d || !/^[A-Za-z0-9_-]{8,40}$/.test(d)) { d = Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8); ls('oevt-dev', d); } return d; };

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
  const gameRule = (r, sport) => (r.tset ? 'Sets to ' + r.to + ', win by 2, tiebreak at ' + r.to + '-' + r.to + ' (' + (r.to + 1) + '-' + r.to + ')' : r.to && r.winBy === 1 ? 'Games to ' + r.to + ' (going over is fine)' : r.to ? 'Games to ' + r.to + ', win by ' + r.winBy : 'Highest score wins each game') + (r.bestOf > 1 ? ', best of ' + r.bestOf : '') + (sport === 'pickleball' ? ' · ' + (r.scoring === 'rally' ? 'rally' : 'side-out') + ' scoring (a label for the players; the app does not count rallies)' : '');
  const scoreTxt = (m, games) => (games || m.games || []).map(([x, y]) => x + '-' + y).join(', ');
  const stateTxt = { wait: 'Waiting for earlier results', ready: 'To play', pending: 'Waiting for confirmation', confirmed: 'Final', disputed: 'Disputed: commissioner decides', bye: 'Bye', void: 'Not played', offered: 'Challenge waiting for an answer' };
  function rulesList(e) {
    const r = e.rules, rows = [['Format', FMTN[e.fmt] + (e.rules.pickem ? " with bracket pick'em for spectators" : '')], ['Sport', SPORTN[e.sport] + (e.fmt !== 'solo' ? ' · ' + UNITN[r.unit] : '')], ['Starts', fmtTime(e.start) + ' (rules are final then)']];
    if (e.endDay) rows.push(['Last day', fmtDay(e.endDay)]);
    if (e.fmt !== 'solo') rows.push(['Games', gameRule(r, e.sport)], ['Seeding', seedName(e) + (e.seedSet ? ' · seeds set by hand by the organizer' : '')], ['Courts', String(r.courts)], ['Who enters scores', r.scorer === 'comm' ? 'The commissioner' : r.scorer === 'either' ? 'Either side, the other confirms' : 'The first-listed side, the other confirms']);
    else rows.push(['Scores', (r.low ? 'Lowest' : 'Highest') + ' ' + r.unitLabel + ' wins']);
    if (e.fmt === 'rr') rows.push(['Pools', String(r.pools)], ['Playoff', r.playoff ? 'Top ' + r.playoff + ', single elimination' : 'None'], ['Tiebreaks', 'Wins, head-to-head among the tied, ' + (e.sport === 'tennis' ? 'game' : 'point') + ' differential, head-to-head differential, differential against the next entry. Still level: a shared place, or, for a prize or a playoff spot, the organizer\'s coin flip (default) or playoff (house rule). Never the seed'], ['Finish', 'The organizer taps Finish (or 12 hours after the last result)']);
    if (e.fmt === 'de') rows.push(['Bracket reset', r.reset === 'game15' ? 'One game to 15, win by 2 (pickleball rulebook)' : 'A full match, same rules']);
    if (e.fmt === 'ladder') rows.push(['Challenges', 'Up to ' + r.reach + ' spot' + (r.reach > 1 ? 's' : '') + ' above, play within ' + r.expDays + ' days, else ' + (r.expire === 'void' ? 'cancelled' : 'challenger wins by forfeit')], ['Winner moves', r.move === 'swap' ? 'Swap places' : 'Take the spot, the rest move down one']);
    if (r.pickem) rows.push(["Pick'em", 'Pick each match before it starts (not your own matches); ' + (r.weight === 'round' ? 'later rounds are worth more, the final the most' : '1 point per right pick') + "; tiebreak: the final's total points"]);
    if (e.money) rows.push(['Entry', e.money.entry ? usd(e.money.entry) + ' per player' : 'No entry'], ['Pot', e.money.pot === 'side' ? 'Side pot' : 'Main pot'], ['Payout split', SPLITN[e.money.split]], ["Commissioner's take", e.takeText], ['Joining', (e.join.self ? 'Players can add themselves' : 'The commissioner adds the players') + (e.join.spectators ? ', spectators welcome' : '')]);
    return '<div class="erules">' + rows.map(([k, v]) => '<div><small>' + esc(k) + '</small><span>' + esc(v) + '</span></div>').join('') + '</div>';
  }

  // ---------- screens ----------
  function home() {
    let h = '<h1>My events</h1><p class="esub">Games you run yourselves: pickleball, tennis nights, cornhole, darts, bowling. Scores are entered on court.</p><div class="ecard emut">To start a game, open your group: Groups, your group, Games, Pickleball &amp; local games (the group\'s commissioner starts it).</div><div class="e2"><button class="esec" data-a="joincode">Join with a code</button></div>';
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
  // Review H1: a person who is not in the event's group (a brand-new player who signed up from the event link, say). The box comes FIRST, with "Ask to join <group>"
  // (Groups' own POST /groups/request: the commissioner approves; the group's code and members are never sent here). The event code is kept on the phone
  // ('oevt-gwait') and, once the person is in the group, the event reopens by itself (next app open, or "Check again").
  function groupAskV(e) {
    const ga = e.groupAsk, nm = ga && ga.name ? esc(ga.name) : 'the group', st = ga ? ga.state : '';
    let h = '<div class="ewarn" id="egask" role="status"><b>This event belongs to a group</b>';
    if (st === 'ask') h += 'It is for the members of ' + nm + '. Ask to join the group: the commissioner approves who joins. Once you are in, this event opens here again.<button class="epri efull" data-a="gask">Ask to join ' + nm + '</button>';
    else if (st === 'pending') h += 'Your request to join ' + nm + ' is with the commissioner. Once you are in, this event opens here again.<button class="esec efull" data-a="gcheck">Check again</button>';
    else if (st === 'closed') h += nm + ' is not taking requests right now. Ask the person who sent you the link to have the commissioner invite you to the group.';
    else if (st === 'late') h += 'Joining ' + nm + ' has closed (the group has started), so this event cannot be joined.';
    else if (st === 'full') h += nm + ' is full, so there is no room to join it or this event.';
    else if (st === 'no') h += 'The commissioner of ' + nm + ' did not let you into the group, so this event cannot be joined.';
    else h += 'It is for the group\'s members. Join the group first, then open the event from the group.';
    return h + '</div>';
  }
  const GAPI = (window.ODD_GROUPS_API || 'https://calcutta-odds.onrender.com') + '/groups/';
  const gwait = (v) => { if (v === undefined) { try { const w = JSON.parse(ls('oevt-gwait') || 'null'); return w && /^[A-Z2-9-]{4,40}$/i.test(String(w.code || '')) && Date.now() - Number(w.at || 0) < 30 * 864e5 ? w : null; } catch (x) { return null; } } ls('oevt-gwait', v ? JSON.stringify(v) : null); return null; };
  async function groupAskSend(s) {
    const e = s.ev; if (!e || !e.group || !e.groupAsk || busy) return; busy = true; err = ''; paintBusy(true);
    try { const r = await fetch(GAPI + 'request', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': tok() }, body: JSON.stringify({ id: e.group.id, myName: ls('odd-name') || '' }) }); const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || 'Server said ' + r.status), { status: r.status });
      e.groupAsk.state = 'pending'; gwait({ code: s.code, at: Date.now() }); } catch (x) { err = errText(x); }
    busy = false; paintBusy(false); paint();
  }
  // -> true when the event was reopened (the person is in the group now). quiet = at app open: nothing shown unless it reopens.
  async function groupWaitCheck(quiet) {
    const w = gwait(); if (!w || !tok()) return false; let j; try { j = await post('preview', { code: w.code }); } catch (x) { if (x && (x.status === 404 || x.status === 403)) gwait(null); if (!quiet) { err = errText(x); paint(); } return false; }
    const e = j && j.event; if (!e) return false;
    if (!e.groupOnly) { gwait(null); window.OddEvents.join(w.code); return true; }
    const st = e.groupAsk && e.groupAsk.state; if (st !== 'pending' && st !== 'ask') gwait(null);
    if (!quiet) { const s = cur(); if (s && s.t === 'preview') { s.ev = e; err = st === 'pending' ? 'Still waiting for the commissioner to let you into the group.' : ''; paint(); } }
    return false;
  }
  function previewV() {
    const s = cur(), e = s.ev;
    if (!e && s.peek) return '<h1>' + esc(s.peek.title) + '</h1><div class="emeta">' + esc(s.peek.kind) + '</div><div class="ecard">You were invited to this game. Sign up for Oddable (or sign in), then open the invite link again to join.</div>';
    if (!e) return s.fail ? '<h1>Event</h1><div class="ecard emut">This event could not be opened from the group.</div>' : '<div class="ecard">Loading…</div>';
    if (e.role && e.role !== 'none') return '<h1>' + esc(e.title) + '</h1><button class="epri efull" data-a="open" data-id="' + att(e.id) + '">You are in this event. Open it ›</button>';
    if (e.groupOnly) return groupAskV(e) + '<h1>' + esc(e.title) + '</h1><div class="emeta">' + fmtLine(e) + '</div><div class="ecard">' + rulesList(e) + '</div>'; // review H1: the way in comes first. Re-check: a stranger's preview has no money, people or commissioner name (rulesList skips what is not sent)
    let h = '<h1>' + esc(e.title) + '</h1><div class="emeta">' + fmtLine(e) + ' · run by ' + esc(e.commName) + '</div>' + (s.gj ? '<div class="enote">This event is on your group. Members of the group can join it here.</div>' : '') + '<div class="ecard">' + rulesList(e) + '</div>';
    h += '<div class="enote">' + e.people + ' of ' + e.cap + ' people so far. ' + esc(MONEY) + '</div>';
    const open = (e.open || []).filter((x) => x.open > 0);
    if (!e.locked) {
      h += '<h3 class="eh">Join as a player</h3>';
      if (!e.join.self) h += '<div class="enote">The commissioner adds the players in this event. If you were added by name, ask the commissioner for your claim code and enter it under Join with a code.</div>';
      open.forEach((x) => x.seats.forEach((st) => { h += '<button class="esec efull" data-a="dojoin" data-eid="' + att(x.eid) + '" data-gid="' + att(st.gid) + '">Take the open partner spot: ' + esc(x.name) + '</button>'; }));
      if (e.join.self) h += '<div class="enote">Added by name by the commissioner? Use your claim code (Join with a code) to take your spot.</div>';
      if (e.join.self) h += '<label class="elab">' + (e.rules.unit === 'singles' ? 'Or join as a new player' : 'Or enter a new ' + (e.rules.unit === 'teams' ? 'team' : 'pair') + ' (your partner joins with the same link)') + '<input id="enewname" class="ein" maxlength="40" placeholder="' + (e.rules.unit === 'singles' ? 'Your name' : 'Team name') + '"></label><label class="elab">Your rating (optional, e.g. 3.5 skill level)<input id="enewrt" class="ein" type="number" inputmode="decimal" step="0.01" min="0"></label><button class="epri efull" data-a="dojoin">Join as a player</button>';
    } else h += '<div class="ewarn"><b>Entries are closed</b>The event has started.</div>';
    if (e.join.spectators) h += '<button class="esec efull" data-a="dojoin" data-as="spectator">' + (e.rules.pickem ? "Join to watch and play pick'em" : 'Join to watch') + '</button>';
    return h;
  }
  // ---- create ----
  function draftNew(o) {
    const sport = (o && o.sport) || 'pickleball', fmt = (o && o.fmt) || 'rr', d = new Date(Date.now() + 2 * 864e5); d.setHours(9, 0, 0, 0);
    const local = (t) => { const z = new Date(t - new Date(t).getTimezoneOffset() * 6e4); return z.toISOString().slice(0, 16); };
    return { title: '', sport, fmt, unit: sport === 'pickleball' || sport === 'tennis' ? 'doubles' : sport === 'basketball' ? 'teams' : 'singles', to: sport === 'pickleball' ? 11 : sport === 'tennis' ? 6 : sport === 'cornhole' ? 21 : 0, winBy: sport === 'pickleball' || sport === 'tennis' ? 2 : 1, bestOf: 1, scoring: 'sideout', reset: 'game15', seeding: 'rating', courts: 2, pools: 1, playoff: fmt === 'rr' ? 4 : 0, reach: 3, expDays: 7, expire: 'forfeit', move: 'swap', endDay: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), pickem: !!(o && o.pickem), weight: 'flat', side: false, scorer: 'a', group: o && o.group && o.group.id ? { id: String(o.group.id), name: String(o.group.name || '') } : null, startLocal: fmt === 'solo' ? local(Date.now()) : local(d.getTime()), entries: '', playIn: true, myRating: '', entry: 0, pot: 'main', split: 'none', takeKind: 'none', takeV: 0, self: true, spectators: true, low: !!(o && o.low), unitLabel: (o && o.unitLabel) || 'points' };
  }
  function createV() {
    const d = DR, P = d.sport === 'pickleball';
    let h = '<h1>New ' + esc(SPORTN[d.sport].toLowerCase()) + ' event</h1>' + (d.group ? '<div class="ewarn"><b>Creating this for ' + esc(d.group.name || 'your group') + '</b>Only this group\'s members can join it: from the group, or with the invite link.</div>' : '') + '<label class="elab">Event name<input id="ft" class="ein" maxlength="40" placeholder="Saturday Smash" value="' + esc(d.title) + '"></label>';
    h += '<div class="e2"><label class="elab">Sport' + sel('fsp', Object.keys(SPORTN).map((k) => [k, SPORTN[k]]), d.sport) + '</label><label class="elab">Format' + sel('ffm', Object.keys(FMTN).map((k) => [k, FMTN[k]]), d.fmt) + '</label></div>';
    h += '<button class="einfo" data-a="info" data-k="' + att(d.fmt) + '">ⓘ How ' + esc(FMTN[d.fmt].toLowerCase()) + ' works</button>';
    h += '<label class="elab">Starts (rules are final then)<input id="fst" class="ein" type="datetime-local" value="' + esc(d.startLocal) + '"></label>';
    if (['ladder', 'h2h', 'solo'].includes(d.fmt)) h += '<label class="elab">Last day<input id="fend" class="ein" type="date" value="' + esc(d.endDay) + '"></label>';
    if (d.fmt === 'solo') h += '<div class="ecard"><h2>Score</h2><label class="elab">What is counted<input id="fun" class="ein" maxlength="16" value="' + esc(d.unitLabel) + '"></label><div class="eline"><span>Lowest score wins<small>Off = highest wins</small></span>' + sw(d.low, 'data-tg="low"') + '</div></div>';
    else {
      h += '<div class="ecard"><h2>Matches</h2><div class="e2"><label class="elab">Play' + sel('fun2', Object.keys(UNITN).map((k) => [k, UNITN[k]]), d.unit) + '</label><label class="elab">Best of' + sel('fbo', [[1, '1 game'], [3, '3 games'], [5, '5 games']], d.bestOf) + '</label></div>';
      h += '<div class="e2"><label class="elab">Games to' + (P ? sel('fto', [[11, '11'], [15, '15'], [21, '21']], d.to) : '<input id="fto" class="ein" type="number" inputmode="numeric" min="0" max="999" value="' + esc(d.to) + '">') + '</label><label class="elab">Win by' + (P ? '<div class="ein efix">2 (pickleball)</div>' : sel('fwb', [[1, '1'], [2, '2']], d.winBy)) + '</label></div>';
      if (!P) h += '<div class="enote">Games to 0 = highest score wins (bowling, darts totals).</div>';
      if (P) h += '<label class="elab">Scoring (a label for the players)' + sel('fsc', [['sideout', 'Side-out scoring (standard)'], ['rally', 'Rally scoring']], d.scoring) + '</label>';
      if (P && d.fmt === 'de') h += '<label class="elab">Bracket reset (if the losers-bracket side wins the first final)' + sel('frs', [['game15', 'One game to 15, win by 2 (rulebook)'], ['match', 'A full match']], d.reset) + '</label>';
      h += '<div class="e2"><label class="elab">Seeding' + sel('fsd', seedOpts(d.sport), P && d.seeding === 'oddable' ? 'rating' : d.seeding) + '</label><label class="elab">Courts' + sel('fco', Array.from({ length: 12 }, (_, i) => [i + 1, String(i + 1)]), d.courts) + '</label></div>';
      if (d.fmt === 'rr') h += '<div class="e2"><label class="elab">Pools' + sel('fpo', [[1, 'One pool'], [2, '2 pools'], [3, '3 pools'], [4, '4 pools']], d.pools) + '</label><label class="elab">Playoff' + sel('fpl', [[0, 'None'], [2, 'Top 2'], [4, 'Top 4'], [8, 'Top 8']], d.playoff) + '</label></div>';
      if (d.fmt === 'ladder') h += '<div class="e2"><label class="elab">Challenge up to' + sel('fre', [1, 2, 3, 4, 5].map((n) => [n, n + ' spot' + (n > 1 ? 's' : '') + ' above']), d.reach) + '</label><label class="elab">Play within' + sel('fex', [2, 3, 5, 7, 10, 14].map((n) => [n, n + ' days']), d.expDays) + '</label></div><div class="e2"><label class="elab">Not played in time' + sel('fexp', [['forfeit', 'Challenger wins'], ['void', 'Cancelled']], d.expire) + '</label><label class="elab">Winner moves' + sel('fmv', [['swap', 'Swap places'], ['shift', 'Take the spot']], d.move) + '</label></div>';
      h += '<label class="elab">Who enters scores' + sel('fsr', [['a', 'First-listed side; other side confirms'], ['either', 'Either side; other side confirms'], ['comm', 'Only me (commissioner)']], d.scorer) + '</label>';
      if (['rr', 'se', 'de'].includes(d.fmt)) h += '<div class="eline"><span>Bracket pick\'em for spectators<small>' + esc(infoFor('pickem', d.sport)) + '</small></span>' + sw(d.pickem, 'data-tg="pickem"') + '</div>';
      if (d.fmt !== 'h2h') h += '<div class="eline"><span>Side matches allowed<small>Heads-up challenges on the side; they do not change the standings.</small></span>' + sw(d.side, 'data-tg="side"') + '</div>';
      h += '</div>';
    }
    h += '<div class="ecard"><h2>Players</h2><div class="eline"><span>I am playing<small>Adds you as the first entry.</small></span>' + sw(d.playIn, 'data-tg="playIn"') + '</div>';
    if (d.playIn) h += '<label class="elab">My rating (optional, e.g. 3.5 skill level)<input id="fmr" class="ein" type="number" inputmode="decimal" step="0.01" min="0" value="' + esc(d.myRating) + '"></label>';
    h += '<label class="elab">' + (d.unit === 'singles' || d.fmt === 'solo' ? 'Other players' : d.unit === 'teams' ? 'Teams' : 'Pairs') + ', one per line (name, rating)<textarea id="fen" class="ein eta" rows="5" placeholder="' + (d.unit === 'singles' || d.fmt === 'solo' ? 'Bea, 4.1\nCy, 3.6' : 'Bea / Cy, 4.0\nDi / Ed') + '">' + esc(d.entries) + '</textarea></label>';
    h += '<div class="enote">Players typed in here are guests: they can join with the invite link and pick their name, or claim their results later with a claim code. ' + esc(CAPLINE) + '</div>';
    h += '<div class="eline"><span>Players can add themselves<small>With the invite link, before the start.</small></span>' + sw(d.self, 'data-tg="self"') + '</div><div class="eline"><span>Spectators can join<small>Watch the scores' + (d.pickem ? " and play pick'em" : '') + '.</small></span>' + sw(d.spectators || d.pickem, 'data-tg="spectators"') + '</div></div>';
    h += '<div class="ecard"><h2>Entry and payout</h2><div class="e2"><label class="elab">Entry per player<input id="fmo" class="ein" type="number" inputmode="numeric" min="0" step="1" value="' + esc(d.entry || '') + '" placeholder="0"></label><label class="elab">Pot' + sel('fpt', [['main', 'Main pot'], ['side', 'Side pot']], d.pot) + '</label></div>';
    h += '<div class="e2"><label class="elab">Payout split' + sel('fspl', Object.keys(SPLITN).map((k) => [k, SPLITN[k]]), d.split) + '</label><label class="elab">Commissioner\'s take' + sel('ftk', [['none', 'None'], ['pct', 'Percent'], ['flat', 'Flat $']], d.takeKind) + '</label></div>';
    if (d.takeKind !== 'none') h += '<label class="elab">' + (d.takeKind === 'pct' ? 'Percent of the pot (0 to 50)' : 'Flat amount ($)') + '<input id="ftv" class="ein" type="number" inputmode="decimal" min="0" step="' + (d.takeKind === 'pct' ? 1 : 0.01) + '" value="' + esc(d.takeV) + '"></label>';
    h += '<div class="enote">' + esc(MONEY) + '</div></div>';
    h += '<div class="ewarn"><b>Rules are final at the start</b>After the start (or once you make the draw) nobody can change the rules or the entries, the commissioner included. Money rules (entry, take, payout split, pot, format) are final sooner: as soon as anyone else joins.</div>';
    return h + '<button class="epri efull" data-a="submit">Create event</button>';
  }
  function readDraft() {
    const v = (id) => { const x = document.getElementById(id); return x ? x.value : null; }, d = DR; if (!d) return;
    const map = { ft: 'title', fst: 'startLocal', fend: 'endDay', fun: 'unitLabel', fen: 'entries', fmr: 'myRating', fmo: 'entry', ftv: 'takeV' }; Object.keys(map).forEach((k) => { if (v(k) !== null) d[map[k]] = v(k); });
    const num = { fbo: 'bestOf', fto: 'to', fwb: 'winBy', fco: 'courts', fpo: 'pools', fpl: 'playoff', fre: 'reach', fex: 'expDays' }; Object.keys(num).forEach((k) => { if (v(k) !== null) d[num[k]] = Number(v(k)); });
    const str = { fun2: 'unit', frs: 'reset', fsc: 'scoring', fsd: 'seeding', fexp: 'expire', fmv: 'move', fsr: 'scorer', fpt: 'pot', fspl: 'split', ftk: 'takeKind' }; Object.keys(str).forEach((k) => { if (v(k) !== null) d[str[k]] = v(k); });
    if (v('fsp') !== null && v('fsp') !== d.sport) { const n = draftNew({ sport: v('fsp'), fmt: d.fmt }); ['to', 'winBy', 'unit'].forEach((k) => (d[k] = n[k])); d.sport = v('fsp'); }
    if (v('ffm') !== null) d.fmt = v('ffm');
  }
  function payload() {
    const d = DR, ents = String(d.entries || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^(.*?)(?:[,;]\s*(\d+(?:\.\d+)?))?$/.exec(l); return { name: m[1].trim(), rating: m[2] || '' }; });
    return { title: d.title.trim(), sport: d.sport, fmt: d.fmt, unit: d.fmt === 'solo' ? 'singles' : d.unit, start: new Date(d.startLocal).getTime(), endDay: d.endDay, to: d.to, winBy: d.sport === 'pickleball' ? 2 : d.winBy, bestOf: d.bestOf, scoring: d.scoring, reset: d.reset, seeding: d.seeding, courts: d.courts, pools: d.pools, playoff: d.playoff, reach: d.reach, expDays: d.expDays, expire: d.expire, move: d.move, pickem: d.pickem, weight: d.weight, side: d.side, scorer: d.scorer, low: d.low, unitLabel: d.unitLabel,
      entrants: ents, playIn: d.playIn, myRating: d.myRating, entry: Number(d.entry) || 0, pot: d.pot, split: d.split, take: { kind: d.takeKind, v: Number(d.takeV) || 0 }, self: d.self, spectators: d.spectators || d.pickem, groupId: d.group ? d.group.id : undefined };
  }
  // ---- one event ----
  function eventV() {
    const s = cur(), e = s.ev; if (!e) return '<div class="ecard">Loading…</div>';
    const comm = e.role === 'comm', tabs = [['matches', e.fmt === 'solo' ? 'Scores' : 'Matches'], ['table', e.fmt === 'ladder' ? 'Ladder' : e.fmt === 'se' || e.fmt === 'de' ? 'Bracket' : 'Standings']].concat(e.rules.pickem ? [['pick', "Pick'em"]] : []).concat([['info', 'Info']]);
    let h = '<h1>' + esc(e.title) + '</h1><div class="emeta">' + fmtLine(e) + (e.inGroup ? ' · in a group' : '') + '</div>';
    const mineNext = e.matches.filter((m) => m.mine && (m.state === 'ready' || m.state === 'pending' || m.state === 'offered')), todo = e.matches.filter((m) => m.canConfirm || (m.canScore && m.mine && m.state === 'ready'));
    h += '<div class="e3">' + tile('Status', e.fin ? 'Final' : e.drawn ? 'Live' : 'Not started', 'data-a="drill" data-to="' + (e.fin ? 'table' : 'matches') + '"', e.fin ? '' : e.drawn ? '' : esc(fmtTime(e.start))) + tile('For you', String(todo.length), 'data-a="todo"', todo.length ? 'need a score or OK' : mineNext.length ? 'next: ' + esc(mineNext[0].an + ' v ' + mineNext[0].bn) : 'nothing waiting', todo.length ? 'eyel' : '') + (comm ? tile('Disputes', String(e.flags), 'data-a="flags"', e.flags ? 'you decide' : 'none', e.flags ? 'eneg' : '') : tile('People', e.people + '/' + e.cap, 'data-a="drill" data-to="info"', '')) + '</div>';
    h += '<div class="eseg etabs">' + tabs.map(([k, l]) => '<button class="' + (s.tab === k ? 'on' : '') + '" data-tab="' + k + '">' + l + '</button>').join('') + '</div>';
    if (s.err2) h += '<div class="eerr">' + esc(s.err2) + '</div>';
    (e.notices || (e.notice ? [e.notice] : [])).forEach((n) => { h += '<div class="ewarn"><b>' + (n.by === 'Oddable' ? 'Notice' : 'Notice from the commissioner') + '</b>' + esc(n.text) + '<small class="enby">' + esc(fmtTime(n.at)) + ' · ' + esc(n.by) + '</small></div>'; });
    if (e.hold && (e.hold.late || comm)) h += '<div class="ewarn"><b>' + (e.hold.late ? 'Waiting to start' : 'Not ready to start') + '</b>' + esc(e.hold.names.join(', ')) + (e.hold.names.length > 1 ? ' have' : ' has') + ' an empty partner spot. A pair cannot start without both players. ' + (comm ? 'Add the partner or remove the entry (Info tab); the draw is made as soon as every pair is complete.' : 'The commissioner adds the partner or removes the entry.') + '</div>';
    if (e.approve && e.approve.open && e.isOrg && e.approve.approved < e.approve.total) h += '<div class="ewarn"><b>To do before the start: approve the ratings (' + e.approve.approved + ' of ' + e.approve.total + ' approved)</b>In a money event nobody plays off a number you have not approved or set. Look at each player\'s Oddable rating, confirmed or not, and approve it or set one. If you do not, the draw is still made at the start, unapproved players at their Oddable seed number, and the history says so.<button class="epri efull" data-a="apopen">Review and approve ratings</button></div>';
    if (e.acceptMe) h += '<div class="ewarn"><b>' + (e.acceptMe.seat ? 'Confirm your seat in ' + esc(e.acceptMe.seat) : '') + (e.acceptMe.seat && e.acceptMe.co ? ' and ' : '') + (e.acceptMe.co ? (e.acceptMe.seat ? 'the' : 'Accept the') + ' co-organizer role' : '') + '</b>Money event: ratings are approved by the organizer, and a seat or a co-organizer counts only after that person says yes on their own phone.<button class="epri efull" data-a="acceptme">Yes, that is me</button></div>';
    if (e.cosign && e.cosign.canSign) h += '<div class="ewarn"><b>' + esc(e.cosign.name) + ' asks you to co-sign</b>' + esc(e.cosign.kind === 'set' ? 'A set rating of ' + e.cosign.value + ' for ' + e.cosign.name + ' (' + e.cosign.reason + ').' : e.cosign.name + "'s Oddable rating " + e.cosign.value + '.') + ' Organizers cannot approve their own number alone; your name is logged with it for every player to see.<button class="epri efull" data-a="cosign">Co-sign ' + esc(e.cosign.value) + '</button></div>';
    else if (e.cosign && e.cosign.mine) h += '<div class="enote"><b>Waiting for a co-sign</b> on your rating ' + esc(e.cosign.value) + ': a co-organizer or a player on another team taps Co-sign on their phone. <button class="etiny" data-a="cosigncancel">Withdraw</button></div>';
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
    if (!e.drawn) { h += '<div class="ewarn"><b>Starts ' + esc(fmtTime(e.start)) + '</b>The draw is made at the start' + (e.role === 'comm' ? ', or now if you tap below (entries and rules are final then).' : '.') + '</div>'; if (e.role === 'comm' && e.fmt !== 'h2h' && !e.hold) h += '<button class="esec efull" data-a="draw">Make the draw now</button>'; }
    const canCh = e.drawn && !e.fin && (e.fmt === 'ladder' || e.fmt === 'h2h' || e.rules.side) && (e.myEntries.length || e.role === 'comm');
    if (canCh || (e.fmt === 'h2h' && e.started && !e.fin)) h += '<button class="epri efull" data-a="chal">' + (e.fmt === 'ladder' ? 'Challenge someone above you' : e.fmt === 'h2h' ? 'Start a heads-up challenge' : 'Start a side match') + '</button>';
    const entN = s.eid ? (e.entrants.find((x) => x.eid === s.eid) || {}).name : null, F = s.mf === 'ent' && !entN ? 'all' : s.mf || 'all', ms = e.matches.filter((m) => m.state !== 'bye' && (F === 'all' || (F === 'ent' ? m.a === s.eid || m.b === s.eid : F === 'mine' ? m.mine : F === 'todo' ? m.canConfirm || (m.canScore && (m.mine || e.role === 'comm') && m.state !== 'confirmed') || m.needsComm : F === 'flags' ? m.needsComm : m.state === 'confirmed')));
    h += '<label class="elab">Show' + sel('emf', [['all', 'All matches'], ['mine', 'My matches'], ['todo', 'Need a score or OK']].concat(e.role === 'comm' ? [['flags', 'Disputes / you confirm']] : []).concat([['done', 'Finished']]).concat(entN ? [['ent', 'Matches of ' + entN]] : []), F) + '</label>';
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
  // Standings sub-line: only the tiebreak steps that really separated this entry (nothing for an entry that was never level with anyone)
  const stepLine = (r) => { const st = r.steps || [], t = r.shared ? 'Level after every tiebreak step: shared place' : r.tie ? '<span class="eyel">Still tied: waiting for the organizer</span>' : st.length ? 'Level on wins; placed by ' + esc(st.join(', then ')) : ''; return t ? '<small>' + t + '</small>' : ''; };
  function tableV(e) {
    let h = '';
    if (e.poHold) h += '<div class="ewarn"><b>Playoff reset</b>' + esc(e.poHold.by) + ': ' + esc(e.poHold.reason) + '. ' + (e.role === 'comm' ? 'Correct the pool or tiebreak scores (Matches tab), then redraw the playoff from the standings.<button class="epri efull" data-a="poredraw">Redraw the playoff now</button>' : 'The commissioner is correcting a score; the playoff will be redrawn from the standings.') + '</div>';
    if (e.canFinish) h += '<div class="ewarn"><b>Every score is in</b>Check the scores, then finish: places and prizes become final and nothing can be corrected after that. Not tapped: it finishes by itself ' + esc(fmtTime(e.autoFinAt)) + '.<button class="epri efull" data-a="finish">Finish the round robin</button></div>';
    if (e.placeRows) { h += '<h3 class="eh">' + (e.final === false ? 'Places so far (not final yet)' : 'Final places') + '</h3>'; const shared = (p) => e.placeRows.filter((x) => x.place === p).length > 1; e.placeRows.forEach((r) => { if (shared(r.place)) r.sh = 1; }); e.placeRows.forEach((r) => { h += '<div class="etrow' + (r.place === 1 ? ' egold2' : '') + '"><span class="' + (r.place === 1 ? 'egold' : '') + '">' + ord(r.place) + '</span><span><b>' + esc(r.name) + '</b>' + (r.sh ? '<small>shared place</small>' : '') + '</span><span></span></div>'; }); }
    if (e.fmt === 'solo') return h + soloV(e);
    if (e.tables) e.tables.forEach((t, i) => {
      h += '<h3 class="eh">' + (e.tables.length > 1 ? 'Pool ' + String.fromCharCode(65 + i) : 'Standings') + '</h3><div class="ethead e5"><span>#</span><span>Player</span><span class="er">W-L</span><span class="er">+/-</span></div>';
      t.forEach((r) => { h += '<button class="etrow e5" data-a="ent" data-eid="' + att(r.eid) + '"><span>' + r.rank + '</span><span><b>' + esc(r.name) + '</b>' + stepLine(r) + '</span><span class="er">' + r.w + '-' + r.l + '</span><span class="er ' + (r.diff > 0 ? 'epos' : r.diff < 0 ? 'eneg' : '') + '">' + (r.diff > 0 ? '+' : '') + r.diff + '</span></button>'; });
    });
    (e.ties || []).forEach((t) => { h += '<div class="ewarn"><b>Still tied: ' + esc(t.names.join(', ')) + '</b>' + (t.cross ? 'Level for the last ' + (t.spots > 1 ? t.spots + ' playoff spots' : 'playoff spot') + ' across pools: the same win percentage, point difference per game and points per game. Pools never played each other, so nothing else can separate them and it has to be settled. ' : 'Level after every tiebreak step. It decides a prize or a playoff spot, so it has to be settled. ') + (t.game ? 'A tiebreak playoff is on: its ' + (t.matches > 1 ? 'matches are' : 'match is') + ' on the Matches tab.' : e.role === 'comm' ? 'You choose how; the choice is logged for everyone.' : 'The organizer chooses a coin flip (the default) or a playoff.') + (e.role === 'comm' && !t.game ? '<button class="epri efull" data-a="tbreak" data-how="coin" data-k="' + esc(t.key) + '">Coin flip (default)</button><button class="esec efull" data-a="tbreak" data-how="game" data-k="' + esc(t.key) + '">House rule: playoff, order drawn at random (' + t.matches + ' match' + (t.matches > 1 ? 'es' : '') + ')</button><div class="enote">The playoff is a house rule, not in the rulebook: Oddable draws the order, the last two play, and the winner plays the next one up. The drawn order is logged.</div>' : '') + '</div>'; });
    if (e.tables) { const pt = e.sport === 'tennis' ? 'game' : 'point';
      h += '<div class="enote">Order (' + (e.sport === 'pickleball' ? 'pickleball rulebook' : 'the same for every sport in Oddable') + '): most wins; head-to-head among the tied; ' + pt + ' differential in all matches; head-to-head ' + pt + ' differential; ' + pt + ' differential against the next-highest entry. When a step separates only the best of a tie, the rest start over at head-to-head. Still level: a shared place, unless it decides a prize or a playoff spot; then the organizer settles it with a coin flip (default) or a playoff (house rule), logged. The seed never breaks a tie. Only confirmed scores count.' + (e.rules.playoff ? ' Top ' + e.rules.playoff + ' go to the playoff.' : '') + '</div>';
      if (e.tables.length > 1) h += '<div class="enote">Places across pools: pools never played each other, so places are not decided by comparing records between them' + (e.wild ? ' (the one exception is the playoff spot' + (e.wild.spots > 1 ? 's' : '') + ' left over, below)' : '') + '. Entries that finish in the same position in different pools share the place' + (e.rules.playoff ? ' (the entries that miss the playoff are placed this way; the playoff decides the top places).' : ' (the pool winners share 1st).') + '</div>';
      if (e.wild) h += '<div class="enote">Playoff spots: ' + (e.wild.per ? 'the top ' + e.wild.per + ' of each pool, plus ' : '') + 'the best ' + e.wild.spots + ' of the pools\' ' + ord(e.wild.pos) + ' places by record per game played (win percentage, then point difference per game, then points per game; pools can differ in size). If those records are level, the organizer settles it with a coin flip (the default) or a playoff, and it is logged. It is never decided by pool order.' + (e.wild.decided && e.wild.decided.length ? ' Decided: ' + esc(e.wild.decided.map((d) => d.name + ' (' + (d.how === 'record' ? 'by record' : 'records level: ' + d.how) + ')').join(', ')) + '.' : '') + '</div>';
      if (e.role === 'comm' && e.hasPlayoff && !e.fin) h += '<button class="edanger efull" data-a="poreset">Reset the playoff…</button><div class="enote">Only to correct a pool or tiebreak score after the playoff has started: its results so far are wiped, everyone is told why, and you redraw it from the corrected standings.</div>'; }
    if (e.ladder) { h += '<h3 class="eh">Ladder</h3><div class="ethead e4"><span>#</span><span>Player</span><span class="er">Challenge</span></div>'; e.ladder.forEach((r) => { const mine = e.myEntries.includes(r.eid), my = e.ladder.find((x) => e.myEntries.includes(x.eid)), can = my && !mine && r.rank < my.rank && my.rank - r.rank <= e.rules.reach && e.drawn && !e.fin; h += '<div class="etrow e4"><span>' + r.rank + '</span><span><b>' + esc(r.name) + (mine ? ' · you' : '') + '</b></span>' + (can ? '<button class="etiny" data-a="dochal" data-a2="' + att(my.eid) + '" data-b2="' + att(r.eid) + '">Challenge</button>' : '<span></span>') + '</div>'; }); }
    if (e.records && (e.fmt === 'h2h' || e.fmt === 'ladder' || e.rules.side)) { h += '<h3 class="eh">' + (e.fmt === 'h2h' ? 'Records' : 'Challenge records') + '</h3><div class="ethead e5"><span>#</span><span>Player</span><span class="er">W-L</span><span class="er">+/-</span></div>'; e.records.forEach((r) => { h += '<button class="etrow e5" data-a="ent" data-eid="' + att(r.eid) + '"><span>' + r.rank + '</span><span><b>' + esc(r.name) + '</b></span><span class="er">' + r.w + '-' + r.l + '</span><span class="er">' + (r.diff > 0 ? '+' : '') + r.diff + '</span></button>'; }); }
    if (e.fmt === 'se' || e.fmt === 'de' || (e.fmt === 'rr' && e.matches.some((m) => m.st === 'po'))) {
      const rounds = {}; e.matches.filter((m) => m.st !== 'pool' && m.st !== 'side').forEach((m) => { const k = (m.st === 'l' ? 'Losers round ' : m.st === 'gf' ? 'Final' : m.st === 'po' ? 'Playoff round ' : m.st === 'tb' ? 'Tiebreak playoff, match ' : m.st === 'lad' || m.st === 'h2h' ? 'Challenges' : 'Round ') + (m.st === 'gf' ? (m.reset ? ' (reset)' : '') : m.st === 'lad' || m.st === 'h2h' ? '' : m.r); (rounds[k] = rounds[k] || []).push(m); });
      Object.keys(rounds).forEach((k) => { h += '<h3 class="eh">' + esc(k) + '</h3>'; rounds[k].forEach((m) => { if (m.state === 'void' && m.reset) return; h += matchCard(e, m); }); });
      if (!Object.keys(rounds).length) h += '<div class="ecard emut">The bracket appears after the draw.</div>';
    }
    return h || '<div class="ecard emut">Standings appear once matches are played.</div>';
  }
  function pickV(e) {
    const p = e.pickem; if (!p) return '';
    let h = '<div class="enote">' + esc(infoFor('pickem', e.sport, e.rules)) + '</div>';
    if (p.org) h += '<div class="ewarn"><b>Organizers cannot pick in their own event</b>You run the results' + (e.role === 'comm' ? '' : ' with the organizer') + ', so you follow the pick\'em here: the leaderboard, how everyone picked once a round closed, and when picks close.</div>';
    const open = e.matches.filter((m) => p.open.includes(m.id)), own = e.matches.filter((m) => (p.own || []).includes(m.id) && m.state === 'ready'), ptsOf = (m) => (e.rules.weight === 'round' && p.pts && p.pts[m.id] ? ' · worth ' + p.pts[m.id] + ' point' + (p.pts[m.id] > 1 ? 's' : '') : '');
    if (!p.org) h += '<h3 class="eh">Open to pick · ' + open.length + '</h3>';
    if (!open.length && !p.org) h += '<div class="ecard emut">Nothing to pick right now. Later rounds open as earlier matches finish.</div>';
    open.forEach((m) => { const my = p.mine[m.id]; h += '<div class="ecard"><small class="emut">' + esc(label(m) + ptsOf(m)) + '</small>' + (my ? '<div class="erow"><b class="ename">' + esc(my.s === 'a' ? m.an : m.bn) + '</b><span class="ebadge eg">Your pick · final</span></div><div class="emeta">over ' + esc(my.s === 'a' ? m.bn : m.an) + ' · saved ' + esc(fmtTime(my.t)) + '</div>' : '<div class="e2">' + ['a', 'b'].map((sd) => '<button class="esec" data-a="pick" data-m="' + att(m.id) + '" data-side="' + sd + '">' + esc(sd === 'a' ? m.an : m.bn) + '</button>').join('') + '</div>') + '</div>'; });
    if (p.voided && p.voided.length) h += '<div class="ewarn"><b>' + p.voided.length + ' pick' + (p.voided.length > 1 ? 's' : '') + ' voided</b>You took a seat in ' + (p.voided.length > 1 ? 'these matches' : 'this match') + ', so your pick' + (p.voided.length > 1 ? 's on them do' : ' on it does') + ' not count: ' + esc(p.voided.map((v) => (v.an || '?') + ' v ' + (v.bn || '?') + ' (you had picked ' + ((v.s === 'a' ? v.an : v.bn) || '?') + ')').join('; ')) + '. Players cannot pick matches they play in.</div>';
    if (own.length) h += '<div class="enote">Your own match' + (own.length > 1 ? 'es are' : ' is') + ' not in your pick\'em (' + esc(own.map((m) => m.an + ' v ' + m.bn).join('; ')) + '): players cannot pick matches they play in.</div>';
    if (!p.org && open.some((m) => !p.mine[m.id])) h += '<div class="enote">Picks are final when you enter them (saved and time-stamped by Oddable). They cannot be changed.</div>';
    if (!p.org) h += p.tb != null ? '<div class="ecard"><div class="erow"><span>Tiebreak: total points in the final</span><span class="ebadge eg">' + esc(p.tb) + ' · final</span></div></div>' : '<label class="elab">Tiebreak: total points in the final (final when you save it)<input id="etb" class="ein" type="number" inputmode="numeric" min="0" max="999" value=""></label><button class="esec efull" data-a="tb">Save tiebreak</button>';
    if (p.rounds && p.rounds.length) { h += '<h3 class="eh">When picks close</h3>'; const loc = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); };
      p.rounds.forEach((r) => { h += '<div class="ecard"><div class="erow"><b class="ename">' + esc(r.label) + '</b><span class="ebadge ' + (r.locked ? 'ep' : 'ey') + '">' + (r.locked ? 'Closed' : 'Open') + '</span></div><div class="emeta">' + (r.locked ? (r.how === 'button' ? 'Picks were closed by the commissioner.' : r.how === 'time' ? 'Picks closed at ' + esc(fmtTime(r.lockAt)) + '.' : 'Picks closed when its first match started.') : r.lockAt ? 'Picks close at ' + esc(fmtTime(r.lockAt)) + ', or when its first match starts if that is sooner.' : 'Picks close when its first match starts or gets a score.') + '</div>' + (e.isOrg && !r.locked && !e.fin ? '<label class="elab">Closing time<input class="ein" type="datetime-local" data-plk="' + esc(r.key) + '" value="' + (r.lockAt ? loc(r.lockAt) : '') + '"></label><div class="e2"><button class="esec" data-a="plockat" data-k="' + esc(r.key) + '">Set closing time</button><button class="esec" data-a="plock" data-k="' + esc(r.key) + '">Close picks now</button></div>' : '') + '</div>'; }); }
    h += '<h3 class="eh">Leaderboard</h3><div class="ethead e5"><span>#</span><span>Name</span><span class="er">Right</span><span class="er">Pts</span></div>';
    p.table.forEach((r) => { h += '<div class="etrow e5"><span>' + r.place + '</span><span><b>' + esc(r.name) + '</b>' + (r.tb != null && p.finalTotal != null ? '<small>tiebreak ' + r.tb + '</small>' : '') + '</span><span class="er">' + r.right + '/' + r.n + '</span><span class="er"><b>' + r.pts + '</b></span></div>'; });
    if (!p.table.length) h += '<div class="ecard emut">No picks yet.</div>';
    const locked = e.matches.filter((m) => p.counts[m.id] && m.an && m.bn); if (locked.length) { h += '<h3 class="eh">How everyone picked (after each round closed)</h3>'; locked.forEach((m) => { const c = p.counts[m.id]; h += '<div class="etrow e1"><span><b>' + esc(m.an) + ' v ' + esc(m.bn) + '</b><small>' + esc(label(m)) + ' · picked ' + esc(m.an) + ': ' + c.a + ' · picked ' + esc(m.bn) + ': ' + c.b + '</small></span></div>'; }); }
    return h;
  }
  function infoV(e) {
    const comm = e.role === 'comm';
    let h = '<button class="epri efull" data-a="invite">Invite people</button><div class="enote">' + esc(INFO.invite) + '</div>';
    h += '<div class="ecard"><h2>Rules</h2>' + rulesList(e) + '<button class="einfo" data-a="info" data-k="' + att(e.fmt) + '">ⓘ How ' + esc(FMTN[e.fmt].toLowerCase()) + ' works here</button>' + (e.sport === 'pickleball' ? '<a class="einfo" href="pickleball.html#/courts">📍 Find local courts</a>' : '') + '</div>'; // main port: the existing court search (pickleball.html #/courts, v259 / v261)
    h += '<div class="ecard"><h2>' + (e.fmt === 'solo' ? 'Players' : 'Entries') + ' · ' + e.entrants.length + '</h2>';
    const canRate = comm && e.ent && e.odd && !e.locked, canFix = comm && !e.drawn && e.hold;
    e.entrants.slice().sort((a, b) => (a.seed || 999) - (b.seed || 999)).forEach((x) => {
      h += '<div class="emrow"><span><b>' + (x.seed ? x.seed + '. ' : '') + esc(x.name) + '</b>' + (x.players.length > 1 && e.odd && x.oddRating != null ? '<small>Team rating ' + esc(x.oddRating) + '</small>' : '') + (x.rating != null ? '<small>Typed rating ' + esc(x.rating) + (e.odd ? ' (shown only)' : '') + '</small>' : '');
      x.players.forEach((p) => { h += '<small class="eplr">' + esc(p.name + (p.blank ? ' (open spot)' : p.guest ? ' (guest)' : '') + (p.me ? ' · you' : '')) + (e.odd && !p.blank ? '<br><span class="erate">' + esc(rateLine(p)) + '</span>' + (p.trn ? ' <span class="ebadge ey">Set by tournament</span>' : '') : '') + '</small>' + (canRate && !p.blank ? '<button class="etiny erbtn" data-a="trate" data-gid="' + att(p.gid) + '">' + (p.trn ? 'Change tournament rating' : 'Set tournament rating') + '</button>' : ''); });
      h += (comm ? x.players.filter((p) => p.claim && !p.blank).map((p) => '<small class="ecopy">Claim code for ' + esc(p.name) + ': <code>' + esc(p.claim) + '</code></small>').join('') : '') + '</span>' + (comm && (!e.locked || (canFix && e.hold.eids.includes(x.eid))) ? '<button class="etiny" data-a="rment" data-eid="' + att(x.eid) + '">Remove</button>' : '') + '</div>';
      if (canFix && e.hold.eids.includes(x.eid)) h += '<label class="elab">Partner for ' + esc(x.name) + ' (empty spot)<input class="ein" maxlength="24" data-pin="' + att(x.eid) + '" placeholder="Partner name"></label><button class="esec efull" data-a="addpartner" data-eid="' + att(x.eid) + '">Add partner</button>'; });
    if (e.moneyEvent && e.odd && !e.drawn && e.fmt !== 'solo' && e.rules.seeding !== 'random' && e.rules.seeding !== 'manual') h += '<div class="enote"><b>Money event:</b> seeds are not taken from the Oddable rating alone. Every player\'s confirmed games are shown, and the organizer may set the seeds by hand' + (e.seedSet ? ' (seeds have been set by the organizer; see History).' : '.') + '</div>';
    if (e.approve && e.isOrg) h += '<div class="ecard"><h2>Ratings · ' + e.approve.approved + ' of ' + e.approve.total + ' approved</h2><div class="enote">' + (e.approve.open ? 'Money event: each player plays off the number you approve or set. Seeds come from those numbers.' : 'Final: the event has started.') + '</div><button class="' + (e.approve.open && e.approve.approved < e.approve.total ? 'epri' : 'esec') + ' efull" data-a="apopen">' + (e.approve.open ? 'Review and approve ratings' : 'See the ratings') + '</button></div>';
    if (e.odd) h += '<div class="enote">' + esc(ODDNOTE) + (e.ent ? ' In this Enterprise event the director can set a tournament rating for this event only' + (e.locked ? '; ratings became final at the start.' : ' until it starts.') : '') + '</div>';
    if (e.teams && !e.locked) h += '<button class="esec efull" data-a="partners">Suggest partners</button><div class="enote">Balanced, Rotate or Hot pairs, each with a reason. It only suggests' + (comm ? '; you choose.' : '; the commissioner sets the teams.') + '</div>';
    if (comm && !e.locked) h += '<label class="elab">Add ' + (e.rules.unit === 'singles' ? 'a player' : 'an entry') + ' (name, rating)<input id="eadd" class="ein" maxlength="50" placeholder="' + (e.rules.unit === 'singles' ? 'Bea, 4.1' : 'Bea / Cy, 4.0') + '"></label><button class="esec efull" data-a="addent">Add</button>';
    h += '<div class="enote">' + e.people + ' of ' + e.cap + ' people. ' + esc(e.cap > 8 ? 'Licensed for larger games.' : e.entText || ENTTEXT) + '</div></div>';
    if (comm && e.seedPlan && e.seedPlan.length > 1) { const ents = e.seedPlan.map((id) => e.entrants.find((x) => x.eid === id)).filter(Boolean);
      h += '<div class="ecard"><h2>Seeds · ' + (e.seedSet ? 'set by you' : esc(e.rules.seeding === 'manual' ? 'as listed' : e.odd ? 'by Oddable rating' : 'by rating')) + '</h2>' + (e.moneyEvent && e.odd ? '<div class="ewarn"><b>Money event: do not seed by the Oddable rating alone</b>A rating with few confirmed games behind it says little. Check each player\'s "x of y games confirmed" below and move the seeds where you know better.</div>' : '');
      ents.forEach((x, i) => { h += '<div class="emrow"><span><b>' + (i + 1) + '. ' + esc(x.name) + '</b>' + x.players.filter((q) => !q.blank).map((q) => '<small>' + esc(q.name + ': ' + (e.odd ? (q.trn ? 'Tournament ' + q.trn.v + ' · ' : '') + (q.needsSet && !q.trn ? 'no rating to use yet (' + (q.why || 'needs games confirmed by 3 different players') + ') · ' : q.odd && q.odd.rating != null ? 'Oddable ' + q.odd.rating + ' · ' : '') + confTxt(q.odd) : x.rating != null ? 'typed rating ' + x.rating : 'no rating')) + '</small>').join('') + '</span><span class="eud"><button class="etiny" data-a="seed" data-do="up" data-eid="' + att(x.eid) + '" aria-label="Move ' + esc(x.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>▲</button><button class="etiny" data-a="seed" data-do="down" data-eid="' + att(x.eid) + '" aria-label="Move ' + esc(x.name) + ' down"' + (i === ents.length - 1 ? ' disabled' : '') + '>▼</button></span></div>'; });
      if (e.moneyEvent && e.seedNeed && e.seedNeed.length && !e.seedSet) h += '<div class="ewarn"><b>You set the seeds: ' + e.seedNeed.length + ' player' + (e.seedNeed.length > 1 ? 's have' : ' has') + ' no rating to use yet</b>' + esc(e.seedNeed.join(', ')) + ': a rating counts only once games were confirmed by 3 different players. Until then they sit at the new-player number (1500). Move them where they belong, or keep the order as it is.<button class="epri efull" data-a="seedkeep">These are my seeds</button></div>';
      h += (e.seedSet ? '<button class="esec efull" data-a="seedclear">Back to the usual order</button>' : '') + '<div class="enote">These are the seeds the draw will use. Every move is in the History for everyone to see. Final at the start.</div></div>'; }
    const p = e.pot; h += '<div class="ecard"><h2>Money (information only)</h2><button class="ekv ekvb" data-a="money" data-k="pot"><span>' + (p.pot === 'side' ? 'Side pot' : 'Main pot') + ' ›<small>' + p.paid + ' of ' + p.players + ' players paid × ' + usd(p.entry) + '</small></span><b>' + usd(p.total) + '</b></button><div class="ekv"><span>Commissioner\'s take<small>' + esc(e.takeText) + '</small></span><b>' + (p.take ? '-' + usd(p.take) : '$0') + '</b></div><button class="ekv ekvb" data-a="money" data-k="pool"><span>Prize pool ›</span><b class="egold">' + usd(p.pool) + '</b></button>';
    p.places.forEach((x) => { const w = e.placeRows && e.placeRows.find((r) => r.place === x.place); h += '<div class="ekv"><span>' + ord(x.place) + ' · ' + x.pct + '%<small>' + (w ? esc(w.name) : 'Not decided') + '</small></span><b>' + usd(x.amt) + '</b></div>'; });
    h += '<div class="enote">' + (e.moneyFinal ? 'Money rules are final: someone joined or a player was marked paid. Entry, take, payout split, pot and format cannot change, even if people leave. ' : comm && !e.locked ? 'Money rules (entry, take, payout split, pot, format) are final as soon as anyone else joins or a player is marked paid. ' : '') + esc(MONEY) + '</div></div>';
    h += '<div class="ecard"><h2>People · ' + e.people + '</h2>'; e.members.forEach((m) => { h += '<div class="emrow"><span>' + esc(m.name) + ' <i class="emut">· ' + (m.comm ? 'commissioner' : (m.co ? 'co-organizer, ' : '') + (m.role === 'spectator' ? 'watching' : 'player')) + (m.pid === e.me ? ', you' : '') + '</i>' + (comm && !m.comm && !e.locked ? '<button class="etiny ecob" data-a="coorg" data-pid="' + att(m.pid) + '" data-on="' + (m.co ? '' : '1') + '">' + (m.co ? 'Remove co-organizer' : 'Make co-organizer') + '</button>' : '') + '</span>' + (e.money.entry && m.plays ? (m.paid ? '<span class="emut">Paid' + (comm ? ' <button class="etiny" data-a="unpaid" data-pid="' + att(m.pid) + '">Undo</button>' : '') + '</span>' : comm ? '<button class="etiny eyel" data-a="paid" data-pid="' + att(m.pid) + '">Mark paid</button>' : '<span class="eyel">Owed</span>') : e.money.entry && m.comm ? '<span class="emut">Not playing: no entry</span>' : '') + '</div>'; });
    // typed-in players (no account yet) owe an entry too: the organizer marks them paid here, and the pot counts them
    const typed = []; e.entrants.forEach((x) => x.players.forEach((p) => { if (p.guest && !p.blank) typed.push(p); }));
    typed.forEach((p) => { h += '<div class="emrow"><span>' + esc(p.name) + ' <i class="emut">· typed-in player</i></span>' + (e.money.entry ? (p.paid ? '<span class="emut">Paid' + (comm ? ' <button class="etiny" data-a="unpaid" data-gid="' + att(p.gid) + '">Undo</button>' : '') + '</span>' : comm ? '<button class="etiny eyel" data-a="paid" data-gid="' + att(p.gid) + '">Mark paid</button>' : '<span class="eyel">Owed</span>') : '') + '</div>'; });
    h += '</div>';
    if (e.tlog && e.tlog.length) h += '<div class="ecard"><h2>Tournament ratings · ' + e.tlog.length + ' change' + (e.tlog.length > 1 ? 's' : '') + '</h2>' + e.tlog.map((a) => '<div class="eaud"><small>' + esc(fmtTime(a.at)) + ' · ' + esc(a.by) + ' (director)</small><b>' + esc(a.player) + '</b>: ' + esc(a.old == null ? 'no rating' : a.old) + ' → ' + esc(a.new == null ? 'tournament rating removed' : a.new) + '<small>Oddable (real results): ' + esc(a.oddable == null ? 'no games yet' : a.oddable) + ' · Reason: ' + esc(a.reason) + '</small></div>').join('') + '<div class="enote">These apply to this event only. Nobody\'s lifetime Oddable rating is changed.</div></div>';
    h += '<div class="ecard"><h2>History</h2>' + (e.audit.length ? e.audit.slice(0, 60).map((a) => '<div class="eaud"><small>' + esc(fmtTime(a.t)) + ' · ' + esc(a.who) + '</small>' + esc(a.s) + '</div>').join('') : '<div class="emut">Nothing yet.</div>') + '</div>';
    if (comm && !e.locked) h += '<button class="edanger efull" data-a="delete">Delete event</button>';
    if (comm && (e.fmt === 'ladder' || e.fmt === 'h2h') && e.started && !e.fin) h += '<button class="esec efull" data-a="finish">Finish the event now</button>';
    if (e.canFinish) h += '<button class="esec efull" data-a="finish">Finish the round robin</button>';
    if (!comm) h += '<button class="edanger efull" data-a="leave">Leave event</button>';
    return h;
  }
  // ---- one match: score entry, confirm, dispute ----
  function voiceBtn(kind) { return window.VoiceLog && typeof window.VoiceLog.open === 'function' ? '<button class="evoice efull" data-a="voice" data-k="' + kind + '">🎤 Log my score</button>' : ''; }
  function matchV() {
    const s = cur(), e = s.ev, m = e && e.matches.find((x) => x.id === s.m); if (!m) return '<div class="ecard">Match not found.</div>';
    const r = m.rule ? Object.assign({}, e.rules, m.rule, { tset: false }) : e.rules, n = r.bestOf, g = s.g || (m.sub && m.state !== 'ready' ? m.sub.games : null) || [];
    let h = '<h1>' + esc(m.an || 'TBD') + ' v ' + esc(m.bn || 'TBD') + '</h1><div class="emeta">' + esc(label(m) + (m.court ? ' · Court ' + m.court : '') + ' · ' + gameRule(r, e.sport)) + '</div>';
    if (m.rule) h += '<div class="enote">Bracket reset: both sides have one loss, so this final is one game to ' + m.rule.to + ', win by ' + m.rule.winBy + ' (pickleball rulebook).</div>';
    h += '<div class="ecard"><div class="erow"><b>' + esc(stateTxt[m.state] || m.state) + '</b>' + (m.state === 'confirmed' ? '<b>' + esc(m.forfeit ? 'Forfeit' : scoreTxt(m)) + '</b>' : '') + '</div>';
    if (m.sub && m.state !== 'ready') h += '<div class="enote">Entered by ' + esc(m.sub.by) + ': ' + esc(scoreTxt(m, m.sub.games)) + (m.sub.note ? ' · Dispute: ' + esc(m.sub.note) : '') + '</div>';
    if (m.needsComm) h += '<div class="eyel">' + (m.state === 'disputed' ? 'Disputed. The commissioner enters the right score.' : 'The other side has no account here, so the commissioner confirms.') + '</div>';
    h += '</div>';
    if (m.state === 'offered' && (m.mine === 'b' || e.role === 'comm')) h += '<div class="e2"><button class="epri" data-a="accept">Accept</button><button class="esec" data-a="decline">Decline</button></div>';
    if (m.canConfirm) h += '<div class="e2"><button class="epri" data-a="confirm">Confirm ' + esc(scoreTxt(m, m.sub.games)) + '</button>' + (e.role === 'comm' && !m.mine ? '' : '<button class="edanger" data-a="dispute">Dispute</button>') + '</div>' + (e.role === 'comm' && !m.mine ? '' : '<label class="elab">Why (optional, for the commissioner)<input id="enote" class="ein" maxlength="120" placeholder="It was 11-9 in game 2"></label>') + (e.role === 'comm' && !m.mine && e.odd ? '<div class="enote">You are not playing in this match. Your OK makes the score final, but it does not count toward the Oddable rating: only an account on the other side can confirm a result for the rating.</div>' : '');
    if (m.canScore && m.state !== 'confirmed' || (m.canScore && e.role === 'comm')) {
      if (m.state === 'ready' && !m.live && e.rules.pickem && (m.mine || e.role === 'comm')) h += '<button class="esec efull" data-a="live">Start the match (closes pick\'em for its round)</button>';
      h += '<div class="ecard"><h2>' + (m.state === 'confirmed' ? 'Correct the score (commissioner)' : 'Enter the score') + '</h2><div class="ethead e3c"><span>Game</span><span class="er">' + esc(m.an) + '</span><span class="er">' + esc(m.bn) + '</span></div>';
      for (let i = 0; i < n; i++) h += '<div class="etrow e3c"><span>' + (r.tset ? 'Set ' : 'Game ') + (i + 1) + '</span><input id="ga' + i + '" class="ein enum" type="number" inputmode="numeric" min="0" max="999" value="' + esc(g[i] ? g[i][0] : '') + '" aria-label="' + esc(m.an) + ' game ' + (i + 1) + '"><input id="gb' + i + '" class="ein enum" type="number" inputmode="numeric" min="0" max="999" value="' + esc(g[i] ? g[i][1] : '') + '" aria-label="' + esc(m.bn) + ' game ' + (i + 1) + '"></div>';
      h += '<button class="epri efull" data-a="savescore">Save score</button>' + voiceBtn('match') + '<div class="enote">' + (e.role === 'comm' && (!m.mine || m.state !== 'ready' || !((e.entrants.find((x) => x.eid === (m.mine === 'a' ? m.b : m.a)) || {}).linked)) ? 'Your entry as commissioner is final.' : 'The other side confirms it. If they disagree, the commissioner decides.') + (n > 1 ? ' Leave unplayed games empty.' : '') + '</div></div>';
    } else if (m.state === 'ready' && !m.canScore && m.mine) h += '<div class="enote">' + esc(r.scorer === 'comm' ? 'The commissioner enters every score.' : 'The other side keeps score for this match; you confirm it.') + '</div>';
    const hist = e.audit.filter((a) => a.m === m.id); if (hist.length) h += '<div class="ecard"><h2>History</h2>' + hist.map((a) => '<div class="eaud"><small>' + esc(fmtTime(a.t)) + ' · ' + esc(a.who) + '</small>' + esc(a.s) + '</div>').join('') + '</div>';
    return h;
  }
  function chalV() {
    const s = cur(), e = s.ev, mine = e.entrants.filter((x) => e.myEntries.includes(x.eid)), from = e.role === 'comm' ? e.entrants : mine;
    let h = '<h1>' + (e.fmt === 'ladder' ? 'Ladder challenge' : e.fmt === 'h2h' ? 'Heads-up challenge' : 'Side match') + '</h1><div class="enote">' + esc(infoFor(e.fmt === 'ladder' ? 'ladder' : 'h2h', e.sport, e.rules)) + (e.odd ? ' ' + esc('Rated for the Oddable rating only when the other side\'s account confirms the score, at most 2 in 24 hours against the same opponents, and only once 3 accounts have confirmed play in this event.') : '') + '</div>';
    if (!from.length) return h + '<div class="ecard emut">You need an entry in this event to challenge.</div>';
    h += '<label class="elab">From' + sel('cha', from.map((x) => [x.eid, x.name]), s.a || from[0].eid) + '</label><label class="elab">Against' + sel('chb', e.entrants.filter((x) => x.eid !== (s.a || from[0].eid)).map((x) => [x.eid, x.name]), s.b) + '</label>';
    return h + '<button class="epri efull" data-a="sendchal">Send challenge</button>';
  }
  // ---- E-H: the director sets one player's rating for this tournament ----
  // ---- fourth review H2 (stats contract v1.4): the organizer's approval screen. Each player's Oddable rating with its make-up (OddStats.makeupHtml when the
  // stats screens are loaded), CONFIRMED / UNCONFIRMED and the flags; one tap "Use everyone's Oddable rating"; per player Approve or Set (with a reason);
  // the organizer's own number only with a co-sign from a co-organizer or a player on another team. The real Oddable rating always shows beside a set one.
  function approveV() {
    const s = cur(), rv = s.rv; let h = '<h1>Approve ratings</h1><div class="emeta">' + esc(s.ev ? s.ev.title : '') + '</div>';
    if (!rv) return h + '<div class="ecard emut">' + esc(s.rvErr || 'Loading…') + '</div>';
    h += '<div class="enote">Money event: each player plays off the number you approve or set, and seeds come from it. Every player sees who approved it, next to the real Oddable rating. ' + (rv.open ? 'Final at the start.' : 'Final: the event has started.') + '</div>';
    h += '<div class="e3">' + tile('Approved', rv.approved + ' of ' + rv.players.length, 'data-a="apflt" data-f="all"', rv.ready ? 'everyone' : 'still to do', rv.ready ? '' : 'eyel') + tile('Unconfirmed', String(rv.unconfirmed.length), 'data-a="apflt" data-f="unc"', 'check them first', rv.unconfirmed.length ? 'eyel' : '') + tile('To approve', String(rv.players.filter((x) => x.use == null).length), 'data-a="apflt" data-f="todo"', 'no number yet', '') + '</div>';
    if (s.f && s.f !== 'all') h += '<button class="esec efull" data-a="apflt" data-f="all">‹ All players</button>';
    if (rv.open && rv.players.some((x) => x.use == null && !x.you)) h += '<button class="epri efull" data-a="apall">Use everyone\'s Oddable rating</button><div class="enote">Approves each player\'s suggested number as shown below (confirmed or not). Your own number needs a co-sign.' + (rv.unconfirmed.length ? ' Unconfirmed: ' + esc(rv.unconfirmed.join(', ')) + '.' : '') + '</div>';
    const MK = window.OddStats && typeof window.OddStats.makeupHtml === 'function' ? window.OddStats.makeupHtml : null;
    rv.players.filter((x) => !s.f || s.f === 'all' || (s.f === 'unc' ? x.suggested && !x.suggested.confirmed : x.use == null)).forEach((x) => {
      const sg = x.suggested || {}, form = s.set === x.gid;
      h += '<div class="ecard"><div class="erow"><b class="ename">' + esc(x.name) + (x.you ? ' · you' : '') + '</b>' + (sg.value != null ? '<span class="ebadge ' + (sg.confirmed ? 'eg' : 'ey') + '">' + (sg.confirmed ? 'CONFIRMED' : 'UNCONFIRMED') + '</span>' : '') + '</div><div class="emeta">' + esc(x.entry !== x.name ? x.entry + ' · ' : '') + (x.guest ? 'typed-in player' : 'account') + '</div>';
      h += '<div class="ekv"><span>Oddable rating<small>Real results from app play: ' + esc(x.games ? x.confirmedGames + ' of ' + x.games + ' game' + (x.games === 1 ? '' : 's') + ' confirmed' : 'no games yet') + '</small></span><b>' + esc(x.oddable != null ? x.oddable : '–') + '</b></div>';
      h += '<div class="ekv"><span>Suggested<small>' + esc(sg.confirmed ? 'confirmed games from 3 or more different players' : sg.why || 'not confirmed') + '</small></span><b>' + esc(sg.value != null ? sg.value : 'none') + '</b></div>';
      h += '<div class="ekv"><span>Plays off<small>' + esc(x.shown || (x.use == null ? 'not approved yet' : '')) + '</small></span><b class="' + (x.use != null ? 'egold' : 'eyel') + '">' + esc(x.use != null ? x.use : 'not set') + '</b></div>';
      (x.flags || []).forEach((f) => { h += '<small class="eflag">⚑ ' + esc(f) + '</small>'; });
      if (x.makeup) h += MK ? '<div class="emk">' + MK(x.makeup, 'game') + '</div>' : x.makeup.text ? '<div class="enote">Made of: ' + esc(x.makeup.text) + '</div>' : '';
      if (rv.open) {
        if (x.you) h += x.use == null ? (rv.cosign ? '<div class="enote">Waiting for a co-sign on ' + esc(rv.cosign.value) + '.</div>' : '<button class="esec efull" data-a="cosignask"' + (sg.value == null ? ' disabled' : '') + '>Ask for a co-sign on ' + esc(sg.value != null ? sg.value : '–') + '</button><div class="enote">You cannot approve your own number alone. A player on another team (who confirmed his seat) taps Co-sign on his own phone. Ask FIRST: once you approve a player\'s number, that player can no longer co-sign yours.</div>') : '';
        else h += '<div class="e2">' + (sg.value != null && x.use !== sg.value && x.setBy !== 'organizer' && x.setBy !== 'tournament' ? '<button class="esec" data-a="apone" data-gid="' + att(x.gid) + '" data-v="' + att(sg.value) + '">Approve ' + esc(sg.value) + '</button>' : '') + '<button class="esec" data-a="rsetf" data-gid="' + att(x.gid) + '">' + (x.setBy === 'organizer' || x.setBy === 'tournament' ? 'Change set rating' : 'Set a rating') + '</button></div>';
        if (form) h += '<label class="elab">Rating for this event (100 to 3500; new players start at 1500)<input id="erset" class="ein enum" type="number" inputmode="numeric" min="100" max="3500" step="1" value="' + esc(x.use != null ? x.use : sg.value != null ? sg.value : '') + '"></label><label class="elab">Reason (logged and shown to the players)<input id="ersetr" class="ein" maxlength="120" placeholder="Club ladder position, new to the app…"></label><div class="e2"><button class="epri" data-a="rsave" data-gid="' + att(x.gid) + '">Save</button>' + (x.setBy === 'organizer' || x.setBy === 'tournament' ? '<button class="esec" data-a="rclear" data-gid="' + att(x.gid) + '">Remove set rating</button>' : '<button class="esec" data-a="rsetx">Cancel</button>') + '</div>';
      }
      h += '</div>'; });
    return h + '<div class="enote">' + esc(ODDNOTE) + '</div>';
  }
  function loadReview(s) { s.rv = null; s.rvErr = ''; post('review', { id: s.id }).then((j) => { s.rv = j.review; if (cur() === s) paint(); }).catch((x) => { s.rvErr = errText(x); if (cur() === s) paint(); }); }
  function trateV() {
    const s = cur(), e = s.ev; let p = null, ent = null; e.entrants.forEach((x) => x.players.forEach((y) => { if (y.gid === s.gid) { p = y; ent = x; } })); if (!p) return '<h1>Tournament rating</h1><div class="ecard emut">That player is no longer in the event.</div>';
    let h = '<h1>Tournament rating</h1><div class="emeta">' + esc(p.name) + (ent.players.length > 1 ? ' · ' + esc(ent.name) : '') + '</div>';
    h += '<div class="ecard"><div class="ekv"><span>Oddable rating<small>Real results from app play. Never changed here.</small></span><b>' + (p.odd && p.odd.rating != null ? esc(p.odd.rating) : 'No confirmed games') + '</b></div><div class="enote">' + esc(p.odd && p.odd.matches ? confTxt(p.odd) : 'No games in the app yet') + '</div><div class="ekv"><span>Tournament rating<small>' + (p.trn ? 'Set by the director' + (p.trn.at ? ' · ' + esc(fmtTime(p.trn.at)) : '') + (p.trn.reason ? ' · ' + esc(p.trn.reason) : '') : p.odd && p.odd.rating != null ? 'Not set: the Oddable rating is used' : 'Not set: counted as a new player (1500)') + '</small></span><b class="' + (p.trn ? 'egold' : '') + '">' + (p.trn ? esc(p.trn.v) : '—') + '</b></div></div>';
    if (e.locked) return h + '<div class="ewarn"><b>Final</b>Ratings became final when the event started.</div>';
    h += '<label class="elab">Rating for this tournament (100 to 3500; new players start at 1500)<input id="etr" class="ein enum" type="number" inputmode="numeric" min="100" max="3500" step="1" value="' + esc(s.v != null ? s.v : p.trn ? p.trn.v : p.odd && p.odd.rating != null ? p.odd.rating : '') + '"></label>';
    h += '<label class="elab">Reason (logged and shown to the players)<input id="etrr" class="ein" maxlength="120" placeholder="Club ladder position, back from injury…" value="' + esc(s.r || '') + '"></label>';
    h += '<button class="epri efull" data-a="trsave">Save for this tournament</button>' + (p.trn ? '<button class="esec efull" data-a="trclear">Remove it (use the Oddable rating)</button>' : '');
    return h + '<div class="enote">Applies to this event only: seeding, pairings and partner suggestions here. The player\'s lifetime Oddable rating is not changed, and it stays on the screen next to the tournament rating. Every change is logged. Final when the event starts.</div>';
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
      if (e.odd && d.ratings) { const used = [].concat(...x.teams).map((g) => d.ratings.find((y) => y.id === g)).filter(Boolean), tr = used.filter((y) => y.tournament != null);
        if (tr.length) h += '<div class="enote"><b>Tournament rating used</b> for ' + tr.map((y) => esc(y.name) + ': ' + y.tournament + ' (set by director; ' + esc(oddTxt({ rating: y.oddable, matches: y.matches, confirmed: y.confirmed })) + ')').join(' · ') + '</div>'; }
      if (x.leftover.length) h += '<div class="enote">Without a team yet: ' + esc(x.leftover.map((g) => { let n = g; e.entrants.forEach((en) => en.players.forEach((p) => { if (p.gid === g) n = p.name; })); return n; }).join(', ')) + '</div>';
      if (comm && !d.locked) h += '<button class="' + (i === 0 ? 'epri' : 'esec') + ' efull" data-a="useteams" data-i="' + i + '">Use these teams</button>';
      h += '</div>'; });
    if (e.odd && d.ratings && d.ratings.length) h += '<div class="ecard"><h2>Ratings used</h2>' + d.ratings.map((y) => '<div class="emrow"><span><b>' + esc(y.name) + '</b><small>' + (y.tournament != null ? 'Tournament rating ' + y.tournament + ' used (set by director) · ' : '') + esc(oddTxt({ rating: y.oddable, matches: y.matches, confirmed: y.confirmed })) + '</small></span><b>' + (y.use != null ? y.use : 1500) + '</b></div>').join('') + '</div>';
    return h + '<div class="enote">' + (e.odd ? esc(ODDNOTE) + ' ' : '') + 'Based on ' + d.players + ' players and ' + d.history + ' past game' + (d.history === 1 ? '' : 's') + ' they played as partners.' + (d.locked ? ' Teams became final when the event started.' : '') + '</div>';
  }
  function loadPartners(s) { s.sug = null; post('partners', { id: s.id, mode: s.mode || 'balanced' }).then((j) => { s.sug = j; if (cur() === s) paint(); }).catch((x) => { err = errText(x); s.sug = { suggestions: [], teamSize: 2, players: 0, history: 0 }; if (cur() === s) paint(); }); }
  // ---- L6: the pot and the prize pool drill down to what is behind them ----
  function moneyV() {
    const s = cur(), e = s.ev, p = e.pot, rows = []; e.entrants.forEach((x) => x.players.forEach((q) => { if (!q.blank) rows.push({ name: q.name, sub: (x.players.length > 1 ? x.name + ' · ' : '') + (q.guest ? 'typed-in player' : 'account'), paid: !!q.paid }); }));
    if (s.k === 'pool') { let h = '<h1>Prize pool</h1><div class="emeta">' + esc(e.title) + '</div><div class="ecard"><div class="ekv"><span>' + (p.pot === 'side' ? 'Side pot' : 'Main pot') + '<small>' + p.paid + ' of ' + p.players + ' players paid × ' + usd(p.entry) + '</small></span><b>' + usd(p.total) + '</b></div><div class="ekv"><span>Commissioner\'s take<small>' + esc(e.takeText) + '</small></span><b>' + (p.take ? '-' + usd(p.take) : '$0') + '</b></div><div class="ekv"><span>Prize pool</span><b class="egold">' + usd(p.pool) + '</b></div></div>';
      h += '<h3 class="eh">Prizes · ' + esc(SPLITN[e.money.split]) + '</h3>' + (p.places.length ? '<div class="ethead"><span>#</span><span>Who</span><span class="er">Prize</span></div>' + p.places.map((x) => { const w = (e.placeRows || []).filter((r) => r.place === x.place); return '<div class="etrow"><span>' + ord(x.place) + '</span><span><b>' + (w.length ? esc(w.map((r) => r.name).join(', ')) : 'Not decided') + '</b><small>' + x.pct + '% of the prize pool' + (w.length > 1 ? ' · tied places share the prizes they cover' : '') + '</small></span><span class="er"><b>' + usd(x.amt) + '</b></span></div>'; }).join('') : '<div class="ecard emut">No prizes in this event.</div>');
      return h + '<div class="enote">' + esc(MONEY) + '</div>'; }
    let h = '<h1>' + (p.pot === 'side' ? 'Side pot' : 'Main pot') + '</h1><div class="emeta">' + esc(e.title) + '</div><div class="ecard"><div class="ekv"><span>Paid so far<small>' + p.paid + ' of ' + p.players + ' players × ' + usd(p.entry) + '</small></span><b>' + usd(p.total) + '</b></div><div class="ekv"><span>Still owed<small>' + (p.players - p.paid) + ' player' + (p.players - p.paid === 1 ? '' : 's') + '</small></span><b>' + usd((p.players - p.paid) * p.entry) + '</b></div></div>';
    h += '<h3 class="eh">Players · ' + rows.length + '</h3>' + (rows.length ? '<div class="ethead e4"><span>#</span><span>Player</span><span class="er">Entry</span></div>' + rows.map((r, i) => '<div class="etrow e4"><span>' + (i + 1) + '</span><span><b>' + esc(r.name) + '</b><small>' + esc(r.sub) + '</small></span><span class="er ' + (p.entry ? (r.paid ? 'epos' : 'eyel') : 'emut') + '">' + (p.entry ? (r.paid ? 'Paid ' + usd(p.entry) : 'Owes ' + usd(p.entry)) : 'No entry') + '</span></div>').join('') : '<div class="ecard emut">No players yet.</div>');
    return h + '<div class="enote">' + (e.role === 'comm' ? 'Mark who has paid under People on the Info tab. ' : '') + esc(MONEY) + '</div>';
  }
  function infoSheet() { const s = cur(); return '<h1>' + esc(s.title) + '</h1><div class="ecard">' + esc(s.text) + '</div><div class="ecard">' + esc(s.text2 || INFO.scoring) + '</div>'; }

  // ---------- paint ----------
  const el = () => document.getElementById('oevt');
  const cur = () => stack[stack.length - 1];
  function paintBusy(on) { const e = el(); if (e) e.classList.toggle('ebusy', !!on); }
  function paint() {
    const x = el(); if (!x) return; const s = cur();
    const prev = stack[stack.length - 2], back = stack.length > 1 ? (prev.t === 'home' ? 'My events' : prev.t === 'glist' ? 'Games' : prev.t === 'event' && prev.ev && (s.sub || s.t === 'money') ? ({ matches: prev.ev.fmt === 'solo' ? 'Scores' : 'Matches', table: prev.ev.fmt === 'ladder' ? 'Ladder' : prev.ev.fmt === 'se' || prev.ev.fmt === 'de' ? 'Bracket' : 'Standings', pick: "Pick'em", info: 'Info' }[prev.tab] || 'Back') : 'Back') : '';
    const V = { glist: glistV, approve: approveV, home, joincode: joinCodeV, preview: previewV, create: createV, event: eventV, match: matchV, chal: chalV, info: infoSheet, trate: trateV, partners: partnersV, money: moneyV }[s.t];
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
    if (a === 'close') { readDraft(); try { sessionStorage.removeItem('oevt-open'); } catch (x) {} clearInterval(POLL); unmount(); return; }
    if (a === 'back') { readDraft(); err = ''; if (stack.length > 1) stack.pop(); const s = cur(); if (s.t === 'home') loadHome(); else if (s.t === 'glist') loadGlist(s); else if (s.t === 'event') load(s, true); paint(); return; }
    if (t.hasAttribute('data-tab')) { const s = cur(); s.tab = t.getAttribute('data-tab'); paint(); return; }
    if (t.hasAttribute('data-tg')) { readDraft(); const k = t.getAttribute('data-tg'); DR[k] = !DR[k]; paint(); return; }
    if (a === 'qclear') { Qset(Q().filter((x) => !x.fail)); paint(); return; }
    if (a === 'gstart') { const s = cur(); DR = draftNew({ group: { id: s.gid, name: s.gname } }); push({ t: 'create' }); return; }
    if (a === 'gopen') { const g = (cur().data && cur().data.events || []).find((x) => x.id === id); if (g && g.role && g.role !== 'none') { const s = { t: 'event', id, tab: 'matches' }; push(s); load(s); return; } const s = { t: 'preview', gj: String(id), code: '' }; push(s); act('gjoin', { id: s.gj, preview: true }, async (j) => { s.ev = j.event; paint(); }); return; }
    if (a === 'gask') { groupAskSend(cur()); return; }
    if (a === 'gcheck') { const s = cur(); if (s.ev && s.code && !gwait()) gwait({ code: s.code, at: Date.now() }); groupWaitCheck(false); return; }
    if (a === 'joincode') { push({ t: 'joincode' }); return; }
    if (a === 'lookup') { const s = cur(); s.code = (document.getElementById('ecode') || {}).value || ''; openPreview(s.code); return; }
    if (a === 'claim') { const c = (document.getElementById('eclaim') || {}).value || ''; act('claim', { claim: c.trim() }, async (j) => { rootReset(); push({ t: 'event', id: j.event.id, ev: j.event, tab: 'info' }); }); return; }
    if (a === 'dojoin') { const s = cur(); const as = t.getAttribute('data-as') || 'player'; act(s.gj ? 'gjoin' : 'join', { code: s.gj ? undefined : s.code, id: s.gj || undefined, as, eid: t.getAttribute('data-eid') || undefined, gid: t.getAttribute('data-gid') || undefined, entryName: ((document.getElementById('enewname') || {}).value || '').trim() || undefined, rating: (document.getElementById('enewrt') || {}).value || undefined }, async (j) => { rootReset(); push({ t: 'event', id: j.event.id, ev: j.event, tab: 'matches' }); }); return; }
    if (a === 'open') { const s = { t: 'event', id, tab: 'matches' }; push(s); load(s); return; }
    if (a === 'info') { const k = t.getAttribute('data-k'), inEv = cur().t === 'event' && cur().ev, sp = inEv ? inEv.sport : DR ? DR.sport : 'pickleball', rl = inEv ? inEv.rules : null; push({ t: 'info', title: 'How ' + FMTN[k].toLowerCase() + ' works', text: infoFor(k, sp, rl) + (inEv && inEv.rules.pickem ? ' ' + infoFor('pickem', sp, rl) : ''), text2: infoFor('scoring', sp, rl || { seeding: DR && DR.seeding }) }); return; }
    if (a === 'submit') { readDraft(); const p = payload(); if (p.title.length < 2) { err = 'Give the event a name (2+ characters).'; paint(); return; } act('create', p, async (j) => { DR = null; rootReset(); push({ t: 'event', id: j.event.id, ev: j.event, tab: 'info' }); try { if (p.groupId && window.OddGroups && typeof window.OddGroups.refresh === 'function') window.OddGroups.refresh(); } catch (x) {} }); return; }
    if (a === 'nogroup') { readDraft(); if (DR) DR.group = null; paint(); return; }
    const e = evOf(); if (!e) return;
    // Drill-downs (owner rule: every tile and summary row opens the detail behind it, with a Back to where you were). A tile opens its own screen; inside
    // such a screen another tile just switches it. A standings row always opens the matches of that entry, so Back returns to Standings.
    const drill = (o, always) => { const s = cur(), n = Object.assign({ t: 'event', id: e.id, ev: e, sub: true, tab: 'matches', mf: 'all', eid: null }, o); if (s.t === 'event' && s.sub && !always) { Object.assign(s, n); paint(); const x = el(); if (x) x.scrollTop = 0; } else push(n); };
    if (a === 'drill') { drill({ tab: t.getAttribute('data-to') || 'matches' }); return; }
    if (a === 'todo') { drill({ mf: 'todo' }); return; }
    if (a === 'flags') { drill({ mf: 'flags' }); return; }
    if (a === 'money') { push({ t: 'money', id: e.id, ev: e, k: t.getAttribute('data-k') }); return; }
    if (a === 'seed') { act('seeds', { id: e.id, eid: t.getAttribute('data-eid'), do: t.getAttribute('data-do') }, async (j) => { cur().ev = j.event; cur().keepScroll = true; paint(); cur().keepScroll = false; }); return; }
    if (a === 'seedkeep') { act('seeds', { id: e.id, keep: true }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'seedclear') { if (!confirm('Go back to the usual seeding order?')) return; act('seeds', { id: e.id, clear: true }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'match') { push({ t: 'match', id: e.id, ev: e, m: t.getAttribute('data-m') }); return; }
    if (a === 'ent') { drill({ mf: 'ent', eid: t.getAttribute('data-eid') }, true); return; }
    if (a === 'draw') { if (!confirm('Make the draw now? Entries and rules are final for everyone.')) return; act('draw', { id: e.id }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'invite') { invite(e); return; }
    if (a === 'poreset') { const why = (prompt('Reset the playoff? Every playoff result so far is wiped and every member is told.\n\nReason (everyone sees it):') || '').trim(); if (why.length < 2) { if (why) { err = 'Give a reason. Everyone sees it.'; paint(); } return; } act('poreset', { id: e.id, reason: why }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'poredraw') { if (!confirm('Redraw the playoff from the standings as they are now?')) return; act('poredraw', { id: e.id }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'addpartner') { const eid = t.getAttribute('data-eid'), inp = el().querySelector('input[data-pin="' + eid + '"]'), nm = ((inp && inp.value) || '').trim(); if (!nm) { err = "Type the partner's name."; paint(); return; } act('entrant', { id: e.id, do: 'partner', eid, name: nm }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'paid' || a === 'unpaid') { act('paid', { id: e.id, pid: t.getAttribute('data-pid') || undefined, gid: t.getAttribute('data-gid') || undefined, paid: a === 'paid' }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'addent') { const v = (document.getElementById('eadd') || {}).value || '', m = /^(.*?)(?:[,;]\s*(\d+(?:\.\d+)?))?$/.exec(v.trim()); act('entrant', { id: e.id, do: 'add', name: m[1], rating: m[2] || '' }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'rment') { if (!confirm('Remove this entry?')) return; act('entrant', { id: e.id, do: 'remove', eid: t.getAttribute('data-eid') }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'delete') { if (!confirm('Delete this event for everyone?')) return; act('delete', { id: e.id }, async () => { rootReset(); paint(); }); return; }
    if (a === 'leave') { if (!confirm('Leave this event?')) return; act('leave', { id: e.id }, async () => { rootReset(); paint(); }); return; }
    if (a === 'finish') { if (!confirm('Finish the event now? Places are final.')) return; act('finish', { id: e.id }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'chal') { push({ t: 'chal', id: e.id, ev: e }); return; }
    if (a === 'tbreak') { const how = t.getAttribute('data-how'); if (!confirm(how === 'coin' ? 'Settle this tie with a coin flip? Oddable flips it now. It is final and logged.' : 'Settle this tie with a tiebreak playoff? The matches are added now. This cannot be switched to a coin flip later.')) return; act('tiebreak', { id: e.id, key: t.getAttribute('data-k'), how }, async (j) => { cur().ev = j.event; cur().tab = how === 'coin' ? 'table' : 'matches'; paint(); }); return; }
    if (a === 'plock') { if (!confirm('Close picks for this round now? It cannot be undone.')) return; act('picklock', { id: e.id, round: t.getAttribute('data-k'), lock: true }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'plockat') { const inp = el().querySelector('input[data-plk="' + t.getAttribute('data-k') + '"]'), ms = inp && inp.value ? new Date(inp.value).getTime() : NaN; if (!(ms > Date.now())) { err = 'Pick a closing time in the future.'; paint(); return; } act('picklock', { id: e.id, round: t.getAttribute('data-k'), at: ms }, async (j) => { cur().ev = j.event; paint(); }); return; }
    const updAll = (j) => { stack.forEach((x) => { if (x.id === e.id) x.ev = j.event; }); };
    if (a === 'trate') { push({ t: 'trate', id: e.id, ev: e, gid: t.getAttribute('data-gid') }); return; }
    // fourth review H2 + M2: approval screen, co-sign, co-organizers
    const afterAp = (j) => { updAll(j); const s = cur(); if (s.t === 'approve') loadReview(s); else paint(); };
    if (a === 'apopen') { const s = { t: 'approve', id: e.id, ev: e, f: 'all' }; push(s); loadReview(s); return; }
    if (a === 'apflt') { cur().f = t.getAttribute('data-f'); paint(); return; }
    if (a === 'apall') { if (!confirm("Use everyone's Oddable rating as shown? Unconfirmed numbers are approved too; you can still set any player's number before the start.")) return; act('approve', { id: e.id, all: true }, async (j) => afterAp(j)); return; }
    if (a === 'apone') { act('approve', { id: e.id, gid: t.getAttribute('data-gid'), value: Number(t.getAttribute('data-v')) }, async (j) => afterAp(j)); return; }
    if (a === 'rsetf') { cur().set = t.getAttribute('data-gid'); paint(); return; }
    if (a === 'rsetx') { cur().set = null; paint(); return; }
    if (a === 'rsave' || a === 'rclear') { const v = (document.getElementById('erset') || {}).value, r = ((document.getElementById('ersetr') || {}).value || '').trim(); if (r.length < 2) { err = 'Give a reason. It is logged and shown to the players.'; paint(); return; } act('rset', { id: e.id, gid: t.getAttribute('data-gid'), rating: a === 'rclear' ? '' : v, reason: r }, async (j) => { cur().set = null; afterAp(j); }); return; }
    if (a === 'cosignask') { if (!confirm('Ask a co-organizer or a player on another team to co-sign your rating? Everyone in the event is told.')) return; act('cosign', { id: e.id, ask: true }, async (j) => afterAp(j)); return; }
    if (a === 'cosign') { if (!confirm('Co-sign ' + (e.cosign ? e.cosign.name + "'s rating " + e.cosign.value : 'this rating') + '? Your name is logged with it.')) return; act('cosign', { id: e.id }, async (j) => afterAp(j)); return; }
    if (a === 'acceptme') { act('seatok', { id: e.id }, async (j) => afterAp(j)); return; }
    if (a === 'cosigncancel') { act('cosign', { id: e.id, cancel: true }, async (j) => afterAp(j)); return; }
    if (a === 'coorg') { const on = !!t.getAttribute('data-on'); if (on && !confirm('Make this person a co-organizer? They approve ratings with you, can co-sign your own, set pick\'em closing times, and cannot pick.')) return; act('coorg', { id: e.id, pid: t.getAttribute('data-pid'), on }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'trsave' || a === 'trclear') { const s = cur(); s.v = (document.getElementById('etr') || {}).value; s.r = ((document.getElementById('etrr') || {}).value || '').trim(); if (s.r.length < 2) { err = 'Give a reason. It is logged and shown to the players.'; paint(); return; } act('trate', { id: e.id, gid: s.gid, rating: a === 'trclear' ? '' : s.v, reason: s.r }, async (j) => { updAll(j); stack.pop(); paint(); }); return; }
    if (a === 'partners') { const s = { t: 'partners', id: e.id, ev: e, mode: 'balanced' }; push(s); loadPartners(s); return; }
    if (t.hasAttribute('data-pm')) { const s = cur(); s.mode = t.getAttribute('data-pm'); paint(); loadPartners(s); return; }
    if (a === 'useteams') { const s = cur(), x = s.sug && s.sug.suggestions[+t.getAttribute('data-i')]; if (!x) return; if (!confirm('Use these teams?\n\n' + x.names.map((n) => n.join(' & ')).join('\n') + '\n\nYou can change them again until the event starts.')) return; act('teams', { id: e.id, teams: x.teams, mode: s.mode }, async (j) => { updAll(j); stack.pop(); cur().tab = 'info'; paint(); }); return; }
    if (a === 'dochal') { act('challenge', { id: e.id, a: t.getAttribute('data-a2'), b: t.getAttribute('data-b2') }, async (j) => { cur().ev = j.event; cur().tab = 'matches'; paint(); }); return; }
    if (a === 'sendchal') { const A = document.getElementById('cha').value, B = (document.getElementById('chb') || {}).value; act('challenge', { id: e.id, a: A, b: B, side: e.fmt !== 'ladder' && e.fmt !== 'h2h' }, async (j) => { stack.pop(); cur().ev = j.event; cur().tab = 'matches'; paint(); }); return; }
    if (a === 'pick') { const pm = e.matches.find((x) => x.id === t.getAttribute('data-m')), sd = t.getAttribute('data-side'); if (!confirm('Pick ' + (pm ? (sd === 'a' ? pm.an : pm.bn) : 'this side') + '?\n\nPicks are final when you enter them. You cannot change it.')) return; act('pick', { id: e.id, m: t.getAttribute('data-m'), side: t.getAttribute('data-side') }, async (j) => { cur().ev = j.event; cur().keepScroll = true; paint(); cur().keepScroll = false; }); return; }
    if (a === 'tb') { const tv = Number((document.getElementById('etb') || {}).value); if (!Number.isInteger(tv) || tv < 0) { err = 'Type the total points you expect in the final.'; paint(); return; } if (!confirm('Save ' + tv + ' as your tiebreak guess? It is final: you cannot change it.')) return; act('pick', { id: e.id, tb: Number((document.getElementById('etb') || {}).value) }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'solo') { act('solo', { id: e.id, eid: document.getElementById('esoloe').value, score: Number(document.getElementById('esolov').value) }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'voice') { openVoice(e, t.getAttribute('data-k')); return; }
    const s = cur(), m = e.matches.find((x) => x.id === s.m); if (!m) return;
    const upd = async (j) => { stack.forEach((x) => { if (x.id === e.id) x.ev = j.event; }); paint(); };
    if (a === 'savescore') { const g = readGames(m.rule ? m.rule.bestOf : e.rules.bestOf); s.g = g; if (!g.length) { err = 'Type the game scores.'; paint(); return; } sendScore(e, m, g); return; }
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
  const link = (code) => 'https://steves-pics.onrender.com/?join=e.' + encodeURIComponent(code);
  function invite(e) {
    const text = 'Join "' + e.title + '" (' + FMTN[e.fmt] + ', ' + SPORTN[e.sport] + ') on Oddable';
    if (window.OddJoin && typeof window.OddJoin.share === 'function') { try { window.OddJoin.share({ type: 'e', code: e.code, title: e.title, text }); return; } catch (x) {} }
    if (navigator.share) { navigator.share({ title: e.title, text, url: link(e.code) }).catch(() => {}); return; }
    const s = cur(); s.inv = 1; const x = el().querySelector('[data-a="invite"]'); if (!x) return;
    const box = document.createElement('div'); box.className = 'ecard'; box.innerHTML = '<small class="emut">Invite link</small><div class="ecopy"><code>' + esc(link(e.code)) + '</code></div><div class="e2"><button class="esec" data-a2="copy">Copy link</button><a class="epri" href="sms:?&body=' + encodeURIComponent(text + ': ' + link(e.code)) + '">Text it</a></div>';
    box.querySelector('[data-a2="copy"]').onclick = (ev2) => { ev2.stopPropagation(); const b2 = ev2.currentTarget, byHand = () => { b2.textContent = 'Press and hold the link to copy it'; const c = box.querySelector('code'); try { const r = document.createRange(); r.selectNodeContents(c); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); } catch (y) {} };
      try { const pr = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(link(e.code)) : null; if (pr && typeof pr.then === 'function') pr.then(() => { b2.textContent = 'Copied'; }).catch(byHand); else byHand(); } catch (y) { byHand(); } };
    x.insertAdjacentElement('afterend', box);
  }
  async function openPreview(code) {
    const s = { t: 'preview', code }; push(s);
    if (!tok()) { // signed out: the public peek shows only the title and kind; sign up / sign in, then the same link opens the join screen
      try { const j = await post('peek', { code, dev: dev() }); s.peek = j; } catch (e) { err = errText(e); } paint(); return;
    }
    try { const j = await post('preview', { code }); s.ev = j.event; s.code = code; if (j.event && j.event.groupOnly && j.event.groupAsk && j.event.groupAsk.state === 'pending' && !gwait()) gwait({ code, at: Date.now() }); } catch (e) { err = errText(e); } paint();
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
    st.textContent = R + '{--gbg:var(--bg,#0a0c10);--gp:var(--panel,#13161d);--gp2:var(--panel2,#1b1f29);--gl:var(--line,#272c38);--gi:var(--ink,#eef0f4);--gm:var(--muted,#8b93a3);--gv:var(--blue,#a78bfa);--gg:var(--green,#4fd18b);--gr:var(--red,#ff5a4d);--gy:#f5c542;--gyt:var(--gold,#e0b030);--hg:linear-gradient(135deg,#7c3aed 0%,#4c1d95 55%,#1b1f29 100%);--hs:#ede4ff;--pbg:var(--blue,#7c3aed);--pfg:var(--onblue,var(--bg,#fff));--pbd:var(--blue,#7c3aed);position:fixed;inset:0;background:var(--gbg);color:var(--gi);overflow:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left}'
      + 'html.cb ' + R + '{--hg:linear-gradient(135deg,#003594 0%,#002b5c 38%,#041e42 74%,#08111f 100%);--hs:#c6cbd7;--pbg:#003594;--pfg:#fff;--pbd:#c6cbd7}'
      // M5 (third review): every text colour is 4.5:1 or better on the surfaces it sits on, in every theme. The light theme gets its own darker green, red
      // and gold for TEXT (white, tinted and gold cards); buttons on the brand colour use --onblue. Checked by the Playwright contrast audit.
      + 'html:not(.cb) body:not(.dark) ' + R + '{--gy:#b7791f;--gyt:var(--gold,#7a5600);--gg:#0b6b3f;--gr:#a8201a;--gm:#55506a;--pbg:#6d28d9;--pbd:#6d28d9;--pfg:var(--onblue,#fff)}' // navy (html.cb) is dark with the light switch on or off, like the app
      + '#oevt{z-index:97}#ocat{z-index:96}' + R + ' .ein0{max-width:720px;margin:0 auto;padding:0 16px calc(48px + env(safe-area-inset-bottom))}' + R + '.ebusy .epri{opacity:.6}' + R + ' *{box-sizing:border-box}'
      // header: the app's gradient header with rounded bottom corners (sticky back / close row inside it)
      + R + ' .ehead{margin:0 -16px 10px;padding:max(10px,env(safe-area-inset-top)) 16px 14px;background:var(--hg);border-radius:0 0 26px 26px;color:#fff}html.cb ' + R + ' .ehead{border-bottom:3px solid #869397}'
      + R + ' .ehead h1{color:#fff}' + R + ' .ehead .emeta,' + R + ' .ehead .esub{color:var(--hs)}' + R + ' .ehead .eback,' + R + ' .ehead .ex{color:#fff}'
      + R + ' h1{font-size:28px;line-height:1.15;margin:8px 0 2px;overflow-wrap:anywhere;color:var(--gi)}' + R + ' h2{font-size:17px;margin:0 0 10px}' + R + ' .esub{color:var(--gm);margin:2px 0 0;font-size:13px}'
      + R + ' .etop{display:flex;justify-content:space-between;align-items:center}'
      + R + ' button,' + R + ' a.epri{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}' + R + ' a.epri{color:var(--pfg)}'
      + R + ' .eback,' + R + ' .ex,' + R + ' .einfo{background:none;border:0;color:var(--gv);font-weight:700;min-height:44px;padding:0 4px;text-align:left}' + R + ' .ex{opacity:.85}' + R + ' .einfo{display:block;width:100%}' + R + ' a.einfo{display:flex;align-items:center;text-decoration:none}'
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
      + R + ' .epill{border:1px solid var(--gl);border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;text-align:right;color:var(--gm)}' + R + ' .epill.eok{border-color:var(--gg);color:var(--gg)}' + R + ' .epill.ebad{border-color:var(--gr);color:var(--gr)}' + R + ' .epill.ewait{border-color:var(--gold,var(--gy));color:var(--gyt)}' /* gold cards: */
      // on the gold highlight cards small grey text and the red pill use the ink colour (the tint lowers their contrast)
      + R + ' .ematch.act small,' + R + ' .ematch.act .epill,' + R + ' .ecard.egoldc .emeta,' + R + ' .ecard.egoldc small,' + R + ' .ecard.egoldc .ebadge,' + R + ' .egold2 small,' + R + ' .ewarn small,' + R + ' .ewarn .enote,' + R + ' .ewarn .emut,' + R + ' .ematch.hit small,' + R + ' .ematch.miss small{color:var(--gi)}' + R + ' .ewarn .enby{display:block;margin-top:4px;font-size:12px}' + R + ' .ecard.egoldc,' + R + ' .ematch.act,' + R + ' .egold2,' + R + ' .ewarn{--gm:var(--gi);--gv:var(--gi)}'
      + R + ' button.ekvb{width:100%;background:none;border:0;border-bottom:1px solid var(--gl);border-radius:0;text-align:left;min-height:48px;color:var(--gi);align-items:center}' + R + ' .eud{display:flex;gap:6px;flex:0 0 auto}' + R + ' .eud .etiny{min-width:48px}'
      + R + ' .ethead,' + R + ' .etrow{display:grid;grid-template-columns:34px minmax(0,1fr) 80px;gap:8px;align-items:center}' + R + ' .ethead.e5,' + R + ' .etrow.e5{grid-template-columns:34px minmax(0,1fr) 58px 58px}' + R + ' .ethead.e4,' + R + ' .etrow.e4{grid-template-columns:34px minmax(0,1fr) 112px}' + R + ' .etrow.e1{grid-template-columns:minmax(0,1fr)}' + R + ' .ethead.e3c,' + R + ' .etrow.e3c{grid-template-columns:72px minmax(0,1fr) minmax(0,1fr)}'
      + R + ' .ethead{color:var(--gm);font-size:12px;font-weight:700;padding:6px 12px 2px}' + R + ' .etrow{width:100%;text-align:left;background:var(--gp);border:1px solid var(--gl);border-radius:14px;padding:8px 12px;margin:4px 0;min-height:48px;color:var(--gi)}' + R + ' .etrow b{display:block;overflow-wrap:anywhere}' + R + ' .etrow small{display:block;color:var(--gm);font-size:12px}' + R + ' .ecard .etrow{background:var(--gp2)}' + R + ' .ethead .er{text-align:right}'
      + R + ' .erules>div{display:flex;flex-direction:column;padding:6px 0;border-bottom:1px solid var(--gl)}' + R + ' .erules>div:last-child{border-bottom:0}' + R + ' .erules small{color:var(--gm);font-size:12px}' + R + ' .erules span{overflow-wrap:anywhere}'
      + R + ' .ekv{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--gl)}' + R + ' .ekv:last-child{border-bottom:0}' + R + ' .ekv span{min-width:0}' + R + ' .ekv small{display:block;color:var(--gm);font-size:12px}' + R + ' .ekv b{text-align:right;white-space:nowrap}'
      + R + ' .emrow{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:48px;border-bottom:1px solid var(--gl);padding:6px 0}' + R + ' .emrow:last-child{border-bottom:0}' + R + ' .emrow>span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}' + R + ' .emrow small{display:block;color:var(--gm);font-size:12px}' + R + ' .emrow i{font-style:normal}'
      + R + ' .emrow small.eplr{margin-top:5px;font-size:13px}' + R + ' small.eflag{display:block;margin:4px 0 0;font-size:13px;color:var(--gyt,var(--muted));line-height:1.35}' + R + ' .emk{margin-top:8px;font-size:13px;overflow-wrap:anywhere}' + R + ' .emk details{margin-top:4px}' + R + ' .emk .skv{display:flex;justify-content:space-between;gap:8px;padding:4px 0}' + R + ' .emk .skv>span small{display:block;color:var(--muted)}' + R + ' .emk .skv>b{text-align:right;white-space:nowrap}' + R + ' .emk .skv>b small{display:block;font-weight:400;color:var(--muted)}' + R + ' .emrow .ecob{display:block;margin:6px 0 2px;font-size:13px}' + R + ' .erate{color:var(--gi);font-weight:600}' + R + ' .emrow .ebadge{padding:2px 8px;font-size:11px}' + R + ' .erbtn{display:block;margin:6px 0 4px;font-size:13px}'
      + R + ' .etiny{background:var(--gp2);border:1px solid var(--gl);border-radius:10px;color:var(--gi);min-height:44px;min-width:64px;padding:0 10px;font-weight:600}' + R + ' .ecopy code{font-size:13px;overflow-wrap:anywhere;word-break:break-all;color:var(--gi)}' + R + ' .eaud{padding:6px 0;border-bottom:1px solid var(--gl);overflow-wrap:anywhere}' + R + ' .eaud:last-child{border-bottom:0}' + R + ' .eaud small{display:block;color:var(--gm);font-size:12px}'
      + R + ' .eib{width:44px;height:44px;border:0;background:none;color:var(--gv);font-size:20px;flex:0 0 auto}' + R + ' .egame{display:flex;flex-direction:column;gap:4px;text-align:left;color:inherit}' + R + ' .egame b{font-size:16px}'
      + '@media (max-width:360px){' + R + ' .e3{grid-template-columns:1fr 1fr}}';
    document.head.appendChild(st);
  }
  // The header part of a screen (its h1 and the line under it) goes into the app's gradient header, with the Back / Close row.
  function withHead(topHtml, body) { const m = /^(<h1>[\s\S]*?<\/h1>(?:<(div|p) class="e(?:meta|sub)">[^<]*(?:<[^d/][^>]*>[^<]*<\/[^>]+>[^<]*)*<\/\2>)?)/.exec(body); return '<div class="ehead">' + topHtml + (m ? m[1] : '') + '</div>' + (m ? body.slice(m[1].length) : body); }
  function mount() { css(); let x = el(); if (x) x.remove(); x = document.createElement('div'); x.id = 'oevt'; x.className = 'oo'; x.setAttribute('role', 'dialog'); x.setAttribute('aria-label', 'Events'); x.innerHTML = '<div class="ein0"></div>'; document.body.appendChild(x); x.style.zIndex = String(1 + Math.max(95, ...Array.from(document.querySelectorAll('#ogrp,#oevt,#ocat,#odash')).filter((y) => y !== x).map((y) => +getComputedStyle(y).zIndex || 0))); x.addEventListener('click', click); x.addEventListener('change', change); try { sessionStorage.setItem('oevt-open', '1'); } catch (y) {} registerVoice(); poll(); return x; }
  // Opened from a group hub: a member already in the event goes straight in; any other member of the group gets the join screen (POST /events/gjoin).
  async function openGroup(id) {
    mount(); hookBar(); stack = [{ t: 'home' }]; err = ''; paint(); if (tok()) loadHome(); else H = { events: [] }; const s = { t: 'preview', gj: String(id), code: '' }; push(s);
    try { const j = await post('gjoin', { id: s.gj, preview: true }); if (j.event.role && j.event.role !== 'none') { stack.pop(); push({ t: 'event', id: j.event.id, ev: j.event, tab: 'matches' }); return; } s.ev = j.event; } catch (e) { err = errText(e); s.ev = null; s.fail = true; } if (cur() === s) paint();
  }
  // ---------- MAIN PORT: a group's Pickleball & local games (POST /levents/glist: that group's members only) ----------
  function rootReset() { const r = stack[0] && stack[0].t === 'glist' ? stack[0] : { t: 'home' }; stack = [r]; if (r.t === 'glist') loadGlist(r); else loadHome(); }
  async function loadGlist(s) { try { s.data = await post('glist', { groupId: s.gid }); s.fail = ''; } catch (e) { s.fail = errText(e); if (!s.data) s.data = null; } if (cur() === s) paint(); }
  const HOWK = [['rr', 'Round robin'], ['se', 'Single elimination'], ['de', 'Double elimination'], ['ladder', 'Ladder'], ['h2h', 'Heads-up challenges'], ['solo', 'Solo / skills score']];
  function glistV() {
    const s = cur(), d = s.data; let h = '<h1>Pickleball &amp; local games</h1><p class="esub">' + esc(s.gname || 'Your group') + ' · round robin, brackets, ladder, heads-up and pick\'em. Players enter scores, the other side confirms.</p>';
    if (s.fail && !d) return h + '<div class="ewarn"><b>Could not load this group\'s games</b>' + esc(s.fail) + '</div>';
    if (!d) return h + '<div class="ecard">Loading…</div>';
    if (d.comm) h += '<button class="epri" data-a="gstart">Start a game</button>';
    const live = d.events.filter((e) => !e.fin), done = d.events.filter((e) => e.fin);
    if (!d.events.length) h += '<div class="ecard emut">' + (d.comm ? 'No game in this group yet. Start one: the group\'s members join it from here or with the invite link.' : 'No game in this group yet. The group\'s commissioner starts one.') + '</div>';
    const card = (e) => '<button class="ecard ebtn" data-a="gopen" data-id="' + att(e.id) + '"><div class="erow"><b class="ename">' + esc(e.title) + '</b>' + (e.role === 'comm' ? '<span class="ebadge">Organizer</span>' : e.role === 'spectator' ? '<span class="ebadge">Watching</span>' : e.role === 'player' ? '<span class="ebadge">Playing</span>' : '<span class="ebadge">Join ›</span>') + '</div>'
      + '<div class="emeta">' + fmtLine(e) + '</div><div class="emeta">' + (e.fin ? 'Final' + (e.myPlace ? ' · you finished ' + ord(e.myPlace) : '') : e.started ? 'Under way' : 'Starts ' + esc(fmtTime(e.start))) + ' · ' + e.people + ' ' + (e.people === 1 ? 'person' : 'people') + (e.todo ? ' · <b>' + e.todo + ' to do</b>' : '') + '</div></button>';
    if (live.length) h += '<div class="emeta" style="margin:12px 2px 4px"><b>Open</b></div>' + live.map(card).join('');
    if (done.length) h += '<div class="emeta" style="margin:12px 2px 4px"><b>Final</b></div>' + done.map(card).join('');
    h += '<div class="ecard"><h2>How it works</h2>' + HOWK.map(([k, n]) => '<button class="einfo" data-a="info" data-k="' + k + '">ⓘ How ' + esc(n.toLowerCase()) + ' works</button>').join('') + '<div class="enote">' + esc(infoFor('scoring', 'pickleball')) + '</div><div class="enote">' + esc(CAPLINE) + '</div></div>';
    return h;
  }
  // Beside the tab bar like the Groups overlay (pics/groups.js fit()): above the bar on a phone, right of the rail from 900 px. A tap on the bar closes this.
  function fit() { const e = el(), bn = document.getElementById('bn'); if (!e) return; let r = bn ? bn.getBoundingClientRect() : null; if (r && !(r.width && r.height)) r = null; const rail = !!r && r.height > r.width; e.style.left = rail ? Math.round(r.right) + 'px' : '0'; e.style.bottom = r && !rail ? Math.max(0, Math.round(window.innerHeight - r.top)) + 'px' : '0'; e.style.top = '0'; e.style.right = '0'; }
  const onBar = () => { try { sessionStorage.removeItem('oevt-open'); } catch (x) {} clearInterval(POLL); unmount(); };
  function unmount() { const x = el(); if (x) x.remove(); window.removeEventListener('resize', fit); const bn = document.getElementById('bn'); if (bn) bn.removeEventListener('click', onBar, true); }
  function hookBar() { window.addEventListener('resize', fit); const bn = document.getElementById('bn'); if (bn) { bn.removeEventListener('click', onBar, true); bn.addEventListener('click', onBar, true); } fit(); }
  function openFromGroup(groupId, gr) { mount(); hookBar(); err = ''; const r = { t: 'glist', gid: String(groupId || ''), gname: (gr && gr.name) || '' }; stack = [r]; paint(); loadGlist(r); flush(); }
  // The group's Games card (OddGroups.addGame registry, v274): its state from the same glist call.
  async function gstate(gr) { const j = await post('glist', { groupId: gr.id }), L = j.events || [], o = L.filter((e) => !e.fin); if (o.length) return { k: 'open', text: esc(o[0].title) + (o.length > 1 ? ' + ' + (o.length - 1) + ' more' : '') + ' · ' + (o[0].started ? 'under way' : 'starts ' + esc(fmtTime(o[0].start))) }; if (L.length) return { k: 'finished', text: 'Final · ' + esc(L[0].title) }; return { k: 'none', text: j.comm ? 'None yet · start one' : 'None yet' }; }
  function register() { try { if (window.OddGroups && typeof window.OddGroups.addGame === 'function') return window.OddGroups.addGame({ key: 'pickleball', title: 'Pickleball & local games', blurb: 'Round robin, brackets, ladder, heads-up and pick\'em. Players enter scores, the other side confirms.', open: (gr) => openFromGroup(gr.id, gr), state: gstate }); } catch (e) {} return false; }
  window.OddEvents = {
    openGroup, openFromGroup, register, INFO, infoFor, css, esc, att, head: withHead,
    open: () => { mount(); hookBar(); stack = [{ t: 'home' }]; err = ''; paint(); loadHome(); flush(); },
    create: (o) => { mount(); hookBar(); stack = [{ t: 'home' }]; err = ''; DR = draftNew(o); stack.push({ t: 'create' }); paint(); loadHome(); },
    join: (code) => { mount(); hookBar(); stack = [{ t: 'home' }]; err = ''; paint(); if (tok()) loadHome(); else H = { events: [] }; openPreview(code); },
  };
  window.oddEvents = window.OddEvents.open;
  // Shared invite router (pics/join.js, Groups branch): ?join=e.<code> -> this preview. Without the router, read the link here (signed-in phones only).
  function hookJoin() {
    // (ref, ctx) from the invite router and from a group hub: OddJoin.openGame('events' | 'event' | 'e', ref, {groupId, create: true, name}) = the commissioner
    // creates an event for that group; openGame(type, <event id>, {groupId}) = a member opens the group's event; a plain code = the invite preview.
    const fromHub = (ref, ctx) => { const c = ctx && typeof ctx === 'object' ? ctx : {}; if (c.create) return window.OddEvents.create({ group: { id: c.groupId, name: c.name || '' } }); if (c.groupId && /^[A-Z2-9]{10}$/.test(String(ref || ''))) return openGroup(String(ref)); return window.OddEvents.join(ref); };
    if (window.OddJoin && typeof window.OddJoin.register === 'function') { ['e', 'event', 'events'].forEach((k) => window.OddJoin.register(k, fromHub)); return true; }
    return false;
  }
  window.OddEvents.groupWaitCheck = groupWaitCheck;
  hookJoin(); register(); // main port: ?join=e.<code> links are captured and routed by index.html (grpCapture / levJoinRun), not read here
  try { if (sessionStorage.getItem('oevt-open') === '1') setTimeout(() => { if (!el() && tok()) window.OddEvents.open(); }, 1500); } catch (e) {}
  setTimeout(() => { if ((!el() || cur().t === 'home') && gwait()) groupWaitCheck(true); }, 2500); // review H1: asked to join the event's group earlier and let in since: the event opens again
})();
