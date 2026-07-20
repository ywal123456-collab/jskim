import fs from 'node:fs';
import path from 'node:path';

/**
 * durable create 用 filesystem adapter。
 * production は node:fs。test は fault injection に使う。
 */
export type DurableCreateFs = {
  mkdirSync: (
    p: string,
    options?: { recursive?: boolean },
  ) => string | undefined | void;
  openSync: (p: string, flags: string) => number;
  writeSync: (
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    offset?: number,
    length?: number,
    position?: number,
  ) => number;
  fsyncSync: (fd: number) => void;
  closeSync: (fd: number) => void;
  unlinkSync: (p: string) => void;
  existsSync: (p: string) => boolean;
  linkSync: (existingPath: string, newPath: string) => void;
  /**
   * directory の fsync（Unix）。未指定または失敗時は best-effort で無視する。
   * Windows では directory fsync を成功条件にしない。
   */
  openDirSync?: (p: string) => number;
};

export type DurableCreateOptions = {
  fs?: DurableCreateFs;
  tempPath?: string;
};

export type DurableCreateResult =
  | { status: 'created' }
  | { status: 'exists' };

function cleanupTemp(io: DurableCreateFs, tempPath: string): void {
  try {
    if (io.existsSync(tempPath)) {
      io.unlinkSync(tempPath);
    }
  } catch {
    // cleanup 失敗は主エラーを上書きしない
  }
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

function defaultOpenDirSync(dir: string): number {
  return fs.openSync(dir, 'r');
}

/**
 * 新規ファイルのみを durable に作成する（create-if-absent / no-replace）。
 *
 * アルゴリズム:
 * 1. 同一 directory に exclusive TEMP を open（'wx'）
 * 2. 全 bytes を write
 * 3. file fsync
 * 4. close
 * 5. hard link で destination を公開
 * 6. TEMP unlink
 * 7. parent directory fsync は best-effort（失敗しても成功扱い。Windows では期待しない）
 *
 * 方針:
 * - file data durability: TEMP の fsync までを成功条件とする
 * - directory entry durability: プラットフォーム差があるため成功条件にしない
 * - process crash 中の TEMP 部分書き込みは destination に現れない
 */
export function createDurableFileAtomic(
  filePath: string,
  content: string | Buffer,
  options: DurableCreateOptions = {},
): DurableCreateResult {
  const io: DurableCreateFs = options.fs || {
    mkdirSync: fs.mkdirSync.bind(fs),
    openSync: fs.openSync.bind(fs),
    writeSync: fs.writeSync.bind(fs),
    fsyncSync: fs.fsyncSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
    existsSync: fs.existsSync.bind(fs),
    linkSync: fs.linkSync.bind(fs),
    openDirSync: defaultOpenDirSync,
  };

  const buf = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, 'utf8');

  const dir = path.dirname(filePath);
  io.mkdirSync(dir, { recursive: true });

  const stamp = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const tempPath =
    options.tempPath ||
    path.join(dir, `.${path.basename(filePath)}.${stamp}.tmp`);

  let fd: number | null = null;
  try {
    fd = io.openSync(tempPath, 'wx');
    let offset = 0;
    while (offset < buf.byteLength) {
      const written = io.writeSync(
        fd,
        buf,
        offset,
        buf.byteLength - offset,
        offset,
      );
      if (written <= 0) {
        throw new Error('TEMP への書き込みが進みませんでした。');
      }
      offset += written;
    }
    io.fsyncSync(fd);
    io.closeSync(fd);
    fd = null;
  } catch (err) {
    if (fd != null) {
      try {
        io.closeSync(fd);
      } catch {
        // ignore
      }
      fd = null;
    }
    cleanupTemp(io, tempPath);
    throw err;
  }

  try {
    io.linkSync(tempPath, filePath);
  } catch (err) {
    cleanupTemp(io, tempPath);
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

  cleanupTemp(io, tempPath);

  // directory entry durability は best-effort。Windows では失敗しうる。
  if (io.openDirSync) {
    let dirFd: number | null = null;
    try {
      dirFd = io.openDirSync(dir);
      io.fsyncSync(dirFd);
    } catch {
      // 成功条件にしない
    } finally {
      if (dirFd != null) {
        try {
          io.closeSync(dirFd);
        } catch {
          // ignore
        }
      }
    }
  }

  return { status: 'created' };
}
