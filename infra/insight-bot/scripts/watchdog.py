#!/usr/bin/env python3
# IB-149 — the box's metric publisher, run ON THE BOX every 5 min by insight-watchdog.timer. The box only PUBLISHES:
# the alarms, their 2-of-2 logic, the dead-man and the Telegram messages live in CloudWatch (IB-150, owner ruling C,
# 2026-11-06 evening). Nothing here sends Telegram. stdlib only (python 3.9) + the aws CLI already on the box.
#
#   watchdog.py publish [--dry-run]   one tick: read the box, PutMetricData into InsightBot (one call)
#   --dry-run: reads only — prints the batch, never calls aws, writes no file
#
# The metric names, units and dimensions are the IB-149/150 contract (reports/ib149-150-metrics-contract.md);
# watchdog.test.sh pins them. A probe that fails OMITS its datums (never a made-up number) and adds 1 to
# ProbeFailures. PublisherAlive = 1 on every tick that reaches PutMetricData: the dead-man's input.
#
# VENUE WEIGHT: 0/min. Nothing here calls a venue: docker (ps/inspect/stats/logs), psql inside the postgres container,
# /proc/meminfo, the bot's /metrics on its container IP from the host, and one GET of the site's /healthz via Caddy.
#
# Credentials: the instance role, through the aws CLI's default chain (IMDS). No keys on disk. Until IB-150's grant
# is applied, PutMetricData is refused; that is logged and the tick still exits 0.
# It must never affect the bot: every failure (a probe, aws, an exception) is logged and the exit code is 0.
#
# What the liquidation readings can tell (the BUG-019 question): LiqHeartbeatAgeSec is collector_heartbeats, written
# by a PROCESS timer the collector starts in begin() — it proves the collector runs, not that its socket delivers (a
# socket open on a dead route keeps it fresh). LiqPrintsPerMin is what was STORED per venue; zero for a quiet market and
# zero for a mute socket look the same in one tick. Neither alone answers it; together, over a measured week, a venue
# at 0 prints while the other two print is the reading that does.
#
# Files: /var/log/insight-watchdog/last.json (every tick: readings, the batch, the aws result, the footprint).
import importlib.util
import json
import os
import resource
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.environ.get('WATCHDOG_LOG_DIR', '/var/log/insight-watchdog')
REGION = os.environ.get('AWS_REGION', 'ap-northeast-1')
NAMESPACE = 'InsightBot'

LIQ_STREAMS = (('binance', 'binance:forceOrder'), ('bybit', 'bybit:allLiquidation'), ('okx', 'okx:liquidation-orders'))
PRINTS_WINDOW_SEC = 300  # rows with ts in [now - 360, now - 60): 5 min, ending 60 s back for the batch writer
PRINTS_LAG_SEC = 60
OI_LOOKBACK_SEC = 2100  # 35 min: the newest 15m line is at most 900 + 413 s old when the loop is healthy
BOT_PORT = 3005
# IB-150's tofu `monitoring_variant` (owner decides, default minimal). The box reads the same word from
# /opt/insight-bot/monitoring-variant ('full' or 'minimal'; absent or anything else → minimal). minimal publishes these
# 9 metrics; the other 7 go to the journal line only (last.json keeps the whole batch either way).
MINIMAL = ('PublisherAlive', 'ProbeFailures', 'MemAvailableMB', 'SwapUsedMB', 'HealthzOk', 'LiqHeartbeatAgeSec', 'OiEvalAgeSec')


def utc(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def say(msg):
    print('watchdog: ' + msg, flush=True)


def deploy_watch():
    """deploy-watch.py as a module: its probes and its log parser (OI_LINE) — one copy of each on the box."""
    spec = importlib.util.spec_from_file_location('deploy_watch', os.path.join(HERE, 'deploy-watch.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def write_atomic(path, body):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(body + '\n')
    os.replace(tmp, path)


# ---------------------------------------------------------------------------------------------- gather

def gather(dw, now):
    """One raw reading of the box. Each probe is independent: a failed one is None and named in `failed`."""
    raw = {'now': now, 'failed': []}
    ids = {}
    for svc in ('insight-bot', 'postgres'):
        out = dw.run(['docker', 'compose', 'ps', '-aq', svc], cwd=dw.DEPLOY_DIR)
        ids[svc] = out.strip() if out is not None else None
    bot, pg = ids['insight-bot'], ids['postgres']

    raw['bot'] = None
    if bot:
        fmt = '{{.State.Status}}|{{.RestartCount}}|{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}'
        out = dw.run(['docker', 'inspect', '--format', fmt, bot])
        if out:
            state, restarts, ips = out.strip().split('|')
            raw['bot'] = {'state': state, 'restarts': int(restarts), 'ip': (ips.split() or [None])[0]}
    elif bot == '':
        raw['bot'] = {'state': 'missing', 'restarts': None, 'ip': None}
    if raw['bot'] is None or raw['bot']['restarts'] is None:
        raw['failed'].append('bot_inspect')

    raw['healthz'] = dw.healthz()['code']  # 0 when it did not answer: that IS the reading, not a failed probe

    raw['rss'] = None
    targets = [i for i in (bot, pg) if i]
    out = dw.run(['docker', 'stats', '--no-stream', '--format', '{{.ID}}|{{.MemUsage}}'] + targets) if targets else None
    if out:
        raw['rss'] = {}
        for line in out.strip().splitlines():
            cid, usage = line.split('|', 1)
            for name, full in (('bot', bot), ('postgres', pg)):
                if full and full.startswith(cid[:12]):
                    raw['rss'][name] = dw.mem_mib(usage.split('/')[0])
    if not raw['rss'] or set(raw['rss']) != {'bot', 'postgres'}:
        raw['failed'].append('docker_stats')

    raw['heartbeats'] = raw['prints'] = None
    if pg:
        venues = ', '.join("'%s'" % v for v, _ in LIQ_STREAMS)
        q = ("select 'h', stream, extract(epoch from last_seen_at)::bigint from collector_heartbeats where stream in (%s) "
             "union all select 'p', venue, count(*) from liquidations where venue in (%s) "
             "and ts >= to_timestamp(%d) and ts < to_timestamp(%d) group by venue"
             % (', '.join("'%s'" % s for _, s in LIQ_STREAMS), venues,
                int(now) - PRINTS_LAG_SEC - PRINTS_WINDOW_SEC, int(now) - PRINTS_LAG_SEC))
        out = dw.run(['docker', 'exec', pg, 'psql', '-U', 'insight', '-d', 'insight', '-At', '-F', '|', '-c', q], timeout=30)
        if out is not None:
            raw['heartbeats'], raw['prints'] = {}, {}
            for line in out.strip().splitlines():
                kind, key, n = line.split('|')
                (raw['heartbeats'] if kind == 'h' else raw['prints'])[key] = int(n)
    if raw['heartbeats'] is None:
        raw['failed'].append('psql')

    flag = (dw.env_value(dw.ENV_FILE, 'OI_ALERTS_LOOP_ENABLED') or 'true').lower()
    raw['oi'] = {'enabled': flag not in ('false', '0', 'no', 'off'), 'closes': None}
    if raw['oi']['enabled']:
        logs = dw.run(['docker', 'logs', '--since', str(int(now) - OI_LOOKBACK_SEC), bot], timeout=60) if bot else None
        if logs is None:
            raw['failed'].append('bot_logs')
        else:
            raw['oi']['closes'] = sorted({o['bar_close'] for o in dw.scan_log(logs)['oi'] if o['tf'] == '15m'})

    raw['weight'] = None
    ip = (raw['bot'] or {}).get('ip')
    if ip and (raw['bot'] or {}).get('state') == 'running':
        out = dw.run(['curl', '-sS', '--max-time', '5', 'http://%s:%d/metrics' % (ip, BOT_PORT)], timeout=10)
        for line in (out or '').splitlines():
            if line.startswith('ib_binance_weight_used_1m '):
                raw['weight'] = float(line.split()[1])
    if raw['weight'] is None:
        raw['failed'].append('bot_metrics')

    raw['mem'] = None
    try:
        info = {}
        with open(dw.MEMINFO) as f:
            for line in f:
                k, v = line.split(':', 1)
                info[k] = int(v.split()[0])
        raw['mem'] = {'available_mb': info['MemAvailable'] // 1024, 'swap_mb': (info['SwapTotal'] - info['SwapFree']) // 1024}
    except (OSError, KeyError, ValueError):
        raw['failed'].append('meminfo')
    return raw


# ---------------------------------------------------------------------------------------------- datums

def datums(raw):
    """The PutMetricData batch for one raw reading (the contract's 16 metrics). Pure."""
    now, out = raw['now'], []

    def put(name, value, unit, **dims):
        d = {'MetricName': name, 'Value': value, 'Unit': unit, 'Timestamp': utc(now)}
        if dims:
            d['Dimensions'] = [{'Name': k, 'Value': v} for k, v in sorted(dims.items())]
        out.append(d)

    put('PublisherAlive', 1, 'Count')
    put('ProbeFailures', len(raw.get('failed') or []), 'Count')
    mem = raw.get('mem')
    if mem:
        put('MemAvailableMB', mem['available_mb'], 'Megabytes')
        put('SwapUsedMB', mem['swap_mb'], 'Megabytes')
    for name in ('bot', 'postgres'):
        v = (raw.get('rss') or {}).get(name)
        if v is not None:
            put('ContainerRssMB', v, 'Megabytes', Container=name)
    bot = raw.get('bot') or {}
    if bot.get('restarts') is not None:
        put('BotRestartCount', bot['restarts'], 'Count')
    put('HealthzOk', 1 if raw.get('healthz') == 200 else 0, 'Count')
    beats, prints = raw.get('heartbeats'), raw.get('prints')
    for venue, stream in LIQ_STREAMS:
        if beats is not None and beats.get(stream) is not None:
            put('LiqHeartbeatAgeSec', max(0, int(now - beats[stream])), 'Seconds', Venue=venue)
        if prints is not None:
            put('LiqPrintsPerMin', round(prints.get(venue, 0) * 60.0 / PRINTS_WINDOW_SEC, 2), 'Count', Venue=venue)
    oi = raw.get('oi') or {}
    if oi.get('enabled') and oi.get('closes') is not None:
        put('OiEvalAgeSec', int(now - max(oi['closes'])) if oi['closes'] else OI_LOOKBACK_SEC, 'Seconds')
    if raw.get('weight') is not None:
        put('BinanceWeight1m', raw['weight'], 'Count')
    return out


# ---------------------------------------------------------------------------------------------- publish

def variant(dw):
    try:
        with open(os.path.join(dw.DEPLOY_DIR, 'monitoring-variant'), encoding='utf-8') as f:
            word = f.read().strip()
    except OSError:
        word = ''
    return 'full' if word == 'full' else 'minimal'


def short(d):
    dims = ','.join(x['Value'] for x in d.get('Dimensions', []))
    return '%s%s=%s' % (d['MetricName'], ('{%s}' % dims) if dims else '', d['Value'])


def put_metric_data(batch):
    """One aws CLI call. Returns 'ok' or a short reason; never raises."""
    fd, path = tempfile.mkstemp(prefix='insight-watchdog-', suffix='.json')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(batch, f)
        p = subprocess.run([os.environ.get('WATCHDOG_AWS', 'aws'), 'cloudwatch', 'put-metric-data', '--region', REGION,
                            '--namespace', NAMESPACE, '--metric-data', 'file://' + path],
                           capture_output=True, text=True, timeout=60)
        return 'ok' if p.returncode == 0 else 'rc %d: %s' % (p.returncode, (p.stderr or p.stdout).strip()[:300])
    except (OSError, subprocess.TimeoutExpired) as e:
        return type(e).__name__
    finally:
        os.remove(path)


def publish(dry_run):
    t0 = time.time()
    dw = deploy_watch()
    raw = gather(dw, t0)
    every = datums(raw)
    which = variant(dw)
    batch = every if which == 'full' else [d for d in every if d['MetricName'] in MINIMAL]
    unpublished = [short(d) for d in every if d not in batch]
    if dry_run:
        print(json.dumps({'at': utc(t0), 'raw': raw, 'namespace': NAMESPACE, 'variant': which, 'batch': batch,
                          'log_only': unpublished}, ensure_ascii=False, indent=1))
        return 0
    result = put_metric_data(batch)
    ru, rc = resource.getrusage(resource.RUSAGE_SELF), resource.getrusage(resource.RUSAGE_CHILDREN)
    doc = {'at': utc(t0), 'result': result, 'failed': raw['failed'], 'namespace': NAMESPACE, 'variant': which, 'batch': batch,
           'log_only': unpublished, 'raw': raw,
           'venue_weight_per_min': 0,
           'footprint': {'seconds': round(time.time() - t0, 2), 'max_rss_kb_self': ru.ru_maxrss, 'max_rss_kb_children': rc.ru_maxrss}}
    os.makedirs(LOG_DIR, mode=0o750, exist_ok=True)
    write_atomic(os.path.join(LOG_DIR, 'last.json'), json.dumps(doc, ensure_ascii=False, indent=1))
    say('%s: %d datums, put-metric-data %s%s%s' % (which, len(batch), result,
                                                   ('; failed probes: ' + ', '.join(raw['failed'])) if raw['failed'] else '',
                                                   ('; not published: ' + ' '.join(unpublished)) if unpublished else ''))
    return 0


def main(argv):
    if argv[:1] != ['publish'] or any(a != '--dry-run' for a in argv[1:]):
        sys.stderr.write('usage: watchdog.py publish [--dry-run]\n')
        return 2
    try:
        return publish('--dry-run' in argv[1:])
    except Exception as e:  # never affect the bot; no PublisherAlive this tick, so the dead-man sees a broken publisher
        say('tick failed, nothing published: %s: %s' % (type(e).__name__, e))
        return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
