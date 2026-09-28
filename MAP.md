# World Map

The world map is the primary game surface. Other game systems are opened as compact controls or overlays so the map never disappears.

## Files

- `map-data.js`: world size, territories, terrain, resources, factions, roads, rivers, settlements, and default armies.
- `world-map.js`: reusable canvas map engine. It handles angled projection, terrain and infrastructure rendering, pan, zoom, tile selection, selection animation, and radial action hit testing.
- `index.html`: map-first game shell with resource buttons and compact overlays.
- `world.html`: entry point that uses the same map-first game shell.

## Map model

Territories remain data-driven:

`index, id, name, owner, resource, col, row, settlement, terrain, buildings, level, population, roads, army`

The renderer reads runtime state through `getState()`, keeping map presentation separate from the simulation state.

## Visual rules

The map uses physical objects to communicate mechanics:

- territory control uses subtle faction tinting and flags
- terrain is shown with fields, forests, hills, and coastlines
- settlements are drawn as buildings instead of UI cards
- resources are shown as deposits or production-site markers
- armies are shown as groups with faction banners
- roads and rivers are world geometry
- the camera uses an oblique/isometric-style projection instead of a flat top-down view
- the selected territory lifts from the board, gains a bright outline, and emits a radial action menu
- exact information can be opened through the radial Details action or the small map overlays

## Interaction

Clicking a territory selects it. The selection animation raises the tile and expands six contextual actions around it.

The radial actions are:

`Details`, `Build/Scout`, `Move/Attack`, `Army/Claim`, `Relations`, and `View`

The action set changes from the selected territory's owner and context. Dragging pans the world, the mouse wheel zooms, and the Home button fits the complete world to the viewport.

## Extending the map

Add or change territory data in `map-data.js`. Add new terrain, resource, settlement, or building visuals in `world-map.js`.

The renderer uses deterministic geometry so the same data produces the same landscape on every load.