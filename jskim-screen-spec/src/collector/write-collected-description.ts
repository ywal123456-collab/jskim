import fs from 'node:fs';
import type { DescriptionSpec } from '../builder/load-screen-spec-project.js';
import {
  computeContentRevision,
  computeEmptyDescriptionRevision,
  writeFileAtomic,
} from '../util/write-file-atomic.js';
import { mergeDescription } from './merge-description.js';

export const DESCRIPTION_WRITE_MAX_RETRIES = 3;

export type WriteCollectedDescriptionResult = {
  written: boolean;
  revision: string;
  attempts: number;
  orphanItemIds: string[];
  addedItemIds: string[];
};

export type WriteCollectedDescriptionError = Error & {
  code: 'SPEC_COLLECT_DESCRIPTION_REVISION_CONFLICT';
  screenId: string;
};

/**
 * Collector 用: 最新 Description を読み、item placeholder を merge し、
 * revision 条件付きで安全に書き込む。衝突時は再読込して最大 3 回まで再試行する。
 *
 * 手動 field（screen.name/description、item の name/type/description/note）は
 * mergeDescription が保持する。
 */
export function writeCollectedDescription(options: {
  filePath: string;
  screenId: string;
  foundItemIds: string[];
  maxRetries?: number;
  /** テスト用: writeFileAtomic 差し替え */
  writeFileAtomicFn?: typeof writeFileAtomic;
}): WriteCollectedDescriptionResult {
  const maxRetries = options.maxRetries ?? DESCRIPTION_WRITE_MAX_RETRIES;
  const { filePath, screenId, foundItemIds } = options;
  const writeFn = options.writeFileAtomicFn || writeFileAtomic;
  const emptyRevision = computeEmptyDescriptionRevision(screenId);

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const current = readDescriptionForCollect(filePath, screenId, emptyRevision);
    const merged = mergeDescription({
      existing: current.parsed,
      screenId,
      foundItemIds,
    });

    const nextJson = formatCollectedDescription(
      merged.description,
      current.schemaUri,
    );
    const nextRevision = computeContentRevision(nextJson);

    const result = writeFn(filePath, nextJson, {
      expectedRevision: current.revision,
      emptyRevision,
    });

    if (result.status === 'unchanged') {
      return {
        written: false,
        revision: current.revision,
        attempts: attempt,
        orphanItemIds: merged.orphanItemIds,
        addedItemIds: merged.addedItemIds,
      };
    }

    if (result.status === 'updated') {
      return {
        written: true,
        revision: nextRevision,
        attempts: attempt,
        orphanItemIds: merged.orphanItemIds,
        addedItemIds: merged.addedItemIds,
      };
    }

    // conflict → 再試行
  }

  const err = new Error(
    `画面設計書「${screenId}」の保存が他の更新と衝突し続けたため中止しました。` +
      `最新の Description JSON は上書きしていません。`,
  ) as WriteCollectedDescriptionError;
  err.code = 'SPEC_COLLECT_DESCRIPTION_REVISION_CONFLICT';
  err.screenId = screenId;
  throw err;
}

function readDescriptionForCollect(
  filePath: string,
  screenId: string,
  emptyRevision: string,
): {
  exists: boolean;
  buffer: Buffer | null;
  parsed: DescriptionSpec | null;
  schemaUri: string | undefined;
  revision: string;
} {
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      buffer: null,
      parsed: null,
      schemaUri: undefined,
      revision: emptyRevision,
    };
  }

  const buffer = fs.readFileSync(filePath);
  const json = JSON.parse(buffer.toString('utf8')) as DescriptionSpec & {
    $schema?: string;
  };
  return {
    exists: true,
    buffer,
    parsed: json,
    schemaUri: typeof json.$schema === 'string' ? json.$schema : undefined,
    revision: computeContentRevision(buffer),
  };
}

function formatCollectedDescription(
  description: DescriptionSpec,
  schemaUri: string | undefined,
): string {
  const ordered: Record<string, unknown> = {};
  const fromDoc = (description as DescriptionSpec & { $schema?: string })
    .$schema;
  if (schemaUri) {
    ordered.$schema = schemaUri;
  } else if (typeof fromDoc === 'string') {
    ordered.$schema = fromDoc;
  }
  ordered.schemaVersion = description.schemaVersion || '1.0';
  ordered.screen = description.screen;
  ordered.items = description.items;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
