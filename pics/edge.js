// v301 ⚡ Sir Oddable's Edge (NFL only; read "## v301" in HANDOFF.md). Three betting angles that passed a 20-season backtest in BOTH halves.
// Honest labels are a hard rule: these are "edges" with their record, source and period on every card. Never "lock" (that word means only the weekly
// Lock), never "can't lose", "guaranteed" or "sure". Nothing here places a bet, links to a sportsbook or handles money.
// The top part (rules + grading) is pure and is also loaded by node for the unit tests (odds-api/edge.test.js). The browser part draws the tile on the
// NFL Games view (newBoard in index.html, next to the 📣 Alert), the full view (#edgepage, with Back) and the "How this is counted" detail (with Back).
(function (root) {
  'use strict';
  const SRC = 'NFL regular season 2006 to Nov 19 2026, closing lines, nflverse data';
  // ---- the three rules. `line` is the app's spread: points the AWAY team gets (positive = home favoured), as g.line everywhere in index.html ----
  const num = (x) => typeof x === 'number' && Number.isFinite(x);
  // A: an underdog getting +1.5 to +2.5 (either side), moved up 6 points (to +7.5 .. +8.5)
  function shortDog(line) { if (!num(line)) return null; const a = Math.abs(line); if (a < 1.5 || a > 2.5) return null; return { dogHome: line < 0, from: a, to: a + 6 }; }
  // B: the ROAD team is the underdog in a division game and gets less than 7 (+6.5 in, +7 out)
  function divDog(line, isDiv) { return !!isDiv && num(line) && line > 0 && line < 7; }
  // C: an outdoor game (server roof 'open', forecast read) with forecast wind of 10 mph or more at kickoff
  function windy(w) { return !!w && w.status === 'ok' && w.roof === 'open' && num(w.mph) && w.mph >= 10; }
  // grading of a finished game (hs / as = home / away score)
  function gradeTeaser(line, hs, as) { const a = Math.abs(line), m = (line < 0 ? hs - as : as - hs) + a + 6; return m > 0 ? 'hit' : m < 0 ? 'miss' : 'push'; }
  function gradeDog(line, hs, as) { const m = hs - as; return m < line ? 'hit' : m > line ? 'miss' : 'push'; }
  function gradeUnder(tot, hs, as) { const s = hs + as; return s < tot ? 'hit' : s > tot ? 'miss' : 'push'; }
  function tally(L) { return { w: L.filter((x) => x === 'hit').length, l: L.filter((x) => x === 'miss').length, p: L.filter((x) => x === 'push').length }; }
  // words this feature must never show (checked by the tests on every card the browser part draws)
  const BANNED = /\block(s|ed)?\b|can'?t lose|cannot lose|guarantee|\bsure\b|risk[- ]free/i;
  const CARDS = {
    A: { ic: '🐶', t: 'Short dogs, moved up 6', rule: 'Underdogs of +1.5 to +2.5, with the spread moved up 6 points (to +7.5 / +8.5), played two at a time.',
      rec: 'Each leg covered 510 of 671 (76.0%). Paired two per ticket: 156-100 (60.9%), +31.9 units, winning seasons 15 of 21.',
      halves: ['2006-2018: 74.6% of legs covered', '2019-2026: 77.4% of legs covered'],
      more: ['A two-team 6-point teaser at the usual -120 needs 54.6% of tickets to win; the pairs won 60.9%.', 'Pays off only if the app/book pays 1.65x or better for two.'],
      limits: ['Both games of a ticket must cover. One game alone is not this angle.', 'Prices for a 6-point teaser differ by book; worse than -120 eats the edge.', 'The backtest used closing lines. The line you get can be different.', 'This season\'s record counts each leg on its own at the closing spread the app keeps (the shipped closing spreads, then ESPN\'s line, then the logged line history), the same lines the 📣 Alert is graded with.'] },
    B: { ic: '🏠', t: 'Division road dogs under a touchdown', rule: 'The road team is the underdog in a division game and gets less than 7 points. Bet against the spread. Dogs of +7 or more are not included.',
      rec: 'Against the spread: 420-326 (56.3%), +77.5 units at -110, winning seasons 15 of 21.',
      halves: ['2006-2018: 55.1%', '2019-2026: 58.5%'],
      more: ['Division road dogs of +7 or more went 223-227 over the same seasons, so they are left out.'],
      limits: ['Pushes are not counted in the record.', 'The backtest used closing lines. The line you get can be different.', 'This is not the 📣 Alert\'s road dog rule: the Alert uses the model\'s 53% bar and any line. The same game can be in both.', 'This season\'s record uses the closing spread the app keeps, the same lines the 📣 Alert is graded with.'] },
    C: { ic: '💨', t: 'Windy unders', rule: 'Outdoor game with wind of 10 mph or more at kickoff: the under (fewer total points than the posted total).',
      rec: 'Under the total: 692-564 (55.1%), +91.8 units, winning seasons 14 of 21.',
      halves: ['2006-2018: 53.7%', '2019-2026: 58.0%'],
      more: ['The backtest used wind MEASURED at the game. This card uses a FORECAST, and forecasts can miss.'],
      limits: ['Forecast: National Weather Service hourly forecast (api.weather.gov) for the home stadium at the kickoff hour, read by the Oddable server and kept 60 minutes.', 'Domes and fixed roofs are not counted. Retractable roofs (ARI, ATL, DAL, HOU, IND) are not counted either: the roof may be closed. Neutral-site games are not counted.', 'When the forecast cannot be read the game shows "forecast not available"; nothing is guessed.', 'This season\'s record counts only games whose forecast was stored on the server before kickoff, graded against the total ESPN showed at that pull.'] },
  };
  // v302: the ⚡ chip on a game card. keys = which of A / B / C the game qualifies for (chosen in the browser part from the same week functions the tile counts)
  const CHIP = { A: 'Short dog', B: 'Division road dog', C: 'Windy under' };
  function chipHtml(keys, wk) {
    return (keys || []).filter((k) => CHIP[k]).map((k) => { const lab = 'Sir Oddable\'s Edge: ' + CARDS[k].t + '. This game qualifies. Opens the Edge view at this card.';
      return `<button type="button" class="nw edchip" data-edk="${k}" title="${lab}" aria-label="${lab}" onclick="event.stopPropagation();OddEdge.open(${+wk || 0},'${k}')">⚡ ${CHIP[k]}</button>`; }).join('');
  }
  const api = { SRC, CARDS, BANNED, CHIP, chipHtml, shortDog, divDog, windy, gradeTeaser, gradeDog, gradeUnder, tally };
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') { module.exports = api; return; }

  // ================= browser part =================
  // the page's globals (ALL, CFB, TRS, trKey, lmLoad, alertAll, render) are top-level lets / functions of index.html's main script, read when called
  const gALL = () => (typeof ALL !== 'undefined' && ALL) || {};
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const sg = (x) => (x > 0 ? '+' : '') + x;
  const WXU = 'https://calcutta-odds.onrender.com/wx/nfl';
  let WX = { j: null, at: 0, busy: false, err: false }, PAGE = null, WK = 0;
  const locked = () => { try { return typeof GUEST === 'function' ? GUEST() : !!root.__oddLock; } catch (e) { return !!root.__oddLock; } };
  const nfl = () => typeof CFB !== 'undefined' && !CFB;
  const allG = () => Object.values(gALL());
  const isDiv = (a, h) => { try { return !!(root.Trophy && root.Trophy.ready() && root.Trophy.isDiv(a, h)); } catch (e) { return false; } };
  const divReady = () => { try { return !!(root.Trophy && root.Trophy.ready()); } catch (e) { return false; } };
  // closing spread of a game, the same order trophyData() uses for the 📣 Alert: shipped closing spread for a started game, then ESPN's, then the logged history
  function lineOf(g) {
    try {
      const T = (typeof TRS !== 'undefined' && TRS) || {}; if (g.state !== 'pre' && typeof trKey === 'function' && T[trKey(g)] !== undefined) return T[trKey(g)];
      if (num(g.line)) return g.line;
      if (g.state !== 'pre' && typeof lmLoad === 'function') { const r = lmLoad(g.id); if (r.length) return r[r.length - 1][1]; }
    } catch (e) {}
    return null;
  }
  const when = (g) => new Date(g.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const clock = (t) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const score = (g) => g.away.abbr + ' ' + g.away.score + ' – ' + g.home.abbr + ' ' + g.home.score;
  const pill = (r) => (r === 'hit' ? '<span class="edp hit">✓ Won</span>' : r === 'miss' ? '<span class="edp miss">✗ Lost</span>' : r === 'push' ? '<span class="edp">Push</span>' : '');
  // ---- server forecast (signed-in NFL only; every 10 minutes, 2 after a failure) ----
  async function wxLoad() {
    if (locked() || !nfl() || WX.busy) return; const now = Date.now(); if (now - WX.at < (WX.err ? 2 : 10) * 6e4) return;
    WX.busy = true; WX.at = now;
    try { const r = await fetch(WXU); if (!r.ok) throw new Error(r.status); const j = await r.json(); if (!j || j.ok !== true || !Array.isArray(j.games)) throw new Error('bad'); WX.j = j; WX.err = false; }
    catch (e) { WX.err = true; }
    WX.busy = false; refresh(); if (PAGE) paint();
  }
  // ---- what qualifies in week wk ----
  function weekA(wk) { return allG().filter((g) => g.week === wk && g.state !== 'canceled' && g.start).map((g) => { const L = lineOf(g), s = shortDog(L); if (!s) return null; const dog = s.dogHome ? g.home : g.away; return { g, dog, s, res: g.state === 'post' ? gradeTeaser(L, g.home.score, g.away.score) : '' }; }).filter(Boolean).sort((a, b) => a.g.start - b.g.start); }
  function weekB(wk) {
    const inAlert = new Set(); try { (typeof alertAll === 'function' ? alertAll() : []).forEach((x) => { if (x.wk === wk && x.g && x.abbr === x.g.away.abbr) inAlert.add(String(x.g.id)); }); } catch (e) {}
    const out = [], big = [];
    allG().forEach((g) => { if (g.week !== wk || g.state === 'canceled' || !g.start || !isDiv(g.away.abbr, g.home.abbr)) return; const L = lineOf(g); if (divDog(L, true)) out.push({ g, L, alert: inAlert.has(String(g.id)), res: g.state === 'post' ? gradeDog(L, g.home.score, g.away.score) : '' }); else if (num(L) && L >= 7) big.push(g); });
    return { L: out.sort((a, b) => a.g.start - b.g.start), big: big.length };
  }
  function weekC(wk) {
    const j = WX.j; if (!j) return { known: false, err: WX.err, L: [], other: [] };
    const AL = gALL(), cur = j.week === wk && j.type === 2;
    const L = [], other = [];
    if (cur) j.games.forEach((w) => { const g = AL[w.id]; if (windy(w)) L.push({ w, g }); else if (w.status !== 'ok') other.push({ w, g }); });
    (j.past || []).forEach((p) => { if (p.wk !== wk || !(p.mph >= 10)) return; const g = AL[p.id]; L.push({ w: Object.assign({ status: 'ok', roof: 'open', pulled: p.at, away: p.a, home: p.h }, p), g, past: true, res: g && g.state === 'post' && num(p.tot) ? gradeUnder(p.tot, g.home.score, g.away.score) : '' }); });
    const calm = cur ? j.games.filter((w) => w.status === 'ok' && w.roof === 'open' && !windy(w)).length : 0;
    return { known: true, cur, L: L.sort((a, b) => a.w.ko - b.w.ko), other, calm };
  }
  // ---- this season (finished games) ----
  function season() {
    const A = [], B = [], C = [];
    allG().forEach((g) => { if (g.state !== 'post' || !(g.week >= 1)) return; const L = lineOf(g); if (!num(L)) return; if (shortDog(L)) A.push(gradeTeaser(L, g.home.score, g.away.score)); if (isDiv(g.away.abbr, g.home.abbr) && divDog(L, true)) B.push(gradeDog(L, g.home.score, g.away.score)); });
    const AL = gALL(); if (WX.j) (WX.j.past || []).forEach((p) => { const g = AL[p.id]; if (!g || g.state !== 'post' || !(p.mph >= 10) || !num(p.tot) || !(p.at < p.ko)) return; C.push(gradeUnder(p.tot, g.home.score, g.away.score)); });
    return { A: tally(A), B: tally(B), C: tally(C), divOk: divReady(), wxOk: !!WX.j };
  }
  const recTxt = (r) => r.w + '-' + r.l + (r.p ? '-' + r.p : '');
  // ---- v302 the ⚡ chips: which upcoming / live games of week wk the tile counts (same weekA / weekB / weekC, so the tile's number and the chips agree). Finished games get no chip. ----
  let EM = null;
  function edgeMap(wk) {
    if (EM && EM.wk === wk) return EM.m;
    const m = new Map(), add = (g, k) => { if (!g || g.state === 'post' || g.state === 'canceled') return; const id = String(g.id); (m.get(id) || m.set(id, []).get(id)).push(k); };
    weekA(wk).forEach((x) => add(x.g, 'A')); weekB(wk).L.forEach((x) => add(x.g, 'B'));
    const c = weekC(wk); if (c.known && c.cur) c.L.forEach((x) => { if (!x.past) add(x.g, 'C'); });
    EM = { wk, m }; setTimeout(() => { EM = null; }, 0); return m;
  }
  function chip(g) {
    try { if (!g || !nfl() || locked() || g.state === 'post' || !g.start) return ''; return chipHtml(edgeMap(g.week).get(String(g.id)), g.week); } catch (e) { return ''; }
  }
  // update the tile and the chips in place (no redraw of the board, so no scroll jump) when the forecast arrives or fails
  function refresh() {
    try {
      EM = null; const AL = gALL();
      document.querySelectorAll('[data-edge-chip]').forEach((s) => { const h = chip(AL[s.getAttribute('data-edge-chip')]); if (s.innerHTML !== h) s.innerHTML = h; });
      const t = document.querySelector('.edt'); if (t && !locked() && nfl() && WK) { const d = document.createElement('div'); d.innerHTML = tileHtml(WK); if (d.firstElementChild && d.firstElementChild.outerHTML !== t.outerHTML) t.replaceWith(d.firstElementChild); }
    } catch (e) {}
  }
  // ---- the compact tile (newBoard) ----
  function tile(wk) {
    if (!nfl()) return '';
    if (locked()) return ''; // guests and ended accounts get gk()'s locked card from gTop() instead
    css(); setTimeout(wxLoad, 0); WK = wk;
    return tileHtml(wk);
  }
  function tileHtml(wk) {
    const a = weekA(wk).length, b = weekB(wk).L.length, c = weekC(wk), cn = c.L.length, bits = [];
    if (a) bits.push(a + ' short dog' + (a === 1 ? '' : 's')); if (b) bits.push(b + ' division road dog' + (b === 1 ? '' : 's')); if (cn) bits.push(cn + ' windy game' + (cn === 1 ? '' : 's'));
    const wait = !c.known && !c.err ? ' · wind forecast loading' : '';
    const line = bits.length ? 'This week: ' + bits.join(' · ') : 'Nothing qualifies this week' + (c.known || c.err ? '' : wait);
    if (PAGE) setTimeout(paint, 0);
    return `<div class="edt" data-ga="edge" role="button" tabindex="0" onclick="OddEdge.open(${+wk})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();OddEdge.open(${+wk})}"><div class="edth"><b>⚡ Sir Oddable's Edge</b><span aria-hidden="true">›</span></div><div class="sub">${esc(line)}${bits.length ? esc(wait) : ''}</div><div class="sub edts">Three angles that held up over 20 seasons · records and limits inside</div></div>`;
  }
  // ---- full view ----
  function css() {
    if (document.getElementById('edcss')) return; const st = document.createElement('style'); st.id = 'edcss';
    st.textContent = '.edt{border:2px solid #38bdf8;border-radius:14px;padding:10px 12px;margin:8px 0;background:#38bdf814;cursor:pointer;min-width:0}.edt .edth{display:flex;align-items:center;gap:8px;font-size:16px}.edt .edth b{flex:1;min-width:0;overflow-wrap:anywhere}.edt .edth span{font-size:22px;opacity:.7}.edt .edts{font-size:12px;margin-top:2px}html.cb .edt{border-color:#7dd3fc}'
      + '#edgepage{position:fixed;inset:0;z-index:340;background:var(--bg,#0b0f17);color:var(--ink)}#edgepage[hidden]{display:none}'
      + '#edgepage .edw{display:flex;flex-direction:column;height:100%;max-width:820px;margin:0 auto}'
      + '#edgepage .edhd{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 12px 10px;border-bottom:1px solid var(--line)}#edgepage .edhd b{flex:1;min-width:0;font-size:18px;overflow-wrap:anywhere}'
      + '#edgepage .edbk{min-width:44px;min-height:44px;padding:0 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--ink);font:700 15px system-ui;white-space:nowrap;cursor:pointer}'
      + '#edgepage .edb{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:10px 12px calc(28px + env(safe-area-inset-bottom));line-height:1.4}'
      + '#edgepage .edin{margin:0 0 10px;font-size:14px;color:var(--muted)}#edgepage .edgrid{display:grid;grid-template-columns:1fr;gap:12px;align-items:start}'
      + '#edgepage .edc{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px;min-width:0;overflow-wrap:anywhere}#edgepage .edc h3{margin:0 0 6px;font-size:17px}'
      + '#edgepage .edr{font-size:14px;margin:0 0 8px}#edgepage .edrec{display:block;width:100%;text-align:left;margin:0 0 6px;padding:10px 12px;min-height:44px;border:1px solid #38bdf8;border-radius:12px;background:#38bdf812;color:var(--ink);font:600 14px/1.35 system-ui;cursor:pointer;white-space:normal}#edgepage .edrec u{color:#38bdf8;text-decoration:none;font-weight:800;white-space:nowrap}html.cb #edgepage .edrec{border-color:#7dd3fc}html.cb #edgepage .edrec u{color:#7dd3fc}'
      + '#edgepage .edsrc{font-size:12px;color:var(--muted);margin:0 0 6px}#edgepage .edlv{font-size:14px;margin:6px 0;font-weight:700}#edgepage .edlv span{font-weight:400;color:var(--muted);font-size:12px}'
      + '#edgepage .edwk{margin-top:10px;padding-top:8px;border-top:1px solid var(--line)}#edgepage .edwk>b{display:block;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}'
      + '#edgepage .edg{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 10px;padding:7px 0;border-top:1px dashed var(--line)}#edgepage .edg:first-of-type{border-top:0}#edgepage .edg .l{text-align:left;min-width:0;flex:1 1 60%}#edgepage .edg .n{text-align:right;margin-left:auto;font-variant-numeric:tabular-nums;white-space:nowrap}#edgepage .edg small{display:block;color:var(--muted);font-size:12px}'
      + '#edgepage .edp{display:inline-block;font:700 12px system-ui;padding:2px 8px;border-radius:999px;border:1px solid currentColor;margin-left:6px}#edgepage .edp.hit{color:var(--green)}#edgepage .edp.miss{color:var(--red)}#edgepage .edal{display:inline-block;font-size:12px;color:#c9a227;font-weight:700}'
      + '#edgepage .ednote{margin-top:8px;font-size:13px;color:var(--muted)}#edgepage .ednone{margin:6px 0;font-weight:700}'
      + '#edgepage .edhow h3{margin:4px 0 8px;font-size:18px}#edgepage .edhow ul{margin:6px 0 10px;padding-left:20px}#edgepage .edhow li{margin:4px 0}#edgepage .edhow .edc{margin-bottom:12px}'
      + '@media (min-width:700px){#edgepage .edgrid{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}#edgepage .edhow{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;align-items:start}#edgepage .edhow>h3,#edgepage .edhow>.edfull{grid-column:1/-1}#edgepage .edhow .edc{margin:0}}'
      + '@media (min-width:900px){#edgepage .edw{max-width:1200px}}@media (min-width:1500px){#edgepage .edw{max-width:1360px}}';
    document.head.appendChild(st);
  }
  function el() { let o = document.getElementById('edgepage'); if (!o) { css(); o = document.createElement('div'); o.id = 'edgepage'; o.hidden = true; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', "Sir Oddable's Edge"); document.body.appendChild(o); } return o; }
  function recBtn(k) { return `<button type="button" class="edrec" onclick="OddEdge.how('${k}')">Backtest: ${esc(CARDS[k].rec)} <u>How this is counted ›</u></button><div class="edsrc">Source: ${esc(SRC)}</div>`; }
  function cardA(wk, S) {
    const L = weekA(wk), up = L.filter((x) => x.g.state === 'pre').length;
    const rows = L.map((x) => `<div class="edg"><span class="l"><b>${esc(x.dog.abbr)} ${sg(x.s.from)} → ${sg(x.s.to)}</b><small>${esc(x.g.away.abbr)} at ${esc(x.g.home.abbr)}</small></span><span class="n">${x.g.state === 'pre' ? esc(when(x.g)) : x.g.state === 'post' ? esc(score(x.g)) + pill(x.res) : 'Live'}</span></div>`).join('');
    const msg = !L.length ? 'No game fits this week' : up === 0 ? 'No game left to play this week' : up === 1 ? 'Only one game fits this week' : up + ' games fit this week';
    return `<section class="edc" data-edge="A"><h3>${CARDS.A.ic} ${esc(CARDS.A.t)}</h3><div class="edr">${esc(CARDS.A.rule)}</div>${recBtn('A')}<div class="edlv">This season: ${recTxt(S.A)} <span>(each leg, closing lines the app keeps)</span></div>
      <div class="edwk"><b>Week ${+wk}</b><div class="ednone">${esc(msg)}</div>${rows}</div><div class="ednote">Needs two games; pays off only if the app/book pays 1.65x or better for two.</div></section>`;
  }
  function cardB(wk, S) {
    const { L, big } = weekB(wk);
    const rows = L.map((x) => `<div class="edg"><span class="l"><b>${esc(x.g.away.abbr)} ${sg(x.L)}</b> at ${esc(x.g.home.abbr)}${x.alert ? '<small class="edal">also in this week\'s Alert</small>' : ''}</span><span class="n">${x.g.state === 'pre' ? esc(when(x.g)) : x.g.state === 'post' ? esc(score(x.g)) + pill(x.res) : 'Live'}</span></div>`).join('');
    const msg = !divReady() ? 'Division list still loading' : !L.length ? 'No game fits this week' : L.length === 1 ? 'One game fits this week' : L.length + ' games fit this week';
    return `<section class="edc" data-edge="B"><h3>${CARDS.B.ic} ${esc(CARDS.B.t)}</h3><div class="edr">${esc(CARDS.B.rule)}</div>${recBtn('B')}<div class="edlv">This season: ${S.divOk ? recTxt(S.B) : '–'} <span>(closing lines the app keeps)</span></div>
      <div class="edwk"><b>Week ${+wk}</b><div class="ednone">${esc(msg)}</div>${rows}${big ? `<div class="ednote">${big} division road dog${big === 1 ? '' : 's'} at +7 or more this week: not counted.</div>` : ''}</div></section>`;
  }
  function cardC(wk, S) {
    const c = weekC(wk);
    const row = (x) => { const w = x.w, g = x.g, a = g ? g.away.abbr : w.away, h = g ? g.home.abbr : w.home; return `<div class="edg"><span class="l"><b>${esc(a)} at ${esc(h)}</b> · ${Math.round(w.mph)} mph forecast at kickoff<small>Total ${num(w.tot) ? w.tot : 'not posted'} · forecast pulled ${esc(clock(w.pulled))}</small></span><span class="n">${g && g.state === 'post' ? esc(score(g)) + pill(x.res) : g && g.state === 'in' ? 'Live' : esc(clock(w.ko))}</span></div>`; };
    let body;
    if (!c.known) body = `<div class="ednone">${c.err ? 'Forecast not available right now' : 'Loading the forecast…'}</div>`;
    else {
      const msg = !c.L.length ? 'No game fits this week' : c.L.length === 1 ? 'One game fits this week' : c.L.length + ' games fit this week';
      body = `<div class="ednone">${esc(msg)}</div>${c.L.map(row).join('')}` + (c.cur ? '' : '<div class="ednote">Forecasts are pulled only for the current week.</div>')
        + (c.other.length ? `<div class="ednote">${c.other.map((x) => `${esc(x.w.away)} at ${esc(x.w.home)}: ${esc(String(x.w.note || 'Forecast not available').toLowerCase())}`).join(' · ')}</div>` : '')
        + (c.calm ? `<div class="ednote">${c.calm} outdoor game${c.calm === 1 ? '' : 's'} under 10 mph.</div>` : '');
    }
    const lv = S.wxOk ? recTxt(S.C) + ' <span>(only games with a forecast stored before kickoff' + (WX.j && WX.j.stored === false ? '; kept since the server last restarted' : '') + ')</span>' : '– <span>(forecast server not reached)</span>';
    return `<section class="edc" data-edge="C"><h3>${CARDS.C.ic} ${esc(CARDS.C.t)}</h3><div class="edr">${esc(CARDS.C.rule)}</div>${recBtn('C')}<div class="edlv">This season: ${lv}</div>
      <div class="ednote" style="margin-top:0">The backtest used wind measured at the game. This card uses a forecast from the National Weather Service${WX.j ? ', pulled ' + esc(clock(Math.max(0, ...WX.j.games.filter((w) => w.pulled).map((w) => w.pulled)) || WX.j.at)) : ''}.</div>
      <div class="edwk"><b>Week ${+wk}</b>${body}</div></section>`;
  }
  function paint() {
    if (!PAGE) return; const o = el();
    if (!nfl()) { close(); return; }
    if (locked()) { o.innerHTML = `<div class="edw"><div class="edhd"><button type="button" class="edbk" onclick="OddEdge.close()">‹ Back</button><b>⚡ Sir Oddable's Edge</b></div><div class="edb">${typeof gk === 'function' ? gk("Sign up free to see Sir Oddable's Edge", 'edge', { big: 1 }) : ''}</div></div>`; return; }
    const keep = o.querySelector('.edb'), y = keep ? keep.scrollTop : 0, wk = WK, S = season();
    let head, body;
    if (PAGE === 'main') {
      head = `<button type="button" class="edbk" onclick="OddEdge.close()">‹ Back</button><b>⚡ Sir Oddable's Edge · Week ${+wk}</b>`;
      body = `<div class="edin">Edges, not picks: three betting angles that held up in a 20-season backtest in both halves (2006-2018 and 2019-2026). The records are past results; no angle wins every week. Nothing here places a bet.</div><div class="edgrid">${cardA(wk, S)}${cardB(wk, S)}${cardC(wk, S)}</div>`;
    } else {
      const k = PAGE, c = CARDS[k], ul = (a) => '<ul>' + a.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>';
      head = `<button type="button" class="edbk" onclick="OddEdge.back()">‹ Back</button><b>How this is counted</b>`;
      body = `<div class="edhow"><h3>${c.ic} ${esc(c.t)}</h3><div class="edc"><b>The rule</b><div class="edr" style="margin-top:4px">${esc(c.rule)}</div><b>The record</b>${ul([c.rec].concat(c.halves, c.more))}<div class="edsrc">Source: ${esc(SRC)}</div></div>
        <div class="edc"><b>Limits</b>${ul(c.limits.concat(['About 45 angles were tried in this search, so some of this can be luck even though both halves passed.', 'Past results; no angle wins every week.']))}</div>
        <div class="edc edfull"><b>College</b><div class="edr" style="margin-top:4px">The same search on college, 2013-2026, found no angle that held up, so this is NFL only.</div></div></div>`;
    }
    o.innerHTML = `<div class="edw"><div class="edhd">${head}</div><div class="edb">${body}</div></div>`;
    const nb = o.querySelector('.edb'); if (nb && PAGE === 'main' && y) nb.scrollTop = y;
  }
  function open(wk, k) { if (!nfl()) return; if (locked()) { try { if (root.oddSignUp) root.oddSignUp('edge'); } catch (e) {} return; } if (wk) WK = +wk; PAGE = 'main'; const o = el(); o.hidden = false; paint(); try { const nb = o.querySelector('.edb'); nb.scrollTop = 0; const c = k && o.querySelector('[data-edge="' + k + '"]'); if (c) nb.scrollTop += c.getBoundingClientRect().top - nb.getBoundingClientRect().top - 8; } catch (e) {} setTimeout(wxLoad, 0); try { o.querySelector('.edbk').focus({ preventScroll: true }); } catch (e) {} }
  function how(k) { if (!CARDS[k]) return; PAGE = k; paint(); try { el().querySelector('.edb').scrollTop = 0; el().querySelector('.edbk').focus({ preventScroll: true }); } catch (e) {} }
  function back() { PAGE = 'main'; paint(); }
  function close() { PAGE = null; const o = document.getElementById('edgepage'); if (o) { o.hidden = true; o.innerHTML = ''; } }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && PAGE) { if (PAGE === 'main') close(); else back(); } });
  root.OddEdge = Object.assign(api, { tile, chip, refresh, open, how, back, close, paint, _wx: () => WX, _season: season, _week: (wk) => ({ A: weekA(wk), B: weekB(wk), C: weekC(wk) }) });
})(typeof window !== 'undefined' ? window : globalThis);
