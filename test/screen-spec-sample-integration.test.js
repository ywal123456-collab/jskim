'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fse = require('fs-extra');
const { REPO_ROOT } = require('./helpers/create-test-workspace');
const { buildProject } = require('../scripts/lib/build-project');
const {
  stripScreenSpecAttributes,
} = require('../scripts/lib/strip-screen-spec-attributes');

const SOURCE_SCHEMA_URI =
  'https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/source-spec.v1.schema.json';
const DESCRIPTION_SCHEMA_URI =
  'https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/description-spec.v1.schema.json';

const PILOT_PAGES = [
  {
    id: 'crud-create',
    htmlRel: 'crud/create.html',
    sourceSpec: 'pages/crud/create.spec.json',
    description: 'crud-create.json',
  },
  {
    id: 'wizard-input',
    htmlRel: 'wizard/input.html',
    sourceSpec: 'pages/wizard/input.spec.json',
    description: 'wizard-input.json',
  },
  {
    id: 'wizard-confirm',
    htmlRel: 'wizard/confirm.html',
    sourceSpec: 'pages/wizard/confirm.spec.json',
    description: 'wizard-confirm.json',
  },
  {
    id: 'wizard-complete',
    htmlRel: 'wizard/complete.html',
    sourceSpec: 'pages/wizard/complete.spec.json',
    description: 'wizard-complete.json',
  },
];

const ATTR_RE = {
  screen: /data-jskim-spec-screen="([^"]+)"/g,
  item: /data-jskim-spec-item="([^"]+)"/g,
  action: /data-jskim-spec-action="([^"]+)"/g,
};

describe('Screen Spec sample integration', () => {
  const temps = [];

  after(async () => {
    for (const dir of temps) {
      // eslint-disable-next-line no-await-in-loop
      await fse.remove(dir).catch(() => {});
    }
  });

  async function makeSampleWorkspace() {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'jskim-screen-spec-')
    );
    temps.push(workspaceRoot);
    await fse.copy(
      path.join(REPO_ROOT, 'jskim.config.js'),
      path.join(workspaceRoot, 'jskim.config.js')
    );
    await fse.copy(
      path.join(REPO_ROOT, 'src/sample'),
      path.join(workspaceRoot, 'src/sample')
    );
    return workspaceRoot;
  }

  it('production build: 件数・sidecar 除外・pilot attribute 除去', async () => {
    const workspaceRoot = await makeSampleWorkspace();
    const result = await buildProject('sample', {
      workspaceRoot,
      log: false,
    });

    assert.equal(result.renderedCount, 11);
    assert.equal(result.copiedCount, 5);

    const dist = path.join(workspaceRoot, 'dist/sample');
    const allFiles = listRelativeFiles(dist);
    assert.equal(
      allFiles.some((f) => f.endsWith('.spec.json')),
      false,
      'dist に .spec.json が残ってはいけない'
    );

    const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));
    const cssFiles = allFiles.filter((f) => f.endsWith('.css'));
    const svgFiles = allFiles.filter((f) => f.endsWith('.svg'));
    const jsFiles = allFiles.filter((f) => f.endsWith('.js'));
    assert.equal(htmlFiles.length, 11);
    assert.equal(cssFiles.length, 4);
    assert.equal(svgFiles.length, 1);
    assert.equal(jsFiles.length, 0);

    for (const page of PILOT_PAGES) {
      const html = await fsp.readFile(path.join(dist, page.htmlRel), 'utf8');
      assert.equal(
        html.includes('data-jskim-spec-'),
        false,
        `production に attribute が残っている: ${page.htmlRel}`
      );
    }
  });

  it('preserve mode で attribute が残り、strip すると production と一致する', async () => {
    const workspaceRoot = await makeSampleWorkspace();

    await buildProject('sample', {
      workspaceRoot,
      log: false,
      preserveScreenSpecAttributes: false,
    });
    const dist = path.join(workspaceRoot, 'dist/sample');
    const productionByRel = {};
    for (const page of PILOT_PAGES) {
      productionByRel[page.htmlRel] = await fsp.readFile(
        path.join(dist, page.htmlRel),
        'utf8'
      );
      assert.equal(
        productionByRel[page.htmlRel].includes('data-jskim-spec-'),
        false
      );
    }

    await buildProject('sample', {
      workspaceRoot,
      log: false,
      preserveScreenSpecAttributes: true,
    });

    for (const page of PILOT_PAGES) {
      const preserveHtml = await fsp.readFile(
        path.join(dist, page.htmlRel),
        'utf8'
      );
      assert.match(
        preserveHtml,
        new RegExp(`data-jskim-spec-screen="${page.id}"`)
      );
      assert.ok(
        preserveHtml.includes('data-jskim-spec-item='),
        `item が必要: ${page.htmlRel}`
      );
      assert.equal(
        stripScreenSpecAttributes(preserveHtml),
        productionByRel[page.htmlRel],
        `strip(preserve) === production: ${page.htmlRel}`
      );
    }
  });

  it('preserve HTML の screen / item / action が JSON と一致する', async () => {
    const workspaceRoot = await makeSampleWorkspace();
    await buildProject('sample', {
      workspaceRoot,
      log: false,
      preserveScreenSpecAttributes: true,
    });
    const dist = path.join(workspaceRoot, 'dist/sample');
    const sampleSrc = path.join(REPO_ROOT, 'src/sample');
    const dataDir = path.join(REPO_ROOT, 'spec/sample/src/data');

    for (const page of PILOT_PAGES) {
      const html = await fsp.readFile(path.join(dist, page.htmlRel), 'utf8');
      const source = JSON.parse(
        await fsp.readFile(path.join(sampleSrc, page.sourceSpec), 'utf8')
      );
      const description = JSON.parse(
        await fsp.readFile(path.join(dataDir, page.description), 'utf8')
      );

      assert.equal(source.$schema, SOURCE_SCHEMA_URI);
      assert.equal(description.$schema, DESCRIPTION_SCHEMA_URI);
      assert.equal(source.screen.id, page.id);
      assert.equal(description.screen.id, page.id);

      const screens = [...html.matchAll(ATTR_RE.screen)].map((m) => m[1]);
      assert.deepEqual(screens, [page.id]);

      const items = unique([...html.matchAll(ATTR_RE.item)].map((m) => m[1]));
      const descItems = Object.keys(description.items).sort();
      assert.deepEqual(items.slice().sort(), descItems);

      const actions = unique(
        [...html.matchAll(ATTR_RE.action)].map((m) => m[1])
      );
      const interactionItemIds = source.interactions.map((x) => x.itemId).sort();
      assert.deepEqual(actions.slice().sort(), interactionItemIds);

      for (const actionId of actions) {
        assert.ok(
          items.includes(actionId),
          `action「${actionId}」は item としても存在するべき`
        );
      }
    }
  });

  it('repository と create-jskim/template の sample / spec が一致する', async () => {
    await assertDirectoryMirror(
      path.join(REPO_ROOT, 'src/sample'),
      path.join(REPO_ROOT, 'create-jskim/template/src/sample')
    );
    await assertDirectoryMirror(
      path.join(REPO_ROOT, 'spec/sample'),
      path.join(REPO_ROOT, 'create-jskim/template/spec/sample')
    );
  });
});

/**
 * @param {string} root
 * @param {string} [base]
 * @param {string[]} [acc]
 */
function listRelativeFiles(root, base = root, acc = []) {
  if (!fs.existsSync(root)) {
    return acc;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    // viewer 成果物 dist は gitignore 対象のため mirror 比較から除外
    if (entry.isDirectory() && entry.name === 'dist') {
      continue;
    }
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      listRelativeFiles(abs, base, acc);
    } else {
      acc.push(path.relative(base, abs).split(path.sep).join('/'));
    }
  }
  return acc.sort();
}

/**
 * @param {string[]} values
 */
function unique(values) {
  return [...new Set(values)];
}

/**
 * @param {string} aRoot
 * @param {string} bRoot
 */
async function assertDirectoryMirror(aRoot, bRoot) {
  const aFiles = listRelativeFiles(aRoot);
  const bFiles = listRelativeFiles(bRoot);
  assert.deepEqual(bFiles, aFiles);
  for (const rel of aFiles) {
    const a = await fsp.readFile(path.join(aRoot, rel), 'utf8');
    const b = await fsp.readFile(path.join(bRoot, rel), 'utf8');
    assert.equal(a, b, `内容が一致すべき: ${rel}`);
  }
}
