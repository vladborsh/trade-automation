# IB-150 — monitoring in AWS (owner ruling C, 2026-11-06 evening). The box PUBLISHES (IB-149:
# watchdog.py publish, every 5 min, namespace InsightBot; logs through docker awslogs) and AWS
# ALARMS. Delivery is SNS → a Lambda → Telegram, so "the box is dead" reaches the owner without
# the box. The metric names, units and bands are the contract with IB-149:
# ~/.claude/jobs/0028abca/tmp/reports/ib149-150-metrics-contract.md (v1).
#
# COST: what costs money is the number of custom metrics ($0.30 each per month in Tokyo), then
# alarms ($0.10 each). var.monitoring_variant picks Full or Minimal; reports/dev-1-IB-150.md has the
# estimate. The metrics only exist once the publisher sends them, so IB-149's publisher must use
# the same variant: a metric published and not alarmed is still billed.
#
# Missing data, per alarm:
# - the dead-man: `breaching`. Silence IS the condition.
# - the error rate: `notBreaching`. The filter emits nothing when there are no errors.
# - every other alarm: `ignore`, which keeps the current state. A probe that fails omits its datum
#   (contract), and a dead publisher is the dead-man's subject. With `missing`, an alarm would
#   wander ALARM → INSUFFICIENT_DATA → OK. That recovery would arrive from INSUFFICIENT_DATA, and
#   the Lambda drops those (they are what a new alarm does when it settles).

locals {
  ns   = "InsightBot"
  full = var.monitoring_variant == "full"

  # The three liquidation venues the contract publishes LiqHeartbeatAgeSec for.
  liq_venues = ["binance", "bybit", "okx"]

  alarm_targets = [aws_sns_topic.alarms.arn]
}

variable "monitoring_variant" {
  description = <<-EOT
    "full": contract v1, 18 custom metrics, 13 alarms, about 7.3 USD/month at list price.
    "minimal": 10 metrics, 11 alarms, about 4.7 USD/month. It drops the Binance-weight and
    bot-restart alarms and the warn filter; IB-149's publisher then also stops sending
    ContainerRssMB, LiqPrintsPerMin, BinanceWeight1m and BotRestartCount as metrics.
    The owner's choice (reports/dev-1-IB-150.md).
  EOT
  type        = string
  default     = "minimal"

  validation {
    condition     = contains(["full", "minimal"], var.monitoring_variant)
    error_message = "monitoring_variant is \"full\" or \"minimal\"."
  }
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the bot, postgres and caddy groups (ruling C: 14–30)."
  type        = number
  default     = 14
}

variable "alarm_telegram_token_param" {
  description = <<-EOT
    SSM SecureString holding the bot token the alarm Lambda sends with. The owner puts the value;
    tofu never holds it. Production: the bot's own token, already in SSM. A test run points this
    at /insight-bot-test/<slot>/... with that slot's test bot.
  EOT
  type        = string
  default     = "/insight-bot/TELEGRAM_BOT_TOKEN"

  validation {
    # render-env.sh reads /insight-bot RECURSIVELY into the box's .env, keyed by the basename. A
    # test token under /insight-bot/<anything>/TELEGRAM_BOT_TOKEN would replace the production
    # token on the next deploy. So the only parameter allowed inside /insight-bot is the
    # production one itself.
    condition     = var.alarm_telegram_token_param == "/insight-bot/TELEGRAM_BOT_TOKEN" || !startswith(var.alarm_telegram_token_param, "/insight-bot/")
    error_message = "A test token must live outside /insight-bot/ (render-env.sh reads that tree recursively into the box's .env): use /insight-bot-test/<slot>/..."
  }
}

variable "alarm_telegram_chat_param" {
  description = "SSM parameter holding the chat id the alarms go to. Production: the operator chat the box's watch alarms already use."
  type        = string
  default     = "/insight-bot/TELEGRAM_SERVICE_CHAT_ID"

  validation {
    condition     = var.alarm_telegram_chat_param == "/insight-bot/TELEGRAM_SERVICE_CHAT_ID" || !startswith(var.alarm_telegram_chat_param, "/insight-bot/")
    error_message = "A test chat id must live outside /insight-bot/ (see alarm_telegram_token_param)."
  }
}

variable "alarm_email" {
  description = "Optional second channel: the same alarms by e-mail too (SNS). Empty = Telegram only."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------------------------
# Logs. IB-149 ships them with docker's awslogs driver and awslogs-create-group=false, so the
# groups exist here first and the box role needs no CreateLogGroup.
# ---------------------------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "box" {
  for_each = toset(["bot", "postgres", "caddy"])

  name              = "/insight-bot/${each.key}"
  retention_in_days = var.log_retention_days
}

# The bot logs pino JSON: level 50 = error, 40 = warn. No default_value, so there is no datapoint
# when there is nothing to count: a quiet hour costs nothing and leaves the alarm OK.
resource "aws_cloudwatch_log_metric_filter" "bot_errors" {
  name           = "insight-bot-errors"
  log_group_name = aws_cloudwatch_log_group.box["bot"].name
  pattern        = "{ $.level >= 50 }"

  metric_transformation {
    namespace = local.ns
    name      = "BotErrorCount"
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "bot_warns" {
  count = local.full ? 1 : 0

  name           = "insight-bot-warns"
  log_group_name = aws_cloudwatch_log_group.box["bot"].name
  pattern        = "{ $.level = 40 }"

  metric_transformation {
    namespace = local.ns
    name      = "BotWarnCount"
    value     = "1"
    unit      = "Count"
  }
}

# ---------------------------------------------------------------------------------------------
# Delivery: SNS → Lambda → Telegram (and optionally e-mail).
# ---------------------------------------------------------------------------------------------

# No kms_master_key_id: CloudWatch alarms cannot publish to a topic encrypted with the AWS-managed
# aws/sns key, and the messages carry an alarm name and a state, no secret.
resource "aws_sns_topic" "alarms" {
  name = "insight-bot-alarms"
}

resource "aws_sns_topic_subscription" "alarms_email" {
  count = var.alarm_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

data "archive_file" "alarm_telegram" {
  type        = "zip"
  source_file = "${path.module}/../lambda/alarm_telegram.py"
  output_path = "${path.module}/.build/alarm_telegram.zip"
}

resource "aws_iam_role" "alarm_telegram" {
  name = "insight-bot-alarm-telegram"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

data "aws_iam_policy_document" "alarm_telegram" {
  statement {
    sid     = "ReadTheTwoParameters"
    actions = ["ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.alarm_telegram_token_param}",
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.alarm_telegram_chat_param}",
    ]
  }

  statement {
    sid       = "DecryptSecureStrings"
    actions   = ["kms:Decrypt"]
    resources = ["*"] # the account's aws/ssm key; scoped by the condition below
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }

  statement {
    sid       = "WriteOwnLogs" # the group is created below, so no CreateLogGroup
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.alarm_telegram.arn}:*"]
  }
}

resource "aws_iam_role_policy" "alarm_telegram" {
  name   = "insight-bot-alarm-telegram"
  role   = aws_iam_role.alarm_telegram.id
  policy = data.aws_iam_policy_document.alarm_telegram.json
}

resource "aws_cloudwatch_log_group" "alarm_telegram" {
  name              = "/aws/lambda/insight-bot-alarm-telegram"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "alarm_telegram" {
  function_name    = "insight-bot-alarm-telegram"
  description      = "IB-150: CloudWatch alarm → owner Telegram, one message per state change"
  role             = aws_iam_role.alarm_telegram.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "alarm_telegram.handler"
  filename         = data.archive_file.alarm_telegram.output_path
  source_code_hash = data.archive_file.alarm_telegram.output_base64sha256
  memory_size      = 128
  timeout          = 15

  environment {
    variables = {
      TOKEN_PARAM = var.alarm_telegram_token_param # names only; the values are read at call time
      CHAT_PARAM  = var.alarm_telegram_chat_param
    }
  }

  depends_on = [aws_cloudwatch_log_group.alarm_telegram, aws_iam_role_policy.alarm_telegram]
}

# SNS invokes asynchronously. The handler raises only when Telegram did not accept the message,
# so a retry re-sends an undelivered alarm and never duplicates a delivered one.
resource "aws_lambda_function_event_invoke_config" "alarm_telegram" {
  function_name                = aws_lambda_function.alarm_telegram.function_name
  maximum_retry_attempts       = 2
  maximum_event_age_in_seconds = 3600
}

resource "aws_lambda_permission" "alarm_telegram_from_sns" {
  statement_id  = "AllowInsightBotAlarmsTopic"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.alarm_telegram.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.alarms.arn
}

resource "aws_sns_topic_subscription" "alarms_telegram" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.alarm_telegram.arn

  depends_on = [aws_lambda_permission.alarm_telegram_from_sns]
}

# ---------------------------------------------------------------------------------------------
# Alarms. alarm_description is the first line of the Telegram message: plain Russian for the owner.
# Bands are contract v1's, all on 5-minute buckets (the publisher's cadence) unless stated.
# ---------------------------------------------------------------------------------------------

# AWS's own checks of the instance and its host, every minute, free. 3 of 3 minutes.
resource "aws_cloudwatch_metric_alarm" "status_check_failed" {
  alarm_name        = "insight-bot-status-check-failed"
  alarm_description = "Amazon: сервер не проходит проверку состояния 3 минуты подряд (машина или сам Linux не отвечает)"

  namespace   = "AWS/EC2"
  metric_name = "StatusCheckFailed"
  dimensions  = { InstanceId = aws_instance.insight_bot.id }
  statistic   = "Maximum"
  period      = 60

  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  treat_missing_data  = "ignore" # a stopped box publishes nothing; the dead-man catches that

  alarm_actions = local.alarm_targets
  ok_actions    = local.alarm_targets
}

# The dead-man. The publisher puts PublisherAlive = 1 on every tick (OnCalendar *:0/5:30,
# AccuracySec 1 s). 3 empty buckets in a row → ALARM, ~15 min after the last tick. 3 of 3 and not
# 1 of 1, so one late tick across a bucket edge is not an outage.
resource "aws_cloudwatch_metric_alarm" "publisher_dead" {
  alarm_name        = "insight-bot-publisher-dead"
  alarm_description = "Сервер молчит 15 минут: сам сервер, его таймеры или сборщик метрик не работают (или сервер выключен)"

  namespace   = local.ns
  metric_name = "PublisherAlive"
  statistic   = "SampleCount"
  period      = 300

  comparison_operator = "LessThanThreshold"
  threshold           = 1
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  treat_missing_data  = "breaching"

  alarm_actions = local.alarm_targets
  ok_actions    = local.alarm_targets
}

resource "aws_cloudwatch_metric_alarm" "probe_failures" {
  alarm_name        = "insight-bot-probe-failures"
  alarm_description = "Сборщик метрик на сервере 10 минут не может снять часть показаний (docker, база или /metrics): остальные тревоги могут молчать"

  namespace   = local.ns
  metric_name = "ProbeFailures"
  statistic   = "Maximum"
  period      = 300

  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "ignore"

  alarm_actions = local.alarm_targets
  ok_actions    = local.alarm_targets
}

resource "aws_cloudwatch_metric_alarm" "memory_low" {
  alarm_name        = "insight-bot-memory-low"
  alarm_description = "На сервере кончается память: свободно меньше 120 МБ 10 минут подряд (обычно 170–240 МБ)"

  namespace   = local.ns
  metric_name = "MemAvailableMB"
  statistic   = "Minimum"
  period      = 300

  comparison_operator = "LessThanThreshold"
  threshold           = 120
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "ignore"

  alarm_actions = local.alarm_targets
  ok_actions    = local.alarm_targets
}

resource "aws_cloudwatch_metric_alarm" "swap_high" {
  alarm_name        = "insight-bot-swap-high"
  alarm_description = "Сервер работает на файле подкачки: занято больше 500 МБ 10 минут подряд, всё станет медленным"

  namespace   = local.ns
  metric_name = "SwapUsedMB"
  statistic   = "Maximum"
  period      = 300

  comparison_operator = "GreaterThanThreshold"
  threshold           = 500
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "ignore"

  alarm_actions = local.alarm_targets
  ok_actions    = local.alarm_targets
}

resource "aws_cloudwatch_metric_alarm" "site_down" {
  alarm_name        = "insight-bot-site-down"
  alarm_description = "Бот или сайт не отвечает 10 минут (/healthz не 200 или контейнер не запущен)"

  namespace   = local.ns
  metric_name = "HealthzOk"
  statistic   = "Minimum"
  period      = 300

  comparison_operator = "LessThanThreshold"
  threshold           = 1
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "ignore"

  alarm_actions = local.alarm_targets
  ok_actions    = local.alarm_targets
}

# The bot's own stale line is STALE_AFTER_MS = 120 s. One alarm per venue, so the message names it.
resource "aws_cloudwatch_metric_alarm" "liq_stream_silent" {
  for_each = toset(local.liq_venues)

  alarm_name        = "insight-bot-liq-silent-${each.key}"
  alarm_description = "Поток ликвидаций ${each.key} молчит больше 2 минут, и так 10 минут подряд: по этой бирже ликвидации сейчас не видны"

  namespace   = local.ns
  metric_name = "LiqHeartbeatAgeSec"
  dimensions  = { Venue = each.key }
  statistic   = "Maximum"
  period      = 300

  comparison_operator = "GreaterThanThreshold"
  threshold           = 120
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "ignore"

  alarm_actions = local.alarm_targets
  ok_actions    = local.alarm_targets
}

# Normal 394 s just after an evaluation, up to ~1,313 s before the next. Above 1,500 s one 15m
# close was missed (close + 6 min + 4 min slack, + one bar). 2,100 = "no line in the lookback".
resource "aws_cloudwatch_metric_alarm" "oi_loop_behind" {
  alarm_name        = "insight-bot-oi-loop-behind"
  alarm_description = "Проверка открытого интереса (OI) отстаёт: пропущено закрытие 15-минутной свечи, сигналы по OI сейчас не приходят"

  namespace   = local.ns
  metric_name = "OiEvalAgeSec"
  statistic   = "Maximum"
  period      = 300

  comparison_operator = "GreaterThanThreshold"
  threshold           = 1500
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "ignore"

  alarm_actions = local.alarm_targets
  ok_actions    = local.alarm_targets
}

# Baseline (reports/dev-1-IB-150.md): 0 level-50 errors in the ~5 h after the 2026-11-06 13:57
# restart. That is too short to call "normal", so the band is a storm, not "above zero":
# ≥ 5 errors in 15 min. Re-base after a measured week.
resource "aws_cloudwatch_metric_alarm" "bot_errors" {
  alarm_name        = "insight-bot-errors"
  alarm_description = "В журнале бота поток ошибок: 5 и больше за 15 минут (обычно 0)"

  namespace   = local.ns
  metric_name = "BotErrorCount"
  statistic   = "Sum"
  period      = 900

  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 5
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_targets
  ok_actions    = local.alarm_targets
}

resource "aws_cloudwatch_metric_alarm" "binance_weight_high" {
  count = local.full ? 1 : 0

  alarm_name        = "insight-bot-binance-weight-high"
  alarm_description = "Бот расходует больше половины лимита запросов Binance (1200 из 2400 в минуту) 10 минут подряд: рискуем блокировкой"

  namespace   = local.ns
  metric_name = "BinanceWeight1m"
  statistic   = "Maximum"
  period      = 300

  comparison_operator = "GreaterThanThreshold"
  threshold           = 1200
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "ignore"

  alarm_actions = local.alarm_targets
  ok_actions    = local.alarm_targets
}

# BotRestartCount is docker's RestartCount: it only grows, and a deploy recreates the container at 0.
# DIFF > 0 is "it restarted in the last 5 min". A deploy's drop to 0 is negative and does not alarm.
resource "aws_cloudwatch_metric_alarm" "bot_restarted" {
  count = local.full ? 1 : 0

  alarm_name          = "insight-bot-bot-restarted"
  alarm_description   = "Бот перезапустился сам (упал и поднялся снова): не выкладка, а сбой"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "ignore"

  metric_query {
    id          = "restarts"
    return_data = false
    metric {
      namespace   = local.ns
      metric_name = "BotRestartCount"
      stat        = "Maximum"
      period      = 300
    }
  }

  metric_query {
    id          = "grew"
    expression  = "DIFF(restarts)"
    label       = "restarts in the last 5 min"
    return_data = true
  }

  alarm_actions = local.alarm_targets
  ok_actions    = local.alarm_targets
}
