# Поднять проект на новой машине — инструкция для агента

Ты читаешь это, потому что репозиторий оказался на чистой машине и надо поднять локальную
инфраструктуру с нуля. Ты видишь проект впервые, поэтому у каждой команды указан рабочий каталог,
а у каждого шага — **признак успеха**: что именно ты должен увидеть. Не видишь — шаг не сделан,
дальше не иди.

Всё ниже прогнано на этой машине 2026-11-02 (macOS, **Intel x86_64**, Homebrew в `/usr/local`),
слот dev-1. Где шаг проверить не удалось — так и написано, с причиной.

Секреты ты создать не можешь: их приносит владелец. Где нужен секрет, инструкция останавливается
и говорит, что именно попросить (§5).

---

## 0. Что в репозитории

Монорепозиторий npm workspaces (`$REPO` ниже — корень клона):

| Каталог | Что это | База |
|---|---|---|
| `apps/insight-bot` | NestJS: Telegram-бот для участников, web-API, раздача дашборда, **сборщики ликвидаций** с Binance/Bybit/OKX по websocket, экономический календарь | Postgres `insight_<слот>`; без базы тоже поднимается |
| `apps/signal-server` | NestJS для SPA ручного бэктеста: инструменты, свечи, сессии, вход | Postgres `backtest_<слот>`; без базы тоже поднимается |
| `apps/chart-client` | Angular, **два** проекта: `chart-client` (SPA бэктеста) и `insight-dashboard` (дашборд бота) | — |
| `libs/*` | общие пакеты; собираются первыми | — |
| `infra/insight-bot` | OpenTofu и скрипты бокса в AWS Токио | — |

> **Что сейчас на самом деле работает.** insight-bot на master — это полная версия, которая
> копит данные: при наличии базы на старте он подключает websocket-сборщики (свечи, mark price,
> ликвидации, OI/long-short, контекст рынка, календарь) и создаёт ~40 таблиц. Свёртка в
> on-demand-фасад запланирована задачами WD-006…WD-013 (`tasks/wind-down.jsonl`), но **ещё не
> сделана**. По решению владельца 2026-10-31 **сбор ликвидаций остаётся и после свёртки**: история
> ликвидаций есть только в websocket, задним числом её не отдаёт ни одна биржа. Если читаешь это
> после WD-006/WD-010 — список таблиц в §4 станет короче; сверяйся с `migrations/`, а не с этим
> текстом.

## 1. Инструменты

Рабочий каталог: любой.

```bash
brew --version                       # Homebrew уже стоит; если нет — https://brew.sh
brew install nvm postgresql@16 opentofu cloudflared
mkdir -p ~/.nvm
```

`jq` (им удобно читать `/health`) в macOS уже есть: `/usr/bin/jq`.

На Intel `postgresql@16` **собирается из исходников** (готового бинарника нет) — около 5 минут,
команда при этом молчит. Это нормально, не прерывай.

**Признак успеха:**

```bash
tofu version          # OpenTofu v1.13.x   (нужен для бокса, IB-073)
cloudflared --version # cloudflared version 2026.x  (Cloudflare Tunnel, IB-074)
```

### Node 24 — строго

Версия зафиксирована в `$REPO/.nvmrc` (`24`). В `package.json` написано `>=22`, но **Node 25+
ломает тесты клиента**: у него свой глобальный `localStorage`, он затеняет jsdom-овский, и падают
десятки тестов с `Cannot read properties of undefined (reading 'clear')`. Скрипты тестов в
`apps/chart-client` уже передают `--no-experimental-webstorage` и зелёные и на 26, но собирай и
запускай на 24.

```bash
cd $REPO
source "$(brew --prefix nvm)/nvm.sh"   # nvm из brew; при установке скриптом с github — source ~/.nvm/nvm.sh
nvm install                 # читает .nvmrc
nvm use
node -v                     # v24.x
npm -v                      # 11.x
```

**Признак успеха:** `node -v` начинается с `v24`. Каждая новая оболочка начинается с системного
Node (на этой машине — 26), поэтому `nvm use` в `$REPO` делай в каждой.

## 2. Код и сборка

```bash
cd $REPO
npm ci
npm run build
```

`npm run build` собирает в заданном порядке: `libs/*`, потом `signal-server`, `insight-bot`,
`chart-client`. **Дашборд (`insight-dashboard`) корневая сборка НЕ собирает** — он нужен только
если раздаёшь его ботом (§6).

- `npm ci` печатает `npm warn install-scripts … not yet covered by allowScripts` (esbuild, lmdb,
  msgpackr-extract и т. п.). Это безвредно: их готовые бинарники приходят опциональными пакетами.
  Не «чини» массовым одобрением скриптов.

**Признак успеха:** обе команды завершились с кодом 0, и есть оба файла:

```bash
ls apps/insight-bot/dist/main.js apps/signal-server/dist/main.js
```

**Если `dist/` пустой, а ошибок нет** — устаревший `tsbuildinfo` (у обоих серверов
`deleteOutDir: true` + `incremental: true`: Nest стирает `dist/`, `tsc` считает, что всё
собрано, и ничего не пишет):

```bash
rm -f apps/insight-bot/tsconfig.tsbuildinfo apps/signal-server/tsconfig.tsbuildinfo
npm run build
```

После изменений в `libs/contracts` сначала пересобери (`npm run build`) и только потом верь
ошибке типов: оба Angular-проекта компилируются против `libs/contracts/dist`.

## 3. Postgres — один на машину, базы по слотам

Нативный, из Homebrew (в репозитории есть `docker-compose.yml` с Postgres, но им не пользуются).
**Один сервер на всю машину**; у каждого слота свои базы внутри него. Если Postgres уже стоит
(`brew services list | grep postgresql@16` → `started`) — второй не ставь, переходи к ролям.

Кластер Homebrew создаёт сам при установке (`initdb` в `$(brew --prefix)/var/postgresql@16`).
Запусти его **с регистрацией в автозапуске**:

```bash
brew services start postgresql@16
```

> **Именно `start`, не `run`.** `run` поднимает сервер до перезагрузки и в автозапуск не
> прописывает. На старой машине так и было, и «Postgres не в автозапуске» всплывало раз за разом.
> `start` кладёт `~/Library/LaunchAgents/sh.brew.postgresql@16.plist`.

`psql` и прочие утилиты **не попадают в PATH** (`postgresql@16` — keg-only). На Intel:

```bash
export PATH="/usr/local/opt/postgresql@16/bin:$PATH"
echo 'export PATH="/usr/local/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
```

На Apple Silicon префикс другой: `/opt/homebrew/opt/postgresql@16/bin`. Универсально:
`"$(brew --prefix)/opt/postgresql@16/bin"`.

**Признак успеха:**

```bash
pg_isready                                   # /tmp:5432 - accepting connections
brew services list | grep postgresql@16      # postgresql@16 started … sh.brew.postgresql@16.plist
```

### Роль и базы

Проект ходит под локальной ролью `backtest` с паролем `backtest` — это соглашение локальной
машины, а не секрет; наружу роль не выходит. `createdb` нужен: тесты создают и удаляют свои
временные базы.

```bash
psql -d postgres -c "create role backtest with login password 'backtest' createdb"
for s in coord dev1 dev2 dev3 tester; do
  psql -d postgres -c "create database insight_$s owner backtest"
  psql -d postgres -c "create database backtest_$s owner backtest"
done
psql -d postgres -c "create database backtest owner backtest"   # служебная, к ней подключается README signal-server
```

Работаешь один, без параллельных агентов — хватит `coord`, остальные можно не создавать.

**Признак успеха:**

```bash
psql -d postgres -tAc "select count(*) from pg_database where datname ~ '^(insight|backtest)_'"   # 10
psql "postgresql://backtest:backtest@localhost:5432/insight_coord" -tAc "select current_user"     # backtest
```

Строка подключения везде одна: `postgresql://backtest:backtest@localhost:5432/<база>`.

## 4. Миграции

Каждый слот мигрирует **только свои** базы. Пример — слот coord:

```bash
cd $REPO/apps/insight-bot
DATABASE_URL=postgresql://backtest:backtest@localhost:5432/insight_coord npm run migrate
cd $REPO/apps/signal-server
DATABASE_URL=postgresql://backtest:backtest@localhost:5432/backtest_coord npm run migrate
```

Миграции читают только `DATABASE_URL`. При запуске приложения они применяются и сами
(`DB_MIGRATE_ON_BOOT=true` по умолчанию), но ручной прогон отделяет ошибку схемы от ошибки
запуска. Номера 013 и 014 у insight-bot пропущены намеренно — это не дыра.

**Признак успеха:** последняя строка — `Migrations: applied <N>.do.…` или
`Migrations: already up to date, nothing applied.`, и номер последней применённой миграции
равен номеру последнего файла `*.do.*.sql`:

```bash
ls $REPO/apps/insight-bot/migrations | grep '\.do\.' | tail -1          # 020.do.web-push.sql (на 2026-11-02)
psql -d insight_coord -tAc "select max(version) from schema_migrations"  # 20
psql -d backtest_coord -tAc "select string_agg(tablename, ' ' order by tablename) from pg_tables where schemaname='public'"
# auth_sessions backtest_ops backtest_sessions invites order_modifications orders schema_migrations screenshots users
```

## 5. Файлы `.env` и секреты

Каждое приложение читает `.env` **из своего каталога**. Шаблоны лежат рядом и закоммичены:

```bash
cd $REPO
cp apps/insight-bot/.env.example   apps/insight-bot/.env
cp apps/signal-server/.env.example apps/signal-server/.env
```

**В шаблонах закомментировано всё**, поэтому свежая копия запускается ровно как «без `.env`»:
без базы, без бота. Раскомментируй ключ, только когда даёшь ему значение — пустое `KEY=` это
значение, а не «не задано», и оно перебивает умолчание. У каждого ключа в шаблоне написано, что
он делает и откуда берётся. Соответствие шаблона схеме проверяет спека
`test/env-example.spec.ts` в каждом приложении.

Для слота задай как минимум: `PORT`, `DATABASE_URL` (база **своего** слота), у insight-bot —
`WEB_BASE_URL`, у signal-server — `APP_BASE_URL` и `CORS_ORIGIN` (если SPA идёт через `ng serve`).

> **Правило репозитория: `.env` не читают, не печатают и не коммитят.** Наличие ключа проверяй
> только так: `grep -q '^TELEGRAM_BOT_TOKEN=' apps/insight-bot/.env && echo present`.

### Что приносит владелец — здесь остановись и попроси

| Ключ | Приложение | Без него | Откуда |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | insight-bot | бот не запускается; всё остальное работает | владелец: @BotFather → `/newbot`. **Отдельный тестовый бот на каждый слот.** Токен рабочего бота живёт только в SSM `/insight-bot/TELEGRAM_BOT_TOKEN`: два процесса на одном токене отбирают друг у друга апдейты |
| `TELEGRAM_BOT_USERNAME` | insight-bot | ссылки-приглашения и виджет входа указывают на `insight_bot` | имя того же бота без `@` |
| `ADMIN_TG_USER_ID` | insight-bot | нет админа: `/invite` и `/users` не отвечают никому | числовой Telegram-id владельца (@userinfobot) |
| `TELEGRAM_SERVICE_CHAT_ID` | insight-bot | служебные сообщения (тишина потока, отчёт о пропусках) только в лог | id чата владельца с ботом |
| `CAPITAL_COM_IDENTIFIER`, `_PASSWORD`, `_API_KEY` | signal-server | нет не-крипто инструментов в live; крипта работает | владелец: Capital.com → Settings → API integrations. **Старый ключ отключён/просрочен** (`error.null.client.token`) — его надо выпустить заново |

Не от владельца, но и не из шаблона:

- `ADMIN_EMAIL` / `ADMIN_PASSWORD` (signal-server; пароль ≥ 10 символов) — придумываешь сам для
  локального слота; без них в SPA бэктеста не войти никому.
- `WEB_PUSH_VAPID_PUBLIC/PRIVATE/SUBJECT` (insight-bot) — генерируешь сам:
  `npx web-push generate-vapid-keys`; все три или ни одного. Без них выключен только браузерный push.
- Ключа «агрегатора новостей» в текущей схеме нет — просить не надо.

## 6. Порты и запуск

Порты строго по слоту (`AGENTS.md` → «Working in a worktree»); чужой порт — это чужое состояние:

| Слот | signal-server | SPA бэктеста (`ng serve`) | insight-bot | дашборд (`ng serve`) | базы |
|---|---|---|---|---|---|
| coord | 3000 | 4200 | 3005 | 4205 | `insight_coord`, `backtest_coord` |
| dev-1 | 3010 | 4210 | 3015 | 4215 | `insight_dev1`, `backtest_dev1` |
| dev-2 | 3020 | 4220 | 3025 | 4225 | `insight_dev2`, `backtest_dev2` |
| dev-3 | 3030 | 4230 | 3035 | 4235 | `insight_dev3`, `backtest_dev3` |
| tester | 3040 | 4240 | 3045 | 4245 | `insight_tester`, `backtest_tester` |

Останавливай свои серверы **по PID своего порта** (`kill $(lsof -tiTCP:3005 -sTCP:LISTEN)`),
никогда `pkill` по шаблону — убьёшь чужой слот.

### insight-bot

```bash
cd $REPO/apps/insight-bot
npm start                                     # ключи из .env; или задай их в командной строке
curl -s -o /dev/null -w '%{http_code}\n' localhost:3005/health    # 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:3005/metrics   # 200
```

С базой в логе видно `binance-perp collector started for 40 symbols on wss://fstream.binance.com/market`,
`bybit collector started …`, и `/health` перечисляет потоки (`binance-perp:forceOrder`,
`bybit:allLiquidation`, `okx:liquidation-orders`, …). Без токена бота — предупреждение
`TELEGRAM_BOT_TOKEN is not set — the member bot is disabled`; это не ошибка.

**Без базы приложение обязано подниматься** (правило IB-003, его держит
`test/boot-without-database.spec.ts`):

```bash
cd $REPO/apps/insight-bot
env -u DATABASE_URL npm start      # в логе: "DATABASE_URL is not set — collectors disabled"; /health и /metrics → 200
```

Если `.env` задаёт `DATABASE_URL`, `env -u` его не уберёт (Nest дочитает `.env`) — добавь
`IGNORE_ENV_FILE=true`.

**Если сборщики Binance молчат:** (1) `curl -s ipinfo.io/country` — выход через США даёт 451 на
всём REST Binance; (2) поток должен идти на `wss://fstream.binance.com/market` — старые URL без
`/market` с 2026-04-23 не отдают kline/markPrice/forceOrder.

### Дашборд insight-bot — два способа

**(а) Раздаёт сам бот, тот же origin, как на боксе** (так делает Dockerfile):

```bash
cd $REPO/apps/chart-client
npm run build:insight-dashboard
mkdir -p ../insight-bot/public && cp -R dist/insight-dashboard/browser/. ../insight-bot/public/
# перезапусти бота; WEB_BASE_URL=http://localhost:3005
curl -s -o /dev/null -w '%{http_code}\n' localhost:3005/market       # 200, text/html
curl -s -o /dev/null -w '%{http_code}\n' localhost:3005/api/web/nope # 404 JSON — SPA не глотает API
```

`apps/insight-bot/public/` в `.gitignore`. Без бандла бот пишет в лог `no dashboard bundle … static
serving off` — это норма для разработки.

**(б) Dev-сервер с горячей перезагрузкой.** `config.json` дашборда — относительный `/api/web`, а
proxy-конфига в репозитории нет, поэтому дай его файлом **вне репозитория**:

```bash
echo '{ "/api": { "target": "http://localhost:3005", "secure": false } }' > /tmp/ib-proxy.json
cd $REPO/apps/chart-client
npx ng serve insight-dashboard --port 4205 --proxy-config /tmp/ib-proxy.json
curl -s localhost:4205/api/web/universe/top     # {"code":"UNAUTHENTICATED"} — запрос дошёл до бота
```

`WEB_BASE_URL` бота тогда — `http://localhost:4205`.

### signal-server

```bash
cd $REPO/apps/signal-server
npm start
curl -s localhost:3000/api/health | jq .status   # "degraded" — норма на replay: фикстуры старые
```

По умолчанию `MARKET_DATA_MODE=replay` (фикстуры, без сети и ключей). Запуск **пишет** в
`FILE_STORE_ROOT` (`apps/signal-server/data`, в `.gitignore`) — запуск на реальных данных не
read-only.

### SPA бэктеста

Против mock-сервера (бэкенд не нужен):

```bash
cd $REPO/apps/chart-client
npm run mock-server        # :4300
npm start                  # :4200
```

Против настоящего signal-server: в `apps/chart-client/public/config.json` поставь
`"apiBaseUrl": "http://localhost:3000/api"`, `"wsUrl": "ws://localhost:3000"` (**корень, не `/ws`** —
`/ws` бывает только у mock), у сервера — `CORS_ORIGIN=http://localhost:4200` и
`ADMIN_EMAIL`/`ADMIN_PASSWORD`. Это локальная правка: не коммить её и не откатывай чужую такую же
в чекауте координатора.

**Признак успеха:** `localhost:4200` уводит на `/login`, после входа — страница «Backtest sessions».

## 7. Чек-лист «машина поднята»

Иди по порядку. Колонка «2026-11-02» — что получилось на этой машине (Node 24.22.2, слот dev-1).

| # | Проверка | Как | 2026-11-02 |
|---|---|---|---|
| 1 | Сборка чистая | `npm run build` в `$REPO`, код 0 | ✓ |
| 2 | Набор insight-bot зелёный **с базой** | `cd apps/insight-bot && DATABASE_URL=…/insight_<слот> npx jest` | ✓ 162 suites / 1802 tests, 0 skipped |
| 3 | Набор signal-server зелёный с базой | `cd apps/signal-server && DATABASE_URL=…/backtest_<слот> npx jest` | ✓ 89 passed + 1 skipped / 566 + 1 skipped (vwap-band-reversal, пропущен намеренно) |
| 4 | **Оба** Angular-проекта | `cd apps/chart-client && npm test` | ✓ 944 + 383 |
| 5 | Библиотеки | `npm test -w libs/<имя>` для каждой | ✓ |
| 6 | Без базы: `/health`, `/metrics` = 200 | §6, `env -u DATABASE_URL` | ✓ |
| 7 | Ликвидации идут со всех трёх бирж | `psql -d insight_<слот> -tAc "select venue, count(*) from liquidations group by 1"` через несколько минут | ✓ binance, bybit, okx |
| 8 | Дашборд открывается | §6 (а) или (б): страница входа «Панель инсайт-бота» | ✓ |
| 9 | Бот отвечает на `/settings` | в Telegram | **не проверено** — нужен тестовый токен бота от владельца |
| 10 | `/web` даёт ссылку, по ней дашборд пускает | в Telegram | **не проверено** — то же |
| 11 | market и instrument показывают свежие данные | после входа | **не проверено** — то же |

> **Тесты без базы выглядят зелёными, но это неправда.** Без `DATABASE_URL` спеки базы молча
> пропускаются (сотни тестов insight-bot), и прогон отчитывается зелёным. Число в отчёте — только с
> базой своего слота; спеки создают и удаляют свои временные базы и больше ничего не трогают.
>
> **Тесты клиента — только `npm test` из `apps/chart-client`.** Голый `npx ng test` берёт один из
> двух проектов и молчит про второй. Флаг `--browsers` не добавлять — с ним падает.

## 8. Необязательно: архив со старой машины

WD-003 выгрузил накопленное двумя бандлами (`core` — незаменимое: ликвидации, funding, сессии
бэктеста; `bulk` — перекачиваемое: свечи, OI, long/short) с манифестом числа строк. **На этой
машине архива нет** (`~/insight-tape-backups` отсутствует) — где он, знает владелец.

- **Ликвидации** из архива нужны боксу: «× от нормы» требует истории, а задним числом её не отдаёт
  ни одна биржа. Это отдельная задача **IB-076** (слияние с дедупликацией по естественному ключу,
  никогда не по дате-срезу) — здесь её не делай.
- **Всё остальное** приложение не читает и читать не должно. Для исследований — только в
  **отдельную** базу, не в базу слота:

```bash
psql -d postgres -c "create database insight_archive owner backtest"
gunzip -c <файл>.sql.gz | psql -d insight_archive
```

Партиционированные таблицы выгружались с `--load-via-partition-root`. **Сверяй число строк с
манифестом**, а не факт распаковки: пустой дамп тоже распаковывается без ошибок.

## 9. Бокс в Токио и AWS

Не часть локальной установки. OpenTofu и cloudflared из §1 нужны задачам IB-073 (бокс) и IB-074
(туннель). AWS CLI на этой машине стоит, профиль только `default`; профиль и доступы для бокса
настраивает IB-073 вместе с владельцем — сам не заводи. Quick-tunnel
(`cloudflared tunnel --url http://localhost:<порт>`) публикует локальный сервер в интернет: делай
его только в рамках задачи, которая этого требует, и гаси сразу после проверки. На этой машине он
не запускался.
