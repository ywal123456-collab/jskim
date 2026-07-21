import {
  getDescriptionTreeApiBase,
  type DescriptionTreeApiError,
  type DescriptionTreeGetResponse,
} from './description-tree-types.js';

export type DescriptionTreeClientResult =
  | { ok: true; data: DescriptionTreeGetResponse; aborted?: false }
  | { ok: false; error: DescriptionTreeApiError; aborted?: boolean };

function parseErrorBody(body: unknown): DescriptionTreeApiError {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const row = body as Record<string, unknown>;
    return {
      code: typeof row.code === 'string' ? row.code : 'SPEC_DESCRIPTION_INTERNAL',
      message:
        typeof row.message === 'string'
          ? row.message
          : 'Item Tree を取得できませんでした。',
    };
  }
  return {
    code: 'SPEC_DESCRIPTION_INTERNAL',
    message: 'Item Tree を取得できませんでした。',
  };
}

function isDescriptionTreeResponse(body: unknown): body is DescriptionTreeGetResponse {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }
  const row = body as Record<string, unknown>;
  if (typeof row.revision !== 'string' || typeof row.sourceSchemaVersion !== 'string') {
    return false;
  }
  if (
    row.collectedItemIds !== undefined &&
    (!Array.isArray(row.collectedItemIds) ||
      row.collectedItemIds.some((entry) => typeof entry !== 'string'))
  ) {
    return false;
  }
  if (!row.description || typeof row.description !== 'object' || Array.isArray(row.description)) {
    return false;
  }
  const description = row.description as Record<string, unknown>;
  return (
    description.schemaVersion === '1.3' &&
    Array.isArray(description.rootNodes) &&
    Array.isArray(description.groups) &&
    typeof description.items === 'object' &&
    description.items !== null &&
    !Array.isArray(description.items)
  );
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) {
    return null;
  }
  return JSON.parse(text) as unknown;
}

export async function fetchDescriptionTree(
  screenId: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<DescriptionTreeClientResult> {
  const base = getDescriptionTreeApiBase();
  const url = `${base}/${encodeURIComponent(screenId)}`;
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    });
    if (signal?.aborted) {
      return {
        ok: false,
        error: { code: 'SPEC_DESCRIPTION_ABORTED', message: '' },
        aborted: true,
      };
    }
    const body = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: parseErrorBody(body) };
    }
    if (!isDescriptionTreeResponse(body)) {
      return {
        ok: false,
        error: {
          code: 'SPEC_DESCRIPTION_INVALID',
          message: 'Item Tree の応答形式が不正です。',
        },
      };
    }
    return { ok: true, data: body };
  } catch (err) {
    if (signal?.aborted) {
      return {
        ok: false,
        error: { code: 'SPEC_DESCRIPTION_ABORTED', message: '' },
        aborted: true,
      };
    }
    return {
      ok: false,
      error: {
        code: 'SPEC_DESCRIPTION_NETWORK',
        message: 'Item Tree API に接続できませんでした。',
      },
    };
  }
}
