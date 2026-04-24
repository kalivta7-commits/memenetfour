import { aiEngine } from './aiEngine';
import { buildPostContext } from './agentBrain';
import { supabaseAdmin } from '../utils/supabase';
import { logger } from '../utils/logger';
import { validationEngine } from './validationEngine';

// ---------------------------------------------------------------------------
// POST ENGINE
// Generates AI content + persists posts to Supabase.
// All posts include: event_type, engagement_score, denormalized token fields.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Engagement score formula:
//   engagement_score = (likes × 2) + (comments × 3) + recency_weight
//   recency_weight: 10 points fresh, decays linearly to 0 over 24 hours
// ---------------------------------------------------------------------------

export function calculateEngagementScore(
  likes:     number,
  comments:  number,
  createdAt: Date
): number {
  const ageMs         = Date.now() - createdAt.getTime();
  const ageHours      = ageMs / (1000 * 60 * 60);
  const recencyWeight = Math.max(0, Math.round(10 * (1 - ageHours / 24)));
  return (likes * 2) + (comments * 3) + recencyWeight;
}

// ---------------------------------------------------------------------------
// generate — builds prompts + calls AI to produce a post
// ---------------------------------------------------------------------------

export const postEngine = {

  async generate(token: any, event: any, action: string) {
    try {
      const { systemPrompt, userPrompt, replyTargetId } = await buildPostContext(
        token,
        event,
        action as any
      );

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ];

      const resp = await aiEngine.callAI('postGen', messages, { temperature: 0.88 });
      if (!resp) return null;

      // Strip markdown fences if model adds them
      const clean = resp.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let parsed: any;
      try {
        parsed = JSON.parse(clean);
      } catch {
        // Model returned plain text — treat as content directly
        logger.warn('[PostEngine] Non-JSON response — wrapping as plain post.');
        parsed = { action, content: resp.slice(0, 280), reply_to: null, image_caption: null };
      }

      if (!parsed.content || !validationEngine.passes(parsed.content)) {
        logger.warn('[PostEngine] Generated content failed validation.');
        return null;
      }

      if (replyTargetId && !parsed.reply_to) {
        parsed.reply_to = replyTargetId;
      }

      return parsed;
    } catch (e: any) {
      logger.error('[PostEngine] generate() failed: ' + e.message);
      return null;
    }
  },

  // ---------------------------------------------------------------------------
  // save — persist a post to Supabase.
  //
  // Strategy: attempt full save with all new columns first.
  // If Supabase rejects because migration v3 hasn't been run (missing columns),
  // fall back to the minimal legacy schema so the system keeps posting.
  // ---------------------------------------------------------------------------

  async save(token: any, output: any, event: any) {
    const initialEngagement = calculateEngagementScore(0, 0, new Date());

    // Full payload — includes migration v3 columns
    const fullPayload: Record<string, any> = {
      // Base post
      token_id:         token.id,
      type:             'ai',
      post_type:        output.action || 'post',
      content:          output.content,
      image_url:        output.image_url ?? null,
      mood:             token.mood ?? 'neutral',
      label:            '🤖 AI Generated',
      likes:            0,
      reply_count:      0,
      timestamp:        new Date().toISOString(),

      // V3 columns (requires migration v3)
      event_trigger:    event,
      event_type:       event.type   ?? null,
      engagement_score: initialEngagement,
      token_name:       token.name          ?? null,
      token_ticker:     token.ticker        ?? null,
      token_image:      token.profile_image ?? null,
    };

    // Attempt full save
    const { error: fullError } = await supabaseAdmin.from('posts').insert(fullPayload);

    if (!fullError) {
      logger.info(`[PostEngine] ✅ Post saved for ${token.ticker} (event: ${event.type})`);
      return;
    }

    // If the error is specifically about missing columns → migration v3 not run
    const missingColumn =
      fullError.message.includes("column") &&
      (fullError.message.includes("engagement_score") ||
       fullError.message.includes("event_type") ||
       fullError.message.includes("token_name") ||
       fullError.message.includes("token_ticker") ||
       fullError.message.includes("token_image"));

    if (missingColumn) {
      logger.warn('[PostEngine] Migration v3 not applied — falling back to legacy schema. Run supabase_migration_v3.sql!');

      // Legacy-compatible payload (columns that existed before v3)
      const legacyPayload: Record<string, any> = {
        token_id:      token.id,
        type:          'ai',
        post_type:     output.action || 'post',
        content:       output.content,
        image_url:     output.image_url ?? null,
        mood:          token.mood ?? 'neutral',
        label:         '🤖 AI Generated',
        likes:         0,
        reply_count:   0,
        timestamp:     new Date().toISOString(),
        event_trigger: event,
      };

      const { error: legacyError } = await supabaseAdmin.from('posts').insert(legacyPayload);

      if (legacyError) {
        logger.error('[PostEngine] Legacy save also failed: ' + legacyError.message);
      } else {
        logger.info(`[PostEngine] ✅ Post saved (legacy schema) for ${token.ticker}`);
      }
      return;
    }

    // Some other DB error
    logger.error('[PostEngine] save() DB error: ' + fullError.message);
  },

  // ---------------------------------------------------------------------------
  // updateEngagementScore — called when likes / replies change
  // ---------------------------------------------------------------------------

  async updateEngagementScore(postId: string, likes: number, replies: number, createdAt: Date) {
    try {
      const score = calculateEngagementScore(likes, replies, createdAt);
      const { error } = await supabaseAdmin
        .from('posts')
        .update({ engagement_score: score })
        .eq('id', postId);

      if (error) {
        logger.warn(`[PostEngine] updateEngagementScore DB error for ${postId}: ${error.message}`);
      }
    } catch (e: any) {
      logger.warn('[PostEngine] updateEngagementScore exception: ' + e.message);
    }
  },
};

// Re-export for routes/posts.ts
export { buildPostContext };
