'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createSpecTaskQueue } = require('../scripts/lib/create-spec-task-queue');

describe('createSpecTaskQueue', () => {
  it('短い時間の複数 event を 1 batch にまとめる', async () => {
    const runs = [];
    const queue = createSpecTaskQueue({
      debounceMs: 30,
      runTask: async (batch) => {
        runs.push(batch);
      },
    });

    queue.enqueue(['a.json'], 'BUILD_ONLY');
    queue.enqueue(['b.json'], 'BUILD_ONLY');
    await sleep(80);

    assert.equal(runs.length, 1);
    assert.equal(runs[0].kind, 'BUILD_ONLY');
    assert.deepEqual(runs[0].paths.sort(), ['a.json', 'b.json'].sort());
    await queue.close();
  });

  it('batch 内で COLLECT_AND_BUILD を優先する', async () => {
    const runs = [];
    const queue = createSpecTaskQueue({
      debounceMs: 20,
      runTask: async (batch) => {
        runs.push(batch);
      },
    });

    queue.enqueue(['data.json'], 'BUILD_ONLY');
    queue.enqueue(['page.njk'], 'COLLECT_AND_BUILD');
    await sleep(60);

    assert.equal(runs.length, 1);
    assert.equal(runs[0].kind, 'COLLECT_AND_BUILD');
    await queue.close();
  });

  it('実行中の変更は完了後に 1 回だけ rerun する', async () => {
    const runs = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    const queue = createSpecTaskQueue({
      debounceMs: 10,
      runTask: async (batch) => {
        runs.push({
          kind: batch.kind,
          paths: batch.paths.slice(),
          state: queue.getState(),
        });
        if (runs.length === 1) {
          await gate;
        }
      },
    });

    queue.enqueue(['one.njk'], 'COLLECT_AND_BUILD');
    await sleep(40);
    assert.equal(queue.getState(), 'running');

    queue.enqueue(['two.njk'], 'COLLECT_AND_BUILD');
    queue.enqueue(['three.njk'], 'COLLECT_AND_BUILD');
    assert.equal(queue.getState(), 'rerunRequested');

    release();
    await sleep(80);

    assert.equal(runs.length, 2);
    assert.deepEqual(runs[1].paths.sort(), ['three.njk', 'two.njk'].sort());
    await queue.close();
  });

  it('失敗しても queue は継続し、close 後は新規作業しない', async () => {
    const runs = [];
    let failOnce = true;
    const queue = createSpecTaskQueue({
      debounceMs: 10,
      runTask: async (batch) => {
        runs.push(batch.kind);
        if (failOnce) {
          failOnce = false;
          throw new Error('boom');
        }
      },
      onError: () => {},
    });

    queue.enqueue(['a'], 'BUILD_ONLY');
    await sleep(40);
    queue.enqueue(['b'], 'BUILD_ONLY');
    await sleep(40);
    assert.deepEqual(runs, ['BUILD_ONLY', 'BUILD_ONLY']);

    await queue.close();
    queue.enqueue(['c'], 'BUILD_ONLY');
    await sleep(40);
    assert.deepEqual(runs, ['BUILD_ONLY', 'BUILD_ONLY']);
    assert.equal(queue.getState(), 'closed');
  });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
