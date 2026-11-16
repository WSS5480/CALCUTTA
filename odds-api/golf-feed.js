// Oddable Golf: ESPN public golf feed (no key, no paid API). Cached server-side.
// Field paths below come from ESPN's public JSON as read by several open-source parsers (see HANDOFF "Golf (engine v1)").
// NOT VERIFIED against a live response from this sandbox (it cannot reach ESPN): the parser is defensive and every field is optional.
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
const txt = (s, n) => String(s == null ? '' : s).replace(/[<>&"'`\\\u0000-\u001f]/g, '').slice(0, n || 60);

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
    const rounds = ls.map((r) => ({ n: num(r.period) || null, strokes: num(r.value), toPar: num(r.displayValue), holes: Array.isArray(r.linescores) ? r.linescores.length : null })).filter((r) => r.n);
    const stat = (c.statistics || []).find((x) => x && /scoreToPar/i.test(x.name || ''));
    const toPar = num(c.score && typeof c.score === 'object' ? (c.score.displayValue != null ? c.score.displayValue : c.score.value) : c.score) ?? (stat ? num(stat.displayValue) : null);
    const thruRaw = s.thru != null ? (typeof s.thru === 'object' ? s.thru.value : s.thru) : null, thru = num(thruRaw);
    const tee = Date.parse(s.teeTime) || null; if (tee && (!firstTee || tee < firstTee)) firstTee = tee;
    const started = rounds.some((r) => r.strokes > 0 || r.holes > 0) || (thru != null && thru > 0);
    const earn = num(c.earnings != null ? c.earnings : c.amount);
    golfers.push({ id: txt(c.id || a.id, 20), name: txt(a.displayName || a.fullName || a.shortName, 50), short: txt(a.shortName, 30), pos: txt((s.position && s.position.displayName) || '', 6), toPar: started ? toPar : null, today: rounds.length ? rounds[rounds.length - 1].toPar : null, thru: thru != null ? (thru >= 18 ? 'F' : String(thru)) : txt(s.displayThru || '', 4), rounds: rounds.map((r) => r.strokes), st: stOf(c), tee, started, earn, sort: num(c.sortOrder) ?? num(c.order) ?? 999 });
  });
  golfers.sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name));
  const done = String(est.state || '') === 'post' || /FINAL|COMPLETE/i.test(String(est.name || ''));
  const fin = golfers.filter((g) => g.st === 'active' && g.started);
  return { event: { id: txt(ev.id, 20), tour, name: txt(ev.name || ev.shortName, 80), start: Date.parse(ev.date) || null, end: Date.parse(ev.endDate) || null, state: txt(est.state, 8) || 'pre', round: num(comp.status && comp.status.period) || null, done, purse: num(ev.purse || (ev.displayPurse || '').replace(/[$,]/g, '')) },
    golfers, firstTee, earnings: done && fin.length > 0 && fin.every((g) => g.earn != null) };
}
async function events(tour) { if (!TOURS[tour]) throw new Error('tour'); return parseEvents(await getJSON(SB(tour)), tour); }
async function board(tour, eventId) { if (!TOURS[tour]) throw new Error('tour'); const b = parseBoard(await getJSON(LB(tour, eventId)), tour); if (eventId && b.event.id && b.event.id !== String(eventId)) throw new Error('event mismatch'); return b; }
module.exports = { TOURS, events, board, parseBoard, parseEvents, stOf, SB, LB, _deps: D, _reset: () => C.clear() };
