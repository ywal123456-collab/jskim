import { createFigmaError, maskSecret } from './errors.js';

export const JSKIM_FIGMA_TOKEN_ENV = 'JSKIM_FIGMA_TOKEN';

/**
 * JSKIM_FIGMA_TOKEN を解決する。
 * 明示 token があればそれを優先（テスト注入用）。env 既定は process.env。
 */
export function resolveFigmaToken(options?: {
  token?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  if (options?.token !== undefined) {
    const trimmed = options.token.trim();
    if (!trimmed) {
      throw createFigmaError(
        'SPEC_FIGMA_TOKEN_MISSING',
        'Figma トークンが設定されていません。環境変数 JSKIM_FIGMA_TOKEN を設定してください。',
      );
    }
    return trimmed;
  }

  const env = options?.env ?? process.env;
  const raw = env[JSKIM_FIGMA_TOKEN_ENV];
  if (raw == null || raw.trim() === '') {
    throw createFigmaError(
      'SPEC_FIGMA_TOKEN_MISSING',
      'Figma トークンが設定されていません。環境変数 JSKIM_FIGMA_TOKEN を設定してください。',
    );
  }
  return raw.trim();
}

/** テスト・ログ用。token 本体は返さない */
export function describeFigmaTokenPresence(token: string): {
  present: boolean;
  masked: string;
} {
  return {
    present: token.length > 0,
    masked: maskSecret(token),
  };
}
