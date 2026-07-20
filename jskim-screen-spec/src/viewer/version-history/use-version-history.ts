import { getCurrentInstance, onBeforeUnmount, ref, shallowRef, type Ref } from 'vue';
import { createVersionHistoryClient } from './version-history-client.js';
import { formatVersionHistoryError } from './format-version-error.js';
import {
  getSpecVersionBootstrap,
  type BrowserFeatureList,
  type BrowserRevisionDetail,
  type BrowserRevisionListItem,
  type BrowserVersionStatus,
  type RevisionScope,
  type SpecVersionBootstrap,
} from './types.js';

export type UseVersionHistoryOptions = {
  screenId: Ref<string>;
};

export function useVersionHistory(options: UseVersionHistoryOptions) {
  const bootstrap = getSpecVersionBootstrap();
  const available = Boolean(bootstrap);
  const open = ref(false);
  const loading = ref(false);
  const loadingMore = ref(false);
  const loadingDetail = ref(false);
  const errorMessage = ref('');
  const status = shallowRef<BrowserVersionStatus | null>(null);
  const features = shallowRef<BrowserFeatureList | null>(null);
  const revisions = shallowRef<BrowserRevisionListItem[]>([]);
  const selectedHash = ref<string | null>(null);
  const detail = shallowRef<BrowserRevisionDetail | null>(null);
  const scope = ref<RevisionScope>('screen');
  const historyHead = ref<string | null>(null);
  const nextCursor = ref<string | null>(null);
  const hasMore = ref(false);
  const featureIdForScope = ref<string | null>(null);
  const featureNameForScope = ref<string | null>(null);

  let listSeq = 0;
  let detailSeq = 0;
  let listAbort: AbortController | null = null;
  let detailAbort: AbortController | null = null;
  let bootAbort: AbortController | null = null;

  function clientFrom(boot: SpecVersionBootstrap) {
    return createVersionHistoryClient(boot);
  }

  function abortAll(): void {
    listAbort?.abort();
    detailAbort?.abort();
    bootAbort?.abort();
    listAbort = null;
    detailAbort = null;
    bootAbort = null;
  }

  function resolveFeatureMembership(list: BrowserFeatureList): void {
    const screenId = options.screenId.value;
    const found = list.features.find((f) => f.screenIds.includes(screenId));
    featureIdForScope.value = found ? found.featureId : null;
    featureNameForScope.value = found ? found.name : null;
  }

  async function loadBootstrapData(boot: SpecVersionBootstrap): Promise<void> {
    bootAbort?.abort();
    bootAbort = new AbortController();
    const signal = bootAbort.signal;
    const client = clientFrom(boot);
    loading.value = true;
    errorMessage.value = '';
    const [statusRes, featuresRes] = await Promise.all([
      client.getStatus(signal),
      client.listFeatures(signal),
    ]);
    if (signal.aborted) return;
    if (!statusRes.ok) {
      if (!statusRes.aborted) {
        errorMessage.value = formatVersionHistoryError(statusRes.error);
      }
      loading.value = false;
      return;
    }
    status.value = statusRes.data;
    if (featuresRes.ok) {
      features.value = featuresRes.data;
      resolveFeatureMembership(featuresRes.data);
    }
    loading.value = false;
    if (
      statusRes.data.initialized === true &&
      !statusRes.data.head.unborn &&
      statusRes.data.head.commit
    ) {
      await reloadList(boot);
    } else {
      revisions.value = [];
      detail.value = null;
      selectedHash.value = null;
      historyHead.value = null;
      nextCursor.value = null;
      hasMore.value = false;
    }
  }

  async function reloadList(boot: SpecVersionBootstrap): Promise<void> {
    listAbort?.abort();
    listAbort = new AbortController();
    const signal = listAbort.signal;
    const seq = ++listSeq;
    loading.value = true;
    errorMessage.value = '';
    revisions.value = [];
    nextCursor.value = null;
    hasMore.value = false;
    historyHead.value = null;
    selectedHash.value = null;
    detail.value = null;

    const client = clientFrom(boot);
    const scopeValue = scope.value;
    const result = await client.listRevisions(
      {
        scope: scopeValue,
        screenId: scopeValue === 'screen' ? options.screenId.value : undefined,
        featureId:
          scopeValue === 'feature'
            ? featureIdForScope.value ?? undefined
            : undefined,
        limit: 20,
      },
      signal,
    );
    if (seq !== listSeq || signal.aborted) return;
    loading.value = false;
    if (!result.ok) {
      if (!result.aborted) {
        errorMessage.value = formatVersionHistoryError(result.error);
      }
      return;
    }
    historyHead.value = result.data.historyHead;
    revisions.value = result.data.revisions;
    nextCursor.value = result.data.nextCursor;
    hasMore.value = result.data.hasMore;
    if (result.data.revisions[0]) {
      await selectRevision(boot, result.data.revisions[0].hash);
    }
  }

  async function loadMore(boot: SpecVersionBootstrap): Promise<void> {
    if (!hasMore.value || !nextCursor.value || loadingMore.value) return;
    listAbort?.abort();
    listAbort = new AbortController();
    const signal = listAbort.signal;
    const seq = ++listSeq;
    loadingMore.value = true;
    const client = clientFrom(boot);
    const scopeValue = scope.value;
    const result = await client.listRevisions(
      {
        scope: scopeValue,
        screenId: scopeValue === 'screen' ? options.screenId.value : undefined,
        featureId:
          scopeValue === 'feature'
            ? featureIdForScope.value ?? undefined
            : undefined,
        limit: 20,
        cursor: nextCursor.value,
        historyHead: historyHead.value ?? undefined,
      },
      signal,
    );
    if (seq !== listSeq || signal.aborted) {
      loadingMore.value = false;
      return;
    }
    loadingMore.value = false;
    if (!result.ok) {
      if (!result.aborted) {
        errorMessage.value = formatVersionHistoryError(result.error);
      }
      return;
    }
    if (
      historyHead.value &&
      result.data.historyHead &&
      historyHead.value !== result.data.historyHead
    ) {
      errorMessage.value =
        '履歴の起点が変更されました。一覧を再読み込みしてください。';
      return;
    }
    const existing = new Set(revisions.value.map((r) => r.hash));
    const appended = result.data.revisions.filter((r) => !existing.has(r.hash));
    revisions.value = [...revisions.value, ...appended];
    nextCursor.value = result.data.nextCursor;
    hasMore.value = result.data.hasMore;
  }

  async function selectRevision(
    boot: SpecVersionBootstrap,
    hash: string,
  ): Promise<void> {
    detailAbort?.abort();
    detailAbort = new AbortController();
    const signal = detailAbort.signal;
    const seq = ++detailSeq;
    selectedHash.value = hash;
    loadingDetail.value = true;
    const client = clientFrom(boot);
    const result = await client.getRevision(hash, signal);
    if (seq !== detailSeq || signal.aborted) return;
    loadingDetail.value = false;
    if (!result.ok) {
      if (!result.aborted) {
        errorMessage.value = formatVersionHistoryError(result.error);
      }
      detail.value = null;
      return;
    }
    detail.value = result.data;
  }

  async function openDialog(): Promise<void> {
    if (!bootstrap) return;
    open.value = true;
    scope.value = 'screen';
    await loadBootstrapData(bootstrap);
  }

  function closeDialog(): void {
    open.value = false;
    abortAll();
    loading.value = false;
    loadingMore.value = false;
    loadingDetail.value = false;
  }

  async function setScope(next: RevisionScope): Promise<void> {
    if (!bootstrap || !open.value) return;
    if (next === 'feature' && !featureIdForScope.value) return;
    scope.value = next;
    await reloadList(bootstrap);
  }

  async function requestLoadMore(): Promise<void> {
    if (!bootstrap || !open.value) return;
    await loadMore(bootstrap);
  }

  async function requestSelect(hash: string): Promise<void> {
    if (!bootstrap || !open.value) return;
    await selectRevision(bootstrap, hash);
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      abortAll();
    });
  }

  return {
    available,
    bootstrap,
    open,
    loading,
    loadingMore,
    loadingDetail,
    errorMessage,
    status,
    features,
    revisions,
    selectedHash,
    detail,
    scope,
    hasMore,
    featureIdForScope,
    featureNameForScope,
    openDialog,
    closeDialog,
    setScope,
    requestLoadMore,
    requestSelect,
  };
}
