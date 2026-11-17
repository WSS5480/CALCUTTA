// Oddable v262: PGA Tour data layer (scores only; no picks, no lines, no money). No DOM in this file, so a later Groups / Calcutta feature can load it and read the same data.
//   window.PGA = { SB, parse(json, opts), schedule(json, now), load(), loadEvent(id, startMs), current(), teeParse, fmtPar }
//   Node: require('./pga.js') returns the same object (used by scripts/pga/pga.test.js).
// SOURCE: ESPN's public scoreboard, https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard (answers cross-origin).
// SHAPE (read by the manager in a browser on Nov 16 2026, event final): top keys leagues, season, day, events, provider.
//   leagues[0].calendar[] {id, label, startDate, endDate, event:{$ref}}; events[0] {id, name, shortName, date, endDate, status.type{name,state pre|in|post,completed,description}, competitions[0]}.
//   competitions[0].competitors[] {id, order 1..N, athlete{displayName, shortName, flag{alt}}, score "-20" | "E" | "+3", linescores[] one per round
//   {period, value strokes, displayValue to par ("-" and value 0 = no score), statistics.categories[0].stats[last].displayValue "Thu Nov 12 13:46:00 PST 2026" (tee time), linescores[] holes}}.
//   There is NO position, NO per-player status, NO venue and NO cut flag in that response. So: positions are worked out here from the score (ties "T3");
//   a missed cut is INFERRED (status 'cut' = did not play the weekend); nobody is called WD or DQ unless the feed carries a flag; a player with no card is 'ns' (no score posted).
// NOT SEEN LIVE: a round in progress (partial hole lists), a suspended round, a playoff. Those paths are defensive: every field is optional and nothing is invented.
(function (root) {
  'use strict';
  const SB = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === 'object' ? v : {});
  const txt = (s, n) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n || 80);
  // "-4" -> -4, "E" -> 0, "+3" -> 3, "-" / "" / null -> null
  const num = (v) => { if (v == null || v === '') return null; if (typeof v === 'number') return Number.isFinite(v) ? v : null; if (typeof v === 'object') return num(v.displayValue != null ? v.displayValue : v.value); const s = String(v).trim(); if (/^E(VEN)?$/i.test(s)) return 0; if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null; return Number(s); };
  const fmtPar = (n) => (n == null ? '' : n === 0 ? 'E' : n > 0 ? '+' + n : String(n));
  const TZ = { UTC: 0, GMT: 0, Z: 0, EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, AKDT: -8, HST: -10 };
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  // Tee time: "Thu Nov 12 13:46:00 PST 2026" (the form seen in the feed) or an ISO string. Anything else = null (never guessed).
  function teeParse(s) {
    if (typeof s !== 'string') return null; s = s.trim();
    const m = /^[A-Za-z]{3,9},? ([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ([A-Z]{1,4}) (\d{4})$/.exec(s);
    if (m) { const mo = MON[m[1].toLowerCase()], off = TZ[m[6]]; if (mo == null || off == null) return null; const t = Date.UTC(+m[7], mo, +m[2], +m[3] - off, +m[4], +(m[5] || 0)); return Number.isFinite(t) ? t : null; }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) { const t = Date.parse(s); return Number.isFinite(t) ? t : null; }
    return null;
  }
  function teeOf(ls) { let t = null; const scan = (v, d) => { if (t != null || d > 5 || v == null) return; if (typeof v === 'string') { t = teeParse(v); return; } if (Array.isArray(v)) { for (let i = v.length - 1; i >= 0 && t == null; i--) scan(v[i], d + 1); return; } if (typeof v === 'object') { if (typeof v.displayValue === 'string') { t = teeParse(v.displayValue); if (t != null) return; } ['categories', 'stats'].forEach((k) => scan(v[k], d + 1)); } }; scan(ls.teeTime, 0); if (t == null) scan(ls.statistics, 0); return t; }
  // A feed flag for cut / withdrew / disqualified. The Nov 16 2026 response had none; kept for the day ESPN sends one.
  function flagOf(c) {
    const s = obj(c.status), t = obj(s.type), p = obj(s.position);
    const all = [t.name, t.description, t.shortDetail, p.displayName, p.abbreviation, s.displayValue, typeof c.status === 'string' ? c.status : ''].map((x) => String(x == null ? '' : x).toUpperCase()).join(' ');
    if (/\bDQ\b|DISQUAL/.test(all)) return 'dq';
    if (/\bWD\b|WITHDR/.test(all)) return 'wd';
    if (/\bCUT\b|STATUS_CUT|\bMC\b|\bMDF\b/.test(all)) return 'cut';
    return '';
  }

  // The ONE place that knows ESPN's shape. opts.eventId picks an event (default: the first one).
  // Returns { event: null | {id,name,course,location,dates:{start,end},purse,status:'pre'|'in'|'suspended'|'final'|'canceled',statusText,round,rounds,cutLine,cutLineSrc,playoff,firstTee},
  //           players: [{id,name,short,country,pos,toPar,today,thru,teeTime,rounds:[{n,strokes,toPar,holes,complete}],total,status:'active'|'cut'|'wd'|'dq'|'ns',statusSrc:'feed'|'inferred'|'',movement,order,playoff}] }
  function parse(json, opts) {
    opts = opts || {};
    const evs = arr(obj(json).events).filter((e) => e && typeof e === 'object');
    const ev = opts.eventId != null ? evs.find((e) => String(e.id) === String(opts.eventId)) : evs[0];
    if (!ev) return { event: null, players: [] };
    const comp = obj(arr(ev.competitions)[0]);
    const st = Object.assign({}, obj(obj(comp.status).type), obj(obj(ev.status).type));
    const tour = obj(ev.tournament), REG = Math.min(Math.max(num(tour.numberOfRounds) || 4, 1), 6);
    const players = arr(comp.competitors).filter((c) => c && typeof c === 'object').map((c, i) => {
      const a = obj(c.athlete), tm = obj(c.team), all = [];
      arr(c.linescores).forEach((r) => {
        if (!r || typeof r !== 'object') return; const n = num(r.period); if (!n || n < 1 || n > 12 || n % 1) return;
        const dv = String(r.displayValue == null ? '' : r.displayValue).trim(), hasHoles = Array.isArray(r.linescores);
        const holes = hasHoles ? r.linescores.filter((h) => h && typeof h === 'object' && (num(h.value) > 0 || num(h.displayValue) > 0)).length : 0;
        const val = num(r.value), strokes = val != null && val > 0 ? val : null;
        const played = holes > 0 || (strokes != null && dv !== '-');
        const complete = played && (holes >= 18 || (holes === 0 && strokes != null && strokes >= 55));
        all.push({ n, strokes: played ? strokes : null, toPar: played ? num(dv) : null, holes: played ? (holes || (complete ? 18 : 0)) : 0, complete, played, tee: teeOf(r) });
      });
      all.sort((x, y) => x.n - y.n);
      const reg = all.filter((r) => r.n <= REG), po = all.some((r) => r.n > REG && r.played);
      const any = reg.some((r) => r.played);
      let toPar = any ? num(c.score) : null;
      if (any && toPar == null) { const ps = reg.filter((r) => r.played); if (ps.every((r) => r.toPar != null)) toPar = ps.reduce((s, r) => s + r.toPar, 0); }
      const mv = num(c.movement);
      return { id: txt(c.id != null ? c.id : a.id != null ? a.id : 'p' + i, 24), name: txt(a.displayName || a.fullName || a.shortName || tm.displayName || tm.name || 'Unknown', 60), short: txt(a.shortName || '', 40), country: txt(obj(a.flag).alt || '', 30),
        pos: '', toPar, today: null, thru: '', teeTime: null, rounds: reg, total: null, status: 'active', statusSrc: '', movement: mv == null ? undefined : mv, order: num(c.order) != null ? num(c.order) : num(c.sortOrder) != null ? num(c.sortOrder) : 9999, playoff: po,
        _flag: flagOf(c), _pos: txt(obj(obj(c.status).position).displayName || '', 6), _any: any };
    });

    const anyPlay = players.some((p) => p._any);
    const maxPlayed = players.reduce((m, p) => p.rounds.reduce((mm, r) => (r.played && r.n > mm ? r.n : mm), m), 0);
    let status = 'pre'; const nm = String(st.name || '') + ' ' + String(st.description || '');
    if (/CANCEL|POSTPON/i.test(nm)) status = 'canceled';
    else if (/SUSPEND|DELAY/i.test(nm)) status = 'suspended';
    else if (st.state === 'post' || st.completed === true || /STATUS_FINAL|PLAY_COMPLETE_FINAL/i.test(nm)) status = 'final';
    else if (st.state === 'in') status = 'in';
    else if (st.state !== 'pre' && anyPlay) status = 'in';
    let round = num(obj(comp.status).period) || num(obj(ev.status).period) || maxPlayed || (status === 'pre' ? 0 : 1);
    if (round > REG) round = REG; if (round < maxPlayed) round = Math.min(maxPlayed, REG);

    // Who did not play the weekend. Feed flag first; otherwise inferred from the rounds (see the header note).
    const tot36 = (p) => { const a = p.rounds.find((r) => r.n === 1), b = p.rounds.find((r) => r.n === 2); return a && b && a.complete && b.complete && a.toPar != null && b.toPar != null ? a.toPar + b.toPar : null; };
    const late = (p) => p.rounds.some((r) => r.n >= 3 && r.played);
    const starters = players.filter(late), r4 = players.some((p) => p.rounds.some((r) => r.n >= 4 && r.played));
    const worst = starters.reduce((m, p) => { const t = tot36(p); return t != null && (m == null || t > m) ? t : m; }, null);
    players.forEach((p) => {
      if (p._flag) { p.status = p._flag; p.statusSrc = 'feed'; return; }
      if (!p._any) { if (anyPlay && status !== 'pre') { p.status = 'ns'; p.statusSrc = 'inferred'; } return; }
      if (late(p) || !starters.length) return;
      // Round 3 has started somewhere. Weekend tee times go out worst score first, so anyone with a worse 36-hole score than every round-3 starter is out;
      // a better score with no round-3 holes yet is simply waiting to tee off. Once round 4 exists or the event is final, no weekend round = out.
      const t = tot36(p);
      if (status === 'final' || r4 || t == null || (worst != null && t > worst)) { p.status = 'cut'; p.statusSrc = 'inferred'; }
    });
    let cutLine = num(tour.cutScore), cutLineSrc = cutLine != null ? 'feed' : '';
    if (cutLine == null && worst != null) {
      const out = players.filter((p) => p.status === 'cut' && tot36(p) != null);
      if (out.length && out.every((p) => tot36(p) > worst)) { cutLine = worst; cutLineSrc = 'field'; }
    }

    // Position from the score, with ties. A feed position is used when ESPN sends one.
    const ranked = players.filter((p) => p.status === 'active' && p.toPar != null);
    const playoff = players.some((p) => p.playoff);
    ranked.forEach((p) => { const k = ranked.filter((x) => x.toPar < p.toPar).length + 1, tie = ranked.filter((x) => x.toPar === p.toPar).length > 1; p.pos = p._pos || (tie ? 'T' : '') + k; });
    if (playoff && status === 'final' && !ranked.some((p) => p._pos)) { // playoff decided: ESPN's order names the winner; the others who tied share second
      const top = ranked.filter((p) => p.pos === 'T1').sort((x, y) => x.order - y.order);
      if (top.length > 1 && top[0].order < top[1].order) { top[0].pos = '1'; top.slice(1).forEach((p) => { p.pos = (top.length > 2 ? 'T' : '') + '2'; }); }
    }
    const posN = (p) => { const m = /\d+/.exec(p.pos); return m ? +m[0] : 9999; };
    players.forEach((p) => {
      const cur = status === 'final' || p.status !== 'active' ? p.rounds.filter((r) => r.played).pop() : p.rounds.find((r) => r.n === round);
      if (cur && cur.played) { p.today = cur.toPar; p.thru = cur.complete ? 'F' : cur.holes > 0 ? String(cur.holes) : ''; }
      const tr = p.rounds.find((r) => r.n === (round || 1)); p.teeTime = tr && tr.tee != null ? tr.tee : null;
      const done = p.rounds.filter((r) => r.complete && r.strokes != null); p.total = done.length ? done.reduce((s, r) => s + r.strokes, 0) : null;
      p.rounds = p.rounds.filter((r) => r.played).map((r) => ({ n: r.n, strokes: r.strokes, toPar: r.toPar, holes: r.holes, complete: r.complete }));
      delete p._flag; delete p._pos; delete p._any;
    });
    const grp = { active: 0, cut: 1, wd: 2, dq: 2, ns: 3 };
    players.sort((x, y) => grp[x.status] - grp[y.status] || (x.status === 'active' ? posN(x) - posN(y) : y.rounds.length - x.rounds.length) || (x.toPar == null) - (y.toPar == null) || (x.toPar || 0) - (y.toPar || 0) || x.order - y.order || x.name.localeCompare(y.name));

    let firstTee = null;
    arr(comp.competitors).forEach((c) => arr(obj(c).linescores).forEach((r) => { if (r && num(r.period) === 1) { const t = teeOf(r); if (t != null && (firstTee == null || t < firstTee)) firstTee = t; } }));
    const course = obj(arr(ev.courses)[0]), venue = obj(comp.venue || ev.venue), addr = obj(course.address || venue.address);
    const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
    const purse = num(ev.purse) != null ? num(ev.purse) : num(String(ev.displayPurse || tour.displayPurse || '').replace(/[$,\s]/g, ''));
    return { event: { id: txt(ev.id, 24), name: txt(ev.name || ev.shortName || 'PGA Tour event', 100), course: txt(course.name || venue.fullName || venue.name || '', 80), location: [txt(addr.city, 40), txt(addr.state || addr.country, 40)].filter(Boolean).join(', '),
      dates: { start: ms(ev.date || comp.date), end: ms(ev.endDate || comp.endDate) }, purse: purse != null && purse > 0 ? purse : null, status, statusText: txt(st.shortDetail || st.detail || st.description || '', 60), round, rounds: REG,
      cutLine, cutLineSrc, playoff, firstTee }, players };
  }

  // Season calendar: names and dates only (the feed carries no winners). state: 'done' | 'now' | 'next', by date; the event on the scoreboard is matched by id.
  function schedule(json, now) {
    now = now || Date.now(); const j = obj(json), out = [], seen = {};
    const cur = obj(arr(j.events)[0]), cst = obj(obj(cur.status).type);
    arr(obj(arr(j.leagues)[0]).calendar).forEach((c) => {
      if (!c || typeof c !== 'object') return; const id = txt(c.id != null ? c.id : '', 24), name = txt(c.label || c.name || '', 100); if (!name || (id && seen[id])) return; if (id) seen[id] = 1;
      const s = Date.parse(c.startDate), e = Date.parse(c.endDate), start = Number.isFinite(s) ? s : null, end = Number.isFinite(e) ? e : null;
      let state = start == null ? 'next' : now < start ? 'next' : now > (end != null ? end : start + 4 * 864e5) + 864e5 ? 'done' : 'now';
      if (id && String(cur.id) === id) state = cst.state === 'post' || cst.completed === true ? 'done' : cst.state === 'in' ? 'now' : state;
      out.push({ id, name, start, end, state });
    });
    out.sort((x, y) => (x.start == null) - (y.start == null) || (x.start || 0) - (y.start || 0));
    return out;
  }

  const D = { fetch: (u, o) => root.fetch(u, o), now: () => Date.now() };
  let CUR = null;
  const KEY = 'pga-last';
  async function getJson(url) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ac ? setTimeout(() => ac.abort(), 12000) : null;
    try { const r = await D.fetch(url, { cache: 'no-store', signal: ac ? ac.signal : undefined }); if (!r.ok) throw new Error('ESPN answered ' + r.status); return await r.json(); }
    finally { if (t) clearTimeout(t); }
  }
  // This week's event + the season calendar. Throws when ESPN does not answer; the last good answer stays in current().
  async function load() {
    const j = await getJson(SB), p = parse(j), now = D.now();
    const d = { event: p.event, players: p.players, schedule: schedule(j, now), at: now, src: 'ESPN' };
    CUR = d; try { root.localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    return d;
  }
  // Another event's leaderboard (used for "last event" between tournaments): the same scoreboard asked for that event's start day. NOT VERIFIED against the live feed.
  async function loadEvent(id, startMs) {
    const d = new Date(startMs), ymd = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
    const p = parse(await getJson(SB + '?dates=' + ymd), { eventId: id }); if (!p.event) throw new Error('event not in the answer');
    return { event: p.event, players: p.players, at: D.now(), src: 'ESPN' };
  }
  // The last good answer: from memory, else the copy kept on this phone (with the time it was read, in .at). null when there is none.
  function current() {
    if (CUR) return CUR;
    try { const d = JSON.parse(root.localStorage.getItem(KEY)); if (d && typeof d === 'object' && Array.isArray(d.players) && typeof d.at === 'number') { d.schedule = arr(d.schedule); CUR = d; return d; } } catch (e) {}
    return null;
  }
  const API = { SB, parse, schedule, load, loadEvent, current, teeParse, fmtPar, _deps: D, _reset: () => { CUR = null; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.PGA = API;
})(typeof window !== 'undefined' ? window : globalThis);
