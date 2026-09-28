# The cost guard (user decision 2026-09-28: a hard 20 USD/month cap). Budgets themselves are free
# — the first two per account — and this one exists from the first apply so nobody has to remember
# it. `actual` catches a surprise that already happened; `forecasted` warns mid-month, which is the
# one that can still be acted on.

resource "aws_budgets_budget" "monthly" {
  count = var.budget_alert_email == "" ? 0 : 1

  name         = "insight-bot-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_alert_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}
