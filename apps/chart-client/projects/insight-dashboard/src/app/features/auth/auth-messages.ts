import type { WebLoginOutcome } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
import type { LoginProblem, PasswordProblem } from './auth-rules';

/**
 * IB-079 — which sentence each failure gets, as pure functions (the pages only render the key).
 * `status` 0 means the request never got an answer (network), the way the pages report a throw that
 * is not an `ApiError`.
 */
export interface Message {
  key: StringKey;
  params?: Record<string, string | number>;
}

const failed = (status: number): Message =>
  status === 0 ? { key: 'login.unreachable' } : { key: 'auth.failed', params: { status } };

/** /login: one sentence for an unknown login, a wrong password and a disabled account alike. */
export function loginFailure(status: number): Message {
  if (status === 401) return { key: 'login.wrong' };
  if (status === 429) return { key: 'login.tooMany' };
  return failed(status);
}

/** /set-password: a dead link, a taken login (the link still works), or the server's 422. */
export function setPasswordFailure(status: number, code: string | null): Message {
  if (status === 401 || status === 410) return { key: 'setPassword.linkDead' };
  if (status === 409) return { key: 'setPassword.loginTaken' };
  if (status === 422 && code === 'BAD_LOGIN') return { key: 'rule.loginBad' };
  if (status === 422) return { key: 'rule.weak' };
  return failed(status);
}

/** /account: a wrong current password is not a lost session — it says so and stays on the page. */
export function changePasswordFailure(status: number): Message {
  if (status === 401) return { key: 'account.wrongCurrent' };
  if (status === 429) return { key: 'login.tooMany' };
  if (status === 422) return { key: 'rule.weak' };
  return failed(status);
}

export function ruleMessage(problem: LoginProblem | PasswordProblem): Message {
  switch (problem) {
    case 'login.bad': return { key: 'rule.loginBad' };
    case 'password.short': return { key: 'rule.passwordShort', params: { min: 10 } };
    case 'password.long': return { key: 'rule.passwordLong', params: { max: 128 } };
    case 'password.sameAsLogin': return { key: 'rule.sameAsLogin' };
    case 'password.mismatch': return { key: 'rule.mismatch' };
  }
}

/** The journal's outcome is a sentence to a reader (identifier-or-sentence), so it is translated. */
export function outcomeKey(outcome: WebLoginOutcome): StringKey {
  return `logins.outcome.${outcome}` as StringKey;
}
