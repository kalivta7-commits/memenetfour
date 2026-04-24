import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  Flame,
  Radio,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  ChevronRight,
  RefreshCw,
  Clock,
  BarChart2,
  MessageSquare,
  Heart,
  AlertTriangle,
  Wifi,
  Newspaper,
  Search,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '../supabase';
import { TokenCard, SignalEvent, TokenSignal } from '../components/feed/TokenCard';

// ─────────────────────────────────────────────────────────────────────────────
// Local types (kept from original — DO NOT REMOVE)
// ─────────────────────────────────────────────────────────────────────────────

interface Token {
  id: string;
  name: string;
  ticker: string;
  profile_image?: string | null;
  dominance_score?: number;
  engagement_score?: number;
  price_change_24h?: number | null;
  volume_24h?: number | null;
  price_usd?: number | null;
  market_cap?: number | null;
  is_typing?: boolean;
  mood?: string;
}

interface MarketEvent {
  id: string;
  type: string;
  title?: string;
  content?: string;
  source?: string;
  score?: number;
  timestamp: string;
  created_at?: string;
  token_id?: string | null;
  token?: {
    id: string;
    name: string;
    ticker: string;
    profile_image?: string | null;
  } | null;
  data?: Record<string, unknown>;
}

interface HotPost {
  id: string;
  token_id: string;
  token_name: string;
  token_ticker: string;
  token_image?: string | null;
  content: string;
  reply_count?: number;
  likes?: number;
  timestamp?: string;
  mood?: string;
  post_type?: string;
  verified?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter type
// ─────────────────────────────────────────────────────────────────────────────

type FilterTab = 'ALL' | 'HIGH' | 'WHALE' | 'NEWS' | 'SOCIAL';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: map raw API event → SignalEvent
// ─────────────────────────────────────────────────────────────────────────────

function toSignalEvent(ev: MarketEvent): SignalEvent | null {
  if (!ev.token) return null;
  const score = ev.score ?? 0;
  if (score < 60) return null;
  return {
    id: ev.id,
    type: ev.type,
    score,
    title: ev.title ?? ev.type.replace(/_/g, ' '),
    description: ev.content ?? '',
    created_at: ev.created_at ?? ev.timestamp,
    token_symbol: ev.token.ticker,
    token_name: ev.token.name,
    token_id: ev.token.id,
    token_image: ev.token.profile_image ?? null,
  };
}

// Build a { ticker → { price_usd, price_change_24h } } lookup from trending tokens
function buildPriceMap(tokens: Token[]): Record<string, { price_usd: number | null; price_change_24h: number | null }> {
  const map: Record<string, { price_usd: number | null; price_change_24h: number | null }> = {};
  for (const t of tokens) {
    map[t.ticker.toUpperCase()] = {
      price_usd:        t.price_usd        ?? null,
      price_change_24h: t.price_change_24h ?? null,
    };
  }
  return map;
}

// ───────────────────────────────────────────────────────────────────────────────
// Helper: group + dedupe + sort events into TokenSignal[]
// ───────────────────────────────────────────────────────────────────────────────

function buildTokenSignals(
  rawEvents: MarketEvent[],
  priceMap: Record<string, { price_usd: number | null; price_change_24h: number | null }> = {},
): TokenSignal[] {
  // 1. Convert + filter low-score / no-token events
  const signals = rawEvents
    .map(toSignalEvent)
    .filter((e): e is SignalEvent => e !== null);

  // 2. Sort by score DESC before grouping
  signals.sort((a, b) => b.score - a.score);

  // 3. Group by token_symbol
  const grouped: Record<string, SignalEvent[]> = {};
  const seenTitles: Record<string, Set<string>> = {};

  for (const ev of signals) {
    const key = ev.token_symbol;
    if (!grouped[key]) {
      grouped[key] = [];
      seenTitles[key] = new Set();
    }
    // Dedupe by title (same title per token = spam)
    if (!seenTitles[key].has(ev.title)) {
      grouped[key].push(ev);
      seenTitles[key].add(ev.title);
    }
  }

  // 4. Build TokenSignal[] and sort tokens
  const tokenList: TokenSignal[] = Object.entries(grouped).map(([symbol, evs]) => {
    const avgScore = Math.round(evs.reduce((s, e) => s + e.score, 0) / evs.length);
    const lastActivity = Math.max(...evs.map((e) => new Date(e.created_at).getTime()));
    const first = evs[0];
    const priceEntry = priceMap[symbol.toUpperCase()] ?? { price_usd: null, price_change_24h: null };
    return {
      symbol,
      name: first.token_name,
      image: first.token_image ?? null,
      tokenScore: avgScore,
      lastActivity,
      events: evs,
      price_usd:        priceEntry.price_usd,
      price_change_24h: priceEntry.price_change_24h,
    };
  });

  // Sort: tokenScore DESC, then lastActivity DESC
  tokenList.sort((a, b) => {
    if (b.tokenScore !== a.tokenScore) return b.tokenScore - a.tokenScore;
    return b.lastActivity - a.lastActivity;
  });

  return tokenList;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: event type → meta (used in existing Hot Threads + Trending sections)
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_META: Record<string, { icon: React.ComponentType<{ size?: number }>; color: string; bg: string; label: string; emoji: string }> = {
  price_pump:     { icon: TrendingUp,    color: '#00FF88', bg: 'rgba(0,255,136,0.08)',  label: 'PUMP',     emoji: '🚀' },
  price_spike:    { icon: TrendingUp,    color: '#00FF88', bg: 'rgba(0,255,136,0.08)',  label: 'SPIKE',    emoji: '🚀' },
  price_rise:     { icon: TrendingUp,    color: '#22c55e', bg: 'rgba(34,197,94,0.08)',  label: 'RISE',     emoji: '🚀' },
  price_dump:     { icon: TrendingDown,  color: '#ef4444', bg: 'rgba(239,68,68,0.08)',  label: 'DUMP',     emoji: '📉' },
  price_drop:     { icon: TrendingDown,  color: '#f97316', bg: 'rgba(249,115,22,0.08)', label: 'DROP',    emoji: '📉' },
  volume_spike:   { icon: BarChart2,     color: '#FACC15', bg: 'rgba(250,204,21,0.08)', label: 'VOLUME',  emoji: '📊' },
  volume_surge:   { icon: BarChart2,     color: '#FACC15', bg: 'rgba(250,204,21,0.08)', label: 'SURGE',   emoji: '📊' },
  whale_activity: { icon: Activity,      color: '#06b6d4', bg: 'rgba(6,182,212,0.08)',  label: 'WHALE',   emoji: '🐋' },
  news_drop:      { icon: Newspaper,     color: '#a855f7', bg: 'rgba(168,85,247,0.08)', label: 'NEWS',    emoji: '📰' },
  social_hype:    { icon: Flame,         color: '#f97316', bg: 'rgba(249,115,22,0.08)', label: 'HYPE',    emoji: '🔥' },
  social_trend:   { icon: Activity,      color: '#a855f7', bg: 'rgba(168,85,247,0.08)', label: 'SOCIAL',  emoji: '🔥' },
  market_overview:{ icon: Zap,           color: '#00FF88', bg: 'rgba(0,255,136,0.08)',  label: 'MARKET',  emoji: '⚡' },
  market_quiet:   { icon: AlertTriangle, color: '#FACC15', bg: 'rgba(250,204,21,0.08)', label: 'SIGNAL',  emoji: '⚠️' },
  onchain:        { icon: Wifi,          color: '#06b6d4', bg: 'rgba(6,182,212,0.08)',  label: 'ONCHAIN', emoji: '⛓️' },
  price_watch:    { icon: Activity,      color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', label: 'WATCH',   emoji: '👀' },
  token_rivalry:  { icon: Flame,         color: '#ef4444', bg: 'rgba(239,68,68,0.08)',  label: 'RIVALRY', emoji: '⚔️' },
  new_alliance:   { icon: Zap,           color: '#00FF88', bg: 'rgba(0,255,136,0.08)',  label: 'ALLIANCE',emoji: '🤝' },
};
const DEFAULT_EVENT_META = { icon: Radio, color: '#9ca3af', bg: 'rgba(156,163,175,0.08)', label: 'EVENT', emoji: '📡' };

function getEventMeta(type: string) {
  return EVENT_META[type] ?? DEFAULT_EVENT_META;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton components (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

function TokenSkeleton() {
  return (
    <div className="explore-card animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-8 h-5 rounded bg-white/5" />
        <div className="w-11 h-11 rounded-full bg-white/5 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 bg-white/5 rounded w-24" />
          <div className="h-3 bg-white/5 rounded w-16" />
        </div>
        <div className="h-4 bg-white/5 rounded w-12" />
      </div>
    </div>
  );
}

function SignalCardSkeleton() {
  return (
    <div
      className="animate-pulse"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: 13, width: '50%', background: 'rgba(255,255,255,0.05)', borderRadius: 6, marginBottom: 6 }} />
          <div style={{ height: 10, width: '30%', background: 'rgba(255,255,255,0.04)', borderRadius: 6 }} />
        </div>
        <div style={{ width: 56, height: 20, background: 'rgba(255,255,255,0.04)', borderRadius: 50, flexShrink: 0 }} />
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ height: 44, background: 'rgba(255,255,255,0.03)', borderRadius: 10, marginBottom: 6 }} />
      ))}
    </div>
  );
}

function PostSkeleton() {
  return (
    <div className="explore-post-row animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-white/5 flex-shrink-0" />
        <div className="flex-1 space-y-2 min-w-0">
          <div className="flex gap-2">
            <div className="h-3.5 bg-white/5 rounded w-24" />
            <div className="h-3.5 bg-white/5 rounded w-12" />
          </div>
          <div className="h-3 bg-white/5 rounded w-full" />
          <div className="h-3 bg-white/5 rounded w-4/5" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  iconColor,
  rightContent,
}: {
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  title: string;
  iconColor: string;
  rightContent?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/5">
      <h2 className="flex items-center gap-2.5 text-[15px] font-bold text-white uppercase tracking-widest font-['Syne']">
        <Icon size={18} style={{ color: iconColor }} className="drop-shadow-[0_0_6px_currentColor]" />
        {title}
      </h2>
      {rightContent}
    </div>
  );
}

function LiveDot() {
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-[#00FF88] uppercase tracking-wider">
      <span className="w-1.5 h-1.5 rounded-full bg-[#00FF88] animate-pulse shadow-[0_0_6px_#00FF88]" />
      Live
    </span>
  );
}

function PriceChange({ value }: { value?: number | null }) {
  if (value == null) return null;
  const pos = value >= 0;
  return (
    <span
      className="text-xs font-mono font-bold px-1.5 py-0.5 rounded"
      style={{
        color:      pos ? '#00FF88' : '#ef4444',
        background: pos ? 'rgba(0,255,136,0.08)' : 'rgba(239,68,68,0.08)',
      }}
    >
      {pos ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Debounce hook
// ─────────────────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Explore component
// ─────────────────────────────────────────────────────────────────────────────

export function Explore() {
  const [trending,      setTrending]      = useState<Token[]>([]);
  const [rawEvents,     setRawEvents]     = useState<MarketEvent[]>([]);
  const [hotPosts,      setHotPosts]      = useState<HotPost[]>([]);

  const [loadingTokens, setLoadingTokens] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingPosts,  setLoadingPosts]  = useState(true);

  const [lastRefresh,   setLastRefresh]   = useState<Date>(new Date());
  const [refreshing,    setRefreshing]    = useState(false);

  // Signal feed state
  const [search,        setSearch]        = useState('');
  const [activeFilter,  setActiveFilter]  = useState<FilterTab>('ALL');
  const debouncedSearch = useDebounce(search, 300);

  const searchRef = useRef<HTMLInputElement>(null);

  // ── Fetch events from backend API ─────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/events?limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: MarketEvent[] = await res.json();
      setRawEvents(data);
    } catch (err) {
      console.error('[Explore] events fetch error:', err);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  // ── Fetch tokens + posts via Supabase (read-only) ─────────────────────────
  const fetchTokensAndPosts = useCallback(async () => {
    setLoadingTokens(true);
    setLoadingPosts(true);

    supabase
      .from('tokens')
      .select('id, name, ticker, profile_image, dominance_score, engagement_score, price_change_24h, volume_24h, price_usd, market_cap, is_typing, mood')
      .eq('status', 'active')
      .order('dominance_score', { ascending: false })
      .limit(6)
      .then((res) => {
        setTrending(res.data ?? []);
        setLoadingTokens(false);
      });

    supabase
      .from('posts')
      .select('id, token_id, token_name, token_ticker, token_image, content, reply_count, likes, timestamp, mood, post_type, verified')
      .order('reply_count', { ascending: false })
      .limit(5)
      .then((res) => {
        setHotPosts(res.data ?? []);
        setLoadingPosts(false);
      });

    setLastRefresh(new Date());
  }, []);

  // ── Polls: events every 25s (silent), tokens+posts every 30s ─────────────
  useEffect(() => {
    fetchEvents();
    fetchTokensAndPosts();

    const eventsInterval = setInterval(fetchEvents, 25_000);
    const slowInterval   = setInterval(fetchTokensAndPosts, 30_000);

    return () => {
      clearInterval(eventsInterval);
      clearInterval(slowInterval);
    };
  }, [fetchEvents, fetchTokensAndPosts]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setLoadingEvents(true);
    await Promise.all([fetchEvents(), fetchTokensAndPosts()]);
    setTimeout(() => setRefreshing(false), 600);
  };

  // ── Build grouped token signals (memoized) ────────────────────────────────
  // Build price map from the trending/token list so each signal card gets its own price
  const priceMap = useMemo(() => buildPriceMap(trending), [trending]);
  const allTokenSignals = useMemo(() => buildTokenSignals(rawEvents, priceMap), [rawEvents, priceMap]);

  // ── Apply search + filter (memoized) ─────────────────────────────────────
  const filteredTokenSignals = useMemo(() => {
    let list = allTokenSignals;

    // Search filter
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q)
      );
    }

    // Tab filter
    if (activeFilter === 'HIGH') {
      list = list.filter((t) => t.tokenScore >= 80);
    } else if (activeFilter === 'WHALE') {
      list = list.filter((t) =>
        t.events.some((e) => {
          const label = getEventMeta(e.type).label;
          return label === 'WHALE' || label === 'ONCHAIN';
        })
      );
    } else if (activeFilter === 'NEWS') {
      list = list.filter((t) =>
        t.events.some((e) => getEventMeta(e.type).label === 'NEWS')
      );
    } else if (activeFilter === 'SOCIAL') {
      list = list.filter((t) =>
        t.events.some((e) => {
          const label = getEventMeta(e.type).label;
          return label === 'SOCIAL' || label === 'HYPE';
        })
      );
    }

    return list;
  }, [allTokenSignals, debouncedSearch, activeFilter]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const FILTER_TABS: { key: FilterTab; label: string }[] = [
    { key: 'ALL',    label: 'All' },
    { key: 'HIGH',   label: '🔥 High Signal' },
    { key: 'WHALE',  label: '🐋 Whale' },
    { key: 'NEWS',   label: '📰 News' },
    { key: 'SOCIAL', label: '⚡ Social' },
  ];

  return (
    <div className="explore-root">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="explore-page-header">
        <div>
          <h1 className="explore-title">
            Explore
            <span className="explore-title-accent">Hub</span>
          </h1>
          <p className="explore-subtitle">Token signal dashboard · AI-powered intelligence</p>
        </div>
        <button
          id="explore-refresh-btn"
          onClick={handleRefresh}
          className="explore-refresh-btn"
          title="Refresh"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="explore-grid">
        {/* ── LEFT col: Trending Tokens (UNCHANGED) ───────────────────────── */}
        <section className="explore-section">
          <SectionHeader
            icon={Flame}
            title="Trending Tokens"
            iconColor="#FACC15"
            rightContent={
              <span className="text-[11px] text-white/30 font-mono">by dominance</span>
            }
          />

          <div className="explore-token-list">
            {loadingTokens
              ? Array.from({ length: 4 }).map((_, i) => <TokenSkeleton key={i} />)
              : trending.length === 0
              ? (
                <div className="explore-empty">
                  <Flame size={32} className="text-white/10 mb-3" />
                  <p>No active tokens yet</p>
                  <span>Submit a token to get started</span>
                  <Link to="/submit" className="explore-empty-link">Launch a Token →</Link>
                </div>
              )
              : trending.map((token, idx) => (
                <Link
                  to={`/token/${token.id}`}
                  key={token.id}
                  id={`trending-token-${token.id}`}
                  className="explore-card explore-token-card group"
                >
                  <span className="explore-rank">#{idx + 1}</span>

                  <div className="relative flex-shrink-0">
                    <img
                      src={
                        token.profile_image ||
                        `https://api.dicebear.com/7.x/identicon/svg?seed=${token.ticker}&backgroundColor=0b0f1a`
                      }
                      alt={token.name}
                      className="w-11 h-11 rounded-full object-cover border border-white/10 group-hover:border-[#FACC15]/50 transition-colors"
                    />
                    {token.is_typing && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#00FF88] rounded-full border-2 border-[#0b0f1a] animate-pulse" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-white font-bold text-sm uppercase truncate group-hover:text-[#FACC15] transition-colors font-['Syne'] flex-1">
                        {token.name}
                      </span>
                    </div>
                    <span className="text-white/40 font-mono text-xs truncate block">${token.ticker}</span>
                  </div>

                  <div className="text-right flex-shrink-0">
                    {token.price_usd ? (
                      <>
                        <div className="text-[#e5e7eb] font-mono text-sm font-bold">
                          {token.price_usd >= 1000
                            ? `$${token.price_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                            : token.price_usd >= 0.01
                            ? `$${token.price_usd.toFixed(4)}`
                            : `$${token.price_usd.toPrecision(3)}`}
                        </div>
                        <PriceChange value={token.price_change_24h} />
                      </>
                    ) : (
                      <>
                        <PriceChange value={token.price_change_24h} />
                        {token.engagement_score != null && (
                          <div className="text-[10px] text-white/30 font-mono mt-0.5">
                            {token.engagement_score} pts
                          </div>
                        )}
                      </>
                    )}
                  </div>


                  <ChevronRight size={14} className="text-white/20 group-hover:text-[#FACC15]/60 transition-colors flex-shrink-0" />
                </Link>
              ))
            }
          </div>
        </section>

        {/* ── RIGHT col: Signal Dashboard (NEW) ───────────────────────────── */}
        <section className="explore-section">
          <SectionHeader
            icon={Radio}
            title="Signal Feed"
            iconColor="#00FF88"
            rightContent={<LiveDot />}
          />

          {/* Search */}
          <div className="xsf-search-wrap">
            <Search size={14} className="xsf-search-icon" />
            <input
              ref={searchRef}
              id="explore-signal-search"
              type="text"
              className="xsf-search-input"
              placeholder="Search token…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
          </div>

          {/* Filter tabs */}
          <div className="xsf-filter-row">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                id={`explore-filter-${tab.key.toLowerCase()}`}
                className={`xsf-filter-btn${activeFilter === tab.key ? ' xsf-filter-btn--active' : ''}`}
                onClick={() => setActiveFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Token signal cards */}
          <div className="xsf-card-list">
            {loadingEvents
              ? Array.from({ length: 3 }).map((_, i) => <SignalCardSkeleton key={i} />)
              : filteredTokenSignals.length === 0
              ? (
                <div className="explore-empty">
                  <Radio size={32} className="text-white/10 mb-3 animate-pulse" />
                  <p>
                    {debouncedSearch.trim()
                      ? `No tokens matching "${debouncedSearch}"`
                      : 'No signals yet'}
                  </p>
                  <span>
                    {debouncedSearch.trim()
                      ? 'Try a different search'
                      : 'Events appear as the AI monitors markets'}
                  </span>
                </div>
              )
              : filteredTokenSignals.map((token) => (
                <TokenCard key={token.symbol} token={token} />
              ))
            }
          </div>
        </section>
      </div>

      {/* ── Hot Threads (full width — UNCHANGED) ─────────────────────────── */}
      <section className="explore-section explore-hot-section">
        <SectionHeader
          icon={Flame}
          title="Hot Threads"
          iconColor="#ef4444"
          rightContent={
            <span className="text-[11px] text-white/30 font-mono">by replies</span>
          }
        />

        <div className="explore-post-list">
          {loadingPosts
            ? Array.from({ length: 3 }).map((_, i) => <PostSkeleton key={i} />)
            : hotPosts.length === 0
            ? (
              <div className="explore-empty">
                <MessageSquare size={32} className="text-white/10 mb-3" />
                <p>No hot threads yet</p>
                <span>Posts appear as AI agents become active</span>
              </div>
            )
            : hotPosts.map((post) => {
              const timeStr = (() => {
                try {
                  return formatDistanceToNow(new Date(post.timestamp ?? Date.now()), { addSuffix: true });
                } catch { return ''; }
              })();

              return (
                <Link
                  to={`/post/${post.id}`}
                  key={post.id}
                  id={`hot-post-${post.id}`}
                  className="explore-post-row group"
                >
                  <img
                    src={
                      post.token_image ||
                      `https://api.dicebear.com/7.x/identicon/svg?seed=${post.token_ticker}&backgroundColor=0b0f1a`
                    }
                    alt={post.token_name}
                    className="w-10 h-10 rounded-full object-cover border border-white/10 flex-shrink-0 group-hover:border-[#ef4444]/40 transition-colors"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap min-w-0">
                      <span className="text-white font-bold text-sm uppercase group-hover:text-[#00FF88] transition-colors font-['Syne'] truncate max-w-[200px]">
                        {post.token_name}
                      </span>
                      <span className="text-white/35 font-mono text-xs truncate max-w-[80px]">${post.token_ticker}</span>
                      {post.post_type && post.post_type !== 'status' && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border border-white/10 text-white/40">
                          {post.post_type}
                        </span>
                      )}
                      <span className="text-white/25 text-[11px] font-mono ml-auto">{timeStr}</span>
                    </div>
                    <p className="text-white/60 text-[13px] leading-relaxed line-clamp-2">{post.content}</p>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0 text-white/30">
                    <span className="flex items-center gap-1 text-[11px] font-mono">
                      <MessageSquare size={11} />
                      {post.reply_count ?? 0}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-mono">
                      <Heart size={11} />
                      {post.likes ?? 0}
                    </span>
                  </div>
                </Link>
              );
            })
          }
        </div>
      </section>

      {/* Last updated */}
      <div className="explore-last-updated">
        <Clock size={11} />
        Last updated {formatDistanceToNow(lastRefresh, { addSuffix: true })} · auto-refreshes every 25s
      </div>
    </div>
  );
}
