import type {
  FeatureApiError,
  FeatureMutationResponse,
  FeatureWorkingResponse,
  SpecFeatureBootstrap,
} from './types.js';

export type FeatureClientResult<T> =
  | { ok: true; data: T; aborted?: false }
  | { ok: false; error: FeatureApiError; aborted?: boolean };

function parseErrorBody(body: unknown): FeatureApiError {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const row = body as Record<string, unknown>;
    return {
      code: typeof row.code === 'string' ? row.code : 'SPEC_FEATURE_INTERNAL',
      message:
        typeof row.message === 'string'
          ? row.message
          : 'Feature API でエラーが発生しました。',
      ...(Object.prototype.hasOwnProperty.call(row, 'expectedRevision')
        ? { expectedRevision: row.expectedRevision as string | null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(row, 'currentRevision')
        ? { currentRevision: row.currentRevision as string | null }
        : {}),
    };
  }
  return {
    code: 'SPEC_FEATURE_INTERNAL',
    message: 'Feature API でエラーが発生しました。',
  };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as unknown;
}

export function createFeatureClient(bootstrap: SpecFeatureBootstrap) {
  const base = bootstrap.apiBase.replace(/\/$/, '');

  async function getWorkingState(
    signal?: AbortSignal,
  ): Promise<FeatureClientResult<FeatureWorkingResponse>> {
    try {
      const res = await fetch(base, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal,
      });
      if (signal?.aborted) {
        return { ok: false, error: { code: 'SPEC_FEATURE_ABORTED', message: '' }, aborted: true };
      }
      const body = await readJson(res);
      if (!res.ok) {
        return { ok: false, error: parseErrorBody(body) };
      }
      return { ok: true, data: body as FeatureWorkingResponse };
    } catch (err) {
      if (signal?.aborted) {
        return { ok: false, error: { code: 'SPEC_FEATURE_ABORTED', message: '' }, aborted: true };
      }
      return {
        ok: false,
        error: {
          code: 'SPEC_FEATURE_NETWORK',
          message: 'Feature API に接続できませんでした。',
        },
      };
    }
  }

  async function postJson<T>(
    path: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<FeatureClientResult<T>> {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
        signal,
      });
      if (signal?.aborted) {
        return { ok: false, error: { code: 'SPEC_FEATURE_ABORTED', message: '' }, aborted: true };
      }
      const body = await readJson(res);
      if (!res.ok) {
        return { ok: false, error: parseErrorBody(body) };
      }
      return { ok: true, data: body as T };
    } catch (err) {
      if (signal?.aborted) {
        return { ok: false, error: { code: 'SPEC_FEATURE_ABORTED', message: '' }, aborted: true };
      }
      return {
        ok: false,
        error: {
          code: 'SPEC_FEATURE_NETWORK',
          message: 'Feature API に接続できませんでした。',
        },
      };
    }
  }

  async function patchJson(
    featureId: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<FeatureClientResult<FeatureMutationResponse>> {
    try {
      const res = await fetch(`${base}/${encodeURIComponent(featureId)}`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
        signal,
      });
      if (signal?.aborted) {
        return { ok: false, error: { code: 'SPEC_FEATURE_ABORTED', message: '' }, aborted: true };
      }
      const body = await readJson(res);
      if (!res.ok) {
        return { ok: false, error: parseErrorBody(body) };
      }
      return { ok: true, data: body as FeatureMutationResponse };
    } catch (err) {
      if (signal?.aborted) {
        return { ok: false, error: { code: 'SPEC_FEATURE_ABORTED', message: '' }, aborted: true };
      }
      return {
        ok: false,
        error: {
          code: 'SPEC_FEATURE_NETWORK',
          message: 'Feature API に接続できませんでした。',
        },
      };
    }
  }

  async function deleteFeature(
    featureId: string,
    expectedRevision: string | null,
    signal?: AbortSignal,
  ): Promise<FeatureClientResult<FeatureMutationResponse>> {
    try {
      const res = await fetch(`${base}/${encodeURIComponent(featureId)}`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expectedRevision }),
        cache: 'no-store',
        signal,
      });
      if (signal?.aborted) {
        return { ok: false, error: { code: 'SPEC_FEATURE_ABORTED', message: '' }, aborted: true };
      }
      const body = await readJson(res);
      if (!res.ok) {
        return { ok: false, error: parseErrorBody(body) };
      }
      return { ok: true, data: body as FeatureMutationResponse };
    } catch (err) {
      if (signal?.aborted) {
        return { ok: false, error: { code: 'SPEC_FEATURE_ABORTED', message: '' }, aborted: true };
      }
      return {
        ok: false,
        error: {
          code: 'SPEC_FEATURE_NETWORK',
          message: 'Feature API に接続できませんでした。',
        },
      };
    }
  }

  return {
    getWorkingState,
    createFeature: (payload: Record<string, unknown>, signal?: AbortSignal) =>
      postJson<FeatureMutationResponse>('', payload, signal),
    updateFeature: (
      featureId: string,
      payload: Record<string, unknown>,
      signal?: AbortSignal,
    ) => patchJson(featureId, payload, signal),
    deleteFeature,
    reorderFeatures: (payload: Record<string, unknown>, signal?: AbortSignal) =>
      postJson<FeatureMutationResponse>(':reorder', payload, signal),
    moveScreen: (payload: Record<string, unknown>, signal?: AbortSignal) =>
      postJson<FeatureMutationResponse>('/screens:move', payload, signal),
    reorderFeatureScreens: (
      featureId: string,
      payload: Record<string, unknown>,
      signal?: AbortSignal,
    ) =>
      postJson<FeatureMutationResponse>(
        `/${encodeURIComponent(featureId)}/screens:reorder`,
        payload,
        signal,
      ),
  };
}

export type FeatureClient = ReturnType<typeof createFeatureClient>;
