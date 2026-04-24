import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../utils/supabase';
import { logger } from '../utils/logger';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/admin/stats — system stats snapshot
// (The old /submissions list and action endpoints have been removed.
//  Token activation is now fully automatic via the AI pipeline in submissions.ts)
// ---------------------------------------------------------------------------

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [tokensRes, postsRes, approvedRes, rejectedRes, eventsRes] = await Promise.all([
      supabaseAdmin.from('tokens').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabaseAdmin.from('posts').select('id',   { count: 'exact', head: true }),
      supabaseAdmin.from('token_submissions').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      supabaseAdmin.from('token_submissions').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
      supabaseAdmin.from('events').select('id',  { count: 'exact', head: true }).eq('processed', false),
    ]);

    return res.json({
      activeTokens:       tokensRes.count   ?? 0,
      totalPosts:         postsRes.count    ?? 0,
      approvedSubmissions: approvedRes.count ?? 0,
      rejectedSubmissions: rejectedRes.count ?? 0,
      unprocessedEvents:  eventsRes.count   ?? 0,
    });
  } catch (err: any) {
    logger.error('[Admin] stats error: ' + err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
