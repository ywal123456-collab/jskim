import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createDescriptionItem,
  excludeDescriptionItem,
  isDefiniteMutationRejection,
  updateDescriptionScreen,
} from '../../src/viewer/editing/description-mutation-client';
import { mockDescriptionRevision } from '../helpers/description-tree-fetch-mock';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID_R1 = mockDescriptionRevision(1);
const VALID_R2 = mockDescriptionRevision(2);

describe('description-mutation-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('valid revision envelope を成功として返す', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: 'updated', revision: VALID_R2 }),
    );
    const result = await updateDescriptionScreen(
      'demo-screen',
      { expectedRevision: VALID_R1, name: '新名称' },
      fetchMock,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.revision).toBe(VALID_R2);
    }
    expect(fetchMock).toHaveBeenCalledWith(
      '/_jskim/spec/description-tree/demo-screen/screen',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          expectedRevision: VALID_R1,
          name: '新名称',
        }),
      }),
    );
  });

  it('missing / invalid revision は success envelope として拒否する', async () => {
    const cases = [
      { label: 'missing', body: { status: 'updated' } },
      { label: 'null', body: { status: 'updated', revision: null } },
      { label: 'number', body: { status: 'updated', revision: 1 } },
      { label: 'empty', body: { status: 'updated', revision: '' } },
      {
        label: 'same-invalid',
        body: { status: 'updated', revision: 'same-invalid-revision' },
      },
      {
        label: 'short digest',
        body: { status: 'updated', revision: 'sha256:abcd' },
      },
      {
        label: 'non-hex',
        body: {
          status: 'updated',
          revision: 'sha256:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
        },
      },
    ] as const;

    for (const entry of cases) {
      const result = await updateDescriptionScreen(
        'demo',
        { expectedRevision: VALID_R1, name: 'x' },
        vi.fn(async () => jsonResponse(entry.body, 200)),
      );
      expect(result.ok, entry.label).toBe(false);
      if (!result.ok) {
        expect(result.error.code, entry.label).toBe('SPEC_DESCRIPTION_INVALID');
        expect(result.error.httpStatus, entry.label).toBe(200);
        expect(
          isDefiniteMutationRejection(result.error),
          entry.label,
        ).toBe(false);
      }
    }
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
      expectedRevision: VALID_R1,
      name: 'x',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SPEC_DESCRIPTION_REVISION_CONFLICT');
      expect(result.error.httpStatus).toBe(409);
      expect(isDefiniteMutationRejection(result.error)).toBe(true);
    }
  });

  it('malformed JSON envelope を拒否する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ revision: VALID_R2 }, 200)),
    );
    const result = await createDescriptionItem('demo', {
      expectedRevision: VALID_R1,
      itemId: 'a',
      name: '',
      type: '',
      description: '',
      note: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SPEC_DESCRIPTION_INVALID');
      expect(isDefiniteMutationRejection(result.error)).toBe(false);
    }
  });

  it('Abort 時は aborted を返す', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ status: 'updated', revision: VALID_R2 }),
      ),
    );
    const result = await excludeDescriptionItem(
      'demo',
      'item-a',
      VALID_R1,
      fetch,
      controller.signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(true);
    }
  });
});
