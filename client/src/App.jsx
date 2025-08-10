import { useState, useEffect, useMemo } from 'react'
import { io } from 'socket.io-client'
import GameCanvas from './GameCanvas'
import AdminPanel from './AdminPanel'
import DPad from './DPad'

function App() {
  const COOLDOWN_MS = 1000
  const GRID_COLS = 24
  const GRID_ROWS = 24
  const [mapSeed, setMapSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [socket, setSocket] = useState(null)
  const [gameState, setGameState] = useState({
    players: {},
    blocks: []
  })
  const [currentPlayerId, setCurrentPlayerId] = useState(null)
  const [canvasSize, setCanvasSize] = useState({ width: 300, height: 300 })
  const [projectiles, setProjectiles] = useState([])
  const [lastFacing, setLastFacing] = useState('right')
  const [aimDirection, setAimDirection] = useState('right') // spells use this direction
  const [armedSpell, setArmedSpell] = useState(null) // 'fire' | 'water' | 'earth' | null
  const [lastSpellTime, setLastSpellTime] = useState(0) // Spell-only cooldown anchor (ms)
  const [cooldownMsLeft, setCooldownMsLeft] = useState(0)
  
  // Golden ratio-based resource map (deterministic, client-side) for collision
  const PHI = 0.61803
  const makeRng = (seed) => {
    let s = seed >>> 0
    if (s === 0) s = 0x9e3779b1
    return () => {
      s ^= s << 13; s >>>= 0
      s ^= s >> 17; s >>>= 0
      s ^= s << 5;  s >>>= 0
      return (s >>> 0) / 4294967296
    }
  }

  const resourceMap = useMemo(() => {
    const total = GRID_COLS * GRID_ROWS
    const rng = makeRng(mapSeed)
    const indices = Array.from({ length: total }, (_, i) => i)
    for (let i = total - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = indices[i]
      indices[i] = indices[j]
      indices[j] = tmp
    }
    const openCount = Math.round(PHI * total)
    const rem1 = total - openCount
    const treesCount = Math.round(PHI * rem1)
    const rem2 = rem1 - treesCount
    const stoneCount = Math.round(PHI * rem2)
    const rem3 = rem2 - stoneCount
    const goldCount = Math.round(PHI * rem3)
    const rem4 = rem3 - goldCount
    const diamondCount = Math.round(PHI * rem4)
    const types = new Array(total).fill('open')
    let idx = 0
    idx += openCount
    for (let k = 0; k < treesCount && idx + k < total; k++) types[indices[idx + k]] = 'wood'
    idx += treesCount
    for (let k = 0; k < stoneCount && idx + k < total; k++) types[indices[idx + k]] = 'stone'
    idx += stoneCount
    for (let k = 0; k < goldCount && idx + k < total; k++) types[indices[idx + k]] = 'gold'
    idx += goldCount
    for (let k = 0; k < diamondCount && idx + k < total; k++) types[indices[idx + k]] = 'diamond'
    return types
  }, [mapSeed])

  // Compute viable directions for placing an earth block (client-side mirror of server rules)
  const allowedEarthDirections = useMemo(() => {
    if (armedSpell !== 'earth' || !currentPlayerId || !gameState.players[currentPlayerId]) return null
    const me = gameState.players[currentPlayerId]
    const isCellViable = (tx, ty) => {
      if (tx < 0 || tx > 23 || ty < 0 || ty > 23) return false
      // cannot interact on active player
      const occupiedByPlayer = Object.values(gameState.players || {}).some(p => p.isActive && p.x === tx && p.y === ty)
      if (occupiedByPlayer) return false
      // if a block exists, allow (toggle removal)
      const hasBlock = (gameState.blocks || []).some(b => b.x === tx && b.y === ty)
      if (hasBlock) return true
      // otherwise, only allow placing on open resource tiles
      const idx = ty * GRID_COLS + tx
      const type = resourceMap[idx]
      if (type && type !== 'open') return false
      return true
    }
    return {
      up: isCellViable(me.x, Math.max(0, me.y - 1)),
      down: isCellViable(me.x, Math.min(23, me.y + 1)),
      left: isCellViable(Math.max(0, me.x - 1), me.y),
      right: isCellViable(Math.min(23, me.x + 1), me.y)
    }
  }, [armedSpell, currentPlayerId, gameState.players, gameState.blocks, resourceMap])

  // Compute viable directions for movement (cannot step into players, earth blocks, or resources)
  const allowedMoveDirections = useMemo(() => {
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return null
    const me = gameState.players[currentPlayerId]
    const isCellWalkable = (tx, ty) => {
      if (tx < 0 || tx > 23 || ty < 0 || ty > 23) return false
      // cannot move into server blocks
      if ((gameState.blocks || []).some(b => b.x === tx && b.y === ty)) return false
      // cannot move into non-open resource
      const idx = ty * GRID_COLS + tx
      const type = resourceMap[idx]
      if (type && type !== 'open') return false
      // cannot move into tile with another active player
      const occupied = Object.values(gameState.players || {}).some(p => p.isActive && p.id !== currentPlayerId && p.x === tx && p.y === ty)
      if (occupied) return false
      return true
    }
    return {
      up: isCellWalkable(me.x, Math.max(0, me.y - 1)),
      down: isCellWalkable(me.x, Math.min(23, me.y + 1)),
      left: isCellWalkable(Math.max(0, me.x - 1), me.y),
      right: isCellWalkable(Math.min(23, me.x + 1), me.y)
    }
  }, [currentPlayerId, gameState.players, gameState.blocks, resourceMap])

  useEffect(() => {
    const serverUrl = import.meta.env.PROD 
      ? 'https://calm-simplicity-production.up.railway.app' 
      : 'http://localhost:3000'
    const newSocket = io(serverUrl)
    setSocket(newSocket)

    newSocket.on('connect', () => {
      console.log('Socket connected to server')
    })

    newSocket.on('disconnect', () => {
      console.log('Socket disconnected')
    })

    newSocket.on('welcome', (data) => {
      setGameState(data.gameState)
      setCurrentPlayerId(data.playerId)
      if (Number.isInteger(data.gameState?.mapSeed)) {
        setMapSeed(data.gameState.mapSeed)
      }
    })

    newSocket.on('player_joined', (data) => {
      setGameState(prevState => ({
        ...prevState,
        players: {
          ...prevState.players,
          [data.player.id]: data.player
        }
      }))
    })

    newSocket.on('player_reactivated', (data) => {
      setGameState(prevState => ({
        ...prevState,
        players: {
          ...prevState.players,
          [data.player.id]: data.player
        }
      }))
    })

    newSocket.on('player_left', (data) => {
      setGameState(prevState => {
        const newPlayers = { ...prevState.players }
        if (newPlayers[data.playerId]) {
          newPlayers[data.playerId].isActive = false
        }
        return {
          ...prevState,
          players: newPlayers
        }
      })
    })

    newSocket.on('player_moved', (data) => {
      setGameState(prevState => {
        const newPlayers = { ...prevState.players }
        if (newPlayers[data.playerId]) {
          newPlayers[data.playerId].x = data.x
          newPlayers[data.playerId].y = data.y
        }
        return {
          ...prevState,
          players: newPlayers
        }
      })
    })

    // Authoritative position (used for re-sync on rejection or confirmation)
    newSocket.on('player_position', (data) => {
      setGameState(prevState => {
        const newPlayers = { ...prevState.players }
        if (newPlayers[data.playerId]) {
          newPlayers[data.playerId].x = data.x
          newPlayers[data.playerId].y = data.y
        }
        return { ...prevState, players: newPlayers }
      })
    })

    newSocket.on('block_added', (data) => {
      const { x, y } = data
      setGameState(prev => {
        const exists = prev.blocks?.some(b => b.x === x && b.y === y)
        if (exists) return prev
        return { ...prev, blocks: [...(prev.blocks || []), { x, y }] }
      })
    })

    newSocket.on('block_removed', (data) => {
      const { x, y } = data
      setGameState(prev => ({
        ...prev,
        blocks: (prev.blocks || []).filter(b => !(b.x === x && b.y === y))
      }))
    })

    newSocket.on('blocks_reset', () => {
      setGameState(prev => ({ ...prev, blocks: [] }))
    })

    newSocket.on('map_seed', ({ seed }) => {
      if (Number.isInteger(seed)) setMapSeed(seed)
    })

    return () => {
      newSocket.close()
    }
  }, [])

  const handleCanvasClick = (x, y) => {
    // Move one tile toward click, or cast armed spell in that direction
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return
    const me = gameState.players[currentPlayerId]
    const dx = x - me.x
    const dy = y - me.y
    if (dx === 0 && dy === 0) return
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)
    let direction
    if (absDx >= absDy) direction = dx > 0 ? 'right' : 'left'
    else direction = dy > 0 ? 'down' : 'up'
    setAimDirection(direction)
    if (armedSpell) {
      castArmedSpellInDirection(armedSpell, direction)
    } else {
      attemptMoveOnce(direction)
    }
  }

  const handleDPadMove = (direction) => {
    // If a spell is armed, consume this direction to cast; otherwise move one tile
    setAimDirection(direction)
    if (armedSpell) {
      if (armedSpell === 'earth' && allowedEarthDirections && allowedEarthDirections[direction] === false) {
        return
      }
      castArmedSpellInDirection(armedSpell, direction)
      return
    }
    attemptMoveOnce(direction)
  }

  // Attempt a single tile move (no movement cap)
    const attemptMoveOnce = (direction) => {
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return
    const currentPlayer = gameState.players[currentPlayerId]
    let newX = currentPlayer.x
    let newY = currentPlayer.y
    switch (direction) {
      case 'up': newY = Math.max(0, newY - 1); setLastFacing('up'); break
      case 'down': newY = Math.min(23, newY + 1); setLastFacing('down'); break
      case 'left': newX = Math.max(0, newX - 1); setLastFacing('left'); break
      case 'right': newX = Math.min(23, newX + 1); setLastFacing('right'); break
      default: return
    }
      // Client-side quick checks (players, earth, resource) to avoid obvious rejects
      const occupiedByPlayer = Object.values(gameState.players || {}).some(p => p.isActive && p.id !== currentPlayerId && p.x === newX && p.y === newY)
      if (occupiedByPlayer) return
      const isEarthBlocked = (gameState.blocks || []).some(b => b.x === newX && b.y === newY)
      if (isEarthBlocked) return
      const resIdx = newY * GRID_COLS + newX
      const cellType = resourceMap[resIdx]
      const isResourceBlocked = cellType && cellType !== 'open'
      if (isResourceBlocked) return
      if (newX === currentPlayer.x && newY === currentPlayer.y) return
      // Optimistic update; server will confirm or correct via events
      setGameState(prevState => {
        const newPlayers = { ...prevState.players }
        if (newPlayers[currentPlayerId]) {
          newPlayers[currentPlayerId].x = newX
          newPlayers[currentPlayerId].y = newY
        }
        return { ...prevState, players: newPlayers }
      })
      if (socket) socket.emit('player_move', { x: newX, y: newY })
  }

  // Cast armed spells in a chosen direction, enforcing spell cooldown
  const castArmedSpellInDirection = (spellType, direction) => {
    const now = performance.now()
    if (now - lastSpellTime < COOLDOWN_MS) { setArmedSpell(null); return }
    setLastSpellTime(now)
    setArmedSpell(null)
    if (spellType === 'earth') {
      handleEarthPlace(direction)
    } else if (spellType === 'fire') {
      handleFireCastDirect(direction)
    } else if (spellType === 'water') {
      handleWaterCastDirect(direction)
    } else if (spellType === 'air') {
      handleAirCastDirect(direction)
    }
  }

  // We no longer use press/hold; autorun toggles on tap

  // Arm fire spell; cast on next direction
  const handleSpellCast = () => {
    setArmedSpell('fire')
  }

  // Direct fire cast helper
  const handleFireCastDirect = (dir) => {
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return
    const caster = gameState.players[currentPlayerId]
    const speedCellsPerSecond = 2
    const velocity = {
      x: dir === 'left' ? -speedCellsPerSecond : dir === 'right' ? speedCellsPerSecond : 0,
      y: dir === 'up' ? -speedCellsPerSecond : dir === 'down' ? speedCellsPerSecond : 0,
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setProjectiles(prev => [
      ...prev,
      { id, type: 'fireball', x: caster.x + 0.5, y: caster.y + 0.5, vx: velocity.x, vy: velocity.y }
    ])
  }

  // Arm water spell; cast on next direction
  const handleFrostCast = () => {
    setArmedSpell('water')
  }

  // Direct water cast helper
  const handleWaterCastDirect = (dir) => {
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return
    const caster = gameState.players[currentPlayerId]
    const speedCellsPerSecond = 2
    const velocity = {
      x: dir === 'left' ? -speedCellsPerSecond : dir === 'right' ? speedCellsPerSecond : 0,
      y: dir === 'up' ? -speedCellsPerSecond : dir === 'down' ? speedCellsPerSecond : 0,
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setProjectiles(prev => [
      ...prev,
      { id, type: 'frostbolt', x: caster.x + 0.5, y: caster.y + 0.5, vx: velocity.x, vy: velocity.y }
    ])
  }

  // Direct air cast helper
  const handleAirCastDirect = (dir) => {
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return
    const caster = gameState.players[currentPlayerId]
    const speedCellsPerSecond = 3
    const velocity = {
      x: dir === 'left' ? -speedCellsPerSecond : dir === 'right' ? speedCellsPerSecond : 0,
      y: dir === 'up' ? -speedCellsPerSecond : dir === 'down' ? speedCellsPerSecond : 0,
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setProjectiles(prev => [
      ...prev,
      { id, type: 'air', x: caster.x + 0.5, y: caster.y + 0.5, vx: velocity.x, vy: velocity.y }
    ])
  }

  // Place an earth block on the adjacent tile in facing direction (client-side visual only)
  const handleEarthPlace = (dir) => {
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return
    const me = gameState.players[currentPlayerId]
    let targetX = me.x
    let targetY = me.y
    switch (dir) {
      case 'up': targetY = Math.max(0, me.y - 1); break
      case 'down': targetY = Math.min(23, me.y + 1); break
      case 'left': targetX = Math.max(0, me.x - 1); break
      case 'right': targetX = Math.min(23, me.x + 1); break
    }
    // Client-side viability check to avoid emitting impossible placements
    if (allowedEarthDirections && allowedEarthDirections[dir] === false) return
    if (socket) socket.emit('place_block', { x: targetX, y: targetY })
  }

  // Animate projectiles
  useEffect(() => {
    let rafId
    let lastTime = performance.now()
    const tick = () => {
      const now = performance.now()
      const dtSec = Math.min(0.05, Math.max(0, (now - lastTime) / 1000)) // clamp dt
      lastTime = now
      // Update spell cooldown remaining
      setCooldownMsLeft(Math.max(0, COOLDOWN_MS - (now - lastSpellTime)))
      // No autorun movement; movement is one-to-one per input
      setProjectiles(prev => prev
        .map(p => ({ ...p, x: p.x + p.vx * dtSec, y: p.y + p.vy * dtSec }))
        .filter(p => p.x >= 0 && p.x <= 23.99 && p.y >= 0 && p.y <= 23.99)
      )
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [currentPlayerId, socket, lastSpellTime])

  // Regenerate map on 'R' key
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'r' || e.key === 'R') {
        const newSeed = Math.floor(Math.random() * 1e9)
        setMapSeed(newSeed)
        if (socket) {
          socket.emit('set_map_seed', { seed: newSeed })
          socket.emit('reset_blocks')
        }
        // Immediate local clear for responsiveness
        setGameState(prev => ({ ...prev, blocks: [] }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <GameCanvas 
        gameState={gameState} 
        currentPlayerId={currentPlayerId}
        onCanvasClick={handleCanvasClick}
        onCanvasSizeChange={setCanvasSize}
        projectiles={projectiles}
        mapSeed={mapSeed}
      />
      <AdminPanel 
        onResetBlocks={() => {
          if (socket) socket.emit('reset_blocks')
          setGameState(prev => ({ ...prev, blocks: [] }))
        }}
        onNewMap={() => {
          const newSeed = Math.floor(Math.random() * 1e9)
          setMapSeed(newSeed)
          if (socket) {
            socket.emit('set_map_seed', { seed: newSeed })
            socket.emit('reset_blocks')
          }
          setGameState(prev => ({ ...prev, blocks: [] }))
        }}
        blocksCount={(gameState.blocks || []).length}
        playersCount={Object.keys(gameState.players || {}).length}
      />
      <DPad 
        onMove={handleDPadMove}
        onSpell={handleSpellCast}
        onFrost={handleFrostCast}
        onArmEarth={() => setArmedSpell('earth')}
        onArmAir={() => setArmedSpell('air')}
        canvasSize={canvasSize}
        cooldownFraction={Math.max(0, Math.min(1, cooldownMsLeft / COOLDOWN_MS))}
        aimDirection={aimDirection}
        armedSpell={armedSpell}
        allowedDirections={armedSpell === 'earth' ? allowedEarthDirections : allowedMoveDirections}
        onStop={() => { setArmedSpell(null) }}
      />
    </div>
  )
}

export default App