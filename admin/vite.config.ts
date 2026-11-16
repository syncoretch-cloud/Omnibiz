import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The admin panel is its own app but talks to the same API, and reuses the web app's building blocks (@web).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@web': path.resolve(import.meta.dirname, '../web/src') } },
  server: {
    port: 5180,
    strictPort: true,
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
  build: { chunkSizeWarningLimit: 900 },
});
