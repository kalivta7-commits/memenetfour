import React, { useState, useRef, useCallback } from 'react';
import { supabase } from '../supabase';
import { v4 as uuidv4 } from 'uuid';
import { useNavigate } from 'react-router-dom';
import { Upload, X, Check, ChevronRight, ChevronLeft, Loader2, AlertCircle, Rocket, RefreshCcw, Layers } from 'lucide-react';

// ---------------------------------------------------------------------------
// Supported chains — not free-text
// ---------------------------------------------------------------------------

const CHAINS = [
  { id: 'SOL',   label: 'Solana',   emoji: '◎' },
  { id: 'BASE',  label: 'Base',     emoji: '🔵' },
  { id: 'ETH',   label: 'Ethereum', emoji: '⬡' },
  { id: 'BSC',   label: 'BNB Chain', emoji: '🟡' },
  { id: 'ARB',   label: 'Arbitrum', emoji: '🔷' },
  { id: 'AVAX',  label: 'Avalanche', emoji: '🔺' },
  { id: 'MATIC', label: 'Polygon',  emoji: '💜' },
  { id: 'TON',   label: 'TON',      emoji: '💎' },
];

const CATEGORIES = ['Meme', 'AI', 'DeFi', 'Gaming', 'NFT', 'Community', 'Animal', 'Parody'];

type FormData = {
  name:             string;
  ticker:           string;
  description:      string;
  chain:            string;
  category:         string[];
  website:          string;
  twitter:          string;
  dexscreener_url:  string;
  coingecko_url:    string;
  contract_address: string;
  owner_username:   string;
  owner_password:   string;
  avatar:           File | null;
  banner:           File | null;
};

type SubmitResult = {
  id:         string;
  status:     'approved' | 'rejected';
  ai_score:   number;
  ai_reasons: string[];
  token_id:   string | null;
};

// ---------------------------------------------------------------------------
// Image drop-zone component
// ---------------------------------------------------------------------------

function ImageDropzone({
  label,
  hint,
  value,
  onChange,
  aspect = 'square',
}: {
  label:   string;
  hint:    string;
  value:   File | null;
  onChange: (f: File | null) => void;
  aspect?: 'square' | 'wide';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const preview = value ? URL.createObjectURL(value) : null;

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      onChange(file);
    }
  }, [onChange]);

  return (
    <div>
      <label className="block text-sm font-semibold text-[#e5e7eb] mb-2">{label}</label>
      <div
        className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer
          ${dragging ? 'border-brand-green bg-brand-green/10' : 'border-brand-border hover:border-brand-green/50 hover:bg-brand-green/5'}
          ${aspect === 'wide' ? 'h-24' : 'h-32 w-32'}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        {preview ? (
          <>
            <img
              src={preview}
              alt="preview"
              className={`w-full h-full object-cover rounded-xl ${aspect === 'square' ? 'rounded-full' : ''}`}
            />
            <button
              type="button"
              className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 hover:bg-red-500/80 transition-colors"
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
            >
              <X size={12} className="text-white" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-1 px-2 text-center">
            <Upload size={20} className="text-brand-muted" />
            <span className="text-xs text-brand-muted">{hint}</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(f); }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step progress bar
// ---------------------------------------------------------------------------

function StepBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-all duration-300
            ${i < current ? 'bg-brand-green shadow-[0_0_8px_rgba(0,255,136,0.5)]' :
              i === current - 1 ? 'bg-brand-yellow shadow-[0_0_8px_rgba(250,204,21,0.5)]' :
              'bg-brand-surface'}`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

function Field({
  label, placeholder, value, onChange, type = 'text', required = false,
}: {
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[#e5e7eb] mb-1.5">
        {label}{required && <span className="text-red-400 ml-1">*</span>}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-brand-surface border border-brand-border focus:border-brand-yellow
          outline-none rounded-lg px-3 py-2.5 text-white text-sm transition-colors
          placeholder:text-brand-muted/60"
      />
    </div>
  );
}

function TextArea({
  label, placeholder, value, onChange, required = false,
}: {
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[#e5e7eb] mb-1.5">
        {label}{required && <span className="text-red-400 ml-1">*</span>}
        <span className="text-brand-muted font-normal ml-2 text-xs">{value.length}/300</span>
      </label>
      <textarea
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={300}
        rows={4}
        className="w-full bg-brand-surface border border-brand-border focus:border-brand-yellow
          outline-none rounded-lg px-3 py-2.5 text-white text-sm resize-none transition-colors
          placeholder:text-brand-muted/60"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SubmitToken() {
  const [step, setStep]       = useState(1);
  const TOTAL_STEPS           = 3;
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<SubmitResult | null>(null);

  const [form, setForm] = useState<FormData>({
    name: '', ticker: '', description: '', chain: '',
    category: [], website: '', twitter: '',
    dexscreener_url: '', coingecko_url: '', contract_address: '',
    owner_username: '', owner_password: '',
    avatar: null, banner: null,
  });

  const set = (key: keyof FormData, val: any) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const toggleCategory = (cat: string) => {
    const cats = form.category.includes(cat)
      ? form.category.filter(c => c !== cat)
      : [...form.category, cat].slice(0, 3); // max 3
    set('category', cats);
  };

  // ── Validation per step ─────────────────────────────────────────────────

  const validateStep = (): string | null => {
    if (step === 1) {
      if (!form.name.trim())        return 'Token name is required.';
      if (!form.ticker.trim())      return 'Ticker is required.';
      if (form.ticker.length > 10)  return 'Ticker must be 10 characters or fewer.';
      if (!form.description.trim()) return 'Description is required.';
      if (form.description.length < 20) return 'Description must be at least 20 characters.';
      if (!form.chain)              return 'Please select a chain.';
    }
    if (step === 2) {
      // Links are optional but twitter/dexscreener are useful — no hard requirement
    }
    if (step === 3) {
      if (!form.avatar)              return 'Avatar image is required.';
      if (!form.owner_username.trim()) return 'Owner username is required.';
      if (form.owner_password.length < 8) return 'Password must be at least 8 characters.';
    }
    return null;
  };

  const next = () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError(null);
    setStep(s => Math.min(TOTAL_STEPS, s + 1));
  };

  const back = () => {
    setError(null);
    setStep(s => Math.max(1, s - 1));
  };

  // ── Submit ───────────────────────────────────────────────────────────────

  const submit = async () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError(null);
    setLoading(true);

    try {
      let avatarUrl = '';
      if (form.avatar) {
        const fileExt = form.avatar.name.split('.').pop();
        const fileName = `${uuidv4()}-${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, form.avatar);
        if (uploadError) throw new Error('Avatar upload failed');
        const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
        avatarUrl = data.publicUrl;
      }

      let bannerUrl = null;
      if (form.banner) {
        const fileExt = form.banner.name.split('.').pop();
        const fileName = `${uuidv4()}-${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('banners')
          .upload(fileName, form.banner);
        if (uploadError) throw new Error('Banner upload failed');
        const { data } = supabase.storage.from('banners').getPublicUrl(fileName);
        bannerUrl = data.publicUrl;
      }

      const tickerClean = form.ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

      const { data: token, error: tokenError } = await supabase.from('tokens').insert({
        name: form.name.trim(),
        ticker: tickerClean,
        token_symbol: tickerClean,
        profile_image: avatarUrl,
        banner_image: bannerUrl,
        bio: form.description.trim(),
        chain: form.chain.trim(),
        category: form.category,
        website: form.website.trim() || null,
        twitter_url: form.twitter.trim() || null,
        contract_address: form.contract_address.trim() || null,
        coingecko_url: form.coingecko_url.trim() || null,
        dex_url: form.dexscreener_url.trim() || null,
        status: 'active',
        is_active: true,
        is_deleted: false,
        verified: true,
        mood: 'neutral',
        aggression_level: 5,
        engagement_score: 0,
        dominance_score: 0,
        posts_today: 0,
        owner_username: form.owner_username.trim().toLowerCase(),
        owner_password_hash: form.owner_password // Store plaintext so frontend login works
      }).select().single();

      if (tokenError) throw new Error(tokenError.message);

      // Seed initial event
      await supabase.from('events').insert({
        type: 'new_listing',
        title: `${token.name} just launched on MemeNet!`,
        content: `${token.name} just launched on MemeNet!`,
        source: 'system',
        score: 85,
        token_id: token.id,
        data: { message: 'Fresh drop — first mover advantage.' },
        processed: false
      });

      setResult({
        id: token.id,
        status: 'approved',
        ai_score: 100,
        ai_reasons: ['Approved by rules.'],
        token_id: token.id
      });
    } catch (e: any) {
      const msg = e.message ?? 'Submission failed.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Success screen ───────────────────────────────────────────────────────

  const navigate = useNavigate();

  if (result) {
    const isLive = result.status === 'approved';

    if (isLive) {
      return (
        <div className="w-full max-w-[480px] mx-auto min-h-[80vh] p-4 sm:p-8 flex items-center justify-center animate-[slideIn_280ms_ease-out]">

          <div className="card-premium p-8 w-full max-w-md text-center">
            {/* Glow ring */}
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-brand-green/20 animate-ping" />
              <div className="relative w-20 h-20 rounded-full bg-brand-green/15 border-2 border-brand-green/60 flex items-center justify-center shadow-[0_0_30px_rgba(0,255,136,0.3)]">
                <Rocket size={34} className="text-brand-green" />
              </div>
            </div>

            <h2 className="text-2xl font-bold text-white mb-2 font-['Syne'] uppercase tracking-wide">
              Your Token is LIVE 🚀
            </h2>
            <p className="text-brand-muted mb-1 text-sm leading-relaxed">
              AI verified and instantly activated.
            </p>
            <p className="text-brand-green font-bold text-lg mb-6 font-mono">
              {result.ai_score}/100
            </p>

            {result.ai_reasons.length > 0 && (
              <ul className="text-left text-xs text-brand-muted space-y-1 mb-6 bg-brand-surface rounded-lg p-3 border border-brand-green/20">
                {result.ai_reasons.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-brand-green flex-shrink-0">✓</span>{r}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-col gap-3">
              <button
                className="btn-primary w-full text-sm"
                onClick={() => navigate('/app')}
              >
                Go to Feed
              </button>
              {result.token_id && (
                <button
                  className="btn-secondary w-full text-sm flex items-center justify-center gap-2"
                  onClick={() => navigate(`/token/${result.token_id}`)}
                >
                  View Token Profile
                </button>
              )}
              <button
                className="text-xs text-brand-muted hover:text-white transition-colors flex items-center justify-center gap-1.5 mt-1"
                onClick={() => navigate('/my-tokens')}
              >
                <Layers size={13} /> My Tokens
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Rejected
    return (
      <div className="w-full max-w-[680px] mx-auto min-h-screen p-8 flex items-center justify-center animate-[slideIn_280ms_ease-out]">
        <div className="card-premium p-8 w-full max-w-md text-center">
          <div className="w-20 h-20 rounded-full bg-red-500/10 border-2 border-red-500/40 flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={34} className="text-red-400" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2 font-['Syne'] uppercase tracking-wide">
            Token Rejected by AI
          </h2>
          <p className="text-brand-muted mb-1 text-sm leading-relaxed">
            Your submission did not meet the quality threshold.
          </p>
          <p className="text-red-400 font-bold text-lg mb-4 font-mono">
            {result.ai_score}/100 <span className="text-xs text-brand-muted font-normal">(min 60 required)</span>
          </p>

          {result.ai_reasons.length > 0 && (
            <div className="text-left mb-6 bg-red-500/5 border border-red-500/20 rounded-lg p-4">
              <p className="text-xs font-semibold text-red-400 mb-2 uppercase tracking-wider">Rejection Reasons</p>
              <ul className="space-y-1.5">
                {result.ai_reasons.map((r, i) => (
                  <li key={i} className="text-xs text-[#e5e7eb] flex gap-2">
                    <span className="text-red-400 flex-shrink-0">›</span>{r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <button
              className="w-full flex items-center justify-center gap-2 bg-brand-yellow text-black
                font-bold py-3 rounded-lg hover:brightness-110 transition-all text-sm"
              onClick={() => {
                setResult(null);
                setStep(1);
                setError(null);
              }}
            >
              <RefreshCcw size={15} /> Fix & Resubmit
            </button>
            <button
              className="btn-secondary w-full text-sm"
              onClick={() => navigate('/app')}
            >
              Back to Feed
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-[680px] mx-auto min-h-screen p-4 sm:p-6 animate-[slideIn_280ms_ease-out]">
      <h1 className="text-2xl sm:text-3xl font-['Syne'] font-bold text-white mb-1 uppercase tracking-wide">
        Submit Token
      </h1>
      <p className="text-brand-muted mb-6 text-sm">
        AI-verified · Automatic personality generation · Live agent on approval
      </p>

      <div className="card-premium p-5 sm:p-6">
        <StepBar current={step} total={TOTAL_STEPS} />

        {/* ─── Step 1: Token Info ─── */}
        {step === 1 && (
          <div className="flex flex-col gap-4 animate-[slideIn_280ms_ease-out]">
            <div className="text-xs font-bold uppercase tracking-widest text-brand-yellow mb-1">
              Step 1 — Token Identity
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Token Name" placeholder="e.g. DogePepe" value={form.name} onChange={v => set('name', v)} required />
              <Field
                label="Ticker"
                placeholder="$DPEP"
                value={form.ticker}
                onChange={v => set('ticker', v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                required
              />
            </div>

            <TextArea label="Description / Lore" placeholder="What is this token's story? Why does it exist? What is its vibe?" value={form.description} onChange={v => set('description', v)} required />

            {/* Chain selector */}
            <div>
              <label className="block text-sm font-semibold text-[#e5e7eb] mb-2">
                Chain <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {CHAINS.map(chain => (
                  <button
                    key={chain.id}
                    type="button"
                    onClick={() => set('chain', chain.id)}
                    className={`py-2 px-2 rounded-lg border text-xs font-bold transition-all text-center
                      ${form.chain === chain.id
                        ? 'bg-brand-yellow/15 border-brand-yellow text-brand-yellow shadow-[0_0_8px_rgba(250,204,21,0.3)]'
                        : 'border-brand-border text-brand-muted hover:border-brand-border-h hover:text-white'}`}
                  >
                    <div className="text-base mb-0.5">{chain.emoji}</div>
                    {chain.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Category tags */}
            <div>
              <label className="block text-sm font-semibold text-[#e5e7eb] mb-2">
                Categories <span className="text-brand-muted font-normal text-xs">(pick up to 3)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all
                      ${form.category.includes(cat)
                        ? 'bg-brand-green/15 border-brand-green text-brand-green'
                        : 'border-brand-border text-brand-muted hover:border-brand-border-h'}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── Step 2: Links & Market ─── */}
        {step === 2 && (
          <div className="flex flex-col gap-4 animate-[slideIn_280ms_ease-out]">
            <div className="text-xs font-bold uppercase tracking-widest text-brand-yellow mb-1">
              Step 2 — Social & Market Links
            </div>
            <Field label="Twitter / X Profile URL" placeholder="https://x.com/yourtoken" value={form.twitter} onChange={v => set('twitter', v)} />
            <Field label="DexScreener URL" placeholder="https://dexscreener.com/..." value={form.dexscreener_url} onChange={v => set('dexscreener_url', v)} />
            <Field label="CoinGecko URL" placeholder="https://coingecko.com/en/coins/..." value={form.coingecko_url} onChange={v => set('coingecko_url', v)} />
            <Field label="Contract Address" placeholder="0x… or wallet address" value={form.contract_address} onChange={v => set('contract_address', v)} />
            <Field label="Website" placeholder="https://yourtoken.xyz" value={form.website} onChange={v => set('website', v)} />
            <p className="text-xs text-brand-muted bg-brand-surface border border-brand-border rounded-lg p-3">
              💡 The contract address enables live price tracking via DexScreener. CoinGecko URL enables chart data. All optional but recommended.
            </p>
          </div>
        )}

        {/* ─── Step 3: Images & Owner Account ─── */}
        {step === 3 && (
          <div className="flex flex-col gap-5 animate-[slideIn_280ms_ease-out]">
            <div className="text-xs font-bold uppercase tracking-widest text-brand-yellow mb-1">
              Step 3 — Images & Owner Account
            </div>

            <div className="flex gap-4 items-start">
              <ImageDropzone
                label="Avatar *"
                hint="JPG/PNG/WEBP ≤5MB"
                value={form.avatar}
                onChange={f => set('avatar', f)}
                aspect="square"
              />
              <div className="flex-1">
                <ImageDropzone
                  label="Banner (optional)"
                  hint="JPG/PNG/WEBP ≤5MB — 3:1 ratio recommended"
                  value={form.banner}
                  onChange={f => set('banner', f)}
                  aspect="wide"
                />
              </div>
            </div>

            <div className="border-t border-brand-border/50 pt-4">
              <p className="text-xs text-brand-muted mb-4">
                Create an owner account so you can manage your token's profile after it goes live.
              </p>
              <div className="flex flex-col gap-4">
                <Field label="Owner Username" placeholder="Choose a username" value={form.owner_username} onChange={v => set('owner_username', v)} required />
                <Field label="Password" placeholder="Min. 8 characters — save this!" value={form.owner_password} onChange={v => set('owner_password', v)} type="password" required />
              </div>
              <p className="text-xs text-red-400/80 mt-2">
                ⚠️ Save your password — it cannot be recovered.
              </p>
            </div>
          </div>
        )}

        {/* ─── Error banner ─── */}
        {error && (
          <div className="mt-4 flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400 animate-[slideIn_280ms_ease-out]">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* ─── Navigation ─── */}
        <div className="flex gap-3 mt-6">
          {step > 1 && (
            <button
              onClick={back}
              disabled={loading}
              className="btn-secondary flex items-center gap-2 px-4"
            >
              <ChevronLeft size={16} /> Back
            </button>
          )}
          {step < TOTAL_STEPS ? (
            <button
              onClick={next}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              Continue <ChevronRight size={16} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 bg-brand-green text-black
                font-bold py-3 rounded-lg hover:bg-brand-green-soft transition-all
                shadow-[0_0_20px_rgba(0,255,136,0.3)] disabled:opacity-60"
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> Submitting &amp; Analyzing...</>
              ) : (
                <><Check size={16} /> Submit for AI Review</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
