import { ALL_GOPLUS_FIELDS, dexFieldPresence } from '../../src/web/dex-field-presence';
import { FIELD_CONTRACTS } from '../../src/dex/goplus';

/**
 * IB-028 — the field-presence rate, which is the only form in which a vanished GoPlus field is
 * detectable at all: the payload varies per token, so one absence says nothing and a drop from
 * 90 % to 0 % says everything.
 */
describe('dexFieldPresence', () => {
  it('turns counts into a rate — the positive control', () => {
    const rows = dexFieldPresence([
      { chainFamily: 'evm', field: 'buy_tax', answered: 10, present: 9 },
      { chainFamily: 'solana', field: 'mintable', answered: 4, present: 4 },
    ]);
    const buyTax = rows.find((r) => r.chainFamily === 'evm' && r.field === 'buy_tax')!;
    expect(buyTax.presentRate).toBeCloseTo(0.9);
    expect(buyTax.answered).toBe(10);
    expect(rows.find((r) => r.field === 'mintable')!.presentRate).toBe(1);
  });

  it('reports NULL, not 0, when nothing was answered', () => {
    // "we asked nobody" and "we asked 40 tokens and none carried it" are different facts, and the
    // second is the alarm this block exists to raise
    for (const row of dexFieldPresence([])) {
      expect(row.answered).toBe(0);
      expect(row.presentRate).toBeNull();
    }
  });

  it('reports 0 when every answered ask lacked the field — the signal itself', () => {
    const rows = dexFieldPresence([{ chainFamily: 'evm', field: 'buy_tax', answered: 40, present: 0 }]);
    const row = rows.find((r) => r.chainFamily === 'evm' && r.field === 'buy_tax')!;
    expect(row.presentRate).toBe(0);
    expect(row.presence).toBe('always'); // and it is declared always-present, so this is loud
  });

  it('does not show a family a field does not belong to', () => {
    // buy_tax is not ABSENT from a Solana response, it is not applicable — a 0 % row here would
    // read as a field that vanished
    const rows = dexFieldPresence([]);
    expect(rows.filter((r) => r.chainFamily === 'solana').map((r) => r.field))
      .toEqual(FIELD_CONTRACTS.solana.map((c) => c.field));
    expect(rows.filter((r) => r.chainFamily === 'solana').map((r) => r.field)).not.toContain('buy_tax');
    expect(rows.filter((r) => r.chainFamily === 'evm').map((r) => r.field)).not.toContain('mintable');
  });

  it('ignores a count for a field/family pair that cannot exist', () => {
    const rows = dexFieldPresence([{ chainFamily: 'solana', field: 'buy_tax', answered: 99, present: 0 }]);
    expect(rows.some((r) => r.chainFamily === 'solana' && r.field === 'buy_tax')).toBe(false);
    expect(rows.every((r) => r.answered === 0)).toBe(true);
  });

  it('carries every field of both families, each exactly once', () => {
    const rows = dexFieldPresence([]);
    const keys = rows.map((r) => `${r.chainFamily}:${r.field}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows).toHaveLength(FIELD_CONTRACTS.solana.length + FIELD_CONTRACTS.evm.length);
  });

  it('queries the UNION of both families once, with total_supply not duplicated', () => {
    expect(ALL_GOPLUS_FIELDS).toContain('total_supply');
    expect(ALL_GOPLUS_FIELDS.filter((f) => f === 'total_supply')).toHaveLength(1);
    expect(new Set(ALL_GOPLUS_FIELDS).size).toBe(ALL_GOPLUS_FIELDS.length);
  });
});
