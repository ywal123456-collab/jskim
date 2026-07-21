import fs from 'node:fs';
import type { DescriptionSpec } from '../builder/load-screen-spec-project.js';
import {
  computeContentRevision,
  computeEmptyDescriptionRevision,
  writeFileAtomic,
} from '../util/write-file-atomic.js';
import { mergeDescription } from './merge-description.js';
import { assertDescriptionMutationSupported } from '../editing/description-document/index.js';
import {
  DESCRIPTION_SCHEMA_V1_1_URI,
  DESCRIPTION_SCHEMA_V1_2_URI,
  upgradeSchemaUriToV11,
  upgradeSchemaUriToV12,
} from '../util/description-schema-uri.js';

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
 * Description ファイルが存在しない場合は **新規作成しない**（IMPLEMENTATION_ONLY を維持）。
 * 初回の Description 永続化は Viewer PUT / POST（画面作成・複製）が行う。
 *
 * 手動 field（screen.name/description、item の name/type/description/note）は
 * mergeDescription が保持する。excludedItems も維持する。
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

  // ファイル不在はメモリ draft 合成の対象外。ディスクへ materialize しない。
  if (!fs.existsSync(filePath)) {
    return {
      written: false,
      revision: emptyRevision,
      attempts: 0,
      orphanItemIds: [],
      addedItemIds: [],
    };
  }

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const current = readDescriptionForCollect(filePath, screenId, emptyRevision);
    if (current.parsed) {
      assertDescriptionMutationSupported(current.parsed.schemaVersion);
    }
    if (!current.exists || current.parsed === null) {
      // ループ中に外部削除された場合も再作成しない
      return {
        written: false,
        revision: emptyRevision,
        attempts: attempt,
        orphanItemIds: [],
        addedItemIds: [],
      };
    }

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
  const version = description.schemaVersion || '1.0';
  const isV12 = version === '1.2';
  const isV11 = version === '1.1';
  const ordered: Record<string, unknown> = {};
  const fromDoc = (description as DescriptionSpec & { $schema?: string })
    .$schema;

  if (schemaUri) {
    if (isV12) {
      ordered.$schema = upgradeSchemaUriToV12(schemaUri);
    } else if (isV11) {
      ordered.$schema = upgradeSchemaUriToV11(schemaUri);
    } else {
      ordered.$schema = schemaUri;
    }
  } else if (typeof fromDoc === 'string') {
    if (isV12) {
      ordered.$schema = upgradeSchemaUriToV12(fromDoc);
    } else if (isV11) {
      ordered.$schema = upgradeSchemaUriToV11(fromDoc);
    } else {
      ordered.$schema = fromDoc;
    }
  } else if (isV12) {
    ordered.$schema = DESCRIPTION_SCHEMA_V1_2_URI;
  } else if (isV11) {
    ordered.$schema = DESCRIPTION_SCHEMA_V1_1_URI;
  }

  ordered.schemaVersion = version;
  ordered.screen = description.screen;
  if (isV12 || isV11) {
    ordered.itemOrder = description.itemOrder || [];
  }
  if (isV12) {
    ordered.excludedItems = description.excludedItems || {};
  }
  ordered.items = description.items;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
