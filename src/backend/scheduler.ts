import cron from 'node-cron';
import { supabaseAdmin } from './utils/supabase';
import { eventEngine } from './services/eventEngine';
import { postEngine } from './services/postEngine';
import { tokenEngine } from './services/tokenEngine';
import { validationEngine } from './services/validationEngine';
import { decideAction, shouldPost } from './services/agentBrain';
import { costControl } from './services/costControl';
import { logger } from './utils/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_AGENTS = 5;   // max tokens processed per cycle
const AGGRESSION_DECAY_CYCLES = 3;   // decay aggression every N cycles

let cycleCount = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// ---------------------------------------------------------------------------
// getUnprocessedEvents
// Fetches events ordered by score DESC. Min score 30.
// ---------------------------------------------------------------------------

async function getUnprocessedEvents() {
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('*')
    .eq('processed', false)
    .gte('score', 30)
    .order('score', { ascending: false })
    .order('timestamp', { ascending: false })
    .limit(30);

  if (error) {
    logger.warn('[Scheduler] Failed to fetch unprocessed events: ' + error.message);
    return [];
  }
  return data ?? [];
}

// ---------------------------------------------------------------------------
// getRandomActiveToken
// Used when a global event (no token_id) needs an agent assigned.
// ---------------------------------------------------------------------------

async function getRandomActiveToken() {
  const { data, error } = await supabaseAdmin
    .from('tokens')
    .select('*')
    .eq('status', 'active')
    .neq('is_deleted', true)
    .or('is_active.eq.true,is_active.is.null')
    .limit(20);

  if (error || !data || data.length === 0) return null;
  // Pick a random one so load is spread across agents
  return data[Math.floor(Math.random() * data.length)];
}

// ---------------------------------------------------------------------------
// getActiveTokenForEvent
// CRITICAL FIX: .or('is_active.eq.true,is_active.is.null') — NULL = active
// ---------------------------------------------------------------------------

async function getActiveTokenForEvent(tokenId: string) {
  const { data, error } = await supabaseAdmin
    .from('tokens')
    .select('*')
    .eq('id', tokenId)
    .eq('status', 'active')
    .neq('is_deleted', true)
    .or('is_active.eq.true,is_active.is.null')
    .single();

  if (error || !data) return null;
  return data;
}

// ---------------------------------------------------------------------------
// setTyping / markEventProcessed
// ---------------------------------------------------------------------------

async function setTyping(tokenId: string, isTyping: boolean) {
  await supabaseAdmin
    .from('tokens')
    .update({ is_typing: isTyping })
    .eq('id', tokenId);
}

async function markEventProcessed(eventId: string) {
  await supabaseAdmin
    .from('events')
    .update({ processed: true })
    .eq('id', eventId);
}

// ---------------------------------------------------------------------------
// decayAggression — run every AGGRESSION_DECAY_CYCLES
// ---------------------------------------------------------------------------

async function decayAggression() {
  try {
    const { data: tokens } = await supabaseAdmin
      .from('tokens')
      .select('id, aggression_level')
      .eq('status', 'active')
      .or('is_active.eq.true,is_active.is.null')
      .gt('aggression_level', 1);

    if (!tokens || tokens.length === 0) return;

    for (const t of tokens) {
      await supabaseAdmin
        .from('tokens')
        .update({ aggression_level: Math.max(1, (t.aggression_level ?? 5) - 1) })
        .eq('id', t.id);
    }

    logger.info(`[Scheduler] Aggression decayed for ${tokens.length} token(s).`);
  } catch (e: any) {
    logger.warn('[Scheduler] Aggression decay failed: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// resetDailyPostCounts — UTC midnight
// ---------------------------------------------------------------------------

async function resetDailyPostCounts() {
  try {
    await supabaseAdmin
      .from('tokens')
      .update({ posts_today: 0 })
      .eq('status', 'active');
    logger.info('[Scheduler] Daily post counts reset.');
  } catch (e: any) {
    logger.warn('[Scheduler] Post count reset failed: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// processEvent — full AI pipeline for a single event + token pair
// ---------------------------------------------------------------------------

async function processEvent(event: any, token: any): Promise<boolean> {
  // shouldPost() — single source of truth
  const eligibility = shouldPost(event, token);
  if (!eligibility.should) {
    logger.info(`[Scheduler] Skipping ${token.ticker} — ${eligibility.reason}.`);
    return false;
  }

  await setTyping(token.id, true);

  try {
    // Agent decides action
    const action = await decideAction(token, event);

    if (action === 'skip') {
      logger.info(`[Scheduler] ${token.ticker} skipped event "${event.type}".`);
      return false;
    }

    // Generate content via AI
    const output = await postEngine.generate(token, event, action);

    if (!output || !output.content || !validationEngine.passes(output.content)) {
      logger.warn(`[Scheduler] ${token.ticker} post invalid — discarding.`);
      return false;
    }

    // Save post + update token state
    await postEngine.save(token, output, event);
    await tokenEngine.updateAfterPost(token, event, output);

    logger.info(`[Scheduler] ✅ ${token.ticker} posted [${action}]: "${output.content.slice(0, 70)}..."`);
    return true;

  } finally {
    await setTyping(token.id, false);
  }
}

// ---------------------------------------------------------------------------
// runCycle — main pipeline
// ---------------------------------------------------------------------------

async function runCycle() {
  cycleCount++;

  if (!costControl.canRun()) {
    logger.warn('[Scheduler] Daily budget exhausted — skipping cycle.');
    return;
  }

  try {
    // ── Step 1: Data refresh + new event emission ─────────────────────────────
    await eventEngine.runCycle();

    // ── Step 2: Load unprocessed events ─────────────────────────────────────
    const events = await getUnprocessedEvents();

    if (events.length === 0) {
      logger.info('[Scheduler] No unprocessed events this cycle.');
      return;
    }

    // ── Step 3: Assign token to each event, deduplicate by token ────────────
    // token-specific events: look up their own token
    // global events (no token_id): assign a random active token

    const paired: Array<{ event: any; token: any }> = [];
    const usedTokenIds = new Set<string>();

    for (const event of events) {
      if (paired.length >= MAX_CONCURRENT_AGENTS) break;

      let token: any = null;

      if (event.token_id) {
        // Skip if we already have this token in this cycle
        if (usedTokenIds.has(event.token_id)) continue;
        token = await getActiveTokenForEvent(event.token_id);
      } else {
        // Global event: assign a random active token not yet used
        const candidate = await getRandomActiveToken();
        if (!candidate || usedTokenIds.has(candidate.id)) continue;
        token = candidate;
      }

      if (!token) continue;

      usedTokenIds.add(token.id);
      paired.push({ event, token });
    }

    logger.info(`[Scheduler] Cycle #${cycleCount}: ${paired.length} agent(s) processing.`);

    // ── Step 4: Run pipeline for each event/token pair ───────────────────────
    for (const { event, token } of paired) {
      const posted = await processEvent(event, token);
      await markEventProcessed(event.id);

      if (posted) {
        // Stagger between agents — human-like feel
        await delay(Math.floor(Math.random() * 4000) + 2000);
      }
    }

    // ── Step 5: Periodic aggression decay ───────────────────────────────────
    if (cycleCount % AGGRESSION_DECAY_CYCLES === 0) {
      await decayAggression();
    }

  } catch (err: any) {
    logger.error(`[Scheduler] runCycle error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// startScheduler — entry point called from server.ts
// ---------------------------------------------------------------------------

export function startScheduler() {
  logger.info('[Scheduler] Starting...');

  // Run one initial cycle immediately on startup
  runCycle().catch(err => logger.error('[Scheduler] Initial cycle error: ' + err.message));

  // Main cycle — every 15 seconds
  cron.schedule('*/15 * * * * *', () => {
    runCycle().catch(err => logger.error('[Scheduler] Cycle error: ' + err.message));
  });

  // Daily reset at UTC midnight
  cron.schedule('0 0 * * *', () => {
    resetDailyPostCounts().catch(err => logger.error('[Scheduler] Reset failed: ' + err.message));
  });

  logger.info('[Scheduler] ✅ Active — 15s cycle, UTC midnight reset.');
}
