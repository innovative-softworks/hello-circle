import { create } from 'zustand';

import { saveOnboarding, skipOnboarding } from '@/api/onboarding';
import { useAuthStore } from '@/auth/store';
import { loadOnboardingAnswers, saveOnboardingAnswers } from '@/onboarding/secureStore';

type OnboardingState = {
  hydrated: boolean;
  hasSeenOnboarding: boolean;
  homeCounty: string | null;
  useGpsLocation: boolean;
  interests: string[];
  availability: string[];
  hydrate: () => Promise<void>;
  setHomeCounty: (county: string | null) => void;
  setUseGpsLocation: (value: boolean) => void;
  toggleInterest: (value: string) => void;
  toggleAvailability: (value: string) => void;
  complete: () => Promise<void>;
  skip: () => Promise<void>;
};

// Onboarding must work before sign-in (browse-without-signing-in,
// skippable — master-prompt §8), but PUT /residents/me/onboarding and
// POST /residents/me/onboarding/skip both require an already-signed-in
// resident (server/src/routes/residents.ts:300,335). So answers are always
// persisted locally first; they're only submitted to the server if the
// user happens to already be signed in when they finish. No background
// "sync pending onboarding on next sign-in" job — deliberately out of
// scope, kept simple.
export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  hydrated: false,
  hasSeenOnboarding: false,
  homeCounty: null,
  useGpsLocation: false,
  interests: [],
  availability: [],

  hydrate: async () => {
    const answers = await loadOnboardingAnswers();
    set({ ...answers, hydrated: true });
  },

  setHomeCounty: (homeCounty) => {
    set({ homeCounty });
    void persist(get());
  },

  setUseGpsLocation: (useGpsLocation) => {
    set({ useGpsLocation });
    void persist(get());
  },

  toggleInterest: (value) => {
    const interests = toggle(get().interests, value);
    set({ interests });
    void persist(get());
  },

  toggleAvailability: (value) => {
    const availability = toggle(get().availability, value);
    set({ availability });
    void persist(get());
  },

  complete: async () => {
    set({ hasSeenOnboarding: true });
    const state = get();
    await persist(state);
    if (useAuthStore.getState().status === 'signedIn') {
      await saveOnboarding({
        homeCounty: state.homeCounty ?? undefined,
        interests: state.interests,
        availability: state.availability,
      }).catch(() => undefined);
    }
  },

  skip: async () => {
    set({ hasSeenOnboarding: true });
    await persist(get());
    if (useAuthStore.getState().status === 'signedIn') {
      await skipOnboarding().catch(() => undefined);
    }
  },
}));

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function persist(state: OnboardingState) {
  return saveOnboardingAnswers({
    hasSeenOnboarding: state.hasSeenOnboarding,
    homeCounty: state.homeCounty,
    useGpsLocation: state.useGpsLocation,
    interests: state.interests,
    availability: state.availability,
  });
}
