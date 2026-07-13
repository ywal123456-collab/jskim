import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { DescriptionSpec } from '../builder/load-screen-spec-project.js';
import { extractItemIdsInDomOrder } from '../builder/item-order.js';
import { createError } from './collector-errors.js';
import { captureScreenRoot } from './capture-screen-root.js';
import {
  mergeDescription,
  stringifyDescription,
} from './merge-description.js';
import {
  assertWaitWithinLimit,
  normalizeCollectActions,
  runCollectActions,
  type CollectAction,
} from './run-collect-actions.js';
import { scanSourceSpecs, sortStatesForCollect } from './scan-source-specs.js';
import { writeSnapshot } from './write-snapshot.js';

export type CollectScreenSpecProjectOptions = {
  rootDir: string;
  projectName: string;
  baseUrl: string;
  renderedRootDir?: string;
};

export type CollectScreenSpecProjectResult = {
  screens: number;
  states: number;
  updated: number;
  unchanged: number;
  warnings: string[];
  browserName: string;
  browserVersion: string;
};

type PendingSnapshot = {
  filePath: string;
  html: string;
};

type PendingDescription = {
  filePath: string;
  json: string;
};

type CapturedState = {
  screenId: string;
  stateId: string;
  html: string;
};

const LOCAL_HOST = '127.0.0.1';

/**
 * Playwright で Source JSON の全 state を収集し、
 * snapshot / description merge をコマンド単位で原子的に書き込む。
 */
export async function collectScreenSpecProject(
  options: CollectScreenSpecProjectOptions,
): Promise<CollectScreenSpecProjectResult> {
  const { rootDir, projectName } = options;
  const baseUrl = assertLocalBaseUrl(options.baseUrl);
  const warnings: string[] = [];

  const scanned = scanSourceSpecs(rootDir, projectName);
  if (scanned.length === 0) {
    return {
      screens: 0,
      states: 0,
      updated: 0,
      unchanged: 0,
      warnings: [
        `Source JSON が見つかりませんでした: src/${projectName}/pages/**/*.spec.json`,
      ],
      browserName: 'chromium',
      browserVersion: '',
    };
  }

  // ブラウザ起動前に wait 上限と path を検証
  for (const entry of scanned) {
    const screenId = entry.source.screen.id;
    assertLocalScreenPath(entry.source.screen.path, screenId);
    const states = sortStatesForCollect(entry.source.states || []);
    for (const state of states) {
      const actions = normalizeCollectActions(state.collect?.actions);
      actions.forEach((action, actionIndex) => {
        assertWaitWithinLimit({
          action,
          actionIndex,
          screenId,
          stateId: state.id,
        });
      });
    }
  }

  let browser: Browser | null = null;
  let browserVersion = '';

  try {
    browser = await launchChromium();
    browserVersion = browser.version();

    const capturedByScreen = new Map<string, CapturedState[]>();
    let stateCount = 0;

    for (const entry of scanned) {
      const screenId = entry.source.screen.id;
      const screenPath = entry.source.screen.path;
      const states = sortStatesForCollect(entry.source.states || []);
      const captured: CapturedState[] = [];

      for (const state of states) {
        stateCount += 1;
        const actions = normalizeCollectActions(
          state.collect?.actions,
        ) as CollectAction[];
        const page = await browser.newPage();
        try {
          await navigateLocal(page, baseUrl, screenPath, screenId, state.id);
          await runCollectActions({
            page,
            actions,
            screenId,
            stateId: state.id,
          });
          const html = await captureScreenRoot({
            page,
            screenId,
            stateId: state.id,
          });
          captured.push({ screenId, stateId: state.id, html });
        } finally {
          await page.close().catch(() => undefined);
        }
      }

      capturedByScreen.set(screenId, captured);
    }

    // ここまで成功したら初めてディスクへ書く
    const pendingSnapshots: PendingSnapshot[] = [];
    const pendingDescriptions: PendingDescription[] = [];
    const snapshotsRoot = path.join(
      rootDir,
      'spec',
      projectName,
      'src',
      'snapshots',
    );
    const dataDir = path.join(rootDir, 'spec', projectName, 'src', 'data');

    for (const entry of scanned) {
      const screenId = entry.source.screen.id;
      const captured = capturedByScreen.get(screenId) || [];
      const stateIds = new Set(captured.map((c) => c.stateId));

      for (const item of captured) {
        pendingSnapshots.push({
          filePath: path.join(snapshotsRoot, screenId, `${item.stateId}.html`),
          html: item.html,
        });
      }

      // orphan snapshot 警告（削除しない）
      const screenSnapDir = path.join(snapshotsRoot, screenId);
      if (fs.existsSync(screenSnapDir)) {
        for (const name of fs.readdirSync(screenSnapDir)) {
          if (!name.endsWith('.html')) {
            continue;
          }
          const stateId = path.basename(name, '.html');
          if (!stateIds.has(stateId)) {
            warnings.push(
              `orphan snapshot を検出しました（削除しません）: ` +
                `spec/${projectName}/src/snapshots/${screenId}/${name}`,
            );
          }
        }
      }

      const foundItemIds: string[] = [];
      const seenItems = new Set<string>();
      for (const item of captured) {
        for (const id of extractItemIdsInDomOrder(item.html)) {
          if (!seenItems.has(id)) {
            seenItems.add(id);
            foundItemIds.push(id);
          }
        }
      }

      const descriptionPath = path.join(dataDir, `${screenId}.json`);
      let existing: DescriptionSpec | null = null;
      if (fs.existsSync(descriptionPath)) {
        existing = JSON.parse(
          fs.readFileSync(descriptionPath, 'utf8'),
        ) as DescriptionSpec;
      }

      const merged = mergeDescription({
        existing,
        screenId,
        foundItemIds,
      });

      for (const orphanId of merged.orphanItemIds) {
        warnings.push(
          `orphan description item を検出しました（削除しません）: ` +
            `screenId=${screenId} itemId=${orphanId}`,
        );
      }

      pendingDescriptions.push({
        filePath: descriptionPath,
        json: stringifyDescription(merged.description),
      });
    }

    let updated = 0;
    let unchanged = 0;

    try {
      for (const snap of pendingSnapshots) {
        const result = writeSnapshot(snap.filePath, snap.html);
        if (result === 'updated') {
          updated += 1;
        } else {
          unchanged += 1;
        }
      }

      for (const desc of pendingDescriptions) {
        fs.mkdirSync(path.dirname(desc.filePath), { recursive: true });
        const nextBuf = Buffer.from(desc.json, 'utf8');
        if (fs.existsSync(desc.filePath)) {
          const existingBuf = fs.readFileSync(desc.filePath);
          if (Buffer.compare(existingBuf, nextBuf) === 0) {
            continue;
          }
        }
        const tempPath = `${desc.filePath}.${process.pid}.tmp`;
        fs.writeFileSync(tempPath, nextBuf);
        fs.renameSync(tempPath, desc.filePath);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw createError(
        'SPEC_COLLECT_SNAPSHOT_WRITE_FAILED',
        `snapshot / description の書き込みに失敗しました。原因: ${message}`,
      );
    }

    return {
      screens: scanned.length,
      states: stateCount,
      updated,
      unchanged,
      warnings,
      browserName: 'chromium',
      browserVersion,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

function assertLocalBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw createError(
      'SPEC_COLLECT_EXTERNAL_REDIRECT',
      `baseUrl が不正です: ${baseUrl}`,
    );
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== LOCAL_HOST) {
    throw createError(
      'SPEC_COLLECT_EXTERNAL_REDIRECT',
      `baseUrl は http://${LOCAL_HOST} のみ許可されます: ${baseUrl}`,
    );
  }
  return baseUrl.replace(/\/$/, '');
}

export function assertLocalScreenPath(
  screenPath: string,
  screenId: string,
): void {
  if (!screenPath.startsWith('/')) {
    throw createError(
      'SPEC_COLLECT_EXTERNAL_REDIRECT',
      `screen.path は / で始まる必要があります。` +
        ` screenId=${screenId} path=${screenPath}`,
    );
  }
  if (screenPath.includes('..')) {
    throw createError(
      'SPEC_COLLECT_EXTERNAL_REDIRECT',
      `screen.path に「..」は含められません。` +
        ` screenId=${screenId} path=${screenPath}`,
    );
  }
}

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isBrowserMissingMessage(message)) {
      throw createError(
        'SPEC_COLLECT_BROWSER_NOT_FOUND',
        'Chromium が見つかりません。' +
          '`npm --prefix jskim-screen-spec run install:browsers` を実行してください。' +
          '（インストール済み package の場合は `npx playwright install chromium`）',
      );
    }
    throw err;
  }
}

function isBrowserMissingMessage(message: string): boolean {
  return (
    message.includes("Executable doesn't exist") ||
    message.includes('browserType.launch') ||
    /playwright.*install/i.test(message)
  );
}

async function navigateLocal(
  page: import('playwright').Page,
  baseUrl: string,
  screenPath: string,
  screenId: string,
  stateId: string,
): Promise<void> {
  const url = `${baseUrl}${screenPath}`;
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'load' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw createError(
      'SPEC_COLLECT_NAVIGATION_FAILED',
      `画面への遷移に失敗しました。` +
        ` screenId=${screenId} stateId=${stateId} url=${url}` +
        ` 原因: ${message}`,
    );
  }

  const finalUrl = page.url();
  let finalParsed: URL;
  try {
    finalParsed = new URL(finalUrl);
  } catch {
    throw createError(
      'SPEC_COLLECT_EXTERNAL_REDIRECT',
      `遷移後 URL が不正です。` +
        ` screenId=${screenId} stateId=${stateId} url=${finalUrl}`,
    );
  }

  if (finalParsed.hostname !== LOCAL_HOST) {
    throw createError(
      'SPEC_COLLECT_EXTERNAL_REDIRECT',
      `外部へリダイレクトしました。` +
        ` screenId=${screenId} stateId=${stateId} url=${finalUrl}`,
    );
  }

  if (response && response.status() >= 400) {
    throw createError(
      'SPEC_COLLECT_NAVIGATION_FAILED',
      `画面の読み込みに失敗しました（HTTP ${response.status()}）。` +
        ` screenId=${screenId} stateId=${stateId} url=${url}`,
    );
  }
}
