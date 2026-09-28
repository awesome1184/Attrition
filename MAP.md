# World Map

The world map is split into data and rendering so the map can grow without rewriting the game UI.

## Files

- `map-data.js`: world size, territories, terrain, resources, faction colors, roads, rivers, and default armies.
- `world-map.js`: reusable canvas map engine. It handles rendering, pan, zoom, selection, hit testing, and map redraws.
- `world.html`: standalone map view that uses the same engine.
- `index.html`: main game view. The World screen uses the same engine.

## Data model

Each territory has a small, editable definition:

`index, id, name, owner, resource, col, row, settlement, terrain, buildings, level, population, army`

The renderer does not own game state. It reads the state through `getState()`, so the same map can be used by a future server-backed simulation.

## Visual rules

The map uses physical objects to communicate mechanics:

- settlements are drawn as buildings
- resources are drawn as deposits or production sites
- armies are drawn as groups of units with faction banners
- roads and rivers are drawn as world geometry
- faction control is shown with a light territory tint and border
- territory names are not placed across the whole map

The selection panel can provide exact numbers when the player needs them.

## Extending the map

Add or change territory data in `map-data.js`. Add new terrain, resource, settlement, or building visuals as renderer methods in `world-map.js`.

The renderer uses deterministic geometry, so the same data produces the same map on every load.
