'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fse = require('fs-extra');
const { REPO_ROOT } = require('./helpers/create-test-workspace');
const { runCli } = require('./helpers/run-cli');
const { waitForOutput, waitFor, sleep } = require('./helpers/wait-for-output');
const { getFreePort } = require('./helpers/get-free-port');
const { httpRequest } = require('./helpers/http-request');

const execFileAsync = promisify(execFile);
const PKG = require(path.join(REPO_ROOT, 'package.json'));

function resolveNpmCli() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(
      path.dirname(process.execPath),
      '..',
      'lib',
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js'
    ),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('[JSKim test] npm-cli.js が見つかりません。');
}

const NPM_CLI = resolveNpmCli();

/**
 * npm CLI を引数配列で実行します（shell 文字列結合はしません）。
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runNpm(cwd, args) {
  return execFileAsync(process.execPath, [NPM_CLI, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

describe('package pack and consumer', { timeout: 180000 }, () => {
  let packDir;
  let tarballPath;
  let consumerRoot;
  let consumerPort;
  let installedBin;
  const children = [];

  before(async () => {
    packDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jskim-pack-'));
    consumerRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'jskim-consumer-'));

    const { stdout } = await runNpm(REPO_ROOT, [
      'pack',
      '--json',
      '--pack-destination',
      packDir,
    ]);

    const parsed = JSON.parse(stdout);
    const meta = Array.isArray(parsed) ? parsed[0] : parsed;
    assert.ok(meta && meta.filename, 'npm pack が filename を返すべき');

    tarballPath = path.join(packDir, meta.filename);
    assert.ok(fs.existsSync(tarballPath), 'pack-destination に tarball があるべき');

    // tarball 内容検証（npm pack --json の files）
    const paths = (meta.files || []).map((f) =>
      String(f.path || f).split(path.sep).join('/')
    );
    assert.ok(
      paths.some((p) => p === 'LICENSE' || p.endsWith('/LICENSE')),
      'LICENSE が含まれるべき'
    );
    assert.ok(
      paths.some((p) => p === 'bin/jskim.js' || p.endsWith('bin/jskim.js')),
      'bin/jskim.js が含まれるべき'
    );
    assert.ok(
      paths.some((p) => p.includes('scripts/commands/build-command.js')),
      'command runner が含まれるべき'
    );
    assert.ok(
      paths.some((p) => p === 'README.md' || p.endsWith('README.md')),
      'README.md が含まれるべき'
    );
    assert.ok(
      paths.some((p) => p.includes('docs/configuration.md')),
      'docs が含まれるべき'
    );
    assert.ok(
      paths.some((p) =>
        p.includes(`docs/JSKim_User_Guide_v${PKG.version}.pdf`)
      ),
      `release PDF docs/JSKim_User_Guide_v${PKG.version}.pdf が含まれるべき`
    );
    assert.ok(
      paths.some((p) => p === 'package.json' || p.endsWith('package.json')),
      'package.json が含まれるべき'
    );

    const forbidden = [
      'AGENTS.md',
      '.cursor/',
      'src/',
      'dist/',
      'test/',
      'jskim.config.js',
      'create-jskim/',
      '.env',
      '.npmrc',
    ];
    for (const needle of forbidden) {
      const hit = paths.find((p) => {
        if (needle.endsWith('/')) {
          return p === needle.slice(0, -1) || p.startsWith(needle);
        }
        return p === needle || p.endsWith(`/${needle}`);
      });
      assert.equal(hit, undefined, `${needle} は tarball に含めてはいけない`);
    }

    // consumer プロジェクト作成
    await fsp.writeFile(
      path.join(consumerRoot, 'package.json'),
      JSON.stringify(
        {
          name: 'jskim-consumer-temp',
          version: '1.0.0',
          private: true,
        },
        null,
        2
      ),
      'utf8'
    );

    const fixtureRoot = path.join(REPO_ROOT, 'test/fixtures/basic');
    await fse.copy(fixtureRoot, consumerRoot, {
      filter: (src) => {
        const rel = path.relative(fixtureRoot, src).split(path.sep).join('/');
        if (!rel) {
          return true;
        }
        return !rel.startsWith('dist');
      },
    });

    consumerPort = await getFreePort();
    const configPath = path.join(consumerRoot, 'jskim.config.js');
    let configText = await fsp.readFile(configPath, 'utf8');
    configText = configText.replace(/port:\s*\d+/, `port: ${consumerPort}`);
    await fsp.writeFile(configPath, configText, 'utf8');

    assert.equal(meta.name, PKG.name, 'pack metadata の name が scoped engine であるべき');

    await runNpm(consumerRoot, ['install', tarballPath]);

    const pkgDir = path.join(consumerRoot, 'node_modules', ...PKG.name.split('/'));
    assert.ok(fs.existsSync(pkgDir), `${PKG.name} がインストールされるべき`);
    installedBin = path.join(pkgDir, 'bin/jskim.js');
    assert.ok(fs.existsSync(installedBin), 'インストール先 bin が存在するべき');

    const installedPkg = JSON.parse(
      await fsp.readFile(path.join(pkgDir, 'package.json'), 'utf8')
    );
    assert.equal(installedPkg.name, PKG.name);
    assert.equal(installedPkg.publishConfig && installedPkg.publishConfig.access, 'public');
    assert.equal(
      installedPkg.publishConfig && installedPkg.publishConfig.registry,
      'https://registry.npmjs.org'
    );
  });

  after(async () => {
    for (const child of children) {
      // eslint-disable-next-line no-await-in-loop
      await child.forceKill().catch(() => {});
    }

    if (packDir) {
      await fse.remove(packDir).catch(() => {});
    }
    if (consumerRoot) {
      await fse.remove(consumerRoot).catch(() => {});
    }

    // リポジトリ直下に残った tgz を掃除（scoped pack 名含む）
    const leftovers = fs
      .readdirSync(REPO_ROOT)
      .filter((name) => /^(jskim|ywal123456-jskim)-.*\.tgz$/i.test(name));
    for (const name of leftovers) {
      // eslint-disable-next-line no-await-in-loop
      await fse.remove(path.join(REPO_ROOT, name)).catch(() => {});
    }
  });

  it('インストール済み binary で help / version が動く', async () => {
    const help = runCli({
      scriptPath: installedBin,
      cwd: consumerRoot,
      args: ['--help'],
    });
    const helpResult = await help.waitForExit();
    assert.equal(helpResult.code, 0);
    assert.match(helpResult.output, /build \[<project>\]/);

    const version = runCli({
      scriptPath: installedBin,
      cwd: consumerRoot,
      args: ['--version'],
    });
    const versionResult = await version.waitForExit();
    assert.equal(versionResult.code, 0);
    assert.equal(versionResult.output.trim(), PKG.version);

    // npm exec 経由でも動くこと
    const npmHelp = await runNpmExec(consumerRoot, ['--help']);
    assert.equal(npmHelp.code, 0);
    assert.match(npmHelp.output, /使用方法:/);
  });

  it('外部 consumer で build が consumer の cwd を使う', async () => {
    const repoIndex = path.join(REPO_ROOT, 'dist/sample/index.html');
    const repoMtimeBefore = fs.existsSync(repoIndex)
      ? fs.statSync(repoIndex).mtimeMs
      : null;

    const cli = runCli({
      scriptPath: installedBin,
      cwd: consumerRoot,
      args: ['build', 'sample'],
      timeoutMs: 30000,
    });
    const result = await cli.waitForExit();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /ビルドが完了しました/);

    const indexHtml = path.join(consumerRoot, 'dist/sample/index.html');
    const css = path.join(consumerRoot, 'dist/sample/assets/css/style.css');
    assert.ok(fs.existsSync(indexHtml));
    assert.ok(fs.existsSync(css));

    const html = await fsp.readFile(indexHtml, 'utf8');
    assert.match(html, /JSKim Fixture/);
    assert.match(html, /INDEX_OK/);
    assert.match(html, /<p id="root-path">\.\/<\/p>/);

    if (repoMtimeBefore !== null) {
      const after = fs.statSync(repoIndex).mtimeMs;
      assert.equal(after, repoMtimeBefore, 'リポジトリ dist を更新してはいけない');
    } else {
      assert.equal(fs.existsSync(repoIndex), false);
    }
  });

  it('外部 consumer で serve が dist を提供する', async () => {
    const cli = runCli({
      scriptPath: installedBin,
      cwd: consumerRoot,
      args: ['serve', 'sample'],
      ipc: true,
      timeoutMs: 25000,
    });
    children.push(cli);
    await waitForOutput(
      () => cli.output,
      '終了するには Ctrl+C を押してください。'
    );

    const root = await httpRequest({
      port: consumerPort,
      path: '/',
    });
    assert.equal(root.status, 200);
    assert.match(root.body.toString('utf8'), /INDEX_OK/);

    await cli.stop();
    assert.match(cli.output, /静的サーバーを停止しました/);
  });

  it('外部 consumer で dev smoke が動く', async () => {
    const port = await getFreePort();
    const configPath = path.join(consumerRoot, 'jskim.config.js');
    let configText = await fsp.readFile(configPath, 'utf8');
    configText = configText.replace(/port:\s*\d+/, `port: ${port}`);
    await fsp.writeFile(configPath, configText, 'utf8');

    const cli = runCli({
      scriptPath: installedBin,
      cwd: consumerRoot,
      args: ['dev', 'sample'],
      ipc: true,
      timeoutMs: 45000,
    });
    children.push(cli);
    await waitForOutput(
      () => cli.output,
      '終了するには Ctrl+C を押してください。',
      { timeoutMs: 25000 }
    );
    await sleep(300);

    const root = await httpRequest({ port, path: '/' });
    assert.equal(root.status, 200);
    assert.match(root.body.toString('utf8'), /INDEX_OK/);

    const indexPath = path.join(consumerRoot, 'src/sample/pages/index.njk');
    const distIndex = path.join(consumerRoot, 'dist/sample/index.html');
    let source = await fsp.readFile(indexPath, 'utf8');
    assert.match(source, /INDEX_OK/);
    await fsp.writeFile(
      indexPath,
      source.replace('INDEX_OK', 'PACKAGE_DEV_OK'),
      'utf8'
    );

    await waitFor(
      () => {
        try {
          return fs.readFileSync(distIndex, 'utf8').includes('PACKAGE_DEV_OK');
        } catch {
          return false;
        }
      },
      { timeoutMs: 20000, label: 'consumer dev rebuild' }
    );

    await sleep(200);
    const after = await httpRequest({ port, path: '/' });
    assert.match(after.body.toString('utf8'), /PACKAGE_DEV_OK/);

    await cli.stop();
    assert.match(cli.output, /開発サーバーを停止しました/);
  });
});

function runNpmExec(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [NPM_CLI, 'exec', '--', 'jskim', ...args], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (c) => {
      output += c.toString();
    });
    child.stderr.on('data', (c) => {
      output += c.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code, output });
    });
  });
}
