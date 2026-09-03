import * as SecureStore from 'expo-secure-store';

const KEY = 'hello_circle_onboarding_v1';

export interface OnboardingAnswers {
  hasSeenOnboarding: boolean;
  homeCounty: string | null;
  useGpsLocation: boolean;
  interests: string[];
  availability: string[];
}

const DEFAULT_ANSWERS: OnboardingAnswers = {
  hasSeenOnboarding: false,
  homeCounty: null,
  useGpsLocation: false,
  interests: [],
  availability: [],
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
