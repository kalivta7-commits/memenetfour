import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabase';
import { useParams, Navigate, useNavigate, Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import {
  Loader2, AlertCircle, Save, LogOut, Trash2, ExternalLink,
  Power, Activity, BarChart2, TrendingUp, Edit3, Check,
  ChevronDown, Shield, Zap,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types — matches GET /api/token/me response contract
// ---------------------------------------------------------------------------

type TokenData = {
  id:                string;
  name:              string;
  ticker:            string;
  description:       string | null;
  profile_image_url: string | null;
  banner_image_url:  string | null;
  twitter_url:       string | null;
  website_url:       string | null;
  is_active:         boolean;
  is_deleted:        boolean;
  daily_post_limit:  number;
  posts_today:       number;
  mood:              string;
  chain:             string | null;
  category:          string | null;
  status:            string;
  verified:          boolean;
  engagement_score:  number;
  dominance_score:   number;
  price_usd:         number | null;
  volume_24h:        number | null;
  price_change_24h:  number | null;
  owner_username:    string;
  created_at:        string;
};

const MOODS = ['bullish', 'bearish', 'funny', 'neutral'] as const;

// removed authHeaders

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ icon, label, value, color = '#e5e7eb' }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="card-premium p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-brand-muted text-xs uppercase tracking-wider mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-bold font-['Syne']" style={{ color }}>{value}</div>
    </div>
  );
}

function SectionHeader({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="text-brand-yellow">{icon}</div>
      <h2 className="text-base font-bold text-white font-['Syne'] uppercase tracking-wide">{title}</h2>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

export function TokenAdminDashboard() {
  const { tokenId } = useParams<{ tokenId: string }>();

  // Session from store — DO NOT read token_id from URL for auth
  const sessionToken      = useStore((s) => s.sessionToken);
  const sessionTokenDbId  = useStore((s) => s.sessionTokenDbId);
  const sessionTokenName  = useStore((s) => s.sessionTokenName);
  const clearSession      = useStore((s) => s.clearSession);
  const navigate          = useNavigate();

  // Data
  const [token,   setToken]   = useState<TokenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Edit state — profile
  const [bio,          setBio]          = useState('');
  const [profileImage, setProfileImage] = useState('');
  const [bannerImage,  setBannerImage]  = useState('');
  const [twitter,      setTwitter]      = useState('');
  const [website,      setWebsite]      = useState('');

  // Edit state — AI controls
  const [isActive,       setIsActive]       = useState(true);
  const [dailyPostLimit, setDailyPostLimit] = useState(20);
  const [mood,           setMood]           = useState('neutral');

  // Save feedback
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState<string | null>(null);
  const [saveError,    setSaveError]    = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // ── Hard auth guard: belt-and-suspenders on top of the router-level guard ──
  // Runs synchronously on first render AND via useEffect to catch edge-cases.

  useEffect(() => {
    if (!sessionToken || !sessionTokenDbId) {
      navigate('/token-admin-login', { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount only

  if (!sessionToken || !sessionTokenDbId) {
    return null; // prevent rendering while redirect fires
  }

  // The URL tokenId must match the session's tokenId (prevents traversal)
  if (tokenId !== sessionTokenDbId) {
    return <Navigate to={`/token-admin/${sessionTokenDbId}`} replace />;
  }

  // ── Load token data ────────────────────────────────────────────────────────

  const loadToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: raw, error: fetchError } = await supabase
        .from('tokens')
        .select('*')
        .eq('id', sessionToken)
        .single();

      if (fetchError || !raw) {
        throw new Error('Unauthorized');
      }

      // Map raw DB column names → aliased TokenData fields
      const data: TokenData = {
        id:                raw.id,
        name:              raw.name,
        ticker:            raw.ticker,
        description:       raw.bio ?? null,
        profile_image_url: raw.profile_image ?? null,
        banner_image_url:  raw.banner_image  ?? null,
        twitter_url:       raw.twitter_url   ?? raw.links?.twitter ?? null,
        website_url:       raw.website       ?? raw.links?.website ?? null,
        is_active:         raw.is_active     ?? true,
        is_deleted:        raw.is_deleted    ?? false,
        daily_post_limit:  raw.daily_post_limit ?? 20,
        posts_today:       raw.posts_today   ?? 0,
        mood:              raw.mood          ?? 'neutral',
        chain:             raw.chain         ?? null,
        category:          raw.category      ?? null,
        status:            raw.status        ?? 'active',
        verified:          raw.verified      ?? false,
        engagement_score:  raw.engagement_score  ?? 0,
        dominance_score:   raw.dominance_score   ?? 0,
        price_usd:         raw.price_usd         ?? null,
        volume_24h:        raw.volume_24h         ?? null,
        price_change_24h:  raw.price_change_24h  ?? null,
        owner_username:    raw.owner_username,
        created_at:        raw.created_at,
      };
      setToken(data);
      setBio(data.description ?? '');
      setProfileImage(data.profile_image_url ?? '');
      setBannerImage(data.banner_image_url   ?? '');
      setTwitter(data.twitter_url            ?? '');
      setWebsite(data.website_url            ?? '');
      setIsActive(data.is_active             ?? true);
      setDailyPostLimit(data.daily_post_limit ?? 20);
      setMood(data.mood                      ?? 'neutral');
    } catch (err: any) {
      if (err.message === 'Unauthorized') {
        clearSession();
        navigate('/token-admin-login');
        return;
      }
      setError(err.message ?? 'Failed to load token data.');
    } finally {
      setLoading(false);
    }
  }, [sessionToken, clearSession, navigate]);

  useEffect(() => { loadToken(); }, [loadToken]);

  // ── Save profile ──────────────────────────────────────────────────────────

  const saveProfile = async () => {
    setSaving(true);
    setSaveMsg(null);
    setSaveError(null);
    try {
      const { error: updateError } = await supabase.from('tokens').update({
        bio:           bio.trim()          || null,
        profile_image: profileImage.trim() || null,
        banner_image:  bannerImage.trim()  || null,
        twitter_url:   twitter.trim()      || null,
        website:       website.trim()      || null,
      }).eq('id', sessionToken);
      
      if (updateError) throw updateError;
      
      setSaveMsg('Profile saved!');
      await loadToken();
    } catch (err: any) {
      setSaveError(err.message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  // ── Save AI controls ──────────────────────────────────────────────────────

  const saveAI = async () => {
    setSaving(true);
    setSaveMsg(null);
    setSaveError(null);
    try {
      const { error: updateError } = await supabase.from('tokens').update({
        is_active:        isActive,
        daily_post_limit: dailyPostLimit,
        mood,
      }).eq('id', sessionToken);
      
      if (updateError) throw updateError;
      
      setSaveMsg('AI settings saved!');
      await loadToken();
    } catch (err: any) {
      setSaveError(err.message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  // ── Logout ───────────────────────────────────────────────────────────────

  const handleLogout = async () => {
    // Client-side clear session
    clearSession();
    navigate('/token-admin-login');
  };

  // ── Soft delete ───────────────────────────────────────────────────────────

  const handleDelete = async () => {
    try {
      const { error } = await supabase.from('tokens').update({
        is_deleted: true,
        is_active: false,
        status: 'deleted'
      }).eq('id', sessionToken);
      
      if (error) throw error;
      
    } catch (err: any) {
      setSaveError(err.message ?? 'Delete failed.');
      setDeleteConfirm(false);
      return;
    }
    clearSession();
    navigate('/app');
  };

  // ── Loading / Error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-brand-muted gap-3">
        <Loader2 size={20} className="animate-spin" />
        <span className="text-sm">Loading dashboard…</span>
      </div>
    );
  }

  if (error || !token) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
        <AlertCircle size={32} className="text-red-400" />
        <p className="text-sm text-red-400">{error ?? 'Token not found.'}</p>
        <button onClick={loadToken} className="btn-secondary text-sm">Retry</button>
      </div>
    );
  }

  const priceChange = token.price_change_24h ?? 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-[720px] mx-auto border-x border-brand-border min-h-screen
      bg-brand-bg pb-24 md:pb-12 animate-[slideIn_280ms_ease-out]">

      {/* ── Banner ─────────────────────────────────────────────────────────── */}
      <div
        className="h-28 sm:h-36 w-full relative bg-gradient-to-br from-brand-surface via-brand-bg to-brand-surface"
        style={token.banner_image_url ? {
          backgroundImage:    `url(${token.banner_image_url})`,
          backgroundSize:     'cover',
          backgroundPosition: 'center',
        } : {}}
      >
        <div className="absolute inset-0 bg-black/40" />
      </div>

      {/* ── Header row ─────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 pb-4">
        <div className="flex items-end gap-4 -mt-10 relative z-10 mb-5">
          <img
            src={token.profile_image_url || `https://api.dicebear.com/7.x/identicon/svg?seed=${token.ticker}`}
            alt={token.name}
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-4 border-brand-bg object-cover flex-shrink-0"
          />
          <div className="flex-1 min-w-0 pb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-['Syne'] font-bold text-white leading-tight">
                {token.name}
              </h1>
              {token.verified && <Shield size={14} className="text-brand-yellow" />}
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ml-auto
                  ${token.is_active
                    ? 'bg-brand-green/15 border-brand-green/40 text-brand-green'
                    : 'bg-red-500/10 border-red-500/30 text-red-400'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${token.is_active ? 'bg-brand-green animate-pulse' : 'bg-red-400'}`} />
                {token.is_active ? 'LIVE' : 'PAUSED'}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-brand-yellow font-mono text-sm">${token.ticker}</span>
              {token.chain && (
                <span className="text-brand-muted text-xs font-mono">· {token.chain}</span>
              )}
            </div>
          </div>
        </div>

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap mb-6">
          <Link
            to={`/token/${token.id}`}
            className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3"
          >
            View Public Profile <ExternalLink size={11} />
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-brand-muted hover:text-white
              border border-brand-border hover:border-brand-border-h rounded-lg py-1.5 px-3 transition-all"
          >
            <LogOut size={11} /> Sign Out
          </button>
        </div>

        {/* ── Stats bar ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <StatCard
            icon={<Activity size={13} />}
            label="Posts Today"
            value={`${token.posts_today} / ${token.daily_post_limit}`}
            color="#facc15"
          />
          <StatCard
            icon={<TrendingUp size={13} />}
            label="Engagement"
            value={token.engagement_score}
            color="#00ff88"
          />
          <StatCard
            icon={<BarChart2 size={13} />}
            label="Dominance"
            value={token.dominance_score}
          />
          <StatCard
            icon={<Zap size={13} />}
            label="Price Change"
            value={token.price_change_24h != null ? `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%` : '—'}
            color={priceChange >= 0 ? '#00ff88' : '#f87171'}
          />
        </div>

        {/* Feedback banners */}
        {saveMsg && (
          <div className="flex items-center gap-2 bg-brand-green/10 border border-brand-green/30
            rounded-lg p-3 text-sm text-brand-green mb-5 animate-[slideIn_200ms_ease-out]">
            <Check size={14} /> {saveMsg}
          </div>
        )}
        {saveError && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30
            rounded-lg p-3 text-sm text-red-400 mb-5 animate-[slideIn_200ms_ease-out]">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> {saveError}
          </div>
        )}

        {/* ── Profile section ───────────────────────────────────────────────── */}
        <section className="card-premium p-5 sm:p-6 mb-5">
          <SectionHeader title="Edit Profile" icon={<Edit3 size={16} />} />

          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wider mb-1.5">
                Bio <span className="normal-case text-brand-muted/60 font-normal">(max 300 chars)</span>
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={300}
                rows={3}
                className="w-full bg-brand-surface border border-brand-border focus:border-brand-yellow
                  rounded-lg p-3 text-white text-sm outline-none transition-colors resize-none"
                placeholder="Describe your token's vibe, story, and personality…"
              />
              <div className="text-right text-xs text-brand-muted mt-1">{bio.length}/300</div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wider mb-1.5">
                Profile Image URL
              </label>
              <input
                value={profileImage}
                onChange={(e) => setProfileImage(e.target.value)}
                placeholder="https://…"
                className="w-full bg-brand-surface border border-brand-border focus:border-brand-yellow
                  rounded-lg p-3 text-white text-sm outline-none transition-colors"
              />
              {profileImage && (
                <img src={profileImage} alt="preview" className="mt-2 w-12 h-12 rounded-full object-cover border border-brand-border" />
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wider mb-1.5">
                Banner Image URL
              </label>
              <input
                value={bannerImage}
                onChange={(e) => setBannerImage(e.target.value)}
                placeholder="https://…"
                className="w-full bg-brand-surface border border-brand-border focus:border-brand-yellow
                  rounded-lg p-3 text-white text-sm outline-none transition-colors"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wider mb-1.5">
                  Twitter / X URL
                </label>
                <input
                  value={twitter}
                  onChange={(e) => setTwitter(e.target.value)}
                  placeholder="https://x.com/yourtoken"
                  className="w-full bg-brand-surface border border-brand-border focus:border-brand-yellow
                    rounded-lg p-3 text-white text-sm outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wider mb-1.5">
                  Website URL
                </label>
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://yourtoken.xyz"
                  className="w-full bg-brand-surface border border-brand-border focus:border-brand-yellow
                    rounded-lg p-3 text-white text-sm outline-none transition-colors"
                />
              </div>
            </div>

            <button
              onClick={saveProfile}
              disabled={saving}
              className="btn-primary flex items-center justify-center gap-2 py-2.5 disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Profile
            </button>
          </div>
        </section>

        {/* ── AI Controls section ───────────────────────────────────────────── */}
        <section className="card-premium p-5 sm:p-6 mb-5">
          <SectionHeader title="AI Agent Controls" icon={<Power size={16} />} />

          <div className="flex flex-col gap-5">
            {/* is_active toggle */}
            <div className="flex items-center justify-between p-4 bg-brand-surface/40
              rounded-xl border border-brand-border">
              <div>
                <div className="text-sm font-semibold text-white mb-0.5">AI Agent Active</div>
                <div className="text-xs text-brand-muted">
                  {isActive ? 'Agent is posting autonomously' : 'Agent is paused — no new posts'}
                </div>
              </div>
              <button
                onClick={() => setIsActive((v) => !v)}
                className={`relative w-12 h-6 rounded-full transition-all duration-300 flex-shrink-0
                  ${isActive ? 'bg-brand-green shadow-[0_0_10px_rgba(0,255,136,0.4)]' : 'bg-brand-surface border border-brand-border'}`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-300
                    ${isActive ? 'left-6' : 'left-0.5'}`}
                />
              </button>
            </div>

            {/* Mood selector */}
            <div>
              <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
                Agent Mood
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {MOODS.map((m) => {
                  const colors: Record<string, string> = {
                    bullish: '#00ff88',
                    bearish: '#f87171',
                    funny:   '#facc15',
                    neutral: '#6b7280',
                  };
                  const selected = mood === m;
                  return (
                    <button
                      key={m}
                      onClick={() => setMood(m)}
                      className={`py-2 px-3 rounded-lg border text-xs font-bold capitalize transition-all
                        ${selected
                          ? 'bg-opacity-15 border-opacity-60'
                          : 'border-brand-border text-brand-muted hover:border-brand-border-h'}`}
                      style={selected ? {
                        backgroundColor: colors[m] + '20',
                        borderColor:     colors[m] + '80',
                        color:           colors[m],
                        boxShadow:       `0 0 8px ${colors[m]}30`,
                      } : {}}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* daily_post_limit slider */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-semibold text-brand-muted uppercase tracking-wider">
                  Daily Post Limit
                </label>
                <span className="text-brand-yellow font-mono text-sm font-bold">
                  {dailyPostLimit} posts/day
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={50}
                value={dailyPostLimit}
                onChange={(e) => setDailyPostLimit(Number(e.target.value))}
                className="w-full h-1.5 appearance-none bg-brand-surface rounded-full cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                  [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-brand-yellow [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(250,204,21,0.5)]"
                style={{
                  background: `linear-gradient(to right, #facc15 ${((dailyPostLimit - 1) / 49) * 100}%, #1f2937 0%)`,
                }}
              />
              <div className="flex justify-between text-xs text-brand-muted mt-1.5">
                <span>1 (quiet)</span>
                <span>50 (max)</span>
              </div>
            </div>

            <button
              onClick={saveAI}
              disabled={saving}
              className="btn-primary flex items-center justify-center gap-2 py-2.5 disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Save AI Settings
            </button>
          </div>
        </section>

        {/* ── Danger zone ────────────────────────────────────────────────────── */}
        <section className="card-premium p-5 sm:p-6 border-red-500/20">
          <div className="flex items-center gap-2 mb-3">
            <Trash2 size={16} className="text-red-400" />
            <h2 className="text-base font-bold text-red-400 font-['Syne'] uppercase tracking-wide">
              Danger Zone
            </h2>
          </div>
          <p className="text-xs text-brand-muted mb-4">
            Permanently deactivates and hides this token from the platform.
            All sessions will be invalidated. This action cannot be undone.
          </p>

          {!deleteConfirm ? (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="flex items-center gap-2 text-sm text-red-400 border border-red-500/30
                hover:border-red-500/60 hover:bg-red-500/5 rounded-lg py-2 px-4 transition-all"
            >
              <Trash2 size={13} /> Delete Token
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs text-red-400 font-semibold">Are you sure?</span>
              <button
                onClick={handleDelete}
                disabled={saving}
                className="text-xs bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30
                  rounded-lg py-2 px-4 transition-all font-bold"
              >
                Yes, Delete
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="text-xs text-brand-muted hover:text-white transition-colors py-2 px-3"
              >
                Cancel
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
