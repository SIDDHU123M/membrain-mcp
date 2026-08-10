import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/ui',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/ui', emptyOutDir: true },
  server: {
    proxy: { '/api': 'http://127.0.0.1:7777', '/mcp': 'http://127.0.0.1:7777' },
  },
});
