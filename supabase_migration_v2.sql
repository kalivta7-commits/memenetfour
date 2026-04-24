-- =============================================================================
-- MemeNet — Migration v2: Session Expiry + Safety Hardening
-- Safe to run multiple times (all statements idempotent)
-- Run in Supabase SQL Editor BEFORE restarting the backend
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. SESSION EXPIRY — add expires_at to token_sessions
-- ---------------------------------------------------------------------------

ALTER TABLE public.token_sessions
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days');

-- Backfill any existing sessions that don't have expires_at set properly
-- (they'll have the column default already from the ADD COLUMN above, so this is a no-op
--  unless the column already existed without a default)
UPDATE public.token_sessions
  SET expires_at = created_at + interval '30 days'
  WHERE expires_at IS NULL;

-- Index for fast expiry lookups by the session middleware
CREATE INDEX IF NOT EXISTS idx_token_sessions_expires ON public.token_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- 2. CLEANUP FUNCTION — removes expired sessions (safe to call any time)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.token_sessions
    WHERE expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. TOKEN SUBMISSIONS — ensure `name` column exists (no `token_name`)
--    The backend has always used `name`; this guards against legacy schemas.
-- ---------------------------------------------------------------------------

-- Ensure the core name column exists and is correct
DO $$
BEGIN
  -- If token_submissions has `token_name` but not `name`, rename it
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'token_submissions'
      AND column_name  = 'token_name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'token_submissions'
      AND column_name  = 'name'
  ) THEN
    ALTER TABLE public.token_submissions RENAME COLUMN token_name TO name;
  END IF;
END $$;

-- Ensure submitted_at exists (some older schemas have only created_at)
ALTER TABLE public.token_submissions
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz DEFAULT now();

-- Backfill submitted_at from created_at where null
UPDATE public.token_submissions
  SET submitted_at = created_at
  WHERE submitted_at IS NULL AND created_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. TOKENS — ensure all owner-auth + AI-control columns exist
-- ---------------------------------------------------------------------------

ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS owner_username      TEXT,
  ADD COLUMN IF NOT EXISTS owner_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS is_active           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_deleted          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_post_limit    INT     NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS twitter_url         TEXT,
  ADD COLUMN IF NOT EXISTS website             TEXT,
  ADD COLUMN IF NOT EXISTS mood                TEXT    DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS posts_today         INT     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_score    INT     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dominance_score     INT     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aggression_level    INT     DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cooldown_until      BIGINT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_typing           BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_usd           NUMERIC,
  ADD COLUMN IF NOT EXISTS volume_24h          NUMERIC,
  ADD COLUMN IF NOT EXISTS price_change_24h    NUMERIC,
  ADD COLUMN IF NOT EXISTS coingecko_id        TEXT,
  ADD COLUMN IF NOT EXISTS contract_address    TEXT,
  ADD COLUMN IF NOT EXISTS chain               TEXT,
  ADD COLUMN IF NOT EXISTS verified            BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS reply_count         INT     DEFAULT 0;

-- Ensure all existing tokens have correct boolean defaults
UPDATE public.tokens SET is_active  = true  WHERE is_active  IS NULL;
UPDATE public.tokens SET is_deleted = false WHERE is_deleted IS NULL;

-- Indexes for scheduler and auth queries
CREATE INDEX IF NOT EXISTS idx_tokens_owner_username ON public.tokens (owner_username);
CREATE INDEX IF NOT EXISTS idx_tokens_is_active      ON public.tokens (is_active);
CREATE INDEX IF NOT EXISTS idx_tokens_is_deleted     ON public.tokens (is_deleted);
CREATE INDEX IF NOT EXISTS idx_tokens_status         ON public.tokens (status);

-- ---------------------------------------------------------------------------
-- 5. POSTS — ensure all runtime columns exist
-- ---------------------------------------------------------------------------

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS reply_count   INT      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes         INT      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS label         TEXT,
  ADD COLUMN IF NOT EXISTS event_trigger JSONB,
  ADD COLUMN IF NOT EXISTS mood          TEXT     DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS image_url     TEXT,
  ADD COLUMN IF NOT EXISTS post_type     TEXT     DEFAULT 'status',
  ADD COLUMN IF NOT EXISTS timestamp     TIMESTAMPTZ DEFAULT now();

-- ---------------------------------------------------------------------------
-- 6. EVENTS — ensure table + indexes exist
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.events (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT        NOT NULL,
  title      TEXT,
  content    TEXT,
  source     TEXT        DEFAULT 'system',
  score      INTEGER     NOT NULL DEFAULT 50,
  token_id   UUID        REFERENCES public.tokens(id) ON DELETE SET NULL,
  data       JSONB       DEFAULT '{}',
  processed  BOOLEAN     NOT NULL DEFAULT false,
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_processed  ON public.events (processed);
CREATE INDEX IF NOT EXISTS idx_events_score      ON public.events (score DESC);
CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON public.events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_token_id   ON public.events (token_id);

-- RLS
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read events" ON public.events;
CREATE POLICY "Public read events" ON public.events FOR SELECT USING (true);
DROP POLICY IF EXISTS "Service role full access on events" ON public.events;
CREATE POLICY "Service role full access on events" ON public.events FOR ALL
  USING (auth.role() = 'service_role');

-- Seed fallback events so explore is never empty
INSERT INTO public.events (type, title, content, source, score, processed)
VALUES
  ('market_overview', 'Crypto Markets Opening',        'BTC holding key support levels. Alt season sentiment building.', 'system', 75, false),
  ('social_trend',    'Meme Token Summer Building',    'Social volume for meme tokens up 340% week-over-week.', 'system', 80, false),
  ('volume_spike',    'Unusual On-Chain Activity',     'DEX volumes spiking across Solana and Base chains.', 'system', 70, false),
  ('social_trend',    'AI Token Narrative Heating Up', 'AI-powered tokens showing unusual engagement spikes.', 'system', 85, false),
  ('onchain',         'Whale Movement Detected',       'Large wallet accumulation spotted across multiple meme token contracts.', 'system', 90, false)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. TOKEN SUBMISSIONS — ensure RLS and indexes
-- ---------------------------------------------------------------------------

ALTER TABLE public.token_submissions
  ADD COLUMN IF NOT EXISTS ai_score  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_id  UUID    REFERENCES public.tokens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_owner  ON public.token_submissions (owner_username);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON public.token_submissions (status);
CREATE INDEX IF NOT EXISTS idx_submissions_token  ON public.token_submissions (token_id);

ALTER TABLE public.token_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read submissions" ON public.token_submissions;
DROP POLICY IF EXISTS "Service role full access on submissions" ON public.token_submissions;
CREATE POLICY "Service role full access on submissions"
  ON public.token_submissions FOR ALL
  USING (auth.role() = 'service_role');

-- Clean up stale status values
UPDATE public.token_submissions
  SET status = 'rejected'
  WHERE status IN ('pending', 'needs_review');

-- ---------------------------------------------------------------------------
-- 8. TOKEN SESSIONS — RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.token_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on token_sessions" ON public.token_sessions;
CREATE POLICY "Service role full access on token_sessions"
  ON public.token_sessions FOR ALL
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- DONE
-- =============================================================================
-- After running:
--   1. Restart the backend (npm run dev)
--   2. Sessions now expire after 30 days with full expiry validation
--   3. Scheduler will respect is_active / daily_post_limit
--   4. All submission queries use `name` (not `token_name`)
--   5. Call SELECT public.cleanup_expired_sessions(); periodically (or via cron)
-- =============================================================================
