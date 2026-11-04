import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OpsModule } from '../../src/ops/ops.module';
import { BinanceWeightTracker } from '../../src/venues/binance/binance-weight.tracker';
import { FuturesDataClient } from '../../src/venues/binance/futures-data.client';
import { PerpRest } from '../../src/venues/binance/perp.rest';
import { BybitRest } from '../../src/venues/bybit/bybit.rest';
import { OkxRest } from '../../src/venues/okx/okx-rest';
import { TtlCache } from '../../src/venues/ttl-cache';
import { VenuesModule } from '../../src/venues/venues.module';

/**
 * WD-008 — `BinanceWeightTracker` moved from OpsModule to VenuesModule. The property that matters is
 * unchanged: anything importing OpsModule (the collectors, the web module) and VenuesModule's own
 * clients record into ONE instance. A second instance would halve every `/health` figure and let the
 * 1 800/min refusal check the smaller half.
 */
@Injectable()
class Consumer {
  constructor(readonly weight: BinanceWeightTracker, readonly cache: TtlCache, readonly futures: FuturesDataClient) {}
}

@Module({ imports: [OpsModule], providers: [Consumer] })
class ConsumerModule {}

describe('VenuesModule (WD-008)', () => {
  it('a consumer of OpsModule gets the same tracker VenuesModule owns', async () => {
    const ref = await Test.createTestingModule({ imports: [ConsumerModule] }).compile();
    const consumer = ref.get(Consumer);
    const owned = ref.select(VenuesModule).get(BinanceWeightTracker);
    expect(consumer.weight).toBe(owned);
    expect(ref.select(OpsModule).get(BinanceWeightTracker)).toBe(owned);
    await ref.close();
  });

  it('builds every venue client and one shared cache', async () => {
    const ref = await Test.createTestingModule({ imports: [ConsumerModule] }).compile();
    for (const token of [FuturesDataClient, PerpRest, BybitRest, OkxRest, TtlCache]) {
      expect(ref.select(VenuesModule).get(token as never)).toBeDefined();
    }
    expect(ref.get(Consumer).cache).toBe(ref.select(VenuesModule).get(TtlCache));
    await ref.close();
  });

  it("the module's FuturesDataClient records into that one tracker", async () => {
    const ref = await Test.createTestingModule({ imports: [ConsumerModule] }).compile();
    const { futures, weight } = ref.get(Consumer);
    const original = global.fetch;
    // no network: the module's client uses the global fetch, replaced for this one call. The answer
    // carries a weight header so the write is observable: a /futures/data call itself books weight 0
    // (IB-BUG-030), which cannot tell one tracker from another.
    global.fetch = (async () => new Response('[]', { status: 200, headers: { 'x-mbx-used-weight-1m': '7' } })) as typeof fetch;
    try {
      await futures.fetchPage({ endpoint: 'openInterestHist', symbol: 'BTCUSDT' });
    } finally {
      global.fetch = original;
    }
    expect(weight.used1m()).toBe(7);
    expect(weight.isEstimate()).toBe(false);
    await ref.close();
  });
});
