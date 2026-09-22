import { JOURNAL_EXPANDED_KEY, readJournalExpanded, writeJournalExpanded } from './journal-expanded';

function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

describe('journal expanded state (T-043)', () => {
  it('is collapsed by default, and remembers a choice', () => {
    const s = memory();
    expect(readJournalExpanded(s)).toBe(false);
    writeJournalExpanded(true, s);
    expect(s.map.get(JOURNAL_EXPANDED_KEY)).toBe('true');
    expect(readJournalExpanded(s)).toBe(true);
    writeJournalExpanded(false, s);
    expect(readJournalExpanded(s)).toBe(false);
  });

  it('a storage that throws, or none, is collapsed and never breaks the toggle', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readJournalExpanded(throwing)).toBe(false);
    expect(() => writeJournalExpanded(true, throwing)).not.toThrow();
    expect(readJournalExpanded(null)).toBe(false);
  });
});
