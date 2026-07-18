import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ScreenSpecPage from '../../src/viewer/pages/ScreenSpecPage.vue';
import DomPreview from '../../src/viewer/components/DomPreview.vue';
import type {
  DeviceCaptureManifestEntry,
  ManifestScreen,
  ScreenData,
  ViewerManifest,
} from '../../src/viewer/types';

function captureEntry(
  status: 'missing' | 'current' | 'stale' | 'invalid',
  viewport: 'pc' | 'sp' = 'pc',
): DeviceCaptureManifestEntry {
  if (status === 'missing' || status === 'invalid') {
    return { status };
  }
  return {
    status,
    imagePath: `device-captures/demo/default/${viewport}/capture-xx.png`,
    inputRevision: 'sha256:' + 'a'.repeat(64),
    imageRevision: 'sha256:' + 'b'.repeat(64),
    capturedAt: '2026-07-18T00:00:00.000Z',
    viewportWidth: viewport === 'pc' ? 1440 : 375,
    viewportHeight: viewport === 'pc' ? 900 : 812,
    imageWidth: viewport === 'pc' ? 1440 : 375,
    imageHeight: 900,
  };
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
          pc: captureEntry('current', 'pc'),
          sp: captureEntry('missing', 'sp'),
        },
      },
      {
        id: 'error',
        name: 'エラー',
        viewer: { visible: true, order: 2 },
        snapshotFile: 'snapshots/demo/error.html',
        deviceCaptures: {
          pc: captureEntry('missing', 'pc'),
          sp: captureEntry('missing', 'sp'),
        },
      },
    ],
    interactions: [],
    status: 'linked',
    hasDescription: true,
    hasImplementation: true,
    hasPreview: true,
  };
}

function designOnly(): ScreenData {
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
  };
}

function implOnly(): ScreenData {
  const s = linkedScreen();
  s.id = 'impl';
  s.name = '実装のみ';
  s.status = 'implementation-only';
  s.hasDescription = false;
  return s;
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
      if (url.includes('/device-captures/status')) {
        return jsonResponse({
          screenId: screen.id,
          stateId: 'default',
          viewport: 'pc',
          runtime: { status: 'idle' },
          capture: { status: 'current' },
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

describe('Device Capture Viewer UI (ScreenSpecPage)', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    delete window.__JSKIM_SPEC_EDIT__;
  });

  it('LINKED / IMPLEMENTATION_ONLY は Live/PC/SP、DESIGN_ONLY はタブなし', async () => {
    const linked = await mountPage({ screen: linkedScreen() });
    expect(linked.findAll('[role="tab"]')).toHaveLength(3);
    expect(linked.findComponent(DomPreview).exists()).toBe(true);
    linked.unmount();

    const impl = await mountPage({ screen: implOnly() });
    expect(impl.findAll('[role="tab"]')).toHaveLength(3);
    impl.unmount();

    const design = await mountPage({ screen: designOnly() });
    expect(design.findAll('[role="tab"]')).toHaveLength(0);
    expect(design.find('[data-testid="no-preview"]').exists()).toBe(true);
    design.unmount();
  });

  it('PC 選択で Capture panel、state 変更でも SP を維持', async () => {
    const wrapper = await mountPage({ screen: linkedScreen(), editable: true });
    await wrapper.find('[data-provider="sp"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="device-capture-panel"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-testid="device-capture-panel"]').attributes(
        'data-viewport',
      ),
    ).toBe('sp');
    expect(sessionStorage.getItem('jskim-spec-preview-provider:sample')).toBe(
      'sp',
    );

    const errorBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('エラー'));
    expect(errorBtn).toBeTruthy();
    await errorBtn!.trigger('click');
    await flushPromises();
    expect(
      wrapper.find('[data-testid="device-capture-panel"]').attributes(
        'data-viewport',
      ),
    ).toBe('sp');
    expect(wrapper.text()).toContain('未収集');
    wrapper.unmount();
  });

  it('read-only でもタブは出し再収集ボタンは出さない', async () => {
    const wrapper = await mountPage({ screen: linkedScreen(), editable: false });
    await wrapper.find('[data-provider="pc"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="device-capture-panel"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-testid="device-capture-collect"]').exists(),
    ).toBe(false);
    const statusCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => String(c[0]).includes('device-captures/status'),
    );
    expect(statusCalls).toHaveLength(0);
    wrapper.unmount();
  });

  it('DESIGN_ONLY 訪問後も preferred SP を保持し実装画面で復元', async () => {
    sessionStorage.setItem('jskim-spec-preview-provider:sample', 'sp');
    const design = await mountPage({ screen: designOnly() });
    expect(sessionStorage.getItem('jskim-spec-preview-provider:sample')).toBe(
      'sp',
    );
    design.unmount();

    const linked = await mountPage({ screen: linkedScreen() });
    await flushPromises();
    expect(
      linked.find('[data-provider="sp"]').attributes('aria-selected'),
    ).toBe('true');
    expect(linked.find('[data-testid="device-capture-panel"]').exists()).toBe(
      true,
    );
    linked.unmount();
  });
});
