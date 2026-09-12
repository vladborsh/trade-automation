# Infra note — live signal server, AWS pins

**Author:** DevOps Engineer · **Date:** 2026-09-12 · **Status:** pins issued,
nothing provisioned yet (no AWS account access exercised in this pass —
these are design/IaC-ready decisions for the coordinator to review before
any resource is created).

Reads: `architecture/live-signal-server.md` (the Architect's note — §4.3,
§4.5, §5.4, §6, §9.2 are the spec and routing plan this note pins against),
`PROJECT.md`, `agents/roles/devops-engineer.md`, `cmc-bot-main/Dockerfile`,
`cmc-bot-main/.github/workflows/deploy-app.yml` (prior art, explicitly not to
be repeated where flagged).

Checked before starting: `apps/signal-server` and `apps/chart-client` exist
only in the SE-1/SE-2 worktrees, not merged into this branch or `main` yet.
Per the task brief this note is written against the architecture note alone
and does not touch either app's code or worktree.

---

## 1. Storage — pin: **S3, confirming the Architect's recommendation**

**Pin: Amazon S3, one gzip JSONL object per `(venue, symbol, timeframe,
UTC day)`, exactly the layout in §6.4, with bucket versioning and lifecycle
rules as the Architect specified.** No override.

Rationale, checked line-by-line against §6.1's spec:

- **Single-writer idempotent upsert on `(instrument, timeframe, openTime)`**
  — satisfied by "rewrite the day object whole from `WriteBuffer`"; there is
  exactly one writer (the server process) so no cross-writer coordination is
  needed, and S3 `PutObject` on a keyed path is naturally idempotent.
- **Range scans, latest-openTime lookup, ordered replay stream** — a
  `ListObjectsV2` + sequential `GetObject` over day keys covers all three;
  none of these are point lookups or secondary-attribute queries, which is
  exactly what S3 is bad at and none of this workload needs.
- **1m retained indefinitely as backup of record, versioned/immutable** —
  bucket versioning gives immutability-on-overwrite (a bad flush creates a
  new version, not data loss) directly, with zero operational surface (no
  instance to patch, no backup job to write).
- **Bulk-exportable to Python/research** — `aws s3 sync` is literally the
  export mechanism the spec asks for; no bespoke ETL.
- **Cost/ops fit for a single-team account not running much else** — no
  always-on compute or database to size, patch, or alarm on for the storage
  layer itself. This matters more than it looks: DynamoDB and Timestream
  both carry an operational surface (capacity/backup config, or an
  always-on InfluxDB instance) that a first piece of live infra in a small
  account should not carry for a backup role.

I re-checked the two alternatives the Architect flagged as *possible
future* stores (DynamoDB as a hot store if the in-process cache ever stops
being enough; Timestream for InfluxDB if a query engine is wanted beside
S3) and neither changes this pin — both are additions *beside* S3 later,
not a replacement now, and neither is needed for anything in the current
scaffold (SE-1's `CandleCache` is the hot path; there is no multi-instance
requirement yet).

**What this requires of `StorageModule`:** nothing beyond what SE-1 is
already building — `S3CandleStore`/`S3SignalStore` implementing the
`CandleStore`/`SignalStore` ports (§4.3), selected via `CANDLE_STORE=s3`.
No change to any code outside `apps/signal-server/src/storage/`.

**Provisioning (IaC-ready, not yet applied):**

- One bucket, e.g. `trade-automation-candles-<env>` (region: pick the
  team's default AWS region — same region as compute, to avoid cross-region
  transfer cost/latency).
- Bucket versioning: **on**.
- Lifecycle rules:
  - Expire non-current versions after ~30 days (recovers from a bad flush
    within a generous window without keeping every version forever).
  - Expire current versions of everything under `candles/.../tf=5m|15m|1h|4h|1d/`
    (i.e. all derived timeframes) after ~90 days — `1m` objects are excluded
    from this rule and retained indefinitely.
- IAM: one role for the server task/instance, scoped to
  `s3:GetObject`/`PutObject`/`ListBucket` on this bucket's prefix only — no
  account-wide S3 access, no delete permission (versioning + lifecycle
  handle expiry; the running server should not be able to `DeleteObject`).
- Research bulk-export path: a separate, read-only IAM policy (`GetObject`,
  `ListBucket`) attachable to whatever principal the Researcher/Backtesting
  side uses for `aws s3 sync`; does not need write access.

---

## 2. Compute — pin: **ECS Fargate, one task, ~0.5 vCPU / 1 GB**

**Pin: ECS Fargate**, not EC2, not Lambda (Lambda already ruled out by the
Architect for holding long-lived WebSocket connections both inbound and
outbound — a Fargate task is the smallest unit that can hold both without
fighting the platform).

Rationale, EC2 vs. Fargate for this specific workload:

- **Operational simplicity dominates at this scale.** One task, no
  autoscaling group, no AMI/OS patching, no SSH surface to secure. The
  account is a single-team account running almost nothing else yet (per
  PROJECT.md/agents/roles) — an EC2 instance would be the *first* thing
  needing OS-level patching cadence and host monitoring in this account;
  Fargate removes that entirely by never exposing a host.
- **Restart/health-check behavior fits ECS's model directly.** The server
  already exposes `/api/health` (§4.5/§4.8); an ECS service with a single
  desired-count task, container health check hitting `/api/health`, and
  `awsvpc` networking gets automatic task replacement on crash or failed
  health check for free. `GapRepair`'s boot warm-up (§4.1) already assumes
  "the process can restart and must never leave a hole," so ECS's
  replace-on-failure behavior is exactly the restart model the server was
  designed for, not something bolted on.
- **Cost**: a single ~0.5 vCPU / 1 GB Fargate task is a small, fully
  qualitative win over paying for and managing a persistent EC2 instance
  when there's no other workload to amortize the instance against — no
  concrete dollar figures asserted here, but "no idle host to patch or
  right-size" is a real ops-cost saving at team size 1.
- **Why not EC2**: the only argument for EC2 here would be raw per-vCPU
  cost at sustained utilization or needing host-level access (neither
  applies — the server is one process, no privileged host operations, no
  sustained high CPU). Revisit if/when multiple strategies or multiple
  server instances make a shared EC2/ASG cheaper than N Fargate tasks — not
  now (§8's "multi-instance" scaling seam, not a current need).
- **Why not Lambda**: already settled by the Architect (§9.2.2) — a
  long-running process holding two kinds of persistent connections cannot
  be a Lambda invocation; restated here only to close the loop.

**Sizing**: start at 0.5 vCPU / 1 GB per the Architect's estimate; the
`/metrics` CPU/memory series (once live) is the actual signal to revisit
this, not a guess made now.

**Networking**: task in a private subnet, outbound internet access via a
NAT gateway or (cheaper, since this task makes no other AWS calls needing a
public path) a set of VPC endpoints for S3/ECR/CloudWatch/Secrets Manager —
DevOps to size at provisioning time depending on whether a NAT gateway's
fixed hourly cost is worth avoiding for a single task. Inbound: only the
edge layer (§3) reaches the task; the task itself is not internet-facing.

---

## 3. Edge — pin: **ALB (HTTPS + WSS) in front of the ECS service; client served by the Nest server**

### Edge/load balancer

**Application Load Balancer**, terminating TLS (ACM certificate), forwarding
to the Fargate task's target group. ALB supports WebSocket upgrade natively
(it detects the `Upgrade: websocket` header and holds the connection open)
and its **idle timeout is configurable per-listener — set it to ≥ 60 s**, in
fact set it comfortably above the failure threshold: **120 s**, so the
15-second gap between the client's 20 s ping cadence and the server's 60 s
drop threshold (§4.5) isn't eaten by an edge timeout racing the
application-level one. An idle timeout shorter than 60 s would silently
drop live WS connections before the app-level ping/pong logic ever gets a
chance to declare them dead — this is the one edge setting this whole
design is not tolerant of getting wrong.

Why ALB over API Gateway (WebSocket API) or NLB:
- API Gateway's WebSocket API charges per connection-minute and per
  message and requires re-architecting the push path around its
  connection-management model (`$connect`/`$disconnect` routes, a separate
  store for connection IDs) — the server already owns its own WS gateway
  (`@nestjs/websockets` on native `ws`, §4.5); putting API Gateway in front
  would fight that design rather than support it.
- NLB (Layer 4) would pass TCP through without TLS termination or
  HTTP-aware idle-timeout semantics tuned for WS upgrade — ALB is the
  layer-7 fit for "one HTTPS+WSS origin in front of one Nest process."

### Client hosting — pin: **served by the Nest server itself (`ServeStaticModule`)**

Per §5.4's explicit "your call": pinning the simpler option — the Angular
static bundle served by the same Nest process behind the same ALB/domain,
not S3+CloudFront. Reasoning: this is the *first* piece of live infra for a
single-team account; S3+CloudFront buys cache/edge distribution that a
single internal chart terminal (not a public, high-traffic site) does not
need yet, at the cost of a second deployable, a second cache-invalidation
step in CI/CD, and a CloudFront distribution to configure and pay for.
`ServeStaticModule` keeps "one deployable, one task, one place that can be
down" — matching the project's actual current scale. Revisit if the client
gets a genuinely public/high-traffic audience later; nothing here blocks
that move (the bundle is already static output, portable to S3+CloudFront
without a code change).

---

## 4. Secrets — pin: **AWS Secrets Manager, injected as task-definition env vars, never build args**

**Pin: Secrets Manager** (over SSM Parameter Store) for Capital.com
credentials (`identifier`, API key, password) and later Binance trading
keys, because these are true secrets with rotation potential, not general
config — Secrets Manager's native rotation support is the better fit even
though rotation isn't wired up in this first pass; Parameter Store
(`SecureString`) would work functionally but Secrets Manager is the more
correct home for credential-shaped values in an account that will
eventually hold Binance trading keys too.

**Explicitly checked `cmc-bot-main/Dockerfile`**: it takes every credential
(`CAPITAL_COM_API_KEY`, `CAPITAL_COM_CUSTOM_PASS`, `CAPITAL_COM_IDENTIFIER`,
`BINANCE_API_KEY`, `BINANCE_SECRET_KEY`, AWS keys, etc.) as `ARG`, then
`ENV`, baked into the image at build time — this is exactly the anti-pattern
the Architect's note (§9.2.4) and the task brief call out. **Not repeated
here.**

**Pin instead**: secrets live in Secrets Manager, referenced by ARN in the
ECS task definition's `secrets` block (not `environment`), so ECS injects
them as env vars into the running container at task-start time — the value
never appears in the image, in `docker build` history, or in CI logs if the
workflow is written correctly (§5). The task execution role gets
`secretsmanager:GetSecretValue` scoped to exactly these secret ARNs, nothing
broader.

Non-secret runtime config (`instruments.yaml`, `strategies.yaml`, region,
bucket name, `CANDLE_STORE=s3`) stays as plain task-definition environment
variables or mounted config — no need to put non-secrets in Secrets
Manager.

---

## 5. CI/CD — GitHub Actions skeleton: build/test both apps → build image → push ECR → deploy

Read `cmc-bot-main/.github/workflows/deploy-app.yml` as prior art. It is
**not reusable as-is**: besides the secrets-as-build-args pattern already
flagged in §4, it deploys to Heroku, not AWS, and only builds one app. The
skeleton below keeps its "test → build → deploy" shape and its use of
`aws-actions/configure-aws-credentials`, drops everything else.

```yaml
# .github/workflows/deploy-signal-server.yml (skeleton — paths/names to
# confirm once apps/ exists in main; not wired to a real ECR repo yet)
name: Build, test, deploy signal-server + chart-client

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build --workspace=apps/signal-server
      - run: npm run test --workspace=apps/signal-server
      - run: npm run build --workspace=apps/chart-client
      - run: npm run test --workspace=apps/chart-client

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # OIDC to AWS — no long-lived AWS keys in GitHub secrets
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}
      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr
      - name: Build and push signal-server image
        run: |
          docker build -t ${{ steps.ecr.outputs.registry }}/signal-server:${{ github.sha }} \
            -f apps/signal-server/Dockerfile .
          docker push ${{ steps.ecr.outputs.registry }}/signal-server:${{ github.sha }}
        # NOTE: no --build-arg for secrets here — runtime env comes from
        # Secrets Manager via the ECS task definition (§4), not the image.

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}
      - name: Register new task definition + update service
        run: |
          # render task-def.json with the new image tag, then:
          aws ecs register-task-definition --cli-input-json file://task-def.json
          aws ecs update-service --cluster trade-automation --service signal-server \
            --task-definition signal-server --force-new-deployment
```

Notes on the skeleton (deliberately incomplete — a full pass needs the
ECR repo, cluster, and task-def JSON to exist first, which is provisioning
work beyond "pin the design"):

- **OIDC federation (`id-token: write` + `role-to-assume`)** instead of
  long-lived `AWS_ACCESS_KEY_ID`/`AWS_SECRET_KEY` GitHub secrets — the bot's
  workflow uses static keys; this is the one place this skeleton
  deliberately does not port a bot pattern even though it wasn't explicitly
  flagged, because static AWS keys in GitHub secrets is a strictly worse
  posture than OIDC for a fresh setup.
- Client bundle: since §3 pins `ServeStaticModule`, the Angular build output
  is copied into the signal-server's Docker image at build time (a
  multi-stage Dockerfile stage), so "deploy" is one image/one service — no
  separate S3 sync/CloudFront invalidation step needed.
- Task definition / ECS service / cluster creation is IaC (Terraform/CDK,
  DevOps's choice, not decided in this pass) applied once outside the
  workflow; the workflow only registers new task-definition revisions and
  triggers redeploys.

---

## 6. Observability plumbing

- **Logs**: pino JSON stream (§4.8, `nestjs-pino`) → stdout → **ECS
  `awslogs` log driver** in the task definition → a CloudWatch Logs log
  group (e.g. `/ecs/signal-server`), no separate log shipper needed —
  `awslogs` is built into the ECS agent. Retention: set an explicit
  retention policy on the log group (e.g. 30–90 days) so logs don't
  accumulate forever by CloudWatch's default-infinite setting.
- **Metrics**: the server exposes `/metrics` in Prometheus format (§4.8,
  `prom-client`) but this account has no Prometheus/Grafana stack yet and
  standing one up is disproportionate for one task. Pin: **CloudWatch
  Container Insights** (enabled at the ECS cluster/service level) for the
  baseline task-health metrics (CPU, memory, task count, restarts) —
  effectively free operational visibility with no extra component. For the
  *application-specific* series (`/metrics`'s candle lag, gap count,
  strategy eval duration, WS client count), the pragmatic first pass is:
  have the server itself push these as **custom CloudWatch metrics** via
  the AWS SDK (a small `MetricsPublisher` alongside `prom-client`, on the
  existing observability module) rather than standing up a CloudWatch
  agent + Prometheus scrape sidecar in Fargate (which is real added
  complexity — a sidecar container, an ECS task role widened for
  `cloudwatch:PutMetricData` either way). This is worth a line to Software
  Engineer/Integration Engineer as a small addition to the `observability`
  module, not a new module.
- **Health**: `/api/health` (§4.5/§4.8) is the ALB target-group health
  check path and the ECS container health check.

### Alarm design — `lastClosedCandleAge` per instrument

Signal: `/api/health` reports `lastClosedCandleAge` per instrument (time
since the last closed 1m candle was received). Design:

1. The server publishes `lastClosedCandleAge` as a CloudWatch custom metric
   per instrument (dimension: `instrument`), on every closed-candle event or
   at minimum once per `BarClock` tick — reusing the same
   `MetricsPublisher` as above, not a second mechanism.
2. **Alarm**: `lastClosedCandleAge > 90s` for 2 consecutive evaluation
   periods (60 s each), **per instrument**, evaluated only while
   `venueStatus` for that instrument is `'up'` (Capital.com's market-hours
   `'closed'` state must not fire this alarm — §4.1 already models this
   distinction in `VenueStatus`, so gate the alarm on it, e.g. via a
   composite alarm or a metric math expression that zeroes out the value
   while the venue reports closed).
   - 90 s ≈ 1.5× the 60 s "server drops on 60 s WS silence" threshold from
     §4.5 plus the `BarClock`'s ~15 s late-bar tolerance (§4.6) — wide
     enough to not fire on ordinary jitter, tight enough to catch a dead
     feed within 2 missed bars.
3. **Action**: SNS topic → email (and/or a chat webhook if the team wants
   one later) to whoever is on call. No auto-remediation in this first
   pass — ECS's own health-check-driven restart already handles a crashed
   process; this alarm is for "the process is alive but a feed died,"
   which a restart doesn't fix (the venue side is down, or the adapter is
   stuck).
4. A second, simpler alarm on **ECS service `RUNNING` task count < desired
   count** for > 5 minutes covers "the process itself won't stay up,"
   complementing the feed-liveness alarm above.

---

## 7. Runbook (для пользователя)

Ниже — то, что нужно знать человеку, чтобы задеплоить сервер, проверить его
состояние и отреагировать на срабатывание алармов. Технический раздел выше
(с обоснованиями выбора AWS-сервисов) предназначен для команды/ролей, а не
для повседневного использования.

### Как задеплоить

1. Слить изменения в ветку `main` — CI/CD (GitHub Actions) сам соберёт обе
   части (сервер и клиент), прогонит тесты, соберёт Docker-образ и
   выложит его в приватный реестр образов Amazon (ECR).
2. После успешной сборки workflow обновит запущенный сервис в ECS (это
   сервис AWS, который следит, чтобы контейнер с сервером был всегда
   запущен) — новая версия подхватится автоматически, без ручных действий.
3. Если что-то пошло не так на этапе тестов или сборки — деплой
   останавливается сам, старая версия продолжает работать без изменений.
   Смотреть логи запуска нужно на вкладке Actions в GitHub.

### Как проверить, что сервер жив

- Открыть в браузере (или через `curl`) адрес `/api/health` на домене
  сервера — там для каждого инструмента (пары/тикера) видно:
  - "давность последней закрытой свечи" (`lastClosedCandleAge`) — сколько
    секунд прошло с последней полученной минутной свечи;
  - статус биржи/площадки по этому инструменту (открыта, закрыта,
    деградирует).
- В AWS-консоли: раздел ECS → кластер → сервис `signal-server` — там видно,
  запущена ли задача (task) и сколько раз она перезапускалась.
- Логи сервера идут в CloudWatch Logs (группа логов `/ecs/signal-server`) —
  там же видно ошибки, если они есть.

### Что означают алармы и что делать

**Аларм "давность последней свечи" (`lastClosedCandleAge`) по инструменту.**
Означает: по конкретному инструменту сервер давно (обычно ~1.5–2 минуты)
не получал новую минутную свечу, хотя биржа/площадка сейчас открыта —
скорее всего, оборвалось соединение с источником данных (Binance или
Capital.com), а не что-то со всем сервером сразу.
- Что делать: проверить `/api/health` — если только один инструмент "завис",
  а остальные живые, вероятно проблема на стороне конкретной
  биржи/площадки (перебои, обслуживание) — подождать и понаблюдать.
  Если зависли все инструменты одной площадки — вероятно проблема с
  подключением сервера к этой площадке (например, истёк временный ключ
  сессии) — потребуется перезапуск задачи в ECS (кнопка "Force new
  deployment" на сервисе, либо остановить текущую задачу — ECS запустит
  новую автоматически).

**Аларм "число запущенных задач меньше требуемого" дольше 5 минут.**
Означает: сам процесс сервера не может подняться или падает при старте
(например, ошибка конфигурации, недоступен секрет, ошибка в коде).
- Что делать: смотреть логи в CloudWatch Logs за последние несколько
  минут — там будет причина падения при старте. Если это ошибка в
  последнем деплое — можно откатить сервис на предыдущую версию образа
  (в ECS: указать в определении задачи предыдущий тег образа и обновить
  сервис).

### Где хранятся секреты (пароли, ключи API)

Пароли и ключи (Capital.com, позже — Binance) хранятся не в коде и не в
Docker-образе, а в отдельном защищённом хранилище AWS (Secrets Manager).
Если нужно поменять пароль или ключ API — это делается там, через
AWS-консоль, и подхватывается сервером автоматически при следующем
перезапуске задачи (без пересборки образа).

---

## 8. Summary of pins (for quick reference)

| Area | Pin |
|---|---|
| Storage | S3, gzip JSONL per venue/symbol/tf/UTC-day (Architect's §6.3 recommendation, confirmed, no override) |
| Compute | ECS Fargate, 1 task, ~0.5 vCPU / 1 GB |
| Edge | ALB (HTTPS+WSS), idle timeout 120 s |
| Client hosting | Served by the Nest server (`ServeStaticModule`), not S3+CloudFront |
| Secrets | AWS Secrets Manager → ECS task-definition `secrets`, never build args |
| CI/CD | GitHub Actions: test → build+push to ECR (OIDC) → ECS deploy |
| Logs | ECS `awslogs` driver → CloudWatch Logs, explicit retention |
| Metrics | CloudWatch Container Insights (baseline) + custom `PutMetricData` for app-specific series |
| Alarm | `lastClosedCandleAge` > 90 s × 2 periods per instrument, gated on venue open; + ECS running-count alarm |

Nothing in this note has been provisioned against a real AWS account in
this pass — these are pins and IaC-ready designs for review. Not committed
to git; left for the coordinator to review in this worktree.
