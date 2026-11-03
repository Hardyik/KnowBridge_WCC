import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Keep the browser on one origin in development; the API also allows CORS.
      '/api': 'http://localhost:4000',
    },
  },
});
