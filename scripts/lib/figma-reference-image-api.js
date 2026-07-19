'use strict';

/**
 * Figma Frame Import / Reimport の request 検証と HTTP エラー変換。
 * create-reference-image-api.js から利用する（core は companion に委譲）。
 */

const REVISION_RE = /^sha256:[0-9a-f]{64}$/;
const FIGMA_HOSTS = new Set(['figma.com', 'www.figma.com']);

/**
 * Import body を検証する。
 * 許可: figmaUrl または fileKey+nodeId、任意 expectedImageRevision。
 * token / URL 別名 / source / frameName 等は拒否。
 *
 * @param {unknown} body
 */
function parseFigmaImportBody(body) {
  if (body == null) {
    return {
      ok: false,
      code: 'SPEC_FIGMA_INPUT_INVALID',
      message: 'リクエスト本文がありません。',
    };
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      code: 'SPEC_FIGMA_INPUT_INVALID',
      message: 'リクエスト本文が不正です。',
    };
  }

  const obj = /** @type {Record<string, unknown>} */ (body);
  const keys = Object.keys(obj);

  if (
    Object.prototype.hasOwnProperty.call(obj, 'token') ||
    Object.prototype.hasOwnProperty.call(obj, 'JSKIM_FIGMA_TOKEN') ||
    Object.prototype.hasOwnProperty.call(obj, 'accessToken') ||
    Object.prototype.hasOwnProperty.call(obj, 'authorization')
  ) {
    return {
      ok: false,
      code: 'SPEC_FIGMA_INPUT_INVALID',
      message:
        'トークンをリクエストに含めることはできません。環境変数 JSKIM_FIGMA_TOKEN を使用してください。',
    };
  }

  const allowed = new Set([
    'figmaUrl',
    'fileKey',
    'nodeId',
    'expectedImageRevision',
  ]);
  for (const key of keys) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        code: 'SPEC_FIGMA_INPUT_INVALID',
        message: `未知のフィールドがあります: ${key}`,
      };
    }
  }

  const hasUrl = Object.prototype.hasOwnProperty.call(obj, 'figmaUrl');
  const hasFileKey = Object.prototype.hasOwnProperty.call(obj, 'fileKey');
  const hasNodeId = Object.prototype.hasOwnProperty.call(obj, 'nodeId');
  const hasDirect = hasFileKey || hasNodeId;

  if (hasUrl && hasDirect) {
    return {
      ok: false,
      code: 'SPEC_FIGMA_INPUT_INVALID',
      message: 'Figma URL と fileKey/nodeId を同時に指定できません。',
    };
  }
  if (!hasUrl && !hasDirect) {
    return {
      ok: false,
      code: 'SPEC_FIGMA_INPUT_INVALID',
      message: 'Figma URL または fileKey と nodeId が必要です。',
    };
  }
  if (hasDirect && (!hasFileKey || !hasNodeId)) {
    return {
      ok: false,
      code: 'SPEC_FIGMA_INPUT_INVALID',
      message: 'fileKey と nodeId は両方必要です。',
    };
  }

  /** @type {{ figmaUrl?: string, fileKey?: string, nodeId?: string, expectedImageRevision?: string|null, hasExpected: boolean }} */
  const out = { hasExpected: false };

  if (hasUrl) {
    if (typeof obj.figmaUrl !== 'string' || !obj.figmaUrl.trim()) {
      return {
        ok: false,
        code: 'SPEC_FIGMA_INPUT_INVALID',
        message: 'Figma URL が不正です。',
      };
    }
    out.figmaUrl = obj.figmaUrl.trim();
  } else {
    if (typeof obj.fileKey !== 'string' || typeof obj.nodeId !== 'string') {
      return {
        ok: false,
        code: 'SPEC_FIGMA_INPUT_INVALID',
        message: 'fileKey と nodeId が不正です。',
      };
    }
    out.fileKey = obj.fileKey;
    out.nodeId = obj.nodeId;
  }

  if (Object.prototype.hasOwnProperty.call(obj, 'expectedImageRevision')) {
    const revision = obj.expectedImageRevision;
    if (revision === null) {
      out.hasExpected = true;
      out.expectedImageRevision = null;
    } else if (typeof revision === 'string' && REVISION_RE.test(revision)) {
      out.hasExpected = true;
      out.expectedImageRevision = revision;
    } else {
      return {
        ok: false,
        code: 'SPEC_REFERENCE_IMAGE_INVALID_REVISION',
        message: 'expectedImageRevision の形式が不正です。',
      };
    }
  }

  return { ok: true, ...out };
}

/**
 * Reimport body（expectedImageRevision のみ）。
 * @param {unknown} body
 */
function parseFigmaReimportBody(body) {
  if (body == null) {
    return {
      ok: false,
      code: 'SPEC_FIGMA_INPUT_INVALID',
      message: 'リクエスト本文がありません。',
    };
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      code: 'SPEC_FIGMA_INPUT_INVALID',
      message: 'リクエスト本文が不正です。',
    };
  }

  const obj = /** @type {Record<string, unknown>} */ (body);

  if (
    Object.prototype.hasOwnProperty.call(obj, 'token') ||
    Object.prototype.hasOwnProperty.call(obj, 'JSKIM_FIGMA_TOKEN') ||
    Object.prototype.hasOwnProperty.call(obj, 'figmaUrl') ||
    Object.prototype.hasOwnProperty.call(obj, 'fileKey') ||
    Object.prototype.hasOwnProperty.call(obj, 'nodeId') ||
    Object.prototype.hasOwnProperty.call(obj, 'frameName') ||
    Object.prototype.hasOwnProperty.call(obj, 'exportScale') ||
    Object.prototype.hasOwnProperty.call(obj, 'url')
  ) {
    return {
      ok: false,
      code: 'SPEC_FIGMA_INPUT_INVALID',
      message:
        'Reimport では Figma 入力やトークンを指定できません。expectedImageRevision のみ指定してください。',
    };
  }

  const allowed = new Set(['expectedImageRevision']);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        code: 'SPEC_FIGMA_INPUT_INVALID',
        message: `未知のフィールドがあります: ${key}`,
      };
    }
  }

  if (!Object.prototype.hasOwnProperty.call(obj, 'expectedImageRevision')) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_REVISION',
      message: 'expectedImageRevision は必須です。',
    };
  }
  const revision = obj.expectedImageRevision;
  if (typeof revision !== 'string' || !REVISION_RE.test(revision)) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_REVISION',
      message: 'expectedImageRevision の形式が不正です。',
    };
  }
  return { ok: true, expectedImageRevision: revision };
}

/**
 * @param {string|null|undefined} value
 * @returns {string|undefined}
 */
function sanitizeUpgradeLink(value) {
  if (value == null || typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/[\r\n\0]/.test(trimmed)) {
    return undefined;
  }
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:') {
    return undefined;
  }
  if (u.username || u.password) {
    return undefined;
  }
  if (!FIGMA_HOSTS.has(u.hostname)) {
    return undefined;
  }
  const out = u.toString();
  if (/[\r\n\0]/.test(out)) {
    return undefined;
  }
  return out;
}

/**
 * @param {unknown} value
 * @returns {number|undefined}
 */
function sanitizeRetryAfterSeconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const n = Math.floor(value);
  if (n < 0 || n > 86400 * 30) {
    return undefined;
  }
  return n;
}

/**
 * @param {unknown} value
 * @returns {string|undefined}
 */
function sanitizePlanEnum(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const v = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(v)) {
    return undefined;
  }
  return v;
}

/**
 * FigmaError / ReferenceImageError を HTTP へ変換する。
 * @param {any} err
 * @param {(err: any) => { statusCode: number, code: string, message: string }} mapReferenceError
 */
function mapFigmaApiError(err, mapReferenceError) {
  const code = err && err.code ? String(err.code) : '';
  const details = err && err.details && typeof err.details === 'object'
    ? err.details
    : undefined;

  if (code.startsWith('SPEC_REFERENCE_IMAGE_')) {
    const mapped = mapReferenceError(err);
    return {
      statusCode: mapped.statusCode,
      code: mapped.code,
      message: sanitizeFigmaErrorMessage(mapped.message),
      bodyExtra: undefined,
      headers: undefined,
    };
  }

  const message =
    err && err.message
      ? sanitizeFigmaErrorMessage(err.message)
      : 'Figma 参照画像の処理に失敗しました。';

  /** @type {Record<string, string>} */
  const headers = {};
  /** @type {Record<string, unknown>} */
  const bodyExtra = {};

  if (code === 'SPEC_FIGMA_RATE_LIMITED') {
    const retryAfter = sanitizeRetryAfterSeconds(
      details && details.retryAfterSeconds,
    );
    if (retryAfter !== undefined) {
      headers['Retry-After'] = String(retryAfter);
      bodyExtra.retryAfterSeconds = retryAfter;
    }
    const planTier = sanitizePlanEnum(details && details.planTier);
    if (planTier) {
      bodyExtra.planTier = planTier;
    }
    const rateLimitType = sanitizePlanEnum(details && details.rateLimitType);
    if (rateLimitType) {
      bodyExtra.rateLimitType = rateLimitType;
    }
    const upgradeLink = sanitizeUpgradeLink(details && details.upgradeLink);
    if (upgradeLink) {
      bodyExtra.upgradeLink = upgradeLink;
    }
    return {
      statusCode: 429,
      code,
      message,
      bodyExtra,
      headers,
    };
  }

  const table = {
    SPEC_FIGMA_INPUT_INVALID: 400,
    SPEC_FIGMA_NODE_NOT_FRAME: 400,
    SPEC_FIGMA_SOURCE_MISSING: 400,
    SPEC_FIGMA_TOKEN_MISSING: 500,
    SPEC_FIGMA_UNAUTHORIZED: 401,
    SPEC_FIGMA_FORBIDDEN: 403,
    SPEC_FIGMA_FILE_NOT_FOUND: 404,
    SPEC_FIGMA_NODE_NOT_FOUND: 404,
    SPEC_FIGMA_IMAGE_TOO_LARGE: 413,
    SPEC_FIGMA_TIMEOUT: 504,
    SPEC_FIGMA_EXPORT_FAILED: 502,
    SPEC_FIGMA_DOWNLOAD_FAILED: 502,
    SPEC_FIGMA_RESPONSE_INVALID: 502,
    SPEC_FIGMA_ABORTED: 400,
  };

  if (Object.prototype.hasOwnProperty.call(table, code)) {
    return {
      statusCode: table[code],
      code,
      message,
      bodyExtra: undefined,
      headers: undefined,
    };
  }

  if (err && err.name === 'FigmaError') {
    return {
      statusCode: 502,
      code: code || 'SPEC_FIGMA_RESPONSE_INVALID',
      message,
      bodyExtra: undefined,
      headers: undefined,
    };
  }

  return {
    ...mapReferenceError(err),
    bodyExtra: undefined,
    headers: undefined,
  };
}

/**
 * Import/Reimport 成功時の browser-safe projection。
 * @param {object} result companion ImportFigmaReferenceImageResult
 */
function toFigmaSuccessResponse(screenId, viewport, result) {
  /** @type {object} */
  const payload = {
    screenId,
    viewport,
    result: result.result,
    referenceImage: {
      status: 'current',
      imageRevision: result.imageRevision,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
      uploadedAt: result.uploadedAt,
    },
    frame: {
      frameName: result.frame.frameName,
      width: result.frame.width,
      height: result.frame.height,
    },
    source: {
      type: 'figma',
      frameName: result.frame.frameName,
      importedAt: result.uploadedAt,
    },
  };

  if (result.sizeMismatch) {
    payload.warnings = [
      {
        code: result.sizeMismatch.code || 'SPEC_FIGMA_VIEWPORT_SIZE_MISMATCH',
        message: result.sizeMismatch.message,
        frameWidth: result.sizeMismatch.frameWidth,
        frameHeight: result.sizeMismatch.frameHeight,
        viewportWidth: result.sizeMismatch.viewportWidth,
        viewportHeight: result.sizeMismatch.viewportHeight,
      },
    ];
  }

  return payload;
}

/**
 * @param {unknown} message
 * @returns {string}
 */
function sanitizeFigmaErrorMessage(message) {
  return String(message)
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .replace(/\/(?:Users|home|tmp|var)\/[^\s]+/g, '[path]')
    .replace(/\b(?:token|authorization|x-figma-token)\s*[:=]\s*[^\s]+/gi, '[redacted]')
    .replace(/\bfileKey\s*[:=]\s*[^\s]+/gi, '[redacted]')
    .replace(/\bnodeId\s*[:=]\s*[^\s]+/gi, '[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[url]');
}

/**
 * 成功 JSON に秘密情報が含まれないことを検証用に検査する。
 * @param {object} payload
 */
function assertNoSensitiveFigmaFields(payload) {
  const text = JSON.stringify(payload);
  if (
    /"fileKey"\s*:/.test(text) ||
    /"nodeId"\s*:/.test(text) ||
    /"token"\s*:/.test(text) ||
    /X-Figma-Token/i.test(text)
  ) {
    throw new Error('Figma success payload に秘密フィールドが含まれています。');
  }
}

module.exports = {
  parseFigmaImportBody,
  parseFigmaReimportBody,
  mapFigmaApiError,
  toFigmaSuccessResponse,
  assertNoSensitiveFigmaFields,
  sanitizeUpgradeLink,
  sanitizeRetryAfterSeconds,
};
