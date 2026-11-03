output "instance_id" {
  description = "For `aws ssm start-session --target <id>` and the deploy job's send-command."
  value       = aws_instance.insight_bot.id
}

output "ecr_repository_url" {
  description = "Where images are pushed (push-image.sh, CI) and pulled from; tags are sha-<12>, immutable."
  value       = aws_ecr_repository.insight_bot.repository_url
}

output "backup_bucket" {
  description = "Where the nightly pg_dump lands."
  value       = aws_s3_bucket.backups.bucket
}

output "deploy_role_arn" {
  description = "Role GitHub Actions assumes (repo variable AWS_DEPLOY_ROLE_ARN)."
  value       = aws_iam_role.deploy.arn
}

output "site_url" {
  description = "The site: https://<a-b-c-d>.sslip.io, derived from the Elastic IP (https-without-domain H4)."
  value       = "https://${local.site_hostname}"
}

output "elastic_ip" {
  description = "The box's stable public IPv4 (H2)."
  value       = aws_eip.insight_bot.public_ip
}
