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

// Simple game state - just players
let gameState = {
  players: {},
  nextPlayerId: 1
};

// Helper function to generate a random color for players
function generateRandomColor() {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Helper function to create a new player
function createPlayer(playerId, socketId) {
  return {
    id: playerId,
    socketId: socketId,
    name: `Player ${playerId}`,
    x: 12, // Cell coordinate (center of 24x24 grid)
    y: 12,
    color: generateRandomColor(),
    isActive: true
  };
}

// Load game state from database.json
function loadGameState() {
  try {
    if (fs.existsSync(DATABASE_FILE)) {
      const data = fs.readFileSync(DATABASE_FILE, 'utf8');
      const loadedState = JSON.parse(data);
      
      gameState = {
        ...gameState,
        ...loadedState
      };
      
      // Mark all loaded players as inactive since their socket connections are dead
      Object.values(gameState.players).forEach(player => {
        player.isActive = false;
        player.socketId = null;
      });
      
      console.log('Game state loaded from database.json');
      console.log(`Loaded ${Object.keys(gameState.players).length} players (all marked inactive)`);
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
  
  // Handle player movement
  socket.on('player_move', (data) => {
    const { x, y } = data;
    const player = Object.values(gameState.players).find(p => p.socketId === socket.id);
    
    if (player) {
      player.x = x;
      player.y = y;
      
      io.emit('player_moved', {
        playerId: player.id,
        x: x,
        y: y
      });
      
      console.log(`Player ${player.name} moved to cell (${x}, ${y})`);
    }
  });
  
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
    nextPlayerId: 1
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