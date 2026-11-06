#!/usr/bin/env python3
# IB-149 — before any log ships to CloudWatch: count secrets in the containers' logs. Run ON THE BOX (root, it reads the
# rendered .env files). Prints COUNTS only — never a matching line, never a value. stdlib only (python 3.9).
#
#   log-secret-scan.py [--since 24h]     → a table per container × check; exit 0 when every count is 0, 1 otherwise
#
# Checks, over `docker logs --since <since>` of insight-bot, postgres and caddy (stdout + stderr):
#   value:<KEY>   the exact value of every secret-named key in /opt/insight-bot/.env and cloudflared.env (TOKEN, SECRET,
#                 PASSWORD, KEY, SALT, PRIVATE, COOKIE, DATABASE_URL in the name; values of 8+ characters)
#   bot_token     the Telegram bot-token shape: 8–10 digits ':' 35 of [A-Za-z0-9_-]
#   ib_session    a raw session cookie: ib_session= not followed by [Redacted] (deploy-watch.py's RAW_COOKIE)
#   pg_url_pass   a postgres:// URL carrying a password
#   aws_key       an AWS access key id shape (AKIA/ASIA + 16)
# Test seam: SECRET_SCAN_LOGS_DIR holds <container>.log files used instead of docker logs (watchdog.test.sh).
import os
import re
import subprocess
import sys

DEPLOY_DIR = os.environ.get('DEPLOY_DIR', '/opt/insight-bot')
LOGS_DIR = os.environ.get('SECRET_SCAN_LOGS_DIR')
SERVICES = ('insight-bot', 'postgres', 'caddy')
SECRET_NAME = re.compile(r'TOKEN|SECRET|PASSWORD|KEY|SALT|PRIVATE|COOKIE|DATABASE_URL', re.I)
SHAPES = {
    'bot_token': re.compile(r'(?<![0-9])[0-9]{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])'),
    'ib_session': re.compile(r'ib_session=(?!\[Redacted\])[^;\s"\']+'),
    'pg_url_pass': re.compile(r'postgres(?:ql)?://[^:/\s@]+:[^@\s]+@'),
    'aws_key': re.compile(r'\b(?:AKIA|ASIA)[0-9A-Z]{16}\b'),
}


def env_secrets(paths):
    """{key: value} for the secret-named keys of rendered .env files (KEY='value', '\\'' escapes)."""
    out = {}
    for path in paths:
        try:
            with open(path, encoding='utf-8') as f:
                lines = f.read().splitlines()
        except OSError:
            continue
        for line in lines:
            if line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            if len(v) >= 2 and v[0] == v[-1] and v[0] in '\'"':
                v = v[1:-1].replace("'\\''", "'")
            if SECRET_NAME.search(k) and len(v) >= 8:
                out[k] = v
    return out


def logs(service, since):
    if LOGS_DIR:
        with open(os.path.join(LOGS_DIR, service + '.log'), encoding='utf-8', errors='replace') as f:
            return f.read()
    cid = subprocess.run(['docker', 'compose', 'ps', '-aq', service], cwd=DEPLOY_DIR, capture_output=True, text=True).stdout.strip()
    if not cid:
        return None
    p = subprocess.run(['docker', 'logs', '--since', since, cid], capture_output=True, text=True, errors='replace')
    return p.stdout + p.stderr


def main(argv):
    since = argv[argv.index('--since') + 1] if '--since' in argv else '24h'
    secrets = env_secrets([os.path.join(DEPLOY_DIR, '.env'), os.path.join(DEPLOY_DIR, 'cloudflared.env')])
    checks = ['value:' + k for k in sorted(secrets)] + list(SHAPES)
    total, rows = 0, []
    for svc in SERVICES:
        text = logs(svc, since)
        if text is None:
            rows.append((svc, None, {}))
            continue
        counts = {'value:' + k: text.count(v) for k, v in secrets.items()}
        counts.update({k: len(r.findall(text)) for k, r in SHAPES.items()})
        total += sum(counts.values())
        rows.append((svc, len(text.splitlines()), counts))
    print('secret scan over docker logs --since %s; %d secret-named keys from the .env files' % (since, len(secrets)))
    print('| container | lines | ' + ' | '.join(checks) + ' |')
    print('|---|---|' + '---|' * len(checks))
    for svc, n, counts in rows:
        print('| %s | %s | %s |' % (svc, 'no container' if n is None else n, ' | '.join(str(counts.get(c, '—')) for c in checks)))
    print('TOTAL %d' % total)
    return 0 if total == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
