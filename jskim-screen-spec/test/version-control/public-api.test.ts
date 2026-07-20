import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as features from '../../src/features/index.js';
import * as versionControl from '../../src/version-control/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '../..');

describe('package public API (7E-1)', () => {
  it('features / version-control barrel から最小 API を解決できる', () => {
    expect(typeof features.loadScreenFeatures).toBe('function');
    expect(typeof features.persistScreenFeatures).toBe('function');
    expect(typeof features.validateScreenFeatureFile).toBe('function');
    expect(typeof versionControl.initVersionRepository).toBe('function');
    expect(typeof versionControl.writeVersionObject).toBe('function');
    expect(typeof versionControl.readVersionObject).toBe('function');
    expect(typeof versionControl.hasVersionObject).toBe('function');
    expect(typeof versionControl.hashVersionObject).toBe('function');
    expect(typeof versionControl.createWorkingSnapshot).toBe('function');
    expect(typeof versionControl.persistSnapshotObjects).toBe('function');
    expect(typeof versionControl.getVersionStatus).toBe('function');
    expect(typeof versionControl.diffVersionTrees).toBe('function');
    expect(typeof versionControl.readVersionIndex).toBe('function');
    expect(typeof versionControl.readVersionHead).toBe('function');
    expect(typeof versionControl.stageProject).toBe('function');
    expect(typeof versionControl.stageScreen).toBe('function');
    expect(typeof versionControl.stageFeature).toBe('function');
    expect(features.FeatureError).toBeTypeOf('function');
    expect(versionControl.VersionControlError).toBeTypeOf('function');
    expect(versionControl.MAX_VERSION_OBJECT_BYTES).toBeGreaterThanOrEqual(
      20 * 1024 * 1024,
    );
  });

  it('dist に features / version-control と root re-export が含まれる', () => {
    const indexSrc = fs.readFileSync(path.join(pkgRoot, 'src/index.ts'), 'utf8');
    expect(indexSrc).toContain("from './features/index.js'");
    expect(indexSrc).toContain("from './version-control/index.js'");
    expect(indexSrc).toContain('loadScreenFeatures');
    expect(indexSrc).toContain('initVersionRepository');
    expect(fs.existsSync(path.join(pkgRoot, 'dist/features/index.js'))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(pkgRoot, 'dist/version-control/index.js')),
    ).toBe(true);
    const distIndex = fs.readFileSync(
      path.join(pkgRoot, 'dist/index.js'),
      'utf8',
    );
    expect(distIndex).toContain('loadScreenFeatures');
    expect(distIndex).toContain('initVersionRepository');
  });
});
