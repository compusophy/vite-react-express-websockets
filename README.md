## NWN-WS — Real‑Time Grid Sandbox (Mobile‑First)

Minimal, fast, and readable. Gather → craft → build → interact. Inspired by Rust and Minecraft (resources/building), Runescape (skills/tools), and League of Legends (clarity and feedback).

### Live
- Play the game: [Hosted Client](https://soothing-possibility-production.up.railway.app)
- Server endpoint: [Hosted Server](https://calm-simplicity-production.up.railway.app)

### What you get
- 24×24 grid, golden‑ratio resource distribution and regeneration
- Server‑authoritative movement, collisions, harvesting, and building
- Deterministic PRNG for map and resources (client/server parity)
- Skills and tool gating: mining vs woodcutting, pickaxe tiers
- HiDPI canvas rendering; responsive D‑pad UI
- Persistent state saved to JSON with periodic autosave

## Gameplay Overview

- Move on the grid, collect resources, craft/build structures, and interact with players.
- Harvesting is tool‑specific:
  - Mining: pickaxe on stone, gold, diamond (gold requires stone+ pickaxe)
  - Woodcutting: axe on trees
- Building: hammer places or removes a block on the targeted cell, consuming materials.
- Resources regenerate: harvested node respawns elsewhere as the same type.
- Death/respawn flow supported; input disabled when dead; respawn reuses your player ID.

## Controls and UI

- Movement: D‑pad arrows (desktop click on canvas also chooses a direction).
- Center button: Harvest tool (shows Pickaxe or Axe icon based on current mode). Press to arm; press an arrow to execute. Shares cooldown with other actions.
- Top‑right button: Axe. Toggles woodcutting mode and arms harvest (arrows enable only toward trees).
- Bottom‑left button: Hammer. Toggles build mode (place/remove; arrows reflect valid placements).
- Bottom‑right panel: Always‑visible 3×3 inventory grid (items such as `pickaxe_wood`, `hammer`, `axe_wood`).
- Directional availability: arrows enable only if that action is valid for the armed tool/spell.

## Features

- Golden‑ratio resource distribution: wood, stone, gold, diamond
- Regenerative resources on harvest
- Server‑authoritative simulation; client prediction + reconciliation
- Unit collision: no stacking; blocks and resources block movement
- Skills: mining and woodcutting (level×100 XP curve; bonus yield per 5 levels)
- Tools: `tools.pickaxe` tier tracked on server; gold requires stone+ pickaxe
- Structures: wall (costs wood or stone), workbench (costs wood+stone)
- HiDPI canvas drawing with adaptive sizing and Golden Ratio layout

## Architecture

- Frontend: React + Vite, HTML5 Canvas, Lucide React, Socket.IO Client
- Backend: Node.js + Express, Socket.IO, JSON persistence, deterministic xorshift32 PRNG
- Deployment: Railway services for client and server; CORS locked to trusted domains

### Data Model (server)
- `gameState.players[id]`: `{ id, socketId, name, x, y, color, isActive, hp, inventory, tools, items, skills }`
- `gameState.blocks`: `[{ x, y, type: 'wall'|'workbench', material? }]`
- `gameState.harvested`: `[{ x, y }]` (marks base resources taken)
- `gameState.spawnedResources`: `[{ x, y, type }]` (regenerations)
- `gameState.projectiles`: ephemeral in‑flight projectiles (not persisted)

### Socket Events
- Server → Client
  - `welcome { gameState, playerId }`
  - `player_joined { player }`, `player_reactivated { player }`, `player_left { playerId }`
  - `player_moved { playerId, x, y }`, `player_position { playerId, x, y }`
  - `block_added { x, y, type, material? }`, `block_removed { x, y }`, `blocks_reset`
  - `inventory_update { playerId, inventory }`, `map_seed { seed }`
  - `harvested { x, y, type, playerId, inventory, skills }`, `resource_spawned { x, y, type }`
  - `player_died { playerId }`, `player_respawned { player, oldPlayerId }`
- Client → Server
  - `player_move { x, y }`
  - `place_block { x, y, type }` (type: `wall` or `workbench`)
  - `harvest { x, y, tool }` (tool: `pickaxe` or `axe`)
  - `set_map_seed { seed }`, `reset_blocks`, `player_respawn`
  - (no projectile events)

## Project Structure

```
nwn-ws/
├── client/
│   ├── src/
│   │   ├── App.jsx            # Socket wiring, UI logic, input mapping
│   │   ├── GameCanvas.jsx     # HiDPI canvas rendering
│   │   ├── DPad.jsx           # Responsive D‑pad + inventory panel
│   │   └── index.css          # Global styles
│   ├── vite.config.js
│   ├── package.json
│   └── railway.toml
├── server/
│   ├── index.js               # Express + Socket.IO, game loop & rules
│   ├── package.json
│   └── railway.toml
└── README.md
```

## Getting Started

### Requirements
- Node.js 18+
- npm 9+

### Local run
1) Install dependencies
```
cd server && npm install
cd ../client && npm install
```
2) Start server
```
cd server && npm start
```
3) Start client (in a new terminal)
```
cd client && npm run dev
```
4) Open the client at `http://localhost:5173`

## Balancing & Mechanics

- XP: level increases when XP ≥ level×100; overflow carries to next level
- Mining yields: stone +1 per 5 levels; gold bonus capped at +1
- Woodcutting yields: wood +1 per 5 levels
- Building costs:
  - Wall: 4 wood or 4 stone
  - Workbench: 10 wood + 5 stone

## Performance & Quality

- HiDPI canvas: logical CSS size with device‑pixel scaling
- Deterministic resource map: client/server parity via xorshift32
- Autosave: every 5 minutes; projectiles not persisted
- Client prediction with server reconciliation for smooth movement

## Deployment (Railway)

1) Server service
```
cd server
railway login
railway link
railway up
```
2) Client service
```
cd client
railway add
railway up
```
Runtime notes
- Server binds `0.0.0.0:$PORT`
- Client uses production server URL at build time; CORS allows Railway domains

## Roadmap

- Hammer placement selector (cycle wall/workbench)
- Workbench interaction + minimal 3×3 crafting UI (Stone Pickaxe first)
- Surface current pickaxe tier and skill levels in UI (compact)
- Item pickup/crafting flow to fill the 3×3 inventory
- Simple item selector/use (switch pickaxe tiers)

## License

MIT

## Credits

- Icons: Lucide React
- Hosting: Railway
- Inspirations: Rust, Minecraft, Runescape, League of Legends