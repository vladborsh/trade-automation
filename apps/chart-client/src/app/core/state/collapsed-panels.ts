/**
 * architecture/chart-layouts.md §11.3 — pure rules behind `CollapsedPanelsStore`.
 * Stored shape: `localStorage['chart-client:collapsed-panels'] = { [layoutId]: panelId[] }`.
 */
export type CollapsedPanelsState = Record<string, string[]>;

/** Parses the stored JSON; anything malformed (or a non-array entry) is dropped, never thrown. */
export function parseCollapsedPanels(raw: string | null): CollapsedPanelsState {
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out: CollapsedPanelsState = {};
    for (const [layoutId, ids] of Object.entries(parsed)) {
      if (Array.isArray(ids)) {
        out[layoutId] = ids.filter((id): id is string => typeof id === 'string');
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The collapsed set actually applied to a layout: ids not in the layout are dropped (and
 * de-duplicated, in panel order); a set that would collapse EVERY panel (layout edited in yaml
 * since it was stored) is ignored and everything expands — never an empty screen.
 */
export function effectiveCollapsed(
  stored: readonly string[] | undefined,
  panelIds: readonly string[],
): string[] {
  if (!stored || stored.length === 0) {
    return [];
  }
  const kept = panelIds.filter((id) => stored.includes(id));
  return kept.length >= panelIds.length ? [] : kept;
}

/** A panel may collapse only while it is expanded and at least one OTHER panel stays expanded. */
export function canCollapse(
  collapsed: readonly string[],
  panelIds: readonly string[],
  panelId: string,
): boolean {
  if (!panelIds.includes(panelId) || collapsed.includes(panelId)) {
    return false;
  }
  const expanded = panelIds.filter((id) => !collapsed.includes(id));
  return expanded.length > 1;
}
