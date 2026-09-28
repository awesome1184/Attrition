/* Shared configuration for both the browser and the Node server. */
(function (root, factory) {
  const value = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
  if (root) root.AttritionGameConfig = value;
})(typeof window !== 'undefined' ? window : null, function () {
  return {
    version: 3,
    season: {
      start: '2026-07-01T00:00:00Z',
      lengthHours: 180 * 24,
      worldSeedPrefix: 'attrition-season-'
    },
    simulation: {
      hoursPerTick: 1,
      saveIntervalMs: 60000
    },
    server: {
      host: '0.0.0.0',
      port: 8080
    }
  };
});