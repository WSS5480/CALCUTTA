/* Oddable v296: My teams (followed teams) + where to watch, shared by sports.html, index.html and live.js.
   OddFav.favs(lg) / isFav(lg, abbr) / toggle(lg, abbr)   'odd-fav' = { nba:['BOS'], nfl:['DAL'], ... } on this phone. toggle fires window 'oddfav'.
   OddFav.tv(competition)   TV / stream names from an ESPN scoreboard competition (broadcasts + geoBroadcasts), at most 3.
   OddFav.lgOf(path)        'basketball/nba' -> 'nba' (the league key used above). */
(function () {
  const LGP = { 'basketball/nba': 'nba', 'hockey/nhl': 'nhl', 'baseball/mlb': 'mlb', 'basketball/mens-college-basketball': 'ncaab', 'football/nfl': 'nfl', 'football/college-football': 'cfb' };
  const all = () => { try { const o = JSON.parse(localStorage.getItem('odd-fav') || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } };
  const favs = (lg) => { const a = all()[lg]; return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && /^[A-Za-z0-9&.'-]{1,8}$/.test(x)).slice(0, 30) : []; };
  const isFav = (lg, abbr) => !!abbr && favs(lg).includes(abbr);
  function toggle(lg, abbr) { if (!LGP[Object.keys(LGP).find((k) => LGP[k] === lg)] || !abbr) return false; const o = all(), a = favs(lg); o[lg] = a.includes(abbr) ? a.filter((x) => x !== abbr) : a.concat(abbr).slice(-30); try { localStorage.setItem('odd-fav', JSON.stringify(o)); } catch (e) {} try { window.dispatchEvent(new CustomEvent('oddfav', { detail: { lg, abbr } })); } catch (e) {} return o[lg].includes(abbr); }
  function tv(c) { const n = []; ((c && c.broadcasts) || []).forEach((b) => (b.names || []).forEach((x) => n.push(x))); ((c && c.geoBroadcasts) || []).forEach((b) => b && b.media && b.media.shortName && n.push(b.media.shortName)); return [...new Set(n.filter((x) => typeof x === 'string' && x))].slice(0, 3); }
  window.OddFav = { favs, isFav, toggle, tv, lgOf: (p) => LGP[p] || '' };
})();
