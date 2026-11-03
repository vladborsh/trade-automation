import { WEB_LOGIN_OUTCOMES, WEB_PASSWORD_MAX, WEB_PASSWORD_MIN } from '@trade-automation/contracts';
import { en } from '../../i18n/en';
import { ru } from '../../i18n/ru';
import { changePasswordFailure, loginFailure, outcomeKey, ruleMessage, setPasswordFailure } from './auth-messages';

describe('auth-messages (IB-079)', () => {
  it('login: 401 is ONE sentence for every cause, 429 says when to retry, the rest keep the status', () => {
    expect(loginFailure(401)).toEqual({ key: 'login.wrong' });
    expect(loginFailure(429)).toEqual({ key: 'login.tooMany' });
    expect(loginFailure(500)).toEqual({ key: 'auth.failed', params: { status: 500 } });
    expect(loginFailure(0)).toEqual({ key: 'login.unreachable' });
    for (const t of [ru, en]) expect(t['login.tooMany']).toContain('15');
  });

  it('set-password: a dead link names /password; a taken login says the link still works', () => {
    expect(setPasswordFailure(401, 'TOKEN_INVALID').key).toBe('setPassword.linkDead');
    expect(setPasswordFailure(410, 'TOKEN_USED').key).toBe('setPassword.linkDead');
    expect(setPasswordFailure(410, 'TOKEN_EXPIRED').key).toBe('setPassword.linkDead');
    expect(setPasswordFailure(409, 'LOGIN_TAKEN').key).toBe('setPassword.loginTaken');
    expect(setPasswordFailure(422, 'BAD_LOGIN').key).toBe('rule.loginBad');
    expect(setPasswordFailure(422, 'WEAK_PASSWORD').key).toBe('rule.weak');
    for (const t of [ru, en]) expect(t['setPassword.linkDead']).toContain('/password');
  });

  it('account: a wrong current password is its own sentence', () => {
    expect(changePasswordFailure(401).key).toBe('account.wrongCurrent');
    expect(changePasswordFailure(429).key).toBe('login.tooMany');
  });

  it('the rule sentences carry the contract numbers', () => {
    expect(ruleMessage('password.short').params).toEqual({ min: WEB_PASSWORD_MIN });
    expect(ruleMessage('password.long').params).toEqual({ max: WEB_PASSWORD_MAX });
  });

  it('every journal outcome has a translated sentence in both tables', () => {
    for (const o of WEB_LOGIN_OUTCOMES) {
      for (const t of [ru, en]) expect(t[outcomeKey(o)]).toBeTruthy();
      expect(ru[outcomeKey(o)]).not.toBe(o); // translated, not the code
    }
  });
});
