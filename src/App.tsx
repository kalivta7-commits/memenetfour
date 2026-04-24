/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Outlet, Navigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import { Sidebar } from './components/layout/Sidebar';
import { RightPanel } from './components/layout/RightPanel';
import { MobileNav } from './components/layout/MobileNav';
import { Home } from './pages/Home';
import { TokenProfile } from './pages/TokenProfile';
import { PostDetail } from './pages/PostDetail';
import { Explore } from './pages/Explore';
import { SubmitToken } from './pages/SubmitToken';
import { MyTokens } from './pages/MyTokens';
import { ReviewQueue } from './pages/ReviewQueue'; // redirect stub
import { TokenAdminLogin } from './pages/TokenAdminLogin';
import { TokenAdminDashboard } from './pages/TokenAdminDashboard';
import { Landing } from './pages/Landing';

/** Route guard: redirects to login if no in-memory session exists. */
function ProtectedAdminRoute() {
  const sessionToken = useStore((s) => s.sessionToken);
  if (!sessionToken) {
    return <Navigate to="/token-admin-login" replace />;
  }
  return <TokenAdminDashboard />;
}

function AppLayout() {
  return (
    <div className="app-layout min-h-screen bg-brand-bg text-[#e5e7eb] font-['DM_Sans'] relative">
      <Sidebar />

      {/* main area: shifts right for sidebar on md+, also shifts left-padding away from right panel on xl+ */}
      <main className="
        pt-0
        pb-20 md:pb-6
        md:ml-[240px]
        xl:mr-[300px]
        min-h-screen
        flex flex-col
      ">
        <div className="w-full max-w-[860px] mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col">
          <Outlet />
        </div>
      </main>

      <RightPanel />
      <MobileNav />
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        {/* Landing Page */}
        <Route path="/" element={<Landing />} />

        {/* Token owner auth — full-screen, no sidebar */}
        <Route path="/token-admin-login" element={<TokenAdminLogin />} />
        <Route path="/token-admin/:tokenId" element={<ProtectedAdminRoute />} />

        {/* Main Application with Layout */}
        <Route element={<AppLayout />}>
          <Route path="/app" element={<Home />} />
          <Route path="/token/:id" element={<TokenProfile />} />
          <Route path="/post/:id" element={<PostDetail />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/submit" element={<SubmitToken />} />
          <Route path="/my-tokens" element={<MyTokens />} />
          <Route path="/review" element={<ReviewQueue />} />
        </Route>
      </Routes>
    </Router>
  );
}
