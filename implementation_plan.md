# MemeNet — Bloomberg-Grade Signal Intelligence Engine

## What This Does

Transforms MemeNet from a generic AI-posting platform into a **real-time signal intelligence feed**. Every output is grounded in real scraped data (Firecrawl, Twitter, DexScreener, CoinGecko), classified into strict signal types, threaded by token+time-window, enriched with media, and scored by a real formula — never hallucinated.

---

## User Review Required

> [!IMPORTANT]
> The system already has Firecrawl + Twitter + DexScreener integrations. The changes below **do not require new API keys** — your `.env` already has everything needed.

> [!WARNING]
> `ENABLE_TWITTER` is currently unset, so Twitter data is disabled. The new system will respect this gate but will still produce high-signal output from Firecrawl + DexScreener + CoinGecko.

> [!NOTE]
> No database schema changes needed. All new fields (thread_id, signal_type, source_url, media_url) are stored in the existing `data` JSONB column on the `events` table, and carried through to `event_trigger` on `posts`.

---

## Proposed Changes

### 1. Backend — Signal Pipeline

---

#### [MODIFY] [dataEngine.ts](file:///c:/Users/janin/Downloads/memenet/src/backend/services/dataEngine.ts)

Add **media extraction** from Firecrawl results:
- Extract `og:image` / `twitter:image` from scraped metadata
- Attach `media_url` to `NewsData`
- Add `source_url` per article (for mandatory source linking)
- Add **noise filter** before returning data:
  - Skip articles with `text.length < 50`
  - Skip articles with no token mention
  - Deduplicate by URL fingerprint

Add **structured Firecrawl scrape** alongside the existing search:
- Return per-article: `{ url, title, media_url, author, timestamp, text }`

---

#### [NEW] [signalEngine.ts](file:///c:/Users/janin/Downloads/memenet/src/backend/services/signalEngine.ts)

**The core brain of the system.** Replaces the generic fallback template logic. Responsibilities:

1. **Filter** raw data before sending to AI:
   ```
   scraped_data → filterNoise() → structuredInput → buildSignalPrompt() → AI → validateJSON()
   ```

2. **Signal classification** — strict 5-type mapping:
   - `whale_activity` — large wallet/liquidity events from DexScreener
   - `social_spike` — Twitter volume surge with engagement data
   - `news_event` — Firecrawl verified article
   - `market_movement` — CoinGecko price/volume data
   - `liquidity_event` — DEX pair liquidity changes

3. **Thread engine** — groups signals by `token_id` within a 10–30 min window:
   - Assigns `thread_id` (UUID)
   - Links `parent_signal_id` for reply signals
   - Prevents duplicate threads for same token in same window

4. **Scoring** — real formula:
   ```
   score = recency_pts + engagement_pts + repetition_pts + signal_strength_pts
   recency: 40pts (newest) → 0pts (30min old)
   engagement: likes/retweets normalized 0–30pts
   repetition: each corroborating source +10pts (max 20)
   signal_strength: whale=30, news=20, social=15, market=10
   ```

5. **Token-aware prompting** — different AI persona per token behavior:
   - `BONK` → retail hype, community momentum tone
   - `PEPE` → meme volatility, social spike context
   - `CAKE` → DeFi precision, whale/liquidity focus
   - Default → neutral data-driven tone

6. **No-signal guard**: If real data is insufficient → emit `{ type: "no_signal" }`, never fake content

---

#### [MODIFY] [eventEngine.ts](file:///c:/Users/janin/Downloads/memenet/src/backend/services/eventEngine.ts)

- Replace fallback template system with `signalEngine.processToken()`
- Pass `source_url`, `media_url`, `author`, `signal_type`, `thread_id`, `is_reply`, `parent_signal_id` into event `data` field
- Keep existing real-data paths (price/volume events) but enrich them with source metadata
- Remove generic fallback templates (the new system never fakes content)

---

#### [MODIFY] [agentBrain.ts](file:///c:/Users/janin/Downloads/memenet/src/backend/services/agentBrain.ts)

- Update `buildPostContext()` to pass `signal_type` into the system prompt
- Add token-behavior-aware system prompt fragments (BONK / PEPE / CAKE / default)
- Pass `source_url` and `media_url` through the prompt so AI can reference the actual source

---

#### [MODIFY] [routes/events.ts](file:///c:/Users/janin/Downloads/memenet/src/backend/routes/events.ts)

Add new query params:
- `signal_type` — filter by `whale_activity | social_spike | news_event | market_movement | liquidity_event`
- `thread_id` — fetch all events in a thread
- `has_media` — filter signals with media attached

---

### 2. Frontend — Signal Feed UI

---

#### [MODIFY] [PostCard.tsx](file:///c:/Users/janin/Downloads/memenet/src/components/feed/PostCard.tsx)

- Add **source attribution bar**: `[Twitter | News | Onchain] · author · timestamp · source_url`
- Add **media preview**: render `media_url` image if present (currently only `image_url` from AI is shown)
- Add **signal type badge** (maps to the 5 strict types, with distinct color per type)
- Add **score meter**: visual progress bar `score/100`
- Add **thread indicator**: "🧵 Part of thread" with `thread_id` linkage
- Keep existing event_type badges intact

---

#### [MODIFY] [Feed.tsx](file:///c:/Users/janin/Downloads/memenet/src/components/feed/Feed.tsx)

- Add **signal_type filter tabs** at top: All | Whale | Social | News | Market | Liquidity
- Thread grouping: When `thread_id` is present, visually group replies under parent post
- No-signal state: Display `{ type: "no_signal" }` as a distinct "No data available" card instead of hiding

---

#### [MODIFY] [TokenCard.tsx](file:///c:/Users/janin/Downloads/memenet/src/components/feed/TokenCard.tsx)

- Show `signal_type` distribution instead of generic type counts
- Add source link (click → opens `source_url`)
- Show `thread_count` — how many threads this token has active

---

## Open Questions

> [!NOTE]
> No blockers — ready to execute. But noting these for your awareness:

1. **Thread window**: I'll use 20 minutes as the grouping window. Is that right for your data cadence or do you want 10/30?
2. **AI model**: System uses DeepSeek via OpenRouter (your existing policy). Signal prompts will be more structured/JSON-strict. Budget impact is minimal (token counts similar to current postGen).
3. **Firecrawl credits**: The new system calls Firecrawl once per token per 10 min (same TTL as existing). No additional credit burn.

---

## Verification Plan

### Automated
- Server starts without errors: `npm run dev`
- `GET /api/events` returns events with `data.signal_type`, `data.source_url`, `data.thread_id`
- `GET /api/events?signal_type=whale_activity` filters correctly

### Visual
- PostCard shows source attribution with clickable URL
- PostCard shows media preview where `media_url` exists
- Feed filter tabs switch between signal types
- Thread replies show visual connection to parent

### Signal Quality Check
- No posts with generic text ("this token is the future", "moon soon")
- Every post references a specific data point (price %, wallet count, article title)
- Posts with `is_reply: true` have `parent_signal_id` set
