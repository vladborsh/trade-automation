import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  absentFields, ALWAYS_PRESENT, assertShapeRecognisable, EVM_FIELDS, FIELD_CONTRACTS, FIELDS,
  flagOrNull, mapTokenSecurity, SOLANA_FIELDS,
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
describe('an OPTIONAL field absent is "not told"; an ALWAYS field absent is a shape change', () => {
  it('maps a token that omits an optional field, and RECORDS which one — not a throw', () => {
    const payload = JSON.parse(EVM) as { result: Record<string, Record<string, unknown>> };
    const [addr, token] = Object.entries(payload.result)[0];
    expect('is_open_source' in token).toBe(true); // the premise, before we remove it
    delete token['is_open_source'];
    payload.result[addr] = token;

    const mapped = mapTokenSecurity(JSON.stringify(payload), 'evm')!;
    expect(mapped.row.isOpenSource).toBeNull();                 // not told
    expect(mapped.row.absentFields).toEqual(['is_open_source']); // and we know we were not told
    expect(mapped.row.holderCount).not.toBeNull();              // the rest still mapped
  });

  it('records nothing absent for a response that carries every field — the positive control', () => {
    expect(mapTokenSecurity(EVM, 'evm')!.row.absentFields).toEqual([]);
    expect(mapTokenSecurity(SOLANA, 'solana')!.row.absentFields).toEqual([]);
  });

  it('tolerates every omission MEASURED on the live API, and records it', () => {
    // these four are the whole evidence base for the `optional` class, so they are the four cases
    // the mapper must survive; if any of them throws again we are back to losing rows
    const omit = (body: string, field: string) => {
      const payload = JSON.parse(body) as { result: Record<string, Record<string, unknown>> };
      const [addr, token] = Object.entries(payload.result)[0];
      expect(field in token).toBe(true); // the premise, before removing it
      delete token[field];
      payload.result[addr] = token;
      return JSON.stringify(payload);
    };

    for (const field of ['metadata_mutable']) {
      const mapped = mapTokenSecurity(omit(SOLANA, field), 'solana')!;
      expect(mapped.row.absentFields).toEqual([field]);
      expect(mapped.row.mintable).not.toBeNull(); // the rest still mapped
    }
    for (const field of ['is_open_source', 'cannot_buy', 'total_supply']) {
      const mapped = mapTokenSecurity(omit(EVM, field), 'evm')!;
      expect(mapped.row.absentFields).toEqual([field]);
      expect(mapped.row.holderCount).not.toBeNull();
    }
  });

  it('THROWS when an ALWAYS-present field is missing, and says what the classification rests on', () => {
    const payload = JSON.parse(EVM) as { result: Record<string, Record<string, unknown>> };
    const [addr, token] = Object.entries(payload.result)[0];
    expect('buy_tax' in token).toBe(true);
    delete token['buy_tax'];
    payload.result[addr] = token;

    expect(() => mapTokenSecurity(JSON.stringify(payload), 'evm'))
      .toThrow(/missing field\(s\) measured as ALWAYS present: buy_tax/);
    // the throw must name its own evidence: whoever sees it needs to know whether the API changed
    // or whether this classification was too strong
    expect(() => mapTokenSecurity(JSON.stringify(payload), 'evm')).toThrow(/Evidence for that classification/);
  });

  it('throws on the WRONG chain family, with no separate check for it', () => {
    // no Solana payload carries buy_tax/sell_tax/holder_count and no EVM payload carries mintable,
    // so the per-field contract covers this. `total_supply` is in BOTH lists and cannot carry a
    // family on its own — which is exactly what defeated my first, coarser threshold.
    expect(() => mapTokenSecurity(SOLANA, 'evm')).toThrow(/ALWAYS present/);
    expect(() => mapTokenSecurity(EVM, 'solana')).toThrow(/ALWAYS present/);
    expect(() => assertShapeRecognisable({ total_supply: '1' }, 'evm')).toThrow(/ALWAYS present/);
  });

  it('an error object wearing a 200 throws rather than becoming a row of nulls', () => {
    const payload = { result: { '0xabc': { code: 4011, message: 'not supported' } } };
    expect(() => mapTokenSecurity(JSON.stringify(payload), 'evm')).toThrow(/ALWAYS present/);
    expect(() => mapTokenSecurity(JSON.stringify(payload), 'evm')).toThrow(/Keys present: code, message/);
  });

  describe('the field contracts', () => {
    it('classify every field of both families exactly once', () => {
      for (const family of ['solana', 'evm'] as const) {
        expect(FIELD_CONTRACTS[family].map((c) => c.field)).toEqual([...FIELDS[family]]);
      }
    });

    it('carry evidence with a population, not an adjective', () => {
      // a classification is a measured claim; "always present" with nothing behind it is the thing
      // that cost us rows in the first place
      for (const family of ['solana', 'evm'] as const) {
        for (const contract of FIELD_CONTRACTS[family]) {
          expect(contract.evidence).toMatch(/\d/);
          expect(contract.evidence.length).toBeGreaterThan(30);
        }
      }
    });

    it('classify as OPTIONAL every field observed absent on the live API', () => {
      // the asymmetry: a wrong `optional` is a null we can see in absent_fields, a wrong `always`
      // throws on normal data and loses the row for good
      const optional = (family: 'solana' | 'evm') =>
        FIELD_CONTRACTS[family].filter((c) => c.presence === 'optional').map((c) => c.field);
      expect(optional('solana')).toEqual(['metadata_mutable']);
      expect(optional('evm')).toEqual(['is_open_source', 'cannot_buy', 'total_supply']);
      expect(ALWAYS_PRESENT.evm).not.toContain('total_supply');
    });
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
