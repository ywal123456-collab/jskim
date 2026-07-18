import { createApp } from 'vue';
import App from './App.vue';
import { createAppRouter } from './router';
import {
  clearPendingDeleteFallback,
  clearPendingScreen,
  peekPendingDeleteFallback,
  peekPendingScreen,
} from './editing/pending-screen';
import { resolveFallbackAgainstCurrentScreens } from './editing/resolve-delete-screen-fallback';
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

/**
 * DESIGN_ONLY 削除後: 削除対象が manifest から消えていれば fallback へ遷移する。
 * live reload で full remount された場合の再開用。
 */
function navigateAfterPendingDeleteIfReady(
  router: ReturnType<typeof createAppRouter>,
  manifest: ViewerManifest,
): void {
  const pending = peekPendingDeleteFallback();
  if (!pending) {
    return;
  }
  if (manifest.screens.some((s) => s.id === pending.removedScreenId)) {
    return;
  }
  if (peekPendingScreen() === pending.removedScreenId) {
    clearPendingScreen();
  }
  const remaining = manifest.screens.map((s) => s.id);
  const preferred =
    pending.fallbackScreenId === '_empty'
      ? ({ kind: 'empty' } as const)
      : ({ kind: 'screen', screenId: pending.fallbackScreenId } as const);
  const resolved = resolveFallbackAgainstCurrentScreens(remaining, preferred);
  clearPendingDeleteFallback();
  if (resolved.kind === 'empty') {
    void router.replace('/screens/_empty');
  } else {
    void router.replace(`/screens/${resolved.screenId}`);
  }
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
  navigateAfterPendingDeleteIfReady(router, manifest);
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
