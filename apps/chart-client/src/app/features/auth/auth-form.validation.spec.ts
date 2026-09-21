import { MIN_PASSWORD_LENGTH, hasErrors, validateLogin, validateSetPassword } from './auth-form.validation';

describe('validateLogin', () => {
  it('accepts any non-empty password with a plausible email', () => {
    expect(validateLogin({ email: ' admin@example.com ', password: 'x' })).toEqual({});
  });

  it('flags a missing email or password', () => {
    expect(validateLogin({ email: 'nope', password: '' })).toEqual({
      email: 'Enter your email address.',
      password: 'Enter your password.',
    });
  });
});

describe('validateSetPassword', () => {
  const good = { email: 'new@example.com', password: 'a'.repeat(MIN_PASSWORD_LENGTH), confirm: 'a'.repeat(MIN_PASSWORD_LENGTH) };

  it('accepts a ten-character password that matches its confirmation', () => {
    expect(validateSetPassword(good)).toEqual({});
  });

  it('enforces the §7.1 minimum length', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validateSetPassword({ ...good, password: short, confirm: short }).password).toBe('Use at least 10 characters.');
  });

  it('flags a mismatched confirmation and a bad email', () => {
    const errors = validateSetPassword({ email: 'a@b', password: good.password, confirm: 'different!!' });
    expect(errors.email).toBeDefined();
    expect(errors.confirm).toBe('The passwords do not match.');
  });
});

describe('hasErrors', () => {
  it('is true only when some field has a message', () => {
    expect(hasErrors({})).toBe(false);
    expect(hasErrors({ email: 'x' })).toBe(true);
  });
});
