'use strict';

const { runServeCommand } = require('./commands/serve-command');

runServeCommand({
  projectName: process.argv[2],
  workspaceRoot: process.cwd(),
  usageLine: 'npm run serve -- <project-name>',
}).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
