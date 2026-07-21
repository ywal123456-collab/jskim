const GROUP_KIND_LABELS: Record<string, string> = {
  SECTION: 'セクション',
  FIELDSET: '項目グループ',
  CARD: 'カード',
  REPEATABLE: '繰り返し',
  ACTIONS: '操作',
  CONTENT: 'コンテンツ',
  CUSTOM: 'カスタム',
};

/** Group kind の Viewer 表示用ラベル（保存値は変更しない） */
export function formatGroupKindLabel(kind: string): string {
  const trimmed = kind.trim();
  if (!trimmed) {
    return '不明';
  }
  return GROUP_KIND_LABELS[trimmed] ?? trimmed;
}
