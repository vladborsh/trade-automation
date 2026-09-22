/** T-043: whether the workspace journal is open, remembered per browser. Collapsed by default. */
export const JOURNAL_EXPANDED_KEY = 'chart-client:journal-expanded';

/** The stored choice; collapsed when nothing is stored or storage is unavailable. */
export function readJournalExpanded(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(JOURNAL_EXPANDED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Remembers the choice; a storage that refuses (private window, blocked site data) is ignored. */
export function writeJournalExpanded(expanded: boolean, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(JOURNAL_EXPANDED_KEY, String(expanded));
  } catch {
    // the toggle still works for this page
  }
}

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
