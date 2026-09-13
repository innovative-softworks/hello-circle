import { create } from 'zustand';

import type { MakeItHappenCandidate } from '@/api/makeItHappen';

export interface MakeItHappenDraft {
  activityLabel: string;
  county: string;
  date: string;
  time: string;
  duration: number;
  partySize: number;
  candidates: MakeItHappenCandidate[];
  chosenCandidate: MakeItHappenCandidate | null;
  name: string;
  email: string;
  phone: string;
  notes: string;
}

interface MakeItHappenState extends MakeItHappenDraft {
  setField: <K extends keyof MakeItHappenDraft>(key: K, value: MakeItHappenDraft[K]) => void;
  reset: () => void;
}

const DEFAULT_DRAFT: MakeItHappenDraft = {
  activityLabel: '',
  county: '',
  date: '',
  time: '',
  duration: 2,
  partySize: 4,
  candidates: [],
  chosenCandidate: null,
  name: '',
  email: '',
  phone: '',
  notes: '',
};

export const useMakeItHappenStore = create<MakeItHappenState>((set) => ({
  ...DEFAULT_DRAFT,
  setField: (key, value) => set({ [key]: value }),
  reset: () => set(DEFAULT_DRAFT),
}));
