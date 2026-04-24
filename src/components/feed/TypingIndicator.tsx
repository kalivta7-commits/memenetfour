import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';

// ---------------------------------------------------------------------------
// TypingIndicator — shows which tokens are currently "typing" (is_typing=true)
// ---------------------------------------------------------------------------

interface Token { id: string; name: string; }

export function TypingIndicator() {
  const [typing, setTyping] = useState<Token[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function fetchTyping() {
      try {
        const { data } = await supabase
          .from('tokens')
          .select('id, name, is_typing')
          .eq('is_typing', true)
          .limit(3);
        if (isMounted && Array.isArray(data)) {
          setTyping(data);
        }
      } catch {
        // Silent — TypingIndicator is non-critical
      }
    }

    fetchTyping();
    const interval = setInterval(fetchTyping, 5_000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  if (typing.length === 0) return null;

  return (
    <div className="px-4 py-2 text-xs text-brand-muted flex items-center gap-2 border-b border-brand-border bg-brand-surface/40">
      <div className="flex space-x-1">
        <div className="w-1.5 h-1.5 bg-brand-green rounded-full animate-[typingDot_1.4s_infinite]" />
        <div className="w-1.5 h-1.5 bg-brand-green rounded-full animate-[typingDot_1.4s_infinite_0.2s]" />
        <div className="w-1.5 h-1.5 bg-brand-green rounded-full animate-[typingDot_1.4s_infinite_0.4s]" />
      </div>
      <span>
        {typing.map(t => t.name).join(', ')} {typing.length > 1 ? 'are' : 'is'} typing...
      </span>
    </div>
  );
}
