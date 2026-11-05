import { contractSpecs } from '../../../src/venues/okx/contract-size';
import { OkxCollector, writeOkxDrain } from '../../../src/collectors/okx/okx-collector';
import { OkxLiquidation } from '../../../src/collectors/okx/payloads';

/**
 * IB-009, slimmed by WD-010 — the OKX liquidation buffer. The mark-price / funding-rate side went
 * with the funding tape (storage ruling S1); its specs went with it.
 */

const BTC = 'BTC-USDT-SWAP';
const ZEC = 'ZEC-USDT-SWAP';
const SPECS = contractSpecs([
  { instId: BTC, ctVal: '0.01', ctValCcy: 'BTC', ctMult: '1' },
  { instId: ZEC, ctVal: '1', ctValCcy: 'ZEC', ctMult: '1' },
]);

const MINUTE = Date.UTC(2026, 8, 28, 12, 5);

const liquidation = (instId: string, posSide: 'long' | 'short', sz: string, bkPx = '100'): OkxLiquidation => ({
  instType: 'SWAP', instId,
  details: [{ bkLoss: '0', bkPx, ccy: '', posSide, side: posSide === 'long' ? 'sell' : 'buy', sz, ts: String(MINUTE) }],
});

const build = () => new OkxCollector({ instIds: [BTC, ZEC], contractSpecs: SPECS });

describe('the universe filter', () => {
  it('drops instruments the universe does not carry — the liquidation channel sends every swap', () => {
    const collector = build();
    expect(collector.tracks(BTC)).toBe(true);
    expect(collector.tracks('LINK-USD-SWAP')).toBe(false); // an inverse swap, seen live unbidden
    collector.acceptLiquidation(liquidation('LINK-USD-SWAP', 'short', '12'));
    expect(collector.drain()).toEqual({ liquidations: [] });
  });
});

describe('IB-122 (L5): the filter widens without a deploy', () => {
  it('a coin added to the alert list is stored from the next message on; a removed one is dropped', () => {
    const collector = new OkxCollector({ instIds: [BTC], contractSpecs: SPECS });
    collector.acceptLiquidation(liquidation(ZEC, 'long', '5'));
    expect(collector.drain().liquidations).toHaveLength(0);
    expect(collector.setInstIds([BTC, ZEC])).toEqual({ added: [ZEC], removed: [] });
    collector.acceptLiquidation(liquidation(ZEC, 'long', '5'));
    expect(collector.drain().liquidations.map((r) => r.symbol)).toEqual([ZEC]);
    expect(collector.setInstIds([ZEC])).toEqual({ added: [], removed: [BTC] });
    collector.acceptLiquidation(liquidation(BTC, 'long', '5'));
    expect(collector.drain().liquidations).toHaveLength(0);
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

  it('keeps liquidations for every tracked instrument', () => {
    const collector = build();
    collector.acceptLiquidation(liquidation(BTC, 'long', '1'));
    collector.acceptLiquidation(liquidation(ZEC, 'short', '4'));
    expect(collector.drain().liquidations.map((r) => r.symbol)).toEqual([BTC, ZEC]);
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

describe('IB-BUG-015 writeOkxDrain — a refused write is returned, never thrown', () => {
  it('a failing liquidations write comes back with its table and row count, so the service logs it and keeps ticking', async () => {
    const collector = build();
    collector.acceptLiquidation(liquidation(BTC, 'long', '3'));
    collector.acceptLiquidation(liquidation(ZEC, 'short', '1'));
    const failures = await writeOkxDrain(collector.drain(), {
      liquidations: { write: async () => { throw new Error('no partition of relation liquidations found for row'); } },
    });
    expect(failures).toEqual([{ table: 'liquidations', rows: 2, message: 'no partition of relation liquidations found for row' }]);
  });

  it('a successful drain reports no failure; an empty one does not call the writer', async () => {
    const collector = build();
    collector.acceptLiquidation(liquidation(BTC, 'long', '3'));
    let calls = 0;
    const writers = { liquidations: { write: async (rows: readonly unknown[]) => (calls++, rows.length) } };
    expect(await writeOkxDrain(collector.drain(), writers)).toEqual([]);
    expect(await writeOkxDrain(collector.drain(), writers)).toEqual([]);
    expect(calls).toBe(1);
  });
});
