"""IB-150: CloudWatch alarm (via SNS) → one Telegram message to the owner.

Runs in AWS Lambda (python3.12), never on the box, so "the box is dead" still reaches the owner.
The bot token and chat id are read from SSM at call time (names in the environment); a value is
never in the code, the environment or tofu state.

One message per state change:
- CloudWatch sends one SNS notification per transition, to ALARM (alarm_actions) or to OK
  (ok_actions). Nothing is configured for INSUFFICIENT_DATA.
- A freshly created or edited alarm goes INSUFFICIENT_DATA → OK. That is not a recovery, so
  render() drops it; otherwise every apply would send one "в норме" per alarm.
- The handler raises only when Telegram did NOT accept the message. Lambda's async retry then
  re-sends a message that was never delivered, and never duplicates one that was.
"""
import datetime
import json
import os
import urllib.error
import urllib.parse
import urllib.request

TELEGRAM_API = 'https://api.telegram.org'


def _when(iso):
    # IB-152 house format: «06.11 17:15», zone named.
    try:
        t = datetime.datetime.strptime(iso[:19], '%Y-%m-%dT%H:%M:%S')
    except (TypeError, ValueError):
        return str(iso)
    return t.strftime('%d.%m %H:%M') + ' UTC'


def render(alarm):
    """The Telegram text for one CloudWatch alarm notification, or None to send nothing."""
    new = alarm.get('NewStateValue')
    old = alarm.get('OldStateValue')
    if new == 'OK' and old == 'INSUFFICIENT_DATA':
        return None  # a new or edited alarm settling, not a recovery
    if new == 'ALARM':
        head = '🔴 ТРЕВОГА'
    elif new == 'OK':
        head = '🟢 СНОВА В НОРМЕ'
    else:
        return None
    description = (alarm.get('AlarmDescription') or '').strip()
    lines = [head + ': ' + (description or alarm.get('AlarmName', '?'))]
    if new == 'ALARM':
        reason = (alarm.get('NewStateReason') or '').strip()
        if reason:
            lines.append('Подробности от AWS: ' + reason[:600])
    lines.append(_when(alarm.get('StateChangeTime')) + ' · ' + alarm.get('AlarmName', '?'))
    return '\n'.join(lines)


def _ssm_value(name):
    import boto3  # in the Lambda runtime; imported here so render() tests need no boto3

    ssm = boto3.client('ssm')
    return ssm.get_parameter(Name=name, WithDecryption=True)['Parameter']['Value']


def _send(token, chat_id, text):
    body = urllib.parse.urlencode({'chat_id': chat_id, 'text': text}).encode()
    req = urllib.request.Request(TELEGRAM_API + '/bot' + token + '/sendMessage', data=body, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        # Telegram answers 4xx for a bad token or chat. HTTPError carries the request URL, and the
        # URL carries the token, so the error is re-raised bare: `from None` keeps it out of the log.
        raise RuntimeError('telegram refused: HTTP %s' % e.code) from None
    if not payload.get('ok'):
        # The token is in the URL, never in this message.
        raise RuntimeError('telegram refused: ' + str(payload.get('description'))[:200])
    return (payload.get('result') or {}).get('message_id')


def handler(event, _context):
    sent = 0
    for record in event.get('Records', []):
        try:
            alarm = json.loads(record['Sns']['Message'])
        except (KeyError, TypeError, ValueError):
            print('not a CloudWatch alarm notification, skipped')
            continue
        text = render(alarm)
        if text is None:
            print('dropped: %s %s→%s' % (alarm.get('AlarmName'), alarm.get('OldStateValue'), alarm.get('NewStateValue')))
            continue
        token = _ssm_value(os.environ['TOKEN_PARAM'])
        chat_id = _ssm_value(os.environ['CHAT_PARAM'])
        message_id = _send(token, chat_id, text)
        sent += 1
        # The evidence line a test reads: which transition, and Telegram's id for the message.
        print('sent: %s %s→%s message_id=%s' % (alarm.get('AlarmName'), alarm.get('OldStateValue'), alarm.get('NewStateValue'), message_id))
    return {'sent': sent}
