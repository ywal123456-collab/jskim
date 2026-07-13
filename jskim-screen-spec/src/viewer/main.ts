import { createApp } from 'vue';
import App from './App.vue';
import { createAppRouter } from './router';
import './styles/viewer.css';

async function bootstrap(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const manifestUrl = `${base}data/manifest.json`;
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`manifest の読み込みに失敗しました: ${manifestUrl}`);
  }
  const manifest = await response.json();
  const router = createAppRouter(manifest);
  const app = createApp(App, { manifest });
  app.use(router);
  app.mount('#app');
}

bootstrap().catch((error) => {
  console.error(error);
  const root = document.getElementById('app');
  if (root) {
    root.textContent =
      '画面設計書データの読み込みに失敗しました。build:sample を実行してください。';
  }
});
