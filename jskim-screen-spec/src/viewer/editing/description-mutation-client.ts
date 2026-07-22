import { DESCRIPTION_TREE_API_PREFIX } from './description-tree-types.js';

export type DescriptionMutationError = {
  code: string;
  message: string;
  expectedRevision?: string;
  currentRevision?: string;
  httpStatus: number;
};

export type DescriptionMutationResult = {
  status: 'updated' | 'unchanged';
  revision: string;
};

const GENERIC_ERROR = '画面設計書の更新に失敗しました。';

function treeUrl(screenId: string, suffix = ''): string {
  const encoded = encodeURIComponent(screenId);
  const base = DESCRIPTION_TREE_API_PREFIX.replace(/\/$/, '');
  return suffix ? `${base}/${encoded}${suffix}` : `${base}/${encoded}`;
}

function parseMutationError(
  body: unknown,
  httpStatus: number,
): DescriptionMutationError {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const row = body as Record<string, unknown>;
    return {
      code: typeof row.code === 'string' ? row.code : 'SPEC_DESCRIPTION_INTERNAL',
      message:
        typeof row.message === 'string' && row.message.trim()
          ? row.message
          : GENERIC_ERROR,
      expectedRevision:
        typeof row.expectedRevision === 'string' ? row.expectedRevision : undefined,
      currentRevision:
        typeof row.currentRevision === 'string' ? row.currentRevision : undefined,
      httpStatus,
    };
  }
  return {
    code: 'SPEC_DESCRIPTION_INTERNAL',
    message: GENERIC_ERROR,
    httpStatus,
  };
}

function isMutationEnvelope(body: unknown): body is DescriptionMutationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }
  const row = body as Record<string, unknown>;
  return (
    (row.status === 'updated' || row.status === 'unchanged') &&
    typeof row.revision === 'string' &&
    row.revision.length > 0
  );
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) {
    return null;
  }
  return JSON.parse(text) as unknown;
}

async function mutateJson(
  url: string,
  method: string,
  body: Record<string, unknown>,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<
  | { ok: true; data: DescriptionMutationResult }
  | { ok: false; error: DescriptionMutationError; aborted?: boolean }
> {
  try {
    const res = await fetchFn(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(body),
      signal,
    });
    if (signal?.aborted) {
      return {
        ok: false,
        error: { code: 'SPEC_DESCRIPTION_ABORTED', message: '', httpStatus: 0 },
        aborted: true,
      };
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        error: {
          code: 'SPEC_DESCRIPTION_INVALID',
          message: '応答形式が不正です。',
          httpStatus: res.status,
        },
      };
    }
    const parsed = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: parseMutationError(parsed, res.status) };
    }
    if (!isMutationEnvelope(parsed)) {
      return {
        ok: false,
        error: {
          code: 'SPEC_DESCRIPTION_INVALID',
          message: '応答形式が不正です。',
          httpStatus: res.status,
        },
      };
    }
    return { ok: true, data: parsed };
  } catch (err) {
    if (signal?.aborted) {
      return {
        ok: false,
        error: { code: 'SPEC_DESCRIPTION_ABORTED', message: '', httpStatus: 0 },
        aborted: true,
      };
    }
    return {
      ok: false,
      error: {
        code: 'SPEC_DESCRIPTION_NETWORK',
        message: '通信に失敗しました。',
        httpStatus: 0,
      },
    };
  }
}

export async function updateDescriptionScreen(
  screenId: string,
  input: {
    expectedRevision: string;
    name?: string;
    description?: string;
  },
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  return mutateJson(
    treeUrl(screenId, '/screen'),
    'PATCH',
    input,
    fetchFn,
    signal,
  );
}

export async function updateDescriptionItem(
  screenId: string,
  itemId: string,
  input: {
    expectedRevision: string;
    name?: string;
    type?: string;
    description?: string;
    note?: string;
  },
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  return mutateJson(
    treeUrl(screenId, `/items/${encodeURIComponent(itemId)}`),
    'PATCH',
    input,
    fetchFn,
    signal,
  );
}

export async function createDescriptionItem(
  screenId: string,
  input: {
    expectedRevision: string;
    itemId: string;
    name: string;
    type: string;
    description: string;
    note: string;
    parentGroupId?: string | null;
    insertIndex?: number;
  },
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  return mutateJson(treeUrl(screenId, '/items'), 'POST', input, fetchFn, signal);
}

export async function deleteDescriptionItem(
  screenId: string,
  itemId: string,
  expectedRevision: string,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  return mutateJson(
    treeUrl(screenId, `/items/${encodeURIComponent(itemId)}/delete`),
    'POST',
    { expectedRevision },
    fetchFn,
    signal,
  );
}

export async function excludeDescriptionItem(
  screenId: string,
  itemId: string,
  expectedRevision: string,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  return mutateJson(
    treeUrl(screenId, `/items/${encodeURIComponent(itemId)}/exclude`),
    'POST',
    { expectedRevision },
    fetchFn,
    signal,
  );
}

export async function restoreDescriptionItem(
  screenId: string,
  itemId: string,
  expectedRevision: string,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  return mutateJson(
    treeUrl(screenId, `/items/${encodeURIComponent(itemId)}/restore`),
    'POST',
    { expectedRevision },
    fetchFn,
    signal,
  );
}

export async function reorderDescriptionChildren(
  screenId: string,
  input: {
    expectedRevision: string;
    parentGroupId: string | null;
    orderedNodes: Array<{ type: 'group' | 'item'; id: string }>;
  },
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  return mutateJson(
    treeUrl(screenId, '/children/reorder'),
    'POST',
    input,
    fetchFn,
    signal,
  );
}

export async function updateDescriptionGroup(
  screenId: string,
  groupId: string,
  input: {
    expectedRevision: string;
    name?: string;
    description?: string | null;
    kind?: string;
  },
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const body: Record<string, unknown> = {
    expectedRevision: input.expectedRevision,
  };
  if (input.name !== undefined) {
    body.name = input.name;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'description')) {
    body.description = input.description ?? null;
  }
  if (input.kind !== undefined) {
    body.kind = input.kind;
  }
  return mutateJson(
    treeUrl(screenId, `/groups/${encodeURIComponent(groupId)}`),
    'PATCH',
    body,
    fetchFn,
    signal,
  );
}

export function sanitizeMutationMessage(error: DescriptionMutationError): string {
  if (error.httpStatus >= 500) {
    return GENERIC_ERROR;
  }
  if (error.code === 'SPEC_DESCRIPTION_REVISION_CONFLICT') {
    return '他の操作によって画面設計書が更新されました。最新内容を再読み込みしてください。';
  }
  if (error.code === 'SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED') {
    return '実装画面と連携された項目は削除できません。設計対象に残すか、設計対象から除外してください。';
  }
  if (error.code === 'SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED') {
    return '実装画面と連携していない項目は設計対象から除外できません。不要な場合は項目を削除してください。';
  }
  return error.message || GENERIC_ERROR;
}

const DEFINITE_MUTATION_REJECTION_HTTP_STATUSES = new Set([
  400, 403, 404, 409, 413, 415,
]);

/** サーバーが mutation を commit しなかったと API 契約上判断できる応答。 */
export function isDefiniteMutationRejection(
  error: DescriptionMutationError,
): boolean {
  if (error.code === 'SPEC_DESCRIPTION_REVISION_CONFLICT') {
    return true;
  }
  if (error.code === 'SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED') {
    return true;
  }
  if (error.code === 'SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED') {
    return true;
  }
  return DEFINITE_MUTATION_REJECTION_HTTP_STATUSES.has(error.httpStatus);
}
