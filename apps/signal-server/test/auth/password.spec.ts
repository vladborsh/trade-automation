import { DEFAULT_SCRYPT_PARAMS, PasswordHasher, parsePasswordHash } from '../../src/auth/password';

describe('PasswordHasher (backtest-app-system-design.md §7.1, D7)', () => {
  const hasher = new PasswordHasher();

  it('uses scrypt N=2^15, r=8, p=1 by default', () => {
    expect(DEFAULT_SCRYPT_PARAMS).toEqual({ N: 32768, r: 8, p: 1 });
  });

  it('round-trips: a hash verifies against its password and not against another', async () => {
    const stored = await hasher.hash('correct horse battery');
    await expect(hasher.verify('correct horse battery', stored)).resolves.toBe(true);
    await expect(hasher.verify('correct horse batterx', stored)).resolves.toBe(false);
    await expect(hasher.verify('', stored)).resolves.toBe(false);
  });

  it('writes a self-describing scrypt$N$r$p$salt$hash string with a 16-byte salt', async () => {
    const stored = await hasher.hash('some password');
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    const parsed = parsePasswordHash(stored)!;
    expect(parsed.params).toEqual({ N: 32768, r: 8, p: 1 });
    expect(parsed.salt).toHaveLength(16);
    expect(parsed.hash).toHaveLength(32);
  });

  it('salts every hash: the same password hashes differently twice', async () => {
    const [a, b] = await Promise.all([hasher.hash('same password'), hasher.hash('same password')]);
    expect(a).not.toBe(b);
  });

  it('verifies with the parameters recorded in the hash, not the current defaults', async () => {
    const stored = await new PasswordHasher({ N: 1024, r: 8, p: 1 }).hash('legacy password');
    await expect(hasher.verify('legacy password', stored)).resolves.toBe(true);
  });

  it.each([
    ['empty', ''],
    ['wrong scheme', 'bcrypt$32768$8$1$c2FsdA$aGFzaA'],
    ['too few parts', 'scrypt$32768$8$1$c2FsdA'],
    ['N not a power of two', 'scrypt$1000$8$1$c2FsdA$aGFzaA'],
    ['non-numeric r', 'scrypt$32768$x$1$c2FsdA$aGFzaA'],
    ['empty salt', 'scrypt$32768$8$1$$aGFzaA'],
  ])('treats a malformed stored hash (%s) as not matching, without throwing', async (_label, stored) => {
    expect(parsePasswordHash(stored)).toBeNull();
    await expect(hasher.verify('anything', stored)).resolves.toBe(false);
  });
});
