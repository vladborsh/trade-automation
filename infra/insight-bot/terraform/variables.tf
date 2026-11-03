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
    gp3 root volume; the Postgres data directory lives on it. 50 GB: owner ruling 2026-11-02,
    +2.88 USD/month over 20 GB (COST-PLAN.md). gp3 grows online (ModifyVolume + growpart + xfs_growfs); it cannot shrink.
  EOT
  type        = number
  default     = 50
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
    The GitHub OIDC subject allowed to assume the deploy role (ECR design E6): workflows on master
    of this repository only.
  EOT
  type        = string
  default     = "repo:vladborsh/trade-automation:ref:refs/heads/master"
}

variable "open_web_ports" {
  description = <<-EOT
    TCP 80 and 443 open to the internet for Caddy (https-without-domain H3). Turned on in the LAST
    apply of IB-082, after the image with Caddy is up and /metrics 404 + /health -> SPA are proven
    on the box through the https name (H8'). False closes them again.
  EOT
  type        = bool
  default     = false
}
