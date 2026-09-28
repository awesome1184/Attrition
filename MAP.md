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
## Simulation

The map is backed by `simulation.js`, which owns the game state. `index.html` reads that state and renders it.

`simulation.js` currently provides:

- hourly world ticks with persistent browser save state
- Food, Wood, Stone, Iron, Oil, Mana, and Gold production with storage caps
- population growth, food upkeep, shortages, and morale pressure
- building construction queues for farms, mills, quarries, mines, oil wells, mana extractors, markets, barracks, workshops, and forts
- armies with unit composition, morale, supplies, recruitment, movement, and orders
- combat resolved over multiple ticks with terrain and fortification effects plus element interactions (`fire`, `gun`, `antitank`)
- territory claims and occupation
- delayed scouting reports for enemy territory
- faction relations and Gold-funded diplomacy changes
- temporary PvE portals with AI territory and rewards

## Simulation boundary

`map-data.js` describes the initial world. `simulation.js` turns that data into mutable state. `index.html` does not own economy, combat, or diplomacy rules. This separation is intentional so procedural maps and alternate renderers can use the same simulation later.

One real-world 20-second interval advances one game hour in the prototype. The Settings panel also exposes a manual one-hour advance control for testing.
