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

interface GrammarCheckResult {
    suggestions: GrammarSuggestion[];
}

interface TextChangePayload {
    text: string;
    cursor_pos: number;
}

const CorrectionOverlay = () => {
    const [suggestions, setSuggestions] = useState<GrammarSuggestion[]>([]);

    useEffect(() => {
        // Listen to text-change events
        // Note: The global listener is in the Main process or Main Window usually.
        // But if we emit "text-change" globally to all windows, we can catch it here.
        // However, this window might be hidden. 
        // Better architecture: Main window listens, then tells Overlay to update and show.
        // But let's try direct listening first if the window exists (it's just hidden).

        let unlisten: () => void;

        const setupListener = async () => {
            unlisten = await listen<TextChangePayload>('text-change', async (event) => {
                const { text, cursor_pos } = event.payload;

                // Call grammar check
                try {
                    const resultStr = await invoke<string>('check_grammar', { text, cursorPos: cursor_pos });

                    // Let's check invoke signature. Rust: check_grammar(text: String, cursor_pos: usize).
                    // Tauri invoke expects { text: ..., cursorPos: ... } or snake_case depending on config. Default is camelCase in JS map to snake_case in Rust.

                    const result = JSON.parse(resultStr) as GrammarCheckResult;

                    if (result.suggestions.length > 0) {
                        setSuggestions(result.suggestions);
                        // Show window
                        // Calculate position based on cursor? 
                        // We need screen coordinates of cursor. 
                        // Rust TextMonitor doesn't give screen coords yet, only text offset.
                        // But we can approximate or ask Rust to give us cursor coords.
                        // Wait, `check_grammar` returns suggestions.
                        // We need to position the window.
                        // Maybe `TextMonitor` should also emit cursor screen position?
                        // AXSelectedTextRange doesn't give screen coords.
                        // We need `AXBounds` of the selected text range or focused element bounds + offset.

                        // For MVP, let's put it at fixed location or top-right of focused element?
                        // Or use mouse cursor position if typing usually happens near mouse? Not always.
                        // Let's ask Rust to get mouse position as fallback.

                        // Calling `show_overlay_window` from here (Overlay Window itself) might be weird if it's hidden and event loop is paused? 
                        // No, hidden windows still run JS in Tauri usually if not suspended.

                        // But we need screen coordinates. 

                        // IMPLEMENTATION DETAIL:
                        // We will assume for now we just show it. 
                        // Real implementations need `AXBounds`.

                        // Let's invoke `show_overlay_window` with dummy coords for now or ask backend.
                        // I'll add a helper in backend to get cursor position or mouse position.
                    } else {
                        setSuggestions([]);
                        await invoke('hide_overlay_window');
                    }
                } catch (e) {
                    console.error(e);
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
