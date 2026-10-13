import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  absentFields, assertShapeRecognisable, DISTINCTIVE_FIELDS, EVM_FIELDS, FIELDS, flagOrNull,
  mapTokenSecurity, SOLANA_FIELDS,
} from '../../src/dex/goplus';

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

/*
 * The invariant the live pass corrected.
 *
 * My first version threw when ANY field was absent. Measured 2026-10-12 on the real API, GoPlus
 * omits an attribute it has nothing to say about per token, routinely: `metadata_mutable` on 1 of
 * 12 Solana tokens, `is_open_source` on 4 of 9 BSC tokens, plus `cannot_buy` and `total_supply` on
 * EVM. Under the strict rule each of those became a FAILED ask, retried five times and abandoned —
 * so we would have been permanently ignorant about a token's security BECAUSE the venue answered.
 *
 * Both directions are asserted below, because the fix must not become "never throw".
 */
describe('one absent field is "not told"; ZERO fields present is a shape change', () => {
  it('maps a token that omits a field, and RECORDS which one — not a throw', () => {
    const payload = JSON.parse(EVM) as { result: Record<string, Record<string, unknown>> };
    const [addr, token] = Object.entries(payload.result)[0];
    expect('buy_tax' in token).toBe(true); // the premise, before we remove it
    delete token['buy_tax'];
    payload.result[addr] = token;

    const mapped = mapTokenSecurity(JSON.stringify(payload), 'evm')!;
    expect(mapped.row.buyTax).toBeNull();               // not told
    expect(mapped.row.absentFields).toEqual(['buy_tax']); // and we know we were not told
    expect(mapped.row.holderCount).not.toBeNull();      // the rest still mapped
  });

  it('records nothing absent for a response that carries every field — the positive control', () => {
    expect(mapTokenSecurity(EVM, 'evm')!.row.absentFields).toEqual([]);
    expect(mapTokenSecurity(SOLANA, 'solana')!.row.absentFields).toEqual([]);
  });

  it('THROWS when no distinctive field is present, naming what it did see', () => {
    const payload = { result: { '0xabc': { code: 4011, message: 'not supported' } } };
    expect(() => mapTokenSecurity(JSON.stringify(payload), 'evm'))
      .toThrow(/contains NONE of the \d+ fields distinctive to evm/);
    expect(() => mapTokenSecurity(JSON.stringify(payload), 'evm')).toThrow(/keys present: code, message/);
  });

  it('throws on the WRONG chain family, which is the same failure wearing a 200', () => {
    // and this is why the check needs DISTINCTIVE fields: total_supply is in both lists, so a
    // Solana payload read as EVM does carry one field we read — the first threshold let it through
    expect(() => mapTokenSecurity(SOLANA, 'evm')).toThrow(/NONE of the/);
    expect(() => mapTokenSecurity(EVM, 'solana')).toThrow(/NONE of the/);
    expect(DISTINCTIVE_FIELDS.evm).not.toContain('total_supply');
    expect(DISTINCTIVE_FIELDS.solana).not.toContain('total_supply');
  });

  it('the SHARED field alone is not enough, and one distinctive field is', () => {
    expect(() => assertShapeRecognisable({ total_supply: '1' }, 'evm')).toThrow(/NONE of the/);
    expect(() => assertShapeRecognisable({ total_supply: '1', buy_tax: '' }, 'evm')).not.toThrow();
    expect(absentFields({ total_supply: '1' }, 'evm')).toEqual(
      EVM_FIELDS.filter((f) => f !== 'total_supply'),
    );
  });

  it('tolerates the omissions actually measured on the live API', () => {
    // solana: metadata_mutable on 1 of 12; bsc: is_open_source on 4 of 9
    const sol = JSON.parse(SOLANA) as { result: Record<string, Record<string, unknown>> };
    const [sa, st] = Object.entries(sol.result)[0];
    delete st['metadata_mutable'];
    sol.result[sa] = st;
    expect(mapTokenSecurity(JSON.stringify(sol), 'solana')!.row.absentFields).toEqual(['metadata_mutable']);

    const evm = JSON.parse(EVM) as { result: Record<string, Record<string, unknown>> };
    const [ea, et] = Object.entries(evm.result)[0];
    delete et['is_open_source'];
    evm.result[ea] = et;
    expect(mapTokenSecurity(JSON.stringify(evm), 'evm')!.row.absentFields).toEqual(['is_open_source']);
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
