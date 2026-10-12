import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapPools, numberOrNull } from '../../src/dex/mappers';

/**
 * IB-028 — GeckoTerminal's pool JSON into rows.
 *
 * **Positive control (IB-027 rule, carried forward).** The first test MUST produce rows from the
 * recorded payload. A mapper tested only on malformed input passes every one of those tests while
 * returning nothing for everything real — which is what three of today's silent zeros were.
 *
 * The rest are about the one thing this mapper exists to protect: **absent is not zero**. Every
 * pool in the recorded page has `market_cap_usd: null`, so the unknown case is the common one here,
 * not an edge, and a `0` in its place would report twenty tokens worth nothing.
 */

const FIXTURE = readFileSync(
  join(__dirname, '..', 'fixtures', 'dex', 'geckoterminal-new-pools-solana.json'),
  'utf8',
);
const AT = new Date('2026-10-12T22:00:00Z');

describe('mapping a real page', () => {
  it('produces a row per pool — the positive control', () => {
    const { rows, skipped } = mapPools(FIXTURE, 'solana', 'new_pools', AT);
    expect(rows).toHaveLength(20);
    expect(skipped).toEqual([]);
  });

  it('keeps the venue id whole and derives the address from it', () => {
    const { rows } = mapPools(FIXTURE, 'solana', 'new_pools', AT);
    expect(rows[0].poolId).toMatch(/^solana_/);
    expect(rows[0].address).toBe(rows[0].poolId.replace('solana_', ''));
    // the join key back to the API is the id, not something we invented
    expect(rows[0].poolId).toContain(rows[0].address);
  });

  it('records the listing and our observation time, not only the one the venue claims', () => {
    const { rows } = mapPools(FIXTURE, 'solana', 'trending_pools', AT);
    expect(rows[0].listing).toBe('trending_pools');
    expect(rows[0].observedAt).toEqual(AT);
    // and the venue's own claim about the pool is kept separately
    expect(rows[0].poolCreatedAt).toBeInstanceOf(Date);
  });

  it('reads the relationships rather than guessing from the name', () => {
    const { rows } = mapPools(FIXTURE, 'solana', 'new_pools', AT);
    expect(rows[0].baseTokenId).toMatch(/^solana_/);
    expect(rows[0].quoteTokenId).toMatch(/^solana_/);
    expect(rows[0].dex).toBeTruthy();
  });
});

describe('absent is not zero', () => {
  it('maps a missing market cap to null, for every pool in the real page', () => {
    // all 20 carry market_cap_usd: null — GeckoTerminal does not know the cap of a token minted
    // minutes ago. Coalescing to 0 would state twenty measurements that were never made.
    const { rows } = mapPools(FIXTURE, 'solana', 'new_pools', AT);
    expect(rows.every((r) => r.marketCapUsd === null)).toBe(true);
  });

  it('still reads the values the API DOES provide', () => {
    // the other half of the same guard: null everywhere would also pass the test above
    const { rows } = mapPools(FIXTURE, 'solana', 'new_pools', AT);
    expect(rows[0].fdvUsd).toBeGreaterThan(0);
    expect(rows[0].reserveUsd).toBeGreaterThan(0);
    expect(rows[0].basePriceUsd).toBeGreaterThan(0);
  });

  it('distinguishes a real zero from an unknown', () => {
    expect(numberOrNull(0)).toBe(0);
    expect(numberOrNull('0')).toBe(0);
    expect(numberOrNull(null)).toBeNull();
    expect(numberOrNull(undefined)).toBeNull();
  });

  it('refuses the empty string, which Number() would silently make 0', () => {
    // the API sends numbers as strings; Number('') is 0, and that conversion is exactly the
    // silent one this function exists to stop
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull('   ')).toBeNull();
    expect(numberOrNull('not a number')).toBeNull();
  });
});

describe('a payload that is not the shape we expect', () => {
  it('refuses unparseable json with a reason rather than throwing', () => {
    const { rows, skipped } = mapPools('<html>rate limited</html>', 'base', 'new_pools', AT);
    expect(rows).toEqual([]);
    expect(skipped[0].reason).toContain('unparseable json');
  });

  it('refuses a payload whose data is not a list', () => {
    const { rows, skipped } = mapPools('{"data":{"oops":true}}', 'base', 'new_pools', AT);
    expect(rows).toEqual([]);
    expect(skipped[0].reason).toContain('not an array');
  });

  it('skips a pool whose id does not carry the network prefix, and says so', () => {
    // the `<network>_<address>` shape is an assumption about the venue; if it stops holding we
    // must see it rather than store a wrong address
    const body = JSON.stringify({ data: [{ id: 'ethereum_0xabc', attributes: {} }] });
    const { rows, skipped } = mapPools(body, 'eth', 'new_pools', AT);
    expect(rows).toEqual([]);
    expect(skipped[0].reason).toContain("does not start with 'eth_'");
  });

  it('skips a pool with no id at all', () => {
    const { rows, skipped } = mapPools(JSON.stringify({ data: [{ attributes: {} }] }), 'bsc', 'new_pools', AT);
    expect(rows).toEqual([]);
    expect(skipped[0].reason).toBe('pool without an id');
  });
});
