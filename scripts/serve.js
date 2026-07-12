'use strict';

const { parseCommandArgv } = require('./lib/parse-cli-args');
const { runServeCommand } = require('./commands/serve-command');

let parsed;
try {
  parsed = parseCommandArgv('serve', process.argv.slice(2));
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
  return;
}

const projectName = parsed.projectName;
const buildHint = projectName
  ? `jskim build ${projectName}`
  : 'jskim build [<project>]';

runServeCommand({
  projectName,
  workspaceRoot: process.cwd(),
  usageLine: 'jskim serve [<project>] [--host <host>] [--port <port>]',
  buildHint,
  host: parsed.options.host,
  port: parsed.options.port,
}).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
