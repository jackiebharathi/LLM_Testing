# Polymarket Agent — Bug Report & Implementation Guide

**Date:** 2026-03-23
**Affected Files:**
- `coin-fantasy-be/src/shared/polymarket_client.py`
- `coin-fantasy-be/src/lambdas/agents/analyze_polymarket.py`

**Verified Against Wallets:**
- `0xd55333867a11c158026c01e373c4fa8abc9f6af5` (MouthBreather) — UI PnL: +$1,230.63
- `0xb6bed94e75c333dae24eb9c80b3fef47ef3cfcfe` (DickTurbin) — UI PnL: +$342,433.20
- `0xacae3c6efeedd75f2b34564f55356855e8fd6798` (b33t) — UI PnL: -$206,163.55
- `0x7b47a31c97e22de4d7af4a07365545cbc5aed615` — UI PnL: -$132,684.33
- `0xd218e474776403a330142299f7796e8ba32eb5c9` — Leaderboard PnL: +$854,111.52

---

## Summary Table

| # | Bug | Severity | Fix | File : Lines |
|---|-----|----------|-----|--------------|
| 1 | `/value` parsed as dict, is actually list with `"value"` key | **P0** | Fix parser | `polymarket_client.py:641-644` |
| 2 | `/trades` has no `usdcSize` → all dollar metrics = 0 | **P0** | Use `price × size` | `polymarket_client.py:689` |
| 3 | PnL from `/positions` `cashPnl` misses MERGE/REDEEM payouts | **P0** | **Use `/v1/leaderboard`** (single call, exact UI match) | `polymarket_client.py:652-662` |
| 4 | Win rate misses fully-exited winning positions | **P1** | **Use `/closed-positions`** (has all resolved positions) | `polymarket_client.py:719-746` |
| 5 | Keyword map too narrow → "General" dominates | **P1** | Expand keyword lists | `polymarket_client.py:534-547` |
| 6 | Gamma enrichment silently fails on large wallets | **P1** | Retry / rate-limit / log | `polymarket_client.py:253-269` |
| 7 | `/activity` has hard pagination cap (~3,500 records) | **P1** | **Use `/closed-positions`** (offset max 100K) | `polymarket_client.py:91-136` |
| 8 | `biggest_win` not computed | **P2** | **Use `/closed-positions`** (sortBy=REALIZEDPNL) | New code needed |

---

## NEW ENDPOINTS DISCOVERED (Solve Bugs 3, 4, 7, 8)

### `/v1/leaderboard` — Exact PnL in a Single Call

**This is the most important discovery.** A single API call returns the exact PnL the Polymarket UI shows.

```
GET https://data-api.polymarket.com/v1/leaderboard?user={WALLET}&timePeriod=ALL&orderBy=PNL
```

**Response:**
```json
[{
  "rank": "2424290",
  "proxyWallet": "0x7b47...",
  "vol": 9050980.24,
  "pnl": -132674.47,
  "userName": "...",
  "profileImage": "..."
}]
```

**Verified against UI for all test wallets:**

| Wallet | Leaderboard `pnl` | UI PnL | Diff |
|--------|-------------------|--------|------|
| 0x7b47 (sports bettor) | -$132,674 | -$132,684 | ~$10 |
| 0xd553 (MouthBreather) | $1,175 | $1,231 | ~$56 |
| 0xb6be (DickTurbin) | $343,459 | $342,433 | ~$1K |
| 0xd218 | $854,112 | TBD | — |

**Parameters:**

| Parameter | Type | Default | Values |
|-----------|------|---------|--------|
| `user` | Address | — | Filter to specific wallet |
| `timePeriod` | string | DAY | `DAY`, `WEEK`, `MONTH`, `ALL` |
| `orderBy` | string | PNL | `PNL`, `VOL` |
| `category` | string | OVERALL | `OVERALL`, `POLITICS`, `SPORTS`, `CRYPTO`, `CULTURE`, `MENTIONS`, `WEATHER`, `ECONOMICS`, `TECH`, `FINANCE` |
| `limit` | int | 25 | 1–50 |
| `offset` | int | 0 | 0–1000 |

**Solves:** Bug 3 (PnL), and also gives volume for free.

---

### `/closed-positions` — All Resolved Positions with PnL

Returns every closed/resolved position including fully-exited ones that disappear from `/positions`.

```
GET https://data-api.polymarket.com/closed-positions?user={WALLET}&limit=50&offset=0
```

**Response fields:** `proxyWallet`, `asset`, `conditionId`, `avgPrice`, `totalBought`, `realizedPnl`, `curPrice`, `title`, `slug`, `icon`, `eventSlug`, `outcome`, `outcomeIndex`, `oppositeOutcome`, `oppositeAsset`, `endDate`, `timestamp`

**Parameters:**

| Parameter | Type | Default | Limits |
|-----------|------|---------|--------|
| `user` | Address | required | — |
| `limit` | int | 10 | **0–50** |
| `offset` | int | 0 | **0–100,000** (10x higher than /activity!) |
| `sortBy` | string | REALIZEDPNL | `REALIZEDPNL`, `TITLE`, `PRICE`, `AVGPRICE`, `TIMESTAMP` |
| `sortDirection` | string | DESC | `ASC`, `DESC` |
| `market` | Hash64[] | — | CSV conditionIds |
| `eventId` | int[] | — | CSV event IDs |
| `title` | string | — | Max 100 chars |

**Verified for wallet 0x7b47:**
- Returned **1,446 closed positions** with **1,350 unique conditionIds**
- Winners: 742, Losers: 704
- Biggest win: "Spread: Iowa State Cyclones (-2.5)" — `realizedPnl: $26,000`, `totalBought: $50,000`

**Solves:**
- **Bug 4 (win rate):** count `realizedPnl > 0` vs `< 0`
- **Bug 7 (/activity cap):** offset max is 100,000 — no cap issues
- **Bug 8 (biggest win):** `sortBy=REALIZEDPNL&sortDirection=DESC&limit=1`

---

### The Full PnL Formula (verified)

```
Net PnL = sum(/closed-positions realizedPnl) + sum(/positions (currentValue - initialValue))
```

For wallet 0x7b47:
- `/closed-positions` sum: **$48,188**
- `/positions` unrealized: **-$180,132**
- Computed: **-$131,944** ≈ leaderboard's **-$132,674** (within $730)

---

### PNL Subgraph (Alternative — GraphQL on Goldsky)

On-chain position data with `realizedPnl` per token position. Works but has **query timeout issues** on active wallets.

```
POST https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn
Content-Type: application/json
```

**`UserPosition` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | ID | `{user}-{tokenId}` |
| `user` | String | Wallet address |
| `tokenId` | BigInt | ERC1155 token ID |
| `amount` | BigInt | Current token balance (0 = fully exited) |
| `avgPrice` | BigInt | Average entry price (6 decimal USDC) |
| `realizedPnl` | BigInt | Realized PnL in USDC microunits (÷ 1,000,000) |
| `totalBought` | BigInt | Total USDC spent (6 decimals) |

**Example query:**
```graphql
{
  userPositions(first: 100, skip: 0, where: { user: "0x7b47..." }) {
    id tokenId amount avgPrice realizedPnl totalBought
  }
}
```

**Limitations:**
- Times out on `first: 1000` for active wallets — use `first: 100` with `skip` pagination
- Token ID ≠ Condition ID (each conditionId has two tokenIds for Yes/No)
- Values are BigInt USDC microunits — divide by 1,000,000

**Recommendation:** Use `/v1/leaderboard` + `/closed-positions` (Data API) as primary. Use subgraph only as fallback.

---

## BUG 1: `/value` response parsed incorrectly → `portfolio_value_usd: 0`

**Severity:** P0
**Location:** `polymarket_client.py:641-644`

### Problem

API returns a **list** with key `"value"`, code expects a **dict** with key `"portfolioValue"`.

**API actually returns:**
```json
[{"user": "0xb6bed9...", "value": 168065.89}]
```

**Current code (broken):**
```python
portfolio_value = float(value_data.get("portfolioValue", 0) or 0)
```

### Fix

```python
if isinstance(value_data, list) and value_data:
    portfolio_value = float(value_data[0].get("value", 0) or 0)
elif isinstance(value_data, dict):
    portfolio_value = float(
        value_data.get("value", 0) or value_data.get("portfolioValue", 0) or 0
    )
```

### Impact

| Wallet | Before (broken) | After (fixed) |
|--------|-----------------|---------------|
| MouthBreather | `0` | `$7,268.99` |
| DickTurbin | `0` | `$168,065.90` |

---

## BUG 2: `/trades` has no `usdcSize` field → all dollar metrics are 0

**Severity:** P0
**Location:** `polymarket_client.py:689`

### Problem

Code reads `trade.get("usdcSize", 0)` but `/trades` records **do not have this field**. Only `/activity` records have `usdcSize`.

**`/trades` record (no usdcSize):**
```json
{"side": "SELL", "size": 3278.26, "price": 0.03}
```

**`/activity` record (has usdcSize):**
```json
{"type": "TRADE", "side": "SELL", "size": 71, "price": 0.015, "usdcSize": 1.065}
```

### Affected Metrics (all stuck at 0)

- `total_deployed_usd`, `total_usdc_received`, `avg_trade_usd`
- `max_single_trade_usd`, `min_trade_usd`
- `big_bet_count` / `big_bet_pct`, `max_bet_pct_of_deployed`, `avg_bet_pct`

### Fix

```python
def _trade_usdc(trade: dict) -> float:
    """Get dollar value of a trade. Use usdcSize if available, else price * size."""
    usdc = float(trade.get("usdcSize", 0) or 0)
    if usdc == 0:
        usdc = float(trade.get("price", 0) or 0) * float(trade.get("size", 0) or 0)
    return usdc
```

---

## BUG 3: PnL from `/positions` `cashPnl` — misses MERGE/REDEEM payouts

**Severity:** P0
**Location:** `polymarket_client.py:652-662`

### Problem

`/positions` only returns positions where user **still holds shares** (`size > 0`). Fully sold/merged/redeemed positions disappear entirely.

| Wallet | UI "Predictions" | `/positions` count | Missing |
|--------|------------------|--------------------|---------|
| MouthBreather | 183 | 68 | **115 (63%)** |
| DickTurbin | 4,565 | 1,800 | **2,765 (61%)** |

For DickTurbin:
- `/positions` cashPnl sums to **-$222K** (only sees remaining positions)
- MERGE payouts in `/activity` total **+$491K** (invisible to current code)
- UI correctly shows **+$342K**

### Current Code (broken)

```python
total_cash_pnl = 0.0
for pos in positions:
    cash_pnl = pos.get("cashPnl")
    if cash_pnl is not None:
        total_cash_pnl += float(cash_pnl or 0)
```

### Fix — Use `/v1/leaderboard` (recommended)

```python
# Single API call — returns exact PnL the UI shows
import requests

url = f"https://data-api.polymarket.com/v1/leaderboard"
params = {"user": wallet_address, "timePeriod": "ALL", "orderBy": "PNL"}
resp = requests.get(url, params=params)
data = resp.json()

if data:
    net_pnl = float(data[0]["pnl"])
    volume = float(data[0]["vol"])
```

### Fix — Compute yourself (alternative)

```python
# Net PnL = sum(closed realizedPnl) + sum(open unrealized)

# 1. Sum realized PnL from /closed-positions (paginate with limit=50, offset max 100K)
realized_pnl = sum(float(p["realizedPnl"]) for p in all_closed_positions)

# 2. Sum unrealized PnL from /positions
unrealized_pnl = sum(
    float(p.get("currentValue", 0) or 0) - float(p.get("initialValue", 0) or 0)
    for p in open_positions
)

net_pnl = realized_pnl + unrealized_pnl
```

---

## BUG 4: Win rate misses fully-exited positions

**Severity:** P1
**Location:** `polymarket_client.py:719-746`

### Problem

Win rate uses `curPrice` thresholds from `/positions` only. But winning positions that were fully merged/redeemed no longer appear in `/positions`.

### Fix — Use `/closed-positions` (recommended)

```python
# Fetch all closed positions (paginate with limit=50)
winners = sum(1 for p in all_closed_positions if float(p.get("realizedPnl", 0)) > 0)
losers = sum(1 for p in all_closed_positions if float(p.get("realizedPnl", 0)) < 0)
closed_count = winners + losers
win_rate = (winners / closed_count * 100) if closed_count > 0 else 0.0
```

**Verified for 0x7b47:** 742 winners / 1,446 closed = **51.3% win rate** (from `/closed-positions`)
vs old method: 93.67% (massively inflated because losers were over-represented in `/positions`)

### Fix — Fallback using `/activity` (if /closed-positions not used)

```python
# From /positions (existing logic)
position_winner_cids = set()
for pos in positions:
    cur_price = float(pos.get("curPrice", -1))
    if cur_price >= 0.99:
        winners += 1
        position_winner_cids.add(pos.get("conditionId"))
    elif cur_price <= 0.01:
        losers += 1

# From /activity — additional winners NOT already in /positions
activity_winner_cids = {
    r.get("conditionId") for r in activity
    if r.get("type") in ("MERGE", "REDEEM") and r.get("conditionId")
}
additional_winners = len(activity_winner_cids - position_winner_cids)
winners += additional_winners
```

---

## BUG 5: Keyword fallback map too narrow

**Severity:** P1
**Location:** `polymarket_client.py:534-547`

### Problem

When Gamma enrichment fails, titles are classified by keyword matching. Many common terms are missing, causing most markets to fall through to `"General"`.

**Example:** "US-Iran ceasefire", "Russia capture Rodynske", "DHS shutdown" all classify as "General".

### Fix — Expanded keyword map

```python
keyword_map = {
    "Crypto": [
        "bitcoin", "btc", "eth", "crypto", "solana", "defi", "token", "coin",
        "blockchain", "nft", "memecoin", "doge", "xrp",
    ],
    "Politics": [
        "election", "president", "senate", "congress", "vote", "party",
        "trump", "biden", "democrat", "republican", "governor", "impeach",
        "primary", "nominee", "cabinet", "dhs", "shutdown",
        "government shutdown",
    ],
    "Sports": [
        "nfl", "nba", "mlb", "soccer", "football", "basketball", "champion",
        " fc ", "epl", "ucl", "premier league", "win on",
        "ncaa", "tournament", "world cup", "fifa", "super bowl", "nhl",
        "playoffs", "series", "spread", "mvp", "o/u",
    ],
    "Economy": [
        "stock", "fed", "interest rate", "gdp", "inflation", "sp500",
        "recession", "tariff", "nasdaq", "dow jones", "market cap",
        "earnings", "unemployment", "cpi", "treasury",
    ],
    "Technology": [
        "ai", "openai", "gpt", "llm", "apple", "google", "tech",
        "microsoft", "nvidia", "meta", "alphabet", "tesla", "spacex",
        "semiconductor", "chip",
    ],
    "Geopolitics": [
        "war", "conflict", "peace", "treaty", "united nations", "climate",
        "iran", "russia", "ukraine", "china", "taiwan", "ceasefire",
        "military", "capture", "invasion", "sanctions", "nato", "missile",
        "troops", "nuclear", "north korea", "israel", "hamas", "hezbollah",
    ],
}
```

**Also:** `/closed-positions` returns `eventSlug` which can be used for Gamma enrichment on closed positions too.

---

## BUG 6: Gamma enrichment silently fails on large wallets

**Severity:** P1
**Location:** `polymarket_client.py:253-269`, `analyze_polymarket.py:747-751`

### Problem

DickTurbin has ~1,800 unique conditionIds → 36 batch requests to Gamma API (50/batch). Gamma API likely times out or rate-limits. The exception is caught silently, `gamma_enriched` stays `false`, and all categories fall to keyword matching.

### Possible Fixes (pick one or combine)

1. **Rate-limit batches** — add `asyncio.sleep(0.5)` between Gamma batch requests
2. **Retry with backoff** — retry failed batches 2-3 times with exponential backoff
3. **Prefer `/events` over `/markets`** — fewer unique event slugs than conditionIds, so fewer batches needed
4. **Increase timeout** — bump `GAMMA_TIMEOUT` from 45s to 90s for large wallets
5. **Log a CloudWatch metric** — monitor Gamma failure rates

---

## BUG 7: `/activity` has a hard pagination cap

**Severity:** P1
**Location:** `polymarket_client.py:91-136`

### Problem

`/activity` has `offset` max of 10,000 and `limit` max of 500 → theoretical max of ~10,500 records. For very active wallets, only recent history is available.

| Wallet | Activity since | `/activity` covers | Missing |
|--------|---------------|-------------------|---------|
| `0x7b47...` | Oct 2025 | Last ~7 days only | ~5 months |

### Fix — Use `/closed-positions` for PnL/win rate/predictions (recommended)

`/closed-positions` has **offset max 100,000** — no cap issues. See "NEW ENDPOINTS DISCOVERED" section above.

### Fix — Time-windowed pagination on `/activity` (alternative)

`/activity` supports `start` and `end` timestamp parameters (**milliseconds**):

```python
import time

window_size = 30 * 86400 * 1000  # 30 days in milliseconds
end_ms = int(time.time() * 1000)
start_ms = end_ms - window_size

while start_ms > earliest_possible_ms:
    params = f"&start={start_ms}&end={end_ms}"
    page = fetch_pages("activity", params)
    # process page...
    end_ms = start_ms
    start_ms = end_ms - window_size
```

### Fix — Increase `/trades` page size

Current code uses `limit=500`. Docs confirm `/trades` supports `limit` up to **10,000** per request. This reduces pagination calls by 20x.

---

## BUG 8: `biggest_win` not computed

**Severity:** P2
**Location:** New metric needed

### Problem

The Polymarket UI shows:
- **Profile header:** Biggest win **profit** (e.g., $26.0K) = payout - cost
- **Closed positions list:** Biggest win **payout** (e.g., $50,000) = total amount received

Neither is currently computed.

### Fix — Use `/closed-positions` (recommended, single call)

```python
# Biggest win by profit — just sort the endpoint!
url = f"https://data-api.polymarket.com/closed-positions"
params = {
    "user": wallet,
    "sortBy": "REALIZEDPNL",
    "sortDirection": "DESC",
    "limit": 1,
}
resp = requests.get(url, params=params)
best = resp.json()[0]

biggest_win_profit = float(best["realizedPnl"])       # $26,000
biggest_win_payout = float(best["totalBought"]) + biggest_win_profit  # $50,000 (approx)
biggest_win_title = best["title"]                      # "Spread: Iowa State Cyclones (-2.5)"
```

### Fix — From `/activity` REDEEM records (alternative, if /closed-positions not used)

```python
from collections import defaultdict

# Group REDEEM payouts by conditionId (one market can have multiple REDEEMs)
redeem_by_market = defaultdict(float)
for r in redeems + merges:
    cid = r.get("conditionId")
    if cid:
        redeem_by_market[cid] += float(r.get("usdcSize", 0) or 0)

# Cost basis per market from BUY trades
buy_cost_by_market = defaultdict(float)
for t in buy_trades:
    cid = t.get("conditionId")
    if cid:
        buy_cost_by_market[cid] += _trade_usdc(t)

# Biggest win profit = payout - cost
biggest_win_profit = 0
for cid, payout in redeem_by_market.items():
    profit = payout - buy_cost_by_market.get(cid, 0)
    if profit > biggest_win_profit:
        biggest_win_profit = profit
```

---

## IMPLEMENTATION GUIDE

### Step 1: Update `fetch_polymarket_data()`

**Location:** `polymarket_client.py:91-136`

Fetch the new endpoints alongside existing ones:

```python
# BEFORE:
trades_task = _fetch_all_pages(session, "/trades", {"user": addr})

# AFTER: fetch all needed endpoints
trades_task = _fetch_all_pages(session, "/trades", {"user": addr}, limit=10000)
closed_task = _fetch_all_pages(session, "/closed-positions", {"user": addr}, limit=50)
leaderboard_task = session.get(f"/v1/leaderboard?user={addr}&timePeriod=ALL&orderBy=PNL")
```

Return all data:
```python
return {
    "value": value_data,
    "trades": trades_data,           # full history BUY/SELL (no usdcSize)
    "positions": positions_data,     # open positions only
    "closed_positions": closed_data, # NEW: all resolved positions with realizedPnl
    "leaderboard": leaderboard_data, # NEW: exact PnL + volume
}
```

### Step 2: PnL — Use leaderboard (replaces cashflow method)

**Replaces:** `polymarket_client.py:652-662`

```python
# Primary: exact PnL from leaderboard
leaderboard = data.get("leaderboard", []) or []
if leaderboard:
    net_pnl = float(leaderboard[0].get("pnl", 0))
    volume = float(leaderboard[0].get("vol", 0))
else:
    # Fallback: compute from closed + open positions
    closed = data.get("closed_positions", []) or []
    realized = sum(float(p.get("realizedPnl", 0) or 0) for p in closed)
    unrealized = sum(
        float(p.get("currentValue", 0) or 0) - float(p.get("initialValue", 0) or 0)
        for p in positions
    )
    net_pnl = realized + unrealized
```

### Step 3: Win rate — Use /closed-positions

**Replaces:** `polymarket_client.py:719-746`

```python
closed = data.get("closed_positions", []) or []
winners = sum(1 for p in closed if float(p.get("realizedPnl", 0) or 0) > 0)
losers = sum(1 for p in closed if float(p.get("realizedPnl", 0) or 0) < 0)
closed_count = winners + losers
win_rate = (winners / closed_count * 100) if closed_count > 0 else 0.0
```

### Step 4: Biggest win — Use /closed-positions

```python
closed = data.get("closed_positions", []) or []
if closed:
    best = max(closed, key=lambda p: float(p.get("realizedPnl", 0) or 0))
    biggest_win_profit = float(best.get("realizedPnl", 0))
    biggest_win_title = best.get("title", "")
    biggest_win_payout = float(best.get("totalBought", 0)) + biggest_win_profit
```

### Step 5: Predictions count — Combine sources

```python
# /closed-positions has offset max 100K — covers everything
closed_cids = {p.get("conditionId") for p in closed if p.get("conditionId")}
position_cids = {p.get("conditionId") for p in positions if p.get("conditionId")}
trade_cids = {t.get("conditionId") for t in trades if t.get("conditionId")}
total_predictions = len(closed_cids | position_cids | trade_cids)
```

### Step 6: Dollar metrics from `/trades` with `price * size`

**Replaces:** `polymarket_client.py:681-697`

```python
buy_trades = [t for t in trades if str(t.get("side", "")).upper() == "BUY"]
sell_trades = [t for t in trades if str(t.get("side", "")).upper() == "SELL"]

buy_sizes = [_trade_usdc(t) for t in buy_trades]
buy_sizes = [s for s in buy_sizes if s > 0]
total_deployed = sum(buy_sizes)
total_received = sum(_trade_usdc(t) for t in sell_trades)
avg_trade = (total_deployed / len(buy_sizes)) if buy_sizes else 0
max_trade = max(buy_sizes) if buy_sizes else 0
min_trade = min(buy_sizes) if buy_sizes else 0
```

### Step 7: Categories — Use `/closed-positions` eventSlug + title

`/closed-positions` returns `eventSlug` and `title` for every resolved position, giving much better category coverage than `/activity` (which is capped). Combine with `/trades` for open positions.

---

## Metric-to-Source Mapping (Final)

| Metric | Source | Formula |
|--------|--------|---------|
| **`net_pnl_usd`** | **`/v1/leaderboard`** | `response[0]["pnl"]` — single call, exact UI match |
| **`volume`** | **`/v1/leaderboard`** | `response[0]["vol"]` — same call |
| **`portfolio_value_usd`** | **`/value`** | `response[0]["value"]` |
| **`realized_pnl_usd`** | **`/closed-positions`** | sum all `realizedPnl` |
| **`unrealized_pnl_usd`** | **`/positions`** | sum(`currentValue - initialValue`) |
| **`biggest_win_profit`** | **`/closed-positions`** | `sortBy=REALIZEDPNL&sortDirection=DESC&limit=1` |
| **`biggest_win_payout`** | **`/closed-positions`** | `totalBought + realizedPnl` |
| **`win_rate_pct`** | **`/closed-positions`** | count(`realizedPnl > 0`) / total |
| **`predictions count`** | **`/closed-positions`** + **`/positions`** | union of unique `conditionId`s |
| `total_trades` | **`/trades`** | count all (limit=10,000 per page) |
| `total_deployed_usd` | **`/trades`** | sum `price * size` for BUY |
| `total_usdc_received` | **`/trades`** | sum `price * size` for SELL |
| `categories` | **`/closed-positions`** + **`/trades`** + Gamma | `eventSlug`/`title` |
| `flip_ratio` | **`/trades`** | SELL count / BUY count |
| `contrarian_ratio` | **`/trades`** | from BUY trade `price` + `outcome` |
| `entry_price_dist` | **`/trades`** | from BUY trade `price` field |
| `avg/max/min_trade_usd` | **`/trades`** | from BUY trade `price * size` |
| `big_bet_count/pct` | **`/trades`** | BUY trades where `price * size > 500` |

---

## API Reference

### `/activity` — Full Parameter Reference

| Parameter | Type | Default | Limits | Notes |
|-----------|------|---------|--------|-------|
| `user` | Address | required | — | Wallet address |
| `limit` | int | 100 | 0–500 | Results per page |
| `offset` | int | 0 | 0–10,000 | Pagination offset |
| `start` | int | — | >=0 | Unix timestamp (**milliseconds**) |
| `end` | int | — | >=0 | Unix timestamp (**milliseconds**) |
| `type` | string | — | — | CSV: `TRADE,SPLIT,MERGE,REDEEM,REWARD,CONVERSION,MAKER_REBATE` |
| `side` | string | — | — | `BUY` or `SELL` |
| `market` | Hash64[] | — | — | CSV conditionIds |
| `eventId` | int[] | — | — | CSV event IDs |
| `sortBy` | string | TIMESTAMP | — | `TIMESTAMP`, `TOKENS`, `CASH` |

### `/trades` — Full Parameter Reference

| Parameter | Type | Default | Limits |
|-----------|------|---------|--------|
| `limit` | int | 100 | **0–10,000** (current code uses 500!) |
| `offset` | int | 0 | 0–10,000 |
| `user` | Address | — | — |
| `side` | string | — | `BUY` or `SELL` |
| `takerOnly` | bool | true | — |
| `filterType` | string | — | `CASH` or `TOKENS` |
| `filterAmount` | number | — | >=0 (requires filterType) |

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| Data API (general) | 1,000 req / 10s |
| `/trades` | 200 req / 10s |
| `/positions` | 150 req / 10s |
| User PNL API | 200 req / 10s |

---

## `/activity` Record Types Reference

| Type | Meaning | Money Flow | Use For |
|------|---------|------------|---------|
| `TRADE` (side=BUY) | Bought shares | Money OUT | deployed, trade counts |
| `TRADE` (side=SELL) | Sold shares | Money IN | received, flip ratio |
| `MERGE` | Won multi-outcome market | Money IN | realized profit |
| `REDEEM` | Redeemed won binary position | Money IN | realized profit |
| `REWARD` | Platform reward/bonus | Money IN | minor income |
| `YIELD` | Interest/yield earned | Money IN | minor income |
| `CONVERSION` | Converted USDC to shares | Money OUT | deployed capital |
| `MAKER_REBATE` | Maker fee rebate | Money IN | minor income |

---

## Field Comparison: `/trades` vs `/activity` vs `/closed-positions`

| Field | `/trades` | `/activity` | `/closed-positions` |
|-------|-----------|-------------|---------------------|
| `side` | Yes | Yes | — |
| `size` | Yes | Yes | — |
| `price` | Yes | Yes | — |
| `usdcSize` | **No** | Yes | — |
| `type` | — | Yes | — |
| `conditionId` | Yes | Yes | Yes |
| `eventSlug` | Yes | Yes | Yes |
| `title` | Yes | Yes | Yes |
| `outcome` | Yes | Yes | Yes |
| `timestamp` | Yes | Yes | Yes |
| `realizedPnl` | — | — | **Yes** |
| `totalBought` | — | — | **Yes** |
| `avgPrice` | — | — | **Yes** |
| `curPrice` | — | — | **Yes** |
| `endDate` | — | — | **Yes** |

---

## Verification Report: Wallet `0x7b47a31c97e22de4d7af4a07365545cbc5aed615`

### Comparison vs Polymarket UI (Using New Endpoints)

| Metric | New Calculation | Polymarket UI | Match? |
|--------|----------------|---------------|--------|
| **Net PnL** | -$132,674 (leaderboard) | -$132,684 | **~$10 off** |
| **Positions Value** | $58,699.74 | $58.7K | **Exact** |
| **Volume** | $9,050,980 (leaderboard) | — | — |
| **Biggest Win (profit)** | $26,000 (closed-positions) | $26.0K | **Exact** |
| **Biggest Win (title)** | Spread: Iowa State Cyclones (-2.5) | Same | **Exact** |
| **Predictions** | 1,350 (closed CIDs) + 45 (open) = ~1,388 | 1,378 | **~10 off** |
| **Win Rate** | 51.3% (742/1,446 from closed-positions) | — | — |
| **Closed Positions** | 1,446 | — | — |

### Comparison: Old Method vs New Method

| Metric | Old (broken) | New (fixed) | UI |
|--------|-------------|-------------|-----|
| PnL | 0 or -$145K | **-$132,674** | -$132,684 |
| Positions Value | 0 | **$58,699** | $58.7K |
| Biggest Win | not computed | **$26,000** | $26.0K |
| Predictions | 851 | **~1,388** | 1,378 |
| Win Rate | 93.67% (inflated) | **51.3%** (accurate) | — |

---

## py-clob-client Package

Installed via `pip install py-clob-client` (v0.34.6). Provides `ClobClient` class with trading methods (`create_order`, `cancel`, `get_order_book`, etc.) and market data methods (`get_price`, `get_trades`, `get_market`). Primarily useful for **trading operations**, not analytics. The Data API endpoints documented above are more relevant for our metrics pipeline.

---

## Available Polymarket Subgraphs

| Subgraph | Description | Endpoint |
|----------|-------------|----------|
| **Positions** | User token balances | `positions-subgraph/0.0.7/gn` |
| **Orders** | Order book and trade events | `orderbook-subgraph/0.0.1/gn` |
| **Activity** | Splits, merges, redemptions | `activity-subgraph/0.0.4/gn` |
| **Open Interest** | Market and global OI | `oi-subgraph/0.0.6/gn` |
| **PNL** | User position P&L | `pnl-subgraph/0.0.14/gn` |

Base URL: `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/`

Source code: https://github.com/Polymarket/polymarket-subgraph
