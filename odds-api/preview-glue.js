// TEST PREVIEW ONLY. The cross-engine wiring moved to odds-api/integrate.js (it is part of the merged build, not of the preview).
// The seed still calls wire(C) so the wiring is in place before any demo data is written.
function wire(C) { C.wired = require('./integrate').wire(); }
module.exports = { wire };
