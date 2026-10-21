import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base keeps local dev/preview and GitHub Pages project URLs working
  // without rebuilding for a specific repository name.
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
