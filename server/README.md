# Attrition server

The browser is no longer the authority for the game. The Node server owns the shared world, player identities, resources, armies, battles, diplomacy, portals, and the hourly season clock.

## Run

Install Node 18+ and run `npm start`. Then open `http://localhost:8080`.

The server uses only Node's standard library. Runtime world state is stored in `server/data/world.json` and is not committed to Git.

## Multiplayer model

A browser receives a persistent session token. The token identifies a player on the server. Every command is validated against current server state, then a new snapshot is returned.

The server advances the world once per real hour and catches up elapsed hours after a restart. Construction, production, movement, combat, morale, scouting, and food upkeep continue without a browser tab being open.

This is an early authoritative multiplayer foundation, not a production account/security system. It does not yet provide passwords, email identity, a database cluster, matchmaking, or websocket transport.