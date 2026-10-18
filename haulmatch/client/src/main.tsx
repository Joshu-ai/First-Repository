import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Leaflet's own CSS first so the overrides in styles.css win.
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
