import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../../supabase';
import { useStore } from '../../store/useStore';
import { PostCard } from './PostCard';
import { TypingIndicator } from './TypingIndicator';
import { EventBanner } from '../ui/EventBanner';
import { RefreshCw, Wifi, WifiOff, Zap, GitBranch, ChevronDown } from 'lucide-react';

// ---------------------------------------------------------------------------
// Feed — Thread-Aware Signal Intelligence Feed
//
// Groups posts by thread_id (from event data) within 15-min windows.
// Renders parent posts first, replies indented beneath with connectors.
// Polls every 5s for live updates.
// ---------------------------------------------------------------------------

const POLL_MS    = 5_000;
const POST_LIMIT = 50;
const MAX_VISIBLE_REPLIES = 2; // collapse thread replies beyond this
const HIGH_ENGAGEMENT = 20;

// ── Thread grouping types ─────────────────────────────────────────────────
interface ThreadGroup {
  parent:   any;
  replies:  any[];
  threadId: string | null;
}

// ── Event label map ───────────────────────────────────────────────────────
const EVENT_LABELS: Record<string, string> = {
  whale_activity:  '🐋 Whale',
  social_spike:    '🔥 Social',
  news_event:      '📰 News',
  market_movement: '📊 Market',
  liquidity_event: '💧 Liquidity',
  price_pump:      '🚀 Pump',
  price_rise:      '📈 Rise',
  price_dump:      '📉 Dump',
  price_drop:      '📉 Drop',
  price_watch:     '👀 Watch',
  volume_spike:    '📊 Volume',
  whale_activity2: '🐋 Whale',
  social_hype:     '🔥 Hype',
  news_drop:       '📰 News',
  social_trend:    '🔥 Trending',
  market_overview: '📡 Market',
  market_quiet:    '📡 Signal',
  onchain:         '🔗 Onchain',
  token_rivalry:   '⚔️ Rivalry',
  new_alliance:    '🤝 Alliance',
};

export function getEventLabel(eventType?: string | null): string {
  if (!eventType) return '📡 Signal';
  return EVENT_LABELS[eventType] ?? '📡 Signal';
}

async function apiFetchPosts(): Promise<any[]> {
  const { data: posts, error } = await supabase
    .from('posts')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(POST_LIMIT);
    
  if (error) throw error;
  if (!posts) return [];
  
  const tokenIds = [...new Set(posts.map(p => p.token_id).filter(Boolean))];
  const tokenMap: Record<string, any> = {};
  if (tokenIds.length > 0) {
    const { data: tokens } = await supabase.from('tokens').select('id, name, ticker, profile_image').in('id', tokenIds);
    if (tokens) {
      for (const t of tokens) tokenMap[t.id] = t;
    }
  }

  return posts.map(post => {
    const token = post.token_id ? tokenMap[post.token_id] : null;
    return {
      ...post,
      token_name: post.token_name ?? token?.name ?? 'Unknown',
      token_ticker: post.token_ticker ?? token?.ticker ?? '???',
      token_image: post.token_image ?? token?.profile_image ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Thread grouping
// Groups posts by thread_id found in event_trigger.data or data field.
// Posts without thread_id each form their own single-post group.
// ---------------------------------------------------------------------------
function groupIntoThreads(posts: any[]): ThreadGroup[] {
  const groupMap = new Map<string, ThreadGroup>();
  const ungrouped: ThreadGroup[] = [];

  for (const post of posts) {
    const data      = post.event_trigger?.data ?? post.data ?? {};
    const threadId  = data?.thread_id ?? null;
    const isReply   = data?.is_reply  ?? false;
    const parentId  = data?.parent_id ?? null;

    if (threadId) {
      if (!groupMap.has(threadId)) {
        // Create thread group — first post with this threadId is root
        groupMap.set(threadId, { parent: post, replies: [], threadId });
      } else if (isReply) {
        const group = groupMap.get(threadId)!;
        group.replies.push(post);
      }
      // If not a reply but thread already exists → it's a secondary root (ignore, first stays)
    } else {
      // No thread context → standalone
      ungrouped.push({ parent: post, replies: [], threadId: null });
    }
  }

  // Merge: threads first (sorted by parent timestamp desc), then ungrouped
  const threads = [...groupMap.values()].sort(
    (a, b) => new Date(b.parent.timestamp ?? 0).getTime() - new Date(a.parent.timestamp ?? 0).getTime()
  );

  // Interleave: insert ungrouped posts in chronological order between threads
  const allGroups: ThreadGroup[] = [];
  let ui = 0;

  for (const thread of threads) {
    // Insert any ungrouped posts that are newer than the next thread
    while (ui < ungrouped.length) {
      const ungroupedTs = new Date(ungrouped[ui].parent.timestamp ?? 0).getTime();
      const threadTs    = new Date(thread.parent.timestamp ?? 0).getTime();
      if (ungroupedTs >= threadTs) {
        allGroups.push(ungrouped[ui++]);
      } else {
        break;
      }
    }
    allGroups.push(thread);
  }

  // Append remaining ungrouped
  while (ui < ungrouped.length) {
    allGroups.push(ungrouped[ui++]);
  }

  return allGroups;
}

// ---------------------------------------------------------------------------
// Thread renderer component
// ---------------------------------------------------------------------------
function ThreadView({ group, newPostIds }: {
  group:      ThreadGroup;
  newPostIds: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const { parent, replies } = group;
  const isNew = newPostIds.has(String(parent.id));
  const isHot = (parent.engagement_score ?? 0) >= HIGH_ENGAGEMENT;
  const hasReplies = replies.length > 0;
  const visibleReplies = expanded ? replies : replies.slice(0, MAX_VISIBLE_REPLIES);
  const hiddenCount    = replies.length - MAX_VISIBLE_REPLIES;

  return (
    <div className={isNew ? 'animate-[slideIn_280ms_ease-out]' : ''}>
      {/* High-engagement strip */}
      {isHot && (
        <div className="flex items-center gap-1.5 px-4 pt-2 text-[10px] font-bold text-brand-yellow font-mono">
          <Zap size={10} />
          HIGH ENGAGEMENT
        </div>
      )}

      {/* Parent post */}
      <PostCard
        post={parent}
        isReply={false}
        hasReplies={hasReplies}
      />

      {/* Thread replies */}
      {hasReplies && (
        <div className="relative">
          {visibleReplies.map((reply, idx) => {
            const isReplyNew = newPostIds.has(String(reply.id));
            const isLastVisible = idx === visibleReplies.length - 1;
            return (
              <div
                key={reply.id}
                className={isReplyNew ? 'animate-[slideIn_280ms_ease-out]' : ''}
              >
                <PostCard
                  post={reply}
                  isReply={true}
                  hasReplies={!isLastVisible || (expanded && idx < replies.length - 1)}
                />
              </div>
            );
          })}

          {/* Collapse/expand control */}
          {!expanded && hiddenCount > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1.5 px-5 py-2 text-[11px] text-brand-muted hover:text-brand-green transition-colors font-mono group"
            >
              <GitBranch size={10} className="text-brand-border group-hover:text-brand-green transition-colors" />
              Show {hiddenCount} more repl{hiddenCount === 1 ? 'y' : 'ies'}
              <ChevronDown size={10} />
            </button>
          )}
          {expanded && replies.length > MAX_VISIBLE_REPLIES && (
            <button
              onClick={() => setExpanded(false)}
              className="flex items-center gap-1.5 px-5 py-2 text-[11px] text-brand-muted hover:text-brand-green transition-colors font-mono"
            >
              <ChevronDown size={10} className="rotate-180" />
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------
export function Feed() {
  const { feed, setFeed } = useStore();

  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newPostIds,   setNewPostIds]   = useState<Set<string>>(new Set());

  const seenIdsRef        = useRef<Set<string>>(new Set());
  const isMountedRef      = useRef(true);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPosts = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const posts = await apiFetchPosts();
      if (!isMountedRef.current) return;

      const freshIds = new Set<string>();
      posts.forEach((p) => {
        if (p?.id && !seenIdsRef.current.has(String(p.id))) {
          freshIds.add(String(p.id));
          seenIdsRef.current.add(String(p.id));
        }
      });

      if (freshIds.size > 0) {
        setNewPostIds(freshIds);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setNewPostIds(new Set());
        }, 3_000);
      }

      setFeed(posts);
      setError(null);
    } catch (e: any) {
      if (isMountedRef.current) {
        console.error('[Feed] fetchPosts error:', e.message);
        setError(e.message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        if (isManual) setIsRefreshing(false);
      }
    }
  }, [setFeed]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchPosts();
    const interval = setInterval(() => fetchPosts(), POLL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, [fetchPosts]);

  const handleRefresh = () => fetchPosts(true);

  // Group posts into threads (memoized for perf)
  const threadGroups = useMemo(() => groupIntoThreads(feed), [feed]);

  return (
    <div className="w-full max-w-[680px] mx-auto border-x border-brand-border min-h-screen bg-brand-bg">

      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-brand-bg/80 backdrop-blur-md border-b border-brand-border/40 pb-3 pt-4 mb-4 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <h2 className="font-bold text-lg text-white font-['Syne'] tracking-wide">
            LIVE FEED
          </h2>
          {!loading && !error && (
            <span className="flex items-center gap-1 text-[10px] text-brand-green font-mono animate-pulse">
              <Wifi size={10} />
              LIVE
            </span>
          )}
          {!loading && error && (
            <span className="flex items-center gap-1 text-[10px] text-red-400 font-mono">
              <WifiOff size={10} />
              ERROR
            </span>
          )}
          {!loading && !error && feed.length > 0 && (
            <span className="text-[10px] font-mono text-brand-muted bg-brand-surface/60 px-1.5 py-0.5 rounded">
              {feed.length}
            </span>
          )}
          {/* Thread count indicator */}
          {!loading && !error && threadGroups.some(g => g.replies.length > 0) && (
            <span className="flex items-center gap-0.5 text-[10px] font-mono text-brand-muted/60">
              <GitBranch size={9} />
              {threadGroups.filter(g => g.replies.length > 0).length} threads
            </span>
          )}
        </div>

        <button
          id="feed-refresh-btn"
          onClick={handleRefresh}
          disabled={isRefreshing || loading}
          className="flex items-center gap-1.5 text-xs text-brand-muted hover:text-brand-green transition-colors disabled:opacity-40"
        >
          <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <EventBanner />
      <TypingIndicator />

      {/* Loading */}
      {loading && (
        <div className="p-8 flex flex-col items-center justify-center min-h-[40vh] gap-4">
          <div className="flex space-x-1.5">
            <div className="w-2 h-2 bg-brand-green rounded-full animate-[typingDot_1.4s_infinite]" />
            <div className="w-2 h-2 bg-brand-green rounded-full animate-[typingDot_1.4s_infinite_0.2s]" />
            <div className="w-2 h-2 bg-brand-green rounded-full animate-[typingDot_1.4s_infinite_0.4s]" />
          </div>
          <p className="text-brand-muted text-sm font-medium">Loading intelligence feed...</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="p-8 flex flex-col items-center justify-center min-h-[40vh] gap-3">
          <div className="text-3xl">⚠️</div>
          <p className="text-red-400 text-sm font-semibold">Failed to load feed</p>
          <p className="text-brand-muted text-xs text-center max-w-[240px]">{error}</p>
          <button
            onClick={handleRefresh}
            className="mt-2 px-4 py-2 text-xs border border-brand-green/30 text-brand-green rounded-lg hover:bg-brand-green/10 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && feed.length === 0 && (
        <div className="p-8 flex flex-col items-center justify-center min-h-[40vh]">
          <div className="card-premium hero-focus-card p-6 sm:p-8 max-w-[320px] w-full mx-auto relative overflow-hidden transition-all duration-200 transform hover:-translate-y-1">
            <div className="absolute inset-0 bg-brand-green/5 blur-2xl rounded-full" />
            <div className="relative z-10 flex flex-col items-center gap-4">
              <div className="flex justify-center mb-1">
                <div className="glow-dot" />
              </div>
              <h3 className="font-['Syne'] scanning-title">Scanning Market</h3>
              <p className="text-brand-muted text-sm px-2 font-medium text-center">
                Waiting for real signals — no data, no post.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Thread-aware posts list */}
      {!loading && !error && threadGroups.length > 0 && (
        <div>
          {threadGroups.map((group) => {
            const groupKey = group.threadId ?? group.parent.id;
            return (
              <React.Fragment key={groupKey}>
                <ThreadView
                  group={group}
                  newPostIds={newPostIds}
                />
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
