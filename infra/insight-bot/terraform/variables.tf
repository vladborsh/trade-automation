variable "region" {
  description = "Design §7: Tokyo, so the venue sockets are close and not in a blocked region."
  type        = string
  default     = "ap-northeast-1"
}

variable "instance_type" {
  description = "t4g.small: 2 vCPU arm64, 2 GB (design §7). The cost ceiling assumes it."
  type        = string
  default     = "t4g.small"
}

variable "root_volume_gb" {
  description = "gp3 root volume; the Postgres data directory lives on it (design §7)."
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

variable "ecr_repository_name" {
  description = "ECR repository the GitHub Actions job pushes the arm64 image to."
  type        = string
  default     = "insight-bot"
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
