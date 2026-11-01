import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev proxy keeps the browser single-origin; the API doubles CORS anyway.
      '/api': 'http://localhost:4000',
    },
  },
});
