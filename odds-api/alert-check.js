// Before/after-every-tick invariant checker for the weekly Lock (test tool; never loaded by the server).
// install(A) wraps A.compute (run() calls it through module.exports, so ticks driven by A.tick() are checked too) and records, for every tick and every v2 week,
// the Lock BEFORE and AFTER. It decides by itself, from the tick's inputs and the stored lines before/after, whether the tick was CLEAN:
//   gap     the previous tick on these weeks was at most GRACE ago (8th argument of compute when given, else the checker's own clock per `weeks` object;
//           a `weeks` object it has never seen = a restart = not clean);
//   lines   no stored number of the week was created or changed this tick on a game more than GRACE past its mark (late line / closing line), and none changed
//           together with its source (source flip).
// Violations (V) - each must never happen:
//   rule      a live Lock changed game or team on a tick that was not clean, while its game was still on the schedule
//   past-mark a live Lock left (or flipped on) a game more than GRACE past its mark - on ANY tick
//   held      a held (waiting) Lock changed game or team while its game was on the schedule
//   D5        the Lock moved onto a game more than GRACE past its mark, or sits live on a game past its mark without being held, or live after kickoff
//   none      a week that had a Lock has none
//   final     a final Lock changed in any field
//   line      a Lock on a game at/past its mark is not at that game's frozen line and price (unless flagged nl = no usable line); nl used although a line was usable
//   dog       the Lock and the road dog of the same game and team differ in line or price
//   late      a Lock made final late (tick or line more than GRACE after its mark) without the late flag
//   out       the Lock's game is in lockOut; a game left lockOut
//   wait      lockWait points at a game that is not the live Lock's
//   gone-early the Lock left a game that is merely missing from the schedule: not flagged postponed/cancelled (state 'canceled' in `games`) and not yet missing on
//             3 reads in a row spanning 10 minutes (9th argument of compute = read times per week; left out = every tick is a read)
//   gone-live a live Lock left on a game that IS off the schedule (flagged, or missing 3 reads / 10 minutes): it must move on, or go final flagged off
// Notes (INFO) are defined behaviour worth seeing: the Lock moving on because its game left the schedule, a move at the mark inside the grace on a clean tick.
const MARK = 3600e3, GRACE = 5 * 6e4;
const snap = (o) => (o === undefined || o === null ? null : JSON.parse(JSON.stringify(o)));
const show = (L) => (L ? `${L.abbr} ${L.line > 0 ? '+' : ''}${L.line} @${L.o === null || L.o === undefined ? 'none' : L.o} g${String(L.id).slice(-3)} ${L.final ? 'FINAL' : 'live'}${L.part ? ' part' : ''}${L.nl ? ' nl' : ''}${L.late ? ' late' : ''}${L.pre === false ? ' after-kick' : ''} c=${L.conf}` : 'NONE');
const half = (x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 40 && Number.isInteger(x * 2);
function install(A) {
  const orig = A.compute, V = [], INFO = [], stats = { ticks: 0, clean: 0, dirty: 0, moves: 0, carried: 0, gone: 0, finals: 0, limbo: 0, offFinal: 0 }, seen = new WeakMap(), miss = {}; let off = false;
  A.compute = function (weeks, games, cur, nv, bx, now, ll, prevTick, reads) {
    if (off) return orig.apply(this, arguments);
    let s = seen.get(weeks); const fresh = !s; if (!s) { s = { last: null, w: {}, g: {} }; seen.set(weeks, s); }
    const last = prevTick !== undefined ? prevTick : s.last, gapOk = typeof last === 'number' && now - last <= GRACE;
    const before = {}; Object.keys(weeks).forEach((w) => { const r = weeks[w]; if (r && r.v === 2) before[w] = snap({ lock: r.lock || null, wait: r.lockWait || null, gl: r.gl || {}, out: r.lockOut || [] }); });
    const ret = orig.apply(this, arguments); stats.ticks++; s.last = now;
    const byId = {}, offIds = new Set(); games.forEach((g) => { if (g.state === 'canceled') offIds.add(String(g.id)); else byId[String(g.id)] = g; });
    Object.keys(weeks).forEach((w) => {
      const r = weeks[w]; if (!r || r.v !== 2) return; const st = (s.w[w] = s.w[w] || {}), bf = before[w] || { lock: null, wait: null, gl: {}, out: [] }, B = bf.lock, Lk = snap(r.lock || null), gl = r.gl || {};
      const tag = `tick#${stats.ticks} wk${w} ${new Date(now).toISOString().slice(5, 19)}`, add = (c, m) => V.push(`[${c}] ${tag}: ${m} | before ${show(B)} | after ${show(Lk)}`), info = (c, m) => INFO.push(`[${c}] ${tag}: ${m} | before ${show(B)} | after ${show(Lk)}`);
      // was this tick clean for this week? (decided here, not read from the code under test)
      let why = gapOk ? '' : fresh && prevTick === undefined ? 'restart' : 'gap';
      Object.keys(gl).forEach((id) => { const a = gl[id], b = bf.gl[id], g = byId[id]; if (!g || g.week !== +w) return; if (b && b.l === a.l) return; if (a.s === 'close' || now > g.start - MARK + GRACE) why = why || 'late line'; else if (b && b.s !== a.s) why = why || 'source flip'; });
      const clean = !why; if (B && !B.final) stats[clean ? 'clean' : 'dirty']++;
      if ((st.had || B) && !Lk) add('none', 'the week lost its Lock'); if (Lk) st.had = 1;
      if (B && B.final) { const keys = [...new Set(Object.keys(B).concat(Object.keys(Lk || {})))], diff = keys.filter((k) => JSON.stringify(B[k]) !== JSON.stringify(Lk && Lk[k])); if (diff.length) add('final', 'a final Lock changed in ' + diff.join(',')); }
      const gA = Lk ? byId[String(Lk.id)] || null : null;
      if (!(B && !B.final && Lk)) delete miss[w];
      if (B && !B.final && Lk) {
        const gB = byId[String(B.id)] || null, moved = String(B.id) !== String(Lk.id), flip = !moved && B.abbr !== Lk.abbr, ch = moved || flip, what = moved ? 'MOVED to another game' : 'FLIPPED team';
        if (ch) stats.moves++;
        // is a missing game really off the schedule? (counted here, on the checker's own counter)
        let isOff = false; if (!gB) { const id = String(B.id), rd = reads && typeof reads[w] === 'number' ? reads[w] : now; let m = miss[w] && miss[w].id === id ? miss[w] : { id, n: 0, t0: rd, r: null }; if (m.r !== rd) m = { id, n: m.n + 1, t0: m.t0, r: rd }; miss[w] = m; isOff = offIds.has(id) || (m.n >= 3 && rd - m.t0 >= 10 * 6e4); } else delete miss[w];
        if (!gB && ch && !isOff) add('gone-early', `Lock ${what} though its game is only missing from this read (not flagged postponed, ${miss[w].n} read(s) without it)`);
        if (!gB && isOff && !ch && !Lk.final) add('gone-live', 'a live Lock is left on a game that is off the schedule');
        if (!gB && isOff && !ch && Lk.final) { stats.offFinal++; if (!Lk.off) add('gone-live', 'Lock made final on a game off the schedule without the off flag'); info('off-final', 'Lock final on its game off the schedule: no game left in contention'); }
        if (!gB && !ch && !isOff) stats.limbo++;
        if (ch && !gB) { stats.gone++; info('gone', `Lock moved on: its game is off the schedule (defined exception)${clean ? '' : ', tick not clean (' + why + ')'}`); }
        if (ch && gB) {
          if (!clean) add('rule', `Lock ${what} on a tick that was not clean (${why})`);
          if (now > gB.start - MARK + GRACE) add('past-mark', `Lock ${what} although its game was ${Math.round((now - (gB.start - MARK)) / 1000)}s past its mark`);
          else if (clean && now >= gB.start - MARK) info('grace', `Lock ${what} at its mark inside the grace on a clean tick (ranking at the mark)`);
          if (bf.wait && String(bf.wait) === String(B.id)) add('held', `held Lock ${what}`);
        }
        if (!ch && gB && !clean) stats.carried++;
        if (moved && gA && now > gA.start - MARK + GRACE) add('D5', 'Lock moved onto a game more than GRACE past its mark');
      }
      if (Lk && !Lk.final && gA && now >= gA.start - MARK) { if (String(r.lockWait) !== String(Lk.id)) add('D5', 'live Lock on a game at/past its mark that is not held'); if (now >= gA.start) add('D5', 'live Lock on a game that has kicked off'); }
      if (r.lockWait && !(Lk && !Lk.final && String(Lk.id) === String(r.lockWait) && gA)) add('wait', 'lockWait ' + r.lockWait + " is not the live Lock's scheduled game");
      // the Lock against its game's stored line, and against that game's road dog
      if (Lk && gA) {
        const e = gl[Lk.id], home = Lk.abbr === gA.home.abbr, usable = !!e && half(e.l) && e.l !== 0, exp = usable ? (home ? -e.l : e.l) : null, po = usable ? (home ? e.hp : e.ap) : null, pinned = now >= gA.start - MARK || (B && !B.final && !clean && String(B.id) === String(Lk.id));
        const justFinal = Lk.final && !(B && B.final);
        if ((justFinal || (!Lk.final && pinned)) && Lk.was === undefined) {
          if (usable && Lk.nl && justFinal) { const eb = bf.gl[Lk.id]; if (eb && half(eb.l) && eb.l !== 0 && e.f) add('line', 'Lock flagged "line at mark unavailable" although its game has a usable frozen line ' + e.l); }
          if (usable && !Lk.nl) { if (Lk.line !== exp) add('line', `Lock line ${Lk.line} is not its game's stored line ${exp}`); if ((Lk.o === null ? undefined : Lk.o) !== (po === null ? undefined : po)) add('line', `Lock price ${Lk.o} is not its game's stored price ${po}`); }
        }
        if (justFinal) { stats.finals++; if ((now > gA.start - MARK + GRACE || (usable && !Lk.nl && (e.late || !(e.lt <= gA.start - MARK + GRACE)))) && !Lk.late) add('late', 'Lock made final late without the late flag'); if (now < gA.start - MARK) add('D5', 'Lock made final before its mark'); }
        const d = (r.dogs || []).find((x) => String(x.id) === String(Lk.id) && x.abbr === Lk.abbr);
        if (d && !Lk.nl && Lk.was === undefined && d.was === undefined && (Lk.final || d.final || pinned) && (d.line !== Lk.line || d.o !== Lk.o)) add('dog', `Lock ${Lk.line}/${Lk.o}${Lk.final ? ' (final)' : ' (live)'} and road dog ${d.line}/${d.o}${d.final ? ' (final)' : ' (live)'} differ`);
      }
      if (Lk && !(B && B.final) && (r.lockOut || []).map(String).includes(String(Lk.id))) add('out', "the Lock's game is in lockOut");
      if (!(B && B.final)) bf.out.forEach((id) => { if (!(r.lockOut || []).map(String).includes(String(id))) add('out', 'game ' + id + ' left lockOut'); });
    });
    return ret;
  };
  return { V, INFO, stats, show, pause: (f) => { off = true; try { return f(); } finally { off = false; } }, restore: () => { A.compute = orig; }, report: (name) => `[lock-check ${name}] ${stats.ticks} ticks (${stats.clean} clean / ${stats.dirty} not clean with a live Lock; ${stats.moves} Lock changes, ${stats.carried} carried, ${stats.gone} moved on from a game off the schedule, ${stats.limbo} carried while its game was missing from a read, ${stats.offFinal} final on a game off the schedule, ${stats.finals} finals); violations: ${V.length}; notes: ${INFO.length}` };
}
module.exports = { install, show, MARK, GRACE };
