/**
 * 改訂履歴 same-origin HTTP クライアント。
 */

import type {
  BrowserRevisionDetail,
  BrowserVersionStatus,
  BrowserFeatureList,
  ListRevisionsResponse,
  RevisionScope,
  SpecVersionBootstrap,
  VersionHistoryApiError,
} from './types.js';

export type VersionHistoryClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: VersionHistoryApiError; aborted?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asErrorBody(value: unknown): VersionHistoryApiError {
  if (isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string') {
    return { code: value.code, message: value.message };
  }
  return {
    code: 'SPEC_VERSION_INTERNAL',
    message: '版管理 API の応答を解釈できませんでした。',
  };
}

async function fetchJson<T>(
  url: string,
  signal: AbortSignal | undefined,
  validate: (body: unknown) => body is T,
): Promise<VersionHistoryClientResult<T>> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        ok: false,
        error: {
          code: 'SPEC_VERSION_INTERNAL',
          message: '版管理 API の JSON を読み取れませんでした。',
        },
      };
    }
    if (!res.ok) {
      return { ok: false, error: asErrorBody(body) };
    }
    if (!validate(body)) {
      return {
        ok: false,
        error: {
          code: 'SPEC_VERSION_INTERNAL',
          message: '版管理 API の応答形式が不正です。',
        },
      };
    }
    return { ok: true, data: body };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        ok: false,
        aborted: true,
        error: { code: 'ABORTED', message: '要求が取り消されました。' },
      };
    }
    return {
      ok: false,
      error: {
        code: 'SPEC_VERSION_NETWORK',
        message: '版管理 API へ接続できませんでした。',
      },
    };
  }
}

function isStatus(body: unknown): body is BrowserVersionStatus {
  if (!isRecord(body) || body.capability !== 'local-read-only') return false;
  if (body.initialized === false) return true;
  if (body.initialized !== true) return false;
  return (
    isRecord(body.head) &&
    isRecord(body.workingTree) &&
    isRecord(body.recovery) &&
    typeof body.workingTree.clean === 'boolean' &&
    typeof body.workingTree.stagedCount === 'number' &&
    typeof body.workingTree.unstagedCount === 'number' &&
    typeof body.recovery.required === 'boolean'
  );
}

function isFeatureList(body: unknown): body is BrowserFeatureList {
  if (!isRecord(body) || !Array.isArray(body.features)) return false;
  if (!Array.isArray(body.ungroupedScreenIds)) return false;
  return body.features.every(
    (f) =>
      isRecord(f) &&
      typeof f.featureId === 'string' &&
      typeof f.name === 'string' &&
      typeof f.displayOrder === 'number' &&
      Array.isArray(f.screenIds),
  );
}

function isRevisionList(body: unknown): body is ListRevisionsResponse {
  if (!isRecord(body)) return false;
  if (!Array.isArray(body.revisions)) return false;
  if (typeof body.hasMore !== 'boolean') return false;
  if (!(body.historyHead === null || typeof body.historyHead === 'string')) {
    return false;
  }
  if (!(body.nextCursor === null || typeof body.nextCursor === 'string')) {
    return false;
  }
  return body.revisions.every(
    (r) =>
      isRecord(r) &&
      typeof r.hash === 'string' &&
      typeof r.shortHash === 'string' &&
      typeof r.message === 'string' &&
      isRecord(r.author) &&
      typeof r.author.name === 'string' &&
      typeof r.committedAt === 'string' &&
      Array.isArray(r.parents) &&
      Array.isArray(r.tags) &&
      isRecord(r.summary),
  );
}

function isRevisionDetail(body: unknown): body is BrowserRevisionDetail {
  if (!isRecord(body)) return false;
  return (
    typeof body.hash === 'string' &&
    typeof body.shortHash === 'string' &&
    typeof body.message === 'string' &&
    isRecord(body.author) &&
    typeof body.author.name === 'string' &&
    typeof body.committedAt === 'string' &&
    Array.isArray(body.parents) &&
    Array.isArray(body.tags) &&
    typeof body.isMerge === 'boolean' &&
    typeof body.truncated === 'boolean' &&
    Array.isArray(body.featureChanges) &&
    Array.isArray(body.screenChanges) &&
    Array.isArray(body.itemChanges) &&
    Array.isArray(body.assetChanges) &&
    isRecord(body.summary)
  );
}

export function createVersionHistoryClient(bootstrap: SpecVersionBootstrap) {
  const apiBase = bootstrap.apiBase.replace(/\/$/, '');
  const featuresBase = bootstrap.featuresApiBase;

  return {
    getStatus(signal?: AbortSignal) {
      return fetchJson(`${apiBase}/status`, signal, isStatus);
    },
    listFeatures(signal?: AbortSignal) {
      return fetchJson(featuresBase, signal, isFeatureList);
    },
    listRevisions(
      options: {
        scope: RevisionScope;
        featureId?: string;
        screenId?: string;
        limit?: number;
        cursor?: string;
        historyHead?: string;
      },
      signal?: AbortSignal,
    ) {
      const params = new URLSearchParams();
      params.set('scope', options.scope);
      if (options.featureId) params.set('featureId', options.featureId);
      if (options.screenId) params.set('screenId', options.screenId);
      if (options.limit != null) params.set('limit', String(options.limit));
      if (options.cursor) params.set('cursor', options.cursor);
      if (options.historyHead) params.set('historyHead', options.historyHead);
      return fetchJson(
        `${apiBase}/revisions?${params.toString()}`,
        signal,
        isRevisionList,
      );
    },
    getRevision(revision: string, signal?: AbortSignal) {
      return fetchJson(
        `${apiBase}/revisions/${encodeURIComponent(revision)}`,
        signal,
        isRevisionDetail,
      );
    },
  };
}
