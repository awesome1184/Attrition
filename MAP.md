# World Map

The world map is the primary game surface. The game stays on the map at all times, with other systems exposed through small controls and contextual overlays.

## Files

- `map-data.js`: shared world data used by the map renderer and future simulation work.
- `world-map.js`: reusable canvas renderer retained for experiments and future advanced rendering.
- `index.html`: current map-first game shell. The visible map is native SVG/HTML so it is robust across browsers including Firefox.
- `world.html`: entry point that redirects to the map-first shell.

## Visual rules

The current map uses an oblique tabletop-style perspective rather than a flat top-down presentation. Territory control, terrain, settlements, resources, roads, rivers, and armies are visible directly on the world.

The selected territory is visually lifted from the board and surrounded by a radial action menu.

## Interaction

Click a territory to select it. The selection:

1. highlights the territory
2. plays a pulse/lift animation
3. expands six contextual actions around the tile

The action set changes with territory ownership:

`Details`, `Build/Scout`, `Move/Attack`, `Army/Claim`, `Relations`, and `View`.

Dragging pans the map and the mouse wheel changes its scale. Resource controls, settlement, army, portal, log, and settings are compact overlays rather than separate game screens.

## Implementation note

The main interface no longer depends on the canvas renderer loading successfully. This is intentional: a browser-side rendering exception should not turn the entire game into a blank page. The SVG map provides the core interface, while the older `world-map.js` renderer can evolve independently.