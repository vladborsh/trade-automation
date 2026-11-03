import * as fs from 'fs';
import * as path from 'path';
import { contractSpecs, contractsToBase, parseContractSpec } from '../../../src/venues/okx/contract-size';
import { liquidationRows } from '../../../src/collectors/okx/mappers';
import { OkxLiquidation, OkxMessage } from '../../../src/collectors/okx/payloads';
import { OkxInstrument } from '../../../src/venues/okx/payloads';

/** Captured live from ws.okx.com / www.okx.com on 2026-09-28. */
const fixture = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'okx', `${name}.json`), 'utf8')) as T;

const SPECS = contractSpecs([
  { instId: 'BTC-USDT-SWAP', ctVal: '0.01', ctValCcy: 'BTC', ctMult: '1' },
  { instId: 'DOGE-USDT-SWAP', ctVal: '1000', ctValCcy: 'DOGE', ctMult: '1' },
  { instId: 'ZEC-USDT-SWAP', ctVal: '1', ctValCcy: 'ZEC', ctMult: '1' },
]);

describe('contract size (OKX quotes sizes in contracts)', () => {
  it('multiplies ctVal by ctMult', () => {
    expect(parseContractSpec({ instId: 'X', ctVal: '0.01', ctValCcy: 'BTC', ctMult: '1' })?.baseUnitsPerContract).toBe(0.01);
    expect(parseContractSpec({ instId: 'X', ctVal: '5', ctValCcy: 'Y', ctMult: '2' })?.baseUnitsPerContract).toBe(10);
  });

  it('treats a missing ctMult as 1, and rejects an unusable size', () => {
    expect(parseContractSpec({ instId: 'X', ctVal: '2', ctValCcy: 'Y', ctMult: '' })?.baseUnitsPerContract).toBe(2);
    expect(parseContractSpec({ instId: 'X', ctVal: '0', ctValCcy: 'Y', ctMult: '1' })).toBeNull();
    expect(parseContractSpec({ instId: 'X', ctVal: '', ctValCcy: 'Y', ctMult: '1' })).toBeNull();
  });

  it('is the difference between 12 DOGE and 12 000 DOGE', () => {
    // The measured spread: the same `sz` means wildly different quantities per instrument.
    expect(contractsToBase('12', SPECS.get('BTC-USDT-SWAP')!)).toBeCloseTo(0.12, 12);
    expect(contractsToBase('12', SPECS.get('DOGE-USDT-SWAP')!)).toBe(12_000);
  });

  it('skips an instrument the venue did not describe usably', () => {
    const specs = contractSpecs([
      { instId: 'GOOD-USDT-SWAP', ctVal: '1', ctValCcy: 'G', ctMult: '1' },
      { instId: 'BAD-USDT-SWAP', ctVal: 'n/a', ctValCcy: 'B', ctMult: '1' },
    ] as OkxInstrument[]);
    expect([...specs.keys()]).toEqual(['GOOD-USDT-SWAP']);
  });
});

describe('liquidation-orders (real payloads)', () => {
  const messages = fixture<OkxMessage<OkxLiquidation>[]>('liquidation-orders');
  const zec = messages.map((m) => m.data.find((d) => d.instId === 'ZEC-USDT-SWAP')).find((d) => d !== undefined)!;

  it('stores posSide as the liquidated side, and converts contracts to base units', () => {
    const [row] = liquidationRows(zec, SPECS);
    const detail = zec.details[0];
    expect(row.side).toBe(detail.posSide);
    expect(row.qty).toBe(Number(detail.sz) * 1); // ZEC ctVal = 1
    expect(row.price).toBe(Number(detail.bkPx));
    expect(row.notional).toBeCloseTo(row.price * row.qty, 8);
    expect(row).toMatchObject({ venue: 'okx', symbol: 'ZEC-USDT-SWAP', source: 'ws' });
  });

  it('every captured message obeys posSide = inverse of side', () => {
    // The measured invariant: 45 s of the live channel produced only long/sell and short/buy.
    for (const message of messages) {
      for (const data of message.data) {
        for (const detail of data.details) {
          expect(detail.side).toBe(detail.posSide === 'long' ? 'sell' : 'buy');
        }
      }
    }
  });

  it('throws if the venue ever inverts that convention, rather than flipping every row silently', () => {
    const corrupted: OkxLiquidation = { ...zec, details: [{ ...zec.details[0], posSide: 'long', side: 'buy' }] };
    expect(() => liquidationRows(corrupted, SPECS)).toThrow(/side convention changed/);
  });

  it('skips an instrument with no known contract size instead of guessing one', () => {
    const skipped: string[] = [];
    const rows = liquidationRows({ ...zec, instId: 'UNKNOWN-USDT-SWAP' }, SPECS, (id) => skipped.push(id));
    expect(rows).toEqual([]);
    expect(skipped).toEqual(['UNKNOWN-USDT-SWAP']);
  });

  it('expands every detail in one message into its own row', () => {
    const two: OkxLiquidation = { ...zec, details: [zec.details[0], { ...zec.details[0], sz: '5' }] };
    expect(liquidationRows(two, SPECS)).toHaveLength(2);
  });
});

/**
 * IB-BUG-018 — OKX's `liquidation-orders` channel (instType SWAP) carries INVERSE swaps too.
 * Captured 2026-11-03 13:36 UTC (one probe): `BTC-USD-SWAP` is `ctType: inverse`, `ctVal: 100`,
 * `ctValCcy: USD` — its size is in USD contracts, so `ctVal × sz` is not base units.
 */
describe('IB-BUG-018 inverse swaps are never sized (real payloads)', () => {
  const instrument = fixture<{ data: OkxInstrument[] }>('instrument-inverse-swap').data[0];
  const inverse = fixture<{ data: OkxLiquidation[] }>('liquidation-orders-inverse').data[0];

  it('the captured instrument really is inverse and valued in USD', () => {
    expect(instrument).toMatchObject({ instId: 'BTC-USD-SWAP', ctType: 'inverse', ctValCcy: 'USD', ctVal: '100' });
    expect(inverse.instId).toBe('BTC-USD-SWAP');
    expect(inverse.details.length).toBeGreaterThan(0);
  });

  it('no contract spec is made for it, so its liquidations take the "no contract size" skip path', () => {
    expect(parseContractSpec(instrument)).toBeNull();
    const specs = contractSpecs([instrument]);
    const skipped: string[] = [];
    expect(liquidationRows(inverse, specs, (instId, reason) => skipped.push(`${instId}: ${reason}`))).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it('a linear USDT swap is still sized as before', () => {
    expect(parseContractSpec({ instId: 'BTC-USDT-SWAP', ctVal: '0.01', ctValCcy: 'BTC', ctMult: '1', ctType: 'linear' })?.baseUnitsPerContract).toBe(0.01);
  });
});
