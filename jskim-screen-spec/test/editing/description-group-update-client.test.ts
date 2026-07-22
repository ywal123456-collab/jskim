import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateDescriptionGroup } from '../../src/viewer/editing/description-mutation-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('updateDescriptionGroup client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PATCH で encoded path・expectedRevision・許可 field のみを送る', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' });
    });
    const result = await updateDescriptionGroup(
      'demo/screen',
      'group/id',
      {
        expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
        name: '新名称',
        kind: 'CARD',
        description: '説明',
      },
      fetchMock,
    );
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/_jskim/spec/description-tree/demo%2Fscreen/groups/group%2Fid',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(capturedBody).toEqual({
      expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
      name: '新名称',
      kind: 'CARD',
      description: '説明',
    });
    expect(capturedBody).not.toHaveProperty('groupId');
    expect(capturedBody).not.toHaveProperty('children');
    expect(capturedBody).not.toHaveProperty('rootNodes');
    expect(capturedBody).not.toHaveProperty('items');
    expect(capturedBody).not.toHaveProperty('excludedItems');
    expect(capturedBody).not.toHaveProperty('order');
  });

  it('description null を送信できる', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' });
    });
    await updateDescriptionGroup(
      'demo',
      'section',
      {
        expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
        name: '名前',
        kind: 'SECTION',
        description: null,
      },
      fetchMock,
    );
    expect(capturedBody).toMatchObject({ description: null });
  });

  it('200 unchanged を成功として扱う', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: 'unchanged', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001' }),
    );
    const result = await updateDescriptionGroup(
      'demo',
      'section',
      { expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001', name: '同名' },
      fetchMock,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('unchanged');
    }
  });

  it('400/404/409/500 と network / invalid JSON を区別する', async () => {
    const cases: Array<{
      label: string;
      respond: () => Promise<Response>;
      expectCode?: string;
      expectStatus?: number;
      network?: boolean;
    }> = [
      {
        label: '400',
        respond: async () =>
          jsonResponse(
            { code: 'SPEC_DESCRIPTION_INVALID', message: '不正' },
            400,
          ),
        expectCode: 'SPEC_DESCRIPTION_INVALID',
        expectStatus: 400,
      },
      {
        label: '404',
        respond: async () =>
          jsonResponse(
            { code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND', message: 'なし' },
            404,
          ),
        expectCode: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
        expectStatus: 404,
      },
      {
        label: '409',
        respond: async () =>
          jsonResponse(
            {
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
              expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
              currentRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000009',
            },
            409,
          ),
        expectCode: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
        expectStatus: 409,
      },
      {
        label: '500',
        respond: async () =>
          jsonResponse({ code: 'SPEC_DESCRIPTION_INTERNAL', message: 'x' }, 500),
        expectCode: 'SPEC_DESCRIPTION_INTERNAL',
        expectStatus: 500,
      },
      {
        label: 'network',
        respond: async () => {
          throw new Error('network reset');
        },
        network: true,
      },
      {
        label: 'invalid-json',
        respond: async () =>
          new Response('{', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        network: true,
      },
    ];

    for (const entry of cases) {
      const fetchMock = vi.fn(entry.respond);
      const result = await updateDescriptionGroup(
        'demo',
        'section',
        { expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001', name: 'x' },
        fetchMock,
      );
      expect(result.ok, entry.label).toBe(false);
      if (!result.ok) {
        if (entry.network) {
          expect(
            result.error.code === 'SPEC_DESCRIPTION_NETWORK' ||
              result.error.code === 'SPEC_DESCRIPTION_INVALID',
            entry.label,
          ).toBe(true);
        } else {
          expect(result.error.code, entry.label).toBe(entry.expectCode);
          expect(result.error.httpStatus, entry.label).toBe(entry.expectStatus);
        }
      }
    }
  });

  it('legacy Description PUT を呼ばない', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        throw new Error(`unexpected PUT: ${url}`);
      }
      return jsonResponse({ status: 'updated', revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' });
    });
    await updateDescriptionGroup(
      'demo',
      'section',
      { expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000001', name: 'x', kind: 'SECTION' },
      fetchMock,
    );
    const putCalls = fetchMock.mock.calls.filter(
      (call) => ((call[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'PUT',
    );
    expect(putCalls).toHaveLength(0);
  });
});
