import { afterEach, describe, expect, it } from 'vitest';
import {
  enqueueDeviceCapture,
  getDeviceCaptureQueueDepth,
  resetDeviceCaptureQueuesForTests,
} from '../../src/device-capture/project-queue.js';

afterEach(() => {
  resetDeviceCaptureQueuesForTests();
});

describe('device capture project queue', () => {
  it('同じ project は直列実行する', async () => {
    const order: number[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const p1 = enqueueDeviceCapture('/tmp/a', 'proj', async () => {
      order.push(1);
      await firstGate;
      order.push(2);
      return 'a';
    });
    const p2 = enqueueDeviceCapture('/tmp/a', 'proj', async () => {
      order.push(3);
      return 'b';
    });

    await Promise.resolve();
    expect(order).toEqual([1]);
    expect(getDeviceCaptureQueueDepth('/tmp/a', 'proj')).toBeGreaterThanOrEqual(1);

    releaseFirst();
    await expect(p1).resolves.toBe('a');
    await expect(p2).resolves.toBe('b');
    expect(order).toEqual([1, 2, 3]);
    expect(getDeviceCaptureQueueDepth('/tmp/a', 'proj')).toBe(0);
  });

  it('異なる project は並列実行できる', async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let startedB = false;

    const pA = enqueueDeviceCapture('/tmp/a', 'projA', async () => {
      await gateA;
      return 'A';
    });
    const pB = enqueueDeviceCapture('/tmp/b', 'projB', async () => {
      startedB = true;
      return 'B';
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(startedB).toBe(true);
    releaseA();
    await expect(Promise.all([pA, pB])).resolves.toEqual(['A', 'B']);
  });

  it('先頭が reject しても後続が実行される', async () => {
    const results: string[] = [];
    const p1 = enqueueDeviceCapture('/tmp/c', 'proj', async () => {
      throw new Error('boom');
    });
    const p2 = enqueueDeviceCapture('/tmp/c', 'proj', async () => {
      results.push('ok');
      return 1;
    });
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe(1);
    expect(results).toEqual(['ok']);
    expect(getDeviceCaptureQueueDepth('/tmp/c', 'proj')).toBe(0);
  });
});
