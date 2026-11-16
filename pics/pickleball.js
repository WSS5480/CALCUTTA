/* Oddable 🏓 Pickleball (v253). Social pools and games for a pickleball group.
   POINTS ONLY: nobody bets money here. Oddable never takes, holds or pays money.
   Local-only: events live in this device's localStorage (keys start with 'pb1-').
   No server calls of any kind. Groups pass an event around with a share code. */
(function () {
  'use strict';
  const PFX = 'pb1-ev-';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NOMONEY = 'Points only. Oddable never takes, holds or pays money, and points can\'t be bought or cashed. They are for bragging rights.';

  const FMT = {
    rr: { n: 'Round robin', ico: '🔄', ind: 1, info: 'Everyone gets a number and plays doubles in groups of four, with a new partner and new opponents every round. Each player keeps their own wins and points. If the numbers don\'t fit the courts, a player or two sits out a round (a bye) and the byes rotate.' },
    king: { n: 'King of the Court', ico: '👑', ind: 1, info: 'Courts are seeded by skill (DUPR): best players start on court 1. After each round the winners move up a court and split up, the losers move down and split up. Whoever wins on court 1 in the last round is King or Queen of the Court.' },
    chal: { n: 'Challenge court', ico: '⚔️', ind: 1, info: 'The winning pair stays on the court and the losers go to the back of the line. The next two in line challenge. A pair that wins 3 in a row (you can change this) steps off too, so everyone keeps playing.' },
    ladder: { n: 'Ladder', ico: '🪜', ind: 0, info: 'A ranked list that runs for weeks. You may challenge anyone up to 3 spots above you. If the challenger wins, the two swap places; if the challenger loses, nothing changes.' },
    se: { n: 'Single elimination', ico: '🏆', ind: 0, info: 'A bracket seeded by DUPR: the top seed plays the lowest seed. Lose once and you are out. Top seeds get byes when the field isn\'t a full bracket.' },
    de: { n: 'Double elimination', ico: '🥈', ind: 0, info: 'A seeded bracket where you are out only after two losses. A first loss drops you to the losers bracket. The losers-bracket winner meets the winners-bracket winner in the final and has to beat them twice.' }
  };
  const ADDON = {
    calc: { n: 'Calcutta', ico: '💰', info: 'Before play, the group auctions off the players (or teams). Everyone starts with 100 bragging points and bids points. All bids go into the pot, and the pot goes to the owners of the best finishers (50/30/20 by default). ' + NOMONEY },
    skins: { n: 'Skins', ico: '🎯', info: 'Every game is worth a skin. The players who win the game collect it. A tied game (only possible in timed round robin games) carries its skin over to the next game, so the next winner takes both.' },
    pick: { n: 'Pick\'em', ico: '🔮', info: 'Members pick the event winner before play starts (5 points if right) and each game before it is scored (1 point each). The picks leaderboard shows who called it best.' }
  };

  /* ---------------- storage ---------------- */
  let MSG = '';
  function load(id) { try { return JSON.parse(localStorage.getItem(PFX + id)); } catch (e) { return null; } }
  function save(ev) { ev.up = Date.now(); try { localStorage.setItem(PFX + ev.id, JSON.stringify(ev)); return true; } catch (e) { MSG = 'Could not save on this device (storage is full or blocked).'; return false; } }
  function remove(id) { try { localStorage.removeItem(PFX + id); } catch (e) {} }
  function listEvents() { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(PFX) === 0) { const e = load(k.slice(PFX.length)); if (e && e.id) out.push(e); } } } catch (e) {} return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.up || 0) - (a.up || 0)); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------------- helpers ---------------- */
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(a, r) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  const pk2 = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const isSc = (g) => g && g.sa != null && g.sb != null;
  const winSide = (g) => (!isSc(g) ? null : g.sa > g.sb ? 'a' : g.sb > g.sa ? 'b' : 't');
  const fmtD = (d) => (d == null || d === '' ? '' : (+d).toFixed(2).replace(/0$/, ''));
  function seedSort(us) { const r = us.filter((u) => u.d != null).sort((a, b) => b.d - a.d); return r.concat(us.filter((u) => u.d == null)); }
  const playN = (N, C) => Math.min(C * 4, Math.floor(N / 4) * 4);

  function unit(ev, id) { return (ev.us || []).find((u) => u.id === id); }
  function uName(ev, id) { if (id === 'BYE') return 'Bye'; if (!id) return 'TBD'; const u = unit(ev, id); return u ? u.n : '?'; }
  function sideName(ev, arr) { return (arr || []).map((x) => uName(ev, x)).join(' & ') || 'TBD'; }
  function mName(ev, id) { const m = (ev.ms || []).find((x) => x.id === id); return m ? m.n : '?'; }

  /* ---------------- create ---------------- */
  function parsePlayers(txt) {
    return String(txt || '').split(/\n|;/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = /^(.*?)[\s,]+(\d(?:\.\d{1,3})?)$/.exec(l); let n = l, d = null;
      if (m && +m[2] >= 1 && +m[2] <= 8) { n = m[1].replace(/[,\s]+$/, ''); d = +m[2]; }
      return { n: n.slice(0, 40), d };
    }).filter((p) => p.n);
  }
  function makeEvent(o) {
    const id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ps = o.players.map((p, i) => ({ id: 'p' + (i + 1), n: p.n, d: p.d }));
    const ev = { v: 1, id, name: o.name, date: o.date || '', fmt: o.fmt, courts: Math.max(1, Math.min(20, o.courts | 0 || 1)), timed: !!(o.timed && o.fmt === 'rr'), team: FMT[o.fmt].ind ? 'r' : (o.team === 's' ? 's' : 'd'), maxW: Math.max(1, Math.min(9, o.maxW | 0 || 3)), ps, us: [], alt: [], g: [], seq: 0, done: false, cr: Date.now(),
      add: { calc: !!o.calc, skins: !!o.skins, pick: !!o.pick },
      ms: [], calc: { st: Math.max(1, o.start | 0 || 100), sp: o.split && o.split.length ? o.split : [50, 30, 20], b: {} }, sk: { pts: Math.max(1, o.skinPts | 0 || 1) }, pk: { w: {}, g: {} } };
    const names = ps.map((p) => p.n).concat(o.extra || []); const seen = {};
    names.forEach((n) => { const k = n.toLowerCase(); if (!seen[k]) { seen[k] = 1; ev.ms.push({ id: 'm' + (ev.ms.length + 1), n }); } });
    if (ev.team === 'd') { // fixed doubles pairs, balanced by DUPR (best with lowest)
      const s = seedSort(ps.map((p) => ({ id: p.id, n: p.n, d: p.d }))); if (s.length % 2) ev.alt.push(s.pop().id);
      for (let i = 0; i < s.length / 2; i++) { const a = s[i], b = s[s.length - 1 - i]; const ds = [a.d, b.d].filter((x) => x != null); ev.us.push({ id: 't' + (i + 1), n: a.n + ' & ' + b.n, p: [a.id, b.id], d: ds.length ? Math.round(ds.reduce((x, y) => x + y, 0) / ds.length * 100) / 100 : null }); }
    } else ev.us = ps.map((p) => ({ id: p.id, n: p.n, p: [p.id], d: p.d }));
    const N = ev.us.length, C = ev.courts;
    if (o.fmt === 'rr') { let R = o.rounds | 0; if (!R) { const play = playN(N, C), sit = N - play; R = sit ? N / gcd(N, sit) : N - 1; while (R < 6 && sit) R *= 2; R = Math.max(3, Math.min(12, R)); } ev.rounds = Math.min(30, R); genRR(ev); }
    else if (o.fmt === 'king') { ev.rounds = Math.min(30, o.rounds | 0 || 6); kingStart(ev); }
    else if (o.fmt === 'chal') chalStart(ev);
    else if (o.fmt === 'ladder') ev.lad = { o: seedSort(ev.us).map((u) => u.id), wk: 1 };
    else bracketBuild(ev, o.fmt === 'de');
    return ev;
  }
  function checkNew(o) {
    if (!o.name) return 'Give the event a name.';
    if (!FMT[o.fmt]) return 'Pick a format.';
    const n = o.players.length;
    if (FMT[o.fmt].ind && n < 4) return 'This format needs at least 4 players.';
    if (!FMT[o.fmt].ind && o.team !== 's' && n < 4) return 'Doubles needs at least 4 players (2 teams).';
    if (!FMT[o.fmt].ind && o.team === 's' && n < 2) return 'Add at least 2 players.';
    if (o.fmt === 'de' && (o.team === 's' ? n : Math.floor(n / 2)) < 3) return 'Double elimination needs at least 3 entries.';
    if (n > 64) return 'Up to 64 players.';
    const low = o.players.map((p) => p.n.toLowerCase()); if (new Set(low).size !== low.length) return 'Two players have the same name. Add an initial so they differ.';
    if (o.calc) { const s = o.split.reduce((a, b) => a + b, 0); if (!o.split.length || o.split.some((x) => !(x > 0)) || Math.abs(s - 100) > 0.001) return 'Calcutta split must be percents that add up to 100 (like 50,30,20).'; }
    return '';
  }

  /* ---------------- round robin (rotating partners) ---------------- */
  function genRR(ev) {
    // Partners come from the circle method (every pair partners once per cycle; with an odd count a "ghost" seat
    // gives each player one bye per cycle). Who sits out is picked by fewest byes so far (keeping circle pairs
    // together when it can); anyone left without a partner is paired with the least-repeated partner.
    // Opponents are then matched to keep repeat match-ups low.
    const r = rng(hash(ev.id)), P = shuffle(ev.us.map((u) => u.id), r), N = P.length, play = playN(N, ev.courts);
    const seats = N % 2 ? P.concat([null]) : P.slice(), M = seats.length, opp = {}, part = {}, byes = {}; P.forEach((p) => { byes[p] = 0; });
    for (let rd = 1; rd <= ev.rounds; rd++) {
      const k = (rd - 1) % (M - 1), rest = seats.slice(1), rot = [seats[0]].concat(rest.slice(k), rest.slice(0, k)), pairs = [];
      for (let i = 0; i < M / 2; i++) pairs.push([rot[i], rot[M - 1 - i]]);
      const mate = {}; pairs.forEach((p) => { if (p[0] != null) mate[p[0]] = p[1]; if (p[1] != null) mate[p[1]] = p[0]; });
      const sit = [], tie = {}; P.forEach((p) => { tie[p] = r(); });
      while (sit.length < N - play) {
        const c = P.filter((p) => !sit.includes(p)); const mb = Math.min(...c.map((p) => byes[p]));
        const pref = (p) => (mate[p] == null ? 0 : sit.includes(mate[p]) ? 1 : 2);
        sit.push(c.filter((p) => byes[p] === mb).sort((a, b) => pref(a) - pref(b) || tie[a] - tie[b])[0]);
      }
      sit.forEach((p) => { byes[p]++; });
      const real = [], orph = [];
      pairs.forEach((p) => { const a = p[0] != null && !sit.includes(p[0]), b = p[1] != null && !sit.includes(p[1]); if (a && b) real.push(p.slice()); else if (a) orph.push(p[0]); else if (b) orph.push(p[1]); });
      while (orph.length) { const x = orph.shift(); let bi = 0; orph.forEach((y, i) => { if ((part[pk2(x, y)] || 0) < (part[pk2(x, orph[bi])] || 0)) bi = i; }); real.push([x, orph.splice(bi, 1)[0]]); }
      real.forEach((p) => { const q = pk2(p[0], p[1]); part[q] = (part[q] || 0) + 1; });
      let best = null, bc = Infinity;
      for (let t = 0; t < 300 && bc > 0; t++) {
        const s = shuffle(real, r); let c = 0;
        for (let i = 0; i < s.length; i += 2) s[i].forEach((x) => s[i + 1].forEach((y) => { c += opp[pk2(x, y)] || 0; }));
        if (c < bc) { bc = c; best = s; }
      }
      for (let i = 0; i < best.length; i += 2) {
        best[i].forEach((x) => best[i + 1].forEach((y) => { const q = pk2(x, y); opp[q] = (opp[q] || 0) + 1; }));
        ev.g.push({ id: 'g' + (ev.g.length + 1), r: rd, c: i / 2 + 1, a: best[i].slice(), b: best[i + 1].slice(), sa: null, sb: null });
      }
      if (sit.length) ev.g.push({ id: 'y' + rd, r: rd, bye: sit });
    }
  }

  /* ---------------- king of the court ---------------- */
  function kingStart(ev) {
    const s = seedSort(ev.us).map((u) => u.id), play = playN(s.length, ev.courts), cc = play / 4;
    ev.kg = { cc, bench: s.slice(play), byes: {} };
    const L = []; for (let c = 0; c < cc; c++) { const x = s.slice(c * 4, c * 4 + 4); L.push([[x[0], x[3]], [x[1], x[2]]]); }
    kingPush(ev, 1, L);
  }
  function kingPush(ev, rd, L) {
    L.forEach((pair, i) => ev.g.push({ id: 'g' + (ev.g.length + 1), r: rd, c: i + 1, a: pair[0], b: pair[1], sa: null, sb: null }));
    if (ev.kg.bench.length) { ev.kg.bench.forEach((p) => { ev.kg.byes[p] = (ev.kg.byes[p] || 0) + 1; }); ev.g.push({ id: 'y' + rd, r: rd, bye: ev.kg.bench.slice() }); }
  }
  const lastRound = (ev) => ev.g.reduce((m, g) => Math.max(m, g.r || 0), 0);
  const roundGames = (ev, r) => ev.g.filter((g) => g.r === r && !g.bye).sort((a, b) => a.c - b.c);
  function kingNext(ev) {
    const r = lastRound(ev), G = roundGames(ev, r), cc = ev.kg.cc; if (r >= ev.rounds || G.some((g) => !isSc(g))) return;
    const nx = []; for (let c = 0; c < cc; c++) nx.push([]);
    G.forEach((g, i) => { const w = winSide(g) === 'a' ? g.a : g.b, l = winSide(g) === 'a' ? g.b : g.a; nx[i === 0 ? 0 : i - 1].push(w); nx[i === cc - 1 ? cc - 1 : i + 1].push(l); });
    // court 1 winners and the winners coming up both land on the higher court; order inside a court: [stay/up pair, other pair]
    let bench = ev.kg.bench.slice();
    if (bench.length) { // bench players come in on the bottom court; who sits = bottom-court losers with the fewest byes
      const bottom = nx[cc - 1], lastBottom = G[cc - 1], lost = winSide(lastBottom) === 'a' ? lastBottom.b : lastBottom.a;
      const flat = [].concat(bottom[0], bottom[1]); const k = Math.min(bench.length, 4);
      const out = flat.slice().sort((a, b) => (ev.kg.byes[a] || 0) - (ev.kg.byes[b] || 0) || (lost.includes(b) ? 1 : 0) - (lost.includes(a) ? 1 : 0)).slice(0, k);
      const inn = bench.slice(0, k); bench = bench.slice(k).concat(out);
      nx[cc - 1] = bottom.map((pair) => pair.map((p) => (out.includes(p) ? inn[out.indexOf(p)] : p)));
    }
    ev.kg.bench = bench;
    kingPush(ev, r + 1, nx.map((two) => [[two[0][0], two[1][0]], [two[0][1], two[1][1]]]));
  }

  /* ---------------- challenge court ---------------- */
  function chalStart(ev) {
    const q = ev.us.map((u) => u.id), cc = Math.max(1, Math.min(ev.courts, Math.floor(q.length / 4)));
    ev.cq = { q: q.slice(cc * 4), st: {} };
    for (let c = 1; c <= cc; c++) { const x = q.slice((c - 1) * 4, c * 4); ev.cq.st[c] = 0; ev.g.push({ id: 'g' + (ev.g.length + 1), c, n: 1, a: [x[0], x[1]], b: [x[2], x[3]], sa: null, sb: null }); }
  }
  function chalAfter(ev, g) {
    if (g.nx || ev.done) return; const ws = winSide(g), W = ws === 'a' ? g.a : g.b, L = ws === 'a' ? g.b : g.a, q = ev.cq.q;
    q.push(L[0], L[1]); let st = ws === 'a' ? (ev.cq.st[g.c] || 0) + 1 : 1; let a, b;
    if (st >= ev.maxW) { q.push(W[0], W[1]); a = [q.shift(), q.shift()]; b = [q.shift(), q.shift()]; st = 0; } else { a = W.slice(); b = [q.shift(), q.shift()]; }
    ev.cq.st[g.c] = st; const n = ev.g.filter((x) => x.c === g.c).length + 1;
    const ng = { id: 'g' + (ev.g.length + 1), c: g.c, n, a, b, sa: null, sb: null, hs: st }; ev.g.push(ng); g.nx = ng.id;
  }

  /* ---------------- brackets ---------------- */
  function seedOrder(S) { let a = [1, 2]; while (a.length < S) { const n = a.length * 2; a = a.reduce((o, s) => o.concat([s, n + 1 - s]), []); } return a; }
  function bracketBuild(ev, de) {
    const seeds = seedSort(ev.us).map((u) => u.id), N = seeds.length; let S = 2; while (S < N) S *= 2; if (de && S < 4) S = 4;
    const RW = Math.log2(S), ord = seedOrder(S); ev.bk = { S, RW, LR: 0, de: !!de, seeds };
    let id = 0; const mk = (br, r, i, src) => { const g = { id: br + r + '-' + i, br, r, i, src, sa: null, sb: null }; ev.g.push(g); id++; return g.id; };
    const W = []; let prev = [];
    for (let i = 0; i < S / 2; i++) prev.push(mk('W', 1, i, [{ s: ord[2 * i] }, { s: ord[2 * i + 1] }])); W.push(prev);
    for (let r = 2; r <= RW; r++) { const cur = []; for (let i = 0; i < prev.length / 2; i++) cur.push(mk('W', r, i, [{ w: prev[2 * i] }, { w: prev[2 * i + 1] }])); W.push(cur); prev = cur; }
    if (!de) return;
    let lr = 1, L = []; for (let i = 0; i < S / 4; i++) L.push(mk('L', lr, i, [{ l: W[0][2 * i] }, { l: W[0][2 * i + 1] }]));
    for (let k = 2; k <= RW; k++) {
      lr++; const wl = W[k - 1], drop = []; for (let i = 0; i < L.length; i++) drop.push(mk('L', lr, i, [{ w: L[i] }, { l: wl[k % 2 ? i : wl.length - 1 - i] }])); L = drop;
      if (k < RW) { lr++; const con = []; for (let i = 0; i < L.length / 2; i++) con.push(mk('L', lr, i, [{ w: L[2 * i] }, { w: L[2 * i + 1] }])); L = con; }
    }
    ev.bk.LR = lr;
    mk('F', 1, 0, [{ w: W[RW - 1][0] }, { w: L[0] }]); mk('F', 2, 0, [{ w: 'F1-0' }, { l: 'F1-0' }]);
  }
  function resolve(ev) { // participants + results of every bracket game
    const G = {}; ev.g.forEach((g) => { G[g.id] = g; }); const M = {};
    const ent = (s) => { if (s.s != null) return ev.bk.seeds[s.s - 1] || 'BYE'; const r = solve(s.w || s.l); if (!r.dec) return null; return s.w ? r.win : r.lose; };
    function solve(id) {
      if (M[id]) return M[id]; const g = G[id]; let o;
      const A = ent(g.src[0]), B = ent(g.src[1]);
      if (g.br === 'F' && g.r === 2) { const f = solve('F1-0'); if (!f.dec || f.win === f.a) { o = { a: A, b: B, dec: false, skip: f.dec }; return (M[id] = o); } }
      if (A == null || B == null) o = { a: A, b: B, dec: false };
      else if (A === 'BYE' || B === 'BYE') o = { a: A, b: B, dec: true, auto: true, win: A === 'BYE' ? B : A, lose: 'BYE' };
      else if (isSc(g) && g.sa !== g.sb) o = { a: A, b: B, dec: true, win: g.sa > g.sb ? A : B, lose: g.sa > g.sb ? B : A };
      else o = { a: A, b: B, dec: false, ready: true };
      return (M[id] = o);
    }
    ev.g.forEach((g) => solve(g.id)); return M;
  }
  function dependents(ev, id) { const out = new Set([id]); let grew = true; while (grew) { grew = false; ev.g.forEach((g) => { if (g.src && !out.has(g.id) && g.src.some((s) => out.has(s.w) || out.has(s.l))) { out.add(g.id); grew = true; } }); } out.delete(id); return [...out]; }
  function champion(ev, M) { M = M || resolve(ev); if (!ev.bk.de) { const f = ev.g.find((g) => g.br === 'W' && g.r === ev.bk.RW); const r = M[f.id]; return r.dec && r.win !== 'BYE' ? r.win : null; } const f1 = M['F1-0'], f2 = M['F2-0']; if (!f1.dec) return null; if (f1.win === f1.a) return f1.win; return f2.dec ? f2.win : null; }
  function roundLabel(ev, g) {
    const bk = ev.bk; if (g.br === 'F') return g.r === 1 ? 'Grand final' : 'Final, game 2 (reset)';
    if (g.br === 'L') return g.r === bk.LR ? 'Losers final' : 'Losers round ' + g.r;
    const left = bk.RW - g.r, pre = bk.de ? 'Winners ' : '';
    if (left === 0) return bk.de ? 'Winners final' : 'Final'; if (left === 1) return pre + 'semifinals'; if (left === 2) return pre + 'quarterfinals'; return pre + 'round ' + g.r;
  }

  /* ---------------- sides / state ---------------- */
  let RES = null;
  function sides(ev, g) { if (g.src) { const r = RES[g.id]; return { a: r.a ? [r.a] : null, b: r.b ? [r.b] : null, r }; } return { a: g.a, b: g.b }; }
  function realGames(ev) { // games that are played (no byes, no auto, no skipped reset)
    return ev.g.filter((g) => { if (g.bye) return false; if (g.src) { const r = RES[g.id]; return !r.auto && !r.skip && !(g.br === 'F' && g.r === 2 && !(RES['F1-0'].dec && RES['F1-0'].win !== RES['F1-0'].a)); } return true; });
  }
  const started = (ev) => ev.g.some(isSc);
  function ladderOrder(ev) {
    const o = ev.lad.o.slice(); ev.g.filter((g) => g.lad && isSc(g)).sort((a, b) => (a.k || 0) - (b.k || 0)).forEach((g) => {
      const ch = g.a[0], df = g.b[0], i = o.indexOf(ch), j = o.indexOf(df); if (winSide(g) === 'a' && i > j) { o[i] = df; o[j] = ch; } });
    return o;
  }
  function isDone(ev) {
    if (ev.done) return true;
    if (ev.fmt === 'rr') return ev.g.filter((g) => !g.bye).every(isSc);
    if (ev.fmt === 'king') { const r = lastRound(ev); return r >= ev.rounds && roundGames(ev, r).every(isSc); }
    if (ev.fmt === 'se' || ev.fmt === 'de') return !!champion(ev, RES);
    return false;
  }
  function table(ev) { // W-L per unit over scored games
    const T = {}; ev.us.forEach((u) => { T[u.id] = { id: u.id, w: 0, l: 0, t: 0, pf: 0, pa: 0, gp: 0, bye: 0 }; });
    realGames(ev).forEach((g) => { if (!isSc(g)) return; const s = sides(ev, g); if (!s.a || !s.b) return; const ws = winSide(g);
      s.a.forEach((u) => { const x = T[u]; if (!x) return; x.gp++; x.pf += g.sa; x.pa += g.sb; if (ws === 'a') x.w++; else if (ws === 'b') x.l++; else x.t++; });
      s.b.forEach((u) => { const x = T[u]; if (!x) return; x.gp++; x.pf += g.sb; x.pa += g.sa; if (ws === 'b') x.w++; else if (ws === 'a') x.l++; else x.t++; }); });
    ev.g.forEach((g) => { if (g.bye) g.bye.forEach((u) => { if (T[u]) T[u].bye++; }); });
    return T;
  }
  const byRecord = (T, ev) => (a, b) => { const x = T[a], y = T[b]; const px = x.gp ? (x.w + x.t / 2) / x.gp : 0, py = y.gp ? (y.w + y.t / 2) / y.gp : 0;
    return (y.w + y.t / 2) - (x.w + x.t / 2) || py - px || (y.pf - y.pa) - (x.pf - x.pa) || y.pf - x.pf || uName(ev, a).localeCompare(uName(ev, b)); };
  function finish(ev) { // ordered groups of unit ids (a group = tied for that place)
    const T = table(ev), ids = ev.us.map((u) => u.id);
    if (ev.fmt === 'rr' || ev.fmt === 'chal') return ids.sort(byRecord(T, ev)).map((u) => [u]);
    if (ev.fmt === 'ladder') return ladderOrder(ev).map((u) => [u]);
    if (ev.fmt === 'king') {
      let r = lastRound(ev); while (r > 0 && roundGames(ev, r).some((g) => !isSc(g))) r--;
      if (!r) return ids.sort(byRecord(T, ev)).map((u) => [u]);
      const pos = {}; roundGames(ev, r).forEach((g, i) => { const ws = winSide(g); (ws === 'a' ? g.a : g.b).forEach((u) => { pos[u] = i * 2; }); (ws === 'a' ? g.b : g.a).forEach((u) => { pos[u] = i * 2 + 1; }); });
      const rec = byRecord(T, ev); return ids.sort((a, b) => (pos[a] == null ? 999 : pos[a]) - (pos[b] == null ? 999 : pos[b]) || rec(a, b)).map((u) => [u]);
    }
    // brackets: alive first (by record, then seed), eliminated grouped by how far they got
    const M = RES, bk = ev.bk, champ = champion(ev, M), st = {};
    ev.g.forEach((g) => { const r = M[g.id]; if (!r.dec || r.auto || !r.lose || r.lose === 'BYE') return;
      if (!bk.de) st[r.lose] = g.r;
      else if (g.br === 'L') st[r.lose] = g.r;
      else if (g.br === 'F' && (g.r === 2 || r.lose === r.b)) st[r.lose] = bk.LR + 1; });
    if (champ) st[champ] = 99;
    const alive = ids.filter((u) => st[u] == null), seedIx = (u) => bk.seeds.indexOf(u);
    alive.sort((a, b) => T[b].w - T[a].w || T[a].l - T[b].l || seedIx(a) - seedIx(b));
    const out = []; if (champ) out.push([champ]); alive.forEach((u) => out.push([u]));
    const el = ids.filter((u) => st[u] != null && u !== champ), lv = [...new Set(el.map((u) => st[u]))].sort((a, b) => b - a);
    lv.forEach((v) => out.push(el.filter((u) => st[u] === v).sort((a, b) => seedIx(a) - seedIx(b))));
    return out;
  }

  /* ---------------- Calcutta (points) ---------------- */
  function largest(total, weights) { // split an integer total by weights, exact sum
    const W = weights.reduce((a, b) => a + b, 0); if (!W) return weights.map(() => 0);
    const ex = weights.map((w) => total * w / W), fl = ex.map(Math.floor); let left = total - fl.reduce((a, b) => a + b, 0);
    ex.map((e, i) => [e - fl[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { fl[i]++; left--; } }); return fl;
  }
  function calcutta(ev) {
    const B = ev.calc.b || {}, owned = (u) => B[u] && B[u].m && (ev.ms || []).some((m) => m.id === B[u].m);
    const pot = ev.us.reduce((s, u) => s + (owned(u.id) ? (+B[u.id].pts || 0) : 0), 0);
    const groups = finish(ev).map((g) => g.filter(owned)).filter((g) => g.length), sp = ev.calc.sp;
    let p = 0; const gs = groups.map((g) => { let s = 0; for (let k = p; k < p + g.length; k++) s += sp[k] || 0; const place = p + 1; p += g.length; return { g, s, place }; });
    const used = gs.reduce((a, x) => a + x.s, 0); if (gs.length && used < 100) gs[0].s += 100 - used;
    const amt = largest(pot, gs.map((x) => x.s)); const rows = [];
    gs.forEach((x, i) => { const each = largest(amt[i], x.g.map(() => 1)); x.g.forEach((u, j) => rows.push({ u, place: x.place, tie: x.g.length > 1, pts: each[j], m: B[u].m, bid: +B[u].pts || 0 })); });
    const bal = {}; (ev.ms || []).forEach((m) => { bal[m.id] = { id: m.id, spent: 0, won: 0, own: [] }; });
    ev.us.forEach((u) => { if (owned(u.id)) { const b = bal[B[u.id].m]; b.spent += +B[u.id].pts || 0; b.own.push(u.id); } });
    rows.forEach((r) => { bal[r.m].won += r.pts; });
    Object.values(bal).forEach((b) => { b.bal = ev.calc.st - b.spent + b.won; });
    return { pot, rows, bal, sold: ev.us.filter((u) => owned(u.id)).length };
  }

  /* ---------------- skins ---------------- */
  function skins(ev) {
    const v = ev.sk.pts, tot = {}, list = []; let carry = 0; ev.us.forEach((u) => { tot[u.id] = 0; });
    realGames(ev).filter(isSc).sort((a, b) => (a.k || 0) - (b.k || 0)).forEach((g) => {
      const s = sides(ev, g); if (!s.a || !s.b) return; const val = v + carry, ws = winSide(g);
      if (ws === 't') { carry = val; list.push({ g, val, win: null }); return; }
      const W = ws === 'a' ? s.a : s.b; W.forEach((u) => { tot[u] = (tot[u] || 0) + val; }); carry = 0; list.push({ g, val, win: W }); });
    return { tot, list, carry, next: v + carry };
  }

  /* ---------------- pick'em ---------------- */
  const sig = (s) => (s.a || []).join(',') + 'v' + (s.b || []).join(',');
  function pickable(ev, g) { if (g.bye || isSc(g) || ev.done) return false; const s = sides(ev, g); if (!s.a || !s.b || s.a[0] === 'BYE' || s.b[0] === 'BYE') return false; if (g.src && (s.r.auto || s.r.skip)) return false; return true; }
  function pickem(ev) {
    const done = isDone(ev), top = finish(ev)[0] || [], rows = {};
    (ev.ms || []).forEach((m) => { rows[m.id] = { id: m.id, pts: 0, right: 0, wrong: 0, open: 0, w: ev.pk.w[m.id] || null, wOk: null }; });
    ev.g.forEach((g) => { const P = ev.pk.g[g.id]; if (!P) return; const s = g.bye ? null : sides(ev, g); Object.keys(P).forEach((mid) => { const r = rows[mid]; if (!r) return; const p = P[mid];
      if (!s || p.sig !== sig(s)) return; if (!isSc(g)) { r.open++; return; } const ws = winSide(g); if (ws === 't') return; if (ws === p.s) { r.right++; r.pts += 1; } else r.wrong++; }); });
    Object.values(rows).forEach((r) => { if (r.w && done && started(ev)) { r.wOk = top.includes(r.w); if (r.wOk) r.pts += 5; } });
    return { rows, done };
  }

  /* ---------------- share code ---------------- */
  function toCode(ev) { const j = JSON.stringify(ev); return 'PB1:' + btoa(unescape(encodeURIComponent(j))); }
  function fromCode(c) {
    c = String(c || '').replace(/\s+/g, ''); const m = /PB1:([A-Za-z0-9+/=]+)/.exec(c); if (!m) throw new Error('That is not a pickleball event code (it starts with PB1:).');
    let ev; try { ev = JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (e) { throw new Error('The code is cut off or damaged. Copy the whole code and try again.'); }
    if (!ev || ev.v !== 1 || !ev.id || !FMT[ev.fmt] || !Array.isArray(ev.us) || !Array.isArray(ev.g) || !Array.isArray(ev.ps)) throw new Error('The code did not hold a pickleball event.');
    if (!clean(ev)) throw new Error('The code did not hold a pickleball event.');
    return ev;
  }

  function clean(ev) { // imported data is untrusted: ids must be plain, numbers must be numbers, names are text
    const ID = /^[A-Za-z0-9-]{1,24}$/, num = (x, d) => (Number.isFinite(+x) ? Math.round(+x) : d), str = (x) => String(x == null ? '' : x).slice(0, 60);
    if (!ID.test(ev.id) || !/^e[a-z0-9]{3,23}$/.test(ev.id)) return false;
    ev.name = str(ev.name) || 'Event'; ev.date = /^\d{4}-\d{2}-\d{2}$/.test(ev.date) ? ev.date : ''; ev.courts = Math.max(1, Math.min(20, num(ev.courts, 1))); ev.rounds = Math.max(0, Math.min(30, num(ev.rounds, 0))); ev.maxW = Math.max(1, Math.min(9, num(ev.maxW, 3))); ev.seq = num(ev.seq, 0); ev.timed = !!ev.timed; ev.done = !!ev.done;
    if (!['r', 's', 'd'].includes(ev.team)) return false;
    for (const p of ev.ps) { if (!p || !ID.test(p.id)) return false; p.n = str(p.n); p.d = p.d == null ? null : +p.d; if (p.d != null && !Number.isFinite(p.d)) p.d = null; }
    for (const u of ev.us) { if (!u || !ID.test(u.id) || !Array.isArray(u.p) || !u.p.every((x) => ID.test(x))) return false; u.n = str(u.n); u.d = u.d == null || !Number.isFinite(+u.d) ? null : +u.d; }
    const U = new Set(ev.us.map((u) => u.id).concat(['BYE'])), ok = (a) => !a || (Array.isArray(a) && a.every((x) => U.has(x)));
    for (const g of ev.g) { if (!g || !ID.test(g.id) || !ok(g.a) || !ok(g.b) || !ok(g.bye)) return false; ['r', 'c', 'n', 'wk', 'hs', 'k', 'i'].forEach((k) => { if (g[k] != null) g[k] = num(g[k], 0); });
      if (g.bye) { delete g.sa; delete g.sb; } else { g.sa = g.sa == null ? null : num(g.sa, null); g.sb = g.sb == null ? null : num(g.sb, null); if (g.sa == null || g.sb == null) g.sa = g.sb = null; }
      if (g.src && !(Array.isArray(g.src) && g.src.every((s) => s && (s.s != null ? Number.isInteger(+s.s) : ID.test(s.w || s.l))))) return false; if (g.nx && !ID.test(g.nx)) return false; }
    ev.alt = Array.isArray(ev.alt) ? ev.alt.filter((x) => ID.test(x)) : [];
    ev.ms = (Array.isArray(ev.ms) ? ev.ms : []).filter((m) => m && ID.test(m.id)).map((m) => ({ id: m.id, n: str(m.n) }));
    ev.add = { calc: !!(ev.add && ev.add.calc), skins: !!(ev.add && ev.add.skins), pick: !!(ev.add && ev.add.pick) };
    const c = ev.calc || {}; ev.calc = { st: Math.max(1, num(c.st, 100)), sp: (Array.isArray(c.sp) ? c.sp : [50, 30, 20]).map(Number).filter((x) => x > 0), b: {} };
    if (!ev.calc.sp.length) ev.calc.sp = [50, 30, 20];
    Object.keys(c.b || {}).forEach((u) => { const b = c.b[u]; if (U.has(u) && b && ID.test(b.m)) ev.calc.b[u] = { m: b.m, pts: Math.max(0, num(b.pts, 0)) }; });
    ev.sk = { pts: Math.max(1, num(ev.sk && ev.sk.pts, 1)) };
    const pk = ev.pk || {}; ev.pk = { w: {}, g: {} }; Object.keys(pk.w || {}).forEach((m) => { if (ID.test(m) && U.has(pk.w[m])) ev.pk.w[m] = pk.w[m]; });
    Object.keys(pk.g || {}).forEach((gid) => { if (!ID.test(gid)) return; const P = pk.g[gid] || {}; ev.pk.g[gid] = {}; Object.keys(P).forEach((m) => { if (ID.test(m) && P[m] && ['a', 'b'].includes(P[m].s)) ev.pk.g[gid][m] = { s: P[m].s, sig: String(P[m].sig || '') }; }); });
    if (ev.kg) { ev.kg = { cc: Math.max(1, num(ev.kg.cc, 1)), bench: (ev.kg.bench || []).filter((x) => U.has(x)), byes: Object.assign({}, ev.kg.byes) }; }
    if (ev.cq) { ev.cq = { q: (ev.cq.q || []).filter((x) => U.has(x)), st: Object.assign({}, ev.cq.st) }; }
    if (ev.lad) { ev.lad = { o: (ev.lad.o || []).filter((x) => U.has(x)), wk: Math.max(1, num(ev.lad.wk, 1)) }; }
    if (ev.bk) { ev.bk = { S: num(ev.bk.S, 2), RW: num(ev.bk.RW, 1), LR: num(ev.bk.LR, 0), de: !!ev.bk.de, seeds: (ev.bk.seeds || []).filter((x) => U.has(x)) }; }
    if ((ev.fmt === 'se' || ev.fmt === 'de') && !ev.bk) return false; if (ev.fmt === 'king' && !ev.kg) return false; if (ev.fmt === 'chal' && !ev.cq) return false; if (ev.fmt === 'ladder' && !ev.lad) return false;
    return true;
  }

  /* ---------------- saving a score ---------------- */
  function saveScore(ev, gid, sa, sb) {
    const g = ev.g.find((x) => x.id === gid); if (!g) return 'Game not found.';
    if (!/^\d{1,2}$/.test(String(sa)) || !/^\d{1,2}$/.test(String(sb))) return 'Enter both scores as whole numbers (0-99).';
    sa = +sa; sb = +sb; const tieOk = ev.fmt === 'rr' && ev.timed;
    if (sa === sb && !tieOk) return 'A game needs a winner. (Ties are only allowed in timed round robin games.)';
    const s = sides(ev, g); if (!s.a || !s.b) return 'Both sides of this game are not known yet.';
    const oldW = isSc(g) ? winSide(g) : null, newW = sa > sb ? 'a' : sb > sa ? 'b' : 't';
    if (oldW && oldW !== newW) {
      if (ev.fmt === 'king' && g.r < lastRound(ev)) return 'The next round is already set from this result, so the winner can\'t change now. You can still fix the points.';
      if (ev.fmt === 'chal' && g.nx) return 'The next game on this court is already set from this result, so the winner can\'t change now. You can still fix the points.';
    }
    let note = '';
    if (g.src && oldW && oldW !== newW) { const d = dependents(ev, gid).map((id) => ev.g.find((x) => x.id === id)).filter(isSc); d.forEach((x) => { x.sa = x.sb = null; }); if (d.length) note = d.length + ' later game' + (d.length > 1 ? 's' : '') + ' that depended on this result ' + (d.length > 1 ? 'were' : 'was') + ' cleared.'; }
    g.sa = sa; g.sb = sb; if (!g.k) g.k = ++ev.seq;
    RES = ev.bk ? resolve(ev) : RES;
    if (ev.fmt === 'king') kingNext(ev);
    if (ev.fmt === 'chal') chalAfter(ev, g);
    RES = ev.bk ? resolve(ev) : RES;
    save(ev); return note ? { note } : '';
  }
  function clearScore(ev, gid) {
    const g = ev.g.find((x) => x.id === gid); if (!g) return 'Game not found.';
    if (ev.fmt === 'king' && g.r < lastRound(ev)) return 'The next round is already set from this result, so it can\'t be cleared.';
    if (ev.fmt === 'chal' && g.nx) return 'The next game on this court is already set from this result, so it can\'t be cleared.';
    if (g.src) dependents(ev, gid).forEach((id) => { const x = ev.g.find((y) => y.id === id); x.sa = x.sb = null; });
    g.sa = g.sb = null; delete g.k; RES = ev.bk ? resolve(ev) : RES; save(ev); return '';
  }

  /* ---------------- UI ---------------- */
  const DOPEN = new Set(); let OPEN = null, ERR = '', FORM = null, PICKAS = lsGet('pb1-me') || '';
  const route = () => (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  function go(path) { location.hash = '#/' + path; }
  const back = (href, label) => `<a class="bk" href="#/${href}">‹ ${esc(label || 'Back')}</a>`;
  const tile = (href, big, label, small) => `<a class="sum" data-dr href="#/${href}"><b>${big}</b><span>${label}</span>${small ? `<small>${small}</small>` : ''}</a>`;
  const infoBox = (txt, lbl) => `<details class="inf"><summary>ⓘ ${esc(lbl || 'How it works')}</summary><p>${esc(txt)}</p></details>`;
  const rec = (x) => x.w + '-' + x.l + (x.t ? '-' + x.t : '');
  const sgn = (n) => (n > 0 ? '+' + n : String(n));

  function render() {
    const R = route(), main = $('#main'); let h = '';
    try {
      if (!R.length) h = viewHome();
      else if (R[0] === 'new') h = viewNew();
      else if (R[0] === 'join') h = viewJoin();
      else if (R[0] === 'e') { const ev = load(R[1]); if (!ev) h = back('', 'My events') + '<div class="card">This event is not on this device.</div>'; else { RES = ev.bk ? resolve(ev) : null; h = viewEvent(ev, R.slice(2)); } }
      else h = viewHome();
    } catch (e) { h = back('', 'My events') + `<div class="card err">Something went wrong showing this page: ${esc(e.message)}</div>`; if (window.console) console.error(e); }
    main.innerHTML = (MSG ? `<div class="card err">${esc(MSG)}</div>` : '') + h; MSG = '';
    const ae = document.querySelector('[data-focus]'); if (ae) ae.focus();
    document.querySelectorAll('details[data-k]').forEach((d) => { if (DOPEN.has(d.getAttribute('data-k'))) d.open = true; });
    if (OPEN) { const g = document.querySelector('[data-g="' + OPEN + '"]'); const d = g && g.closest('details'); if (d) d.open = true; }
    fillDef();
  }

  function viewHome() {
    const L = listEvents();
    let h = `<div class="nomoney">🏓 Social games for your pickleball group. ${esc(NOMONEY)}</div>
<div class="btns"><a class="pill pri" href="#/new">＋ New event</a><a class="pill" href="#/join">Join with code</a></div>
<div class="gh">My events</div>`;
    if (!L.length) h += '<div class="card note">No events yet. Tap ＋ New event to set up a round robin, King of the Court, a bracket, a ladder or a Calcutta for your group.</div>';
    L.forEach((ev) => { RES = ev.bk ? resolve(ev) : null; const f = FMT[ev.fmt], d = isDone(ev), G = realGames(ev), sc = G.filter(isSc).length;
      const top = (finish(ev)[0] || [])[0]; const adds = Object.keys(ADDON).filter((k) => ev.add[k]).map((k) => ADDON[k].ico + ' ' + ADDON[k].n).join(' · ');
      h += `<a class="card ev" href="#/e/${esc(ev.id)}"><div class="row"><b>${esc(ev.name)}</b><span class="b ${d ? 'hit' : ''}">${d ? 'Final' : sc ? 'In progress' : 'Not started'}</span></div>
<div class="sub2">${f.ico} ${esc(f.n)} · ${ev.date ? esc(ev.date) + ' · ' : ''}${ev.us.length} ${f.ind || ev.team === 's' ? 'players' : 'teams'}</div>${adds ? `<div class="sub2">${adds}</div>` : ''}
${sc && top ? `<div class="sub2">${d ? '🏆 ' : 'Leading: '}${esc(uName(ev, top))}</div>` : ''}</a>`; });
    return h;
  }

  function viewNew() {
    const f = FORM || { name: '', date: new Date().toISOString().slice(0, 10), courts: 2, players: '', fmt: 'rr', team: 'd', timed: false, rounds: '', calc: false, skins: false, pick: false, extra: '', start: 100, split: '50,30,20', skinPts: 1, maxW: 3 };
    FORM = f; const ind = FMT[f.fmt].ind;
    let h = back('', 'My events') + `<h2>New event</h2>${ERR ? `<div class="card err" data-focus tabindex="-1">${esc(ERR)}</div>` : ''}
<form id="nf" class="card frm" onsubmit="return false">
<label>Event name<input name="name" maxlength="60" value="${esc(f.name)}" placeholder="Tuesday night mixer"></label>
<div class="two"><label>Date<input type="date" name="date" value="${esc(f.date)}"></label><label>Courts<input type="number" inputmode="numeric" name="courts" min="1" max="20" value="${esc(f.courts)}"></label></div>
<label>Players <small>one per line, DUPR rating optional: <i>Ana 4.25</i></small><textarea name="players" rows="7" placeholder="Ana 4.25&#10;Ben 3.9&#10;Cara&#10;Dev 3.5">${esc(f.players)}</textarea></label>
<div class="lbl">Format</div><div class="fmts">`;
    Object.keys(FMT).forEach((k) => { const x = FMT[k]; h += `<div class="fopt ${f.fmt === k ? 'on' : ''}"><label class="frad"><input type="radio" name="fmt" value="${k}" ${f.fmt === k ? 'checked' : ''}> ${x.ico} ${esc(x.n)}</label>${infoBox(x.info, 'How ' + x.n + ' is played')}</div>`; });
    h += `</div>`;
    if (!ind) h += `<label>Play as<select name="team"><option value="d" ${f.team !== 's' ? 'selected' : ''}>Doubles: fixed pairs, balanced by DUPR</option><option value="s" ${f.team === 's' ? 'selected' : ''}>Singles</option></select></label>`;
    if (f.fmt === 'rr' || f.fmt === 'king') h += `<label>Rounds <small>${f.fmt === 'rr' ? 'blank = enough for byes to rotate evenly' : 'blank = 6'}</small><input type="number" inputmode="numeric" name="rounds" min="1" max="30" value="${esc(f.rounds)}"></label>`;
    if (f.fmt === 'rr') h += `<label class="chk"><input type="checkbox" name="timed" ${f.timed ? 'checked' : ''}> Timed games (a game can end in a tie)</label>`;
    if (f.fmt === 'chal') h += `<label>Wins in a row before a pair steps off<input type="number" inputmode="numeric" name="maxW" min="1" max="9" value="${esc(f.maxW)}"></label>`;
    h += `<div class="lbl">Add-ons <small>(points only)</small></div>`;
    Object.keys(ADDON).forEach((k) => { const x = ADDON[k]; h += `<div class="fopt ${f[k] ? 'on' : ''}"><label class="chk"><input type="checkbox" name="${k}" ${f[k] ? 'checked' : ''}> ${x.ico} ${esc(x.n)}</label>${infoBox(x.info, 'How ' + x.n + ' works')}`;
      if (k === 'calc' && f.calc) h += `<div class="two"><label>Starting points each<input type="number" inputmode="numeric" name="start" min="1" max="10000" value="${esc(f.start)}"></label><label>Pot split %<input name="split" value="${esc(f.split)}" placeholder="50,30,20"></label></div>`;
      if (k === 'skins' && f.skins) h += `<label>Points per skin<input type="number" inputmode="numeric" name="skinPts" min="1" max="100" value="${esc(f.skinPts)}"></label>`;
      h += `</div>`; });
    if (f.calc || f.pick) h += `<label>Members <small>every player is a member; add people who aren't playing, one per line</small><textarea name="extra" rows="3" placeholder="Pat (watching)">${esc(f.extra)}</textarea></label>`;
    h += `<p class="note">${esc(NOMONEY)}</p><button class="pill pri wide" data-act="create">Create event</button></form>`;
    ERR = ''; return h;
  }
  function readForm() {
    const fm = $('#nf'); if (!fm) return FORM; const v = (n) => (fm.elements[n] ? fm.elements[n].value : undefined), c = (n) => (fm.elements[n] ? fm.elements[n].checked : undefined);
    const f = Object.assign({}, FORM); ['name', 'date', 'courts', 'players', 'rounds', 'extra', 'start', 'split', 'skinPts', 'maxW', 'team'].forEach((n) => { if (v(n) !== undefined) f[n] = v(n); });
    const r = fm.querySelector('input[name=fmt]:checked'); if (r) f.fmt = r.value; ['timed', 'calc', 'skins', 'pick'].forEach((n) => { if (c(n) !== undefined) f[n] = c(n); });
    FORM = f; return f;
  }
  function createFromForm() {
    const f = readForm(); const o = { name: String(f.name || '').trim().slice(0, 60), date: f.date, courts: +f.courts || 1, players: parsePlayers(f.players), fmt: f.fmt, team: f.team, timed: f.timed, rounds: +f.rounds || 0, calc: f.calc, skins: f.skins, pick: f.pick,
      extra: String(f.extra || '').split('\n').map((x) => x.trim().slice(0, 40)).filter(Boolean), start: +f.start || 100, split: String(f.split || '').split(/[,\s/]+/).filter(Boolean).map(Number), skinPts: +f.skinPts || 1, maxW: +f.maxW || 3 };
    const e = checkNew(o); if (e) { ERR = e; render(); return; }
    const ev = makeEvent(o); if (save(ev)) { FORM = null; go('e/' + ev.id); } else render();
  }

  function viewJoin(pending) {
    return back('', 'My events') + `<h2>Join with code</h2>${ERR ? `<div class="card err" data-focus tabindex="-1">${esc(ERR)}</div>` : ''}
<div class="card"><p class="note">Paste the event code a friend texted you (it starts with PB1:). The event is saved on this device only.</p>
<textarea id="jcode" rows="5" placeholder="PB1:..."></textarea><button class="pill pri wide" data-act="join">Import event</button></div>${(ERR = '')}`;
  }

  /* ---- event views ---- */
  function viewEvent(ev, R) {
    const base = 'e/' + ev.id, sub = R[0] || '';
    if (sub === 'games') return back(base, ev.name) + `<h2>All games</h2>` + gamesList(ev, null);
    if (sub === 'stand') return R[1] ? viewUnit(ev, R[1], base + '/stand') : viewStand(ev, base);
    if (sub === 'calc') return viewCalc(ev, base, R.slice(1));
    if (sub === 'skins') return viewSkins(ev, base, R[1]);
    if (sub === 'pick') return viewPick(ev, base, R.slice(1));
    if (sub === 'share') return viewShare(ev, base);
    if (sub === 'players') return viewPlayers(ev, base);
    return viewEventHome(ev, base);
  }
  function viewEventHome(ev, base) {
    const f = FMT[ev.fmt], done = isDone(ev), G = realGames(ev), sc = G.filter(isSc).length, fin = finish(ev), top = fin[0] || [];
    let h = back('', 'My events') + `<div class="card evh"><div class="row"><h2>${esc(ev.name)}</h2><span class="b ${done ? 'hit' : ''}">${done ? 'Final' : sc ? 'In progress' : 'Not started'}</span></div>
<div class="sub2">${f.ico} ${esc(f.n)} · ${ev.date ? esc(ev.date) + ' · ' : ''}${f.ind ? ev.courts + ' court' + (ev.courts > 1 ? 's' : '') + ' · ' : ''}${ev.us.length} ${f.ind || ev.team === 's' ? 'players' : 'teams'}${ev.alt.length ? ' · alternate: ' + ev.alt.map((p) => esc(ev.ps.find((x) => x.id === p).n)).join(', ') : ''}</div>
${infoBox(f.info, 'How ' + f.n + ' is played')}</div>`;
    const gtot = ev.fmt === 'chal' || ev.fmt === 'ladder' ? '' : ' of ' + G.length;
    h += `<div class="sums">` + tile(base + '/games', sc + gtot, 'Games scored', ev.fmt === 'rr' || ev.fmt === 'king' ? 'Round ' + curRound(ev) + ' of ' + ev.rounds : '');
    const lead = ev.fmt === 'king' && sc ? kingTop(ev) : top;
    h += tile(base + '/stand', sc && lead.length ? esc(lead.map((u) => uName(ev, u)).join(' & ')) : '—', done ? (ev.fmt === 'king' ? '👑 Won court 1' : '🏆 Winner') : ev.fmt === 'king' ? 'On top of court 1' : ev.fmt === 'ladder' ? 'Top of the ladder' : 'Leading now', 'Standings ›');
    if (ev.add.calc) { const C = calcutta(ev); h += tile(base + '/calc', C.pot + ' pts', '💰 Calcutta pot', C.sold + ' of ' + ev.us.length + ' sold'); }
    if (ev.add.skins) { const S = skins(ev), best = Object.keys(S.tot).sort((a, b) => S.tot[b] - S.tot[a])[0]; h += tile(base + '/skins', S.list.length && best && S.tot[best] ? esc(uName(ev, best)) : '—', '🎯 Skins leader', S.carry ? 'Carrying ' + S.carry + ' pts' : best && S.tot[best] ? S.tot[best] + ' pts' : 'No skins yet'); }
    if (ev.add.pick) { const P = pickem(ev), rows = Object.values(P.rows).sort((a, b) => b.pts - a.pts), t = rows[0]; h += tile(base + '/pick', t && t.pts ? esc(mName(ev, t.id)) : '—', '🔮 Pick\'em leader', t && t.pts ? t.pts + ' pts' : 'Make your picks ›'); }
    h += `</div>`;
    h += playSection(ev, base);
    h += `<div class="btns"><a class="pill" href="#/${base}/share">📤 Share event</a><a class="pill" href="#/${base}/players">Players</a>`;
    if ((ev.fmt === 'chal' || ev.fmt === 'ladder') && !ev.done) h += `<button class="pill" data-act="finish">Finish event</button>`;
    if (ev.done && (ev.fmt === 'chal' || ev.fmt === 'ladder')) h += `<button class="pill" data-act="reopen">Reopen</button>`;
    h += `<button class="pill dang" data-act="del">Delete</button></div><div id="delc"></div>`;
    return h;
  }
  function kingTop(ev) { let r = lastRound(ev); while (r > 0 && roundGames(ev, r).some((g) => !isSc(g))) r--; if (!r) return (finish(ev)[0] || []); const g = roundGames(ev, r)[0]; return winSide(g) === 'a' ? g.a : g.b; }
  function curRound(ev) { const r = ev.g.filter((g) => !g.bye && !isSc(g)).reduce((m, g) => Math.min(m, g.r), Infinity); return r === Infinity ? lastRound(ev) : r; }

  function gameCard(ev, g) {
    const s = sides(ev, g), sc = isSc(g), ws = winSide(g); let lbl;
    if (g.src) lbl = roundLabel(ev, g); else if (g.lad) lbl = 'Week ' + g.wk + ' challenge'; else if (ev.fmt === 'chal') lbl = 'Court ' + g.c + ' · game ' + g.n + (g.hs ? ' · holders ' + g.hs + ' win' + (g.hs > 1 ? 's' : '') + ' in a row' : ''); else lbl = 'Round ' + g.r + ' · Court ' + g.c;
    if (g.src && s.r.auto) return `<div class="gm auto"><div class="gl">${esc(lbl)}</div><div class="gs">${esc(uName(ev, s.r.win))} <small>advances (bye)</small></div></div>`;
    const ready = s.a && s.b && !(ev.done && !sc);
    const row = (side, arr, score) => `<div class="gs ${ws === side ? 'win' : ws && ws !== 't' ? 'lose' : ''}"><span>${esc(sideName(ev, arr))}${g.lad ? `<small> ${side === 'a' ? 'challenger' : 'defender'}</small>` : ''}</span><b>${sc ? score : ''}</b></div>`;
    let h = `<div class="gm ${sc ? 'done' : ready ? 'ready' : 'wait'} ${OPEN === g.id ? 'open' : ''}" ${ready ? `data-act="gopen" data-g="${g.id}" role="button" tabindex="0"` : ''}><div class="gl">${esc(lbl)}<span>${sc ? (ws === 't' ? 'Tie' : 'Final') : ready ? 'Tap to score' : 'Waiting'}</span></div>${row('a', s.a, g.sa)}${row('b', s.b, g.sb)}</div>`;
    if (OPEN === g.id && ready) h += `<div class="ged card"><div class="lbl">Score for ${esc(lbl)}</div>
<label>${esc(sideName(ev, s.a))}<input id="sa" type="number" inputmode="numeric" min="0" max="99" value="${sc ? g.sa : ''}"></label>
<label>${esc(sideName(ev, s.b))}<input id="sb" type="number" inputmode="numeric" min="0" max="99" value="${sc ? g.sb : ''}"></label>
${ERR ? `<div class="err">${esc(ERR)}</div>` : ''}<div class="btns"><button class="pill pri" data-act="gsave" data-g="${g.id}">Save</button>${sc ? `<button class="pill" data-act="gclear" data-g="${g.id}">Clear score</button>` : ''}<button class="pill" data-act="gclose">Cancel</button></div></div>`;
    if (OPEN === g.id) ERR = '';
    return h;
  }
  function gamesList(ev, filter) {
    let h = '', G = ev.g.filter((g) => !filter || filter(g));
    if (ev.bk) { const groups = {}; G.forEach((g) => { if (g.br === 'F' && g.r === 2 && (RES[g.id].skip || !RES['F1-0'].dec || RES['F1-0'].win === RES['F1-0'].a)) return; const k = roundLabel(ev, g); (groups[k] = groups[k] || []).push(g); });
      Object.keys(groups).forEach((k) => { const L = groups[k].filter((g) => !(RES[g.id].auto && RES[g.id].win === 'BYE')); if (!L.length) return; h += `<div class="gh">${esc(k)}</div>` + L.map((g) => gameCard(ev, g)).join(''); }); return h || '<div class="card note">No games.</div>'; }
    if (ev.fmt === 'chal' || ev.fmt === 'ladder') { const L = G.slice().reverse(); return L.length ? L.map((g) => gameCard(ev, g)).join('') : '<div class="card note">No games yet.</div>'; }
    const rounds = [...new Set(G.map((g) => g.r))].sort((a, b) => a - b);
    rounds.forEach((r) => { h += `<div class="gh">Round ${r}</div>`; G.filter((g) => g.r === r).forEach((g) => { h += g.bye ? `<div class="byes">Sitting out: ${esc(g.bye.map((u) => uName(ev, u)).join(', '))}</div>` : gameCard(ev, g); }); });
    return h || '<div class="card note">No games.</div>';
  }
  function playSection(ev, base) {
    let h = '';
    if (ev.fmt === 'rr' || ev.fmt === 'king') {
      const r = curRound(ev); h += `<div class="gh">${isDone(ev) ? 'Last round' : 'Now playing'}: round ${r} of ${ev.rounds}</div>`;
      ev.g.filter((g) => g.r === r).forEach((g) => { h += g.bye ? `<div class="byes">Sitting out: ${esc(g.bye.map((u) => uName(ev, u)).join(', '))}</div>` : gameCard(ev, g); });
      if (ev.fmt === 'king' && !isDone(ev)) h += `<p class="note">When every court is scored, the next round is set: winners move up a court and split, losers move down and split.</p>`;
    } else if (ev.fmt === 'chal') {
      const cur = {}; ev.g.forEach((g) => { cur[g.c] = g; });
      h += `<div class="gh">${ev.done ? 'Finished' : 'On court now'}</div>` + Object.values(cur).map((g) => gameCard(ev, g)).join('');
      if (!ev.done) h += `<div class="byes">In line: ${ev.cq.q.length ? esc(ev.cq.q.map((u) => uName(ev, u)).join(' → ')) : 'nobody waiting'}</div>`;
      const old = ev.g.filter((g) => isSc(g) && g.nx); if (old.length) h += `<details class="inf" data-k="early"><summary>Earlier games (${old.length}) ›</summary>${old.slice().reverse().map((g) => gameCard(ev, g)).join('')}</details>`;
    } else if (ev.fmt === 'ladder') h += ladderSection(ev);
    else {
      const ready = ev.g.filter((g) => RES[g.id].ready && !(g.br === 'F' && g.r === 2 && RES[g.id].skip));
      const ch = champion(ev, RES);
      h += ch ? `<div class="card champ">🏆 Champion: <b>${esc(uName(ev, ch))}</b></div>` : `<div class="gh">Up next</div>` + (ready.length ? ready.map((g) => gameCard(ev, g)).join('') : '<div class="card note">Waiting on earlier games.</div>');
      h += `<details class="inf" data-k="bracket"><summary>Full bracket ›</summary>${gamesList(ev, null)}</details>`;
    }
    return h;
  }
  function ladderSection(ev) {
    const o = ladderOrder(ev), open = ev.g.filter((g) => g.lad && !isSc(g)), busy = new Set([].concat(...open.map((g) => [g.a[0], g.b[0]]))), T = table(ev);
    let h = `<div class="gh">Ladder · week ${ev.lad.wk}</div>` + o.map((u, i) => `<a class="card lrow" href="#/e/${esc(ev.id)}/stand/${esc(u)}"><b class="rk">${i + 1}</b><span>${esc(uName(ev, u))}${busy.has(u) ? ' <small>⚔️ challenge open</small>' : ''}</span><small>${rec(T[u])}</small></a>`).join('');
    if (!ev.done) {
      const chOpts = o.slice(1).filter((u) => !busy.has(u)).map((u) => `<option value="${esc(u)}">${o.indexOf(u) + 1}. ${esc(uName(ev, u))}</option>`).join('');
      h += `<div class="card frm"><div class="lbl">New challenge <small>(up to 3 spots above)</small></div><label>Challenger<select id="lch">${chOpts}</select></label><label>Defender<select id="ldf"></select></label>${ERR ? `<div class="err">${esc(ERR)}</div>` : ''}<div class="btns"><button class="pill pri" data-act="lnew">Set challenge</button><button class="pill" data-act="lweek">Start week ${ev.lad.wk + 1}</button></div></div>`;
      ERR = '';
    }
    if (open.length) h += `<div class="gh">Open challenges</div>` + open.map((g) => gameCard(ev, g) + (OPEN === g.id ? '' : `<button class="lnk" data-act="lcancel" data-g="${g.id}">Cancel this challenge</button>`)).join('');
    const doneG = ev.g.filter((g) => g.lad && isSc(g)); if (doneG.length) h += `<details class="inf" data-k="played"><summary>Played challenges (${doneG.length}) ›</summary>${doneG.slice().reverse().map((g) => gameCard(ev, g)).join('')}</details>`;
    return h;
  }
  function defOpts(ev, ch) { const o = ladderOrder(ev), open = ev.g.filter((g) => g.lad && !isSc(g)), busy = new Set([].concat(...open.map((g) => [g.a[0], g.b[0]]))), i = o.indexOf(ch); return o.slice(Math.max(0, i - 3), Math.max(0, i)).filter((u) => !busy.has(u)); }

  function viewStand(ev, base) {
    const T = table(ev), fin = finish(ev), f = FMT[ev.fmt], done = isDone(ev);
    let h = back(base, ev.name) + `<h2>Standings</h2><p class="note">${done ? 'Final order.' : 'Order right now.'} ${ev.fmt === 'king' ? 'Ranked by the court you finished the last full round on (winners first), then wins.' : ev.fmt === 'ladder' ? 'Ladder order.' : ev.bk ? 'Players still alive first, then by how far they got.' : 'Ranked by wins, then win %, then point difference.'} Tap a ${f.ind || ev.team === 's' ? 'player' : 'team'} for their games.</p>`;
    let place = 1; let kingCourt = {};
    if (ev.fmt === 'king') { const r = lastRound(ev); roundGames(ev, r).forEach((g) => { g.a.concat(g.b).forEach((u) => { kingCourt[u] = g.c; }); }); }
    fin.forEach((grp) => { grp.forEach((u) => { const x = T[u], un = unit(ev, u), diff = x.pf - x.pa;
      h += `<a class="card st" href="#/${base}/stand/${esc(u)}"><div class="row"><b><span class="rk">${place}${grp.length > 1 ? '=' : ''}</span> ${esc(un.n)}</b>${un.d != null ? `<small>DUPR ${fmtD(un.d)}</small>` : ''}</div>
<div class="kv"><span>W-L<b>${rec(x)}</b></span><span>Points for<b>${x.pf}</b></span><span>Against<b>${x.pa}</b></span><span>Diff<b>${sgn(diff)}</b></span>${x.bye ? `<span>Byes<b>${x.bye}</b></span>` : ''}${ev.fmt === 'king' ? `<span>Court now<b>${kingCourt[u] || 'bench'}</b></span>` : ''}</div></a>`; }); place += grp.length; });
    return h;
  }
  function viewUnit(ev, uid, backTo) {
    const un = unit(ev, uid); if (!un) return back(backTo, 'Back') + '<div class="card">Not found.</div>';
    const T = table(ev)[uid], mine = (g) => { if (g.bye) return g.bye.includes(uid); const s = sides(ev, g); return (s.a || []).includes(uid) || (s.b || []).includes(uid); };
    return back(backTo, 'Back') + `<h2>${esc(un.n)}</h2><div class="sums"><div class="sum"><b>${rec(T)}</b><span>W-L</span></div><div class="sum"><b>${sgn(T.pf - T.pa)}</b><span>Point diff</span><small>${T.pf} for · ${T.pa} against</small></div></div>` + gamesList(ev, mine);
  }
  function viewPlayers(ev, base) {
    let h = back(base, ev.name) + `<h2>Players</h2>`;
    h += ev.ps.map((p, i) => `<div class="card lrow"><b class="rk">${i + 1}</b><span>${esc(p.n)}</span><small>${p.d != null ? 'DUPR ' + fmtD(p.d) : 'no rating'}</small></div>`).join('');
    if (!FMT[ev.fmt].ind && ev.team === 'd') h += `<div class="gh">Teams (balanced by DUPR)</div>` + ev.us.map((u) => `<div class="card lrow"><span>${esc(u.n)}</span><small>${u.d != null ? 'avg ' + fmtD(u.d) : ''}</small></div>`).join('') + (ev.alt.length ? `<p class="note">Alternate (odd number of players): ${esc(ev.alt.map((p) => ev.ps.find((x) => x.id === p).n).join(', '))}</p>` : '');
    if (ev.ms.length) h += `<div class="gh">Members (Calcutta / Pick'em)</div><div class="card">${ev.ms.map((m) => esc(m.n)).join(', ')}</div>`;
    return h;
  }

  function viewCalc(ev, base, R) {
    const C = calcutta(ev), cb = base + '/calc', locked = started(ev), done = isDone(ev);
    if (R[0] === 'm' && R[1]) { const b = C.bal[R[1]]; if (!b) return back(cb, 'Calcutta') + '<div class="card">Not found.</div>';
      return back(cb, 'Calcutta') + `<h2>${esc(mName(ev, R[1]))}</h2><div class="sums"><div class="sum"><b>${b.bal}</b><span>Points now</span><small>started with ${ev.calc.st}</small></div><div class="sum"><b>${b.won - b.spent >= 0 ? '+' : ''}${b.won - b.spent}</b><span>Net</span><small>bid ${b.spent} · ${done ? 'won' : 'projected'} ${b.won}</small></div></div>` +
        (b.own.length ? b.own.map((u) => { const r = C.rows.find((x) => x.u === u); return `<div class="card lrow"><span>${esc(uName(ev, u))}<small> bought for ${ev.calc.b[u].pts}</small></span><b>${r ? (r.tie ? 'T-' : '#') + r.place + ' · +' + r.pts : '0'}</b></div>`; }).join('') : '<div class="card note">Owns nobody.</div>'); }
    if (R[0] === 'pot') return back(cb, 'Calcutta') + `<h2>Pot: ${C.pot} pts</h2><p class="note">Every winning bid goes into the pot.</p>` + (ev.us.filter((u) => ev.calc.b[u.id] && ev.calc.b[u.id].m).sort((a, b) => ev.calc.b[b.id].pts - ev.calc.b[a.id].pts).map((u) => `<div class="card lrow"><span>${esc(u.n)}<small> owner ${esc(mName(ev, ev.calc.b[u.id].m))}</small></span><b>${ev.calc.b[u.id].pts}</b></div>`).join('') || '<div class="card note">Nothing sold yet.</div>');
    if (R[0] === 'pay') return back(cb, 'Calcutta') + `<h2>${done ? 'Payouts' : 'Projected payouts'}</h2><p class="note">Split ${ev.calc.sp.join(' / ')}% of the pot by finish${done ? '' : ', using the order right now'}. Only bought ${FMT[ev.fmt].ind || ev.team === 's' ? 'players' : 'teams'} count for places; ties share. Total paid = ${C.rows.reduce((a, r) => a + r.pts, 0)} of ${C.pot}.</p>` +
      (C.rows.filter((r) => r.pts > 0).map((r) => `<div class="card lrow"><b class="rk">${r.tie ? 'T' : ''}${r.place}</b><span>${esc(uName(ev, r.u))}<small> owner ${esc(mName(ev, r.m))}</small></span><b>+${r.pts}</b></div>`).join('') || '<div class="card note">No payouts yet.</div>');
    const mem = Object.values(C.bal).sort((a, b) => b.bal - a.bal || mName(ev, a.id).localeCompare(mName(ev, b.id)));
    let h = back(base, ev.name) + `<h2>💰 Calcutta</h2><div class="nomoney">${esc(NOMONEY)}</div>${infoBox(ADDON.calc.info)}
<div class="sums">${tile(cb + '/pot', C.pot + ' pts', 'Pot', C.sold + ' of ' + ev.us.length + ' sold')}${tile(cb + '/pay', ev.calc.sp.join('/') + '%', done ? 'Payouts' : 'Projected payouts', 'Tap for who gets what')}${mem[0] ? tile(cb + '/m/' + mem[0].id, esc(mName(ev, mem[0].id)), 'Most points', mem[0].bal + ' pts') : ''}</div>`;
    h += `<div class="gh">Auction ${locked ? '(closed: play has started)' : ''}</div>`;
    if (!locked) h += `<p class="note">Set each winning bid: who bought them and for how many points. Members start with ${ev.calc.st} points each and can't spend more than they have.</p>${ERR ? `<div class="card err">${esc(ERR)}</div>` : ''}`;
    ERR = '';
    seedSort(ev.us).forEach((u) => { const b = ev.calc.b[u.id] || {}; const r = C.rows.find((x) => x.u === u.id);
      if (locked) h += `<div class="card lrow"><span>${esc(u.n)}<small> ${b.m ? 'owner ' + esc(mName(ev, b.m)) + ' · bid ' + b.pts : 'not sold'}</small></span><b>${r ? (r.tie ? 'T-' : '#') + r.place + ' · +' + r.pts : ''}</b></div>`;
      else h += `<div class="card bid"><div class="row"><b>${esc(u.n)}</b>${u.d != null ? `<small>DUPR ${fmtD(u.d)}</small>` : ''}</div><div class="two"><label>Owner<select data-bm="${esc(u.id)}"><option value="">Not sold</option>${ev.ms.map((m) => `<option value="${esc(m.id)}" ${b.m === m.id ? 'selected' : ''}>${esc(m.n)}</option>`).join('')}</select></label><label>Bid (pts)<input type="number" inputmode="numeric" min="0" max="100000" data-bp="${esc(u.id)}" value="${b.pts != null ? b.pts : ''}"></label></div></div>`; });
    if (!locked) h += `<button class="pill pri wide" data-act="bids">Save bids</button>`;
    h += `<div class="gh">Members</div>` + mem.map((b) => `<a class="card lrow" href="#/${cb}/m/${esc(b.id)}"><span>${esc(mName(ev, b.id))}<small> bid ${b.spent} · ${done ? 'won' : 'proj.'} ${b.won}</small></span><b>${b.bal}</b></a>`).join('');
    return h;
  }
  function saveBids(ev) {
    if (started(ev)) return 'The auction closed when play started.';
    const nb = {}, spent = {}; let err = '';
    document.querySelectorAll('[data-bm]').forEach((s) => { const u = s.getAttribute('data-bm'), m = s.value, inp = document.querySelector(`[data-bp="${u}"]`), raw = inp ? inp.value.trim() : '';
      if (!m) return; if (!/^\d{1,6}$/.test(raw)) { err = err || 'Enter a whole-number bid for ' + uName(ev, u) + '.'; return; } nb[u] = { m, pts: +raw }; spent[m] = (spent[m] || 0) + +raw; });
    if (err) return err;
    const over = Object.keys(spent).find((m) => spent[m] > ev.calc.st); if (over) return mName(ev, over) + ' bid ' + spent[over] + ' points but only has ' + ev.calc.st + '.';
    ev.calc.b = nb; save(ev); return '';
  }

  function viewSkins(ev, base, uid) {
    const S = skins(ev), sb = base + '/skins';
    if (uid) { const L = S.list.filter((x) => x.win && x.win.includes(uid)); return back(sb, 'Skins') + `<h2>${esc(uName(ev, uid))}</h2><div class="sums"><div class="sum"><b>${S.tot[uid] || 0}</b><span>Skin points</span><small>${L.length} skin${L.length === 1 ? '' : 's'} won</small></div></div>` + (L.map((x) => `<div class="card lrow"><span>${esc(gLabel(ev, x.g))}<small> ${x.g.sa}-${x.g.sb}</small></span><b>+${x.val}</b></div>`).join('') || '<div class="card note">No skins yet.</div>'); }
    const ids = ev.us.map((u) => u.id).sort((a, b) => (S.tot[b] || 0) - (S.tot[a] || 0) || uName(ev, a).localeCompare(uName(ev, b)));
    let h = back(base, ev.name) + `<h2>🎯 Skins</h2>${infoBox(ADDON.skins.info)}<div class="sums"><div class="sum"><b>${ev.sk.pts}</b><span>Points per skin</span></div><div class="sum"><b>${S.next}</b><span>Next game is worth</span><small>${S.carry ? 'includes ' + S.carry + ' carried over' : 'nothing carried over'}</small></div></div>`;
    h += `<div class="gh">Skin points</div>` + ids.map((u) => `<a class="card lrow" href="#/${sb}/${esc(u)}"><span>${esc(uName(ev, u))}</span><b>${S.tot[u] || 0}</b></a>`).join('');
    h += `<div class="gh">Game by game</div>` + (S.list.map((x) => `<div class="card lrow"><span>${esc(gLabel(ev, x.g))}<small> ${x.g.sa}-${x.g.sb}</small></span><b>${x.win ? esc(sideName(ev, x.win)) + ' +' + x.val : 'Tie: ' + x.val + ' carries'}</b></div>`).join('') || '<div class="card note">No games scored yet.</div>');
    return h;
  }
  function gLabel(ev, g) { if (g.src) return roundLabel(ev, g); if (g.lad) return 'Week ' + g.wk + ' challenge'; if (ev.fmt === 'chal') return 'Court ' + g.c + ' game ' + g.n; return 'R' + g.r + ' court ' + g.c; }

  function viewPick(ev, base, R) {
    const P = pickem(ev), pb = base + '/pick';
    if (R[0] === 'm' && R[1]) { const r = P.rows[R[1]]; if (!r) return back(pb, 'Pick\'em') + '<div class="card">Not found.</div>';
      let h = back(pb, 'Pick\'em') + `<h2>${esc(mName(ev, R[1]))}</h2><div class="sums"><div class="sum"><b>${r.pts}</b><span>Pick'em points</span><small>${r.right} right · ${r.wrong} wrong · ${r.open} open</small></div><div class="sum"><b>${r.w ? esc(uName(ev, r.w)) : '—'}</b><span>Event winner pick</span><small>${r.wOk === true ? '✓ +5' : r.wOk === false ? '✗' : 'pending'}</small></div></div>`;
      ev.g.forEach((g) => { const p = (ev.pk.g[g.id] || {})[R[1]]; if (!p) return; const s = sides(ev, g), ok = p.sig === sig(s), ws = winSide(g);
        h += `<div class="card lrow"><span>${esc(gLabel(ev, g))}<small> picked ${esc(sideName(ev, ok ? s[p.s] : null))}</small></span><b>${!ok ? 'void' : !isSc(g) ? 'open' : ws === 't' ? 'tie' : ws === p.s ? '✓ +1' : '✗'}</b></div>`; });
      return h; }
    if (!ev.ms.some((m) => m.id === PICKAS)) PICKAS = ev.ms[0] ? ev.ms[0].id : '';
    const me = PICKAS, st = started(ev);
    let h = back(base, ev.name) + `<h2>🔮 Pick'em</h2>${infoBox(ADDON.pick.info)}<label class="frm">Picking as<select id="pkas">${ev.ms.map((m) => `<option value="${esc(m.id)}" ${m.id === me ? 'selected' : ''}>${esc(m.n)}</option>`).join('')}</select></label>`;
    h += `<div class="card frm"><div class="lbl">Event winner <small>5 points ${st ? '(closed: play has started)' : '(closes when the first game is scored)'}</small></div>`;
    h += st ? `<div>${ev.pk.w[me] ? esc(uName(ev, ev.pk.w[me])) : 'No pick'}</div>` : `<select id="pkw"><option value="">Pick a winner</option>${seedSort(ev.us).map((u) => `<option value="${esc(u.id)}" ${ev.pk.w[me] === u.id ? 'selected' : ''}>${esc(u.n)}</option>`).join('')}</select>`;
    h += `</div><div class="gh">Open games <small>(1 point each, closes when scored)</small></div>`;
    const open = ev.g.filter((g) => pickable(ev, g));
    h += open.map((g) => { const s = sides(ev, g), p = (ev.pk.g[g.id] || {})[me], cur = p && p.sig === sig(s) ? p.s : '';
      return `<div class="card pk"><div class="gl">${esc(gLabel(ev, g))}</div><div class="btns two"><button class="pill ${cur === 'a' ? 'on' : ''}" data-act="pk" data-g="${g.id}" data-s="a">${esc(sideName(ev, s.a))}</button><button class="pill ${cur === 'b' ? 'on' : ''}" data-act="pk" data-g="${g.id}" data-s="b">${esc(sideName(ev, s.b))}</button></div></div>`; }).join('') || '<div class="card note">No games open for picks right now.</div>';
    const rows = Object.values(P.rows).sort((a, b) => b.pts - a.pts || b.right - a.right || mName(ev, a.id).localeCompare(mName(ev, b.id)));
    h += `<div class="gh">Picks leaderboard</div>` + rows.map((r, i) => `<a class="card lrow" href="#/${pb}/m/${esc(r.id)}"><b class="rk">${i + 1}</b><span>${esc(mName(ev, r.id))}<small> ${r.right}-${r.wrong}${r.w ? ' · winner: ' + esc(uName(ev, r.w)) : ''}</small></span><b>${r.pts}</b></a>`).join('');
    return h;
  }

  function viewShare(ev, base) {
    const code = toCode(ev);
    return back(base, ev.name) + `<h2>📤 Share event</h2><div class="card"><p class="note">Copy this code and text it to your group. They open 🏓 Pickleball in Oddable, tap <b>Join with code</b> and paste it. It holds the whole event (players, scores, bids, picks) as of now; send a new code after more games are scored.</p>
<textarea id="scode" rows="6" readonly>${esc(code)}</textarea><button class="pill pri wide" data-act="copy">Copy code</button><div id="cpmsg" class="note"></div><p class="note">${code.length.toLocaleString()} characters. Nothing is uploaded: the code is the only copy that leaves this phone.</p></div>`;
  }

  /* ---- events ---- */
  function cur() { const R = route(); if (R[0] !== 'e') return null; const ev = load(R[1]); if (ev) RES = ev.bk ? resolve(ev) : null; return ev; }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return; const a = t.getAttribute('data-act'), gid = t.getAttribute('data-g');
    if (a !== 'gopen' || !e.target.closest('input,button,select')) e.preventDefault();
    if (a === 'create') return createFromForm();
    if (a === 'join') { let ev; try { ev = fromCode(($('#jcode') || {}).value); } catch (x) { ERR = x.message; return render(); }
      const had = load(ev.id); if (had && !t.hasAttribute('data-ok')) { $('#main').insertAdjacentHTML('beforeend', `<div class="card frm" id="jc"><p>You already have “${esc(had.name)}” on this phone. Replace your copy with the one in the code?</p><div class="btns"><button class="pill pri" data-act="join" data-ok="1">Replace my copy</button><button class="pill" data-act="joinnew">Keep both</button></div></div>`); return; }
      if (save(ev)) go('e/' + ev.id); else render(); return; }
    if (a === 'joinnew') { let ev; try { ev = fromCode(($('#jcode') || {}).value); } catch (x) { ERR = x.message; return render(); } ev.id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); ev.name += ' (copy)'; if (save(ev)) go('e/' + ev.id); return; }
    const ev = cur(); if (!ev) return;
    if (a === 'gopen') { OPEN = OPEN === gid ? null : gid; ERR = ''; render(); const i = $('#sa'); if (i) { i.focus(); i.scrollIntoView({ block: 'center' }); } return; }
    if (a === 'gclose') { OPEN = null; ERR = ''; return render(); }
    if (a === 'gsave') { const r = saveScore(ev, gid, ($('#sa') || {}).value, ($('#sb') || {}).value); if (typeof r === 'string' && r) { ERR = r; return render(); } OPEN = null; if (r && r.note) MSG = r.note; return render(); }
    if (a === 'gclear') { const r = clearScore(ev, gid); if (r) { ERR = r; return render(); } OPEN = null; return render(); }
    if (a === 'finish') { ev.done = true; save(ev); return render(); }
    if (a === 'reopen') { ev.done = false; save(ev); return render(); }
    if (a === 'del') { $('#delc').innerHTML = `<div class="card frm"><p>Delete “${esc(ev.name)}” from this phone? Copies you shared stay with your friends.</p><div class="btns"><button class="pill dang" data-act="delyes">Delete</button><button class="pill" data-act="delno">Keep</button></div></div>`; return; }
    if (a === 'delno') { $('#delc').innerHTML = ''; return; }
    if (a === 'delyes') { remove(ev.id); go(''); return; }
    if (a === 'bids') { const r = saveBids(ev); ERR = r; if (!r) MSG = ''; render(); if (!r) { const n = $('#main'); n.insertAdjacentHTML('afterbegin', '<div class="card ok">Bids saved.</div>'); } return; }
    if (a === 'pk') { if (!pickable(ev, ev.g.find((g) => g.id === gid)) || !PICKAS) return; const s = sides(ev, ev.g.find((g) => g.id === gid)); ev.pk.g[gid] = ev.pk.g[gid] || {}; ev.pk.g[gid][PICKAS] = { s: t.getAttribute('data-s'), sig: sig(s) }; save(ev); return render(); }
    if (a === 'lnew') { const ch = ($('#lch') || {}).value, df = ($('#ldf') || {}).value; if (!ch || !df) { ERR = 'Pick a challenger and a defender up to 3 spots above.'; return render(); } if (!defOpts(ev, ch).includes(df)) { ERR = 'That defender is not within 3 spots above, or already has a challenge open.'; return render(); }
      ev.g.push({ id: 'g' + (ev.g.length + 1), lad: 1, wk: ev.lad.wk, a: [ch], b: [df], sa: null, sb: null }); save(ev); return render(); }
    if (a === 'lcancel') { const g = ev.g.find((x) => x.id === gid); if (g && !isSc(g)) { ev.g = ev.g.filter((x) => x !== g); delete ev.pk.g[gid]; save(ev); } return render(); }
    if (a === 'lweek') { ev.lad.wk++; save(ev); return render(); }
    if (a === 'copy') { const ta = $('#scode'); const done = () => { $('#cpmsg').textContent = 'Copied. Paste it into a text to your group.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); try { document.execCommand('copy'); done(); } catch (x) { $('#cpmsg').textContent = 'Select the code and copy it.'; } });
      else { ta.select(); try { document.execCommand('copy'); done(); } catch (x) {} } return; }
  });
  document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-act="gopen"]')) { e.preventDefault(); e.target.click(); } });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.closest && t.closest('#nf') && (t.name === 'fmt' || ['calc', 'skins', 'pick'].includes(t.name))) { readForm(); render(); return; }
    if (t.id === 'pkas') { PICKAS = t.value; lsSet('pb1-me', PICKAS); render(); return; }
    if (t.id === 'pkw') { const ev = cur(); if (!ev || started(ev)) return render(); if (t.value) ev.pk.w[PICKAS] = t.value; else delete ev.pk.w[PICKAS]; save(ev); render(); return; }
    if (t.id === 'lch') fillDef();
  });
  document.addEventListener('input', (e) => { if (e.target.closest && e.target.closest('#nf')) readForm(); });
  function fillDef() { const ev = cur(), s = $('#ldf'), c = $('#lch'); if (!ev || !s || !c) return; s.innerHTML = defOpts(ev, c.value).map((u) => `<option value="${esc(u)}">${ladderOrder(ev).indexOf(u) + 1}. ${esc(uName(ev, u))}</option>`).join('') || '<option value="">Nobody free within 3 spots</option>'; }
  document.addEventListener('toggle', (e) => { const d = e.target; if (d.matches && d.matches('details[data-k]')) { if (d.open) DOPEN.add(d.getAttribute('data-k')); else DOPEN.delete(d.getAttribute('data-k')); } }, true);
  window.addEventListener('hashchange', () => { OPEN = null; ERR = ''; render(); window.scrollTo(0, 0); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();

  // test hook (read-only helpers; nothing here talks to a server)
  window.PB = { makeEvent, checkNew, parsePlayers, saveScore, clearScore, finish, table, calcutta, skins, pickem, toCode, fromCode, load, save, listEvents, resolve, champion, ladderOrder, isDone: (ev) => { RES = ev.bk ? resolve(ev) : null; return isDone(ev); }, setRes: (ev) => { RES = ev.bk ? resolve(ev) : null; }, sides: (ev, g) => sides(ev, g) };
})();
