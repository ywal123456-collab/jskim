import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteDescriptionGroup,
  isDefiniteMutationRejection,
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

describe('deleteDescriptionGroup client（ungroup）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /groups/:id/delete で expectedRevision のみ送る', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ status: 'updated', revision: VALID_R2 });
    });
    const result = await deleteDescriptionGroup(
      'demo/screen',
      'group/id',
      VALID_R1,
      fetchMock,
    );
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/_jskim/spec/description-tree/demo%2Fscreen/groups/group%2Fid/delete',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(capturedBody).toEqual({ expectedRevision: VALID_R1 });
    expect(capturedBody).not.toHaveProperty('groupId');
    expect(capturedBody).not.toHaveProperty('children');
  });

  it('invalid revision envelope は definite rejection ではない', async () => {
    const result = await deleteDescriptionGroup(
      'demo',
      'section',
      VALID_R1,
      vi.fn(async () =>
        jsonResponse({ status: 'updated', revision: 'same-invalid-revision' }),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SPEC_DESCRIPTION_INVALID');
      expect(result.error.httpStatus).toBe(200);
      expect(isDefiniteMutationRejection(result.error)).toBe(false);
    }
  });

  it('404 / 409 / network を区別する', async () => {
    const cases = [
      {
        label: '404',
        respond: () =>
          jsonResponse(
            { code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND', message: 'なし' },
            404,
          ),
        code: 'SPEC_DESCRIPTION_GROUP_NOT_FOUND',
        status: 404,
      },
      {
        label: '409',
        respond: () =>
          jsonResponse(
            {
              code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
              message: '衝突',
              expectedRevision: VALID_R1,
              currentRevision: mockDescriptionRevision(9),
            },
            409,
          ),
        code: 'SPEC_DESCRIPTION_REVISION_CONFLICT',
        status: 409,
      },
    ] as const;

    for (const entry of cases) {
      const fetchMock = vi.fn(async () => entry.respond());
      const result = await deleteDescriptionGroup(
        'demo',
        'section',
        VALID_R1,
        fetchMock,
      );
      expect(result.ok, entry.label).toBe(false);
      if (!result.ok) {
        expect(result.error.code, entry.label).toBe(entry.code);
        expect(result.error.httpStatus, entry.label).toBe(entry.status);
        expect(isDefiniteMutationRejection(result.error), entry.label).toBe(
          true,
        );
      }
    }

    const networkMock = vi.fn(async () => {
      throw new Error('network');
    });
    const networkResult = await deleteDescriptionGroup(
      'demo',
      'section',
      VALID_R1,
      networkMock,
    );
    expect(networkResult.ok).toBe(false);
    if (!networkResult.ok) {
      expect(networkResult.error.code).toBe('SPEC_DESCRIPTION_NETWORK');
      expect(isDefiniteMutationRejection(networkResult.error)).toBe(false);
    }
  });

  it('delete-subtree パスは呼ばない', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('delete-subtree')) {
        throw new Error('subtree called');
      }
      return jsonResponse({ status: 'updated', revision: VALID_R2 });
    });
    await deleteDescriptionGroup('demo', 'section', VALID_R1, fetchMock);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('delete-subtree')),
    ).toBe(false);
  });
});
