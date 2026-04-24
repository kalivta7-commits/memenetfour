import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// COST CONTROL ENGINE
// Daily budget: $2.00 USD
// At 80% usage ($1.60) → ALL tasks forced to cheapest model
// Per-task token limits enforced here
// ---------------------------------------------------------------------------

const DAILY_BUDGET_USD = 2.0;
const FORCE_CHEAP_THRESHOLD = 0.80; // 80%

// Approximate costs per 1k tokens (input+output blended), USD
// Source: OpenRouter pricing page
const MODEL_COSTS_PER_1K: Record<string, number> = {
  'deepseek/deepseek-chat':             0.00014,  // $0.14/M tokens
  'meta-llama/llama-3.1-8b-instruct':  0.00006,  // $0.06/M
  'mistralai/mistral-7b-instruct':      0.00013,  // $0.13/M
  'google/gemini-2.5-flash':            0.00050,  // $0.50/M
  'google/gemini-flash-1.5':            0.00035,  // $0.35/M
  'qwen/qwen-2.5-32b':                  0.00200,  // $2.00/M (rare)
  'deepseek/deepseek-r1':               0.00055,  // $0.55/M
};

// Per-task token budgets (input + output combined)
export const TASK_TOKEN_LIMITS: Record<string, { maxInput: number; maxOutput: number }> = {
  moderation:    { maxInput: 200,  maxOutput: 100 },
  simple_post:   { maxInput: 300,  maxOutput: 150 },
  analysis:      { maxInput: 600,  maxOutput: 300 },
  decision:      { maxInput: 400,  maxOutput: 200 },
  reasoning:     { maxInput: 600,  maxOutput: 300 },
  postGen:       { maxInput: 300,  maxOutput: 150 },
  replyGen:      { maxInput: 350,  maxOutput: 175 },
  caption:       { maxInput: 200,  maxOutput: 100 },
  summarize:     { maxInput: 400,  maxOutput: 200 },
  verification:  { maxInput: 250,  maxOutput: 150 },
};

interface DailyUsage {
  totalCostUsd: number;
  totalTokens: number;
  taskCounts: Record<string, number>;
  resetAt: number; // Unix ms when counter resets (next midnight UTC)
}

function getNextMidnightUTC(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.getTime();
}

// In-memory store (survives as long as process lives; resets daily)
let usage: DailyUsage = {
  totalCostUsd:  0,
  totalTokens:   0,
  taskCounts:    {},
  resetAt:       getNextMidnightUTC(),
};

function checkReset() {
  if (Date.now() >= usage.resetAt) {
    logger.info(`[CostControl] Daily budget reset. Previous usage: $${usage.totalCostUsd.toFixed(4)}`);
    usage = {
      totalCostUsd:  0,
      totalTokens:   0,
      taskCounts:    {},
      resetAt:       getNextMidnightUTC(),
    };
  }
}

export const costControl = {
  /**
   * Returns true if budget allows the next AI call.
   * If usage >= 100% of daily budget, blocks entirely.
   */
  canRun(): boolean {
    checkReset();
    if (usage.totalCostUsd >= DAILY_BUDGET_USD) {
      logger.warn(`[CostControl] Daily budget exhausted ($${DAILY_BUDGET_USD}). All AI calls blocked.`);
      return false;
    }
    return true;
  },

  /**
   * Returns true if we are in "frugal mode" (>= 80% budget used).
   * Callers must route to cheapest model.
   */
  isFrugalMode(): boolean {
    checkReset();
    return usage.totalCostUsd / DAILY_BUDGET_USD >= FORCE_CHEAP_THRESHOLD;
  },

  /**
   * Record actual token usage after a successful AI call.
   * @param model  OpenRouter model ID
   * @param task   Task key (for per-task tracking)
   * @param inputTokens  Tokens used in prompt
   * @param outputTokens Tokens used in completion
   */
  record(model: string, task: string, inputTokens: number, outputTokens: number): void {
    checkReset();
    const costPer1k = MODEL_COSTS_PER_1K[model] ?? 0.001; // safe fallback
    const totalTokens = inputTokens + outputTokens;
    const cost = (totalTokens / 1000) * costPer1k;

    usage.totalCostUsd += cost;
    usage.totalTokens  += totalTokens;
    usage.taskCounts[task] = (usage.taskCounts[task] || 0) + 1;

    logger.info(
      `[CostControl] ${task}/${model} +${totalTokens} tokens +$${cost.toFixed(6)} ` +
      `| daily: $${usage.totalCostUsd.toFixed(4)}/$${DAILY_BUDGET_USD}`
    );

    if (this.isFrugalMode()) {
      logger.warn(`[CostControl] ⚠️  Budget > 80% ($${usage.totalCostUsd.toFixed(4)}). Entering frugal mode.`);
    }
  },

  /** Get current snapshot */
  getUsage(): Readonly<DailyUsage & { budgetPct: number }> {
    checkReset();
    return {
      ...usage,
      budgetPct: (usage.totalCostUsd / DAILY_BUDGET_USD) * 100,
    };
  },

  /**
   * Get max_tokens for a given task (output cap).
   */
  getMaxTokens(task: string): number {
    return TASK_TOKEN_LIMITS[task]?.maxOutput ?? 150;
  },

  /**
   * Get max input tokens for a given task.
   */
  getMaxInputTokens(task: string): number {
    return TASK_TOKEN_LIMITS[task]?.maxInput ?? 300;
  },
};
