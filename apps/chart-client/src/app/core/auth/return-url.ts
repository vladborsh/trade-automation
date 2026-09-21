/** Where an authenticated user lands when nothing else is asked for (§2.3: the default route). */
export const DEFAULT_AUTHED_URL = '/sessions';

/**
 * The `returnUrl` query parameter, accepted only as an in-app path: it must start with a single
 * `/` (so `//evil.example` and `https://…` cannot turn the login page into an open redirect)
 * and must not point back into the public auth pages.
 */
export function safeReturnUrl(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return DEFAULT_AUTHED_URL;
  }
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/invite/')) {
    return DEFAULT_AUTHED_URL;
  }
  return raw;
}
