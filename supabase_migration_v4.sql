-- =============================================================================
-- MemeNet — Migration v4: Live Price Engine Schema
-- Adds columns needed for CoinGecko/DexScreener price sync.
-- Safe to run multiple times (all ADD COLUMN IF NOT EXISTS).
-- Run in Supabase SQL Editor, then restart the backend.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TOKENS — add price/market data columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS coingecko_url    TEXT,          -- full CoinGecko URL (e.g. https://coingecko.com/en/coins/bitcoin)
  ADD COLUMN IF NOT EXISTS dex_url          TEXT,          -- full DexScreener URL
  ADD COLUMN IF NOT EXISTS market_cap       NUMERIC,       -- market cap in USD (synced from CoinGecko)
  ADD COLUMN IF NOT EXISTS price_usd        NUMERIC,       -- current price in USD
  ADD COLUMN IF NOT EXISTS price_change_24h NUMERIC,       -- 24h price change %
  ADD COLUMN IF NOT EXISTS volume_24h       NUMERIC;       -- 24h volume in USD

-- ---------------------------------------------------------------------------
-- 2. TOKENS — backfill coingecko_id from links JSONB for existing rows
-- (tokens submitted before v4 stored the CoinGecko URL in links.coingecko)
-- This extracts the coin ID using a regex pattern match on the stored URL.
-- ---------------------------------------------------------------------------

UPDATE public.tokens
SET coingecko_id = LOWER(
  REGEXP_REPLACE(
    (links->>'coingecko'),
    '^.*\/coins\/([a-zA-Z0-9][a-zA-Z0-9\-_]*).*$',
    '\1'
  )
)
WHERE
  coingecko_id IS NULL
  AND links->>'coingecko' IS NOT NULL
  AND links->>'coingecko' LIKE '%/coins/%';

-- ---------------------------------------------------------------------------
-- 3. TOKENS — backfill coingecko_url from links JSONB for existing rows
-- ---------------------------------------------------------------------------

UPDATE public.tokens
SET coingecko_url = links->>'coingecko'
WHERE
  coingecko_url IS NULL
  AND links->>'coingecko' IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. TOKENS — backfill dex_url from links JSONB for existing rows
-- ---------------------------------------------------------------------------

UPDATE public.tokens
SET dex_url = links->>'dexscreener'
WHERE
  dex_url IS NULL
  AND links->>'dexscreener' IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. TOKEN_SUBMISSIONS — add coingecko_url + dex_url if missing
-- (older submissions may lack these as top-level columns)
-- ---------------------------------------------------------------------------

ALTER TABLE public.token_submissions
  ADD COLUMN IF NOT EXISTS coingecko_url TEXT,
  ADD COLUMN IF NOT EXISTS dex_url       TEXT;

-- Backfill from existing data where columns exist
UPDATE public.token_submissions
SET coingecko_url = COALESCE(coingecko_url, dexscreener_url)
WHERE coingecko_url IS NULL AND coingecko_url IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Performance indexes for price queries
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_tokens_coingecko_id  ON public.tokens (coingecko_id);
CREATE INDEX IF NOT EXISTS idx_tokens_price_usd     ON public.tokens (price_usd DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_tokens_dominance     ON public.tokens (dominance_score DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- DONE
-- =============================================================================
-- After running this migration:
--   1. Restart the backend: the server will restart automatically due to tsx watch
--   2. The eventEngine will now:
--      a) Resolve coingecko_id from coingecko_url for ALL existing tokens
--      b) Write real prices to price_usd / price_change_24h / volume_24h / market_cap
--   3. RightPanel will show live BTC/ETH prices from /api/market/overview
--   4. TokenCard + Trending will show per-token live prices
--   5. TokenProfile shows live price banner with source attribution
-- =============================================================================
