#!/usr/bin/env python3
# IB-140 — scheduled checks ON THE BOX, run by systemd timers instead of an agent session (owner rule,
# 2026-11-05: no agent waits or polls by hand; a check is code with a verdict). stdlib only (python 3.9).
#
#   checks.py run <name> [--dry-run]          run one check now: files + sentinel; Telegram on FAIL only
#   checks.py schedule <name> <OnCalendar>    one-shot timer: systemd-run --on-calendar … --unit insight-check-<name>
#   checks.py list                            the checks this script knows
#
# Every check writes /var/log/insight-checks/<name>.json and .md (atomically), then the sentinel
# <name>.done holding one line: the verdict. The dev's waiter (check-wait.sh) polls for the sentinel.
#
# Verdict: PASS | FLAG:<reason>[,<reason>…] | FAIL:<why>
#   PASS / FLAG — the check ran; FLAG names figures outside their band (a finding, for the TL to read).
#   FAIL        — the check itself broke (a query failed, an input was missing). Only FAIL reaches the
#                 owner's Telegram (IB-139's path, operator chat); PASS and FLAG never do.
#
# Each check is gather() (box: psql, sar, docker) → evaluate(raw) (pure). Test seam: CHECKS_FAKE_INPUT
# names a JSON file used as gather()'s output, so checks.test.sh runs every evaluate() offline.
#
# The token is never read here: Telegram goes through deploy-watch.py's send_owner (reads .env by key,
# token on curl's stdin only).
import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

DEPLOY_DIR = os.environ.get('DEPLOY_DIR', '/opt/insight-bot')
CHECKS_DIR = os.environ.get('CHECKS_DIR', '/var/log/insight-checks')
FAKE_INPUT = os.environ.get('CHECKS_FAKE_INPUT')
HERE = os.path.dirname(os.path.abspath(__file__))


def utc(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def epoch(s):
    return datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp()


def say(msg):
    print('checks: ' + msg, flush=True)


class CheckFailed(Exception):
    """The check could not measure: its verdict is FAIL, and the owner hears about it."""


def sh(args, timeout=120, cwd=None):
    try:
        p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise CheckFailed('%s: %s' % (args[0], type(e).__name__))
    if p.returncode != 0:
        raise CheckFailed('%s exit %d: %s' % (' '.join(args[:3]), p.returncode, (p.stderr or p.stdout).strip()[:200]))
    return p.stdout


def psql(sql):
    """Rows of a query as lists of strings (tab-separated, PGTZ=UTC so timestamps print in UTC)."""
    out = sh(['docker', 'compose', 'exec', '-T', '-e', 'PGTZ=UTC', 'postgres', 'psql', '-U', 'insight', '-d', 'insight',
              '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\t', '-c', sql], cwd=DEPLOY_DIR)
    return [line.split('\t') for line in out.splitlines() if line]


def num(v):
    return None if v in (None, '') else float(v)


def band(flags, name, value, lo, hi, unit=''):
    """A figure against its band; outside → a FLAG reason. Returns the table row."""
    ok = value is not None and lo <= value <= hi
    if not ok:
        flags.append(name)
    return {'figure': name, 'value': value, 'band': '%s–%s%s' % (lo, hi, unit), 'ok': ok}


# ------------------------------------------------------------------------------------------------- v28
# IB-115's V28 live day: architecture/oi-divergence-design-2026-11-04.md row V28; the kit and the bands are
# reports/dev-3-deploy-IB-115.md «V28 day measurement». Bands are «> 2× off V28, either way». Only rows with
# source = 'live' are the V28 day: the IB-116 backfill ran inside the same window and is reported apart.

V28_FROM = '2026-11-04T21:41:43Z'
V28_TO = '2026-11-05T21:41:43Z'
PATH_WEIGHT = {'4h': 1, '24h': 2, '72h': 5}  # V24: 48 bars → 1, 288 → 2, 864 → 5
V28_SUBJECTS_PER_DAY = 1100 / 8  # V28: ≈ 1 100 path weight/day at 1+2+5 per subject
WIN_SEC = {'4h': 14400, '24h': 86400, '72h': 259200}
# Known in the window, from the TL's record (not derivable from the box): the bot's restart.
V28_EVENTS = ['bot restart 10:27:14 → 10:27:25 UTC (TL record)']


def v28_gather():
    w = "'%s'::timestamptz and %%s < '%s'::timestamptz" % (V28_FROM, V28_TO)
    win = lambda col: '%s >= %s' % (col, w % col)
    raw = {'from': V28_FROM, 'to': V28_TO, 'now': utc(time.time())}
    raw['controls'] = psql("select source, kind, tf, count(*) from oi_divergence_controls where %s group by 1,2,3 order by 1,2,3" % win('created_at'))
    raw['near'] = psql("select source, rule, tf, count(*), round(avg(miss)::numeric,3) from oi_divergence_near_misses where %s group by 1,2,3 order by 1,2,3" % win('created_at'))
    raw['alerts'] = psql("select source, count(*), count(*) filter (where late), coalesce(sum(recipients),0) from oi_divergence_alerts where %s group by 1" % win('confirmed_at'))
    # paths by their subject's source; overdue = the window closed (+60 s) and still no measurement
    raw['paths'] = psql(
        "select coalesce(a.source, c.source, n.source), p.win, count(*), count(p.measured_at),"
        " count(*) filter (where p.measured_at is null and p.tried_at is not null),"
        " count(*) filter (where p.measured_at is null and p.t0 + case p.win when '4h' then 14400 when '24h' then 86400 else 259200 end * interval '1 second' + interval '60 s' < now()),"
        " count(*) filter (where %s),"
        " count(*) filter (where p.order_ambiguous), count(*) filter (where p.measured_at is not null and p.entry_at <> p.t0),"
        " extract(epoch from min(p.measured_at))"
        " from oi_divergence_paths p left join oi_divergence_alerts a on a.id = p.alert_id"
        " left join oi_divergence_controls c on c.id = p.control_id left join oi_divergence_near_misses n on n.id = p.near_miss_id"
        " group by 1, 2 order by 1, 2" % win('p.measured_at'))
    raw['sizes'] = psql("select c.relname, pg_total_relation_size(c.oid), (select count(*) from oi_divergence_paths) from pg_class c"
                        " where relname in ('oi_divergence_paths','oi_divergence_controls','oi_divergence_near_misses','oi_divergence_alerts') order by 1")
    # builds that wrote live rows inside the window: each first row marks a deploy (or the boot)
    raw['builds'] = psql("select build, extract(epoch from min(created_at)) from (select build, created_at from oi_divergence_controls where source = 'live' and %s"
                         " union all select build, created_at from oi_divergence_near_misses where source = 'live' and %s) x group by 1 order by 2"
                         % (win('created_at'), win('created_at')))
    raw['sar'] = sar_points(V28_FROM, V28_TO)
    raw['weight_now'] = weight_gauge()
    return raw


def sar_points(frm, to):
    """(epoch, MemAvailable MB, swap used MB) every 10 min from sysstat's daily files, for the days the window
    covers. Missing files are a gap in the trend, not a failure (sysstat may have been off)."""
    pts = []
    day = int(epoch(frm) // 86400) * 86400
    while day < epoch(to):
        f = '/var/log/sa/sa%s' % datetime.fromtimestamp(day, timezone.utc).strftime('%d')
        if os.path.exists(f):
            env = dict(os.environ, LC_ALL='C', S_TIME_FORMAT='ISO')
            for opt, col in (('-r', 'avail'), ('-S', 'swap')):
                p = subprocess.run(['sadf', '-d', f, '--', opt], capture_output=True, text=True, env=env, timeout=60)
                lines = [l for l in p.stdout.splitlines() if l and not l.startswith('#')]
                for l in lines:
                    c = l.split(';')  # hostname;interval;timestamp;… (sadf -d; timestamps are UTC)
                    t = datetime.strptime(c[2][:19], '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).timestamp()
                    if not epoch(frm) <= t < epoch(to):
                        continue
                    v = int(c[4]) // 1024  # -r: kbavail; -S: kbswpused — both the 5th field
                    pts.append({'t': t, col: v})
        day += 86400
    merged = {}
    for p in pts:
        merged.setdefault(p['t'], {'t': p['t']}).update(p)
    return sorted(merged.values(), key=lambda x: x['t'])


def weight_gauge():
    js = ('fetch("http://127.0.0.1:3005/metrics").then(r=>r.text()).then(t=>{'
          'const m=t.match(/^ib_binance_weight_used_1m (\\S+)$/m);console.log(m?m[1]:"")}).catch(()=>process.exit(1))')
    try:
        out = sh(['docker', 'compose', 'exec', '-T', 'insight-bot', 'node', '-e', js], timeout=30, cwd=DEPLOY_DIR)
        return float(out.strip()) if out.strip() else None
    except CheckFailed:
        return None  # a gauge is context, not a measurement the verdict needs


def v28_evaluate(raw):
    flags, rows, notes = [], [], list(V28_EVENTS)
    days = (epoch(raw['to']) - epoch(raw['from'])) / 86400.0
    if epoch(raw['now']) < epoch(raw['to']):
        if not os.environ.get('CHECKS_ALLOW_EARLY'):
            raise CheckFailed('ran at %s, before the window closes at %s' % (raw['now'], raw['to']))
        notes.append('EARLY RUN (CHECKS_ALLOW_EARLY): the window is still open at %s; figures are partial' % raw['now'])
    live = lambda rows_, i=0: [r for r in rows_ if r[i] == 'live']
    ctl = live(raw['controls'])
    pivot = sum(int(r[3]) for r in ctl if r[1] == 'pivot')
    random_ = sum(int(r[3]) for r in ctl if r[1] == 'random')
    near = sum(int(r[3]) for r in live(raw['near']))
    rows.append(band(flags, 'pivot_controls', pivot, 50, 200))
    # random picks are hashed by UTC date: a window crossing midnight may get 28–32 (kit); outside that, flag
    rows.append(band(flags, 'random_controls', random_, 28, 32))
    if random_ != 30 and 28 <= random_ <= 32:
        notes.append('random controls %d ≠ 30: the window crosses midnight and the picks are hashed by UTC date' % random_)
    rows.append(band(flags, 'near_misses', near, 2.5, 10))
    if near == 0:
        notes.append('0 near-misses needs explaining: name the path that would write one (diagnose at len − (2k+N+1)) before calling it «none happened»')
    paths = live(raw['paths'])
    written = sum(int(r[2]) for r in paths)
    rows.append(band(flags, 'paths_written', written, 200, 800))
    failing = sum(int(r[4]) for r in paths)
    overdue = sum(int(r[5]) for r in paths)
    for name, v in (('paths_failing', failing), ('paths_overdue', overdue)):
        rows.append(band(flags, name, v, 0, 0))
    weight = sum(int(r[6]) * PATH_WEIGHT[r[1]] for r in paths) / (days * 1440)
    # V28 ≈ 1 100/day is steady state: ≈ 137.5 subjects/day × (1+2+5). On the first live day a window can only
    # close for a subject at least `win` old, so the band is V28's share for the windows that could close.
    live_since = max(epoch(raw['from']), min([float(r[1]) for r in raw['builds']] or [epoch(raw['from'])]))
    span = epoch(raw['to']) - live_since
    share = sum(w * max(0.0, 1 - WIN_SEC[k] / span) for k, w in PATH_WEIGHT.items()) if span > 0 else 0
    expect = V28_SUBJECTS_PER_DAY * share / 1440
    rows.append(band(flags, 'path_weight_per_min', round(weight, 3), round(expect / 2, 3), round(expect * 2, 3)))
    notes.append('path weight band = 2× around V28\'s share for windows that could close since live rows began (%s): '
                 '%.2f of 8 weight units per subject (steady state 0.4–1.6/min)' % (utc(live_since), share))
    total = None if raw.get('weight_now') is None else round(raw['weight_now'] + weight, 2)
    rows.append(band(flags, 'binance_weight_per_min', total, 0, 4))
    sizes = {r[0]: int(r[1]) for r in raw['sizes']}
    n_paths = int(raw['sizes'][0][2]) if raw['sizes'] else 0
    per_row = round(sizes.get('oi_divergence_paths', 0) / n_paths) if n_paths else None
    rows.append(band(flags, 'path_bytes_per_row', per_row, 75, 300, ' B'))
    if per_row:
        notes.append('paths table: %d rows (all sources) → %.1f MB per 145 k rows/year at this size' % (n_paths, per_row * 145000 / 1e6))
    sar = raw.get('sar') or []
    avail = [p['avail'] for p in sar if 'avail' in p]
    swap = [p['swap'] for p in sar if 'swap' in p]
    if avail:
        rows.append(band(flags, 'mem_available_min_mb', min(avail), 100, 10 ** 6))
    if swap:
        rows.append(band(flags, 'swap_used_max_mb', max(swap), 0, 500))
    if not sar:
        notes.append('no sysstat points in the window: memory trend not measured')
    mins = [float(r[9]) for r in paths if r[9]]
    first = utc(min(mins)) if mins else None
    backfill = {'controls': sum(int(r[3]) for r in raw['controls'] if r[0] != 'live'),
                'near_misses': sum(int(r[3]) for r in raw['near'] if r[0] != 'live'),
                'paths_measured_in_window': sum(int(r[6]) for r in raw['paths'] if r[0] != 'live'),
                'path_weight_in_window': sum(int(r[6]) * PATH_WEIGHT[r[1]] for r in raw['paths'] if r[0] != 'live')}
    if any(backfill.values()):
        notes.append('IB-116 backfill rows inside the window are NOT the V28 day and are left out of every band: %s' % json.dumps(backfill))
    alerts = live(raw['alerts'])
    measured = {
        'controls_live': [{'kind': r[1], 'tf': r[2], 'n': int(r[3])} for r in ctl],
        'near_misses_live': [{'rule': r[1], 'tf': r[2], 'n': int(r[3]), 'avg_miss': num(r[4])} for r in live(raw['near'])],
        'alerts_live': {'n': int(alerts[0][1]), 'late': int(alerts[0][2]), 'recipients': int(alerts[0][3])} if alerts else {'n': 0, 'late': 0, 'recipients': 0},
        'paths_live': [{'win': r[1], 'rows': int(r[2]), 'measured': int(r[3]), 'failing': int(r[4]), 'overdue': int(r[5]),
                        'measured_in_window': int(r[6]), 'order_ambiguous': int(r[7]), 'entry_not_t0': int(r[8])} for r in paths],
        'first_live_measurement': first,
        'sizes_bytes': sizes,
        'builds_in_window': [{'build': r[0], 'first_live_row': utc(float(r[1]))} for r in raw['builds']],
        'memory_trend': {'points': len(sar), 'available_mb_first_last_min_max': [avail[0], avail[-1], min(avail), max(avail)] if avail else None,
                         'swap_mb_first_last_max': [swap[0], swap[-1], max(swap)] if swap else None},
        'weight_gauge_now': raw.get('weight_now'),
        'backfill_in_window': backfill,
    }
    if len(raw['builds']) > 1:
        notes.append('%d builds wrote live rows in the window (deploys inside it): %s' % (
            len(raw['builds']), ', '.join('%s from %s' % (b['build'], b['first_live_row'][11:19]) for b in measured['builds_in_window'])))
    return {'flags': flags, 'rows': rows, 'notes': notes, 'measured': measured}


# --------------------------------------------------------------------------------------------- runner

CHECKS = {'v28': (v28_gather, v28_evaluate, 'IB-115 V28 live day [%s, %s)' % (V28_FROM, V28_TO))}


def send_owner(text, dry_run):
    spec = importlib.util.spec_from_file_location('deploy_watch', os.path.join(HERE, 'deploy-watch.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.send_owner(text, dry_run)


def write_atomic(path, body):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(body + '\n')
    os.replace(tmp, path)


def markdown(doc):
    L = ['# Check %s — %s' % (doc['check'], doc['verdict']), '', doc['title'], '',
         'Ran %s → %s UTC on the box (`%s`).' % (doc['started'], doc['finished'], doc['unit']), '']
    if doc.get('error'):
        L += ['**The check broke:** %s' % doc['error'], '']
    res = doc.get('result') or {}
    if res.get('rows'):
        L += ['| figure | value | band | |', '|---|---|---|---|']
        L += ['| %s | %s | %s | %s |' % (r['figure'], '—' if r['value'] is None else r['value'], r['band'], 'ok' if r['ok'] else '**FLAG**') for r in res['rows']]
        L.append('')
    if res.get('notes'):
        L += ['## Notes', ''] + ['- ' + n for n in res['notes']] + ['']
    if res.get('measured'):
        L += ['## Measured', '', '```json', json.dumps(res['measured'], ensure_ascii=False, indent=1), '```']
    return '\n'.join(L)


def run_check(name, dry_run):
    gather, evaluate, title = CHECKS[name]
    os.makedirs(CHECKS_DIR, mode=0o750, exist_ok=True)
    sentinel = os.path.join(CHECKS_DIR, name + '.done')
    if os.path.exists(sentinel):
        os.remove(sentinel)
    doc = {'check': name, 'title': title, 'started': utc(time.time()), 'unit': 'insight-check-' + name, 'dry_run': dry_run,
           'verdict': None, 'result': None, 'error': None, 'telegram': None}
    try:
        if FAKE_INPUT:
            with open(FAKE_INPUT, encoding='utf-8') as f:
                raw = json.load(f)
        else:
            raw = gather()
        res = evaluate(raw)
        doc['result'] = res
        doc['verdict'] = ('FLAG:' + ','.join(res['flags'])) if res['flags'] else 'PASS'
    except CheckFailed as e:
        doc['error'] = str(e)
    except Exception as e:  # a bug in the check is a broken check: FAIL, and the owner hears
        doc['error'] = '%s: %s' % (type(e).__name__, e)
    if doc['error']:
        doc['verdict'] = 'FAIL:' + doc['error'][:120]
        doc['telegram'] = send_owner('Инсайт: плановая проверка %s сломалась: %s. Файл: %s/%s.md' % (
            name, doc['error'][:300], CHECKS_DIR, name), dry_run)
    doc['finished'] = utc(time.time())
    write_atomic(os.path.join(CHECKS_DIR, name + '.json'), json.dumps(doc, ensure_ascii=False, indent=1))
    write_atomic(os.path.join(CHECKS_DIR, name + '.md'), markdown(doc))
    write_atomic(sentinel, doc['verdict'])  # last: the waiter reads a verdict only once the files are whole
    say('%s → %s (%s/%s.json)' % (name, doc['verdict'], CHECKS_DIR, name))
    return 1 if doc['verdict'].startswith('FAIL') else 0


def schedule(name, on_calendar):
    """A one-shot timer that survives this SSM session; re-scheduling replaces the earlier timer."""
    unit = 'insight-check-' + name
    subprocess.run(['systemctl', 'stop', unit + '.timer'], capture_output=True)
    args = [os.environ.get('CHECKS_LAUNCHER', 'systemd-run'), '--unit', unit, '--on-calendar', on_calendar,
            '--timer-property=AccuracySec=1s', '--collect', '--quiet',
            '/usr/bin/python3', '-I', os.path.abspath(__file__), 'run', name]
    p = subprocess.run(args, capture_output=True, text=True)
    if p.returncode != 0:
        say('schedule %s failed: %s' % (name, p.stderr.strip()))
        return 2
    say('%s scheduled at %s (unit %s)' % (name, on_calendar, unit))
    return 0


def main(argv):
    if len(argv) >= 2 and argv[0] == 'run' and argv[1] in CHECKS:
        return run_check(argv[1], '--dry-run' in argv[2:])
    if len(argv) == 3 and argv[0] == 'schedule' and argv[1] in CHECKS:
        return schedule(argv[1], argv[2])
    if argv[:1] == ['list']:
        for k, v in CHECKS.items():
            print('%s\t%s' % (k, v[2]))
        return 0
    print('usage: checks.py run <%s> [--dry-run] | schedule <name> <OnCalendar> | list' % '|'.join(CHECKS), file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
