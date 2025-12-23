import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core'; // Tauri v2
import { listen } from '@tauri-apps/api/event';

interface GrammarSuggestion {
    start: number;
    end: number;
    original: string;
    replacement: string;
    explanation: string;
}

interface GrammarCheckResult {
    suggestions: GrammarSuggestion[];
}

interface TextChangePayload {
    text: string;
    cursor_pos: number;
}

const CorrectionOverlay = () => {
    const [suggestions, setSuggestions] = useState<GrammarSuggestion[]>([]);
    const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // Listen to text-change events from the text monitor
        let unlisten: () => void;

        const setupListener = async () => {
            unlisten = await listen<TextChangePayload>('text-change', async (event) => {
                const { text, cursor_pos } = event.payload;

                // Debounce grammar checks to avoid excessive API calls
                // Clear previous timer
                if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                }

                // Only check grammar if text is not empty and has reasonable length
                if (!text || text.trim().length === 0 || text.length < 3) {
                    setSuggestions([]);
                    return;
                }

                // Debounce: wait 500ms after user stops typing before checking grammar
                debounceTimerRef.current = setTimeout(async () => {
                    try {
                        console.log('🔍 Checking grammar for text (length:', text.length, ', cursor_pos:', cursor_pos, ')');
                        
                        const result = await invoke<GrammarCheckResult>('check_grammar', { 
                            text, 
                            cursor_pos: cursor_pos 
                        });

                        console.log('📝 Grammar check result:', result);

                        if (result.suggestions && result.suggestions.length > 0) {
                            setSuggestions(result.suggestions);
                            // Show overlay window
                            try {
                                await invoke('show_overlay_window');
                            } catch (e) {
                                console.warn('Failed to show overlay window:', e);
                            }
                        } else {
                            setSuggestions([]);
                            try {
                                await invoke('hide_overlay_window');
                            } catch (e) {
                                console.warn('Failed to hide overlay window:', e);
                            }
                        }
                    } catch (e) {
                        console.error('Failed to check grammar:', e);
                        setSuggestions([]);
                    }
                }, 500); // 500ms debounce
            });
        };

        setupListener();

        return () => {
            if (unlisten) unlisten();
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, []);

    const handleApply = async (suggestion: GrammarSuggestion) => {
        try {
            await invoke('replace_text', {
                start: suggestion.start,
                end: suggestion.end,
                newText: suggestion.replacement
            });
            setSuggestions([]);
            await invoke('hide_overlay_window');
        } catch (e) {
            console.error(e);
        }
    };

    if (suggestions.length === 0) return null;

    const topSugg = suggestions[0]; // Just show top one

    return (
        <div className="flex bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-2 text-sm max-w-xs animate-in fade-in zoom-in duration-200">
            <div className="flex-1 mr-2">
                <div className="flex items-center space-x-1">
                    <span className="line-through text-gray-400">{topSugg.original}</span>
                    <span className="text-gray-400">→</span>
                    <span className="font-bold text-green-600 dark:text-green-400">{topSugg.replacement}</span>
                </div>
                {topSugg.explanation && (
                    <div className="text-xs text-gray-500 mt-1">{topSugg.explanation}</div>
                )}
            </div>
            <button
                onClick={() => handleApply(topSugg)}
                className="bg-green-500 hover:bg-green-600 text-white rounded px-2 py-1 font-medium transition-colors"
            >
                Fix
            </button>
        </div>
    );
};

export default CorrectionOverlay;
