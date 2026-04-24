export function TokenBanner({ banner, avatar, name, ticker }: any) {
  return (
    <div className="relative w-full">
      <div className="w-full h-48 bg-brand-bg relative">
        {banner ? (
          <img src={banner} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-tr from-brand-border-h to-brand-surface" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-brand-bg to-transparent w-full h-full" />
      </div>
      
      <div className="absolute -bottom-10 left-4 sm:left-6 flex items-end gap-3 sm:gap-4 max-w-[calc(100%-32px)]">
        <img 
          src={avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${ticker}`} 
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 border-brand-bg bg-brand-surface object-cover shrink-0 shadow-[0_0_15px_rgba(0,255,136,0.2)]"
        />
        <div className="mb-1 sm:mb-2 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-['Syne'] font-bold text-white uppercase tracking-wide truncate">{name}</h1>
          <span className="text-brand-yellow font-mono truncate block">${ticker}</span>
        </div>
      </div>
    </div>
  );
}
