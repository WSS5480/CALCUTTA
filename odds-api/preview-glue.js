// TEST PREVIEW ONLY: the "manager wires these at merge" lines, done here so the feature branches' files stay as their coders committed them.
//   groups.registerGame('calc' | 'golf' | 'event')   -> each engine's potSummary / attach (pots of attached games show in the group)
//   stats 'groups' provider                           -> groups.statsFor (group bets from SERVER records, G16)
//   golf handicapFor / eventSetup / eventOverride / eventLog -> stats.js (H1, E-H: one handicap everywhere, tournament-only overrides)
//   golf limits (maxPeople, isEnterprise)             -> limits.js (shared 8-person cap, Enterprise flag, extra seats)
//   events: finds limits.js, stats.js (ratingFor, eventSetup...) and pairing.js by itself (its D.limits / D.rt / D.pairing)
//   pairing: ONE file, odds-api/pairing.js from the Groups branch (golf and events both call suggestPartners from it)
// Still a stand-in: calcutta limits (keyed on its own member key, so the shared cap cannot be asked per account yet; still 8 people).
function wire(C) {
  const M = C.mods, LIM = M.limits, ST = M.stats, G = M.groups; C.wired = [];
  const t = (name, fn) => { try { if (fn()) C.wired.push(name); } catch (e) { console.error('preview glue [' + name + ']:', e.message); } };
  t('groups.registerGame calc', () => G && G.registerGame && M.calcutta && (G.registerGame('calc', { potSummary: M.calcutta.potSummary, attachToGroup: M.calcutta.attachToGroup }), true));
  t('groups.registerGame golf', () => G && G.registerGame && M.golf && (G.registerGame('golf', { potSummary: M.golf.potSummary, attachToGroup: M.golf.attach }), true));
  t('groups.registerGame event', () => G && G.registerGame && M.events && (G.registerGame('event', { potSummary: M.events.potSummary }), true));
  t('stats <- groups.statsFor', () => ST && G && typeof G.statsFor === 'function' && (ST.register('groups', (k, o) => G.statsFor(k, o)), true));
  t('golf handicaps <- stats', () => { if (!M.golf || !ST || !['handicapFor', 'eventSetup', 'eventOverride', 'eventLog'].every((f) => typeof ST[f] === 'function')) return false; const D = M.golf._deps;
    D.handicapFor = (k, o) => ST.handicapFor(k, o); D.eventSetup = (d, id, o) => ST.eventSetup(d, id, o); D.eventOverride = (d, id, k, o) => ST.eventOverride(d, id, k, o); D.eventLog = (d, id) => ST.eventLog(d, id); return true; });
  t('golf limits <- limits.js', () => { if (!M.golf || !LIM || !M.golf.limits) return false; M.golf.limits.maxPeople = (e, id) => LIM.maxPeople(LIM.keyOf(e), id); M.golf.limits.isEnterprise = (e) => LIM.isEnterprise(LIM.keyOf(e)); return true; });
}
module.exports = { wire };
