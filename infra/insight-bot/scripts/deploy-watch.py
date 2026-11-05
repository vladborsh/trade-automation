#!/usr/bin/env python3
# IB-139 — the post-deploy watch, run ON THE BOX. deploy.sh starts it as its last step, after
# «healthy on …», as a transient systemd unit (insight-watch-<sha12>), so it outlives the SSM session.
# It replaces the dev's manual 30-min watch; the checks and the rollback rule are the same. It NEVER
# rolls back: on ALARM it tells the owner (operator chat, IB-011) and writes the exact rollback command.
#
#   deploy-watch.py watch --tag sha-<12> --prev sha-<12>|unknown --deploy-start <epoch>
#   deploy-watch.py notify-failed --tag sha-<12> --prev … --step <what failed>   # deploy.sh exit ≠ 0
#   either + --dry-run: never reads the token, never sends; prints what it would send
#
# 7 samples (t = 0, 5 … 30 min). Each records: (1) bot container restarts / OOMKilled / state;
# (2) host MemAvailable, swap used, bot and postgres memory (docker stats); (3) error/fatal lines in
# the bot log since the deploy (count + first 3); (4) ib_binance_weight_used_1m, read from /metrics
# INSIDE the container (Caddy 404s /metrics) — zero venue calls from this script; (5) OI alerts sent
# since boot: each alert's `recipients` ≤ the members eligible now, and Σ recipients == Σ «sent N» of
# the evaluation lines (there is NO per-recipient send log line: TelegramSender.sendTo logs only a
# failure); (6) GET https://<SITE_ADDRESS>/healthz from outside, through Caddy; (7) raw `ib_session=`
# in the bot log (IB-BUG-031 guard); (8) BUILD_SHA in the container env == the deployed sha.
# Check 5's OI-loop part: an «oi alerts <tf> @<close>» line for every 15m/1h/4h close whose evaluation
# (close + 6 min) plus the loop's lag fell inside the window — and the one the loop runs at boot.
#
# ALARM (the existing rollback rule, unchanged): MemAvailable < 100 MB on 2 ADJACENT samples; swap
# > 500 MB; any restart or OOM (or the container not running); /healthz failing on 2 adjacent samples;
# any raw cookie line; a BUILD_SHA mismatch. Plus two from check 5 (TL review, IB-139): an alert sent to more
# members than are eligible (`alert_oversend`), and an owed OI evaluation line missing (`oi_loop_missing`:
# the loop is dead or stuck). Error lines and the Σ sent mismatch stay WARNINGS in the files.
#
# Outputs (written after EVERY sample, so a lost watch still shows how far it got):
#   /var/log/insight-watch/<sha12>.json — samples, alarms, warnings, verdict (null while running)
#   /var/log/insight-watch/<sha12>.md   — the human table, in the shape of the dev watch reports
# Verdict: CLEAN | ALARM:<reason>[,<reason>…] | SUPERSEDED (deploy.sh wrote <sha12>.superseded-by and
# stopped this unit; an alarm already sent stays sent). Stopped any other way: no verdict — the dev's
# waiter (watch-wait.sh) calls «no verdict 40 min after the deploy» ALARM:watch_lost.
#
# The token: read from /opt/insight-bot/.env by THIS script, by key name; it goes to curl on stdin
# (`curl -K -`), never into argv, the files or the log. One message per alarm reason per deploy.
import json
import os
import re
import resource
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone

MEM_LOW_MB = 100
SWAP_HIGH_MB = 500
EVALUATE_AFTER_CLOSE_SEC = 6 * 60  # apps/insight-bot/src/alerts/oi-divergence/timing.ts
OI_LOOP_LAG_SEC = 5 * 60  # the loop ticks once a minute; an evaluation of 5 coins takes seconds
TF_SEC = {'15m': 900, '1h': 3600, '4h': 14400}
RAW_COOKIE = re.compile(r'ib_session=(?!\[Redacted\])[^;\s"\']+')
OI_LINE = re.compile(r'oi alerts (15m|1h|4h) @(\S+?Z): (\d+) coins, (\d+) found \(late (\d+)\), sent (\d+)')

DEPLOY_DIR = os.environ.get('DEPLOY_DIR', '/opt/insight-bot')
WATCH_DIR = os.environ.get('WATCH_DIR', '/var/log/insight-watch')
ENV_FILE = os.environ.get('WATCH_ENV_FILE', os.path.join(DEPLOY_DIR, '.env'))
MEMINFO = os.environ.get('WATCH_MEMINFO', '/proc/meminfo')
SAMPLES = int(os.environ.get('WATCH_SAMPLES', '7'))
INTERVAL = float(os.environ.get('WATCH_INTERVAL', '300'))
# Test seam: a JSON list of raw samples used instead of probing the box (deploy-watch.test.sh).
FAKE_SAMPLES = os.environ.get('WATCH_FAKE_SAMPLES')


def utc(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def hms(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime('%H:%M:%S')


def say(msg):
    print('deploy-watch: ' + msg, flush=True)


def run(args, timeout=60, cwd=None):
    """stdout of a command, or None when it fails (a failed probe is a null, never an alarm by itself)."""
    try:
        p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return p.stdout if p.returncode == 0 else None


def env_value(path, key):
    """One key of a rendered .env (KEY='value', '\\'' escapes). Only the asked key is ever read out."""
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                if not line.startswith(key + '='):
                    continue
                v = line[len(key) + 1:].rstrip('\n')
                if len(v) >= 2 and v[0] == v[-1] and v[0] in '\'"':
                    v = v[1:-1].replace("'\\''", "'")
                return v
    except OSError:
        return None
    return None


def parse_docker_time(s):
    """2026-11-05T14:13:13.123456789Z → epoch seconds (float)."""
    m = re.match(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?Z', s or '')
    if not m:
        return None
    base = datetime.strptime(m.group(1), '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc).timestamp()
    return base + (float('0' + m.group(2)) if m.group(2) else 0.0)


def mem_mib(s):
    m = re.match(r'([\d.]+)\s*([KMG]i?B|B)', s.strip())
    if not m:
        return None
    n, unit = float(m.group(1)), m.group(2)
    return round(n * {'B': 1 / 1048576, 'KiB': 1 / 1024, 'KB': 1 / 1024, 'MiB': 1, 'MB': 1, 'GiB': 1024, 'GB': 1024}[unit], 1)


# ---------------------------------------------------------------------------------------------- probes

def probe(deploy_start):
    """One raw sample of the box. Every field is independent: a probe that fails is null."""
    s = {'errors': []}
    ids = {}
    for svc in ('insight-bot', 'postgres'):
        out = run(['docker', 'compose', 'ps', '-q', svc], cwd=DEPLOY_DIR)
        ids[svc] = out.strip() if out is not None else None
    bot = ids['insight-bot']
    if bot == '':
        s['bot'] = {'id': None, 'state': 'missing'}
    elif bot:
        fmt = '{{.Id}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Status}}|{{.State.StartedAt}}'
        out = run(['docker', 'inspect', '--format', fmt, bot])
        if out:
            cid, restarts, oom, state, started = out.strip().split('|')
            s['bot'] = {'id': cid[:12], 'restarts': int(restarts), 'oom': oom == 'true', 'state': state,
                        'started_at': started, 'started_epoch': parse_docker_time(started)}
    if 'bot' not in s:
        s['errors'].append('bot container: docker did not answer')

    try:
        info = {}
        with open(MEMINFO) as f:
            for line in f:
                k, v = line.split(':', 1)
                info[k] = int(v.split()[0])
        s['mem'] = {'available_mb': info['MemAvailable'] // 1024, 'swap_mb': (info['SwapTotal'] - info['SwapFree']) // 1024}
    except (OSError, KeyError, ValueError):
        s['errors'].append('meminfo unreadable')

    targets = [i for i in (bot, ids['postgres']) if i]
    out = run(['docker', 'stats', '--no-stream', '--format', '{{.ID}}|{{.MemUsage}}'] + targets) if targets else None
    if out:
        rss = {}
        for line in out.strip().splitlines():
            cid, usage = line.split('|', 1)
            for name, full in (('bot', bot), ('postgres', ids['postgres'])):
                if full and full.startswith(cid[:12]):
                    rss[name] = mem_mib(usage.split('/')[0])
        s['rss_mib'] = rss

    running = s.get('bot', {}).get('state') == 'running'
    if running:
        logs = run(['docker', 'logs', '--since', str(int(deploy_start)), bot], timeout=60)
        if logs is None:
            s['errors'].append('docker logs failed')
        else:
            s['log'] = scan_log(logs)
        # (4) weight: the bot's own gauge, from inside the container (Caddy answers /metrics with 404)
        js = ('fetch("http://127.0.0.1:3005/metrics").then(r=>r.text()).then(t=>{'
              'const m=t.match(/^ib_binance_weight_used_1m (\\S+)$/m);console.log(m?m[1]:"")})'
              '.catch(()=>process.exit(1))')
        out = run(['docker', 'exec', bot, 'node', '-e', js], timeout=30)
        s['weight_1m'] = float(out.strip()) if out and out.strip() else None
        out = run(['docker', 'exec', bot, 'printenv', 'BUILD_SHA'], timeout=15)
        s['build_sha'] = out.strip() if out is not None else ''
    if ids['postgres']:
        s['db'] = db_probe(ids['postgres'], s.get('bot', {}).get('started_epoch') or deploy_start)
    s['healthz'] = healthz()
    return s


def scan_log(text):
    errors, first, cookie, oi = 0, [], 0, []
    for line in text.splitlines():
        if RAW_COOKIE.search(line):
            cookie += 1  # counted, never copied: the line IS the leak
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            rec = None
        if isinstance(rec, dict):
            level, msg, at = rec.get('level', 0), str(rec.get('msg', '')), rec.get('time')
        else:
            level, msg, at = (50 if re.search(r'\b(error|fatal)\b', line, re.I) else 0), line, None
        if isinstance(level, (int, float)) and level >= 50:
            errors += 1
            if len(first) < 3:
                first.append(msg[:200])
        m = OI_LINE.search(msg)
        if m:
            oi.append({'tf': m.group(1), 'bar_close': int(parse_docker_time(m.group(2)) or 0),
                       'found': int(m.group(4)), 'sent': int(m.group(6)),
                       'at': (at / 1000.0) if isinstance(at, (int, float)) else None})
    return {'errors': errors, 'first_errors': first, 'cookie_lines': cookie, 'oi': oi}


def db_probe(pg, since):
    q = ("select 'e', count(*), 0 from users where oi_alerts and not disabled and chat_id is not null "
         "union all select 'a', id, recipients from oi_divergence_alerts "
         "where source = 'live' and fired_at >= to_timestamp(%d) "
         "union all select 'f', coalesce(extract(epoch from max(fired_at))::bigint, 0), 0 from oi_divergence_alerts "
         "where source = 'live' and fired_at >= to_timestamp(%d)" % (int(since), int(since)))
    out = run(['docker', 'exec', pg, 'psql', '-U', 'insight', '-d', 'insight', '-At', '-F', '|', '-c', q], timeout=30)
    if out is None:
        return None
    db = {'eligible': None, 'alerts': [], 'last_fired': None}
    for line in out.strip().splitlines():
        kind, a, b = line.split('|')
        if kind == 'e':
            db['eligible'] = int(a)
        elif kind == 'a':
            db['alerts'].append({'id': int(a), 'recipients': int(b)})
        elif kind == 'f' and int(a) > 0:
            db['last_fired'] = int(a)
    return db


def healthz():
    url = os.environ.get('WATCH_HEALTHZ_URL')
    if not url:
        site = env_value(os.path.join(DEPLOY_DIR, 'caddy.env'), 'SITE_ADDRESS')
        base = ('https://' + site) if site else env_value(ENV_FILE, 'WEB_BASE_URL')
        if not base:
            return {'ok': None, 'code': None, 'url': None}
        url = base.rstrip('/') + '/healthz'
    out = run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', url], timeout=20)
    code = int(out) if out and out.strip().isdigit() else 0
    return {'ok': code == 200, 'code': code, 'url': url}


# ----------------------------------------------------------------------------------------------- rules

def adjacent(samples, i, bad):
    return i >= 1 and bad(samples[i]) and bad(samples[i - 1])


def alarms_at(samples, i, expected_sha, now, loop_enabled=True):
    """The alarm reasons firing at sample i (taken at `now`): {reason: plain-Russian detail}. Pure."""
    s, base = samples[i], samples[0]
    out = {}
    log, db = s.get('log'), s.get('db')
    boot = (s.get('bot') or {}).get('started_epoch')
    if log is not None and boot and loop_enabled:
        seen = {(o['tf'], o['bar_close']) for o in log['oi']}
        missing = [e for e in expected_evaluations(boot, now) if e not in seen]
        if missing:
            out['oi_loop_missing'] = 'цикл OI-сигналов молчит: нет проверки %s — сигналы участникам не уходят' % (
                ', '.join('%s за %s' % (tf, utc(c)[11:16]) for tf, c in missing))
    if db and db.get('eligible') is not None:
        over = [a for a in db['alerts'] if a['recipients'] > db['eligible']]
        if over:
            out['alert_oversend'] = ('OI-сигнал разослан большему числу людей, чем подписано сейчас (%s; подписано %d). '
                                     'Если кто-то отписался за эти полчаса, тревога ложная') % (
                ', '.join('№%d — %d' % (a['id'], a['recipients']) for a in over), db['eligible'])
    low = lambda x: x.get('mem', {}).get('available_mb') is not None and x['mem']['available_mb'] < MEM_LOW_MB
    if adjacent(samples, i, low):
        out['memory_low'] = 'свободной памяти %d и %d МБ два замера подряд (порог %d МБ)' % (
            samples[i - 1]['mem']['available_mb'], s['mem']['available_mb'], MEM_LOW_MB)
    swap = s.get('mem', {}).get('swap_mb')
    if swap is not None and swap > SWAP_HIGH_MB:
        out['swap_high'] = 'подкачка %d МБ (порог %d МБ)' % (swap, SWAP_HIGH_MB)
    bot, b0 = s.get('bot'), base.get('bot') or {}
    if bot:
        if bot.get('state') != 'running':
            out['container_not_running'] = 'контейнер бота не работает (состояние: %s)' % bot.get('state')
        if bot.get('oom'):
            out['oom'] = 'бот убит из-за нехватки памяти (OOM)'
        if bot.get('id') and b0.get('id') and (
                bot['id'] != b0['id'] or bot.get('restarts', 0) > b0.get('restarts', 0) or bot.get('started_at') != b0.get('started_at')):
            out['restart'] = 'бот перезапустился (рестартов: %s, старт %s)' % (bot.get('restarts'), bot.get('started_at', '')[:19])
    failing = lambda x: x.get('healthz', {}).get('ok') is False
    if adjacent(samples, i, failing):
        out['healthz_failed'] = 'сайт не отвечает на /healthz два замера подряд (код %s)' % s['healthz'].get('code')
    cookies = s.get('log', {}).get('cookie_lines', 0)
    if cookies:
        out['raw_cookie'] = 'в логе бота %d строк(и) с сырым ib_session= (утечка cookie)' % cookies
    if bot and bot.get('state') == 'running' and 'build_sha' in s and s['build_sha'] != expected_sha:
        out['build_sha_mismatch'] = 'в контейнере BUILD_SHA=%s, ожидали %s' % (s['build_sha'] or '(нет)', expected_sha)
    return out


def expected_evaluations(boot, now):
    """(tf, bar close) the OI loop must have logged by `now`: its boot evaluation, then every close whose
    evaluation (close + 6 min) plus the loop's lag falls inside the window. Pure."""
    out = []
    for tf, sec in TF_SEC.items():
        first = int((boot - EVALUATE_AFTER_CLOSE_SEC) // sec) * sec
        if boot + OI_LOOP_LAG_SEC <= now:
            out.append((tf, first))
        c = first + sec
        while c + EVALUATE_AFTER_CLOSE_SEC + OI_LOOP_LAG_SEC <= now:
            out.append((tf, c))
            c += sec
    return out


def warnings_at(s):
    """Error lines (check 3) and the Σ sent mismatch (check 5): findings, never alarms. Cumulative: the last
    sample's list is the watch's."""
    out = []
    log = s.get('log')
    if log and log['errors']:
        out.append('error_lines: %d (first: %s)' % (log['errors'], ' | '.join(log['first_errors'])))
    db = s.get('db')
    if db and log is not None:
        last_line = max([o['at'] for o in log['oi'] if o['at']] or [0])
        if db['last_fired'] is None or db['last_fired'] <= last_line:  # else an evaluation is mid-flight
            sent = sum(o['sent'] for o in log['oi'])
            rec = sum(a['recipients'] for a in db['alerts'])
            if sent != rec:
                out.append('oi_sent_mismatch: Σ recipients %d ≠ Σ «sent» %d in the evaluation lines' % (rec, sent))
    return out


# --------------------------------------------------------------------------------------------- telegram

def send_owner(text, dry_run):
    """One message to the operator chat (IB-011). The token never leaves this function except on curl's stdin."""
    if dry_run:
        say('dry run, would send: ' + text)
        return 'dry-run'
    token = env_value(ENV_FILE, 'TELEGRAM_BOT_TOKEN') or ''
    chat = env_value(ENV_FILE, 'TELEGRAM_SERVICE_CHAT_ID') or ''
    if not token or not chat:
        say('telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_SERVICE_CHAT_ID), not sent: ' + text)
        return 'not-configured'
    if not re.fullmatch(r'[A-Za-z0-9:_-]+', token):
        say('telegram token has unexpected characters, not sent')
        return 'failed'
    base = os.environ.get('TELEGRAM_API_BASE', 'https://api.telegram.org')
    config = 'url = "%s/bot%s/sendMessage"\n' % (base, token)
    try:
        p = subprocess.run(['curl', '-sS', '--max-time', '20', '-K', '-',
                            '--data-urlencode', 'chat_id=' + chat, '--data-urlencode', 'text=' + text,
                            '--data-urlencode', 'disable_web_page_preview=true'],
                           input=config, capture_output=True, text=True, timeout=30)
        ok, detail = p.returncode == 0 and '"ok":true' in p.stdout, 'rc %d %s' % (p.returncode, (p.stderr + p.stdout)[:300])
    except (OSError, subprocess.TimeoutExpired) as e:
        ok, detail = False, type(e).__name__
    if not ok:
        say('telegram send failed: ' + detail.replace(token, '<token>'))
    return 'sent' if ok else 'failed'


def rollback_cmd(prev):
    return '/opt/insight-bot/deploy.sh %s' % prev if prev.startswith('sha-') else '(прошлый тег неизвестен — см. aws ecr describe-images)'


# ------------------------------------------------------------------------------------------------ files

class Watch:
    def __init__(self, tag, prev, deploy_start, dry_run):
        self.tag, self.prev, self.dry_run = tag, prev, dry_run
        self.sha = tag[len('sha-'):]
        self.deploy_start = deploy_start
        self.loop_enabled = (env_value(ENV_FILE, 'OI_ALERTS_LOOP_ENABLED') or 'true').lower() not in ('false', '0', 'no', 'off')
        self.json_path = os.path.join(WATCH_DIR, self.sha + '.json')
        self.md_path = os.path.join(WATCH_DIR, self.sha + '.md')
        self.marker = os.path.join(WATCH_DIR, self.sha + '.superseded-by')
        self.doc = {'tag': tag, 'build_sha': self.sha, 'previous': prev, 'rollback': rollback_cmd(prev),
                    'deploy_start': utc(deploy_start), 'watch_start': utc(time.time()), 'pid': os.getpid(),
                    'unit': 'insight-watch-' + self.sha, 'state': 'running', 'verdict': None,
                    'alarms': [], 'warnings': [], 'samples': [], 'footprint': None, 'dry_run': dry_run,
                    'rules': {'memory_low_mb': MEM_LOW_MB, 'swap_high_mb': SWAP_HIGH_MB, 'samples': SAMPLES, 'interval_s': INTERVAL}}

    def archive_previous(self):
        os.makedirs(WATCH_DIR, mode=0o750, exist_ok=True)
        if os.path.exists(self.json_path):  # a redeploy of the same sha keeps the earlier watch beside it
            stamp = str(int(os.path.getmtime(self.json_path)))
            for p in (self.json_path, self.md_path):
                if os.path.exists(p):
                    os.replace(p, p[:-len(os.path.splitext(p)[1])] + '.' + stamp + os.path.splitext(p)[1])
        if os.path.exists(self.marker):
            os.remove(self.marker)

    def write(self):
        ru, rc = resource.getrusage(resource.RUSAGE_SELF), resource.getrusage(resource.RUSAGE_CHILDREN)
        secs = [x['seconds'] for x in self.doc['samples']]
        self.doc['footprint'] = {'max_rss_kb_self': ru.ru_maxrss, 'max_rss_kb_children': rc.ru_maxrss,
                                 'cpu_s': round(ru.ru_utime + ru.ru_stime + rc.ru_utime + rc.ru_stime, 2),
                                 'sample_s_max': max(secs) if secs else None}
        for path, body in ((self.json_path, json.dumps(self.doc, ensure_ascii=False, indent=1)), (self.md_path, self.markdown())):
            tmp = path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                f.write(body + '\n')
            os.replace(tmp, path)

    def markdown(self):
        d = self.doc
        L = ['# Watch %s — %s' % (d['tag'], d['verdict'] or 'running (%d of %d samples)' % (len(d['samples']), SAMPLES)), '',
             'Times are UTC. Deploy %s; watch %s; unit `%s`.' % (d['deploy_start'], d['watch_start'], d['unit']),
             'Rollback target: `%s` — **not run by this script; the TL decides.**' % d['rollback'], '']
        if d['alarms']:
            L += ['## Alarms', ''] + ['- **%s** at %s: %s — Telegram: %s' % (a['reason'], a['at'], a['detail'], a['telegram']) for a in d['alarms']] + ['']
        L += ['## Samples', '',
              '| UTC | t | available MB | swap MB | bot MiB | postgres MiB | restarts / OOM / state | /healthz | errors | weight/min | raw cookie | BUILD_SHA | sample s |',
              '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
        for x in d['samples']:
            m, r, b, h, lg = x.get('mem', {}), x.get('rss_mib', {}), x.get('bot') or {}, x.get('healthz', {}), x.get('log') or {}
            f = lambda v: '—' if v is None else str(v)
            L.append('| %s | %d min | %s | %s | %s | %s | %s / %s / %s | %s | %s | %s | %s | %s | %s |' % (
                x['time'][11:19], x['t_min'], f(m.get('available_mb')), f(m.get('swap_mb')), f(r.get('bot')), f(r.get('postgres')),
                f(b.get('restarts')), f(b.get('oom')), f(b.get('state')), f(h.get('code')), f(lg.get('errors')),
                f(x.get('weight_1m')), f(lg.get('cookie_lines')), f(x.get('build_sha')), x['seconds']))
        last = d['samples'][-1] if d['samples'] else {}
        oi = (last.get('log') or {}).get('oi', [])
        L += ['', '## OI loop and alert sends', '']
        L += ['- %s @%s: found %d, sent %d' % (o['tf'], utc(o['bar_close']), o['found'], o['sent']) for o in oi] or ['- no evaluation line yet']
        db = last.get('db')
        if db:
            L.append('- eligible members now: %s; alerts fired since boot: %s' % (
                db['eligible'], ', '.join('#%d → %d' % (a['id'], a['recipients']) for a in db['alerts']) or 'none'))
        L += ['', '## Warnings (recorded, never an alarm)', ''] + (['- ' + w for w in d['warnings']] or ['- none'])
        fp = d['footprint'] or {}
        L += ['', 'Footprint: max RSS %s KB (self) / %s KB (children), CPU %s s, slowest sample %s s.' % (
            fp.get('max_rss_kb_self'), fp.get('max_rss_kb_children'), fp.get('cpu_s'), fp.get('sample_s_max'))]
        return '\n'.join(L)

    def take(self, i):
        t = time.time()
        if FAKE_SAMPLES:
            with open(FAKE_SAMPLES) as f:
                raw = dict(json.load(f)[i])
        else:
            raw = probe(self.deploy_start)
        raw.update({'i': i, 't_min': int(round(i * INTERVAL / 60.0)), 'time': utc(t), 'seconds': round(time.time() - t, 2)})
        self.doc['samples'].append(raw)
        for reason, detail in sorted(alarms_at(self.doc['samples'], i, self.sha, t, self.loop_enabled).items()):
            if any(a['reason'] == reason for a in self.doc['alarms']):
                continue  # one message per reason per deploy
            text = 'Инсайт: тревога после выкладки %s: %s. Откат пока не делали — решает Tech Lead. Команда отката: %s' % (
                self.tag, detail, self.doc['rollback'])
            self.doc['alarms'].append({'reason': reason, 'at': raw['time'], 'sample': i, 'detail': detail,
                                       'telegram': send_owner(text, self.dry_run)})
            say('ALARM %s: %s' % (reason, detail))
        self.doc['warnings'] = warnings_at(raw)
        self.write()

    def finish(self, state):
        self.doc['state'] = state
        if state == 'superseded':
            self.doc['verdict'] = 'SUPERSEDED'
        elif state == 'done':
            reasons = [a['reason'] for a in self.doc['alarms']]
            self.doc['verdict'] = ('ALARM:' + ','.join(reasons)) if reasons else 'CLEAN'
        self.doc['watch_end'] = utc(time.time())
        self.write()
        say('%s → %s (%s)' % (self.tag, self.doc['verdict'], self.json_path))


def cmd_watch(a):
    w = Watch(a['--tag'], a.get('--prev', 'unknown'), float(a['--deploy-start']), a['--dry-run'])
    w.archive_previous()

    def on_term(signum, frame):
        superseded = os.path.exists(w.marker)
        w.finish('superseded' if superseded else 'stopped')  # stopped: no verdict → the waiter says watch_lost
        sys.exit(0)

    signal.signal(signal.SIGTERM, on_term)
    start = time.time()
    for i in range(SAMPLES):
        delay = start + i * INTERVAL - time.time()
        if delay > 0:
            time.sleep(delay)
        w.take(i)
    w.finish('done')
    return 0


def cmd_notify_failed(a):
    text = 'Инсайт: выкладка %s не удалась (%s). Наблюдение не запущено. Откат пока не делали — решает Tech Lead. Команда отката: %s' % (
        a['--tag'], a.get('--step', 'deploy.sh'), rollback_cmd(a.get('--prev', 'unknown')))
    result = send_owner(text, a['--dry-run'])
    say('deploy failed, owner told: ' + result)
    return 0


def main(argv):
    if not argv or argv[0] not in ('watch', 'notify-failed'):
        sys.stderr.write('usage: deploy-watch.py watch|notify-failed --tag sha-<12> [--prev sha-<12>] [--deploy-start <epoch>] [--step <text>] [--dry-run]\n')
        return 2
    a, rest = {'--dry-run': False}, argv[1:]
    while rest:
        k = rest.pop(0)
        if k == '--dry-run':
            a[k] = True
        elif k in ('--tag', '--prev', '--deploy-start', '--step') and rest:
            a[k] = rest.pop(0)
        else:
            sys.stderr.write('deploy-watch.py: unknown argument %s\n' % k)
            return 2
    if not re.fullmatch(r'sha-[0-9a-f]{12}', a.get('--tag', '')):
        sys.stderr.write('deploy-watch.py: --tag must be sha-<12 hex>\n')
        return 2
    if argv[0] == 'watch':
        if '--deploy-start' not in a:
            a['--deploy-start'] = str(time.time())
        return cmd_watch(a)
    return cmd_notify_failed(a)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
