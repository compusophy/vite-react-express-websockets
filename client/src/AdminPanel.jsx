import React, { useState } from 'react'
import { Cog } from 'lucide-react'

const AdminPanel = ({ onResetBlocks, onNewMap, onResetLevels, blocksCount = 0, playersCount = 0, cooldownsEnabled = false, onToggleCooldowns }) => {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div style={{ position: 'fixed', top: 10, right: 10, zIndex: 1400 }}>
      <button
        onClick={() => setCollapsed(prev => !prev)}
        aria-label={collapsed ? 'Open Admin Panel' : 'Collapse Admin Panel'}
        style={{
          background: '#0b0f14', color: '#e5e5e5', border: '1px solid #1f2937', borderRadius: 8,
          padding: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40
        }}
        title={collapsed ? 'Open settings' : 'Collapse settings'}
      >
        <Cog size={20} />
      </button>
      {!collapsed && (
        <div className="admin-panel" style={{ marginTop: 8, background: '#0b0f14', color: '#e5e5e5', border: '1px solid #1f2937', borderRadius: 10, padding: 10, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="stat">Players: {playersCount}</span>
            <span className="stat">Blocks: {blocksCount}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={onResetBlocks} aria-label="Reset Blocks" style={{ background: '#111827', color: '#e5e5e5', border: '1px solid #1f2937', borderRadius: 6, padding: '6px 8px', cursor: 'pointer' }}>Reset Blocks</button>
            <button onClick={onNewMap} aria-label="New Map" style={{ background: '#111827', color: '#e5e5e5', border: '1px solid #1f2937', borderRadius: 6, padding: '6px 8px', cursor: 'pointer' }}>New Map</button>
            <button onClick={onResetLevels} aria-label="Reset Levels" style={{ background: '#111827', color: '#e5e5e5', border: '1px solid #1f2937', borderRadius: 6, padding: '6px 8px', cursor: 'pointer' }}>Reset Levels</button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 4 }}>
              <input type="checkbox" checked={!!cooldownsEnabled} onChange={() => onToggleCooldowns && onToggleCooldowns()} />
              Cooldowns enabled
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminPanel


