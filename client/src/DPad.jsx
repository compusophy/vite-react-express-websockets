import { useState, useCallback, useEffect } from 'react'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

const DPad = ({ onMove, canvasSize }) => {
  const [activeDirection, setActiveDirection] = useState(null)
  const [dpadSize, setDpadSize] = useState({ buttonSize: 40, iconSize: 24 })

  const handleDirectionPress = useCallback((direction) => {
    if (activeDirection !== direction) {
      setActiveDirection(direction)
      onMove(direction)
    }
  }, [activeDirection, onMove])

  const handleDirectionRelease = useCallback(() => {
    setActiveDirection(null)
  }, [])

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
    const activeClass = activeDirection === direction ? ' active' : ''
    return `${baseClass} ${direction}${activeClass}`
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
        {/* Up button */}
        <button
          className={getButtonClass('up')}
          style={{
            width: `${dpadSize.buttonSize}px`,
            height: `${dpadSize.buttonSize}px`
          }}
          onMouseDown={() => handleDirectionPress('up')}
          onMouseUp={handleDirectionRelease}
          onMouseLeave={handleDirectionRelease}
        >
          <ChevronUp size={dpadSize.iconSize} strokeWidth={3} />
        </button>
        
        {/* Left and Right buttons */}
        <div className="dpad-horizontal">
          <button
            className={getButtonClass('left')}
            style={{
              width: `${dpadSize.buttonSize}px`,
              height: `${dpadSize.buttonSize}px`
            }}
            onMouseDown={() => handleDirectionPress('left')}
            onMouseUp={handleDirectionRelease}
            onMouseLeave={handleDirectionRelease}
          >
            <ChevronLeft size={dpadSize.iconSize} strokeWidth={3} />
          </button>
          
          <div 
            className="dpad-center-empty"
            style={{
              width: `${dpadSize.buttonSize}px`,
              height: `${dpadSize.buttonSize}px`
            }}
          ></div>
          
          <button
            className={getButtonClass('right')}
            style={{
              width: `${dpadSize.buttonSize}px`,
              height: `${dpadSize.buttonSize}px`
            }}
            onMouseDown={() => handleDirectionPress('right')}
            onMouseUp={handleDirectionRelease}
            onMouseLeave={handleDirectionRelease}
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
          onMouseDown={() => handleDirectionPress('down')}
          onMouseUp={handleDirectionRelease}
          onMouseLeave={handleDirectionRelease}
        >
          <ChevronDown size={dpadSize.iconSize} strokeWidth={3} />
        </button>
      </div>
    </div>
  )
}

export default DPad
