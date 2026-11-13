// Oddable cloud sync: sign in with a cell number + PIN on any device and your bets, watch list, daily logs and locked picks follow you.
// Kalshi keys never leave the device. Server: calcutta-odds /sync/*.
(function () {
  const API = 'https://calcutta-odds.onrender.com/sync';
  const g = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const s = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const J = (k, d) => { try { const v = JSON.parse(g(k)); return v == null ? d : v; } catch (e) { return d; } };
  const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, x) => ((a[x] = v[x]), a), {}) : v));
  const creds = () => { const p = g('sync-phone'), n = g('sync-pin'); return p && n ? { phone: p, pin: n } : null; };
  let BUSY = false;

  function gather() {
    const bets = J('bets26', []), ids = new Set(bets.map((b) => String(b.id)));
    const tomb = new Set(J('sync-tomb', []).map(String));
    J('sync-ids', []).forEach((i) => { if (!ids.has(String(i))) tomb.add(String(i)); });
    const locks = {}, splk = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^lk26-[a-z]+-/.test(k) && !k.endsWith('-s')) locks[k] = J(k, null); else if (/^splk-/.test(k)) splk[k.slice(5)] = J(k, {}); } } catch (e) {}
    return { bets, pins: J('pinned26', []), log: J('betlog26', {}), kdel: J('kdel26', []), locks, splk, tomb: [...tomb] };
  }
  const gatherFrom = (d) => d;
  const hashOf = (d) => stable({ b: [...d.bets].sort((a, b) => String(a.id).localeCompare(String(b.id))), p: [...d.pins].map(String).sort(), l: d.log, k: [...d.kdel].map(String).sort(), lk: d.locks, sp: d.splk });
  function apply(d) {
    const reloadMem = () => { try { if (typeof BETS !== 'undefined') BETS = JSON.parse(g('bets26')) || []; } catch (e) {} }; // keep the in-memory list in step so the next save can't overwrite what just synced
    s('bets26', JSON.stringify(d.bets || [])); s('pinned26', JSON.stringify(d.pins || [])); s('betlog26', JSON.stringify(d.log || {})); s('kdel26', JSON.stringify(d.kdel || []));
    Object.keys(d.locks || {}).forEach((k) => { if (d.locks[k]) s(k, JSON.stringify(d.locks[k])); });
    Object.keys(d.splk || {}).forEach((lg) => s('splk-' + lg, JSON.stringify(d.splk[lg])));
    s('sync-ids', JSON.stringify((d.bets || []).map((b) => String(b.id)))); s('sync-tomb', JSON.stringify(d.tomb || []));
    reloadMem();
  }
  async function call(path, body) {
    const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.error || 'Sync failed (' + r.status + ')');
    return j;
  }
  const editing = () => { const a = document.activeElement; return a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); };
  let LASTHASH = '';
  async function syncNow(o) {
    o = o || {}; const c = creds(); if (!c || BUSY) return; BUSY = true;
    try {
      const local = gather(), lh = hashOf(local);
      const j = await call('/push', { ...c, data: local });
      const merged = j.data || {};
      s('sync-last', String(Date.now()));
      // the server can be slow (cold start): if bets changed while we waited, applying the older merged copy would wipe the new bet, so push again instead
      const bk = (d) => stable(d.bets.map((b) => [String(b.id), b.t, b.stake, b.res == null ? 0 : 1, (b.legs || []).length]).sort()), moved = bk(gather()) !== bk(local) && (o.n || 0) < 3;
      if (moved) { o = { ...o, n: (o.n || 0) + 1 }; s('sync-err', ''); BUSY = false; setTimeout(() => syncNow(o), 300); return true; }
      if (o.apply) {
        apply(merged);
        const after = hashOf(gather());
        LASTHASH = after;
        // reload only when bets were added/removed/settled or pins changed; field-level differences (stake, app pick) must never trigger reloads or two devices ping-pong forever
        const sig = (d) => stable({ b: d.bets.map((b) => [String(b.id), b.res == null ? 0 : 1]).sort(), p: [...d.pins].map(String).sort() });
        if (sig(gatherFrom(local)) !== sig(gather()) && !editing()) {
          const t = +g('sync-rl') || 0;
          if (Date.now() - t > 60000) { s('sync-rl', String(Date.now())); location.reload(); return; }
        }
      } else { s('sync-ids', JSON.stringify(local.bets.map((b) => String(b.id)))); s('sync-tomb', JSON.stringify(merged.tomb || local.tomb)); LASTHASH = lh; }
      paint(); return true;
    } catch (e) { s('sync-err', e.message); paint(); if (/Wrong PIN|No account/.test(e.message)) { s('sync-pin', ''); } return false; }
    finally { BUSY = false; }
  }

  // ---- UI ----
  function paint() {
    const p = document.getElementById('syncpill'); if (p) p.textContent = creds() ? '☁️ Synced' : '☁️ Sync';
    const m = document.getElementById('syncmsg'); if (m) m.innerHTML = box();
  }
  const last = () => { const t = +g('sync-last'); return t ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'not yet'; };
  const mask = (p) => '(•••) •••-' + String(p || '').slice(-4);
  function box() {
    const c = creds(), err = g('sync-err');
    if (c) return `<p style="margin:0 0 8px">Signed in as <b>${mask(c.phone)}</b>. Last sync ${last()}.</p>${err ? `<p style="color:#ff9a90;margin:0 0 8px">${err}</p>` : ''}<div style="display:flex;gap:8px"><button class="sbtn" onclick="OddSync.now()">Sync now</button><button class="sbtn x" onclick="OddSync.out()">Sign out</button></div><p class="sn">Your bets, watch list, daily logs and locked picks sync across every device you sign in on. Kalshi keys stay on each device.</p>`;
    return `<label>Cell number<input id="sph" type="tel" inputmode="tel" autocomplete="tel" placeholder="(956) 555-1234"></label><label>PIN (4–10 digits)<input id="spn" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN"></label>${err ? `<p style="color:#ff9a90;margin:0 0 8px">${err}</p>` : ''}<div style="display:flex;gap:8px"><button class="sbtn" onclick="OddSync.go('/login')">Sign in</button><button class="sbtn x" onclick="OddSync.go('/signup')">Create account</button></div><p class="sn">First time? Use <b>Create account</b> on the device that has your bets. On your other devices use <b>Sign in</b>. Pick a PIN you don't use anywhere else.</p>`;
  }
  function open() {
    let o = document.getElementById('syncsheet');
    if (!o) {
      const st = document.createElement('style'); st.textContent = '#syncsheet{position:fixed;inset:0;background:#000a;z-index:90;display:flex;align-items:flex-end;justify-content:center}#syncsheet[hidden]{display:none}#syncsheet .sb{background:var(--panel,#13161d);color:var(--ink,#eef0f4);width:min(460px,100%);border-radius:20px 20px 0 0;padding:16px 16px max(18px,env(safe-area-inset-bottom));border:1px solid var(--line,#272c38)}@media(min-width:700px){#syncsheet{align-items:center}#syncsheet .sb{border-radius:20px}}#syncsheet .sh{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:17px}#syncsheet .sh button{background:none;border:0;color:inherit;font-size:20px;cursor:pointer}#syncsheet label{display:block;margin:8px 0;font-size:13px;color:var(--muted,#8b93a3)}#syncsheet input{display:block;width:100%;margin-top:4px;padding:11px;border:1px solid var(--line,#272c38);border-radius:10px;background:var(--panel2,#1b1f29);color:inherit;font:16px system-ui}.sbtn{flex:1;border:1px solid #a78bfa;background:#a78bfa;color:#0a0c10;border-radius:12px;padding:11px;font:800 15px system-ui;cursor:pointer}.sbtn.x{background:none;color:#a78bfa}.sn{font-size:12px;color:var(--muted,#8b93a3);margin:10px 0 0}';
      document.head.appendChild(st);
      o = document.createElement('div'); o.id = 'syncsheet'; o.hidden = true; o.onclick = (e) => { if (e.target === o) o.hidden = true; };
      o.innerHTML = '<div class="sb"><div class="sh"><b>☁️ Sync across devices</b><button onclick="document.getElementById(\'syncsheet\').hidden=true">✕</button></div><div id="syncmsg"></div></div>'; document.body.appendChild(o);
    }
    s('sync-err', ''); o.hidden = false; paint();
  }
  window.OddSync = {
    open,
    now: async () => { s('sync-err', ''); const ok = await syncNow({ apply: true }); if (ok) { const m = document.getElementById('syncmsg'); if (m) m.insertAdjacentHTML('afterbegin', '<p style="color:#7ee8ae;margin:0 0 8px">✓ Synced</p>'); } },
    out: () => { s('sync-phone', ''); s('sync-pin', ''); s('sync-ids', '[]'); s('sync-tomb', '[]'); paint(); },
    go: async (path) => {
      const ph = (document.getElementById('sph') || {}).value || '', pn = (document.getElementById('spn') || {}).value || '', m = document.getElementById('syncmsg');
      s('sync-err', ''); if (m) m.insertAdjacentHTML('afterbegin', '<p class="sn" id="sbusy">Working…</p>');
      try {
        const body = { phone: ph, pin: pn };
        if (path === '/signup') body.data = gather();
        const j = await call(path, body);
        s('sync-phone', ph.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')); s('sync-pin', pn);
        if (path === '/signup') { apply(j.data || gather()); s('sync-last', String(Date.now())); paint(); }
        else { s('sync-rl', '0'); await syncNow({ apply: true }); paint(); }
      } catch (e) { s('sync-err', e.message); paint(); }
    },
  };
  // pill in the league row
  function mountPill() {
    const lg = document.querySelector('.lg'); if (!lg || document.getElementById('syncpill')) return;
    const b = document.createElement('button'); b.id = 'syncpill'; b.type = 'button'; b.onclick = open; lg.appendChild(b); paint();
  }
  mountPill(); setTimeout(mountPill, 800);
  // background: push local changes; pull when the tab is shown again; one pull at load
  if (creds()) {
    setTimeout(() => syncNow({ apply: true }), 2500);
    setInterval(() => { if (document.hidden || !creds()) return; try { if (hashOf(gather()) !== LASTHASH) syncNow({ apply: false }); } catch (e) {} }, 10000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !editing()) syncNow({ apply: true }); });
  }
})();
