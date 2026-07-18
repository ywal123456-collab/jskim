import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import StateSelector from '../../src/viewer/components/StateSelector.vue';
import type {
  ManifestScreen,
  ReferenceImageManifestEntry,
  ScreenData,
  ViewerManifest,
} from '../../src/viewer/types';

function refCurrent(viewport: 'pc' | 'sp' = 'pc'): ReferenceImageManifestEntry {
  return {
    status: 'current',
    imagePath: `reference-images/demo/${viewport}/image-aa.png`,
    imageRevision: 'sha256:' + 'a'.repeat(64),
    imageWidth: viewport === 'pc' ? 1440 : 375,
    imageHeight: viewport === 'pc' ? 900 : 812,
    viewportWidth: viewport === 'pc' ? 1440 : 375,
    viewportHeight: viewport === 'pc' ? 900 : 812,
    uploadedAt: '2026-07-18T00:00:00.000Z',
  };
}

function refMissing(): ReferenceImageManifestEntry {
  return { status: 'missing' };
}

function linkedScreen(): ScreenData {
  return {
    id: 'demo',
    name: 'デモ画面',
    description: '',
    path: '/index.html',
    itemOrder: ['title'],
    items: {
      title: { name: 'タイトル', type: 'text', description: '', note: '' },
    },
    states: [
      {
        id: 'default',
        name: '初期',
        viewer: { visible: true, order: 1 },
        snapshotFile: 'snapshots/demo/default.html',
        deviceCaptures: {
          pc: { status: 'missing' },
          sp: { status: 'missing' },
        },
      },
    ],
    interactions: [],
    status: 'linked',
    hasDescription: true,
    hasImplementation: true,
    hasPreview: true,
    referenceImages: { pc: refMissing(), sp: refMissing() },
  };
}

function designOnlyScreen(options: {
  referenceImages?: { pc: ReferenceImageManifestEntry; sp: ReferenceImageManifestEntry };
} = {}): ScreenData {
  return {
    id: 'design',
    name: '設計のみ',
    description: '',
    path: '',
    itemOrder: [],
    items: {},
    states: [],
    interactions: [],
    status: 'design-only',
    hasDescription: true,
    hasImplementation: false,
    hasPreview: false,
    referenceImages: options.referenceImages,
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function mountPage(options: {
  screen: ScreenData;
  projectName?: string;
  editable?: boolean;
}) {
  const screen = options.screen;
  const manifestScreen: ManifestScreen = {
    id: screen.id,
    name: screen.name,
    path: screen.path,
    dataFile: `screens/${screen.id}.json`,
    status: screen.status,
    hasDescription: screen.hasDescription,
    hasImplementation: screen.hasImplementation,
    hasPreview: screen.hasPreview,
  };
  const manifest: ViewerManifest = {
    schemaVersion: '1.0',
    projectName: options.projectName || 'sample',
    base: '/spec/',
    screens: [manifestScreen],
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/data/screens/${screen.id}.json`)) {
        return jsonResponse(screen);
      }
      if (url.includes('/theme/preview.css')) {
        return new Response('', { status: 200 });
      }
      if (url.includes('/snapshots/')) {
        return new Response('<div data-jskim-spec-item="title">t</div>', {
          status: 200,
        });
      }
      if (url.includes('/reference-images/status')) {
        return jsonResponse({
          screenId: screen.id,
          viewport: 'pc',
          runtime: { status: 'idle' },
          referenceImage: { status: 'missing' },
        });
      }
      return new Response('not found', { status: 404 });
    }),
  );

  if (options.editable) {
    window.__JSKIM_SPEC_EDIT__ = {
      enabled: true,
      apiBase: '/_jskim/spec/descriptions',
    };
  } else {
    delete window.__JSKIM_SPEC_EDIT__;
  }

  const router = createRouter({
    history: createMemoryHistory('/spec/'),
    routes: [
      {
        path: '/screens/:screenId',
        component: ScreenSpecPage,
        props: true,
      },
    ],
  });
  await router.push(`/screens/${screen.id}`);
  await router.isReady();

  const wrapper = mount(ScreenSpecPage, {
    props: { screenId: screen.id },
    global: {
      plugins: [router],
      provide: {
        manifest: computed(() => manifest),
        editingEnabled: Boolean(options.editable),
        openCreateScreen: () => {},
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('Reference Image Viewer UI (ScreenSpecPage)', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    delete window.__JSKIM_SPEC_EDIT__;
  });

  it('LINKED では Live/PC/SP/参照 の 4 タブを表示する', async () => {
    const wrapper = await mountPage({ screen: linkedScreen() });
    const tabs = wrapper.findAll('[data-testid="preview-provider-tabs"] [role="tab"]');
    expect(tabs).toHaveLength(4);
    expect(wrapper.find('[data-provider="reference"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('DESIGN_ONLY editable では参照タブのみを表示する', async () => {
    const wrapper = await mountPage({
      screen: designOnlyScreen(),
      editable: true,
    });
    const tabs = wrapper.findAll('[data-testid="preview-provider-tabs"] [role="tab"]');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].attributes('data-provider')).toBe('reference');
    expect(tabs[0].text()).toBe('参照');
    expect(wrapper.find('[data-testid="reference-image-panel"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  it('DESIGN_ONLY read-only で参照画像が missing なら No Preview を表示する', async () => {
    const wrapper = await mountPage({
      screen: designOnlyScreen({
        referenceImages: { pc: refMissing(), sp: refMissing() },
      }),
      editable: false,
    });
    expect(
      wrapper.findAll('[data-testid="preview-provider-tabs"] [role="tab"]'),
    ).toHaveLength(0);
    expect(wrapper.find('[data-testid="no-preview"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="reference-image-panel"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });

  it('DESIGN_ONLY read-only で参照画像 current があれば参照タブを表示する', async () => {
    const wrapper = await mountPage({
      screen: designOnlyScreen({
        referenceImages: { pc: refCurrent('pc'), sp: refMissing() },
      }),
      editable: false,
    });
    const tabs = wrapper.findAll('[data-testid="preview-provider-tabs"] [role="tab"]');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].attributes('data-provider')).toBe('reference');
    expect(wrapper.find('[data-testid="reference-image-panel"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="no-preview"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('参照タブ選択中は StateSelector を表示しない', async () => {
    const wrapper = await mountPage({ screen: linkedScreen() });
    expect(wrapper.findComponent(StateSelector).exists()).toBe(true);

    await wrapper
      .find('[data-testid="preview-provider-tabs"] [data-provider="reference"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(StateSelector).exists()).toBe(false);
    expect(wrapper.find('[data-testid="reference-image-panel"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  it('参照タブ選択は preferred provider として sessionStorage に保存される', async () => {
    const wrapper = await mountPage({ screen: linkedScreen() });
    await wrapper
      .find('[data-testid="preview-provider-tabs"] [data-provider="reference"]')
      .trigger('click');
    await flushPromises();
    expect(sessionStorage.getItem('jskim-spec-preview-provider:sample')).toBe(
      'reference',
    );
    wrapper.unmount();
  });

  it('参照タブ内で SP を選択すると reference-viewport sessionStorage に保存される', async () => {
    const wrapper = await mountPage({ screen: linkedScreen(), editable: true });
    await wrapper
      .find('[data-testid="preview-provider-tabs"] [data-provider="reference"]')
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.find('[data-testid="reference-image-panel"]').attributes(
        'data-viewport',
      ),
    ).toBe('pc');

    await wrapper
      .find('[data-testid="reference-viewport-tabs"] [data-viewport="sp"]')
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.find('[data-testid="reference-image-panel"]').attributes(
        'data-viewport',
      ),
    ).toBe('sp');
    expect(
      sessionStorage.getItem('jskim-spec-reference-viewport:sample'),
    ).toBe('sp');
    wrapper.unmount();
  });
});
