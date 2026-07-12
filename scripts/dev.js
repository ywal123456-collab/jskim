'use strict';

const { parseCommandArgv } = require('./lib/parse-cli-args');
const { runDevCommand } = require('./commands/dev-command');

let parsed;
try {
  parsed = parseCommandArgv('dev', process.argv.slice(2));
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
  return;
}

runDevCommand({
  projectName: parsed.projectName,
  workspaceRoot: process.cwd(),
  usageLine: 'jskim dev [<project>] [--host <host>] [--port <port>] [--open]',
  host: parsed.options.host,
  port: parsed.options.port,
  open: parsed.options.open,
}).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
