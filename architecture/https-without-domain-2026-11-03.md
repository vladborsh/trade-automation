# https without a domain — design and re-scope (2026-11-03)

**Author:** Architect (insight-bot stream) · **Input:** user rulings 2026-11-03 via the coordinator
(`reports/coordinator-no-domain-no-archive-2026-11-03.md`): no domain for now ("reach it by IP"),
the archive is dropped, VAPID later. · **Amends:** `member-access-design-2026-10-31.md` M4 (tunnel),
M9 (VAPID), §5; `password-login-design-2026-11-02.md` P8 (client IP); `storage-ruling-2026-11-03.md`
S7 (`/metrics`). · **Output:** IB-082 (new), IB-073/074/077/078 and WD-011 notes, IB-076 cancelled.

## 1. The shape

```
phone / laptop ──https──▶ <a-b-c-d>.sslip.io  (resolves to the Elastic IP a.b.c.d)
  EC2 t4g.micro, security group: 80 + 443 in (IPv4), nothing else
    ├─ caddy        :80/:443  automatic Let's Encrypt cert for the sslip.io name,
    │                         reverse_proxy → insight-bot:3005, sets X-Real-IP, 404 on /metrics
    ├─ insight-bot  :3005     not published; reachable only on the compose network
    ├─ postgres
    └─ cloudflared            kept, but behind compose profile `tunnel`: does not start
```

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| H1 | **https on an IP-derived hostname: Elastic IP + `<ip-with-dashes>.sslip.io` + Caddy with automatic certificates.** | Plain http is ruled out by three things at once: the password would cross the network in clear, the `Secure` session cookie would be dropped so login would not work at all, and push needs https. The alternatives fail on members. A Cloudflare quick tunnel changes its URL on every restart, so every bot link, saved bookmark and session cookie dies with it. An owner-only SSM port-forward does not let a member in at all. sslip.io needs no account and no setup. Caddy obtains and renews the certificate itself. |
| H2 | **An Elastic IP, not the instance's auto-assigned address.** | The hostname *is* the IP. An auto-assigned IPv4 changes on every stop/start, which would change the site address and invalidate every link and cookie. An EIP attached to a running instance is billed as the one public IPv4 the plan already pays for (§4), so stability costs nothing extra. |
| H3 | **Security group opens TCP 80 and 443 from `0.0.0.0/0`, IPv4 only. No SSH, and 3005 is never published.** Access for the operator stays SSM. | 443 serves the site. 80 serves the ACME HTTP-01 challenge and the redirect to https. The app port stays on the compose network, so Caddy is the only door. |
| H4 | **The hostname is computed by OpenTofu, not typed by hand.** `site_hostname = "${replace(eip, ".", "-")}.sslip.io"`. Tofu writes two plain (non-secret) SSM parameters, `/insight-bot/SITE_ADDRESS` and `/insight-bot/WEB_BASE_URL = https://<site_hostname>`, which `render-env.sh` already renders. | The owner has nothing to copy. The address cannot drift from the IP it names. |
| H5 | **Caddy's certificate state lives on a named volume (`caddy_data`).** | Without it every container restart requests a new certificate. That is the fast way into the issuer's rate limits, and once in, the site is down for days. |
| H6 | **Client IP: `CLIENT_IP_HEADER` replaces `TRUST_CF_CONNECTING_IP`** (password-login P8). Unset (the default, every dev slot): the socket address. On the box: `x-real-ip`, which Caddy *overwrites* (`header_up X-Real-IP {remote_host}`), so a client cannot forge it. Should the tunnel ever come back, the value becomes `cf-connecting-ip`. | Same rule as P8, with the header name configurable instead of fixed. IB-078 has not merged a line of this yet (its branch holds only parked contracts), so the change costs nothing. |
| H7 | **`/metrics` is closed at both layers.** Caddy answers 404 on `/metrics`. The app (WD-011) answers 404 to a request carrying the configured `CLIENT_IP_HEADER`. This replaces S7's "carries `CF-Connecting-IP`". | Two layers, because either one alone breaks silently the day someone edits it. `/healthz` stays reachable (`{status}` only). |
| H8 | **(Superseded by H8′.)** **The ports open only when the deployed image has IB-078 and WD-011.** The box (IB-073) comes up and collects with the egress-only security group. The 80/443 rules are applied last. | Until WD-011, the ops `/health` serves collector internals. Until IB-078, the only login is the old link. Neither should face the internet. |
| H8′ | **Amended 2026-11-03 (user ruling, `reports/coordinator-open-ports-2026-11-03.md`): the ports open as soon as IB-082 is done, without waiting for IB-078.** Until IB-078 ships, people log in with the bot's one-time `/web` link. H8's concern is closed **at Caddy, inside IB-082**: (a) `respond /metrics 404`; (b) the exact path `/health` is **rewritten internally to `/`**, so the SPA fallback serves `index.html` and the dashboard's admin Health page still works on reload. The ops JSON (streams, Binance weight, noSpot) is never reachable from outside. This beats a plain 404, which would also break the admin page; (c) `/healthz` passes: once WD-011 lands it is `{status}` only, and before that the SPA fallback answers it with `index.html`, which is harmless. Both Caddy rules stay after WD-011 as the outer layer (H7). Still required: `WEB_COOKIE_SECURE=true`, `WEB_BASE_URL=https://<a-b-c-d>.sslip.io` (so the `/web` link is https), SG 80/443 only (H3). IB-072's widget is not gated on: leave it if it works, hide it if it needs a `/setdomain` that fails. IB-078 deletes it anyway. | The user accepted link-only login for the gap. What made H8 a gate (ops internals facing the internet) is now closed by the proxy, without waiting for app code. |
| H9 | **IB-074's tunnel code stays dormant, not deleted.** The `cloudflared` service moves behind compose profile `tunnel`, so `docker compose up` does not start it. That also ends a crash-loop on an empty token. `render-env.sh`'s token handling and the RUNBOOK §11 domain steps stay, marked "later, when there is a domain". | A domain is "not now", not "never" (ruling 1). Keeping the code is free. Deleting it means rewriting and re-reviewing it later. |
| H10 | **Push is out of priority-1 acceptance** (ruling 3). The code (IB-069) stays. It would work over this https as soon as VAPID keys are in SSM. | Nothing to build. Only the acceptance step goes. |
| H11 | **No seeded history.** IB-076 is cancelled (ruling 2). The box's liquidation, OI/LS and calendar history starts the day it starts collecting. `insight_coord` is not migrated. | The user ruled it. I found no cheap reason to override: a few local days of tape do not make the "× norm" figure honest, and the health page already says "not recorded" for time before the collector existed (WD-009's `liquidationUptime`). |

## 3. Risks, stated

- **sslip.io is a third party in the DNS path.** If its DNS stops answering, the name stops
  resolving and the site is unreachable by name, even though the box is fine. The certificate is for
  the name, so typing the bare IP gives a certificate warning, not a way in. This is accepted for an
  owner-plus-few-members phase. The exit is a domain (§5).
- **Certificate issuance for a shared parent domain.** Many people request certificates under
  sslip.io. If the issuer counts them together, an issuance can be refused for a while. I have not
  checked whether sslip.io is treated as its own registrable domain, so treat this as unverified.
  Mitigations: Caddy's defaults fall back to a second ACME issuer (ZeroSSL), and H5 means issuance is
  needed once per ~60 days, not per restart. IB-082 records which issuer actually signed the
  certificate.
- **An open 443 on a bare IP gets scanned.** The surface is: the SPA, `/api/web/*` behind session
  auth, the login with its per-login and per-IP throttle (IB-078, now keyed on the real IP via H6),
  and `/healthz` returning `{status}` only.
- **Worth checking, not verified:** Let's Encrypt has announced short-lived certificates for bare IP
  addresses. If Caddy can obtain one, `https://<ip>` would need no sslip.io at all. IB-082 may probe
  this as a note. It does not change the design.

## 4. Cost (re-check prices in the calculator; per COST-PLAN.md's method)

| Line | USD/month |
|---|---|
| t4g.micro | 7.88 |
| gp3 **50 GB** (owner ruling 2026-11-02) | 4.80 |
| Public IPv4 = the Elastic IP, attached | 3.65 (already in the plan; **+0**) |
| S3 backups + requests | ~0.16 |
| Domain | ~~0.85~~ dropped |
| **Total** | **≈ 16.5**, under the 18 USD alert and the 20 cap |

A stopped instance still pays 3.65 for its idle EIP. Releasing the EIP changes the address (H2), so
do not release it to save money.

## 5. Swapping in a real domain later

1. Buy the domain and point an A record at the same EIP (or bring back the tunnel: `--profile tunnel`
   and close 80/443).
2. Change two SSM parameters (`SITE_ADDRESS`, `WEB_BASE_URL`) and redeploy. Caddy fetches a
   certificate for the new name by itself.
3. Cost to members: sessions are bound to the old host, so everyone logs in once more, and bot links
   issued before the switch point at the old name. Credentials are unaffected.

That is about an hour of work, with no code change.

## 6. Tasks

- **IB-082** (new): EIP + security group + SSM parameters in tofu, Caddy in compose, `cloudflared`
  behind a profile, RUNBOOK. Rehearsed locally with `tls internal`. Ports opened last (H8). Depends
  on IB-073.
- **IB-073** note: 50 GB disk. Security group stays egress-only here. No CF/VAPID parameters needed.
- **IB-074** note: dormant per H9 (IB-082 does the profile move).
- **IB-076**: cancelled (status is the Tech Lead's).
- **IB-077**: address `https://<a-b-c-d>.sslip.io`, no push step, no seeded tape, IP from
  `X-Real-IP`. Depends on IB-082 instead of IB-074.
- **IB-078** note: H6 (`CLIENT_IP_HEADER`).
- **WD-011** note: H7.
