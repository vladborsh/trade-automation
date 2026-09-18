# Routing note — four client/server workstreams (2026-09-18)

**Role:** Architect. **Status:** routed. This note holds only routing and sequencing; the
designs live where their areas already live:

| Stream | Design |
|---|---|
| A — OI in USD notional, OI as candles | [`chart-layouts.md`](chart-layouts.md) §11.1–§11.2 (+ follow-up line in [`coinalyze-oi-assessment.md`](coinalyze-oi-assessment.md) §7) |
| B — horizontal columns, collapsible panels | [`chart-layouts.md`](chart-layouts.md) §11.3 |
| C — calendar filters, settings, flags, sound | [`economic-calendar.md`](economic-calendar.md) §11 |
| D — templates/styles out of components | D1: [`AGENTS.md`](../AGENTS.md) (+ `CLAUDE.md` importing it); D2: below |

## Sequencing

```
D1 (architect, done on branch architect-four-streams — AGENTS.md, CLAUDE.md, angular.json schematic)
 │   every developer branch below is cut FROM architect-four-streams, so the rule is in
 │   their checkout before they write a line
 ├── SE-A1  unit tag ───────────┬── SE-A2  USD tip notional (server)
 │                               └── SE-A3  OHLC bucketing + client OI rendering
 ├── SE-B   horizontal columns + collapse
 └── SE-C   calendar filters/flags/sound
                     all of A, B, C merged
                               └── SE-D2  migrate every component to .html/.scss + guard
```

- **A ∥ B ∥ C** from the start: disjoint folders. Only shared file between A and B is
  `chart.component.ts` (A3: metric series style swap; B: join-don't-lead, resize
  suppression, reassert). Different methods; the coordinator merges B before A3 or vice
  versa and the second rebases — flagged, not avoided, because splitting that file first
  would itself be a conflicting refactor.
- **SE-A2 ∥ SE-A3** after SE-A1 lands; both branch from SE-A1's branch. A2 touches only
  ingestion/mapper/store repair; A3 touches `metric.ts` bucketing, `metrics.controller`,
  `live.gateway`, mock server and client.
- **D2 last**, on a branch cut from `master` after A, B and C are merged — it touches every
  component and would conflict with anything in flight.

## D2 — one developer, not split (decision)

16 components; the move is mechanical. Splitting by feature folder would parallelise
~16 file moves at the cost of three branches that all touch `angular.json`/the guard spec
and three full test runs to merge — more coordination than work. One developer, **one
commit per feature folder** (reviewable, bisectable), then a final commit adding the guard:

- For every `@Component` in `apps/chart-client/src`: `template:` → `<name>.component.html`,
  `styles:` → `<name>.component.scss`, `templateUrl`/`styleUrl`. Byte-for-byte relocation:
  no markup, selector, class or behaviour change (AGENTS.md rule 6). `app.ts` included.
- **Guard:** a spec (`src/app/component-files.spec.ts`) that globs `src/**/*.component.ts`
  (and `app.ts`) and fails on any `template:` or `styles:` key inside `@Component`, and
  on a `.component.ts` over 250 lines unless listed in an explicit, commented allowlist
  (today: `chart.component.ts` — shrinking it is separate work, not D2).
- Acceptance: `npx ng build` clean; `npx ng test --watch=false` — same count as before D2
  plus the guard, all green; `npm run e2e` against the mock server green; a before/after
  screenshot of both views on the mock server, identical.

## Developer tasks

Each is dispatched as its own Orca task; branch = worktree name; base branch as stated.
Every task: read `AGENTS.md` first; run your own mock server / dev server on your own ports;
client tests green with the count reported; `worker_done` with the branch name.

### SE-A1 — `se-oi-unit-tag` (base: `architect-four-streams`)
chart-layouts §11.1 "Prerequisite — the unit tag": `MetricUnitSchema`,
`NotionalBasisSchema`, `unit` required + `notionalBasis` optional on `MetricObservation`,
carried by `MetricPoint`; Binance mapper writes `unit: 'base'`, `notionalBasis: 'venue'` on
history rows; `upgradeLegacyObservation` on the file + S3 store read path (tests with a
legacy JSONL line); replay fixtures; mock server; panel header shows the unit
(`BTCUSDT · Open interest · BTC`). Contracts, server and client tests green. Small — merge
target for A2/A3.

### SE-A2 — `se-oi-usd-tip` (base: `se-oi-unit-tag`, after A1 lands)
chart-layouts §11.1 "The live tip" + "Legacy tip rows": derived notional at ingestion
(closed-1m-candle rule, 120 s staleness), `metric_notional_missing_total`, boot-time repair
of legacy snapshots, **the join measurement** with the pre-authorised decision rule
(numbers in the adapter header + PR). Server only. Note the Binance budget: the measurement
is a one-off ≤ 30 calls; the mark-price fallback, if triggered, is +1 weight/min.

### SE-A3 — `se-oi-candles` (base: `se-oi-unit-tag`, after A1 lands)
chart-layouts §11.2 in full: `MetricOhlcSchema`, new `MetricPoint`, `bucketObservations`
with 5 m sample grain + open = previous close (pure, all old tests kept and extended),
REST lead-bucket, gateway from `MetricCache`, mock server, client `metricSeriesStyle`,
series swap, notional plotting with whitespace gaps, compact USD formatter, caption chip,
OI candle colours, header unit `USDT`. Playwright: 1m = line + caption, 5m/15m = candles,
WS point equals REST point for the forming bucket.

### SE-B — `se-panel-columns` (base: `architect-four-streams`)
chart-layouts §11.3 in full, including the yaml migration, `CollapsedPanelsStore`, and the
three sync rules. **The restore-joins-the-shared-range rule is the one most likely to
break; its Playwright acceptance sequence in §11.3 is mandatory, not optional.**

### SE-C — `se-calendar-alerts` (base: `architect-four-streams`)
economic-calendar §11 in full. Client only. The arm affordance and the alarm's
independence from week navigation are the two review points.

### SE-D2 — `se-component-files` (base: `master` after A1–A3, B, C are merged)
§D2 above.

---

## Для пользователя — три решения, которые я принял за вас

**1. Свечи открытого интереса (ОИ).** Биржа отдаёт ОИ одной цифрой раз в 5 минут, а для
свечи нужно четыре (открытие, максимум, минимум, закрытие). Я сделал так: *открытие* каждой
свечи — это закрытие предыдущей, поэтому тело свечи показывает, насколько ОИ изменился за
период. На 5-минутках получаются свечи без теней (внутри 5 минут у нас только одна точка),
на 15 минутах и выше появляются тени. **На 1-минутном таймфрейме — линия, а не свечи**: там
история всё равно состоит из точек раз в 5 минут, и свечи выглядели бы как сломанные
чёрточки. Над панелью будет короткая подпись, почему так. Свечи ОИ — синие/оранжевые,
чтобы их нельзя было спутать со свечами цены.

**2. ОИ в долларах — без переключателя.** История берётся в долларах прямо от Binance (они
сами публикуют эту цифру). Для самой свежей точки Binance доллары не даёт, поэтому мы
умножаем количество BTC на цену последней закрытой минутной свечи — той же, что вы видите
на графике BTC. Если цены нет или она старая — точку в долларах не рисуем, а не рисуем
«примерно». Переключатель «BTC ↔ доллары» не делаю: вы просили доллары, а переключатель
— это отдельная настройка и второй режим отрисовки. Данные в BTC сохраняются, так что
добавить его потом — несложно.

**3. Фильтр календаря: «праздник» — это не уровень важности.** В фиде ForexFactory
«Holiday» — это отдельный тип записи (банковский выходной), а не ступенька выше «High».
Поэтому вместо «важность от … и выше» будут переключатели по каждому типу: Medium, High,
Holiday (включены по умолчанию), Low и Unknown (выключены). Валюты по умолчанию — USD, EUR,
GBP; всё это меняется в панели фильтров и запоминается; есть кнопка «Сбросить по
умолчанию». Флаг у евро — флаг ЕС 🇪🇺. Звуковое оповещение по умолчанию выключено: браузер
не даёт играть звук, пока вы не кликнули по странице, поэтому звук включается кнопкой
«Sound alerts» (сразу проигрывает сигнал для проверки), а если после перезагрузки звук ещё
не «разблокирован», на колокольчике будет видно, что нужен один клик.

Ещё одно, менее заметное: все панели теперь всегда идут **в одну строку слева направо**
(раньше «Крипто» был 2×2, а «US indices» — столбиком). Свернуть последнюю открытую панель
нельзя — кнопка будет неактивна, так что пустого экрана не бывает.
