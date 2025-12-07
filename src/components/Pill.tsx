import React from 'react'
import './Pill.css'

interface PillProps {
  status: 'idle' | 'recording' | 'processing'
  onClick: () => void
}

export const Pill: React.FC<PillProps> = ({ status, onClick }) => {
  const getStatusColor = () => {
    switch (status) {
      case 'recording':
        return '#ef4444' // Red
      case 'processing':
        return '#3b82f6' // Blue
      default:
        return '#1f2937' // Gray-800
    }
  }

  const getStatusText = () => {
    switch (status) {
      case 'recording':
        return 'Recording...'
      case 'processing':
        return 'Processing...'
      default:
        return 'Start'
    }
  }

  return (
    <div 
      className="pill-container"
      onClick={onClick}
      style={{ backgroundColor: getStatusColor() }}
    >
      <div className="pill-content">
        <span className="pill-icon">
          {status === 'recording' ? '⏹' : '🎤'}
        </span>
        <span className="pill-text">{getStatusText()}</span>
      </div>
    </div>
  )
}
