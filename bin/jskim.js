#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { getHelpText } = require('../scripts/commands/help-text');
const { parseJskimArgv } = require('../scripts/lib/parse-cli-args');
const { runBuildCommand } = require('../scripts/commands/build-command');
const { runWatchCommand } = require('../scripts/commands/watch-command');
const { runServeCommand } = require('../scripts/commands/serve-command');
const { runDevCommand } = require('../scripts/commands/dev-command');
const { runSpecBuildCommand } = require('../scripts/commands/spec-build-command');
const { runSpecCollectCommand } = require('../scripts/commands/spec-collect-command');
const { runSpecDevCommand } = require('../scripts/commands/spec-dev-command');

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
  let parsed;
  try {
    parsed = parseJskimArgv(argv);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
    return;
  }

  if (parsed.kind === 'help') {
    printHelp();
    process.exitCode = 0;
    return;
  }

  if (parsed.kind === 'version') {
    printVersion();
    process.exitCode = 0;
    return;
  }

  const command = parsed.command;
  const projectName = parsed.projectName;
  const options = parsed.options;
  const workspaceRoot = process.cwd();

  if (command === 'build') {
    await runBuildCommand({
      projectName,
      all: options.all,
      workspaceRoot,
      usageLine: 'jskim build [<project>]',
    });
    return;
  }

  if (command === 'watch') {
    await runWatchCommand({
      projectName,
      workspaceRoot,
      usageLine: 'jskim watch [<project>]',
    });
    return;
  }

  if (command === 'serve') {
    const buildHint = projectName
      ? `jskim build ${projectName}`
      : 'jskim build [<project>]';
    await runServeCommand({
      projectName,
      workspaceRoot,
      usageLine: 'jskim serve [<project>] [--host <host>] [--port <port>]',
      buildHint,
      host: options.host,
      port: options.port,
    });
    return;
  }

  if (command === 'dev') {
    await runDevCommand({
      projectName,
      workspaceRoot,
      usageLine:
        'jskim dev [<project>] [--host <host>] [--port <port>] [--open]',
      host: options.host,
      port: options.port,
      open: options.open,
    });
    return;
  }

  if (command === 'spec') {
    if (parsed.subcommand === 'build') {
      await runSpecBuildCommand({
        projectName,
        workspaceRoot,
        usageLine: 'jskim spec build [<project>]',
      });
      return;
    }
    if (parsed.subcommand === 'collect') {
      await runSpecCollectCommand({
        projectName,
        workspaceRoot,
        usageLine: 'jskim spec collect [<project>]',
      });
      return;
    }
    if (parsed.subcommand === 'dev') {
      await runSpecDevCommand({
        projectName,
        workspaceRoot,
        usageLine:
          'jskim spec dev [<project>] [--host <host>] [--port <port>] [--open]',
        host: options.host,
        port: options.port,
        open: options.open,
      });
      return;
    }
    throw new Error(
      `[JSKim] 不明な spec サブコマンドです: ${parsed.subcommand || '(なし)'}\n` +
        '使用方法:\n' +
        '  jskim spec build [<project>]\n' +
        '  jskim spec collect [<project>]\n' +
        '  jskim spec dev [<project>]'
    );
  }
}

dispatch(process.argv.slice(2)).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
