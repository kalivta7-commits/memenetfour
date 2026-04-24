-- =============================================================================
-- MemeNet — Complete Database Migration
-- Run this in your Supabase SQL Editor
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. EVENTS TABLE (core fix)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL,                   -- price_pump, price_dump, volume_spike, etc.
  title         text,                            -- human-readable title
  content       text,                            -- detailed description
  source        text DEFAULT 'system',           -- coingecko | dexscreener | system | fallback
  score         integer NOT NULL DEFAULT 50,     -- importance 0-100
  token_id      uuid REFERENCES public.tokens(id) ON DELETE SET NULL,
  data          jsonb DEFAULT '{}',              -- raw event payload
  processed     boolean NOT NULL DEFAULT false,
  timestamp     timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_events_processed     ON public.events (processed);
CREATE INDEX IF NOT EXISTS idx_events_score         ON public.events (score DESC);
CREATE INDEX IF NOT EXISTS idx_events_timestamp     ON public.events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_token_id      ON public.events (token_id);
CREATE INDEX IF NOT EXISTS idx_events_type          ON public.events (type);

-- RLS: read-only for anon, full access for service role
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read events" ON public.events;
CREATE POLICY "Public read events"
  ON public.events FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role full access on events" ON public.events;
CREATE POLICY "Service role full access on events"
  ON public.events FOR ALL
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 2. EXTEND TOKENS TABLE (safe: adds columns if they don't exist)
-- ---------------------------------------------------------------------------

ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS dominance_score    integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_score   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aggression_level   integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS posts_today        integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cooldown_until     bigint  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_typing          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_usd          numeric,
  ADD COLUMN IF NOT EXISTS volume_24h         numeric,
  ADD COLUMN IF NOT EXISTS price_change_24h   numeric,
  ADD COLUMN IF NOT EXISTS coingecko_id       text,
  ADD COLUMN IF NOT EXISTS contract_address   text,
  ADD COLUMN IF NOT EXISTS chain              text,
  ADD COLUMN IF NOT EXISTS mood               text DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS verified           boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS reply_count        integer DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3. EXTEND POSTS TABLE (safe additions)
-- ---------------------------------------------------------------------------

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS reply_count   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes         integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS label         text,
  ADD COLUMN IF NOT EXISTS event_trigger jsonb,
  ADD COLUMN IF NOT EXISTS mood          text DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS image_url     text,
  ADD COLUMN IF NOT EXISTS post_type     text DEFAULT 'status',
  ADD COLUMN IF NOT EXISTS timestamp     timestamptz DEFAULT now();

-- ---------------------------------------------------------------------------
-- 4. SEED FALLBACK EVENTS (so explore page is never empty)
-- ---------------------------------------------------------------------------

INSERT INTO public.events (type, title, content, source, score, processed)
VALUES
  ('market_overview',   'Crypto Markets Opening',          'BTC holding key support levels. Alt season sentiment building in DeFi and meme token sectors.', 'system', 75, false),
  ('social_trend',      'Meme Token Summer Building',      'Social volume for meme tokens up 340% week-over-week. AI-native tokens leading narrative.', 'system', 80, false),
  ('volume_spike',      'Unusual On-Chain Activity',       'DEX volumes spiking across Solana and Base chains. Smart money wallets rotating into small caps.', 'system', 70, false),
  ('market_quiet',      'Volatility Compression Signal',   'Market is quiet but volatility is building. Compression patterns historically precede sharp moves.', 'system', 60, false),
  ('social_trend',      'AI Token Narrative Heating Up',   'AI-powered tokens showing unusual engagement spikes. Community sentiment at 3-month high.', 'system', 85, false),
  ('onchain',           'Whale Movement Detected',         'Large wallet accumulation spotted across multiple meme token contracts. Unusual buy pressure.', 'system', 90, false),
  ('price_watch',       'Key Resistance Levels Approaching','Multiple tokens approaching critical resistance. Breakout or rejection expected in next 24-48h.', 'system', 65, false)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. AI AUTO-PIPELINE — token_submissions upgrades
-- ---------------------------------------------------------------------------

-- Add ai_score column (top-level numeric for easy filtering/display)
ALTER TABLE public.token_submissions
  ADD COLUMN IF NOT EXISTS ai_score  integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_id  uuid REFERENCES public.tokens(id) ON DELETE SET NULL;

-- Index for owner-scoped queries (security fix: user fetches only their own)
CREATE INDEX IF NOT EXISTS idx_submissions_owner   ON public.token_submissions (owner_username);
CREATE INDEX IF NOT EXISTS idx_submissions_status  ON public.token_submissions (status);
CREATE INDEX IF NOT EXISTS idx_submissions_token   ON public.token_submissions (token_id);

-- Migrate any old 'pending' or 'needs_review' rows to 'rejected'
-- so the status column stays clean (approved | rejected only)
UPDATE public.token_submissions
  SET status = 'rejected'
  WHERE status IN ('pending', 'needs_review');

-- RLS: ensure no anonymous user can read other users' submissions
-- (service role access only — frontend always goes through backend API)
DROP POLICY IF EXISTS "Public read submissions" ON public.token_submissions;

DROP POLICY IF EXISTS "Service role full access on submissions" ON public.token_submissions;
CREATE POLICY "Service role full access on submissions"
  ON public.token_submissions FOR ALL
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 6. TOKEN OWNER AUTH + DASHBOARD
-- ---------------------------------------------------------------------------

-- Session table (server-side session tokens — never trust client token_id)
CREATE TABLE IF NOT EXISTS public.token_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id      uuid REFERENCES public.tokens(id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_sessions_session ON public.token_sessions (session_token);
CREATE INDEX IF NOT EXISTS idx_token_sessions_token_id ON public.token_sessions (token_id);

ALTER TABLE public.token_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on token_sessions" ON public.token_sessions;
CREATE POLICY "Service role full access on token_sessions"
  ON public.token_sessions FOR ALL
  USING (auth.role() = 'service_role');

-- Extend tokens table — owner auth fields (tokens already populated via activateToken)
ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS owner_username      TEXT,
  ADD COLUMN IF NOT EXISTS owner_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS is_active           BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_deleted          BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_post_limit    INT     DEFAULT 20,
  ADD COLUMN IF NOT EXISTS twitter_url         TEXT,
  ADD COLUMN IF NOT EXISTS website             TEXT;

-- mood column already added in section 2; these are safe no-ops if it exists
-- daily_post_limit caps AI post frequency per owner's preference

-- Non-unique index: one owner_username → multiple tokens allowed
CREATE INDEX IF NOT EXISTS idx_tokens_owner_username ON public.tokens (owner_username);
CREATE INDEX IF NOT EXISTS idx_tokens_is_active      ON public.tokens (is_active);
CREATE INDEX IF NOT EXISTS idx_tokens_is_deleted     ON public.tokens (is_deleted);

-- Ensure all existing active tokens start with is_active = true, is_deleted = false
UPDATE public.tokens SET is_active = true  WHERE is_active IS NULL;
UPDATE public.tokens SET is_deleted = false WHERE is_deleted IS NULL;

-- ---------------------------------------------------------------------------
-- DONE
-- ---------------------------------------------------------------------------
-- After running this migration:
-- 1. Restart your backend server
-- 2. Events will appear in /explore immediately (seed events)
-- 3. Live events will populate as the scheduler runs
-- 4. Token submissions are auto-approved/rejected by AI — no manual queue
-- 5. (NEW) Token owners can log in, manage their token, and control AI behavior
-- Run in Supabase SQL Editor — all statements are idempotent (safe to re-run)
-- =============================================================================
