# Crypto Insight Bot — web dashboard (design addendum)

**Author:** Architect · **Date:** 2026-09-28 · **Status:** design, decomposed
into `tasks/insight-bot.jsonl` IB-029 … IB-035. Revises brief decision **Q24**
("no web admin in stages 0–2") at the user's request of 2026-09-28: *«не все
удобно в телеграм смотреть»*. The dashboard is wanted; this note settles what
it shows, where it lives, how members get in, how it is reached under the
20 USD/month cap, and where it slots against cluster A. Parent design:
`architecture/insight-bot-system-design.md` (sections cited as "design §").
Facts checked: `apps/chart-client/src/app/{app.routes.ts,core/*}`,
`apps/signal-server/src/auth/*`, `architecture/backtest-app-system-design.md`
§7.1, `infra/insight-bot/COST-PLAN.md` (t4g.micro, 13.6 USD, no inbound ports,
GHCR + SSM).

---

## 0. In one paragraph

A second Angular application **inside the existing `apps/chart-client`
workspace** (`projects/insight-dashboard`), sharing its `core/` (config, REST
client, error handling), its lightweight-charts wrappers and its dark-terminal
palette, built to a static bundle that **`apps/insight-bot` serves itself**
(`ServeStaticModule`, same origin, no CORS) behind a cookie session that a
member obtains with a **one-time login link from the bot** (`/web`), so the
bot's `users` table is the only user base. The box stays with **no inbound
ports**: a `cloudflared` sidecar in the same compose file publishes the
dashboard over an outbound **Cloudflare Tunnel** with TLS and a hostname on a
domain the user owns. The first slice is the **stage-0 health and data
browser** (collector streams, the fourteen gap reports, funding / OI / L-S /
liquidations charts over the collected tape), which is useful the day the
collectors run; signal history, playbook stats and admin pages follow their
stage-1 producers.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| W1 | **Second project in the `apps/chart-client` Angular workspace**, not a second repo app and not routes inside the backtest SPA. | Reuses the stack (user's standing preference) — `core/api`, `core/config`, chart wrappers, palette, `AGENTS.md` component rules — without coupling two products' auth boots and route guards into one bundle. Angular CLI supports multiple projects per workspace natively. |
| W2 | **Served by insight-bot** (`ServeStaticModule`, path `/`, API under `/api/web/*`), same origin. | One deployable on the box; cookies same-site; no CORS; the image already exists. |
| W3 | **Auth = one-time login link issued by the bot.** `/web` in Telegram → `https://<host>/login?t=<token>` (10 min, single use) → `POST /api/web/auth/exchange` → `ib_session` cookie (HttpOnly, Secure, SameSite=Lax, 30-day sliding), row in `web_sessions`. `/logout`, `/auth/me`. | Proves Telegram identity by construction; the bot's `users` is the only user base (no second, disconnected one); needs no BotFather domain binding (Telegram Login Widget) and no passwords. The backtest app's email/password base is a different contour and stays separate. |
| W4 | **Reach: Cloudflare Tunnel** (`cloudflared` container, outbound only) → `https://insight.<domain>`; TLS at Cloudflare's edge; box keeps zero inbound ports. Needs a domain on Cloudflare (**user decision**, §6). | Cheapest way to a TLS hostname without opening 443 or paying for an ALB; ~30 MB RAM; free tier. Tailscale/VPN rejected (members would install software); opening 443 + Caddy rejected (inbound surface, same domain need). |
| W5 | **Read-mostly.** Trade actions (`[Взял]/[Пропустил]`) stay in Telegram where the alert arrives, so there is one record path; the web adds reading, charts, stats, and **admin** actions (invites, users, playbook status/version) that are cramped as commands. | Keeps the Telegram bot the product; the web is the place to *look*. |
| W6 | **Slice 1 = stage-0 health + data browser**, dispatched after the collectors merge; **slice 2 = signals/stats/admin**, each page depends on its stage-1 producer task. | The health page is the exit-criterion instrument (design §6.2) made readable; the data browser is how the user (and the Researcher) eyeball the collected tape before any playbook exists. |
| W7 | Wire contracts as zod schemas in `libs/contracts/src/insight/*`, shared by server and dashboard. | The reason `libs/contracts` exists. |
| W8 | No WebSocket in slice 1; pages poll (30 s). Live streaming is a later additive task if a page needs it. | Simplicity on a 1 GB box; nothing on these pages changes faster than a poll. |

## 2. What goes on the web, and when

| Page | Useful | Depends on |
|---|---|---|
| **Health** — streams (mode ws/degraded, last message age, reconnects), Binance weight gauges (futures, spot), open gaps, **the last 14 daily gap reports** as a grid (symbol × day, missing 1m bars / OI slots), DB size and partition horizon | now (stage 0) | IB-011 |
| **Coverage** — per symbol × series: first row, last row, missing months (the IB-012 coverage report, live) | now | IB-012 |
| **Instrument view** (user must-have 1) — picker over the **top-20** of the collected universe (rank = the same 30-day quote-volume rank that builds `universe.yaml`; the picker shows the first 20, the rest reachable by typing); for the chosen coin, **time-aligned on one screen**: price (1m/15m/1h/4h, perp; spot toggle), **OI** (reusing the backtest SPA's `MetricPoint` renderer as is), **liquidations** long vs short as bars (aggregated across venues by default, per-venue toggle; the Binance undercount stated in the pane title), plus taker-buy delta / CVD, funding (settled per venue, predicted), L/S ratios; table of the largest liquidations; time-range picker | now | IB-005…IB-009 |
| **Market context** (user must-haves 2, 3) — **Fear & Greed** (alternative.me, daily, full history since 2018 back-filled in one call, shown as a gauge + history line) and **BTC vs the other top coins by market cap**: BTC dominance of total market cap (forward-collected), each top-20 coin's share, and the ratio BTC cap / Σ top-20 caps (one year of history from per-coin caps). Context only, never a trigger (draft §3.4) | now (collectors ungated) | IB-036 |
| **Signals** — list (filters: playbook, arm, status live/shadow, symbol, outcome), detail: candles around the trigger with entry / stop / targets / actual path, outcome (R, MFE/MAE), feature snapshot, regime, vetoes, who took it | stage 1 | IB-023 |
| **Playbooks** — stats per (playbook, version, arm), gated vs unconditional side by side, by regime context, equity-in-R curve; **admin**: status live/shadow/off, parameter change → new version, with the change log | stage 1 | IB-024 |
| **Members (admin)** — users, invites (create → link shown once), disable | stage 1 | IB-021 |
| **My settings** — deposit, risk %, language, daily limit, DEX opt-in, my stats | stage 1 | IB-021 |

Not on the web: sending or acknowledging signals, the morning plan, the
service chat. The chat agent (stage 3) may get a web view later; not designed
here.

## 3. Client structure (`apps/chart-client/projects/insight-dashboard`)

```
projects/insight-dashboard/src/
  app/
    app.routes.ts            /login, /health, /coverage, /data/:symbol, /signals, /signals/:id,
                             /playbooks, /admin/members, /settings
    core/                    insight-api.client.ts (RestClient from ../../src/app/core/api via a
                             tsconfig path alias), auth.guard.ts, insight-auth.service.ts
    features/health/         health.component.{ts,html,scss}, gap-grid.component.*, gap-grid.mapper.ts
    features/coverage/
    features/data-browser/   symbol-chart.component.* (lightweight-charts: candles + CVD/OI/liq panes),
                             series.adapter.ts (pure: API rows → chart series)
    features/signals/        signal-list.*, signal-detail.*, setup-overlay.ts (levels + path)
    features/playbooks/      stats-table.*, playbook-admin.*
    features/admin/          members.*
    features/settings/
  public/config.json         { "apiBaseUrl": "/api/web" }   (same origin in prod; :3005 in dev)
```

Rules: `AGENTS.md` component rules apply unchanged (three files, pure helpers
beside, 250-line ceiling, palette reuse, `standalone`, `OnPush`, signal
inputs). What is shared from the backtest SPA is imported through path
aliases, never copied: `RestClient`, `ApiError`, `AppConfigService`, the
chart wrapper and `ShapesPrimitive` (for setup levels). If a shared piece
turns out to be backtest-specific, it is generalised in place with its own
spec, not forked.

Build: `ng build insight-dashboard` → `dist/insight-dashboard/browser`; the
insight-bot Dockerfile gains a stage that builds it and copies the bundle to
`apps/insight-bot/public/`; `ServeStaticModule` serves it with SPA fallback,
excluding `/api`, `/health`, `/metrics`.

Dev: `ng serve insight-dashboard --port 42x5` per slot (coord `:4205`, dev-1
`:4215`, …, tester `:4245`) against the slot's insight-bot `:30x5`;
`AGENTS.md` port table gains the column.

## 4. Server surface (`apps/insight-bot/src/web/`)

All under `/api/web`, cookie auth except the exchange endpoint; zod contracts
in `libs/contracts/src/insight/`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/exchange` | public | `{token}` → 200 `{user}` + `Set-Cookie: ib_session`; 401 `TOKEN_INVALID` / 410 `TOKEN_USED` / `TOKEN_EXPIRED`. Token = 32 random bytes, stored hashed in `web_login_tokens(user_id, token_hash, expires_at, used_at)`; the bot's `/web` command creates it and replies with the URL (`WEB_BASE_URL` env). |
| GET / POST | `/auth/me`, `/auth/logout` | auth | as the backtest app's §7.1 pattern; `web_sessions(id, user_id, token_hash, created_at, last_seen_at, expires_at)`, sliding 30 days. |
| GET | `/health/streams`, `/health/gap-reports?days=14`, `/health/db` | auth | from `StreamRegistry`, `gap_reports`, `pg_database_size` + partition list |
| GET | `/coverage` | auth | per symbol × series first/last/missing months (materialised by IB-012's job into `coverage` table; live query otherwise) |
| GET | `/series/candles?venue&market&symbol&tf&from&to` | auth | ≤ 5,000 bars per call; `candles_1m` / `candles_agg` |
| GET | `/series/funding?symbol&from&to` | auth | settled per venue + predicted (1m, downsampled server-side to ≤ 5,000 points) |
| GET | `/series/oi`, `/series/ls?kind`, `/series/liquidations?bucket=1m|15m|1h&venue=all|binance|bybit|okx` | auth | OI served in the `MetricPoint` wire shape of `libs/contracts/src/metric.ts` so the backtest SPA's renderer draws it unchanged; liquidations bucketed per side; plus `/series/liquidations/top?n=50` |
| GET | `/context/fear-greed?from&to`, `/context/market-cap?from&to` | auth | F&G daily rows; market-cap rows: BTC dominance (of total), per-coin share and cap for the top 20, BTC / Σ top-20 ratio |
| GET | `/universe/top?n=20` | auth | the picker's list, from `symbols` ordered by the stored 30-day volume rank |
| GET | `/signals`, `/signals/:id` | auth | slice 2; members see all signals (shared, brief §1), own actions marked |
| GET | `/playbooks/stats?by=version|arm|regime` | auth | slice 2 |
| POST | `/admin/playbooks/:id/status`, `/admin/playbooks/:id/params` | admin | same code path as the Telegram admin commands (one service, two front doors) |
| GET / POST | `/admin/members`, `/admin/invites`, `/admin/members/:id/disable` | admin | same service as IB-021 |
| GET / PATCH | `/me/settings` | auth | same validation as the Telegram settings commands |

Rate/size: every series endpoint caps points and rejects ranges over 90 days
at 1m (400 `RANGE_TOO_WIDE`), so a page cannot pull a year of 1m rows on a
1 GB box.

## 5. Hosting delta (IB-032, DevOps)

- `cloudflared` service in `infra/insight-bot/compose/docker-compose.yml`
  (`restart: unless-stopped`, token from SSM `/insight-bot/CF_TUNNEL_TOKEN`),
  ingress `insight.<domain>` → `http://insight-bot:3005`. No security-group
  change: still egress only.
- Cost: Cloudflare Tunnel free; the domain is the only new line (≈ 10 USD /
  year ≈ 0.85 USD/month if bought; 0 if the user already owns one). Stays
  under the cap with headroom (13.6 + 0.85).
- RAM: `cloudflared` ≈ 30 MB; static files served by the existing Node
  process. No change to the t4g.micro decision.
- Cloudflare Access is **not** used; our login is the gate. Cloudflare's WAF
  defaults and the tunnel's origin isolation are a bonus, not a dependency.
- `WEB_BASE_URL=https://insight.<domain>` in the box `.env`; the bot refuses
  to issue login links when it is unset.

## 6. The user's decision (plain Russian in the reply)

A hostname needs a domain on Cloudflare: either one the user already owns
(add it to Cloudflare, free) or a new one (≈ 10 USD/year). Recommendation: a
cheap new domain bought at Cloudflare Registrar, subdomain `insight.`; the
tunnel, TLS and DNS then cost nothing. Until it exists, slice 1 runs locally
on each slot (`:42x5`) and is fully testable; only IB-032 waits.

## 7. Ordering

Cluster A (collectors + box) is unchanged and stays first. The dashboard is
**cluster D**: slice 1 (IB-029 auth, IB-030 shell + health + coverage,
IB-031 data browser, IB-032 tunnel) is schedulable as soon as its collector
dependencies merge and a developer is free — realistically alongside the
tail of cluster A and before cluster B's playbooks; slice 2 (IB-033 signals,
IB-034 playbooks + admin, IB-035 members + settings) follows the stage-1
producers it reads. Nothing in the dashboard gates any stage.

## 8. Risks

1. **Path aliases across Angular projects** can trip the CLI's build cache
   and the component-file linting; IB-030 proves the shared-import pattern
   first with one component and documents it in `apps/chart-client/README`.
2. **1 GB box serving charts to several members** — series endpoints are
   capped (§4); if it ever hurts, the answer is caching headers on
   `candles_agg` responses, not a bigger instance.
3. **Login link leakage** (forwarded message) — 10-minute single-use token,
   bound to the user, session revocable via `/admin/members/:id/disable`.
4. **Two front doors for admin** — one service behind both; a spec asserts
   the web and the Telegram command produce the same `playbook_config` row.

## 9. Memory budget on the box (t4g.micro, 1 GB RAM + 2 GB swap; `COST-PLAN.md`)

Sizing rules for IB-030/IB-031, so nobody guesses:

| Resident | Budget | How it is held there |
|---|---|---|
| OS + docker + `cloudflared` | ≈ 150 MB | `cloudflared` ≈ 30 MB; nothing else runs on the host |
| Postgres 16 | ≈ 350 MB peak | `shared_buffers=256MB`, `max_connections=20`, `work_mem=4MB` (already in the IaC); the web readers get **their own pool of ≤ 4 connections** and `statement_timeout=5s` |
| insight-bot (Node) | **≤ 400 MB RSS**, `--max-old-space-size=320` in the image `CMD` | collectors' batched writers (≤ 500 rows in flight per table) + web readers (below) |
| headroom / page cache | ≈ 100 MB | swap absorbs bursts (IB-012 backfill is the known offender and runs before the collectors or on a temporary `t4g.small`) |

**Angular build: never on the box.** `ng build insight-dashboard` runs in the
GitHub Actions image build (≈ 1.5 GB during the build, on the runner); the
box only pulls the image and serves ≈ 1–2 MB of gzipped static files from
disk via `ServeStaticModule` with `Cache-Control: max-age=1y` on hashed
assets — no measurable RSS.

**API readers are bounded by construction, not by hope:**

- every series endpoint has a hard cap of **5,000 points** per call and
  rejects 1m ranges > 90 days (§4); a response is therefore ≤ ~1 MB of JSON
  and ≤ ~10 MB of transient heap;
- queries page or aggregate **in SQL** (`candles_agg`, bucketed liquidation
  sums, downsampled `mark_funding_1m`), never load a raw range into Node and
  reduce it there;
- responses stream from the pg cursor to the socket for the candle endpoint
  (`pg-query-stream`), so a slow phone does not pin a buffer;
- concurrency: ≤ 4 web reader connections means at most 4 in-flight series
  reads, ≈ 40 MB transient worst case; the collectors' writer pool is
  separate so a dashboard burst cannot starve a write.

If `/health` ever shows the Node RSS above 400 MB for more than a minute
(add `ib_process_rss_bytes` to §6.1's gauges in IB-030), that is a bug in a
reader, not a reason to size up the instance.

## 10. Addendum 2 — the user's must-haves (2026-09-28) and the data-source rulings

User: *«возможность выбрать инструмент (топ 20 монет на бинанс), увидеть
график инструмента, OI по нему, ликвидации; индекс страха жадности;
соотношение btc к остальным топ монетам по капитализации»*. Folded into §2
(Instrument view, Market context) and §4. Sources, **probed live on
2026-09-28** (HTTP codes recorded here so nobody re-derives them):

| Need | Source | Verified | Ruling |
|---|---|---|---|
| Fear & Greed | `https://api.alternative.me/fng/?limit=0` | free, keyless, daily, full history in one call (200) | collect daily at 00:05 UTC into `fear_greed(day, value, classification)`; one-shot backfill on first run |
| BTC dominance of total market cap | CoinGecko `/api/v3/global` | free, keyless, **current only** (`market_cap_percentage`, `total_market_cap`) — 200 | **collect forward from now**: every 10 min → `market_cap_global(ts, total_usd, btc_pct, eth_pct, …)` (144 req/day) |
| Historical global market cap | CoinGecko `/global/market_cap_chart` | **paid** — 401 on the free tier | not used; no free history exists, hence forward collection |
| Per-coin market cap | CoinGecko `/coins/{id}/market_chart?days=365&interval=daily` | free for **365 days** (200); `days=max` is paid (401, error 10012) | daily at 00:10 UTC for the top-20 coins → `market_cap_coin(day, coin, cap_usd, price_usd)`; one-shot 365-day backfill (20 requests) |
| CMC | — | not probed | not needed; no key requested |

Rate: ≈ 165 CoinGecko requests/day keyless (well under its public limit of
~5–15/min); alternative.me 1/day. Both collectors are stage-2 collection,
**ungated** (brief §6), in cluster C, and start as soon as a developer is
free so the dominance chart has depth by the time the page ships. Derived
series (computed at read time, not stored): BTC share of Σ top-20 caps
(365 days of history from day one), each coin's share of Σ top-20.

Top-20 rule: the picker takes the first 20 of the universe's stored 30-day
quote-volume rank (`symbols.volume_rank`, written by the same measurement
that builds `universe.yaml`); market-cap pages use the same 20 coins mapped
to CoinGecko ids in `universe.yaml` (`coingecko_id`).

Reuse confirmed in `apps/chart-client`: `features/chart/metric-series.renderer.ts`
+ `metric-series-style.ts` draw an OI pane from `MetricPoint[]` and are
instrument-agnostic; `core/state/metric-points.store.ts` and
`features/panel-grid/chart-panel.component.ts` give the aligned multi-pane
layout. The instrument view imports these through the path alias; the only
new renderer is a two-colour histogram for liquidations per side.

## 11. Language of the dashboard (ruling 2026-09-28)

**The dashboard follows the bot, not the backtest app.** The same member
reads both surfaces, and brief Q23 already fixes their language: message
text in plain Russian, `ru` by default, `en` as the per-user alternative;
commands, playbook codes (`P3`), tickers, venue names and every log/DB
field name in English. So:

- Every UI string comes from a typed string table
  `projects/insight-dashboard/src/app/i18n/{ru,en}.ts` (one bundle, runtime
  selection — not Angular's build-time i18n), keyed by the member's `lang`
  from `GET /api/web/auth/me`; changing `/lang` in the bot changes the
  dashboard on next load; the login page (no user yet) is `ru` with an `en`
  switch that only affects that page.
- **No mixed screens.** A page is either fully `ru` or fully `en` apart from
  the English-by-rule tokens above (tickers, codes, field names in tables of
  raw data, units). A hard-coded literal in a template is a review reject.
- Numbers, dates and times: the member's `lang` locale, UTC shown
  explicitly where a time is venue time (the whole system is UTC).
- The backtest app's English-everywhere ruling (T-058) stands for the
  backtest app; it is a different audience and does not transfer.

Consequence for IB-031 (shipped with English labels and one Russian
empty-state): the labels move into the string table before merge, or as an
`IB-BUG-` if already merged — the Tech Lead's call inside the component.
IB-030's shell gains the `i18n/` table and the `lang` plumbing as the shared
mechanism if it is not there yet; IB-033/034/035/037 use it and decide
nothing on their own.
