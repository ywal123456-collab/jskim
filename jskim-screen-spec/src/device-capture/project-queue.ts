/**
 * project 単位で Device Capture を直列化する。
 * Description screen lock とは別物。
 */

type QueueEntry = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const queues = new Map<string, QueueEntry[]>();
const running = new Set<string>();

function projectKey(rootDir: string, projectName: string): string {
  return `${rootDir.replace(/\\/g, '/')}::${projectName}`;
}

async function pump(key: string): Promise<void> {
  if (running.has(key)) {
    return;
  }
  const queue = queues.get(key);
  if (!queue || queue.length === 0) {
    queues.delete(key);
    return;
  }
  running.add(key);
  const entry = queue.shift()!;
  try {
    const value = await entry.run();
    entry.resolve(value);
  } catch (err) {
    entry.reject(err);
  } finally {
    running.delete(key);
    if (queue.length === 0) {
      queues.delete(key);
    } else {
      void pump(key);
    }
  }
}

export function enqueueDeviceCapture<T>(
  rootDir: string,
  projectName: string,
  run: () => Promise<T>,
): Promise<T> {
  const key = projectKey(rootDir, projectName);
  return new Promise<T>((resolve, reject) => {
    const entry: QueueEntry = {
      run: run as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    };
    const queue = queues.get(key) || [];
    queue.push(entry);
    queues.set(key, queue);
    void pump(key);
  });
}

/** テスト用: queue の残件を確認 */
export function getDeviceCaptureQueueDepth(
  rootDir: string,
  projectName: string,
): number {
  const key = projectKey(rootDir, projectName);
  return (queues.get(key) || []).length + (running.has(key) ? 1 : 0);
}

/** テスト用: 全 queue を空にする（実行中は触らない） */
export function resetDeviceCaptureQueuesForTests(): void {
  queues.clear();
  running.clear();
}
