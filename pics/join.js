// Oddable invite links (owner decision G14, Nov 16 2026): one shared join router for every game type.
// Link: https://oddable-preview.onrender.com/?join=<type>.<code>   type: g = group, c = Calcutta, golf = golf contest, e = local event. Nothing else in the URL.
// Loaded early (before gate.js). Reads ?join=, keeps it in sessionStorage 'odd-join' (survives sign-up and the reload after sign-in), strips it from the address bar.
// Engines plug in with: window.OddJoin.register(type, handler) — handler(code) opens that game's join preview (it runs only once the person is signed in).
// API: OddJoin = { register(type, handler), pending() -> {type, code} | null, clear(), share({type, code, title, text}) -> opens the share sheet,
//                  run() (gate.js calls it after a sign-in), banner(el) (gate.js: "You're invited to join <title>") }.
(function () {
  const KEY = 'odd-join', API = (window.ODD_GROUPS_API || location.origin + '') + '/groups/invite', SITE = location.origin + '/';
  const H = {}, ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } };
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parse = (v) => { const m = /^([a-z]{1,8})\.([A-Za-z0-9-]{4,40})$/.exec(String(v || '').trim()); return m ? { type: m[1], code: m[2] } : null; };
  // 1. read and strip ?join= right away
  try {
    const u = new URL(location.href), v = u.searchParams.get('join');
    if (v !== null) { const p = parse(v); if (p) { ss(KEY, JSON.stringify(p)); ss(KEY + '-t', null); } u.searchParams.delete('join'); history.replaceState(history.state, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash); }
  } catch (e) {}
  const pending = () => { try { return parse(((j) => j && j.type + '.' + j.code)(JSON.parse(ss(KEY) || 'null'))); } catch (e) { return null; } };
  const signedIn = () => { try { return !!localStorage.getItem('odd-tok'); } catch (e) { return false; } };
  let soonShown = false, busy = false;
  function soon(p) { // a type nobody has plugged in yet: keep the invite, say so once
    if (soonShown || document.getElementById('ojoin')) return; soonShown = true; const o = document.createElement('div'); o.id = 'ojoin';
    o.style.cssText = 'position:fixed;inset:0;z-index:110;background:rgba(5,8,16,.8);display:flex;align-items:center;justify-content:center;padding:16px;font:15px/1.4 system-ui';
    o.innerHTML = '<div role="dialog" aria-label="Invite" style="max-width:360px;width:100%;background:#1b1630;color:#f1eefa;border:1px solid #2f2850;border-radius:18px;padding:18px"><div style="font-size:28px">🎟️</div><b style="font-size:18px;display:block;margin:6px 0">This game is coming soon to Oddable</b><p style="color:#a59fbd;margin:0 0 12px">Your invite is saved on this phone. Open the link again once it is ready.</p><button id="ojoin-ok" style="width:100%;min-height:48px;border-radius:14px;border:0;background:#7c3aed;color:#fff;font:700 16px system-ui">OK</button></div>';
    document.body.appendChild(o); document.getElementById('ojoin-ok').onclick = () => o.remove();
  }
  async function run() {
    const p = pending(); if (!p || busy || !signedIn()) return; const h = H[p.type];
    if (!h) { setTimeout(() => { const q = pending(); if (q && !H[q.type] && signedIn()) soon(q); }, 3000); return; }
    busy = true; try { ss(KEY, null); await h(p.code); } catch (e) {} busy = false;
  }
  async function title(p) { // public preview: only {kind, title}; cached for this tab
    const c = ss(KEY + '-t'); if (c) { try { return JSON.parse(c); } catch (e) {} }
    try { const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: p.type, code: p.code }) }); const j = await r.json().catch(() => ({})); const o = r.ok ? { ok: true, title: j.title, kind: j.kind } : { ok: false, error: j.error || 'This invite link is not valid or has expired.' }; if (r.status !== 429) ss(KEY + '-t', JSON.stringify(o)); return o; } catch (e) { return { ok: false, error: '' }; }
  }
  async function banner(el) { // gate.js gives an element at the top of the sign-up screen
    const p = pending(); if (!el || !p) return; el.innerHTML = '<div style="background:#2a1f4d;border:1px solid #7c3aed;border-radius:14px;padding:12px 14px;margin:10px 0;color:#efe9ff">You\'re invited to join a game on Oddable…</div>';
    const t = await title(p); if (!el.isConnected) return;
    el.innerHTML = t.ok ? '<div style="background:#2a1f4d;border:1px solid #7c3aed;border-radius:14px;padding:12px 14px;margin:10px 0;color:#efe9ff">You\'re invited to join <b>' + esc(t.title) + '</b>. Sign in or create your account, then you go straight to it.</div>'
      : '<div style="background:#3a1520;border:1px solid #6b2a35;border-radius:14px;padding:12px 14px;margin:10px 0;color:#ffd0d0">' + esc(t.error || 'This invite link could not be checked right now.') + '</div>';
  }
  const link = (type, code) => SITE + '?join=' + type + '.' + String(code).replace(/[^A-Za-z0-9]/g, '');
  // Invite people: the phone's share sheet when it has one; else a sheet with the link (no stray spaces), Copy and Text it.
  async function share(o) {
    const url = link(o.type, o.code), line = o.text || 'Join "' + (o.title || 'my game') + '" on Oddable.';
    if (navigator.share) { try { await navigator.share({ title: o.title || 'Oddable', text: line, url }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; } }
    const x = document.getElementById('oshare'); if (x) x.remove(); const s = document.createElement('div'); s.id = 'oshare';
    s.style.cssText = 'position:fixed;inset:0;z-index:110;background:rgba(5,8,16,.8);display:flex;align-items:flex-end;justify-content:center;padding:16px;font:15px/1.4 system-ui';
    s.innerHTML = '<div role="dialog" aria-label="Invite people" style="max-width:430px;width:100%;background:#1b1630;color:#f1eefa;border:1px solid #2f2850;border-radius:18px;padding:16px"><b style="font-size:18px">Invite people</b><p style="color:#a59fbd;margin:6px 0 10px">' + esc(line) + '</p>'
      + '<input id="oshare-l" readonly value="' + esc(url) + '" style="width:100%;box-sizing:border-box;min-height:48px;border-radius:12px;border:1px solid #2f2850;background:#14111f;color:#f1eefa;font:600 15px system-ui;padding:10px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px"><button id="oshare-c" style="min-height:48px;border-radius:14px;border:1px solid #2f2850;background:#14111f;color:#f1eefa;font:700 16px system-ui">Copy link</button><a id="oshare-t" href="sms:?&body=' + encodeURIComponent(line + ' ' + url) + '" style="min-height:48px;border-radius:14px;background:#7c3aed;color:#fff;font:700 16px system-ui;display:flex;align-items:center;justify-content:center;text-decoration:none">Text it</a></div>'
      + '<button id="oshare-x" style="width:100%;min-height:48px;margin-top:10px;border-radius:14px;border:0;background:none;color:#a78bfa;font:700 16px system-ui">Done</button></div>';
    document.body.appendChild(s); document.getElementById('oshare-x').onclick = () => s.remove(); s.addEventListener('click', (e) => { if (e.target === s) s.remove(); });
    document.getElementById('oshare-c').onclick = async (e) => { const i = document.getElementById('oshare-l'); try { await navigator.clipboard.writeText(url); e.target.textContent = 'Copied'; } catch (er) { i.select(); try { document.execCommand('copy'); e.target.textContent = 'Copied'; } catch (e2) {} } };
    return 'sheet';
  }
  window.OddJoin = { register(type, handler) { if (!/^[a-z]{1,8}$/.test(type) || typeof handler !== 'function') return; H[type] = handler; run(); }, pending, clear() { ss(KEY, null); ss(KEY + '-t', null); }, share, run, banner, link, parse };
  // Already signed in when the link was opened: run once the engines had a moment to register.
  setTimeout(run, 1800);
})();
