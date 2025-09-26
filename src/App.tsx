import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/tauri'

interface AppState {
  isRecording: boolean
  status: string
  statusType: string
  currentTranscript: string
  showTranscript: boolean
  isProcessing: boolean
  recordingDuration: number
  transcriptHistory: string[]
}

function App() {
  const [state, setState] = useState<AppState>({
    isRecording: false,
    status: 'Ready',
    statusType: '',
    currentTranscript: '',
    showTranscript: false,
    isProcessing: false,
    recordingDuration: 0,
    transcriptHistory: []
  })

  // Initialize
  useEffect(() => {
    console.log('Lexi AI Client initialized')
  }, [])

  // Recording duration timer
  useEffect(() => {
    let interval: number
    if (state.isRecording) {
      interval = setInterval(() => {
        setState(prev => ({ ...prev, recordingDuration: prev.recordingDuration + 1 }))
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [state.isRecording])

  // Update status with animation
  const updateStatus = (text: string, type: string = '') => {
    setState(prev => ({ ...prev, status: text, statusType: type }))
  }

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Start recording
  const startRecording = async () => {
    if (state.isRecording) return
    
    try {
      await invoke('start_recording')
      setState(prev => ({
        ...prev,
        isRecording: true,
        showTranscript: false,
        recordingDuration: 0
      }))
      updateStatus('Recording...', 'recording')
    } catch (error) {
      console.error('Failed to start recording:', error)
      updateStatus('Error starting recording', 'error')
    }
  }

  // Stop recording
  const stopRecording = async () => {
    if (!state.isRecording) return
    
    try {
      updateStatus('Processing...', 'processing')
      setState(prev => ({ ...prev, isProcessing: true }))
      await invoke('stop_recording')
      setState(prev => ({ ...prev, isRecording: false }))
      
      // Simulate processing time
      setTimeout(() => {
        updateStatus('Ready')
        setState(prev => ({ ...prev, isProcessing: false }))
        
        // Show sample transcript (replace with actual transcript)
        const sampleTranscript = 'Sample transcription: "Hello, this is a test of the speech-to-text functionality. This is a longer sample to demonstrate the transcript display capabilities."'
        setState(prev => ({
          ...prev,
          currentTranscript: sampleTranscript,
          showTranscript: true,
          transcriptHistory: [...prev.transcriptHistory, sampleTranscript]
        }))
      }, 1500)
    } catch (error) {
      console.error('Failed to stop recording:', error)
      updateStatus('Error stopping recording', 'error')
      setState(prev => ({ ...prev, isProcessing: false }))
    }
  }

  // Copy transcript to clipboard
  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(state.currentTranscript)
      updateStatus('Copied to clipboard!', 'success')
      setTimeout(() => updateStatus('Ready'), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
      updateStatus('Failed to copy', 'error')
    }
  }

  // Clear transcript
  const clearTranscript = () => {
    setState(prev => ({
      ...prev,
      currentTranscript: '',
      showTranscript: false
    }))
  }

  // Clear history
  const clearHistory = () => {
    setState(prev => ({
      ...prev,
      transcriptHistory: [],
      currentTranscript: '',
      showTranscript: false
    }))
  }

  // Listen for recording state changes from the backend
  useEffect(() => {
    const checkRecordingState = async () => {
      try {
        const isRecording = await invoke('is_recording')
        if (isRecording !== state.isRecording) {
          setState(prev => ({ ...prev, isRecording: Boolean(isRecording) }))
        }
      } catch (error) {
        console.error('Failed to check recording state:', error)
      }
    }

    const interval = setInterval(checkRecordingState, 1000)
    return () => clearInterval(interval)
  }, [state.isRecording])

  return (
    <div className="app">
      <div className="container">
        <div className="header">
          <div className="app-title">
            <div className="logo">🎤</div>
            <div className="title-text">
              <h1>Lexi AI</h1>
              <p>Speech-to-Text Overlay</p>
            </div>
          </div>
        </div>

        <div className="status-container">
          <div className={`status ${state.statusType}`}>
            <div className="status-icon"></div>
            <span>{state.status}</span>
            {state.isRecording && (
              <span className="duration">{formatDuration(state.recordingDuration)}</span>
            )}
          </div>
        </div>
        
        <div className="controls">
          <button 
            className={`button primary ${state.isRecording ? 'recording' : ''}`}
            onClick={startRecording}
            disabled={state.isRecording || state.isProcessing}
          >
            {state.isRecording ? (
              <>
                <div className="recording-indicator"></div>
                Recording...
              </>
            ) : (
              <>
                <span className="icon">🎤</span>
                Start Recording
              </>
            )}
          </button>
          <button 
            className="button secondary"
            onClick={stopRecording}
            disabled={!state.isRecording}
          >
            <span className="icon">⏹️</span>
            Stop Recording
          </button>
        </div>

        <div className="settings">
          <h3>Quick Start</h3>
          
          <div className="hotkey-display">
            <span>Global hotkey:</span>
            <div className="hotkey-combo">⌘⇧V</div>
          </div>
          
          <div className="instructions">
            Press the hotkey anywhere on your system to start recording. The app will automatically transcribe and inject the text.
          </div>
        </div>

        {state.showTranscript && (
          <div className="transcript-display show">
            <div className="transcript-header">
              <h4>Transcript</h4>
              <div className="transcript-actions">
                <button className="transcript-btn" onClick={copyTranscript}>
                  <span className="icon">📋</span>
                  Copy
                </button>
                <button className="transcript-btn" onClick={clearTranscript}>
                  <span className="icon">🗑️</span>
                  Clear
                </button>
              </div>
            </div>
            <div className="transcript-text">{state.currentTranscript}</div>
          </div>
        )}

        {state.transcriptHistory.length > 0 && (
          <div className="history-section">
            <div className="history-header">
              <h4>History ({state.transcriptHistory.length})</h4>
              <button className="clear-history-btn" onClick={clearHistory}>
                Clear All
              </button>
            </div>
            <div className="history-list">
              {state.transcriptHistory.slice(-3).reverse().map((transcript, index) => (
                <div key={index} className="history-item">
                  <div className="history-text">{transcript}</div>
                  <button 
                    className="history-copy-btn"
                    onClick={() => navigator.clipboard.writeText(transcript)}
                  >
                    📋
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
