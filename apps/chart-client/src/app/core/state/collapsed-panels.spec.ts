import { canCollapse, effectiveCollapsed, parseCollapsedPanels } from './collapsed-panels';

describe('parseCollapsedPanels', () => {
  it('returns {} for null, malformed JSON or a non-object', () => {
    expect(parseCollapsedPanels(null)).toEqual({});
    expect(parseCollapsedPanels('{nope')).toEqual({});
    expect(parseCollapsedPanels('[]')).toEqual({});
    expect(parseCollapsedPanels('"x"')).toEqual({});
  });

  it('keeps string ids per layout and drops non-array entries and non-string ids', () => {
    expect(parseCollapsedPanels(JSON.stringify({ crypto: ['eth', 3, 'dxy'], bad: 'eth' }))).toEqual(
      {
        crypto: ['eth', 'dxy'],
      },
    );
  });
});

describe('effectiveCollapsed', () => {
  const ids = ['btc', 'eth', 'btc-oi', 'dxy'];

  it('is empty when nothing is stored', () => {
    expect(effectiveCollapsed(undefined, ids)).toEqual([]);
    expect(effectiveCollapsed([], ids)).toEqual([]);
  });

  it('drops ids not in the layout and de-duplicates, in panel order', () => {
    expect(effectiveCollapsed(['dxy', 'gone', 'eth', 'dxy'], ids)).toEqual(['eth', 'dxy']);
  });

  it('ignores a set that would collapse every panel', () => {
    expect(effectiveCollapsed(['btc', 'eth', 'btc-oi', 'dxy'], ids)).toEqual([]);
    expect(effectiveCollapsed(['only'], ['only'])).toEqual([]);
  });
});

describe('canCollapse', () => {
  const ids = ['a', 'b', 'c'];

  it('allows collapsing an expanded panel while another stays expanded', () => {
    expect(canCollapse([], ids, 'a')).toBe(true);
    expect(canCollapse(['a'], ids, 'b')).toBe(true);
  });

  it('refuses the last expanded panel', () => {
    expect(canCollapse(['a', 'b'], ids, 'c')).toBe(false);
    expect(canCollapse([], ['solo'], 'solo')).toBe(false);
  });

  it('refuses an already-collapsed or unknown panel', () => {
    expect(canCollapse(['a'], ids, 'a')).toBe(false);
    expect(canCollapse([], ids, 'zzz')).toBe(false);
  });
});
