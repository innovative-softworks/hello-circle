import { create } from 'zustand';

// In-memory only, not persisted — recent searches surviving an app restart
// would need a storage dependency this app doesn't otherwise have
// (no AsyncStorage; expo-secure-store is reserved for auth/session data).
// A reasonable scope simplification, same convention as the booking draft
// store's own in-memory-only note.
interface RecentSearchState {
  queries: string[];
  add: (query: string) => void;
  clear: () => void;
}

const MAX_RECENT = 8;

export const useRecentSearchStore = create<RecentSearchState>((set) => ({
  queries: [],
  add: (query) =>
    set((state) => {
      const trimmed = query.trim();
      if (!trimmed) return state;
      const deduped = [trimmed, ...state.queries.filter((q) => q.toLowerCase() !== trimmed.toLowerCase())];
      return { queries: deduped.slice(0, MAX_RECENT) };
    }),
  clear: () => set({ queries: [] }),
}));
