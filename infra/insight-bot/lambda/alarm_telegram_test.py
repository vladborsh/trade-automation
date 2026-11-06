"""Run: python3 -I -m unittest discover -s infra/insight-bot/lambda -p '*_test.py'"""
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alarm_telegram as at  # noqa: E402


def alarm(old, new, **kw):
    a = {
        'AlarmName': 'insight-bot-publisher-dead',
        'AlarmDescription': 'Сервер молчит 15 минут',
        'OldStateValue': old,
        'NewStateValue': new,
        'NewStateReason': 'Threshold Crossed: 3 out of the last 3 datapoints were less than the threshold (1.0).',
        'StateChangeTime': '2026-11-06T19:05:12.345+0000',
    }
    a.update(kw)
    return a


def event(*alarms):
    return {'Records': [{'Sns': {'Message': json.dumps(a)}} for a in alarms]}


class Render(unittest.TestCase):
    def test_alarm_is_red_with_reason_time_and_name(self):
        t = at.render(alarm('OK', 'ALARM'))
        self.assertEqual(t.splitlines()[0], '🔴 ТРЕВОГА: Сервер молчит 15 минут')
        self.assertIn('Подробности от AWS: Threshold Crossed', t)
        self.assertTrue(t.endswith('06.11 19:05 UTC · insight-bot-publisher-dead'))

    def test_recovery_is_green_without_reason(self):
        t = at.render(alarm('ALARM', 'OK'))
        self.assertEqual(t.splitlines()[0], '🟢 СНОВА В НОРМЕ: Сервер молчит 15 минут')
        self.assertNotIn('Подробности', t)

    def test_new_alarm_settling_is_not_a_recovery(self):
        self.assertIsNone(at.render(alarm('INSUFFICIENT_DATA', 'OK')))

    def test_insufficient_to_alarm_is_sent(self):
        # e.g. the dead-man created while nothing publishes: it IS alarming.
        self.assertIsNotNone(at.render(alarm('INSUFFICIENT_DATA', 'ALARM')))

    def test_to_insufficient_data_sends_nothing(self):
        self.assertIsNone(at.render(alarm('OK', 'INSUFFICIENT_DATA')))

    def test_missing_description_falls_back_to_name(self):
        t = at.render(alarm('OK', 'ALARM', AlarmDescription=None))
        self.assertTrue(t.startswith('🔴 ТРЕВОГА: insight-bot-publisher-dead'))


class Handler(unittest.TestCase):
    def setUp(self):
        os.environ['TOKEN_PARAM'] = '/insight-bot-test/dev-1/TELEGRAM_BOT_TOKEN'
        os.environ['CHAT_PARAM'] = '/insight-bot-test/dev-1/TELEGRAM_CHAT_ID'

    def test_one_message_per_state_change_and_none_for_settling(self):
        with mock.patch.object(at, '_ssm_value', side_effect=lambda n: 'v:' + n), \
                mock.patch.object(at, '_send') as send:
            out = at.handler(event(alarm('OK', 'ALARM'), alarm('INSUFFICIENT_DATA', 'OK'), alarm('ALARM', 'OK')), None)
        self.assertEqual(out, {'sent': 2})
        self.assertEqual(send.call_count, 2)
        token, chat, _ = send.call_args_list[0].args
        self.assertEqual(token, 'v:/insight-bot-test/dev-1/TELEGRAM_BOT_TOKEN')
        self.assertEqual(chat, 'v:/insight-bot-test/dev-1/TELEGRAM_CHAT_ID')

    def test_telegram_refusal_raises_so_lambda_retries(self):
        with mock.patch.object(at, '_ssm_value', return_value='x'), \
                mock.patch.object(at, '_send', side_effect=RuntimeError('telegram refused: chat not found')):
            with self.assertRaises(RuntimeError):
                at.handler(event(alarm('OK', 'ALARM')), None)

    def test_dropped_notification_never_reads_secrets(self):
        with mock.patch.object(at, '_ssm_value') as ssm, mock.patch.object(at, '_send') as send:
            at.handler(event(alarm('INSUFFICIENT_DATA', 'OK')), None)
        ssm.assert_not_called()
        send.assert_not_called()

    def test_send_refusal_message_has_no_token(self):
        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b'{"ok": false, "description": "Unauthorized"}'

        with mock.patch.object(at.urllib.request, 'urlopen', return_value=Resp()):
            with self.assertRaises(RuntimeError) as cm:
                at._send('123:SECRETTOKEN', '-1001', 'x')
        self.assertNotIn('SECRETTOKEN', str(cm.exception))

    def test_http_error_is_reraised_without_the_url(self):
        url = 'https://api.telegram.org/bot123:SECRETTOKEN/sendMessage'
        err = at.urllib.error.HTTPError(url, 401, 'Unauthorized', {}, None)
        with mock.patch.object(at.urllib.request, 'urlopen', side_effect=err):
            with self.assertRaises(RuntimeError) as cm:
                at._send('123:SECRETTOKEN', '-1001', 'x')
        self.assertEqual(str(cm.exception), 'telegram refused: HTTP 401')
        self.assertIsNone(cm.exception.__cause__)
        self.assertTrue(cm.exception.__suppress_context__)


if __name__ == '__main__':
    unittest.main()
