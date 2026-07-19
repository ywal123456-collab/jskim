/**
 * @vue/test-utils が SFC の public props を推論できず HTML attrs 型に落ちる場合の setProps 用ヘルパー。
 * runtime の setProps は Record<string, unknown> を受け取る（wrapperFactory 契約）。
 */
export function setWrapperProps(
  wrapper: { setProps: (props: Record<string, unknown>) => Promise<void> },
  props: Record<string, unknown>,
): Promise<void> {
  return wrapper.setProps(props);
}

/**
 * VueWrapper.setProps の型を runtime 契約へ揃える。
 */
export function withRecordSetProps<T extends { setProps: unknown }>(
  wrapper: T,
): { setProps: (props: Record<string, unknown>) => Promise<void> } {
  return wrapper as { setProps: (props: Record<string, unknown>) => Promise<void> };
}
