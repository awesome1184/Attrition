# Attrition

Early playable browser prototype for the Attrition strategy game.

## Current demo

The prototype currently includes:

- Seven resources: Food, Wood, Stone, Iron, Oil, Mana Crystals, and Gold.
- A settlement screen with functional construction and resource production.
- Military buildings and six trainable army unit types.
- Army power, population, upkeep, and wounded-troop recovery.
- Portal Expedition PvE with connected territory conquest.
- A Tier II test portal, the **Shattered Realm**, including a Wild Mana modifier.
- Portal rewards and a final Rift Citadel objective.
- A first-pass persistent **World Map** prototype in `world.html` with provinces, factions, resource deposits, settlements, and guild claims.
- A world simulation tick model where **1 tick = 10 game minutes**. The world-map prototype automatically processes one tick every 10 real minutes and exposes debug tick stepping.
- Local browser autosave through `localStorage`.
- Debug tools for rapid balance testing.

## World map

Open `world.html` from the GitHub Pages site to inspect the strategic world-map prototype. The current map is deliberately small and abstract so we can iterate on territory size, geography, resource placement, faction borders, and movement rules before building a much larger generated map.

## Debug controls

Press **`** (backtick) or the **Debug** button where available.

The main demo has resource, army, building, portal, loss, time-skip, and reset tools. The world-map prototype has tick stepping, troop/population boosts, guild-claim testing, and world reset.

## Running it

The project is static HTML/JavaScript and can be hosted as a GitHub Pages site. No build step or external dependencies are required.

## Design direction

The prototype is intentionally not a finished game. It exists to test the core loop:

**Economy → Army → Campaign → Losses → Recovery → Economy**

The next major systems are planned around the persistent world: movement, settlements, guild territories, diplomacy, PvP wars, coordinated attacks, supply lines, portals, deeper magic, industrial warfare, and server-authoritative multiplayer state.
