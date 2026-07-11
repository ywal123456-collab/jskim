'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fse = require('fs-extra');
const { buildProject } = require('../scripts/lib/build-project');

const NUNJUCKS_MODULE = require.resolve('nunjucks');

describe('files pipeline', () => {
  const workspaces = [];

  after(async () => {
    for (const workspaceRoot of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await fse.remove(workspaceRoot).catch(() => {});
    }
  });

  it('拡張子変換、copy、data、filter、global をまとめて処理する', async () => {
    const workspaceRoot = await createFilesWorkspace();
    workspaces.push(workspaceRoot);

    const result = await buildProject('sample', {
      workspaceRoot,
      log: false,
    });

    assert.equal(result.project.pipelineMode, 'files');
    assert.ok(result.renderedCount >= 8, '複数 files ルールを render する');
    assert.ok(result.copiedCount >= 2, '複数 files ルールを copy する');

    assert.ok(fs.existsSync(out(workspaceRoot, 'index.html')));
    assert.ok(fs.existsSync(out(workspaceRoot, 'assets/js/main.js')));
    assert.ok(fs.existsSync(out(workspaceRoot, 'assets/css/style.css')));
    assert.ok(fs.existsSync(out(workspaceRoot, 'data.json')));
    assert.ok(fs.existsSync(out(workspaceRoot, 'LICENSE')));
    assert.ok(fs.existsSync(out(workspaceRoot, 'example.njk')));
    assert.ok(fs.existsSync(out(workspaceRoot, 'request/index.html')));
    assert.ok(fs.existsSync(out(workspaceRoot, 'request/assets/js/request.js')));
    assert.ok(fs.existsSync(out(workspaceRoot, 'request/assets/css/request.css')));
    assert.ok(fs.existsSync(out(workspaceRoot, 'extras/note.txt')));
    assert.ok(fs.existsSync(out(workspaceRoot, 'extras/readme.html')));

    assert.equal(fs.existsSync(out(workspaceRoot, 'draft/hidden.html')), false);
    assert.equal(fs.existsSync(out(workspaceRoot, 'assets/js/skip.js')), false);
    assert.equal(
      fs.existsSync(out(workspaceRoot, 'template-output/layouts/base')),
      false,
      'templates[] 配下は直接出力しない'
    );

    const sourceImage = await fsp.readFile(
      path.join(workspaceRoot, 'src/site/pages/assets/image/logo.bin')
    );
    const copiedImage = await fsp.readFile(
      out(workspaceRoot, 'assets/image/logo.bin')
    );
    assert.equal(Buffer.compare(sourceImage, copiedImage), 0);

    const html = await fsp.readFile(out(workspaceRoot, 'index.html'), 'utf8');
    assert.match(html, /<title>Project Site<\/title>/);
    assert.match(html, /default-only: DEFAULT/);
    assert.match(html, /project-only: PROJECT/);
    assert.match(html, /site-language: missing/);
    assert.match(html, /price: 12,000円/);
    assert.match(html, /year: 2099/);
    assert.match(html, /component: Project Site/);
    assert.match(html, /request\/index.html/);

    const nested = await fsp.readFile(
      out(workspaceRoot, 'request/index.html'),
      'utf8'
    );
    assert.match(nested, /root: \.\.\//);
    assert.match(nested, /assets\/js\/request.js/);

    const json = JSON.parse(
      await fsp.readFile(out(workspaceRoot, 'data.json'), 'utf8')
    );
    assert.equal(json.site.name, 'Project Site');
    assert.equal(json.defaultOnly, 'DEFAULT');

    const js = await fsp.readFile(out(workspaceRoot, 'assets/js/main.js'), 'utf8');
    assert.match(js, /const site = \{"name":"Project Site"\};/);
    assert.equal(js.includes('&quot;'), false);
    assert.match(js, /console\.info\(site\.name, 12000\);/);
  });

  it('出力パス衝突を日本語エラーにする', async () => {
    const workspaceRoot = await createFilesWorkspace({
      pages: {
        'assets/js/main.js': 'plain js\n',
      },
    });
    workspaces.push(workspaceRoot);

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      /出力パスが衝突しています/
    );
  });

  it('files.from の path traversal を拒否する', async () => {
    const workspaceRoot = await createFilesWorkspace({
      files: [{ from: '../outside', to: '' }],
    });
    workspaces.push(workspaceRoot);
    await fse.outputFile(path.join(workspaceRoot, 'src/outside/file.txt'), 'x');

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      /許可範囲外/
    );
  });

  it('不正な data 型を拒否する', async () => {
    const workspaceRoot = await createFilesWorkspace({
      projectDataSource: '[]',
    });
    workspaces.push(workspaceRoot);

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      /設定値が不正です: data/
    );
  });

  it('不正な filter 型を拒否する', async () => {
    const workspaceRoot = await createFilesWorkspace({
      filterSource: 'badFilter: "not function",',
    });
    workspaces.push(workspaceRoot);

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      /設定値が不正です: nunjucks\.filters\.badFilter/
    );
  });

  it('Promise を返す filter を非同期エラーにする', async () => {
    const workspaceRoot = await createFilesWorkspace({
      filterSource: `formatPrice() {
          return Promise.resolve('async');
        },
        toJson(value) {
          const nunjucks = require(${JSON.stringify(NUNJUCKS_MODULE)});
          return new nunjucks.runtime.SafeString(JSON.stringify(value));
        },`,
    });
    workspaces.push(workspaceRoot);

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      /非同期filterは現在サポートされていません/
    );
  });

  it('data.rootPath の予約語衝突を拒否する', async () => {
    const workspaceRoot = await createFilesWorkspace({
      dataSource: `{
        site: { name: 'Project Site' },
        rootPath: './',
      }`,
    });
    workspaces.push(workspaceRoot);

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      /data のキーが予約語と衝突しています: rootPath/
    );
  });

  it('files と render の同時設定を拒否する', async () => {
    const workspaceRoot = await createFilesWorkspace({
      renderSource: `[
        { from: 'pages', to: '', include: ['**/*.njk'], extension: '.html' },
      ]`,
    });
    workspaces.push(workspaceRoot);

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      /files と render を同時に設定できません/
    );
  });

  it('files と copy の同時設定を拒否する', async () => {
    const workspaceRoot = await createFilesWorkspace({
      copySource: `[
        { from: 'pages/assets', to: 'assets' },
      ]`,
    });
    workspaces.push(workspaceRoot);

    await assert.rejects(
      () => buildProject('sample', { workspaceRoot, log: false }),
      /files と copy を同時に設定できません/
    );
  });

  it('files-only と legacy-only を空配列で誤検出しない', async () => {
    const filesRoot = await createFilesWorkspace({
      renderSource: '[]',
      copySource: '[]',
    });
    workspaces.push(filesRoot);

    await buildProject('sample', { workspaceRoot: filesRoot, log: false });
    assert.ok(fs.existsSync(out(filesRoot, 'index.html')));

    const legacyRoot = await createLegacyWorkspace();
    workspaces.push(legacyRoot);

    await buildProject('sample', { workspaceRoot: legacyRoot, log: false });
    assert.ok(fs.existsSync(path.join(legacyRoot, 'dist/sample/index.html')));
    assert.ok(fs.existsSync(path.join(legacyRoot, 'dist/sample/assets/plain.txt')));
  });
});

async function createFilesWorkspace(options = {}) {
  const workspaceRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'jskim-files-pipeline-')
  );
  const sourceRoot = path.join(workspaceRoot, 'src/site');

  await fse.outputFile(
    path.join(sourceRoot, 'layouts/base.njk'),
    [
      '<!doctype html>',
      '<html lang="ja">',
      '<head><title>{% block title %}{{ site.name }}{% endblock %}</title></head>',
      '<body>{% include "components/banner.njk" %}{% block content %}{% endblock %}{% block scripts %}{% endblock %}</body>',
      '</html>',
      '',
    ].join('\n')
  );
  await fse.outputFile(
    path.join(sourceRoot, 'components/banner.njk'),
    '<p>component: {{ site.name }}</p>\n'
  );

  const pages = {
    'index.html.njk': [
      '{% extends "layouts/base.njk" %}',
      '{% block content %}',
      '<main>',
      '<p>default-only: {{ defaultOnly }}</p>',
      '<p>project-only: {{ projectOnly }}</p>',
      '<p>site-language: {{ site.language | default("missing", true) }}</p>',
      '<p>price: {{ samplePrice | formatPrice }}</p>',
      '<p>year: {{ currentYear() }}</p>',
      '<a href="{{ rootPath }}request/index.html">request</a>',
      '</main>',
      '{% endblock %}',
      '',
    ].join('\n'),
    'assets/js/main.js.njk': [
      'const site = {{ site | toJson }};',
      'console.info(site.name, {{ samplePrice }});',
      '',
    ].join('\n'),
    'assets/css/style.css.njk': 'body { color: {{ site.themeColor | default("#222") }}; }\n',
    'data.json.njk': '{{ { site: site, defaultOnly: defaultOnly } | toJson }}\n',
    'LICENSE.njk': 'Sample License for {{ site.name }}\n',
    'example.njk.njk': '拡張子: {{ site.name }}\n',
    'request/index.html.njk': [
      '{% extends "layouts/base.njk" %}',
      '{% block content %}',
      '<p>root: {{ rootPath }}</p>',
      '<script src="{{ rootPath }}assets/js/request.js"></script>',
      '{% endblock %}',
      '',
    ].join('\n'),
    'request/assets/js/request.js.njk': 'console.info("request", {{ site | toJson }});\n',
    'request/assets/css/request.css.njk': '.request { color: blue; }\n',
    'request/assets/image/request-logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
    'assets/image/logo.bin': Buffer.from([0, 1, 2, 3, 255]),
    'draft/hidden.html.njk': 'hidden\n',
    'assets/js/skip.js.njk': 'skip\n',
    ...(options.pages || {}),
  };

  for (const [relativePath, content] of Object.entries(pages)) {
    // eslint-disable-next-line no-await-in-loop
    await fse.outputFile(path.join(sourceRoot, 'pages', relativePath), content);
  }

  await fse.outputFile(path.join(sourceRoot, 'extras/note.txt'), 'note\n');
  await fse.outputFile(
    path.join(sourceRoot, 'extras/readme.html.njk'),
    '<p>{{ site.name }}</p>\n'
  );
  await fse.outputFile(
    path.join(sourceRoot, 'extras/excluded/secret.txt'),
    'secret\n'
  );

  await fse.outputFile(
    path.join(workspaceRoot, 'jskim.config.js'),
    configSource(options)
  );

  return workspaceRoot;
}

async function createLegacyWorkspace() {
  const workspaceRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'jskim-legacy-pipeline-')
  );
  await fse.outputFile(
    path.join(workspaceRoot, 'src/site/pages/index.njk'),
    '<p>{{ message }}</p>\n'
  );
  await fse.outputFile(
    path.join(workspaceRoot, 'src/site/assets/plain.txt'),
    'plain\n'
  );
  await fse.outputFile(
    path.join(workspaceRoot, 'jskim.config.js'),
    `module.exports = {
  defaults: {
    files: [],
    render: [
      { from: 'pages', to: '', include: ['**/*.njk'], extension: '.html' },
    ],
    copy: [
      { from: 'assets', to: 'assets' },
    ],
    data: { message: 'legacy' },
  },
  projects: {
    sample: {
      sourceDir: 'src/site',
      outputDir: 'dist/sample',
    },
  },
};
`
  );
  return workspaceRoot;
}

function configSource(options) {
  const filesSource =
    options.filesSource ||
    JSON.stringify(
      options.files || [
        {
          from: 'pages',
          to: '',
          exclude: ['draft/**', '**/*.skip.njk', 'assets/js/skip.js.njk'],
        },
        {
          from: 'extras',
          to: 'extras',
          include: ['**/*.njk', '**/*.txt'],
          exclude: ['excluded/**'],
        },
        {
          from: '.',
          to: 'template-output',
          include: ['layouts/**/*.njk', 'components/**/*.njk'],
        },
      ],
      null,
      6
    );
  const renderSource = options.renderSource || 'undefined';
  const copySource = options.copySource || 'undefined';
  const dataSource =
    options.dataSource ||
    `{
        site: { name: 'Default Site', language: 'ja', themeColor: '#333333' },
        defaultOnly: 'DEFAULT',
        samplePrice: 12000,
      }`;
  const projectDataSource =
    options.projectDataSource ||
    `{
        site: { name: 'Project Site' },
        projectOnly: 'PROJECT',
      }`;
  const filterSource =
    options.filterSource ||
    `formatPrice(value) {
          return \`\${Number(value).toLocaleString('ja-JP')}円\`;
        },
        toJson(value) {
          const nunjucks = require(${JSON.stringify(NUNJUCKS_MODULE)});
          return new nunjucks.runtime.SafeString(JSON.stringify(value));
        },`;

  return `module.exports = {
  defaults: {
    files: ${filesSource},
    render: ${renderSource},
    copy: ${copySource},
    templates: ['layouts', 'components'],
    data: ${dataSource},
    nunjucks: {
      filters: {
        ${filterSource}
      },
      globals: {
        currentYear() {
          return 2099;
        },
      },
    },
    build: { clean: true },
    watch: { debounce: 80 },
    serve: { host: '127.0.0.1', port: 3000 },
    dev: { liveReload: true },
  },
  projects: {
    sample: {
      sourceDir: 'src/site',
      outputDir: 'dist/sample',
      data: ${projectDataSource},
    },
  },
};
`;
}

function out(workspaceRoot, relativePath) {
  return path.join(workspaceRoot, 'dist/sample', relativePath);
}
