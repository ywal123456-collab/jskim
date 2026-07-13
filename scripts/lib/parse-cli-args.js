'use strict';

const COMMANDS = new Set(['build', 'watch', 'serve', 'dev', 'spec']);

const COMMAND_OPTIONS = {
  build: new Set(['--all']),
  watch: new Set([]),
  serve: new Set(['--host', '--port']),
  dev: new Set(['--host', '--port', '--open']),
  spec: new Set([]),
};

const VALUE_OPTIONS = new Set(['--host', '--port']);
const BOOLEAN_OPTIONS = new Set(['--all', '--open']);

/**
 * jskim の argv（node / script を除く）を解析します。
 *
 * @param {string[]} argv
 * @returns {{
 *   kind: 'help'|'version'|'command',
 *   command?: string,
 *   subcommand?: string,
 *   projectName?: string,
 *   options: { all: boolean, open: boolean, host?: string, port?: string }
 * }}
 */
function parseJskimArgv(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];

  if (args.length === 0) {
    return { kind: 'help', options: emptyOptions() };
  }

  const first = args[0];
  if (first === '--help' || first === '-h' || first === 'help') {
    return { kind: 'help', options: emptyOptions() };
  }
  if (first === '--version' || first === '-v') {
    return { kind: 'version', options: emptyOptions() };
  }

  if (!COMMANDS.has(first)) {
    throw new Error(formatUnknownCommand(first));
  }

  if (first === 'spec') {
    return parseSpecArgv(args.slice(1));
  }

  const parsed = parseCommandArgv(first, args.slice(1));
  return {
    kind: 'command',
    command: first,
    projectName: parsed.projectName,
    options: parsed.options,
  };
}

/**
 * jskim spec … を解析します。
 * @param {string[]} argv
 */
function parseSpecArgv(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];

  if (args.length === 0) {
    throw new Error(
      [
        '[JSKim] spec のサブコマンドを指定してください。',
        '使用方法:',
        '  jskim spec build [<project>]',
        '  jskim spec collect [<project>]',
      ].join('\n')
    );
  }

  const subcommand = args[0];
  if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    return { kind: 'help', options: emptyOptions() };
  }

  if (subcommand !== 'build' && subcommand !== 'collect') {
    throw new Error(
      [
        `[JSKim] 不明な spec サブコマンドです: ${subcommand}`,
        '使用方法:',
        '  jskim spec build [<project>]',
        '  jskim spec collect [<project>]',
        '',
        '使用できるサブコマンド:',
        '  build [<project>]     画面設計書 viewer を build します。',
        '  collect [<project>]   画面設計書用 snapshot を収集します。',
      ].join('\n')
    );
  }

  const rest = args.slice(1);
  for (const token of rest) {
    if (token.startsWith('-')) {
      throw new Error(
        `[JSKim] コマンド "spec ${subcommand}" ではoption ${token} を使えません。\n` +
          `使用方法: jskim spec ${subcommand} [<project>]`
      );
    }
  }

  if (rest.length > 1) {
    throw new Error(
      `[JSKim] project名は1つだけ指定してください。\n` +
        `受け取った値: ${rest.join(', ')}\n` +
        `使用方法: jskim spec ${subcommand} [<project>]`
    );
  }

  return {
    kind: 'command',
    command: 'spec',
    subcommand,
    projectName: rest[0],
    options: emptyOptions(),
  };
}

/**
 * 特定 command の残 argv を解析します（scripts/*.js 用）。
 *
 * @param {string} command
 * @param {string[]} argv command 名を除いた引数、または scripts の process.argv.slice(2)
 * @returns {{ projectName?: string, options: object }}
 */
function parseCommandArgv(command, argv) {
  if (!COMMANDS.has(command)) {
    throw new Error(formatUnknownCommand(command));
  }

  if (command === 'spec') {
    throw new Error(
      '[JSKim] parseCommandArgv("spec") は使えません。\n' +
        '使用方法: parseJskimArgv(["spec", "build", ...])'
    );
  }

  const allowed = COMMAND_OPTIONS[command];
  const args = Array.isArray(argv) ? argv.slice() : [];
  const options = emptyOptions();
  /** @type {string[]} */
  const positionals = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--') {
      throw new Error(
        `[JSKim] サポートされていない引数です: --\n` +
          `使用方法: jskim ${command} ...`
      );
    }

    if (token.startsWith('-')) {
      if (token.includes('=') && token.startsWith('--')) {
        throw new Error(
          `[JSKim] この書き方のoptionはサポートしていません: ${token}\n` +
            `例: --port 4000（= は使えません）`
        );
      }

      if (!BOOLEAN_OPTIONS.has(token) && !VALUE_OPTIONS.has(token)) {
        throw new Error(
          `[JSKim] 不明なoptionです: ${token}\n` +
            formatAllowedOptions(command)
        );
      }

      if (!allowed.has(token)) {
        throw new Error(
          `[JSKim] コマンド "${command}" ではoption ${token} を使えません。\n` +
            formatAllowedOptions(command)
        );
      }

      if (seen.has(token)) {
        throw new Error(`[JSKim] optionが重複しています: ${token}`);
      }
      seen.add(token);

      if (BOOLEAN_OPTIONS.has(token)) {
        if (token === '--all') {
          options.all = true;
        } else if (token === '--open') {
          options.open = true;
        }
        continue;
      }

      const value = args[i + 1];
      if (
        value === undefined ||
        (value.startsWith('-') && isKnownOptionToken(value))
      ) {
        throw new Error(
          `[JSKim] option ${token} の値がありません。\n` +
            `使用方法: ${token} <value>`
        );
      }
      i += 1;
      if (token === '--host') {
        options.host = value;
      } else if (token === '--port') {
        options.port = value;
      }
      continue;
    }

    positionals.push(token);
  }

  if (positionals.length > 1) {
    throw new Error(
      `[JSKim] project名は1つだけ指定してください。\n` +
        `受け取った値: ${positionals.join(', ')}\n` +
        `使用方法: jskim ${command} [<project>]`
    );
  }

  if (options.all && positionals.length > 0) {
    throw new Error(
      `[JSKim] --all と project名は同時に指定できません。\n` +
        `使用方法: jskim build --all\n` +
        `または: jskim build <project>`
    );
  }

  if (options.all && command !== 'build') {
    throw new Error(
      `[JSKim] コマンド "${command}" ではoption --all を使えません。\n` +
        formatAllowedOptions(command)
    );
  }

  return {
    projectName: positionals[0],
    options,
  };
}

function emptyOptions() {
  return {
    all: false,
    open: false,
  };
}

function isKnownOptionToken(token) {
  return (
    BOOLEAN_OPTIONS.has(token) ||
    VALUE_OPTIONS.has(token) ||
    token === '--help' ||
    token === '-h' ||
    token === '--version' ||
    token === '-v'
  );
}

function formatAllowedOptions(command) {
  const allowed = [...COMMAND_OPTIONS[command]];
  if (allowed.length === 0) {
    return `コマンド "${command}" で使える追加optionはありません。`;
  }
  return `使えるoption: ${allowed.join(', ')}`;
}

function formatUnknownCommand(command) {
  return [
    `[JSKim] 不明なコマンドです: ${command}`,
    '',
    '使用できるコマンド:',
    '  build [<project>]',
    '  build --all',
    '  watch [<project>]',
    '  serve [<project>] [--host <host>] [--port <port>]',
    '  dev [<project>] [--host <host>] [--port <port>] [--open]',
    '  spec build [<project>]',
    '  spec collect [<project>]',
  ].join('\n');
}

module.exports = {
  parseJskimArgv,
  parseCommandArgv,
  parseSpecArgv,
  COMMANDS,
  COMMAND_OPTIONS,
};
