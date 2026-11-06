import {
  MARKET_ALERT_MUTED_BY, MarketAlertMutedBySchema, WebFundingAlertRowSchema, WebLevelAlertRowSchema, WebLiqAlertRowSchema, mutedDedupeKey,
} from '../src';

/** IB-151 — the switch that muted a journal row, as the admin rows carry it, and a muted row's once-key. */
describe('IB-151 market alert mutedBy', () => {
  it('four switches, in the order a loop names the first that applies', () => {
    expect(MARKET_ALERT_MUTED_BY).toEqual(['coin', 'daily', 'event', 'custom_event']);
    expect(MarketAlertMutedBySchema.safeParse('type').success).toBe(false);
  });

  it('every journal row type carries it, required and nullable', () => {
    for (const s of [WebLevelAlertRowSchema, WebFundingAlertRowSchema, WebLiqAlertRowSchema]) {
      expect(s.shape.mutedBy.safeParse(null).success).toBe(true);
      expect(s.shape.mutedBy.safeParse('coin').success).toBe(true);
      expect(s.shape.mutedBy.safeParse(undefined).success).toBe(false);
    }
  });

  it('a muted row keeps a once-key apart from the sending one', () => {
    expect(mutedDedupeKey('level:BTCUSDT:WO:1:breakout_up')).toBe('level:BTCUSDT:WO:1:breakout_up:muted');
  });
});
