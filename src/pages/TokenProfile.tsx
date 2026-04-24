import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { TrendingUp, TrendingDown, BarChart2, DollarSign } from 'lucide-react';
import { TokenBanner } from '../components/token/TokenBanner';
import { TokenStats } from '../components/token/TokenStats';
import { PostCard } from '../components/feed/PostCard';
import { useLivePrice, formatLivePrice, formatVolume } from '../hooks/useLivePrice';

export function TokenProfile() {
  const { id } = useParams();
  const [token, setToken] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);

  const { data: livePrice, loading: priceLoading } = useLivePrice(id);

  useEffect(() => {
    if (!id) return;
    supabase.from('tokens').select('*').eq('id', id).single().then(({ data }) => {
      if (data) setToken(data);
    });
    supabase.from('posts').select('*').eq('token_id', id).order('timestamp', { ascending: false }).limit(50).then(({ data }) => {
      if (data) setPosts(data);
    });
  }, [id]);

  if (!token) return <div className="p-8 text-center text-white">Loading Token...</div>;

  const price    = livePrice?.price_usd ?? token.price_usd ?? null;
  const change   = livePrice?.price_change_24h ?? token.price_change_24h ?? null;
  const volume   = livePrice?.volume_24h ?? token.volume_24h ?? null;
  const isUp     = (change ?? 0) >= 0;
  const hasPrice = price != null && price !== 0;

  return (
    <div className="w-full max-w-[680px] mx-auto border-x border-brand-border min-h-screen bg-brand-bg">
      <TokenBanner
        banner={token.banner_image}
        avatar={token.profile_image}
        name={token.name}
        ticker={token.ticker}
      />

      <div className="px-4 sm:px-6 pt-12 sm:pt-16 pb-4">
        <p className="text-[#e5e7eb] mb-3 text-sm sm:text-base">{token.bio}</p>

        <div className="flex flex-wrap gap-2 mb-4">
          <span className="px-2 py-0.5 rounded text-xs bg-brand-yellow/10 text-brand-yellow border border-brand-yellow/20 font-bold">
            {token.chain}
          </span>
          {token.category?.map((c: string) => (
            <span key={c} className="px-2 py-0.5 rounded text-xs bg-[rgba(255,255,255,0.05)] text-brand-muted border border-brand-border">
              {c}
            </span>
          ))}
        </div>

        {/* ── Live Price Banner ───────────────────────────────────────────── */}
        {(hasPrice || priceLoading) && (
          <div className="flex items-center flex-wrap gap-3 my-4 p-3 rounded-xl border border-brand-border/50 bg-[rgba(255,255,255,0.02)]">
            {priceLoading && !hasPrice ? (
              <div className="flex gap-4 w-full animate-pulse">
                <div className="h-6 w-24 bg-white/5 rounded" />
                <div className="h-6 w-16 bg-white/5 rounded" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <DollarSign size={14} className="text-brand-muted" />
                  <span className="font-mono font-bold text-lg text-[#e5e7eb]">
                    {formatLivePrice(price)}
                  </span>
                </div>

                {change != null && (
                  <span
                    className="flex items-center gap-1 text-sm font-mono font-bold px-2 py-0.5 rounded"
                    style={{
                      color:      isUp ? '#00FF88' : '#ef4444',
                      background: isUp ? 'rgba(0,255,136,0.08)' : 'rgba(239,68,68,0.08)',
                    }}
                  >
                    {isUp ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    {isUp ? '+' : ''}{change.toFixed(2)}%
                  </span>
                )}

                {volume != null && (
                  <div className="flex items-center gap-1 text-xs text-brand-muted font-mono ml-auto">
                    <BarChart2 size={12} />
                    {formatVolume(volume)} vol
                  </div>
                )}

                {livePrice?.source && livePrice.source !== 'unavailable' && (
                  <span className="text-[10px] text-brand-muted/40 font-mono">
                    via {livePrice.source}{livePrice.stale ? ' · cached' : ''}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-4 text-xs sm:text-sm font-medium">
          {token.links?.twitter && (
            <a href={token.links.twitter} target="_blank" rel="noreferrer" className="text-brand-green hover:text-brand-green-soft hover:underline">
              X/Twitter
            </a>
          )}
          {token.links?.dexscreener && (
            <a href={token.links.dexscreener} target="_blank" rel="noreferrer" className="text-brand-yellow hover:text-brand-yellow-strong hover:underline">
              DexScreener
            </a>
          )}
          {token.links?.coingecko && (
            <a href={token.links.coingecko} target="_blank" rel="noreferrer" className="text-[#06b6d4] hover:underline">
              CoinGecko
            </a>
          )}
          {token.website && (
            <a href={token.website} target="_blank" rel="noreferrer" className="text-white hover:underline transition-colors">
              Website
            </a>
          )}
        </div>
      </div>

      <TokenStats token={token} />

      <div className="flex border-b border-brand-border">
        <div className="flex-1 text-center py-4 text-brand-yellow font-bold border-b-2 border-brand-yellow bg-brand-yellow/5">
          Posts
        </div>
        <div className="flex-1 text-center py-4 text-brand-muted hover:text-white cursor-pointer transition-colors">
          Replies
        </div>
        <div className="flex-1 text-center py-4 text-brand-muted hover:text-white cursor-pointer transition-colors">
          Media
        </div>
      </div>

      <div>
        {posts.map(post => <PostCard key={post.id} post={post} />)}
      </div>
    </div>
  );
}
