import axios from 'axios';
import { logger } from '../utils/logger';
import { costControl } from './costControl';

// ---------------------------------------------------------------------------
// STRICT MODEL POLICY — enforced globally
//
// PRIMARY:  deepseek/deepseek-chat       (cheapest + fast)
// FALLBACK: meta-llama/llama-3.1-8b-instruct
//
// FORBIDDEN: claude, qwen, gemini, gpt-4, or any other model
// ALL calls go through OpenRouter API
// ---------------------------------------------------------------------------

const PRIMARY_MODEL  = 'deepseek/deepseek-chat';
const FALLBACK_MODEL = 'meta-llama/llama-3.1-8b-instruct';

// All task types — all route to the same primary model per policy
export type AiTask =
  | 'postGen'
  | 'replyGen'
  | 'simple_post'
  | 'moderation'
  | 'verification'
  | 'summarize'
  | 'reasoning'
  | 'analysis'
  | 'decision'
  | 'caption';

// ---------------------------------------------------------------------------
// Per-task output token limits (kept conservative for cost control)
// The PRIMARY model handles all tasks; token limits enforce brevity
// ---------------------------------------------------------------------------

const TASK_MAX_TOKENS: Record<AiTask, number> = {
  postGen:       150,
  replyGen:      175,
  simple_post:   120,
  moderation:    100,
  verification:  150,
  summarize:     200,
  reasoning:     300,
  analysis:      300,
  decision:      200,
  caption:       100,
};

// ---------------------------------------------------------------------------
// OpenRouter HTTP call
// ---------------------------------------------------------------------------

interface OpenRouterResult {
  content:       string;
  inputTokens:   number;
  outputTokens:  number;
  modelUsed:     string;
}

async function callOpenRouter(
  model:       string,
  messages:    Array<{ role: string; content: string }>,
  maxTokens:   number,
  temperature: number
): Promise<OpenRouterResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const { data } = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    },
    {
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'https://memenet.app',
        'X-Title':      'MemeNet',
      },
      timeout: 30_000,
    }
  );

  const content      = (data.choices?.[0]?.message?.content ?? '').trim();
  const inputTokens  = data.usage?.prompt_tokens    ?? Math.ceil(JSON.stringify(messages).length / 4);
  const outputTokens = data.usage?.completion_tokens ?? Math.ceil(content.length / 4);

  return { content, inputTokens, outputTokens, modelUsed: model };
}

// ---------------------------------------------------------------------------
// AI Engine — main export
// ---------------------------------------------------------------------------

export const aiEngine = {
  /**
   * Route task to the correct model. Per strict policy:
   * - If budget > 80% (frugal mode): PRIMARY (still deepseek)
   * - Normal: PRIMARY (deepseek)
   * - On failure: FALLBACK (llama-3.1-8b)
   * All other models are forbidden.
   */
  routeModel(_task: AiTask): string {
    // All tasks use the primary model regardless of type.
    // Budget frugal mode makes no difference here since both options are cheap.
    return PRIMARY_MODEL;
  },

  /**
   * Main entry: calls AI with automatic model routing + fallback chain.
   * Primary: deepseek/deepseek-chat
   * Fallback: meta-llama/llama-3.1-8b-instruct
   */
  async callAI(
    task:     AiTask,
    messages: Array<{ role: string; content: string }>,
    options?: { temperature?: number }
  ): Promise<string | null> {
    if (!costControl.canRun()) {
      logger.warn(`[AI] Daily budget exhausted — task "${task}" skipped.`);
      return null;
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      logger.warn('[AI] OPENROUTER_API_KEY missing — AI disabled.');
      return null;
    }

    const maxTokens   = TASK_MAX_TOKENS[task] ?? 150;
    const temperature = options?.temperature  ?? 0.88;

    // Try primary → fallback
    const modelChain = [PRIMARY_MODEL, FALLBACK_MODEL];

    for (const model of modelChain) {
      try {
        logger.info(`[AI] Calling ${model} for task "${task}"`);
        const result = await callOpenRouter(model, messages, maxTokens, temperature);

        if (!result.content) {
          logger.warn(`[AI] ${model} returned empty content for task "${task}" — trying fallback.`);
          continue;
        }

        // Record cost
        costControl.record(model, task, result.inputTokens, result.outputTokens);
        logger.info(`[AI] ${model} succeeded for task "${task}" (${result.outputTokens} output tokens)`);
        return result.content;

      } catch (err: any) {
        const status = err.response?.status;
        logger.warn(`[AI] ${model} failed for task "${task}" (HTTP ${status ?? 'network'}): ${err.message}`);
        // Continue to fallback
      }
    }

    logger.error(`[AI] All models failed for task "${task}" — chain exhausted.`);
    return null;
  },

  /**
   * Direct model execution — for cases where caller explicitly names a model.
   * Still enforces the allowed list.
   */
  async executeOpenRouter(
    model:       string,
    messages:    Array<{ role: string; content: string }>,
    maxTokens:   number,
    temperature: number
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    // Enforce allowed models
    const allowedModels = [PRIMARY_MODEL, FALLBACK_MODEL];
    const safeModel = allowedModels.includes(model) ? model : PRIMARY_MODEL;

    if (safeModel !== model) {
      logger.warn(`[AI] Model "${model}" is forbidden — routing to ${PRIMARY_MODEL} instead.`);
    }

    const result = await callOpenRouter(safeModel, messages, maxTokens, temperature);
    return {
      content:       result.content,
      inputTokens:   result.inputTokens,
      outputTokens:  result.outputTokens,
    };
  },
};
