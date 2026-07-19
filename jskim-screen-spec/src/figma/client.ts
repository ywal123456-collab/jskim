import {
  createFigmaError,
  maskUrlForLog,
  type FigmaErrorDetails,
} from './errors.js';
import { validateFigmaUpgradeLink } from './parse-input.js';
import {
  FIGMA_API_BASE_URL,
  FIGMA_DEFAULT_EXPORT_SCALE,
  FIGMA_DEFAULT_OPERATION_DEADLINE_MS,
  FIGMA_DEFAULT_REQUEST_TIMEOUT_MS,
  FIGMA_MAX_RETRIES_429,
  type FigmaExportImage,
  type FigmaFrameInfo,
} from './types.js';

export type FigmaClientOptions = {
  token: string;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
  signal?: AbortSignal;
  nowMs?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  operationDeadlineMs?: number;
  requestTimeoutMs?: number;
  /** 操作開始時刻（未指定なら初回呼び出し時） */
  operationStartedAtMs?: number;
};

type JsonObject = Record<string, unknown>;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createFigmaError('SPEC_FIGMA_ABORTED', '操作が中断されました。'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createFigmaError('SPEC_FIGMA_ABORTED', '操作が中断されました。'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createFigmaError('SPEC_FIGMA_ABORTED', '操作が中断されました。');
  }
}

function remainingDeadlineMs(
  options: FigmaClientOptions,
  startedAt: number,
): number {
  const deadline =
    options.operationDeadlineMs ?? FIGMA_DEFAULT_OPERATION_DEADLINE_MS;
  const now = (options.nowMs ?? Date.now)();
  return deadline - (now - startedAt);
}

function parseRetryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (raw == null || raw.trim() === '') {
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return undefined;
  }
  return Math.floor(n);
}

function rateLimitDetails(res: Response): FigmaErrorDetails {
  const details: FigmaErrorDetails = {};
  const retryAfter = parseRetryAfterSeconds(res);
  if (retryAfter !== undefined) {
    details.retryAfterSeconds = retryAfter;
  }
  const planTier = res.headers.get('x-figma-plan-tier');
  if (planTier) {
    details.planTier = planTier;
  }
  const rateType = res.headers.get('x-figma-rate-limit-type');
  if (rateType) {
    details.rateLimitType = rateType;
  }
  const upgrade = validateFigmaUpgradeLink(
    res.headers.get('x-figma-upgrade-link'),
  );
  if (upgrade) {
    details.upgradeLink = upgrade;
  }
  return details;
}

function mapHttpError(
  status: number,
  context: 'nodes' | 'images',
  details?: FigmaErrorDetails,
): never {
  if (status === 401) {
    throw createFigmaError(
      'SPEC_FIGMA_UNAUTHORIZED',
      'Figma 認証に失敗しました。トークンの有効期限や再発行を確認してください。',
      details,
    );
  }
  if (status === 403) {
    // 公式は invalid/expired を 403 と記載。権限不足との完全分離はしない。
    throw createFigmaError(
      'SPEC_FIGMA_FORBIDDEN',
      'この Figma ファイルへアクセスできません。権限またはトークンの scope を確認してください。',
      details,
    );
  }
  if (status === 404) {
    throw createFigmaError(
      'SPEC_FIGMA_FILE_NOT_FOUND',
      'Figma ファイルが見つかりません。',
      details,
    );
  }
  if (status === 429) {
    throw createFigmaError(
      'SPEC_FIGMA_RATE_LIMITED',
      'Figma API の利用制限に達しました。しばらくしてから再試行してください。',
      details,
    );
  }
  if (status === 400) {
    throw createFigmaError(
      'SPEC_FIGMA_RESPONSE_INVALID',
      'Figma API のリクエストパラメータが不正です。',
      details,
    );
  }
  if (status >= 500) {
    throw createFigmaError(
      context === 'images'
        ? 'SPEC_FIGMA_EXPORT_FAILED'
        : 'SPEC_FIGMA_RESPONSE_INVALID',
      context === 'images'
        ? 'Figma からの画像エクスポートに失敗しました。'
        : 'Figma API の応答が不正です。',
      details,
    );
  }
  throw createFigmaError(
    'SPEC_FIGMA_RESPONSE_INVALID',
    'Figma API の応答が不正です。',
    details,
  );
}

async function readJsonObject(res: Response): Promise<JsonObject> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw createFigmaError(
      'SPEC_FIGMA_RESPONSE_INVALID',
      'Figma API の応答を読めませんでした。',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw createFigmaError(
      'SPEC_FIGMA_RESPONSE_INVALID',
      'Figma API の応答が不正です。',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createFigmaError(
      'SPEC_FIGMA_RESPONSE_INVALID',
      'Figma API の応答が不正です。',
    );
  }
  return parsed as JsonObject;
}

function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}

function extractFrameSize(document: JsonObject): { width: number; height: number } {
  const absoluteBoundingBox = document.absoluteBoundingBox;
  if (
    absoluteBoundingBox &&
    typeof absoluteBoundingBox === 'object' &&
    !Array.isArray(absoluteBoundingBox)
  ) {
    const box = absoluteBoundingBox as Record<string, unknown>;
    if (
      typeof box.width === 'number' &&
      typeof box.height === 'number' &&
      Number.isFinite(box.width) &&
      Number.isFinite(box.height) &&
      box.width > 0 &&
      box.height > 0
    ) {
      return { width: box.width, height: box.height };
    }
  }
  // size フィールドのフォールバック
  if (
    typeof document.width === 'number' &&
    typeof document.height === 'number' &&
    document.width > 0 &&
    document.height > 0
  ) {
    return { width: document.width, height: document.height };
  }
  throw createFigmaError(
    'SPEC_FIGMA_RESPONSE_INVALID',
    'Frame の寸法を取得できませんでした。',
  );
}

export class FigmaApiClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly signal?: AbortSignal;
  private readonly nowMs: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly operationDeadlineMs: number;
  private readonly requestTimeoutMs: number;
  private readonly operationStartedAtMs: number;

  constructor(options: FigmaClientOptions) {
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? FIGMA_API_BASE_URL).replace(
      /\/$/,
      '',
    );
    this.signal = options.signal;
    this.nowMs = options.nowMs ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.operationDeadlineMs =
      options.operationDeadlineMs ?? FIGMA_DEFAULT_OPERATION_DEADLINE_MS;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? FIGMA_DEFAULT_REQUEST_TIMEOUT_MS;
    this.operationStartedAtMs =
      options.operationStartedAtMs ?? this.nowMs();
  }

  private remainingMs(): number {
    return (
      this.operationDeadlineMs - (this.nowMs() - this.operationStartedAtMs)
    );
  }

  private async requestJson(
    pathWithQuery: string,
    context: 'nodes' | 'images',
  ): Promise<JsonObject> {
    let retries429 = 0;
    let retries5xx = 0;

    while (true) {
      assertNotAborted(this.signal);
      const remaining = this.remainingMs();
      if (remaining <= 0) {
        throw createFigmaError(
          'SPEC_FIGMA_TIMEOUT',
          'Figma API またはダウンロードがタイムアウトしました。',
        );
      }

      const timeoutMs = Math.min(this.requestTimeoutMs, remaining);
      const controller = new AbortController();
      const onParentAbort = () => controller.abort();
      this.signal?.addEventListener('abort', onParentAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await this.fetchImpl(`${this.apiBaseUrl}${pathWithQuery}`, {
          method: 'GET',
          headers: {
            'X-Figma-Token': this.token,
            Accept: 'application/json',
          },
          signal: controller.signal,
          redirect: 'error',
        });
      } catch (err) {
        clearTimeout(timer);
        this.signal?.removeEventListener('abort', onParentAbort);
        if (this.signal?.aborted) {
          throw createFigmaError(
            'SPEC_FIGMA_ABORTED',
            '操作が中断されました。',
          );
        }
        if (controller.signal.aborted) {
          throw createFigmaError(
            'SPEC_FIGMA_TIMEOUT',
            'Figma API またはダウンロードがタイムアウトしました。',
          );
        }
        throw createFigmaError(
          'SPEC_FIGMA_RESPONSE_INVALID',
          'Figma API への接続に失敗しました。',
        );
      } finally {
        clearTimeout(timer);
        this.signal?.removeEventListener('abort', onParentAbort);
      }

      if (res.status === 429) {
        const details = rateLimitDetails(res);
        const retryAfterSec = details.retryAfterSeconds ?? 1;
        const waitMs = retryAfterSec * 1000;
        const rem = this.remainingMs();
        // 月次制限など即回復できないケース: Retry-After が残り deadline を超える
        if (waitMs > rem || retries429 >= FIGMA_MAX_RETRIES_429) {
          throw createFigmaError(
            'SPEC_FIGMA_RATE_LIMITED',
            'Figma API の利用制限に達しました。しばらくしてから再試行してください。',
            details,
          );
        }
        retries429 += 1;
        await this.sleep(waitMs, this.signal);
        continue;
      }

      if (res.status >= 500 && retries5xx < 2) {
        const rem = this.remainingMs();
        const backoff = (2 ** retries5xx) * 1000;
        if (backoff <= rem) {
          retries5xx += 1;
          await this.sleep(backoff, this.signal);
          continue;
        }
      }

      if (!res.ok) {
        mapHttpError(res.status, context, rateLimitDetails(res));
      }

      return readJsonObject(res);
    }
  }

  /**
   * GET /v1/files/:key/nodes — FRAME のみ受理。
   */
  async getFrame(fileKey: string, nodeId: string): Promise<FigmaFrameInfo> {
    const path = `/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`;
    const json = await this.requestJson(path, 'nodes');
    const nodes = json.nodes;
    if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) {
      throw createFigmaError(
        'SPEC_FIGMA_RESPONSE_INVALID',
        'Figma API の応答が不正です。',
      );
    }
    const entry = (nodes as Record<string, unknown>)[nodeId];
    if (entry == null) {
      throw createFigmaError(
        'SPEC_FIGMA_NODE_NOT_FOUND',
        '指定の Frame / node が見つかりません。',
      );
    }
    if (typeof entry !== 'object' || Array.isArray(entry)) {
      throw createFigmaError(
        'SPEC_FIGMA_RESPONSE_INVALID',
        'Figma API の応答が不正です。',
      );
    }
    const document = (entry as JsonObject).document;
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw createFigmaError(
        'SPEC_FIGMA_RESPONSE_INVALID',
        'Figma API の応答が不正です。',
      );
    }
    const doc = document as JsonObject;
    if (doc.type !== 'FRAME') {
      throw createFigmaError(
        'SPEC_FIGMA_NODE_NOT_FRAME',
        '指定の node は Frame ではありません。',
      );
    }
    const frameName =
      typeof doc.name === 'string' && doc.name.trim()
        ? doc.name.trim()
        : 'Untitled';
    const size = extractFrameSize(doc);
    return {
      fileKey,
      nodeId,
      frameName,
      width: size.width,
      height: size.height,
    };
  }

  /**
   * GET /v1/images/:key — PNG 一時 URL（HTTPS）を返す。
   */
  async getPngExportUrl(
    fileKey: string,
    nodeId: string,
  ): Promise<FigmaExportImage> {
    const qs = new URLSearchParams({
      ids: nodeId,
      format: 'png',
      scale: String(FIGMA_DEFAULT_EXPORT_SCALE),
    });
    const path = `/v1/images/${encodeURIComponent(fileKey)}?${qs.toString()}`;
    const json = await this.requestJson(path, 'images');
    const images = json.images;
    if (!images || typeof images !== 'object' || Array.isArray(images)) {
      throw createFigmaError(
        'SPEC_FIGMA_RESPONSE_INVALID',
        'Figma API の応答が不正です。',
      );
    }
    const imageUrl = (images as Record<string, unknown>)[nodeId];
    if (imageUrl == null) {
      throw createFigmaError(
        'SPEC_FIGMA_EXPORT_FAILED',
        'Figma からの画像エクスポートに失敗しました。',
      );
    }
    if (typeof imageUrl !== 'string' || !isAbsoluteHttpsUrl(imageUrl)) {
      // URL 全文はログに出さない
      void maskUrlForLog(typeof imageUrl === 'string' ? imageUrl : '');
      throw createFigmaError(
        'SPEC_FIGMA_EXPORT_FAILED',
        'Figma からの画像エクスポートに失敗しました。',
      );
    }
    return {
      fileKey,
      nodeId,
      imageUrl,
      exportScale: FIGMA_DEFAULT_EXPORT_SCALE,
    };
  }
}

export function createFigmaApiClient(
  options: FigmaClientOptions,
): FigmaApiClient {
  return new FigmaApiClient(options);
}

/** テスト用に残 deadline 計算を公開 */
export function computeRemainingDeadlineMs(
  options: FigmaClientOptions,
  startedAt: number,
): number {
  return remainingDeadlineMs(options, startedAt);
}
