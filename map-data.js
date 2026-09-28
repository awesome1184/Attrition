(function () {
  'use strict';

  const config = window.AttritionGameConfig;
  const seed = config.season.worldSeed;

  window.AttritionMapData = window.AttritionMapGenerator.generate({
    seed,
    cols: 8,
    rows: 6,
    tileSize: 180,
    width: 2200,
    height: 2200
  });
})();