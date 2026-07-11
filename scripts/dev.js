'use strict';

const { runDevCommand } = require('./commands/dev-command');

runDevCommand({
  projectName: process.argv[2],
  workspaceRoot: process.cwd(),
  usageLine: 'npm run dev -- <project-name>',
}).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
