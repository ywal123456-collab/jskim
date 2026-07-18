import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  normalizeCollectActions,
  type CollectAction,
} from '../collector/run-collect-actions.js';
import { scanSourceSpecs } from '../collector/scan-source-specs.js';
import { computeContentRevision } from '../util/write-file-atomic.js';
import {
  CAPTURE_POLICY_VERSION,
  DEVICE_CAPTURE_FORMAT,
  DEVICE_CAPTURE_FULL_PAGE,
  getViewportPreset,
  type ViewportId,
} from './presets.js';
import { createDeviceCaptureError } from './errors.js';
import {
  resourcesManifestPath,
  screenResourcesPath,
  snapshotHtmlPath,
} from './paths.js';

export type DeviceCaptureInputContext = {
  screenId: string;
  stateId: string;
  viewport: ViewportId;
  route: string;
  actions: CollectAction[];
  snapshotHtml: Buffer;
  /** logical path → content hash（sha256 hex or resource id hash） */
  resourceHashes: Array<{ logicalPath: string; hash: string }>;
};

function sha256Hex(buf: Buffer | string): string {
  return crypto
    .createHash('sha256')
    .update(typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf)
    .digest('hex');
}

/**
 * StyleRef.href から resource files の id（hash12.ext）を取り出す。
 */
function extractResourceIdsFromStyles(
  styles: Array<{ href?: string }> | undefined,
): string[] {
  if (!styles) {
    return [];
  }
  const ids = new Set<string>();
  for (const style of styles) {
    const href = style.href || '';
    const marker = '/resources/files/';
    const idx = href.indexOf(marker);
    if (idx >= 0) {
      const id = href.slice(idx + marker.length).split(/[?#]/)[0];
      if (id) {
        ids.add(id);
      }
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b, 'en'));
}

export function loadDeviceCaptureInputContext(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  stateId: string;
  viewport: ViewportId;
}): DeviceCaptureInputContext {
  const scanned = scanSourceSpecs(options.rootDir, options.projectName);
  const entry = scanned.find((s) => s.source.screen.id === options.screenId);
  if (!entry) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_SCREEN_NOT_FOUND',
      `Source 画面が見つかりません: screenId=${options.screenId}`,
    );
  }
  const state = (entry.source.states || []).find(
    (s) => s.id === options.stateId,
  );
  if (!state) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_STATE_NOT_FOUND',
      `state が見つかりません: screenId=${options.screenId} stateId=${options.stateId}`,
    );
  }

  const snapPath = snapshotHtmlPath(options);
  if (!fs.existsSync(snapPath)) {
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_SNAPSHOT_MISSING',
      `Live snapshot がありません。先に jskim spec collect を実行してください。` +
        ` screenId=${options.screenId} stateId=${options.stateId}`,
    );
  }
  const snapshotHtml = fs.readFileSync(snapPath);

  const resourceHashes: Array<{ logicalPath: string; hash: string }> = [];
  const screenResPath = screenResourcesPath(options);
  const manifestPath = resourcesManifestPath(
    options.rootDir,
    options.projectName,
  );

  let fileHashes = new Map<string, string>();
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        files?: Record<string, { hash?: string }>;
      };
      for (const [id, meta] of Object.entries(manifest.files || {})) {
        if (meta?.hash) {
          fileHashes.set(id, meta.hash);
        }
      }
    } catch {
      fileHashes = new Map();
    }
  }

  if (fs.existsSync(screenResPath)) {
    try {
      const screenRes = JSON.parse(fs.readFileSync(screenResPath, 'utf8')) as {
        states?: Record<string, { styles?: Array<{ href?: string }> }>;
      };
      const styles = screenRes.states?.[options.stateId]?.styles;
      for (const id of extractResourceIdsFromStyles(styles)) {
        const hash = fileHashes.get(id) || id.split('.')[0] || id;
        resourceHashes.push({
          logicalPath: `resources/files/${id}`,
          hash,
        });
      }
    } catch {
      // resource 無し扱い
    }
  }

  resourceHashes.sort((a, b) =>
    a.logicalPath.localeCompare(b.logicalPath, 'en'),
  );

  return {
    screenId: options.screenId,
    stateId: options.stateId,
    viewport: options.viewport,
    route: entry.source.screen.path,
    actions: normalizeCollectActions(state.collect?.actions) as CollectAction[],
    snapshotHtml,
    resourceHashes,
  };
}

/**
 * 決定可能な入力集合の canonical SHA-256。
 */
export function computeInputRevision(
  ctx: DeviceCaptureInputContext,
): string {
  const preset = getViewportPreset(ctx.viewport);
  const resources = [...ctx.resourceHashes].sort((a, b) =>
    a.logicalPath.localeCompare(b.logicalPath, 'en'),
  );
  const payload = {
    capturePolicyVersion: CAPTURE_POLICY_VERSION,
    screenId: ctx.screenId,
    stateId: ctx.stateId,
    route: ctx.route,
    actions: ctx.actions,
    snapshotSha256: sha256Hex(ctx.snapshotHtml),
    resources,
    viewport: {
      id: preset.id,
      width: preset.width,
      height: preset.height,
      deviceScaleFactor: preset.deviceScaleFactor,
      fullPage: DEVICE_CAPTURE_FULL_PAGE,
      format: DEVICE_CAPTURE_FORMAT,
    },
  };
  // 順序固定の JSON
  return computeContentRevision(`${JSON.stringify(payload)}\n`);
}

export function computeImageRevision(pngBytes: Buffer): string {
  return computeContentRevision(pngBytes);
}

export function resolveCaptureDirRelative(
  rootDir: string,
  absolutePath: string,
): string {
  return path.relative(rootDir, absolutePath).split(path.sep).join('/');
}
