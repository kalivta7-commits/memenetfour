import React, { useState } from 'react';

import { useStore } from '../store/useStore';
import { useNavigate, Link } from 'react-router-dom';
import { Loader2, AlertCircle, Lock, User, ChevronRight, Zap } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types — locked contract from POST /api/token/login
// ---------------------------------------------------------------------------

type TokenOption = {
  session_token: string;
  id: string;
  name: string;
  ticker: string;
  profile_image: string | null;
};

type LoginResponse = {
  success: boolean;
  username: string;
  tokens: TokenOption[];
};

// ---------------------------------------------------------------------------
// TokenAdminLogin
// ---------------------------------------------------------------------------

export function TokenAdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [tokenOptions, setTokenOptions] = useState<TokenOption[] | null>(null);
  const [loginUsername, setLoginUsername] = useState('');

  const setSession = useStore((s) => s.setSession);
  const navigate   = useNavigate();

  // ── Step 1: authenticate ─────────────────────────────────────────────────

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setError('');
    setLoading(true);

    try {
      const uname = username.trim();
      const { data: tokensData, error: fetchError } = await supabase
        .from('tokens')
        .select('id, name, ticker, profile_image, status')
        .eq('owner_username', uname)
        .eq('owner_password_hash', password);

      if (fetchError || !tokensData || tokensData.length === 0) {
        throw new Error('Invalid credentials. Please try again.');
      }

      setLoginUsername(uname);

      const activeTokens = tokensData.filter(t => t.status !== 'archived');
      
      const sessionTokens = activeTokens.map(t => ({
        id: t.id,
        name: t.name,
        ticker: t.ticker,
        profile_image: t.profile_image,
        session_token: t.id,
      }));

      if (sessionTokens.length === 1) {
        activateSession(sessionTokens[0] as any, uname);
      } else {
        setTokenOptions(sessionTokens as any);
      }
    } catch (err: any) {
      const msg = err.message ?? 'Invalid credentials. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2 (multi-token): user picks a token ─────────────────────────────

  const activateSession = (token: TokenOption, uname: string) => {
    setSession({
      sessionToken:       token.session_token,   // x-session-token header value
      sessionTokenDbId:   token.id,              // UUID for navigation
      sessionUsername:    uname,
      sessionTokenName:   token.name,
      sessionTokenTicker: token.ticker,
    });
    navigate(`/token-admin/${token.id}`);
  };

  // ── Multi-token picker screen ─────────────────────────────────────────────

  if (tokenOptions) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
        <div className="w-full max-w-[440px] animate-[slideIn_280ms_ease-out]">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-brand-yellow/15 border border-brand-yellow/30
              flex items-center justify-center mx-auto mb-4 shadow-[0_0_20px_rgba(250,204,21,0.2)]">
              <Zap size={24} className="text-brand-yellow" />
            </div>
            <h1 className="text-2xl font-['Syne'] font-bold text-white uppercase tracking-wide mb-1">
              Select Token
            </h1>
            <p className="text-brand-muted text-sm">
              Multiple tokens found for <span className="text-white font-semibold">{loginUsername}</span>
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {tokenOptions.map((t) => (
              <button
                key={t.id}
                onClick={() => activateSession(t, loginUsername)}
                className="card-premium p-4 flex items-center gap-4 hover:border-brand-yellow/60
                  transition-all group text-left"
              >
                <img
                  src={t.profile_image || `https://api.dicebear.com/7.x/identicon/svg?seed=${t.ticker}`}
                  alt={t.name}
                  className="w-11 h-11 rounded-full border border-brand-border object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white font-['Syne'] leading-tight">{t.name}</div>
                  <div className="text-brand-yellow font-mono text-xs">${t.ticker}</div>
                </div>
                <ChevronRight size={16} className="text-brand-muted group-hover:text-brand-yellow transition-colors flex-shrink-0" />
              </button>
            ))}
          </div>

          <button
            onClick={() => setTokenOptions(null)}
            className="w-full mt-4 text-xs text-brand-muted hover:text-white transition-colors py-2"
          >
            ← Back to login
          </button>
        </div>
      </div>
    );
  }

  // ── Login form ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[500px] h-[500px] rounded-full opacity-10
          bg-[radial-gradient(circle,rgba(250,204,21,0.4)_0%,transparent_70%)]" />
      </div>

      <div className="w-full max-w-[420px] animate-[slideIn_280ms_ease-out] relative z-10">

        {/* Logo / Icon */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-yellow/20 to-brand-green/10
            border border-brand-yellow/30 flex items-center justify-center mx-auto mb-4
            shadow-[0_0_30px_rgba(250,204,21,0.2)]">
            <Lock size={26} className="text-brand-yellow" />
          </div>
          <h1 className="text-2xl font-['Syne'] font-bold text-white uppercase tracking-wide mb-1">
            Token Dashboard
          </h1>
          <p className="text-brand-muted text-sm">Sign in to manage your token's profile and AI settings</p>
        </div>

        {/* Card */}
        <div className="card-premium p-6 sm:p-8">
          <form onSubmit={handleLogin} className="flex flex-col gap-5">

            {/* Username */}
            <div>
              <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
                Owner Username
              </label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none" />
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="w-full bg-brand-surface border border-brand-border focus:border-brand-yellow
                    outline-none rounded-lg pl-9 pr-4 py-3 text-white text-sm transition-colors
                    placeholder:text-brand-muted/50"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none" />
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your account password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-brand-surface border border-brand-border focus:border-brand-yellow
                    outline-none rounded-lg pl-9 pr-4 py-3 text-white text-sm transition-colors
                    placeholder:text-brand-muted/50"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30
                rounded-lg p-3 text-sm text-red-400 animate-[slideIn_200ms_ease-out]">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              id="login-submit"
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="w-full btn-primary flex items-center justify-center gap-2 py-3
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> Authenticating...</>
              ) : (
                <>Sign In <ChevronRight size={16} /></>
              )}
            </button>
          </form>
        </div>

        {/* Footer links */}
        <div className="mt-5 text-center flex flex-col gap-2">
          <p className="text-xs text-brand-muted">
            Don't have a token yet?{' '}
            <Link to="/submit" className="text-brand-yellow hover:brightness-125 transition-all font-semibold">
              Submit one →
            </Link>
          </p>
          <Link to="/my-tokens" className="text-xs text-brand-muted hover:text-white transition-colors">
            View My Tokens
          </Link>
        </div>
      </div>
    </div>
  );
}
