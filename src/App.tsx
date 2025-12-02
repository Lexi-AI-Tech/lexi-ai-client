import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { MeetingRecorder } from './components/MeetingRecorder'
import { MeetingList } from './components/MeetingList'
import { MeetingDetail } from './components/MeetingDetail'

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

interface Meeting {
  id: string;
  title: string;
  date: string;
  duration_seconds: number;
  transcript: string;
  summary: string;
}

function App() {
  const [activeTab, setActiveTab] = useState<'dictation' | 'meetings'>('dictation')
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null)

  // Existing Dictation State
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

  // Load meetings on mount
  useEffect(() => {
    loadMeetings()
  }, [])

  const loadMeetings = async () => {
    try {
      const loadedMeetings = await invoke<Meeting[]>('get_all_meetings')
      setMeetings(loadedMeetings.reverse()) // Show newest first
    } catch (e) {
      console.error('Failed to load meetings:', e)
    }
  }

  // Initialize and listen for events (Dictation)
  useEffect(() => {
    console.log('Lexi AI Client initialized')

    const setupListeners = async () => {
      const unlistenStarted = await listen('recording_started', () => {
        setState(prev => ({
          ...prev,
          isRecording: true,
          showTranscript: false,
          recordingDuration: 0,
          status: 'Recording...',
          statusType: 'recording'
        }))
      })

      const unlistenStopped = await listen('recording_stopped', () => {
        setState(prev => ({
          ...prev,
          isRecording: false,
          isProcessing: true,
          status: 'Processing...',
          statusType: 'processing'
        }))
      })

      const unlistenProcessingStart = await listen('processing_start', () => {
        setState(prev => ({
          ...prev,
          isProcessing: true,
          status: 'Transcribing...',
          statusType: 'processing'
        }))
      })

      const unlistenSuccess = await listen('transcription_success', (event: any) => {
        const text = event.payload as string
        setState(prev => ({
          ...prev,
          isProcessing: false,
          status: 'Ready',
          statusType: 'success',
          currentTranscript: text,
          showTranscript: true,
          transcriptHistory: [...prev.transcriptHistory, text]
        }))

        setTimeout(() => {
          setState(prev => ({ ...prev, status: 'Ready', statusType: '' }))
        }, 3000)
      })

      const unlistenError = await listen('transcription_error', (event: any) => {
        console.error('Transcription error:', event.payload)
        setState(prev => ({
          ...prev,
          isProcessing: false,
          status: 'Error',
          statusType: 'error'
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

  // Recording duration timer (Dictation)
  useEffect(() => {
    let interval: any
    if (state.isRecording) {
      interval = setInterval(() => {
        setState(prev => ({ ...prev, recordingDuration: prev.recordingDuration + 1 }))
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [state.isRecording])

  // Dictation Functions
  const updateStatus = (text: string, type: string = '') => {
    setState(prev => ({ ...prev, status: text, statusType: type }))
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

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

  const stopRecording = async () => {
    if (!state.isRecording) return
    try {
      await invoke('stop_recording')
    } catch (error) {
      console.error('Failed to stop recording:', error)
    }
  }

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

  const clearTranscript = () => {
    setState(prev => ({
      ...prev,
      currentTranscript: '',
      showTranscript: false
    }))
  }

  const clearHistory = () => {
    setState(prev => ({
      ...prev,
      transcriptHistory: [],
      currentTranscript: '',
      showTranscript: false
    }))
  }

  // Meeting Functions
  const handleMeetingProcessed = (meeting: Meeting) => {
    setMeetings(prev => [meeting, ...prev])
    setSelectedMeeting(meeting)
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans">
      {/* Navigation */}
      <nav className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">🎤</span>
            <h1 className="text-xl font-bold">Lexi AI</h1>
          </div>
          <div className="flex space-x-4">
            <button
              onClick={() => setActiveTab('dictation')}
              className={`px-4 py-2 rounded-lg transition-colors ${activeTab === 'dictation' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
            >
              Dictation
            </button>
            <button
              onClick={() => setActiveTab('meetings')}
              className={`px-4 py-2 rounded-lg transition-colors ${activeTab === 'meetings' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
            >
              Meetings
            </button>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="container mx-auto p-4">
        {activeTab === 'dictation' ? (
          // Existing Dictation UI (Styled with Tailwind)
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-gray-800 rounded-lg p-6 text-center shadow-lg">
              <div className={`text-lg font-semibold mb-2 ${state.statusType === 'recording' ? 'text-red-400 animate-pulse' :
                  state.statusType === 'processing' ? 'text-yellow-400' :
                    state.statusType === 'success' ? 'text-green-400' : 'text-gray-400'
                }`}>
                {state.status}
                {state.isRecording && <span className="ml-2">({formatDuration(state.recordingDuration)})</span>}
              </div>

              <div className="flex justify-center space-x-4 mb-6">
                {!state.isRecording ? (
                  <button
                    onClick={startRecording}
                    disabled={state.isProcessing}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-full transition-all transform hover:scale-105"
                  >
                    Start Dictation
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-full transition-all transform hover:scale-105 animate-pulse"
                  >
                    Stop Dictation
                  </button>
                )}
              </div>

              <div className="text-sm text-gray-500">
                Global Hotkey: <span className="font-mono bg-gray-700 px-2 py-1 rounded">Option (Left/Right)</span>
              </div>
            </div>

            {state.showTranscript && (
              <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">Transcript</h3>
                  <div className="space-x-2">
                    <button onClick={copyTranscript} className="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors">Copy</button>
                    <button onClick={clearTranscript} className="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors">Clear</button>
                  </div>
                </div>
                <div className="bg-gray-900 p-4 rounded text-gray-300 min-h-[100px] whitespace-pre-wrap">
                  {state.currentTranscript}
                </div>
              </div>
            )}

            {state.transcriptHistory.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">History</h3>
                  <button onClick={clearHistory} className="text-sm text-red-400 hover:text-red-300">Clear All</button>
                </div>
                <div className="space-y-3">
                  {state.transcriptHistory.slice(-3).reverse().map((text, i) => (
                    <div key={i} className="bg-gray-900 p-3 rounded text-sm text-gray-400 flex justify-between items-start group">
                      <div className="line-clamp-2">{text}</div>
                      <button
                        onClick={() => navigator.clipboard.writeText(text)}
                        className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        📋
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          // Meetings UI
          <div className="h-[calc(100vh-100px)] flex gap-6">
            {selectedMeeting ? (
              <div className="w-full">
                <MeetingDetail
                  meeting={selectedMeeting}
                  onBack={() => setSelectedMeeting(null)}
                />
              </div>
            ) : (
              <>
                <div className="w-1/3">
                  <MeetingList
                    meetings={meetings}
                    onSelectMeeting={setSelectedMeeting}
                  />
                </div>
                <div className="w-2/3 flex items-center justify-center">
                  <MeetingRecorder onMeetingProcessed={handleMeetingProcessed} />
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

export default App
