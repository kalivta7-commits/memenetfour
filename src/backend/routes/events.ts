import { Router } from 'express';
import { supabaseAdmin } from '../utils/supabase';

const router = Router();

// ---------------------------------------------------------------------------
// Signal field extractor
// Pulls intelligence fields from the data JSONB column so the frontend
// gets them as flat top-level properties (no schema change needed).
// ---------------------------------------------------------------------------

function extractSignalFields(ev: any) {
  const d = ev.data ?? {};
  return {
    ...ev,
    // Signal intelligence fields (from data JSONB)
    signal_type: d.signal_type   ?? ev.type   ?? null,
    media_url:   d.media_url     ?? null,
    thread_id:   d.thread_id     ?? null,
    parent_id:   d.parent_id     ?? null,
    is_reply:    d.is_reply      ?? false,
    source_info: d.source        ?? null,   // {type, url, author}
    // Keep raw data for agentBrain consumption
    data: d,
  };
}

/**
 * GET /api/events
 * Returns enriched events with full signal intelligence fields.
 * Query params:
 *   - limit         (default 30, max 50)
 *   - processed     ('true' | 'false')
 *   - type          filter by event type / signal_type
 *   - token_id      filter by token
 *   - min_score     minimum score (default 0)
 */
router.get('/', async (req, res) => {
  try {
    const limit     = Math.min(parseInt(req.query.limit     as string) || 30, 50);
    const processed = req.query.processed  as string | undefined;
    const type      = req.query.type       as string | undefined;
    const tokenId   = req.query.token_id   as string | undefined;
    const minScore  = parseInt(req.query.min_score as string) || 0;

    // ── Step 1: fetch events ─────────────────────────────────────────────────
    let query = supabaseAdmin
      .from('events')
      .select('id, type, score, data, title, content, source, processed, timestamp, created_at, token_id')
      .order('score',      { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (processed === 'true')  query = query.eq('processed', true);
    if (processed === 'false') query = query.eq('processed', false);
    if (type)                  query = query.eq('type', type);
    if (tokenId)               query = query.eq('token_id', tokenId);
    if (minScore > 0)          query = query.gte('score', minScore);

    const { data: events, error: eventsError } = await query;

    if (eventsError) {
      return res.status(500).json({ error: eventsError.message });
    }

    if (!events || events.length === 0) {
      return res.json([]);
    }

    // ── Step 2: collect unique token IDs ──────────────────────────────────────
    const tokenIds = [...new Set(events.map(e => e.token_id).filter(Boolean))];

    // ── Step 3: fetch token metadata ─────────────────────────────────────────
    let tokenMap: Record<string, { id: string; name: string; ticker: string; profile_image: string | null }> = {};

    if (tokenIds.length > 0) {
      const { data: tokens } = await supabaseAdmin
        .from('tokens')
        .select('id, name, ticker, profile_image')
        .in('id', tokenIds);

      if (tokens) {
        for (const t of tokens) {
          tokenMap[t.id] = t;
        }
      }
    }

    // ── Step 4: enrich each event with signal fields + token ─────────────────
    const enriched = events.map(ev => ({
      ...extractSignalFields(ev),
      token: ev.token_id ? (tokenMap[ev.token_id] ?? null) : null,
    }));

    return res.json(enriched);

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/events/:id
 * Single enriched event with full signal intelligence fields.
 */
router.get('/:id', async (req, res) => {
  try {
    const { data: ev, error } = await supabaseAdmin
      .from('events')
      .select('id, type, score, data, title, content, source, processed, timestamp, created_at, token_id')
      .eq('id', req.params.id)
      .single();

    if (error || !ev) return res.status(404).json({ error: 'Event not found' });

    let token = null;
    if (ev.token_id) {
      const { data: t } = await supabaseAdmin
        .from('tokens')
        .select('id, name, ticker, profile_image')
        .eq('id', ev.token_id)
        .single();
      token = t ?? null;
    }

    return res.json({ ...extractSignalFields(ev), token });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
