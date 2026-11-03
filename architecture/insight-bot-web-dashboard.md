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
| W4 | **Superseded 2026-10-31 by `architecture/member-access-design-2026-10-31.md` M4 (Cloudflare named tunnel on the owner's domain, IB-074); the SSM-port-forward mode below is cancelled and kept for history.** **Reach, revised 2026-10-07 (user: no domain, "I can reach it by IP"): SSM port forwarding, admin-only, temporary.** The user runs `aws ssm start-session … AWS-StartPortForwardingSession portNumber=3005,localPortNumber=3005` (already in `RUNBOOK.md`) and opens `http://localhost:3005`. Zero inbound ports (D11 intact), zero cost, and the `Secure` cookie of IB-029 works because browsers treat `localhost` as a secure context. `WEB_BASE_URL=http://localhost:3005`, so the bot's `/web` link opens exactly what the admin will reach. **Companions cannot use this mode; no member-facing web feature may assume reach until it is revisited.** When a companion needs the web, the step is a Cloudflare *quick* tunnel (`cloudflared tunnel --url`, no domain, random `*.trycloudflare.com` hostname, TLS included) or a domain — the user's call then. A direct public IP over plain HTTP is **rejected**: it would send the one-time login exchange in clear and the `Secure` cookie would not be set; TLS on a bare IP has no free certificate path. | The original Cloudflare Tunnel + domain design stays in §5 as the member-facing option for later. |
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

## 6. The user's decision — taken 2026-10-07: no domain

> **Cancelled 2026-10-31.** The owner ruled for a domain and member login (product rulings
> 2026-10-31); reach is now `architecture/member-access-design-2026-10-31.md` M4 — a Cloudflare
> named tunnel on the owner's domain (IB-074 replaces IB-032). The text below is kept for history.

The user declined a domain. Reach is therefore W4's SSM port-forward mode
(admin only) until a companion needs the web; then the quick tunnel (no
domain) or a domain, at the user's choice. §5's tunnel-with-domain design is
kept as that later option; IB-032 is re-pointed at the port-forward mode
(runbook, `WEB_BASE_URL`, a smoke check), which needs no new infrastructure.

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
| insight-bot (Node) | **≤ 265 MB RSS worst case**, `--max-old-space-size=128 --max-semi-space-size=8` in the image `CMD` (IB-096; was 400 MB / 320, never implemented and larger than the measured box leaves) | collectors' batched writers (≤ 500 rows in flight per table) + web readers (below). Measured under client cadence: 154–175 MB RSS, live heap ≤ 67 MB; arithmetic and a spec that pins the `CMD` in `apps/insight-bot/src/ops/memory-budget.ts` |
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

## 12. Cards, not charts — Market page and liquidations (user, 2026-10-07)

User: Fear & Greed and BTC dominance must not be charts; liquidations must
not be a chart either. Replaces the chart scope of IB-037 and the
liquidations column of IB-031/IB-BUG-009. Tasks: IB-037 (amended), IB-038,
IB-039. Everything below reads in the member's language through the string
tables; the up/down colours are the palette's `#26a69a` / `#ef5350`.

### 12.1 Landing page = a row of cards (first screen after `/web`)

| Card | Content | Source |
|---|---|---|
| **Страх и жадность** | today's value 0–100 and its zone (Крайний страх / Страх / Нейтрально / Жадность / Крайняя жадность: 0–24 / 25–44 / 45–55 / 56–75 / 76–100, the alternative.me bands), colour by zone; Δ vs yesterday and vs 7 days ago (arrow + number); one plain sentence per zone from the string table — context only, never "buy/sell" wording | `fear_greed` |
| **Доминация BTC** | BTC share of total market cap (%); Δ 24 h and Δ 7 d — shown only when forward collection covers the window, else «данных пока за N дней»; one plain sentence (share rising → money leaving alts into BTC, falling → the reverse, flat → no rotation) | `market_cap_global` |
| **BTC против топ-20** | BTC cap / Σ top-20 (%), Δ 7 d and Δ 30 d; a compact ranked **list** of the top-20 shares (coin, %, Δ 7 d) — a list, not a chart | `market_cap_coin` |
| **Рынок** (the optional card, taken) | total market cap in USD with Δ 24 h, and ETH dominance with Δ 24 h | `market_cap_global` |
| **Ликвидации сейчас** | for 1 h / 4 h / 24 h: total USD liquidated, split long vs short as one horizontal bar (longs `#ef5350` on the left, shorts `#26a69a` on the right) with both amounts; **«× от нормы»** per window (12.2), colour-escalated (< 1.5 muted, 1.5–3 amber, ≥ 3 red); one plain line: «сейчас выносят лонги» / «выносят шорты» / «спокойно»; the honesty line (12.4) | `liquidations` |

### 12.2 «× от нормы» — the one new definition

For a window length W ∈ {1 h, 4 h, 24 h} and a scope (market-wide, or one
coin), `ratio_W = Σ USD liquidated in the trailing W / median over the
trailing 30 days of Σ USD in consecutive, non-overlapping, boundary-aligned
W-windows`, computed per side and in total, over the **venues present in
the window** (12.4). `null` until 7 days of liquidation history exist for
that scope. This is the P3 notion (the asset's own trailing norm, design
§8.2 `liq.*.z60m`) made readable; the z-score stays the playbook's
observable, the ratio is the display. Computed server-side, in SQL, by one
endpoint (12.3); specs on a synthetic 30-day tape.

### 12.3 Liquidations below the cards

- **Table «Где ликвидируют»**: rows = top-20 coins, columns 1 h / 4 h /
  24 h; a cell shows the USD amount, its background intensity scales with
  `ratio_W` (four steps), its colour follows the dominant side; sorted by
  the 1 h ratio descending so a cascade floats to the top; a row links to
  `/instrument/:symbol`.
- **Feed «Крупные ликвидации»**: newest N (default 30) events above a
  threshold (default 100 k USD, a picker: 50 k / 100 k / 500 k / 1 M):
  time, coin, side, USD, price, venue. Polled with the page (30 s).
- One endpoint feeds all three: `GET /api/web/liquidations/overview?symbols=top20&feed_min_usd=100000`
  → `{ windows: {1h,4h,24h} × {long, short, total, ratio} market-wide,
  perCoin: [...same per coin...], feed: [...], venues: { present: [...],
  missing: [...] }, asOf }`. One SQL pass per window; ≤ 50 ms on a day of
  data is the budget; cached 15 s server-side so several members polling do
  not multiply the query.

### 12.4 Honesty line

While a venue's liquidations are not being collected (today: Binance from
the local run, which is REST-degraded and has no `forceOrder`), the
response's `venues.missing` is non-empty and every card, table and the
instrument summary shows «Binance: нет данных до запуска сервера» (string
table key, venue interpolated). Bybit + OKX are never presented as the
whole market silently; the ratio's 30-day norm is computed over the same
venue set as its numerator, so a venue joining later does not fake a spike.

### 12.5 Instrument page: markers on the price chart, not a panel

The liquidations column of IB-BUG-009's one-row layout is removed. Instead
`/instrument/:symbol` draws **liquidation markers on the price chart**: one
marker per event at (time, price), radius by USD (sqrt scale, 3–14 px,
clamped), colour by side, via a lightweight-charts series-markers / overlay
primitive (`liquidation-markers.primitive.ts`, pure data mapping in
`liquidation-markers.adapter.ts` with specs); events are bucketed to the
chart's bar when more than one falls in a bar (sum USD, dominant side) so
a cascade reads as one big bubble, not a smear; hover shows time, side,
USD, price, venue. Under the chart: a small 1 h / 4 h / 24 h long/short
summary with the ratio and the honesty line (same component as the landing
card, narrow variant). Endpoint: `GET /api/web/series/liquidations/events?symbol&from&to&min_usd`
(≤ 2,000 events per call, else 400 `RANGE_TOO_WIDE`, the bucketing is
client-side at the chart's tf).

## 13. Instrument page redesign (user, 2026-10-24)

The user chose this layout from two mockups ("variant A"). It reverses IB-BUG-009's one row
of independent charts, on the user's own decision: **price is the centre of the screen**, and the
indicators sit **under** it on **one shared time axis**.

- **One chart, five panes**: price | open interest | delta/CVD | funding | long/short. Each pane
  keeps its own autoscaled price scale (the reason IB-BUG-009 split them: OI at 10^9 can no longer
  flatten candles at 10^4, because no two panes share a scale). The time axis is shared, so a
  crosshair moment is the same moment in every pane.
- **Every pane is resizable by height**, by dragging its lower edge. Only that pane changes; the
  panes under it move down and the chart grows, the page scrolls (user's correction, 2026-10-24:
  the first cut used the library's separators, which trade height between neighbours inside a
  fixed chart). Heights are pixels, **remembered in the browser** (`localStorage` key
  `insight.instrument.paneHeights.v2`; v1 held shares and is ignored). A blocked or corrupt
  storage falls back to the defaults; "Reset pane heights" restores them.
- **Every series sits on the candle grid.** The panes share one time scale, and the library gives
  every distinct time of every series a slot on it: 5-minute OI and long/short on a 1 h chart made
  twelve slots per candle and drew the candles as sparse sticks. Each series is snapped to the
  candle timeframe, last reading in a bar winning (`time-grid.ts`).
- **Scrolling or zooming out past the oldest bar loads the window before it**, the same width,
  and joins it on (`pane-merge.ts`); the view stays where the reader is. An empty earlier read means
  the venue's history starts there, and the page says so under the chart and stops asking.
- **No range buttons; the window follows the timeframe** (user, 2026-10-24): 1m opens on 1 day,
  15m on 7, 1h on 30, 4h on 90, 1d on 365, and scrolling left loads the same width again
  (`time-range.ts`). The liquidation bucket follows too: 1m → 1m, 15m → 15m, coarser → 1h, the
  coarsest `WebLiquidationBucketSchema` has. No frame's window is one the server refuses, so the
  old "1m coarsened to 15m" note has no case and is gone.
- **No spot line** (removed 2026-10-24, user). The price pane is perp only.
- **Indicators on the chart**, each a pure, specced module, drawn in `panel-series.ts`:
  - *Day separators* (`day-separators.ts`): a dashed `#30363d` line at every UTC midnight on all
    five panes, up to 4h (off on 1d).
  - *London and New York sessions* (`trading-sessions.ts`, one `SESSIONS` constant): translucent
    bands over the price pane's full height, behind the candles, on 1m/15m/1h only (a session is
    narrower than a 4h bar). Local exchange hours with the zone's own DST via `Intl`: London
    08:00–16:30 `Europe/London`, New York 09:30–16:00 `America/New_York`, local weekdays only;
    exchange holidays are not modelled.
  - *PDH/PDL and PWH/PWL* (`prior-levels.ts`): each UTC day drawn at the previous day's high/low,
    each ISO week (Monday 00:00 UTC) at the previous week's, as thin dashed step lines titled on
    the price axis. Computed from **1d candles fetched for the purpose** — the window plus the two
    weeks before it, extended when earlier history loads — because on 1m the window holds no
    previous day. A week's level needs all seven daily candles; a missing period is a gap in the
    line, not yesterday's value carried on. The lines are left out of the pane's autoscale, so a
    level far from the price is off screen rather than flattening the candles. A failed daily read
    drops the four lines, not the chart.
  - Every mark is placed on a **candle time** (`barsWithin` in `time-grid.ts`), never on a raw
    clock time, so no indicator adds a slot to the shared time scale. Lines and bands are one pane
    primitive per pane (`time-marks.primitive.ts`), drawn under the series.
- **Loaders** use the shared `<app-loader>`: a block in the chart's reserved space before the first
  chart, an overlay over the old chart while a timeframe or symbol switch loads, and an inline one
  in the chart foot while earlier history loads.
- **The symbol list is a dropdown**, not a sidebar. It shows per coin: 24 h price change,
  predicted funding and open-interest change over 24 h, from the new endpoint below.
- **A context column** beside the chart: the current values (OI, funding, CVD, long/short), the
  1 h / 4 h / 24 h liquidation summary (§12.5, same component), the largest liquidations in the
  window, and two market cards (fear and greed, BTC share).

### 13.1 `GET /api/web/universe/summary?n=20`

Answers `WebUniverseSummaryResponse` (`libs/contracts/src/insight/universe.ts`). The coins and
their order come from the same top list as `/universe/top`; every figure is read **live from
Binance USD-M**, nothing is stored. That is the on-demand direction of `tasks/wind-down.jsonl`
(WD-008, WD-009), built ahead of the shared venue layer; when WD-008 lands its `TtlCache` and
`VenuesModule`, `web/market/universe-summary.service.ts` should move onto them.

| Venue call | Documented weight | Calls per refresh |
|---|---|---|
| `GET /fapi/v1/ticker/24hr` (all symbols) | 40 | 1 |
| `GET /fapi/v1/premiumIndex` (all symbols) | 10 | 1 |
| `GET /futures/data/openInterestHist?period=1h&limit=25` | 1, no weight header | 20 |

Cached 60 s server-side with one shared in-flight read, so the venue sees at most one refresh a
minute however many tabs are open: about 50 `fapi` weight a minute (about 2 % of 2,400) plus 20
calls against the separate `/futures/data` limit. Above 1,800 used weight the endpoint refuses
with 503 `VENUE_UNAVAILABLE` instead of adding load. One coin whose OI call fails shows a dash
in its row; a failure of either all-symbol call fails the request. The three response shapes are
pinned by fixtures captured 2026-10-24 (`apps/insight-bot/test/fixtures/binance/`).

### 13.1a Market cards, live (2026-10-24)

`GET /api/web/context/cards` reads alternative.me and CoinGecko **live** when `MarketCardsService`
is wired, which it is in `WebModule`; nothing is stored. Until then the cards read stored rows, and
since the collectors stopped (2026-10-21) every card said «пока не собран». This is WD-009's default
("keep the current snapshot, drop the historical parts") done ahead of it.

| Call | Cache | At most |
|---|---|---|
| alternative.me `/fng/?limit=8` | 10 min | 0.1/min |
| CoinGecko `/api/v3/global` | 2 min | 0.5/min |
| CoinGecko `/api/v3/coins/markets?ids=<top 20>` | 2 min | 0.5/min |

No Binance weight. A failed read serves the last good answer, else only that card is empty. Fear &
Greed keeps yesterday and a week ago (the venue's history is free). The total cap's 24 h move and
each coin's 24 h cap move are the venue's own figures. Dominance moves and 7/30-day moves need
CoinGecko's paid history and are null; the payload says `live: true` and the page leaves those
lines out instead of calling the collection young.

### 13.2 Removed pages

**Coverage (`/coverage`), removed from the dashboard 2026-10-24.** It was an operator page about
the completeness of the *stored* tape, which the wind-down retires. The page is gone; **its server
endpoint still exists** until WD-009 deletes it. What that endpoint offers, so the capability is not
forgotten with the page:

- **`GET /api/web/coverage?days=N`** (behind the session guard), contract `WebCoverageResponse` in
  `libs/contracts/src/insight/coverage.ts`, controller `apps/insight-bot/src/web/coverage.controller.ts`.
- **Per symbol × series** (`rows`): first and last stored row (ms UTC, null when empty) and the
  months missing between them. This was IB-012's coverage report, read live.
- **Collector uptime** (`collectors`, IB-BUG-010): per stream, hours covered vs hours elapsed in the
  window, first and last liveness, and the outage count. It exists because "no liquidation this
  hour" and "nobody was listening" look identical in the data; any rate must divide by covered
  hours.
- **Unmapped liquidations** (`unmapped`, IB-BUG-010): stored liquidation rows whose venue symbol
  matches no known spelling, which is how a venue renaming a contract shows up.
- **Feature-frame coverage** (`frames`, IB-015): per timeframe, frames expected vs written,
  incomplete, explained-only and unhealed past the heal window.

All four measure the accumulating tape. Under the on-demand architecture none has a subject. If
an accumulating store ever comes back, this is the list to rebuild from.
