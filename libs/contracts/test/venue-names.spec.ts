import { WEB_INSIGHT_SOURCES, WEB_VENUE_NAMES, WebVenueFilterSchema, venueName } from '../src/insight';

/** IB-BUG-032 — every key a member can meet has a display name, and the name is not the key. */
describe('venue display names', () => {
  // the keys the server sends: a block's sources, and the liquidation venues (the tape's `venue`)
  const sent = [
    ...WEB_INSIGHT_SOURCES.filter((s) => s !== 'tape'),
    ...WebVenueFilterSchema.options.filter((v) => v !== 'all'),
  ];

  it.each(sent)('%s has a display name', (key) => {
    expect(Object.keys(WEB_VENUE_NAMES)).toContain(key);
  });

  it.each(Object.entries(WEB_VENUE_NAMES))('%s is spelled «%s», not as its key', (key, name) => {
    expect(venueName(key)).toBe(name);
    expect(name).not.toBe(key);
  });

  it('an unknown key comes back as it came (an identifier, never a blank), and inherited names are not keys', () => {
    expect(venueName('hyperliquid')).toBe('hyperliquid');
    expect(venueName('toString')).toBe('toString');
  });
});
