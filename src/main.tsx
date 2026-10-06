import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StoreProvider } from './state';
import { TransferProvider } from './transfers';
import '@xterm/xterm/css/xterm.css';
import { ready } from './i18n';
import './styles.css';
import './workbench.css';
import './window-layout.css';

void ready.then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div role="status" className="empty">Loading…</div>}>
    <StoreProvider>
      <TransferProvider>
        <App />
      </TransferProvider>
    </StoreProvider>
    </Suspense>
  </StrictMode>,
)).catch((error) => {
  console.error('Application initialization failed', error);
  document.getElementById('root')!.textContent = 'Unable to load the application. Please restart.';
});
