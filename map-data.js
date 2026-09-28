(function () {
  'use strict';

  const config = window.AttritionGameConfig;
  const startMs = Date.parse(config.season.start);
  const nowMs = Date.now();
  const elapsedHours = Math.max(0, Math.floor((nowMs - startMs) / 3600000));
  const seasonNumber = Math.floor(elapsedHours / config.season.lengthHours) + 1;
  const seed = config.season.worldSeedPrefix + seasonNumber;

  window.AttritionMapData = window.AttritionMapGenerator.generate({
    seed,
    seasonNumber,
    cols: 8,
    rows: 6,
    tileSize: 180,
    width: 2200,
    height: 2200
  });
  window.AttritionMapData.seasonNumber = seasonNumber;
  window.AttritionMapData.seasonElapsedHours = elapsedHours % config.season.lengthHours;
  window.AttritionMapData.seasonStart = new Date(startMs + (seasonNumber - 1) * config.season.lengthHours * 3600000).toISOString();
})();