'use strict';

const { runWatchCommand } = require('./commands/watch-command');

runWatchCommand({
  projectName: process.argv[2],
  workspaceRoot: process.cwd(),
  usageLine: 'npm run watch -- <project-name>',
}).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
