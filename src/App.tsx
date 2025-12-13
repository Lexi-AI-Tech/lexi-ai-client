/**
 * Main App Component
 * 
 * This is the root React component for the Lexi AI frontend.
 * It manages the application state and listens to events from the Tauri backend
 * to update the UI based on recording and transcription status.
 * 
 * The app displays its own interface showing:
 * - Current status (idle, recording, processing)
 * - Manual recording controls
 * - Settings and instructions
 */

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/**
 * Application state interface
 * 
 * Tracks whether we're currently recording and the overall status
 * of the voice-to-text pipeline.
 */
interface AppState {
  isRecording: boolean  // True when audio is being captured
  status: 'idle' | 'recording' | 'processing'  // Current pipeline status
  recordingDuration: number  // Duration of current recording in seconds
}

function App() {
  // Initialize application state
  // The state is updated based on events from the Tauri backend
  const [state, setState] = useState<AppState>({
    isRecording: false,
    status: 'idle',  // Start in idle state
    recordingDuration: 0
  })

  const [isRequestingPermission, setIsRequestingPermission] = useState(false)
  const [isRequestingInputMonitoring, setIsRequestingInputMonitoring] = useState(false)
  const [isRequestingAccessibility, setIsRequestingAccessibility] = useState(false)
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null)

  /**
   * Set up event listeners for backend events
   * 
   * This effect runs once on component mount and sets up listeners for
   * all events emitted by the Tauri backend. These events notify the
   * frontend about the state of the recording and transcription pipeline.
   * 
   * Events listened to:
   * - recording_started: Backend detected Option key press, started recording
   * - recording_stopped: Backend detected Option key release, stopped recording
   * - processing_start: Backend started transcribing the audio
   * - transcription_success: Transcription completed successfully
   * - transcription_error: Transcription failed (API error, etc.)
   */
  useEffect(() => {
    console.log('Lexi AI initialized')

    const setupListeners = async () => {
      // Listen for when recording starts (Option key pressed)
      const unlistenStarted = await listen('recording_started', () => {
        setState(prev => ({
          ...prev,
          isRecording: true,
          status: 'recording',  // Update UI to show recording state
          recordingDuration: 0
        }))
      })

      // Listen for when recording stops (Option key released)
      const unlistenStopped = await listen('recording_stopped', () => {
        setState(prev => ({
          ...prev,
          isRecording: false,
          status: 'processing'  // Transition to processing state
        }))
      })

      // Listen for when transcription processing begins
      const unlistenProcessingStart = await listen('processing_start', () => {
        setState(prev => ({
          ...prev,
          status: 'processing'  // Ensure we're in processing state
        }))
      })

      // Listen for successful transcription completion
      const unlistenSuccess = await listen('transcription_success', () => {
        setState(prev => ({
          ...prev,
          status: 'idle'  // Return to idle, ready for next recording
        }))
      })

      // Listen for transcription errors
      const unlistenError = await listen('transcription_error', (event: any) => {
        console.error('Transcription error:', event.payload)
        setState(prev => ({
          ...prev,
          status: 'idle'  // Return to idle even on error
        }))
      })

      // Listen for global input events from rdev listener
      const unlistenGlobalInput = await listen('global-input', (event: any) => {
        console.log('Received global input event:', event.payload)
        // Update UI, e.g., display keystrokes or trigger actions
        // You can add custom logic here based on the event type
      })

      // Return cleanup function to unregister all listeners
      // This prevents memory leaks when the component unmounts
      return () => {
        unlistenStarted()
        unlistenStopped()
        unlistenProcessingStart()
        unlistenSuccess()
        unlistenError()
        unlistenGlobalInput()
      }
    }

    setupListeners()
  }, [])  // Empty dependency array means this runs only once on mount

  /**
   * Track recording duration
   */
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    if (state.isRecording) {
      interval = setInterval(() => {
        setState(prev => ({
          ...prev,
          recordingDuration: prev.recordingDuration + 1
        }))
      }, 1000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [state.isRecording])

  /**
   * Periodically check recording state from backend
   * 
   * This effect polls the backend every second to check if recording is active.
   * This serves as a fallback mechanism in case event listeners fail or
   * the state gets out of sync. It helps ensure the UI accurately reflects
   * the backend state.
   * 
   * Note: The `is_recording` command may not be implemented in the backend
   * (it's not in the current main.rs), so this may throw an error.
   * This is kept for potential future use or manual recording triggers.
   */
  useEffect(() => {
    const checkRecordingState = async () => {
      try {
        // Attempt to query the backend for current recording state
        const isRecording = await invoke('is_recording')
        // Only update state if it differs from current state
        if (isRecording !== state.isRecording) {
          setState(prev => ({
            ...prev,
            isRecording: Boolean(isRecording),
            status: Boolean(isRecording) ? 'recording' : prev.status
          }))
        }
      } catch (error) {
        // Silently handle errors (command may not be implemented)
        console.error('Failed to check recording state:', error)
      }
    }

    // Check every second
    const interval = setInterval(checkRecordingState, 1000)
    // Cleanup: clear interval when component unmounts or state changes
    return () => clearInterval(interval)
  }, [state.isRecording])


  /**
   * Format duration in MM:SS format
   */
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  /**
   * Get status text based on current state
   */
  const getStatusText = (): string => {
    switch (state.status) {
      case 'recording':
        return 'Recording'
      case 'processing':
        return 'Processing'
      default:
        return 'Ready'
    }
  }

  /**
   * Request microphone permission from macOS
   */
  const handleRequestMicrophonePermission = async () => {
    setIsRequestingPermission(true)
    setPermissionMessage(null)
    
    try {
      const result = await invoke<boolean>('request_microphone_permission')
      if (result) {
        setPermissionMessage('Permission dialog should appear. Please grant microphone access in the dialog.')
        // Clear message after 5 seconds
        setTimeout(() => setPermissionMessage(null), 5000)
      }
    } catch (error) {
      console.error('Failed to request microphone permission:', error)
      setPermissionMessage('Failed to request permission. Please try again or grant permission manually in System Settings.')
      setTimeout(() => setPermissionMessage(null), 5000)
    } finally {
      setIsRequestingPermission(false)
    }
  }

  /**
   * Request Input Monitoring permission from macOS
   */
  const handleRequestInputMonitoringPermission = async () => {
    setIsRequestingInputMonitoring(true)
    setPermissionMessage(null)
    
    try {
      const result = await invoke<boolean>('request_input_monitoring_permission')
      if (result) {
        setPermissionMessage('Permission dialog should appear. Please grant Input Monitoring access in the dialog, then restart the app.')
        // Clear message after 8 seconds
        setTimeout(() => setPermissionMessage(null), 8000)
      }
    } catch (error) {
      console.error('Failed to request Input Monitoring permission:', error)
      setPermissionMessage('Failed to request permission. Please manually grant Input Monitoring permission in System Settings → Privacy & Security → Input Monitoring.')
      setTimeout(() => setPermissionMessage(null), 8000)
    } finally {
      setIsRequestingInputMonitoring(false)
    }
  }

  /**
   * Request Accessibility permission from macOS (required for pasting text)
   */
  const handleRequestAccessibilityPermission = async () => {
    setIsRequestingAccessibility(true)
    setPermissionMessage(null)
    
    try {
      const result = await invoke<boolean>('request_accessibility_permission')
      if (result) {
        setPermissionMessage('Permission dialog should appear. Please grant Accessibility access in the dialog, then restart the app.')
        // Clear message after 8 seconds
        setTimeout(() => setPermissionMessage(null), 8000)
      }
    } catch (error) {
      console.error('Failed to request Accessibility permission:', error)
      setPermissionMessage('Failed to request permission. Please manually grant Accessibility permission in System Settings → Privacy & Security → Accessibility.')
      setTimeout(() => setPermissionMessage(null), 8000)
    } finally {
      setIsRequestingAccessibility(false)
    }
  }

  /**
   * Render the application UI
   * 
   * The app displays its own interface with status, controls, and settings.
   */
  return (
    <div className="app">
      <div className="container">
        {/* Header */}
        <div className="header">
          <div className="app-title">
            <div className="logo">🎤</div>
            <div className="title-text">
              <h1>Lexi AI</h1>
              <p>Voice-to-Text Assistant</p>
            </div>
          </div>
        </div>

        {/* Status Container */}
        <div className="status-container">
          <div className={`status ${state.status}`}>
            <span className="status-icon"></span>
            {getStatusText()}
            {state.isRecording && (
              <span className="duration">{formatDuration(state.recordingDuration)}</span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="controls">
          <button
            className={`button ${state.isRecording ? 'recording' : 'primary'}`}
            onClick={() => {}}
            disabled={state.status === 'processing'}
          >
            {state.isRecording ? (
              <>
                <span className="recording-indicator"></span>
                <span>Stop Recording</span>
              </>
            ) : (
              <>
                <span className="icon">🎤</span>
                <span>Start Recording</span>
              </>
            )}
          </button>
        </div>

        {/* Permission Request Section */}
        <div className="settings">
          <h3>Permissions</h3>
          <div className="permission-section">
            <p className="permission-text">
              This app needs three permissions:
            </p>
            <ul style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.6)', textAlign: 'left', marginBottom: '12px', paddingLeft: '20px' }}>
              <li>Microphone - to record audio</li>
              <li>Input Monitoring - to detect fn/Option key presses</li>
              <li>Accessibility - to paste transcribed text into applications</li>
            </ul>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                className="button secondary"
                onClick={handleRequestMicrophonePermission}
                disabled={isRequestingPermission}
              >
                {isRequestingPermission ? 'Requesting...' : 'Request Microphone Permission'}
              </button>
              <button
                className="button secondary"
                onClick={handleRequestInputMonitoringPermission}
                disabled={isRequestingInputMonitoring}
              >
                {isRequestingInputMonitoring ? 'Requesting...' : 'Request Input Monitoring Permission'}
              </button>
              <button
                className="button secondary"
                onClick={handleRequestAccessibilityPermission}
                disabled={isRequestingAccessibility}
              >
                {isRequestingAccessibility ? 'Requesting...' : 'Request Accessibility Permission'}
              </button>
            </div>
            {permissionMessage && (
              <div className="permission-message">
                {permissionMessage}
              </div>
            )}
          </div>
        </div>

        {/* Settings */}
        <div className="settings">
          <h3>How to Use</h3>
          <div className="hotkey-display">
            <span>Press and hold</span>
            <span className="hotkey-combo">fn</span>
            <span>or</span>
            <span className="hotkey-combo">Option</span>
            <span>to record</span>
          </div>
          <div className="instructions">
            Hold the Function key (fn) or Option key to start recording. Release it to stop and automatically transcribe your speech.
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
