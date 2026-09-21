import * as net from 'net';

/**
 * BUG-008 — a spec must never reach a network venue. Every outbound TCP connection (global
 * `fetch`/undici, `ws`, `pg`, http/https) goes through `net.Socket.prototype.connect`. Under the
 * test suite, a connection to anything but a loopback host fails the way a refused connection does
 * (an async 'error' on the socket) and is recorded, so a spec that swallows the error still fails:
 * see `test/setup-after-env.ts`. Unix sockets and loopback (supertest, the slot's Postgres) pass.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::', '::ffff:127.0.0.1']);
const GUARD = Symbol.for('trade-automation.network-guard');

interface GuardState {
  blocked: string[];
}

type Connect = (this: net.Socket, ...args: unknown[]) => net.Socket;

/** The host:port a `Socket#connect` call targets, or null for a Unix socket / pipe. */
function target(args: unknown[]): { host: string; port: unknown } | null {
  // net.connect() hands Socket#connect its normalized [options, callback] array.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first !== null && typeof first === 'object') {
    const o = first as { host?: string; port?: unknown; path?: string };
    if (o.path !== undefined) return null;
    return { host: o.host ?? 'localhost', port: o.port };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null; // a pipe path
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
}

/** Installs the guard once per worker process and returns its (process-wide) record. */
export function installNetworkGuard(): GuardState {
  const proto = net.Socket.prototype as net.Socket & { [GUARD]?: GuardState };
  if (proto[GUARD]) return proto[GUARD];
  const state: GuardState = { blocked: [] };
  const original = proto.connect as unknown as Connect;
  const guarded: Connect = function (this: net.Socket, ...args: unknown[]) {
    const t = target(args);
    if (t && !LOOPBACK.has(t.host)) {
      const where = `${t.host}:${String(t.port)}`;
      state.blocked.push(where);
      const err = Object.assign(new Error(`network-guard (test/network-guard.ts): a spec tried to connect to ${where}`), { code: 'ECONNREFUSED' });
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return original.apply(this, args);
  };
  (proto as unknown as { connect: Connect }).connect = guarded;
  Object.defineProperty(proto, GUARD, { value: state });
  return state;
}
