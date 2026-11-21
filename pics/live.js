// Oddable live game view (Gamecast): free ESPN game feed (score, clock, play-by-play, win chance, stats) + status of your bets on the game.
// v296: where to watch, ⭐ follow buttons (myteams.js), the win-probability LINE over the game, game leaders, scoring plays; opens before tip-off too.
(function () {
  const BASE = 'https://site.api.espn.com/apis/site/v2/sports/';
  let ov = null, timer = null, cur = null, last = '', busy = false;
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = document.createElement('style');
  css.textContent = '#lvov .lvtv{margin:10px 0 6px;font-weight:700;text-align:center}#lvov .lvfv{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin:0 0 8px}#lvov .lvfv button{min-height:42px;border-radius:12px;border:1px solid #8886;background:#ffffff0d;color:inherit;font:700 14px system-ui;cursor:pointer}#lvov .lvfv button.on{border-color:#f5c542;background:#f5c54222}#lvov .lvld{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px 12px}#lvov .lvld div{overflow-wrap:anywhere}#lvov .lvld small{display:block;opacity:.7;font-size:12px}#lvov{position:fixed;inset:0;z-index:150;background:var(--bg,#0b1220);color:var(--ink,#fff);overflow:auto;-webkit-overflow-scrolling:touch;padding:max(10px,env(safe-area-inset-top)) 14px 120px}#lvov .lvh{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0 8px}#lvov .lvh button{border:0;border-radius:10px;padding:9px 14px;font:700 14px system-ui;background:var(--panel2,#1b2740);color:inherit}#lvov .sb{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;text-align:center;gap:8px;background:var(--panel,#141d30);border:1px solid var(--line,#33415c);border-radius:16px;padding:14px 8px}#lvov .sb img{width:46px;height:46px;object-fit:contain}#lvov .sb .sc{font:800 40px system-ui}#lvov .sb .nm{font:700 14px system-ui}#lvov .sb .rc{font:12px system-ui;opacity:.7}#lvov .mid{font:700 14px system-ui}#lvov .mid small{display:block;font-weight:600;opacity:.75;margin-top:3px}#lvov .dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#e5484d;margin-right:5px;animation:lvp 1.2s infinite}@keyframes lvp{50%{opacity:.25}}#lvov .wp{display:flex;height:12px;border-radius:7px;overflow:hidden;margin:10px 0 3px;background:#334}#lvov .wp i{display:block}#lvov .wpl{display:flex;justify-content:space-between;font:12px system-ui;opacity:.85}#lvov h3{font:800 13px system-ui;letter-spacing:.06em;text-transform:uppercase;opacity:.75;margin:16px 2px 6px}#lvov .bt{border:1px solid var(--line,#33415c);background:var(--panel,#141d30);border-radius:12px;padding:10px 12px;margin:6px 0;font:14px system-ui}#lvov .bt b.w{color:var(--green,#34c77b)}#lvov .bt b.l{color:var(--red,#ff6b6b)}#lvov .pl{display:flex;gap:10px;padding:9px 4px;border-bottom:1px solid var(--line,#33415c);font:14px/1.35 system-ui}#lvov .pl .t{min-width:62px;font:600 12px system-ui;opacity:.7;padding-top:1px}#lvov .pl.sc{background:rgba(245,197,66,.14);border-radius:8px}#lvov .pl .s{margin-left:auto;font:700 12px system-ui;white-space:nowrap;opacity:.9}#lvov .st{display:grid;grid-template-columns:1fr auto 1fr;gap:4px 10px;font:14px system-ui;margin:2px 4px}#lvov .st span:nth-child(3n+2){opacity:.65;text-align:center;font-size:12px}#lvov .st span:nth-child(3n){text-align:right}#lvov .no{opacity:.7;font:14px system-ui;padding:8px 2px}.livebtn{border:1px solid var(--line,#33415c)!important}';
  document.head.appendChild(css);
  const num = (x) => (x == null || x === '' ? null : +x);
  function plays(j) {
    let a = Array.isArray(j.plays) ? j.plays.slice() : [];
    if (!a.length && j.drives) { [].concat(j.drives.previous || [], j.drives.current ? [j.drives.current] : []).forEach((d) => (d.plays || []).forEach((p) => a.push(p))); }
    return a.filter((p) => p && (p.text || p.shortText)).slice(-60).reverse();
  }
  function betsFor(gid, hs, as, home, away) {
    let bets = []; try { bets = JSON.parse(g('bets26')) || []; } catch (e) {}
    const out = [];
    const judge = (l) => {
      const type = l.type, side = String(l.side || '').toUpperCase(), line = +l.line || 0;
      const total = hs + as;
      if (type === 'ml') { const mine = side === home ? hs : as, theirs = side === home ? as : hs; return mine > theirs ? 1 : mine < theirs ? -1 : 0; }
      if (type === 'sp') { const mine = (side === home ? hs : as) + line, theirs = side === home ? as : hs; return mine > theirs ? 1 : mine < theirs ? -1 : 0; }
      if (type === 'ou' || type === 'tot') { const over = /^O/.test(side); return total === line ? 0 : (over ? total > line : total < line) ? 1 : -1; }
      return null;
    };
    const lab = (l) => (l.type === 'ml' ? l.side + ' to win' : l.type === 'sp' ? l.side + ' ' + (l.line > 0 ? '+' : '') + l.line : /^O/i.test(l.side || '') ? 'Over ' + l.line : 'Under ' + l.line);
    bets.forEach((b) => { const legs = b.kind === 'parlay' ? (b.legs || []) : [b]; legs.forEach((l) => { if (l && String(l.gid) === String(gid)) { const j = judge(l); out.push({ txt: lab(l), stake: b.stake, parlay: b.kind === 'parlay', j }); } }); });
    return out;
  }
  // v296 win-probability line (ESPN's play-by-play numbers), drawn small: no library
  function wpLine(arr, ha, aa) {
    let v = (arr || []).map((x) => { const p = Number(x && x.homeWinPercentage); return p > 1 ? p / 100 : p; }).filter((p) => p >= 0 && p <= 1); if (v.length < 2) return '';
    if (v.length > 240) { const k = Math.ceil(v.length / 240); v = v.filter((x, i) => i % k === 0 || i === v.length - 1); }
    const W = 320, H = 110, n = v.length, pt = v.map((p, i) => [(i / (n - 1)) * W, (1 - p) * H]), d = pt.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return `<svg viewBox="0 0 ${W} ${H + 4}" width="100%" style="display:block;margin-top:8px" role="img" aria-label="Win probability over the game"><rect width="${W}" height="${H}" rx="8" fill="#ffffff08"/><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#8b93a355" stroke-dasharray="4 4"/><path d="${d}" fill="none" stroke="#a78bfa" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${pt[n - 1][0].toFixed(1)}" cy="${pt[n - 1][1].toFixed(1)}" r="4" fill="#a78bfa"/><text x="4" y="13" fill="#8b93a3" font-size="11">${esc(ha)}</text><text x="4" y="${H - 4}" fill="#8b93a3" font-size="11">${esc(aa)}</text></svg>`;
  }
  function paint(j) {
    const h = j.header && j.header.competitions && j.header.competitions[0]; if (!h) return '<div class="no">Game data is not available yet.</div>';
    const cs = h.competitors || [], H = cs.find((c) => c.homeAway === 'home') || cs[1], A = cs.find((c) => c.homeAway === 'away') || cs[0];
    const st = h.status || {}, ty = st.type || {}, live = ty.state === 'in', pre = ty.state === 'pre';
    const hs = num(H.score) || 0, as = num(A.score) || 0;
    const side = (c, sc) => `<div>${c.team && c.team.logo ? `<img src="${esc(c.team.logo)}" alt="">` : ''}<div class="nm">${esc(c.team.shortDisplayName || c.team.abbreviation)}</div><div class="rc">${esc((c.record && c.record[0] && c.record[0].summary) || (c.records && c.records[0] && c.records[0].summary) || '')}</div><div class="sc">${pre ? '' : sc}</div></div>`;
    const wpA = j.winprobability && j.winprobability.length ? j.winprobability[j.winprobability.length - 1] : null;
    const hp = wpA ? Math.round(wpA.homeWinPercentage * (wpA.homeWinPercentage <= 1 ? 100 : 1)) : null;
    const wp = hp !== null ? wpLine(j.winprobability, H.team.abbreviation, A.team.abbreviation) + `<div class="wp"><i style="width:${100 - hp}%;background:#7c6ad8"></i><i style="width:${hp}%;background:#4fd18b"></i></div><div class="wpl"><span>${esc(A.team.abbreviation)} ${100 - hp}%</span><span>Win chance (ESPN)</span><span>${hp}% ${esc(H.team.abbreviation)}</span></div>` : '';
    const sit = j.situation && (j.situation.downDistanceText || j.situation.shortDownDistanceText) ? `<div class="mid" style="margin-top:8px;text-align:center">${esc(j.situation.downDistanceText || j.situation.shortDownDistanceText)}${j.situation.possessionText ? ' · ' + esc(j.situation.possessionText) : ''}</div>` : '';
    const bts = betsFor(cur.gid, hs, as, H.team.abbreviation, A.team.abbreviation);
    const btH = bts.length ? '<h3>My bets on this game</h3>' + bts.map((b) => `<div class="bt">${b.parlay ? '🎟 Parlay leg · ' : ''}<b>${esc(b.txt)}</b>${b.stake ? ' · $' + esc(b.stake) : ''} — ${b.j === 1 ? '<b class="w">winning now</b>' : b.j === -1 ? '<b class="l">losing now</b>' : b.j === 0 ? 'tied right now' : 'status n/a'}${ty.completed ? ' (final)' : ''}</div>`).join('') : '';
    const pl = plays(j), plH = pl.length ? pl.map((p) => { const t = (p.clock && p.clock.displayValue) || (p.period && p.period.displayValue) || '', per = p.period && p.period.number ? 'P' + p.period.number + ' ' : ''; return `<div class="pl ${p.scoringPlay ? 'sc' : ''}"><span class="t">${esc(per + t)}</span><span>${esc(p.text || p.shortText)}</span>${p.scoringPlay && p.awayScore != null ? `<span class="s">${esc(p.awayScore)}-${esc(p.homeScore)}</span>` : ''}</div>`; }).join('') : `<div class="no">${pre ? 'Play-by-play starts when the game does.' : 'No plays yet.'}</div>`;
    let stH = ''; const bx = j.boxscore && j.boxscore.teams; if (bx && bx.length === 2) { const aT = bx.find((t) => t.homeAway === 'away') || bx[0], hT = bx.find((t) => t.homeAway === 'home') || bx[1], hm = {}; (hT.statistics || []).forEach((s) => (hm[s.name] = s)); const rows = (aT.statistics || []).filter((s) => hm[s.name]).slice(0, 8).map((s) => `<span>${esc(s.displayValue)}</span><span>${esc(s.label || s.name)}</span><span>${esc(hm[s.name].displayValue)}</span>`).join(''); if (rows) stH = '<h3>Team stats</h3><div class="st">' + rows + '</div>'; }
    // v296: where to watch, follow, leaders, scoring plays
    const lg = window.OddFav ? window.OddFav.lgOf(cur.path) : '', nets = (cur.tv && cur.tv.length ? cur.tv : window.OddFav ? window.OddFav.tv(h) : []);
    const tvH = `<div class="lvtv">📺 ${nets.length ? esc(nets.join(' · ')) : ty.completed ? 'Final' : 'Network not listed'}</div>`;
    const favH = lg && window.OddFav ? `<div class="lvfv">${[A, H].map((c) => { const ab = c.team.abbreviation, on = window.OddFav.isFav(lg, ab); return `<button type="button" data-fav="${esc(ab)}" class="${on ? 'on' : ''}" aria-pressed="${on}">${on ? '⭐ Following' : '☆ Follow'} ${esc(ab)}</button>`; }).join('')}</div>` : '';
    let ldH = ''; const L = j.leaders || [], lA = L.find((x) => x.team && x.team.abbreviation === A.team.abbreviation), lH = L.find((x) => x.team && x.team.abbreviation === H.team.abbreviation);
    if (lA && lH) { const one = (c) => { const p = c && c.leaders && c.leaders[0]; return p ? `<b>${esc(p.displayValue)}</b><small>${esc((p.athlete && (p.athlete.shortName || p.athlete.displayName)) || '')}</small>` : '<small>–</small>'; }; const rows = (lA.leaders || []).slice(0, 4).map((c) => { const o = (lH.leaders || []).find((z) => z.name === c.name); return `<div><small>${esc(c.displayName)} · ${esc(A.team.abbreviation)}</small>${one(c)}</div><div><small>${esc(c.displayName)} · ${esc(H.team.abbreviation)}</small>${one(o)}</div>`; }).join(''); if (rows) ldH = '<h3>Leaders</h3><div class="lvld">' + rows + '</div>'; }
    const scp = /basketball/.test(cur.path) ? [] : (Array.isArray(j.plays) ? j.plays : []).filter((p) => p && p.scoringPlay && p.text).slice(-10).reverse();
    const scH = scp.length ? '<h3>Scoring</h3>' + scp.map((p) => `<div class="pl sc"><span class="t">${esc((p.period && p.period.number ? 'P' + p.period.number + ' ' : '') + ((p.clock && p.clock.displayValue) || ''))}</span><span>${esc(p.text)}</span>${p.awayScore != null ? `<span class="t">${esc(A.team.abbreviation)} ${esc(p.awayScore)}–${esc(p.homeScore)} ${esc(H.team.abbreviation)}</span>` : ''}</div>`).join('') : '';
    const preH = pre ? `<div class="no">Starts ${esc(new Date(h.date || Date.now()).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}. Plays, stats, leaders and the win-chance line show up here once it starts; this page updates by itself.</div>` : '';
    return `<div class="sb">${side(A, as)}<div class="mid">${live ? '<span class="dot"></span>LIVE' : ''}<br>${esc(st.displayClock && live ? st.displayClock : '')}<small>${esc(ty.shortDetail || ty.detail || '')}</small></div>${side(H, hs)}</div>${tvH}${favH}${wp}${sit}${btH}${preH}${scH}${pl.length ? '<h3>Play by play</h3>' + plH : ''}${ldH}${stH}`;
  }
  async function load() {
    if (!cur || busy) return; busy = true;
    try {
      const r = await fetch(BASE + cur.path + '/summary?event=' + encodeURIComponent(cur.gid), { cache: 'no-store' }); if (!r.ok) throw new Error('feed ' + r.status);
      const j = await r.json(), html = paint(j), body = document.getElementById('lvbody');
      if (body && html !== last) { const y = ov.scrollTop; body.innerHTML = html; last = html; ov.scrollTop = y; }
      const u = document.getElementById('lvup'); if (u) u.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      const st = j.header && j.header.competitions && j.header.competitions[0] && j.header.competitions[0].status && j.header.competitions[0].status.type;
      cur.every = st && st.state === 'in' ? 10000 : st && st.state === 'post' ? 0 : 30000;
    } catch (e) { const b = document.getElementById('lvbody'); if (b && !last) b.innerHTML = '<div class="no">Could not load the live feed (' + esc(e.message) + '). Tap Refresh.</div>'; cur.every = 20000; }
    busy = false; sched();
  }
  function sched() { clearTimeout(timer); if (cur && cur.every) timer = setTimeout(() => { if (!document.hidden) load(); else sched(); }, cur.every); }
  window.liveOpen = function (path, gid, title, opt) {
    cur = { path, gid, every: 10000, tv: (opt && Array.isArray(opt.tv) ? opt.tv : []).slice(0, 3) }; last = '';
    if (!ov) { ov = document.createElement('div'); ov.id = 'lvov'; document.body.appendChild(ov); ov.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button[data-fav]'); if (!b || !cur || !window.OddFav) return; const on = window.OddFav.toggle(window.OddFav.lgOf(cur.path), b.getAttribute('data-fav')); b.className = on ? 'on' : ''; b.setAttribute('aria-pressed', on); b.textContent = (on ? '⭐ Following ' : '☆ Follow ') + b.getAttribute('data-fav'); last = ''; }); }
    ov.innerHTML = '<div class="lvh"><button onclick="liveClose()">← Back</button><span id="lvup" style="font:12px system-ui;opacity:.7"></span><button onclick="liveRefresh()">↻ Refresh</button></div><div id="lvbody"><div class="no">Loading live feed…</div></div>';
    ov.hidden = false; document.documentElement.style.overflow = 'hidden'; load();
  };
  window.liveRefresh = function () { last = ''; load(); };
  window.liveClose = function () { clearTimeout(timer); cur = null; if (ov) ov.hidden = true; document.documentElement.style.overflow = ''; };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && cur) load(); });
})();
