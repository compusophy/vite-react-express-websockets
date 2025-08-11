import { useState, useCallback, useEffect } from 'react'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Pickaxe, Hammer, Axe } from 'lucide-react'

const DPad = ({ 
  onMove, 
  onSpell, 
  onFrost, 
  onDirectionChange, 
  onArmEarth,
  onArmAir,
  onStop,
  canvasSize, 
  cooldownFraction = 0, 
  aimDirection = null,
  armedSpell = null,
  allowedDirections = null,
  onPickaxe,
  onAxe,
  harvestArmed = false,
  harvestTool = 'pickaxe',
  canUsePickaxe = true,
  canUseAxe = true,
  inventory = { wood: 0, stone: 0, gold: 0, diamond: 0 }
}) => {
  const [dpadSize, setDpadSize] = useState({ buttonSize: 40, iconSize: 24 })

  const handleDirectionPress = useCallback((direction) => {
    onMove(direction)
  }, [onMove])

  const clearFocus = (e) => {
    if (e && e.currentTarget) e.currentTarget.blur()
  }

  const handleSpellPress = useCallback(() => {
    if (onSpell) onSpell()
  }, [onSpell])

  const handleFrostPress = useCallback(() => {
    if (onFrost) onFrost()
  }, [onFrost])

  const handleEarthPress = useCallback(() => {
    if (onArmEarth) onArmEarth()
  }, [onArmEarth])

  // Calculate D-pad size using golden ratio of canvas width
  useEffect(() => {
    const calculateDpadSize = () => {
      const canvasWidth = canvasSize.width
      
      // Use golden ratio (61.803%) of CANVAS width for D-pad
      const dpadWidth = Math.floor(canvasWidth * 0.61803)
      const buttonSize = Math.floor(dpadWidth / 3) // 3x3 grid
      
      // Scale icon size proportionally (60% of button size)
      const iconSize = Math.max(16, Math.min(32, Math.floor(buttonSize * 0.6)))
      
      setDpadSize({
        buttonSize: buttonSize,
        iconSize: iconSize
      })
    }

    calculateDpadSize()
    window.addEventListener('resize', calculateDpadSize)
    
    return () => window.removeEventListener('resize', calculateDpadSize)
  }, [canvasSize])

  const getButtonClass = (direction) => {
    const baseClass = 'dpad-button'
    const isArrow = direction === 'up' || direction === 'down' || direction === 'left' || direction === 'right'
    let allowed = true
    if (isArrow && allowedDirections) {
      if (harvestArmed) {
        if (harvestTool === 'axe') allowed = !!allowedDirections?.wood?.[direction]
        else allowed = !!allowedDirections?.ore?.[direction]
      } else {
        allowed = !!allowedDirections[direction]
      }
    }
    const isCenter = direction === 'center'
    const isDisabled = isArrow ? !allowed : false
    const disabledClass = isDisabled ? ' disabled' : ''
    const activeClass = (direction === 'earth' && armedSpell === 'earth') ? ' aim' : ''
    return `${baseClass} ${direction}${disabledClass}${activeClass}`
  }

  const InventoryGrid = ({ inv, items = [] }) => {
    const btn = dpadSize.buttonSize
    const cellPx = Math.max(16, Math.floor(btn / 3))
    const iconPx = Math.max(12, Math.floor(cellPx * 0.6))

    const TreeIcon = ({ size = iconPx }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3 L7 10 H17 Z" fill="#7aa267" />
        <path d="M12 7 L6 15 H18 Z" fill="#7aa267" />
        <rect x="11" y="15" width="2" height="6" rx="1" fill="#7aa267" />
      </svg>
    )
    const StoneIcon = ({ size = iconPx }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 17 L9 9 L14 7 L18 12 L16 17 L8 19 Z" fill="#9aa3ad" stroke="#6e7781" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M10 10 L13 9 L15 12 L12 13 Z" fill="#b8c0c8" opacity="0.7"/>
      </svg>
    )
    const GoldIcon = ({ size = iconPx }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 14 L9 10 H15 L18 14 Z" fill="#e2c35b"/>
        <rect x="5" y="14" width="14" height="6" rx="1.5" fill="#d2b055"/>
        <path d="M5 14 H19" stroke="#a58833" strokeWidth="1" opacity="0.6"/>
        <path d="M6 14 L9 10 H15 L18 14" stroke="#a58833" strokeWidth="1" opacity="0.6"/>
        <path d="M7 16 H17" stroke="#f6e08a" strokeWidth="1" opacity="0.35"/>
      </svg>
    )
    const DiamondIcon = ({ size = iconPx }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3 L20 12 L12 21 L4 12 Z" fill="#7dd3fc"/>
        <path d="M12 3 L16 12 L12 21 L8 12 Z" fill="#c3f0ff" opacity="0.5"/>
        <path d="M12 3 L20 12 L16 12 Z" fill="#5bb8d6" opacity="0.4"/>
      </svg>
    )

    // Map items to icons; fallback to resource icons for now
    const renderItem = (it) => {
      if (!it) return null
      const iconSize = iconPx
      if (it.type?.startsWith('pickaxe')) return <Pickaxe size={iconSize} strokeWidth={3} />
      if (it.type === 'hammer') return <Hammer size={iconSize} strokeWidth={3} />
      if (it.type?.startsWith('axe')) return <Axe size={iconSize} strokeWidth={3} />
      if (it.type === 'wood') return <TreeIcon />
      if (it.type === 'stone') return <StoneIcon />
      if (it.type === 'gold') return <GoldIcon />
      return null
    }
    const slots = new Array(9).fill(null).map((_, i) => items[i] || null)
    return (
      <div style={{ width: '100%', height: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)', gap: 2, boxSizing: 'border-box', padding: 2 }}>
        {slots.map((it, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#141414', border: '1px solid rgba(255,255,255,0.08)', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '80%', height: '80%', background: '#0c0c0c', border: '1px solid rgba(255,255,255,0.06)' }}>
              {renderItem(it)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="dpad-container">
      <div 
        className="dpad"
        style={{
          gridTemplateColumns: `${dpadSize.buttonSize}px ${dpadSize.buttonSize}px ${dpadSize.buttonSize}px`,
          gridTemplateRows: `${dpadSize.buttonSize}px ${dpadSize.buttonSize}px ${dpadSize.buttonSize}px`
        }}
      >
        { /* When a spell is armed, subtly pulse the arrows to indicate next step */ }
        { /* We'll add the 'await-direction' class when armedSpell is set */ }
        { /* Compute once for readability */ }
        { /* Note: We keep aim glow only when a spell is armed */ }
        {/* Pickaxe tool (top-left) */}
        <button
          className={getButtonClass('pickaxe') + (harvestArmed && harvestTool === 'pickaxe' ? ' aim' : '')}
          style={{
            width: `${dpadSize.buttonSize}px`,
            height: `${dpadSize.buttonSize}px`
          }}
          onPointerDown={() => {
            if (!canUsePickaxe) return
            if (onPickaxe) onPickaxe()
          }}
          onPointerUp={(e) => e.currentTarget.blur()}
          aria-label="Pickaxe"
        >
          <div className="spell-icon-wrapper">
            <Pickaxe size={dpadSize.iconSize} strokeWidth={3} />
            {cooldownFraction > 0 && (
              <div 
                className="cooldown-overlay"
                style={{ height: `${cooldownFraction * 100}%` }}
                aria-hidden="true"
              />
            )}
          </div>
        </button>

        {/* Up button */}
          <button
          className={getButtonClass('up')}
          style={{
            width: `${dpadSize.buttonSize}px`,
            height: `${dpadSize.buttonSize}px`
          }}
          onPointerDown={() => handleDirectionPress('up')}
          onPointerUp={clearFocus}
        >
          <ChevronUp size={dpadSize.iconSize} strokeWidth={3} />
        </button>

        {/* Axe (top-right) */}
        <button
          className={getButtonClass('axe') + (harvestArmed && harvestTool === 'axe' ? ' aim' : '')}
          style={{
            width: `${dpadSize.buttonSize}px`,
            height: `${dpadSize.buttonSize}px`
          }}
          onPointerDown={() => {
            if (!canUseAxe) return
            if (onAxe) onAxe()
          }}
          onPointerUp={(e) => e.currentTarget.blur()}
          aria-label="Axe"
        >
          <div className="spell-icon-wrapper">
            <Axe size={dpadSize.iconSize} strokeWidth={3} />
            {cooldownFraction > 0 && (
              <div 
                className="cooldown-overlay"
                style={{ height: `${cooldownFraction * 100}%` }}
                aria-hidden="true"
              />
            )}
          </div>
        </button>
        
        {/* Left and Right buttons */}
        <div className="dpad-horizontal">
          <button
            className={getButtonClass('left')}
            style={{
              width: `${dpadSize.buttonSize}px`,
              height: `${dpadSize.buttonSize}px`
            }}
            onPointerDown={() => handleDirectionPress('left')}
            onPointerUp={clearFocus}
          >
            <ChevronLeft size={dpadSize.iconSize} strokeWidth={3} />
          </button>
          
          <button
            className={getButtonClass('center')}
            style={{
              width: `${dpadSize.buttonSize}px`,
              height: `${dpadSize.buttonSize}px`
            }}
            onPointerDown={(e) => { /* center is neutral now */ }}
            onPointerUp={clearFocus}
            aria-label="Neutral"
          >
            <div className="spell-icon-wrapper" />
          </button>
          
          <button
            className={getButtonClass('right')}
            style={{
              width: `${dpadSize.buttonSize}px`,
              height: `${dpadSize.buttonSize}px`
            }}
            onPointerDown={() => handleDirectionPress('right')}
            onPointerUp={clearFocus}
          >
            <ChevronRight size={dpadSize.iconSize} strokeWidth={3} />
          </button>
        </div>
        
        {/* Down button */}
          <button
            className={getButtonClass('down')}
          style={{
            width: `${dpadSize.buttonSize}px`,
            height: `${dpadSize.buttonSize}px`
          }}
          onPointerDown={() => handleDirectionPress('down')}
          onPointerUp={clearFocus}
        >
          <ChevronDown size={dpadSize.iconSize} strokeWidth={3} />
        </button>

        {/* Build/Hammer button (bottom-left) */}
          <button
            className={getButtonClass('earth')}
          style={{
            width: `${dpadSize.buttonSize}px`,
            height: `${dpadSize.buttonSize}px`
          }}
          onPointerDown={handleEarthPress}
          onPointerUp={(e) => e.currentTarget.blur()}
          aria-label="Build / Hammer"
        >
          <div className="spell-icon-wrapper">
            <Hammer size={dpadSize.iconSize} strokeWidth={3} />
            {cooldownFraction > 0 && (
              <div 
                className="cooldown-overlay"
                style={{ height: `${cooldownFraction * 100}%` }}
                aria-hidden="true"
              />
            )}
          </div>
        </button>

        {/* Inventory display (bottom-right) */}
        <button
          className={getButtonClass('air')}
          style={{
            width: `${dpadSize.buttonSize}px`,
            height: `${dpadSize.buttonSize}px`,
            padding: 0
          }}
          aria-label="Inventory"
        >
          <div style={{ width: '100%', height: '100%' }}>
            <InventoryGrid inv={inventory} items={inventory?.items || []} />
          </div>
        </button>
      </div>
    </div>
  )
}

export default DPad
