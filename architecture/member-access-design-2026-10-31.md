# Member access — design and decomposition (2026-10-31)

**Author:** Architect (insight-bot stream) · **Input:** `architecture/member-access-2026-10-31.md`
(brief, commit 839af12) · **Output:** re-scoped `tasks/wind-down.jsonl`, new tasks IB-072…IB-077 in
`tasks/insight-bot.jsonl`. This note supersedes `insight-bot-web-dashboard.md` W4 and §6 (the
"no domain" ruling); §5 there (tunnel with a domain) becomes the design again, with the deltas
below.

> **Amended 2026-11-02:** login is now login + password only (user ruling). M1–M3 and the
> "two ways in" below are withdrawn: see `password-login-design-2026-11-02.md`. The `/web` link and
> the Telegram widget are no longer ways into the site.
>
> **Amended 2026-11-03:** the owner ruled that the box stores what venues forget: liquidations,
> **open interest + long/short (the OI/LS poller stays)** and the calendar. Funding stays on demand.
> §3's "dropped" list no longer includes the OI/LS poller and its two tables. See
> `storage-ruling-2026-11-03.md`.
>
> **Amended 2026-11-03 (no domain):** reached at `https://<ip>.sslip.io` through Caddy on an
> Elastic IP with 80/443 open; the tunnel (M4) is dormant, VAPID (M9) later, IB-076 cancelled. See
> `https-without-domain-2026-11-03.md`.
>
> **Amended 2026-11-03 (ECR):** M6's "GHCR image" → a private ECR repository pulled by the instance
> role; see `ecr-image-2026-11-03.md`.

## 1. What is being built

One box, one origin, two ways in:

```
phone / laptop ──https──▶ Cloudflare (user's domain, TLS) ──tunnel (outbound only)──▶
  EC2 t4g.micro, ap-northeast-1, no inbound port
    ├─ cloudflared        (token from SSM /insight-bot/CF_TUNNEL_TOKEN)
    ├─ insight-bot :3005  (API /api/web/*, dashboard bundle, bot long-polling,
    │                      liquidation websockets, calendar, web push)
    └─ postgres 16        (users/auth/push/calendar + the liquidation tape)
```

Login, both ending in the **same** `ib_session` cookie and the same `web_sessions` row:

1. **Link from the bot (exists, IB-029).** `/web` → `https://<domain>/login?t=…` → exchange.
2. **Log in with Telegram (new, IB-072).** Telegram Login Widget on `/login` → the widget's signed
   payload → `POST /api/web/auth/telegram` → server verifies → cookie.

Identity is `users.tg_user_id` in both paths. There is no second user base, no password, no
e-mail.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| M1 | **The widget logs in existing members only.** Unknown `tg_user_id` → 403 `NOT_A_MEMBER`; disabled → the same 401 `TOKEN_INVALID` the link path gives (a revoked person does not learn the account exists). The widget never creates a `users` row. | Membership is granted by `/invite` + `/start` in the bot, which is also where `chat_id` comes from (the widget does not give one, and the bot cannot message a person who never pressed Start). One place grants access; that is the place a subscription will gate later. |
| M2 | **Verification is a pure function with a spec, from Telegram's documented algorithm:** `data_check_string` = every received field except `hash`, sorted by key, `key=value` joined with `\n`; `secret = SHA256(bot_token)` (raw bytes); valid iff `hex(HMAC_SHA256(secret, data_check_string)) == hash` (constant-time compare). Freshness: `now − auth_date ≤ 10 min` (same as the link token), future `auth_date` beyond 60 s skew refused. | The Mini-App `initData` scheme uses a *different* key (`HMAC("WebAppData", token)`); copying the wrong one from a search result is the likely defect, so the spec pins the algorithm with a vector built from a fake token. |
| M3 | **No replay table for widget payloads.** | The payload travels only over HTTPS to our own origin inside a 10-minute window; a captured payload already implies a compromised browser, where the cookie is the bigger prize. Stated, not forgotten — revisit if the window is ever lengthened. |
| M4 | **Cloudflare *named* tunnel, remotely managed (token mode), hostname = the domain itself** (apex; Cloudflare flattens the CNAME). Ingress `https://<domain>` → `http://insight-bot:3005`. No Cloudflare Access — our login is the gate. | Unchanged from dashboard design §5; the only difference is the apex rather than `insight.<domain>`, because the brief's done-means names `https://<domain>`. A sub-domain is a one-line change if the user prefers. |
| M5 | **Adopt the five live AWS resources by `import` blocks into a fresh OpenTofu state; state lives in the existing backup bucket** (`vb-insight-bot-backups-apne1`, key `tofu/insight-bot.tfstate`, S3 native lockfile). | The old state file is not on this machine (`~/insight-tape-backups` does not exist here), and twice a single local copy of state nearly lost the record of paid resources. The IDs in `infra/insight-bot/LIVE-RESOURCES.md` are the truth; `import` rebuilds state from them, and a versioned bucket makes state stop being a file on someone's laptop. Acceptance gate: `tofu plan` shows **0 to change, 0 to destroy** on the five. |
| M6 | **Hosting shape unchanged:** t4g.micro + 20 GB gp3 + 2 GB swap, GHCR image, SSM deploy, budget alert at 18 USD (`COST-PLAN.md`, ≈ 13.6 USD/mo; domain ≈ 0.85 USD/mo on top). | Ruled in the brief. The slimmed app (liquidation websockets only, no kline/OI collection, no backfill) is lighter than the shape COST-PLAN was sized for, so its 1 GB risk (IB-012's backfill) no longer exists. |
| M7 | **The box runs the slimmed app, not today's master.** Acceptance (IB-077) depends on the revised WD-009/010/012. Infra and login (IB-072…IB-075) proceed now, in parallel. | Today's master starts every collector, OI backfill and derive on a 1 GB box. The user-side blockers (domain, AWS credentials, production bot) give the teardown time to land first; nothing in priority 1 waits on it except the final walk. |
| M8 | **The ops surface becomes admin-only** (`/api/web/health/*` behind `@AdminOnly`, the nav link hidden for members). Members see `/market`, `/instrument/*`, calendar, push. | A paying member should not land on collector internals; and it is the first place `role` is used to shape the product, so later plan-gating has a precedent. |
| M9 | **VAPID keys and the production bot token go to SSM**, rendered by the existing `render-env.sh` (it already renders every `/insight-bot/*` parameter, so no script change is needed for new keys). `WEB_BASE_URL=https://<domain>`, `WEB_COOKIE_SECURE=true`. | One secret path for everything; the box holds no key outside SSM. |

## 3. Liquidations: what the wind-down now keeps

Ruling 1.2 reverses WD-010/WD-012 for liquidations. What survives, minimally:

- **Collectors:** Binance `!forceOrder@arr` on `/market` (IB-BUG-012), Bybit `allLiquidation.{symbol}`,
  OKX `liquidation-orders`. Each socket loses its other streams (kline, markPrice, tickers,
  funding) — funding/OI/LS become on-demand reads (WD-008).
- **Their honesty layer:** `UptimeRecorder` → `collector_heartbeats` / `collector_gaps`
  (IB-BUG-010), `StreamRegistry` for the three streams + calendar, the watchdog's Telegram alert.
  Without these "no liquidations" cannot be told apart from "nobody listening", which is the
  defect IB-BUG-010 and IB-041 were about.
- **Tables:** `liquidations` (partitioned, so `partitions.service.ts` stays), `collector_gaps`,
  `collector_heartbeats`, `symbols` (the liquidation reads join venue spellings through it —
  `web/liquidations/pg/overview.repo.ts`; `universe-sync` from `config/universe.yaml` stays).
- **Reads and UI:** `web/liquidations/**`, `/series/liquidations*`, IB-068's server-side bubbles,
  the three liquidation components, the health page (reduced to streams + per-stream uptime, which
  moves there from the coverage page before the coverage page is deleted).

Dropped as planned: spot/kline/OI-LS/context collectors, backfill, derive, features, news,
playbooks, regime, coverage page, gap-report service (it reported kline gaps), and the tape tables
other than the above.

## 4. Designed for a subscription, not built (brief §4)

- **One access predicate.** `WebAuthService.resolveSession` already reads the `users` row on every
  guarded call and refuses `disabled`. A plan/expiry becomes columns on `users` and one more
  condition in that same function — both login paths and every `/api/web/*` call inherit it. Do
  not add a second check elsewhere (a cached "is paid" flag in the cookie would be the wrong move).
- **Budget per box.** No per-user venue calls: the 60 s shared caches (WD-008 `TtlCache`) stay the
  only path to a venue.
- **Terms/privacy page** — a static route, later; the widget does not require it.

## 5. Blocked on the user — nothing is built past these

| Needed | Unblocks | Task |
|---|---|---|
| Domain bought and added to Cloudflare; a tunnel token | the address | IB-074 live, IB-077 |
| AWS credentials on this machine as profile `insight-bot` (only `default` exists here) and the provisioner policy pasted (IB-BUG-007) | `tofu apply` | IB-073 |
| Production Telegram bot token; `/setdomain <domain>` in BotFather | link + widget on the box | IB-074, IB-077 |
| VAPID keys for the box (or permission for an agent to generate them into SSM) | push over https | IB-074 |
| **Where the 2026-10-23 archive and the old tofu state are** — not on this machine | seeding the box's tape (IB-076) | IB-076 only |

## 6. Task graph

```
IB-072 widget login ───────────────────────────────┐
IB-073 adopt AWS + box up (blocked: AWS profile) ──┤
IB-074 tunnel + domain files (live: domain) ───────┼──▶ IB-077 acceptance walk (run, not tested)
IB-075 ops surface admin-only ─────────────────────┤
WD-009 / WD-010 / WD-012 (revised, keep liq.) ─────┘
IB-076 seed box tape from archive (blocked: archive) — optional, after IB-073
```

Superseded: IB-013 → IB-073; IB-032 → IB-074; IB-041 → IB-076; WD-015 cancelled.
Recommended for closure by the Tech Lead (no product use after the rulings): IB-071 (its only
motive was Bybit forex — ruling 1.3), and the stage-1 tail IB-019, IB-020, IB-022…IB-026, IB-033,
IB-034, IB-040, IB-044, IB-052, IB-055…IB-057, IB-028.
