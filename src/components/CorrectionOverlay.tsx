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
        console.log('🎬 Root element:', document.getElementById('root'));
        console.log('🎬 Body background:', window.getComputedStyle(document.body).backgroundColor);
        // Listen to grammar-suggestions events from the text monitor
        // The Rust backend handles window positioning and visibility
        let unlisten: () => void;

        const setupListener = async () => {
            console.log('🎧 CorrectionOverlay: Setting up grammar-suggestions listener...');
            unlisten = await listen<GrammarSuggestionsPayload>('grammar-suggestions', (event) => {
                console.log('📨 CorrectionOverlay: Received grammar-suggestions event:', event.payload);
                const { suggestions } = event.payload;

                if (suggestions && suggestions.length > 0) {
                    console.log('✅ Got {} grammar suggestions', suggestions.length);
                    setSuggestions(suggestions);
                    // Window positioning and visibility is handled by Rust backend
                } else {
                    console.log('✓ No grammar suggestions');
                    setSuggestions([]);
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

    // Always show something - placeholder when no suggestions
    if (suggestions.length === 0) {
        return (
            <div 
                style={{
                    backgroundColor: '#FFEB3B',
                    borderRadius: '12px',
                    padding: '16px',
                    border: '2px solid #FBC02D',
                    maxWidth: '320px',
                    minWidth: '280px',
                    width: '100%',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '120px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                }}
            >
                <div style={{ 
                    color: '#1a1a1a', 
                    fontSize: '14px',
                    fontWeight: '500',
                    textAlign: 'center'
                }}>
                    Waiting for grammar suggestions...
                </div>
            </div>
        );
    }

    const topSugg = suggestions[0]; // Just show top one

    return (
        <div 
            style={{
                backgroundColor: '#FFEB3B', // Bright yellow background
                borderRadius: '12px',
                padding: '16px',
                border: '2px solid #FBC02D',
                maxWidth: '320px',
                minWidth: '280px',
                width: '100%',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                minHeight: '120px'
            }}
        >
            <div style={{ marginBottom: '12px' }}>
                {/* Show the corrected text prominently */}
                <div style={{ 
                    fontSize: '18px', 
                    fontWeight: 'bold', 
                    color: '#1a1a1a',
                    marginBottom: '8px',
                    lineHeight: '1.4'
                }}>
                    {topSugg.replacement}
                </div>
                
                {/* Show original text with strikethrough */}
                {topSugg.original !== topSugg.replacement && (
                    <div style={{ 
                        fontSize: '14px', 
                        color: '#666',
                        textDecoration: 'line-through',
                        marginBottom: '4px'
                    }}>
                        {topSugg.original}
                    </div>
                )}
                
                {/* Show explanation if available */}
                {topSugg.explanation && (
                    <div style={{ 
                        fontSize: '12px', 
                        color: '#555',
                        marginTop: '8px',
                        fontStyle: 'italic'
                    }}>
                        {topSugg.explanation}
                    </div>
                )}
            </div>
            
            <button
                onClick={() => handleApply(topSugg)}
                style={{
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    width: '100%',
                    transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#45a049'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#4CAF50'}
            >
                Apply Correction
            </button>
        </div>
    );
};

export default CorrectionOverlay;
