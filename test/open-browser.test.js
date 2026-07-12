'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBrowserOpenUrl,
  buildOpenBrowserCommand,
  openBrowser,
} = require('../scripts/lib/open-browser');

describe('open-browser', () => {
  it('wildcard host を browser 用 loopback に変換する', () => {
    assert.equal(
      buildBrowserOpenUrl({ host: '0.0.0.0', port: 4000 }),
      'http://127.0.0.1:4000/'
    );
    assert.equal(
      buildBrowserOpenUrl({ host: '::', port: 4000 }),
      'http://localhost:4000/'
    );
  });

  it('IPv6 host は bracket 付き URL になる', () => {
    const url = buildBrowserOpenUrl({ host: '::1', port: 3000 });
    assert.equal(url, 'http://[::1]:3000/');
  });

  it('Windows / macOS / Linux の command を分離する', () => {
    const url = 'http://127.0.0.1:4000/';
    assert.deepEqual(buildOpenBrowserCommand(url, 'win32'), {
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', url],
    });
    assert.deepEqual(buildOpenBrowserCommand(url, 'darwin'), {
      command: 'open',
      args: [url],
    });
    assert.deepEqual(buildOpenBrowserCommand(url, 'linux'), {
      command: 'xdg-open',
      args: [url],
    });
  });

  it('spawn は shell:false で URL を単一 arg として渡す', () => {
    const calls = [];
    const result = openBrowser('http://127.0.0.1:4000/', {
      platform: 'linux',
      spawnFn(command, args, options) {
        calls.push({ command, args, options });
        return {
          unref() {},
          on() {},
        };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'xdg-open');
    assert.deepEqual(calls[0].args, ['http://127.0.0.1:4000/']);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.stdio, 'ignore');
  });

  it('spawn 失敗は ok:false を返し throw しない', () => {
    const result = openBrowser('http://127.0.0.1:4000/', {
      platform: 'linux',
      spawnFn() {
        throw new Error('spawn failed');
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error.message, /spawn failed/);
  });

  it('Windows でも URL を executable 文字列へ結合しない', () => {
    const url = 'http://127.0.0.1:3000/?q=a&b=1';
    const { command, args } = buildOpenBrowserCommand(url, 'win32');
    assert.equal(command, 'rundll32.exe');
    assert.equal(args.length, 2);
    assert.equal(args[1], url);
    assert.equal(command.includes(url), false);
  });
});
