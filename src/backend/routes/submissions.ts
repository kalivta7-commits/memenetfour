import { Router, Request, Response } from 'express';
import multer from 'multer';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../utils/supabase';
import { aiEngine } from '../services/aiEngine';
import { generatePersonality } from '../services/agentBrain';
import { postEngine } from '../services/postEngine';
import { logger } from '../utils/logger';
import { parseCoinGeckoId } from '../utils/parseCoinGeckoId';

const router = Router();

// ---------------------------------------------------------------------------
// Multer — in-memory storage, 5 MB limit, image MIME guard
// ---------------------------------------------------------------------------

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_SIZE_BYTES },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: JPG, PNG, WEBP, GIF`));
    }
  },
});

// ---------------------------------------------------------------------------
// Helper: upload a buffer to Supabase Storage and return public URL
// ---------------------------------------------------------------------------

async function uploadToStorage(
  buffer: Buffer,
  mimeType: string,
  bucket: 'avatars' | 'banners'
): Promise<string> {
  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const fileName = `${uuidv4()}-${Date.now()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(fileName, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Storage upload failed (${bucket}): ${error.message}`);
  }

  const { data } = supabaseAdmin.storage
    .from(bucket)
    .getPublicUrl(fileName);

  return data.publicUrl;
}

// ---------------------------------------------------------------------------
// AI Moderation — score 0-100, approved if score >= 60
// ---------------------------------------------------------------------------

async function moderateSubmission(submission: {
  name: string;
  ticker: string;
  description: string;
  chain: string;
  website?: string;
  twitter?: string;
}): Promise<{ approved: boolean; score: number; reasons: string[]; confidence: string }> {
  const prompt = `You are a strict moderation AI for a meme token social network.

Evaluate this token submission and return ONLY valid JSON, nothing else.

TOKEN:
Name: ${submission.name}
Ticker: $${submission.ticker}
Description: "${submission.description}"
Chain: ${submission.chain}
Website: ${submission.website || 'none'}
Twitter: ${submission.twitter || 'none'}

Score the submission from 0–100 where:
- 80–100 = clearly legitimate meme project
- 60–79  = acceptable meme token
- 0–59   = likely scam, spam, or violates rules

RULES that cause automatic rejection (score < 60):
- Promises guaranteed returns
- Copied description from known tokens
- Contains hate speech, slurs, or threats
- Impersonates real projects
- "rug" or exit scam patterns in description
- Nonsense/gibberish name or description

Return ONLY this JSON:
{
  "score": <0-100>,
  "approved": <true if score >= 60, else false>,
  "confidence": "<high|medium|low>",
  "reasons": ["<reason 1>", "<reason 2>"]
}`;

  const resp = await aiEngine.callAI(
    'moderation',
    [{ role: 'user', content: prompt }],
    { temperature: 0.1 }
  );

  if (!resp) {
    // AI unavailable — default approve (safe fallback)
    return { approved: true, score: 60, reasons: ['AI moderation unavailable — approved by default.'], confidence: 'low' };
  }

  try {
    const clean = resp.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      approved:   Boolean(parsed.approved),
      score:      Number(parsed.score)      || 0,
      confidence: String(parsed.confidence) || 'low',
      reasons:    Array.isArray(parsed.reasons) ? parsed.reasons : [],
    };
  } catch (e: any) {
    logger.warn('[Submissions] Moderation parse failed: ' + e.message);
    return { approved: true, score: 60, reasons: ['Parse error — approved by default.'], confidence: 'low' };
  }
}

// ---------------------------------------------------------------------------
// Token activation — called automatically when AI score >= 60
// CRITICAL: tokens insert ALWAYS runs first; all optional logic runs after.
// ---------------------------------------------------------------------------

async function activateToken(submission: any, moderation: { score: number; reasons: string[]; confidence: string }) {
  logger.info('[activateToken] START — ticker: ' + submission.ticker);

  // ── STEP 1: Validate required fields ──────────────────────────────────────
  const { owner_username, owner_password_hash, name, ticker } = submission;

  if (!owner_username || !owner_password_hash || !name || !ticker) {
    logger.error('[activateToken] ERROR — missing required fields: ' +
      JSON.stringify({ owner_username: !!owner_username, owner_password_hash: !!owner_password_hash, name: !!name, ticker: !!ticker }));
    return null;
  }

  // ── STEP 2: Duplicate check in tokens table ───────────────────────────────
  try {
    const { data: existing } = await supabaseAdmin
      .from('tokens')
      .select('id')
      .eq('token_symbol', ticker)
      .limit(1);

    if (existing && existing.length > 0) {
      logger.warn(`[activateToken] Duplicate detected — $${ticker} already exists in tokens. Skipping insert.`);
      return existing[0];
    }
  } catch (dupErr: any) {
    logger.warn('[activateToken] Duplicate check failed (proceeding anyway): ' + dupErr.message);
  }

  // ── STEP 3: CRITICAL INSERT — must always run ─────────────────────────────
  logger.info('[activateToken] inserting $' + ticker + ' into tokens...');

  let token: any = null;

  try {
    const { data: insertedToken, error: tokenInsertError } = await supabaseAdmin
      .from('tokens')
      .insert({
        name:                name,
        ticker:              ticker,
        token_symbol:        ticker,
        profile_image:       submission.profile_image_url  ?? null,
        banner_image:        submission.banner_url          ?? null,
        bio:                 submission.description         ?? null,
        chain:               submission.chain               ?? null,
        category:            Array.isArray(submission.category) ? submission.category : [],
        website:             submission.website             ?? null,
        twitter_url:         submission.twitter             ?? null,
        contract_address:    submission.contract_address   ?? null,
        coingecko_url:       submission.coingecko_url       ?? null,
        dex_url:             submission.dexscreener_url     ?? null,
        coingecko_id:        parseCoinGeckoId(submission.coingecko_url) ?? null,
        status:              'active',
        is_active:           true,
        is_deleted:          false,
        verified:            true,
        mood:                'neutral',
        aggression_level:    5,
        engagement_score:    0,
        dominance_score:     0,
        posts_today:         0,
        is_typing:           false,
        links: {
          twitter:     submission.twitter          ?? null,
          dexscreener: submission.dexscreener_url  ?? null,
          coingecko:   submission.coingecko_url    ?? null,
        },
        owner_username:      (owner_username as string).trim().toLowerCase(),
        owner_password_hash: owner_password_hash,
      })
      .select()
      .single();

    if (tokenInsertError || !insertedToken) {
      logger.error('[activateToken] ERROR — tokens insert failed: ' + tokenInsertError?.message);
      return null;
    }

    token = insertedToken;
    logger.info(`[activateToken] SUCCESS — $${ticker} inserted into tokens (id: ${token.id})`);

  } catch (insertErr: any) {
    logger.error('[activateToken] ERROR — tokens insert threw: ' + insertErr.message);
    return null;
  }

  // ── STEP 4: Optional — AI personality (runs AFTER successful insert) ──────
  try {
    const personality = await generatePersonality({
      name:        name,
      ticker:      ticker,
      description: submission.description ?? '',
      chain:       submission.chain        ?? '',
      category:    Array.isArray(submission.category) ? submission.category : [],
    });

    if (personality) {
      await supabaseAdmin
        .from('tokens')
        .update({
          personality,
          mood:             (personality as any).mood             ?? 'neutral',
          aggression_level: (personality as any).aggression_level ?? 5,
        })
        .eq('id', token.id);

      logger.info(`[activateToken] Personality applied to $${ticker}`);
    }
  } catch (personalityErr: any) {
    logger.warn('[activateToken] Personality generation failed (non-fatal): ' + personalityErr.message);
  }

  // ── STEP 4b: Optional — seed first post ───────────────────────────────────
  try {
    const seedEvent = {
      id:       uuidv4(),
      type:     'new_listing',
      score:    80,
      data:     { message: 'Token just went live on MemeNet!' },
      token_id: token.id,
    };
    const postOutput = await postEngine.generate(token, seedEvent, 'post');
    if (postOutput) {
      await postEngine.save(token, postOutput, seedEvent);
      logger.info(`[activateToken] Seed post created for $${ticker}`);
    }
  } catch (postErr: any) {
    logger.warn('[activateToken] Seed post failed (non-fatal): ' + postErr.message);
  }

  return token;
}

// ---------------------------------------------------------------------------
// Seed initial events for a newly activated token so feed populates instantly
// ---------------------------------------------------------------------------

async function seedInitialEvents(token: any): Promise<void> {
  try {
    const eventTypes = [
      { type: 'new_listing',  title: `${token.name} just launched on MemeNet!`,   score: 85, data: { message: 'Fresh drop — first mover advantage.' } },
      { type: 'social_trend', title: `$${token.ticker} is trending`,               score: 70, data: { message: 'Rising social momentum on launch day.' } },
    ];

    for (const e of eventTypes) {
      await supabaseAdmin.from('events').insert({
        type:      e.type,
        title:     e.title,
        content:   e.title,
        source:    'system',
        score:     e.score,
        token_id:  token.id,
        data:      e.data,
        processed: false,
      });
    }

    logger.info(`[Submissions] Seeded ${eventTypes.length} initial events for $${token.ticker}`);
  } catch (e: any) {
    logger.warn('[Submissions] seedInitialEvents failed (non-fatal): ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// POST /api/submissions — submit a new token
// Accepts multipart/form-data
// Fields: name, ticker, description, chain, category, website, twitter,
//         dexscreener_url, coingecko_url, contract_address,
//         owner_username, owner_password
// Files: avatar (required), banner (optional)
// ---------------------------------------------------------------------------

router.post(
  '/',
  upload.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'banner', maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const avatarFile = files?.['avatar']?.[0];

      const {
        name,
        ticker,
        description,
        chain,
        category,
        website,
        twitter,
        dexscreener_url,
        coingecko_url,
        contract_address,
        owner_username,
        owner_password,
      } = req.body;

      // ── Input validation ────────────────────────────────────────────────
      if (!name?.trim())        return res.status(400).json({ error: 'Token name is required.' });
      if (!ticker?.trim())      return res.status(400).json({ error: 'Ticker is required.' });
      if (!description?.trim()) return res.status(400).json({ error: 'Description is required.' });
      if (!chain?.trim())       return res.status(400).json({ error: 'Chain is required.' });
      if (!owner_username?.trim()) return res.status(400).json({ error: 'Owner username is required.' });
      if (!owner_password || owner_password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      if (!avatarFile) {
        return res.status(400).json({ error: 'Avatar image is required.' });
      }

      const tickerClean = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (tickerClean.length < 2 || tickerClean.length > 10) {
        return res.status(400).json({ error: 'Ticker must be 2–10 alphanumeric characters.' });
      }
      if (description.trim().length < 20) {
        return res.status(400).json({ error: 'Description must be at least 20 characters.' });
      }

      // ── Duplicate check ─────────────────────────────────────────────────
      const { data: existing } = await supabaseAdmin
        .from('token_submissions')
        .select('id')
        .ilike('ticker', tickerClean)
        .limit(1);

      if (existing && existing.length > 0) {
        return res.status(409).json({ error: `A submission for $${tickerClean} already exists.` });
      }

      // ── Upload images ────────────────────────────────────────────────────
      let profileImageUrl: string;
      let bannerUrl: string | null = null;

      profileImageUrl = await uploadToStorage(
        avatarFile.buffer,
        avatarFile.mimetype,
        'avatars'
      );

      const bannerFile = files?.['banner']?.[0];
      if (bannerFile) {
        bannerUrl = await uploadToStorage(
          bannerFile.buffer,
          bannerFile.mimetype,
          'banners'
        );
      }

      // ── AI Moderation ────────────────────────────────────────────────────
      const moderation = await moderateSubmission({
        name:        name.trim(),
        ticker:      tickerClean,
        description: description.trim(),
        chain:       chain.trim(),
        website,
        twitter,
      });

      // ── Hash password ────────────────────────────────────────────────────
      const passwordHash = await bcrypt.hash(owner_password, 12);

      // ── Determine final status ───────────────────────────────────────────
      const finalStatus = moderation.approved ? 'approved' : 'rejected';

      // ── Persist submission record ────────────────────────────────────────
      const categoryArray = category
        ? (typeof category === 'string' ? category.split(',').map((s: string) => s.trim()).filter(Boolean) : category)
        : [];

      const { data: submission, error: insertError } = await supabaseAdmin
        .from('token_submissions')
        .insert({
          name:                name.trim(),
          ticker:              tickerClean,
          description:         description.trim(),
          chain:               chain.trim(),
          categories:          categoryArray,           // ARRAY column
          category:            categoryArray.join(', ') || null, // text column
          website:             website?.trim()          || null,
          twitter:             twitter?.trim()          || null,
          twitter_url:         twitter?.trim()          || null,
          dexscreener_url:     dexscreener_url?.trim()  || null,
          coingecko_url:       coingecko_url?.trim()    || null,
          contract_address:    contract_address?.trim() || null,
          profile_image_url:   profileImageUrl,
          banner_url:          bannerUrl,
          owner_username:      owner_username.trim().toLowerCase(),
          owner_password_hash: passwordHash,
          status:              finalStatus,
          ai_score:            moderation.score,
          ai_reasons:          moderation.reasons,
          ai_verdict: {
            score:      moderation.score,
            result:     finalStatus,
            confidence: moderation.confidence,
            reasons:    moderation.reasons,
          },
          submitted_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError || !submission) {
        logger.error('[Submissions] Insert error: ' + insertError?.message);
        return res.status(500).json({ error: 'Failed to save submission.' });
      }

      logger.info(`[Submissions] Submission recorded: $${tickerClean} → ${finalStatus} (score: ${moderation.score})`);

      // ── Auto-activate if approved ─────────────────────────────────────────
      let tokenId: string | null = null;
      if (finalStatus === 'approved') {
        const token = await activateToken(submission, moderation);
        tokenId = token?.id ?? null;

        // Update submission with token_id
        if (tokenId && token) {
          await supabaseAdmin
            .from('token_submissions')
            .update({ token_id: tokenId })
            .eq('id', submission.id);

          // Seed initial events so the feed is live immediately
          await seedInitialEvents(token);
        }
      }

      return res.status(201).json({
        id:         submission.id,
        status:     finalStatus,
        ai_score:   moderation.score,
        ai_reasons: moderation.reasons,
        token_id:   tokenId,
      });

    } catch (err: any) {
      logger.error('[Submissions] Unhandled error: ' + err.message);
      return res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/submissions/:id — check submission status (owner only via ID)
// ---------------------------------------------------------------------------

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('token_submissions')
      .select(`
        id,
        name,
        ticker,
        status,
        ai_score,
        ai_verdict,
        created_at,
        submitted_at,
        token_id,
        profile_image_url
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Submission not found.' });

    const row = data as any;
    return res.json({
      id:                row.id,
      name:              row.name,
      ticker:            row.ticker,
      status:            row.status,
      ai_score:          row.ai_score,
      ai_verdict:        row.ai_verdict,
      submitted_at:      row.submitted_at ?? row.created_at,
      token_id:          row.token_id,
      profile_image_url: row.profile_image_url,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/submissions/owner/:username — fetch owner's live tokens + submissions
// Merges:
//   1. tokens table (live/approved) — source of truth for activated tokens
//   2. token_submissions table (pending / rejected) — non-approved entries
// ---------------------------------------------------------------------------

router.get('/owner/:username', async (req: Request, res: Response) => {
  const username = (req.params.username || '').trim().toLowerCase();
  logger.info(`[MyTokens] Fetching tokens for username: ${username}`);

  try {
    // ── 1. Fetch LIVE tokens from the tokens table ─────────────────────────
    const { data: liveTokens, error: liveError } = await supabaseAdmin
      .from('tokens')
      .select('id, name, ticker, token_symbol, profile_image, created_at, is_deleted')
      .eq('owner_username', username)
      .eq('is_deleted', false);

    if (liveError) {
      logger.error('[MyTokens] tokens query error: ' + liveError.message);
    }

    logger.info(`[MyTokens] live tokens: ${JSON.stringify(liveTokens)}`);

    // ── 2. Fetch submissions (pending / rejected) from token_submissions ───
    const { data: subData, error: subError } = await supabaseAdmin
      .from('token_submissions')
      .select('id, name, ticker, status, ai_score, ai_verdict, created_at, submitted_at, token_id, profile_image_url')
      .eq('owner_username', username)
      .order('created_at', { ascending: false });

    if (subError) {
      logger.error('[MyTokens] token_submissions query error: ' + subError.message);
    }

    logger.info(`[MyTokens] submissions: ${JSON.stringify(subData)}`);

    // ── 3. Build a set of live tickers so we don't double-count ───────────
    const liveTickers = new Set(
      (liveTokens ?? []).map((t: any) => (t.token_symbol || t.ticker || '').toUpperCase())
    );

    // ── 4. Map live tokens → unified shape ────────────────────────────────
    const liveRows = (liveTokens ?? []).map((t: any) => ({
      id:                t.id,
      name:              t.name,
      ticker:            t.token_symbol || t.ticker,
      status:            'approved' as const,
      ai_score:          100,
      ai_verdict:        null,
      submitted_at:      t.created_at,
      token_id:          t.id,          // the token IS the record
      profile_image_url: t.profile_image ?? null,
      source:            'tokens',
    }));

    // ── 5. Map non-approved submissions → unified shape ───────────────────
    //    Skip any submission whose ticker already exists in the live tokens
    //    (approved submissions are superseded by the live token record)
    const pendingRows = (subData ?? [])
      .filter((row: any) => {
        const t = (row.ticker || '').toUpperCase();
        // Include if not already covered by a live token row
        return !liveTickers.has(t) || row.status !== 'approved';
      })
      .map((row: any) => ({
        id:                row.id,
        name:              row.name,
        ticker:            row.ticker,
        status:            row.status,
        ai_score:          row.ai_score,
        ai_verdict:        row.ai_verdict,
        submitted_at:      row.submitted_at ?? row.created_at,
        token_id:          row.token_id,
        profile_image_url: row.profile_image_url,
        source:            'token_submissions',
      }));

    // ── 6. Merge: live tokens first, then pending/rejected ─────────────────
    const merged = [...liveRows, ...pendingRows];

    logger.info(`[MyTokens] merged result count: ${merged.length}`);

    return res.json(merged);
  } catch (err: any) {
    logger.error('[MyTokens] Unhandled error: ' + err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
