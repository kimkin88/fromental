import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const fileEnv = loadEnv(mode, '.', '');
    // Prefer .env files locally; fall back to process.env (Vercel build-time env).
    const geminiKey = fileEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
    const appPassword = fileEnv.APP_PASSWORD || process.env.APP_PASSWORD || '';
    // Never define VWX_SECRET / VWX_KEY_ID / VWX_APP_HOST here — they stay server-only.
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(geminiKey),
        'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey),
        // Standalone unlock password (client compare). Not a VWX secret.
        'process.env.APP_PASSWORD': JSON.stringify(appPassword),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});

