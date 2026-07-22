import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDescriptionGroup } from '../../src/viewer/editing/description-mutation-client';

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createDescriptionGroup client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /groups で root 作成（parentGroupId 省略・201）', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' }, 201);
    });
    const result = await createDescriptionGroup(
      'demo/screen',
      {
        expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
        groupId: 'new-root',
        name: '新規',
        kind: 'SECTION',
        description: '説明',
      },
      fetchMock,
    );
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/_jskim/spec/description-tree/demo%2Fscreen/groups',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(capturedBody).toEqual({
      expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
      groupId: 'new-root',
      name: '新規',
      kind: 'SECTION',
      description: '説明',
    });
    expect(capturedBody).not.toHaveProperty('parentGroupId');
    expect(capturedBody).not.toHaveProperty('order');
  });

  it('child 作成では parentGroupId を送る', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' }, 201);
    });
    await createDescriptionGroup(
      'demo',
      {
        expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
        groupId: 'child-g',
        name: '子',
        kind: 'CARD',
        description: null,
        parentGroupId: 'parent-section',
      },
      fetchMock,
    );
    expect(capturedBody).toMatchObject({
      parentGroupId: 'parent-section',
      description: null,
    });
  });

  it('409 / network / invalid JSON を区別する', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          code: 'SPEC_DESCRIPTION_GROUP_ALREADY_EXISTS',
          message: 'exists',
        },
        409,
      ),
    );
    const result = await createDescriptionGroup(
      'demo',
      {
        expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
        groupId: 'x',
        name: 'x',
        kind: 'SECTION',
      },
      fetchMock,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SPEC_DESCRIPTION_GROUP_ALREADY_EXISTS');
      expect(result.error.httpStatus).toBe(409);
    }
  });
});
