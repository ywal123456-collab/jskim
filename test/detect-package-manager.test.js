'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectPackageManager,
  getPackageManagerCommands,
} = require('../create-jskim/lib/detect-package-manager');

describe('detect-package-manager', () => {
  it('先頭 token で npm / pnpm / yarn を判定する', () => {
    assert.equal(
      detectPackageManager('npm/11.11.0 node/v24.14.1 win32 x64'),
      'npm'
    );
    assert.equal(
      detectPackageManager('pnpm/10.0.0 npm/? node/v24.14.1 win32 x64'),
      'pnpm'
    );
    assert.equal(
      detectPackageManager('yarn/1.22.22 npm/? node/v20.0.0 win32 x64'),
      'yarn'
    );
    assert.equal(
      detectPackageManager('yarn/4.0.0 npm/? node/v20.0.0 win32 x64'),
      'yarn'
    );
  });

  it('後続の npm/? だけでは npm と誤判定しない', () => {
    assert.equal(
      detectPackageManager('pnpm/9.0.0 npm/? node/v20.0.0 linux x64'),
      'pnpm'
    );
    assert.equal(
      detectPackageManager('yarn/3.6.0 npm/? node/v20.0.0 darwin arm64'),
      'yarn'
    );
  });

  it('undefined / null / empty / whitespace / malformed / bun は unknown', () => {
    assert.equal(detectPackageManager(undefined), 'unknown');
    assert.equal(detectPackageManager(null), 'unknown');
    assert.equal(detectPackageManager(''), 'unknown');
    assert.equal(detectPackageManager('   '), 'unknown');
    assert.equal(detectPackageManager('not-a-manager'), 'unknown');
    assert.equal(detectPackageManager('???'), 'unknown');
    assert.equal(
      detectPackageManager('bun/1.2.5 npm/? node/v24.14.1 win32 x64'),
      'unknown'
    );
  });

  it('大文字でも先頭 token を小文字化して判定する', () => {
    assert.equal(
      detectPackageManager('PNPM/10.0.0 npm/? node/v24.14.1 win32 x64'),
      'pnpm'
    );
    assert.equal(
      detectPackageManager('Yarn/1.22.22 npm/? node/v20.0.0 win32 x64'),
      'yarn'
    );
  });

  it('getPackageManagerCommands は unknown を npm にフォールバックする', () => {
    assert.deepEqual(getPackageManagerCommands('npm'), {
      install: 'npm install',
      dev: 'npm run dev',
      effective: 'npm',
    });
    assert.deepEqual(getPackageManagerCommands('pnpm'), {
      install: 'pnpm install',
      dev: 'pnpm dev',
      effective: 'pnpm',
    });
    assert.deepEqual(getPackageManagerCommands('yarn'), {
      install: 'yarn install',
      dev: 'yarn dev',
      effective: 'yarn',
    });
    assert.deepEqual(getPackageManagerCommands('unknown'), {
      install: 'npm install',
      dev: 'npm run dev',
      effective: 'npm',
    });
    assert.deepEqual(getPackageManagerCommands(undefined), {
      install: 'npm install',
      dev: 'npm run dev',
      effective: 'npm',
    });
  });
});
