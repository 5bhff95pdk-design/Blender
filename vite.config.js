import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    hmr: {
      clientPort: 443
    },
    allowedHosts: true,
    headers: {
      'X-Frame-Options': 'ALLOWALL'
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 5173
  }
});
