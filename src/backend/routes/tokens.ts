import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../utils/supabase';
import { getMarketData, getDexData } from '../services/dataEngine';
import { parseCoinGeckoId } from '../utils/parseCoinGeckoId';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/tokens
// Query params:
//   typing=true  → return only tokens where is_typing = true (for TypingIndicator)
//   (default)    → return all active, non-deleted tokens ordered by engagement_score
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const { typing } = req.query;

  // ?typing=true — return only the tokens currently generating a post
  if (typing === 'true') {
    const { data, error } = await supabaseAdmin
      .from('tokens')
      .select('id, name, ticker, is_typing')
      .eq('is_typing', true)
      .neq('is_deleted', true)
      .limit(5);

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data ?? []);
  }

  // Default — full token list for Explore / sidebar
  // neq(true) matches both false AND NULL so old rows without is_deleted still appear
  const { data, error } = await supabaseAdmin
    .from('tokens')
    .select('*')
    .eq('status', 'active')
    .neq('is_deleted', true)
    .order('engagement_score', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

// ---------------------------------------------------------------------------
// GET /api/tokens/:id — single token, excludes soft-deleted
// ---------------------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('tokens')
    .select('*')
    .eq('id', req.params.id)
    .neq('is_deleted', true)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Token not found.' });
  return res.json(data);
});

// ---------------------------------------------------------------------------
// GET /api/tokens/:id/price — live price for a single token
// Tries: 1) CoinGecko (via coingecko_id or coingecko_url)  2) DexScreener
//        3) Last-known price from DB as final fallback
// ---------------------------------------------------------------------------
router.get('/:id/price', async (req: Request, res: Response) => {
  try {
    const { data: token, error } = await supabaseAdmin
      .from('tokens')
      .select('id, name, ticker, coingecko_id, coingecko_url, dex_url, contract_address, price_usd, price_change_24h, volume_24h, market_cap')
      .eq('id', req.params.id)
      .neq('is_deleted', true)
      .single();

    if (error || !token) return res.status(404).json({ error: 'Token not found.' });

    // Resolve effective CoinGecko ID
    const coinGeckoId: string | null =
      (token as any).coingecko_id ||
      parseCoinGeckoId((token as any).coingecko_url) ||
      null;

    // 1. Try CoinGecko
    if (coinGeckoId) {
      const market = await getMarketData(coinGeckoId);
      if (market.source === 'coingecko' && market.price_usd) {
        return res.json({
          source:           'coingecko',
          price_usd:        market.price_usd,
          price_change_24h: market.price_change_24h,
          volume_24h:       market.volume_24h,
          market_cap:       market.market_cap,
        });
      }
    }

    // 2. Try DexScreener
    const contractAddress: string | null = (token as any).contract_address ?? null;
    if (contractAddress) {
      const dex = await getDexData(contractAddress);
      if (dex.source === 'dexscreener' && dex.price_usd) {
        return res.json({
          source:           'dexscreener',
          price_usd:        parseFloat(dex.price_usd as string),
          price_change_24h: dex.price_change_1h,
          volume_24h:       dex.volume_24h,
          market_cap:       null,
          liquidity_usd:    dex.liquidity_usd,
        });
      }
    }

    // 3. Last-known price from DB (may be null if never fetched)
    const dbPrice = (token as any).price_usd ?? null;
    if (dbPrice) {
      return res.json({
        source:           'db_cache',
        price_usd:        dbPrice,
        price_change_24h: (token as any).price_change_24h ?? null,
        volume_24h:       (token as any).volume_24h ?? null,
        market_cap:       (token as any).market_cap ?? null,
        stale:            true,
      });
    }

    return res.json({ source: 'unavailable', price_usd: null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

