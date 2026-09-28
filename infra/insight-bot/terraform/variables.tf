variable "region" {
  description = "Design §7: Tokyo, so the venue sockets are close and not in a blocked region."
  type        = string
  default     = "ap-northeast-1"
}

variable "instance_type" {
  description = <<-EOT
    t4g.micro (2 vCPU arm64, 1 GB) + a 2 GB swap file: what fits the user's hard 20 USD/month cap
    (COST-PLAN.md). t4g.small is one edit plus stop/start when the backfill of IB-012 needs it.
  EOT
  type        = string
  default     = "t4g.micro"
}

variable "root_volume_gb" {
  description = <<-EOT
    gp3 root volume; the Postgres data directory lives on it. 20 GB ≈ one year of collection at
    §3.3's row estimate, and gp3 grows online — 50 GB would be +2.88 USD/month (COST-PLAN.md).
  EOT
  type        = number
  default     = 20
}

variable "backup_bucket_name" {
  description = "Globally unique S3 bucket for the daily pg_dump. Must be set explicitly."
  type        = string
}

variable "backup_retention_days" {
  description = "Design §7: 35 days, current and noncurrent versions alike."
  type        = number
  default     = 35
}

variable "image_ref" {
  description = <<-EOT
    The container image the box pulls, on GHCR (ECR is dropped: it bills per GB and GHCR is free
    for this use — COST-PLAN.md). The deploy step overrides the tag per release.
  EOT
  type        = string
  default     = "ghcr.io/vladborsh/insight-bot:latest"
}

variable "budget_alert_usd" {
  description = "AWS Budgets alerts the user above this monthly spend; 2 USD under the 20 cap."
  type        = number
  default     = 18
}

variable "budget_alert_email" {
  description = "Where the budget alert goes. Empty disables the budget (not recommended)."
  type        = string
  default     = ""
}

variable "ssm_parameter_prefix" {
  description = <<-EOT
    SSM Parameter Store prefix holding the SecureStrings the deploy step renders into the host's
    root-only .env. The parameters themselves are NOT created here: their values are secrets and
    belong to the user (RUNBOOK §4 has the put-parameter commands).
  EOT
  type        = string
  default     = "/insight-bot"
}

variable "deploy_role_github_sub" {
  description = <<-EOT
    The GitHub OIDC subject allowed to assume the deploy role, e.g.
    "repo:<owner>/<repo>:ref:refs/heads/master". Empty disables the deploy role, which is the
    default until the user decides how CI authenticates.
  EOT
  type        = string
  default     = ""
}

variable "github_oidc_provider_arn" {
  description = "ARN of the account's existing GitHub OIDC provider; empty means create none and skip the deploy role."
  type        = string
  default     = ""
}
