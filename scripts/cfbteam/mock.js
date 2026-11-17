// ESPN stand-in for the CFB-TEAM tests. Shapes: NFL as main already parses; college from what is known of ESPN's college feeds (UNVERIFIED parts listed in HANDOFF).
const DAY = 864e5, NOW = Date.now();
const NFLT = [['2', 'BUF', 'Buffalo Bills', 'Bills', '00338d', 'AFC East'], ['15', 'MIA', 'Miami Dolphins', 'Dolphins', '008e97', 'AFC East'], ['17', 'NE', 'New England Patriots', 'Patriots', '002a5c', 'AFC East'], ['20', 'NYJ', 'New York Jets', 'Jets', '115740', 'AFC East'],
  ['33', 'BAL', 'Baltimore Ravens', 'Ravens', '29126f', 'AFC North'], ['4', 'CIN', 'Cincinnati Bengals', 'Bengals', 'fb4f14', 'AFC North'], ['5', 'CLE', 'Cleveland Browns', 'Browns', '472a08', 'AFC North'], ['23', 'PIT', 'Pittsburgh Steelers', 'Steelers', '000000', 'AFC North']];
// college: id, abbr, name, short, color, conference id. Two teams share the abbreviation "MSU" on purpose (keyed by id, not abbreviation).
const CFBT = [['333', 'ALA', 'Alabama Crimson Tide', 'Alabama', '9e1b32', '8'], ['61', 'UGA', 'Georgia Bulldogs', 'Georgia', 'ba0c2f', '8'], ['2633', 'TENN', 'Tennessee Volunteers', 'Tennessee', 'ff8200', '8'], ['145', 'MISS', 'Ole Miss Rebels', 'Ole Miss', '13294b', '8'], ['344', 'MSU', 'Mississippi State Bulldogs', 'Mississippi St', '5d1725', '8'], ['99', 'LSU', 'LSU Tigers', 'LSU', '461d7c', '8'],
  ['194', 'OSU', 'Ohio State Buckeyes', 'Ohio State', 'bb0000', '5'], ['130', 'MICH', 'Michigan Wolverines', 'Michigan', '00274c', '5'], ['127', 'MSU', 'Michigan State Spartans', 'Michigan St', '18453b', '5'], ['213', 'PSU', 'Penn State Nittany Lions', 'Penn State', '061440', '5'], ['2483', 'ORE', 'Oregon Ducks', 'Oregon', '154733', '5'], ['30', 'USC', 'USC Trojans', 'USC', '9d2235', '5']];
const RANK = { 194: 2, 333: 5, 61: 9, 2483: 14 };
function rr(n) { const ids = [...Array(n).keys()], out = []; for (let r = 0; r < n - 1; r++) { const w = []; for (let i = 0; i < n / 2; i++) w.push([ids[i], ids[n - 1 - i]]); out.push(w); ids.splice(1, 0, ids.pop()); } return out; }
const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 100003; return h; };
function build(cfb) {
  const T = cfb ? CFBT : NFLT, rounds = rr(T.length), weeks = {}, last = cfb ? 12 : 18, cur = cfb ? 12 : 11;
  for (let w = 1; w <= last; w++) {
    const pairs = rounds[(w - 1) % rounds.length], start0 = NOW + (w - cur) * 7 * DAY;
    weeks[w] = pairs.map(([x, y], i) => { const flip = (w + i) % 2, h = T[flip ? x : y], a = T[flip ? y : x], st = w < cur ? 'post' : w === cur && i === 0 ? 'in' : 'pre', hs = st === 'pre' ? 0 : 10 + (hash(w + h[1]) % 31), as = st === 'pre' ? 0 : 7 + (hash(w + a[1] + 'a') % 31);
      return { id: (cfb ? '4017' : '4018') + String(w).padStart(2, '0') + i, wk: w, start: start0 + i * 3600e3, st, h, a, hs, as }; });
  }
  return { T, weeks, cur, cfb };
}
const L = { nfl: build(false), cfb: build(true) };
const comp = (lg, t, home, score, g) => ({ id: t[0], homeAway: home ? 'home' : 'away', score: lg.cfb ? String(score) : String(score), team: { id: t[0], abbreviation: t[1], displayName: t[2], shortDisplayName: t[3], color: t[4], logo: 'https://a.espncdn.com/i/teamlogos/' + (lg.cfb ? 'ncaa' : 'nfl') + '/500/' + t[0] + '.png', ...(lg.cfb ? { conferenceId: t[5] } : {}) }, records: [{ summary: rec(lg, t[0], g.wk) }], ...(lg.cfb ? { curatedRank: { current: RANK[t[0]] || 99 } } : {}) });
function rec(lg, id, upto) { let w = 0, l = 0; for (let k = 1; k < upto; k++) (lg.weeks[k] || []).forEach((g) => { if (g.st !== 'post') return; if (g.h[0] === id) (g.hs > g.as ? w++ : l++); if (g.a[0] === id) (g.as > g.hs ? w++ : l++); }); return w + '-' + l; }
const ev = (lg, g) => ({ id: g.id, date: new Date(g.start).toISOString(), week: { number: g.wk }, seasonType: { type: 2 }, status: { type: { state: g.st, shortDetail: g.st === 'post' ? 'Final' : g.st === 'in' ? '3rd 4:12' : '' } },
  competitions: [{ id: g.id, neutralSite: false, status: { type: { state: g.st } }, competitors: [comp(lg, g.a, false, g.as, g), comp(lg, g.h, true, g.hs, g)], odds: g.st === 'pre' ? [{ details: g.h[1] + ' -3.5', overUnder: 47.5 }] : [], broadcasts: [] }] });
function scoreboard(lg, u) { const m = /[?&]week=(\d+)/.exec(u), w = m ? +m[1] : lg.cur; if (/[?&]dates=\d{4}(&|$)/.test(u)) return { events: [] }; return { week: { number: w }, season: { type: 2, year: 2026 }, events: (lg.weeks[w] || []).map((g) => ev(lg, g)) }; }
const allG = (lg, id) => Object.values(lg.weeks).flat().filter((g) => g.h[0] === id || g.a[0] === id);
function teamSched(lg, id) { const evs = allG(lg, id).map((g) => { const e = ev(lg, g); e.competitions[0].competitors.forEach((c) => { c.score = { value: +c.score, displayValue: c.score }; }); return e; });
  if (lg.cfb) { const t = lg.T.find((x) => x[0] === id), o = lg.T.find((x) => x[0] !== id); evs.push({ id: '40179999' + id, date: new Date(NOW + 40 * DAY).toISOString(), week: { number: 1, text: 'Bowls' }, seasonType: { type: 3 }, competitions: [{ status: { type: { state: 'pre' } }, notes: [{ headline: 'Rose Bowl' }], competitors: [{ id, homeAway: 'home', team: { id, abbreviation: t[1] } }, { id: o[0], homeAway: 'away', team: { id: o[0], abbreviation: o[1] } }] }] }); }
  return { team: { id }, events: evs, ...(lg.cfb ? {} : { byeWeek: 0 }) }; }
function teamInfo(lg, id) { const t = lg.T.find((x) => x[0] === id); if (!t) return null; const confPlace = { 194: '1st in Big Ten', 333: '1st in SEC' }[id] || '3rd in ' + (t[5] === '8' ? 'SEC' : 'Big Ten');
  return { team: { id, abbreviation: t[1], displayName: t[2], shortDisplayName: t[3], color: t[4], logos: [{ href: 'https://a.espncdn.com/i/teamlogos/ncaa/500/' + id + '.png' }], record: { items: [{ type: 'total', summary: rec(lg, id, 99) }] }, rank: RANK[id] || 99, standingSummary: confPlace, groups: { id: t[5], parent: { id: '80' } } } }; }
function roster(lg, id) { const P = (n, pos) => [...Array(n).keys()].map((i) => ({ id: id + pos + i, jersey: String((i * 7 + 3) % 99), displayName: 'Player ' + pos + ' ' + (i + 1) + ' Longname-Hyphenated', position: { abbreviation: pos } }));
  if (lg.cfb && id === '2483') return { team: { id }, athletes: [...P(6, 'QB'), ...P(5, 'LB')] }; // flat list (fallback)
  return { team: { id }, athletes: [{ position: 'offense', items: P(14, 'WR') }, { position: 'defense', items: P(12, 'CB') }, { position: 'specialTeam', items: P(3, 'K') }] }; }
function stats(lg, id) { const S = (k) => [{ name: 'passing', stats: [{ name: 'totalPointsPerGame', displayValue: (20 + hash(id + k) % 20).toFixed(1) }, { name: 'yardsPerGame', displayValue: String(300 + hash(id + k) % 150) }, { name: 'netPassingYardsPerGame', displayValue: '231.4' }, { name: 'passingTouchdowns', displayValue: '21' }, { name: 'interceptions', displayValue: '6' }] },
  { name: 'rushing', stats: [{ name: 'rushingYardsPerGame', displayValue: '160.2' }, { name: 'yardsPerRushAttempt', displayValue: '5.1' }] }, { name: 'miscellaneous', stats: [{ name: 'thirdDownConvPct', displayValue: '44.1' }, { name: 'turnOverDifferential', displayValue: '+6' }] }];
  const r = { stats: { categories: S('m') } }; if (!lg.cfb || id === '194') r.opponent = S('o'); return { results: r }; }
function cStand(lg, gid) { const ids = lg.T.filter((t) => t[5] === gid).sort((a, b) => a[2].localeCompare(b[2])); // alphabetical, like a feed that is not in table order
  const confRec = (id) => { let w = 0, l = 0; Object.values(lg.weeks).flat().forEach((g) => { if (g.st !== 'post' || g.h[5] !== g.a[5] || g.h[5] !== gid) return; if (g.h[0] === id) (g.hs > g.as ? w++ : l++); if (g.a[0] === id) (g.as > g.hs ? w++ : l++); }); return w + '-' + l; };
  const entries = ids.map((t) => ({ team: { id: t[0], abbreviation: t[1], displayName: t[2], shortDisplayName: t[3], location: t[3] }, stats: [{ name: 'overall', type: 'total', summary: rec(lg, t[0], 99), displayValue: rec(lg, t[0], 99) }, { name: 'vs. Conf.', type: 'vsconf', summary: confRec(t[0]), displayValue: confRec(t[0]) }, { name: 'pointsFor', displayValue: String(250 + hash(t[0]) % 150) }, { name: 'pointsAgainst', displayValue: String(150 + hash(t[0] + 'x') % 120) }] }));
  const name = gid === '8' ? 'Southeastern Conference' : 'Big Ten Conference';
  return gid === '8' ? { name, abbreviation: 'SEC', standings: { entries } } : { name: 'NCAA Division I', children: [{ name, abbreviation: 'B1G', standings: { entries } }] }; }
function nStand(lg) { const divs = {}; lg.T.forEach((t) => { (divs[t[5]] = divs[t[5]] || []).push(t); });
  return { children: [{ name: 'American Football Conference', abbreviation: 'AFC', children: Object.keys(divs).map((d) => ({ name: d, standings: { entries: divs[d].map((t) => { const [w, l] = rec(lg, t[0], 99).split('-').map(Number); return { team: { id: t[0], abbreviation: t[1], displayName: t[2], shortDisplayName: t[3] }, stats: [{ name: 'wins', displayValue: String(w) }, { name: 'losses', displayValue: String(l) }, { name: 'ties', displayValue: '0' }, { name: 'winPercent', displayValue: (w / (w + l)).toFixed(3).replace(/^0/, '') }, { name: 'divisionRecord', displayValue: '2-1' }, { name: 'pointsFor', displayValue: '250' }, { name: 'pointsAgainst', displayValue: '200' }] }; }) } })) }] }; }
// kind of an ESPN URL (for loading / failed control) and its answer
function answer(u) {
  const cfb = /college-football/.test(u), lg = cfb ? L.cfb : L.nfl; let m;
  if (/\/standings/.test(u)) { if (cfb) { m = /[?&]group=(\d+)/.exec(u); return ['stand', cStand(lg, m ? m[1] : '8')]; } return ['stand', nStand(lg)]; }
  if ((m = /\/teams\/(\d+)\/schedule/.exec(u))) { const b = teamSched(lg, m[1]), st = /[?&]seasontype=(\d)/.exec(u); if (st && b) b.events = b.events.filter((e) => String(e.seasonType.type) === st[1]); return ['sched', b]; } // ?seasontype=2 regular season, 3 postseason
  if ((m = /\/teams\/(\d+)\/roster/.exec(u))) return ['roster', roster(lg, m[1])];
  if ((m = /\/teams\/(\d+)\/statistics/.exec(u))) return ['stats', stats(lg, m[1])];
  if ((m = /\/teams\/(\d+)(\?|$)/.exec(u))) return ['team', teamInfo(lg, m[1])];
  if (/\/news/.test(u)) return ['news', { articles: [{ headline: 'Team news', links: { web: { href: 'https://www.espn.com/nfl/story/_/id/1' } }, published: new Date(NOW).toISOString() }] }];
  if (/\/scoreboard/.test(u)) return ['sb', scoreboard(lg, u)];
  return ['other', {}];
}
module.exports = { answer, L };
