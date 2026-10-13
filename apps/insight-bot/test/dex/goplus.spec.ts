import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertFieldsPresent, EVM_FIELDS, FIELDS, flagOrNull, mapTokenSecurity, SOLANA_FIELDS } from '../../src/dex/goplus';

/**
 * IB-028 — GoPlus's two response shapes, pinned by committed fixtures from real calls.
 *
 * **Positive control:** both fixtures must produce a row. A mapper that returns null for everything
 * passes every "refuses bad input" test ever written.
 *
 * **The fixtures and the runtime assertion share one list** (`FIELDS`), so a field added to the
 * mapper without being pinned here fails. That is the third requirement from the review, and it is
 * what stops this spec drifting from the code it guards — the failure we removed between
 * AMBIGUOUS_TERMS and its classification map earlier today.
 */

const fixture = (name: string) =>
  readFileSync(join(__dirname, '..', 'fixtures', 'dex', name), 'utf8');

const SOLANA = fixture('goplus-solana-token-security.json');
const EVM = fixture('goplus-evm-token-security.json');

describe('the committed fixtures are real responses', () => {
  it('each fixture contains EVERY field the mapper claims to read', () => {
    // the shared-list requirement: adding a field to FIELDS without re-recording the fixture fails
    for (const [family, body] of [['solana', SOLANA], ['evm', EVM]] as const) {
      const token = Object.values(JSON.parse(body).result as Record<string, Record<string, unknown>>)[0];
      const missing = FIELDS[family].filter((f) => !(f in token));
      expect({ family, missing }).toEqual({ family, missing: [] });
    }
  });

  it('does not pin the three fields that came from the DOCS and exist in neither response', () => {
    // is_honeypot, is_proxy and owner_can_change_balance were in my first schema, taken from
    // documentation. This asserts they are still absent, so nobody re-adds them from the docs.
    const all = [...SOLANA_FIELDS, ...EVM_FIELDS];
    for (const invented of ['is_honeypot', 'is_proxy', 'owner_can_change_balance']) {
      expect(all).not.toContain(invented);
    }
  });
});

describe('mapping, per chain family', () => {
  it('maps a Solana response — the positive control', () => {
    const mapped = mapTokenSecurity(SOLANA, 'solana')!;
    expect(mapped.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/); // base58
    expect(mapped.row.chainFamily).toBe('solana');
    // at least one flag actually read, or this proves only that nothing threw
    const flags = [mapped.row.mintable, mapped.row.freezable, mapped.row.closable];
    expect(flags.some((f) => f !== null)).toBe(true);
  });

  it('maps an EVM response — the positive control', () => {
    const mapped = mapTokenSecurity(EVM, 'evm')!;
    expect(mapped.address).toMatch(/^0x[0-9a-f]+$/i);
    expect(mapped.row.chainFamily).toBe('evm');
    expect(mapped.row.isOpenSource).not.toBeUndefined();
  });

  it('leaves the OTHER family’s columns null, which chain_family explains', () => {
    const solana = mapTokenSecurity(SOLANA, 'solana')!.row;
    expect(solana.buyTax).toBeNull();        // not applicable, not "not told"
    expect(solana.holderCount).toBeNull();
    const evm = mapTokenSecurity(EVM, 'evm')!.row;
    expect(evm.mintable).toBeNull();
    expect(evm.freezable).toBeNull();
  });

  it('reads an empty buy_tax as NULL, never as a 0 % tax', () => {
    // measured: a fresh EVM token returns buy_tax: '' and Number('') is 0
    const token = Object.values(JSON.parse(EVM).result as Record<string, Record<string, unknown>>)[0];
    expect(token['buy_tax']).toBe('');
    expect(mapTokenSecurity(EVM, 'evm')!.row.buyTax).toBeNull();
  });
});

describe('a field we read disappearing from the API must THROW', () => {
  it('throws, rather than producing a null that means "not told"', () => {
    const payload = JSON.parse(EVM) as { result: Record<string, Record<string, unknown>> };
    const [addr, token] = Object.entries(payload.result)[0];
    delete token['buy_tax'];
    payload.result[addr] = token;

    expect(() => mapTokenSecurity(JSON.stringify(payload), 'evm'))
      .toThrow(/missing field\(s\) we read: buy_tax/);
  });

  it('names every missing field, not just the first', () => {
    expect(() => assertFieldsPresent({ total_supply: '1' }, 'evm'))
      .toThrow(/is_open_source, cannot_buy, buy_tax, sell_tax, holder_count/);
  });

  it('a field PRESENT but empty does not throw — that is a measured absence', () => {
    // the distinction the whole file exists for: absent key = we cannot ask; empty value = asked
    // and told nothing
    expect(() => mapTokenSecurity(EVM, 'evm')).not.toThrow();
  });
});

describe('GoPlus flags are not booleans', () => {
  it('reads the nested Solana shape and the flat EVM shape alike', () => {
    expect(flagOrNull({ status: '1', authority: [] })).toBe(true);
    expect(flagOrNull({ status: '0' })).toBe(false);
    expect(flagOrNull('1')).toBe(true);
    expect(flagOrNull('0')).toBe(false);
  });

  it('returns null for absent or empty, never false', () => {
    // "GoPlus did not say" and "GoPlus said no" are different claims
    expect(flagOrNull(undefined)).toBeNull();
    expect(flagOrNull(null)).toBeNull();
    expect(flagOrNull('')).toBeNull();
    expect(flagOrNull({ status: '' })).toBeNull();
  });
});
