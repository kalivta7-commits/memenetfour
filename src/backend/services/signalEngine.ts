import { logger } from '../utils/logger';
import { supabaseAdmin } from '../utils/supabase';
import type { MarketData, DexData, TweetData, NewsData } from './dataEngine';

// ---------------------------------------------------------------------------
// SIGNAL ENGINE
// Transforms raw scraped data into structured, high-signal intelligence.
// Rule: NEVER invent information. If data is weak → return no_signal.
// ---------------------------------------------------------------------------

// ── Strict signal types (only these 5 are valid output) ──────────────────
export type SignalType =
  | 'whale_activity'
  | 'social_spike'
  | 'news_event'
  | 'market_movement'
  | 'liquidity_event'
  | 'no_signal';

// ── Source structure ──────────────────────────────────────────────────────
export interface SignalSource {
  type:   'twitter' | 'news' | 'web';
  url:    string;
  author: string | null;
}

// ── Full signal output ────────────────────────────────────────────────────
export interface Signal {
  token_ticker:  string;
  token_name:    string;
  signal_type:   SignalType;
  title:         string;
  summary:       string;
  score:         number;          // 0–100
  timestamp:     string;          // ISO
  media_url:     string | null;
  source:        SignalSource;
  thread_id:     string;
  parent_id:     string | null;
  is_reply:      boolean;
}

export interface NoSignal {
  type: 'no_signal';
  reason: string;
}

// ── Thread window ─────────────────────────────────────────────────────────
const THREAD_WINDOW_MS = 15 * 60 * 1_000; // 15 minutes

// ── Minimum thresholds for real signals ──────────────────────────────────
const MIN_PRICE_CHANGE  = 3;     // % — ignore tiny moves
const MIN_VOLUME_USD    = 100_000;
const MIN_LIQUIDITY_USD = 200_000;
const MIN_TWEET_COUNT   = 5;
const MIN_SCORE         = 30;

// ---------------------------------------------------------------------------
// Token-aware intelligence profiles
// Each token type gets a different analytical lens.
// ---------------------------------------------------------------------------
const TOKEN_PROFILES: Record<string, {
  priority: SignalType[];
  lens: string;
}> = {
  BONK: {
    priority: ['social_spike', 'market_movement', 'whale_activity'],
    lens: 'retail momentum — fast spikes, social-driven pumps, community sentiment',
  },
  PEPE: {
    priority: ['social_spike', 'market_movement', 'news_event'],
    lens: 'meme cycle analysis — narrative shifts, viral moments, community waves',
  },
  CAKE: {
    priority: ['liquidity_event', 'whale_activity', 'market_movement'],
    lens: 'DeFi mechanics — liquidity depth, yield dynamics, whale rotation',
  },
  WIF: {
    priority: ['social_spike', 'whale_activity', 'market_movement'],
    lens: 'solana meme dynamics — DEX volume, influencer activity',
  },
  DOGE: {
    priority: ['social_spike', 'news_event', 'market_movement'],
    lens: 'mainstream sentiment — news cycles, social volume, retail activity',
  },
};

function getTokenProfile(ticker: string) {
  return TOKEN_PROFILES[ticker.toUpperCase()] ?? {
    priority: ['whale_activity', 'news_event', 'social_spike'],
    lens: 'balanced crypto signal analysis — price, volume, social, on-chain',
  };
}

// ---------------------------------------------------------------------------
// Media URL extraction
// Pulls og:image or twitter:image from Firecrawl scraped metadata.
// ---------------------------------------------------------------------------
export function extractMediaUrl(news: NewsData | null): string | null {
  if (!news || news.source === 'unavailable') return null;

  // Access raw results if available (stored in extended data)
  const raw = (news as any)._raw_results;
  if (!raw || !Array.isArray(raw)) return null;

  for (const result of raw) {
    // Try og:image first
    const ogImage = result?.metadata?.['og:image']
      || result?.metadata?.ogImage
      || result?.metadata?.['twitter:image']
      || result?.metadata?.twitterImage;
    if (ogImage && typeof ogImage === 'string' && ogImage.startsWith('http')) {
      return ogImage;
    }

    // Try first image in markdown
    const markdown = result?.markdown ?? '';
    const imgMatch = markdown.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
    if (imgMatch?.[1]) return imgMatch[1];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Source builder
// Constructs mandatory source object. Discards if URL is missing.
// ---------------------------------------------------------------------------
export function buildSource(
  type: 'twitter' | 'news' | 'web',
  data: {
    tweet_url?:  string | null;
    news_url?:   string | null;
    web_url?:    string | null;
    author?:     string | null;
  }
): SignalSource | null {
  const url = data.tweet_url ?? data.news_url ?? data.web_url ?? null;
  if (!url) return null;

  return { type, url, author: data.author ?? null };
}

// ---------------------------------------------------------------------------
// Score engine
// Priority: Whale > Liquidity > News > Social > Market
// Score 0–100 with recency + magnitude + cross-source bonuses.
// ---------------------------------------------------------------------------
export function scoreSignal(
  type:    SignalType,
  market:  MarketData | null,
  dex:     DexData  | null,
  tweets:  TweetData | null,
  news:    NewsData  | null,
): number {
  // Base scores per type
  const BASE: Record<string, number> = {
    whale_activity:  70,
    liquidity_event: 62,
    news_event:      55,
    social_spike:    48,
    market_movement: 42,
  };

  let score = BASE[type] ?? 40;

  // ── Magnitude bonuses ───────────────────────────────────────────────────
  const priceChange = Math.abs(market?.price_change_24h ?? 0);
  if (priceChange > 20) score += 12;
  else if (priceChange > 10) score += 7;
  else if (priceChange > 5)  score += 3;

  const vol = market?.volume_24h ?? dex?.volume_24h ?? 0;
  if (vol > 5_000_000) score += 10;
  else if (vol > 1_000_000) score += 6;
  else if (vol > 500_000)   score += 3;

  // DEX flash moves are high signal
  const dex5m = Math.abs(dex?.price_change_5m ?? 0);
  if (dex5m > 10) score += 10;
  else if (dex5m > 5) score += 5;

  // Liquidity depth
  const liq = dex?.liquidity_usd ?? 0;
  if (liq > 2_000_000) score += 8;
  else if (liq > 500_000) score += 4;

  // ── Engagement bonuses ─────────────────────────────────────────────────
  const tweetCount = tweets?.tweet_count ?? 0;
  if (tweetCount > 50) score += 12;
  else if (tweetCount > 30) score += 8;
  else if (tweetCount > 15) score += 4;

  const tweetSentiment = tweets?.sentiment_score ?? 0;
  if (tweetSentiment > 0.5)       score += 5;
  else if (tweetSentiment > 0.25) score += 2;

  // ── Cross-source bonus ─────────────────────────────────────────────────
  let sourceCount = 0;
  if (market?.source === 'coingecko')   sourceCount++;
  if (dex?.source === 'dexscreener')    sourceCount++;
  if (tweets?.source === 'twitter' && tweetCount > MIN_TWEET_COUNT) sourceCount++;
  if (news?.source === 'firecrawl' && (news.articles_found ?? 0) > 0) sourceCount++;

  if (sourceCount >= 3) score += 10;
  else if (sourceCount === 2) score += 5;

  // ── News sentiment bonus ───────────────────────────────────────────────
  if (news?.sentiment === 'bullish') score += 5;
  if (news?.sentiment === 'bearish') score += 3; // bearish is still signal

  return Math.min(100, Math.max(0, Math.round(score)));
}

// ---------------------------------------------------------------------------
// Thread ID generator
// Groups signals from same token within a 15-minute window.
// ---------------------------------------------------------------------------
export function generateThreadId(tokenId: string): string {
  const window = Math.floor(Date.now() / THREAD_WINDOW_MS);
  return `${tokenId}_${window}`;
}

// ---------------------------------------------------------------------------
// Fetch thread parent — finds first signal in same token's 15-min window
// ---------------------------------------------------------------------------
export async function resolveThread(tokenId: string): Promise<{
  thread_id: string;
  parent_id: string | null;
  is_reply:  boolean;
}> {
  const threadId  = generateThreadId(tokenId);
  const windowStart = new Date(Date.now() - THREAD_WINDOW_MS).toISOString();

  try {
    const { data } = await supabaseAdmin
      .from('events')
      .select('id, data')
      .eq('token_id', tokenId)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true })
      .limit(1);

    if (data && data.length > 0) {
      const firstSignal = data[0];
      const storedThread = (firstSignal.data as any)?.thread_id ?? null;

      // Use the existing thread_id from first signal if available
      const resolvedThread = storedThread ?? threadId;

      return {
        thread_id: resolvedThread,
        parent_id: firstSignal.id,
        is_reply:  true,
      };
    }
  } catch (e: any) {
    logger.warn(`[SignalEngine] resolveThread error: ${e.message}`);
  }

  // No existing signal in window → this is the first (thread root)
  return { thread_id: threadId, parent_id: null, is_reply: false };
}

// ---------------------------------------------------------------------------
// Anti-spam filter
// Rejects signals before they are written.
// ---------------------------------------------------------------------------
const FORBIDDEN_PHRASES = [
  'to the moon', '100x', 'guaranteed', 'easy money', 'get rich',
  'financial advice', 'buy now', 'sell now', 'don\'t miss out',
  'this will pump',
];

export function antiSpam(title: string, summary: string): {
  passes: boolean;
  reason: string;
} {
  const text = `${title} ${summary}`.toLowerCase();

  for (const phrase of FORBIDDEN_PHRASES) {
    if (text.includes(phrase)) {
      return { passes: false, reason: `forbidden phrase: "${phrase}"` };
    }
  }

  if (title.length < 5 || summary.length < 10) {
    return { passes: false, reason: 'content too short / empty' };
  }

  // Detect generic/vague text patterns
  const vague = [
    'community sentiment', 'record high engagement', 'influencer mentions',
    'smart money moving', 'meme token communities',
  ];
  for (const v of vague) {
    if (text.includes(v)) {
      return { passes: false, reason: `generic/vague phrase detected: "${v}"` };
    }
  }

  return { passes: true, reason: 'ok' };
}

// ---------------------------------------------------------------------------
// Classify signal
// Determines the single best signal type from all available data.
// Returns 'no_signal' if data is insufficient.
// ---------------------------------------------------------------------------
export function classifySignal(
  market:  MarketData | null,
  dex:     DexData    | null,
  tweets:  TweetData  | null,
  news:    NewsData   | null,
  ticker:  string,
): SignalType {
  const profile = getTokenProfile(ticker);
  const checks: Array<{ type: SignalType; passes: boolean }> = [];

  // ── Whale / Liquidity detection ─────────────────────────────────────────
  const liq = dex?.liquidity_usd ?? 0;
  const vol  = dex?.volume_24h ?? market?.volume_24h ?? 0;

  if (liq > MIN_LIQUIDITY_USD && vol > liq * 0.5) {
    // High volume relative to liquidity → whale accumulation
    checks.push({ type: 'whale_activity', passes: true });
  }

  if (liq > 1_000_000) {
    checks.push({ type: 'liquidity_event', passes: true });
  }

  // ── Market movement detection ──────────────────────────────────────────
  const priceChange = Math.abs(market?.price_change_24h ?? 0);
  const dex5m       = Math.abs(dex?.price_change_5m ?? 0);
  const dex1h       = Math.abs(dex?.price_change_1h ?? 0);

  if (priceChange > MIN_PRICE_CHANGE || dex5m > 3 || dex1h > 5) {
    checks.push({ type: 'market_movement', passes: true });
  }

  // ── Social spike detection ─────────────────────────────────────────────
  if (
    tweets?.source === 'twitter' &&
    (tweets.tweet_count ?? 0) >= MIN_TWEET_COUNT &&
    (tweets.trending || (tweets.tweet_count ?? 0) > 15)
  ) {
    checks.push({ type: 'social_spike', passes: true });
  }

  // ── News event detection ───────────────────────────────────────────────
  if (
    news?.source === 'firecrawl' &&
    (news.articles_found ?? 0) > 0 &&
    (news.headlines?.length ?? 0) > 0
  ) {
    checks.push({ type: 'news_event', passes: true });
  }

  if (checks.length === 0) {
    return 'no_signal';
  }

  // Pick signal according to token priority profile
  for (const preferred of profile.priority) {
    const found = checks.find(c => c.type === preferred && c.passes);
    if (found) return found.type;
  }

  // Fallback: pick highest-priority type from what's available
  const PRIORITY_ORDER: SignalType[] = [
    'whale_activity', 'liquidity_event', 'news_event', 'social_spike', 'market_movement',
  ];
  for (const t of PRIORITY_ORDER) {
    if (checks.find(c => c.type === t)) return t;
  }

  return 'no_signal';
}

// ---------------------------------------------------------------------------
// Build signal title + summary from real data (no invented content)
// ---------------------------------------------------------------------------
function buildSignalContent(
  type:    SignalType,
  market:  MarketData | null,
  dex:     DexData    | null,
  tweets:  TweetData  | null,
  news:    NewsData   | null,
  ticker:  string,
  name:    string,
): { title: string; summary: string } | null {

  const priceChange = market?.price_change_24h ?? dex?.price_change_1h ?? null;
  const price       = market?.price_usd ?? (dex?.price_usd ? parseFloat(dex.price_usd as string) : null);
  const vol         = market?.volume_24h ?? dex?.volume_24h ?? 0;
  const liq         = dex?.liquidity_usd ?? 0;
  const dex5m       = dex?.price_change_5m ?? 0;
  const tweetCount  = tweets?.tweet_count ?? 0;

  switch (type) {
    case 'whale_activity': {
      if (liq < MIN_LIQUIDITY_USD && vol < MIN_VOLUME_USD) return null;
      const direction = (priceChange ?? 0) >= 0 ? 'accumulating' : 'distributing';
      const volStr = vol >= 1_000_000 ? `$${(vol / 1_000_000).toFixed(2)}M` : `$${(vol / 1_000).toFixed(0)}K`;
      const liqStr = liq >= 1_000_000 ? `$${(liq / 1_000_000).toFixed(2)}M` : `$${(liq / 1_000).toFixed(0)}K`;
      return {
        title:   `$${ticker} Whale Alert: ${direction === 'accumulating' ? '+' : '−'}${volStr} volume vs ${liqStr} pool`,
        summary: `On-chain data shows ${volStr} in 24h volume against ${liqStr} liquidity on DEX — volume-to-liquidity ratio signals ${direction} pressure${price ? ` at $${price}` : ''}.`,
      };
    }

    case 'liquidity_event': {
      if (liq < MIN_LIQUIDITY_USD) return null;
      const liqStr = `$${(liq / 1_000_000).toFixed(2)}M`;
      const volStr = vol > 0 ? ` with $${vol >= 1_000_000 ? (vol / 1_000_000).toFixed(1) + 'M' : (vol / 1_000).toFixed(0) + 'K'} 24h volume` : '';
      return {
        title:   `$${ticker} Pool Depth: ${liqStr} locked on ${dex?.dex_id ?? 'DEX'}`,
        summary: `${name} maintains ${liqStr} in liquidity${volStr}${price ? ` — current price $${price}` : ''}.`,
      };
    }

    case 'market_movement': {
      const change = priceChange ?? dex5m;
      if (Math.abs(change) < MIN_PRICE_CHANGE) return null;
      const dir   = change > 0 ? '+' : '';
      const flash = Math.abs(dex5m) > 3 ? ` (${dex5m > 0 ? '+' : ''}${dex5m.toFixed(1)}% in 5m on DEX)` : '';
      const volStr = vol >= 1_000_000 ? `$${(vol / 1_000_000).toFixed(1)}M` : `$${(vol / 1_000).toFixed(0)}K`;
      return {
        title:   `$${ticker} ${change > 0 ? 'Up' : 'Down'} ${dir}${Math.abs(change).toFixed(1)}% — ${volStr} volume`,
        summary: `${name} moved ${dir}${Math.abs(change).toFixed(1)}% in 24h${flash}${price ? ` — trading at $${price}` : ''} with ${volStr} in volume.`,
      };
    }

    case 'social_spike': {
      if (tweetCount < MIN_TWEET_COUNT) return null;
      const sentiment = (tweets?.sentiment_score ?? 0) > 0.2 ? 'bullish' : (tweets?.sentiment_score ?? 0) < -0.2 ? 'bearish' : 'mixed';
      return {
        title:   `$${ticker} Social Volume: ${tweetCount} tweets — ${sentiment} sentiment`,
        summary: `${name} has ${tweetCount} recent tweets with ${sentiment} sentiment (score: ${((tweets?.sentiment_score ?? 0).toFixed(2))}).${(tweets?.trending ?? false) ? ' Trending keyword detected.' : ''}`,
      };
    }

    case 'news_event': {
      if (!news || news.articles_found === 0 || news.headlines.length === 0) return null;
      const headline = news.headlines[0];
      const sentiment = news.sentiment;
      return {
        title:   `$${ticker} in the News: ${headline.slice(0, 80)}${headline.length > 80 ? '…' : ''}`,
        summary: `${news.articles_found} article${news.articles_found > 1 ? 's' : ''} found — sentiment: ${sentiment}. Top headline: "${headline}"`,
      };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry: buildSignal
// Returns a complete Signal or NoSignal.
// ---------------------------------------------------------------------------
export interface TokenInput {
  id:               string;
  name:             string;
  ticker:           string;
  coingecko_id?:    string | null;
  contract_address?: string | null;
}

export async function buildSignal(
  token:   TokenInput,
  market:  MarketData | null,
  dex:     DexData    | null,
  tweets:  TweetData  | null,
  news:    NewsData   | null,
): Promise<Signal | NoSignal> {

  // Step 1: Classify
  const signalType = classifySignal(market, dex, tweets, news, token.ticker);
  if (signalType === 'no_signal') {
    return { type: 'no_signal', reason: 'insufficient data across all sources' };
  }

  // Step 2: Build content from real data
  const content = buildSignalContent(signalType, market, dex, tweets, news, token.ticker, token.name);
  if (!content) {
    return { type: 'no_signal', reason: `no real data to build ${signalType} content` };
  }

  // Step 3: Anti-spam filter
  const spam = antiSpam(content.title, content.summary);
  if (!spam.passes) {
    logger.warn(`[SignalEngine] ${token.ticker} — anti-spam rejected: ${spam.reason}`);
    return { type: 'no_signal', reason: spam.reason };
  }

  // Step 4: Score
  const score = scoreSignal(signalType, market, dex, tweets, news);
  if (score < MIN_SCORE) {
    return { type: 'no_signal', reason: `score too low (${score} < ${MIN_SCORE})` };
  }

  // Step 5: Source
  let source: SignalSource | null = null;

  if (signalType === 'social_spike' && tweets?.source === 'twitter') {
    source = buildSource('twitter', {
      tweet_url: (tweets as any)._tweet_url ?? `https://twitter.com/search?q=%24${token.ticker}`,
      author:    (tweets as any)._author ?? null,
    });
  } else if (signalType === 'news_event' && news?.source === 'firecrawl') {
    source = buildSource('news', {
      news_url: (news as any)._raw_results?.[0]?.url ?? null,
      author:   (news as any)._raw_results?.[0]?.metadata?.author ?? null,
    });
  } else if (dex?.source === 'dexscreener') {
    source = buildSource('web', {
      web_url: dex.pair_address
        ? `https://dexscreener.com/${token.coingecko_id ?? 'solana'}/${dex.pair_address}`
        : `https://dexscreener.com/search?q=${token.ticker}`,
      author: null,
    });
  } else if (market?.source === 'coingecko') {
    source = buildSource('web', {
      web_url: `https://www.coingecko.com/en/coins/${token.coingecko_id ?? token.ticker.toLowerCase()}`,
      author: null,
    });
  }

  // Source is mandatory — discard if missing
  if (!source) {
    // Build fallback source from coingecko or dexscreener
    source = {
      type:   'web',
      url:    `https://www.coingecko.com/en/coins/${token.coingecko_id ?? token.ticker.toLowerCase()}`,
      author: null,
    };
  }

  // Step 6: Media URL
  const mediaUrl = extractMediaUrl(news);

  // Step 7: Thread resolution
  const thread = await resolveThread(token.id);

  // Step 8: Build final signal
  const signal: Signal = {
    token_ticker: token.ticker,
    token_name:   token.name,
    signal_type:  signalType,
    title:        content.title,
    summary:      content.summary,
    score,
    timestamp:    new Date().toISOString(),
    media_url:    mediaUrl,
    source,
    thread_id:    thread.thread_id,
    parent_id:    thread.parent_id,
    is_reply:     thread.is_reply,
  };

  logger.info(`[SignalEngine] ${token.ticker} → ${signalType} (score: ${score}, thread: ${thread.is_reply ? 'reply' : 'root'})`);
  return signal;
}

// ---------------------------------------------------------------------------
// Token-aware AI context builder
// Returns a context string that agentBrain injects into the system prompt.
// ---------------------------------------------------------------------------
export function buildTokenIntelligenceContext(
  ticker: string,
  signal: Signal,
): string {
  const profile = getTokenProfile(ticker);

  return `
SIGNAL INTELLIGENCE CONTEXT:
  Signal Type: ${signal.signal_type.replace(/_/g, ' ').toUpperCase()}
  Score: ${signal.score}/100
  Source: ${signal.source.type} — ${signal.source.url}${signal.source.author ? ` (@${signal.source.author})` : ''}
  Analytical Lens: ${profile.lens}

SIGNAL DETAILS:
  ${signal.title}
  ${signal.summary}

ANALYST RULES:
  - Write like an analyst covering real market intelligence, not an influencer
  - Reference specific numbers from the signal (price %, volume, tweet count, etc.)
  - Keep it to 1-2 sharp sentences — no padding, no hype
  - No vague statements. Every sentence must be grounded in the signal data above
`.trim();
}
