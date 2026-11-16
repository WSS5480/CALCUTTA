// TEST PREVIEW ONLY: wires the shared contracts the feature branches left as stand-ins, where the real one exists in this merge.
//   stats 'groups' provider  -> groups.statsFor (the Groups engine's own records; stats.js still carries the stage-1 provider)
//   golf limits.maxPeople    -> limits.js (real 8-person cap, enterprise flag, extra seats)
//   events enterprise flag   -> limits.js isEnterprise
//   golf oddHcp              -> the Oddable Handicap Index from stats.js (real app rounds)
//   events oddRating         -> the Oddable rating from stats.js
// Left as stand-ins (no shared key to map yet): calcutta limits (it keys the cap on its own member key; still 8 people).
function wire(C) {
  const M = C.mods, LIM = M.limits, ST = M.stats; C.wired = [];
  const say = (x) => C.wired.push(x);
  try { if (ST && M.groups && typeof M.groups.statsFor === 'function') { ST.register('groups', (k, o) => M.groups.statsFor(k, o)); say('stats <- groups.statsFor'); } } catch (e) { console.error('glue groups stats:', e.message); }
  try { if (M.golf && LIM) { M.golf.limits.maxPeople = (e, id) => LIM.maxPeople(LIM.keyOf(e), id); say('golf limits <- limits.js'); } } catch (e) { console.error('glue golf limits:', e.message); }
  try { if (M.events && LIM) { M.events._deps.enterprise = (ak) => LIM.isEnterprise(LIM.keyOf(ak)); say('events enterprise <- limits.js'); } } catch (e) { console.error('glue events ent:', e.message); }
  try { if (M.golf && ST) { M.golf._deps.oddHcp = async (ak) => { const h = ST.golfHcp(await ST.statsFor(ak)); return h && h.index != null ? h.index : null; }; say('golf oddHcp <- stats handicap'); } } catch (e) { console.error('glue hcp:', e.message); }
  try { if (M.events && ST) { M.events._deps.oddRating = async (ak, sport) => { const r = ST.eloAll(await ST.statsFor(ak))[sport]; return r && r.rating != null ? r.rating : null; }; say('events oddRating <- stats rating'); } } catch (e) { console.error('glue rating:', e.message); }
}
module.exports = { wire };
