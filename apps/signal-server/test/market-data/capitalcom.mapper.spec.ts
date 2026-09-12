import { mapPriceRow, CapComPriceRow } from '../../src/market-data/capitalcom/capitalcom.mapper';

// Fixture shape taken from Capital.com's real `GET /api/v1/prices/{epic}` response
// (mirrors cmc-bot-main's CapComMarketData / capital-com.helpers.ts).
describe('Capital.com payload mapping (architecture/live-signal-server.md §3.3, §4.1)', () => {
  const row: CapComPriceRow = {
    snapshotTime: '2023/11/03 12:00:00',
    snapshotTimeUTC: '2023-11-03T12:00:00',
    openPrice: { bid: 15000.0, ask: 15001.0 },
    highPrice: { bid: 15010.0, ask: 15011.0 },
    lowPrice: { bid: 14995.0, ask: 14996.0 },
    closePrice: { bid: 15005.0, ask: 15006.0 },
    lastTradedVolume: 0,
  };

  it('keeps bid/ask OHLC instead of collapsing to mid-only (unlike cmc-bot-main)', () => {
    const candle = mapPriceRow('capitalcom:US100', row, true);

    expect(candle.bid).toEqual({ open: 15000.0, high: 15010.0, low: 14995.0, close: 15005.0 });
    expect(candle.ask).toEqual({ open: 15001.0, high: 15011.0, low: 14996.0, close: 15006.0 });
  });

  it('sets open/high/low/close to the bid/ask mid', () => {
    const candle = mapPriceRow('capitalcom:US100', row, true);

    expect(candle.open).toBeCloseTo(15000.5);
    expect(candle.high).toBeCloseTo(15010.5);
    expect(candle.low).toBeCloseTo(14995.5);
    expect(candle.close).toBeCloseTo(15005.5);
  });

  it('stamps openTime from the venue snapshotTimeUTC field', () => {
    const candle = mapPriceRow('capitalcom:US100', row, true);
    expect(candle.openTime).toBe(Date.parse('2023-11-03T12:00:00Z'));
  });

  it('marks closed vs forming per the caller flag, with the matching source', () => {
    expect(mapPriceRow('capitalcom:US100', row, true).source).toBe('venue-rest');
    expect(mapPriceRow('capitalcom:US100', row, false).source).toBe('venue-stream');
  });
});
