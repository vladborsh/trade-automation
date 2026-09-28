import { contractSpecs } from '../../../src/collectors/okx/contract-size';
import { OkxCollector } from '../../../src/collectors/okx/okx-collector';
import { OkxFundingRate, OkxLiquidation, OkxMarkPrice } from '../../../src/collectors/okx/payloads';

const BTC = 'BTC-USDT-SWAP';
const ZEC = 'ZEC-USDT-SWAP';
const SPECS = contractSpecs([
  { instId: BTC, ctVal: '0.01', ctValCcy: 'BTC', ctMult: '1' },
  { instId: ZEC, ctVal: '1', ctValCcy: 'ZEC', ctMult: '1' },
]);

const MINUTE = Date.UTC(2026, 8, 28, 12, 5);
const SETTLE = Date.UTC(2026, 8, 28, 16, 0);
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

const mark = (instId: string, markPx: string, ts = MINUTE): OkxMarkPrice => ({
  instId, instType: 'SWAP', markPx, ts: String(ts),
});

const funding = (instId: string, over: Partial<OkxFundingRate> = {}): OkxFundingRate => ({
  instId, instType: 'SWAP',
  fundingRate: '0.0001', fundingTime: String(SETTLE),
  nextFundingRate: '', nextFundingTime: String(SETTLE + EIGHT_HOURS),
  prevFundingTime: String(SETTLE - EIGHT_HOURS), settFundingRate: '0.00005', settState: 'settled',
  ts: String(MINUTE), ...over,
});

const liquidation = (instId: string, posSide: 'long' | 'short', sz: string, bkPx = '100'): OkxLiquidation => ({
  instType: 'SWAP', instId,
  details: [{ bkLoss: '0', bkPx, ccy: '', posSide, side: posSide === 'long' ? 'sell' : 'buy', sz, ts: String(MINUTE) }],
});

const build = (signalSet: string[] = [BTC]) =>
  new OkxCollector({ instIds: [BTC, ZEC], signalSetInstIds: signalSet, contractSpecs: SPECS });

describe('the universe filter', () => {
  it('drops instruments the universe does not carry — the liquidation channel sends every swap', () => {
    const collector = build();
    expect(collector.tracks(BTC)).toBe(true);
    expect(collector.tracks('LINK-USD-SWAP')).toBe(false); // an inverse swap, seen live unbidden

    collector.acceptLiquidation(liquidation('LINK-USD-SWAP', 'short', '12'));
    collector.acceptMarkPrice(mark('LINK-USD-SWAP', '15'));
    collector.acceptFundingRate(funding('LINK-USD-SWAP'));
    expect(collector.drain()).toEqual({ markFunding: [], liquidations: [], settlements: [] });
  });
});

describe('liquidations', () => {
  it('writes one row per detail, in base units, for a tracked instrument', () => {
    const collector = build();
    collector.acceptLiquidation(liquidation(BTC, 'long', '12', '80000'));
    const { liquidations } = collector.drain();
    expect(liquidations).toHaveLength(1);
    expect(liquidations[0]).toMatchObject({ venue: 'okx', symbol: BTC, side: 'long', qty: 0.12 });
    expect(liquidations[0].notional).toBeCloseTo(0.12 * 80000, 6);
  });

  it('keeps liquidations for every tracked instrument, not just the signal set', () => {
    const collector = build([BTC]); // ZEC is tracked but not in the signal set
    collector.acceptLiquidation(liquidation(ZEC, 'short', '4'));
    expect(collector.drain().liquidations).toHaveLength(1);
  });
});

describe('funding settlements', () => {
  it('writes a settlement row for every tracked instrument, signal set or not', () => {
    const collector = build([BTC]);
    collector.acceptFundingRate(funding(BTC));
    collector.acceptFundingRate(funding(ZEC));
    const { settlements } = collector.drain();
    expect(settlements.map((s) => s.symbol).sort()).toEqual([BTC, ZEC]);
    // Stamped at the interval that settled — prevFundingTime, not the upcoming fundingTime.
    expect(settlements[0].fundingTime).toEqual(new Date(SETTLE - EIGHT_HOURS));
    expect(settlements[0].rate).toBe(0.00005);
  });

  it('writes nothing when the venue is not reporting a settlement', () => {
    const collector = build();
    collector.acceptFundingRate(funding(BTC, { settState: 'ongoing' }));
    expect(collector.drain().settlements).toEqual([]);
  });

  it('keeps the last prediction before a rollover, stamped at the settlement second', () => {
    const collector = build();
    collector.acceptFundingRate(funding(BTC, { fundingRate: '0.0009', settState: 'ongoing' }));
    collector.drain();
    // The interval rolls: fundingTime advances by 8 h.
    collector.acceptFundingRate(funding(BTC, { fundingTime: String(SETTLE + EIGHT_HOURS), settState: 'ongoing' }));

    const { markFunding } = collector.drain();
    const rollover = markFunding.find((row) => row.ts.getTime() === SETTLE);
    expect(rollover).toBeDefined();
    expect(rollover!.predictedFundingRate).toBe(0.0009); // the last number before the settlement
  });
});

describe('per-minute mark sampling (signal set only)', () => {
  it('emits one row per signal-set instrument that produced something this minute', () => {
    const collector = build([BTC]);
    collector.acceptMarkPrice(mark(BTC, '80000'));
    collector.acceptMarkPrice(mark(BTC, '80500')); // the last sample in the minute wins
    collector.acceptMarkPrice(mark(ZEC, '150')); // tracked, not sampled

    collector.sampleMinute(new Date(MINUTE));
    const { markFunding } = collector.drain();
    expect(markFunding).toHaveLength(1);
    expect(markFunding[0]).toMatchObject({ venue: 'okx', symbol: BTC, markPrice: 80500, ts: new Date(MINUTE) });
  });

  it('leaves index_price null — the channel carries no index', () => {
    const collector = build();
    collector.acceptMarkPrice(mark(BTC, '80000'));
    collector.sampleMinute(new Date(MINUTE));
    expect(collector.drain().markFunding[0].indexPrice).toBeNull();
  });

  it('merges the funding prediction into the mark row', () => {
    const collector = build();
    collector.acceptMarkPrice(mark(BTC, '80000'));
    collector.acceptFundingRate(funding(BTC, { fundingRate: '0.00042', settState: 'ongoing' }));
    collector.sampleMinute(new Date(MINUTE));

    const [row] = collector.drain().markFunding;
    expect(row.predictedFundingRate).toBe(0.00042);
    // next_funding_time is fundingTime (the upcoming settlement), not nextFundingTime.
    expect(row.nextFundingTime).toEqual(new Date(SETTLE));
  });

  it('emits nothing for a minute in which an instrument said nothing', () => {
    const collector = build();
    collector.sampleMinute(new Date(MINUTE));
    expect(collector.drain().markFunding).toEqual([]);
  });

  it('does not carry a stale mark into the next minute', () => {
    // The mark ticks every second, so "no sample this minute" is real information about the feed,
    // not an invitation to repeat the last price as though it were fresh.
    const collector = build();
    collector.acceptMarkPrice(mark(BTC, '80000'));
    collector.sampleMinute(new Date(MINUTE));
    collector.drain();

    collector.sampleMinute(new Date(MINUTE + 60_000));
    expect(collector.drain().markFunding).toEqual([]);
  });

  it('keeps the funding prediction across minutes, since it ticks rarely', () => {
    const collector = build();
    collector.acceptFundingRate(funding(BTC, { fundingRate: '0.00042', settState: 'ongoing' }));
    collector.drain();

    collector.acceptMarkPrice(mark(BTC, '80000', MINUTE + 60_000));
    collector.sampleMinute(new Date(MINUTE + 60_000));
    expect(collector.drain().markFunding[0].predictedFundingRate).toBe(0.00042);
  });
});

describe('drain', () => {
  it('empties the buffer, so the same row is never written twice', () => {
    const collector = build();
    collector.acceptLiquidation(liquidation(BTC, 'long', '1'));
    expect(collector.drain().liquidations).toHaveLength(1);
    expect(collector.drain().liquidations).toEqual([]);
  });
});
