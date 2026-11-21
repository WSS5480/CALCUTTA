/* Oddable v296: My teams (followed teams) + where to watch, shared by sports.html, index.html and live.js.
   OddFav.favs(lg) / isFav(lg, abbr) / toggle(lg, abbr)   'odd-fav' = { nba:['BOS'], nfl:['DAL'], ... } on this phone. toggle fires window 'oddfav'.
   OddFav.tv(competition)   TV / stream names from an ESPN scoreboard competition (broadcasts + geoBroadcasts), at most 3.
   OddFav.lgOf(path)        'basketball/nba' -> 'nba' (the league key used above). */
(function () {
  const LGP = { 'basketball/nba': 'nba', 'hockey/nhl': 'nhl', 'baseball/mlb': 'mlb', 'basketball/mens-college-basketball': 'ncaab', 'football/nfl': 'nfl', 'football/college-football': 'cfb' };
  const all = () => { try { const o = JSON.parse(localStorage.getItem('odd-fav') || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } };
  const favs = (lg) => { const a = all()[lg]; return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && /^[A-Za-z0-9&.'-]{1,8}$/.test(x)).slice(0, 30) : []; };
  const isFav = (lg, abbr) => !!abbr && favs(lg).includes(abbr);
  // v298: the follows also go to the account (/betpush/fav), so the phone alerts cover followed teams' games, bet or no bet. Signed-in only; the whole
  // list each time; quiet on failure (tried again on the next load). Nothing is sent for a guest or a phone with no follows ever.
  function syncFav(force) {
    let tk = ''; try { tk = localStorage.getItem('odd-tok') || ''; } catch (e) {} if (!tk || window.__oddLock) return;
    const body = JSON.stringify({ fav: all() }); let last = null; try { last = localStorage.getItem('odd-fav-sent'); } catch (e) {}
    if (!force && (last === body || (last === null && body === '{"fav":{}}'))) return;
    fetch('https://calcutta-odds.onrender.com/betpush/fav', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': tk }, body }).then((r) => { if (r.ok) try { localStorage.setItem('odd-fav-sent', body); } catch (e) {} }).catch(() => {});
  }
  setTimeout(() => syncFav(false), 4000);
  function toggle(lg, abbr) { if (!LGP[Object.keys(LGP).find((k) => LGP[k] === lg)] || !abbr) return false; const o = all(), a = favs(lg); o[lg] = a.includes(abbr) ? a.filter((x) => x !== abbr) : a.concat(abbr).slice(-30); try { localStorage.setItem('odd-fav', JSON.stringify(o)); } catch (e) {} try { window.dispatchEvent(new CustomEvent('oddfav', { detail: { lg, abbr } })); } catch (e) {} syncFav(true); return o[lg].includes(abbr); }
  function tv(c) { const n = []; ((c && c.broadcasts) || []).forEach((b) => (b.names || []).forEach((x) => n.push(x))); ((c && c.geoBroadcasts) || []).forEach((b) => b && b.media && b.media.shortName && n.push(b.media.shortName)); return [...new Set(n.filter((x) => typeof x === 'string' && x))].slice(0, 3); }
  // ---------- v297 team sheet (college football and the NBA / NHL / MLB / NCAAB pages; the NFL has its own team page in index.html) ----------
  // OddFav.teamOpen(lg, teamId, abbr): record, standing, ☆ Follow, next game (where to watch), points for / against, last 5, the season's games
  // (tap one = its Gamecast through live.js). ESPN team schedule, the same public host as the scores. z 140: under the Gamecast (150).
  const PATHS = {}; Object.keys(LGP).forEach((k) => (PATHS[LGP[k]] = k));
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let TS = null, tov = null;
  const tcss = '#tmov{position:fixed;inset:0;z-index:140;background:var(--bg,#0a0c10);color:var(--ink,#eef0f4);overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:calc(env(safe-area-inset-top,0px) + 8px) 12px calc(env(safe-area-inset-bottom,0px) + 90px);font:15px/1.35 system-ui,-apple-system,sans-serif}#tmov *{box-sizing:border-box}#tmov .w{max-width:640px;margin:0 auto}#tmov .tb{display:flex;justify-content:space-between;gap:8px}#tmov .tb button,#tmov .fv{min-height:44px;border-radius:12px;border:1px solid #8886;background:#ffffff0d;color:inherit;font:700 15px system-ui;padding:0 14px;cursor:pointer}#tmov .fv{width:100%;margin-top:10px}#tmov .fv.on{border-color:#f5c542;background:#f5c54222}#tmov .hd{display:flex;gap:12px;align-items:center;margin:12px 0 4px}#tmov .hd img{width:56px;height:56px;object-fit:contain}#tmov .hd b{display:block;font-size:20px}#tmov .mu{color:var(--muted,#8b93a3);font-size:13px}#tmov .cd{background:var(--panel,#13161d);border:1px solid var(--line,#272c38);border-radius:16px;padding:12px;margin:10px 0}#tmov h3{margin:0 0 8px;font:800 12px system-ui;letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#8b93a3)}#tmov .ks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;text-align:center}#tmov .ks b{display:block;font-size:20px}#tmov .gm{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;width:100%;text-align:left;padding:9px 0;border:0;border-top:1px solid var(--line,#272c38);background:none;color:inherit;font:inherit;cursor:pointer}#tmov .gm:first-of-type{border-top:0}#tmov .gm small{color:var(--muted,#8b93a3)}#tmov .W{color:#4fd18b;font-weight:800}#tmov .L{color:#ff7a6e;font-weight:800}';
  function teamClose() { if (tov) { tov.hidden = true; tov.innerHTML = ''; } TS = null; if (!document.getElementById('lvov') || document.getElementById('lvov').hidden) document.documentElement.style.overflow = ''; }
  async function teamOpen(lg, id, abbr) {
    const path = PATHS[lg]; if (!path || !/^\d{1,8}$/.test(String(id))) return;
    if (!tov) { const st = document.createElement('style'); st.textContent = tcss; document.head.appendChild(st); tov = document.createElement('div'); tov.id = 'tmov'; tov.setAttribute('role', 'dialog'); document.body.appendChild(tov);
      tov.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || !TS) return; if (b.dataset.x === 'close') teamClose(); else if (b.dataset.x === 'fav') { toggle(TS.lg, TS.abbr); paintT(); } else if (b.dataset.g && window.liveOpen) window.liveOpen(PATHS[TS.lg], b.dataset.g, '', { tv: b.dataset.tv ? b.dataset.tv.split('|') : [] }); }); }
    TS = { lg, id: String(id), abbr: abbr || '', j: null, err: '' }; tov.hidden = false; tov.scrollTop = 0; document.documentElement.style.overflow = 'hidden'; paintT();
    const me = TS; try { const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/' + path + '/teams/' + me.id + '/schedule', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); me.j = await r.json(); if (me.j.team && me.j.team.abbreviation && !me.abbr) me.abbr = me.j.team.abbreviation; } catch (e) { me.err = 'Could not load this team from ESPN. Try again.'; }
    if (TS === me) paintT();
  }
  function paintT() {
    if (!tov || !TS) return; const j = TS.j, t = (j && j.team) || {}, ab = TS.abbr || t.abbreviation || '';
    let h = '<div class="w"><div class="tb"><button type="button" data-x="close">‹ Back</button><button type="button" data-x="close" aria-label="Close">✕</button></div>';
    h += '<div class="hd">' + (t.logo ? '<img src="' + esc(t.logo) + '" alt="">' : '') + '<div><b>' + esc(t.displayName || ab || 'Team') + '</b><span class="mu">' + esc([t.recordSummary, t.standingSummary].filter(Boolean).join(' · ')) + '</span></div></div>';
    const on = isFav(TS.lg, ab); h += '<button type="button" class="fv' + (on ? ' on' : '') + '" data-x="fav" aria-pressed="' + on + '">' + (on ? '⭐ Following ' + esc(ab) + ' · their games show first' : '☆ Follow ' + esc(ab) + ' · show their games first') + '</button>';
    if (!j) { tov.innerHTML = h + '<div class="cd mu">' + esc(TS.err || 'Loading the team…') + '</div></div>'; return; }
    const evs = (j.events || []).map((e) => { const c = (e.competitions || [])[0] || {}, cs = c.competitors || [], us = cs.find((x) => x.team && String(x.team.id) === TS.id) || cs.find((x) => x.team && x.team.abbreviation === ab) || {}, th = cs.find((x) => x !== us) || {}, sv = (x) => (x && x.score && typeof x.score === 'object' ? Number(x.score.value) : Number(x && x.score)); const stt = (c.status && c.status.type) || {};
      return { id: e.id, d: new Date(e.date), st: stt.state, det: stt.shortDetail || '', home: us.homeAway === 'home', opp: (th.team && (th.team.abbreviation || th.team.shortDisplayName)) || '?', us: sv(us), them: sv(th), w: us.winner === true, tv: [...new Set([].concat(...(c.broadcasts || []).map((b) => (b.media && b.media.shortName) || b.names || [])).filter(Boolean))].slice(0, 2) }; });
    const done = evs.filter((e) => e.st === 'post' && isFinite(e.us) && isFinite(e.them)), live = evs.find((e) => e.st === 'in'), next = evs.filter((e) => e.st === 'pre').sort((a, b) => a.d - b.d);
    const avg = (f) => (done.length ? (done.reduce((s, e) => s + f(e), 0) / done.length).toFixed(1) : '–'), last5 = done.slice(-5);
    const gb = (e, big) => '<button type="button" class="gm" data-g="' + esc(e.id) + '" data-tv="' + esc(e.tv.join('|')) + '"><span>' + (e.home ? 'vs ' : '@ ') + esc(e.opp) + '<small> · ' + esc(e.d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })) + '</small></span><span>' + (e.st === 'post' ? '<span class="' + (e.us > e.them ? 'W' : e.us < e.them ? 'L' : '') + '">' + (e.us > e.them ? 'W' : e.us < e.them ? 'L' : 'T') + '</span> ' + e.us + '–' + e.them : e.st === 'in' ? '● ' + esc(e.det) : esc(e.d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + (e.tv.length ? ' · 📺 ' + esc(e.tv.join(' · ')) : '')) + '</span></button>';
    if (live || next[0]) h += '<div class="cd"><h3>' + (live ? 'Playing now' : 'Next game') + '</h3>' + gb(live || next[0]) + '</div>';
    h += '<div class="cd"><h3>Team stats · this season</h3><div class="ks"><div><b>' + esc(t.recordSummary || done.filter((e) => e.us > e.them).length + '-' + done.filter((e) => e.us < e.them).length) + '</b><span class="mu">Record</span></div><div><b>' + avg((e) => e.us) + '</b><span class="mu">Scored a game</span></div><div><b>' + avg((e) => e.them) + '</b><span class="mu">Allowed a game</span></div>' +
      '<div><b>' + done.filter((e) => e.home && e.us > e.them).length + '-' + done.filter((e) => e.home && e.us < e.them).length + '</b><span class="mu">Home</span></div><div><b>' + done.filter((e) => !e.home && e.us > e.them).length + '-' + done.filter((e) => !e.home && e.us < e.them).length + '</b><span class="mu">Away</span></div><div><b>' + (last5.map((e) => (e.us > e.them ? 'W' : e.us < e.them ? 'L' : 'T')).join('') || '–') + '</b><span class="mu">Last 5</span></div></div></div>';
    if (done.length) h += '<div class="cd"><h3>Results</h3>' + done.slice(-12).reverse().map((e) => gb(e)).join('') + '</div>';
    if (next.length > 1) h += '<div class="cd"><h3>Coming up</h3>' + next.slice(1, 6).map((e) => gb(e)).join('') + '</div>';
    h += '<div class="mu" style="text-align:center">Data: ESPN · tap a game for its Gamecast</div></div>';
    const y = tov.scrollTop; tov.innerHTML = h; tov.scrollTop = y;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && TS && (!document.getElementById('lvov') || document.getElementById('lvov').hidden)) teamClose(); });
  window.OddFav = { favs, isFav, toggle, tv, lgOf: (p) => LGP[p] || '', teamOpen, teamClose };
})();
