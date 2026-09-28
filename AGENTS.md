# Agent rules for this repository

Read by every coding agent working here (Codex reads this file directly; Claude Code
loads it through `CLAUDE.md`). Keep it short: only rules an agent would otherwise get
wrong. Project context lives in `PROJECT.md`; system designs live in `architecture/`.

## Secrets

- Never read, print, log or commit any `.env` file (`cmc-bot-main/.env` holds live broker
  credentials). `.env` files are gitignored; keep them that way.

## Angular components (`apps/chart-client`)

**One component = three files.** Established 2026-09-18 after every component in the
client was found with inline `template:` / `styles:` (a 656-line `chart.component.ts`).

1. **Template in `<name>.component.html`, styles in `<name>.component.scss`,** referenced
   with `templateUrl: './<name>.component.html'` and `styleUrl: './<name>.component.scss'`.
   No inline `template:` and no inline `styles:` in any `@Component`, however small.
   The only exception: throwaway host components declared *inside* a `*.spec.ts`.
2. **The `.component.ts` holds the component class only:** inputs/outputs, injected
   dependencies, signals/computeds, event handlers. Anything that can be a pure function
   (data mapping, range maths, formatting, filtering) goes in its own `*.ts` file next to
   the component and gets its own `*.spec.ts`. Precedents: `chart-data.adapter.ts`,
   `logicalToTimeSec` in `chart.component.ts` (should have been its own file).
3. **Soft ceiling: 250 lines per `.component.ts`.** Crossing it is a signal to extract a
   pure helper, a renderer or a service — not a hard fail, but a PR that grows a component
   past it must say why in its description. Do not make an existing oversized file bigger
   without extracting something first.
4. **Styles are per-component and scoped.** Global rules only in `src/styles.css`. Reuse the
   existing dark-terminal palette (`#0d1117` background, `#30363d` borders, `#c9d1d9` text,
   `#8b949e` muted, `#26a69a` / `#ef5350` up/down) rather than inventing near-duplicates.
5. **New components:** `standalone: true`, `ChangeDetectionStrategy.OnPush`, signal
   `input()` / `output()` for new APIs. Generate with
   `npx ng generate component <feature-folder>/<name> --flat` from `apps/chart-client` —
   the schematic is configured (`angular.json`) to emit `<name>.component.ts/.html/.scss`;
   without `--flat` it adds a sub-folder, which this repo does not use.
6. **Mechanical moves stay mechanical.** Moving a template or styles out of a `.ts` file is
   a pure relocation: no markup, selector, class-name or behaviour change in the same
   commit.

## Working in a worktree

- **Ports are assigned per slot, not chosen per session.** Starting a server on a port
  that is not yours will collide with another agent's running instance and give you (or
  them) someone else's state.

  | Slot | Signal server | Client dev server | Insight bot | Insight-bot database |
  |---|---|---|---|---|
  | Coordinator / Tech Lead checkout | `:3000` | `:4200` | `:3005` | `insight_coord` |
  | dev-1 | `:3010` | `:4210` | `:3015` | `insight_dev1` |
  | dev-2 | `:3020` | `:4220` | `:3025` | `insight_dev2` |
  | dev-3 | `:3030` | `:4230` | `:3035` | `insight_dev3` |
  | Tester | `:3040` | `:4240` | `:3045` | `insight_tester` |

  The mock server (`npm run mock-server` in `apps/chart-client`) stays on its default
  `:4300`. Once the backtest app's database exists, each slot also gets **its own
  database inside the one local Postgres** (`backtest_dev1`, `backtest_dev2`,
  `backtest_dev3`, `backtest_tester`) — one server, separate databases, so migrations
  run in one worktree never break another. The insight bot (`apps/insight-bot`) follows
  the same rule on the same Postgres with its own databases (`insight_<slot>`, column
  above) and its own Telegram **test bot per slot**, token in the slot's `.env`; there is
  one production bot. If you are not one of the slots above, take the next free
  `:30x0`/`:30x5`/`:42x0` triple and say which one you took.
- `apps/chart-client/public/config.json` may carry an uncommitted local change in the
  coordinator's checkout — never commit or revert a change to it you did not make.
- Client tests: `npx ng test --watch=false` from `apps/chart-client` (no `--browsers`
  flag — it fails). All must stay green; report the count.
- Binance REST budget is 2400 weight/min and we use ~1 %. Any design that adds a polling
  loop against a venue must state its weight per minute.
