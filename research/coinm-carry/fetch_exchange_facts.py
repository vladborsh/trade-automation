#!/usr/bin/env python3
"""Record the exchange facts the pre-registration says must be VERIFIED, not
assumed (note §1.4 "Costs", Stage-0 checklist), with their source URLs and the
pull date, into results/exchange_facts.json.

  contract multiplier, margin asset, liquidation fee   GET /dapi/v1/exchangeInfo
  bracket-1 maintenance-margin rate and max leverage   the published COIN-M
                                                       bracket table
  COIN-M taker/maker fee, VIP 0                        pinned from the Binance
                                                       fee FAQ, recorded here
"""
from __future__ import annotations
import datetime, json, os, sys
from urllib.request import urlopen, Request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PERPS, OUT

EI = "https://dapi.binance.com/dapi/v1/exchangeInfo"
BR = "https://www.binance.com/bapi/futures/v1/friendly/delivery/common/brackets"
FEE_SRC = ("https://www.binance.com/en/support/faq/detail/360033544231 "
           "(Binance Futures Fee Structure & Fee Calculations)")

pull = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
ei = json.loads(urlopen(EI, timeout=60).read())
br = json.loads(urlopen(Request(BR, headers={"User-Agent": "Mozilla/5.0"}),
                        timeout=60).read())["data"]["brackets"]
brk = {b["symbol"]: b for b in br}

out = {"_pull_date_utc": pull, "_sources": {"exchangeInfo": EI,
                                            "brackets": BR, "fees": FEE_SRC},
       "_fees_vip0": {"coinm_taker": 0.0005, "coinm_maker": 0.0002,
                      "spot_taker": 0.0010,
                      "bnb_discount_applies_to_coinm": False,
                      "usdm_taker_for_comparison": 0.0005}}
for s in ei["symbols"]:
    if s["symbol"] not in PERPS:
        continue
    b1 = brk[s["symbol"]]["riskBrackets"][0]
    out[s["symbol"]] = dict(
        contractSize=s["contractSize"], marginAsset=s["marginAsset"],
        contractType=s["contractType"], onboardDate=s["onboardDate"],
        onboard_utc=str(datetime.datetime.fromtimestamp(
            s["onboardDate"] / 1000, datetime.timezone.utc)),
        maintMarginPercent=s["maintMarginPercent"],
        requiredMarginPercent=s["requiredMarginPercent"],
        liquidationFee=s["liquidationFee"],
        bracket1_notional_cap_coin=b1["bracketNotionalCap"],
        bracket1_mmr=b1["bracketMaintenanceMarginRate"],
        bracket1_max_leverage=b1.get("maxOpenPosLeverage"),
    )
json.dump(out, open(os.path.join(OUT, "exchange_facts.json"), "w"), indent=1)
print(json.dumps(out, indent=1))
