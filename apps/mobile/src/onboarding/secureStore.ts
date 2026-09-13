import * as SecureStore from 'expo-secure-store';

const KEY = 'hello_circle_onboarding_v1';

export interface OnboardingAnswers {
  hasSeenOnboarding: boolean;
  homeCounty: string | null;
  homeLat: number | null;
  homeLng: number | null;
  useGpsLocation: boolean;
  interests: string[];
  availability: string[];
  // A local map of the categories shown on the Notifications onboarding
  // step to on/off — defaults to all-on to match the "everything enabled"
  // starting state, synced to the real notification_prefs column
  // (server/src/routes/residents.ts's PUT /me/notification-prefs) once
  // signed in, same best-effort-if-signed-in pattern as interests/availability.
  notificationPrefs: Record<string, boolean>;
}

const DEFAULT_ANSWERS: OnboardingAnswers = {
  hasSeenOnboarding: false,
  homeCounty: null,
  homeLat: null,
  homeLng: null,
  useGpsLocation: false,
  interests: [],
  availability: [],
  notificationPrefs: {
    openSpots: true,
    circleAnnouncements: true,
    bookingReminders: true,
    waitlistOffers: true,
    recommendations: true,
  },
};

export async function loadOnboardingAnswers(): Promise<OnboardingAnswers> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return DEFAULT_ANSWERS;
  try {
    return { ...DEFAULT_ANSWERS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_ANSWERS;
  }
}

export async function saveOnboardingAnswers(answers: OnboardingAnswers): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(answers));
}
