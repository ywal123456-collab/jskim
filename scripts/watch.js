'use strict';

const { parseCommandArgv } = require('./lib/parse-cli-args');
const { runWatchCommand } = require('./commands/watch-command');

let parsed;
try {
  parsed = parseCommandArgv('watch', process.argv.slice(2));
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
  return;
}

runWatchCommand({
  projectName: parsed.projectName,
  workspaceRoot: process.cwd(),
  usageLine: 'jskim watch [<project>]',
}).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
