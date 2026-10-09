import { defineConfig } from 'vite';

export default defineConfig({
  root: 'site',
  base: process.env.BASE_PATH ?? '/Tokenscope-App/',
  publicDir: 'public',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2020' },
  server: { port: 5173 },
});
