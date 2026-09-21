import {
  AcceptInviteRequestSchema,
  AdminInviteSchema,
  AdminUserSchema,
  CreateInviteRequestSchema,
  InviteInfoSchema,
  LoginRequestSchema,
  UserSchema,
} from '../src';

describe('auth contracts (architecture/backtest-app-system-design.md §7.1)', () => {
  it('parses a valid LoginRequest', () => {
    const req = { email: 'trader@example.com', password: 'hunter2long' };
    expect(LoginRequestSchema.parse(req)).toEqual(req);
  });

  it('rejects a LoginRequest with a malformed email', () => {
    expect(() => LoginRequestSchema.parse({ email: 'not-an-email', password: 'x' })).toThrow();
  });

  it('parses a valid User', () => {
    const user = { id: '11111111-1111-1111-1111-111111111111', email: 'trader@example.com', role: 'user' as const };
    expect(UserSchema.parse(user)).toEqual(user);
  });

  it('rejects a User with an unknown role', () => {
    expect(() =>
      UserSchema.parse({ id: '11111111-1111-1111-1111-111111111111', email: 't@example.com', role: 'superadmin' }),
    ).toThrow();
  });

  it('parses InviteInfo with a null email pre-fill', () => {
    const info = { email: null, expiresAt: 1_726_000_000_000 };
    expect(InviteInfoSchema.parse(info)).toEqual(info);
  });

  it('rejects InviteInfo missing expiresAt', () => {
    expect(() => InviteInfoSchema.parse({ email: null })).toThrow();
  });

  it('parses a valid AcceptInviteRequest (password >= 10 chars)', () => {
    const req = { email: 'new@example.com', password: '0123456789' };
    expect(AcceptInviteRequestSchema.parse(req)).toEqual(req);
  });

  it('rejects an AcceptInviteRequest with a too-short password', () => {
    expect(() => AcceptInviteRequestSchema.parse({ email: 'new@example.com', password: 'short' })).toThrow();
  });

  it('parses a valid CreateInviteRequest with no email', () => {
    expect(CreateInviteRequestSchema.parse({})).toEqual({});
  });

  it('rejects a CreateInviteRequest with a malformed email', () => {
    expect(() => CreateInviteRequestSchema.parse({ email: 'nope' })).toThrow();
  });

  it('parses a valid AdminUser row', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'trader@example.com',
      role: 'admin' as const,
      createdAt: 1_726_000_000_000,
      disabledAt: null,
    };
    expect(AdminUserSchema.parse(row)).toEqual(row);
  });

  it('rejects an AdminUser row with a non-integer createdAt', () => {
    expect(() =>
      AdminUserSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'trader@example.com',
        role: 'admin',
        createdAt: 1.5,
        disabledAt: null,
      }),
    ).toThrow();
  });

  it('parses a valid AdminInvite row', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      email: null,
      createdAt: 1_726_000_000_000,
      expiresAt: 1_726_600_000_000,
      usedAt: null,
      usedBy: null,
    };
    expect(AdminInviteSchema.parse(row)).toEqual(row);
  });

  it('rejects an AdminInvite row with a negative expiresAt', () => {
    expect(() =>
      AdminInviteSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        email: null,
        createdAt: 1_726_000_000_000,
        expiresAt: -1,
        usedAt: null,
        usedBy: null,
      }),
    ).toThrow();
  });
});
