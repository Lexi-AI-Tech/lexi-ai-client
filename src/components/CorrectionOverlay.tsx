import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core'; // Tauri v2
import { listen } from '@tauri-apps/api/event';

interface GrammarSuggestion {
    start: number;
    end: number;
    original: string;
    replacement: string;
    explanation: string;
}

interface GrammarSuggestionsPayload {
    suggestions: GrammarSuggestion[];
    x?: number;
    y?: number;
}

const CorrectionOverlay = () => {
    const [suggestions, setSuggestions] = useState<GrammarSuggestion[]>([]);

    useEffect(() => {
        console.log('🎬 CorrectionOverlay: Component mounted, setting up listener...');
        // Listen to grammar-suggestions events from the text monitor (grammar check happens automatically in Rust)
        let unlisten: () => void;

        const setupListener = async () => {
            console.log('🎧 CorrectionOverlay: Setting up grammar-suggestions listener...');
            unlisten = await listen<GrammarSuggestionsPayload>('grammar-suggestions', async (event) => {
                console.log('📨 CorrectionOverlay: Received grammar-suggestions event:', event.payload);
                const { suggestions, x, y } = event.payload;

                if (suggestions && suggestions.length > 0) {
                    console.log('✅ Got {} grammar suggestions at position ({}, {})', suggestions.length, x, y);
                    setSuggestions(suggestions);
                    // Show overlay window at the provided position (or default)
                    try {
                        const posX = x ?? 100.0;
                        const posY = y ?? 100.0;
                        await invoke('show_overlay_window', { x: posX, y: posY });
                        console.log('✅ Overlay window shown at position ({}, {})', posX, posY);
                    } catch (e) {
                        console.warn('Failed to show overlay window:', e);
                    }
                } else {
                    console.log('✓ No grammar suggestions');
                    setSuggestions([]);
                    try {
                        await invoke('hide_overlay_window');
                    } catch (e) {
                        console.warn('Failed to hide overlay window:', e);
                    }
                }
            });
        };

        setupListener();

        return () => {
            if (unlisten) unlisten();
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
