import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_DELETE_FALLBACK_KEY,
  PENDING_SCREEN_KEY,
  clearPendingDeleteFallback,
  clearPendingScreen,
  peekPendingDeleteFallback,
  peekPendingScreen,
  setPendingDeleteFallback,
  setPendingScreen,
  waitForScreenAbsentFromManifest,
  waitForScreenInManifest,
  waitForScreenStatusInManifest,
} from '../../src/viewer/editing/pending-screen';

describe('pending-screen', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('set/peek/clear が sessionStorage と一致する', () => {
    expect(peekPendingScreen()).toBeNull();

    setPendingScreen('crud-create');
    expect(peekPendingScreen()).toBe('crud-create');
    expect(sessionStorage.getItem(PENDING_SCREEN_KEY)).toBe('crud-create');

    clearPendingScreen();
    expect(peekPendingScreen()).toBeNull();
    expect(sessionStorage.getItem(PENDING_SCREEN_KEY)).toBeNull();
  });

  it('waitForScreenInManifest は screen が現れたら true を返す', async () => {
    let calls = 0;
    const fetchFn = vi.fn(
      async (
        _input: RequestInfo | URL,
        _init?: RequestInit,
      ): Promise<Response> => {
        calls += 1;
        const screens = calls >= 2 ? [{ id: 'new-screen' }] : [];
        return new Response(JSON.stringify({ screens }), { status: 200 });
      },
    );

    const found = await waitForScreenInManifest('new-screen', {
      manifestUrl: '/spec/data/manifest.json',
      intervalMs: 5,
      timeoutMs: 1000,
      fetchFn,
    });

    expect(found).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(fetchFn).toHaveBeenCalled();
    const firstCallUrl = fetchFn.mock.calls[0]?.[0];
    expect(typeof firstCallUrl).toBe('string');
    expect(String(firstCallUrl)).toContain('/spec/data/manifest.json');
  });

  it('timeout まで見つからなければ false を返す', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ screens: [] }), { status: 200 }),
    );

    const found = await waitForScreenInManifest('missing-screen', {
      manifestUrl: '/spec/data/manifest.json',
      intervalMs: 5,
      timeoutMs: 30,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(found).toBe(false);
  });

  it('fetch が失敗しても再試行し、timeout で false を返す', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network error');
    });

    const found = await waitForScreenInManifest('missing-screen', {
      manifestUrl: '/spec/data/manifest.json',
      intervalMs: 5,
      timeoutMs: 30,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(found).toBe(false);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(0);
  });

  it('pending delete fallback を sessionStorage に保存する', () => {
    setPendingDeleteFallback({
      removedScreenId: 'gone',
      fallbackScreenId: 'next',
    });
    expect(peekPendingDeleteFallback()).toEqual({
      removedScreenId: 'gone',
      fallbackScreenId: 'next',
    });
    expect(sessionStorage.getItem(PENDING_DELETE_FALLBACK_KEY)).toBeTruthy();
    clearPendingDeleteFallback();
    expect(peekPendingDeleteFallback()).toBeNull();
  });

  it('waitForScreenAbsentFromManifest は消えたら true', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      const screens = calls >= 2 ? [] : [{ id: 'gone' }];
      return new Response(JSON.stringify({ screens }), { status: 200 });
    });

    const absent = await waitForScreenAbsentFromManifest('gone', {
      manifestUrl: '/spec/data/manifest.json',
      intervalMs: 5,
      timeoutMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(absent).toBe(true);
  });

  it('waitForScreenStatusInManifest は status 一致で true', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      const status = calls >= 2 ? 'implementation-only' : 'linked';
      return new Response(
        JSON.stringify({ screens: [{ id: 'x', status }] }),
        { status: 200 },
      );
    });

    const ready = await waitForScreenStatusInManifest('x', {
      manifestUrl: '/spec/data/manifest.json',
      status: 'implementation-only',
      intervalMs: 5,
      timeoutMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(ready).toBe(true);
  });
});
