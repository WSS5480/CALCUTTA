// Oddable owner dashboard. Shown to the owner (owner-PIN sign-in or an OWNER_PHONE account); the server refuses everyone else.
// Phones are never available: players show as the name Steve typed for them, else a short id. Graphs are tappable; every tile and graph drills down, with a back button.
(function () {
  const API = 'https://calcutta-odds.onrender.com/acct/dash';
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
  const GOOD = '#2ecc71', BAD = '#ff6b6b', BLUE = '#4f8cff';
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  let D = null, DT = 0, P = 'all', DAYSEL = '', NEEDPIN = false, stack = [{ t: 'home' }], busy = false, err = '', GF = 'all';

  function from(p) {
    const td = today(); if (p === 'all') return '';
    if (p === 'ytd') return td.slice(0, 4) + '-01-01'; if (p === 'mtd') return td.slice(0, 7) + '-01';
    const d = new Date(td + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10);
  }
  const PN = { wtd: 'This week', mtd: 'This month', ytd: 'This year', all: 'Lifetime', get day() { return DAYSEL || today(); } };
  const nm = (u) => (u.name ? u.name : 'Player ····' + u.tag);
  // Per-day numbers: the frozen log (settled days) merged with what the player's bets say by the day they were placed, so a day with unsettled or not-yet-logged bets is not shown as empty.
  const udays = (u) => { const m = {}; (u.days || []).forEach((d) => { m[d.day] = Object.assign({ o: 0 }, d); }); const pl = u.placed || {}; Object.keys(pl).forEach((k) => { const p = pl[k], d = m[k]; if (!d) m[k] = { day: k, n: p.n, w: p.w, l: p.l, p: p.p, risk: p.risk, pl: p.pl, o: p.o }; else { d.n = Math.max(d.n, p.n); d.o = Math.max(0, d.n - (d.w + d.l + (d.p || 0))); if (p.risk > d.risk) d.risk = p.risk; } }); return Object.keys(m).sort().reverse().map((k) => m[k]); };
  const rows = (u) => { if (P === 'day') return udays(u).filter((d) => d.day === (DAYSEL || today())); const f = from(P); return udays(u).filter((d) => !f || d.day >= f); };
  const sum = (ds) => { const r = { n: 0, w: 0, l: 0, p: 0, risk: 0, pl: 0, o: 0 }; ds.forEach((d) => { r.o += d.o || 0; r.n += d.n; r.w += d.w; r.l += d.l; r.p += d.p || 0; r.risk += d.risk; r.pl += d.pl; }); r.pct = r.w + r.l ? Math.round((r.w / (r.w + r.l)) * 1000) / 10 : null; return r; };
  const agU = (u) => sum(rows(u));
  function byDay() { const m = {}; (D.users || []).forEach((u) => rows(u).forEach((d) => { const o = m[d.day] || (m[d.day] = { day: d.day, n: 0, w: 0, l: 0, pl: 0 }); o.n += d.n; o.w += d.w; o.l += d.l; o.pl += d.pl; })); return Object.keys(m).sort().map((k) => m[k]); }
  const sh = (n) => (n == null ? '—' : n + '%');

  // ---- charts (SVG, each hit area is a full-height strip so a finger can hit it) ----
  function bars(list, val, key, color) { // vertical bars, zero line in the middle when values go negative
    if (!list.length) return '<div class="sub">No finished days in this period yet.</div>';
    const W = 320, H = 130, pad = 6, mx = Math.max(1, ...list.map((x) => Math.abs(val(x)))), neg = list.some((x) => val(x) < 0), z = neg ? H / 2 : H - 16, sc = (neg ? H / 2 - 14 : H - 30) / mx, bw = Math.max(2, Math.min(18, (W - pad * 2) / list.length - 2)), step = (W - pad * 2) / list.length;
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;touch-action:manipulation"><line x1="0" x2="' + W + '" y1="' + z + '" y2="' + z + '" stroke="#8886" stroke-width="1"/>';
    list.forEach((x, i) => { const v = val(x), h = Math.abs(v) * sc, cx = pad + step * i + step / 2, y = v >= 0 ? z - h : z; s += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" rx="2" fill="' + (color || (v >= 0 ? GOOD : BAD)) + '"/><rect data-go="' + esc(key(x)) + '" x="' + (cx - step / 2).toFixed(1) + '" y="0" width="' + step.toFixed(1) + '" height="' + H + '" fill="transparent" style="cursor:pointer"/>'; });
    return s + '</svg><div class="sub" style="display:flex;justify-content:space-between"><span>' + esc(list[0].day || '') + '</span><span>tap a bar</span><span>' + esc(list[list.length - 1].day || '') + '</span></div>';
  }
  function line(list) { // running total of profit and loss; tap anywhere to open that day
    if (list.length < 2) return '<div class="sub">Needs two or more finished days.</div>';
    let c = 0; const pts = list.map((d) => ({ day: d.day, v: (c += d.pl) })), W = 320, H = 120, mn = Math.min(0, ...pts.map((p) => p.v)), mxv = Math.max(0, ...pts.map((p) => p.v)), r = mxv - mn || 1, X = (i) => 6 + (i / (pts.length - 1)) * (W - 12), Y = (v) => 8 + (1 - (v - mn) / r) * (H - 16), step = (W - 12) / (pts.length - 1);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;touch-action:manipulation"><line x1="0" x2="' + W + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="#8886"/><polyline fill="none" stroke="' + (pts[pts.length - 1].v >= 0 ? GOOD : BAD) + '" stroke-width="2.5" points="' + pts.map((p, i) => X(i).toFixed(1) + ',' + Y(p.v).toFixed(1)).join(' ') + '"/>';
    pts.forEach((p, i) => { s += '<rect data-go="' + esc(p.day) + '" x="' + (X(i) - step / 2).toFixed(1) + '" y="0" width="' + step.toFixed(1) + '" height="' + H + '" fill="transparent" style="cursor:pointer"/>'; });
    return s + '</svg><div class="sub" style="display:flex;justify-content:space-between"><span>' + esc(pts[0].day) + '</span><span>now ' + money(pts[pts.length - 1].v) + '</span></div>';
  }
  function hbars(list, label, val, txt, key) { // one wrapped bar per player
    if (!list.length) return '<div class="sub">No players yet.</div>';
    return list.map((x) => { const v = val(x); return '<div data-go="' + esc(key(x)) + '" style="cursor:pointer;margin:8px 0;min-height:44px"><div style="display:flex;justify-content:space-between;gap:8px"><b>' + esc(label(x)) + '</b><span>' + esc(txt(x)) + '</span></div><div style="height:12px;border-radius:6px;background:#8883;margin-top:4px"><div style="height:12px;border-radius:6px;width:' + Math.max(2, Math.min(100, v)) + '%;background:' + BLUE + '"></div></div></div>'; }).join('');
  }

  // ---- screens ----
  const card = (h, sub, inner) => '<div class="odc"><h3>' + h + (sub ? ' <span class="sub">' + sub + '</span>' : '') + '</h3>' + inner + '</div>';
  const tile = (go, v, l, col) => '<div class="odt" data-go="' + esc(go) + '"><div class="v"' + (col ? ' style="color:' + col + '"' : '') + '>' + v + '</div><div class="l">' + l + '</div></div>';
  const chips = () => '<div class="odch">' + [['day', 'Day'], ['wtd', 'WTD'], ['mtd', 'MTD'], ['ytd', 'YTD'], ['all', 'Lifetime']].map(([k, t]) => '<button data-p="' + k + '"' + (k === P ? ' class="on"' : '') + '>' + t + '</button>').join('') + (P === 'day' ? '<input type="date" id="oddd" value="' + esc(DAYSEL || today()) + '" max="' + today() + '" style="min-height:44px;padding:6px 10px;border-radius:10px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);color:var(--ink,#eee);font:700 14px inherit">' : '') + '</div>';
  const openRow = (b, who) => '<div class="odr"><div><b>' + esc(b.what) + '</b><div class="sub">' + (who ? esc(who) + ' · ' : '') + esc(b.day || '') + (b.odds ? ' · ' + (b.odds > 0 ? '+' : '') + b.odds : '') + '</div></div><div>$' + esc(Math.round(b.stake * 100) / 100) + '<div class="sub">risk</div></div></div>';
  const resTag = (b) => b.fin === 'won' ? '<span style="color:' + GOOD + ';font-weight:800">WON ' + money(b.pl) + '</span>' : b.fin === 'lost' ? '<span style="color:' + BAD + ';font-weight:800">LOST ' + money(b.pl) + '</span>' : b.fin === 'push' ? '<b>PUSH</b>' : b.fin === 'res' ? '<b>Resolved</b>' : '<span class="sub">OPEN</span>';
  const gameRow = (b, who) => '<div class="odr"><div><b>' + esc(b.what) + '</b><div class="sub">' + (who ? esc(who) + ' · ' : '') + esc(b.day || '') + (b.odds ? ' · ' + (b.odds > 0 ? '+' : '') + b.odds : '') + ' · risk $' + esc(Math.round(b.stake * 100) / 100) + '</div></div><div style="text-align:right">' + resTag(b) + '</div></div>';
  const inPeriod = (b) => { if (P === 'day') return b.day === (DAYSEL || today()); const f = from(P); return !f || b.day >= f; };
  const gamesOf = (users, pred) => users.flatMap((u) => (u.list || []).filter((b) => inPeriod(b) && (!pred || pred(b))).map((b) => ({ b, u }))).sort((x, y) => (x.b.day < y.b.day ? 1 : x.b.day > y.b.day ? -1 : 0));
  const gamesCard = (h, sub, arr, showWho) => card(h, sub, arr.length ? arr.map(({ b, u }) => gameRow(b, showWho ? nm(u) : '')).join('') : '<div class="sub">No games in this period.</div>');
  const userRow = (u) => { const a = agU(u); return '<div class="odr" data-go="u:' + esc(u.k) + '" style="cursor:pointer"><div><b>' + esc(nm(u)) + '</b><div class="sub">' + a.n + ' bets · ' + a.w + '-' + a.l + (a.p ? '-' + a.p : '') + ' · ' + (u.open || []).length + ' open · synced ' + (u.updated ? new Date(u.updated).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '—') + '</div></div><div style="text-align:right;color:' + (a.pl >= 0 ? GOOD : BAD) + '">' + money(a.pl) + '<div class="sub">' + sh(a.pct) + ' win</div></div></div>'; };
  const dayRow = (d) => '<div class="odr" data-go="' + esc(d.day) + '" style="cursor:pointer"><div><b>' + esc(d.day) + '</b><div class="sub">' + d.n + ' bets · ' + d.w + '-' + d.l + '</div></div><div style="color:' + (d.pl >= 0 ? GOOD : BAD) + '">' + money(d.pl) + '</div></div>';

  function home() {
    const U = D.users || [], all = sum(U.flatMap(rows)), days = byDay(), OPN = U.reduce((n, u) => n + (u.open || []).length, 0), act = U.filter((u) => Date.now() - u.updated < 7 * 864e5).length;
    const rank = U.map((u) => [u, agU(u)]).filter(([, a]) => a.w + a.l > 0).sort((x, y) => (y[1].pct || 0) - (x[1].pct || 0));
    const last = U.reduce((m, u) => Math.max(m, u.updated || 0), 0);
    return chips() + '<div class="sub" style="margin:-4px 0 10px">A player\'s numbers update when their app syncs; results of games that ended since then show as unsettled. Latest sync ' + (last ? new Date(last).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '—') + '.</div>' + (P === 'day' ? openOn(DAYSEL || today()) : '') + '<div class="odg">' + tile('users', U.length, 'Players') + tile('games', all.n, 'Bets · ' + PN[P]) + tile('gw', all.w, 'Wins · ' + PN[P], GOOD) + tile('gl', all.l, 'Losses · ' + PN[P], BAD) + tile('rank', sh(all.pct), 'Win % (' + all.w + '-' + all.l + ')') + tile('days', money(all.pl), 'Players\' P/L', all.pl >= 0 ? GOOD : BAD) + tile('open', OPN, 'Open bets now') + tile('users', act, 'Active this week') + tile('open', all.o, 'Unsettled · ' + PN[P]) + tile('days', money(all.risk), 'Risked · ' + PN[P]) + '</div>'
      + sendCard()
      + card('Profit and loss by day', 'all players · tap a bar', bars(days, (d) => d.pl, (d) => d.day))
      + card('Running total', 'tap to open a day', line(days))
      + card('Bets per day', 'tap a bar', bars(days, (d) => d.n, (d) => d.day, BLUE))
      + card('Win % by player', 'tap a player', hbars(rank, (x) => nm(x[0]), (x) => x[1].pct || 0, (x) => sh(x[1].pct) + ' · ' + x[1].w + '-' + x[1].l, (x) => 'u:' + x[0].k));
  }
  function users() { const U = (D.users || []).slice().sort((a, b) => agU(b).pl - agU(a).pl); return card('Players', PN[P] + ' · best P/L first', U.length ? U.map(userRow).join('') : '<div class="sub">No players yet.</div>'); }
  function rankV() { const U = (D.users || []).map((u) => [u, agU(u)]).filter(([, a]) => a.w + a.l > 0).sort((x, y) => (y[1].pct || 0) - (x[1].pct || 0)); return card('Win % by player', PN[P], U.length ? U.map(([u]) => userRow(u)).join('') : '<div class="sub">No settled bets in this period.</div>'); }
  function daysV() { const d = byDay().reverse(); return card('Every finished day', PN[P] + ' · newest first', d.length ? d.map(dayRow).join('') : '<div class="sub">None yet. Today counts after midnight.</div>'); }
  function openV() { const U = (D.users || []).filter((u) => (u.open || []).length), n = U.reduce((a, u) => a + u.open.length, 0); return card('Open bets, all players', n + ' not settled yet', n ? U.map((u) => u.open.map((b) => openRow(b, nm(u))).join('')).join('') : '<div class="sub">No open bets.</div>'); }
  const openOn = (day) => { const U = (D.users || []).filter((u) => (u.open || []).some((b) => b.day === day)); const n = U.reduce((a, u) => a + u.open.filter((b) => b.day === day).length, 0); return card('Bets placed ' + esc(day), n + ' not settled yet', n ? U.map((u) => u.open.filter((b) => b.day === day).map((b) => openRow(b, nm(u))).join('')).join('') : '<div class="sub">No unsettled bets placed that day.</div>'); };
  function dayV(day) {
    const list = (D.users || []).map((u) => [u, udays(u).find((d) => d.day === day)]).filter((x) => x[1]).sort((a, b) => b[1].pl - a[1].pl), t = sum(list.map((x) => x[1]));
    return '<div class="odg">' + tile('', t.n, 'Bets') + tile('', t.w + '-' + t.l, 'Record') + tile('', money(t.pl), 'P/L', t.pl >= 0 ? GOOD : BAD) + '</div>'
      + card(esc(day), 'who bet that day · tap a player', list.length ? list.map(([u, d]) => '<div class="odr" data-go="u:' + esc(u.k) + '" style="cursor:pointer"><div><b>' + esc(nm(u)) + '</b><div class="sub">' + d.n + ' bets · ' + d.w + '-' + d.l + '</div></div><div style="color:' + (d.pl >= 0 ? GOOD : BAD) + '">' + money(d.pl) + '</div></div>').join('') : '<div class="sub">No finished bets that day.</div>') + gamesCard('Games · ' + esc(day), 'every bet placed that day', (D.users || []).flatMap((u) => (u.list || []).filter((b) => b.day === day).map((b) => ({ b, u }))), true);
  }
  function userV(k) {
    const u = (D.users || []).find((x) => x.k === k); if (!u) return '<div class="odc">Player not found.</div>';
    const a = agU(u), ds = rows(u).slice().sort((x, y) => (x.day < y.day ? -1 : 1));
    return card('Name', 'only you see this', '<div style="display:flex;gap:8px;flex-wrap:wrap"><input id="oddn" maxlength="24" placeholder="Type a name" value="' + esc(u.name || '') + '" style="flex:1;min-width:160px;min-height:44px;padding:6px 10px;border-radius:10px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);color:var(--ink,#eee);font:15px inherit"><button data-save="' + esc(u.k) + '">Save name</button></div><div class="sub" id="oddns"></div>') + chips() + '<div class="odg">' + tile('', a.n, 'Bets · ' + PN[P]) + tile('', a.w + '-' + a.l + (a.p ? '-' + a.p : ''), 'Record') + tile('', sh(a.pct), 'Win %') + tile('', money(a.pl), 'Settled P/L', a.pl >= 0 ? GOOD : BAD) + tile('', a.o, 'Unsettled · ' + PN[P]) + tile('', money(a.risk), 'Risked') + '</div>'
      + card('Profit and loss by day', 'tap a bar', bars(ds, (d) => d.pl, (d) => d.day))
      + gamesCard('Games', PN[P] + ' · newest first', gamesOf([u]), false)
      + card('Current bets', 'not settled yet', (u.open || []).length ? u.open.map((b) => openRow(b)).join('') : '<div class="sub">No open bets.</div>')
      + card('By day', PN[P] + ' · newest first', ds.length ? ds.slice().reverse().map(dayRow).join('') : '<div class="sub">No finished days in this period.</div>');
  }
  function gamesV() {
    const per = gamesOf(D.users || []), cnt = (f) => per.filter(({ b }) => f === 'all' || b.fin === f).length, nm2 = { all: 'All', won: 'Won', lost: 'Lost', push: 'Push' };
    const bar = '<div class="odch">' + ['all', 'won', 'lost', 'push'].map((f) => '<button data-gf="' + f + '"' + (f === GF ? ' class="on"' : '') + '>' + nm2[f] + ' ' + cnt(f) + '</button>').join('') + '</div>';
    const arr = per.filter(({ b }) => GF === 'all' || b.fin === GF);
    return chips() + bar + gamesCard(GF === 'won' ? 'Winning bets' : GF === 'lost' ? 'Losing bets' : GF === 'push' ? 'Pushes' : 'Every game', PN[P] + ' · newest first', arr, true);
  }

  // ---- v267: "Send to everyone". The owner writes a short message; the odds server (POST /acct/broadcast, owner only) hands it to My Apps, which sends the
  // phone alerts and keeps it as the in-app message. Only drawn on the unlocked dashboard (home() needs the players, which the server gives to the owner alone).
  // What was typed lives in BC, so a repaint (period chips, Refresh) never loses it. "Sent today" is this session only. All text goes out through esc() / textContent.
  const BC = { open: false, title: '', body: '', aud: 'all', link: '', step: 'edit', busy: false, msg: '', bad: false, sent: [], dry: null };
  const BCWHO = { all: 'Everyone', active: 'Paid or trial only', expired: 'Expired only' }, BCTO = { '': 'Nowhere (no button)', home: 'Home (games)', bets: 'My Bets', live: 'Live', sports: 'Sports (NBA, MLB, NHL)', pga: 'PGA Tour', pickleball: 'Pickleball', golfgps: 'Golf GPS' };
  const BCURL = { home: '/', bets: '/?open=bets', live: '/?open=live', sports: '/sports.html', pga: '/pga.html', pickleball: '/pickleball.html', golfgps: '/golfgps.html' }; // same list as odds-api/announce.js LINKS
  const BCASK = { all: 'everyone with an Oddable account', active: 'everyone with paid or trial access', expired: 'everyone whose access has ended' };
  const BCGO = { all: 'Send to everyone', active: 'Send to paid or trial', expired: 'Send to expired' };
  const FIELD = 'display:block;width:100%;box-sizing:border-box;min-height:44px;padding:8px 10px;margin:4px 0 2px;border-radius:10px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);color:var(--ink,#eee);font:16px/1.3 system-ui';
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : (w === 'person' ? '' : 's'));
  const ppl = (n) => (n === 1 ? '1 person' : n + ' people');
  // v269: the confirm step says how many people the message reaches (a count from the server, POST /acct/broadcast with dry:true: nothing is sent).
  // BC.dry = {people, alerts, devices, left} or null (no count: the v267 wording plus "Count not available right now.").
  function bcAsk() {
    const d = BC.dry;
    if (!d) return '<b>Send this to ' + esc(BCASK[BC.aud]) + '?</b><div class="sub" style="margin:4px 0 8px">It cannot be taken back once it is sent.</div><div class="sub" id="odbnc" style="margin:-4px 0 8px;font-size:12px">Count not available right now.</div>';
    const P = d.people, A = d.alerts, K = d.devices, dv = K != null ? ' (' + plural(K, 'device') + ')' : '';
    let t = '';
    if (P === 0) t = 'Nobody is in this group right now, so nobody would see it. ';
    else if (A === 0) t = 'None of them has phone alerts on. They see it the next time they open Oddable. ';
    else if (A != null && A >= P) t = (P === 1 ? 'They have phone alerts on' + dv + ' and get' : (P === 2 ? 'Both' : 'All ' + P) + ' have phone alerts on' + dv + ' and get') + ' it on the phone now. ';
    else if (A != null) t = A + ' of them ' + (A === 1 ? 'has' : 'have') + ' phone alerts on' + dv + ' and get' + (A === 1 ? 's' : '') + ' it on the phone now. Everyone else sees it the next time they open Oddable. ';
    else t = 'They get it on the phone now if alerts are on, or see it the next time they open Oddable. ';
    if (d.left != null) t += d.left + ' send' + (d.left === 1 ? '' : 's') + ' left today. ';
    return '<b id="odbn">Send to ' + esc(ppl(P)) + '?</b><div class="sub" id="odbnd" style="margin:4px 0 8px">' + esc(t + 'This cannot be unsent.') + '</div>';
  }
  function sendCard() {
    const opt = (o, cur) => Object.keys(o).map((k) => '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(o[k]) + '</option>').join('');
    const td = new Date().toDateString(), sent = BC.sent.filter((x) => new Date(x.at).toDateString() === td);
    const list = sent.length ? '<div style="margin-top:12px;border-top:1px solid #8883;padding-top:8px"><b>Sent today</b>' + sent.map((x) => '<div class="odr" style="align-items:flex-start"><div style="min-width:0;overflow-wrap:anywhere"><b>' + esc(x.title) + '</b><div class="sub">' + esc(BCWHO[x.aud]) + ' · ' + esc(new Date(x.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + '</div></div><div class="sub" style="text-align:right;white-space:nowrap">' + esc(x.count) + '</div></div>').join('') + '</div>' : '';
    const msg = '<div id="odbs" role="status" style="margin-top:8px;font-weight:700;overflow-wrap:anywhere;color:' + (BC.bad ? BAD : GOOD) + '">' + esc(BC.msg) + '</div>';
    if (!BC.open) return card('📣 Send to everyone', 'a message to every Oddable user', '<div class="sub" style="margin-bottom:8px">Goes to their phones (if alerts are on) and shows at the top of Oddable.</div><button data-bc="open">✏️ Write a message</button>' + msg + list);
    if (BC.step === 'confirm') return card('📣 Send to everyone', 'check it, then send', '<div id="odbc">' + bcAsk()
      + '<div style="border:1px solid var(--line,#fff3);border-radius:10px;padding:10px;overflow-wrap:anywhere"><div class="sub">Title</div><div id="odbct" style="font-weight:800">' + esc(BC.title.trim()) + '</div><div class="sub" style="margin-top:6px">Message</div><div id="odbcm">' + esc(BC.body.trim()) + '</div><div class="sub" style="margin-top:6px">Who: ' + esc(BCWHO[BC.aud]) + ' · Opens: ' + esc(BCTO[BC.link]) + '</div></div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"><button data-bc="yes" style="background:#0b3d91;border-color:#0b3d91;color:#fff"' + (BC.busy ? ' disabled' : '') + '>' + (BC.busy ? 'Sending…' : 'Yes, send now') + '</button><button data-bc="back"' + (BC.busy ? ' disabled' : '') + '>← Back, keep editing</button></div></div>' + msg + list);
    return card('📣 Send to everyone', 'a message to every Oddable user', '<div id="odbf">'
      + '<label style="display:block;margin-top:2px"><span class="sub">Title</span><input id="odbt" maxlength="60" autocomplete="off" placeholder="Short title" value="' + esc(BC.title) + '" style="' + FIELD + '"></label><div class="sub" id="odbtc" style="text-align:right">' + BC.title.length + '/60</div>'
      + '<label style="display:block"><span class="sub">Message</span><textarea id="odbm" maxlength="240" rows="3" placeholder="What do you want to tell them?" style="' + FIELD + ';resize:vertical;min-height:84px">' + esc(BC.body) + '</textarea></label><div class="sub" id="odbmc" style="text-align:right">' + BC.body.length + '/240</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:10px"><label style="flex:1 1 150px;min-width:0"><span class="sub">Who</span><select id="odba" style="' + FIELD + '">' + opt(BCWHO, BC.aud) + '</select></label><label style="flex:1 1 150px;min-width:0"><span class="sub">Open to</span><select id="odbl" style="' + FIELD + '">' + opt(BCTO, BC.link) + '</select></label></div>'
      + '<div class="sub" style="margin:10px 0 2px">How it will look in the app</div><div id="odbpv"></div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"><button data-bc="test"' + (BC.busy ? ' disabled' : '') + '>Send test to my devices</button><button data-bc="ask" id="odbgo" style="background:#0b3d91;border-color:#0b3d91;color:#fff"' + (BC.busy ? ' disabled' : '') + '>' + esc(BC.busy && BC.counting ? 'Counting…' : BCGO[BC.aud]) + '</button><button data-bc="close"' + (BC.busy ? ' disabled' : '') + '>Close</button></div></div>' + msg + list);
  }
  function bcPreview() { // the very same card the phones draw (announce.js); plain text only
    const pv = document.getElementById('odbpv'); if (!pv) return; pv.textContent = '';
    const a = { id: 'preview', title: BC.title.trim() || 'Title', body: BC.body.trim() || 'Your message shows here.', link: BC.link ? BCURL[BC.link] : '', at: Date.now() };
    if (window.oddAnnCard) pv.appendChild(window.oddAnnCard(a, { open: false, dismiss: function () {} })); else { const d = document.createElement('div'); d.textContent = '📣 ' + a.title + ' — ' + a.body; pv.appendChild(d); }
  }
  const bcSay = (t, bad) => { BC.msg = t || ''; BC.bad = !!bad; const m = document.getElementById('odbs'); if (m) { m.textContent = BC.msg; m.style.color = BC.bad ? BAD : GOOD; } };
  function bcCheck() { if (!BC.title.trim()) { bcSay('Type a title.', true); return false; } if (BC.title.trim().length > 60) { bcSay('Keep the title to 60 characters or less.', true); return false; } if (!BC.body.trim()) { bcSay('Type a message.', true); return false; } if (BC.body.trim().length > 240) { bcSay('Keep the message to 240 characters or less.', true); return false; } return true; }
  async function bcSend(test) {
    if (BC.busy || !bcCheck()) return; BC.busy = true; BC.msg = test ? 'Sending the test…' : 'Sending…'; BC.bad = false; paint();
    const out = { title: BC.title.trim(), body: BC.body.trim(), audience: BC.aud }; if (BC.link) out.link = BC.link; if (test) out.test = true;
    try {
      const r = await fetch(API.replace('/dash', '/broadcast'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '', 'x-dash': g('odd-dt') || '' }, body: JSON.stringify(out) }); const j = await r.json().catch(() => ({}));
      if (r.status === 401 && j.need === 'owner-pin') { BC.busy = false; BC.msg = ''; NEEDPIN = true; D = null; paint(); return; }
      if (!r.ok || j.ok !== true) throw new Error(typeof j.error === 'string' && j.error ? j.error : 'Could not send (server said ' + r.status + ').');
      const P = typeof j.people === 'number' ? j.people : null, K = typeof j.devices === 'number' ? j.devices : null;
      if (test) { BC.msg = 'Test sent to your devices' + (K != null ? ': ' + plural(K, 'device') : '') + '.' + (K === 0 ? ' None of your devices has alerts turned on.' : ''); }
      else { const count = P != null && K != null ? ppl(P) + ', ' + plural(K, 'device') : P != null ? ppl(P) : K != null ? plural(K, 'device') : 'sent'; BC.sent.unshift({ title: out.title, aud: out.audience, at: Date.now(), count }); BC.msg = count === 'sent' ? 'Sent.' : 'Sent: ' + count + '.'; BC.title = ''; BC.body = ''; BC.link = ''; BC.aud = 'all'; BC.step = 'edit'; BC.open = false; }
    } catch (e) { BC.bad = true; BC.msg = (e && e.message === 'Failed to fetch') ? 'Could not reach the server. Nothing was sent; try again in a few seconds.' : (e.message || 'Could not send.'); if (!test) BC.step = 'edit'; }
    BC.busy = false; paint();
  }
  // "Send to everyone" tapped: count first (nothing is sent), then open the confirm step. limit / dup / contact / a 400 = the server's sentence and no confirm step.
  // No count to be had (an older My Apps = "nodry", server or network trouble) = the confirm step without a number.
  async function bcCount() {
    if (BC.busy || !bcCheck()) return; BC.busy = true; BC.counting = true; BC.dry = null; BC.msg = 'Counting who gets it…'; BC.bad = false; paint();
    const out = { title: BC.title.trim(), body: BC.body.trim(), audience: BC.aud, dry: true }; if (BC.link) out.link = BC.link;
    let stop = '';
    try {
      const r = await fetch(API.replace('/dash', '/broadcast'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '', 'x-dash': g('odd-dt') || '' }, body: JSON.stringify(out) }); const j = await r.json().catch(() => ({}));
      if (r.status === 401 && j.need === 'owner-pin') { BC.busy = false; BC.counting = false; BC.msg = ''; NEEDPIN = true; D = null; paint(); return; }
      if (r.ok && j.ok === true && j.dry === true && typeof j.people === 'number' && j.people >= 0) { const num = (v) => (typeof v === 'number' && v >= 0 ? v : null); BC.dry = { people: j.people, alerts: num(j.alerts), devices: num(j.devices), left: num(j.left) }; }
      else if (r.status === 400 || r.status === 401 || r.status === 403 || j.code === 'limit' || j.code === 'dup' || j.code === 'contact' || j.code === 'drysent') stop = typeof j.error === 'string' && j.error ? j.error : 'Could not send (server said ' + r.status + ').';
    } catch (e) {}
    BC.busy = false; BC.counting = false;
    if (stop) { BC.step = 'edit'; BC.msg = stop; BC.bad = true; paint(); return; }
    BC.step = 'confirm'; BC.msg = ''; paint(); const c = document.getElementById('odbc'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' });
  }
  function bcTap(k) {
    if (BC.busy) return;
    if (k === 'open') { BC.open = true; BC.step = 'edit'; BC.msg = ''; paint(); const t = document.getElementById('odbt'); if (t) t.focus(); return; }
    if (k === 'close') { BC.open = false; BC.step = 'edit'; BC.msg = ''; paint(); return; }
    if (k === 'back') { BC.step = 'edit'; BC.msg = ''; paint(); return; }
    if (k === 'test') { bcSend(true); return; }
    if (k === 'ask') { bcCount(); return; }
    if (k === 'yes') { bcSend(false); }
  }
  const TITLE = { games: 'Bets', home: 'Dashboard', users: 'Players', rank: 'Win %', days: 'Days', open: 'Open bets', day: 'Day', user: 'Player' };

  function paint() {
    const el = document.getElementById('odash'); if (!el) return; const s = stack[stack.length - 1];
    if (NEEDPIN) { el.querySelector('.odb').innerHTML = '<div class="odc"><h3>Owner PIN</h3><div class="sub" style="margin-bottom:8px">One more check for this device (kept 30 days). Enter your owner PIN.</div><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="oddpin" type="password" inputmode="numeric" autocomplete="off" placeholder="Owner PIN" style="flex:1;min-width:160px;min-height:44px;padding:6px 10px;border-radius:10px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);color:var(--ink,#eee);font:15px inherit"><button data-unlock="1">Unlock</button></div><div class="sub" id="oddps"></div></div>'; el.querySelector('.odt1').textContent = 'Dashboard'; el.querySelector('.odback').style.visibility = 'hidden'; return; }
    let body = err ? '<div class="odc" style="color:' + BAD + '">' + esc(err) + '</div>' : !D ? '<div class="odc">Loading players…</div>' : s.t === 'home' ? home() : s.t === 'users' ? users() : s.t === 'rank' ? rankV() : s.t === 'days' ? daysV() : s.t === 'open' ? openV() : s.t === 'day' ? dayV(s.v) : s.t === 'user' ? userV(s.v) : s.t === 'games' ? gamesV() : '';
    el.querySelector('.odb').innerHTML = body; el.querySelector('.odt1').textContent = s.t === 'user' ? (((D && D.users) || []).filter((x) => x.k === s.v).map(nm)[0] || 'Player') : s.t === 'day' ? s.v : TITLE[s.t];
    el.querySelector('.odback').style.visibility = stack.length > 1 ? 'visible' : 'hidden'; bcPreview();
  }
  function go(v) { if (v === 'gw' || v === 'gl') { GF = v === 'gw' ? 'won' : 'lost'; v = 'games'; } else if (v === 'games') GF = 'all'; stack.push(v === 'users' || v === 'rank' || v === 'days' || v === 'open' || v === 'games' ? { t: v } : /^u:/.test(v) ? { t: 'user', v: v.slice(2) } : /^\d{4}-\d{2}-\d{2}$/.test(v) ? { t: 'day', v } : null); if (!stack[stack.length - 1]) stack.pop(); paint(); el().scrollTop = 0; }
  const el = () => document.getElementById('odash');
  async function load(force) {
    if (busy || (!force && D && Date.now() - DT < 60000)) return; busy = true; err = '';
    try { const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '', 'x-dash': g('odd-dt') || '' }, body: '{}' }); const j = await r.json().catch(() => ({})); NEEDPIN = r.status === 401 && j.need === 'owner-pin'; if (NEEDPIN) { err = ''; D = null; busy = false; paint(); return; } if (!r.ok) throw new Error(j.error || 'Server said ' + r.status); D = j; DT = Date.now(); } catch (e) { err = (e && e.message === 'Failed to fetch') ? 'Could not reach the server. It may be waking up; tap refresh in a few seconds.' : (e.message || 'Error'); }
    busy = false; paint();
  }
  async function unlock() {
    const inp = document.getElementById('oddpin'), msg = document.getElementById('oddps'); if (!inp || !inp.value) return; if (msg) msg.textContent = 'Checking…';
    try { const r = await fetch(API.replace('/dash', '/dunlock'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: JSON.stringify({ pin: inp.value }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Server said ' + r.status);
      try { localStorage.setItem('odd-dt', j.dash); } catch (e) {} NEEDPIN = false; load(true); }
    catch (e) { if (msg) msg.textContent = (e && e.message === 'Failed to fetch') ? 'Could not reach the server, try again.' : (e.message || 'Error'); }
  }
  async function saveName(k) {
    const inp = document.getElementById('oddn'), msg = document.getElementById('oddns'); if (!inp) return; const name = inp.value.trim(); if (msg) msg.textContent = 'Saving…';
    try { const r = await fetch(API.replace('/dash', '/name'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '', 'x-dash': g('odd-dt') || '' }, body: JSON.stringify({ k, name }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Server said ' + r.status);
      const u = (D.users || []).find((x) => x.k === k); if (u) u.name = j.name || ''; paint(); const m2 = document.getElementById('oddns'); if (m2) m2.textContent = j.name ? 'Saved' : 'Name cleared'; }
    catch (e) { if (msg) msg.textContent = (e && e.message === 'Failed to fetch') ? 'Could not reach the server, try again in a few seconds.' : (e.message || 'Error'); }
  }
  function css() {
    if (document.getElementById('odcss')) return; const st = document.createElement('style'); st.id = 'odcss';
    st.textContent = '#odash{position:fixed;inset:0;overscroll-behavior:contain;z-index:90;background:var(--bg,#0b1020);color:var(--ink,#eee);overflow:auto;-webkit-overflow-scrolling:touch;padding:0 12px 40px;font:15px/1.35 system-ui}#odash .odh{position:sticky;top:0;background:var(--bg,#0b1020);display:flex;align-items:center;gap:8px;padding:max(10px,env(safe-area-inset-top)) 0 8px;z-index:2}#odash .odh b{flex:1;font-size:18px}#odash button{min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);color:var(--ink,#eee);font:700 14px inherit}#odash .odch{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}#odash .odch button.on{background:#0b3d91;border-color:#0b3d91;color:#fff}#odash .odg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 12px}#odash .odt{background:var(--panel,#121a33);border:1px solid var(--line,#fff2);border-radius:14px;padding:12px;min-height:44px;cursor:pointer}#odash .odt .v{font-size:24px;font-weight:800}#odash .odt .l,#odash .sub{font-size:12px;opacity:.7}#odash .odc{background:var(--panel,#121a33);border:1px solid var(--line,#fff2);border-radius:14px;padding:12px;margin:0 0 12px}#odash .odc h3{margin:0 0 8px;font-size:16px}#odash .odr{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #8883;min-height:44px}#odash .odr:first-of-type{border-top:0}';
    document.head.appendChild(st);
  }
  window.oddDash = function () {
    css(); DAYSEL = ''; let e = el(); if (e) e.remove(); e = document.createElement('div'); e.id = 'odash';
    e.innerHTML = '<div class="odh"><button class="odback" style="visibility:hidden">← Back</button><b class="odt1">Dashboard</b><button class="odref">Refresh</button><button class="odx">Close</button></div><div class="odb"></div>';
    document.body.appendChild(e); try { sessionStorage.setItem('odash-open', '1'); } catch (x) {} stack = [{ t: 'home' }]; P = 'all';
    e.onclick = (ev) => { const t = ev.target; const x = t.closest && t.closest('[data-go]'), pb = t.closest && t.closest('[data-p]');
      if (t.closest('.odx')) { try { sessionStorage.removeItem('odash-open'); } catch (x) {} e.remove(); return; } if (t.closest('.odback')) { if (stack.length > 1) stack.pop(); paint(); return; } if (t.closest('.odref')) { load(true); return; }
      if (t.closest && t.closest('[data-unlock]')) { unlock(); return; }
      const bcb = t.closest && t.closest('[data-bc]'); if (bcb) { bcTap(bcb.getAttribute('data-bc')); return; }
      const sv = t.closest && t.closest('[data-save]'); if (sv) { saveName(sv.getAttribute('data-save')); return; }
      const gfb = t.closest && t.closest('[data-gf]'); if (gfb) { GF = gfb.getAttribute('data-gf'); paint(); return; } if (pb) { P = pb.getAttribute('data-p'); if (P === 'day' && !DAYSEL) DAYSEL = today(); paint(); return; } if (x) { const v = x.getAttribute('data-go'); if (v) go(v); } };
    e.oninput = (ev) => { const t = ev.target; if (!t) return; if (t.id === 'odbt') { BC.title = t.value.slice(0, 60); const c = document.getElementById('odbtc'); if (c) c.textContent = BC.title.length + '/60'; } else if (t.id === 'odbm') { BC.body = t.value.slice(0, 240); const c = document.getElementById('odbmc'); if (c) c.textContent = BC.body.length + '/240'; } else return; if (BC.msg) bcSay(''); bcPreview(); };
    e.onchange = (ev) => { const t0 = ev.target; if (t0 && t0.id === 'odba' && BCWHO[t0.value]) { BC.aud = t0.value; const b = document.getElementById('odbgo'); if (b) b.textContent = BCGO[BC.aud]; return; } if (t0 && t0.id === 'odbl' && Object.prototype.hasOwnProperty.call(BCTO, t0.value)) { BC.link = t0.value; bcPreview(); return; } if (ev.target && ev.target.id === 'oddd' && /^\d{4}-\d{2}-\d{2}$/.test(ev.target.value)) { DAYSEL = ev.target.value; paint(); } };
    paint(); load(true);
  };
  // If the page reloads while the dashboard is open (app update, sync, phone waking the app), put it back instead of dropping the owner on the main screen.
  try { if (sessionStorage.getItem('odash-open') === '1') setTimeout(() => { if (!document.getElementById('odash') && window.oddDash && g('odd-tok')) window.oddDash(); }, 1500); } catch (e) {}
})();
