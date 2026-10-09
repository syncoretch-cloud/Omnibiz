import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/dm-serif-display';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { App } from './App.tsx';
import { SessionProvider, ToastProvider } from './lib/session.tsx';
import { initTheme } from './lib/theme.ts';

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
