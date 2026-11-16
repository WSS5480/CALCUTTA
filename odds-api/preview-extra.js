// TEST PREVIEW ONLY: stand-ins for two owner decisions whose engines are not committed yet. Every answer carries inProgress: true and the screens say
// "Preview: in progress". When the real engines land (pairing.js for P1, the golf/stats tournament handicap for E-H), delete this file's routes.
//   POST /preview/hcp     E-H: a director adds or changes a handicap for ONE tournament; the Oddable index from real results always shows next to it
//   POST /preview/pairing P1:  Balanced / Rotate / Hot pairs suggestions from handicaps (golf) or Oddable ratings (pickleball) and who played together
const S = require('./sync');
const bad = (status, error) => Object.assign(new Error(error), { status });
const P = () => require('./preview');
const LOG = 'lock:pv:thcp';
const fx = (n) => (n == null ? null : (Math.round(Number(n) * 10) / 10).toFixed(1));
async function oddHcp(e) { try { const ST = require('./stats'); const h = ST.golfHcp(await ST.statsFor(e)); return h && h.index != null ? Number(h.index) : null; } catch (er) { return null; } }
async function oddRating(e, sport) { try { const ST = require('./stats'); const r = ST.eloAll(await ST.statsFor(e))[sport]; return r && r.rating != null ? Math.round(r.rating) : null; } catch (er) { return null; } }
async function logRow() { const r = await S.dbGet(LOG); return r || { id: LOG, salt: 'x', pinhash: 'x', data: { set: {}, log: [] }, updated: 0 }; }
async function tourView(X, e) {
  const dir = X.USERS.find((u) => u.role === 'director'), id = X.STATE.ids.tour; if (!id) throw bad(404, 'The demo tournament is not ready yet');
  const r = await P().call('golf', 'director', '/golf/get', { id }); if (r.s !== 200) throw bad(404, 'The demo tournament is not ready yet');
  const g = r.j.game, row = (await logRow()).data, me = X.USERS.find((u) => X.emailOf(u) === e), locked = g.day.status !== 'setup', players = [];
  for (const m of g.members) { const u = X.USERS.find((x) => x.name === m.name && !m.guest), odd = u ? await oddHcp(X.emailOf(u)) : null, t = row.set[m.pid];
    const tour = t ? t.val : null, line = (odd != null ? 'Oddable ' + fx(odd) + ' (real results)' : 'No Oddable handicap yet') + ' · ' + (tour != null ? 'Tournament ' + fx(tour) + ', set by director' : 'no tournament number' + (odd != null ? ', plays off the Oddable number' : ''));
    players.push({ pid: m.pid, name: m.name + (m.guest ? ' (guest)' : ''), me: !!(me && u && me.role === u.role), odd, tour, line, log: row.log.filter((x) => x.pid === m.pid) }); }
  return { inProgress: true, title: g.title + ' · ' + g.day.course.name, when: 'Tee off ' + g.day.date, locked, canEdit: !!(me && me.role === 'director'), director: dir.name, players, log: row.log.map((x) => ({ at: new Date(x.at).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), by: x.by, player: x.player, old: fx(x.old), val: x.val == null ? 'none (back to the Oddable number)' : fx(x.val), why: x.why })) };
}
// the director sets (or clears, val null) one player's number for this tournament; logged who / when / old / new / reason; locked once the round starts
async function setTour(X, by, pid, val, why) {
  const id = X.STATE.ids.tour, r = await P().call('golf', 'director', '/golf/get', { id }); if (r.s !== 200) throw bad(404, 'Tournament not found');
  const g = r.j.game, m = g.members.find((x) => x.pid === String(pid)); if (!m) throw bad(404, 'Player not found');
  if (g.day.status !== 'setup') throw bad(409, 'The tournament has started. Handicaps are locked.');
  let v = null; if (val != null && val !== '') { v = Math.round(Number(val) * 10) / 10; if (!Number.isFinite(v) || v < -10 || v > 54) throw bad(400, 'Handicap: a number from -10 to 54'); }
  const u = X.USERS.find((x) => x.name === m.name && !m.guest), odd = u ? await oddHcp(X.emailOf(u)) : null, use = v != null ? v : odd;
  if (use != null) { const a = await P().call('golf', 'director', '/golf/team', { id, op: 'hcp', pid: m.pid, hcp: use }); if (a.s !== 200) throw bad(a.s, (a.j && a.j.error) || 'Could not save'); } // the real golf engine uses this number for strokes
  const row = await logRow(), d = row.data, old = d.set[m.pid] ? d.set[m.pid].val : null; if (v == null) delete d.set[m.pid]; else d.set[m.pid] = { val: v, at: Date.now() };
  d.log.push({ at: Date.now(), by: by.name + ' (director)', pid: m.pid, player: m.name, old, val: v, why: String(why || '').replace(/[<>&"']/g, '').slice(0, 80) }); d.log = d.log.slice(-200);
  await S.dbPut({ id: LOG, salt: 'x', pinhash: 'x', data: d, updated: Date.now() }); return { ok: true };
}
// ---------- partner suggestions ----------
// made-up "who played with whom" history for the demo people (the real version will read lifetime stats): [a, b, times together in the last 5, wins, losses]
const HIST = { golf: [['Coach Mo', 'RGV Ray', 3, 2, 1], ['Coach Mo', 'Tex Tina', 2, 2, 0], ['RGV Ray', 'Dinker Dee', 2, 0, 2], ['Pro Shop Pat', 'Birdie Bea', 3, 3, 0], ['Lefty Lou', 'Ace Abe', 2, 1, 1], ['Birdie Bea', 'Tex Tina', 1, 1, 0], ['Lefty Lou', 'Dinker Dee', 1, 0, 1]],
  pickleball: [['Coach Mo', 'RGV Ray', 2, 2, 0], ['RGV Ray', 'Dinker Dee', 1, 0, 1], ['Coach Mo', 'Birdie Bea', 1, 0, 1], ['Lefty Lou', 'Ace Abe', 2, 1, 1], ['Birdie Bea', 'Ace Abe', 1, 0, 1], ['Lefty Lou', 'Dinker Dee', 1, 0, 1]] };
const hist = (sport, a, b) => HIST[sport].find((h) => (h[0] === a && h[1] === b) || (h[0] === b && h[1] === a)) || [a, b, 0, 0, 0];
function matchings(list) { if (!list.length) return [[]]; const [a, ...rest] = list, out = []; rest.forEach((b, i) => { const others = rest.slice(0, i).concat(rest.slice(i + 1)); matchings(others).forEach((m) => out.push([[a, b]].concat(m))); }); return out; }
async function pairing(X, e, b) {
  const sport = b.sport === 'pickleball' ? 'pickleball' : 'golf', mode = ['balanced', 'rotate', 'hot'].includes(b.mode) ? b.mode : 'balanced', golf = sport === 'golf';
  const ppl = []; for (const u of X.USERS) { const v = golf ? await oddHcp(X.emailOf(u)) : await oddRating(X.emailOf(u), 'pickleball'); ppl.push({ name: u.name, v, show: v == null ? (golf ? 'no handicap yet' : 'no rating yet (counts as 1500)') : golf ? 'Oddable ' + fx(v) : 'Oddable rating ' + v, n: v == null ? (golf ? 18 : 1500) : v }); }
  const by = {}; ppl.forEach((p) => { by[p.name] = p; }); const all = matchings(ppl.map((p) => p.name));
  const score = (m) => { const sums = m.map(([a, c]) => by[a].n + by[c].n), spread = Math.max(...sums) - Math.min(...sums), tog = m.reduce((s, [a, c]) => s + hist(sport, a, c)[2], 0), rec = m.reduce((s, [a, c]) => { const h = hist(sport, a, c); return s + (h[3] - h[4]); }, 0); return { m, sums, spread, tog, rec }; };
  const S2 = all.map(score); S2.sort(mode === 'balanced' ? (x, y) => x.spread - y.spread || x.tog - y.tog : mode === 'rotate' ? (x, y) => x.tog - y.tog || x.spread - y.spread : (x, y) => y.rec - x.rec || x.spread - y.spread);
  const unit = golf ? 'combined handicap' : 'combined rating';
  const suggestions = S2.slice(0, 3).map((x) => ({ teams: x.m.map(([a, c], i) => ({ names: [a, c], show: (golf ? fx(x.sums[i]) : Math.round(x.sums[i])) + ' ' + unit })),
    reason: mode === 'balanced' ? 'Fairest split: the pairs are within ' + (golf ? fx(x.spread) + ' strokes' : Math.round(x.spread) + ' rating points') + ' of each other.' : mode === 'rotate' ? (x.tog === 0 ? 'Nobody here has been paired together in their last 5 games.' : 'Fewest repeats: these pairs have played together ' + x.tog + ' time' + (x.tog === 1 ? '' : 's') + ' in the last 5 games.') : 'Best records together: ' + x.m.map(([a, c]) => { const h = hist(sport, a, c); return h[2] ? a.split(' ').pop() + ' + ' + c.split(' ').pop() + ' ' + h[3] + '-' + h[4] : null; }).filter(Boolean).join(', ') + '.' }));
  return { inProgress: true, sport, mode, how: mode === 'balanced' ? 'Balanced (the default): pairs whose ' + (golf ? 'handicaps' : 'ratings') + ' add up as close as possible, so matches are fair.' : mode === 'rotate' ? 'Rotate: pairs who have not played together lately.' : 'Hot pairs: pairs with the best record together.', players: ppl.map((p) => ({ name: p.name, show: p.show })), suggestions,
    note: (golf ? 'Handicaps are each player\'s Oddable Handicap Index from real app rounds.' : 'Ratings are each player\'s Oddable rating from real app matches.') + ' The who-played-with-whom history is demo data in this test copy.' };
}
const routes = {
  '/preview/hcp': async (e, b, X) => { if (b.op === 'set') { const me = X.USERS.find((u) => X.emailOf(u) === e); if (!me || me.role !== 'director') throw bad(403, 'Only the tournament director can change a tournament handicap'); await setTour(X, me, b.pid, b.value, b.why); } return tourView(X, e); },
  '/preview/pairing': (e, b, X) => pairing(X, e, b),
};
module.exports = { routes, setTour };
