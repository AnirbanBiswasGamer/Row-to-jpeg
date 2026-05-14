import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 48210,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:48211',
        changeOrigin: true,
        timeout: 0, // Disable timeout for large uploads
        proxyTimeout: 0
      }
    }
  }
});
