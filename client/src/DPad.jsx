import { useState, useCallback, useEffect } from 'react'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Flame, Droplet, Pickaxe, Mountain, Wind } from 'lucide-react'

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
  harvestArmed = false,
  canUsePickaxe = true,
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
    const allowed = isArrow && allowedDirections ? !!allowedDirections[direction] : true
    const isCenter = direction === 'center'
    const isDisabled = isArrow ? !allowed : (isCenter ? !canUsePickaxe : false)
    const disabledClass = isDisabled ? ' disabled' : ''
    const activeClass = (direction === 'earth' && armedSpell === 'earth') || (direction === 'center' && harvestArmed) ? ' aim' : ''
    return `${baseClass} ${direction}${disabledClass}${activeClass}`
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
        {/* Spell button (top-left) */}
        <button
          className={getButtonClass('spell') + (armedSpell === 'fire' ? ' aim' : '')}
          style={{
            width: `${dpadSize.buttonSize}px`,
            height: `${dpadSize.buttonSize}px`
          }}
          onPointerDown={handleSpellPress}
          onPointerUp={(e) => e.currentTarget.blur()}
          aria-label="Cast Spell"
        >
          <div className="spell-icon-wrapper">
            <Flame size={dpadSize.iconSize} strokeWidth={3} />
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

        {/* Frost button (top-right) */}
        <button
          className={getButtonClass('frost') + (armedSpell === 'water' ? ' aim' : '')}
          style={{
            width: `${dpadSize.buttonSize}px`,
            height: `${dpadSize.buttonSize}px`
          }}
          onPointerDown={handleFrostPress}
          onPointerUp={(e) => e.currentTarget.blur()}
          aria-label="Cast Frostbolt"
        >
          <div className="spell-icon-wrapper">
            <Droplet size={dpadSize.iconSize} strokeWidth={3} />
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
            onPointerDown={() => {
              if (!canUsePickaxe) return
              if (onPickaxe) onPickaxe()
              else if (onStop) onStop()
            }}
            onPointerUp={clearFocus}
            aria-label="Pickaxe / Harvest"
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

        {/* Earth button (bottom-left) */}
          <button
            className={getButtonClass('earth')}
          style={{
            width: `${dpadSize.buttonSize}px`,
            height: `${dpadSize.buttonSize}px`
          }}
          onPointerDown={handleEarthPress}
          onPointerUp={(e) => e.currentTarget.blur()}
          aria-label="Place Earth Block"
        >
          <div className="spell-icon-wrapper">
            <Mountain size={dpadSize.iconSize} strokeWidth={3} />
            {cooldownFraction > 0 && (
              <div 
                className="cooldown-overlay"
                style={{ height: `${cooldownFraction * 100}%` }}
                aria-hidden="true"
              />
            )}
          </div>
        </button>

        {/* Air button (bottom-right) */}
        <button
          className={getButtonClass('air') + (armedSpell === 'air' ? ' aim' : '')}
          style={{
            width: `${dpadSize.buttonSize}px`,
            height: `${dpadSize.buttonSize}px`
          }}
          onPointerDown={() => onArmAir && onArmAir()}
          onPointerUp={(e) => e.currentTarget.blur()}
          aria-label="Cast Air"
        >
          <div className="spell-icon-wrapper">
            <Wind size={dpadSize.iconSize} strokeWidth={3} />
            {cooldownFraction > 0 && (
              <div 
                className="cooldown-overlay"
                style={{ height: `${cooldownFraction * 100}%` }}
                aria-hidden="true"
              />
            )}
          </div>
        </button>
      </div>
    </div>
  )
}

export default DPad
