import type { InstrumentId } from '@trade-automation/contracts';
import type { InstrumentGroup } from './instrument-groups';

/**
 * T-039 — the pure half of the instrument multiselect: search, the flat option order the keyboard
 * walks, and toggling under the panel limit. The one-currency rule stays with the form's validation.
 */

/** Groups whose instruments match `query` (display name or id, which carries the symbol; case-insensitive); empty groups dropped. */
export function filterGroups(groups: readonly InstrumentGroup[], query: string): InstrumentGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...groups];
  return groups
    .map((g) => ({
      currency: g.currency,
      instruments: g.instruments.filter((i) => [i.displayName, i.id].some((s) => s.toLowerCase().includes(q))),
    }))
    .filter((g) => g.instruments.length > 0);
}

/** The options in display order, across groups. */
export function optionIds(groups: readonly InstrumentGroup[]): InstrumentId[] {
  return groups.flatMap((g) => g.instruments.map((i) => i.id));
}

/**
 * The option ArrowDown (+1) / ArrowUp (−1) moves to: from nothing, the first (or last); it stops at
 * the ends rather than wrapping; an active id the filter removed restarts from the first (or last).
 */
export function nextActive(ids: readonly InstrumentId[], active: InstrumentId | null, delta: 1 | -1): InstrumentId | null {
  if (ids.length === 0) return null;
  const at = active === null ? -1 : ids.indexOf(active);
  if (at === -1) return delta === 1 ? ids[0] : ids[ids.length - 1];
  return ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
}

/** The selection after toggling `id`: removed if selected, added if there is room, else unchanged. */
export function toggled(selected: readonly InstrumentId[], id: InstrumentId, max: number): InstrumentId[] {
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  return selected.length >= max ? [...selected] : [...selected, id];
}
