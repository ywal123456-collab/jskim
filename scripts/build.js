'use strict';

const { runBuildCommand } = require('./commands/build-command');

runBuildCommand({
  projectName: process.argv[2],
  workspaceRoot: process.cwd(),
  usageLine: 'npm run build -- <project-name>',
}).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
