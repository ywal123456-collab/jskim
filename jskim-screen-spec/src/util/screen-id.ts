/**
 * screenId / itemId 共通の kebab-case 規則と reserved word 判定。
 */
export const SCREEN_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const MAX_SCREEN_ID_LENGTH = 128;

/** Windows で予約されているデバイス名（大文字小文字を区別しない） */
export const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/** screenId として予約されている語（ルーティング等で使用） */
const RESERVED_SCREEN_IDS: ReadonlySet<string> = new Set(['_empty']);

export function isReservedScreenId(screenId: string): boolean {
  const lower = screenId.toLowerCase();
  return RESERVED_SCREEN_IDS.has(lower) || WINDOWS_RESERVED_NAMES.has(lower);
}

/**
 * screenId の形式・長さ・reserved word を検証する（存在確認は含まない）。
 */
export function isValidScreenId(screenId: unknown): screenId is string {
  if (typeof screenId !== 'string') {
    return false;
  }
  if (screenId.length === 0 || screenId.length > MAX_SCREEN_ID_LENGTH) {
    return false;
  }
  if (!SCREEN_ID_RE.test(screenId)) {
    return false;
  }
  if (isReservedScreenId(screenId)) {
    return false;
  }
  return true;
}

export function containsPathTraversal(value: string): boolean {
  return (
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0')
  );
}
