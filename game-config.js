/* Authoritative client-side configuration for the current Attrition season.
   A future server can provide these values without changing the game UI. */
(function () {
  'use strict';

  window.AttritionGameConfig = {
    version: 2,
    season: {
      start: '2026-07-01T00:00:00Z',
      lengthHours: 180 * 24,
      worldSeedPrefix: 'attrition-season-'
    },
    simulation: {
      hoursPerTick: 1,
      saveIntervalMs: 60000
    }
  };
})();