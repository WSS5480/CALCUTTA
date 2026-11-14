// Oddable owner dashboard. Only shown after signing in with the owner PIN (token e='owner'); the server refuses everyone else.
// Phones are never available: players show as short ids. Graphs are tappable; every tile and graph drills down, with a back button.
(function () {
  const API = 'https://calcutta-odds.onrender.com/acct/dash';
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
  const GOOD = '#2ecc71', BAD = '#ff6b6b', BLUE = '#4f8cff';
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  let D = null, DT = 0, P = 'all', stack = [{ t: 'home' }], busy = false, err = '';

  function from(p) {
    const td = today(); if (p === 'all') return '';
    if (p === 'ytd') return td.slice(0, 4) + '-01-01'; if (p === 'mtd') return td.slice(0, 7) + '-01';
    const d = new Date(td + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10);
  }
  const PN = { wtd: 'This week', mtd: 'This month', ytd: 'This year', all: 'Lifetime' };
  const rows = (u) => { const f = from(P); return (u.days || []).filter((d) => !f || d.day >= f); };
  const sum = (ds) => { const r = { n: 0, w: 0, l: 0, p: 0, risk: 0, pl: 0 }; ds.forEach((d) => { r.n += d.n; r.w += d.w; r.l += d.l; r.p += d.p || 0; r.risk += d.risk; r.pl += d.pl; }); r.pct = r.w + r.l ? Math.round((r.w / (r.w + r.l)) * 1000) / 10 : null; return r; };
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
  const chips = () => '<div class="odch">' + [['wtd', 'WTD'], ['mtd', 'MTD'], ['ytd', 'YTD'], ['all', 'Lifetime']].map(([k, t]) => '<button data-p="' + k + '"' + (k === P ? ' class="on"' : '') + '>' + t + '</button>').join('') + '</div>';
  const openRow = (b, who) => '<div class="odr"><div><b>' + esc(b.what) + '</b><div class="sub">' + (who ? 'Player ····' + esc(who) + ' · ' : '') + esc(b.day || '') + (b.odds ? ' · ' + (b.odds > 0 ? '+' : '') + b.odds : '') + '</div></div><div>$' + esc(Math.round(b.stake * 100) / 100) + '<div class="sub">risk</div></div></div>';
  const userRow = (u) => { const a = agU(u); return '<div class="odr" data-go="u:' + esc(u.k) + '" style="cursor:pointer"><div><b>Player ····' + esc(u.tag) + '</b><div class="sub">' + a.n + ' bets · ' + a.w + '-' + a.l + (a.p ? '-' + a.p : '') + ' · ' + (u.open || []).length + ' open</div></div><div style="text-align:right;color:' + (a.pl >= 0 ? GOOD : BAD) + '">' + money(a.pl) + '<div class="sub">' + sh(a.pct) + ' win</div></div></div>'; };
  const dayRow = (d) => '<div class="odr" data-go="' + esc(d.day) + '" style="cursor:pointer"><div><b>' + esc(d.day) + '</b><div class="sub">' + d.n + ' bets · ' + d.w + '-' + d.l + '</div></div><div style="color:' + (d.pl >= 0 ? GOOD : BAD) + '">' + money(d.pl) + '</div></div>';

  function home() {
    const U = D.users || [], all = sum(U.flatMap(rows)), days = byDay(), OPN = U.reduce((n, u) => n + (u.open || []).length, 0), act = U.filter((u) => Date.now() - u.updated < 7 * 864e5).length;
    const rank = U.map((u) => [u, agU(u)]).filter(([, a]) => a.w + a.l > 0).sort((x, y) => (y[1].pct || 0) - (x[1].pct || 0));
    return chips() + '<div class="odg">' + tile('users', U.length, 'Players') + tile('days', all.n, 'Bets · ' + PN[P]) + tile('rank', sh(all.pct), 'Win % (' + all.w + '-' + all.l + ')') + tile('days', money(all.pl), 'Players\' P/L', all.pl >= 0 ? GOOD : BAD) + tile('open', OPN, 'Open bets now') + tile('users', act, 'Active this week') + '</div>'
      + card('Profit and loss by day', 'all players · tap a bar', bars(days, (d) => d.pl, (d) => d.day))
      + card('Running total', 'tap to open a day', line(days))
      + card('Bets per day', 'tap a bar', bars(days, (d) => d.n, (d) => d.day, BLUE))
      + card('Win % by player', 'tap a player', hbars(rank, (x) => 'Player ····' + x[0].tag, (x) => x[1].pct || 0, (x) => sh(x[1].pct) + ' · ' + x[1].w + '-' + x[1].l, (x) => 'u:' + x[0].k));
  }
  function users() { const U = (D.users || []).slice().sort((a, b) => agU(b).pl - agU(a).pl); return card('Players', PN[P] + ' · best P/L first', U.length ? U.map(userRow).join('') : '<div class="sub">No players yet.</div>'); }
  function rankV() { const U = (D.users || []).map((u) => [u, agU(u)]).filter(([, a]) => a.w + a.l > 0).sort((x, y) => (y[1].pct || 0) - (x[1].pct || 0)); return card('Win % by player', PN[P], U.length ? U.map(([u]) => userRow(u)).join('') : '<div class="sub">No settled bets in this period.</div>'); }
  function daysV() { const d = byDay().reverse(); return card('Every finished day', PN[P] + ' · newest first', d.length ? d.map(dayRow).join('') : '<div class="sub">None yet. Today counts after midnight.</div>'); }
  function openV() { const U = (D.users || []).filter((u) => (u.open || []).length), n = U.reduce((a, u) => a + u.open.length, 0); return card('Open bets, all players', n + ' not settled yet', n ? U.map((u) => u.open.map((b) => openRow(b, u.tag)).join('')).join('') : '<div class="sub">No open bets.</div>'); }
  function dayV(day) {
    const list = (D.users || []).map((u) => [u, (u.days || []).find((d) => d.day === day)]).filter((x) => x[1]).sort((a, b) => b[1].pl - a[1].pl), t = sum(list.map((x) => x[1]));
    return '<div class="odg">' + tile('', t.n, 'Bets') + tile('', t.w + '-' + t.l, 'Record') + tile('', money(t.pl), 'P/L', t.pl >= 0 ? GOOD : BAD) + '</div>'
      + card(esc(day), 'who bet that day · tap a player', list.length ? list.map(([u, d]) => '<div class="odr" data-go="u:' + esc(u.k) + '" style="cursor:pointer"><div><b>Player ····' + esc(u.tag) + '</b><div class="sub">' + d.n + ' bets · ' + d.w + '-' + d.l + '</div></div><div style="color:' + (d.pl >= 0 ? GOOD : BAD) + '">' + money(d.pl) + '</div></div>').join('') : '<div class="sub">No finished bets that day.</div>');
  }
  function userV(k) {
    const u = (D.users || []).find((x) => x.k === k); if (!u) return '<div class="odc">Player not found.</div>';
    const a = agU(u), ds = rows(u).slice().sort((x, y) => (x.day < y.day ? -1 : 1));
    return chips() + '<div class="odg">' + tile('', a.n, 'Bets · ' + PN[P]) + tile('', a.w + '-' + a.l + (a.p ? '-' + a.p : ''), 'Record') + tile('', sh(a.pct), 'Win %') + tile('', money(a.pl), 'Settled P/L', a.pl >= 0 ? GOOD : BAD) + tile('', (u.open || []).length, 'Open bets') + tile('', money(a.risk), 'Risked') + '</div>'
      + card('Profit and loss by day', 'tap a bar', bars(ds, (d) => d.pl, (d) => d.day))
      + card('Current bets', 'not settled yet', (u.open || []).length ? u.open.map((b) => openRow(b)).join('') : '<div class="sub">No open bets.</div>')
      + card('By day', PN[P] + ' · newest first', ds.length ? ds.slice().reverse().map(dayRow).join('') : '<div class="sub">No finished days in this period.</div>');
  }
  const TITLE = { home: 'Dashboard', users: 'Players', rank: 'Win %', days: 'Days', open: 'Open bets', day: 'Day', user: 'Player' };

  function paint() {
    const el = document.getElementById('odash'); if (!el) return; const s = stack[stack.length - 1];
    let body = err ? '<div class="odc" style="color:' + BAD + '">' + esc(err) + '</div>' : !D ? '<div class="odc">Loading players…</div>' : s.t === 'home' ? home() : s.t === 'users' ? users() : s.t === 'rank' ? rankV() : s.t === 'days' ? daysV() : s.t === 'open' ? openV() : s.t === 'day' ? dayV(s.v) : s.t === 'user' ? userV(s.v) : '';
    el.querySelector('.odb').innerHTML = body; el.querySelector('.odt1').textContent = s.t === 'user' ? 'Player ····' + ((D && (D.users || []).find((x) => x.k === s.v) || {}).tag || '') : s.t === 'day' ? s.v : TITLE[s.t];
    el.querySelector('.odback').style.visibility = stack.length > 1 ? 'visible' : 'hidden';
  }
  function go(v) { stack.push(v === 'users' || v === 'rank' || v === 'days' || v === 'open' ? { t: v } : /^u:/.test(v) ? { t: 'user', v: v.slice(2) } : /^\d{4}-\d{2}-\d{2}$/.test(v) ? { t: 'day', v } : null); if (!stack[stack.length - 1]) stack.pop(); paint(); el().scrollTop = 0; }
  const el = () => document.getElementById('odash');
  async function load(force) {
    if (busy || (!force && D && Date.now() - DT < 60000)) return; busy = true; err = '';
    try { const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': g('odd-tok') || '' }, body: '{}' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Server said ' + r.status); D = j; DT = Date.now(); } catch (e) { err = (e && e.message === 'Failed to fetch') ? 'Could not reach the server. It may be waking up; tap refresh in a few seconds.' : (e.message || 'Error'); }
    busy = false; paint();
  }
  function css() {
    if (document.getElementById('odcss')) return; const st = document.createElement('style'); st.id = 'odcss';
    st.textContent = '#odash{position:fixed;inset:0;z-index:90;background:var(--bg,#0b1020);color:var(--ink,#eee);overflow:auto;-webkit-overflow-scrolling:touch;padding:0 12px 40px;font:15px/1.35 system-ui}#odash .odh{position:sticky;top:0;background:var(--bg,#0b1020);display:flex;align-items:center;gap:8px;padding:max(10px,env(safe-area-inset-top)) 0 8px;z-index:2}#odash .odh b{flex:1;font-size:18px}#odash button{min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid var(--line,#fff3);background:var(--panel2,#1a2340);color:var(--ink,#eee);font:700 14px inherit}#odash .odch{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}#odash .odch button.on{background:#0b3d91;border-color:#0b3d91;color:#fff}#odash .odg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 12px}#odash .odt{background:var(--panel,#121a33);border:1px solid var(--line,#fff2);border-radius:14px;padding:12px;min-height:44px;cursor:pointer}#odash .odt .v{font-size:24px;font-weight:800}#odash .odt .l,#odash .sub{font-size:12px;opacity:.7}#odash .odc{background:var(--panel,#121a33);border:1px solid var(--line,#fff2);border-radius:14px;padding:12px;margin:0 0 12px}#odash .odc h3{margin:0 0 8px;font-size:16px}#odash .odr{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #8883;min-height:44px}#odash .odr:first-of-type{border-top:0}';
    document.head.appendChild(st);
  }
  window.oddDash = function () {
    css(); let e = el(); if (e) e.remove(); e = document.createElement('div'); e.id = 'odash';
    e.innerHTML = '<div class="odh"><button class="odback" style="visibility:hidden">← Back</button><b class="odt1">Dashboard</b><button class="odref">Refresh</button><button class="odx">Close</button></div><div class="odb"></div>';
    document.body.appendChild(e); stack = [{ t: 'home' }]; P = 'all';
    e.onclick = (ev) => { const t = ev.target; const x = t.closest && t.closest('[data-go]'), pb = t.closest && t.closest('[data-p]');
      if (t.closest('.odx')) { e.remove(); return; } if (t.closest('.odback')) { if (stack.length > 1) stack.pop(); paint(); return; } if (t.closest('.odref')) { load(true); return; }
      if (pb) { P = pb.getAttribute('data-p'); paint(); return; } if (x) { const v = x.getAttribute('data-go'); if (v) go(v); } };
    paint(); load(true);
  };
})();
