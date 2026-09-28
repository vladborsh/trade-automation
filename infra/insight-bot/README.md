# infra/insight-bot — IB-013

Hosting for `apps/insight-bot` (design `architecture/insight-bot-system-design.md` §7, D14):
one EC2 `t4g.small` in `ap-northeast-1`, docker compose with `postgres:16-alpine`, secrets from
SSM, a nightly `pg_dump` to S3, and a deploy path through ECR + `ssm send-command`.

> **Nothing has been applied.** No AWS resource exists: `terraform apply` and every other AWS
> action wait for the user's go-ahead (tasks/insight-bot.jsonl IB-013, Tech Lead note 2026-09-28).
> No AWS credentials were requested or used to write any of this.

## Layout

```
probe-venues.mjs              venue connectivity probe — run FIRST on a fresh box (§7)
RUNBOOK.md                    operations, in plain Russian (deploy, restore, rotate, /health, alerts)
terraform/                    the stack: EC2, security group, IAM, S3 backups, ECR
  versions.tf variables.tf main.tf iam.tf s3.tf ecr.tf outputs.tf
  user_data.sh.tftpl          first-boot script; inlines the files below so the box needs no repo
  terraform.tfvars.example    the two inputs a reviewer must set
  backend.tf.example          S3 state backend, for after the first apply
compose/docker-compose.yml    what runs on the box (NOT local dev — that is apps/insight-bot/)
scripts/                      render-env.sh, deploy.sh, backup.sh, restore.sh
systemd/                      insight-bot-backup.{service,timer} — 01:00 UTC
```

The GitHub Actions job is `.github/workflows/insight-bot-deploy.yml` (manual trigger for now).

## What a reviewer should check

- **No inbound ports.** `aws_security_group.insight_bot` has egress only; access is Session Manager.
- **No secrets anywhere.** Terraform creates no SSM parameter; `render-env.sh` pulls them at deploy
  time into a root-only `.env`. The RUNBOOK §4 has the `put-parameter` commands for the user.
- **Least privilege.** The instance role can pull only this ECR repo, read only `/insight-bot/*`,
  decrypt only via SSM, and write only the backup bucket.
- **Backups.** Versioned bucket, 35-day expiry on current and noncurrent versions, and a restore
  drill (`restore.sh … --into-check`) that never touches the live database.
- **Cost.** ≈ 22–24 USD/month (RUNBOOK §9): instance + 50 GB gp3 + small S3/ECR, no NAT gateway,
  default VPC.

## When the go-ahead arrives

1. `cd terraform && cp terraform.tfvars.example terraform.tfvars` and set `backup_bucket_name`.
2. `terraform init && terraform plan` — review, then apply.
3. Create the SSM parameters (RUNBOOK §4).
4. On the box: run `probe-venues.mjs` and paste the result into RUNBOOK §8.
5. After IB-003 merges: run the deploy workflow, then the restore drill once.

## Local checks that need no AWS

```bash
node --check infra/insight-bot/probe-venues.mjs
bash -n infra/insight-bot/scripts/*.sh
docker compose -f infra/insight-bot/compose/docker-compose.yml config -q   # needs the env vars set
terraform -chdir=infra/insight-bot/terraform fmt -check
terraform -chdir=infra/insight-bot/terraform validate                       # needs `terraform init`
```
