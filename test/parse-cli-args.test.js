'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseJskimArgv,
  parseCommandArgv,
} = require('../scripts/lib/parse-cli-args');

describe('parse-cli-args', () => {
  it('option 前後の project を同じ結果にする', () => {
    const a = parseJskimArgv(['dev', 'sample', '--port', '4000', '--open']);
    const b = parseJskimArgv(['dev', '--port', '4000', '--open', 'sample']);
    assert.equal(a.kind, 'command');
    assert.equal(a.command, 'dev');
    assert.equal(a.projectName, 'sample');
    assert.equal(a.options.port, '4000');
    assert.equal(a.options.open, true);
    assert.deepEqual(a, b);
  });

  it('help / version を認識する', () => {
    assert.equal(parseJskimArgv([]).kind, 'help');
    assert.equal(parseJskimArgv(['--help']).kind, 'help');
    assert.equal(parseJskimArgv(['-h']).kind, 'help');
    assert.equal(parseJskimArgv(['help']).kind, 'help');
    assert.equal(parseJskimArgv(['--version']).kind, 'version');
    assert.equal(parseJskimArgv(['-v']).kind, 'version');
  });

  it('build --all を認識する', () => {
    const parsed = parseJskimArgv(['build', '--all']);
    assert.equal(parsed.projectName, undefined);
    assert.equal(parsed.options.all, true);
  });

  it('不明な option で失敗する', () => {
    assert.throws(
      () => parseJskimArgv(['dev', '--unknown']),
      /不明なoptionです: --unknown/
    );
  });

  it('equals 記法はサポートしない', () => {
    assert.throws(
      () => parseJskimArgv(['dev', '--port=4000']),
      /サポートしていません/
    );
    assert.throws(
      () => parseJskimArgv(['dev', '--host=0.0.0.0']),
      /サポートしていません/
    );
    assert.throws(
      () => parseJskimArgv(['dev', '--open=true']),
      /サポートしていません/
    );
  });

  it('duplicate option で失敗する', () => {
    assert.throws(
      () => parseJskimArgv(['dev', '--port', '3000', '--port', '4000']),
      /optionが重複しています: --port/
    );
  });

  it('value 欠落で失敗する', () => {
    assert.throws(
      () => parseJskimArgv(['dev', '--port']),
      /値がありません/
    );
    assert.throws(
      () => parseJskimArgv(['dev', '--host']),
      /値がありません/
    );
    assert.throws(
      () => parseJskimArgv(['dev', '--port', '--open']),
      /値がありません/
    );
  });

  it('positional が2つ以上だと失敗する', () => {
    assert.throws(
      () => parseJskimArgv(['build', 'sample', 'other']),
      /project名は1つだけ/
    );
  });

  it('--all と project の同時指定は失敗する', () => {
    assert.throws(
      () => parseJskimArgv(['build', 'sample', '--all']),
      /--all と project名は同時に指定できません/
    );
    assert.throws(
      () => parseJskimArgv(['build', '--all', 'sample']),
      /--all と project名は同時に指定できません/
    );
  });

  it('command ごとの option 許可範囲を検査する', () => {
    assert.throws(
      () => parseJskimArgv(['build', '--port', '4000']),
      /build" ではoption --port/
    );
    assert.throws(
      () => parseJskimArgv(['watch', '--open']),
      /watch" ではoption --open/
    );
    assert.throws(
      () => parseJskimArgv(['serve', '--open']),
      /serve" ではoption --open/
    );
    assert.throws(
      () => parseJskimArgv(['dev', '--all']),
      /dev" ではoption --all/
    );
  });

  it('scripts 用 parseCommandArgv も同じ規則を使う', () => {
    const parsed = parseCommandArgv('serve', [
      '--host',
      '0.0.0.0',
      'sample',
      '--port',
      '4500',
    ]);
    assert.equal(parsed.projectName, 'sample');
    assert.equal(parsed.options.host, '0.0.0.0');
    assert.equal(parsed.options.port, '4500');
  });

  it('--port -1 は value として受け取る', () => {
    const parsed = parseCommandArgv('dev', ['--port', '-1', 'sample']);
    assert.equal(parsed.options.port, '-1');
    assert.equal(parsed.projectName, 'sample');
  });

  it('jskim spec build sample を認識する', () => {
    const parsed = parseJskimArgv(['spec', 'build', 'sample']);
    assert.equal(parsed.kind, 'command');
    assert.equal(parsed.command, 'spec');
    assert.equal(parsed.subcommand, 'build');
    assert.equal(parsed.projectName, 'sample');
  });

  it('jskim spec collect sample を認識する', () => {
    const parsed = parseJskimArgv(['spec', 'collect', 'sample']);
    assert.equal(parsed.kind, 'command');
    assert.equal(parsed.command, 'spec');
    assert.equal(parsed.subcommand, 'collect');
    assert.equal(parsed.projectName, 'sample');
  });

  it('jskim spec dev sample を認識する', () => {
    const parsed = parseJskimArgv(['spec', 'dev', 'sample']);
    assert.equal(parsed.kind, 'command');
    assert.equal(parsed.command, 'spec');
    assert.equal(parsed.subcommand, 'dev');
    assert.equal(parsed.projectName, 'sample');
  });

  it('jskim spec だけではエラーになる', () => {
    assert.throws(
      () => parseJskimArgv(['spec']),
      /spec のサブコマンドを指定してください/
    );
  });

  it('jskim spec build は project 省略でも解析できる', () => {
    const parsed = parseJskimArgv(['spec', 'build']);
    assert.equal(parsed.kind, 'command');
    assert.equal(parsed.command, 'spec');
    assert.equal(parsed.subcommand, 'build');
    assert.equal(parsed.projectName, undefined);
  });

  it('jskim spec collect は project 省略でも解析できる', () => {
    const parsed = parseJskimArgv(['spec', 'collect']);
    assert.equal(parsed.kind, 'command');
    assert.equal(parsed.command, 'spec');
    assert.equal(parsed.subcommand, 'collect');
    assert.equal(parsed.projectName, undefined);
  });

  it('jskim spec unknown はエラーになり build / collect / dev / version を案内する', () => {
    assert.throws(
      () => parseJskimArgv(['spec', 'foo']),
      /不明な spec サブコマンドです: foo/
    );
    assert.throws(
      () => parseJskimArgv(['spec', 'foo']),
      /jskim spec build \[<project>\]/
    );
    assert.throws(
      () => parseJskimArgv(['spec', 'foo']),
      /jskim spec collect \[<project>\]/
    );
    assert.throws(
      () => parseJskimArgv(['spec', 'foo']),
      /jskim spec dev \[<project>\]/
    );
    assert.throws(
      () => parseJskimArgv(['spec', 'foo']),
      /jskim spec version/
    );
  });

  it('不明なコマンド案内に spec build / collect / dev / version が含まれる', () => {
    assert.throws(
      () => parseJskimArgv(['nope']),
      /spec build \[<project>\]/
    );
    assert.throws(
      () => parseJskimArgv(['nope']),
      /spec collect \[<project>\]/
    );
    assert.throws(
      () => parseJskimArgv(['nope']),
      /spec dev \[<project>\]/
    );
    assert.throws(
      () => parseJskimArgv(['nope']),
      /spec version/
    );
  });

  it('jskim spec version サブコマンドを認識する', () => {
    const init = parseJskimArgv(['spec', 'version', 'init', 'sample']);
    assert.equal(init.kind, 'command');
    assert.equal(init.subcommand, 'version');
    assert.equal(init.versionCommand, 'init');
    assert.equal(init.projectName, 'sample');

    const status = parseJskimArgv([
      'spec',
      'version',
      'status',
      'sample',
      '--json',
    ]);
    assert.equal(status.versionCommand, 'status');
    assert.equal(status.options.json, true);

    const add = parseJskimArgv([
      'spec',
      'version',
      'add',
      'sample',
      '--screen',
      'wizard-input',
    ]);
    assert.equal(add.options.screen, 'wizard-input');

    const commit = parseJskimArgv([
      'spec',
      'version',
      'commit',
      'sample',
      '-m',
      '初回',
    ]);
    assert.equal(commit.options.message, '初回');

    const checkout = parseJskimArgv([
      'spec',
      'version',
      'checkout',
      'sample',
      'main',
    ]);
    assert.equal(checkout.projectName, 'sample');
    assert.equal(checkout.revision, 'main');

    const checkoutOnly = parseJskimArgv([
      'spec',
      'version',
      'checkout',
      'abc1234',
    ]);
    assert.equal(checkoutOnly.projectName, undefined);
    assert.equal(checkoutOnly.revision, 'abc1234');

    const help = parseJskimArgv(['spec', 'version', '--help']);
    assert.equal(help.kind, 'help');
    assert.equal(help.helpTopic, 'spec-version');
  });

  it('version add の相互排他と usage exitCode 2', () => {
    assert.throws(() =>
      parseJskimArgv(['spec', 'version', 'add', 'sample', '--all', '--features'])
    );
    try {
      parseJskimArgv(['spec', 'version', 'add', 'sample']);
      assert.fail('should throw');
    } catch (err) {
      assert.equal(err.exitCode, 2);
      assert.equal(err.code, 'JSKIM_USAGE_ERROR');
    }
    assert.throws(() =>
      parseJskimArgv([
        'spec',
        'version',
        'branch',
        'sample',
        '--create',
        'a',
        '--delete',
        'b',
      ])
    );
    assert.throws(() =>
      parseJskimArgv(['spec', 'version', 'commit', 'sample', '--token', 'x'])
    );
    assert.throws(() =>
      parseJskimArgv(['spec', 'version', 'revert', 'sample', 'abc', '-m', 'x'])
    );
  });
});
