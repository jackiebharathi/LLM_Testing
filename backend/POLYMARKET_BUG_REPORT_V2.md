# Polymarket Agent — Bug Report V2

**Date:** 2026-03-24
**Affected Files:**
- `coin-fantasy-be/src/shared/polymarket_client.py`
- `coin-fantasy-be/src/lambdas/agents/analyze_polymarket.py`
- `cfai-frontend/src/lib/ai/agent-personality.ts`
- `cfai-frontend/src/lib/ai/prediction-system-prompt-builder.ts`

**Verified Against:**
- Polymarket UI screenshot for `0x94885a3566cd74f28e0346F22a4Bf002046aD531`
- Live API calls to `/trades`, `/value`, `/v1/leaderboard`, `/positions`, `/closed-positions`

**Previously Fixed (Bugs 1–3):** `/value` parser, `/trades` usdcSize fallback, PnL via leaderboard + closed-positions — all verified working.

---

## Summary Table

| # | Bug | Severity | Status | File : Lines |
|---|-----|----------|--------|--------------|
| 4 | Win rate uses `curPrice` threshold — excludes ~45% of closed positions | **P1** | PARTIAL | `polymarket_client.py:826-839` |
| 5 | Keyword map too narrow → "General" dominates | **P1** | NOT FIXED | `polymarket_client.py:579-587` |
| 6 | Gamma enrichment silently fails on large wallets | **P1** | NOT FIXED | `polymarket_client.py:376-377` |
| 7 | `/trades` page size still 500, not 10K | **P2** | MITIGATED | `polymarket_client.py:58` |
| 8 | `biggest_win` not computed (`max_single_trade_usd` is NOT the same) | **P2** | NOT FIXED | New code needed |
| 9 | `trader_era` based on trade count, not wallet age | **P1** | NEW | `analyze_polymarket.py:284` |
| 10 | Frontend archetype names don't match backend — voice examples are dead code | **P1** | NEW | `prediction-system-prompt-builder.ts:201-231` |
| 11 | `personality_traits` type mismatch: backend dict vs frontend string[] | **P2** | NEW (latent) | `agent-personality.ts:42` |
| 12 | Gemini tag values never validated against allowed set | **P2** | NEW | `analyze_polymarket.py:608-616` |
| 13 | `predictions` count not computed (UI shows 171, we store nothing) | **P2** | NEW | Not implemented |
| 14 | `90d` and `all_time` metrics are identical copies | **P2** | NEW | `analyze_polymarket.py:1141-1142` |

---

## Verified Against Polymarket UI — Wallet `0x9488...`

| Metric | Polymarket UI | API (live) | Stored in Agent | Match? |
|--------|---------------|------------|-----------------|--------|
| **PnL (All-Time)** | $41,689.18 | $41,689.18 | `overall_pnl`: $41,689.18 | **Exact** |
| **Positions Value** | $76.7K | $76,749.01 | $77,455.34 | **~$700 drift** (OK) |
| **Biggest Win** | $23.8K | $23,824.71 | **NOT STORED** | **Bug 8** |
| **Predictions** | 171 | ~166 closed + 23 open | No unified count | **Bug 13** |
| **Joined** | Feb 2026 | First trade: 2025-12-30 | `trader_era`: "Market Veteran" | **Bug 9** |

---

## BUG 4: Win rate excludes ~45% of closed positions — PARTIAL FIX

**Severity:** P1
**File:** `polymarket_client.py:826-839`

### Problem

Code uses `curPrice >= 0.99` (winner) and `curPrice <= 0.01` (loser). Positions with mid-range `curPrice` (user exited early, or market still resolving) are **excluded entirely** — even though they have definitive `realizedPnl`.

### Verified: 45% Excluded

| Source | curPrice >= 0.99 | curPrice <= 0.01 | Mid-range (EXCLUDED) | Total |
|--------|-----------------|-----------------|---------------------|-------|
| `/positions` | 0 | 9 | 14 | 23 |
| `/closed-positions` p1 | 71 | 0 | 29 | 100 |
| `/closed-positions` p2 | 4 | 2 | 44 | 50 |
| `/closed-positions` p3 | 2 | 15 | 1 | 16 |
| **Total** | **77** | **26** | **88** | **189** |

**88 positions (46%) have no win/loss classification.** Stored win rate (58.9%) is also unstable — doesn't match live recount (74.8%) because curPrice shifts over time.

| Method | Winners | Losers | Counted | Win Rate |
|--------|---------|--------|---------|----------|
| Stored (curPrice at analysis time) | 96 | 67 | 163 | 58.9% |
| curPrice (live recount) | ~77 | ~26 | ~103 | ~74.8% |
| **realizedPnl (recommended)** | **100** | **66** | **166** | **60.2%** |

### Fix

```python
# /positions: keep curPrice method for OPEN positions (no realizedPnl yet)
for pos in positions:
    cur_price = float(pos.get("curPrice", -1))
    if cur_price >= 0.99:
        winners += 1
    elif cur_price <= 0.01:
        losers += 1

# /closed-positions: use realizedPnl (definitive, covers ALL closed positions)
for pos in closed_positions:
    r_pnl = float(pos.get("realizedPnl", 0) or 0)
    if r_pnl > 0:
        winners += 1
    elif r_pnl < 0:
        losers += 1
```

---

## BUG 5: Keyword map too narrow — NOT FIXED

**Severity:** P1
**File:** `polymarket_client.py:579-587`

### Problem

When Gamma enrichment fails (`gamma_enriched: false`), all classification uses keyword matching. Current 46 keywords miss many common terms. For wallet `0x9488...`, 18.1% fell to "General".

### Verified: Misclassified Markets

| Title from API | Stored | Correct | Why |
|----------------|--------|---------|-----|
| "US forces enter Iran by March 31?" | General | Geopolitics | "iran" missing |
| "US x Iran ceasefire by March 31?" | General | Geopolitics | "ceasefire" missing |
| "Kharg Island (March 31)" | General | Geopolitics | No keyword match |
| "Strait of Hormuz Normal" | General | Geopolitics | "hormuz" missing |
| "Iran leadership change" | General | Geopolitics | "iran" missing |

### Fix — Replace `keyword_map` (46 → 105 keywords)

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

---

## BUG 6: Gamma enrichment silently fails — NOT FIXED

**Severity:** P1
**File:** `polymarket_client.py:376-377`

### Problem

All Gamma batches fire concurrently with no rate limiting. For wallet `0x9488...`, `gamma_enriched: false` — everything fell to keyword fallback.

```python
# Current: all concurrent, no delay
batch_tasks = [_fetch_gamma_batch(session, batch) for batch in batches]
batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
```

### Fix

1. Add `asyncio.sleep(0.5)` between Gamma batch requests
2. Retry failed batches 2-3 times with exponential backoff
3. Increase `GAMMA_TIMEOUT` from 45s to 90s
4. Log CloudWatch metric on Gamma failure rate

---

## BUG 7: `/trades` page size still 500 — MITIGATED

**Severity:** P2
**File:** `polymarket_client.py:58`

`/activity` is no longer used (good), but `/trades` still uses `PAGE_SIZE = 500` instead of documented max 10,000. This means 20x more API calls.

```python
# Current
PAGE_SIZE = 500
MAX_PAGES = 20  # cap: 10,000 trades

# Fix
PAGE_SIZE = 10000
MAX_PAGES = 10  # cap: 100,000 trades
```

---

## BUG 8: `biggest_win` not computed — NOT FIXED

**Severity:** P2
**Files:** `polymarket_client.py`, `analyze_polymarket.py`

### Problem

UI shows "Biggest Win: $23.8K". We store nothing. **`max_single_trade_usd` ($26,250) is NOT biggest win** — it's the cost of the largest single BUY trade.

| Field | Value | What It Measures |
|-------|-------|------------------|
| `max_single_trade_usd` | $26,250 | Largest BUY trade cost (`price × size`) |
| **Biggest Win** (UI) | **$23,824.71** | Net profit on best resolved position |

A $26K bet can lose everything. A $2.7K bet can profit $23.8K. These are completely different metrics.

### Verified

```
GET /closed-positions?sortBy=REALIZEDPNL&sortDirection=DESC&limit=1
→ realizedPnl: $23,824.71
  title: "Will the US next strike Iran on February 28, 2026 (ET)?"
  totalBought: $26,672.61
  avgPrice: 0.1037 (bought at ~10¢, resolved YES)
```

### Fix — Add to `compute_prediction_metrics()` after line 968

```python
biggest_win_profit = 0.0
biggest_win_title = ""
biggest_win_payout = 0.0
if closed_positions:
    best = max(closed_positions, key=lambda p: float(p.get("realizedPnl", 0) or 0))
    best_pnl = float(best.get("realizedPnl", 0) or 0)
    if best_pnl > 0:
        biggest_win_profit = round(best_pnl, 4)
        biggest_win_title = best.get("title", "")
        biggest_win_payout = round(float(best.get("totalBought", 0) or 0) + best_pnl, 4)
```

Add to return dict and `polymarket_metrics` in `analyze_polymarket.py`:
```python
"biggest_win_profit": biggest_win_profit,
"biggest_win_title": biggest_win_title,
"biggest_win_payout": biggest_win_payout,
```

No new API calls — `/closed-positions` already fetched.

---

## BUG 9: `trader_era` based on trade count, not wallet age — NEW

**Severity:** P1
**File:** `analyze_polymarket.py:267, 284`

### Problem

Gemini prompt hint:
```
total_trades <20 → Fresh Account; <100 → Active Participant; >500 → Market Veteran or Polymarket OG
```

No timestamp data is passed. No wallet age computed.

### Verified: 84-Day Wallet Tagged "Market Veteran"

| Fact | Value |
|------|-------|
| First trade (API) | 2025-12-30 (timestamp `1767057227`) |
| Analysis date | 2026-03-24 |
| **Wallet age** | **84 days (~2.8 months)** |
| UI "Joined" | Feb 2026 |
| Total trades | 520 |
| **Stored `trader_era`** | **"Market Veteran"** |

### Cascading Impact

`trader_era` gates archetypes:
- "The Oracle" requires `trader_era in ("Market Veteran", "Polymarket OG")` — line 322
- "The Specialist" requires `trader_era in ("Seasoned Forecaster", "Market Veteran", "Polymarket OG")` — line 346

This wallet got "The Specialist" because of wrong `trader_era`. With correct "Active Participant", it would fail the Specialist check → different archetype.

### Additional: Hint gap at 100–500 trades (no mapping → Gemini guesses)

### Fix — Compute wallet age in `compute_prediction_metrics()`

```python
all_timestamps = []
for t in trades:
    ts = t.get("timestamp")
    if ts:
        try: all_timestamps.append(float(ts))
        except (TypeError, ValueError): pass
for p in closed_positions:
    ts = p.get("timestamp")
    if ts:
        try: all_timestamps.append(float(ts))
        except (TypeError, ValueError): pass

first_trade_ts = min(all_timestamps) if all_timestamps else None
if first_trade_ts:
    first_trade_date = datetime.fromtimestamp(first_trade_ts, tz=timezone.utc)
    wallet_age_days = (datetime.now(timezone.utc) - first_trade_date).days
else:
    first_trade_date = None
    wallet_age_days = 0
```

Add to return dict:
```python
"wallet_age_days": wallet_age_days,
"first_trade_date": first_trade_date.isoformat() if first_trade_date else None,
```

Add to Gemini prompt:
```
- First trade: {first_trade_date} ({wallet_age_days} days ago)
```

Updated hint:
```
- wallet_age_days <30 AND total_trades <20 → Fresh Account
- wallet_age_days <90 OR total_trades <100 → Active Participant
- wallet_age_days <365 OR total_trades <500 → Seasoned Forecaster
- wallet_age_days >=365 AND total_trades >=500 → Market Veteran
- wallet_age_days >=730 AND total_trades >=1000 → Polymarket OG
```

---

## BUG 10: Frontend archetype names don't match backend — NEW

**Severity:** P1
**Files:** Backend `analyze_polymarket.py:300-371`, Frontend `prediction-system-prompt-builder.ts:201-231`

### Problem

Backend produces:
```
The Oracle, The Whale, The Analyst, The Degen,
The Specialist, The Flipper, The Diamond Hand
```

Frontend has example responses for:
```
Stoic Guardian, Chaotic Trickster, Strategic Analyst, Alpha Predator,
Explorer Nomad, Veteran Oracle, Quiet Observer, Yield Hunter
```

**Zero overlap.** Every `examples[archetype]` lookup misses → all prediction agents get generic default voice.

### Fix (Option A — update frontend)

```typescript
const examples: Record<string, string> = {
    'The Oracle': `Seen this pattern before ...`,
    'The Whale': `Already saw this one coming ...`,
    'The Analyst': `Running analysis... ...`,
    'The Degen': `okay running the numbers ...`,
    'The Specialist': `Checking the signals... ...`,
    'The Flipper': `Oh this one's interesting! ...`,
    'The Diamond Hand': `Waiting for the late-stage signal ...`,
};
```

---

## BUG 11: `personality_traits` type mismatch — NEW (Latent)

**Severity:** P2
**File:** `agent-personality.ts:42`

Backend stores `personality_traits` as **dict**: `{"market_focus": "Crypto Prophet", ...}`
Frontend types it as **string[]**: `personality_traits: string[]`

Trading prompt calls `personality_traits.join(", ")` → would produce `"[object Object]"` on a dict.

**Works by accident** — prediction prompt builder never calls `.join()`. Breaks if code paths merge.

### Fix

```typescript
// In normalizeAgentContext():
const traits = Array.isArray(raw.personality_traits)
    ? raw.personality_traits
    : Object.values(raw.personality_traits || {});
```

---

## BUG 12: Gemini tag values never validated — NEW

**Severity:** P2
**File:** `analyze_polymarket.py:608-616`

Gemini is prompted with allowed values but response is never checked. Hallucinated value (e.g., "High-Volume Trader") → every `_derive_archetype()` check misses → silent fallback to "The Oracle".

### Fix

```python
ALLOWED_TAGS = {
    "market_focus": {"Politics Oracle", "Crypto Prophet", "Sports Pundit", "Macro Analyst",
                     "Geo Hawk", "Elections Specialist", "Science Forecaster", "Generalist"},
    "betting_style": {"Conviction Whale", "Scatter Bettor", "Sniper", "Portfolio Balancer",
                      "Last-Minute Larry", "Early Mover"},
    "risk_profile": {"YOLO Caller", "Degen Plunger", "Calculated Risk-Taker",
                     "Bankroll Manager", "Conservative Forecaster"},
    "timing_pattern": {"Extreme Contrarian", "Contrarian Entry", "Early Mover",
                       "Momentum Follower", "Consensus Rider", "News Reactor", "Market Maker"},
    "accuracy_signal": {"Sharp Predictor", "Lucky Guesser", "Overcautious", "Overconfident",
                        "Bag Holder", "Exit Expert", "Diamond Resolver"},
    "trader_era": {"Fresh Account", "Active Participant", "Seasoned Forecaster",
                   "Market Veteran", "Polymarket OG"},
}

for key in ALLOWED_TAGS:
    val = parsed.pop(key, DEFAULTS[key])
    if val not in ALLOWED_TAGS[key]:
        logger.warning("Gemini returned invalid %s: '%s', defaulting to '%s'", key, val, DEFAULTS[key])
        val = DEFAULTS[key]
    personality_traits_dict[key] = val
```

---

## BUG 13: `predictions` count not computed — NEW

**Severity:** P2

UI shows "171 Predictions". We have no equivalent metric.

### Fix

```python
closed_cids = {p.get("conditionId") for p in closed_positions if p.get("conditionId")}
position_cids = {p.get("conditionId") for p in positions if p.get("conditionId")}
trade_cids = {t.get("conditionId") for t in trades if t.get("conditionId")}
total_predictions = len(closed_cids | position_cids | trade_cids)
```

---
