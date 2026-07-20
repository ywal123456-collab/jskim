'use strict';

/**
 * jskim spec version … の argv 解析。
 * usage エラーは message 付き Error を throw する（呼び出し側で exit 2）。
 */

const VERSION_COMMANDS = new Set([
  'init',
  'config',
  'status',
  'diff',
  'add',
  'commit',
  'log',
  'branch',
  'tag',
  'checkout',
  'revert',
  'merge',
  'fsck',
  'recover',
]);

const BOOLEAN_OPTIONS = new Set([
  '--json',
  '--staged',
  '--all',
  '--features',
  '--inspect',
  '--confirm',
  '--continue',
  '--abort',
]);

const VALUE_OPTIONS = new Set([
  '--screen',
  '--feature',
  '--name',
  '--email',
  '-m',
  '--message',
  '--limit',
  '--cursor',
  '--create',
  '--delete',
  '--start',
  '--target',
  '--operation-id',
]);

const FORBIDDEN_SECRET_OPTIONS = new Set([
  '--token',
  '--password',
  '--pat',
  '--authorization',
]);

/**
 * @returns {object}
 */
function emptyVersionOptions() {
  return {
    json: false,
    staged: false,
    all: false,
    features: false,
    inspect: false,
    confirm: false,
    continue: false,
    abort: false,
    screen: undefined,
    feature: undefined,
    name: undefined,
    email: undefined,
    message: undefined,
    limit: undefined,
    cursor: undefined,
    create: undefined,
    delete: undefined,
    start: undefined,
    target: undefined,
    operationId: undefined,
  };
}

/**
 * @param {string} versionCommand
 * @returns {string}
 */
function usageFor(versionCommand) {
  const lines = {
    init: 'jskim spec version init [<project>]',
    config:
      'jskim spec version config [<project>] --name <name> --email <email>',
    status: 'jskim spec version status [<project>] [--json]',
    diff: 'jskim spec version diff [<project>] [--staged] [--json]',
    add:
      'jskim spec version add [<project>] (--all | --screen <screenId> | --feature <featureId> | --features)',
    commit: 'jskim spec version commit [<project>] -m <message>',
    log: 'jskim spec version log [<project>] [--limit <number>] [--cursor <hash>] [--json]',
    branch:
      'jskim spec version branch [<project>] [--json]\n' +
      '  jskim spec version branch [<project>] --create <name> [--start <revision>]\n' +
      '  jskim spec version branch [<project>] --delete <name>',
    tag:
      'jskim spec version tag [<project>] [--json]\n' +
      '  jskim spec version tag [<project>] --create <name> -m <message> [--target <revision>]',
    checkout: 'jskim spec version checkout [<project>] <revision>',
    revert:
      'jskim spec version revert [<project>] <revision> [--message <message>]',
    merge:
      'jskim spec version merge [<project>] <revision> [--message <message>]\n' +
      '  jskim spec version merge [<project>] --inspect [--json]\n' +
      '  jskim spec version merge [<project>] --continue [--message <message>]\n' +
      '  jskim spec version merge [<project>] --abort',
    fsck: 'jskim spec version fsck [<project>] [--json]',
    recover:
      'jskim spec version recover [<project>] --inspect [--json]\n' +
      '  jskim spec version recover [<project>] --operation-id <uuid> --confirm',
  };
  return lines[versionCommand] || 'jskim spec version <subcommand>';
}

/**
 * @returns {string}
 */
function getSpecVersionHelpText() {
  return [
    'JSKim Screen Spec ローカル版管理',
    '',
    '使用方法:',
    '  jskim spec version init [<project>]',
    '  jskim spec version config [<project>] --name <name> --email <email>',
    '  jskim spec version status [<project>] [--json]',
    '  jskim spec version diff [<project>] [--staged] [--json]',
    '  jskim spec version add [<project>] --all',
    '  jskim spec version add [<project>] --screen <screenId>',
    '  jskim spec version add [<project>] --feature <featureId>',
    '  jskim spec version add [<project>] --features',
    '  jskim spec version commit [<project>] -m <message>',
    '  jskim spec version log [<project>] [--limit <n>] [--cursor <hash>] [--json]',
    '  jskim spec version branch [<project>] [--json]',
    '  jskim spec version branch [<project>] --create <name> [--start <revision>]',
    '  jskim spec version branch [<project>] --delete <name>',
    '  jskim spec version tag [<project>] [--json]',
    '  jskim spec version tag [<project>] --create <name> -m <message> [--target <revision>]',
    '  jskim spec version checkout [<project>] <revision>',
    '  jskim spec version revert [<project>] <revision> [--message <message>]',
    '  jskim spec version merge [<project>] <revision> [--message <message>]',
    '  jskim spec version merge [<project>] --inspect [--json]',
    '  jskim spec version merge [<project>] --continue [--message <message>]',
    '  jskim spec version merge [<project>] --abort',
    '  jskim spec version fsck [<project>] [--json]',
    '  jskim spec version recover [<project>] --inspect [--json]',
    '  jskim spec version recover [<project>] --operation-id <uuid> --confirm',
    '',
    '補足:',
    '  @ywal123456/jskim-screen-spec（optional）が必要です。',
    '  implementation の source Git / Git tag とは別系統です。Remote はありません。',
    '  commit は stage 済みの Screen Spec のみを記録します（collect は自動実行しません）。',
    '  checkout は Screen Spec の仕様 source を切り替え、実装 Nunjucks は変更しません。',
    '  Screen Spec 内部 tag は source Git tag と自動連携しません。',
  ].join('\n');
}

/**
 * @param {string} token
 * @returns {boolean}
 */
function isOptionToken(token) {
  return (
    BOOLEAN_OPTIONS.has(token) ||
    VALUE_OPTIONS.has(token) ||
    FORBIDDEN_SECRET_OPTIONS.has(token) ||
    token === '--help' ||
    token === '-h'
  );
}

/**
 * @param {string[]} argv version サブコマンド名を除いた残り
 * @param {string} versionCommand
 * @returns {{
 *   projectName?: string,
 *   revision?: string,
 *   options: ReturnType<typeof emptyVersionOptions>
 * }}
 */
function parseVersionCommandArgv(argv, versionCommand) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const options = emptyVersionOptions();
  /** @type {string[]} */
  const positionals = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--') {
      throw usageError(
        `サポートされていない引数です: --\n使用方法: ${usageFor(versionCommand)}`
      );
    }

    if (token.startsWith('-')) {
      if (token.includes('=') && token.startsWith('--')) {
        throw usageError(
          `この書き方のoptionはサポートしていません: ${token}\n` +
            '例: --limit 10（= は使えません）'
        );
      }

      if (FORBIDDEN_SECRET_OPTIONS.has(token)) {
        throw usageError(
          `不明なoptionです: ${token}\n使用方法: ${usageFor(versionCommand)}`
        );
      }

      if (!BOOLEAN_OPTIONS.has(token) && !VALUE_OPTIONS.has(token)) {
        throw usageError(
          `不明なoptionです: ${token}\n使用方法: ${usageFor(versionCommand)}`
        );
      }

      const canonical =
        token === '-m' || token === '--message' ? '--message' : token;
      if (seen.has(canonical)) {
        throw usageError(`optionが重複しています: ${token}`);
      }
      seen.add(canonical);

      if (BOOLEAN_OPTIONS.has(token)) {
        if (token === '--json') options.json = true;
        else if (token === '--staged') options.staged = true;
        else if (token === '--all') options.all = true;
        else if (token === '--features') options.features = true;
        else if (token === '--inspect') options.inspect = true;
        else if (token === '--confirm') options.confirm = true;
        else if (token === '--continue') options.continue = true;
        else if (token === '--abort') options.abort = true;
        continue;
      }

      const value = args[i + 1];
      if (
        value === undefined ||
        (value.startsWith('-') && isOptionToken(value))
      ) {
        throw usageError(
          `option ${token} の値がありません。\n使用方法: ${token} <value>`
        );
      }
      i += 1;

      if (token === '--screen') options.screen = value;
      else if (token === '--feature') options.feature = value;
      else if (token === '--name') options.name = value;
      else if (token === '--email') options.email = value;
      else if (token === '-m' || token === '--message') options.message = value;
      else if (token === '--limit') options.limit = value;
      else if (token === '--cursor') options.cursor = value;
      else if (token === '--create') options.create = value;
      else if (token === '--delete') options.delete = value;
      else if (token === '--start') options.start = value;
      else if (token === '--target') options.target = value;
      else if (token === '--operation-id') options.operationId = value;
      continue;
    }

    positionals.push(token);
  }

  assertCommandConstraints(versionCommand, options, positionals);
  return assignPositionals(versionCommand, options, positionals);
}

/**
 * @param {string} message
 * @returns {Error}
 */
function usageError(message) {
  const err = new Error(`[JSKim] ${message}`);
  err.code = 'JSKIM_USAGE_ERROR';
  err.exitCode = 2;
  return err;
}

/**
 * @param {string} versionCommand
 * @param {ReturnType<typeof emptyVersionOptions>} options
 * @param {string[]} positionals
 */
function assertCommandConstraints(versionCommand, options, positionals) {
  const allowedJson = new Set([
    'status',
    'diff',
    'log',
    'branch',
    'tag',
    'fsck',
    'recover',
    'init',
    'config',
    'add',
    'commit',
    'checkout',
    'revert',
    'merge',
  ]);
  if (options.json && !allowedJson.has(versionCommand)) {
    throw usageError(
      `コマンド "version ${versionCommand}" では --json を使えません。`
    );
  }

  if (versionCommand === 'add') {
    const scopes = [
      options.all,
      options.screen != null,
      options.feature != null,
      options.features,
    ].filter(Boolean).length;
    if (scopes !== 1) {
      throw usageError(
        '--all / --screen / --feature / --features のいずれかを1つだけ指定してください。\n' +
          `使用方法: ${usageFor('add')}`
      );
    }
  } else {
    if (
      options.all ||
      options.screen != null ||
      options.feature != null ||
      options.features
    ) {
      throw usageError(
        `コマンド "version ${versionCommand}" では add 用 option を使えません。`
      );
    }
  }

  if (options.staged && versionCommand !== 'diff') {
    throw usageError(
      `コマンド "version ${versionCommand}" では --staged を使えません。`
    );
  }

  if (versionCommand === 'config') {
    if (!options.name || !options.email) {
      throw usageError(
        '--name と --email の両方が必要です。\n' + `使用方法: ${usageFor('config')}`
      );
    }
  } else if (options.name != null || options.email != null) {
    throw usageError(
      `コマンド "version ${versionCommand}" では --name / --email を使えません。`
    );
  }

  if (versionCommand === 'commit') {
    if (options.message == null || options.message === '') {
      throw usageError(
        '-m / --message が必要です。\n' + `使用方法: ${usageFor('commit')}`
      );
    }
  }

  if (versionCommand === 'revert') {
    // revert の message は --message のみ（-m は commit 専用として拒否）
    // parse 段階では -m も --message に正規化済み。revert では --message を許可。
  }

  if (versionCommand === 'branch') {
    if (options.create != null && options.delete != null) {
      throw usageError(
        '--create と --delete は同時に指定できません。\n' +
          `使用方法: ${usageFor('branch')}`
      );
    }
    if (options.start != null && options.create == null) {
      throw usageError(
        '--start は --create と一緒に指定してください。\n' +
          `使用方法: ${usageFor('branch')}`
      );
    }
  } else if (
    options.create != null ||
    options.delete != null ||
    options.start != null
  ) {
    if (versionCommand !== 'tag') {
      throw usageError(
        `コマンド "version ${versionCommand}" では branch/tag 用 option を使えません。`
      );
    }
  }

  if (versionCommand === 'tag') {
    if (options.delete != null) {
      throw usageError(
        'tag の削除はサポートしていません。\n' + `使用方法: ${usageFor('tag')}`
      );
    }
    if (options.create != null) {
      if (options.message == null || options.message === '') {
        throw usageError(
          'tag 作成には -m / --message が必要です。\n' +
            `使用方法: ${usageFor('tag')}`
        );
      }
    } else if (options.target != null || options.message != null) {
      throw usageError(
        '--target / --message は --create と一緒に指定してください。\n' +
          `使用方法: ${usageFor('tag')}`
      );
    }
  }

  if (versionCommand === 'recover') {
    if (options.inspect && (options.operationId != null || options.confirm)) {
      throw usageError(
        '--inspect と --operation-id / --confirm は同時に指定できません。\n' +
          `使用方法: ${usageFor('recover')}`
      );
    }
    if (!options.inspect) {
      if (options.operationId == null || !options.confirm) {
        throw usageError(
          'recovery 実行には --operation-id と --confirm が必要です。\n' +
            `使用方法: ${usageFor('recover')}`
        );
      }
    }
  } else if (
    options.inspect ||
    options.confirm ||
    options.operationId != null ||
    options.continue ||
    options.abort
  ) {
    if (versionCommand !== 'merge' || options.confirm || options.operationId != null) {
      throw usageError(
        `コマンド "version ${versionCommand}" では recover / merge 専用 option を使えません。`
      );
    }
    if (options.inspect && (options.continue || options.abort)) {
      throw usageError(
        '--inspect と --continue / --abort は同時に指定できません。\n' +
          `使用方法: ${usageFor('merge')}`
      );
    }
    if (options.continue && options.abort) {
      throw usageError(
        '--continue と --abort は同時に指定できません。\n' +
          `使用方法: ${usageFor('merge')}`
      );
    }
  }

  if (versionCommand === 'merge') {
    const flagModes = [
      options.inspect,
      options.continue,
      options.abort,
    ].filter(Boolean).length;
    const startMode = flagModes === 0;
    if (startMode && positionals.length === 0) {
      throw usageError(
        'revision を指定するか --inspect / --continue / --abort のいずれかを指定してください。\n' +
          `使用方法: ${usageFor('merge')}`
      );
    }
    if (!startMode && positionals.length > 1) {
      throw usageError(
        'project名は1つだけ指定してください。\n' +
          `受け取った値: ${positionals.join(', ')}\n` +
          `使用方法: ${usageFor('merge')}`
      );
    }
  } else if (options.continue || options.abort) {
    throw usageError(
      `コマンド "version ${versionCommand}" では --continue / --abort を使えません。`
    );
  }

  if (
    (options.limit != null || options.cursor != null) &&
    versionCommand !== 'log'
  ) {
    throw usageError(
      `コマンド "version ${versionCommand}" では --limit / --cursor を使えません。`
    );
  }

  if (versionCommand === 'log' && options.limit != null) {
    if (!/^\d+$/.test(options.limit)) {
      throw usageError('--limit は 1 以上の整数で指定してください。');
    }
    const n = Number(options.limit);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      throw usageError('--limit は 1〜500 の範囲で指定してください。');
    }
  }
}

/**
 * @param {string} versionCommand
 * @param {ReturnType<typeof emptyVersionOptions>} options
 * @param {string[]} positionals
 */
function assignPositionals(versionCommand, options, positionals) {
  if (
    versionCommand === 'checkout' ||
    versionCommand === 'revert' ||
    (versionCommand === 'merge' &&
      !options.inspect &&
      !options.continue &&
      !options.abort)
  ) {
    if (positionals.length === 0) {
      throw usageError(
        'revision を指定してください。\n' + `使用方法: ${usageFor(versionCommand)}`
      );
    }
    if (positionals.length === 1) {
      return {
        projectName: undefined,
        revision: positionals[0],
        options,
      };
    }
    if (positionals.length === 2) {
      return {
        projectName: positionals[0],
        revision: positionals[1],
        options,
      };
    }
    throw usageError(
      '引数が多すぎます。\n' +
        `受け取った値: ${positionals.join(', ')}\n` +
        `使用方法: ${usageFor(versionCommand)}`
    );
  }

  if (positionals.length > 1) {
    throw usageError(
      'project名は1つだけ指定してください。\n' +
        `受け取った値: ${positionals.join(', ')}\n` +
        `使用方法: ${usageFor(versionCommand)}`
    );
  }

  return {
    projectName: positionals[0],
    revision: undefined,
    options,
  };
}

/**
 * jskim spec version … を解析する。
 * @param {string[]} argv 'version' より後の引数
 */
function parseSpecVersionArgv(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];

  if (args.length === 0) {
    throw usageError(
      [
        'version のサブコマンドを指定してください。',
        '使用方法:',
        '  jskim spec version --help',
        '  jskim spec version init [<project>]',
        '  jskim spec version status [<project>]',
      ].join('\n')
    );
  }

  const first = args[0];
  if (first === '--help' || first === '-h' || first === 'help') {
    return {
      kind: 'help',
      helpTopic: 'spec-version',
      options: emptyVersionOptions(),
    };
  }

  if (!VERSION_COMMANDS.has(first)) {
    throw usageError(
      [
        `不明な version サブコマンドです: ${first}`,
        '使用方法: jskim spec version --help',
      ].join('\n')
    );
  }

  // revert では -m を拒否し --message のみ許可
  if (first === 'revert') {
    for (const token of args.slice(1)) {
      if (token === '-m') {
        throw usageError(
          'revert の commit message は --message で指定してください（-m は使えません）。\n' +
            `使用方法: ${usageFor('revert')}`
        );
      }
    }
  }

  const parsed = parseVersionCommandArgv(args.slice(1), first);
  return {
    kind: 'command',
    command: 'spec',
    subcommand: 'version',
    versionCommand: first,
    projectName: parsed.projectName,
    revision: parsed.revision,
    options: parsed.options,
  };
}

module.exports = {
  parseSpecVersionArgv,
  getSpecVersionHelpText,
  VERSION_COMMANDS,
  usageFor,
};
