import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createViewerManifest } from '../src/builder/create-viewer-manifest.js';
import { sanitizeSnapshot } from '../src/builder/sanitize-snapshot.js';
import { extractElementOuterHtml } from '../src/builder/extract-element.js';
import { computeItemOrder } from '../src/builder/item-order.js';
import type { LoadedScreen } from '../src/builder/load-screen-spec-project.js';

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/state-transition',
);

function loadFixtureScreen(): LoadedScreen {
  const source = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, 'source.spec.json'), 'utf8'),
  );
  const description = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, 'description.json'), 'utf8'),
  );
  const defaultHtml = fs.readFileSync(
    path.join(fixtureRoot, 'snapshots/default.html'),
    'utf8',
  );
  const helpHtml = fs.readFileSync(
    path.join(fixtureRoot, 'snapshots/help-modal.html'),
    'utf8',
  );

  return {
    screenId: 'synthetic-help-demo',
    sourcePath: path.join(fixtureRoot, 'source.spec.json'),
    descriptionPath: path.join(fixtureRoot, 'description.json'),
    source,
    description,
    snapshots: [
      {
        stateId: 'default',
        filePath: path.join(fixtureRoot, 'snapshots/default.html'),
        html: defaultHtml,
      },
      {
        stateId: 'help-modal',
        filePath: path.join(fixtureRoot, 'snapshots/help-modal.html'),
        html: helpHtml,
      },
    ],
  };
}

describe('builder', () => {
  it('sanitizeSnapshot が script と on* 属性を除去する', () => {
    const dirty =
      '<div onclick="alert(1)" onmouseover=\'x()\'>' +
      '<script>evil()</script>本文<script src="x.js"></script></div>';
    const clean = sanitizeSnapshot(dirty);
    expect(clean).not.toMatch(/script/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/onmouseover/i);
    expect(clean).toContain('本文');
  });

  it('未登録の screen-transition 先を unregisteredTarget にする', () => {
    const screen = loadFixtureScreen();
    screen.source.interactions.push({
      itemId: 'open-help-button',
      type: 'screen-transition',
      category: 'navigation',
      targetScreenId: 'missing-screen',
      label: '未登録へ',
    });

    const payload = createViewerManifest({
      projectName: 'fixture',
      base: '/spec/',
      screens: [screen],
      registeredScreenIds: new Set(['synthetic-help-demo']),
    });

    const unregistered = payload.screens[0].interactions.find(
      (i) => i.targetScreenId === 'missing-screen',
    );
    expect(unregistered?.unregisteredTarget).toBe(true);

    const registered = payload.screens[0].interactions.find(
      (i) => i.type === 'state-transition',
    );
    expect(registered?.unregisteredTarget).toBeUndefined();
  });

  it('state-transition fixture の itemOrder が状態横断で結合される', () => {
    const screen = loadFixtureScreen();
    const payload = createViewerManifest({
      projectName: 'fixture',
      base: '/spec/',
      screens: [screen],
      registeredScreenIds: new Set(['synthetic-help-demo']),
    });

    expect(payload.screens[0].itemOrder).toEqual([
      'open-help-button',
      'terms-link',
      'help-title',
      'close-help-button',
    ]);
    expect(payload.screens[0].states.map((s) => s.id)).toEqual([
      'default',
      'help-modal',
    ]);
  });

  it('extractElementOuterHtml が画面 root を切り出す', () => {
    const html =
      '<html><body><header>x</header>' +
      '<main data-jskim-spec-screen="demo"><div data-jskim-spec-item="a">A</div></main>' +
      '<footer>y</footer></body></html>';
    const outer = extractElementOuterHtml(html, 'data-jskim-spec-screen', 'demo');
    expect(outer).toContain('data-jskim-spec-screen="demo"');
    expect(outer).toContain('data-jskim-spec-item="a"');
    expect(outer).not.toContain('<header>');
  });

  it('help-modal 切替後の DOM 項目が増える', () => {
    const defaultHtml = fs.readFileSync(
      path.join(fixtureRoot, 'snapshots/default.html'),
      'utf8',
    );
    const helpHtml = fs.readFileSync(
      path.join(fixtureRoot, 'snapshots/help-modal.html'),
      'utf8',
    );
    const defaultIds = computeItemOrder([
      { id: 'default', viewer: { visible: true, order: 10 }, html: defaultHtml },
    ]);
    const both = computeItemOrder([
      { id: 'default', viewer: { visible: true, order: 10 }, html: defaultHtml },
      { id: 'help-modal', viewer: { visible: true, order: 20 }, html: helpHtml },
    ]);
    expect(both.length).toBeGreaterThan(defaultIds.length);
    expect(both).toContain('help-title');
  });
});
