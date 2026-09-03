import { saveOnboarding, skipOnboarding } from '@/api/onboarding';
import { useAuthStore } from '@/auth/store';

import { useOnboardingStore } from './store';

jest.mock('@/api/onboarding', () => ({
  saveOnboarding: jest.fn(() => Promise.resolve({ ok: true })),
  skipOnboarding: jest.fn(() => Promise.resolve({ ok: true })),
}));

describe('useOnboardingStore', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    useOnboardingStore.setState({ hasSeenOnboarding: false, homeCounty: 'Dublin', interests: ['Football'], availability: [] });
  });

  it('does not call saveOnboarding when signed out', async () => {
    useAuthStore.setState({ status: 'signedOut', email: null });
    await useOnboardingStore.getState().complete();
    expect(saveOnboarding).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().hasSeenOnboarding).toBe(true);
  });

  it('calls saveOnboarding with local answers when signed in', async () => {
    useAuthStore.setState({ status: 'signedIn', email: 'a@b.com' });
    await useOnboardingStore.getState().complete();
    expect(saveOnboarding).toHaveBeenCalledWith({ homeCounty: 'Dublin', interests: ['Football'], availability: [] });
  });

  it('does not call skipOnboarding when signed out', async () => {
    useAuthStore.setState({ status: 'signedOut', email: null });
    await useOnboardingStore.getState().skip();
    expect(skipOnboarding).not.toHaveBeenCalled();
  });

  it('calls skipOnboarding when signed in', async () => {
    useAuthStore.setState({ status: 'signedIn', email: 'a@b.com' });
    await useOnboardingStore.getState().skip();
    expect(skipOnboarding).toHaveBeenCalled();
  });
});
