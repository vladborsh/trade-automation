import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  absentFields, ALWAYS_PRESENT, assertEnvelope, assertNotTheOtherFamily, DISTINCTIVE_FIELDS,
  EVM_FIELDS, FIELD_CONTRACTS, FIELDS, flagOrNull, mapTokenSecurity, SOLANA_FIELDS,
  unexpectedAbsences,
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
/**
 * A SECOND real EVM response, recorded because it shares only 5 field names with the first.
 *
 * It is the token the live run choked on: it omits `holder_count` and `total_supply` and carries 24
 * fields the other does not — including `is_honeypot` and `is_proxy`, which I had concluded exist
 * in neither response. Two fixtures were not a sample of the EVM shape; they were two shapes.
 */
const EVM_VARIABLE = fixture('goplus-evm-variable-shape.json');

describe('the committed fixtures are real responses', () => {
  it('each fixture contains EVERY field the mapper claims to read', () => {
    // the shared-list requirement: adding a field to FIELDS without re-recording the fixture fails
    for (const [family, body] of [['solana', SOLANA], ['evm', EVM]] as const) {
      const token = Object.values(JSON.parse(body).result as Record<string, Record<string, unknown>>)[0];
      const missing = FIELDS[family].filter((f) => !(f in token));
      expect({ family, missing }).toEqual({ family, missing: [] });
    }
  });

  /*
   * A CORRECTION to my own earlier finding, and it went the wrong way round.
   *
   * I reported that `is_honeypot`, `is_proxy` and `owner_can_change_balance` — the three fields my
   * first schema took from GoPlus's documentation — "exist in neither response". That was a claim
   * about the API made from two fixtures. The second EVM response carries `is_honeypot`, `is_proxy`
   * and `is_mintable`; what does not exist is the DOCS SPELLING `owner_can_change_balance`, which
   * appears as `owner_change_balance`.
   *
   * So the right pin is not "these fields are not real" but "we do not read them yet, and the one
   * spelled the docs' way is not real". `raw` keeps all of them, so nothing is lost while that is
   * decided — but a honeypot flag being available for some tokens is a Tech Lead decision, not
   * mine, and it is in the report.
   */
  it('corrects the "exists in neither response" claim: is_honeypot and is_proxy DO exist', () => {
    const token = Object.values(JSON.parse(EVM_VARIABLE).result as Record<string, Record<string, unknown>>)[0];
    expect('is_honeypot' in token).toBe(true);
    expect('is_proxy' in token).toBe(true);
    expect('is_mintable' in token).toBe(true);
    // and the docs spelling is still absent — THAT is what was wrong in my first schema
    expect('owner_can_change_balance' in token).toBe(false);
    expect('owner_change_balance' in token).toBe(true);
  });

  it('does not read them yet, so nobody adds a column from the docs without a ruling', () => {
    const all = [...SOLANA_FIELDS, ...EVM_FIELDS];
    for (const notReadYet of ['is_honeypot', 'is_proxy', 'owner_change_balance', 'owner_can_change_balance']) {
      expect(all).not.toContain(notReadYet);
    }
  });

  it('the two EVM responses share only FIVE names — the measurement behind the mechanism', () => {
    const keys = (body: string) =>
      Object.keys(Object.values(JSON.parse(body).result as Record<string, Record<string, unknown>>)[0]);
    const a = keys(EVM);
    const b = new Set(keys(EVM_VARIABLE));
    expect(a.filter((k) => b.has(k)).sort()).toEqual(
      ['buy_tax', 'cannot_buy', 'is_in_dex', 'is_open_source', 'sell_tax'],
    );
    // if this ever grows, the per-token variability has changed and the contracts can be tightened
    expect(a.length).toBeLessThan(b.size);
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

  it('KEEPS the row when an always-present field vanishes, and reports it instead', () => {
    // the correction: throwing here lost rows for tokens the venue DID answer about, and the live
    // run proved the classification itself is falsifiable. Loud, not fatal.
    //
    // Demonstrated on SOLANA, because EVM no longer has an always-present field to remove — the run
    // falsified the last two, which is the point rather than a gap in this test.
    const payload = JSON.parse(SOLANA) as { result: Record<string, Record<string, unknown>> };
    const [addr, token] = Object.entries(payload.result)[0];
    expect('mintable' in token).toBe(true);
    delete token['mintable'];
    payload.result[addr] = token;

    const mapped = mapTokenSecurity(JSON.stringify(payload), 'solana')!;
    expect(mapped.row.mintable).toBeNull();
    expect(mapped.row.absentFields).toContain('mintable');

    const surprising = unexpectedAbsences(mapped.row);
    expect(surprising.map((c) => c.field)).toEqual(['mintable']);
    expect(surprising[0].evidence).toMatch(/\d/); // the signal carries its own basis
  });

  it('reports nothing for an EVM field, because none is classified always-present', () => {
    // not an omission: `field-contracts.spec.ts` pins why the list is empty
    const payload = JSON.parse(EVM) as { result: Record<string, Record<string, unknown>> };
    const [addr, token] = Object.entries(payload.result)[0];
    delete token['buy_tax'];
    delete token['sell_tax'];
    payload.result[addr] = token;
    const mapped = mapTokenSecurity(JSON.stringify(payload), 'evm')!;
    expect(mapped.row.absentFields).toEqual(expect.arrayContaining(['buy_tax', 'sell_tax']));
    expect(unexpectedAbsences(mapped.row)).toEqual([]);
  });

  it('reports NOTHING surprising for the real responses — the positive control', () => {
    for (const [body, family] of [[SOLANA, 'solana'], [EVM, 'evm']] as const) {
      expect(unexpectedAbsences(mapTokenSecurity(body, family)!.row)).toEqual([]);
    }
  });

  it('the live-run token that started this is mapped, not discarded', () => {
    // it omits holder_count and total_supply; under the first rule it became a failed ask, was
    // retried five times and abandoned — while carrying is_honeypot, which we most want to know
    const mapped = mapTokenSecurity(EVM_VARIABLE, 'evm')!;
    expect(mapped.row.holderCount).toBeNull();
    expect(mapped.row.totalSupply).toBeNull();
    expect(mapped.row.absentFields).toEqual(expect.arrayContaining(['holder_count', 'total_supply']));
    expect(mapped.row.buyTax).not.toBeNull(); // and what it DID carry is read
    expect(unexpectedAbsences(mapped.row)).toEqual([]); // holder_count is now classified optional
  });

  /*
   * The shape check moved to the ENVELOPE, and the family check moved to positive evidence.
   *
   * The per-token field set has varied three times (14 fields, 29 fields, and a third with neither
   * tax field), so a guard on the union of per-token names is the weakest in the subsystem: with
   * every EVM field optional, one coincidentally-matching key would pass it. The envelope — numeric
   * `code`, string `message`, `result` object-or-null — has not varied once across every fixture
   * and both families.
   */
  describe('the envelope is what identifies the API', () => {
    it('accepts every real response we hold — the positive control', () => {
      for (const [body, family] of [[SOLANA, 'solana'], [EVM, 'evm'], [EVM_VARIABLE, 'evm']] as const) {
        expect(() => assertEnvelope(JSON.parse(body), family)).not.toThrow();
      }
    });

    it.each([
      ['a non-object body', '"just a string"'],
      ['no code', '{"message":"ok","result":{}}'],
      ['a non-numeric code', '{"code":"1","message":"ok","result":{}}'],
      ['no message', '{"code":1,"result":{}}'],
      ['a result that is an array', '{"code":1,"message":"ok","result":[]}'],
      ['an empty object', '{}'],
    ])('throws on %s', (_label, body) => {
      expect(() => mapTokenSecurity(body, 'evm')).toThrow(/not a GoPlus envelope/);
    });

    it('names what was wrong, so the next reader does not have to guess', () => {
      expect(() => assertEnvelope({ code: '1', message: 2, result: [] }, 'evm'))
        .toThrow(/code is a string.*message is a number.*result is an array/s);
    });

    it('accepts result: null, which is a real answer and not a broken envelope', () => {
      expect(() => assertEnvelope({ code: 1, message: 'ok', result: null }, 'solana')).not.toThrow();
    });
  });

  describe('the family check fires on POSITIVE evidence only', () => {
    it('throws when the other family s markers are there and ours are not', () => {
      expect(() => mapTokenSecurity(SOLANA, 'evm')).toThrow(/asked for evm and got a solana token/);
      expect(() => mapTokenSecurity(EVM, 'solana')).toThrow(/asked for solana and got a evm token/);
    });

    it('does NOT throw on a sparse token carrying neither family s markers', () => {
      // the change that matters: with every EVM field optional, a genuine token answering with only
      // is_honeypot and total_supply has no distinctive field, and throwing on it would discard a
      // real answer — the failure this subsystem spent the day correcting
      expect(() => assertNotTheOtherFamily({ total_supply: '1', is_honeypot: '0' }, 'evm')).not.toThrow();
      const body = JSON.stringify({
        code: 1, message: 'ok', result: { '0xabc': { total_supply: '1', is_honeypot: '0' } },
      });
      const mapped = mapTokenSecurity(body, 'evm')!;
      expect(mapped.row.totalSupply).toBe(1);
      expect(mapped.row.absentFields).toContain('buy_tax'); // recorded, not raised
    });

    it('does not throw when our own markers are present, whatever else is', () => {
      expect(() => assertNotTheOtherFamily({ buy_tax: '', mintable: {} }, 'evm')).not.toThrow();
    });
  });

  it('an error object wearing a 200 throws on the ENVELOPE, before any token is read', () => {
    expect(() => mapTokenSecurity('{"result":{"0xabc":{"code":4011}}}', 'evm'))
      .toThrow(/not a GoPlus envelope/);
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
      // every EVM field is optional now; the tax pair was falsified by the 24-hour run itself
      expect(optional('evm')).toEqual([
        'is_open_source', 'cannot_buy', 'buy_tax', 'sell_tax', 'holder_count', 'total_supply',
      ]);
      expect(ALWAYS_PRESENT.evm).toEqual([]);
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
