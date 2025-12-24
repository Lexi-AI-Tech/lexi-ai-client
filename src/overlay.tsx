import React from 'react';
import ReactDOM from 'react-dom/client';
import CorrectionOverlay from './components/CorrectionOverlay';
import './overlay.css'; // Overlay-specific styles

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <CorrectionOverlay />
    </React.StrictMode>
);
