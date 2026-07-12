'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fse = require('fs-extra');
const { REPO_ROOT } = require('./helpers/create-test-workspace');
const { runNpm } = require('./helpers/run-npm');
const { runCli } = require('./helpers/run-cli');
const { waitForOutput, waitFor, sleep } = require('./helpers/wait-for-output');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest } = require('./helpers/http-request');

const ENGINE_PKG = require(path.join(REPO_ROOT, 'package.json'));
const CREATE_PKG = require(path.join(REPO_ROOT, 'create-jskim/package.json'));
const CREATE_DIR = path.join(REPO_ROOT, 'create-jskim');

describe('create-jskim package pack and e2e', { timeout: 240000 }, () => {
  let workDir;
  let engineTarball;
  let creatorTarball;
  let runnerRoot;
  let generatedRoot;
  let installedCreateBin;
  const children = [];

  before(async () => {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jskim-create-pack-'));

    // engine tarball
    {
      const enginePackDir = path.join(workDir, 'engine-pack');
      await fsp.mkdir(enginePackDir);
      const { stdout } = await runNpm(REPO_ROOT, [
        'pack',
        '--json',
        '--pack-destination',
        enginePackDir,
      ]);
      const meta = parsePackJson(stdout);
      engineTarball = path.join(enginePackDir, meta.filename);
      assert.ok(fs.existsSync(engineTarball));

      const paths = packPaths(meta);
      assert.equal(
        paths.some(
          (p) => p.startsWith('create-jskim/') || p === 'create-jskim'
        ),
        false,
        'engine tarball に create-jskim を含めてはいけない'
      );
    }

    // creator tarball
    {
      const creatorPackDir = path.join(workDir, 'creator-pack');
      await fsp.mkdir(creatorPackDir);
      const { stdout } = await runNpm(REPO_ROOT, [
        'pack',
        CREATE_DIR,
        '--json',
        '--pack-destination',
        creatorPackDir,
      ]);
      const meta = parsePackJson(stdout);
      creatorTarball = path.join(creatorPackDir, meta.filename);
      assert.ok(fs.existsSync(creatorTarball));

      const paths = packPaths(meta);
      assert.ok(
        paths.some((p) => p === 'LICENSE' || p.endsWith('/LICENSE')),
        'LICENSE が含まれるべき'
      );
      assert.ok(
        paths.some(
          (p) => p === 'bin/create-jskim.js' || p.endsWith('bin/create-jskim.js')
        ),
        'bin/create-jskim.js が含まれるべき'
      );
      assert.equal(
        paths.some((p) => p.includes('template/LICENSE')),
        false,
        'template LICENSE を含めてはいけない'
      );
      assert.ok(
        paths.some((p) => p.includes('lib/create-project.js')),
        'lib が含まれるべき'
      );
      assert.ok(
        paths.some((p) => p.includes('template/gitignore')),
        'template/gitignore が含まれるべき'
      );
      assert.ok(
        paths.some((p) =>
          p.includes('template/src/sample/pages/index.html.njk')
        ),
        'template sample が含まれるべき'
      );
      assert.ok(
        paths.some((p) => p === 'README.md' || p.endsWith('README.md')),
        'README が含まれるべき'
      );

      const forbidden = ['test/', 'node_modules/', 'AGENTS.md', '.cursor/'];
      for (const needle of forbidden) {
        const hit = paths.find((p) =>
          needle.endsWith('/')
            ? p === needle.slice(0, -1) || p.startsWith(needle)
            : p === needle || p.endsWith(`/${needle}`)
        );
        assert.equal(
          hit,
          undefined,
          `${needle} は creator tarball に含めてはいけない`
        );
      }
    }

    runnerRoot = path.join(workDir, 'creator-runner');
    await fsp.mkdir(runnerRoot);
    await fsp.writeFile(
      path.join(runnerRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'jskim-creator-runner',
          version: '1.0.0',
          private: true,
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    await runNpm(runnerRoot, ['install', creatorTarball]);
    const pkgDir = path.join(runnerRoot, 'node_modules', CREATE_PKG.name);
    assert.ok(fs.existsSync(pkgDir));
    installedCreateBin = path.join(pkgDir, 'bin/create-jskim.js');
    assert.ok(fs.existsSync(installedCreateBin));
  });

  after(async () => {
    for (const child of children) {
      // eslint-disable-next-line no-await-in-loop
      await child.forceKill().catch(() => {});
    }
    if (workDir) {
      await fse.remove(workDir).catch(() => {});
    }
    for (const name of fs.readdirSync(REPO_ROOT)) {
      if (/^(jskim|create-jskim|ywal123456-jskim)-.*\.tgz$/i.test(name)) {
        // eslint-disable-next-line no-await-in-loop
        await fse.remove(path.join(REPO_ROOT, name)).catch(() => {});
      }
    }
  });

  it('外部 runner から生成し install / build / dev できる', async () => {
    const engineSpec = toFileSpec(engineTarball);

    const create = runCli({
      scriptPath: installedCreateBin,
      cwd: runnerRoot,
      args: ['generated-project'],
      timeoutMs: 20000,
      env: { JSKIM_ENGINE_SPEC: engineSpec },
    });
    const createResult = await create.waitForExit();
    assert.equal(createResult.code, 0, createResult.output);
    assert.match(createResult.output, /JSKimプロジェクトを作成しました/);

    generatedRoot = path.join(runnerRoot, 'generated-project');
    assert.ok(fs.existsSync(path.join(generatedRoot, 'package.json')));
    assert.ok(fs.existsSync(path.join(generatedRoot, '.gitignore')));
    assert.ok(
      fs.existsSync(path.join(generatedRoot, 'src/sample/pages/index.html.njk'))
    );

    // 自動 install / git なし
    assert.equal(fs.existsSync(path.join(generatedRoot, 'node_modules')), false);
    assert.equal(
      fs.existsSync(path.join(generatedRoot, 'package-lock.json')),
      false
    );
    assert.equal(fs.existsSync(path.join(generatedRoot, '.git')), false);

    const generatedPkg = JSON.parse(
      await fsp.readFile(path.join(generatedRoot, 'package.json'), 'utf8')
    );
    assert.equal(ENGINE_PKG.name, '@ywal123456/jskim');
    assert.equal(
      generatedPkg.devDependencies[ENGINE_PKG.name],
      engineSpec
    );
    assert.equal(Object.hasOwn(generatedPkg.devDependencies, 'jskim'), false);
    assert.equal(generatedPkg.scripts.build, 'jskim build sample');
    assert.equal(generatedPkg.scripts.dev, 'jskim dev sample');

    assert.equal(fs.existsSync(path.join(generatedRoot, 'LICENSE')), false);
    assert.equal(
      Object.hasOwn(generatedPkg, 'license'),
      false,
      '生成 package.json に license を強制してはいけない'
    );

    // 明示的に install
    await runNpm(generatedRoot, ['install']);
    const engineDir = path.join(
      generatedRoot,
      'node_modules',
      ...ENGINE_PKG.name.split('/')
    );
    assert.ok(fs.existsSync(engineDir), 'engine がローカル tgz から入るべき');
    assert.ok(
      fs.existsSync(path.join(engineDir, 'bin/jskim.js')),
      'jskim binary が使えるべき'
    );
    assert.ok(
      fs.existsSync(path.join(generatedRoot, 'node_modules', '.bin', 'jskim')) ||
        fs.existsSync(
          path.join(generatedRoot, 'node_modules', '.bin', 'jskim.cmd')
        ),
      'node_modules/.bin/jskim が使えるべき'
    );

    // build
    const build = await runNpm(generatedRoot, ['run', 'build']);
    assert.match(build.stdout + build.stderr, /ビルドが完了しました/);
    const indexHtml = path.join(generatedRoot, 'dist/sample/index.html');
    const dashboardHtml = path.join(
      generatedRoot,
      'dist/sample/dashboard/index.html'
    );
    const css = path.join(generatedRoot, 'dist/sample/assets/css/common.css');
    const logo = path.join(generatedRoot, 'dist/sample/assets/img/logo.svg');
    const dashboardCss = path.join(
      generatedRoot,
      'dist/sample/dashboard/assets/css/dashboard.css'
    );
    assert.ok(fs.existsSync(indexHtml));
    assert.ok(fs.existsSync(dashboardHtml));
    assert.ok(fs.existsSync(css));
    assert.ok(fs.existsSync(logo));
    assert.ok(fs.existsSync(dashboardCss));
    assert.ok(
      fs.existsSync(path.join(generatedRoot, 'dist/sample/crud/index.html'))
    );
    assert.ok(
      fs.existsSync(path.join(generatedRoot, 'dist/sample/crud/detail.html'))
    );
    assert.ok(
      fs.existsSync(path.join(generatedRoot, 'dist/sample/crud/create.html'))
    );
    assert.ok(
      fs.existsSync(path.join(generatedRoot, 'dist/sample/crud/edit.html'))
    );
    assert.ok(
      fs.existsSync(path.join(generatedRoot, 'dist/sample/crud/delete.html'))
    );
    assert.ok(
      fs.existsSync(path.join(generatedRoot, 'dist/sample/crud/complete.html'))
    );
    assert.ok(
      fs.existsSync(
        path.join(generatedRoot, 'dist/sample/crud/assets/css/crud.css')
      )
    );
    assert.ok(
      fs.existsSync(path.join(generatedRoot, 'dist/sample/wizard/input.html'))
    );
    assert.ok(
      fs.existsSync(path.join(generatedRoot, 'dist/sample/wizard/confirm.html'))
    );
    assert.ok(
      fs.existsSync(path.join(generatedRoot, 'dist/sample/wizard/complete.html'))
    );
    assert.ok(
      fs.existsSync(
        path.join(generatedRoot, 'dist/sample/wizard/assets/css/wizard.css')
      )
    );
    assert.equal(
      fs.existsSync(path.join(generatedRoot, 'dist/sample/request/index.html')),
      false
    );
    assert.equal(
      fs.existsSync(path.join(generatedRoot, 'dist/sample/assets/js/main.js')),
      false
    );
    const html = await fsp.readFile(indexHtml, 'utf8');
    assert.match(html, /JSKim UI Sample/);
    assert.match(html, /静的 UI sample/);
    assert.match(html, /dashboard\/index\.html/);
    const dash = await fsp.readFile(dashboardHtml, 'utf8');
    assert.match(dash, /href="assets\/css\/dashboard\.css"/);
    assert.match(dash, /登録商品数/);

    // free port に差し替え
    const port = await getFreePort();
    const configPath = path.join(generatedRoot, 'jskim.config.js');
    let configText = await fsp.readFile(configPath, 'utf8');
    configText = configText.replace(/port:\s*\d+/, `port: ${port}`);
    configText = configText.replace(/debounce:\s*\d+/, 'debounce: 100');
    await fsp.writeFile(configPath, configText, 'utf8');

    const jskimBin = path.join(engineDir, 'bin/jskim.js');
    const dev = runCli({
      scriptPath: jskimBin,
      cwd: generatedRoot,
      args: ['dev', 'sample'],
      ipc: true,
      timeoutMs: 90000,
    });
    children.push(dev);

    await waitForOutput(
      () => dev.output,
      '終了するには Ctrl+C を押してください。',
      { timeoutMs: 25000 }
    );
    await sleep(500);

    const root = await httpRequest({ port, path: '/' });
    assert.equal(root.status, 200);
    const body = root.body.toString('utf8');
    assert.match(body, /静的 UI sample/);
    assert.match(body, /EventSource/);

    const indexPath = path.join(
      generatedRoot,
      'src/sample/pages/index.html.njk'
    );
    const distIndex = path.join(generatedRoot, 'dist/sample/index.html');
    let source = await fsp.readFile(indexPath, 'utf8');
    assert.match(source, /静的 UI sample/);
    await fsp.writeFile(
      indexPath,
      source.replace('静的 UI sample', 'CREATE_E2E_OK'),
      'utf8'
    );

    await waitFor(
      () => {
        try {
          const text = fs.readFileSync(distIndex, 'utf8');
          return text.includes('CREATE_E2E_OK');
        } catch {
          return false;
        }
      },
      { timeoutMs: 25000, label: 'generated project rebuild' }
    );

    await sleep(200);
    const after = await httpRequest({ port, path: '/' });
    assert.match(after.body.toString('utf8'), /CREATE_E2E_OK/);

    // installed package での config hot reload smoke
    const reloadCount = () =>
      (dev.output.match(/設定を再読み込みしました/g) || []).length;
    const watchUpdateCount = () =>
      (dev.output.match(/監視対象を更新しました/g) || []).length;

    const reloadsBeforeDebounce = reloadCount();
    const watchesBeforeDebounce = watchUpdateCount();
    configText = await fsp.readFile(configPath, 'utf8');
    await fsp.writeFile(
      configPath,
      configText.replace(/debounce:\s*\d+/, 'debounce: 140'),
      'utf8'
    );
    await waitFor(
      () =>
        reloadCount() > reloadsBeforeDebounce &&
        watchUpdateCount() > watchesBeforeDebounce,
      {
        timeoutMs: 20000,
        label: 'generated debounce config reload',
      }
    );
    const afterReload = await httpRequest({ port, path: '/' });
    assert.equal(afterReload.status, 200);

    const reloadsBeforeData = reloadCount();
    const watchesBeforeData = watchUpdateCount();
    configText = await fsp.readFile(configPath, 'utf8');
    await fsp.writeFile(
      configPath,
      configText.replace("name: 'JSKim UI Sample'", "name: 'CREATE_SITE_OK'"),
      'utf8'
    );
    await waitFor(
      () =>
        reloadCount() > reloadsBeforeData &&
        watchUpdateCount() > watchesBeforeData,
      {
        timeoutMs: 20000,
        label: 'generated data config reload',
      }
    );
    await waitFor(
      () => {
        try {
          return fs.readFileSync(indexHtml, 'utf8').includes('CREATE_SITE_OK');
        } catch {
          return false;
        }
      },
      { timeoutMs: 20000, label: 'generated config data reload' }
    );

    // watcher 再構成完了後に nested page-local CSS を変更する
    await sleep(300);

    const dashboardCssSource = path.join(
      generatedRoot,
      'src/sample/pages/dashboard/assets/css/dashboard.css'
    );
    source = await fsp.readFile(dashboardCssSource, 'utf8');
    await fsp.writeFile(
      dashboardCssSource,
      `${source}\n/* CREATE_DASHBOARD_CSS_OK */\n`,
      'utf8'
    );
    await waitFor(
      () => {
        try {
          return fs
            .readFileSync(dashboardCss, 'utf8')
            .includes('CREATE_DASHBOARD_CSS_OK');
        } catch {
          return false;
        }
      },
      { timeoutMs: 30000, label: 'generated nested asset rebuild' }
    );

    const nestedAsset = await httpRequest({
      port,
      path: '/dashboard/assets/css/dashboard.css',
    });
    assert.equal(nestedAsset.status, 200);
    assert.match(nestedAsset.body.toString('utf8'), /CREATE_DASHBOARD_CSS_OK/);

    await dev.stop();
    assert.match(dev.output, /開発サーバーを停止しました/);
  });
});

function parsePackJson(stdout) {
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function packPaths(meta) {
  return (meta.files || []).map((f) =>
    String(f.path || f).split(path.sep).join('/')
  );
}

/**
 * Windows でも npm file: で使える絶対パス仕様にします。
 * @param {string} absPath
 * @returns {string}
 */
function toFileSpec(absPath) {
  const normalized = path.resolve(absPath).split(path.sep).join('/');
  return `file:${normalized}`;
}
