import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { folioExportRuntime } from './src/exports/vite-plugin.mjs';

export default defineConfig({
  plugins: [react(), folioExportRuntime()],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: { include: ['src/**/*.test.ts', 'desktop/**/*.test.mjs'] },
});
