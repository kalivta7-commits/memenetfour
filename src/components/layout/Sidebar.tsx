import { Link, useLocation } from 'react-router-dom';
import { Home, Compass, PlusSquare, Layers, LogIn, Hexagon } from 'lucide-react';
import { useStore } from '../../store/useStore';

export function Sidebar() {
  const { pathname } = useLocation();
  const sessionTokenId = useStore(state => state.sessionTokenDbId);

  const navs = [
    { to: '/app',       icon: Home,       label: 'Feed' },
    { to: '/explore',   icon: Compass,    label: 'Explore' },
    { to: '/submit',    icon: PlusSquare, label: 'Submit Token' },
    { to: '/my-tokens', icon: Layers,     label: 'My Tokens' },
  ];

  if (sessionTokenId) {
    navs.push({ to: `/token-admin/${sessionTokenId}`, icon: Hexagon, label: 'Token Dashboard' });
  } else {
    navs.push({ to: '/token-admin-login', icon: LogIn, label: 'Admin Login' });
  }

  return (
    <div className="hidden md:flex w-[240px] border-r border-brand-border bg-brand-surface h-screen flex-col p-4 fixed left-0 top-0 z-40 overflow-y-auto">
      <div className="mb-8 px-2 uppercase font-['Syne'] memenet-logo">
        MEMENET
      </div>
      <nav className="flex flex-col gap-2">
        {navs.map(l => (
          <Link
            key={l.to}
            to={l.to}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-['DM_Sans'] transition-all duration-200 ${
              pathname === l.to
                ? 'bg-brand-green/10 text-brand-green font-medium shadow-[0_0_10px_rgba(0,255,136,0.1)]'
                : 'text-brand-muted hover:bg-[#121826] hover:text-[#e5e7eb]'
            }`}
          >
            <l.icon size={20} className={pathname === l.to ? 'text-brand-green drop-shadow-[0_0_5px_rgba(0,255,136,0.5)]' : ''} />
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
