import fs from 'node:fs';
import path from 'node:path';
import type { DescriptionSpec } from '../builder/load-screen-spec-project.js';
import {
  computeContentRevision,
  computeEmptyDescriptionRevision,
  writeFileAtomic,
} from '../util/write-file-atomic.js';
import {
  createEmptyEditableDocument,
  toEditableDocument,
  validateEditableDescriptionDocument,
  type EditableDescriptionDocument,
} from './validate-description-document.js';

export type FileDescriptionStoreOptions = {
  rootDir: string;
  projectName: string;
  /** 登録済み screenId 一覧（Source から） */
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
 * Description JSON の read/write 境界。
 * Viewer はファイルパスを知らず、この store 経由でのみ永続化する。
 */
export function createFileDescriptionStore(options: FileDescriptionStoreOptions) {
  const rootDir = path.resolve(options.rootDir);
  const projectName = options.projectName;
  const dataDir = path.join(rootDir, 'spec', projectName, 'src', 'data');

  function assertScreenRegistered(screenId: string): void {
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
    // path traversal 防止: screenId は ID 規則のみ
    if (
      screenId.includes('..') ||
      screenId.includes('/') ||
      screenId.includes('\\') ||
      screenId.includes('\0')
    ) {
      throw storeError(
        400,
        'SPEC_DESCRIPTION_INVALID_SCREEN_ID',
        '画面 ID が不正です。',
      );
    }
    return path.join(dataDir, `${screenId}.json`);
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

  function read(screenId: string): DescriptionReadResult {
    assertScreenRegistered(screenId);
    const filePath = descriptionPath(screenId);
    const raw = readRawFile(filePath);

    if (!raw.exists || !raw.parsed || !raw.buffer) {
      const empty = createEmptyEditableDocument(screenId);
      return {
        screenId,
        revision: computeEmptyDescriptionRevision(screenId),
        exists: false,
        document: empty,
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
    assertScreenRegistered(screenId);

    if (typeof expectedRevision !== 'string' || !expectedRevision.startsWith('sha256:')) {
      throw storeError(
        400,
        'SPEC_DESCRIPTION_INVALID_REVISION',
        'expectedRevision の形式が不正です。',
      );
    }

    const filePath = descriptionPath(screenId);
    const raw = readRawFile(filePath);
    const emptyRevision = computeEmptyDescriptionRevision(screenId);
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
      nextSpec.$schema =
        'https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/description-spec.v1.schema.json';
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

  return {
    dataDir,
    descriptionPath,
    read,
    write,
  };
}

export type FileDescriptionStore = ReturnType<typeof createFileDescriptionStore>;
