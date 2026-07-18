import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyScreenSpecWatchPath,
  mergeScreenSpecWatchKinds,
} from '../../src/watch/classify-watch-path.js';

const rootDir = path.resolve('/workspace');
const sourceDir = path.join(rootDir, 'src', 'sample');
const projectName = 'sample';

function classify(rel: string) {
  return classifyScreenSpecWatchPath({
    rootDir,
    projectName,
    sourceDir,
    filePath: path.join(rootDir, ...rel.split('/')),
  });
}

describe('classifyScreenSpecWatchPath', () => {
  it('page source は COLLECT_AND_BUILD', () => {
    expect(classify('src/sample/pages/crud/create.html.njk')).toBe(
      'COLLECT_AND_BUILD',
    );
  });

  it('layout は COLLECT_AND_BUILD', () => {
    expect(classify('src/sample/layouts/base.njk')).toBe('COLLECT_AND_BUILD');
  });

  it('asset は COLLECT_AND_BUILD', () => {
    expect(classify('src/sample/pages/assets/css/common.css')).toBe(
      'COLLECT_AND_BUILD',
    );
  });

  it('.spec.json は COLLECT_AND_BUILD', () => {
    expect(classify('src/sample/pages/crud/create.spec.json')).toBe(
      'COLLECT_AND_BUILD',
    );
  });

  it('Description JSON は BUILD_ONLY', () => {
    expect(classify('spec/sample/src/data/crud-create.json')).toBe('BUILD_ONLY');
  });

  it('theme は BUILD_ONLY', () => {
    expect(classify('spec/sample/src/theme/preview.css')).toBe('BUILD_ONLY');
  });

  it('snapshots / resources / dist は IGNORE、captures/references meta.json は BUILD_ONLY', () => {
    expect(classify('spec/sample/src/snapshots/crud-create/default.html')).toBe(
      'IGNORE',
    );
    expect(classify('spec/sample/src/resources/files/abc.css')).toBe('IGNORE');
    expect(
      classify('spec/sample/src/captures/demo/default/pc/meta.json'),
    ).toBe('BUILD_ONLY');
    expect(
      classify(
        `spec/sample/src/captures/demo/default/pc/capture-${'a'.repeat(64)}.png`,
      ),
    ).toBe('IGNORE');
    expect(
      classify('spec/sample/src/captures/demo/default/pc/.capture-temp.1.png.tmp'),
    ).toBe('IGNORE');
    expect(
      classify('spec/sample/src/references/inquiry-input/pc/meta.json'),
    ).toBe('BUILD_ONLY');
    expect(
      classify(
        `spec/sample/src/references/inquiry-input/pc/reference-${'a'.repeat(64)}.png`,
      ),
    ).toBe('IGNORE');
    expect(
      classify(
        'spec/sample/src/references/inquiry-input/pc/.reference-temp.1.png.tmp',
      ),
    ).toBe('IGNORE');
    expect(classify('spec/sample/dist/index.html')).toBe('IGNORE');
  });

  it('batch 優先度は COLLECT_AND_BUILD > BUILD_ONLY', () => {
    expect(
      mergeScreenSpecWatchKinds(['BUILD_ONLY', 'COLLECT_AND_BUILD', 'IGNORE']),
    ).toBe('COLLECT_AND_BUILD');
    expect(mergeScreenSpecWatchKinds(['IGNORE', 'BUILD_ONLY'])).toBe(
      'BUILD_ONLY',
    );
    expect(mergeScreenSpecWatchKinds(['IGNORE'])).toBe('IGNORE');
  });
});
