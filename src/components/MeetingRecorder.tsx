import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

interface MeetingRecorderProps {
    onMeetingProcessed: (meeting: any) => void;
}

export const MeetingRecorder: React.FC<MeetingRecorderProps> = ({ onMeetingProcessed }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [duration, setDuration] = useState(0);
    const [status, setStatus] = useState<string>('Ready');

    useEffect(() => {
        let interval: any;
        if (isRecording) {
            interval = setInterval(() => {
                setDuration(d => d + 1);
            }, 1000);
        } else {
            setDuration(0);
        }
        return () => clearInterval(interval);
    }, [isRecording]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const startRecording = async () => {
        try {
            await invoke('start_meeting_recording');
            setIsRecording(true);
            setStatus('Recording...');
        } catch (e) {
            console.error(e);
            setStatus(`Error: ${e}`);
        }
    };

    const stopRecording = async () => {
        try {
            setStatus('Processing... This may take a moment.');
            setIsRecording(false);
            const meeting = await invoke('stop_meeting_recording');
            onMeetingProcessed(meeting);
            setStatus('Ready');
        } catch (e) {
            console.error(e);
            setStatus(`Error: ${e}`);
            setIsRecording(false);
        }
    };

    return (
        <div className="p-6 bg-gray-800 rounded-lg shadow-lg text-center">
            <h2 className="text-2xl font-bold mb-4 text-white">New Meeting</h2>

            <div className="text-6xl font-mono mb-8 text-blue-400">
                {formatTime(duration)}
            </div>

            <div className="mb-6">
                {!isRecording ? (
                    <button
                        onClick={startRecording}
                        className="bg-red-500 hover:bg-red-600 text-white font-bold py-4 px-8 rounded-full text-xl transition-all transform hover:scale-105"
                    >
                        Start Recording
                    </button>
                ) : (
                    <button
                        onClick={stopRecording}
                        className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-4 px-8 rounded-full text-xl transition-all transform hover:scale-105 animate-pulse"
                    >
                        Stop Recording
                    </button>
                )}
            </div>

            <div className="text-gray-400">
                Status: {status}
            </div>
        </div>
    );
};
