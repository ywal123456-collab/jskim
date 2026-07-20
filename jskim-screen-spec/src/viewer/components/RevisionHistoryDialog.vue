<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type {
  BrowserRevisionDetail,
  BrowserRevisionListItem,
  BrowserVersionStatus,
  RevisionScope,
} from '../version-history/types';

const props = defineProps<{
  status: BrowserVersionStatus | null;
  scope: RevisionScope;
  featureId: string | null;
  featureName: string | null;
  projectName: string | null;
  screenId: string;
  revisions: BrowserRevisionListItem[];
  selectedHash: string | null;
  detail: BrowserRevisionDetail | null;
  loading: boolean;
  loadingMore: boolean;
  loadingDetail: boolean;
  hasMore: boolean;
  errorMessage: string;
}>();

const emit = defineEmits<{
  close: [];
  'set-scope': [scope: RevisionScope];
  'load-more': [];
  select: [hash: string];
}>();

const titleId = 'revision-history-dialog-title';
const closeBtnRef = ref<HTMLButtonElement | null>(null);
const dialogRef = ref<HTMLElement | null>(null);

const statusLine = computed(() => {
  const s = props.status;
  if (!s) return '';
  if (!s.initialized) {
    return 'ローカル版管理は初期化されていません。';
  }
  if (s.head.unborn) {
    return 'commitはまだありません。';
  }
  const branch =
    s.head.mode === 'symbolic' && s.head.branch
      ? s.head.branch
      : 'detached';
  const hash = s.head.shortHash || '—';
  const dirty = s.workingTree.clean ? 'clean' : '変更あり';
  return `${branch} @ ${hash} / staged ${s.workingTree.stagedCount} / unstaged ${s.workingTree.unstagedCount} / ${dirty}`;
});

const uninitialized = computed(
  () => props.status !== null && props.status.initialized === false,
);

const recoveryRequired = computed(
  () =>
    props.status !== null &&
    props.status.initialized === true &&
    props.status.recovery.required,
);

const emptyScoped = computed(
  () =>
    !props.loading &&
    props.status?.initialized === true &&
    !props.status.head.unborn &&
    props.revisions.length === 0 &&
    !props.errorMessage,
);

function isMergeRevision(rev: {
  parentCount?: number;
  parents?: string[];
}): boolean {
  if (typeof rev.parentCount === 'number') {
    return rev.parentCount >= 2;
  }
  return (rev.parents?.length ?? 0) >= 2;
}

function firstLine(message: string): string {
  const line = message.split(/\r?\n/)[0] ?? '';
  return line.trim() || '(メッセージなし)';
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'added':
      return '追加';
    case 'deleted':
      return '削除';
    case 'modified':
      return '変更';
    default:
      return kind;
  }
}

function requestClose(): void {
  emit('close');
}

function onOverlayClick(): void {
  requestClose();
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    requestClose();
  }
}

function onScopeKeydown(event: KeyboardEvent, next: RevisionScope): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (next === 'feature' && !props.featureId) return;
    emit('set-scope', next);
  }
}

watch(
  () => props.errorMessage,
  () => {
    /* aria-live 領域の更新用 */
  },
);

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
  void nextTick(() => {
    closeBtnRef.value?.focus();
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown);
});
</script>

<template>
  <div
    class="create-screen-dialog-overlay revision-history-overlay"
    data-testid="revision-history-dialog"
    @click.self="onOverlayClick"
  >
    <div
      ref="dialogRef"
      class="create-screen-dialog revision-history-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-busy="loading || loadingDetail ? 'true' : 'false'"
    >
      <div class="revision-history-dialog__header">
        <h2 :id="titleId" class="create-screen-dialog__title">改訂履歴</h2>
        <button
          ref="closeBtnRef"
          type="button"
          class="spec-page__btn spec-page__btn--secondary"
          data-testid="revision-history-close"
          aria-label="閉じる"
          @click="requestClose"
        >
          閉じる
        </button>
      </div>

      <p
        class="revision-history-dialog__status"
        data-testid="revision-history-status"
      >
        {{ statusLine }}
      </p>

      <p
        v-if="recoveryRequired"
        class="revision-history-dialog__warn"
        role="status"
        data-testid="revision-history-recovery"
      >
        版管理repositoryの復旧が必要です。CLIで recover --inspect
        を実行してください。
      </p>

      <div
        v-if="errorMessage"
        class="revision-history-dialog__error"
        role="alert"
        aria-live="assertive"
        data-testid="revision-history-error"
      >
        {{ errorMessage }}
      </div>

      <div
        v-if="uninitialized"
        class="revision-history-dialog__empty"
        data-testid="revision-history-uninitialized"
      >
        <p>ローカル版管理は初期化されていません。</p>
        <pre class="revision-history-dialog__cli">jskim spec version init {{ projectName || '&lt;project&gt;' }}
jskim spec version add {{ projectName || '&lt;project&gt;' }} --all
jskim spec version commit {{ projectName || '&lt;project&gt;' }} -m "初回登録"</pre>
      </div>

      <template v-else>
        <div
          class="revision-history-dialog__scopes"
          role="tablist"
          aria-label="履歴の範囲"
        >
          <button
            type="button"
            role="tab"
            class="revision-history-dialog__scope"
            :aria-selected="scope === 'screen' ? 'true' : 'false'"
            data-testid="revision-history-scope-screen"
            @click="emit('set-scope', 'screen')"
            @keydown="onScopeKeydown($event, 'screen')"
          >
            画面
          </button>
          <button
            type="button"
            role="tab"
            class="revision-history-dialog__scope"
            :aria-selected="scope === 'feature' ? 'true' : 'false'"
            :disabled="!featureId"
            :title="
              featureId
                ? featureName || featureId
                : 'この画面は機能に所属していません'
            "
            data-testid="revision-history-scope-feature"
            @click="featureId && emit('set-scope', 'feature')"
            @keydown="onScopeKeydown($event, 'feature')"
          >
            機能{{ featureName ? `（${featureName}）` : '' }}
          </button>
          <button
            type="button"
            role="tab"
            class="revision-history-dialog__scope"
            :aria-selected="scope === 'project' ? 'true' : 'false'"
            data-testid="revision-history-scope-project"
            @click="emit('set-scope', 'project')"
            @keydown="onScopeKeydown($event, 'project')"
          >
            プロジェクト
          </button>
        </div>

        <p
          v-if="status && status.initialized && status.head.unborn"
          class="revision-history-dialog__empty"
          data-testid="revision-history-unborn"
        >
          commitはまだありません。
        </p>

        <p
          v-else-if="emptyScoped"
          class="revision-history-dialog__empty"
          data-testid="revision-history-empty-scope"
        >
          <template v-if="scope === 'screen'"
            >この画面の改訂履歴はありません。</template
          >
          <template v-else-if="scope === 'feature'"
            >この機能の改訂履歴はありません。</template
          >
          <template v-else>プロジェクトの改訂履歴はありません。</template>
        </p>

        <div
          v-else
          class="revision-history-dialog__body"
          data-testid="revision-history-body"
        >
          <div class="revision-history-dialog__list" aria-label="改訂一覧">
            <button
              v-for="rev in revisions"
              :key="rev.hash"
              type="button"
              class="revision-history-dialog__row"
              :data-selected="selectedHash === rev.hash ? 'true' : 'false'"
              :aria-current="selectedHash === rev.hash ? 'true' : undefined"
              @click="emit('select', rev.hash)"
            >
              <span class="revision-history-dialog__hash">{{
                rev.shortHash
              }}</span>
              <span
                v-if="isMergeRevision(rev)"
                class="revision-history-dialog__merge-badge"
                data-testid="revision-history-merge-badge"
                >マージ</span
              >
              <span
                v-if="rev.parentCount > 0"
                class="revision-history-dialog__parent-count"
                data-testid="revision-history-parent-count"
                >親: {{ rev.parentCount }}</span
              >
              <span class="revision-history-dialog__msg">{{
                firstLine(rev.message)
              }}</span>
              <span class="revision-history-dialog__meta"
                >{{ rev.author.name }} · {{ formatDate(rev.committedAt) }}</span
              >
              <span
                v-if="rev.tags.length"
                class="revision-history-dialog__tags"
                >{{ rev.tags.join(', ') }}</span
              >
              <span class="revision-history-dialog__counts"
                >F{{ rev.summary.changedFeatureCount }} S{{
                  rev.summary.changedScreenCount
                }}
                I{{ rev.summary.changedItemCount }} R{{
                  rev.summary.changedReferenceCount
                }}
                C{{ rev.summary.changedCaptureCount }}</span
              >
            </button>
            <button
              v-if="hasMore"
              type="button"
              class="spec-page__btn spec-page__btn--secondary revision-history-dialog__more"
              data-testid="revision-history-load-more"
              :disabled="loadingMore"
              @click="emit('load-more')"
            >
              {{ loadingMore ? '読み込み中…' : 'さらに読み込む' }}
            </button>
          </div>

          <div
            class="revision-history-dialog__detail"
            aria-label="改訂詳細"
            data-testid="revision-history-detail"
          >
            <p v-if="loadingDetail">詳細を読み込み中…</p>
            <template v-else-if="detail">
              <p class="revision-history-dialog__full-hash">
                {{ detail.hash }}
              </p>
              <pre class="revision-history-dialog__message">{{
                detail.message
              }}</pre>
              <p>
                作者: {{ detail.author.name }} /
                {{ formatDate(detail.committedAt) }}
              </p>
              <p v-if="isMergeRevision(detail)">
                <span class="revision-history-dialog__merge-badge">マージ</span>
                commit（first parent 比較） / 親: {{ detail.parentCount }}
              </p>
              <p
                v-else-if="detail.parentCount === 1 && detail.parents.length"
              >
                parent: {{ detail.parents[0]?.slice(0, 7) }}
              </p>
              <p v-if="detail.tags.length">
                tags: {{ detail.tags.join(', ') }}
              </p>
              <p
                v-if="detail.truncated"
                class="revision-history-dialog__warn"
                role="status"
              >
                変更一覧は上限のため一部のみ表示しています。
              </p>

              <h3>機能の変更</h3>
              <ul v-if="detail.featureChanges.length">
                <li
                  v-for="fc in detail.featureChanges"
                  :key="fc.featureId + fc.kind"
                >
                  {{ fc.featureId
                  }}{{ fc.name ? `（${fc.name}）` : '' }} —
                  {{ kindLabel(fc.kind) }}
                  <template v-if="fc.membershipChanged"> / 所属変更</template>
                  <template v-if="fc.orderChanged"> / 順序変更</template>
                </li>
              </ul>
              <p v-else>なし</p>

              <h3>画面の変更</h3>
              <ul v-if="detail.screenChanges.length">
                <li
                  v-for="sc in detail.screenChanges"
                  :key="sc.screenId + sc.kind"
                >
                  {{ sc.screenId }} — {{ kindLabel(sc.kind) }}
                  <template v-if="sc.sections.length">
                    （{{ sc.sections.join(', ') }}）
                  </template>
                </li>
              </ul>
              <p v-else>なし</p>

              <h3>項目の変更</h3>
              <ul v-if="detail.itemChanges.length">
                <li
                  v-for="ic in detail.itemChanges"
                  :key="ic.itemId + ic.kind"
                >
                  {{ ic.label || ic.itemId }} — {{ kindLabel(ic.kind) }}
                  <template v-if="ic.changedFields?.length">
                    （{{ ic.changedFields.join(', ') }}）
                  </template>
                </li>
              </ul>
              <p v-else>なし</p>

              <h3>参照画像 / Device Capture</h3>
              <ul v-if="detail.assetChanges.length">
                <li
                  v-for="(ac, idx) in detail.assetChanges"
                  :key="ac.screenId + ac.assetType + (ac.viewport || '') + idx"
                >
                  {{ ac.assetType }} / {{ ac.screenId
                  }}<template v-if="ac.viewport"> / {{ ac.viewport }}</template>
                  — {{ kindLabel(ac.kind) }}
                </li>
              </ul>
              <p v-else>なし</p>
            </template>
            <p v-else>改訂を選択してください。</p>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
