'use strict';

const { URL } = require('node:url');

const DESCRIPTION_TREE_API_PREFIX = '/_jskim/spec/description-tree';
const MAX_BODY_BYTES = 256 * 1024;

const CREATE_GROUP_KEYS = new Set([
  'expectedRevision',
  'groupId',
  'name',
  'description',
  'kind',
  'parentGroupId',
  'insertIndex',
]);

const UPDATE_GROUP_KEYS = new Set([
  'expectedRevision',
  'name',
  'description',
  'kind',
]);

const UPDATE_GROUP_FORBIDDEN_KEYS = new Set([
  'groupId',
  'children',
  'parentGroupId',
  'insertIndex',
  'position',
]);

const MOVE_NODE_KEYS = new Set([
  'expectedRevision',
  'node',
  'destinationParentGroupId',
  'insertIndex',
]);

const REORDER_CHILDREN_KEYS = new Set([
  'expectedRevision',
  'parentGroupId',
  'orderedNodes',
]);

const CREATE_ITEM_KEYS = new Set([
  'expectedRevision',
  'itemId',
  'name',
  'type',
  'description',
  'note',
  'parentGroupId',
  'insertIndex',
]);

const UPDATE_ITEM_KEYS = new Set([
  'expectedRevision',
  'name',
  'type',
  'description',
  'note',
]);

const UPDATE_ITEM_FORBIDDEN_KEYS = new Set([
  'itemId',
  'parentGroupId',
  'insertIndex',
  'position',
  'parent',
]);

const REVISION_ONLY_KEYS = new Set(['expectedRevision']);

const SPEC_NODE_REF_KEYS = new Set(['type', 'id']);

/**
 * Description Item Tree API（jskim spec dev 専用）。
 *
 * GET  /_jskim/spec/description-tree/:screenId
 * POST /_jskim/spec/description-tree/:screenId/groups
 * PATCH /_jskim/spec/description-tree/:screenId/groups/:groupId
 * POST /_jskim/spec/description-tree/:screenId/items
 * PATCH /_jskim/spec/description-tree/:screenId/items/:itemId
 * POST /_jskim/spec/description-tree/:screenId/nodes/move
 * POST /_jskim/spec/description-tree/:screenId/children/reorder
 * POST /_jskim/spec/description-tree/:screenId/groups/:groupId/delete
 * POST /_jskim/spec/description-tree/:screenId/groups/:groupId/delete-subtree
 *
 * @param {object} options
 * @param {string} options.rootDir
 * @param {string} options.projectName
 * @param {string} [options.host]
 * @param {number|string} [options.port]
 * @param {() => string[]} options.listScreenIds
 * @param {object} options.facade
 */
function createDescriptionTreeApi(options) {
  const rootDir = options.rootDir;
  const projectName = options.projectName;
  const listScreenIds = options.listScreenIds;
  const facade = options.facade;

  const required = [
    'readDescriptionTreeState',
    'readDescriptionRevision',
    'createDescriptionGroup',
    'updateDescriptionGroup',
    'moveDescriptionNode',
    'reorderDescriptionChildren',
    'deleteDescriptionGroup',
    'deleteDescriptionGroupSubtree',
    'createDescriptionItem',
    'updateDescriptionItem',
    'collectCollectedItemIdsForScreen',
    'formatDescriptionTreeForApi',
  ];
  for (const name of required) {
    if (typeof facade[name] !== 'function') {
      throw new Error(`createDescriptionTreeApi: facade.${name} が必要です。`);
    }
  }

  function listenHost() {
    return String(options.host || '127.0.0.1').trim();
  }

  function listenPort() {
    return Number(options.port);
  }

  function ctx(screenId) {
    return { rootDir, projectName, screenId };
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {{ pathname: string, method: string }} meta
   * @returns {Promise<boolean>}
   */
  async function handleRequest(req, res, meta) {
    const pathname = normalizePathname(meta.pathname);
    if (!pathname.startsWith(DESCRIPTION_TREE_API_PREFIX)) {
      return false;
    }

    const method = (meta.method || req.method || 'GET').toUpperCase();
    const route = parseDescriptionTreePath(pathname);
    if (!route || route.kind === 'invalid') {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID_SCREEN_ID',
        message: '画面 ID が不正です。',
      });
      return true;
    }
    if (route.kind === 'not-found') {
      sendJson(res, 404, {
        code: 'SPEC_DESCRIPTION_TREE_ROUTE_NOT_FOUND',
        message: 'Description Item Tree API の経路が見つかりません。',
      });
      return true;
    }

    if (!assertKnownScreen(res, route.screenId)) {
      return true;
    }

    if (route.kind === 'tree') {
      if (method === 'GET' || method === 'HEAD') {
        return handleGetTree(res, method, route.screenId);
      }
      return sendMethodNotAllowed(res, 'GET, HEAD');
    }

    if (route.kind === 'groups') {
      if (method === 'POST') {
        return handleCreateGroup(req, res, route.screenId);
      }
      return sendMethodNotAllowed(res, 'POST');
    }

    if (route.kind === 'group') {
      if (method === 'PATCH') {
        return handleUpdateGroup(req, res, route.screenId, route.groupId);
      }
      return sendMethodNotAllowed(res, 'PATCH');
    }

    if (route.kind === 'items') {
      if (method === 'POST') {
        return handleCreateItem(req, res, route.screenId);
      }
      return sendMethodNotAllowed(res, 'POST');
    }

    if (route.kind === 'item') {
      if (method === 'PATCH') {
        return handleUpdateItem(req, res, route.screenId, route.itemId);
      }
      return sendMethodNotAllowed(res, 'PATCH');
    }

    if (route.kind === 'move-node') {
      if (method === 'POST') {
        return handleMoveNode(req, res, route.screenId);
      }
      return sendMethodNotAllowed(res, 'POST');
    }

    if (route.kind === 'reorder-children') {
      if (method === 'POST') {
        return handleReorderChildren(req, res, route.screenId);
      }
      return sendMethodNotAllowed(res, 'POST');
    }

    if (route.kind === 'group-delete') {
      if (method === 'POST') {
        return handleDeleteGroup(req, res, route.screenId, route.groupId);
      }
      return sendMethodNotAllowed(res, 'POST');
    }

    if (route.kind === 'group-delete-subtree') {
      if (method === 'POST') {
        return handleDeleteGroupSubtree(req, res, route.screenId, route.groupId);
      }
      return sendMethodNotAllowed(res, 'POST');
    }

    sendJson(res, 404, {
      code: 'SPEC_DESCRIPTION_TREE_ROUTE_NOT_FOUND',
      message: 'Description Item Tree API の経路が見つかりません。',
    });
    return true;
  }

  function assertKnownScreen(res, screenId) {
    const known = new Set(listScreenIds());
    if (!known.has(screenId)) {
      sendJson(res, 404, {
        code: 'SPEC_DESCRIPTION_SCREEN_NOT_FOUND',
        message: `画面「${screenId}」は登録されていません。`,
      });
      return false;
    }
    return true;
  }

  function handleGetTree(res, method, screenId) {
    try {
      const revision = facade.readDescriptionRevision(
        rootDir,
        projectName,
        screenId,
      );
      if (revision === null) {
        sendJson(res, 404, {
          code: 'SPEC_DESCRIPTION_NOT_FOUND',
          message: `画面「${screenId}」の Description JSON が存在しません。`,
        });
        return true;
      }

      const collectedOrder = facade.collectCollectedItemIdsForScreen(
        ctx(screenId),
      );
      const state = facade.readDescriptionTreeState(ctx(screenId), {
        collectedOrder,
      });
      if ('error' in state) {
        sendDescriptionTreeError(res, state.error);
        return true;
      }

      if (method === 'HEAD') {
        sendHeadJson(res, 200);
        return true;
      }

      sendJson(res, 200, {
        revision,
        sourceSchemaVersion: state.normalized.sourceSchemaVersion,
        description: facade.formatDescriptionTreeForApi(state.normalized),
      });
    } catch (err) {
      sendDescriptionTreeError(res, err);
    }
    return true;
  }

  async function handleCreateGroup(req, res, screenId) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) {
      return true;
    }

    if (!assertAllowedKeys(res, body, CREATE_GROUP_KEYS)) {
      return true;
    }
    if (!assertExpectedRevisionField(res, body)) {
      return true;
    }

    try {
      const collectedOrder = facade.collectCollectedItemIdsForScreen(
        ctx(screenId),
      );
      const input = {
        expectedRevision: body.expectedRevision,
        groupId: body.groupId,
        name: body.name,
        kind: body.kind,
      };
      if (Object.prototype.hasOwnProperty.call(body, 'description')) {
        input.description = body.description;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'parentGroupId')) {
        input.parentGroupId =
          body.parentGroupId === null ? undefined : body.parentGroupId;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'insertIndex')) {
        input.insertIndex = body.insertIndex;
      }

      const result = await facade.createDescriptionGroup(ctx(screenId), {
        ...input,
        collectedOrder,
      });
      sendJson(res, 201, {
        status: result.status,
        revision: result.revision,
      });
    } catch (err) {
      sendDescriptionTreeError(res, err);
    }
    return true;
  }

  async function handleCreateItem(req, res, screenId) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) {
      return true;
    }

    if (!assertAllowedKeys(res, body, CREATE_ITEM_KEYS)) {
      return true;
    }
    if (!assertExpectedRevisionField(res, body)) {
      return true;
    }
    if (!assertRequiredField(res, body, 'itemId')) {
      return true;
    }
    if (!assertRequiredField(res, body, 'name')) {
      return true;
    }
    if (!assertRequiredField(res, body, 'type')) {
      return true;
    }
    if (!assertRequiredField(res, body, 'description')) {
      return true;
    }
    if (!assertRequiredField(res, body, 'note')) {
      return true;
    }
    for (const field of ['itemId', 'name', 'type', 'description', 'note']) {
      if (typeof body[field] !== 'string') {
        sendJson(res, 400, {
          code: 'SPEC_DESCRIPTION_INVALID',
          message: `${field} は文字列である必要があります。`,
        });
        return true;
      }
    }
    if (
      Object.prototype.hasOwnProperty.call(body, 'parentGroupId') &&
      body.parentGroupId !== null &&
      typeof body.parentGroupId !== 'string'
    ) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'parentGroupId の形式が不正です。',
      });
      return true;
    }
    if (
      Object.prototype.hasOwnProperty.call(body, 'insertIndex') &&
      typeof body.insertIndex !== 'number'
    ) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'insertIndex の形式が不正です。',
      });
      return true;
    }

    try {
      const collectedOrder = facade.collectCollectedItemIdsForScreen(
        ctx(screenId),
      );
      const input = {
        expectedRevision: body.expectedRevision,
        itemId: body.itemId,
        name: body.name,
        type: body.type,
        description: body.description,
        note: body.note,
      };
      if (Object.prototype.hasOwnProperty.call(body, 'parentGroupId')) {
        input.parentGroupId = body.parentGroupId;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'insertIndex')) {
        input.insertIndex = body.insertIndex;
      }

      const result = await facade.createDescriptionItem(ctx(screenId), {
        ...input,
        collectedOrder,
      });
      sendJson(res, 201, {
        status: result.status,
        revision: result.revision,
      });
    } catch (err) {
      sendDescriptionTreeError(res, err);
    }
    return true;
  }

  async function handleUpdateItem(req, res, screenId, itemId) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) {
      return true;
    }

    const forbidden = Object.keys(body).find((key) =>
      UPDATE_ITEM_FORBIDDEN_KEYS.has(key),
    );
    if (forbidden) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `許可されていないフィールドです: ${forbidden}`,
      });
      return true;
    }

    if (!assertAllowedKeys(res, body, UPDATE_ITEM_KEYS)) {
      return true;
    }
    if (!assertExpectedRevisionField(res, body)) {
      return true;
    }

    if (
      body.name === undefined &&
      body.type === undefined &&
      body.description === undefined &&
      body.note === undefined
    ) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'updateItem には name / type / description / note のいずれかが必要です。',
      });
      return true;
    }

    try {
      const collectedOrder = facade.collectCollectedItemIdsForScreen(
        ctx(screenId),
      );
      const input = {
        expectedRevision: body.expectedRevision,
        itemId,
      };
      if (body.name !== undefined) {
        input.name = body.name;
      }
      if (body.type !== undefined) {
        input.type = body.type;
      }
      if (body.description !== undefined) {
        input.description = body.description;
      }
      if (body.note !== undefined) {
        input.note = body.note;
      }

      const result = await facade.updateDescriptionItem(ctx(screenId), {
        ...input,
        collectedOrder,
      });
      sendJson(res, 200, {
        status: result.status,
        revision: result.revision,
      });
    } catch (err) {
      sendDescriptionTreeError(res, err);
    }
    return true;
  }

  async function handleUpdateGroup(req, res, screenId, groupId) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) {
      return true;
    }

    const forbidden = Object.keys(body).find((key) =>
      UPDATE_GROUP_FORBIDDEN_KEYS.has(key),
    );
    if (forbidden) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: `許可されていないフィールドです: ${forbidden}`,
      });
      return true;
    }

    if (!assertAllowedKeys(res, body, UPDATE_GROUP_KEYS)) {
      return true;
    }
    if (!assertExpectedRevisionField(res, body)) {
      return true;
    }

    if (
      body.name === undefined &&
      body.description === undefined &&
      body.kind === undefined
    ) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'updateGroup には name / description / kind のいずれかが必要です。',
      });
      return true;
    }

    try {
      const collectedOrder = facade.collectCollectedItemIdsForScreen(
        ctx(screenId),
      );
      const input = {
        expectedRevision: body.expectedRevision,
        groupId,
      };
      if (body.name !== undefined) {
        input.name = body.name;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'description')) {
        input.description = body.description;
      }
      if (body.kind !== undefined) {
        input.kind = body.kind;
      }

      const result = await facade.updateDescriptionGroup(ctx(screenId), {
        ...input,
        collectedOrder,
      });
      sendJson(res, 200, {
        status: result.status,
        revision: result.revision,
      });
    } catch (err) {
      sendDescriptionTreeError(res, err);
    }
    return true;
  }

  async function handleMoveNode(req, res, screenId) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) {
      return true;
    }

    if (!assertAllowedKeys(res, body, MOVE_NODE_KEYS)) {
      return true;
    }
    if (!assertExpectedRevisionField(res, body)) {
      return true;
    }
    if (!assertRequiredField(res, body, 'node')) {
      return true;
    }
    if (!assertRequiredField(res, body, 'destinationParentGroupId')) {
      return true;
    }

    const node = parseSpecNodeRef(res, body.node, 'node');
    if (!node) {
      return true;
    }
    if (
      body.destinationParentGroupId !== null &&
      typeof body.destinationParentGroupId !== 'string'
    ) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'destinationParentGroupId の形式が不正です。',
      });
      return true;
    }
    if (
      Object.prototype.hasOwnProperty.call(body, 'insertIndex') &&
      typeof body.insertIndex !== 'number'
    ) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'insertIndex の形式が不正です。',
      });
      return true;
    }

    try {
      const collectedOrder = facade.collectCollectedItemIdsForScreen(
        ctx(screenId),
      );
      const input = {
        expectedRevision: body.expectedRevision,
        node,
        destinationParentGroupId: body.destinationParentGroupId,
      };
      if (Object.prototype.hasOwnProperty.call(body, 'insertIndex')) {
        input.insertIndex = body.insertIndex;
      }
      const result = await facade.moveDescriptionNode(ctx(screenId), {
        ...input,
        collectedOrder,
      });
      sendMutationResult(res, result);
    } catch (err) {
      sendDescriptionTreeError(res, err);
    }
    return true;
  }

  async function handleReorderChildren(req, res, screenId) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) {
      return true;
    }

    if (!assertAllowedKeys(res, body, REORDER_CHILDREN_KEYS)) {
      return true;
    }
    if (!assertExpectedRevisionField(res, body)) {
      return true;
    }
    if (!assertRequiredField(res, body, 'parentGroupId')) {
      return true;
    }
    if (!Object.prototype.hasOwnProperty.call(body, 'orderedNodes')) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'orderedNodes は必須です。',
      });
      return true;
    }
    if (!Array.isArray(body.orderedNodes)) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'orderedNodes は配列である必要があります。',
      });
      return true;
    }
    if (
      body.parentGroupId !== null &&
      typeof body.parentGroupId !== 'string'
    ) {
      sendJson(res, 400, {
        code: 'SPEC_DESCRIPTION_INVALID',
        message: 'parentGroupId の形式が不正です。',
      });
      return true;
    }

    const orderedNodes = [];
    for (let index = 0; index < body.orderedNodes.length; index += 1) {
      const parsed = parseSpecNodeRef(
        res,
        body.orderedNodes[index],
        `orderedNodes[${index}]`,
      );
      if (!parsed) {
        return true;
      }
      orderedNodes.push(parsed);
    }

    try {
      const collectedOrder = facade.collectCollectedItemIdsForScreen(
        ctx(screenId),
      );
      const result = await facade.reorderDescriptionChildren(ctx(screenId), {
        expectedRevision: body.expectedRevision,
        parentGroupId: body.parentGroupId,
        orderedNodes,
        collectedOrder,
      });
      sendMutationResult(res, result);
    } catch (err) {
      sendDescriptionTreeError(res, err);
    }
    return true;
  }

  async function handleDeleteGroup(req, res, screenId, groupId) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) {
      return true;
    }

    if (!assertAllowedKeys(res, body, REVISION_ONLY_KEYS)) {
      return true;
    }
    if (!assertExpectedRevisionField(res, body)) {
      return true;
    }

    try {
      const collectedOrder = facade.collectCollectedItemIdsForScreen(
        ctx(screenId),
      );
      const result = await facade.deleteDescriptionGroup(ctx(screenId), {
        expectedRevision: body.expectedRevision,
        groupId,
        collectedOrder,
      });
      sendMutationResult(res, result);
    } catch (err) {
      sendDescriptionTreeError(res, err);
    }
    return true;
  }

  async function handleDeleteGroupSubtree(req, res, screenId, groupId) {
    const body = await readMutationBody(req, res, listenHost(), listenPort());
    if (body === undefined) {
      return true;
    }

    if (!assertAllowedKeys(res, body, REVISION_ONLY_KEYS)) {
      return true;
    }
    if (!assertExpectedRevisionField(res, body)) {
      return true;
    }

    try {
      const collectedOrder = facade.collectCollectedItemIdsForScreen(
        ctx(screenId),
      );
      const result = await facade.deleteDescriptionGroupSubtree(ctx(screenId), {
        expectedRevision: body.expectedRevision,
        groupId,
        collectedOrder,
      });
      sendMutationResult(res, result);
    } catch (err) {
      sendDescriptionTreeError(res, err);
    }
    return true;
  }

  return {
    handleRequest,
    pathPrefix: DESCRIPTION_TREE_API_PREFIX,
    maxBodyBytes: MAX_BODY_BYTES,
  };
}

function parseDescriptionTreePath(pathname) {
  const prefix = `${DESCRIPTION_TREE_API_PREFIX}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const rest = pathname.slice(prefix.length);
  if (!rest) {
    return { kind: 'invalid' };
  }

  const parts = rest.split('/').filter((part) => part.length > 0);
  const screenId = decodePathSegment(parts[0]);
  if (!screenId) {
    return { kind: 'invalid' };
  }

  if (parts.length === 1) {
    return { kind: 'tree', screenId };
  }
  if (parts.length === 2 && parts[1] === 'groups') {
    return { kind: 'groups', screenId };
  }
  if (parts.length === 2 && parts[1] === 'items') {
    return { kind: 'items', screenId };
  }
  if (parts.length === 3) {
    if (parts[1] === 'nodes' && parts[2] === 'move') {
      return { kind: 'move-node', screenId };
    }
    if (parts[1] === 'children' && parts[2] === 'reorder') {
      return { kind: 'reorder-children', screenId };
    }
    if (parts[1] === 'groups') {
      const groupId = decodePathSegment(parts[2]);
      if (!groupId) {
        return { kind: 'invalid' };
      }
      return { kind: 'group', screenId, groupId };
    }
    if (parts[1] === 'items') {
      const itemId = decodePathSegment(parts[2]);
      if (!itemId) {
        return { kind: 'invalid' };
      }
      return { kind: 'item', screenId, itemId };
    }
    return { kind: 'not-found' };
  }
  if (parts.length === 4 && parts[1] === 'groups') {
    const groupId = decodePathSegment(parts[2]);
    if (!groupId) {
      return { kind: 'invalid' };
    }
    if (parts[3] === 'delete') {
      return { kind: 'group-delete', screenId, groupId };
    }
    if (parts[3] === 'delete-subtree') {
      return { kind: 'group-delete-subtree', screenId, groupId };
    }
    return { kind: 'not-found' };
  }
  return { kind: 'not-found' };
}

function decodePathSegment(segment) {
  if (!segment || segment.includes('..')) {
    return null;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  if (
    !decoded ||
    decoded.includes('..') ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    decoded.includes('\0')
  ) {
    return null;
  }
  return decoded;
}

function normalizePathname(pathname) {
  const normalized = String(pathname || '/').replace(/\\/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function sendMethodNotAllowed(res, allow) {
  if (allow) {
    res.setHeader('Allow', allow);
  }
  sendJson(res, 405, {
    code: 'SPEC_DESCRIPTION_TREE_METHOD_NOT_ALLOWED',
    message: 'このHTTPメソッドは使用できません。',
  });
  return true;
}

function assertAllowedKeys(res, body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(res, 400, {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: 'リクエスト本文は object である必要があります。',
    });
    return false;
  }
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) {
    sendJson(res, 400, {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `許可されていないフィールドです: ${unknown}`,
    });
    return false;
  }
  return true;
}

function assertExpectedRevisionField(res, body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'expectedRevision')) {
    sendJson(res, 400, {
      code: 'SPEC_DESCRIPTION_REVISION_REQUIRED',
      message: 'expectedRevision は必須です。',
    });
    return false;
  }
  return true;
}

function assertRequiredField(res, body, fieldName) {
  if (!Object.prototype.hasOwnProperty.call(body, fieldName)) {
    sendJson(res, 400, {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `${fieldName} は必須です。`,
    });
    return false;
  }
  return true;
}

function parseSpecNodeRef(res, value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    sendJson(res, 400, {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `${fieldName} の形式が不正です。`,
    });
    return null;
  }
  const unknown = Object.keys(value).find((key) => !SPEC_NODE_REF_KEYS.has(key));
  if (unknown) {
    sendJson(res, 400, {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `許可されていないフィールドです: ${unknown}`,
    });
    return null;
  }
  if (value.type !== 'group' && value.type !== 'item') {
    sendJson(res, 400, {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `${fieldName} の type が不正です。`,
    });
    return null;
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    sendJson(res, 400, {
      code: 'SPEC_DESCRIPTION_INVALID',
      message: `${fieldName} の id が不正です。`,
    });
    return null;
  }
  return { type: value.type, id: value.id };
}

function sendMutationResult(res, result) {
  sendJson(res, 200, {
    status: result.status,
    revision: result.revision,
  });
}

async function readMutationBody(req, res, listenHostValue, listenPortValue) {
  if (!isSameOrigin(req, listenHostValue, listenPortValue)) {
    sendJson(res, 403, {
      code: 'SPEC_DESCRIPTION_FORBIDDEN_ORIGIN',
      message: '同一 origin 以外からのリクエストは許可されていません。',
    });
    return undefined;
  }

  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.toLowerCase().includes('application/json')) {
    sendJson(res, 415, {
      code: 'SPEC_DESCRIPTION_UNSUPPORTED_MEDIA',
      message: 'Content-Type は application/json である必要があります。',
    });
    return undefined;
  }

  try {
    return await readJsonBody(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err && err.code === 'SPEC_DESCRIPTION_BODY_TOO_LARGE') {
      sendJson(res, 413, {
        code: err.code,
        message: 'リクエスト本文が大きすぎます。',
      });
      return undefined;
    }
    if (err && err.code === 'SPEC_DESCRIPTION_INVALID') {
      sendJson(res, 400, {
        code: err.code,
        message: 'リクエスト本文は object である必要があります。',
      });
      return undefined;
    }
    sendJson(res, 400, {
      code: 'SPEC_DESCRIPTION_MALFORMED_JSON',
      message: 'リクエスト本文の JSON が不正です。',
    });
    return undefined;
  }
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
        err.code = 'SPEC_DESCRIPTION_BODY_TOO_LARGE';
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
        if (text.trim() === '') {
          const err = new Error('empty body');
          err.code = 'SPEC_DESCRIPTION_INVALID';
          fail(err);
          return;
        }
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const err = new Error('invalid body');
          err.code = 'SPEC_DESCRIPTION_INVALID';
          fail(err);
          return;
        }
        succeed(parsed);
      } catch (err) {
        fail(err);
      }
    });
    req.on('error', fail);
  });
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

  const expectedHosts = expandHostAliases(listenHost);
  if (!expectedHosts.has(originUrl.hostname.toLowerCase())) {
    return false;
  }

  const originPort =
    originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80');
  const hostPort = hostHeader.includes(':')
    ? hostHeader.split(':').pop()
    : String(listenPort);
  return Number(hostPort) === Number(originPort);
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

const DESCRIPTION_TREE_INTERNAL_MESSAGE =
  'Description Item Tree の処理中にエラーが発生しました。';

function sendDescriptionTreeError(res, err) {
  const code =
    err && err.code ? String(err.code) : 'SPEC_DESCRIPTION_INTERNAL';
  const statusCode = mapDescriptionTreeStatus(code);
  const internalMessage =
    err && err.message ? String(err.message) : DESCRIPTION_TREE_INTERNAL_MESSAGE;
  const payload = {
    code,
    message:
      statusCode === 500 ? DESCRIPTION_TREE_INTERNAL_MESSAGE : internalMessage,
  };
  if (err && Object.prototype.hasOwnProperty.call(err, 'expectedRevision')) {
    payload.expectedRevision = err.expectedRevision;
  }
  if (err && Object.prototype.hasOwnProperty.call(err, 'currentRevision')) {
    payload.currentRevision = err.currentRevision;
  }
  sendJson(res, statusCode, payload);
}

function mapDescriptionTreeStatus(code) {
  switch (code) {
    case 'SPEC_DESCRIPTION_REVISION_REQUIRED':
    case 'SPEC_DESCRIPTION_INVALID':
    case 'SPEC_DESCRIPTION_GROUP_INSERT_INDEX_INVALID':
    case 'SPEC_DESCRIPTION_ITEM_INSERT_INDEX_INVALID':
    case 'SPEC_DESCRIPTION_GROUP_DEPTH_EXCEEDED':
    case 'SPEC_DESCRIPTION_REORDER_MISMATCH':
    case 'SPEC_DESCRIPTION_MALFORMED_JSON':
      return 400;
    case 'SPEC_DESCRIPTION_SCREEN_NOT_FOUND':
    case 'SPEC_DESCRIPTION_NOT_FOUND':
    case 'SPEC_DESCRIPTION_NODE_NOT_FOUND':
    case 'SPEC_DESCRIPTION_GROUP_NOT_FOUND':
    case 'SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND':
      return 404;
    case 'SPEC_DESCRIPTION_REVISION_CONFLICT':
    case 'SPEC_DESCRIPTION_GROUP_ALREADY_EXISTS':
    case 'SPEC_DESCRIPTION_NODE_ID_CONFLICT':
    case 'SPEC_DESCRIPTION_GROUP_CYCLE':
    case 'SPEC_DESCRIPTION_GROUP_SUBTREE_CONTAINS_COLLECTED_ITEM':
    case 'SPEC_DESCRIPTION_MUTATION_IN_PROGRESS':
      return 409;
    case 'SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE':
      return 500;
    case 'SPEC_DESCRIPTION_TREE_METHOD_NOT_ALLOWED':
    case 'SPEC_DESCRIPTION_METHOD_NOT_ALLOWED':
      return 405;
    case 'SPEC_DESCRIPTION_FORBIDDEN_ORIGIN':
      return 403;
    case 'SPEC_DESCRIPTION_UNSUPPORTED_MEDIA':
      return 415;
    case 'SPEC_DESCRIPTION_BODY_TOO_LARGE':
      return 413;
    default:
      return 500;
  }
}

function applyJsonSecurityHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendHeadJson(res, statusCode) {
  res.statusCode = statusCode;
  applyJsonSecurityHeaders(res);
  res.end();
}

function sendJson(res, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.statusCode = statusCode;
  applyJsonSecurityHeaders(res);
  res.setHeader('Content-Length', String(payload.length));
  res.end(payload);
}

module.exports = {
  createDescriptionTreeApi,
  DESCRIPTION_TREE_API_PREFIX,
  MAX_BODY_BYTES,
  mapDescriptionTreeStatus,
};
