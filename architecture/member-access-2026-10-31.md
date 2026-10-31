# Brief — member access: a real address and login (2026-10-31)

**Author:** coordinator (product session with the user) · **Date:** 2026-10-31 ·
**For:** Architect (insight-bot stream) — design, revise the wind-down plan, decompose into
`tasks/insight-bot.jsonl`. Not decomposed here.

## 1. Product rulings (user, 2026-10-31) — binding until revised

1. **Audience.** The product is for the owner now; the near-term target is a **paid
   subscription audience**. Build nothing for payments yet, but do not make choices that a
   subscription would have to undo (user model, auth, hosting shape).
2. **Liquidation collection stays.** It is the one dataset no venue serves historically, and one
   of the main reasons the product exists next to TradingView. This **reverses the part of the
   wind-down that removes it** (see §3).
3. **Crypto only.** No forex/index work: there is no derivatives data for it. IB-071 (Bybit forex
   symbols) should be re-checked against this ruling.
4. **Drawing on the chart: minimal** — horizontal levels, saved per user. Not a TradingView
   drawing editor. (Queued, §5.)

Positioning the user agreed to: *everything TradingView does not have, in one place and tied to
the chart* — derivatives data, liquidations, macro calendar, alerts on them, a journal.

## 2. Priority 1 — a real address and member login

Today only the owner can open the dashboard (SSM port-forward, W4 in
`insight-bot-web-dashboard.md`); no server exists (`infra/insight-bot/LIVE-RESOURCES.md`: EC2 was
never created). Rulings:

| Question | Ruling |
|---|---|
| Hosting | **AWS ap-northeast-1, t4g.micro**, the shape in `infra/insight-bot/COST-PLAN.md` (~13.6 USD/mo) and the existing OpenTofu. Finish IB-013. **WD-015 ("delete the five AWS resources") is cancelled.** |
| Address | **The user buys a domain** and adds it to Cloudflare. Cloudflare Tunnel with that domain, as designed in `insight-bot-web-dashboard.md` §5 (IB-032). This reverses the 2026-10-07 "no domain" ruling (§6 there). |
| Login | Keep the existing one-time link from the bot (`/web`, W3) and `/invite`. Add **"Log in with Telegram"** on the site itself (Telegram Login Widget; needs the domain set on the bot in BotFather) so a member does not have to go to the bot first. |

**Done means (run, not tested):** a member invited with `/invite`, on a phone outside the owner's
network, opens `https://<domain>`, logs in both ways, sees `/market` and an instrument page with
live data, gets a browser push for an upcoming calendar event (IB-069 needs https), and the box has
collected liquidations for 24 h with no gap on the health page.

**Blocked on the user (do not build past these, say so):** the domain + Cloudflare account; AWS
credentials on this machine; the production Telegram bot token; VAPID keys for the box.

## 3. The wind-down plan must be re-scoped first

`tasks/wind-down.jsonl` was written when the plan was "no box, everything on demand". Two rulings
above contradict parts of it:

- **WD-010** deletes the collectors and **WD-012** removes the liquidations page — conflict with
  §1.2. Liquidation collection (and whatever it needs: the liquidations tables, its collectors,
  the gap/uptime reporting that makes "no liquidations" distinguishable from "nobody listening")
  stays.
- **WD-015** — cancelled (§2).
- The rest (on-demand candles/summary, dropping playbooks, regime, the stored tape that has no
  product use) probably still stands, and makes the 1 GB box easier. Architect decides task by
  task and writes down which survive and why.

## 4. Things a subscription will need — design for, do not build

Recorded so §2's choices do not paint us into a corner: a member has a plan and an expiry; access
is checked server-side on every `/api/web/*` call, not only at login; the venue-read budget is per
box, not per user (the 60 s shared caches already do this — keep it that way); terms/privacy page.

## 5. Queue after priority 1 (user's order, not dispatched)

1. **Alerts + watchlist** — price level, OI change, funding threshold, large liquidation on my
   coin; delivered to Telegram and browser push; the alert opens the chart at the moment it fired.
2. **Screener** over the whole universe (price/OI/funding/volume × norm) + a **"Today" page**
   (overnight summary, today's calendar, coins in play).
3. **Horizontal levels** on the chart (saved server-side) + **position size calculator**.
4. **Trade journal** — manual entries first, chart snapshot at the trade.
5. **News context** — token unlocks, listings/delistings, ETF flows.
6. Cross-cutting: one product rather than two SPAs (`chart-client` vs `insight-dashboard`), a
   usable phone view, user settings stored server-side instead of `localStorage`.
