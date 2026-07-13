import { contentHash12 } from './content-hash.js';

export type ResourceKind = 'stylesheet' | 'image' | 'font' | 'other';

export type ResourceFile = {
  id: string;
  hash: string;
  ext: string;
  kind: ResourceKind;
  byteLength: number;
  bytes: Buffer;
};

export type StyleRef = {
  kind: 'link' | 'style';
  resourceId: string;
  media: string;
  disabled: boolean;
};

/**
 * 収集中のリソースをメモリに保持し、重複は hash で再利用する。
 */
export class ResourceBag {
  private readonly files = new Map<string, ResourceFile>();
  private reusedCount = 0;
  readonly warnings: string[] = [];

  put(
    bytes: Buffer,
    ext: string,
    kind: ResourceKind,
  ): string {
    const normalizedExt = ext.replace(/^\./, '').toLowerCase() || 'bin';
    const hash = contentHash12(bytes);
    const id = `${hash}.${normalizedExt}`;
    const existing = this.files.get(id);
    if (existing) {
      this.reusedCount += 1;
      return id;
    }
    this.files.set(id, {
      id,
      hash,
      ext: normalizedExt,
      kind,
      byteLength: bytes.byteLength,
      bytes,
    });
    return id;
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  get size(): number {
    return this.files.size;
  }

  get resourcesReused(): number {
    return this.reusedCount;
  }

  list(): ResourceFile[] {
    return [...this.files.values()].sort((a, b) =>
      a.id.localeCompare(b.id, 'en'),
    );
  }

  has(id: string): boolean {
    return this.files.has(id);
  }

  get(id: string): ResourceFile | undefined {
    return this.files.get(id);
  }
}

export function extensionFromUrlOrType(
  url: string,
  contentType?: string | null,
  fallback = 'bin',
): string {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split('/').pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot >= 0 && dot < base.length - 1) {
      const ext = base.slice(dot + 1).toLowerCase();
      if (/^[a-z0-9]+$/i.test(ext) && ext.length <= 8) {
        return ext;
      }
    }
  } catch {
    // ignore
  }

  if (contentType) {
    const ct = contentType.split(';')[0].trim().toLowerCase();
    const map: Record<string, string> = {
      'text/css': 'css',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/x-icon': 'ico',
      'font/woff': 'woff',
      'font/woff2': 'woff2',
      'font/ttf': 'ttf',
      'font/otf': 'otf',
      'application/font-woff': 'woff',
      'application/font-woff2': 'woff2',
    };
    if (map[ct]) {
      return map[ct];
    }
  }

  return fallback;
}

export function kindFromExt(ext: string): ResourceKind {
  const e = ext.toLowerCase();
  if (e === 'css') {
    return 'stylesheet';
  }
  if (
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif'].includes(e)
  ) {
    return 'image';
  }
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(e)) {
    return 'font';
  }
  return 'other';
}
