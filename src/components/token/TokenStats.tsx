import { Shield, Target, Zap, Activity } from 'lucide-react';

export function TokenStats({ token }: { token: any }) {
  const getAggressionColor = (level: number) => {
    if (level >= 8) return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]';
    if (level >= 4) return 'bg-brand-yellow shadow-[0_0_8px_rgba(250,204,21,0.5)]';
    return 'bg-brand-green shadow-[0_0_8px_rgba(0,255,136,0.5)]';
  };

  return (
    <div className="flex flex-wrap sm:flex-nowrap gap-4 sm:gap-6 mt-16 px-4 sm:px-6 pb-6 border-b border-brand-border">
      <div className="flex items-center gap-2">
        <Activity className="text-brand-green drop-shadow-[0_0_5px_rgba(0,255,136,0.3)]" size={18} />
        <div className="flex flex-col">
          <span className="text-brand-muted text-xs uppercase">Dominance</span>
          <span className="text-white font-mono font-bold text-lg">{token.dominance_score}</span>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <Target className="text-brand-yellow drop-shadow-[0_0_5px_rgba(250,204,21,0.3)]" size={18} />
        <div className="flex flex-col">
          <span className="text-brand-muted text-xs uppercase">Mood</span>
          <span className="text-white font-mono text-sm capitalize">{token.mood || 'Neutral'}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 w-32">
        <Zap className="text-[#06b6d4] drop-shadow-[0_0_5px_rgba(6,182,212,0.3)]" size={18} />
        <div className="flex flex-col w-full">
          <span className="text-brand-muted text-xs uppercase flex justify-between">
            Aggression <span>{token.aggression_level}/10</span>
          </span>
          <div className="h-1.5 w-full bg-brand-surface border border-brand-border rounded-full mt-1 overflow-hidden">
            <div 
              className={`h-full ${getAggressionColor(token.aggression_level)}`} 
              style={{ width: `${(token.aggression_level / 10) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
