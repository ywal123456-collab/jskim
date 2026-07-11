#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { getHelpText, getUnknownCommandText } = require('../scripts/commands/help-text');
const { runBuildCommand } = require('../scripts/commands/build-command');
const { runWatchCommand } = require('../scripts/commands/watch-command');
const { runServeCommand } = require('../scripts/commands/serve-command');
const { runDevCommand } = require('../scripts/commands/dev-command');

const COMMANDS = new Set(['build', 'watch', 'serve', 'dev']);

function readPackageVersion() {
  // package インストール先の package.json を読む（作業空間ではない）
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  return pkg.version;
}

function printHelp() {
  console.log(getHelpText());
}

function printVersion() {
  console.log(readPackageVersion());
}

/**
 * @param {string[]} argv process.argv 相当（node と script を除く）
 */
async function dispatch(argv) {
  const first = argv[0];

  if (!first) {
    printHelp();
    process.exitCode = 0;
    return;
  }

  if (first === '--help' || first === '-h' || first === 'help') {
    printHelp();
    process.exitCode = 0;
    return;
  }

  if (first === '--version' || first === '-v') {
    printVersion();
    process.exitCode = 0;
    return;
  }

  if (!COMMANDS.has(first)) {
    console.error(getUnknownCommandText(first));
    process.exitCode = 1;
    return;
  }

  const projectName = argv[1];
  const workspaceRoot = process.cwd();
  const usageLine = `jskim ${first} <project>`;
  const buildHint = projectName
    ? `jskim build ${projectName}`
    : 'jskim build <project>';

  if (first === 'build') {
    await runBuildCommand({
      projectName,
      workspaceRoot,
      usageLine,
    });
    return;
  }

  if (first === 'watch') {
    await runWatchCommand({
      projectName,
      workspaceRoot,
      usageLine,
    });
    return;
  }

  if (first === 'serve') {
    await runServeCommand({
      projectName,
      workspaceRoot,
      usageLine,
      buildHint,
    });
    return;
  }

  if (first === 'dev') {
    await runDevCommand({
      projectName,
      workspaceRoot,
      usageLine,
    });
  }
}

dispatch(process.argv.slice(2)).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
