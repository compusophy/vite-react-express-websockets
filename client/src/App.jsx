import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'
import GameCanvas from './GameCanvas'
import DPad from './DPad'

function App() {
  const [socket, setSocket] = useState(null)
  const [gameState, setGameState] = useState({
    players: {}
  })
  const [currentPlayerId, setCurrentPlayerId] = useState(null)
  const [canvasSize, setCanvasSize] = useState({ width: 300, height: 300 })

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

    return () => {
      newSocket.close()
    }
  }, [])

  const handleCanvasClick = (x, y) => {
    if (socket && currentPlayerId) {
      // Update immediately locally
      setGameState(prevState => {
        const newPlayers = { ...prevState.players }
        if (newPlayers[currentPlayerId]) {
          newPlayers[currentPlayerId].x = x
          newPlayers[currentPlayerId].y = y
        }
        return {
          ...prevState,
          players: newPlayers
        }
      })
      
      // Send to server
      socket.emit('player_move', { x, y })
    }
  }

  const handleDPadMove = (direction) => {
    if (socket && currentPlayerId && gameState.players[currentPlayerId]) {
      const currentPlayer = gameState.players[currentPlayerId]
      let newX = currentPlayer.x
      let newY = currentPlayer.y

      // Calculate new position based on direction
      switch (direction) {
        case 'up':
          newY = Math.max(0, newY - 1)
          break
        case 'down':
          newY = Math.min(23, newY + 1)
          break
        case 'left':
          newX = Math.max(0, newX - 1)
          break
        case 'right':
          newX = Math.min(23, newX + 1)
          break
      }

      // Only move if position actually changed
      if (newX !== currentPlayer.x || newY !== currentPlayer.y) {
        // Update immediately locally
        setGameState(prevState => {
          const newPlayers = { ...prevState.players }
          if (newPlayers[currentPlayerId]) {
            newPlayers[currentPlayerId].x = newX
            newPlayers[currentPlayerId].y = newY
          }
          return {
            ...prevState,
            players: newPlayers
          }
        })
        
        // Send to server
        socket.emit('player_move', { x: newX, y: newY })
      }
    }
  }

  return (
    <div className="app">
      <GameCanvas 
        gameState={gameState} 
        currentPlayerId={currentPlayerId}
        onCanvasClick={handleCanvasClick}
        onCanvasSizeChange={setCanvasSize}
      />
      <DPad onMove={handleDPadMove} canvasSize={canvasSize} />
    </div>
  )
}

export default App