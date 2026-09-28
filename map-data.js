(function () {
  'use strict';

  const querySeed = new URLSearchParams(location.search).get('seed');
  const storedSeed = localStorage.getItem('attrition-map-seed');
  const seed = querySeed || storedSeed || 'attrition-001';

  if (storedSeed !== seed) {
    try { localStorage.setItem('attrition-map-seed', seed); } catch (_) {}
  }

  window.AttritionMapData = window.AttritionMapGenerator.generate({
    seed,
    cols: 8,
    rows: 6,
    tileSize: 180,
    width: 2200,
    height: 2200
  });
})();