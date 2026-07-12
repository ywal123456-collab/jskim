'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { validateTargetDirectory } = require('./validate-target-directory');
const {
  resolvePackageNameFromBasename,
  resolveTargetPaths,
} = require('./resolve-project-name');
const { printNextSteps, formatCdTarget } = require('./print-next-steps');

/**
 * create-jskim/package.json を読みます（エンジン metadata の単一の情報源）。
 * @param {string} createPackageRoot
 * @returns {object}
 */
function loadCreatePackageJson(createPackageRoot) {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(path.join(createPackageRoot, 'package.json'));
}

/**
 * 生成する package.json の engine dependency 値を決めます。
 * JSKIM_ENGINE_SPEC があればテスト用 override（一般向けオプションではない）。
 * @param {object} createPkg
 * @returns {{ packageName: string, spec: string }}
 */
function resolveEngineDependency(createPkg) {
  const engine = createPkg.jskimEngine || {};
  const packageName = engine.packageName;
  if (!packageName || String(packageName).trim() === '') {
    throw new Error(
      '[create-jskim] package.json の jskimEngine.packageName がありません。'
    );
  }

  const override = process.env.JSKIM_ENGINE_SPEC;
  if (override != null && String(override).trim() !== '') {
    return {
      packageName: String(packageName).trim(),
      spec: String(override).trim(),
    };
  }

  const version = engine.version;
  if (!version || String(version).trim() === '') {
    throw new Error(
      '[create-jskim] package.json の jskimEngine.version がありません。'
    );
  }

  return {
    packageName: String(packageName).trim(),
    spec: String(version).trim(),
  };
}

/**
 * JSKim プロジェクトを作成します。
 * @param {object} options
 * @param {string} options.directoryInput ユーザー入力（例: my-project / .）
 * @param {string} [options.cwd]
 * @param {string} [options.createPackageRoot]
 * @param {boolean} [options.printSuccess=true]
 * @param {string} [options.packageManager] detectPackageManager の結果
 * @returns {Promise<object>}
 */
async function createProject(options) {
  const cwd = options.cwd || process.cwd();
  const createPackageRoot =
    options.createPackageRoot || path.resolve(__dirname, '..');
  const directoryInput = options.directoryInput;
  const printSuccess = options.printSuccess !== false;
  const packageManager = options.packageManager;

  const { targetDir, basename, isCurrentDirectory } = resolveTargetPaths(
    directoryInput,
    cwd
  );

  const packageName = resolvePackageNameFromBasename(basename);
  const targetInfo = validateTargetDirectory(targetDir);

  const createPkg = loadCreatePackageJson(createPackageRoot);
  const engineDep = resolveEngineDependency(createPkg);
  const templateRoot = path.join(createPackageRoot, 'template');

  let createdTargetDir = false;
  const createdPaths = [];

  try {
    if (!targetInfo.exists) {
      await fsp.mkdir(targetDir, { recursive: true });
      createdTargetDir = true;
    }

    await writePackageJson(targetDir, packageName, engineDep, createdPaths);
    await copyTemplateTree(templateRoot, targetDir, createdPaths);

    if (printSuccess) {
      printNextSteps({
        projectLabel: packageName,
        targetDir,
        isCurrentDirectory,
        cdTarget: formatCdTarget(directoryInput, targetDir, cwd),
        packageManager,
      });
    }

    return {
      targetDir,
      packageName,
      isCurrentDirectory,
      engineDependency: engineDep,
      createdTargetDir,
    };
  } catch (err) {
    await cleanupPartialProject({
      targetDir,
      createdTargetDir,
      createdPaths,
    });
    throw err;
  }
}

/**
 * @param {string} targetDir
 * @param {string} packageName
 * @param {{ packageName: string, spec: string }} engineDep
 * @param {string[]} createdPaths
 */
async function writePackageJson(targetDir, packageName, engineDep, createdPaths) {
  const packageJson = {
    name: packageName,
    version: '0.1.0',
    private: true,
    scripts: {
      build: 'jskim build sample',
      watch: 'jskim watch sample',
      serve: 'jskim serve sample',
      dev: 'jskim dev sample',
    },
    devDependencies: {
      [engineDep.packageName]: engineDep.spec,
    },
  };

  const dest = path.join(targetDir, 'package.json');
  await fsp.writeFile(
    dest,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    'utf8'
  );
  createdPaths.push(dest);
}

/**
 * template を target へコピーします。gitignore → .gitignore に変換します。
 * @param {string} templateRoot
 * @param {string} targetDir
 * @param {string[]} createdPaths
 */
async function copyTemplateTree(templateRoot, targetDir, createdPaths) {
  if (!fs.existsSync(templateRoot)) {
    throw new Error(
      `[create-jskim] template が見つかりません。\nパス: ${templateRoot}`
    );
  }

  await copyDirectory(templateRoot, targetDir, createdPaths, true);
}

/**
 * @param {string} srcDir
 * @param {string} destDir
 * @param {string[]} createdPaths
 * @param {boolean} isTemplateRoot
 */
async function copyDirectory(srcDir, destDir, createdPaths, isTemplateRoot) {
  if (!isTemplateRoot) {
    if (!fs.existsSync(destDir)) {
      await fsp.mkdir(destDir, { recursive: true });
      createdPaths.push(destDir);
    }
  }

  const entries = await fsp.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    let destName = entry.name;
    if (isTemplateRoot && entry.name === 'gitignore' && entry.isFile()) {
      destName = '.gitignore';
    }

    const destPath = path.join(destDir, destName);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath, createdPaths, false);
    } else if (entry.isFile()) {
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      // 親ディレクトリも追跡（既存空 dir 失敗時の cleanup 用）
      trackAncestorDirs(destDir, destPath, createdPaths);
      await fsp.copyFile(srcPath, destPath);
      createdPaths.push(destPath);
    }
  }
}

/**
 * dest ファイルの祖先ディレクトリのうち destDir 配下を記録します。
 * @param {string} targetRoot
 * @param {string} filePath
 * @param {string[]} createdPaths
 */
function trackAncestorDirs(targetRoot, filePath, createdPaths) {
  const root = path.resolve(targetRoot);
  let current = path.dirname(path.resolve(filePath));

  while (isPathInside(root, current) && path.resolve(current) !== root) {
    if (!createdPaths.includes(current)) {
      createdPaths.push(current);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

/**
 * @param {string} root
 * @param {string} candidate
 * @returns {boolean}
 */
function isPathInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 部分生成物を片付けます。
 * @param {object} options
 * @param {string} options.targetDir
 * @param {boolean} options.createdTargetDir
 * @param {string[]} options.createdPaths
 */
async function cleanupPartialProject(options) {
  const { targetDir, createdTargetDir, createdPaths } = options;

  try {
    if (createdTargetDir) {
      await fsp.rm(targetDir, { recursive: true, force: true });
      return;
    }

    // 既存の空ディレクトリは残し、今回作ったものだけ削除（深いパスから）
    const unique = [...new Set(createdPaths)];
    unique.sort((a, b) => b.length - a.length);

    for (const item of unique) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await fsp.rm(item, { recursive: true, force: true });
      } catch {
        // cleanup 失敗は無視
      }
    }
  } catch {
    // cleanup 失敗は無視
  }
}

module.exports = {
  createProject,
  resolveEngineDependency,
  loadCreatePackageJson,
  cleanupPartialProject,
};
