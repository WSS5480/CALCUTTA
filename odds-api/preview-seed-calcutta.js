// TEST PREVIEW ONLY: a Main Calcutta (results entered by the commissioner, every lot sold) and a Side Calcutta (live auction in progress).
const TM = { KC: ['12', 'Kansas City Chiefs'], BUF: ['2', 'Buffalo Bills'], BAL: ['33', 'Baltimore Ravens'], HOU: ['34', 'Houston Texans'], PIT: ['23', 'Pittsburgh Steelers'], LAC: ['24', 'Los Angeles Chargers'], DEN: ['7', 'Denver Broncos'],
  PHI: ['21', 'Philadelphia Eagles'], DET: ['8', 'Detroit Lions'], SF: ['25', 'San Francisco 49ers'], DAL: ['6', 'Dallas Cowboys'], GB: ['9', 'Green Bay Packers'], LAR: ['14', 'Los Angeles Rams'], TB: ['27', 'Tampa Bay Buccaneers'] };
const team = (k) => ({ id: TM[k][0], name: TM[k][1] });
const ROWS = [{ k: 'win', n: 13, pct: 3 }, { k: 'round', r: 4, n: 2, pct: 13, label: 'Conference champion' }, { k: 'champ', n: 1, pct: 35 }];
async function seed(C) {
  const { X, setNow, REAL, HOUR, DAY, reset, ids, mods } = C, { ok, byRole } = X, D = mods.calcutta._deps, realFetch = D.fetch;
  D.fetch = async () => { throw new Error('offline while seeding'); }; // the demo is built without waiting on ESPN
  try {
    const solo = ['KC', 'BUF', 'BAL', 'HOU', 'PHI', 'DET', 'SF', 'DAL', 'GB', 'PIT', 'LAC', 'LAR'], lots = solo.map((k) => ({ teams: [team(k)] })).concat([{ name: 'The field', teams: [team('DEN'), team('TB')] }]);
    setNow(REAL - 2 * DAY);
    let c = (await ok('calcutta', 'commish', '/calcutta/create', { name: 'NFL Playoff Calcutta (Main)', ev: 'nfl_po', lots, rows: ROWS, minBid: 5, inc: 5, timer: 20, buyBack: false, main: true, take: { kind: 'pct', v: 10 }, order: 'listed', mode: 'manual' })).calc;
    ids.calcMain = c.id; ids.calcMainCode = c.code;
    const crew = ['player', 'p4', 'p5', 'p6', 'p7', 'p8']; for (const r of crew) await ok('calcutta', r, '/calcutta/join', { code: c.code });
    c = (await ok('calcutta', 'commish', '/calcutta/get', { id: c.id })).calc; const pid = {}; c.members.forEach((m) => { pid[m.name] = m.pid; }); const P = (r) => pid[byRole(r).name];
    const buys = [['commish', 240], ['player', 215], ['p4', 180], ['p5', 95], ['player', 205], ['p6', 190], ['p7', 150], ['p8', 110], ['p4', 85], ['commish', 70], ['p5', 60], ['p6', 55], ['p7', 45]];
    for (let i = 0; i < c.lots.length; i++) { setNow(REAL - 2 * DAY + (i + 1) * 4 * 60e3); await ok('calcutta', 'commish', '/calcutta/enter', { id: c.id, lot: c.lots[i].id, pid: P(buys[i][0]), amt: buys[i][1] }); }
    if (ids.group && mods.calcutta.attachToGroup) await mods.calcutta.attachToGroup(c.id, ids.group, 'main').catch(() => {});
    // Side Calcutta: live auction, two lots sold, the third on the block with a bid, so the clock and the bid buttons can be tried
    setNow(REAL - 30 * 60e3); reset();
    const slots = ['KC', 'BUF', 'PHI', 'DET', 'BAL', 'SF'].map((k) => ({ teams: [team(k)] })).concat([{ name: 'The field', teams: ['HOU', 'DAL', 'GB', 'PIT', 'LAC', 'LAR', 'DEN', 'TB'].map(team) }]);
    let s = (await ok('calcutta', 'commish', '/calcutta/create', { name: 'Super Bowl Side Calcutta', ev: 'nfl_po', lots: slots, rows: [{ k: 'round', r: 4, n: 2, pct: 20, label: 'Conference champion' }, { k: 'champ', n: 1, pct: 60 }], minBid: 10, inc: 5, timer: 30, buyBack: false, main: false, take: { kind: 'none', v: 0 }, order: 'listed', mode: 'live' })).calc;
    ids.calcSide = s.id; ids.calcSideCode = s.code;
    for (const r of ['player', 'p4', 'p5']) await ok('calcutta', r, '/calcutta/join', { code: s.code });
    await ok('calcutta', 'commish', '/calcutta/ctl', { id: s.id, op: 'start' });
    const L = s.lots.map((l) => l.id), bid = (r, lot, amt) => ok('calcutta', r, '/calcutta/bid', { id: s.id, lot, amt });
    let t = REAL - 30 * 60e3; const at = (ms) => { t += ms; setNow(t); };
    const sell = async () => { await ok('calcutta', 'commish', '/calcutta/ctl', { id: s.id, op: 'sold' }); at(60000); const st = (await ok('calcutta', 'commish', '/calcutta/get', { id: s.id })).calc; if (!st.a.cur) await ok('calcutta', 'commish', '/calcutta/ctl', { id: s.id, op: 'next' }); return (await ok('calcutta', 'commish', '/calcutta/get', { id: s.id })).calc.a.cur; };
    setNow(t); await bid('player', L[0], 60); at(8000); await bid('p4', L[0], 75); at(9000); await bid('player', L[0], 90); at(5000);
    let cur = await sell(); await bid('p5', cur, 50); at(7000); await bid('p4', cur, 65); at(6000); await sell(); // the third lot waits on the block for its first bid
    if (ids.group && mods.calcutta.attachToGroup) await mods.calcutta.attachToGroup(s.id, ids.group, 'side').catch(() => {});
    setNow(REAL); reset();
    const chk = (await ok('calcutta', 'player', '/calcutta/get', { id: s.id })).calc; ids.calcSideState = chk.a && chk.a.status + ':' + chk.a.cur + ' sold ' + Object.keys(chk.sold || {}).length;
  } finally { D.fetch = realFetch; }
}
module.exports = { seed };
