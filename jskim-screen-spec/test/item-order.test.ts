import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeItemOrder,
  extractItemIdsInDomOrder,
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
