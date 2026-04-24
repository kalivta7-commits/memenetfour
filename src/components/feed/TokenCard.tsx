import React, { useState, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ChevronDown, ChevronUp, Clock, Activity } from 'lucide-react';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface SignalEvent {
  id: string;
  type: string;
  score: number;
  title: string;
  description: string;
  created_at: string;
  token_symbol: string;
  token_name: string;
  token_id?: string | null;
  token_image?: string | null;
}

export interface TokenSignal {
  symbol: string;
  name: string;
  image: string | null;
  tokenScore: number;
  lastActivity: number;
  events: SignalEvent[];
  // Live market data (optional — populated when available from DB/API)
  price_usd?: number | null;
  price_change_24h?: number | null;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return 'recently';
  }
}

function getSignalMeta(type: string): { emoji: string; color: string; bg: string; label: string } {
  const t = type.toLowerCase();
  if (t.includes('whale') || t.includes('onchain'))
    return { emoji: '🐋', color: '#06b6d4', bg: 'rgba(6,182,212,0.10)', label: 'WHALE' };
  if (t.includes('social') || t.includes('hype') || t.includes('trend'))
    return { emoji: '🔥', color: '#f97316', bg: 'rgba(249,115,22,0.10)', label: 'SOCIAL' };
  if (t.includes('news') || t.includes('drop') || t.includes('alliance') || t.includes('rivalry'))
    return { emoji: '📰', color: '#a855f7', bg: 'rgba(168,85,247,0.10)', label: 'NEWS' };
  if (t.includes('pump') || t.includes('spike') || t.includes('rise') || t.includes('volume') || t.includes('surge'))
    return { emoji: '🚀', color: '#00FF88', bg: 'rgba(0,255,136,0.10)', label: 'MARKET' };
  if (t.includes('dump') || t.includes('drop'))
    return { emoji: '📉', color: '#ef4444', bg: 'rgba(239,68,68,0.10)', label: 'MARKET' };
  return { emoji: '⚡', color: '#FACC15', bg: 'rgba(250,204,21,0.10)', label: 'SIGNAL' };
}

// ─────────────────────────────────────────────
// Price badge — shown in card header when price data is available
// ─────────────────────────────────────────────

function fmtPrice(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 1)    return `$${n.toFixed(4)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toPrecision(3)}`;
}

function PriceBadge({ price, change }: { price: number | null | undefined; change: number | null | undefined }) {
  if (price == null || price === 0) return null;
  const isUp = (change ?? 0) >= 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#e5e7eb' }}>
        {fmtPrice(price)}
      </span>
      {change != null && (
        <span
          style={{
            fontSize: 10,
            fontFamily: 'monospace',
            fontWeight: 700,
            color: isUp ? '#00FF88' : '#ef4444',
          }}
        >
          {isUp ? '+' : ''}{change.toFixed(2)}%
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Score Bar
// ─────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const clamped = Math.min(100, Math.max(0, score));
  const color =
    clamped >= 80 ? '#00FF88' : clamped >= 60 ? '#FACC15' : '#9ca3af';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          height: 4,
          width: 56,
          borderRadius: 99,
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${clamped}%`,
            background: color,
            borderRadius: 99,
            transition: 'width 0.7s ease',
          }}
        />
      </div>
      <span style={{ fontSize: 10, fontFamily: 'monospace', color, fontWeight: 700 }}>
        {clamped}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Event Row
// ─────────────────────────────────────────────

const EventRow: React.FC<{ event: SignalEvent }> = ({ event }) => {
  const meta = getSignalMeta(event.type);
  return (
    <div className="tc-event-row">
      <div
        className="tc-event-icon"
        style={{ background: meta.bg, color: meta.color }}
        title={meta.label}
      >
        <span style={{ fontSize: 13 }}>{meta.emoji}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="tc-event-title">{event.title}</p>
        {event.description && (
          <p className="tc-event-desc">{event.description}</p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <ScoreBar score={event.score} />
          <span className="tc-event-time">
            <Clock size={9} style={{ display: 'inline', marginRight: 3 }} />
            {timeAgo(event.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// TokenCard
// ─────────────────────────────────────────────

export interface TokenCardProps {
  token: TokenSignal;
}

export const TokenCard: React.FC<TokenCardProps> = ({ token }) => {
  const [expanded, setExpanded] = useState(false);

  const isHigh  = token.tokenScore >= 80;
  const visible = expanded ? token.events : token.events.slice(0, 3);
  const extra   = token.events.length - 3;

  const avatarSrc =
    token.image ||
    `https://api.dicebear.com/7.x/identicon/svg?seed=${token.symbol}&backgroundColor=0b0f1a`;

  // Compute type counts for stats row
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of token.events) {
      const meta = getSignalMeta(e.type);
      counts[meta.label] = (counts[meta.label] ?? 0) + 1;
    }
    return counts;
  }, [token.events]);

  return (
    <div
      className={`tc-card w-full max-w-full overflow-hidden${isHigh ? ' tc-card--high' : ''}`}
      style={
        isHigh
          ? {
              boxShadow:
                '0 0 0 1px rgba(0,255,136,0.25), 0 0 20px rgba(0,255,136,0.07), 0 8px 32px rgba(0,0,0,0.35)',
            }
          : {}
      }
    >
      {/* ── Header ── */}
      <div className="tc-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <div className="tc-avatar-wrap">
            <img src={avatarSrc} alt={token.name} className="tc-avatar" />
            {isHigh && <span className="tc-avatar-glow" />}
          </div>
          <div style={{ minWidth: 0 }}>
            <p className="tc-token-name">{token.name}</p>
            <p className="tc-token-ticker">${token.symbol}</p>
          </div>
        </div>

        {/* Price + signal badge row */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <PriceBadge price={token.price_usd} change={token.price_change_24h} />
          {isHigh ? (
            <span className="tc-badge tc-badge--high">🔥 HIGH</span>
          ) : (
            <span className="tc-badge tc-badge--active">⚡ ACTIVE</span>
          )}
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="tc-stats-row">
        <div className="tc-stat">
          <Activity size={11} style={{ color: '#9ca3af' }} />
          <span className="tc-stat-label">{token.events.length} signals</span>
        </div>
        <div className="tc-stat-divider" />
        <div className="tc-stat">
          <span className="tc-stat-label">
            avg{' '}
            <strong style={{ color: token.tokenScore >= 80 ? '#00FF88' : '#FACC15' }}>
              {token.tokenScore}
            </strong>
          </span>
        </div>
        <div className="tc-stat-divider" />
        <div className="tc-stat">
          <Clock size={11} style={{ color: '#9ca3af' }} />
          <span className="tc-stat-label">
            {formatDistanceToNow(new Date(token.lastActivity), { addSuffix: true })}
          </span>
        </div>
        {Object.entries(typeCounts).map(([label, count]) => (
          <React.Fragment key={label}>
            <div className="tc-stat-divider" />
            <div className="tc-stat">
              <span
                className="tc-type-chip"
                style={
                  label === 'WHALE'
                    ? { color: '#06b6d4', background: 'rgba(6,182,212,0.08)' }
                    : label === 'SOCIAL'
                    ? { color: '#f97316', background: 'rgba(249,115,22,0.08)' }
                    : label === 'NEWS'
                    ? { color: '#a855f7', background: 'rgba(168,85,247,0.08)' }
                    : { color: '#00FF88', background: 'rgba(0,255,136,0.08)' }
                }
              >
                {label} ×{count}
              </span>
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* ── Event list ── */}
      <div className="tc-event-list">
        {visible.map((ev) => (
          <EventRow key={ev.id} event={ev} />
        ))}
      </div>

      {/* ── Expand toggle ── */}
      {extra > 0 && (
        <button
          className="tc-expand-btn"
          onClick={() => setExpanded((p) => !p)}
        >
          {expanded ? (
            <>
              <ChevronUp size={13} />
              Collapse
            </>
          ) : (
            <>
              <ChevronDown size={13} />
              +{extra} more signals
            </>
          )}
        </button>
      )}
    </div>
  );
}
