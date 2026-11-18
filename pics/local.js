// Oddable PICKLEBALL AS A GROUP GAME (main, branch pb-group, Nov 17 2026). Ported from the preview's pics/events.js (872e74a), the same way v273 brought
// Golf days in: fetched by pics/groups.js the first time a member taps the Pickleball tile on a group page (local.js?v=<GDV>), never before, and only for an
// account the server switched Groups on for. It draws its own screen (#oevt) exactly over the Groups screen (#ogrp, same left / bottom, one z-index above),
// so the tab bar stays visible and the floating My Bets banner (z-index 40) never sits on a button. Back on its first screen returns to the group page.
// Every rule, score and standing comes from the server (odds-api/local.js, routes /local/<op>, each call carries the group id `g`); this file only shows them.
// NO MONEY: no entry, no pot, no payout, nothing collected, held, paid or ordered, and nothing is sent to anyone. No invite link: members open a game from
// the group page. Pickleball only; every other sport in the games list says Coming soon.
(function () {
  const API = 'https://calcutta-odds.onrender.com/local/'; // same server as pics/groups.js
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
  const ODDNOTE = 'Oddable rating: built from the games you play in the app that the other side confirmed (Elo method, new players start at 1500). Games against typed-in players, results the commissioner made final and forfeits are kept as records but do not move it. Unofficial: not a DUPR or tournament rating.';
  // E-H + addendum (owner Nov 16 2026): a director's tournament rating never hides the real-results Oddable rating
  // "x of y games confirmed" goes next to every rating: only games confirmed by an account on the other side move it
  const confTxt = (o) => (o && o.matches ? (o.confirmed || 0) + ' of ' + o.matches + ' game' + (o.matches === 1 ? '' : 's') + ' confirmed' : 'no games yet');
  const oddTxt = (o) => (!o || !o.matches ? 'Oddable: no games yet' : o.rating == null ? 'Oddable: no confirmed games yet (' + confTxt(o) + '; seeded as a new player, 1500)' : 'Oddable ' + o.rating + ' (real results, ' + confTxt(o) + ')');
  const rateLine = (p) => oddTxt(p.odd) + (p.trn ? ' · Tournament ' + p.trn.v + ', set by director' : '');
  const PMODES = [['balanced', 'Balanced', 'Team ratings as close as possible, so matches are fair.'], ['rotate', 'Rotate', 'Partners who have not played together lately.'], ['hot', 'Hot pairs', 'The best records together, from lifetime results.']];
  const SPLITN = { '100': 'Winner takes all', '60/30/10': '60 / 30 / 10', '50/30/20': '50 / 30 / 20', '70/30': '70 / 30', none: 'None' };
  const MONEY = 'No money in group games: nothing is collected, held or paid through Oddable. Bragging rights only.';
  const CAPLINE = 'Up to 8 people per game, counting the organizer, players, spectators and typed-in players.'; // fallback only: the server's own sentence wins
  const capLine = () => (H && H.capText) || CAPLINE; // S2 (review Nov 17 2026): the server says the real limit (list capText, each game's entText)
  // Plain-language explanations, accurate for the sport and the rules in force (also used by the sport catalog through window.OddEvents.infoFor / INFO).
  const infoFor = (k, sport, rules) => {
    const P = sport === 'pickleball', pt = sport === 'tennis' ? 'game' : 'point', r = rules || {};
    const T = {
      rr: 'Everyone plays everyone once. Odd numbers get a bye each round (one sits out, each entry once). Matches fill the courts round by round. Standings follow ' + (P ? 'the pickleball rulebook order' : 'one order for every sport in Oddable') + ': most wins, then head-to-head among the tied, ' + pt + ' differential, head-to-head ' + pt + ' differential, then ' + pt + ' differential against the next-highest entry. A tie nothing breaks is a shared place, unless it decides a top place or a playoff spot: then the organizer settles it with a coin flip (the default) or a playoff (a house rule, order drawn at random), and the choice is logged. The seed never breaks a tie. With more than one pool, entries that finish in the same position in different pools share the place. Optional playoff: the top 2, 4, 8 or 16 go to a single-elimination bracket. The organizer taps Finish once every score is right (it also finishes by itself 12 hours after the last result).',
      se: 'Lose once and you are out. Seeds come from ' + (P ? 'the Oddable rating (built from confirmed games played in the app; unofficial), a random draw, or your own order' : 'the typed rating, the Oddable rating (unofficial, from confirmed games in the app), a random draw, or your own order') + '; top seeds get byes when the count is not a power of two. Winners move on until one is left.',
      de: 'You are out after two losses. A first loss drops you to the losers bracket. Its winner meets the winners-bracket champion in the final; if the losers-bracket side wins that, a second final decides it (bracket reset) because both now have one loss. ' + (P && r.reset !== 'match' ? 'The reset is one game to 15, win by 2 (pickleball rulebook)' + (rules ? '.' : '; the organizer can choose a full match instead.') : 'The reset is a full match under the normal rules of the game.'),
      ladder: 'Everyone starts on a ranked ladder. Challenge anyone up to N spots above you; a challenge must be played within the set days. Win and you take the higher spot (swap places, or move in and push the rest down one). A challenge not played in time is a forfeit win for the challenger, or is cancelled, as the commissioner set.',
      h2h: 'Pair against pair or player against player, best of 1, 3 or 5 ' + (sport === 'tennis' ? 'sets' : 'games') + '. Challenge someone, they accept, you play, the scorer enters it and the other side confirms. Records and ' + pt + ' differential build up over the game.',
      pickem: "Spectators (and players) pick the winner of every match before its round starts. Players cannot pick their own matches. Every pick is saved and locked the moment you make it. A round closes for picking at the lock time the commissioner set, when the commissioner locks it, or the moment its first match starts or gets a score, whichever comes first. Most correct picks wins (or later rounds count more, the final the most, if the commissioner chose that); the tiebreak is the closest guess of the final's total points.",
      solo: 'A drill or skills game with a number: serves in, free throws made, a putting contest, a bowling series. Each player enters their own score (the commissioner can enter it for anyone). Highest wins, or lowest if the commissioner said so. Works with one player for practice.',
      scoring: 'Scores are typed in by the match’s designated scorer, and the other side confirms them. A disputed score goes to the commissioner, who decides. Every entry, confirmation, dispute and correction is in the game history.' + (P || r.seeding === 'oddable' ? ' Only a result confirmed by an account on the other side counts toward the Oddable rating: results against typed-in players, results the commissioner made final, forfeits, and more than 2 matches a day against the same opponents do not.' : ''),
      invite: 'Members of this group open the game from the group page and join it there. Someone outside the group joins the group first.',
    };
    return T[k] || '';
  };
  const INFO = {}; ['rr', 'se', 'de', 'ladder', 'h2h', 'pickem', 'solo', 'scoring', 'invite'].forEach((k) => { INFO[k] = infoFor(k, 'pickleball'); }); // pickleball wording; other sports ask infoFor(k, sport)
  let stack = [{ t: 'home' }], H = null, busy = false, err = '', DR = null, POLL = null, GR = null, CAT = null, CATERR = '';
  const expired = () => window.__oddLock === 'expired';
  const tok = () => ls('odd-tok') || '';

  // ---------- server ----------
  async function post(op, b) {
    const r = await fetch(API + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': tok() }, body: JSON.stringify(Object.assign({ myName: ls('odd-name') || '' }, { g: GR ? GR.id : '' }, b || {})) }); // g = the group (a saved score keeps its own)
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Server said ' + r.status), { status: r.status, expired: !!j.expired, off: !!j.off }); return j;
  }
  const netErr = (e) => e && /Failed to fetch|NetworkError|Load failed/i.test(e.message);
  const errText = (e) => (netErr(e) ? 'Could not reach the server. It may be waking up: try again in a few seconds.' : e && e.status === 401 ? 'Sign in to use Groups.' : (e && e.message) || 'Something went wrong');
  async function act(op, b, then) { if (busy) return; busy = true; err = ''; const ob = el() && el().querySelector('.eerr'); if (ob) ob.remove(); /* F1: the old message goes, so the same message again counts as new */ paintBusy(true); try { const j = await post(op, b); busy = false; await then(j); } catch (e) { busy = false; lapsedCheck(e); err = errText(e); paint(true); } paintBusy(false); }
  const lapsedCheck = (e) => { if (e && e.expired) { try { localStorage.setItem('odd-exp', '1'); } catch (x) {} } }; // same as pics/groups.js: gate.js shows the lock
  // Offline queue for score entries: kept on the phone, resent with the same op id (the server ignores a repeat), shown as "waiting to send".
  const Q = () => { try { return JSON.parse(ls('oevt-q') || '[]'); } catch (e) { return []; } };
  const Qset = (q) => ls('oevt-q', q.length ? JSON.stringify(q.slice(-50)) : null);
  // P3 (review Nov 17 2026): one entry per match (a newer Save replaces the older one); an entry the server turns down is dropped without a word when the
  // match already holds the same games (the score got through another way, e.g. a second tap once the signal was back); the "no connection" note clears
  // once the queue has gone out.
  const sameGames = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
  const already = (ev, it) => { const m = ev && (ev.matches || []).find((x) => x.id === it.b.m); return !!m && (sameGames(m.sub && m.sub.games, it.b.games) || (m.state === 'confirmed' && sameGames(m.games, it.b.games))); };
  const qAdd = (b) => { const q = Q().filter((x) => !(x.b.id === b.id && x.b.m === b.m)); q.push({ b, at: Date.now() }); Qset(q); };
  const qDrop = (id, mid) => { const q = Q(), k = q.filter((x) => !(x.b.id === id && x.b.m === mid)); if (k.length !== q.length) Qset(k); };
  const QMSG = 'No connection: the score is saved on this phone and will be sent.';
  const qOf = (e, m) => (m.state === 'ready' || m.state === 'disputed' ? Q().find((x) => x.b.id === e.id && x.b.m === m.id && !x.fail) : null); // L3: a score still on this phone for this match
  let FLUSHING = false;
  async function flush() { const q = Q(); if (!q.length || !navigator.onLine || FLUSHING) return; FLUSHING = true; const keep = []; let sent = 0, ev = null;
    try { for (const it of q) { if (it.fail) { keep.push(it); continue; } try { const j = await post('score', it.b); ev = j.event || ev; sent++; } catch (e) { if (netErr(e)) { keep.push(it); continue; } let cur0 = null; try { cur0 = (await post('get', { id: it.b.id })).event; } catch (x) {} if (already(cur0, it)) { sent++; ev = cur0; continue; } keep.push(Object.assign(it, { fail: 'A saved score was not accepted: ' + errText(e) })); } }
      const now = Q().filter((x) => !q.some((y) => y.b.op === x.b.op)), gone = q.filter((y) => !Q().some((x) => x.b.op === y.b.op)); Qset(keep.filter((k) => !gone.includes(k) && !now.some((n) => n.b.id === k.b.id && n.b.m === k.b.m)).concat(now)); /* a Save made while this ran wins */ } finally { FLUSHING = false; }
    if (sent && err === QMSG) err = ''; if (ev) stack.forEach((x) => { if (x.id === ev.id) x.ev = ev; }); const s = cur(); if (sent || keep.some((x) => x.fail)) paint(true); if (sent && s && s.id) load(s, true); }
  window.addEventListener('online', flush);

  // ---------- small parts ----------
  const top = (back) => '<div class="etop"><button class="eback" data-a="back">‹ ' + esc(back) + '</button><button class="ex" data-a="close" aria-label="Close Groups">Close</button></div>';
  const tile = (lab, val, a, sub, cls) => '<button class="etile" ' + a + '><small>' + esc(lab) + ' ›</small><b class="' + (cls || '') + '">' + val + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</button>';
  const sel = (id, opts, cur) => '<select id="' + id + '" class="esel">' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
  const sw = (on, a) => '<button class="esw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" ' + a + '><i></i></button>';
  const seg = (opts, cur, a) => '<div class="eseg">' + opts.map(([v, l]) => '<button class="' + (v === cur ? 'on' : '') + '" ' + a + '="' + att(v) + '">' + esc(l) + '</button>').join('') + '</div>';
  const fmtLine = (e) => esc(FMTN[e.fmt] + (e.rules.pickem ? " + pick'em" : '') + (e.fmt !== 'solo' ? ' · ' + UNITN[e.rules.unit].replace(/ \(.*/, '') : ''));
  const gameRule = (r, sport) => (r.tset ? 'Sets to ' + r.to + ', win by 2, tiebreak at ' + r.to + '-' + r.to + ' (' + (r.to + 1) + '-' + r.to + ')' : r.to && r.winBy === 1 ? 'Games to ' + r.to + ' (going over is fine)' : r.to ? 'Games to ' + r.to + ', win by ' + r.winBy : 'Highest score wins each game') + (r.bestOf > 1 ? ', best of ' + r.bestOf : '') + (sport === 'pickleball' ? ' · ' + (r.scoring === 'rally' ? 'rally' : 'side-out') + ' scoring (a label for the players; the app does not count rallies)' : '');
  const scoreTxt = (m, games) => (games || m.games || []).map(([x, y]) => x + '-' + y).join(', ');
  const stateTxt = { wait: 'Waiting for earlier results', ready: 'To play', pending: 'Waiting for confirmation', confirmed: 'Final', disputed: 'Disputed: commissioner decides', bye: 'Bye', void: 'Not played', offered: 'Challenge waiting for an answer' };
  function rulesList(e) {
    const r = e.rules, rows = [['Format', FMTN[e.fmt] + (e.rules.pickem ? " with bracket pick'em for spectators" : '')], ['Sport', SPORTN[e.sport] + (e.fmt !== 'solo' ? ' · ' + UNITN[r.unit] : '')], ['Starts', fmtTime(e.start) + ' (rules lock then)']];
    if (e.endDay) rows.push(['Last day', fmtDay(e.endDay)]);
    if (e.fmt !== 'solo') rows.push(['Games', gameRule(r, e.sport)], ['Seeding', seedName(e)], ['Courts', String(r.courts)], ['Who enters scores', r.scorer === 'comm' ? 'The commissioner' : r.scorer === 'either' ? 'Either side, the other confirms' : 'The first-listed side, the other confirms']);
    else rows.push(['Scores', (r.low ? 'Lowest' : 'Highest') + ' ' + r.unitLabel + ' wins']);
    if (e.fmt === 'rr') rows.push(['Pools', String(r.pools)], ['Playoff', r.playoff ? 'Top ' + r.playoff + ', single elimination' : 'None'], ['Tiebreaks', 'Wins, head-to-head among the tied, ' + (e.sport === 'tennis' ? 'game' : 'point') + ' differential, head-to-head differential, differential against the next entry. Still level: a shared place, or, for a top place or a playoff spot, the organizer\'s coin flip (default) or playoff (house rule). Never the seed'], ['Finish', 'The organizer taps Finish (or 12 hours after the last result)']);
    if (e.fmt === 'de') rows.push(['Bracket reset', r.reset === 'game15' ? 'One game to 15, win by 2 (pickleball rulebook)' : 'A full match, same rules']);
    if (e.fmt === 'ladder') rows.push(['Challenges', 'Up to ' + r.reach + ' spot' + (r.reach > 1 ? 's' : '') + ' above, play within ' + r.expDays + ' days, else ' + (r.expire === 'void' ? 'cancelled' : 'challenger wins by forfeit')], ['Winner moves', r.move === 'swap' ? 'Swap places' : 'Take the spot, the rest move down one']);
    if (r.pickem) rows.push(["Pick'em", 'Pick each match before it starts (not your own matches); ' + (r.weight === 'round' ? 'later rounds are worth more, the final the most' : '1 point per right pick') + "; tiebreak: the final's total points"]);
    rows.push(['Money', 'None. Bragging rights only: nothing is collected or paid in group games.'], ['Joining', (e.join.self ? 'Members can add themselves from the group page' : 'The commissioner adds the players') + (e.join.spectators ? ', members can watch' : '')]);
    return '<div class="erules">' + rows.map(([k, v]) => '<div><small>' + esc(k) + '</small><span>' + esc(v) + '</span></div>').join('') + '</div>';
  }

  // ---------- screens ----------
  function home() {
    const comm = GR && GR.role === 'comm';
    let h = '<h1>Pickleball</h1><p class="esub">' + esc(GR ? GR.name : '') + ' · Round robin, brackets, ladder, heads-up and skills games. Scores are entered on court. No money moves through Oddable.</p>';
    h += comm ? '<div class="e2"><button class="epri" data-a="catalog">Start a game</button><button class="esec" data-a="joincode">Claim my results</button></div>' : '<div class="e2"><button class="esec" data-a="catalog">Games you can play</button><button class="esec" data-a="joincode">Claim my results</button></div>';
    const q = Q(); if (q.length) h += '<div class="ewarn"><b>' + q.length + ' score' + (q.length > 1 ? 's' : '') + ' waiting to send</b>' + (q.some((x) => x.fail) ? esc(q.find((x) => x.fail).fail) + '<button class="etiny" data-a="qclear">Dismiss</button>' : 'They go out as soon as the phone is back online.') + '</div>';
    if (!H) return h + '<div class="ecard">Loading the games…</div>';
    const mine = H.events.filter((e) => e.role && e.role !== 'none'), other = H.events.filter((e) => !e.role || e.role === 'none');
    const card = (e) => { let c = '<button class="ecard ebtn" data-a="' + (e.role && e.role !== 'none' ? 'open' : 'peek') + '" data-id="' + att(e.id) + '"><div class="erow"><b class="ename">' + esc(e.title) + '</b>' + (e.role === 'comm' ? '<span class="ebadge">Commissioner</span>' : e.role === 'spectator' ? '<span class="ebadge">Watching</span>' : e.role === 'player' ? '<span class="ebadge eg">Playing</span>' : '') + '</div>';
      c += '<div class="emeta">' + fmtLine(e) + '</div><div class="emeta">' + (e.fin ? 'Final' + (e.myPlace ? ' · you finished ' + ord(e.myPlace) : '') : e.started ? 'Under way' : 'Starts ' + esc(fmtTime(e.start))) + ' · ' + e.people + ' ' + (e.people === 1 ? 'person' : 'people') + '</div>';
      if (e.todo) c += '<div class="eyel">' + e.todo + ' match' + (e.todo > 1 ? 'es need' : ' needs') + ' you ›</div>'; else if (!e.role || e.role === 'none') c += '<div class="eyel">' + (e.locked || e.started ? 'See the scores ›' : 'Join or watch ›') + '</div>'; return c + '</button>'; };
    h += '<h3 class="eh">My games</h3>' + (mine.length ? '<div class="egrid">' + mine.map(card).join('') + '</div>' : '<div class="ecard emut">' + (comm ? 'No games yet. Start one for the group.' : 'You are not in a game yet.') + '</div>');
    if (other.length) h += '<h3 class="eh">Other games in this group</h3><div class="egrid">' + other.map(card).join('') + '</div>';
    if (!H.events.length && !comm) h += '<div class="enote">The group\'s commissioner starts the games. They show up here for every member.</div>';
    return h + '<div class="enote">' + esc(capLine()) + '</div>';
  }
  function joinCodeV() { return '<h1>Claim my results</h1><p class="esub">For a player the commissioner typed in by name</p><label class="elab">Claim code from the commissioner<input id="eclaim" class="ein" autocomplete="off" autocapitalize="characters" maxlength="24" placeholder="ABCD-1234.XXXXXXXXXX"></label><button class="epri efull" data-a="claim">Claim my results</button><div class="enote">A claim code moves the results the commissioner typed in under your name into your account. The commissioner finds it on the game\'s Info tab, next to your name.</div>'; }
  function previewV() {
    const s = cur(), e = s.ev;
    if (!e) return '<div class="ecard">Loading…</div>';
    if (e.role && e.role !== 'none') return '<h1>' + esc(e.title) + '</h1><button class="epri efull" data-a="open" data-id="' + att(e.id) + '">You are in this game. Open it ›</button>';
    let h = '<h1>' + esc(e.title) + '</h1><div class="emeta">' + fmtLine(e) + ' · run by ' + esc(e.commName) + '</div><div class="ecard">' + rulesList(e) + '</div>';
    h += '<div class="enote">' + e.people + ' of ' + e.cap + ' people so far. ' + esc(MONEY) + '</div>';
    const open = (e.open || []).filter((x) => x.open > 0);
    if (!e.locked) {
      h += '<h3 class="eh">Join as a player</h3>';
      if (!e.join.self) h += '<div class="enote">The commissioner adds the players in this game. If you were added by name, ask the commissioner for your claim code and enter it under Claim my results.</div>';
      open.forEach((x) => x.seats.forEach((st) => { h += '<button class="esec efull" data-a="dojoin" data-eid="' + att(x.eid) + '" data-gid="' + att(st.gid) + '">Take the open partner spot: ' + esc(x.name) + '</button>'; }));
      if (e.join.self) h += '<div class="enote">Added by name by the commissioner? Use your claim code (Claim my results) to take your spot.</div>';
      if (e.join.self) h += '<label class="elab">' + (e.rules.unit === 'singles' ? 'Or join as a new player' : 'Or enter a new ' + (e.rules.unit === 'teams' ? 'team' : 'pair') + ' (your partner opens this game from the group page and takes the open spot)') + '<input id="enewname" class="ein" maxlength="40" placeholder="' + (e.rules.unit === 'singles' ? 'Your name' : 'Team name') + '"></label><label class="elab">Your rating (optional, e.g. DUPR 4.25)<input id="enewrt" class="ein" type="number" inputmode="decimal" step="0.01" min="0"></label><button class="epri efull" data-a="dojoin">Join as a player</button>';
    } else h += '<div class="ewarn"><b>Entries are closed</b>The game has started.</div>';
    if (e.join.spectators) h += '<button class="esec efull" data-a="dojoin" data-as="spectator">' + (e.rules.pickem ? "Join to watch and play pick'em" : 'Join to watch') + '</button>';
    const ents = e.entrants || []; h += '<div class="ecard"><h2>Entries · ' + ents.length + '</h2>' + (ents.length ? ents.map((x) => '<div class="emrow"><span><b>' + esc(x.name) + '</b>' + x.players.map((p) => '<small>' + esc(p.name + (p.blank ? ' (open spot)' : p.guest ? ' (typed in)' : '')) + '</small>').join('') + '</span></div>').join('') : '<div class="emut">Nobody yet.</div>') + '</div>';
    return h;
  }
  // ---- create ----
  function draftNew(o) {
    const sport = 'pickleball', fmt = (o && o.fmt) || 'rr', d = new Date(Date.now() + 2 * 864e5); d.setHours(9, 0, 0, 0);
    const local = (t) => { const z = new Date(t - new Date(t).getTimezoneOffset() * 6e4); return z.toISOString().slice(0, 16); };
    return { title: '', sport, fmt, unit: sport === 'pickleball' || sport === 'tennis' ? 'doubles' : sport === 'basketball' ? 'teams' : 'singles', to: sport === 'pickleball' ? 11 : sport === 'tennis' ? 6 : sport === 'cornhole' ? 21 : 0, winBy: sport === 'pickleball' || sport === 'tennis' ? 2 : 1, bestOf: 1, scoring: 'sideout', reset: 'game15', seeding: 'rating', courts: 2, pools: 1, playoff: fmt === 'rr' ? 4 : 0, reach: 3, expDays: 7, expire: 'forfeit', move: 'swap', endDay: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), pickem: !!(o && o.pickem), weight: 'flat', side: false, scorer: 'a', startLocal: fmt === 'solo' ? local(Date.now()) : local(d.getTime()), entries: '', playIn: true, myRating: '', entry: 0, pot: 'main', split: 'none', takeKind: 'none', takeV: 0, self: true, spectators: true, low: !!(o && o.low), unitLabel: (o && o.unitLabel) || 'points' };
  }
  function createV() {
    const d = DR, P = d.sport === 'pickleball';
    let h = '<h1>New pickleball game</h1><p class="esub">' + esc(GR ? GR.name : '') + '</p><div class="eform"><label class="elab">Game name<input id="ft" class="ein" maxlength="40" placeholder="Saturday Smash" value="' + esc(d.title) + '"></label>';
    h += '<label class="elab">Format' + sel('ffm', Object.keys(FMTN).map((k) => [k, FMTN[k]]), d.fmt) + '</label>';
    h += '<button class="einfo" data-a="info" data-k="' + att(d.fmt) + '">ⓘ How ' + esc(FMTN[d.fmt].toLowerCase()) + ' works</button>';
    h += '<label class="elab">Starts (rules lock then)<input id="fst" class="ein" type="datetime-local" value="' + esc(d.startLocal) + '"></label>';
    if (['ladder', 'h2h', 'solo'].includes(d.fmt)) h += '<label class="elab">Last day<input id="fend" class="ein" type="date" value="' + esc(d.endDay) + '"></label>';
    h += '</div>';
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
    if (d.playIn) h += '<label class="elab">My rating (optional, e.g. DUPR 4.25)<input id="fmr" class="ein" type="number" inputmode="decimal" step="0.01" min="0" value="' + esc(d.myRating) + '"></label>';
    h += '<label class="elab">' + (d.unit === 'singles' || d.fmt === 'solo' ? 'Other players' : d.unit === 'teams' ? 'Teams' : 'Pairs') + ', one per line (name, rating)<textarea id="fen" class="ein eta" rows="5" placeholder="' + (d.unit === 'singles' || d.fmt === 'solo' ? 'Bea, 4.1\nCy, 3.6' : 'Bea / Cy, 4.0\nDi / Ed') + '">' + esc(d.entries) + '</textarea></label>';
    h += '<div class="enote">Players typed in here are guests (for example a friend without the app). Each gets a claim code on the Info tab that moves the results into their account later. ' + esc(capLine()) + '</div>';
    h += '<div class="eline"><span>Members can add themselves<small>From the group page, before the start.</small></span>' + sw(d.self, 'data-tg="self"') + '</div><div class="eline"><span>Members can watch<small>Follow the scores' + (d.pickem ? " and play pick'em" : '') + '.</small></span>' + sw(d.spectators || d.pickem, 'data-tg="spectators"') + '</div></div>';
    h += '<div class="enote">' + esc(MONEY) + '</div>';
    h += '<div class="ewarn"><b>Rules lock at the start</b>After the start (or once you make the draw) nobody can change the rules or the entries, the commissioner included.</div>';
    return h + '<button class="epri efull" data-a="submit">Create game</button>';
  }
  function readDraft() {
    const v = (id) => { const x = document.getElementById(id); return x ? x.value : null; }, d = DR; if (!d) return;
    const map = { ft: 'title', fst: 'startLocal', fend: 'endDay', fun: 'unitLabel', fen: 'entries', fmr: 'myRating', fmo: 'entry', ftv: 'takeV' }; Object.keys(map).forEach((k) => { if (v(k) !== null) d[map[k]] = v(k); });
    const num = { fbo: 'bestOf', fto: 'to', fwb: 'winBy', fco: 'courts', fpo: 'pools', fpl: 'playoff', fre: 'reach', fex: 'expDays' }; Object.keys(num).forEach((k) => { if (v(k) !== null) d[num[k]] = Number(v(k)); });
    const str = { fun2: 'unit', frs: 'reset', fsc: 'scoring', fsd: 'seeding', fexp: 'expire', fmv: 'move', fsr: 'scorer', fpt: 'pot', fspl: 'split', ftk: 'takeKind' }; Object.keys(str).forEach((k) => { if (v(k) !== null) d[str[k]] = v(k); });
    if (v('ffm') !== null) d.fmt = v('ffm');
  }
  function payload() {
    const d = DR, ents = String(d.entries || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^(.*?)(?:[,;]\s*(\d+(?:\.\d+)?))?$/.exec(l); return { name: m[1].trim(), rating: m[2] || '' }; });
    return { title: d.title.trim(), sport: 'pickleball', fmt: d.fmt, unit: d.fmt === 'solo' ? 'singles' : d.unit, start: new Date(d.startLocal).getTime(), endDay: d.endDay, to: d.to, winBy: d.sport === 'pickleball' ? 2 : d.winBy, bestOf: d.bestOf, scoring: d.scoring, reset: d.reset, seeding: d.seeding, courts: d.courts, pools: d.pools, playoff: d.playoff, reach: d.reach, expDays: d.expDays, expire: d.expire, move: d.move, pickem: d.pickem, weight: d.weight, side: d.side, scorer: d.scorer, low: d.low, unitLabel: d.unitLabel,
      entrants: ents, playIn: d.playIn, myRating: d.myRating, entry: 0, pot: 'main', split: 'none', take: { kind: 'none', v: 0 }, self: d.self, spectators: d.spectators || d.pickem }; // no money in a group (the server forces the same)
  }
  // ---- one event ----
  function eventV() {
    const s = cur(), e = s.ev; if (!e) return '<div class="ecard">Loading…</div>';
    const comm = e.role === 'comm', tabs = [['matches', e.fmt === 'solo' ? 'Scores' : 'Matches'], ['table', e.fmt === 'ladder' ? 'Ladder' : e.fmt === 'se' || e.fmt === 'de' ? 'Bracket' : 'Standings']].concat(e.rules.pickem ? [['pick', "Pick'em"]] : []).concat([['info', 'Info']]);
    let h = '<h1>' + esc(e.title) + '</h1><div class="emeta">' + fmtLine(e) + (GR ? ' · ' + esc(GR.name) : '') + '</div>';
    const mineNext = e.matches.filter((m) => m.mine && (m.state === 'ready' || m.state === 'pending' || m.state === 'offered')), todo = e.matches.filter((m) => m.canConfirm || (m.canScore && m.mine && m.state === 'ready'));
    h += '<div class="e3">' + tile('Status', e.fin ? 'Final' : e.drawn ? 'Live' : 'Not started', 'data-tab="' + (e.fin ? 'table' : 'matches') + '"', e.fin ? '' : e.drawn ? '' : esc(fmtTime(e.start))) + tile('For you', String(todo.length), 'data-a="todo"', todo.length ? 'need a score or OK' : mineNext.length ? 'next: ' + esc(mineNext[0].an + ' v ' + mineNext[0].bn) : 'nothing waiting', todo.length ? 'eyel' : '') + (comm ? tile('Disputes', String(e.flags), 'data-a="flags"', e.flags ? 'you decide' : 'none', e.flags ? 'eneg' : '') : tile('People', e.people + '/' + e.cap, 'data-tab="info"', '')) + '</div>';
    h += '<div class="eseg etabs">' + tabs.map(([k, l]) => '<button class="' + (s.tab === k ? 'on' : '') + '" data-tab="' + k + '">' + l + '</button>').join('') + '</div>';
    if (s.err2) h += '<div class="eerr">' + esc(s.err2) + '</div>';
    if (e.notice) h += '<div class="ewarn"><b>Notice from the commissioner</b>' + esc(e.notice.text) + '<small class="emut" style="display:block">' + esc(fmtTime(e.notice.at)) + ' · ' + esc(e.notice.by) + '</small></div>';
    if (e.hold && (e.hold.late || comm)) h += '<div class="ewarn"><b>' + (e.hold.late ? 'Waiting to start' : 'Not ready to start') + '</b>' + esc(e.hold.names.join(', ')) + (e.hold.names.length > 1 ? ' have' : ' has') + ' an empty partner spot. A pair cannot start without both players. ' + (comm ? 'Add the partner or remove the entry (Info tab); the draw is made as soon as every pair is complete.' : 'The commissioner adds the partner or removes the entry.') + '</div>';
    const q = Q().filter((x) => x.b.id === e.id); if (q.length) h += '<div class="ewarn"><b>' + q.length + ' score' + (q.length > 1 ? 's' : '') + ' waiting to send</b>' + (q.some((x) => x.fail) ? esc(q.find((x) => x.fail).fail) + '<button class="etiny" data-a="qclear">Dismiss</button>' : 'Saved on this phone; sent when you are back online.') + '</div>';
    if (s.tab === 'matches') h += matchesV(e, s); else if (s.tab === 'table') h += tableV(e); else if (s.tab === 'pick') h += pickV(e); else h += infoV(e);
    return h;
  }
  function matchCard(e, m) {
    let pill = '<span class="epill' + (m.state === 'confirmed' ? ' eok' : m.state === 'disputed' ? ' ebad' : m.state === 'pending' || m.state === 'offered' ? ' ewait' : '') + '">' + esc(m.state === 'ready' && m.live ? 'Playing' : stateTxt[m.state] || m.state) + '</span>';
    const where = (m.court ? 'Court ' + m.court + (m.wave > 1 ? ', wave ' + m.wave : '') : '') + (m.exp && m.state === 'ready' ? (m.court ? ' · ' : '') + 'play by ' + fmtTime(m.exp) : '');
    const nm = (x, side) => '<span class="' + (m.win === side ? 'ewin' : '') + '">' + esc(x || 'To be decided') + (m.mine === side ? ' <i class="emut">· you</i>' : '') + '</span>';
    let sc = m.state === 'confirmed' ? (m.forfeit ? 'Forfeit' : scoreTxt(m)) : m.sub && (m.state === 'pending' || m.state === 'disputed') ? scoreTxt(m, m.sub.games) + ' (entered)' : '';
    const wq = qOf(e, m); if (wq) { pill = '<span class="epill ewait">Waiting to send</span>'; sc = scoreTxt(m, wq.b.games); } // L3
    return '<button class="ematch' + (m.mine ? ' mine' : '') + (m.mine && m.state === 'confirmed' ? (m.win === m.mine ? ' hit' : ' miss') : '') + (m.canConfirm || m.needsComm ? ' act' : '') + '" data-a="match" data-m="' + att(m.id) + '"><span class="emw"><small>' + esc(label(m) + (where ? ' · ' + where : '')) + '</small>' + nm(m.an, 'a') + nm(m.bn, 'b') + '</span><span class="er">' + pill + (sc ? '<b>' + esc(sc) + '</b>' : '') + '</span></button>';
  }
  const label = (m) => (m.st === 'pool' ? 'Round ' + m.r : m.st === 'po' ? 'Playoff round ' + m.r : m.st === 'w' ? 'Round ' + m.r : m.st === 'l' ? 'Losers round ' + m.r : m.st === 'gf' ? (m.reset ? 'Final (reset)' : 'Final') : m.st === 'lad' ? 'Ladder challenge' : m.st === 'side' ? 'Side match' : m.st === 'tb' ? 'Tiebreak playoff' : 'Heads-up');
  function matchesV(e, s) {
    if (e.fmt === 'solo') return soloV(e);
    let h = '';
    if (!e.drawn) { h += '<div class="ewarn"><b>Starts ' + esc(fmtTime(e.start)) + '</b>The draw is made at the start' + (e.role === 'comm' ? ', or now if you tap below (entries and rules lock then).' : '.') + '</div>'; if (e.role === 'comm' && e.fmt !== 'h2h' && !e.hold) h += '<button class="esec efull" data-a="draw">Make the draw now</button>'; }
    const canCh = e.drawn && !e.fin && (e.fmt === 'ladder' || e.fmt === 'h2h' || e.rules.side) && (e.myEntries.length || e.role === 'comm');
    if (canCh || (e.fmt === 'h2h' && e.started && !e.fin)) h += '<button class="epri efull" data-a="chal">' + (e.fmt === 'ladder' ? 'Challenge someone above you' : e.fmt === 'h2h' ? 'Start a heads-up challenge' : 'Start a side match') + '</button>';
    const F = s.mf || 'all', ms = e.matches.filter((m) => m.state !== 'bye' && (F === 'all' || (F === 'mine' ? m.mine : F === 'todo' ? m.canConfirm || (m.canScore && (m.mine || e.role === 'comm') && m.state !== 'confirmed') || m.needsComm : F === 'flags' ? m.needsComm : m.state === 'confirmed')));
    h += '<label class="elab eshow">Show' + sel('emf', [['all', 'All matches'], ['mine', 'My matches'], ['todo', 'Need a score or OK']].concat(e.role === 'comm' ? [['flags', 'Disputes / you confirm']] : []).concat([['done', 'Finished']]), F) + '</label>';
    if (!ms.length) h += '<div class="ecard emut">No matches here' + (e.drawn ? '' : ' yet') + '.</div>';
    let lastK = ''; ms.forEach((m) => { const k = m.st === 'pool' ? 'Round ' + m.r + (e.pools && e.pools.length > 1 ? '' : '') : m.st === 'w' || m.st === 'po' ? (m.st === 'po' ? 'Playoff' : 'Winners bracket') + ' round ' + m.r : m.st === 'l' ? 'Losers bracket round ' + m.r : m.st === 'gf' ? 'Final' : ({ lad: 'Ladder challenges', side: 'Side matches', h2h: 'Heads-up matches' }[m.st] || label(m)); if (k !== lastK) { if (lastK) h += '</div>'; h += '<h3 class="eh">' + esc(k) + '</h3>'; if (m.st === 'pool' && e.byes && e.byes[m.r]) h += '<div class="enote">Bye this round: ' + esc(e.byes[m.r].map((x) => (e.entrants.find((y) => y.eid === x) || {}).name).join(', ')) + '</div>'; h += '<div class="egrid">'; lastK = k; } h += matchCard(e, m); });
    return h + (lastK ? '</div>' : '');
  }
  function soloV(e) {
    let h = '';
    if (!e.drawn) return '<div class="ewarn"><b>Starts ' + esc(fmtTime(e.start)) + '</b>Scores open at the start.</div>';
    const mine = e.entrants.filter((x) => e.myEntries.includes(x.eid)), list = e.role === 'comm' ? e.entrants : mine;
    if (!e.fin && list.length) { h += '<div class="ecard"><h2>Enter a score</h2><label class="elab">Who' + sel('esoloe', list.map((x) => [x.eid, x.name]), list[0].eid) + '</label><label class="elab">' + esc(e.rules.unitLabel) + '<input id="esolov" class="ein" type="number" inputmode="decimal" step="any"></label><button class="epri efull" data-a="solo">Save score</button>' + voiceBtn('solo') + '</div>'; }
    h += '<h3 class="eh">Scores · ' + (e.rules.low ? 'lowest' : 'highest') + ' wins</h3><div class="ethead"><span>#</span><span>Player</span><span class="er">' + esc(e.rules.unitLabel) + '</span></div>';
    (e.solo || []).forEach((r) => { h += '<div class="etrow"><span>' + r.place + '</span><span><b>' + esc(r.name) + '</b>' + (r.ver ? '' : '<small>self-entered</small>') + '</span><span class="er"><b>' + esc(r.score) + '</b></span></div>'; });
    if (!(e.solo || []).length) h += '<div class="ecard emut">No scores yet.</div>';
    if (e.role === 'comm' && !e.fin) h += '<button class="esec efull" data-a="finish">Finish the game</button>';
    return h;
  }
  // Standings sub-line: only the tiebreak steps that really separated this entry (nothing for an entry that was never level with anyone)
  const stepLine = (r) => { const st = r.steps || [], t = r.shared ? 'Level after every tiebreak step: shared place' : r.tie ? '<span class="eyel">Still tied: waiting for the organizer</span>' : st.length ? 'Level on wins; placed by ' + esc(st.join(', then ')) : ''; return t ? '<small>' + t + '</small>' : ''; };
  function tableV(e) {
    let h = '';
    if (e.poHold) h += '<div class="ewarn"><b>Playoff reset</b>' + esc(e.poHold.by) + ': ' + esc(e.poHold.reason) + '. ' + (e.role === 'comm' ? 'Correct the pool or tiebreak scores (Matches tab), then redraw the playoff from the standings.<button class="epri efull" data-a="poredraw">Redraw the playoff now</button>' : 'The commissioner is correcting a score; the playoff will be redrawn from the standings.') + '</div>';
    if (e.canFinish) h += '<div class="ewarn"><b>Every score is in</b>Check the scores, then finish: places become final and nothing can be corrected after that. Not tapped: it finishes by itself ' + esc(fmtTime(e.autoFinAt)) + '.<button class="epri efull" data-a="finish">Finish the round robin</button></div>';
    if (e.placeRows) { h += '<h3 class="eh">' + (e.final === false ? 'Places so far (not final yet)' : 'Final places') + '</h3>'; const shared = (p) => e.placeRows.filter((x) => x.place === p).length > 1; e.placeRows.forEach((r) => { if (shared(r.place)) r.sh = 1; }); e.placeRows.forEach((r) => { h += '<div class="etrow' + (r.place === 1 ? ' egold2' : '') + '"><span class="' + (r.place === 1 ? 'egold' : '') + '">' + ord(r.place) + '</span><span><b>' + esc(r.name) + '</b>' + (r.sh ? '<small>shared place</small>' : '') + '</span><span></span></div>'; }); }
    if (e.fmt === 'solo') return h + soloV(e);
    if (e.tables) e.tables.forEach((t, i) => {
      h += '<h3 class="eh">' + (e.tables.length > 1 ? 'Pool ' + String.fromCharCode(65 + i) : 'Standings') + '</h3><div class="ethead e5"><span>#</span><span>Player</span><span class="er">W-L</span><span class="er">+/-</span></div>';
      t.forEach((r) => { h += '<button class="etrow e5" data-a="ent" data-eid="' + att(r.eid) + '"><span>' + r.rank + '</span><span><b>' + esc(r.name) + '</b>' + stepLine(r) + '</span><span class="er">' + r.w + '-' + r.l + '</span><span class="er ' + (r.diff > 0 ? 'epos' : r.diff < 0 ? 'eneg' : '') + '">' + (r.diff > 0 ? '+' : '') + r.diff + '</span></button>'; });
    });
    (e.ties || []).forEach((t) => { h += '<div class="ewarn"><b>Still tied: ' + esc(t.names.join(', ')) + '</b>Level after every tiebreak step. ' + 'It decides a top place or a playoff spot, so it has to be settled. ' + (t.game ? 'A tiebreak playoff is on: its ' + (t.matches > 1 ? 'matches are' : 'match is') + ' on the Matches tab.' : e.role === 'comm' ? 'You choose how; the choice is logged for everyone.' : 'The organizer chooses a coin flip (the default) or a playoff.') + (e.role === 'comm' && !t.game ? '<button class="epri efull" data-a="tbreak" data-how="coin" data-k="' + esc(t.key) + '">Coin flip (default)</button><button class="esec efull" data-a="tbreak" data-how="game" data-k="' + esc(t.key) + '">House rule: playoff, order drawn at random (' + t.matches + ' match' + (t.matches > 1 ? 'es' : '') + ')</button><div class="enote">The playoff is a house rule, not in the rulebook: Oddable draws the order, the last two play, and the winner plays the next one up. The drawn order is logged.</div>' : '') + '</div>'; });
    if (e.tables) { const pt = e.sport === 'tennis' ? 'game' : 'point';
      h += '<div class="enote">Order (' + (e.sport === 'pickleball' ? 'pickleball rulebook' : 'the same for every sport in Oddable') + '): most wins; head-to-head among the tied; ' + pt + ' differential in all matches; head-to-head ' + pt + ' differential; ' + pt + ' differential against the next-highest entry. When a step separates only the best of a tie, the rest start over at head-to-head. Still level: a shared place, unless it decides a top place or a playoff spot; then the organizer settles it with a coin flip (default) or a playoff (house rule), logged. The seed never breaks a tie. Only confirmed scores count.' + (e.rules.playoff ? ' Top ' + e.rules.playoff + ' go to the playoff.' : '') + '</div>';
      if (e.tables.length > 1) h += '<div class="enote">Places across pools: pools never played each other, so records are not compared between them. Entries that finish in the same position in different pools share the place' + (e.rules.playoff ? ' (the entries that miss the playoff are placed this way; the playoff decides the top places).' : ' (the pool winners share 1st).') + '</div>';
      if (e.role === 'comm' && e.hasPlayoff && !e.fin) h += '<button class="edanger efull" data-a="poreset">Reset the playoff…</button><div class="enote">Only to correct a pool or tiebreak score after the playoff has started: its results so far are wiped, everyone is told why, and you redraw it from the corrected standings.</div>'; }
    if (e.ladder) { h += '<h3 class="eh">Ladder</h3><div class="ethead e4"><span>#</span><span>Player</span><span class="er">Challenge</span></div>'; e.ladder.forEach((r) => { const mine = e.myEntries.includes(r.eid), my = e.ladder.find((x) => e.myEntries.includes(x.eid)), can = my && !mine && r.rank < my.rank && my.rank - r.rank <= e.rules.reach && e.drawn && !e.fin; h += '<div class="etrow e4"><span>' + r.rank + '</span><button class="elnk" data-a="ent" data-eid="' + att(r.eid) + '"><b>' + esc(r.name) + (mine ? ' · you' : '') + '</b></button>' + (can ? '<button class="etiny" data-a="dochal" data-a2="' + att(my.eid) + '" data-b2="' + att(r.eid) + '">Challenge</button>' : '<span></span>') + '</div>'; }); }
    if (e.records && (e.fmt === 'h2h' || e.fmt === 'ladder' || e.rules.side)) { h += '<h3 class="eh">' + (e.fmt === 'h2h' ? 'Records' : 'Challenge records') + '</h3><div class="ethead e5"><span>#</span><span>Player</span><span class="er">W-L</span><span class="er">+/-</span></div>'; e.records.forEach((r) => { h += '<button class="etrow e5" data-a="ent" data-eid="' + att(r.eid) + '"><span>' + r.rank + '</span><span><b>' + esc(r.name) + '</b></span><span class="er">' + r.w + '-' + r.l + '</span><span class="er">' + (r.diff > 0 ? '+' : '') + r.diff + '</span></button>'; }); }
    if (e.fmt === 'se' || e.fmt === 'de' || (e.fmt === 'rr' && e.matches.some((m) => m.st === 'po'))) {
      const rounds = {}; e.matches.filter((m) => m.st !== 'pool' && m.st !== 'side').forEach((m) => { const k = (m.st === 'l' ? 'Losers round ' : m.st === 'gf' ? 'Final' : m.st === 'po' ? 'Playoff round ' : m.st === 'tb' ? 'Tiebreak playoff, match ' : m.st === 'lad' || m.st === 'h2h' ? 'Challenges' : 'Round ') + (m.st === 'gf' ? (m.reset ? ' (reset)' : '') : m.st === 'lad' || m.st === 'h2h' ? '' : m.r); (rounds[k] = rounds[k] || []).push(m); });
      Object.keys(rounds).forEach((k) => { h += '<h3 class="eh">' + esc(k) + '</h3><div class="egrid">'; rounds[k].forEach((m) => { if (m.state === 'void' && m.reset) return; h += matchCard(e, m); }); h += '</div>'; });
      if (!Object.keys(rounds).length) h += '<div class="ecard emut">The bracket appears after the draw.</div>';
    }
    return h || '<div class="ecard emut">Standings appear once matches are played.</div>';
  }
  function pickV(e) {
    const p = e.pickem; if (!p) return '';
    let h = '<div class="enote">' + esc(infoFor('pickem', e.sport, e.rules)) + '</div>';
    const open = e.matches.filter((m) => p.open.includes(m.id)), own = e.matches.filter((m) => (p.own || []).includes(m.id) && m.state === 'ready'), ptsOf = (m) => (e.rules.weight === 'round' && p.pts && p.pts[m.id] ? ' · worth ' + p.pts[m.id] + ' point' + (p.pts[m.id] > 1 ? 's' : '') : '');
    h += '<h3 class="eh">Open to pick · ' + open.length + '</h3>';
    if (!open.length) h += '<div class="ecard emut">Nothing to pick right now. Later rounds open as earlier matches finish.</div>';
    open.forEach((m) => { const my = p.mine[m.id]; h += '<div class="ecard"><small class="emut">' + esc(label(m) + ptsOf(m)) + '</small>' + (my ? '<div class="erow"><b class="ename">' + esc(my.s === 'a' ? m.an : m.bn) + '</b><span class="ebadge eg">Your pick · locked</span></div><div class="emeta">over ' + esc(my.s === 'a' ? m.bn : m.an) + ' · saved ' + esc(fmtTime(my.t)) + '</div>' : '<div class="e2">' + ['a', 'b'].map((sd) => '<button class="esec" data-a="pick" data-m="' + att(m.id) + '" data-side="' + sd + '">' + esc(sd === 'a' ? m.an : m.bn) + '</button>').join('') + '</div>') + '</div>'; });
    if (own.length) h += '<div class="enote">Your own match' + (own.length > 1 ? 'es are' : ' is') + ' not in your pick\'em (' + esc(own.map((m) => m.an + ' v ' + m.bn).join('; ')) + '): players cannot pick matches they play in.</div>';
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
    let h = '<div class="enote">' + esc(INFO.invite) + '</div>';
    h += '<div class="ecard"><h2>Rules</h2>' + rulesList(e) + '<button class="einfo" data-a="info" data-k="' + att(e.fmt) + '">ⓘ How ' + esc(FMTN[e.fmt].toLowerCase()) + ' works here</button></div>';
    h += '<div class="ecard"><h2>' + (e.fmt === 'solo' ? 'Players' : 'Entries') + ' · ' + e.entrants.length + '</h2>';
    const canRate = comm && e.ent && e.odd && !e.locked, canFix = comm && !e.drawn && e.hold;
    e.entrants.slice().sort((a, b) => (a.seed || 999) - (b.seed || 999)).forEach((x) => {
      h += '<div class="emrow"><span><b>' + (x.seed ? x.seed + '. ' : '') + esc(x.name) + '</b>' + (x.players.length > 1 && e.odd && x.oddRating != null ? '<small>Team rating ' + esc(x.oddRating) + '</small>' : '') + (x.rating != null ? '<small>Typed rating ' + esc(x.rating) + (e.odd ? ' (shown only)' : '') + '</small>' : '');
      x.players.forEach((p) => { h += '<small class="eplr">' + esc(p.name + (p.blank ? ' (open spot)' : p.guest ? ' (guest)' : '') + (p.me ? ' · you' : '')) + (e.odd && !p.blank ? '<br><span class="erate">' + esc(rateLine(p)) + '</span>' + (p.trn ? ' <span class="ebadge ey">Set by tournament</span>' : '') : '') + '</small>' + (canRate && !p.blank ? '<button class="etiny erbtn" data-a="trate" data-gid="' + att(p.gid) + '">' + (p.trn ? 'Change tournament rating' : 'Set tournament rating') + '</button>' : ''); });
      h += (comm ? x.players.filter((p) => p.claim && !p.blank).map((p) => '<small class="ecopy">Claim code for ' + esc(p.name) + ': <code>' + esc(p.claim) + '</code></small>').join('') : '') + '</span>' + (comm && (!e.locked || (canFix && e.hold.eids.includes(x.eid))) ? '<button class="etiny" data-a="rment" data-eid="' + att(x.eid) + '">Remove</button>' : '') + '</div>';
      if (canFix && e.hold.eids.includes(x.eid)) h += '<label class="elab">Partner for ' + esc(x.name) + ' (empty spot)<input class="ein" maxlength="24" data-pin="' + att(x.eid) + '" placeholder="Partner name"></label><button class="esec efull" data-a="addpartner" data-eid="' + att(x.eid) + '">Add partner</button>'; });
    if (e.odd) h += '<div class="enote">' + esc(ODDNOTE) + (e.ent ? ' In this licensed game the director can set a tournament rating for this game only' + (e.locked ? '; ratings locked at the start.' : ' until it starts.') : '') + '</div>';
    if (e.teams && !e.locked) h += '<button class="esec efull" data-a="partners">Suggest partners</button><div class="enote">Balanced, Rotate or Hot pairs, each with a reason. It only suggests' + (comm ? '; you choose.' : '; the commissioner sets the teams.') + '</div>';
    if (comm && !e.locked) h += '<label class="elab">Add ' + (e.rules.unit === 'singles' ? 'a player' : 'an entry') + ' (name, rating)<input id="eadd" class="ein" maxlength="50" placeholder="' + (e.rules.unit === 'singles' ? 'Bea, 4.1' : 'Bea / Cy, 4.0') + '"></label><button class="esec efull" data-a="addent">Add</button>';
    h += '<div class="enote">' + e.people + ' of ' + e.cap + ' people. ' + esc(e.entText || CAPLINE) + '</div></div>';
    h += '<div class="ecard"><h2>People · ' + e.people + '</h2>'; e.members.forEach((m) => { h += '<div class="emrow"><span>' + esc(m.name) + ' <i class="emut">· ' + (m.comm ? 'commissioner' : m.role === 'spectator' ? 'watching' : 'player') + (m.pid === e.me ? ', you' : '') + '</i></span></div>'; });
    const typed = []; e.entrants.forEach((x) => x.players.forEach((p) => { if (p.guest && !p.blank) typed.push(p); }));
    typed.forEach((p) => { h += '<div class="emrow"><span>' + esc(p.name) + ' <i class="emut">· typed-in player</i></span></div>'; });
    h += '</div>';
    if (e.tlog && e.tlog.length) h += '<div class="ecard"><h2>Tournament ratings · ' + e.tlog.length + ' change' + (e.tlog.length > 1 ? 's' : '') + '</h2>' + e.tlog.map((a) => '<div class="eaud"><small>' + esc(fmtTime(a.at)) + ' · ' + esc(a.by) + ' (director)</small><b>' + esc(a.player) + '</b>: ' + esc(a.old == null ? 'no rating' : a.old) + ' → ' + esc(a.new == null ? 'tournament rating removed' : a.new) + '<small>Oddable (real results): ' + esc(a.oddable == null ? 'no games yet' : a.oddable) + ' · Reason: ' + esc(a.reason) + '</small></div>').join('') + '<div class="enote">These apply to this game only. Nobody\'s lifetime Oddable rating is changed.</div></div>';
    h += '<div class="ecard"><h2>History</h2>' + (e.audit.length ? e.audit.slice(0, 60).map((a) => '<div class="eaud"><small>' + esc(fmtTime(a.t)) + ' · ' + esc(a.who) + '</small>' + esc(a.s) + '</div>').join('') : '<div class="emut">Nothing yet.</div>') + '</div>';
    if (comm && !e.locked) h += '<button class="edanger efull" data-a="delete">Delete game</button>';
    if (comm && (e.fmt === 'ladder' || e.fmt === 'h2h') && e.started && !e.fin) h += '<button class="esec efull" data-a="finish">Finish the game now</button>';
    if (e.canFinish) h += '<button class="esec efull" data-a="finish">Finish the round robin</button>';
    if (!comm && e.role && e.role !== 'none') h += '<button class="edanger efull" data-a="leave">Leave game</button>';
    return h;
  }
  // ---- one match: score entry, confirm, dispute ----
  function voiceBtn(kind) { return window.VoiceLog && typeof window.VoiceLog.open === 'function' ? '<button class="evoice efull" data-a="voice" data-k="' + kind + '">🎤 Log my score</button>' : ''; }
  function matchV() {
    const s = cur(), e = s.ev, m = e && e.matches.find((x) => x.id === s.m); if (!m) return '<div class="ecard">Match not found.</div>';
    const wq = qOf(e, m), r = m.rule ? Object.assign({}, e.rules, m.rule, { tset: false }) : e.rules, n = r.bestOf, g = s.g || (wq ? wq.b.games : null) || (m.sub && m.state !== 'ready' ? m.sub.games : null) || [];
    let h = '<h1>' + esc(m.an || 'TBD') + ' v ' + esc(m.bn || 'TBD') + '</h1><div class="emeta">' + esc(label(m) + (m.court ? ' · Court ' + m.court : '') + ' · ' + gameRule(r, e.sport)) + '</div>';
    if (m.rule) h += '<div class="enote">Bracket reset: both sides have one loss, so this final is one game to ' + m.rule.to + ', win by ' + m.rule.winBy + ' (pickleball rulebook).</div>';
    h += '<div class="ecard"><div class="erow"><b' + (wq ? ' class="eyel"' : '') + '>' + esc(wq ? 'Waiting to send: ' + scoreTxt(m, wq.b.games) : stateTxt[m.state] || m.state) + '</b>' + (m.state === 'confirmed' ? '<b>' + esc(m.forfeit ? 'Forfeit' : scoreTxt(m)) + '</b>' : '') + '</div>';
    if (m.sub && m.state !== 'ready') h += '<div class="enote">Entered by ' + esc(m.sub.by) + ': ' + esc(scoreTxt(m, m.sub.games)) + (m.sub.note ? ' · Dispute: ' + esc(m.sub.note) : '') + '</div>';
    if (wq) h += '<div class="enote">Saved on this phone. It is sent as soon as the phone is back online. Saving again replaces it.</div>'; // L3
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
    let h = '<h1>' + (e.fmt === 'ladder' ? 'Ladder challenge' : e.fmt === 'h2h' ? 'Heads-up challenge' : 'Side match') + '</h1><div class="enote">' + esc(infoFor(e.fmt === 'ladder' ? 'ladder' : 'h2h', e.sport, e.rules)) + (e.odd ? ' ' + esc('Rated for the Oddable rating only when the other side\'s account confirms the score, at most 2 a day against the same opponents' + (e.fmt !== 'ladder' ? ', and only in games with 3 or more accounts.' : '.')) : '') + '</div>';
    if (!from.length) return h + '<div class="ecard emut">You need an entry in this game to challenge.</div>';
    h += '<label class="elab">From' + sel('cha', from.map((x) => [x.eid, x.name]), s.a || from[0].eid) + '</label><label class="elab">Against' + sel('chb', e.entrants.filter((x) => x.eid !== (s.a || from[0].eid)).map((x) => [x.eid, x.name]), s.b) + '</label>';
    return h + '<button class="epri efull" data-a="sendchal">Send challenge</button>';
  }
  // ---- E-H: the director sets one player's rating for this tournament ----
  function trateV() {
    const s = cur(), e = s.ev; let p = null, ent = null; e.entrants.forEach((x) => x.players.forEach((y) => { if (y.gid === s.gid) { p = y; ent = x; } })); if (!p) return '<h1>Tournament rating</h1><div class="ecard emut">That player is no longer in the game.</div>';
    let h = '<h1>Tournament rating</h1><div class="emeta">' + esc(p.name) + (ent.players.length > 1 ? ' · ' + esc(ent.name) : '') + '</div>';
    h += '<div class="ecard"><div class="ekv"><span>Oddable rating<small>Real results from app play. Never changed here.</small></span><b>' + (p.odd && p.odd.rating != null ? esc(p.odd.rating) : 'No confirmed games') + '</b></div><div class="enote">' + esc(p.odd && p.odd.matches ? confTxt(p.odd) : 'No games in the app yet') + '</div><div class="ekv"><span>Tournament rating<small>' + (p.trn ? 'Set by the director' + (p.trn.at ? ' · ' + esc(fmtTime(p.trn.at)) : '') + (p.trn.reason ? ' · ' + esc(p.trn.reason) : '') : p.odd && p.odd.rating != null ? 'Not set: the Oddable rating is used' : 'Not set: counted as a new player (1500)') + '</small></span><b class="' + (p.trn ? 'egold' : '') + '">' + (p.trn ? esc(p.trn.v) : '—') + '</b></div></div>';
    if (e.locked) return h + '<div class="ewarn"><b>Locked</b>Ratings locked when the game started.</div>';
    h += '<label class="elab">Rating for this tournament (100 to 3500; new players start at 1500)<input id="etr" class="ein enum" type="number" inputmode="numeric" min="100" max="3500" step="1" value="' + esc(s.v != null ? s.v : p.trn ? p.trn.v : p.odd && p.odd.rating != null ? p.odd.rating : '') + '"></label>';
    h += '<label class="elab">Reason (logged and shown to the players)<input id="etrr" class="ein" maxlength="120" placeholder="Club ladder position, back from injury…" value="' + esc(s.r || '') + '"></label>';
    h += '<button class="epri efull" data-a="trsave">Save for this tournament</button>' + (p.trn ? '<button class="esec efull" data-a="trclear">Remove it (use the Oddable rating)</button>' : '');
    return h + '<div class="enote">Applies to this game only: seeding, pairings and partner suggestions here. The player\'s lifetime Oddable rating is not changed, and it stays on the screen next to the tournament rating. Every change is logged. Locks when the game starts.</div>';
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
    return h + '<div class="enote">' + (e.odd ? esc(ODDNOTE) + ' ' : '') + 'Based on ' + d.players + ' players and ' + d.history + ' past game' + (d.history === 1 ? '' : 's') + ' they played as partners.' + (d.locked ? ' Teams locked when the game started.' : '') + '</div>';
  }
  function loadPartners(s) { s.sug = null; post('partners', { id: s.id, mode: s.mode || 'balanced' }).then((j) => { s.sug = j; if (cur() === s) paint(); }).catch((x) => { err = errText(x); s.sug = { suggestions: [], teamSize: 2, players: 0, history: 0 }; if (cur() === s) paint(); }); }
  function playerV() {
    const s = cur(), e = s.ev, x = e && e.entrants.find((y) => y.eid === s.eid); if (!x) return '<h1>Player</h1><div class="ecard emut">That entry is no longer in the game.</div>';
    const ms = e.matches.filter((m) => (m.a === x.eid || m.b === x.eid) && m.state !== 'bye'), done = ms.filter((m) => m.state === 'confirmed'), won = done.filter((m) => (m.win === 'a' ? m.a : m.win === 'b' ? m.b : '') === x.eid).length;
    const row = [].concat(...(e.tables || [])).concat(e.records || []).find((r) => r.eid === x.eid), lad = (e.ladder || []).find((r) => r.eid === x.eid), pl = e.placeRows && e.placeRows.find((r) => r.name === x.name);
    let h = '<h1>' + esc(x.name) + '</h1><div class="emeta">' + esc(x.players.map((p) => p.name + (p.me ? ' (you)' : '') + (p.blank ? ' (open spot)' : p.guest ? ' (typed in)' : '')).join(' & ')) + '</div>';
    h += '<div class="e3">' + tile('Record', won + '-' + (done.length - won), 'data-a="pmatches"', done.length ? done.length + ' played' : 'no results yet') + tile(lad ? 'Ladder' : pl ? 'Place' : 'Standing', lad ? '#' + lad.rank : pl ? ord(pl.place) : row ? '#' + row.rank : '—', 'data-a="ptable"', row && row.diff != null ? (row.diff > 0 ? '+' : '') + row.diff + ' points' : '') + tile('Matches left', String(ms.filter((m) => m.state !== 'confirmed' && m.state !== 'void').length), 'data-a="pmatches"', x.seed ? 'seed ' + x.seed : '') + '</div>';
    if (e.odd) h += '<div class="ecard"><h2>Ratings</h2>' + x.players.filter((p) => !p.blank).map((p) => '<div class="emrow"><span><b>' + esc(p.name) + '</b><small>' + esc(rateLine(p)) + '</small></span></div>').join('') + '</div>';
    h += '<h3 class="eh">Matches · ' + ms.length + '</h3>' + (ms.length ? '<div class="egrid">' + ms.map((m) => matchCard(e, m)).join('') + '</div>' : '<div class="ecard emut">No matches yet. They appear after the draw.</div>');
    return h;
  }
  function catalogV() {
    if (!CAT) return '<h1>Start a game</h1><div class="ecard">' + esc(CATERR || 'Loading games…') + '</div>';
    const s = cur(), sp = CAT.sports.find((x) => x.key === (s.sp || 'pickleball')) || CAT.sports[0], comm = GR && GR.role === 'comm';
    let h = '<h1>' + (comm ? 'Start a game' : 'Games') + '</h1><p class="esub">Pickleball is ready in groups. Every other sport is coming soon. Tap a game to see how it works.</p>';
    h += '<div class="echips">' + CAT.sports.map((x) => '<button class="esec' + (x.key === sp.key ? ' on' : '') + '" aria-pressed="' + (x.key === sp.key) + '" data-csp="' + att(x.key) + '">' + esc(x.name) + (x.key === 'pickleball' ? '' : ' <small>Coming soon</small>') + '</button>').join('') + '</div>';
    h += '<div class="enote">' + esc(sp.leagues) + ' · ' + esc(CAT.results[sp.feed]) + (sp.feedNote ? '. ' + esc(sp.feedNote) : '') + '</div><div class="egrid">';
    sp.games.forEach((g, i) => { const nm = g.name || CAT.games[g.key].name;
      h += '<button class="ecard ebtn' + (g.gold ? ' egoldc' : g.status !== 'now' ? ' esoon' : '') + '" data-cg="' + i + '"><div class="erow"><b class="ename">' + esc(nm) + '</b><span class="ebadge ' + (g.status === 'now' ? 'eg' : 'ey') + '">' + esc(CAT.status[g.status]) + '</span></div><div class="emut">' + esc(g.line || CAT.games[g.key].line) + '</div><div class="eyel">How it works ›</div></button>'; });
    return h + '</div><p class="enote">' + esc(CAT.potLine) + '</p><p class="enote">' + esc(CAT.capLine) + '</p>';
  }
  function catInfo(g, sport) { const base = CAT.games[g.key], k = CAT.localInfoKey[g.key]; let t = g.info || base.info || (k ? infoFor(k, sport) : '') || g.line || base.line; /* L2: a sport's own entry can give its own wording */ if (g.key === 'elim') t = infoFor('se', sport) + ' Double elimination: ' + infoFor('de', sport); return t + (g.note ? ' ' + g.note : ''); }
  function catGameV() {
    const s = cur(), sp = CAT.sports.find((x) => x.key === s.sp) || CAT.sports[0], g = sp.games[s.i], nm = g.name || CAT.games[g.key].name, comm = GR && GR.role === 'comm', st = g.start || {};
    let h = '<h1>' + esc(nm) + '</h1><div class="emeta">' + esc(sp.long) + '</div><div class="erow" style="justify-content:flex-start;margin:8px 0"><span class="ebadge ' + (g.status === 'now' ? 'eg' : 'ey') + '">' + esc(CAT.status[g.status]) + '</span><span class="ebadge ep">' + esc(CAT.results[g.results]) + '</span></div>';
    h += '<div class="ecard"><h2>How it works</h2><div>' + esc(catInfo(g, sp.key === 'pickleball' ? 'pickleball' : 'other')) + '</div></div>';
    h += '<div class="ecard"><div class="ekv"><span>' + esc(CAT.status[g.status]) + '<small>' + esc(CAT.statusInfo[g.status]) + '</small></span></div><div class="ekv"><span>' + esc(CAT.results[g.results]) + '<small>' + esc(CAT.resultsInfo[g.results]) + '</small></span></div></div>';
    if (g.status === 'now' && st.kind === 'event') h += comm ? '<button class="epri efull" data-a="catstart">Start ' + esc(nm) + '</button>' : '<div class="enote">The group\'s commissioner starts pickleball games. They show up on the Pickleball page for every member.</div>';
    else if (g.status === 'now' && st.kind === 'tile') h += '<button class="epri efull" data-a="cattile" data-k="' + att(st.tile) + '">' + esc(st.label) + '</button>';
    else h += '<button class="epri efull" disabled aria-disabled="true">' + esc(CAT.status[g.status]) + '</button>';
    return h + '<p class="enote">' + esc(CAT.potLine) + ' ' + esc(CAT.capLine) + '</p>';
  }
  function loadCat() { if (CAT) return; fetch('games-catalog.json?v=' + VER).then((r) => r.json()).then((j) => { CAT = j; CATERR = ''; paint(); }).catch(() => { CATERR = 'Could not load the games list. Check your signal and try again.'; paint(); }); }
  function infoSheet() { const s = cur(); return '<h1>' + esc(s.title) + '</h1><div class="ecard">' + esc(s.text) + '</div><div class="ecard">' + esc(s.text2 || INFO.scoring) + '</div>'; }

  // ---------- paint ----------
  const el = () => document.getElementById('oevt');
  const cur = () => stack[stack.length - 1];
  function paintBusy(on) { const e = el(); if (e) e.classList.toggle('ebusy', !!on); }
  // P1 (review Nov 17 2026): a quiet repaint (the 10 s refresh, a refresh after the queue went out, an error) keeps whatever was typed but not saved yet:
  // every field whose value differs from what the screen drew is carried over to the same field of the new drawing.
  const fkey = (f) => f.id || (f.getAttribute('data-plk') != null ? 'plk:' + f.getAttribute('data-plk') : f.getAttribute('data-pin') != null ? 'pin:' + f.getAttribute('data-pin') : f.name || '');
  function dirty(x) { const o = {}; x.querySelectorAll('input,textarea,select').forEach((f) => { const k = fkey(f); if (!k) return; if (f.tagName === 'SELECT' ? [...f.options].some((op) => op.selected !== op.defaultSelected) : f.type === 'checkbox' || f.type === 'radio' ? f.checked !== f.defaultChecked : f.value !== f.defaultValue) o[k] = f.type === 'checkbox' || f.type === 'radio' ? { c: f.checked } : { v: f.value }; }); return o; }
  function undirty(x, o) { x.querySelectorAll('input,textarea,select').forEach((f) => { const d = o[fkey(f)]; if (!d) return; if ('c' in d) f.checked = d.c; else f.value = d.v; }); }
  let LASTS = null;
  function paint(keepFields) {
    const x = el(); if (!x) return; const s = cur(); const kf = keepFields && LASTS === s ? dirty(x) : null, act0 = kf && document.activeElement && x.contains(document.activeElement) ? fkey(document.activeElement) : '';
    // P5 (review Nov 17 2026): each screen keeps its own scroll place; a new screen opens at the top, ‹ Back returns to where the list was
    const moved = LASTS !== s; if (moved && LASTS && stack.includes(LASTS)) LASTS.sy = x.scrollTop; LASTS = s;
    const V = { home, joincode: joinCodeV, preview: previewV, create: createV, event: eventV, match: matchV, chal: chalV, info: infoSheet, trate: trateV, partners: partnersV, player: playerV, catalog: catalogV, catgame: catGameV }[s.t];
    const lock = expired() ? '<h1>Pickleball</h1><div class="ewarn"><b>Locked</b>' + esc(window.ODD_ENDED || 'Your time has ended. Pay now to unlock your picks, bets and groups.') + '</div><button class="epri efull" data-a="back">Back to Groups</button>' : '';
    const hadErr = (x.querySelector('.eerr') || {}).textContent || ''; let box = null;
    const keep = x.scrollTop; const hd = withHead(top('Back'), lock || (V ? V() : '')); x.querySelector('.ein0').innerHTML = hd; if (err) { box = document.createElement('div'); box.className = 'eerr'; box.setAttribute('role', 'alert'); box.textContent = err; x.querySelector('.ehead').insertAdjacentElement('afterend', box); } if (moved) x.scrollTop = s.sy || 0; else if (s.keepScroll || kf) x.scrollTop = keep;
    // F1 (review 2, Nov 17 2026): a NEW error (a failed Create, Save, Join... or a form check) is brought into view; a refresh that redraws the same error leaves the scroll alone
    if (box && err !== hadErr) try { box.scrollIntoView({ block: 'nearest' }); } catch (z) {}
    if (kf) { undirty(x, kf); if (act0) { const f = [...x.querySelectorAll('input,textarea,select')].find((y) => fkey(y) === act0); if (f) try { f.focus({ preventScroll: true }); } catch (z) {} } }
  }
  function push(o) { readDraft(); err = ''; stack.push(o); paint(); }
  async function loadHome(quiet) { if (expired()) return; try { const j = await post('list', {}); if (quiet && H && JSON.stringify(j.events) === JSON.stringify(H.events) && j.capText === H.capText) return; H = j; if (!quiet) err = ''; } catch (e) { lapsedCheck(e); if (!quiet) err = errText(e); if (!H) H = { events: [] }; } if (cur().t === 'home') paint(!!quiet); }
  async function load(s, quiet) { try { const j = await post('get', { id: s.id, since: quiet && s.ev ? s.ev.u : undefined }); if (j.same) return; s.ev = j.event; s.err2 = ''; } catch (e) { lapsedCheck(e); if (!quiet) err = errText(e); else s.err2 = errText(e); } stack.forEach((x) => { if (x.id === s.id && x !== s) x.ev = s.ev; }); const c = cur(); if (c.id === s.id) { c.keepScroll = quiet; paint(!!quiet); c.keepScroll = false; } }
  function poll() { clearInterval(POLL); POLL = setInterval(() => { if (!el()) { clearInterval(POLL); return; } if (document.hidden) return; flush(); const s = cur(); if (s && s.id && (s.t === 'event' || s.t === 'match' || s.t === 'player') && !busy && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) load(s, true); else if (s && s.t === 'home' && !busy) loadHome(true); }, 10000); } // P6 (review Nov 17 2026): the Pickleball home refreshes quietly too (new games appear)
  const evOf = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].ev) return stack[i].ev; return null; };
  const readGames = (n) => { const g = []; for (let i = 0; i < n; i++) { const a = (document.getElementById('ga' + i) || {}).value, b = (document.getElementById('gb' + i) || {}).value; if (a === '' && b === '') continue; g.push([Number(a), Number(b)]); } return g; };
  function sendScore(e, m, games, done) { // through the normal scorer entry route; queued on the phone if offline
    const b = { g: GR ? GR.id : '', id: e.id, m: m.id, games, v: m.v, op: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
    if (!navigator.onLine) { qAdd(b); stack.pop(); paint(); if (done) done({ queued: true }); return Promise.resolve({ queued: true }); }
    // P3: a Save that cannot reach the server is queued (one entry per match) and the phone goes back to the game, so there is no second tap to race the queue
    return new Promise((ok) => act('score', b, async (j) => { qDrop(e.id, m.id); stack.forEach((x) => { if (x.id === e.id) x.ev = j.event; }); stack.pop(); paint(); if (done) done(j); ok(j); }).then(() => { if (err && /reach the server/.test(err)) { qAdd(b); if (cur().t === 'match') stack.pop(); err = QMSG; paint(); } }));
  }

  function click(ev) {
    const t = ev.target.closest('button,a,[data-a]'); if (!t || t.disabled) return; const a = t.getAttribute('data-a'), id = t.getAttribute('data-id');
    if (a && a !== 'back' && a !== 'close' && !t.hasAttribute('data-tab')) { const ob = el() && el().querySelector('.eerr'); if (ob) ob.remove(); } // F1: an action's own message is always shown as new (and brought into view)
    if (a === 'close') { readDraft(); shut(); try { if (window.OddGroups) window.OddGroups.close(); } catch (x) {} return; } // Close = leave Groups, like the Groups Close button
    if (a === 'back') { readDraft(); err = ''; if (stack.length <= 1 || expired()) { shut(); try { if (window.OddGroups && window.OddGroups.refresh) window.OddGroups.refresh(); } catch (x) {} return; } stack.pop(); const s = cur(); if (s.t === 'home') loadHome(); else if (s.t === 'event') load(s, true); paint(); return; } // Back on the first screen = the group page
    if (t.hasAttribute('data-tab')) { const s = cur(); s.tab = t.getAttribute('data-tab'); paint(); return; }
    if (t.hasAttribute('data-tg')) { readDraft(); const k = t.getAttribute('data-tg'); DR[k] = !DR[k]; paint(); return; }
    if (a === 'qclear') { Qset(Q().filter((x) => !x.fail)); paint(); return; }
    if (expired()) return;
    if (a === 'catalog') { push({ t: 'catalog', sp: 'pickleball' }); loadCat(); return; }
    if (t.hasAttribute('data-csp')) { const s = cur(); s.sp = t.getAttribute('data-csp'); paint(); return; }
    if (t.hasAttribute('data-cg')) { push({ t: 'catgame', sp: cur().sp || 'pickleball', i: +t.getAttribute('data-cg') }); return; }
    if (a === 'catstart') { const s = cur(), g = CAT.sports.find((x) => x.key === s.sp).games[s.i], st = g.start || {}; DR = draftNew({ fmt: st.fmt, pickem: !!st.pickem, low: !!st.low, unitLabel: st.unitLabel }); push({ t: 'create' }); return; }
    if (a === 'cattile') { const k = ({ contest: 'picks' })[t.getAttribute('data-k')] || t.getAttribute('data-k'); shut(); try { if (window.OddGroups && window.OddGroups.openGame && window.OddGroups.openGame(k)) return; } catch (x) {} const b = document.querySelector('#ogrp button[data-a="game"][data-k="' + att(k) + '"]'); if (b) b.click(); return; } // v277: a game of the v274 Games catalog (key 'picks' = the picks contest, 'golf' = Golf day), opened for this group through groups.js
    if (a === 'joincode') { push({ t: 'joincode' }); return; }
    if (a === 'peek') { openPreview(id); return; }
    if (a === 'claim') { const c = (document.getElementById('eclaim') || {}).value || ''; if (c.trim().length < 6) { err = 'Type the claim code the commissioner gave you.'; paint(); return; } act('claim', { claim: c.trim() }, async (j) => { stack = [{ t: 'home' }]; loadHome(); push({ t: 'event', id: j.event.id, ev: j.event, tab: 'info' }); }); return; }
    if (a === 'dojoin') { const s = cur(); const as = t.getAttribute('data-as') || 'player'; act('join', { id: s.id, as, eid: t.getAttribute('data-eid') || undefined, gid: t.getAttribute('data-gid') || undefined, entryName: ((document.getElementById('enewname') || {}).value || '').trim() || undefined, rating: (document.getElementById('enewrt') || {}).value || undefined }, async (j) => { stack = [{ t: 'home' }]; loadHome(); push({ t: 'event', id: j.event.id, ev: j.event, tab: 'matches' }); }); return; }
    if (a === 'open') { const s = { t: 'event', id, tab: 'matches' }; push(s); load(s); return; }
    if (a === 'info') { const k = t.getAttribute('data-k'), inEv = cur().t === 'event' && cur().ev, sp = inEv ? inEv.sport : DR ? DR.sport : 'pickleball', rl = inEv ? inEv.rules : null; push({ t: 'info', title: 'How ' + FMTN[k].toLowerCase() + ' works', text: infoFor(k, sp, rl) + (inEv && inEv.rules.pickem ? ' ' + infoFor('pickem', sp, rl) : ''), text2: infoFor('scoring', sp, rl || { seeding: DR && DR.seeding }) }); return; }
    if (a === 'submit') { readDraft(); const p = payload(); if (p.title.length < 2) { err = 'Give the game a name (2+ characters).'; paint(); return; } act('create', p, async (j) => { DR = null; stack = [{ t: 'home' }]; loadHome(); push({ t: 'event', id: j.event.id, ev: j.event, tab: 'info' }); }); return; }
    const e = evOf(); if (!e) return;
    if (a === 'todo') { const s = cur(); s.tab = 'matches'; s.mf = 'todo'; paint(); return; }
    if (a === 'flags') { const s = cur(); s.tab = 'matches'; s.mf = 'flags'; paint(); return; }
    if (a === 'match') { push({ t: 'match', id: e.id, ev: e, m: t.getAttribute('data-m') }); return; }
    if (a === 'ent') { push({ t: 'player', id: e.id, ev: e, eid: t.getAttribute('data-eid') }); return; }
    if (a === 'pmatches' || a === 'ptable') { const x = el(); const h3 = x && x.querySelector(a === 'pmatches' ? '.eh' : '.etile'); if (a === 'pmatches' && h3) h3.scrollIntoView({ block: 'start' }); else { stack.pop(); const s = cur(); if (s.t === 'event') s.tab = 'table'; paint(); } return; }
    if (a === 'draw') { if (!confirm('Make the draw now? Entries and rules lock for everyone.')) return; act('draw', { id: e.id }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'poreset') { const why = (prompt('Reset the playoff? Every playoff result so far is wiped and every member is told.\n\nReason (everyone sees it):') || '').trim(); if (why.length < 2) { if (why) { err = 'Give a reason. Everyone sees it.'; paint(); } return; } act('poreset', { id: e.id, reason: why }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'poredraw') { if (!confirm('Redraw the playoff from the standings as they are now?')) return; act('poredraw', { id: e.id }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'addpartner') { const eid = t.getAttribute('data-eid'), inp = el().querySelector('input[data-pin="' + eid + '"]'), nm = ((inp && inp.value) || '').trim(); if (!nm) { err = "Type the partner's name."; paint(); return; } act('entrant', { id: e.id, do: 'partner', eid, name: nm }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'addent') { const v = (document.getElementById('eadd') || {}).value || '', m = /^(.*?)(?:[,;]\s*(\d+(?:\.\d+)?))?$/.exec(v.trim()); act('entrant', { id: e.id, do: 'add', name: m[1], rating: m[2] || '' }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'rment') { if (!confirm('Remove this entry?')) return; act('entrant', { id: e.id, do: 'remove', eid: t.getAttribute('data-eid') }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'delete') { if (!confirm('Delete this game for everyone in the group?')) return; act('delete', { id: e.id }, async () => { stack = [{ t: 'home' }]; loadHome(); paint(); }); return; }
    if (a === 'leave') { if (!confirm('Leave this game?')) return; act('leave', { id: e.id }, async () => { stack = [{ t: 'home' }]; loadHome(); paint(); }); return; }
    if (a === 'finish') { if (!confirm('Finish the game now? Places are final.')) return; act('finish', { id: e.id }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'chal') { push({ t: 'chal', id: e.id, ev: e }); return; }
    if (a === 'tbreak') { const how = t.getAttribute('data-how'); if (!confirm(how === 'coin' ? 'Settle this tie with a coin flip? Oddable flips it now. It is final and logged.' : 'Settle this tie with a tiebreak playoff? The matches are added now. This cannot be switched to a coin flip later.')) return; act('tiebreak', { id: e.id, key: t.getAttribute('data-k'), how }, async (j) => { cur().ev = j.event; cur().tab = how === 'coin' ? 'table' : 'matches'; paint(); }); return; }
    if (a === 'plock') { if (!confirm('Lock picks for this round now? It cannot be undone.')) return; act('picklock', { id: e.id, round: t.getAttribute('data-k'), lock: true }, async (j) => { cur().ev = j.event; paint(); }); return; }
    if (a === 'plockat') { const inp = el().querySelector('input[data-plk="' + t.getAttribute('data-k') + '"]'), ms = inp && inp.value ? new Date(inp.value).getTime() : NaN; if (!(ms > Date.now())) { err = 'Pick a lock time in the future.'; paint(); return; } act('picklock', { id: e.id, round: t.getAttribute('data-k'), at: ms }, async (j) => { cur().ev = j.event; paint(); }); return; }
    const updAll = (j) => { stack.forEach((x) => { if (x.id === e.id) x.ev = j.event; }); };
    if (a === 'trate') { push({ t: 'trate', id: e.id, ev: e, gid: t.getAttribute('data-gid') }); return; }
    if (a === 'trsave' || a === 'trclear') { const s = cur(); s.v = (document.getElementById('etr') || {}).value; s.r = ((document.getElementById('etrr') || {}).value || '').trim(); if (s.r.length < 2) { err = 'Give a reason. It is logged and shown to the players.'; paint(); return; } act('trate', { id: e.id, gid: s.gid, rating: a === 'trclear' ? '' : s.v, reason: s.r }, async (j) => { updAll(j); stack.pop(); paint(); }); return; }
    if (a === 'partners') { const s = { t: 'partners', id: e.id, ev: e, mode: 'balanced' }; push(s); loadPartners(s); return; }
    if (t.hasAttribute('data-pm')) { const s = cur(); s.mode = t.getAttribute('data-pm'); paint(); loadPartners(s); return; }
    if (a === 'useteams') { const s = cur(), x = s.sug && s.sug.suggestions[+t.getAttribute('data-i')]; if (!x) return; if (!confirm('Use these teams?\n\n' + x.names.map((n) => n.join(' & ')).join('\n') + '\n\nYou can change them again until the game starts.')) return; act('teams', { id: e.id, teams: x.teams, mode: s.mode }, async (j) => { updAll(j); stack.pop(); cur().tab = 'info'; paint(); }); return; }
    if (a === 'dochal') { act('challenge', { id: e.id, a: t.getAttribute('data-a2'), b: t.getAttribute('data-b2') }, async (j) => { cur().ev = j.event; cur().tab = 'matches'; paint(); }); return; }
    if (a === 'sendchal') { const A = document.getElementById('cha').value, B = (document.getElementById('chb') || {}).value; act('challenge', { id: e.id, a: A, b: B, side: e.fmt !== 'ladder' && e.fmt !== 'h2h' }, async (j) => { stack.pop(); cur().ev = j.event; cur().tab = 'matches'; paint(); }); return; }
    if (a === 'pick') { const pm = e.matches.find((x) => x.id === t.getAttribute('data-m')), sd = t.getAttribute('data-side'); if (!confirm('Pick ' + (pm ? (sd === 'a' ? pm.an : pm.bn) : 'this side') + '?\n\nPicks lock the moment you make them. You cannot change it.')) return; act('pick', { id: e.id, m: t.getAttribute('data-m'), side: t.getAttribute('data-side') }, async (j) => { cur().ev = j.event; cur().keepScroll = true; paint(); cur().keepScroll = false; }); return; }
    if (a === 'tb') { const tv = Number((document.getElementById('etb') || {}).value); if (!Number.isInteger(tv) || tv < 0) { err = 'Type the total points you expect in the final.'; paint(); return; } if (!confirm('Lock in ' + tv + ' as your tiebreak guess? You cannot change it.')) return; act('pick', { id: e.id, tb: Number((document.getElementById('etb') || {}).value) }, async (j) => { cur().ev = j.event; paint(); }); return; }
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
    if (s.t === 'create' && /^f/.test(id) && ev.target.tagName === 'SELECT') { readDraft(); s.keepScroll = true; paint(); s.keepScroll = false; }
  }
  async function openPreview(id) { // a game of this group the member is not in yet: rules, entries, join as a player or to watch
    const s = { t: 'preview', id }; push(s);
    try { const j = await post('preview', { id }); s.ev = j.event; } catch (e) { lapsedCheck(e); err = errText(e); } if (cur() === s) paint();
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
    if (document.getElementById('oevtcss')) return; /* P7 (review Nov 17 2026): the same id it creates, so the style is added once */ const st = document.createElement('style'); st.id = 'oevtcss'; const R = '#oevt';
    st.textContent = R + '{--gbg:var(--bg,#0a0c10);--gp:var(--panel,#13161d);--gp2:var(--panel2,#1b1f29);--gl:var(--line,#272c38);--gi:var(--ink,#eef0f4);--gm:var(--muted,#8b93a3);--gv:var(--blue,#a78bfa);--gg:var(--green,#4fd18b);--gr:var(--red,#ff5a4d);--gy:#f5c542;--gyt:#d4a017;--hg:linear-gradient(135deg,#7c3aed 0%,#4c1d95 55%,#1b1f29 100%);--hs:#ede4ff;--pbg:var(--blue,#7c3aed);--pfg:var(--bg,#fff);--pbd:var(--blue,#7c3aed);position:fixed;top:0;right:0;left:0;bottom:0;z-index:46;background:var(--gbg);color:var(--gi);overflow:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left}'
      + 'html.cb ' + R + '{--hg:linear-gradient(135deg,#003594 0%,#002b5c 38%,#041e42 74%,#08111f 100%);--hs:#c6cbd7;--pbg:#003594;--pfg:#fff;--pbd:#c6cbd7}'
      + 'html:not(.cb) body:not(.dark) ' + R + '{--gy:#b7791f;--gyt:#a16207;--pfg:#fff}' // navy (html.cb) is dark with the light switch on or off, like the app
      + R + ' .ein0{max-width:1328px;margin:0 auto;padding:0 16px calc(48px + env(safe-area-inset-bottom))}' + R + '.ebusy .epri{opacity:.6}' + R + ' *{box-sizing:border-box}'
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
      + R + ' .ebadge{display:inline-block;border:1px solid var(--gl);background:var(--gp);color:var(--gm);border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700;white-space:nowrap}' + R + ' .ebadge.ey{color:var(--gyt);border-color:var(--gy)}' + R + ' .ebadge.eg{color:var(--gg);border-color:var(--gg)}' + R + ' .ebadge.ep{color:var(--gm)}' + R + ' .ebadge.ev{color:var(--gi);border-color:var(--gv);background:var(--gp2)}'
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
      + R + ' .epill{border:1px solid var(--gl);border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;text-align:right;color:var(--gm)}' + R + ' .epill.eok{border-color:var(--gg);color:var(--gg)}' + R + ' .epill.ebad{border-color:var(--gr);color:var(--gr)}' + R + ' .epill.ewait{border-color:var(--gy);color:var(--gyt)}'
      + R + ' .ethead,' + R + ' .etrow{display:grid;grid-template-columns:34px minmax(0,1fr) 80px;gap:8px;align-items:center}' + R + ' .ethead.e5,' + R + ' .etrow.e5{grid-template-columns:34px minmax(0,1fr) 58px 58px}' + R + ' .ethead.e4,' + R + ' .etrow.e4{grid-template-columns:34px minmax(0,1fr) 112px}' + R + ' .etrow.e1{grid-template-columns:minmax(0,1fr)}' + R + ' .ethead.e3c,' + R + ' .etrow.e3c{grid-template-columns:72px minmax(0,1fr) minmax(0,1fr)}'
      + R + ' .ethead{color:var(--gm);font-size:12px;font-weight:700;padding:6px 12px 2px}' + R + ' .etrow{width:100%;text-align:left;background:var(--gp);border:1px solid var(--gl);border-radius:14px;padding:8px 12px;margin:4px 0;min-height:48px;color:var(--gi)}' + R + ' .etrow b{display:block;overflow-wrap:anywhere}' + R + ' .etrow small{display:block;color:var(--gm);font-size:12px}' + R + ' .ecard .etrow{background:var(--gp2)}' + R + ' .ethead .er{text-align:right}'
      + R + ' .erules>div{display:flex;flex-direction:column;padding:6px 0;border-bottom:1px solid var(--gl)}' + R + ' .erules>div:last-child{border-bottom:0}' + R + ' .erules small{color:var(--gm);font-size:12px}' + R + ' .erules span{overflow-wrap:anywhere}'
      + R + ' .ekv{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--gl)}' + R + ' .ekv:last-child{border-bottom:0}' + R + ' .ekv span{min-width:0}' + R + ' .ekv small{display:block;color:var(--gm);font-size:12px}' + R + ' .ekv b{text-align:right;white-space:nowrap}'
      + R + ' .emrow{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:48px;border-bottom:1px solid var(--gl);padding:6px 0}' + R + ' .emrow:last-child{border-bottom:0}' + R + ' .emrow>span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}' + R + ' .emrow small{display:block;color:var(--gm);font-size:12px}' + R + ' .emrow i{font-style:normal}'
      + R + ' .emrow small.eplr{margin-top:5px;font-size:13px}' + R + ' .erate{color:var(--gi);font-weight:600}' + R + ' .emrow .ebadge{padding:2px 8px;font-size:11px}' + R + ' .erbtn{display:block;margin:6px 0 4px;font-size:13px}'
      + R + ' .etiny{background:var(--gp2);border:1px solid var(--gl);border-radius:10px;color:var(--gi);min-height:44px;min-width:64px;padding:0 10px;font-weight:600}' + R + ' .ecopy code{font-size:13px;overflow-wrap:anywhere;word-break:break-all;color:var(--gi)}' + R + ' .eaud{padding:6px 0;border-bottom:1px solid var(--gl);overflow-wrap:anywhere}' + R + ' .eaud:last-child{border-bottom:0}' + R + ' .eaud small{display:block;color:var(--gm);font-size:12px}'
      + R + ' .eib{width:44px;height:44px;border:0;background:none;color:var(--gv);font-size:20px;flex:0 0 auto}' + R + ' .egame{display:flex;flex-direction:column;gap:4px;text-align:left;color:inherit}' + R + ' .egame b{font-size:16px}'
      + R + ' .egrid{display:grid;grid-template-columns:minmax(0,1fr);gap:0 12px}' + R + ' .echips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}' + R + ' .echips button{min-height:44px;padding:6px 14px;border-radius:999px}' + R + ' .echips small{color:var(--gm);font-weight:600;font-size:11px;margin-left:4px}'
      + R + ' .elnk{background:none;border:0;padding:0;text-align:left;min-height:44px;min-width:0;color:inherit}' + R + ' .etrow.e4>span:nth-child(3){text-align:right}' + R + ' .ecard.esoon{opacity:.85}'
      + '@media (max-width:360px){' + R + ' .e3{grid-template-columns:1fr 1fr}}'
      // wide screens fill the width like the Games view: cards and matches in columns, forms in columns, single buttons not stretched across
      + '@media (min-width:768px){' + R + ' .ein0{padding:0 22px calc(48px + env(safe-area-inset-bottom))}' + R + ' .egrid{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}' + R + ' .eform{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0 16px}' + R + ' .e3{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}' + R + ' .efull{max-width:520px}' + R + ' .ehead{margin:0 -22px 10px;padding-left:22px;padding-right:22px}}'
      // P9 (review Nov 17 2026): on a laptop or desktop the places, standings, ladder and pick'em rows and the Show picker keep a readable width instead of one 1300px line
      + '@media (min-width:1000px){' + R + ' .ethead,' + R + ' .etrow{max-width:760px}' + R + ' .ecard .ethead,' + R + ' .ecard .etrow{max-width:none}' + R + ' .eshow{max-width:420px}}';
    document.head.appendChild(st);
  }
  // The header part of a screen (its h1 and the line under it) goes into the app's gradient header, with the Back / Close row.
  function withHead(topHtml, body) { const m = /^(<h1>[\s\S]*?<\/h1>(?:<(div|p) class="e(?:meta|sub)">[^<]*(?:<[^d/][^>]*>[^<]*<\/[^>]+>[^<]*)*<\/\2>)?)/.exec(body); return '<div class="ehead">' + topHtml + (m ? m[1] : '') + '</div>' + (m ? body.slice(m[1].length) : body); }
  // Exactly over the Groups screen: the same left / bottom pics/groups.js fit() gives #ogrp (beside the tab bar, never over it), one z-index above it.
  function fit() { const x = el(), o = document.getElementById('ogrp'); if (!x) return; x.style.left = o ? o.style.left || '0' : '0'; x.style.bottom = o ? o.style.bottom || '0' : '0'; x.style.zIndex = String(1 + (o ? +getComputedStyle(o).zIndex || 45 : 45)); }
  function mount() { css(); let x = el(); if (x) x.remove(); x = document.createElement('div'); x.id = 'oevt'; x.setAttribute('role', 'dialog'); x.setAttribute('aria-label', 'Pickleball'); x.innerHTML = '<div class="ein0"></div>'; document.body.appendChild(x); fit(); window.addEventListener('resize', fit); x.addEventListener('click', click); x.addEventListener('change', change); registerVoice(); poll(); return x; }
  function shut() { clearInterval(POLL); window.removeEventListener('resize', fit); const x = el(); if (x) x.remove(); busy = false; }
  const VER = (document.currentScript && /[?&]v=([\w.]+)/.exec(document.currentScript.src || '') || [])[1] || '1';
  // pics/groups.js: OddLocal.open({id, name, role}) from the group page's Pickleball tile; close() when Groups closes.
  window.OddLocal = {
    open: (gr) => { GR = { id: String(gr.id), name: String(gr.name || ''), role: gr.role === 'comm' ? 'comm' : 'member' }; H = null; DR = null; mount(); stack = [{ t: 'home' }]; err = ''; paint(); loadHome(); flush(); },
    close: shut, fit, isOpen: () => !!el(), infoFor,
  };
})();
