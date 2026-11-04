import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Options } from 'pino-http';

/**
 * IB-BUG-031 (P1, security) — what the request log may hold.
 *
 * Until this, pino-http logged every request's headers as they came, so the box's docker logs held
 * the `ib_session` cookie of every member who made a request: a 30-day sign-in for anyone who ran
 * `docker compose logs`. **The log keeps the request's shape (method, path, status, timing, agent),
 * never a credential:**
 *
 * - `Cookie` and `Authorization` request headers, and a response's `Set-Cookie` (login, logout-all),
 *   are replaced by `[Redacted]`;
 * - a token in the URL is removed from both `req.url` and `req.query`. Today that is `?t=`, the
 *   one-time set-password link, which arrives twice: as the page `/set-password?t=…` (the SPA
 *   fallback, the link a member taps in Telegram) and as `GET /api/web/auth/credentials?t=…`.
 *   `token` is listed too, so a future route that names it plainly is covered without an edit here.
 *
 * Bodies are never logged (pino-http does not serialise them), so `POST /login`'s password and
 * `POST /credentials`' token stay out; the spec pins that as well.
 *
 * **Adding a route that carries a secret in its query? Add the parameter to `SECRET_QUERY_PARAMS`.**
 * The spec (test/ops/http-log.spec.ts) boots the real options and fails if a value reaches a line.
 */
export const SECRET_QUERY_PARAMS = ['t', 'token'] as const;

export const REDACTED = '[Redacted]';

export const REDACT_PATHS: readonly string[] = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  ...SECRET_QUERY_PARAMS.map((p) => `req.query.${p}`),
];

/** `url` with every secret query parameter's value replaced. Pure; leaves anything unparsable as a path only. */
export function scrubUrl(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const [path, rest] = [url.slice(0, q), url.slice(q + 1)];
  const hash = rest.indexOf('#');
  const query = hash < 0 ? rest : rest.slice(0, hash);
  const parts = query.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    let key: string;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    } catch {
      return `${rawKey}=${REDACTED}`; // undecodable: say nothing about it
    }
    return (SECRET_QUERY_PARAMS as readonly string[]).includes(key) ? `${rawKey}=${REDACTED}` : pair;
  });
  return `${path}?${parts.join('&')}`; // the fragment never reaches a server; drop it rather than echo it
}

/** pino-http options for the app's request log. `level`/`pretty` from config; the rest is fixed policy. */
export function httpLogOptions(level: string, pretty: boolean): Options<IncomingMessage> {
  return {
    level,
    autoLogging: true,
    transport: pretty ? { target: 'pino-pretty' } : undefined,
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    serializers: {
      // runs on pino-http's serialised request (a plain object), before `redact`
      req: (req: { url?: string }) => {
        if (typeof req.url === 'string') req.url = scrubUrl(req.url);
        return req;
      },
    },
  };
}

/**
 * `LoggerModule.forRootAsync`'s options. OpsModule calls exactly this; the spec calls it with a
 * capture stream as the only difference.
 */
export function loggerModuleParams(level: string, nodeEnv: string | undefined, stream?: NodeJS.WritableStream): Params {
  const options = httpLogOptions(level, nodeEnv === 'development' && stream === undefined);
  return { pinoHttp: stream ? [options, stream as never] : options };
}
