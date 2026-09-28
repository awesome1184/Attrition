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

`simulation.js` remains as a browser-side fallback so the map can still render when no server is available. When the Attrition server is reachable, `multiplayer.js` replaces its public API with a server-backed client bridge.

The authoritative game server is in `server/`. It owns the shared world state, player sessions, resources, construction, armies, battles, diplomacy, portals, scouting visibility, and the hourly season clock. Runtime state is persisted in `server/data/world.json`.

Game time advances continuously at one game hour per real hour. The server advances the world even when no players are connected and catches up elapsed hours after a restart.

### Multiplayer boundary

- `server/game-engine.js`: authoritative game rules and mutable shared state.
- `server/server.js`: HTTP API, sessions, static game hosting, and the real-time clock loop.
- `multiplayer.js`: browser client bridge. UI actions are requests; snapshots from the server are the source of truth.
- `server/data/world.json`: runtime state. It is ignored by Git and must live on the server host.

The current session system is intentionally lightweight for development. It identifies a browser with a persistent random token, not a full account system. Passwords, email identity, database replication, matchmaking, and WebSockets are future production infrastructure.

## Procedural generation

The world is generated deterministically from the current season seed. `map-data.js` uses the same season configuration as the server so the client and server agree on map geometry and the active season.

The current world uses an 8x6 territory grid with 180-unit tiles. The grid topology remains regular and adjacent, while terrain, resources, settlements, roads, rivers, ownership, and starting positions are generated from the seed.
