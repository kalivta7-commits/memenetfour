-- =============================================================================
-- MemeNet — Migration v3: AI Pipeline Schema Alignment
-- Safe to run multiple times (all ADD COLUMN IF NOT EXISTS)
-- Run in Supabase SQL Editor BEFORE restarting the backend
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. POSTS — add AI pipeline columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS event_type       TEXT,
  ADD COLUMN IF NOT EXISTS engagement_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_name       TEXT,
  ADD COLUMN IF NOT EXISTS token_ticker     TEXT,
  ADD COLUMN IF NOT EXISTS token_image      TEXT;

-- ---------------------------------------------------------------------------
-- 2. POSTS — backfill event_type from event_trigger JSONB where possible
-- (event_trigger was the old column storing the whole event object)
-- ---------------------------------------------------------------------------

UPDATE public.posts
  SET event_type = event_trigger->>'type'
  WHERE event_type IS NULL
    AND event_trigger IS NOT NULL
    AND event_trigger->>'type' IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. TOKENS — backfill NULL is_active → true
-- Old rows created before migration v2 may have NULL; treat as active
-- ---------------------------------------------------------------------------

UPDATE public.tokens
  SET is_active = true
  WHERE is_active IS NULL;

-- Ensure future rows default to true
ALTER TABLE public.tokens
  ALTER COLUMN is_active SET DEFAULT true;

-- ---------------------------------------------------------------------------
-- 4. POSTS — performance indexes for feed API
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_posts_engagement_score ON public.posts (engagement_score DESC);
CREATE INDEX IF NOT EXISTS idx_posts_event_type       ON public.posts (event_type);
CREATE INDEX IF NOT EXISTS idx_posts_timestamp_desc   ON public.posts (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_posts_token_id         ON public.posts (token_id);

-- ---------------------------------------------------------------------------
-- 5. POSTS — ensure RLS allows public reads and service-role full access
-- (idempotent — DROP IF EXISTS prevents conflicts)
-- ---------------------------------------------------------------------------

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read posts"              ON public.posts;
DROP POLICY IF EXISTS "Service role full access posts" ON public.posts;

CREATE POLICY "Public read posts"
  ON public.posts FOR SELECT USING (true);

CREATE POLICY "Service role full access posts"
  ON public.posts FOR ALL
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 6. TOKENS — same RLS hardening
-- ---------------------------------------------------------------------------

ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read tokens"              ON public.tokens;
DROP POLICY IF EXISTS "Service role full access tokens" ON public.tokens;

CREATE POLICY "Public read tokens"
  ON public.tokens FOR SELECT USING (true);

CREATE POLICY "Service role full access tokens"
  ON public.tokens FOR ALL
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- DONE
-- =============================================================================
-- After running:
--   1. Restart the backend: npm run dev
--   2. Posts now store: event_type, engagement_score, token_name, token_ticker, token_image
--   3. All NULL is_active tokens are now treated as active
--   4. Feed API sorts by engagement_score DESC correctly
-- =============================================================================
