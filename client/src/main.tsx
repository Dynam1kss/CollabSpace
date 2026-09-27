import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './App.css';
import { App } from './App';
import { applyTheme, usePrefsStore } from './prefs';

// до першого рендера — інакше темна тема блимала б світлою
applyTheme(usePrefsStore.getState().theme);

// у dev воркер лише заважав би: vite віддає модулі окремими запитами й сам
// стежить за їх свіжістю
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
