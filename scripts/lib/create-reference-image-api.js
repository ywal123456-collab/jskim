'use strict';

const { URL } = require('node:url');
const crypto = require('node:crypto');
const {
  parseMultipartContentType,
  parseMultipartFormData,
  readRawBody,
} = require('./parse-multipart-form-data');
const {
  parseFigmaImportBody,
  parseFigmaReimportBody,
  mapFigmaApiError,
  toFigmaSuccessResponse,
  assertNoSensitiveFigmaFields,
} = require('./figma-reference-image-api');

const REFERENCE_IMAGE_STATUS_PATH = '/_jskim/spec/reference-images/status';
const REFERENCE_IMAGE_PATH_RE =
  /^\/_jskim\/spec\/reference-images\/([^/]+)\/([^/]+)\/?$/;
const REFERENCE_IMAGE_FIGMA_PATH_RE =
  /^\/_jskim\/spec\/reference-images\/([^/]+)\/([^/]+)\/(figma:import|figma:reimport)\/?$/;

/** core の 20 MiB + multipart overhead */
const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_MULTIPART_BODY_BYTES = 21 * 1024 * 1024;
const MAX_JSON_BODY_BYTES = 256 * 1024;

const ALLOWED_VIEWPORTS = new Set(['pc', 'sp']);
const SCREEN_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 128;
const REVISION_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * Reference Image HTTP API（jskim spec dev 専用）。
 *
 * PUT    /_jskim/spec/reference-images/{screenId}/{viewport}
 * DELETE /_jskim/spec/reference-images/{screenId}/{viewport}
 * POST   /_jskim/spec/reference-images/{screenId}/{viewport}/figma:import
 * POST   /_jskim/spec/reference-images/{screenId}/{viewport}/figma:reimport
 * GET    /_jskim/spec/reference-images/status?screenId=&viewport=
 *
 * 保存は companion core（put/delete / Figma import）に委譲。API に別 queue は持たない。
 * 同一 key の重複は runtime registry で 409（upload / delete / Figma 共有）。
 *
 * @param {object} options
 */
function createReferenceImageApi(options) {
  const rootDir = options.rootDir;
  const projectName = options.projectName;
  const putReferenceImage = options.putReferenceImage;
  const deleteReferenceImage = options.deleteReferenceImage;
  const getReferenceImagePublicInfo = options.getReferenceImagePublicInfo;
  const loadScreenSpecProject = options.loadScreenSpecProject;
  const importFigmaReferenceImage = options.importFigmaReferenceImage;
  const reimportFigmaReferenceImage = options.reimportFigmaReferenceImage;
  const getPutHooks =
    typeof options.getPutHooks === 'function' ? options.getPutHooks : () => undefined;
  const getDeleteHooks =
    typeof options.getDeleteHooks === 'function'
      ? options.getDeleteHooks
      : () => undefined;
  const getFigmaHooks =
    typeof options.getFigmaHooks === 'function'
      ? options.getFigmaHooks
      : () => undefined;

  /** @type {Map<string, object>} */
  const runtimeByKey = new Map();
  /** @type {Set<string>} */
  const inProgressKeys = new Set();

  function listenHost() {
    return String(options.host || '127.0.0.1').trim();
  }

  function listenPort() {
    return Number(options.port);
  }

  function refKey(screenId, viewport) {
    return `${screenId}\0${viewport}`;
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {{ pathname: string, method: string }} meta
   * @returns {Promise<boolean>}
   */
  async function handleRequest(req, res, meta) {
    const pathname = normalizePathname(meta.pathname);
    const method = (meta.method || 'GET').toUpperCase();

    if (pathname === REFERENCE_IMAGE_STATUS_PATH) {
      if (method !== 'GET' && method !== 'HEAD') {
        sendJson(res, 405, {
          code: 'SPEC_REFERENCE_IMAGE_METHOD_NOT_ALLOWED',
          message: 'このHTTPメソッドは使用できません。',
        });
        return true;
      }
      return handleStatus(req, res, method);
    }

    const figmaMatch = pathname.match(REFERENCE_IMAGE_FIGMA_PATH_RE);
    if (figmaMatch) {
      let screenId;
      let viewport;
      try {
        screenId = decodeURIComponent(figmaMatch[1]);
        viewport = decodeURIComponent(figmaMatch[2]);
      } catch {
        sendJson(res, 400, {
          code: 'SPEC_REFERENCE_IMAGE_INVALID_PATH',
          message: 'パスが不正です。',
        });
        return true;
      }
      const action = figmaMatch[3];
      if (method !== 'POST') {
        sendJson(res, 405, {
          code: 'SPEC_REFERENCE_IMAGE_METHOD_NOT_ALLOWED',
          message: 'このHTTPメソッドは使用できません。',
        });
        return true;
      }
      if (action === 'figma:import') {
        return handleFigmaImport(req, res, screenId, viewport);
      }
      return handleFigmaReimport(req, res, screenId, viewport);
    }

    const pathMatch = pathname.match(REFERENCE_IMAGE_PATH_RE);
    if (!pathMatch) {
      return false;
    }

    let screenId;
    let viewport;
    try {
      screenId = decodeURIComponent(pathMatch[1]);
      viewport = decodeURIComponent(pathMatch[2]);
    } catch {
      sendJson(res, 400, {
        code: 'SPEC_REFERENCE_IMAGE_INVALID_PATH',
        message: 'パスが不正です。',
      });
      return true;
    }

    if (method === 'PUT') {
      return handlePut(req, res, screenId, viewport);
    }
    if (method === 'DELETE') {
      return handleDelete(req, res, screenId, viewport);
    }

    sendJson(res, 405, {
      code: 'SPEC_REFERENCE_IMAGE_METHOD_NOT_ALLOWED',
      message: 'このHTTPメソッドは使用できません。',
    });
    return true;
  }

  /**
   * Figma Import。read-only では API 自体が未登録（spec dev 以外）。
   */
  async function handleFigmaImport(req, res, screenId, viewport) {
    if (typeof importFigmaReferenceImage !== 'function') {
      sendJson(res, 500, {
        code: 'SPEC_REFERENCE_IMAGE_FAILED',
        message: 'Figma Import が利用できません。',
      });
      return true;
    }

    const body = await readSameOriginJsonBody(req, res);
    if (body === undefined) {
      return true;
    }

    const idCheck = parseScreenAndViewport(screenId, viewport);
    if (!idCheck.ok) {
      sendJson(res, 400, {
        code: idCheck.code,
        message: idCheck.message,
      });
      return true;
    }

    const resolved = resolveScreen(idCheck.screenId);
    if (!resolved.ok) {
      sendJson(res, resolved.statusCode, {
        code: resolved.code,
        message: resolved.message,
      });
      return true;
    }

    const parsed = parseFigmaImportBody(body);
    if (!parsed.ok) {
      sendJson(res, 400, {
        code: parsed.code,
        message: parsed.message,
      });
      return true;
    }

    return runFigmaMutation(req, res, {
      screenId: idCheck.screenId,
      viewport: idCheck.viewport,
      operation: 'import',
      run: async (signal) => {
        const hooks = getFigmaHooks({
          screenId: idCheck.screenId,
          viewport: idCheck.viewport,
          operation: 'import',
        }) || {};
        if (typeof hooks.awaitBarrier === 'function') {
          await hooks.awaitBarrier();
        }
        /** @type {Record<string, unknown>} */
        const opts = {
          rootDir,
          projectName,
          screenId: idCheck.screenId,
          viewport: idCheck.viewport,
          signal,
          env: hooks.env,
          fetchImpl: hooks.fetchImpl,
          sleep: hooks.sleep,
          nowMs: hooks.nowMs,
          nowIso: hooks.nowIso,
          apiBaseUrl: hooks.apiBaseUrl,
          operationDeadlineMs: hooks.operationDeadlineMs,
          requestTimeoutMs: hooks.requestTimeoutMs,
          downloadTimeoutMs: hooks.downloadTimeoutMs,
        };
        if (parsed.figmaUrl) {
          opts.figmaUrl = parsed.figmaUrl;
        } else {
          opts.fileKey = parsed.fileKey;
          opts.nodeId = parsed.nodeId;
        }
        if (parsed.hasExpected) {
          opts.expectedImageRevision = parsed.expectedImageRevision;
        }
        return importFigmaReferenceImage(opts);
      },
    });
  }

  async function handleFigmaReimport(req, res, screenId, viewport) {
    if (typeof reimportFigmaReferenceImage !== 'function') {
      sendJson(res, 500, {
        code: 'SPEC_REFERENCE_IMAGE_FAILED',
        message: 'Figma Reimport が利用できません。',
      });
      return true;
    }

    const body = await readSameOriginJsonBody(req, res);
    if (body === undefined) {
      return true;
    }

    const idCheck = parseScreenAndViewport(screenId, viewport);
    if (!idCheck.ok) {
      sendJson(res, 400, {
        code: idCheck.code,
        message: idCheck.message,
      });
      return true;
    }

    const resolved = resolveScreen(idCheck.screenId);
    if (!resolved.ok) {
      sendJson(res, resolved.statusCode, {
        code: resolved.code,
        message: resolved.message,
      });
      return true;
    }

    const parsed = parseFigmaReimportBody(body);
    if (!parsed.ok) {
      sendJson(res, 400, {
        code: parsed.code,
        message: parsed.message,
      });
      return true;
    }

    return runFigmaMutation(req, res, {
      screenId: idCheck.screenId,
      viewport: idCheck.viewport,
      operation: 'reimport',
      run: async (signal) => {
        const hooks = getFigmaHooks({
          screenId: idCheck.screenId,
          viewport: idCheck.viewport,
          operation: 'reimport',
        }) || {};
        if (typeof hooks.awaitBarrier === 'function') {
          await hooks.awaitBarrier();
        }
        return reimportFigmaReferenceImage({
          rootDir,
          projectName,
          screenId: idCheck.screenId,
          viewport: idCheck.viewport,
          expectedImageRevision: parsed.expectedImageRevision,
          signal,
          env: hooks.env,
          fetchImpl: hooks.fetchImpl,
          sleep: hooks.sleep,
          nowMs: hooks.nowMs,
          nowIso: hooks.nowIso,
          apiBaseUrl: hooks.apiBaseUrl,
          operationDeadlineMs: hooks.operationDeadlineMs,
          requestTimeoutMs: hooks.requestTimeoutMs,
          downloadTimeoutMs: hooks.downloadTimeoutMs,
        });
      },
    });
  }

  /**
   * 同一 target の in-progress 共有・Abort・成功 projection。
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {{ screenId: string, viewport: string, operation: 'import'|'reimport', run: (signal: AbortSignal) => Promise<object> }} args
   */
  async function runFigmaMutation(req, res, args) {
    const key = refKey(args.screenId, args.viewport);
    if (inProgressKeys.has(key)) {
      sendJson(res, 409, {
        code: 'SPEC_REFERENCE_IMAGE_IN_PROGRESS',
        message:
          '同じ参照画像を更新または削除しています。完了後に再度実行してください。',
      });
      return true;
    }

    const requestId = crypto.randomBytes(8).toString('hex');
    const startedAt = new Date().toISOString();
    inProgressKeys.add(key);
    runtimeByKey.set(key, {
      status: 'importing',
      requestId,
      startedAt,
      operation: args.operation,
    });

    const abortBridge = attachClientAbort(req, res);
    let responded = false;

    try {
      const result = await args.run(abortBridge.signal);
      if (abortBridge.signal.aborted || res.writableEnded) {
        runtimeByKey.set(key, { status: 'idle' });
        return true;
      }

      const payload = toFigmaSuccessResponse(
        args.screenId,
        args.viewport,
        result,
      );
      assertNoSensitiveFigmaFields(payload);
      runtimeByKey.set(key, { status: 'idle' });
      responded = true;
      sendJson(res, 200, payload);
    } catch (err) {
      if (
        abortBridge.signal.aborted ||
        (err &&
          (err.code === 'SPEC_FIGMA_ABORTED' ||
            err.name === 'AbortError')) ||
        res.writableEnded
      ) {
        runtimeByKey.set(key, { status: 'idle' });
        return true;
      }

      const mapped = mapFigmaApiError(err, mapReferenceError);
      runtimeByKey.set(key, {
        status: 'failed',
        operation: args.operation,
        failedAt: new Date().toISOString(),
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      });
      if (!res.writableEnded && !res.headersSent) {
        responded = true;
        /** @type {Record<string, unknown>} */
        const body = {
          code: mapped.code,
          message: mapped.message,
        };
        if (mapped.bodyExtra) {
          Object.assign(body, mapped.bodyExtra);
        }
        sendJson(res, mapped.statusCode, body, mapped.headers);
      }
    } finally {
      abortBridge.dispose(responded);
      inProgressKeys.delete(key);
    }

    return true;
  }

  async function handlePut(req, res, screenId, viewport) {
    if (!isSameOrigin(req, listenHost(), listenPort())) {
      sendJson(res, 403, {
        code: 'SPEC_REFERENCE_IMAGE_FORBIDDEN_ORIGIN',
        message: '同一 origin 以外からのリクエストは許可されていません。',
      });
      return true;
    }

    const idCheck = parseScreenAndViewport(screenId, viewport);
    if (!idCheck.ok) {
      sendJson(res, 400, {
        code: idCheck.code,
        message: idCheck.message,
      });
      return true;
    }

    const resolved = resolveScreen(idCheck.screenId);
    if (!resolved.ok) {
      sendJson(res, resolved.statusCode, {
        code: resolved.code,
        message: resolved.message,
      });
      return true;
    }

    const ct = parseMultipartContentType(req.headers['content-type']);
    if (!ct.ok) {
      sendJson(res, 415, {
        code: ct.code,
        message: ct.message,
      });
      return true;
    }

    let rawBody;
    try {
      rawBody = await readRawBody(req, MAX_MULTIPART_BODY_BYTES);
    } catch (err) {
      if (err && err.code === 'SPEC_REFERENCE_IMAGE_BODY_TOO_LARGE') {
        sendJson(res, 413, {
          code: err.code,
          message: '参照画像のアップロードサイズが上限を超えています。',
        });
        return true;
      }
      sendJson(res, 400, {
        code: 'SPEC_REFERENCE_IMAGE_MALFORMED_MULTIPART',
        message: 'multipart 本文の読み込みに失敗しました。',
      });
      return true;
    }

    const parsed = parseMultipartFormData(rawBody, ct.boundary);
    if (!parsed.ok) {
      sendJson(res, 400, {
        code: parsed.code,
        message: parsed.message,
      });
      return true;
    }

    const form = interpretReferenceUploadParts(parsed);
    if (!form.ok) {
      sendJson(res, form.statusCode || 400, {
        code: form.code,
        message: form.message,
      });
      return true;
    }

    const key = refKey(idCheck.screenId, idCheck.viewport);
    if (inProgressKeys.has(key)) {
      sendJson(res, 409, {
        code: 'SPEC_REFERENCE_IMAGE_IN_PROGRESS',
        message:
          '同じ参照画像を更新または削除しています。完了後に再度実行してください。',
      });
      return true;
    }

    const requestId = crypto.randomBytes(8).toString('hex');
    const startedAt = new Date().toISOString();
    inProgressKeys.add(key);
    runtimeByKey.set(key, {
      status: 'uploading',
      requestId,
      startedAt,
    });

    try {
      const hooks = getPutHooks({
        screenId: idCheck.screenId,
        viewport: idCheck.viewport,
      }) || {};
      if (typeof hooks.awaitBarrier === 'function') {
        await hooks.awaitBarrier();
      }

      const putOptions = {
        rootDir,
        projectName,
        screenId: idCheck.screenId,
        viewport: idCheck.viewport,
        imageBytes: form.imageBytes,
        hooks,
      };
      if (form.hasExpected) {
        putOptions.expectedImageRevision = form.expectedImageRevision;
      }

      const result = await putReferenceImage(putOptions);

      runtimeByKey.set(key, { status: 'idle' });

      const info = getReferenceImagePublicInfo({
        rootDir,
        projectName,
        screenId: idCheck.screenId,
        viewport: idCheck.viewport,
      });

      sendJson(res, 200, {
        screenId: idCheck.screenId,
        viewport: idCheck.viewport,
        result: result.result,
        referenceImage: toReferenceResponse(info),
      });
    } catch (err) {
      const mapped = mapReferenceError(err);
      runtimeByKey.set(key, {
        status: 'failed',
        operation: 'upload',
        failedAt: new Date().toISOString(),
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      });
      sendJson(res, mapped.statusCode, {
        code: mapped.code,
        message: mapped.message,
      });
    } finally {
      inProgressKeys.delete(key);
    }

    return true;
  }

  async function handleDelete(req, res, screenId, viewport) {
    const body = await readSameOriginJsonBody(req, res);
    if (body === undefined) {
      return true;
    }

    const idCheck = parseScreenAndViewport(screenId, viewport);
    if (!idCheck.ok) {
      sendJson(res, 400, {
        code: idCheck.code,
        message: idCheck.message,
      });
      return true;
    }

    const resolved = resolveScreen(idCheck.screenId);
    if (!resolved.ok) {
      sendJson(res, resolved.statusCode, {
        code: resolved.code,
        message: resolved.message,
      });
      return true;
    }

    const deleteBody = parseDeleteBody(body);
    if (!deleteBody.ok) {
      sendJson(res, 400, {
        code: deleteBody.code,
        message: deleteBody.message,
      });
      return true;
    }

    const key = refKey(idCheck.screenId, idCheck.viewport);
    if (inProgressKeys.has(key)) {
      sendJson(res, 409, {
        code: 'SPEC_REFERENCE_IMAGE_IN_PROGRESS',
        message:
          '同じ参照画像を更新または削除しています。完了後に再度実行してください。',
      });
      return true;
    }

    const requestId = crypto.randomBytes(8).toString('hex');
    const startedAt = new Date().toISOString();
    inProgressKeys.add(key);
    runtimeByKey.set(key, {
      status: 'deleting',
      requestId,
      startedAt,
    });

    try {
      const hooks = getDeleteHooks({
        screenId: idCheck.screenId,
        viewport: idCheck.viewport,
      }) || {};
      if (typeof hooks.awaitBarrier === 'function') {
        await hooks.awaitBarrier();
      }

      await deleteReferenceImage({
        rootDir,
        projectName,
        screenId: idCheck.screenId,
        viewport: idCheck.viewport,
        expectedImageRevision: deleteBody.expectedImageRevision,
        hooks,
      });

      runtimeByKey.set(key, { status: 'idle' });

      sendJson(res, 200, {
        screenId: idCheck.screenId,
        viewport: idCheck.viewport,
        result: 'deleted',
        deletedImageRevision: deleteBody.expectedImageRevision,
      });
    } catch (err) {
      const mapped = mapReferenceError(err);
      runtimeByKey.set(key, {
        status: 'failed',
        operation: 'delete',
        failedAt: new Date().toISOString(),
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      });
      sendJson(res, mapped.statusCode, {
        code: mapped.code,
        message: mapped.message,
      });
    } finally {
      inProgressKeys.delete(key);
    }

    return true;
  }

  async function handleStatus(req, res, method) {
    if (!isSameOrigin(req, listenHost(), listenPort())) {
      sendJson(res, 403, {
        code: 'SPEC_REFERENCE_IMAGE_FORBIDDEN_ORIGIN',
        message: '同一 origin 以外からのリクエストは許可されていません。',
      });
      return true;
    }

    let url;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch {
      sendJson(res, 400, {
        code: 'SPEC_REFERENCE_IMAGE_INVALID_QUERY',
        message: 'クエリが不正です。',
      });
      return true;
    }

    const screenId = url.searchParams.get('screenId');
    const viewport = url.searchParams.get('viewport');
    const idCheck = parseScreenAndViewport(screenId, viewport);
    if (!idCheck.ok) {
      sendJson(res, 400, {
        code: idCheck.code,
        message: idCheck.message,
      });
      return true;
    }

    const resolved = resolveScreen(idCheck.screenId);
    if (!resolved.ok) {
      sendJson(res, resolved.statusCode, {
        code: resolved.code,
        message: resolved.message,
      });
      return true;
    }

    const key = refKey(idCheck.screenId, idCheck.viewport);
    const runtime = runtimeByKey.get(key);
    const info = getReferenceImagePublicInfo({
      rootDir,
      projectName,
      screenId: idCheck.screenId,
      viewport: idCheck.viewport,
    });

    const payload = {
      screenId: idCheck.screenId,
      viewport: idCheck.viewport,
      runtime: toRuntimeResponse(runtime),
      referenceImage: toReferenceResponse(info),
    };

    if (method === 'HEAD') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return true;
    }

    sendJson(res, 200, payload);
    return true;
  }

  function resolveScreen(screenId) {
    let project;
    try {
      project = loadScreenSpecProject({ rootDir, projectName });
    } catch (err) {
      return {
        ok: false,
        statusCode: 500,
        code: 'SPEC_REFERENCE_IMAGE_FAILED',
        message: sanitizeErrorMessage(
          err && err.message ? err.message : '画面一覧の取得に失敗しました。',
        ),
      };
    }
    const screen = (project.screens || []).find((s) => s.screenId === screenId);
    if (!screen) {
      return {
        ok: false,
        statusCode: 404,
        code: 'SPEC_REFERENCE_IMAGE_SCREEN_NOT_FOUND',
        message: `画面が見つかりません: screenId=${screenId}`,
      };
    }
    return { ok: true, screen };
  }

  function getRuntimeForTest(screenId, viewport) {
    return runtimeByKey.get(refKey(screenId, viewport));
  }

  function resetRuntimeForTest() {
    runtimeByKey.clear();
    inProgressKeys.clear();
  }

  return {
    statusPath: REFERENCE_IMAGE_STATUS_PATH,
    handleRequest,
    maxMultipartBodyBytes: MAX_MULTIPART_BODY_BYTES,
    maxReferenceImageBytes: MAX_REFERENCE_IMAGE_BYTES,
    getRuntimeForTest,
    resetRuntimeForTest,
  };

  async function readSameOriginJsonBody(req, res) {
    if (!isSameOrigin(req, listenHost(), listenPort())) {
      sendJson(res, 403, {
        code: 'SPEC_REFERENCE_IMAGE_FORBIDDEN_ORIGIN',
        message: '同一 origin 以外からのリクエストは許可されていません。',
      });
      return undefined;
    }

    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.toLowerCase().includes('application/json')) {
      sendJson(res, 415, {
        code: 'SPEC_REFERENCE_IMAGE_UNSUPPORTED_MEDIA',
        message: 'Content-Type は application/json である必要があります。',
      });
      return undefined;
    }

    try {
      return await readJsonBody(req, MAX_JSON_BODY_BYTES);
    } catch (err) {
      if (err && err.code === 'SPEC_REFERENCE_IMAGE_BODY_TOO_LARGE') {
        sendJson(res, 413, {
          code: err.code,
          message: 'リクエスト本文が大きすぎます。',
        });
        return undefined;
      }
      sendJson(res, 400, {
        code: 'SPEC_REFERENCE_IMAGE_MALFORMED_JSON',
        message: 'リクエスト本文の JSON が不正です。',
      });
      return undefined;
    }
  }
}

function interpretReferenceUploadParts(parsed) {
  const allowedFieldNames = new Set(['expectedImageRevision']);
  const allowedFileNames = new Set(['image']);

  for (const field of parsed.fields) {
    if (!allowedFieldNames.has(field.name)) {
      return {
        ok: false,
        code: 'SPEC_REFERENCE_IMAGE_UNKNOWN_FIELD',
        message: `未知のフィールドがあります: ${field.name}`,
      };
    }
  }
  for (const file of parsed.files) {
    if (!allowedFileNames.has(file.name)) {
      return {
        ok: false,
        code: 'SPEC_REFERENCE_IMAGE_UNKNOWN_FIELD',
        message: `未知のフィールドがあります: ${file.name}`,
      };
    }
  }

  const imageFiles = parsed.files.filter((f) => f.name === 'image');
  if (imageFiles.length === 0) {
    // text の image は拒否
    if (parsed.fields.some((f) => f.name === 'image')) {
      return {
        ok: false,
        code: 'SPEC_REFERENCE_IMAGE_INVALID_MULTIPART',
        message: 'image はファイルフィールドである必要があります。',
      };
    }
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_MULTIPART',
      message: 'image フィールドが必要です。',
    };
  }
  if (imageFiles.length > 1) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_MULTIPART',
      message: 'image フィールドは 1 件だけ指定できます。',
    };
  }

  const expectedFields = parsed.fields.filter(
    (f) => f.name === 'expectedImageRevision',
  );
  if (expectedFields.length > 1) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_MULTIPART',
      message: 'expectedImageRevision は 1 件だけ指定できます。',
    };
  }
  if (parsed.files.some((f) => f.name === 'expectedImageRevision')) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_MULTIPART',
      message: 'expectedImageRevision はテキストフィールドである必要があります。',
    };
  }

  const image = imageFiles[0];
  if (!image.data || image.data.length === 0) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_PNG',
      message: '参照画像ファイルが空です。',
    };
  }
  if (image.data.length > MAX_REFERENCE_IMAGE_BYTES) {
    return {
      ok: false,
      statusCode: 413,
      code: 'SPEC_REFERENCE_IMAGE_FILE_TOO_LARGE',
      message: '参照画像のファイルサイズが上限を超えています。',
    };
  }

  if (image.contentType) {
    const mime = String(image.contentType).toLowerCase().split(';')[0].trim();
    if (mime && mime !== 'image/png') {
      return {
        ok: false,
        code: 'SPEC_REFERENCE_IMAGE_INVALID_PNG',
        message: '参照画像は PNG（image/png）のみ対応しています。',
      };
    }
  }

  let hasExpected = false;
  let expectedImageRevision = null;
  if (expectedFields.length === 1) {
    hasExpected = true;
    expectedImageRevision = expectedFields[0].value;
    if (typeof expectedImageRevision !== 'string' || !REVISION_RE.test(expectedImageRevision)) {
      return {
        ok: false,
        code: 'SPEC_REFERENCE_IMAGE_INVALID_REVISION',
        message: 'expectedImageRevision の形式が不正です。',
      };
    }
  }

  return {
    ok: true,
    imageBytes: image.data,
    hasExpected,
    expectedImageRevision,
  };
}

function parseDeleteBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_BODY',
      message: 'リクエスト本文が不正です。',
    };
  }
  const allowed = new Set(['expectedImageRevision']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        code: 'SPEC_REFERENCE_IMAGE_UNKNOWN_FIELD',
        message: `未知のフィールドがあります: ${key}`,
      };
    }
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'expectedImageRevision')) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_REVISION',
      message: 'expectedImageRevision は必須です。',
    };
  }
  const revision = body.expectedImageRevision;
  if (revision == null || revision === '') {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_REVISION',
      message: 'expectedImageRevision の形式が不正です。',
    };
  }
  if (typeof revision !== 'string' || !REVISION_RE.test(revision)) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_REVISION',
      message: 'expectedImageRevision の形式が不正です。',
    };
  }
  return { ok: true, expectedImageRevision: revision };
}

function parseScreenAndViewport(screenId, viewport) {
  if (typeof screenId !== 'string' || screenId.length === 0) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_SCREEN_ID',
      message: 'screenId が不正です。',
    };
  }
  if (
    screenId.length > MAX_ID_LENGTH ||
    !SCREEN_ID_RE.test(screenId) ||
    screenId.includes('..') ||
    screenId.includes('/') ||
    screenId.includes('\\') ||
    /^[a-z]+:\/\//i.test(screenId)
  ) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_SCREEN_ID',
      message: 'screenId が不正です。',
    };
  }

  if (typeof viewport !== 'string' || !ALLOWED_VIEWPORTS.has(viewport)) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_INVALID_VIEWPORT',
      message: 'viewport は pc または sp である必要があります。',
    };
  }

  return { ok: true, screenId, viewport };
}

function toReferenceResponse(info) {
  if (!info || info.status === 'missing') {
    return { status: 'missing' };
  }
  if (info.status === 'invalid') {
    return {
      status: 'invalid',
      diagnosticCode: 'SPEC_REFERENCE_IMAGE_INVALID',
    };
  }
  return {
    status: 'current',
    imageRevision: info.imageRevision,
    imageWidth: info.imageWidth,
    imageHeight: info.imageHeight,
    uploadedAt: info.uploadedAt,
  };
}

function toRuntimeResponse(runtime) {
  if (!runtime || runtime.status === 'idle') {
    return { status: 'idle' };
  }
  if (
    runtime.status === 'uploading' ||
    runtime.status === 'deleting' ||
    runtime.status === 'importing'
  ) {
    return {
      status: runtime.status,
      requestId: runtime.requestId,
      startedAt: runtime.startedAt,
    };
  }
  if (runtime.status === 'failed') {
    return {
      status: 'failed',
      operation: runtime.operation,
      failedAt: runtime.failedAt,
      error: runtime.error,
    };
  }
  return { status: 'idle' };
}

/**
 * client 切断時に AbortSignal を立てる。正常応答後は abort しない。
 * req の close は本文受信完了でも発火しうるため、res.close かつ未完了のみを見る。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function attachClientAbort(req, res) {
  const controller = new AbortController();
  let disposed = false;

  function onClientGone() {
    if (disposed || res.writableEnded) {
      return;
    }
    if (!controller.signal.aborted) {
      controller.abort();
    }
  }

  req.on('aborted', onClientGone);
  res.on('close', onClientGone);

  return {
    signal: controller.signal,
    /**
     * @param {boolean} [_responded]
     */
    dispose(_responded) {
      if (disposed) {
        return;
      }
      disposed = true;
      req.off('aborted', onClientGone);
      res.off('close', onClientGone);
    },
  };
}

function mapReferenceError(err) {
  const code =
    (err && err.code) ||
    (err && err.name === 'ReferenceImageError' && err.code) ||
    'SPEC_REFERENCE_IMAGE_FAILED';
  const message =
    err && err.message
      ? sanitizeErrorMessage(err.message)
      : '参照画像の処理に失敗しました。';

  if (
    code === 'SPEC_REFERENCE_IMAGE_REVISION_CONFLICT' ||
    code === 'SPEC_REFERENCE_IMAGE_INVALID' ||
    code === 'SPEC_REFERENCE_IMAGE_IN_PROGRESS'
  ) {
    return { statusCode: 409, code, message };
  }
  if (
    code === 'SPEC_REFERENCE_IMAGE_SCREEN_NOT_FOUND' ||
    code === 'SPEC_REFERENCE_IMAGE_NOT_FOUND'
  ) {
    return { statusCode: 404, code, message };
  }
  if (
    code === 'SPEC_REFERENCE_IMAGE_INVALID_VIEWPORT' ||
    code === 'SPEC_REFERENCE_IMAGE_INVALID_PNG' ||
    code === 'SPEC_REFERENCE_IMAGE_INVALID_REVISION'
  ) {
    return { statusCode: 400, code, message };
  }
  if (
    code === 'SPEC_REFERENCE_IMAGE_FILE_TOO_LARGE' ||
    code === 'SPEC_REFERENCE_IMAGE_BODY_TOO_LARGE'
  ) {
    return { statusCode: 413, code, message };
  }
  if (code === 'SPEC_REFERENCE_IMAGE_DIMENSION_LIMIT') {
    return { statusCode: 400, code, message };
  }
  if (code === 'SPEC_REFERENCE_IMAGE_WRITE_FAILED') {
    return { statusCode: 500, code, message };
  }

  return {
    statusCode: 500,
    code: code.startsWith('SPEC_REFERENCE_IMAGE_')
      ? code
      : 'SPEC_REFERENCE_IMAGE_FAILED',
    message,
  };
}

function sanitizeErrorMessage(message) {
  return String(message)
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .replace(/\/(?:Users|home|tmp|var)\/[^\s]+/g, '[path]');
}

function normalizePathname(pathname) {
  return String(pathname || '/').replace(/\\/g, '/');
}

function isSameOrigin(req, listenHost, listenPort) {
  const origin = req.headers.origin;
  if (!origin) {
    const hostHeader = String(req.headers.host || '');
    return hostMatches(hostHeader, listenHost, listenPort);
  }

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const hostHeader = String(req.headers.host || '');
  if (!hostMatches(hostHeader, listenHost, listenPort)) {
    return false;
  }

  const originHost = originUrl.hostname;
  const originPort =
    originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80');

  const expectedHosts = expandHostAliases(listenHost);
  if (!expectedHosts.has(originHost.toLowerCase())) {
    return false;
  }

  if (Number(originPort) !== Number(listenPort)) {
    const hostPort = hostHeader.includes(':')
      ? hostHeader.split(':').pop()
      : String(listenPort);
    if (Number(hostPort) !== Number(originPort)) {
      return false;
    }
  }

  return true;
}

function hostMatches(hostHeader, listenHost, listenPort) {
  const raw = String(hostHeader || '').trim().toLowerCase();
  if (!raw) {
    return false;
  }
  const expected = expandHostAliases(listenHost);
  let hostname = raw;
  let port = String(listenPort);
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    hostname = raw.slice(1, end);
    const rest = raw.slice(end + 1);
    if (rest.startsWith(':')) {
      port = rest.slice(1);
    }
  } else if (raw.includes(':')) {
    const parts = raw.split(':');
    hostname = parts[0];
    port = parts[1];
  }
  if (!expected.has(hostname)) {
    return false;
  }
  return Number(port) === Number(listenPort);
}

function expandHostAliases(listenHost) {
  const host = String(listenHost || '').toLowerCase();
  const set = new Set([host]);
  if (host === '0.0.0.0' || host === '::' || host === '::0') {
    set.add('127.0.0.1');
    set.add('localhost');
  }
  if (host === '127.0.0.1') {
    set.add('localhost');
  }
  if (host === 'localhost') {
    set.add('127.0.0.1');
  }
  return set;
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    let settled = false;

    function fail(err) {
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    }

    function succeed(value) {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    }

    req.on('data', (chunk) => {
      if (tooLarge) {
        return;
      }
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        const err = new Error('body too large');
        err.code = 'SPEC_REFERENCE_IMAGE_BODY_TOO_LARGE';
        fail(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge || settled) {
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        succeed(JSON.parse(text));
      } catch (err) {
        fail(err);
      }
    });
    req.on('error', fail);
  });
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {object} body
 * @param {Record<string, string>|undefined} [headers]
 */
function sendJson(res, statusCode, body, headers) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(payload.length));
  res.setHeader('Cache-Control', 'no-store');
  if (headers && typeof headers === 'object') {
    for (const [name, value] of Object.entries(headers)) {
      if (
        typeof name === 'string' &&
        typeof value === 'string' &&
        /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) &&
        !/[\r\n]/.test(value)
      ) {
        res.setHeader(name, value);
      }
    }
  }
  res.end(payload);
}

module.exports = {
  createReferenceImageApi,
  REFERENCE_IMAGE_STATUS_PATH,
  MAX_MULTIPART_BODY_BYTES,
  MAX_REFERENCE_IMAGE_BYTES,
};
