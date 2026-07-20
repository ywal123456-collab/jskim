<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  SCREEN_SPEC_STATUS_LABEL,
  type ManifestFeature,
  type ManifestScreen,
  type ViewerManifest,
} from '../types';
import { featureEditingEnabled } from '../features/types';

const props = defineProps<{
  screens: ManifestScreen[];
}>();

const route = useRoute();
const manifest = inject<{ value: ViewerManifest }>('manifest');
const editingEnabled = inject<boolean>('editingEnabled', false);
const openCreateScreen = inject<() => void>('openCreateScreen', () => {});
const openFeatureManagement = inject<() => void>('openFeatureManagement', () => {});

const featureEditing = featureEditingEnabled();

const hasFeatureHierarchy = computed(
  () => (manifest?.value.features?.length ?? 0) > 0,
);

const screenById = computed(() => {
  const map = new Map<string, ManifestScreen>();
  for (const screen of props.screens) {
    map.set(screen.id, screen);
  }
  return map;
});

const sortedFeatures = computed((): ManifestFeature[] => {
  const list = manifest?.value.features ?? [];
  return [...list].sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) {
      return a.displayOrder - b.displayOrder;
    }
    return a.featureId.localeCompare(b.featureId, 'en');
  });
});

const ungroupedScreenIds = computed(() => manifest?.value.ungroupedScreenIds ?? []);

const expandedFeatures = ref(new Set<string>());

watch(
  () => route.params.screenId,
  (screenId) => {
    if (!hasFeatureHierarchy.value || typeof screenId !== 'string') {
      return;
    }
    for (const feature of sortedFeatures.value) {
      if (feature.screenIds.includes(screenId)) {
        expandedFeatures.value.add(feature.featureId);
      }
    }
  },
  { immediate: true },
);

function statusLabel(screen: ManifestScreen): string {
  return SCREEN_SPEC_STATUS_LABEL[screen.status] ?? '';
}

function screenLinkClass(screenId: string): Record<string, boolean> {
  return {
    'is-active': route.params.screenId === screenId,
  };
}

function toggleFeature(featureId: string): void {
  const next = new Set(expandedFeatures.value);
  if (next.has(featureId)) {
    next.delete(featureId);
  } else {
    next.add(featureId);
  }
  expandedFeatures.value = next;
}

function isFeatureExpanded(featureId: string): boolean {
  return expandedFeatures.value.has(featureId);
}

function resolveScreen(screenId: string): ManifestScreen | undefined {
  return screenById.value.get(screenId);
}
</script>

<template>
  <aside class="spec-sidebar" aria-label="画面一覧">
    <div class="spec-sidebar__head">
      <h2 class="spec-sidebar__title">画面一覧</h2>
      <div class="spec-sidebar__head-actions">
        <button
          v-if="featureEditing"
          type="button"
          class="spec-sidebar__manage-btn"
          @click="openFeatureManagement()"
        >
          機能を管理
        </button>
        <button
          v-if="editingEnabled"
          type="button"
          class="spec-sidebar__create-btn"
          @click="openCreateScreen()"
        >
          ＋ 画面を作成
        </button>
      </div>
    </div>

    <template v-if="!hasFeatureHierarchy">
      <ul class="spec-sidebar__list">
        <li v-for="screen in screens" :key="screen.id">
          <RouterLink
            class="spec-sidebar__link"
            :class="screenLinkClass(screen.id)"
            :to="`/screens/${screen.id}`"
            :aria-current="route.params.screenId === screen.id ? 'page' : undefined"
          >
            <span class="spec-sidebar__link-name">{{ screen.name }}</span>
            <span class="spec-sidebar__badge" :data-status="screen.status">{{
              statusLabel(screen)
            }}</span>
          </RouterLink>
        </li>
      </ul>
    </template>

    <template v-else>
      <div class="spec-sidebar__hierarchy">
        <section
          v-for="feature in sortedFeatures"
          :key="feature.featureId"
          class="spec-sidebar__feature"
        >
          <button
            type="button"
            class="spec-sidebar__feature-toggle"
            :aria-expanded="isFeatureExpanded(feature.featureId)"
            :aria-controls="`feature-panel-${feature.featureId}`"
            @click="toggleFeature(feature.featureId)"
          >
            <span class="spec-sidebar__feature-name">{{ feature.name }}</span>
            <span class="spec-sidebar__feature-count"
              >（{{ feature.screenIds.length }}画面）</span
            >
          </button>
          <ul
            v-show="isFeatureExpanded(feature.featureId)"
            :id="`feature-panel-${feature.featureId}`"
            class="spec-sidebar__list spec-sidebar__list--nested"
          >
            <li
              v-for="screenId in feature.screenIds"
              :key="`${feature.featureId}-${screenId}`"
            >
              <RouterLink
                v-if="resolveScreen(screenId)"
                class="spec-sidebar__link"
                :class="screenLinkClass(screenId)"
                :to="`/screens/${screenId}`"
                :aria-current="route.params.screenId === screenId ? 'page' : undefined"
              >
                <span class="spec-sidebar__link-name">{{
                  resolveScreen(screenId)?.name
                }}</span>
                <span
                  class="spec-sidebar__badge"
                  :data-status="resolveScreen(screenId)?.status"
                  >{{ statusLabel(resolveScreen(screenId)!) }}</span
                >
              </RouterLink>
            </li>
          </ul>
        </section>

        <section
          v-if="ungroupedScreenIds.length > 0"
          class="spec-sidebar__feature spec-sidebar__feature--ungrouped"
        >
          <h3 class="spec-sidebar__ungrouped-title">未分類</h3>
          <ul class="spec-sidebar__list spec-sidebar__list--nested">
            <li v-for="screenId in ungroupedScreenIds" :key="`ungrouped-${screenId}`">
              <RouterLink
                v-if="resolveScreen(screenId)"
                class="spec-sidebar__link"
                :class="screenLinkClass(screenId)"
                :to="`/screens/${screenId}`"
                :aria-current="route.params.screenId === screenId ? 'page' : undefined"
              >
                <span class="spec-sidebar__link-name">{{
                  resolveScreen(screenId)?.name
                }}</span>
                <span
                  class="spec-sidebar__badge"
                  :data-status="resolveScreen(screenId)?.status"
                  >{{ statusLabel(resolveScreen(screenId)!) }}</span
                >
              </RouterLink>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </aside>
</template>
