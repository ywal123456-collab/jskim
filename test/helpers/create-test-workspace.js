'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fse = require('fs-extra');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FIXTURES_ROOT = path.join(__dirname, '../fixtures/basic');

/**
 * テスト用の一時ワークスペースを作成し、fixture をコピーします。
 * 実際の src/sample / dist/sample は変更しません。
 *
 * @param {object} [options]
 * @param {object} [options.configOverrides] jskim.config.js の上書き（shallow）
 * @returns {Promise<{ workspaceRoot: string, cleanup: Function, scripts: object }>}
 */
async function createTestWorkspace(options = {}) {
  const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'jskim-test-'));

  await fse.copy(FIXTURES_ROOT, workspaceRoot, {
    filter: (src) => !src.includes(`${path.sep}dist${path.sep}`),
  });

  if (options.configOverrides) {
    const configPath = path.join(workspaceRoot, 'jskim.config.js');
    // eslint-disable-next-line import/no-dynamic-require, global-require
    delete require.cache[require.resolve(configPath)];
    const base = require(configPath);
    const merged = {
      ...base,
      defaults: {
        ...base.defaults,
        ...(options.configOverrides.defaults || {}),
        serve: {
          ...base.defaults.serve,
          ...((options.configOverrides.defaults &&
            options.configOverrides.defaults.serve) ||
            {}),
        },
        watch: {
          ...base.defaults.watch,
          ...((options.configOverrides.defaults &&
            options.configOverrides.defaults.watch) ||
            {}),
        },
        dev: {
          ...base.defaults.dev,
          ...((options.configOverrides.defaults &&
            options.configOverrides.defaults.dev) ||
            {}),
        },
      },
      projects: {
        ...base.projects,
        ...(options.configOverrides.projects || {}),
      },
    };

    const serialized = `module.exports = ${serializeConfig(merged)};\n`;
    await fsp.writeFile(configPath, serialized, 'utf8');
  }

  async function cleanup() {
    try {
      await fse.remove(workspaceRoot);
    } catch {
      // 一時ディレクトリ削除失敗は無視
    }
  }

  return {
    workspaceRoot,
    cleanup,
    scripts: {
      build: path.join(REPO_ROOT, 'scripts/build.js'),
      watch: path.join(REPO_ROOT, 'scripts/watch.js'),
      serve: path.join(REPO_ROOT, 'scripts/serve.js'),
      dev: path.join(REPO_ROOT, 'scripts/dev.js'),
      bin: path.join(REPO_ROOT, 'bin/jskim.js'),
    },
    repoRoot: REPO_ROOT,
  };
}

function serializeConfig(value, indent = 0) {
  const pad = '  '.repeat(indent);
  const next = '  '.repeat(indent + 1);

  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const items = value
      .map((item) => `${next}${serializeConfig(item, indent + 1)}`)
      .join(',\n');
    return `[\n${items}\n${pad}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return '{}';
    }
    const body = keys
      .map((key) => {
        const safeKey = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
          ? key
          : JSON.stringify(key);
        return `${next}${safeKey}: ${serializeConfig(value[key], indent + 1)}`;
      })
      .join(',\n');
    return `{\n${body}\n${pad}}`;
  }
  return JSON.stringify(value);
}

module.exports = {
  createTestWorkspace,
  REPO_ROOT,
};
