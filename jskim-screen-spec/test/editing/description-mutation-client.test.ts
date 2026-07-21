import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createDescriptionItem,
  excludeDescriptionItem,
  updateDescriptionScreen,
} from '../../src/viewer/editing/description-mutation-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('description-mutation-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('updateDescriptionScreen は PATCH URL と expectedRevision を送る', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: 'updated', revision: 'sha256:r2' }),
    );
    const result = await updateDescriptionScreen(
      'demo-screen',
      { expectedRevision: 'sha256:r1', name: '新名称' },
      fetchMock,
    );
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/_jskim/spec/description-tree/demo-screen/screen',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          expectedRevision: 'sha256:r1',
          name: '新名称',
        }),
      }),
    );
  });

  it('409 conflict code を保持する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
            message: '衝突',
          },
          409,
        ),
      ),
    );
    const result = await updateDescriptionScreen('demo', {
      expectedRevision: 'sha256:r1',
      name: 'x',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SPEC_DESCRIPTION_REVISION_CONFLICT');
      expect(result.error.httpStatus).toBe(409);
    }
  });

  it('malformed JSON envelope を拒否する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ revision: 'sha256:r2' }, 200)),
    );
    const result = await createDescriptionItem(
      'demo',
      {
        expectedRevision: 'sha256:r1',
        itemId: 'a',
        name: '',
        type: '',
        description: '',
        note: '',
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SPEC_DESCRIPTION_INVALID');
    }
  });

  it('Abort 時は aborted を返す', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ status: 'updated', revision: 'sha256:r2' })),
    );
    const result = await excludeDescriptionItem(
      'demo',
      'item-a',
      'sha256:r1',
      fetch,
      controller.signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(true);
    }
  });
});
