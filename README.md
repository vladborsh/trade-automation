# trade-automation

A monorepo (npm workspaces) for crypto market tooling: a Telegram/web **insight bot** for a small
group of members, and a **manual-backtest** app (server + SPA). Mission, scope and the user's
standing rulings are in [`PROJECT.md`](PROJECT.md); system designs are in
[`architecture/`](architecture/).

## What is in here

| Path | What it is | Database | Docs |
|---|---|---|---|
| `apps/insight-bot` | NestJS: the Telegram member bot, the web API and the dashboard bundle it serves, the liquidation collectors (Binance, Bybit, OKX) and the economic calendar | Postgres (`insight_<slot>`); boots without one | [`apps/insight-bot/README.md`](apps/insight-bot/README.md) |
| `apps/signal-server` | NestJS: instruments, candles, backtest sessions, auth for the backtest SPA (REST + WS) | Postgres (`backtest_<slot>`); boots without one | [`apps/signal-server/README.md`](apps/signal-server/README.md) |
| `apps/chart-client` | Angular workspace with two projects: `chart-client` (the backtest SPA) and `insight-dashboard` (the insight bot's dashboard) | — | [`apps/chart-client/README.md`](apps/chart-client/README.md) |
| `libs/*` | Shared packages (`contracts`, `indicators`, `replay-core`, `binance-client`, `market-data-core`, `calendar-core`), built before the apps | — | — |
| `infra/insight-bot` | OpenTofu + scripts for the AWS Tokyo box | — | [`infra/insight-bot/README.md`](infra/insight-bot/README.md) |
| `tasks/`, `agents/` | The work queue and the agent roles that work it | — | [`AGENTS.md`](AGENTS.md) |

## Setting up

- **Node 24** (pinned in [`.nvmrc`](.nvmrc): `nvm install && nvm use` in the repo root), npm 11.
  Node 25+ ships its own `localStorage` global that shadows jsdom's and breaks dozens of client
  tests; `apps/chart-client`'s test scripts pass `--no-experimental-webstorage` so they stay
  green on either, but build and run on 24.
- **A fresh machine:** [`docs/RESTORE-NEW-MACHINE.md`](docs/RESTORE-NEW-MACHINE.md) — Postgres,
  roles and databases, build, migrations, env files, running both apps. Being revised under
  WD-005: where it says the liquidation collectors were removed, that was reversed on
  2026-10-31 (they stay).
- **Environment variables:** each app has a committed template, `apps/insight-bot/.env.example`
  and `apps/signal-server/.env.example`. Copy it to `.env` next to it and uncomment what you set.
  Names and safe defaults only — the secrets (Telegram bot token, Capital.com key, admin
  password, VAPID private key) come from the owner, and `.env` is never committed.
- **Ports and databases are per slot** (coordinator, dev-1…dev-3, tester): the table is in
  [`AGENTS.md`](AGENTS.md) → "Working in a worktree".

## Everyday commands (repo root)

```sh
npm ci              # install every workspace
npm run build       # libs first, then the apps
npm test            # every workspace's tests
```

Client tests run from `apps/chart-client` with `npm test`, which runs **both** Angular projects; a
bare `npx ng test` picks one and reports only its count.

## Rules for agents

[`AGENTS.md`](AGENTS.md) (loaded by Claude Code through `CLAUDE.md`). The first rule: never read,
print or commit a `.env` file.
