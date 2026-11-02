# IB-073 step 1 — adopt the five resources IB-013's partial apply left live in ap-northeast-1.
# The old terraform.tfstate is gone; the IDs come from ../LIVE-RESOURCES.md ("Что живёт").
#
# `tofu plan` must show 0 to change and 0 to destroy on these five. If it wants to update or
# replace any of them, STOP and show the diff — never apply over a live resource you did not
# expect to change.
#
# Import blocks are idempotent: once the resources are in state they are no-ops, so this file can
# stay until someone removes it deliberately.

import {
  to = aws_iam_role.instance
  id = "insight-bot-instance"
}

# NB: the import ID of a policy attachment is `<role-name>/<policy-arn>`, NOT the attachment ID
# LIVE-RESOURCES.md records (`insight-bot-instance-20261007192450730000000001` is the state's
# internal id). The policy ARN is the one iam.tf attaches.
import {
  to = aws_iam_role_policy_attachment.ssm_core
  id = "insight-bot-instance/arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

import {
  to = aws_iam_instance_profile.insight_bot
  id = "insight-bot-instance"
}

import {
  to = aws_security_group.insight_bot
  id = "sg-01cb82a6578c17200"
}

import {
  to = aws_s3_bucket.backups
  id = "vb-insight-bot-backups-apne1"
}
