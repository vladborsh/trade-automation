/**
 * IB-021 — the users and invites repository (design §3.5). SQL lives under a `pg/` directory,
 * per IB-004's rule.
 *
 * The one piece of real concurrency in this app is `consumeInvite`: two people can open the same
 * deep link at the same moment, and exactly one must become a member. That is done in a single
 * transaction with a conditional UPDATE, not with a read-then-write.
 */

import type { Db, DbHandle } from '../../db/db.port';
import type { Invite, Lang, User, UserRole } from '../user.model';

interface UserRow {
  id: number;
  tg_user_id: string;
  chat_id: string | null;
  role: UserRole;
  lang: Lang;
  deposit: string | null;
  risk_pct: number;
  daily_loss_limit_pct: number | null;
  dex_alerts: boolean;
  calendar_alerts: boolean;
  invited_by: number | null;
  disabled: boolean;
  created_at: Date;
}

// bigint comes back from pg as a string; Telegram ids are well inside Number.MAX_SAFE_INTEGER
const toUser = (r: UserRow): User => ({
  id: r.id,
  tgUserId: Number(r.tg_user_id),
  chatId: r.chat_id === null ? null : Number(r.chat_id),
  role: r.role,
  lang: r.lang,
  deposit: r.deposit === null ? null : Number(r.deposit),
  riskPct: Number(r.risk_pct),
  dailyLossLimitPct: r.daily_loss_limit_pct === null ? null : Number(r.daily_loss_limit_pct),
  dexAlerts: r.dex_alerts,
  calendarAlerts: r.calendar_alerts,
  invitedBy: r.invited_by,
  disabled: r.disabled,
  createdAt: new Date(r.created_at),
});

const COLUMNS = `id, tg_user_id, chat_id, role, lang, deposit, risk_pct, daily_loss_limit_pct,
                 dex_alerts, calendar_alerts, invited_by, disabled, created_at`;

export async function findByTgUserId(db: DbHandle, tgUserId: number): Promise<User | null> {
  const rows = await db.query<UserRow>(`select ${COLUMNS} from users where tg_user_id = $1`, [tgUserId]);
  return rows.length > 0 ? toUser(rows[0]) : null;
}

export async function listUsers(db: DbHandle): Promise<User[]> {
  const rows = await db.query<UserRow>(`select ${COLUMNS} from users order by created_at`);
  return rows.map(toUser);
}

/**
 * Creates the admin from `ADMIN_TG_USER_ID`, or promotes an existing row to admin. Idempotent:
 * it runs on every boot.
 */
export async function bootstrapAdmin(db: DbHandle, tgUserId: number): Promise<User> {
  const rows = await db.query<UserRow>(
    `insert into users (tg_user_id, role) values ($1, 'admin')
     on conflict (tg_user_id) do update set role = 'admin', disabled = false
     returning ${COLUMNS}`,
    [tgUserId],
  );
  return toUser(rows[0]);
}

/** Remembers where to send to; the chat id is only known once the person has written. */
export async function setChatId(db: DbHandle, userId: number, chatId: number): Promise<void> {
  await db.query('update users set chat_id = $2 where id = $1', [userId, chatId]);
}

export type SettingsPatch = Partial<Pick<User, 'deposit' | 'riskPct' | 'dailyLossLimitPct' | 'dexAlerts' | 'calendarAlerts' | 'lang'>>;

const SETTING_COLUMN: Record<keyof SettingsPatch, string> = {
  deposit: 'deposit',
  riskPct: 'risk_pct',
  dailyLossLimitPct: 'daily_loss_limit_pct',
  dexAlerts: 'dex_alerts',
  calendarAlerts: 'calendar_alerts',
  lang: 'lang',
};

export async function updateSettings(db: DbHandle, userId: number, patch: SettingsPatch): Promise<User | null> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as Array<[keyof SettingsPatch, unknown]>;
  if (entries.length === 0) return findByTgUserIdById(db, userId);

  const sets = entries.map(([key], i) => `${SETTING_COLUMN[key]} = $${i + 2}`);
  const rows = await db.query<UserRow>(
    `update users set ${sets.join(', ')} where id = $1 returning ${COLUMNS}`,
    [userId, ...entries.map(([, v]) => v)],
  );
  return rows.length > 0 ? toUser(rows[0]) : null;
}

async function findByTgUserIdById(db: DbHandle, id: number): Promise<User | null> {
  const rows = await db.query<UserRow>(`select ${COLUMNS} from users where id = $1`, [id]);
  return rows.length > 0 ? toUser(rows[0]) : null;
}

export async function createInvite(db: DbHandle, code: string, createdBy: number, expiresAt: Date): Promise<Invite> {
  const rows = await db.query<{ code: string; created_by: number; created_at: Date; expires_at: Date }>(
    `insert into invites (code, created_by, expires_at) values ($1, $2, $3)
     returning code, created_by, created_at, expires_at`,
    [code, createdBy, expiresAt],
  );
  const r = rows[0];
  return { code: r.code, createdBy: r.created_by, createdAt: new Date(r.created_at), expiresAt: new Date(r.expires_at), usedBy: null, usedAt: null };
}

export type ConsumeResult =
  | { kind: 'joined'; user: User }
  | { kind: 'already_member'; user: User }
  | { kind: 'refused' };

/**
 * Consumes a single-use invite and creates the member, in one transaction.
 *
 * The invite is claimed with `update ... where code = $1 and used_by is null and expires_at > now()`
 * and the row is only created if that update touched a row, so two people racing the same link
 * cannot both join — the loser gets the same refusal as a wrong code.
 *
 * Every failure mode returns the same `refused`: an outsider trying codes must not be able to
 * tell "expired" from "already used" from "never existed".
 */
export async function consumeInvite(db: Db, code: string, tgUserId: number, chatId: number, now: Date): Promise<ConsumeResult> {
  return db.transaction(async (tx) => {
    const existing = await findByTgUserId(tx, tgUserId);
    if (existing && !existing.disabled) {
      if (existing.chatId !== chatId) await setChatId(tx, existing.id, chatId);
      return { kind: 'already_member', user: existing };
    }

    const claimed = await tx.query<{ created_by: number }>(
      `update invites set used_at = $2
        where code = $1 and used_by is null and expires_at > $2
        returning created_by`,
      [code, now],
    );
    if (claimed.length === 0) return { kind: 'refused' };

    const created = await tx.query<UserRow>(
      `insert into users (tg_user_id, chat_id, role, invited_by) values ($1, $2, 'member', $3)
       on conflict (tg_user_id) do update set chat_id = excluded.chat_id, disabled = false
       returning ${COLUMNS}`,
      [tgUserId, chatId, claimed[0].created_by],
    );
    const user = toUser(created[0]);
    await tx.query('update invites set used_by = $2 where code = $1', [code, user.id]);
    return { kind: 'joined', user };
  });
}
