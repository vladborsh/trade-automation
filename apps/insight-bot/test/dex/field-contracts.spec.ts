import { ALWAYS_PRESENT, DISTINCTIVE_FIELDS, FIELD_CONTRACTS, mapTokenSecurity } from '../../src/dex/goplus';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * IB-028 — the field classifications, and above all the one that looks like an oversight.
 *
 * `ALWAYS_PRESENT.evm` is **empty**, and an empty list reads as "nobody filled this in". It is a
 * measurement: the 24-hour run falsified the last two EVM candidates inside twenty minutes, and a
 * per-response detector for "this field vanished" does not exist on a payload whose two committed
 * fixtures share 5 of 29 names. Promoting anything back into it on the strength of a clean window
 * reinstates the throw that discarded good rows.
 *
 * This file is the pin that makes refilling it a failing test rather than a tidy-up.
 */
describe('GoPlus field contracts', () => {
  it('has NO always-present EVM field, deliberately', () => {
    expect(ALWAYS_PRESENT.evm).toEqual([]);
  });

  it('keeps every EVM field classified, so the empty list is not an empty table', () => {
    // the distinction between "nothing is always-present" and "nothing is classified"
    expect(FIELD_CONTRACTS.evm).toHaveLength(6);
    expect(FIELD_CONTRACTS.evm.every((c) => c.presence === 'optional')).toBe(true);
    expect(FIELD_CONTRACTS.evm.every((c) => /\d/.test(c.evidence))).toBe(true);
  });

  it('names the live token that falsified the tax fields, so the claim can be rechecked', () => {
    const taxes = FIELD_CONTRACTS.evm.filter((c) => c.field === 'buy_tax' || c.field === 'sell_tax');
    expect(taxes).toHaveLength(2);
    for (const contract of taxes) expect(contract.evidence).toContain('0x8d0d');
  });

  it('still catches a WRONG FAMILY with no always-present field to lean on', () => {
    // the family check keys on DISTINCTIVE_FIELDS, so emptying ALWAYS_PRESENT.evm cannot disarm it;
    // and it fires on POSITIVE evidence — the other family's markers present, ours absent
    const solana = readFileSync(join(__dirname, '..', 'fixtures', 'dex', 'goplus-solana-token-security.json'), 'utf8');
    expect(() => mapTokenSecurity(solana, 'evm')).toThrow(/asked for evm and got a solana token/);
    expect(DISTINCTIVE_FIELDS.evm.length).toBeGreaterThan(0);
  });

  it('keeps Solana always-present fields, which the run has not falsified', () => {
    // 37 of 37 across both occasions and the run so far. If the run falsifies one, the move is the
    // same again — reclassify with the evidence — not a defence of the classification.
    expect(ALWAYS_PRESENT.solana).toEqual([
      'mintable', 'freezable', 'closable', 'balance_mutable_authority', 'total_supply',
    ]);
  });

  it('classifies as optional every field observed absent on the live API', () => {
    const optional = (family: 'solana' | 'evm') =>
      FIELD_CONTRACTS[family].filter((c) => c.presence === 'optional').map((c) => c.field);
    expect(optional('solana')).toEqual(['metadata_mutable']);
    expect(optional('evm')).toEqual([
      'is_open_source', 'cannot_buy', 'buy_tax', 'sell_tax', 'holder_count', 'total_supply',
    ]);
  });
});
