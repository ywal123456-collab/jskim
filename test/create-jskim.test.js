'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fse = require('fs-extra');
const { REPO_ROOT } = require('./helpers/create-test-workspace');

const CREATE_ROOT = path.join(REPO_ROOT, 'create-jskim');
const CREATE_BIN = path.join(CREATE_ROOT, 'bin/create-jskim.js');
const CREATE_PKG = require(path.join(CREATE_ROOT, 'package.json'));

describe('create-jskim', () => {
  const temps = [];

  after(async () => {
    for (const dir of temps) {
      // eslint-disable-next-line no-await-in-loop
      await fse.remove(dir).catch(() => {});
    }
  });

  async function makeCwd() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jskim-create-cwd-'));
    temps.push(dir);
    return dir;
  }

  it('--help で日本語ヘルプを表示して exit 0', async () => {
    const result = await runCreate(['--help'], { cwd: REPO_ROOT });
    assert.equal(result.code, 0);
    assert.match(result.output, /使用方法:/);
    assert.match(result.output, /project-directory/);
    assert.match(result.output, /--help/);
    assert.match(result.output, /--version/);
  });

  it('--version で create package の version を表示する', async () => {
    const result = await runCreate(['--version'], { cwd: REPO_ROOT });
    assert.equal(result.code, 0);
    assert.equal(result.output.trim(), CREATE_PKG.version);
  });

  it('引数でプロジェクトを作成する', async () => {
    const cwd = await makeCwd();
    const result = await runCreate(['my-project'], { cwd });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /JSKimプロジェクトを作成しました/);
    assert.match(result.output, /cd my-project/);
    assert.match(result.output, /次のコマンドを実行してください/);
    assert.match(result.output, /npm install/);
    assert.match(result.output, /npm run dev/);
    assert.match(result.output, /http:\/\/127\.0\.0\.1:3000\//);

    const project = path.join(cwd, 'my-project');
    assert.ok(fs.existsSync(path.join(project, 'package.json')));
    assert.ok(fs.existsSync(path.join(project, 'jskim.config.js')));
    assert.ok(fs.existsSync(path.join(project, 'README.md')));
    assert.ok(fs.existsSync(path.join(project, '.gitignore')));
    assert.ok(
      fs.existsSync(path.join(project, 'src/sample/pages/index.html.njk'))
    );
    assert.equal(fs.existsSync(path.join(project, 'dist')), false);
    assert.equal(fs.existsSync(path.join(project, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(project, 'package-lock.json')), false);
    assert.equal(fs.existsSync(path.join(project, '.git')), false);
    assert.equal(fs.existsSync(path.join(project, 'gitignore')), false);
    assert.equal(fs.existsSync(path.join(project, 'LICENSE')), false);

    const pkg = JSON.parse(
      await fsp.readFile(path.join(project, 'package.json'), 'utf8')
    );
    assert.equal(pkg.name, 'my-project');
    assert.equal(Object.hasOwn(pkg, 'license'), false);
    assert.equal(pkg.scripts.build, 'jskim build sample');
    assert.equal(pkg.scripts.watch, 'jskim watch sample');
    assert.equal(pkg.scripts.serve, 'jskim serve sample');
    assert.equal(pkg.scripts.dev, 'jskim dev sample');
    assert.equal(
      pkg.devDependencies[CREATE_PKG.jskimEngine.packageName],
      CREATE_PKG.jskimEngine.version
    );
    assert.equal(CREATE_PKG.jskimEngine.packageName, '@ywal123456/jskim');
    assert.equal(Object.hasOwn(pkg.devDependencies, 'jskim'), false);

    const gitignore = await fsp.readFile(path.join(project, '.gitignore'), 'utf8');
    assert.match(gitignore, /node_modules\//);
    assert.match(gitignore, /dist\//);
  });

  it('対話入力でプロジェクトを作成する', async () => {
    const cwd = await makeCwd();
    const result = await runCreate([], {
      cwd,
      stdin: 'prompt-project\n',
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /プロジェクト名:/);
    assert.ok(fs.existsSync(path.join(cwd, 'prompt-project/package.json')));
  });

  it('空入力では既定名 jskim-project を使う', async () => {
    const cwd = await makeCwd();
    const result = await runCreate([], {
      cwd,
      stdin: '\n',
    });
    assert.equal(result.code, 0, result.output);
    assert.ok(fs.existsSync(path.join(cwd, 'jskim-project/package.json')));
  });

  it('空ではない既存ディレクトリでは失敗し既存ファイルを変えない', async () => {
    const cwd = await makeCwd();
    const target = path.join(cwd, 'taken');
    await fsp.mkdir(target);
    const marker = path.join(target, 'keep.txt');
    await fsp.writeFile(marker, 'KEEP', 'utf8');

    const result = await runCreate(['taken'], { cwd });
    assert.equal(result.code, 1);
    assert.match(result.output, /ディレクトリが空ではありません/);
    assert.equal(await fsp.readFile(marker, 'utf8'), 'KEEP');
    assert.equal(fs.existsSync(path.join(target, 'package.json')), false);
  });

  it('既存の空ディレクトリへ作成できる', async () => {
    const cwd = await makeCwd();
    const target = path.join(cwd, 'empty-dir');
    await fsp.mkdir(target);

    const result = await runCreate(['empty-dir'], { cwd });
    assert.equal(result.code, 0, result.output);
    assert.ok(fs.existsSync(path.join(target, 'package.json')));
    assert.ok(fs.statSync(target).isDirectory());
  });

  it('カレントディレクトリ . に作成できる', async () => {
    const cwd = await makeCwd();
    const result = await runCreate(['.'], { cwd });
    assert.equal(result.code, 0, result.output);
    assert.ok(fs.existsSync(path.join(cwd, 'package.json')));
    assert.equal(fs.existsSync(path.join(cwd, path.basename(cwd), 'package.json')), false);
    assert.doesNotMatch(result.output, /cd \./);
    assert.match(result.output, /次のコマンドを実行してください/);
    assert.match(result.output, /npm install/);
    assert.match(result.output, /http:\/\/127\.0\.0\.1:3000\//);
  });

  it('パッケージ名を正規化する', async () => {
    const cwd = await makeCwd();
    const result = await runCreate(['My_Project'], { cwd });
    assert.equal(result.code, 0, result.output);
    const pkg = JSON.parse(
      await fsp.readFile(path.join(cwd, 'My_Project/package.json'), 'utf8')
    );
    assert.equal(pkg.name, 'my-project');
  });

  it('JSKIM_ENGINE_SPEC で dependency を上書きできる', async () => {
    const cwd = await makeCwd();
    const spec = 'file:C:/temp/ywal123456-jskim-0.1.0.tgz';
    const result = await runCreate(['spec-project'], {
      cwd,
      env: { JSKIM_ENGINE_SPEC: spec },
    });
    assert.equal(result.code, 0, result.output);
    const pkg = JSON.parse(
      await fsp.readFile(path.join(cwd, 'spec-project/package.json'), 'utf8')
    );
    assert.equal(
      pkg.devDependencies[CREATE_PKG.jskimEngine.packageName],
      spec
    );
    assert.equal(Object.hasOwn(pkg.devDependencies, 'jskim'), false);
  });

  it('npm_config_user_agent に応じて完了案内のコマンドが変わる', async () => {
    const cwd = await makeCwd();

    const npm = await runCreate(['npm-proj'], {
      cwd,
      env: {
        npm_config_user_agent: 'npm/11.11.0 node/v24.14.1 win32 x64',
      },
    });
    assert.equal(npm.code, 0, npm.output);
    assert.deepEqual(extractGuideCommands(npm.output), [
      'cd npm-proj',
      'npm install',
      'npm run dev',
    ]);

    const pnpm = await runCreate(['pnpm-proj'], {
      cwd,
      env: {
        npm_config_user_agent: 'pnpm/10.0.0 npm/? node/v24.14.1 win32 x64',
      },
    });
    assert.equal(pnpm.code, 0, pnpm.output);
    assert.deepEqual(extractGuideCommands(pnpm.output), [
      'cd pnpm-proj',
      'pnpm install',
      'pnpm dev',
    ]);

    const yarn = await runCreate(['yarn-proj'], {
      cwd,
      env: {
        npm_config_user_agent: 'yarn/1.22.22 npm/? node/v20.0.0 win32 x64',
      },
    });
    assert.equal(yarn.code, 0, yarn.output);
    assert.deepEqual(extractGuideCommands(yarn.output), [
      'cd yarn-proj',
      'yarn install',
      'yarn dev',
    ]);

    const unknown = await runCreate(['unknown-proj'], {
      cwd,
      env: {
        npm_config_user_agent: '',
      },
    });
    assert.equal(unknown.code, 0, unknown.output);
    assert.deepEqual(extractGuideCommands(unknown.output), [
      'cd unknown-proj',
      'npm install',
      'npm run dev',
    ]);
  });

  it('ネストパスと空白パスの cd 案内が正しい', async () => {
    const cwd = await makeCwd();
    const nested = await runCreate(['apps/sample'], { cwd });
    assert.equal(nested.code, 0, nested.output);
    assert.match(nested.output, /cd apps\/sample/);

    const spaced = await runCreate(['My Project'], { cwd });
    assert.equal(spaced.code, 0, spaced.output);
    assert.match(spaced.output, /cd "My Project"/);
  });

  it('生成 package.json の scripts.dev と依存 version が正しい', async () => {
    const cwd = await makeCwd();
    const result = await runCreate(['script-check'], { cwd });
    assert.equal(result.code, 0, result.output);
    const pkg = JSON.parse(
      await fsp.readFile(path.join(cwd, 'script-check/package.json'), 'utf8')
    );
    assert.equal(pkg.version, '0.1.0');
    assert.equal(pkg.scripts.dev, 'jskim dev sample');
    assert.equal(pkg.devDependencies['@ywal123456/jskim'], '^0.5.1');
    assert.match(result.output, /npm run dev/);
  });

  it('template/src/sample は root src/sample と一致する', async () => {
    const rootSample = path.join(REPO_ROOT, 'src/sample');
    const templateSample = path.join(CREATE_ROOT, 'template/src/sample');
    const rootFiles = listRelativeFiles(rootSample);
    const templateFiles = listRelativeFiles(templateSample);
    assert.deepEqual(templateFiles, rootFiles);

    for (const rel of rootFiles) {
      const a = await fsp.readFile(path.join(rootSample, rel), 'utf8');
      const b = await fsp.readFile(path.join(templateSample, rel), 'utf8');
      assert.equal(a, b, `内容が一致すべき: ${rel}`);
    }
  });

  it('生成結果の sample は日本語を含み韓国語を含まない', async () => {
    const cwd = await makeCwd();
    await runCreate(['lang-check'], { cwd });
    const index = await fsp.readFile(
      path.join(cwd, 'lang-check/src/sample/pages/index.html.njk'),
      'utf8'
    );
    assert.match(index, /files pipeline/);
    // ハングル文字クラスをソースに直書きしない（language テスト対象のため）
    const hangul = new RegExp(
      `[${String.fromCharCode(0xac00)}-${String.fromCharCode(0xd7a3)}]`
    );
    assert.equal(hangul.test(index), false);
  });
});

/**
 * @param {string[]} args
 * @param {object} options
 */
function runCreate(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CREATE_BIN, ...args], {
      cwd: options.cwd,
      env: { ...process.env, FORCE_COLOR: '0', ...(options.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (c) => {
      output += c.toString();
    });
    child.stderr.on('data', (c) => {
      output += c.toString();
    });

    if (options.stdin != null) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();

    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code, output });
    });
  });
}

function listRelativeFiles(root) {
  const out = [];
  function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        out.push(rel.split(path.sep).join('/'));
      }
    }
  }
  walk(root, '');
  out.sort();
  return out;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractGuideCommands(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith('cd ') ||
        line === 'npm install' ||
        line === 'npm run dev' ||
        line === 'pnpm install' ||
        line === 'pnpm dev' ||
        line === 'yarn install' ||
        line === 'yarn dev'
    );
}
