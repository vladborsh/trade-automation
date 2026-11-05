/**
 * IB-120 (market-round2 design §4) — whether a help block starts open.
 *
 * `openOnFirstVisit`: open the first time this browser shows the block, collapsed on every later
 * visit. The visit is remembered in `localStorage`; every touch of it is inside `try`, because the
 * accessor itself throws in a private window or with site data blocked. **Without storage the block
 * renders open**: help that cannot remember it was read is shown, never hidden.
 *
 * Without `openOnFirstVisit` the block always starts collapsed (IB-121's one line on Market).
 */
export const HELP_SEEN_PREFIX = 'help-seen:';

export type HelpStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Reads (and on a first visit records) the visit; `storage` is a getter so its own throw is caught too. */
export function helpStartsOpen(storage: () => HelpStorage | null | undefined, key: string, openOnFirstVisit: boolean): boolean {
  if (!openOnFirstVisit) return false;
  try {
    const s = storage();
    if (!s) return true;
    if (s.getItem(HELP_SEEN_PREFIX + key) !== null) return false;
    s.setItem(HELP_SEEN_PREFIX + key, '1');
    return true;
  } catch {
    return true;
  }
}
