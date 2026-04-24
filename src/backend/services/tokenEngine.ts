import { supabaseAdmin } from '../utils/supabase';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// TOKEN ENGINE — state evolution after every post
// Updates: mood, aggression, cooldown, posts_today, engagement_score, memory
// ---------------------------------------------------------------------------

const MOOD_MAP: Record<string, string> = {
  price_pump:     'hyped',
  price_dump:     'scared',
  price_rise:     'bullish',
  price_drop:     'bearish',
  volume_spike:   'hyped',
  social_hype:    'hyped',
  news_drop:      'confident',
  whale_activity: 'hyped',
  token_rivalry:  'angry',
  new_alliance:   'confident',
};

// Aggression bumps per event
const AGGRESSION_DELTA: Record<string, number> = {
  price_pump:     +1,
  price_dump:     -1,
  volume_spike:   +1,
  social_hype:    +1,
  news_drop:       0,
  whale_activity: +2,
  token_rivalry:  +2,
  new_alliance:   -1,
};

// Cooldown in ms keyed by aggression tier
function cooldownMs(aggression: number): number {
  if (aggression >= 8) return 5  * 60_000; // 5 min
  if (aggression >= 4) return 10 * 60_000; // 10 min
  return                       15 * 60_000; // 15 min
}

// Engagement score delta per action
const ENGAGEMENT_DELTA: Record<string, number> = {
  post:  2,
  reply: 3,
  roast: 4,
  shill: 1,
  skip:  0,
};

export const tokenEngine = {
  async updateAfterPost(token: any, event: any, output: any) {
    try {
      const eventType = event.type as string;
      const action    = (output.action || 'post') as string;

      // — Mood —
      const newMood = MOOD_MAP[eventType] ?? token.mood ?? 'neutral';

      // — Aggression (clamped 1–10) —
      const delta      = AGGRESSION_DELTA[eventType] ?? 0;
      const newAggr    = Math.min(10, Math.max(1, (token.aggression_level ?? 5) + delta));

      // — Engagement score —
      const engDelta   = ENGAGEMENT_DELTA[action] ?? 0;
      const newEng     = (token.engagement_score ?? 0) + engDelta;

      // — Dominance score (simple formula: eng + aggr bonus) —
      const newDominance = Math.floor(newEng * 1.2 + newAggr * 0.5);

      // — Cooldown —
      const cooldown   = Date.now() + cooldownMs(newAggr);

      // — Persist memory interaction —
      await this.updateMemory(token.id, output, action);

      // — Update token row —
      const { error } = await supabaseAdmin
        .from('tokens')
        .update({
          mood:             newMood,
          aggression_level: newAggr,
          engagement_score: newEng,
          dominance_score:  newDominance,
          posts_today:      (token.posts_today ?? 0) + 1,
          cooldown_until:   cooldown,
        })
        .eq('id', token.id);

      if (error) {
        logger.error('[TokenEngine] update failed: ' + error.message);
        return;
      }

      logger.info(
        `[TokenEngine] ${token.ticker}: mood=${newMood}, aggr=${newAggr}, eng=${newEng}, dom=${newDominance}`
      );
    } catch (e: any) {
      logger.error('[TokenEngine] updateAfterPost exception: ' + e.message);
    }
  },

  async updateMemory(_tokenId: string, _output: any, _action: string) {
    // token_memory table does not exist in the database schema — skipped.
    return;
  },

  /**
   * Update relationship between two tokens (alliance or rivalry).
   * Called externally when rivalry/alliance events are detected.
   */
  async updateRelationship(
    tokenId: string,
    targetId: string,
    type: 'rival' | 'ally',
    remove = false
  ) {
    try {
      const { data: token } = await supabaseAdmin
        .from('tokens')
        .select('personality')
        .eq('id', tokenId)
        .single();

      if (!token?.personality) return;

      const key = type === 'rival' ? 'rivals' : 'allies';
      const list: string[] = token.personality[key] ?? [];

      if (remove) {
        const updated = list.filter((id: string) => id !== targetId);
        token.personality[key] = updated;
      } else if (!list.includes(targetId)) {
        list.push(targetId);
        token.personality[key] = list;
      }

      await supabaseAdmin
        .from('tokens')
        .update({ personality: token.personality })
        .eq('id', tokenId);
    } catch (e: any) {
      logger.warn('[TokenEngine] updateRelationship error: ' + e.message);
    }
  },
};
