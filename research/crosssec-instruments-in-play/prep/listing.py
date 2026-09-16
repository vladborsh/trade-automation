#!/usr/bin/env python3
"""ARCHITECT-NOTE §1.1/§1.2 — the paginated S3 listing of every USD-M
monthly-klines prefix, and the admitted USDT-perp universe.

Stop rule (§11.8): fewer than 800 USDT symbols => the archive changed;
return to Architect.
"""
from __future__ import annotations
import json, os, re, sys
from urllib.request import urlopen
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
RESULTS = os.path.join(PKG, "results")
os.makedirs(RESULTS, exist_ok=True)

S3 = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
PREFIX = "data/futures/um/monthly/klines/"
NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"
ADMIT = re.compile(r"^[A-Z0-9]+USDT$")


def list_prefixes(prefix: str = PREFIX) -> list[str]:
    out, marker = [], None
    while True:
        url = f"{S3}?delimiter=/&prefix={prefix}"
        if marker:
            url += f"&marker={marker}"
        root = ET.fromstring(urlopen(url, timeout=120).read())
        got = [e.find(NS + "Prefix").text for e in root.findall(NS + "CommonPrefixes")]
        out += got
        trunc = root.findtext(NS + "IsTruncated") == "true"
        nm = root.findtext(NS + "NextMarker")
        if not trunc:
            break
        marker = nm or (got[-1] if got else None)
        if marker is None:
            break
    return out


def main() -> None:
    pres = list_prefixes()
    syms = sorted({p[len(PREFIX):].strip("/") for p in pres})
    admitted = sorted(s for s in syms if ADMIT.match(s))
    rej = sorted(set(syms) - set(admitted))
    print(f"prefixes: {len(syms)}   admitted USDT perps: {len(admitted)}   rejected: {len(rej)}")
    print("  rejected sample:", rej[:12])
    with open(os.path.join(RESULTS, "listing.json"), "w") as fh:
        json.dump(dict(n_prefixes=len(syms), n_admitted=len(admitted),
                       admitted=admitted, rejected=rej), fh, indent=1)
    if len(admitted) < 800:
        raise SystemExit(f"STOP RULE §11.8: only {len(admitted)} USDT symbols (<800). "
                         "Return to Architect.")


if __name__ == "__main__":
    main()
