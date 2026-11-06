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
# Verdict: PASS | FLAG:<reason>[,<reason>…] | DEFERRED:<why> | FAIL:<why>
#   PASS / FLAG — the check ran; FLAG names figures outside their band (a finding, for the TL to read).
#   DEFERRED    — a history run did not START: the CLI's memory start gate refused on every try (IB-145). Nothing
#                 is broken and nothing was written; no Telegram. Reschedule it at a quieter hour.
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


class CheckDeferred(Exception):
    """A history run did not start (its memory start gate refused): DEFERRED, no Telegram — nothing is broken."""


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


# -------------------------------------------------------------------------------------- first-live-liq
# IB-143: the first live LIQUIDATION message (an `event`, or a continuation that was news) with fired_at set: its
# facts go to a file. Bands for the owner-only go-live: recipients exactly 1, exactly one user with liq_alerts,
# not late, sent within 60 s of its moment (S or the close; the loop ticks every 10 s), and the link (the largest
# coin at its crossing, tf 5m) answers 200 through Caddy. PENDING until one exists; then the timer removes itself.
# The owner is NOT told — he got the message.
# IB-148 (L18): a small event held back after S is due at details.heldUntil (S + 120 s, or the S of the event that
# opened during its hold), so its 60 s are counted from there; `held_s` says how long it was held.

def first_liq_gather():
    raw = {'now': utc(time.time())}
    raw['msg'] = psql("select id, event, symbol, extract(epoch from at), extract(epoch from fired_at), recipients, late, build,"
                      " details->'coins'->0->>'symbol', details->'coins'->0->>'crossedAt', jsonb_array_length(details->'coins'), details->>'totalUsd',"
                      " details->>'heldUntil'"
                      " from market_alerts where type = 'liq' and source = 'live' and event in ('event', 'event_continuing')"
                      " and fired_at is not null order by fired_at, id limit 1")
    raw['eligible'] = psql("select count(*) from users where liq_alerts and not disabled and chat_id is not null")
    raw['link_code'] = None
    if raw['msg']:
        m = raw['msg'][0]
        base = env_value(os.path.join(DEPLOY_DIR, '.env'), 'WEB_BASE_URL') or ''
        raw['link'] = '%s/instrument/%s?at=%d&tf=5m' % (base.rstrip('/'), m[8], int(float(m[9]) // 1000)) if base and m[8] and m[9] else None
        if raw['link']:
            out = subprocess.run(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '15', raw['link']],
                                 capture_output=True, text=True, timeout=30).stdout.strip()
            raw['link_code'] = int(out) if out.isdigit() else None
    return raw


def first_liq_evaluate(raw):
    if not raw['msg']:
        return {'pending': True, 'flags': [], 'rows': [], 'notes': ['no live liquidation message sent yet at %s' % raw['now']], 'measured': None}
    m = raw['msg'][0]
    at, fired = float(m[3]), float(m[4])
    held_until = float(m[12]) / 1000 if len(m) > 12 and m[12] else None
    due = held_until if held_until is not None else at
    flags, rows = [], []
    rows.append(band(flags, 'recipients', int(m[5]), 1, 1))
    rows.append(band(flags, 'liq_alerts_users', int(raw['eligible'][0][0]), 1, 1))
    rows.append(band(flags, 'late', 1 if m[6] == 't' else 0, 0, 0))
    rows.append(band(flags, 'fired_after_moment_s', round(fired - due), 0, 60, ' s'))
    rows.append(band(flags, 'link_http', raw.get('link_code'), 200, 200))
    measured = {'id': int(m[0]), 'event': m[1], 'symbol': m[2], 'at': utc(at), 'fired_at': utc(fired), 'fired_after_moment_s': round(fired - due),
                'held_s': round(due - at),
                'recipients': int(m[5]), 'liq_alerts_users': int(raw['eligible'][0][0]), 'late': m[6] == 't', 'build': m[7],
                'coins': int(m[10]), 'total_usd': float(m[11]) if m[11] else None, 'link': raw.get('link'), 'link_http': raw.get('link_code')}
    return {'flags': flags, 'rows': rows, 'notes': ['the owner was not told: he received the message itself'], 'measured': measured, 'done': True}


def first_fired_since(rows, fired_col, since_iso):
    """The rows (ordered by fired_at) from the first one fired at or after `since_iso` — [] when none."""
    since = datetime.strptime(since_iso, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp()
    kept = [r for r in rows if r[fired_col] is not None and float(r[fired_col]) >= since]
    return kept[:1]


# ------------------------------------------------------------------------------------- first-live-level
# Owner ruling 2026-11-06 (levels ON, owner only, weekly open OFF): the first live LEVEL alert that was SENT (one of the
# six events, fired_at set): its facts go to a file. Bands, all read from the box, none a measured number: recipients
# exactly 1 and exactly one user with level_alerts (owner only); not late; the level type switched on; its kind and
# event allowed by the settings NOW (the event switch not false — WO's are — and PDH/PDL only on a coin with `daily`;
# a custom level has its own switches and passes this row); the link (the bar's open, tf 15m, as
# levelAlertLink builds it) answers 200 through Caddy. How long after the bar's close it fired is measured, not
# banded. The message text is not stored: the dev-side waiter renders it with the shipped levelAlert over this row.
# PENDING until one exists; then the timer removes itself. The owner is NOT told — he got the alert.

# The enable statement's own time (dev-1, 2026-11-06, `UPDATE 1` at 13:06:05Z). A row fired before it is not «the first
# live level alert»: it would FLAG recipients / type_enabled on a row that predates the switch. Not a recipients > 0
# filter — that would hide the very fault the band is there to catch. Bounds the query AND the evaluation (the test seam
# skips the query, so the evaluation's bound is the one checks.test.sh proves).
LEVEL_ENABLED_AT = '2026-11-06T13:06:05Z'
LEVEL_EVENTS = ('breakout_up', 'breakout_down', 'sweep_above', 'sweep_below', 'crossunder', 'crossover')


def first_level_gather():
    raw = {'now': utc(time.time())}
    raw['alert'] = psql("select a.id, a.event, a.symbol, extract(epoch from a.at), extract(epoch from a.confirmed_at),"
                        " extract(epoch from a.fired_at), a.recipients, a.late, a.build, a.details->>'kind', a.details->>'price',"
                        " s.params->'events'->(a.details->>'kind')->>a.event, coalesce(s.params->'perCoin'->a.symbol->>'daily', 'false'),"
                        " s.enabled"
                        " from market_alerts a cross join alert_type_settings s"
                        " where s.type = 'level' and a.type = 'level' and a.source = 'live' and a.fired_at is not null"
                        " and a.fired_at >= '%s' and a.event in (%s) order by a.fired_at, a.id limit 5"
                        % (LEVEL_ENABLED_AT, ', '.join("'%s'" % e for e in LEVEL_EVENTS)))
    raw['eligible'] = psql("select count(*) from users where level_alerts and not disabled and chat_id is not null")
    raw['link_code'] = None
    raw['alert'] = first_fired_since(raw['alert'], 5, LEVEL_ENABLED_AT)
    if raw['alert']:
        a = raw['alert'][0]
        base = env_value(os.path.join(DEPLOY_DIR, '.env'), 'WEB_BASE_URL') or ''
        raw['link'] = '%s/instrument/%s?at=%d&tf=15m' % (base.rstrip('/'), a[2], int(float(a[3]))) if base else None
        if raw['link']:
            out = subprocess.run(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '15', raw['link']],
                                 capture_output=True, text=True, timeout=30).stdout.strip()
            raw['link_code'] = int(out) if out.isdigit() else None
    return raw


def first_level_evaluate(raw):
    raw = dict(raw, alert=first_fired_since(raw['alert'], 5, LEVEL_ENABLED_AT))
    if not raw['alert']:
        return {'pending': True, 'flags': [], 'rows': [], 'notes': ['no live level alert sent yet at %s' % raw['now']], 'measured': None}
    a = raw['alert'][0]
    at, confirmed, fired = float(a[3]), float(a[4]), float(a[5])
    kind, switch, daily = a[9], a[11], a[12] == 'true'
    allowed = kind == 'custom' or (switch != 'false' and (kind not in ('PDH', 'PDL') or daily))
    flags, rows = [], []
    rows.append(band(flags, 'recipients', int(a[6]), 1, 1))
    rows.append(band(flags, 'level_alerts_users', int(raw['eligible'][0][0]), 1, 1))
    rows.append(band(flags, 'late', 1 if a[7] == 't' else 0, 0, 0))
    rows.append(band(flags, 'type_enabled', 1 if a[13] == 't' else 0, 1, 1))
    rows.append(band(flags, 'kind_event_allowed', 1 if allowed else 0, 1, 1))
    rows.append(band(flags, 'link_http', raw.get('link_code'), 200, 200))
    close = at + 900
    m = {'id': int(a[0]), 'event': a[1], 'symbol': a[2], 'kind': kind, 'price': float(a[10]) if a[10] else None,
         'bar_open': utc(at), 'confirmed_at': utc(confirmed), 'fired_at': utc(fired), 'fired_after_close_s': round(fired - close),
         'recipients': int(a[6]), 'level_alerts_users': int(raw['eligible'][0][0]), 'late': a[7] == 't', 'build': a[8],
         'event_switch': switch, 'coin_daily': daily, 'link': raw.get('link'), 'link_http': raw.get('link_code')}
    return {'flags': flags, 'rows': rows, 'notes': ['the owner was not told: he received the alert itself',
                                                    'the message text is checked dev-side with the shipped levelAlert over this row'],
            'measured': m, 'done': True}


# -------------------------------------------------------------------------------- first-live-liq-held
# IB-148 (§2b, L17–L19): the first live liquidation `event` row that was HELD (details.heldUntil: a small event sent
# after its hold) or MERGED (details.mergedInto: a small event taken in by a larger same-side one, never sent).
# PENDING until one exists; then the timer removes itself. The owner is NOT told.
# Bands:
# - held: sent at heldUntil ± one tick (10 s; fired_at is the tick that sent it), recipients exactly 1, not late;
# - merged: the row itself not sent (fired_at null, recipients 0), and the large event it names exists and was sent
#   to exactly 1 (its first message, or a continuation that was news). For how = 'before' the large first message's
#   details.merged must hold this row's T0 (its «Перед этим» line). For how = 'after' there is no such entry by
#   design: the large message went out before the small one existed, and L17 forbids an edit.

LIQ_HELD_TICK_S = 10


def first_held_gather():
    raw = {'now': utc(time.time())}
    raw['row'] = psql("select id, symbol, extract(epoch from at), extract(epoch from fired_at), recipients, late, build,"
                      " details->>'side', details->>'eventAt', details->>'heldUntil',"
                      " details#>>'{mergedInto,eventAt}', details#>>'{mergedInto,how}', details->>'totalUsd'"
                      " from market_alerts where type = 'liq' and source = 'live' and event = 'event'"
                      " and (details ? 'heldUntil' or details ? 'mergedInto') order by id limit 1")
    raw['large'] = []
    if raw['row'] and raw['row'][0][10]:
        r = raw['row'][0]
        raw['large'] = psql("select id, event, extract(epoch from fired_at), recipients, coalesce(details->>'news', 'true'),"
                            " coalesce((select string_agg(m->>'eventAt', ',') from jsonb_array_elements(details->'merged') m), '')"
                            " from market_alerts where type = 'liq' and source = 'live' and event in ('event', 'event_continuing')"
                            " and details->>'side' = '%s' and details->>'eventAt' = '%s' order by id" % (r[7], r[10]))
    return raw


def first_held_evaluate(raw):
    if not raw['row']:
        return {'pending': True, 'flags': [], 'rows': [], 'notes': ['no live held or merged liquidation event yet at %s' % raw['now']], 'measured': None}
    r = raw['row'][0]
    flags, rows, notes = [], [], []
    at = float(r[2])
    fired = float(r[3]) if r[3] else None
    m = {'id': int(r[0]), 'symbol': r[1], 'side': r[7], 'at': utc(at), 'fired_at': utc(fired) if fired is not None else None,
         'recipients': int(r[4]), 'late': r[5] == 't', 'build': r[6], 'total_usd': float(r[12]) if r[12] else None}
    if r[9]:
        due = float(r[9]) / 1000
        m.update({'kind': 'held', 'held_until': utc(due), 'held_s': round(due - at)})
        rows.append(band(flags, 'recipients', int(r[4]), 1, 1))
        rows.append(band(flags, 'late', 1 if r[5] == 't' else 0, 0, 0))
        rows.append(band(flags, 'fired_minus_held_until_s', None if fired is None else round(fired - due), -LIQ_HELD_TICK_S, LIQ_HELD_TICK_S, ' s'))
        m['fired_minus_held_until_s'] = None if fired is None else round(fired - due)
    else:
        how, into = r[11], r[10]
        m.update({'kind': 'merged', 'how': how, 'merged_into': utc(float(into) / 1000)})
        rows.append(band(flags, 'merged_row_sent', 0 if fired is None and int(r[4]) == 0 else 1, 0, 0))
        large = raw.get('large') or []
        sent = [x for x in large if x[2] and (x[1] == 'event' or x[4] == 'true')]
        rows.append(band(flags, 'large_rows', len(large), 1, 2))
        rows.append(band(flags, 'large_sent_recipients', int(sent[0][3]) if sent else 0, 1, 1))
        first = [x for x in large if x[1] == 'event']
        m['large'] = [{'id': int(x[0]), 'event': x[1], 'fired': x[2] != '', 'recipients': int(x[3]), 'merged': x[5]} for x in large]
        if how == 'before':
            listed = first[0][5].split(',') if first and first[0][5] else []
            rows.append(band(flags, 'large_lists_it', 1 if r[8] in listed else 0, 1, 1))
        else:
            notes.append("how = 'after': the large message went out before this row; by design (L17) it is not edited and lists nothing")
    notes.append('the owner was not told')
    return {'flags': flags, 'rows': rows, 'notes': notes, 'measured': m, 'done': True}


# ------------------------------------------------------------------------------------ first-live-hidden
# IB-144 (V42, V47; TL ruling 2026-11-06): the first live HIDDEN OI divergence alert that was SENT (kind = 'hidden',
# fired_at set). Bands: recipients exactly 1 and exactly one user with oi_alerts (owner only); not late; its TF's
# perTf.sendHidden is on in alert_settings (a hidden alert sent on a TF that is off means the gate is broken; all
# three are on since 2026-11-06, the owner's 4h ruling); and the link answers 200 through Caddy. PENDING until one exists; then the timer removes itself. The owner is
# NOT told — he got the alert.

# first-live-hidden-4h (owner ruling 2026-11-06: 4h switched on over V47's 4h FAIL, the IB-141 6/2 SOL artefact): the
# same bands as first-live-hidden, 4h only, from the enable statement's own time (dev-1, `UPDATE 1` at 13:02:05Z) — a
# 4h hidden row journalled while 4h was off must not count. Its first real message gets its own record.
HIDDEN_4H_ENABLED_AT = '2026-11-06T13:02:05Z'


def first_hidden_gather(tf=None, since=None):
    raw = {'now': utc(time.time())}
    where = (" and a.tf = '%s'" % tf if tf else '') + (" and a.fired_at >= '%s'" % since if since else '')
    raw['alert'] = psql("select a.id, a.symbol, a.tf, a.direction, extract(epoch from a.b_time), extract(epoch from a.confirmed_at),"
                        " extract(epoch from a.fired_at), a.recipients, a.late, a.build, s.params->'perTf'->a.tf->>'sendHidden'"
                        " from oi_divergence_alerts a cross join alert_settings s"
                        " where s.id = 1 and a.source = 'live' and a.kind = 'hidden' and a.fired_at is not null%s"
                        " order by a.fired_at, a.id limit 5" % where)
    raw['alert'] = first_fired_since(raw['alert'], 6, since) if since else raw['alert'][:1]
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


def first_hidden_4h_evaluate(raw):
    """first-live-hidden's bands on the first 4h row fired since the 4h enable (the test seam skips the query)."""
    rows = [r for r in raw['alert'] if r[2] == '4h']
    return first_hidden_evaluate(dict(raw, alert=first_fired_since(rows, 6, HIDDEN_4H_ENABLED_AT)))


def first_hidden_evaluate(raw):
    if not raw['alert']:
        return {'pending': True, 'flags': [], 'rows': [], 'notes': ['no live hidden alert sent yet at %s' % raw['now']], 'measured': None}
    a = raw['alert'][0]
    b_time, confirmed, fired = float(a[4]), float(a[5]), float(a[6])
    flags, rows = [], []
    rows.append(band(flags, 'recipients', int(a[7]), 1, 1))
    rows.append(band(flags, 'oi_alerts_users', int(raw['eligible'][0][0]), 1, 1))
    rows.append(band(flags, 'late', 1 if a[8] == 't' else 0, 0, 0))
    rows.append(band(flags, 'tf_send_hidden', 1 if a[10] == 'true' else 0, 1, 1))
    rows.append(band(flags, 'link_http', raw.get('link_code'), 200, 200))
    m = {'id': int(a[0]), 'symbol': a[1], 'tf': a[2], 'direction': a[3], 'b_time': utc(b_time), 'confirmed_at': utc(confirmed),
         'fired_at': utc(fired), 'fire_after_confirm_s': round(fired - confirmed), 'recipients': int(a[7]),
         'oi_alerts_users': int(raw['eligible'][0][0]), 'late': a[8] == 't', 'build': a[9], 'tf_send_hidden': a[10],
         'link': raw.get('link'), 'link_http': raw.get('link_code')}
    return {'flags': flags, 'rows': rows, 'notes': ['the owner was not told: he received the alert itself'], 'measured': m, 'done': True}


# ----------------------------------------------------------------------------- history runs (IB-145)
# backfill-rerun, liq-weekly, funding-rerun and level-rerun start a history CLI on the box through its runner
# (box-backfill.sh, liq-backfill.sh, funding-backfill.sh, level-backfill.sh).
# The CLI refuses to START below its start gate (memory-guard.ts; default 170 MB, measured after its ~66 MB load);
# the runner then prints «DEFERRED:memory gate refused (…)» and exits 3. Here:
# - every run asks for HISTORY_START_FLOOR_MB (140; never below without a TL ruling — history-gate.sh refuses it).
#   Why 140, not 170: sar 11-04/11-05, 10-min samples, host MemAvailable at rest ≥ 236 MB (what 170 needs) in 29/142
#   and 87/143 samples, ≥ 206 MB (what 140 needs) in 128/142 and 133/143; at 22:xx on 11-05 (the rerun's hour)
#   152–239 MB. The 120 MB pause, the 5-min abort and the 100 MB kill are unchanged, and tonight's two runs at 140
#   had sampler minima 201 and 170 MB;
# - a refusal is retried every DEFER_WAIT_S, DEFER_TRIES tries in all (2 h 30 min of retrying); still refused →
#   DEFERRED. No try STARTS inside the nightly pg_dump's window (insight-bot-backup.timer, 01:00 UTC; it takes
#   < 1 min): from BACKUP_QUIET[0] to BACKUP_QUIET[1] s after 00:00 UTC a try waits for the window's end (TL ruling
#   2026-11-06: never during a pg_dump);
# - the runner's «== start gate: asked N, the CLI applied M» line: M ≠ N means the image ignored the env (deployed
#   before 95366a24) → FLAG:start_floor_ignored.

HISTORY_START_FLOOR_MB = int(os.environ.get('CHECKS_START_FLOOR_MB', '140'))
DEFER_TRIES = int(os.environ.get('CHECKS_DEFER_TRIES', '6'))
DEFER_WAIT_S = int(os.environ.get('CHECKS_DEFER_WAIT_S', '1800'))
BACKUP_UTC_S = 3600                                # insight-bot-backup.timer OnCalendar 01:00:00 UTC (checks.test.sh pins it)
BACKUP_QUIET = (BACKUP_UTC_S - 5 * 60, BACKUP_UTC_S + 30 * 60)   # 00:55–01:30 UTC


def backup_quiet_wait(now):
    """Seconds a try starting at `now` must wait to leave the backup's window (0 outside it)."""
    tod = now % 86400
    return BACKUP_QUIET[1] - tod if BACKUP_QUIET[0] <= tod < BACKUP_QUIET[1] else 0


def history_now():
    """The clock for the backup window; CHECKS_FAKE_NOW (epoch s) pins it for checks.test.sh, which must not depend on
    the hour it runs at."""
    fake = os.environ.get('CHECKS_FAKE_NOW')
    return float(fake) if fake else time.time()


def history_run(script, args, timeout=4 * 3600, sleep=time.sleep, now=history_now):
    """Runs a history runner with the start floor; retries a refusal (exit 3). → {rc, output, tries, waits}."""
    waits = []
    for t in range(1, DEFER_TRIES + 1):
        w = backup_quiet_wait(now())
        if w:
            waits.append('try %d waited %d s for the pg_dump window (00:55–01:30 UTC)' % (t, w))
            sleep(w)
        try:
            p = subprocess.run(['bash', script] + args + ['--start-floor', str(HISTORY_START_FLOOR_MB)],
                               capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise CheckFailed('%s %s ran over %d h' % (script, args[0], timeout // 3600))
        out = p.stdout + p.stderr
        if p.returncode != 3 or t == DEFER_TRIES:
            return {'rc': p.returncode, 'output': out, 'tries': t, 'waits': waits}
        say('%s try %d of %d deferred (%s); next in %d s' % (os.path.basename(script), t, DEFER_TRIES, out.strip().splitlines()[-1][:120] if out.strip() else '?', DEFER_WAIT_S))
        sleep(DEFER_WAIT_S)


def history_deferred_or_gate(flags, rows, raw, script_name):
    """Raises CheckDeferred on a refusal on every try; else the start-gate row (FLAG when the image ignored the floor)."""
    import re
    out = raw['output']
    gate = re.search(r'^== start gate: asked (\S+), the CLI applied (.+)$', out, re.M)
    d = re.search(r'^DEFERRED:(.+)$', out, re.M)
    if raw['rc'] == 3 and d:
        ignored = ' — the image ignored the floor: asked %s, applied %s' % (gate.group(1), gate.group(2)) if gate and gate.group(2) != gate.group(1) else ''
        raise CheckDeferred('%s, %s of %s tries%s' % (d.group(1), raw.get('tries', 1), DEFER_TRIES, ignored))
    if not gate:
        raise CheckFailed('%s output has no «== start gate:» line' % script_name)
    honoured = gate.group(1) == 'default' or gate.group(2) in (gate.group(1), 'none (no gate reached)')
    rows.append(band(flags, 'start_floor_ignored', 0 if honoured else 1, 0, 0))
    return 'start gate: asked %s MB, the CLI applied %s; %s tries' % (gate.group(1), gate.group(2), raw.get('tries', 1))


# ---------------------------------------------------------------------------------------- backfill-rerun
# IB-116's rerun after 2026-11-07 22:00 UTC: box-backfill.sh --write measures the windows that were
# open at the first run (314) and writes no new subject (the once-keys hold). The script carries its own
# 1 s sampler and kills the CLI below 100 MB MemAvailable. Bands: 0 new rows; measured 157–628 (2× of 314);
# 0 failed; 0 left open; weight 400–1 600 (≈ 800). A killed or failed run is FAIL.

BACKFILL_SCRIPT = os.environ.get('CHECKS_BACKFILL_SCRIPT', os.path.join(DEPLOY_DIR, 'box-backfill.sh'))  # IB-145: synced, was /root
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
    run = history_run(BACKFILL_SCRIPT, ['--write'])
    raw.update(run, output=run['output'][-6000:])
    raw['after'] = psql(BACKFILL_COUNTS)
    return raw


def backfill_evaluate(raw):
    import re
    out = raw['output']
    if 'KILLED for memory' in out:
        raise CheckFailed('the CLI was killed: MemAvailable < 100 MB (box-backfill.sh sampler)')
    flags, rows = [], []
    gate_note = history_deferred_or_gate(flags, rows, raw, 'box-backfill.sh')
    cli = re.search(r'== CLI output \(exit (\d+)\)', out)
    if raw['rc'] != 0 or not cli or cli.group(1) != '0':
        raise CheckFailed('box-backfill.sh exit %s, CLI exit %s' % (raw['rc'], cli.group(1) if cli else '?'))
    paths = re.search(r'paths: measured (\d+), failed (\d+), weight (\d+)', out)
    left = re.search(r'left (\d+)', out)
    mem = re.search(r'min MemAvailable (\d+) MB', out)
    if not paths or not mem:
        raise CheckFailed('box-backfill.sh output has no «paths: measured …» or «min MemAvailable» line')
    before, after = dict((r[0], int(r[1])) for r in raw['before']), dict((r[0], int(r[1])) for r in raw['after'])
    new_rows = sum(after[k] - before[k] for k in ('alerts', 'controls', 'near_misses', 'paths'))
    rows.append(band(flags, 'new_rows', new_rows, 0, 0))
    rows.append(band(flags, 'paths_measured', int(paths.group(1)), BACKFILL_OPEN // 2, BACKFILL_OPEN * 2))
    rows.append(band(flags, 'paths_failed', int(paths.group(2)), 0, 0))
    rows.append(band(flags, 'paths_left_open', after['paths_open'], 0, 0))
    rows.append(band(flags, 'path_weight', int(paths.group(3)), 400, 1600))
    rows.append(band(flags, 'min_mem_available_mb', int(mem.group(1)), 100, 10 ** 6))
    return {'flags': flags, 'rows': rows, 'notes': ['CLI «left» line: %s' % (left.group(1) if left else '—'), gate_note] + raw.get('waits', []),
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
    run = history_run(LIQ_SCRIPT, ['--write', '--until', LIQ_UNTIL, '--counts-to', raw['counts_to']])
    raw.update(run, output=run['output'][-20000:])
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
    flags, rows = [], []
    gate_note = history_deferred_or_gate(flags, rows, raw, 'liq-backfill.sh')
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
    rows.append(band(flags, 'new_rows', sum(int(x) for x in new.groups() if x is not None), 0, 0))
    rows.append(band(flags, 'days_counted', summary['days'], 6.9, 10 ** 6))
    rows.append(band(flags, 'paths_failed', int(paths.group(2)), 0, 0))
    rows.append(band(flags, 'paths_left_open', int(paths.group(4)), 0, 0))
    rows.append(band(flags, 'min_mem_available_mb', int(mem.group(1)), 100, 10 ** 6))
    notes = ['counts over (%s, %s]: the live loop\'s code at its live cadence (10 s since IB-143), into memory; nothing from it is written' % (summary['from'], summary['countsTo']),
             'written rows (source = backfill) stop at %s, where the live journal starts; live and backfill are never pooled (V32)' % summary['until'],
             'TRX: Binance only until 2026-11-05 17:34 UTC (L5); Bybit and OKX after',
             'path weight this run: %s (measured %s windows)' % (paths.group(3), paths.group(1)),
             'no hit rate: «worked» and the baseline are not defined yet (design §1 C5)', gate_note] + raw.get('waits', [])
    return {'flags': flags, 'rows': rows, 'notes': notes, 'md': liq_md_table(summary['table'], summary['days']),
            'measured': {'summary': summary, 'paths': {'measured': int(paths.group(1)), 'failed': int(paths.group(2)), 'weight': int(paths.group(3)), 'left': int(paths.group(4))},
                         'min_mem_available_mb': int(mem.group(1)), 'tail': out[-1500:]}}


# ------------------------------------------------------------------------------------------ funding-rerun
# IB-125: ≥ 72 h after the funding history run's write, funding-backfill.sh --write reruns it with the SAME --until.
# It writes 0 new rows (the once-keys hold; a different --until would move the 5-min grid, so it is never guessed)
# and measures the path windows still open at the write (its last 72 h). --until is read from the write's own output
# (the newest /root/ib125-write-*.out whose FUNDING_HISTORY_JSON says mode write; no constant to edit, no manual step).
# Bands: 0 new rows; 0 failed and 0 open path windows; memory ≥ 100 MB. A killed run, a CLI exit ≠ 0, a missing
# write or no summary line is FAIL (the owner hears); DEFERRED (the start gate refused 6 tries) and PASS are silent.

FUNDING_SCRIPT = os.environ.get('CHECKS_FUNDING_SCRIPT', os.path.join(DEPLOY_DIR, 'funding-backfill.sh'))
FUNDING_RUN_DIR = os.environ.get('CHECKS_FUNDING_RUN_DIR', '/root')


def newest_write_until(run_dir, pattern, key, what):
    """The --until of the newest completed history WRITE: (until ISO, the file it came from). `pattern` is the RUNNER's
    output name (its names carry a UTC stamp, so they sort by time); a dry run or a crashed write has no `key` line
    with mode write and is skipped. Shared by funding-rerun (IB-125) and level-rerun (IB-127)."""
    import glob
    import re
    for path in sorted(glob.glob(os.path.join(run_dir, pattern)), reverse=True):
        with open(path, encoding='utf-8') as f:
            m = re.search(r'^%s (\{.*\})$' % key, f.read(), re.M)
        if m and json.loads(m.group(1)).get('mode') == 'write':
            return json.loads(m.group(1))['until'], path
    raise CheckFailed('no completed %s write in %s/%s: nothing to rerun' % (what, run_dir, pattern))


def funding_until():
    """The --until of the newest completed funding write: (until ISO, the file it came from)."""
    return newest_write_until(FUNDING_RUN_DIR, 'ib125-write-*.out', 'FUNDING_HISTORY_JSON', 'funding')


def funding_gather():
    if not os.path.exists(FUNDING_SCRIPT):
        raise CheckFailed('%s is missing' % FUNDING_SCRIPT)
    until, source = funding_until()
    raw = {'started': utc(time.time()), 'until': until, 'until_from': source}
    run = history_run(FUNDING_SCRIPT, ['--write', '--until', until])
    raw.update(run, output=run['output'][-20000:])
    return raw


def funding_evaluate(raw):
    import re
    out = raw['output']
    if 'KILLED for memory' in out:
        raise CheckFailed('the CLI was killed: MemAvailable < 100 MB (funding-backfill.sh sampler)')
    flags, rows = [], []
    gate_note = history_deferred_or_gate(flags, rows, raw, 'funding-backfill.sh')
    cli = re.search(r'== CLI output \(exit (\d+)\)', out)
    if raw['rc'] != 0 or not cli or cli.group(1) != '0':
        raise CheckFailed('funding-backfill.sh exit %s, CLI exit %s' % (raw['rc'], cli.group(1) if cli else '?'))
    js = re.search(r'^FUNDING_HISTORY_JSON (\{.*\})$', out, re.M)
    new = re.search(r'^write ×1: .*new rows: enter (\d+), flip (\d+), controls (\d+)', out, re.M)
    paths = re.search(r'paths: measured (\d+), failed (\d+), weight (\d+), \d+ s; left (\d+)', out)
    mem = re.search(r'min MemAvailable (\d+) MB', out)
    if not js or not new or not paths or not mem:
        raise CheckFailed('funding-backfill.sh output lacks a FUNDING_HISTORY_JSON, «write ×1», «paths:» or «min MemAvailable» line')
    summary = json.loads(js.group(1))
    rows.append(band(flags, 'new_rows', sum(int(x) for x in new.groups()), 0, 0))
    rows.append(band(flags, 'paths_failed', int(paths.group(2)), 0, 0))
    rows.append(band(flags, 'paths_left_open', int(paths.group(4)), 0, 0))
    rows.append(band(flags, 'min_mem_available_mb', int(mem.group(1)), 100, 10 ** 6))
    notes = ['--until %s, read from %s (the write\'s own output)' % (raw.get('until'), raw.get('until_from')),
             'rows written (source = backfill): %s' % json.dumps(summary.get('written'), ensure_ascii=False),
             'path weight this run: %s (measured %s windows)' % (paths.group(3), paths.group(1)),
             'no hit rate: «worked» and the baseline are not defined yet (design §1 C5)', gate_note] + raw.get('waits', [])
    return {'flags': flags, 'rows': rows, 'notes': notes,
            'measured': {'until': raw.get('until'), 'written': summary.get('written'),
                         'paths': {'measured': int(paths.group(1)), 'failed': int(paths.group(2)), 'weight': int(paths.group(3)), 'left': int(paths.group(4))},
                         'min_mem_available_mb': int(mem.group(1)), 'tail': out[-1500:]}}


# ------------------------------------------------------------------------------------------ level-rerun
# IB-127: ≥ 72 h after the level history run's write, level-backfill.sh --write reruns it with the SAME --until (the
# 15m close of the live level loop's first heartbeat). It writes 0 new rows (the once-keys hold) and measures the path
# windows still open at the write (its last 72 h). --until is read from the write's own output (the newest
# /root/ib127-write-*.out whose LEVEL_HISTORY_JSON says mode write). Bands and verdicts as funding-rerun: 0 new rows;
# 0 failed and 0 open path windows; memory ≥ 100 MB. A killed run, a CLI exit ≠ 0, a missing write or no summary line
# is FAIL (the owner hears); DEFERRED (the start gate refused 6 tries) and PASS are silent.

LEVEL_SCRIPT = os.environ.get('CHECKS_LEVEL_SCRIPT', os.path.join(DEPLOY_DIR, 'level-backfill.sh'))
LEVEL_RUN_DIR = os.environ.get('CHECKS_LEVEL_RUN_DIR', '/root')


def level_gather():
    if not os.path.exists(LEVEL_SCRIPT):
        raise CheckFailed('%s is missing' % LEVEL_SCRIPT)
    until, source = newest_write_until(LEVEL_RUN_DIR, 'ib127-write-*.out', 'LEVEL_HISTORY_JSON', 'level')
    raw = {'started': utc(time.time()), 'until': until, 'until_from': source}
    run = history_run(LEVEL_SCRIPT, ['--write', '--until', until])
    raw.update(run, output=run['output'][-20000:])
    return raw


def level_evaluate(raw):
    import re
    out = raw['output']
    if 'KILLED for memory' in out:
        raise CheckFailed('the CLI was killed: MemAvailable < 100 MB (level-backfill.sh sampler)')
    flags, rows = [], []
    gate_note = history_deferred_or_gate(flags, rows, raw, 'level-backfill.sh')
    cli = re.search(r'== CLI output \(exit (\d+)\)', out)
    if raw['rc'] != 0 or not cli or cli.group(1) != '0':
        raise CheckFailed('level-backfill.sh exit %s, CLI exit %s' % (raw['rc'], cli.group(1) if cli else '?'))
    js = re.search(r'^LEVEL_HISTORY_JSON (\{.*\})$', out, re.M)
    new = re.search(r'^write ×1: .*new rows: alerts (\d+), controls (\d+)', out, re.M)
    paths = re.search(r'paths: measured (\d+), failed (\d+), weight (\d+), \d+ s; left (\d+)', out)
    mem = re.search(r'min MemAvailable (\d+) MB', out)
    if not js or not new or not paths or not mem:
        raise CheckFailed('level-backfill.sh output lacks a LEVEL_HISTORY_JSON, «write ×1», «paths:» or «min MemAvailable» line')
    summary = json.loads(js.group(1))
    rows.append(band(flags, 'new_rows', sum(int(x) for x in new.groups()), 0, 0))
    rows.append(band(flags, 'paths_failed', int(paths.group(2)), 0, 0))
    rows.append(band(flags, 'paths_left_open', int(paths.group(4)), 0, 0))
    rows.append(band(flags, 'min_mem_available_mb', int(mem.group(1)), 100, 10 ** 6))
    notes = ['--until %s, read from %s (the write\'s own output)' % (raw.get('until'), raw.get('until_from')),
             'rows written (source = backfill): %s' % json.dumps(summary.get('written'), ensure_ascii=False),
             'path weight this run: %s (measured %s windows)' % (paths.group(3), paths.group(1)),
             'no hit rate: «worked» and the baseline are not defined yet (design §1 C5)', gate_note] + raw.get('waits', [])
    return {'flags': flags, 'rows': rows, 'notes': notes,
            'measured': {'until': raw.get('until'), 'written': summary.get('written'),
                         'paths': {'measured': int(paths.group(1)), 'failed': int(paths.group(2)), 'weight': int(paths.group(3)), 'left': int(paths.group(4))},
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
    'first-live-hidden': (first_hidden_gather, first_hidden_evaluate, 'IB-144: the first live hidden OI divergence alert sent (owner only, its TF switched on): facts to a file, then the timer stops'),
    'first-live-liq': (first_liq_gather, first_liq_evaluate, 'IB-143: the first live liquidation message (owner only): facts to a file, then the timer stops'),
    'first-live-liq-held': (first_held_gather, first_held_evaluate, 'IB-148: the first live HELD or MERGED liquidation event (owner only): facts to a file, then the timer stops'),
    'first-live-hidden-4h': (lambda: first_hidden_gather('4h', HIDDEN_4H_ENABLED_AT), first_hidden_4h_evaluate, 'Owner ruling 2026-11-06: the first live 4h hidden OI divergence alert sent since 4h was switched on: facts to a file, then the timer stops'),
    'first-live-level': (first_level_gather, first_level_evaluate, 'Levels ON 2026-11-06: the first live level alert sent (owner only, WO off): facts to a file, then the timer stops'),
    'backfill-rerun': (backfill_gather, backfill_evaluate, 'IB-116 rerun: /root/box-backfill.sh --write for the open windows'),
    'oi-4h-first-eval': (oi4h_gather, oi4h_evaluate, 'IB-141: the 4h OI evaluations since boot run on 6 left / 2 right (migration 032)'),
    'liq-weekly': (liq_gather, liq_evaluate, 'IB-123: a week of liquidation tape — alerts per coin per week at ×½, ×1, ×2; the open path windows'),
    'funding-rerun': (funding_gather, funding_evaluate, 'IB-125: the funding history run rerun ≥ 72 h after its write — 0 new rows, the path windows that were open measured'),
    'level-rerun': (level_gather, level_evaluate, 'IB-127: the level history run rerun ≥ 72 h after its write — 0 new rows, the path windows that were open measured'),
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
    if doc.get('deferred'):
        L += ['**Did not start** (the memory start gate refused on every try; nothing broke, nothing was written, no Telegram): %s' % doc['deferred'],
              '', 'Reschedule it at a quieter hour: `checks.py schedule %s \'<UTC time>\'` (RUNBOOK §9b).' % doc['check'], '']
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
    except CheckDeferred as e:  # did not start: a verdict of its own, never the owner's Telegram (IB-145)
        doc['verdict'], doc['deferred'] = 'DEFERRED:' + str(e)[:160], str(e)
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
