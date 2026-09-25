import React from 'react';
import ReactDOM from 'react-dom/client';

import { Providers } from '@/app/providers';
import { Root } from '@/app/Root';
import { applyLanguage, applyTheme, readStoredLanguage, readStoredTheme } from '@/app/theme';
import { resolveLanguage } from '@/i18n/index';
import '@/styles/global.css';

// The theme and the language this machine last showed, applied before React renders anything.
//
// The record of truth is the settings table, and the window waits for it — but that wait is a
// host round trip. So the browser store keeps a copy of each choice purely as the guess this frame
// is painted with; the table answers a moment later and wins (see `app/theme.ts`).
applyTheme(readStoredTheme());
applyLanguage(readStoredLanguage() ?? resolveLanguage('system', navigator.language));

const root = document.getElementById('root');
if (!root) throw new Error('the application root element is missing from index.html');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Providers>
      <Root />
    </Providers>
  </React.StrictMode>,
);
