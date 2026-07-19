import { createFigmaError } from './errors.js';
import type { FigmaFileNodeRef, FigmaParseInput } from './types.js';

const FIGMA_HOSTS = new Set(['figma.com', 'www.figma.com']);

/** API 用 nodeId: 数字:数字（URL の hyphen を正規化後） */
const NORMALIZED_NODE_ID_RE = /^\d+:\d+$/;

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * fileKey を検証する（過度に狭い文字種制限はしない）。
 */
export function validateFileKey(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'fileKey が不正です。',
    );
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'fileKey が空です。',
    );
  }
  if (trimmed !== raw.trim()) {
    // trim 後と一致（呼び出し側は trim 済みを渡す想定）
  }
  if (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    trimmed.includes('&') ||
    trimmed.includes('=') ||
    hasControlChars(trimmed)
  ) {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'fileKey に使用できない文字が含まれています。',
    );
  }
  return trimmed;
}

/**
 * nodeId を colon 形式へ正規化する（1-3 → 1:3、1:3 → 1:3）。
 */
export function normalizeNodeId(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'nodeId が不正です。',
    );
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'nodeId が空です。',
    );
  }
  if (hasControlChars(trimmed)) {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'nodeId に使用できない文字が含まれています。',
    );
  }

  const hyphenMatch = /^(\d+)-(\d+)$/.exec(trimmed);
  if (hyphenMatch) {
    return `${hyphenMatch[1]}:${hyphenMatch[2]}`;
  }

  if (NORMALIZED_NODE_ID_RE.test(trimmed)) {
    return trimmed;
  }

  throw createFigmaError(
    'SPEC_FIGMA_INPUT_INVALID',
    'nodeId の形式が不正です。',
  );
}

function parseFigmaUrl(figmaUrl: string): FigmaFileNodeRef {
  let parsed: URL;
  try {
    parsed = new URL(figmaUrl.trim());
  } catch {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'Figma URL が不正です。Frame のリンクを確認してください。',
    );
  }

  if (parsed.protocol !== 'https:') {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'Figma URL は HTTPS である必要があります。',
    );
  }
  if (parsed.username || parsed.password) {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'Figma URL に認証情報を含められません。',
    );
  }
  if (!FIGMA_HOSTS.has(parsed.hostname)) {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'Figma URL のホストが不正です。',
    );
  }

  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
  // /:file_type/:file_key/:file_name...
  if (segments.length < 2) {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'Figma URL から fileKey を取得できません。',
    );
  }
  const fileKey = validateFileKey(decodeURIComponent(segments[1]!));

  const nodeIdRaw = parsed.searchParams.get('node-id');
  if (nodeIdRaw == null) {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'Figma URL に node-id がありません。',
    );
  }
  // searchParams は既に decode 済み。空文字を拒否。
  const nodeId = normalizeNodeId(nodeIdRaw);

  return { fileKey, nodeId };
}

/**
 * Figma URL または fileKey+nodeId を正規化する。
 * 両方指定時はエラー（暗黙の優先順位なし）。
 */
export function parseFigmaInput(input: FigmaParseInput): FigmaFileNodeRef {
  const hasUrl =
    typeof input.figmaUrl === 'string' && input.figmaUrl.trim().length > 0;
  const hasDirect =
    (typeof input.fileKey === 'string' && input.fileKey.trim().length > 0) ||
    (typeof input.nodeId === 'string' && input.nodeId.trim().length > 0);

  if (hasUrl && hasDirect) {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'Figma URL と fileKey/nodeId を同時に指定できません。',
    );
  }

  if (hasUrl) {
    return parseFigmaUrl(input.figmaUrl!);
  }

  if (
    typeof input.fileKey !== 'string' ||
    typeof input.nodeId !== 'string'
  ) {
    throw createFigmaError(
      'SPEC_FIGMA_INPUT_INVALID',
      'Figma URL または fileKey と nodeId が必要です。',
    );
  }

  return {
    fileKey: validateFileKey(input.fileKey),
    nodeId: normalizeNodeId(input.nodeId),
  };
}

/**
 * Upgrade-Link を Viewer 露出用に検証する（不合格なら undefined）。
 */
export function validateFigmaUpgradeLink(
  value: string | null | undefined,
): string | undefined {
  if (value == null || value.trim() === '') {
    return undefined;
  }
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:') {
    return undefined;
  }
  if (u.username || u.password) {
    return undefined;
  }
  if (!FIGMA_HOSTS.has(u.hostname)) {
    return undefined;
  }
  return u.toString();
}
