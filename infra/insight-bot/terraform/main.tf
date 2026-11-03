# The box itself: one instance, no inbound ports, SSM Session Manager for access (design §7, D11).

data "aws_ami" "al2023_arm64" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-arm64"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }
}

# Default VPC/subnet: the box needs outbound internet only, and a NAT gateway would cost more than
# the instance (design §7's 20–25 USD/month ceiling).
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Inbound: only TCP 80 and 443 for Caddy, from IPv4 anywhere, and only once var.open_web_ports is
# true (H3, H8: applied last, after the https name and the 404s are proven on the box). Never SSH
# (access is SSM Session Manager), never the app's 3005 (it stays on the compose network).
# The description is the group's original one: changing it would force a replacement.
resource "aws_security_group" "insight_bot" {
  name        = "insight-bot"
  description = "insight-bot: egress only, no inbound ports (SSM Session Manager for access)"
  vpc_id      = data.aws_vpc.default.id

  dynamic "ingress" {
    for_each = var.open_web_ports ? { http = 80, https = 443 } : {}
    content {
      description = ingress.key == "http" ? "Caddy: ACME HTTP-01 and the redirect to https" : "Caddy: the site"
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  egress {
    description = "All outbound: venue WS/REST, Telegram, ECR, SSM, S3"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "insight_bot" {
  ami                    = data.aws_ami.al2023_arm64.id
  instance_type          = var.instance_type
  subnet_id              = tolist(data.aws_subnets.default.ids)[0]
  vpc_security_group_ids = [aws_security_group.insight_bot.id]
  iam_instance_profile   = aws_iam_instance_profile.insight_bot.name

  # The root volume is the only copy of the liquidation tape since the last daily pg_dump, and a
  # venue never serves liquidations again. So a terminate must be deliberate (flip this first),
  # and even then the volume survives it (delete_on_termination = false below). RUNBOOK §10.
  disable_api_termination = true

  # IMDSv2 only.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
    encrypted   = true
    # Survives a terminate: an orphan 50 GB volume (≈ 4.80 USD/month) is cheaper than the tape.
    delete_on_termination = false
    tags                  = { Name = "insight-bot-root" }
  }

  user_data_replace_on_change = false # changing the bootstrap must not recycle the database volume
  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    region         = var.region
    ssm_prefix     = var.ssm_parameter_prefix
    backup_bucket  = aws_s3_bucket.backups.bucket
    compose_file   = file("${path.module}/../compose/docker-compose.yml")
    caddyfile      = file("${path.module}/../compose/Caddyfile")
    render_env_sh  = file("${path.module}/../scripts/render-env.sh")
    deploy_sh      = file("${path.module}/../scripts/deploy.sh")
    backup_sh      = file("${path.module}/../scripts/backup.sh")
    restore_sh     = file("${path.module}/../scripts/restore.sh")
    backup_service = file("${path.module}/../systemd/insight-bot-backup.service")
    backup_timer   = file("${path.module}/../systemd/insight-bot-backup.timer")
  })

  tags = { Name = "insight-bot" }

  # The AMI data source is most_recent: every new AL2023 release changes its id, and `ami` forces
  # replacement — the next plan would destroy the box and its root volume, which holds pgdata (the
  # liquidation tape a venue never serves again). OS updates happen on the box (dnf), not by
  # recreating it; a deliberate rebuild is `tofu apply -replace=aws_instance.insight_bot`.
  #
  # user_data is first-boot only: cloud-init runs it once per instance, and an in-place change is a
  # stop + ModifyInstanceAttribute + start, which takes the box down and changes its public IP for
  # nothing. So a later edit to any file inlined below (compose, scripts, systemd units) does not
  # reach a running box through tofu: scripts/sync-box.sh copies them over SSM (RUNBOOK §3). The
  # image tag never lived here after IB-083: it is in SSM /insight-bot/IMAGE_TAG (ECR design E10).
  lifecycle {
    ignore_changes = [ami, user_data]
  }
}
