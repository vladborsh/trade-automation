import * as fs from 'fs';
import * as path from 'path';
import { contractSpecs, contractsToBase, parseContractSpec } from '../../../src/collectors/okx/contract-size';
import {
  fundingTimeOf,
  liquidationRows,
  markRow,
  predictedFundingRow,
  settlementRowFromWs,
  settlementRowsFromHistory,
} from '../../../src/collectors/okx/mappers';
import {
  OkxFundingRate,
  OkxInstrument,
  OkxLiquidation,
  OkxMarkPrice,
  OkxMessage,
} from '../../../src/collectors/okx/payloads';

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

describe('mark-price (real payload)', () => {
  const message = fixture<OkxMessage<OkxMarkPrice>[]>('mark-price')[0];

  it('maps the mark and leaves the index null — the channel carries no index price', () => {
    const row = markRow(message.data[0]);
    expect(row).toMatchObject({ venue: 'okx', symbol: 'BTC-USDT-SWAP', source: 'ws', indexPrice: null });
    expect(row.markPrice).toBe(Number(message.data[0].markPx));
    expect(row.ts).toEqual(new Date(Number(message.data[0].ts)));
  });

  it('never fabricates the index from the mark', () => {
    expect(markRow(message.data[0]).indexPrice).not.toBe(markRow(message.data[0]).markPrice);
  });
});

describe('funding-rate (real payload)', () => {
  const message = fixture<OkxMessage<OkxFundingRate>>('funding-rate');
  const event = message.data[0];

  it('takes next_funding_time from fundingTime, NOT nextFundingTime', () => {
    // The naming trap: fundingTime is the upcoming settlement; nextFundingTime is the one after.
    expect(fundingTimeOf(event)).toEqual(new Date(Number(event.fundingTime)));
    expect(Number(event.nextFundingTime)).toBeGreaterThan(Number(event.fundingTime));
    expect(predictedFundingRow(event).nextFundingTime).toEqual(new Date(Number(event.fundingTime)));
  });

  it('the observed intervals are 8 h apart in both directions', () => {
    const EIGHT_HOURS = 8 * 60 * 60 * 1000;
    expect(Number(event.fundingTime) - Number(event.prevFundingTime)).toBe(EIGHT_HOURS);
    expect(Number(event.nextFundingTime) - Number(event.fundingTime)).toBe(EIGHT_HOURS);
  });

  it('carries the prediction and no mark — the two channels are merged by the collector', () => {
    const row = predictedFundingRow(event);
    expect(row.predictedFundingRate).toBe(Number(event.fundingRate));
    expect(row.markPrice).toBeNull();
  });

  it('emits a settlement row only when the venue says an interval settled', () => {
    const settled = settlementRowFromWs(event);
    if (event.settState === 'settled' && event.settFundingRate) {
      expect(settled).toMatchObject({ venue: 'okx', symbol: event.instId, rate: Number(event.settFundingRate) });
      expect(settled!.fundingTime).toEqual(new Date(Number(event.prevFundingTime)));
    }
    expect(settlementRowFromWs({ ...event, settState: 'ongoing' })).toBeNull();
    expect(settlementRowFromWs({ ...event, settFundingRate: '' })).toBeNull();
  });
});

describe('funding-rate-history (real payload)', () => {
  const rows = fixture<{ data: Parameters<typeof settlementRowsFromHistory>[0] }>('funding-rate-history').data;

  it('prefers realizedRate — what was actually charged', () => {
    const mapped = settlementRowsFromHistory(rows);
    expect(mapped).toHaveLength(rows.length);
    expect(mapped[0]).toMatchObject({ venue: 'okx', symbol: 'BTC-USDT-SWAP', source: 'rest', markPrice: null });
    expect(mapped[0].rate).toBe(Number(rows[0].realizedRate));
  });

  it('falls back to fundingRate when the venue omits realizedRate', () => {
    const [row] = settlementRowsFromHistory([{ ...rows[0], realizedRate: '' }]);
    expect(row.rate).toBe(Number(rows[0].fundingRate));
  });

  it('here fundingTime is a SETTLED interval, unlike the WS channel', () => {
    const [row] = settlementRowsFromHistory(rows);
    expect(row.fundingTime).toEqual(new Date(Number(rows[0].fundingTime)));
    expect(row.fundingTime.getTime()).toBeLessThan(Date.now());
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
