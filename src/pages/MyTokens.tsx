import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Link } from 'react-router-dom';
import { Hexagon, PlusCircle, Loader2, AlertCircle, ExternalLink, TrendingUp, TrendingDown } from 'lucide-react';

type Submission = {
  id: string;
  name: string;
  ticker: string;
  status: 'approved' | 'rejected';
  ai_score: number;
  ai_verdict: {
    reasons: string[];
    confidence: string;
  } | null;
  submitted_at: string;
  token_id: string | null;
  profile_image_url: string | null;
};

export function MyTokens() {
  const [username, setUsername] = useState('');
  const [inputVal, setInputVal] = useState('');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Restore last searched username from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem('my_tokens_username');
    if (saved) {
      setInputVal(saved);
      fetchSubmissions(saved);
    }
  }, []);

  const fetchSubmissions = async (user: string) => {
    if (!user.trim()) return;
    const normalised = user.trim().toLowerCase();
    setLoading(true);
    setError(null);
    setSearched(true);
    console.log('[MyTokens] username:', normalised);
    try {
      const { data: liveTokens, error: liveError } = await supabase
        .from('tokens')
        .select('id, name, ticker, token_symbol, profile_image, created_at, is_deleted')
        .eq('owner_username', normalised)
        .eq('is_deleted', false);

      if (liveError) throw liveError;

      const { data: subData, error: subError } = await supabase
        .from('token_submissions')
        .select('id, name, ticker, status, ai_score, ai_verdict, created_at, submitted_at, token_id, profile_image_url')
        .eq('owner_username', normalised)
        .order('created_at', { ascending: false });

      if (subError) throw subError;

      const liveTickers = new Set(
        (liveTokens ?? []).map((t: any) => (t.token_symbol || t.ticker || '').toUpperCase())
      );

      const liveRows = (liveTokens ?? []).map((t: any) => ({
        id:                t.id,
        name:              t.name,
        ticker:            t.token_symbol || t.ticker,
        status:            'approved' as const,
        ai_score:          100,
        ai_verdict:        null,
        submitted_at:      t.created_at,
        token_id:          t.id,
        profile_image_url: t.profile_image ?? null,
      }));

      const pendingRows = (subData ?? [])
        .filter((row: any) => {
          const t = (row.ticker || '').toUpperCase();
          return !liveTickers.has(t) || row.status !== 'approved';
        })
        .map((row: any) => ({
          id:                row.id,
          name:              row.name,
          ticker:            row.ticker,
          status:            row.status,
          ai_score:          row.ai_score,
          ai_verdict:        row.ai_verdict,
          submitted_at:      row.submitted_at ?? row.created_at,
          token_id:          row.token_id,
          profile_image_url: row.profile_image_url,
        }));

      setSubmissions([...liveRows, ...pendingRows]);
      setUsername(normalised);
      sessionStorage.setItem('my_tokens_username', normalised);
    } catch (e: any) {
      const err = e.message ?? 'Failed to load tokens.';
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const live  = submissions.filter(s => s.status === 'approved');
  const rejected = submissions.filter(s => s.status === 'rejected');

  return (
    <div className="w-full max-w-[800px] mx-auto min-h-screen p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-['Syne'] font-bold text-white uppercase tracking-wide mb-1">
          My Tokens
        </h1>
        <p className="text-brand-muted text-sm">
          View the status of tokens you've submitted. Enter your owner username to load them.
        </p>
      </div>

      {/* Username lookup */}
      <div className="card-premium p-5 mb-8">
        <label className="block text-sm font-semibold text-[#e5e7eb] mb-2">Owner Username</label>
        <div className="flex gap-3">
          <input
            type="text"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchSubmissions(inputVal)}
            placeholder="Enter the username you registered with"
            className="flex-1 bg-brand-surface border border-brand-border focus:border-brand-yellow
              outline-none rounded-lg px-3 py-2.5 text-white text-sm transition-colors
              placeholder:text-brand-muted/60"
          />
          <button
            onClick={() => fetchSubmissions(inputVal)}
            disabled={loading || !inputVal.trim()}
            className="btn-primary px-5 text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : null}
            Load
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-400 mb-6">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty state after search */}
      {searched && !loading && submissions.length === 0 && !error && (
        <div className="card-premium p-10 text-center flex flex-col items-center gap-4">
          <Hexagon size={40} className="text-brand-muted/40" />
          <p className="text-brand-muted text-sm">No tokens found for <strong className="text-white">{username}</strong>.</p>
          <p className="text-brand-muted/60 text-xs">Make sure you enter the exact username you registered with.</p>
          <Link to="/submit" className="btn-primary text-sm flex items-center gap-2">
            <PlusCircle size={16} /> Submit Your First Token
          </Link>
        </div>
      )}

      {/* Results */}
      {submissions.length > 0 && (
        <>
          {/* Stats bar */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="card-premium p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-brand-green/15 flex items-center justify-center">
                <TrendingUp size={18} className="text-brand-green" />
              </div>
              <div>
                <div className="text-xl font-bold text-brand-green font-['Syne']">{live.length}</div>
                <div className="text-xs text-brand-muted uppercase tracking-wider">Live</div>
              </div>
            </div>
            <div className="card-premium p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-500/15 flex items-center justify-center">
                <TrendingDown size={18} className="text-red-400" />
              </div>
              <div>
                <div className="text-xl font-bold text-red-400 font-['Syne']">{rejected.length}</div>
                <div className="text-xs text-brand-muted uppercase tracking-wider">Rejected</div>
              </div>
            </div>
          </div>

          {/* Submission cards */}
          <div className="flex flex-col gap-4">
            {submissions.map(sub => (
              <div key={sub.id}>
                <TokenCard sub={sub} />
              </div>
            ))}
          </div>

          {/* Submit another CTA */}
          <div className="mt-8 text-center">
            <Link to="/submit" className="btn-secondary inline-flex items-center gap-2 text-sm">
              <PlusCircle size={16} /> Submit Another Token
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function TokenCard({ sub }: { sub: Submission }) {
  const isLive     = sub.status === 'approved';
  const score      = sub.ai_score ?? 0;
  const scoreColor = score >= 80 ? '#00ff88' : score >= 60 ? '#facc15' : '#f87171';

  return (
    <div className={`card-premium p-5 transition-all ${isLive ? 'hover:border-brand-green/40' : 'hover:border-red-500/30'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        {/* Avatar + info row */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <img
            src={sub.profile_image_url || `https://api.dicebear.com/7.x/identicon/svg?seed=${sub.ticker}`}
            alt={sub.name}
            className="w-12 h-12 rounded-full border border-brand-border flex-shrink-0 object-cover"
          />

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-white font-bold font-['Syne'] text-base leading-tight break-words">{sub.name}</h3>
              <span className="text-brand-yellow font-mono text-xs">${sub.ticker}</span>
            </div>
            <p className="text-xs text-brand-muted mt-0.5">
              Submitted {new Date(sub.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Status badge */}
        <div className="flex-shrink-0 sm:text-right">
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-green/15 border border-brand-green/40 text-brand-green text-xs font-bold tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-green animate-pulse" />
              LIVE
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              REJECTED
            </span>
          )}
        </div>
      </div>

      {/* AI Score bar */}
      <div className="mt-4">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-brand-muted">AI Score</span>
          <span className="text-xs font-bold font-mono" style={{ color: scoreColor }}>{score}/100</span>
        </div>
        <div className="h-1.5 bg-brand-surface rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${score}%`, background: scoreColor, boxShadow: `0 0 6px ${scoreColor}80` }}
          />
        </div>
      </div>

      {/* AI Reasons (collapsed, only show on rejection) */}
      {!isLive && sub.ai_verdict?.reasons && sub.ai_verdict.reasons.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-brand-muted cursor-pointer hover:text-white transition-colors">
            Show rejection reasons
          </summary>
          <ul className="mt-2 space-y-1">
            {sub.ai_verdict.reasons.map((r, i) => (
              <li key={i} className="text-xs text-red-400/80 flex gap-2">
                <span className="text-red-400 flex-shrink-0">›</span>{r}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Action */}
      <div className="mt-4 flex gap-3">
        {isLive && sub.token_id ? (
          <Link
            to={`/token/${sub.token_id}`}
            className="btn-primary text-xs flex items-center gap-1.5 py-2 px-4"
          >
            View Token Profile <ExternalLink size={12} />
          </Link>
        ) : !isLive ? (
          <Link
            to="/submit"
            className="text-xs border border-brand-border text-brand-muted hover:text-white hover:border-brand-border-h 
              rounded-lg py-2 px-4 transition-colors flex items-center gap-1.5"
          >
            <PlusCircle size={12} /> Resubmit
          </Link>
        ) : null}
      </div>
    </div>
  );
}
