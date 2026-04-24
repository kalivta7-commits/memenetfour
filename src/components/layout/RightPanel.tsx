import { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Activity, Flame, RefreshCw } from 'lucide-react';
import { supabase } from '../../supabase';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Market data shape returned by /api/market/overview
// ---------------------------------------------------------------------------
interface CoinOverview {
  price_usd:         number | null;
  price_change_24h:  number | null;
  volume_24h:        number | null;
  market_cap:        number | null;
  source:            string;
}
interface MarketOverview {
  bitcoin:  CoinOverview | null;
  ethereum: CoinOverview | null;
}

const REFRESH_MS = 90_000; // 90 s — matches dataEngine TTL

function formatPrice(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 1)    return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(4)}`;
}

export function RightPanel() {
  const [market,   setMarket]   = useState<MarketOverview | null>(null);
  const [trending, setTrending] = useState<any[]>([]);
  const [loadingM, setLoadingM] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch market overview from our own backend (cached, no CORS) ────────
  const fetchMarket = async () => {
    try {
      setLoadingM(true);
      const fetchCoin = async (id: string): Promise<CoinOverview> => {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_market_cap=true`);
        const data = await res.json();
        return {
          price_usd: data[id]?.usd ?? null,
          price_change_24h: data[id]?.usd_24h_change ?? null,
          volume_24h: data[id]?.usd_24h_vol ?? null,
          market_cap: data[id]?.usd_market_cap ?? null,
          source: 'coingecko'
        };
      };
      
      const [bitcoin, ethereum] = await Promise.all([fetchCoin('bitcoin'), fetchCoin('ethereum')]);
      setMarket({ bitcoin, ethereum });
    } catch (e) {
      console.warn('[RightPanel] market overview fetch failed:', e);
    } finally {
      setLoadingM(false);
    }
  };

  // ── Fetch trending tokens from Supabase (read-only) ─────────────────────
  const fetchTrending = () => {
    supabase
      .from('tokens')
      .select('id, name, ticker, dominance_score, price_usd, price_change_24h')
      .eq('status', 'active')
      .order('dominance_score', { ascending: false })
      .limit(5)
      .then(({ data }) => { if (data) setTrending(data); });
  };

  useEffect(() => {
    fetchMarket();
    fetchTrending();
    timerRef.current = setInterval(() => {
      fetchMarket();
      fetchTrending();
    }, REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const coins: { key: 'bitcoin' | 'ethereum'; label: string }[] = [
    { key: 'bitcoin',  label: 'Bitcoin' },
    { key: 'ethereum', label: 'Ethereum' },
  ];

  return (
    <div className="hidden xl:flex w-[300px] border-l border-brand-border h-screen fixed right-0 top-0 p-5 font-['DM_Sans'] flex-col gap-6 overflow-y-auto z-40 bg-[rgba(5,7,13,0.85)] backdrop-blur-md">

      {/* ── Market Overview ── */}
      <div className="card-premium p-5 hover:scale-[1.01] hover:border-[rgba(0,255,136,0.3)] border-[rgba(0,255,136,0.2)] transition-all duration-200">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-brand-border/50">
          <h3 className="text-[#e5e7eb] font-bold flex items-center gap-2 text-sm tracking-wide uppercase">
            <Activity size={16} className="text-brand-green" /> Market Overview
          </h3>
          <button
            onClick={fetchMarket}
            title="Refresh"
            className="text-brand-muted hover:text-brand-green transition-colors"
          >
            <RefreshCw size={12} className={loadingM ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex flex-col">
          {coins.map(({ key, label }, idx) => {
            const coin = market?.[key];
            const change = coin?.price_change_24h ?? null;
            const isUp   = (change ?? 0) >= 0;
            return (
              <div
                key={key}
                className={`flex justify-between items-center group py-3 ${idx === 0 ? 'border-b border-brand-border/30' : ''}`}
              >
                <span className="text-brand-muted font-medium group-hover:text-[#e5e7eb] transition-colors text-sm">
                  {label}
                </span>

                <div className="text-right">
                  {loadingM && !coin ? (
                    <div className="w-16 h-4 bg-white/5 rounded animate-pulse" />
                  ) : (
                    <>
                      <div className={`font-mono text-sm font-bold tracking-wide ${isUp ? 'text-brand-green drop-shadow-[0_0_8px_rgba(0,255,136,0.25)]' : 'text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.25)]'}`}>
                        {formatPrice(coin?.price_usd ?? null)}
                      </div>
                      {change != null && (
                        <div className={`text-xs mt-0.5 flex items-center justify-end gap-1 ${isUp ? 'text-brand-green' : 'text-red-400'}`}>
                          {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                          {isUp ? '+' : ''}{change.toFixed(2)}%
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Trending ── */}
      <div className="card-premium p-5 hover:scale-[1.01] hover:border-[rgba(0,255,136,0.3)] transition-all duration-200">
        <h3 className="text-[#e5e7eb] font-bold mb-4 flex items-center gap-2 pb-3 border-b border-brand-border/50 text-sm tracking-wide uppercase">
          <Flame size={16} className="text-brand-yellow drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]" /> Trending
        </h3>
        <div className="flex flex-col gap-3">
          {trending.length === 0 && (
            <p className="text-brand-muted text-xs text-center py-2">No active tokens yet</p>
          )}
          {trending.map((t, idx) => {
            const change = t.price_change_24h as number | null;
            const isUp   = (change ?? 0) >= 0;
            return (
              <Link to={`/token/${t.id}`} key={t.id} className="flex items-center justify-between group">
                <div className="flex items-center gap-2">
                  <span className="text-brand-muted text-sm min-w-4">{idx === 0 ? '👑' : idx + 1}</span>
                  <div className="flex flex-col">
                    <span className="text-[#e5e7eb] text-sm group-hover:text-brand-yellow transition-colors uppercase font-['Syne'] font-bold">
                      {t.name}
                    </span>
                    <span className="text-brand-muted text-xs font-mono">${t.ticker}</span>
                  </div>
                </div>

                <div className="text-right">
                  {t.price_usd ? (
                    <>
                      <div className="text-[#e5e7eb] text-xs font-mono font-bold">
                        {formatPrice(t.price_usd)}
                      </div>
                      {change != null && (
                        <div className={`text-[10px] font-mono ${isUp ? 'text-brand-green' : 'text-red-400'}`}>
                          {isUp ? '+' : ''}{change.toFixed(1)}%
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-brand-green text-xs font-mono">{t.dominance_score} pts</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

    </div>
  );
}

