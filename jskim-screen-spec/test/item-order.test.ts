import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeEffectiveItemOrder,
  computeItemOrder,
  extractItemIdsInDomOrder,
  mergeItemOrder,
} from '../src/builder/item-order.js';

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/state-transition',
);

describe('item 順序', () => {
  it('DOM 出現順で item ID を抽出する', () => {
    const html = fs.readFileSync(
      path.join(fixtureRoot, 'snapshots/default.html'),
      'utf8',
    );
    expect(extractItemIdsInDomOrder(html)).toEqual([
      'open-help-button',
      'terms-link',
    ]);
  });

  it('複数 state を order 昇順で first-seen 結合する', () => {
    const source = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, 'source.spec.json'), 'utf8'),
    ) as {
      states: Array<{
        id: string;
        viewer?: { visible?: boolean; order?: number };
      }>;
    };

    const states = source.states.map((state) => ({
      id: state.id,
      viewer: state.viewer,
      html: fs.readFileSync(
        path.join(fixtureRoot, 'snapshots', `${state.id}.html`),
        'utf8',
      ),
    }));

    expect(computeItemOrder(states)).toEqual([
      'open-help-button',
      'terms-link',
      'help-title',
      'close-help-button',
    ]);
  });

  it('viewer.visible が false の state は順序計算から除外する', () => {
    const order = computeItemOrder([
      {
        id: 'hidden',
        viewer: { visible: false, order: 1 },
        html: '<div data-jskim-spec-item="hidden-item"></div>',
      },
      {
        id: 'default',
        viewer: { visible: true, order: 10 },
        html: '<div data-jskim-spec-item="visible-item"></div>',
      },
    ]);
    expect(order).toEqual(['visible-item']);
  });
});

describe('computeEffectiveItemOrder（1.0 互換 / 1.1 表示用の実効順序）', () => {
  it('itemOrder が items と完全一致する場合はそのまま使う', () => {
    const order = computeEffectiveItemOrder({
      items: { a: {}, b: {} },
      itemOrder: ['b', 'a'],
      collectedOrder: null,
    });
    expect(order).toEqual(['b', 'a']);
  });

  it('itemOrder が無い場合（1.0）は collectedOrder（DOM 順）→ 残りを items 挿入順で補う', () => {
    const order = computeEffectiveItemOrder({
      items: { a: {}, b: {}, c: {} },
      itemOrder: null,
      collectedOrder: ['b', 'z'],
    });
    expect(order).toEqual(['b', 'a', 'c']);
  });

  it('itemOrder も collectedOrder も無い場合は items の挿入順を使う', () => {
    const order = computeEffectiveItemOrder({
      items: { a: {}, b: {} },
      itemOrder: null,
      collectedOrder: null,
    });
    expect(order).toEqual(['a', 'b']);
  });

  it('itemOrder が壊れている（不足・余剰）場合は有効な ID のみ残し残りを items 順で補う', () => {
    const order = computeEffectiveItemOrder({
      items: { a: {}, b: {}, c: {} },
      itemOrder: ['c', 'ghost'],
      collectedOrder: null,
    });
    expect(order).toEqual(['c', 'a', 'b']);
  });
});

describe('mergeItemOrder（Collector: 人の並びを維持し新規は末尾に追加）', () => {
  it('既存 itemOrder を維持し、新規 found ID を末尾に追加する', () => {
    const order = mergeItemOrder({
      existingOrder: ['b', 'a'],
      existingItemIds: ['a', 'b'],
      foundItemIds: ['a', 'b', 'c'],
    });
    expect(order).toEqual(['b', 'a', 'c']);
  });

  it('orphan（found に無い既存 ID）も削除せず順序を維持する', () => {
    const order = mergeItemOrder({
      existingOrder: ['a', 'orphan', 'b'],
      existingItemIds: ['a', 'orphan', 'b'],
      foundItemIds: ['a', 'b'],
    });
    expect(order).toEqual(['a', 'orphan', 'b']);
  });

  it('existingOrder が無い場合は existingItemIds の順序を基準にする', () => {
    const order = mergeItemOrder({
      existingOrder: null,
      existingItemIds: ['a', 'b'],
      foundItemIds: ['a', 'b', 'c'],
    });
    expect(order).toEqual(['a', 'b', 'c']);
  });
});
