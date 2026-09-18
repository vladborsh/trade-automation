/**
 * architecture/chart-layouts.md §12.4 — pure rules behind `RsiPrefsStore`.
 * Stored shape: `localStorage['chart-client:rsi'] = { period: number, hidden: { [layoutId]: panelId[] } }`.
 * Period is one global setting; visibility is per panel (default: shown).
 */
export interface RsiPrefs {
  period: number;
  hidden: Record<string, string[]>;
}

export const RSI_DEFAULT_PERIOD = 14;
export const RSI_MIN_PERIOD = 2;
export const RSI_MAX_PERIOD = 100;

export function defaultRsiPrefs(): RsiPrefs {
  return { period: RSI_DEFAULT_PERIOD, hidden: {} };
}

/** Rounds to an integer and clamps to 2–100; anything non-numeric falls back to the default 14. */
export function clampRsiPeriod(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return RSI_DEFAULT_PERIOD;
  }
  return Math.min(RSI_MAX_PERIOD, Math.max(RSI_MIN_PERIOD, Math.round(n)));
}

/** A period typed by the user: clamped 2–100, or `current` unchanged if it is not a number at all. */
export function commitRsiPeriod(current: number, input: unknown): number {
  const blank = input === null || input === undefined || (typeof input === 'string' && input.trim() === '');
  const n = typeof input === 'string' ? Number(input) : input;
  return blank || typeof n !== 'number' || !Number.isFinite(n) ? current : clampRsiPeriod(n);
}

/** Parses the stored JSON; anything malformed is replaced by its default, never thrown. */
export function parseRsiPrefs(raw: string | null): RsiPrefs {
  if (!raw) {
    return defaultRsiPrefs();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultRsiPrefs();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaultRsiPrefs();
  }
  const obj = parsed as { period?: unknown; hidden?: unknown };
  const hidden: Record<string, string[]> = {};
  if (obj.hidden && typeof obj.hidden === 'object' && !Array.isArray(obj.hidden)) {
    for (const [layoutId, ids] of Object.entries(obj.hidden)) {
      if (Array.isArray(ids)) {
        hidden[layoutId] = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
      }
    }
  }
  return { period: obj.period === undefined ? RSI_DEFAULT_PERIOD : clampRsiPeriod(obj.period), hidden };
}

/** Whether the RSI pane of `panelId` in `layoutId` is shown. */
export function isRsiVisible(prefs: RsiPrefs, layoutId: string, panelId: string): boolean {
  return !(prefs.hidden[layoutId] ?? []).includes(panelId);
}

/** `prefs` with the panel's RSI shown or hidden (new object; `prefs` untouched). */
export function withRsiVisible(prefs: RsiPrefs, layoutId: string, panelId: string, visible: boolean): RsiPrefs {
  const others = (prefs.hidden[layoutId] ?? []).filter((id) => id !== panelId);
  return { ...prefs, hidden: { ...prefs.hidden, [layoutId]: visible ? others : [...others, panelId] } };
}
