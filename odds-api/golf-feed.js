// Oddable Golf: ESPN public golf feed (no key, no paid API). Cached server-side.
// SOURCES (Nov 16 2026; the sandbox cannot reach ESPN, so no live response was captured):
//   - Scoreboard https://site.api.espn.com/apis/site/v2/sports/golf/<pga|lpga|eur>/scoreboard: listed as answering HTTP 200 by sportsapis.dev/espn-api,
//     and read by the open-source parser sports-skills 0.40.5 (PyPI, golf/_connector.py): events[].competitions[0].competitors[] with
//     id, order (leaderboard order), athlete.displayName, score (to-par string), linescores[] per round {period 1-4, value strokes, displayValue to par, "-" = unplayed,
//     nested linescores[] per hole {period 1-18, value, scoreType.displayValue}}; leagues[0].calendar[] {id, label, startDate, endDate}. That parser notes ESPN's golf
//     scoreboard IGNORES an event parameter, so a past/future event is read with dates=YYYYMMDD (its start day) and filtered by id. It sends no tee times or cut/WD status.
//   - Leaderboard https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=<tour>&event=<id>: richer (status.position, status.thru, status.teeTime,
//     status.type CUT/WD, earnings) per other open-source parsers, but NOT VERIFIED. Tried first; on any failure the scoreboard is used.
// The parser is defensive and every field is optional. Without tee times, picks lock at the event's start time (event.date).
'use strict';
const D = { fetch: (...a) => fetch(...a), now: () => Date.now() };
const TOURS = { pga: 'PGA TOUR', lpga: 'LPGA', eur: 'DP World Tour', liv: 'LIV Golf' };
const SB = (t) => 'https://site.api.espn.com/apis/site/v2/sports/golf/' + t + '/scoreboard';
const LB = (t, ev) => 'https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=' + t + (ev ? '&event=' + encodeURIComponent(ev) : '');
const TTL = 3 * 6e4, BACKOFF = 2 * 6e4;
const C = new Map(); // url -> {at, v, p (in-flight), fail}

async function getJSON(url) {
  const c = C.get(url) || {}; const now = D.now();
  if (c.v && now - c.at < TTL) return c.v;
  if (c.fail && now - c.fail < BACKOFF) { if (c.v) return c.v; throw new Error('golf feed unavailable'); }
  if (c.p) return c.p;
  c.p = (async () => {
    try { const r = await D.fetch(url, { signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); c.v = j; c.at = D.now(); c.fail = 0; return j; }
    catch (e) { c.fail = D.now(); if (c.v) return c.v; throw e; }
    finally { c.p = null; }
  })();
  C.set(url, c); if (C.size > 200) C.delete(C.keys().next().value);
  return c.p;
}
const num = (v) => { if (v == null || v === '') return null; if (typeof v === 'number') return Number.isFinite(v) ? v : null; const s = String(v).trim(); if (/^E$/i.test(s)) return 0; const n = Number(s.replace(/^\+/, '')); return Number.isFinite(n) ? n : null; };
const txt = (s, n) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/[<>`\\\u0000-\u001f]/g, '').slice(0, n || 60); // keeps apostrophes (Sean O'Hair); consumers escape

// Events on a tour's scoreboard (this week + calendar when present).
function parseEvents(j, tour) {
  const out = [];
  (j && j.events || []).forEach((e) => { const st = e.status && e.status.type || {}; out.push({ id: txt(e.id, 20), tour, name: txt(e.name || e.shortName, 80), start: Date.parse(e.date) || null, end: Date.parse(e.endDate) || null, state: txt(st.state, 8) || 'pre' }); });
  const cal = (j && j.leagues && j.leagues[0] && j.leagues[0].calendar) || [];
  cal.forEach((e) => { const id = txt(e.id || (e.event && e.event.id) || '', 20); if (!id || out.some((x) => x.id === id)) return; out.push({ id, tour, name: txt(e.label || e.name, 80), start: Date.parse(e.startDate) || null, end: Date.parse(e.endDate) || null, state: 'cal' }); });
  return out;
}
// Status of one golfer: 'active' | 'cut' | 'wd' | 'dq' (missed cut, withdrew, disqualified). Reads status.type.name, status.position, status.displayValue.
function stOf(c) {
  const s = c.status || {}, t = String((s.type && (s.type.name || s.type.shortDetail || s.type.description)) || '').toUpperCase(), p = String((s.position && (s.position.displayName || s.position.id)) || s.displayValue || '').toUpperCase();
  const all = t + ' ' + p;
  if (/\bCUT\b|STATUS_CUT|MC\b|MDF/.test(all)) return 'cut';
  if (/\bWD\b|WITHDR/.test(all)) return 'wd';
  if (/\bDQ\b|DISQUAL/.test(all)) return 'dq';
  return 'active';
}
// One event's leaderboard -> {event, golfers[], firstTee, purse, earnings (true when every finished golfer has a prize amount)}.
function parseBoard(j, tour) {
  const ev = (j && j.events && j.events[0]) || {}, comp = (ev.competitions && ev.competitions[0]) || {};
  const est = (ev.status && ev.status.type) || (comp.status && comp.status.type) || {};
  const golfers = []; let firstTee = null;
  (comp.competitors || []).forEach((c) => {
    const a = c.athlete || {}, s = c.status || {}, ls = Array.isArray(c.linescores) ? c.linescores : [];
    const rounds = ls.map((r) => { const un = String(r.displayValue == null ? '' : r.displayValue).trim() === '-'; const hl = Array.isArray(r.linescores) ? r.linescores.filter((h) => !h || h.period == null || (num(h.period) >= 1 && num(h.period) <= 18)).length : null; return { n: num(r.period) || null, strokes: un ? null : num(r.value), toPar: un ? null : num(r.displayValue), holes: un ? 0 : hl }; }).filter((r) => r.n && r.n <= 5);
    const stat = (c.statistics || []).find((x) => x && /scoreToPar/i.test(x.name || ''));
    const toPar = num(c.score && typeof c.score === 'object' ? (c.score.displayValue != null ? c.score.displayValue : c.score.value) : c.score) ?? (stat ? num(stat.displayValue) : null);
    const lp = rounds.filter((r) => r.strokes != null || r.holes > 0).pop() || null;
    const thruRaw = s.thru != null ? (typeof s.thru === 'object' ? s.thru.value : s.thru) : lp && lp.holes ? lp.holes : null, thru = num(thruRaw);
    const tee = Date.parse(s.teeTime) || null; if (tee && (!firstTee || tee < firstTee)) firstTee = tee;
    const started = rounds.some((r) => r.strokes > 0 || r.holes > 0) || (thru != null && thru > 0);
    const earn = num(c.earnings != null ? c.earnings : c.amount);
    golfers.push({ id: txt(c.id || a.id, 20), name: txt(a.displayName || a.fullName || a.shortName, 50), short: txt(a.shortName, 30), pos: txt((s.position && s.position.displayName) || '', 6), toPar: started ? toPar : null, today: lp ? lp.toPar : null, thru: thru != null ? (thru >= 18 ? 'F' : String(thru)) : txt(s.displayThru || '', 4), rounds: rounds.map((r) => r.strokes), rounds2: rounds, st: stOf(c), tee, started, earn, sort: num(c.sortOrder) ?? num(c.order) ?? 999, hasSt: !!(c.status && (c.status.type || c.status.position || c.status.displayValue)) });
  });
  golfers.sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name));
  // Scoreboard shape (no per-golfer status): infer. Missed cut = no score in a round that most of the field has played (rounds 3-4);
  // withdrew = a round with hole detail stopped short of 18 while the field has gone on to a later round (the parser in sports-skills reads WDs the same way).
  // Scoreboard shape (no per-golfer status): infer, conservatively (review fix Nov 16 2026).
  //  CUT: the golfer has no round-3 entry at all while others already carry one (ESPN adds the round-3 placeholder "-" for golfers who made the cut),
  //       or the event is final and the golfer has round 2 but no round-3 score. A leader who simply has not teed off Saturday keeps the placeholder = active.
  //  WD:  a round with hole detail that stopped short of 18, and either the event is final or a LATER round has been completed by every other golfer who has it
  //       (a suspended round, where many golfers stop short, is never read as WD).
  const done0 = String(est.state || '') === 'post' || /FINAL|COMPLETE/i.test(String(est.name || ''));
  if (golfers.length && !golfers.some((g) => g.hasSt)) {
    const has = (g, n) => g.rounds2.some((r) => r.n === n), full = (r) => (r.holes != null ? r.holes >= 18 : r.strokes != null);
    const r3some = golfers.some((g) => has(g, 3));
    const laterDone = (g, after) => [after + 1, after + 2, after + 3, 4].some((n) => { const o = golfers.filter((x) => x !== g && has(x, n)); return o.length > 0 && o.every((x) => full(x.rounds2.find((r) => r.n === n))); });
    golfers.forEach((g) => { const last = g.rounds2.filter((r) => r.strokes != null || r.holes > 0).pop();
      if (last && last.holes != null && last.holes > 0 && last.holes < 18 && (done0 || laterDone(g, last.n))) g.st = 'wd';
      else if (g.rounds2.some((r) => r.n === 2 && full(r)) && ((r3some && !has(g, 3)) || (done0 && !g.rounds2.some((r) => r.n >= 3 && (r.strokes != null || r.holes > 0))))) g.st = 'cut'; });
  }
  golfers.forEach((g) => { delete g.hasSt; delete g.rounds2; });
  if (golfers.length && !golfers.some((g) => g.pos)) { const act = golfers.filter((g) => g.st === 'active' && g.toPar != null); act.forEach((g) => { const k = act.filter((x) => x.toPar < g.toPar).length + 1, tie = act.filter((x) => x.toPar === g.toPar).length > 1; g.pos = (tie ? 'T' : '') + k; }); golfers.forEach((g) => { if (g.st !== 'active') g.pos = g.st.toUpperCase(); }); }
  const done = String(est.state || '') === 'post' || /FINAL|COMPLETE/i.test(String(est.name || ''));
  const fin = golfers.filter((g) => g.st === 'active' && g.started);
  return { event: { id: txt(ev.id, 20), tour, name: txt(ev.name || ev.shortName, 80), start: Date.parse(ev.date) || null, end: Date.parse(ev.endDate) || null, state: txt(est.state, 8) || 'pre', round: num(comp.status && comp.status.period) || null, done, purse: num(ev.purse || (ev.displayPurse || '').replace(/[$,]/g, '')) },
    golfers, firstTee, earnings: done && fin.length > 0 && fin.every((g) => g.earn != null) };
}
async function events(tour) { if (!TOURS[tour]) throw new Error('tour'); return parseEvents(await getJSON(SB(tour)), tour); }
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
// Leaderboard first (richer, NOT VERIFIED); on failure or an empty field, the scoreboard (verified shape): this week's, or dates=<start day> for another event.
async function board(tour, eventId) {
  if (!TOURS[tour]) throw new Error('tour'); let first = null;
  try { const b = parseBoard(await getJSON(LB(tour, eventId)), tour); if (b.golfers.length && (!eventId || !b.event.id || b.event.id === String(eventId))) return b; first = new Error(b.golfers.length ? 'event mismatch' : 'empty leaderboard'); } catch (e) { first = e; }
  let j = await getJSON(SB(tour)); const has = (x) => x && Array.isArray(x.events) && x.events.some((e) => !eventId || String(e.id) === String(eventId));
  if (eventId && !has(j)) { const ev = parseEvents(j, tour).find((e) => e.id === String(eventId)); if (!ev || !ev.start) throw first || new Error('event not found'); j = await getJSON(SB(tour) + '?dates=' + ymd(ev.start)); if (!has(j)) throw new Error('event not on the scoreboard'); }
  const one = Object.assign({}, j, { events: (j.events || []).filter((e) => !eventId || String(e.id) === String(eventId)).slice(0, 1) });
  const b = parseBoard(one, tour); b.src = 'scoreboard'; return b;
}
module.exports = { TOURS, events, board, parseBoard, parseEvents, stOf, SB, LB, ymd, _deps: D, _reset: () => C.clear() };
