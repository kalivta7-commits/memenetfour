import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabase';

// ---------------------------------------------------------------------------
// useLivePrice — fetches live price for a single token from /api/tokens/:id/price
//
// The backend endpoint tries:
//   1. CoinGecko (via coingecko_id or coingecko_url)
//   2. DexScreener (via contract_address)
//   3. Last-known price from DB
//
// Refreshes automatically every `refreshMs` milliseconds (default 90s).
// Matches dataEngine's 60-120s TTL to avoid wasted requests.
// ---------------------------------------------------------------------------

export interface LivePriceData {
  source:           'coingecko' | 'dexscreener' | 'db_cache' | 'unavailable';
  price_usd:        number | null;
  price_change_24h: number | null;
  volume_24h:       number | null;
  market_cap:       number | null;
  liquidity_usd?:   number | null;
  stale?:           boolean;
}

interface UseLivePriceResult {
  data:    LivePriceData | null;
  loading: boolean;
  error:   string | null;
  refetch: () => void;
}

const DEFAULT_REFRESH_MS = 90_000; // 90 s

export function useLivePrice(
  tokenId: string | null | undefined,
  refreshMs = DEFAULT_REFRESH_MS,
): UseLivePriceResult {
  const [data,    setData]    = useState<LivePriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch_ = useCallback(async () => {
    if (!tokenId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: dbToken, error: fetchError } = await supabase
        .from('tokens')
        .select('price_usd, price_change_24h, volume_24h, market_cap')
        .eq('id', tokenId)
        .single();

      if (fetchError) throw fetchError;

      const json: LivePriceData = {
        source: 'db_cache',
        price_usd: dbToken?.price_usd ?? null,
        price_change_24h: dbToken?.price_change_24h ?? null,
        volume_24h: dbToken?.volume_24h ?? null,
        market_cap: dbToken?.market_cap ?? null,
        stale: false
      };

      // Validation: reject price == null or price == 0
      if (!json.price_usd || json.price_usd === 0) {
        // Keep previous data if available, mark as unavailable
        setData(prev => prev ?? { ...json, price_usd: null, source: 'unavailable' });
      } else {
        setData(json);
      }
    } catch (e: any) {
      setError(e.message ?? 'Price fetch failed');
    } finally {
      setLoading(false);
    }
  }, [tokenId]);

  useEffect(() => {
    if (!tokenId) return;
    fetch_();
    timerRef.current = setInterval(fetch_, refreshMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [tokenId, refreshMs, fetch_]);

  return { data, loading, error, refetch: fetch_ };
}

// ---------------------------------------------------------------------------
// formatPrice — shared price formatter used across the app
// ---------------------------------------------------------------------------

export function formatLivePrice(price: number | null | undefined): string {
  if (price == null || price === 0) return '—';
  if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(2)}M`;
  if (price >= 1_000)     return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (price >= 1)         return `$${price.toFixed(4)}`;
  if (price >= 0.0001)    return `$${price.toFixed(6)}`;
  return `$${price.toPrecision(3)}`;
}

export function formatVolume(vol: number | null | undefined): string {
  if (vol == null || vol === 0) return '—';
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(2)}B`;
  if (vol >= 1_000_000)     return `$${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000)         return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}
