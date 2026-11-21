// Bet status "right now" for the phone alerts (v266). PURE: no network, no clock, no storage. betwatch.js uses it; betstatus.test.js checks it.
// A port of the phone's own grading (pics/index.html legGrade / betGradeOne / betGradeLive, wording from scPill / scLab, change rules from spScan),
// with ONE difference on purpose: the phone treats any side that is not the home team as the away team. The server only grades what it can be sure of:
// the side must BE one of the two teams, the bet type must be one it knows (sp / ml / ou / tot) and the line must be a number. Anything else is
// 'unknown' and the alert then carries the score and the bet's name only, never a guess. "Right now" is never called a result.
const FIX = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' }; // the phone shows these NFL abbreviations its own way (index.html FIX)
const num = (x) => (x === null || x === undefined || x === '' || typeof x === 'boolean' ? NaN : Number(x));
const scN = (n) => String(+Math.abs(n).toFixed(1));
const sgn = (n) => (n > 0 ? '+' : '') + n;
const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();

// One ESPN scoreboard event -> the small game the watcher keeps. null when the event cannot be read.
function parseEvent(e, lg) {
  try {
    const c = (e.competitions || [])[0], t = (e.status && e.status.type) || {}; if (!e || e.id == null || !c) return null;
    const cs = c.competitors || [], H = cs.find((x) => x.homeAway === 'home'), A = cs.find((x) => x.homeAway === 'away'); if (!H || !A) return null;
    const side = (x) => { const raw = clean(x.team && x.team.abbreviation).slice(0, 8), sc = parseInt(x.score, 10); return { raw, abbr: lg === 'nfl' ? FIX[raw] || raw : raw, score: Number.isFinite(sc) ? sc : 0 }; };
    const state = t.state === 'pre' || t.state === 'in' || t.state === 'post' ? t.state : ''; if (!state) return null;
    const start = Date.parse(e.date || c.date || '');
    // v298 (ESPN-style alerts): football down & distance and the game's leader, from the same scoreboard read (nothing extra is fetched)
    const si = c.situation || {}, poss = si.possession ? [A, H].find((x) => x.team && String(x.team.id) === String(si.possession)) : null;
    const sit = state === 'in' ? clean(si.downDistanceText || si.shortDownDistanceText || '').slice(0, 40) + (poss && (si.downDistanceText || si.shortDownDistanceText) ? ' · ' + side(poss).abbr + ' ball' : '') : '';
    const LD = Array.isArray(c.leaders) ? c.leaders : [], pick = ['rushingLeader', 'passingLeader', 'points', 'pointsLeader', 'goals', 'receivingLeader'].map((n) => LD.find((x) => x && x.name === n)).find((x) => x && x.leaders && x.leaders[0]) || LD.find((x) => x && x.leaders && x.leaders[0]);
    const lp = pick && pick.leaders[0], lead = lp && lp.athlete ? clean(String(pick.shortDisplayName || pick.displayName || '').replace(/ ?Leader$/i, '') + ': ' + clean(lp.athlete.shortName || lp.athlete.displayName) + ' ' + clean(lp.displayValue)).slice(0, 60) : '';
    return { id: String(e.id), lg: lg || '', start: Number.isFinite(start) ? start : 0, state, detail: clean(t.shortDetail || t.detail || '').slice(0, 40), per: Number((e.status && e.status.period) || 0) || 0, away: side(A), home: side(H), sit, lead };
  } catch (x) { return null; }
}
const isTeam = (t, s) => !!s && (s === t.abbr || s === t.raw || FIX[s] === t.abbr);

// One single bet or one parlay leg against its game. -> { st: 'pending' | 'live' | 'won' | 'lost' | 'push' | 'unknown', cur?, m? }
function gradeLeg(l, g) {
  if (!l || typeof l !== 'object') return { st: 'unknown' };
  if (l.k && l.res) return { st: l.res === 'void' ? 'push' : ['won', 'lost', 'push'].includes(l.res) ? l.res : 'unknown' }; // a leg Kalshi already settled keeps Kalshi's result
  if (!l.gid) return { st: l.res === 'void' ? 'push' : ['won', 'lost', 'push'].includes(l.res) ? l.res : l.res ? 'unknown' : 'pending' };
  if (!g) return { st: 'unknown' }; // the game is not on a scoreboard the server has read
  if (g.state === 'pre') return { st: 'pending' };
  const type = l.type, side = String(l.side || '').trim(), line = num(l.line), hs = Number(g.home.score), as = Number(g.away.score);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return { st: 'unknown' };
  let m;
  if (type === 'ou' || type === 'tot') { if (!/^[OU]/i.test(side) || !Number.isFinite(line)) return { st: 'unknown' }; const tot = hs + as; m = /^O/i.test(side) ? tot - line : line - tot; }
  else if (type === 'sp' || type === 'ml') {
    const up = side.toUpperCase(), home = isTeam(g.home, up), away = isTeam(g.away, up); if (home === away) return { st: 'unknown' }; // neither team, or both
    const margin = (home ? 1 : -1) * (hs - as);
    if (type === 'sp') { if (!Number.isFinite(line)) return { st: 'unknown' }; m = margin + line; } else m = margin;
  } else return { st: 'unknown' };
  if (!Number.isFinite(m)) return { st: 'unknown' };
  const r = m > 0 ? 'won' : m < 0 ? 'lost' : 'push';
  return g.state === 'in' ? { st: 'live', cur: r, m } : { st: r, m };
}
// A whole bet (the phone's betGradeLive). gameOf(id) -> game or undefined.
function gradeBet(b, gameOf) {
  if (!b || typeof b !== 'object') return { st: 'unknown' };
  if (b.cash !== undefined && b.cash !== null && b.stake) return { st: 'sold' }; // sold on Kalshi: not an open bet any more
  if (b.kind === 'prop') return { st: 'unknown' }; // player props are followed on the phone (box score); the server does not read box scores
  if (b.kind === 'parlay') {
    const L = (Array.isArray(b.legs) ? b.legs : []).map((l) => gradeLeg(l, l && l.gid ? gameOf(String(l.gid)) : null)); if (!L.length) return { st: 'unknown', legs: L };
    if (L.some((x) => x.st === 'lost')) return { st: 'lost', legs: L }; // one lost leg decides it, whatever the others are
    if (L.some((x) => x.st === 'unknown')) return { st: 'unknown', legs: L };
    if (L.some((x) => x.st === 'live' && x.cur === 'lost')) return { st: 'live', cur: 'lost', legs: L };
    if (L.every((x) => x.st === 'won' || x.st === 'push')) return { st: L.every((x) => x.st === 'push') ? 'push' : 'won', legs: L };
    if (L.some((x) => x.st === 'live')) return { st: 'live', cur: 'won', legs: L };
    return { st: 'pending', legs: L };
  }
  if (b.kind) return { st: 'unknown' };
  return gradeLeg(b, b.gid ? gameOf(String(b.gid)) : null);
}
// The bet's short name: "LAC +4.5", "BUF ML", "Over 44.5". '' when there is nothing safe to print.
function label(l) {
  if (!l || typeof l !== 'object') return '';
  if (l.type === 'ou' || l.type === 'tot') { const n = num(l.line); return /^[OU]/i.test(String(l.side || '')) && Number.isFinite(n) ? (/^O/i.test(l.side) ? 'Over ' : 'Under ') + n : ''; }
  const s = clean(l.side).slice(0, 8); if (!s) return '';
  if (l.type === 'sp') { const n = num(l.line); return Number.isFinite(n) ? s + ' ' + sgn(n) : s; }
  return l.type === 'ml' ? s + ' ML' : s;
}
// The status in words (the phone's scPill, without the arrows). '' = nothing certain to say.
function words(l, x, leg) {
  const isOU = l.type === 'ou' || l.type === 'tot', over = /^O/i.test(String(l.side || ''));
  if (x.st === 'won' || x.st === 'lost' || x.st === 'push') return leg ? 'leg ' + x.st : x.st;
  if (x.st !== 'live') return '';
  const m = Number.isFinite(x.m) ? scN(x.m) : '', by = m ? ' by ' + m : '';
  if (x.cur === 'push') return (isOU ? 'right on the total' : l.type === 'sp' ? 'push' : 'tied') + ' right now';
  if (x.cur === 'won') return (isOU ? (over ? 'over the total' : 'under the total') + by : l.type === 'sp' ? 'covering' + by : 'winning' + by) + ' right now';
  return (isOU ? (over ? (Number.isFinite(x.m) ? 'needs ' + (Math.floor(Math.abs(x.m)) + 1) + ' more' : 'under the total') : 'over the total' + by) : l.type === 'sp' ? 'not covering' + (m ? ', ' + m + ' short' : '') : 'losing' + by) + ' right now';
}
// Every line of one player's bets that touch this game: singles, then parlay legs, then props (the phone's scBets order).
function betLines(bets, gid, gameOf) {
  gid = String(gid); const one = [], par = [], pr = [];
  (Array.isArray(bets) ? bets : []).forEach((b) => { try {
    if (!b || typeof b !== 'object') return;
    if (b.kind === 'parlay') {
      const legs = Array.isArray(b.legs) ? b.legs : [], R = gradeBet(b, gameOf), L = R.legs || [];
      legs.forEach((l, i) => { if (!l || String(l.gid) !== gid) return; const lab = label(l) || 'Parlay leg', n = legs.length, w = L[i] ? words(l, L[i], true) : '';
        const known = L.every((y) => y.st !== 'unknown'), hit = L.filter((y) => y.st === 'won' || (y.st === 'live' && y.cur === 'won')).length;
        const tail = R.st === 'lost' ? 'parlay lost' : R.st === 'won' ? 'parlay won' : R.st === 'push' ? 'parlay push' : known ? hit + ' of ' + n + ' legs hitting' : '';
        par.push(lab + ' (' + n + '-leg parlay)' + (w || tail ? ': ' + [w, tail].filter(Boolean).join(' · ') : '')); });
      return;
    }
    if (b.kind === 'prop') { if (!b.pp || String(b.pp.gid) !== gid) return; const nm = clean(b.pp.name).slice(0, 30); pr.push('Player prop' + (nm ? ': ' + nm : '')); return; }
    if (b.kind || String(b.gid) !== gid) return;
    const x = gradeBet(b, gameOf); if (x.st === 'sold') return; const lab = label(b) || 'Bet on this game', w = words(b, x, false);
    one.push(w ? lab + (x.st === 'live' ? ': ' : ' ') + w : lab);
  } catch (e) {} });
  return [...one, ...par, ...pr];
}
const clock = (d) => String(d || '').replace(/^(\d{1,2}:\d\d) - (.+)$/, '$2 $1'); // ESPN's "1:56 - 2nd" reads "2nd 1:56"
const scoreLine = (g, star) => g.away.abbr + (star && star.has(g.away.abbr) ? '⭐' : '') + ' ' + g.away.score + ' – ' + g.home.score + ' ' + g.home.abbr + (star && star.has(g.home.abbr) ? '⭐' : ''); // v298: ESPN's look, "ARK 3 – 17 TEX⭐"
const SEP = '; ';
// The notification for one player on one game. kind: 'score' | 'fix' | 'period' | 'final'. Body: at most 3 bets on one line, then "+N more".
// v298: star = the teams this player follows (a Set of abbreviations, may be empty); the body starts with down & distance and the game's leader
// (when the scoreboard has them), then the bets. A followed team with no bet: the score, situation and leader only (lines 0, fav true).
function compose(kind, g, bets, gameOf, star) {
  const L = betLines(bets, g.id, gameOf), d = clock(g.detail);
  const title = kind === 'final' ? 'Final: ' + scoreLine(g, star) : (kind === 'fix' ? 'Score corrected: ' : '') + scoreLine(g, star) + (d && !/^final/i.test(d) ? ' · ' + d : '');
  // My Apps' limits (API contract 4a): title 80, body 240, plain text, line breaks become spaces. So the bets are joined with "; " and only whole bets are kept.
  const head = [kind === 'final' ? '' : g.sit, g.lead].filter(Boolean).join(' · '); let body = L.length ? '' : head, used = 0;
  if (L.length && head && head.length < 120) body = head;
  const fill = () => { for (let i = 0; i < L.length && i < 3; i++) { const cand = (body ? body + SEP : '') + L[i]; if ((cand + (i + 1 < L.length ? SEP + '+' + (L.length - i - 1) + ' more' : '')).length > 240) break; body = cand; used = i + 1; } };
  fill(); if (L.length && !used && body) { body = ''; fill(); } // the bets come before the situation line when both do not fit
  if (used < L.length) body = body ? body + SEP + '+' + (L.length - used) + ' more' : String(L[0]).slice(0, 240);
  if (!body) body = kind === 'final' ? 'Final score.' : 'Score update.';
  return { title: title.slice(0, 80), body: body.slice(0, 240), lines: L.length, fav: !!(star && (star.has(g.away.abbr) || star.has(g.home.abbr))) };
}
// What changed between two looks at one game (the phone's spScan rules). o = the last look, c = this one; both { a, h, st, d, per }.
// -> { all, bb }: `all` = the alert for a player who gets every score; `bb` = the alert for a basketball bet followed by quarters ('period' at
// "End of ..." / "Halftime" or when the period number went up over a missed break; never on a basket). '' = no alert. First look (no o) = silent.
function change(o, c) {
  const no = { all: '', bb: '' }; if (!o || !c || o.st === 'post') return no;
  if (c.st === 'post') return o.st === 'in' ? { all: 'final', bb: 'final' } : no;
  if (c.st !== 'in' || o.st !== 'in') return no; // pre -> in is the kickoff, not a score
  const up = c.a > o.a || c.h > o.h, down = c.a < o.a || c.h < o.h, brk = /^(end|half)/i;
  return { all: down ? 'fix' : up ? 'score' : '', bb: (brk.test(c.d) && c.d !== o.d) || (c.per > o.per && o.per > 0 && !brk.test(o.d)) ? 'period' : '' };
}
const look = (g) => ({ a: Number(g.away.score) || 0, h: Number(g.home.score) || 0, st: g.state, d: g.detail || '', per: g.per || 0 });
// Open = still to be decided: no remembered result, not sold. (The same test the owner dashboard uses for "open", sync.js adminUsers.)
const isOpen = (b) => !!b && typeof b === 'object' && !b.fin && !b.res && !(b.cash !== undefined && b.cash !== null && b.stake);
// Every game id a bet touches.
function gids(b) { const o = []; if (!b || typeof b !== 'object') return o; if (b.kind === 'parlay') (Array.isArray(b.legs) ? b.legs : []).forEach((l) => { if (l && l.gid) o.push(String(l.gid)); }); else if (b.kind === 'prop') { if (b.pp && b.pp.gid) o.push(String(b.pp.gid)); } else if (b.gid) o.push(String(b.gid)); return o; }
module.exports = { FIX, parseEvent, gradeLeg, gradeBet, label, words, betLines, compose, change, look, isOpen, gids, clock, scoreLine };
