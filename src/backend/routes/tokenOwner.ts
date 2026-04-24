import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../utils/supabase';
import { logger } from '../utils/logger';

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthedRequest extends Request {
  tokenId: string;
}

// ---------------------------------------------------------------------------
// Session middleware
// Reads x-session-token header → validates in token_sessions (with expiry)
// → attaches token_id to request. NEVER trusts client-supplied token_id.
// ---------------------------------------------------------------------------

async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sessionToken = req.headers['x-session-token'] as string | undefined;

  if (!sessionToken) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const { data: session, error } = await supabaseAdmin
    .from('token_sessions')
    .select('token_id, expires_at')
    .eq('session_token', sessionToken)
    .single();

  if (error || !session) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return;
  }

  // Validate expiry — return 401 so frontend can force logout
  if (!session.expires_at || new Date(session.expires_at) <= new Date()) {
    // Clean up the stale row asynchronously (fire-and-forget, silent fail)
    try {
      await supabaseAdmin
        .from('token_sessions')
        .delete()
        .eq('session_token', sessionToken);
    } catch {
      // intentional silent fail
    }

    res.status(401).json({ error: 'Session expired. Please log in again.', expired: true });
    return;
  }

  (req as AuthedRequest).tokenId = session.token_id;
  next();
}

// ---------------------------------------------------------------------------
// POST /api/token/login
// Validates username + password (bcrypt) → creates a session per matched token
//
// Response shape (LOCKED CONTRACT):
// {
//   success: true,
//   username: string,
//   tokens: Array<{
//     session_token: string,   ← use as x-session-token header
//     id: string,              ← token UUID (for navigation)
//     name: string,
//     ticker: string,
//     profile_image: string | null
//   }>
// }
// ---------------------------------------------------------------------------

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username?.trim() || !password) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    // Normalise to lowercase for case-insensitive comparison
    const usernameLower = username.trim().toLowerCase();
    logger.info(`[TokenOwner/login] Attempting login — raw="${username}" normalised="${usernameLower}"`);

    // ── Broad query: no is_deleted filter — fetch anything matching the username ──
    // We inspect the exact row to debug what is stored.
    const { data: tokens, error } = await supabaseAdmin
      .from('tokens')
      .select('id, owner_username, owner_password_hash, name, ticker, profile_image, status, is_deleted, is_active')
      .ilike('owner_username', usernameLower);

    logger.info(`[TokenOwner/login] Query returned ${tokens?.length ?? 0} row(s), error=${error?.message ?? 'none'}`);
    if (tokens && tokens.length > 0) {
      tokens.forEach((t: any, i: number) => {
        logger.info(`[TokenOwner/login] Row[${i}]: owner_username="${t.owner_username}" is_deleted=${t.is_deleted} is_active=${t.is_active} status="${t.status}" has_hash=${!!t.owner_password_hash}`);
      });
    }

    if (error) {
      logger.error('[TokenOwner] Login DB error: ' + error.message);
      res.status(500).json({ error: 'Database error.' });
      return;
    }

    // Filter out hard-deleted rows in application code (handles NULL, false, true)
    const activTokens = (tokens ?? []).filter((t: any) => t.is_deleted !== true);
    logger.info(`[TokenOwner/login] After is_deleted filter: ${activTokens.length} row(s)`);

    if (activTokens.length === 0) {
      res.status(401).json({ error: 'Username not found.' });
      return;
    }

    // Verify password against all filtered tokens
    const matched: any[] = [];
    for (const t of activTokens) {
      if (!t.owner_password_hash) {
        logger.warn(`[TokenOwner/login] Row id=${t.id} has no password hash — skipping.`);
        continue;
      }
      const ok = await bcrypt.compare(password, t.owner_password_hash);
      logger.info(`[TokenOwner/login] bcrypt.compare for id=${t.id}: ${ok}`);
      if (ok) matched.push(t);
    }

    if (matched.length === 0) {
      res.status(401).json({ error: 'Incorrect password.' });
      return;
    }

    // Create a session for each matched token and return the locked contract shape
    const sessionList: Array<{
      session_token: string;
      id: string;
      name: string;
      ticker: string;
      profile_image: string | null;
    }> = [];

    for (const t of matched) {
      const sessionToken = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { error: sessionError } = await supabaseAdmin
        .from('token_sessions')
        .insert({
          token_id:      t.id,
          session_token: sessionToken,
          expires_at:    expiresAt,
        });

      if (sessionError) {
        logger.error('[TokenOwner] Session insert error: ' + sessionError.message);
        continue;
      }

      sessionList.push({
        session_token: sessionToken,
        id:            t.id,
        name:          t.name,
        ticker:        t.ticker,
        profile_image: t.profile_image ?? null,
      });
    }

    if (sessionList.length === 0) {
      res.status(500).json({ error: 'Failed to create session.' });
      return;
    }

    logger.info(`[TokenOwner] Login OK for "${usernameLower}" — ${sessionList.length} token(s).`);

    res.json({
      success: true,
      username: usernameLower,
      tokens: sessionList,
    });
  } catch (err: any) {
    logger.error('[TokenOwner] Login exception: ' + err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/token/logout
// Invalidates the current session
// ---------------------------------------------------------------------------

router.post('/logout', requireSession, async (req: Request, res: Response): Promise<void> => {
  const sessionToken = req.headers['x-session-token'] as string;

  await supabaseAdmin
    .from('token_sessions')
    .delete()
    .eq('session_token', sessionToken);

  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// GET /api/token/me
// Returns the FULL token object for the authenticated owner.
// ---------------------------------------------------------------------------

router.get('/me', requireSession, async (req: any, res: Response): Promise<void> => {
  try {
    const tokenId = req.tokenId;

    const { data: token, error } = await supabaseAdmin
      .from('tokens')
      .select('*')
      .eq('id', tokenId)
      .neq('is_deleted', true)
      .single();

    if (error || !token) {
      res.status(404).json({ error: 'Token not found' });
      return;
    }

    res.json({
      success: true,
      token,
    });
  } catch (err: any) {
    logger.error('[TokenOwner] /me error: ' + err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/token/update
// Updates profile + AI control settings for the authenticated token only.
// token_id comes EXCLUSIVELY from session — never from request body/params.
// ---------------------------------------------------------------------------

const ALLOWED_MOODS = ['bullish', 'bearish', 'funny', 'neutral'] as const;

router.post('/update', requireSession, async (req: Request, res: Response): Promise<void> => {
  try {
    const tokenId = (req as AuthedRequest).tokenId;

    const {
      // Profile
      bio,
      description,       // alias for bio
      twitter_url,
      website,
      website_url,       // alias for website
      profile_image_url,
      banner_image_url,
      // AI Controls
      is_active,
      daily_post_limit,
      mood,
    } = req.body;

    const payload: Record<string, any> = {};

    // Profile fields (accept both bio and description as aliases)
    const bioValue = bio ?? description;
    if (bioValue !== undefined) payload.bio = String(bioValue).slice(0, 300).trim() || null;

    const twitterValue = twitter_url;
    if (twitterValue !== undefined) payload.twitter_url = twitterValue?.trim() || null;

    const websiteValue = website ?? website_url;
    if (websiteValue !== undefined) payload.website = websiteValue?.trim() || null;

    if (profile_image_url !== undefined) payload.profile_image = profile_image_url?.trim() || null;
    if (banner_image_url  !== undefined) payload.banner_image  = banner_image_url?.trim()  || null;

    // AI Controls
    if (is_active !== undefined) payload.is_active = Boolean(is_active);

    if (daily_post_limit !== undefined) {
      const lim = Number(daily_post_limit);
      if (!isNaN(lim) && lim >= 1 && lim <= 50) {
        payload.daily_post_limit = lim;
      } else {
        res.status(400).json({ error: 'daily_post_limit must be 1–50.' });
        return;
      }
    }

    if (mood !== undefined) {
      if (!(ALLOWED_MOODS as readonly string[]).includes(mood)) {
        res.status(400).json({ error: `mood must be one of: ${ALLOWED_MOODS.join(', ')}.` });
        return;
      }
      payload.mood = mood;
    }

    if (Object.keys(payload).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    // Always use session-derived tokenId — never client-supplied
    const { data, error } = await supabaseAdmin
      .from('tokens')
      .update(payload)
      .eq('id', tokenId)
      .neq('is_deleted', true)
      .select()
      .single();

    if (error) {
      logger.error('[TokenOwner] Update failed: ' + error.message);
      res.status(500).json({ error: error.message });
      return;
    }

    logger.info(`[TokenOwner] Token ${tokenId} updated — fields: ${Object.keys(payload).join(', ')}`);
    res.json({ success: true, token: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/token/delete
// Soft-deletes the authenticated token + invalidates all sessions
// token_id comes EXCLUSIVELY from session
// ---------------------------------------------------------------------------

router.post('/delete', requireSession, async (req: Request, res: Response): Promise<void> => {
  try {
    const tokenId = (req as AuthedRequest).tokenId;

    const { error } = await supabaseAdmin
      .from('tokens')
      .update({ is_deleted: true, is_active: false, status: 'deleted' })
      .eq('id', tokenId);

    if (error) {
      logger.error('[TokenOwner] Delete failed: ' + error.message);
      res.status(500).json({ error: error.message });
      return;
    }

    // Invalidate ALL sessions for this token
    await supabaseAdmin
      .from('token_sessions')
      .delete()
      .eq('token_id', tokenId);

    logger.info(`[TokenOwner] Token ${tokenId} soft-deleted — all sessions invalidated.`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/token/cleanup-sessions
// Manually trigger expired session cleanup (call from a cron or admin script)
// ---------------------------------------------------------------------------

router.post('/cleanup-sessions', async (_req: Request, res: Response): Promise<void> => {
  const { error, count } = await supabaseAdmin
    .from('token_sessions')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString());

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  logger.info(`[TokenOwner] Cleaned up ${count ?? 0} expired session(s).`);
  res.json({ success: true, deleted: count ?? 0 });
});

export default router;
