// Oddable Groups lifetime stats (v274, Nov 17 2026), behind the Groups switches. Route: POST /groups/stats (groups.js handle() calls stats() below, so the
// switches, the signed-in check and the "Your time has ended" lock are the SAME as every /groups call; nothing here runs for a blocked caller).
//   {}               -> my own record (every group I am in)
//   {id, pid}        -> the record of member `pid` of group `id`, as I may see it: ONLY from groups we are BOTH members of now.
// WHERE THE NUMBERS COME FROM (never from anyone's private bets / synced bets row):
//   Picks contests = FINISHED picks contests (the contest's last day is over, Chicago time) of those groups, read through the group's own standings
//                    (groups.js standings(): the group book and ledger, graded by Oddable, the same numbers the Contest screen shows).
//   Golf days      = CLOSED Golf days of those groups (golfday.js rows 'lock:gd:<group id>': the kept days, plus `hist`, the compact final board golfday.js
//                    writes for every day it closes from v274 on, so days pushed out of the last 5 still count).
// DEFINITIONS (coder's, manager / owner to confirm; HANDOFF "## v274 (groups-stats)"):
//   played (picks)  = a member of that contest when it finished.
//   won             = place 1 on the final standings with at least one settled bet; a shared first place (T1) counts as a win and is marked "shared".
//   best finish     = the best place among contests played with at least one settled bet ("T2 of 6").
//   record / units  = the sum over finished contests of the W-L-P and units the contest's standings show for that member (a Best-five contest counts its best
//                     five a week, as its standings do). Bets still being graded after the end are left out and counted in `open`.
//   golf played     = a closed day where the member logged at least one counting hole.  golf wins = place 1 (ties shared) on the final board.
//   best net to par = the lowest (net strokes - par) on a FINISHED card (every counting hole); on a gross day no strokes are given, so net = gross.
//   best Stableford = the highest points on a finished card of a Stableford day.  9-hole and 18-hole rounds are listed together, each with its holes.
// PRIVACY: the answer holds names, group / contest / course names, dates and numbers. Never a phone number, email, account id, PIN, sync row id or member key.
'use strict';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = (day) => (/^\d{4}-\d{2}/.test(String(day || '')) ? MON[Number(day.slice(5, 7)) - 1] + ' ' + day.slice(0, 4) : '');
const isInt = (v, a, b) => typeof v === 'number' && Number.isInteger(v) && v >= a && v <= b;
const r2 = (x) => Math.round(Number(x || 0) * 100) / 100;
const bad = (status, error) => Object.assign(new Error(error), { status });
const GROUPSMAX = 60;

// One finished picks contest -> the target's line. Pure: `s` = the standings() answer, `pid` = the target's member id in that group.
function picksLine(g, c, s, pid, sportName) {
  const row = (s.rows || []).find((x) => x.pid === pid); if (!row) return null;
  const t = row.t || {}, settled = Number(t.settled) || 0;
  return { group: g.name, contest: c.name, sport: sportName || '', start: c.startDay, end: c.endDay, metric: (c.rules || {}).metric || '',
    place: settled > 0 && !row.none ? row.place : null, tied: settled > 0 && !row.none ? !!row.tied : false, of: (s.rows || []).length,
    w: Number(t.w) || 0, l: Number(t.l) || 0, p: Number(t.p) || 0, units: r2(t.units), open: Number(t.open) || 0, settled };
}
function picksSum(list) {
  const out = { played: list.length, won: 0, shared: 0, best: null, w: 0, l: 0, p: 0, units: 0, open: 0, since: '', list: list.slice().sort((a, b) => (b.end > a.end ? 1 : b.end < a.end ? -1 : 0)) };
  list.forEach((x) => { out.w += x.w; out.l += x.l; out.p += x.p; out.units += x.units; out.open += x.open;
    if (x.place === 1) { out.won++; if (x.tied) out.shared++; }
    if (x.place != null && (!out.best || x.place < out.best.place || (x.place === out.best.place && x.end > out.best.end))) out.best = { place: x.place, tied: x.tied, of: x.of, group: x.group, contest: x.contest, end: x.end }; });
  out.units = r2(out.units); const first = list.map((x) => x.start).filter(Boolean).sort()[0]; out.since = monthOf(first);
  return out;
}
// One closed Golf day (its final board rows) -> the target's line. Pure.
const FNAME = { gross: 'Stroke play (gross)', net: 'Stroke play (net)', stableford: 'Stableford' }, HNAME = { all: '18 holes', front: 'Front 9', back: 'Back 9' };
function golfLine(g, h, pid) {
  const r = (h.rows || []).find((x) => x.pid === pid); if (!r || !(r.thru > 0)) return null;
  const done = !!r.done, holes = h.short || h.holes, on = (h.rows || []).filter((x) => x.thru > 0).length;
  return { group: g.name, name: h.name, course: h.course, date: h.date, format: h.format, formatName: FNAME[h.format] || '', holes, holesName: HNAME[holes] || '', short: !!h.short,
    place: r.place || null, tied: !!r.tied, of: on, thru: r.thru, holesN: r.of, done, gross: r.gross, toPar: r.toPar,
    net2par: done ? r.net - r.par : null, pts: done && h.format === 'stableford' ? r.pts : null };
}
function golfSum(list) {
  const out = { played: list.length, wins: 0, shared: 0, bestNet: null, bestSf: null, since: '', list: list.slice().sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0)) };
  list.forEach((x) => { if (x.place === 1) { out.wins++; if (x.tied) out.shared++; }
    if (x.net2par != null && (!out.bestNet || x.net2par < out.bestNet.v)) out.bestNet = { v: x.net2par, holesName: x.holesName, course: x.course, date: x.date, group: x.group };
    if (x.pts != null && (!out.bestSf || x.pts > out.bestSf.v)) out.bestSf = { v: x.pts, holesName: x.holesName, course: x.course, date: x.date, group: x.group }; });
  out.since = monthOf(list.map((x) => x.date).filter(Boolean).sort()[0]);
  return out;
}
// A closed day as golfday.js keeps it in `days` (full) -> the compact final shape it keeps in `hist`.
function histOf(GD, d) { return { id: d.id, name: d.name, course: (d.course || {}).name || '', date: d.date, format: d.format, holes: d.holes, short: d.short || '', closed: d.closed || 0,
  rows: GD.board(d).map((r) => ({ pid: r.pid, name: r.name, place: r.place || 0, tied: !!r.tied, thru: r.thru, of: r.of, done: !!r.done, gross: r.gross, par: r.par, net: r.net, pts: r.pts, toPar: r.toPar })) }; }

// I = groups.js internals (gread, memberOf, inContest, cEnded, standings, names, shownName, MK, pmap, limit, D, SPORTN). u = {e, mk} the signed-in caller.
async function stats(I, u, b, now) {
  b = b || {}; let tmk = u.mk, from = null, tName = '';
  if (I.limit('gstats|' + u.mk, 40, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.');
  const nm = await I.names();
  if (b.id != null || b.pid != null) {
    const g = await I.gread(String(b.id || '')); if (!g || !I.memberOf(g, u.mk)) throw bad(404, 'Group not found');
    const m = g.members.find((x) => x.pid === String(b.pid || '')); if (!m) throw bad(404, 'Member not found');
    tmk = m.mk; from = g; tName = I.shownName(m, nm);
  }
  const self = tmk === u.mk;
  const mi = await I.D.S.dbGet(I.MK(u.mk)).catch(() => null), x = (mi && mi.data) || {};
  const ids = [...new Set([...(x.g || []), ...Object.keys(x.own || {})])].slice(-GROUPSMAX); if (from && !ids.includes(from.id)) ids.push(from.id);
  const gs = (await I.pmap(ids, 6, (id) => (from && id === from.id ? from : I.gread(id).catch(() => null)))).filter((g) => g && I.memberOf(g, u.mk) && I.memberOf(g, tmk));
  if (!tName) { const g0 = gs[0], m0 = g0 && I.memberOf(g0, tmk); tName = m0 ? I.shownName(m0, nm) : 'You'; }
  const ctx = { rows: new Map(), budget: 60 }, picks = [], golf = []; let failed = 0;
  for (const g of gs) {
    const mt = I.memberOf(g, tmk);
    for (const c of g.contests.filter((c) => c.kind === 'picks' && I.cEnded(c, now) && I.inContest(c, g).some((m) => m.mk === tmk))) {
      try { const s = await I.standings(g, c, 'season', null, ctx), line = picksLine(g, c, s, mt.pid, I.SPORTN[c.sport]); if (line) picks.push(line); } catch (e) { failed++; }
    }
    let row = null; try { row = await I.D.S.dbGet('lock:gd:' + g.id); } catch (e) { failed++; }
    const data = (row && row.data) || {}, seen = new Set(), GD = require('./golfday');
    const hist = (Array.isArray(data.hist) ? data.hist : []).filter((h) => h && h.id && h.closed);
    const kept = (Array.isArray(data.days) ? data.days : []).filter((d) => d && d.closed && Array.isArray(d.players)).map((d) => { try { return histOf(GD, d); } catch (e) { return null; } }).filter(Boolean);
    hist.concat(kept).forEach((h) => { if (seen.has(h.id)) return; seen.add(h.id); const line = golfLine(g, h, mt.pid); if (line) golf.push(line); });
  }
  const P = picksSum(picks), Gf = golfSum(golf);
  return { ok: true, me: self, name: tName, groups: gs.length, picks: P, golf: Gf, failed,
    source: { picks: P.played ? 'Finished group contests since ' + P.since : 'No finished group contest yet', golf: Gf.played ? 'Closed Golf days since ' + Gf.since : 'No closed Golf day yet',
      scope: self ? 'Your groups: ' + gs.length : 'Groups you are both in: ' + gs.length } };
}
module.exports = { stats, picksLine, picksSum, golfLine, golfSum, histOf, monthOf };
