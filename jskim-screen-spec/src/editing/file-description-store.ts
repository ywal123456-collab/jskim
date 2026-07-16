import fs from 'node:fs';
import path from 'node:path';
import { extractItemIdsInDomOrder } from '../builder/item-order.js';
import type { DescriptionSpec } from '../builder/load-screen-spec-project.js';
import {
  computeContentRevision,
  computeDraftRevision,
  computeEmptyDescriptionRevision,
  createFileAtomic,
  writeFileAtomic,
} from '../util/write-file-atomic.js';
import { containsPathTraversal, isValidScreenId } from '../util/screen-id.js';
import {
  buildImplementationDraftDocument,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  toEditableDocument,
  validateEditableDescriptionDocument,
  type EditableDescriptionDocument,
} from './validate-description-document.js';

const DEFAULT_SCHEMA_URI =
  'https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/description-spec.v1.schema.json';

export type FileDescriptionStoreOptions = {
  rootDir: string;
  projectName: string;
  /** 登録済み screenId 一覧（Description∪Source の union） */
  listScreenIds: () => string[];
};

export type DescriptionReadResult = {
  screenId: string;
  revision: string;
  exists: boolean;
  document: EditableDescriptionDocument;
};

export type DescriptionWriteResult = {
  screenId: string;
  revision: string;
  saved: boolean;
  written: boolean;
};

export type DescriptionCreateInput = {
  screenId: unknown;
  name: unknown;
  description?: unknown;
};

export type DescriptionCreateResult = {
  screenId: string;
  revision: string;
  document: EditableDescriptionDocument;
  created: true;
};

export type DescriptionStoreError = Error & {
  code: string;
  statusCode: number;
  expectedRevision?: string;
  currentRevision?: string;
};

function storeError(
  statusCode: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): DescriptionStoreError {
  const err = new Error(message) as DescriptionStoreError;
  err.code = code;
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

/**
 * Description JSON の read/write/create 境界。
 * Viewer はファイルパスを知らず、この store 経由でのみ永続化する。
 */
export function createFileDescriptionStore(options: FileDescriptionStoreOptions) {
  const rootDir = path.resolve(options.rootDir);
  const projectName = options.projectName;
  const dataDir = path.join(rootDir, 'spec', projectName, 'src', 'data');
  const snapshotsDir = path.join(rootDir, 'spec', projectName, 'src', 'snapshots');

  function assertScreenAccessible(screenId: string): void {
    const ids = options.listScreenIds();
    if (!ids.includes(screenId)) {
      throw storeError(
        404,
        'SPEC_DESCRIPTION_SCREEN_NOT_FOUND',
        `画面「${screenId}」は登録されていません。`,
      );
    }
  }

  function descriptionPath(screenId: string): string {
    if (containsPathTraversal(screenId)) {
      throw storeError(
        400,
        'SPEC_DESCRIPTION_INVALID_SCREEN_ID',
        '画面 ID が不正です。',
      );
    }
    return path.join(dataDir, `${screenId}.json`);
  }

  /**
   * IMPLEMENTATION_ONLY 画面の snapshot HTML から item ID を集める
   * （Description がまだ無いため placeholder として使う）。
   */
  function collectImplementationItemIds(screenId: string): string[] {
    const screenSnapshotDir = path.join(snapshotsDir, screenId);
    if (!fs.existsSync(screenSnapshotDir)) {
      return [];
    }
    const files = fs
      .readdirSync(screenSnapshotDir)
      .filter((name) => name.endsWith('.html'))
      .sort();

    const ids: string[] = [];
    const seen = new Set<string>();
    for (const name of files) {
      const html = fs.readFileSync(path.join(screenSnapshotDir, name), 'utf8');
      for (const id of extractItemIdsInDomOrder(html)) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    return ids;
  }

  function readRawFile(filePath: string): {
    exists: boolean;
    buffer: Buffer | null;
    parsed: DescriptionSpec | null;
    schemaUri: string | undefined;
  } {
    if (!fs.existsSync(filePath)) {
      return { exists: false, buffer: null, parsed: null, schemaUri: undefined };
    }
    const buffer = fs.readFileSync(filePath);
    let parsed: DescriptionSpec | null = null;
    let schemaUri: string | undefined;
    try {
      const json = JSON.parse(buffer.toString('utf8')) as DescriptionSpec & {
        $schema?: string;
      };
      parsed = json;
      if (typeof json.$schema === 'string') {
        schemaUri = json.$schema;
      }
    } catch {
      throw storeError(
        500,
        'SPEC_DESCRIPTION_PARSE_FAILED',
        '既存の Description JSON を解析できません。',
      );
    }
    return { exists: true, buffer, parsed, schemaUri };
  }

  /**
   * ファイル未存在時（IMPLEMENTATION_ONLY の初回）の draft document と revision。
   * snapshot から集めた item ID を seed する。
   */
  function buildMissingFileState(screenId: string): {
    document: EditableDescriptionDocument;
    revision: string;
    itemIds: string[];
  } {
    const itemIds = collectImplementationItemIds(screenId);
    const document = buildImplementationDraftDocument(screenId, itemIds);
    return {
      document,
      revision: computeDraftRevision(document),
      itemIds,
    };
  }

  function read(screenId: string): DescriptionReadResult {
    assertScreenAccessible(screenId);
    const filePath = descriptionPath(screenId);
    const raw = readRawFile(filePath);

    if (!raw.exists || !raw.parsed || !raw.buffer) {
      const missing = buildMissingFileState(screenId);
      return {
        screenId,
        revision: missing.revision,
        exists: false,
        document: missing.document,
      };
    }

    return {
      screenId,
      revision: computeContentRevision(raw.buffer),
      exists: true,
      document: toEditableDocument(raw.parsed, screenId),
    };
  }

  function write(
    screenId: string,
    document: unknown,
    expectedRevision: string,
  ): DescriptionWriteResult {
    assertScreenAccessible(screenId);

    if (typeof expectedRevision !== 'string' || !expectedRevision.startsWith('sha256:')) {
      throw storeError(
        400,
        'SPEC_DESCRIPTION_INVALID_REVISION',
        'expectedRevision の形式が不正です。',
      );
    }

    const filePath = descriptionPath(screenId);
    const raw = readRawFile(filePath);

    const missing = raw.exists ? null : buildMissingFileState(screenId);
    const emptyRevision = missing
      ? missing.revision
      : computeEmptyDescriptionRevision(screenId);
    const requiredItemIds = missing ? missing.itemIds : null;
    const currentRevision = raw.buffer
      ? computeContentRevision(raw.buffer)
      : emptyRevision;

    if (expectedRevision !== currentRevision) {
      throw storeError(
        409,
        'SPEC_DESCRIPTION_REVISION_CONFLICT',
        '画面設計書が別の場所で変更されています。最新内容を読み込んでから再度保存してください。',
        {
          expectedRevision,
          currentRevision,
        },
      );
    }

    const validationError = validateEditableDescriptionDocument({
      screenId,
      document,
      existing: raw.parsed,
      requiredItemIds,
    });
    if (validationError) {
      throw storeError(400, validationError.code, validationError.message);
    }

    const editable = document as EditableDescriptionDocument;
    const nextSpec: DescriptionSpec & { $schema?: string } = {
      schemaVersion: '1.0',
      screen: {
        id: screenId,
        name: editable.screen.name,
        description: editable.screen.description,
      },
      items: {},
    };

    for (const [id, item] of Object.entries(editable.items)) {
      nextSpec.items[id] = {
        name: item.name,
        type: item.type,
        description: item.description,
        note: item.note,
      };
    }

    if (raw.schemaUri) {
      nextSpec.$schema = raw.schemaUri;
    } else if (!raw.exists) {
      nextSpec.$schema = DEFAULT_SCHEMA_URI;
    }

    // $schema を先頭に近い順序で出す
    const ordered: Record<string, unknown> = {};
    if (nextSpec.$schema) {
      ordered.$schema = nextSpec.$schema;
    }
    ordered.schemaVersion = nextSpec.schemaVersion;
    ordered.screen = nextSpec.screen;
    ordered.items = nextSpec.items;

    const json = `${JSON.stringify(ordered, null, 2)}\n`;
    const result = writeFileAtomic(filePath, json, {
      expectedRevision,
      emptyRevision,
    });

    if (result.status === 'conflict') {
      throw storeError(
        409,
        'SPEC_DESCRIPTION_REVISION_CONFLICT',
        '画面設計書が別の場所で変更されています。最新内容を読み込んでから再度保存してください。',
        {
          expectedRevision: result.expectedRevision,
          currentRevision: result.currentRevision,
        },
      );
    }

    const revision = computeContentRevision(json);

    return {
      screenId,
      revision,
      saved: true,
      written: result.status === 'updated',
    };
  }

  /**
   * 新規 Description を作成する（create-if-absent、上書きしない）。
   *
   * - screenId が listScreenIds に無くても良い（DESIGN_ONLY の新規作成）
   * - screenId が IMPLEMENTATION_ONLY として既に登録されている場合は
   *   snapshot から集めた item ID を placeholder として items に含める
   * - Description ファイルが既に存在する場合は 409
   */
  function create(input: DescriptionCreateInput): DescriptionCreateResult {
    const rawScreenId = input?.screenId;
    if (!isValidScreenId(rawScreenId)) {
      throw storeError(
        400,
        'SPEC_DESCRIPTION_INVALID_SCREEN_ID',
        '画面 ID の形式が不正です。',
      );
    }
    const screenId = rawScreenId;
    if (containsPathTraversal(screenId)) {
      throw storeError(
        400,
        'SPEC_DESCRIPTION_INVALID_SCREEN_ID',
        '画面 ID が不正です。',
      );
    }

    const rawName = input?.name;
    if (typeof rawName !== 'string') {
      throw storeError(
        400,
        'SPEC_DESCRIPTION_INVALID',
        'name は文字列である必要があります。',
      );
    }
    const name = rawName.trim();
    if (name === '') {
      throw storeError(
        400,
        'SPEC_DESCRIPTION_INVALID',
        'name は空にできません。',
      );
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw storeError(
        400,
        'SPEC_DESCRIPTION_INVALID',
        `name は${MAX_NAME_LENGTH}文字以内である必要があります。`,
      );
    }

    const rawDescription = input?.description;
    const description = rawDescription === undefined ? '' : rawDescription;
    if (typeof description !== 'string') {
      throw storeError(
        400,
        'SPEC_DESCRIPTION_INVALID',
        'description は文字列である必要があります。',
      );
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw storeError(
        400,
        'SPEC_DESCRIPTION_INVALID',
        `description は${MAX_DESCRIPTION_LENGTH}文字以内である必要があります。`,
      );
    }

    const filePath = descriptionPath(screenId);
    const isKnownImplementationOnly = options.listScreenIds().includes(screenId);
    const collectedItemIds = isKnownImplementationOnly
      ? collectImplementationItemIds(screenId)
      : [];

    const items: EditableDescriptionDocument['items'] = {};
    for (const id of collectedItemIds) {
      items[id] = { name: '', type: '', description: '', note: '' };
    }

    const screen = { id: screenId, name, description };
    const ordered: Record<string, unknown> = {
      $schema: DEFAULT_SCHEMA_URI,
      schemaVersion: '1.0',
      screen,
      items,
    };

    const json = `${JSON.stringify(ordered, null, 2)}\n`;
    const result = createFileAtomic(filePath, json);

    if (result.status === 'exists') {
      throw storeError(
        409,
        'SPEC_DESCRIPTION_ALREADY_EXISTS',
        `画面設計書「${screenId}」は既に存在します。`,
      );
    }

    const revision = computeContentRevision(json);
    const document: EditableDescriptionDocument = {
      schemaVersion: '1.0',
      screen,
      items,
    };

    return {
      screenId,
      revision,
      document,
      created: true,
    };
  }

  return {
    dataDir,
    descriptionPath,
    read,
    write,
    create,
  };
}

export type FileDescriptionStore = ReturnType<typeof createFileDescriptionStore>;
