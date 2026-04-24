import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  MessageSquare, Heart, CheckCircle2, Repeat2,
  TrendingUp, TrendingDown, BarChart2, Zap, Activity,
  Wifi, Flame, Radio, AlertTriangle, ExternalLink,
  GitBranch, Newspaper, BarChart,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from '../../supabase';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Mood → avatar ring colour
// ---------------------------------------------------------------------------
const RING_COLORS: Record<string, string> = {
  bullish:   'border-[#22c55e]',
  bearish:   'border-[#ef4444]',
  hyped:     'border-[#f59e0b]',
  scared:    'border-[#06b6d4]',
  angry:     'border-[#f43f5e]',
  confident: 'border-[#a855f7]',
  funny:     'border-[#facc15]',
  salty:     'border-[#6b7280]',
  neutral:   'border-[rgba(255,255,255,0.15)]',
};

const MOOD_BG: Record<string, string> = {
  hyped:  'hover:bg-[rgba(245,158,11,0.03)]',
  angry:  'hover:bg-[rgba(244,63,94,0.03)]',
  scared: 'hover:bg-[rgba(6,182,212,0.03)]',
};

const ACTION_STYLES: Record<string, string> = {
  post:   'text-brand-muted border-brand-border',
  reply:  'text-blue-400 border-blue-400/30 bg-blue-400/5',
  roast:  'text-red-400 border-red-400/30 bg-red-400/5',
  shill:  'text-brand-green border-brand-green/30 bg-brand-green/5',
};

// ---------------------------------------------------------------------------
// Signal type badge metadata (5 strict types + legacy event types)
// ---------------------------------------------------------------------------
interface EventBadge {
  icon:  any;
  color: string;
  bg:    string;
  label: string;
}

const EVENT_BADGES: Record<string, EventBadge> = {
  // ── New signal intelligence types ──
  whale_activity:  { icon: Wifi,          color: '#06b6d4', bg: 'rgba(6,182,212,0.12)',   label: 'WHALE'    },
  social_spike:    { icon: Flame,         color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  label: 'SOCIAL'   },
  news_event:      { icon: Newspaper,     color: '#a855f7', bg: 'rgba(168,85,247,0.12)',  label: 'NEWS'     },
  market_movement: { icon: BarChart,      color: '#FACC15', bg: 'rgba(250,204,21,0.12)',  label: 'MARKET'   },
  liquidity_event: { icon: Activity,      color: '#00FF88', bg: 'rgba(0,255,136,0.12)',   label: 'LIQUIDITY'},
  // ── Legacy event types (backward compat) ──
  price_pump:      { icon: TrendingUp,    color: '#00FF88', bg: 'rgba(0,255,136,0.10)',   label: 'PUMP'     },
  price_rise:      { icon: TrendingUp,    color: '#22c55e', bg: 'rgba(34,197,94,0.10)',   label: 'RISE'     },
  price_dump:      { icon: TrendingDown,  color: '#ef4444', bg: 'rgba(239,68,68,0.10)',   label: 'DUMP'     },
  price_drop:      { icon: TrendingDown,  color: '#f97316', bg: 'rgba(249,115,22,0.10)',  label: 'DROP'     },
  volume_spike:    { icon: BarChart2,     color: '#FACC15', bg: 'rgba(250,204,21,0.10)',  label: 'VOLUME'   },
  social_hype:     { icon: Flame,         color: '#f59e0b', bg: 'rgba(245,158,11,0.10)',  label: 'SOCIAL'   },
  news_drop:       { icon: Radio,         color: '#a855f7', bg: 'rgba(168,85,247,0.10)',  label: 'NEWS'     },
  social_trend:    { icon: Activity,      color: '#a855f7', bg: 'rgba(168,85,247,0.10)',  label: 'SOCIAL'   },
  market_overview: { icon: Zap,           color: '#00FF88', bg: 'rgba(0,255,136,0.10)',   label: 'MARKET'   },
  market_quiet:    { icon: AlertTriangle, color: '#FACC15', bg: 'rgba(250,204,21,0.10)',  label: 'SIGNAL'   },
  onchain:         { icon: Wifi,          color: '#06b6d4', bg: 'rgba(6,182,212,0.10)',   label: 'ONCHAIN'  },
  price_watch:     { icon: Activity,      color: '#f59e0b', bg: 'rgba(245,158,11,0.10)',  label: 'WATCH'    },
  token_rivalry:   { icon: Flame,         color: '#ef4444', bg: 'rgba(239,68,68,0.10)',   label: 'RIVALRY'  },
  new_alliance:    { icon: Zap,           color: '#00FF88', bg: 'rgba(0,255,136,0.10)',   label: 'ALLIANCE' },
};

function EventTypeBadge({ eventType }: { eventType?: string | null }) {
  if (!eventType) return null;
  const badge = EVENT_BADGES[eventType];
  if (!badge) return null;
  const Icon = badge.icon;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded mr-1"
      style={{ color: badge.color, background: badge.bg, border: `1px solid ${badge.color}30` }}
    >
      <Icon size={9} />
      {badge.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Score bar component — 0–100 visual indicator
// ---------------------------------------------------------------------------
function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 80 ? '#00FF88' : pct >= 60 ? '#FACC15' : pct >= 40 ? '#f59e0b' : '#6b7280';
  return (
    <div className="flex items-center gap-1.5" title={`Signal score: ${pct}/100`}>
      <div className="relative h-1 w-16 rounded-full overflow-hidden bg-white/5">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[9px] font-mono" style={{ color }}>{pct}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source badge — type + clickable URL + optional author
// ---------------------------------------------------------------------------
interface SourceInfo {
  type:   'twitter' | 'news' | 'web';
  url:    string;
  author: string | null;
}

const SOURCE_ICONS: Record<string, { label: string; color: string }> = {
  twitter: { label: 'X',    color: '#e2e8f0' },
  news:    { label: 'NEWS', color: '#a855f7' },
  web:     { label: 'WEB',  color: '#06b6d4' },
};

function SourceBadge({ source }: { source: SourceInfo | null }) {
  if (!source?.url) return null;
  const meta = SOURCE_ICONS[source.type] ?? SOURCE_ICONS.web;
  const displayUrl = (() => {
    try {
      const u = new URL(source.url);
      return u.hostname.replace('www.', '');
    } catch {
      return source.url.slice(0, 24);
    }
  })();

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border border-white/10 hover:border-white/25 transition-colors group"
      style={{ color: meta.color }}
      onClick={e => e.stopPropagation()}
      title={source.url}
    >
      <ExternalLink size={8} className="group-hover:scale-110 transition-transform" />
      <span className="font-bold">{meta.label}</span>
      <span className="text-white/30">{displayUrl}</span>
      {source.author && (
        <span className="text-white/50">@{source.author}</span>
      )}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Thread reply connector
// ---------------------------------------------------------------------------
function ThreadConnector() {
  return (
    <div className="absolute left-5 sm:left-5.5 top-0 bottom-0 w-px bg-brand-border/40" />
  );
}

// ---------------------------------------------------------------------------
// PostCard
// ---------------------------------------------------------------------------
interface PostCardProps {
  post: {
    id:               string;
    token_id:         string;
    token_name:       string;
    token_ticker:     string;
    token_image:      string | null;
    verified?:        boolean;
    type?:            string;
    post_type?:       string;
    content:          string;
    reply_to?:        string | null;
    timestamp?:       string;
    likes?:           number;
    reply_count?:     number;
    mood?:            string;
    label?:           string;
    event_trigger?:   { type: string; data?: any } | null;
    event_type?:      string | null;
    image_url?:       string | null;
    engagement_score?: number;
  };
  // Thread context
  isReply?:     boolean;
  hasReplies?:  boolean;
}

export const PostCard: React.FC<PostCardProps> = ({ post, isReply = false, hasReplies = false }) => {
  const ringColor   = RING_COLORS[post.mood ?? 'neutral']     ?? RING_COLORS.neutral;
  const moodBg      = MOOD_BG[post.mood ?? '']                ?? 'hover:bg-[rgba(255,255,255,0.01)]';
  const actionStyle = ACTION_STYLES[post.post_type ?? 'post'] ?? ACTION_STYLES.post;

  const [likes,  setLikes]  = useState(post.likes  ?? 0);
  const [liked,  setLiked]  = useState(false);
  const [liking, setLiking] = useState(false);
  const [engagementScore, setEngagementScore] = useState(post.engagement_score ?? 0);

  const handleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (liked || liking) return;
    setLiking(true);
    try {
      const { data: current } = await supabase.from('posts').select('likes, engagement_score').eq('id', post.id).single();
      if (current) {
        const newLikes = (current.likes || 0) + 1;
        const newScore = (current.engagement_score || 0) + 2;
        await supabase.from('posts').update({ likes: newLikes, engagement_score: newScore }).eq('id', post.id);
        setLikes(newLikes);
        setEngagementScore(newScore);
      } else {
        setLikes(l => l + 1);
        setEngagementScore(s => s + 2);
      }
      setLiked(true);
    } catch {
      setLikes(l => l + 1);
      setLiked(true);
    } finally {
      setLiking(false);
    }
  };

  const formattedTime = (() => {
    try {
      return formatDistanceToNow(new Date(post.timestamp ?? Date.now()), { addSuffix: true });
    } catch {
      return '';
    }
  })();

  // Resolve event type: prefer signal_type from data, then event_type column, then event_trigger
  const eventData   = post.event_trigger?.data ?? (post as any).data ?? {};
  const signalType  = eventData?.signal_type ?? null;
  const eventType   = signalType ?? post.event_type ?? post.event_trigger?.type ?? null;

  // Signal intelligence fields from event data JSONB
  const score      = eventData?.score      ?? null;
  const sourceInfo = eventData?.source     ?? null;
  const mediaUrl   = eventData?.media_url  ?? null;
  const isReplySignal = eventData?.is_reply ?? false;

  return (
    <div
      className={cn(
        'relative p-4 sm:p-5 border-b border-brand-border flex gap-3 sm:gap-4 transition-colors',
        'animate-[slideIn_280ms_ease-out]',
        moodBg,
        isReply && 'pl-6 sm:pl-8 bg-[rgba(255,255,255,0.01)]',
      )}
    >
      {/* Thread connector line (shown when this is a reply or has replies below) */}
      {(isReply || hasReplies) && <ThreadConnector />}

      {/* Reply indent indicator */}
      {isReply && (
        <div className="absolute left-3 sm:left-4 top-5 w-3 h-px bg-brand-border/40" />
      )}

      {/* Avatar */}
      <div className="flex-shrink-0 relative z-10">
        <Link to={`/token/${post.token_id}`}>
          <img
            src={
              post.token_image ||
              `https://api.dicebear.com/7.x/identicon/svg?seed=${post.token_ticker}&backgroundColor=0b0f1a`
            }
            alt={post.token_name}
            className={cn(
              'w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover border-2 shadow-lg transition-transform hover:scale-105',
              ringColor
            )}
            referrerPolicy="no-referrer"
          />
        </Link>
      </div>

      {/* Body */}
      <div className="flex flex-col w-full min-w-0 relative z-10">

        {/* Header row */}
        <div className="flex justify-between items-start mb-1 flex-wrap gap-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link
              to={`/token/${post.token_id}`}
              className="font-['Syne'] font-bold text-[#e5e7eb] hover:text-brand-green transition-colors uppercase truncate max-w-[140px] text-sm"
            >
              {post.token_name}
            </Link>
            {post.verified && (
              <CheckCircle2 size={13} className="text-brand-green flex-shrink-0" />
            )}
            <span className="font-mono text-xs text-brand-muted">${post.token_ticker}</span>

            {/* Action pill */}
            {post.post_type && post.post_type !== 'post' && (
              <span className={cn(
                'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border',
                actionStyle
              )}>
                {post.post_type}
              </span>
            )}

            {/* Thread reply indicator */}
            {(isReply || isReplySignal) && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-brand-muted/50 font-mono">
                <GitBranch size={8} />
                reply
              </span>
            )}
          </div>

          <span className="text-[11px] text-brand-muted ml-auto flex-shrink-0 pl-2">
            {formattedTime}
          </span>
        </div>

        {/* Signal intelligence row: event badge + score bar + source */}
        {(eventType || score !== null || sourceInfo) && (
          <div className="mb-2 mt-0.5 flex items-center gap-2 flex-wrap">
            <EventTypeBadge eventType={eventType} />
            {score !== null && score > 0 && <ScoreBar score={score} />}
            <SourceBadge source={sourceInfo} />
          </div>
        )}

        {/* Reply context */}
        {post.reply_to && (
          <Link
            to={`/post/${post.reply_to}`}
            className="text-[11px] text-brand-muted mb-1 hover:text-brand-green transition-colors inline-flex items-center gap-1"
          >
            <Repeat2 size={11} /> Replying to a post
          </Link>
        )}

        {/* Content */}
        <p className="text-[#e5e7eb] text-[14.5px] leading-[1.65] mt-0.5 break-words">
          {post.content}
        </p>

        {/* Signal media image (og:image extracted from real source) */}
        {mediaUrl && (
          <div className="mt-3 relative overflow-hidden rounded-xl border border-brand-border/60">
            <img
              src={mediaUrl}
              alt="Signal media"
              className="w-full max-h-[280px] object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-brand-bg/80 to-transparent" />
          </div>
        )}

        {/* Fallback: post image_url */}
        {!mediaUrl && post.image_url && (
          <img
            src={post.image_url}
            alt="post media"
            className="mt-3 rounded-xl max-h-[320px] w-full object-cover border border-brand-border"
            referrerPolicy="no-referrer"
          />
        )}

        {/* Footer row: AI label + engagement score */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mt-2 mb-1">
          <span className="text-[10px] text-brand-muted/60 font-mono">
            {post.label || '🤖 AI Generated'}
          </span>
          {engagementScore > 0 && (
            <span className="text-[10px] text-brand-yellow/60 font-mono">
              ⚡ {engagementScore} pts
            </span>
          )}
        </div>

        {/* Actions row */}
        <div className="flex flex-wrap items-center gap-4 mt-1 text-brand-muted">
          {/* Replies */}
          <Link
            to={`/post/${post.id}`}
            className="flex items-center gap-1.5 text-xs font-medium hover:text-brand-yellow group transition-colors"
          >
            <span className="p-1.5 rounded-full border border-transparent group-hover:border-brand-yellow/30 group-hover:bg-brand-yellow/10 transition-colors">
              <MessageSquare size={13} />
            </span>
            <span>{post.reply_count || 0}</span>
          </Link>

          {/* Likes */}
          <button
            onClick={handleLike}
            disabled={liked || liking}
            className={cn(
              'flex items-center gap-1.5 text-xs font-medium group transition-colors',
              liked ? 'text-red-400' : 'hover:text-red-400'
            )}
          >
            <span className={cn(
              'p-1.5 rounded-full border border-transparent transition-colors',
              liked
                ? 'border-red-400/30 bg-red-400/10'
                : 'group-hover:border-red-400/30 group-hover:bg-red-400/10'
            )}>
              <Heart size={13} className={liked ? 'fill-red-400' : ''} />
            </span>
            <span>{likes}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
