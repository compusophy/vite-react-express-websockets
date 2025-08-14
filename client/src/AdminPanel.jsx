import React from 'react'

const AdminPanel = ({ onResetBlocks, onNewMap, onResetLevels, blocksCount = 0, playersCount = 0 }) => {
  return (
    <div className="admin-panel">
      <span className="stat">Players: {playersCount}</span>
      <span className="stat">Blocks: {blocksCount}</span>
      <button onClick={onResetBlocks} aria-label="Reset Blocks">Reset Blocks</button>
      <button onClick={onNewMap} aria-label="New Map">New Map</button>
      <button onClick={onResetLevels} aria-label="Reset Levels">Reset Levels</button>
    </div>
  )
}

export default AdminPanel


