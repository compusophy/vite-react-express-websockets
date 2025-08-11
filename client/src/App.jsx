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
    blocks: [],
    harvested: [],
    spawnedResources: []
  })
  const [currentPlayerId, setCurrentPlayerId] = useState(null)
  const [canvasSize, setCanvasSize] = useState({ width: 300, height: 300 })
  const [lastFacing, setLastFacing] = useState('right')
  const [aimDirection, setAimDirection] = useState('right')
  const [armedSpell, setArmedSpell] = useState(null) // 'earth' | null
  const [lastSpellTime, setLastSpellTime] = useState(0) // Spell-only cooldown anchor (ms)
  const [cooldownMsLeft, setCooldownMsLeft] = useState(0)
  const [showInventory, setShowInventory] = useState(false)
  // Removed top toast in favor of the death modal only
  const [toast, setToast] = useState(null)
  const isMeDead = useMemo(() => {
    if (!currentPlayerId) return false
    const me = gameState.players[currentPlayerId]
    if (!me) return false
    return !me.isActive || (typeof me.hp === 'number' && me.hp <= 0)
  }, [currentPlayerId, gameState.players])
  
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
    const harvestedSet = new Set((gameState.harvested || []).map(h => `${h.x},${h.y}`))
    const spawnedSet = new Set((gameState.spawnedResources || []).map(s => `${s.x},${s.y}`))
    const isCellViable = (tx, ty) => {
      if (tx < 0 || tx > 23 || ty < 0 || ty > 23) return false
      // cannot interact on active player
      const occupiedByPlayer = Object.values(gameState.players || {}).some(p => p.isActive && p.x === tx && p.y === ty)
      if (occupiedByPlayer) return false
      // if a block exists, allow (toggle removal)
      const hasBlock = (gameState.blocks || []).some(b => b.x === tx && b.y === ty)
      if (hasBlock) return true
      // otherwise, only allow placing on tiles that are open
      // treat spawned resources as blocking, harvested tiles as open
      if (spawnedSet.has(`${tx},${ty}`)) return false
      const idx = ty * GRID_COLS + tx
      const baseType = resourceMap[idx]
      const isBaseOpen = !baseType || baseType === 'open'
      if (!isBaseOpen && !harvestedSet.has(`${tx},${ty}`)) return false
      return true
    }
    return {
      up: isCellViable(me.x, Math.max(0, me.y - 1)),
      down: isCellViable(me.x, Math.min(23, me.y + 1)),
      left: isCellViable(Math.max(0, me.x - 1), me.y),
      right: isCellViable(Math.min(23, me.x + 1), me.y)
    }
  }, [armedSpell, currentPlayerId, gameState.players, gameState.blocks, gameState.harvested, gameState.spawnedResources, resourceMap])

  // Compute viable directions for movement (cannot step into players, earth blocks, or resources)
  const allowedMoveDirections = useMemo(() => {
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return null
    const me = gameState.players[currentPlayerId]
    const harvestedSet = new Set((gameState.harvested || []).map(h => `${h.x},${h.y}`))
    const isCellWalkable = (tx, ty) => {
      if (tx < 0 || tx > 23 || ty < 0 || ty > 23) return false
      // cannot move into server blocks
      if ((gameState.blocks || []).some(b => b.x === tx && b.y === ty)) return false
      // cannot move into non-open resource
      const idx = ty * GRID_COLS + tx
      const type = resourceMap[idx]
      if (type && type !== 'open' && !harvestedSet.has(`${tx},${ty}`)) return false
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

  // Compute viable directions for mining (stone/gold/diamond) and woodcutting (wood)
  const allowedHarvestDirections = useMemo(() => {
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return null
    const me = gameState.players[currentPlayerId]
    const harvestedSet = new Set((gameState.harvested || []).map(h => `${h.x},${h.y}`))
    const spawnedMap = new Map((gameState.spawnedResources || []).map(s => [`${s.x},${s.y}`, s.type]))
    const checkType = (tx, ty) => {
      if (tx < 0 || tx > 23 || ty < 0 || ty > 23) return false
      const dyn = spawnedMap.get(`${tx},${ty}`)
      if (dyn) return dyn
      const idx = ty * GRID_COLS + tx
      const type = resourceMap[idx]
      if (!type || type === 'open') return false
      if (harvestedSet.has(`${tx},${ty}`)) return false
      const occupied = Object.values(gameState.players || {}).some(p => p.isActive && p.x === tx && p.y === ty)
      if (occupied) return false
      return type
    }
    const up = checkType(me.x, Math.max(0, me.y - 1))
    const down = checkType(me.x, Math.min(23, me.y + 1))
    const left = checkType(Math.max(0, me.x - 1), me.y)
    const right = checkType(Math.min(23, me.x + 1), me.y)
    const isWood = (t) => t === 'wood'
    const isOre = (t) => t === 'stone' || t === 'gold' || t === 'diamond'
    return {
      any: {
        up: !!up, down: !!down, left: !!left, right: !!right
      },
      wood: {
        up: isWood(up), down: isWood(down), left: isWood(left), right: isWood(right)
      },
      ore: {
        up: isOre(up), down: isOre(down), left: isOre(left), right: isOre(right)
      }
    }
  }, [currentPlayerId, gameState.players, gameState.harvested, gameState.spawnedResources, resourceMap])

  const canUsePickaxe = useMemo(() => {
    const dirs = allowedHarvestDirections?.ore
    if (!dirs) return false
    return !!(dirs.up || dirs.down || dirs.left || dirs.right)
  }, [allowedHarvestDirections])

  const canUseAxe = useMemo(() => {
    const dirs = allowedHarvestDirections?.wood
    if (!dirs) return false
    return !!(dirs.up || dirs.down || dirs.left || dirs.right)
  }, [allowedHarvestDirections])

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
      const { x, y, type, material } = data
      setGameState(prev => {
        const exists = prev.blocks?.some(b => b.x === x && b.y === y)
        if (exists) return prev
        return { ...prev, blocks: [...(prev.blocks || []), { x, y, type: type || 'wall', material }] }
      })
    })

    newSocket.on('block_removed', (data) => {
      const { x, y } = data
      setGameState(prev => ({
        ...prev,
        blocks: (prev.blocks || []).filter(b => !(b.x === x && b.y === y))
      }))
    })

    newSocket.on('inventory_update', ({ playerId, inventory }) => {
      setGameState(prev => {
        const players = { ...prev.players }
        if (players[playerId]) players[playerId].inventory = inventory
        return { ...prev, players }
      })
    })

    newSocket.on('blocks_reset', () => {
      setGameState(prev => ({ ...prev, blocks: [] }))
    })

    newSocket.on('map_seed', ({ seed }) => {
      if (Number.isInteger(seed)) setMapSeed(seed)
    })

    // Projectiles removed

    newSocket.on('harvested', ({ x, y, type, playerId, inventory, skills }) => {
      setGameState(prev => ({
        ...prev,
        harvested: [...(prev.harvested || []), { x, y }],
        players: {
          ...prev.players,
          [playerId]: prev.players[playerId]
            ? { ...prev.players[playerId], inventory, skills }
            : prev.players[playerId]
        }
      }))
    })

    newSocket.on('resource_spawned', ({ x, y, type }) => {
      setGameState(prev => ({
        ...prev,
        spawnedResources: [...(prev.spawnedResources || []), { x, y, type }]
      }))
    })

    newSocket.on('player_died', ({ playerId }) => {
      setGameState(prev => {
        const players = { ...prev.players }
        if (players[playerId]) players[playerId].isActive = false
        return { ...prev, players }
      })
      // No top toast anymore; death is indicated by the modal
    })

    newSocket.on('player_respawned', ({ player, oldPlayerId }) => {
      setGameState(prev => {
        const players = { ...prev.players }
        // Reuse same id; overwrite data
        players[player.id] = player
        return { ...prev, players }
      })
      // Only switch control if this client owned the old player id
      setCurrentPlayerId(prevId => (prevId === oldPlayerId ? player.id : prevId))
      setArmedSpell(null)
    })

    return () => {
      newSocket.close()
    }
  }, [])

  const handleCanvasClick = (x, y) => {
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return
    // Move one tile toward click, or place block if earth is armed
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
    if (armedSpell) castArmedSpellInDirection(armedSpell, direction)
    else {
      const now = performance.now()
      if (now - lastSpellTime < COOLDOWN_MS) return
      setLastSpellTime(now)
      attemptMoveOnce(direction)
    }
  }

  const handleDPadMove = (direction) => {
    // If a spell is armed, consume this direction to cast; otherwise move one tile
    setAimDirection(direction)
    if (harvestArmed) {
      // Attempt harvest in chosen direction
      const me = gameState.players[currentPlayerId]
      let tx = me.x, ty = me.y
      if (direction === 'up') ty = Math.max(0, me.y - 1)
      else if (direction === 'down') ty = Math.min(23, me.y + 1)
      else if (direction === 'left') tx = Math.max(0, me.x - 1)
      else if (direction === 'right') tx = Math.min(23, me.x + 1)
      const dirs = harvestTool === 'axe' ? allowedHarvestDirections?.wood : allowedHarvestDirections?.ore
      if (!dirs || dirs[direction]) {
        const now = performance.now()
        if (now - lastSpellTime < COOLDOWN_MS) { setHarvestArmed(false); return }
        setLastSpellTime(now)
        if (socket) socket.emit('harvest', { x: tx, y: ty, tool: harvestTool })
      }
      setHarvestArmed(false)
      return
    }
    if (armedSpell) {
      if (armedSpell === 'earth' && allowedEarthDirections && allowedEarthDirections[direction] === false) return
      castArmedSpellInDirection(armedSpell, direction)
      return
    }
    const now = performance.now()
    if (now - lastSpellTime < COOLDOWN_MS) return
    setLastSpellTime(now)
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
      const harvestedSet = new Set((gameState.harvested || []).map(h => `${h.x},${h.y}`))
      const isResourceBlocked = cellType && cellType !== 'open' && !harvestedSet.has(`${newX},${newY}`)
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

  // Earth placement with cooldown
  const castArmedSpellInDirection = (spellType, direction) => {
    const now = performance.now()
    if (now - lastSpellTime < COOLDOWN_MS) { setArmedSpell(null); return }
    setLastSpellTime(now)
    setArmedSpell(null)
    if (spellType === 'earth') handleEarthPlace(direction)
  }

  // No projectile spells
  const handleFrostCast = () => {}

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
    // Default to 'wall'; Shift could place workbench (optional later)
    if (socket) socket.emit('place_block', { x: targetX, y: targetY, type: 'wall' })
  }

  // Harvest selection mode: one tap on pickaxe arms harvest, next canvas click selects target tile to harvest
  const [harvestArmed, setHarvestArmed] = useState(false)
  const [harvestTool, setHarvestTool] = useState('pickaxe') // 'pickaxe' | 'axe'

  // Animation tick: update cooldown only
  useEffect(() => {
    let rafId
    let lastTime = performance.now()
    const tick = () => {
      const now = performance.now()
      const dtSec = Math.min(0.05, Math.max(0, (now - lastTime) / 1000)) // clamp dt
      lastTime = now
      // Update spell cooldown remaining
      setCooldownMsLeft(Math.max(0, COOLDOWN_MS - (now - lastSpellTime)))
      // No toast lifecycle anymore
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
        mapSeed={mapSeed}
      />
      {/* Top toast removed; using only the death modal */}
      {isMeDead && (
        <div style={{
          position: 'fixed', left: 0, top: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1100
        }}>
          <div style={{
            background: '#111', color: '#fff', padding: 20, borderRadius: 10, width: 280,
            textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
          }}>
            <div style={{ fontSize: 18, marginBottom: 10 }}>You died</div>
            <button
              style={{
                display: 'inline-block', marginTop: 8, padding: '10px 14px', borderRadius: 8,
                background: '#22c55e', border: 'none', color: '#111', fontWeight: 700, cursor: 'pointer'
              }}
              onClick={() => socket && socket.emit('player_respawn')}
            >
              Play Again
            </button>
          </div>
        </div>
      )}
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
      {!isMeDead && (
      <>
      <DPad 
          onMove={handleDPadMove}
          onSpell={null}
          onFrost={handleFrostCast}
        onArmEarth={() => setArmedSpell(prev => {
          const next = prev === 'earth' ? null : 'earth'
          if (next === 'earth') setHarvestArmed(false)
          return next
        })}
        onArmAir={null}
        onPickaxe={() => {
          // Share the same cooldown as spells; arming is instant, but harvest occurs on arrow press
          const now = performance.now()
          if (now - lastSpellTime < COOLDOWN_MS) return
          setHarvestArmed(prev => {
            const next = !prev
            if (next) setArmedSpell(null)
            return next
          })
        }}
        onAxe={() => {
          const now = performance.now()
          if (now - lastSpellTime < COOLDOWN_MS) return
          setHarvestTool(prev => prev === 'axe' ? 'pickaxe' : 'axe')
          setHarvestArmed(true)
          setArmedSpell(null)
        }}
        harvestArmed={harvestArmed}
        harvestTool={harvestTool}
        canUsePickaxe={canUsePickaxe}
        canUseAxe={canUseAxe}
        inventory={{
          wood: (gameState.players[currentPlayerId]?.inventory?.wood) ?? 0,
          stone: (gameState.players[currentPlayerId]?.inventory?.stone) ?? 0,
          gold: (gameState.players[currentPlayerId]?.inventory?.gold) ?? 0,
          items: gameState.players[currentPlayerId]?.items || []
        }}
          canvasSize={canvasSize}
          cooldownFraction={Math.max(0, Math.min(1, cooldownMsLeft / COOLDOWN_MS))}
          aimDirection={aimDirection}
          armedSpell={armedSpell}
        allowedDirections={harvestArmed ? allowedHarvestDirections : (armedSpell === 'earth' ? allowedEarthDirections : allowedMoveDirections)}
          onStop={() => { setArmedSpell(null) }}
        />
        {/* Inventory modal removed; inventory shown in D-pad bottom-right */}
      </>
      )}
    </div>
  )
}

export default App