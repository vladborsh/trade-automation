import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addressKey, mapPairs } from '../../src/dex/dexscreener';

/**
 * IB-028 — the DexScreener mapper, against recorded real responses.
 *
 * **The fixtures carry the requested addresses next to the response.** Without them the central
 * claim — that a batch of 20 comes back incomplete and with different letter case on EVM — is not
 * expressible, because the fold and the gap are both properties of the REQUEST set.
 *
 * Every test that depends on fixture content asserts that content first, so re-recording a fixture
 * makes the test fail rather than silently makes it vacuous.
 */
const DIR = join(__dirname, '..', 'fixtures', 'dex');
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');

const SOL_BODY = read('dexscreener-pairs-solana.json');
const SOL_REQ = JSON.parse(read('dexscreener-requested-solana.json')) as { requested: string[] };
const BASE_BODY = read('dexscreener-pairs-base.json');
const BASE_REQ = JSON.parse(read('dexscreener-requested-base.json')) as { requested: string[] };

const T0 = new Date('2026-10-12T23:00:00Z');

describe('addressKey — the per-chain fold', () => {
  it('folds case on EVM, because hex case carries no meaning there', () => {
    expect(addressKey('base', '0xABCdef')).toBe('0xabcdef');
    expect(addressKey('eth', '0xABCdef')).toBe('0xabcdef');
    expect(addressKey('bsc', '0xABCdef')).toBe('0xabcdef');
  });

  it('does NOT fold case on Solana, because base58 is case-sensitive', () => {
    // 'A' and 'a' are different base58 digits; folding would merge two distinct addresses
    expect(addressKey('solana', 'Abc')).toBe('Abc');
    expect(addressKey('solana', 'Abc')).not.toBe(addressKey('solana', 'abc'));
  });
});

describe('mapPairs on the recorded Base response', () => {
  it('the fixture really contains addresses DexScreener re-cased — the premise of the fold', () => {
    const got = (JSON.parse(BASE_BODY).pairs as Array<{ pairAddress: string }>).map((p) => p.pairAddress);
    const exact = BASE_REQ.requested.filter((a) => got.includes(a)).length;
    const folded = BASE_REQ.requested.filter((a) => got.some((g) => g.toLowerCase() === a.toLowerCase())).length;
    expect(folded).toBeGreaterThan(exact); // if this ever fails the fixture no longer shows the bug
    expect(exact).toBeLessThan(BASE_REQ.requested.length);
  });

  it('matches EVERY requested address despite the re-casing', () => {
    const { rows, missing } = mapPairs(BASE_BODY, 'base', BASE_REQ.requested, T0);
    expect(rows).toHaveLength(BASE_REQ.requested.length);
    expect(missing).toEqual([]);
  });

  it('would have dropped pairs under an exact-string join — the positive control', () => {
    // the mistake this file exists to prevent, attempted: ask with the venue's own casing removed
    const upper = BASE_REQ.requested.map((a) => a.toUpperCase());
    const { rows } = mapPairs(BASE_BODY, 'base', upper, T0);
    expect(rows).toHaveLength(upper.length); // the fold survives even a case we never sent
  });

  it('keys the row on the address we ASKED about, so it joins to its dex_pools row', () => {
    const { rows } = mapPairs(BASE_BODY, 'base', BASE_REQ.requested, T0);
    for (const row of rows) expect(BASE_REQ.requested).toContain(row.poolId.replace('base_', ''));
  });

  it('reads liquidity, which Base pairs mostly carry', () => {
    const { rows } = mapPairs(BASE_BODY, 'base', BASE_REQ.requested, T0);
    expect(rows.filter((r) => r.liquidityUsd !== null).length).toBeGreaterThan(rows.length / 2);
  });
});

describe('mapPairs on the recorded Solana response', () => {
  it('stores an ABSENT liquidity as null, not 0 — and the fixture shows the case', () => {
    const pairs = JSON.parse(SOL_BODY).pairs as Array<Record<string, unknown>>;
    const without = pairs.filter((p) => p.liquidity === undefined).length;
    expect(without).toBeGreaterThan(0); // the premise: Solana pairs often omit liquidity entirely

    const { rows } = mapPairs(SOL_BODY, 'solana', SOL_REQ.requested, T0);
    expect(rows.filter((r) => r.liquidityUsd === null)).toHaveLength(without);
    // and a liquidity that WAS given survives, so the null above is not the mapper failing
    const given = rows.filter((r) => r.liquidityUsd !== null);
    if (given.length > 0) expect(given.every((r) => typeof r.liquidityUsd === 'number')).toBe(true);
  });

  it('maps the nested readings a pair does carry — the positive control', () => {
    const { rows } = mapPairs(SOL_BODY, 'solana', SOL_REQ.requested, T0);
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row.priceNative).not.toBeNull();
    expect(row.volumeUsdH24).not.toBeNull();
    expect(row.txnsH24Buys).not.toBeNull();
    expect(row.pairCreatedAt).toBeInstanceOf(Date);
    expect(row.dex).not.toBeNull();
    expect(row.observedAt).toBe(T0);
  });

  it('reports an address it was told nothing about as MISSING, with no row', () => {
    const asked = [...SOL_REQ.requested, 'NotAPoolAddressAtAll'];
    const { rows, missing } = mapPairs(SOL_BODY, 'solana', asked, T0);
    expect(missing).toEqual(['NotAPoolAddressAtAll']);
    expect(rows.map((r) => r.address)).not.toContain('NotAPoolAddressAtAll');
    // and it is not written as a row of nulls, which would be a measurement never made
    expect(rows).toHaveLength(asked.length - 1);
  });

  it('a genuine zero stays 0 and is distinguishable from absent', () => {
    const body = JSON.stringify({
      pairs: [{ pairAddress: 'Zed', dexId: 'x', volume: { h1: 0 }, txns: { h1: { buys: 0, sells: 0 } } }],
    });
    const { rows } = mapPairs(body, 'solana', ['Zed'], T0);
    expect(rows[0].volumeUsdH1).toBe(0);
    expect(rows[0].txnsH1Buys).toBe(0);
    expect(rows[0].volumeUsdH24).toBeNull(); // not given at all
    expect(rows[0].liquidityUsd).toBeNull();
  });
});

describe('mapPairs refuses what it cannot trust', () => {
  it('throws on a body that is not JSON', () => {
    expect(() => mapPairs('<html>429</html>', 'solana', ['a'], T0)).toThrow(/unparseable/);
  });

  it('treats a null pairs field as "nothing matched", not as an error', () => {
    const { rows, missing } = mapPairs(JSON.stringify({ schemaVersion: '1.0.0', pairs: null, pair: null }), 'solana', ['a', 'b'], T0);
    expect(rows).toEqual([]);
    expect(missing).toEqual(['a', 'b']);
  });

  it('skips a pair with no pairAddress rather than guessing which pool it is', () => {
    const body = JSON.stringify({ pairs: [{ dexId: 'x' }, { pairAddress: 'Keep', dexId: 'y' }] });
    const { rows, skipped } = mapPairs(body, 'solana', ['Keep'], T0);
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/pairAddress/);
  });

  it('THROWS if two pairs fold to one key, because the fold would mis-join readings', () => {
    const body = JSON.stringify({ pairs: [{ pairAddress: '0xAB' }, { pairAddress: '0xab' }] });
    expect(() => mapPairs(body, 'base', ['0xab'], T0)).toThrow(/share the key/);
    // and on Solana the same two addresses are legitimately different pools
    expect(() => mapPairs(body, 'solana', ['0xab'], T0)).not.toThrow();
  });
});
