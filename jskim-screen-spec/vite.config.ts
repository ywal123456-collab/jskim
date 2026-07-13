import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: packageRoot,
  base: '/spec/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.join(packageRoot, 'src'),
    },
  },
  build: {
    outDir: path.join(packageRoot, '../spec/sample/dist'),
    emptyOutDir: true,
  },
  preview: {
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
