'use strict';

/**
 * npm_config_user_agent から実行元 package manager を判定します。
 * 先頭 token のみを見ます（後続の npm/? で誤判定しない）。
 *
 * @param {string|null|undefined} userAgent
 * @returns {'npm'|'pnpm'|'yarn'|'unknown'}
 */
function detectPackageManager(userAgent) {
  if (userAgent == null) {
    return 'unknown';
  }

  const normalized = String(userAgent).trim().toLowerCase();
  if (normalized === '') {
    return 'unknown';
  }

  const firstToken = normalized.split(/\s+/)[0] || '';
  if (firstToken.startsWith('pnpm/')) {
    return 'pnpm';
  }
  if (firstToken.startsWith('yarn/')) {
    return 'yarn';
  }
  if (firstToken.startsWith('npm/')) {
    return 'npm';
  }
  return 'unknown';
}

/**
 * 完了案内用の install / dev コマンドを返します。
 * unknown は npm にフォールバックします。
 *
 * @param {string|undefined} packageManager
 * @returns {{ install: string, dev: string, effective: 'npm'|'pnpm'|'yarn' }}
 */
function getPackageManagerCommands(packageManager) {
  const key =
    packageManager === 'pnpm' || packageManager === 'yarn'
      ? packageManager
      : 'npm';

  if (key === 'pnpm') {
    return {
      install: 'pnpm install',
      dev: 'pnpm dev',
      effective: 'pnpm',
    };
  }
  if (key === 'yarn') {
    return {
      install: 'yarn install',
      dev: 'yarn dev',
      effective: 'yarn',
    };
  }
  return {
    install: 'npm install',
    dev: 'npm run dev',
    effective: 'npm',
  };
}

module.exports = {
  detectPackageManager,
  getPackageManagerCommands,
};
