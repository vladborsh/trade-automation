# Architecture note — manual backtest app: system design

**Author:** Architect · **Date:** 2026-09-21 · **Status:** system design,
decomposed into `tasks.jsonl` (T-001 … T-033) for the Tech Lead.

This is role-to-role technical material, not user-facing (see `PROJECT.md` →
"Communicating with the user").

**Input:** `architecture/backtest-app-2026-09-21.md` — the settled brief. Every
numbered decision there is binding on this note; this note only decides what
the brief left to the Architect (component boundaries, data model, API,
module layout, sequencing). Where I had to *interpret* a decision to make it
buildable, the interpretation is listed in §13 so it is visible, not silent.
§14 records what was checked for conflicts.

Repository facts used (verified 2026-09-21, and re-verified for this note):
`libs/contracts` is consumed as a **built package** (`dist/`, no path
aliases); `CandleStore.stream()` exists and is the ordered-replay primitive;
`Resampler` is pure, UTC-anchored, and exposes `previewForming()`; the file
store already persists **derived timeframes** alongside 1m for some ranges
(BTCUSDT: 1m 2571 days, 1d 1833 days, 5m 104 days, 1h 143 days, 4h/15m
partial); `ShapesPrimitive` renders rects/rays/lines and has no pointer
handling; `ChartComponent` is a pure presentational component with
`candles`/`overlays`/`indicatorPoints` inputs; `lightweight-charts` 5.x
exposes `chart.takeScreenshot()`; `signal-server` has no write endpoint, no
guard, no database; `main.ts` already has an opt-in CORS switch for the
`:4200` dev client.

---

## 0. What is being built, in one paragraph

A trader opens an authenticated Angular app, creates a **backtest session**
(≤ 4 candle panels sharing one account currency, a period, a starting balance,
a risk %, a cost model), and steps the tape forward one bar at a time with
`→`. On any panel they draw a **position tool** (entry / stop / target), press
`Enter`, and an order is placed and sized from the risk %. As they keep
stepping, the **client** shows fills and floating PnL instantly from a 1m-ahead
cache using the same pure engine the **server** runs; the server is told about
every advance, walks the real 1m path itself, and *its* result is what closes
the trade, moves the balance and enters the journal and statistics. Two
screenshots per trade go to S3. Everything about the user — users, invites,
sessions, orders, aggregates — lives in PostgreSQL behind repository ports;
candles stay in the existing file/S3 `CandleStore`.

---

## 1. Decisions at a glance

| # | Decision | Why |
|---|---|---|
| D1 | Two new libs: **`libs/indicators`** (pure indicators) and **`libs/replay-core`** (resampler, replay calendar, fill engine, costs, sizing, floating mark, statistics). Both browser-safe, zero I/O, consumed as built packages like `contracts`. | Brief decision 11 (one indicator implementation) and decision 5 (client and server must not diverge on fills). The only way two runtimes agree on a fill is to run the same function on the same bytes. |
| D2 | **The chart kit stays in `apps/chart-client/src/app/features/chart/`** and is not lifted into `libs/`. It gets one new boundary: a `PanelSource` interface so `ChartPanelComponent`/`PanelGridComponent` render from either the live `PanelFeed` or a replay feed. | One consumer. Built-package consumption (no path aliases) makes every lib edit a rebuild before `ng serve` sees it — unacceptable friction for the position tool, the most iterated code in this build. A lift is a mechanical move later if a second app ever appears. |
| D3 | **The client's ahead cache is 1m candles**, sized in bars of the current timeframe (500 ahead, refill at 100), folded into the current timeframe on the client with the lifted `Resampler`. | Decisions 4, 12, 17, 18 together: SL/TP resolve on the 1m path, the timeframe can change mid-session with a partially formed bar, and stepping must not round-trip. Only a 1m cache serves all three. §5.3 gives the sizing rule that keeps 1d sessions in memory bounds. |
| D4 | **The server evaluates orders on every `advance`, not only on close.** The client posts each cursor advance (coalesced when the user out-runs the network); the server walks 1m for the span and returns fill/close events; the client reconciles. | The cursor must be persisted anyway (decision 37: forward only, must survive reload). Evaluating in the same request costs one file read and makes "server authoritative on close" (decision 5) a by-product rather than a second code path. The client never waits for the response to render. |
| D5 | **Relational data behind repository ports + a `Db` port**; PostgreSQL only implementation; SQL lives in `src/db/pg/` and `src/**/pg/` only. | Brief decision 7: swappable provider, cascades, transactional close. |
| D6 | **Migrations: versioned SQL files run by `postgrator`** at boot under a pg advisory lock, also runnable as `npm run migrate`. | Brief decision 33: no ORM, plain SQL. Postgrator is a ~zero-dependency runner over the `pg` driver that does exactly and only this (`NNN.do.name.sql` / `NNN.undo.name.sql`, checksum-validated). A hand-rolled 60-line runner was the alternative; it would spend a task re-inventing checksum and undo handling. |
| D7 | **Auth: httpOnly cookie `bt_session` → `auth_sessions` row; scrypt password hashes; admin upserted from env at boot; invites are single-use, 7-day, stored hashed.** Global `AuthGuard` with an explicit `@Public()` allow-list; the WS gateway checks the same cookie. | Brief decisions 14, 20, 30. Node's built-in `crypto.scrypt` avoids a native dependency. |
| D8 | **Screenshots: `ScreenshotStore` port with `file/` and `s3/` implementations** (house pattern), key scheme mirrors the candle keys, session delete removes the S3 prefix **before** the DB row. | Brief decisions 6, 27, 30b. |
| D9 | **Every mutating backtest request carries a client `opId`** and the server stores the response; a retry replays it. | Steps are fire-and-forget from the user's point of view; a retried `advance` or `orders` POST must not double-fill. |
| D10 | Session layouts are **candle panels only, ≤ 4**, a JSON copy on the session row; presets from `layouts.yaml` are offered with metric panels stripped. | Decisions 10, 39. There is no open-interest history in replay and `signals` has no meaning there. |
| D11 | Instruments gain a **`sessionCurrency`** field (defaults to `quoteCurrency`; `USDT` pairs declare `USD`). Session creation rejects mixed `sessionCurrency`. | Decision 36 and the coordinator's ruling of 2026-09-21: exactly two groups, USD and CHF, enforced from configuration, never from code. |

---

## 2. Component breakdown

```
apps/chart-client (Angular 22)                    apps/signal-server (NestJS)
┌────────────────────────────────────────┐       ┌──────────────────────────────────────────┐
│ core/auth      AuthService, guards     │ HTTPS │ auth/       AuthGuard, AuthService,       │
│ core/api       RestClient (+cookies),  │◄─────►│             repositories (pg), admin      │
│                BacktestClient          │       │             bootstrap, cookie helpers     │
│ core/replay    ReplayEngine, AheadCache│       │ backtest/   SessionService, OrderService, │
│                AdvanceQueue, stores    │       │             AdvanceService, ReplayHistory │
│ features/auth  login, invite-accept    │       │             ReplayAhead, StatsService,    │
│ features/sessions list, create         │       │             ScreenshotService, repos (pg) │
│ features/backtest workspace, toolbar,  │       │ api/rest/   auth, admin, backtest/*       │
│                order panel, positions, │       │ db/         Db port, PgDatabase, runner   │
│                journal, stats, trade   │       │ storage/    CandleStore (+coverage),      │
│ features/chart  kit: ChartComponent,   │       │             ScreenshotStore (file|s3)     │
│                overlay/*, position-tool│       │ jobs/       derive-timeframes, backfill   │
│ features/terminal (existing, routed)   │       │ market-data/ (existing; Resampler now     │
└───────────────┬────────────────────────┘       │              imported from replay-core)   │
                │ imports                         └───────────────┬──────────────────────────┘
                ▼                                                 ▼
   libs/contracts   ── zod schemas + wire types (extended additively: auth, backtest)
   libs/indicators  ── ATR, VWAP, range, prev-hour, FVG (lifted) + EMA, SMA, RSI, MACD, BB, Stoch
   libs/replay-core ── Resampler (lifted), replay calendar, fill engine, costs, sizing,
                       floating mark, MAE, statistics — the one implementation both sides run
```

### 2.1 `libs/` — what is lifted and what is new

**`libs/indicators`** (`@trade-automation/indicators`). Lifted verbatim from
`apps/signal-server/src/strategy-engine/strategies/vwap-band-reversal/indicators/`:
`computeAtr`, `computeVwapBand`, `computeRange`, `computePreviousHourLH`,
`computeFvg` (+ their specs). The server plug-in re-imports from the package;
its behaviour is unchanged (the bug-faithful semantics documented in
`knowledge/vwap-band-reversal-ict.md` are preserved by not editing the
bodies). New, written for this app: `ema`, `sma`, `rsi` (Wilder), `macd`,
`bollinger`, `stochastic` — each a pure `(bars: readonly Candle[], params) →
IndicatorSeries` returning `{ time, value }[]` series keyed by output name
(`macd`, `signal`, `hist`; `upper`, `middle`, `lower`; `k`, `d`). Depends only
on `contracts`. No Node imports — this package runs in the browser.

**`libs/replay-core`** (`@trade-automation/replay-core`). Depends only on
`contracts`. Modules:

| Module | Contents | Consumers |
|---|---|---|
| `resample/` | `Resampler` class, moved from `market-data/resampler.ts` (mechanical; `resampler.service.ts` re-imports). `foldOneMinute(bars1m, tf, upToMs)` — a stateless helper on top of it: returns closed `tf` bars plus the forming bar at `upToMs`. | server live pipeline (unchanged behaviour), server `ReplayHistoryService`, client `ReplayEngine` |
| `calendar/` | `barCloseAfter(cursorMs, tf)`, `isWeekend(ms)`, `nextCursor(...)` (§5.2) | client `ReplayEngine`, server `AdvanceService` (for end-of-period clamp and validation) |
| `fill/` | `evaluateOrder(order, path, costs) → FillEvent[]` (§6), `walk1m`, `walkBarsPessimistic` | client (preview), server (authoritative) |
| `costs/` | `marketFillPrice`, `stopExitPrice`, `commission`, `spreadCost` | fill, mark, sizing |
| `sizing/` | `positionSize(balance, riskPct, entry, sl)` | client order panel, server `OrderService` |
| `mark/` | `floatingPnl(position, lastClose, costs)`, `openRisk(positions)` | client positions panel; server on end-of-session close |
| `stats/` | `computeStats(closedTrades) → SessionStats` (§8) | server (stored aggregates + full recompute), client (nothing recomputed locally — it displays server numbers) |

Every function is deterministic over plain data, and each has a spec file
under `libs/replay-core/test/`. The spec suite for `fill/` *is* the fill
convention: the Tester's e2e for order paths should assert against the same
fixtures.

### 2.2 `apps/signal-server` — new and extended modules

| Module | New / extended | Responsibility |
|---|---|---|
| `db/` | new | `Db` port (`query`, `transaction`), `PgDatabase` (`pg` pool), `MigrationRunner` (postgrator), `DbModule`. `DATABASE_URL` absent ⇒ module disabled and every backtest/auth route returns 503, the same pattern `CALENDAR_ENABLED=false` uses. |
| `auth/` | new | `AuthGuard` (global `APP_GUARD`), `@Public()`, `@CurrentUser()`, `AuthService` (login/logout/me/invite accept), `PasswordHasher` (scrypt), `SessionCookie` (name, flags, sliding expiry), `AdminBootstrap` (upsert admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` at boot), repository ports + `pg/` implementations for users, invites, auth sessions. |
| `backtest/` | new | `SessionService` (create/list/get/patch/delete with validation), `ReplayHistoryService` (closed `tf` bars + forming bar behind the cursor), `ReplayAheadService` (1m ahead pages, clamped to the period), `OrderService` (place/cancel/manual close/modify), `AdvanceService` (walk 1m for the span, close trades, update balance and aggregates, end-of-session force close), `StatsService`, `ScreenshotService`, `OpsRepository` (idempotency), repository ports + `pg/`. |
| `api/rest/` | extended | `auth.controller.ts`, `admin.controller.ts`, `backtest/{instruments,sessions,candles,orders,screenshots}.controller.ts`. All zod-validated through the existing `ZodValidationPipe` with schemas from `contracts`. |
| `api/ws/live.gateway.ts` | extended | `handleConnection` validates the `bt_session` cookie (falls back to the existing `WS_SHARED_TOKEN` check when no DB is configured). |
| `storage/` | extended | `CandleStore.coverage(instrument, tf) → {from, to} \| null` added to the port (both implementations). New `ScreenshotStore` port with `file/` + `s3/`. |
| `jobs/` | new | `derive-timeframes` (1m → 5m/15m/1h/4h/1d persisted via `CandleStore.upsert`, `source: 'resampled'`), `backfill` (§10). Both are CLI entry points (`node dist/jobs/<name>.js`), not boot-time work. |
| `config/env.schema.ts` | extended | `DATABASE_URL`, `DB_MIGRATE_ON_BOOT` (default true), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_BASE_URL` (invite links), `SESSION_COOKIE_SECURE` (default `NODE_ENV === 'production'`), `SCREENSHOT_STORE=file\|s3` (default = `CANDLE_STORE`), `SCREENSHOT_MAX_WIDTH_PX` (default 1280). |

### 2.3 `apps/chart-client` — routing and new features

`app.config.ts` gains `provideRouter(routes)`; `App` renders `<router-outlet>`.
`TerminalShellComponent` is unchanged and mounted at `/terminal`.

| Route | Component | Guard |
|---|---|---|
| `/login` | `features/auth/login.component` | public |
| `/invite/:token` | `features/auth/invite-accept.component` | public |
| `/terminal` | existing `TerminalShellComponent` | auth |
| `/sessions` | `features/sessions/session-list.component` | auth (default route) |
| `/sessions/new` | `features/sessions/session-create.component` | auth |
| `/sessions/:id` | `features/backtest/workspace.component` | auth |
| `/sessions/:id?viewAt=<ms>&order=<id>` | same component, view-only (§9.3) | auth |
| `/sessions/:id/trades/:orderId` | `features/backtest/trade-detail.component` | auth |
| `/admin/users` | `features/admin/users.component` | auth + admin |

`core/replay/` is the framework-free heart of the client (plain classes with
signals at the edge, every pure helper in its own file with a spec, per
`AGENTS.md`): `ReplayEngine` (cursor, step, timeframe switch), `AheadCache`
(per panel), `AdvanceQueue` (serialised, coalescing mutations), and the
stores `ReplaySessionStore`, `PositionToolsStore`, `PortfolioStore`.

**Chart kit boundary (D2).** `ChartPanelComponent` and `PanelGridComponent`
currently take a `PanelFeed`. They will take a `PanelSource`:

```ts
export interface PanelSource {
  readonly panel: Panel;
  readonly candles: Signal<readonly Candle[]>;
  readonly overlays: Signal<readonly OverlayPrimitive[]>;
  readonly indicatorPoints: Signal<readonly IndicatorPoint[]>;
  readonly indicatorSpecs: Signal<ReadonlyMap<string, IndicatorSeriesSpec>>;
  loadOlder(): Promise<void>;
}
```

`PanelFeed` implements it with an adapter (no behaviour change); the replay
workspace supplies a `ReplayPanelSource` per panel. The `ChartComponent` is
untouched by this — it already takes plain inputs.

---

## 3. Data model (PostgreSQL)

All timestamps that mean *market time* are `bigint` ms epoch, the convention
of the whole codebase. Audit columns are `timestamptz`. Money and prices are
`numeric(20,8)`, R multiples `numeric(12,6)`, percentages `numeric(8,4)` (a
value of `1.0` means 1 %). The `pg` driver returns `numeric` as strings — the
repositories parse them to `number` at the boundary, once.

```sql
create extension if not exists citext;

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique,
  password_hash text   not null,             -- scrypt: "scrypt$N$r$p$salt$hash", base64url
  role          text   not null check (role in ('admin','user')),
  disabled_at   timestamptz,
  created_at    timestamptz not null default now()
);

create table invites (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,           -- sha256(token); the token itself is shown once
  email       citext,                         -- optional pre-fill; not enforced on accept
  created_by  uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,           -- created_at + 7 days
  used_at     timestamptz,
  used_by     uuid references users(id) on delete set null
);

create table auth_sessions (
  id           text primary key,              -- sha256(cookie value)
  user_id      uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,          -- sliding, 30 days
  last_seen_at timestamptz not null default now(),
  user_agent   text
);
create index on auth_sessions (user_id);

create table backtest_sessions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references users(id) on delete cascade,
  name                   text not null,
  status                 text not null check (status in ('active','complete')),
  session_currency       text not null,       -- 'USD' | 'CHF' (D11)
  timeframe              text not null,       -- current tf; changes mid-session (decision 12)
  period_from_ms         bigint not null,
  period_to_ms           bigint not null,
  cursor_ms              bigint not null,     -- absolute ms (decision 18); monotonic (decision 37)
  initial_balance        numeric(20,8) not null,
  balance                numeric(20,8) not null,   -- realized, compounding (decision 21)
  default_risk_pct       numeric(8,4)  not null,
  costs_enabled          boolean not null,
  commission_pct         numeric(8,4)  not null,   -- of notional, per side
  spread                 numeric(20,8) not null,   -- full bid-ask width, price units
  skip_weekends          boolean not null default true,
  notional_warn_multiple numeric(8,2)  not null default 5,
  layout                 jsonb not null,      -- owned copy of Layout, candle panels only, <= 4
  -- stored aggregates (decision 38); rewritten inside every closing transaction
  trades_count           integer not null default 0,
  wins_count             integer not null default 0,
  losses_count           integer not null default 0,
  pnl_ccy                numeric(20,8) not null default 0,
  pnl_r                  numeric(12,6) not null default 0,
  profit_factor          numeric(12,6),
  max_drawdown_ccy       numeric(20,8) not null default 0,
  max_drawdown_r         numeric(12,6) not null default 0,
  avg_win_ccy            numeric(20,8), avg_win_r numeric(12,6),
  avg_loss_ccy           numeric(20,8), avg_loss_r numeric(12,6),
  stats_computed_at      timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  completed_at           timestamptz,
  check (period_from_ms < period_to_ms),
  check (cursor_ms between period_from_ms and period_to_ms)
);
create index on backtest_sessions (user_id, created_at desc);

create table orders (                         -- one row = one order's whole life; closed = a trade
  id                     uuid primary key default gen_random_uuid(),
  session_id             uuid not null references backtest_sessions(id) on delete cascade,
  seq                    integer not null,    -- 1-based per session; journal order
  panel_id               text not null,
  instrument             text not null,
  side                   text not null check (side in ('long','short')),
  type                   text not null check (type in ('market','limit')),
  status                 text not null check (status in ('pending','open','closed','cancelled')),
  placed_at_ms           bigint not null,     -- cursor when placed (screenshot #1 moment)
  limit_price            numeric(20,8),       -- limit orders only
  entry_price            numeric(20,8),       -- actual fill incl. spread
  entry_time_ms          bigint,              -- openTime of the 1m candle that filled it
  qty                    numeric(20,8) not null,
  risk_pct               numeric(8,4)  not null,
  risk_amount_ccy        numeric(20,8) not null,   -- 1R in currency, fixed at placement
  sl_initial             numeric(20,8) not null,   -- decision 21: never null
  sl_current             numeric(20,8) not null,
  tp_initial             numeric(20,8),
  tp_current             numeric(20,8),
  exit_price             numeric(20,8),
  exit_time_ms           bigint,
  close_reason           text check (close_reason in ('stop','take-profit','manual','end-of-session')),
  fill_resolution        text check (fill_resolution in ('1m','pessimistic-bar')),  -- decision 4
  sl_tp_same_bar         boolean not null default false,
  commission_ccy         numeric(20,8) not null default 0,
  spread_cost_ccy        numeric(20,8) not null default 0,
  pnl_ccy                numeric(20,8),       -- net of all costs
  pnl_r                  numeric(12,6),       -- pnl_ccy / risk_amount_ccy
  mae_price              numeric(20,8),       -- decision 26; computed at close from the 1m path
  mae_r                  numeric(12,6),
  cancelled_at_ms        bigint,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (session_id, seq)
);
create index on orders (session_id, status);

create table order_modifications (            -- decision 23
  id         bigserial primary key,
  order_id   uuid not null references orders(id) on delete cascade,
  cursor_ms  bigint not null,
  field      text not null check (field in ('sl','tp')),
  old_value  numeric(20,8),
  new_value  numeric(20,8),
  created_at timestamptz not null default now()
);

create table screenshots (                    -- decisions 6, 27, 30b
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references backtest_sessions(id) on delete cascade,
  order_id   uuid not null references orders(id) on delete cascade,
  kind       text not null check (kind in ('entry','exit')),
  store_key  text not null,                   -- §9.2 key; the DB never holds bytes
  width_px   integer not null, height_px integer not null, bytes integer not null,
  captured_at_ms bigint not null,             -- cursor at capture
  created_at timestamptz not null default now(),
  unique (order_id, kind)
);

create table backtest_ops (                   -- D9 idempotency
  session_id uuid not null references backtest_sessions(id) on delete cascade,
  op_id      uuid not null,
  response   jsonb not null,
  created_at timestamptz not null default now(),
  primary key (session_id, op_id)
);
```

**Cascade rules.** `users → backtest_sessions → orders → order_modifications
/ screenshots`, and `backtest_sessions → backtest_ops`, all `on delete
cascade`. Deleting a session (decision 30b) is: (1) `ScreenshotStore.
deleteByPrefix(sessionPrefix)`; (2) `DELETE FROM backtest_sessions WHERE id=$1
AND user_id=$2`. S3 first: if S3 fails the session stays and the user retries;
if the DB delete fails after S3 succeeded, the orphan is rows pointing at
nothing, which costs nothing. Deleting a *user* is not in v1 (§12).

**Where money and R live.** Per trade on the `orders` row (`pnl_ccy`,
`pnl_r`, `risk_amount_ccy`, `mae_*`, cost columns); per session on
`backtest_sessions` (balance and the aggregate columns). `1R` is the currency
amount risked at placement (`risk_amount_ccy`), so `pnl_r` is net of costs and
sessions with different account sizes compare directly (decision 21).

**Tenancy.** Every backtest query is scoped `WHERE user_id = $current`. The
admin role unlocks `/api/admin/*` only; it does not widen any backtest query
(decision 30).

---

## 4. Storage split and the adapter boundary

| Data | Store | Boundary |
|---|---|---|
| Users, invites, auth sessions, backtest sessions, orders, modifications, screenshot metadata, op log | PostgreSQL | Repository ports (`user.repository.port.ts`, `invite…`, `auth-session…`, `session.repository.port.ts`, `order…`, `screenshot…`, `ops…`) over one `Db` port (`db.port.ts`: `query<T>(sql, params)`, `transaction<T>(fn)`). Implementations under `**/pg/`. No SQL outside `pg/` directories. Injection tokens follow the house pattern (`USER_REPOSITORY = Symbol(...)`). |
| Candles (1m and derived) | existing `CandleStore` (file locally, S3 in prod) | Unchanged port plus `coverage()`. Replay reads go through `query`/`stream`; nothing in the backtest module touches the file layout. |
| Screenshot bytes | `ScreenshotStore` (file locally, S3 in prod) | `put(key, bytes, contentType)`, `get(key) → {bytes, contentType} \| null`, `deleteByPrefix(prefix) → count`. |

"Swappable provider" (decision 7) means: a second `Db` implementation and a
second set of `pg/`-equivalent repositories, nothing else. The service layer
sees only ports. Transactions are expressed as `db.transaction(async (tx) =>
{ ...repos bound to tx... })`, so a trade close (order row + balance +
aggregates) is one transaction.

**Local development.** `apps/signal-server/docker-compose.yml` gains a
`postgres:16-alpine` service (podman-compose compatible) on `:5432` with a
`backtest` superuser. One instance serves every worktree; each slot uses its
own **database name** in `DATABASE_URL` (`backtest_coord`, `backtest_dev1`,
`backtest_dev2`, `backtest_dev3`, `backtest_tester`) so the "never touch
another slot's state" rule from `AGENTS.md` holds for the DB the same way it
holds for ports. The migration runner creates nothing but tables, so the
database itself is created once by hand (`createdb`). Recommending this row
be added to the `AGENTS.md` port table is the coordinator's call.

**Migrations.** `apps/signal-server/migrations/001.do.init.sql` (the schema
above) + `001.undo.init.sql`. Runner: `postgrator` configured with
`driver: 'pg'`, `migrationPattern: 'migrations/*'`, `schemaTable:
'schema_migrations'`; wrapped in `SELECT pg_advisory_lock(hashtext('bt-migrate'))`
so two slots booting against one database cannot race. Runs at boot when
`DB_MIGRATE_ON_BOOT=true` (default), and via `npm run migrate` (`node
dist/db/migrate.js`). A failed migration is a boot failure, like an invalid
env.

---

## 5. Replay engine

### 5.1 Vocabulary

- **Cursor** `cursorMs`: absolute ms; "the tape is revealed up to and
  including every 1m candle whose `openTime + 60_000 <= cursorMs`". Stored on
  the session; never decreases (decision 37).
- **Bar of tf at the cursor**: `floor(cursorMs / tfMs) * tfMs` is the open of
  the bar containing the cursor. If `cursorMs` is exactly on a boundary the
  previous bar is complete and no forming bar exists; otherwise the current
  bar is **forming** from the 1m candles between its open and the cursor
  (decision 18 — exactly what `Resampler.previewForming` produces).
- **Step**: advance the cursor to the close of the next bar of the current tf
  that has data on at least one panel (decisions 3, 13, 19).

### 5.2 `nextCursor` (in `libs/replay-core/calendar`)

```
nextCursor(cursorMs, tf, skipWeekends, nextDataAt: (fromMs) => number | null, periodToMs):
  b = floor(cursorMs / tfMs) * tfMs + tfMs          // close of the bar containing the cursor
  loop:
    if skipWeekends and isWeekend(b - tfMs):        // bar opens inside [Sat 00:00, Mon 00:00) UTC
      b = mondayAfter(b - tfMs)  + tfMs             // first bar opening Monday 00:00 UTC
    t = nextDataAt(b - tfMs)                        // earliest 1m openTime >= bar open, any panel
    if t is null: return periodToMs                 // tape exhausted → end of session
    if t < b: return min(b, periodToMs)             // bar has data → stop here
    b = floor(t / tfMs) * tfMs + tfMs               // empty stretch → jump to the bar that has data
```

`isWeekend` is the UTC interval `[Saturday 00:00, Monday 00:00)`. Empty
stretches of any other shape (Capital.com session closes, holidays, an
instrument's tape starting later than the period) are handled by the
`nextDataAt` jump, which is O(1) against the ahead cache. `nextDataAt` is the
only thing that differs between client and server: on the client it reads the
caches; on the server (`AdvanceService`) it is not needed — the server accepts
the client's target cursor and validates it (§5.5).

### 5.3 Client-ahead cache (decision 17, in 1m)

Per panel, `AheadCache` holds 1m candles with `openTime >= cursorMs`, in a
**compact** form (`[openTime, o, h, l, c, v]` tuples, ~48 bytes each). Sizing
is expressed in bars of the current tf and converted:

```
target1m  = clamp(500 * tfMinutes, 500, 50_000)     // 1m: 500;  1h: 30_000; 4h/1d: 50_000
refill1m  = clamp(100 * tfMinutes, 100, 10_000)     // 1m: 100;  1h:  6_000; 4h/1d: 10_000
page      = 5_000 candles per request
```

For 1m/5m/15m/1h that is exactly "500 bars ahead, refill at 100". For 4h/1d
the cap keeps memory at ~2.4 MB per panel (50k × 48 B), i.e. 35 daily steps
ahead, refilled in the background at 7 remaining — a trader on 1d steps at
most a couple of times a second, and one 5k-candle page is ~250 KB. Refill is
`GET …/candles/ahead?panelId&fromMs=<last cached openTime + 1>&limit=5000`,
serialised per panel, never blocking a step. A step that outruns the cache
(possible only if the network is far slower than the trader) blocks the
`→` key until the page lands and shows a "loading" state in the toolbar — it
never renders a bar it does not have.

The server clamps every ahead page to `periodToMs`; an empty page past the
last stored candle means the tape ends there. **This endpoint deliberately
hands the client the future.** The client is trusted UI (the same trust model
as decision 5 — a trader who peeks cheats only themselves); the server is
the authority on what was *traded*, not on what was *seen*.

### 5.4 Stepping and timeframe switching on the client

On `→`:

1. `ReplayEngine.step()` computes `next = nextCursor(...)` from the caches.
2. For each panel: pop the 1m candles with `openTime + 60_000 <= next` from
   the cache, feed them through `foldOneMinute` (the lifted `Resampler`) into
   the panel's `tf` series: append closed bars, replace the forming bar. The
   `CandlesStore.mergeLive` semantics already handle "replace same openTime /
   append newer".
3. `PortfolioStore.preview(next, poppedPathPerInstrument)`: runs
   `evaluateOrder` from `replay-core` over the popped 1m candles for every
   pending/open order — the **preview** of fills — and marks floating PnL
   (`floatingPnl`) on every still-open position at the last 1m close.
4. `AdvanceQueue.push({ kind: 'advance', toCursorMs: next, opId })`.
5. The cursor signal moves; the chart, order panel and positions panel react.

Timeframe switch (`[`/`]` or picker, decision 12): the cursor does not move.
The engine re-fetches history behind the cursor at the new tf (§7,
`GET …/candles?timeframe=new&before=cursor`), which returns closed bars plus
the forming bar built server-side from 1m up to the cursor, re-sizes the
ahead caches (nothing is discarded; only `target1m`/`refill1m` change), and
queues `PATCH sessions/:id {timeframe}`. The forming bar appears partially
formed at exactly the same cursor (decision 18).

### 5.5 What the server does on `advance` (decision 5, D4)

`POST …/advance {opId, toCursorMs}`:

1. Load session `FOR UPDATE`; reject `toCursorMs < cursor_ms` (409
   `CURSOR_BACKWARDS`), `toCursorMs > period_to_ms` is clamped to
   `period_to_ms`. Idempotent on `(session_id, op_id)`.
2. For every instrument that has a pending or open order: `CandleStore.query
   (instrument, '1m', cursor_ms, toCursorMs - 1)` — the 1m path for the span.
   If empty, `query(instrument, session.timeframe, …)` — if *that* has bars,
   evaluate with `walkBarsPessimistic` and mark `fill_resolution =
   'pessimistic-bar'` (decision 4); if neither has bars, nothing happens.
3. `evaluateOrder` per order, chronologically per instrument. Fills set
   `status='open'`, `entry_*`; exits set `status='closed'`, `exit_*`,
   `close_reason`, costs, `pnl_ccy`, `pnl_r`, `mae_*` (MAE from the 1m path
   between `entry_time_ms` and `exit_time_ms`, one extra `query`).
4. `balance += pnl_ccy` per close, in exit-time order; aggregates recomputed
   by `computeStats` over the session's closed orders and written to the
   session row. All in one transaction with the cursor update.
5. If `toCursorMs == period_to_ms`: every open position is closed at the last
   1m close as a **market exit** (spread and commission apply — §13),
   `close_reason='end-of-session'`; pending orders → `cancelled`; `status=
   'complete'`, `completed_at` set (decision 28).
6. Response: `{ cursorMs, status, balance, events: FillEvent[], orders:
   Order[] (every row touched), stats }`. The client **replaces** its preview
   state for those orders with the server rows. A mismatch between preview
   and server (should not happen — same code, same bytes) is logged and
   shown as a one-line "resynced" toast; the server row always wins.

Cost per request: one or two day-file reads per instrument with orders,
well under 10 ms locally. A trader with no open orders costs one `UPDATE`.

`AdvanceQueue` (client) serialises **all** mutations — advance, place, cancel,
close, modify — as one promise chain with `opId`s and a retry on network
error. Consecutive `advance`s waiting in the queue are **coalesced** into one
with the latest `toCursorMs` (the server walks the whole span either way);
an order op is never reordered relative to the advances around it, and an
order op carries `cursorMs` which must equal the server cursor (409
`CURSOR_MISMATCH` otherwise — which cannot happen if the queue is drained in
order, and is the guard against a second tab).

### 5.6 Which side does what (decisions 5 and 11)

| Concern | Client | Server |
|---|---|---|
| Cursor stepping, weekend/empty skipping | computes and renders instantly | validates monotonic, clamps to period, persists |
| Candles behind the cursor at tf | renders | serves (store + forming bar from 1m) |
| 1m ahead | caches, folds into tf | serves compact pages, clamped to period |
| Indicators | computes from `libs/indicators` over the panel's tf series (closed bars + forming) | nothing |
| Fills / SL / TP / costs | previews with `replay-core` | **authoritative** with `replay-core`; writes the rows |
| Floating PnL, open risk | computes with `replay-core.mark` | only for end-of-session close |
| Statistics | displays server numbers | stored aggregates + full recompute |
| Screenshots | captures canvas, uploads | stores, serves, deletes with the session |

---

## 6. Fill engine (`libs/replay-core/fill`, `costs`, `sizing`, `mark`)

Conventions, all in `Costs = { enabled, commissionPct, spread }`. `spread`
is the full bid/ask width in price units; the stored OHLC is treated as mid
(the `bid`/`ask` OHLC Capital.com candles carry is ignored in v1 — §12).
`half = enabled ? spread / 2 : 0`; `fee(notional) = enabled ? notional *
commissionPct / 100 : 0`.

| Event | Long | Short |
|---|---|---|
| Market entry at placement | `lastClose + half` | `lastClose - half` |
| Limit entry | fills on the first 1m candle with `low <= limit`, at `limit` | first candle with `high >= limit`, at `limit` |
| Stop exit | first 1m candle with `low <= sl`; price `sl - half`, or `open - half` if `open < sl` (gap through) | first with `high >= sl`; `sl + half`, or `open + half` if `open > sl` |
| Take-profit exit | first candle with `high >= tp`, at `tp`, or at `open` if `open > tp` | first with `low <= tp`, at `tp`, or `open` if `open < tp` |
| SL and TP both inside one 1m candle | **stop first** (`sl_tp_same_bar = true`, still `fill_resolution='1m'`) | same |
| Limit fill and SL/TP in the same candle | fill, then evaluate exits on that same candle, stop first | same |
| Manual close / end of session | `lastClose - half` | `lastClose + half` |

- `lastClose` = close of the last 1m candle revealed at the cursor.
- **Pessimistic fallback** (decision 4): the same table applied to bars of
  the session timeframe when no 1m exists for the span; `fill_resolution =
  'pessimistic-bar'`; the journal flags the trade.
- **Sizing** (decision 21): `riskAmount = balance * riskPct / 100`; `qty =
  riskAmount / |plannedEntry - sl|` where `plannedEntry` is the tool's entry
  (limit level, or last close for market). `qty` and `riskAmount` are fixed at
  placement; the spread does not re-size the order.
- **Costs**: `commission_ccy = fee(entry notional) + fee(exit notional)`;
  `spread_cost_ccy = half * qty * (sides that paid it)` — reported, and
  already embedded in the fill prices. `pnl_ccy = dir * (exit - entry) * qty -
  commission_ccy`; `pnl_r = pnl_ccy / riskAmount`.
- **MAE** (decision 26): worst adverse excursion on the 1m path from
  `entry_time_ms` to `exit_time_ms`: long `entry - min(low)`, short `max(high)
  - entry`; `mae_r = mae_price * qty / riskAmount`. Computed at close only.
- **Floating mark** (decision 35): `mark = lastClose ∓ half`; `floating =
  dir * (mark - entry) * qty - fee(entry notional) - fee(mark notional)`.
  `openRisk` = Σ over open positions of `|entry - sl_current| * qty` (what the
  current stops would lose, spread aside), shown on screen (decision 22).
- **Notional warning** (decision 25): the order panel warns when `qty *
  plannedEntry > balance * notional_warn_multiple`; default multiple **5**
  (session-configurable; open item resolved here).
- **No leverage model** (decision 25): balance may go negative; nothing
  liquidates.

`evaluateOrder(order, path, costs) → FillEvent[]` is the single entry point;
`FillEvent` is `{ orderId, kind: 'fill' | 'exit', time, price, reason?,
resolution }`. Both `AdvanceService` and `PortfolioStore.preview` call it with
the same 1m tuples decoded from the same store.

---

## 7. API surface

Prefix `/api`. JSON bodies; zod schemas in `libs/contracts/src/{auth,backtest}
.ts`; errors are `{ error: { code, message } }` with the codes named below.
"auth" = valid `bt_session` cookie; "admin" = auth + `role='admin'`; "public"
= `@Public()`. Every backtest route is scoped to the cookie's user; a session
belonging to another user is a 404, never a 403.

### 7.1 Auth and admin — the first write endpoints of this server

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| POST | `/auth/login` | public | `{email, password}` → 200 `{user: {id, email, role}}` + `Set-Cookie: bt_session`; 401 `INVALID_CREDENTIALS`; 403 `USER_DISABLED` |
| POST | `/auth/logout` | auth | → 204, cookie cleared, `auth_sessions` row deleted |
| GET | `/auth/me` | auth | → `{user}`; 401 otherwise (the client's boot probe) |
| GET | `/auth/invites/:token` | public | → `{email \| null, expiresAt}`; 404 `INVITE_UNKNOWN`; 410 `INVITE_USED` / `INVITE_EXPIRED` |
| POST | `/auth/invites/:token/accept` | public | `{email, password}` → 201 `{user}` + cookie. Atomic: `UPDATE invites SET used_at=now(), used_by=$u WHERE token_hash=$h AND used_at IS NULL AND expires_at > now()` must affect one row; 409 `EMAIL_TAKEN` |
| GET | `/admin/users` | admin | → `[{id, email, role, createdAt, disabledAt}]` — no session data (decision 30) |
| POST | `/admin/users/:id/disable` · `/enable` | admin | → 204; disable also deletes the user's `auth_sessions` |
| POST | `/admin/invites` | admin | `{email?}` → 201 `{id, url, expiresAt}` — `url = APP_BASE_URL + '/invite/' + token`, the token is returned **once** |
| GET | `/admin/invites` | admin | → `[{id, email, createdAt, expiresAt, usedAt, usedBy}]` (never the token) |
| DELETE | `/admin/invites/:id` | admin | → 204 for an unused invite; 409 `INVITE_USED` |

Cookie: `bt_session`, `HttpOnly; SameSite=Lax; Path=/; Secure` (Secure per
`SESSION_COOKIE_SECURE`), 30-day sliding expiry (refreshed on any request more
than one hour after `last_seen_at`). Password policy: ≥ 10 characters; scrypt
`N=2^15, r=8, p=1`, 16-byte salt. Login is rate-limited in memory to 10
failures per email per 15 minutes (429 `TOO_MANY_ATTEMPTS`) — cheap, and
enough for a closed contour.

Existing routes (`/instruments`, `/candles`, `/signals`, `/strategies`,
`/indicators`, `/layouts`, `/metrics`, `/calendar/*`) become **auth**
(decision 14). `/health` and the Prometheus `/metrics` endpoint under
`observability/` stay public (they are for the infrastructure, not the
user). WS: `handleConnection` parses the `Cookie` header and validates the
session; without a DB configured, the existing shared-token check remains.

Dev-mode CORS: `main.ts` already enables CORS when `CORS_ORIGIN` is set; it
must add `credentials: true`, and the client's `RestClient` sends
`credentials: 'include'`. Cookies are not port-scoped, so `localhost:4210 →
localhost:3010` works with `SameSite=Lax`. In production the server serves
the bundle same-origin (the existing `ServeStaticModule`).

### 7.2 Backtest

| Method | Path | Request → Response |
|---|---|---|
| GET | `/backtest/instruments` | → `[{id, displayName, assetClass, sessionCurrency, pricePrecision, coverage: {from, to} \| null}]` — `coverage` from `CandleStore.coverage(id, '1m')`; the create form offers only `coverage != null` (decisions 16, 5b) |
| GET | `/layouts` (existing) | presets; the client strips metric panels and enforces ≤ 4 (D10) |
| POST | `/backtest/sessions` | `CreateSession {name, layout, timeframe, periodFromMs, periodToMs, initialBalance, defaultRiskPct, costs: {enabled, commissionPct, spread}, skipWeekends?, notionalWarnMultiple?}` → 201 `Session`. 422 codes: `LAYOUT_TOO_MANY_PANELS`, `LAYOUT_NOT_CANDLES`, `MIXED_SESSION_CURRENCY`, `INSTRUMENT_NOT_AVAILABLE`, `PERIOD_OUTSIDE_COVERAGE` (period must intersect every panel's 1m coverage). `cursor_ms = periodFromMs`, `balance = initialBalance`, `status='active'` |
| GET | `/backtest/sessions` | → `SessionSummary[]` (config + aggregates; no orders) for the list (decision 38) |
| GET | `/backtest/sessions/:id` | → `SessionDetail {session, openOrders: Order[] (pending+open), stats}` |
| PATCH | `/backtest/sessions/:id` | `{name?, timeframe?, layout?}` → `Session`. `layout` is validated like create (P1 edit-inside-session, decision 10); 409 `SESSION_COMPLETE` for timeframe/layout on a complete session (view-only still allows the *client* to change tf locally without persisting) |
| DELETE | `/backtest/sessions/:id` | → 204 (S3 prefix first, then row; §3) |
| GET | `/backtest/sessions/:id/candles` | `?panelId&timeframe&before=<ms>&limit=<≤1500>` → `{bars: Candle[], forming: Candle \| null}`. Closed `timeframe` bars with `openTime + tfMs <= before`, the last `limit` of them, plus the forming bar from 1m in `[floor(before/tfMs)*tfMs, before)` when `before` is on no boundary. `before` must be `<= cursor_ms` (422 `FUTURE_REQUESTED`). Source: the store's persisted derived tf where present, else on-demand `foldOneMinute` from 1m (logged at `warn` so the derive job can be run) |
| GET | `/backtest/sessions/:id/candles/ahead` | `?panelId&fromMs&limit=<≤5000>` → `{candles: [openTime,o,h,l,c,v][], endOfTape: boolean}`; 1m with `openTime >= fromMs`, clamped to `period_to_ms` |
| POST | `/backtest/sessions/:id/advance` | `{opId, toCursorMs}` → `AdvanceResult {cursorMs, status, balance, events, orders, stats}` (§5.5). 409 `CURSOR_BACKWARDS`; 409 `SESSION_COMPLETE` |
| POST | `/backtest/sessions/:id/orders` | `{opId, cursorMs, panelId, side, type, limitPrice?, sl, tp?, riskPct}` → 201 `{order, events}`. Server computes `qty`/`riskAmount` from the session balance; a market order fills immediately at `lastClose ± half` with `entry_time_ms = openTime of the last revealed 1m candle`; a limit order is `pending`. 422 `SL_ON_WRONG_SIDE`, `TP_ON_WRONG_SIDE`, `LIMIT_ON_WRONG_SIDE` (a long limit must be below `lastClose`, a short above — stop entries are not in v1), `STOP_DISTANCE_ZERO`; 409 `CURSOR_MISMATCH`, `SESSION_COMPLETE` |
| POST | `/backtest/sessions/:id/orders/:orderId/cancel` | `{opId, cursorMs}` → `Order`; only `pending` (409 `ORDER_NOT_PENDING`) |
| POST | `/backtest/sessions/:id/orders/:orderId/close` | `{opId, cursorMs}` → `{order, stats, balance}`; only `open`; market exit at the cursor, `close_reason='manual'` |
| PATCH | `/backtest/sessions/:id/orders/:orderId` | `{opId, cursorMs, sl?, tp?}` → `Order` + `order_modifications` rows; only `pending`/`open`; the wrong-side checks apply (P2, decision 23) |
| GET | `/backtest/sessions/:id/orders` | `?status=` → `Order[]` ordered by `seq` (the journal) |
| GET | `/backtest/sessions/:id/orders/:orderId` | → `OrderDetail {order, modifications, screenshots: {entry?: url, exit?: url}}` |
| GET | `/backtest/sessions/:id/stats` | → `{computed: SessionStats, stored: SessionStats, drift: boolean}` — full recompute from the `orders` table (decision 38) |
| PUT | `/backtest/sessions/:id/orders/:orderId/screenshots/:kind` | body `image/png`, ≤ 2 MB → 201 `{key, width, height, bytes}`; `kind ∈ {entry, exit}`; 409 `SCREENSHOT_EXISTS` (a screenshot is written once) |
| GET | `/backtest/sessions/:id/orders/:orderId/screenshots/:kind` | → the PNG bytes, `Cache-Control: private, max-age=31536000` (proxied; the bucket stays private, no presigned URLs) |

Nothing here is a WebSocket. Replay is request/response by construction.

---

## 8. Statistics (`libs/replay-core/stats`)

Input: closed orders sorted by `exit_time_ms`, then `seq`. Output
`SessionStats`, every money figure in both currency and R:

- `trades`, `wins`, `losses`, `breakeven` (`pnl == 0`), `winRate`;
- `pnl` total; `grossProfit`, `grossLoss`, `profitFactor` (`null` when no
  losses);
- `equityCurve: {time, balance, balanceR}[]` — one point per close, starting
  at `(period_from_ms, initial_balance)` (decision 26); `maxDrawdown` measured
  on that stepped curve, as currency, R and % of peak;
- `avgWin`, `avgLoss`, `expectancyR`;
- `mae: {avg, worst}` in price-R terms (decision 26, separate from drawdown);
- `pessimisticTrades` (count of `fill_resolution='pessimistic-bar'`),
  `endOfSessionCloses`;
- per-instrument and per-side breakdowns (`trades`, `pnl`, `winRate`) — the
  P2 "full statistics" screen renders these; the P0 summary shows the first
  four bullets.

Stored aggregates on the session row are the subset that the sessions list
sorts and shows; the detail screen calls `GET …/stats` and shows `drift` if
the two disagree.

---

## 9. Chart interaction layer, screenshots, view-only rewind

### 9.1 Position tool on top of `ShapesPrimitive`

`ShapesPrimitive` stays render-only and untouched (the `AGENTS.md`
"mechanical moves stay mechanical" spirit — it is a stable, tested substrate).
Two new files beside it:

**`overlay/position-tool.primitive.ts`** — a second `ISeriesPrimitive`,
attached once per candle series, drawing `PositionToolState[]`:

```ts
interface PositionToolState {
  id: string; side: 'long' | 'short'; mode: 'market' | 'limit';
  entry: number; sl: number; tp: number | null;
  kind: 'draft' | 'pending' | 'position';   // draft = not yet an order; pending/position = live order rows
  orderId?: string; active: boolean;
}
```

Rendering reuses the visual vocabulary of `ShapesPrimitive` (translucent
rect from entry to SL in `#ef5350`, entry to TP in `#26a69a`, a ray at each
level with a right-edge label: price, distance, `R` multiple, `qty`). Drafts
draw three square handles; `position` drawings draw handles on SL/TP only
(P2 stop-moving) and none on entry; the active tool is drawn brighter. Pure
geometry (`labelFor`, `hitTest(px, py, handles, tolerancePx=6)`) lives in
`position-tool.geometry.ts` with its own spec.

**`overlay/position-tool.controller.ts`** — the pointer layer lightweight-
charts does not give a primitive. It attaches `pointerdown` / `pointermove` /
`pointerup` / `pointercancel` to the chart's container element (the
`ChartComponent`'s `#container`, which it already owns), converts to chart
space with `chart.timeScale().coordinateToTime()` and
`series.coordinateToPrice()`, and:

- on `pointerdown`: hit-tests every tool's handles and lines; a hit makes
  that tool **active** (decision 29, "last clicked") and starts a drag of
  that handle (or of the whole tool when the entry line of a draft is hit);
  during a drag it disables chart panning/zoom (`chart.applyOptions({
  handleScroll: false, handleScale: false })`) and calls
  `setPointerCapture`; a miss does nothing (the chart pans as usual);
- on `pointermove` while dragging: updates the handle's price (snapped to
  `pricePrecision`); dragging a draft's entry across the last close flips
  `mode` between `market` (entry snapped to last close) and `limit`;
- on `pointerup`: re-enables scroll/scale, releases capture, emits the
  changed state.

It emits through a small `PositionToolEvents` interface; `ChartComponent`
gains two inputs (`positionTools`, `positionToolsEnabled`) and one output
(`positionToolChange`) — the component stays presentational and under the
250-line rule by delegating to the controller.

**`core/replay/position-tools.store.ts`** (per panel, held by
`ReplayPanelSource`) owns the list: `B`/`S` create a draft at the crosshair
price (from `ChartComponent.crosshairTime`/a new `crosshairPrice` signal) or
at the last close when the pointer is off-chart, with `sl` at 0.5 % of price
on the adverse side (1 × ATR(14) of the panel's tf series once
`libs/indicators` is in the client, T-028) and `tp` at 2R; the new draft
becomes active. `Esc` removes the active draft. `Enter`
with an active draft → `AdvanceQueue.push(place)`; on the server's 201 the
draft becomes `pending` (limit) or `position` (market) carrying `orderId` —
**consumed** (decision 29). A `pending` drawing becomes `position` on the
fill event and disappears on the exit event. `Enter` with no active draft →
toast "No active position tool — press B or S" and nothing else (decision
29: never a guessed order). Hotkeys (decision 37b): `→` step, `B`/`S`,
`Enter`, `Esc`; the terminal's `[`/`]` keep switching tf; all ignored while
typing in an input.

### 9.2 Screenshots (decisions 6, 27)

Capture: `chart.takeScreenshot()` on the **panel that owns the order**
(primitives are drawn into the chart canvas, so the tool/position drawing is
in the picture), downscaled on an offscreen canvas to `min(width, 1280)` px
keeping aspect, `toBlob('image/png')`. Two moments:

- **entry**: synchronously in the `Enter` handler before the place request
  is sent — the picture the decision was made on, at placement even for a
  limit order;
- **exit**: in the `AdvanceQueue` response handler, for every `exit` event
  in the response, whatever closed it (stop, TP, manual, end of session).
  Coalesced advances can carry several exits in one response — each gets a
  capture, so a stop-out during fast stepping never lacks a picture. The
  picture may be up to one coalesced span later than the exact exit bar; the
  order row's `exit_time_ms` is the truth, the picture is the context.

Upload: `ScreenshotUploadQueue` (client), retrying with backoff, surviving
route changes within the app (it is a root service). The journal shows a
placeholder until the row exists.

Store key: `backtest/screenshots/user=<userId>/session=<sessionId>/order=<orderId>/<kind>.png`
— Hive-style like the candle keys, so a session delete is one
`deleteByPrefix('backtest/screenshots/user=<u>/session=<s>/')` and a user's
footprint is one prefix. `FileScreenshotStore` writes the same relative path
under `FILE_STORE_ROOT`. Size budget: a 1280-px PNG of a dark chart is
100–200 KB; 200 trades × 2 ≈ 60 MB per session, i.e. the "not gigabytes"
bound holds.

### 9.3 Trade detail and view-only rewind (decision 32)

`/sessions/:id/trades/:orderId` shows the order row, costs, R, MAE, the
modification list and both screenshots (served through the proxy endpoint).
"Show on chart" navigates to `/sessions/:id?viewAt=<entry_time_ms>&order=
<orderId>`. The workspace in **view-only** mode: history is loaded with
`before = viewAt`, the ahead cache and `AdvanceQueue` are not created, `→`,
`B`, `S`, `Enter` are inert (toolbar shows "viewing <time> — read only"), the
timeframe picker and indicators work (tf changes are not persisted), and the
order's drawing is shown as a `position` tool. Nothing touches `cursor_ms`,
so the session cannot be resumed from the past (decision 37).

---

## 10. Jobs: derive-timeframes and 1m backfill

**`derive-timeframes`** (P0, small): for each instrument in
`instruments.yaml` with 1m coverage, stream 1m through `Resampler` and
`upsert` every closed 5m/15m/1h/4h/1d bar with `source: 'resampled'`. Idempotent
(upsert on `(instrument, tf, openTime)`). No venue calls. Makes
`ReplayHistoryService` a plain store read for every tf; the on-demand fold is
the fallback, not the path.

**`backfill`** (P2, decision 9/16): `node dist/jobs/backfill.js --instrument
<id> [--from <iso>]` — instrument ids from `instruments.yaml` only (never
hardcoded), resumable from `CandleStore.latestOpenTime` backwards to the
vendor floor, then runs `derive-timeframes` for that instrument.

- Binance: `fapi/v1/klines?limit=1500` is **weight 10** per request;
  throttled to 1 request/s ⇒ **600 weight/min = 25 % of the 2400 budget**
  (`AGENTS.md` rule). A seven-year 1m tape is ~2,450 requests ≈ 41 min per
  symbol.
- Capital.com: 720-bar pages, throttled to 1 request/s; from the 2024-01-02
  intraday floor to today is ~2,000 requests ≈ 34 min per instrument.
- Instruments to add to `instruments.yaml` for this: `capitalcom:EURUSD`,
  `capitalcom:GBPUSD` (`sessionCurrency: USD`); `EURCHF`/`GBPCHF` already
  exist (`CHF`). The `binance:*` entries gain `sessionCurrency: USD` (D11).

---

## 11. Repository layout of the new code

```
libs/indicators/{package.json,tsconfig.json,jest.config.js,src/index.ts,src/{atr,vwap,range,previous-hour,fvg,ema,sma,rsi,macd,bollinger,stochastic}.ts,test/}
libs/replay-core/{package.json,tsconfig.json,jest.config.js,src/index.ts,src/{resample,calendar,fill,costs,sizing,mark,stats}/,test/}
libs/contracts/src/{auth.ts,backtest.ts}              (+ instrument.ts: sessionCurrency; wire.ts re-exports)
apps/signal-server/migrations/001.do.init.sql, 001.undo.init.sql
apps/signal-server/src/db/{db.port.ts,db.module.ts,migration-runner.ts,migrate.ts,pg/pg-database.ts}
apps/signal-server/src/auth/{auth.module.ts,auth.service.ts,auth.guard.ts,public.decorator.ts,current-user.decorator.ts,password.ts,session-cookie.ts,admin-bootstrap.service.ts,login-throttle.ts,*.repository.port.ts,pg/*.ts}
apps/signal-server/src/backtest/{backtest.module.ts,session.service.ts,session-validation.ts,replay-history.service.ts,replay-ahead.service.ts,order.service.ts,advance.service.ts,stats.service.ts,screenshot.service.ts,*.repository.port.ts,pg/*.ts}
apps/signal-server/src/api/rest/{auth.controller.ts,admin.controller.ts,backtest/{instruments,sessions,candles,orders,screenshots}.controller.ts}
apps/signal-server/src/storage/{screenshot-store.port.ts,file/file-screenshot-store.ts,s3/s3-screenshot-store.ts}
apps/signal-server/src/jobs/{derive-timeframes.ts,backfill.ts}
apps/chart-client/src/app/app.routes.ts
apps/chart-client/src/app/core/auth/{auth.service.ts,auth.guard.ts,admin.guard.ts}
apps/chart-client/src/app/core/api/backtest.client.ts
apps/chart-client/src/app/core/replay/{replay-engine.ts,ahead-cache.ts,advance-queue.ts,replay-panel-source.ts,replay-session.store.ts,position-tools.store.ts,portfolio.store.ts,screenshot-upload.queue.ts,capture-chart.ts}
apps/chart-client/src/app/features/auth/{login,invite-accept}.component.{ts,html,scss}
apps/chart-client/src/app/features/sessions/{session-list,session-create}.component.*, session-form.validation.ts
apps/chart-client/src/app/features/backtest/{workspace,replay-toolbar,order-panel,positions-panel,journal,stats-summary,stats-full,trade-detail,indicator-picker,layout-editor}.component.*
apps/chart-client/src/app/features/admin/users.component.*
apps/chart-client/src/app/features/chart/overlay/{position-tool.primitive.ts,position-tool.controller.ts,position-tool.geometry.ts}
apps/chart-client/src/app/features/panel-grid/panel-source.ts
apps/chart-client/mock-server/{auth.ts,backtest.ts}   (mock routes so the client builds against :4300 without a DB)
```

Every new Angular component follows `AGENTS.md`: three files, standalone,
OnPush, signal inputs, ≤ 250 lines in the `.ts`, pure helpers in their own
files with specs.

---

## 12. Risks and the sharpest trade-offs

1. **The future is served to the client** (`/candles/ahead`). Deliberate:
   without it, stepping and the fill preview would round-trip (decision 5
   forbids that). The server remains the authority on trades. A trader who
   reads the network tab defeats their own practice, nothing else.
2. **Two evaluations of every fill** (client preview, server truth). Same
   package, same bytes, so they agree; the reconcile-on-response path exists
   for the day they do not (a store re-write between the two reads, a client
   cache bug). The cost of *not* doing this is a per-step round trip.
3. **Coalesced advances make exit screenshots late** by up to the coalesced
   span when the trader out-runs the network. Accepted: the row is exact, the
   picture is context, and the alternative (block stepping on the response)
   is exactly the feel decision 5 forbids.
4. **Built-package libs slow iteration.** Every change to `replay-core` or
   `indicators` needs `npm run build -w libs/<name>` before the client or
   server sees it. Mitigation: `npm run watch` scripts in each lib. Not
   introducing path aliases because the existing `contracts` package and the
   server's `Dockerfile` are built around package consumption; changing that
   is a separate decision.
5. **File-store reads on the advance path.** One or two day files per
   instrument with open orders per advance; fine locally, and on AWS the S3
   `CandleStore` does a `GetObject` per day — 50–100 ms per advance with
   open orders, invisible to the user because the response is asynchronous.
   If it ever matters, a per-instrument LRU of decoded day objects inside
   `ReplayAheadService`/`AdvanceService` is a contained change.
6. **`USDT` ≈ `USD`** is a configuration statement (`sessionCurrency`), not a
   conversion; there is no FX conversion anywhere (decision 36).
7. **Spread is a session constant**; the bid/ask OHLC Capital.com candles
   carry is ignored in v1. A per-candle spread is a later change to
   `costs/` only.
8. **A single Postgres for all worktree slots** with a database per slot:
   two migrations racing are prevented by the advisory lock; a slot forgetting
   to set its `DATABASE_URL` would land in the coordinator's database — the
   default `DATABASE_URL` therefore has **no default**; the server refuses to
   enable the DB module without an explicit value.
9. **Numeric precision**: `numeric(20,8)` in the DB, `number` (float64) in
   both runtimes. Prices ≤ 10⁶ with 8 decimals and quantities down to 10⁻⁸
   are exact enough for a training journal; the server rounds to 8 decimals
   before writing and never compares floats for equality across the two
   sides (it replaces client state, it does not diff it).
10. **No back step means a mis-press of `→` is irreversible.** By design
    (decision 37). The toolbar shows the cursor time prominently, and the
    step key does nothing while a page is loading, so the trader is never
    stepping blind.
11. **Deleting a user** is not designed: it would cascade to every session and
    screenshot prefix. `disable` covers the closed contour for now; a delete
    is a small later task (S3 prefix per user, then the row).

---

## 13. Interpretations of the brief (visible, not silent)

| Decision | Interpretation taken here |
|---|---|
| 19 — "weekends are skipped entirely" | Weekend = `[Sat 00:00, Mon 00:00) UTC`, applied by default. Crypto trades on weekends, so a `skipWeekends` flag on the session (default **true**, set at creation) lets a crypto-only session keep its Saturday and Sunday bars. The empty-stretch rule applies regardless. |
| 28 — force-close "at the last price" | Treated as a **market exit**: spread and commission apply, like a manual close. A trader forced out at the end of a tape pays what a market exit costs; "at the last price" is read as "at the price then prevailing", not "for free". |
| 5 — "server recomputes each trade on close" | The server evaluates on every `advance` (§5.5), which *includes* recomputing each trade at close and additionally persists the cursor. A superset, not a deviation. |
| 17 — "~500 candles ahead" | Sized in bars of the current tf and held as 1m (§5.3), capped at 50k 1m candles for 4h/1d. |
| 21 — "no order without a stop" | Take-profit is optional; the stop is mandatory. |
| 22 — several positions incl. opposing | Positions are independent rows; an opposing position does not net against an existing one. |
| 23 — cancel / move | Manual **market close** of an open position is included (P0) — the brief's "trade close" needs an exit path other than SL/TP. |
| 29 — entry type | A draft tool is `market` while its entry sits on the last close and `limit` once dragged to the limit side; a stop-entry (entry on the wrong side) is refused with a hint — stop-entries are not in the brief. |
| 25 — warning multiple | **5×** deposit, per session. |
| 36 — one quote currency | `USDT`-quoted instruments declare `sessionCurrency: USD` in `instruments.yaml`; groups are derived from that field only. |
| 31 — timeframes | Sessions may be created and switched on all six timeframes. |

---

## 14. Conflicts found

None that block a task. Every numbered decision maps to a mechanism above.
Two places where the brief's literal wording and the mechanism needed care
are recorded as interpretations (§13, decisions 19 and 28) rather than as
conflicts; neither reopens a product question, both keep the decision's
default behaviour.

One repository fact worth the coordinator's attention: `LayoutSchema` allows
6 panels and metric panels; session layouts are validated to the stricter
subset (≤ 4, candles only) with a **separate** `SessionLayoutSchema` in
`contracts/backtest.ts` rather than by changing `LayoutSchema` — the live
terminal keeps its 6-panel/metric layouts untouched.

---

## 15. Sequencing summary (the task graph is in `tasks.jsonl`)

Roots (no dependencies): `libs/indicators` lift (T-001), `libs/replay-core`
scaffold + resampler lift + calendar (T-002), contracts extension (T-003),
DB adapter + migrations (T-004), chart-kit `PanelSource` boundary (T-016).
Everything P0 flows from those five; the first user-visible milestone is
login → create session → step → place → fill → journal, which is the P0
cluster the Tech Lead will want to accept as one.

## 16. Logging decision

No `IDEAS-BACKLOG.md` or `RESEARCH-LOG.md` entry: this is infrastructure for
manual practice, not a trading idea and not a research pass. `PROJECT.md`'s
architecture table gains a row for this note (coordinator's edit).
