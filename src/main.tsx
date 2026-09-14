import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StoreProvider } from './state';
import { TransferProvider } from './transfers';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <TransferProvider>
        <App />
      </TransferProvider>
    </StoreProvider>
  </StrictMode>,
);
