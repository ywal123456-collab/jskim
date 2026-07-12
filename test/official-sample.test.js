'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { REPO_ROOT } = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');
const { classifyReload } = require('../scripts/lib/classify-reload');

const SAMPLE_SRC = path.join(REPO_ROOT, 'src/sample');
const DIST = path.join(REPO_ROOT, 'dist/sample');
const BUILD = path.join(REPO_ROOT, 'scripts/build.js');

const CRUD_HTML = [
  'crud/index.html',
  'crud/detail.html',
  'crud/create.html',
  'crud/edit.html',
  'crud/delete.html',
  'crud/complete.html',
];

const WIZARD_HTML = [
  'wizard/input.html',
  'wizard/confirm.html',
  'wizard/complete.html',
];

describe('official sample (Portal / Dashboard / CRUD / Wizard)', () => {
  it('jskim build sample が全公式 sample を生成する', async () => {
    const cli = runCli({
      scriptPath: BUILD,
      cwd: REPO_ROOT,
      args: ['sample'],
      timeoutMs: 20000,
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /レンダリングしたファイル数: 11/);
    assert.match(result.output, /コピーしたファイル数: 5/);

    const expectedFiles = [
      'index.html',
      'dashboard/index.html',
      'assets/css/common.css',
      'assets/img/logo.svg',
      'dashboard/assets/css/dashboard.css',
      ...CRUD_HTML,
      'crud/assets/css/crud.css',
      ...WIZARD_HTML,
      'wizard/assets/css/wizard.css',
    ];
    for (const rel of expectedFiles) {
      assert.ok(fs.existsSync(path.join(DIST, rel)), `出力があるべき: ${rel}`);
    }

    const allFiles = listFiles(DIST);
    const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));
    assert.equal(htmlFiles.length, 11);
    assert.equal(allFiles.some((f) => f.endsWith('.njk')), false);
    assert.equal(allFiles.some((f) => f.endsWith('.js')), false);
    assert.equal(allFiles.some((f) => f.includes('request/')), false);
    assert.equal(
      allFiles.some((f) => f.startsWith('layouts/') || f.startsWith('components/')),
      false
    );
  });

  it('Portal から 3 画面群へ移動でき、準備中が残っていない', async () => {
    const portal = await fsp.readFile(path.join(DIST, 'index.html'), 'utf8');
    assert.match(portal, /href="\.\/dashboard\/index\.html"/);
    assert.match(portal, /href="\.\/crud\/index\.html"/);
    assert.match(portal, /href="\.\/wizard\/input\.html"/);
    assert.equal(portal.includes('準備中'), false);
    assert.equal(portal.includes('card--pending'), false);
  });

  it('Dashboard / Sidebar から Wizard へ移動できる', async () => {
    const dashboard = await fsp.readFile(
      path.join(DIST, 'dashboard/index.html'),
      'utf8'
    );
    assert.match(dashboard, /href="\.\.\/wizard\/input\.html"/);
    assert.equal(dashboard.includes('Wizard（準備中）'), false);
    assert.equal(dashboard.includes('準備中'), false);

    const list = await fsp.readFile(path.join(DIST, 'crud/index.html'), 'utf8');
    assert.match(list, /href="\.\.\/wizard\/input\.html"/);
  });

  it('CRUD 主要テキストとリンクが維持される', async () => {
    const list = await fsp.readFile(path.join(DIST, 'crud/index.html'), 'utf8');
    const detail = await fsp.readFile(path.join(DIST, 'crud/detail.html'), 'utf8');
    assert.match(list, /商品一覧/);
    assert.match(list, /サンプル商品A/);
    assert.match(list, /公開/);
    assert.match(list, /非公開/);
    assert.match(list, /下書き/);
    assert.match(detail, /商品詳細/);
    assert.match(detail, /href="edit\.html"/);
  });

  it('Wizard 主要テキスト・step・リンクが正しい', async () => {
    const input = await fsp.readFile(path.join(DIST, 'wizard/input.html'), 'utf8');
    const confirm = await fsp.readFile(
      path.join(DIST, 'wizard/confirm.html'),
      'utf8'
    );
    const complete = await fsp.readFile(
      path.join(DIST, 'wizard/complete.html'),
      'utf8'
    );

    assert.match(input, /情報入力/);
    assert.match(input, /氏名/);
    assert.match(input, /メールアドレス/);
    assert.match(input, /電話番号/);
    assert.match(input, /お問い合わせ種別/);
    assert.match(input, /お問い合わせ内容/);
    assert.match(input, /入力内容の保存、画面間の引き継ぎおよび送信処理は行いません/);
    assert.match(input, /href="confirm\.html"/);
    assert.match(input, /href="\.\.\/index\.html"/);
    assert.equal((input.match(/aria-current="step"/g) || []).length, 1);

    assert.match(confirm, /入力内容確認/);
    assert.match(confirm, /山田 太郎/);
    assert.match(confirm, /taro@example\.com/);
    assert.match(confirm, /入力画面の内容は引き継がれていません/);
    assert.match(confirm, /href="input\.html"/);
    assert.match(confirm, /href="complete\.html"/);
    assert.equal((confirm.match(/aria-current="step"/g) || []).length, 1);

    assert.match(complete, />完了</);
    assert.match(complete, /入力内容の送信および保存は行われていません/);
    assert.match(complete, /href="input\.html"/);
    assert.match(complete, /href="\.\.\/index\.html"/);
    assert.equal((complete.match(/aria-current="step"/g) || []).length, 1);

    for (const html of [input, confirm, complete]) {
      assert.match(html, /情報入力/);
      assert.match(html, /入力内容確認/);
      assert.match(html, /wizard-steps/);
    }
  });

  it('内部 HTML リンクと CSS / 画像参照が実ファイルへ解決できる', async () => {
    const pages = [
      'index.html',
      'dashboard/index.html',
      ...CRUD_HTML,
      ...WIZARD_HTML,
    ];
    for (const rel of pages) {
      // eslint-disable-next-line no-await-in-loop
      await assertResolvedLinks(path.join(DIST, rel));
    }
  });

  it('Wizard page-local CSS と共通 asset の href が正しい', async () => {
    for (const rel of WIZARD_HTML) {
      const html = await fsp.readFile(path.join(DIST, rel), 'utf8');
      assert.match(html, /href="\.\.\/assets\/css\/common\.css"/);
      assert.match(html, /href="assets\/css\/wizard\.css"/);
      assert.match(html, /src="\.\.\/assets\/img\/logo\.svg"/);
      assert.equal(html.includes('href="../assets/css/wizard.css"'), false);
    }
  });

  it('source sample に request / JavaScript が残っていない', () => {
    const files = listFiles(SAMPLE_SRC);
    assert.equal(files.some((f) => f.includes('request/')), false);
    assert.equal(
      files.some((f) => f.endsWith('.js') || f.endsWith('.js.njk')),
      false
    );
    assert.ok(files.includes('components/wizard-steps.njk'));
    assert.ok(files.includes('pages/wizard/input.html.njk'));
    assert.ok(files.includes('pages/wizard/assets/css/wizard.css'));
  });

  it('平文 CSS は CSS soft reload 分類の対象になる', () => {
    for (const rel of [
      'pages/dashboard/assets/css/dashboard.css',
      'pages/crud/assets/css/crud.css',
      'pages/wizard/assets/css/wizard.css',
    ]) {
      const kind = classifyReload({
        events: [{ event: 'change', absolutePath: path.join(SAMPLE_SRC, rel) }],
        sourceDir: SAMPLE_SRC,
        templates: ['layouts', 'components'],
      });
      assert.equal(kind, 'css', rel);
    }
  });
});

function listFiles(root, base = root, acc = []) {
  if (!fs.existsSync(root)) {
    return acc;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      listFiles(abs, base, acc);
    } else {
      acc.push(path.relative(base, abs).split(path.sep).join('/'));
    }
  }
  return acc.sort();
}

/**
 * @param {string} htmlFile
 */
async function assertResolvedLinks(htmlFile) {
  const html = await fsp.readFile(htmlFile, 'utf8');
  const baseUrl = pathToFileURL(htmlFile).href;
  const attrs = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]);

  for (const raw of attrs) {
    if (
      !raw ||
      raw.startsWith('#') ||
      raw.startsWith('mailto:') ||
      /^https?:\/\//i.test(raw) ||
      /^javascript:/i.test(raw)
    ) {
      continue;
    }
    const resolved = new URL(raw, baseUrl);
    assert.equal(resolved.protocol, 'file:');
    const filePath = fileURLToPath(resolved);
    assert.ok(
      fs.existsSync(filePath),
      `リンク先が存在すべき: ${raw} -> ${filePath} (from ${htmlFile})`
    );
  }
}
