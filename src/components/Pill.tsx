/**
 * Pill Component
 * 
 * A visual indicator component that displays the current state of the
 * voice-to-text pipeline. It shows different colors and text based on
 * whether the app is idle, recording, or processing audio.
 * 
 * The component is styled as a rounded "pill" shape that appears as an
 * overlay on the screen, providing visual feedback to the user about
 * the current operation status.
 */

import React from 'react'
import './Pill.css'

/**
 * Props for the Pill component
 */
interface PillProps {
  status: 'idle' | 'recording' | 'processing'  // Current pipeline status
  onClick: () => void                            // Click handler for manual control
}

export const Pill: React.FC<PillProps> = ({ status, onClick }) => {
  /**
   * Returns the background color based on the current status
   * 
   * Color coding:
   * - Red: Recording (actively capturing audio)
   * - Blue: Processing (transcribing audio)
   * - Gray: Idle (ready to record)
   */
  const getStatusColor = () => {
    switch (status) {
      case 'recording':
        return '#ef4444' // Red - indicates active recording
      case 'processing':
        return '#3b82f6' // Blue - indicates processing/transcription
      default:
        return '#1f2937' // Gray-800 - indicates idle/ready state
    }
  }

  /**
   * Returns the text label based on the current status
   * 
   * Provides clear textual feedback about what the app is currently doing.
   */
  const getStatusText = () => {
    switch (status) {
      case 'recording':
        return 'Recording...'  // User is speaking
      case 'processing':
        return 'Processing...'  // Audio is being transcribed
      default:
        return 'Start'          // Ready to record
    }
  }

  /**
   * Render the pill component
   * 
   * Displays a rounded pill-shaped button with:
   * - Dynamic background color based on status
   * - Icon (microphone when idle, stop icon when recording)
   * - Status text label
   */
  return (
    <div 
      className="pill-container"
      onClick={onClick}  // Allow manual recording control
      style={{ backgroundColor: getStatusColor() }}  // Apply status-based color
    >
      <div className="pill-content">
        {/* Display stop icon when recording, microphone icon otherwise */}
        <span className="pill-icon">
          {status === 'recording' ? '⏹' : '🎤'}
        </span>
        {/* Display status text */}
        <span className="pill-text">{getStatusText()}</span>
      </div>
    </div>
  )
}
