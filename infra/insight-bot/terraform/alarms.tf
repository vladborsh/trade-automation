# IB-150 — PROPOSAL, NOT APPLIED. The box cannot report its own death.
#
# IB-149's watchdog (a 5-min systemd timer on the box) tells the owner when the bot is ill. Nothing
# on the box can say "the box is dead": a hung kernel, a stopped instance, a full disk that stops
# systemd timers, or the watchdog itself crashing. These two alarms watch from outside the box:
#
#   1. insight-bot-status-check-failed — AWS's own EC2 status checks (hardware/hypervisor, and an
#      unresponsive OS). Free metric from AWS/EC2; nothing on the box pushes it.
#   2. insight-bot-heartbeat-missing — a dead-man: the watchdog puts one datapoint of
#      InsightBot/WatchdogHeartbeat every tick; missing data is BREACHING, so silence alarms. That
#      proves the box, its timers, its IAM role and the watchdog are alive in one signal.
#
# Both notify through SNS → e-mail to the owner, and send the recovery (OK) too, so one incident is
# exactly two mails. E-mail, not a Telegram relay: it shares no dependency with the box's own alert
# path (Telegram API, the bot token), and it is three resources with no code (reports/dev-1-IB-150.md).
#
# APPLY ORDER: only after IB-149's watchdog pushes the heartbeat on the box. Applied earlier, the
# dead-man goes to ALARM after 15 min of a metric nobody writes yet and mails a false "box silent".
# The e-mail subscription stays "pending confirmation" until the owner clicks the link AWS sends;
# until then nothing is delivered.

locals {
  # The box role may write metrics to this namespace only (iam.tf, PutHeartbeat).
  heartbeat_namespace = "InsightBot"
  heartbeat_metric    = "WatchdogHeartbeat"
}

variable "alarm_email" {
  description = <<-EOT
    Where the box-is-dead alarms go (SNS e-mail). Empty creates the topic and alarms without a
    subscriber, which is useless: set it. Kept apart from budget_alert_email on purpose — it is the
    same person today, but a cost alert and an outage alert are different purposes.
  EOT
  type        = string
  default     = ""
}

# No kms_master_key_id: CloudWatch alarms cannot publish to a topic encrypted with the AWS-managed
# aws/sns key, and a customer key (1 USD/month) protects nothing here — the messages carry an alarm
# name and a state, no secret.
resource "aws_sns_topic" "alarms" {
  name = "insight-bot-alarms"
}

resource "aws_sns_topic_subscription" "alarms_email" {
  count = var.alarm_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# EC2 status checks are published every minute at no charge. 3 of 3 minutes failing → ALARM: one
# failed sample during a reboot is not an outage. A STOPPED box publishes nothing, so missing data
# keeps the last state here; the heartbeat alarm below is what catches a stopped box.
resource "aws_cloudwatch_metric_alarm" "status_check_failed" {
  alarm_name        = "insight-bot-status-check-failed"
  alarm_description = "IB-150: EC2 status checks of the insight-bot box failing for 3 min (instance or host)."

  namespace   = "AWS/EC2"
  metric_name = "StatusCheckFailed"
  dimensions  = { InstanceId = aws_instance.insight_bot.id }
  statistic   = "Maximum"
  period      = 60

  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  treat_missing_data  = "missing"

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}

# The dead-man. The watchdog's timer ticks every 5 min, and systemd may slide a tick by up to its
# AccuracySec (1 min by default), so one 5-min bucket can come out empty and the next hold two.
# 3 empty buckets in a row → ALARM: ~15 min from the last heartbeat to the mail, and no false alarm
# from a slid tick. SampleCount, not the value: what is measured is that a push happened.
resource "aws_cloudwatch_metric_alarm" "heartbeat_missing" {
  alarm_name        = "insight-bot-heartbeat-missing"
  alarm_description = "IB-150: no ${local.heartbeat_namespace}/${local.heartbeat_metric} from the box's watchdog for 15 min — the box, its timers or the watchdog (IB-149) are dead or stopped."

  namespace   = local.heartbeat_namespace
  metric_name = local.heartbeat_metric
  statistic   = "SampleCount"
  period      = 300

  comparison_operator = "LessThanThreshold"
  threshold           = 1
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  treat_missing_data  = "breaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}
