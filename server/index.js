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
  mapSeed: Math.floor(Math.random() * 1e9)
};

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
    isActive: true
  };
}

function sanitizeLoadedState(loaded) {
  const sanitized = {
    players: {},
    nextPlayerId: 1,
    blocks: [],
    mapSeed: Math.floor(Math.random() * 1e9)
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
  }

  // Ensure no duplicates in blocks
  const seen = new Set();
  sanitized.blocks = sanitized.blocks.filter(b => {
    const key = `${b.x},${b.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Mark players inactive at boot
  Object.values(sanitized.players).forEach(p => {
    p.isActive = false;
    p.socketId = null;
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
    if (cellType && cellType !== 'open') {
      socket.emit('player_position', { playerId: player.id, x: player.x, y: player.y });
      return;
    }

    // Accept move
    player.x = targetX;
    player.y = targetY;

    io.emit('player_moved', { playerId: player.id, x: targetX, y: targetY });
    socket.emit('player_position', { playerId: player.id, x: targetX, y: targetY });
    console.log(`Player ${player.name} moved to cell (${targetX}, ${targetY})`);
  });

  // Handle block placement or removal (toggle)
  socket.on('place_block', (data) => {
    const { x, y } = data || {}
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
      saveGameState()
      return
    }
    // Add block path: ensure not on player and not on resource
    if (occupiedByPlayer) {
      console.log(`Reject block at (${cx}, ${cy}) - occupied by player`)
      return
    }
    const cellType = getCellType(cx, cy, gameState.mapSeed)
    if (cellType !== 'open') {
      console.log(`Reject block at (${cx}, ${cy}) - resource cell: ${cellType}`)
      return
    }
    gameState.blocks.push({ x: cx, y: cy })
    io.emit('block_added', { x: cx, y: cy })
    console.log(`Block placed at (${cx}, ${cy})`)
    saveGameState()
  })

  // Handle reset of all blocks (earth walls)
  socket.on('reset_blocks', () => {
    gameState.blocks = []
    io.emit('blocks_reset')
    console.log('All blocks reset by client request')
    // Persist immediately so DB clears placed blocks
    saveGameState()
  })

  // Sync map seed from client so server validation matches client map
  socket.on('set_map_seed', (data) => {
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