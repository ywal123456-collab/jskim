import type {
  LoadedResourceFile,
  LoadedScreen,
  LoadedStyleRef,
} from './load-screen-spec-project.js';
import { computeItemOrder } from './item-order.js';
import { sanitizeSnapshot } from './sanitize-snapshot.js';
import {
  rewriteResourceTokens,
  resourceTokenToViewerUrl,
  findResourceTokens,
} from '../collector/resources/resource-token.js';

export type ViewerInteraction = {
  itemId: string;
  type: string;
  category?: string;
  targetStateId?: string;
  targetScreenId?: string;
  url?: string;
  label?: string;
  /** 遷移先画面が viewer に未登録のとき true（build 失敗にはしない） */
  unregisteredTarget?: boolean;
};

export type ViewerStateStyle = {
  kind: 'link' | 'style';
  href: string;
  media: string;
  disabled: boolean;
};

export type ViewerState = {
  id: string;
  name: string;
  viewer: {
    visible: boolean;
    order: number;
  };
  snapshotFile: string;
  styles: ViewerStateStyle[];
  documentContext?: {
    html: { class: string[]; attributes: Record<string, string> };
    body: { class: string[]; attributes: Record<string, string> };
  };
};

export type ViewerScreenData = {
  id: string;
  name: string;
  description: string;
  path: string;
  itemOrder: string[];
  items: Record<
    string,
    {
      name: string;
      type: string;
      description: string;
      note: string;
    }
  >;
  states: ViewerState[];
  interactions: ViewerInteraction[];
};

export type ViewerManifest = {
  schemaVersion: string;
  projectName: string;
  base: string;
  screens: Array<{
    id: string;
    name: string;
    path: string;
    dataFile: string;
  }>;
};

export type CreatedViewerPayload = {
  manifest: ViewerManifest;
  screens: ViewerScreenData[];
  snapshotFiles: Array<{
    screenId: string;
    stateId: string;
    html: string;
    relativePath: string;
  }>;
  resourceFiles: Array<{
    id: string;
    bytes: Buffer;
    relativePath: string;
  }>;
};

/**
 * 登録済み画面集合を基準に viewer 用 manifest / screen JSON を組み立てる。
 * 未登録の screen-transition 先は unregisteredTarget: true にする（build は続行）。
 * resource token は base 付き viewer URL に置換する。
 */
export function createViewerManifest(options: {
  projectName: string;
  base: string;
  screens: LoadedScreen[];
  registeredScreenIds: Set<string>;
  resourceFiles?: Map<string, LoadedResourceFile>;
}): CreatedViewerPayload {
  const {
    projectName,
    base,
    screens,
    registeredScreenIds,
    resourceFiles = new Map(),
  } = options;

  const knownIds = new Set(resourceFiles.keys());
  const viewerScreens: ViewerScreenData[] = [];
  const snapshotFiles: CreatedViewerPayload['snapshotFiles'] = [];

  for (const screen of screens) {
    const snapshotByState = new Map(
      screen.snapshots.map((snap) => [snap.stateId, snap]),
    );

    const statesForOrder = screen.source.states.map((state) => {
      const snap = snapshotByState.get(state.id);
      return {
        id: state.id,
        viewer: state.viewer,
        html: snap?.html ?? '',
      };
    });

    const itemOrder = computeItemOrder(statesForOrder);

    const viewerStates: ViewerState[] = [];
    for (const state of screen.source.states) {
      const snap = snapshotByState.get(state.id);
      if (!snap) {
        continue;
      }
      const relativePath = `snapshots/${screen.screenId}/${state.id}.html`;
      const sanitized = sanitizeSnapshot(snap.html);
      const html = rewriteResourceTokens(sanitized, base, knownIds);
      assertNoTokens(html, relativePath);
      snapshotFiles.push({
        screenId: screen.screenId,
        stateId: state.id,
        html,
        relativePath,
      });
      viewerStates.push({
        id: state.id,
        name: state.name,
        viewer: {
          visible: state.viewer?.visible !== false,
          order: state.viewer?.order ?? 0,
        },
        snapshotFile: relativePath,
        styles: resolveStyles(
          screen.stateStyles[state.id] || [],
          base,
          knownIds,
        ),
        ...(screen.stateDocumentContexts[state.id]
          ? { documentContext: screen.stateDocumentContexts[state.id] }
          : {}),
      });
    }

    for (const snap of screen.snapshots) {
      if (viewerStates.some((s) => s.id === snap.stateId)) {
        continue;
      }
      const relativePath = `snapshots/${screen.screenId}/${snap.stateId}.html`;
      const sanitized = sanitizeSnapshot(snap.html);
      const html = rewriteResourceTokens(sanitized, base, knownIds);
      assertNoTokens(html, relativePath);
      snapshotFiles.push({
        screenId: screen.screenId,
        stateId: snap.stateId,
        html,
        relativePath,
      });
      viewerStates.push({
        id: snap.stateId,
        name: snap.stateId,
        viewer: { visible: true, order: 1000 },
        snapshotFile: relativePath,
        styles: resolveStyles(
          screen.stateStyles[snap.stateId] || [],
          base,
          knownIds,
        ),
        ...(screen.stateDocumentContexts[snap.stateId]
          ? { documentContext: screen.stateDocumentContexts[snap.stateId] }
          : {}),
      });
    }

    viewerStates.sort((a, b) => a.viewer.order - b.viewer.order);

    const interactions: ViewerInteraction[] = (screen.source.interactions || []).map(
      (interaction) => {
        const next: ViewerInteraction = {
          itemId: interaction.itemId,
          type: interaction.type,
          category: interaction.category,
          targetStateId: interaction.targetStateId,
          targetScreenId: interaction.targetScreenId,
          url: interaction.url,
          label: interaction.label,
        };

        if (
          interaction.type === 'screen-transition' &&
          interaction.targetScreenId &&
          !registeredScreenIds.has(interaction.targetScreenId)
        ) {
          next.unregisteredTarget = true;
        }

        return next;
      },
    );

    const items: ViewerScreenData['items'] = {};
    for (const [itemId, item] of Object.entries(screen.description.items || {})) {
      items[itemId] = {
        name: item.name ?? '',
        type: item.type ?? '',
        description: item.description ?? '',
        note: item.note ?? '',
      };
    }

    viewerScreens.push({
      id: screen.screenId,
      name: screen.description.screen.name,
      description: screen.description.screen.description ?? '',
      path: screen.source.screen.path,
      itemOrder,
      items,
      states: viewerStates,
      interactions,
    });
  }

  const outResourceFiles: CreatedViewerPayload['resourceFiles'] = [];
  for (const file of resourceFiles.values()) {
    const relativePath = `resources/files/${file.id}`;
    let bytes = file.bytes;
    if (file.ext === 'css' || file.kind === 'stylesheet') {
      const text = rewriteResourceTokens(
        bytes.toString('utf8'),
        base,
        knownIds,
      );
      assertNoTokens(text, relativePath);
      bytes = Buffer.from(text, 'utf8');
    } else {
      // バイナリはそのまま（token は含まれない想定）
      const asText = bytes.toString('utf8');
      if (asText.includes('jskim-spec-resource://')) {
        const text = rewriteResourceTokens(asText, base, knownIds);
        assertNoTokens(text, relativePath);
        bytes = Buffer.from(text, 'utf8');
      }
    }
    outResourceFiles.push({
      id: file.id,
      bytes,
      relativePath,
    });
  }

  const manifest: ViewerManifest = {
    schemaVersion: '1.0',
    projectName,
    base,
    screens: viewerScreens.map((screen) => ({
      id: screen.id,
      name: screen.name,
      path: screen.path,
      dataFile: `screens/${screen.id}.json`,
    })),
  };

  return {
    manifest,
    screens: viewerScreens,
    snapshotFiles,
    resourceFiles: outResourceFiles,
  };
}

function resolveStyles(
  styles: LoadedStyleRef[],
  base: string,
  knownIds: Set<string>,
): ViewerStateStyle[] {
  return styles
    .filter((s) => !s.disabled)
    .map((s) => {
      if (!knownIds.has(s.resourceId)) {
        throw new Error(
          `未知の resource token です: jskim-spec-resource://${s.resourceId}`,
        );
      }
      return {
        kind: s.kind,
        href: resourceTokenToViewerUrl(s.resourceId, base),
        media: s.media || 'all',
        disabled: false,
      };
    });
}

function assertNoTokens(content: string, where: string): void {
  const leftover = findResourceTokens(content);
  if (leftover.length > 0) {
    throw new Error(
      `未知の resource token です: jskim-spec-resource://${leftover[0]} (${where})`,
    );
  }
  if (content.includes('jskim-spec-resource://')) {
    throw new Error(
      `resource token が残っています (${where})`,
    );
  }
}
