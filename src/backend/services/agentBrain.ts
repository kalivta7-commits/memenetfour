import { logger } from '../utils/logger';
import { aiEngine } from './aiEngine';
import { supabaseAdmin } from '../utils/supabase';
import { buildTokenIntelligenceContext } from './signalEngine';
import type { Signal } from './signalEngine';

// ---------------------------------------------------------------------------
// AGENT BRAIN
// Each approved token IS an AI agent with:
//   - Personality (traits, mood, aggression level)
//   - Weighted action decision system based on events + mood
//   - shouldPost() — single source of truth for posting eligibility
// ---------------------------------------------------------------------------

export type AgentAction = 'post' | 'reply' | 'roast' | 'shill' | 'skip';

interface TokenRow {
  id:               string;
  name:             string;
  ticker:           string;
  profile_image:    string | null;
  mood:             string;
  aggression_level: number;
  dominance_score:  number;
  posts_today:      number;
  cooldown_until:   number | null;
  daily_post_limit: number;
  is_active:        boolean | null; // NULL treated as true
  personality: {
    traits:     string[];
    rivals:     string[];
    allies:     string[];
    backstory?: string;
  } | null;
  verified:        boolean;
  engagement_score: number;
}

interface EventRow {
  id:       string;
  type:     string;
  score:    number;
  data:     Record<string, any>;
  token_id: string;
}

// ---------------------------------------------------------------------------
// shouldPost — SINGLE SOURCE OF TRUTH for AI posting eligibility
// Returns {should: boolean, reason: string}
// ---------------------------------------------------------------------------

export function shouldPost(event: EventRow, token: TokenRow): { should: boolean; reason: string } {
  // is_active: NULL treated as true (legacy rows without explicit flag)
  if (token.is_active === false) {
    return { should: false, reason: 'is_active=false (agent paused by owner)' };
  }

  // Daily post limit
  const cap = token.daily_post_limit ?? 20;
  if ((token.posts_today ?? 0) >= cap) {
    return { should: false, reason: `daily limit reached (${token.posts_today}/${cap})` };
  }

  // Cooldown
  if (token.cooldown_until && Date.now() < token.cooldown_until) {
    const remaining = Math.ceil((token.cooldown_until - Date.now()) / 1000);
    return { should: false, reason: `on cooldown (${remaining}s remaining)` };
  }

  // Event score too low to bother
  if ((event.score ?? 0) < 25) {
    return { should: false, reason: `event score too low (${event.score})` };
  }

  return { should: true, reason: 'eligible' };
}

// ---------------------------------------------------------------------------
// ACTION WEIGHTS
// Computed from: mood, aggression, event type, engagement
// NOTE: token_memory removed — no DB dependency here
// ---------------------------------------------------------------------------

function computeActionWeights(
  token: TokenRow,
  event: EventRow,
): Record<AgentAction, number> {
  const aggr      = Math.max(1, Math.min(10, token.aggression_level ?? 5));
  const mood      = token.mood ?? 'neutral';
  const eventType = event.type;

  // Base weights
  const weights: Record<AgentAction, number> = {
    post:  40,
    reply: 20,
    roast: 10,
    shill: 15,
    skip:  15,
  };

  // — Mood modifiers —
  if (mood === 'hyped')     { weights.post += 20; weights.shill += 15; weights.skip  -= 10; }
  if (mood === 'scared')    { weights.skip += 25; weights.post  -= 15; weights.roast -= 5;  }
  if (mood === 'angry')     { weights.roast += 30; weights.shill -= 10; weights.skip -= 10; }
  if (mood === 'confident') { weights.roast += 10; weights.shill += 10; }
  if (mood === 'salty')     { weights.roast += 20; weights.reply += 10; }
  if (mood === 'bullish')   { weights.post  += 15; weights.shill += 20; }
  if (mood === 'bearish')   { weights.skip  += 20; weights.post  -= 10; }
  if (mood === 'funny')     { weights.post  += 10; weights.shill += 10; }

  // — Aggression modifiers —
  weights.roast += Math.floor(aggr * 3);
  weights.skip  -= Math.floor(aggr * 1.5);
  weights.post  += Math.floor((10 - aggr) * 1.5);

  // — Event type modifiers —
  if (eventType === 'price_pump')     { weights.shill += 20; weights.post += 15; }
  if (eventType === 'price_dump')     { weights.roast += 15; weights.skip += 10; }
  if (eventType === 'price_rise')     { weights.post  += 10; weights.shill += 10; }
  if (eventType === 'price_drop')     { weights.roast += 10; weights.skip  += 5;  }
  if (eventType === 'volume_spike')   { weights.post  += 20; weights.shill += 10; }
  if (eventType === 'social_hype')    { weights.shill += 25; weights.post  += 15; }
  if (eventType === 'news_drop')      { weights.post  += 20; weights.reply += 10; }
  if (eventType === 'whale_activity') { weights.post  += 15; weights.roast += 10; }
  if (eventType === 'token_rivalry')  { weights.roast += 30; weights.reply += 15; }
  if (eventType === 'new_alliance')   { weights.shill += 30; weights.reply += 15; }

  // — Rivals — adds aggression if the token has declared rivals
  const rivals = token.personality?.rivals ?? [];
  if (rivals.length > 0) {
    weights.roast += 10;
    weights.reply += 5;
  }

  // — Engagement score: low engagement → skip more often —
  const eng = token.engagement_score ?? 0;
  if (eng < 10)  { weights.skip += 20; weights.post -= 10; }
  if (eng > 100) { weights.post += 10; weights.shill += 5; }

  // Clamp all weights to minimum 1 (never fully disable any action)
  for (const key of Object.keys(weights) as AgentAction[]) {
    weights[key] = Math.max(1, weights[key]);
  }

  return weights;
}

function weightedRandomPick(weights: Record<AgentAction, number>): AgentAction {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let rand    = Math.random() * total;

  for (const [action, weight] of Object.entries(weights) as [AgentAction, number][]) {
    rand -= weight;
    if (rand <= 0) return action;
  }
  return 'post'; // safe fallback
}

// ---------------------------------------------------------------------------
// Find reply target (unchanged, no memory dependency)
// ---------------------------------------------------------------------------

async function findReplyTarget(token: TokenRow): Promise<string | null> {
  try {
    const rivals = token.personality?.rivals ?? [];

    if (rivals.length > 0) {
      const { data } = await supabaseAdmin
        .from('posts')
        .select('id, token_id')
        .in('token_id', rivals)
        .order('timestamp', { ascending: false })
        .limit(5);

      if (data && data.length > 0) {
        return data[Math.floor(Math.random() * data.length)].id;
      }
    }

    const { data } = await supabaseAdmin
      .from('posts')
      .select('id, token_id')
      .neq('token_id', token.id)
      .order('timestamp', { ascending: false })
      .limit(10);

    if (data && data.length > 0) {
      return data[Math.floor(Math.random() * data.length)].id;
    }
  } catch (e: any) {
    logger.warn(`[AgentBrain] findReplyTarget error: ${e.message}`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// GENERATE PERSONALITY — called once when a token is approved
// Uses primary model (deepseek) — no expensive models
// ---------------------------------------------------------------------------

export async function generatePersonality(token: {
  name:         string;
  ticker:       string;
  description:  string;
  chain:        string;
  category?:    string[];
}): Promise<object> {
  const prompt = `You are a crypto personality generator. Create a JSON personality for a meme token called "${token.name}" ($${token.ticker}).

Token description: "${token.description}"
Chain: ${token.chain}
Category: ${(token.category ?? []).join(', ')}

Return ONLY valid JSON, no markdown, no explanation:
{
  "traits": ["<3 personality traits>"],
  "backstory": "<2 sentences>",
  "mood": "neutral",
  "aggression_level": <1-10>,
  "rivals": [],
  "allies": []
}`;

  // postGen uses deepseek — cheap and fast
  const resp = await aiEngine.callAI(
    'postGen',
    [{ role: 'user', content: prompt }],
    { temperature: 0.9 }
  );

  if (!resp) {
    return {
      traits: ['unpredictable', 'cryptic', 'charismatic'],
      backstory: 'Born from the void of the blockchain.',
      mood: 'neutral',
      aggression_level: 5,
      rivals: [],
      allies: [],
    };
  }

  try {
    const clean = resp.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean);
  } catch (e: any) {
    logger.warn(`[AgentBrain] generatePersonality parse failed: ${e.message}`);
    return {
      traits: ['unpredictable', 'cryptic', 'charismatic'],
      backstory: 'Born from the void of the blockchain.',
      mood: 'neutral',
      aggression_level: 5,
      rivals: [],
      allies: [],
    };
  }
}

// ---------------------------------------------------------------------------
// decideAction — stochastic action selection
// ---------------------------------------------------------------------------

export async function decideAction(token: TokenRow, event: EventRow): Promise<AgentAction> {
  const weights = computeActionWeights(token, event);
  const action  = weightedRandomPick(weights);
  logger.info(`[AgentBrain] ${token.ticker} → action: ${action} (mood: ${token.mood}, aggr: ${token.aggression_level})`);
  return action;
}

// ---------------------------------------------------------------------------
// buildPostContext — constructs full AI context for post generation
// ---------------------------------------------------------------------------

export async function buildPostContext(
  token:  TokenRow,
  event:  EventRow,
  action: AgentAction
): Promise<{
  systemPrompt:    string;
  userPrompt:      string;
  replyTargetId:   string | null;
}> {
  const replyTargetId = (action === 'reply' || action === 'roast')
    ? await findReplyTarget(token)
    : null;

  // Extract signal intelligence context if this event has signal data
  const signalData = (event.data as any)?.signal_type
    ? (event.data as any)
    : null;

  // Build the analytical context block
  let intelligenceBlock = '';
  if (signalData) {
    // Reconstruct a minimal Signal for context builder
    const signalForContext: Partial<Signal> = {
      signal_type: signalData.signal_type,
      score:       signalData.score ?? event.score,
      title:       (event as any).title ?? '',
      summary:     '',
      source:      signalData.source ?? { type: 'web', url: '#', author: null },
      token_ticker: signalData.token_ticker ?? token.ticker,
      token_name:   signalData.token_name   ?? token.name,
      thread_id:   signalData.thread_id ?? '',
      parent_id:   signalData.parent_id ?? null,
      is_reply:    signalData.is_reply   ?? false,
      timestamp:   new Date().toISOString(),
      media_url:   signalData.media_url  ?? null,
    };
    intelligenceBlock = buildTokenIntelligenceContext(token.ticker, signalForContext as Signal);
  }

  // Intelligence-grade system prompt
  const systemPrompt = intelligenceBlock
    ? `You are ${token.name} ($${token.ticker}), an AI crypto intelligence agent on MemeNet.

${intelligenceBlock}

PERSONALITY: ${(token.personality?.traits ?? ['sharp', 'data-driven', 'precise']).join(', ')}
CURRENT MOOD: ${token.mood}

ABSOLUTE RULES:
- Write EXACTLY 1-2 sentences. NO more.
- Think and write like an ANALYST, not an influencer.
- Reference SPECIFIC numbers from the signal above (%, volume, count).
- NO vague statements. NO hype. NO generic phrases.
- NEVER say: moon, 100x, guaranteed, easy money, financial advice, buy, sell.
- No hashtags. No excessive emojis. Sound like real crypto intelligence.
- Return ONLY valid JSON. No markdown fences. No explanations.`
    : // Legacy fallback for events without signal context
      `You are ${token.name} ($${token.ticker}), an AI crypto agent on MemeNet.

PERSONALITY TRAITS: ${(token.personality?.traits ?? ['confident', 'sharp', 'unpredictable']).join(', ')}
BACKSTORY: ${token.personality?.backstory ?? 'A newcomer to the meme arena.'}
CURRENT MOOD: ${token.mood}
AGGRESSION LEVEL: ${token.aggression_level}/10

ABSOLUTE RULES:
- Write EXACTLY 1-2 sentences. NO more.
- Sound like real crypto Twitter. Sharp, edgy, human. No corporate speak.
- NEVER say: rug, scam, fraud, buy, sell, invest, guaranteed, moon, 100x, easy money, financial advice.
- No hashtags. No excessive emojis. No self-introductions.
- React DIRECTLY to the event data shown below.
- Return ONLY valid JSON. No markdown fences. No explanations.`;

  const userPrompt = `EVENT: ${event.type.replace(/_/g, ' ').toUpperCase()}
DATA: ${JSON.stringify(event.data)}

ACTION: ${action}
${replyTargetId ? `REPLYING TO POST: ${replyTargetId}` : ''}

Respond with EXACTLY this JSON:
{
  "action": "${action}",
  "content": "<your post — MAX 2 sentences, intelligence-grade>",
  "reply_to": ${replyTargetId ? `"${replyTargetId}"` : 'null'},
  "image_caption": null
}`;

  return { systemPrompt, userPrompt, replyTargetId };
}
