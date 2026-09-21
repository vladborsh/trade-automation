import { randomBytes, scrypt, timingSafeEqual } from 'crypto';

/**
 * architecture/backtest-app-system-design.md §7.1, D7 — scrypt `N=2^15, r=8, p=1`, 16-byte
 * salt, on Node's built-in `crypto.scrypt` (no native dependency). The stored string is
 * self-describing, `scrypt$N$r$p$salt$hash` with salt and hash base64url (§3 `users` comment),
 * so the cost parameters can be raised later without invalidating existing hashes: `verify`
 * always uses the parameters recorded in the hash, never the current defaults.
 */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** scrypt needs 128·N·r bytes; Node's default `maxmem` (32 MiB) is exactly that at N=2^15, r=8. */
function maxmemFor({ N, r }: ScryptParams): number {
  return 128 * N * r * 2;
}

function derive(password: string, salt: Buffer, params: ScryptParams, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { ...params, maxmem: maxmemFor(params) }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

interface ParsedHash {
  params: ScryptParams;
  salt: Buffer;
  hash: Buffer;
}

/** Parses `scrypt$N$r$p$salt$hash`; null on anything malformed (never throws). */
export function parsePasswordHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map((v) => Number(v));
  if (![N, r, p].every((v) => Number.isInteger(v) && v > 0)) return null;
  if (N < 2 || (N & (N - 1)) !== 0) return null; // scrypt requires N to be a power of two
  const salt = Buffer.from(parts[4], 'base64url');
  const hash = Buffer.from(parts[5], 'base64url');
  if (salt.length === 0 || hash.length === 0) return null;
  return { params: { N, r, p }, salt, hash };
}

export class PasswordHasher {
  constructor(private readonly params: ScryptParams = DEFAULT_SCRYPT_PARAMS) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, this.params, KEY_BYTES);
    const { N, r, p } = this.params;
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
  }

  /** Constant-time comparison; a malformed stored hash verifies as false. */
  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parsePasswordHash(stored);
    if (!parsed) return false;
    const key = await derive(password, parsed.salt, parsed.params, parsed.hash.length);
    return timingSafeEqual(key, parsed.hash);
  }
}
