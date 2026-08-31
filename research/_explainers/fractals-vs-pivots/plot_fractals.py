"""
Plot the project's real `fractals(df, k)` output on real BTCUSDT 5m data,
so a trader can visually verify swing-high/swing-low detection against
what they'd see from TradingView's ta.pivothigh/ta.pivotlow.

Imports fractals() directly from research/intraday-mr-smc/indicators.py --
does NOT reimplement the logic -- so these charts provably show the real
function's output.

Usage:
    source .venv/bin/activate
    python research/_explainers/fractals-vs-pivots/plot_fractals.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import Rectangle
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2].parent  # .../trade_automation
SMC_DIR = REPO_ROOT / "research" / "intraday-mr-smc"
sys.path.insert(0, str(SMC_DIR))

from indicators import fractals  # noqa: E402  (the real, un-reimplemented function)

OUT_DIR = Path(__file__).resolve().parent
DATA_FILE = SMC_DIR / "data" / "BTCUSDT-5m.csv.gz"
K = 3  # this project's convention (see structure()/strategies.py defaults)


def load_slice(n_bars: int = 260, start_offset: int = 120_000) -> pd.DataFrame:
    """Load a real, contiguous slice of BTCUSDT 5m candles."""
    df = pd.read_csv(DATA_FILE)
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df.iloc[start_offset:start_offset + n_bars].reset_index(drop=True)
    return df


def draw_candles(ax, df: pd.DataFrame, width_frac: float = 0.6):
    """Minimal OHLC candlestick renderer (no extra deps)."""
    xs = mdates.date2num(df["ts"].dt.to_pydatetime())
    if len(xs) > 1:
        bar_w = (xs[1] - xs[0]) * width_frac
    else:
        bar_w = 0.6 / 24 / 60 * 5
    for x, o, h, l, c in zip(xs, df["open"], df["high"], df["low"], df["close"]):
        color = "#2e8b57" if c >= o else "#c0392b"
        ax.plot([x, x], [l, h], color=color, linewidth=0.8, zorder=2)
        rect = Rectangle(
            (x - bar_w / 2, min(o, c)), bar_w, max(abs(c - o), 1e-9),
            facecolor=color, edgecolor=color, linewidth=0.4, zorder=3,
        )
        ax.add_patch(rect)
    ax.xaxis_date()


def chart_basic(df: pd.DataFrame, sh: pd.Series, sl: pd.Series, out_path: Path):
    """Chart 1: candles + confirmed pivot-high / pivot-low markers."""
    fig, ax = plt.subplots(figsize=(16, 7))
    draw_candles(ax, df)

    xs = mdates.date2num(df["ts"].dt.to_pydatetime())
    pad = (df["high"].max() - df["low"].min()) * 0.02

    hi_idx = df.index[sh]
    lo_idx = df.index[sl]
    ax.scatter(xs[hi_idx], df.loc[hi_idx, "high"] + pad, marker="v", color="#d62728",
               s=70, zorder=5, label=f"pivot high (k={K})")
    ax.scatter(xs[lo_idx], df.loc[lo_idx, "low"] - pad, marker="^", color="#1f77b4",
               s=70, zorder=5, label=f"pivot low (k={K})")

    ax.set_title(
        f"fractals(df, k={K}) on BTCUSDT 5m -- real klines, {len(df)} bars\n"
        "Red down-triangle = confirmed swing high | Blue up-triangle = confirmed swing low",
        fontsize=12,
    )
    ax.set_ylabel("price (USDT)")
    ax.legend(loc="upper left")
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"wrote {out_path}")


def chart_causality(df: pd.DataFrame, sh: pd.Series, sl: pd.Series, out_path: Path):
    """Chart 2: same data, but shade the last k bars (2026's 'now') where any
    pivot that occurred in that window is NOT YET confirmed/knowable, and
    make that explicit with an annotation."""
    # Trim to a shorter, more legible window and pretend "now" is the last bar.
    df2 = df.iloc[-140:].reset_index(drop=True)
    sh2 = sh.iloc[-140:].reset_index(drop=True)
    sl2 = sl.iloc[-140:].reset_index(drop=True)

    fig, ax = plt.subplots(figsize=(16, 7))
    draw_candles(ax, df2)

    xs = mdates.date2num(df2["ts"].dt.to_pydatetime())
    pad = (df2["high"].max() - df2["low"].min()) * 0.02

    hi_idx = df2.index[sh2]
    lo_idx = df2.index[sl2]
    ax.scatter(xs[hi_idx], df2.loc[hi_idx, "high"] + pad, marker="v", color="#d62728",
               s=70, zorder=5, label=f"pivot high (k={K}), CONFIRMED")
    ax.scatter(xs[lo_idx], df2.loc[lo_idx, "low"] - pad, marker="^", color="#1f77b4",
               s=70, zorder=5, label=f"pivot low (k={K}), CONFIRMED")

    # Shade the trailing k bars: "as of the last bar", any peak/trough inside
    # this window cannot yet be confirmed as a pivot (we don't have k bars of
    # follow-through to its right yet).
    last_n = len(df2)
    shade_start = xs[last_n - K] - (xs[1] - xs[0]) / 2
    shade_end = xs[-1] + (xs[1] - xs[0]) / 2
    ax.axvspan(shade_start, shade_end, color="grey", alpha=0.25, zorder=1,
               label=f"last {K} bars: too new to confirm a pivot yet")

    ymin, ymax = df2["low"].min(), df2["high"].max()
    yspan = ymax - ymin
    ax.set_ylim(ymin - yspan * 0.05, ymax + yspan * 0.30)

    ax.annotate(
        "if the highest high of the last few bars\nsits in here, it is NOT plotted as a\n"
        "pivot yet -- we need k bars AFTER it\nto confirm nothing higher followed",
        xy=(xs[-1], df2["high"].iloc[-K:].max()),
        xytext=(xs[-1] - (xs[-1] - xs[0]) * 0.30, ymax + yspan * 0.20),
        arrowprops=dict(arrowstyle="->", color="black"),
        fontsize=9, ha="left", va="top",
    )

    ax.set_title(
        f"Causality of fractals(df, k={K}): a pivot is only KNOWN k bars after it prints\n"
        "(grey band = trailing k bars, not yet confirmable -- matches TradingView's non-repainting pivot behavior)",
        fontsize=12,
    )
    ax.set_ylabel("price (USDT)")
    ax.legend(loc="upper left", fontsize=9)
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"wrote {out_path}")


def main():
    df = load_slice(n_bars=260, start_offset=120_000)
    sh, sl = fractals(df, k=K)

    chart_basic(df, sh, sl, OUT_DIR / "01_pivots_overview.png")
    chart_causality(df, sh, sl, OUT_DIR / "02_pivots_causality.png")


if __name__ == "__main__":
    main()
