/**
 * Pill Window Entry Point
 * 
 * This is the entry point for the pill overlay window.
 * It renders a minimal React component that displays the current
 * recording/processing status as a small overlay at the bottom of the screen.
 */

import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './index.css'

/**
 * Pill Component
 * 
 * A visual indicator component that displays the current state of the
 * voice-to-text pipeline. It shows different colors and text based on
 * whether the app is idle, recording, or processing audio.
 */

/**
 * Note: Pill window positioning is handled in the Rust setup hook
 * (main.rs setup function) to ensure it's positioned before becoming visible.
 * This prevents the visible repositioning issue.
 */
const Pill: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing'>('idle')

  useEffect(() => {
    const setupListeners = async () => {
      try {
        // Listen for recording started
        const unlistenStarted = await listen('recording_started', () => {
          setStatus('recording')
        })

        // Listen for recording stopped
        const unlistenStopped = await listen('recording_stopped', () => {
          setStatus('processing')
        })

        // Listen for processing start
        const unlistenProcessing = await listen('processing_start', () => {
          setStatus('processing')
        })

        // Listen for transcription success
        const unlistenSuccess = await listen('transcription_success', () => {
          setStatus('idle')
        })

        // Listen for transcription error
        const unlistenError = await listen('transcription_error', () => {
          setStatus('idle')
        })

        // Cleanup function
        return () => {
          unlistenStarted()
          unlistenStopped()
          unlistenProcessing()
          unlistenSuccess()
          unlistenError()
        }
      } catch (error) {
        console.error('Failed to set up event listeners:', error)
      }
    }

    setupListeners()
  }, [])

  /**
   * Returns the background color based on the current status
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
   */
  const getStatusText = () => {
    switch (status) {
      case 'recording':
        return 'Recording...'
      case 'processing':
        return 'Processing...'
      default:
        return 'Ready'
    }
  }

  /**
   * Returns the icon based on the current status
   */
  const getStatusIcon = () => {
    switch (status) {
      case 'recording':
        return '⏹'
      default:
        return '🎤'
    }
  }

  const handleMouseDown = async () => {
    // Start dragging the window when clicking on the pill
    try {
      const window = getCurrentWindow()
      await window.startDragging()
    } catch (error) {
      console.error('Failed to start dragging:', error)
    }
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '180px',
        height: '50px',
        borderRadius: '9999px',
        cursor: 'move',
        transition: 'background-color 0.3s ease',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        userSelect: 'none',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        backgroundColor: getStatusColor(),
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: 'white',
          fontWeight: 500,
          fontSize: '14px',
        }}
      >
        <span style={{ fontSize: '16px' }}>{getStatusIcon()}</span>
        <span>{getStatusText()}</span>
      </div>
    </div>
  )
}

/**
 * Root component for the pill window
 * Sets up the transparent background and centers the pill
 */
const PillApp: React.FC = () => {
  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        background: 'transparent',
        height: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <Pill />
    </div>
  )
}

// Render the pill app
const rootElement = document.getElementById('root')
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <PillApp />
    </React.StrictMode>
  )
} else {
  console.error('Root element not found')
}

