import { loginFailureMessage } from './login.component';

/**
 * The failure sentences a member actually sees. IB-029 defines the codes; each one is reachable by
 * an ordinary mistake (forwarding the link, opening it twice, letting it sit for 10 minutes), so
 * each gets its own sentence with the way out in it.
 *
 * Branching is on the server's `code`, not the status: `TOKEN_USED` and `TOKEN_EXPIRED` are both
 * HTTP 410 and mean different things to the person holding the link.
 */
describe('loginFailureMessage', () => {
  it('tells an invalid link apart from a used one and an expired one — all three differ', () => {
    expect(loginFailureMessage('TOKEN_INVALID', 401)).toContain('not valid');
    expect(loginFailureMessage('TOKEN_USED', 410)).toContain('already been used');
    expect(loginFailureMessage('TOKEN_EXPIRED', 410)).toContain('expired');
    // the two 410s must not collapse into one sentence
    expect(loginFailureMessage('TOKEN_USED', 410)).not.toBe(loginFailureMessage('TOKEN_EXPIRED', 410));
  });

  it('always names the way out — /web is how a member recovers', () => {
    for (const code of ['TOKEN_INVALID', 'TOKEN_USED', 'TOKEN_EXPIRED']) {
      expect(loginFailureMessage(code, 410)).toContain('/web');
    }
  });

  it('falls back to the status rather than inventing a cause when no code arrives', () => {
    expect(loginFailureMessage(null, 500)).toBe('Sign-in failed (HTTP 500).');
    expect(loginFailureMessage(undefined, 502)).toBe('Sign-in failed (HTTP 502).');
  });
});
