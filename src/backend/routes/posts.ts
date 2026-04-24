import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../utils/supabase';
import { logger } from '../utils/logger';
import { calculateEngagementScore } from '../services/postEngine';

const router = Router();

// ---------------------------------------------------------------------------
// Column sets — used for graceful migration v3 handling.
// Full (v3): includes event_type, engagement_score, token denorm fields.
// Legacy:    only columns that exist in the original schema.
// ---------------------------------------------------------------------------

// Full column list (requires migration v3)
const FULL_COLUMNS = `
  id,
  token_id,
  type,
  post_type,
  content,
  event_type,
  event_trigger,
  engagement_score,
  likes,
  reply_count,
  mood,
  label,
  image_url,
  timestamp,
  token_name,
  token_ticker,
  token_image
`.trim();

// Legacy column list (works without migration v3)
const LEGACY_COLUMNS = `
  id,
  token_id,
  type,
  post_type,
  content,
  event_trigger,
  likes,
  reply_count,
  mood,
  label,
  image_url,
  timestamp
`.trim();

// ---------------------------------------------------------------------------
// enrichWithTokenData — when token_name is missing from post row (legacy),
// joins the token table to fill in name/ticker/image.
// ---------------------------------------------------------------------------

async function enrichWithTokenData(posts: any[]): Promise<any[]> {
  if (!posts || posts.length === 0) return [];

  // Collect every unique token_id referenced by this batch of posts
  const allTokenIds = [...new Set(posts.filter(p => p.token_id).map(p => p.token_id))];
  if (allTokenIds.length === 0) return posts;

  // Fetch token metadata + active status in one query
  const { data: tokens } = await supabaseAdmin
    .from('tokens')
    .select('id, name, ticker, profile_image, is_active')
    .in('id', allTokenIds);

  if (!tokens) return posts;

  // Build a map keyed by token id
  const tokenMap = Object.fromEntries(tokens.map(t => [t.id, t]));

  const enriched: any[] = [];
  for (const post of posts) {
    const t = tokenMap[post.token_id];

    // Skip posts whose token is explicitly inactive
    // (NULL is_active is treated as active for backward compatibility)
    if (t && t.is_active === false) continue;

    enriched.push({
      ...post,
      // Prefer columns already on the post; fall back to token table
      token_name:       post.token_name   ?? t?.name          ?? null,
      token_ticker:     post.token_ticker ?? t?.ticker        ?? null,
      token_image:      post.token_image  ?? t?.profile_image ?? null,
      // Normalise event_type from event_trigger if v3 column is missing
      event_type:       post.event_type   ?? post.event_trigger?.type ?? null,
      // Default engagement_score to 0 if column missing
      engagement_score: post.engagement_score ?? 0,
    });
  }

  return enriched;
}

// ---------------------------------------------------------------------------
// safeQuery — try full columns first, fall back to legacy if schema error
// ---------------------------------------------------------------------------

async function safeSelect(
  baseQuery: any,
  fullColumnsOverride?: string,
): Promise<{ data: any[]; usedLegacy: boolean }> {
  const fullCols = fullColumnsOverride ?? FULL_COLUMNS;

  // Try full columns first
  const { data: full, error: fullError } = await baseQuery(fullCols);

  if (!fullError) {
    return { data: full ?? [], usedLegacy: false };
  }

  // Column missing → migration v3 not applied; use legacy
  const isColumnError =
    fullError.message.includes('column') ||
    fullError.message.includes('does not exist') ||
    fullError.message.includes('schema cache');

  if (isColumnError) {
    logger.warn('[Posts] Migration v3 not applied — using legacy column set. Run supabase_migration_v3.sql!');
    const { data: legacy, error: legacyError } = await baseQuery(LEGACY_COLUMNS);
    if (legacyError) throw new Error(legacyError.message);
    return { data: legacy ?? [], usedLegacy: true };
  }

  throw new Error(fullError.message);
}

// ---------------------------------------------------------------------------
// GET /api/posts  (aliased as /api/feed via server.ts)
//
// Returns enriched posts sorted by engagement_score DESC, timestamp DESC.
// Falls back to legacy schema if migration v3 isn't applied.
//
// Query params:
//   token_id   — filter by token
//   limit      — default 50, max 100
//   offset     — pagination offset
//   event_type — filter by event type
// ---------------------------------------------------------------------------

router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      token_id,
      limit      = '50',
      offset     = '0',
      event_type,
    } = req.query;

    const safeLimit  = Math.min(Number(limit),  100);
    const safeOffset = Math.max(Number(offset), 0);

    // Full-schema query: order by engagement_score DESC at DB level,
    // then timestamp DESC as tiebreaker.
    const buildFullQuery = (columns: string) => {
      let q = supabaseAdmin
        .from('posts')
        .select(columns)
        .order('engagement_score', { ascending: false, nullsFirst: false })
        .order('timestamp',        { ascending: false })
        .range(safeOffset, safeOffset + safeLimit - 1);

      if (token_id)   q = q.eq('token_id',   String(token_id));
      if (event_type) q = q.eq('event_type', String(event_type));
      return q;
    };

    // Legacy-schema query: no engagement_score column — order by timestamp only.
    const buildLegacyQuery = (columns: string) => {
      let q = supabaseAdmin
        .from('posts')
        .select(columns)
        .order('timestamp', { ascending: false })
        .range(safeOffset, safeOffset + safeLimit - 1);

      if (token_id) q = q.eq('token_id', String(token_id));
      return q;
    };

    // Try full schema first; if engagement_score column doesn't exist yet,
    // safeSelect automatically retries with LEGACY_COLUMNS (timestamp-only ordering).
    // If everything fails, return an empty array rather than a 500.
    let posts: any[] = [];
    try {
      const result = await safeSelect(buildFullQuery);
      posts = result.data;
    } catch {
      try {
        const result = await safeSelect(buildLegacyQuery);
        posts = result.data;
      } catch (innerErr: any) {
        logger.error('[Posts] Both full and legacy queries failed: ' + innerErr.message);
        // posts stays []
      }
    }

    // Enrich with token metadata + filter out inactive token posts
    const enriched = await enrichWithTokenData(posts);

    return res.json(enriched);
  } catch (err: any) {
    logger.error('[Posts] GET / error: ' + err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/posts/:id — single enriched post
// ---------------------------------------------------------------------------

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const buildQuery = (columns: string) =>
      supabaseAdmin.from('posts').select(columns).eq('id', req.params.id).single();

    const { data: post } = await safeSelect(buildQuery as any);
    const single = Array.isArray(post) ? post[0] : post;

    if (!single) return res.status(404).json({ error: 'Post not found.' });

    const [enriched] = await enrichWithTokenData([single]);
    return res.json({ ...enriched, replies: [] });
  } catch (err: any) {
    logger.error('[Posts] GET /:id error: ' + err.message);
    return res.status(404).json({ error: 'Post not found.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/posts/:id/like — increment like + recalculate engagement_score
// ---------------------------------------------------------------------------

router.post('/:id/like', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;

    const { data: post, error: fetchError } = await supabaseAdmin
      .from('posts')
      .select('id, likes, reply_count, timestamp')
      .eq('id', postId)
      .single();

    if (fetchError || !post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const newLikes = (post.likes ?? 0) + 1;
    const createdAt = new Date(post.timestamp ?? Date.now());
    const newScore  = calculateEngagementScore(newLikes, post.reply_count ?? 0, createdAt);

    // Try to update both likes and engagement_score; fallback to just likes
    const { error: updateError } = await supabaseAdmin
      .from('posts')
      .update({ likes: newLikes, engagement_score: newScore })
      .eq('id', postId);

    if (updateError) {
      // engagement_score column might not exist yet
      await supabaseAdmin.from('posts').update({ likes: newLikes }).eq('id', postId);
    }

    return res.json({ likes: newLikes, engagement_score: newScore });
  } catch (err: any) {
    logger.error('[Posts] like error: ' + err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/posts/:id/increment-replies
// ---------------------------------------------------------------------------

router.post('/:id/increment-replies', async (req: Request, res: Response) => {
  try {
    const { data: post, error: fetchError } = await supabaseAdmin
      .from('posts')
      .select('id, likes, reply_count, timestamp')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !post) return res.status(404).json({ error: 'Post not found.' });

    const newReplies = (post.reply_count ?? 0) + 1;
    const createdAt  = new Date(post.timestamp ?? Date.now());
    const newScore   = calculateEngagementScore(post.likes ?? 0, newReplies, createdAt);

    const { error } = await supabaseAdmin
      .from('posts')
      .update({ reply_count: newReplies, engagement_score: newScore })
      .eq('id', req.params.id);

    if (error) {
      await supabaseAdmin.from('posts').update({ reply_count: newReplies }).eq('id', req.params.id);
    }

    return res.json({ success: true, reply_count: newReplies, engagement_score: newScore });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
