import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isDefiniteMutationRejection,
  moveDescriptionNode,
  sanitizeMutationMessage,
} from '../../src/viewer/editing/description-mutation-client';
import {
  buildNodeMoveCapture,
  classifyNodeMoveAuthoritative,
  findNodeSiblingContext,
  planIndentNode,
  planMoveNodeDown,
  planMoveNodeUp,
  planOutdentNode,
} from '../../src/viewer/editing/node-move-helpers';
import type { DescriptionTreeGetResponse } from '../../src/viewer/editing/description-tree-types';
import { mockDescriptionRevision } from '../helpers/description-tree-fetch-mock';

function makeResponse(
  overrides?: Partial<DescriptionTreeGetResponse['description']> & {
    revision?: string;
  },
): DescriptionTreeGetResponse {
  const { revision, ...descriptionOverrides } = overrides ?? {};
  return {
    revision: revision ?? 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
    sourceSchemaVersion: '1.3',
    collectedItemIds: [],
    description: {
      schemaVersion: '1.3',
      screen: { id: 'demo', name: 'Demo', description: '' },
      rootNodes: [
        { type: 'item', id: 'a' },
        { type: 'group', id: 'g1' },
        { type: 'item', id: 'c' },
      ],
      groups: [
        {
          groupId: 'g1',
          name: 'G1',
          kind: 'SECTION',
          children: [
            { type: 'item', id: 'b' },
            { type: 'group', id: 'g2' },
          ],
        },
        {
          groupId: 'g2',
          name: 'G2',
          kind: 'CARD',
          children: [{ type: 'item', id: 'nested' }],
        },
      ],
      items: {
        a: { name: 'A', type: 'text', description: '', note: '' },
        b: { name: 'B', type: 'text', description: '', note: '' },
        c: { name: 'C', type: 'text', description: '', note: '' },
        nested: { name: 'N', type: 'text', description: '', note: '' },
      },
      excludedItems: {},
      ...descriptionOverrides,
    },
  };
}

describe('node-move-helpers', () => {
  it('findNodeSiblingContext は Item/Group mixed sibling を返す', () => {
    const response = makeResponse();
    const ctx = findNodeSiblingContext(response, { type: 'group', id: 'g1' });
    expect(ctx).toMatchObject({
      sourceParentGroupId: null,
      sourceIndex: 1,
      sourceOrderedNodes: [
        { type: 'item', id: 'a' },
        { type: 'group', id: 'g1' },
        { type: 'item', id: 'c' },
      ],
    });
  });

  it('Item up/down plan', () => {
    const response = makeResponse();
    const down = planMoveNodeDown(response, { type: 'item', id: 'a' });
    expect(down?.destinationOrderedNodes.map((n) => n.id)).toEqual([
      'g1',
      'a',
      'c',
    ]);
    const up = planMoveNodeUp(response, { type: 'item', id: 'c' });
    expect(up?.destinationOrderedNodes.map((n) => n.id)).toEqual([
      'a',
      'c',
      'g1',
    ]);
  });

  it('first/last boundary は unavailable', () => {
    const response = makeResponse();
    expect(planMoveNodeUp(response, { type: 'item', id: 'a' })).toBeNull();
    expect(planMoveNodeDown(response, { type: 'item', id: 'c' })).toBeNull();
  });

  it('indent は直前 sibling が Group のときのみ', () => {
    const response = makeResponse();
    const ok = planIndentNode(response, { type: 'item', id: 'c' });
    expect(ok?.destinationParentGroupId).toBe('g1');
    expect(
      planIndentNode(response, { type: 'item', id: 'a' }),
    ).toBeNull();
    const nested = makeResponse({
      groups: [
        {
          groupId: 'g1',
          name: 'G1',
          kind: 'SECTION',
          children: [
            { type: 'item', id: 'b' },
            { type: 'item', id: 'x' },
          ],
        },
      ],
    });
    expect(
      planIndentNode(nested, { type: 'item', id: 'x' }),
    ).toBeNull();
  });

  it('outdent は Group 内 node のみ', () => {
    const response = makeResponse();
    expect(
      planOutdentNode(response, { type: 'item', id: 'a' }),
    ).toBeNull();
    const outdent = planOutdentNode(response, { type: 'item', id: 'b' });
    expect(outdent).toMatchObject({
      destinationParentGroupId: null,
      destinationIndex: 2,
    });
  });

  it('入力 tree は不変', () => {
    const response = makeResponse();
    const before = JSON.stringify(response.description.rootNodes);
    planMoveNodeDown(response, { type: 'item', id: 'a' });
    expect(JSON.stringify(response.description.rootNodes)).toBe(before);
  });

  it('reorder exact committed classification', () => {
    const response = makeResponse();
    const plan = planMoveNodeDown(response, { type: 'item', id: 'a' })!;
    const capture = buildNodeMoveCapture(response, plan, response.revision)!;
    const after = makeResponse({
      revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002',
      rootNodes: [
        { type: 'group', id: 'g1' },
        { type: 'item', id: 'a' },
        { type: 'item', id: 'c' },
      ],
    });
    expect(
      classifyNodeMoveAuthoritative(after, capture, {
        mutationRevision: after.revision,
        captureRevision: response.revision,
      }).kind,
    ).toBe('match-exact');
  });

  it('capture revision 同一・source 不変は definitely-not-committed', () => {
    const response = makeResponse();
    const plan = planMoveNodeDown(response, { type: 'item', id: 'a' })!;
    const capture = buildNodeMoveCapture(response, plan, response.revision)!;
    expect(
      classifyNodeMoveAuthoritative(response, capture, {
        mutationRevision: null,
        captureRevision: response.revision,
      }).kind,
    ).toBe('definitely-not-committed');
  });

  it('commit-unknown exact recovery', () => {
    const response = makeResponse();
    const plan = planMoveNodeDown(response, { type: 'item', id: 'a' })!;
    const capture = buildNodeMoveCapture(response, plan, response.revision)!;
    const after = makeResponse({
      revision:
        'sha256:0000000000000000000000000000000000000000000000000000000000000002',
      rootNodes: [
        { type: 'group', id: 'g1' },
        { type: 'item', id: 'a' },
        { type: 'item', id: 'c' },
      ],
    });
    expect(
      classifyNodeMoveAuthoritative(after, capture, {
        mutationRevision: null,
        captureRevision: response.revision,
      }).kind,
    ).toBe('match-exact');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID_R1 = mockDescriptionRevision(1);
const VALID_R2 = mockDescriptionRevision(2);

describe('moveDescriptionNode client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /nodes/move で node / destinationParentGroupId / optional insertIndex を送る', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ status: 'updated', revision: VALID_R2 });
    });
    const result = await moveDescriptionNode(
      'demo/screen',
      {
        expectedRevision: VALID_R1,
        node: { type: 'item', id: 'item/a' },
        destinationParentGroupId: null,
        insertIndex: 1,
      },
      fetchMock,
    );
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/_jskim/spec/description-tree/demo%2Fscreen/nodes/move',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(capturedBody).toEqual({
      expectedRevision: VALID_R1,
      node: { type: 'item', id: 'item/a' },
      destinationParentGroupId: null,
      insertIndex: 1,
    });
  });

  it('insertIndex 省略時は body に含めない', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ status: 'unchanged', revision: VALID_R1 });
    });
    await moveDescriptionNode(
      'demo',
      {
        expectedRevision: VALID_R1,
        node: { type: 'group', id: 'section' },
        destinationParentGroupId: 'parent',
      },
      fetchMock,
    );
    expect(capturedBody).toEqual({
      expectedRevision: VALID_R1,
      node: { type: 'group', id: 'section' },
      destinationParentGroupId: 'parent',
    });
    expect(capturedBody).not.toHaveProperty('insertIndex');
  });

  it('AbortSignal を fetch に渡す', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return jsonResponse({ status: 'updated', revision: VALID_R2 });
    });
    await moveDescriptionNode(
      'demo',
      {
        expectedRevision: VALID_R1,
        node: { type: 'item', id: 'a' },
        destinationParentGroupId: 'g1',
      },
      fetchMock,
      controller.signal,
    );
  });

  it('HTTP エラーを sanitize する', () => {
    expect(
      sanitizeMutationMessage({
        code: 'SPEC_DESCRIPTION_GROUP_CYCLE',
        message: 'raw',
        httpStatus: 409,
      }),
    ).toBe('グループを自身または配下のグループの中へは移動できません。');
    expect(
      sanitizeMutationMessage({
        code: 'SPEC_DESCRIPTION_REORDER_MISMATCH',
        message: 'raw',
        httpStatus: 409,
      }),
    ).toBe('並び順が変更されています。最新内容を再読み込みしてください。');
    expect(
      sanitizeMutationMessage({
        code: 'SPEC_DESCRIPTION_GROUP_INSERT_INDEX_INVALID',
        message: 'raw',
        httpStatus: 400,
      }),
    ).toBe('移動先の位置が不正です。最新内容を確認してください。');
  });

  it('409 revision conflict は definite rejection', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
          message: '衝突',
          expectedRevision: VALID_R1,
          currentRevision: mockDescriptionRevision(9),
        },
        409,
      ),
    );
    const result = await moveDescriptionNode(
      'demo',
      {
        expectedRevision: VALID_R1,
        node: { type: 'item', id: 'a' },
        destinationParentGroupId: null,
      },
      fetchMock,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isDefiniteMutationRejection(result.error)).toBe(true);
    }
  });
});
