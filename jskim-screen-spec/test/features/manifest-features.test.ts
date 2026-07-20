import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createViewerManifest } from '../../src/builder/create-viewer-manifest.js';
import { loadScreenSpecProject } from '../../src/builder/load-screen-spec-project.js';
import {
  loadScreenFeatures,
  persistScreenFeatures,
  projectBrowserSafeFeatureManifest,
} from '../../src/features/index.js';

const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-feat-manifest-'));
  temps.push(dir);
  return dir;
}

function writeProject(root: string, projectName: string, screenIds: string[]): void {
  for (const id of screenIds) {
    const dataDir = path.join(root, 'spec', projectName, 'src', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, `${id}.json`),
      `${JSON.stringify(
        {
          schemaVersion: '1.2',
          screen: { id, name: id },
          itemOrder: [],
          excludedItems: {},
          items: {},
        },
        null,
        2,
      )}\n`,
    );
    const pagesDir = path.join(root, 'src', projectName, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.writeFileSync(
      path.join(pagesDir, `${id}.spec.json`),
      `${JSON.stringify(
        {
          schemaVersion: '1.0',
          screen: { id, path: `/${id}` },
          states: [{ id: 'default', name: 'Default' }],
          interactions: [],
        },
        null,
        2,
      )}\n`,
    );
  }
}

function buildManifest(root: string, projectName: string) {
  const project = loadScreenSpecProject({ rootDir: root, projectName });
  const knownScreenIds = project.screens.map((s) => s.screenId);
  const loadedFeatures = loadScreenFeatures({
    rootDir: root,
    projectName,
    knownScreenIds,
  });
  const featureManifest =
    loadedFeatures.features.length > 0
      ? projectBrowserSafeFeatureManifest({
          features: loadedFeatures.features,
          ungroupedScreenIds: loadedFeatures.ungroupedScreenIds,
        })
      : null;
  return createViewerManifest({
    projectName,
    base: '/spec/',
    screens: project.screens,
    registeredScreenIds: new Set(knownScreenIds),
    featureManifest,
  }).manifest;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Viewer manifest Feature hierarchy', () => {
  const screens = ['screen-a', 'screen-b', 'screen-c'];

  it('features 無しは flat 互換（manifest に features を含めない）', () => {
    const root = tempRoot();
    writeProject(root, 'demo', screens);
    const manifest = buildManifest(root, 'demo');
    expect(manifest.features).toBeUndefined();
    expect(manifest.ungroupedScreenIds).toBeUndefined();
    expect(manifest.screens).toHaveLength(3);
  });

  it('Feature 順序と Ungrouped 順序を manifest に反映する', () => {
    const root = tempRoot();
    writeProject(root, 'demo', screens);
    persistScreenFeatures({
      rootDir: root,
      projectName: 'demo',
      knownScreenIds: screens,
      document: {
        schemaVersion: '1.0',
        features: [
          {
            featureId: 'beta',
            name: 'Beta',
            displayOrder: 20,
            screenIds: ['screen-b'],
          },
          {
            featureId: 'alpha',
            name: 'Alpha',
            displayOrder: 10,
            screenIds: ['screen-a'],
          },
        ],
      },
    });
    const manifest = buildManifest(root, 'demo');
    expect(manifest.features?.map((f) => f.featureId)).toEqual(['alpha', 'beta']);
    expect(manifest.features?.[0].screenIds).toEqual(['screen-a']);
    expect(manifest.ungroupedScreenIds).toEqual(['screen-c']);
    const text = JSON.stringify(manifest, null, 2);
    expect(text).not.toMatch(/revision|expectedRevision|\.jskim|features\.lock/);
  });

  it('empty Feature も hierarchy に含める', () => {
    const root = tempRoot();
    writeProject(root, 'demo', screens);
    persistScreenFeatures({
      rootDir: root,
      projectName: 'demo',
      knownScreenIds: screens,
      document: {
        schemaVersion: '1.0',
        features: [
          {
            featureId: 'empty-group',
            name: 'Empty',
            displayOrder: 10,
            screenIds: [],
          },
        ],
      },
    });
    const manifest = buildManifest(root, 'demo');
    expect(manifest.features?.some((f) => f.featureId === 'empty-group')).toBe(
      true,
    );
  });

  it('XSS 文字列を JSON として安全に保持する', () => {
    const root = tempRoot();
    writeProject(root, 'demo', screens);
    const xss = '</script><script>window.__FEATURE_XSS__=1</script>';
    persistScreenFeatures({
      rootDir: root,
      projectName: 'demo',
      knownScreenIds: screens,
      document: {
        schemaVersion: '1.0',
        features: [
          {
            featureId: 'xss-feature',
            name: xss,
            displayOrder: 10,
            screenIds: ['screen-a'],
          },
        ],
      },
    });
    const manifest = buildManifest(root, 'demo');
    expect(manifest.features?.[0].name).toBe(xss);
    const loaded = loadScreenFeatures({
      rootDir: root,
      projectName: 'demo',
      knownScreenIds: screens,
    });
    expect(loaded.features[0].name).toBe(xss);
  });
});
