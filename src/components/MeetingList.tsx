import React from 'react';

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration_seconds: number;
    transcript: string;
    summary: string;
}

interface MeetingListProps {
    meetings: Meeting[];
    onSelectMeeting: (meeting: Meeting) => void;
}

export const MeetingList: React.FC<MeetingListProps> = ({ meetings, onSelectMeeting }) => {
    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString();
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        return `${mins} min`;
    };

    return (
        <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            <h2 className="text-xl font-bold p-4 bg-gray-700 text-white border-b border-gray-600">
                Recent Meetings
            </h2>
            <div className="divide-y divide-gray-700 max-h-[600px] overflow-y-auto">
                {meetings.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">
                        No meetings recorded yet.
                    </div>
                ) : (
                    meetings.map((meeting) => (
                        <div
                            key={meeting.id}
                            onClick={() => onSelectMeeting(meeting)}
                            className="p-4 hover:bg-gray-700 cursor-pointer transition-colors"
                        >
                            <div className="flex justify-between items-start mb-1">
                                <h3 className="font-semibold text-white">{meeting.title}</h3>
                                <span className="text-sm text-gray-400">
                                    {formatDuration(meeting.duration_seconds)}
                                </span>
                            </div>
                            <div className="text-sm text-gray-500">
                                {formatDate(meeting.date)}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
