import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Viewer build 用（publish 同梱）。
 * vitest 依存を避けるため test 設定は vitest.config.ts に分離する。
 */
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
});
