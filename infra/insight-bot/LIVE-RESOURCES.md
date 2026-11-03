# Живые ресурсы AWS insight-bot — что есть и где

**Состояние на 2026-11-03 (IB-073, IB-082, IB-083).** Сервер в Токио работает и собирает данные;
сайт — **https://35-74-48-140.sslip.io**. Всё перечисленное ниже управляется OpenTofu из
`infra/insight-bot/terraform/`. `tofu plan` без аргументов пустой: код в git совпадает с тем, что
живёт в AWS.

Регион — **`ap-northeast-1`** (Токио). Номер аккаунта здесь намеренно не приводится: его видно из
`aws sts get-caller-identity` с профилем `insight-bot`.

## Где лежит состояние OpenTofu

**S3 `vb-insight-bot-backups-apne1`, ключ `tofu/insight-bot.tfstate`**, с блокировкой
(`use_lockfile`), шифрование на стороне S3, бакет версионируется. Описано в `terraform/backend.tf`,
`terraform/.terraform.lock.hcl` закреплён в git (провайдер aws 5.100.0).

Работать так:

```bash
cd infra/insight-bot/terraform
export AWS_PROFILE=insight-bot   # пользователь insight-bot-provisioner, права — iam/provisioner-policy.json
tofu init
tofu plan                        # должен быть пустым; всё, что не пусто, — сначала понять, потом применять
```

Права провижинера — файл `iam/provisioner-policy.json`; владелец вставляет его в консоли IAM
(политика `insight-bot-provisioner`). Последняя вставка — 8b5689f (ECR, OIDC, роль деплоя; там же
права для IB-082).

## Что живёт

### Сервер и сеть

| Ресурс OpenTofu | Что это | Идентификатор |
|---|---|---|
| `aws_instance.insight_bot` | сервер, t4g.micro arm64, диск gp3 50 ГБ (шифрованный) | `i-002c057dfb439ca24`, диск `vol-094308f857f6e0dc8`, AMI `ami-044e34eed8cbeb354` |
| `aws_eip.insight_bot` + `aws_eip_association.insight_bot` | постоянный адрес сайта | `35.74.48.140` (`eipalloc-039ce8d8282302949`) |
| `aws_security_group.insight_bot` | входящие: **только TCP 80 и 443** от 0.0.0.0/0 (IPv4), для Caddy; исходящие — всё | `sg-01cb82a6578c17200` (дефолтный VPC `vpc-cef1fea9`, подсеть `subnet-f42d17af`) |
| `aws_iam_role.instance`, `aws_iam_instance_profile.insight_bot`, `aws_iam_role_policy_attachment.ssm_core`, `aws_iam_role_policy.instance` | роль сервера: Session Manager; чтение `/insight-bot/*` в SSM; запись/чтение бакета копий; скачивание образа из ECR | `insight-bot-instance` |

### Образ и деплой

| Ресурс OpenTofu | Что это | Идентификатор |
|---|---|---|
| `aws_ecr_repository.insight_bot` + `aws_ecr_lifecycle_policy.insight_bot` | хранилище образов: теги `sha-<12>` неизменяемые, хранятся последние 10, неотмеченные — 1 день, сканирование при загрузке | `insight-bot` |
| `aws_iam_openid_connect_provider.github` | доверие к GitHub Actions (без ключей) | `token.actions.githubusercontent.com` |
| `aws_iam_role.deploy` + `aws_iam_role_policy.deploy` | роль GitHub Actions: push в ECR, запись `/insight-bot/IMAGE_TAG`, запуск `deploy.sh` на сервере через SSM. Доверяет **только** workflow из `master` этого репозитория (неизменяемый subject с id владельца и репозитория) | `insight-bot-deploy` |

Переменные репозитория для workflow (не секреты): `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `INSTANCE_ID`.

### Резервные копии

| Ресурс OpenTofu | Что это | Идентификатор |
|---|---|---|
| `aws_s3_bucket.backups` (+ `public_access_block`, `server_side_encryption_configuration`, `versioning`, `lifecycle_configuration`) | ежедневный `pg_dump` в `pg_dump/`, хранение 35 дней (и текущие, и старые версии); там же состояние OpenTofu | `vb-insight-bot-backups-apne1` |

### Параметры SSM (`/insight-bot/*`)

| Параметр | Кто пишет |
|---|---|
| `SITE_ADDRESS`, `WEB_BASE_URL`, `WEB_COOKIE_SECURE`, `CLIENT_IP_HEADER` | **OpenTofu** (`aws_ssm_parameter.web`, `web.tf`) — руками не менять |
| `IMAGE_TAG` | `scripts/push-image.sh` и GitHub Actions — после каждого успешного push |
| `POSTGRES_PASSWORD` (SecureString) | создан один раз 2026-11-03, сгенерирован, нигде не напечатан |
| `TELEGRAM_BOT_TOKEN` (SecureString) | владелец |
| `TELEGRAM_BOT_USERNAME`, `ADMIN_TG_USER_ID`, `TELEGRAM_SERVICE_CHAT_ID` | заданы 2026-11-03 по ответам владельца |

### Расходы

| Ресурс OpenTofu | Что это | Идентификатор |
|---|---|---|
| `aws_budgets_budget.monthly[0]` | письмо владельцу при расходе > 18 $ за месяц (факт и прогноз) | `insight-bot-monthly` |

Ожидаемо ≈ 16.5 $ в месяц (`COST-PLAN.md`).

## Защиты от случайной потери данных

- **Сервер:** `disable_api_termination = true`; корневой диск при удалении сервера **не**
  удаляется (`delete_on_termination = false`); OpenTofu игнорирует изменения `ami` и `user_data`
  (новый образ Amazon Linux или правка скриптов не пересоздают и не перезапускают сервер).
- **Elastic IP:** `prevent_destroy` — tofu не даст его освободить (адрес сайта и все ссылки
  поменялись бы).
- **ECR:** `force_delete = false` — репозиторий с образами не удалится, пока в нём есть образы.
- **Бакет:** версионируется; непустой бакет `tofu destroy` не удалит.

## Если всё это действительно нужно снести

Только по решению владельца. Порядок:

1. Свежий дамп и проверка его восстановления (RUNBOOK §6) — лента ликвидаций второй раз не
   скачивается.
2. Снять защиты в коде: `disable_api_termination = false`, убрать `prevent_destroy` у EIP,
   `force_delete = true` у ECR; `tofu apply`.
3. `tofu destroy` — показать план владельцу до применения.
4. Отдельно вручную: оставшийся диск `insight-bot-root` (EC2 → Volumes) и бакет (сначала
   скачать нужные дампы; бакет хранит и само состояние tofu — удалять последним).

История: до 2026-11-03 этот файл описывал пять ресурсов, оставшихся от незавершённой IB-013, и
как их снести вручную. 2026-11-03 их не снесли, а **импортировали** в OpenTofu (IB-073), и на
них построен нынешний сервер.
