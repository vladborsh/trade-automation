# https without a domain (architecture/https-without-domain-2026-11-03.md H1–H4).
# An Elastic IP gives the box a stable address; the site's name is derived from it on sslip.io,
# and Caddy (compose) obtains the certificate for that name.

# H2: the hostname IS the IP, so the IP must survive stop/start. Attached, it is billed as the one
# public IPv4 the plan already pays for (COST-PLAN). Never release it to save money: the address,
# every bot link and every session cookie would change with it.
resource "aws_eip" "insight_bot" {
  domain = "vpc"
  tags   = { Name = "insight-bot" }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_eip_association" "insight_bot" {
  instance_id   = aws_instance.insight_bot.id
  allocation_id = aws_eip.insight_bot.id
}

locals {
  # H4: computed, never typed — it cannot drift from the IP it names.
  site_hostname = "${replace(aws_eip.insight_bot.public_ip, ".", "-")}.sslip.io"

  # Plain (non-secret) settings the box renders from SSM. SITE_ADDRESS goes only to Caddy
  # (render-env.sh writes it to caddy.env, not the app's .env).
  web_parameters = {
    SITE_ADDRESS      = local.site_hostname
    WEB_BASE_URL      = "https://${local.site_hostname}"
    WEB_COOKIE_SECURE = "true"
    CLIENT_IP_HEADER  = "x-real-ip" # H6: Caddy overwrites X-Real-IP, so a client cannot forge it
  }
}

resource "aws_ssm_parameter" "web" {
  for_each = local.web_parameters

  name  = "${var.ssm_parameter_prefix}/${each.key}"
  type  = "String"
  value = each.value
}
