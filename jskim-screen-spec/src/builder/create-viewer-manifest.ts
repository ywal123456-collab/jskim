import type {
  LoadedResourceFile,
  LoadedScreen,
  LoadedSnapshot,
  LoadedStyleRef,
  ScreenSpecStatus,
} from './load-screen-spec-project.js';
import {
  computeItemOrder,
  computeEffectiveItemOrder,
  extractItemIdsInDomOrder,
} from './item-order.js';
import { sanitizeSnapshot } from './sanitize-snapshot.js';
import {
  rewriteResourceTokens,
  resourceTokenToViewerUrl,
  findResourceTokens,
} from '../collector/resources/resource-token.js';
import {
  resolveViewerDeviceCaptures,
  type DeviceCaptureOutputFile,
  type ViewerDeviceCaptures,
} from '../device-capture/manifest-captures.js';
import {
  resolveViewerReferenceImages,
  type ReferenceImageOutputFile,
  type ViewerReferenceImages,
} from '../reference-image/manifest-references.js';
import type { BrowserSafeFeatureManifest } from '../features/browser-safe-features.js';
import { projectBrowserSafeFeatureManifest } from '../features/browser-safe-features.js';

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
  /** Device Capture（PC/SP）。runtime collecting/failed は含めない */
  deviceCaptures?: ViewerDeviceCaptures;
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
  status: ScreenSpecStatus;
  hasDescription: boolean;
  hasImplementation: boolean;
  hasPreview: boolean;
  /** PC または SP に current Reference Image がある */
  hasReferenceImage: boolean;
  /** hasPreview または hasReferenceImage */
  hasAnyPreview: boolean;
  /** screen 単位の Reference Image（PC/SP）。runtime は含めない */
  referenceImages?: ViewerReferenceImages;
};

export type ViewerManifestFeature = {
  featureId: string;
  name: string;
  displayOrder: number;
  screenIds: string[];
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
    status: ScreenSpecStatus;
    hasDescription: boolean;
    hasImplementation: boolean;
    hasPreview: boolean;
    hasReferenceImage: boolean;
    hasAnyPreview: boolean;
  }>;
  /** Feature が 1 件以上ある場合のみ付与 */
  features?: ViewerManifestFeature[];
  /** Feature hierarchy 表示時のみ付与 */
  ungroupedScreenIds?: string[];
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
  /** data/ 配下に書く Device Capture PNG（参照されているもののみ） */
  deviceCaptureFiles: DeviceCaptureOutputFile[];
  /** data/ 配下に書く Reference Image PNG（current のみ） */
  referenceImageFiles: ReferenceImageOutputFile[];
};

/**
 * Description の name（trim 非空）→ screenId の優先順で表示名を決める。
 * Source には表示用の name が無いため今日時点では skip する。
 */
function displayScreenName(screen: LoadedScreen): string {
  const descName = screen.description?.screen?.name;
  if (typeof descName === 'string' && descName.trim() !== '') {
    return descName;
  }
  return screen.screenId;
}

function itemsFromDescriptionSpec(
  description: LoadedScreen['description'],
): ViewerScreenData['items'] {
  const items: ViewerScreenData['items'] = {};
  if (!description) {
    return items;
  }
  for (const [itemId, item] of Object.entries(description.items || {})) {
    items[itemId] = {
      name: item.name ?? '',
      type: item.type ?? '',
      description: item.description ?? '',
      note: item.note ?? '',
    };
  }
  return items;
}

/**
 * IMPLEMENTATION_ONLY 用: snapshot HTML から集めた item ID を
 * 空欄 placeholder として並べる（Description が無いため）。
 */
function placeholderItemsFromSnapshots(
  snapshots: LoadedSnapshot[],
): ViewerScreenData['items'] {
  const items: ViewerScreenData['items'] = {};
  for (const snap of snapshots) {
    for (const id of extractItemIdsInDomOrder(snap.html)) {
      if (!items[id]) {
        items[id] = { name: '', type: '', description: '', note: '' };
      }
    }
  }
  return items;
}

function buildInteractions(
  screen: LoadedScreen,
  registeredScreenIds: Set<string>,
): ViewerInteraction[] {
  if (!screen.source) {
    return [];
  }
  return (screen.source.interactions || []).map((interaction) => {
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
  });
}

type BuiltStates = {
  viewerStates: ViewerState[];
  snapshotFiles: CreatedViewerPayload['snapshotFiles'];
  deviceCaptureFiles: DeviceCaptureOutputFile[];
  itemOrder: string[];
};

/**
 * Source が存在する画面（IMPLEMENTATION_ONLY / LINKED）向けに
 * state / snapshot / itemOrder を組み立てる。design-only では呼ばない。
 */
function buildStatesAndOrder(
  screen: LoadedScreen,
  base: string,
  knownIds: Set<string>,
  captureContext: { rootDir: string; projectName: string } | null,
): BuiltStates {
  const source = screen.source;
  if (!source) {
    return {
      viewerStates: [],
      snapshotFiles: [],
      deviceCaptureFiles: [],
      itemOrder: [],
    };
  }

  const snapshotByState = new Map(
    screen.snapshots.map((snap) => [snap.stateId, snap]),
  );

  const statesForOrder = source.states.map((state) => {
    const snap = snapshotByState.get(state.id);
    return {
      id: state.id,
      viewer: state.viewer,
      html: snap?.html ?? '',
    };
  });

  const itemOrder = computeItemOrder(statesForOrder);

  const viewerStates: ViewerState[] = [];
  const snapshotFiles: CreatedViewerPayload['snapshotFiles'] = [];
  const deviceCaptureFiles: DeviceCaptureOutputFile[] = [];

  function attachDeviceCaptures(stateId: string): ViewerDeviceCaptures | undefined {
    if (!captureContext) {
      return undefined;
    }
    const resolved = resolveViewerDeviceCaptures({
      rootDir: captureContext.rootDir,
      projectName: captureContext.projectName,
      screenId: screen.screenId,
      stateId,
    });
    deviceCaptureFiles.push(...resolved.outputFiles);
    return resolved.deviceCaptures;
  }

  for (const state of source.states) {
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
    const deviceCaptures = attachDeviceCaptures(state.id);
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
      ...(deviceCaptures ? { deviceCaptures } : {}),
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
    const deviceCaptures = attachDeviceCaptures(snap.stateId);
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
      ...(deviceCaptures ? { deviceCaptures } : {}),
    });
  }

  viewerStates.sort((a, b) => a.viewer.order - b.viewer.order);

  return { viewerStates, snapshotFiles, deviceCaptureFiles, itemOrder };
}

/**
 * 登録済み画面集合（Description∪Source）を基準に viewer 用 manifest / screen JSON を組み立てる。
 * 未登録の screen-transition 先は unregisteredTarget: true にする（build は続行）。
 * resource token は base 付き viewer URL に置換する。
 *
 * status ごとの扱い:
 * - design-only: path/states/interactions は空。items は Description からそのまま。
 * - implementation-only: path/states は Source/snapshot から。items は snapshot から
 *   集めた ID の空欄 placeholder（Description が無いため）。
 * - linked: 従来通り Source + Description を組み合わせる。
 */
export function createViewerManifest(options: {
  projectName: string;
  base: string;
  screens: LoadedScreen[];
  registeredScreenIds: Set<string>;
  resourceFiles?: Map<string, LoadedResourceFile>;
  /** Device Capture 解決用。未指定時は deviceCaptures を付けない */
  rootDir?: string;
  /** Feature hierarchy（browser-safe）。空配列の場合は manifest に含めない */
  featureManifest?: BrowserSafeFeatureManifest | null;
}): CreatedViewerPayload {
  const {
    projectName,
    base,
    screens,
    registeredScreenIds,
    resourceFiles = new Map(),
    rootDir,
  } = options;

  const knownIds = new Set(resourceFiles.keys());
  const viewerScreens: ViewerScreenData[] = [];
  const snapshotFiles: CreatedViewerPayload['snapshotFiles'] = [];
  const deviceCaptureFiles: DeviceCaptureOutputFile[] = [];
  const referenceImageFiles: ReferenceImageOutputFile[] = [];
  const captureContext =
    typeof rootDir === 'string' && rootDir
      ? { rootDir, projectName }
      : null;

  for (const screen of screens) {
    const name = displayScreenName(screen);

    let screenPath = '';
    let items: ViewerScreenData['items'] = {};
    let itemOrder: string[] = [];
    let viewerStates: ViewerState[] = [];
    let interactions: ViewerInteraction[] = [];
    let description = '';

    if (screen.status === 'design-only') {
      items = itemsFromDescriptionSpec(screen.description);
      itemOrder = computeEffectiveItemOrder({
        items,
        itemOrder: screen.description?.itemOrder,
        collectedOrder: null,
      });
      description = screen.description?.screen.description ?? '';
      // DESIGN_ONLY は Capture を manifest に載せない（Reference は載せる）
    } else {
      screenPath = screen.source?.screen.path ?? '';
      const built = buildStatesAndOrder(
        screen,
        base,
        knownIds,
        captureContext,
      );
      viewerStates = built.viewerStates;
      snapshotFiles.push(...built.snapshotFiles);
      deviceCaptureFiles.push(...built.deviceCaptureFiles);
      interactions = buildInteractions(screen, registeredScreenIds);

      if (screen.status === 'implementation-only') {
        items = placeholderItemsFromSnapshots(screen.snapshots);
        itemOrder = computeEffectiveItemOrder({
          items,
          itemOrder: null,
          collectedOrder: built.itemOrder,
        });
        description = '';
      } else {
        items = itemsFromDescriptionSpec(screen.description);
        itemOrder = computeEffectiveItemOrder({
          items,
          itemOrder: screen.description?.itemOrder,
          collectedOrder: built.itemOrder,
        });
        description = screen.description?.screen.description ?? '';
      }
    }

    let referenceImages: ViewerReferenceImages | undefined;
    let hasReferenceImage = false;
    if (captureContext) {
      const resolved = resolveViewerReferenceImages({
        ...captureContext,
        screenId: screen.screenId,
      });
      referenceImages = resolved.referenceImages;
      hasReferenceImage = resolved.hasReferenceImage;
      referenceImageFiles.push(...resolved.outputFiles);
    }
    const hasAnyPreview = screen.hasPreview || hasReferenceImage;

    viewerScreens.push({
      id: screen.screenId,
      name,
      description,
      path: screenPath,
      itemOrder,
      items,
      states: viewerStates,
      interactions,
      status: screen.status,
      hasDescription: screen.hasDescription,
      hasImplementation: screen.hasImplementation,
      hasPreview: screen.hasPreview,
      hasReferenceImage,
      hasAnyPreview,
      ...(referenceImages ? { referenceImages } : {}),
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
      status: screen.status,
      hasDescription: screen.hasDescription,
      hasImplementation: screen.hasImplementation,
      hasPreview: screen.hasPreview,
      hasReferenceImage: screen.hasReferenceImage,
      hasAnyPreview: screen.hasAnyPreview,
    })),
    ...(options.featureManifest &&
    options.featureManifest.features.length > 0
      ? {
          features: options.featureManifest.features,
          ungroupedScreenIds: options.featureManifest.ungroupedScreenIds,
        }
      : {}),
  };

  return {
    manifest,
    screens: viewerScreens,
    snapshotFiles,
    resourceFiles: outResourceFiles,
    deviceCaptureFiles,
    referenceImageFiles,
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
