import {
  createRouter,
  createWebHistory,
  type Router,
  type RouteRecordRaw,
} from 'vue-router';
import ScreenSpecPage from './pages/ScreenSpecPage.vue';
import type { ViewerManifest } from './types';

export function createAppRouter(manifest: ViewerManifest): Router {
  const firstId = manifest.screens[0]?.id;
  const routes: RouteRecordRaw[] = [
    {
      path: '/',
      redirect: firstId ? `/screens/${firstId}` : '/screens/_empty',
    },
    {
      path: '/screens/:screenId',
      name: 'screen',
      component: ScreenSpecPage,
      props: true,
    },
  ];

  return createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
  });
}
