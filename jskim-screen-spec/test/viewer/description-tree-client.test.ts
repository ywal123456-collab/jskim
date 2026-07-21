import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDescriptionTree } from '../../src/viewer/editing/description-tree-client.js';
import { DESCRIPTION_TREE_API_PREFIX } from '../../src/viewer/editing/description-tree-types.js';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const sampleTree = {
  revision: 'sha256:' + 'a'.repeat(64),
  sourceSchemaVersion: '1.3',
  description: {
    schemaVersion: '1.3',
    screen: { id: 'demo-screen', name: 'Demo', description: '' },
    rootNodes: [{ type: 'item', id: 'item-a' }],
    groups: [],
    items: {
      'item-a': { name: 'A', type: 'text', description: '', note: '' },
    },
    excludedItems: {},
  },
};

describe('fetchDescriptionTree', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('正常 v1.3 nested response を取得する', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(sampleTree));
    const result = await fetchDescriptionTree('demo-screen', undefined, fetchFn);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sourceSchemaVersion).toBe('1.3');
    }
    expect(fetchFn).toHaveBeenCalled();
    expect(String((fetchFn.mock.calls[0] as unknown as [string])[0])).toBe(
      `${DESCRIPTION_TREE_API_PREFIX}/demo-screen`,
    );
  });

  it('v1.2 normalized response を受理する', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        ...sampleTree,
        sourceSchemaVersion: '1.2',
      }),
    );
    const result = await fetchDescriptionTree('demo-screen', undefined, fetchFn);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sourceSchemaVersion).toBe('1.2');
    }
  });

  it('404 と 500 sanitized message を返す', async () => {
    const fetch404 = vi.fn(async () =>
      jsonResponse(
        { code: 'SPEC_DESCRIPTION_NOT_FOUND', message: '画面設計書が見つかりません。' },
        404,
      ),
    );
    const notFound = await fetchDescriptionTree('missing', undefined, fetch404);
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) {
      expect(notFound.error.code).toBe('SPEC_DESCRIPTION_NOT_FOUND');
    }

    const fetch500 = vi.fn(async () =>
      jsonResponse(
        { code: 'SPEC_DESCRIPTION_INTERNAL', message: 'secret path C:\\tmp' },
        500,
      ),
    );
    const internal = await fetchDescriptionTree('demo-screen', undefined, fetch500);
    expect(internal.ok).toBe(false);
    if (!internal.ok) {
      expect(internal.error.message).toContain('secret');
    }
  });

  it('malformed response と Abort を処理する', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ revision: 'x' }, 200));
    const malformed = await fetchDescriptionTree('demo-screen', undefined, fetchFn);
    expect(malformed.ok).toBe(false);

    const controller = new AbortController();
    controller.abort();
    const aborted = await fetchDescriptionTree('demo-screen', controller.signal, fetchFn);
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) {
      expect(aborted.aborted).toBe(true);
    }
  });

  it('screenId を 1 回だけ encode する', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(sampleTree));
    await fetchDescriptionTree('screen/with%20space', undefined, fetchFn);
    expect(fetchFn).toHaveBeenCalled();
    expect(String((fetchFn.mock.calls[0] as unknown as [string])[0])).toBe(
      `${DESCRIPTION_TREE_API_PREFIX}/screen%2Fwith%2520space`,
    );
  });
});
