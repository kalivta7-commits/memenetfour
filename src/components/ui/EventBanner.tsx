import { Zap, TrendingUp, TrendingDown, Newspaper, Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { Link } from 'react-router-dom';

export function EventBanner() {
  const [event, setEvent] = useState<any>(null);

  useEffect(() => {
    // Listen for new events
    const sub = supabase.channel('event_banner')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, payload => {
        setEvent(payload.new);
        setTimeout(() => setEvent(null), 10000); // hide after 10s
      }).subscribe();

    return () => { supabase.removeChannel(sub); };
  }, []);

  if (!event) return null;

  const icon: any = {
    price_pump: <TrendingUp size={16} className="text-brand-green drop-shadow-[0_0_5px_rgba(0,255,136,0.3)]" />,
    price_dump: <TrendingDown size={16} className="text-red-500 drop-shadow-[0_0_5px_rgba(239,68,68,0.3)]" />,
    volume_spike: <Zap size={16} className="text-brand-yellow drop-shadow-[0_0_5px_rgba(250,204,21,0.3)]" />,
    news: <Newspaper size={16} className="text-brand-green-soft" />
  }[event.type] || <Bell size={16} className="text-brand-green" />;

  return (
    <div className="bg-gradient-to-r from-brand-green/10 to-transparent border-t border-b border-brand-green/20 px-4 py-2 flex items-center justify-between text-sm animate-[slideIn_300ms_ease-out]">
      <div className="flex items-center gap-3">
        <div className="p-1.5 bg-black/30 rounded-full">{icon}</div>
        <div className="text-[#e5e7eb] font-medium">
          New Event: <span className="text-brand-green capitalize">{event.type.replace('_', ' ')}</span>
        </div>
      </div>
      <Link to={`/token/${event.token_id}`} className="text-xs text-brand-green hover:text-brand-green/80 underline drop-shadow-[0_0_5px_rgba(0,255,136,0.3)]">
        View Context
      </Link>
    </div>
  );
}
