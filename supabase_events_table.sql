-- =============================================================================
-- MemeNet — Events Table Migration
-- Safe to run multiple times (IF NOT EXISTS guards)
-- Run in Supabase SQL Editor BEFORE restarting the backend
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CREATE events table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id    UUID        REFERENCES public.tokens(id) ON DELETE SET NULL,
  type        TEXT        NOT NULL,
  score       INTEGER     NOT NULL DEFAULT 0,
  data        JSONB,
  title       TEXT,
  content     TEXT,
  source      TEXT        DEFAULT 'system',
  processed   BOOLEAN     NOT NULL DEFAULT false,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. Indexes for fast API queries
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_events_created_at   ON public.events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_score        ON public.events (score DESC);
CREATE INDEX IF NOT EXISTS idx_events_token_id     ON public.events (token_id);
CREATE INDEX IF NOT EXISTS idx_events_type         ON public.events (type);
CREATE INDEX IF NOT EXISTS idx_events_processed    ON public.events (processed);
CREATE INDEX IF NOT EXISTS idx_events_timestamp    ON public.events (timestamp DESC);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security — public reads, service role full access
-- ---------------------------------------------------------------------------

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read events"              ON public.events;
DROP POLICY IF EXISTS "Service role full access events" ON public.events;

CREATE POLICY "Public read events"
  ON public.events FOR SELECT USING (true);

CREATE POLICY "Service role full access events"
  ON public.events FOR ALL
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- DONE
-- =============================================================================
-- After running:
--   1. Restart the backend: npm run dev
--   2. The events table now exists with proper indexes and RLS
--   3. /api/events will return the latest 30 events with token info
-- =============================================================================
