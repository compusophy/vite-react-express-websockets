## NWN Web RTS – Product Specification

### Vision
- Build a lightweight, sessionless, grid-based survival/RTS with simple controls, MMO persistence, and approachable systems: harvesting, building, crafting, skills, and trading.
- Prioritize clarity, mobile usability, and minimal UI: one “smart interact” center button + a compact DPad.

### Current Gameplay Overview
- **World**: 24×24 grid. Deterministic resource layout by seed; server validates with same generator.
- **Resources**: `open`, `wood`, `oak` (rarer wood), `stone`, `gold`, `diamond`.
  - Oak is ~20% of wood cells; yields more wood and XP.
- **Players**: small set of fields, persist in `database.json`. Movement is 4-directional, server-authoritative.
- **Skills**: `woodcutting`, `mining`, `building`; XP to level is `level * 100`.
- **Cooldowns**: Global per-action ~1s shared across movement/harvest/build/trade to gate actions.
- **Trading**: Two-way window, proximity-gated (Manhattan ≤ 3), offers, ready, confirm.
- **Crafting**: Workbench-gated recipes to upgrade tools with skill requirements.
- **Building**: Walls (wood or stone cost) and workbench; rules prevent placement on resources/players.

### Controls and UI/UX
- **Canvas**: Responsive, golden-ratio sizing; drawn map + icons.
- **DPad**: 3×3 grid
  - Corners: tools (Pickaxe, Axe, Hammer)
  - Arrows: movement (now share cooldown overlay)
  - Center: Lucide `SquareMousePointer` = Smart Interact
- **Smart Interact precedence** (front-of-player tile):
  1) Trade if facing adjacent player
  2) Open crafting if on/adjacent to a workbench
  3) Harvest resource using correct tool (axe for wood/oak; pickaxe for ore)
  4) Place/remove wall if allowed
  5) Otherwise attempt a step move
- **Cooldown affordance**: semi-transparent fill on tool buttons and arrows.
- **Skill rings**: Subtle ring + small “Lv X” badge on related tool buttons
  - Woodcutting → Axe: green `#22c55e`
  - Mining → Pickaxe: blue `#60a5fa`
  - Building → Hammer: amber `#f59e0b`
  - Short glow pulse on XP gain

### Systems
#### Resource Generation
- Golden ratio distribution across `open/wood/stone/gold/diamond`, then promote ~20% of wood to `oak`.
- Client mirrors server algorithm for collision prediction; server is authoritative.

#### Harvesting
- Adjacent only, single-tile, disallowed if occupied by player.
- Tool gating: axe for wood/oak; pickaxe for ore; gold needs stone+ or better pickaxe.
- XP awards:
  - Oak > Wood (higher XP, more wood)
  - Stone/Gold/Diamond → Mining XP
- On harvest: mark tile harvested and spawn same-type resource somewhere open.

#### Building
- Place/remove walls; cannot place on players or unharvested resource tiles.
- Costs: wall = 4 wood or 4 stone; workbench = 10 wood + 5 stone.
- Building XP: wall +8, workbench +20.

#### Crafting (Workbench Only)
- `upgrade_pickaxe_stone`: cost 12 stone, Mining ≥ 2 → pickaxe: stone
- `upgrade_pickaxe_gold`: cost 8 gold + 20 stone, Mining ≥ 6 → pickaxe: gold
- `upgrade_axe_stone`: cost 10 stone, Woodcutting ≥ 2 → axe: stone

#### Trading
- Proximity ≤ 3. Flow: invite → accept → both Ready → both Confirm → exchange.
- Offers limited by current inventory at confirm time; server revalidates.

### Networking API (Socket.IO)
- Client → Server:
  - `player_move` { x, y }
  - `place_block` { x, y, type: 'wall'|'workbench' }
  - `harvest` { x, y, tool: 'axe'|'pickaxe' }
  - `craft` { recipe }
  - `trade_request` { targetId }
  - `trade_accept` { fromId }, `trade_decline` { fromId }
  - `trade_offer` { partnerId, offer: { wood, stone, gold, diamond } }
  - `trade_ready` { partnerId, ready }, `trade_confirm` { partnerId }, `trade_cancel` { partnerId }
  - `set_map_seed` { seed }, `reset_blocks` {}
  - `player_respawn` {}
- Server → Client:
  - `welcome` { gameState, playerId }
  - `player_joined` { player }, `player_reactivated` { player }, `player_left` { playerId }
  - `player_moved` { playerId, x, y }, `player_position` { playerId, x, y }
  - `block_added` { x, y, type, material }, `block_removed` { x, y }, `blocks_reset` {}
  - `harvested` { x, y, type, playerId, inventory, skills }
  - `resource_spawned` { x, y, type }
  - `inventory_update` { playerId, inventory }, `tools_update` { playerId, tools }
  - `map_seed` { seed }
  - `trade_invite` { fromId, fromName }, `trade_declined` { byId, byName }
  - `trade_open` { aId, bId, offers, ready, confirmed }, `trade_update` { offers, ready, confirmed }
  - `trade_complete` {}, `trade_cancelled` { reason }
  - `player_died` { playerId }, `player_respawned` { player, oldPlayerId }

### Data Model (Selected)
- `gameState`: { players: Record<id, Player>, nextPlayerId, blocks[], mapSeed, harvested[], spawnedResources[] }
- `Player`: { id, socketId, name, x, y, color, isActive, hp, inventory{ wood, stone, gold, diamond }, tools{ pickaxe, axe }, items[], skills{ mining{ level,xp }, woodcutting{ level,xp }, building{ level,xp } } }
- `Block`: { x, y, type: 'wall'|'workbench', material?: 'wood'|'stone' }

### UX Principles
- Minimal chrome; rely on context-aware center button.
- Clear feedback on cooldowns and XP progression without noisy overlays.
- Consistent iconography: Lucide icons; avoid bespoke SVG unless necessary.

### Roadmap (Near-Term)
- More crafting recipes (armor, tools tiers, workbench upgrades)
- Additional resource variants (e.g., iron), biome tiles, and refined RNG distributions
- Inventory/Equipment modal (compact, mobile-first)
- Building variety (doors, floors), blueprint costs, and refund rules
- Trading quality-of-life (item stacks, cancel reasons, rate limiting)
- Persistence upgrades and auth (user accounts)
- Accessibility: colorblind-safe ring colors and scalable UI

### Development Notes
- Client: Vite + React, `lucide-react` icons, CSS in `index.css`.
- Server: Node + Socket.IO, flat JSON persistence.
- Map seed is authoritative on server; clients mirror for UX predictions.
- Cooldown is enforced on server; client mirrors for responsiveness.

### Contribution Guidelines
- Match the existing code style (explicit names, early returns, minimal comments, avoid unnecessary try/catch, small components).
- Maintain socket event contracts. Extend with backwards-compatible payloads where possible.
- Prefer Lucide icons for UI consistency.


