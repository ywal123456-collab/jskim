import fs from 'node:fs';
import {
  computeContentRevision,
  writeFileAtomic,
  type WriteFileAtomicFs,
  type WriteFileAtomicResult,
} from '../../util/write-file-atomic.js';
import { containsPathTraversal, isValidScreenId } from '../../util/screen-id.js';
import { withDescriptionScreenLock } from '../description-screen-lock.js';
import { formatDescriptionDocumentV13 } from './canonical-writer.js';
import type { CreateGroupInput } from './create-group.js';
import { applyCreateGroup } from './create-group.js';
import { DescriptionDocumentError } from './errors.js';
import { readDescriptionRevision } from './description-revision.js';
import { normalizeDescriptionDocument } from './normalize-description.js';
import { parseDescriptionDocument } from './parse-description-document.js';
import { descriptionDataFilePath, descriptionDataRelativePath } from './paths.js';
import { readDescriptionDocument } from './read-description-document.js';
import type { ApplyMoveNodeResult, MoveNodeInput } from './move-node.js';
import { applyMoveNode } from './move-node.js';
import type { ApplyReorderChildrenResult, ReorderChildrenInput } from './reorder-children.js';
import { applyReorderChildren } from './reorder-children.js';
import type { ApplyDeleteGroupResult, DeleteGroupInput } from './delete-group.js';
import { applyDeleteGroup } from './delete-group.js';
import type {
  ApplyDeleteGroupSubtreeResult,
  DeleteGroupSubtreeInput,
} from './delete-group-subtree.js';
import { applyDeleteGroupSubtree } from './delete-group-subtree.js';
import type { ApplyUpdateGroupResult, UpdateGroupInput } from './update-group.js';
import { applyUpdateGroup } from './update-group.js';
import type { ApplyUpdateItemResult, UpdateItemInput } from './update-item.js';
import { applyUpdateItem } from './update-item.js';
import type { CreateItemInput } from './create-item.js';
import { applyCreateItem } from './create-item.js';
import { collectCollectedItemIdsForScreen } from '../collect-collected-item-ids.js';
import { validateDescriptionStructure } from './validate-description-structure.js';
import { validateDescriptionTreeSemantics } from './validate-description-tree-semantics.js';
import type { NormalizedDescription } from './types.js';

export type DescriptionTreeMutationContext = {
  rootDir: string;
  projectName: string;
  screenId: string;
};

export type DescriptionTreeMutationAdapters = {
  fs?: WriteFileAtomicFs;
  writeFileAtomic?: typeof writeFileAtomic;
  readFileSync?: typeof fs.readFileSync;
  existsSync?: typeof fs.existsSync;
};

export type DescriptionTreeMutationResult = {
  status: 'updated' | 'unchanged';
  revision: string;
  screenId: string;
  relativePath: string;
  sourceSchemaVersion: NormalizedDescription['sourceSchemaVersion'];
};

export type MutateDescriptionTreeOptions = {
  expectedRevision: string;
  collectedOrder?: string[] | null;
  operation: string;
  apply: (
    normalized: NormalizedDescription,
  ) => NormalizedDescription | 'unchanged';
  adapters?: DescriptionTreeMutationAdapters;
};

function assertExpectedRevision(expectedRevision: unknown): asserts expectedRevision is string {
  if (expectedRevision === undefined || expectedRevision === null) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_REVISION_REQUIRED',
      message: 'expectedRevision は必須です。',
    });
  }
  if (
    typeof expectedRevision !== 'string' ||
    !expectedRevision.startsWith('sha256:') ||
    expectedRevision.length <= 'sha256:'.length
  ) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_REVISION_REQUIRED',
      message: 'expectedRevision の形式が不正です。',
    });
  }
}

function assertContext(ctx: DescriptionTreeMutationContext): void {
  if (!isValidScreenId(ctx.screenId) || containsPathTraversal(ctx.screenId)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_INVALID',
      message: '画面 ID が不正です。',
    });
  }
}

function revisionConflict(
  expectedRevision: string,
  currentRevision: string | null,
): never {
  throw new DescriptionDocumentError({
    code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
    message:
      '画面設計書が別の場所で変更されています。最新内容を読み込んでから再度保存してください。',
    expectedRevision,
    currentRevision,
  } as DescriptionDocumentError & {
    expectedRevision: string;
    currentRevision: string | null;
  });
}

function loadNormalizedFromFile(
  filePath: string,
  readFileSync: typeof fs.readFileSync,
  collectedOrder?: string[] | null,
): NormalizedDescription {
  const rawText = readFileSync(filePath, 'utf8');
  const rawJson = JSON.parse(rawText) as unknown;
  const parsed = parseDescriptionDocument(rawJson);
  if ('error' in parsed) {
    throw new DescriptionDocumentError(parsed.error);
  }
  const structureError = validateDescriptionStructure(parsed);
  if (structureError) {
    throw new DescriptionDocumentError(structureError);
  }
  const normalized = normalizeDescriptionDocument(parsed, { collectedOrder });
  if (parsed.sourceSchemaVersion === '1.3') {
    const semanticError = validateDescriptionTreeSemantics(normalized);
    if (semanticError) {
      throw new DescriptionDocumentError(semanticError);
    }
  }
  return normalized;
}

function validateMutatedTree(normalized: NormalizedDescription): void {
  const rawLike = {
    schemaVersion: '1.3',
    screen: normalized.screen,
    rootNodes: normalized.rootNodes,
    groups: normalized.groups,
    items: normalized.items,
    excludedItems: normalized.excludedItems,
  };
  const parsed = parseDescriptionDocument(rawLike);
  if ('error' in parsed) {
    throw new DescriptionDocumentError(parsed.error);
  }
  const structureError = validateDescriptionStructure(parsed);
  if (structureError) {
    throw new DescriptionDocumentError(structureError);
  }
  const semanticError = validateDescriptionTreeSemantics(normalized);
  if (semanticError) {
    throw new DescriptionDocumentError(semanticError);
  }
}

function persistNormalizedTree(
  ctx: DescriptionTreeMutationContext,
  normalized: NormalizedDescription,
  expectedRevision: string,
  adapters: DescriptionTreeMutationAdapters,
): DescriptionTreeMutationResult {
  validateMutatedTree(normalized);
  normalized.sourceSchemaVersion = '1.3';

  const content = formatDescriptionDocumentV13(normalized);
  const filePath = descriptionDataFilePath(
    ctx.rootDir,
    ctx.projectName,
    ctx.screenId,
  );
  const writeFn = adapters.writeFileAtomic || writeFileAtomic;
  const writeOptions: Parameters<typeof writeFileAtomic>[2] = {
    expectedRevision,
  };
  if (adapters.fs) {
    writeOptions.fs = adapters.fs;
  }

  const result: WriteFileAtomicResult = writeFn(filePath, content, writeOptions);
  if (result.status === 'conflict') {
    revisionConflict(result.expectedRevision, result.currentRevision);
  }

  const revision = computeContentRevision(content);
  return {
    status: result.status === 'unchanged' ? 'unchanged' : 'updated',
    revision,
    screenId: ctx.screenId,
    relativePath: descriptionDataRelativePath(ctx.projectName, ctx.screenId),
    sourceSchemaVersion: '1.3',
  };
}

async function runDescriptionTreeMutation(
  ctx: DescriptionTreeMutationContext,
  options: MutateDescriptionTreeOptions,
): Promise<DescriptionTreeMutationResult> {
  assertContext(ctx);
  assertExpectedRevision(options.expectedRevision);

  const existsSync = options.adapters?.existsSync || fs.existsSync.bind(fs);
  const readFileSync = options.adapters?.readFileSync || fs.readFileSync.bind(fs);
  const filePath = descriptionDataFilePath(
    ctx.rootDir,
    ctx.projectName,
    ctx.screenId,
  );

  if (!existsSync(filePath)) {
    throw new DescriptionDocumentError({
      code: 'SPEC_DESCRIPTION_NOT_FOUND',
      message: `画面「${ctx.screenId}」の Description JSON が存在しません。`,
    });
  }

  const currentRevision = readDescriptionRevision(
    ctx.rootDir,
    ctx.projectName,
    ctx.screenId,
  );
  if (options.expectedRevision !== currentRevision) {
    revisionConflict(options.expectedRevision, currentRevision);
  }

  const normalized = loadNormalizedFromFile(
    filePath,
    readFileSync,
    options.collectedOrder,
  );
  const applied = options.apply(normalized);
  if (applied === 'unchanged') {
    return {
      status: 'unchanged',
      revision: options.expectedRevision,
      screenId: ctx.screenId,
      relativePath: descriptionDataRelativePath(ctx.projectName, ctx.screenId),
      sourceSchemaVersion: normalized.sourceSchemaVersion,
    };
  }
  return persistNormalizedTree(ctx, applied, options.expectedRevision, options.adapters || {});
}

/**
 * expectedRevision + CAS で Item Group tree mutation を永続化する。
 */
export async function mutateDescriptionTree(
  ctx: DescriptionTreeMutationContext,
  options: MutateDescriptionTreeOptions,
): Promise<DescriptionTreeMutationResult> {
  return withDescriptionScreenLock(
    {
      rootDir: ctx.rootDir,
      projectName: ctx.projectName,
      screenId: ctx.screenId,
    },
    options.operation,
    () => runDescriptionTreeMutation(ctx, options),
  );
}

export async function createDescriptionGroup(
  ctx: DescriptionTreeMutationContext,
  options: CreateGroupInput & {
    expectedRevision: string;
    collectedOrder?: string[] | null;
    adapters?: DescriptionTreeMutationAdapters;
  },
): Promise<DescriptionTreeMutationResult> {
  const { expectedRevision, collectedOrder, adapters, ...createInput } = options;
  return mutateDescriptionTree(ctx, {
    expectedRevision,
    collectedOrder,
    operation: 'create-group',
    adapters,
    apply: (normalized) => applyCreateGroup(normalized, createInput),
  });
}

export async function updateDescriptionGroup(
  ctx: DescriptionTreeMutationContext,
  options: UpdateGroupInput & {
    expectedRevision: string;
    collectedOrder?: string[] | null;
    adapters?: DescriptionTreeMutationAdapters;
  },
): Promise<DescriptionTreeMutationResult> {
  const { expectedRevision, collectedOrder, adapters, ...updateInput } = options;
  return mutateDescriptionTree(ctx, {
    expectedRevision,
    collectedOrder,
    operation: 'update-group',
    adapters,
    apply: (normalized) => {
      const result: ApplyUpdateGroupResult = applyUpdateGroup(
        normalized,
        updateInput,
      );
      if (result.status === 'unchanged') {
        return 'unchanged';
      }
      return result.normalized;
    },
  });
}

export async function moveDescriptionNode(
  ctx: DescriptionTreeMutationContext,
  options: MoveNodeInput & {
    expectedRevision: string;
    collectedOrder?: string[] | null;
    adapters?: DescriptionTreeMutationAdapters;
  },
): Promise<DescriptionTreeMutationResult> {
  const { expectedRevision, collectedOrder, adapters, ...moveInput } = options;
  return mutateDescriptionTree(ctx, {
    expectedRevision,
    collectedOrder,
    operation: 'move-node',
    adapters,
    apply: (normalized) => {
      const result: ApplyMoveNodeResult = applyMoveNode(normalized, moveInput);
      if (result.status === 'unchanged') {
        return 'unchanged';
      }
      return result.normalized;
    },
  });
}

export async function reorderDescriptionChildren(
  ctx: DescriptionTreeMutationContext,
  options: ReorderChildrenInput & {
    expectedRevision: string;
    collectedOrder?: string[] | null;
    adapters?: DescriptionTreeMutationAdapters;
  },
): Promise<DescriptionTreeMutationResult> {
  const { expectedRevision, collectedOrder, adapters, ...reorderInput } = options;
  return mutateDescriptionTree(ctx, {
    expectedRevision,
    collectedOrder,
    operation: 'reorder-children',
    adapters,
    apply: (normalized) => {
      const result: ApplyReorderChildrenResult = applyReorderChildren(
        normalized,
        reorderInput,
      );
      if (result.status === 'unchanged') {
        return 'unchanged';
      }
      return result.normalized;
    },
  });
}

export async function deleteDescriptionGroup(
  ctx: DescriptionTreeMutationContext,
  options: DeleteGroupInput & {
    expectedRevision: string;
    collectedOrder?: string[] | null;
    adapters?: DescriptionTreeMutationAdapters;
  },
): Promise<DescriptionTreeMutationResult> {
  const { expectedRevision, collectedOrder, adapters, ...deleteInput } = options;
  return mutateDescriptionTree(ctx, {
    expectedRevision,
    collectedOrder,
    operation: 'delete-group',
    adapters,
    apply: (normalized) => {
      const result: ApplyDeleteGroupResult = applyDeleteGroup(normalized, deleteInput);
      return result.normalized;
    },
  });
}

export async function deleteDescriptionGroupSubtree(
  ctx: DescriptionTreeMutationContext,
  options: DeleteGroupSubtreeInput & {
    expectedRevision: string;
    collectedOrder?: string[] | null;
    adapters?: DescriptionTreeMutationAdapters;
  },
): Promise<DescriptionTreeMutationResult> {
  const { expectedRevision, collectedOrder, adapters, ...deleteInput } = options;
  return mutateDescriptionTree(ctx, {
    expectedRevision,
    collectedOrder,
    operation: 'delete-group-subtree',
    adapters,
    apply: (normalized) => {
      const collectedItemIds = collectCollectedItemIdsForScreen(ctx);
      const result: ApplyDeleteGroupSubtreeResult = applyDeleteGroupSubtree(
        normalized,
        deleteInput,
        collectedItemIds,
      );
      return result.normalized;
    },
  });
}

export async function createDescriptionItem(
  ctx: DescriptionTreeMutationContext,
  options: CreateItemInput & {
    expectedRevision: string;
    collectedOrder?: string[] | null;
    adapters?: DescriptionTreeMutationAdapters;
  },
): Promise<DescriptionTreeMutationResult> {
  const { expectedRevision, collectedOrder, adapters, ...createInput } = options;
  return mutateDescriptionTree(ctx, {
    expectedRevision,
    collectedOrder,
    operation: 'create-item',
    adapters,
    apply: (normalized) => applyCreateItem(normalized, createInput),
  });
}

export async function updateDescriptionItem(
  ctx: DescriptionTreeMutationContext,
  options: UpdateItemInput & {
    expectedRevision: string;
    collectedOrder?: string[] | null;
    adapters?: DescriptionTreeMutationAdapters;
  },
): Promise<DescriptionTreeMutationResult> {
  const { expectedRevision, collectedOrder, adapters, ...updateInput } = options;
  return mutateDescriptionTree(ctx, {
    expectedRevision,
    collectedOrder,
    operation: 'update-item',
    adapters,
    apply: (normalized) => {
      const result: ApplyUpdateItemResult = applyUpdateItem(normalized, updateInput);
      if (result.status === 'unchanged') {
        return 'unchanged';
      }
      return result.normalized;
    },
  });
}

/** read-only: parse / validate / normalize / flatten（ファイル不変） */
export function readDescriptionTreeState(
  ctx: DescriptionTreeMutationContext,
  options: { collectedOrder?: string[] | null } = {},
): ReturnType<typeof readDescriptionDocument> {
  assertContext(ctx);
  const filePath = descriptionDataFilePath(
    ctx.rootDir,
    ctx.projectName,
    ctx.screenId,
  );
  if (!fs.existsSync(filePath)) {
    return {
      error: {
        code: 'SPEC_DESCRIPTION_NOT_FOUND',
        message: `画面「${ctx.screenId}」の Description JSON が存在しません。`,
      },
    };
  }
  const rawJson = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  return readDescriptionDocument(rawJson, {
    collectedOrder: options.collectedOrder ?? null,
  });
}

export { readDescriptionRevision };
