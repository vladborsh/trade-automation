import { ReplayAheadService } from '../../src/backtest/replay-ahead.service';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';
import { DAY, INSTRUMENT, MIN, oneMinute, oneMinuteRange, tempStore } from './replay-fixtures';

const T0 = Date.UTC(2021, 5, 1);

describe('ReplayAheadService (backtest-app-system-design.md §5.3, §7.2)', () => {
  let store: FileCandleStore;
  let cleanup: () => void;
  let service: ReplayAheadService;

  beforeEach(async () => {
    ({ store, cleanup } = tempStore());
    service = new ReplayAheadService(store);
    // three days of 1m with a one-day hole: days 0, 1, 3
    await store.upsert([...oneMinuteRange(T0, T0 + 2 * DAY), ...oneMinuteRange(T0 + 3 * DAY, T0 + 4 * DAY)]);
  });
  afterEach(() => cleanup());

  it('returns 1m from fromMs as compact [openTime, o, h, l, c, v] tuples', async () => {
    const page = await service.ahead(INSTRUMENT, T0 + 10 * MIN, 3, T0 + 4 * DAY);
    const c = oneMinute(T0 + 10 * MIN);
    expect(page.candles[0]).toEqual([c.openTime, c.open, c.high, c.low, c.close, c.volume]);
    expect(page.candles.map((t) => (t[0] - T0) / MIN)).toEqual([10, 11, 12]);
    expect(page.endOfTape).toBe(false);
  });

  it('crosses day files and the hole, up to limit', async () => {
    const page = await service.ahead(INSTRUMENT, T0 + 2 * DAY - 2 * MIN, 4, T0 + 4 * DAY);
    expect(page.candles.map((t) => t[0])).toEqual([T0 + 2 * DAY - 2 * MIN, T0 + 2 * DAY - MIN, T0 + 3 * DAY, T0 + 3 * DAY + MIN]);
  });

  it('clamps to the period: only candles that close by periodToMs', async () => {
    const periodTo = T0 + 30 * MIN;
    const page = await service.ahead(INSTRUMENT, T0 + 25 * MIN, 100, periodTo);
    expect(page.candles.map((t) => (t[0] - T0) / MIN)).toEqual([25, 26, 27, 28, 29]);
    expect(page.endOfTape).toBe(true);
    // a period ending mid-minute excludes the straddling candle
    expect((await service.ahead(INSTRUMENT, T0 + 25 * MIN, 100, periodTo + 30_000)).candles).toHaveLength(5);
  });

  it('endOfTape is exact: false when more exists in the period, true when the page reaches its end', async () => {
    const periodTo = T0 + 30 * MIN;
    expect(await service.ahead(INSTRUMENT, T0 + 25 * MIN, 4, periodTo)).toMatchObject({ endOfTape: false });
    const exact = await service.ahead(INSTRUMENT, T0 + 25 * MIN, 5, periodTo);
    expect(exact.candles).toHaveLength(5);
    expect(exact.endOfTape).toBe(true);
  });

  it('endOfTape when the store has nothing further, even with period left', async () => {
    const page = await service.ahead(INSTRUMENT, T0 + 4 * DAY - 2 * MIN, 100, T0 + 30 * DAY);
    expect(page.candles).toHaveLength(2);
    expect(page.endOfTape).toBe(true);
    expect(await service.ahead(INSTRUMENT, T0 + 10 * DAY, 100, T0 + 30 * DAY)).toEqual({ candles: [], endOfTape: true });
  });

  it('a fromMs before the tape starts begins at the first stored candle; an unknown instrument is an empty end', async () => {
    const page = await service.ahead(INSTRUMENT, T0 - 365 * DAY, 2, T0 + DAY);
    expect(page.candles.map((t) => t[0])).toEqual([T0, T0 + MIN]);
    expect(await service.ahead('binance:ETHUSDT', T0, 10, T0 + DAY)).toEqual({ candles: [], endOfTape: true });
  });
});
