import { DEFAULT_SCRYPT_PARAMS, parsePasswordHash, PasswordHasher, ScryptGate } from '../../../src/web/auth/password';
import { DUMMY_PASSWORD_HASH } from '../../../src/web/auth/credentials.service';

/** IB-078 P5. Real scrypt at a small N for speed; the production parameters are pinned separately. */
const FAST = { N: 1024, r: 8, p: 1 };

describe('PasswordHasher (P5, copied from signal-server)', () => {
  it('production parameters are N=2^15 r=8 p=1', () => {
    expect(DEFAULT_SCRYPT_PARAMS).toEqual({ N: 32768, r: 8, p: 1 });
  });

  it('hashes to scrypt$N$r$p$salt$hash and verifies only the right password', async () => {
    const h = new PasswordHasher(FAST);
    const stored = await h.hash('correct horse battery');
    expect(stored).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await h.verify('correct horse battery', stored)).toBe(true);
    expect(await h.verify('correct horse batterz', stored)).toBe(false);
  });

  it('salts: the same password twice gives two different strings', async () => {
    const h = new PasswordHasher(FAST);
    expect(await h.hash('same password!')).not.toBe(await h.hash('same password!'));
  });

  it('verifies with the parameters IN the hash, not the current defaults', async () => {
    const old = await new PasswordHasher(FAST).hash('rotate me please');
    expect(await new PasswordHasher({ N: 2048, r: 8, p: 1 }).verify('rotate me please', old)).toBe(true);
  });

  it('a malformed stored hash verifies false and never throws', async () => {
    const h = new PasswordHasher(FAST);
    for (const bad of ['', 'scrypt$1000$8$1$aa$bb', 'bcrypt$x', 'scrypt$1024$8$1$$']) expect(await h.verify('x', bad)).toBe(false);
  });

  it('the dummy hash for unknown logins is a well-formed production-cost hash', () => {
    expect(parsePasswordHash(DUMMY_PASSWORD_HASH)?.params).toEqual(DEFAULT_SCRYPT_PARAMS);
  });
});

describe('ScryptGate — at most 2 scrypt at once on the 1 GB box (P5)', () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
  };
  const tick = () => new Promise((r) => setImmediate(r));

  it('the third waits until one of the first two finishes, then runs', async () => {
    const gate = new ScryptGate(2);
    const started: number[] = [];
    const work = [deferred(), deferred(), deferred()];
    const runs = work.map((d, i) => gate.run(async () => { started.push(i); await d.promise; return i; }));
    await tick();

    expect(started).toEqual([0, 1]);
    expect(gate.active).toBe(2);
    expect(gate.queued).toBe(1);

    work[1].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]); // the freed slot went to the waiter
    expect(gate.active).toBe(2);

    work[0].resolve();
    work[2].resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2]);
    expect(gate.active).toBe(0);
  });

  it('a failing run frees its slot too', async () => {
    const gate = new ScryptGate(1);
    await expect(gate.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await gate.run(async () => 'next')).toBe('next');
    expect(gate.active).toBe(0);
  });

  it('the hasher really goes through the gate: with limit 1, two hashes never overlap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const derive = async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return Buffer.alloc(32, 1);
    };
    const h = new PasswordHasher(FAST, new ScryptGate(1), derive);
    await Promise.all([h.hash('aaaaaaaaaa'), h.hash('bbbbbbbbbb'), h.hash('cccccccccc')]);
    expect(maxInFlight).toBe(1);
  });
});
