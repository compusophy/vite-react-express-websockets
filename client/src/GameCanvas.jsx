import { useRef, useEffect, useState } from 'react'

const GameCanvas = ({ gameState, currentPlayerId, onCanvasClick, onCanvasSizeChange }) => {
  const canvasRef = useRef(null)
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 600 })
  
  const GRID_COLS = 24  // 0-23
  const GRID_ROWS = 24  // 0-23

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
    
    // Clear everything
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)
    
    // Green background
    ctx.fillStyle = '#2E7D32'
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height)
    
    // Draw grid lines - hyper minimal
    ctx.strokeStyle = '#1B5E20'
    ctx.lineWidth = 0.5
    
    for (let x = 0; x <= canvasSize.width; x += GRID_SIZE) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvasSize.height)
      ctx.stroke()
    }
    
    for (let y = 0; y <= canvasSize.height; y += GRID_SIZE) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(canvasSize.width, y)
      ctx.stroke()
    }
    

    
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
        
        ctx.fillStyle = player.color
        ctx.beginPath()
        ctx.arc(pixelX, pixelY, circleRadius, 0, 2 * Math.PI)
        ctx.fill()
        
        if (player.id === currentPlayerId) {
          ctx.strokeStyle = '#FFD700'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(pixelX, pixelY, circleRadius + 2, 0, 2 * Math.PI)
          ctx.stroke()
        }
      })
    
  }, [gameState, currentPlayerId, canvasSize, GRID_SIZE])

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
      width={canvasSize.width}
      height={canvasSize.height}
      onClick={handleClick}
      className="game-canvas"
    />
  )
}

export default GameCanvas