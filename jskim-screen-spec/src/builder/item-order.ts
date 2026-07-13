/**
 * snapshot HTML から data-jskim-spec-item の出現順 ID を抽出する。
 * 同一 ID が複数回あっても最初の出現のみ残す。
 */
export function extractItemIdsInDomOrder(html: string): string[] {
  const re = /data-jskim-spec-item="([^"]+)"/g;
  const ids: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export type StateForItemOrder = {
  id: string;
  viewer?: {
    visible?: boolean;
    order?: number;
  };
  html: string;
};

/**
 * viewer.visible な state を order 昇順で走査し、
 * 各 snapshot の DOM 出現順で item ID を first-seen 結合する。
 */
export function computeItemOrder(states: StateForItemOrder[]): string[] {
  const visible = states
    .filter((state) => state.viewer?.visible !== false)
    .slice()
    .sort((a, b) => (a.viewer?.order ?? 0) - (b.viewer?.order ?? 0));

  const order: string[] = [];
  const seen = new Set<string>();

  for (const state of visible) {
    for (const id of extractItemIdsInDomOrder(state.html)) {
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
  }

  return order;
}
