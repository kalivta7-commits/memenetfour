import { logger } from '../utils/logger';
import { supabaseAdmin } from '../utils/supabase';
import {
  getMarketData,
  getDexData,
  getTokenTweets,
  getNews,
} from './dataEngine';
import { buildSignal } from './signalEngine';
import type { Signal } from './signalEngine';
import { parseCoinGeckoId } from '../utils/parseCoinGeckoId';

// ---------------------------------------------------------------------------
// EVENT ENGINE — Signal Intelligence Edition
//
// Rules:
//   1. NO fake / template content — ever.
//   2. If real data is weak → no_signal → nothing written.
//   3. All events include: signal_type, source, thread_id, media_url.
//   4. Dedup: same token + same signal_type within 60s is skipped.
// ---------------------------------------------------------------------------

export type EventType =
  | 'price_pump'
  | 'price_dump'
  | 'price_rise'
  | 'price_drop'
  | 'volume_spike'
  | 'social_hype'
  | 'news_drop'
  | 'whale_activity'
  | 'token_rivalry'
  | 'new_alliance'
  | 'market_overview'
  | 'social_trend'
  | 'onchain'
  | 'market_quiet'
  | 'price_watch'
  // Signal intelligence types (new)
  | 'social_spike'
  | 'news_event'
  | 'market_movement'
  | 'liquidity_event';

const DEDUP_WINDOW_MS = 60_000;
const MAX_EVENTS_PER_TOKEN_PER_MINUTE = 5;

export const eventEngine = {

  async runCycle() {
    logger.info('[EventEngine] Running signal intelligence cycle...');
    await this.processAllTokens();
  },

  async isRateLimited(tokenId: string): Promise<boolean> {
    try {
      const { count } = await supabaseAdmin
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('token_id', tokenId)
        .gte('created_at', new Date(Date.now() - 60_000).toISOString());
      return (count ?? 0) >= MAX_EVENTS_PER_TOKEN_PER_MINUTE;
    } catch {
      return false;
    }
  },

  async processAllTokens() {
    try {
      const { data: tokens, error } = await supabaseAdmin
        .from('tokens')
        .select('id, name, ticker, coingecko_id, coingecko_url, dex_url, contract_address, chain')
        .eq('status', 'active')
        .or('is_active.eq.true,is_active.is.null')
        .neq('is_deleted', true);

      if (error) {
        logger.warn('[EventEngine] Token fetch failed: ' + error.message);
        return;
      }

      if (!tokens || tokens.length === 0) {
        logger.info('[EventEngine] No active tokens found.');
        return;
      }

      logger.info(`[EventEngine] Processing ${tokens.length} token(s) for signals...`);

      for (const token of tokens) {
        await this.processToken(token);
      }
    } catch (e: any) {
      logger.error('[EventEngine] processAllTokens error: ' + e.message);
    }
  },

  async processToken(token: {
    id: string;
    name: string;
    ticker: string;
    coingecko_id: string | null;
    coingecko_url?: string | null;
    dex_url?: string | null;
    contract_address: string | null;
    chain: string | null;
  }) {
    try {
      if (await this.isRateLimited(token.id)) {
        logger.info(`[EventEngine] ${token.ticker} — rate limit reached, skipping.`);
        return;
      }

      // Resolve the effective CoinGecko ID:
      // Prefer the stored coingecko_id; fall back to parsing from coingecko_url
      // (covers tokens submitted before the parseCoinGeckoId fix was applied)
      const effectiveCoinGeckoId: string | null =
        token.coingecko_id ||
        parseCoinGeckoId(token.coingecko_url) ||
        null;

      // If we parsed out a fresh ID, persist it so we don't re-parse every cycle
      if (!token.coingecko_id && effectiveCoinGeckoId) {
        supabaseAdmin
          .from('tokens')
          .update({ coingecko_id: effectiveCoinGeckoId })
          .eq('id', token.id)
          .then();
      }

      // Fetch all data sources concurrently
      const [marketResult, dexResult, tweetResult, newsResult] = await Promise.allSettled([
        effectiveCoinGeckoId   ? getMarketData(effectiveCoinGeckoId)    : Promise.resolve(null),
        token.contract_address ? getDexData(token.contract_address)     : Promise.resolve(null),
        getTokenTweets(token.ticker),
        getNews(token.name),
      ]);

      const market = marketResult.status === 'fulfilled' ? marketResult.value : null;
      const dex    = dexResult.status    === 'fulfilled' ? dexResult.value    : null;
      const tweets = tweetResult.status  === 'fulfilled' ? tweetResult.value  : null;
      const news   = newsResult.status   === 'fulfilled' ? newsResult.value   : null;

      // Update token price in DB if we have market data (non-blocking)
      if (market?.source === 'coingecko' && market.price_usd) {
        supabaseAdmin.from('tokens').update({
          price_usd:        market.price_usd,
          volume_24h:       market.volume_24h,
          price_change_24h: market.price_change_24h,
          market_cap:       market.market_cap,
        }).eq('id', token.id).then();
      } else if (dex?.source === 'dexscreener' && dex.price_usd) {
        supabaseAdmin.from('tokens').update({
          price_usd:        parseFloat(dex.price_usd as string),
          volume_24h:       dex.volume_24h,
          price_change_24h: dex.price_change_1h,
        }).eq('id', token.id).then();
      }

      // Build signal via intelligence engine
      const signal = await buildSignal(
        {
          id:               token.id,
          name:             token.name,
          ticker:           token.ticker,
          coingecko_id:     effectiveCoinGeckoId,
          contract_address: token.contract_address,
        },
        market,
        dex,
        tweets,
        news,
      );

      // no_signal → skip writing anything
      // Use explicit type guard: NoSignal has { type: 'no_signal' }, Signal has { signal_type }
      const isNoSignal = !('signal_type' in signal);
      if (isNoSignal) {
        logger.info(`[EventEngine] ${token.ticker} → no_signal (${(signal as any).reason})`);
        return;
      }

      const realSignal = signal as Signal;

      // Dedup check: same signal_type in last 60s for this token
      const { data: recent } = await supabaseAdmin
        .from('events')
        .select('id')
        .eq('token_id', token.id)
        .gte('created_at', new Date(Date.now() - DEDUP_WINDOW_MS).toISOString())
        .limit(1);

      if (recent && recent.length > 0) {
        logger.info(`[EventEngine] ${token.ticker} → duplicate within 60s, skipping.`);
        return;
      }

      // Save the signal as an event
      await this.saveSignalEvent(token.id, realSignal);

    } catch (e: any) {
      logger.warn(`[EventEngine] processToken error for ${token.ticker}: ${e.message}`);
    }
  },

  async saveSignalEvent(tokenId: string, signal: Signal): Promise<boolean> {
    if (signal.score < 30) {
      logger.info(`[EventEngine] Signal score too low (${signal.score}), skipping.`);
      return false;
    }

    try {
      const { error } = await supabaseAdmin.from('events').insert({
        // Core event fields (existing schema — unchanged)
        type:       signal.signal_type,
        token_id:   tokenId,
        score:      signal.score,
        title:      signal.title,
        content:    signal.summary,
        source:     signal.source.type,
        processed:  false,
        timestamp:  signal.timestamp,
        created_at: signal.timestamp,

        // All signal intelligence fields stored in data JSONB
        // (no schema changes needed)
        data: {
          signal_type: signal.signal_type,
          token_ticker: signal.token_ticker,
          token_name:   signal.token_name,
          score:        signal.score,
          media_url:    signal.media_url,
          source: {
            type:   signal.source.type,
            url:    signal.source.url,
            author: signal.source.author,
          },
          thread_id:  signal.thread_id,
          parent_id:  signal.parent_id,
          is_reply:   signal.is_reply,
        },
      });

      if (error) {
        logger.error('[EventEngine] saveSignalEvent error: ' + error.message);
        return false;
      }

      logger.info(`[EventEngine] ✅ Signal saved: ${signal.signal_type} → ${signal.token_ticker} (score: ${signal.score}, thread: ${signal.is_reply ? 'reply' : 'root'})`);
      return true;

    } catch (e: any) {
      logger.error('[EventEngine] saveSignalEvent exception: ' + e.message);
      return false;
    }
  },

  // Kept for backward compatibility with scheduler — delegates to saveSignalEvent logic
  async saveEvent(
    type:     EventType,
    tokenId:  string,
    score:    number,
    data:     Record<string, any>,
    title?:   string,
    content?: string,
  ): Promise<boolean> {
    if (score < 30) return false;

    try {
      const { data: recent } = await supabaseAdmin
        .from('events')
        .select('id')
        .eq('token_id', tokenId)
        .eq('type', type)
        .gte('created_at', new Date(Date.now() - DEDUP_WINDOW_MS).toISOString())
        .limit(1);

      if (recent && recent.length > 0) {
        logger.info(`[EventEngine] ${type} → ${tokenId} — dedup window, skipping.`);
        return false;
      }

      const { error } = await supabaseAdmin.from('events').insert({
        type,
        token_id:   tokenId,
        score,
        data,
        title:      title   ?? type.replace(/_/g, ' '),
        content:    content ?? '',
        source:     data.source ?? 'system',
        processed:  false,
        timestamp:  new Date().toISOString(),
        created_at: new Date().toISOString(),
      });

      if (error) {
        logger.error('[EventEngine] saveEvent error: ' + error.message);
        return false;
      }

      logger.info(`[EventEngine] Event saved: ${type} → token ${tokenId} (score ${score})`);
      return true;

    } catch (e: any) {
      logger.error('[EventEngine] saveEvent exception: ' + e.message);
      return false;
    }
  },
};
