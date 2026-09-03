// Deep-link handling for the resident magic-link flow (see /mobile-verify in
// server/src/index.ts and the plan's note on client/src/native.ts's
// setupAppUrlListener being the prior art for this "hand a path to a
// callback, let the caller navigate" shape). Handles both a cold start
// (Linking.getInitialURL) and the app already running in the background
// (the 'url' event).
//
// Deliberately parses with plain WHATWG URL rather than expo-linking's own
// parse() — that helper needs Expo Constants' manifest initialized (fine at
// runtime, but awkward in a bare Jest unit test) and also unwraps Expo Go's
// `exp://host/--/path` indirection, which isn't relevant here: the verify
// flow is tested against a standalone/dev-client build (custom URL scheme
// only opens the app directly there), not through Expo Go.
import * as Linking from 'expo-linking';

export function parseDeepLink(url: string): { path: string; params: Record<string, string> } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = (parsed.hostname + parsed.pathname).replace(/^\/+|\/+$/g, '');
  if (!path) return null;
  const params: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return { path, params };
}

// The cold-start URL, checked once. Kept separate from the ongoing 'url'
// subscription below so a caller (root layout) can await it as part of a
// single boot sequence — e.g. to decide "was this cold start a deep link?"
// before deciding whether to redirect into onboarding instead.
export async function getInitialDeepLink(): Promise<{ path: string; params: Record<string, string> } | null> {
  const url = await Linking.getInitialURL();
  return url ? parseDeepLink(url) : null;
}

// Ongoing listener only — for a deep link opened while the app is already
// running (backgrounded or foregrounded). Does NOT also check the initial
// URL; pair with getInitialDeepLink() for the cold-start case to avoid
// double-handling the same link.
export function addLinkListener(go: (path: string, params: Record<string, string>) => void): () => void {
  const subscription = Linking.addEventListener('url', (event) => {
    const parsed = parseDeepLink(event.url);
    if (parsed) go(parsed.path, parsed.params);
  });
  return () => subscription.remove();
}
