import type { VersionHistoryApiError } from './types.js';

/** Viewer 向けの短い日本語メッセージへ整形する。 */
export function formatVersionHistoryError(
  error: VersionHistoryApiError | null | undefined,
): string {
  if (!error) {
    return '版管理の読み込みに失敗しました。';
  }
  switch (error.code) {
    case 'SPEC_VERSION_NOT_INITIALIZED':
      return 'ローカル版管理は初期化されていません。';
    case 'SPEC_VERSION_HEAD_CHANGED':
      return '履歴の起点が変更されました。一覧を再読み込みしてください。';
    case 'SPEC_VERSION_RECOVERY_REQUIRED':
      return '版管理repositoryの復旧が必要です。CLIで recover --inspect を実行してください。';
    case 'SPEC_VERSION_REVISION_NOT_FOUND':
      return '指定した改訂が見つかりません。';
    case 'ABORTED':
      return '';
    default:
      return error.message || '版管理の読み込みに失敗しました。';
  }
}
