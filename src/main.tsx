import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StoreProvider } from './state';
import { TransferProvider } from './transfers';
import '@xterm/xterm/css/xterm.css';
import './i18n';
import './styles.css';
import './workbench.css';
import './window-layout.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div role="status" className="empty">Loading…</div>}>
    <StoreProvider>
      <TransferProvider>
        <App />
      </TransferProvider>
    </StoreProvider>
    </Suspense>
  </StrictMode>,
);
