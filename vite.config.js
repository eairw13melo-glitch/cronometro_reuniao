import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Vercel usa "/". O workflow do GitHub Pages define
  // VITE_BASE=/cronometro_reuniao/ durante a compilação.
  base: process.env.VITE_BASE || '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        presentation: resolve(import.meta.dirname, 'presentation.html'),
      },
    },
  },
});
