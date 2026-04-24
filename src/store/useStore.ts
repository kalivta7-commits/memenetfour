import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Session shape
// sessionToken    = the hex string sent as x-session-token header
// sessionTokenDbId = the token UUID (used for navigation, NOT for auth)
//
// ⚠️  SECURITY: Session is NEVER persisted to localStorage.
//     It lives only in memory and is always null on page load.
//     Users MUST log in every single time.
// ---------------------------------------------------------------------------

interface SessionInfo {
  sessionToken:       string | null;   // header value: x-session-token
  sessionTokenDbId:   string | null;   // token UUID in DB
  sessionUsername:    string | null;   // owner username (display)
  sessionTokenName:   string | null;   // token name (dashboard heading)
  sessionTokenTicker: string | null;   // ticker (display)
}

interface StoreState extends SessionInfo {
  // Session actions
  setSession:   (info: SessionInfo) => void;
  clearSession: () => void;

  // Feed
  feed: any[];
  setFeed:       (feed: any[]) => void;
  addPostToFeed: (post: any)   => void;

  // Events
  events: any[];
  addEvent: (event: any) => void;
}

// ---------------------------------------------------------------------------
// Always start with an empty (unauthenticated) session — no localStorage.
// ---------------------------------------------------------------------------

function emptySession(): SessionInfo {
  return {
    sessionToken:       null,
    sessionTokenDbId:   null,
    sessionUsername:    null,
    sessionTokenName:   null,
    sessionTokenTicker: null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStore = create<StoreState>((set) => ({
  // Session — always null on page load (no localStorage hydration)
  ...emptySession(),

  setSession: (info) => {
    // Store only in memory — never touch localStorage
    set(info);
  },

  clearSession: () => {
    // Also wipe any stale legacy key that may have been written before this fix
    try { localStorage.removeItem('meme_session'); } catch { /* ignore */ }
    set(emptySession());
  },

  // Feed
  feed:          [],
  setFeed:       (feed) => set({ feed }),
  addPostToFeed: (post) => set((s) => ({ feed: [post, ...s.feed] })),

  // Events
  events:   [],
  addEvent: (event) => set((s) => ({ events: [event, ...s.events] })),
}));
