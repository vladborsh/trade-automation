# Поднять проект на новой машине — инструкция для агента

Ты читаешь это, потому что репозиторий переехал на чистую машину, и надо поднять локальную
инфраструктуру с нуля. Ты видишь проект впервые — поэтому ниже каждая команда идёт со своим
рабочим каталогом и с признаком, по которому видно, что шаг удался.

**Что в репозитории.** Монорепозиторий npm workspaces, два приложения:

| Приложение | Что это | Нужна ли база |
|---|---|---|
| `apps/insight-bot` | NestJS: Telegram-бот + web-API + раздача дашборда. **Stateless-фасад**: данные берёт у биржи по запросу, в базу их не пишет | да, но только под аккаунты и сессии |
| `apps/chart-client` | Два Angular-проекта: `chart-client` (SPA ручного бэктеста) и `insight-dashboard` (дашборд бота) | нет |
| `apps/signal-server` | NestJS для SPA бэктеста: инструменты, сессии, свечи | да |

Плюс `libs/*` — общие пакеты, которые собираются первыми.

> **Важно про архитектуру.** Раньше insight-bot круглосуточно копил «тейп» в Postgres
> websocket-коллекторами. Этого больше нет и возвращать не надо: коллекторы, derive, feature-фреймы,
> плейбуки и страницы статуса накопления удалены намеренно (см. `tasks/wind-down.jsonl`). Если
> встретишь в старых документах `architecture/insight-bot-system-design.md` разделы про коллекторы
> и Stage 0 — они помечены отменёнными и систему больше не описывают. **Накопленная история живёт
> только в архиве и приложением не читается.**

---

## 1. Что нужно до начала

```bash
node -v    # нужно >= 22 (в package.json engines)
npm -v
git --version
brew --version
```

Если Node старше 22 — поставить новее (`brew install node`). Проект проверялся на Node 24.16 и
npm 11.13.

## 2. Код и сборка

```bash
cd ~/Documents            # или куда хочешь, дальше путь к репозиторию = $REPO
git clone https://github.com/vladborsh/trade-automation.git trade_automation
cd trade_automation
npm ci
npm run build
```

`npm run build` в корне собирает **в заданном порядке**: сначала `libs/*`, потом приложения.
Порядок не случайный — приложения импортируют собранные библиотеки.

**Признак успеха:** команда завершилась с кодом 0, и в `apps/insight-bot/dist/main.js` есть файл.

**Если `dist/` пустой, а ошибок нет** — это известная ловушка устаревшего `tsbuildinfo`:

```bash
rm -f apps/insight-bot/tsconfig.tsbuildinfo apps/signal-server/tsconfig.tsbuildinfo
rm -rf apps/insight-bot/dist apps/signal-server/dist
npm run build
```

## 3. Postgres

Эта часть **не описана** в `apps/insight-bot/README.md` и `apps/signal-server/README.md` — они
начинаются с предположения, что база уже есть. В репозитории есть и `docker-compose.yml` с
Postgres, но на старой машине он не использовался: база была нативная, из Homebrew. Делай
нативно, так же.

```bash
brew install postgresql@16
brew services start postgresql@16     # именно start, не run — см. ниже
```

> **Запускай `start`, а не `run`.** `brew services run` поднимает сервер до перезагрузки и не
> регистрирует автозапуск. На старой машине так и жили, и «Postgres не зарегистрирован в
> автозапуске» всплывало в списках нерешённого раз за разом. `start` прописывает сервис, и после
> перезагрузки база поднимается сама.

Проверить и добавить `psql` в PATH, если его не видно:

```bash
pg_isready                                  # ждём: accepting connections
# если команды нет:
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"   # и в ~/.zshrc
```

Роль и базы. Проект исторически ходит под ролью `backtest` с паролем `backtest` (это локальная
машина, роль не выходит за её пределы):

```bash
psql -d postgres -c "create role backtest with login password 'backtest' createdb"
psql -d postgres -c "create database insight_coord owner backtest"
psql -d postgres -c "create database backtest_coord owner backtest"
```

**Признак успеха:**

```bash
psql -d postgres -tAc "select datname from pg_database where datname in ('insight_coord','backtest_coord')"
# ждём обе строки
```

Формат строки подключения везде одинаковый:
`postgresql://backtest:backtest@localhost:5432/<имя_базы>`

> Если будешь поднимать параллельные worktree для агентов — у каждого слота своя база и свои
> порты, таблица в `AGENTS.md`. Для одной машины и одного человека хватает слота
> «Coordinator»: `insight_coord`, `backtest_coord`.

## 4. Файлы `.env`

**Секреты ты создать не можешь — их приносит владелец.** Твоя работа: сделать файлы из шаблонов и
сказать, какие именно значения нужны.

```bash
cd $REPO
cp apps/insight-bot/.env.example apps/insight-bot/.env
cp apps/signal-server/.env.example apps/signal-server/.env
```

Затем **владелец** вписывает значения. Что обязательно и откуда берётся:

**`apps/insight-bot/.env`**

| Переменная | Откуда |
|---|---|
| `DATABASE_URL` | `postgresql://backtest:backtest@localhost:5432/insight_coord` |
| `TELEGRAM_BOT_TOKEN` | у @BotFather в Telegram; для новой машины лучше **отдельный тестовый бот**, чтобы не отбирать апдейты у рабочего |
| `TELEGRAM_SERVICE_CHAT_ID` | id служебного чата, куда бот пишет оператору |
| `ADMIN_TG_USER_ID` | Telegram-id владельца; без него админские команды бота никому не доступны |
| `WEB_BASE_URL` | `http://localhost:3005` для локального запуска |

**`apps/signal-server/.env`**

| Переменная | Откуда |
|---|---|
| `DATABASE_URL` | `postgresql://backtest:backtest@localhost:5432/backtest_coord` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | придумываются при первом запуске, это вход в SPA бэктеста |
| `CORS_ORIGIN` | `http://localhost:4200` — **обязательно для разработки**, иначе SPA на 4200 не достучится до сервера на 3000 и покажет «Cannot reach the server»; это не баг, а отключённый по умолчанию тумблер |
| `CAPITAL_COM_*` | только если нужны не-крипто инструменты. **Старый ключ был отключён или просрочен** (`error.null.client.token`), так что его придётся перевыпустить в Capital.com → Settings → API integrations. Без него бэктест работает на криптоинструментах |
| `WS_SHARED_TOKEN`, `S3_*` | не нужны для локального запуска |

> **Правило репозитория: `.env` никогда не читают, не печатают и не коммитят.** Проверять
> наличие ключа можно только так: `grep -q '^TELEGRAM_BOT_TOKEN=' apps/insight-bot/.env && echo
> present`. Значение не выводить никуда.

## 5. Миграции

```bash
cd $REPO
npm run migrate -w @trade-automation/insight-bot
npm run migrate -w @trade-automation/signal-server
```

Миграции читают только `DATABASE_URL`. По умолчанию `DB_MIGRATE_ON_BOOT=true`, то есть при
запуске приложения они применятся сами — но прогнать вручную полезно, чтобы ошибка схемы
всплыла отдельно от ошибки запуска.

**Признак успеха** (insight-bot после свёртки держит всего четыре таблицы плюс служебную):

```bash
psql -d insight_coord -tAc "select tablename from pg_tables where schemaname='public' order by 1"
# ждём: invites, schema_migrations, users, web_login_tokens, web_sessions
```

Если видишь `candles_1m`, `liquidations`, `feature_frames` и прочий тейп — значит ты развернул
чекаут **до** свёртки; это не ошибка установки, просто версия старая.

## 6. Запуск

Порты для одной машины (полная таблица слотов — в `AGENTS.md`):

| Что | Порт |
|---|---|
| insight-bot (API + дашборд) | `3005` |
| дашборд в режиме разработки | `4205` |
| signal-server | `3000` |
| SPA бэктеста в режиме разработки | `4200` |

**insight-bot:**

```bash
cd $REPO/apps/insight-bot
npm start                       # поднимется на 3005
curl -s localhost:3005/health   # ждём 200
```

Дашборд раздаётся самим приложением. Отдельный dev-сервер нужен только если ты правишь его код:

```bash
cd $REPO/apps/chart-client
npx ng serve insight-dashboard --port 4205
```

**Приложение обязано подниматься и без базы** — это правило проекта (IB-003) и его проверяет
спека. Запуск с `env -u DATABASE_URL` должен отдавать `/health` и `/metrics`, просто без
аккаунтов.

**signal-server и SPA бэктеста:**

```bash
cd $REPO/apps/signal-server && npm start          # 3000
cd $REPO/apps/chart-client   && npx ng serve      # 4200
```

## 7. Проверка, что всё живо

Проходи по порядку, это и есть критерий «машина поднята»:

```bash
cd $REPO
npm run build                                  # 1. чисто
npm test -w @trade-automation/insight-bot      # 2. набор insight-bot зелёный
cd apps/chart-client && npm test               # 3. ОБА Angular-проекта
```

> **Тесты клиента запускай именно `npm test` из `apps/chart-client`.** В этом workspace два
> Angular-проекта, и голый `npx ng test` молча берёт один: отчитается о 18 зелёных и ни слова не
> скажет про 944 у SPA бэктеста. Флаг `--browsers` не добавлять, с ним падает.

4. Бот отвечает на `/settings` в Telegram.
5. Команда `/web` в боте выдаёт ссылку, по которой дашборд пускает внутрь.
6. Дашборд открывается, страницы **market** и **instrument** показывают данные.
7. **Данные действительно живые:** проверь, что в `insight_coord` нет таблиц, из которых их
   можно было бы взять (см. список в шаге 5). Если цифры есть, а таблиц нет — значит они пришли
   из биржи сейчас, как и задумано.

## 8. Необязательно: подключить архив накопленных данных

На Google Drive лежит архив со старой машины: два бандла (`core` — незаменимое, `bulk` —
перекачиваемое) и манифест с числом строк и контрольными суммами.

**Приложению он не нужен и приложение его не читает.** Заливать стоит только если собираешься
что-то исследовать по старым данным. В этом случае — **в отдельную базу**, не в `insight_coord`:

```bash
psql -d postgres -c "create database insight_archive owner backtest"
gunzip -c <файл-из-бандла>.sql.gz | psql -d insight_archive
```

Что в архиве ценно и почему: **ликвидации существуют только в websocket, и ни Binance, ни Bybit,
ни OKX не отдают их историю через REST** — это измерено и записано в
`architecture/insight-bot-history-map.md`. Их около 91 тысячи строк за 2026-09-28…10-12, и
воспроизвести их нельзя никак. Всё остальное (свечи, open interest, long/short) биржа отдаст
заново из архива `data.binance.vision` — поэтому `bulk`-бандл можно и не заливать.

**Сверься с манифестом после загрузки.** Для партиционированных таблиц дамп делался с
`--load-via-partition-root`; проверять надо число строк, а не то, что файл распаковался —
пустой дамп тоже распаковывается без ошибок.

## 9. Чего на этой машине больше нет и не надо воссоздавать

Чтобы ты не потратил день на восстановление того, что удалено осознанно:

- **Коллекторы, websocket-подписки, derive-джоба, feature-фреймы, плейбуки, новостной ингест** —
  удалены. Данные берутся по запросу.
- **Страницы «статус накопления» и «покрытие» в дашборде** — удалены вместе с эндпоинтами
  `health/streams`, `health/gap-reports`, `health/db`, `coverage`.
- **Всё про ликвидации в UI и API** — удалено, потому что их нельзя получить по запросу.
- **AWS** — пяти ресурсов в `ap-northeast-1` больше нет, их снесли при свёртке; история и
  идентификаторы остались в `infra/insight-bot/LIVE-RESOURCES.md` на случай вопросов по счёту.
  Документы `infra/insight-bot/SETUP-RU.md`, `RUNBOOK.md`, `COST-PLAN.md` — исторические.
- **Слоты для параллельных агентов** (`insight_dev1..3`, `insight_tester` и их порты) — нужны
  только если снова запустишь несколько агентов; для одной машины не создавай.

Если понадобится вернуть сбор ликвидаций — это новая работа, и ей нужна машина вне этой сети:
с локальной сети websocket Binance USD-M не отвечает, именно поэтому когда-то и заводился бокс в
Токио.
