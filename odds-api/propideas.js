// 🎯 Prop ideas of the week (GET /propideas, public). IDEAS ONLY: no sportsbook line, no price, not a pick, not part of the Oddable Alert or any record.
// Lists NFL players running hot: the average of their last 3 games against their own season average BEFORE those 3 games.
// Data: ESPN only (scoreboard per week + one summary per finished game). No Odds API credits, no keys.
// A finished game's box score is parsed once and kept: in memory, and in oddable_sync rows 'lock:pi<yy>w<week>' (same Supabase helpers as alert.js / locks.js;
// the 'lock:' prefix keeps the rows out of player lists). Without SUPABASE_URL / SUPABASE_KEY it is memory only and a restart refetches the season.
// The response never waits for ESPN: it answers with what is ready plus building + progress, and the build runs in the background, a few games at a time.
const D = { S: require('./sync'), fetch: (...a) => fetch(...a), now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), hasDb: () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY) };
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
const TTL = 15 * 6e4, ERR_WAIT = 2 * 6e4, RETRY_WAIT = 10 * 6e4, BATCH = 3, PAUSE = 350;
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', o && o.building === false ? 'public, max-age=60' : 'no-store'); res.end(JSON.stringify(o)); };

// ---- Pure part (no network, no clock): also run as-is in a browser tab to check the rule on real ESPN data ----
function core() {
  const FIX = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' }, ab = (x) => FIX[String(x)] || String(x); // the app's team spellings (pics/index.html FIX)
  // floor = season average a game needed to count as a regular; gap = least absolute rise (last 3 vs before)
  const STATS = { passYds: { label: 'Passing yards', cat: 0, floor: 180, gap: 12 }, rushYds: { label: 'Rushing yards', cat: 1, floor: 35, gap: 12 }, recYds: { label: 'Receiving yards', cat: 2, floor: 35, gap: 12 }, rec: { label: 'Receptions', cat: 2, floor: 3, gap: 1 } };
  const MIN_GAMES = 4, LAST = 3, MIN_PCT = 0.2, TOP = 8, PER_STAT = 3, PER_TEAM = 2;
  const RULE = 'Hot = the average of a player\'s last 3 games played is at least 20% above his season average before those 3 games, and at least 12 yards (or 1 catch) higher. He needs 4+ games this season with that stat, must have played in his team\'s most recent game, and must average at least 180 passing yards, 35 rushing yards, 35 receiving yards or 3 catches a game. Top 8 by percentage, one idea per player, at most 3 per stat and 2 per team, only for games that have not kicked off.';
  const r1 = (x) => Math.round(x * 10) / 10, avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  // ESPN summary -> rows [athleteId, name, team, position, passYds, passTD, rushYds, recYds, rec]; a stat is null when the player has no line in that category.
  // Columns are found by their label (YDS, TD, REC), never by position.
  function parseBox(s) {
    const out = {};
    (((s || {}).boxscore || {}).players || []).forEach((t) => {
      const team = ab((t.team || {}).abbreviation || '');
      (t.statistics || []).forEach((c) => {
        const L = (c.labels || []).map((x) => String(x).toUpperCase()), col = (n) => L.indexOf(n), k = c.name;
        if (k !== 'passing' && k !== 'rushing' && k !== 'receiving') return;
        (c.athletes || []).forEach((a) => {
          const at = a.athlete || {}; if (!at.id) return; const st = a.stats || [], v = (n) => { const i = col(n); if (i < 0) return null; const x = parseFloat(st[i]); return Number.isFinite(x) ? x : 0; };
          const o = (out[at.id] = out[at.id] || [String(at.id), String(at.displayName || ''), team, (at.position && at.position.abbreviation) || '', null, null, null, null, null]);
          if (k === 'passing') { o[4] = v('YDS'); o[5] = v('TD'); } else if (k === 'rushing') { o[6] = v('YDS'); } else { o[7] = v('YDS'); o[8] = v('REC'); }
        });
      });
    });
    return Object.values(out).filter((o) => o[4] !== null || o[6] !== null || o[7] !== null || o[8] !== null);
  }
  // ESPN scoreboard -> { week, type, year, events: [{ id, w, t, state, h, a }] }
  function parseSb(j) {
    const ev = [];
    ((j || {}).events || []).forEach((e) => { const c = (e.competitions || [])[0] || {}, t = Date.parse(e.date), h = (c.competitors || []).find((x) => x.homeAway === 'home'), a = (c.competitors || []).find((x) => x.homeAway === 'away'), st = ((e.status || {}).type || {}).state; if (e.id && Number.isFinite(t) && h && a && h.team && a.team) ev.push({ id: String(e.id), w: +((e.week || {}).number || (j.week || {}).number || 0), t, state: st === 'post' || st === 'in' ? st : 'pre', h: ab(h.team.abbreviation), a: ab(a.team.abbreviation) }); });
    return { week: +((j || {}).week || {}).number || 0, type: +((j || {}).season || {}).type || 0, year: +((j || {}).season || {}).year || 0, events: ev };
  }
  // Finished games [{ id, w, t, h, a, p: rows }] -> { players: { id: { id, name, team, pos, g: [...] } }, teamGames: { ABBR: [eventId...] } }, both in kickoff order.
  // A game counts as played when the player has any passing, rushing or receiving line in it; a stat with no line that day counts as 0.
  function build(events) {
    const players = {}, teamGames = {};
    events.slice().sort((x, y) => x.t - y.t || (x.id < y.id ? -1 : 1)).forEach((e) => {
      [e.h, e.a].forEach((tm) => (teamGames[tm] = teamGames[tm] || []).push(e.id));
      (e.p || []).forEach((r) => {
        const tm = r[2], P = (players[r[0]] = players[r[0]] || { id: r[0], name: r[1], team: tm, pos: '', g: [] });
        P.name = r[1] || P.name; P.team = tm; if (r[3]) P.pos = r[3];
        P.g.push({ eid: e.id, w: e.w, t: e.t, team: tm, opp: tm === e.h ? e.a : e.h, home: tm === e.h, has: [r[4] !== null, r[6] !== null, r[7] !== null || r[8] !== null], v: { passYds: r[4] || 0, passTD: r[5] || 0, rushYds: r[6] || 0, recYds: r[7] || 0, rec: r[8] || 0 } });
      });
    });
    return { players, teamGames };
  }
  // The rule, for one player and one stat, looking only at `prior` (his games so far, oldest first). teamLast = his team's most recent finished game.
  // Returns null when he is not a regular for that stat; else { hot, pct, gap, last3, lastAvg, before, beforeN, seasonAvg, games }.
  function evalAt(prior, stat, teamLast) {
    const S = STATS[stat], n = prior.length; if (n < MIN_GAMES || prior[n - 1].eid !== teamLast) return null;
    if (prior.filter((g) => g.has[S.cat]).length < MIN_GAMES) return null;
    const vals = prior.map((g) => g.v[stat]), seasonAvg = avg(vals); if (seasonAvg < S.floor) return null;
    const last3 = vals.slice(-LAST), bf = vals.slice(0, -LAST), lastAvg = avg(last3), before = avg(bf), gap = lastAvg - before, pct = before > 0 ? gap / before : 0;
    return { hot: before > 0 && pct >= MIN_PCT && gap >= S.gap, pct, gap, last3, lastAvg, before, beforeN: bf.length, seasonAvg, games: n };
  }
  // Highest percentage first; one idea per player, at most 3 per stat and 2 per team, 8 in all.
  function cap(list) {
    const out = [], ns = {}, nt = {}, np = {};
    list.slice().sort((x, y) => y.pct - x.pct || y.gap - x.gap || (x.id < y.id ? -1 : 1)).forEach((c) => { if (out.length >= TOP || np[c.id] || (ns[c.stat] || 0) >= PER_STAT || (nt[c.team] || 0) >= PER_TEAM) return; np[c.id] = 1; ns[c.stat] = (ns[c.stat] || 0) + 1; nt[c.team] = (nt[c.team] || 0) + 1; out.push(c); });
    return out;
  }
  // upcoming = games of the week that have not kicked off: [{ id, w, t, h, a }]
  // busy = teams whose game is under way right now (their numbers are about to change): left out until that game is final.
  function ideas(B, upcoming, busy) {
    const nextOf = {}; upcoming.slice().sort((x, y) => y.t - x.t).forEach((g) => { nextOf[g.h] = g; nextOf[g.a] = g; }); (busy || []).forEach((t) => { delete nextOf[t]; });
    const c = [];
    Object.values(B.players).forEach((P) => {
      const g = nextOf[P.team], tg = B.teamGames[P.team]; if (!g || !tg || !tg.length) return;
      Object.keys(STATS).forEach((stat) => {
        const e = evalAt(P.g, stat, tg[tg.length - 1]); if (!e || !e.hot) return;
        const n = P.g.length, o = { id: P.id, name: P.name, team: P.team, pos: P.pos, stat, label: STATS[stat].label, gid: g.id, week: g.w, opp: P.team === g.h ? g.a : g.h, home: P.team === g.h, kickoff: g.t, last3: e.last3, lastAvg: r1(e.lastAvg), before: r1(e.before), beforeN: e.beforeN, seasonAvg: r1(e.seasonAvg), games: e.games, pct: e.pct, gap: e.gap, log: P.g.map((x, i) => ({ w: x.w, opp: x.opp, home: x.home, v: x.v[stat], line: x.has[STATS[stat].cat], last3: i >= n - LAST })) };
        if (stat === 'passYds') { const td = P.g.map((x) => x.v.passTD); o.passTD = { last3: td.slice(-LAST), before: r1(avg(td.slice(0, -LAST))) }; o.log.forEach((x, i) => { x.td = td[i]; }); }
        c.push(o);
      });
    });
    return cap(c).map((o) => Object.assign({}, o, { pct: Math.round(o.pct * 100), gap: r1(o.gap) })); // ranked on the exact figures, shown rounded
  }
  // The honesty number. For every game a player has played this season, look only at his games BEFORE it. If he was a regular for a stat by the rule
  // above, he goes in `base`; if he was also hot, in `hot`; if he would also have made that week's capped list of 8, in `shown`.
  // `above` counts the times that game's number came in over his own season average up to then. A player who did not play his next game is not counted.
  function carry(B) {
    const z = () => ({ n: 0, above: 0 }), hot = z(), base = z(), shown = z(), byWeek = {};
    Object.values(B.players).forEach((P) => {
      P.g.forEach((G, i) => {
        if (i < MIN_GAMES) return; const prior = P.g.slice(0, i), tg = B.teamGames[G.team] || [], k = tg.indexOf(G.eid); if (k < 1) return;
        Object.keys(STATS).forEach((stat) => {
          const e = evalAt(prior, stat, tg[k - 1]); if (!e) return; const up = G.v[stat] > e.seasonAvg ? 1 : 0;
          base.n++; base.above += up; if (!e.hot) return; hot.n++; hot.above += up;
          (byWeek[G.w] = byWeek[G.w] || []).push({ id: P.id, team: G.team, stat, pct: e.pct, gap: e.gap, up });
        });
      });
    });
    Object.keys(byWeek).forEach((w) => cap(byWeek[w]).forEach((c) => { shown.n++; shown.above += c.up; }));
    const fin = (o) => Object.assign(o, { pct: o.n ? Math.round(o.above / o.n * 1000) / 10 : null });
    const small = hot.n < 30;
    return { hot: fin(hot), base: fin(base), shown: fin(shown), small, note: (small ? 'Small sample: fewer than 30 hot streaks so far this season, so this number means very little yet. ' : '') + 'Counted over every earlier game this season: players who were hot going in (all of them, not only the 8 shown), and whether their next game beat their own season average up to then. Base = every regular starter by the same volume rule, hot or not. A player and stat count once per game; a player who missed his next game is not counted.' };
  }
  return { STATS, RULE, MIN_GAMES, parseBox, parseSb, build, evalAt, cap, ideas, carry, ab };
}
const C = core();

// ---- Service part: schedule, polite fetching, cache, persistence ----
let ST;
const fresh = () => ({ weeks: {}, cur: 0, year: 0, type: 0, target: null, ready: false, building: false, lastTry: 0, lastOk: 0, err: '', fails: {}, persist: 'memory', ver: 0, memo: null, carry: null, prog: { done: 0, total: 0 } });
ST = fresh();
const rowId = (w) => 'lock:pi' + String(ST.year).slice(-2) + 'w' + w;
async function getJson(url) { const r = await D.fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('espn ' + r.status); return r.json(); }
async function dbLoad(w, wk) {
  if (wk.dbTried || !D.hasDb()) return; wk.dbTried = true;
  try { const row = await D.S.dbGet(rowId(w)), d = row && row.data; if (d && d.ev) { Object.keys(d.ev).forEach((id) => { if (!wk.ev[id]) { wk.ev[id] = d.ev[id]; ST.ver++; } }); if (d.done) wk.done = true; } ST.persist = 'db'; } catch (e) { ST.persist = 'memory (db error)'; }
}
async function dbSave(w, wk) {
  if (!D.hasDb()) return;
  try {
    for (let tries = 0; tries < 3; tries++) {
      const id = rowId(w); let row = await D.S.dbGet(id); if (!row) { await D.S.dbPut({ id, salt: 'x', pinhash: 'x', data: { ev: {}, done: false }, updated: 1 }, true); row = await D.S.dbGet(id); if (!row) continue; }
      const ev = Object.assign({}, (row.data && row.data.ev) || {}, wk.ev);
      if (await D.S.dbPatchIf(id, row.updated, { ev, done: !!wk.done }, Math.max(D.now(), Number(row.updated || 0) + 1))) { ST.persist = 'db'; return; }
    }
  } catch (e) { ST.persist = 'memory (db error)'; }
}
const pending = (wk) => (wk.sched || []).filter((e) => e.state === 'post' && !wk.ev[e.id]);
const gaveUp = (id) => (ST.fails[id] || { n: 0 }).n >= 2; // two failed tries: the list is built without that game (and says so); it is tried again later
function progress() { let done = 0, total = 0; Object.values(ST.weeks).forEach((wk) => { const n = Object.keys(wk.ev).length; done += n; total += wk.done ? n : Math.max(n, (wk.sched || []).filter((e) => e.state === 'post').length); }); ST.prog = { done, total }; }
async function buildNow() {
  const now = D.now(); ST.lastTry = now;
  const sb = C.parseSb(await getJson(ESPN + 'scoreboard?limit=400'));
  if (!sb.week || !sb.year) throw new Error('espn empty');
  if (sb.year !== ST.year) { const keep = ST.building; ST = Object.assign(fresh(), { building: keep, lastTry: now }); }
  ST.cur = sb.week; ST.year = sb.year; ST.type = sb.type;
  const last = sb.type === 2 ? sb.week : sb.type === 3 ? 18 : 0; // regular season only
  for (let w = 1; w <= last; w++) {
    const wk = (ST.weeks[w] = ST.weeks[w] || { ev: {}, sched: null, done: false, dbTried: false });
    if (wk.done) continue; await dbLoad(w, wk); if (wk.done) { progress(); continue; }
    if (sb.type === 2 && w === sb.week) wk.sched = sb.events; else { wk.sched = C.parseSb(await getJson(ESPN + 'scoreboard?limit=400&week=' + w + '&seasontype=2')).events; await D.sleep(PAUSE); }
    progress();
    const todo = pending(wk).filter((e) => { const f = ST.fails[e.id]; return !f || f.n < 2 || D.now() - f.at >= RETRY_WAIT; }); let got = 0;
    for (let i = 0; i < todo.length; i += BATCH) {
      await Promise.all(todo.slice(i, i + BATCH).map(async (e) => {
        try { const p = C.parseBox(await getJson(ESPN + 'summary?event=' + e.id)); if (!p.length && (ST.fails[e.id] || { n: 0 }).n < 4) throw new Error('empty box'); wk.ev[e.id] = { w, t: e.t, h: e.h, a: e.a, p }; delete ST.fails[e.id]; ST.ver++; got++; }
        catch (x) { ST.fails[e.id] = { n: ((ST.fails[e.id] || {}).n || 0) + 1, at: D.now() }; }
      }));
      progress(); await D.sleep(PAUSE);
    }
    const was = wk.done; wk.done = !!wk.sched.length && wk.sched.every((e) => e.state === 'post' && wk.ev[e.id]);
    if (got || (wk.done && !was)) await dbSave(w, wk);
  }
  // The week to show: ESPN's current week while it still has a game that has not kicked off, else the next week.
  let tw = sb.week, games = sb.type === 2 ? sb.events.filter((e) => e.state === 'pre') : [];
  if (sb.type === 2 && !games.filter((e) => e.t > D.now()).length && sb.week < 18) { try { const nx = C.parseSb(await getJson(ESPN + 'scoreboard?limit=400&week=' + (sb.week + 1) + '&seasontype=2')); if (nx.events.length) { tw = sb.week + 1; games = nx.events.filter((e) => e.state === 'pre'); } } catch (e) {} }
  ST.target = { week: tw, games };
  ST.ready = Object.values(ST.weeks).every((wk) => wk.done || (wk.sched && pending(wk).every((e) => gaveUp(e.id))));
  ST.lastOk = D.now(); ST.err = ''; progress();
}
function kick() {
  if (ST.building) return; const now = D.now(), wait = ST.err ? ERR_WAIT : ST.ready ? TTL : ERR_WAIT;
  if (ST.lastTry && now - ST.lastTry < wait) return;
  ST.building = true;
  ST.job = buildNow().catch((e) => { ST.err = 'ESPN did not answer'; }).then(() => { ST.building = false; });
}
function payload() {
  const now = D.now();
  const o = { season: ST.year || null, week: ST.target ? ST.target.week : ST.cur || null, currentWeek: ST.cur || null, builtAt: ST.lastOk || null, building: !ST.ready, progress: ST.prog, unavailable: !ST.ready && !!ST.err, rule: C.RULE, ideasOnly: 'Ideas only. No sportsbook line or price. Not part of the Oddable Alert.', source: 'ESPN box scores', persist: ST.persist, ideas: [], carry: null };
  if (!ST.ready) return o;
  if (ST.type !== 2) { o.note = 'The regular season is not on, so there are no ideas.'; }
  if (!ST.memo || ST.memo.ver !== ST.ver) { const ev = []; Object.values(ST.weeks).forEach((wk) => Object.keys(wk.ev).forEach((id) => ev.push(Object.assign({ id }, wk.ev[id])))); const B = C.build(ev); ST.memo = { ver: ST.ver, B, carry: C.carry(B) }; }
  o.carry = ST.memo.carry;
  const up = ST.target && ST.type === 2 ? ST.target.games.filter((g) => g.t > now) : [];
  const busy = []; ((ST.weeks[ST.cur] || {}).sched || []).forEach((e) => { if (e.state !== 'post' && e.t <= now) busy.push(e.h, e.a); });
  o.ideas = C.ideas(ST.memo.B, up, busy); o.gamesLeft = up.length;
  const miss = Object.values(ST.weeks).reduce((n, wk) => n + (wk.done ? 0 : pending(wk).length), 0); if (miss) { o.missing = miss; o.note = miss + ' finished game' + (miss === 1 ? '' : 's') + ' could not be read from ESPN yet and ' + (miss === 1 ? 'is' : 'are') + ' left out.'; }
  if (!up.length && !o.note) o.note = 'No games left to kick off this week.';
  return o;
}
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (path !== '/propideas') return false;
  if (req.method !== 'GET') { send(res, 405, { error: 'GET only' }); return true; }
  try { kick(); send(res, 200, payload()); } catch (e) { send(res, 200, { building: false, unavailable: true, ideas: [], carry: null, error: 'Prop ideas error' }); }
  return true;
}
module.exports = { handle, core, _deps: D, _reset: () => { ST = fresh(); }, _state: () => ST, _wait: () => ST.job || Promise.resolve(), _payload: payload };
