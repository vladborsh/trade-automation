# Живые ресурсы AWS от незавершённой IB-013 — и как их снести

> **Обновление 2026-11-03 (IB-073): сервер создан, всё под управлением OpenTofu.** Пять ресурсов
> ниже и ещё два (`aws_s3_bucket_public_access_block`, `aws_s3_bucket_server_side_encryption_configuration`)
> импортированы в состояние; созданы `aws_instance.insight_bot` = **`i-002c057dfb439ca24`**
> (t4g.micro, arm64, диск gp3 50 ГБ, защита от удаления), политика роли, версионирование и
> правило хранения бакета, бюджет `insight-bot-monthly`. Состояние теперь не в worktree, а в S3:
> `s3://vb-insight-bot-backups-apne1/tofu/insight-bot.tfstate` (с файлом блокировки).
> Раздел «Как снести» ниже устарел: сносить — только `tofu destroy` после снятия защиты (RUNBOOK §10).
> Полная переработка этого файла — шаг 7 IB-073.

**Записано 2026-10-23 при свёртывании разработки.** IB-013 (бокс в Токио для websocket-ликвидаций
Binance) так и не была доведена до конца: `tofu apply` прошёл частично и создал 5 ресурсов из 12.
**EC2-инстанса не существует** — проверено `aws ec2 describe-instances` (пусто). Расход на то, что
осталось, измерялся как $0.27/мес (роль, security group, instance profile и пустой бакет —
всё в пределах free tier).

При свёртывании решено снести всё: бокс был нужен ровно для ликвидаций Binance, а после перехода
insight-bot на on-demand сбора ликвидаций больше не будет.

## Зачем этот файл существует

Состояние OpenTofu (`terraform.tfstate`) gitignored и жило **в одной единственной копии** внутри
worktree `se-bt-auth-server`. Бэкап, который считался существующим
(`~/.claude/jobs/.../reports/ib-013-state-backup/`), был вычищен вместе с tmp задания. То есть
удаление папки worktree уничтожило бы единственную запись о платных ресурсах в чужом регионе.
Поэтому идентификаторы выписаны сюда, в git, а копия состояния лежит в
`~/insight-tape-backups/ib-013-state-backup/` и входит в архивный бандл.

## Что живёт

Регион — **`ap-northeast-1`** (Токио). Номер аккаунта здесь намеренно не приводится; он есть в
скопированном состоянии.

| Ресурс OpenTofu | Тип | Идентификатор |
|---|---|---|
| `aws_iam_role.instance` | IAM role | `insight-bot-instance` |
| `aws_iam_role_policy_attachment.ssm_core` | IAM policy attachment | `insight-bot-instance-20261007192450730000000001` (прикрепляет `AmazonSSMManagedInstanceCore`) |
| `aws_iam_instance_profile.insight_bot` | IAM instance profile | `insight-bot-instance` |
| `aws_security_group.insight_bot` | Security group | `sg-01cb82a6578c17200` (в дефолтном VPC `vpc-cef1fea9`) |
| `aws_s3_bucket.backups` | S3 bucket | `vb-insight-bot-backups-apne1` (версионируемый, приватный, шифрованный) |

Ничем не управляемые data-источники (удалять нечего): дефолтный VPC `vpc-cef1fea9`, его подсети,
AMI `ami-00a205e9e967454f6`, caller identity.

## Как снести — руками в консоли

`tofu destroy` **не предлагать**: он снова упрётся в ту же нехватку прав `s3:GetBucketPolicy`,
из-за которой apply и развалился (политика провижинера в консоли отставала от
`iam/provisioner-policy.json`), а состояние существует только в одной копии вне git. Пять ресурсов
быстрее и надёжнее удалить вручную. Порядок важен — IAM не даёт удалить то, на что ещё ссылаются:

1. **IAM → Roles → `insight-bot-instance`** → вкладка Permissions → отсоединить
   `AmazonSSMManagedInstanceCore` и удалить встроенную политику (она читала SSM-параметры
   `/insight-bot/*` и писала в бакет бэкапов).
2. **IAM → Roles** → у роли убрать instance profile, затем **удалить instance profile**
   `insight-bot-instance`. В консоли профиль не показан отдельным разделом — он удаляется вместе
   с ролью, если создавался консолью; здесь он создан OpenTofu, поэтому может потребоваться
   `aws iam delete-instance-profile --instance-profile-name insight-bot-instance`.
3. **Удалить роль** `insight-bot-instance`.
4. **S3 → `vb-insight-bot-backups-apne1`** → бакет **версионируемый**, поэтому сначала Empty
   (удаляет и все версии, и delete-маркеры), и только потом Delete. Непустой версионируемый
   бакет не удаляется, и это самая частая заминка в этом списке.
5. **EC2 → Security Groups → `sg-01cb82a6578c17200`** → удалить. Дефолтный VPC `vpc-cef1fea9`
   **не трогать** — он принадлежит аккаунту, а не этому проекту.

Отдельного бюджетного стража `insight-bot-monthly` создать не успели, удалять нечего. Личный
бюджет аккаунта на $20/мес с оповещением на почту владельца существует с 2024 года и к этому
проекту не относится — его оставить.

## Проверка, что ничего не осталось

```
aws ec2 describe-instances --region ap-northeast-1 \
  --filters Name=tag:Project,Values=insight-bot --query 'Reservations[].Instances[].InstanceId'
aws iam list-roles --query "Roles[?RoleName=='insight-bot-instance'].RoleName"
aws s3api list-buckets --query "Buckets[?Name=='vb-insight-bot-backups-apne1'].Name"
aws ec2 describe-security-groups --region ap-northeast-1 \
  --group-ids sg-01cb82a6578c17200
```

Первые три должны вернуть пустые списки, последняя — ошибку `InvalidGroup.NotFound`.
