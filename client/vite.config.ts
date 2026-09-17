import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // тільки для розробки — щоб відкривати з телефону через тунель
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
      // збіг за префіксом — покриває і /ws/boards/:id
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
