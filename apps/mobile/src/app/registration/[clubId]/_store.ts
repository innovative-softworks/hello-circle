import { create } from 'zustand';

export interface RegistrationDraft {
  registrantType: 'child' | 'adult';
  team: string;
  childFirst: string;
  childLast: string;
  dob: string;
  gFirst: string;
  gLast: string;
  email: string;
  phone: string;
  address: string;
  ecName: string;
  ecPhone: string;
  ecRel: string;
  medical: string;
  consent: boolean;
  trial: boolean;
}

interface RegistrationDraftState extends RegistrationDraft {
  setField: <K extends keyof RegistrationDraft>(key: K, value: RegistrationDraft[K]) => void;
  reset: () => void;
}

const DEFAULT_DRAFT: RegistrationDraft = {
  registrantType: 'child',
  team: '',
  childFirst: '',
  childLast: '',
  dob: '',
  gFirst: '',
  gLast: '',
  email: '',
  phone: '',
  address: '',
  ecName: '',
  ecPhone: '',
  ecRel: '',
  medical: '',
  consent: false,
  trial: false,
};

export const useRegistrationDraftStore = create<RegistrationDraftState>((set) => ({
  ...DEFAULT_DRAFT,
  setField: (key, value) => set({ [key]: value }),
  reset: () => set(DEFAULT_DRAFT),
}));
