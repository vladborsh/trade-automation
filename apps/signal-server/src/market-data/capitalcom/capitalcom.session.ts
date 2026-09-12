import { Logger } from '@nestjs/common';

export interface CapComSessionKeys {
  cst: string;
  securityToken: string;
}

// Capital.com session tokens are valid ~10 minutes; renew a little before that, mirroring
// cmc-bot-main's CapitalComSession.SESSION_LIFETIME_MINUTES = 9.
const SESSION_LIFETIME_MS = 9 * 60_000;

/**
 * architecture/live-signal-server.md §4.1: "Requires session auth (identifier + password +
 * X-CAP-API-KEY, session tokens valid ~10 min -> renew on a timer, as the bot does)."
 * Ported from cmc-bot-main's `CapitalComSession` — untested against live credentials in this
 * build environment; see README "Capital.com adapter" section.
 */
export class CapitalComSession {
  private readonly logger = new Logger(CapitalComSession.name);
  private keys: CapComSessionKeys | null = null;
  private sessionStartedAt = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly identifier: string,
    private readonly password: string,
    private readonly apiKey: string,
  ) {}

  async renew(): Promise<void> {
    const res = await fetch(new URL('/api/v1/session', this.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CAP-API-KEY': this.apiKey,
      },
      body: JSON.stringify({ identifier: this.identifier, password: this.password }),
    });
    if (!res.ok) {
      throw new Error(`Capital.com session request failed: ${res.status} ${res.statusText}`);
    }
    const cst = res.headers.get('cst');
    const securityToken = res.headers.get('x-security-token');
    if (!cst || !securityToken) {
      throw new Error('Capital.com session response missing CST/X-SECURITY-TOKEN headers');
    }
    this.keys = { cst, securityToken };
    this.sessionStartedAt = Date.now();
    this.logger.log('Capital.com session renewed');
  }

  async ensureFresh(): Promise<CapComSessionKeys> {
    const expired = !this.keys || Date.now() - this.sessionStartedAt >= SESSION_LIFETIME_MS;
    if (expired) {
      await this.renew();
    }
    return this.keys!;
  }

  async authHeaders(): Promise<Record<string, string>> {
    const keys = await this.ensureFresh();
    return { CST: keys.cst, 'X-SECURITY-TOKEN': keys.securityToken };
  }
}
