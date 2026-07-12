#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { getHelpText } = require('../lib/help-text');
const { resolveProjectDirectory } = require('../lib/resolve-project-name');
const { createProject } = require('../lib/create-project');
const { detectPackageManager } = require('../lib/detect-package-manager');

function readPackageVersion() {
  // create package 自身の package.json（作業空間ではない）
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  return pkg.version;
}

/**
 * @param {string[]} argv process.argv から node / script を除いた配列
 */
async function main(argv) {
  const first = argv[0];

  if (first === '--help' || first === '-h') {
    console.log(getHelpText());
    process.exitCode = 0;
    return;
  }

  if (first === '--version' || first === '-v') {
    console.log(readPackageVersion());
    process.exitCode = 0;
    return;
  }

  if (first && String(first).startsWith('-')) {
    console.error(
      `[create-jskim] 不明なオプションです: ${first}\n\n${getHelpText()}`
    );
    process.exitCode = 1;
    return;
  }

  const { directoryInput } = await resolveProjectDirectory({
    directoryArg: first,
  });

  await createProject({
    directoryInput,
    cwd: process.cwd(),
    createPackageRoot: path.join(__dirname, '..'),
    packageManager: detectPackageManager(process.env.npm_config_user_agent),
  });
}

main(process.argv.slice(2)).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
