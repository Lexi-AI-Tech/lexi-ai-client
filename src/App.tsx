import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { Pill } from './components/Pill'

interface AppState {
  isRecording: boolean
  status: 'idle' | 'recording' | 'processing'
}

function App() {
  const [state, setState] = useState<AppState>({
    isRecording: false,
    status: 'idle'
  })

  // Initialize and listen for events
  useEffect(() => {
    console.log('Lexi AI Client initialized')

    const setupListeners = async () => {
      const unlistenStarted = await listen('recording_started', () => {
        setState(prev => ({
          ...prev,
          isRecording: true,
          status: 'recording'
        }))
      })

      const unlistenStopped = await listen('recording_stopped', () => {
        setState(prev => ({
          ...prev,
          isRecording: false,
          status: 'processing'
        }))
      })

      const unlistenProcessingStart = await listen('processing_start', () => {
        setState(prev => ({
          ...prev,
          status: 'processing'
        }))
      })

      const unlistenSuccess = await listen('transcription_success', () => {
        setState(prev => ({
          ...prev,
          status: 'idle'
        }))
      })

      const unlistenError = await listen('transcription_error', (event: any) => {
        console.error('Transcription error:', event.payload)
        setState(prev => ({
          ...prev,
          status: 'idle'
        }))
      })

      return () => {
        unlistenStarted()
        unlistenStopped()
        unlistenProcessingStart()
        unlistenSuccess()
        unlistenError()
      }
    }

    setupListeners()
  }, [])

  // Check recording state periodically
  useEffect(() => {
    const checkRecordingState = async () => {
      try {
        const isRecording = await invoke('is_recording')
        if (isRecording !== state.isRecording) {
          setState(prev => ({
            ...prev,
            isRecording: Boolean(isRecording),
            status: Boolean(isRecording) ? 'recording' : prev.status
          }))
        }
      } catch (error) {
        console.error('Failed to check recording state:', error)
      }
    }

    const interval = setInterval(checkRecordingState, 1000)
    return () => clearInterval(interval)
  }, [state.isRecording])

  const toggleRecording = async () => {
    if (state.isRecording) {
      await invoke('stop_recording')
    } else {
      await invoke('start_recording')
    }
  }

  return (
    <Pill
      status={state.status}
      onClick={toggleRecording}
    />
  )
}

export default App
