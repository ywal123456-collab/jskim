import { describe, expect, it, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import RevisionHistoryDialog from '../../src/viewer/components/RevisionHistoryDialog.vue';
import { formatVersionHistoryError } from '../../src/viewer/version-history/format-version-error';
import type {
  BrowserRevisionDetail,
  BrowserRevisionListItem,
  BrowserVersionStatus,
} from '../../src/viewer/version-history/types';

afterEach(() => {
  delete window.__JSKIM_SPEC_VERSION__;
});

function baseStatus(
  overrides: Partial<Extract<BrowserVersionStatus, { initialized: true }>> = {},
): BrowserVersionStatus {
  return {
    initialized: true,
    capability: 'local-read-only',
    head: {
      mode: 'symbolic',
      branch: 'main',
      commit: 'a'.repeat(64),
      shortHash: 'aaaaaaa',
      unborn: false,
    },
    workingTree: { clean: true, stagedCount: 0, unstagedCount: 0 },
    recovery: { required: false },
    ...overrides,
  };
}

function revision(
  overrides: Partial<BrowserRevisionListItem> = {},
): BrowserRevisionListItem {
  return {
    hash: 'b'.repeat(64),
    shortHash: 'bbbbbbb',
    parents: [],
    parentCount: 0,
    message: '初回登録',
    author: { name: '山田 太郎' },
    committedAt: '2026-07-12T00:00:00.000Z',
    tags: ['v1'],
    summary: {
      changedFeatureCount: 1,
      changedScreenCount: 1,
      changedItemCount: 0,
      changedReferenceCount: 0,
      changedCaptureCount: 0,
    },
    ...overrides,
  };
}

function detail(
  overrides: Partial<BrowserRevisionDetail> = {},
): BrowserRevisionDetail {
  return {
    ...revision(),
    isMerge: false,
    parentCount: 0,
    featureChanges: [],
    screenChanges: [
      { screenId: 'alpha', kind: 'modified', sections: ['description'] },
    ],
    itemChanges: [
      {
        itemId: 'email',
        kind: 'modified',
        changedFields: ['name'],
        label: 'メール',
      },
    ],
    assetChanges: [],
    truncated: false,
    ...overrides,
  };
}

describe('RevisionHistoryDialog', () => {
  it('open 時に閉じるボタンへ focus し Escape で close する', async () => {
    const wrapper = mount(RevisionHistoryDialog, {
      props: {
        status: baseStatus(),
        scope: 'screen',
        featureId: 'inquiry',
        featureName: '問い合わせ',
        projectName: 'demo',
        screenId: 'alpha',
        revisions: [revision()],
        selectedHash: revision().hash,
        detail: detail(),
        loading: false,
        loadingMore: false,
        loadingDetail: false,
        hasMore: false,
        errorMessage: '',
      },
      attachTo: document.body,
    });
    await nextTick();
    await flushPromises();
    const closeBtn = wrapper.get('[data-testid="revision-history-close"]')
      .element as HTMLButtonElement;
    expect(document.activeElement).toBe(closeBtn);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.emitted('close')?.length).toBe(1);
    wrapper.unmount();
  });

  it('未初期化案内と Feature tab disabled、secret 非表示', async () => {
    const wrapper = mount(RevisionHistoryDialog, {
      props: {
        status: { initialized: false, capability: 'local-read-only' },
        scope: 'screen',
        featureId: null,
        featureName: null,
        projectName: 'demo',
        screenId: 'alpha',
        revisions: [],
        selectedHash: null,
        detail: null,
        loading: false,
        loadingMore: false,
        loadingDetail: false,
        hasMore: false,
        errorMessage: '',
      },
      attachTo: document.body,
    });
    expect(wrapper.get('[data-testid="revision-history-uninitialized"]').text()).toContain(
      '初期化されていません',
    );
    expect(wrapper.text()).not.toContain('secret-author@example.com');
    expect(wrapper.text()).not.toContain('fileKey');
    expect(wrapper.text()).not.toContain('nodeId');
    wrapper.unmount();

    const withFeature = mount(RevisionHistoryDialog, {
      props: {
        status: baseStatus(),
        scope: 'screen',
        featureId: null,
        featureName: null,
        projectName: 'demo',
        screenId: 'alpha',
        revisions: [revision()],
        selectedHash: null,
        detail: null,
        loading: false,
        loadingMore: false,
        loadingDetail: false,
        hasMore: true,
        errorMessage: '',
      },
    });
    const featureTab = withFeature.get(
      '[data-testid="revision-history-scope-feature"]',
    );
    expect((featureTab.element as HTMLButtonElement).disabled).toBe(true);
    await withFeature
      .get('[data-testid="revision-history-load-more"]')
      .trigger('click');
    expect(withFeature.emitted('load-more')?.length).toBe(1);
    withFeature.unmount();
  });

  it('detail に item / truncation を表示し email を出さない', () => {
    const wrapper = mount(RevisionHistoryDialog, {
      props: {
        status: baseStatus(),
        scope: 'project',
        featureId: 'inquiry',
        featureName: '問い合わせ',
        projectName: 'demo',
        screenId: 'alpha',
        revisions: [revision({ message: '長いメッセージ '.repeat(20) })],
        selectedHash: revision().hash,
        detail: detail({
          truncated: true,
          author: { name: '山田 太郎' },
        }),
        loading: false,
        loadingMore: false,
        loadingDetail: false,
        hasMore: false,
        errorMessage: '',
      },
    });
    const text = wrapper.text();
    expect(text).toContain('メール');
    expect(text).toContain('一部のみ表示');
    expect(text).not.toContain('@example.com');
    wrapper.unmount();
  });

  it('merge commit 行に マージ badge と 親: 2、390px で overflow しない', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 390,
    });
    const mergeRev = revision({
      hash: 'c'.repeat(64),
      shortHash: 'ccccccc',
      parents: ['d'.repeat(64), 'e'.repeat(64)],
      parentCount: 2,
      message: 'Merge topic into main',
    });
    const wrapper = mount(RevisionHistoryDialog, {
      props: {
        status: baseStatus(),
        scope: 'project',
        featureId: 'inquiry',
        featureName: '問い合わせ',
        projectName: 'demo',
        screenId: 'alpha',
        revisions: [mergeRev],
        selectedHash: mergeRev.hash,
        detail: detail({
          hash: mergeRev.hash,
          shortHash: mergeRev.shortHash,
          parents: mergeRev.parents,
          parentCount: 2,
          isMerge: true,
          message: mergeRev.message,
        }),
        loading: false,
        loadingMore: false,
        loadingDetail: false,
        hasMore: false,
        errorMessage: '',
      },
      attachTo: document.body,
    });
    await nextTick();
    expect(wrapper.get('[data-testid="revision-history-merge-badge"]').text()).toBe(
      'マージ',
    );
    expect(wrapper.get('[data-testid="revision-history-parent-count"]').text()).toBe(
      '親: 2',
    );
    expect(wrapper.text()).toContain('commit（first parent 比較）');
    const dialog = wrapper.get('.revision-history-dialog').element as HTMLElement;
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    wrapper.unmount();
  });
});

describe('formatVersionHistoryError', () => {
  it('既知 code を日本語化する', () => {
    expect(
      formatVersionHistoryError({
        code: 'SPEC_VERSION_NOT_INITIALIZED',
        message: 'x',
      }),
    ).toContain('初期化');
    expect(
      formatVersionHistoryError({
        code: 'SPEC_VERSION_HEAD_CHANGED',
        message: 'x',
      }),
    ).toContain('再読み込み');
  });
});

describe('version history capability bootstrap', () => {
  it('bootstrap 無しでは available=false', async () => {
    const { useVersionHistory } = await import(
      '../../src/viewer/version-history/use-version-history'
    );
    const { ref } = await import('vue');
    const hook = useVersionHistory({ screenId: ref('alpha') });
    expect(hook.available).toBe(false);
  });

  it('bootstrap ありでは available=true', async () => {
    window.__JSKIM_SPEC_VERSION__ = {
      available: true,
      mode: 'local-read-only',
      apiBase: '/_jskim/spec/version',
      featuresApiBase: '/_jskim/spec/features',
    };
    const { useVersionHistory } = await import(
      '../../src/viewer/version-history/use-version-history'
    );
    const { ref } = await import('vue');
    const hook = useVersionHistory({ screenId: ref('alpha') });
    expect(hook.available).toBe(true);
  });
});
