import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      // Allow Railway domains and localhost
      const allowedOrigins = [
        "https://soothing-possibility-production.up.railway.app",
        "https://calm-simplicity-production.up.railway.app",
        "http://localhost:5173",
        "http://localhost:5174"
      ];
      
      if (allowedOrigins.includes(origin) || origin.endsWith('.up.railway.app')) {
        return callback(null, true);
      }
      
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;
const DATABASE_FILE = 'database.json';
const SAVE_INTERVAL = 5 * 60 * 1000; // 5 minutes - much more reasonable
const GRID_COLS = 24;
const GRID_ROWS = 24;
const PHI = 0.61803;

// Simple game state - just players
let gameState = {
  players: {},
  nextPlayerId: 1,
  blocks: [], // array of { x, y }
  mapSeed: Math.floor(Math.random() * 1e9),
  // projectiles removed
  harvested: [], // array of { x, y }
  spawnedResources: [] // array of { x, y, type }
};

// In-memory trade sessions
// key: `${minId}-${maxId}` => {
//   a: playerIdLow, b: playerIdHigh,
//   offers: { [playerId]: { wood, stone, gold, diamond } },
//   ready: { [playerId]: boolean },
//   confirmed: { [playerId]: boolean }
// }
const trades = new Map();
const getTradeKey = (id1, id2) => {
  const a = Math.min(Number(id1) || 0, Number(id2) || 0);
  const b = Math.max(Number(id1) || 0, Number(id2) || 0);
  return `${a}-${b}`;
}
const endTrade = (key, reason = 'cancelled') => {
  const session = trades.get(key);
  if (!session) return;
  const pa = gameState.players[session.a];
  const pb = gameState.players[session.b];
  if (pa && pa.isActive && pa.socketId) io.to(pa.socketId).emit('trade_cancelled', { reason });
  if (pb && pb.isActive && pb.socketId) io.to(pb.socketId).emit('trade_cancelled', { reason });
  trades.delete(key);
}

// Helper function to generate a random color for players
function generateRandomColor() {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Find nearest open, unoccupied spawn cell starting from center
function findSpawnCell() {
  const isCellAvailable = (x, y) => {
    if (x < 0 || x >= GRID_COLS || y < 0 || y >= GRID_ROWS) return false;
    // not on resource
    const type = getCellType(x, y, gameState.mapSeed);
    if (type && type !== 'open') return false;
    // not on earth block
    if ((gameState.blocks || []).some(b => b.x === x && b.y === y)) return false;
    // not on active player
    if (Object.values(gameState.players).some(p => p.isActive && p.x === x && p.y === y)) return false;
    return true;
  };
  const startX = Math.floor(GRID_COLS / 2);
  const startY = Math.floor(GRID_ROWS / 2);
  if (isCellAvailable(startX, startY)) return { x: startX, y: startY };
  // Spiral/ring search up to full grid
  const maxRadius = Math.max(GRID_COLS, GRID_ROWS);
  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const candidates = [
        { x: startX + dx, y: startY - r },
        { x: startX + dx, y: startY + r }
      ];
      for (const c of candidates) {
        if (isCellAvailable(c.x, c.y)) return c;
      }
    }
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      const candidates = [
        { x: startX - r, y: startY + dy },
        { x: startX + r, y: startY + dy }
      ];
      for (const c of candidates) {
        if (isCellAvailable(c.x, c.y)) return c;
      }
    }
  }
  // Fallback
  return { x: startX, y: startY };
}

// Helper function to create a new player
function createPlayer(playerId, socketId) {
  const spawn = findSpawnCell();
  return {
    id: playerId,
    socketId: socketId,
    name: `Player ${playerId}`,
    x: spawn.x,
    y: spawn.y,
    color: generateRandomColor(),
    isActive: true,
    hp: 100,
    inventory: { wood: 0, stone: 0, gold: 0, diamond: 0 },
    tools: { pickaxe: 'wood', axe: 'wood' },
    items: [
      { type: 'pickaxe_wood' },
      { type: 'hammer' },
      { type: 'axe_wood' }
    ],
    skills: {
      mining: { level: 1, xp: 0 },
      woodcutting: { level: 1, xp: 0 }
    }
  };
}

function sanitizeLoadedState(loaded) {
  const sanitized = {
    players: {},
    nextPlayerId: 1,
    blocks: [],
    mapSeed: Math.floor(Math.random() * 1e9),
    projectiles: [],
    harvested: [],
    spawnedResources: []
  };

  if (loaded && typeof loaded === 'object') {
    if (loaded.players && typeof loaded.players === 'object' && !Array.isArray(loaded.players)) {
      sanitized.players = loaded.players;
    }
    if (Number.isInteger(loaded.nextPlayerId) && loaded.nextPlayerId > 0) {
      sanitized.nextPlayerId = loaded.nextPlayerId;
    } else {
      const maxId = Object.keys(sanitized.players).reduce((m, k) => Math.max(m, Number(k) || 0), 0);
      sanitized.nextPlayerId = maxId + 1;
    }
    if (Array.isArray(loaded.blocks)) {
      sanitized.blocks = loaded.blocks
        .filter(b => b && Number.isInteger(b.x) && Number.isInteger(b.y))
        .map(b => ({ x: Math.max(0, Math.min(23, b.x)), y: Math.max(0, Math.min(23, b.y)) }));
    }
    if (Number.isInteger(loaded.mapSeed) && loaded.mapSeed >= 0) {
      sanitized.mapSeed = loaded.mapSeed;
    }
    // drop legacy projectiles
    if (Array.isArray(loaded.harvested)) {
      sanitized.harvested = loaded.harvested
        .filter(h => h && Number.isInteger(h.x) && Number.isInteger(h.y))
        .map(h => ({ x: Math.max(0, Math.min(23, h.x)), y: Math.max(0, Math.min(23, h.y)) }))
    }
    if (Array.isArray(loaded.spawnedResources)) {
      sanitized.spawnedResources = loaded.spawnedResources
        .filter(s => s && Number.isInteger(s.x) && Number.isInteger(s.y) && typeof s.type === 'string')
        .map(s => ({ x: Math.max(0, Math.min(23, s.x)), y: Math.max(0, Math.min(23, s.y)), type: s.type }))
    }
  }

  // Ensure no duplicates in blocks
  const seen = new Set();
  sanitized.blocks = sanitized.blocks.filter(b => {
    const key = `${b.x},${b.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Mark players inactive at boot and ensure hp/inventory exists
  Object.values(sanitized.players).forEach(p => {
    p.isActive = false;
    p.socketId = null;
    if (typeof p.hp !== 'number' || !Number.isFinite(p.hp)) p.hp = 100;
    if (!p.inventory || typeof p.inventory !== 'object') {
      p.inventory = { wood: 0, stone: 0, gold: 0, diamond: 0 }
    } else {
      p.inventory.wood = Number(p.inventory.wood) || 0
      p.inventory.stone = Number(p.inventory.stone) || 0
      p.inventory.gold = Number(p.inventory.gold) || 0
      p.inventory.diamond = Number(p.inventory.diamond) || 0
    }
    if (!p.tools || typeof p.tools !== 'object') {
      p.tools = { pickaxe: 'wood', axe: 'wood' }
    }
    if (!Array.isArray(p.items)) {
      p.items = [{ type: 'pickaxe_wood' }, { type: 'hammer' }]
    } else {
      // cap to 9 slots
      p.items = p.items.slice(0, 9)
    }
    if (!p.skills || typeof p.skills !== 'object') {
      p.skills = {
        mining: { level: 1, xp: 0 },
        woodcutting: { level: 1, xp: 0 }
      }
    } else {
      const m = p.skills.mining || {}
      const w = p.skills.woodcutting || {}
      p.skills.mining = { level: Number(m.level) || 1, xp: Number(m.xp) || 0 }
      p.skills.woodcutting = { level: Number(w.level) || 1, xp: Number(w.xp) || 0 }
    }
  });

  return sanitized;
}

// Deterministic PRNG (xorshift32)
function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17; s >>>= 0;
    s ^= s << 5;  s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}

// Build a golden-ratio distributed resource map like the client
function buildResourceTypes(seed) {
  const total = GRID_COLS * GRID_ROWS;
  const rng = makeRng(seed);
  const indices = Array.from({ length: total }, (_, i) => i);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  const openCount = Math.round(PHI * total);
  const rem1 = total - openCount;
  const treesCount = Math.round(PHI * rem1);
  const rem2 = rem1 - treesCount;
  const stoneCount = Math.round(PHI * rem2);
  const rem3 = rem2 - stoneCount;
  const goldCount = Math.round(PHI * rem3);
  const rem4 = rem3 - goldCount;
  const diamondCount = Math.round(PHI * rem4);
  const types = new Array(total).fill('open');
  let idx = 0;
  idx += openCount;
  for (let k = 0; k < treesCount && idx + k < total; k++) types[indices[idx + k]] = 'wood';
  idx += treesCount;
  for (let k = 0; k < stoneCount && idx + k < total; k++) types[indices[idx + k]] = 'stone';
  idx += stoneCount;
  for (let k = 0; k < goldCount && idx + k < total; k++) types[indices[idx + k]] = 'gold';
  idx += goldCount;
  for (let k = 0; k < diamondCount && idx + k < total; k++) types[indices[idx + k]] = 'diamond';
  return types;
}

function getCellType(x, y, seed) {
  if (x < 0 || x >= GRID_COLS || y < 0 || y >= GRID_ROWS) return 'open';
  const types = buildResourceTypes(seed);
  const idx = y * GRID_COLS + x;
  // Dynamic overrides: harvested removes resource; spawnedResources adds resource
  if ((gameState.harvested || []).some(h => h.x === x && h.y === y)) return 'open'
  const spawn = (gameState.spawnedResources || []).find(s => s.x === x && s.y === y)
  if (spawn && typeof spawn.type === 'string') return spawn.type
  return types[idx] || 'open';
}

// Load game state from database.json
function loadGameState() {
  try {
    if (fs.existsSync(DATABASE_FILE)) {
      const data = fs.readFileSync(DATABASE_FILE, 'utf8');
      const loadedState = JSON.parse(data);

      const sanitized = sanitizeLoadedState(loadedState);
      gameState = sanitized;

      console.log('Game state loaded from database.json (sanitized)');
      console.log(`Loaded ${Object.keys(gameState.players).length} players (all marked inactive)`);

      // Persist sanitized structure back to disk to drop obsolete fields
      saveGameState();
    } else {
      console.log('No database found, starting with fresh state');
    }
  } catch (error) {
    console.error('Error loading game state:', error);
  }
}

// Save game state to database.json
function saveGameState() {
  try {
    const dataToSave = JSON.stringify(gameState, null, 2);
    fs.writeFileSync(DATABASE_FILE, dataToSave);
    console.log('Game state saved to database.json');
  } catch (error) {
    console.error('Error saving game state:', error);
  }
}

// Helper function to clean up old inactive players
function cleanupInactivePlayers() {
  const inactivePlayers = Object.values(gameState.players).filter(p => !p.isActive);
  if (inactivePlayers.length > 5) {
    const playersToRemove = inactivePlayers.slice(0, inactivePlayers.length - 5);
    playersToRemove.forEach(player => {
      delete gameState.players[player.id];
    });
    console.log(`Cleaned up ${playersToRemove.length} old inactive players`);
  }
}

// Initialize game state on startup
loadGameState();

// Set up periodic saving
setInterval(saveGameState, SAVE_INTERVAL);

// Set up periodic cleanup of inactive players (every 5 minutes)
setInterval(cleanupInactivePlayers, 5 * 60 * 1000);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`New user connected: ${socket.id}`);
  
  // Try to find an inactive player to reuse, or create a new one
  let player = Object.values(gameState.players).find(p => !p.isActive);
  let isNewPlayer = false;
  
  if (player) {
    // Reuse existing inactive player
    player.socketId = socket.id;
    player.isActive = true;
    player.hp = 100;
    console.log(`Reactivated existing player: ${player.name}`);
  } else {
    // Create new player
    const newPlayerId = gameState.nextPlayerId++;
    player = createPlayer(newPlayerId, socket.id);
    gameState.players[newPlayerId] = player;
    isNewPlayer = true;
    console.log(`Created new player: ${player.name}`);
  }
  
  // Send welcome message with game state to the new player
  socket.emit('welcome', {
    gameState: gameState,
    playerId: player.id
  });
  
  // Broadcast to all other clients that a player joined
  if (isNewPlayer) {
    socket.broadcast.emit('player_joined', {
      player: player
    });
  } else {
    socket.broadcast.emit('player_reactivated', {
      player: player
    });
  }
  
  // Handle player movement (server-authoritative collision)
  socket.on('player_move', (data) => {
    const { x, y } = data || {};
    const player = Object.values(gameState.players).find(p => p.socketId === socket.id);
    if (!player) return;
    // Disallow movement for dead/inactive players
    if (!player.isActive || (typeof player.hp === 'number' && player.hp <= 0)) {
      socket.emit('player_position', { playerId: player.id, x: player.x, y: player.y });
      return;
    }
    // Simple per-action cooldown (shared across actions)
    const now = Date.now();
    if (typeof player._lastActionAt === 'number' && now - player._lastActionAt < 950) {
      socket.emit('player_position', { playerId: player.id, x: player.x, y: player.y });
      return;
    }

    // Validate and clamp
    const targetX = Math.max(0, Math.min(23, Math.floor(Number(x))));
    const targetY = Math.max(0, Math.min(23, Math.floor(Number(y))));

    // If no movement, just confirm current position
    if (player.x === targetX && player.y === targetY) {
      socket.emit('player_position', { playerId: player.id, x: player.x, y: player.y });
      return;
    }

    // Reject if occupied by active other player
    const occupiedByOther = Object.values(gameState.players).some(p => p.isActive && p.id !== player.id && p.x === targetX && p.y === targetY);
    if (occupiedByOther) {
      socket.emit('player_position', { playerId: player.id, x: player.x, y: player.y });
      return;
    }

    // Reject if blocked by an earth block
    const blockedByEarth = (gameState.blocks || []).some(b => b.x === targetX && b.y === targetY);
    if (blockedByEarth) {
      socket.emit('player_position', { playerId: player.id, x: player.x, y: player.y });
      return;
    }

    // Reject if non-open resource tile
    const cellType = getCellType(targetX, targetY, gameState.mapSeed);
    const harvestedHere = (gameState.harvested || []).some(h => h.x === targetX && h.y === targetY)
    if (!harvestedHere && cellType && cellType !== 'open') {
      socket.emit('player_position', { playerId: player.id, x: player.x, y: player.y });
      return;
    }

    // Accept move
    player.x = targetX;
    player.y = targetY;
    player._lastActionAt = now;

    io.emit('player_moved', { playerId: player.id, x: targetX, y: targetY });
    socket.emit('player_position', { playerId: player.id, x: targetX, y: targetY });
    console.log(`Player ${player.name} moved to cell (${targetX}, ${targetY})`);
  });

  // Handle build placement/removal (hammer): supports 'wall' and 'workbench'
  socket.on('place_block', (data) => {
    const acting = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!acting || !acting.isActive || (typeof acting.hp === 'number' && acting.hp <= 0)) return
    const now = Date.now();
    if (typeof acting._lastActionAt === 'number' && now - acting._lastActionAt < 950) return
    const { x, y, type } = data || {}
    if (typeof x !== 'number' || typeof y !== 'number') return
    // clamp to grid 0..23
    const cx = Math.max(0, Math.min(23, Math.floor(x)))
    const cy = Math.max(0, Math.min(23, Math.floor(y)))
    const exists = gameState.blocks.some(b => b.x === cx && b.y === cy)
    const occupiedByPlayer = Object.values(gameState.players).some(p => p.isActive && p.x === cx && p.y === cy)
    if (exists) {
      // Remove existing block if not occupied by a player
      if (occupiedByPlayer) {
        console.log(`Reject block removal at (${cx}, ${cy}) - occupied by player`)
        return
      }
      gameState.blocks = gameState.blocks.filter(b => !(b.x === cx && b.y === cy))
      io.emit('block_removed', { x: cx, y: cy })
      console.log(`Block removed at (${cx}, ${cy})`)
      acting._lastActionAt = now
      saveGameState()
      return
    }
    // Add block path: ensure not on player and not on resource
    if (occupiedByPlayer) {
      console.log(`Reject block at (${cx}, ${cy}) - occupied by player`)
      return
    }
    const cellType = getCellType(cx, cy, gameState.mapSeed)
    const wasHarvested = (gameState.harvested || []).some(h => h.x === cx && h.y === cy)
    if (!wasHarvested && cellType !== 'open') {
      console.log(`Reject block at (${cx}, ${cy}) - resource cell: ${cellType}`)
      return
    }
    // Enforce simple costs for structures
    const inv = acting.inventory || { wood: 0, stone: 0, gold: 0 }
    let placed = null
    if (type === 'workbench') {
      const cost = { wood: 10, stone: 5 }
      if (inv.wood < cost.wood || inv.stone < cost.stone) {
        console.log(`Reject build at (${cx}, ${cy}) - insufficient materials for workbench`)
        return
      }
      inv.wood -= cost.wood
      inv.stone -= cost.stone
      placed = { x: cx, y: cy, type: 'workbench' }
    } else {
      // Wall can be built from 4 wood or 4 stone
      let material = null
      if (inv.wood >= 4) { inv.wood -= 4; material = 'wood' }
      else if (inv.stone >= 4) { inv.stone -= 4; material = 'stone' }
      else { console.log(`Reject build at (${cx}, ${cy}) - insufficient materials for wall`); return }
      placed = { x: cx, y: cy, type: 'wall', material }
    }
    acting.inventory = inv
    gameState.blocks.push(placed)
    io.emit('block_added', placed)
    console.log(`Block placed at (${cx}, ${cy}) type=${placed.type}`)
    io.emit('inventory_update', { playerId: acting.id, inventory: inv })
    // Building XP gain
    acting.skills = acting.skills || { mining: { level: 1, xp: 0 }, woodcutting: { level: 1, xp: 0 }, building: { level: 1, xp: 0 } }
    const b = acting.skills.building || { level: 1, xp: 0 }
    b.xp += placed.type === 'workbench' ? 20 : 8
    while (b.xp >= b.level * 100) { b.xp -= b.level * 100; b.level += 1 }
    acting.skills.building = b
    io.emit('harvested', { x: cx, y: cy, type: 'build', playerId: acting.id, inventory: acting.inventory, skills: acting.skills })
    acting._lastActionAt = now
    saveGameState()
  })

  // Harvest resource (collect and mark as harvested)
  socket.on('harvest', (data) => {
    const actor = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!actor || !actor.isActive || (typeof actor.hp === 'number' && actor.hp <= 0)) return
    const now = Date.now();
    if (typeof actor._lastActionAt === 'number' && now - actor._lastActionAt < 950) return
    const { x, y, tool } = data || {}
    if (!Number.isInteger(x) || !Number.isInteger(y)) return
    if (x < 0 || x > 23 || y < 0 || y > 23) return
    // Must be adjacent (4-dir) only
    const dist = Math.abs(actor.x - x) + Math.abs(actor.y - y)
    if (dist !== 1) return
    // Cannot harvest if already harvested
    if ((gameState.harvested || []).some(h => h.x === x && h.y === y)) return
    const type = getCellType(x, y, gameState.mapSeed)
    if (!type || type === 'open') return
    // Disallow harvesting if another active player stands on the cell
    const occupied = Object.values(gameState.players).some(p => p.isActive && p.x === x && p.y === y)
    if (occupied) return
    // Tool gating: require axe for wood; pickaxe for stone/gold/diamond; gold requires stone+ pickaxe
    const pickaxeTier = actor.tools?.pickaxe || 'wood'
    const axeTier = actor.tools?.axe || 'wood'
    if (type === 'wood') {
      if (tool !== 'axe') { console.log('Reject harvest: wood requires axe'); return }
      // axe tier gating can be added later
    } else {
      if (tool !== 'pickaxe') { console.log('Reject harvest: ore requires pickaxe'); return }
      if (type === 'gold' && (pickaxeTier !== 'stone' && pickaxeTier !== 'gold')) {
        console.log('Reject harvest: insufficient pickaxe tier for gold')
        return
      }
      // optional: diamond tier gating later
    }
    // Update inventory and mark harvested; grant skill XP and apply skill bonus yield
    actor.inventory = actor.inventory || { wood: 0, stone: 0, gold: 0, diamond: 0 }
    actor.skills = actor.skills || { mining: { level: 1, xp: 0 }, woodcutting: { level: 1, xp: 0 } }
    const grantXp = (skillKey, amount) => {
      const skill = actor.skills[skillKey] || { level: 1, xp: 0 }
      skill.xp += amount
      // Simple level-up curve: level*100 xp per level
      while (skill.xp >= skill.level * 100) {
        skill.xp -= skill.level * 100
        skill.level += 1
      }
      actor.skills[skillKey] = skill
    }
    const getBonus = (skill) => {
      // +1 material per 5 levels (e.g., lvl 1-4:0, 5-9:+1, 10-14:+2 ...)
      return Math.max(0, Math.floor((skill?.level || 1) / 5))
    }
    if (type === 'wood') {
      const bonus = getBonus(actor.skills.woodcutting)
      actor.inventory.wood += 1 + bonus
      grantXp('woodcutting', 10)
    } else if (type === 'stone') {
      const bonus = getBonus(actor.skills.mining)
      actor.inventory.stone += 1 + bonus
      grantXp('mining', 12)
    } else if (type === 'gold') {
      const bonus = getBonus(actor.skills.mining)
      actor.inventory.gold += 1 + Math.min(1, bonus) // gold scales slower
      grantXp('mining', 20)
    } else if (type === 'diamond') {
      const bonus = getBonus(actor.skills.mining)
      actor.inventory.diamond += 1 + Math.min(1, bonus)
      grantXp('mining', 35)
    }
    gameState.harvested.push({ x, y })
    // Spawn a new resource of the same type at a random open tile
    const candidates = []
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      for (let tx = 0; tx < GRID_COLS; tx++) {
        // Skip original location
        if (tx === x && ty === y) continue
        // Must be open currently
        if (getCellType(tx, ty, gameState.mapSeed) !== 'open') continue
        // No earth block
        if ((gameState.blocks || []).some(b => b.x === tx && b.y === ty)) continue
        // No player occupying
        if (Object.values(gameState.players).some(p => p.isActive && p.x === tx && p.y === ty)) continue
        candidates.push({ x: tx, y: ty })
      }
    }
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)]
      gameState.spawnedResources.push({ x: pick.x, y: pick.y, type })
      io.emit('resource_spawned', { x: pick.x, y: pick.y, type })
    }
    io.emit('harvested', { x, y, type, playerId: actor.id, inventory: actor.inventory, skills: actor.skills })
    actor._lastActionAt = now
    saveGameState()
  })

  // Player respawn request (reuse same player id; no total count increase)
  socket.on('player_respawn', () => {
    const player = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!player) return
    const spawn = findSpawnCell()
    player.x = spawn.x
    player.y = spawn.y
    player.hp = 100
    player.isActive = true
    io.emit('player_respawned', { player, oldPlayerId: player.id })
    saveGameState()
  })

  // Projectiles removed

  // Handle reset of all blocks (earth walls)
  socket.on('reset_blocks', () => {
    const acting = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!acting || !acting.isActive || (typeof acting.hp === 'number' && acting.hp <= 0)) return
    gameState.blocks = []
    io.emit('blocks_reset')
    console.log('All blocks reset by client request')
    // Persist immediately so DB clears placed blocks
    saveGameState()
  })

  // Reset all player skill levels to baseline
  socket.on('reset_levels', () => {
    const acting = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!acting || !acting.isActive || (typeof acting.hp === 'number' && acting.hp <= 0)) return
    Object.values(gameState.players).forEach(p => {
      if (!p) return
      p.skills = p.skills || { mining: { level: 1, xp: 0 }, woodcutting: { level: 1, xp: 0 }, building: { level: 1, xp: 0 } }
      p.skills.mining = { level: 1, xp: 0 }
      p.skills.woodcutting = { level: 1, xp: 0 }
      p.skills.building = { level: 1, xp: 0 }
      io.emit('skills_update', { playerId: p.id, skills: p.skills })
    })
    console.log('All player skills reset to level 1')
    saveGameState()
  })

  // ========== Trading ==========
  socket.on('trade_request', (data) => {
    const actor = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!actor || !actor.isActive || (typeof actor.hp === 'number' && actor.hp <= 0)) return
    const targetId = Number(data?.targetId)
    const target = gameState.players[targetId]
    if (!target || !target.isActive || !target.socketId) return
    // Prevent if either already trading
    const tkey = getTradeKey(actor.id, target.id)
    if (trades.has(tkey)) return
    // Optional proximity check (Manhattan distance <= 3)
    const dist = Math.abs(actor.x - target.x) + Math.abs(actor.y - target.y)
    if (dist > 3) return
    io.to(target.socketId).emit('trade_invite', { fromId: actor.id, fromName: actor.name })
  })

  socket.on('trade_decline', (data) => {
    const decliner = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!decliner) return
    const fromId = Number(data?.fromId)
    const inviter = gameState.players[fromId]
    if (inviter && inviter.isActive && inviter.socketId) {
      io.to(inviter.socketId).emit('trade_declined', { byId: decliner.id, byName: decliner.name })
    }
  })

  socket.on('trade_accept', (data) => {
    const acceptor = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!acceptor || !acceptor.isActive || (typeof acceptor.hp === 'number' && acceptor.hp <= 0)) return
    const fromId = Number(data?.fromId)
    const inviter = gameState.players[fromId]
    if (!inviter || !inviter.isActive || !inviter.socketId) return
    const key = getTradeKey(acceptor.id, inviter.id)
    if (trades.has(key)) return
    // Optional proximity check
    const dist = Math.abs(acceptor.x - inviter.x) + Math.abs(acceptor.y - inviter.y)
    if (dist > 3) return
    const emptyOffer = { wood: 0, stone: 0, gold: 0, diamond: 0 }
    const session = {
      a: Math.min(acceptor.id, inviter.id),
      b: Math.max(acceptor.id, inviter.id),
      offers: { [acceptor.id]: { ...emptyOffer }, [inviter.id]: { ...emptyOffer } },
      ready: { [acceptor.id]: false, [inviter.id]: false },
      confirmed: { [acceptor.id]: false, [inviter.id]: false }
    }
    trades.set(key, session)
    const openPayload = {
      aId: session.a, bId: session.b,
      aName: gameState.players[session.a]?.name,
      bName: gameState.players[session.b]?.name,
      offers: session.offers, ready: session.ready, confirmed: session.confirmed
    }
    io.to(gameState.players[session.a].socketId).emit('trade_open', openPayload)
    io.to(gameState.players[session.b].socketId).emit('trade_open', openPayload)
  })

  socket.on('trade_offer', (data) => {
    const actor = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!actor || !actor.isActive || (typeof actor.hp === 'number' && actor.hp <= 0)) return
    const partnerId = Number(data?.partnerId)
    const key = getTradeKey(actor.id, partnerId)
    const session = trades.get(key)
    if (!session) return
    const offer = data?.offer || {}
    const inv = actor.inventory || { wood: 0, stone: 0, gold: 0, diamond: 0 }
    const clamp = (v) => Math.max(0, Math.floor(Number(v) || 0))
    const newOffer = {
      wood: Math.min(inv.wood, clamp(offer.wood)),
      stone: Math.min(inv.stone, clamp(offer.stone)),
      gold: Math.min(inv.gold, clamp(offer.gold)),
      diamond: Math.min(inv.diamond || 0, clamp(offer.diamond))
    }
    session.offers[actor.id] = newOffer
    // Changing offer resets readiness/confirmations
    session.ready[session.a] = false
    session.ready[session.b] = false
    session.confirmed[session.a] = false
    session.confirmed[session.b] = false
    const payload = { offers: session.offers, ready: session.ready, confirmed: session.confirmed }
    const pa = gameState.players[session.a]
    const pb = gameState.players[session.b]
    if (pa?.socketId) io.to(pa.socketId).emit('trade_update', payload)
    if (pb?.socketId) io.to(pb.socketId).emit('trade_update', payload)
  })

  socket.on('trade_ready', (data) => {
    const actor = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!actor) return
    const partnerId = Number(data?.partnerId)
    const ready = !!data?.ready
    const key = getTradeKey(actor.id, partnerId)
    const session = trades.get(key)
    if (!session) return
    session.ready[actor.id] = ready
    // Changing ready resets confirmations
    session.confirmed[session.a] = false
    session.confirmed[session.b] = false
    const payload = { offers: session.offers, ready: session.ready, confirmed: session.confirmed }
    const pa = gameState.players[session.a]
    const pb = gameState.players[session.b]
    if (pa?.socketId) io.to(pa.socketId).emit('trade_update', payload)
    if (pb?.socketId) io.to(pb.socketId).emit('trade_update', payload)
  })

  socket.on('trade_confirm', (data) => {
    const actor = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!actor) return
    const partnerId = Number(data?.partnerId)
    const key = getTradeKey(actor.id, partnerId)
    const session = trades.get(key)
    if (!session) return
    // Must be ready
    if (!session.ready[session.a] || !session.ready[session.b]) return
    session.confirmed[actor.id] = true
    const bothConfirmed = session.confirmed[session.a] && session.confirmed[session.b]
    const pa = gameState.players[session.a]
    const pb = gameState.players[session.b]
    if (!bothConfirmed) {
      const payload = { offers: session.offers, ready: session.ready, confirmed: session.confirmed }
      if (pa?.socketId) io.to(pa.socketId).emit('trade_update', payload)
      if (pb?.socketId) io.to(pb.socketId).emit('trade_update', payload)
      return
    }
    // Finalize trade: revalidate balances
    const offerA = session.offers[session.a] || { wood: 0, stone: 0, gold: 0, diamond: 0 }
    const offerB = session.offers[session.b] || { wood: 0, stone: 0, gold: 0, diamond: 0 }
    const invA = pa.inventory || { wood: 0, stone: 0, gold: 0, diamond: 0 }
    const invB = pb.inventory || { wood: 0, stone: 0, gold: 0, diamond: 0 }
    const hasEnough = (inv, off) => inv.wood >= off.wood && inv.stone >= off.stone && inv.gold >= off.gold && (inv.diamond || 0) >= (off.diamond || 0)
    if (!hasEnough(invA, offerA) || !hasEnough(invB, offerB)) {
      // fail safe: cancel
      endTrade(key, 'insufficient_resources')
      return
    }
    // Apply transfer
    invA.wood -= offerA.wood; invA.stone -= offerA.stone; invA.gold -= offerA.gold; invA.diamond = (invA.diamond || 0) - (offerA.diamond || 0)
    invB.wood += offerA.wood; invB.stone += offerA.stone; invB.gold += offerA.gold; invB.diamond = (invB.diamond || 0) + (offerA.diamond || 0)
    invB.wood -= offerB.wood; invB.stone -= offerB.stone; invB.gold -= offerB.gold; invB.diamond = (invB.diamond || 0) - (offerB.diamond || 0)
    invA.wood += offerB.wood; invA.stone += offerB.stone; invA.gold += offerB.gold; invA.diamond = (invA.diamond || 0) + (offerB.diamond || 0)
    pa.inventory = invA
    pb.inventory = invB
    io.emit('inventory_update', { playerId: pa.id, inventory: invA })
    io.emit('inventory_update', { playerId: pb.id, inventory: invB })
    if (pa?.socketId) io.to(pa.socketId).emit('trade_complete')
    if (pb?.socketId) io.to(pb.socketId).emit('trade_complete')
    trades.delete(key)
    saveGameState()
  })

  socket.on('trade_cancel', (data) => {
    const actor = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!actor) return
    const partnerId = Number(data?.partnerId)
    const key = getTradeKey(actor.id, partnerId)
    endTrade(key, 'cancelled')
  })

  // Sync map seed from client so server validation matches client map
  socket.on('set_map_seed', (data) => {
    const acting = Object.values(gameState.players).find(p => p.socketId === socket.id)
    if (!acting || !acting.isActive || (typeof acting.hp === 'number' && acting.hp <= 0)) return
    const { seed } = data || {}
    if (!Number.isInteger(seed)) return
    gameState.mapSeed = seed >>> 0
    io.emit('map_seed', { seed: gameState.mapSeed })
    console.log(`Map seed updated to ${gameState.mapSeed}`)
    saveGameState()
  })
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    const player = Object.values(gameState.players).find(p => p.socketId === socket.id);
    if (player) {
      player.isActive = false;
      player.socketId = null;
      
      socket.broadcast.emit('player_left', {
        playerId: player.id
      });
      
      console.log(`Player ${player.name} marked as inactive`);
      // End any active trade session with this player
      Object.values(gameState.players).forEach(other => {
        if (!other || !other.id) return
        const key = getTradeKey(player.id, other.id)
        if (trades.has(key)) endTrade(key, 'partner_disconnected')
      })
    }
  });
});

// Basic express route for health check
app.get('/', (req, res) => {
  const activePlayers = Object.values(gameState.players).filter(p => p.isActive);
  const inactivePlayers = Object.values(gameState.players).filter(p => !p.isActive);
  
  res.json({
    message: 'RTS Game Server is running',
    totalPlayers: Object.keys(gameState.players).length,
    activePlayers: activePlayers.length,
    inactivePlayers: inactivePlayers.length,
    activeConnections: io.sockets.sockets.size
  });
});

// Route to reset game state
app.get('/reset', (req, res) => {
  gameState = {
    players: {},
    nextPlayerId: 1,
    blocks: []
  };
  saveGameState();
  
  res.json({
    message: 'Game state has been reset',
    gameState: gameState
  });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Game state auto-saves every ${SAVE_INTERVAL / 1000 / 60} minutes`);
});

// Graceful shutdown - save state before exit
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, saving game state and shutting down...');
  saveGameState();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, saving game state and shutting down...');
  saveGameState();
  process.exit(0);
});