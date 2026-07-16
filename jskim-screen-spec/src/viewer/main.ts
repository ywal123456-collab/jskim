import { createApp } from 'vue';
import App from './App.vue';
import { createAppRouter } from './router';
import { clearPendingScreen, peekPendingScreen } from './editing/pending-screen';
import type { ViewerManifest } from './types';
import './styles/viewer.css';

/**
 * 画面作成直後の pending screenId が今回の manifest に反映されていれば、
 * mount 後にその画面へ遷移する。反映されていなければ pending は残し、
 * 次の reload（live reload 等）でこの処理を再試行する。
 */
function navigateToPendingScreenIfReady(
  router: ReturnType<typeof createAppRouter>,
  manifest: ViewerManifest,
): void {
  const pending = peekPendingScreen();
  if (!pending) {
    return;
  }
  if (!manifest.screens.some((s) => s.id === pending)) {
    return;
  }
  clearPendingScreen();
  void router.replace(`/screens/${pending}`);
}

async function bootstrap(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const manifestUrl = `${base}data/manifest.json`;
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`manifest の読み込みに失敗しました: ${manifestUrl}`);
  }
  const manifest = (await response.json()) as ViewerManifest;
  const router = createAppRouter(manifest);
  const app = createApp(App, { manifest });
  app.use(router);
  await router.isReady();
  app.mount('#app');
  navigateToPendingScreenIfReady(router, manifest);
}

bootstrap().catch((error) => {
  console.error(error);
  const root = document.getElementById('app');
  if (root) {
    root.textContent =
      '画面設計書データの読み込みに失敗しました。build:sample を実行してください。';
  }
});
