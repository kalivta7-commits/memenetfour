import axios from 'axios';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// In-memory TTL cache — avoids hammering free-tier APIs
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache: Record<string, CacheEntry<any>> = {};

function setCache(key: string, value: any, ttlSeconds: number): void {
  cache[key] = { value, expiresAt: Date.now() + ttlSeconds * 1_000 };
}

function getCache<T>(key: string): T | null {
  const entry = cache[key];
  if (entry && entry.expiresAt > Date.now()) return entry.value as T;
  delete cache[key];
  return null;
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface MarketData {
  price_usd:         number | null;
  volume_24h:        number | null;
  price_change_24h:  number | null;
  market_cap:        number | null;
  source:            'coingecko' | 'unavailable';
}

export interface DexData {
  price_usd:         string | null;
  volume_24h:        number;
  liquidity_usd:     number;
  price_change_5m:   number;
  price_change_1h:   number;
  pair_address:      string | null;
  dex_id:            string | null;
  source:            'dexscreener' | 'unavailable';
}

export interface TweetData {
  tweet_count:       number;
  sentiment_score:   number; // -1 (negative) to 1 (positive)
  trending:          boolean;
  sample_tweets:     string[];
  source:            'twitter' | 'unavailable';
  // Signal intelligence extensions (nullable — filled when real data available)
  _author?:          string | null;   // twitter handle of most-engaged author
  _tweet_url?:       string | null;   // direct link to most-engaged tweet
}

export interface NewsData {
  articles_found:    number;
  headlines:         string[];
  summary:           string;
  sentiment:         'bullish' | 'bearish' | 'neutral';
  source:            'firecrawl' | 'unavailable';
  // Signal intelligence extensions
  _raw_results?:     any[];           // raw Firecrawl results for og:image extraction
  _media_url?:       string | null;   // pre-extracted og:image / twitter:image
}

// ---------------------------------------------------------------------------
// 1. CoinGecko — Price, volume, 24h change
// ---------------------------------------------------------------------------

/**
 * Fetch market data for a token by its CoinGecko ID.
 * TTL: 60 seconds (respects free-tier 5/min rate limit with caching).
 */
export async function getMarketData(coingeckoId: string): Promise<MarketData> {
  const UNAVAILABLE: MarketData = {
    price_usd: null, volume_24h: null, price_change_24h: null,
    market_cap: null, source: 'unavailable',
  };

  if (!coingeckoId) return UNAVAILABLE;

  const cacheKey = `cg:${coingeckoId}`;
  const cached = getCache<MarketData>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price`,
      {
        params: {
          ids: coingeckoId,
          vs_currencies: 'usd',
          include_24hr_change: true,
          include_24hr_vol: true,
          include_market_cap: true,
        },
        timeout: 10_000,
      }
    );

    const d = data[coingeckoId];
    if (!d) return UNAVAILABLE;

    const result: MarketData = {
      price_usd:        d.usd          ?? null,
      volume_24h:       d.usd_24h_vol  ?? null,
      price_change_24h: d.usd_24h_change ?? null,
      market_cap:       d.usd_market_cap ?? null,
      source:           'coingecko',
    };

    setCache(cacheKey, result, 60);
    return result;
  } catch (e: any) {
    logger.warn(`[DataEngine] CoinGecko fetch failed for "${coingeckoId}": ${e.message}`);
    return UNAVAILABLE;
  }
}

// ---------------------------------------------------------------------------
// 2. DexScreener — On-chain pair data (price, volume, liquidity)
// ---------------------------------------------------------------------------

/**
 * Fetch on-chain DEX data for a token by contract address.
 * TTL: 90 seconds.
 */
export async function getDexData(contractAddress: string): Promise<DexData> {
  const UNAVAILABLE: DexData = {
    price_usd: null, volume_24h: 0, liquidity_usd: 0,
    price_change_5m: 0, price_change_1h: 0,
    pair_address: null, dex_id: null, source: 'unavailable',
  };

  if (!contractAddress) return UNAVAILABLE;

  const cacheKey = `dex:${contractAddress}`;
  const cached = getCache<DexData>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`,
      { timeout: 10_000 }
    );

    const pairs: any[] = data?.pairs ?? [];
    if (pairs.length === 0) return UNAVAILABLE;

    // Pick the pair with highest liquidity as the canonical pair
    const best = pairs.sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
    )[0];

    const result: DexData = {
      price_usd:       best.priceUsd          ?? null,
      volume_24h:      best.volume?.h24        ?? 0,
      liquidity_usd:   best.liquidity?.usd     ?? 0,
      price_change_5m: parseFloat(best.priceChange?.m5  ?? '0'),
      price_change_1h: parseFloat(best.priceChange?.h1  ?? '0'),
      pair_address:    best.pairAddress        ?? null,
      dex_id:          best.dexId             ?? null,
      source:          'dexscreener',
    };

    setCache(cacheKey, result, 90);
    return result;
  } catch (e: any) {
    logger.warn(`[DataEngine] DexScreener fetch failed for "${contractAddress}": ${e.message}`);
    return UNAVAILABLE;
  }
}

// ---------------------------------------------------------------------------
// 3. Twitter API v2 — Tweet volume + sentiment
// Controls: gated behind ENABLE_TWITTER=true env var to protect quota.
// Sentiment: simple keyword-based scoring (no external NLP required).
// TTL: 5 minutes.
// ---------------------------------------------------------------------------

const POSITIVE_WORDS = [
  'pump', 'moon', 'bullish', 'buy', 'up', 'rally', 'surge', 'gem', 'fomo',
  'rocket', 'launch', 'win', 'profit', 'gain', 'growing', 'hot', 'fire',
  '🚀', '💎', '🔥', '📈', 'bullrun', 'alpha', 'early', 'lfg',
];
const NEGATIVE_WORDS = [
  'dump', 'crash', 'bearish', 'sell', 'down', 'rug', 'dead', 'scam',
  'fear', 'fud', 'drop', 'rekt', 'loss', 'falling', 'risk', 'warning',
  '📉', '💀', 'rugpull',
];

function scoreSentiment(texts: string[]): number {
  if (texts.length === 0) return 0;
  let score = 0;
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const w of POSITIVE_WORDS) if (lower.includes(w)) score++;
    for (const w of NEGATIVE_WORDS) if (lower.includes(w)) score--;
  }
  // Normalize to [-1, 1]
  const maxPossible = texts.length * 3;
  return Math.max(-1, Math.min(1, score / maxPossible));
}

/**
 * Fetch recent tweets for a token symbol using Twitter API v2.
 * Returns tweet count, sentiment score, and sample tweets.
 * TTL: 5 minutes.
 */
export async function getTokenTweets(symbol: string): Promise<TweetData> {
  const UNAVAILABLE: TweetData = {
    tweet_count: 0, sentiment_score: 0, trending: false,
    sample_tweets: [], source: 'unavailable',
  };

  // Gate behind env flag — default disabled
  if (process.env.ENABLE_TWITTER !== 'true') return UNAVAILABLE;

  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) {
    logger.warn('[DataEngine] TWITTER_BEARER_TOKEN missing — Twitter disabled.');
    return UNAVAILABLE;
  }

  const cacheKey = `tw:${symbol.toLowerCase()}`;
  const cached = getCache<TweetData>(cacheKey);
  if (cached) return cached;

  try {
    const query = encodeURIComponent(`$${symbol} OR #${symbol} lang:en -is:retweet`);
    const { data } = await axios.get(
      `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=20&tweet.fields=text,created_at,author_id&expansions=author_id&user.fields=username`,
      {
        headers: { Authorization: `Bearer ${bearerToken}` },
        timeout: 12_000,
      }
    );

    const tweets: any[]  = data?.data ?? [];
    const users:  any[]  = data?.includes?.users ?? [];
    const texts = tweets.map((t: any) => t.text ?? '');
    const sentimentScore = scoreSentiment(texts);
    const count = data?.meta?.result_count ?? tweets.length;

    // Find most-engaged tweet + author for source linking
    // (Twitter v2 basic doesn't return engagement metrics w/o elevated access,
    // so we take the first tweet as representative sample)
    const firstTweet  = tweets[0] ?? null;
    const firstAuthor = firstTweet ? users.find((u: any) => u.id === firstTweet.author_id) : null;
    const authorHandle = firstAuthor?.username ?? null;
    const tweetUrl     = firstTweet?.id && authorHandle
      ? `https://twitter.com/${authorHandle}/status/${firstTweet.id}`
      : `https://twitter.com/search?q=%24${symbol}`;

    const result: TweetData = {
      tweet_count:    count,
      sentiment_score: sentimentScore,
      trending:       count > 10 || sentimentScore > 0.3,
      sample_tweets:  texts.slice(0, 3),
      source:         'twitter',
      _author:        authorHandle,
      _tweet_url:     tweetUrl,
    };

    setCache(cacheKey, result, 300); // 5-min TTL
    return result;
  } catch (e: any) {
    const status = e?.response?.status;
    if (status === 402) {
      // Twitter plan doesn't include recent search — fail silently
      logger.info(`[DataEngine] Twitter unavailable for "$${symbol}" (plan limit — upgrade to Basic tier).`);
    } else {
      logger.warn(`[DataEngine] Twitter fetch failed for "$${symbol}": ${e.message}`);
    }
    return UNAVAILABLE;
  }
}

// ---------------------------------------------------------------------------
// 4. Firecrawl — News & narrative scraping
// Searches for token news by name, extracts headlines + summary.
// TTL: 10 minutes (aggressive — Firecrawl credits cost money).
// ---------------------------------------------------------------------------

function detectNewsSentiment(headlines: string[]): 'bullish' | 'bearish' | 'neutral' {
  if (headlines.length === 0) return 'neutral';
  let score = 0;
  for (const h of headlines) {
    const lower = h.toLowerCase();
    for (const w of POSITIVE_WORDS) if (lower.includes(w)) score++;
    for (const w of NEGATIVE_WORDS) if (lower.includes(w)) score--;
  }
  if (score > 1) return 'bullish';
  if (score < -1) return 'bearish';
  return 'neutral';
}

/**
 * Scrape news for a token using Firecrawl's search API.
 * Returns headlines, summary, and sentiment.
 * TTL: 10 minutes.
 */
export async function getNews(tokenName: string): Promise<NewsData> {
  const UNAVAILABLE: NewsData = {
    articles_found: 0, headlines: [], summary: '', sentiment: 'neutral', source: 'unavailable',
  };

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    logger.warn('[DataEngine] FIRECRAWL_API_KEY missing — news disabled.');
    return UNAVAILABLE;
  }

  const cacheKey = `fc:${tokenName.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = getCache<NewsData>(cacheKey);
  if (cached) return cached;

  try {
    // Firecrawl search endpoint: searches across the web and returns structured results
    const { data } = await axios.post(
      'https://api.firecrawl.dev/v1/search',
      {
        query: `${tokenName} crypto token news 2024 2025`,
        limit: 5,
        scrapeOptions: {
          formats: ['markdown'],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 20_000,
      }
    );

    const results: any[] = data?.data ?? [];

    // Extract headlines from result titles or first markdown line
    const headlines = results
      .map((r: any) => r.title || r.metadata?.title || r.markdown?.split('\n')[0] || '')
      .filter(Boolean)
      .slice(0, 5);

    // Build summary from descriptions
    const descriptions = results
      .map((r: any) => r.description || r.metadata?.description || '')
      .filter(Boolean);

    const summary = descriptions.length > 0
      ? descriptions.slice(0, 2).join(' ').slice(0, 300)
      : `No recent news detected for ${tokenName}.`;

    const sentiment = detectNewsSentiment([...headlines, ...descriptions]);

    // Extract og:image / twitter:image from first result with a valid image
    let mediaUrl: string | null = null;
    for (const r of results) {
      const img =
        r.metadata?.['og:image']   ??
        r.metadata?.ogImage         ??
        r.metadata?.['twitter:image'] ??
        r.metadata?.twitterImage    ??
        null;
      if (img && typeof img === 'string' && img.startsWith('http')) {
        mediaUrl = img;
        break;
      }
      // Fallback: first markdown image
      const mdImg = (r.markdown ?? '').match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
      if (mdImg?.[1]) { mediaUrl = mdImg[1]; break; }
    }

    const result: NewsData = {
      articles_found: results.length,
      headlines,
      summary,
      sentiment,
      source:        'firecrawl',
      _raw_results:  results,          // stored for og:image extraction in signalEngine
      _media_url:    mediaUrl,
    };

    setCache(cacheKey, result, 600); // 10-min TTL
    logger.info(`[DataEngine] Firecrawl: ${results.length} articles for "${tokenName}" (${sentiment}${mediaUrl ? ', media found' : ''})`);
    return result;
  } catch (e: any) {
    logger.warn(`[DataEngine] Firecrawl fetch failed for "${tokenName}": ${e.message}`);
    return UNAVAILABLE;
  }
}

// ---------------------------------------------------------------------------
// Batch helpers used by eventEngine
// ---------------------------------------------------------------------------

export interface TokenDataBundle {
  market:  MarketData;
  dex:     DexData;
  tweets:  TweetData;
  news:    NewsData;
}

/**
 * Fetch all data sources for a single token concurrently.
 * Failure in one source does not abort the others.
 */
export async function fetchAllTokenData(token: {
  name:             string;
  ticker:           string;
  coingecko_id:     string | null;
  contract_address: string | null;
}): Promise<TokenDataBundle> {
  const [market, dex, tweets, news] = await Promise.allSettled([
    token.coingecko_id     ? getMarketData(token.coingecko_id)         : Promise.resolve<MarketData>({ price_usd: null, volume_24h: null, price_change_24h: null, market_cap: null, source: 'unavailable' }),
    token.contract_address ? getDexData(token.contract_address)        : Promise.resolve<DexData>({ price_usd: null, volume_24h: 0, liquidity_usd: 0, price_change_5m: 0, price_change_1h: 0, pair_address: null, dex_id: null, source: 'unavailable' }),
    getTokenTweets(token.ticker),
    getNews(token.name),
  ]);

  return {
    market:  market.status  === 'fulfilled' ? market.value  : { price_usd: null, volume_24h: null, price_change_24h: null, market_cap: null, source: 'unavailable' },
    dex:     dex.status     === 'fulfilled' ? dex.value     : { price_usd: null, volume_24h: 0, liquidity_usd: 0, price_change_5m: 0, price_change_1h: 0, pair_address: null, dex_id: null, source: 'unavailable' },
    tweets:  tweets.status  === 'fulfilled' ? tweets.value  : { tweet_count: 0, sentiment_score: 0, trending: false, sample_tweets: [], source: 'unavailable' },
    news:    news.status    === 'fulfilled' ? news.value    : { articles_found: 0, headlines: [], summary: '', sentiment: 'neutral', source: 'unavailable' },
  };
}
