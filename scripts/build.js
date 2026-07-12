'use strict';

const { parseCommandArgv } = require('./lib/parse-cli-args');
const { runBuildCommand } = require('./commands/build-command');

let parsed;
try {
  parsed = parseCommandArgv('build', process.argv.slice(2));
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
  return;
}

runBuildCommand({
  projectName: parsed.projectName,
  all: parsed.options.all,
  workspaceRoot: process.cwd(),
  usageLine: 'jskim build [<project>]',
}).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
