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
- Local browser autosave through `localStorage`.
- Debug tools for rapid balance testing.

## Debug controls

Press **`** (backtick) or the **Debug** button.

Available tools:

- Add resources
- Add army units
- Unlock all buildings and storage
- Complete the active portal
- Simulate army losses
- Advance game time by 1 or 8 hours
- Reset the local save

## Running it

The demo is a single `index.html` and can be hosted as a static GitHub Pages site. No build step or external dependencies are required.

## Design direction

The prototype is intentionally not a finished game. It exists to test the core loop:

**Economy → Army → Campaign → Losses → Recovery → Economy**

PvP warfare, guild coordination, multiplayer state, deeper magic, industrial warfare, AI behavior, and a larger procedural portal system are planned for later iterations.
