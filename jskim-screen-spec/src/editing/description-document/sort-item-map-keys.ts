/**
 * Description object key の canonical 順序（ASCII / en locale）。
 * 既存 v1.2 保存と revision 安定のため localeCompare('en') を使用する。
 */
export function sortDescriptionItemMapKeys(
  map: Record<string, unknown>,
): string[] {
  return Object.keys(map).sort((a, b) => a.localeCompare(b, 'en'));
}
