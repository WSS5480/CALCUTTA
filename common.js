// Shared by every page: saved games (Supabase), tabs, ESPN address, self-update.
const SB_URL = "https://xpienbliztnplwccsnlo.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwaWVuYmxpenRucGx3Y2NzbmxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyNDMwNDgsImV4cCI6MjEwOTgxOTA0OH0.oKVpsAP_GY_bIHzsxkFZaFVFfGlFXb4vZEJQJ9JAR6Q";
const sbH = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };

async function sbGames(q) {
  const r = await fetch(SB_URL + "/rest/v1/squares_games?" + q, { headers: sbH, cache: "no-store" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbRpc(fn, args) {
  const r = await fetch(SB_URL + "/rest/v1/rpc/" + fn, { method: "POST", headers: { ...sbH, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(await r.text());
  const t = await r.text(); try { return JSON.parse(t); } catch (e) { return t; }
}
const pageFor = k => (k === "holdings" ? "flx.html" : "./");
const qsId = () => new URLSearchParams(location.search).get("id");

// strip characters that could break the page out of any text that came from a photo or a form
function clean(o) {
  if (typeof o === "string") return o.replace(/[<>]/g, "");
  if (Array.isArray(o)) return o.map(clean);
  if (o && typeof o === "object") { const n = {}; for (const k in o) n[k] = clean(o[k]); return n; }
  return o;
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// Which game this page shows: ?id=..., else the first live game of this page's kind (or bounce to the right page)
async function getGame(kind) {
  const id = qsId();
  if (id) { const r = await sbGames("id=eq." + encodeURIComponent(id) + "&select=*"); return r[0] ? clean(r[0]) : null; }
  const live = await sbGames("status=eq.live&select=id,kind&order=sort");
  const pick = live.find(g => g.kind === kind) || live[0];
  if (!pick) { location.replace("archive.html"); return null; }
  if (pick.kind !== kind) { location.replace(pageFor(pick.kind) + "?id=" + pick.id); return null; }
  const r = await sbGames("id=eq." + pick.id + "&select=*");
  return r[0] ? clean(r[0]) : null;
}

async function buildTabs(curId) {
  const el = document.getElementById("tabs"); if (!el) return;
  try {
    const live = await sbGames("status=eq.live&select=id,kind,title&order=sort");
    let h = live.map(g => `<a href="${pageFor(g.kind)}?id=${encodeURIComponent(g.id)}" class="${g.id === curId ? "on" : ""}">${esc(g.title)}</a>`).join("");
    if (curId && curId !== "archive" && curId !== "new" && !live.some(g => g.id === curId)) h += `<a class="on">📁 Archived game</a>`;
    h += `<a href="archive.html" class="${curId === "archive" ? "on" : ""}">📁 Archive</a><a href="new.html" class="${curId === "new" ? "on" : ""}">＋ New game</a>`;
    el.innerHTML = h;
  } catch (e) { console.log(e); }
}

function espnBase(G) { return "https://site.api.espn.com/apis/site/v2/sports/football/" + (G.league || "nfl") + "/"; }
function espnBoardUrl(G) {
  const d = (G.date || "").replace(/-/g, "");
  return espnBase(G) + "scoreboard?" + (d ? "dates=" + d + "&" : "") + (G.league === "college-football" ? "groups=80&limit=400&" : "") + "t=" + Date.now();
}
function espnFind(j, a, b) {
  return (j.events || []).find(e => { const ab = e.competitions[0].competitors.map(c => c.team.abbreviation); return ab.includes(a) && ab.includes(b); });
}

// self-update: when a new version is pushed, open pages reload themselves
async function checkVersion() {
  try {
    const j = await (await fetch("version.json?t=" + Date.now(), { cache: "no-store" })).json();
    if (j.v && typeof APP_VERSION !== "undefined" && j.v !== APP_VERSION) {
      const u = new URL(location.href); u.searchParams.set("v", j.v); location.replace(u.toString());
    }
  } catch (e) {}
}
setInterval(checkVersion, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
