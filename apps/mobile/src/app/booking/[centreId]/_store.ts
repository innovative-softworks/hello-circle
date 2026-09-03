import { create } from 'zustand';

// In-memory only (not persisted) — scoped to one booking flow, reset when
// the flow's _layout.tsx unmounts. Threaded through steps via this store
// rather than serializing the whole draft into route params, since the
// guest-details free-text fields would make that unwieldy across 4 steps.
export interface BookingDraft {
  roomId: string | null;
  date: string | null;
  time: string | null;
  duration: number;
  eventType: string;
  guests: number;
  name: string;
  email: string;
  phone: string;
  notes: string;
}

interface BookingDraftState extends BookingDraft {
  setField: <K extends keyof BookingDraft>(key: K, value: BookingDraft[K]) => void;
  reset: () => void;
}

const DEFAULT_DRAFT: BookingDraft = {
  roomId: null,
  date: null,
  time: null,
  duration: 2,
  eventType: '',
  guests: 1,
  name: '',
  email: '',
  phone: '',
  notes: '',
};

export const useBookingDraftStore = create<BookingDraftState>((set) => ({
  ...DEFAULT_DRAFT,
  setField: (key, value) => set({ [key]: value }),
  reset: () => set(DEFAULT_DRAFT),
}));
