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
  const [cooldownsEnabled, setCooldownsEnabled] = useState(false)
  const [showInventory, setShowInventory] = useState(false)
  // Removed top toast in favor of the death modal only
  const [toast, setToast] = useState(null)
  // Trading UI state
  const [isPickingTradePartner, setIsPickingTradePartner] = useState(false)
  const [pendingTradeInvite, setPendingTradeInvite] = useState(null) // { fromId, fromName }
  const [tradeSession, setTradeSession] = useState(null) // { aId, bId, partnerId, partnerName, offers, ready, confirmed }
  const [isCraftingOpen, setIsCraftingOpen] = useState(false)
  const [woodXpPulse, setWoodXpPulse] = useState(false)
  const [miningXpPulse, setMiningXpPulse] = useState(false)
  const [buildingXpPulse, setBuildingXpPulse] = useState(false)
  const [uiMode, setUiMode] = useState('default')
  const [menuPage, setMenuPage] = useState('root')
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
    // Promote some wood tiles to 'oak' deterministically to match canvas/server visuals
    // Remove oak variant for simplicity
    return types
  }, [mapSeed])

  // Compute viable directions for placing an earth block (client-side mirror of server rules)
  const allowedEarthDirections = useMemo(() => {
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return null
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
  }, [currentPlayerId, gameState.players, gameState.blocks, gameState.harvested, gameState.spawnedResources, resourceMap])

  // Compute viable directions for movement (cannot step into players, earth blocks, or resources)
  const allowedMoveDirections = useMemo(() => {
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return null
    const me = gameState.players[currentPlayerId]
    const harvestedSet = new Set((gameState.harvested || []).map(h => `${h.x},${h.y}`))
    const idx = (dx, dy) => (me.y + dy) * GRID_COLS + (me.x + dx)
    const can = (dx, dy) => {
      const tx = me.x + dx
      const ty = me.y + dy
      if (tx < 0 || tx > 23 || ty < 0 || ty > 23) return false
      // Server blocks known precisely
      if ((gameState.blocks || []).some(b => b.x === tx && b.y === ty)) return false
      // If a dynamic resource is spawned there and not harvested, block move
      const dyn = (gameState.spawnedResources || []).find(s => s.x === tx && s.y === ty)
      if (dyn && !harvestedSet.has(`${tx},${ty}`)) return false
      // Fallback to base map type
      const baseType = resourceMap[idx(dx, dy)]
      if (baseType && baseType !== 'open' && !harvestedSet.has(`${tx},${ty}`)) return false
      // Another player occupying
      if (Object.values(gameState.players || {}).some(p => p.isActive && p.id !== currentPlayerId && p.x === tx && p.y === ty)) return false
      return true
    }
    return {
      up: can(0, -1),
      down: can(0, 1),
      left: can(-1, 0),
      right: can(1, 0)
    }
  }, [currentPlayerId, gameState.players, gameState.blocks, gameState.spawnedResources, gameState.harvested, resourceMap])

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

  const canBuildEarth = useMemo(() => {
    const dirs = allowedEarthDirections
    if (!dirs) return false
    return !!(dirs.up || dirs.down || dirs.left || dirs.right)
  }, [allowedEarthDirections])

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
      if (typeof data.gameState?.settings?.cooldownsEnabled === 'boolean') {
        setCooldownsEnabled(!!data.gameState.settings.cooldownsEnabled)
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
      // Pulse building on my builds
      const me = Object.values(gameState.players || {}).find(p => p.id === currentPlayerId)
      if (me) { setBuildingXpPulse(true); setTimeout(() => setBuildingXpPulse(false), 600) }
    })

    newSocket.on('build_rejected', (data) => {
      setToast({ type: 'info', text: `Build failed: ${data?.reason || 'unknown'}` })
      setTimeout(() => setToast(null), 1000)
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

    newSocket.on('skills_update', ({ playerId, skills }) => {
      setGameState(prev => {
        const players = { ...prev.players }
        if (players[playerId]) players[playerId].skills = skills
        return { ...prev, players }
      })
    })

    newSocket.on('blocks_reset', () => {
      setGameState(prev => ({ ...prev, blocks: [] }))
    })

    newSocket.on('map_seed', ({ seed }) => {
      if (Number.isInteger(seed)) setMapSeed(seed)
    })

    newSocket.on('settings_update', (settings) => {
      if (settings && typeof settings.cooldownsEnabled === 'boolean') {
        setCooldownsEnabled(!!settings.cooldownsEnabled)
      }
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
      if (playerId === currentPlayerId) {
        if (type === 'wood' || type === 'oak') {
          setWoodXpPulse(true); setTimeout(() => setWoodXpPulse(false), 600)
        } else if (type === 'stone' || type === 'gold' || type === 'diamond') {
          setMiningXpPulse(true); setTimeout(() => setMiningXpPulse(false), 600)
        }
      }
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

  // Socket listeners for trading
  useEffect(() => {
    if (!socket) return
    const onInvite = ({ fromId, fromName }) => {
      setPendingTradeInvite({ fromId, fromName })
    }
    const onDeclined = ({ byId, byName }) => {
      setToast({ type: 'info', text: `${byName || 'Player'} declined your trade.` })
      setTimeout(() => setToast(null), 1500)
    }
    const onOpen = (payload) => {
      // Determine my id and partner
      const meId = currentPlayerId
      const partnerId = payload.aId === meId ? payload.bId : payload.aId
      setTradeSession({
        aId: payload.aId,
        bId: payload.bId,
        partnerId,
        partnerName: gameState.players[partnerId]?.name || `Player ${partnerId}`,
        offers: payload.offers,
        ready: payload.ready,
        confirmed: payload.confirmed
      })
      setIsPickingTradePartner(false)
      setPendingTradeInvite(null)
    }
    const onUpdate = (payload) => {
      setTradeSession(prev => prev ? { ...prev, offers: payload.offers, ready: payload.ready, confirmed: payload.confirmed } : prev)
    }
    const onComplete = () => {
      setTradeSession(null)
      setToast({ type: 'success', text: 'Trade complete!' })
      setTimeout(() => setToast(null), 1200)
    }
    const onCancelled = ({ reason }) => {
      setTradeSession(null)
      setPendingTradeInvite(null)
      setIsPickingTradePartner(false)
      setToast({ type: 'info', text: 'Trade cancelled.' })
      setTimeout(() => setToast(null), 1200)
    }
    socket.on('trade_invite', onInvite)
    socket.on('trade_declined', onDeclined)
    socket.on('trade_open', onOpen)
    socket.on('trade_update', onUpdate)
    socket.on('trade_complete', onComplete)
    socket.on('trade_cancelled', onCancelled)
    return () => {
      socket.off('trade_invite', onInvite)
      socket.off('trade_declined', onDeclined)
      socket.off('trade_open', onOpen)
      socket.off('trade_update', onUpdate)
      socket.off('trade_complete', onComplete)
      socket.off('trade_cancelled', onCancelled)
    }
  }, [socket, currentPlayerId, gameState.players])

  // Trade actions
  const openTradePicker = () => {
    setIsPickingTradePartner(true)
  }
  const closeTradePicker = () => setIsPickingTradePartner(false)
  const sendTradeRequest = (targetId) => {
    if (!socket) return
    socket.emit('trade_request', { targetId })
    setToast({ type: 'info', text: 'Trade invite sent.' })
    setTimeout(() => setToast(null), 1000)
    setIsPickingTradePartner(false)
  }
  const acceptTradeInvite = () => {
    if (!socket || !pendingTradeInvite) return
    socket.emit('trade_accept', { fromId: pendingTradeInvite.fromId })
    setPendingTradeInvite(null)
  }
  const declineTradeInvite = () => {
    if (!socket || !pendingTradeInvite) return
    socket.emit('trade_decline', { fromId: pendingTradeInvite.fromId })
    setPendingTradeInvite(null)
  }
  const updateTradeOffer = (offer) => {
    if (!socket || !tradeSession) return
    socket.emit('trade_offer', { partnerId: tradeSession.partnerId, offer })
  }
  const setTradeReady = (ready) => {
    if (!socket || !tradeSession) return
    socket.emit('trade_ready', { partnerId: tradeSession.partnerId, ready })
  }
  const confirmTrade = () => {
    if (!socket || !tradeSession) return
    socket.emit('trade_confirm', { partnerId: tradeSession.partnerId })
  }
  const cancelTrade = () => {
    if (!socket || !tradeSession) return
    socket.emit('trade_cancel', { partnerId: tradeSession.partnerId })
    setTradeSession(null)
  }

  // Smart interact: context-aware single button
  const smartInteract = () => {
    if (!currentPlayerId || !gameState.players[currentPlayerId]) return
    const me = gameState.players[currentPlayerId]
    const dir = aimDirection || lastFacing || 'right'
    let tx = me.x, ty = me.y
    if (dir === 'up') ty = Math.max(0, me.y - 1)
    else if (dir === 'down') ty = Math.min(23, me.y + 1)
    else if (dir === 'left') tx = Math.max(0, me.x - 1)
    else if (dir === 'right') tx = Math.min(23, me.x + 1)

    // Prefer trade if a player is in front
    const partner = Object.values(gameState.players || {}).find(p => p.isActive && p.id !== currentPlayerId && p.x === tx && p.y === ty)
    if (partner) { sendTradeRequest(partner.id); return }

    // Open crafting if near a workbench
    const nearWorkbench = (gameState.blocks || []).some(b => (b.x === tx && b.y === ty && b.type === 'workbench') || (b.x === me.x && b.y === me.y && b.type === 'workbench'))
    if (nearWorkbench) { setIsCraftingOpen(true); return }
  }

  // Expose globally for DPad center button
  useEffect(() => {
    if (typeof window !== 'undefined') window.__onSmartInteract = smartInteract
    return () => { if (typeof window !== 'undefined') delete window.__onSmartInteract }
  }, [smartInteract, gameState, currentPlayerId, aimDirection, lastFacing])

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
      if (cooldownsEnabled) {
        if (now - lastSpellTime < COOLDOWN_MS) return
        setLastSpellTime(now)
      }
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
        if (cooldownsEnabled) {
          if (now - lastSpellTime < COOLDOWN_MS) { setHarvestArmed(false); return }
          setLastSpellTime(now)
        }
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
    if (cooldownsEnabled) {
      if (now - lastSpellTime < COOLDOWN_MS) return
      setLastSpellTime(now)
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

  // Earth placement: do not block on client cooldown; server is authoritative
  const castArmedSpellInDirection = (spellType, direction) => {
    const now = performance.now()
    // Clear armed state regardless
    setArmedSpell(null)
    // Only update client cooldown timer if not currently cooling down
    if (cooldownsEnabled && (now - lastSpellTime >= COOLDOWN_MS)) setLastSpellTime(now)
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
    // Defer viability to server; always attempt
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
      setCooldownMsLeft(cooldownsEnabled ? Math.max(0, COOLDOWN_MS - (now - lastSpellTime)) : 0)
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
        onResetLevels={() => {
          if (socket) socket.emit('reset_levels')
        }}
        blocksCount={(gameState.blocks || []).length}
        playersCount={Object.keys(gameState.players || {}).length}
        cooldownsEnabled={cooldownsEnabled}
        onToggleCooldowns={() => {
          if (socket) socket.emit('set_settings', { cooldownsEnabled: !cooldownsEnabled })
        }}
      />
      {!isMeDead && (
      <>
      <DPad 
          onMove={handleDPadMove}
          onSpell={null}
          onFrost={handleFrostCast}
        onArmEarth={() => setArmedSpell(prev => {
          // Toggle earth build mode, and disarm any harvest tool
          const next = prev === 'earth' ? null : 'earth'
          if (next === 'earth') { setHarvestArmed(false) }
          return next
        })}
        onArmAir={null}
        onPickaxe={() => {
          // Toggle pickaxe arming. Disarm if already armed with pickaxe; otherwise arm pickaxe.
          setArmedSpell(null)
          if (harvestArmed && harvestTool === 'pickaxe') {
            setHarvestArmed(false)
          } else {
            setHarvestTool('pickaxe')
            setHarvestArmed(true)
          }
        }}
        onAxe={() => {
          // Toggle axe arming. Disarm if already armed with axe; otherwise arm axe.
          setArmedSpell(null)
          if (harvestArmed && harvestTool === 'axe') {
            setHarvestArmed(false)
          } else {
            setHarvestTool('axe')
            setHarvestArmed(true)
          }
        }}
        harvestArmed={harvestArmed}
        harvestTool={harvestTool}
        canUsePickaxe={canUsePickaxe}
        canUseAxe={canUseAxe}
        canBuildEarth={canBuildEarth}
        inventory={{
          wood: (gameState.players[currentPlayerId]?.inventory?.wood) ?? 0,
          stone: (gameState.players[currentPlayerId]?.inventory?.stone) ?? 0,
          gold: (gameState.players[currentPlayerId]?.inventory?.gold) ?? 0,
          items: gameState.players[currentPlayerId]?.items || []
        }}
          canvasSize={canvasSize}
          cooldownFraction={cooldownsEnabled ? Math.max(0, Math.min(1, cooldownMsLeft / COOLDOWN_MS)) : 0}
          aimDirection={aimDirection}
          armedSpell={armedSpell}
        allowedDirections={harvestArmed ? allowedHarvestDirections : (armedSpell === 'earth' ? { up: true, down: true, left: true, right: true } : allowedMoveDirections)}
          onStop={() => { setArmedSpell(null) }}
          woodcutLevel={(gameState.players[currentPlayerId]?.skills?.woodcutting?.level) || 1}
          woodcutProgress={(gameState.players[currentPlayerId]?.skills?.woodcutting?.xp || 0) / Math.max(1, ((gameState.players[currentPlayerId]?.skills?.woodcutting?.level) || 1) * 100)}
          woodXpPulse={woodXpPulse}
          miningLevel={(gameState.players[currentPlayerId]?.skills?.mining?.level) || 1}
          miningProgress={(gameState.players[currentPlayerId]?.skills?.mining?.xp || 0) / Math.max(1, ((gameState.players[currentPlayerId]?.skills?.mining?.level) || 1) * 100)}
          miningXpPulse={miningXpPulse}
          buildingLevel={(gameState.players[currentPlayerId]?.skills?.building?.level) || 1}
          buildingProgress={(gameState.players[currentPlayerId]?.skills?.building?.xp || 0) / Math.max(1, ((gameState.players[currentPlayerId]?.skills?.building?.level) || 1) * 100)}
          buildingXpPulse={buildingXpPulse}
          uiMode={uiMode}
          menuPage={menuPage}
          onToggleMenu={() => { setUiMode(prev => prev === 'menu' ? 'default' : 'menu'); setMenuPage('root') }}
          onMenuBack={() => { setUiMode('default'); setMenuPage('root') }}
          onSelectMenuPage={(p) => setMenuPage(p)}
        />
        {/* Inventory modal removed; inventory shown in D-pad bottom-right */}
        {/* Trade partner picker */}
        {isPickingTradePartner && currentPlayerId && (
          <div style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}>
            <div style={{ background: '#111', color: '#fff', padding: 16, borderRadius: 10, width: 320 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Choose trade partner</div>
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.values(gameState.players || {})
                  .filter(p => p.isActive && p.id !== currentPlayerId)
                  .sort((a,b)=>a.id-b.id)
                  .map(p => {
                    const me = gameState.players[currentPlayerId]
                    const dist = Math.abs((me?.x||0) - (p.x||0)) + Math.abs((me?.y||0) - (p.y||0))
                    const inRange = dist <= 3
                    return (
                      <button key={p.id} onClick={() => inRange && sendTradeRequest(p.id)} style={{ background: inRange ? '#1f2937' : '#333', color: '#fff', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px', textAlign: 'left', cursor: inRange ? 'pointer' : 'not-allowed', opacity: inRange ? 1 : 0.6 }}>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>ID {p.id} • {inRange ? 'In range' : 'Too far'}</div>
                      </button>
                    )
                  })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button onClick={closeTradePicker} style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>Close</button>
              </div>
            </div>
          </div>
        )}

        {/* Crafting modal (simple) */}
        {isCraftingOpen && currentPlayerId && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1350 }}>
            <div style={{ background: '#0b0f14', color: '#e5e5e5', width: 360, padding: 16, borderRadius: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontWeight: 700 }}>Workbench Crafting</div>
                <button onClick={() => setIsCraftingOpen(false)} style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 8px', cursor: 'pointer' }}>Close</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={() => socket && socket.emit('craft', { recipe: 'upgrade_pickaxe_stone' })} style={{ background: '#1f2937', color: '#fff', border: '1px solid #374151', borderRadius: 8, padding: '10px 12px', textAlign: 'left' }}>
                  Upgrade Pickaxe → Stone (Cost: 12 stone) • Mining lvl 2+
                </button>
                <button onClick={() => socket && socket.emit('craft', { recipe: 'upgrade_pickaxe_gold' })} style={{ background: '#1f2937', color: '#fff', border: '1px solid #374151', borderRadius: 8, padding: '10px 12px', textAlign: 'left' }}>
                  Upgrade Pickaxe → Gold (Cost: 8 gold, 20 stone) • Mining lvl 6+
                </button>
                <button onClick={() => socket && socket.emit('craft', { recipe: 'upgrade_axe_stone' })} style={{ background: '#1f2937', color: '#fff', border: '1px solid #374151', borderRadius: 8, padding: '10px 12px', textAlign: 'left' }}>
                  Upgrade Axe → Stone (Cost: 10 stone) • Woodcutting lvl 2+
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Incoming trade invite */}
        {pendingTradeInvite && (
          <div style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1250 }}>
            <div style={{ background: '#111', color: '#fff', padding: 16, borderRadius: 10, width: 280, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{pendingTradeInvite.fromName || 'Player'} wants to trade</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
                <button onClick={acceptTradeInvite} style={{ background: '#22c55e', color: '#111', fontWeight: 700, border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer' }}>Accept</button>
                <button onClick={declineTradeInvite} style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer' }}>Decline</button>
              </div>
            </div>
          </div>
        )}
        {/* Trade window */}
        {tradeSession && currentPlayerId && (
          <div style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300 }}>
            <div style={{ background: '#0b0f14', color: '#e5e5e5', padding: 16, borderRadius: 10, width: 420 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Trade with {tradeSession.partnerName}</div>
                <button onClick={cancelTrade} style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 8px', cursor: 'pointer' }}>Cancel</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Your offer */}
                <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>You offer</div>
                  {['wood','stone','gold','diamond'].map(res => {
                    const inv = gameState.players[currentPlayerId]?.inventory || {}
                    const mine = (tradeSession.offers?.[currentPlayerId]?.[res]) || 0
                    const max = Math.max(0, Number(inv[res] || 0))
                    return (
                      <div key={res} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ textTransform: 'capitalize' }}>{res}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="number" min={0} max={max} value={mine}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0)))
                              updateTradeOffer({
                                wood: res==='wood'?v:(tradeSession.offers?.[currentPlayerId]?.wood||0),
                                stone: res==='stone'?v:(tradeSession.offers?.[currentPlayerId]?.stone||0),
                                gold: res==='gold'?v:(tradeSession.offers?.[currentPlayerId]?.gold||0),
                                diamond: res==='diamond'?v:(tradeSession.offers?.[currentPlayerId]?.diamond||0)
                              })
                            }}
                            style={{ width: 72, background: '#0b1220', color: '#e5e5e5', border: '1px solid #1f2937', borderRadius: 6, padding: '6px 8px' }} />
                          <span style={{ fontSize: 12, opacity: 0.8 }}>/ {max}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* Partner offer */}
                <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{tradeSession.partnerName} offers</div>
                  {['wood','stone','gold','diamond'].map(res => {
                    const theirs = (tradeSession.offers?.[tradeSession.partnerId]?.[res]) || 0
                    return (
                      <div key={res} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ textTransform: 'capitalize' }}>{res}</span>
                        <div>{theirs}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                  <span>You: {tradeSession.ready?.[currentPlayerId] ? 'Ready' : 'Not ready'}</span>
                  <span>{tradeSession.partnerName}: {tradeSession.ready?.[tradeSession.partnerId] ? 'Ready' : 'Not ready'}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setTradeReady(!tradeSession.ready?.[currentPlayerId])} style={{ background: tradeSession.ready?.[currentPlayerId] ? '#10b981' : '#374151', color: tradeSession.ready?.[currentPlayerId] ? '#111' : '#fff', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                    {tradeSession.ready?.[currentPlayerId] ? 'Unready' : 'Ready'}
                  </button>
                  <button onClick={confirmTrade} disabled={!(tradeSession.ready?.[currentPlayerId] && tradeSession.ready?.[tradeSession.partnerId])} style={{ background: '#22c55e', color: '#111', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: (tradeSession.ready?.[currentPlayerId] && tradeSession.ready?.[tradeSession.partnerId]) ? 'pointer' : 'not-allowed', opacity: (tradeSession.ready?.[currentPlayerId] && tradeSession.ready?.[tradeSession.partnerId]) ? 1 : 0.6, fontWeight: 700 }}>
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
      )}
    </div>
  )
}

export default App