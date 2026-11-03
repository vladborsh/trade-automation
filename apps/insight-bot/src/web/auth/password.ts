import { randomBytes, scrypt, timingSafeEqual } from 'crypto';

/**
 * IB-078 P5 — scrypt `N=2^15, r=8, p=1`, 16-byte salt, on Node's built-in `crypto.scrypt` (no native
 * module to build for linux/arm64). The stored string is self-describing, `scrypt$N$r$p$salt$hash`
 * (salt and hash base64url), so the cost can be raised later: `verify` always uses the parameters
 * recorded in the hash, never the current defaults.
 *
 * **COPIED from `apps/signal-server/src/auth/password.ts`, not imported** (the design's rule: the two
 * apps share no runtime code). The one addition is `ScryptGate`.
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

/**
 * P5's memory guard for the 1 GB box: one scrypt at these parameters takes 32 MiB, so at most
 * `limit` (2) run at once and the rest WAIT in arrival order — never refused, never more than
 * ~64 MiB of scrypt in flight however many logins arrive together.
 */
export class ScryptGate {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly limit = 2) {}

  get active(): number {
    return this.running;
  }

  get queued(): number {
    return this.waiting.length;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.running += 1;
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // the slot passes straight to the next waiter; `running` is unchanged
      else this.running -= 1;
    }
  }
}

export type Derive = (password: string, salt: Buffer, params: ScryptParams, keyLength: number) => Promise<Buffer>;

const scryptDerive: Derive = (password, salt, params, keyLength) =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { ...params, maxmem: maxmemFor(params) }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });

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
  constructor(
    private readonly params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
    private readonly gate: ScryptGate = new ScryptGate(2),
    private readonly derive: Derive = scryptDerive,
  ) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await this.gate.run(() => this.derive(password, salt, this.params, KEY_BYTES));
    const { N, r, p } = this.params;
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
  }

  /** Constant-time comparison; a malformed stored hash verifies as false. */
  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parsePasswordHash(stored);
    if (!parsed) return false;
    const key = await this.gate.run(() => this.derive(password, parsed.salt, parsed.params, parsed.hash.length));
    return timingSafeEqual(key, parsed.hash);
  }
}
