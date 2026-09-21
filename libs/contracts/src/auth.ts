import { z } from 'zod';

/**
 * architecture/backtest-app-system-design.md §7.1 — auth/admin wire contracts. Password policy
 * (≥ 10 characters) is enforced only on the schemas that *set* a password (accept-invite);
 * login validates shape only — a login attempt with a short password still reaches the server
 * and fails with `INVALID_CREDENTIALS`, never a 422 that would leak which check failed first.
 */

export const UserRoleSchema = z.enum(['admin', 'user']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: UserRoleSchema,
});
export type User = z.infer<typeof UserSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({ user: UserSchema });
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const MeResponseSchema = z.object({ user: UserSchema });
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** GET /auth/invites/:token — §7.1. `email` is the optional pre-fill; null when not set. */
export const InviteInfoSchema = z.object({
  email: z.string().email().nullable(),
  expiresAt: z.number().int().nonnegative(),
});
export type InviteInfo = z.infer<typeof InviteInfoSchema>;

export const AcceptInviteRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
});
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequestSchema>;

export const AcceptInviteResponseSchema = z.object({ user: UserSchema });
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>;

/** GET /admin/users — §7.1. Never carries session data (decision 30). */
export const AdminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: UserRoleSchema,
  createdAt: z.number().int().nonnegative(),
  disabledAt: z.number().int().nonnegative().nullable(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUsersResponseSchema = z.array(AdminUserSchema);
export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>;

/** POST /admin/invites — §7.1. `email` pre-fills the invite; the token itself is never stored. */
export const CreateInviteRequestSchema = z.object({
  email: z.string().email().optional(),
});
export type CreateInviteRequest = z.infer<typeof CreateInviteRequestSchema>;

/** The invite URL/token is returned exactly once, on creation. */
export const CreateInviteResponseSchema = z.object({
  id: z.string().uuid(),
  url: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
});
export type CreateInviteResponse = z.infer<typeof CreateInviteResponseSchema>;

/** GET /admin/invites — §7.1. Never carries the token. */
export const AdminInviteSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  usedAt: z.number().int().nonnegative().nullable(),
  usedBy: z.string().uuid().nullable(),
});
export type AdminInvite = z.infer<typeof AdminInviteSchema>;

export const AdminInvitesResponseSchema = z.array(AdminInviteSchema);
export type AdminInvitesResponse = z.infer<typeof AdminInvitesResponseSchema>;
