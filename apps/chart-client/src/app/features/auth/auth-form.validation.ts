/** §7.1 password policy — mirrors AcceptInviteRequestSchema's `min(10)` in libs/contracts. */
export const MIN_PASSWORD_LENGTH = 10;

// Deliberately loose: the server's zod `.email()` is the authority; this only catches typos
// early enough to spare a round trip.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LoginFields {
  email: string;
  password: string;
}

export interface SetPasswordFields {
  email: string;
  password: string;
  confirm: string;
}

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

/** Login checks shape only — password rules are never hinted at on the sign-in form (§7.1). */
export function validateLogin(fields: LoginFields): FieldErrors<LoginFields> {
  const errors: FieldErrors<LoginFields> = {};
  if (!EMAIL_SHAPE.test(fields.email.trim())) errors.email = 'Enter your email address.';
  if (fields.password.length === 0) errors.password = 'Enter your password.';
  return errors;
}

export function validateSetPassword(fields: SetPasswordFields): FieldErrors<SetPasswordFields> {
  const errors: FieldErrors<SetPasswordFields> = {};
  if (!EMAIL_SHAPE.test(fields.email.trim())) errors.email = 'Enter a valid email address.';
  if (fields.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (fields.confirm !== fields.password) errors.confirm = 'The passwords do not match.';
  return errors;
}

export function hasErrors<T>(errors: FieldErrors<T>): boolean {
  return Object.keys(errors).length > 0;
}
