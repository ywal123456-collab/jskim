import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type WriteFileAtomicFs = {
  existsSync: (p: string) => boolean;
  mkdirSync: (
    p: string,
    options?: { recursive?: boolean },
  ) => string | undefined | void;
  readFileSync: (p: string) => Buffer;
  writeFileSync: (p: string, data: Buffer) => void;
  renameSync: (from: string, to: string) => void;
  unlinkSync: (p: string) => void;
  /**
   * createFileAtomic 用: 完成済み TEMP を destination 名で no-replace 公開する。
   * 未指定時は node:fs.linkSync を使う。
   */
  linkSync?: (existingPath: string, newPath: string) => void;
};

export type WriteFileAtomicOptions = {
  /** テスト用 filesystem 注入 */
  fs?: WriteFileAtomicFs;
  /** テスト用: TEMP パス固定 */
  tempPath?: string;
  /** テスト用: backup パス固定 */
  backupPath?: string;
  /**
   * 指定時は backup 退避直後に内容 revision を再検証する。
   * 不一致なら destination を復元して conflict を返す。
   */
  expectedRevision?: string;
  /** ファイル未存在時の empty revision（expectedRevision 比較用） */
  emptyRevision?: string;
};

export type WriteFileAtomicResult =
  | { status: 'updated' }
  | { status: 'unchanged' }
  | {
      status: 'conflict';
      expectedRevision: string;
      currentRevision: string;
    };

function cleanupPath(io: WriteFileAtomicFs, p: string): void {
  try {
    if (io.existsSync(p)) {
      io.unlinkSync(p);
    }
  } catch {
    // cleanup 失敗は握りつぶす
  }
}

function restoreBackup(
  io: WriteFileAtomicFs,
  filePath: string,
  backupPath: string,
): void {
  try {
    if (!io.existsSync(filePath) && io.existsSync(backupPath)) {
      io.renameSync(backupPath, filePath);
    }
  } catch {
    // ignore
  }
}

/**
 * UTF-8 ファイルを安全に置き換える。
 *
 * 正常系:
 * - 同一内容 → unchanged（mtime 維持）
 * - destination 無し → TEMP に全文書き込み → rename
 * - destination 有り → TEMP 書き込み →（可能なら）直接 rename
 *   → 失敗時は backup swap:
 *     destination → backup →（revision 検証）→ TEMP → destination → backup 削除
 *
 * 単純な copyFile(TEMP, destination) は使わない。
 */
export function writeFileAtomic(
  filePath: string,
  content: string | Buffer,
  options: WriteFileAtomicOptions = {},
): WriteFileAtomicResult {
  const io = options.fs || fs;
  const nextBuf = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, 'utf8');
  const expectRev = options.expectedRevision;

  if (io.existsSync(filePath)) {
    const existing = io.readFileSync(filePath);
    if (Buffer.compare(existing, nextBuf) === 0) {
      if (expectRev != null) {
        const current = computeContentRevision(existing);
        if (current !== expectRev) {
          return {
            status: 'conflict',
            expectedRevision: expectRev,
            currentRevision: current,
          };
        }
      }
      return { status: 'unchanged' };
    }
    if (expectRev != null) {
      const current = computeContentRevision(existing);
      if (current !== expectRev) {
        return {
          status: 'conflict',
          expectedRevision: expectRev,
          currentRevision: current,
        };
      }
    }
  } else if (expectRev != null) {
    const emptyRev = options.emptyRevision || computeContentRevision('');
    if (expectRev !== emptyRev) {
      return {
        status: 'conflict',
        expectedRevision: expectRev,
        currentRevision: emptyRev,
      };
    }
  }

  const dir = path.dirname(filePath);
  io.mkdirSync(dir, { recursive: true });

  const stamp = `${process.pid}.${Date.now()}`;
  const tempPath =
    options.tempPath ||
    path.join(dir, `.${path.basename(filePath)}.${stamp}.tmp`);
  const backupPath =
    options.backupPath ||
    path.join(dir, `.${path.basename(filePath)}.${stamp}.bak`);

  try {
    io.writeFileSync(tempPath, nextBuf);
  } catch (err) {
    cleanupPath(io, tempPath);
    throw err;
  }

  const destExists = io.existsSync(filePath);

  if (!destExists) {
    try {
      io.renameSync(tempPath, filePath);
      return { status: 'updated' };
    } catch (err) {
      cleanupPath(io, tempPath);
      throw err;
    }
  }

  // revision 条件付き、または直接 rename 失敗時に backup swap を使う
  if (expectRev == null) {
    try {
      io.renameSync(tempPath, filePath);
      return { status: 'updated' };
    } catch {
      // Windows 等: 既存上書き rename 不可 → backup swap へ
    }
  }

  try {
    io.renameSync(filePath, backupPath);
  } catch (err) {
    cleanupPath(io, tempPath);
    cleanupPath(io, backupPath);
    throw err;
  }

  if (expectRev != null) {
    let backupRevision: string;
    try {
      backupRevision = computeContentRevision(io.readFileSync(backupPath));
    } catch (err) {
      restoreBackup(io, filePath, backupPath);
      cleanupPath(io, tempPath);
      cleanupPath(io, backupPath);
      throw err;
    }

    if (backupRevision !== expectRev) {
      restoreBackup(io, filePath, backupPath);
      cleanupPath(io, tempPath);
      cleanupPath(io, backupPath);
      return {
        status: 'conflict',
        expectedRevision: expectRev,
        currentRevision: backupRevision,
      };
    }
  }

  try {
    io.renameSync(tempPath, filePath);
  } catch (err) {
    restoreBackup(io, filePath, backupPath);
    cleanupPath(io, tempPath);
    cleanupPath(io, backupPath);
    throw err;
  }

  cleanupPath(io, backupPath);
  cleanupPath(io, tempPath);
  return { status: 'updated' };
}

/** 旧呼び出し向け: conflict は throw、戻り値は updated/unchanged */
export function writeFileAtomicOrThrow(
  filePath: string,
  content: string | Buffer,
  options: WriteFileAtomicOptions = {},
): 'updated' | 'unchanged' {
  const result = writeFileAtomic(filePath, content, options);
  if (result.status === 'conflict') {
    const err = new Error(
      'ファイルが別の場所で変更されているため保存できませんでした。',
    ) as Error & {
      code: string;
      expectedRevision: string;
      currentRevision: string;
      statusCode: number;
    };
    err.code = 'SPEC_DESCRIPTION_REVISION_CONFLICT';
    err.expectedRevision = result.expectedRevision;
    err.currentRevision = result.currentRevision;
    err.statusCode = 409;
    throw err;
  }
  return result.status;
}

export type CreateFileAtomicResult =
  | { status: 'created' }
  | { status: 'exists' };

/**
 * 新規ファイルのみを作成する（create-if-absent / no-replace）。
 *
 * アルゴリズム:
 * 1. 同一 directory に unique TEMP を作る
 * 2. TEMP に全文を書き込む（現行と同様 writeFileSync）
 * 3. `fs.linkSync(TEMP, destination)` で完成済み inode を destination 名で公開
 * 4. 成功後 TEMP 名だけを unlink（失敗しても destination は完成済み）
 *
 * - destination が既にある場合（EEXIST）は上書きせず `{ status: 'exists' }`
 * - hard link 非対応 FS（ENOTSUP / EOPNOTSUPP / EXDEV 等）は copy fallback せず fail-closed
 * - COPYFILE_EXCL による非原子的コピーは使わない
 */
export function createFileAtomic(
  filePath: string,
  content: string | Buffer,
  options: WriteFileAtomicOptions = {},
): CreateFileAtomicResult {
  const io = options.fs || fs;
  const buf = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, 'utf8');

  const dir = path.dirname(filePath);
  io.mkdirSync(dir, { recursive: true });

  const stamp = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const tempPath =
    options.tempPath ||
    path.join(dir, `.${path.basename(filePath)}.${stamp}.tmp`);

  try {
    io.writeFileSync(tempPath, buf);
  } catch (err) {
    cleanupPath(io, tempPath);
    throw err;
  }

  const linkSync = io.linkSync || fs.linkSync;

  try {
    linkSync(tempPath, filePath);
  } catch (err) {
    cleanupPath(io, tempPath);
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EEXIST') {
      return { status: 'exists' };
    }
    if (isUnsupportedLinkError(code)) {
      const unsupported = new Error(
        'このファイルシステムでは安全な新規ファイル作成（hard link）を利用できません。',
      ) as Error & { code: string; statusCode: number; cause?: unknown };
      unsupported.code = 'CREATE_FILE_ATOMIC_UNSUPPORTED';
      unsupported.statusCode = 500;
      unsupported.cause = err;
      throw unsupported;
    }
    throw err;
  }

  // destination 公開は成功済み。TEMP 名の削除失敗は主エラーにしない。
  cleanupPath(io, tempPath);
  return { status: 'created' };
}

function isUnsupportedLinkError(code: string | undefined): boolean {
  return (
    code === 'ENOTSUP' ||
    code === 'EOPNOTSUPP' ||
    code === 'EXDEV' ||
    code === 'EINVAL' ||
    code === 'ENOSYS'
  );
}

export function computeContentRevision(content: string | Buffer): string {
  const buf = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, 'utf8');
  return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

export function computeEmptyDescriptionRevision(screenId: string): string {
  const empty = {
    schemaVersion: '1.1',
    screen: { id: screenId, name: '', description: '' },
    itemOrder: [],
    items: {},
  };
  return computeContentRevision(`${JSON.stringify(empty, null, 2)}\n`);
}

/**
 * IMPLEMENTATION_ONLY の初回 GET/PUT 用: `$schema` を含まない
 * canonical stringify から revision を計算する。
 * 保存対象ファイルの実体は無いため、常にこの関数で計算した値を使う。
 */
export function computeDraftRevision(document: unknown): string {
  return computeContentRevision(`${JSON.stringify(document, null, 2)}\n`);
}
