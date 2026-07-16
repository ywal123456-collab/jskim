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
    stateStyles: {},
    stateDocumentContexts: {},
    hasDescription: true,
    hasImplementation: true,
    hasPreview: true,
    status: 'linked',
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
    screen.source!.interactions.push({
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

  it('design-only 画面は path/states/interactions が空で items は Description から', () => {
    const screen: LoadedScreen = {
      screenId: 'design-screen',
      sourcePath: null,
      descriptionPath: '/tmp/design-screen.json',
      source: null,
      description: {
        schemaVersion: '1.0',
        screen: { id: 'design-screen', name: '設計中画面', description: '説明文' },
        items: {
          'inquiry-type': { name: '種別', type: 'select', description: '', note: '' },
        },
      },
      snapshots: [],
      stateStyles: {},
      stateDocumentContexts: {},
      hasDescription: true,
      hasImplementation: false,
      hasPreview: false,
      status: 'design-only',
    };

    const payload = createViewerManifest({
      projectName: 'fixture',
      base: '/spec/',
      screens: [screen],
      registeredScreenIds: new Set(['design-screen']),
    });

    const viewerScreen = payload.screens[0];
    expect(viewerScreen.path).toBe('');
    expect(viewerScreen.states).toEqual([]);
    expect(viewerScreen.interactions).toEqual([]);
    expect(viewerScreen.name).toBe('設計中画面');
    expect(viewerScreen.description).toBe('説明文');
    expect(viewerScreen.items['inquiry-type'].name).toBe('種別');
    expect(viewerScreen.itemOrder).toEqual(['inquiry-type']);
    expect(viewerScreen.status).toBe('design-only');
    expect(viewerScreen.hasDescription).toBe(true);
    expect(viewerScreen.hasImplementation).toBe(false);
    expect(viewerScreen.hasPreview).toBe(false);
    expect(payload.manifest.screens[0]).toMatchObject({
      id: 'design-screen',
      path: '',
      status: 'design-only',
    });
    expect(payload.snapshotFiles).toEqual([]);
  });

  it('implementation-only 画面は snapshot から集めた item を空欄 placeholder にする', () => {
    const screen: LoadedScreen = {
      screenId: 'impl-screen',
      sourcePath: '/tmp/impl-screen.spec.json',
      descriptionPath: null,
      source: {
        schemaVersion: '1.0',
        screen: { id: 'impl-screen', path: '/impl-screen' },
        states: [
          { id: 'default', name: '初期', viewer: { visible: true, order: 0 } },
        ],
        interactions: [
          { itemId: 'submit', type: 'state-transition', targetStateId: 'default' },
        ],
      },
      description: null,
      snapshots: [
        {
          stateId: 'default',
          filePath: '/tmp/impl-screen/default.html',
          html: '<div data-jskim-spec-item="submit">送信</div>',
        },
      ],
      stateStyles: {},
      stateDocumentContexts: {},
      hasDescription: false,
      hasImplementation: true,
      hasPreview: true,
      status: 'implementation-only',
    };

    const payload = createViewerManifest({
      projectName: 'fixture',
      base: '/spec/',
      screens: [screen],
      registeredScreenIds: new Set(['impl-screen']),
    });

    const viewerScreen = payload.screens[0];
    expect(viewerScreen.path).toBe('/impl-screen');
    expect(viewerScreen.name).toBe('impl-screen');
    expect(viewerScreen.description).toBe('');
    expect(viewerScreen.states).toHaveLength(1);
    expect(viewerScreen.items.submit).toEqual({
      name: '',
      type: '',
      description: '',
      note: '',
    });
    expect(viewerScreen.status).toBe('implementation-only');
    expect(viewerScreen.hasDescription).toBe(false);
    expect(viewerScreen.hasImplementation).toBe(true);
    expect(viewerScreen.hasPreview).toBe(true);
    expect(payload.snapshotFiles).toHaveLength(1);
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
