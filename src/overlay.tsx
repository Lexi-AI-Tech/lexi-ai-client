import React from 'react';
import ReactDOM from 'react-dom/client';
import CorrectionOverlay from './components/CorrectionOverlay';
import './index.css'; // Reuse main styles if possible or create new one

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <CorrectionOverlay />
    </React.StrictMode>
);
