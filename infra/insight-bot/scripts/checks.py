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
    # IB-BUG-047: live random controls per (symbol, tf, UTC day of the bar) — the unit the hash picks 2 in
    raw['random_days'] = psql("select symbol, tf, to_char(bar_time, 'YYYY-MM-DD'), count(*) from oi_divergence_controls"
                              " where source = 'live' and kind = 'random' and %s group by 1,2,3 order by 1,2,3" % win('created_at'))
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
    # total (heap + indexes + toast) and heap only: V28's ≈ 150 B may have been heap only (TL review, IB-140 a)
    raw['sizes'] = psql("select c.relname, pg_total_relation_size(c.oid), (select count(*) from oi_divergence_paths), pg_relation_size(c.oid) from pg_class c"
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
    near = sum(int(r[3]) for r in live(raw['near']))
    rows.append(band(flags, 'pivot_controls', pivot, 50, 200))
    # IB-BUG-047: random picks are 2 per (coin, TF, UTC day of the bar), by a hash. This window is 24 h of
    # created_at from the live start: it straddles two UTC days, so its total is not 30 and has no honest band
    # (39 on 2026-11-05, all of them the hash's own picks). What it CAN test is the re-draw signature: no
    # (symbol, tf, day) above 2. Whether a day got all 30 is the recurring `random-controls-day` check.
    random_ = sum(int(r[3]) for r in raw['random_days'])
    over = [r for r in raw['random_days'] if int(r[3]) > RANDOM_PER_DAY]
    rows.append(band(flags, 'random_over_2_per_utc_day', len(over), 0, 0))
    for r in over:
        notes.append('random controls: %s %s on %s has %s (the hash picks %d a UTC day)' % (r[0], r[1], r[2], r[3], RANDOM_PER_DAY))
    notes.append('random controls in the window: %d. The window crosses UTC midnight, so this is not «30 a day»; '
                 'each UTC day is checked exactly by `random-controls-day`' % random_)
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
    notes.append('path weight band = [E/2, 2E], E = (1 100/8 subjects/day) × Σ_win weight × max(0, 1 − win/span) / 1440, '
                 'span = window end − first live row (%s); weights 4h 1, 24h 2, 72h 5. Today Σ = %.2f of 8 → E = %.3f/min '
                 '(steady state, Σ = 8: 0.4–1.6/min)' % (utc(live_since), share, expect))
    total = None if raw.get('weight_now') is None else round(raw['weight_now'] + weight, 2)
    rows.append(band(flags, 'binance_weight_per_min', total, 0, 4))
    sizes = {r[0]: int(r[1]) for r in raw['sizes']}
    n_paths = int(raw['sizes'][0][2]) if raw['sizes'] else 0
    per_row = round(sizes.get('oi_divergence_paths', 0) / n_paths) if n_paths else None
    heap = {r[0]: int(r[3]) for r in raw['sizes'] if len(r) > 3}
    heap_row = round(heap['oi_divergence_paths'] / n_paths) if n_paths and 'oi_divergence_paths' in heap else None
    # Architect (IB-140 a review): V28's ≈ 150 B/row is HEAP ONLY (band 75–300); all-in it implies ≈ 172 B/row
    # (band 86–345). Each figure against its own band, so a FLAG names the one that breaks.
    rows.append(band(flags, 'path_heap_bytes_per_row', heap_row, 75, 300, ' B (heap only)'))
    rows.append(band(flags, 'path_bytes_per_row', per_row, 86, 345, ' B (heap + indexes)'))
    if n_paths and n_paths < 50000:
        notes.append('bytes/row at %d rows still carry fixed page and index overhead; recheck at ≈ 50 k rows' % n_paths)
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
        'random_by_utc_day': [{'symbol': r[0], 'tf': r[1], 'day': r[2], 'n': int(r[3])} for r in raw['random_days']],
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


# --------------------------------------------------------------------------------------------- cap-24h
# IB-118 / IB-130: a day of market_cap_total. The recorder writes one row per 10-min tick (144/day); since
# migration 030 every row carries btc_pct / eth_pct. Bands: rows 72–288 (2× of 144); no gap > 30 min; no
# null btc_pct after the first row that has one. Size is a note: with a few hundred rows, page overhead
# dominates bytes/row (design: ≈ 4 MB/year with the shares).

CAP_ROWS_PER_DAY = 144
CAP_GAP_SEC = 30 * 60


def cap_gather():
    now = time.time()
    raw = {'now': utc(now), 'from': utc(now - 86400)}
    raw['rows'] = psql("select extract(epoch from ts), btc_pct is not null from market_cap_total where ts >= '%s' order by ts" % raw['from'])
    raw['size'] = psql("select pg_total_relation_size('market_cap_total'), count(*), extract(epoch from min(ts)), extract(epoch from max(ts)),"
                       " count(*) filter (where btc_pct is not null), extract(epoch from min(ts) filter (where btc_pct is not null)) from market_cap_total")
    return raw


def cap_evaluate(raw):
    flags, rows, notes = [], [], []
    ts = [float(r[0]) for r in raw['rows']]
    rows.append(band(flags, 'rows_24h', len(ts), CAP_ROWS_PER_DAY // 2, CAP_ROWS_PER_DAY * 2))
    edges = [epoch(raw['from'])] + ts + [epoch(raw['now'])]
    gaps = [(a, b) for a, b in zip(edges, edges[1:]) if b - a > CAP_GAP_SEC]
    rows.append(band(flags, 'gaps_over_30_min', len(gaps), 0, 0))
    for a, b in gaps:
        notes.append('gap %s → %s (%d min)' % (utc(a), utc(b), (b - a) // 60))
    size, total, t_min, t_max, with_btc, first_btc = raw['size'][0]
    first_btc = num(first_btc)
    nulls_after = sum(1 for r in raw['rows'] if first_btc is not None and float(r[0]) > first_btc and r[1] != 't')
    rows.append(band(flags, 'btc_pct_null_after_030', nulls_after, 0, 0))
    total = int(total)
    notes.append('table: %s B, %d rows (%s → %s), %s with btc_pct; %s B/row now (page overhead dominates at this size)' % (
        size, total, utc(float(t_min)) if t_min else '—', utc(float(t_max)) if t_max else '—', with_btc,
        round(int(size) / total) if total else '—'))
    return {'flags': flags, 'rows': rows, 'notes': notes,
            'measured': {'from': raw['from'], 'to': raw['now'], 'rows_24h': len(ts), 'gaps': [[utc(a), utc(b)] for a, b in gaps],
                         'size_bytes': int(size), 'rows_total': total, 'with_btc_pct': int(with_btc),
                         'first_btc_pct_row': utc(first_btc) if first_btc else None}}


# ------------------------------------------------------------------------------------- first-live-alert
# The first OI alert with source='live' and fired_at set: its facts go to a file (recipients, the delay, the
# link the members got, and whether that link answers 200 through Caddy). Until then the run is PENDING: a
# file without a sentinel. Once found, the timer removes itself. The owner is NOT told — he got the alert.

def first_alert_gather():
    raw = {'now': utc(time.time())}
    raw['alert'] = psql("select id, symbol, tf, direction, extract(epoch from b_time), extract(epoch from confirmed_at), extract(epoch from fired_at),"
                        " recipients, late, build from oi_divergence_alerts where source = 'live' and fired_at is not null order by fired_at, id limit 1")
    raw['eligible'] = psql("select count(*) from users where oi_alerts and not disabled and chat_id is not null")
    raw['link_code'] = None
    if raw['alert']:
        a = raw['alert'][0]
        base = env_value(os.path.join(DEPLOY_DIR, '.env'), 'WEB_BASE_URL') or ''
        raw['link'] = '%s/instrument/%s?at=%d&tf=%s' % (base.rstrip('/'), a[1], int(float(a[4])), a[2]) if base else None
        if raw['link']:
            out = subprocess.run(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '15', raw['link']],
                                 capture_output=True, text=True, timeout=30).stdout.strip()
            raw['link_code'] = int(out) if out.isdigit() else None
    return raw


def env_value(path, key):
    spec = importlib.util.spec_from_file_location('deploy_watch', os.path.join(HERE, 'deploy-watch.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.env_value(path, key)


def first_alert_evaluate(raw):
    if not raw['alert']:
        return {'pending': True, 'flags': [], 'rows': [], 'notes': ['no live alert fired yet at %s' % raw['now']], 'measured': None}
    a = raw['alert'][0]
    b_time, confirmed, fired = float(a[4]), float(a[5]), float(a[6])
    flags, rows = [], []
    rows.append(band(flags, 'recipients_le_eligible', int(a[7]), 0, int(raw['eligible'][0][0])))
    rows.append(band(flags, 'link_http', raw.get('link_code'), 200, 200))
    m = {'id': int(a[0]), 'symbol': a[1], 'tf': a[2], 'direction': a[3], 'b_time': utc(b_time), 'confirmed_at': utc(confirmed),
         'fired_at': utc(fired), 'fire_after_confirm_s': round(fired - confirmed), 'fire_after_b_open_s': round(fired - b_time),
         'recipients': int(a[7]), 'eligible_now': int(raw['eligible'][0][0]), 'late': a[8] == 't', 'build': a[9],
         'link': raw.get('link'), 'link_http': raw.get('link_code')}
    return {'flags': flags, 'rows': rows, 'notes': ['the owner was not told: he received the alert itself'], 'measured': m, 'done': True}


# ---------------------------------------------------------------------------------------- backfill-rerun
# IB-116's rerun after 2026-11-07 22:00 UTC: /root/box-backfill.sh --write measures the windows that were
# open at the first run (314) and writes no new subject (the once-keys hold). The script carries its own
# 1 s sampler and kills the CLI below 100 MB MemAvailable. Bands: 0 new rows; measured 157–628 (2× of 314);
# 0 failed; 0 left open; weight 400–1 600 (≈ 800). A killed or failed run is FAIL.

BACKFILL_SCRIPT = os.environ.get('CHECKS_BACKFILL_SCRIPT', '/root/box-backfill.sh')
BACKFILL_OPEN = 314
BACKFILL_COUNTS = ("select 'alerts', count(*) from oi_divergence_alerts where source = 'backfill' union all"
                   " select 'controls', count(*) from oi_divergence_controls where source = 'backfill' union all"
                   " select 'near_misses', count(*) from oi_divergence_near_misses where source = 'backfill' union all"
                   " select 'paths', count(*) from oi_divergence_paths p left join oi_divergence_alerts a on a.id = p.alert_id"
                   " left join oi_divergence_controls c on c.id = p.control_id left join oi_divergence_near_misses n on n.id = p.near_miss_id"
                   " where coalesce(a.source, c.source, n.source) = 'backfill' union all"
                   " select 'paths_open', count(*) from oi_divergence_paths p left join oi_divergence_alerts a on a.id = p.alert_id"
                   " left join oi_divergence_controls c on c.id = p.control_id left join oi_divergence_near_misses n on n.id = p.near_miss_id"
                   " where coalesce(a.source, c.source, n.source) = 'backfill' and p.measured_at is null")


def backfill_gather():
    if not os.path.exists(BACKFILL_SCRIPT):
        raise CheckFailed('%s is missing' % BACKFILL_SCRIPT)
    raw = {'started': utc(time.time()), 'before': psql(BACKFILL_COUNTS)}
    try:
        p = subprocess.run(['bash', BACKFILL_SCRIPT, '--write'], capture_output=True, text=True, timeout=4 * 3600)
    except subprocess.TimeoutExpired:
        raise CheckFailed('%s --write ran over 4 h' % BACKFILL_SCRIPT)
    raw['rc'], raw['output'] = p.returncode, (p.stdout + p.stderr)[-6000:]
    raw['after'] = psql(BACKFILL_COUNTS)
    return raw


def backfill_evaluate(raw):
    import re
    out = raw['output']
    if 'KILLED for memory' in out:
        raise CheckFailed('the CLI was killed: MemAvailable < 100 MB (box-backfill.sh sampler)')
    cli = re.search(r'== CLI output \(exit (\d+)\)', out)
    if raw['rc'] != 0 or not cli or cli.group(1) != '0':
        raise CheckFailed('box-backfill.sh exit %s, CLI exit %s' % (raw['rc'], cli.group(1) if cli else '?'))
    paths = re.search(r'paths: measured (\d+), failed (\d+), weight (\d+)', out)
    left = re.search(r'left (\d+)', out)
    mem = re.search(r'min MemAvailable (\d+) MB', out)
    if not paths or not mem:
        raise CheckFailed('box-backfill.sh output has no «paths: measured …» or «min MemAvailable» line')
    before, after = dict((r[0], int(r[1])) for r in raw['before']), dict((r[0], int(r[1])) for r in raw['after'])
    flags, rows = [], []
    new_rows = sum(after[k] - before[k] for k in ('alerts', 'controls', 'near_misses', 'paths'))
    rows.append(band(flags, 'new_rows', new_rows, 0, 0))
    rows.append(band(flags, 'paths_measured', int(paths.group(1)), BACKFILL_OPEN // 2, BACKFILL_OPEN * 2))
    rows.append(band(flags, 'paths_failed', int(paths.group(2)), 0, 0))
    rows.append(band(flags, 'paths_left_open', after['paths_open'], 0, 0))
    rows.append(band(flags, 'path_weight', int(paths.group(3)), 400, 1600))
    rows.append(band(flags, 'min_mem_available_mb', int(mem.group(1)), 100, 10 ** 6))
    return {'flags': flags, 'rows': rows, 'notes': ['CLI «left» line: %s' % (left.group(1) if left else '—')],
            'measured': {'before': before, 'after': after, 'tail': out[-1500:]}}


# ------------------------------------------------------------------------------------------ liq-weekly
# IB-123: a week of liquidation tape. /opt/insight-bot/liq-backfill.sh --write reruns the history CLI: it writes 0
# new rows (the write range ends at the live loop's first evaluated moment, LIQ_UNTIL, and its once-keys hold),
# measures the backfill path windows that have closed since, and counts alerts per coin at ×½, ×1, ×2 over
# [first full day, today 00:00 UTC) — a whole week on 2026-11-11 — with the live loop's code, into memory.
# The table goes to the .md. Bands: 0 new rows; ≥ 6.9 days counted; 0 failed and 0 open path windows; memory
# ≥ 100 MB. A killed run, a CLI exit ≠ 0 or no summary line is FAIL (the owner hears); PASS and FLAG are silent.

LIQ_SCRIPT = os.environ.get('CHECKS_LIQ_SCRIPT', os.path.join(DEPLOY_DIR, 'liq-backfill.sh'))
LIQ_UNTIL = '2026-11-05T16:59:34.379Z'  # the live liq loop's boot tick `from` (bot log, 1861c048ab60)


def liq_gather():
    if not os.path.exists(LIQ_SCRIPT):
        raise CheckFailed('%s is missing' % LIQ_SCRIPT)
    now = time.time()
    raw = {'started': utc(now), 'counts_to': utc(now // 86400 * 86400)}
    try:
        p = subprocess.run(['bash', LIQ_SCRIPT, '--write', '--until', LIQ_UNTIL, '--counts-to', raw['counts_to']],
                           capture_output=True, text=True, timeout=4 * 3600)
    except subprocess.TimeoutExpired:
        raise CheckFailed('%s --write ran over 4 h' % LIQ_SCRIPT)
    raw['rc'], raw['output'] = p.returncode, (p.stdout + p.stderr)[-20000:]
    return raw


def liq_md_table(table, days):
    by = {}
    for r in table:
        by.setdefault(r['symbol'], {})[r['multiplier']] = r
    L = ['## Alerts per week, per coin (%.2f days of tape; ×1 = L4 defaults)' % days, '',
         '| coin | ×½ threshold | ×½ /week | ×1 threshold | ×1 /week (long/short) | ×1 event closes /week | ×2 threshold | ×2 /week | ×1 with a gap | ×1 venue not collected |',
         '|---|---|---|---|---|---|---|---|---|---|']
    for sym, m in by.items():
        h, one, two = m.get(0.5, {}), m.get(1, {}), m.get(2, {})
        L.append('| %s | $%s | %s | $%s | %s (%s/%s) | %s | $%s | %s | %s | %s |' % (
            sym, '{:,}'.format(int(h.get('thresholdUsd', 0))), h.get('perWeek'), '{:,}'.format(int(one.get('thresholdUsd', 0))),
            one.get('perWeek'), one.get('longs'), one.get('shorts'), one.get('continuationsPerWeek'),
            '{:,}'.format(int(two.get('thresholdUsd', 0))), two.get('perWeek'), one.get('withGap'), one.get('notCollected')))
    return '\n'.join(L)


def liq_evaluate(raw):
    import re
    out = raw['output']
    if 'KILLED for memory' in out:
        raise CheckFailed('the CLI was killed: MemAvailable < 100 MB (liq-backfill.sh sampler)')
    cli = re.search(r'== CLI output \(exit (\d+)\)', out)
    if raw['rc'] != 0 or not cli or cli.group(1) != '0':
        raise CheckFailed('liq-backfill.sh exit %s, CLI exit %s' % (raw['rc'], cli.group(1) if cli else '?'))
    js = re.search(r'^LIQ_HISTORY_JSON (\{.*\})$', out, re.M)
    # IB-143 appends «, events N» (first messages); a CLI from before it has none
    new = re.search(r'write ×1: .*new rows: alerts (\d+), continuations (\d+), controls (\d+)(?:, events (\d+))?', out)
    paths = re.search(r'paths: measured (\d+), failed (\d+), weight (\d+), \d+ s; left (\d+)', out)
    mem = re.search(r'min MemAvailable (\d+) MB', out)
    if not js or not new or not paths or not mem:
        raise CheckFailed('liq-backfill.sh output lacks a LIQ_HISTORY_JSON, «write ×1», «paths:» or «min MemAvailable» line')
    summary = json.loads(js.group(1))
    flags, rows = [], []
    rows.append(band(flags, 'new_rows', sum(int(x) for x in new.groups() if x is not None), 0, 0))
    rows.append(band(flags, 'days_counted', summary['days'], 6.9, 10 ** 6))
    rows.append(band(flags, 'paths_failed', int(paths.group(2)), 0, 0))
    rows.append(band(flags, 'paths_left_open', int(paths.group(4)), 0, 0))
    rows.append(band(flags, 'min_mem_available_mb', int(mem.group(1)), 100, 10 ** 6))
    notes = ['counts over (%s, %s]: the live loop\'s code at its live cadence (10 s since IB-143), into memory; nothing from it is written' % (summary['from'], summary['countsTo']),
             'written rows (source = backfill) stop at %s, where the live journal starts; live and backfill are never pooled (V32)' % summary['until'],
             'TRX: Binance only until 2026-11-05 17:34 UTC (L5); Bybit and OKX after',
             'path weight this run: %s (measured %s windows)' % (paths.group(3), paths.group(1)),
             'no hit rate: «worked» and the baseline are not defined yet (design §1 C5)']
    return {'flags': flags, 'rows': rows, 'notes': notes, 'md': liq_md_table(summary['table'], summary['days']),
            'measured': {'summary': summary, 'paths': {'measured': int(paths.group(1)), 'failed': int(paths.group(2)), 'weight': int(paths.group(3)), 'left': int(paths.group(4))},
                         'min_mem_available_mb': int(mem.group(1)), 'tail': out[-1500:]}}


# --------------------------------------------------------------------------------- random-controls-day
# IB-BUG-047: one UTC day of live random controls, exact. The loop picks 2 bar closes per (coin, TF, UTC day of
# the bar) by a hash of (symbol, tf, day) (apps/insight-bot/src/alerts/oi-divergence/research/controls.ts, design
# V25), so a whole day holds exactly enabled coins × 3 × 2 — a count, not a band. What breaks it:
#   fewer — a pick lost for good: each tick evaluates only the LATEST due close, so a bot down for the whole of
#           [the pick's close + 6 min, the next close + 6 min) never records it (15 min on 15m, 1 h on 1h, 4 h on
#           4h); also a venue error on that coin's evaluation, or a coin added during the day;
#   more  — a re-draw or a duplicate (the once-key should make it impossible).
# Daily timer at 00:30 UTC for the previous day: its last bar (4h 20:00) closes 00:00 and is recorded ≈ 00:06.
# CHECKS_DAY=YYYY-MM-DD checks another day by hand.

RANDOM_PER_DAY = 2                      # OI_RANDOM_CONTROLS_PER_DAY (libs/contracts/src/insight/oi-divergence-research.ts)
OI_TFS = ('15m', '1h', '4h')            # OI_DIVERGENCE_TFS
RCD_SETTLE_SEC = 7 * 60                 # the day's last close (00:00) + the loop's 6 min + 1


def rcd_day(now):
    """The UTC day before the one `now` falls in, YYYY-MM-DD."""
    return utc((now // 86400 - 1) * 86400)[:10]


def rcd_gather():
    import re
    now = time.time()
    day = os.environ.get('CHECKS_DAY') or rcd_day(now)
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', day):
        raise CheckFailed('CHECKS_DAY %r is not YYYY-MM-DD' % day)
    raw = {'now': utc(now), 'day': day}
    raw['coins'] = psql("select symbol, extract(epoch from added_at) from alert_symbols where enabled order by symbol")
    raw['counts'] = psql("select symbol, tf, count(*), string_agg(to_char(bar_time, 'HH24:MI'), ' ' order by bar_time)"
                         " from oi_divergence_controls where source = 'live' and kind = 'random'"
                         " and bar_time >= '%s'::timestamptz and bar_time < '%s'::timestamptz + interval '1 day'"
                         " group by 1, 2 order by 1, 2" % (day + 'T00:00:00Z', day + 'T00:00:00Z'))
    return raw


def rcd_evaluate(raw):
    start = epoch(raw['day'] + 'T00:00:00Z')
    end = start + 86400
    if epoch(raw['now']) < end + RCD_SETTLE_SEC:
        raise CheckFailed('ran at %s, before %s\'s last pick could be recorded (%s)' % (raw['now'], raw['day'], utc(end + RCD_SETTLE_SEC)))
    enabled = {r[0]: float(r[1]) for r in raw['coins']}
    got = {(r[0], r[1]): (int(r[2]), r[3]) for r in raw['counts']}
    coins = sorted(set(enabled) | {k[0] for k in got})
    flags, rows, notes = [], [], []
    expect = len(enabled) * len(OI_TFS) * RANDOM_PER_DAY
    total = sum(n for n, _ in got.values())
    rows.append(band(flags, 'random_controls', total, expect, expect))
    for sym in coins:
        for tf in OI_TFS:
            n, bars = got.get((sym, tf), (0, ''))
            rows.append(band(flags, '%s/%s' % (sym, tf), n, RANDOM_PER_DAY, RANDOM_PER_DAY))
    for sym in coins:
        if sym not in enabled:
            notes.append('%s is not enabled now but has random controls that day (disabled since?)' % sym)
        elif enabled[sym] > start:
            notes.append('%s was added to alert_symbols at %s: fewer than %d on that day is expected' % (sym, utc(enabled[sym]), RANDOM_PER_DAY))
    if flags:
        notes.append('fewer than 2: a pick lost for good (the bot down from its close + 6 min to the next close + 6 min, or a venue error '
                     'on that evaluation) — see the bot log and deploy times; more than 2: a re-draw or duplicate, a defect')
    notes.append('expected = %d enabled coins × %d TFs × %d' % (len(enabled), len(OI_TFS), RANDOM_PER_DAY))
    return {'flags': flags, 'rows': rows, 'notes': notes,
            'measured': {'day': raw['day'], 'enabled': sorted(enabled), 'total': total, 'expected': expect,
                         'pairs': [{'symbol': k[0], 'tf': k[1], 'n': v[0], 'bars_utc': v[1]} for k, v in sorted(got.items())]}}


# --------------------------------------------------------------------------------------------- runner

# ----------------------------------------------------------------------------------------- oi-4h-first-eval
# IB-141's deploy (batch 3): the 4h OI-divergence evaluations since the bot started run on the new pivot sides
# (4h 6 left / 2 right, migration 032). Verified from the bot's own evaluation lines and the journal, not by hand.
# One-shot, scheduled after the first 4h close the new process evaluates on schedule (close + 6 min + margin);
# the boot evaluation counts too. Figures: alert_settings 4h is 6/2; ≥ 1 «oi alerts 4h @…» line since boot, none
# with `failed`; 0 per-coin «oi alerts <SYM> 4h: …» warnings (an error, or «not evaluated»); every 4h row journalled
# since boot (alerts, controls, near-misses) carries 6/2 in its params. No 4h row at all is a note, not a flag:
# an evaluation that finds nothing writes nothing.

OI_4H_LINE = r'oi alerts 4h @(\S+?Z): (\d+) coins, (\d+) found \(late (\d+)\), sent (\d+)(?:, skipped \d+, controls (\d+), near-misses (\d+))?(?:, failed (\S+))?'
OI_4H_WARN = r'^oi alerts [A-Z0-9]+ 4h: '


def oi4h_gather():
    import re
    bot = sh(['docker', 'compose', 'ps', '-q', 'insight-bot'], cwd=DEPLOY_DIR).strip()
    if not bot:
        raise CheckFailed('the bot container is not running')
    started = sh(['docker', 'inspect', '--format', '{{.State.StartedAt}}', bot]).strip()
    boot = epoch(started[:19] + 'Z')
    raw = {'now': utc(time.time()), 'boot': utc(boot), 'lines': [], 'warns': []}
    for line in sh(['docker', 'logs', '--since', str(int(boot)), bot], timeout=120).splitlines():
        try:
            msg = str(json.loads(line).get('msg', ''))
        except (ValueError, AttributeError):
            msg = line
        if re.search(OI_4H_LINE, msg):
            raw['lines'].append(msg)
        elif re.search(OI_4H_WARN, msg):
            raw['warns'].append(msg[:200])
    since = int(boot)
    raw['settings'] = psql("select params #>> '{perTf,4h,nLeft}', params #>> '{perTf,4h,nRight}', params #>> '{perTf,4h,n}' from alert_settings where id = 1")
    raw['rows'] = psql(
        "select 'alert', id, params #>> '{perTf,4h,nLeft}', params #>> '{perTf,4h,nRight}', params #>> '{perTf,4h,n}' from oi_divergence_alerts"
        " where tf = '4h' and source = 'live' and confirmed_at >= to_timestamp(%d) union all"
        " select 'control', id, params #>> '{perTf,4h,nLeft}', params #>> '{perTf,4h,nRight}', params #>> '{perTf,4h,n}' from oi_divergence_controls"
        " where tf = '4h' and source = 'live' and created_at >= to_timestamp(%d) union all"
        " select 'near_miss', id, params #>> '{perTf,4h,nLeft}', params #>> '{perTf,4h,nRight}', params #>> '{perTf,4h,n}' from oi_divergence_near_misses"
        " where tf = '4h' and source = 'live' and created_at >= to_timestamp(%d) order by 1, 2" % (since, since, since))
    return raw


def oi4h_evaluate(raw):
    import re
    flags, rows, notes = [], [], []
    st = raw['settings'][0] if raw['settings'] else [None, None, None]
    rows.append(band(flags, 'settings_4h_6_2', 1 if (st[0], st[1]) == ('6', '2') else 0, 1, 1))
    evals = []
    for msg in raw['lines']:
        m = re.search(OI_4H_LINE, msg)
        evals.append({'close': m.group(1), 'coins': int(m.group(2)), 'found': int(m.group(3)), 'late': int(m.group(4)), 'sent': int(m.group(5)),
                      'controls': None if m.group(6) is None else int(m.group(6)), 'near_misses': None if m.group(7) is None else int(m.group(7)),
                      'failed': m.group(8)})
    rows.append(band(flags, 'eval_lines_4h', len(evals), 1, 1000))
    rows.append(band(flags, 'evals_with_failed_coins', sum(1 for e in evals if e['failed']), 0, 0))
    rows.append(band(flags, 'coin_warnings_4h', len(raw['warns']), 0, 0))
    bad = [r for r in raw['rows'] if (r[2], r[3]) != ('6', '2')]
    rows.append(band(flags, 'rows_4h_not_6_2', len(bad), 0, 0))
    if not raw['rows']:
        notes.append('no 4h row journalled since boot (%s): the evaluations found no alert, control or near-miss — params read from alert_settings only' % raw['boot'])
    notes += ['warning: ' + w for w in raw['warns'][:5]]
    notes += ['row not 6/2: %s #%s nLeft=%s nRight=%s n=%s' % tuple(r) for r in bad[:5]]
    m = {'boot': raw['boot'], 'now': raw['now'], 'settings_4h': {'nLeft': st[0], 'nRight': st[1], 'n': st[2]}, 'evaluations': evals,
         'rows_4h': [{'kind': r[0], 'id': int(r[1]), 'nLeft': r[2], 'nRight': r[3]} for r in raw['rows']]}
    return {'flags': flags, 'rows': rows, 'notes': notes, 'measured': m}


CHECKS = {
    'v28': (v28_gather, v28_evaluate, 'IB-115 V28 live day [%s, %s)' % (V28_FROM, V28_TO)),
    'cap-24h': (cap_gather, cap_evaluate, 'IB-118 / IB-130: a day of market_cap_total'),
    'first-live-alert': (first_alert_gather, first_alert_evaluate, 'The first live OI alert: facts to a file, then the timer stops'),
    'backfill-rerun': (backfill_gather, backfill_evaluate, 'IB-116 rerun: /root/box-backfill.sh --write for the open windows'),
    'oi-4h-first-eval': (oi4h_gather, oi4h_evaluate, 'IB-141: the 4h OI evaluations since boot run on 6 left / 2 right (migration 032)'),
    'liq-weekly': (liq_gather, liq_evaluate, 'IB-123: a week of liquidation tape — alerts per coin per week at ×½, ×1, ×2; the open path windows'),
    'random-controls-day': (rcd_gather, rcd_evaluate, 'IB-BUG-047: the previous UTC day of live OI random controls — exactly enabled coins × 3 TFs × 2'),
}


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
    if res.get('md'):
        L += [res['md'], '']
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
        doc['verdict'] = 'PENDING' if res.get('pending') else ('FLAG:' + ','.join(res['flags'])) if res['flags'] else 'PASS'
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
    if doc['verdict'] != 'PENDING':  # PENDING: a recurring check that has nothing yet — files, no sentinel
        write_atomic(sentinel, doc['verdict'])  # last: the waiter reads a verdict only once the files are whole
        if (doc['result'] or {}).get('done') and not FAKE_INPUT:
            subprocess.run(['systemctl', 'stop', 'insight-check-%s.timer' % name], capture_output=True)  # found: stop recurring
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
