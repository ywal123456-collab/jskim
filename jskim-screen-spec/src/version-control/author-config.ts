import fs from 'node:fs';
import path from 'node:path';
import { canonicalizeJsonBytes } from './canonical-json.js';
import { MAX_IDENTITY_NAME_LENGTH } from './constants.js';
import { createDurableFileAtomic } from './durable-create.js';
import { createVersionControlError } from './errors.js';
import { assertMetadataPathBoundary } from './fs-guards.js';
import { versionRepositoryPath } from './repository-paths.js';
import { assertNoIncompleteTransaction } from './transaction.js';
import type { VersionPerson } from './types.js';

export type VersionAuthorConfig = {
  schemaVersion: '1.0';
  user: VersionPerson;
};

export type VersionAuthorOptions = {
  rootDir: string;
  projectName: string;
};

export type ResolveVersionAuthorOptions = VersionAuthorOptions & {
  author?: VersionPerson;
  /** テスト用。未指定時は process.env を使用する。 */
  env?: NodeJS.ProcessEnv;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORBIDDEN_KEYS = new Set([
  'token',
  'password',
  'pat',
  'apikey',
  'authorization',
  'signedurl',
  'credential',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertNoForbiddenKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor' ||
      FORBIDDEN_KEYS.has(key.toLowerCase())
    ) {
      throw createVersionControlError(
        'SPEC_VERSION_CONFIG_INVALID',
        'author 設定に許可されないフィールドがあります。',
      );
    }
    const child = value[key];
    if (isPlainObject(child)) assertNoForbiddenKeys(child);
  }
}

function assertAuthor(value: unknown, code: 'SPEC_VERSION_AUTHOR_INVALID' | 'SPEC_VERSION_CONFIG_INVALID'): VersionPerson {
  if (!isPlainObject(value)) {
    throw createVersionControlError(code, 'author が不正です。');
  }
  if (
    Object.keys(value).some(
      (key) => key !== 'name' && key !== 'email',
    )
  ) {
    throw createVersionControlError(code, 'author のフィールドが不正です。');
  }
  const { name, email } = value;
  if (
    typeof name !== 'string' ||
    name.trim() === '' ||
    name.length > MAX_IDENTITY_NAME_LENGTH ||
    /[\0\r\n]/.test(name)
  ) {
    throw createVersionControlError(code, 'author.name が不正です。');
  }
  if (
    typeof email !== 'string' ||
    email.trim() === '' ||
    email.length > MAX_IDENTITY_NAME_LENGTH ||
    /[\0\r\n]/.test(email) ||
    !EMAIL_RE.test(email)
  ) {
    throw createVersionControlError(code, 'author.email が不正です。');
  }
  return { name, email };
}

function configPath(options: VersionAuthorOptions): string {
  return path.join(versionRepositoryPath(options.rootDir, options.projectName), 'config.json');
}

function assertInitialized(options: VersionAuthorOptions): void {
  const repo = versionRepositoryPath(options.rootDir, options.projectName);
  const format = path.join(repo, 'format.json');
  if (!fs.existsSync(format)) {
    throw createVersionControlError(
      'SPEC_VERSION_NOT_INITIALIZED',
      '版管理リポジトリが初期化されていません。',
    );
  }
  assertMetadataPathBoundary(format, 'format.json');
}

function assertConfig(value: unknown): VersionAuthorConfig {
  if (!isPlainObject(value)) {
    throw createVersionControlError(
      'SPEC_VERSION_CONFIG_INVALID',
      'config.json が不正です。',
    );
  }
  assertNoForbiddenKeys(value);
  if (
    Object.keys(value).some(
      (key) => key !== 'schemaVersion' && key !== 'user',
    ) ||
    value.schemaVersion !== '1.0'
  ) {
    throw createVersionControlError(
      'SPEC_VERSION_CONFIG_INVALID',
      'config.json のフィールドが不正です。',
    );
  }
  return { schemaVersion: '1.0', user: assertAuthor(value.user, 'SPEC_VERSION_CONFIG_INVALID') };
}

function replaceDurably(target: string, content: Buffer): void {
  const dir = path.dirname(target);
  const temp = path.join(
    dir,
    `.config.json.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  let fd: number | null = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    assertMetadataPathBoundary(dir, 'config directory');
    assertMetadataPathBoundary(target, 'config.json');
    fd = fs.openSync(temp, 'wx');
    fs.writeSync(fd, content, 0, content.byteLength, 0);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temp, target);
  } catch {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        // cleanup 失敗は主エラーを上書きしない
      }
    }
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // cleanup 失敗は主エラーを上書きしない
    }
    throw createVersionControlError(
      'SPEC_VERSION_CONFIG_INVALID',
      'config.json を安全に更新できませんでした。',
    );
  }
}

/** project-local な author 設定を読む。未作成時は null を返す。 */
export function loadVersionAuthorConfig(
  options: VersionAuthorOptions,
): VersionAuthorConfig | null {
  assertInitialized(options);
  const target = configPath(options);
  if (!fs.existsSync(target)) return null;
  assertMetadataPathBoundary(target, 'config.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    throw createVersionControlError(
      'SPEC_VERSION_CONFIG_INVALID',
      'config.json を読み取れませんでした。',
    );
  }
  return assertConfig(parsed);
}

/** project-local な author 設定を永続化する。同じ意味の設定は再書き込みしない。 */
export function persistVersionAuthorConfig(
  options: VersionAuthorOptions & { config: VersionAuthorConfig },
): 'created' | 'updated' | 'unchanged' {
  assertInitialized(options);
  assertNoIncompleteTransaction(options);
  const config = assertConfig(options.config);
  const existing = loadVersionAuthorConfig(options);
  if (
    existing &&
    existing.user.name === config.user.name &&
    existing.user.email === config.user.email
  ) {
    return 'unchanged';
  }

  const target = configPath(options);
  const content = Buffer.concat([canonicalizeJsonBytes(config), Buffer.from('\n')]);
  if (!existing) {
    assertMetadataPathBoundary(path.dirname(target), 'config directory');
    const result = createDurableFileAtomic(target, content);
    if (result.status === 'created') return 'created';
    const concurrent = loadVersionAuthorConfig(options);
    if (
      concurrent &&
      concurrent.user.name === config.user.name &&
      concurrent.user.email === config.user.email
    ) {
      return 'unchanged';
    }
  }
  replaceDurably(target, content);
  return 'updated';
}

/** 明示指定、環境変数、project-local 設定の順に commit author を解決する。 */
export function resolveVersionAuthor(
  options: ResolveVersionAuthorOptions,
): VersionPerson {
  if (options.author !== undefined) {
    return assertAuthor(options.author, 'SPEC_VERSION_AUTHOR_INVALID');
  }
  const env = options.env ?? process.env;
  const name = env.JSKIM_SPEC_AUTHOR_NAME;
  const email = env.JSKIM_SPEC_AUTHOR_EMAIL;
  if (name !== undefined || email !== undefined) {
    if (name === undefined || email === undefined) {
      throw createVersionControlError(
        'SPEC_VERSION_AUTHOR_INVALID',
        '環境変数の author.name と author.email は両方必要です。',
      );
    }
    return assertAuthor({ name, email }, 'SPEC_VERSION_AUTHOR_INVALID');
  }
  const config = loadVersionAuthorConfig(options);
  if (config) return config.user;
  throw createVersionControlError(
    'SPEC_VERSION_AUTHOR_REQUIRED',
    'commit author が設定されていません。',
  );
}
