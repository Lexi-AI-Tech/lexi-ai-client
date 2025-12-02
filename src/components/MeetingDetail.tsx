import React from 'react';

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration_seconds: number;
    transcript: string;
    summary: string;
}

interface MeetingDetailProps {
    meeting: Meeting;
    onBack: () => void;
}

export const MeetingDetail: React.FC<MeetingDetailProps> = ({ meeting, onBack }) => {
    return (
        <div className="bg-gray-800 rounded-lg shadow-lg h-full flex flex-col">
            <div className="p-4 border-b border-gray-700 flex items-center">
                <button
                    onClick={onBack}
                    className="mr-4 text-gray-400 hover:text-white transition-colors"
                >
                    ← Back
                </button>
                <div>
                    <h2 className="text-xl font-bold text-white">{meeting.title}</h2>
                    <p className="text-sm text-gray-400">
                        {new Date(meeting.date).toLocaleString()} • {Math.floor(meeting.duration_seconds / 60)} min
                    </p>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
                <section>
                    <h3 className="text-lg font-semibold text-blue-400 mb-3 uppercase tracking-wider">
                        Summary
                    </h3>
                    <div className="bg-gray-700/50 p-4 rounded-lg text-gray-200 leading-relaxed whitespace-pre-wrap">
                        {meeting.summary}
                    </div>
                </section>

                <section>
                    <h3 className="text-lg font-semibold text-green-400 mb-3 uppercase tracking-wider">
                        Transcript
                    </h3>
                    <div className="bg-gray-700/30 p-4 rounded-lg text-gray-300 leading-relaxed whitespace-pre-wrap font-serif">
                        {meeting.transcript}
                    </div>
                </section>
            </div>
        </div>
    );
};
