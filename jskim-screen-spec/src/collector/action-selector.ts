/**
 * action target ID を Playwright / CSS attribute selector に変換する。
 * CSS selector を Source JSON に直接書かせないための内部変換。
 */
export function toActionSelector(target: string): string {
  const escaped = escapeAttributeValue(target);
  return `[data-jskim-spec-action="${escaped}"]`;
}

/**
 * CSS attribute 値として安全になるようエスケープする。
 */
export function escapeAttributeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '');
}
