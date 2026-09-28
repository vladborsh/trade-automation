import { randomBytes } from 'crypto';

/**
 * IB-021 — the invite code in a `t.me/<bot>?start=<code>` deep link (design §3.5).
 *
 * Telegram's `start` payload allows `A-Za-z0-9_-` and at most 64 characters. The alphabet below
 * drops the characters that are misread when a link is retyped or read aloud (`0`/`O`, `1`/`l`/`I`),
 * which matters because these are handed over by a person.
 *
 * **It must be unguessable**: the code is the only thing between a stranger and membership, so it
 * comes from `crypto.randomBytes`, never `Math.random`. 16 characters of a 32-symbol alphabet is
 * 80 bits.
 */

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const CODE_LENGTH = 16;

export function generateInviteCode(length = CODE_LENGTH): string {
  // rejection-free: 31 does not divide 256, so modulo would bias slightly; take 5 bits at a time
  // from a generous buffer instead and skip values outside the alphabet's range
  const out: string[] = [];
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      const index = byte & 0x1f; // 0..31
      if (index >= ALPHABET.length) continue; // 31 → skipped, keeping the distribution flat
      out.push(ALPHABET[index]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

/** Telegram's own limits, plus ours: anything else cannot be a code we issued. */
export function isWellFormedCode(code: string): boolean {
  return new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(code);
}

export function inviteLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${code}`;
}
