<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  type ComputedRef,
} from 'vue';
import type { FeatureManagementHandle } from '../features/use-feature-management';
import type { ApiFeature } from '../features/types';
import type { ManifestScreen, ViewerManifest } from '../types';

const props = defineProps<{
  management: FeatureManagementHandle;
  screens: ManifestScreen[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const manifest = inject<ComputedRef<ViewerManifest>>('manifest');
const titleId = 'feature-management-dialog-title';
const closeBtnRef = ref<HTMLButtonElement | null>(null);
const dialogRef = ref<HTMLElement | null>(null);

const createOpen = ref(false);
const createFeatureId = ref('');
const createName = ref('');
const createDescription = ref('');
const createError = ref('');

const editingId = ref<string | null>(null);
const editName = ref('');
const editDescription = ref('');

const deleteTarget = ref<ApiFeature | null>(null);

const screenById = computed(() => {
  const map = new Map<string, ManifestScreen>();
  for (const screen of props.screens) {
    map.set(screen.id, screen);
  }
  return map;
});

const featureOptions = computed(() =>
  props.management.features.value.map((f) => ({
    id: f.featureId,
    name: f.name,
  })),
);

function screenName(screenId: string): string {
  return screenById.value.get(screenId)?.name || screenId;
}

function requestClose(): void {
  if (props.management.saving.value) return;
  emit('close');
}

function onOverlayClick(): void {
  requestClose();
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (deleteTarget.value) {
      deleteTarget.value = null;
      return;
    }
    requestClose();
  }
}

function startEdit(feature: ApiFeature): void {
  editingId.value = feature.featureId;
  editName.value = feature.name;
  editDescription.value = feature.description || '';
}

function cancelEdit(): void {
  editingId.value = null;
}

async function saveEdit(featureId: string): Promise<void> {
  const ok = await props.management.runMutation((expectedRevision, signal) =>
    props.management.client().updateFeature(
      featureId,
      {
        name: editName.value,
        description: editDescription.value,
        expectedRevision,
      },
      signal,
    ),
  );
  if (ok) {
    editingId.value = null;
  }
}

async function submitCreate(): Promise<void> {
  createError.value = '';
  const ok = await props.management.runMutation((expectedRevision, signal) =>
    props.management.client().createFeature(
      {
        featureId: createFeatureId.value.trim(),
        name: createName.value,
        description: createDescription.value,
        expectedRevision,
      },
      signal,
    ),
  );
  if (ok) {
    createOpen.value = false;
    createFeatureId.value = '';
    createName.value = '';
    createDescription.value = '';
  } else if (!props.management.conflictMessage.value) {
    createError.value = props.management.errorMessage.value;
  }
}

async function moveFeature(featureId: string, direction: 'up' | 'down'): Promise<void> {
  await props.management.runMutation((expectedRevision, signal) =>
    props.management.client().reorderFeatures(
      { featureId, direction, expectedRevision },
      signal,
    ),
  );
}

async function deleteFeatureConfirmed(): Promise<void> {
  const target = deleteTarget.value;
  if (!target) return;
  const ok = await props.management.runMutation((expectedRevision, signal) =>
    props.management.client().deleteFeature(target.featureId, expectedRevision, signal),
  );
  if (ok) {
    deleteTarget.value = null;
    if (editingId.value === target.featureId) {
      editingId.value = null;
    }
  }
}

async function moveScreen(
  screenId: string,
  targetFeatureId: string | null,
): Promise<void> {
  await props.management.runMutation((expectedRevision, signal) =>
    props.management.client().moveScreen(
      { screenId, targetFeatureId, expectedRevision },
      signal,
    ),
  );
}

async function moveScreenInFeature(
  featureId: string,
  screenId: string,
  direction: 'up' | 'down',
): Promise<void> {
  await props.management.runMutation((expectedRevision, signal) =>
    props.management.client().reorderFeatureScreens(
      featureId,
      { screenId, direction, expectedRevision },
      signal,
    ),
  );
}

function canMoveScreenUp(feature: ApiFeature, screenId: string): boolean {
  const index = feature.screenIds.indexOf(screenId);
  return index > 0;
}

function canMoveScreenDown(feature: ApiFeature, screenId: string): boolean {
  const index = feature.screenIds.indexOf(screenId);
  return index >= 0 && index < feature.screenIds.length - 1;
}

function canMoveFeatureUp(featureId: string): boolean {
  const list = props.management.features.value;
  const index = list.findIndex((f) => f.featureId === featureId);
  return index > 0;
}

function canMoveFeatureDown(featureId: string): boolean {
  const list = props.management.features.value;
  const index = list.findIndex((f) => f.featureId === featureId);
  return index >= 0 && index < list.length - 1;
}

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
    class="spec-dialog-overlay"
    role="presentation"
    @click="onOverlayClick"
  >
    <div
      ref="dialogRef"
      class="spec-dialog feature-management-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-busy="management.loading.value || management.saving.value"
      @click.stop
    >
      <header class="spec-dialog__header">
        <h2 :id="titleId" class="spec-dialog__title">機能管理</h2>
        <button
          ref="closeBtnRef"
          type="button"
          class="spec-dialog__close"
          @click="requestClose"
        >
          閉じる
        </button>
      </header>

      <div class="spec-dialog__body feature-management-dialog__body">
        <p
          v-if="management.conflictMessage.value"
          class="spec-dialog__error"
          role="alert"
          aria-live="assertive"
        >
          {{ management.conflictMessage.value }}
          <button
            type="button"
            class="spec-btn spec-btn--secondary"
            :disabled="management.loading.value"
            @click="management.reload()"
          >
            再読み込み
          </button>
        </p>
        <p
          v-else-if="management.errorMessage.value"
          class="spec-dialog__error"
          role="alert"
          aria-live="polite"
        >
          {{ management.errorMessage.value }}
        </p>

        <div class="feature-management-dialog__toolbar">
          <button
            type="button"
            class="spec-btn"
            :disabled="management.saving.value || createOpen"
            @click="createOpen = true"
          >
            機能を追加
          </button>
        </div>

        <form
          v-if="createOpen"
          class="feature-management-dialog__create"
          @submit.prevent="submitCreate()"
        >
          <h3 class="feature-management-dialog__section-title">機能を追加</h3>
          <label>
            機能ID
            <input v-model="createFeatureId" required autocomplete="off" />
            <span class="feature-management-dialog__hint">
              半角英小文字・数字・ハイフン。作成後は変更できません。
            </span>
          </label>
          <label>
            機能名
            <input v-model="createName" required />
          </label>
          <label>
            説明（任意）
            <textarea v-model="createDescription" rows="2" />
          </label>
          <p v-if="createError" class="spec-dialog__error">{{ createError }}</p>
          <div class="feature-management-dialog__actions">
            <button
              type="submit"
              class="spec-btn"
              :disabled="management.saving.value"
            >
              追加
            </button>
            <button
              type="button"
              class="spec-btn spec-btn--secondary"
              :disabled="management.saving.value"
              @click="createOpen = false"
            >
              キャンセル
            </button>
          </div>
        </form>

        <ul class="feature-management-dialog__feature-list">
          <li
            v-for="feature in management.features.value"
            :key="feature.featureId"
            class="feature-management-dialog__feature"
          >
            <div class="feature-management-dialog__feature-head">
              <template v-if="editingId === feature.featureId">
                <label>
                  機能名
                  <input v-model="editName" />
                </label>
                <label>
                  説明（任意）
                  <textarea v-model="editDescription" rows="2" />
                </label>
                <div class="feature-management-dialog__actions">
                  <button
                    type="button"
                    class="spec-btn"
                    :disabled="management.saving.value"
                    @click="saveEdit(feature.featureId)"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    class="spec-btn spec-btn--secondary"
                    @click="cancelEdit()"
                  >
                    キャンセル
                  </button>
                </div>
              </template>
              <template v-else>
                <div class="feature-management-dialog__feature-title">
                  <strong>{{ feature.name }}</strong>
                  <span class="feature-management-dialog__meta">
                    ID: {{ feature.featureId }} / 画面 {{ feature.screenIds.length }}
                  </span>
                </div>
                <div class="feature-management-dialog__actions">
                  <button
                    type="button"
                    class="spec-btn spec-btn--secondary"
                    :disabled="!canMoveFeatureUp(feature.featureId) || management.saving.value"
                    @click="moveFeature(feature.featureId, 'up')"
                  >
                    上へ
                  </button>
                  <button
                    type="button"
                    class="spec-btn spec-btn--secondary"
                    :disabled="!canMoveFeatureDown(feature.featureId) || management.saving.value"
                    @click="moveFeature(feature.featureId, 'down')"
                  >
                    下へ
                  </button>
                  <button
                    type="button"
                    class="spec-btn spec-btn--secondary"
                    @click="startEdit(feature)"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    class="spec-btn spec-btn--danger"
                    @click="deleteTarget = feature"
                  >
                    削除
                  </button>
                </div>
              </template>
            </div>

            <ul
              v-if="feature.screenIds.length > 0"
              class="feature-management-dialog__screen-list"
            >
              <li
                v-for="screenId in feature.screenIds"
                :key="`${feature.featureId}-${screenId}`"
                class="feature-management-dialog__screen-row"
              >
                <span class="feature-management-dialog__screen-name">{{
                  screenName(screenId)
                }}</span>
                <label class="feature-management-dialog__move-select">
                  移動先 Feature
                  <select
                    :disabled="management.saving.value"
                    @change="
                      moveScreen(
                        screenId,
                        ($event.target as HTMLSelectElement).value === '__ungrouped__'
                          ? null
                          : ($event.target as HTMLSelectElement).value,
                      )
                    "
                  >
                    <option value="" selected disabled>移動先を選択</option>
                    <option value="__ungrouped__">未分類</option>
                    <option
                      v-for="opt in featureOptions"
                      :key="opt.id"
                      :value="opt.id"
                      :disabled="opt.id === feature.featureId"
                    >
                      {{ opt.name }}
                    </option>
                  </select>
                </label>
                <button
                  type="button"
                  class="spec-btn spec-btn--secondary"
                  :disabled="!canMoveScreenUp(feature, screenId) || management.saving.value"
                  @click="moveScreenInFeature(feature.featureId, screenId, 'up')"
                >
                  上へ
                </button>
                <button
                  type="button"
                  class="spec-btn spec-btn--secondary"
                  :disabled="!canMoveScreenDown(feature, screenId) || management.saving.value"
                  @click="moveScreenInFeature(feature.featureId, screenId, 'down')"
                >
                  下へ
                </button>
              </li>
            </ul>
          </li>
        </ul>

        <section
          v-if="management.ungroupedScreenIds.value.length > 0"
          class="feature-management-dialog__ungrouped"
        >
          <h3 class="feature-management-dialog__section-title">未分類</h3>
          <ul class="feature-management-dialog__screen-list">
            <li
              v-for="screenId in management.ungroupedScreenIds.value"
              :key="`ungrouped-${screenId}`"
              class="feature-management-dialog__screen-row"
            >
              <span class="feature-management-dialog__screen-name">{{
                screenName(screenId)
              }}</span>
              <label class="feature-management-dialog__move-select">
                移動先 Feature
                <select
                  :disabled="management.saving.value"
                  @change="
                    moveScreen(
                      screenId,
                      ($event.target as HTMLSelectElement).value || null,
                    )
                  "
                >
                  <option value="" selected disabled>移動先を選択</option>
                  <option
                    v-for="opt in featureOptions"
                    :key="opt.id"
                    :value="opt.id"
                  >
                    {{ opt.name }}
                  </option>
                </select>
              </label>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <div
      v-if="deleteTarget"
      class="spec-dialog-overlay spec-dialog-overlay--nested"
      role="presentation"
      @click="deleteTarget = null"
    >
      <div
        class="spec-dialog spec-dialog--confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="feature-delete-title"
        @click.stop
      >
        <h3 id="feature-delete-title">機能の削除</h3>
        <p>
          機能「{{ deleteTarget.name }}」を削除しますか？<br />
          所属する画面（{{ deleteTarget.screenIds.length }}件）は「未分類」に移動します。<br />
          画面データは削除されません。
        </p>
        <div class="feature-management-dialog__actions">
          <button
            type="button"
            class="spec-btn spec-btn--danger"
            :disabled="management.saving.value"
            @click="deleteFeatureConfirmed()"
          >
            削除
          </button>
          <button
            type="button"
            class="spec-btn spec-btn--secondary"
            @click="deleteTarget = null"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
