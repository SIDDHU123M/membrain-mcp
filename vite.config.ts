import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/ui',
  base: './', // relative asset URLs — pages work at any mount path (subfolders, Pages hosts)
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/ui/index.html'),
        landing: path.resolve(__dirname, 'src/ui/landing.html'),
      },
    },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:7777', '/mcp': 'http://127.0.0.1:7777' },
  },
});
