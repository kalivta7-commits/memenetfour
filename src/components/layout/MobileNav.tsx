import { Link, useLocation } from 'react-router-dom';
import { Home, Compass, PlusSquare, Layers, Hexagon } from 'lucide-react';
import { useStore } from '../../store/useStore';

const PAGE_TITLES: Record<string, string> = {
  '/app':       'Feed',
  '/explore':   'Explore',
  '/submit':    'Submit Token',
  '/my-tokens': 'My Tokens',
};

export function MobileNav() {
  const { pathname } = useLocation();
  const sessionTokenId = useStore(state => state.sessionTokenDbId);

  const navs = [
    { to: '/app',       icon: Home,       label: 'Feed' },
    { to: '/explore',   icon: Compass,    label: 'Explore' },
    { to: '/submit',    icon: PlusSquare, label: 'Submit' },
    { to: '/my-tokens', icon: Layers,     label: 'My Tokens' },
  ];

  const currentTitle = PAGE_TITLES[pathname] ?? 'MEMENET';

  return (
    <>
      {/* ── Sticky top header — mobile only ──────────────────────── */}
      <div className="md:hidden sticky top-0 bg-brand-surface/90 backdrop-blur-md border-b border-brand-border z-40 px-4 h-14 flex justify-between items-center">
        <div className="uppercase font-['Syne'] memenet-logo text-base">
          MEMENET
        </div>
        <span className="text-xs font-semibold text-brand-muted uppercase tracking-widest">
          {currentTitle}
        </span>
      </div>

      {/* ── Bottom nav bar — mobile only ─────────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-brand-surface/95 backdrop-blur-lg border-t border-brand-border flex justify-around items-stretch z-50"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {navs.map((l) => {
          const active = pathname === l.to;
          return (
            <Link
              key={l.to}
              to={l.to}
              className={`flex flex-col items-center justify-center gap-1 flex-1 py-2.5 transition-colors relative ${
                active ? 'text-brand-green' : 'text-brand-muted'
              }`}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-b-full bg-brand-green shadow-[0_0_8px_rgba(0,255,136,0.7)]" />
              )}
              <l.icon
                size={21}
                className={active ? 'text-brand-green drop-shadow-[0_0_5px_rgba(0,255,136,0.5)]' : ''}
              />
              <span className="text-[10px] font-medium">{l.label}</span>
            </Link>
          );
        })}

        {sessionTokenId && (
          <Link
            to={`/token-admin/${sessionTokenId}`}
            className={`flex flex-col items-center justify-center gap-1 flex-1 py-2.5 transition-colors relative ${
              pathname.includes('/token-admin/') ? 'text-brand-green' : 'text-brand-muted'
            }`}
          >
            {pathname.includes('/token-admin/') && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-b-full bg-brand-green shadow-[0_0_8px_rgba(0,255,136,0.7)]" />
            )}
            <Hexagon
              size={21}
              className={pathname.includes('/token-admin/') ? 'text-brand-green drop-shadow-[0_0_5px_rgba(0,255,136,0.5)]' : ''}
            />
            <span className="text-[10px] font-medium">Admin</span>
          </Link>
        )}
      </div>
    </>
  );
}
