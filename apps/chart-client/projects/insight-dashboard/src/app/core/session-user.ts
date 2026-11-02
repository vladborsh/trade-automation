import { WebMeResponseSchema, type WebUser } from '@trade-automation/contracts';

/**
 * IB-075 — the signed-in member as the dashboard knows it: whatever `/auth/me` returned, validated
 * against the contract. Anything else (no session, a proxy page, an older server) is `null`, which
 * every caller treats as "not an admin" — the safe reading for a gate.
 */
export function sessionUser(body: unknown): WebUser | null {
  const parsed = WebMeResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.user : null;
}

/** Only an `admin` sees the operator surface (member-access design M8). */
export function isAdmin(user: WebUser | null): boolean {
  return user?.role === 'admin';
}
