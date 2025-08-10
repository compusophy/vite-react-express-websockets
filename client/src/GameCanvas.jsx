import { useRef, useEffect, useState, useMemo } from 'react'

const GameCanvas = ({ gameState, currentPlayerId, onCanvasClick, onCanvasSizeChange, projectiles = [], mapSeed = 1337 }) => {
  const canvasRef = useRef(null)
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 600 })
  
  const GRID_COLS = 24  // 0-23
  const GRID_ROWS = 24  // 0-23
  const MAP_SEED = mapSeed
  const RESOURCE_CLUSTER = 3 // how many cells per resource patch

  // Deterministic player class assignment (wizard | knight | archer)
  const getPlayerClass = (playerId) => {
    const idNum = Number(playerId) || 0
    const classes = ['wizard', 'knight', 'archer']
    return classes[idNum % classes.length]
  }

  // Drawing helpers
  const drawRoundedRect = (ctx, x, y, w, h, r) => {
    const radius = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + w - radius, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
    ctx.lineTo(x + w, y + h - radius)
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
    ctx.lineTo(x + radius, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
  }

  const drawWizardIcon = (ctx, cx, cy, size) => {
    // Wand: thin diagonal rect
    const wandLen = size * 0.48
    const wandW = Math.max(2, size * 0.08)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-Math.PI / 6)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-wandLen * 0.2, -wandW / 2, wandLen, wandW)
    ctx.restore()
    // Spark: simple 4-ray star
    const r = size * 0.12
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(1.5, size * 0.06)
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke()
  }

  const drawKnightIcon = (ctx, cx, cy, size) => {
    // Shield: symmetric polygon
    const w = size * 0.55
    const h = size * 0.65
    const topY = cy - h * 0.5
    const bottomY = cy + h * 0.5
    ctx.beginPath()
    ctx.moveTo(cx - w * 0.5, topY + h * 0.2)
    ctx.lineTo(cx, topY)
    ctx.lineTo(cx + w * 0.5, topY + h * 0.2)
    ctx.lineTo(cx + w * 0.45, cy + h * 0.1)
    ctx.lineTo(cx, bottomY)
    ctx.lineTo(cx - w * 0.45, cy + h * 0.1)
    ctx.closePath()
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }

  const drawArcherIcon = (ctx, cx, cy, size) => {
    // Arrow: shaft + triangular head
    const len = size * 0.6
    const shaftW = Math.max(2, size * 0.08)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = shaftW
    ctx.beginPath()
    ctx.moveTo(cx - len * 0.3, cy)
    ctx.lineTo(cx + len * 0.2, cy)
    ctx.stroke()
    // Head
    const head = size * 0.24
    ctx.beginPath()
    ctx.moveTo(cx + len * 0.2, cy - head * 0.6)
    ctx.lineTo(cx + len * 0.45, cy)
    ctx.lineTo(cx + len * 0.2, cy + head * 0.6)
    ctx.closePath()
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }

  const drawStickFigure = (ctx, cx, cy, size, color) => {
    const headRadius = Math.max(2, size * 0.18)
    const lineWidth = Math.max(1.2, size * 0.12)
    const torsoLen = size * 0.38
    const armLen = size * 0.28
    const legLen = size * 0.36
    const torsoTopY = cy - headRadius - size * 0.04
    const torsoBottomY = torsoTopY + torsoLen
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = lineWidth
    // Head
    ctx.beginPath()
    ctx.arc(cx, cy - headRadius - torsoLen * 0.1, headRadius, 0, 2 * Math.PI)
    ctx.stroke()
    // Torso
    ctx.beginPath()
    ctx.moveTo(cx, torsoTopY)
    ctx.lineTo(cx, torsoBottomY)
    ctx.stroke()
    // Arms
    ctx.beginPath()
    ctx.moveTo(cx - armLen, torsoTopY + torsoLen * 0.35)
    ctx.lineTo(cx + armLen, torsoTopY + torsoLen * 0.35)
    ctx.stroke()
    // Legs
    ctx.beginPath()
    ctx.moveTo(cx, torsoBottomY)
    ctx.lineTo(cx - armLen * 0.6, torsoBottomY + legLen)
    ctx.moveTo(cx, torsoBottomY)
    ctx.lineTo(cx + armLen * 0.6, torsoBottomY + legLen)
    ctx.stroke()
    ctx.restore()
  }
  
  // Icon cache for lucide-like SVGs
  const iconCacheRef = useRef(new Map())
  const [iconVersion, setIconVersion] = useState(0)
  const getUserIconImage = (fillColor = '#ffffff') => {
    const key = `user-${fillColor}-filled`
    const cached = iconCacheRef.current.get(key)
    if (cached) return cached
    const svg = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\">\n  <circle cx=\"12\" cy=\"8\" r=\"4\" fill=\"${fillColor}\"/>\n  <rect x=\"6\" y=\"12\" width=\"12\" height=\"8\" rx=\"6\" fill=\"${fillColor}\"/>\n</svg>`
    const uri = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
    const img = new Image()
    img.onload = () => setIconVersion(v => v + 1)
    img.src = uri
    iconCacheRef.current.set(key, img)
    return img
  }
  const getTreeIconImage = (strokeColor = '#ffffff') => {
    const key = `tree-${strokeColor}`
    const cached = iconCacheRef.current.get(key)
    if (cached) return cached
    // Filled tree icon: stacked triangles + trunk rectangle
    const svg = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\">\n  <path d=\"M12 3 L7 10 H17 Z\" fill=\"${strokeColor}\"/>\n  <path d=\"M12 7 L6 15 H18 Z\" fill=\"${strokeColor}\"/>\n  <rect x=\"11\" y=\"15\" width=\"2\" height=\"6\" rx=\"1\" fill=\"${strokeColor}\"/>\n</svg>`
    const uri = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
    const img = new Image()
    img.onload = () => setIconVersion(v => v + 1)
    img.src = uri
    iconCacheRef.current.set(key, img)
    return img
  }

  const getStoneIconImage = (strokeColor = '#9aa3ad') => {
    const key = `stone-${strokeColor}-v2`
    const cached = iconCacheRef.current.get(key)
    if (cached) return cached
    // More rock-like shape with facets and outline
    const mainFill = strokeColor
    const outline = '#6e7781'
    const facet = '#b8c0c8'
    const svg = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\">\n  <path d=\"M6 17 L9 9 L14 7 L18 12 L16 17 L8 19 Z\" fill=\"${mainFill}\" stroke=\"${outline}\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/>\n  <path d=\"M10 10 L13 9 L15 12 L12 13 Z\" fill=\"${facet}\" opacity=\"0.7\"/>\n</svg>`
    const uri = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
    const img = new Image()
    img.onload = () => setIconVersion(v => v + 1)
    img.src = uri
    iconCacheRef.current.set(key, img)
    return img
  }

  const getGoldIconImage = (strokeColor = '#d2b055') => {
    const key = `gold-${strokeColor}-filled`
    const cached = iconCacheRef.current.get(key)
    if (cached) return cached
    // Filled gold ingot with subtle highlight and shadow lines
    const base = strokeColor
    const top = '#e2c35b'
    const shadow = '#a58833'
    const highlight = '#f6e08a'
    const svg = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\">\n  <path d=\"M6 14 L9 10 H15 L18 14 Z\" fill=\"${top}\"/>\n  <rect x=\"5\" y=\"14\" width=\"14\" height=\"6\" rx=\"1.5\" fill=\"${base}\"/>\n  <path d=\"M5 14 H19\" stroke=\"${shadow}\" stroke-width=\"1\" opacity=\"0.6\"/>\n  <path d=\"M6 14 L9 10 H15 L18 14\" stroke=\"${shadow}\" stroke-width=\"1\" opacity=\"0.6\"/>\n  <path d=\"M7 16 H17\" stroke=\"${highlight}\" stroke-width=\"1\" opacity=\"0.35\"/>\n</svg>`
    const uri = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
    const img = new Image()
    img.onload = () => setIconVersion(v => v + 1)
    img.src = uri
    iconCacheRef.current.set(key, img)
    return img
  }

  const getDiamondIconImage = (strokeColor = '#7dd3fc') => {
    const key = `diamond-${strokeColor}-filled`
    const cached = iconCacheRef.current.get(key)
    if (cached) return cached
    // Simple diamond (rhombus) with subtle facets
    const base = strokeColor
    const highlight = '#c3f0ff'
    const shadow = '#5bb8d6'
    const svg = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\">\n  <path d=\"M12 3 L20 12 L12 21 L4 12 Z\" fill=\"${base}\"/>\n  <path d=\"M12 3 L16 12 L12 21 L8 12 Z\" fill=\"${highlight}\" opacity=\"0.5\"/>\n  <path d=\"M12 3 L20 12 L16 12 Z\" fill=\"${shadow}\" opacity=\"0.4\"/>\n</svg>`
    const uri = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
    const img = new Image()
    img.onload = () => setIconVersion(v => v + 1)
    img.src = uri
    iconCacheRef.current.set(key, img)
    return img
  }

  const getVillagerIconImage = (fillColor = '#e5e5e5') => {
    const key = `villager-${fillColor}-v1`
    const cached = iconCacheRef.current.get(key)
    if (cached) return cached
    // Simple humanoid silhouette: head, torso/arms block, and two legs
    const svg = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\">\n  <circle cx=\"12\" cy=\"6.5\" r=\"3.2\" fill=\"${fillColor}\"/>\n  <rect x=\"6\" y=\"10\" width=\"12\" height=\"6.5\" rx=\"2.2\" fill=\"${fillColor}\"/>\n  <rect x=\"8\" y=\"16.5\" width=\"3.2\" height=\"5\" rx=\"1.2\" fill=\"${fillColor}\"/>\n  <rect x=\"12.8\" y=\"16.5\" width=\"3.2\" height=\"5\" rx=\"1.2\" fill=\"${fillColor}\"/>\n</svg>`
    const uri = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
    const img = new Image()
    img.onload = () => setIconVersion(v => v + 1)
    img.src = uri
    iconCacheRef.current.set(key, img)
    return img
  }

  // Class badges only (no external avatars)

  // Deterministic 2D hash-based RNG (0..1)
  const rand2D = (x, y, seed = MAP_SEED) => {
    let h = 2166136261
    h ^= x + 0x9e3779b9
    h = Math.imul(h, 16777619)
    h ^= y + 0x85ebca6b
    h = Math.imul(h, 16777619)
    h ^= seed
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h ^= h >>> 16
    // convert to [0,1]
    return (h >>> 0) / 4294967295
  }

  // Deterministic PRNG for map shuffling (xorshift32)
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

  const PHI = 0.61803

  // Generate a golden-ratio distributed resource map deterministically
  const resourceMap = useMemo(() => {
    const cols = GRID_COLS
    const rows = GRID_ROWS
    const total = cols * rows
    const rng = makeRng(MAP_SEED)
    // Build shuffled index list
    const indices = Array.from({ length: total }, (_, i) => i)
    for (let i = total - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = indices[i]
      indices[i] = indices[j]
      indices[j] = tmp
    }
    // Golden ratio counts
    const openCount = Math.round(PHI * total)
    const rem1 = total - openCount
    const treesCount = Math.round(PHI * rem1)
    const rem2 = rem1 - treesCount
    const stoneCount = Math.round(PHI * rem2)
    const rem3 = rem2 - stoneCount
    const goldCount = Math.round(PHI * rem3)
    const rem4 = rem3 - goldCount
    const diamondCount = Math.round(PHI * rem4)
    // Assign types
    const types = new Array(total).fill('open')
    let idx = 0
    // open -> already default
    idx += openCount
    for (let k = 0; k < treesCount && idx + k < total; k++) types[indices[idx + k]] = 'wood'
    idx += treesCount
    for (let k = 0; k < stoneCount && idx + k < total; k++) types[indices[idx + k]] = 'stone'
    idx += stoneCount
    for (let k = 0; k < goldCount && idx + k < total; k++) types[indices[idx + k]] = 'gold'
    idx += goldCount
    for (let k = 0; k < diamondCount && idx + k < total; k++) types[indices[idx + k]] = 'diamond'
    return types
  }, [GRID_COLS, GRID_ROWS, MAP_SEED])

  const getResourceTypeForCell = (cellX, cellY) => {
    const sx = Math.floor(cellX / RESOURCE_CLUSTER)
    const sy = Math.floor(cellY / RESOURCE_CLUSTER)
    const v = rand2D(sx, sy)
    if (v < 0.06) return 'gold'
    if (v < 0.2) return 'stone'
    if (v < 0.45) return 'wood'
    return 'grass'
  }

  // Calculate responsive canvas size
  useEffect(() => {
    const updateCanvasSize = () => {
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      
      // Mobile-first: check if mobile device (width < 768px)
      const isMobile = viewportWidth < 768
      
      let canvasDimension
      
      if (isMobile) {
        // Mobile: use full width, edge-to-edge square
        canvasDimension = viewportWidth
      } else {
        // Desktop: use 61.803% (golden ratio) of the smaller dimension
        const minDimension = Math.min(viewportWidth, viewportHeight)
        canvasDimension = Math.floor(minDimension * 0.61803)
        // Ensure minimum size for usability on desktop
        canvasDimension = Math.max(300, canvasDimension)
      }
      
      const newSize = {
        width: canvasDimension,
        height: canvasDimension
      }
      
      setCanvasSize(newSize)
      
      // Notify parent of canvas size change
      if (onCanvasSizeChange) {
        onCanvasSizeChange(newSize)
      }
    }

    // Initial calculation
    updateCanvasSize()

    // Update on window resize
    window.addEventListener('resize', updateCanvasSize)
    
    return () => window.removeEventListener('resize', updateCanvasSize)
  }, [])

  // Calculate grid size based on canvas size - ensure exactly 24x24 cells
  const GRID_SIZE = canvasSize.width / GRID_COLS

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    // HiDPI: scale drawing to device pixel ratio while keeping CSS size
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    
    // Clear everything
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)

    // Dark, muted dirt background
    ctx.fillStyle = '#1f1a14'
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height)

    // Resource cells (icons only; no background fills) from precomputed map
    const woodCells = []
    const stoneCells = []
    const goldCells = []
    const diamondCells = []
    const harvested = new Set((gameState.harvested || []).map(h => `${h.x},${h.y}`))
    for (let cy = 0; cy < GRID_ROWS; cy++) {
      for (let cx = 0; cx < GRID_COLS; cx++) {
        const idx = cy * GRID_COLS + cx
        const type = resourceMap[idx]
        if (harvested.has(`${cx},${cy}`)) continue
        if (type === 'wood') woodCells.push({ cx, cy })
        else if (type === 'stone') stoneCells.push({ cx, cy })
        else if (type === 'gold') goldCells.push({ cx, cy })
        else if (type === 'diamond') diamondCells.push({ cx, cy })
      }
    }

    // Node points at grid intersections (instead of grid lines)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
    const dotRadius = Math.max(0.75, Math.min(1.2, GRID_SIZE * 0.035))
    for (let x = 0; x <= canvasSize.width + 0.5; x += GRID_SIZE) {
      for (let y = 0; y <= canvasSize.height + 0.5; y += GRID_SIZE) {
        ctx.beginPath()
        ctx.arc(x, y, dotRadius, 0, 2 * Math.PI)
        ctx.fill()
      }
    }
    

    
    // Draw server blocks first (beneath players)
    const blocks = gameState.blocks || []
    blocks.forEach(b => {
      const pixelX = b.x * GRID_SIZE + (GRID_SIZE / 2)
      const pixelY = b.y * GRID_SIZE + (GRID_SIZE / 2)
      const size = Math.max(12, Math.min(18, GRID_SIZE * 0.8))
      ctx.fillStyle = '#6b5f3b'
      ctx.strokeStyle = '#3f3a26'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.rect(pixelX - size/2, pixelY - size/2, size, size)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(pixelX - size/2, pixelY - size/2, size, size * 0.35)
      ctx.fillStyle = 'rgba(0,0,0,0.08)'
      ctx.fillRect(pixelX - size/2, pixelY + size*0.15, size, size * 0.35)
    })

    // Draw resource icons (no thinning)
    const drawIconSet = (cells, getIcon, color, sizeFactor = 0.7) => {
      cells.forEach(({ cx, cy }) => {
        const centerX = cx * GRID_SIZE + (GRID_SIZE / 2)
        const centerY = cy * GRID_SIZE + (GRID_SIZE / 2)
        const iconSize = Math.max(12, Math.min(24, GRID_SIZE * sizeFactor))
        const iconImg = getIcon(color)
        if (iconImg && iconImg.complete) {
          ctx.drawImage(iconImg, centerX - iconSize * 0.5, centerY - iconSize * 0.5, iconSize, iconSize)
        }
      })
    }

    drawIconSet(woodCells, getTreeIconImage, '#7aa267', 0.7)
    drawIconSet(stoneCells, getStoneIconImage, '#9aa3ad', 0.7)
    drawIconSet(goldCells, getGoldIconImage, '#d2b055', 0.7)
    drawIconSet(diamondCells, getDiamondIconImage, '#7dd3fc', 0.7)

    // Draw players
    Object.values(gameState.players)
      .filter(player => player.isActive)
      .forEach(player => {
        // Convert cell coordinates to pixel coordinates for drawing
        const pixelX = player.x * GRID_SIZE + (GRID_SIZE / 2)
        const pixelY = player.y * GRID_SIZE + (GRID_SIZE / 2)
        
        // Calculate circle radius to fit nicely inside cell with some padding
        const maxRadius = (GRID_SIZE / 2) * 0.7 // 70% of half cell size
        const circleRadius = Math.max(4, Math.min(12, maxRadius)) // Between 4-12px
        
        // All players: Lucide user icon (pure canvas)
        const targetSize = Math.max(14, Math.min(26, GRID_SIZE * 0.75))
        const villager = getVillagerIconImage(player.color || '#e5e5e5')
        if (villager && villager.complete) {
          ctx.drawImage(villager, pixelX - targetSize / 2, pixelY - targetSize / 2, targetSize, targetSize)
        } else {
          // Fallback: filled user silhouette
          const iconImg = getUserIconImage(player.color || '#ffffff')
          if (iconImg && iconImg.complete) {
            ctx.drawImage(iconImg, pixelX - targetSize / 2, pixelY - targetSize / 2, targetSize, targetSize)
          }
        }
        if (player.id === currentPlayerId) {
          // Ownership ring only for current player
          ctx.strokeStyle = 'rgba(229,229,229,0.8)'
          ctx.lineWidth = 0.75
          ctx.beginPath()
          ctx.arc(pixelX, pixelY, Math.max(8, targetSize * 0.55), 0, 2 * Math.PI)
          ctx.stroke()
        }
      })

    // Draw projectiles (fireballs/frostbolts) with same style; only color differs
    projectiles.forEach(p => {
      const pixelX = p.x * GRID_SIZE
      const pixelY = p.y * GRID_SIZE
      if (p.type === 'earth') {
        const size = Math.max(12, Math.min(18, GRID_SIZE * 0.8))
        // Block body
        ctx.fillStyle = '#6b5f3b'
        ctx.strokeStyle = '#3f3a26'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.rect(pixelX - size/2, pixelY - size/2, size, size)
        ctx.fill()
        ctx.stroke()
        // Top highlight
        ctx.fillStyle = 'rgba(255,255,255,0.06)'
        ctx.fillRect(pixelX - size/2, pixelY - size/2, size, size * 0.35)
        // Bottom shadow
        ctx.fillStyle = 'rgba(0,0,0,0.08)'
        ctx.fillRect(pixelX - size/2, pixelY + size*0.15, size, size * 0.35)
        return
      }
      const outerRadius = Math.max(4, Math.min(10, GRID_SIZE * 0.3))

      const isFrost = p.type === 'frostbolt'
      const isAir = p.type === 'air'
      const glowInner = isFrost
        ? 'rgba(66, 165, 245, 0.9)'
        : isAir
          ? 'rgba(200, 255, 255, 0.7)'
          : 'rgba(255, 140, 0, 0.85)'
      const glowOuter = isFrost
        ? 'rgba(66, 165, 245, 0)'
        : isAir
          ? 'rgba(200, 255, 255, 0)'
        : 'rgba(255, 69, 0, 0)'
      const coreColor = isFrost
        ? '#2196F3'
        : isAir
          ? '#D7FFFF'
          : '#FF6B00'

      // Outer glow
      const gradient = ctx.createRadialGradient(pixelX, pixelY, 0, pixelX, pixelY, outerRadius)
      gradient.addColorStop(0, glowInner)
      gradient.addColorStop(1, glowOuter)
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(pixelX, pixelY, outerRadius, 0, 2 * Math.PI)
      ctx.fill()

      // Core
      ctx.fillStyle = coreColor
      ctx.beginPath()
      ctx.arc(pixelX, pixelY, Math.max(2, outerRadius * 0.35), 0, 2 * Math.PI)
      ctx.fill()
    })
    
  }, [gameState, currentPlayerId, canvasSize, GRID_SIZE, projectiles, iconVersion])

  const handleClick = (event) => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Get the EXACT canvas coordinates
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    
    const clickX = (event.clientX - rect.left) * scaleX
    const clickY = (event.clientY - rect.top) * scaleY
    
    // Convert to cell coordinates
    const cellX = Math.floor(clickX / GRID_SIZE)
    const cellY = Math.floor(clickY / GRID_SIZE)
    
    // Clamp to valid range
    const validCellX = Math.max(0, Math.min(GRID_COLS - 1, cellX))
    const validCellY = Math.max(0, Math.min(GRID_ROWS - 1, cellY))
    
    console.log(`CANVAS RECT: ${rect.width}x${rect.height}, CANVAS SIZE: ${canvas.width}x${canvas.height}`)
    console.log(`SCALE: ${scaleX.toFixed(2)}x${scaleY.toFixed(2)}`)
    console.log(`RAW CLICK: (${event.clientX - rect.left}, ${event.clientY - rect.top}) -> SCALED: (${clickX.toFixed(1)}, ${clickY.toFixed(1)}) -> CELL: (${validCellX}, ${validCellY})`)
    
    onCanvasClick(validCellX, validCellY)
  }

  return (
    <canvas
      ref={canvasRef}
      width={Math.floor(canvasSize.width * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1))}
      height={Math.floor(canvasSize.height * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1))}
      onClick={handleClick}
      className="game-canvas"
      style={{ width: `${canvasSize.width}px`, height: `${canvasSize.height}px` }}
    />
  )
}

export default GameCanvas